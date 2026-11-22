'use strict';
// The "xignal-jss" profile: the page furniture of the Xignal JSS-0251 reference (RDR-1671Y-00061-00.pdf), measured in points on A4.
//
//   running head   two lines of Arial 10 pt on the outer edge, baselines 787.9 and 775.9, over a 1.13 pt rule at y 768.8
//   running foot   a 1.13 pt rule at y 40.3, then "Page | n" as a box on the outer edge: its dividing line at x 513.6 (recto) / 81.6 (verso)
//                  from y 17 to 39.7
//   blank page     "This page is intentionally left blank." Arial Bold 12 pt, baseline 431.9, centred
//
// The reference prints no classification on its running pages and neither does the profile.
//
// The body (reference pp. 35-50): each chapter opens on a divider - "Chapter N" and the title, 18 pt bold, centred - followed by a blank verso so
// the text opens on a right-hand page; a data module has no heading of its own; first-level headings are bold upper case and unnumbered;
// second-level ones are "(a)" lettered. A chapter that Xignal wrapped in a "Chapter" folder is lifted out of it (unwrapChapterFolders).
//
// The default profile (uhb) must not move: the same project built on it has none of this.
//
// Also: front-matter modules that the front-matter import has read into Settings are left out of the body (dropConsumedModules), so a
// publication that still lists them does not print every one of those pages twice.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Stroked two-point lines of a page, in page coordinates, with their width. */
async function strokes(doc, OPS, n) {
  const ol = await (await doc.getPage(n)).getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = []; let lw = 1; let pending = null; const out = [];
  for (let i = 0; i < ol.fnArray.length; i++) {
    const op = ol.fnArray[i]; const a = ol.argsArray[i];
    if (op === OPS.save) stack.push(ctm.slice());
    else if (op === OPS.restore) ctm = stack.pop() || ctm;
    else if (op === OPS.transform) ctm = mul(ctm, a);
    else if (op === OPS.setLineWidth) lw = a[0];
    else if (op === OPS.constructPath) {
      const [ops, data] = a; let k = 0; const pts = [];
      for (const o of ops) {
        if (o === OPS.moveTo || o === OPS.lineTo) { pts.push(ap(ctm, data[k], data[k + 1])); k += 2; }
        else if (o === OPS.rectangle) k += 4;
        else if (o === OPS.curveTo) k += 6; else if (o === OPS.curveTo2 || o === OPS.curveTo3) k += 4;
      }
      pending = { pts, lw };
    } else if (op === OPS.stroke && pending) { if (pending.pts.length === 2) out.push({ lw: pending.lw, a: pending.pts[0], b: pending.pts[1] }); pending = null; }
    else if (op === OPS.fill || op === OPS.eoFill || op === OPS.fillStroke) pending = null;
  }
  return out;
}
const horizontal = (ls, y, tol = 0.3) => ls.filter((l) => Math.abs(l.a[1] - y) <= tol && Math.abs(l.b[1] - y) <= tol);
const vertical = (ls, x, tol = 0.3) => ls.filter((l) => Math.abs(l.a[0] - x) <= tol && Math.abs(l.b[0] - x) <= tol);

async function texts(doc, n) {
  const tc = await (await doc.getPage(n)).getTextContent();
  return tc.items.filter((i) => i.str.trim() && Math.abs(i.transform[1]) < 0.01).map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, size: Math.abs(i.transform[0]) }));
}

// helpers-golden loads ../dist, which reads the workspace from the environment once: it is required after boot() has pointed the app at a throwaway one.
let h; let g; let author; let tmp; const pdfs = {};

async function build(name, profile) {
  const created = await author.post('/api/projects', { name, profile });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const pid = created.json.project.id;
  const pub = await author.post(`/api/projects/${pid}/publish`);
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  const pdf = await author.get(`/api/projects/${pid}/publish/pdf`);
  const file = path.join(tmp, `${profile}.pdf`);
  fs.writeFileSync(file, pdf.buf);
  pdfs[profile] = await g.openPdf(file);
}

test.before(async () => {
  h = await boot();
  g = require('./helpers-golden');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-jssx-'));
  const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  const made = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda Writer', role: 'author' });
  author = new h.Client('wanda');
  await author.post('/api/auth/login', { username: 'wanda', password: made.json.tempPassword });
  await author.post('/api/auth/onboarding', { username: 'wanda', password: PW });
  await build('Xignal look', 'xignal-jss');
  await build('Stencil look', 'uhb');
});
test.after(async () => {
  for (const p of Object.values(pdfs)) await p.doc.destroy().catch(() => undefined);
  await h.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the profile is offered, on its own house template, with the handbook outline', async () => {
  const r = await author.get('/api/document-types');
  const p = r.json.types.find((x) => x.id === 'xignal-jss');
  assert.ok(p, JSON.stringify(r.json).slice(0, 300));
  assert.equal(p.chapters, 7);
  const created = (await author.get('/api/projects')).json.projects.find((x) => x.name === 'Xignal look');
  assert.equal(created.templateRef, 'xignal-jss', 'a project made on it starts on its house template');
});

