'use strict';
// Reads the page structure of a built PDF, for the golden-master comparison against the Xignal reference publication.
// pdfjs-dist is borrowed from the frontend (see src/services/importer/recover/pdfjs.ts); nothing is downloaded.
//
// What is measured is geometry and page flow, never pixels: the number of pages each data module occupies, the first and
// last body line of each page (text and baseline), where each picture is placed, and where the rotated margin marks sit.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { findPdfjsDir } = require('../dist/services/importer/recover/pdfjs');

const dynamicImport = new Function('u', 'return import(u)');

async function loadPdfjs() {
  const dir = findPdfjsDir();
  if (!dir) return null;
  const lib = await dynamicImport(pathToFileURL(path.join(dir, 'legacy', 'build', 'pdf.mjs')).href);
  return { lib, dir };
}

async function openPdf(file) {
  const p = await loadPdfjs();
  if (!p) throw new Error('pdfjs-dist not found');
  const buf = fs.readFileSync(file);
  const doc = await p.lib.getDocument({
    data: new Uint8Array(buf.buffer, buf.byteOffset, buf.length),
    standardFontDataUrl: pathToFileURL(path.join(p.dir, 'standard_fonts')).href + '/',
    disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0,
  }).promise;
  return { doc, OPS: p.lib.OPS };
}

const round1 = (n) => Math.round(n * 10) / 10;
const isRotated = (t) => Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01;

/** Page header facts the scan needs: width, the data module code and page number printed in the foot, END / BLANK flags. */
async function scanPages(doc) {
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const o = { n, w: Math.round(vp.width), code: '', pg: null, end: false, blank: false };
    for (const it of tc.items) {
      const s = it.str.trim(); if (!s) continue;
      const y = it.transform[5];
      if (y < 100 && /^[A-Z0-9]{2,}-[A-Z0-9-]+-D$/.test(s)) o.code = s;
      if (y < 100 && /^End of data module/.test(s)) o.end = true;
      if (y < 100 && /Page \d+/.test(s)) o.pg = Number(/Page (\d+)/.exec(s)[1]);
      if (/ntentionally left blank/i.test(s)) o.blank = true;
    }
    out.push(o);
  }
  return out;
}

/** Data modules in order: { code, first, pages:[n...], a3 }. A module starts where its foot says "Page 1"; blank pads are not its pages. */
function groupDms(scan) {
  const dms = []; let cur = null;
  for (const r of scan) {
    if (r.blank) continue;
    if (r.pg === 1) { cur = { code: '', first: r.n, pages: [], a3: 0 }; dms.push(cur); }
    if (!cur) continue;
    cur.pages.push(r.n);
    if (r.w > 700) cur.a3++;
    if (r.code && !cur.code) cur.code = r.code;
  }
  return dms;
}

/** First and last body line of a page: text (spaces removed) and baseline. Furniture (head/foot) and rotated text are left out. */
async function pageSignature(doc, n) {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  const rows = new Map();
  for (const it of tc.items) {
    if (!it.str.trim() || isRotated(it.transform)) continue;
    const y = Math.round(it.transform[5] * 2) / 2;
    if (y <= 98 || y >= 770) continue;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push([it.transform[4], it.str]);
  }
  const ys = [...rows.keys()].sort((a, b) => b - a);
  if (!ys.length) return { firstT: '', firstY: 0, lastT: '', lastY: 0 };
  const txt = (y) => rows.get(y).sort((a, b) => a[0] - b[0]).map((r) => r[1]).join('').replace(/\s+/g, '').slice(0, 30);
  return { firstT: txt(ys[0]), firstY: ys[0], lastT: txt(ys[ys.length - 1]), lastY: ys[ys.length - 1] };
}

/** The rotated margin marks of a page (text, size, position, width). */
async function marks(doc, n) {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  return tc.items
    .filter((it) => it.str.trim() && isRotated(it.transform))
    .map((it) => ({ text: it.str, rot: Math.round(Math.atan2(it.transform[1], it.transform[0]) * 180 / Math.PI),
      x: round1(it.transform[4]), y: round1(it.transform[5]), size: round1(Math.hypot(it.transform[0], it.transform[1])), w: round1(it.width) }));
}

/** Placed bounding box (pt, origin bottom-left) of every painted image on a page, largest first. */
async function imageBoxes(doc, OPS, n) {
  const page = await doc.getPage(n);
  const ops = await page.getOperatorList();
  const mul = (m, k) => [m[0] * k[0] + m[2] * k[1], m[1] * k[0] + m[3] * k[1], m[0] * k[2] + m[2] * k[3], m[1] * k[2] + m[3] * k[3], m[0] * k[4] + m[2] * k[5] + m[4], m[1] * k[4] + m[3] * k[5] + m[5]];
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = []; const boxes = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]; const a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const w = Math.hypot(ctm[0], ctm[1]); const h = Math.hypot(ctm[2], ctm[3]);
      boxes.push({ x0: round1(ctm[4]), y0: round1(ctm[5]), w: round1(w), h: round1(h) });
    }
  }
  return boxes.sort((p, q) => q.w * q.h - p.w * p.h);
}

/** Page number (1-based) of the first page whose text contains the ICN line, or 0. */
async function pageWithText(doc, re, from = 1) {
  for (let n = from; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    if (tc.items.some((it) => re.test(it.str))) return n;
  }
  return 0;
}

module.exports = { openPdf, scanPages, groupDms, pageSignature, marks, imageBoxes, pageWithText, round1 };
