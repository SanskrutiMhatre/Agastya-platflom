/**
 * CALS table model (S1000D table/tgroup/colspec/thead/tbody/row/entry) with
 * span-aware grid computation and structural table operations.
 */
import type { Grammar } from './grammar';
import { OpError, createSkeleton, startOf } from './ops';
import { createEl, elementChildren } from './xml';
import { colWeight, colWidthKind, formatLengthPx, lengthUnit } from './units';
import type { ModelPos } from './document';

export interface Cell {
  entry: Element;
  row: number;
  col: number;
  colspan: number;
  rowspan: number;
}

export interface Grid {
  tgroup: Element;
  cols: number;
  colspecs: Element[];
  colNames: string[];
  rows: Element[];
  cells: Cell[];
  at: (Cell | null)[][];
  cellOf: Map<Element, Cell>;
}

export function tgroupOf(n: Node | null): Element | null {
  for (let c: Node | null = n; c && c.nodeType !== 9; c = c.parentNode) if (c.nodeName === 'tgroup') return c as Element;
  return null;
}

export function entryOf(n: Node | null): Element | null {
  for (let c: Node | null = n; c && c.nodeType !== 9; c = c.parentNode) {
    if (c.nodeName === 'entry') return c as Element;
    if (c.nodeName === 'tgroup') return null;
  }
  return null;
}

export function tableOf(n: Node | null): Element | null {
  for (let c: Node | null = n; c && c.nodeType !== 9; c = c.parentNode) if (c.nodeName === 'table') return c as Element;
  return null;
}

function sections(tg: Element): Element[] {
  const kids = elementChildren(tg);
  const order = ['thead', 'tbody', 'tfoot'];
  // display order: thead, tbody, tfoot (tfoot precedes tbody in the source)
  return order.flatMap((n) => kids.filter((k) => k.nodeName === n));
}

export function buildGrid(tg: Element): Grid {
  const colspecs = elementChildren(tg).filter((e) => e.nodeName === 'colspec');
  const spanspecs = elementChildren(tg).filter((e) => e.nodeName === 'spanspec');
  let cols = parseInt(tg.getAttribute('cols') ?? '0', 10) || 0;
  const colNames: string[] = [];
  let ci = 0;
  for (const cs of colspecs) {
    const num = parseInt(cs.getAttribute('colnum') ?? '', 10);
    if (num > 0) ci = num - 1;
    colNames[ci] = cs.getAttribute('colname') ?? '';
    ci++;
  }
  cols = Math.max(cols, colNames.length);
  const nameIdx = new Map<string, number>();
  colNames.forEach((n, i) => n && nameIdx.set(n, i));
  const spanIdx = new Map<string, [string, string]>();
  for (const s of spanspecs) spanIdx.set(s.getAttribute('spanname') ?? '', [s.getAttribute('namest') ?? '', s.getAttribute('nameend') ?? '']);

  const rows: Element[] = [];
  for (const sec of sections(tg)) for (const r of elementChildren(sec)) if (r.nodeName === 'row') rows.push(r);
  const at: (Cell | null)[][] = rows.map(() => []);
  const cells: Cell[] = [];
  const cellOf = new Map<Element, Cell>();
  rows.forEach((row, r) => {
    let next = 0;
    for (const entry of elementChildren(row)) {
      if (entry.nodeName !== 'entry' && entry.nodeName !== 'entrytbl') continue;
      let start = -1;
      let end = -1;
      const cn = entry.getAttribute('colname');
      const ns = entry.getAttribute('namest');
      const ne = entry.getAttribute('nameend');
      const sp = entry.getAttribute('spanname');
      if (sp && spanIdx.has(sp)) {
        const [a, b] = spanIdx.get(sp)!;
        start = nameIdx.get(a) ?? -1;
        end = nameIdx.get(b) ?? start;
      } else if (ns && nameIdx.has(ns)) {
        start = nameIdx.get(ns)!;
        end = ne && nameIdx.has(ne) ? nameIdx.get(ne)! : start;
      } else if (cn && nameIdx.has(cn)) {
        start = end = nameIdx.get(cn)!;
      }
      if (start < 0) {
        while (at[r][next]) next++;
        start = end = next;
      }
      if (end < start) [start, end] = [end, start];
      const rowspan = (parseInt(entry.getAttribute('morerows') ?? '0', 10) || 0) + 1;
      const cell: Cell = { entry, row: r, col: start, colspan: end - start + 1, rowspan };
      cells.push(cell);
      cellOf.set(entry, cell);
      for (let rr = r; rr < Math.min(rows.length, r + rowspan); rr++) {
        for (let cc = start; cc <= end; cc++) at[rr][cc] = cell;
      }
      next = end + 1;
      cols = Math.max(cols, end + 1);
    }
  });
  for (const row of at) for (let c = 0; c < cols; c++) row[c] = row[c] ?? null;
  return { tgroup: tg, cols, colspecs, colNames, rows, cells, at, cellOf };
}

