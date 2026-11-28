// Validation: run every check on the project, then review what it found.
//
// The review half is the point. Each finding says what is wrong, where (file and
// line) and which check found it; the author can filter, mark findings as
// reviewed (for the whole team, on the server, with who and when: WP-22), jump to the offending line in
// the editor, or export the list.
//
// UI redesign screen 5 (owner approved mockups 2026-11-28, docs/audit/mockups/validation.html): a severity summary whose cards are the
// severity filters, the findings as a table (grouped by module, or flat), the selected finding beside it with its source excerpt (the
// module's own lines, read from the server) and the errors counted by check.

import { useEffect, useMemo, useState } from 'react';
import '../../styles/pages/structure.css';   // WP-35: this page's styles load with its chunk
import '../../styles/pages/validation.css';  // the report layout (mockup validation.html)
import { useNavigate } from 'react-router-dom';
import { contentApi, problemsApi, type ReviewMark, type ValidationIssue, type ValidationRun } from '../../api';
import { forgetLegacyReviewed, issueKey, legacyReviewedKeys, severityLabel } from '../../lib/problems';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Empty, Loading, Spinner, ago, errText, fmtDate, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { may } from '../../lib/roles';
import { useUi } from '../../store/ui';
import { csvRow } from '../../lib/csv';
import { MoreRows, useProgressive } from '../../components/windowing';
import { SourceExcerpt } from './ValidationSource';

const SOURCE_LABEL: Record<string, string> = {
  xml: 'Well-formedness', xsd: 'S1000D schema', brex: 'Business rules (BREX)', graphics: 'Graphics', ids: 'Identifiers', icn: 'ICN entities', pm: 'Publication',
};
// the short names of the source filter and the summary cards (mockup: XSD · BREX · Link)
const SOURCE_SHORT: Record<string, string> = { xml: 'XML', xsd: 'XSD', brex: 'BREX', graphics: 'Graphics', ids: 'IDs', icn: 'ICN', pm: 'Publication' };
const label = (s: string) => SOURCE_LABEL[s] ?? s;
const short = (s: string) => SOURCE_SHORT[s] ?? s;
const sevTone = (s: ValidationIssue['sev']) => (s === 'error' ? 'bad' : s === 'warn' ? 'warn' : undefined);
const SEV_ICON = { error: 'alert', warn: 'warn', info: 'info' } as const;
const SEV_CLASS = { error: 'danger', warn: 'warning', info: 'info' } as const;

/**
 * WP-22 (UX-008, FE-015): the "reviewed" marks are the team's, on the server (who and when), not this browser's. Marks an earlier version kept
 * in this browser are moved to the server once, by someone who may mark findings; then the browser copy is forgotten.
 */
function useReviewed(projectId: string, canMark: boolean) {
  const toast = useUi((s) => s.toast);
  const [marks, setMarks] = useState<Map<string, ReviewMark>>(new Map());
  const keep = (list: ReviewMark[]) => setMarks(new Map(list.map((m) => [m.key, m])));
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let list = await problemsApi.marks(projectId);
        const legacy = legacyReviewedKeys(projectId).filter((k) => !list.some((m) => m.key === k));
        if (legacy.length && canMark) { list = await problemsApi.setReviewed(projectId, legacy.slice(0, 2000), true); forgetLegacyReviewed(projectId); }
        if (live) keep(list);
      } catch { /* the page still shows the findings; the marks are shown once the server answers */ }
    })();
    return () => { live = false; };
  }, [projectId, canMark]);
  const toggle = async (k: string) => {
    try { keep(await problemsApi.setReviewed(projectId, [k], !marks.has(k))); }
    catch (e) { toast(errText(e), 'error'); }
  };
  return { reviewed: marks, toggle };
}

function toCsv(issues: ValidationIssue[]): string {
  // WP-07 (ARC-020): one cell writer; a title or detail beginning with = is written as text
  return ['severity,check,file,line,title,detail', ...issues.map((i) => csvRow([i.sev, label(i.source), i.rel, i.line, i.title, i.detail]))].join('\r\n');
}

/** "3 XSD · 11 BREX": how the findings of one severity split over the checks (the line under each summary card). */
function split(issues: ValidationIssue[]): string {
  const m = new Map<string, number>();
  for (const i of issues) m.set(i.source, (m.get(i.source) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s, n]) => `${n} ${short(s)}`).join(' · ');
}

