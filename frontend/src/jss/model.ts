// The JSS document model: the editor's in-memory form of a <jssbook> (backend/schemas/jss/jss-1.0.xsd).
//
// It is a plain tree with no DOM in it, so the whole of the editor's logic (reading and writing the XML, numbering, structural edits) can be
// tested without a browser. Everything the schema allows is representable here, so a document written by hand or by another tool is read and written back without
// losing anything; anything the schema does NOT allow is refused when reading (see xml.ts), never silently dropped.

export type Align = 'left' | 'center' | 'right' | 'justify';
export type ListType = 'alpha' | 'roman' | 'number' | 'bullet' | 'dash';
export type Orientation = 'portrait' | 'landscape' | 'a3-landscape';
export type Mark = 'b' | 'i' | 'u' | 'sup' | 'sub';

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'mark'; mark: Mark; children: Inline[] }
  | { t: 'br' }
  | { t: 'xref'; to?: string; href?: string; children: Inline[] };

export interface Para { k: 'para'; align?: Align; /** the schema's fixed value "none" */ indentNone?: boolean; inline: Inline[] }

/** What a list item or a table cell holds: a run of inline text, a paragraph, or a nested list. */
export type Part = { k: 'inline'; inline: Inline[] } | Para | List;

export interface ListItem { parts: Part[] }
export interface List { k: 'list'; type?: ListType; items: ListItem[] }

export interface Cell { colspan?: number; rowspan?: number; align?: Align; parts: Part[] }
export interface Row { cells: Cell[] }
export interface Table { k: 'table'; id?: string; widths?: string; title?: string; head: Row[]; body: Row[] }

export interface Graphic { src: string; width?: string; height?: string }
export interface KeyItem { num: string; text: string }
export interface Figure { k: 'figure'; id?: string; title?: string; graphics: Graphic[]; legend: KeyItem[] }

export type NoticeKind = 'note' | 'warning' | 'caution';
export interface Notice { k: NoticeKind; paras: Para[] }
export interface PageBreak { k: 'pageBreak' }

export type Block = Para | List | Table | Figure | Notice | PageBreak;
export interface Section { k: 'section'; id?: string; title: string; orientation?: Orientation; children: Array<Block | Section> }
/** A chapter's page (the stencil sets it for a landscape body: MRLS on A3, the SMT / STE list and Part IV on A4 landscape); none = portrait. */
export interface Chapter { k: 'chapter'; number: number; id?: string; title: string; orientation?: Orientation; children: Array<Block | Section> }

/** The identity fields of <bookmeta>, in the order the author sees them. */
export const META_FIELDS: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'bookName', label: 'Title of the publication', hint: 'Printed in the running head of every page' },
  { key: 'systemName', label: 'System name', hint: 'The equipment this publication is for ("FOR ...")' },
  { key: 'codeNo', label: 'Code No.', hint: 'Printed at the top left of the cover' },
  { key: 'revNo', label: 'Rev No.', hint: 'Printed under the Code No.' },
  { key: 'security', label: 'Security classification', hint: 'RESTRICTED, CONFIDENTIAL ...' },
  { key: 'publicationNo', label: 'Publication No.' },
  { key: 'inbrNo', label: 'INBR No.' },
  { key: 'nsn', label: 'NSN' },
  { key: 'contractNo', label: 'Contract No.' },
  { key: 'projectCode', label: 'Project code' },
  { key: 'ltDocumentNo', label: 'L&T document No.' },
  { key: 'month', label: 'Month of issue', hint: 'As printed on the cover, e.g. March' },
  { key: 'year', label: 'Year of issue' },
];

export interface JssDoc {
  docType: string;
  meta: Record<string, string>;
  chapters: Chapter[];
  /**
   * Set when the XML had content after a sub-section. A section's own content is printed before its sub-sections, so the model holds it there (and the XML is written that way);
   * the flag lets the editor tell the author the file was out of order. It is never written.
   */
  reordered?: boolean;
}

export type Node = Block | Section | Chapter;
export const isSection = (n: Block | Section): n is Section => n.k === 'section';
export const isNotice = (n: { k: string }): n is Notice => n.k === 'note' || n.k === 'warning' || n.k === 'caution';

// ── Small constructors ───────────────────────────────────────────────────────────────────────────────────────────────────────

export const text = (s: string): Inline => ({ t: 'text', text: s });
export const para = (s = ''): Para => ({ k: 'para', inline: s ? [text(s)] : [] });
export const inlinePart = (s = ''): Part => ({ k: 'inline', inline: s ? [text(s)] : [] });
export const newCell = (s = ''): Cell => ({ parts: [inlinePart(s)] });
export const newRow = (cols: number): Row => ({ cells: Array.from({ length: cols }, () => newCell()) });