/** Ensures every column has a named colspec (col1..colN), creating colspecs as needed. */
export function ensureColNames(tg: Element): Grid {
  let grid = buildGrid(tg);
  const doc = tg.ownerDocument!;
  const used = new Set(grid.colNames.filter(Boolean));
  const existing = grid.colspecs;
  const insertRef = elementChildren(tg).find((e) => e.nodeName !== 'colspec') ?? null;
  const byIdx: Element[] = [];
  let ci = 0;
  for (const cs of existing) {
    const num = parseInt(cs.getAttribute('colnum') ?? '', 10);
    if (num > 0) ci = num - 1;
    byIdx[ci] = cs;
    ci++;
  }
  let changed = false;
  for (let i = 0; i < grid.cols; i++) {
    let cs = byIdx[i];
    if (!cs) {
      cs = createEl(doc, 'colspec');
      // insert in column order
      const after = byIdx.slice(0, i).filter(Boolean).pop();
      tg.insertBefore(cs, after ? after.nextSibling : (existing[0] ?? insertRef));
      byIdx[i] = cs;
      changed = true;
    }
    if (!cs.getAttribute('colname')) {
      let n = i + 1;
      while (used.has('col' + n)) n++;
      cs.setAttribute('colname', 'col' + n);
      used.add('col' + n);
      changed = true;
    }
    if (cs.hasAttribute('colnum') && cs.getAttribute('colnum') !== String(i + 1)) cs.setAttribute('colnum', String(i + 1));
  }
  if (changed) grid = buildGrid(tg);
  // pin every entry to explicit columns so later structural edits are unambiguous
  for (const cell of grid.cells) pinEntry(cell, grid);
  return buildGrid(tg);
}

function pinEntry(cell: Cell, grid: Grid) {
  const e = cell.entry;
  if (e.getAttribute('spanname')) return;
  if (cell.colspan > 1) {
    e.removeAttribute('colname');
    e.setAttribute('namest', grid.colNames[cell.col]);
    e.setAttribute('nameend', grid.colNames[cell.col + cell.colspan - 1]);
  } else {
    if (!e.getAttribute('colname') && !e.getAttribute('namest')) e.setAttribute('colname', grid.colNames[cell.col]);
  }
}

function setSpan(entry: Element, grid: Grid, start: number, end: number) {
  entry.removeAttribute('spanname');
  if (end > start) {
    entry.removeAttribute('colname');
    entry.setAttribute('namest', grid.colNames[start]);
    entry.setAttribute('nameend', grid.colNames[end]);
  } else {
    entry.removeAttribute('namest');
    entry.removeAttribute('nameend');
    entry.setAttribute('colname', grid.colNames[start]);
  }
}

/**
 * Makes `cell` cover `colspan` × `rowspan` grid positions: the entries it now covers are removed (the caller has taken their
 * content), and the span attributes are written. `grid` must be the grid the cells were read from.
 */
export function coverCells(grid: Grid, cell: Cell, colspan: number, rowspan: number): void {
  for (let r = cell.row; r < cell.row + rowspan; r++) {
    for (let c = cell.col; c < cell.col + colspan; c++) {
      const x = grid.at[r]?.[c];
      if (x && x !== cell) x.entry.parentNode?.removeChild(x.entry);
    }
  }
  if (colspan > 1) setSpan(cell.entry, grid, cell.col, cell.col + colspan - 1);
  if (rowspan > 1) setMoreRows(cell.entry, rowspan - 1);
}

function setMoreRows(entry: Element, n: number) {
  if (n > 0) entry.setAttribute('morerows', String(n));
  else entry.removeAttribute('morerows');
}

export function newEntry(doc: Document, g: Grammar | null): Element {
  const e = createEl(doc, 'entry');
  if (!g || !g.allowsText('entry')) e.appendChild(createSkeleton(doc, g, 'para'));
  return e;
}

