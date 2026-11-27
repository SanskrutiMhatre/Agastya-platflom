'use strict';
// WP-29 (ENT-003, ENT-017, ENT-020, REL-008, RES-004; gates G-SEC-4, G-REL-8): the tamper-evident audit trail and its operations.
//   - seeded tamper tests on copies: an edited row, a deleted middle row, a forged row, a row inserted outside the chain, and the newest
//     10 rows cut off (detected against the checkpoint kept in the backup folder even when the database's own checkpoints are deleted);
//     the offline verifier, the command-line tool's exit codes and the wrong / missing key
//   - the chain survives a platform backup and restore, and retention (archive + anchor); a cut at the start is still detected
//   - fault-injected audit writes: critical actions (role change, sign-in, release approval, membership) are refused and roll back;
//     an ordinary action goes ahead, counted, logged and raised as event 4100
//   - security events with stable ids (test sink and the host line format), streamed export of 20 000 rows, viewer filters, admin-only routes
//   - waiver history with reasons and expiry; the release approval names the fingerprint
//   - structured JSON logs: every line parses, seeded secrets are absent, rotation keeps N files
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { boot, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
const NEW = { pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } };
let h; let admin; let D;    // D: the compiled modules, loaded after boot()

async function person(name, role = 'author') {
  const m = await admin.post('/api/team/users', { username: name, fullName: `${name} tester`, role });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const c = new h.Client(name); c.id = m.json.user.id;
  assert.equal((await c.post('/api/auth/login', { username: name, password: m.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username: name, password: PW })).status, 200);
  return c;
}

test.before(async () => {
  h = await boot(); admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  D = {
    config: require('../dist/config'), appContext: require('../dist/appContext'), trail: require('../dist/services/auditTrail'),
    offline: require('../dist/storage/auditOffline'), events: require('../dist/services/securityEvents'), log: require('../dist/services/log'),
    dp: require('../dist/services/dataProtection'), pb: require('../dist/services/platformBackup'), ctx: require('../dist/context'),
    waivers: require('../dist/services/publishWaivers'),
  };
});
test.after(async () => { if (h) await h.close(); });

/** A separate data folder with its own context and key, started; `rows` audit rows written. */
function fresh(rows = 30, env = {}) {
  const ws = tmp('agastya-wp29-');
  const ctx = D.appContext.createAppContext(D.config.buildConfig({ AGASTYA_WORKSPACE_DIR: ws, ...env }));
  ctx.start();
  for (let i = 0; i < rows; i++) ctx.audit({ actorId: 'u1', actorUsername: 'alice', action: `test.row.${i}`, projectId: 'p1', meta: { i } });
  return { ws, ctx };
}
const raw = (ws, fn) => { const db = new DatabaseSync(path.join(ws, 'publisher.db')); try { return fn(db); } finally { db.close(); } };
const verify = (ws, o = {}) => D.offline.verifyWorkspaceAudit({ workspaceDir: ws, ...o });
const kinds = (rep) => [...new Set(rep.problems.map((p) => p.kind))].sort();
const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'agastya-audit.js'), ...args], { encoding: 'utf8', env: { ...process.env, AGASTYA_AUDIT_KEY_FILE: '' } });

test('G-SEC-4: an intact chain verifies; the rows carry seq, prev_hash, row_hash and the key id; the CLI exits 0', () => {
  const { ws, ctx } = fresh(30);
  const cp = D.trail.writeCheckpoint(ctx, 'test');
  assert.equal(cp.seq, 30);
  const online = D.trail.verifyAudit(ctx, { raise: false });
  assert.equal(online.ok, true, online.summary); assert.equal(online.chained, 30); assert.equal(online.checkpoints.checked >= 1, true);
  ctx.close();
  const rows = raw(ws, (db) => db.prepare('SELECT seq, prev_hash, row_hash, chain_key FROM audit_log ORDER BY seq').all());
  assert.deepEqual(rows.map((r) => r.seq), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.equal(rows[1].prev_hash, rows[0].row_hash, 'each row links to the one before');
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.row_hash) && r.chain_key === ctx.auditKey().id));
  assert.ok(!raw(ws, (db) => JSON.stringify(db.prepare('SELECT * FROM audit_checkpoints').all())).includes(fs.readFileSync(ctx.auditKey().file, 'utf8').trim()), 'the key is not in the database');
  const off = verify(ws); assert.equal(off.ok, true, off.summary);
  const r = cli('verify', '--workspace', ws);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /^OK: audit chain intact: 30 row\(s\) verified/);
});