test('recto: the head rule, the foot rule and the folio box are where the reference draws them', async () => {
  const { doc, OPS } = pdfs['xignal-jss'];
  const ls = await strokes(doc, OPS, 5);
  const head = horizontal(ls, 768.8).filter((l) => l.lw > 1.0);
  assert.equal(head.length, 1, 'one 1.13 pt rule at y 768.8');
  near(Math.min(head[0].a[0], head[0].b[0]), 70.9, 0.3, 'head rule starts at the inner margin');
  near(Math.max(head[0].a[0], head[0].b[0]), 552.8, 0.3, 'head rule ends at the outer margin');
  const foot = horizontal(ls, 40.3).filter((l) => l.lw > 1.0);
  assert.equal(foot.length, 1, 'one 1.13 pt rule at y 40.3');
  const bar = vertical(ls, 513.6).filter((l) => l.lw > 1.0);
  assert.ok(bar.length >= 1, 'the dividing line of the folio box at x 513.6');
  near(Math.min(...bar.flatMap((l) => [l.a[1], l.b[1]])), 17, 0.3, 'the box ends at y 17');
  near(Math.max(...bar.flatMap((l) => [l.a[1], l.b[1]])), 39.7, 0.3, 'the box starts at y 39.7');
});

test('recto: the two head lines sit on 787.9 and 775.9 against the outer margin', async () => {
  const t = await texts(pdfs['xignal-jss'].doc, 5);
  const first = t.filter((i) => Math.abs(i.y - 787.9) <= 0.3);
  const second = t.filter((i) => Math.abs(i.y - 775.9) <= 0.3);
  assert.ok(first.length >= 1 && second.length >= 1, JSON.stringify(t.filter((i) => i.y > 760)));
  for (const i of [...first, ...second]) near(i.size, 10, 0.05, `size of "${i.s}"`);
  near(Math.max(...second.map((i) => i.x + i.w)), 552.8, 0.6, 'the system name ends at the outer margin');
  const foot = t.filter((i) => i.y < 40);
  assert.ok(foot.some((i) => /^Page$/.test(i.s)), 'the foot says "Page"');
  assert.ok(!foot.some((i) => /\|/.test(i.s)), 'and has no "|" character: the divider is a drawn line');
});

test('verso: the box moves to the outer (left) edge and the text hugs the 15 mm margin', async () => {
  const { doc, OPS } = pdfs['xignal-jss'];
  const ls = await strokes(doc, OPS, 6);
  assert.ok(vertical(ls, 81.7, 0.4).some((l) => l.lw > 1.0), 'the dividing line at x 81.6');
  const head = horizontal(ls, 768.8).filter((l) => l.lw > 1.0)[0];
  assert.ok(head, 'head rule');
  near(Math.min(head.a[0], head.b[0]), 42.5, 0.3, 'head rule starts at the outer margin');
  near(Math.max(head.a[0], head.b[0]), 524.4, 0.3, 'head rule ends at the inner margin');
  const t = await texts(pdfs['xignal-jss'].doc, 6);
  near(Math.min(...t.filter((i) => Math.abs(i.y - 775.9) <= 0.3).map((i) => i.x)), 42.5, 0.6, 'the system name starts at the outer margin');
});

test('blank pages: Arial Bold 12 pt, baseline 431.9, centred on the verso body (x 283.45) - inside the prelims and after a cover page', async () => {
  const doc = pdfs['xignal-jss'].doc;
  for (const n of [6, 2]) {
    const legend = (await texts(doc, n)).find((i) => /intentionally left blank/.test(i.s));
    assert.ok(legend, `page ${n} carries the legend`);
    near(legend.y, 431.9, 0.3, `page ${n} baseline`);
    near(legend.size, 12, 0.05, `page ${n} size`);
    near(legend.x + legend.w / 2, 283.45, 0.6, `page ${n} centre: the reference centres every blank page on the same line`);
  }
});

