// UI redesign screen 2 (owner-approved mockup docs/audit/mockups/project.html, 2026-11-28): "Data module status by SNS chapter" on the
// Project Home of an S1000D project. Real data only: the publication's chapters (the same tree the Explore page shows) and the findings of
// the last check (the same problems model the Validation page shows). The mockup's Approved / In review / Draft split per module is not
// something the server records per module, so the bar shows what it does know: clean, warnings only, with errors, not in the publication.

import { Link } from 'react-router-dom';
import { contentApi, problemsApi, type ExploreNode, type ProblemRow } from '../../api';
import { Icon } from '../../components/Icon';
import { useAsync } from '../../components/ui';

const base = (f: string): string => f.split(/[\\/]/).pop() ?? f;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

function filesOf(nodes: ExploreNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'dm') out.push(base(n.file));
    else if (n.kind === 'chapter') filesOf(n.children, out);
  }
  return out;
}

interface Row { title: string; files: string[]; err: number; warnOnly: number; errors: number; warnings: number }

export function HomeChapters({ id, checked }: { id: string; checked: boolean }) {
  const data = useAsync(async () => {
    const [ex, pr] = await Promise.all([contentApi.explore(id), problemsApi.list(id).catch(() => null)]);
    return { ex, problems: (pr?.problems ?? []) as ProblemRow[], ranAt: pr?.ranAt ?? null };
  }, [id]);

  if (!data.data) {
    return (
      <section className="card v2-card" aria-labelledby="home-chap-h" data-testid="home-chapters">
        <div className="card-head"><h3 id="home-chap-h"><Icon name="layers" />Data module status by chapter</h3></div>
        <p className="faint home-pad">{data.error ? data.error : 'Loading…'}</p>
      </section>
    );
  }

  const { ex, problems } = data.data;
  // per module: open errors and warnings of the last check (a waived finding does not count, as on the Validation page)
  const perFile = new Map<string, { e: number; w: number }>();
  for (const p of problems) {
    if (p.state === 'waived') continue;
    const k = base(p.file); const c = perFile.get(k) ?? { e: 0, w: 0 };
    if (p.severity === 'error') c.e++; else if (p.severity === 'warn') c.w++;
    perFile.set(k, c);
  }
  const rowOf = (title: string, files: string[]): Row => {
    let err = 0, warnOnly = 0, errors = 0, warnings = 0;
    for (const f of files) { const c = perFile.get(f); if (!c) continue; errors += c.e; warnings += c.w; if (c.e) err++; else if (c.w) warnOnly++; }
    return { title, files, err, warnOnly, errors, warnings };
  };
  const loose = ex.tree.filter((n) => n.kind !== 'chapter');
  const rows: Row[] = [
    ...ex.tree.flatMap((n) => (n.kind === 'chapter' ? [rowOf(n.title, filesOf(n.children))] : [])),
    ...(filesOf(loose).length ? [rowOf('Outside a chapter', filesOf(loose))] : []),
  ];
  const placed = rows.reduce((a, r) => a + r.files.length, 0);
  const err = rows.reduce((a, r) => a + r.err, 0);
  const warnOnly = rows.reduce((a, r) => a + r.warnOnly, 0);
  const clean = placed - err - warnOnly;
  const unplaced = ex.totals.unplaced;
  const all = placed + unplaced || 1;
  const pct = (n: number) => `${(n / all) * 100}%`;

  return (
    <section className="card v2-card" aria-labelledby="home-chap-h" data-testid="home-chapters">
      <div className="card-head">
        <h3 id="home-chap-h"><Icon name="layers" />Data module status by chapter</h3>
        <span className="faint">{plural(ex.totals.dms, 'module')}</span>
      </div>
      <div className="card-body">
        <div className="home-stackbar" role="img" data-testid="home-chapters-bar"
          aria-label={`${clean} clean, ${warnOnly} with warnings only, ${err} with errors, ${unplaced} not in the publication`}>
          {clean ? <i className="clean" style={{ width: pct(clean) }} title="Clean" /> : null}
          {warnOnly ? <i className="warn" style={{ width: pct(warnOnly) }} title="Warnings only" /> : null}
          {err ? <i className="error" style={{ width: pct(err) }} title="Has errors" /> : null}
          {unplaced ? <i className="empty" style={{ width: pct(unplaced) }} title="Not in the publication" /> : null}
        </div>
        <div className="home-legend">
          <span><i className="sw clean" />{checked ? 'Clean' : 'Not checked'} {clean}</span>
          <span><i className="sw warn" />Warnings only {warnOnly}</span>
          <span><i className="sw error" />Has errors {err}</span>
          <span><i className="sw empty" />Not in the publication {unplaced}</span>
        </div>
      </div>
      {rows.length ? (
        <div className="table-wrap"><table className="table home-table">
          <thead><tr><th>Chapter</th><th className="num">Modules</th><th style={{ width: '30%' }}>Without errors</th><th>Validation</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const ok = r.files.length - r.err;
              return (
                <tr key={`${i}-${r.title}`} data-testid="home-chapter-row">
                  <td>{r.title}</td>
                  <td className="num">{r.files.length}</td>
                  <td><div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={r.files.length} aria-valuenow={ok} aria-label={`${r.title}: modules without errors`}>
                    <i className={r.err ? 'warning' : 'success'} style={{ width: `${r.files.length ? (ok / r.files.length) * 100 : 0}%` }} /></div></td>
                  <td>{!checked ? <span className="badge">Not checked</span>
                    : r.errors ? <Link className="badge danger" to="../validation">{plural(r.errors, 'error')}</Link>
                    : r.warnings ? <Link className="badge warning" to="../validation">{plural(r.warnings, 'warning')}</Link>
                    : <span className="badge success">Clean</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      ) : <p className="faint home-pad">The publication has no chapters yet. <Link to="../publication">Arrange it on the Publication page</Link>.</p>}
    </section>
  );
}
