'use strict';
// Extract the S1000D Issue 4.2 "Maintained SNS" tables (Chap 8.2.1 - 8.2.8) into backend/reference/sns-presets-4.2.json.
//
//   node scripts/extract-sns-presets.js <S1000D_Issue_4.2.pdf> [firstPage lastPage]
//
// The tables are read from word COORDINATES (pdftotext -bbox), not from reflowed text, so a title is never confused with the
// definition next to it. A row starts when a word sits in the System or Subsystem column; every other line is a continuation.
// The script then CHECKS itself against the spec's own table captions ("Table N System 21 - Title"): every table must contain
// exactly the system its caption names, with the caption's title. Any mismatch is printed and the script exits non-zero - the
// preset file is never written from a table that does not agree with its caption.
//
// What the preset contains is exactly what the spec prints (system, subsystem "-NN" and, where given, titles/definitions). Rows the
// spec marks "Available for projects" are kept as such (a code range), not expanded.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const pdf = process.argv[2];
if (!pdf || !fs.existsSync(pdf)) { console.error('usage: node scripts/extract-sns-presets.js <S1000D_Issue_4.2.pdf> [first last]'); process.exit(2); }
const first = process.argv[3] || '3081';
const last = process.argv[4] || '3354';

const r = spawnSync('pdftotext', ['-bbox', '-f', first, '-l', last, pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 30 });
if (r.status !== 0) { console.error('pdftotext failed: ' + r.stderr); process.exit(2); }

const CHAPTER = {
  '0100': ['8.2.1', 'Generic'], '0200': ['8.2.2', 'Support and training equipment'], '0300': ['8.2.3', 'Ordnance'],
  '0400': ['8.2.4', 'General communications'], '0500': ['8.2.5', 'Air vehicle, engines and equipment'], '0600': ['8.2.6', 'Tactical missiles'],
  '0700': ['8.2.7', 'General surface vehicles'], '0800': ['8.2.8', 'General sea vehicles'],
};
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const pages = r.stdout.split('<page ').slice(1);
const out = {}; // chapter -> { rows: [], captions: [] }
let cols = null; let curChapter = null; let cur = null; let prevCodeTok = ''; let kind = 'other'; let curCap = null;