test('the default profile has none of it: the stencil furniture stays as it was', async () => {
  const { doc, OPS } = pdfs.uhb;
  for (const n of [5, 7]) {                                       // the pages that carry a foot: the blank ones between them have none in this profile
    const ls = await strokes(doc, OPS, n);
    assert.equal(ls.filter((l) => l.lw > 1.0).length, 0, `page ${n}: no 1.13 pt furniture rules`);
    const foot = (await texts(doc, n)).filter((i) => i.y < 40).map((i) => i.s).join(' ');
    assert.match(foot, /Page \|/, `page ${n}: "Page | n" as text`);
  }
});

// ── leaving consumed front-matter modules out of the body ──────────────────

test('dropConsumedModules: includes of consumed modules go; entries they leave empty go with them; an author\'s empty entry stays', () => {
  const { dropConsumedModules } = require('../dist/services/jssdm/prune');
  const inc = (f) => `<xi:include href="csdb/${f}"/>`;
  const pm = [
    '<content>',
    '<pmEntry><pmEntryTitle>Book</pmEntryTitle>',
    '  <pmEntry><pmEntryTitle>Front matter</pmEntryTitle>',
    `    <pmEntry><pmEntryTitle>Title</pmEntryTitle>${inc('DMC-A-001.xml')}</pmEntry>`,
    `    <pmEntry><pmEntryTitle>Foreword</pmEntryTitle>${inc('DMC-A-023.xml')}</pmEntry>`,
    '  </pmEntry>',
    '  <pmEntry><pmEntryTitle>Chapter 1</pmEntryTitle>',
    `    ${inc('DMC-B-001.xml')}`,
    `    ${inc('DMC-A-005.xml')}`,
    '  </pmEntry>',
    '  <pmEntry><pmEntryTitle>To be written</pmEntryTitle></pmEntry>',
    '  <pmEntry/>',
    '</pmEntry>',
    '</content>',
  ].join('\n');
  const r = dropConsumedModules(pm, ['DMC-A-001.xml', 'DMC-A-023.xml', 'dmc-a-005.xml']);
  assert.equal(r.removed, 3);
  assert.equal(r.entriesDropped, 3, 'Title, Foreword and then Front matter itself');
  assert.ok(!/DMC-A-001|DMC-A-023|DMC-A-005|Front matter|Foreword/.test(r.text), r.text);
  assert.ok(r.text.includes('DMC-B-001.xml'), 'a module that was not read stays');
  assert.ok(r.text.includes('Chapter 1'), 'its entry stays, now holding one module');
  assert.ok(r.text.includes('To be written'), 'an entry the author left empty is not ours to remove');
  assert.ok(r.text.includes('<pmEntry/>'));
  assert.ok(!r.text.includes('agastya-consumed'), 'no marker is left behind');
});

