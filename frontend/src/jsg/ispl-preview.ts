// The stencil-style page preview of the JSG Illustrated Spare Parts List editor.
//
// It draws the pages of one plate the way the JSG engine sets them (backend/schemas/jsg/engine/jsg-ispl.xsl): landscape A4 (296.9 x 210 mm, margins 24 / 25 / 15 / 15), RESTRICTED in
// the head and the page number over RESTRICTED in the foot, the red bold 14 pt plate caption, the picture(s) with their labels, the red view caption, the index of sub-plates on
// the first plate, and the parts table with the stencil's column widths (11 columns with a "for 1 set" column, else 10) in Times New Roman 12 pt.
//
// It is a PREVIEW, not the PDF: where a long table breaks onto the next page is ESTIMATED here from the length of the cells; the PDF beside the editor is the exact result.
// Pictures are shown as they are - the item numbers (callouts) of an exploded view are part of the picture file, as in the Word stencil; the preview does not draw its own.
//
// JSG only: nothing here is shared with the JSS editor or the S1000D Studio.

import { PART_COLUMNS, parentRef, type JsgDoc, type PartRow, type Plate, type PlateView } from './model';
import { escH, injectCss } from './shared';

/** The engine's table widths in Word twips (jsg-ispl.xsl): the proportions of the columns. */
export const W11 = [704, 992, 708, 2411, 2551, 1135, 1132, 1843, 1135, 1419, 1098];
export const W10 = [705, 1132, 711, 2411, 3119, 850, 1985, 1147, 1262, 1806];
const TABLE_MM = 266.9;           // the body width of a landscape page: 296.9 - 15 - 15
const BODY_MM = 161;              // its height: 210 - 24 - 25
const CAPTION_MM = 14;            // the plate caption and its space
const HEADER_ROW_MM = 19;        // the three-line header row (12 pt)
const ROW_MM = 8.2;               // one line of 12 pt text in a cell with its padding
const LINE_MM = 5.6;              // each further line a long cell wraps to
const CHAR_MM = 2.0;              // an average Times New Roman 12 pt character

export type PageKind = 'divider' | 'picture' | 'table';
export interface PageSpec {
  kind: PageKind; n: number; plate: Plate; view?: PlateView; viewNo?: number;
  rows?: PartRow[]; continued?: boolean; index?: Plate[]; setColumn: boolean;
}

export const plateCaption = (p: Plate): string => p.caption || `PLATE – ${p.ref} ${p.title.toUpperCase()}`;
export const columnsOf = (setColumn: boolean): typeof PART_COLUMNS => PART_COLUMNS.filter((c) => !c.set || setColumn);

/** The sub-plates listed on a divider plate: those whose reference is this one plus "-X" (not deeper ones). */
export function childrenOf(doc: JsgDoc, p: Plate): Plate[] {
  return doc.plates.filter((x) => parentRef(x.ref) === p.ref && !x.ref.slice(p.ref.length + 1).includes('/') && !x.ref.slice(p.ref.length + 1).includes('-'));
}

/** How tall a part row prints: one line, plus a line for each time the longest wrapping cell (designation, remark, NSN ...) has to wrap. */
export function rowHeightMm(r: PartRow, setColumn: boolean): number {
  const w = setColumn ? W11 : W10; const total = w.reduce((a, b) => a + b, 0);
  const cols = columnsOf(setColumn); let lines = 1;
  cols.forEach((c, i) => {
    const mm = (w[i] / total) * TABLE_MM - 2;                        // less the cell padding
    const perLine = Math.max(1, Math.floor(mm / CHAR_MM));
    lines = Math.max(lines, Math.ceil(Math.max(1, String(r[c.key] ?? '').length) / perLine));
  });
  return ROW_MM + (lines - 1) * LINE_MM;
}

/** Split a view's parts over the pages their table needs (estimated). */
export function paginateParts(parts: PartRow[], setColumn: boolean): PartRow[][] {
  if (!parts.length) return [];
  const avail = BODY_MM - CAPTION_MM - HEADER_ROW_MM;
  const pages: PartRow[][] = [[]]; let used = 0;
  for (const r of parts) {
    const h = rowHeightMm(r, setColumn);
    if (used + h > avail && pages[pages.length - 1].length) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(r); used += h;
  }
  return pages;
}

