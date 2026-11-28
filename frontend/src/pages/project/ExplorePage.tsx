// Explore: the hierarchy of the publication (chapters and the data modules in
// them) with the data modules that are not in it, and the entries that point at
// modules the project does not have. Read-only by design - rearranging is the
// Publication screen's job; this is for finding things and seeing the shape.
// UI consistency pass: drawn in the mockups' language (page head, stat cards, a card with the .tree rows, a detail card with a .kv list).

import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentApi, type DmSummary, type ExploreNode } from '../../api';
import { Icon } from '../../components/Icon';
import { RowButton } from '../../components/a11y';
import { PageHeader } from '../../components/PageHeader';
import { Callout, EmptyState, Loading, Modal, Pill, Seg, fmtDate, fmtSize, useAsync, ago, errText } from '../../components/ui';
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

const depthOf = (depth: number) => ({ '--depth': depth }) as CSSProperties;

function Node({ n, path, open, toggle, sel, setSel, q, depth }: { n: ExploreNode; path: string; open: Set<string>; toggle: (k: string) => void; sel: Sel; setSel: (s: Sel) => void; q: string; depth: number }) {
  if (!matches(n, q)) return null;
  if (n.kind === 'chapter') {
    const isOpen = q ? true : open.has(path);
    return (
      <li>
        <div className="node group" style={depthOf(depth)} onClick={() => toggle(path)} role="treeitem" aria-expanded={isOpen} aria-level={depth + 1}>
          <span className="twist"><Icon name={isOpen ? 'down' : 'right'} size={14} /></span>
          <Icon name={isOpen ? 'folderOpen' : 'folder'} size={16} /><span className="label">{n.title}</span>
          <span className="meta">{n.dmCount} data module{n.dmCount === 1 ? '' : 's'}</span>
        </div>
        {isOpen && n.children.length ? <ul role="group">{n.children.map((c, i) => <Node key={i} n={c} path={`${path}.${i}`} open={open} toggle={toggle} sel={sel} setSel={setSel} q={q} depth={depth + 1} />)}</ul> : null}
      </li>
    );
  }
  if (n.kind === 'dm') {
    const on = !!sel && 'file' in sel && sel.file === n.file;
    return (
      <li><div className="node" style={depthOf(depth)} onClick={() => setSel({ file: n.file })} role="treeitem" aria-selected={on} aria-level={depth + 1} data-testid="explore-dm">
        <span className="twist" /><Icon name="xml" size={16} /><span className="label">{n.title}</span><span className="meta mono">{n.dmc}</span>
      </div></li>
    );
  }
  if (n.kind === 'missing') {
    const on = !!sel && 'missing' in sel && sel.missing === n.ref;
    return (
      <li><div className="node missing" style={depthOf(depth)} onClick={() => setSel({ missing: n.ref })} role="treeitem" aria-selected={on} aria-level={depth + 1}>
        <span className="twist" /><Icon name="alert" size={16} /><span className="label">{n.title}</span><span className="meta">no data module</span>
      </div></li>
    );
  }
  return <li><div className="node" style={depthOf(depth)} role="treeitem" aria-level={depth + 1}><span className="twist" /><Icon name="layers" size={16} /><span className="label">{n.title}</span><span className="meta">annexure</span></div></li>;
}

function History({ id, file, onClose }: { id: string; file: string; onClose: () => void }) {
  const h = useAsync(() => contentApi.history(id, file), [id, file]);
  return (
    <Modal title={`History — ${file}`} onClose={onClose} width={560}>
      {h.loading ? <Loading /> : !h.data?.length ? <EmptyState icon="history" title="No recorded versions">A version is kept each time the data module is saved over.</EmptyState> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Reason</th><th className="num">Size</th></tr></thead>
          <tbody>{h.data.map((r) => <tr key={r.id}><td title={fmtDate(r.at)}>{ago(r.at)}</td><td>{r.reason}</td><td className="num">{fmtSize(r.size)}</td></tr>)}</tbody></table></div>
      )}
    </Modal>
  );
}

