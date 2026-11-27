'use strict';
// WP-13 (ARC-019, PERF-017): Argon2 is required, and the only remaining scrypt path (verifying hashes older builds wrote) runs off the event loop.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { boot, tmp } = require('./helpers');

const PW = 'Correct-horse-9';
// A hash in the format the old scrypt fallback wrote ($scrypt$N=..,r=..,p=..$salt$key).
function legacyScrypt(password) {
  const salt = crypto.randomBytes(16); const N = 1 << 15;
  const key = crypto.scryptSync(Buffer.from(password, 'utf8'), salt, 32, { N, r: 8, p: 1, maxmem: 128 * N * 8 * 2 });
  return `$scrypt$N=${N},r=8,p=1$${salt.toString('base64')}$${key.toString('base64')}`;
}

test('a legacy scrypt hash verifies without blocking the event loop', async () => {
  const { verifyPassword, needsRehash, hashPassword } = require('../src/core/auth/crypto');
  const stored = legacyScrypt(PW);
  assert.equal(needsRehash(stored), true);
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 1);
  const pending = verifyPassword(stored, PW);
  // the verification is on the thread pool: the loop keeps turning while it runs
  await new Promise((r) => setImmediate(r));
  const ok = await pending;
  clearInterval(timer);
  assert.equal(ok, true);
  assert.ok(ticks >= 1, `the event loop ran ${ticks} timer callbacks during the verification`);
  assert.equal(await verifyPassword(stored, 'wrong'), false);
  const fresh = await hashPassword(PW);
  assert.match(fresh, /^\$argon2id\$/, 'new hashes are Argon2id');
  assert.equal(needsRehash(fresh), false);
});

test('without the argon2 module: a clear error, never a silent "wrong password", and the server refuses to start', () => {
  const dir = tmp('agastya-noargon-');
  // a preload that makes require('argon2') fail, as on an install where the native module is missing
  const preload = path.join(dir, 'no-argon2.js');
  fs.writeFileSync(preload, "const M = require('module'); const o = M._resolveFilename; M._resolveFilename = function (r, ...a) { if (r === 'argon2') { const e = new Error(\"Cannot find module 'argon2'\"); e.code = 'MODULE_NOT_FOUND'; throw e; } return o.call(this, r, ...a); };\n");
  const cryptoJs = path.resolve(__dirname, '..', 'src', 'core', 'auth', 'crypto.js').replace(/\\/g, '/');
  const probe = `const c = require('${cryptoJs}');
    (async () => {
      const out = { using: c.usingArgon2() };
      try { await c.verifyPassword('$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2g', 'x'); out.verify = 'resolved'; } catch (e) { out.verify = e.message; }
      try { await c.hashPassword('x'); out.hash = 'resolved'; } catch (e) { out.hash = e.message; }
      console.log(JSON.stringify(out));
    })();`;
  const r = spawnSync(process.execPath, ['--require', preload, '-e', probe], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.using, false);
  assert.match(out.verify, /password-hashing module \(argon2/);
  assert.match(out.hash, /does not start without it/);

  // the server itself stops before it listens, naming the cause
  const ws = tmp('agastya-noargon-ws-');
  const s = spawnSync(process.execPath, ['--require', preload, path.resolve(__dirname, '..', 'dist', 'index.js')], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, AGASTYA_WORKSPACE_DIR: ws, PORT: '0', AGASTYA_NO_WORKSPACE_LOCK: '1' },
  });
  assert.equal(s.status, 1, `exit ${s.status}\n${s.stdout}\n${s.stderr}`);
  assert.match(s.stderr, /password-hashing module \(argon2/);
  assert.doesNotMatch(s.stdout, /running on http/);
});

test('signing in with a legacy scrypt password upgrades the stored hash to Argon2id', async () => {
  const h = await boot();
  try {
    const admin = new h.Client('admin');
    assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
    const { store } = require('../dist/context');
    const user = store.findUserByUsername('admin');
    store.updateUser(user.id, { password_hash: legacyScrypt(PW) }, new Date().toISOString());
    const c = new h.Client('again');
    assert.equal((await c.post('/api/auth/login', { username: 'admin', password: PW })).status, 200);
    assert.match(store.findUserByUsername('admin').password_hash, /^\$argon2id\$/);
    // and the upgraded hash still signs in
    assert.equal((await new h.Client('third').post('/api/auth/login', { username: 'admin', password: PW })).status, 200);
  } finally { await h.close(); }
});
