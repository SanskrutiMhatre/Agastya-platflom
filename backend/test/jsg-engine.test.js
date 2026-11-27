'use strict';
// The JSG engine (Joint Services Guide): its catalogue, authoring API, validation, PDF build and - above all - its ISOLATION from the JSS and S1000D engines.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const BACKEND = path.resolve(__dirname, '..');
let h; let w; let id; let dir;

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'gita', fullName: 'Gita', role: 'author' });
  w = new h.Client('gita'); await w.post('/api/auth/login', { username: 'gita', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'gita', password: PW });
});
test.after(async () => { await h.close(); });

test('catalogue: JSG is a format of its own with two built types (User Handbook, ISPL); an unknown type is refused', async () => {
  const jsg = (await w.get('/api/formats')).json.formats.find((x) => x.id === 'jsg');
  assert.equal(jsg.ready, true);
  const types = jsg.domains[0].manualTypes;
  assert.deepEqual(types.map((t) => [t.id, t.ready]), [['uhb', true], ['ispl', true]]);
  const r = await w.post('/api/projects', { name: 'Jsg unknown refused', format: 'jsg', domain: 'land', manualType: 'mrls' });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'FORMAT_NOT_READY');
  const t = (await w.get('/api/jsg/types')).json.types;
  assert.deepEqual(t.map((x) => x.id), ['uhb', 'ispl']);
});

