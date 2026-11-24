// The JSG document model: the editor's in-memory form of a <jsgdoc> (backend/schemas/jsg/jsg-1.0.xsd).
//
// A plain tree with no DOM in it, so reading, writing and every structural edit can be tested without a browser. It is the JSG editor's OWN model:
// it shares nothing with the JSS editor (src/jss) or the S1000D Studio (src/studio).

export type Align = 'left' | 'center' | 'right' | 'justify';
export type ListType = 'alpha' | 'roman' | 'number' | 'step' | 'bullet' | 'dash';
export type Orientation = 'portrait' | 'landscape' | 'a3-landscape';
export type Mark = 'b' | 'i' | 'u' | 'sup' | 'sub';
export type DocType = 'uhb' | 'ispl';

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'mark'; mark: Mark; children: Inline[] }
  | { t: 'br' }
  | { t: 'xref'; to: string; children: Inline[] };

export interface Para { k: 'para'; indent: number; align?: Align; inline: Inline[] }
/** What a list item or a table cell holds: a run of text, a paragraph, or a nested list. */
export type Part = { k: 'text'; inline: Inline[] } | Para | List | { k: 'graphic'; graphic: Graphic };
export interface ListItem { parts: Part[] }
export interface List { k: 'list'; type: ListType; indent: number; items: ListItem[] }
export interface Cell { colspan?: number; rowspan?: number; align?: Align; bold?: boolean; parts: Part[] }
export interface Row { cells: Cell[] }
export interface Table { k: 'table'; id?: string; title?: string; widths?: string; head: Row[]; body: Row[] }
export interface Graphic { src: string; width?: string; height?: string; /** text printed under the picture (ISPL: the plate reference of an item) */ label?: string }
export interface Figure { k: 'figure'; id?: string; title: string; graphics: Graphic[] }
export interface Notice { k: 'note' | 'warning' | 'caution'; paras: Para[] }
export interface PageBreak { k: 'pageBreak' }
export type Block = Para | List | Table | Figure | Notice | PageBreak;

export interface Clause { k: 'clause'; id?: string; title: string; /** A page of its own in this orientation inside a portrait section (the stencil's 1.3 System Tree Chart is landscape); absent = portrait. */ orientation?: Orientation; children: Array<Block | Clause> }
export interface Section { k: 'section'; id?: string; title: string; orientation: Orientation; children: Array<Block | Clause> }
export interface Chapter { k: 'chapter'; id?: string; title: string; sections: Section[] }
export interface Appendix { k: 'appendix'; id?: string; label: string; title: string; orientation: Orientation; children: Block[] }

/** The cover fields of <meta>, in the order the author sees them. */
export const META_FIELDS: Array<{ key: string; label: string; hint?: string }> = [
  { key: 'docNo', label: 'Document No.', hint: 'Printed at the top right of the cover, e.g. CQAE/UH/E2/24/1A' },
  { key: 'title', label: 'Cover title', hint: 'USER HANDBOOK' },
  { key: 'subtitle', label: 'Second title line', hint: '(VOLUME I-BRIDGING SYSTEM)' },
  { key: 'projectName', label: 'Project name', hint: 'Printed in blue under FOR' },
  { key: 'atNo', label: 'A/T or S/O No.' },
  { key: 'dated', label: 'Dated' },
  { key: 'nsn', label: 'NSN' },
  { key: 'issueDate', label: 'Month, year of issue', hint: 'DECEMBER, 2024' },
  { key: 'equipmentLife', label: 'Equipment life', hint: 'Printed at the foot of the cover' },
  { key: 'qtyUnit', label: 'Quantity unit', hint: 'ISPL only: "for 100m" gives the column "No. Off (for 100m)"' },
  { key: 'classification', label: 'Classification', hint: 'RESTRICTED: printed in the running head and foot of every page' },
  { key: 'emblem', label: 'Emblem picture', hint: 'a file of this project, e.g. Media/emblem.png' },
  { key: 'logo', label: 'Supplier logo', hint: 'a file of this project, e.g. Media/logo.png' },
];

export interface Front {
  amendmentsMinRows: number;
  amendments: Array<Record<'no' | 'page' | 'para' | 'required' | 'authority' | 'date' | 'by', string>>;
  warning: Inline[][];
  associated: Array<{ title: string; docNo: string; remark: string }>;
  /** the sentence above the Associated Handbooks table */
  associatedIntro: string;
  abbreviations: Array<{ short: string; long: string }>;
  /** Numbered empty rows printed after the filled ones, up to this many (the stencil's table has 37). */
  abbreviationsMinRows: number;
  /** the preface: numbered paragraphs (indent 2), continuation paragraphs (indent 3+) and lettered lists (the ISPL's) */
  preface: Array<Para | List>;
  dos: Inline[][]; donts: Inline[][]; important: Inline[][];
  photos: Graphic[];
  /** the demolition notice's paragraphs (red); none = the stencil's sentence */
  demolition: Para[];
  /** the steps of the first page of FIRST AID IN CASE OF ELECTRICAL SHOCK; none = the stencil's two steps */
  firstAid: Inline[][];
  /** the ancillary pages that are NOT printed (certificate associated amendments warning demolition firstAid abbreviations preface dos donts important photos contents listOfFigures listOfTables) */
  omit: string[];
  certificate: Inline[] | null;
  supplied: { equipment: string; rows: Array<{ no: string; dcan: string; name: string; order: string }> } | null;
  /** which optional parts are present, so a part the author never had is not invented on save */
  has: Record<'amendments' | 'warning' | 'associated' | 'abbreviations' | 'preface' | 'dos' | 'donts' | 'important' | 'photos' | 'certificate' | 'supplied' | 'demolition' | 'firstAid', boolean>;
}

