'use strict';
// Break-glass password reset, run on the SERVER machine.
//
//   npm run reset-admin -- <username>                 asks for the new password twice, without showing it
//   echo <new-password> | npm run reset-admin -- <username> --stdin     for a script: one line on standard input
//
// The password is never taken from the command line (audit WP-04 / SEC-005): a command line is kept in the shell
// history and is visible to every user of the machine in the process list while the command runs.
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
const auditChain = require(path.join(root, lib, 'core', 'auth', 'auditChain'));

/** Read one line from a non-interactive standard input (a pipe or a file). */
function readStdinLine() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => resolve(buf.split(/\r?\n/)[0]));
    process.stdin.on('error', reject);
  });
}

/** Ask on the console without echoing what is typed. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    const done = (v) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); resolve(v); };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n') return done(value);
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); return reject(new Error('Cancelled.')); }
        if (ch === '\u0008' || ch === '\u007f') { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8'); stdin.on('data', onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const fromStdin = args.includes('--stdin');
  const positional = args.filter((a) => !a.startsWith('--'));
  const [username, extra] = positional;
  if (!username || extra !== undefined) {
    if (extra !== undefined) console.error('The password is not taken from the command line (it would stay in the shell history and the process list).');
    console.error('Usage: npm run reset-admin -- <username>            (asks for the password)');
    console.error('       echo <password> | npm run reset-admin -- <username> --stdin');
    process.exit(2);
  }
  let password;
  if (fromStdin || !process.stdin.isTTY) {
    password = await readStdinLine();
  } else {
    password = await askHidden(`New password for ${username}: `);
    const again = await askHidden('Repeat it: ');
    if (password !== again) { console.error('The two entries differ; nothing was changed.'); process.exit(2); }
  }
  if (!password) { console.error('No password was given; nothing was changed.'); process.exit(2); }
  const check = policy.validatePassword(password);
  if (!check.ok) { console.error(check.error); process.exit(2); }

  const store = new AuthStore(open(workspace));
  const now = new Date().toISOString();
  store.migrate(now);
  // WP-29: the row this tool writes joins the audit chain like every other (same key file as the server)
  store.setAuditKey(auditChain.loadOrCreateKey(auditChain.defaultKeyFile(workspace, process.env)));
  const user = store.findUserByUsername(username);
  if (!user) { console.error(`No such user: ${username}`); process.exit(1); }

  store.updateUser(user.id, { password_hash: await hashPassword(password), must_change_password: 1, disabled_at: null }, now);
  store.revokeAllSessionsForUser(user.id, 'admin-reset', now);
  store.appendAudit({ at: now, actorId: null, actorUsername: 'console', ip: 'local', action: 'auth.password.console_reset', targetType: 'user', targetId: user.id, projectId: null, meta: { username: user.username } });
  console.log(`Password reset for "${user.username}". They must choose a new one at next sign-in.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
