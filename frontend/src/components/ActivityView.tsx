// The activity dashboard: who is working on what, from the audit log. Used for the whole platform
// (administrators), for a Project Manager's projects, and for one project's Team tab.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityReport } from '../api';
import { actionLabel } from '../lib/activity';
import { globalLabel } from '../lib/roles';
import { Badge, Empty, ago, fmtDate } from './ui';
import { RoleBadge } from './project';
import { Icon } from './Icon';
import { tablistKeys } from './a11y';

type Tab = 'projects' | 'people' | 'feed';

const initials = (name: string) => name.split(/\s+/).map((p) => p.charAt(0)).slice(0, 2).join('').toUpperCase();
const Avatar = ({ name }: { name: string }) => <span className="v2-avatar" aria-hidden="true">{initials(name)}</span>;

export function ActivityView({ report, single = false }: { report: ActivityReport; single?: boolean }) {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>(single ? 'people' : 'projects');
  const tabs: Array<[Tab, string]> = [['projects', single ? 'Project' : 'Projects'], ['people', 'People'], ['feed', 'Activity feed']];

  return (
    <div className="v2-stack">
      <div className="v2-tabs" role="tablist" aria-label="Activity views" onKeyDown={tablistKeys} style={{ marginBottom: 0 }}>
        {tabs.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} className={`v2-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{label}</button>)}
      </div>

      {tab === 'projects' ? (
        report.projects.length === 0 ? <div className="v2-card"><Empty title="Nothing to monitor yet">Projects you manage appear here with who is working on them.</Empty></div> : (
          <div className="v2-grid cols-2" data-testid="activity-projects">
            {report.projects.map((p) => (
              <div key={p.id} className="v2-card v2-card-pad v2-stack" data-testid="activity-project">
                <div className="v2-row v2-spread">
                  <div style={{ minWidth: 0 }}><strong className="v2-trunc" style={{ fontSize: 14.5 }}>{p.name}</strong><div className="v2-hint">{p.folder ? `${p.folder} · ` : ''}{p.dataModules} data modules</div></div>
                  <div className="v2-row">{p.pendingRelease ? <Badge tone="warn">release awaiting approval</Badge> : null}<button className="btn btn-sm" onClick={() => nav(`/projects/${p.id}`)}>Open</button></div>
                </div>
                <div className="v2-row wrap" style={{ gap: 18 }}>
                  <span><strong>{p.edits}</strong> <span className="v2-hint">edits</span></span>
                  <span><strong>{p.builds}</strong> <span className="v2-hint">builds</span></span>
                  <span><strong>{p.validations}</strong> <span className="v2-hint">validations</span></span>
                  <span className="v2-hint">last activity {p.lastActivityAt ? ago(p.lastActivityAt) : 'never'}</span>
                </div>
                <div className="v2-people">
                  {p.members.map((m) => (
                    <div key={m.userId} className="v2-person" title={`${m.fullName} · ${globalLabel(m.globalRole)}`}>
                      <Avatar name={m.fullName} /><span className="v2-trunc"><strong>{m.fullName}</strong><span className="v2-hint"> {m.edits ? `${m.edits} edits · ` : ''}{m.lastActiveAt ? ago(m.lastActiveAt) : 'not active yet'}</span></span><RoleBadge role={m.role} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'people' ? (
        <div className="v2-card" data-testid="activity-people">
          {report.people.length === 0 ? <Empty title="No people yet" /> : (
            <table className="v2-table"><thead><tr><th>Person</th><th>Role</th><th>Working on</th><th>Edits</th><th>Builds</th><th>Last active</th></tr></thead>
              <tbody>{report.people.map((p) => (
                <tr key={p.userId}>
                  <td><div className="v2-row"><Avatar name={p.fullName} /><div><strong>{p.fullName}</strong><div className="v2-hint">@{p.username}</div></div></div></td>
                  <td><Badge tone={p.globalRole === 'project_manager' ? 'accent' : undefined}>{globalLabel(p.globalRole)}</Badge></td>
                  <td>{p.projects.map((x) => <span key={x.id} className="v2-chip" onClick={() => nav(`/projects/${x.id}`)} title={x.role}>{x.name}</span>)}</td>
                  <td>{p.edits}</td><td>{p.builds}</td><td title={fmtDate(p.lastActiveAt)}>{p.lastActiveAt ? ago(p.lastActiveAt) : '—'}</td>
                </tr>))}</tbody></table>
          )}
        </div>
      ) : null}

      {tab === 'feed' ? (
        <div className="v2-card" data-testid="activity-feed">
          {report.feed.length === 0 ? <Empty title="No activity yet" /> : report.feed.map((f) => (
            <div key={f.id} className="v2-feed-row">
              <Icon name="activity" size={14} />
              <span><strong>{f.actor ?? 'system'}</strong> {actionLabel(f.action)}{f.projectName ? <> <a href={`/projects/${f.projectId}`} onClick={(e) => { e.preventDefault(); nav(`/projects/${f.projectId}`); }}>{f.projectName}</a></> : null}</span>
              <span className="v2-hint" title={fmtDate(f.at)}>{ago(f.at)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
