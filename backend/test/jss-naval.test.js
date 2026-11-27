'use strict';
// JSS NAVAL: the ten stencils of Sampels/NAval_stencil, end to end.
//
//   wizard (Domain: Naval) -> JSS XML (jss-1.0.xsd) -> validation (schema + the stencil's rules) -> composed book -> jsstofo -> XSL-FO -> FOP -> PDF
//
// Where the stencils are present (they are the customer's and are not committed; NAVAL_STENCILS overrides the folder) the registry is checked against the stencils' own
// Word XML - their headings, cover lines, table heads and column widths, page sizes - rather than against numbers copied into this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { boot, tmp } = require('./helpers');
const { pdfText } = require('./pdftools');
const { docxPart } = require('./helpers-stencil');

const PW = 'Correct-Horse-9!';
// The customer's Naval stencils are not committed. They are read from NAVAL_STENCILS, else from manual format/NAval_stencil (git-ignored, like the Land
// stencils); nothing outside the repository is read unless the environment variable names it (QA-014).
const NAVAL = process.env.NAVAL_STENCILS || path.resolve(__dirname, '..', '..', 'manual format', 'NAval_stencil');
const haveStencils = fs.existsSync(path.join(NAVAL, '1_User_Handbook', '1_User_Handbook.docx'));
const SKIP = !haveStencils && `the Naval stencils are not on this machine (looked in ${NAVAL}; set NAVAL_STENCILS or copy them to manual format/NAval_stencil)`;
const LAND = path.resolve(__dirname, '..', '..', 'manual format', 'JSS0251-stencils');

/** type id -> the stencil's file */
const FILES = {
  'naval-uhb': '1_User_Handbook/1_User_Handbook.docx',
  'naval-tm-1': '2_TM_Part-I_Vol1_Technical_Description/TM_Part-I_Technical_Description.docx',
  'naval-tm-2': '3_TM_Part-II_Maintenance/TM_Part-II_Maintenance.docx',
  'naval-tm-3': '4_TM_Part-III_Overhaul/TM_Part-III_Overhaul.docx',
  'naval-tm-4-1': '5_TM_Part-IV_Vol1_Part_List/TM_Part-IV_Vol1_Part_List.docx',
  'naval-tm-4-2': '6_TM_Part-IV_Vol2_Illustrations/TM_Part-IV_Vol2_Illustrations.docx',
  'naval-ds': '7_Design_Specification/Design_Specification.docx',
  'naval-mrls': '8_MRLS/MRLS.docx',
  'naval-ces': '9_Complete_Equipment_Schedule/Complete_Equipment_Schedule.docx',
  'naval-smt-ste': '10_List_of_SMT_STE/List_of_SMT_STE.docx',
};
const IDS = Object.keys(FILES);
const WIZARD_LABELS = ['User Handbook', 'Technical Manual - Part I Technical Description', 'Technical Manual - Part II Maintenance', 'Technical Manual - Part III Overhaul',
  'Technical Manual - Part IV Vol 1 Parts List', 'Technical Manual - Part IV Vol 2 Illustrations', 'Design Specification', 'MRLS', 'Complete Equipment Schedule', 'List of SMT / STE'];

let h; let w; const made = {};
test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'jessa', fullName: 'Jessa', role: 'author' });
  w = new h.Client('jessa'); await w.post('/api/auth/login', { username: 'jessa', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'jessa', password: PW });
});
test.after(async () => { await h.close(); });

