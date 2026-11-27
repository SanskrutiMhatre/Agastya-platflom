'use strict';
// WP-03 (audit PLT-014, SEC-004, ENT-002, SEC-007, SEC-008, ENT-011, PLT-023, REL-006, SEC-010, PLT-017, FE-011, PERF-018,
// SEC-016, ENT-010, PLT-022, UX-022, PLT-015, ENT-009, PLT-019, SEC-013, ENT-012, FE-017, RES-009, SEC-012): the auth-core
// suite of QA-004. Temporary passwords, directory lookup, the sign-in throttle, the client address, session lifetime and
// reasons, the WebSocket after a revoke, the Origin rule, separation of duties, error bodies, headers and the audit trail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');
let h; let admin; let ctx;

const person = async (name, role = 'author') => {
  const m = await admin.post('/api/team/users', { username: name, fullName: `${name[0].toUpperCase()}${name.slice(1)} Tester`, role });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const c = new h.Client(name);
  assert.equal((await c.post('/api/auth/login', { username: name, password: m.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username: name, password: PW })).status, 200);
  return { c, temp: m.json.tempPassword, id: m.json.user.id };
};
const fromIp = (client, ip, method, url, body) => client.req(method, url, body, { 'x-forwarded-for': ip });
const db = () => ctx.store;

test.before(async () => {
  h = await boot(); ctx = require('../dist/context');
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
});
test.after(async () => { if (h) await h.close(); });

test('temporary passwords are random (CSPRNG), single-use by the onboarding gate, and never username@year (PLT-014, SEC-004, ENT-002)', async () => {
  const seen = new Set();
  for (const n of ['tara', 'tarun', 'tanvi']) {
    const m = await admin.post('/api/team/users', { username: n, fullName: n, role: 'author' });
    assert.match(m.json.tempPassword, new RegExp(`^${n}-[a-hjkmnp-z2-9]{8}$`));
    assert.notEqual(m.json.tempPassword, `${n}@${new Date().getFullYear()}`);
    seen.add(m.json.tempPassword.split('-')[1]);
  }
  assert.equal(seen.size, 3, 'no two random parts alike');
  const { tempPasswordFor } = require('../dist/core/auth/policy');
  const many = new Set(Array.from({ length: 200 }, () => tempPasswordFor('x')));
  assert.equal(many.size, 200);
  const guess = new h.Client('guess');
  assert.equal((await guess.post('/api/auth/login', { username: 'tara', password: `tara@${new Date().getFullYear()}` })).status, 401, 'the old guessable password does not work');
});

test('only people who manage a project can look others up (SEC-004)', async () => {
  const { c: plain } = await person('plainauthor');
  assert.equal((await plain.get('/api/users/search?q=ta')).status, 403, 'an author with no project to manage');
  const { c: pm } = await person('pmone', 'project_manager');
  assert.equal((await pm.get('/api/users/search?q=ta')).status, 200);
  assert.equal((await admin.get('/api/users/search?q=ta')).status, 200);
  const made = await plain.post('/api/projects', { name: 'Own book' });
  if (made.status === 201) assert.equal((await plain.get('/api/users/search?q=ta')).status, 200, 'the owner of a project may add people to it');
});

test('the sign-in throttle counts an account over every address, and an address over every account; it is kept in the database (SEC-007, SEC-008, REL-006)', async () => {
  await person('victim');
  const anon = new h.Client('anon');
  for (let i = 0; i < 10; i++) {
    const r = await fromIp(anon, `198.51.100.${i + 1}`, 'POST', '/api/auth/login', { username: 'victim', password: `wrong-${i}` });
    assert.equal(r.status, 401, `attempt ${i + 1}`);
  }
  const blocked = await fromIp(anon, '198.51.100.200', 'POST', '/api/auth/login', { username: 'victim', password: PW });
  assert.equal(blocked.status, 429, 'rotating the address does not buy more guesses');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.ok(db().throttleGet('victim').length >= 10, 'the account counter is in the database (it survives a restart)');
  // one address cycling through usernames
  let status = 0;
  for (let i = 0; i < 101 && status !== 429; i++) status = (await fromIp(anon, '203.0.113.7', 'POST', '/api/auth/login', { username: `nobody${i}`, password: 'x'.repeat(16) })).status;
  assert.equal(status, 429, 'one address is limited across usernames');
  // a successful sign-in from a busy office address does not count against it
  const { RateLimiter } = require('../dist/core/auth/rateLimit');
  const rl = new RateLimiter({ ipMax: 3 });
  for (let i = 0; i < 10; i++) { assert.equal(rl.attempt(`u${i}`, '10.0.0.1').allowed, true); rl.clear(`u${i}`, '10.0.0.1'); }
});

