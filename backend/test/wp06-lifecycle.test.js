'use strict';
// WP-06 (audit PLT-003, PLT-004, PLT-002, PLT-010, REL-003, REL-004, DEP-017): project lifecycle integrity.
// A missing folder at a start marks the project, never deletes it; a deleted project's content goes with it and its id is never reused;
// a database held by another process is waited for, then answered with 503 (never a lost sign-in or an orphan folder); one server per
// data folder; a clean stop drains running requests and checkpoints the database; an import cut off by a crash is removed at the next start.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const net = require('node:net');
const { spawn } = require('node:child_process');
const { boot, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const DIST = path.resolve(__dirname, '..', 'dist', 'index.js');
let h; let admin; let ctx;

const person = async (name, role = 'project_manager') => {
  const m = await admin.post('/api/team/users', { username: name, fullName: `${name} Tester`, role });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const c = new h.Client(name);
  assert.equal((await c.post('/api/auth/login', { username: name, password: m.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username: name, password: PW })).status, 200);
  return { c, id: m.json.user.id };
};
const S1K = { mic: 'S1KSTUDIO', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } };

test.before(async () => {
  h = await boot(); ctx = require('../dist/context');
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
});
test.after(async () => { if (h) await h.close(); });

test('a deleted project takes its content with it; a new project of the same name starts empty under another id (PLT-004)', async () => {
  const { c: meera } = await person('meera');
  const { c: rohit } = await person('rohit');
  const made = await meera.post('/api/projects', { name: 'Alpha manual', pipeline: 's1000dtofo', s1000d: S1K });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const oldId = made.json.project.id;
  assert.equal((await meera.post(`/api/projects/${oldId}/dms`, { file: DM, xml: h.sample(DM) })).status, 201);
  const got = await meera.get(`/api/projects/${oldId}/dms/${DM}`);
  assert.equal((await meera.put(`/api/projects/${oldId}/dms/${DM}`, { xml: got.json.xml.replace('Hydraulic pump', 'Hydraulic pump (rev)'), baseHash: got.json.hash })).status, 200);
  assert.equal((await meera.post(`/api/projects/${oldId}/dms/${DM}/lock`)).status, 200);
  const db = ctx.store.db;
  const docCount = (id) => db.prepare('SELECT COUNT(*) AS n FROM documents WHERE project_id = ?').get(id).n;
  const revCount = (id) => db.prepare('SELECT COUNT(*) AS n FROM revisions WHERE document_id IN (SELECT id FROM documents WHERE project_id = ?)').get(id).n;
  assert.ok(docCount(oldId) > 0 && revCount(oldId) >= 2, 'the module and its revisions are there before the delete');

  assert.equal((await meera.del(`/api/projects/${oldId}?confirm=${encodeURIComponent('Alpha manual')}`)).status, 200);
  assert.equal(docCount(oldId), 0, 'documents of the deleted project are gone');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM revisions r WHERE NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = r.document_id)").get().n, 0, 'no revision is left without its document');
  assert.ok(db.prepare('SELECT 1 FROM project_tombstones WHERE id = ?').get(oldId), 'the id is tombstoned');
  assert.ok(ctx.store.listAudit({ limit: 50 }).some((r) => r.action === 'project.deleted' && r.project_id === oldId), 'the audit log keeps the record');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, 'references are whole after the purge');

  const again = await rohit.post('/api/projects', { name: 'Alpha manual', pipeline: 's1000dtofo', s1000d: S1K });
  assert.equal(again.status, 201, JSON.stringify(again.json));
  const newId = again.json.project.id;
  assert.notEqual(newId, oldId, 'the new project does not take the deleted one\'s id');
  assert.equal((await rohit.get(`/api/projects/${oldId}/dms`)).status === 200, false, 'the old id is not reachable');
  assert.equal((await rohit.post(`/api/projects/${newId}/dms`, { file: DM, xml: h.sample(DM) })).status, 201);
  const hist = await rohit.get(`/api/projects/${newId}/dms/${DM}/history`);
  assert.equal(hist.status, 200);
  const revs = hist.json.revisions ?? hist.json.history ?? hist.json;
  assert.equal(revs.length, 1, `only the new module's own revision: ${JSON.stringify(revs).slice(0, 300)}`);
  const doc = db.prepare('SELECT locked_by FROM documents WHERE project_id = ?').get(newId);
  assert.equal(doc.locked_by, null, 'no lock carried over');
});