/** One line of an ISPL parts table. */
export interface PartRow { item: string; plateRef: string; provide: string; nsn: string; designation: string; qty: string; qtySet: string; drg: string; firmPart: string; price: string; remark: string }
export interface PlateView { caption: string; graphics: Graphic[]; parts: PartRow[]; /** the lines printed under the parts table ("Note: ...") */ notes: Inline[][] }
export interface Plate { id?: string; ref: string; title: string; caption: string; divider: boolean; setColumn: boolean; views: PlateView[] }

export const PART_COLUMNS: Array<{ key: keyof PartRow; label: string; set?: boolean; width: number; align?: 'left' | 'right' | 'center' }> = [
  { key: 'item', label: 'Item No.', width: 54 }, { key: 'plateRef', label: 'Plate Ref. No.', width: 84 }, { key: 'provide', label: "'P'", width: 44 },
  { key: 'nsn', label: 'NSN', width: 150 }, { key: 'designation', label: 'Designation', width: 220, align: 'left' },
  { key: 'qty', label: 'No. Off', width: 70 }, { key: 'qtySet', label: 'No. Off (1 Set)', width: 84, set: true },
  { key: 'drg', label: 'Drg. No.', width: 130 }, { key: 'firmPart', label: 'Firms Part No.', width: 100 }, { key: 'price', label: 'Unit Price Rs.', width: 96, align: 'right' }, { key: 'remark', label: 'Remark', width: 160, align: 'left' },
];
export const newPart = (item = ''): PartRow => ({ item, plateRef: '', provide: '', nsn: '', designation: '', qty: '', qtySet: '', drg: '', firmPart: '', price: '', remark: '' });
export const newView = (): PlateView => ({ caption: '', graphics: [], parts: [], notes: [] });
export const newPlate = (ref = 'I-A', title = 'New plate'): Plate => ({ ref, title, caption: '', divider: false, setColumn: false, views: [newView()] });
/** The plate a reference sits under: I-A/1 under I-A, I-A under I, I-B/2/9 under I-B/2 (the same rule as the server's). */
export const parentRef = (ref: string): string => { const s = ref.lastIndexOf('/'); if (s >= 0) return ref.slice(0, s); const d = ref.lastIndexOf('-'); return d >= 0 ? ref.slice(0, d) : ''; };

export interface JsgDoc {
  version: string;
  type: DocType;
  meta: Record<string, string>;
  supplier: string[];
  issuedBy: string[];
  front: Front;
  chapters: Chapter[];
  appendices: Appendix[];
  /** the Illustrated Spare Parts List's body (empty for a User Handbook) */
  plates: Plate[];
}

export const emptyFront = (): Front => ({
  amendmentsMinRows: 20, amendments: [], warning: [], associated: [], associatedIntro: '', abbreviations: [], abbreviationsMinRows: 0, preface: [], dos: [], donts: [], important: [], photos: [], demolition: [], firstAid: [], omit: [], certificate: null, supplied: null,
  has: { amendments: false, warning: false, associated: false, abbreviations: false, preface: false, dos: false, donts: false, important: false, photos: false, certificate: false, supplied: false, demolition: false, firstAid: false },
});

export const text = (s: string): Inline[] => (s ? [{ t: 'text', text: s }] : []);
export const plain = (inl: Inline[]): string => inl.map((i) => (i.t === 'text' ? i.text : i.t === 'br' ? '\n' : plain(i.children))).join('');

export const newPara = (s = '', indent = 2): Para => ({ k: 'para', indent, inline: text(s) });
export const newList = (type: ListType = 'number', n = 2): List => ({ k: 'list', type, indent: 2, items: Array.from({ length: n }, () => ({ parts: [{ k: 'text', inline: [] }] })) });
export const newCell = (s = '', align?: Align): Cell => ({ ...(align ? { align } : {}), parts: [{ k: 'text', inline: text(s) }] });
export const newTable = (rows = 3, cols = 3, title = ''): Table => ({
  k: 'table', ...(title ? { title } : {}),
  head: [{ cells: Array.from({ length: cols }, (_, i) => newCell(`Column ${i + 1}`, 'center')) }],
  body: Array.from({ length: Math.max(1, rows - 1) }, () => ({ cells: Array.from({ length: cols }, () => newCell()) })),
});
export const newFigure = (title = 'FIGURE NAME'): Figure => ({ k: 'figure', title, graphics: [] });
export const newNotice = (kind: Notice['k']): Notice => ({ k: kind, paras: [newPara('')] });
export const newClause = (title = 'New heading'): Clause => ({ k: 'clause', title, children: [newPara('')] });

export const isClause = (n: Block | Clause): n is Clause => n.k === 'clause';