const create = async (type, name) => {
  const r = await w.post('/api/projects', { name: name ?? `Naval ${type} ${Object.keys(made).length}`, format: 'jss', domain: 'naval', manualType: type });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.project.id; made[id] = type;
  return { id, U: `/api/projects/${id}`, dir: path.join(h.ws, 'projects', id), card: r.json.project };
};
/** The PDF as a file. With NAVAL_KEEP_DIR set, every PDF the tests build is also kept there (named after its project), to look at. */
const pdfOf = (buf, name) => {
  const f = path.join(tmp('naval-'), 'x.pdf'); fs.writeFileSync(f, buf);
  if (process.env.NAVAL_KEEP_DIR && name) { fs.mkdirSync(process.env.NAVAL_KEEP_DIR, { recursive: true }); fs.copyFileSync(f, path.join(process.env.NAVAL_KEEP_DIR, `${name}.pdf`)); }
  return f;
};
const text = (f) => pdfText(f);                                       // pdf.js (test/pdftools.js), no external program (async)
/** The size of every page, from the PDF's page dictionaries (the page tree is not compressed in FOP's output). */
const pageSizes = (f) => [...fs.readFileSync(f).toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m, i) => ({ page: i + 1, wMm: Number(m[1]) / 72 * 25.4, hMm: Number(m[2]) / 72 * 25.4 }));
const build = async (U) => { const b = await w.post(`${U}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 600)); return pdfOf((await w.get(`${U}/publish/pdf`)).buf, made[U.split('/').pop()]); };
const errors = (r) => r.findings.filter((f) => f.severity === 'error');
const rules = (r) => errors(r).map((f) => f.rule);
const check = async (U, xml) => (await w.post(`${U}/jss/validate`, { xml })).json;

// ── Word XML helpers ─────────────────────────────────────────────────────────────────────────────────────
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const runs = (p) => decode([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')).replace(/\s+/g, ' ').trim();
const key = (s) => s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z]/g, '');
const TYPO = { intsructions: 'instructions' };
const titleKey = (t) => { let s = t.toLowerCase().replace(/\s*\/\s*/g, '/').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim(); for (const [a, b] of Object.entries(TYPO)) s = s.replace(a, b); return s; };
const bodyOf = async (file) => { const doc = await docxPart(file, 'word/document.xml'); return doc.slice(doc.indexOf('<w:body>')); };
const tablesOf = (body) => [...body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((m) => m[0]);
const rowsOf = (tbl) => [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => ({
  text: runs(c[0]), span: Number(/<w:gridSpan w:val="(\d+)"/.exec(c[0])?.[1] ?? 1), vmerge: /<w:vMerge\s*\/>|<w:vMerge w:val="continue"/.test(c[0]),
})));
const gridMm = (tbl) => [...tbl.matchAll(/<w:gridCol w:w="(\d+)"/g)].map((g) => Math.round(Number(g[1]) * 25.4 / 1440 * 10) / 10);
async function headings(file) {
  const doc = await docxPart(file, 'word/document.xml'); const styles = await docxPart(file, 'word/styles.xml');
  const names = {}; for (const m of styles.matchAll(/<w:style [^>]*w:styleId="([^"]+)"[^>]*>\s*<w:name w:val="([^"]+)"/g)) names[m[1]] = m[2];
  const out = [];
  for (const m of doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const sid = /<w:pStyle w:val="([^"]+)"/.exec(m[0])?.[1]; const mm = /^heading ([1-5])$/.exec(names[sid] ?? ''); const t = runs(m[0]);
    if (mm && t) out.push({ level: Number(mm[1]), title: t });
  }
  return out;
}
/** The cover's title block: the paragraphs of the cover table's rows up to its "FOR" row. */
async function coverTitle(file) {
  const t = tablesOf(await bodyOf(file))[1]; const lines = [];
  for (const r of [...t.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((x) => x[0])) {
    const paras = [...r.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].flatMap((p) => decode([...p[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br\/>/g)].map((m) => (m[1] !== undefined ? m[1] : '\n')).join('')).split('\n')).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (paras.length === 1 && paras[0] === 'FOR') break;
    lines.push(...paras);
  }
  return lines;
}
/** The size and orientation of the last section of the stencil: the one its body is set on. */
async function lastPage(file) {
  const doc = await docxPart(file, 'word/document.xml'); const all = [...doc.matchAll(/<w:sectPr[ >][\s\S]*?<\/w:sectPr>/g)].map((m) => m[0]); const s = all[all.length - 1];
  const sz = /<w:pgSz ([^>]*)>/.exec(s)[1]; const n = (a) => Math.round(Number(new RegExp(`w:${a}="(\\d+)"`).exec(sz)[1]) * 25.4 / 1440);
  return { w: n('w'), h: n('h'), landscape: /orient="landscape"/.test(sz) };
}

// ── the catalogue ────────────────────────────────────────────────────────────────────────────────────────

test('the wizard offers the ten Naval stencils, all ready, from the same registry the engine uses', async () => {
  const f = (await w.get('/api/formats')).json.formats.find((x) => x.id === 'jss');
  const naval = f.domains.find((d) => d.id === 'naval').manualTypes;
  assert.deepEqual(naval.map((m) => m.label), WIZARD_LABELS, 'the labels of the wizard screenshot, in its order');
  assert.deepEqual(naval.map((m) => m.id), IDS);
  assert.ok(naval.every((m) => m.ready), 'none is "coming soon" any more');
  const types = (await w.get('/api/jss/types')).json.types;
  assert.deepEqual(types.filter((t) => t.domain === 'naval').map((t) => t.id), IDS, 'the registry is the only list');
  const land = f.domains.find((d) => d.id === 'land').manualTypes;
  assert.deepEqual(land.map((m) => m.id), types.filter((t) => t.domain === 'land').map((t) => t.id), 'Land is unchanged and comes from the same list');
  assert.deepEqual(land.filter((m) => m.ready).map((m) => m.id), land.map((m) => m.id), 'every Land type is ready too (test/jss-authoring.test.js builds them)');
});

test('the schema names exactly the registry types (so a new type cannot be added to one and forgotten in the other)', async () => {
  const xsd = (await w.get('/api/jss/schema')).buf.toString('utf8');
  const enumeration = [...new RegExp('<xs:simpleType name="JssDocType">([\\s\\S]*?)</xs:simpleType>').exec(xsd)[1].matchAll(/<xs:enumeration value="([^"]+)"/g)].map((m) => m[1]);
  const ready = (await w.get('/api/jss/types')).json.types.filter((t) => t.ready);
  assert.deepEqual([...enumeration].sort(), ready.map((t) => t.id).sort());
});

// ── the registry against the stencils' Word XML ───────────────────────────────────────────────────────────

test('the chapter manuals have the stencils\' headings, in order, and the starting document carries every one of them', { skip: SKIP }, async () => {
  for (const id of ['naval-uhb', 'naval-tm-1', 'naval-tm-2', 'naval-tm-3', 'naval-ds']) {
    const heads = await headings(path.join(NAVAL, FILES[id]));
    const type = (await w.get(`/api/jss/types/${id}`)).json;
    assert.deepEqual(type.chapters.map((c) => titleKey(c.title)), heads.filter((x) => x.level === 1).map((x) => titleKey(x.title)), `${id}: chapters`);
    const p = await create(id, `Skeleton ${id}`); const g = (await w.get(`${p.U}/jss`)).json;
    const have = new Set([...g.xml.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => titleKey(decode(m[1]))));
    const examples = new Set(['system or sub-system are']);       // the stencil's own placeholder heading, renamed per unit by the author
    const missing = heads.filter((x) => x.level <= 3).map((x) => titleKey(x.title)).filter((t) => !have.has(t) && !examples.has(t));
    assert.deepEqual(missing, [], `${id}: stencil headings missing from the starting document`);
    assert.equal(g.report.errors, 0, JSON.stringify(errors(g.report)));
  }
});

test('the cover title lines are the stencils\' (every type)', { skip: SKIP }, async () => {
  for (const id of IDS) {
    const lines = await coverTitle(path.join(NAVAL, FILES[id]));
    const type = (await w.get(`/api/jss/types/${id}`)).json;
    assert.equal(key(type.coverTitle.join(' ')), key(lines.join(' ')), `${id}: cover title`);
  }
});

test('which covers have an "INBR No." line is the stencils\' (every type)', { skip: SKIP }, async () => {
  const { JSS_TYPES } = require('../dist/services/jss/registry');
  for (const id of IDS) {
    const body = await bodyOf(path.join(NAVAL, FILES[id]));
    const cover = body.slice(0, body.search(/<w:sectPr/));                                             // the first section of every stencil is its cover
    const has = /INBR/i.test([...cover.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''));
    assert.equal(JSS_TYPES.find((t) => t.id === id).coverInbr, has, `${id}: INBR No. on the cover`);
  }
});

test('the tables of the list stencils are the stencils\' own: same head cells and merges, proportional widths equal to the Word column widths', { skip: SKIP }, async () => {
  const spec = { 'naval-mrls': [12], 'naval-smt-ste': [12], 'naval-ces': [12, 13, 14, 15] };     // zero-based index of the stencil's table(s)
  for (const [id, idx] of Object.entries(spec)) {
    const tables = tablesOf(await bodyOf(path.join(NAVAL, FILES[id])));
    const info = (await w.get(`/api/jss/types/${id}`)).json;
    const own = []; const walk = (ns) => { for (const n of ns ?? []) { if (n.table && !own.some((o) => JSON.stringify(o) === JSON.stringify(n.table))) own.push(n.table); walk(n.children); } }; walk(info.chapters);
    assert.equal(own.length, idx.length, `${id}: number of tables`);
    own.forEach((tpl, i) => {
      const t = tables[idx[i]]; const rows = rowsOf(t); const grid = gridMm(t);
      assert.deepEqual(tpl.widths.split(' ').map((x) => Number(x.replace('*', ''))), grid, `${id} table ${i + 1}: widths`);
      // each head row of the stencil: the cells it starts (a cell merged from above belongs to the row above)
      tpl.head.forEach((row, r) => {
        const word = rows[r].filter((c) => !c.vmerge);
        assert.deepEqual(row.map((c) => key(c.text)), word.map((c) => key(c.text)), `${id} table ${i + 1} head row ${r + 1}`);
        assert.deepEqual(row.map((c) => c.colspan ?? 1), word.map((c) => c.span), `${id} table ${i + 1} head row ${r + 1}: column spans`);
      });
    });
  }
});

test('the body page of each type is the page its stencil sets', { skip: SKIP }, async () => {
  const want = { 'naval-mrls': { w: 420, h: 297, landscape: true }, 'naval-smt-ste': { w: 297, h: 210, landscape: true }, 'naval-tm-4-2': { w: 297, h: 210, landscape: true }, 'naval-ces': { w: 210, h: 297, landscape: false } };
  for (const [id, page] of Object.entries(want)) assert.deepEqual(await lastPage(path.join(NAVAL, FILES[id])), page, `${id}: the stencil's own last section`);
  const t = Object.fromEntries((await w.get('/api/jss/types')).json.types.map((x) => [x.id, x]));
  for (const id of IDS) assert.equal(t[id].bodyKind === undefined, false);
  const p = await create('naval-mrls', 'Page MRLS'); assert.match((await w.get(`${p.U}/jss`)).json.xml, /<chapter number="1" id="c\d+" orientation="a3-landscape">/);
  const q = await create('naval-smt-ste', 'Page SMT'); assert.match((await w.get(`${q.U}/jss`)).json.xml, /orientation="landscape"/);
  const r = await create('naval-ces', 'Page CES'); assert.ok(!/orientation=/.test((await w.get(`${r.U}/jss`)).json.xml), 'CES is portrait');
});