/** Inserts `entry` into `row` keeping entries in column order. */
function placeInRow(row: Element, entry: Element, col: number, grid: Grid) {
  for (const e of elementChildren(row)) {
    const c = grid.cellOf.get(e);
    if (c && c.col > col) {
      row.insertBefore(entry, e);
      return;
    }
  }
  row.appendChild(entry);
}

function cellOrThrow(entry: Element): { grid: Grid; cell: Cell } {
  const tg = tgroupOf(entry);
  if (!tg) throw new OpError('Not inside a table');
  const grid = ensureColNames(tg);
  const cell = grid.cellOf.get(entry);
  if (!cell) throw new OpError('Cell not found in table grid');
  return { grid, cell };
}

export function insertRow(entry: Element, where: 'above' | 'below', g: Grammar | null): Element {
  const { grid, cell } = cellOrThrow(entry);
  const doc = entry.ownerDocument!;
  const refRowIdx = where === 'above' ? cell.row : cell.row + cell.rowspan - 1;
  const refRow = grid.rows[refRowIdx];
  const newRowIdx = where === 'above' ? refRowIdx : refRowIdx + 1;
  const row = createEl(doc, 'row');
  for (const a of Array.from(refRow.attributes)) if (a.name !== 'id') row.setAttribute(a.name, a.value);
  const handled = new Set<Cell>();
  for (let c = 0; c < grid.cols; c++) {
    // a cell crossing the boundary between newRowIdx-1 and newRowIdx is extended
    const above = newRowIdx > 0 ? grid.at[newRowIdx - 1][c] : null;
    if (above && above.row + above.rowspan - 1 >= newRowIdx && above.row < newRowIdx && sameSection(grid.rows[above.row], refRow)) {
      if (!handled.has(above)) {
        setMoreRows(above.entry, above.rowspan);
        handled.add(above);
      }
      continue;
    }
    const e = newEntry(doc, g);
    e.setAttribute('colname', grid.colNames[c]);
    row.appendChild(e);
  }
  refRow.parentNode!.insertBefore(row, where === 'above' ? refRow : refRow.nextSibling);
  return row;
}

function sameSection(a: Element, b: Element) { return a.parentNode === b.parentNode; }

export function deleteRow(entry: Element): void {
  const { grid, cell } = cellOrThrow(entry);
  const r = cell.row;
  const row = grid.rows[r];
  const section = row.parentNode as Element;
  const sectionRows = elementChildren(section).filter((e) => e.nodeName === 'row');
  if (section.nodeName === 'tbody' && sectionRows.length === 1) throw new OpError('A table body needs at least one row; delete the table instead');
  const nextRow = grid.rows[r + 1];
  const seen = new Set<Cell>();
  for (let c = 0; c < grid.cols; c++) {
    const x = grid.at[r][c];
    if (!x || seen.has(x)) continue;
    seen.add(x);
    if (x.rowspan > 1) {
      if (x.row === r) {
        // move the spanning entry down into the next row
        if (nextRow && sameSection(nextRow, row)) {
          setMoreRows(x.entry, x.rowspan - 2);
          placeInRow(nextRow, x.entry, x.col, grid);
        }
      } else setMoreRows(x.entry, x.rowspan - 2);
    }
  }
  section.removeChild(row);
  if (elementChildren(section).filter((e) => e.nodeName === 'row').length === 0 && section.nodeName !== 'tbody') section.parentNode!.removeChild(section);
}

function renumberColspecs(tg: Element) {
  const specs = elementChildren(tg).filter((e) => e.nodeName === 'colspec');
  if (specs.some((s) => s.hasAttribute('colnum'))) specs.forEach((s, i) => s.setAttribute('colnum', String(i + 1)));
  tg.setAttribute('cols', String(specs.length));
}

