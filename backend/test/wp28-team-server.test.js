'use strict';
// WP-28 (Mode B team server; PRD-003 presence and lock visibility; PRD-007 warm standby; G-PERF-4 load figures).
// Presence over the WebSocket (who is in a project, on which document; only for readers; gone with the session; never on disk), check-out
// notices to the project's readers within 5 seconds, the connection and message limits, the administrator's load figures, and the copy of a
// scheduled backup to the warm-standby folder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { boot, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const MARK = `PRESENCE-${crypto.randomBytes(6).toString('hex')}`;
let h; let admin; let alice; let bob; let carol; let pid; let other;

async function person(role, username) {
  const made = await admin.post('/api/team/users', { username, fullName: `${username} Example`, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username);
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}
const send = (s, m) => s.ws.send(JSON.stringify(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  h = await boot({ ws: true });
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  alice = await person('author', 'alice28'); bob = await person('author', 'bob28'); carol = await person('author', 'carol28');
  pid = (await alice.post('/api/projects', { name: 'Team server A' })).json.project.id;
  other = (await carol.post('/api/projects', { name: 'Team server C' })).json.project.id;
  assert.equal((await alice.post(`/api/projects/${pid}/dms`, { file: DM, xml: h.sample(DM) })).status, 201);
  assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'bob28', role: 'editor' })).status, 200);
});
test.after(async () => { if (h) await h.close(); });

test('presence: a reader sees who is in the project and on which document; a non-member can neither appear nor hear it', async () => {
  const sa = await h.socket(alice); const sb = await h.socket(bob); const sc = await h.socket(carol);
  for (const s of [sa, sb, sc]) assert.equal(s.opened, true);
  send(sa, { type: 'presence', projectId: pid, doc: { kind: 'dm', path: DM, title: MARK }, mode: 'editing' });
  const ping = await sb.waitFor((m) => m.type === 'presence' && m.projectId === pid, 5000);
  assert.ok(ping, 'the other member is told within 5 seconds');
  const list = (await bob.get(`/api/projects/${pid}/presence`)).json;
  const a = list.people.find((p) => p.username === 'alice28');
  assert.ok(a, JSON.stringify(list));
  assert.equal(a.name, 'alice28 Example'); assert.equal(a.mode, 'editing');
  assert.deepEqual(a.doc, { kind: 'dm', path: DM, title: MARK });
  assert.equal(a.mine, false); assert.ok(list.heartbeatMs > 0 && list.ttlMs > list.heartbeatMs);
  // carol cannot read the project: her presence there is ignored, she gets nothing about it, and the list is closed to her
  send(sc, { type: 'presence', projectId: pid, doc: { kind: 'dm', path: DM } });
  await sleep(300);
  assert.ok(!(await alice.get(`/api/projects/${pid}/presence`)).json.people.some((p) => p.username === 'carol28'));
  assert.equal(sc.messages.filter((m) => m.projectId === pid).length, 0, 'nothing about project A reaches a non-member');
  assert.ok([403, 404].includes((await carol.get(`/api/projects/${pid}/presence`)).status), "the list is closed to a non-member");
  // an unchanged heartbeat sends no traffic; moving to another document does
  const before = sb.messages.length;
  send(sa, { type: 'presence', projectId: pid, doc: { kind: 'dm', path: DM, title: MARK }, mode: 'editing' });
  await sleep(300);
  assert.equal(sb.messages.length, before, 'a heartbeat that changes nothing is not broadcast');
  send(sa, { type: 'presence', projectId: pid, doc: null });
  assert.ok(await sb.waitFor((m, i = sb.messages.indexOf(m)) => m.type === 'presence' && i >= before, 3000));
  assert.equal((await bob.get(`/api/projects/${pid}/presence`)).json.people.find((p) => p.username === 'alice28').doc, null);
  // junk is ignored, not echoed
  for (const junk of ['not json', JSON.stringify({ type: 'presence', projectId: '../../etc' }), JSON.stringify({ type: 'other' })]) sa.ws.send(junk);
  await sleep(200);
  assert.equal(sa.ws.readyState, 1, 'the socket stays open');
  for (const s of [sa, sb, sc]) s.close();
  await sleep(300);
  assert.deepEqual((await bob.get(`/api/projects/${pid}/presence`)).json.people, [], 'closed connections leave the list');
});

