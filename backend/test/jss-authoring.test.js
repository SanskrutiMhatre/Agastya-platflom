'use strict';
// JSS authoring, first slice: the shared frame and the chapter manuals UHB, MM and ORM, end to end.
//
//   XML (jss-1.0.xsd) -> validation (schema + the stencil's rules) -> composed book (frame from Settings + the body as written)
//     -> jsstofo -> XSL-FO -> FOP -> PDF
//
// Where a stencil is present (manual format/JSS0251-stencils, not committed: it is the customer's), the registry and the PDF are checked
// against the stencil's own Word XML - its headings, its page setup, its styles - rather than against numbers copied into this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const STENCILS = path.resolve(__dirname, '..', '..', 'manual format', 'JSS0251-stencils');
const haveStencils = fs.existsSync(path.join(STENCILS, 'UHB.docx'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let h; let w; let G; const made = {};

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'jessa', fullName: 'Jessa', role: 'author' });
  w = new h.Client('jessa'); await w.post('/api/auth/login', { username: 'jessa', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'jessa', password: PW });
  G = require('./helpers-golden');
});
test.after(async () => { await h.close(); });

const create = async (type, name) => {
  const r = await w.post('/api/projects', { name: name ?? `JSS ${type} ${Object.keys(made).length}`, format: 'jss', domain: 'land', manualType: type });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.project.id; made[id] = type;
  return { id, U: `/api/projects/${id}`, dir: path.join(h.ws, 'projects', id), card: r.json.project };
};
const pdfOf = (buf) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jss-')), 'x.pdf'); fs.writeFileSync(f, buf); return f; };
const text = (f) => spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout;
const build = async (U) => { const b = await w.post(`${U}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 500)); return pdfOf((await w.get(`${U}/publish/pdf`)).buf); };
/** Put `inner` right after the heading `title` (the first one), inside its section. */
const into = (xml, title, inner) => { const t = `<title>${title}</title>`; assert.ok(xml.includes(t), `no heading ${title}`); return xml.replace(t, t + inner); };

// ── stencil reading (Word XML) ──────────────────────────────────────────────────────────────────────────────────────────────────
const { ZipFileReader } = require('../dist/services/zipio');
function docxPart(file, name) {
  const z = ZipFileReader.open(file);
  try {
    const e = z.entries.find((x) => x.name === name);
    if (!e) throw new Error(`${name} not in ${file}`);
    return new Promise((res, rej) => { const parts = []; z.open(e).on('data', (d) => parts.push(d)).on('end', () => res(Buffer.concat(parts).toString('utf8'))).on('error', rej); }).finally(() => z.close());
  } catch (e) { z.close(); throw e; }
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const runsText = (p) => decode([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')).replace(/\s+/g, ' ').trim();
/** [{ level, title }] of the stencil's Heading 1..5 paragraphs, in order. */
async function stencilHeadings(file) {
  const doc = await docxPart(file, 'word/document.xml'); const styles = await docxPart(file, 'word/styles.xml');
  const names = {}; for (const m of styles.matchAll(/<w:style [^>]*w:styleId="([^"]+)"[^>]*>\s*<w:name w:val="([^"]+)"/g)) names[m[1]] = m[2];
  const out = [];
  for (const m of doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const sid = /<w:pStyle w:val="([^"]+)"/.exec(m[0])?.[1]; const mm = /^heading ([1-5])$/.exec(names[sid] ?? '');
    const t = runsText(m[0]); if (mm && t) out.push({ level: Number(mm[1]), title: t });
  }
  return out;
}
/** The page setup the body of the stencil uses: the most common portrait, decimal-numbered section, in mm. */
async function stencilBodyPage(file) {
  const doc = await docxPart(file, 'word/document.xml'); const mm = (v) => Math.round(Number(v) / 56.7 * 10) / 10;
  const tally = new Map();
  for (const s of doc.matchAll(/<w:sectPr[ >][\s\S]*?<\/w:sectPr>/g)) {
    const sz = /<w:pgSz ([^>]*)>/.exec(s[0])?.[1] ?? ''; if (/orient="landscape"/.test(sz)) continue;
    const num = /<w:pgNumType ([^>]*)>/.exec(s[0])?.[1] ?? ''; if (/fmt="(lowerRoman|upperRoman)"/.test(num)) continue;
    const g = (a, tag) => Number(new RegExp(`w:${a}="(\\d+)"`).exec(new RegExp(`<w:${tag} ([^>]*)>`).exec(s[0])?.[1] ?? '')?.[1]);
    const k = JSON.stringify({ top: mm(g('top', 'pgMar')), bottom: mm(g('bottom', 'pgMar')), inner: mm(g('left', 'pgMar')), outer: mm(g('right', 'pgMar')), header: mm(g('header', 'pgMar')), footer: mm(g('footer', 'pgMar')), w: mm(g('w', 'pgSz')), h: mm(g('h', 'pgSz')) });
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return JSON.parse([...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}
async function stencilHeadingSizes(file) {
  const styles = await docxPart(file, 'word/styles.xml'); const out = {};
  for (const m of styles.matchAll(/<w:style [^>]*w:styleId="(Heading[1-3]|Normal)"[^>]*>([\s\S]*?)<\/w:style>/g)) { const sz = /<w:sz w:val="(\d+)"/.exec(m[2]); if (sz) out[m[1]] = Number(sz[1]) / 2; }
  return out;
}
const TYPO = { maintenace: 'maintenance', miscellanoeous: 'miscellaneous', 'handling and packing': 'handling and packing' };
const norm = (t) => { let s = t.toLowerCase().replace(/\s*\/\s*/g, '/').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim(); for (const [a, b] of Object.entries(TYPO)) s = s.replace(a, b); return s; };

// ── the catalogue ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the catalogue lists the 14 stencil document types and the four the stencil set has no file for; every one is ready and builds a valid starting document', async () => {
  const t = (await w.get('/api/jss/types')).json.types;
  assert.deepEqual(t.map((x) => x.id), ['uhb', 'mm', 'orm', 'uhb2', 'tm-pi', 'tm-pi-vol-2', 'ds', 'tote-cs', 'prs', 'mrls', 'rotable', 'vol-1-pl', 'vol-2-illustrations', 'ispl', 'ispl-wrt-jss', 'ces', 'fis', 'bis']);
  assert.deepEqual(t.filter((x) => !x.ready).map((x) => x.id), [], 'every type of the catalogue is ready');
  assert.ok(t.find((x) => x.id === 'uhb2'), 'UHB2 stays its own type');
  const { JSS_TYPES } = require('../dist/services/jss/registry');
  assert.deepEqual(JSS_TYPES.filter((x) => x.source === 'derived').map((x) => x.id), ['tm-pi-vol-2', 'ces', 'fis', 'bis'], 'the four without a stencil file say so');
  const land = (await w.get('/api/formats')).json.formats.find((f) => f.id === 'jss').domains.find((d) => d.id === 'land').manualTypes;
  assert.deepEqual(land.map((x) => [x.id, x.ready]), t.map((x) => [x.id, x.ready]), 'the wizard offers exactly what the registry has');
  const unknown = await w.post('/api/projects', { name: 'No such', format: 'jss', domain: 'land', manualType: 'no-such-type' });
  assert.ok(unknown.status >= 400 && unknown.status < 500, `an unknown type is refused (${unknown.status})`);
  for (const x of t) {
    const r = await w.post('/api/projects', { name: `Catalogue ${x.id}`, format: 'jss', domain: 'land', manualType: x.id }); assert.equal(r.status, 201, `${x.id}: ${JSON.stringify(r.json).slice(0, 200)}`);
    const g = (await w.get(`/api/projects/${r.json.project.id}/jss`)).json; assert.equal(g.report.errors, 0, `${x.id}: ${JSON.stringify(g.report.findings.slice(0, 2))}`);
    assert.deepEqual(g.chapters, x.chapters, `${x.id}: the document has the chapters of its stencil`);
  }
});

test('the registry agrees with the stencils: same chapters in the same order, and every stencil section is in the starting document', { skip: !haveStencils && 'the stencils (manual format/JSS0251-stencils) are not in this checkout' }, async () => {
  for (const [id, file] of [['uhb', 'UHB.docx'], ['mm', 'MM.docx'], ['orm', 'ORM.docx']]) {
    const heads = await stencilHeadings(path.join(STENCILS, file));
    const type = (await w.get(`/api/jss/types/${id}`)).json;
    const stencilChapters = heads.filter((x) => x.level === 1).map((x) => norm(x.title));
    assert.deepEqual(type.chapters.map((c) => norm(c.title)), stencilChapters, `${id}: chapters`);
    // every level-2 heading of the stencil is a section of that chapter in the skeleton
    const p = await create(id, `Skeleton ${id}`); const xml = (await w.get(p.U + '/jss')).json.xml;
    const have = new Set([...xml.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => norm(decode(m[1]))));
    const missing = heads.filter((x) => x.level <= 2).map((x) => norm(x.title)).filter((t) => !have.has(t));
    assert.deepEqual(missing, [], `${id}: stencil headings missing from the starting document`);
  }
});

// ── the schema and the rules ────────────────────────────────────────────────────────────────────────────────────────────────────

test('a new document of each ready type is valid, has the stencil chapters, and carries no invented content', async () => {
  for (const id of ['uhb', 'mm', 'orm']) {
    const p = await create(id); const g = (await w.get(`${p.U}/jss`)).json;
    assert.equal(g.docType, id); assert.equal(g.report.errors, 0, JSON.stringify(g.report.findings.filter((f) => f.severity === 'error')));
    assert.match(g.xml, /<jssbook docType="[a-z]+" schemaVersion="1.0">/);
    assert.ok(!/<para>/.test(g.xml), 'no sample paragraphs are written for the author');
    assert.equal((g.xml.match(/<chapter /g) || []).length, g.chapters.length);
    const pj = JSON.parse(fs.readFileSync(path.join(p.dir, 'project.json'), 'utf8'));
    assert.equal(pj.authoring, 'jss-xml'); assert.equal(pj.jssDocType, id); assert.equal(pj.templateRef, 'jss-stencil');
  }
});

test('the schema and the stencil rules catch what they should, each naming the place', async () => {
  const p = await create('uhb'); const { xml } = (await w.get(`${p.U}/jss`)).json;
  const check = async (x) => (await w.post(`${p.U}/jss/validate`, { xml: x })).json;
  const rules = (r) => r.findings.filter((f) => f.severity === 'error').map((f) => f.rule);

  assert.ok(rules(await check(xml.replace('docType="uhb"', 'docType="zzz"'))).includes('JSS-SCHEMA'), 'unknown document type');
  assert.ok(rules(await check(xml.replace('<title>Purpose</title>', ''))).includes('JSS-SCHEMA'), 'a section needs a title');
  assert.ok(rules(await check(into(xml, 'Purpose', '<para>see <xref to="nowhere"/></para>'))).includes('JSS-XREF'), 'a cross-reference must point at an id in the document');
  assert.ok(rules(await check(into(xml, 'Purpose', '<para><blink>x</blink></para>'))).includes('JSS-SCHEMA'), 'an element the model does not have');
  assert.ok(rules(await check(into(xml, 'Purpose', '<list type="greek"><item>a</item></list>'))).includes('JSS-SCHEMA'), 'a list type the model does not have');
  const firstId = /<chapter number="1" id="([^"]+)"/.exec(xml)[1];
  const dup = await check(xml.replace(/(<chapter number="2" id=")[^"]+"/, `$1${firstId}"`));
  assert.ok(rules(dup).includes('JSS-SCHEMA') && dup.findings.some((f) => /ID/.test(f.message)), 'a duplicate id is an error');

  const reordered = xml.replace(/(<chapter number="1" id="[^"]+">)/, '$1<!--c-->').replace('Leading Particulars and General Data', 'Something else');
  const r = await check(reordered); assert.ok(rules(r).includes('JSS-CHAPTERS'), 'the stencil fixes the chapters'); assert.match(r.findings.find((f) => f.rule === 'JSS-CHAPTERS').message, /missing: Leading Particulars and General Data/);
  assert.ok(rules(await check(xml.replace('<chapter number="2"', '<chapter number="9"'))).includes('JSS-CHAPTER-NUMBER'));

  const ragged = into(xml, 'Purpose', '<table><title>T</title><tbody><row><cell>a</cell><cell>b</cell></row><row><cell>c</cell></row></tbody></table>');
  assert.ok(rules(await check(ragged)).includes('JSS-TABLE-SHAPE'), 'rows of different widths');
  assert.ok(rules(await check(into(xml, 'Purpose', '<table widths="20mm 1* 1*"><title>T</title><tbody><row><cell>a</cell><cell>b</cell></row></tbody></table>'))).includes('JSS-TABLE-WIDTHS'));
  assert.ok(rules(await check(into(xml, 'Purpose', '<figure><title>F</title><graphic src="Media/not-there.png"/></figure>'))).includes('JSS-GRAPHIC-MISSING'), 'a picture that is not in the project');
  const deep = into(xml, 'Purpose', '<section><title>a</title><section><title>b</title><section><title>c</title><section><title>d</title><section><title>e</title><para>x</para></section></section></section></section></section>');
  assert.ok(rules(await check(deep)).includes('JSS-DEPTH'), 'deeper than the stencil defines');
  const warn = await check(into(xml, 'Purpose', '<table><tbody><row><cell>a</cell></row></tbody></table><figure><graphic src="x"/></figure>'));
  assert.ok(warn.findings.some((f) => f.rule === 'JSS-TABLE-CAPTION' && f.severity === 'warning'), 'an uncaptioned table is a warning, not an error');
  const notready = xml.replace('docType="uhb"', 'docType="ispl"');
  assert.ok(rules(await check(notready)).length > 0);
});

test('saving: malformed XML is refused; a draft that breaks the rules is kept and reported; a stale save is refused; the type cannot be switched', async () => {
  const p = await create('mm'); const g = (await w.get(`${p.U}/jss`)).json;
  const bad = await w.put(`${p.U}/jss`, { xml: g.xml.replace('</body>', '') });
  assert.equal(bad.status, 400); assert.equal(bad.json.code, 'MALFORMED_XML');
  assert.equal(fs.readFileSync(path.join(p.dir, 'publication.xml'), 'utf8'), g.xml, 'nothing was stored');

  const draft = g.xml.replace('<title>Safety Instructions</title>', '');
  const d = await w.put(`${p.U}/jss`, { xml: draft, baseHash: g.hash });
  assert.equal(d.status, 200); assert.ok(d.json.report.errors > 0 && !d.json.report.valid, 'saved, with its errors reported');
  assert.equal(fs.readFileSync(path.join(p.dir, 'publication.xml'), 'utf8'), draft);

  const stale = await w.put(`${p.U}/jss`, { xml: g.xml, baseHash: g.hash });
  assert.equal(stale.status, 409); assert.equal(stale.json.code, 'STALE_DOCUMENT');
  const wrongType = await w.put(`${p.U}/jss`, { xml: g.xml.replace('docType="mm"', 'docType="uhb"') });
  assert.equal(wrongType.status, 400); assert.equal(wrongType.json.code, 'DOCTYPE_MISMATCH');
  assert.equal((await w.put(`${p.U}/jss`, { notxml: 1 })).status, 400);
});

test('the publication gate: a document with errors is not built, with the findings; fixing it builds', async () => {
  const p = await create('orm'); const g = (await w.get(`${p.U}/jss`)).json;
  await w.put(`${p.U}/jss`, { xml: g.xml.replace('<chapter number="2"', '<chapter number="7"') });
  const refused = await w.post(`${p.U}/publish`, {});
  assert.equal(refused.status, 422, JSON.stringify(refused.json).slice(0, 300)); assert.equal(refused.json.code, 'VALIDATION_FAILED');
  assert.ok(refused.json.findings.some((f) => f.rule === 'JSS-CHAPTER-NUMBER'));
  const rel = await w.post(`${p.U}/release`, { note: 'x' }); assert.equal(rel.status, 422, 'a release is held to the same check');
  await w.put(`${p.U}/jss`, { xml: g.xml });
  const ok = await w.post(`${p.U}/publish`, {}); assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 300));
});

