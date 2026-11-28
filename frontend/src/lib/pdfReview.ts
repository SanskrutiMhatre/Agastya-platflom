// Phase 3 (P3-4): PDF review on the client. The threads of one PDF kept current by the project WebSocket (no polling), the filters of the
// Comments panel, the link from a thread to the source in the editor, and the anchor of a selection / an area (the shared module
// backend/src/shared/pdfAnchor.ts, exactly as the server re-anchors).

import { useCallback, useEffect, useRef, useState } from 'react';
import { pdfReviewApi, type PdfAnnotation, type PdfAnnotationKind, type PdfAnnotationStatus, type PdfFileState, type PdfMe, type PdfAnchor, type Rect } from '../api/pdfReview';
import { subscribe } from './progress';
import { buildPageIndex, contextOf, findQuote, rectsFor, runsFromTextContent, textInRect, unionRect, type PageIndex } from '../../../backend/src/shared/pdfAnchor';
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface PdfThreads { annotations: PdfAnnotation[]; file: PdfFileState | null; me: PdfMe | null; loading: boolean; error: string; reload: () => void; upsert: (a: PdfAnnotation) => void; drop: (id: string) => void }

/** The threads of `key` (null: none), loaded once and then kept current by the socket's 'pdf-annotations' notices. */
export function usePdfAnnotations(projectId: string, key: string | null): PdfThreads {
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [file, setFile] = useState<PdfFileState | null>(null);
  const [me, setMe] = useState<PdfMe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!key) { setAnnotations([]); setFile(null); return; }
    const mine = ++seq.current; setLoading(true);
    pdfReviewApi.list(projectId, key).then((r) => { if (mine !== seq.current) return; setAnnotations(r.annotations); setFile(r.file); setMe(r.me); setError(''); },
      (e) => { if (mine === seq.current) setError(errText(e)); }).finally(() => { if (mine === seq.current) setLoading(false); });
  }, [projectId, key]);
  useEffect(() => { load(); }, [load]);
  const upsert = useCallback((a: PdfAnnotation) => setAnnotations((l) => (l.some((x) => x.id === a.id) ? l.map((x) => (x.id === a.id ? a : x)) : [...l, a])), []);
  const drop = useCallback((id: string) => setAnnotations((l) => l.filter((x) => x.id !== id)), []);
  useEffect(() => {
    if (!key) return undefined;
    return subscribe((m) => {
      if (m.type !== 'pdf-annotations' || m.projectId !== projectId || m.fileKey !== key) return;
      if (m.change === 'deleted' && m.id) drop(m.id);
      else if ((m.change === 'created' || m.change === 'updated') && m.annotation) upsert(m.annotation as PdfAnnotation);
      else load();
    });
  }, [projectId, key, load, upsert, drop]);
  return { annotations, file, me, loading, error, reload: load, upsert, drop };
}

// ── The Comments panel's filters ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ThreadFilter { status: 'all' | 'open' | 'closed' | PdfAnnotationStatus; kind: 'all' | PdfAnnotationKind; author: string; page: string; module: string; text: string; placement: 'all' | 'orphaned' }
export const NO_FILTER: ThreadFilter = { status: 'open', kind: 'all', author: '', page: '', module: '', text: '', placement: 'all' };

export const authorOf = (a: { author: { name: string | null; username: string | null } }): string => a.author.name ?? a.author.username ?? 'Someone';
export const moduleOf = (a: PdfAnnotation): string => (a.source ? a.source.file ?? a.source.key ?? '' : '');

