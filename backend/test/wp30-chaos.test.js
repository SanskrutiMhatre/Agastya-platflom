'use strict';
// Chaos suite (WP-30, QA-008; gate G-REL-2 at a smoke level): the REAL server (dist/index.js, its job workers, their JVMs) runs in a process of its
// own on a throwaway data folder and a free loopback port, and is killed outright - `taskkill /T /F` of the server's whole process tree, the way a
// power cut or an end-task does it - in the middle of four operations:
//
//   publish    a PDF build of the sample project (a job in a worker process, FOP running)
//   import     "start a project by importing a package" (a 21-module package exported from another project)
//   backup     a platform backup (SQLite image + every data file into a ZIP with a SHA-256 manifest) of a data folder with 160 MB of files
//   migration  the first start of a newer build on a database five migrations behind (quick_check, the safety copy, the steps)
//
// Each operation is first run once uninterrupted to measure its duration T; then it is killed CHAOS_KILLS times (default 3) at i/(n+1) of T. After
// every kill the server is started again on the same folder, and the test asserts:
//   - the database passes PRAGMA quick_check and foreign_key_check, and so does every safety copy in backups/
//   - no torn file: every XML file is well formed, every JSON file parses, every PDF has its header and %%EOF, no half-made project is left
//   - no lost committed data: a module saved (and acknowledged) before the kill reads back with its content and its revision history
//   - the operation that was cut off is shown as interrupted (publish: its job record; import: no project from it; backup: no archive from it)
//   - a retry succeeds (and a backup taken after it verifies)
// The kill points are deterministic fractions; n = 3 per operation (12 kills) is a smoke test - by the rule of three it bounds the failure rate per
// kill only at about 3/12 = 25 %. For the G-REL-2 target (n = 100) run with CHAOS_KILLS=25 (scheduled, not in the gate; about an hour).
// Windows only (taskkill and the job object that takes the workers down with the server).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const net = require('node:net'); const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { tmp, DM21 } = require('./helpers');

process.env.AGASTYA_WORKSPACE_DIR = tmp('agastya-wp30-chaos-default-');   // nothing below may resolve the developer's real data folder
const { DatabaseSync } = require('node:sqlite');
const { DOMParser } = require('@xmldom/xmldom');

const DIST = path.resolve(__dirname, '..', 'dist', 'index.js');
const PW = 'Correct-Horse-9!';
const N = Math.max(1, Number(process.env.CHAOS_KILLS || 3));
const SKIP = process.platform !== 'win32' && 'Windows only (taskkill /T and the job object)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---- the server in its own process ---------------------------------------------------------------------------------------------------------------
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const started = new Set();
process.on('exit', () => { for (const pid of started) if (alive(pid)) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); });

async function start(ws, { wait = true } = {}) {
  const port = await freePort();
  const env = { ...process.env, AGASTYA_WORKSPACE_DIR: ws, PORT: String(port), AGASTYA_SHUTDOWN_ON_STDIN_CLOSE: '1' };
  delete env.AGASTYA_HOST; delete env.AGASTYA_MODE;
  const child = spawn(process.execPath, [DIST], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  started.add(child.pid);
  const srv = { child, pid: child.pid, port, base: `http://127.0.0.1:${port}`, out: '', t0: Date.now(), exitCode: undefined };
  child.stdout.on('data', (d) => { srv.out += d; }); child.stderr.on('data', (d) => { srv.out += d; });
  srv.exited = new Promise((resolve) => child.on('exit', (c) => { srv.exitCode = c; started.delete(child.pid); resolve(c); }));
  if (wait) await ready(srv);
  return srv;
}
async function ready(srv, ms = 180000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (/running on http/.test(srv.out)) { srv.readyMs = Date.now() - srv.t0; return srv; }
    if (srv.exitCode !== undefined) throw new Error(`the server exited (${srv.exitCode}) before it was ready:\n${srv.out.slice(-1500)}`);
    await sleep(50);
  }
  throw new Error(`the server was not ready in ${ms} ms:\n${srv.out.slice(-1500)}`);
}
/** The power cut: the server's whole process tree (workers, JVMs, the job-object helper) is ended at once. Only processes this test started. */
async function hardKill(srv) {
  spawnSync('taskkill', ['/PID', String(srv.pid), '/T', '/F'], { stdio: 'ignore' });
  await Promise.race([srv.exited, sleep(20000)]);
  assert.ok(!alive(srv.pid), 'the server process is gone');
}
async function stop(srv) {
  try { srv.child.stdin.end(); } catch { /* closed */ }
  await Promise.race([srv.exited, sleep(30000)]);
  if (alive(srv.pid)) await hardKill(srv);
}

