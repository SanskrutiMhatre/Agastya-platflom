// Phase 3 (P3-5): the project's GitLab repository. Link (create a repository in a group, or pick one), push the project's source files as
// one commit, pull what changed in GitLab (summary first; changes on both sides are merged line by line where they do not touch, and a
// conflict is never resolved silently: the person keeps theirs or takes GitLab's, file by file), branches, history, PDFs stored as GitLab
// releases, and reviews as merge requests. The page exists only while an administrator has GitLab switched on (the rail hides it otherwise).
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { gitlabApi, type GitlabIncoming, type GitlabStatus } from '../../api/gitlab';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Callout, Field, Loading, Pill, errText, fmtDate, useAsync } from '../../components/ui';
import { GitlabConnectCard } from '../../components/GitlabConnect';
import { GitlabMergeRequests, atLeast } from '../../components/GitlabMrs';
import { useProject } from '../../layouts/ProjectShell';
import { useUi } from '../../store/ui';

const CHANGE: Record<string, string> = { added: 'new', modified: 'changed', deleted: 'deleted' };
const short = (sha: string | null | undefined): string => (sha ? sha.slice(0, 8) : '—');

function LinkCard({ id, onLinked }: { id: string; onLinked: () => void }) {
  const toast = useUi((s) => s.toast);
  const [mode, setMode] = useState<'create' | 'existing'>('create');
  const ns = useAsync(() => gitlabApi.namespaces(id), [id]);
  const [nsId, setNsId] = useState<number | ''>('');
  const [name, setName] = useState(''); const [path, setPath] = useState(''); const [branch, setBranch] = useState('main');
  const [search, setSearch] = useState(''); const [found, setFound] = useState<Array<{ id: number; path: string; defaultBranch: string | null }> | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const find = async () => { setErr(''); try { setFound(await gitlabApi.remoteProjects(id, search)); } catch (e) { setErr(errText(e)); } };
  const link = async () => {
    setBusy(true); setErr('');
    try {
      const l = mode === 'create'
        ? await gitlabApi.link(id, { mode: 'create', namespaceId: nsId === '' ? undefined : nsId, name: name.trim(), path: path.trim() || undefined, branch: branch.trim() || 'main' })
        : await gitlabApi.link(id, { mode: 'existing', gitlabProjectId: pick!, branch: branch.trim() || undefined });
      toast(`Linked to ${l.path}`, 'success'); onLinked();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="card" aria-labelledby="gl-link-h" data-testid="gitlab-link">
      <div className="card-head"><h3 id="gl-link-h"><Icon name="link" />Link a repository</h3></div>
      <div className="card-body stack adm-gap">
        <div className="row" role="radiogroup" aria-label="Repository">
          <label className="row"><input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} data-testid="gitlab-link-mode-create" />Create a new repository</label>
          <label className="row"><input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} data-testid="gitlab-link-mode-existing" />Use an existing one</label>
        </div>
        {mode === 'create' ? (
          <div className="adm-grid-2">
            <Field label="Group"><select className="input" value={nsId} onChange={(e) => setNsId(e.target.value ? Number(e.target.value) : '')} data-testid="gitlab-link-namespace">
              <option value="">My own namespace</option>{(ns.data ?? []).map((n) => <option key={n.id} value={n.id}>{n.path}</option>)}</select></Field>
            <Field label="Repository name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="gitlab-link-name" /></Field>
            <Field label="Path" hint="Optional; made from the name."><input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} data-testid="gitlab-link-path" /></Field>
            <Field label="Branch"><input className="input mono" value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="gitlab-link-branch" /></Field>
          </div>
        ) : (
          <div className="stack adm-gap">
            <div className="row"><input className="input" placeholder="Search your GitLab projects" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void find(); }} data-testid="gitlab-link-search" /><button className="btn" onClick={() => void find()}><Icon name="search" />Find</button></div>
            {found ? (found.length ? (
              <div className="stack">{found.map((p) => <label key={p.id} className="row"><input type="radio" checked={pick === p.id} onChange={() => { setPick(p.id); if (p.defaultBranch) setBranch(p.defaultBranch); }} data-testid={`gitlab-link-pick-${p.id}`} /><span className="mono">{p.path}</span></label>)}</div>
            ) : <p className="faint">No project of yours matches.</p>) : null}
            <Field label="Branch"><input className="input mono" value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
          </div>
        )}
        {err ? <Callout tone="danger">{err}</Callout> : null}
        <div className="row end"><button className="btn primary" disabled={busy || (mode === 'create' ? !name.trim() : pick === null)} onClick={() => void link()} data-testid="gitlab-link-go"><Icon name="link" />Link</button></div>
      </div>
    </section>
  );
}