test('G-SEC-4: an edited row, a deleted middle row, a forged row and a row inserted outside the chain are each detected (CLI exit 1)', () => {
  const tamper = {
    edited: (db) => db.prepare(`UPDATE audit_log SET meta = '{"i":999}' WHERE seq = 10`).run(),
    'deleted-middle': (db) => db.prepare('DELETE FROM audit_log WHERE seq = 15').run(),
    forged: (db) => { const last = db.prepare('SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1').get();
      db.prepare("INSERT INTO audit_log (at, actor_username, action, seq, prev_hash, row_hash, chain_key) VALUES (?, 'mallory', 'release.approved', ?, ?, ?, ?)")
        .run(last.at, last.seq + 1, last.row_hash, 'f'.repeat(64), last.chain_key); },
    unchained: (db) => db.prepare("INSERT INTO audit_log (at, actor_username, action) VALUES ('2026-11-27T00:00:00.000Z', 'mallory', 'user.updated')").run(),
  };
  const expect = { edited: ['content'], 'deleted-middle': ['link', 'missing'], forged: ['content'], unchained: ['inserted'] };
  for (const [name, fn] of Object.entries(tamper)) {
    const { ws, ctx } = fresh(30); D.trail.writeCheckpoint(ctx, 'test'); ctx.close();
    raw(ws, fn);
    const rep = verify(ws);
    assert.equal(rep.ok, false, `${name} is detected`);
    assert.deepEqual(kinds(rep), expect[name], `${name}: ${rep.summary}`);
    const r = cli('verify', '--workspace', ws);
    assert.equal(r.status, 1, `${name}: the CLI exits 1`); assert.match(r.stdout, /^BROKEN/);
  }
});

test('G-SEC-4: deleting the newest 10 rows is detected against the checkpoint in the backup folder, even with the database checkpoints gone', () => {
  const { ws, ctx } = fresh(30); D.trail.writeCheckpoint(ctx, 'test'); ctx.close();
  raw(ws, (db) => { db.prepare('DELETE FROM audit_log WHERE seq > 20').run(); db.prepare('DELETE FROM audit_checkpoints').run(); });
  const rep = verify(ws);
  assert.equal(rep.ok, false);
  assert.deepEqual(kinds(rep), ['truncated']);
  assert.match(rep.problems[0].message, /recorded 30 rows; the chain now ends at 20: the newest 10 row\(s\) were removed/);
  // without any checkpoint outside the database the cut is NOT visible: the documented limit (docs/OPERATIONS.md section 13)
  fs.rmSync(path.join(ws, 'backups', 'platform', 'audit-checkpoints.jsonl'));
  assert.equal(verify(ws).ok, true);
  // a checkpoint kept elsewhere by an auditor is honoured (--checkpoints)
  const kept = tmp('agastya-wp29-cp-'); const { ws: ws2, ctx: c2 } = fresh(12); D.trail.writeCheckpoint(c2, 'auditor copy'); c2.close();
  fs.copyFileSync(path.join(ws2, 'backups', 'platform', 'audit-checkpoints.jsonl'), path.join(kept, 'cp.jsonl'));
  fs.rmSync(path.join(ws2, 'backups', 'platform', 'audit-checkpoints.jsonl'));
  raw(ws2, (db) => { db.prepare('DELETE FROM audit_log WHERE seq > 9').run(); db.prepare('DELETE FROM audit_checkpoints').run(); });
  assert.equal(verify(ws2).ok, true, 'nothing left to compare with');
  const withKept = verify(ws2, { checkpointFiles: [path.join(kept, 'cp.jsonl')] });
  assert.deepEqual(kinds(withKept), ['truncated']);
  assert.equal(cli('verify', '--workspace', ws2, '--checkpoints', path.join(kept, 'cp.jsonl')).status, 1);
  // a forged checkpoint (no valid signature) is reported, not trusted
  fs.appendFileSync(path.join(kept, 'cp.jsonl'), `${JSON.stringify({ at: 'x', seq: 99, row_hash: 'a'.repeat(64), chain_key: c2.auditKey().id, reason: 'forged', signature: 'b'.repeat(64) })}\n`);
  assert.ok(verify(ws2, { checkpointFiles: [path.join(kept, 'cp.jsonl')] }).problems.some((p) => p.kind === 'checkpoint'));
});

