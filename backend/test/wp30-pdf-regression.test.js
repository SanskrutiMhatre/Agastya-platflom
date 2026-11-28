'use strict';
// PDF regression (WP-30, QA-006): how the product's deliverable LOOKS, for the three formats, against approved baseline pictures; plus every font
// embedded and every link and bookmark resolving.
//
// Books (each built through the real HTTP path in a throwaway workspace):
//   s1000d-plain    the S1000D sample project on the plain house style, direct engine (s1000dtofo)
//   s1000d-xignal   the S1000D sample project on the Xignal reference layout (its default since 2026-11-26)
//   jss-uhb         a new JSS User Handbook (land), the starting document of that type
//   jss-0251        the JSS-0251 RWI package imported into a JSS project (customer material: SAMPLE PROJECTS/JSS-0251/RWI.zip or RWI_ZIP; skipped
//                   with the reason when it is not there)
//   jsg-uhb         the bundled JSG sample (the dummy-data User Handbook, since d87dc48)
//
// Per book: the page count, the set of fonts and the number of internal links and bookmarks equal the baseline; every font except the 14 standard
// PDF fonts is embedded, and the standard fonts left unembedded are a recorded known defect (QA-006a) that may only shrink; no link or bookmark
// points nowhere; and the baseline's pages (three per book, rendered at RENDER_SCALE = 0.5, about 36 dpi) differ from the new rendering
// in at most MAX_RATIO of their pixels (a pixel differs when one channel moved by more than 48/255). Text that changes from build to build (dates,
// times, years) is masked by its own text box, on the baseline and on the new build (test/pdfregress.js says why). On a failure the new page and a
// diff picture (differences red, masks blue) are written to AGASTYA_TEST_RESULTS (the gate's evidence folder) or the temp folder.
// A sensitivity test proves the threshold catches a one-word change on a cover.
//
// Baselines: test/fixtures/pdf-regression/<book>/manifest.json + p<n>.png (jss-0251: the manifest only; its pictures are renders of customer
// material, git-ignored, taken on the machine that holds it). They are only (re)written by an explicit command:
//   node scripts/pdf-baseline.js --update [book ...]        (sets PDF_BASELINE_UPDATE=1 and runs this file)
// Review the pictures in the diff before committing them. Without the flag a missing baseline is a failure, never a silent write.
//
// The pictures are taken with the house font Arial (backend/vendor/tools/fonts/arial*.ttf, git-ignored, licensed). Without Arial FOP sets the books in
// Liberation Sans, so the raster comparison of a book whose baseline uses Arial is skipped with that reason; the font, link and page checks still run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot, tmp } = require('./helpers');
const R = require('./pdfregress');

const PW = 'Correct-Horse-9!';
const FIX = path.join(__dirname, 'fixtures', 'pdf-regression');
const RENDER_SCALE = 0.5;
const MAX_RATIO = 0.002;                 // 0.2 % of the unmasked pixels of a page
const UPDATE = process.env.PDF_BASELINE_UPDATE === '1';
const ONLY = (process.env.PDF_BASELINE_BOOKS || '').split(',').filter(Boolean);
const RWI = [process.env.RWI_ZIP, path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'JSS-0251', 'RWI.zip')].filter(Boolean).find((f) => fs.existsSync(f));
const FONTS = path.join(__dirname, '..', 'vendor', 'tools', 'fonts');
const ARIAL = ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'].every((f) => fs.existsSync(path.join(FONTS, f)));
const NO_RENDERER = R.missing();
const BASE14 = new Set(['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic', 'Symbol', 'ZapfDingbats']);
const OUT = process.env.AGASTYA_TEST_RESULTS ? path.join(process.env.AGASTYA_TEST_RESULTS, 'pdf-regression') : null;

let h; let w;
test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'regis', fullName: 'Regis', role: 'author' });
  w = new h.Client('regis'); await w.post('/api/auth/login', { username: 'regis', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'regis', password: PW });
});
test.after(async () => { await h.close(); });

const ok = (r, what) => { assert.ok(r.status >= 200 && r.status < 300, `${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`); return r; };
async function publishPdf(id) {
  ok(await w.post(`/api/projects/${id}/publish`, {}), 'publish');
  const r = await w.get(`/api/projects/${id}/publish/pdf`); assert.equal(r.status, 200); assert.equal(r.buf.subarray(0, 4).toString(), '%PDF'); return r.buf;
}
async function jssProject(name) { const r = ok(await w.post('/api/projects', { name, format: 'jss', domain: 'land', manualType: 'uhb' }), 'create JSS'); return r.json.project.id; }

