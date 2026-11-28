'use strict';
// Phase 3, decision P3-6 (docs/phase3/standalone.md): the two initialisation workflows.
//
//   A. STANDALONE (AGASTYA_DEPLOYMENT=standalone): the first start of a fresh data folder creates one default account per global role with
//      the fixed credentials (admin/Admin@123, manager/Manager@123, author/Author@123, auditor/Auditor@123), once, never again (a second
//      start, deleted accounts, an upgrade of a data folder that has accounts); every one is forced to change its password before it can do
//      anything; no default password is ever accepted as a new password; a default password signs in from this computer only; the first
//      launch screen gets the credentials until acknowledged; the administration page sees the deployment and which defaults are unchanged.
//   B. COMMON SERVER (AGASTYA_DEPLOYMENT=server, and unset): nothing of the above. (test/standalone-server-mode.test.js covers its HTTP side.)
//
// Part 1 runs each "start" in a child process (config is read once per process); part 2 boots the real app in standalone mode in-process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

// This process is the standalone installation of part 2: set before anything from dist/ is loaded (boot() loads config).
process.env.AGASTYA_DEPLOYMENT = 'standalone';
delete process.env.AGASTYA_MODE;
const { boot, tmp } = require('./helpers');

const CHILD = path.join(__dirname, 'support', 'first-run-child.js');
const DEFAULTS = [
  { username: 'admin', password: 'Admin@123', role: 'admin', auditor: 0 },
  { username: 'manager', password: 'Manager@123', role: 'project_manager', auditor: 0 },
  { username: 'author', password: 'Author@123', role: 'author', auditor: 0 },
  { username: 'auditor', password: 'Auditor@123', role: 'author', auditor: 1 },
];
const NEW_PW = 'quiet harbour lantern 42';