test('the audit trail records the client address (honouring the trust-proxy setting) and keeps fingerprints while dropping secrets (SEC-008, ENT-011, SEC-012)', async () => {
  const c = new h.Client('ipcheck');
  await fromIp(c, '192.0.2.55', 'POST', '/api/auth/login', { username: 'ipcheck-nobody', password: 'x'.repeat(16) });
  const row = db().listAudit({ limit: 20 }).find((r) => r.action === 'auth.login.failed' && /ipcheck-nobody/.test(r.meta || ''));
  assert.ok(row, 'the failed sign-in is in the trail'); assert.equal(row.ip, '192.0.2.55');
  const { redactAuditMeta } = ctx;
  const kept = redactAuditMeta({ contentHash: 'ab'.repeat(32), fingerprint: 'zzz', password: 'p', newPassword: 'p2', token: 't', tokenHash: 'h', nested: { password_hash: '$argon2id$v=19$m=1', note: '$argon2id$v=19$m=65536$xyz' } });
  assert.equal(kept.contentHash, 'ab'.repeat(32), 'contentHash is kept (it is a fingerprint, not a secret)');
  assert.equal(kept.fingerprint, 'zzz');
  for (const k of ['password', 'newPassword', 'token', 'tokenHash']) assert.ok(!(k in kept), k);
  assert.ok(!('password_hash' in kept.nested)); assert.equal(kept.nested.note, '[redacted]', 'a password hash under any name');
  // a failing audit write is counted and visible to administrators
  const orig = db().appendAudit; db().appendAudit = () => { throw new Error('disk I/O error'); };
  try { ctx.audit({ action: 'test.audit_failure' }); } finally { db().appendAudit = orig; }
  const health = await admin.get('/api/admin/health');
  assert.equal(health.status, 200); assert.ok(health.json.audit.failures >= 1); assert.equal(health.json.audit.last.action, 'test.audit_failure');
  assert.ok(fs.readFileSync(path.join(h.ws, 'logs', 'audit-failures.log'), 'utf8').includes('test.audit_failure'));
});

test('sessions: 12-hour absolute limit with a matching cookie, 30-minute idle limit, background requests are not activity, and the 401 says why (SEC-016, ENT-010, PLT-022, UX-022)', async () => {
  const { c } = await person('sesha');
  const me = await c.get('/api/auth/me'); assert.equal(me.status, 200);
  const s = db().listActiveSessions(new Date().toISOString()).find((x) => x.username === 'sesha');
  assert.equal(Date.parse(s.expires_at) - Date.parse(s.created_at), 12 * 3600 * 1000, 'absolute limit 12 h');
  const login = await new h.Client('sesha2').post('/api/auth/login', { username: 'sesha', password: PW });
  assert.match(login.headers.get('set-cookie'), /Max-Age=43200/);
  // the second sign-in displaced the first: its next request is told why
  const gone = await c.get('/api/auth/me');
  assert.equal(gone.status, 401); assert.equal(gone.json.code, 'SESSION_DISPLACED'); assert.match(gone.json.error, /signed in on another computer/);
  // idle: a session last used 31 minutes ago is ended with the reason "idle"
  const { c: d } = await person('idler');
  const sid = db().listActiveSessions(new Date().toISOString()).find((x) => x.username === 'idler').id;
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const seen = () => db().listActiveSessions(new Date().toISOString()).find((x) => x.id === sid).last_seen_at;
  db().touchSession(sid, ago(2)); const before = seen();
  assert.equal((await d.req('GET', '/api/notifications/unread-count', undefined, { 'x-agastya-background': '1' })).status, 200);
  assert.equal(seen(), before, 'a background request is not activity');
  assert.equal((await d.post('/api/auth/activity', {})).status, 200, 'the activity signal');
  assert.ok(Date.now() - Date.parse(db().listActiveSessions(new Date().toISOString()).find((x) => x.id === sid).last_seen_at) < 5000, 'activity refreshes the session');
  db().touchSession(sid, ago(31));
  const idle = await d.get('/api/auth/me');
  assert.equal(idle.status, 401); assert.equal(idle.json.code, 'SESSION_IDLE');
});