const lineKey = (y) => Math.round(y / 3);
for (let pi = 0; pi < pages.length; pi++) {
  const words = [...pages[pi].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g)]
    .map((m) => ({ x: +m[1], y: +m[2], x1: +m[3], w: dec(m[5]) }));
  const footer = words.find((w) => /^S1000D-A-08-02-\d{4}-00A-040A-A$/.test(w.w));
  if (!footer) continue;
  const ch = footer.w.slice(15, 19);
  if (!CHAPTER[ch]) continue;
  if (ch !== curChapter) { curChapter = ch; cols = null; cur = null; kind = 'other'; curCap = null; out[ch] ??= { rows: [], captions: [], index: [] }; }
  const lines = new Map();
  for (const w of words) { const k = lineKey(w.y); if (!lines.has(k)) lines.set(k, []); lines.get(k).push(w); }
  for (const k of [...lines.keys()].sort((a, b) => a - b)) {
    const ws = lines.get(k).sort((a, b) => a.x - b.x);
    const y = ws[0].y;
    if (y < 60 || y > 735) continue;                                    // running header / footer
    const text = ws.map((w) => w.w).join(' ');
    // table caption
    const cap = /^Table (\d+) System (?:category )?([A-Z0-9]{1,3})(?: [-–]|,) (.+)$/.exec(text);
    if (cap) { curCap = { n: +cap[1], system: cap[2], title: cap[3].trim(), page: +first + pi, firstRow: null }; out[ch].captions.push(curCap); kind = 'detail'; cur = null; continue; }
    if (/^Table \d+ /.test(text)) { kind = /index|top level|main systems/i.test(text) ? 'index' : 'other'; curCap = null; cur = null; continue; }
    // column header
    if ((ws[0].w === 'System' || ws[0].w === 'Sys') && ws.some((w) => w.w === 'Title')) {
      const sub = ws.find((w) => /^Sub/.test(w.w));
      const title = ws.find((w) => w.w === 'Title');
      const def = ws.find((w) => w.w === 'Definition' || w.w === 'Description');
      cols = { sys: ws[0].x, sub: sub ? sub.x : null, title: title.x, def: def ? def.x : 1e9 };
      cur = null; prevCodeTok = '';
      continue;
    }
    if (!cols) continue;
    const codeEnd = cols.title - 6;
    const codeWords = ws.filter((w) => w.x < codeEnd);
    const titleWords = ws.filter((w) => w.x >= codeEnd && w.x < cols.def - 3);
    const defWords = ws.filter((w) => w.x >= cols.def - 3);
    let startedRow = false;
    if (codeWords.length) {
      const w0 = codeWords[0];
      const tok = w0.w;
      const isRangeEnd = prevCodeTok === 'thru';
      const isCode = /^-?[A-Z0-9]{1,4}$/.test(tok) && tok !== 'thru';
      if (isRangeEnd) { if (cur) cur.rangeEnd = tok; }
      else if (isCode && cols.sub != null && codeWords.length >= 2 && Math.abs(w0.x - cols.sys) < 5 && Math.abs(codeWords[1].x - cols.sub) < 8 && /^-[A-Z0-9]{2}$/.test(codeWords[1].w)) {
        // a continuation page repeats the system code in front of the subsystem ("08  -50  Static stability")
        const target = kind === 'index' ? out[ch].index : out[ch].rows;
        if (kind === 'detail' && curCap && !curCap.firstRow && curCap.system === tok) {
          // the table prints its single system and first subsystem on ONE row ("M0  -00  Auxiliary ..."): the system's title is the caption's
          const sysRow = { level: 1, code: tok, title: curCap.title, definition: '', fromCaption: true }; target.push(sysRow); curCap.firstRow = sysRow;
        }
        cur = { level: 2, code: codeWords[1].w.replace(/^-/, ''), title: '', definition: '' }; target.push(cur); startedRow = true; }
      else if (isCode && Math.abs(w0.x - cols.sys) < 5) { cur = { level: 1, code: tok, title: '', definition: '' }; (kind === 'index' ? out[ch].index : out[ch].rows).push(cur); if (kind === 'detail' && curCap && !curCap.firstRow) curCap.firstRow = cur; startedRow = true; }
      else if (isCode && cols.sub != null && Math.abs(w0.x - cols.sub) < 8) { cur = { level: 2, code: tok.replace(/^-/, ''), title: '', definition: '' }; (kind === 'index' ? out[ch].index : out[ch].rows).push(cur); startedRow = true; }
      else if (!isCode && tok !== 'thru') { cur = null; }                                    // prose between tables (a heading, a Note) is not part of a row
      prevCodeTok = codeWords[codeWords.length - 1].w;
    } else prevCodeTok = '';
    if (!cur) continue;
    // a line that wraps after "/" or "-" continues the word ("Scheduled/" + "unscheduled"): no space is added there
    const joinTo = (prev, add) => (!prev ? add : /[/-]$/.test(prev) && !/ [-–]$/.test(prev) ? prev + add : prev + ' ' + add);
    if (titleWords.length) cur.title = joinTo(cur.title, titleWords.map((w) => w.w).join(' '));
    if (defWords.length) cur.definition = joinTo(cur.definition, defWords.map((w) => w.w).join(' '));
    void startedRow;
  }
}

