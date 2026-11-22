// =============================================================================
// Repair rule `table-cols`: a CALS table whose declared width disagrees with its cells.
//
// WHY IT MATTERS: the Vektra plugin writes `<tgroup cols="3">` over rows of 8 cells (it merges separate tables
// into one tgroup). Apache FOP refuses a cell that overflows the declared columns ("The column-number or
// number of cells in the row overflows the number of fo:table-column specified for the table") and aborts the
// whole PDF. The importer cannot fix the plugin, so it fixes the file - on a copy, logged.
//
// WHAT IT CHANGES: only `@cols` and the `<colspec>` list, as text edits at exact offsets. The cells are left
// alone; short rows stay short (FOP accepts a row with fewer cells than columns, not more).
//
//   M1  cols < widest row      -> cols := widest row                       (error: the build crashes)
//   M2  colspec count != cols  -> generate the missing colspecs, or trim extras no cell refers to
//   M3  cols > widest row      -> report only: trailing empty columns are legal, and removing a column the
//                                 author declared is not the importer's call
//
// "Widest row" counts spanning cells (namest/nameend/spanname) by the columns they cover and honours
// `morerows`, so a table that is correct but uses spans is never "repaired".
// =============================================================================

import { scanTags, matchingClose, parseAttrs, setAttrs, eolOf, lineAt, type Tag } from './../xmlScan';
import type { ChangeEntry, Finding } from '../types';

export interface ColspecInfo { name: string; tag: Tag; attrs: Record<string, string> }
export interface TableAnalysis {
  /** 1-based position among the file's tgroups. */
  ordinal: number;
  tableId?: string;
  tgroup: Tag;
  cols: number | null;
  colspecs: ColspecInfo[];
  /** The widest row, in columns (spans counted). */
  widest: number;
  rows: number;
  /** Highest colspec index (1-based) any entry names via colname/namest/nameend/spanname. */
  referencedMax: number;
  line: number;
}

interface EntryAttrs { colname?: string; namest?: string; nameend?: string; spanname?: string; morerows?: string }

function analyseTgroup(tags: Tag[], open: number, close: number, text: string): Omit<TableAnalysis, 'ordinal' | 'tableId' | 'line'> {
  const tgroup = tags[open];
  const cols = Number.parseInt(parseAttrs(tgroup.rawAttrs).cols ?? '', 10);
  const colspecs: ColspecInfo[] = [];
  const spanspecs = new Map<string, [string, string]>();
  let widest = 0; let rows = 0; let referencedMax = 0;
  const carry: number[] = [];
  let row: EntryAttrs[] | null = null;

  const colIndex = (name: string | undefined): number | undefined => {
    if (!name) return undefined;
    const i = colspecs.findIndex((c) => c.name === name);
    return i < 0 ? undefined : i;
  };

  const finishRow = (): void => {
    if (!row) return;
    rows++;
    const occupiedBefore = carry.map((v) => v > 0);
    let col = 0; let extent = 0;
    const set: Array<[number, number, number]> = [];
    for (const e of row) {
      while (carry[col] > 0) col++;
      let start = col; let span = 1;
      const named = colIndex(e.colname) ?? colIndex(e.namest);
      let nm = e.namest; let ne = e.nameend;
      if (e.spanname && spanspecs.has(e.spanname)) [nm, ne] = spanspecs.get(e.spanname) as [string, string];
      const si = colIndex(nm); const ei = colIndex(ne);
      if (si !== undefined && ei !== undefined && ei >= si) { start = si; span = ei - si + 1; }
      else if (named !== undefined) start = named;
      for (const n of [e.colname, e.namest, e.nameend]) { const ix = colIndex(n); if (ix !== undefined) referencedMax = Math.max(referencedMax, ix + 1); }
      extent = Math.max(extent, start + span);
      col = start + span;
      const more = Number.parseInt(e.morerows ?? '0', 10);
      if (more > 0) set.push([start, span, more]);
    }
    for (let c = 0; c < carry.length; c++) if (occupiedBefore[c]) { carry[c]--; extent = Math.max(extent, c + 1); }
    for (const [start, span, more] of set) for (let c = start; c < start + span; c++) carry[c] = more;
    widest = Math.max(widest, extent);
    row = null;
  };

  for (let i = open + 1; i < close; i++) {
    const t = tags[i];
    if (t.name === 'tgroup' && t.kind === 'open') { const end = matchingClose(tags, i); if (end > i) i = end; continue; }   // a table nested in a cell: its own analysis
    if (t.kind === 'close') { if (t.name === 'row') finishRow(); continue; }
    if (t.name === 'colspec') { const a = parseAttrs(t.rawAttrs); colspecs.push({ name: a.colname ?? `#${colspecs.length + 1}`, tag: t, attrs: a }); continue; }
    if (t.name === 'spanspec') { const a = parseAttrs(t.rawAttrs); if (a.spanname && a.namest && a.nameend) spanspecs.set(a.spanname, [a.namest, a.nameend]); continue; }
    if (t.name === 'thead' || t.name === 'tbody' || t.name === 'tfoot') { carry.length = 0; continue; }
    if (t.name === 'row' && t.kind === 'open') { row = []; continue; }
    if (t.name === 'entry' && row) {
      const a = parseAttrs(t.rawAttrs);
      row.push({ colname: a.colname, namest: a.namest, nameend: a.nameend, spanname: a.spanname, morerows: a.morerows });
      if (t.kind === 'open') { const end = matchingClose(tags, i); if (end > i) i = end; }   // skip the cell's content (it may hold nested tables)
    }
  }
  void text;
  return { tgroup, cols: Number.isFinite(cols) ? cols : null, colspecs, widest, rows, referencedMax };
}

