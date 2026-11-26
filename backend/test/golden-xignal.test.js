'use strict';
// Golden master: the Xignal sample, imported and published through the REAL path, against the geometry measured on the Xignal reference publication
// (RDR-1671Y-00039-00).
//
// What runs: the importer (scan + apply) -> the publish gate, ON -> a recorded waiver for the one thing the package does not ship (the organisation's
// BREX) -> publish -> the PDF is read back and compared. Nothing is bypassed.
//
// What is compared (geometry and page flow, never pixels), against test/fixtures/golden/xignal-sample.json:
//   - every module the golden lists has the same number of pages and A3 foldouts as the reference
//   - the pages listed in each module's "ratchet" still have the reference's first and last body line (text, and baseline within 1 pt).
//     The ratchet only grows: improve the layout, run scripts/golden-xignal.js to record the new agreement, review the diff.
//   - the modules that are KNOWN to differ still differ exactly as recorded (so an improvement is noticed and locked in, not silently absorbed)
//   - every picture the golden lists is placed within 0.5 pt of the reference
//   - the rotated margin marks of two body pages are identical to the reference (the time in the "Printed" mark is excluded)
// Not compared: the platform's diagonal NOT RELEASED watermark (a deliberate safety rule the reference does not have).
//
// Skipped, with the reason, when the sample, the golden file or pdfjs is not there. Set GOLDEN_SAMPLE_DIR to point at the sample elsewhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const SAMPLE = process.env.GOLDEN_SAMPLE_DIR || path.join(__dirname, '..', '..', 'SAMPLE PROJECTS', 'S1000D', 'PMC-RDR-1671Y-00039-00_001-01.xml (2)');
const GOLDEN_FILE = path.join(__dirname, 'fixtures', 'golden', 'xignal-sample.json');
const TOL_LINE = 1.0;
const TOL_IMG = 0.5;

// Nothing from ../dist may be required while this file loads: dist/config reads the workspace from the environment once, and boot() has not set it
// yet (helpers.boot refuses if that happened). The pdfjs check therefore runs after boot(), and each test skips itself when pdfjs is missing.
function why() {
  if (!fs.existsSync(SAMPLE)) return `the Xignal sample is not at ${SAMPLE}`;
  if (!fs.existsSync(GOLDEN_FILE)) return 'test/fixtures/golden/xignal-sample.json is missing (run scripts/golden-xignal.js)';
  if (!fs.existsSync(path.join(__dirname, '..', 'dist', 'app.js'))) return 'the backend is not built (npm run build)';
  return '';
}
const SKIP = why();
let NO_PDFJS = '';

let h; let author; let pdf; let platform; let G; let g;
const close = (a, b, tol) => Math.abs(a - b) <= tol;

test.before(async () => {
  if (SKIP) return;
  G = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
  h = await boot();                                              // first: it points the app at a throwaway workspace
  if (!require('../dist/services/importer/recover/pdfjs').findPdfjsDir()) { NO_PDFJS = 'pdfjs-dist is not installed (it is borrowed from the frontend)'; return; }
  g = require('./helpers-golden');
  const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'alice', fullName: 'Alice Author', role: 'author' });
  author = new h.Client('alice');
  await author.post('/api/auth/login', { username: 'alice', password: made.json.tempPassword });
  await author.post('/api/auth/onboarding', { username: 'alice', password: PW });
});
test.after(async () => { if (h) await h.close(); });

