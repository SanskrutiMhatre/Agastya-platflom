'use strict';
// WP-12 (audit PLT-001, PLT-005, PERF-006, DEP-008, ENT-006, ARC-005, DEP-025, PLT-029, PLT-007, ENT-015, G-REL-1): the platform backup and
// its restore, on a POPULATED scratch workspace (accounts with real password hashes, a project with a data module, its revisions and a lock,
// notifications and activity). Never the real data folder.
//
//   G-REL-1  every table (row count and a digest over every row, audit_log included) and every file of the data folder are equal after a
//            restore, and a server started on the restored folder signs the same people in with their old passwords
//   refusals a non-empty target, a truncated archive, a changed file, an added entry, a backup from a newer build (also when its manifest
//            lies) - each with a named reason and nothing left behind
//   the administrator routes (and only for administrators), the schedule, the grandfather-father-son retention, the housekeeping retention

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { boot, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const S1K = { mic: 'S1KSTUDIO', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } };
const DIST = path.resolve(__dirname, '..', 'dist', 'index.js');
let h; let admin; let meera; let projectId; let ctx; let pb; let dp; let dbImage; let STEPS;

const person = async (name, role = 'project_manager') => {
  const m = await admin.post('/api/team/users', { username: name, fullName: `${name} Tester`, role });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const c = new h.Client(name);
  assert.equal((await c.post('/api/auth/login', { username: name, password: m.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username: name, password: PW })).status, 200);
  return c;
};

/** Every file of a data folder except what a backup deliberately leaves out (live database files, server lock, backups), with its SHA-256. */
function filesOf(root) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (!rel && ['publisher.db', 'publisher.db-wal', 'publisher.db-shm', 'publisher.db-journal', '.agastya-server.lock', 'backups'].includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r); else if (e.isFile()) out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, r))).digest('hex');
    }
  };
  walk('');
  return out;
}

/** Rebuild an archive with changes: `mutate(entries: Map<name, Buffer>, manifest)` edits in place; the manifest is written back as given. */
async function rebuild(src, dest, mutate) {
  const { ZipFileReader, ZipStreamWriter } = require('../dist/services/zipio');
  const r = ZipFileReader.open(src);
  const entries = new Map();
  for (const e of r.entries) entries.set(e.name, await r.readBuffer(e));
  r.close();
  const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  await mutate(entries, manifest);
  entries.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  const w = new ZipStreamWriter(fs.createWriteStream(dest));
  for (const [n, b] of entries) await w.addBuffer(n, b);
  await w.finish();
  return dest;
}
const leftovers = (dir) => fs.readdirSync(dir).filter((f) => /\.restoring-/.test(f));

test.before(async () => {
  h = await boot();
  ctx = require('../dist/context').defaultContext();
  pb = require('../dist/services/platformBackup');
  dp = require('../dist/services/dataProtection');
  dbImage = require('../dist/storage/dbImage');
  STEPS = require('../dist/storage/migrations').forDialect('sqlite');
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  meera = await person('meera');
  await person('arun', 'author');
  const made = await meera.post('/api/projects', { name: 'Hydraulics manual', pipeline: 's1000dtofo', s1000d: S1K });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  projectId = made.json.project.id;
  assert.equal((await meera.post(`/api/projects/${projectId}/dms`, { file: DM, xml: h.sample(DM) })).status, 201);
  const got = await meera.get(`/api/projects/${projectId}/dms/${DM}`);
  assert.equal((await meera.put(`/api/projects/${projectId}/dms/${DM}`, { xml: got.json.xml.replace('Hydraulic pump', 'Hydraulic pump (rev)'), baseHash: got.json.hash })).status, 200);
  assert.equal((await meera.post(`/api/projects/${projectId}/dms/${DM}/lock`)).status, 200);
});
test.after(async () => { if (h) await h.close(); });

