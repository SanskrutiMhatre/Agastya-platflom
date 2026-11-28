// Activity: the oversight page for administrators (everything) and Project Managers (the projects
// they manage) - who is working on what, and the release requests waiting for a decision.

import { useState } from 'react';
import { contentApi, teamApi } from '../api';
import { ActivityView } from '../components/ActivityView';
import { Icon } from '../components/Icon';
import { Alert, Badge, Empty, Loading, StatTile, errText, fmtDate, useAsync } from '../components/ui';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import '../styles/pages/admin.css';   // UI redesign screen 6: the administration look of the global pages
import { AdmHead } from './adminParts';

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
  if (rep.error || !rep.data) return <div className="v2-page adm"><Alert tone="bad">{rep.error || 'Could not load activity.'}</Alert></div>;
  const r = rep.data;

  return (
    <div className="v2-page adm">
      <AdmHead title="Activity" sub={<>{user?.role === 'admin' ? 'Everything happening across the platform.' : 'The projects you manage and the people working on them.'} Last {r.days} days.</>}
        actions={<select className="v2-select w-150" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time window">
          <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>} />

      <section className="hh hh-4" aria-label="Totals">
        <StatTile label="Projects" value={r.totals.projects} tone="info" />
        <StatTile label="People" value={r.totals.people} tone="info" />
        <StatTile label="Edits" value={r.totals.edits} tone={r.totals.edits ? 'success' : undefined} />
        <StatTile label="Awaiting approval" value={r.totals.pendingApprovals} tone={r.totals.pendingApprovals ? 'warning' : 'success'} />
      </section>

      <section className="card mb4" data-testid="approvals-queue" aria-labelledby="queue-h">
        <div className="card-head"><h3 id="queue-h"><Icon name="stamp" />Release requests waiting for you <Badge tone={queue.data?.length ? 'warn' : undefined}>{queue.data?.length ?? 0}</Badge></h3></div>
        {queue.loading && !queue.data ? <Loading /> : !queue.data?.length ? <Empty title="Nothing waiting">When an Author asks for a release in a project you manage, it appears here.</Empty> : (
          <table className="v2-table"><thead><tr><th>Project</th><th>Requested by</th><th>Takes effect</th><th>Note</th><th /></tr></thead>
            <tbody>{queue.data.map((a) => (
              <tr key={a.id}><td><strong>{a.projectName}</strong></td><td>{a.requestedBy ?? '—'}</td><td>{fmtDate(a.scheduledAt)}</td><td>{a.note ?? ''}</td>
                <td className="v2-td-end">
                  <button className="btn btn-sm btn-primary" onClick={() => decide(a.projectId, a.id, true)}>Approve</button>{' '}
                  <button className="btn btn-sm" onClick={() => decide(a.projectId, a.id, false)}>Reject</button></td></tr>))}</tbody></table>
        )}
      </section>

      <ActivityView report={r} />
    </div>
  );
}