const BOOKS = {
  's1000d-plain': async () => {
    const s = ok(await w.post('/api/projects/sample', {}), 'sample'); const id = s.json.project.id;
    ok(await w.patch(`/api/projects/${id}`, { templateRef: 'default' }), 'plain style'); ok(await w.patch(`/api/projects/${id}`, { pipeline: 's1000dtofo' }), 'direct engine');
    return publishPdf(id);
  },
  's1000d-xignal': async () => {
    const s = ok(await w.post('/api/projects/sample', {}), 'sample'); assert.equal(s.json.project.templateRef, 'xignal-s1000d', 'the sample starts on the Xignal layout');
    return publishPdf(s.json.project.id);
  },
  'jss-uhb': async () => publishPdf(await jssProject('Regression UHB')),
  'jss-0251': async () => {
    const id = await jssProject('Regression JSS-0251');
    const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(RWI)]), 'RWI.zip');
    const r = await fetch(`${h.base}/api/projects/${id}/jss/import-project`, { method: 'POST', headers: { cookie: w.cookie }, body: fd });
    assert.equal(r.status, 200, `import: ${(await r.text()).slice(0, 300)}`);
    return publishPdf(id);
  },
  'jsg-uhb': async () => {
    const s = ok(await w.post('/api/projects/sample-jsg', {}), 'JSG sample'); const id = s.json.project.id;
    ok(await w.post(`/api/projects/${id}/jsg/build`), 'JSG build');
    return fs.readFileSync(path.join(h.ws, 'projects', id, 'jsg-output.pdf'));
  },
};
const skipOf = (book) => {
  if (ONLY.length && !ONLY.includes(book)) return `not selected (PDF_BASELINE_BOOKS=${ONLY.join(',')})`;
  if (book === 'jss-0251' && !RWI) return 'the JSS-0251 RWI package is not in this checkout (customer material: SAMPLE PROJECTS/JSS-0251/RWI.zip or RWI_ZIP)';
  return false;
};
// The baseline pages: the first page (cover), the fullest front-matter page (pages 2-15, and before the middle third: contents, lists, notices) and the fullest page of the
// middle third of the body (most text characters; ties go to the earlier page). Chosen once, when the baseline is taken, and kept in the manifest.
async function pickPages(doc) {
  const n = doc.numPages; const chars = [0];
  for (let p = 1; p <= n; p++) { const tc = await (await doc.getPage(p)).getTextContent(); chars.push(tc.items.reduce((s, it) => s + (it.str ? it.str.trim().length : 0), 0)); }
  const fullest = (a, b) => { let best = null; for (let p = Math.max(2, a); p <= Math.min(n, b); p++) if (best === null || chars[p] > chars[best]) best = p; return best; };
  return [...new Set([1, fullest(2, Math.max(2, Math.min(15, Math.ceil(n / 3) - 1))), fullest(Math.ceil(n / 3), Math.floor((2 * n) / 3))].filter(Boolean))].sort((a, b) => a - b);
}

async function keep(book, name, buf) {
  const dir = OUT || tmp('pdfreg-'); fs.mkdirSync(path.join(dir, book), { recursive: true }); const f = path.join(dir, book, name); fs.writeFileSync(f, buf); return f;
}