test('S1000D is untouched: an S1000D project is not a JSS document project, and a JSS project has no S1000D publication module', async () => {
  const s = await w.post('/api/projects', { name: 'Plain S1000D', format: 's1000d' });
  assert.equal(s.status, 201);
  assert.equal((await w.get(`/api/projects/${s.json.project.id}/jss`)).status, 404);
  const p = await create('uhb');
  assert.match(fs.readFileSync(path.join(p.dir, 'publication.xml'), 'utf8'), /<jssbook /);
  assert.ok(!fs.existsSync(path.join(p.dir, 'csdb')) || fs.readdirSync(path.join(p.dir, 'csdb')).length === 0, 'no data modules');
});

// ── the PDF, against the stencil ────────────────────────────────────────────────────────────────────────────────────────────────

const RICH = (xml, dir) => {
  fs.mkdirSync(path.join(dir, 'Media'), { recursive: true }); fs.writeFileSync(path.join(dir, 'Media', 'plate.png'), PNG);
  let x = xml;
  x = x.replace('<systemName></systemName>', '<systemName>AKASH SYSTEM</systemName>').replace('</bookmeta>', '<codeNo>DT0042_U0100_0007</codeNo><revNo>R2</revNo></bookmeta>');
  x = into(x, 'Purpose', '<para>The system gives <b>early warning</b> of low-level threats and passes <i>tracks</i> to the battery. See <xref to="tspec"/>.</para><para>Second paragraph of the purpose.</para>');
  x = into(x, 'Features', '<para>The main features are:</para><list type="alpha"><item>Search radar range 60 km</item><item>Tracking of 8 targets<list type="roman"><item>simultaneously</item><item>in all weather</item></list></item><item>Operation from -20 to +55 degrees</item></list><list type="bullet"><item>Mobile</item></list>');
  x = into(x, 'Technical Specifications', '<table id="tspec" widths="20mm 1* 2*"><title>Technical Specifications</title><thead><row><cell>Sl. No.</cell><cell>Attribute</cell><cell>Specification</cell></row></thead><tbody><row><cell>1</cell><cell>Weight</cell><cell>2400 kg</cell></row><row><cell>2</cell><cell>Power</cell><cell>24 V DC</cell></row></tbody></table>');
  x = into(x, 'Environmental Specifications', '<figure id="plate"><title>Equipment plate</title><graphic src="Media/plate.png" width="40mm"/></figure><note><para>Keep the plate clean.</para></note><warning><para>High voltage inside.</para></warning><caution><para>Do not open the unit.</para></caution>');
  return x;
};

