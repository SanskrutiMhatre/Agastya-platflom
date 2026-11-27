'use strict';
// Tools canary (WP-08, QA-003): the programs and libraries the backend tests need, checked first and by name.
//
// Before this file a missing tool showed up deep inside some other test, as a TypeError on `.stdout` of a failed spawnSync or as an assertion that
// read like a product defect ("the Change Notice page is in the PDF"). Each check here names the tool, where it was looked for and how to provide it.
// The CI gate (scripts/ci/gate.mjs) runs this file before every other backend file and stops when it fails. Every tool below is in the repository
// or in node_modules: no test needs poppler, xpdf or any other program installed on the machine.
//
// The versions found are printed (test diagnostics) so that the evidence of a run records which tools produced it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const paths = require('../vendor/engine/paths');
const { readPdf, findPdfjs, pdfjsCandidates } = require('./pdftools');

const BACKEND = path.resolve(__dirname, '..');
const firstLine = (s) => String(s || '').split(/\r?\n/).find((l) => l.trim()) || '';

test('the backend is built: dist/ exists and is not older than src/ (the tests run the compiled code)', (t) => {
  const app = path.join(BACKEND, 'dist', 'app.js');
  assert.ok(fs.existsSync(app), 'backend/dist/app.js is missing: run `npx tsc -p .` in backend/ (or `npm run build`) first');
  const built = fs.statSync(app).mtimeMs;
  const newer = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.ts$/.test(e.name) && fs.statSync(f).mtimeMs > built + 1000) newer.push(path.relative(BACKEND, f)); } };
  walk(path.join(BACKEND, 'src'));
  assert.deepEqual(newer, [], `src/ has files newer than dist/app.js, so the tests would run stale code (QA-015): rebuild with \`npx tsc -p .\` in backend/. Newer: ${newer.slice(0, 5).join(', ')}`);
  t.diagnostic(`dist built ${new Date(built).toISOString()}`);
});

test('pdf.js (pdfjs-dist) reads PDFs: page count, page size, text and pictures, with no external program', async (t) => {
  const dir = findPdfjs();
  assert.ok(dir, `pdfjs-dist is required to read PDFs in the tests and was not found. Looked in: ${pdfjsCandidates().join('; ')}. Run \`npm ci\` in frontend/ or set AGASTYA_PDFJS_DIR.`);
  t.diagnostic(`pdfjs-dist ${JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version} at ${dir}`);
  const sample = path.join(BACKEND, 'vendor', 'tools', 'fop-2.10', 'fop', 'examples', 'fo', 'advanced', 'cid-fonts.pdf');
  assert.ok(fs.existsSync(sample), `the reference PDF ${sample} is part of the vendored FOP distribution and is missing`);
  const pdf = await readPdf(sample, { images: true });
  assert.equal(pdf.pageCount, 3);
  assert.ok(pdf.pageSize(1).height > pdf.pageSize(1).width, 'page 1 is portrait');
  assert.match(pdf.text({ first: 1, last: 1 }), /Adding Fonts to FOP/);
  assert.equal(pdf.imageCount(), 0);
});

test('Java runs (FOP renders every PDF): the bundled JRE, or JSS_JAVA', (t) => {
  const r = spawnSync(paths.JAVA, ['-version'], { encoding: 'utf8' });
  assert.ok(!r.error && r.status === 0, `Java could not be started as "${paths.JAVA}" (${r.error ? r.error.code : `exit ${r.status}`}). The bundled JRE belongs at ${path.join(paths.JRE_HOME, 'bin')}; set JSS_JAVA to use another.`);
  t.diagnostic(`java: ${firstLine(r.stderr || r.stdout)} (${paths.hasBundledJre ? 'bundled' : paths.JAVA})`);
  for (const dir of ['build', 'lib']) assert.ok(fs.existsSync(path.join(paths.FOP_HOME, dir)), `FOP ${dir}/ is missing under ${paths.FOP_HOME}`);
  assert.ok(fs.existsSync(paths.FOP_XCONF), `the FOP configuration ${paths.FOP_XCONF} is missing`);
});

test('xsltproc runs (the S1000D and JSS pipelines transform with it)', (t) => {
  assert.ok(fs.existsSync(paths.XSLTPROC), `xsltproc is missing at ${paths.XSLTPROC} (vendored under backend/vendor/tools on Windows; install libxslt elsewhere)`);
  const r = spawnSync(paths.XSLTPROC, ['--version'], { encoding: 'utf8' });
  assert.ok(!r.error && r.status === 0, `xsltproc did not start (${r.error ? r.error.code : `exit ${r.status}`}): ${firstLine(r.stderr)}`);
  t.diagnostic(`xsltproc: ${firstLine(r.stdout)}`);
});

test('xmllint-wasm loads (schema validation)', async (t) => {
  const pkg = require.resolve('xmllint-wasm/package.json', { paths: [BACKEND] });
  t.diagnostic(`xmllint-wasm ${JSON.parse(fs.readFileSync(pkg, 'utf8')).version}`);
  const { validateXML } = require('xmllint-wasm');
  const r = await validateXML({
    xml: [{ fileName: 'a.xml', contents: '<a/>' }],
    schema: [{ fileName: 'a.xsd', contents: '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="a"/></xs:schema>' }],
  });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('fonts: Liberation Sans is vendored (Arial is the house font; without its licensed files FOP falls back to Liberation Sans)', (t) => {
  const fonts = path.join(path.dirname(paths.FOP_XCONF), 'fonts');
  assert.ok(fs.existsSync(path.join(fonts, 'LiberationSans-Regular.ttf')), `the fallback font is missing in ${fonts}`);
  const arial = ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf'].filter((f) => fs.existsSync(path.join(fonts, f)));
  t.diagnostic(arial.length === 4 ? 'Arial: installed (licensed copy)' : `Arial: ${arial.length}/4 files; PDFs are set in Liberation Sans on this machine (backend/vendor/tools/fonts/README.md)`);
});