// ── a new project of each type ─────────────────────────────────────────────────────────────────────────

test('a new project of each of the ten types is created in the Naval domain, with a document that passes its own checks', async () => {
  for (const id of IDS) {
    const p = await create(id); const g = (await w.get(`${p.U}/jss`)).json;
    assert.equal(g.docType, id); assert.equal(g.domain, 'naval');
    assert.equal(g.report.errors, 0, `${id}: ${JSON.stringify(errors(g.report))}`);
    assert.match(g.xml, new RegExp(`<jssbook docType="${id}" schemaVersion="1.0">`));
    assert.ok(!/<para>(?!<b>)[^<]/.test(g.xml.replace(/<para>(Summary of items[^<]*)<\/para>/, '')), 'no sample paragraphs are written for the author');
    const pj = JSON.parse(fs.readFileSync(path.join(p.dir, 'project.json'), 'utf8'));
    assert.equal(pj.authoring, 'jss-xml'); assert.equal(pj.jssDocType, id); assert.equal(pj.domain, 'naval'); assert.equal(pj.format, 'jss');
    assert.equal(p.card.format, 'jss'); assert.equal(p.card.domain, 'naval'); assert.equal(p.card.manualType, id);
  }
});

test('the starting document of a table type carries the stencil\'s table, with its head', async () => {
  const mrls = (await w.get(`${(await create('naval-mrls', 'T MRLS')).U}/jss`)).json;
  assert.match(mrls.xml, /<table id="t\d+" widths="12\.9\* 30\.5\*/); assert.match(mrls.xml, /<cell colspan="5">Recommended Nos\./); assert.match(mrls.xml, /<cell rowspan="2">Sr\. No\.<\/cell>/);
  assert.equal(mrls.tableTemplates.length, 1);
  const ces = (await w.get(`${(await create('naval-ces', 'T CES')).U}/jss`)).json;
  assert.deepEqual([...ces.xml.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]), ['Complete Equipment Schedule', 'Details of System', 'Accessories', 'Carried Spares', 'Carried Tools']);
  assert.equal((ces.xml.match(/<table /g) || []).length, 4); assert.deepEqual(ces.tableTemplates.map((t) => t.forSection), ['Details of System', 'Accessories', 'Carried Spares', 'Carried Tools']);
  const v1 = (await w.get(`${(await create('naval-tm-4-1', 'T V1')).U}/jss`)).json;
  assert.match(v1.xml, /<cell>Cct Ref\.<\/cell>/); assert.equal(v1.chapterRule, 'free');
  const smt = (await w.get(`${(await create('naval-smt-ste', 'T SMT')).U}/jss`)).json;
  assert.match(smt.xml, /<title>List of SMT and STE<\/title>/); assert.match(smt.xml, /<para align="center"><b>Figure \/ Diagram of Special Maintenance Tool/);
});