test('UHB end to end: what the author writes is what the PDF prints, in the stencil\'s page setup and type sizes', { timeout: 600000 }, async () => {
  const p = await create('uhb', 'UHB e2e');
  const g = (await w.get(`${p.U}/jss`)).json;
  const authored = RICH(g.xml, p.dir);
  const saved = await w.put(`${p.U}/jss`, { xml: authored });
  assert.equal(saved.status, 200); assert.equal(saved.json.report.errors, 0, JSON.stringify(saved.json.report.findings.filter((f) => f.severity === 'error')));

  const f = await build(p.U); const t = text(f); const flat = t.replace(/\s+/g, ' ');
  if (process.env.JSS_DUMP) fs.writeFileSync(process.env.JSS_DUMP, t);                     // debugging aid: the text of the PDF
  // the XML is the source of truth: the PDF was built from the file as saved, and the composed book carries the frame and the body unchanged
  const composed = fs.readFileSync(path.join(p.dir, '_jss-book.xml'), 'utf8');
  const unstamped = composed.replace(/ intrinsic-[wh]="[^"]*"/g, '');                    // the build only adds the pictures' pixel sizes
  assert.ok(unstamped.includes(authored.slice(authored.indexOf('<body'), authored.lastIndexOf('</body>') + 7)), 'the body goes to the pipeline exactly as written');
  assert.match(composed, /<frontmatter>[\s\S]*<listOfContents\/>[\s\S]*<\/frontmatter>/);

  // the body, as written
  assert.match(flat, /Chapter 1 Leading Particulars and General Data/);
  assert.match(flat, /1\.1 PURPOSE/); assert.match(flat, /1\.2 FEATURES/); assert.match(flat, /1\.3 SYSTEM SPECIFICATIONS/);
  assert.match(flat, /The system gives early warning of low-level threats/);
  assert.match(flat, /\(a\) Search radar range 60 km/); assert.match(flat, /\(b\) Tracking of 8 targets/); assert.match(flat, /\(i\) simultaneously/); assert.match(flat, /\(c\) Operation from/);
  assert.match(flat, /Table 1-1: Technical Specifications/); assert.match(flat, /See Table 1-1\./, "the cross-reference resolves to the table's number");
  for (const cell of ['Sl. No.', 'Attribute', 'Specification', 'Weight', '2400 kg', '24 V DC']) assert.ok(flat.includes(cell), `table cell ${cell}`);
  assert.match(flat, /Figure 1-1: Equipment plate/);
  assert.match(flat, /NOTE/); assert.match(flat, /WARNING/); assert.match(flat, /CAUTION/); assert.match(flat, /keep the plate clean/i);
  assert.match(flat, /End of Chapter/);
  for (const c of g.chapters) assert.match(flat.toUpperCase(), new RegExp(c.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 30)), `chapter ${c}`);

  // the cover is the stencil's single cover, with the author's identity
  assert.match(flat, /Code No\.: DT0042_U0100_0007/); assert.match(flat, /Rev No\.: R2/); assert.match(flat, /USER HANDBOOK/); assert.match(flat, /AKASH SYSTEM/);
  assert.ok(!/<<Publication No>>/.test(flat), 'no jointly-published cover for a single publisher');

  // the frame: the stencil's front-matter pages, in the stencil's order
  const order = ['FOREWORD', 'RECORD OF CHANGES', 'ASSOCIATED HANDBOOKS', 'SAFETY WARNING', 'FIRST AID IN CASE OF ELECTRIC SHOCK', 'DEMOLITION OF MATERIAL TO PREVENT ENEMY USE', 'CHANGE NOTICE', 'LIST OF ABBREVIATIONS', 'LIST OF CONTENTS', 'LIST OF FIGURES', 'LIST OF TABLES', 'DESCRIPTION OF SYMBOLS'];
  const at = order.map((o) => flat.indexOf(o)); assert.ok(at.every((i) => i >= 0), `front matter missing: ${order.filter((_, i) => at[i] < 0)}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'front matter is in the stencil order');
  assert.ok(flat.indexOf('Chapter 1 Leading') > at[at.length - 1], 'the body follows the frame');

  // page setup and type, measured in the PDF
  const { doc } = await G.openPdf(f);
  assert.ok(doc.numPages > 30);
  const geo = { recto: [], verso: [] }; const sizes = new Set(); const headerTop = []; let bodyStarted = false;
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n); const vp = pg.getViewport({ scale: 1 }); const items = (await pg.getTextContent()).items.filter((i) => i.str.trim());
    assert.ok(Math.abs(vp.width / 72 * 25.4 - 210) < 0.5 && Math.abs(vp.height / 72 * 25.4 - 297) < 0.5, `page ${n} is A4 portrait`);
    const sz = (i) => Math.round(Math.hypot(i.transform[2], i.transform[3]) * 10) / 10;
    if (!bodyStarted && items.some((i) => sz(i) >= 20 && sz(i) <= 22 && /Leading Particulars/.test(i.str))) bodyStarted = true;     // chapter titles are 20-22 pt (21), not the stencil's 18
    if (!bodyStarted) continue;                                             // the frame has its own page setups (the stencil's front matter sections)
    const body = items.filter((i) => sz(i) >= 11 && sz(i) < 30 && !/intentionally left blank/.test(i.str)); if (!body.length) continue;
    const left = Math.min(...body.map((i) => i.transform[4])) / 72 * 25.4;
    (n % 2 ? geo.recto : geo.verso).push(left); for (const i of body) sizes.add(sz(i));
    const head = items.filter((i) => sz(i) === 9); if (head.length) headerTop.push((vp.height - Math.max(...head.map((i) => i.transform[5] + 9))) / 72 * 25.4);
  }
  if (haveStencils) {
    const page = await stencilBodyPage(path.join(STENCILS, 'UHB.docx'));
    const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(1)} mm in the PDF, ${b} mm in the stencil`);
    assert.ok(geo.recto.length >= 3 && geo.verso.length >= 3, 'body pages of both hands were measured');
    for (const l of geo.recto) near(l, page.inner, 0.6, 'recto left margin = the stencil inner margin');
    for (const l of geo.verso) near(l, page.outer, 0.6, 'verso left margin = the stencil outer margin');
    for (const y of headerTop) near(y, page.header, 1.2, 'running head distance from the top');
    const sz = await stencilHeadingSizes(path.join(STENCILS, 'UHB.docx'));
    for (const want of [21 /* the chapter title: 20-22 pt by decision, the stencil's Heading 1 is 18 */, sz.Heading2, sz.Normal]) assert.ok(sizes.has(want), `the PDF sets type at ${want} pt as the stencil does (saw ${[...sizes]})`);
    assert.equal(page.w, 210); assert.ok(Math.abs(page.h - 297) < 0.3);
  }
});

