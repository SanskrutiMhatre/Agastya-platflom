'use strict';
// The second round of stencil corrections for JSS-authored UHB, MM and ORM (docs/JSS_STENCIL_ANALYSIS.md, docs/JSS_VENDOR_EXCEPTIONS.md):
//   paragraph spacing, Arial Narrow headings, the level-1 body indent, the two-line cover title, the Associated Handbooks headings, the page set by type,
//   the front matter against the stencil page by page, branding through Settings, content order, and merged table cells.
// Where the stencils are present (manual format/JSS0251-stencils, not committed) the expectations are read from the Word files, not copied into this file.
// That every one of these leaves S1000D and the old JSS path unchanged is proved in jss-cover-isolation.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot } = require('./helpers');
const S = require('./helpers-stencil');

const PW = 'Correct-Horse-9!';
const FONTS = path.resolve(__dirname, '..', 'vendor', 'tools', 'fonts');
const haveNarrow = fs.existsSync(path.join(FONTS, 'arialnb.ttf'));
const SKIP_ST = !S.haveStencils && 'the stencils (manual format/JSS0251-stencils) are not in this checkout';
const norm = (s) => s.replace(/>\s+</g, '><').replace(/\s+/g, ' ');
const pdfFile = (buf) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jsc-')), 'x.pdf'); fs.writeFileSync(f, buf); return f; };
const pdftext = (f, a, b) => spawnSync('pdftotext', ['-f', String(a), '-l', String(b), '-layout', f, '-'], { encoding: 'utf8' }).stdout;
const into = (xml, title, inner) => { const t = `<title>${title}</title>`; assert.ok(xml.includes(t), `no heading ${title}`); return xml.replace(t, t + inner); };

const TYPES = {
  uhb: { stencil: 'UHB.docx', first: 'Leading Particulars and General Data', section: 'Purpose' },
  mm: { stencil: 'MM.docx', first: 'Inspection and Maintenance Routine', section: 'Importance of Routine Maintenance' },
  orm: { stencil: 'ORM.docx', first: 'Dismantling and Re-assembly', section: 'Dismantling and Re-assembly of Mechanical Sub-Systems' },
};
const MARK = 'Fixed comparison paragraph.';

let h; let w; let G; const built = {};

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'corrie', fullName: 'Corrie', role: 'author' });
  w = new h.Client('corrie'); await w.post('/api/auth/login', { username: 'corrie', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'corrie', password: PW });
  G = require('./helpers-golden');
  for (const [id, t] of Object.entries(TYPES)) {
    const r = await w.post('/api/projects', { name: `Corr ${id}`, format: 'jss', domain: 'land', manualType: id }); assert.equal(r.status, 201);
    const pid = r.json.project.id; const U = `/api/projects/${pid}`; const g = (await w.get(`${U}/jss`)).json;
    let xml = g.xml.replace('<systemName></systemName>', '<systemName>COMPARISON SYSTEM</systemName>').replace('</bookmeta>', '<codeNo>DT0042_U0100_0007</codeNo><revNo>R2</revNo></bookmeta>');
    xml = into(xml, t.section, `<para>${MARK}</para>`);
    assert.equal((await w.put(`${U}/jss`, { xml })).status, 200);
    const b = await w.post(`${U}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 300));
    const dir = path.join(h.ws, 'projects', pid); const buf = (await w.get(`${U}/publish/pdf`)).buf;
    built[id] = { pid, U, dir, pdf: buf, file: pdfFile(buf), fo: fs.readFileSync(path.join(dir, 'jss-output.fo'), 'utf8'), book: fs.readFileSync(path.join(dir, '_jss-book.xml'), 'utf8') };
  }
});
test.after(async () => { await h.close(); });

// ── 1. paragraph spacing ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('paragraph spacing: the stencils put no space after a paragraph, and neither does a JSS-authored document', { skip: SKIP_ST }, async () => {
  for (const [id, t] of Object.entries(TYPES)) {
    const normal = await S.stencilStyle(path.join(S.STENCILS, t.stencil), 'Normal');
    assert.ok(!normal.spaceAfterTw, `${id}: the stencil's Normal style has no space after (${normal.spaceAfterTw})`);
    const para = await S.stencilStyle(path.join(S.STENCILS, t.stencil), 'L2-Para'); assert.ok(!para.spaceAfterTw, `${id}: nor does L2-Para`);
    const fo = norm(built[id].fo);
    assert.ok(fo.includes(`space-after="0mm" text-align="justify">${MARK}`), `${id}: the body paragraph has 0 space after in the FO`);
    assert.ok(!fo.includes(`space-after="3mm" text-align="justify">${MARK}`), `${id}: and not the engine's old 3mm`);
  }
});

