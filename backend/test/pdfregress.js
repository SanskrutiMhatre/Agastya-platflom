'use strict';
// PDF regression tools for the tests (WP-30, QA-006): raster comparison against approved baseline pictures, a fonts-embedded check and an
// internal-link check. No external program: pdf.js (the copy test/pdftools.js finds, borrowed from frontend/node_modules) renders the pages onto
// @napi-rs/canvas, the canvas pdf.js itself names as its Node dependency (also in frontend/node_modules). poppler/pdftoppm is not needed.
//
//   const doc = await openPdf(bufferOrFile)
//   await renderPage(doc, n, scale)       -> { width, height, rgba (Uint8ClampedArray), png (Buffer) }
//   await volatileBoxes(doc, n, scale)    -> [[x0, y0, x1, y1], ...] device boxes of text that changes from build to build (dates, times, years):
//                                            the printing stamp in the margin, the month/year of a cover, the issue date of a module
//   compare(a, b, masks)                  -> { differing, total, ratio, diffPng } pixels whose largest channel difference exceeds PIXEL_DELTA,
//                                            outside the masks
//   await fontsOf(pdfBuffer)              -> { fonts: [{ name, embedded, pages }], notEmbedded: [...] }  every font a page selects (setFont)
//   await linksOf(doc)                    -> { internal, external, outline, unresolved: [...] }  every Link annotation and outline entry; an
//                                            internal destination counts as resolved only when it names a page that exists in this document
//
// Why masks and not a fixed clock: the date reaches the PDF from more than forty places (cover month/year, module issue dates, the "Printed" mark,
// the change notice), several of them in the job workers. Masking the boxes of date-like text - computed from the PDF's own text positions, on the
// baseline AND on the new build - keeps the comparison stable from day to day without touching the product, and everything else on the page is
// compared to the pixel.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { findPdfjs, pdfjsCandidates } = require('./pdftools');

const PIXEL_DELTA = 48;            // a pixel differs when one colour channel moved by more than this (of 255): anti-aliasing noise stays below
const VOLATILE = /\b(?:19|20)\d\d\b|\b\d{1,2}:\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i;

function canvasDir() {
  const pdfjs = findPdfjs();
  const c = [process.env.AGASTYA_CANVAS_DIR, pdfjs && path.join(pdfjs, '..', '@napi-rs', 'canvas'), path.join(__dirname, '..', 'node_modules', '@napi-rs', 'canvas'),
    path.join(__dirname, '..', '..', 'frontend', 'node_modules', '@napi-rs', 'canvas')].filter(Boolean);
  return { found: c.find((d) => fs.existsSync(path.join(d, 'package.json'))) || null, looked: c };
}
/** '' when the renderer is there, else a sentence naming what is missing and where it was looked for. */
function missing() {
  if (!findPdfjs()) return `pdf.js (pdfjs-dist) was not found (looked in ${pdfjsCandidates().join('; ')}); run npm ci in frontend/`;
  const c = canvasDir(); if (!c.found) return `@napi-rs/canvas (pdf.js's Node canvas) was not found (looked in ${c.looked.join('; ')}); run npm ci in frontend/`;
  return '';
}

const dynamicImport = new Function('u', 'return import(u)');
let libP = null;
function lib() {
  if (!libP) {
    const why = missing(); if (why) throw new Error(why);
    const dir = findPdfjs();
    libP = dynamicImport(pathToFileURL(path.join(dir, 'legacy', 'build', 'pdf.mjs')).href).then((m) => ({ m, dir, canvas: require(canvasDir().found) }));
  }
  return libP;
}

async function openPdf(src, { standardFonts = true } = {}) {
  const { m, dir } = await lib();
  const buf = Buffer.isBuffer(src) ? src : fs.readFileSync(src);
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF');
  const data = new Uint8Array(buf.length); data.set(buf);
  // standardFontDataUrl is a PLAIN path: in Node pdf.js reads it with fs.readFile (a file: URL string is not found, and the unembedded standard
  // fonts - QA-006a - would then render as nothing); these are the faces pdf.js substitutes, as any viewer does for an unembedded font
  return m.getDocument({ data, ...(standardFonts ? { standardFontDataUrl: path.join(dir, 'standard_fonts') + path.sep } : {}), disableFontFace: true, useSystemFonts: false,
    isEvalSupported: false, fontExtraProperties: true, verbosity: 0 }).promise;
}

async function renderPage(doc, n, scale) {
  const { canvas } = await lib();
  const page = await doc.getPage(n); const vp = page.getViewport({ scale });
  const c = canvas.createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)); const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { width: c.width, height: c.height, rgba: ctx.getImageData(0, 0, c.width, c.height).data, png: c.toBuffer('image/png') };
}

async function decodePng(buf) {
  const { canvas } = await lib();
  const img = await canvas.loadImage(buf); const c = canvas.createCanvas(img.width, img.height); const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { width: img.width, height: img.height, rgba: ctx.getImageData(0, 0, img.width, img.height).data };
}