// ── the rules ─────────────────────────────────────────────────────────────────────────────────────────

test('a fixed-chapter type refuses other chapters; the Part IV volumes take the author\'s chapters', async () => {
  const uh = await create('naval-uhb', 'R uhb'); const g = (await w.get(`${uh.U}/jss`)).json;
  assert.ok(rules(await check(uh.U, g.xml.replace('<title>Miscellaneous</title>', '<title>Something else</title>'))).includes('JSS-CHAPTERS'));
  // a Land type's document cannot be saved into a Naval project
  const wrong = await w.put(`${uh.U}/jss`, { xml: g.xml.replace('docType="naval-uhb"', 'docType="uhb"') }); assert.equal(wrong.status, 400); assert.equal(wrong.json.code, 'DOCTYPE_MISMATCH');
  for (const id of ['naval-tm-4-1', 'naval-tm-4-2']) {
    const p = await create(id, `R ${id}`); const d = (await w.get(`${p.U}/jss`)).json;
    const renamed = d.xml.replace('<title>System or Subsystem Name</title>', '<title>Power Output Cabinet (POC)</title>').replace('<title>System or Sub-system Name</title>', '<title>Power Output Cabinet (POC)</title>');
    assert.equal((await check(p.U, renamed)).errors, 0, `${id}: the author names the chapter`);
    const second = renamed.replace('</body>', `  <chapter number="2" id="cx2"${/orientation="(\w+)"/.exec(d.xml) ? ` orientation="${/orientation="([\w-]+)"/.exec(d.xml)[1]}"` : ''}><title>Connection Box (CB)</title></chapter>\n  </body>`);
    assert.equal((await check(p.U, second)).errors, 0, `${id}: a second chapter is allowed`);
    const none = renamed.replace(/<chapter [\s\S]*<\/chapter>/, '');
    assert.ok(rules(await check(p.U, none)).some((r) => r === 'JSS-CHAPTERS' || r === 'JSS-SCHEMA'), `${id}: at least one chapter`);
  }
});