class Client {
  constructor(srv) { this.srv = srv; this.cookie = ''; }
  async req(method, url, body) {
    const headers = {}; if (this.cookie) headers.cookie = this.cookie;
    let payload; if (body instanceof FormData) payload = body; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.srv.base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return type.includes('json') ? { status: res.status, json: await res.json().catch(() => null) } : { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
  }
  get(u) { return this.req('GET', u); } post(u, b) { return this.req('POST', u, b ?? {}); } put(u, b) { return this.req('PUT', u, b); }
  on(srv) { this.srv = srv; return this; }
}
const ok = (r, what) => { assert.ok(r.status >= 200 && r.status < 300, `${what}: ${r.status} ${JSON.stringify(r.json ?? '').slice(0, 400)}`); return r; };

/** A data folder with an administrator and an author who owns the sample project, one module saved with a marker (committed data). */
async function seed(srv) {
  const admin = new Client(srv); ok(await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' }), 'setup');
  const made = ok(await admin.post('/api/team/users', { username: 'cora', fullName: 'Cora', role: 'author' }), 'user');
  const author = new Client(srv); ok(await author.post('/api/auth/login', { username: 'cora', password: made.json.tempPassword }), 'login');
  ok(await author.post('/api/auth/onboarding', { username: 'cora', password: PW }), 'onboarding');
  const p = ok(await author.post('/api/projects/sample', {}), 'sample').json.project.id;
  const list = ok(await author.get(`/api/projects/${p}/dms`), 'dms').json; const dms = list.dms || list.items || list;
  const dm = (dms.find((d) => /-040A-D_/.test(d.file || d.name || d)) || dms[0]); const file = dm.file || dm.name || dm;
  const g = ok(await author.get(`/api/projects/${p}/dms/${file}`), 'read').json;
  const marker = `Chaos marker ${crypto.randomBytes(4).toString('hex')}`;
  assert.ok(/<para>/.test(g.xml), 'the module has a paragraph');
  ok(await author.put(`/api/projects/${p}/dms/${file}`, { xml: g.xml.replace('<para>', `<para>${marker} `), baseHash: g.hash }), 'save');
  const hist = ok(await author.get(`/api/projects/${p}/dms/${file}/history`), 'history').json.revisions.length;
  return { admin, author, project: p, file, marker, revisions: hist };
}
async function login(srv, username) { const c = new Client(srv); ok(await c.post('/api/auth/login', { username, password: PW }), `login ${username}`); return c; }

// ---- what must hold after every kill ----------------------------------------------------------------------------------------------------------------
function dbHealth(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return { quick: db.prepare('PRAGMA quick_check').get().quick_check, fk: db.prepare('PRAGMA foreign_key_check').all().length }; } finally { db.close(); }
}
const SKIP_DIRS = new Set(['node_modules']);
/** Files with a final name whose content is not whole. Temporary files (.partial, .tmp, staging folders) are listed apart: debris, not data. */
function tornFiles(ws) {
  const torn = []; const debris = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name); const rel = path.relative(ws, abs);
      if (e.isDirectory()) { if (/^\.staging-|\.restoring-/.test(e.name)) debris.push(`${rel}${path.sep}`); else if (!SKIP_DIRS.has(e.name)) walk(abs); continue; }
      if (/^publisher\.db(-wal|-shm|-journal)?$/.test(e.name) && dir === ws) continue;
      if (/\.(partial|tmp)$|\.tmp-|\.restoring-|~$/.test(e.name)) { debris.push(rel); continue; }
      const ext = path.extname(e.name).toLowerCase();
      try {
        if (ext === '.xml') {
          const errs = []; const text = fs.readFileSync(abs, 'utf8');
          new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errs.push(msg); } }).parseFromString(text, 'text/xml');
          if (errs.length || !text.trim()) torn.push(`${rel}: not well formed (${String(errs[0] || 'empty').slice(0, 120)})`);
        } else if (ext === '.json') JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^﻿/, ''));   // a byte-order mark (the seeded brand packs) is not damage
        else if (ext === '.pdf') { const b = fs.readFileSync(abs); if (b.subarray(0, 5).toString('latin1') !== '%PDF-' || !b.subarray(-1024).toString('latin1').includes('%%EOF')) torn.push(`${rel}: an incomplete PDF (${b.length} bytes)`); }
        else if (ext === '.db') { const h = dbHealth(abs); if (h.quick !== 'ok') torn.push(`${rel}: a database copy that fails quick_check (${h.quick})`); }
      } catch (err) { torn.push(`${rel}: ${String(err.message).slice(0, 160)}`); }
    }
  };
  walk(ws);
  return { torn, debris };
}
async function commonChecks(t, ws, srv, s, label) {
  const h = dbHealth(path.join(ws, 'publisher.db'));
  assert.equal(h.quick, 'ok', `${label}: the database passes quick_check`); assert.equal(h.fk, 0, `${label}: no foreign key errors`);
  const { torn, debris } = tornFiles(ws);
  assert.deepEqual(torn, [], `${label}: no torn file`);
  if (debris.length) t.diagnostic(`${label}: temporary files left by the cut-off operation (not data): ${debris.slice(0, 6).join(', ')}${debris.length > 6 ? ` and ${debris.length - 6} more` : ''}`);
  const author = await login(srv, 'cora');
  const dm = ok(await author.get(`/api/projects/${s.project}/dms/${s.file}`), `${label}: the saved module`).json;
  assert.ok(dm.xml.includes(s.marker), `${label}: the module saved before the kill still has its content`);
  const hist = ok(await author.get(`/api/projects/${s.project}/dms/${s.file}/history`), 'history').json.revisions.length;
  assert.ok(hist >= s.revisions, `${label}: its revision history is intact (${hist} >= ${s.revisions})`);
  return author;
}
const fractions = () => Array.from({ length: N }, (_, i) => (i + 1) / (N + 1));
const record = [];
test.after(() => { if (record.length) console.log(`# chaos summary: ${JSON.stringify(record)}`); });