test('the policy is the administrator\'s: limits and single session are settings, validated and audited', async () => {
  assert.equal((await admin.put('/api/admin/security-policy', { idleMinutes: 3 })).status, 400, 'below the minimum');
  assert.equal((await admin.put('/api/admin/security-policy', { idleMinutes: 2000, absoluteHours: 12 })).status, 400);
  const ok = await admin.put('/api/admin/security-policy', { singleSession: false });
  assert.equal(ok.status, 200); assert.equal(ok.json.policy.singleSession, false);
  const { c: a } = await person('twodevices');
  const b = new h.Client('twodevices-b'); assert.equal((await b.post('/api/auth/login', { username: 'twodevices', password: PW })).status, 200);
  assert.equal((await a.get('/api/auth/me')).status, 200, 'both sessions stay when the policy allows two devices');
  assert.equal((await admin.put('/api/admin/security-policy', { singleSession: true })).status, 200);
  assert.ok(db().listAudit({ limit: 10 }).some((r) => r.action === 'settings.security_policy'));
  const { c: x } = await person('notadmin');
  assert.equal((await x.put('/api/admin/security-policy', { idleMinutes: 0 })).status, 403);
});

test('new passwords follow the policy minimum (15) and refuse a bare name (RES-009)', async () => {
  const { c } = await person('pwrule');
  const short = await c.post('/api/auth/change-password', { currentPassword: PW, newPassword: 'Short-pass-12' });
  assert.equal(short.status, 400); assert.match(short.json.error, /at least 15/);
  const name = await c.post('/api/auth/change-password', { currentPassword: PW, newPassword: 'pwrule-2026-2026-!!' });
  assert.equal(name.status, 400, 'username plus digits and symbols');
  assert.equal((await c.post('/api/auth/change-password', { currentPassword: PW, newPassword: 'blue harbour lantern 7' })).status, 200);
});

test('the WebSocket refuses another origin, and closes within a second when the account is disabled (SEC-010, PLT-017, ENT-012)', async () => {
  const WebSocket = require('ws');
  const wsBase = h.base.replace('http', 'ws');
  // the helpers' server is plain http.createServer(app): attach the broadcaster as index.ts does
  const { attach } = require('../dist/services/broadcast');
  const srv = [...process._getActiveHandles()].find((x) => x && typeof x.address === 'function' && x.address() && x.address().port === Number(new URL(h.base).port));
  assert.ok(srv, 'the test server'); attach(srv);
  const { c, id } = await person('socky');
  const open = (headers) => new Promise((resolve) => {
    const ws = new WebSocket(`${wsBase}/ws`, { headers });
    ws.on('open', () => resolve({ ws, opened: true }));
    ws.on('unexpected-response', (_req, res) => resolve({ opened: false, status: res.statusCode }));
    ws.on('error', () => resolve({ opened: false, status: 0 }));
  });
  const evil = await open({ cookie: c.cookie, origin: 'http://evil.example' });
  assert.equal(evil.opened, false); assert.equal(evil.status, 403, 'another origin is refused');
  const good = await open({ cookie: c.cookie, origin: h.base });
  assert.equal(good.opened, true);
  const closed = new Promise((resolve) => good.ws.on('close', (code) => resolve({ code, at: Date.now() })));
  const t0 = Date.now();
  assert.equal((await admin.post(`/api/admin/users/${id}/disable`, {})).status, 200);
  const r = await Promise.race([closed, new Promise((res) => setTimeout(() => res({ code: 'timeout' }), 1500))]);
  assert.equal(r.code, 4401, 'closed with the session-ended code');
  assert.ok(r.at - t0 < 1000, `closed in ${r.at - t0} ms`);
  const after = await open({ cookie: c.cookie, origin: h.base });
  assert.equal(after.opened, false); assert.equal(after.status, 401);
});

