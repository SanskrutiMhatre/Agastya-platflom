'use strict';
// Break-glass password reset, run on the SERVER machine.
//
//   npm run reset-admin -- <username> <new-password>
//
// There is no master password in this platform (see src/core/auth/masterPassword.js),
// so a locked-out sole administrator recovers here, which needs filesystem access
// to the database - the same trust boundary as the data itself. The account is
// forced to change the password at next sign-in, every session is revoked, and
// the action is written to the audit log.

const path = require('path');
const root = path.resolve(__dirname, '..');
const workspace = process.env.AGASTYA_WORKSPACE_DIR || path.resolve(root, '..', 'workspace');

// From the repository the authentication code is in src/; in the installed product only the compiled copy in dist/ is shipped.
const lib = require('fs').existsSync(path.join(root, 'src')) ? 'src' : 'dist';
const { open } = require(path.join(root, 'vendor', 'engine', 'db'));
const { AuthStore } = require(path.join(root, lib, 'core', 'auth', 'store'));
const { hashPassword } = require(path.join(root, lib, 'core', 'auth', 'crypto'));
const policy = require(path.join(root, lib, 'core', 'auth', 'policy'));

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: npm run reset-admin -- <username> <new-password>');
    process.exit(2);
  }
  const check = policy.validatePassword(password);
  if (!check.ok) { console.error(check.error); process.exit(2); }

  const store = new AuthStore(open(workspace));
  const now = new Date().toISOString();
  store.migrate(now);
  const user = store.findUserByUsername(username);
  if (!user) { console.error(`No such user: ${username}`); process.exit(1); }

  store.updateUser(user.id, { password_hash: await hashPassword(password), must_change_password: 1, disabled_at: null }, now);
  store.revokeAllSessionsForUser(user.id, 'admin-reset', now);
  store.appendAudit({ at: now, actorId: null, actorUsername: 'console', ip: 'local', action: 'auth.password.console_reset', targetType: 'user', targetId: user.id, projectId: null, meta: { username: user.username } });
  console.log(`Password reset for "${user.username}". They must choose a new one at next sign-in.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
