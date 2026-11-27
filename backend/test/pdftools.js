'use strict';
// PDF reading for tests, with no external program (QA-003, WP-08).
//
// The tests used to call poppler/xpdf command-line tools (pdftotext, pdfinfo, pdfimages). Those are not part of the product or of Windows: Git for
// Windows ships xpdf's pdftotext only, PowerShell finds none of them, and when one was missing the test read `.stdout` of a failed spawnSync and threw
// a TypeError that never named the tool. Two different extractors (xpdf here, poppler on the owner's Debian image) also produced the evidence.
//
// This module reads PDFs with the pdf.js that is already in the repository (frontend/node_modules/pdfjs-dist, borrowed exactly as the product's
// structure recovery borrows it, src/services/importer/recover/pdfjs.ts). Every machine that can build the frontend therefore reads PDFs the same way.
//
//   const pdf = await readPdf(fileOrBuffer);
//   pdf.pageCount                       number of pages                           (was: pdfinfo "Pages:")
//   pdf.pageSize(n)                     { width, height } in points, rotation applied (was: pdfinfo -f n -l n "Page n size")
//   pdf.text({ first, last, mode })     text of pages first..last, each followed by \f (was: pdftotext [-layout|-raw] -f -l)
//   await pdfImageCount(src, n?)        pictures painted on page n, or in the whole document (was: pdfimages -list); the same as
//                                       (await readPdf(src, { images: true })).imageCount(n)
//   await pdfText(fileOrBuffer, opts)   shorthand for readPdf(...).text(opts)
//
// Text modes. `layout` (default): lines top to bottom, a line is the text items that share a baseline (superscripts stay on their line), items left to
// right, a gap becomes as many spaces as it is wide (like pdftotext -layout). `plain`: the same lines, one space for a gap. `raw`: the items in the order
// the content stream draws them (like pdftotext -raw). Rotated text (the margin marks) is printed after the page's horizontal text, one line per run.
//
// If pdf.js cannot be found, every call throws ONE error naming it and where it was looked for; test/tools-canary.test.js fails first, by name.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

/** Where pdf.js is looked for, in order. */
function pdfjsCandidates() {
  return [process.env.AGASTYA_PDFJS_DIR, path.join(ROOT, 'node_modules', 'pdfjs-dist'), path.join(ROOT, '..', 'frontend', 'node_modules', 'pdfjs-dist')].filter(Boolean);
}
function findPdfjs() { return pdfjsCandidates().find((d) => fs.existsSync(path.join(d, 'legacy', 'build', 'pdf.mjs'))) || null; }

const dynamicImport = new Function('u', 'return import(u)');
let libPromise = null;
function lib() {
  if (!libPromise) {
    const dir = findPdfjs();
    if (!dir) {
      libPromise = Promise.reject(new Error(`pdf.js (pdfjs-dist) is required to read PDFs in the tests and was not found. Looked in: ${pdfjsCandidates().join('; ')}. `
        + 'Run `npm ci` in frontend/ (or set AGASTYA_PDFJS_DIR to a pdfjs-dist folder). Nothing is downloaded by the tests.'));
    } else {
      libPromise = dynamicImport(pathToFileURL(path.join(dir, 'legacy', 'build', 'pdf.mjs')).href).then((m) => ({ m, dir }));
    }
  }
  return libPromise;
}

const isRotated = (t) => Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01;
const fontSizeOf = (t) => Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 10;

/** One page's lines for the `layout` and `plain` modes. */
function lines(items, mode) {
  const horiz = []; const rot = [];
  for (const it of items) (it.rotated ? rot : horiz).push(it);
  // baseline clusters, top of the page first
  horiz.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of horiz) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 0.5 * Math.min(r.fs, it.fs));
    if (row) { row.items.push(it); row.fs = Math.max(row.fs, it.fs); } else rows.push({ y: it.y, fs: it.fs, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  const out = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    let s = ''; let end = null; let fs0 = r.fs;
    for (const it of r.items) {
      if (end !== null) {
        const gap = it.x - end; const cw = Math.max(1, 0.5 * Math.min(fs0, it.fs));
        if (gap > 0.15 * Math.min(fs0, it.fs) && !/\s$/.test(s) && !/^\s/.test(it.str)) s += mode === 'layout' ? ' '.repeat(Math.max(1, Math.round(gap / cw))) : ' ';
      }
      s += it.str; end = Math.max(end ?? -Infinity, it.x + it.w); fs0 = it.fs;
    }
    out.push(s.replace(/\s+$/, ''));
  }
  // rotated runs: one line each, grouped by their baseline (x for text that reads up or down)
  const rrows = [];
  for (const it of rot) {
    const key = Math.round(it.x);
    const row = rrows.find((r) => Math.abs(r.key - key) <= 0.5 * it.fs && r.dir === it.dir);
    if (row) row.items.push(it); else rrows.push({ key, dir: it.dir, items: [it] });
  }
  for (const r of rrows) {
    r.items.sort((a, b) => (r.dir > 0 ? a.y - b.y : b.y - a.y));
    out.push(r.items.map((i) => i.str).join(mode === 'layout' ? ' ' : ' ').replace(/\s+$/, ''));
  }
  return out;
}