export function analyseTables(text: string): TableAnalysis[] {
  if (!text.includes('<tgroup')) return [];
  const tags = [...scanTags(text)];
  const out: TableAnalysis[] = [];
  const tableIds: Array<string | undefined> = [];
  let ordinal = 0;
  const stack: Array<string | undefined> = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.name === 'table') {
      if (t.kind === 'open') stack.push(parseAttrs(t.rawAttrs).id); else if (t.kind === 'close') stack.pop();
    }
    if (t.name === 'tgroup' && t.kind === 'open') {
      const close = matchingClose(tags, i);
      if (close < 0) continue;
      ordinal++;
      tableIds[ordinal] = stack[stack.length - 1];
      out.push({ ordinal, tableId: stack[stack.length - 1], line: lineAt(text, t.start), ...analyseTgroup(tags, i, close, text) });
    }
  }
  return out;
}

const trailingNumber = /^(.*?)(\d+)$/;

/** A new colspec modelled on the last existing one: same tag style, same indentation, a free name, widths kept proportionate. */
function makeColspec(last: ColspecInfo, text: string, ordinal: number, taken: Set<string>, widthFor: string | undefined): string {
  const lastText = text.slice(last.tag.start, last.tag.end);
  const m = trailingNumber.exec(last.name);
  let name = m ? `${m[1]}${ordinal}` : `col${ordinal}`;
  while (taken.has(name)) name += '_';
  taken.add(name);
  let raw = last.tag.rawAttrs;
  const wanted: Record<string, string> = { colname: name };
  if (last.attrs.colnum !== undefined) wanted.colnum = String(ordinal);
  if (widthFor !== undefined) wanted.colwidth = widthFor;
  raw = setAttrs(raw, wanted);
  if (widthFor === undefined && last.attrs.colwidth !== undefined) raw = raw.replace(/\s+colwidth\s*=\s*(?:"[^"]*"|'[^']*')/, '');
  const closing = lastText.endsWith('/>') ? '/>' : last.tag.kind === 'open' ? '></colspec>' : '>';
  return `<colspec${raw}${closing}`;
}

/** The width a generated colspec gets: nothing if the table gives none; "1*" when widths are proportional; else the mean of the absolute ones. */
function defaultWidth(colspecs: ColspecInfo[]): string | undefined {
  const widths = colspecs.map((c) => c.attrs.colwidth).filter((w): w is string => !!w);
  if (!widths.length) return undefined;
  if (widths.every((w) => /\*/.test(w))) return '1*';
  const m = widths.map((w) => /^([\d.]+)\s*([a-z%]*)$/i.exec(w.trim()));
  if (m.every((x) => x && x[2] === (m[0] as RegExpExecArray)[2])) {
    const mean = m.reduce((s, x) => s + Number((x as RegExpExecArray)[1]), 0) / m.length;
    return `${Math.round(mean * 100) / 100}${(m[0] as RegExpExecArray)[2]}`;
  }
  return undefined;
}

export interface TableRepairResult { text: string; changes: Array<Omit<ChangeEntry, 'seq' | 'file'>> }

export function tableFindings(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  for (const t of analyseTables(text)) {
    const id = t.tableId ? `table "${t.tableId}"` : `table #${t.ordinal}`;
    if (t.cols === null) out.push({ id: 'table-cols-missing', severity: 'error', rule: 'table-cols', file, repairable: true, message: `${id}: the tgroup has no valid cols attribute (its rows are ${t.widest} wide).`, data: { line: t.line } });
    else if (t.widest > t.cols) out.push({ id: 'table-cols-overflow', severity: 'error', rule: 'table-cols', file, repairable: true, message: `${id}: cols="${t.cols}" but a row has ${t.widest} cells - the PDF build (FOP) fails on this.`, data: { line: t.line, cols: t.cols, widest: t.widest } });
    else if (t.colspecs.length > 0 && t.colspecs.length !== t.cols) out.push({ id: 'table-colspec-count', severity: 'warning', rule: 'table-cols', file, repairable: true, message: `${id}: cols="${t.cols}" but ${t.colspecs.length} colspec elements.`, data: { line: t.line } });
    else if (t.cols > t.widest && t.rows > 0) out.push({ id: 'table-cols-wider', severity: 'info', rule: 'table-cols', file, message: `${id}: cols="${t.cols}" but no row is wider than ${t.widest} (trailing empty columns; left as authored).`, data: { line: t.line } });
  }
  return out;
}

export function repairTables(text: string): TableRepairResult {
  const analyses = analyseTables(text);
  if (!analyses.length) return { text, changes: [] };
  const eol = eolOf(text);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const changes: TableRepairResult['changes'] = [];

  for (const t of analyses) {
    const label = t.tableId ? `table "${t.tableId}"` : `table #${t.ordinal}`;
    let cols = t.cols;
    const overflow = cols === null || t.widest > cols;
    if (cols === null) cols = Math.max(t.widest, t.colspecs.length, 1);
    else if (overflow) cols = t.widest;
    // A colspec some cell names must survive, so the table never ends up narrower than the last name in use.
    cols = Math.max(cols, t.referencedMax);

    const before: string[] = []; const after: string[] = [];
    if (cols !== t.cols) {
      before.push(`cols="${t.cols ?? ''}"`); after.push(`cols="${cols}"`);
      edits.push({ start: t.tgroup.start, end: t.tgroup.end, replacement: `<tgroup${setAttrs(t.tgroup.rawAttrs, { cols: String(cols) })}>` });
    }

    if (t.colspecs.length > 0 && t.colspecs.length !== cols) {
      before.push(`${t.colspecs.length} colspec`);
      if (t.colspecs.length < cols) {
        const last = t.colspecs[t.colspecs.length - 1];
        const taken = new Set(t.colspecs.map((c) => c.name));
        const lineStart = text.lastIndexOf('\n', last.tag.start) + 1;
        const indent = /^[ \t]*$/.test(text.slice(lineStart, last.tag.start)) ? text.slice(lineStart, last.tag.start) : '';
        const width = defaultWidth(t.colspecs);
        const added: string[] = [];
        for (let n = t.colspecs.length + 1; n <= cols; n++) added.push(makeColspec(last, text, n, taken, width));
        // Inserted after the last existing colspec, on lines of their own when the file is laid out that way.
        const sep = indent ? eol + indent : '';
        edits.push({ start: last.tag.end, end: last.tag.end, replacement: added.map((a) => sep + a).join('') });
        after.push(`${cols} colspec (${added.length} added)`);
      } else {
        // Trim colspecs beyond `cols` - they cannot be referenced (cols >= referencedMax), so nothing depends on them.
        const extra = t.colspecs.slice(cols);
        for (const c of extra) {
          const lineStart = text.lastIndexOf('\n', c.tag.start) + 1;
          const startsLine = /^[ \t]*$/.test(text.slice(lineStart, c.tag.start));
          let end = c.tag.end;
          if (startsLine) { const nl = /^[ \t]*\r?\n/.exec(text.slice(end)); if (nl) end += nl[0].length; edits.push({ start: lineStart, end, replacement: '' }); }
          else edits.push({ start: c.tag.start, end, replacement: '' });
        }
        after.push(`${cols} colspec (${extra.length} removed)`);
      }
    }
    if (before.length) {
      changes.push({ rule: 'table-cols', kind: 'edit', where: label, line: t.line, before: before.join(', '), after: after.join(', ') });
    }
  }
  if (!edits.length) return { text, changes: [] };
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return { text: out, changes };
}
