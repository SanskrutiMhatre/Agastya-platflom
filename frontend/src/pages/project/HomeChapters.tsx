// UI redesign screen 2 (owner-approved mockup docs/audit/mockups/project.html, 2026-11-28): "Data module status by chapter" on the
// Project Home of an S1000D project. Real data only: the publication's chapters (the same tree the Explore page shows), the modules'
// issue state (the editor's list) and the findings of the last check (the same problems model the Validation page shows).
//
// The mockup's five-part bar (approved, in review, draft, has errors, empty) is drawn with what the platform records per module:
//   issued       in the publication, no errors or warnings, an issue (inWork 00)          the mockup's "approved" colour
//   in work      in the publication, no errors or warnings, still in work (inWork not 00)  the mockup's "in review" colour
//   warnings     in the publication, warnings only                                         the mockup's "draft" colour
//   has errors   in the publication, at least one error                                    the mockup's "has errors" colour
//   not placed   not in the publication                                                    the mockup's "empty" part
// The table's SNS code is the system and subsystem the chapter's modules share (their data module codes); Progress is the share of the
// chapter's modules without errors.

import { Link } from 'react-router-dom';
import type { DmSummary, Explore, ExploreNode, ProblemRow } from '../../api';
import { Icon } from '../../components/Icon';

const base = (f: string): string => f.split(/[\\/]/).pop() ?? f;
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

function filesOf(nodes: ExploreNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'dm') out.push(base(n.file));
    else if (n.kind === 'chapter') filesOf(n.children, out);
  }
  return out;
}

interface Row { title: string; code: string; files: string[]; err: number; errors: number; warnings: number }
export interface HomeChaptersData { ex: Explore | null; problems: ProblemRow[]; dms: DmSummary[] }

/** The SNS code a chapter's modules share: system and subsystem ("29-10") when they all agree, the system ("29") when only that does. */
function snsOf(files: string[], byFile: Map<string, DmSummary>): string {
  const codes = files.map((f) => byFile.get(f)?.dmCodeAttrs).filter((a): a is Record<string, string> => !!a);
  if (!codes.length || codes.length !== files.length) return '';
  const sys = new Set(codes.map((a) => a.systemCode ?? ''));
  if (sys.size !== 1 || ![...sys][0]) return '';
  const sub = new Set(codes.map((a) => `${a.subSystemCode ?? ''}${a.subSubSystemCode ?? ''}`));
  return sub.size === 1 ? `${[...sys][0]}-${[...sub][0]}` : [...sys][0];
}

export function HomeChapters({ checked, data, error }: { checked: boolean; data: HomeChaptersData | null; error?: string }) {
  if (!data?.ex) {
    return (
      <section className="card" aria-labelledby="home-chap-h" data-testid="home-chapters">
        <div className="card-head"><h3 id="home-chap-h"><Icon name="layers" />Data module status by chapter</h3></div>
        <p className="faint pad">{error ? error : data ? 'The publication could not be read.' : 'Loading…'}</p>
      </section>
    );
  }

  const { ex, problems, dms } = data;
  const byFile = new Map(dms.map((m) => [base(m.file), m]));
  // per module: open errors and warnings of the last check (a waived finding does not count, as on the Validation page)
  const perFile = new Map<string, { e: number; w: number }>();
  for (const p of problems) {
    if (p.state === 'waived') continue;
    const k = base(p.file); const c = perFile.get(k) ?? { e: 0, w: 0 };
    if (p.severity === 'error') c.e++; else if (p.severity === 'warn') c.w++;
    perFile.set(k, c);
  }
  const rowOf = (title: string, files: string[]): Row => {
    let err = 0, errors = 0, warnings = 0;
    for (const f of files) { const c = perFile.get(f); if (!c) continue; errors += c.e; warnings += c.w; if (c.e) err++; }
    return { title, code: snsOf(files, byFile), files, err, errors, warnings };
  };
  const loose = ex.tree.filter((n) => n.kind !== 'chapter');
  const rows: Row[] = [
    ...ex.tree.flatMap((n) => (n.kind === 'chapter' ? [rowOf(n.title, filesOf(n.children))] : [])),
    ...(filesOf(loose).length ? [rowOf('Outside a chapter', filesOf(loose))] : []),
  ];
  let issued = 0, inWork = 0, warnOnly = 0, err = 0;
  for (const f of rows.flatMap((r) => r.files)) {
    const c = perFile.get(f);
    if (c?.e) err++;
    else if (c?.w) warnOnly++;
    else if ((byFile.get(f)?.inWork ?? '00') !== '00') inWork++;
    else issued++;
  }
  const unplaced = ex.totals.unplaced;
  const all = issued + inWork + warnOnly + err + unplaced || 1;
  const pct = (n: number) => `${(n / all) * 100}%`;

  return (
    <section className="card" aria-labelledby="home-chap-h" data-testid="home-chapters">
      <div className="card-head">
        <h3 id="home-chap-h"><Icon name="layers" />Data module status by chapter</h3>
        <span className="faint">{plural(ex.totals.dms, 'module')}</span>
      </div>
      <div className="card-body">
        <div className="stackbar" role="img" data-testid="home-chapters-bar"
          aria-label={`${issued} issued, ${inWork} in work, ${warnOnly} with warnings only, ${err} with errors, ${unplaced} not in the publication`}>
          {issued ? <i className="approved" style={{ width: pct(issued) }} title="Issued" /> : null}
          {inWork ? <i className="review" style={{ width: pct(inWork) }} title="In work" /> : null}
          {warnOnly ? <i className="draft" style={{ width: pct(warnOnly) }} title="Warnings only" /> : null}
          {err ? <i className="error" style={{ width: pct(err) }} title="Has errors" /> : null}
          {unplaced ? <i className="empty" style={{ width: pct(unplaced) }} title="Not in the publication" /> : null}
        </div>
        <div className="legend">
          <span><i className="sw approved" />{checked ? 'Issued' : 'Issued, not checked'} {issued}</span>
          <span><i className="sw review" />In work {inWork}</span>
          <span><i className="sw draft" />Warnings {warnOnly}</span>
          <span><i className="sw error" />Has errors {err}</span>
          <span className="faint">Not placed {unplaced}</span>
        </div>
      </div>
      {rows.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>SNS chapter</th><th className="num">Modules</th><th style={{ width: '30%' }}>Progress</th><th>Validation</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const ok = r.files.length - r.err;
              return (
                <tr key={`${i}-${r.title}`} data-testid="home-chapter-row">
                  <td>{r.code ? <><span className="mono faint">{r.code}</span>&nbsp; </> : null}{r.title}</td>
                  <td className="num">{r.files.length}</td>
                  <td><div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={r.files.length} aria-valuenow={ok} aria-label={`${r.title}: modules without errors`} title="Modules without errors">
                    <i className="success" style={{ width: `${r.files.length ? (ok / r.files.length) * 100 : 0}%` }} /></div></td>
                  <td>{!checked ? <span className="badge">Not checked</span>
                    : r.errors ? <Link className="badge danger" to="../validation">{plural(r.errors, 'error')}</Link>
                    : r.warnings ? <Link className="badge warning" to="../validation">{plural(r.warnings, 'warning')}</Link>
                    : <span className="badge success">Clean</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      ) : <p className="faint pad">The publication has no chapters yet. <Link to="../publication">Arrange it on the Publication page</Link>.</p>}
    </section>
  );
}