const built = {};
for (const book of Object.keys(BOOKS)) {
  test(`${book}: builds; every font embedded; every link and bookmark resolves; pages, fonts and links as the baseline`, { skip: skipOf(book), timeout: 900000 }, async (t) => {
    if (NO_RENDERER) throw new Error(NO_RENDERER);
    const buf = await BOOKS[book](); const doc = await R.openPdf(buf); built[book] = doc;
    const fonts = await R.fontsOf(buf); const links = await R.linksOf(doc);
    t.diagnostic(`${book}: ${doc.numPages} pages; fonts ${fonts.fonts.map((f) => f.name).join(', ')}; ${links.internal} internal links, ${links.external} external, ${links.outline} bookmarks`);
    const notEmbedded = fonts.notEmbedded.map((f) => f.name);
    assert.deepEqual(notEmbedded.filter((n) => !BASE14.has(n)), [], `every font other than the 14 standard PDF fonts is embedded (${JSON.stringify(fonts.notEmbedded)})`);
    assert.deepEqual(links.unresolved, [], 'every link and bookmark resolves to a page of this document');
    const mf = path.join(FIX, book, 'manifest.json');
    if (!UPDATE) assert.ok(fs.existsSync(mf), `no baseline for ${book} (${mf}); take one with: node scripts/pdf-baseline.js --update ${book}`);
    const knownBase14 = UPDATE ? notEmbedded : JSON.parse(fs.readFileSync(mf, 'utf8')).knownNotEmbedded || [];
    // KNOWN DEFECT (QA-006a, docs/audit/RELEASE-EVIDENCE.md): FOP references the base-14 faces (Helvetica, Times, Courier) without embedding them, so
    // a viewer substitutes its own. Recorded per book in the baseline; the list may only shrink - a new unembedded face fails here, and the fix
    // (embedded metric-compatible faces mapped onto those names) shows as a shorter list to re-take.
    assert.deepEqual(notEmbedded.filter((n) => !knownBase14.includes(n)), [], `no NEW unembedded standard font (known for ${book}: ${knownBase14.join(', ') || 'none'})`);
    if (notEmbedded.length) t.diagnostic(`${book}: KNOWN DEFECT QA-006a - not embedded: ${fonts.notEmbedded.map((f) => `${f.name} (pages ${f.pages.join(',')}${f.pages.length === 5 ? ',...' : ''})`).join('; ')}`);
    if (UPDATE) {
      fs.mkdirSync(path.join(FIX, book), { recursive: true });
      for (const f of fs.readdirSync(path.join(FIX, book))) if (/^p\d+\.png$/.test(f)) fs.rmSync(path.join(FIX, book, f));
      const pages = await pickPages(doc); const masks = {};
      for (const n of pages) { const r = await R.renderPage(doc, n, RENDER_SCALE); fs.writeFileSync(path.join(FIX, book, `p${n}.png`), r.png); masks[n] = await R.volatileBoxes(doc, n, RENDER_SCALE); }
      fs.writeFileSync(mf, JSON.stringify({ book, takenAt: new Date().toISOString().slice(0, 10), arial: ARIAL, scale: RENDER_SCALE, pageCount: doc.numPages, pages, masks,
        fonts: fonts.fonts.map((f) => f.name), knownNotEmbedded: notEmbedded, internalLinks: links.internal, externalLinks: links.external, bookmarks: links.outline }, null, 1) + '\n');
      t.diagnostic(`baseline written: ${path.relative(path.join(__dirname, '..'), path.join(FIX, book))} (pages ${pages.join(', ')})`);
      return;
    }
    assert.ok(fs.existsSync(mf), `no baseline for ${book} (${mf}); take one with: node scripts/pdf-baseline.js --update ${book}`);
    const M = JSON.parse(fs.readFileSync(mf, 'utf8'));
    assert.equal(doc.numPages, M.pageCount, `${book}: page count (baseline ${M.pageCount})`);
    assert.equal(links.internal, M.internalLinks, `${book}: internal links (baseline ${M.internalLinks})`);
    assert.equal(links.outline, M.bookmarks, `${book}: bookmarks (baseline ${M.bookmarks})`);
    const setInArial = M.fonts.some((f) => /Arial/.test(f));
    if (ARIAL || !setInArial) assert.deepEqual(fonts.fonts.map((f) => f.name), M.fonts, `${book}: the fonts used (a substituted font is a regression)`);
  });

  test(`${book}: the baseline pages look the same (raster, at most ${MAX_RATIO * 100} % of pixels differ, dates masked)`, { skip: skipOf(book) || (UPDATE && 'baseline update run'), timeout: 600000 }, async (t) => {
    const doc = built[book]; assert.ok(doc, 'the book was built by the test above');
    const M = JSON.parse(fs.readFileSync(path.join(FIX, book, 'manifest.json'), 'utf8'));
    if (book === 'jss-0251' && !M.pages.every((n) => fs.existsSync(path.join(FIX, book, `p${n}.png`)))) {
      return t.skip('the JSS-0251 baseline pictures are renders of customer material and are not committed (.gitignore); take them on this machine with: node scripts/pdf-baseline.js --update jss-0251');
    }
    if (!ARIAL && M.fonts.some((f) => /Arial/.test(f))) return t.skip('the baseline is set in Arial and Arial is not installed here (backend/vendor/tools/fonts/arial*.ttf, licensed, git-ignored): FOP used Liberation Sans');
    const worst = []; const failures = [];
    for (const n of M.pages) {
      const now = await R.renderPage(doc, n, M.scale);
      const base = await R.decodePng(fs.readFileSync(path.join(FIX, book, `p${n}.png`)));
      const masks = [...(M.masks[n] || []), ...(await R.volatileBoxes(doc, n, M.scale))];
      const c = await R.compare(now, base, masks);
      worst.push(`p${n} ${(c.ratio * 100).toFixed(3)} %`);
      if (c.sizeMismatch || c.ratio > MAX_RATIO) {
        const a = await keep(book, `p${n}-now.png`, now.png); if (c.diffPng) await keep(book, `p${n}-diff.png`, c.diffPng);
        failures.push(`page ${n}: ${c.sizeMismatch || `${c.differing} of ${c.total} pixels differ (${(c.ratio * 100).toFixed(3)} %)`}; new rendering and diff: ${path.dirname(a)}`);
      }
    }
    t.diagnostic(`${book}: ${worst.join(', ')}`);
    assert.deepEqual(failures, [], `${book} no longer looks like its baseline. If the change is intended, review the pictures and re-take: node scripts/pdf-baseline.js --update ${book}`);
  });
}

