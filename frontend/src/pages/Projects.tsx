import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { teamApi, workspaceApi } from '../api';
import { StatusBadge, BackupButton } from '../components/Oversight';
import { useSession } from '../store/session';
import { Icon } from '../components/Icon';
import { RowLink } from '../components/a11y';
import { SampleMenu } from '../components/SampleButton';
import { CreateProjectModal, RoleBadge, formatLabel } from '../components/project';
import { Alert, Card, Loading, Pill, PromptModal, ago, useAsync } from '../components/ui';
import '../styles/pages/dashboard.css';   // UI redesign step 1: screen 1's parts (the card head tools, the project cell)
import { useUi } from '../store/ui';
import { MoreRows, useProgressive } from '../components/windowing';
import { useContextMenu, type MenuAction } from '../components/ContextMenu';

type Sort = 'recent' | 'name' | 'dms';

export function Projects() {
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const role = useSession((s) => s.user?.role);
  const overseer = role === 'admin' || role === 'project_manager';
  const list = useAsync(() => workspaceApi.projects(), []);
  const status = useAsync(async () => (overseer ? new Map((await teamApi.oversight()).projects.map((p) => [p.id, p])) : new Map()), [overseer]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const ctx = useContextMenu();             // WP-35 (UID-005): right-click, the Menu key or Shift+F10 on a row: the row's own actions

  const rows = useMemo(() => {
    const all = (list.data ?? []).filter((p) => !q || `${p.name} ${p.folder}`.toLowerCase().includes(q.toLowerCase()));
    return [...all].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'dms' ? b.dmCount - a.dmCount
        : String(b.lastOpened ?? b.updatedAt).localeCompare(String(a.lastOpened ?? a.updatedAt)));
  }, [list.data, q, sort]);
  const shown = useProgressive(rows.length, `${q}|${sort}`);      // WP-18 (FE-030): a long list draws its first rows, more on scroll

  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <div className="v2-page"><Alert tone="bad">{list.error}</Alert></div>;
  const folders = [...new Set((list.data ?? []).map((p) => p.folder).filter(Boolean))];
  const open = (id: string) => { void workspaceApi.open(id).catch(() => undefined); nav(`/projects/${id}`); };
  // the same actions as the row's visible controls (the name link opens, the copy button copies): nothing is only in the menu
  const rowActions = (id: string): MenuAction[] => [
    { label: 'Open', icon: 'folderOpen', onSelect: () => open(id) },
    ...(role === 'admin' ? [] : [{ label: 'Copy project…', icon: 'copy' as const, onSelect: () => setCopying(id) }]),
  ];

  return (
    <div className="v2-page dash">
      <div className="page-head">
        <div><h2>Projects</h2><p>{rows.length} of {list.data?.length ?? 0} projects.</p></div>
        {/* WP-07 (UX-006): the actions wrap, so New project never lies beyond the right edge at 1280 or 1366 px */}
        <div className="row">
          <BackupButton />
          {role === 'admin' ? null : <><button className="btn" onClick={() => setImporting(true)} data-testid="import-as-open" title="Import a package of S1000D documents (or the older publishing tool's export), or a JSS / JSG document, as a new S1000D, JSS or JSG project"><Icon name="upload" />Import package</button><SampleMenu onCreated={() => list.reload()} /><button className="btn primary btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button></>}
        </div>
      </div>

      <Card title="All projects" icon="folder" flush testId="projects-card" actions={<div className="proj-tools">
        <input className="input search" placeholder="Search by name or folder…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort projects">
          <option value="recent">Recently opened</option><option value="name">Name</option><option value="dms">Most data modules</option>
        </select>
      </div>}>
        {rows.length === 0 ? <div className="empty-state"><strong>{q ? 'No project matches' : 'No projects yet'}</strong><p className="muted">{q ? 'Try a different search.' : 'Create a project to start authoring S1000D data modules.'}</p></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Project</th>{overseer ? <th>Status</th> : null}{role === 'admin' ? <th>Owner</th> : <th>Your role</th>}<th>Data modules</th><th>Engine</th><th>Last opened</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {rows.slice(0, shown.limit).map((p) => (
                <tr key={p.id} className="clickable" onClick={() => open(p.id)} data-testid="project-row" {...ctx.bind(`Project ${p.name}`, rowActions(p.id))}>
                  <td className="proj-cell"><span className="proj-link"><span className="avatar" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span><span className="proj-text">
                    <span className="row" style={{ gap: 'var(--space-2)', minWidth: 0 }}><RowLink href={`/projects/${p.id}`} onOpen={() => open(p.id)}><span className="proj-name">{p.name}</span></RowLink>{p.hasPdf ? <Pill tone="success">PDF built</Pill> : null}{p.missingSince ? <Pill tone="danger">Folder missing</Pill> : null}</span>
                    <span className="faint">{p.folder || 'No folder'}</span>
                  </span></span></td>
                  {overseer ? <td style={{ whiteSpace: 'nowrap' }}>{status.data?.get(p.id) ? <StatusBadge status={status.data.get(p.id)!.status} stale={status.data.get(p.id)!.changedSinceRelease} /> : null}</td> : null}
                  {role === 'admin' ? <td>{p.owners[0] ?? '-'}</td> : <td><RoleBadge role={p.role} /></td>}
                  <td className="num">{p.dmCount}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLabel(p)}</td>
                  <td className="faint" style={{ whiteSpace: 'nowrap' }}>{ago(p.lastOpened ?? p.updatedAt)}</td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    {role === 'admin' ? null : <button className="icon-btn" title="Copy project" aria-label={`Copy ${p.name}`} onClick={() => setCopying(p.id)}><Icon name="copy" /></button>}
                  </td>
                </tr>
              ))}
              <MoreRows as="tr" colSpan={7} shown={shown.limit} total={rows.length} onMore={shown.more} onAll={shown.all} />
            </tbody>
          </table></div>
        )}
      </Card>

      {ctx.menu}
      {creating ? <CreateProjectModal folders={folders} onClose={() => setCreating(false)} onCreated={() => list.reload()} /> : null}
      {importing ? <CreateProjectModal folders={folders} startWith="import" onClose={() => setImporting(false)} onCreated={() => list.reload()} /> : null}
      {copying ? (
        <PromptModal title="Copy project" label="Name of the copy" confirmLabel="Copy" hint="Copies every data module, setting and the publication. You become its owner."
          initial={`${list.data?.find((p) => p.id === copying)?.name} (copy)`} onClose={() => setCopying(null)}
          onSubmit={async (name) => { const p = await workspaceApi.copyProject(copying, { name }); toast(`Copied to "${p.name}"`, 'success'); list.reload(); }} />
      ) : null}
    </div>
  );
}