test('a project folder missing at a start keeps its row and members, is marked, and comes back with its folder (PLT-003)', async () => {
  const { c: pm } = await person('pmissing');
  await person('vmissing', 'author');
  const made = await pm.post('/api/projects', { name: 'Gone for a while', pipeline: 's1000dtofo', s1000d: S1K });
  const id = made.json.project.id;
  const added = await pm.post(`/api/projects/${id}/assign`, { username: 'vmissing', role: 'viewer' });
  assert.ok(added.status < 300, JSON.stringify(added.json));
  const members = () => ctx.store.db.prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?').get(id).n;
  assert.equal(members(), 2);
  const P = require('../dist/services/projects');
  const dir = ctx.projectDirFor(id); const away = `${dir}.away`;
  fs.renameSync(dir, away);
  await P.reconcileRegistry();
  assert.ok(ctx.store.getProjectRow(id), 'the row is kept');
  assert.equal(members(), 2, 'the memberships are kept');
  const card = (await admin.get('/api/projects')).json.projects.find((p) => p.id === id);
  assert.ok(card && card.missingSince, 'administrators see it marked "folder missing"');
  assert.ok(ctx.store.listAudit({ limit: 50 }).some((r) => r.action === 'project.folder_missing' && r.project_id === id));
  await P.reconcileRegistry();
  assert.equal(ctx.store.listAudit({ limit: 100 }).filter((r) => r.action === 'project.folder_missing' && r.project_id === id).length, 1, 'said once, not at every start');

  fs.renameSync(away, dir);
  await P.reconcileRegistry();
  const back = (await pm.get('/api/projects')).json.projects.find((p) => p.id === id);
  assert.ok(back, 'the owner sees it again'); assert.equal(back.missingSince, null, 'the mark is cleared');
  assert.equal(members(), 2);

  // an administrator may still remove one whose folder stays missing: the confirmation takes the name it was registered under
  fs.renameSync(dir, away); await P.reconcileRegistry();
  assert.equal((await admin.del(`/api/projects/${id}?confirm=${encodeURIComponent('Gone for a while')}`)).status, 200);
  assert.equal(ctx.store.getProjectRow(id), null);
  fs.rmSync(away, { recursive: true, force: true });
});

test('an import that fails while it fills the project leaves nothing behind; one cut off by a stop is removed at the next start (REL-004)', async () => {
  const P = require('../dist/services/projects');
  const { c: pm, id: pmId } = await person('pimport');
  const user = ctx.store.getUser(pmId);
  const card = await P.createProject(user, { name: 'Half made', pipeline: 's1000dtofo' });
  await assert.rejects(P.fillImported(card.id, 'test import', async () => { fs.writeFileSync(path.join(ctx.projectDirFor(card.id), 'csdb', 'x.xml'), '<x/>'); throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(ctx.projectDirFor(card.id)), false, 'the folder is gone');
  assert.equal(ctx.store.getProjectRow(card.id), null, 'the row is gone');
  assert.ok(!(await pm.get('/api/projects')).json.projects.some((p) => p.id === card.id));

  const cut = await P.createProject(user, { name: 'Cut off', pipeline: 's1000dtofo' });
  P.markImportPending(cut.id, 'test import');                                  // what a crash in the middle of an import leaves
  const kept = await P.createProject(user, { name: 'Finished', pipeline: 's1000dtofo' });
  const removed = P.sweepPendingImports();
  assert.deepEqual(removed, [cut.id]);
  assert.equal(ctx.store.getProjectRow(cut.id), null); assert.equal(fs.existsSync(ctx.projectDirFor(cut.id)), false);
  assert.ok(ctx.store.getProjectRow(kept.id), 'a finished project is not touched');
  assert.ok(ctx.store.listAudit({ limit: 50 }).some((r) => r.action === 'project.import_discarded' && r.project_id === cut.id));
});

// ── separate server processes ───────────────────────────────────────────────

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
function serve(ws, port) {
  const child = spawn(process.execPath, [DIST], { env: { ...process.env, AGASTYA_WORKSPACE_DIR: ws, PORT: String(port), AGASTYA_SHUTDOWN_ON_STDIN_CLOSE: '1', AGASTYA_NO_WORKSPACE_LOCK: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    const t = setInterval(() => { if (/running on http/.test(out)) { clearInterval(t); resolve(); } }, 50);
    void exited.then((code) => { clearInterval(t); reject(new Error(`server exited (${code}): ${out.slice(-800)}`)); });
  });
  return { child, ready, exited, log: () => out };
}
/** A second process that holds the database's write lock for `ms`. */
function holdDb(ws, ms) {
  const code = `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(${JSON.stringify(path.join(ws, 'publisher.db'))});
    db.exec('BEGIN IMMEDIATE'); console.log('held'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms}); db.exec('COMMIT'); db.close();`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  const held = new Promise((resolve) => child.stdout.on('data', (d) => { if (/held/.test(String(d))) resolve(); }));
  const done = new Promise((resolve) => child.on('exit', resolve));
  return { held, done };
}

test('one server per data folder; a clean stop drains a running request and checkpoints the database (DEP-017, REL-003)', { timeout: 120000 }, async () => {
  const ws = tmp('agastya-wp06-');
  const port = await freePort();
  const a = serve(ws, port); await a.ready;
  const lock = JSON.parse(fs.readFileSync(path.join(ws, '.agastya-server.lock'), 'utf8'));
  assert.equal(lock.pid, a.child.pid);

  const b = serve(ws, await freePort()); b.ready.catch(() => undefined);      // it is meant to stop
  const code = await b.exited;
  assert.notEqual(code, 0, 'the second server does not start');
  assert.match(b.log(), new RegExp(`already in use by another Agastya Platform server \\(process ${a.child.pid}`));

  // a request whose body is still arriving when the stop is asked for is answered, not cut off
  const body = JSON.stringify({ username: 'nobody', password: 'not-the-password-1' });
  const answer = new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`POST /api/auth/login HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body.slice(0, 10)}`);
      setTimeout(() => { a.child.stdin.end(); }, 200);                         // the stop arrives mid-request
      setTimeout(() => { sock.write(body.slice(10)); }, 1800);                 // well past the old 500 ms exit
    });
    let got = ''; sock.on('data', (d) => { got += d; }); sock.on('end', () => resolve(got)); sock.on('error', reject);
  });
  const reply = await answer;
  assert.match(reply, /^HTTP\/1\.1 (401|429) /, `the running request got its answer: ${reply.slice(0, 120)}`);
  assert.equal(await a.exited, 0);
  assert.equal(fs.existsSync(path.join(ws, '.agastya-server.lock')), false, 'the lock is given back');
  const wal = path.join(ws, 'publisher.db-wal');
  assert.ok(!fs.existsSync(wal) || fs.statSync(wal).size === 0, 'the write-ahead log was checkpointed into the database');

  // a lock left by a process that died is taken over
  fs.writeFileSync(path.join(ws, '.agastya-server.lock'), JSON.stringify({ pid: 999999, host: os.hostname(), startedAt: new Date().toISOString() }));
  const c = serve(ws, await freePort()); await c.ready; c.child.stdin.end(); assert.equal(await c.exited, 0);
});

