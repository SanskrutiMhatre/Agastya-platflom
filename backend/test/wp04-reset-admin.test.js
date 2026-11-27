'use strict';
// WP-04 (SEC-005, PLT-012): the break-glass reset never takes the password from the command line, and leaves no copy of it
// in the database, the audit log or its own output.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'reset-admin.js');
const NEW_PW = 'quiet violet harbour 42';

function run(args, input, ws) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8', env: { ...process.env, AGASTYA_WORKSPACE_DIR: ws }, timeout: 60000 });
}

test('reset-admin: the password comes from standard input, never the command line, and is stored only as a hash', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-reset-'));
  const { open } = require('../vendor/engine/db');
  const { AuthStore } = require('../src/core/auth/store');
  const { hashPassword, verifyPassword } = require('../src/core/auth/crypto');
  const store = new AuthStore(open(ws)); const now = new Date().toISOString(); store.migrate(now);
  store.createUser({ id: 'u-boss', username: 'boss', fullName: 'Boss', role: 'admin', passwordHash: await hashPassword('Original-password-1'), now });
  const id = store.findUserByUsername('boss').id;

  const onArgv = run(['boss', NEW_PW], '', ws);
  assert.equal(onArgv.status, 2, onArgv.stderr);
  assert.match(onArgv.stderr, /not taken from the command line/);
  assert.ok(await verifyPassword(store.findUserByUsername('boss').password_hash, 'Original-password-1'), 'nothing changed');

  const piped = run(['boss', '--stdin'], `${NEW_PW}\n`, ws);
  assert.equal(piped.status, 0, piped.stderr);
  assert.ok(!piped.stdout.includes(NEW_PW) && !piped.stderr.includes(NEW_PW), 'the password is not echoed');
  const after = store.findUserByUsername('boss');
  assert.ok(await verifyPassword(after.password_hash, NEW_PW)); assert.equal(after.must_change_password, 1);

  const audit = store.listAudit({ limit: 10 }).find((r) => r.action === 'auth.password.console_reset');
  assert.ok(audit && audit.target_id === id);
  for (const f of fs.readdirSync(ws, { recursive: true })) {
    const p = path.join(ws, f); if (!fs.statSync(p).isFile()) continue;
    assert.ok(!fs.readFileSync(p).includes(Buffer.from(NEW_PW)), `${f} holds the password in clear`);
  }
  const empty = run(['boss', '--stdin'], '\n', ws);
  assert.equal(empty.status, 2); assert.match(empty.stderr, /No password was given/);
});
