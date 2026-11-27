// Validation: run every check on the project, then review what it found.
//
// The review half is the point. Each finding says what is wrong, where (file and
// line) and which check found it; the author can filter, mark findings as
// reviewed (for the whole team, on the server, with who and when: WP-22), jump to the offending line in
// the editor, or export the list.

import { useEffect, useMemo, useState } from 'react';
import '../../styles/pages/structure.css';   // WP-35: this page's styles load with its chunk
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

const SOURCE_LABEL: Record<ValidationIssue['source'], string> = {
  xml: 'Well-formedness', xsd: 'S1000D schema', brex: 'Business rules (BREX)', graphics: 'Graphics', ids: 'Identifiers', icn: 'ICN entities', pm: 'Publication',
};
const sevTone = (s: ValidationIssue['sev']) => (s === 'error' ? 'bad' : s === 'warn' ? 'warn' : undefined);

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
  return ['severity,check,file,line,title,detail', ...issues.map((i) => csvRow([i.sev, SOURCE_LABEL[i.source], i.rel, i.line, i.title, i.detail]))].join('\r\n');
}

export function ValidationPage() {
  const { id, role, can, reload } = useProject();
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

  const shown = useMemo(() => (run?.issues ?? []).filter((i) =>
    sev[i.sev] && (source === 'all' || i.source === source) && (!hideReviewed || !reviewed.has(issueKey(i)))
    && (!q || `${i.title} ${i.detail} ${i.rel} ${i.loc}`.toLowerCase().includes(q.toLowerCase()))), [run, sev, source, q, hideReviewed, reviewed]);
  const byFile = useMemo(() => {
    const m = new Map<string, ValidationIssue[]>();
    for (const i of shown) { const k = i.rel || '(project)'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(i); }
    return [...m.entries()].sort((a, b) => b[1].filter((x) => x.sev === 'error').length - a[1].filter((x) => x.sev === 'error').length || a[0].localeCompare(b[0]));
  }, [shown]);
  // WP-18 (FE-030): thousands of findings draw their first rows, more as the end comes into view (groups keep their order and headings)
  const drawn = useProgressive(shown.length, `${run?.ranAt ?? ''}|${q}|${source}|${hideReviewed}|${sev.error}${sev.warn}${sev.info}`);
  const groups = useMemo(() => {
    let left = drawn.limit; const out: Array<[string, ValidationIssue[], number]> = [];
    for (const [file, list] of byFile) { if (left <= 0) break; out.push([file, list.slice(0, left), list.length]); left -= list.length; }
    return out;
  }, [byFile, drawn.limit]);
  const selected = run?.issues.find((i) => i.id === selId) ?? null;
  const sources = [...new Set((run?.issues ?? []).map((i) => i.source))];

  if (last.loading && !last.data) return <Loading />;
  const editable = selected && /^csdb\/.*\.xml$/i.test(selected.rel);

  return (
    <div className="v2-page">
      <PageHeader icon="shield" title="Validation"
        sub={run ? `Last run ${ago(run.ranAt)} · ${run.checked} files read, ${run.schemaChecked} checked against a schema${run.brexChecked ? `, ${run.brexChecked} against BREX` : ''}.` : 'Check the project against the S1000D schemas and your business rules, then review every finding.'}
        stats={run ? [{ label: 'Errors', value: run.summary.error, tone: run.summary.error ? 'bad' : 'ok' }, { label: 'Warnings', value: run.summary.warn, tone: run.summary.warn ? 'warn' : undefined }, { label: 'Notes', value: run.summary.info }] : undefined}
        actions={<div className="v2-row wrap">
          <select className="v2-select" style={{ width: 210 }} value={issue} onChange={(e) => void chooseIssue(e.target.value)} aria-label="S1000D issue" data-testid="validation-issue" title="Which S1000D issue the checks use: the schema and the default business rules (BREX). Saved with the project; the build and release checks use it too.">
            <option value="auto">S1000D issue: as declared</option>
            {(last.data?.schemaIssues ?? []).map((i) => <option key={i} value={i}>S1000D issue {i}</option>)}
          </select>
          <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={brex} onChange={(e) => setBrex(e.target.checked)} />Include BREX</label>
          <button className="btn btn-primary" onClick={start} disabled={busy || !may(can, 'validate.run')} data-testid="run-validation">{busy ? <Spinner /> : <Icon name="play" />}Run validation</button>
        </div>} />
      {!may(can, 'validate.run') ? <div style={{ marginBottom: 12 }}><Alert tone="warn">Viewers can review the last run but cannot start a new one.</Alert></div> : null}

      {!run ? <div className="v2-card"><Empty title="Not validated yet">{may(can, 'validate.run') ? 'Press “Run validation” to check every data module and the publication.' : 'Nobody has run validation on this project yet.'}</Empty></div> : (
        <>
          {run.notes.length ? <div style={{ marginBottom: 12 }}><Alert>{run.notes.slice(0, 3).join(' · ')}</Alert></div> : null}

          <div className="v2-row wrap" style={{ marginBottom: 10 }}>
            {(['error', 'warn', 'info'] as const).map((s) => <label key={s} className="v2-row" style={{ gap: 5 }}><input type="checkbox" checked={sev[s]} onChange={(e) => setSev({ ...sev, [s]: e.target.checked })} /><span className={`v2-sev ${s}`} style={{ marginTop: 0 }} />{s === 'warn' ? 'Warnings' : s === 'error' ? 'Errors' : 'Notes'}</label>)}
            <select className="v2-select" style={{ width: 200 }} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by check"><option value="all">All checks</option>{sources.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select>
            <input className="v2-input" style={{ width: 220 }} placeholder="Search findings…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search findings" />
            <label className="v2-row" style={{ gap: 5 }}><input type="checkbox" checked={hideReviewed} onChange={(e) => setHideReviewed(e.target.checked)} />Hide reviewed</label>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => { const url = URL.createObjectURL(new Blob([toCsv(shown)], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = 'validation.csv'; a.click(); URL.revokeObjectURL(url); }}><Icon name="download" size={13} />Export CSV</button>
          </div>

          <div className="v2-grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(300px, 2fr)', alignItems: 'start' }}>
            <div className="v2-card" data-testid="issue-list">
              {shown.length === 0 ? <Empty title={run.issues.length ? 'Nothing matches these filters' : 'No problems found'}>{run.issues.length ? 'Adjust the filters above.' : 'Every check passed.'}</Empty> : groups.map(([file, list, count]) => (
                <div key={file}>
                  <div style={{ padding: '8px 12px', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border)', fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Icon name="xml" size={14} /><span className="v2-trunc v2-mono">{file}</span><span className="spacer" /><Badge tone={list.some((x) => x.sev === 'error') ? 'bad' : 'warn'}>{count}</Badge>
                  </div>
                  {list.map((i) => (
                    <div key={i.id} className={`v2-issue ${selId === i.id ? 'sel' : ''}`} onClick={() => setSelId(i.id)} role="button" tabIndex={0} aria-pressed={selId === i.id} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelId(i.id); } }} data-testid="issue">
                      <span className={`v2-sev ${i.sev}`} aria-label={i.sev} />
                      <div style={{ minWidth: 0, flex: 1, opacity: reviewed.has(issueKey(i)) ? .5 : 1 }}>
                        <div style={{ fontWeight: 600 }}>{i.title}{i.line > 1 ? <span className="v2-hint"> · line {i.line}</span> : null}</div>
                        <div className="v2-hint" style={{ whiteSpace: 'normal' }}>{i.detail.length > 140 ? `${i.detail.slice(0, 140)}…` : i.detail}</div>
                      </div>
                      <Badge>{SOURCE_LABEL[i.source]}</Badge>
                    </div>
                  ))}
                </div>
              ))}
              {shown.length ? <MoreRows shown={drawn.limit} total={shown.length} onMore={drawn.more} onAll={drawn.all} /> : null}
            </div>

            <aside className="v2-card v2-card-pad" aria-label="Finding" style={{ position: 'sticky', top: 0 }}>
              {selected ? (
                <div className="v2-stack" data-testid="issue-detail">
                  <div className="v2-row"><Badge tone={sevTone(selected.sev)}>{severityLabel(selected.sev)}</Badge><Badge>{SOURCE_LABEL[selected.source]}</Badge></div>
                  <h3 style={{ margin: 0 }}>{selected.title}</h3>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{selected.detail}</p>
                  <table className="v2-table" style={{ fontSize: 12.5 }}><tbody>
                    <tr><td className="v2-hint">File</td><td className="v2-mono" style={{ wordBreak: 'break-all' }}>{selected.rel}</td></tr>
                    <tr><td className="v2-hint">Line</td><td>{selected.line}</td></tr>
                    {selected.loc ? <tr><td className="v2-hint">Where</td><td className="v2-mono">{selected.loc}</td></tr> : null}
                    <tr><td className="v2-hint">Run</td><td>{fmtDate(run.ranAt)}</td></tr>
                    {reviewed.get(issueKey(selected)) ? <tr><td className="v2-hint">Reviewed</td><td data-testid="issue-reviewed-by">{reviewed.get(issueKey(selected))!.byName ?? reviewed.get(issueKey(selected))!.by} · {fmtDate(reviewed.get(issueKey(selected))!.at)}</td></tr> : null}
                  </tbody></table>
                  <div className="v2-row wrap">
                    {editable ? <button className="btn btn-primary" onClick={() => nav(`../editor?file=${encodeURIComponent(selected.file)}&line=${selected.line}`)}><Icon name="editor" />Open at line {selected.line}</button>
                      : selected.source === 'pm' ? <button className="btn btn-primary" onClick={() => nav('../publication')}><Icon name="book" />Open Publication</button> : null}
                    <button className="btn" onClick={() => void toggle(issueKey(selected))} data-testid="issue-mark-reviewed" disabled={!may(can, 'problems.review')}
                      title={may(can, 'problems.review') ? 'Marks the finding reviewed for everyone on the project (your name and the time are kept)' : 'Reviewers, editors, managers and owners mark findings reviewed'}><Icon name="check" />{reviewed.has(issueKey(selected)) ? 'Unmark reviewed' : 'Mark reviewed'}</button>
                  </div>
                </div>
              ) : <Empty title="Select a finding">Its explanation and a link to the exact line appear here.</Empty>}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
