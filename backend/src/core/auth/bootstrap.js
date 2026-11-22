'use strict';
// First-run administrator bootstrap from INITIAL_ADMIN_USERNAME /
// INITIAL_ADMIN_PASSWORD.
//
// Idempotent: once ANY administrator exists, re-running is an observable
// no-op — it logs that fact (and whether the configured username matches an
// existing account) and changes nothing. The reserved-username rules exist
// to keep names like "admin" away from PEOPLE; the bootstrap account is the
// one narrow exception, passed through validateUsername({allowReserved}).
//
// The configured password is only ever a TEMPORARY credential: the account
// is created behind the forced-password-change gate, and until that first
// change it can administer nothing. Neither the password nor its hash is
// ever printed.

const { hashPassword, newId } = require('./crypto');
const policy = require('./policy');

async function ensureBootstrapAdmin({ store, audit, env = process.env, log = console.log, now = () => new Date() }) {
  const username = String(env.INITIAL_ADMIN_USERNAME || '').trim();
  const password = env.INITIAL_ADMIN_PASSWORD || '';

  if (store.anyAdminExists()) {
    const existing = username ? store.findUserByUsername(username) : null;
    if (username && !existing) {
      log(`[bootstrap] An administrator already exists; INITIAL_ADMIN_USERNAME ("${username}") does not match any account. Nothing changed.`);
    } else if (username && existing && existing.role !== 'admin') {
      log(`[bootstrap] An administrator already exists; INITIAL_ADMIN_USERNAME ("${username}") names a non-admin account. Nothing changed.`);
    } else {
      log('[bootstrap] Administrator already present; bootstrap skipped (no-op).');
    }
    return { created: false, reason: 'admin-exists' };
  }

  if (!username || !password) {
    log('[bootstrap] No administrator exists and INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD are not set — no one can sign in until they are provided.');
    return { created: false, reason: 'env-missing' };
  }

  const u = policy.validateUsername(username, { allowReserved: true });
  if (!u.ok) {
    log(`[bootstrap] INITIAL_ADMIN_USERNAME rejected: ${u.error}`);
    return { created: false, reason: 'bad-username' };
  }
  const p = policy.validatePassword(password);
  if (!p.ok) {
    log(`[bootstrap] INITIAL_ADMIN_PASSWORD rejected by the password policy: ${p.error}`);
    return { created: false, reason: 'bad-password' };
  }
  if (store.findUserByUsername(u.username)) {
    log(`[bootstrap] The username "${u.username}" is already taken by a non-admin account. Nothing changed.`);
    return { created: false, reason: 'username-taken' };
  }

  const passwordHash = await hashPassword(password);
  const nowIso = now().toISOString();
  const user = store.createUser({
    id: newId(),
    username: u.username,
    fullName: 'Administrator',
    role: 'admin',
    passwordHash,
    // The env password is temporary by construction: forced change on first
    // sign-in, and the gate blocks every admin capability until it happens.
    mustChangePassword: 1,
    onboardingPending: 0,
    usernameLocked: 1,
    createdBy: null,
    now: nowIso,
  });
  audit({ action: 'user.bootstrap_admin_created', targetType: 'user', targetId: user.id, meta: { username: u.username } });
  log(`[bootstrap] Created initial administrator "${u.username}" (forced password change on first sign-in).`);
  return { created: true, userId: user.id };
}

module.exports = { ensureBootstrapAdmin };
