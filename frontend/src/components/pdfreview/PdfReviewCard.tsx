// Phase 3 (P3-4): the "PDF review" card of the Review and release page: the open comment count, the per-project setting that blocks
// release while required comments are open (Project Manager), and the review view itself (or a link to the full-page view).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pdfReviewApi, type PdfReviewSummary } from '../../api/pdfReview';
import { Pill, errText } from '../ui';
import { Icon } from '../Icon';
import { useUi } from '../../store/ui';
import { subscribe } from '../../lib/progress';
import { PdfReviewView } from './PdfReviewView';

export function PdfReviewCard({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const toast = useUi((s) => s.toast);
  const [sum, setSum] = useState<PdfReviewSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => { pdfReviewApi.summary(projectId).then(setSum, () => setSum(null)); };
  useEffect(load, [projectId]);
  useEffect(() => subscribe((m) => { if (m.projectId === projectId && m.type === 'pdf-annotations') load(); }), [projectId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (v: boolean): Promise<void> => {
    setBusy(true);
    try { await pdfReviewApi.setBlockRelease(projectId, v); toast(v ? 'Release now waits for required PDF comments' : 'PDF comments no longer block release', 'success'); load(); onChanged?.(); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <section className="card" data-testid="pdf-review-card" aria-labelledby="rel-pdfrev-h">
      <div className="card-head">
        <h3 id="rel-pdfrev-h"><Icon name="pdf" />PDF review{sum?.open ? <Pill tone="warning">{sum.open} open</Pill> : null}{sum?.openRequired ? <Pill tone="danger">{sum.openRequired} required</Pill> : null}</h3>
        <span className="grow" />
        <Link className="btn sm subtle" to={`/projects/${projectId}/review-pdf`} data-testid="pdf-review-full"><Icon name="focus" size={14} />Full page</Link>
      </div>
      <div className="card-body pp-form">
        <p>Comment on the generated PDF itself: select words or draw an area. Threads follow the text when the PDF is rebuilt.</p>
        {sum ? (
          <label className="check" title={sum.me.can.settings ? undefined : 'Set by the Project Manager'}>
            <input type="checkbox" checked={sum.blockRelease} disabled={!sum.me.can.settings || busy} onChange={(e) => void toggle(e.target.checked)} data-testid="pdf-block-release" />
            Block release while required PDF comments are open
          </label>
        ) : null}
        {open ? <div style={{ height: '78vh' }}><PdfReviewView projectId={projectId} /></div>
          : <div><button type="button" className="btn" onClick={() => setOpen(true)} data-testid="pdf-review-open"><Icon name="eye" size={14} />Open the PDF for review</button></div>}
      </div>
    </section>
  );
}
