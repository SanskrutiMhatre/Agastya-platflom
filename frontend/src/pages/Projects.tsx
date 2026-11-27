import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { teamApi, workspaceApi } from '../api';
import { StatusBadge, BackupButton } from '../components/Oversight';
import { useSession } from '../store/session';
import { Icon } from '../components/Icon';
import { RowLink } from '../components/a11y';
import { SampleButton } from '../components/SampleButton';
import { CreateProjectModal, RoleBadge, formatLabel } from '../components/project';
import { Alert, Badge, Empty, Loading, PromptModal, ago, useAsync } from '../components/ui';
import { useUi } from '../store/ui';
import { MoreRows, useProgressive } from '../components/windowing';

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

  return (
    <div className="v2-page">
      <div className="v2-page-head">
        <div><h2>Projects</h2><p className="v2-sub">{rows.length} of {list.data?.length ?? 0} projects.</p></div>
        {/* WP-07 (UX-006): the toolbar wraps, so New project never lies beyond the right edge at 1280 or 1366 px */}
        <div className="v2-row wrap" style={{ justifyContent: 'flex-end' }}>
          <input className="v2-input" style={{ width: 240, maxWidth: '100%' }} placeholder="Search by name or folder…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
          <select className="v2-select" style={{ width: 150 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort projects">
            <option value="recent">Recently opened</option><option value="name">Name</option><option value="dms">Most data modules</option>
          </select>
          <BackupButton />
          {role === 'admin' ? null : <><button className="btn" onClick={() => setImporting(true)} data-testid="import-as-open" title="Import a package of S1000D documents (or the older publishing tool's export), or a JSS / JSG document, as a new S1000D, JSS or JSG project"><Icon name="upload" />Import package</button><SampleButton onCreated={() => list.reload()} /><SampleButton kind="jsg" onCreated={() => list.reload()} /><SampleButton kind="jsg-ispl" onCreated={() => list.reload()} /><button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />New project</button></>}
        </div>
      </div>

      <div className="v2-card">
        {rows.length === 0 ? <Empty title={q ? 'No project matches' : 'No projects yet'}>{q ? 'Try a different search.' : 'Create a project to start authoring S1000D data modules.'}</Empty> : (
          <table className="v2-table">
            <thead><tr><th>Name</th>{overseer ? <th>Status</th> : null}<th>Folder</th>{role === 'admin' ? <th>Owner</th> : <th>Your role</th>}<th>Data modules</th><th>Engine</th><th>Last opened</th><th /></tr></thead>
            <tbody>
              {rows.slice(0, shown.limit).map((p) => (
                <tr key={p.id} className="clickable" onClick={() => open(p.id)} data-testid="project-row">
                  <td><strong><RowLink href={`/projects/${p.id}`} onOpen={() => open(p.id)}>{p.name}</RowLink></strong>{p.hasPdf ? <> <Badge tone="ok">PDF built</Badge></> : null}{p.missingSince ? <> <Badge tone="bad">Folder missing</Badge></> : null}</td>
                  {overseer ? <td>{status.data?.get(p.id) ? <StatusBadge status={status.data.get(p.id)!.status} stale={status.data.get(p.id)!.changedSinceRelease} /> : null}</td> : null}
                  <td>{p.folder || <span className="v2-hint">—</span>}</td>
                  {role === 'admin' ? <td>{p.owners[0] ?? '-'}</td> : <td><RoleBadge role={p.role} /></td>}
                  <td>{p.dmCount}</td>
                  <td>{formatLabel(p)}</td>
                  <td>{ago(p.lastOpened ?? p.updatedAt)}</td>
                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    {role === 'admin' ? null : <button className="icon-btn" title="Copy project" aria-label={`Copy ${p.name}`} onClick={() => setCopying(p.id)}><Icon name="copy" /></button>}
                  </td>
                </tr>
              ))}
              <MoreRows as="tr" colSpan={8} shown={shown.limit} total={rows.length} onMore={shown.more} onAll={shown.all} />
            </tbody>
          </table>
        )}
      </div>

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
