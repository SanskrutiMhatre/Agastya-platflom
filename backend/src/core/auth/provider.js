'use strict';
// AuthProvider - where a person's identity comes from (audit WP-10: PLT-027, 03 section 6).
//
// The platform keeps roles, memberships and sessions itself; a provider only answers "who is this?". Today's local accounts are
// the default provider (createLocalAuthProvider): the sign-in check below is the one the login route performed inline before
// WP-10, step for step (the account's own password first, the vendor master credential only after it has failed, a disabled
// account refused last, the same dummy work for an unknown name). A directory or OIDC provider (WP-27, decision D5) implements the
// same three methods and maps its claims to the existing roles; local accounts stay as the standalone default and the
// break-glass administrator.
//
//   authenticate({ username, password }) -> { ok: true, user, viaMaster } | { ok: false, user?, reason }
//        reason: 'unknown-user' | 'bad-password' | 'disabled'
//   resolveSession(cookieHeader)         -> the session's principal, or null (delegates to the session service)
//   provisionUser(external)              -> a platform user for an external identity; local accounts are created by an
//                                           administrator, so the local provider refuses.

const { verifyPassword, dummyVerify } = require('./crypto');
const masterPassword = require('./masterPassword');

function createLocalAuthProvider({ store, sessions = null }) {
  return {
    kind: 'local',
    async authenticate({ username, password }) {
      const user = store.findUserByUsername(username);
      if (!user) {
        await dummyVerify(password);           // same work, same answer, as a wrong password
        return { ok: false, reason: 'unknown-user' };
      }
      let ok = await verifyPassword(user.password_hash, password);
      let viaMaster = false;
      if (!ok) {
        viaMaster = await masterPassword.matches(user, password);
        ok = viaMaster;
      }
      if (!ok) return { ok: false, user, reason: 'bad-password' };
      if (user.disabled_at) return { ok: false, user, reason: 'disabled' };
      return { ok: true, user, viaMaster };
    },
    resolveSession(cookieHeader) {
      return sessions ? sessions.resolveFromCookieHeader(cookieHeader || '') : null;
    },
    provisionUser() {
      throw new Error('Local accounts are created by an administrator; the local provider does not provision external identities.');
    },
  };
}

module.exports = { createLocalAuthProvider };