// ---- 1. publish ---------------------------------------------------------------------------------------------------------------------------------
test('kill during publish: database whole, no torn PDF, the job shown interrupted, nothing committed lost, a retry builds', { skip: SKIP, timeout: 1800000 }, async (t) => {
  const ws = tmp('agastya-wp30-chaos-pub-');
  let srv = await start(ws); const s = await seed(srv);
  const pdfOf = async (c) => { const r = await c.get(`/api/projects/${s.project}/publish/pdf`); return r.status === 200 && r.buf && r.buf.subarray(0, 5).toString() === '%PDF-'; };
  const run = async (c) => {
    const t0 = Date.now(); const r = ok(await c.post(`/api/projects/${s.project}/publish?async=1`, {}), 'async publish'); assert.equal(r.status, 202);
    return { id: r.json.job.id, t0 };
  };
  const jobOf = async (c, id) => ok(await c.get(`/api/projects/${s.project}/jobs/${id}`), 'job').json.job;
  // T: one uninterrupted cold build
  const m = await run(s.author);
  let j; for (;;) { j = await jobOf(s.author, m.id); if (!['queued', 'running'].includes(j.state)) break; await sleep(100); }
  assert.equal(j.state, 'succeeded', JSON.stringify(j).slice(0, 400)); const T = Date.now() - m.t0; assert.ok(await pdfOf(s.author), 'the measured build produced a PDF');
  t.diagnostic(`publish: T = ${T} ms (cold worker and JVM)`);
  await stop(srv);
  const results = [];
  for (const f of fractions()) {
    srv = await start(ws); const author = await login(srv, 'cora');
    const r = await run(author); await sleep(Math.round(f * T));
    const before = (await jobOf(author, r.id)).state;
    await hardKill(srv);
    srv = await start(ws);
    const label = `publish killed at ${Math.round(f * 100)} % of T (job was ${before})`;
    const c = await commonChecks(t, ws, srv, s, label);
    const after = (await jobOf(c, r.id));
    if (['queued', 'running'].includes(before)) assert.equal(after.state, 'interrupted', `${label}: the job is shown interrupted (${JSON.stringify(after).slice(0, 300)})`);
    else assert.ok(['succeeded', 'interrupted'].includes(after.state), `${label}: ${after.state}`);
    const retry = ok(await c.post(`/api/projects/${s.project}/publish`, {}), `${label}: the retry builds`);
    assert.ok(retry.json.ok && await pdfOf(c), `${label}: the retried PDF is served`);
    results.push({ at: f, jobWas: before, jobAfter: after.state, retry: 'ok' });
    await stop(srv);
  }
  // the temporary PDF a killed build left is removed by a later start once it is a minute old (WP-11's sweep of interrupted writes)
  const pdir = path.join(ws, 'projects'); const tmpPdfs = () => { const out = []; for (const p of fs.readdirSync(pdir)) for (const x of fs.readdirSync(path.join(pdir, p))) if (/^\..+\.pdf\.tmp-/.test(x)) out.push(path.join(pdir, p, x)); return out; };
  const old = (Date.now() - 2 * 60_000) / 1000; const left = tmpPdfs(); for (const x of left) fs.utimesSync(x, old, old);
  srv = await start(ws); await stop(srv);
  assert.deepEqual(tmpPdfs(), [], `the temporary PDFs of the killed builds are swept (${left.length} were left)`);
  record.push({ op: 'publish', T, kills: results });
  t.diagnostic(`publish: ${JSON.stringify(results)}`);
});

