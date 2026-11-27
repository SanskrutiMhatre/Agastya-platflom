// Explore: the hierarchy of the publication (chapters and the data modules in
// them) with the data modules that are not in it, and the entries that point at
// modules the project does not have. Read-only by design - rearranging is the
// Publication screen's job; this is for finding things and seeing the shape.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentApi, type DmSummary, type ExploreNode } from '../../api';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Empty, Loading, Modal, fmtDate, fmtSize, useAsync, ago, errText } from '../../components/ui';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { may } from '../../lib/roles';
import { useUi } from '../../store/ui';

type Sel = { file: string } | { missing: string } | null;

function matches(n: ExploreNode, q: string): boolean {
  if (!q) return true;
  const t = q.toLowerCase();
  if (n.kind === 'chapter') return n.title.toLowerCase().includes(t) || n.children.some((c) => matches(c, q));
  if (n.kind === 'dm') return `${n.title} ${n.dmc} ${n.file} ${n.infoName}`.toLowerCase().includes(t);
  if (n.kind === 'missing') return `${n.title} ${n.ref}`.toLowerCase().includes(t);
  return n.title.toLowerCase().includes(t);
}

function Node({ n, path, open, toggle, sel, setSel, q, depth }: { n: ExploreNode; path: string; open: Set<string>; toggle: (k: string) => void; sel: Sel; setSel: (s: Sel) => void; q: string; depth: number }) {
  if (!matches(n, q)) return null;
  if (n.kind === 'chapter') {
    const isOpen = q ? true : open.has(path);
    return (
      <li>
        <div className="v2-tnode" onClick={() => toggle(path)} role="treeitem" aria-expanded={isOpen} aria-level={depth + 1}>
          <span className="v2-twist"><Icon name={isOpen ? 'down' : 'right'} size={13} /></span>
          <Icon name={isOpen ? 'folderOpen' : 'folder'} size={15} /><span className="lbl">{n.title}</span>
          <span className="meta">{n.dmCount} data module{n.dmCount === 1 ? '' : 's'}</span>
        </div>
        {isOpen && n.children.length ? <ul role="group">{n.children.map((c, i) => <Node key={i} n={c} path={`${path}.${i}`} open={open} toggle={toggle} sel={sel} setSel={setSel} q={q} depth={depth + 1} />)}</ul> : null}
      </li>
    );
  }
  if (n.kind === 'dm') {
    const on = !!sel && 'file' in sel && sel.file === n.file;
    return (
      <li><div className={`v2-tnode ${on ? 'sel' : ''}`} onClick={() => setSel({ file: n.file })} role="treeitem" aria-selected={on} aria-level={depth + 1} data-testid="explore-dm">
        <span className="v2-twist" /><Icon name="xml" size={15} /><span className="lbl">{n.title}</span><span className="meta v2-mono">{n.dmc}</span>
      </div></li>
    );
  }
  if (n.kind === 'missing') {
    return (
      <li><div className={`v2-tnode ${sel && 'missing' in sel && sel.missing === n.ref ? 'sel' : ''}`} onClick={() => setSel({ missing: n.ref })} role="treeitem" aria-level={depth + 1}>
        <span className="v2-twist" /><Icon name="alert" size={15} /><span className="lbl" style={{ color: 'var(--danger)' }}>{n.title}</span><span className="meta">no data module</span>
      </div></li>
    );
  }
  return <li><div className="v2-tnode"><span className="v2-twist" /><Icon name="layers" size={15} /><span className="lbl">{n.title}</span><span className="meta">annexure</span></div></li>;
}

function History({ id, file, onClose }: { id: string; file: string; onClose: () => void }) {
  const h = useAsync(() => contentApi.history(id, file), [id, file]);
  return (
    <Modal title={`History — ${file}`} onClose={onClose} width={520}>
      {h.loading ? <Loading /> : !h.data?.length ? <Empty title="No recorded versions" /> : (
        <table className="v2-table"><thead><tr><th>When</th><th>Reason</th><th>Size</th></tr></thead>
          <tbody>{h.data.map((r) => <tr key={r.id}><td title={fmtDate(r.at)}>{ago(r.at)}</td><td>{r.reason}</td><td>{fmtSize(r.size)}</td></tr>)}</tbody></table>
      )}
    </Modal>
  );
}

