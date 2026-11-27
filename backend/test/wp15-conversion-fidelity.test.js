'use strict';
// WP-15 (PUB-008, PUB-009, PUB-015, ARC-024): conversion fidelity.
//   - JSS -> S1000D -> JSS keeps every block kind in place (paragraph, list, table, figure with its picture and its numbered key, note, warning, caution),
//     the picture arrives with the same bytes, no placeholder, no "(untitled)" heading; what cannot be carried (links, a page break) is a WARNING, never info only;
//   - a warning or a caution anywhere in a section converts (it used to be refused after 12-17 s: "Element 'warning': This element is not expected");
//   - the S1000D this platform writes validates: every data module against descript.xsd and the publication module against pm.xsd, after the
//     conversion AND after a save in the publication editor;
//   - an S1000D project's pictures reach the converted project whatever their name and whether they sit in csdb/ or Media/;
//   - JSS -> JSG keeps a figure's numbered key as text and reports it as a warning.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let h; let w; let canonical; let schemaCheck;

test.before(async () => {
  h = await boot();
  canonical = require('../dist/services/jss/rwi/canonical'); ({ schemaCheck } = require('../dist/services/jss/rwi/validate'));
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'fidelity', fullName: 'Fidelity', role: 'author' });
  w = new h.Client('fidelity'); await w.post('/api/auth/login', { username: 'fidelity', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'fidelity', password: PW });
});
test.after(async () => { if (h) await h.close(); });

const dirOf = (id) => path.join(h.ws, 'projects', id);
const BODY = '<para>Chapter text.</para><note><para>Chapter note.</para></note>'
  + '<section id="alpha"><title>Alpha</title><para>First para.</para>'
  + '<warning><para>Hot surface.</para></warning><para>After the warning.</para>'
  + '<caution><para>Fragile.</para></caution><warning><para>Second warning after a caution.</para></warning>'
  + '<list type="number"><item>One</item><item>Two</item></list>'
  + '<table id="t1"><title>Loads</title><thead><row><cell>Item</cell><cell>Value</cell></row></thead><tbody><row><cell>Mass</cell><cell>10 kg</cell></row></tbody></table>'
  + '<figure id="f1"><title>Plate</title><graphic src="Media/plate.png" width="40mm"/><legend><keyitem num="1">Bolt</keyitem><keyitem num="2">Nut</keyitem></legend></figure>'
  + '<para>See <xref to="f1">the plate</xref> and <xref href="http://example.org">the site</xref>.</para>'
  + '<note><para>Last note.</para></note><pageBreak/>'
  + '<section id="alpha-sub"><title>Alpha detail</title><caution><para>Caution first.</para></caution><para>Detail text.</para></section></section>'
  + '<section id="beta"><title>Beta</title><warning><para>Warning first.</para></warning><para>Beta text.</para></section>';

