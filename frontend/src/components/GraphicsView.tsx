// A set of graphics (ICN artwork and symbols) built for projects with hundreds of them: pages instead of one endless scroll, sorting, an "unused" filter,
// a compact list mode, and a larger preview that shows where each graphic is used.
// Shared by the project's Graphics page (editable) and the main Graphics Management page (read-only).

import { useEffect, useMemo, useState } from 'react';
import { graphicsApi, type Graphic, type GraphicKind } from '../api';
import { Badge, Empty, Modal, fmtSize } from './ui';
import { Icon } from './Icon';

type Filter = 'all' | GraphicKind;
type Sort = 'name' | 'size' | 'used';
type Use = 'all' | 'used' | 'unused';
const LABEL: Record<GraphicKind, string> = { icn: 'ICN', symbol: 'Symbol' };
const PAGE_SIZES = [24, 48, 96];

export function GraphicsView({ projectId, graphics, onDelete, empty }: { projectId: string; graphics: Graphic[]; onDelete?: (g: Graphic) => void; empty?: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [use, setUse] = useState<Use>('all');
  const [sort, setSort] = useState<Sort>('name');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [size, setSize] = useState(24);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Graphic | null>(null);
  const count = (f: Filter) => (f === 'all' ? graphics.length : graphics.filter((g) => g.kind === f).length);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = graphics.filter((g) => (filter === 'all' || g.kind === filter) && (use === 'all' || (use === 'used') === g.usedBy.length > 0) && (!needle || g.name.toLowerCase().includes(needle)));
    return list.sort((a, b) => (sort === 'size' ? b.size - a.size : sort === 'used' ? b.usedBy.length - a.usedBy.length || a.name.localeCompare(b.name) : a.name.localeCompare(b.name, undefined, { numeric: true })));
  }, [graphics, filter, use, sort, q]);

  const pages = Math.max(1, Math.ceil(shown.length / size));
  useEffect(() => { setPage(0); }, [filter, use, sort, q, size]);
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * size, at * size + size);

  const thumb = (g: Graphic, h?: number) => <img src={graphicsApi.url(projectId, g.name)} alt={g.name} loading="lazy" style={h ? { maxHeight: h, maxWidth: '100%' } : undefined} />;

  return (
    <div className="v2-stack" data-testid={`graphics-${projectId}`}>
      <div className="v2-row v2-spread" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="v2-seg" role="group" aria-label="Kind">
          {(['all', 'icn', 'symbol'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'icn' ? 'ICNs' : 'Symbols'} {count(f)}
            </button>
          ))}
        </div>
        <div className="v2-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="v2-input" style={{ width: 200, height: 30 }} placeholder="Find by name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter graphics" />
          <select className="v2-select" style={{ height: 30 }} value={use} onChange={(e) => setUse(e.target.value as Use)} aria-label="Use"><option value="all">Used and unused</option><option value="used">Used in data modules</option><option value="unused">Not used</option></select>
          <select className="v2-select" style={{ height: 30 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by"><option value="name">Sort: name</option><option value="size">Sort: largest first</option><option value="used">Sort: most used</option></select>
          <div className="v2-seg" role="group" aria-label="View">
            <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} onClick={() => setView('grid')} title="Thumbnails">Tiles</button>
            <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')} title="Compact list">List</button>
          </div>
        </div>
      </div>

      {shown.length === 0 ? <Empty title={graphics.length ? 'No graphic matches' : (empty ?? 'No graphics yet')} /> : view === 'grid' ? (
        <div className="v2-gfx-grid">
          {slice.map((g) => (
            <div key={g.name} className="v2-gfx" data-testid="graphic" data-name={g.name} data-kind={g.kind}>
              <button type="button" className="v2-gfx-thumb" style={{ cursor: 'zoom-in', background: 'none', border: 0, padding: 0 }} onClick={() => setOpen(g)} aria-label={`Open ${g.name}`}>{thumb(g)}</button>
              <div className="v2-gfx-meta">
                <div className="v2-trunc" title={g.name}><b>{g.name}</b></div>
                <div className="v2-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Badge tone={g.kind === 'icn' ? 'accent' : undefined}>{LABEL[g.kind]}</Badge>
                  <span className="v2-hint">{fmtSize(g.size)}</span>
                  <span className="v2-hint" title={g.usedBy.join('\n')}>{g.usedBy.length ? `used in ${g.usedBy.length}` : 'not used'}</span>
                  {onDelete ? <button className="icon-btn" style={{ marginLeft: 'auto' }} aria-label={`Delete ${g.name}`} title="Delete" onClick={() => onDelete(g)}><Icon name="trash" size={14} /></button> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table className="v2-table" data-testid="graphics-list"><thead><tr><th style={{ width: 54 }} /><th>Name</th><th>Kind</th><th>Size</th><th>Used in</th><th /></tr></thead><tbody>
          {slice.map((g) => (
            <tr key={g.name} data-testid="graphic" data-name={g.name} data-kind={g.kind}>
              <td><button type="button" style={{ background: 'none', border: 0, padding: 0, cursor: 'zoom-in' }} onClick={() => setOpen(g)} aria-label={`Open ${g.name}`}>{thumb(g, 36)}</button></td>
              <td className="v2-mono v2-trunc" title={g.name}>{g.name}</td><td>{LABEL[g.kind]}</td><td>{fmtSize(g.size)}</td>
              <td title={g.usedBy.join('\n')}>{g.usedBy.length ? `${g.usedBy.length} data module${g.usedBy.length === 1 ? '' : 's'}` : 'not used'}</td>
              <td>{onDelete ? <button className="icon-btn" aria-label={`Delete ${g.name}`} title="Delete" onClick={() => onDelete(g)}><Icon name="trash" size={14} /></button> : null}</td>
            </tr>
          ))}
        </tbody></table>
      )}

      {shown.length > PAGE_SIZES[0] ? (
        <div className="v2-row v2-spread" style={{ flexWrap: 'wrap', gap: 8 }} data-testid="graphics-pager">
          <span className="v2-hint">{shown.length} graphic{shown.length === 1 ? '' : 's'} · page {at + 1} of {pages}</span>
          <div className="v2-row" style={{ gap: 6 }}>
            <button className="btn btn-sm" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</button>
            <button className="btn btn-sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next</button>
            <select className="v2-select" style={{ height: 30 }} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Per page">{PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
          </div>
        </div>
      ) : null}

      {open ? (
        <Modal title={open.name} width={760} onClose={() => setOpen(null)} buttons={<>
          {onDelete ? <button className="btn" onClick={() => { const g = open; setOpen(null); onDelete(g); }}>Delete…</button> : null}
          <button className="btn btn-primary" onClick={() => setOpen(null)}>Close</button>
        </>}>
          <div className="v2-stack" data-testid="graphic-preview">
            <div style={{ textAlign: 'center', maxHeight: '55vh', overflow: 'auto' }}>{thumb(open, 480)}</div>
            <div className="v2-row" style={{ gap: 8, flexWrap: 'wrap' }}><Badge tone={open.kind === 'icn' ? 'accent' : undefined}>{LABEL[open.kind]}</Badge><span className="v2-hint">{fmtSize(open.size)}</span></div>
            <div>{open.usedBy.length ? <><b>Used in {open.usedBy.length} data module{open.usedBy.length === 1 ? '' : 's'}:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18, maxHeight: 160, overflow: 'auto' }}>{open.usedBy.map((u) => <li key={u} className="v2-mono">{u}</li>)}</ul></> : <span className="v2-hint">Not used by any data module.</span>}</div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
