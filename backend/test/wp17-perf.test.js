'use strict';
// WP-17 (audit PERF-005, PERF-007, PLT-008, PERF-009, PERF-011): backend performance, with the answers unchanged.
//   - SQLite: NORMAL in WAL (FULL on request), 64 MB cache, temp in memory, quick_check stated at start, a second writer waits, idle checkpoint
//   - the dashboard's folder rule is read once per request: same folders for every persona, cost independent of the number of folders
//   - the CSDB identity index: duplicates found as before through create, save, delete and files added or removed outside the platform
//   - the JSS document GET reuses the kept report only while the text and every picture it looked up are unchanged
//   - shapes (B3, B10, B12 of audit 04 section 6): save and create barely grow from 100 to 1000 modules; the member dashboard barely grows
//     from 10 to 60 folders; an autocommit write is far below the old 3 ms
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawn } = require('node:child_process');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const logged = []; const realLog = console.log;
console.log = (...a) => { logged.push(a.map(String).join(' ')); realLog(...a); };

let h; let admin; let author;
async function user(username, role = 'author') {
  const made = await admin.post('/api/team/users', { username, fullName: username, role });
  const c = new h.Client(username);
  await c.post('/api/auth/login', { username, password: made.json.tempPassword });
  await c.post('/api/auth/onboarding', { username, password: PW });
  return c;
}
const S1K = { pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } };
const TPL = fs.readFileSync(path.join(DM21, '5-0', fs.readdirSync(path.join(DM21, '5-0')).find((f) => f.includes('-040A-D_'))), 'utf8');
function mod(i, extra = '') {
  const attrs = `systemDiffCode="A" systemCode="${String(Math.floor(i / 10000) % 100).padStart(2, '0')}" subSystemCode="${Math.floor(i / 1000) % 10}" subSubSystemCode="${Math.floor(i / 100) % 10}" assyCode="${String(i % 100).padStart(2, '0')}" disassyCode="00" disassyCodeVariant="A"`;
  let xml = TPL.replace(/(<dmCode\s)[^>]*?(infoCode=)/, `$1modelIdentCode="EXAMPLE" ${attrs} $2`).replace(/<techName>[^<]*<\/techName>/, `<techName>Module ${i}${extra}</techName>`);
  const code = /<dmIdent>[\s\S]*?<dmCode\s+([^>]*?)\s*\/>/.exec(xml)[1]; const a = Object.fromEntries([...code.matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
  const dmc = `${a.modelIdentCode}-${a.systemDiffCode}-${a.systemCode}-${a.subSystemCode}${a.subSubSystemCode}-${a.assyCode}-${a.disassyCode}${a.disassyCodeVariant}-${a.infoCode}${a.infoCodeVariant}-${a.itemLocationCode}`;
  return { xml, file: `DMC-${dmc}_001-00_EN-US.XML`, ref: `<dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef>` };
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
async function timed(n, fn) { await fn(-1); await fn(-2); const xs = []; for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); await fn(i); xs.push(Number(process.hrtime.bigint() - t) / 1e6); } return median(xs); }

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  author = await user('ann');
});
test.after(async () => { console.log = realLog; await h.close(); });

