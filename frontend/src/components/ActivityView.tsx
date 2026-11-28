// The activity dashboard: who is working on what, from the audit log. Used for the whole platform
// (administrators), for a Project Manager's projects, and for one project's Team tab.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityReport } from '../api';
import { actionLabel } from '../lib/activity';
import { globalLabel } from '../lib/roles';
import { Badge, EmptyState, ago, fmtDate } from './ui';
import { RoleBadge } from './project';
import { Icon } from './Icon';
import { tablistKeys } from './a11y';

type Tab = 'projects' | 'people' | 'feed';

const initials = (name: string) => name.split(/\s+/).map((p) => p.charAt(0)).slice(0, 2).join('').toUpperCase();
const Avatar = ({ name }: { name: string }) => <span className="avatar" aria-hidden="true">{initials(name)}</span>;

export function ActivityView({ report, single = false }: { report: ActivityReport; single?: boolean }) {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>(single ? 'people' : 'projects');
  const tabs: Array<[Tab, string]> = [['projects', single ? 'Project' : 'Projects'], ['people', 'People'], ['feed', 'Activity feed']];

  return (
    // global UI pass (2026-11-28): the mockups' tab row, project cards with a card head (name, folder, actions) and the figures as small
    // stat columns, the people table as .table, project names as chips (buttons: they open the project), the feed as the mockup's feed list
    <div className="stack v2-act">
      <div className="tabs" role="tablist" aria-label="Activity views" onKeyDown={tablistKeys}>
        {tabs.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} className="tab" onClick={() => setTab(t)}>{label}</button>)}
      </div>

      {tab === 'projects' ? (
        report.projects.length === 0 ? <div className="card"><EmptyState icon="activity" title="Nothing to monitor yet">Projects you manage appear here with who is working on them.</EmptyState></div> : (
          <div className="v2-act-grid" data-testid="activity-projects">
            {report.projects.map((p) => (
              <section key={p.id} className="card" data-testid="activity-project" aria-label={p.name}>
                <div className="card-head">
                  <div className="v2-act-title"><h3 className="trunc" title={p.name}><Icon name="folder" />{p.name}</h3><span className="faint">{p.folder ? `${p.folder} · ` : ''}{p.dataModules} data modules</span></div>
                  <div className="row">{p.pendingRelease ? <Badge tone="warn">release awaiting approval</Badge> : null}<button className="btn sm btn-sm" onClick={() => nav(`/projects/${p.id}`)}>Open</button></div>
                </div>
                <div className="v2-act-figs">
                  <div><span className="v">{p.edits}</span><span className="l">edits</span></div>
                  <div><span className="v">{p.builds}</span><span className="l">builds</span></div>
                  <div><span className="v">{p.validations}</span><span className="l">validations</span></div>
                  <div><span className="v v-text">{p.lastActivityAt ? ago(p.lastActivityAt) : 'never'}</span><span className="l">last activity</span></div>
                </div>
                <ul className="v2-act-people">
                  {p.members.map((m) => (
                    <li key={m.userId} title={`${m.fullName} · ${globalLabel(m.globalRole)}`}>
                      <Avatar name={m.fullName} /><span className="trunc grow"><span className="nm">{m.fullName}</span><span className="faint"> {m.edits ? `${m.edits} edits · ` : ''}{m.lastActiveAt ? ago(m.lastActiveAt) : 'not active yet'}</span></span><RoleBadge role={m.role} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : null}

      {tab === 'people' ? (
        <div className="card" data-testid="activity-people">
          {report.people.length === 0 ? <EmptyState icon="users" title="No people yet" /> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Person</th><th>Role</th><th>Working on</th><th className="num">Edits</th><th className="num">Builds</th><th>Last active</th></tr></thead>
              <tbody>{report.people.map((p) => (
                <tr key={p.userId}>
                  <td><div className="row v2-act-who"><Avatar name={p.fullName} /><div className="v2-act-name"><span className="nm">{p.fullName}</span><span className="faint">@{p.username}</span></div></div></td>
                  <td><Badge tone={p.globalRole === 'project_manager' ? 'accent' : undefined}>{globalLabel(p.globalRole)}</Badge></td>
                  <td><div className="chips">{p.projects.map((x) => <button type="button" key={x.id} className="chip" onClick={() => nav(`/projects/${x.id}`)} title={`Open ${x.name} (${x.role})`}>{x.name}</button>)}</div></td>
                  <td className="num">{p.edits}</td><td className="num">{p.builds}</td><td title={fmtDate(p.lastActiveAt)}>{p.lastActiveAt ? ago(p.lastActiveAt) : '—'}</td>
                </tr>))}</tbody></table></div>
          )}
        </div>
      ) : null}

      {tab === 'feed' ? (
        <div className="card" data-testid="activity-feed">
          {report.feed.length === 0 ? <EmptyState icon="activity" title="No activity yet" /> : (
            <ul className="v2-act-feed">{report.feed.map((f) => (
              <li key={f.id}>
                <Avatar name={f.actor ?? 'system'} />
                <div className="grow"><span className="nm">{f.actor ?? 'system'}</span> {actionLabel(f.action)}{f.projectName ? <> <a href={`/projects/${f.projectId}`} onClick={(e) => { e.preventDefault(); nav(`/projects/${f.projectId}`); }}>{f.projectName}</a></> : null}
                  <div className="faint" title={fmtDate(f.at)}>{ago(f.at)}</div></div>
              </li>
            ))}</ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
