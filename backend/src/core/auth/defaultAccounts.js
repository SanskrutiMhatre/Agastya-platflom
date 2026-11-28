'use strict';
// Phase 3, decision P3-6 (docs/phase3/DECISIONS.md; record docs/phase3/standalone.md): the default accounts of a STANDALONE installation.
//
// AGASTYA_DEPLOYMENT=standalone (written by the standalone installer into agastya.ini [server] Deployment=standalone, passed on by the
// host) makes the first start of a FRESH data folder create one account per global role with the fixed credentials of
// policy.DEFAULT_ACCOUNTS (admin / Admin@123, manager / Manager@123, author / Author@123, auditor / Auditor@123). A common server
// (AGASTYA_DEPLOYMENT=server, and every run that does not say, a developer's included) never gets them: its first administrator is
// created by the first-run setup screen, everyone else through user management.
//
// Once per data folder, never again:
//   - the decision is recorded in platform_init ('default_accounts', migration 027) in the same transaction as the accounts, so a second
//     start, a deleted or renamed default account, or a later upgrade creates nothing;
//   - a data folder that already has ANY account (an upgrade of an existing installation, the owner's real database) is recorded as
//     'skipped-existing-users' and gets nothing, now or later;
//   - only standalone mode writes a record at all: a server run leaves the data folder exactly as it was.
//
// Mitigations of the fixed passwords (they are published, so they protect nothing by themselves):
//   - every account is created behind the forced-password-change gate (must_change_password, and default_password, which the gate also
//     honours), so until its first change it can do nothing but change the password or sign out;
//   - none of the default passwords is ever accepted as a new password (policy.validatePassword);
//   - while an account still has its default password it signs in from this computer only (routes.js, isLoopbackPeer);
//   - each creation and each forced change is audited and names the account as a default account; the administration page lists the ones
//     that still have the default password.

const { hashPassword, newId } = require('./crypto');
const policy = require('./policy');

const STEP = 'default_accounts';
const ACK_STEP = 'default_credentials_ack';

/**
 * Create the default accounts if, and only if, this is a standalone installation on a data folder that never had any. Idempotent.
 * Returns { created: [usernames], reason }.
 */
async function ensureDefaultAccounts({ store, audit, deployment, log = console.log, now = () => new Date() }) {
  if (deployment !== 'standalone') return { created: [], reason: 'not-standalone' };
  const done = store.getInitStep(STEP);
  if (done) return { created: [], reason: done.value === 'created' ? 'already-created' : 'existing-workspace' };
  if (store.countUsers() > 0) {
    store.recordInitStep(STEP, 'skipped-existing-users', now().toISOString());
    log('[default-accounts] This data folder already has accounts: no default accounts were created (and none will be).');
    return { created: [], reason: 'existing-workspace' };
  }
  // The hashes first (Argon2 takes a moment each), outside the write transaction.
  const prepared = [];
  for (const a of policy.DEFAULT_ACCOUNTS) prepared.push({ ...a, hash: await hashPassword(a.password) });

  const nowIso = now().toISOString();
  const created = store.tx(() => {
    // re-checked under the write lock: a second process (the installer's run beside a first start) cannot create them twice
    if (store.getInitStep(STEP)) return null;
    if (store.countUsers() > 0) { store.recordInitStep(STEP, 'skipped-existing-users', nowIso); return null; }
    const rows = prepared.map((a) => {
      const u = store.createUser({
        id: newId(), username: a.username, fullName: a.fullName, role: a.role, passwordHash: a.hash,
        mustChangePassword: 1, onboardingPending: 0, usernameLocked: 1, createdBy: null, now: nowIso, defaultAccount: 1,
      });
      if (a.auditor) store.updateUser(u.id, { auditor: 1 }, nowIso);
      return { user: u, account: a };
    });
    store.recordInitStep(STEP, 'created', nowIso);
    return rows;
  });
  if (!created) return { created: [], reason: 'existing-workspace' };
  for (const { user, account } of created) {
    audit({
      action: 'user.default_account_created', targetType: 'user', targetId: user.id,
      meta: { username: user.username, role: account.role, auditor: account.auditor || undefined, defaultAccount: true, forcedChange: true, deployment: 'standalone' },
    });
  }
  log(`[default-accounts] Standalone first start: created the default accounts ${created.map((c) => c.user.username).join(', ')} (each must change its password at the first sign-in).`);
  return { created: created.map((c) => c.user.username), reason: 'created' };
}

/**
 * The default credentials still worth showing on the first-launch screen: the default accounts that exist, are enabled and still have their
 * default password - until someone acknowledged the screen. [] when there is nothing to show.
 */
function pendingDefaultCredentials(store) {
  if (store.getInitStep(ACK_STEP)) return [];
  const rows = store.listDefaultAccounts().filter((u) => u.default_password && !u.disabled_at);
  return policy.DEFAULT_ACCOUNTS
    .filter((a) => rows.some((u) => u.username.toLowerCase() === a.username))
    .map((a) => ({ username: a.username, password: a.password, role: a.role, label: a.label }));
}

/** Records that the first-launch credentials screen was acknowledged (true the first time). */
function acknowledgeDefaultCredentials(store, nowIso) {
  return store.recordInitStep(ACK_STEP, 'acknowledged', nowIso);
}

/** The administration page's view: every default account and whether it still has the default password. */
function defaultAccountStatus(store) {
  return store.listDefaultAccounts().map((u) => ({
    id: u.id, username: u.username, role: u.role, auditor: !!u.auditor, defaultPassword: !!u.default_password, disabled: !!u.disabled_at,
  }));
}

/**
 * True when the request reaches this server from this computer: the socket's peer AND the address Express reports (which honours a trusted
 * proxy) are loopback. A default password is refused from anywhere else.
 */
function isLoopbackPeer(req) {
  const norm = (a) => String(a || '').trim().toLowerCase().replace(/^::ffff:/, '');
  const loop = (a) => { const x = norm(a); return x === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(x); };
  const peer = req && req.socket ? req.socket.remoteAddress : '';
  const ip = req && req.ip !== undefined ? req.ip : peer;
  return loop(peer) && loop(ip);
}

module.exports = { ensureDefaultAccounts, pendingDefaultCredentials, acknowledgeDefaultCredentials, defaultAccountStatus, isLoopbackPeer, STEP, ACK_STEP };
