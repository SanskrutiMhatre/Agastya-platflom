'use strict';
// JSS project import / export (the RWI adapter): package -> JSS document -> package.
//
// Uses the real sample (SAMPLE PROJECTS/JSS-0251/RWI.zip) when it is present; a small synthetic package is built for the cases the sample does not cover.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const { createHash } = require('node:crypto');
const { boot } = require('./helpers');
const { ZipFileReader } = require('../dist/services/zipio');

const PW = 'Correct-Horse-9!';
const SAMPLE = path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'JSS-0251', 'RWI.zip');
const haveSample = fs.existsSync(SAMPLE);
let h; let w;
const sha = (b) => createHash('sha256').update(b).digest('hex');

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'jessa', fullName: 'Jessa', role: 'author' });
  w = new h.Client('jessa'); await w.post('/api/auth/login', { username: 'jessa', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'jessa', password: PW });
});
test.after(async () => { await h.close(); });

const create = async (name, projectCode) => {
  const r = await w.post('/api/projects', { name, format: 'jss', domain: 'land', manualType: 'uhb' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.project.id; const U = `/api/projects/${id}`;
  if (projectCode) { const g = await w.get(`${U}/jss`); const xml = g.json.xml.replace('</bookmeta>', `<projectCode>${projectCode}</projectCode></bookmeta>`); const p = await w.put(`${U}/jss`, { xml, baseHash: g.json.hash }); assert.equal(p.status, 200, JSON.stringify(p.json).slice(0, 300)); }
  return { id, U, dir: path.join(h.ws, 'projects', id) };
};
const upload = async (U, file, name = 'RWI.zip') => {
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), name);
  const r = await fetch(`${h.base}${U}/jss/import-project`, { method: 'POST', headers: { cookie: w.cookie }, body: fd });
  return { status: r.status, json: await r.json() };
};
async function unzip(buf) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rwi-')), 'x.zip'); fs.writeFileSync(f, buf);
  const z = ZipFileReader.open(f); const out = new Map();
  for (const e of z.entries) if (!e.isDirectory) out.set(e.name, await z.readBuffer(e));
  z.close(); return out;
}

test('sample: import maps every document and reports what it found', { skip: !haveSample }, async () => {
  const p = await create('RWI import');
  const r = await upload(p.U, SAMPLE);
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
  const c = r.json.import.counts;
  assert.equal(c.documents, 33); assert.equal(c.chapters, 7); assert.equal(c.picturesMissing, 13); assert.equal(c.documentsPlacedByNumber, 10);
  assert.equal(r.json.report.errors, 0, JSON.stringify(r.json.report).slice(0, 600));
  const codes = new Set(r.json.import.findings.map((f) => f.code));
  for (const k of ['picture-missing', 'placed-by-number', 'table-repaired', 'picture-unused', 'document-unlisted']) assert.ok(codes.has(k), `finding ${k}`);
  assert.ok(r.json.import.findings.every((f) => !/S1000D|dmCode|dmodule/i.test(f.message)), 'plain language only');
  const rep = await w.get(`${p.U}/jss/import-report`); assert.equal(rep.status, 200); assert.equal(rep.json.counts.documents, 33);
  // the placeholder pictures are in Media, and every picture the document names exists
  const g = await w.get(`${p.U}/jss`);
  for (const m of g.json.xml.matchAll(/src="Media\/([^"]+)"/g)) assert.ok(fs.existsSync(path.join(p.dir, 'Media', m[1])), `Media/${m[1]}`);
});