test('the key: another key reports "key" problems; a missing key is a refusal, never a silently new key (CLI exit 2)', () => {
  const { ws, ctx } = fresh(5); ctx.close();
  const other = path.join(tmp('agastya-wp29-key-'), 'other.key');
  require('../dist/core/auth/auditChain').loadOrCreateKey(other);
  const rep = verify(ws, { keyFile: other });
  assert.equal(rep.ok, false); assert.ok(kinds(rep).includes('key'), rep.summary);
  const keyFile = path.join(ws, 'audit-key', 'audit-hmac.key');
  const saved = fs.readFileSync(keyFile); fs.rmSync(keyFile);
  assert.throws(() => verify(ws), (e) => e instanceof D.offline.AuditOfflineError && /key .* is missing/.test(e.message));
  assert.equal(fs.existsSync(keyFile), false, 'the verifier did not make a new key');
  const r = cli('verify', '--workspace', ws); assert.equal(r.status, 2); assert.match(r.stderr, /CANNOT VERIFY/);
  fs.writeFileSync(keyFile, 'not a key');
  assert.throws(() => D.appContext.createAppContext(D.config.buildConfig({ AGASTYA_WORKSPACE_DIR: ws })), /does not hold a key/, 'a damaged key file stops the start');
  fs.writeFileSync(keyFile, saved);
  assert.equal(verify(ws).ok, true);
});

test('the chain survives a platform backup and a restore into a new folder, and continues there; retention archives a prefix and anchors it', async () => {
  const { ws, ctx } = fresh(20);
  const made = await D.dp.backupNow(ctx, 'manual', null);
  ctx.close();
  assert.ok(D.ctx && made.file);
  const target = path.join(tmp('agastya-wp29-restore-'), 'restored');
  await D.pb.restorePlatformBackup(made.file, target, D.dp.migrationSteps());
  const rep = verify(target);
  assert.equal(rep.ok, true, rep.summary); assert.ok(rep.chained >= 20); assert.ok(rep.checkpoints.checked >= 1, 'the checkpoint taken with the backup travelled in it');
  const again = D.appContext.createAppContext(D.config.buildConfig({ AGASTYA_WORKSPACE_DIR: target })); again.start();
  again.audit({ actorUsername: 'alice', action: 'after.restore' }); again.close();
  assert.equal(verify(target).ok, true, 'new rows continue the restored chain');

  // retention: 6 rows 3 years old, then young ones; the old ones are archived and removed, the anchor lets the rest verify
  const old = '2023-01-01T00:00:00.000Z';
  const r = fresh(0, { AGASTYA_AUDIT_RETENTION_DAYS: '365' });
  for (let i = 0; i < 6; i++) r.ctx.audit({ actorUsername: 'alice', action: `old.${i}`, at: old });
  for (let i = 0; i < 4; i++) r.ctx.audit({ actorUsername: 'alice', action: `young.${i}` });
  const counts = D.dp.runRetention(r.ctx);
  assert.equal(counts.auditArchived, 6);
  const v = D.trail.verifyAudit(r.ctx, { raise: false });
  assert.equal(v.ok, true, v.summary); assert.equal(v.anchor.seq, 6); assert.match(v.anchor.archive, /audit-archive/);
  r.ctx.close();
  raw(r.ws, (db) => db.prepare('DELETE FROM audit_log WHERE seq = 7').run());
  assert.equal(verify(r.ws).ok, false, 'removing the first remaining row without retention is detected');
});

