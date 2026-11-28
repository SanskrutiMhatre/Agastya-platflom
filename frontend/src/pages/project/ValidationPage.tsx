// Validation: run every check on the project, then review what it found.
//
// The review half is the point. Each finding says what is wrong, where (file and
// line) and which check found it; the author can filter, mark findings as
// reviewed (for the whole team, on the server, with who and when: WP-22), jump to the offending line in
// the editor, or export the list.
//
// UI redesign screen 5 (owner approved mockup docs/audit/mockups/validation.html, drawn exactly): the page actions in the top bar (Export
// report, Run validation), the counts in the status bar, a severity summary whose cards are the severity filters, the findings as a table
// (message and location, source, rule, module) with a pager, the selected finding beside it with its source excerpt (the module's own
// lines, read from the server), the review form, and the errors counted by rule.

import { useEffect, useMemo, useState } from 'react';
import '../../styles/pages/structure.css';   // WP-35: this page's styles load with its chunk
import '../../styles/pages/validation.css';  // the report layout (mockup validation.html)
import { useNavigate } from 'react-router-dom';
import { contentApi, problemsApi, type ReviewMark, type ValidationIssue, type ValidationRun } from '../../api';
import { forgetLegacyReviewed, issueKey, legacyReviewedKeys, severityLabel } from '../../lib/problems';
import { Icon } from '../../components/Icon';
import { Callout, EmptyState, Loading, Spinner, ago, errText, fmtDate, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { StatusItems, TopbarActions } from '../../layouts/shellSlots';
import { may } from '../../lib/roles';
import { useUi } from '../../store/ui';
import { csvRow } from '../../lib/csv';
import { SourceExcerpt } from './ValidationSource';
import { dmcOf, messageOf, moduleShort, ruleOf, whereOf } from './validationView';

const SOURCE_LABEL: Record<string, string> = {
  xml: 'Well-formedness', xsd: 'S1000D schema', brex: 'Business rules (BREX)', graphics: 'Graphics', ids: 'Identifiers', icn: 'ICN entities', pm: 'Publication',
};
// the short names of the source filter, the Source column and the summary cards (mockup: XSD · BREX · Link)
const SOURCE_SHORT: Record<string, string> = { xml: 'XML', xsd: 'XSD', brex: 'BREX', graphics: 'Graphics', ids: 'IDs', icn: 'ICN', pm: 'Publication' };
const label = (s: string) => SOURCE_LABEL[s] ?? s;
const short = (s: string) => SOURCE_SHORT[s] ?? s;
const SEV_ICON = { error: 'xcircle', warn: 'warn', info: 'info' } as const;
const SEV_CLASS = { error: 'danger', warn: 'warning', info: 'info' } as const;
/** The checks whose errors stop a PDF or a release (services/publishGate.ts): well-formedness, the schema, the business rules, the publication. */
const BLOCKING = new Set(['xml', 'xsd', 'brex', 'pm']);
const PAGE = 50;
type Sev = ValidationIssue['sev'];

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
  const toggle = async (k: string, note?: string): Promise<boolean> => {
    try { keep(await problemsApi.setReviewed(projectId, [k], !marks.has(k), note)); return true; }
    catch (e) { toast(errText(e), 'error'); return false; }
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
  // the severity filters: none chosen yet = the mockup's default (the errors, when there are any; else errors and warnings)
  const [sevPick, setSevPick] = useState<Record<Sev, boolean> | null>(null);
  const [source, setSource] = useState('all');
  const [mod, setMod] = useState('all');
  const [q, setQ] = useState('');
  const [hideReviewed, setHideReviewed] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [page, setPage] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const canMark = may(can, 'problems.review');
  const { reviewed, toggle } = useReviewed(id, canMark);
  // the waived count of the problems model (WP-22: a BREX finding covered by a recorded publish waiver)
  const model = useAsync(() => problemsApi.list(id), [id, run?.ranAt ?? '']);

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
  const sev: Record<Sev, boolean> = sevPick ?? (run?.summary.error ? { error: true, warn: false, info: false } : { error: true, warn: true, info: false });
  const shown = useMemo(() => all.filter((i) =>
    sev[i.sev] && (source === 'all' || i.source === source) && (mod === 'all' || i.rel === mod) && (!hideReviewed || !reviewed.has(issueKey(i)))
    && (!q || `${i.title} ${i.detail} ${i.rel} ${i.loc} ${ruleOf(i)} ${messageOf(i)}`.toLowerCase().includes(q.toLowerCase()))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [all, sev.error, sev.warn, sev.info, source, mod, q, hideReviewed, reviewed]);
  // grouped by module: the modules with the most errors first; the pager counts findings, not headings
  const ordered = useMemo(() => {
    if (!grouped) return shown;
    const m = new Map<string, ValidationIssue[]>();
    for (const i of shown) { const k = i.rel || '(project)'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(i); }
    return [...m.entries()].sort((a, b) => b[1].filter((x) => x.sev === 'error').length - a[1].filter((x) => x.sev === 'error').length || a[0].localeCompare(b[0])).flatMap(([, l]) => l);
  }, [shown, grouped]);
  const filterKey = `${run?.ranAt ?? ''}|${q}|${source}|${mod}|${hideReviewed}|${grouped}|${sev.error}${sev.warn}${sev.info}`;
  useEffect(() => { setPage(0); }, [filterKey]);
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE));
  const at = Math.min(page, pages - 1);
  const rows = ordered.slice(at * PAGE, at * PAGE + PAGE);
  // the selected finding: the one chosen, else the first one shown (the mockup opens on the first finding)
  const selected = all.find((i) => i.id === selId) ?? rows[0] ?? null;
  useEffect(() => { setNote(''); }, [selected?.id]);
  const sources = [...new Set(all.map((i) => i.source))];
  const modules = useMemo(() => [...new Set(all.map((i) => i.rel).filter(Boolean))].sort(), [all]);
  const reviewedCount = useMemo(() => all.filter((i) => reviewed.has(issueKey(i))).length, [all, reviewed]);
  const blocking = all.filter((i) => i.sev === 'error' && BLOCKING.has(i.source)).length;
  // the errors counted by rule (mockup "Errors by rule"): the run's own findings, the most frequent first
  const byRule = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const i of all) if (i.sev === 'error') {
      const k = `${i.source}|${ruleOf(i)}`;
      // as the mockup names a rule: "BREX 009 · warning before step", "XSD · sequence / ID"
      const e = m.get(k) ?? { label: i.source === 'brex' ? `BREX ${ruleOf(i).replace(/^BREX-/i, '')} · ${messageOf(i)}` : `${short(i.source)} · ${i.source === 'xsd' || i.source === 'xml' ? ruleOf(i) : i.title}`, n: 0 };
      e.n++; m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  }, [all]);

  if (last.loading && !last.data) return <Loading />;
  const editable = selected && /^csdb\/.*\.xml$/i.test(selected.rel);
  const exportCsv = () => { const url = URL.createObjectURL(new Blob([toCsv(shown)], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = 'validation.csv'; a.click(); URL.revokeObjectURL(url); };
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`, 'success'); } catch { toast('The browser did not allow copying', 'error'); }
  };
  const copyList = () => void copy(ordered.map((i) => [severityLabel(i.sev), short(i.source), ruleOf(i), moduleShort(i.file), whereOf(i), messageOf(i)].join('\t')).join('\n'), 'List');
  const choose = (i: ValidationIssue) => setSelId(i.id);
  const setSev = (s: Sev, on: boolean) => setSevPick({ ...sev, [s]: on });
  // a summary card is the filter of its severity (mockup .sum .stat, pressed = shown); the checkbox covers the card, so a click anywhere toggles it
  const sevCard = (s: Sev, cls: string, color: string, name: string) => (
    <label key={s} className={`stat ${cls}`} data-on={sev[s]}>
      <input type="checkbox" checked={sev[s]} onChange={(e) => setSev(s, e.target.checked)} />
      <div className="v" style={{ color: `var(${color})` }}>{run!.summary[s]}</div>
      <div className="l">{name}</div>
      <div className="d faint">{split(all.filter((i) => i.sev === s)) || 'None in this run'}</div>
    </label>
  );
  const mark = reviewed.get(issueKey(selected ?? ({} as ValidationIssue)));
  const waived = model.data?.summary.waived ?? 0;
  const markIt = async () => { if (selected && await toggle(issueKey(selected), mark ? undefined : note.trim() || undefined)) setNote(''); };

  return (
    <div className="v2-page val-page">
      <TopbarActions>
        {run ? <button className="btn" onClick={exportCsv} title="The findings shown, as a CSV file"><Icon name="download" size={16} />Export report</button> : null}
        <button className="btn primary" onClick={start} disabled={busy || !may(can, 'validate.run')} data-testid="run-validation">{busy ? <Spinner /> : <Icon name="refresh" size={16} />}Run validation</button>
      </TopbarActions>
      {run ? (
        <StatusItems>
          <span className="item"><span className={`dot ${run.summary.error ? 'danger' : 'success'}`} />{run.summary.error} error{run.summary.error === 1 ? '' : 's'}</span>
          <span className="item">{run.summary.warn} warning{run.summary.warn === 1 ? '' : 's'}</span>
          <span className="grow" />
          <span className="item">Run {ago(run.ranAt)} · {run.checked} files</span>
        </StatusItems>
      ) : null}

      <div className="page-head">
        <div>
          <h1>Validation report</h1>
          <p>{run ? `Last run ${ago(run.ranAt)} · ${fmtDate(run.ranAt)} · ${run.checked} files read · ${run.schemaChecked} checked against the schema${run.brexChecked ? `, ${run.brexChecked} against BREX` : ''}`
            : 'Check the project against the S1000D schemas and your business rules, then review every finding.'}</p>
        </div>
        <div className="row wrap val-head-tools">
          <select className="select val-issue-sel" value={issue} onChange={(e) => void chooseIssue(e.target.value)} aria-label="S1000D issue" data-testid="validation-issue" title="Which S1000D issue the checks use: the schema and the default business rules (BREX). Saved with the project; the build and release checks use it too.">
            <option value="auto">S1000D issue: as declared</option>
            {(last.data?.schemaIssues ?? []).map((i) => <option key={i} value={i}>S1000D issue {i}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={brex} onChange={(e) => setBrex(e.target.checked)} />Include BREX</label>
          {run ? (blocking
            ? <span className="badge danger" title="Errors of the schema, business rule and publication checks stop a PDF or a release of the modules in the publication"><Icon name="ban" size={14} />Publish gate blocked</span>
            : <span className="badge success"><Icon name="ok" size={14} />No blocking errors</span>) : null}
        </div>
      </div>
      {!may(can, 'validate.run') ? <div className="val-notes"><Callout tone="warning">Viewers can review the last run but cannot start a new one.</Callout></div> : null}

      {!run ? <div className="card"><EmptyState icon="shield" title="Not validated yet">{may(can, 'validate.run') ? 'Press “Run validation” to check every data module and the publication.' : 'Nobody has run validation on this project yet.'}</EmptyState></div> : (
        <>
          {run.notes.length ? <div className="val-notes"><Callout>{run.notes.slice(0, 3).join(' · ')}</Callout></div> : null}

          <section className="sum" aria-label="Severity summary">
            {sevCard('error', 'e', '--danger', severityLabel('error', 2))}
            {sevCard('warn', 'w', '--warning', severityLabel('warn', 2))}
            {sevCard('info', 'i', '--info', severityLabel('info', 2))}
            <label className="stat s" data-on={hideReviewed}>
              <input type="checkbox" checked={hideReviewed} onChange={(e) => setHideReviewed(e.target.checked)} aria-label="Hide reviewed findings" />
              <div className="v" style={{ color: 'var(--success)' }}>{reviewedCount}</div>
              <div className="l">Reviewed</div>
              <div className="d faint">{hideReviewed ? 'Hidden from the list' : waived ? `${waived} waived for draft builds` : 'Marked for the whole team'}</div>
            </label>
          </section>

          <div className="val-layout">
            <section className="card" aria-labelledby="val-iss-h">
              <div className="card-head">
                <h3 id="val-iss-h"><Icon name="listChecks" size={16} />Issues <span className="faint val-count" aria-live="polite">{shown.length} of {all.length} shown</span></h3>
                <button className="btn sm" onClick={copyList} disabled={!shown.length} title="The findings shown, as text (one per line)"><Icon name="copy" size={14} />Copy list</button>
              </div>
              <div className="val-bar" role="group" aria-label="Filter findings">
                <input className="input search val-q" placeholder="Filter by message, rule or code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter issues" />
                <div className="seg" role="group" aria-label="Source">
                  <button type="button" aria-pressed={source === 'all'} onClick={() => setSource('all')}>All</button>
                  {sources.map((s) => <button key={s} type="button" aria-pressed={source === s} onClick={() => setSource(s)} title={label(s)}>{short(s)}</button>)}
                </div>
                <select className="select val-mod" value={mod} onChange={(e) => setMod(e.target.value)} aria-label="Module">
                  <option value="all">All modules</option>
                  {modules.map((m) => { const f = m.split('/').pop() ?? m; return <option key={m} value={m}>{moduleShort(f)} {dmcOf(f)}</option>; })}
                </select>
                <span className="grow" /><label className="check"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />Group by module</label>
              </div>
              <div className="table-wrap" data-testid="issue-list">
                {shown.length === 0 ? <EmptyState icon={all.length ? 'filter' : 'ok'} title={all.length ? 'Nothing matches these filters' : 'No problems found'}>{all.length ? 'Adjust the filters above.' : 'Every check passed.'}</EmptyState> : (
                  <table className="table issues" aria-label="Issues">
                    <thead><tr><th className="val-sevcol"><span className="sr">Severity</span></th><th>Message and location</th><th>Source</th><th>Rule</th><th>Module</th></tr></thead>
                    <tbody>
                      {rows.map((i, n) => {
                        const done = reviewed.has(issueKey(i));
                        const head = grouped && (n === 0 || rows[n - 1].rel !== i.rel);
                        return [
                          head ? <tr key={`g:${i.rel}`} className="val-group"><td colSpan={5}><Icon name="xml" size={14} /><span className="trunc mono" title={i.rel}>{i.file || i.rel}</span><span className="faint">{shown.filter((x) => x.rel === i.rel).length}</span></td></tr> : null,
                          <tr key={i.id} aria-selected={selected?.id === i.id} tabIndex={0} onClick={() => choose(i)} data-testid="issue" className={done ? 'done' : undefined}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(i); } }}>
                            <td className="val-sevcol"><span className={`sevic ${SEV_CLASS[i.sev]}`}><Icon name={SEV_ICON[i.sev]} size={14} /><span className="sr">{i.sev}</span></span></td>
                            <td className="val-msg">
                              <div className="trunc val-title" title={messageOf(i)}>{messageOf(i)}{done ? <span className="badge success val-done">Reviewed</span> : null}</div>
                              <div className="faint mono val-loc" title={i.title}>{whereOf(i)}</div>
                            </td>
                            <td><span className="badge" title={label(i.source)}>{short(i.source)}</span></td>
                            <td className="mono val-rule"><span className="trunc" title={ruleOf(i)}>{ruleOf(i)}</span></td>
                            <td className="mono faint" title={i.rel}>{moduleShort(i.file)}</td>
                          </tr>,
                        ];
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="val-bar val-pager">
                <span className="faint">{ordered.length ? `Rows ${at * PAGE + 1}-${at * PAGE + rows.length} of ${ordered.length}` : 'No rows'}</span>
                <span className="grow" />
                <button className="btn sm" disabled={at === 0} onClick={() => setPage(at - 1)}><Icon name="up" size={14} />Previous</button>
                <button className="btn sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next<Icon name="down" size={14} /></button>
              </div>
            </section>

            <aside className="stack val-side" aria-label="Selected issue">
              <section className="card detail" aria-labelledby="val-d-h">
                {selected ? (
                  <>
                    <div className="card-head"><h3 id="val-d-h"><span className={`sevic ${SEV_CLASS[selected.sev]}`} title={severityLabel(selected.sev)}><Icon name={SEV_ICON[selected.sev]} size={16} /></span>{selected.title}</h3><span className="badge" title={label(selected.source)}>{short(selected.source)}</span></div>
                    <div className="card-body" data-testid="issue-detail">
                      <dl className="kv">
                        <dt>Module</dt><dd className="mono" title={selected.rel}>{dmcOf(selected.file) || selected.rel || 'The project'}</dd>
                        <dt>Location</dt><dd className="mono">{whereOf(selected)}</dd>
                        <dt>Rule</dt><dd className="val-rule-text">{selected.detail || selected.title}</dd>
                        <dt>Found</dt><dd>{ago(run.ranAt)}, {fmtDate(run.ranAt)}</dd>
                        {mark ? <><dt>Reviewed</dt><dd data-testid="issue-reviewed-by">{mark.byName ?? mark.by} · {fmtDate(mark.at)}</dd></> : null}
                        {mark?.note ? <><dt>Note</dt><dd className="val-note">{mark.note}</dd></> : null}
                      </dl>
                      {editable ? <SourceExcerpt projectId={id} file={selected.file} line={selected.line} /> : null}
                      <div className="row wrap">
                        {editable ? <button className="btn primary sm" onClick={() => nav(`../editor?file=${encodeURIComponent(selected.file)}&line=${selected.line}`)}><Icon name="editor" size={14} />Go to line {selected.line}</button>
                          : selected.source === 'pm' ? <button className="btn primary sm" onClick={() => nav('../publication')}><Icon name="book" size={14} />Open Publication</button> : null}
                        {selected.loc ? <button className="btn sm" onClick={() => void copy(selected.loc, 'Location')}><Icon name="copy" size={14} />Copy location</button> : null}
                      </div>
                      <div className="field val-review">
                        <label htmlFor="val-note">{mark ? 'Reviewed for the whole team' : 'Review this issue'}</label>
                        {mark ? null : <textarea className="input" id="val-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={!canMark}
                          aria-invalid={!canMark || undefined} aria-describedby="val-note-e" placeholder="Note (optional): why it can stay" />}
                        {!canMark ? <span className="error" id="val-note-e"><Icon name="xcircle" size={14} />Reviewers, editors, managers and owners mark findings reviewed.</span>
                          : <span className="hint" id="val-note-e">{mark ? 'Unmark it to review it again.' : 'The mark is the team\'s: your name and the time are kept.'}</span>}
                      </div>
                      <button className="btn sm val-mark" onClick={() => void markIt()} data-testid="issue-mark-reviewed" disabled={!canMark}
                        title={canMark ? 'Marks the finding reviewed for everyone on the project (your name and the time are kept)' : 'Reviewers, editors, managers and owners mark findings reviewed'}>{mark ? 'Unmark reviewed' : 'Mark reviewed'}</button>
                    </div>
                  </>
                ) : <div className="card-body"><EmptyState icon="info" title="Select a finding">Its explanation, the source lines and a link to the exact line appear here.</EmptyState></div>}
              </section>
              {byRule.length ? (
                <section className="card" aria-labelledby="val-br-h">
                  <div className="card-head"><h3 id="val-br-h"><Icon name="hash" size={16} />Errors by rule</h3></div>
                  <ul className="byrule">
                    {byRule.map((r) => <li key={r.label}><span className="trunc" title={r.label}>{r.label}</span><div className="progress" aria-hidden="true"><i style={{ width: `${Math.round((r.n / byRule[0].n) * 100)}%` }} /></div><span className="num faint">{r.n}</span></li>)}
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