test('the stencil tables are checked: column count and head (parts list, MRLS, Complete Equipment Schedule, SMT / STE)', async () => {
  // parts list: a table of nine columns is refused, a reworded head is a warning
  const v1 = await create('naval-tm-4-1', 'V tm41'); const d = (await w.get(`${v1.U}/jss`)).json;
  const nine = d.xml.replace(/<cell>Remarks<\/cell>/, '').replace(/<cell\/><\/row>/g, '</row>').replace(/<cell>\[10\]<\/cell>/, '');
  const r9 = await check(v1.U, nine); assert.ok(rules(r9).includes('JSS-TABLE-TEMPLATE') || rules(r9).includes('JSS-TABLE-SHAPE'), JSON.stringify(r9.findings));
  const reworded = await check(v1.U, d.xml.replace('<cell>Cct Ref.</cell>', '<cell>Circuit Ref.</cell>'));
  assert.equal(reworded.errors, 0); assert.ok(reworded.findings.some((f) => f.rule === 'JSS-TABLE-HEAD' && f.severity === 'warning'));
  assert.ok(!reworded.findings.some((f) => f.rule === 'JSS-TABLE-CAPTION'), 'the parts list stencil does not caption its tables');
  // MRLS: the project's own quantities in the head are the author's to change, without a warning
  const mr = await create('naval-mrls', 'V mrls'); const m = (await w.get(`${mr.U}/jss`)).json;
  const edited = await check(mr.U, m.xml.replace('Recommended Nos. for 52 Systems for Two Years', 'Recommended Nos. for 40 Systems for Three Years').replace('Unit Repair point (26)', 'Unit Repair point (18)'));
  assert.equal(edited.errors, 0, JSON.stringify(edited.findings)); assert.equal(edited.findings.filter((f) => f.rule === 'JSS-TABLE-HEAD').length, 0);
  assert.ok(rules(await check(mr.U, m.xml.replace(/<row>(<cell\/>){18}<\/row>/, '<row><cell/><cell/></row>'))).includes('JSS-TABLE-SHAPE'), 'a row of the wrong width');
  // CES: each section keeps its table, and its columns
  const ces = await create('naval-ces', 'V ces'); const c = (await w.get(`${ces.U}/jss`)).json;
  assert.ok(rules(await check(ces.U, c.xml.replace('<title>Accessories</title>', '<title>Other</title>'))).includes('JSS-SECTIONS'), 'the sections are the stencil\'s');
  const noTable = c.xml.replace(/(<title>Carried Tools<\/title>)\s*<table[\s\S]*?<\/table>/, '$1');
  assert.ok(rules(await check(ces.U, noTable)).includes('JSS-TABLE-MISSING'));
  const swapped = c.xml.replace(/(<title>Carried Tools<\/title>\s*<table id="[^"]+" widths=")[^"]*"/, '$1' + '1* 1* 1* 1* 1*"');
  assert.ok(rules(await check(ces.U, swapped)).includes('JSS-TABLE-WIDTHS') || rules(await check(ces.U, swapped)).includes('JSS-TABLE-TEMPLATE'));
  // SMT / STE: a table of another shape in a table-list is refused
  const smt = await create('naval-smt-ste', 'V smt'); const s = (await w.get(`${smt.U}/jss`)).json;
  const plain = s.xml.replace(/<table [\s\S]*?<\/table>/, '<table><title>x</title><tbody><row><cell>a</cell><cell>b</cell></row></tbody></table>');
  assert.ok(rules(await check(smt.U, plain)).includes('JSS-TABLE-TEMPLATE'));
});

