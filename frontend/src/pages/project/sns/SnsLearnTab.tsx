// SNS > Learn from modules: the codes of the project's data modules say WHICH SNS nodes exist; their titles only hint at what to call them.
// So every proposal carries a confidence and the reason for it, and NOTHING is written until the person ticks proposals one by one and applies them.
//
//   Preview (writes nothing) -> set the confidence threshold -> tick the rows to accept -> Apply selected  (sends accept: [keys], never acceptAll)
//
// A proposal for a node that already exists is never applied: it is listed as "Already present" or "Differs (kept)" and has no checkbox.

import { useMemo, useState } from 'react';
import { snsApi, type LearnResult } from '../../../api/sns';
import { Icon } from '../../../components/Icon';
import { ShowMore } from '../../../components/lists';
import { Alert, Badge, Empty, Spinner, errText } from '../../../components/ui';
import { cap } from '../../../lib/importPackage';
import {
  DEFAULT_MIN_CONFIDENCE, STATUS_LABEL, acceptedKeys, confidenceTone, displayCode, hiddenByThreshold, isAcceptable, learnApplyBody, learnPreviewBody, mergeOutcome, parseThreshold, pct, plural,
  visibleProposals, type StatusFilter,
} from '../../../lib/sns';
import { useUi } from '../../../store/ui';

const PAGE = 50;