function PullPanel({ id, inc, onDone, onCancel }: { id: string; inc: GitlabIncoming; onDone: () => void; onCancel: () => void }) {
  const toast = useUi((s) => s.toast);
  const [res, setRes] = useState<Record<string, 'mine' | 'theirs'>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const open = inc.conflicts.filter((p) => !res[p]);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await gitlabApi.pull(id, { expectHead: inc.head, resolutions: res });
      toast(`Pulled: ${r.applied.length} file${r.applied.length === 1 ? '' : 's'} updated${r.kept.length ? `, ${r.kept.length} kept as yours` : ''}${r.blocked.length ? `, ${r.blocked.length} not written` : ''}`, r.blocked.length ? 'info' : 'success');
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const changes = inc.items.filter((i) => i.action !== 'same');
  return (
    <section className="card" aria-labelledby="gl-pull-h" data-testid="gitlab-pull-panel">
      <div className="card-head"><h3 id="gl-pull-h"><Icon name="download" />Changes in GitLab</h3><Pill>{inc.commits.length} commit{inc.commits.length === 1 ? '' : 's'}</Pill></div>
      <div className="card-body stack adm-gap">
        {inc.commits.length ? <ul className="adm-xs">{inc.commits.map((c) => <li key={c.id}><span className="mono">{short(c.id)}</span> {c.title} <span className="faint">· {c.author} · {fmtDate(c.at)}</span></li>)}</ul> : null}
        <div className="table-wrap"><table className="table"><thead><tr><th>File</th><th className="adm-w-180">In GitLab</th><th>What happens</th></tr></thead>
          <tbody>{changes.map((i) => (
            <tr key={i.path} data-testid={`gitlab-pull-item-${i.action}`}>
              <td className="mono adm-xs">{i.path}</td><td>{CHANGE[i.change]}</td>
              <td>{i.action === 'apply' ? 'Taken from GitLab' : i.action === 'merge' ? <Pill tone="info">Merged with your changes</Pill> : i.action === 'blocked' ? <Pill tone="warning">{i.reason ?? 'Not written'}</Pill> : (
                <div className="row wrap"><Pill tone="danger">Changed on both sides</Pill>
                  <label className="row"><input type="radio" name={`r-${i.path}`} checked={res[i.path] === 'mine'} onChange={() => setRes({ ...res, [i.path]: 'mine' })} data-testid="gitlab-resolve-mine" />Keep mine</label>
                  <label className="row"><input type="radio" name={`r-${i.path}`} checked={res[i.path] === 'theirs'} onChange={() => setRes({ ...res, [i.path]: 'theirs' })} data-testid="gitlab-resolve-theirs" />Take GitLab's</label></div>
              )}</td>
            </tr>
          ))}</tbody></table></div>
        {open.length ? <Callout tone="warning">Choose for each file changed on both sides. Nothing is overwritten without your choice; the previous version stays in each file's history.</Callout> : null}
        {err ? <Callout tone="danger">{err}</Callout> : null}
        <div className="row end"><button className="btn" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy || open.length > 0} onClick={() => void go()} data-testid="gitlab-pull-apply"><Icon name="download" />{busy ? 'Pulling…' : 'Pull'}</button></div>
      </div>
    </section>
  );
}