// ---- the running server -------------------------------------------------------------------------------------------------------------

function injectAuditFailure(pred) {
  const store = D.ctx.defaultContext().store;
  const orig = store.appendAudit;
  store.appendAudit = function (row) { if (pred(row)) throw new Error('injected audit write failure'); return orig.call(this, row); };
  return () => { store.appendAudit = orig; };
}

test('G-REL-8: a critical action whose audit row cannot be written is refused and rolled back; an ordinary one goes ahead and is flagged', async () => {
  const seen = []; const prevSink = D.events.setSecurityEventSink((e) => seen.push(e));
  try {
    const bob = await person('bob');
    const { store } = D.ctx.defaultContext();
    // platform role
    let undo = injectAuditFailure((r) => r.action === 'user.updated');
    let res = await admin.patch(`/api/admin/users/${bob.id}`, { role: 'project_manager' });
    undo();
    assert.equal(res.status, 503); assert.equal(res.json.code, 'AUDIT_UNAVAILABLE');
    assert.equal(store.getUser(bob.id).role, 'author', 'the role change was rolled back');
    // sign-in
    const sessionsOf = () => store.listActiveSessions(new Date().toISOString()).filter((s) => s.user_id === bob.id).length;
    const before = sessionsOf();
    undo = injectAuditFailure((r) => r.action === 'auth.login');
    const again = new h.Client('bob2');
    res = await again.post('/api/auth/login', { username: 'bob', password: PW });
    undo();
    assert.equal(res.status, 503); assert.equal(res.json.code, 'AUDIT_UNAVAILABLE'); assert.equal(again.cookie, '', 'no session cookie');
    assert.equal(sessionsOf(), before, 'no session was created');
    // release approval (ENT-020: the row names the fingerprint)
    const pm = await person('pm1', 'project_manager');
    const pid = (await pm.post('/api/projects', { name: 'WP29 release', ...NEW })).json.project.id;
    const now = new Date().toISOString();
    store.stmt("INSERT INTO documents (id, project_id, rel_path, kind, created_at, updated_at) VALUES ('wp29-doc', ?, 'wp29-release-anchor.xml', 'pm', ?, ?)").run(pid, now, now);
    store.createRelease({ id: 'wp29-rel', documentId: 'wp29-doc', projectId: pid, scheduledAt: now, note: null, requestedBy: bob.id, contentHash: 'c0ffee'.repeat(10) + 'abcd', now });
    undo = injectAuditFailure((r) => r.action === 'release.approved');
    res = await admin.post('/api/admin/releases/wp29-rel/approve', {});
    undo();
    assert.equal(res.status, 503); assert.equal(store.getRelease('wp29-rel').status, 'pending', 'the approval was rolled back');
    res = await admin.post('/api/admin/releases/wp29-rel/approve', {});
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const approvedRow = (await admin.get(`/api/admin/audit?action=release.approved&project=${pid}`)).json.entries[0];
    assert.equal(approvedRow.meta.fingerprint, 'c0ffee'.repeat(10) + 'abcd');
    // project membership
    undo = injectAuditFailure((r) => r.action === 'member.assigned');
    res = await pm.post(`/api/projects/${pid}/assign`, { username: 'bob', role: 'editor' });
    undo();
    assert.equal(res.status, 503); assert.equal(store.getMembership(pid, bob.id), null, 'no membership without its row');
    // an ordinary action: it goes ahead, the failure is counted, written to audit-failures.log and raised as event 4100
    const health0 = (await admin.get('/api/admin/health')).json.audit.failures;
    undo = injectAuditFailure((r) => r.action === 'auth.logout');
    res = await bob.post('/api/auth/logout', {});
    undo();
    assert.equal(res.status, 200, 'the sign-out happened');
    assert.equal((await admin.get('/api/admin/health')).json.audit.failures, health0 + 1);
    const log = fs.readFileSync(path.join(h.ws, 'logs', 'audit-failures.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(log.some((l) => l.action === 'auth.logout' && l.critical === false));
    assert.ok(log.some((l) => l.action === 'user.updated' && l.critical === true));
    assert.ok(seen.filter((e) => e.id === 4100).length >= 5, 'every failed write raised event 4100');
    // and the chain is still intact: refused rows were never half-written
    const rep = (await admin.post('/api/admin/audit/verify', {})).json.report;
    assert.equal(rep.ok, true, rep.summary);
  } finally { D.events.setSecurityEventSink(prevSink); }
});

test('RES-004: security events with stable ids - role change, failed sign-in burst, throttle; the host line format; the documented list', async () => {
  const seen = []; const prev = D.events.setSecurityEventSink((e) => seen.push(e));
  try {
    D.events.resetSecurityEventCounters();
    const carol = await person('carol');
    assert.equal((await admin.patch(`/api/admin/users/${carol.id}`, { role: 'project_manager' })).status, 200);
    assert.ok(seen.some((e) => e.id === 4120 && e.level === 'warning' && /user\.updated by admin/.test(e.message) && /project_manager/.test(e.message)));
    const anon = new h.Client('x');
    for (let i = 0; i < 5; i++) assert.equal((await anon.post('/api/auth/login', { username: 'carol', password: 'wrong-password-1' })).status, 401);
    assert.equal(seen.filter((e) => e.id === 4110).length, 1, 'one event for the burst, not one per failure');
    for (let i = 0; i < 6; i++) await anon.post('/api/auth/login', { username: 'carol', password: 'wrong-password-1' });
    assert.ok(seen.some((e) => e.id === 4111), 'the throttle refusal raised 4111');
  } finally { D.events.setSecurityEventSink(prev); }
  // the host line: one line, "|" and line breaks removed from the text
  const writes = []; const orig = process.stdout.write;
  D.events.enableHostEventSink(true);
  process.stdout.write = (s) => { writes.push(String(s)); return true; };
  try { D.events.raiseSecurityEvent('ROLE_CHANGED', 'a|b\nc'); } finally { process.stdout.write = orig; D.events.enableHostEventSink(false); }
  assert.deepEqual(writes.filter((w) => w.startsWith('##agastya-event')), ['##agastya-event|4120|warning|a b c\n']);
  // ids are unique, and every one is in docs/OPERATIONS.md
  const list = D.events.securityEventCatalogue();
  assert.equal(new Set(list.map((e) => e.id)).size, list.length);
  const ops = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'OPERATIONS.md'), 'utf8');
  for (const e of list) assert.ok(ops.includes(`| ${e.id} |`), `docs/OPERATIONS.md lists event ${e.id}`);
  const listed = (await admin.get('/api/admin/audit/events')).json;
  assert.equal(listed.source, 'Agastya Platform'); assert.equal(listed.events.length, list.length);
});