// ── SQLite ────────────────────────────────────────────────────────────────
test('SQLite: NORMAL in WAL, 64 MB cache, temp in memory; the start states its quick_check; FULL on request', () => {
  const db = require('../dist/context').defaultContext().db;
  const one = (p) => Object.values(db.prepare(`PRAGMA ${p}`).get())[0];
  assert.equal(one('journal_mode'), 'wal');
  assert.equal(Number(one('synchronous')), 1, 'NORMAL (decision D14)');
  assert.equal(Number(one('cache_size')), -65536);
  assert.equal(Number(one('temp_store')), 2, 'MEMORY');
  assert.equal(Number(one('busy_timeout')), 5000);
  assert.ok(logged.some((l) => /^\[db\] quick_check: ok \(\d+ ms\)$/.test(l)), `the start logs the check (${logged.filter((l) => l.includes('quick_check')).join(' | ') || 'nothing'})`);
  const { openSqlite, closeSqlite } = require('../dist/storage/sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-db-'));
  const { buildConfig, config } = require('../dist/config');
  assert.equal(config.database.synchronous, 'NORMAL');
  assert.equal(buildConfig({ ...process.env, AGASTYA_DB_SYNCHRONOUS: 'full' }).database.synchronous, 'FULL');
  try { const d = openSqlite(dir, { synchronous: 'FULL' }); assert.equal(Number(Object.values(d.prepare('PRAGMA synchronous').get())[0]), 2, 'FULL when asked'); closeSqlite(d); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SQLite: an autocommit write costs far less than the 3 ms of FULL (B12)', () => {
  const { openSqlite, closeSqlite } = require('../dist/storage/sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-db-'));
  try {
    const db = openSqlite(dir);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, c INTEGER); CREATE INDEX t_a ON t(a); CREATE INDEX t_c ON t(c);');
    const ins = db.prepare('INSERT INTO t (a, c) VALUES (?, ?)'); const xs = [];
    for (let i = 0; i < 520; i++) { const t = process.hrtime.bigint(); ins.run(`k${i}`, i); if (i >= 20) xs.push(Number(process.hrtime.bigint() - t) / 1e6); }
    closeSqlite(db);
    assert.ok(median(xs) < 1, `median autocommit insert ${median(xs).toFixed(3)} ms (FULL measured 3.2 ms here)`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SQLite: a second writer waits for the lock instead of failing', async () => {
  const { openSqlite, closeSqlite } = require('../dist/storage/sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-db-'));
  try {
    const db = openSqlite(dir); db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT);');
    const file = path.join(dir, 'publisher.db').replace(/\\/g, '/');
    const holder = spawn(process.execPath, ['--no-warnings', '-e', `const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(${JSON.stringify(file)}); d.exec('BEGIN IMMEDIATE'); d.exec("INSERT INTO t (a) VALUES ('other')"); console.log('locked'); setTimeout(() => { d.exec('COMMIT'); d.close(); }, 1200);`], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((r) => holder.stdout.on('data', (b) => { if (String(b).includes('locked')) r(); }));
    const t0 = Date.now();
    db.prepare("INSERT INTO t (a) VALUES ('mine')").run();
    const waited = Date.now() - t0;
    assert.ok(waited >= 700, `the write waited for the other writer (${waited} ms)`);
    assert.equal(db.prepare('SELECT count(*) AS n FROM t').get().n, 2);
    await new Promise((r) => holder.on('exit', r));
    closeSqlite(db);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SQLite: the idle checkpoint folds the write-ahead log back and truncates it', async () => {
  const { openSqlite, closeSqlite, startIdleCheckpoint } = require('../dist/storage/sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-db-'));
  try {
    const db = openSqlite(dir); db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT);');
    const ins = db.prepare('INSERT INTO t (a) VALUES (?)'); for (let i = 0; i < 500; i++) ins.run('x'.repeat(500));
    const wal = path.join(dir, 'publisher.db-wal');
    assert.ok(fs.statSync(wal).size > 0, 'the log holds the writes');
    const stop = startIdleCheckpoint(db, 60);
    await new Promise((r) => setTimeout(r, 400));
    stop();
    assert.equal(fs.statSync(wal).size, 0, 'truncated once the database was quiet');
    assert.equal(db.prepare('SELECT count(*) AS n FROM t').get().n, 500);
    closeSqlite(db);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── CSDB identity index ───────────────────────────────────────────────────
test('CSDB: duplicate identities are found through create, save, delete and files added or removed outside the platform', async () => {
  const id = (await author.post('/api/projects', { name: 'Index', ...S1K })).json.project.id; const P = (s) => `/api/projects/${id}${s}`;
  const csdb = path.join(h.ws, 'projects', id, 'csdb');
  const a = mod(1); const b = mod(2);
  assert.equal((await author.post(P('/dms'), { file: a.file, xml: a.xml })).status, 201);
  const dup = await author.post(P('/dms'), { file: 'DMC-SAME-AS-A.XML', xml: a.xml });
  assert.equal(dup.status, 409); assert.equal(dup.json.code, 'DUPLICATE_DMC'); assert.equal(dup.json.existing, a.file);
  // a file put into the folder by hand, then taken away again
  fs.writeFileSync(path.join(csdb, 'DMC-BY-HAND.XML'), b.xml);
  const d2 = await author.post(P('/dms'), { file: b.file, xml: b.xml });
  assert.equal(d2.status, 409, 'the module added by hand is seen'); assert.equal(d2.json.existing, 'DMC-BY-HAND.XML');
  fs.unlinkSync(path.join(csdb, 'DMC-BY-HAND.XML'));
  assert.equal((await author.post(P('/dms'), { file: b.file, xml: b.xml })).status, 201, 'and its removal too');
  // a save that changes a module's identity frees the old one and takes the new one
  const c = mod(3); const cur = (await author.get(P(`/dms/${a.file}`))).json;
  assert.equal((await author.put(P(`/dms/${a.file}`), { xml: c.xml, baseHash: cur.hash })).status, 200);
  assert.equal((await author.post(P('/dms'), { file: 'DMC-NOW-A.XML', xml: a.xml })).status, 201, 'the old identity is free');
  const d3 = await author.post(P('/dms'), { file: c.file, xml: c.xml });
  assert.equal(d3.status, 409); assert.equal(d3.json.existing, a.file, 'the new identity belongs to the saved module');
  // saving a module under its own identity is not a clash with itself; addressing it in another letter case neither
  const again = (await author.get(P(`/dms/${a.file}`))).json;
  assert.equal((await author.put(P(`/dms/${a.file.toLowerCase()}`), { xml: c.xml.replace('Module 3', 'Module 3 again'), baseHash: again.hash })).status, 200);
  // a delete frees the identity
  assert.equal((await author.req('DELETE', P(`/dms/${a.file}`))).status, 200);
  assert.equal((await author.post(P('/dms'), { file: c.file, xml: c.xml })).status, 201);
  // the listing is the folder as it is
  const listed = (await author.get(P('/dms'))).json.dms.map((d) => d.file).sort();
  assert.deepEqual(listed, fs.readdirSync(csdb).filter((f) => /^DMC-.*\.xml$/i.test(f)).sort());
});

// ── JSS report reuse ──────────────────────────────────────────────────────
test('JSS GET: the kept report is used only while the text and the pictures it looked up are unchanged', async () => {
  const id = (await author.post('/api/projects', { name: 'JSS reuse', format: 'jss', domain: 'land', manualType: 'uhb' })).json.project.id;
  const U = `/api/projects/${id}/jss`;
  const g1 = (await author.get(U)).json;
  const g2 = (await author.get(U)).json;
  assert.deepEqual(g2.report, g1.report, 'the same report, kept');
  const at = g1.xml.indexOf('</section>'); assert.ok(at > 0);
  const xml = g1.xml.slice(0, at) + '<figure><title>WP-17</title><graphic src="Media/wp17-picture.png"/></figure>' + g1.xml.slice(at);
  assert.equal((await author.put(U, { xml, baseHash: g1.hash })).status, 200);
  const missing = (r) => r.findings.filter((f) => f.rule === 'JSS-GRAPHIC-MISSING').length;
  const g3 = (await author.get(U)).json;
  assert.equal(missing(g3.report), 1, 'the new text is checked');
  fs.mkdirSync(path.join(h.ws, 'projects', id, 'Media'), { recursive: true });
  fs.writeFileSync(path.join(h.ws, 'projects', id, 'Media', 'wp17-picture.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  const g4 = (await author.get(U)).json;
  assert.equal(missing(g4.report), 0, 'the picture now there is seen at once');
  const v = (await author.post(`${U}/validate`, {})).json;
  assert.deepEqual({ ...g4.report, validatedAt: 0 }, { ...v, validatedAt: 0 }, 'the GET report equals a fresh validation');
});

// ── Dashboard ─────────────────────────────────────────────────────────────
test('dashboard: the same folders for every persona, and the member-only cost does not grow with the number of folders (B10)', { timeout: 600000 }, async () => {
  const creator = await user('cara'); const member = await user('mel'); const grantee = await user('gus'); const nobody = await user('noa');
  const ids = [];
  for (let i = 0; i < 80; i++) ids.push((await creator.post('/api/projects', { name: `Dash ${i}`, folder: `Folder ${String(i % 10).padStart(2, '0')}`, ...S1K })).json.project.id);
  assert.equal((await creator.post(`/api/projects/${ids[3]}/assign`, { username: 'mel', role: 'editor' })).status, 200);
  const melId = (await member.get('/api/auth/me')).json.user.id; const gusId = (await grantee.get('/api/auth/me')).json.user.id;
  const key5 = 'folder 05';
  assert.equal((await creator.put(`/api/folders/${encodeURIComponent(key5)}/access`, { grants: [{ userId: gusId, role: 'viewer' }] })).status, 200);
  void melId;
  const names = async (c) => (await c.get('/api/workspace')).json.folders.map((f) => f.name).sort();
  assert.deepEqual(await names(member), ['Folder 03'], 'member-only: the folder holding their project');
  assert.deepEqual(await names(grantee), ['Folder 05'], 'grantee: the granted folder');
  assert.deepEqual(await names(nobody), [], 'no access: none');
  assert.equal((await names(creator)).length, 10, 'creator: every folder of theirs');
  assert.ok((await names(admin)).length >= 10, 'administrator: all');
  const ov = (await member.get('/api/overview')).json; assert.equal(ov.counts.folders, 1); assert.equal(ov.counts.projects, 1);

  const at10 = await timed(9, () => member.get('/api/workspace'));
  for (let i = 10; i < 60; i++) assert.equal((await creator.post('/api/folders', { name: `Empty ${i}` })).status < 300, true);
  assert.deepEqual(await names(member), ['Folder 03'], 'empty folders of others stay hidden');
  const at60 = await timed(9, () => member.get('/api/workspace'));
  console.log(`[wp17] member /api/workspace median: ${at10.toFixed(1)} ms at 10 folders, ${at60.toFixed(1)} ms at 60 (before WP-17 the cost grew with folders x projects)`);
  assert.ok(at60 < at10 * 2.5 + 20, `60 folders ${at60.toFixed(1)} ms against 10 folders ${at10.toFixed(1)} ms`);
});

// ── Shapes: save and create from 100 to 1000 modules (B3) ───────────────────
async function projectOf(name, n) {
  const Z = require('../dist/services/zipio');
  const id = (await author.post('/api/projects', { name, ...S1K })).json.project.id;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-pkg-')); const zp = path.join(work, 'p.zip'); const zw = new Z.ZipStreamWriter(fs.createWriteStream(zp)); const refs = [];
  for (let i = 1; i <= n; i++) { const m = mod(i); refs.push(m.ref); await zw.addBuffer(`csdb/${m.file}`, Buffer.from(m.xml)); }
  await zw.addBuffer('publication.xml', Buffer.from(`<?xml version="1.0"?><pm><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="EXAMPLE" pmIssuer="00000" pmNumber="00001" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="GB"/><issueInfo issueNumber="001" inWork="00"/></pmIdent><pmAddressItems><issueDate year="2025" month="01" day="01"/><pmTitle>P</pmTitle><shortPmTitle>P</shortPmTitle></pmAddressItems></pmAddress><pmStatus><security securityClassification="01"/></pmStatus></identAndStatusSection><content>${refs.map((r, i) => `<pmEntry><pmEntryTitle>M${i + 1}</pmEntryTitle>${r}</pmEntry>`).join('')}</content></pm>`));
  await zw.finish();
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(zp)]), 'p.zip'); fd.append('replacePm', '1'); fd.append('skipChecks', '1');
  const imp = await author.req('POST', `/api/projects/${id}/packages/import`, fd);
  fs.rmSync(work, { recursive: true, force: true });
  assert.equal(imp.status, 200, JSON.stringify(imp.json).slice(0, 300));
  return id;
}
async function costs(id, n) {
  const P = (s) => `/api/projects/${id}${s}`; const one = mod(1).file;
  let cur = (await author.get(P(`/dms/${one}`))).json;
  const save = await timed(11, async (i) => { const xml = cur.xml.replace(/<techName>[^<]*<\/techName>/, `<techName>Module 1 v${i}</techName>`); const s = await author.put(P(`/dms/${one}`), { xml, baseHash: cur.hash }); assert.equal(s.status, 200); cur = { xml, hash: s.json.hash }; });
  let k = n + 1;
  const create = await timed(11, async () => { const m = mod(k++); const r = await author.post(P('/dms'), { file: m.file, xml: m.xml }); assert.equal(r.status, 201); });
  return { save, create };
}
test('CSDB shapes: a save and a create barely grow from 100 to 1000 modules (B3)', { timeout: 900000 }, async () => {
  const small = await costs(await projectOf('B3 small', 100), 100);
  const big = await costs(await projectOf('B3 big', 1000), 1000);
  console.log(`[wp17] save median ${small.save.toFixed(1)} -> ${big.save.toFixed(1)} ms, create ${small.create.toFixed(1)} -> ${big.create.toFixed(1)} ms (100 -> 1000 modules)`);
  assert.ok(big.save < small.save * 2 + 10, `save ${small.save.toFixed(1)} -> ${big.save.toFixed(1)} ms`);
  assert.ok(big.create < small.create * 3 + 15, `create ${small.create.toFixed(1)} -> ${big.create.toFixed(1)} ms`);
});