function Linked({ id, role, st, reload }: { id: string; role: string; st: GitlabStatus & { link: NonNullable<GitlabStatus['link']> }; reload: () => void }) {
  const toast = useUi((s) => s.toast);
  const l = st.link;
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [inc, setInc] = useState<GitlabIncoming | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [tick, setTick] = useState(0);
  const branches = useAsync(() => gitlabApi.branches(id), [id, tick]);
  const history = useAsync(() => gitlabApi.commits(id), [id, tick]);
  const refresh = () => { setTick((t) => t + 1); reload(); };
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok, 'success'); refresh(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(''); }
  };
  const loadIncoming = async () => { setBusy('incoming'); try { setInc(await gitlabApi.incoming(id)); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(''); } };
  const editor = atLeast(role, 'editor'); const manager = atLeast(role, 'manager');
  return (
    <div className="pp-cols">
      <div className="pp-stack">
        <section className="card" aria-labelledby="gl-st-h" data-testid="gitlab-status">
          <div className="card-head"><h3 id="gl-st-h"><Icon name="branch" />{l.path}</h3>
            {l.webUrl ? <a className="btn sm" href={l.webUrl} target="_blank" rel="noreferrer"><Icon name="external" />Open in GitLab</a> : null}</div>
          <div className="card-body stack adm-gap">
            <p>Branch <strong className="mono" data-testid="gitlab-branch">{l.branch}</strong> · last synced commit <span className="mono">{short(l.baseCommit)}</span>{l.lastPushAt ? ` · pushed ${fmtDate(l.lastPushAt)}` : ''}{l.lastPullAt ? ` · pulled ${fmtDate(l.lastPullAt)}` : ''}</p>
            {st.remote?.error ? <Callout tone="warning">{st.remote.error}</Callout> : st.remote?.behind ? <Callout tone="info" testId="gitlab-behind">GitLab has changes this project does not have yet. Pull them before you push.</Callout> : null}
            <div>
              <h4>Your changes not in GitLab <span className="count">{st.local.length}</span></h4>
              {st.local.length ? <ul className="adm-xs" data-testid="gitlab-local">{st.local.map((c) => <li key={c.path}><span className="mono">{c.path}</span> <span className="faint">({CHANGE[c.change]})</span></li>)}</ul> : <p className="faint">None: GitLab has everything.</p>}
            </div>
            {editor ? (
              <>
                <Field label="Commit message"><input className="input" value={msg} maxLength={500} onChange={(e) => setMsg(e.target.value)} placeholder="What changed" data-testid="gitlab-commit-message" /></Field>
                <div className="row end">
                  <button className="btn" disabled={!!busy} onClick={() => void loadIncoming()} data-testid="gitlab-incoming"><Icon name="download" />{busy === 'incoming' ? 'Reading…' : 'Pull…'}</button>
                  <button className="btn primary" disabled={!!busy || !st.local.length} onClick={() => void act('push', async () => { await gitlabApi.push(id, msg); setMsg(''); }, 'Pushed to GitLab')} data-testid="gitlab-push"><Icon name="upload" />{busy === 'push' ? 'Pushing…' : 'Push'}</button>
                </div>
              </>
            ) : <p className="faint">Editors push and pull; you can read the state.</p>}
          </div>
        </section>
        {inc ? (inc.upToDate ? <Callout tone="success" testId="gitlab-up-to-date" actions={<button className="btn sm" onClick={() => setInc(null)}>Close</button>}>The project already has everything on {inc.branch}.</Callout>
          : <PullPanel id={id} inc={inc} onCancel={() => setInc(null)} onDone={() => { setInc(null); refresh(); }} />) : null}
        <GitlabMergeRequests id={id} role={role} allowOpen onSynced={refresh} />
        <section className="card" aria-labelledby="gl-hist-h" data-testid="gitlab-history">
          <div className="card-head"><h3 id="gl-hist-h"><Icon name="history" />History</h3></div>
          {history.error ? <div className="card-body"><Callout tone="warning">{history.error}</Callout></div> : (
            <div className="table-wrap"><table className="table"><thead><tr><th className="adm-w-180">Commit</th><th>Message</th><th className="adm-w-180">Author</th><th className="adm-w-180">When</th></tr></thead>
              <tbody>{(history.data?.commits ?? []).map((c) => <tr key={c.id}><td className="mono">{c.webUrl ? <a href={c.webUrl} target="_blank" rel="noreferrer">{c.shortId}</a> : c.shortId}</td><td>{c.title}</td><td>{c.author}</td><td>{fmtDate(c.at)}</td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>
      <aside className="pp-stack">
        <section className="card" aria-labelledby="gl-br-h" data-testid="gitlab-branches">
          <div className="card-head"><h3 id="gl-br-h"><Icon name="branch" />Branches</h3></div>
          <div className="card-body stack adm-gap">
            {branches.error ? <Callout tone="warning">{branches.error}</Callout> : (
              <ul className="stack">{(branches.data?.branches ?? []).map((b) => (
                <li key={b.name} className="row wrap"><span className="mono">{b.name}</span>{b.name === l.branch ? <Pill tone="info">this project</Pill> : manager ? <button className="btn sm" disabled={!!busy} onClick={() => void act(`sw-${b.name}`, () => gitlabApi.switchBranch(id, b.name), `Switched to ${b.name}`)} data-testid={`gitlab-switch-${b.name}`}>Switch</button> : null}</li>
              ))}</ul>
            )}
            {editor ? <div className="row"><input className="input mono" placeholder="new-branch" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} aria-label="New branch name" data-testid="gitlab-new-branch" />
              <button className="btn" disabled={!!busy || !newBranch.trim()} onClick={() => void act('nb', async () => { await gitlabApi.createBranch(id, newBranch.trim()); setNewBranch(''); }, 'Branch created')} data-testid="gitlab-create-branch"><Icon name="plus" />Create</button></div> : null}
            {manager ? <p className="faint adm-xs">Switching needs every change pushed first; the project then takes the branch's files.</p> : null}
          </div>
        </section>
        <ReleasesCard id={id} manager={manager} st={st} onDone={refresh} />
        {manager ? <OptionsCard id={id} st={st} onDone={reload} /> : null}
      </aside>
    </div>
  );
}

function ReleasesCard({ id, manager, st, onDone }: { id: string; manager: boolean; st: GitlabStatus; onDone: () => void }) {
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false); const [zip, setZip] = useState(true);
  const up = async (kind: 'release' | 'build') => {
    setBusy(true);
    try { const r = await gitlabApi.uploadRelease(id, { kind, includeArchive: zip }); toast(`Stored in GitLab as ${r.tag}`, 'success'); onDone(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <section className="card" aria-labelledby="gl-rel-h" data-testid="gitlab-releases">
      <div className="card-head"><h3 id="gl-rel-h"><Icon name="package" />PDFs in GitLab <span className="count">{st.releases.length}</span></h3></div>
      <div className="card-body stack adm-gap">
        {st.releases.length ? <ul className="stack adm-xs">{st.releases.map((r) => <li key={r.id} data-testid={`gitlab-release-${r.tag}`}><strong className="mono">{r.tag}</strong> <span className="faint">· {r.kind} · {fmtDate(r.at)}{r.by ? ` · ${r.by}` : ''}</span>{r.webUrl ? <> · <a href={r.webUrl} target="_blank" rel="noreferrer">open</a></> : null}</li>)}</ul> : <p className="faint">No PDF stored in GitLab yet.</p>}
        {manager ? (
          <>
            <label className="row"><input type="checkbox" checked={zip} onChange={(e) => setZip(e.target.checked)} />With the project package (zip)</label>
            <div className="row end">
              <button className="btn" disabled={busy || !st.hasPdf} title={st.hasPdf ? undefined : 'Build the PDF first'} onClick={() => void up('build')} data-testid="gitlab-upload-build"><Icon name="upload" />Store this build</button>
              <button className="btn primary" disabled={busy || !st.hasPdf} onClick={() => void up('release')} data-testid="gitlab-upload-release"><Icon name="rocket" />Store the release</button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function OptionsCard({ id, st, onDone }: { id: string; st: GitlabStatus & { link: NonNullable<GitlabStatus['link']> }; onDone: () => void }) {
  const toast = useUi((s) => s.toast);
  const o = st.link.options;
  const [unlinking, setUnlinking] = useState(false);
  const set = async (k: 'countApprovals' | 'releaseOnApproval', v: boolean) => { try { await gitlabApi.options(id, { [k]: v }); onDone(); } catch (e) { toast(errText(e), 'error'); } };
  return (
    <section className="card" aria-labelledby="gl-opt-h" data-testid="gitlab-options">
      <div className="card-head"><h3 id="gl-opt-h"><Icon name="sliders" />GitLab and the release</h3></div>
      <div className="card-body stack adm-gap">
        <div className="toggle"><span><div className="t">GitLab approvals count</div><div className="d">When the merge request is approved in GitLab by the Project Manager (connected to GitLab), the pending release is approved under their name.</div></span>
          <input type="checkbox" className="switch" role="switch" checked={o.countApprovals} onChange={(e) => void set('countApprovals', e.target.checked)} aria-label="GitLab approvals count" data-testid="gitlab-opt-count" /></div>
        <div className="toggle"><span><div className="t">Store every release in GitLab</div><div className="d">After each approval the released PDF is built and stored as a GitLab release.</div></span>
          <input type="checkbox" className="switch" role="switch" checked={o.releaseOnApproval} onChange={(e) => void set('releaseOnApproval', e.target.checked)} aria-label="Store every release in GitLab" data-testid="gitlab-opt-release" /></div>
        <div className="row end">{unlinking
          ? <><span className="faint adm-xs">GitLab is not changed.</span><button className="btn sm" onClick={() => setUnlinking(false)}>Keep</button><button className="btn sm" onClick={() => void gitlabApi.unlink(id).then(onDone, (e) => toast(errText(e), 'error'))} data-testid="gitlab-unlink-confirm">Unlink</button></>
          : <button className="btn sm" onClick={() => setUnlinking(true)} data-testid="gitlab-unlink">Unlink</button>}</div>
      </div>
    </section>
  );
}

export function RepositoryPage() {
  const { id, role } = useProject();
  const st = useAsync(() => gitlabApi.status(id), [id]);
  if (st.loading && !st.data) return <Loading />;
  if (!st.loading && st.data === null && !st.error) return <Navigate to={`/projects/${id}/home`} replace />;   // GitLab is off
  const s = st.data;
  const connect = !s?.account;
  return (
    <div className="v2-page pp" data-testid="repository-page">
      <PageHeader icon="branch" title="Repository" sub="Keep the project's sources in GitLab: push, pull, branches, stored PDFs and reviews as merge requests."
        stats={s?.link ? [{ label: 'Branch', value: s.link.branch }, { label: 'To push', value: s.local.length, tone: s.local.length ? 'warn' : undefined }, { label: 'GitLab ahead', value: s.remote?.behind ? 'Yes' : 'No', tone: s.remote?.behind ? 'warn' : undefined }] : undefined} />
      {st.error ? <Callout tone="danger">{st.error}</Callout> : null}
      {connect ? <div className="pp-gap"><GitlabConnectCard returnTo={`/projects/${id}/repository`} onChange={st.reload} compact={!!s?.link} /></div> : null}
      {s && !s.link ? (atLeast(role, 'manager')
        ? (connect ? <Callout tone="info">Connect your GitLab account to link a repository.</Callout> : <LinkCard id={id} onLinked={st.reload} />)
        : <Callout tone="info">This project is not linked to a GitLab repository. The project's managers link it.</Callout>) : null}
      {s?.link ? <Linked id={id} role={role} st={s as GitlabStatus & { link: NonNullable<GitlabStatus['link']> }} reload={st.reload} /> : null}
    </div>
  );
}