test('a JSG User Handbook project: its own source file, no S1000D publication module, a valid starting document', async () => {
  const r = await w.post('/api/projects', { name: 'Jsg UHB', format: 'jsg', domain: 'land', manualType: 'uhb' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.project.format, 'jsg'); id = r.json.project.id;
  dir = path.join(h.ws, 'projects', id);
  assert.ok(fs.existsSync(path.join(dir, 'jsg-document.xml')));
  assert.equal(fs.existsSync(path.join(dir, 'publication.xml')), false, 'a JSG project has no S1000D publication module / JSS book');
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  assert.equal(pj.format, 'jsg'); assert.equal(pj.jsgDocType, 'uhb'); assert.notEqual(pj.authoring, 'jss-xml');
  const d = (await w.get(`/api/projects/${id}/jsg`)).json;
  assert.equal(d.docType, 'uhb'); assert.equal(d.report.errors, 0, JSON.stringify(d.report.findings));
  assert.match(d.xml, /<chapter [^>]*title="General Description"/);
  assert.equal((d.xml.match(/<chapter /g) || []).length, 5, 'the stencil has five chapters');
  assert.equal((d.xml.match(/<appendix /g) || []).length, 9, 'and nine appendices (H J K M N AA AB AC AD)');
});

test('saving: malformed XML is refused, a schema-invalid draft is kept and reported, a stale hash is a conflict', async () => {
  const d = (await w.get(`/api/projects/${id}/jsg`)).json;
  assert.equal((await w.put(`/api/projects/${id}/jsg`, { xml: '<jsgdoc' })).json.code, 'MALFORMED_XML');
  const draft = d.xml.replace('<meta>', '<meta><bogus/>');
  const bad = await w.put(`/api/projects/${id}/jsg`, { xml: draft, baseHash: d.hash });
  assert.equal(bad.status, 200); assert.ok(bad.json.report.errors > 0); assert.ok(bad.json.report.findings.some((f) => f.rule === 'JSG-SCHEMA'));
  assert.match(fs.readFileSync(path.join(dir, 'jsg-document.xml'), 'utf8'), /<bogus\/>/, 'the draft is stored');
  const stale = await w.put(`/api/projects/${id}/jsg`, { xml: d.xml, baseHash: d.hash });
  assert.equal(stale.status, 409); assert.equal(stale.json.code, 'STALE_DOCUMENT');
  const wrongType = await w.put(`/api/projects/${id}/jsg`, { xml: d.xml.replace('type="uhb"', 'type="ispl"') });
  assert.equal(wrongType.json.code, 'DOCTYPE_MISMATCH');
  // a draft cannot be published
  const blocked = await w.post(`/api/projects/${id}/jsg/build`);
  assert.equal(blocked.status, 422); assert.equal(blocked.json.code, 'VALIDATION_FAILED');
  // restore the good document
  assert.equal((await w.put(`/api/projects/${id}/jsg`, { xml: d.xml })).json.report.errors, 0);
});

test('a table that does not hold together, an absolute picture path and a dangling cross-reference are errors', async () => {
  const doc = (await w.get(`/api/projects/${id}/jsg`)).json.xml;
  const withTable = doc.replace('<clause id="k1" title="General"><figure title="FIGURE NAME"/></clause>', '<clause id="k1" title="General"><table title="T"><body><row><cell><text>a</text></cell><cell><text>b</text></cell></row><row><cell><text>c</text></cell></row></body></table><figure title="F"><graphic src="C:/x.png"/></figure><para><xref to="nowhere">x</xref></para></clause>');
  assert.notEqual(withTable, doc);
  const r = (await w.post(`/api/projects/${id}/jsg/validate`, { xml: withTable })).json;
  const rules = r.findings.map((f) => f.rule);
  assert.ok(rules.includes('JSG-TABLE'), JSON.stringify(rules)); assert.ok(rules.includes('JSG-GRAPHIC-PATH'));
  assert.ok(rules.includes('JSG-XREF') || rules.includes('JSG-SCHEMA'), 'the dangling reference is caught');
});

test('the PDF: built by the JSG engine from the saved document, with the stencil structure and numbering', async () => {
  const b = await w.post(`/api/projects/${id}/jsg/build`);
  assert.equal(b.status, 200, JSON.stringify(b.json)); assert.ok(b.json.bytes > 5000);
  const pdf = await w.get(`/api/projects/${id}/jsg/pdf`);
  assert.equal(pdf.status, 200); assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  const fo = fs.readFileSync(path.join(dir, 'jsg-output.fo'), 'utf8');
  for (const s of ['CHAPTER 1', 'GENERAL DESCRIPTION', 'SECTION 1', 'INTRODUCTION', '1.1', 'AMENDMENTS', 'CONTENTS', 'LIST OF FIGURES', 'APPENDIX', 'USER HANDBOOK', 'RESTRICTED', 'This page is intentionally left blank.']) {
    assert.ok(fo.includes(s), `the FO lacks "${s}"`);
  }
  // mirrored margins: one master with the binding on the left, one on the right
  assert.match(fo, /master-name="p-odd"[^>]*><fo:region-body[^>]*margin-left="25mm"[^>]*margin-right="15mm"/);
  assert.match(fo, /master-name="p-even"[^>]*><fo:region-body[^>]*margin-left="15mm"[^>]*margin-right="25mm"/);
  // the engine ran on the JSG stylesheets only
  assert.equal(fs.existsSync(path.join(dir, '_resolved-pm.xml')), false); assert.equal(fs.existsSync(path.join(dir, 'jss-output.pdf')), false);
});

test('ISOLATION: no JSG logic in the JSS or S1000D engines, stylesheets, schemas or build code; the JSG stylesheets include nothing foreign', () => {
  const read = (p) => fs.readFileSync(path.join(BACKEND, p), 'utf8');
  const walk = (d, out = []) => { for (const e of fs.readdirSync(path.join(BACKEND, d), { withFileTypes: true })) { const rel = `${d}/${e.name}`; if (e.isDirectory()) walk(rel, out); else out.push(rel); } return out; };
  const guarded = [
    ...walk('vendor/pipeline').filter((f) => /\.(xsl|xml|svg)$/i.test(f)),
    ...walk('vendor/engine').filter((f) => f.endsWith('.js')),
    ...walk('src/services/jss'), ...walk('src/services/jssdm'), 'src/routes/jss.ts', 'src/routes/jssdm.ts',
    'src/services/publisher.ts', 'src/services/publishGate.ts', 'src/services/validation.ts', 'src/services/release.ts', 'src/services/csdb.ts',
    ...walk('schemas/jss'),
  ];
  // comments are ignored: an existing remark in publishGate.ts says "a JSS or JSG project is never BREX-checked"; what must not exist is JSG CODE or data in these files
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(^|[^:])\/\/[^\n]*/g, '$1');
  const hits = guarded.filter((f) => /jsg/i.test(code(f)));
  assert.deepEqual(hits, [], `JSG leaked into: ${hits.join(', ')}`);
  for (const f of walk('schemas/jsg/engine').filter((x) => x.endsWith('.xsl'))) {
    for (const m of read(f).matchAll(/<xsl:(?:include|import)\s+href="([^"]+)"/g)) assert.match(m[1], /^jsg-[a-z]+\.xsl$/, `${f} includes ${m[1]}`);
    assert.doesNotMatch(read(f).replace(/<!--[\s\S]*?-->/g, ''), /jsstofo|s1000dtofo|s1000dtojss/, `${f} uses another engine`);
  }
});

