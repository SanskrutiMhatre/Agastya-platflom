// Activity: the oversight page for administrators (everything) and Project Managers (the projects
// they manage) - who is working on what, and the release requests waiting for a decision.

import { useState } from 'react';
import { contentApi, teamApi } from '../api';
import { ActivityView } from '../components/ActivityView';
import { Alert, Badge, Empty, Loading, errText, fmtDate, useAsync } from '../components/ui';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';

export function Activity() {
  const user = useSession((s) => s.user);
  const toast = useUi((s) => s.toast);
  const [days, setDays] = useState(7);
  const rep = useAsync(() => teamApi.activity(days), [days]);
  const queue = useAsync(() => teamApi.approvals(), []);

  const decide = async (projectId: string, id: string, approve: boolean) => {
    try { await contentApi.decideRelease(projectId, id, approve); toast(approve ? 'Release approved' : 'Release rejected', 'success'); queue.reload(); rep.reload(); }
    catch (e) { toast(errText(e), 'error'); }
  };

  if (rep.loading && !rep.data) return <Loading />;
  if (rep.error || !rep.data) return <div className="v2-page"><Alert tone="bad">{rep.error || 'Could not load activity.'}</Alert></div>;
  const r = rep.data;

  return (
    <div className="v2-page">
      <div className="v2-page-head">
        <div><h2>Activity</h2><p className="v2-sub">{user?.role === 'admin' ? 'Everything happening across the platform.' : 'The projects you manage and the people working on them.'} Last {r.days} days.</p></div>
        <select className="v2-select" style={{ width: 150 }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time window">
          <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
      </div>

      <div className="v2-grid cols-4" style={{ marginBottom: 18 }}>
        <div className="v2-card v2-kpi"><div className="n">{r.totals.projects}</div><div className="l">Projects</div></div>
        <div className="v2-card v2-kpi"><div className="n">{r.totals.people}</div><div className="l">People</div></div>
        <div className="v2-card v2-kpi"><div className="n">{r.totals.edits}</div><div className="l">Edits</div></div>
        <div className="v2-card v2-kpi"><div className="n" style={{ color: r.totals.pendingApprovals ? 'var(--warning)' : undefined }}>{r.totals.pendingApprovals}</div><div className="l">Awaiting approval</div></div>
      </div>

      <div className="v2-card" style={{ marginBottom: 18 }} data-testid="approvals-queue">
        <div className="v2-card-head"><span>Release requests waiting for you <Badge tone={queue.data?.length ? 'warn' : undefined}>{queue.data?.length ?? 0}</Badge></span></div>
        {queue.loading && !queue.data ? <Loading /> : !queue.data?.length ? <Empty title="Nothing waiting">When an Author asks for a release in a project you manage, it appears here.</Empty> : (
          <table className="v2-table"><thead><tr><th>Project</th><th>Requested by</th><th>Takes effect</th><th>Note</th><th /></tr></thead>
            <tbody>{queue.data.map((a) => (
              <tr key={a.id}><td><strong>{a.projectName}</strong></td><td>{a.requestedBy ?? '—'}</td><td>{fmtDate(a.scheduledAt)}</td><td>{a.note ?? ''}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-primary" onClick={() => decide(a.projectId, a.id, true)}>Approve</button>{' '}
                  <button className="btn btn-sm" onClick={() => decide(a.projectId, a.id, false)}>Reject</button></td></tr>))}</tbody></table>
        )}
      </div>

      <ActivityView report={r} />
    </div>
  );
}