test('a database held by another process: a short hold is waited for, a long one is a 503 with Retry-After and leaves no folder (PLT-002)', { timeout: 120000 }, async () => {
  const ws = tmp('agastya-wp06-busy-');
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const s = serve(ws, port); await s.ready;
  const call = async (method, url, body, cookie) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, retry: r.headers.get('retry-after'), cookie: (r.headers.get('set-cookie') || '').split(';')[0], json: await r.json().catch(() => null) };
  };
  assert.equal((await call('POST', '/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  const made = await call('POST', '/api/team/users', { username: 'pmb', fullName: 'Pm B', role: 'project_manager' }, (await call('POST', '/api/auth/login', { username: 'admin', password: PW })).cookie);
  let pmCookie = (await call('POST', '/api/auth/login', { username: 'pmb', password: made.json.tempPassword })).cookie;
  assert.equal((await call('POST', '/api/auth/onboarding', { username: 'pmb', password: PW }, pmCookie)).status, 200);

  const short = holdDb(ws, 1500); await short.held;
  const t0 = Date.now(); const login = await call('POST', '/api/auth/login', { username: 'pmb', password: PW });
  assert.equal(login.status, 200, 'the sign-in waited for the lock instead of failing');
  assert.ok(Date.now() - t0 >= 900, 'it really waited');
  pmCookie = login.cookie; await short.done;

  const long = holdDb(ws, 9000); await long.held;
  const busy = await call('POST', '/api/projects', { name: 'Busy book', pipeline: 's1000dtofo' }, pmCookie);
  assert.equal(busy.status, 503, JSON.stringify(busy.json)); assert.equal(busy.json.code, 'BUSY'); assert.ok(Number(busy.retry) > 0);
  await long.done;
  const left = fs.existsSync(path.join(ws, 'projects')) ? fs.readdirSync(path.join(ws, 'projects')) : [];
  assert.deepEqual(left, [], 'no half-made project folder');
  assert.equal((await call('POST', '/api/projects', { name: 'Busy book', pipeline: 's1000dtofo' }, pmCookie)).status, 201, 'it works once the lock is gone');
  s.child.stdin.end(); assert.equal(await s.exited, 0);
});