// ---- 2. package import --------------------------------------------------------------------------------------------------------------------------
test('kill during package import: no half-made project, database whole, nothing committed lost, a retry imports everything', { skip: SKIP, timeout: 1800000 }, async (t) => {
  const ws = tmp('agastya-wp30-chaos-imp-');
  let srv = await start(ws); const s = await seed(srv);
  // the package: a project with the 21 data module types (issue 5.0) and its figure, exported by the platform
  const src = ok(await s.author.post('/api/projects', { name: 'Chaos source', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example' } } }), 'source').json.project.id;
  const dir = path.join(DM21, '5-0'); let n = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /\.xml$/i.test(x))) { const r = await s.author.post(`/api/projects/${src}/dms`, { file: f, xml: fs.readFileSync(path.join(dir, f), 'utf8') }); if (r.status === 201) n++; }
  assert.ok(n >= 15, `the source project has its modules (${n})`);
  const pkg = ok(await s.author.get(`/api/projects/${src}/packages/project`), 'export').buf; assert.equal(pkg.subarray(0, 2).toString(), 'PK');
  const projects = async (c) => ok(await c.get('/api/projects'), 'projects').json.projects;
  const detect = async (c) => { const fd = new FormData(); fd.append('file', new Blob([pkg]), 'chaos-package.zip'); return ok(await c.req('POST', '/api/projects/import/detect', fd), 'detect').json.token; };
  const doImport = (c, token, name) => c.post('/api/projects/import', { token, name, format: 's1000d' });
  const dmCount = async (c, id) => { const l = ok(await c.get(`/api/projects/${id}/dms`), 'dms').json; return (l.dms || l.items || l).length; };
  // T: one uninterrupted import
  let token = await detect(s.author); let t0 = Date.now();
  const first = await doImport(s.author, token, 'Chaos import measured'); const T = Date.now() - t0;
  assert.equal(first.status, 201, JSON.stringify(first.json).slice(0, 400));
  const expected = await dmCount(s.author, first.json.project.id);
  t.diagnostic(`import: T = ${T} ms for ${expected} modules`);
  await stop(srv);
  const results = [];
  for (const [i, f] of fractions().entries()) {
    srv = await start(ws); const author = await login(srv, 'cora');
    const name = `Chaos import ${i}`; token = await detect(author);
    const pending = doImport(author, token, name).catch((e) => ({ status: 0, error: e.message }));
    await sleep(Math.round(f * T)); await hardKill(srv); const answer = await pending;
    srv = await start(ws);
    const label = `import killed at ${Math.round(f * 100)} % of T (answer ${answer.status})`;
    const c = await commonChecks(t, ws, srv, s, label);
    const mine = (await projects(c)).filter((p) => p.name === name);
    if (answer.status === 201) { assert.equal(mine.length, 1); assert.equal(await dmCount(c, mine[0].id), expected, `${label}: the finished import is whole`); }
    else assert.equal(mine.length, 0, `${label}: the cut-off import left no half-made project (${JSON.stringify(mine)})`);
    for (const p of fs.readdirSync(path.join(ws, 'projects'))) assert.ok(!fs.existsSync(path.join(ws, 'projects', p, '.agastya-import-pending')), `${label}: no project folder is still marked as being imported (${p})`);
    const again = await doImport(c, await detect(c), `${name} retry`);
    assert.equal(again.status, 201, `${label}: the retry imports: ${JSON.stringify(again.json).slice(0, 300)}`);
    assert.equal(await dmCount(c, again.json.project.id), expected, `${label}: with every module`);
    results.push({ at: f, answer: answer.status, leftProject: mine.length, retry: 'ok' });
    await stop(srv);
  }
  record.push({ op: 'import', T, kills: results });
  t.diagnostic(`import: ${JSON.stringify(results)}`);
});

// ---- 3. platform backup -------------------------------------------------------------------------------------------------------------------------
test('kill during backup: no archive from the cut-off run is listed or torn, database whole, a retry backs up and verifies', { skip: SKIP, timeout: 1800000 }, async (t) => {
  const ws = tmp('agastya-wp30-chaos-bak-');
  let srv = await start(ws); const s = await seed(srv);
  // 160 MB of incompressible files in the project's media folder, so the backup takes seconds (hashing and deflating every byte)
  const media = path.join(ws, 'projects', s.project, 'media'); fs.mkdirSync(media, { recursive: true });
  for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(media, `ICN-CHAOS-FILLER-${i}.bin`), crypto.randomBytes(20 * 1024 * 1024));
  const list = async (c) => ok(await c.get('/api/admin/backups'), 'backups').json.backups;
  const admin = async (sv) => login(sv, 'admin');
  let a = await admin(srv); let t0 = Date.now();
  const made = ok(await a.post('/api/admin/backups', {}), 'measured backup').json; const T = Date.now() - t0;
  t.diagnostic(`backup: T = ${T} ms for ${made.files} files, ${(made.bytes / 1048576).toFixed(0)} MB`);
  await stop(srv);
  const results = [];
  for (const f of fractions()) {
    srv = await start(ws); a = await admin(srv);
    const known = new Set((await list(a)).map((b) => b.name));
    const pending = a.post('/api/admin/backups', {}).catch((e) => ({ status: 0, error: e.message }));
    await sleep(Math.round(f * T)); await hardKill(srv); const answer = await pending;
    srv = await start(ws); a = await admin(srv);
    const label = `backup killed at ${Math.round(f * 100)} % of T (answer ${answer.status})`;
    await commonChecks(t, ws, srv, s, label);
    const now = await list(a); const fresh = now.filter((b) => !known.has(b.name));
    if (answer.status !== 200) assert.equal(fresh.length, 0, `${label}: the cut-off backup is not listed as a backup (${JSON.stringify(fresh)})`);
    for (const b of now) assert.equal(ok(await a.post(`/api/admin/backups/${b.name}/verify`, {}), `${label}: verify ${b.name}`).json.ok, true, `${label}: listed backup ${b.name} verifies`);
    const again = ok(await a.post('/api/admin/backups', {}), `${label}: the retry backs up`).json;
    assert.equal(ok(await a.post(`/api/admin/backups/${again.name}/verify`, {}), 'verify retry').json.ok, true, `${label}: and the new archive verifies`);
    results.push({ at: f, answer: answer.status, listedAfter: now.length, retry: 'ok' });
    await stop(srv);
  }
  // what the cut-off backups left (a .partial archive, a .staging- folder) is removed by the next backup once nothing has touched it for 10 minutes
  const bdir = path.join(ws, 'backups', 'platform');
  const leftovers = () => fs.readdirSync(bdir).filter((n) => /\.zip\.partial$|^\.staging-/.test(n));
  const old = (Date.now() - 11 * 60_000) / 1000;
  for (const n of leftovers()) { const p = path.join(bdir, n); if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) fs.utimesSync(path.join(p, f), old, old); fs.utimesSync(p, old, old); }
  t.diagnostic(`backup: leftovers before the sweep: ${leftovers().join(', ') || 'none'}`);
  srv = await start(ws); a = await admin(srv); ok(await a.post('/api/admin/backups', {}), 'a backup after the leftovers aged');
  assert.deepEqual(leftovers(), [], 'the abandoned .partial archives and staging folders are gone');
  await stop(srv);
  record.push({ op: 'backup', T, kills: results });
  t.diagnostic(`backup: ${JSON.stringify(results)}`);
});

