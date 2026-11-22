'use strict';
// A tiny PDF writer for the structure-recovery tests: pages of positioned Helvetica text, nothing else.
// Enough for pdfjs to report text items with their positions - which is all the recovery reads.

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** pages: [{ items: [{ x, y, text, size = 10, rotate = false }] }] */
function makePdf(pages, { width = 595.275, height = 841.889 } = {}) {
  const objects = [];                       // index = object number - 1
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add('');                  // 1, filled below
  const pagesObj = add('');                 // 2
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const page of pages) {
    const ops = page.items.map((it) => {
      const size = it.size || 10;
      const tm = it.rotate ? `0 1 -1 0 ${it.x} ${it.y}` : `1 0 0 1 ${it.x} ${it.y}`;
      return `BT /F1 ${size} Tf ${tm} Tm (${esc(it.text)}) Tj ET`;
    }).join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  objects[catalog - 1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A generated "Table of contents" the way the Xignal builder lays it out: title | code | date columns, a decoy footer. */
function tocPages(rows, { perPage = 12, height = 841.889, issue = { number: '001', date: '2026-08-17', draft: '001-01' } } = {}) {
  const pages = [{ items: [{ x: 60, y: 400, text: 'Cover page' }] }];
  const chunks = [];
  for (let i = 0; i < rows.length; i += perPage) chunks.push(rows.slice(i, i + perPage));
  chunks.forEach((chunk, p) => {
    const items = [{ x: 42.5, y: height - 40, text: 'TST-00001-00' }];
    if (p === 0) {
      items.push({ x: 42, y: height - 80, text: 'Table of contents', size: 14 });
      items.push({ x: 42, y: height - 100, text: `The listed documents are included in issue ${issue.number}, dated ${issue.date}, of this publication.` });
      items.push({ x: 20, y: 300, rotate: true, text: `This is a draft copy of Issue ${issue.draft}` });
    }
    items.push({ x: 43, y: 723, text: 'Document title' }, { x: 205, y: 723, text: 'Data module code' }, { x: 205, y: 709, text: 'Publication module code' }, { x: 378, y: 723, text: 'Issue date' });
    chunk.forEach((row, k) => {
      const y = 690 - k * 40;
      if (row.fused) items.push({ x: 43, y, text: `${row.title} ${row.code}` });
      else items.push({ x: 43, y, text: row.title }, { x: 205, y, text: row.code });
      items.push({ x: 378, y, text: row.date || '2026-04-18' });
    });
    // The footer of a generated page prints two module codes ON TOP OF EACH OTHER; it sits below the table.
    items.push({ x: 150, y: 40, text: 'TST-A-00-00-00-00A-001A-D' }, { x: 152, y: 40, text: 'TST-A-10-00-00-00A-040A-D' });
    pages.push({ items });
  });
  pages.push({ items: [{ x: 200, y: 400, text: 'Intentionally left blank.' }] });
  pages.push({ items: [{ x: 60, y: 700, text: 'Chapter 1 Introduction. TST-A-10-00-00-00A-040A-D is described later.' }] });
  return pages;
}

module.exports = { makePdf, tocPages };
