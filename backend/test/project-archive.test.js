'use strict';
// "Export" of a whole project (any of the three formats) and bringing it back with "Import package": GET /api/projects/:id/export and POST /api/xengine/import.
//
// The owner's list (2026-11-26, item 1): a project that was imported and then edited can be exported again; a project made from scratch can be exported; and the export holds the
// project and its contents. The archive is the older tool's .jsspub.zip layout (manifest.json + project/ + templates/ + comments.json) with the format named in the manifest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { boot, DM21, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const DM = fs.readdirSync(FIX).find((f) => /-040A-D_/.test(f));
let h; let admin; let w; let ZipFileReader; let ZipStreamWriter;

test.before(async () => {
  h = await boot(); ({ ZipFileReader, ZipStreamWriter } = require('../dist/services/zipio'));
  admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'archiver', fullName: 'Arch Iver', role: 'author' });
  w = new h.Client('archiver'); await w.post('/api/auth/login', { username: 'archiver', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'archiver', password: PW });
});
test.after(async () => { if (h) await h.close(); });

const tmpFile = (buf, name = 'a.zip') => { const f = path.join(tmp('archive-'), name); fs.writeFileSync(f, buf); return f; };
const form = (file, name, fields = {}) => { const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), name); for (const [k, v] of Object.entries(fields)) fd.append(k, v); return fd; };
const names = (buf) => { const r = ZipFileReader.open(tmpFile(buf)); try { return r.entries.filter((e) => !e.isDirectory).map((e) => e.name); } finally { r.close(); } };
const read = async (buf, name) => { const r = ZipFileReader.open(tmpFile(buf)); try { const e = r.entries.find((x) => x.name === name); return e ? (await r.readBuffer(e)).toString('utf8') : null; } finally { r.close(); } };
const exportOf = async (id) => { const r = await w.get(`/api/projects/${id}/export`); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.ok(r.buf && r.buf.length > 100); return r; };
const importAs = (buf, format, fields = {}) => w.req('POST', '/api/xengine/import', form(tmpFile(buf), 'a.jsspub.zip', { source: format, target: format, ...fields }));

