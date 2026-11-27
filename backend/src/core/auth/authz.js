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

function createAuthz({ store, sessions, workspaceDir, projectDirFor }) {
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
    /*
      The Common Information Repository's workspace (type 'CIR') belongs to everyone: any signed-in user can
      create and edit data modules in it - an Author as an editor, a Project Manager as a manager. Deleting
      is narrowed to Project Managers and administrators by the route that deletes (see project-content).
    */
    const isCir = row.type === 'CIR';
    if (!membership && !folderRole && !isAdmin && !isCir) {
      return { ok: false, http: 404, code: 'NOT_FOUND', error: 'Not found' };
    }
    const held = membership ? membership.role : null;
    const role = isAdmin ? 'owner'
      : isCir ? (user.role === 'project_manager' ? 'manager' : 'editor')
        : (ROLE_RANK[folderRole] || 0) > (ROLE_RANK[held] || 0) ? folderRole : held;

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
    if (have < need) {
      return { ok: false, http: 403, code: 'INSUFFICIENT_ROLE', error: 'You do not have permission to do that.' };
    }
    return { ok: true, role, row };
  }

  // ---- guard factories ----------------------------------------------------

  function requireAuth(opts = {}) {
    const mw = function requireAuthGuard(req, res, next) {
      const auth = resolveAuth(req);
      if (!auth) return deny401(res, req);
      const gate = gateCheck(auth.user, opts);
      if (gate) return deny403(res, gate.code, gate.error);
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
      next();
    };
    mw.isAuthGuard = `requireRoles(${roles.join(',')})`;
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

  return { evaluate, requireAuth, requireAdmin, requireRoles, requireProject, publicRoute, authForUpgrade, resolveAuth, ROLE_RANK };
}

module.exports = { createAuthz, ROLE_RANK, PROJECT_ROLES };