test('MM and ORM build from their own stencil chapters, with their own cover title', { timeout: 600000 }, async () => {
  for (const [id, cover, firstChapter] of [['mm', /TECHNICAL MANUAL PART II MAINTENANCE|TECHNICAL MANUAL\s+PART II MAINTENANCE/, 'Inspection and Maintenance Routine'], ['orm', /TECHNICAL MANUAL PART III OVERHAUL AND RECONDITIONING|TECHNICAL MANUAL\s+PART III OVERHAUL AND RECONDITIONING/, 'Dismantling and Re-assembly']]) {
    const p = await create(id, `${id} e2e`); const g = (await w.get(`${p.U}/jss`)).json;
    const body = into(g.xml, firstChapter, '<para>Authored paragraph for ' + id + '.</para>');
    assert.equal((await w.put(`${p.U}/jss`, { xml: body })).status, 200);
    const flat = text(await build(p.U)).replace(/\s+/g, ' ');
    assert.match(flat, cover, `${id} cover title`);
    assert.ok(flat.includes(firstChapter), `${id}: the first chapter title is printed`);
    assert.match(flat, /Chapter 1\b/); assert.match(flat, new RegExp(`Authored paragraph for ${id}\\.`));
    for (const c of g.chapters) assert.ok(flat.toUpperCase().includes(c.toUpperCase().slice(0, 25)), `${id}: chapter "${c}" is in the book`);
  }
});