export function ExplorePage() {
  const { id, role, can } = useProject();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const ex = useAsync(() => contentApi.explore(id), [id]);
  const dms = useAsync(() => contentApi.dms(id), [id]);
  const [mode, setMode] = useState<'tree' | 'table'>('tree');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(['0']));
  const [sel, setSel] = useState<Sel>(null);
  const [hist, setHist] = useState<string | null>(null);

  const byFile = useMemo(() => new Map((dms.data ?? []).map((d) => [d.file, d])), [dms.data]);
  const selected: DmSummary | null = sel && 'file' in sel ? byFile.get(sel.file) ?? null : null;

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (list: ExploreNode[], p: string) => list.forEach((n, i) => { if (n.kind === 'chapter') { keys.push(`${p}${i}`); walk(n.children, `${p}${i}.`); } });
    walk(ex.data?.tree ?? [], '');
    return keys;
  }, [ex.data]);
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  if ((ex.loading && !ex.data) || (dms.loading && !dms.data)) return <Loading />;
  if (ex.error || !ex.data) return <div className="v2-page"><Alert tone={ex.error.includes('no publication') ? 'warn' : 'bad'}>{ex.error || 'Could not read the publication.'}</Alert></div>;
  const e = ex.data;
  const unplaced = e.unplaced.filter((d) => !q || `${d.file} ${d.title} ${d.dmc}`.toLowerCase().includes(q.toLowerCase()));
  const tableRows = (dms.data ?? []).filter((d) => !q || `${d.file} ${d.title} ${d.dmc}`.toLowerCase().includes(q.toLowerCase()));
  const placedFiles = new Set<string>();
  (function collect(list: ExploreNode[]) { list.forEach((n) => { if (n.kind === 'chapter') collect(n.children); else if (n.kind === 'dm') placedFiles.add(n.file); }); })(e.tree);

  return (
    <div className="v2-page">
      <PageHeader icon="explore" title="Explore" sub={e.meta?.pmTitle ? `“${e.meta.pmTitle}”: the shape of the publication and the data modules in it.` : 'The shape of the publication and the data modules in it.'}
        actions={<>
          <input className="v2-input" style={{ width: 230 }} placeholder="Search title, code, file…" value={q} onChange={(x) => setQ(x.target.value)} aria-label="Search the publication" />
          <div className="v2-seg" role="group" aria-label="View"><button className={mode === 'tree' ? 'on' : ''} onClick={() => setMode('tree')}>Hierarchy</button><button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}>All data modules</button></div>
          <button className="btn" onClick={() => { ex.reload(); dms.reload(); }}><Icon name="refresh" />Refresh</button>
        </>}
        stats={[{ label: 'Data modules', value: e.totals.dms }, { label: 'In the publication', value: e.totals.placed, tone: 'accent' }, { label: 'Not placed', value: e.totals.unplaced, tone: e.totals.unplaced ? 'warn' : undefined }, { label: 'Missing', value: e.totals.missing, tone: e.totals.missing ? 'bad' : undefined }, { label: 'Chapters', value: e.counts.folders }]} />

      {e.totals.missing > 0 ? <div style={{ marginBottom: 12 }}><Alert tone="bad"><strong>{e.totals.missing} publication entr{e.totals.missing === 1 ? 'y points' : 'ies point'} at data modules this project does not have</strong> — nothing is published for {e.totals.missing === 1 ? 'it' : 'them'}. They are marked in red below.</Alert></div> : null}

      <div className="v2-grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(300px, 2fr)', alignItems: 'start' }}>
        <div className="v2-stack">
          {mode === 'tree' ? (
            <div className="v2-card v2-card-pad" data-testid="explore-tree">
              <div className="v2-row" style={{ marginBottom: 8 }}>
                <button className="btn btn-sm" onClick={() => setOpen(new Set(allKeys))}><Icon name="expand" size={13} />Expand all</button>
                <button className="btn btn-sm" onClick={() => setOpen(new Set())}><Icon name="collapse" size={13} />Collapse all</button>
              </div>
              {e.tree.length === 0 ? <Empty title="The publication is empty">Use the Publication screen to add data modules to chapters.</Empty>
                : <ul className="v2-tree" role="tree">{e.tree.map((n, i) => <Node key={i} n={n} path={String(i)} open={open} toggle={toggle} sel={sel} setSel={setSel} q={q} depth={0} />)}</ul>}
            </div>
          ) : (
            <div className="v2-card">
              <table className="v2-table"><thead><tr><th>Title</th><th>Code</th><th>Issue</th><th>In publication</th><th>Modified</th></tr></thead>
                <tbody>{tableRows.map((d) => (
                  <tr key={d.file} className={`clickable`} onClick={() => setSel({ file: d.file })} data-testid="explore-row">
                    <td><strong>{d.techName || d.file}</strong><div className="v2-hint">{d.infoName}</div></td><td className="v2-mono">{d.dmc}</td><td>{d.issueNumber}-{d.inWork}</td>
                    <td>{placedFiles.has(d.file) ? <Badge tone="ok">yes</Badge> : <Badge tone="warn">no</Badge>}</td><td>{ago(d.modified)}</td>
                  </tr>))}</tbody></table>
              {tableRows.length === 0 ? <Empty title="No data modules match" /> : null}
            </div>
          )}

          {unplaced.length > 0 && mode === 'tree' ? (
            <div className="v2-card">
              <div className="v2-card-head"><span>Not in the publication <Badge tone="warn">{unplaced.length}</Badge></span>{canWrite(can) ? <button className="btn btn-sm" onClick={() => nav('../publication')}>Place in chapters…</button> : null}</div>
              <ul className="v2-tree" style={{ padding: 6 }}>{unplaced.map((d) => (
                <li key={d.file}><div className={`v2-tnode ${sel && 'file' in sel && sel.file === d.file ? 'sel' : ''}`} onClick={() => setSel({ file: d.file })}>
                  <span className="v2-twist" /><Icon name="xml" size={15} /><span className="lbl">{d.techName || d.file}</span><span className="meta v2-mono">{d.dmc}</span></div></li>))}</ul>
            </div>
          ) : null}
        </div>

        <aside className="v2-card v2-card-pad" aria-label="Details" style={{ position: 'sticky', top: 0 }}>
          {selected ? (
            <div className="v2-stack" data-testid="explore-detail">
              <div><h3 style={{ margin: 0 }}>{selected.techName || selected.file}</h3><div className="v2-sub">{selected.infoName}</div></div>
              <table className="v2-table" style={{ fontSize: 12.5 }}><tbody>
                <tr><td className="v2-hint">Code</td><td className="v2-mono">{selected.dmc}</td></tr>
                <tr><td className="v2-hint">File</td><td className="v2-mono" style={{ wordBreak: 'break-all' }}>{selected.file}</td></tr>
                <tr><td className="v2-hint">Issue</td><td>{selected.issueNumber}-{selected.inWork}</td></tr>
                <tr><td className="v2-hint">Language</td><td>{selected.language || '—'}</td></tr>
                <tr><td className="v2-hint">Schema</td><td>{selected.schema ? `${selected.schema}${selected.issue ? ` (S1000D ${selected.issue})` : ''}` : '—'}</td></tr>
                <tr><td className="v2-hint">Security</td><td>{selected.security || '—'}</td></tr>
                <tr><td className="v2-hint">Size</td><td>{fmtSize(selected.size)}</td></tr>
                <tr><td className="v2-hint">Modified</td><td>{fmtDate(selected.modified)}</td></tr>
                <tr><td className="v2-hint">In publication</td><td>{placedFiles.has(selected.file) ? 'Yes' : 'No'}</td></tr>
              </tbody></table>
              <div className="v2-row wrap">
                <button className="btn btn-primary" onClick={() => nav(`../editor?file=${encodeURIComponent(selected.file)}`)}><Icon name="editor" />Open in editor</button>
                <button className="btn" onClick={() => setHist(selected.file)}><Icon name="history" />History</button>
                {may(can, 'doc.lock') ? <button className="btn" onClick={async () => { try { await contentApi.lockDm(id, selected.file, !selected.locked); toast(selected.locked ? 'Unlocked' : 'Locked — only owners can edit it now', 'success'); dms.reload(); } catch (x) { toast(errText(x), 'error'); } }}><Icon name={selected.locked ? 'unlock' : 'lock'} />{selected.locked ? 'Unlock' : 'Lock'}</button> : null}
              </div>
            </div>
          ) : sel && 'missing' in sel ? (
            <div className="v2-stack"><h3 style={{ margin: 0, color: 'var(--danger)' }}>No data module</h3><p style={{ margin: 0 }}>The publication refers to <span className="v2-mono">{sel.missing}</span>, which is not in this project.</p><p className="v2-hint" style={{ margin: 0 }}>Import the data module, or remove the entry in Publication.</p></div>
          ) : <Empty title="Select a data module">Its identity, schema and history appear here.</Empty>}
        </aside>
      </div>
      {hist ? <History id={id} file={hist} onClose={() => setHist(null)} /> : null}
    </div>
  );
}