test('dropConsumedModules: nothing consumed, nothing matched - the text is returned untouched', () => {
  const { dropConsumedModules } = require('../dist/services/jssdm/prune');
  const pm = '<content><pmEntry><pmEntryTitle>X</pmEntryTitle><xi:include href="csdb/DMC-K.xml"/></pmEntry></content>';
  assert.deepEqual(dropConsumedModules(pm, []), { text: pm, removed: 0, entriesDropped: 0 });
  assert.deepEqual(dropConsumedModules(pm, ['DMC-OTHER.xml']), { text: pm, removed: 0, entriesDropped: 0 });
  const withFallback = '<content><pmEntry><xi:include href="csdb/DMC-K.xml"><xi:fallback/></xi:include></pmEntry></content>';
  const r = dropConsumedModules(withFallback, ['DMC-K.xml']);
  assert.equal(r.removed, 1, 'a guarded include (with its empty fallback) is recognised too');
  assert.equal(r.entriesDropped, 1);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// unwrapChapterFolders: Xignal's wrapper entry and "Chapter" folder
// ---------------------------------------------------------------------------------------------------------------------------------
const WRAPPED = (inner) => `<pm><content>\n<pmEntry><pmEntryTitle>Xignal JSS-0251 Test Publication</pmEntryTitle>\n${inner}\n</pmEntry>\n</content></pm>`;
const FRONT = '<pmEntry><pmEntryTitle>Front matter</pmEntryTitle><xi:include href="csdb/DMC-FM.xml"/></pmEntry>';

test('unwrapChapterFolders: the Chapter folder\'s entries become the chapters, numbered by their folder names', () => {
  const { unwrapChapterFolders } = require('../dist/services/jssdm/unwrap');
  const pm = WRAPPED(`${FRONT}\n<pmEntry><pmEntryTitle>Chapter</pmEntryTitle>\n` +
    '<pmEntry><pmEntryTitle>1</pmEntryTitle><xi:include href="csdb/DMC-A.xml"/><xi:include href="csdb/DMC-B.xml"/></pmEntry>\n' +
    '<pmEntry><pmEntryTitle>3</pmEntryTitle><xi:include href="csdb/DMC-C.xml"/></pmEntry>\n</pmEntry>');
  const r = unwrapChapterFolders(pm);
  assert.equal(r.unwrapped, true);
  assert.equal(r.chapters, 3, 'the front-matter folder stays as an entry of its own (prune.ts drops it when it was consumed); the two chapters join it');
  assert.equal(r.numbered, false, 'a Front matter folder is not numbered, so the numbers are not taken from the names');
  assert.ok(!r.text.includes('Xignal JSS-0251 Test Publication'), 'the wrapper is gone');
  assert.ok(!/<pmEntryTitle>Chapter<\/pmEntryTitle>/.test(r.text), 'so is the Chapter folder');
});

test('unwrapChapterFolders: every chapter named by a number takes it as its own number and loses the bare number as a title', () => {
  const { unwrapChapterFolders } = require('../dist/services/jssdm/unwrap');
  const pm = WRAPPED('<pmEntry><pmEntryTitle>Chapter</pmEntryTitle>\n' +
    '<pmEntry><pmEntryTitle>1</pmEntryTitle><xi:include href="csdb/DMC-A.xml"/></pmEntry>\n' +
    '<pmEntry><pmEntryTitle>03</pmEntryTitle><xi:include href="csdb/DMC-C.xml"/></pmEntry>\n</pmEntry>');
  const r = unwrapChapterFolders(pm);
  assert.deepEqual([r.unwrapped, r.chapters, r.numbered], [true, 2, true]);
  assert.ok(/<pmEntry agastyaChapterNumber="1">/.test(r.text));
  assert.ok(/<pmEntry agastyaChapterNumber="3">/.test(r.text), '"03" is chapter 3');
  assert.ok(!/<pmEntryTitle>0?[13]<\/pmEntryTitle>/.test(r.text), 'a bare number is not a title: the first module names the chapter');
  assert.ok(r.text.includes('csdb/DMC-A.xml') && r.text.includes('csdb/DMC-C.xml'), 'the modules are kept');
});

test('unwrapChapterFolders: the same number twice, or a name that is not a number, leaves the chapters to number themselves by position', () => {
  const { unwrapChapterFolders } = require('../dist/services/jssdm/unwrap');
  const twice = unwrapChapterFolders(WRAPPED('<pmEntry><pmEntryTitle>Chapter</pmEntryTitle>' +
    '<pmEntry><pmEntryTitle>2</pmEntryTitle><xi:include href="csdb/A.xml"/></pmEntry><pmEntry><pmEntryTitle>2</pmEntryTitle><xi:include href="csdb/B.xml"/></pmEntry></pmEntry>'));
  assert.deepEqual([twice.unwrapped, twice.numbered], [true, false]);
  assert.ok(!twice.text.includes('agastyaChapterNumber'));
  const named = unwrapChapterFolders(WRAPPED('<pmEntry><pmEntryTitle>Chapters</pmEntryTitle>' +
    '<pmEntry><pmEntryTitle>Leading particulars</pmEntryTitle><xi:include href="csdb/A.xml"/></pmEntry></pmEntry>'));
  assert.deepEqual([named.unwrapped, named.chapters, named.numbered], [true, 1, false]);
  assert.ok(named.text.includes('<pmEntryTitle>Leading particulars</pmEntryTitle>'), 'a real title is kept');
});

test('unwrapChapterFolders: any other shape is returned byte for byte', () => {
  const { unwrapChapterFolders } = require('../dist/services/jssdm/unwrap');
  const same = (pm, why) => assert.deepEqual(unwrapChapterFolders(pm), { text: pm, unwrapped: false, chapters: 0, numbered: false }, why);
  // several top-level entries: already a list of chapters
  same('<pm><content><pmEntry><pmEntryTitle>One</pmEntryTitle></pmEntry><pmEntry><pmEntryTitle>Two</pmEntryTitle></pmEntry></content></pm>', 'two top-level chapters');
  // one top-level entry that holds modules of its own: it is a chapter
  same(WRAPPED('<xi:include href="csdb/A.xml"/><pmEntry><pmEntryTitle>Chapter</pmEntryTitle><pmEntry><pmEntryTitle>1</pmEntryTitle></pmEntry></pmEntry>'), 'the wrapper has its own module');
  // no Chapter folder
  same(WRAPPED('<pmEntry><pmEntryTitle>Section A</pmEntryTitle><xi:include href="csdb/A.xml"/></pmEntry>'), 'no Chapter folder');
  // two Chapter folders: ambiguous
  same(WRAPPED('<pmEntry><pmEntryTitle>Chapter</pmEntryTitle><pmEntry><pmEntryTitle>1</pmEntryTitle></pmEntry></pmEntry><pmEntry><pmEntryTitle>Chapter</pmEntryTitle><pmEntry><pmEntryTitle>2</pmEntryTitle></pmEntry></pmEntry>'), 'two Chapter folders');
  // a Chapter folder with a module of its own
  same(WRAPPED('<pmEntry><pmEntryTitle>Chapter</pmEntryTitle><xi:include href="csdb/A.xml"/><pmEntry><pmEntryTitle>1</pmEntryTitle></pmEntry></pmEntry>'), 'the Chapter folder has its own module');
  // an empty Chapter folder
  same(WRAPPED('<pmEntry><pmEntryTitle>Chapter</pmEntryTitle></pmEntry>'), 'nothing to lift');
  // broken nesting, no content element, no text at all
  same('<pm><content><pmEntry><pmEntryTitle>X</pmEntryTitle></content></pm>', 'unbalanced');
  same('<pm/>', 'no content');
  same('', 'empty');
});

test('unwrapChapterFolders: a ">" inside an attribute value, comments, and self-closing entries do not confuse it', () => {
  const { unwrapChapterFolders } = require('../dist/services/jssdm/unwrap');
  const pm = '<pm><content>\n<!-- the book -->\n<pmEntry id="a>b"><pmEntryTitle>Book</pmEntryTitle><!-- note -->\n' +
    '<pmEntry><pmEntryTitle>Chapter</pmEntryTitle>\n<pmEntry><pmEntryTitle>7</pmEntryTitle><xi:include href="csdb/A.xml"/></pmEntry>\n<pmEntry/>\n</pmEntry>\n</pmEntry>\n</content></pm>';
  const r = unwrapChapterFolders(pm);
  assert.deepEqual([r.unwrapped, r.chapters, r.numbered], [true, 2, false], 'the entry with a quote-guarded > in its attribute is read as one entry; the unnamed self-closing sibling makes the numbering all-or-nothing fail');
  assert.ok(r.text.includes('<pmEntry/>') && r.text.includes('csdb/A.xml'));
  assert.ok(r.text.startsWith('<pm><content>') && r.text.endsWith('</content></pm>'), 'everything around the entries is kept');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The body: chapter dividers
// ---------------------------------------------------------------------------------------------------------------------------------
test('a chapter opens on a centred 18 pt divider followed by a blank verso, with no end-of-chapter marker', async () => {
  const { doc } = pdfs['xignal-jss'];
  let divider = 0;
  for (let n = 1; n <= doc.numPages && !divider; n++) {
    const t = await texts(doc, n);
    if (t.some((i) => /^This chapter covers the following topics:?$/.test(i.s))) divider = n;
  }
  assert.ok(divider > 0, 'a divider page is printed');
  const t = await texts(doc, divider);
  const word = t.find((i) => /^Chapter( \d+)?$/.test(i.s));
  assert.ok(word, 'the page says "Chapter"');
  near(word.size, 18, 0.05, 'the chapter heading is 18 pt');
  const line = t.filter((i) => Math.abs(i.y - word.y) < 0.5);
  const centre = (Math.min(...line.map((i) => i.x)) + Math.max(...line.map((i) => i.x + i.w))) / 2;
  const column = divider % 2 === 1 ? (70.9 + 552.8) / 2 : (42.5 + 524.4) / 2;
  near(centre, column, 1.5, '"Chapter N" is centred on the text column');
  const rules = (await strokes(doc, pdfs['xignal-jss'].OPS, divider)).filter((l) => Math.abs(l.lw - 1.417) < 0.05);
  assert.ok(rules.length >= 2, 'the topic table is held between two 1.417 pt rules');
  const verso = await texts(doc, divider + 1);
  assert.ok(verso.some((i) => /intentionally/.test(i.s)), 'the divider is followed by a blank verso');
  for (let n = 1; n <= doc.numPages; n++) {
    assert.ok(!(await texts(doc, n)).some((i) => /End of Chapter/.test(i.s)), `page ${n}: the reference has no end-of-chapter marker`);
  }
});

test('the stencil profile keeps its own divider: left-aligned title and the end-of-chapter marker', async () => {
  const { doc } = pdfs.uhb;
  let marker = false;
  for (let n = 1; n <= doc.numPages && !marker; n++) marker = (await texts(doc, n)).some((i) => /End of Chapter/.test(i.s));
  assert.ok(marker, 'the default profile still ends each chapter with its marker');
});