/** The pages of one plate, numbered as the PDF numbers them (the first plate's first page is page 1). */
export function platePages(doc: JsgDoc, plateIndex: number): PageSpec[] {
  const out: PageSpec[] = []; let n = 1;
  doc.plates.forEach((p, i) => {
    const mine: PageSpec[] = []; const set = p.setColumn;
    if (p.divider) mine.push({ kind: 'divider', n: 0, plate: p, setColumn: set });
    p.views.forEach((v, vi) => {
      mine.push({ kind: 'picture', n: 0, plate: p, view: v, viewNo: vi + 1, setColumn: set, index: p.divider && vi === 0 ? childrenOf(doc, p) : undefined });
      paginateParts(v.parts, set).forEach((rows, k) => mine.push({ kind: 'table', n: 0, plate: p, view: v, viewNo: vi + 1, rows, continued: k > 0, setColumn: set }));
    });
    for (const m of mine) m.n = n++;
    if (i === plateIndex) out.push(...mine);
  });
  return out;
}

const CSS = `
.jsg-pv{background:var(--preview-canvas);padding:10px 10px 30px;min-height:100%;box-sizing:border-box;font:12px system-ui,sans-serif}
.jsg-pv-head{display:flex;gap:6px;align-items:center;color:var(--preview-text);margin:0 0 8px;flex-wrap:wrap}
.jsg-pv-head select,.jsg-pv-head button{font:12px system-ui;border-radius:3px;border:1px solid var(--preview-control-line);padding:2px 6px;background:var(--preview-control-bg);color:var(--preview-control-ink)}
.jsg-pv-note{color:var(--preview-note);font-size:11px;margin:2px 0 10px}
.jsg-pv-tag{color:var(--preview-note);font-size:11px;margin:10px 0 3px}
.jsg-pv-wrap{position:relative;margin:0 auto}
.jsg-pv-page{position:absolute;left:0;top:0;width:296.9mm;height:210mm;background:var(--paper);color:var(--paper-ink);box-shadow:var(--preview-page-shadow);transform-origin:top left;overflow:hidden;font:12pt var(--font-paper-serif)}
.jsg-pv-page .h{position:absolute;left:0;right:0;top:15mm;text-align:center;font-size:9pt;line-height:1.15}
.jsg-pv-page .h span{display:block;font-size:10pt}
.jsg-pv-page .f span{display:block}.jsg-pv-page .f{position:absolute;left:0;right:0;bottom:15mm;text-align:center;font-size:10pt}
.jsg-pv-page .b{position:absolute;left:15mm;right:15mm;top:20mm;bottom:20mm;overflow:hidden}
.jsg-pv-page .cap{color:var(--paper-caption);font-weight:bold;font-size:14pt;text-align:center;margin:0 0 12pt}
.jsg-pv-page .vcap{color:var(--paper-caption);font-weight:bold;font-size:14pt;text-align:center;margin-top:8pt}
.jsg-pv-page .big{text-align:center;font-weight:bold;font-size:36pt;color:var(--paper-heading);line-height:1.3;margin-top:30mm}
.jsg-pv-page .pic{text-align:center}.jsg-pv-page .pic img{object-fit:contain}
.jsg-pv-page .grid{display:grid;gap:2mm;justify-items:center}
.jsg-pv-page .grid div{font-size:10pt;text-align:center}
.jsg-pv-page table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:12pt}
.jsg-pv-page td,.jsg-pv-page th{border:.5pt solid var(--paper-ink);padding:3.7pt 5.4pt;line-height:15.8pt;vertical-align:middle;overflow:hidden;word-wrap:break-word}
.jsg-pv-page th{font-weight:bold;text-align:center}.jsg-pv-page th small{display:block;font-size:6.5pt}
.jsg-pv-empty{color:var(--preview-empty);text-align:center;margin-top:30mm;font-size:12pt}
`;

