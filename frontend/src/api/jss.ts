// Calls for JSS authoring (backend/src/routes/jss.ts). The document is one XML file per project; the server validates it against jss-1.0.xsd and the stencil's rules.

import { get, post, put, request } from './client';

export interface JssFinding { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }
export interface JssReport { docType: string | null; valid: boolean; errors: number; warnings: number; findings: JssFinding[]; validatedAt: string }
import type { OutlineNode, TableTemplate } from '../jss/model';

export interface JssDocument {
  docType: string | null; label: string | null; bodyKind: string | null; stencil: string | null; chapters: string[]; maxDepth: number; xml: string; hash: string; report: JssReport;
  /** 'land' | 'naval' */
  domain?: string | null;
  /** 'free': the chapters are the author's (Part IV of the Naval technical manual); 'fixed': the stencil names them */
  chapterRule?: 'fixed' | 'free';
  /** the stencil also fixes the sections under each chapter */
  sectionsFixed?: boolean;
  /** the page the body is set on when it is not portrait */
  bodyPage?: 'landscape' | 'a3-landscape' | null;
  /** the tables the stencil fixes (columns, head, caption, the section each belongs under) */
  tableTemplates?: TableTemplate[];
  /** the first chapter of the stencil, what a new chapter of a free-chapter type starts from */
  chapterStarter?: OutlineNode | null;
}

const P = (id: string) => `/api/projects/${id}/jss`;

export const jssApi = {
  read: (id: string) => get<JssDocument>(P(id)),
  /** WP-11: `merged` = someone else had saved other chapters meanwhile; `xml` is then the merged document now on the server. */
  save: (id: string, xml: string, baseHash?: string) => put<{ hash: string; report: JssReport; merged?: boolean; xml?: string }>(P(id), { xml, baseHash }),
  validate: (id: string, xml?: string) => post<JssReport>(`${P(id)}/validate`, xml === undefined ? {} : { xml }),
};

/** What an import or an export found, in plain language (the server writes the messages). */
export interface PackageFinding { severity: 'error' | 'warning' | 'info'; code: string; message: string; where?: string; detail?: string }
export interface ImportSummary { ok: true; packageName: string; importedAt: string; findings: PackageFinding[]; counts: { chapters: number; sections: number; paragraphs: number; lists: number; tables: number; figures: number; pictures: number; picturesMissing: number; picturesUnused: number; documents: number; documentsPlacedByNumber: number } }
export interface ExportSummary { ok: true; fileName: string; findings: PackageFinding[]; counts: { documents: number; chapters: number; pictures: number; picturesMissing: number; documentsKept: number; documentsRebuilt: number } }

/** Importing a finished project package into a JSS document, and exporting the document back as one. */
export const packageApi = {
  import: (id: string, file: File) => { const fd = new FormData(); fd.append('file', file); return request<{ ok: true; hash: string; report: JssReport; import: ImportSummary }>('POST', `${P(id)}/import-project`, fd).then((r) => r.import); },
  exportCheck: (id: string) => get<{ ok: boolean; report: ExportSummary }>(`${P(id)}/export-check`),
  exportUrl: (id: string) => `${P(id)}/export`,
};

export interface AncillaryPage { id: string; label: string; title: string | null; customTitle: string; enabled: boolean; required: boolean; file: string | null; edited: boolean }
const A = (id: string) => `/api/projects/${id}/ancillary`;

/** The pages before the body of a JSS document: which are printed, and what each says. */
export const ancillaryApi = {
  list: (id: string) => get<{ pages: AncillaryPage[] }>(A(id)).then((r) => r.pages),
  choose: (id: string, pages: Array<{ id: string; enabled?: boolean; title?: string }>) => put<{ pages: AncillaryPage[] }>(A(id), { pages }).then((r) => r.pages),
  read: (id: string, page: string) => get<{ page: AncillaryPage; xml: string; hash: string }>(`${A(id)}/${page}`),
  /** `baseHash`: the `hash` of the page as it was read (WP-11); the answer carries the new one. */
  save: (id: string, page: string, xml: string, baseHash: string) => put<{ page: AncillaryPage; hash: string }>(`${A(id)}/${page}`, { xml, baseHash }),
  reset: (id: string, page: string) => post<{ page: AncillaryPage; xml: string; hash: string }>(`${A(id)}/${page}/reset`, {}),
};