test('check-outs are announced to the project readers within 5 seconds, with the holder; the presence call lists them with the path', async () => {
  const sb = await h.socket(bob); const sc = await h.socket(carol);
  const t0 = Date.now();
  assert.equal((await alice.post(`/api/projects/${pid}/dms/${DM}/checkout`, {})).status, 200);
  const taken = await sb.waitFor((m) => m.type === 'leases' && m.projectId === pid && !m.released, 5000);
  assert.ok(taken, 'the reader heard of the check-out'); assert.ok(Date.now() - t0 < 5000);
  assert.equal(taken.holder, 'alice28'); assert.ok(taken.path.endsWith(DM));
  const lease = (await bob.get(`/api/projects/${pid}/presence`)).json.leases.find((l) => l.holder === 'alice28');
  assert.ok(lease && lease.path && lease.path.endsWith(DM), 'the project list names the document');
  // a renewal is not news
  const n = sb.messages.length;
  assert.equal((await alice.post(`/api/projects/${pid}/dms/${DM}/checkout`, {})).status, 200);
  await sleep(300);
  assert.equal(sb.messages.filter((m, i) => i >= n && m.type === 'leases').length, 0);
  // the owner breaks it: "released", "broken"
  assert.equal((await alice.del(`/api/projects/${pid}/dms/${DM}/checkout`)).json.released, true);
  const back = await sb.waitFor((m) => m.type === 'leases' && m.released, 5000);
  assert.ok(back); assert.equal(back.broken, false);
  assert.equal((await bob.post(`/api/projects/${pid}/dms/${DM}/checkout`, {})).status, 200);
  assert.equal((await alice.del(`/api/projects/${pid}/dms/${DM}/checkout?break=1`)).status, 200);
  const broken = await sb.waitFor((m) => m.type === 'leases' && m.released && m.broken, 5000);
  assert.ok(broken, 'a broken check-out says so');
  await sleep(200);
  assert.equal(sc.messages.filter((m) => m.projectId === pid).length, 0, 'a non-member hears nothing');
  sb.close(); sc.close();
});

test('a session that ends takes its presence with it; nothing of presence is written to disk', async () => {
  const dave = await person('author', 'dave28');
  assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'dave28', role: 'editor' })).status, 200);
  const sd = await h.socket(dave); const sb = await h.socket(bob);
  send(sd, { type: 'presence', projectId: pid, doc: { kind: 'dm', path: DM, title: MARK } });
  assert.ok(await sb.waitFor((m) => m.type === 'presence', 5000));
  assert.ok((await bob.get(`/api/projects/${pid}/presence`)).json.people.some((p) => p.username === 'dave28'));
  const n = sb.messages.length;
  assert.equal((await dave.post('/api/auth/logout', {})).status, 200);
  const closed = await Promise.race([sd.closed, sleep(5000).then(() => null)]);
  assert.ok(closed, 'the signed-out socket is closed');
  assert.ok(await sb.waitFor((m) => m.type === 'presence' && sb.messages.indexOf(m) >= n, 5000), 'the others are told');
  assert.ok(!(await bob.get(`/api/projects/${pid}/presence`)).json.people.some((p) => p.username === 'dave28'));
  // PRD-003: the marker only ever travelled in presence messages; no file of the data folder (database, WAL, project files) holds it
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { try { if (fs.readFileSync(f).includes(MARK)) hits.push(f); } catch { /* locked */ } } } };
  walk(h.ws);
  assert.deepEqual(hits, []);
  sb.close();
});

