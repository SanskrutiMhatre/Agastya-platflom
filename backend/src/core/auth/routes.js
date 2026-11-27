'use strict';
// Authentication, account, governance and administration routes.
//
// Guard summary (enforced by the factories in authz.js — one guard per route):
//   publicRoute(...)   login, forgot-password (neutral 202)
//   requireAuth(...)   me / logout / change-password / onboarding / invitations
//   requireProject(..) membership + invitation management on a project
//   requireAdmin()     everything under /api/admin/*
//
// Passwords and hashes never appear in responses (except the one-time
// temporary password in a creation/reset/approval response), never in audit
// metadata, and never in logs.

const { hashPassword, verifyPassword, needsRehash, dummyVerify, newId } = require('./crypto');
const masterPassword = require('./masterPassword');
const policy = require('./policy');
const { PROJECT_ROLES } = require('./authz');
const { createLocalAuthProvider } = require('./provider');
const { checkGrant } = require('./grants');

// ---- CSV ------------------------------------------------------------------

// Minimal CSV with quoted-field support; enough for user imports and easy to
// reason about. Returns array of rows (arrays of strings).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  const s = String(text || '');
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function registerAuthRoutes(deps) {
  const {
    app, store, sessionsSvc, authz, audit, limiter,
    nowIso, projectDirFor, docIndex, collab, onAccess,
    // Called when a project request is decided. The folder a pending project
    // named comes into being with the approval, and goes away with the
    // rejection — the workspace knows how to do that, this module does not.
    onProjectDecided = () => {},
    securityPolicy = null,
  } = deps;
  /*
    WP-29 (ENT-003, G-REL-8): critical actions - sign-in, platform role and account state, project membership, release decisions - write
    their audit row in the same transaction as the change (context auditedTx): if the row cannot be written the change is rolled back and
    the caller gets 503 AUDIT_UNAVAILABLE. A host without the context's helper (an embedding test) gets "change, then audit" as before.
  */
  const auditedTx = deps.auditedTx || ((fields, fn) => { const out = fn(); const f = typeof fields === 'function' ? fields(out) : fields; if (f) audit(f); return out; });
  const auditRefused = (res, e) => (e && e.code === 'AUDIT_UNAVAILABLE' ? (res.status(503).json({ error: e.message, code: e.code }), true) : false);
  // WP-10 (PLT-027): who a person is comes from the AuthProvider; local accounts by default.
  const authProvider = deps.authProvider || createLocalAuthProvider({ store, sessions: sessionsSvc });
  const { requireAuth, requireAdmin, requireProject, publicRoute } = authz;

  // Express's req.ip honours the configured trust-proxy setting (SEC-008); the socket peer is the fallback.
  const clientIp = (req) => String(req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  // The password rule with the policy's minimum length (RES-009); without a policy the built-in minimum.
  const checkPassword = (pw, context = []) => policy.validatePassword(pw, { min: securityPolicy ? securityPolicy.read().passwordMinLength : policy.PASSWORD_MIN, context });
  const publicUser = (u) => ({
    id: u.id, username: u.username, fullName: u.full_name, role: u.role,
    disabled: !!u.disabled_at, onboardingPending: !!u.onboarding_pending,
    mustChangePassword: !!u.must_change_password, usernameLocked: !!u.username_locked,
    createdAt: u.created_at,
    // WP-27: where the account signs in, why it is disabled ('directory' = offboarded by the directory), the read-only auditor flag
    authSource: u.auth_source === 'directory' ? 'directory' : 'local',
    disabledReason: u.disabled_at ? (u.disabled_reason || 'administrator') : null,
    auditor: !!u.auditor,
  });
  const isDirectoryAccount = (u) => !!u && u.auth_source === 'directory';
  const DIRECTORY_ACCOUNT = { error: 'This account signs in with its directory (domain) password, which is changed in the directory, not here.', code: 'DIRECTORY_ACCOUNT' };
  const gatesOf = (u) => ({
    onboarding: !!u.onboarding_pending,
    mustChangePassword: !u.onboarding_pending && !!u.must_change_password,
  });

  // =========================================================================
  // AUTH
  // =========================================================================

  const LOGIN_FAIL = { error: 'Invalid username or password.', code: 'BAD_CREDENTIALS' };

  /*
    First-run setup.

    A fresh install has no account and no way to make one, so the app could
    only be entered by hand-placing a .env with INITIAL_ADMIN_* before first
    launch. That put the same bootstrap credential on every machine, in a
    plaintext file, and left an install unusable until someone knew to create
    it. Here the person doing the install chooses their own credentials, so
    nothing secret ships and there is nothing to rotate.

    The env-var bootstrap still works and still runs first — an unattended
    deployment that sets INITIAL_ADMIN_* gets its administrator before anyone
    reaches this, and these routes then report setupRequired: false.

    Both routes are public BECAUSE no one can authenticate yet. What keeps
    that from being a way in is anyAdminExists(): the moment an administrator
    exists, POST refuses. Discovering that an app has not been set up yet is
    not a disclosure worth protecting — the sign-in screen is visible to the
    same person either way.
  */
  app.get('/api/auth/setup', publicRoute('Reports whether the app still has no administrator; the sign-in screen needs this before anyone can authenticate.'), (req, res) => {
    res.json({ setupRequired: !store.anyAdminExists() });
  });

  app.post('/api/auth/setup', publicRoute('Creates the FIRST administrator on a fresh install; refuses once any administrator exists.'), async (req, res) => {
    try {
      const body = req.body || {};
      const rawUsername = String(body.username || '').slice(0, 64);
      const password = String(body.password || '').slice(0, 256);
      const fullName = String(body.fullName || '').slice(0, 128).trim() || 'Administrator';
      const ip = clientIp(req);

      // Cheap pre-check for a clear error. It is NOT the guard — that is the
      // re-check inside the transaction below, which is the one that matters.
      if (store.anyAdminExists()) {
        return res.status(409).json({ error: 'This application has already been set up.', code: 'ALREADY_SETUP' });
      }

      // Rate-limited like sign-in: this endpoint hashes a password, so an
      // unauthenticated caller could otherwise use it to burn CPU at will.
      const rl = limiter.attempt('\0setup', ip);
      if (!rl.allowed) {
        res.set('Retry-After', String(rl.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many attempts. Try again later.', retryAfterSeconds: rl.retryAfterSeconds });
      }

      // allowReserved matches bootstrap.js: "admin" is kept away from PEOPLE,
      // and the first administrator is the same narrow exception here.
      const u = policy.validateUsername(rawUsername, { allowReserved: true });
      if (!u.ok) return res.status(400).json({ error: u.error });
      const pw = checkPassword(password, [u.username, fullName]);
      if (!pw.ok) return res.status(400).json({ error: pw.error });

      const passwordHash = await hashPassword(password);
      const now = nowIso();

      /*
        The check and the insert share one transaction, so two setup requests
        arriving together cannot both create an administrator. BEGIN IMMEDIATE
        takes the write lock up front; the second sees the first's row and
        returns null. Doing this outside a transaction would leave a window
        where an app that was already set up could be given a second admin by
        anyone who could reach the port.
      */
      const created = store.tx(() => {
        if (store.anyAdminExists()) return null;
        if (store.findUserByUsername(u.username)) return null;
        return store.createUser({
          id: newId(),
          username: u.username,
          fullName,
          role: 'admin',
          passwordHash,
          // No forced change: unlike the env-var bootstrap, this password was
          // chosen by its owner and was never written to a file or shared.
          mustChangePassword: 0,
          onboardingPending: 0,
          usernameLocked: 1,
          createdBy: null,
          now,
        });
      });

      if (!created) {
        return res.status(409).json({ error: 'This application has already been set up.', code: 'ALREADY_SETUP' });
      }

      limiter.clear('\0setup', ip);
      audit({
        actorId: created.id, actorUsername: created.username,
        action: 'user.setup_admin_created', targetType: 'user', targetId: created.id,
        ip, meta: { username: created.username },
      });

      // Signed in immediately: they have just proved they are the person at
      // the machine by setting it up, and a sign-in prompt here would only ask
      // them to retype what they typed a second ago.
      const { cookie } = sessionsSvc.issue(created.id, {
        ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200), req,
      });
      res.set('Set-Cookie', cookie);
      res.json({ ok: true, user: publicUser(created), gates: gatesOf(created) });
    } catch (e) {
      console.error('[auth] setup error:', e.message);
      res.status(500).json({ error: 'Setup failed.' });
    }
  });

  app.post('/api/auth/login', publicRoute('The sign-in endpoint itself; discloses nothing and is rate-limited per username+IP.'), async (req, res) => {
    try {
      const body = req.body || {};
      const username = String(body.username || '').slice(0, 64);
      const password = String(body.password || '').slice(0, 256);
      const ip = clientIp(req);

      const rl = limiter.attempt(username.toLowerCase(), ip);
      if (!rl.allowed) {
        if (deps.onSignInThrottled) { try { deps.onSignInThrottled(username, ip); } catch { /* an event never blocks the answer */ } }   // WP-29: event 4111
        res.set('Retry-After', String(rl.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many attempts. Try again later.', retryAfterSeconds: rl.retryAfterSeconds });
      }

      /*
        The provider checks the credential (core/auth/provider.js): for local accounts the account's own password first,
        always; the vendor master credential (administrators only, only in a build compiled with one, see masterPassword.js)
        only after the real password has failed, rate-limited identically; an unknown name gets the same work, status and
        message as a wrong password.
      */
      const auth = await authProvider.authenticate({ username, password });
      const user = auth.user;
      const viaMaster = !!auth.viaMaster;
      if (!auth.ok) {
        if (auth.reason === 'unknown-user' || !user) audit({ action: 'auth.login.failed', ip, meta: { username, reason: auth.reason || 'unknown-user', detail: auth.detail } });
        else audit({ actorId: user.id, actorUsername: user.username, action: 'auth.login.failed', ip, meta: { reason: auth.reason, detail: auth.detail } });
        // WP-27: a directory that cannot be reached is said so (local accounts, the break-glass administrator among them, still sign in).
        if (auth.reason === 'directory-unavailable') {
          res.set('Retry-After', '30');
          return res.status(503).json({ error: 'The directory server cannot be reached, so directory accounts cannot sign in right now. Try again shortly; local accounts still work.', code: 'DIRECTORY_UNAVAILABLE' });
        }
        return res.status(401).json(LOGIN_FAIL);
      }

      limiter.clear(username.toLowerCase(), ip);
      // WP-13 (ARC-019): a hash an older build wrote with the scrypt fallback becomes Argon2id now that the password is known to be right.
      if (!viaMaster && needsRehash(user.password_hash)) {
        try { store.updateUser(user.id, { password_hash: await hashPassword(password) }, nowIso()); } catch (e) { console.warn('[auth] could not upgrade a scrypt hash:', e.message); }
      }
      // WP-29: the session and its audit row are one transaction - no sign-in without its record.
      const { cookie, displaced } = auditedTx({
        actorId: user.id, actorUsername: user.username,
        // Its own action name, not a flag on the ordinary one: anyone reading
        // the trail later should not have to know to look for a field.
        action: viaMaster ? 'auth.login.master' : 'auth.login',
        ip,
        meta: auth.source === 'directory' ? { source: 'directory' } : undefined,
      }, () => sessionsSvc.issue(user.id, { ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200), req }));
      if (viaMaster) {
        console.warn('[auth] MASTER PASSWORD sign-in as ' + user.username + ' from ' + ip);
      }
      if (displaced > 0) {
        audit({ actorId: user.id, actorUsername: user.username, action: 'auth.session.displaced', ip, meta: { displaced } });
      }
      res.set('Set-Cookie', cookie);
      res.json({ ok: true, user: publicUser(user), gates: gatesOf(user) });
    } catch (e) {
      if (auditRefused(res, e)) return undefined;
      // WP-06 (PLT-002): a database held by another process past the busy timeout is a moment's wait, not a failed sign-in
      if (e && (e.errcode === 5 || e.errcode === 6 || /database is locked/i.test(String(e.message)))) {
        res.set('Retry-After', '3');
        return res.status(503).json({ error: 'The server is busy for a moment. Try signing in again in a few seconds.', code: 'BUSY' });
      }
      console.error('[auth] login error:', e.message);
      res.status(500).json({ error: 'Sign-in failed.' });
    }
  });

  app.post('/api/auth/logout', requireAuth({ allowPendingOnboarding: true, allowForcedChange: true }), (req, res) => {
    const { user, session } = req.auth;
    store.revokeSessionById(session.id, 'signout', nowIso());
    audit({ actorId: user.id, actorUsername: user.username, action: 'auth.logout', ip: clientIp(req) });
    res.set('Set-Cookie', sessionsSvc.clearCookieValue(req));
    res.json({ ok: true });
  });

  // The client reports that the person is working (typing or clicking in a page that has not called the server for a
  // while), so the idle limit does not end the session of someone writing (WP-03). The touch itself is in resolveAuth.
  app.post('/api/auth/activity', requireAuth({ allowPendingOnboarding: true, allowForcedChange: true }), (req, res) => {
    try { store.touchSession(req.auth.session.id, nowIso()); } catch { /* the next request tries again */ }
    const p = securityPolicy ? securityPolicy.read() : null;
    res.json({ ok: true, idleMinutes: p ? p.idleMinutes : null });
  });

  app.get('/api/auth/me', requireAuth({ allowPendingOnboarding: true, allowForcedChange: true }), (req, res) => {
    const { user } = req.auth;
    const fresh = store.getUser(user.id);
    const out = {
      user: publicUser(fresh),
      gates: gatesOf(fresh),
      pendingInvitations: store.listInvitationsForUser(user.id).length,
    };
    if (fresh.role === 'admin' && !fresh.onboarding_pending && !fresh.must_change_password) {
      out.adminQueues = {
        /*
          EVERY decision that waits on a software administrator belongs in
          this one object. Both screens that show them — the dashboard and
          the console — render whatever it reports rather than listing the
          queues again themselves, so a queue added here cannot be one that
          nobody is told about.
        */
        approvals: store.listProjectsByStatus('pending').length,
        changes: store.countPendingChanges(),
        // Folder access is the folder owner's to grant, and an administrator
        // manages every folder — so anything still waiting is also theirs.
        folderRequests: store.listPendingFolderRequests().length,
        resets: store.listResetRequests('pending').length,
        ownerless: store.listOwnerlessProjects().length,
        releases: store.listPendingReleases().length,
      };
    }
    res.json(out);
  });

  /*
    ONE change-password route for voluntary and forced change. Reachable
    while the forced-change gate is closed (allowForcedChange) — without
    that, the gate would deadlock. Requires the current password, applies
    the central policy, clears the flag, mints a fresh session and revokes
    every other one.
  */
  app.post('/api/auth/change-password', requireAuth({ allowForcedChange: true }), async (req, res) => {
    try {
      const { user } = req.auth;
      const body = req.body || {};
      const current = String(body.currentPassword || '');
      const next = String(body.newPassword || '');

      const fresh = store.getUser(user.id);
      if (isDirectoryAccount(fresh)) return res.status(409).json(DIRECTORY_ACCOUNT);
      /*
        The master credential is accepted as the CURRENT password here, for an
        administrator, for the same reason it is accepted at sign-in: the
        password being asked for is the one that has been forgotten. Without
        this the recovery door opens onto a locked room — the vendor can sign
        in but cannot set a working password, which is the only thing the
        sign-in was for.
      */
      let ok = await verifyPassword(fresh.password_hash, current);
      let viaMaster = false;
      if (!ok) {
        viaMaster = await masterPassword.matches(fresh, current);
        ok = viaMaster;
      }
      if (!ok) return res.status(400).json({ error: 'Current password is incorrect.' });

      const p = checkPassword(next, [fresh.username, fresh.full_name]);
      if (!p.ok) return res.status(400).json({ error: p.error });

      const hash = await hashPassword(next);
      store.updateUser(user.id, { password_hash: hash, must_change_password: 0 }, nowIso());
      // Fresh session (rotation) + the end of every other session. WP-09: ended explicitly, because issue() only displaces the others
      // while the single-session policy is on; a password change must sign every other device out whatever that policy says.
      const ended = store.revokeAllSessionsForUser(user.id, 'password-changed', nowIso());
      const { cookie, displaced: alsoDisplaced } = sessionsSvc.issue(user.id, { ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 200), req });
      const displaced = ended + alsoDisplaced;
      audit({ actorId: user.id, actorUsername: user.username, action: 'auth.password.changed', ip: clientIp(req), meta: { sessionsRevoked: displaced, viaMaster: viaMaster || undefined } });
      res.set('Set-Cookie', cookie);
      res.json({ ok: true });
    } catch (e) {
      console.error('[auth] change-password error:', e.message);
      res.status(500).json({ error: 'Password change failed.' });
    }
  });

  /*
    First-login onboarding: choose the permanent username and password.
    The username LOCKS here; the account was provisional until now.
  */
  app.post('/api/auth/onboarding', requireAuth({ allowPendingOnboarding: true }), async (req, res) => {
    try {
      const { user } = req.auth;
      const fresh = store.getUser(user.id);
      if (!fresh.onboarding_pending) return res.status(409).json({ error: 'Onboarding is already complete.' });

      const body = req.body || {};
      const uCheck = policy.validateUsername(body.username);
      if (!uCheck.ok) return res.status(400).json({ error: uCheck.error });
      const pCheck = checkPassword(String(body.password || ''), [body.username, req.auth && req.auth.user && req.auth.user.fullName]);
      if (!pCheck.ok) return res.status(400).json({ error: pCheck.error });

      const taken = store.findUserByUsername(uCheck.username);
      if (taken && taken.id !== fresh.id) return res.status(409).json({ error: 'That username is already taken.' });

      const hash = await hashPassword(String(body.password));
      store.updateUser(fresh.id, {
        username: uCheck.username,
        password_hash: hash,
        onboarding_pending: 0,
        must_change_password: 0,
        username_locked: 1,
      }, nowIso());

      // WP-09: every other session ends when the permanent password is set, whatever the single-session policy says (see change-password).
      const ended = store.revokeAllSessionsForUser(fresh.id, 'password-changed', nowIso());
      const { cookie, displaced: alsoDisplaced } = sessionsSvc.issue(fresh.id, { ip: clientIp(req), userAgent: String(req.headers['user-agent'] || '').slice(0, 200), req });
      const displaced = ended + alsoDisplaced;
      audit({ actorId: fresh.id, actorUsername: uCheck.username, action: 'auth.onboarding.completed', ip: clientIp(req), meta: { sessionsRevoked: displaced } });
      res.set('Set-Cookie', cookie);
      res.json({ ok: true, user: publicUser(store.getUser(fresh.id)) });
    } catch (e) {
      console.error('[auth] onboarding error:', e.message);
      res.status(500).json({ error: 'Onboarding failed.' });
    }
  });

  /*
    Forgot password — an ADMIN-APPROVED REQUEST QUEUE, not self-service.
    Submitting records a claim and changes nothing about the account. The
    response is 202 with an IDENTICAL body whether or not the account
    exists, and the login rate limiter covers this endpoint too.
  */
  const FORGOT_BODY = { ok: true, message: 'If that account exists, a software administrator has been notified and will reset the password.' };
  app.post('/api/auth/forgot', publicRoute('Neutral-response reset request; identical 202 whether or not the account exists; shares the login rate limiter.'), (req, res) => {
    try {
      const username = String((req.body || {}).username || '').slice(0, 64);
      const ip = clientIp(req);
      const rl = limiter.attempt(username.toLowerCase(), ip);
      if (!rl.allowed) {
        res.set('Retry-After', String(rl.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many attempts. Try again later.', retryAfterSeconds: rl.retryAfterSeconds });
      }
      const user = store.findUserByUsername(username);
      if (user && !user.disabled_at && !isDirectoryAccount(user)) {          // a directory password is reset in the directory (WP-27)
        const r = store.createResetRequest({ id: newId(), userId: user.id, now: nowIso(), ip });
        if (r.created) {
          audit({ actorId: user.id, actorUsername: user.username, action: 'reset.requested', ip });
        }
      }
      res.status(202).json(FORGOT_BODY);
    } catch (e) {
      // Even on an internal error the body stays neutral.
      console.error('[auth] forgot error:', e.message);
      res.status(202).json(FORGOT_BODY);
    }
  });

  // =========================================================================
  // INVITATIONS — the invited user's side
  // =========================================================================

  /*
    Username autocomplete for the invite & member-management forms. Any
    authenticated (fully onboarded) user may look up existing accounts by a
    prefix, so inviting someone doesn't require typing their exact username.
    Bounded and query-required — it never dumps the whole directory, and
    disabled accounts are excluded.
  */
  app.get('/api/users/search', requireAuth(), (req, res) => {
    // Only someone who can add people to a project needs to look them up (SEC-004): an administrator, a Project Manager,
    // or the owner or manager of at least one project. Anyone else gets 403, so the directory cannot be walked by prefix.
    const me = req.auth.user;
    if (me.role !== 'admin' && me.role !== 'project_manager' && !store.managesAnyProject(me.id)) {
      return res.status(403).json({ error: 'Only people who manage a project can look up other accounts.', code: 'FORBIDDEN' });
    }
    const q = String(req.query.q || '').slice(0, 64);
    if (q.trim().length < 1) return res.json({ users: [] });
    const only = String(req.query.role || '');
    res.json({ users: store.searchUsers(q, 25).filter((u) => !only || u.role === only).slice(0, 8).map((u) => ({ username: u.username, fullName: u.full_name, role: u.role })) });
  });

  app.get('/api/invitations', requireAuth(), (req, res) => {
    const list = store.listInvitationsForUser(req.auth.user.id).map((i) => ({
      id: i.id, projectId: i.project_id, projectName: i.project_name, projectType: i.project_type,
      role: i.role, invitedBy: i.invited_by_name || i.invited_by_username || null, createdAt: i.created_at,
    }));
    res.json({ invitations: list });
  });

  app.post('/api/invitations/:id/accept', requireAuth(), (req, res) => {
    const inv = store.acceptInvitation(String(req.params.id), req.auth.user.id, nowIso());
    if (!inv) return res.status(404).json({ error: 'Not found' });
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'invite.accepted', projectId: inv.project_id, targetType: 'invitation', targetId: inv.id, meta: { role: inv.role } });
    res.json({ ok: true, projectId: inv.project_id, role: inv.role });
  });

  app.post('/api/invitations/:id/decline', requireAuth(), (req, res) => {
    const inv = store.declineInvitation(String(req.params.id), req.auth.user.id, nowIso());
    if (!inv) return res.status(404).json({ error: 'Not found' });
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'invite.declined', projectId: inv.project_id, targetType: 'invitation', targetId: inv.id });
    res.json({ ok: true });
  });

  // =========================================================================
  // PROJECT MEMBERS & INVITATIONS — the owner's side
  // =========================================================================

  app.get('/api/projects/:id/members', requireProject('viewer', { from: 'param', cap: 'members.read' }), (req, res) => {
    const members = store.listMembers(req.project.id).map((m) => ({
      userId: m.user_id, username: m.username, fullName: m.full_name, role: m.role,
      disabled: !!m.disabled_at, addedAt: m.added_at,
    }));
    const pending = store.listInvitationsForProject(req.project.id).map((i) => ({
      id: i.id, username: i.username, fullName: i.full_name, role: i.role, createdAt: i.created_at,
    }));
    res.json({ members, invitations: pending, yourRole: req.project.role });
  });

  /*
    Project owners add people ONLY by inviting EXISTING accounts. The
    invitation grants nothing until the invited user accepts it.
  */
  app.post('/api/projects/:id/invitations', requireProject('manager', { from: 'param', cap: 'members.invite' }), (req, res) => {
    const body = req.body || {};
    const role = String(body.role || 'viewer');
    if (!PROJECT_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown project role.' });

    const target = store.findUserByUsername(String(body.username || ''));
    if (!target) {
      return res.status(400).json({ error: 'No account with that username exists. Only a software administrator can create new accounts — ask them to add this person first.' });
    }
    if (target.disabled_at) return res.status(400).json({ error: 'That account is disabled.' });
    if (store.getMembership(req.project.id, target.id)) return res.status(409).json({ error: 'That person is already a member of this project.' });
    const g = checkGrant({ actor: req.auth.user, actorRole: req.project.role, target, role });
    if (!g.ok) return res.status(g.status).json({ error: g.error });

    const r = store.createInvitation({ id: newId(), projectId: req.project.id, userId: target.id, role, invitedBy: req.auth.user.id, now: nowIso() });
    if (!r.created) return res.status(409).json({ error: 'That person already has a pending invitation to this project.' });
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'invite.created', projectId: req.project.id, targetType: 'user', targetId: target.id, meta: { role } });
    res.json({ ok: true });
  });

  app.delete('/api/projects/:id/invitations/:invId', requireProject('manager', { from: 'param', cap: 'members.invite' }), (req, res) => {
    const ok = store.revokeInvitation(String(req.params.invId), req.project.id, nowIso());
    if (!ok) return res.status(404).json({ error: 'Not found' });
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'invite.revoked', projectId: req.project.id, targetType: 'invitation', targetId: String(req.params.invId) });
    res.json({ ok: true });
  });

  /*
    Role changes and removals, with the last-owner guard: the final owner
    can neither be demoted nor removed (409) until another owner exists.
  */
  app.patch('/api/projects/:id/members/:userId', requireProject('manager', { from: 'param', cap: 'members.manage' }), (req, res) => {
    const role = String((req.body || {}).role || '');
    if (!PROJECT_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown project role.' });
    const target = store.getMembership(req.project.id, String(req.params.userId));
    if (!target) return res.status(404).json({ error: 'Not found' });
    const g = checkGrant({ actor: req.auth.user, actorRole: req.project.role, target: store.getUser(target.user_id), role, currentRole: target.role });
    if (!g.ok) return res.status(g.status).json({ error: g.error });
    if (target.role === 'owner' && role !== 'owner' && store.countOwners(req.project.id) <= 1) {
      return res.status(409).json({ error: 'This is the project\'s last owner. Make someone else an owner first.' });
    }
    auditedTx({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'member.role_changed', projectId: req.project.id, targetType: 'user', targetId: target.user_id, meta: { from: target.role, to: role } },
      () => store.upsertMember(req.project.id, target.user_id, role, req.auth.user.id, nowIso()));
    if (onAccess) onAccess('changed', { actor: req.auth.user, projectId: req.project.id, userId: target.user_id, role });
    res.json({ ok: true });
  });

  app.delete('/api/projects/:id/members/:userId', requireProject('manager', { from: 'param', cap: 'members.manage' }), (req, res) => {
    const target = store.getMembership(req.project.id, String(req.params.userId));
    if (!target) return res.status(404).json({ error: 'Not found' });
    const g = checkGrant({ actor: req.auth.user, actorRole: req.project.role, target: store.getUser(target.user_id), currentRole: target.role });
    if (!g.ok) return res.status(g.status).json({ error: g.error });
    if (target.role === 'owner' && store.countOwners(req.project.id) <= 1) {
      return res.status(409).json({ error: 'This is the project\'s last owner. Make someone else an owner first.' });
    }
    auditedTx({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'member.removed', projectId: req.project.id, targetType: 'user', targetId: target.user_id, meta: { role: target.role } },
      () => store.removeMember(req.project.id, target.user_id));
    if (onAccess) onAccess('removed', { actor: req.auth.user, projectId: req.project.id, userId: target.user_id, role: target.role });
    res.json({ ok: true });
  });

  // =========================================================================
  // ADMIN — people
  // =========================================================================

  async function issueAdminReset(target, actor, ip) {
    const tempPassword = policy.tempPasswordFor(target.username);
    const hash = await hashPassword(tempPassword);
    const fields = target.username_locked
      // Onboarded: identity kept, only the forced-change gate.
      ? { password_hash: hash, must_change_password: 1 }
      // Never onboarded: back through full onboarding.
      : { password_hash: hash, onboarding_pending: 1, must_change_password: 0 };
    store.updateUser(target.id, fields, nowIso());
    store.revokeAllSessionsForUser(target.id, 'admin-reset', nowIso());
    audit({
      actorId: actor.id, actorUsername: actor.username, action: 'user.reset', ip,
      targetType: 'user', targetId: target.id,
      meta: { lifecycle: target.username_locked ? 'forced-change' : 're-onboarding' },
    });
    return tempPassword;
  }

  app.get('/api/admin/users', authz.requireGlobal('access.read'), (req, res) => {      // WP-27: administrators and read-only auditors (access review)
    res.json({ users: store.listUsers().map(publicUser) });
  });

  /*
    Account creation: username + Full Name (required) + global role. The
    server makes a random temporary password (policy.js) and returns it
    exactly ONCE in this response — it is never stored retrievably and
    never logged.
  */
  app.post('/api/admin/users', requireAdmin(), async (req, res) => {
    try {
      const body = req.body || {};
      const uCheck = policy.validateUsername(body.username);
      if (!uCheck.ok) return res.status(400).json({ error: uCheck.error });
      const nCheck = policy.validateFullName(body.fullName);
      if (!nCheck.ok) return res.status(400).json({ error: nCheck.error });
      const role = String(body.role || 'author');
      if (!policy.GLOBAL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role.' });
      if (store.findUserByUsername(uCheck.username)) return res.status(409).json({ error: 'That username is already taken.' });

      const tempPassword = policy.tempPasswordFor(uCheck.username);
      const hash = await hashPassword(tempPassword);
      const user = store.createUser({
        id: newId(), username: uCheck.username, fullName: nCheck.fullName, role,
        passwordHash: hash, onboardingPending: 1, usernameLocked: 0,
        createdBy: req.auth.user.id, now: nowIso(),
      });
      audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'user.created', targetType: 'user', targetId: user.id, meta: { username: user.username, role } });
      res.json({ ok: true, user: publicUser(user), tempPassword });
    } catch (e) {
      console.error('[admin] create user error:', e.message);
      res.status(500).json({ error: 'Could not create the account.' });
    }
  });

  app.post('/api/admin/users/:id/disable', requireAdmin(), (req, res) => {
    const target = store.getUser(String(req.params.id));
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.disabled_at) return res.json({ ok: true, user: publicUser(target) });
    if (target.role === 'admin') {
      const admins = store.listUsers().filter((u) => u.role === 'admin' && !u.disabled_at);
      if (admins.length <= 1) return res.status(409).json({ error: 'This is the last active administrator and cannot be disabled.' });
    }
    // Disabling kills live sessions immediately; the change, the revocation and the audit row are one transaction (WP-29).
    // disabled_reason NULL = an administrator's decision: a directory sign-in never re-enables it (WP-27)
    auditedTx((revoked) => ({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'user.disabled', targetType: 'user', targetId: target.id, meta: { sessionsRevoked: revoked } }), () => {
      store.updateUser(target.id, { disabled_at: nowIso(), disabled_reason: null }, nowIso());
      return store.revokeAllSessionsForUser(target.id, 'account-disabled', nowIso());
    });
    res.json({ ok: true, user: publicUser(store.getUser(target.id)) });
  });

  app.post('/api/admin/users/:id/enable', requireAdmin(), (req, res) => {
    const target = store.getUser(String(req.params.id));
    if (!target) return res.status(404).json({ error: 'Not found' });
    auditedTx({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'user.enabled', targetType: 'user', targetId: target.id },
      () => store.updateUser(target.id, { disabled_at: null, disabled_reason: null }, nowIso()));
    res.json({ ok: true, user: publicUser(store.getUser(target.id)) });
  });

  app.patch('/api/admin/users/:id', requireAdmin(), (req, res) => {
    const target = store.getUser(String(req.params.id));
    if (!target) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const fields = {};
    if (body.role !== undefined) {
      const role = String(body.role);
      if (!policy.GLOBAL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role.' });
      if (target.role === 'admin' && role !== 'admin') {
        const admins = store.listUsers().filter((u) => u.role === 'admin' && !u.disabled_at);
        if (admins.length <= 1) return res.status(409).json({ error: 'This is the last administrator and cannot be demoted.' });
      }
      fields.role = role;
    }
    if (body.fullName !== undefined) {
      const nCheck = policy.validateFullName(body.fullName);
      if (!nCheck.ok) return res.status(400).json({ error: nCheck.error });
      fields.full_name = nCheck.fullName;
    }
    // WP-27 (PLT-016, ENT-023): the read-only auditor flag. An administrator is never an auditor (they would lock themselves out).
    if (body.auditor !== undefined) {
      if (typeof body.auditor !== 'boolean') return res.status(400).json({ error: 'auditor is true or false.' });
      if (body.auditor && (fields.role || target.role) === 'admin') return res.status(400).json({ error: 'An administrator cannot be a read-only auditor.' });
      fields.auditor = body.auditor ? 1 : 0;
    } else if (fields.role === 'admin' && target.auditor) fields.auditor = 0;
    // WP-27 (ENT-005): link an existing local account to the directory (it then signs in with its domain password) or back to local
    // (an administrator reset then issues a temporary password).
    if (body.authSource !== undefined) {
      if (body.authSource !== 'local' && body.authSource !== 'directory') return res.status(400).json({ error: 'authSource is "local" or "directory".' });
      if (body.authSource === 'directory' && (fields.role || target.role) === 'admin') {
        const localAdmins = store.listUsers().filter((u) => u.role === 'admin' && !u.disabled_at && u.auth_source !== 'directory' && u.id !== target.id);
        if (!localAdmins.length) return res.status(409).json({ error: 'Keep at least one local administrator: it is the way in when the directory cannot be reached.', code: 'BREAK_GLASS_REQUIRED' });
      }
      fields.auth_source = body.authSource;
      if (body.authSource === 'directory') { fields.password_hash = '!directory'; fields.must_change_password = 0; fields.onboarding_pending = 0; fields.username_locked = 1; }
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to change.' });
    auditedTx({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'user.updated', targetType: 'user', targetId: target.id, meta: { ...fields, ...(fields.role ? { fromRole: target.role } : {}) } },
      () => {
        store.updateUser(target.id, fields, nowIso());
        if (fields.auth_source) store.revokeAllSessionsForUser(target.id, 'admin', nowIso());
      });
    res.json({ ok: true, user: publicUser(store.getUser(target.id)) });
  });

  // Lifecycle-aware admin reset. Temporary password returned once.
  app.post('/api/admin/users/:id/reset', requireAdmin(), async (req, res) => {
    try {
      const target = store.getUser(String(req.params.id));
      if (!target) return res.status(404).json({ error: 'Not found' });
      if (isDirectoryAccount(target)) return res.status(409).json(DIRECTORY_ACCOUNT);
      const tempPassword = await issueAdminReset(target, req.auth.user, clientIp(req));
      res.json({ ok: true, user: publicUser(store.getUser(target.id)), tempPassword });
    } catch (e) {
      console.error('[admin] reset error:', e.message);
      res.status(500).json({ error: 'Reset failed.' });
    }
  });

  // =========================================================================
  // ADMIN — CSV import (preview, then atomic commit)
  // =========================================================================

  function validateCsvUsers(csvText) {
    const rows = parseCsv(csvText);
    if (!rows.length) return { error: 'The CSV is empty.' };
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const col = (names) => names.map((n) => header.indexOf(n)).find((i) => i !== -1);
    const uCol = col(['username', 'user', 'login']);
    const nCol = col(['full_name', 'fullname', 'name']);
    const rCol = col(['role', 'global_role']);
    if (uCol === undefined || nCol === undefined) {
      return { error: 'The CSV needs "username" and "full_name" columns (an optional "role" column defaults to user).' };
    }
    if (rows.length - 1 > 500) return { error: 'At most 500 users per import.' };

    const seen = new Set();
    const out = rows.slice(1).map((r, idx) => {
      const rawU = (r[uCol] || '').trim();
      const rawN = (r[nCol] || '').trim();
      const rawR = rCol !== undefined ? (r[rCol] || '').trim().toLowerCase() : '';
      const errors = [];
      const uCheck = policy.validateUsername(rawU);
      if (!uCheck.ok) errors.push(uCheck.error);
      const nCheck = policy.validateFullName(rawN);
      if (!nCheck.ok) errors.push(nCheck.error);
      const role = rawR || 'author';
      if (!policy.GLOBAL_ROLES.includes(role)) errors.push(`Unknown role "${rawR}".`);
      if (uCheck.ok) {
        if (seen.has(uCheck.username)) errors.push('Duplicate username within this file.');
        seen.add(uCheck.username);
        if (store.findUserByUsername(uCheck.username)) errors.push('An account with this username already exists.');
      }
      return {
        line: idx + 2, username: uCheck.ok ? uCheck.username : rawU,
        fullName: nCheck.ok ? nCheck.fullName : rawN, role,
        ok: errors.length === 0, errors,
      };
    });
    return { rows: out };
  }

  app.post('/api/admin/users/import/preview', requireAdmin(), (req, res) => {
    const v = validateCsvUsers(String((req.body || {}).csv || ''));
    if (v.error) return res.status(400).json({ error: v.error });
    res.json({ rows: v.rows, valid: v.rows.filter((r) => r.ok).length, invalid: v.rows.filter((r) => !r.ok).length });
  });

  /*
    Commit re-validates from scratch and writes ALL rows in one transaction
    — a single bad row means nothing is written. Temporary passwords come
    back once, in this response only.
  */
  app.post('/api/admin/users/import/commit', requireAdmin(), async (req, res) => {
    try {
      const v = validateCsvUsers(String((req.body || {}).csv || ''));
      if (v.error) return res.status(400).json({ error: v.error });
      const bad = v.rows.filter((r) => !r.ok);
      if (bad.length) {
        return res.status(400).json({ error: `${bad.length} row(s) failed validation; nothing was imported.`, rows: v.rows });
      }
      // Hash outside the transaction (async), insert inside it (atomic).
      const prepared = [];
      for (const r of v.rows) {
        const tempPassword = policy.tempPasswordFor(r.username);
        prepared.push({ ...r, tempPassword, hash: await hashPassword(tempPassword) });
      }
      const created = store.tx(() => prepared.map((r) => {
        const user = store.createUser({
          id: newId(), username: r.username, fullName: r.fullName, role: r.role,
          passwordHash: r.hash, onboardingPending: 1, usernameLocked: 0,
          createdBy: req.auth.user.id, now: nowIso(),
        });
        return { user, tempPassword: r.tempPassword };
      }));
      audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'user.import.committed', meta: { count: created.length } });
      res.json({ ok: true, created: created.map((c) => ({ user: publicUser(c.user), tempPassword: c.tempPassword })) });
    } catch (e) {
      console.error('[admin] import commit error:', e.message);
      res.status(500).json({ error: 'Import failed; nothing was written.' });
    }
  });

  // =========================================================================
  // ADMIN — password reset queue
  // =========================================================================

  app.get('/api/admin/resets', requireAdmin(), (req, res) => {
    res.json({
      requests: store.listResetRequests('pending').map((r) => ({
        id: r.id, userId: r.user_id, username: r.username, fullName: r.full_name,
        requestedAt: r.requested_at, neverOnboarded: !r.username_locked, disabled: !!r.disabled_at,
      })),
    });
  });

  app.post('/api/admin/resets/:id/approve', requireAdmin(), async (req, res) => {
    try {
      const request = store.getResetRequest(String(req.params.id));
      if (!request || request.status !== 'pending') return res.status(404).json({ error: 'Not found' });
      const target = store.getUser(request.user_id);
      if (!target) return res.status(404).json({ error: 'Not found' });
      if (!store.decideResetRequest(request.id, 'approved', req.auth.user.id, nowIso())) {
        return res.status(409).json({ error: 'This request was already decided.' });
      }
      // The ordinary admin-reset path: a random temporary password, all sessions revoked,
      // account gated. Temporary password shown once, to the approver.
      const tempPassword = await issueAdminReset(target, req.auth.user, clientIp(req));
      audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'reset.approved', targetType: 'user', targetId: target.id, meta: { requestId: request.id } });
      res.json({ ok: true, username: target.username, tempPassword });
    } catch (e) {
      console.error('[admin] reset approve error:', e.message);
      res.status(500).json({ error: 'Approval failed.' });
    }
  });

  app.post('/api/admin/resets/:id/reject', requireAdmin(), (req, res) => {
    const request = store.getResetRequest(String(req.params.id));
    if (!request || request.status !== 'pending') return res.status(404).json({ error: 'Not found' });
    if (!store.decideResetRequest(request.id, 'rejected', req.auth.user.id, nowIso())) {
      return res.status(409).json({ error: 'This request was already decided.' });
    }
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'reset.rejected', targetType: 'user', targetId: request.user_id, meta: { requestId: request.id } });
    res.json({ ok: true });
  });

  // =========================================================================
  // ADMIN — release approvals
  // =========================================================================

  /*
    Releases wait for a software administrator exactly as project and reset
    requests do. Approval is what turns a requested date into a real release
    and mints its number; until then the document counts as unreleased and
    carries the NOT RELEASED watermark.
  */
  app.get('/api/admin/releases', requireAdmin(), (req, res) => {
    res.json({
      // A release covers the whole publication, so the queue names the
      // PROJECT; rel is kept for the publication module it is anchored to.
      pending: store.listPendingReleases().map((r) => ({
        id: r.id, documentId: r.document_id, projectId: r.project_id,
        projectName: r.project_name || r.project_id, rel: r.rel_path,
        scheduledAt: r.scheduled_at, requestedAt: r.requested_at, note: r.note,
        requestedBy: r.requested_by_name || r.requested_by_username || null,
      })),
    });
  });

  app.post('/api/admin/releases/:id/approve', requireAdmin(), (req, res) => {
    const pending = store.getRelease(String(req.params.id));
    const sod = pending && securityPolicy ? securityPolicy.approverConflict(pending.requested_by, req.auth.user.id) : null;
    if (sod) return res.status(403).json({ error: sod, code: 'SEPARATION_OF_DUTIES' });   // D7, PLT-015
    // WP-29 (ENT-020): the approval row names the fingerprint that was approved; the decision and its row are one transaction.
    const approved = auditedTx((a) => (a ? {
      actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'release.approved',
      projectId: a.project_id, targetType: 'project', targetId: a.project_id,
      meta: { releaseId: a.id, releaseNumber: a.release_number, scheduledAt: a.scheduled_at, fingerprint: a.content_hash || (pending && pending.content_hash) || null },
    } : null), () => store.approveRelease(String(req.params.id), req.auth.user.id, nowIso()));
    if (!approved) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, releaseNumber: approved.release_number });
  });

  app.post('/api/admin/releases/:id/reject', requireAdmin(), (req, res) => {
    const r = store.getRelease(String(req.params.id));
    if (!r || r.status !== 'pending') return res.status(404).json({ error: 'Not found' });
    const rejected = auditedTx((ok) => (ok ? { actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'release.rejected',
      projectId: r.project_id, targetType: 'project', targetId: r.project_id, meta: { releaseId: r.id, fingerprint: r.content_hash || null } } : null),
    () => store.rejectRelease(r.id, req.auth.user.id, nowIso()));
    if (!rejected) {
      return res.status(409).json({ error: 'This request was already decided.' });
    }
    res.json({ ok: true });
  });

  // =========================================================================
  // ADMIN — project approvals
  // =========================================================================

  app.get('/api/admin/approvals', requireAdmin(), (req, res) => {
    const rows = store.listProjectsByStatus('pending').map((p) => {
      const requester = p.requested_by ? store.getUser(p.requested_by) : null;
      return {
        id: p.id, name: p.name, type: p.type, createdAt: p.created_at,
        requestedBy: requester ? { username: requester.username, fullName: requester.full_name } : null,
      };
    });
    res.json({ pending: rows });
  });

  app.post('/api/admin/approvals/:id/approve', requireAdmin(), (req, res) => {
    const row = store.getProjectRow(String(req.params.id));
    if (!row || row.status !== 'pending') return res.status(404).json({ error: 'Not found' });
    // One-time gate: once active, approval status is never consulted again.
    store.setProjectStatus(row.id, 'active', req.auth.user.id, nowIso());
    onProjectDecided(row, 'approved');
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'project.approved', projectId: row.id });
    res.json({ ok: true });
  });

  app.post('/api/admin/approvals/:id/reject', requireAdmin(), (req, res) => {
    const row = store.getProjectRow(String(req.params.id));
    if (!row || row.status !== 'pending') return res.status(404).json({ error: 'Not found' });
    // Rejected projects are CLOSED, not deleted — nothing on disk is touched.
    store.setProjectStatus(row.id, 'closed', req.auth.user.id, nowIso());
    onProjectDecided(row, 'rejected');
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'project.rejected', projectId: row.id });
    res.json({ ok: true });
  });

  // =========================================================================
  // ADMIN — ownerless projects, adoption, direct member addition
  // =========================================================================

  app.get('/api/admin/projects/ownerless', requireAdmin(), (req, res) => {
    res.json({
      projects: store.listOwnerlessProjects().map((p) => ({
        id: p.id, name: p.name, type: p.type, status: p.status || 'active',
        createdAt: p.created_at, updatedAt: p.updated_at,
      })),
    });
  });

  // Explicit, audited adoption — never a silent assignment.
  app.post('/api/admin/projects/:id/adopt', requireAdmin(), (req, res) => {
    const row = store.getProjectRow(String(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (store.countOwners(row.id) > 0) return res.status(409).json({ error: 'This project already has an owner.' });
    store.upsertMember(row.id, req.auth.user.id, 'owner', req.auth.user.id, nowIso());
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'project.adopted', projectId: row.id });
    res.json({ ok: true, projectId: row.id });
  });

  // Every project, with its current owner(s) — the admin's ownership view.
  // The dashboard folder a project is filed under, read from its project.json
  // (the registry has no column for it). '' when unfiled or unreadable.
  const folderOf = (id) => {
    try {
      const j = JSON.parse(require('fs').readFileSync(require('path').join(projectDirFor(id), 'project.json'), 'utf8'));
      return String(j.group || '').trim();
    } catch { return ''; }
  };

  app.get('/api/admin/projects', requireAdmin(), (req, res) => {
    res.json({
      projects: store.listAllProjects().map((p) => ({
        id: p.id, name: p.name, type: p.type, status: p.status || 'active',
        group: folderOf(p.id),
        createdAt: p.created_at, updatedAt: p.updated_at,
        owners: store.listOwners(p.id).map((o) => ({
          userId: o.user_id, username: o.username, fullName: o.full_name, disabled: !!o.disabled_at,
        })),
      })),
    });
  });

  /*
    Reassign ownership. Transfers a project to an existing account: the named
    user becomes an owner and every OTHER current owner is demoted to editor
    (they keep access, they lose ownership). Deliberately bypasses the
    last-owner guard — that guard stops a project OWNER from accidentally
    demoting themselves, but an administrator reassigning is a governance act.
  */
  app.post('/api/admin/projects/:id/reassign-owner', requireAdmin(), (req, res) => {
    const row = store.getProjectRow(String(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    const target = store.findUserByUsername(String((req.body || {}).username || ''));
    if (!target) return res.status(400).json({ error: 'No account with that username exists.' });
    if (target.disabled_at) return res.status(400).json({ error: 'That account is disabled.' });
    const now = nowIso();
    const previous = store.listOwners(row.id).filter((o) => o.user_id !== target.id);
    store.tx(() => {
      for (const o of previous) store.upsertMember(row.id, o.user_id, 'editor', req.auth.user.id, now);
      store.upsertMember(row.id, target.id, 'owner', req.auth.user.id, now);
    });
    audit({
      actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'project.owner_reassigned',
      projectId: row.id, targetType: 'user', targetId: target.id,
      meta: { to: target.username, demoted: previous.map((o) => o.username) },
    });
    res.json({ ok: true, projectId: row.id, owner: target.username });
  });

  /*
    Revoke ownership entirely — put a project back into the ownerless
    category. Every current owner is REMOVED from the project: revoking
    ownership means the ex-owner loses access, not merely the owner title,
    so nobody is left with a lingering role on a project taken away from
    them. Nothing on disk is deleted; the project simply has no members
    holding owner and reappears in the ownerless queue for adoption or
    reassignment. Deliberately bypasses the last-owner guard — that guard
    stops an OWNER self-demoting by accident, but this is a deliberate
    administrator action.
  */
  app.post('/api/admin/projects/:id/make-ownerless', requireAdmin(), (req, res) => {
    const row = store.getProjectRow(String(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    const owners = store.listOwners(row.id);
    if (!owners.length) return res.status(409).json({ error: 'This project is already ownerless.' });
    const now = nowIso();
    store.tx(() => {
      for (const o of owners) store.removeMember(row.id, o.user_id);
    });
    // Any live collaboration sessions those users hold end at once: their
    // membership is gone, so a reconnect is refused by the authorization
    // service. Close their rooms so the change takes effect immediately.
    for (const o of owners) {
      for (const d of docIndex.listForProject(row.id)) {
        try { collab.closeDocumentConnectionsForUser(d.id, o.user_id); } catch { /* room not open */ }
      }
    }
    audit({
      actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'project.made_ownerless',
      projectId: row.id, meta: { removed: owners.map((o) => o.username) },
    });
    res.json({ ok: true, projectId: row.id });
  });

  // Direct member addition stays software-administrator-only.
  app.post('/api/admin/projects/:id/members', requireAdmin(), (req, res) => {
    const row = store.getProjectRow(String(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const role = String(body.role || 'viewer');
    if (!PROJECT_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown project role.' });
    const target = store.findUserByUsername(String(body.username || ''));
    if (!target) return res.status(400).json({ error: 'No account with that username exists.' });
    const existing = store.getMembership(row.id, target.id);
    if (existing && existing.role === 'owner' && role !== 'owner' && store.countOwners(row.id) <= 1) {
      return res.status(409).json({ error: 'This is the project\'s last owner. Make someone else an owner first.' });
    }
    auditedTx({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'member.added', projectId: row.id, targetType: 'user', targetId: target.id, meta: { role, direct: true, from: existing ? existing.role : null } },
      () => store.upsertMember(row.id, target.id, role, req.auth.user.id, nowIso()));
    res.json({ ok: true });
  });

  // =========================================================================
  // ADMIN — sessions & audit
  // =========================================================================

  app.get('/api/admin/sessions', requireAdmin(), (req, res) => {
    res.json({
      sessions: store.listActiveSessions(nowIso()).map((s) => ({
        id: s.id, userId: s.user_id, username: s.username, fullName: s.full_name, role: s.role,
        createdAt: s.created_at, lastSeenAt: s.last_seen_at, expiresAt: s.expires_at,
        ip: s.ip, userAgent: s.user_agent,
      })),
    });
  });

  // ---- security policy and health (WP-03) ------------------------------------
  app.get('/api/admin/security-policy', requireAdmin(), (req, res) => {
    res.json({ policy: securityPolicy ? securityPolicy.read() : null, defaults: securityPolicy ? securityPolicy.DEFAULTS : null });
  });
  app.put('/api/admin/security-policy', requireAdmin(), (req, res) => {
    if (!securityPolicy) return res.status(501).json({ error: 'No security policy on this server.' });
    const before = securityPolicy.read();
    const out = securityPolicy.write(req.body || {});
    if (out.error) return res.status(400).json({ error: out.error, code: 'BAD_POLICY' });
    // Switching separation of duties off is the documented override for one-person installations (D7): it is in the trail.
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'settings.security_policy', targetType: 'admin', meta: { before, after: out.policy } });
    res.json({ policy: out.policy });
  });
  app.get('/api/admin/health', requireAdmin(), (req, res) => {
    res.json({ audit: deps.auditHealth ? deps.auditHealth() : null });
  });

  app.post('/api/admin/sessions/:id/revoke', requireAdmin(), (req, res) => {
    const n = store.revokeSessionById(String(req.params.id), 'admin-revoked', nowIso());
    if (!n) return res.status(404).json({ error: 'Not found' });
    audit({ actorId: req.auth.user.id, actorUsername: req.auth.user.username, action: 'auth.session.revoked', targetType: 'session', targetId: String(req.params.id) });
    res.json({ ok: true });
  });

  app.get('/api/admin/audit', authz.requireGlobal('audit.read'), (req, res) => {      // WP-27: administrators and read-only auditors
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const before = req.query.before ? parseInt(req.query.before, 10) : null;
    const action = req.query.action ? String(req.query.action).slice(0, 60) : null;
    // WP-29: filters by who, project and time as well (from inclusive, to exclusive; a date alone means that day's start)
    const text = (k, n) => (req.query[k] ? String(req.query[k]).trim().slice(0, n) || null : null);
    const time = (k) => { const v = text(k, 40); if (!v) return null; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
    const rows = store.listAudit({ limit, before, action, actor: text('actor', 64), project: text('project', 120), from: time('from'), to: time('to') }).map((r) => ({
      id: r.id, at: r.at, actor: r.actor_username, action: r.action,
      targetType: r.target_type, targetId: r.target_id, projectId: r.project_id,
      ip: r.ip, meta: r.meta ? JSON.parse(r.meta) : null, seq: r.seq ?? null,
    }));
    res.json({ entries: rows });
  });
}

module.exports = { registerAuthRoutes, parseCsv };