const mm = (v: number): string => `${v}mm`;

function pictures(v: PlateView, imageUrl: (src: string) => string): HTMLElement {
  const n = v.graphics.length; const box = document.createElement('div');
  if (!n) { box.className = 'jsg-pv-empty'; box.textContent = '(no picture)'; return box; }
  const cols = n <= 1 ? 1 : n === 2 || n === 4 ? 2 : 3; const h = n <= 1 ? 115 : n <= 3 ? 75 : 42;
  if (n === 1) { box.className = 'pic'; box.innerHTML = `<img src="${escH(imageUrl(v.graphics[0].src))}" alt="" style="width:${mm(TABLE_MM)};height:${mm(h)}">`; return box; }
  box.className = 'grid'; box.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  for (const g of v.graphics) { const c = document.createElement('div'); c.innerHTML = `<img src="${escH(imageUrl(g.src))}" alt="" style="width:${mm(Math.floor(TABLE_MM / cols) - 6)};height:${mm(h)};object-fit:contain"><div>${escH(g.label ?? '')}&nbsp;</div>`; box.appendChild(c); }
  return box;
}

function indexTable(kids: Plate[]): string {
  if (!kids.length) return '';
  const rows = kids.map((k) => `<tr><td style="text-align:center">${escH(k.ref)}</td><td style="text-align:center">${escH(k.title)}</td></tr>`).join('');
  return `<table style="margin-top:10pt"><colgroup><col style="width:45.8%"><col style="width:54.2%"></colgroup><tr><th>Plate Ref. No.</th><th>Designation</th></tr>${rows}</table>`;
}

function partsTable(rows: PartRow[], set: boolean, unit: string): string {
  const w = set ? W11 : W10; const total = w.reduce((a, b) => a + b, 0); const cols = columnsOf(set);
  const label = (key: string): string => {
    if (key === 'item') return 'Item No.'; if (key === 'plateRef') return 'Plate Ref. No.'; if (key === 'provide') return '‘P’<small>Provide</small>';
    if (key === 'qty') return set && unit ? `No. Off (${escH(unit)})` : 'No. Off'; if (key === 'qtySet') return 'No. Off (For 1 Set)';
    return ({ nsn: 'NSN', designation: 'Designation', drg: 'Drg. No.', firmPart: 'Firms Part No.', price: 'Unit Price Rs.', remark: 'Remark' } as Record<string, string>)[key] ?? key;
  };
  const head = cols.map((c, i) => `<th style="width:${(w[i] / total) * 100}%;${c.key === 'designation' ? 'text-align:left' : ''}">${label(c.key)}</th>`).join('');
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td style="text-align:${c.key === 'designation' || c.key === 'remark' ? 'left' : c.key === 'price' ? 'right' : 'center'}">${escH(String(r[c.key] ?? '')) || '&nbsp;'}</td>`).join('')}</tr>`).join('');
  return `<table><tr>${head}</tr>${body}</table>`;
}

/** One landscape page, at its real size (296.9 x 210 mm); the caller scales it. */
export function renderPage(spec: PageSpec, doc: JsgDoc, classification: string, imageUrl: (src: string) => string): HTMLElement {
  const page = document.createElement('div'); page.className = 'jsg-pv-page'; page.dataset.kind = spec.kind; page.dataset.n = String(spec.n);
  page.innerHTML = `<div class="h">${escH(classification)}</div><div class="b"></div><div class="f"><span>(${spec.n})</span>${escH(classification)}</div>`;
  const body = page.querySelector('.b') as HTMLElement; const p = spec.plate;
  if (spec.kind === 'divider') {
    body.innerHTML = `<div class="big">PLATE – ${escH(p.ref)}<br>${escH(p.title.toUpperCase())}<div style="margin-top:8pt">${escH((doc.meta.projectName ?? '').toUpperCase())}</div></div>`;
  } else if (spec.kind === 'picture' && spec.view) {
    body.innerHTML = `<div class="cap">${escH(plateCaption(p))}</div>`;
    body.appendChild(pictures(spec.view, imageUrl));
    if (spec.view.caption) { const c = document.createElement('div'); c.className = 'vcap'; c.textContent = spec.view.caption; body.appendChild(c); }
    if (spec.index?.length) body.insertAdjacentHTML('beforeend', indexTable(spec.index));
  } else if (spec.kind === 'table') {
    body.innerHTML = `<div class="cap">${escH(plateCaption(p))}</div>${partsTable(spec.rows ?? [], spec.setColumn, doc.meta.qtyUnit ?? '')}`;
  }
  return page;
}

