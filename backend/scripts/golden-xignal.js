'use strict';
// Writes backend/test/fixtures/golden/xignal-sample.json: the page structure of the Xignal reference publication
// (RDR-1671Y-00039-00) for the data modules the sample set shares, as measured from its PDF, plus the list of pages
// and pictures where the platform's own build is known to agree with it ("the ratchet").
//
//   node scripts/golden-xignal.js <reference.pdf> <platform-build.pdf> [out.json]
//
// The reference PDF is 200+ MB and is NOT needed to run the test; only this small JSON is. Re-run this after a layout
// improvement to tighten the ratchet (it can only grow while the golden test passes), then review the diff.

const fs = require('fs');
const path = require('path');
const g = require('../test/helpers-golden');

const TOL_LINE = 1.0;      // pt, first/last body line
const TOL_IMG = 0.5;       // pt, picture box

async function main() {
  const [refPdf, minePdf, outArg] = process.argv.slice(2);
  if (!refPdf || !minePdf) { console.error('usage: node scripts/golden-xignal.js <reference.pdf> <platform-build.pdf> [out.json]'); process.exit(2); }
  const out = outArg || path.join(__dirname, '..', 'test', 'fixtures', 'golden', 'xignal-sample.json');
  const R = await g.openPdf(refPdf); const M = await g.openPdf(minePdf);
  const refDms = g.groupDms(await g.scanPages(R.doc)); const mineDms = g.groupDms(await g.scanPages(M.doc));
  const refBy = new Map(); for (const d of refDms) if (d.code && !refBy.has(d.code)) refBy.set(d.code, d);

  // WHY a module differs, kept across regenerations (a difference with no entry here is unexplained and needs looking at)
  const WHY = {
    'RDR-A-A05-40-00-04A-913A-D': 'Not an engine difference: the data module in the sample is a different revision from the one printed in the reference. Its chart has numbered rows (1, 2, 3 ...) with a 30 kVA DG set row that lists module references and a 2.2 in Activity column; the reference prints rows (a) to (g) with different wording and a 1.5 in Activity column. Every other absolute-width table in the reference is drawn at exactly its authored widths.',
  };
  const modules = []; const known = [];
  for (const m of mineDms) {
    const r = refBy.get(m.code); if (!r) continue;
    if (r.pages.length !== m.pages.length || r.a3 !== m.a3) {
      known.push({ code: m.code, reference: { pages: r.pages.length, a3: r.a3 }, platform: { pages: m.pages.length, a3: m.a3 }, ...(WHY[m.code] ? { why: WHY[m.code] } : {}) });
      continue;
    }
    const sigs = []; const ratchet = [];
    for (let i = 0; i < r.pages.length; i++) {
      const a = await g.pageSignature(M.doc, m.pages[i]); const b = await g.pageSignature(R.doc, r.pages[i]);
      sigs.push(b);
      if (a.firstT === b.firstT && Math.abs(a.firstY - b.firstY) <= TOL_LINE && a.lastT === b.lastT && Math.abs(a.lastY - b.lastY) <= TOL_LINE) ratchet.push(i + 1);
    }
    modules.push({ code: m.code, pages: r.pages.length, a3: r.a3, sigs, ratchet });
  }

  // pictures: every ICN line printed under a picture, in both documents
  const figures = []; const figuresKnown = [];
  const icns = new Set();
  for (let n = 1; n <= M.doc.numPages; n++) {
    const sig = await g.pageSignature(M.doc, n); void sig;
    const tc = await (await M.doc.getPage(n)).getTextContent();
    for (const it of tc.items) { const t = it.str.trim(); if (/^ICN-[A-Z0-9-]+$/.test(t)) icns.add(t); }
  }
  for (const icn of [...icns].sort()) {
    const re = new RegExp('^' + icn.replace(/[-]/g, '\\-') + '$');
    const mn = await g.pageWithText(M.doc, re); const rn = await g.pageWithText(R.doc, re);
    if (!mn || !rn) continue;
    const mb = (await g.imageBoxes(M.doc, M.OPS, mn)).filter((b) => b.h > 60); const rb = (await g.imageBoxes(R.doc, R.OPS, rn)).filter((b) => b.h > 60);
    if (!mb.length || !rb.length) continue;
    const same = mb.length === rb.length && mb.every((b, i) => Math.abs(b.x0 - rb[i].x0) <= TOL_IMG && Math.abs(b.y0 - rb[i].y0) <= TOL_IMG && Math.abs(b.w - rb[i].w) <= TOL_IMG && Math.abs(b.h - rb[i].h) <= TOL_IMG);
    (same ? figures : figuresKnown).push({ icn, boxes: rb, platform: same ? undefined : mb });
  }

  // side marks (rotated 90 degrees) of one odd and one even body page. The time in the "Printed" mark is not compared, and the platform's
  // diagonal NOT RELEASED watermark (a deliberate safety rule the reference does not have) is not a side mark.
  const probe = modules.find((m) => m.code === 'RDR-A-A15-30-00-08A-131A-D');
  const marksOf = async (doc, dm, idx) => (await g.marks(doc, dm.pages[idx])).filter((x) => Math.abs(x.rot) === 90 && !/^Printed /.test(x.text)).sort((p, q) => p.text.localeCompare(q.text));
  const refProbe = refBy.get(probe.code); const mineProbe = mineDms.find((d) => d.code === probe.code);
  const markPages = [];
  for (const idx of [1, 2]) {
    const rm = await marksOf(R.doc, refProbe, idx); const mm = await marksOf(M.doc, mineProbe, idx);
    markPages.push({ code: probe.code, page: idx + 1, marks: rm, agree: JSON.stringify(rm) === JSON.stringify(mm) });
  }

  const doc = {
    source: { reference: path.basename(refPdf), measured: new Date().toISOString().slice(0, 10), tolerancePt: { line: TOL_LINE, picture: TOL_IMG },
      note: 'Reference geometry from the Xignal publication RDR-1671Y-00039-00; "ratchet" lists the pages/pictures where the platform build agrees with it.' },
    modules, known, figures, figuresKnown, markPages,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n');
  const pages = modules.reduce((s, m) => s + m.pages, 0); const ok = modules.reduce((s, m) => s + m.ratchet.length, 0);
  console.log(`modules ${modules.length} (+${known.length} with a different page count), pages ${pages}, identical first/last line ${ok} (${(100 * ok / pages).toFixed(1)}%)`);
  console.log(`pictures identical ${figures.length}, differing ${figuresKnown.length}; margin-mark pages agreeing: ${markPages.filter((m) => m.agree).length}/${markPages.length}`);
  console.log('wrote', out);
  await R.doc.destroy(); await M.doc.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
