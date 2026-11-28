// Explore for a JSS / JSG project: the hierarchy of the document (chapters, the data modules in them with their document codes, the sub-headings inside a module), a table of all the
// data modules, and the pictures with their names (ICN). It is the counterpart of the S1000D Explore page and works like it: search, Hierarchy / table switch, Expand all / Collapse
// all, a detail panel for what is selected, Refresh. Read-only by design - arranging is the Publication page's job; this is for finding things and seeing the shape.

// UI consistency pass: drawn in the mockups' language like the S1000D Explore page (page head, stat cards, .tree rows, a .kv detail card).

import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { graphicsApi } from '../../api';
import { xengineApi } from '../../api/xengine';
import { Icon } from '../../components/Icon';
import { RowButton } from '../../components/a11y';
import { PageHeader } from '../../components/PageHeader';
import { Callout, EmptyState, Loading, Pill, Seg, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { buildPublication, searchText, subNumber, type PubChapter, type PubModule } from '../../lib/docPublication';
import { useUi } from '../../store/ui';

type Mode = 'tree' | 'table' | 'pictures';
type Sel = { module: string } | { picture: string } | null;

const kindText = (m: PubModule): string => (m.kind === 'chapter-intro' ? 'Introduction of a chapter' : m.kind === 'appendix' ? 'Appendix' : m.kind === 'plate' ? 'Plate' : 'Section');
const originText = (o: string): string => (o === 'imported' ? 'kept from the imported package' : 'made by the platform');
const depthOf = (depth: number) => ({ '--depth': depth }) as CSSProperties;

export function DocExplorePage() {
  const { id, summary } = useProject();
  const nav = useNavigate(); const toast = useUi((s) => s.toast);
  const codes = useAsync(() => xengineApi.codes(id), [id]);
  const [mode, setMode] = useState<Mode>('tree');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(['cch1']));
  const [sel, setSel] = useState<Sel>(null);

  const pub = useMemo(() => (codes.data ? buildPublication(codes.data) : null), [codes.data]);
  const modules = useMemo(() => (pub ? [...pub.chapters.flatMap((c) => c.modules.map((m) => ({ m, ch: c.title }))), ...pub.appendices.map((m) => ({ m, ch: 'Appendices' })), ...pub.plates.map((m) => ({ m, ch: 'Plates' }))] : []), [pub]);
  const byKey = useMemo(() => new Map(modules.map((x) => [x.m.key, x])), [modules]);

  if (codes.loading && !codes.data) return <Loading />;
  if (codes.error || !codes.data || !pub) return <div className="v2-page pp"><PageHeader title="Explore" sub="The shape of the document and the data modules in it." /><Callout tone="danger" title="The document could not be read">{codes.error || 'Could not read the document.'}</Callout></div>;
  const c = codes.data; const needle = q.trim().toLowerCase();
  const hit = (m: PubModule, ch?: string): boolean => !needle || searchText(m, ch).includes(needle);
  const chapterHit = (ch: PubChapter): boolean => !needle || ch.title.toLowerCase().includes(needle) || ch.modules.some((m) => hit(m, ch.title));
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allKeys = [...pub.chapters.map((ch) => `c${ch.key}`), ...modules.filter((x) => x.m.subs.length).map((x) => `m${x.m.key}`)];
  const subCount = modules.reduce((n, x) => n + x.m.subs.length, 0);
  const selMod = sel && 'module' in sel ? byKey.get(sel.module) : undefined;
  const selPic = sel && 'picture' in sel ? c.pictures.find((p) => p.file === sel.picture) : undefined;
  const goEditor = (key: string) => nav(`../editor?goto=${encodeURIComponent(key)}`);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast('Copied.', 'success'); } catch { toast('Could not copy: select the code and copy it by hand.', 'error'); } };

  const moduleNode = (m: PubModule, ch: string, depth: number) => {
    if (!hit(m, ch)) return null;
    const k = `m${m.key}`; const has = m.subs.length > 0; const isOpen = needle ? true : open.has(k); const on = !!sel && 'module' in sel && sel.module === m.key;
    return (
      <li key={m.key}>
        <div className="node" style={depthOf(depth)} onClick={() => setSel({ module: m.key })} role="treeitem" aria-selected={on} aria-expanded={has ? isOpen : undefined} aria-level={depth + 1} data-testid="explore-dm" data-code={m.dmc}>
          <span className="twist" onClick={has ? (e) => { e.stopPropagation(); toggle(k); } : undefined}>{has ? <Icon name={isOpen ? 'down' : 'right'} size={14} /> : null}</span>
          <Icon name="xml" size={16} /><span className="label">{m.label ? `${m.label}  ` : ''}{m.title}</span><span className="meta mono">{m.dmc}</span>
        </div>
        {has && isOpen ? <ul role="group">{m.subs.map((s, i) => (
          <li key={i}><div className="node" style={depthOf(depth + 1)} role="treeitem" aria-level={depth + 2} data-testid="explore-sub" onClick={() => setSel({ module: m.key })}><span className="twist" /><Icon name="file" size={16} /><span className="label">{subNumber(m, s)}  {s.title}</span><span className="meta">part of this module</span></div></li>
        ))}</ul> : null}
      </li>
    );
  };

  const chapterNode = (ch: PubChapter) => {
    if (!chapterHit(ch)) return null;
    const k = `c${ch.key}`; const isOpen = needle ? true : open.has(k);
    return (
      <li key={ch.key}>
        <div className="node group" style={depthOf(0)} onClick={() => toggle(k)} role="treeitem" aria-expanded={isOpen} aria-level={1} data-testid="explore-chapter">
          <span className="twist"><Icon name={isOpen ? 'down' : 'right'} size={14} /></span>
          <Icon name={isOpen ? 'folderOpen' : 'folder'} size={16} /><span className="label">{ch.label}  {ch.title}</span>
          <span className="meta">{ch.modules.length} data module{ch.modules.length === 1 ? '' : 's'}</span>
        </div>
        {isOpen && ch.modules.length ? <ul role="group">{ch.modules.map((m) => moduleNode(m, ch.title, 1))}</ul> : null}
      </li>
    );
  };

  const rows = modules.filter((x) => hit(x.m, x.ch));
  const pics = c.pictures.filter((p) => !needle || `${p.file} ${p.icn} ${p.packageFile} ${byKey.get(p.module)?.m.title ?? ''}`.toLowerCase().includes(needle));
  const empty = pub.chapters.length === 0 && pub.appendices.length === 0 && pub.plates.length === 0;

  return (
    <div className="v2-page pp">
      <PageHeader icon="explore" title="Explore" sub={`“${c.pmc.title || summary.project.name}”: the shape of the document and the data modules in it.`}
        actions={<>
          <input className="input search" placeholder="Search title, code, picture…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the document" data-testid="explore-search" />
          <Seg label="View" value={mode} onChange={setMode} options={[{ value: 'tree', label: 'Hierarchy' }, { value: 'table', label: 'All data modules' }, { value: 'pictures', label: 'Pictures' }]} />
          <button className="btn" onClick={() => codes.reload()}><Icon name="refresh" size={16} />Refresh</button>
        </>}
        stats={[
          { label: 'Data modules', value: modules.length }, { label: 'Chapters', value: pub.chapters.length, tone: 'accent' }, { label: 'Sub-headings', value: subCount },
          { label: 'Pictures', value: c.counts.pictures }, { label: 'Codes from import', value: c.counts.imported, tone: c.counts.imported ? 'ok' : undefined },
        ]} />

      <div className="pp-cols wide-side">
        <div className="pp-stack">
          {mode === 'tree' ? (
            <section className="card" data-testid="explore-tree" aria-labelledby="dex-tree-h">
              <div className="card-head"><h3 id="dex-tree-h"><Icon name="tree" />Document structure</h3>
                <div className="row">
                  <button className="btn sm" onClick={() => setOpen(new Set(allKeys))}><Icon name="expand" size={14} />Expand all</button>
                  <button className="btn sm" onClick={() => setOpen(new Set())}><Icon name="collapse" size={14} />Collapse all</button>
                </div>
              </div>
              {empty ? <EmptyState icon="tree" title="The document is empty">Open the editor and write a chapter; its sections appear here with their codes.</EmptyState> : (
                <ul className="tree focused" role="tree" aria-label="Document structure">
                  {pub.chapters.map(chapterNode)}
                  {pub.appendices.length && pub.appendices.some((m) => hit(m, 'Appendices')) ? <li><div className="node group" style={depthOf(0)} role="treeitem" aria-level={1}><span className="twist" /><Icon name="layers" size={16} /><span className="label">Appendices</span><span className="meta">{pub.appendices.length}</span></div><ul role="group">{pub.appendices.map((m) => moduleNode(m, 'Appendices', 1))}</ul></li> : null}
                  {pub.plates.length && pub.plates.some((m) => hit(m, 'Plates')) ? <li><div className="node group" style={depthOf(0)} role="treeitem" aria-level={1}><span className="twist" /><Icon name="image" size={16} /><span className="label">Plates</span><span className="meta">{pub.plates.length}</span></div><ul role="group">{pub.plates.map((m) => moduleNode(m, 'Plates', 1))}</ul></li> : null}
                </ul>
              )}
            </section>
          ) : mode === 'table' ? (
            <section className="card" aria-labelledby="dex-all-h">
              <div className="card-head"><h3 id="dex-all-h"><Icon name="xml" />All data modules</h3><span className="faint">{rows.length} of {modules.length}</span></div>
              <div className="table-wrap"><table className="table"><thead><tr><th>No.</th><th>Title</th><th>Code</th><th>Chapter</th><th>Kind</th><th className="num">Pictures</th></tr></thead>
                <tbody>{rows.map(({ m, ch }) => (
                  <tr key={m.key} className="clickable" aria-selected={!!(sel && 'module' in sel && sel.module === m.key)} onClick={() => setSel({ module: m.key })} data-testid="explore-row" data-code={m.dmc}>
                    <td className="mono">{m.label}</td><td><strong><RowButton onSelect={() => setSel({ module: m.key })} selected={!!(sel && 'module' in sel && sel.module === m.key)} label={m.title ? undefined : m.dmc}>{m.title}</RowButton></strong></td><td className="mono">{m.dmc}</td><td>{ch}</td><td>{kindText(m)}</td><td className="num">{m.pictures.length || '—'}</td>
                  </tr>))}</tbody></table></div>
              {rows.length === 0 ? <EmptyState icon="search" title="No data modules match">Clear the search to see them all.</EmptyState> : null}
            </section>
          ) : (
            <section className="card" aria-labelledby="dex-pic-h">
              <div className="card-head"><h3 id="dex-pic-h"><Icon name="image" />Pictures</h3><span className="faint">{pics.length} of {c.pictures.length}</span></div>
              <div className="table-wrap"><table className="table"><thead><tr><th>Picture</th><th>Picture name (ICN)</th><th>Used in</th><th>Code</th></tr></thead>
                <tbody>{pics.map((p) => (
                  <tr key={p.file} className="clickable" aria-selected={selPic?.file === p.file} onClick={() => setSel({ picture: p.file })} data-testid="explore-picture">
                    <td><strong><RowButton onSelect={() => setSel({ picture: p.file })} selected={selPic?.file === p.file}>{p.file}</RowButton></strong></td><td className="mono">{p.icn}</td><td>{byKey.get(p.module)?.m.title ?? '—'}</td><td>{p.origin === 'imported' ? <Pill tone="info">imported</Pill> : <span className="faint">platform</span>}</td>
                  </tr>))}</tbody></table></div>
              {pics.length === 0 ? <EmptyState icon="image" title={c.pictures.length ? 'No picture matches' : 'No pictures in this document'} /> : null}
            </section>
          )}
        </div>

        <aside className="card pp-side" aria-label="Details">
          {selMod ? (
            <div data-testid="explore-detail">
              <div className="card-head"><div><h3 className="pp-detail-title">{selMod.m.title}</h3><div className="pp-detail-sub">{kindText(selMod.m)}{selMod.m.label ? ` ${selMod.m.label}` : ''}</div></div></div>
              <div className="card-body">
                <dl className="kv">
                  <dt>Code</dt><dd className="mono" data-testid="explore-detail-code">{selMod.m.dmc}</dd>
                  <dt>File in a package</dt><dd className="mono">{selMod.m.file}</dd>
                  <dt>Chapter</dt><dd>{selMod.ch}</dd>
                  <dt>Code origin</dt><dd>{originText(selMod.m.origin)}</dd>
                  <dt>Sub-headings</dt><dd>{selMod.m.subs.length || '—'}</dd>
                  <dt>Pictures</dt><dd>{selMod.m.pictures.length ? selMod.m.pictures.join(', ') : '—'}</dd>
                </dl>
              </div>
              <div className="card-foot">
                <button className="btn" onClick={() => void copy(selMod.m.dmc)}><Icon name="copy" size={16} />Copy code</button>
                <button className="btn" onClick={() => nav('../publication')}><Icon name="book" size={16} />Publication</button>
                <button className="btn primary" onClick={() => goEditor(selMod.m.key)}><Icon name="editor" size={16} />Open in editor</button>
              </div>
            </div>
          ) : selPic ? (
            <div data-testid="explore-detail">
              <div className="card-head"><div><h3 className="pp-detail-title">{selPic.file}</h3><div className="pp-detail-sub">Picture</div></div></div>
              <div className="card-body pp-form">
                <img className="pp-pic" src={graphicsApi.url(id, selPic.file)} alt={selPic.file} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                <dl className="kv">
                  <dt>Picture name (ICN)</dt><dd className="mono">{selPic.icn}</dd>
                  <dt>File in a package</dt><dd className="mono">{selPic.packageFile}</dd>
                  <dt>Used in</dt><dd>{byKey.get(selPic.module)?.m.title ?? '—'}</dd>
                  <dt>Name origin</dt><dd>{originText(selPic.origin)}</dd>
                </dl>
              </div>
              <div className="card-foot">
                <button className="btn" onClick={() => void copy(selPic.icn)}><Icon name="copy" size={16} />Copy name</button>
                {byKey.get(selPic.module) ? <button className="btn primary" onClick={() => setSel({ module: selPic.module })}>Show its data module</button> : null}
              </div>
            </div>
          ) : <EmptyState icon="info" title="Select a data module">Its code, file name, chapter and pictures appear here.</EmptyState>}
        </aside>
      </div>
    </div>
  );
}
