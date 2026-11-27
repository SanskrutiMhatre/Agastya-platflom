'use strict';
// Packages written by the older PDF Publication Tool (JSS Publisher) import into a blank JSS project like any other package:
//   * its flat layout (data modules and the publication module side by side, an empty DOCTYPE, picture names that nothing declares), and
//   * its project export (.jsspub.zip: manifest.json, project/PM, project/csdb, project/Media ...).
// Built from small synthetic packages in the same shape (the real sample is a customer document and is not part of the repository).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let w; let ZipStreamWriter;

test.before(async () => {
  h = await boot(); ({ ZipStreamWriter } = require('../dist/services/zipio'));
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'legacy', fullName: 'Legacy', role: 'author' });
  w = new h.Client('legacy'); await w.post('/api/auth/login', { username: 'legacy', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'legacy', password: PW });
});
test.after(async () => { await h.close(); });

// ── the package ─────────────────────────────────────────────────────────────────────────────────────────────
const attrs = (c) => `modelIdentCode="${c.mic}" systemDiffCode="${c.diff}" systemCode="${c.sys}" subSystemCode="${c.sub}" subSubSystemCode="0" assyCode="${c.assy}" disassyCode="${c.dis}" disassyCodeVariant="A" infoCode="${c.info}" infoCodeVariant="A" itemLocationCode="D"`;
const nameOf = (c) => `DMC-${c.mic}-${c.diff}-${c.sys}-${c.sub}0-${c.assy}-${c.dis}A-${c.info}A-D_001-00_EN-IN.xml`;
const dm = (c, techName, infoName, body) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Xignal, S1000D Issue 4.2 [xml_schema_flat], Test Data -->
<!DOCTYPE dmodule []>
<dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/descript.xsd">
  <identAndStatusSection><dmAddress><dmIdent><dmCode ${attrs(c)}/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="00"/></dmIdent>
  <dmAddressItems><issueDate year="2022" month="12" day="31"/><dmTitle><techName>${techName}</techName><infoName>${infoName}</infoName></dmTitle></dmAddressItems></dmAddress>
  <dmStatus issueType="new"><security securityClassification="01"/><responsiblePartnerCompany enterpriseCode="U17V0"><enterpriseName>GPSL</enterpriseName></responsiblePartnerCompany><originator enterpriseCode="U17V0"><enterpriseName>GPSL</enterpriseName></originator><applic><displayText><simplePara>All</simplePara></displayText></applic><brexDmRef><dmRef><dmRefIdent><dmCode modelIdentCode="X1" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="A" itemLocationCode="D"/></dmRefIdent></dmRef></brexDmRef><qualityAssurance><firstVerification verificationType="tabtop"/></qualityAssurance></dmStatus></identAndStatusSection>
  <content><description>${body}</description></content>
