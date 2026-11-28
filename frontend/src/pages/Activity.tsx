// Activity: the oversight page for administrators (everything) and Project Managers (the projects
// they manage) - who is working on what, and the release requests waiting for a decision.

import { useState } from 'react';
import { contentApi, teamApi } from '../api';
import { ActivityView } from '../components/ActivityView';
import { Icon } from '../components/Icon';
import { Callout, Empty, Loading, Pill, errText, fmtDate, useAsync } from '../components/ui';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import '../styles/pages/admin.css';   // UI redesign screen 6: the administration look of the global pages
import { AdmHead, HealthTile } from './adminParts';

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
  if (rep.error || !rep.data) return <div className="v2-page adm"><Callout tone="danger">{rep.error || 'Could not load activity.'}</Callout></div>;
  const r = rep.data;

  return (
    <div className="v2-page adm">
      <AdmHead title="Activity" sub={<>{user?.role === 'admin' ? 'Everything happening across the platform.' : 'The projects you manage and the people working on them.'} Last {r.days} days.</>}
        actions={<select className="select w-150" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time window">
          <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>} />

      <section className="hh hh-4" aria-label="Totals">
        <HealthTile label="Projects" tone="info" value={r.totals.projects} line={`with activity in the last ${r.days} days`} />
        <HealthTile label="People" tone="info" value={r.totals.people} line="who worked in them" />
        <HealthTile label="Edits" tone={r.totals.edits ? 'success' : undefined} value={r.totals.edits} line="saved changes" />
        <HealthTile label="Awaiting approval" tone={r.totals.pendingApprovals ? 'warning' : 'success'} value={r.totals.pendingApprovals} line={r.totals.pendingApprovals ? 'release requests to decide' : 'nothing waiting'} />
      </section>

      <section className="card mb4" data-testid="approvals-queue" aria-labelledby="queue-h">
        <div className="card-head"><h3 id="queue-h"><Icon name="stamp" />Release requests waiting for you <span className="count">{queue.data?.length ?? 0}</span></h3>{queue.data?.length ? <Pill tone="warning">To decide</Pill> : null}</div>
        {queue.loading && !queue.data ? <Loading /> : !queue.data?.length ? <Empty title="Nothing waiting">When an Author asks for a release in a project you manage, it appears here.</Empty> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Project</th><th>Requested by</th><th>Takes effect</th><th>Note</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>{queue.data.map((a) => (
              <tr key={a.id}><td><strong>{a.projectName}</strong></td><td>{a.requestedBy ?? '—'}</td><td>{fmtDate(a.scheduledAt)}</td><td>{a.note ?? ''}</td>
                <td className="adm-td-end">
                  <button className="btn btn-sm btn-primary" onClick={() => decide(a.projectId, a.id, true)}>Approve</button>{' '}
                  <button className="btn btn-sm" onClick={() => decide(a.projectId, a.id, false)}>Reject</button></td></tr>))}</tbody></table></div>
        )}
      </section>

      <ActivityView report={r} />
    </div>
  );
}
