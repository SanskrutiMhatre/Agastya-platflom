// Calls for JSG authoring and publishing (backend/src/routes/jsg.ts). The document is one XML file per project; the server validates it against jsg-1.0.xsd
// and builds the PDF with the JSG engine.

import { get, post, put, request } from './client';

export interface JsgFinding { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }
export interface JsgReport { docType: string | null; valid: boolean; errors: number; warnings: number; findings: JsgFinding[]; validatedAt: string }
export interface JsgDocument { docType: string | null; label: string | null; stencil: string | null; xml: string; hash: string; report: JsgReport }
export interface JsgImportReport { chapters: number; sections: number; clauses: number; paragraphs: number; lists: number; tables: number; figures: number; pictures: number; frontPages: string[]; skipped: string[]; warnings: string[] }
export interface JsgBuild { ok: boolean; totalMs: number; bytes: number; warnings: string[]; pdfUrl: string; /** WP-15: what the PDF claims */ releaseLabel?: string; released?: boolean; warmFop?: boolean; jobId?: string; report?: { notes: string[]; lines: number } }

const P = (id: string) => `/api/projects/${id}/jsg`;

export const jsgApi = {
  read: (id: string) => get<JsgDocument>(P(id)),
  /** WP-11: `merged` = someone else had saved other sections meanwhile; `xml` is then the merged document now on the server. */
  save: (id: string, xml: string, baseHash?: string) => put<{ hash: string; report: JsgReport; merged?: boolean; xml?: string }>(P(id), { xml, baseHash }),
  validate: (id: string, xml?: string) => post<JsgReport>(`${P(id)}/validate`, xml === undefined ? {} : { xml }),
  build: (id: string) => post<JsgBuild>(`${P(id)}/build`, {}),
  /** The editor's Quick preview: the saved document built by the JSG engine as a draft PDF (not the document's PDF; nothing is published). */
  preview: async (id: string): Promise<Blob> => (await request<Response>('POST', `${P(id)}/preview`, {}, { raw: true })).blob(),
  /** Replace the document with a Word file written in the JSG User Handbook styles; its pictures go to the project. */
  importDocx: (id: string, file: File) => { const fd = new FormData(); fd.append('file', file); return request<{ ok: boolean; hash: string; report: JsgReport; import: JsgImportReport; pictures: number }>('POST', `${P(id)}/import-docx`, fd); },
  pdfUrl: (id: string, download = false) => `${P(id)}/pdf${download ? '?download=1' : ''}`,
  /** WP-15 (PUB-011): the copy to hand out, rebuilt first when it no longer matches the document or its release (as /publish/download for the other formats). */
  downloadUrl: (id: string) => `${P(id)}/pdf/download`,
};