</dmodule>`;
const ref = (c, t, i) => `<dmRef><dmRefIdent><dmCode ${attrs(c)}/><issueInfo issueNumber="001" inWork="00"/><language languageIsoCode="en" countryIsoCode="IN"/></dmRefIdent><dmRefAddressItems><dmTitle><techName>${t}</techName><infoName>${i}</infoName></dmTitle></dmRefAddressItems></dmRef>`;
const entry = (title, inner) => `<pmEntry>${title ? `<pmEntryTitle>${title}</pmEntryTitle>` : ''}${inner}</pmEntry>`;

const FRONT = { mic: 'X1', diff: 'A', sys: '00', sub: '0', assy: '00', dis: '00', info: '023' };
const HEAD1 = { mic: 'X1', diff: 'A', sys: '01', sub: '0', assy: '00', dis: '00', info: '009' };
const HEAD3 = { mic: 'X1', diff: 'A', sys: '03', sub: '0', assy: '00', dis: '00', info: '009' };
const B1 = { mic: 'RDR', diff: 'B', sys: 'A00', sub: '0', assy: '00', dis: '02', info: '018' };
const B2 = { mic: 'RDR', diff: 'B', sys: 'A00', sub: '0', assy: '00', dis: '03', info: '044' };
const B3 = { mic: 'RDR', diff: 'B', sys: 'A07', sub: '0', assy: '00', dis: '02', info: '820' };

const lp = (title, inner) => `<levelledPara><title>${title}</title>${inner}</levelledPara>`;
const MODULES = [
  [FRONT, 'JSS / Foreword', 'Foreword', lp('Foreword', '<para>Front matter text.</para>')],
  [HEAD1, 'Chapter 1', 'Leading Particulars and General Data', '<levelledPara><para>This chapter covers the following topics:</para></levelledPara>'],
  [HEAD3, 'Chapter 3', 'Unpacking and Removal of Preservatives', '<levelledPara><para>This chapter covers the following topics:</para></levelledPara>'],
  [B1, 'Purpose', 'Introduction', lp('Purpose', '<para>The system carries <emphasis>loads</emphasis>.</para><note><notePara>Keep it dry.</notePara></note>')],
  [B2, 'Features', 'Description', lp('Features', '<para>Features follow.</para><figure><title>Overview</title><graphic infoEntityIdent="ICN-RDR-A-A000000-1-1671Y-02145-A-001-04"/></figure>')],
  [B3, 'Unpacking', 'Procedure', lp('Unpacking and Removal of Preservatives', '<para>Open the crate.</para>')],
];
const PM = (prefix = '') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE pm []>
<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/pm.xsd">
  <identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="RDR" pmIssuer="1671Y" pmNumber="00061" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="000" inWork="01"/></pmIdent><pmAddressItems><issueDate year="2022" month="12" day="31"/><pmTitle>Legacy Test Publication</pmTitle></pmAddressItems></pmAddress></identAndStatusSection>
  <content>${entry('Legacy Test Publication',
    entry('Front matter', entry('Foreword', ref(FRONT, 'JSS / Foreword', 'Foreword'))) +
    entry('Chapter',
      entry('1', entry('LEADING PARTICULARS AND GENERAL DATA', ref(HEAD1, 'Chapter 1', 'Leading Particulars and General Data')) + entry('', ref(B1, 'Purpose', 'Introduction') + ref(B2, 'Features', 'Description'))) +
      entry('3', entry('UNPACKING AND REMOVAL OF PRESERVATIVES', ref(HEAD3, 'Chapter 3', 'Unpacking and Removal of Preservatives')) + entry('', ref(B3, 'Unpacking', 'Procedure')))))}</content>
</pm>`;

