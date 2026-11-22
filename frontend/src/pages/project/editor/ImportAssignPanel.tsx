// Place the modules no publication claimed. The server keeps them in a pool (never dropped, never published by themselves);
// this panel lists the pool, lets the person tick some, choose where they go (the top of the publication, a chapter, or a
// sub-publication whose own publication was not delivered) and sends them through `assign`.

import { useEffect, useMemo, useState } from 'react';
import { importerApi, type AssignResult, type PoolModule, type Unassigned } from '../../../api/importer';
import { Alert, Badge, Field, Loading, Spinner, errText } from '../../../components/ui';
import { CappedList } from '../../../components/lists';
import { buildAssignBody, destinationOptions, filterBy, groupPool, parseDestination, plural, poolReason } from '../../../lib/importPackage';

export function ImportAssignPanel({ projectId, data, error, loading, mayAssign, onReload, onAssigned }: {
  projectId: string; data: Unassigned | null; error: string; loading: boolean; mayAssign: boolean; onReload: () => void; onAssigned: (r: AssignResult) => void;
}) {
  const [q, setQ] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [dest, setDest] = useState('root');
  const [newFolder, setNewFolder] = useState('');
  const [atStart, setAtStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState<AssignResult | null>(null);

  const options = useMemo(() => (data ? destinationOptions(data) : []), [data]);
  const pool = data?.pool ?? [];
  const shown = useMemo(() => filterBy(pool, q, (p) => `${p.techName} ${p.infoName} ${p.dmc} ${p.file} ${p.group}`), [pool, q]);
  const groups = useMemo(() => groupPool(shown), [shown]);
  // A tick that no longer matches a module of the pool (it was placed meanwhile) is dropped.
  useEffect(() => { setTicked((t) => { const have = new Set(pool.map((p) => p.file)); const n = new Set([...t].filter((f) => have.has(f))); return n.size === t.size ? t : n; }); }, [pool]);
  useEffect(() => { if (!options.some((o) => o.value === dest)) setDest('root'); }, [options, dest]);

  const toggle = (file: string, on: boolean) => setTicked((t) => { const n = new Set(t); if (on) n.add(file); else n.delete(file); return n; });
  const allShownTicked = shown.length > 0 && shown.every((p) => ticked.has(p.file));
  const toggleShown = (on: boolean) => setTicked((t) => { const n = new Set(t); for (const p of shown) { if (on) n.add(p.file); else n.delete(p.file); } return n; });

  const place = async () => {
    setBusy(true); setProblem(''); setDone(null);
    try {
      const files = pool.filter((p) => ticked.has(p.file)).map((p) => p.file);
      const r = await importerApi.assign(projectId, buildAssignBody(files, parseDestination(dest, options), { newFolder, position: atStart ? 'start' : 'end' }));
      setDone(r); setTicked(new Set()); setNewFolder('');
      onAssigned(r); onReload();
    } catch (e) { setProblem(errText(e)); } finally { setBusy(false); }
  };

  const row = (p: PoolModule) => (
    <label className="v2-row" style={{ gap: 8, width: '100%', alignItems: 'flex-start' }} data-testid="pool-row" data-file={p.file}>
      <input type="checkbox" checked={ticked.has(p.file)} disabled={!mayAssign || busy} onChange={(e) => toggle(p.file, e.target.checked)} aria-label={`Place ${p.techName || p.file}`} style={{ marginTop: 2 }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <strong>{p.techName || p.file}</strong>{p.infoName ? <> &middot; {p.infoName}</> : null}
        <span className="v2-hint" style={{ display: 'block' }}><span className="v2-mono">{p.dmc}</span> &middot; {poolReason(p.reason)}{p.anchorOf ? <> &middot; <Badge tone="accent">title page of sub-publication {p.anchorOf}</Badge></> : null}</span>
      </span>
    </label>
  );

  if (loading && !data) return <Loading label="Looking at the publication…" />;
  if (error && !data) return <Alert tone="bad">{error} <button className="btn btn-sm" onClick={onReload}>Try again</button></Alert>;
  if (!data) return null;

  return (
    <div className="v2-stack" data-testid="assign-panel">
      {done ? (
        <Alert tone={done.refused.length ? 'warn' : 'ok'}>
          <strong data-testid="assign-done">Placed {plural(done.placed.length, 'module')} in the publication.</strong>
          {done.materialised ? <> The sub-publication &ldquo;{done.materialised.title}&rdquo; is now a chapter; its title page comes first.</> : null}
          {done.refused.length ? <div style={{ marginTop: 6 }}><strong>{plural(done.refused.length, 'module')} not placed:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{done.refused.slice(0, 10).map((r) => <li key={r.file}><span className="v2-mono">{r.file}</span>: {r.reason}</li>)}{done.refused.length > 10 ? <li>and {done.refused.length - 10} more</li> : null}</ul></div> : null}
        </Alert>
      ) : null}
      {problem ? <Alert tone="bad"><span data-testid="assign-error">{problem}</span></Alert> : null}

      {!data.hasPublication ? <Alert tone="warn">This project has no publication to place modules in. Import with a publication, or create one on the Publication page.</Alert> : null}
      {pool.length === 0 ? (
        <div className="v2-empty" data-testid="pool-empty"><strong>Every data module is in the publication.</strong>Modules an import leaves out of the publication are listed here until you place them.</div>
      ) : (
        <>
          <p style={{ margin: 0 }}><strong>{plural(pool.length, 'module')}</strong> {pool.length === 1 ? 'is' : 'are'} not in the publication. {pool.length === 1 ? 'It is' : 'They are'} kept in the project and never published until you place {pool.length === 1 ? 'it' : 'them'}.</p>
          <div className="v2-row wrap">
            <input className="v2-input" style={{ maxWidth: 300 }} placeholder="Filter by title, code or file…" aria-label="Filter the unassigned modules" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={allShownTicked} disabled={!mayAssign || busy || shown.length === 0} onChange={(e) => toggleShown(e.target.checked)} data-testid="pool-select-all" />Select all {q ? 'shown' : ''} ({shown.length})</label>
            <span className="spacer" />
            <span className="v2-hint" data-testid="pool-ticked">{ticked.size} selected</span>
          </div>
          <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px' }} data-testid="pool-list">
            {shown.length === 0 ? <div className="v2-hint" style={{ padding: 8 }}>No module matches.</div> : groups.map((g) => (
              <div key={g.group || '-'} data-testid="pool-group">
                {groups.length > 1 || g.group ? <div className="v2-hint" style={{ padding: '6px 0 2px', fontWeight: 600 }}>{g.group ? `System ${g.group}` : 'Other modules'} ({g.items.length})</div> : null}
                <CappedList items={g.items} initial={50} page={200} noun="modules" render={row} />
              </div>
            ))}
          </div>

          {mayAssign ? (
            <div className="v2-card v2-card-pad v2-stack" style={{ gap: 10 }}>
              <Field label="Place the selected modules in">
                <select className="v2-select" value={dest} onChange={(e) => setDest(e.target.value)} disabled={busy || !data.hasPublication} data-testid="assign-dest">
                  {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="New chapter (optional)" hint="Leave empty to put the modules directly in the place chosen above. A name creates a chapter there and puts them in it.">
                <input className="v2-input" value={newFolder} maxLength={200} onChange={(e) => setNewFolder(e.target.value)} disabled={busy || !data.hasPublication} data-testid="assign-newfolder" />
              </Field>
              <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={atStart} onChange={(e) => setAtStart(e.target.checked)} disabled={busy} />Put them at the start instead of the end</label>
              <div className="v2-row">
                <button className="btn btn-primary" disabled={busy || ticked.size === 0 || !data.hasPublication} onClick={() => void place()} data-testid="assign-go">{busy ? <Spinner /> : null}Place {plural(ticked.size, 'module')}</button>
                {ticked.size === 0 ? <span className="v2-hint">Tick the modules to place.</span> : null}
              </div>
            </div>
          ) : <Alert>Only an editor, manager or owner can change the publication.</Alert>}
        </>
      )}
    </div>
  );
}