test('a landscape stencil warns when a chapter is set on another page', async () => {
  const p = await create('naval-mrls', 'W mrls'); const d = (await w.get(`${p.U}/jss`)).json;
  const r = await check(p.U, d.xml.replace(' orientation="a3-landscape"', ''));
  assert.ok(r.findings.some((f) => f.rule === 'JSS-PAGE' && f.severity === 'warning'), JSON.stringify(r.findings));
});

// ── the PDFs ───────────────────────────────────────────────────────────────────────────────────────────────

/** Fill a document a little so the PDF has real body content: a paragraph in the first heading, and a row of text in every table. */
const fill = (xml) => {
  let n = 0;
  let out = xml.replace(/(<(?:chapter|section) [^>]*>\s*<title>[^<]*<\/title>)(?!\s*<(?:para|table|list|figure|pageBreak))/, '$1<para>Content written by the author.</para>');
  out = out.replace(/<row>(<cell\/>)+<\/row>/g, (row) => (n++ === 0 ? row.replace(/<cell\/>/, '<cell>1</cell>').replace(/<cell\/>/, '<cell>Sample</cell>') : row));
  return out;
};

for (const id of IDS) {
  test(`${id}: validates, builds a PDF with its cover, frame and body`, async () => {
    const p = await create(id, `PDF ${id}`); const d = (await w.get(`${p.U}/jss`)).json;
    const saved = await w.put(`${p.U}/jss`, { xml: fill(d.xml), baseHash: d.hash }); assert.equal(saved.status, 200); assert.equal(saved.json.report.errors, 0, JSON.stringify(errors(saved.json.report)));
    const pdf = await build(p.U); const t = await text(pdf); const sizes = pageSizes(pdf);
    assert.ok(sizes.length >= 12, `${id}: ${sizes.length} pages`);
    const type = (await w.get(`/api/jss/types/${id}`)).json;
    for (const line of type.coverTitle) assert.ok(key(t).includes(key(line)), `${id}: cover line "${line}"`);
    assert.match(t, /THE INFORMATION GIVEN IN THIS DOCUMENT IS NOT TO BE PUBLISHED/);
    assert.match(t.replace(/\s+/g, ' '), /L&T Precision Engineering and Systems, LARSEN & TOUBRO LIMITED/);
    assert.ok(t.includes('Content written by the author.') || t.includes('Sample'), `${id}: the body (a paragraph, or a row of the stencil table) is in the PDF`);
    if (id === 'naval-smt-ste') {
      // the figure sheet starts on a page of its own: the <pageBreak/> the author (and the stencil) puts directly in the chapter is honoured
      const pages = t.split('\f'); const at = (re) => pages.findIndex((p) => re.test(p));
      assert.ok(at(/Sample/) >= 0 && at(/Figure \/ Diagram of Special/) > at(/Sample/), 'SMT / STE: the figure sheet is on a page after the table');
    }
    // the pages the stencil sets
    const body = sizes.slice(Math.floor(sizes.length / 2));
    if (id === 'naval-mrls') assert.ok(sizes.some((s) => Math.abs(s.wMm - 420) < 2 && Math.abs(s.hMm - 297) < 2), 'MRLS body is A3 landscape');
    if (id === 'naval-smt-ste' || id === 'naval-tm-4-1' || id === 'naval-tm-4-2') assert.ok(body.some((s) => Math.abs(s.wMm - 297) < 2 && Math.abs(s.hMm - 210) < 2), `${id}: body is A4 landscape`);
    if (!['naval-mrls', 'naval-smt-ste', 'naval-tm-4-1', 'naval-tm-4-2'].includes(id)) assert.ok(sizes.every((s) => Math.abs(s.wMm - 210) < 2 && Math.abs(s.hMm - 297) < 2), `${id}: A4 portrait throughout`);
  });
}