// ── Module size (PERF-014) ─────────────────────────────────────────────────
test('a module above the documented maximum is refused with 413 MODULE_TOO_LARGE on create and save; nothing is written', async () => {
  const { config, buildConfig } = require('../dist/config');
  assert.equal(config.limits.maxModuleBytes, 16 * 1048576, 'the documented default: 16 MiB');
  assert.equal(buildConfig({ ...process.env, AGASTYA_MAX_MODULE_BYTES: '5000000' }).limits.maxModuleBytes, 5000000);
  const id = (await author.post('/api/projects', { name: 'Size', ...S1K })).json.project.id; const P = (s) => `/api/projects/${id}${s}`;
  const a = mod(7); const b = mod(8);
  assert.equal((await author.post(P('/dms'), { file: a.file, xml: a.xml })).status, 201);
  const keep = config.limits.maxModuleBytes; config.limits.maxModuleBytes = 200000;
  try {
    const big = (m) => m.xml.replace('</techName>', `</techName><!-- ${'x'.repeat(250000)} -->`);
    const c = await author.post(P('/dms'), { file: b.file, xml: big(b) });
    assert.equal(c.status, 413); assert.equal(c.json.code, 'MODULE_TOO_LARGE'); assert.match(c.json.error, /larger than the 0\.2 MB/);
    assert.equal(fs.existsSync(path.join(h.ws, 'projects', id, 'csdb', b.file)), false);
    const cur = (await author.get(P(`/dms/${a.file}`))).json;
    const s = await author.put(P(`/dms/${a.file}`), { xml: big(a), baseHash: cur.hash });
    assert.equal(s.status, 413); assert.equal(s.json.code, 'MODULE_TOO_LARGE');
    assert.equal((await author.get(P(`/dms/${a.file}`))).json.hash, cur.hash, 'the module is unchanged');
    assert.equal((await author.post(P('/dms'), { file: b.file, xml: b.xml })).status, 201, 'a module under the limit is taken');
  } finally { config.limits.maxModuleBytes = keep; }
});