export function insertColumn(entry: Element, where: 'left' | 'right', g: Grammar | null): string {
  const { grid, cell } = cellOrThrow(entry);
  const doc = entry.ownerDocument!;
  const tg = grid.tgroup;
  const k = where === 'left' ? cell.col : cell.col + cell.colspan;
  const used = new Set(grid.colNames);
  let n = grid.cols + 1;
  while (used.has('col' + n)) n++;
  const name = 'col' + n;
  const cs = createEl(doc, 'colspec');
  cs.setAttribute('colname', name);
  const refSpec = grid.colspecs[k] ?? null;
  const lastSpec = grid.colspecs[grid.colspecs.length - 1];
  tg.insertBefore(cs, refSpec ?? (lastSpec ? lastSpec.nextSibling : tg.firstChild));
  renumberColspecs(tg);
  grid.rows.forEach((row, r) => {
    const left = k > 0 ? grid.at[r][k - 1] : null;
    const right = k < grid.cols ? grid.at[r][k] : null;
    // inside a horizontal span (namest..nameend): the span grows automatically
    if (left && left === right) return;
    const e = newEntry(doc, g);
    e.setAttribute('colname', name);
    // placement: before the first entry whose column >= k
    let placed = false;
    for (const ex of elementChildren(row)) {
      const c = grid.cellOf.get(ex);
      if (c && c.col >= k) {
        row.insertBefore(e, ex);
        placed = true;
        break;
      }
    }
    if (!placed) row.appendChild(e);
  });
  return name;
}

export function deleteColumn(entry: Element): void {
  const { grid, cell } = cellOrThrow(entry);
  if (grid.cols <= 1) throw new OpError('A table needs at least one column; delete the table instead');
  const c = cell.col;
  const name = grid.colNames[c];
  const seen = new Set<Cell>();
  for (let r = 0; r < grid.rows.length; r++) {
    const x = grid.at[r][c];
    if (!x || seen.has(x)) continue;
    seen.add(x);
    if (x.colspan === 1) x.entry.parentNode?.removeChild(x.entry);
    else {
      const start = x.col === c ? x.col + 1 : x.col;
      const end = x.col + x.colspan - 1 === c ? c - 1 : x.col + x.colspan - 1;
      setSpan(x.entry, grid, start, end);
    }
  }
  const spec = grid.colspecs.find((s) => s.getAttribute('colname') === name);
  spec?.parentNode?.removeChild(spec);
  // spanspecs referring to the column
  for (const sp of elementChildren(grid.tgroup).filter((e) => e.nodeName === 'spanspec')) {
    if (sp.getAttribute('namest') === name || sp.getAttribute('nameend') === name) sp.parentNode!.removeChild(sp);
  }
  renumberColspecs(grid.tgroup);
  dropEmptyRows(grid.tgroup);
}

function moveContent(from: Element, to: Element) {
  const hasContent = (e: Element) => /\S/.test(e.textContent ?? '') || elementChildren(e).some((k) => k.nodeName !== 'para');
  if (!hasContent(from)) return;
  if (!hasContent(to)) while (to.firstChild) to.removeChild(to.firstChild);
  while (from.firstChild) to.appendChild(from.firstChild);
}

export function mergeRight(entry: Element): void {
  const { grid, cell } = cellOrThrow(entry);
  const nc = cell.col + cell.colspan;
  if (nc >= grid.cols) throw new OpError('There is no cell to the right');
  const right = grid.at[cell.row][nc];
  if (!right || right.row !== cell.row || right.rowspan !== cell.rowspan) throw new OpError('Cells must span the same rows to be merged');
  moveContent(right.entry, entry);
  right.entry.parentNode!.removeChild(right.entry);
  setSpan(entry, grid, cell.col, right.col + right.colspan - 1);
}

export function mergeDown(entry: Element): void {
  const { grid, cell } = cellOrThrow(entry);
  const nr = cell.row + cell.rowspan;
  if (nr >= grid.rows.length) throw new OpError('There is no cell below');
  if (!sameSection(grid.rows[nr], grid.rows[cell.row])) throw new OpError('Cells in different table sections cannot be merged');
  const below = grid.at[nr][cell.col];
  if (!below || below.col !== cell.col || below.colspan !== cell.colspan || below.row !== nr) throw new OpError('Cells must span the same columns to be merged');
  moveContent(below.entry, entry);
  below.entry.parentNode!.removeChild(below.entry);
  setMoreRows(entry, cell.rowspan + below.rowspan - 1);
  dropEmptyRows(grid.tgroup);
}