// ── 2. fonts ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('fonts: Arial Narrow is registered like Arial, headings of level one ask for it, and the file stays out of git', () => {
  const xconf = fs.readFileSync(path.resolve(__dirname, '..', 'vendor', 'tools', 'fop.xconf'), 'utf8');
  for (const [file, weight, style] of [['arialn.ttf', 'normal', 'normal'], ['arialnb.ttf', 'normal', 'bold'], ['arialni.ttf', 'italic', 'normal'], ['arialnbi.ttf', 'italic', 'bold']]) {
    assert.match(xconf, new RegExp(`embed-url="${file}">\\s*<font-triplet name="Arial Narrow" style="${weight}" weight="${style}"/>`), file);
  }
  const ignore = fs.readFileSync(path.resolve(__dirname, '..', '..', '.gitignore'), 'utf8'); assert.match(ignore, /backend\/vendor\/tools\/fonts\/arial\*\.ttf/, 'arial*.ttf covers arialn*.ttf: proprietary files are never committed');
  for (const id of Object.keys(TYPES)) {
    const fo = norm(built[id].fo);
    assert.match(fo, /font-weight="bold" font-size="14pt" font-family="Arial Narrow,Arial,Liberation Sans,DejaVu Sans,Symbol,ZapfDingbats"/, `${id}: first-level headings ask for Arial Narrow`);
    const lvl2 = fo.match(/font-weight="bold" font-size="12pt"( font-family="[^"]*")?>[0-9.]+<\/fo:block>/g) ?? [];
    assert.ok(lvl2.every((s) => !/font-family/.test(s)), `${id}: lower levels keep the body font`);
  }
});

test('fonts: the PDF embeds Arial Narrow for the section headings (when the machine has the font files)', { skip: !haveNarrow && 'the Arial Narrow files are not installed on this machine (proprietary, git-ignored)' }, () => {
  for (const id of Object.keys(TYPES)) assert.ok(built[id].pdf.includes('ArialNarrow') || built[id].pdf.includes('Arial-Narrow') || built[id].pdf.includes('ArialNarrow-Bold'), `${id}: Arial Narrow is embedded`);
});

test('fonts: without the Arial Narrow files a build still works and the headings fall back to Arial / Liberation Sans', () => {
  const { fopConf } = require('../vendor/engine/fontconf');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fnt-')); fs.mkdirSync(path.join(dir, 'fonts'));
  for (const f of fs.readdirSync(FONTS)) if (/\.ttf$/i.test(f) && !/^arialn/i.test(f)) fs.copyFileSync(path.join(FONTS, f), path.join(dir, 'fonts', f));
  fs.copyFileSync(path.resolve(__dirname, '..', 'vendor', 'tools', 'fop.xconf'), path.join(dir, 'fop.xconf'));
  const msgs = []; const used = fopConf({ xconf: path.join(dir, 'fop.xconf'), outDir: dir, log: (m) => msgs.push(m) });
  const pruned = fs.readFileSync(used, 'utf8'); assert.ok(!/arialn/i.test(pruned), 'the missing Narrow faces are left out of the configuration FOP reads');
  assert.match(pruned, /Liberation Sans/); assert.ok(msgs.length === 0 || /arialn/i.test(msgs.join(' ')), 'and only they are reported');
});

// ── 3. the level-1 body indent ─────────────────────────────────────────────────────────────────────────────────────────────────