/** A table with a header row, `rows` body rows and `cols` columns, as the stencil's tables are. */
export function newTable(rows: number, cols: number, id?: string): Table {
  return { k: 'table', id, title: '', head: [newRow(cols)], body: Array.from({ length: Math.max(1, rows) }, () => newRow(cols)) };
}
export const newList = (type: ListType | undefined, items = 1): List => ({ k: 'list', type, items: Array.from({ length: items }, () => ({ parts: [inlinePart()] })) });
export const newNotice = (kind: NoticeKind): Notice => ({ k: kind, paras: [para()] });
export const newFigure = (src: string, id?: string): Figure => ({ k: 'figure', id, title: '', graphics: [{ src }], legend: [] });
export const newSection = (title: string, id?: string): Section => ({ k: 'section', id, title, children: [] });
export const newChapter = (number: number, title: string, id?: string, orientation?: Orientation): Chapter => ({ k: 'chapter', number, id, title, orientation, children: [] });

// ── What the stencil fixes, as the server hands it over (backend/src/services/jss/registry.ts) ─────────────────────────────────────

/** One cell of a stencil table's head. */
export interface HeadCell { text: string; colspan?: number; rowspan?: number; open?: boolean }
/** A table the stencil fixes: its widths (proportions), its head, the blank rows a new one starts with, its caption, and the section it belongs to (null: any). */
export interface TableTemplate { widths: string; head: HeadCell[][]; blankRows: number; caption?: string; forSection?: string | null }
/** A heading of the stencil's outline, with what the stencil puts under it. */
export interface OutlineNode { title: string; children?: OutlineNode[]; example?: boolean; table?: TableTemplate; intro?: string; figuresHeading?: string }

/** The columns of a stencil table: the cells of its first head row, each as wide as it spans. */
export const templateColumns = (t: TableTemplate): number => t.head[0].reduce((n, c) => n + (c.colspan ?? 1), 0);

/** A table as the stencil has it: its head as the stencil merges it, its widths and caption, and blank rows to fill. */
export function tableFromTemplate(t: TableTemplate, id?: string): Table {
  const head = t.head.map((r): Row => ({ cells: r.map((c): Cell => ({ colspan: c.colspan && c.colspan > 1 ? c.colspan : undefined, rowspan: c.rowspan && c.rowspan > 1 ? c.rowspan : undefined, parts: [inlinePart(c.text)] })) }));
  return { k: 'table', id, widths: t.widths, title: t.caption ?? '', head, body: Array.from({ length: Math.max(1, t.blankRows) }, () => newRow(templateColumns(t))) };
}

/**
 * A chapter started from the stencil's outline (the first chapter of a type whose chapters are the author's: its sections, the tables under them, the sentence before a table,
 * the figures heading). Examples the stencil only shows ("Assembly-1") are left out, as in the starting document the server writes.
 */
export function chapterFromOutline(doc: JssDoc, node: OutlineNode, number: number, orientation?: Orientation): Chapter {
  const build = (n: OutlineNode): Array<Block | Section> => {
    const out: Array<Block | Section> = [];
    if (n.intro) out.push(para(n.intro));
    if (n.table) out.push({ ...tableFromTemplate(n.table, newId(doc, 't')) });
    if (n.figuresHeading) out.push({ k: 'pageBreak' }, { k: 'para', align: 'center', inline: [{ t: 'mark', mark: 'b', children: [text(n.figuresHeading)] }] });
    for (const c of (n.children ?? []).filter((x) => !x.example)) out.push({ ...newSection(c.title, newId(doc, 's')), children: build(c) });
    return out;
  };
  return { ...newChapter(number, node.title, newId(doc, 'c'), orientation), children: build(node) };
}

// ── Plain text of inline runs (for titles, labels and search) ───────────────────────────────────────────────────────────────────

export function inlineText(runs: Inline[]): string {
  return runs.map((r) => (r.t === 'text' ? r.text : r.t === 'br' ? '\n' : inlineText(r.children))).join('');
}
export const partsText = (parts: Part[]): string => parts.map((p) => (p.k === 'inline' ? inlineText(p.inline) : p.k === 'para' ? inlineText(p.inline) : p.items.map((i) => partsText(i.parts)).join(' '))).join(' ');

// ── Identity ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every id used in the document. */
export function collectIds(doc: JssDoc): Set<string> {
  const ids = new Set<string>();
  const walk = (children: Array<Block | Section>) => {
    for (const c of children) {
      if (c.k === 'section') { if (c.id) ids.add(c.id); walk(c.children); }
      else if ((c.k === 'table' || c.k === 'figure') && c.id) ids.add(c.id);
    }
  };
  for (const ch of doc.chapters) { if (ch.id) ids.add(ch.id); walk(ch.children); }
  return ids;
}

/** A fresh id that is not in use: letter first (the schema's xs:ID), then lower-case letters and digits. */
export function newId(doc: JssDoc, prefix: 's' | 't' | 'f' | 'c'): string {
  const used = collectIds(doc);
  for (;;) {
    const id = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
}

export const cloneDoc = (doc: JssDoc): JssDoc => JSON.parse(JSON.stringify(doc)) as JssDoc;
