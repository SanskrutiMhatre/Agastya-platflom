// Phase 3 (P3-4): the PDF review threads, read-only, on an editor's PDF pane (S1000D, JSS and JSG). Only the generated PDF gets the
// highlights: the threads are placed on the newest version of that file, which is the one the pane shows. A quick preview is a draft held
// in the browser, so it gets only the count and the link. Clicking a highlight opens that thread in the review view.

import { useCallback, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PageOverlayInfo } from '../pdf/PdfJsViewer';
import { AnnotationLayer } from './AnnotationLayer';
import { usePdfAnnotations } from '../../lib/pdfReview';
import { Icon } from '../Icon';

export function reviewLink(projectId: string, key?: string | null, id?: string | null): string {
  const q = new URLSearchParams(); if (key) q.set('key', key); if (id) q.set('a', id);
  const s = q.toString();
  return `/projects/${projectId}/review-pdf${s ? `?${s}` : ''}`;
}

/** `key` = the review file key of the PDF on show (null = none, or a draft that is not annotated here). */
export function usePaneAnnotations(projectId: string, key: string | null, show: boolean): { overlay?: (p: PageOverlayInfo) => ReactNode; badge: ReactNode } {
  const threads = usePdfAnnotations(projectId, key);
  const navigate = useNavigate();
  const pick = useCallback((aid: string) => navigate(reviewLink(projectId, key, aid)), [navigate, projectId, key]);
  const open = threads.annotations.filter((a) => a.status === 'open').length;
  const overlay = useCallback((info: PageOverlayInfo) => <AnnotationLayer info={info} annotations={threads.annotations} onPick={pick} readOnly />, [threads.annotations, pick]);
  const badge = key ? (
    <Link className="btn btn-sm" to={reviewLink(projectId, key)} data-testid="pdf-pane-review" title="Comment on this PDF in the review view">
      <Icon name="comment" size={14} />Review{open ? ` (${open} open)` : ''}
    </Link>
  ) : null;
  return { overlay: show && threads.annotations.length ? overlay : undefined, badge };
}