// ── the frame, by stencil family ──────────────────────────────────────────────────────────────────────────────────────────────────

const flat = (s) => s.replace(/\s+/g, ' ');
// The front-matter tables are 12 pt, as the L&T reference sets them (owner's request of 2026-11-26), so a column head such as "Change Notice No." wraps inside its cell and the
// page text interleaves the cells of the row: a head is found when every word of it is on the page.
const hasHead = (t, phrase) => phrase.split(/\s+/).every((word) => t.includes(word));

test('the handbook family (User Handbook, TM Parts I-III, Design Specification) keeps the Record of Changes, Associated Handbooks and Change Notice pages and the chapter divider', async () => {
  for (const id of ['naval-uhb', 'naval-tm-2']) {
    const t = flat(await text(await build((await create(id, `F ${id}`)).U)));
    assert.match(t, /ASSOCIATED HANDBOOKS/); assert.match(t, /CHANGE NOTICE/); assert.match(t, /RECORD OF CHANGES/); assert.ok(hasHead(t, 'Change Notice No.'), `${id}: Record of Changes column head`); assert.ok(hasHead(t, 'Initials with Date'), `${id}: Record of Changes column head`);
    assert.match(t, /LIST OF ABBREVIATIONS/); assert.match(t, /This chapter covers the following topics/, `${id}: the chapter divider`);
    assert.match(t, /FOR FIRST AID IN CASE OF ELECTRIC SHOCK SEE (OVERLEAF|THE FOLLOWING PAGE)/, `${id}: the safety warning keeps its first-aid line`);
    assert.ok(!/Authority with Ref No\. & Date/.test(t) && !/Abbreviations issued/.test(t), `${id}: nothing of the list family's tables`);
    assert.match(t, /L&T Document No\./); assert.match(t, /INBR No\./); assert.match(t, /022 - 6705 4950/, 'the Naval foreword telephone');
  }
});

test('the list stencils (MRLS, Complete Equipment Schedule, List of SMT / STE) have the Amendments table, numbered abbreviations, no first-aid line and no chapter divider', async () => {
  for (const id of ['naval-mrls', 'naval-ces', 'naval-smt-ste']) {
    const f = await build((await create(id, `F ${id}`)).U); const raw = await text(f); const t = flat(raw);
    assert.match(t, /AMENDMENTS/); for (const h of ['Sr. No.', 'Page No.', 'Para Reference', 'Amendment / Required', 'Authority with Ref No. & Date']) assert.ok(hasHead(t, h), `${id}: Amendments column "${h}"`);
    assert.ok(!/Change Notice No\./.test(t) && !/Initials with Date/.test(t), `${id}: not the Change Notice table`);
    assert.match(t, /ABBREVIATIONS/); assert.ok(hasHead(t, 'Abbreviations issued') && /\bFor\b/.test(t) && !/Abbreviations Description/.test(t), `${id}: numbered abbreviations (Sr. No. | Abbreviations issued | For)`);
    assert.ok(!/ASSOCIATED HANDBOOKS/.test(t) && !/CHANGE NOTICE NO\. AND DATE/.test(t), `${id}: no Associated Handbooks or Change Notice page`);
    assert.match(t, /WARNING/); assert.ok(!/SEE (THE FOLLOWING PAGE|OVERLEAF)/.test(t), `${id}: no first-aid line under the WARNING`);
    assert.match(t, /FIRST AID IN CASE OF ELECTRIC SHOCK/, `${id}: the first-aid page itself stays`);
    assert.ok(!/This chapter covers the following topics/.test(t), `${id}: no chapter divider`);
    // the chapter's heading opens the first body page, and that page is the first of the chapter (folio 1-1)
    const pages = raw.split('\f'); const first = pages.findIndex((p) => /Chapter 1/.test(p) && !/CONTENTS/.test(p) && !/LIST OF TABLES/.test(p));
    assert.ok(first >= 0, `${id}: the chapter's first page`); assert.match(flat(pages[first]), /Page \| 1-1/, `${id}: it is page 1-1`);
  }
  // MRLS: that first page is the A3 landscape page, with the section heading and the table on it
  const t = await text(await build((await create('naval-mrls', 'F mrls A3')).U)); const pages = t.split('\f'); const i = pages.findIndex((p) => /Chapter 1/.test(p) && /MECHANICAL SECTION/i.test(p) && /Sr\./.test(p));
  assert.ok(i >= 0, 'MRLS: heading, section and table on the first body page');
});