test('six heading levels, a notice holding nested lists, and full-width notices and tables at the deepest level; every blank page keeps its running head and foot', { timeout: 600000 }, async () => {
  const p = await create('uhb', 'UHB deep');
  const g = (await w.get(`${p.U}/jss`)).json;
  assert.equal(g.maxDepth, 6, 'the stencil allows six heading levels (the chapter is level 1)');
  const deep = '<section id="l3"><title>Level three</title><para>Text at level three.</para><section id="l4"><title>Level four</title><section id="l5"><title>Level five</title>'
    + '<section id="l6"><title>Level six</title><para>Deepest text.</para>'
    + '<warning><para>DEEPMARK danger</para><list type="bullet"><item>first<list type="alpha"><item>nested a</item><item>nested b</item></list></item><item>second</item></list></warning>'
    + '<table id="tdeep"><title>Deep table</title><thead><row><cell>H1</cell><cell align="right">H2</cell></row></thead><tbody><row><cell>DEEPCELL</cell><cell align="center">x</cell></row></tbody></table>'
    + '</section></section></section></section>';
  const xml = into(g.xml, 'Purpose', '<para>Opening.</para>').replace('<title>Purpose</title><para>Opening.</para>', '<title>Purpose</title><para>Opening.</para>' + deep);
  const saved = await w.put(`${p.U}/jss`, { xml });
  assert.equal(saved.status, 200); assert.equal(saved.json.report.errors, 0, JSON.stringify(saved.json.report.findings.filter((f) => f.severity === 'error')));
  const tooDeep = xml.replace('<para>Deepest text.</para>', '<para>Deepest text.</para><section><title>Level seven</title></section>');
  const refused = await w.put(`${p.U}/jss`, { xml: tooDeep });
  assert.ok(JSON.stringify(refused.json).includes('JSS-DEPTH') || refused.json.report?.errors > 0, 'a seventh level is still refused');
  assert.equal((await w.put(`${p.U}/jss`, { xml })).status, 200);

  const f = await build(p.U); const { doc } = await G.openPdf(f);
  const mm = (v) => v / 72 * 25.4;
  let sawNotice = false; let sawTable = false; const blanks = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n); const vp = pg.getViewport({ scale: 1 }); const items = (await pg.getTextContent()).items.filter((i) => i.str.trim());
    const size = (i) => Math.round(Math.hypot(i.transform[2], i.transform[3]) * 10) / 10;
    const mark = items.find((i) => /DEEPMARK/.test(i.str)); const cell = items.find((i) => /DEEPCELL/.test(i.str));
    // body text starts at the page's inner/outer margin (25 / 15 mm); a notice or table that kept its heading's indent would start 28 mm further in
    if (mark) { sawNotice = true; const band = items.find((i) => /WARNING/.test(i.str)); assert.ok(band, 'the notice band is printed'); assert.ok(mm(band.transform[4]) < 33, `the notice spans the full width (band at ${mm(band.transform[4]).toFixed(1)} mm)`); }
    if (cell) { sawTable = true; assert.ok(mm(cell.transform[4]) < 33, `the table spans the full width (first cell at ${mm(cell.transform[4]).toFixed(1)} mm)`); }
    if (items.some((i) => /intentionally left blank/.test(i.str))) blanks.push({ n, head: items.filter((i) => size(i) === 9).length, y: items.filter((i) => size(i) === 9).map((i) => Math.round(mm(vp.height - i.transform[5]))) });
  }
  assert.ok(sawNotice && sawTable, 'the deep notice and table were found in the PDF');
  const flat = text(f).replace(/\s+/g, ' ');
  assert.match(flat, /first/i); assert.match(flat, /nested a/i); assert.match(flat, /nested b/i); assert.match(flat, /second/i);      // a notice prints in capitals
  if (process.env.JSS_DUMP_BLANKS) console.log(JSON.stringify(blanks));
  assert.ok(blanks.length > 0, 'the document has blank pad pages');
  for (const b of blanks) assert.ok(b.head >= 2, `blank page ${b.n} carries its running head and foot (9 pt lines found: ${b.head})`);
});