export function splitCell(entry: Element, g: Grammar | null): void {
  const { grid, cell } = cellOrThrow(entry);
  if (cell.colspan === 1 && cell.rowspan === 1) throw new OpError('The cell is not merged');
  const doc = entry.ownerDocument!;
  setSpan(entry, grid, cell.col, cell.col);
  setMoreRows(entry, 0);
  for (let r = cell.row; r < cell.row + cell.rowspan; r++) {
    const row = grid.rows[r];
    for (let c = cell.col; c < cell.col + cell.colspan; c++) {
      if (r === cell.row && c === cell.col) continue;
      const e = newEntry(doc, g);
      e.setAttribute('colname', grid.colNames[c]);
      // keep column order: insert after the last entry with column < c
      let ref: Element | null = null;
      for (const ex of elementChildren(row)) {
        const xc = ex === entry ? cell.col : grid.cellOf.get(ex)?.col ?? -1;
        const isNew = !grid.cellOf.has(ex) && ex !== entry;
        const exCol = isNew ? parseColName(ex, grid) : xc;
        if (exCol > c) {
          ref = ex;
          break;
        }
      }
      row.insertBefore(e, ref);
    }
  }
}

function parseColName(e: Element, grid: Grid): number {
  const n = e.getAttribute('colname') ?? e.getAttribute('namest');
  return n ? grid.colNames.indexOf(n) : -1;
}

/**
 * A row that takes part in a row-spanning cell cannot change places or sections without breaking the grid: the span would point
 * at the wrong rows, or cross from the header into the body.
 */
function assertNoSpanAcross(tg: Element, boundary: number, what: string) {
  const grid = buildGrid(tg);
  for (const c of grid.cells) {
    if (c.row < boundary && c.row + c.rowspan > boundary) throw new OpError(`${what}: a merged cell spans across the boundary. Split the cell first`);
  }
}

/** Throws when moving `row` one place up or down would disturb a row-spanning cell. */
export function assertRowMovable(row: Element, dir: -1 | 1): void {
  const tg = tgroupOf(row);
  if (!tg) return;
  const grid = buildGrid(tg);
  const r = grid.rows.indexOf(row);
  const other = r + dir;
  if (r < 0 || other < 0 || other >= grid.rows.length) return;
  for (const i of [r, other]) {
    for (let c = 0; c < grid.cols; c++) {
      const x = grid.at[i][c];
      if (x && x.rowspan > 1) throw new OpError('A row with merged (row-spanning) cells cannot be moved. Split the cell first');
    }
  }
}

/**
 * Removes rows left without any cell (every column of the row is covered by a cell above it, e.g. after merging the only cells
 * of two rows) and shortens the cells that covered them.
 */
function dropEmptyRows(tg: Element): void {
  for (let guard = 0; guard < 10000; guard++) {
    const grid = buildGrid(tg);
    const r = grid.rows.findIndex((row) => !elementChildren(row).some((e) => e.nodeName === 'entry' || e.nodeName === 'entrytbl'));
    if (r < 0) return;
    const row = grid.rows[r];
    const section = row.parentNode as Element;
    if (section.nodeName === 'tbody' && elementChildren(section).filter((e) => e.nodeName === 'row').length === 1) return;
    const seen = new Set<Cell>();
    for (let c = 0; c < grid.cols; c++) {
      const x = grid.at[r][c];
      if (x && !seen.has(x)) {
        seen.add(x);
        if (x.row < r) setMoreRows(x.entry, Math.max(0, x.rowspan - 2));
      }
    }
    section.removeChild(row);
    if (section.nodeName !== 'tbody' && !elementChildren(section).some((e) => e.nodeName === 'row')) section.parentNode!.removeChild(section);
  }
}

export function toggleHeaderRow(entry: Element): 'header' | 'body' {
  const row = entry.parentNode as Element;
  const section = row.parentNode as Element;
  const tg = section.parentNode as Element;
  const doc = entry.ownerDocument!;
  if (section.nodeName === 'thead') {
    const tbody = elementChildren(tg).find((e) => e.nodeName === 'tbody')!;
    assertNoSpanAcross(tg, buildGrid(tg).rows.indexOf(row), 'The header cannot be shortened here');
    // move this row and following header rows to start of body
    const moving: Element[] = [];
    for (let n: Element | null = row; n; n = n.nextElementSibling) moving.push(n);
    for (let i = moving.length - 1; i >= 0; i--) tbody.insertBefore(moving[i], tbody.firstChild);
    if (!elementChildren(section).length) tg.removeChild(section);
    return 'body';
  }
  if (section.nodeName !== 'tbody') throw new OpError('Only body rows can become header rows');
  const rows = elementChildren(section);
  const idx = rows.indexOf(row);
  if (idx >= rows.length - 1) throw new OpError('The table body needs at least one row below the header');
  assertNoSpanAcross(tg, buildGrid(tg).rows.indexOf(rows[idx + 1]), 'This row cannot become part of the header');
  let thead = elementChildren(tg).find((e) => e.nodeName === 'thead');
  if (!thead) {
    thead = createEl(doc, 'thead');
    const ref = elementChildren(tg).find((e) => e.nodeName === 'tfoot' || e.nodeName === 'tbody') ?? null;
    tg.insertBefore(thead, ref);
  }
  // rows from the start of the body up to and including this row become header rows
  for (let i = 0; i <= idx; i++) thead.appendChild(rows[i]);
  return 'header';
}