export function ValidationPage() {
  const { id, can, reload } = useProject();
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const last = useAsync(() => contentApi.validation(id), [id]);
  const [run, setRun] = useState<ValidationRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('auto');
  const [brex, setBrex] = useState(true);   // business rules are part of publication, so they are part of the default check
  const [sev, setSev] = useState<Record<string, boolean>>({ error: true, warn: true, info: false });
  const [source, setSource] = useState('all');
  const [q, setQ] = useState('');
  const [hideReviewed, setHideReviewed] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [selId, setSelId] = useState<string | null>(null);
  const { reviewed, toggle } = useReviewed(id, may(can, 'problems.review'));

  useEffect(() => { if (last.data?.run && !run) setRun(last.data.run); }, [last.data, run]);
  // the project's saved choice (the same one the build and release checks use)
  useEffect(() => { if (last.data?.issue) setIssue(last.data.issue); }, [last.data?.issue]);
  const chooseIssue = async (v: string) => {
    const before = issue;
    setIssue(v);
    if (!may(can, 'validate.run')) return;
    try { await contentApi.setValidationIssue(id, v); toast(v === 'auto' ? 'Checks use each module\'s own S1000D issue' : `Checks now use S1000D issue ${v}, also when building and releasing`, 'success'); }
    catch (e) { setIssue(before); toast(errText(e), 'error'); }
  };

  const start = async () => {
    setBusy(true);
    try { const r = await contentApi.validate(id, { issue, brex }); setRun(r); setSelId(null); reload(); toast(r.summary.error ? `${r.summary.error} error${r.summary.error === 1 ? '' : 's'} found` : 'No errors found', r.summary.error ? 'error' : 'success'); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };

  const all = run?.issues ?? [];
  const shown = useMemo(() => all.filter((i) =>
    sev[i.sev] && (source === 'all' || i.source === source) && (!hideReviewed || !reviewed.has(issueKey(i)))
    && (!q || `${i.title} ${i.detail} ${i.rel} ${i.loc}`.toLowerCase().includes(q.toLowerCase()))), [all, sev, source, q, hideReviewed, reviewed]);
  const byFile = useMemo(() => {
    if (!grouped) return [['', shown]] as Array<[string, ValidationIssue[]]>;
    const m = new Map<string, ValidationIssue[]>();
    for (const i of shown) { const k = i.rel || '(project)'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(i); }
    return [...m.entries()].sort((a, b) => b[1].filter((x) => x.sev === 'error').length - a[1].filter((x) => x.sev === 'error').length || a[0].localeCompare(b[0]));
  }, [shown, grouped]);
  // WP-18 (FE-030): thousands of findings draw their first rows, more as the end comes into view (groups keep their order and headings)
  const drawn = useProgressive(shown.length, `${run?.ranAt ?? ''}|${q}|${source}|${hideReviewed}|${grouped}|${sev.error}${sev.warn}${sev.info}`);
  const groups = useMemo(() => {
    let left = drawn.limit; const out: Array<[string, ValidationIssue[], number]> = [];
    for (const [file, list] of byFile) { if (left <= 0) break; out.push([file, list.slice(0, left), list.length]); left -= list.length; }
    return out;
  }, [byFile, drawn.limit]);
  const selected = all.find((i) => i.id === selId) ?? null;
  const sources = [...new Set(all.map((i) => i.source))];
  const reviewedCount = useMemo(() => all.filter((i) => reviewed.has(issueKey(i))).length, [all, reviewed]);
  // the errors counted by check title (mockup "Errors by rule"): the run's own findings, the most frequent first
  const byRule = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const i of all) if (i.sev === 'error') { const k = `${i.source}|${i.title}`; const e = m.get(k) ?? { label: `${short(i.source)} · ${i.title}`, n: 0 }; e.n++; m.set(k, e); }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  }, [all]);

  if (last.loading && !last.data) return <Loading />;
  const editable = selected && /^csdb\/.*\.xml$/i.test(selected.rel);
  const exportCsv = () => { const url = URL.createObjectURL(new Blob([toCsv(shown)], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = 'validation.csv'; a.click(); URL.revokeObjectURL(url); };
  const copyWhere = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast('Location copied', 'success'); } catch { toast('The browser did not allow copying', 'error'); }
  };
  const choose = (i: ValidationIssue) => setSelId(i.id);
  const sevCard = (s: 'error' | 'warn' | 'info', cls: string, color: string, name: string) => (
    <label key={s} className={`stat val-stat ${cls}`} data-on={sev[s]}>
      <span className="val-stat-top"><span className="v" style={{ color: `var(${color})` }}>{run!.summary[s]}</span><input type="checkbox" checked={sev[s]} onChange={(e) => setSev({ ...sev, [s]: e.target.checked })} /></span>
      <span className="l">{name}</span>
      <span className="d faint">{split(all.filter((i) => i.sev === s)) || 'None'}</span>
    </label>
  );

  return (
    <div className="v2-page val-page">
      <PageHeader icon="shield" title="Validation report"
        sub={run ? `Last run ${ago(run.ranAt)} · ${run.checked} files read, ${run.schemaChecked} checked against a schema${run.brexChecked ? `, ${run.brexChecked} against BREX` : ''}.` : 'Check the project against the S1000D schemas and your business rules, then review every finding.'}
        actions={<div className="v2-row wrap row">
          <select className="v2-select select v2-val-issue-sel" value={issue} onChange={(e) => void chooseIssue(e.target.value)} aria-label="S1000D issue" data-testid="validation-issue" title="Which S1000D issue the checks use: the schema and the default business rules (BREX). Saved with the project; the build and release checks use it too.">
            <option value="auto">S1000D issue: as declared</option>
            {(last.data?.schemaIssues ?? []).map((i) => <option key={i} value={i}>S1000D issue {i}</option>)}
          </select>
          <label className="check v2-val-check"><input type="checkbox" checked={brex} onChange={(e) => setBrex(e.target.checked)} />Include BREX</label>
          {run ? <button className="btn" onClick={exportCsv} title="The findings shown, as a CSV file"><Icon name="download" size={14} />Export CSV</button> : null}
          <button className="btn btn-primary primary" onClick={start} disabled={busy || !may(can, 'validate.run')} data-testid="run-validation">{busy ? <Spinner /> : <Icon name="refresh" size={14} />}Run validation</button>
        </div>} />
      {!may(can, 'validate.run') ? <div className="v2-val-notes"><Alert tone="warn">Viewers can review the last run but cannot start a new one.</Alert></div> : null}

      {!run ? <div className="v2-card card"><Empty title="Not validated yet">{may(can, 'validate.run') ? 'Press “Run validation” to check every data module and the publication.' : 'Nobody has run validation on this project yet.'}</Empty></div> : (
        <>
          {run.notes.length ? <div className="v2-val-notes"><Alert>{run.notes.slice(0, 3).join(' · ')}</Alert></div> : null}

          {/* the severity summary: each card is the filter of its severity (mockup .sum); the fourth counts the team's reviewed marks */}
          <section className="sum val-sum" aria-label="Severity summary">
            {sevCard('error', 'e', '--danger', 'Errors')}
            {sevCard('warn', 'w', '--warning', 'Warnings')}
            {sevCard('info', 'i', '--info', 'Notes')}
            <label className="stat val-stat s" data-on={hideReviewed}>
              <span className="val-stat-top"><span className="v" style={{ color: 'var(--success)' }}>{reviewedCount}</span><input type="checkbox" checked={hideReviewed} onChange={(e) => setHideReviewed(e.target.checked)} /></span>
              <span className="l">Reviewed · Hide reviewed</span>
              <span className="d faint">Marked for the whole team</span>
            </label>
          </section>

          <div className="val-layout">
            <section className="card v2-card val-issues" aria-labelledby="val-iss-h">
              <div className="card-head">
                <h3 id="val-iss-h"><Icon name="tree" size={16} />Issues <span className="faint val-count" aria-live="polite">{shown.length} of {all.length} shown</span></h3>
              </div>
              <div className="val-bar" role="group" aria-label="Filter findings">
                <input className="input search v2-input" placeholder="Search findings…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search findings" />
                <div className="seg val-seg" role="group" aria-label="Filter by check">
                  <button type="button" aria-pressed={source === 'all'} onClick={() => setSource('all')}>All</button>
                  {sources.map((s) => <button key={s} type="button" aria-pressed={source === s} onClick={() => setSource(s)} title={label(s)}>{short(s)}</button>)}
                </div>
                <span className="grow" />
                <label className="check v2-val-check"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />Group by module</label>
              </div>
              <div className="table-wrap" data-testid="issue-list">
                {shown.length === 0 ? <Empty title={all.length ? 'Nothing matches these filters' : 'No problems found'}>{all.length ? 'Adjust the filters above.' : 'Every check passed.'}</Empty> : (
                  <table className="table issues val-table" aria-label="Issues">
                    <thead><tr><th className="val-sevcol"><span className="sr">Severity</span></th><th>Message and location</th><th>Check</th><th className="num">Line</th><th>Module</th></tr></thead>
                    <tbody>
                      {groups.map(([file, list, count]) => [
                        grouped ? <tr key={`g:${file}`} className="val-group"><td colSpan={5}><Icon name="xml" size={14} /><span className="trunc mono" title={file}>{file}</span><Badge tone={list.some((x) => x.sev === 'error') ? 'bad' : 'warn'}>{count}</Badge></td></tr> : null,
                        ...list.map((i) => {
                          const done = reviewed.has(issueKey(i));
                          return (
                            <tr key={i.id} aria-selected={selId === i.id} tabIndex={0} onClick={() => choose(i)} data-testid="issue" className={done ? 'done' : undefined}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(i); } }}>
                              <td className="val-sevcol"><span className={`sevic ${SEV_CLASS[i.sev]}`}><Icon name={SEV_ICON[i.sev]} size={14} /><span className="sr">{i.sev}</span></span></td>
                              <td className="val-msg">
                                <div className="trunc val-title">{i.title}{done ? <> <Badge tone="ok">Reviewed</Badge></> : null}</div>
                                <div className="faint mono val-loc">{i.loc || (i.detail.length > 120 ? `${i.detail.slice(0, 120)}…` : i.detail)}</div>
                              </td>
                              <td><Badge>{short(i.source)}</Badge></td>
                              <td className="num mono">{i.line}</td>
                              <td className="mono faint val-file"><span className="trunc" title={i.rel}>{i.file || i.rel}</span></td>
                            </tr>
                          );
                        }),
                      ])}
                    </tbody>
                  </table>
                )}
              </div>
              {shown.length ? <MoreRows shown={drawn.limit} total={shown.length} onMore={drawn.more} onAll={drawn.all} /> : null}
            </section>

            <aside className="stack val-side" aria-label="Finding">
              <section className="card v2-card detail val-detail" aria-labelledby="val-d-h">
                {selected ? (
                  <>
                    <div className="card-head"><h3 id="val-d-h"><span className={`sevic ${SEV_CLASS[selected.sev]}`}><Icon name={SEV_ICON[selected.sev]} size={16} /></span>{selected.title}</h3><Badge>{short(selected.source)}</Badge></div>
                    <div className="card-body" data-testid="issue-detail">
                      <div className="row v2-row"><Badge tone={sevTone(selected.sev)}>{severityLabel(selected.sev)}</Badge><Badge>{label(selected.source)}</Badge></div>
                      <p className="v2-val-text">{selected.detail}</p>
                      <dl className="kv val-kv">
                        <dt>File</dt><dd className="mono">{selected.rel}</dd>
                        <dt>Line</dt><dd>{selected.line}</dd>
                        {selected.loc ? <><dt>Where</dt><dd className="mono">{selected.loc}</dd></> : null}
                        <dt>Run</dt><dd>{fmtDate(run.ranAt)}</dd>
                        {reviewed.get(issueKey(selected)) ? <><dt>Reviewed</dt><dd data-testid="issue-reviewed-by">{reviewed.get(issueKey(selected))!.byName ?? reviewed.get(issueKey(selected))!.by} · {fmtDate(reviewed.get(issueKey(selected))!.at)}</dd></> : null}
                      </dl>
                      {editable ? <SourceExcerpt projectId={id} file={selected.file} line={selected.line} /> : null}
                      <div className="row v2-row wrap">
                        {editable ? <button className="btn btn-primary primary sm" onClick={() => nav(`../editor?file=${encodeURIComponent(selected.file)}&line=${selected.line}`)}><Icon name="editor" size={14} />Open at line {selected.line}</button>
                          : selected.source === 'pm' ? <button className="btn btn-primary primary sm" onClick={() => nav('../publication')}><Icon name="book" size={14} />Open Publication</button> : null}
                        {selected.loc ? <button className="btn sm" onClick={() => void copyWhere(selected.loc)}><Icon name="copy" size={14} />Copy location</button> : null}
                      </div>
                      <div className="field val-review">
                        <button className="btn sm" onClick={() => void toggle(issueKey(selected))} data-testid="issue-mark-reviewed" disabled={!may(can, 'problems.review')}
                          title={may(can, 'problems.review') ? 'Marks the finding reviewed for everyone on the project (your name and the time are kept)' : 'Reviewers, editors, managers and owners mark findings reviewed'}><Icon name="check" size={14} />{reviewed.has(issueKey(selected)) ? 'Unmark reviewed' : 'Mark reviewed'}</button>
                        {!may(can, 'problems.review') ? <span className="error"><Icon name="alert" size={13} />Reviewers, editors, managers and owners mark findings reviewed.</span>
                          : <span className="hint">The mark is the team's: your name and the time are kept.</span>}
                      </div>
                    </div>
                  </>
                ) : <div className="card-body"><Empty title="Select a finding">Its explanation, the source lines and a link to the exact line appear here.</Empty></div>}
              </section>
              {byRule.length ? (
                <section className="card v2-card" aria-labelledby="val-br-h">
                  <div className="card-head"><h3 id="val-br-h"><Icon name="alert" size={16} />Errors by check</h3></div>
                  <ul className="byrule">
                    {byRule.map((r) => <li key={r.label}><span className="trunc" title={r.label}>{r.label}</span><span className="progress" aria-hidden="true"><i style={{ width: `${Math.round((r.n / byRule[0].n) * 100)}%` }} /></span><span className="num faint">{r.n}</span></li>)}
                  </ul>
                </section>
              ) : null}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
