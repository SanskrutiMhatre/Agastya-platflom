'use strict';
// WP-09 (QA-005, QA-004): the WebSocket progress channel through the test harness (helpers.boot({ ws: true }) attaches the broadcaster the
// way index.ts does). Who may connect, who receives which project's messages, and what happens when access or the session ends.
// wp03-auth.test.js keeps its own checks (another origin refused, a disabled account closed within a second).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let bc; const P = {};
const NEW = { pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } };

async function person(name, role = 'author') {
  const m = await admin.post('/api/team/users', { username: name, fullName: `${name} tester`, role });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const c = new h.Client(name); c.id = m.json.user.id;
  assert.equal((await c.post('/api/auth/login', { username: name, password: m.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username: name, password: PW })).status, 200);
  return c;
}
const forProject = (pid) => (m) => m && m.projectId === pid;

test.before(async () => {
  h = await boot({ ws: true });
  bc = require('../dist/services/broadcast');
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  P.alice = await person('wsalice'); P.bob = await person('wsbob'); P.carol = await person('wscarol');
  P.a = (await P.alice.post('/api/projects', { name: 'Socket A', ...NEW })).json.project.id;
  P.b = (await P.bob.post('/api/projects', { name: 'Socket B', ...NEW })).json.project.id;
  assert.ok(P.a && P.b);
  assert.equal((await admin.post(`/api/admin/projects/${P.a}/members`, { username: 'wscarol', role: 'viewer' })).status, 200);
});
test.after(async () => { if (h) await h.close(); });

test('the harness: boot({ ws: true }) gives a socket helper; without a cookie the upgrade is refused with 401', async () => {
  assert.equal(typeof h.socket, 'function');
  const none = await h.socket(null);
  assert.equal(none.opened, false); assert.equal(none.status, 401);
  const forged = await h.socket(null, { headers: { cookie: 'agastya_session=' + 'x'.repeat(43) } });
  assert.equal(forged.status, 401, 'a made-up token');
  const evil = await h.socket(P.alice, { origin: 'http://evil.example' });
  assert.equal(evil.status, 403, 'another origin');
  const other = await h.socket(P.alice, { path: '/not-ws' });
  assert.equal(other.opened, false, 'only /ws upgrades');
  const ok = await h.socket(P.alice);
  assert.equal(ok.opened, true); ok.close();
});

test('a project\'s messages reach its members and the administrator, never a user of another project', async () => {
  const sa = await h.socket(P.alice); const sb = await h.socket(P.bob); const sc = await h.socket(P.carol); const sadm = await h.socket(admin);
  for (const s of [sa, sb, sc, sadm]) assert.equal(s.opened, true);
  bc.broadcast(P.a, { type: 'progress', message: 'secret progress of A' });
  bc.broadcast(P.b, { type: 'progress', message: 'secret progress of B' });
  assert.equal((await sa.waitFor(forProject(P.a))).message, 'secret progress of A', 'the owner of A');
  assert.equal((await sc.waitFor(forProject(P.a))).message, 'secret progress of A', 'a viewer of A');
  assert.ok(await sadm.waitFor(forProject(P.a)), 'the administrator sees every project');
  assert.ok(await sadm.waitFor(forProject(P.b)));
  assert.ok(await sb.waitFor(forProject(P.b)), 'the owner of B');
  // give stray deliveries time to arrive, then check nothing crossed over
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sa.messages.filter(forProject(P.b)).length, 0, 'A never receives B');
  assert.equal(sc.messages.filter(forProject(P.b)).length, 0);
  assert.equal(sb.messages.filter(forProject(P.a)).length, 0, 'B never receives A');
  for (const s of [sa, sb, sc, sadm]) s.close();
});

test('a real build announces its progress to the project\'s members only (end to end through the publisher)', async () => {
  const sa = await h.socket(P.alice); const sb = await h.socket(P.bob);
  const build = await P.alice.post(`/api/projects/${P.a}/publish`, {});
  assert.ok([200, 422, 500].includes(build.status), `build answered ${build.status}`);
  const done = await sa.waitFor((m) => forProject(P.a)(m) && m.type === 'progress' && (m.done || m.error), 5000);
  assert.ok(done, 'the end of the build (done or failed) reached the member');
  assert.ok(sa.messages.filter(forProject(P.a)).length >= 2, 'progress lines too');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sb.messages.filter(forProject(P.a)).length, 0, 'a user of another project heard nothing');
  sa.close(); sb.close();
});

test('a member removed from the project stops receiving at once; added back, receives again', async () => {
  const sc = await h.socket(P.carol); assert.equal(sc.opened, true);
  bc.broadcast(P.a, { type: 'reload', kind: 'before-removal' });
  assert.ok(await sc.waitFor((m) => m.kind === 'before-removal'), 'still a member');
  const removed = await P.alice.del(`/api/projects/${P.a}/members/${P.carol.id}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  bc.broadcast(P.a, { type: 'reload', kind: 'after-removal' });
  assert.equal(await sc.waitFor((m) => m.kind === 'after-removal', 500), null, 'no message after removal (the per-connection cache is dropped on the change)');
  assert.equal((await admin.post(`/api/admin/projects/${P.a}/members`, { username: 'wscarol', role: 'viewer' })).status, 200);
  bc.broadcast(P.a, { type: 'reload', kind: 'after-readd' });
  assert.ok(await sc.waitFor((m) => m.kind === 'after-readd'), 'added back');
  sc.close();
});

test('the socket closes with 4401 on sign-out, on a newer sign-in and on an administrator revoking the session', async () => {
  const closesWith = async (s) => { const r = await Promise.race([s.closed, new Promise((res) => setTimeout(() => res({ code: 'timeout' }), 2000))]); return r.code; };
  // sign-out
  const s1 = await h.socket(P.bob); assert.equal(s1.opened, true);
  assert.equal((await P.bob.post('/api/auth/logout', {})).status, 200);
  assert.equal(await closesWith(s1), bc.WS_CLOSE_SESSION_ENDED, 'sign-out');
  // a newer sign-in elsewhere (single session)
  assert.equal((await P.bob.post('/api/auth/login', { username: 'wsbob', password: PW })).status, 200);
  const s2 = await h.socket(P.bob); assert.equal(s2.opened, true);
  const elsewhere = new h.Client('wsbob-2'); assert.equal((await elsewhere.post('/api/auth/login', { username: 'wsbob', password: PW })).status, 200);
  assert.equal(await closesWith(s2), bc.WS_CLOSE_SESSION_ENDED, 'displaced by a newer sign-in');
  // revoked by the administrator
  const s3 = await h.socket(elsewhere); assert.equal(s3.opened, true);
  const sid = (await admin.get('/api/admin/sessions')).json.sessions.find((s) => s.username === 'wsbob').id;
  assert.equal((await admin.post(`/api/admin/sessions/${sid}/revoke`, {})).status, 200);
  assert.equal(await closesWith(s3), bc.WS_CLOSE_SESSION_ENDED, 'revoked');
  const again = await h.socket(elsewhere);
  assert.equal(again.status, 401, 'the revoked cookie cannot reconnect');
  assert.equal(again.headers['x-session-ended'], 'admin-revoked', 'and the refusal says why');
});