test('indent: text under a first-level heading starts at 7 mm, the heading text at 8 mm (as the stencil styles say)', { timeout: 120000 }, async () => {
  const stYes = S.haveStencils;
  for (const [id, t] of Object.entries(TYPES)) {
    let body = 7; let head = 8;
    if (stYes) {
      const p = await S.stencilStyle(path.join(S.STENCILS, t.stencil), 'L2-Para'); const hd = await S.stencilStyle(path.join(S.STENCILS, t.stencil), 'Heading2');
      body = p.leftMm; head = hd.leftMm; assert.equal(body, 7, `${id}: stencil L2-Para indent`); assert.equal(head, 8, `${id}: stencil Heading 2 text position`);
    }
    // the heading's hanging indent is an explicit value in the FO (the PDF text extractor merges "1.1 PURPOSE" into one run, so it cannot show where the title starts)
    const fo = norm(built[id].fo);
    assert.ok(new RegExp(`start-indent="0mm" provisional-distance-between-starts="${head}mm"`).test(fo), `${id}: first-level heading text ${head} mm from its number`);
    assert.ok(fo.includes(`<fo:block start-indent="${body}mm"><fo:block space-after="0mm" text-align="justify">${MARK}`), `${id}: body text under it at ${body} mm`);
    // and the PDF: the paragraph sits `body` mm in from where the section number starts (the margin)
    const { doc } = await G.openPdf(built[id].file); let found = false;
    for (let n = 1; n <= doc.numPages && !found; n++) {
      const items = (await (await doc.getPage(n)).getTextContent()).items.filter((i) => i.str.trim());
      const para = items.find((i) => i.str.startsWith('Fixed comparison')); if (!para) continue;
      const num = items.find((i) => /^\d+\.1 /.test(i.str.trim()) && Math.hypot(i.transform[2], i.transform[3]) > 13); assert.ok(num, `${id}: the section heading (page ${n})`);
      const gap = ((para.transform[4] - num.transform[4]) / 72) * 25.4;
      assert.ok(Math.abs(gap - body) < 0.7, `${id}: body text is ${gap.toFixed(2)} mm in from the section number's margin, the stencil says ${body}`);
      found = true;
    }
    assert.ok(found, `${id}: found the page`);
  }
});

// ── 4. the cover title ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('cover title: MM and ORM set it on two lines as their stencils do; UHB on one', { skip: SKIP_ST }, async () => {
  const lines = (id) => pdftext(built[id].file, 1, 1).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const [id, expect] of [['uhb', ['USER HANDBOOK']], ['mm', ['TECHNICAL MANUAL', 'PART II MAINTENANCE']], ['orm', ['TECHNICAL MANUAL', 'PART III OVERHAUL AND RECONDITIONING']]]) {
    const items = (await S.stencilFrontMatter(path.join(S.STENCILS, TYPES[id].stencil))).map((i) => i.text);
    for (const l of expect) assert.ok(items.includes(l), `${id}: the stencil cover has the line "${l}"`);
    const ls = lines(id); const at = ls.indexOf(expect[0]); assert.ok(at >= 0, `${id}: "${expect[0]}" is a line of its own on the cover (${ls.slice(0, 12)})`);
    for (let k = 1; k < expect.length; k++) assert.equal(ls[at + k], expect[k], `${id}: then "${expect[k]}"`);
    if (expect.length > 1) assert.ok(norm(built[id].fo).includes(`<fo:block>${expect[0]}</fo:block><fo:block>${expect[1]}</fo:block>`), `${id}: one block per title line in the FO`);
  }
});

// ── 5. the Associated Handbooks headings ───────────────────────────────────────────────────────────────────────────────────────

test('associated handbooks: "Sl. No. / Document Title / Code No." with the stencil\'s empty rows, not "Sr. No. / INBR No."', { skip: SKIP_ST }, async () => {
  for (const [id, t] of Object.entries(TYPES)) {
    const cells = (await S.stencilFrontMatter(path.join(S.STENCILS, t.stencil))).map((i) => i.text);
    for (const head of ['Sl. No.', 'Document Title', 'Code No.']) assert.ok(cells.includes(head), `${id}: the stencil table is headed "${head}"`);
    const text = pdftext(built[id].file, 1, 40);
    assert.match(text, /Sl\. No\.\s+Document Title\s+Code No\./, `${id}: ours is headed the same`);
    assert.ok(!/Sr\. No\./.test(text) && !/INBR No/.test(text), `${id}: no Sr. No. and no INBR No. anywhere in the front matter`);
    const rows = norm(built[id].fo).split('Document Title')[1]?.split('SAFETY WARNING')[0] ?? ''; assert.ok((rows.match(/<fo:table-row/g) ?? []).length >= 11, `${id}: the table has its empty rows`);
  }
});