test('ancillary pages: choose which are printed, edit one by hand, keep the edit through a rebuild, and reset it', { timeout: 600000 }, async () => {
  const p = await create('uhb', 'UHB ancillary'); const A = `${p.U}/ancillary`;
  const list = (await w.get(A)); assert.equal(list.status, 200);
  const ids = list.json.pages.map((x) => x.id);
  assert.deepEqual(ids.slice(0, 3), ['titlePage', 'proprietary', 'foreword'], 'in print order');
  assert.ok(!ids.includes('titlePageJoint'), 'the jointly-prepared cover exists only for more than one publisher');
  assert.ok(!ids.includes('cautionsNotes'), 'the UHB stencil has no Cautions / Notes page');
  assert.ok(ids.includes('systemNamePage') && ids.includes('listOfContents') && ids.includes('demolition'));
  const byId = Object.fromEntries(list.json.pages.map((x) => [x.id, x]));
  assert.equal(byId.titlePage.required, true); assert.equal(byId.listOfContents.file, null, 'a list made from the document has no file to edit');
  assert.ok(byId.foreword.file && !byId.foreword.edited && byId.foreword.enabled);

  // which pages are printed
  assert.equal((await w.put(A, { pages: [{ id: 'titlePage', enabled: false }] })).status, 400, 'the title page cannot be switched off');
  assert.equal((await w.put(A, { pages: [{ id: 'nonsense', enabled: false }] })).status, 400);
  const off = await w.put(A, { pages: [{ id: 'demolition', enabled: false }, { id: 'firstAid', enabled: false }, { id: 'foreword', title: 'PREFACE' }] });
  assert.equal(off.status, 200); assert.deepEqual(off.json.pages.map((x) => x.id), ids, 'choosing a page does not change the order the pages print in');
  assert.equal(off.json.pages.find((x) => x.id === 'demolition').enabled, false); assert.equal(off.json.pages.find((x) => x.id === 'foreword').customTitle, 'PREFACE');
  let flat = text(await build(p.U)).replace(/\s+/g, ' ');
  assert.ok(!/DEMOLITION OF MATERIAL/.test(flat) && !/FIRST AID IN CASE/.test(flat.replace(/FOR FIRST AID IN CASE OF ELECTRIC SHOCK SEE OVERLEAF/, '')), 'a page that is switched off is not printed');
  assert.match(flat, /PREFACE/); assert.match(flat, /RECORD OF CHANGES/, 'the others still are');
  assert.ok(flat.indexOf('USER HANDBOOK FOR') < flat.indexOf('PREFACE'), 'the title page still comes first');

  // edit one page by hand
  const page = (await w.get(`${A}/foreword`)).json; assert.match(page.xml, /<foreword>/);
  const edited = page.xml.replace('Every care has been taken', 'ANCILLARYEDIT care has been taken');
  assert.equal((await w.put(`${A}/foreword`, { xml: edited })).status, 200);
  assert.equal((await w.get(A)).json.pages.find((x) => x.id === 'foreword').edited, true);
  flat = text(await build(p.U)).replace(/\s+/g, ' '); assert.match(flat, /ANCILLARYEDIT care has been taken/, 'the edit is printed');
  // a change to Settings must not overwrite a page that was edited by hand
  const s = (await w.get(`${p.U}/settings`)).json.project; s.frontMatter = { ...(s.frontMatter ?? {}), foreword: { ...(s.frontMatter?.foreword ?? {}), text: 'SETTINGSTEXT replaced' } };
  assert.equal((await w.put(`${p.U}/settings`, { project: s })).status, 200);
  flat = text(await build(p.U)).replace(/\s+/g, ' '); assert.match(flat, /ANCILLARYEDIT/, 'the hand edit survives a rebuild'); assert.ok(!/SETTINGSTEXT/.test(flat));
  // reset gives the page back to Settings
  const reset = await w.post(`${A}/foreword/reset`, {}); assert.equal(reset.status, 200); assert.equal(reset.json.page.edited, false); assert.match(reset.json.xml, /SETTINGSTEXT replaced/);
  flat = text(await build(p.U)).replace(/\s+/g, ' '); assert.match(flat, /SETTINGSTEXT/); assert.ok(!/ANCILLARYEDIT/.test(flat));

  // what a page may not be
  assert.equal((await w.put(`${A}/foreword`, { xml: '<foreword><para>unclosed</foreword>' })).status, 400, 'malformed XML is refused');
  assert.equal((await w.put(`${A}/foreword`, { xml: '<other><para>x</para></other>' })).json.code, 'BAD_ROOT');
  assert.equal((await w.put(`${A}/foreword`, { xml: '<!DOCTYPE foreword [<!ENTITY x "y">]><foreword/>' })).status, 400, 'no DOCTYPE or entities');
  assert.equal((await w.get(`${A}/listOfContents`)).json.code, 'NOT_EDITABLE');
  assert.equal((await w.get(`${A}/nope`)).status, 404);
});