// ── build + self-check against the captions ─────────────────────────────────
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const problems = []; const notes = [];
const presets = [];
for (const [ch, d] of Object.entries(out)) {
  const [num, name] = CHAPTER[ch];
  for (const r of [...d.rows, ...d.index]) { r.title = clean(r.title); r.definition = clean(r.definition); }
  const nodes = [];
  let system = null; let group = null; const seen = {};
  for (const row of d.rows) {
    if (row.level === 1) {
      if (row.code.length === 1) {                                     // 8.2.2: a one-letter "system category" groups two-letter systems
        group = row; nodes.push({ level: 0, path: row.code, code: row.code, title: row.title, definition: row.definition, category: true }); system = null; continue;
      }
      system = row;
      // the specification sometimes defines the SAME system code twice (8.2.5: 42, 46, 72). Both definitions are kept, the later under "<code>#2";
      // applying a preset to a project skips them, because choosing between two published definitions is the project's decision.
      seen[row.code] = (seen[row.code] || 0) + 1;
      row.pathCode = seen[row.code] > 1 ? `${row.code}#${seen[row.code]}` : row.code;
      nodes.push({ level: 1, path: row.pathCode, code: row.code, title: row.title, definition: row.definition, ...(seen[row.code] > 1 ? { variant: seen[row.code] } : {}), ...(group && row.code[0] === group.code ? { categoryCode: group.code } : {}) });
    } else if (system) {
      const node = { level: 2, path: `${system.pathCode}/${row.code}`, code: row.code, title: row.title, definition: row.definition, ...(seen[system.code] > 1 ? { variant: seen[system.code] } : {}) };
      if (row.rangeEnd) node.rangeEnd = row.rangeEnd.replace(/^-/, '');
      nodes.push(node);
    }
  }
  const twice = Object.keys(seen).filter((c) => seen[c] > 1);
  for (const n of nodes) if (twice.includes(n.code) || twice.includes(n.path.split('/')[0].split('#')[0])) { n.ambiguous = true; n.variant ??= 1; }
  if (twice.length) notes.push(`${num}: the specification defines system ${twice.join(', ')} more than once; every definition is kept (variant 1, 2 ...) and none is applied automatically`);
  const dup = nodes.map((n) => n.path).filter((p, i, a) => a.indexOf(p) !== i);
  if (dup.length) problems.push(`${num}: duplicate paths ${[...new Set(dup)].join(', ')}`);
  // 1. every captioned table's FIRST row must be the system its caption names (a wrong code means a mis-read table)
  for (const cap of d.captions) {
    if (!cap.firstRow) { problems.push(`${num} Table ${cap.n} (page ${cap.page}): no row was read after the caption (system ${cap.system})`); continue; }
    if (cap.firstRow.code !== cap.system) { problems.push(`${num} Table ${cap.n} (page ${cap.page}): caption names ${cap.system} but the first row is ${cap.firstRow.code}`); continue; }
    const rt = norm(cap.firstRow.title), ct = norm(cap.title);
    if (rt && rt !== ct && !ct.startsWith(rt) && !rt.startsWith(ct)) {
      notes.push(`${num} Table ${cap.n} (page ${cap.page}): system ${cap.system} is "${cap.firstRow.title}" in the table but "${cap.title}" in its caption`);
      const n = nodes.find((x) => x.path === cap.system); if (n) n.captionTitle = cap.title;
    }
  }
  // 2. the chapter's index (when it has one) must agree with the tables on which systems exist
  const detail = new Set(nodes.filter((n) => n.level === 1).map((n) => n.code));
  const indexCodes = d.index.filter((r) => r.level === 1).map((r) => r.code);
  const missing = indexCodes.filter((c) => !detail.has(c) && !/Available for projects|Not available/i.test(d.index.find((r) => r.code === c).title));
  if (missing.length) notes.push(`${num}: the chapter index lists ${missing.join(', ')} but no table describes them`);
  for (const r of d.index.filter((x) => x.level === 1)) {
    const n = nodes.find((x) => x.path === r.code);
    if (n && norm(n.title) !== norm(r.title) && !norm(n.title).startsWith(norm(r.title)) && !norm(r.title).startsWith(norm(n.title))) {
      notes.push(`${num}: system ${r.code} is "${r.title}" in the chapter index but "${n.title}" in its table`);
      n.indexTitle = r.title;
    }
  }
  presets.push({ chapter: num, name, nodes, captions: d.captions.length, index: d.index.length });
}

for (const p of presets) {
  const sys = p.nodes.filter((n) => n.level === 1).length; const sub = p.nodes.filter((n) => n.level === 2).length; const grp = p.nodes.filter((n) => n.category).length;
  console.log(`${p.chapter} ${p.name}: ${sys} systems${grp ? ` (+${grp} categories)` : ''}, ${sub} subsystem entries, ${p.captions} captioned tables, ${p.index} index rows`);
}
if (notes.length) console.log(`\n${notes.length} inconsistencies INSIDE the specification (kept as printed, recorded in the file):\n` + notes.join('\n'));
if (problems.length) { console.error('\nSELF-CHECK FAILED:\n' + problems.join('\n')); process.exitCode = 1; }
const file = path.join(__dirname, '..', 'reference', 'sns-presets-4.2.json');
if (process.exitCode !== 1 || process.env.FORCE) {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
  fs.writeFileSync(file, JSON.stringify({
    provenance: { document: 'S1000D Issue 4.2, Chap 8.2.1 - 8.2.8 "Maintained SNS"', file: path.basename(pdf), sha256: sha, pages: `${first}-${last}`, extractedBy: 'scripts/extract-sns-presets.js (word coordinates, self-checked against table captions)' },
    limitation: 'Issue 4.2 only: no Issue 5.0, 6 or 7 specification text is available to this project. These are the SNS the S1000D Steering Committee maintains for generic and product-group use; a project may decide not to use them (Chap 8.2.1). Subsystem entries are the two-character "-NN" codes the tables print (subsystem + sub-subsystem). Rows the spec marks "Available for projects" keep their code range. Where the specification disagrees with itself (a table caption, chapter index and table giving different titles) the table row is used and the other wording is kept as captionTitle / indexTitle.',
    specInconsistencies: notes,
    presets: presets.map(({ chapter, name, nodes }) => ({ chapter, name, nodes })),
  }, null, 1));
  console.log('wrote ' + file);
}