// ── 6. which pages a stencil has ───────────────────────────────────────────────────────────────────────────────────────────────

const MARKERS = [['titlePage', null], ['proprietary', /RESTRICTION ON USE/i], ['foreword', /^forewor?d$/i], ['recordOfChanges', /^RECORD OF CHANGES$/i], ['associatedHandbooks', /^ASSOCIATED HANDBOOKS$/i], ['safetyWarning', /^SAFETY WARNING$/i],
  ['firstAid', /^FIRST AID IN CASE OF ELECTRIC SHOCK$/i], ['cautionsNotes', /^CAUTIONS\s*\/?\s*NOTES$/i], ['demolition', /^DEMOLITION OF MATERIAL TO PREVENT ENEMY USE$/i], ['changeNotice', /^CHANGE NOTICE$/i],
  ['listOfAbbreviations', /^LIST OF ABBREVIATIONS$/i], ['listOfContents', /^LIST OF CONTENTS$/i], ['listOfFigures', /^LIST OF FIGURES$/i], ['listOfTables', /^LIST OF TABLES$/i], ['systemNamePage', /^SYSTEM NAME$/i], ['descriptionOfSymbols', /^DESCRIPTION OF SYMBOLS$/i]];
const composedPages = (book) => {
  const { CATALOGUE } = require('../vendor/engine/frontMatterPages'); const byFile = new Map(CATALOGUE.filter((p) => p.file).map((p) => [p.file, p.id])); const out = [];
  const fm = /<frontmatter>([\s\S]*?)<\/frontmatter>/.exec(book)[1];
  for (const m of fm.matchAll(/<xi:include href="[^"]*\/([^"/]+)"\/>|<(listOf\w+|systemNamePage)\b/g)) out.push(m[1] ? byFile.get(m[1]) : m[2]);
  return out.filter(Boolean);
};

test('page set: the front-matter pages and their order are the stencil\'s, per type: UHB has a System Name page and no Cautions page; MM and ORM the reverse', () => {
  const want = {
    uhb: ['titlePage', 'proprietary', 'foreword', 'recordOfChanges', 'associatedHandbooks', 'safetyWarning', 'firstAid', 'demolition', 'changeNotice', 'listOfAbbreviations', 'listOfContents', 'listOfFigures', 'listOfTables', 'systemNamePage', 'descriptionOfSymbols'],
    mm: ['titlePage', 'proprietary', 'foreword', 'recordOfChanges', 'associatedHandbooks', 'safetyWarning', 'firstAid', 'cautionsNotes', 'demolition', 'changeNotice', 'listOfAbbreviations', 'listOfContents', 'listOfFigures', 'listOfTables', 'descriptionOfSymbols'],
  };
  want.orm = want.mm;
  for (const id of Object.keys(TYPES)) assert.deepEqual(composedPages(built[id].book).filter((p) => p !== 'titlePageJoint'), want[id], id);
  for (const id of ['mm', 'orm']) { assert.ok(!/Follow all standard/.test(pdftext(built[id].file, 1, 40)), `${id}: the Cautions page is a title, with no invented sample cautions`); assert.ok(!/<systemNamePage|14-system-name-page/.test(built[id].book), `${id}: no System Name page`); }
  assert.ok(/<systemNamePage|14-system-name-page/.test(built.uhb.book) && !/09-cautions-notes/.test(built.uhb.book), 'uhb: System Name page, no Cautions page');
});

test('page set: the order and the set equal the stencil\'s own, read from the Word files', { skip: SKIP_ST }, async () => {
  for (const [id, t] of Object.entries(TYPES)) {
    const items = await S.stencilFrontMatter(path.join(S.STENCILS, t.stencil)); const order = ['titlePage']; let cur = 'titlePage';
    for (const it of items) {
      if (/intentionally left blank/i.test(it.text)) continue;
      let hit = MARKERS.find(([, re]) => re && re.test(it.text)); if (hit && hit[0] === 'systemNamePage' && !['listOfFigures', 'listOfTables', 'listOfContents'].includes(cur)) hit = undefined;   // the cover's own "FOR SYSTEM NAME"
      if (hit && hit[0] !== cur) { cur = hit[0]; if (!order.includes(cur)) order.push(cur); }
    }
    assert.deepEqual(composedPages(built[id].book).filter((p) => p !== 'titlePageJoint'), order, `${id}: our front matter, page by page, in the stencil's order`);
  }
});

// ── 7 and 8. the front matter, page by page, against the stencil ─────────────────────────────────────────────────────────────────

test('front matter: no sentence of the stencil\'s front matter is missing from ours, except the documented ones', { skip: SKIP_ST }, async () => {
  const ALLOWED = [
    /When the upper air passages are thus cleared/,          // first-aid page: our shared static page says "forward", the stencil "forwards" (an engine file S1000D also copies: see the analysis, section 7)
    /No table of figures entries found/,                       // Word's own message in an empty list of figures, not content
  ];
  for (const [id, t] of Object.entries(TYPES)) {
    const items = await S.stencilFrontMatter(path.join(S.STENCILS, t.stencil)); const fo = built[id].fo; const cut = fo.indexOf('This chapter covers the following topics');
    const ours = S.letters(S.stripTags(fo.slice(0, cut > 0 ? cut : undefined)));
    const sentences = items.map((i) => i.text).join(' // ').split(/[.:;!?]|\/\/|\|/).map((s) => s.trim()).filter((s) => S.letters(s).length >= 28);
    const placeholder = /xx|yyyy|<<|system name|month/i; const missing = [];
    for (const s of sentences) { if (placeholder.test(s) || ALLOWED.some((re) => re.test(s))) continue; if (!ours.includes(S.letters(s))) missing.push(s); }
    assert.deepEqual(missing, [], `${id}: stencil sentences not found in the generated front matter`);
    assert.ok(sentences.length > 60, `${id}: a real comparison was made (${sentences.length} sentences)`);
  }
});

test('front matter: the Foreword has no document-number line; the address and the symbols legends follow each stencil', () => {
  for (const id of Object.keys(TYPES)) {
    const fo = built[id].fo; assert.ok(!/L&amp;T Document No/.test(fo) && !/L&T Document No/.test(fo), `${id}: no "L&T Document No." line in the Foreword`);
    const text = S.stripTags(fo).replace(/\s+/g, ' ');
    if (id === 'uhb') { assert.match(text, /G Building, Gate No\. 1,/); assert.match(text, /Denotes additional information\./); assert.match(text, /Denotes possibility of damage to equipment\./); }
    else { assert.match(text, /Defence Engineering Block, Gate No\. 1,/); assert.ok(!/G Building/.test(text)); assert.match(text, /Denote additional information\./); assert.match(text, /Denote possibility of danger to personnel/); }
    assert.match(text, /FOR FIRST AID IN CASE OF ELECTRIC SHOCK SEE OVERLEAF/); assert.ok(!/SEE THE FOLLOWING PAGE/.test(text));
    assert.match(text, /ONLY ON ORDER OF THE COMMANDER\./); assert.ok(!/COMMANDING OFFICER/.test(text), `${id}: the demolition page says what the stencil says`);
  }
});

// ── branding stays in Settings ─────────────────────────────────────────────────────────────────────────────────────────────────

test('branding: the emblem and the publishers still come from Settings; a second publisher turns on the jointly-prepared cover', { timeout: 300000 }, async () => {
  const b = built.uhb; assert.match(b.book, /<emblem src="[^"]*artwork\/emblem\.png"\/>/, 'the project has no Media/Satya.png (the house template\'s emblem), so the stencil\'s emblem is printed; a project\'s own file wins (jss-authoring: default artwork)');
  assert.equal((b.book.match(/<publisher>/g) ?? []).length, 1); assert.ok(!composedPages(b.book).includes('titlePageJoint'));
  const cfg = (await w.get(`${b.U}/settings`)).json; const project = { ...cfg.project, publishers: [{ name: 'L&T Defence,', addressLines: ['LARSEN & TOUBRO LIMITED'], logo: 'Media/JACKSON.png' }, { name: 'Partner Ltd', addressLines: ['Pune'], logo: 'Media/partner.png' }] };
  assert.equal((await w.put(`${b.U}/settings`, { project })).status, 200);
  const after = await w.post(`${b.U}/publish`, {}); assert.equal(after.status, 200, JSON.stringify(after.json).slice(0, 200));
  const book = fs.readFileSync(path.join(b.dir, '_jss-book.xml'), 'utf8'); assert.equal((book.match(/<publisher>/g) ?? []).length, 2, 'two publishers from Settings'); assert.match(book, /Partner Ltd/);
  assert.ok(composedPages(book).includes('titlePageJoint'), 'and the joint cover is printed again');
  assert.equal(JSON.parse(fs.readFileSync(path.join(b.dir, 'project.json'), 'utf8')).authoring, 'jss-xml', 'saving Settings keeps the project a JSS document project');
  await w.put(`${b.U}/settings`, { project: cfg.project });
});

// ── 10. order ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('content order: a file that lists content after a sub-section is an error everywhere it matters, and the PDF prints own content first', { timeout: 300000 }, async () => {
  const b = built.uhb; const g = (await w.get(`${b.U}/jss`)).json;
  const late = g.xml.replace(/(<section id="[^"]+"><title>Purpose<\/title>)([\s\S]*?)(<\/section>)/, (_m, open, inner, close) => `${open}${inner}<section id="zsub"><title>Zeta sub-section</title></section><para>After the sub-section</para>${close}`);
  assert.notEqual(late, g.xml);
  const put = await w.put(`${b.U}/jss`, { xml: late, baseHash: g.hash }); assert.equal(put.status, 200, 'saved as a draft');
  const rules = put.json.report.findings.filter((f) => f.severity === 'error').map((f) => f.rule); assert.ok(rules.includes('JSS-ORDER'), JSON.stringify(rules)); assert.ok(rules.includes('JSS-SCHEMA'), 'the schema refuses it too');
  assert.match(put.json.report.findings.find((f) => f.rule === 'JSS-ORDER').message, /own content comes first and its sub-sections after it/);
  const refused = await w.post(`${b.U}/publish`, {}); assert.equal(refused.status, 422); assert.ok(refused.json.findings.some((f) => f.rule === 'JSS-ORDER'));
  // the same content in the order the pipeline prints it: valid, and the PDF puts it ahead of the sub-section
  const ok = late.replace('<section id="zsub"><title>Zeta sub-section</title></section><para>After the sub-section</para>', '<para>After the sub-section</para><section id="zsub"><title>Zeta sub-section</title></section>');
  assert.equal((await w.put(`${b.U}/jss`, { xml: ok })).json.report.errors, 0);
  assert.equal((await w.post(`${b.U}/publish`, {})).status, 200);
  const text = pdftext(pdfFile((await w.get(`${b.U}/publish/pdf`)).buf), 1, 80).replace(/\s+/g, ' ');
  assert.ok(text.indexOf('After the sub-section') > 0 && text.indexOf('After the sub-section') < text.lastIndexOf('Zeta sub-section'), 'own content before the sub-section in the PDF (the contents page also lists the sub-section, so the last mention is the heading)');
  await w.put(`${b.U}/jss`, { xml: g.xml });
});