export interface NewTableOptions {
  rows: number;
  cols: number;
  header: boolean;
  title?: string;
  frame?: string;
}

export function createTable(doc: Document, g: Grammar | null, o: NewTableOptions): Element {
  const table = createEl(doc, 'table');
  if (o.frame) table.setAttribute('frame', o.frame);
  if (o.title) {
    const t = createEl(doc, 'title');
    t.appendChild(doc.createTextNode(o.title));
    table.appendChild(t);
  }
  const tg = createEl(doc, 'tgroup');
  tg.setAttribute('cols', String(o.cols));
  for (let c = 0; c < o.cols; c++) {
    const cs = createEl(doc, 'colspec');
    cs.setAttribute('colname', 'col' + (c + 1));
    tg.appendChild(cs);
  }
  const mkRow = () => {
    const r = createEl(doc, 'row');
    for (let c = 0; c < o.cols; c++) {
      const e = newEntry(doc, g);
      e.setAttribute('colname', 'col' + (c + 1));
      r.appendChild(e);
    }
    return r;
  };
  if (o.header) {
    const th = createEl(doc, 'thead');
    th.appendChild(mkRow());
    tg.appendChild(th);
  }
  const tb = createEl(doc, 'tbody');
  for (let r = 0; r < Math.max(1, o.rows); r++) tb.appendChild(mkRow());
  tg.appendChild(tb);
  table.appendChild(tg);
  return table;
}

/** Next/previous cell in reading order. */
export function adjacentCell(entry: Element, dir: 1 | -1): Element | null {
  const tg = tgroupOf(entry);
  if (!tg) return null;
  const grid = buildGrid(tg);
  const order = grid.cells.slice().sort((a, b) => a.row - b.row || a.col - b.col);
  const i = order.findIndex((c) => c.entry === entry);
  const n = order[i + dir];
  return n ? n.entry : null;
}

/**
 * Applies a drag of the boundary between column `i` and `i + 1` (new rendered widths in CSS pixels) without disturbing the
 * rest of the table and without changing how a width is written: proportional columns ("2*") trade weight with each other,
 * absolute ones ("1.5in", "30mm") keep their unit, a proportional neighbour of an absolute column simply takes what is left.
 * Columns without a `colwidth` are made explicit ("1*") first so that the proportions mean the same everywhere.
 * Returns false (and changes nothing) when one of the two columns has a mixed width ("1*+10pt"), which has no safe rewrite.
 */
export function resizeColumnPair(tg: Element, i: number, newA: number, newB: number): boolean {
  const grid = ensureColNames(tg);
  const a = grid.colspecs[i];
  const b = grid.colspecs[i + 1];
  if (!a || !b || !(newA > 0) || !(newB > 0)) return false;
  const kinds = [colWidthKind(a.getAttribute('colwidth')), colWidthKind(b.getAttribute('colwidth'))];
  if (kinds.includes('mixed')) return false;
  for (const cs of grid.colspecs) if (!cs.getAttribute('colwidth')) cs.setAttribute('colwidth', '1*');
  if (kinds[0] === 'flex' && kinds[1] === 'flex') {
    const wa = colWeight(a.getAttribute('colwidth'));
    const wb = colWeight(b.getAttribute('colwidth'));
    const sum = wa + wb;
    const na = Math.round(((sum * newA) / (newA + newB)) * 100) / 100;
    a.setAttribute('colwidth', `${na}*`);
    b.setAttribute('colwidth', `${Math.round((sum - na) * 100) / 100}*`);
    return true;
  }
  if (kinds[0] === 'abs') a.setAttribute('colwidth', formatLengthPx(newA, lengthUnit(a.getAttribute('colwidth'))));
  if (kinds[1] === 'abs') b.setAttribute('colwidth', formatLengthPx(newB, lengthUnit(b.getAttribute('colwidth'))));
  return true;
}

export function deleteTable(entry: Node): Element {
  const t = tableOf(entry);
  if (!t) throw new OpError('Not inside a table');
  return t;
}
