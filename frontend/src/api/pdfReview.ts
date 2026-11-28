// Phase 3 (P3-4): the PDF review API (backend/src/routes/pdfReview.ts). Threads anchored on a page of a project PDF.
import { del, get, post, put, request } from './client';
import type { Rect, Quote } from '../../../backend/src/shared/pdfAnchor';

export type { Rect, Quote };
export type PdfAnnotationKind = 'comment' | 'suggestion' | 'remark';
export type PdfAnnotationStatus = 'open' | 'resolved' | 'accepted' | 'rejected';
export type PdfAnchorState = 'placed' | 'moved' | 'unverified' | 'orphaned';

export interface PdfAnchor { page: number; rects: Rect[]; quote: Quote | null; area?: boolean; quoteBox?: Rect | null; fuzzy?: boolean }
export interface PdfPerson { id: string; username: string | null; name: string | null }
export interface PdfSource { kind: 'dm' | 'module'; file?: string; key?: string; title: string }
export interface PdfAnnotation {
  id: string; fileKey: string; kind: PdfAnnotationKind; status: PdfAnnotationStatus; required: boolean; body: string; replacement: string | null;
  page: number; anchor: PdfAnchor; anchorState: PdfAnchorState; fileHash: string;
  orig: { page: number; hash: string; quote: string | null }; source: PdfSource | null;
  author: PdfPerson; createdAt: string; updatedAt: string; statusBy: string | null; statusAt: string | null;
  replies: Array<{ id: string; body: string; author: PdfPerson; createdAt: string }>;
}
export interface PdfAbilities { create: boolean; reply: boolean; resolve: boolean; decide: boolean; moderate: boolean; settings: boolean }
export interface PdfMe { id: string; role: string; can: PdfAbilities }
export interface PdfReviewFile { key: string; label: string; kind: 'build' | 'preview' | 'project'; size: number; modified: string; open: number; total: number }
export interface PdfFileState { key: string; hash: string; version: number; versions: number; size: number; modified: string }
export interface PdfReviewSummary { open: number; openRequired: number; total: number; blockRelease: boolean; me: PdfMe }

const B = (id: string) => `/api/projects/${encodeURIComponent(id)}/pdf-review`;
const q = (key: string) => `key=${encodeURIComponent(key)}`;

export const pdfReviewApi = {
  files: (id: string) => get<{ files: PdfReviewFile[]; me: PdfMe }>(`${B(id)}/files`, { fresh: true }),
  fileUrl: (id: string, key: string, hash?: string) => `${B(id)}/file?${q(key)}${hash ? `&v=${hash.slice(0, 12)}` : ''}`,
  /** The PDF's bytes and the version (SHA-256) they are, from one answer: what is shown and what a new anchor names are the same version. */
  fetchFile: async (id: string, key: string): Promise<{ blob: Blob; hash: string | null }> => {
    const r = await request<Response>('GET', `${B(id)}/file?${q(key)}`, undefined, { raw: true });
    return { blob: await r.blob(), hash: r.headers.get('x-pdf-hash') };
  },
  list: (id: string, key: string) => get<{ file: PdfFileState | null; annotations: PdfAnnotation[]; me: PdfMe }>(`${B(id)}/annotations?${q(key)}`, { fresh: true }),
  all: (id: string) => get<{ file: null; annotations: PdfAnnotation[]; me: PdfMe }>(`${B(id)}/annotations`, { fresh: true }),
  summary: (id: string) => get<PdfReviewSummary>(`${B(id)}/summary`, { fresh: true }),
  create: (id: string, body: { fileKey: string; fileHash?: string; kind: PdfAnnotationKind; body: string; replacement?: string; required?: boolean; anchor: PdfAnchor }) =>
    post<{ annotation: PdfAnnotation }>(`${B(id)}/annotations`, body),
  edit: (id: string, aid: string, body: { body?: string; replacement?: string; required?: boolean; updatedAt?: string }) => put<{ annotation: PdfAnnotation }>(`${B(id)}/annotations/${encodeURIComponent(aid)}`, body),
  remove: (id: string, aid: string) => del<{ ok: true }>(`${B(id)}/annotations/${encodeURIComponent(aid)}`),
  reply: (id: string, aid: string, body: string) => post<{ annotation: PdfAnnotation }>(`${B(id)}/annotations/${encodeURIComponent(aid)}/replies`, { body }),
  setStatus: (id: string, aid: string, status: PdfAnnotationStatus) => post<{ annotation: PdfAnnotation }>(`${B(id)}/annotations/${encodeURIComponent(aid)}/status`, { status }),
  place: (id: string, aid: string, body: { fileHash?: string; anchor: PdfAnchor }) => post<{ annotation: PdfAnnotation }>(`${B(id)}/annotations/${encodeURIComponent(aid)}/place`, body),
  setBlockRelease: (id: string, blockRelease: boolean) => put<{ ok: true; blockRelease: boolean }>(`${B(id)}/settings`, { blockRelease }),
  exportUrl: (id: string, format: 'csv' | 'xfdf', key?: string) => `${B(id)}/export?format=${format}${key ? `&${q(key)}` : ''}`,
};