test('default artwork: a project with no emblem, logo or first-aid picture of its own prints the stencil\'s; its own files win', { timeout: 600000 }, async () => {
  const images = (f) => spawnSync('pdfimages', ['-list', f], { encoding: 'utf8' }).stdout.split('\n').slice(2).filter((l) => l.trim()).length;
  const fo = (p) => fs.readFileSync(path.join(p.dir, 'jss-output.fo'), 'utf8');

  const bare = await create('uhb', 'UHB artwork bare');
  const pdf = await build(bare.U); const f1 = fo(bare);
  if (process.env.JSS_SAVE_PDF) fs.copyFileSync(pdf, process.env.JSS_SAVE_PDF);                        // debugging aid: keep the PDF to look at
  const srcs = [...f1.matchAll(/src="([^"]*)"/g)].map((m) => m[1]);
  assert.match(f1, /artwork\/emblem\.png/, `the emblem (pictures in the FO: ${srcs.join(' | ')})`); assert.match(f1, /artwork\/lt-logo\.png/, 'the Larsen & Toubro logo'); assert.match(f1, /artwork\/first-aid\.png/, 'the first-aid figures');
  assert.ok(!fs.existsSync(path.join(bare.dir, 'Media', 'default-emblem.png')) && !fs.readdirSync(path.join(bare.dir)).includes('artwork'), 'nothing is copied into the project');
  const bareImages = images(pdf); assert.ok(bareImages >= 3, `the PDF carries the pictures (${bareImages})`);

  const own = await create('uhb', 'UHB artwork own');
  fs.mkdirSync(path.join(own.dir, 'Media'), { recursive: true });
  for (const n of ['Satya.png', 'JACKSON.png', 'stamp1.png']) fs.writeFileSync(path.join(own.dir, 'Media', n), PNG);          // the names the UHB template uses
  await build(own.U); const f2 = fo(own);
  assert.ok(!/artwork\/(emblem|lt-logo|first-aid)\.png/.test(f2), 'the project\'s own files are used, not the defaults');
  assert.match(f2, /Media\/Satya\.png/); assert.match(f2, /Media\/stamp1\.png/);
});