async function makeZip(layout) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-')), 'x.zip'); const out = fs.createWriteStream(f); const z = new ZipStreamWriter(out);
  const add = (n, t) => z.addBuffer(n, Buffer.from(t, 'utf8'));
  if (layout === 'flat') {
    for (const [c, t, i, b] of MODULES) await add(`Pkg/${nameOf(c)}`, dm(c, t, i, b));
    await add('Pkg/PMC-RDR-1671Y-00061-00_000-01_EN-IN.xml', PM());
  } else {                                                                       // the older tool's own export
    await add('manifest.json', JSON.stringify({ manifestVersion: 1, id: 'p1', name: 'Legacy', type: 'uhb', templateRef: 'x', exportedAt: '2026-01-01T00:00:00Z' }));
    await add('project/project.json', JSON.stringify({ name: 'Legacy' }));
    for (const [c, t, i, b] of MODULES) await add(`project/csdb/${nameOf(c)}`, dm(c, t, i, b));
    await add('project/PM/publication.xml', PM());
    await add('templates/uhb.house.json', '{}');
  }
  await z.finish(); return f;
}
const upload = async (U, file, name) => {
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), name);
  const r = await fetch(`${h.base}${U}/jss/import-project`, { method: 'POST', headers: { cookie: w.cookie }, body: fd });
  return { status: r.status, json: await r.json() };
};
const newJss = async (name) => { const r = await w.post('/api/projects', { name, format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201); return `/api/projects/${r.json.project.id}`; };
const outline = (xml) => [...xml.matchAll(/<chapter [^>]*>\s*<title>([^<]*)<\/title>|<section id="([^"]*)"[^>]*>\s*<title>([^<]*)</g)].map((m) => (m[1] ? `CH ${m[1]}` : `  ${m[3]}`));

for (const [layout, fileName] of [['flat', 'Legacy.zip'], ['jsspub', 'Legacy.jsspub.zip']]) {
  test(`older tool, ${layout} layout: chapters are found, front matter and chapter heading pages are not sections, nothing is a false error`, async () => {
    const U = await newJss(`Legacy ${layout}`); const r = await upload(U, await makeZip(layout), fileName);
    assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
    const codes = r.json.import.findings.map((f) => f.code);
    assert.ok(!codes.includes('schema-error'), 'undeclared picture names are the older tool\'s habit, not a structure error: ' + JSON.stringify(r.json.import.findings.filter((f) => f.code === 'schema-error').map((f) => f.message)));
    assert.ok(codes.includes('front-matter-skipped')); assert.ok(!codes.includes('placed-by-number'), 'the heading pages are not "sections the contents list does not name"'); assert.ok(!codes.includes('chapter-unknown'));
    assert.equal(r.json.import.counts.documents, 3, 'three body documents; the foreword and the two chapter heading pages are not sections');
    const g = await w.get(`${U}/jss`);
    assert.deepEqual(outline(g.json.xml).slice(0, 3), ['CH Leading Particulars and General Data', '  Purpose', '  Features']);
    const o = outline(g.json.xml); const at3 = o.indexOf('CH Unpacking and Removal of Preservatives');
    assert.ok(at3 > 0 && o[at3 + 1] === '  Unpacking and Removal of Preservatives', 'chapter 3 holds its one section: ' + o.join(' | '));
    assert.ok(!/Foreword|This chapter covers/.test(g.json.xml), 'neither the foreword nor a heading page is in the document');
    assert.match(g.json.xml, /NOTE: ?Keep it dry|Keep it dry/, 'a note inside a paragraph keeps its words');
    // the package's own codes are the project's codes, kept as received; the publication code too
    const id = (await w.get(`${U}/identity`)).json.identity;
    assert.deepEqual(id.modules.map((m) => m.dmc), ['DMC-RDR-B-A00-00-00-02A-018A-D', 'DMC-RDR-B-A00-00-00-03A-044A-D', 'DMC-RDR-B-A07-00-00-02A-820A-D']);
    assert.ok(id.modules.every((m) => m.origin === 'imported')); assert.equal(id.pmc.code, 'PMC-RDR-1671Y-00061-00'); assert.equal(id.pmc.origin, 'imported');
    assert.ok(id.pictures.some((p) => p.icn === 'ICN-RDR-A-A000000-1-1671Y-02145-A-001-04' && p.origin === 'imported'), 'a picture keeps its ICN');
    assert.deepEqual(id.show, { dmc: false }, 'the record keeps only the DMC switch (c61ec89 removed the others)');
    // a section added afterwards belongs to the chapter's system and takes a free code of it; the imported ones are untouched
    const xml = g.json.xml.replace(/(<chapter number="1"[^>]*>[\s\S]*?)(<\/chapter>)/, '$1<section id="added"><title>Added later</title><para>x</para></section>$2');
    assert.equal((await w.put(`${U}/jss`, { xml, baseHash: g.json.hash })).status, 200);
    const after = (await w.get(`${U}/identity`)).json.identity;
    assert.equal(after.modules.find((m) => m.key === 'id:added').dmc, 'DMC-RDR-B-A00-10-00-00A-040A-D');
    assert.deepEqual(after.modules.filter((m) => m.origin === 'imported').map((m) => m.dmc), id.modules.map((m) => m.dmc));
    // exporting it again does not report the package's own files as missing
    const chk = await w.get(`${U}/jss/export-check`); const bad = (chk.json.report.findings || []).filter((f) => f.severity === 'error');
    assert.deepEqual(bad.map((f) => f.code), [], JSON.stringify(bad).slice(0, 300));
  });
}

test('the undeclared-picture helper declares only what is used and missing, and only for the check', () => {
  const { declareUsedPictures } = require('../dist/services/jss/rwi/validate');
  const xml = '<?xml version="1.0"?>\n<!DOCTYPE dmodule []>\n<dmodule><graphic infoEntityIdent="ICN-A-1"/><graphic infoEntityIdent="ICN-B-2"/></dmodule>';
  const out = declareUsedPictures(xml);
  assert.match(out, /<!ENTITY ICN-A-1 SYSTEM "ICN-A-1\.png" NDATA png>/); assert.match(out, /<!ENTITY ICN-B-2 SYSTEM/);
  assert.equal(declareUsedPictures('<dmodule><para>no pictures</para></dmodule>'), '<dmodule><para>no pictures</para></dmodule>');
  const declared = '<!DOCTYPE dmodule [<!ENTITY ICN-A-1 SYSTEM "a.png" NDATA png>]>\n<dmodule><graphic infoEntityIdent="ICN-A-1"/></dmodule>';
  assert.equal(declareUsedPictures(declared), declared, 'a declared picture is left alone');
  assert.match(declareUsedPictures('<dmodule><graphic infoEntityIdent="ICN-C-3"/></dmodule>'), /^<!DOCTYPE dmodule \[/, 'a document without a DOCTYPE gets one');
});

test('the older tool\'s package imports as JSS, JSG or S1000D at the choice of the person importing it (source and target format)', async () => {
  const up = async (file, fields) => {
    const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), 'Legacy.jsspub.zip'); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(`${h.base}/api/xengine/import`, { method: 'POST', headers: { cookie: w.cookie }, body: fd }); return { status: r.status, json: await r.json() };
  };
  const zip = await makeZip('jsspub');
  const asJss = await up(zip, { source: 's1000d', target: 'jss', name: 'Legacy as JSS' });
  assert.equal(asJss.status, 201, JSON.stringify(asJss.json).slice(0, 400)); assert.equal(asJss.json.counts.sections, 3);
  assert.equal((await w.get(`/api/projects/${asJss.json.project.id}/identity`)).json.identity.modules.filter((m) => m.origin === 'imported').length, 3, 'the package\'s codes are kept');
  const asJsg = await up(zip, { source: 'auto', target: 'jsg', name: 'Legacy as JSG' });
  assert.equal(asJsg.status, 201, JSON.stringify(asJsg.json).slice(0, 400));
  const jsg = (await w.get(`/api/projects/${asJsg.json.project.id}/jsg`)).json;
  assert.match(jsg.xml, /<section id="dm-RDR-B-A00-00-00-02A-018A-D" title="Purpose">/); assert.ok(!/Foreword|This chapter covers/.test(jsg.xml)); assert.equal(jsg.report.errors, 0, JSON.stringify(jsg.report.findings.filter((f) => f.severity === 'error')).slice(0, 300));
  const asS = await up(zip, { source: 's1000d', target: 's1000d', name: 'Legacy as S1000D' });
  assert.equal(asS.status, 201, JSON.stringify(asS.json).slice(0, 400)); assert.equal(asS.json.to, 's1000d'); assert.ok(asS.json.imported.dms >= 3, JSON.stringify(asS.json.imported));
  assert.ok(fs.readdirSync(path.join(h.ws, 'projects', asS.json.project.id, 'csdb')).some((n) => /^DMC-RDR-B-A00-00-00-02A-018A-D/.test(n)), 'the documents of the package are in the new S1000D project');
});