test('sample: an unchanged import exports the original documents byte for byte, and the same files', { skip: !haveSample }, async () => {
  const p = await create('RWI round trip');
  assert.equal((await upload(p.U, SAMPLE)).status, 200);
  const chk = await w.get(`${p.U}/jss/export-check`); assert.equal(chk.status, 200);
  assert.equal(chk.json.report.counts.documentsKept, 33); assert.equal(chk.json.report.counts.documentsRebuilt, 0);
  const ex = await w.get(`${p.U}/jss/export`); assert.equal(ex.status, 200, ex.buf.toString().slice(0, 400));
  const out = await unzip(ex.buf);
  const src = await unzip(fs.readFileSync(SAMPLE));
  let same = 0;
  for (const [name, data] of src) { if (!/\/XML\/.+\.xml$/i.test(name)) continue; const got = out.get(name); assert.ok(got, `exported ${name}`); assert.equal(sha(got), sha(data), `${name} identical`); same++; }
  assert.equal(same, 33);
  const icn = [...out.keys()].filter((n) => /\/ICN\//.test(n)); const srcIcn = [...src.keys()].filter((n) => /\/ICN\//.test(n));
  assert.deepEqual(icn.sort(), srcIcn.sort(), 'the same pictures; placeholders are not exported');
  assert.ok([...out.keys()].some((n) => /EXPORT-REPORT\.txt$/.test(n)));
});

test('sample: editing a section changes only that document; the others stay identical and the contents list names all of them', { skip: !haveSample }, async () => {
  const p = await create('RWI edit');
  assert.equal((await upload(p.U, SAMPLE)).status, 200);
  const g = await w.get(`${p.U}/jss`);
  const xml = g.json.xml.replace('Refer Table 1.1 for performance specifications of TEER.', 'Refer Table 1.1 for the performance specifications of TEER (edited).');
  assert.notEqual(xml, g.json.xml);
  assert.equal((await w.put(`${p.U}/jss`, { xml, baseHash: g.json.hash })).status, 200);
  const chk = await w.get(`${p.U}/jss/export-check`); assert.equal(chk.json.ok, true, JSON.stringify(chk.json.report.findings.filter((f) => f.severity === 'error')));
  assert.equal(chk.json.report.counts.documentsRebuilt, 1); assert.equal(chk.json.report.counts.documentsKept, 32);
  const out = await unzip((await w.get(`${p.U}/jss/export`)).buf);
  const src = await unzip(fs.readFileSync(SAMPLE));
  const names = [...src.keys()].filter((n) => /\/XML\/.+\.xml$/i.test(n)); let changed = 0;
  for (const n of names) if (sha(out.get(n)) !== sha(src.get(n))) { changed++; assert.match(out.get(n).toString('utf8'), /\(edited\)/); assert.ok(/<identAndStatusSection>[\s\S]*<dmCode modelIdentCode="GAV"/.test(out.get(n).toString('utf8')), 'identity preserved'); }
  assert.equal(changed, 1);
  const pmc = out.get([...out.keys()].find((n) => /PMC-IETM\.xml$/.test(n))).toString('utf8');
  assert.equal((pmc.match(/<dmRef>/g) || []).length, 33, 'all 33 documents are in the contents list (the 10 unlisted ones too)');
});

test('native project: export needs a project code, then writes new documents that meet the structure rules', async () => {
  const p = await create('Native');
  const g = await w.get(`${p.U}/jss`);
  const body = g.json.xml.replace(/(<chapter number="2"[^>]*>\s*<title>[^<]*<\/title>)/, `$1<para>Hello &amp; welcome.</para><section><title>Start up</title><list type="number"><item>Switch on.</item><item>Wait.</item></list><table><thead><row><cell><para>A</para></cell><cell><para>B</para></cell></row></thead><tbody><row><cell>1</cell><cell>2</cell></row></tbody></table></section>`);
  assert.notEqual(body, g.json.xml);
  assert.equal((await w.put(`${p.U}/jss`, { xml: body, baseHash: g.json.hash })).status, 200);
  const no = await w.get(`${p.U}/jss/export`); assert.equal(no.status, 422); assert.ok(no.json.report.findings.some((f) => f.code === 'project-code'));
  const g2 = await w.get(`${p.U}/jss`);
  assert.equal((await w.put(`${p.U}/jss`, { xml: g2.json.xml.replace('</bookmeta>', '<projectCode>TEER</projectCode></bookmeta>'), baseHash: g2.json.hash })).status, 200);
  const chk = await w.get(`${p.U}/jss/export-check`); assert.equal(chk.json.ok, true, JSON.stringify(chk.json.report.findings));
  const out = await unzip((await w.get(`${p.U}/jss/export`)).buf);
  const dms = [...out.keys()].filter((n) => /\/XML\/DMC-TEER-.+\.xml$/.test(n));
  assert.ok(dms.length >= 2);                                    // the chapter's own text + "Start up" + the stencil's own sections
  assert.equal(chk.json.report.counts.documentsKept, 0);          // nothing came from a package
  assert.ok(dms.some((n) => /Hello &amp; welcome\./.test(out.get(n).toString('utf8'))), 'chapter text is exported');
  assert.ok(dms.every((n) => /<dmCode modelIdentCode="TEER"/.test(out.get(n).toString('utf8'))));
  assert.ok(dms.some((n) => /Start up/.test(out.get(n).toString('utf8'))));
  assert.ok([...out.keys()].some((n) => /PMC-TEER/.test(n)));
});

test('a file that is not a project package is refused in plain words, and the document is left alone', async () => {
  const p = await create('Refusals');
  const before = (await w.get(`${p.U}/jss`)).json.hash;
  const junk = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rwi-')), 'x.zip'); fs.writeFileSync(junk, 'this is not a zip');
  const a = await upload(p.U, junk); assert.equal(a.status, 400); assert.match(a.json.error, /ZIP/i);
  const txt = path.join(path.dirname(junk), 'x.txt'); fs.writeFileSync(txt, 'x');
  const b = await upload(p.U, txt, 'x.txt'); assert.equal(b.status, 400); assert.equal(b.json.code, 'NOT_ZIP');
  assert.equal((await w.get(`${p.U}/jss`)).json.hash, before, 'nothing changed');
  assert.equal((await w.get(`${p.U}/jss/import-report`)).status, 404);
});

test('the new routes are guarded: no session, no access', async () => {
  const anon = new h.Client('anon');
  for (const [m, u] of [['get', '/api/projects/x/jss/export'], ['get', '/api/projects/x/jss/export-check'], ['get', '/api/projects/x/jss/import-report']]) assert.equal((await anon[m](u)).status, 401, u);
  assert.equal((await anon.post('/api/projects/x/jss/import-project', {})).status, 401);
});

test('sample: a project whose document file was overwritten by the package contents list is recovered by Import project', { skip: !haveSample }, async () => {
  const p = await create('RWI overwritten');
  const src = await unzip(fs.readFileSync(SAMPLE));
  fs.writeFileSync(path.join(p.dir, 'publication.xml'), src.get([...src.keys()].find((n) => /PMC-IETM\.xml$/.test(n))));
  assert.equal((await w.get(`${p.U}/jss`)).status === 200 ? 'read' : 'refused', 'read');
  const r = await upload(p.U, SAMPLE); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.json.report.errors, 0);
  const g = await w.get(`${p.U}/jss`); assert.match(g.json.xml, /<jssbook /);
});
