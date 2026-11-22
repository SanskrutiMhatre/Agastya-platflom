// "Publish waivers": the recorded decisions to build DRAFTS without a BREX the project does not have. Anyone who can see the project reads them;
// an editor or above can withdraw one. A waiver never covers a release request or approval.

import { useState } from 'react';
import type { ProjectRole } from '../../api';
import { waiverApi, type Waiver } from '../../api/waivers';
import { Alert, Badge, Empty, Loading, errText, fmtDate, useAsync } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { canRecordWaiver } from '../../lib/roles';
import { waiverKindLabel } from '../../lib/waivers';
import { useUi } from '../../store/ui';

export function PublishWaivers({ projectId, role, refreshKey }: { projectId: string; role: ProjectRole; refreshKey: number }) {
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => waiverApi.list(projectId), [projectId, refreshKey]);
  const [busy, setBusy] = useState('');
  const may = canRecordWaiver(role);

  const remove = async (w: Waiver) => {
    setBusy(w.id);
    try { await waiverApi.remove(projectId, w.id); toast(`Waiver for ${w.subject} removed. A build that needs it is refused again.`, 'success'); list.reload(); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(''); }
  };

  const waivers = list.data?.waivers ?? [];
  return (
    <section className="v2-card" style={{ marginTop: 16 }} aria-label="Publish waivers" data-testid="publish-waivers">
      <div className="v2-card-head"><span>Publish waivers <Badge tone={waivers.length ? 'warn' : undefined}>{waivers.length}</Badge></span></div>
      <div className="v2-card-pad v2-stack" style={{ gap: 8 }}>
        <p className="v2-hint" style={{ margin: 0 }}>
          The build is strict: a data module that names a BREX this project does not have is not built. When that is the only problem, an editor can record a waiver here to
          allow <strong>draft</strong> builds without it. Every build that relies on one says so in its log. <strong>A waiver never covers a release request or approval.</strong>
        </p>
        {list.loading && !list.data ? <Loading /> : list.error ? <Alert tone="bad">{list.error}</Alert> : waivers.length === 0 ? (
          <Empty title="No waivers">Nothing is being waived. A build that names a missing BREX is refused and offers to record one.</Empty>
        ) : (
          <table className="v2-table" data-testid="waiver-list">
            <thead><tr><th>Subject</th><th>Reason</th><th>Recorded by</th><th>Date</th>{may ? <th /> : null}</tr></thead>
            <tbody>{waivers.map((w) => (
              <tr key={w.id} data-testid="waiver-row" data-subject={w.subject}>
                <td><span className="v2-mono">{w.subject}</span><div className="v2-hint">{waiverKindLabel(w.kind)}</div></td>
                <td style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{w.reason}</td>
                <td>{w.by}</td>
                <td title={w.at}>{fmtDate(w.at)}</td>
                {may ? <td style={{ textAlign: 'right' }}><button className="btn btn-sm" disabled={busy === w.id} onClick={() => void remove(w)} aria-label={`Remove the waiver for ${w.subject}`} data-testid="waiver-remove"><Icon name="trash" size={13} />Remove</button></td> : null}
              </tr>))}</tbody>
          </table>
        )}
        {!may ? <span className="v2-hint">Only an editor, manager or owner can record or remove a waiver.</span> : null}
      </div>
    </section>
  );
}