export function SnsLearnTab({ projectId, may, onApplied }: { projectId: string; may: boolean; onApplied: () => void }) {
  const toast = useUi((s) => s.toast);
  const [result, setResult] = useState<LearnResult | null>(null);
  const [threshold, setThreshold] = useState(String(Math.round(DEFAULT_MIN_CONFIDENCE * 100)));
  const [status, setStatus] = useState<StatusFilter>('new');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'' | 'preview' | 'apply'>('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [shown, setShown] = useState(PAGE);

  const min = parseThreshold(threshold);
  const proposals = result?.proposals ?? [];
  const visible = useMemo(() => visibleProposals(proposals, { minConfidence: min, status }), [proposals, min, status]);
  const hidden = hiddenByThreshold(proposals, { minConfidence: min, status });
  const keys = useMemo(() => acceptedKeys(visible, ticked), [visible, ticked]);
  const selectable = visible.filter(isAcceptable);
  const view = cap(visible, shown);

  if (!may) return <Alert tone="warn"><span data-testid="sns-learn-readonly">Only an editor, manager or owner of the project can learn rows from its data modules.</span></Alert>;

  const preview = async () => {
    setBusy('preview'); setError(''); setDone('');
    try { setResult(await snsApi.learn(projectId, learnPreviewBody())); setTicked(new Set()); setShown(PAGE); }
    catch (e) { setError(errText(e)); setResult(null); } finally { setBusy(''); }
  };
  const apply = async () => {
    if (!keys.length) return;
    setBusy('apply'); setError('');
    try {
      const r = await snsApi.learn(projectId, learnApplyBody(keys, min));
      const text = r.applied ? mergeOutcome(r.applied) : 'Nothing was added.';
      setDone(text); setResult(null); setTicked(new Set()); toast(text, 'success'); onApplied();
    } catch (e) { setError(errText(e)); } finally { setBusy(''); }
  };
  const tick = (key: string, on: boolean) => setTicked((t) => { const n = new Set(t); if (on) n.add(key); else n.delete(key); return n; });

  return (
    <div className="v2-stack" data-testid="sns-learn">
      <section className="v2-card v2-card-pad v2-stack">
        <h3 style={{ margin: 0 }}>Learn from the data modules</h3>
        <p className="v2-sub" style={{ margin: 0 }}>
          The codes of the data modules say which systems, sub-systems and assemblies exist. Their titles only suggest names for them, so each proposal comes with a confidence and the reason for it.
          Nothing is added until you tick the proposals you accept and apply them. A node the SNS already has is never changed.
        </p>
        <div className="v2-row wrap">
          <button type="button" className="btn btn-primary" onClick={() => void preview()} disabled={!!busy} data-testid="sns-learn-preview">{busy === 'preview' ? <Spinner /> : <Icon name="search" size={14} />}Preview proposals</button>
          <span className="v2-hint">Preview writes nothing.</span>
        </div>
        {error ? <Alert tone="bad"><span data-testid="sns-learn-error">{error}</span></Alert> : null}
        {done ? <Alert tone="ok"><span data-testid="sns-learn-done">{done}</span></Alert> : null}
      </section>

      {result ? (
        <section className="v2-card v2-card-pad v2-stack" data-testid="sns-learn-result">
          <div className="v2-tiles">
            <div className="v2-tile"><b>{result.summary.modules}</b><span>Data modules read</span></div>
            <div className="v2-tile"><b data-testid="sns-learn-n-new">{result.summary.new}</b><span>New nodes</span></div>
            <div className="v2-tile"><b>{result.summary.exists}</b><span>Already present</span></div>
            <div className="v2-tile"><b>{result.summary.conflict}</b><span>Differ (kept)</span></div>
            {result.summary.skipped ? <div className="v2-tile"><b>{result.summary.skipped}</b><span>Modules without a code</span></div> : null}
          </div>

          <div className="v2-row wrap" style={{ alignItems: 'flex-end' }}>
            <div className="v2-field" style={{ width: 210 }}>
              <label htmlFor="sns-learn-threshold">Minimum confidence (%)</label>
              <input id="sns-learn-threshold" className="v2-input" type="number" min={0} max={100} step={5} value={threshold} onChange={(e) => { setThreshold(e.target.value); setShown(PAGE); }} data-testid="sns-learn-threshold" aria-describedby="sns-learn-threshold-note" />
            </div>
            <div className="v2-field" style={{ width: 220 }}>
              <label htmlFor="sns-learn-status">Show</label>
              <select id="sns-learn-status" className="v2-select" value={status} onChange={(e) => { setStatus(e.target.value as StatusFilter); setShown(PAGE); }} data-testid="sns-learn-status">
                <option value="new">New nodes ({result.summary.new})</option>
                <option value="conflict">Differ, kept ({result.summary.conflict})</option>
                <option value="exists">Already present ({result.summary.exists})</option>
                <option value="all">All ({result.summary.nodes})</option>
              </select>
            </div>
            <button type="button" className="btn btn-sm" disabled={!selectable.length} onClick={() => setTicked(new Set([...ticked, ...selectable.map((p) => p.key)]))} data-testid="sns-learn-select-shown">Tick the {selectable.length} shown</button>
            <button type="button" className="btn btn-sm" disabled={!ticked.size} onClick={() => setTicked(new Set())} data-testid="sns-learn-clear">Clear ticks</button>
          </div>
          <span className="v2-hint" id="sns-learn-threshold-note" data-testid="sns-learn-hidden">
            {plural(visible.length, 'proposal')} shown{hidden ? `; ${plural(hidden, 'proposal')} below ${Math.round(min * 100)}% ${hidden === 1 ? 'is' : 'are'} hidden. Lower the minimum to see ${hidden === 1 ? 'it' : 'them'}` : ''}.
            A hidden proposal is never applied, even if it was ticked.
          </span>

          {visible.length === 0 ? <Empty title="No proposals to show">{hidden ? <span className="v2-hint">Lower the minimum confidence to see the {plural(hidden, 'proposal')} below it.</span> : null}</Empty> : (
            <div className="v2-card">
              <div className="v2-scroll-x">
                <table className="v2-table" data-testid="sns-learn-table">
                  <thead><tr><th style={{ width: 36 }} /><th>Code</th><th>Proposed title</th><th>Confidence</th><th>Why</th><th>Status</th></tr></thead>
                  <tbody>{view.items.map((p) => {
                    const code = displayCode(p.row);
                    const can = isAcceptable(p);
                    return (
                      <tr key={p.key} data-testid="sns-learn-row" data-key={p.key} data-code={code} data-status={p.status} data-confidence={p.confidence}>
                        <td>{can
                          ? <input type="checkbox" checked={ticked.has(p.key)} onChange={(e) => tick(p.key, e.target.checked)} aria-label={`Accept ${code} ${p.row.title}`} disabled={!!busy} data-testid="sns-learn-tick" />
                          : <input type="checkbox" disabled aria-label={`${code} cannot be accepted`} title={p.status === 'new' ? 'The modules at this node give no title to propose' : 'Already in the SNS: it is never changed from here'} />}</td>
                        <td><span className="v2-mono">{code}</span><div className="v2-hint">{p.level === 'subsubsystem' ? 'sub-sub-system' : p.level === 'subsystem' ? 'sub-system' : p.level}</div></td>
                        <td style={{ overflowWrap: 'anywhere' }}>{p.row.title || <span className="v2-hint">(no title)</span>}</td>
                        <td><Badge tone={confidenceTone(p.confidence)}><span data-testid="sns-learn-confidence">{pct(p.confidence)}%</span></Badge></td>
                        <td style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>
                          <span data-testid="sns-learn-basis">{p.basis}</span>
                          {p.candidates.length > 1 ? <div className="v2-hint">Titles seen: {p.candidates.slice(0, 3).map((c) => `“${c.title}” ×${c.count}`).join(', ')}{p.candidates.length > 3 ? ` and ${p.candidates.length - 3} more` : ''}</div> : null}
                          <div className="v2-hint" title={p.sources.join('\n')}>{plural(p.moduleCount, 'data module')}{p.sources.length ? `, for example ${p.sources[0]}` : ''}</div>
                        </td>
                        <td>
                          <Badge tone={p.status === 'new' ? 'accent' : p.status === 'conflict' ? 'warn' : undefined}>{STATUS_LABEL[p.status]}</Badge>
                          {p.status === 'conflict' && p.existing ? <div className="v2-hint">Kept: “{p.existing.title}”</div> : null}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </div>
          )}
          <ShowMore shown={shown} total={visible.length} page={PAGE} noun="proposals" testid="sns-learn-more" onShown={setShown} />

          <div className="v2-row wrap">
            <button type="button" className="btn btn-primary" disabled={!!busy || keys.length === 0} onClick={() => void apply()} data-testid="sns-learn-apply">{busy === 'apply' ? <Spinner /> : null}Apply {keys.length} selected</button>
            <span className="v2-hint" data-testid="sns-learn-selected">{keys.length === 0 ? 'Tick the proposals you accept.' : `${plural(keys.length, 'proposal')} ticked: only ${keys.length === 1 ? 'it is' : 'these are'} added.`}</span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