export function filterThreads(list: PdfAnnotation[], f: ThreadFilter): PdfAnnotation[] {
  const needle = f.text.trim().toLowerCase();
  return list.filter((a) => {
    if (f.status === 'open' && a.status !== 'open') return false;
    if (f.status === 'closed' && a.status === 'open') return false;
    if (f.status !== 'all' && f.status !== 'open' && f.status !== 'closed' && a.status !== f.status) return false;
    if (f.kind !== 'all' && a.kind !== f.kind) return false;
    if (f.author && a.author.id !== f.author) return false;
    if (f.page && String(a.page) !== f.page.trim()) return false;
    if (f.module && moduleOf(a) !== f.module) return false;
    if (f.placement === 'orphaned' && a.anchorState !== 'orphaned') return false;
    if (needle) {
      const hay = [a.body, a.replacement ?? '', a.anchor.quote?.exact ?? '', authorOf(a), a.source?.title ?? '', ...a.replies.map((r) => r.body)].join('\n').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  }).sort((x, y) => x.page - y.page || ((y.anchor.rects[0]?.[3] ?? 0) - (x.anchor.rects[0]?.[3] ?? 0)) || x.createdAt.localeCompare(y.createdAt));
}

export function countThreads(list: PdfAnnotation[]): { open: number; resolved: number; accepted: number; rejected: number; orphaned: number; required: number; total: number } {
  const c = { open: 0, resolved: 0, accepted: 0, rejected: 0, orphaned: 0, required: 0, total: list.length };
  for (const a of list) { c[a.status]++; if (a.anchorState === 'orphaned') c.orphaned++; if (a.required && a.status === 'open') c.required++; }
  return c;
}

/** Where "Open in editor" goes: the data module (S1000D) or the module of the JSS / JSG document. */
export function editorLink(projectId: string, a: PdfAnnotation): string | null {
  if (!a.source) return null;
  if (a.source.kind === 'dm' && a.source.file) return `/projects/${encodeURIComponent(projectId)}/editor?file=${encodeURIComponent(a.source.file)}`;
  if (a.source.kind === 'module' && a.source.key) return `/projects/${encodeURIComponent(projectId)}/editor?goto=${encodeURIComponent(a.source.key)}`;
  return null;
}

export const KIND_LABEL: Record<PdfAnnotationKind, string> = { comment: 'Comment', suggestion: 'Suggestion', remark: 'Remark' };
export const STATUS_LABEL: Record<PdfAnnotationStatus, string> = { open: 'Open', resolved: 'Resolved', accepted: 'Accepted', rejected: 'Rejected' };
export const PLACEMENT_LABEL: Record<string, string> = { placed: '', moved: 'Moved by a rebuild', unverified: 'Kept in place (no text to check)', orphaned: 'Needs re-anchoring' };

// ── Anchors from the viewer ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The page index of a pdf.js page (the same index the server builds). */
export async function pageIndexOf(page: { getTextContent: () => Promise<{ items: unknown[] }> }): Promise<PageIndex> {
  const tc = await page.getTextContent();
  return buildPageIndex(runsFromTextContent(tc.items as Array<{ str?: unknown; transform?: unknown; width?: unknown; height?: unknown }>));
}

/** A selection's anchor: the selected words found on the page near the selected rectangles, with their context. */
export function anchorOfSelection(ix: PageIndex, page: number, exact: string, rects: Rect[]): PdfAnchor | null {
  const words = exact.replace(/\s+/g, ' ').trim();
  if (!words) return null;
  const m = findQuote(ix, { exact: words }, { near: rects });
  if (!m) return { page, rects, quote: { exact: words } };
  return { page, rects: rectsFor(ix, m.start, m.end), quote: { exact: words, ...contextOf(ix, m.start, m.end) } };
}

/** An area's anchor: the rectangle, and the words inside it (if any) to find it again after a rebuild. */
export function anchorOfArea(ix: PageIndex | null, page: number, rect: Rect): PdfAnchor {
  const t = ix ? textInRect(ix, rect) : null;
  if (!t || !ix || t.text.length < 3) return { page, rects: [rect], quote: null, area: true, quoteBox: null };
  return { page, rects: [rect], quote: { exact: t.text, ...contextOf(ix, t.start, t.end) }, area: true, quoteBox: unionRect(rectsFor(ix, t.start, t.end)) };
}

/** Screen rectangles (client px) on a page element -> PDF user space with the page's viewport. */
export function toPdfRects(clientRects: DOMRect[] | DOMRectList, pageEl: HTMLElement, viewport: { convertToPdfPoint: (x: number, y: number) => number[] }): Rect[] {
  const box = pageEl.getBoundingClientRect();
  const out: Rect[] = [];
  for (const r of Array.from(clientRects)) {
    if (r.width < 1 || r.height < 1) continue;
    const [x1, y1] = viewport.convertToPdfPoint(r.left - box.left, r.top - box.top);
    const [x2, y2] = viewport.convertToPdfPoint(r.right - box.left, r.bottom - box.top);
    out.push([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)].map((v) => Math.round(v * 100) / 100) as Rect);
  }
  return out;
}
