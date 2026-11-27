// "Publish waivers": the recorded decisions to build DRAFTS without a BREX the project does not have. Anyone who can see the project reads them;
// an editor or above can withdraw one. A waiver never covers a release request or approval.
// WP-29 (ENT-017): a waiver may expire; the removal asks for a reason; the history of additions, replacements and removals is shown.

import { useState } from 'react';
import type { ProjectRole } from '../../api';
import { waiverApi, type Waiver } from '../../api/waivers';
import { Alert, Badge, Empty, Loading, PromptModal, errText, fmtDate, useAsync } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { canRecordWaiver, type Can } from '../../lib/roles';
import { waiverKindLabel } from '../../lib/waivers';
import { useUi } from '../../store/ui';

const EVENT_LABEL: Record<string, string> = { added: 'Recorded', replaced: 'Replaced', removed: 'Removed' };

export function PublishWaivers({ projectId, can, refreshKey }: { projectId: string; can: Can; refreshKey: number }) {
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => waiverApi.list(projectId), [projectId, refreshKey]);
  const [removing, setRemoving] = useState<Waiver | null>(null);
  const may = canRecordWaiver(can);

  const remove = async (w: Waiver, why: string) => {
    await waiverApi.remove(projectId, w.id, why);
    toast(`Waiver for ${w.subject} removed. A build that needs it is refused again.`, 'success'); list.reload();
  };

  const waivers = list.data?.waivers ?? [];
  const history = list.data?.history ?? [];
  const inForce = waivers.filter((w) => !w.expired).length;
  return (
    <section className="v2-card" style={{ marginTop: 16 }} aria-label="Publish waivers" data-testid="publish-waivers">
      <div className="v2-card-head"><span>Publish waivers <Badge tone={inForce ? 'warn' : undefined}>{inForce}</Badge></span></div>
      <div className="v2-card-pad v2-stack" style={{ gap: 8 }}>
        <p className="v2-hint" style={{ margin: 0 }}>
          The build is strict: a data module that names a BREX this project does not have is not built. When that is the only problem, an editor can record a waiver here to
          allow <strong>draft</strong> builds without it. Every build that relies on one says so in its log. <strong>A waiver never covers a release request or approval.</strong>
        </p>
        {list.loading && !list.data ? <Loading /> : list.error ? <Alert tone="bad">{list.error}</Alert> : waivers.length === 0 ? (
          <Empty title="No waivers">Nothing is being waived. A build that names a missing BREX is refused and offers to record one.</Empty>
        ) : (
          <table className="v2-table" data-testid="waiver-list">
            <thead><tr><th>Subject</th><th>Reason</th><th>Recorded by</th><th>Date</th><th>Expires</th>{may ? <th /> : null}</tr></thead>
            <tbody>{waivers.map((w) => (
              <tr key={w.id} data-testid="waiver-row" data-subject={w.subject}>
                <td><span className="v2-mono">{w.subject}</span><div className="v2-hint">{waiverKindLabel(w.kind)}</div></td>
                <td style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{w.reason}</td>
                <td>{w.by}</td>
                <td title={w.at}>{fmtDate(w.at)}</td>
                <td data-testid="waiver-expiry-cell">{w.expiresAt ? <span title={w.expiresAt}>{fmtDate(w.expiresAt)}{w.expired ? <> <Badge tone="bad">expired</Badge></> : null}</span> : <span className="v2-hint">never</span>}</td>
                {may ? <td style={{ textAlign: 'right' }}><button className="btn btn-sm" onClick={() => setRemoving(w)} aria-label={`Remove the waiver for ${w.subject}`} data-testid="waiver-remove"><Icon name="trash" size={13} />Remove</button></td> : null}
              </tr>))}</tbody>
          </table>
        )}
        {history.length ? (
          <details data-testid="waiver-history">
            <summary>History ({history.length})</summary>
            <table className="v2-table" style={{ marginTop: 6 }}>
              <thead><tr><th>When</th><th>What</th><th>Subject</th><th>Reason</th><th>By</th></tr></thead>
              <tbody>{history.map((e) => (
                <tr key={e.id} data-testid="waiver-history-row">
                  <td title={e.at}>{fmtDate(e.at)}</td>
                  <td>{EVENT_LABEL[e.event] ?? e.event}</td>
                  <td className="v2-mono">{e.subject}</td>
                  <td style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{e.reason ?? <span className="v2-hint">none given</span>}</td>
                  <td>{e.by ?? ''}</td>
                </tr>))}</tbody>
            </table>
          </details>
        ) : null}
        {!may ? <span className="v2-hint">Only an editor, manager or owner can record or remove a waiver.</span> : null}
      </div>
      {removing ? (
        <PromptModal title={`Remove the waiver for ${removing.subject}`} label="Why is it removed? (kept in the history)" confirmLabel="Remove"
          hint="A build that needs this waiver is refused again." onSubmit={(why) => remove(removing, why).catch((e) => { throw new Error(errText(e)); })}
          onClose={() => setRemoving(null)} />
      ) : null}
    </section>
  );
}