test('the Part IV volumes keep the handbook frame but have no chapter divider', async () => {
  for (const id of ['naval-tm-4-1', 'naval-tm-4-2']) {
    const raw = await text(await build((await create(id, `F ${id}`)).U)); const t = flat(raw);
    assert.match(t, /RECORD OF CHANGES/); assert.ok(hasHead(t, 'Change Notice No.'), `${id}: Record of Changes column head`); assert.ok(!/This chapter covers the following topics/.test(t), `${id}: no divider`);
    const pages = raw.split('\f'); assert.ok(pages.some((p) => /Chapter 1/.test(p) && /Page \| 1-1/.test(flat(p))), `${id}: the chapter opens on page 1-1`);
  }
});

// ── the ancillary-pages editor (owner's commit eb43711) on the Naval types ───────────────────────────────────────────────────────────

test('ancillary pages of the Naval types: the editor lists the pages the stencil has, and choosing one page does not switch the other choices of the stencil back on', { timeout: 600000 }, async () => {
  // a list stencil brings its own page list (no Associated Handbooks, Change Notice or Cautions; "AMENDMENTS"); Vol 2 has no Abbreviations or List of tables
  const p = await create('naval-mrls', 'MRLS ancillary'); const A = `${p.U}/ancillary`;
  const before = (await w.get(A)).json.pages; const by = (pages) => Object.fromEntries(pages.map((x) => [x.id, x]));
  for (const id of ['associatedHandbooks', 'cautionsNotes', 'changeNotice', 'listOfFigures']) assert.equal(by(before)[id].enabled, false, `${id}: the list stencil has no such page`);
  assert.equal(by(before).recordOfChanges.title, 'AMENDMENTS'); assert.equal(by(before).listOfAbbreviations.title, 'ABBREVIATIONS'); assert.equal(by(before).descriptionOfSymbols.enabled, true);

  const after = await w.put(A, { pages: [{ id: 'demolition', enabled: false }] }); assert.equal(after.status, 200);
  assert.equal(by(after.json.pages).demolition.enabled, false, 'the page that was chosen');
  for (const id of ['associatedHandbooks', 'cautionsNotes', 'changeNotice', 'listOfFigures']) assert.equal(by(after.json.pages)[id].enabled, false, `${id}: still off after choosing another page`);
  assert.equal(by(after.json.pages).recordOfChanges.title, 'AMENDMENTS', "the stencil's heading is kept"); assert.deepEqual(after.json.pages.map((x) => x.id), before.map((x) => x.id), 'the print order is unchanged');
  const flat = (await text(await build(p.U))).replace(/\s+/g, ' ');
  assert.ok(!/ASSOCIATED HANDBOOKS/.test(flat) && !/CHANGE NOTICE/.test(flat), 'the pages the stencil does not have are still not printed'); assert.match(flat, /AMENDMENTS/); assert.ok(!/DEMOLITION OF EQUIPMENT/.test(flat), 'the page that was switched off');

  // a page the stencil does not have is not offered at all (the same list the build uses)
  const v2 = (await w.get(`${(await create('naval-tm-4-2', 'V2 ancillary')).U}/ancillary`)).json.pages.map((x) => x.id);
  assert.ok(!v2.includes('listOfAbbreviations') && !v2.includes('listOfTables'), 'Vol 2 has no Abbreviations or List of tables');
  const ds = (await w.get(`${(await create('naval-uhb', 'UHB ancillary')).U}/ancillary`)).json.pages;
  assert.ok(ds.some((x) => x.id === 'associatedHandbooks' && x.enabled), 'a handbook stencil has the Associated Handbooks page');
});