test('ENT-003: the export streams every row (20 000 inserted), CSV and JSON Lines, with filters; the viewer filters by actor, project and time', async () => {
  const c = D.ctx.defaultContext();
  c.store.tx(() => { for (let i = 0; i < 20000; i++) c.audit({ actorUsername: 'bulk', action: 'bulk.row', projectId: i % 2 ? 'odd' : 'even', meta: { i } }); });
  const get = async (url) => { const r = await fetch(h.base + url, { headers: { cookie: admin.cookie } }); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
  const jl = await get('/api/admin/audit/export?format=jsonl&action=bulk.');
  assert.equal(jl.status, 200); assert.match(jl.type, /ndjson/);
  const lines = jl.text.trim().split('\n');
  assert.equal(lines.length, 20000);
  assert.equal(JSON.parse(lines[19999]).meta.i, 19999, 'oldest first, meta as JSON');
  const csv = await get('/api/admin/audit/export?format=csv&action=bulk.&project=odd');
  const csvLines = csv.text.trim().split('\r\n');
  assert.match(csvLines[0], /^time,actor,action,target type,target,project,ip,details,id,sequence,row hash$/);
  assert.equal(csvLines.length, 10001);
  const all = await get('/api/admin/maintenance/audit.csv');
  assert.ok(all.text.trim().split('\r\n').length > 20001, 'the maintenance export is no longer capped at 5 000');
  assert.equal((await get('/api/admin/audit/export?format=xml')).status, 400);
  assert.equal((await get('/api/admin/audit/export?from=yesterday-ish')).status, 400);
  const future = new Date(Date.now() + 86400_000).toISOString();
  assert.equal((await get(`/api/admin/audit/export?format=jsonl&from=${future}`)).text, '');
  const exported = (await admin.get('/api/admin/audit?action=audit.exported&actor=admin&limit=5')).json.entries;
  assert.ok(exported.length >= 3 && exported[0].meta.format, 'exports are audited');
  const byProject = (await admin.get('/api/admin/audit?project=odd&limit=500')).json.entries;
  assert.equal(byProject.length, 500); assert.ok(byProject.every((e) => e.projectId === 'odd' && e.actor === 'bulk' && e.seq > 0));
  assert.equal((await admin.get(`/api/admin/audit?actor=bulk&to=2000-01-01`)).json.entries.length, 0);
  const t0 = Date.now(); const rep = (await admin.post('/api/admin/audit/verify', {})).json.report;
  assert.equal(rep.ok, true, rep.summary); assert.ok(rep.chained > 20000, `verified ${rep.chained} rows in ${Date.now() - t0} ms`);
  const cp = (await admin.post('/api/admin/audit/checkpoint', {})).json.checkpoint;
  assert.equal(cp.seq, rep.head.seq + 1, 'the checkpoint covers the verification row written after it');
  assert.ok((await admin.get('/api/admin/audit/checkpoints')).json.checkpoints.some((x) => x.id === cp.id));
  assert.equal((await admin.get('/api/admin/health')).json.audit.lastVerification.ok, true);
});

test('the audit routes are administrators only', async () => {
  const dan = await person('dan');
  for (const [m, u] of [['POST', '/api/admin/audit/verify'], ['GET', '/api/admin/audit/export'], ['GET', '/api/admin/audit/events'], ['GET', '/api/admin/audit/checkpoints'], ['POST', '/api/admin/audit/checkpoint']]) {
    assert.equal((await dan.req(m, u, m === 'POST' ? {} : undefined)).status, 403, `${m} ${u}`);
    assert.equal((await new h.Client('anon').req(m, u, m === 'POST' ? {} : undefined)).status, 401, `${m} ${u} anonymous`);
  }
});

test('ENT-017: waiver history keeps add, remove and add again with their reasons; the audit rows carry the reason; an expired waiver no longer applies', async () => {
  const pm = await person('pm2', 'project_manager');
  const pid = (await pm.post('/api/projects', { name: 'WP29 waivers', ...NEW })).json.project.id;
  const U = `/api/projects/${pid}/publish-waivers`; const subject = 'DMC-EXAMPLE-A-00-00-00-00A-022A-D';
  const a = await pm.post(U, { kind: 'brex-missing', subject, reason: 'The customer BREX arrives next month.' });
  assert.equal(a.status, 201);
  assert.equal((await pm.req('DELETE', `${U}/${a.json.waiver.id}`, { reason: 'The BREX arrived after all.' })).status, 200);
  const b = await pm.post(U, { kind: 'brex-missing', subject, reason: 'It was the wrong BREX; drafts only again.', expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() });
  assert.equal(b.status, 201); assert.ok(b.json.waiver.expiresAt);
  const listed = (await pm.get(U)).json;
  assert.deepEqual(listed.history.map((e) => [e.event, e.reason]).reverse(), [
    ['added', 'The customer BREX arrives next month.'], ['removed', 'The BREX arrived after all.'], ['added', 'It was the wrong BREX; drafts only again.']]);
  assert.ok(listed.history.every((e) => e.by === 'pm2' && e.at));
  const added = (await admin.get(`/api/admin/audit?action=publish.waiver.added&project=${pid}`)).json.entries;
  assert.equal(added.length, 2); assert.equal(added[1].meta.reason, 'The customer BREX arrives next month.');
  const removed = (await admin.get(`/api/admin/audit?action=publish.waiver.removed&project=${pid}`)).json.entries[0];
  assert.equal(removed.meta.reason, 'The customer BREX arrives next month.'); assert.equal(removed.meta.removalReason, 'The BREX arrived after all.');
  assert.equal((await pm.post(U, { kind: 'brex-missing', subject, reason: 'a perfectly good reason', expiresAt: '2001-01-01' })).status, 400, 'an expiry in the past is refused');
  assert.ok(D.waivers.waiverFor(pid, 'brex-missing', subject), 'in force before it expires');
  const file = path.join(D.ctx.projectDirFor(pid), 'publish-waivers.json');
  fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).map((w) => ({ ...w, expiresAt: '2020-01-01T00:00:00.000Z' }))));
  assert.equal(D.waivers.waiverFor(pid, 'brex-missing', subject), undefined, 'an expired waiver no longer applies');
  assert.equal((await pm.get(U)).json.waivers[0].expired, true);
  // replacing a waiver records the replaced one too
  await pm.post(U, { kind: 'brex-missing', subject, reason: 'Renewed for the next draft cycle.' });
  assert.equal((await pm.get(U)).json.history[1].event, 'replaced');
});