async function volatileBoxes(doc, n, scale) {
  const page = await doc.getPage(n); const vp = page.getViewport({ scale });
  const tc = await page.getTextContent(); const out = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !VOLATILE.test(it.str)) continue;
    const [a, b, c, d, e, f] = it.transform; const la = Math.hypot(a, b) || 1; const lc = Math.hypot(c, d) || 1;
    const u = [a / la, b / la]; const v = [c / lc, d / lc]; const w = it.width || 0; const hgt = it.height || lc;
    const pts = [];
    for (const s of [0, w]) for (const t of [-0.35 * hgt, 1.15 * hgt]) pts.push(vp.convertToViewportPoint(e + u[0] * s + v[0] * t, f + u[1] * s + v[1] * t));
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    out.push([Math.floor(Math.min(...xs)) - 2, Math.floor(Math.min(...ys)) - 2, Math.ceil(Math.max(...xs)) + 2, Math.ceil(Math.max(...ys)) + 2]);
  }
  return out;
}

/** Pixels that differ outside the masks; `diffPng` marks them red on a faded copy of `b` (written next to a failure for review). */
async function compare(a, b, masks = []) {
  if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: `${a.width}x${a.height} vs ${b.width}x${b.height}`, ratio: 1, differing: a.width * a.height, total: a.width * a.height };
  const W = a.width; const H = a.height; const masked = new Uint8Array(W * H);
  for (const [x0, y0, x1, y1] of masks) for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) masked[y * W + x] = 1;
  const { canvas } = await lib();
  const c = canvas.createCanvas(W, H); const ctx = c.getContext('2d'); const img = ctx.createImageData(W, H); const o = img.data;
  let differing = 0; let total = 0;
  for (let i = 0; i < W * H; i++) {
    const k = i * 4; const grey = 255 - ((255 - (b.rgba[k] + b.rgba[k + 1] + b.rgba[k + 2]) / 3) * 0.25);
    o[k] = o[k + 1] = o[k + 2] = grey; o[k + 3] = 255;
    if (masked[i]) { o[k + 2] = 255; continue; }
    total++;
    const dlt = Math.max(Math.abs(a.rgba[k] - b.rgba[k]), Math.abs(a.rgba[k + 1] - b.rgba[k + 1]), Math.abs(a.rgba[k + 2] - b.rgba[k + 2]));
    if (dlt > PIXEL_DELTA) { differing++; o[k] = 255; o[k + 1] = 0; o[k + 2] = 0; }
  }
  ctx.putImageData(img, 0, 0);
  return { differing, total, ratio: total ? differing / total : 0, diffPng: c.toBuffer('image/png') };
}

const baseName = (n) => String(n || '').replace(/^[A-Z]{6}\+/, '');

/** Fonts used, and which are not embedded. `src` is the PDF itself (Buffer or path), NOT a document opened for rendering: with standard font
 *  data loaded, pdf.js fills an unembedded base-14 face from its own copy and reports it with a file (missingFile false), which hid exactly
 *  the defect this check is for (found in WP-30 itself). So the fonts are read from a second document opened without standard font data. */
async function fontsOf(src) {
  const { m } = await lib(); const by = new Map();
  const doc = await openPdf(src, { standardFonts: false });
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n); const ops = await page.getOperatorList();
    const ids = new Set(); for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === m.OPS.setFont) ids.add(ops.argsArray[i][0]);
    for (const id of ids) {
      let f; try { f = page.commonObjs.get(id); } catch { f = null; }
      const name = baseName(f && f.name) || id; const key = `${name}|${f && f.type}`;
      const e = by.get(key) || { name, type: f ? f.type : 'unknown', embedded: !!f && f.missingFile === false, pages: [] };
      if (!(f && f.missingFile === false)) e.embedded = false;
      if (e.pages.length < 5) e.pages.push(n);
      by.set(key, e);
    }
    page.cleanup();
  }
  await doc.destroy();
  const fonts = [...by.values()].sort((x, y) => x.name.localeCompare(y.name));
  return { fonts, notEmbedded: fonts.filter((f) => !f.embedded) };
}

async function linksOf(doc) {
  const res = { internal: 0, external: 0, outline: 0, unresolved: [] };
  const pageOf = async (dest) => {
    let d = dest;
    if (typeof d === 'string') d = await doc.getDestination(d);
    if (!Array.isArray(d) || !d.length) return null;
    const ref = d[0];
    if (typeof ref === 'number') return ref + 1;
    try { return (await doc.getPageIndex(ref)) + 1; } catch { return null; }
  };
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== 'Link') continue;
      if (a.dest !== undefined && a.dest !== null) {
        const p = await pageOf(a.dest);
        if (p && p >= 1 && p <= doc.numPages) res.internal++; else res.unresolved.push(`page ${n}: link to ${JSON.stringify(a.dest).slice(0, 80)} does not resolve`);
      } else if (a.url || a.unsafeUrl) res.external++;
      else if (a.action || a.attachment || a.setOCGState) res.internal++;
      else res.unresolved.push(`page ${n}: a link with no destination`);
    }
  }
  const walk = async (items, trail) => {
    for (const it of items || []) {
      res.outline++;
      if (it.dest !== undefined && it.dest !== null) {
        const p = await pageOf(it.dest);
        if (!(p && p >= 1 && p <= doc.numPages)) res.unresolved.push(`bookmark "${trail}${it.title}" does not resolve`);
      } else if (!it.url && !it.unsafeUrl && !it.action) res.unresolved.push(`bookmark "${trail}${it.title}" has no destination`);
      await walk(it.items, `${trail}${it.title} > `);
    }
  };
  await walk(await doc.getOutline(), '');
  return res;
}

module.exports = { missing, openPdf, renderPage, decodePng, volatileBoxes, compare, fontsOf, linksOf, PIXEL_DELTA, VOLATILE };