test('limits: at most 8 sockets per session (429), oversized and flooding messages close the socket', async () => {
  const open = [];
  for (let i = 0; i < 8; i++) { const s = await h.socket(bob); assert.equal(s.opened, true, `socket ${i + 1}`); open.push(s); }
  const ninth = await h.socket(bob);
  assert.equal(ninth.opened, false); assert.equal(ninth.status, 429);
  for (const s of open) s.close();
  await sleep(300);
  const again = await h.socket(bob); assert.equal(again.opened, true, 'a closed socket frees its place');
  again.ws.send('x'.repeat(8192));
  const big = await Promise.race([again.closed, sleep(3000).then(() => null)]);
  assert.ok(big && big.code === 1009, `an oversized message closes the socket (got ${JSON.stringify(big)})`);
  const flood = await h.socket(bob);
  for (let i = 0; i < 150; i++) send(flood, { type: 'presence', projectId: pid, doc: { kind: 'dm', path: `F${i}` } });
  const shut = await Promise.race([flood.closed, sleep(3000).then(() => null)]);
  assert.ok(shut && shut.code === 1008, `a flood closes the socket (got ${JSON.stringify(shut)})`);
  await sleep(200);
  const people = (await alice.get(`/api/projects/${pid}/presence`)).json.people;
  assert.ok(!people.some((p) => p.doc && /^F\d+$/.test(p.doc.path) && Number(p.doc.path.slice(1)) >= 20), 'messages past the limit were not applied');
});

test('administrators read the load figures and can start a new window; nobody else can', async () => {
  assert.equal((await alice.get('/api/admin/metrics')).status, 403);
  assert.equal((await alice.post('/api/admin/metrics/reset', {})).status, 403);
  for (let i = 0; i < 5; i++) await alice.get(`/api/projects/${pid}/presence`);
  const m = (await admin.get('/api/admin/metrics')).json;
  assert.ok(m.db.statements > 0, 'statements are timed'); assert.equal(m.db.slowThresholdMs, 50);
  assert.ok(m.requests.count >= 5 && m.requests.p95 >= m.requests.p50);
  assert.ok(m.eventLoop.max >= 0 && typeof m.d21.writeP95Over200ms === 'boolean');
  assert.ok('wsClients' in m.live && 'presenceEntries' in m.live);
  assert.equal(m.server.mode, 'local'); assert.equal(m.server.wsMaxPerSession, 8);
  assert.equal((await admin.post('/api/admin/metrics/reset', {})).status, 200);
  const after = (await admin.get('/api/admin/metrics')).json;
  assert.ok(after.requests.count <= 2, `the window starts again (count ${after.requests.count})`);
  const audit = (await admin.get('/api/admin/audit?limit=20')).json;
  assert.ok(JSON.stringify(audit).includes('metrics.reset'));
});

test('warm standby: a scheduled backup is copied to the standby folder and checked; a copy that fails is audited and reported', async () => {
  const { defaultContext } = require('../dist/context');
  const dp = require('../dist/services/dataProtection');
  const { buildConfig } = require('../dist/config');
  assert.throws(() => buildConfig({ ...process.env, AGASTYA_BACKUP_COPY_DIR: 'relative\\standby' }), /AGASTYA_BACKUP_COPY_DIR/);
  assert.equal(buildConfig({ ...process.env, AGASTYA_BACKUP_COPY_DIR: '' }).backup.copyTo, null);
  const ctx = defaultContext();
  const made = await dp.backupNow(ctx, 'scheduled', null);
  const standby = path.join(tmp('agastya-standby-'), 'copies');
  assert.equal(await dp.copyToStandby(ctx, made, standby), true);
  const copy = path.join(standby, path.basename(made.file));
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  assert.equal(sha(copy), sha(made.file), 'the copy is byte-identical');
  assert.equal(dp.readState(ctx).lastCopy.ok, true);
  // a file where the folder should be: the copy fails, the original stays, the failure is recorded and audited
  const blocked = path.join(tmp('agastya-standby-bad-'), 'file'); fs.writeFileSync(blocked, 'x');
  assert.equal(await dp.copyToStandby(ctx, made, blocked), false);
  assert.ok(fs.existsSync(made.file));
  assert.equal(dp.readState(ctx).lastCopy.ok, false);
  const audit = (await admin.get('/api/admin/audit?limit=20')).json;
  assert.ok(JSON.stringify(audit).includes('backup.copy_failed') && JSON.stringify(audit).includes('backup.copied'));
});