// ---- 4. migration -------------------------------------------------------------------------------------------------------------------------------
test('kill during a migration: the next start completes it, the database and every safety copy pass quick_check, nothing committed lost', { skip: SKIP, timeout: 1800000 }, async (t) => {
  const { ORDER } = require('../dist/storage/migrations');
  const PENDING = '022-audit-project-index'; const later = ORDER.slice(ORDER.indexOf(PENDING)); const LAST = ORDER[ORDER.length - 1];
  assert.ok(later.length >= 2, `${PENDING} and later steps exist`);
  const template = tmp('agastya-wp30-chaos-migtpl-');
  let srv = await start(template); const s = await seed(srv); await stop(srv);
  // an older build's database: 022 and every later step not yet applied, and 240 MB of rows so quick_check, the safety copy and its check take seconds
  {
    const db = new DatabaseSync(path.join(template, 'publisher.db'));
    db.exec('CREATE TABLE IF NOT EXISTS chaos_filler (id INTEGER PRIMARY KEY, b BLOB)');
    const ins = db.prepare('INSERT INTO chaos_filler (b) VALUES (randomblob(?))'); db.exec('BEGIN'); for (let i = 0; i < 240; i++) ins.run(1024 * 1024); db.exec('COMMIT');
    db.exec('DROP INDEX IF EXISTS ix_audit_project'); for (const n of later) db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(n);
    db.exec('PRAGMA user_version = 21'); db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close();
  }
  const fresh = () => { const ws = tmp('agastya-wp30-chaos-mig-'); fs.cpSync(template, ws, { recursive: true, filter: (p) => !/\.agastya-server\.lock$/.test(p) }); return ws; };
  const migrated = (ws) => { const db = new DatabaseSync(path.join(ws, 'publisher.db'), { readOnly: true }); try { return { last: !!db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(LAST), index: !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'ix_audit_project'").get(), filler: db.prepare('SELECT COUNT(*) AS n FROM chaos_filler').get().n }; } finally { db.close(); } };
  // T: one uninterrupted upgrade start
  let ws = fresh(); srv = await start(ws); const T = srv.readyMs;
  assert.deepEqual(migrated(ws), { last: true, index: true, filler: 240 }, 'the measured start migrated');
  t.diagnostic(`migration: T = ${T} ms from spawn to listening (quick_check, safety copy, ${later.length} steps)`);
  await stop(srv);
  const results = [];
  for (const f of fractions()) {
    ws = fresh(); srv = await start(ws, { wait: false });
    await sleep(Math.round(f * T)); const wasReady = /running on http/.test(srv.out); await hardKill(srv);
    const copiesAtKill = fs.existsSync(path.join(ws, 'backups')) ? fs.readdirSync(path.join(ws, 'backups')).filter((x) => x.endsWith('.db')) : [];
    srv = await start(ws);
    const label = `migration start killed at ${Math.round(f * 100)} % of T${wasReady ? ' (it had finished)' : ''}`;
    await commonChecks(t, ws, srv, s, label);
    assert.deepEqual(migrated(ws), { last: true, index: true, filler: 240 }, `${label}: the restart completed every step and kept every row`);
    const copies = fs.readdirSync(path.join(ws, 'backups')).filter((x) => x.endsWith('.db'));
    for (const c of copies) assert.equal(dbHealth(path.join(ws, 'backups', c)).quick, 'ok', `${label}: safety copy ${c} passes quick_check (copies at the kill: ${copiesAtKill.join(', ') || 'none'})`);
    await stop(srv);
    // the temporary copy (and its journal) a killed start left is removed by a later start once it is a minute old
    const tmps = () => fs.readdirSync(path.join(ws, 'backups')).filter((x) => /^\.publisher-before-.*\.tmp-/.test(x));
    const left = tmps(); const old = (Date.now() - 2 * 60_000) / 1000;
    for (const x of left) fs.utimesSync(path.join(ws, 'backups', x), old, old);
    srv = await start(ws); await stop(srv);
    assert.deepEqual(tmps(), [], `${label}: the temporary copies are swept (${left.join(', ') || 'none were left'})`);
    results.push({ at: f, finishedBeforeKill: wasReady, copiesAtKill, copiesAfter: copies, tmpLeft: left.length, retry: 'ok' });
  }
  record.push({ op: 'migration', T, kills: results });
  t.diagnostic(`migration: ${JSON.stringify(results)}`);
});
