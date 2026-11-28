// Phase 3 (P3-4): the full-page PDF review (/projects/:id/review-pdf?key=<file>&a=<thread>), reached from the Review and release card,
// the editor's PDF pane and links to one thread.

import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProject } from '../../layouts/ProjectShell';
import { PdfReviewView } from '../../components/pdfreview/PdfReviewView';
import { Icon } from '../../components/Icon';

export function PdfReviewPage() {
  const { id } = useProject();
  const [params, setParams] = useSearchParams();
  const onKey = useCallback((key: string) => {
    setParams((p) => { if (p.get('key') === key) return p; const n = new URLSearchParams(p); n.set('key', key); return n; }, { replace: true });
  }, [setParams]);
  return (
    <div className="v2-page pp" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} data-testid="pdf-review-page">
      <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><Icon name="comment" />PDF review</h2>
        <span style={{ flex: 1 }} />
        <Link className="btn sm subtle" to={`/projects/${id}/release`}><Icon name="back" size={14} />Review and release</Link>
      </div>
      <div style={{ flex: 1, minHeight: 520 }}>
        <PdfReviewView projectId={id} initialKey={params.get('key')} initialId={params.get('a')} onKeyChange={onKey} />
      </div>
    </div>
  );
}