test('sensitivity: a one-word change on a JSS cover is caught by the raster comparison (the threshold is not too loose)', { skip: (UPDATE && 'baseline update run') || (!ARIAL && 'Arial is not installed (the raster comparison needs the baseline font)') || skipOf('jss-uhb'), timeout: 600000 }, async (t) => {
  const M = JSON.parse(fs.readFileSync(path.join(FIX, 'jss-uhb', 'manifest.json'), 'utf8'));
  // the cover prints the book's name, which a new JSS document takes from the project name: "Regression UHB" in the baseline, one word more here
  const id = await jssProject('Regression UHB Revised');
  const doc = await R.openPdf(await publishPdf(id));
  assert.match((await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' '), /Regression UHB Revised/, 'the changed word is on the cover');
  const now = await R.renderPage(doc, 1, M.scale); const base = await R.decodePng(fs.readFileSync(path.join(FIX, 'jss-uhb', 'p1.png')));
  const c = await R.compare(now, base, [...(M.masks[1] || []), ...(await R.volatileBoxes(doc, 1, M.scale))]);
  t.diagnostic(`one added word on the cover: ${(c.ratio * 100).toFixed(3)} % of the pixels differ`);
  assert.ok(c.ratio > MAX_RATIO, `one added word on the cover changes ${(c.ratio * 100).toFixed(3)} % of the pixels, which must exceed the ${MAX_RATIO * 100} % threshold`);
});

test('specificity: a different month on the cover (what the calendar does to every book) is masked, the page still matches', { skip: (UPDATE && 'baseline update run') || (!ARIAL && 'Arial is not installed (the raster comparison needs the baseline font)') || skipOf('jss-uhb'), timeout: 600000 }, async (t) => {
  const M = JSON.parse(fs.readFileSync(path.join(FIX, 'jss-uhb', 'manifest.json'), 'utf8'));
  // the cover prints the project name, so the month is changed on the jss-uhb book's own project ("Regression UHB", made by the test above)
  const list = (await w.get('/api/projects')).json; const p = (list.projects || list).find((x) => x.name === 'Regression UHB');
  assert.ok(p, 'the jss-uhb project');
  const g = (await w.get(`/api/projects/${p.id}/jss`)).json;
  const month = /<month>([^<]*)<\/month>/.exec(g.xml); assert.ok(month, 'the starting document carries a month');
  const other = month[1] === 'May' ? 'September' : 'May';
  ok(await w.put(`/api/projects/${p.id}/jss`, { xml: g.xml.replace(month[0], `<month>${other}</month>`), baseHash: g.hash }), 'save');
  const doc = await R.openPdf(await publishPdf(p.id));
  assert.match((await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' '), new RegExp(other), 'the new month is on the cover');
  const now = await R.renderPage(doc, 1, M.scale); const base = await R.decodePng(fs.readFileSync(path.join(FIX, 'jss-uhb', 'p1.png')));
  const c = await R.compare(now, base, [...(M.masks[1] || []), ...(await R.volatileBoxes(doc, 1, M.scale))]);
  t.diagnostic(`"${month[1]}" -> "${other}" on the cover: ${(c.ratio * 100).toFixed(3)} % of the unmasked pixels differ`);
  assert.ok(c.ratio <= MAX_RATIO, `a date change must not fail the comparison (${(c.ratio * 100).toFixed(3)} %)`);
});