test('separation of duties: the person who requests a release cannot approve it; an administrator can allow it for a one-person installation (PLT-015, ENT-009, D7)', async () => {
  const { c: pm } = await person('soloPm'.toLowerCase(), 'project_manager');
  const mk = await pm.post('/api/projects', { name: 'Solo', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(mk.status, 201, JSON.stringify(mk.json).slice(0, 300));
  const U = `/api/projects/${mk.json.project.id}`; const dir = path.join(h.ws, 'projects', mk.json.project.id);
  const f040 = fs.readdirSync(FIX).find((f) => f.includes('-040A-D_'));
  assert.equal((await pm.post(`${U}/dms`, { file: f040, xml: fs.readFileSync(path.join(FIX, f040), 'utf8') })).status, 201);
  const code = /<dmCode\s+([^>]*?)\s*\/?>/.exec(fs.readFileSync(path.join(FIX, f040), 'utf8'))[1];
  const pmx = fs.readFileSync(path.join(dir, 'publication.xml'), 'utf8'); const content = `<content><pmEntry><pmEntryTitle>All</pmEntryTitle><dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef></pmEntry></content>`;
  fs.writeFileSync(path.join(dir, 'publication.xml'), /<content[\s\S]*<\/content>|<content\s*\/>/.test(pmx) ? pmx.replace(/<content[\s\S]*<\/content>|<content\s*\/>/, content) : pmx.replace('</pm>', `${content}</pm>`));
  const req = await pm.post(`${U}/release`, {}); assert.equal(req.status, 200, JSON.stringify(req.json).slice(0, 300));
  const ov = (await pm.get(`${U}/release`)).json;
  assert.equal(ov.canApprove, false); assert.match(ov.approveBlocked, /separation of duties/);
  const own = await pm.post(`${U}/release/${ov.pending.id}/approve`, {});
  assert.equal(own.status, 403); assert.equal(own.json.code, 'SEPARATION_OF_DUTIES');
  assert.equal(db().getRelease(ov.pending.id).status, 'pending', 'nothing was issued or decided');
  assert.equal((await admin.put('/api/admin/security-policy', { separationOfDuties: false })).status, 200);
  try {
    const ok = await pm.post(`${U}/release/${ov.pending.id}/approve`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 300));
  } finally { await admin.put('/api/admin/security-policy', { separationOfDuties: true }); }
});

test('a 500 answers with a reference, never the raw message; a malformed body is a 400 (PLT-019, SEC-013)', async () => {
  const { wrap } = require('../dist/services/http');
  let status = 0; let body = null;
  const res = { headersSent: false, status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  const orig = console.error; console.error = () => undefined;
  try { await new Promise((done) => { wrap(() => { throw new Error('SQLITE_ERROR: no such table: secret_users at C:\\data\\x.db'); })({ method: 'GET', originalUrl: '/x', requestId: 'abc123' }, { ...res, json(b) { body = b; done(); return this; } }, () => done()); }); } finally { console.error = orig; }
  assert.equal(status, 500); assert.equal(body.id, 'abc123'); assert.equal(body.code, 'INTERNAL');
  assert.ok(!JSON.stringify(body).includes('secret_users') && !('details' in body), JSON.stringify(body));
  const bad = await fetch(`${h.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username": ' });
  assert.equal(bad.status, 400);
  assert.ok(bad.headers.get('x-request-id'), 'every response carries its request id');
});

test('security headers on the API and on the application (ENT-012, FE-017)', async () => {
  const api = await fetch(`${h.base}/api/health`);
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(api.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(api.headers.get('content-security-policy'), "frame-ancestors 'self'");
  assert.equal(api.headers.get('x-powered-by'), null);
  const page = await fetch(`${h.base}/login`);
  const csp = page.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/); assert.match(csp, /frame-ancestors 'self'/); assert.match(csp, /object-src 'self' blob:/);
  assert.ok(!/https?:/.test(csp), 'nothing from another origin');
  assert.ok(!/'unsafe-inline'/.test(csp.split(';').find((d) => d.trim().startsWith('script-src'))), 'no inline script');
});