// ── 9. merged cells ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('merged cells: a table with merged cells is valid and builds; a grid that does not fit is refused with the reason', { timeout: 300000 }, async () => {
  const b = built.mm; const g = (await w.get(`${b.U}/jss`)).json;
  const table = (rows, extra = '') => `<table id="tm"${extra}><title>Merged</title><thead><row><cell colspan="2">Head merged</cell><cell>C</cell></row></thead><tbody>${rows}</tbody></table>`;
  const good = table('<row><cell rowspan="2">Tall cell</cell><cell>b1</cell><cell>c1</cell></row><row><cell>b2</cell><cell>c2</cell></row><row><cell colspan="3">Wide cell</cell></row>');
  const withTable = (t) => into(g.xml, 'Importance of Routine Maintenance', t);
  const put = await w.put(`${b.U}/jss`, { xml: withTable(good) }); assert.equal(put.json.report.errors, 0, JSON.stringify(put.json.report.findings.filter((f) => f.severity === 'error')));
  assert.equal((await w.post(`${b.U}/publish`, {})).status, 200);
  const text = pdftext(pdfFile((await w.get(`${b.U}/publish/pdf`)).buf), 1, 80);
  for (const s of ['Head merged', 'Tall cell', 'Wide cell']) assert.equal((text.match(new RegExp(s, 'g')) ?? []).length, 1, `"${s}" is printed once`);
  assert.match(norm(fs.readFileSync(path.join(b.dir, 'jss-output.fo'), 'utf8')), /number-columns-spanned="2"[^>]*>|number-rows-spanned="2"/, 'the spans reach the FO');
  const bad = {
    'a short row': table('<row><cell>a</cell><cell>b</cell></row><row><cell>a</cell><cell>b</cell><cell>c</cell></row>'),
    'a row span that runs past the table': table('<row><cell rowspan="5">tall</cell><cell>b</cell><cell>c</cell></row>'),
    'cells that overlap': table('<row><cell rowspan="2">tall</cell><cell>b</cell><cell>c</cell></row><row><cell>x</cell><cell>y</cell><cell>z</cell></row>'),
    'a header whose merged cell does not fit': good.replace('<cell colspan="2">Head merged</cell><cell>C</cell>', '<cell colspan="3">Head merged</cell><cell>C</cell>'),
  };
  for (const [what, t] of Object.entries(bad)) {
    const r = (await w.put(`${b.U}/jss`, { xml: withTable(t) })).json.report; assert.ok(r.findings.some((f) => f.rule === 'JSS-TABLE-SHAPE' && f.severity === 'error'), `${what}: refused (${JSON.stringify(r.findings.map((f) => f.rule))})`);
  }
  assert.equal((await w.post(`${b.U}/publish`, {})).status, 422, 'and no PDF is built from a broken grid');
  await w.put(`${b.U}/jss`, { xml: g.xml });
});