function start(ws, deployment, action = 'start') {
  const env = { ...process.env, AGASTYA_WORKSPACE_DIR: ws, AGASTYA_NO_WORKSPACE_LOCK: '1' };
  delete env.AGASTYA_DEPLOYMENT; delete env.AGASTYA_MODE;
  if (deployment !== undefined) env.AGASTYA_DEPLOYMENT = deployment;
  const r = spawnSync(process.execPath, [CHILD, action], { env, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, `child ${action} (${deployment}) failed:\n${r.stderr}\n${r.stdout}`);
  const line = r.stdout.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
  return JSON.parse(line);
}

// ---- part 1: the first start, once per data folder -------------------------------------------------------------------------------------

test('server mode (unset and explicit) creates no default accounts and leaves no initialisation record', () => {
  for (const dep of [undefined, 'server']) {
    const ws = tmp('agastya-p36-server-');
    const s = start(ws, dep);
    assert.equal(s.deployment, 'server');
    assert.deepEqual(s.users, [], 'no account at all: the administrator is created by the setup screen');
    assert.deepEqual(s.init, [], 'a server run writes no platform_init row');
    assert.equal(s.result.defaultAccounts.reason, 'not-standalone');
  }
});

test('standalone: the first start of a fresh data folder creates every default account once, behind the forced change, audited', () => {
  const ws = tmp('agastya-p36-standalone-');
  const s = start(ws, 'standalone');
  assert.equal(s.deployment, 'standalone');
  assert.deepEqual(s.result.defaultAccounts.created.sort(), DEFAULTS.map((d) => d.username).sort());
  const byName = Object.fromEntries(s.users.map((u) => [u.username, u]));
  for (const d of DEFAULTS) {
    const u = byName[d.username];
    assert.ok(u, `${d.username} exists`);
    assert.equal(u.role, d.role, `${d.username} role`);
    assert.equal(u.auditor, d.auditor, `${d.username} auditor flag`);
    assert.equal(u.must_change_password, 1, `${d.username} must change the password`);
    assert.equal(u.onboarding_pending, 0);
    assert.equal(u.default_account, 1);
    assert.equal(u.default_password, 1);
  }
  assert.equal(s.users.length, DEFAULTS.length, 'nothing else');
  assert.deepEqual(s.init, [{ key: 'default_accounts', value: 'created' }]);
  const created = s.audit.filter((a) => a.action === 'user.default_account_created');
  assert.equal(created.length, DEFAULTS.length, 'one audit row per default account');
  for (const a of created) { assert.equal(a.meta.defaultAccount, true); assert.equal(a.meta.forcedChange, true); assert.ok(!JSON.stringify(a.meta).includes('@123'), 'no password in the audit trail'); }

  // a second start, and a start after every default account was deleted: nothing is created again
  const again = start(ws, 'standalone');
  assert.equal(again.users.length, DEFAULTS.length);
  assert.equal(again.result.defaultAccounts.reason, 'already-created');
  assert.equal(again.audit.filter((a) => a.action === 'user.default_account_created').length, DEFAULTS.length, 'no new creation rows');
  const gone = start(ws, 'standalone', 'delete-defaults');
  assert.deepEqual(gone.users, [], 'deleted default accounts are never recreated');
  assert.equal(gone.result.defaultAccounts.reason, 'already-created');
});

test('standalone on an existing data folder (an upgrade: it already has accounts) adds nothing, now or later', () => {
  const ws = tmp('agastya-p36-upgrade-');
  const before = start(ws, 'server', 'seed-admin');           // an installation from before P3-6, or a common server
  assert.deepEqual(before.users.map((u) => u.username), ['siteadmin']);
  const up = start(ws, 'standalone');
  assert.deepEqual(up.users.map((u) => u.username), ['siteadmin'], 'the existing accounts are kept and nothing is added');
  assert.equal(up.users[0].default_account, 0);
  assert.equal(up.result.defaultAccounts.reason, 'existing-workspace');
  assert.deepEqual(up.init, [{ key: 'default_accounts', value: 'skipped-existing-users' }]);
  assert.equal(start(ws, 'standalone').users.length, 1, 'and a later start does not change its mind');
});

test("the installer's tool (scripts/default-accounts.js): exit 0 when it created them, 3 when there was nothing to do; no password printed", () => {
  const ws = tmp('agastya-p36-tool-');
  const script = path.join(__dirname, '..', 'scripts', 'default-accounts.js');
  const run = () => spawnSync(process.execPath, [script, '--workspace', ws], { encoding: 'utf8', timeout: 120000, env: { ...process.env, AGASTYA_DEPLOYMENT: '' } });
  const first = run();
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.match(first.stdout, /created: admin,manager,author,auditor/);
  assert.ok(!/@123/.test(first.stdout + first.stderr), 'the tool never prints a password');
  const second = run();
  assert.equal(second.status, 3, second.stderr + second.stdout);
  assert.match(second.stdout, /nothing created \(already-created\)/);
});

test('configuration: AGASTYA_DEPLOYMENT is standalone or server (default server); standalone refuses a network server', () => {
  const { buildConfig } = require('../dist/config');
  assert.equal(buildConfig({}).deployment, 'server');
  assert.equal(buildConfig({ AGASTYA_DEPLOYMENT: 'server' }).deployment, 'server');
  assert.equal(buildConfig({ AGASTYA_DEPLOYMENT: ' Standalone ' }).deployment, 'standalone');
  assert.throws(() => buildConfig({ AGASTYA_DEPLOYMENT: 'single' }), /AGASTYA_DEPLOYMENT/);
  assert.throws(() => buildConfig({ AGASTYA_DEPLOYMENT: 'standalone', AGASTYA_MODE: 'server', AGASTYA_HOST: '127.0.0.1' }), /AGASTYA_DEPLOYMENT/);
});

test('the installer finish page, the ini template and the server list the same default credentials', () => {
  const { DEFAULT_ACCOUNTS } = require('../dist/core/auth/policy');
  assert.deepEqual(DEFAULT_ACCOUNTS.map((a) => ({ username: a.username, password: a.password, role: a.role, auditor: a.auditor ? 1 : 0 })), DEFAULTS);
  const iss = fs.readFileSync(path.join(__dirname, '..', '..', 'packaging', 'installer', 'agastya.iss'), 'utf8');
  const ini = fs.readFileSync(path.join(__dirname, '..', '..', 'packaging', 'agastya.ini.template'), 'utf8');
  for (const a of DEFAULT_ACCOUNTS) {
    assert.match(iss, new RegExp(`'\\s+${a.label.replace(/[()]/g, '\\$&')}\\s+${a.username}\\s+${a.password}'`), `agastya.iss shows ${a.username} / ${a.password}`);
    assert.ok(ini.includes(`${a.username}/${a.password}`), `agastya.ini.template names ${a.username}/${a.password}`);
  }
  assert.match(ini, /^Deployment=@DEPLOYMENT@\r?$/m);
});

test('the loopback rule: socket peer AND request address must both be this computer', () => {
  const { isLoopbackPeer } = require('../dist/core/auth/defaultAccounts');
  const req = (peer, ip) => ({ socket: { remoteAddress: peer }, ip });
  assert.equal(isLoopbackPeer(req('127.0.0.1', '127.0.0.1')), true);
  assert.equal(isLoopbackPeer(req('::1', '::1')), true);
  assert.equal(isLoopbackPeer(req('::ffff:127.0.0.1', '::ffff:127.0.0.1')), true);
  assert.equal(isLoopbackPeer(req('10.1.2.3', '10.1.2.3')), false);
  assert.equal(isLoopbackPeer(req('127.0.0.1', '10.1.2.3')), false, 'a trusted proxy on this computer forwarding a remote client');
  assert.equal(isLoopbackPeer(req('192.168.1.5', '127.0.0.1')), false);
});

// ---- part 2: the standalone installation over HTTP ------------------------------------------------------------------------------------

let h; const c = {};
test.before(async () => {
  h = await boot();
  const { store } = require('../dist/context');
  const ctx = require('../dist/context').defaultContext();
  const { initialiseAccounts } = require('../dist/services/firstRun');
  const r = await initialiseAccounts({ store, audit: (f) => ctx.audit(f), deployment: require('../dist/config').config.deployment, log: () => undefined });
  assert.equal(r.defaultAccounts.created.length, DEFAULTS.length);
  for (const d of DEFAULTS) c[d.username] = new h.Client(d.username);
});
test.after(async () => { if (h) await h.close(); });

test('the first launch screen gets the default credentials (this computer, standalone) and setup is not offered', async () => {
  const s = await new h.Client('anon').get('/api/auth/setup');
  assert.equal(s.status, 200);
  assert.equal(s.json.setupRequired, false, 'the administrator exists: the setup screen is not shown');
  assert.equal(s.json.deployment, 'standalone');
  assert.deepEqual(s.json.defaultCredentials.map((x) => [x.username, x.password]), DEFAULTS.map((d) => [d.username, d.password]));
  // the setup screen's POST cannot add a second administrator
  assert.equal((await new h.Client('x').post('/api/auth/setup', { username: 'other', password: NEW_PW, fullName: 'Other' })).status, 409);
});

test('every default account signs in at once, and the forced change shuts every other route', async () => {
  for (const d of DEFAULTS) {
    const r = await c[d.username].post('/api/auth/login', { username: d.username, password: d.password });
    assert.equal(r.status, 200, `${d.username}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.gates.mustChangePassword, true);
    assert.equal(r.json.gates.defaultPassword, true);
    assert.equal(r.json.user.defaultAccount, true);
  }
  const me = await c.admin.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.gates.mustChangePassword, true);
  assert.equal(me.json.adminQueues, undefined, 'no administrator queues before the change');

  // every route of the live router except the public ones and the four gate exits refuses with PASSWORD_CHANGE_REQUIRED
  const allow = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'authz-allow.json'), 'utf8'));
  const exits = new Set(allow.passwordChangeGateExits);
  const app = require('../dist/app').createApp();
  const seen = new Set(); const bad = []; let n = 0;
  for (const layer of app._router.stack) {
    if (!layer.route || !String(layer.route.path).startsWith('/api/')) continue;
    const isPublic = layer.route.stack.some((s) => s.handle.isPublicMarker);
    for (const m of Object.keys(layer.route.methods)) {
      const key = `${m.toUpperCase()} ${layer.route.path}`;
      if (seen.has(key)) continue; seen.add(key);
      if (isPublic || exits.has(key)) continue;
      const url = layer.route.path.replace(/:(\w+)/g, 'zzp36').replace(/\*/g, 'x');
      for (const who of ['admin', 'auditor']) {
        n++;
        const res = await c[who].req(m.toUpperCase(), url, m === 'get' ? undefined : {});
        // the read-only auditor's project writes are refused one step earlier, by the read-only rule (WP-27): refused all the same
        const codes = who === 'auditor' && m !== 'get' ? ['PASSWORD_CHANGE_REQUIRED', 'READ_ONLY_ACCOUNT'] : ['PASSWORD_CHANGE_REQUIRED'];
        if (res.status !== 403 || !res.json || !codes.includes(res.json.code)) bad.push(`${who} ${key} -> ${res.status} ${JSON.stringify(res.json)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(n > 500, `requests sent: ${n}`);
});

test('a default password is never accepted as the new password; the normal policy applies; the change ends the default', async () => {
  for (const d of DEFAULTS) {
    const r = await c.manager.post('/api/auth/change-password', { currentPassword: 'Manager@123', newPassword: d.password });
    assert.equal(r.status, 400, `${d.password} refused`);
    assert.match(r.json.error, /default passwords/);
  }
  const lower = await c.manager.post('/api/auth/change-password', { currentPassword: 'Manager@123', newPassword: 'manager@123' });
  assert.equal(lower.status, 400, 'case does not matter');
  const short = await c.manager.post('/api/auth/change-password', { currentPassword: 'Manager@123', newPassword: 'Short@1234' });
  assert.equal(short.status, 400, 'the normal policy (minimum length) applies');
  assert.match(short.json.error, /at least/);
  assert.equal((await c.manager.get('/api/projects')).status, 403, 'still behind the gate');

  const ok = await c.admin.post('/api/auth/change-password', { currentPassword: 'Admin@123', newPassword: NEW_PW });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const me = await c.admin.get('/api/auth/me');
  assert.equal(me.json.gates.mustChangePassword, false);
  assert.equal(me.json.user.defaultPassword, false);
  assert.equal(me.json.user.defaultAccount, true, 'still known as a default account');
  assert.equal((await c.admin.get('/api/admin/users')).status, 200, 'the administrator works now');
  // the default password no longer signs in, and cannot be set back by the change route
  assert.equal((await new h.Client('x').post('/api/auth/login', { username: 'admin', password: 'Admin@123' })).status, 401);
  const back = await c.admin.post('/api/auth/change-password', { currentPassword: NEW_PW, newPassword: 'Admin@123' });
  assert.equal(back.status, 400);
  // the first launch screen stops showing the changed one
  const s = await new h.Client('anon').get('/api/auth/setup');
  assert.deepEqual(s.json.defaultCredentials.map((x) => x.username), ['manager', 'author', 'auditor']);
});

test('the administration page: deployment (read-only) and which default accounts still have the default password; audit trail', async () => {
  const hl = await c.admin.get('/api/admin/health');
  assert.equal(hl.status, 200);
  assert.equal(hl.json.deployment.mode, 'standalone');
  const st = Object.fromEntries(hl.json.deployment.defaultAccounts.map((a) => [a.username, a.defaultPassword]));
  assert.deepEqual(st, { admin: false, manager: true, author: true, auditor: true });
  const users = (await c.admin.get('/api/admin/users')).json.users;
  assert.equal(users.find((u) => u.username === 'author').defaultPassword, true);

  const created = (await c.admin.get('/api/admin/audit?action=user.default_account_created')).json.entries;
  assert.equal(created.length, DEFAULTS.length);
  const changed = (await c.admin.get('/api/admin/audit?action=auth.password.changed')).json.entries;
  assert.equal(changed.length, 1);
  assert.deepEqual([changed[0].actor, changed[0].meta.forced, changed[0].meta.defaultAccount, changed[0].meta.defaultPasswordEnded], ['admin', true, true, true]);

  // an administrator's reset of a default account ends its default password too (it gets a temporary one, still forced to change)
  const author = users.find((u) => u.username === 'author');
  assert.equal((await c.admin.post(`/api/admin/users/${author.id}/reset`, {})).status, 200);
  const after = (await c.admin.get('/api/admin/health')).json.deployment.defaultAccounts.find((a) => a.username === 'author');
  assert.equal(after.defaultPassword, false);
});

/** A non-loopback IPv4 address of this computer, or null. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

test('from another address: a default password is refused, the credentials are not shown, the acknowledgement does not exist', async (t) => {
  const lan = lanAddress();
  if (!lan) { t.skip('this computer has no non-loopback IPv4 address'); return; }
  const server = http.createServer(require('../dist/app').createApp());
  await new Promise((r) => server.listen(0, lan, r));
  const port = server.address().port;
  // The connection comes from this computer's LAN address (not loopback); the Host names localhost so the DNS-rebinding rule lets it in.
  const send = (method, u, b) => new Promise((resolve, reject) => {
    const body = b === undefined ? null : JSON.stringify(b);
    const rq = http.request({ host: lan, port, path: u, method, localAddress: lan, headers: { host: `localhost:${port}`, ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) } }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (d) => { t += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch { /* not json */ } resolve({ status: res.statusCode, json, headers: res.headers }); });
    });
    rq.on('error', reject); if (body) rq.write(body); rq.end();
  });
  try {
    const post = (u, b) => send('POST', u, b);
    const r = await post('/api/auth/login', { username: 'manager', password: 'Manager@123' });
    assert.equal(r.status, 403, JSON.stringify(r.json));
    assert.equal(r.json.code, 'DEFAULT_PASSWORD_REMOTE');
    assert.equal(r.headers['set-cookie'], undefined, 'no session');
    const s = (await send('GET', '/api/auth/setup')).json;
    assert.equal(s.defaultCredentials, undefined);
    assert.equal((await post('/api/auth/default-credentials/acknowledge', {})).status, 404);
    // an account that changed its password signs in from there as before
    assert.equal((await post('/api/auth/login', { username: 'admin', password: NEW_PW })).status, 200);
    // (that sign-in displaced the loopback session: one session per account) sign in here again for the checks below
    assert.equal((await c.admin.post('/api/auth/login', { username: 'admin', password: NEW_PW })).status, 200);
    const refused = (await c.admin.get('/api/admin/audit?action=auth.login.refused')).json.entries;
    assert.ok(refused.some((e) => e.meta && e.meta.reason === 'default-password-remote'));
  } finally { await new Promise((r) => server.close(r)); }
});

test('acknowledging the first launch screen hides the credentials for good (audited once)', async () => {
  const anon = new h.Client('anon');
  assert.equal((await anon.post('/api/auth/default-credentials/acknowledge', {})).status, 200);
  assert.equal((await anon.post('/api/auth/default-credentials/acknowledge', {})).status, 200, 'idempotent');
  const s = await anon.get('/api/auth/setup');
  assert.equal(s.json.defaultCredentials, undefined);
  assert.equal(s.json.deployment, 'standalone');
  const acks = (await c.admin.get('/api/admin/audit?action=auth.default_credentials.acknowledged')).json.entries;
  assert.equal(acks.length, 1);
  // the accounts themselves are unchanged: manager still signs in with its default password (on this computer) and is still gated
  const m = await new h.Client('m2').post('/api/auth/login', { username: 'manager', password: 'Manager@123' });
  assert.equal(m.status, 200);
  assert.equal(m.json.gates.mustChangePassword, true);
});