async function jssSource(name) {
  const r = await w.post('/api/projects', { name, format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201); const id = r.json.project.id; const U = `/api/projects/${id}`;
  fs.mkdirSync(path.join(dirOf(id), 'Media'), { recursive: true }); fs.writeFileSync(path.join(dirOf(id), 'Media', 'plate.png'), PNG);
  const g = await w.get(`${U}/jss`);
  let xml = g.json.xml.replace('</bookmeta>', '<projectCode>FID01</projectCode></bookmeta>');
  xml = xml.replace(/(<chapter number="1"[^>]*>\s*<title>[^<]*<\/title>)[\s\S]*?(<\/chapter>)/, (_m, a, b) => `${a}${BODY}${b}`);
  const put = await w.put(`${U}/jss`, { xml, baseHash: g.json.hash }); assert.equal(put.status, 200, JSON.stringify(put.json).slice(0, 300));
  assert.equal(put.json.report.errors, 0, 'the source is a valid JSS document');
  return { id, U };
}

/** The blocks of a section, in order, as "kind: words" (a figure: its title, picture count and key). */
function blocksOf(section) {
  const out = [];
  for (const c of section.children) {
    if (c.k === 'section') { out.push(`section: ${c.title}`, ...blocksOf(c).map((x) => `  ${x}`)); continue; }
    if (c.k === 'para') out.push(`para: ${canonical.plain(c.inline)}`);
    else if (c.k === 'list') out.push(`list: ${c.items.map((it) => it.parts.map((p) => (p.inline ? canonical.plain(p.inline) : '')).join('')).join(' | ')}`);
    else if (c.k === 'table') out.push(`table: ${c.title} ${c.head.length}+${c.body.length} rows`);
    else if (c.k === 'figure') out.push(`figure: ${c.title} ${c.graphics.length} picture(s) key ${c.legend.map((k) => `${k.num}=${k.text}`).join(',')}`);
    else if (c.k === 'pageBreak') out.push('pageBreak');
    else out.push(`${c.k}: ${c.blocks.map((b) => canonical.plain(b.inline ?? [])).join(' ')}`);
  }
  return out;
}
const sectionNamed = (doc, title) => { let hit = null; const walk = (list) => { for (const c of list) if (c.k === 'section') { if (c.title === title && !hit) hit = c; walk(c.children); } }; for (const ch of doc.chapters) walk(ch.children); return hit; };

let s1000dId; let sourceId;

test('JSS -> S1000D -> JSS: every block kind comes back in place, the picture with the same bytes; what is not carried is a warning', async () => {
  const src = await jssSource('Fidelity source'); sourceId = src.id;
  const t0 = Date.now();
  const toS = await w.post(`${src.U}/convert`, { to: 's1000d', name: 'Fidelity S1000D' });
  assert.equal(toS.status, 201, `a document with warnings and cautions in its sections converts: ${JSON.stringify(toS.json).slice(0, 600)}`);
  s1000dId = toS.json.project.id;
  const codes = (r) => r.json.findings.map((f) => `${f.severity}:${f.code}`);
  assert.ok(codes(toS).includes('warning:export-xref'), `the dropped links are a warning: ${codes(toS)}`);
  assert.ok(codes(toS).includes('warning:export-page-break'), `the dropped page break is a warning: ${codes(toS)}`);
  assert.ok(codes(toS).includes('warning:chapter-text-moved'), `the chapter's own text moving into a module of its own is said: ${codes(toS)}`);
  assert.ok(!codes(toS).some((c) => /figure-legend/.test(c)), 'the figure key is carried (no loss reported)');
  assert.equal(toS.json.imported.media, 1, 'the picture is in the S1000D project');

  const back = await w.post(`/api/projects/${s1000dId}/convert`, { to: 'jss', name: 'Fidelity back' });
  assert.equal(back.status, 201, JSON.stringify(back.json).slice(0, 600));
  const bc = codes(back);
  assert.equal(back.json.counts.pictures, 1, 'one picture comes back');
  for (const bad of ['warning:picture-missing', 'warning:chapter-unknown', 'warning:publication-schema-error', 'warning:placed-by-number']) assert.ok(!bc.includes(bad), `${bad} in ${bc}`);
  const backId = back.json.project.id;
  const pics = fs.readdirSync(path.join(dirOf(backId), 'Media'));
  assert.ok(pics.some((f) => sha(fs.readFileSync(path.join(dirOf(backId), 'Media', f))) === sha(PNG)), `the picture arrived with the same bytes (${pics})`);

  const before = canonical.parseJss((await w.get(`${src.U}/jss`)).json.xml);
  const after = canonical.parseJss((await w.get(`/api/projects/${backId}/jss`)).json.xml);
  for (const title of ['Alpha', 'Beta']) {
    const want = blocksOf(sectionNamed(before, title)).filter((b) => b !== 'pageBreak');     // the page break is the reported loss
    assert.deepEqual(blocksOf(sectionNamed(after, title)), want, `section ${title}`);
  }
  // the chapter's own text comes back as the first section of that chapter, in the same chapter, nothing appended to the last chapter
  const ch1 = after.chapters[0];
  assert.equal(ch1.children[0].k, 'section'); assert.equal(ch1.children[0].title, before.chapters[0].title);
  assert.deepEqual(blocksOf(ch1.children[0]), ['para: Chapter text.', 'note: Chapter note.']);
  assert.deepEqual(ch1.children.slice(1).map((c) => c.title), ['Alpha', 'Beta']);
  assert.ok(!JSON.stringify(after.chapters.slice(1)).includes('"Alpha"'), 'nothing of chapter 1 went to another chapter');
  console.log(`# round trip ${Date.now() - t0} ms`);
});

test('the S1000D this platform writes validates against the Issue 4.2 schemas, after the conversion and after a publication save', async () => {
  assert.ok(s1000dId, 'the previous test made the S1000D project');
  const dir = dirOf(s1000dId);
  const dms = fs.readdirSync(path.join(dir, 'csdb')).filter((f) => /^DMC-.*\.xml$/i.test(f));
  assert.ok(dms.length >= 3);
  const errors = [];
  for (const f of dms) { const r = await schemaCheck(fs.readFileSync(path.join(dir, 'csdb', f), 'utf8'), '4.2', 'descript.xsd'); assert.ok(!r.unchecked, r.unchecked); for (const e of r.errors) errors.push(`${f}:${e.line} ${e.message}`); }
  assert.deepEqual(errors, [], 'every data module is valid');
  const pmCheck = async () => { const r = await schemaCheck(fs.readFileSync(path.join(dir, 'publication.xml'), 'utf8'), '4.2', 'pm.xsd'); assert.ok(!r.unchecked, r.unchecked); return r.errors.map((e) => `${e.line} ${e.message}`); };
  assert.deepEqual(await pmCheck(), [], 'the publication module written by the conversion is valid');
  // the publication editor's save goes through the vendored writer, which writes no applicability and no BREX reference: the saved file keeps them
  const U = `/api/projects/${s1000dId}`; const pm = await w.get(`${U}/pmc`); assert.equal(pm.status, 200, JSON.stringify(pm.json).slice(0, 300));
  const saved = await w.put(`${U}/pmc`, { meta: pm.json.meta, entries: pm.json.entries, baseHash: pm.json.hash }); assert.equal(saved.status, 200, JSON.stringify(saved.json).slice(0, 300));
  assert.deepEqual(await pmCheck(), [], 'the publication module saved by the editor is valid');
  // and the validation of the project (the platform's own checks) finds no error in what it wrote
  const v = await w.post(`${U}/validation`, { brex: false, fresh: true }); assert.equal(v.status, 200);
  assert.equal(v.json.run.summary.error, 0, JSON.stringify(v.json.run.issues?.slice(0, 5)));
});

test('an S1000D project\'s pictures reach the conversion under any name, from csdb/ and from Media/', async () => {
  assert.ok(s1000dId);
  const dir = dirOf(s1000dId); const csdb = path.join(dir, 'csdb');
  const icn = fs.readdirSync(csdb).find((f) => /^ICN-.*\.png$/i.test(f)); assert.ok(icn, 'the converted project keeps its picture beside the data modules');
  // a picture whose file is not ICN-named (the entity declares the file): the reader used to see only ICN- names in csdb/
  fs.renameSync(path.join(csdb, icn), path.join(csdb, 'plate-photo.png'));
  for (const f of fs.readdirSync(csdb).filter((x) => /\.xml$/i.test(x))) { const p = path.join(csdb, f); const t = fs.readFileSync(p, 'utf8'); if (t.includes(icn)) fs.writeFileSync(p, t.split(`"${icn}"`).join('"plate-photo.png"')); }
  // a second picture in Media/, used by nothing: it travels too (reported unused, not lost)
  fs.mkdirSync(path.join(dir, 'Media'), { recursive: true }); const other = Buffer.concat([PNG, Buffer.from([0])]); fs.writeFileSync(path.join(dir, 'Media', 'spare.png'), other);
  for (const to of ['jss', 'jsg']) {
    const r = await w.post(`/api/projects/${s1000dId}/convert`, { to, name: `Pictures as ${to}` }); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 500));
    const codes = r.json.findings.map((f) => f.code);
    assert.ok(!codes.includes('picture-missing'), `${to}: no placeholder (${codes})`);
    const media = path.join(dirOf(r.json.project.id), 'Media'); const hashes = fs.readdirSync(media).map((f) => sha(fs.readFileSync(path.join(media, f))));
    assert.ok(hashes.includes(sha(PNG)), `${to}: the used picture arrived`);
    assert.ok(hashes.includes(sha(other)), `${to}: the picture from Media/ arrived`);
  }
  void sourceId;
});

test('JSS -> JSG: a figure\'s numbered key is kept as words after the figure, and every loss is a warning', async () => {
  const src = await jssSource('Fidelity to JSG');
  const r = await w.post(`${src.U}/convert`, { to: 'jsg', name: 'Fidelity JSG' }); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 500));
  const xml = (await w.get(`/api/projects/${r.json.project.id}/jsg`)).json.xml;
  assert.match(xml, /<para><b>1<\/b> Bolt<\/para>/); assert.match(xml, /<para><b>2<\/b> Nut<\/para>/);
  const by = (code) => r.json.findings.filter((f) => f.code === code).map((f) => f.severity);
  assert.ok(by('figure-legend').length && by('figure-legend').every((s) => s === 'warning'), JSON.stringify(by('figure-legend')));
  assert.ok(by('link-dropped').length && by('link-dropped').every((s) => s === 'warning'), JSON.stringify(by('link-dropped')));
  assert.equal((await w.get(`/api/projects/${r.json.project.id}/jsg`)).json.report.errors, 0, 'the JSG document is valid');
});
