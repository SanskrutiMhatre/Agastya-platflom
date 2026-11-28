// Phase 3 (P3-4): the review highlights drawn over one PDF page (the viewer's page overlay). Text threads are translucent marks over
// their words (colour by type, grey when closed), areas are outlined with a numbered pin; hovering shows who wrote what. A thread that
// needs re-anchoring is not drawn (its old place may now hold other words); the Comments panel lists it with its old page and quote.

import { useState } from 'react';
import type { PageOverlayInfo } from '../pdf/PdfJsViewer';
import type { PdfAnnotation, Rect } from '../../api/pdfReview';
import { KIND_LABEL, authorOf } from '../../lib/pdfReview';
import '../../styles/pages/pdf-review.css';

export interface Box { left: number; top: number; width: number; height: number }
/** A rectangle in PDF user space -> pixels on the page at the viewport's zoom. */
export function boxOf(viewport: PageOverlayInfo['viewport'], r: Rect): Box {
  const [ax, ay] = viewport.convertToViewportPoint(r[0], r[3]);
  const [bx, by] = viewport.convertToViewportPoint(r[2], r[1]);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

export function AnnotationLayer({ info, annotations, focusId, onPick, draft, readOnly }: {
  info: PageOverlayInfo; annotations: PdfAnnotation[]; focusId?: string | null; onPick?: (id: string) => void;
  /** the rectangles of a thread being written (shown until it is saved) */
  draft?: { page: number; rects: Rect[] } | null; readOnly?: boolean;
}) {
  const [hover, setHover] = useState<{ a: PdfAnnotation; box: Box } | null>(null);
  const mine = annotations.filter((a) => a.page === info.page && a.anchorState !== 'orphaned');
  if (!mine.length && !(draft && draft.page === info.page)) return null;
  return (
    <div className="prv-layer" data-testid="pdf-annotation-layer" data-page={info.page}>
      {mine.map((a, n) => {
        const closed = a.status !== 'open';
        const cls = `prv-hl ${a.kind}${closed ? ' closed' : ''}${a.id === focusId ? ' focus' : ''}`;
        const label = `${KIND_LABEL[a.kind]} by ${authorOf(a)}: ${a.body || a.replacement || ''}`.slice(0, 200);
        if (a.anchor.area) {
          const b = boxOf(info.viewport, a.anchor.rects[0]);
          return <span key={a.id}>
            <span className={`${cls} area`} style={{ left: b.left, top: b.top, width: b.width, height: b.height }} data-testid="pdf-hl" data-id={a.id} data-kind={a.kind} />
            <button type="button" className={`prv-pin${a.id === focusId ? ' focus' : ''}`} style={{ left: b.left + 10, top: b.top }} aria-label={label} title={readOnly ? label : undefined}
              onClick={() => onPick?.(a.id)} onMouseEnter={() => setHover({ a, box: b })} onMouseLeave={() => setHover(null)} data-testid="pdf-pin" data-id={a.id}>
              <span className={`prv-kind ${a.kind}`} />{n + 1}
            </button>
          </span>;
        }
        return a.anchor.rects.map((r, i) => {
          const b = boxOf(info.viewport, r);
          return <button key={`${a.id}-${i}`} type="button" tabIndex={-1} className={cls} style={{ left: b.left, top: b.top, width: b.width, height: b.height }} aria-label={label}
            onClick={() => onPick?.(a.id)} onMouseEnter={() => setHover({ a, box: b })} onMouseLeave={() => setHover(null)} data-testid="pdf-hl" data-id={a.id} data-kind={a.kind} />;
        });
      })}
      {draft && draft.page === info.page ? draft.rects.map((r, i) => { const b = boxOf(info.viewport, r); return <span key={`d${i}`} className="prv-draft" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />; }) : null}
      {hover ? (
        <div className="prv-hover" role="tooltip" style={{ left: Math.min(hover.box.left, Math.max(0, info.viewport.width - 300)), top: hover.box.top + hover.box.height + 4 }}>
          <span className="who">{KIND_LABEL[hover.a.kind]} · {authorOf(hover.a)}{hover.a.status !== 'open' ? ` · ${hover.a.status}` : ''}{hover.a.replies.length ? ` · ${hover.a.replies.length} repl${hover.a.replies.length === 1 ? 'y' : 'ies'}` : ''}</span>
          {hover.a.body ? <span>{hover.a.body.slice(0, 220)}</span> : null}
          {hover.a.kind === 'suggestion' ? <span> → “{(hover.a.replacement ?? '').slice(0, 160)}”</span> : null}
        </div>
      ) : null}
    </div>
  );
}