test('default artwork reaches every JSS book: one built from S1000D modules too; the direct S1000D engine is left alone', { timeout: 600000 }, async () => {
  const dm = fs.readdirSync(h.SAMPLES).find((f) => /-040A-D_/.test(f));
  const make = async (body) => {
    const r = await w.post('/api/projects', body); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 200)); const id = r.json.project.id;
    assert.equal((await w.post(`/api/projects/${id}/dms`, { file: dm, xml: h.sample(dm) })).status, 201);
    const U = `/api/projects/${id}`; const pdf = await build(U);
    return { fo: fs.readFileSync(path.join(h.ws, 'projects', id, 'jss-output.fo'), 'utf8'), pdf };
  };
  const viaJss = await make({ name: 'Legacy JSS art', profile: 'uhb' });
  assert.match(viaJss.fo, /artwork\/emblem\.png/, 'a JSS book built from S1000D modules prints the stencil emblem');
  assert.match(viaJss.fo, /artwork\/lt-logo\.png/, 'and the Larsen & Toubro logo');
  const direct = await make({ name: 'Direct S1000D art', pipeline: 's1000dtofo', profile: 'xignal-s1000d' });
  assert.ok(!/artwork\/(emblem|lt-logo|first-aid)\.png/.test(direct.fo), 'the direct S1000D engine never gets the JSS artwork');
});
