'use strict';
// Reading the JSS stencils (Word files) for tests. The stencils are the customer's and are not committed (manual format/ is untracked), so every test that uses
// them checks `haveStencils` and skips, saying why, when they are absent.
const fs = require('node:fs'); const path = require('node:path');

const STENCILS = path.resolve(__dirname, '..', '..', 'manual format', 'JSS0251-stencils');
const haveStencils = fs.existsSync(path.join(STENCILS, 'UHB.docx'));

function docxPart(file, name) {
  const { ZipFileReader } = require('../dist/services/zipio');
  const z = ZipFileReader.open(file);
  try {
    const e = z.entries.find((x) => x.name === name);
    if (!e) throw new Error(`${name} not in ${file}`);
    return new Promise((res, rej) => { const parts = []; z.open(e).on('data', (d) => parts.push(d)).on('end', () => res(Buffer.concat(parts).toString('utf8'))).on('error', rej); }).finally(() => z.close());
  } catch (e) { z.close(); throw e; }
}
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const runs = (p) => decode([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:noBreakHyphen\/>/g)].map((m) => (m[1] ?? '-')).join('')).replace(/\s+/g, ' ').trim();

/** The stencil's front matter, in order, as { text, table } items: everything before the first Heading 1 (the first chapter). */
async function stencilFrontMatter(file) {
  const doc = await docxPart(file, 'word/document.xml'); const styles = await docxPart(file, 'word/styles.xml');
  const names = {}; for (const m of styles.matchAll(/<w:style [^>]*w:styleId="([^"]+)"[^>]*>\s*<w:name w:val="([^"]+)"/g)) names[m[1]] = m[2];
  const body = doc.slice(doc.indexOf('<w:body>')); const items = [];
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const s = m[0];
    if (s.startsWith('<w:tbl>')) { for (const c of s.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)) { const t = runs(c[0]); if (t) items.push({ text: t, table: true }); } continue; }
    const sid = /<w:pStyle w:val="([^"]+)"/.exec(s)?.[1]; const n = names[sid] ?? ''; const t = runs(s);
    if (/^heading 1$/.test(n) && t) break;
    if (/^toc|table of figures/.test(n)) continue;
    if (t) items.push({ text: t, table: false });
  }
  return items;
}

/** A paragraph style's declared properties from styles.xml: { sizePt, spaceAfterPt, leftMm, hangingMm }. */
async function stencilStyle(file, styleId) {
  const styles = await docxPart(file, 'word/styles.xml');
  const m = new RegExp(`<w:style [^>]*w:styleId="${styleId}"[^>]*>([\\s\\S]*?)</w:style>`).exec(styles); if (!m) return null;
  const num = (re) => { const x = re.exec(m[1]); return x ? Number(x[1]) : undefined; };
  const mm = (tw) => (tw === undefined ? undefined : Math.round((tw / 56.7) * 10) / 10);
  return { sizePt: (num(/<w:sz w:val="(\d+)"/) ?? 0) / 2 || undefined, spaceAfterTw: num(/<w:spacing [^>]*w:after="(\d+)"/), leftMm: mm(num(/<w:ind [^>]*w:left="(\d+)"/)), hangingMm: mm(num(/<w:ind [^>]*w:hanging="(\d+)"/)) };
}

const letters = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const stripTags = (fo) => decode(fo.replace(/<[^>]+>/g, ' ')).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

module.exports = { STENCILS, haveStencils, docxPart, stencilFrontMatter, stencilStyle, letters, stripTags, decode };