test('structured logs: every line of the log file is JSON, seeded secrets never appear, the file rotates and keeps N old files', () => {
  const dir = tmp('agastya-wp29-log-');
  const cfg = D.config.buildConfig({ AGASTYA_WORKSPACE_DIR: tmp('agastya-wp29-ws-'), AGASTYA_LOG_DIR: dir, AGASTYA_LOG_FORMAT: 'json', AGASTYA_LOG_MAX_MB: '1', AGASTYA_LOG_KEEP: '2' });
  assert.equal(cfg.log.format, 'json'); assert.equal(cfg.log.access, true);
  const secrets = ['Hunter2-Secret!', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo', 'agastya_session=abcdef0123456789abcdef', 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'];
  const out = []; const orig = { log: console.log, error: console.error };
  D.log.installLogging({ log: { ...cfg.log, maxBytes: 4000 } });
  // the logger writes standard output through the console functions it saved; capture by replacing process.stdout/stderr writes
  const so = process.stdout.write; const se = process.stderr.write;
  process.stdout.write = (s) => { out.push(String(s)); return true; }; process.stderr.write = (s) => { out.push(String(s)); return true; };
  try {
    for (let i = 0; i < 60; i++) {
      console.log(`[auth] login attempt ${i} password=${secrets[0]} hash ${secrets[1]}`);
      console.error('cookie header', secrets[2], 'authorization', secrets[3], { newPassword: secrets[0] });
    }
    D.log.logRecord('info', 'GET /api/x 200', { kind: 'access', status: 200 });
  } finally { process.stdout.write = so; process.stderr.write = se; D.log.resetLogging(); }
  assert.equal(console.log, orig.log, 'the console is restored');
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['agastya-server.jsonl', 'agastya-server.jsonl.1', 'agastya-server.jsonl.2'], 'rotated, two old files kept');
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const line of text.trim().split('\n')) { const r = JSON.parse(line); assert.ok(r.t && r.level && typeof r.msg === 'string'); }
    for (const s of secrets) assert.ok(!text.includes(s.slice(-14)), `${f} does not contain ${s.slice(0, 12)}...`);
  }
  const stdout = out.join('');
  for (const line of stdout.trim().split('\n')) JSON.parse(line);
  for (const s of secrets) assert.ok(!stdout.includes(s.slice(-14)), 'nor does standard output');
  assert.throws(() => D.config.buildConfig({ AGASTYA_LOG_FORMAT: 'xml' }), /AGASTYA_LOG_FORMAT/);
  assert.throws(() => D.config.buildConfig({ AGASTYA_EVENT_SINK: 'syslog' }), /AGASTYA_EVENT_SINK/);
  assert.equal(D.config.buildConfig({ NODE_ENV: 'production' }).log.format, 'json');
  assert.equal(D.config.buildConfig({}).log.format, 'text');
});