test('a new User Handbook prints the stencil: same pages, the red underlined RESTRICTED, the stencil\'s front matter and a landscape System Tree Chart', { timeout: 300000 }, async () => {
  const { readPdf } = require('./pdftools');
  const r = await w.post('/api/projects', { name: 'Jsg UHB stencil', format: 'jsg', domain: 'land', manualType: 'uhb' });
  const pid = r.json.project.id; const d = path.join(h.ws, 'projects', pid);
  const b = await w.post(`/api/projects/${pid}/jsg/build`); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 300));
  const fo = fs.readFileSync(path.join(d, 'jsg-output.fo'), 'utf8');
  const pdf = path.join(d, 'jsg-output.pdf');
  const doc = await readPdf(pdf);
  const page = (n) => doc.text({ first: n, last: n }).replace(/\s+/g, ' ').trim();

  // head and foot: RESTRICTED in red, 12 pt, underlined (JSG_UHB_Stencil headers and footers); the page number in brackets, 12 pt
  assert.match(fo, /<fo:inline font-size="12pt" color="#FF0000" text-decoration="underline"[^>]*>RESTRICTED<\/fo:inline>/);
  assert.ok(!/font-size="9pt"[^>]*>RESTRICTED/.test(fo), 'the old 9 pt black head is gone');
  // the stencil is 110 pages and this is the same book: front matter in the stencil's order, then the body
  assert.equal(doc.pageCount, 110);
  assert.match(page(1), /DOCUMENT NO\..*USER HANDBOOK FOR PROJECT NAME|DOCUMENT NO\..*USER HANDBOOK FOR/);
  assert.match(page(3), /AMENDMENTS/); assert.match(page(5), /WARNING 1\. 2\. 3\. 4\. 5\. 6\./);
  assert.match(page(7), /DEMOLITION OF EQUIPMENT TO PREVENT ENEMY USE/); assert.match(page(10), /Figure\. 1.*SWITCH OFF/);
  assert.match(page(11), /ABBREVIATIONS Sr\. No\. Abbreviation Issued For 1 2 3/); assert.match(page(12), /25 26 27.*37/, 'the 37 numbered rows run onto a second page, as the stencil\'s do');
  assert.match(page(13), /PREFACE 1\. This handbook provides information required by the user units/);
  assert.match(page(15), /DO’S 1\. 2\. 3\. 4\. 5\. DONT’S 1\. 2\. 3\. 4\. 5\./); assert.match(page(17), /IMPORTANT POINTS 1 2 3 4 5/);
  assert.match(page(21), /CONTENTS CHAPTERS DESCRIPTION PAGE No\. CHAPTER 1 GENERAL DESCRIPTION/); assert.match(page(22) + page(21), /Section 6 Appendices/);
  assert.match(page(23), /LIST OF FIGURES Figure 1: FIGURE NAME\.+ \d+ Figure 2: System Tree Chart/); assert.match(page(25), /LIST OF TABLES Table 1: Technical Specifications/);
  // body: CHAPTER and SECTION dividers, then 1.1 General with its captioned placeholder figure, 1.2 with a lettered list and Table 1, and 1.3 on a landscape page
  assert.match(page(27), /CHAPTER 1 GENERAL DESCRIPTION/); assert.match(page(29), /SECTION 1 INTRODUCTION/);
  assert.match(page(31), /1\.1 GENERAL Figure 1: FIGURE NAME 1\.2 SPECIAL FEATURES AND SPECIFICATIONS \(a\) Table 1: Technical Specifications Sr\. No\. Parameter Value/);
  assert.match(page(32), /1\.3 SYSTEM TREE CHART Figure 2: System Tree Chart/);
  const size = doc.pageSize(32);
  assert.ok(size.width > size.height, `page 32 is landscape (${size.width} x ${size.height} pt)`);
  assert.match(page(93), /APPENDIX ‘H’ SYSTEM SPECIFICATION/, 'the appendices start after their SECTION divider');
});