test('G-REL-1: a restore gives back every table row for row, every file byte for byte, and the same people can sign in', async () => {
  const live = path.join(h.ws, 'publisher.db');
  const before = dbImage.inspectDatabaseFile(live);
  const made = await pb.createPlatformBackup({ db: ctx.db, workspaceDir: h.ws, backupDir: path.join(tmp(), 'bk'), kind: 'manual', nowIso: new Date().toISOString(), version: '9.9.9' });
  const after = dbImage.inspectDatabaseFile(live);
  assert.deepEqual(after.tables, before.tables, 'nothing wrote to the database while the backup ran (a quiescent copy)');
  assert.ok(before.tables.users.rows >= 3 && before.tables.revisions.rows >= 2 && before.tables.audit_log.rows > 5 && before.tables.sessions.rows >= 3, JSON.stringify(Object.fromEntries(Object.entries(before.tables).map(([k, v]) => [k, v.rows]))));
  assert.equal(ctx.store.db.prepare('SELECT COUNT(*) AS n FROM documents WHERE locked_at IS NOT NULL').get().n, 1, 'a locked module is part of the state');

  const m = made.manifest;
  assert.equal(m.format, 'agastya-platform-backup'); assert.equal(m.database.integrity, 'ok');
  assert.ok(m.files.some((f) => f.path === `projects/${projectId}/csdb/${DM}`), 'the data module is in it');
  assert.ok(m.files.some((f) => f.path === 'workspace.json'));
  assert.ok(!m.files.some((f) => /^backups\/|^publisher\.db|\.agastya-server\.lock/.test(f.path)), 'no live database file, lock or backup inside a backup');

  const target = path.join(tmp(), 'restored');
  const rep = await pb.restorePlatformBackup(made.file, target, STEPS);
  assert.equal(rep.files, m.files.length);
  const restored = dbImage.inspectDatabaseFile(path.join(target, 'publisher.db'));
  assert.equal(restored.integrity, 'ok'); assert.equal(restored.foreignKeyErrors, 0);
  assert.deepEqual(restored.tables, before.tables, '100 % of the tables, audit_log included, row for row');
  assert.deepEqual(restored.applied, before.applied);
  assert.deepEqual(filesOf(target), filesOf(h.ws), '100 % of the files');

  // a real server on the restored folder: the old password works, the project, its module, its history and its lock are there
  const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, [DIST], { env: { ...process.env, AGASTYA_WORKSPACE_DIR: target, PORT: String(port), AGASTYA_SHUTDOWN_ON_STDIN_CLOSE: '1', AGASTYA_NO_WORKSPACE_LOCK: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  try {
    await new Promise((resolve, reject) => {
      const t = setInterval(() => { if (/running on http/.test(out)) { clearInterval(t); resolve(); } }, 50);
      void exited.then((code) => { clearInterval(t); reject(new Error(`server exited (${code}): ${out.slice(-800)}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'meera', password: PW }) });
    assert.equal(login.status, 200, 'the old password signs in on the restored platform');
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const get = async (u) => { const r = await fetch(base + u, { headers: { cookie } }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const hist = await get(`/api/projects/${projectId}/dms/${DM}/history`);
    assert.equal(hist.status, 200); assert.ok(hist.json.revisions.length >= 2, 'revision history restored');
    const dm = await get(`/api/projects/${projectId}/dms/${DM}`);
    assert.equal(dm.status, 200); assert.match(dm.json.xml, /Hydraulic pump \(rev\)/, 'the saved content');
    const ver = await get('/api/version');
    assert.equal(ver.json.schema.compatible, true);
  } finally {
    child.stdin.end(); await Promise.race([exited, new Promise((r) => setTimeout(r, 15000))]); child.kill();
  }
});

test('PLT-001: a backup taken during saves restores consistently; one backup at a time', async () => {
  const dir = path.join(tmp(), 'bk');
  const running = pb.createPlatformBackup({ db: ctx.db, workspaceDir: h.ws, backupDir: dir, kind: 'manual', nowIso: new Date().toISOString(), version: '9.9.9' });
  await assert.rejects(pb.createPlatformBackup({ db: ctx.db, workspaceDir: h.ws, backupDir: dir, kind: 'manual', nowIso: new Date().toISOString(), version: '9.9.9' }), (e) => e.code === 'BUSY');
  const saves = [];
  for (let i = 0; i < 6; i++) {
    saves.push((async () => { const g = await meera.get(`/api/projects/${projectId}/dms/${DM}`); return meera.put(`/api/projects/${projectId}/dms/${DM}`, { xml: g.json.xml.replace(/Hydraulic pump[^<]*/, `Hydraulic pump v${i}`), baseHash: g.json.hash }); })());
  }
  const made = await running; await Promise.all(saves);
  const rep = await pb.verifyPlatformBackup(made.file, tmp(), STEPS);
  assert.equal(rep.database.integrity, 'ok'); assert.equal(rep.database.foreignKeyErrors, 0);
});

test('restore refusals: non-empty target, truncated archive, changed file, added entry, newer build - named, and nothing left behind', async () => {
  const work = tmp();
  const made = await pb.createPlatformBackup({ db: ctx.db, workspaceDir: h.ws, backupDir: path.join(work, 'bk'), kind: 'manual', nowIso: new Date().toISOString(), version: '9.9.9' });

  const occupied = path.join(work, 'occupied'); fs.mkdirSync(occupied); fs.writeFileSync(path.join(occupied, 'keep.txt'), 'mine');
  await assert.rejects(pb.restorePlatformBackup(made.file, occupied, STEPS), (e) => e.code === 'TARGET_NOT_EMPTY');
  assert.deepEqual(fs.readdirSync(occupied), ['keep.txt']);

  const truncated = path.join(work, 'truncated.zip');
  fs.writeFileSync(truncated, fs.readFileSync(made.file).subarray(0, Math.floor(fs.statSync(made.file).size / 2)));
  await assert.rejects(pb.restorePlatformBackup(truncated, path.join(work, 't1'), STEPS), (e) => e.code === 'NOT_A_BACKUP');
  assert.equal(fs.existsSync(path.join(work, 't1')), false);

  const changed = await rebuild(made.file, path.join(work, 'changed.zip'), (entries) => {
    const name = `workspace/projects/${projectId}/csdb/${DM}`;
    entries.set(name, Buffer.from(entries.get(name).toString('utf8').replace('Hydraulic', 'Pneumatic')));
  });
  await assert.rejects(pb.restorePlatformBackup(changed, path.join(work, 't2'), STEPS), (e) => e.code === 'HASH_MISMATCH' && e.message.includes(DM));
  assert.equal(fs.existsSync(path.join(work, 't2')), false); assert.deepEqual(leftovers(work), [], 'no half-restored folder');

  const added = await rebuild(made.file, path.join(work, 'added.zip'), (entries) => { entries.set('workspace/projects/intruder.xml', Buffer.from('<x/>')); });
  await assert.rejects(pb.restorePlatformBackup(added, path.join(work, 't3'), STEPS), (e) => e.code === 'UNEXPECTED_ENTRY' && /intruder/.test(e.message));

  const newer = await rebuild(made.file, path.join(work, 'newer.zip'), (_e, m) => { m.schema.applied.push('099-from-the-future'); m.version = '9.0.0'; });
  await assert.rejects(pb.restorePlatformBackup(newer, path.join(work, 't4'), STEPS), (e) => e.code === 'NEWER_BACKUP' && /099-from-the-future/.test(e.message));

  // the manifest says nothing, but the database inside carries a migration this build does not know: still refused
  const lying = await rebuild(made.file, path.join(work, 'lying.zip'), (entries, m) => {
    const f = path.join(work, 'lying.db'); fs.writeFileSync(f, entries.get('database/publisher.db'));
    const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(f);
    d.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES ('099-from-the-future', 'x')").run(); d.close();
    const buf = fs.readFileSync(f); entries.set('database/publisher.db', buf);
    m.database.bytes = buf.length; m.database.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    m.database.tables = dbImage.inspectDatabaseFile(f).tables;
  });
  await assert.rejects(pb.restorePlatformBackup(lying, path.join(work, 't5'), STEPS), (e) => e.code === 'NEWER_BACKUP');
  assert.deepEqual(leftovers(work), []);

  const notOurs = await rebuild(made.file, path.join(work, 'other.zip'), (_e, m) => { m.format = 'something-else'; });
  await assert.rejects(pb.restorePlatformBackup(notOurs, path.join(work, 't6'), STEPS), (e) => e.code === 'NOT_A_BACKUP');
});

test('administrator routes: back up now, list, download, verify, copy, restore into a new folder, delete - and nobody else may', async () => {
  for (const [m, u] of [['GET', '/api/admin/backups'], ['POST', '/api/admin/backups']]) assert.equal((await meera.req(m, u, m === 'POST' ? {} : undefined)).status, 403, `${m} ${u}`);

  const made = await admin.post('/api/admin/backups');
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const name = made.json.name;
  assert.match(name, /^agastya-backup-\d{8}-\d{6}Z-manual\.zip$/);
  const st = await admin.get('/api/admin/backups');
  assert.equal(st.json.latest.name, name); assert.equal(st.json.stale, false); assert.equal(st.json.state.lastBackup.ok, true);
  assert.ok(require('../dist/context').store.listAudit({ limit: 20 }).some((r) => r.action === 'backup.created' && r.target_id === name));

  assert.equal((await meera.get(`/api/admin/backups/${name}/download`)).status, 403);
  const dl = await admin.get(`/api/admin/backups/${name}/download`);
  assert.equal(dl.status, 200);
  const file = path.join(h.ws, 'backups', 'platform', name);
  assert.ok(dl.buf.equals(fs.readFileSync(file)), 'the download is the archive');
  assert.equal((await admin.get('/api/admin/backups/..%2F..%2Fpublisher.db/download')).status, 404);

  const v = await admin.post(`/api/admin/backups/${name}/verify`);
  assert.equal(v.status, 200, JSON.stringify(v.json)); assert.equal(v.json.ok, true);

  const usb = tmp();
  const cp = await admin.post(`/api/admin/backups/${name}/copy`, { folder: usb });
  assert.equal(cp.status, 200, JSON.stringify(cp.json));
  assert.ok(fs.readFileSync(path.join(usb, name)).equals(fs.readFileSync(file)));
  assert.equal((await admin.post(`/api/admin/backups/${name}/copy`, { folder: usb })).status, 400, 'never overwritten');

  assert.equal((await admin.post(`/api/admin/backups/${name}/restore`, { target: path.join(h.ws, 'inside') })).status, 400, 'never into the running data folder');
  assert.equal((await admin.post(`/api/admin/backups/${name}/restore`, { target: 'relative\\path' })).status, 400);
  const target = path.join(tmp(), 'restored-by-api');
  const rs = await admin.post(`/api/admin/backups/${name}/restore`, { target });
  assert.equal(rs.status, 200, JSON.stringify(rs.json));
  assert.ok(fs.existsSync(path.join(target, 'publisher.db'))); assert.ok(rs.json.next.some((s) => /AGASTYA_WORKSPACE_DIR/.test(s)));
  assert.equal((await admin.post(`/api/admin/backups/${name}/restore`, { target })).status, 400, 'a second restore into the same folder is refused');

  assert.equal((await admin.del(`/api/admin/backups/${name}`)).status, 200);
  assert.equal(fs.existsSync(file), false);
});

test('retention of backups: grandfather-father-son 7/4/12 over scheduled backups only', () => {
  const items = []; const end = Date.parse('2026-11-27T01:00:00Z');
  for (let d = 0; d < 400; d++) items.push({ name: `s${d}`, createdAt: new Date(end - d * 86400_000).toISOString() });
  const kept = pb.retainedBackups(items, { daily: 7, weekly: 4, monthly: 12 });
  for (let d = 0; d < 7; d++) assert.ok(kept.has(`s${d}`), `day ${d}`);
  const months = new Set([...kept].map((n) => items.find((i) => i.name === n).createdAt.slice(0, 7)));
  assert.equal(months.size, 12, 'one per month for twelve months');
  assert.ok([...kept].every((n) => Date.parse(items.find((i) => i.name === n).createdAt) > end - 366 * 86400_000), 'nothing older than a year');
  assert.ok(kept.size <= 7 + 4 + 12 && kept.size >= 12);

  const dir = tmp();
  const mk = (iso, kind) => { const n = `agastya-backup-${iso.replace(/[-:]/g, '').replace('T', '-').replace(/\.\d+Z$/, 'Z')}-${kind}.zip`; fs.writeFileSync(path.join(dir, n), 'x'); return n; };
  const manual = mk('2020-01-01T00:00:00.000Z', 'manual');
  for (let d = 0; d < 20; d++) mk(new Date(end - d * 86400_000).toISOString(), 'scheduled');
  fs.writeFileSync(path.join(dir, 'unrelated.zip'), 'x');
  const removed = pb.pruneScheduledBackups(dir, { daily: 7, weekly: 4, monthly: 12 });
  assert.ok(removed.length > 0 && removed.every((n) => /-scheduled\.zip$/.test(n)));
  assert.ok(fs.existsSync(path.join(dir, manual)), 'a manual backup is kept'); assert.ok(fs.existsSync(path.join(dir, 'unrelated.zip')), 'a file that is not ours is never touched');
});

test('PLT-007 / ENT-015: housekeeping rows past their retention go; old audit rows are archived to a file first', () => {
  const db = ctx.store.db; const adminId = ctx.store.listUsers().find((u) => u.username === 'admin').id;
  const now = '2031-06-01T00:00:00.000Z';
  const old = '2028-01-01T00:00:00.000Z'; const recent = '2031-05-30T00:00:00.000Z';
  const ins = db.prepare('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run('s-old-expired', adminId, 'h1', old, old, null); ins.run('s-old-revoked', adminId, 'h2', old, '2032-01-01T00:00:00Z', old); ins.run('s-recent', adminId, 'h3', recent, '2031-05-31T00:00:00Z', null);
  const note = db.prepare('INSERT INTO notifications (user_id, kind, title, created_at, read_at) VALUES (?, ?, ?, ?, ?)');
  note.run(adminId, 'k', 'old read', old, old); note.run(adminId, 'k', 'old unread', old, null); note.run(adminId, 'k', 'recent read', recent, recent);
  const aud = db.prepare('INSERT INTO audit_log (at, action, project_id) VALUES (?, ?, ?)');
  aud.run('2026-01-01T00:00:00.000Z', 'ancient.one', null); aud.run('2026-02-01T00:00:00.000Z', 'ancient.two', 'p');
  const auditBefore = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;

  // (this runs after the HTTP tests: at a date in 2031 the sessions of this test's own clients have ended too)
  const counts = dp.runRetention(ctx, now);
  assert.ok(counts.sessions >= 2); assert.ok(counts.notifications >= 1);
  assert.ok(counts.auditArchived >= 2);
  assert.deepEqual(db.prepare("SELECT id FROM sessions WHERE id LIKE 's-%' ORDER BY id").all().map((r) => r.id), ['s-recent']);
  assert.deepEqual(db.prepare("SELECT title FROM notifications WHERE kind = 'k' ORDER BY title").all().map((r) => r.title), ['old unread', 'recent read']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'ancient.%'").get().n, 0);
  const dir = path.join(h.ws, 'audit-archive');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl.gz'));
  assert.equal(files.length, 1);
  const rows = require('node:zlib').gunzipSync(fs.readFileSync(path.join(dir, files[0]))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(rows.some((r) => r.action === 'ancient.one') && rows.some((r) => r.action === 'ancient.two'), 'the archived rows are in the file');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, auditBefore - counts.auditArchived + 1, 'only the archived rows went (plus the retention record itself)');
  assert.ok(ctx.store.listAudit({ limit: 5 }).some((r) => r.action === 'retention.purged'));
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id, at, action FROM audit_log WHERE project_id = 'p' ORDER BY id DESC LIMIT 60").all().map((r) => r.detail).join(' ');
  assert.match(plan, /ix_audit_project/, 'activity queries by project use the new index');
});

test('the schedule: a scheduled backup when due, the restore test, retention once a day; nothing when not due', async () => {
  const t0 = '2031-07-10T02:00:00.000Z';                 // after the retention test's date, so retention is due again
  const first = await dp.tick(ctx, t0);
  assert.deepEqual(first.sort(), ['backup', 'restore-test', 'retention']);
  const st = dp.readState(ctx);
  assert.equal(st.lastRestoreTest.ok, true); assert.equal(st.lastScheduledAt, t0);
  assert.deepEqual(await dp.tick(ctx, '2031-07-10T03:00:00.000Z'), [], 'an hour later nothing is due');
  assert.deepEqual((await dp.tick(ctx, '2031-07-11T02:30:00.000Z')).sort(), ['backup', 'retention'], 'a day later: backup and retention; the restore test is weekly');
  assert.equal(pb.listBackups(ctx.config.backup.dir).filter((b) => b.kind === 'scheduled').length, 2);
});
