'use strict';
// UI redesign screen 6 (docs/audit/mockups/admin.html): the read-only figures the administration page shows. The users list carries each
// person's last sign-in (the "Last sign-in" column), and the admin health answer carries the server's uptime and the data disk's size and
// free space (the Service tile and the Storage card). Both stay administrator-only; nothing here writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin;

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
});
test.after(async () => { if (h) await h.close(); });

test('the users list says when each person last signed in; a person who never signed in has null', async () => {
  const made = await admin.post('/api/admin/users', { username: 'lena', fullName: 'Lena Last', role: 'author' });
  assert.equal(made.status, 200);
  let users = (await admin.get('/api/admin/users')).json.users;
  const me = users.find((u) => u.username === 'admin');
  assert.ok(me.lastSignInAt && !Number.isNaN(Date.parse(me.lastSignInAt)), 'the administrator signed in (setup starts a session)');
  assert.equal(users.find((u) => u.username === 'lena').lastSignInAt, null, 'never signed in');

  const before = Date.now();
  const lena = new h.Client('lena');
  assert.equal((await lena.post('/api/auth/login', { username: 'lena', password: made.json.tempPassword })).status, 200);
  users = (await admin.get('/api/admin/users')).json.users;
  const at = Date.parse(users.find((u) => u.username === 'lena').lastSignInAt);
  assert.ok(at >= before - 1000, 'the newest sign-in');
  // still administrator / auditor only
  assert.equal((await lena.get('/api/admin/users')).status, 403);
});

test('the admin health answer carries uptime and the data disk figures, for administrators only', async () => {
  const r = await admin.get('/api/admin/health');
  assert.equal(r.status, 200);
  const s = r.json.system;
  assert.ok(Number.isInteger(s.uptimeSeconds) && s.uptimeSeconds >= 0);
  assert.ok(!Number.isNaN(Date.parse(s.startedAt)));
  assert.ok(s.disk.totalBytes > 0 && s.disk.freeBytes >= 0 && s.disk.freeBytes <= s.disk.totalBytes);
  assert.ok('audit' in r.json, 'the audit health is still there');
  const anon = new h.Client('anon');
  assert.equal((await anon.get('/api/admin/health')).status, 401);
});