test('an older tool\'s package goes out again with its front matter and chapter heading pages, in the same layout, and imports back to the same document', async () => {
  const U = await newJss('Round trip'); const first = await upload(U, await makeZip('flat'), 'Legacy.zip'); assert.equal(first.status, 200, JSON.stringify(first.json).slice(0, 300));
  const chk = await w.get(`${U}/jss/export-check`); assert.equal(chk.status, 200, JSON.stringify(chk.json).slice(0, 400));
  const bad = chk.json.report.findings.filter((f) => f.severity === 'error'); assert.deepEqual(bad.map((f) => f.code), [], JSON.stringify(bad).slice(0, 300));
  assert.ok(!chk.json.report.findings.some((f) => f.code === 'pages-not-restored'), 'the pages were kept by this import, so they can be put back');
  const res = await fetch(`${h.base}${U}/jss/export`, { headers: { cookie: w.cookie } }); assert.equal(res.status, 200);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rt-')), 'export.zip'); fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  const { ZipFileReader } = require('../dist/services/zipio'); const zr = ZipFileReader.open(out); const names = zr.entries.map((e) => e.name); zr.close();
  for (const c of [FRONT, HEAD1, HEAD3]) assert.ok(names.some((n) => n.includes(`DMC-${c.mic}-${c.diff}-${c.sys}-${c.sub}0-${c.assy}-${c.dis}A-${c.info}A-D`)), `${c.info} of system ${c.sys} is in the exported package: ` + names.join(', '));
  // import the export into a second project: the same chapters, the same sections, and the foreword and heading pages are again not sections
  const V = await newJss('Round trip again'); const second = await upload(V, out, 'export.zip'); assert.equal(second.status, 200, JSON.stringify(second.json).slice(0, 400));
  const codes = second.json.import.findings.map((f) => f.code);
  assert.ok(codes.includes('front-matter-skipped') && !codes.includes('placed-by-number') && !codes.includes('chapter-unknown'), codes.join(','));
  assert.equal(second.json.import.counts.documents, first.json.import.counts.documents);
  const a = outline((await w.get(`${U}/jss`)).json.xml); const b = outline((await w.get(`${V}/jss`)).json.xml);
  assert.deepEqual(b, a, 'the same document comes back');
  const idA = (await w.get(`${U}/identity`)).json.identity; const idB = (await w.get(`${V}/identity`)).json.identity;
  assert.deepEqual(idB.modules.map((m) => m.dmc), idA.modules.map((m) => m.dmc), 'the same codes');
  assert.equal(idB.pmc.code, idA.pmc.code);
});
