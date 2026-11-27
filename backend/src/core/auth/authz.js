'use strict';
// The ONE authorization service. Every API route is guarded by exactly one
// of the factories below, and every project-scoped decision funnels through
// evaluate() — the pending-approval gate, the membership check and the role
// ladder live HERE, so no route can forget one of them.
//
// Denials are uniform by design:
//   401  no/invalid session (or the account is disabled — same thing)
//   404  the project doesn't exist OR the caller is not a member —
//        membership is never disclosed to outsiders
//   403  a member without a sufficient role, or an account gate
//        (onboarding / forced password change) is closed
//
// Guard middlewares carry marker properties (isAuthGuard / isPublicMarker)
// that the static route-coverage test reads: a route with neither marker
// fails the build.

// viewer < reviewer < editor < manager (a Project Manager on the project) < owner
const ROLE_RANK = { viewer: 1, reviewer: 2, editor: 3, manager: 4, owner: 5 };
const PROJECT_ROLES = ['owner', 'manager', 'editor', 'reviewer', 'viewer'];

/*
  WP-27 (PLT-016, ENT-023): fine-grained permissions on top of the role ladder.

    group grants       a project role held through a group (access_group_members + project_group_grants); the strongest of the
                       person's membership, folder grant and group grants is their role, exactly like the folder level.
    capability rules   per project, allow or deny ONE capability (the `cap` a route guard declares) for a person or a group.
                       Deny wins over every allow and every role-ladder result; allow lets a person below the route's minimum role
                       use that one capability (an "export only" or "waiver only" grant). Neither applies to a software administrator
                       or to an owner of the project (they keep full authority; the administrator is the break-glass account).
                       A rule never gives access to a project the person cannot open at all, and never lifts the pending/closed gate.
    auditor            a global read-only flag on an account: every active project is readable (as a viewer), the audit log and the
                       access lists are readable (requireGlobal), and every state-changing request is refused (403 READ_ONLY_ACCOUNT)
                       except the account's own gate exits (sign out, change password, activity).

  `access` is the access repository (repositories/accessRepository.ts); without it (older callers, unit tests) only the ladder applies.
*/
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Global capabilities that are not a project role: who holds them besides an administrator. */
const GLOBAL_CAPS = { 'audit.read': ['auditor'], 'access.read': ['auditor'] };

