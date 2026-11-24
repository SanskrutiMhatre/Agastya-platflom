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
/** A notice holds paragraphs and lists, in any order. */
export interface Notice { k: NoticeKind; parts: Array<Para | List> }
export interface PageBreak { k: 'pageBreak' }

export type Block = Para | List | Table | Figure | Notice | PageBreak;
export interface Section { k: 'section'; id?: string; title: string; orientation?: Orientation; children: Array<Block | Section> }
export interface Chapter { k: 'chapter'; number: number; id?: string; title: string; children: Array<Block | Section> }

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
export const newNotice = (kind: NoticeKind): Notice => ({ k: kind, parts: [para()] });
export const newFigure = (src: string, id?: string): Figure => ({ k: 'figure', id, title: '', graphics: [{ src }], legend: [] });
export const newSection = (title: string, id?: string): Section => ({ k: 'section', id, title, children: [] });

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
