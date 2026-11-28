'use strict';
// Phase 3, decision P3-6 (docs/phase3/standalone.md), workflow B: a COMMON SERVER is unchanged. With AGASTYA_DEPLOYMENT unset (a developer
// run, every server before P3-6) or =server: no default accounts at the first start, the setup screen creates the first administrator, the
// default-credentials notice and its acknowledgement do not exist, and the administration page says "server" with no default accounts.
// (test/standalone-accounts.test.js covers the standalone side.)
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.AGASTYA_DEPLOYMENT;
const { boot } = require('./helpers');

const PW = 'quiet harbour lantern 42';
let h;
test.before(async () => { h = await boot(); });
test.after(async () => { if (h) await h.close(); });

test('server mode: the first start creates nothing; the setup screen creates the administrator; no default credentials anywhere', async () => {
  const { config } = require('../dist/config');
  assert.equal(config.deployment, 'server', 'unset means server');
  const { store } = require('../dist/context');
  const ctx = require('../dist/context').defaultContext();
  const r = await require('../dist/services/firstRun').initialiseAccounts({ store, audit: (f) => ctx.audit(f), deployment: config.deployment, log: () => undefined });
  assert.deepEqual(r.defaultAccounts, { created: [], reason: 'not-standalone' });
  assert.equal(store.countUsers(), 0);

  const anon = new h.Client('anon');
  const s = await anon.get('/api/auth/setup');
  assert.deepEqual(s.json, { setupRequired: true, deployment: 'server' }, 'the setup screen, and no credentials');
  assert.equal((await anon.post('/api/auth/default-credentials/acknowledge', {})).status, 404, 'the acknowledgement does not exist on a server');
  assert.equal((await anon.post('/api/auth/login', { username: 'admin', password: 'Admin@123' })).status, 401, 'no default account');

  const admin = new h.Client('admin');
  const made = await admin.post('/api/auth/setup', { username: 'siteadmin', password: PW, fullName: 'Site Admin' });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.equal(made.json.gates.mustChangePassword, false, 'the administrator chose the password: no forced change');
  assert.equal(made.json.user.defaultAccount, false);
  const hl = await admin.get('/api/admin/health');
  assert.deepEqual(hl.json.deployment, { mode: 'server', defaultAccounts: [] });
  // a person created through user management is an ordinary account (temporary password, onboarding), never a default one
  const u = await admin.post('/api/admin/users', { username: 'asha', fullName: 'Asha Rao', role: 'author' });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.equal(u.json.user.defaultAccount, false);
  assert.equal(store.countUsers(), 2);
});

test('server mode: a default password is refused as a chosen password (setup and change)', async () => {
  const fresh = new h.Client('x');
  const r = await fresh.post('/api/auth/setup', { username: 'second', password: 'Admin@123', fullName: 'S' });
  assert.equal(r.status, 409, 'already set up');
  const admin = new h.Client('a2');
  assert.equal((await admin.post('/api/auth/login', { username: 'siteadmin', password: PW })).status, 200);
  const ch = await admin.post('/api/auth/change-password', { currentPassword: PW, newPassword: 'Author@123' });
  assert.equal(ch.status, 400);
  assert.match(ch.json.error, /default passwords/);
});