export function ExplorePage() {
  const { id, can } = useProject();
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
  if (ex.error || !ex.data) {
    const noPm = ex.error.includes('no publication');
    return <div className="v2-page pp"><PageHeader title="Explore" sub="The shape of the publication and the data modules in it." />
      <Callout tone={noPm ? 'warning' : 'danger'} title={noPm ? 'No publication yet' : 'The publication could not be read'}>{ex.error || 'Could not read the publication.'}</Callout></div>;
  }
  const e = ex.data;
  const unplaced = e.unplaced.filter((d) => !q || `${d.file} ${d.title} ${d.dmc}`.toLowerCase().includes(q.toLowerCase()));
  const tableRows = (dms.data ?? []).filter((d) => !q || `${d.file} ${d.title} ${d.dmc}`.toLowerCase().includes(q.toLowerCase()));
  const placedFiles = new Set<string>();
  (function collect(list: ExploreNode[]) { list.forEach((n) => { if (n.kind === 'chapter') collect(n.children); else if (n.kind === 'dm') placedFiles.add(n.file); }); })(e.tree);

  return (
    <div className="v2-page pp">
      <PageHeader icon="explore" title="Explore" sub={e.meta?.pmTitle ? `“${e.meta.pmTitle}”: the shape of the publication and the data modules in it.` : 'The shape of the publication and the data modules in it.'}
        actions={<>
          <input className="input search" placeholder="Search title, code, file…" value={q} onChange={(x) => setQ(x.target.value)} aria-label="Search the publication" />
          <Seg label="View" value={mode} onChange={setMode} options={[{ value: 'tree', label: 'Hierarchy' }, { value: 'table', label: 'All data modules' }]} />
          <button className="btn" onClick={() => { ex.reload(); dms.reload(); }}><Icon name="refresh" size={16} />Refresh</button>
        </>}
        stats={[{ label: 'Data modules', value: e.totals.dms }, { label: 'In the publication', value: e.totals.placed, tone: 'accent' }, { label: 'Not placed', value: e.totals.unplaced, tone: e.totals.unplaced ? 'warn' : undefined }, { label: 'Missing', value: e.totals.missing, tone: e.totals.missing ? 'bad' : undefined }, { label: 'Chapters', value: e.counts.folders }]} />

      {e.totals.missing > 0 ? <div className="pp-gap"><Callout tone="danger" title={`${e.totals.missing} publication entr${e.totals.missing === 1 ? 'y points' : 'ies point'} at data modules this project does not have`}>Nothing is published for {e.totals.missing === 1 ? 'it' : 'them'}. They are marked in red below.</Callout></div> : null}

      <div className="pp-cols wide-side">
        <div className="pp-stack">
          {mode === 'tree' ? (
            <section className="card" data-testid="explore-tree" aria-labelledby="ex-tree-h">
              <div className="card-head"><h3 id="ex-tree-h"><Icon name="tree" />Publication structure</h3>
                <div className="row">
                  <button className="btn sm" onClick={() => setOpen(new Set(allKeys))}><Icon name="expand" size={14} />Expand all</button>
                  <button className="btn sm" onClick={() => setOpen(new Set())}><Icon name="collapse" size={14} />Collapse all</button>
                </div>
              </div>
              {e.tree.length === 0 ? <EmptyState icon="tree" title="The publication is empty">Use the Publication screen to add data modules to chapters.</EmptyState>
                : <ul className="tree focused" role="tree" aria-label="Publication structure">{e.tree.map((n, i) => <Node key={i} n={n} path={String(i)} open={open} toggle={toggle} sel={sel} setSel={setSel} q={q} depth={0} />)}</ul>}
            </section>
          ) : (
            <section className="card" aria-labelledby="ex-all-h">
              <div className="card-head"><h3 id="ex-all-h"><Icon name="xml" />All data modules</h3><span className="faint">{tableRows.length} of {(dms.data ?? []).length}</span></div>
              <div className="table-wrap"><table className="table"><thead><tr><th>Title</th><th>Code</th><th>Issue</th><th>In publication</th><th>Modified</th></tr></thead>
                <tbody>{tableRows.map((d) => (
                  <tr key={d.file} className="clickable" aria-selected={selected?.file === d.file} onClick={() => setSel({ file: d.file })} data-testid="explore-row">
                    <td><strong><RowButton onSelect={() => setSel({ file: d.file })}>{d.techName || d.file}</RowButton></strong><div className="sub">{d.infoName}</div></td><td className="mono">{d.dmc}</td><td>{d.issueNumber}-{d.inWork}</td>
                    <td>{placedFiles.has(d.file) ? <Pill tone="success">yes</Pill> : <Pill tone="warning">no</Pill>}</td><td title={fmtDate(d.modified)}>{ago(d.modified)}</td>
                  </tr>))}</tbody></table></div>
              {tableRows.length === 0 ? <EmptyState icon="search" title="No data modules match">Clear the search to see them all.</EmptyState> : null}
            </section>
          )}

          {unplaced.length > 0 && mode === 'tree' ? (
            <section className="card" aria-labelledby="ex-unpl-h">
              <div className="card-head"><h3 id="ex-unpl-h"><Icon name="warn" />Not in the publication <Pill tone="warning">{unplaced.length}</Pill></h3>{canWrite(can) ? <button className="btn sm" onClick={() => nav('../publication')}>Place in chapters…</button> : null}</div>
              <ul className="tree" aria-label="Not in the publication">{unplaced.map((d) => (
                <li key={d.file}><div className="node" aria-selected={!!sel && 'file' in sel && sel.file === d.file} onClick={() => setSel({ file: d.file })}>
                  <span className="twist" /><Icon name="xml" size={16} /><span className="label">{d.techName || d.file}</span><span className="meta mono">{d.dmc}</span></div></li>))}</ul>
            </section>
          ) : null}
        </div>

        <aside className="card pp-side" aria-label="Details">
          {selected ? (
            <div data-testid="explore-detail">
              <div className="card-head"><div><h3 className="pp-detail-title">{selected.techName || selected.file}</h3><div className="pp-detail-sub">{selected.infoName}</div></div>
                {selected.locked ? <Pill icon="lock">Locked</Pill> : null}</div>
              <div className="card-body">
                <dl className="kv">
                  <dt>Code</dt><dd className="mono">{selected.dmc}</dd>
                  <dt>File</dt><dd className="mono">{selected.file}</dd>
                  <dt>Issue</dt><dd>{selected.issueNumber}-{selected.inWork}</dd>
                  <dt>Language</dt><dd>{selected.language || '—'}</dd>
                  <dt>Schema</dt><dd>{selected.schema ? `${selected.schema}${selected.issue ? ` (S1000D ${selected.issue})` : ''}` : '—'}</dd>
                  <dt>Security</dt><dd>{selected.security || '—'}</dd>
                  <dt>Size</dt><dd>{fmtSize(selected.size)}</dd>
                  <dt>Modified</dt><dd>{fmtDate(selected.modified)}</dd>
                  <dt>In publication</dt><dd>{placedFiles.has(selected.file) ? 'Yes' : 'No'}</dd>
                </dl>
              </div>
              <div className="card-foot">
                {may(can, 'doc.lock') ? <button className="btn" onClick={async () => { try { await contentApi.lockDm(id, selected.file, !selected.locked); toast(selected.locked ? 'Unlocked' : 'Locked — only owners can edit it now', 'success'); dms.reload(); } catch (x) { toast(errText(x), 'error'); } }}><Icon name={selected.locked ? 'unlock' : 'lock'} size={16} />{selected.locked ? 'Unlock' : 'Lock'}</button> : null}
                <button className="btn" onClick={() => setHist(selected.file)}><Icon name="history" size={16} />History</button>
                <button className="btn primary" onClick={() => nav(`../editor?file=${encodeURIComponent(selected.file)}`)}><Icon name="editor" size={16} />Open in editor</button>
              </div>
            </div>
          ) : sel && 'missing' in sel ? (
            <div className="card-body"><Callout tone="danger" title="No data module">The publication refers to <span className="mono">{sel.missing}</span>, which is not in this project. Import the data module, or remove the entry in Publication.</Callout></div>
          ) : <EmptyState icon="info" title="Select a data module">Its identity, schema and history appear here.</EmptyState>}
        </aside>
      </div>
      {hist ? <History id={id} file={hist} onClose={() => setHist(null)} /> : null}
    </div>
  );
}
