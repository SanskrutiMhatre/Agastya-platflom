// Explore for a JSS / JSG project: the hierarchy of the document (chapters, the data modules in them with their document codes, the sub-headings inside a module), a table of all the
// data modules, and the pictures with their names (ICN). It is the counterpart of the S1000D Explore page and works like it: search, Hierarchy / table switch, Expand all / Collapse
// all, a detail panel for what is selected, Refresh. Read-only by design - arranging is the Publication page's job; this is for finding things and seeing the shape.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { graphicsApi } from '../../api';
import { xengineApi } from '../../api/xengine';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Empty, Loading, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { buildPublication, searchText, subNumber, type PubChapter, type PubModule } from '../../lib/docPublication';
import { useUi } from '../../store/ui';

type Mode = 'tree' | 'table' | 'pictures';
type Sel = { module: string } | { picture: string } | null;

const kindText = (m: PubModule): string => (m.kind === 'chapter-intro' ? 'Introduction of a chapter' : m.kind === 'appendix' ? 'Appendix' : m.kind === 'plate' ? 'Plate' : 'Section');
const originText = (o: string): string => (o === 'imported' ? 'kept from the imported package' : 'made by the platform');

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
  if (codes.error || !codes.data || !pub) return <div className="v2-page"><Alert tone="bad">{codes.error || 'Could not read the document.'}</Alert></div>;
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
        <div className={`v2-tnode ${on ? 'sel' : ''}`} onClick={() => setSel({ module: m.key })} role="treeitem" aria-selected={on} aria-expanded={has ? isOpen : undefined} aria-level={depth + 1} data-testid="explore-dm" data-code={m.dmc}>
          <span className="v2-twist" onClick={has ? (e) => { e.stopPropagation(); toggle(k); } : undefined}>{has ? <Icon name={isOpen ? 'down' : 'right'} size={13} /> : null}</span>
          <Icon name="xml" size={15} /><span className="lbl">{m.label ? `${m.label}  ` : ''}{m.title}</span><span className="meta v2-mono">{m.dmc}</span>
        </div>
        {has && isOpen ? <ul role="group">{m.subs.map((s, i) => (
          <li key={i}><div className="v2-tnode" role="treeitem" aria-level={depth + 2} data-testid="explore-sub" onClick={() => setSel({ module: m.key })}><span className="v2-twist" /><Icon name="file" size={14} /><span className="lbl">{subNumber(m, s)}  {s.title}</span><span className="meta">part of this module</span></div></li>
        ))}</ul> : null}
      </li>
    );
  };

  const chapterNode = (ch: PubChapter) => {
    if (!chapterHit(ch)) return null;
    const k = `c${ch.key}`; const isOpen = needle ? true : open.has(k);
    return (
      <li key={ch.key}>
        <div className="v2-tnode" onClick={() => toggle(k)} role="treeitem" aria-expanded={isOpen} aria-level={1} data-testid="explore-chapter">
          <span className="v2-twist"><Icon name={isOpen ? 'down' : 'right'} size={13} /></span>
          <Icon name={isOpen ? 'folderOpen' : 'folder'} size={15} /><span className="lbl">{ch.label}  {ch.title}</span>
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
    <div className="v2-page">
      <PageHeader icon="explore" title="Explore" sub={`“${c.pmc.title || summary.project.name}”: the shape of the document and the data modules in it.`}
        actions={<>
          <input className="v2-input" style={{ width: 230 }} placeholder="Search title, code, picture…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the document" data-testid="explore-search" />
          <div className="v2-seg" role="group" aria-label="View">
            <button className={mode === 'tree' ? 'on' : ''} onClick={() => setMode('tree')}>Hierarchy</button>
            <button className={mode === 'table' ? 'on' : ''} onClick={() => setMode('table')}>All data modules</button>
            <button className={mode === 'pictures' ? 'on' : ''} onClick={() => setMode('pictures')}>Pictures</button>
          </div>
          <button className="btn" onClick={() => codes.reload()}><Icon name="refresh" />Refresh</button>
        </>}
        stats={[
          { label: 'Data modules', value: modules.length }, { label: 'Chapters', value: pub.chapters.length, tone: 'accent' }, { label: 'Sub-headings', value: subCount },
          { label: 'Pictures', value: c.counts.pictures }, { label: 'Codes from import', value: c.counts.imported, tone: c.counts.imported ? 'ok' : undefined },
        ]} />

      <div className="v2-grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(300px, 2fr)', alignItems: 'start' }}>
        <div className="v2-stack">
          {mode === 'tree' ? (
            <div className="v2-card v2-card-pad" data-testid="explore-tree">
              <div className="v2-row" style={{ marginBottom: 8 }}>
                <button className="btn btn-sm" onClick={() => setOpen(new Set(allKeys))}><Icon name="expand" size={13} />Expand all</button>
                <button className="btn btn-sm" onClick={() => setOpen(new Set())}><Icon name="collapse" size={13} />Collapse all</button>
              </div>
              {empty ? <Empty title="The document is empty">Open the editor and write a chapter; its sections appear here with their codes.</Empty> : (
                <ul className="v2-tree" role="tree">
                  {pub.chapters.map(chapterNode)}
                  {pub.appendices.length && pub.appendices.some((m) => hit(m, 'Appendices')) ? <li><div className="v2-tnode" role="treeitem" aria-level={1}><span className="v2-twist" /><Icon name="layers" size={15} /><span className="lbl">Appendices</span><span className="meta">{pub.appendices.length}</span></div><ul role="group">{pub.appendices.map((m) => moduleNode(m, 'Appendices', 1))}</ul></li> : null}
                  {pub.plates.length && pub.plates.some((m) => hit(m, 'Plates')) ? <li><div className="v2-tnode" role="treeitem" aria-level={1}><span className="v2-twist" /><Icon name="image" size={15} /><span className="lbl">Plates</span><span className="meta">{pub.plates.length}</span></div><ul role="group">{pub.plates.map((m) => moduleNode(m, 'Plates', 1))}</ul></li> : null}
                </ul>
              )}
            </div>
          ) : mode === 'table' ? (
            <div className="v2-card">
              <table className="v2-table"><thead><tr><th>No.</th><th>Title</th><th>Code</th><th>Chapter</th><th>Kind</th><th>Pictures</th></tr></thead>
                <tbody>{rows.map(({ m, ch }) => (
                  <tr key={m.key} className={`clickable ${sel && 'module' in sel && sel.module === m.key ? 'sel' : ''}`} onClick={() => setSel({ module: m.key })} data-testid="explore-row" data-code={m.dmc}>
                    <td className="v2-mono">{m.label}</td><td><strong>{m.title}</strong></td><td className="v2-mono">{m.dmc}</td><td>{ch}</td><td>{kindText(m)}</td><td>{m.pictures.length || '—'}</td>
                  </tr>))}</tbody></table>
              {rows.length === 0 ? <Empty title="No data modules match" /> : null}
            </div>
          ) : (
            <div className="v2-card">
              <table className="v2-table"><thead><tr><th>Picture</th><th>Picture name (ICN)</th><th>Used in</th><th>Code</th></tr></thead>
                <tbody>{pics.map((p) => (
                  <tr key={p.file} className={`clickable ${selPic?.file === p.file ? 'sel' : ''}`} onClick={() => setSel({ picture: p.file })} data-testid="explore-picture">
                    <td><strong>{p.file}</strong></td><td className="v2-mono">{p.icn}</td><td>{byKey.get(p.module)?.m.title ?? '—'}</td><td>{p.origin === 'imported' ? <Badge>imported</Badge> : <span className="v2-hint">platform</span>}</td>
                  </tr>))}</tbody></table>
              {pics.length === 0 ? <Empty title={c.pictures.length ? 'No picture matches' : 'No pictures in this document'} /> : null}
            </div>
          )}
        </div>

        <aside className="v2-card v2-card-pad" aria-label="Details" style={{ position: 'sticky', top: 0 }}>
          {selMod ? (
            <div className="v2-stack" data-testid="explore-detail">
              <div><h3 style={{ margin: 0 }}>{selMod.m.title}</h3><div className="v2-sub">{kindText(selMod.m)}{selMod.m.label ? ` ${selMod.m.label}` : ''}</div></div>
              <table className="v2-table" style={{ fontSize: 12.5 }}><tbody>
                <tr><td className="v2-hint">Code</td><td className="v2-mono" style={{ wordBreak: 'break-all' }} data-testid="explore-detail-code">{selMod.m.dmc}</td></tr>
                <tr><td className="v2-hint">File in a package</td><td className="v2-mono" style={{ wordBreak: 'break-all' }}>{selMod.m.file}</td></tr>
                <tr><td className="v2-hint">Chapter</td><td>{selMod.ch}</td></tr>
                <tr><td className="v2-hint">Code origin</td><td>{originText(selMod.m.origin)}</td></tr>
                <tr><td className="v2-hint">Sub-headings</td><td>{selMod.m.subs.length || '—'}</td></tr>
                <tr><td className="v2-hint">Pictures</td><td>{selMod.m.pictures.length ? selMod.m.pictures.join(', ') : '—'}</td></tr>
              </tbody></table>
              <div className="v2-row wrap">
                <button className="btn btn-primary" onClick={() => goEditor(selMod.m.key)}><Icon name="editor" />Open in editor</button>
                <button className="btn" onClick={() => void copy(selMod.m.dmc)}><Icon name="copy" />Copy code</button>
                <button className="btn" onClick={() => nav('../publication')}><Icon name="book" />Publication</button>
              </div>
            </div>
          ) : selPic ? (
            <div className="v2-stack" data-testid="explore-detail">
              <div><h3 style={{ margin: 0 }}>{selPic.file}</h3><div className="v2-sub">Picture</div></div>
              <img src={graphicsApi.url(id, selPic.file)} alt={selPic.file} style={{ maxWidth: '100%', maxHeight: 180, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <table className="v2-table" style={{ fontSize: 12.5 }}><tbody>
                <tr><td className="v2-hint">Picture name (ICN)</td><td className="v2-mono" style={{ wordBreak: 'break-all' }}>{selPic.icn}</td></tr>
                <tr><td className="v2-hint">File in a package</td><td className="v2-mono" style={{ wordBreak: 'break-all' }}>{selPic.packageFile}</td></tr>
                <tr><td className="v2-hint">Used in</td><td>{byKey.get(selPic.module)?.m.title ?? '—'}</td></tr>
                <tr><td className="v2-hint">Name origin</td><td>{originText(selPic.origin)}</td></tr>
              </tbody></table>
              <div className="v2-row wrap">
                <button className="btn" onClick={() => void copy(selPic.icn)}><Icon name="copy" />Copy name</button>
                {byKey.get(selPic.module) ? <button className="btn btn-primary" onClick={() => setSel({ module: selPic.module })}>Show its data module</button> : null}
              </div>
            </div>
          ) : <Empty title="Select a data module">Its code, file name, chapter and pictures appear here.</Empty>}
        </aside>
      </div>
    </div>
  );
}