// ── the template ships with a revision ───────────────────────────────────────────────────────────────────────────────────────────

test('templates: a workspace copy of the stencil template with an older revision is replaced (the old one kept); templates without a revision are never touched', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-')); const tdir = path.join(ws, 'templates'); fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 'jss-stencil.house.json'), JSON.stringify({ id: 'jss-stencil', revision: 1, marker: 'old' }));
  fs.writeFileSync(path.join(tdir, 'default.house.json'), JSON.stringify({ id: 'default', marker: 'organisations own edit' }));
  const r = spawnSync(process.execPath, ['-e', "require('../dist/context')"], { cwd: __dirname, env: { ...process.env, AGASTYA_WORKSPACE_DIR: ws }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const now = JSON.parse(fs.readFileSync(path.join(tdir, 'jss-stencil.house.json'), 'utf8')); assert.ok(now.revision >= 2 && !now.marker, 'replaced by the shipped revision');
  assert.equal(JSON.parse(fs.readFileSync(path.join(tdir, 'jss-stencil.house.json.rev1.bak'), 'utf8')).marker, 'old', 'the old copy is kept');
  assert.equal(JSON.parse(fs.readFileSync(path.join(tdir, 'default.house.json'), 'utf8')).marker, 'organisations own edit', 'a template that declares no revision is left alone');
  const again = spawnSync(process.execPath, ['-e', "require('../dist/context')"], { cwd: __dirname, env: { ...process.env, AGASTYA_WORKSPACE_DIR: ws }, encoding: 'utf8' }); assert.equal(again.status, 0);
  assert.deepEqual(fs.readdirSync(tdir).filter((f) => /\.bak$/.test(f)), ['jss-stencil.house.json.rev1.bak'], 'a second start changes nothing');
});