export interface PreviewHandle { update(doc: JsgDoc, plateIndex: number): void; destroy(): void }

/** Mount the preview in `host`; `update` redraws it (cheap enough to call on every keystroke after a short delay). */
export function mountIsplPreview(host: HTMLElement, imageUrl: (src: string) => string, onPick: (plateIndex: number) => void): PreviewHandle {
  injectCss('jsg-ispl-preview-css', CSS);
  host.innerHTML = '';
  const root = document.createElement('div'); root.className = 'jsg-pv'; host.appendChild(root);
  const head = document.createElement('div'); head.className = 'jsg-pv-head'; root.appendChild(head);
  const note = document.createElement('div'); note.className = 'jsg-pv-note'; note.textContent = 'Page preview in the stencil’s layout. Where a long table breaks onto the next page is estimated; the PDF is exact.'; root.appendChild(note);
  const pagesBox = document.createElement('div'); root.appendChild(pagesBox);
  let last: { doc: JsgDoc; idx: number } | null = null;
  const PX_W = 296.9 * 3.7795; const PX_H = 210 * 3.7795;

  const draw = (): void => {
    if (!last) return; const { doc, idx } = last;
    head.innerHTML = '';
    const sel = document.createElement('select'); sel.title = 'The plate shown';
    doc.plates.forEach((p, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${p.ref}  ${p.title}`; if (i === idx) o.selected = true; sel.appendChild(o); });
    sel.onchange = () => onPick(Number(sel.value)); head.append(document.createTextNode('Plate '), sel);
    pagesBox.innerHTML = '';
    const pages = doc.plates[idx] ? platePages(doc, idx) : [];
    if (!pages.length) { const e = document.createElement('div'); e.className = 'jsg-pv-empty'; e.textContent = doc.plates.length ? 'This plate has no pages yet: add a view.' : 'No plates yet.'; pagesBox.appendChild(e); return; }
    const scale = Math.max(0.2, Math.min(1, (root.clientWidth - 24) / PX_W || 0.5));
    note.textContent = root.clientWidth < 520
      ? 'Narrow: the pages are small. Switch the page to “Editor” (top right) to give the grid and this preview the full width. Long-table page breaks are estimated; the PDF is exact.'
      : 'Page preview in the stencil’s layout. Where a long table breaks onto the next page is estimated; the PDF is exact.';
    const cls = (doc.meta.classification ?? '').trim() || 'RESTRICTED';
    for (const spec of pages) {
      const tag = document.createElement('div'); tag.className = 'jsg-pv-tag';
      tag.textContent = `Page ${spec.n} · ${spec.kind === 'divider' ? 'plate page' : spec.kind === 'picture' ? `view ${spec.viewNo}, picture page` : `view ${spec.viewNo}, parts table${spec.continued ? ' (continued)' : ''}`}`;
      const wrap = document.createElement('div'); wrap.className = 'jsg-pv-wrap'; wrap.style.width = `${PX_W * scale}px`; wrap.style.height = `${PX_H * scale}px`;
      const page = renderPage(spec, doc, cls, imageUrl); page.style.transform = `scale(${scale})`; wrap.appendChild(page);
      pagesBox.append(tag, wrap);
    }
  };
  let lastWidth = 0;          // a redraw changes the height, never the width: only a new width needs the pages scaled again
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (root.clientWidth !== lastWidth) { lastWidth = root.clientWidth; draw(); } }) : null; ro?.observe(root);
  return { update(doc, idx) { last = { doc, idx }; draw(); }, destroy() { ro?.disconnect(); host.innerHTML = ''; } };
}