function createAuthz({ store, sessions, workspaceDir, projectDirFor, access = null }) {
  // ---- request plumbing ---------------------------------------------------

  function resolveAuth(req) {
    if (req.auth !== undefined) return req.auth;
    req.auth = sessions.resolveFromCookieHeader(req.headers.cookie || '') || null;
    // Throttled last-seen touch: at most once a minute per session. last_seen_at is what the idle limit measures
    // (WP-03), so a timer's request (x-agastya-background: badge counts, status checks) does not count as activity.
    if (req.auth && req.headers['x-agastya-background'] !== '1') {
      const last = Date.parse(req.auth.session.lastSeenAt || 0) || 0;
      if (Date.now() - last > 60000) {
        try { store.touchSession(req.auth.session.id, new Date().toISOString()); } catch { /* the next request tries again */ }
      }
    }
    return req.auth;
  }

  // Why the person is no longer signed in, so the client can say so instead of silently showing the sign-in page (UX-022).
  const END_MESSAGES = {
    displaced: ['SESSION_DISPLACED', 'You were signed out because this account signed in on another computer or browser.'],
    idle: ['SESSION_IDLE', 'You were signed out after a period without activity.'],
    expired: ['SESSION_EXPIRED', 'Your session reached its time limit. Sign in again to continue.'],
    disabled: ['ACCOUNT_DISABLED', 'This account has been disabled.'],
    admin: ['SESSION_REVOKED', 'An administrator ended your session.'],
    revoked: ['SESSION_REVOKED', 'Your session was ended.'],
    'password-changed': ['SESSION_REVOKED', 'You were signed out because the password of this account was changed.'],
  };
  function deny401(res, req) {
    let reason = null;
    try { reason = req && sessions.endReasonFromCookieHeader ? sessions.endReasonFromCookieHeader(req.headers.cookie || '') : null; } catch { reason = null; }
    const known = reason && (END_MESSAGES[reason] || (/admin/.test(reason) ? END_MESSAGES.admin : null));
    if (known) return res.status(401).json({ error: known[1], code: known[0], reason });
    return res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
  }
  function deny404(res) {
    return res.status(404).json({ error: 'Not found' });
  }
  function deny403(res, code, error) {
    return res.status(403).json({ error: error || 'You do not have permission to do that.', code: code || 'FORBIDDEN' });
  }

  /** WP-27: an auditor changes nothing; only the account's own gate exits (opts) stay open. */
  function readOnlyRefusal(user, req, opts = {}) {
    if (!user || !user.auditor || user.role === 'admin') return null;
    if (SAFE_METHODS.has(String((req && req.method) || 'GET').toUpperCase())) return null;
    if (opts.allowForcedChange || opts.allowPendingOnboarding) return null;
    return { code: 'READ_ONLY_ACCOUNT', error: 'This is a read-only auditor account.' };
  }

  /*
    Account gates, in priority order. While onboarding is pending the account
    can do nothing but onboard; while a password change is forced it can do
    nothing but change the password. Routes that must stay reachable through
    a closed gate (the gate's own exit) say so explicitly via options — and
    ONLY those routes.
  */
  function gateCheck(user, { allowPendingOnboarding = false, allowForcedChange = false } = {}) {
    if (user.onboardingPending && !allowPendingOnboarding) {
      return { code: 'ONBOARDING_REQUIRED', error: 'Complete first-login onboarding before doing anything else.' };
    }
    if (!user.onboardingPending && user.mustChangePassword && !allowForcedChange) {
      return { code: 'PASSWORD_CHANGE_REQUIRED', error: 'You must change your password before doing anything else.' };
    }
    return null;
  }

  /*
    THE authorization decision for a project capability.
    Returns { ok:true, role, row } or { ok:false, http, code, error }.
  */
  function evaluate(user, projectId, { minRole = 'viewer', cap = 'project.access', ignoreAccountGates = false } = {}) {
    if (!user) return { ok: false, http: 401, code: 'UNAUTHENTICATED', error: 'Authentication required.' };
    /*
      ignoreAccountGates is for ONE caller: an administrator carrying out a
      structural change that was already requested and approved, re-checked as
      the person who asked for it. They are not the one making the request
      now, so a password reset issued to them in the meantime is no reason to
      throw their request away. It skips the account gates only — membership
      and the role ladder below are always applied.
    */
    const gate = ignoreAccountGates ? null : gateCheck(user);
    if (gate) return { ok: false, http: 403, code: gate.code, error: gate.error };

    if (!projectId || !/^[A-Za-z0-9][\w-]*$/.test(String(projectId))) {
      return { ok: false, http: 404, code: 'NOT_FOUND', error: 'Not found' };
    }
    const row = store.getProjectRow(projectId);
    if (!row) return { ok: false, http: 404, code: 'NOT_FOUND', error: 'Not found' };

    /*
      A software administrator has OWNER-EQUIVALENT authority on every
      project, with or without an explicit membership — they manage the whole
      workspace, so they can open, edit, lock and govern any project's
      content. A regular user must be a member; for a non-member the project's
      very existence is not disclosed (uniform 404). This single branch is why
      admins can lock any document globally without being added to the project.

      Access comes at TWO levels and both are read here, because this is the
      one place a project capability is decided:

        project level  a membership on this project (project_members)
        folder level   a role granted on the folder the project is filed in,
                       which applies to everything in it, present and future

      Whoever holds both keeps the stronger of the two — a folder grant can
      raise what someone may do, never lower a role they were given by name.
    */
    const isAdmin = user.role === 'admin';
    const membership = store.getMembership(projectId, user.id);
    const folderRole = store.folderRoleForProject(projectId, user.id);
    const groupRole = access && !isAdmin ? access.groupRoleForProject(String(projectId), user.id) : null;
    const isAuditor = !!user.auditor && !isAdmin;
    /*
      The Common Information Repository's workspace (type 'CIR') belongs to everyone: any signed-in user can
      create and edit data modules in it - an Author as an editor, a Project Manager as a manager. Deleting
      is narrowed to Project Managers and administrators by the route that deletes (see project-content).
    */
    const isCir = row.type === 'CIR';
    if (!membership && !folderRole && !groupRole && !isAdmin && !isCir && !isAuditor) {
      return { ok: false, http: 404, code: 'NOT_FOUND', error: 'Not found' };
    }
    const held = membership ? membership.role : null;
    // the strongest of the three levels (project, folder, group); a tie keeps the earlier one, as before
    const strongest = [held, folderRole, groupRole].reduce((a, b) => ((ROLE_RANK[b] || 0) > (ROLE_RANK[a] || 0) ? b : a), null);
    const role = isAdmin ? 'owner'
      : isAuditor ? 'viewer'                                   // read-only everywhere, whatever else the account holds (WP-27)
        : isCir ? (user.role === 'project_manager' ? 'manager' : 'editor')
          : strongest;

    const status = row.status || 'active';
    if (status !== 'active') {
      // A pending (or rejected/closed) project supports exactly one
      // capability: its owner reading its state. Everything else — edits,
      // builds, invitations, uploads — is refused HERE, so no route needs
      // to remember the approval gate. (A software admin is owner-equivalent
      // and reviews pending projects through the approvals surface.)
      const isOwner = role === 'owner';
      if (isOwner && cap === 'project.read') return { ok: true, role, row };
      const code = status === 'pending' ? 'PROJECT_PENDING' : 'PROJECT_CLOSED';
      const msg = status === 'pending'
        ? 'This project is awaiting approval by a software administrator.'
        : 'This project was not approved.';
      if (isOwner) return { ok: false, http: 403, code, error: msg };
      return { ok: false, http: 404, code: 'NOT_FOUND', error: 'Not found' };
    }

    const need = ROLE_RANK[minRole] || 1;
    const have = ROLE_RANK[role] || 0;
    // WP-27: capability rules, deny first; never for administrators, owners or auditors.
    if (access && !isAdmin && !isAuditor && role !== 'owner' && cap && cap !== 'project.access') {
      const rules = access.rulesFor(String(projectId), user.id).filter((r) => r.capability === cap);
      if (rules.some((r) => r.effect === 'deny')) {
        return { ok: false, http: 403, code: 'CAPABILITY_DENIED', error: 'You do not have permission to do that on this project.' };
      }
      if (have < need && rules.some((r) => r.effect === 'allow')) return { ok: true, role, row, via: 'rule' };
    }
    if (have < need) {
      return { ok: false, http: 403, code: 'INSUFFICIENT_ROLE', error: 'You do not have permission to do that.' };
    }
    return { ok: true, role, row };
  }

  /** WP-27: the capability rules of a project that apply to this person (the client's `can` map); none for administrators and auditors. */
  function rulesFor(user, projectId) {
    if (!access || !user || user.role === 'admin' || user.auditor) return [];
    return access.rulesFor(String(projectId), user.id);
  }

  // ---- guard factories ----------------------------------------------------

  function requireAuth(opts = {}) {
    const mw = function requireAuthGuard(req, res, next) {
      const auth = resolveAuth(req);
      if (!auth) return deny401(res, req);
      const gate = gateCheck(auth.user, opts);
      if (gate) return deny403(res, gate.code, gate.error);
      const ro = readOnlyRefusal(auth.user, req, opts);
      if (ro) return deny403(res, ro.code, ro.error);
      next();
    };
    mw.isAuthGuard = 'requireAuth';
    return mw;
  }

  function requireAdmin() {
    const mw = function requireAdminGuard(req, res, next) {
      const auth = resolveAuth(req);
      if (!auth) return deny401(res, req);
      const gate = gateCheck(auth.user);
      if (gate) return deny403(res, gate.code, gate.error);
      if (auth.user.role !== 'admin') {
        // A project owner is NOT a software administrator. Uniform 403.
        return deny403(res, 'ADMIN_ONLY', 'Software administrator access required.');
      }
      next();
    };
    mw.isAuthGuard = 'requireAdmin';
    return mw;
  }

  /*
    Global-role guard: administrator, Project Manager, Author. Used for the few routes that are about
    PEOPLE rather than a project (creating accounts, the activity dashboard).
  */
  function requireRoles(...roles) {
    const mw = function requireRolesGuard(req, res, next) {
      const auth = resolveAuth(req);
      if (!auth) return deny401(res, req);
      const gate = gateCheck(auth.user);
      if (gate) return deny403(res, gate.code, gate.error);
      if (!roles.includes(auth.user.role)) return deny403(res, 'ROLE_REQUIRED', 'Your role does not allow that.');
      const ro = readOnlyRefusal(auth.user, req);
      if (ro) return deny403(res, ro.code, ro.error);
      next();
    };
    mw.isAuthGuard = `requireRoles(${roles.join(',')})`;
    return mw;
  }

  /*
    WP-27: a global capability that is not a project role. An administrator always holds it; the kinds of account GLOBAL_CAPS lists hold
    it too (the read-only auditor reads the audit log and the access lists). Anyone but an administrator only reads through it.
  */
  function requireGlobal(cap) {
    if (!GLOBAL_CAPS[cap]) throw new Error(`requireGlobal: unknown global capability ${cap}`);
    const mw = function requireGlobalGuard(req, res, next) {
      const auth = resolveAuth(req);
      if (!auth) return deny401(res, req);
      const gate = gateCheck(auth.user);
      if (gate) return deny403(res, gate.code, gate.error);
      const u = auth.user;
      const holds = u.role === 'admin' || (GLOBAL_CAPS[cap].includes('auditor') && !!u.auditor);
      if (!holds) return deny403(res, 'ADMIN_ONLY', 'Software administrator access required.');
      const ro = readOnlyRefusal(u, req);
      if (ro) return deny403(res, ro.code, ro.error);
      next();
    };
    mw.isAuthGuard = `requireGlobal(${cap})`;
    mw.globalCap = cap;
    return mw;
  }

  /*
    Project guard. `from` picks where the project id comes from:
      'active'  the caller's own active project (per user, not global)
      'param'   req.params.id
      fn(req)   anything else
    On success, req.project = { id, dir, role, row } for the handler.
  */
  function requireProject(minRole, { from = 'active', cap = 'project.access' } = {}) {
    const mw = function requireProjectGuard(req, res, next) {
      const auth = resolveAuth(req);
      if (!auth) return deny401(res, req);
      const id = from === 'active' ? auth.user.activeProjectId
        : from === 'param' ? req.params.id
          : from(req);
      const ro = readOnlyRefusal(auth.user, req);
      if (ro) return deny403(res, ro.code, ro.error);
      if (from === 'active' && !id) {
        return res.status(400).json({ error: 'No active project. Open one first.', code: 'NO_ACTIVE_PROJECT' });
      }
      const v = evaluate(auth.user, id, { minRole, cap });
      if (!v.ok) {
        if (v.http === 401) return deny401(res, req);
        if (v.http === 404) return deny404(res);
        return deny403(res, v.code, v.error);
      }
      req.project = { id: String(id), dir: projectDirFor(String(id)), role: v.role, row: v.row };
      next();
    };
    mw.isAuthGuard = `requireProject(${minRole},${from === 'active' ? 'active' : from === 'param' ? 'param' : 'custom'})`;
    // WP-13 (FE-019, ARC-004): read back from the route table to compute the client's `can` map (services/permissions.ts)
    mw.minRole = minRole; mw.cap = cap;
    return mw;
  }

  // Explicitly-public routes carry their reason as a marker the static test
  // can read. Authenticating middlewares never sit behind these.
  function publicRoute(reason) {
    if (!reason || typeof reason !== 'string') throw new Error('publicRoute requires a stated reason');
    const mw = function publicRouteMarker(req, res, next) { next(); };
    mw.isPublicMarker = reason;
    return mw;
  }

  // WebSocket upgrades authenticate from the SAME cookie + session store.
  function authForUpgrade(req) {
    return sessions.resolveFromCookieHeader(req.headers.cookie || '') || null;
  }

  return { evaluate, rulesFor, requireAuth, requireAdmin, requireRoles, requireGlobal, requireProject, publicRoute, authForUpgrade, resolveAuth, ROLE_RANK };
}

module.exports = { createAuthz, ROLE_RANK, PROJECT_ROLES, GLOBAL_CAPS };