test('a JSS project made from scratch, then edited and given a review comment, comes back as the same JSS project with its edit and its comment', async () => {
  const made = await w.post('/api/projects', { name: 'Archive JSS', format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(made.status, 201);
  const id = made.json.project.id; const U = `/api/projects/${id}`;
  const src = (await w.get(`${U}/jss`)).json;
  const edited = src.xml.replace(/<systemName>[^<]*<\/systemName>/, '<systemName>Round Trip System 77</systemName>'); assert.notEqual(edited, src.xml, 'the starting book has a system name to edit');
  assert.equal((await w.put(`${U}/jss`, { xml: edited, baseHash: src.hash })).status, 200);
  assert.equal((await w.post(`${U}/review/comments`, { body: 'Please check the cover' })).status, 201);

  const ex = await exportOf(id);
  assert.match(ex.headers.get('content-disposition') || '', new RegExp(`${id}\\.jsspub\\.zip`));
  const list = names(ex.buf);
  for (const must of ['manifest.json', 'comments.json', 'project/project.json']) assert.ok(list.includes(must), `the archive holds ${must}: ${list.join(', ')}`);
  assert.ok(list.some((n) => /^project\/jss\//.test(n) || /^project\/.*\.xml$/.test(n)), 'and the document itself');
  assert.ok(!list.some((n) => /jss-output\.(pdf|fo)$|-run\.xsl$/.test(n)), 'but nothing a build writes again');
  const man = JSON.parse(await read(ex.buf, 'manifest.json'));
  assert.equal(man.generator, 'Agastya'); assert.equal(man.manifestVersion, 1); assert.equal(man.format, 'jss'); assert.equal(man.domain, 'land'); assert.equal(man.manualType, 'uhb');

  // the first look names it, so the dialog can choose the format for the person
  const det = await w.req('POST', '/api/projects/import/detect', form(tmpFile(ex.buf), 'a.jsspub.zip')); assert.equal(det.status, 200);
  assert.equal(det.json.archive.format, 'jss'); assert.equal(det.json.archive.manualType, 'uhb');

  const back = await importAs(ex.buf, 'jss', { name: 'Archive JSS (copy)' });
  assert.equal(back.status, 201, JSON.stringify(back.json).slice(0, 500));
  assert.equal(back.json.project.format, 'jss'); assert.equal(back.json.project.domain, 'land'); assert.equal(back.json.project.manualType, 'uhb'); assert.equal(back.json.project.name, 'Archive JSS (copy)');
  assert.notEqual(back.json.project.id, id, 'a new project: nothing is overwritten');
  assert.equal(back.json.restored.comments, 1);
  const again = (await w.get(`/api/projects/${back.json.project.id}/jss`)).json;
  assert.match(again.xml, /Round Trip System 77/, 'the edit is in the copy');
  const rel = (await w.get(`/api/projects/${back.json.project.id}/release`)).json;
  assert.equal(rel.review.comments.length, 1); assert.match(rel.review.comments[0].body, /Please check the cover/); assert.match(rel.review.comments[0].body, /Arch Iver/, 'the comment names who first wrote it');
  // and the original is as it was
  assert.match((await w.get(`${U}/jss`)).json.xml, /Round Trip System 77/);
  // an export of the copy exports again: an imported-and-edited project can always be exported
  assert.equal((await exportOf(back.json.project.id)).status, 200);
});

test('a JSG project made from scratch comes back as the same JSG project', async () => {
  const made = await w.post('/api/projects', { name: 'Archive JSG', format: 'jsg', domain: 'land', manualType: 'uhb' }); assert.equal(made.status, 201);
  const id = made.json.project.id; const U = `/api/projects/${id}`;
  const ex = await exportOf(id);
  assert.equal(JSON.parse(await read(ex.buf, 'manifest.json')).format, 'jsg');
  const same = await importAs(ex.buf, 'jsg'); assert.equal(same.status, 409, 'a name that is taken is refused, as for any new project: ' + JSON.stringify(same.json).slice(0, 200));
  const back = await importAs(ex.buf, 'jsg', { name: 'Archive JSG back' }); assert.equal(back.status, 201, JSON.stringify(back.json).slice(0, 400));
  assert.equal(back.json.project.format, 'jsg'); assert.equal(back.json.project.manualType, 'uhb');
  assert.equal((await w.get(`/api/projects/${back.json.project.id}/jsg`)).json.xml, (await w.get(`${U}/jsg`)).json.xml, 'the document is the same, byte for byte');
});

test('an S1000D project (its data modules, publication module and settings) comes back as the same S1000D project; an imported package that was then edited exports too', async () => {
  const made = await w.post('/api/projects', { name: 'Archive S1000D', format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5-0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(made.status, 201, JSON.stringify(made.json).slice(0, 300));
  const id = made.json.project.id; const U = `/api/projects/${id}`;
  assert.equal((await w.post(`${U}/dms`, { file: DM, xml: fs.readFileSync(path.join(FIX, DM), 'utf8') })).status, 201);
  const cfg = (await w.get(`${U}/s1000d`)).json.config;

  const ex = await exportOf(id);
  const list = names(ex.buf);
  assert.ok(list.some((n) => n.startsWith('project/csdb/') && n.endsWith(DM)), 'the data module is in the archive: ' + list.join(', '));
  const man = JSON.parse(await read(ex.buf, 'manifest.json')); assert.equal(man.format, 's1000d'); assert.ok(man.settings, 'the S1000D configuration travels in the manifest');
  assert.ok(list.some((n) => /^templates\/xignal-s1000d\.house\.json$/.test(n)), 'the house style the project uses travels with it');
  assert.ok(list.some((n) => /^templates\/brand\/lnt-xignal\//.test(n)), 'and its brand pack (the L&T logos), since a new S1000D project uses the reference style');

  const back = await importAs(ex.buf, 's1000d', { name: 'Archive S1000D copy' });
  assert.equal(back.status, 201, JSON.stringify(back.json).slice(0, 500)); assert.equal(back.json.project.format, 's1000d');
  const B = `/api/projects/${back.json.project.id}`;
  const dms = (await w.get(`${B}/dms`)).json; assert.ok(JSON.stringify(dms).includes(DM), 'the data module is in the copy, indexed');
  const cfg2 = (await w.get(`${B}/s1000d`)).json.config;
  assert.equal(cfg2.mic, cfg.mic); assert.equal(cfg2.issue, cfg.issue); assert.equal(cfg2.responsiblePartner.code, cfg.responsiblePartner.code);
  assert.equal((await w.get(B)).json.project.templateRef, 'xignal-s1000d', 'the same house style');

  // an imported-then-edited project: import it, add a data module, export again, import that
  const second = await exportOf(back.json.project.id);
  assert.equal(JSON.parse(await read(second.buf, 'manifest.json')).format, 's1000d');
  const third = await importAs(second.buf, 's1000d', { name: 'Archive S1000D second copy' }); assert.equal(third.status, 201);
  assert.ok(JSON.stringify((await w.get(`/api/projects/${third.json.project.id}/dms`)).json).includes(DM));
});

test('what an archive is imported as must be what it holds; a ZIP that is not an archive, a newer one, and one with an unsafe path or XML are refused and nothing is created', async () => {
  const made = await w.post('/api/projects', { name: 'Archive refuse', format: 'jsg', domain: 'land', manualType: 'uhb' });
  const ex = await exportOf(made.json.project.id);
  const before = (await w.get('/api/projects')).json.projects.length;

  const wrongTarget = await importAs(ex.buf, 'jsg', { target: 'jss', domain: 'land', manualType: 'uhb' });
  assert.equal(wrongTarget.status, 400); assert.match(JSON.stringify(wrongTarget.json), /ARCHIVE_FORMAT|JSG project/);
  const wrongSource = await importAs(ex.buf, 'jss', { target: 'jss' });
  assert.equal(wrongSource.status, 400); assert.match(JSON.stringify(wrongSource.json), /WRONG_SOURCE|not JSS/);

  const build = async (fn) => { const f = path.join(tmp('archive-'), 'x.zip'); const z = new ZipStreamWriter(fs.createWriteStream(f)); await fn((n, t) => z.addBuffer(n, Buffer.from(t, 'utf8'))); await z.finish(); return fs.readFileSync(f); };
  const manifest = (extra = {}) => JSON.stringify({ manifestVersion: 1, generator: 'Agastya', id: 'x', name: 'X', type: 'UHB', templateRef: 'default', format: 'jsg', domain: 'land', manualType: 'uhb', ...extra });
  const evil = await build(async (add) => { await add('manifest.json', manifest()); await add('project/project.json', '{"name":"x"}'); await add('project/xx/escape.txt', 'no'); });
  // the writer will not make an unsafe name, so the bytes are changed afterwards (the name is in the local header and in the central directory)
  for (let i = evil.indexOf('project/xx/escape.txt'); i >= 0; i = evil.indexOf('project/xx/escape.txt', i + 1)) evil.write('project/../escape.txt', i, 'latin1');
  const r1 = await importAs(evil, 'jsg'); assert.equal(r1.status, 400, JSON.stringify(r1.json).slice(0, 300));
  const xxe = await build(async (add) => { await add('manifest.json', manifest()); await add('project/project.json', '{"name":"x"}'); await add('project/jsg/doc.xml', '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>'); });
  const r2 = await importAs(xxe, 'jsg'); assert.equal(r2.status, 400); assert.match(JSON.stringify(r2.json), /unsafe XML|UNSAFE_XML/i);
  const newer = await build(async (add) => { await add('manifest.json', manifest({ manifestVersion: 99 })); await add('project/project.json', '{"name":"x"}'); });
  const r3 = await importAs(newer, 'jsg'); assert.equal(r3.status, 400); assert.match(JSON.stringify(r3.json), /newer version|ARCHIVE_TOO_NEW/);
  const incomplete = await build(async (add) => { await add('manifest.json', manifest()); });
  const r4 = await importAs(incomplete, 'jsg'); assert.equal(r4.status, 400); assert.match(JSON.stringify(r4.json), /project\.json|ARCHIVE_INCOMPLETE/);

  assert.equal((await w.get('/api/projects')).json.projects.length, before, 'no refused archive left a project behind');
});

test('only someone who can read the project may export it', async () => {
  const made = await w.post('/api/projects', { name: 'Archive private', format: 'jsg', domain: 'land', manualType: 'uhb' });
  const m = await admin.post('/api/team/users', { username: 'stranger', fullName: 'Stranger', role: 'author' });
  const s = new h.Client('stranger'); await s.post('/api/auth/login', { username: 'stranger', password: m.json.tempPassword }); await s.post('/api/auth/onboarding', { username: 'stranger', password: PW });
  const r = await s.get(`/api/projects/${made.json.project.id}/export`);
  assert.ok([403, 404].includes(r.status), `a stranger gets ${r.status}`);
  assert.equal((await w.get(`/api/projects/${made.json.project.id}/export`)).status, 200);
});