test('the Xignal sample imports, passes the publish gate with one recorded waiver, and publishes', { skip: SKIP || false, timeout: 900000 }, async (t) => {
  if (NO_PDFJS) return t.skip(NO_PDFJS);
  const created = await author.post('/api/projects', { name: 'Golden Xignal', pipeline: 's1000dtofo', profile: 'xignal-s1000d' });
  assert.equal(created.status, 201, JSON.stringify(created.json).slice(0, 300));
  const id = created.json.project.id;
  const files = fs.readdirSync(SAMPLE).filter((f) => /\.(xml|png|jpe?g|gif|svg|tiff?)$/i.test(f));
  assert.ok(files.length > 40, `the sample has its modules and pictures (${files.length} files)`);
  const form = () => { const fd = new FormData(); for (const f of files) fd.append('files', new Blob([fs.readFileSync(path.join(SAMPLE, f))]), f); return fd; };

  const scan = await author.req('POST', `/api/projects/${id}/import/scan`, form());
  assert.equal(scan.status, 200, `scan: ${JSON.stringify(scan.json).slice(0, 300)}`);
  const applied = await author.req('POST', `/api/projects/${id}/import/apply`, form());
  assert.equal(applied.status, 200, `apply: ${JSON.stringify(applied.json).slice(0, 300)}`);
  const explore = (await author.get(`/api/projects/${id}/explore`)).json;
  assert.equal(explore.counts.dms, 32, 'all 32 data modules of the sample are in the project');

  // The reference carries L&T's logo and company line: the seeded pack `lnt-xignal` (the Xignal template's default since 2026-11-26), selected here for this project as well.
  const st = (await author.get(`/api/projects/${id}/settings`)).json;
  assert.equal((await author.put(`/api/projects/${id}/settings`, { project: { ...st.project, brandPack: 'lnt-xignal' } })).status, 200);

  // the gate is NOT bypassed: the package does not ship the organisation's BREX, so a first publish is refused for exactly that
  const first = await author.post(`/api/projects/${id}/publish`, {});
  assert.equal(first.status, 422, `the strict gate refuses: ${JSON.stringify(first.json).slice(0, 300)}`);
  const kinds = [...new Set((first.json.findings || []).map((f) => f.kind))];
  assert.deepEqual(kinds, ['brex-source'], `only the missing BREX stands in the way, nothing else: ${JSON.stringify(first.json.findings).slice(0, 400)}`);
  const finding = first.json.findings.find((f) => /is not available/.test(f.title));
  assert.ok(finding, 'the finding names the BREX');
  const subject = finding.title.replace(/^BREX /, '').replace(/ is not available$/, '');
  const waiver = await author.post(`/api/projects/${id}/publish-waivers`, { kind: 'brex-missing', subject, reason: 'The organisation BREX is not shipped with the Xignal package; draft builds only.' });
  assert.equal(waiver.status, 201);

  const built = await author.post(`/api/projects/${id}/publish`, {});
  assert.equal(built.status, 200, `a waived draft builds: ${JSON.stringify(built.json).slice(0, 400)}`);
  const res = await author.get(`/api/projects/${id}/publish/pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.buf.subarray(0, 4).toString(), '%PDF');

  const file = path.join(require('os').tmpdir(), `golden-xignal-${process.pid}.pdf`);
  fs.writeFileSync(file, res.buf);
  try {
    pdf = await g.openPdf(file);
    platform = g.groupDms(await g.scanPages(pdf.doc));
  } finally { /* the file stays until the process ends: pdfjs reads it lazily */ }
  assert.ok(platform.length >= 30, `the build has its data modules (${platform.length})`);
});

test('every module has the reference page count and foldouts; the pages that agreed still agree to the point; known differences are unchanged', { skip: SKIP || false, timeout: 600000 }, async (t) => {
  if (NO_PDFJS) return t.skip(NO_PDFJS);
  assert.ok(pdf, 'the build ran');
  const by = new Map(); for (const d of platform) if (d.code && !by.has(d.code)) by.set(d.code, d);
  let agreeing = 0; let expected = 0; const lost = [];
  for (const m of G.modules) {
    const mine = by.get(m.code);
    assert.ok(mine, `${m.code} is in the build`);
    assert.equal(mine.pages.length, m.pages, `${m.code}: page count (reference ${m.pages})`);
    assert.equal(mine.a3, m.a3, `${m.code}: A3 foldouts (reference ${m.a3})`);
    for (const p of m.ratchet) {
      expected++;
      const sig = await g.pageSignature(pdf.doc, mine.pages[p - 1]);
      const ref = m.sigs[p - 1];
      if (sig.firstT === ref.firstT && close(sig.firstY, ref.firstY, TOL_LINE) && sig.lastT === ref.lastT && close(sig.lastY, ref.lastY, TOL_LINE)) agreeing++;
      else lost.push(`${m.code} p${p}: now first "${sig.firstT}"@${sig.firstY} last "${sig.lastT}"@${sig.lastY}; reference first "${ref.firstT}"@${ref.firstY} last "${ref.lastT}"@${ref.lastY}`);
    }
  }
  assert.deepEqual(lost, [], `${lost.length} of ${expected} pages that matched the reference no longer do`);
  assert.equal(agreeing, expected);

  for (const k of G.known) {
    const mine = by.get(k.code);
    assert.ok(mine, `${k.code} is in the build`);
    assert.deepEqual({ pages: mine.pages.length, a3: mine.a3 }, k.platform,
      `${k.code} is a KNOWN difference (reference ${JSON.stringify(k.reference)}, recorded platform ${JSON.stringify(k.platform)}); if it changed for the better, run scripts/golden-xignal.js to lock the improvement in`);
  }
});

test('every listed picture sits where the reference places it', { skip: SKIP || false, timeout: 600000 }, async (t) => {
  if (NO_PDFJS) return t.skip(NO_PDFJS);
  assert.ok(pdf, 'the build ran');
  const wrong = [];
  for (const f of G.figures) {
    const n = await g.pageWithText(pdf.doc, new RegExp('^' + f.icn.replace(/-/g, '\\-') + '$'));
    if (!n) { wrong.push(`${f.icn}: not found in the build`); continue; }
    const boxes = (await g.imageBoxes(pdf.doc, pdf.OPS, n)).filter((b) => b.h > 60);
    const same = boxes.length === f.boxes.length && boxes.every((b, i) => close(b.x0, f.boxes[i].x0, TOL_IMG) && close(b.y0, f.boxes[i].y0, TOL_IMG) && close(b.w, f.boxes[i].w, TOL_IMG) && close(b.h, f.boxes[i].h, TOL_IMG));
    if (!same) wrong.push(`${f.icn} (page ${n}): platform ${JSON.stringify(boxes)} reference ${JSON.stringify(f.boxes)}`);
  }
  assert.deepEqual(wrong, [], `${wrong.length} of ${G.figures.length} pictures moved`);
});

test('the rotated margin marks of the probe pages equal the reference', { skip: SKIP || false, timeout: 300000 }, async (t) => {
  if (NO_PDFJS) return t.skip(NO_PDFJS);
  assert.ok(pdf, 'the build ran');
  const by = new Map(); for (const d of platform) if (d.code && !by.has(d.code)) by.set(d.code, d);
  for (const mp of G.markPages) {
    assert.ok(mp.agree, 'the golden itself records agreement for this page');
    const mine = by.get(mp.code);
    assert.ok(mine, `${mp.code} is in the build`);
    const got = (await g.marks(pdf.doc, mine.pages[mp.page - 1]))
      .filter((x) => Math.abs(x.rot) === 90 && !/^Printed /.test(x.text)).sort((a, b) => a.text.localeCompare(b.text));
    assert.deepEqual(got, mp.marks, `${mp.code} page ${mp.page}: margin marks (text, rotation, position, size, width)`);
  }
});