function pageText(p, mode) {
  if (mode === 'raw') {
    let s = ''; let lastY = null;
    for (const it of p.items) {
      if (lastY !== null && Math.abs(it.y - lastY) > 0.5 * it.fs) s = s.replace(/[ \t]+$/, '') + '\n';
      else if (s && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' ';
      s += it.str; lastY = it.y;
      if (it.eol) { s += '\n'; lastY = null; }
    }
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n+$/, '') + '\n';
  }
  const ls = lines(p.items, mode);
  return ls.length ? ls.join('\n') + '\n' : '';
}

// A test often asks for one page at a time; the PDF is parsed once. Buffers are keyed by identity, files by path, size and time of change.
const bufCache = new WeakMap(); const fileCache = new Map();

/**
 * Read a PDF (a path or a Buffer) once; all queries afterwards are synchronous. `{ images: true }` also walks every page's drawing operators so that
 * imageCount() can answer (slower on a large PDF, so it is asked for).
 */
function readPdf(src, { images = false } = {}) {
  const flag = images ? 'img' : 'txt';
  if (Buffer.isBuffer(src)) {
    const m = bufCache.get(src) || {}; bufCache.set(src, m);
    if (!m[flag]) m[flag] = parse(src, images);
    return m[flag];
  }
  const st = fs.statSync(src); const id = `${path.resolve(src)}|${flag}|`; const key = `${id}${st.size}|${st.mtimeMs}`;
  if (!fileCache.has(key)) {
    for (const k of [...fileCache.keys()]) if (k.startsWith(id)) fileCache.delete(k);     // the file was rebuilt
    while (fileCache.size >= 8) fileCache.delete(fileCache.keys().next().value);
    fileCache.set(key, parse(src, images));
  }
  return fileCache.get(key);
}

/** Pictures painted on page n, or in the whole document. */
async function pdfImageCount(src, n) { return (await readPdf(src, { images: true })).imageCount(n); }

async function parse(src, withImages) {
  const { m: pdfjs, dir } = await lib();
  const buf = Buffer.isBuffer(src) ? src : fs.readFileSync(src);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error(`not a PDF (${Buffer.isBuffer(src) ? `a ${buf.length}-byte buffer` : src}) - it starts with ${JSON.stringify(buf.subarray(0, 40).toString('latin1'))}`);
  }
  const data = new Uint8Array(buf.length); data.set(buf);           // pdf.js takes ownership of (and detaches) the array it is given
  const doc = await pdfjs.getDocument({
    data, standardFontDataUrl: pathToFileURL(path.join(dir, 'standard_fonts')).href + '/',
    disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0,
  }).promise;
  const IMAGE_OPS = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintImageMaskXObjectRepeat, pdfjs.OPS.paintInlineImageXObjectGroup, pdfjs.OPS.paintImageMaskXObjectGroup].filter((x) => x !== undefined));
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        if (!it.str) { if (it.hasEOL && items.length) items[items.length - 1].eol = true; continue; }
        const t = it.transform; const rotated = isRotated(t);
        items.push({ str: it.str, x: t[4], y: t[5], w: it.width || 0, fs: fontSizeOf(t), rotated, dir: rotated ? Math.sign(t[1]) || 1 : 0, eol: !!it.hasEOL });
      }
      let images = null;
      if (withImages) { const ops = await page.getOperatorList(); images = 0; for (const fn of ops.fnArray) if (IMAGE_OPS.has(fn)) images++; }
      pages.push({ width: vp.width, height: vp.height, items, images });
      page.cleanup();
    }
  } finally { await doc.destroy().catch(() => {}); }

  const range = (first = 1, last = pages.length) => {
    const a = Math.max(1, first); const b = Math.min(pages.length, last);
    return pages.slice(a - 1, Math.max(a - 1, b));
  };
  return {
    pageCount: pages.length,
    pageSize(n) { const p = pages[n - 1]; if (!p) throw new Error(`page ${n} does not exist (the PDF has ${pages.length})`); return { width: p.width, height: p.height }; },
    text({ first, last, mode = 'layout' } = {}) {
      if (!['layout', 'plain', 'raw'].includes(mode)) throw new Error(`unknown text mode ${mode}`);
      return range(first, last).map((p) => pageText(p, mode) + '\f').join('');
    },
    imageCount(n) {
      if (!withImages) throw new Error('imageCount() needs readPdf(src, { images: true }) (or use pdfImageCount)');
      if (n !== undefined && !pages[n - 1]) throw new Error(`page ${n} does not exist (the PDF has ${pages.length})`);
      return n === undefined ? pages.reduce((s, p) => s + p.images, 0) : pages[n - 1].images;
    },
  };
}

/** Text of a PDF (a path or a Buffer); options as readPdf(...).text(). */
async function pdfText(src, opts) { return (await readPdf(src)).text(opts); }

module.exports = { readPdf, pdfText, pdfImageCount, findPdfjs, pdfjsCandidates };
