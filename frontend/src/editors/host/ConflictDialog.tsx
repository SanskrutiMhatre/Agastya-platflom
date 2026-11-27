// WP-21 (PRD-004): the conflict comparison of the editor host, the same dialog in the three editors.
//
// A save was refused because someone else saved the document after the author opened it. The dialog sets the author's version and theirs side by
// side against the version both started from (merge.ts): every change only one of them made can be kept or left out, and where both changed the
// same lines the author chooses whose lines stay. The result is checked by the editor's own validation before it can be saved: a merged document
// with errors is not saved (the author can still download their version or go back to the banner's other choices). Saving uses the version of the
// other save as its base, so it is an ordinary save that a third person's later save would refuse in turn.

import { useMemo, useState } from 'react';
import '../../styles/pages/editor-host.css';   // WP-35: loads with the editor chunks
import { Icon } from '../../components/Icon';
import { Alert, Modal, Spinner, errText } from '../../components/ui';
import { buildMerged, defaultChoices, merge3, type MergeChoice, type MergeChunk } from './merge';

export interface ConflictCheck { errors: number; messages: string[] }

export interface ConflictDialogProps {
  /** the document as the author opened it (or last saved it) */
  base: string;
  mine: string;
  theirs: string;
  /** check a merged text the way the editor checks a save (schema, stencil or BREX); `errors` > 0 refuses the save */
  check: (xml: string) => Promise<ConflictCheck>;
  /** save the merged text over theirs; resolves true when saved */
  save: (xml: string) => Promise<boolean>;
  onClose: () => void;
}

const SIDE: Record<'mine' | 'theirs' | 'both', string> = { mine: 'Your change', theirs: 'Their change', both: 'The same change on both sides' };

function Lines({ lines, tone }: { lines: string[]; tone: 'del' | 'add' | 'plain' }) {
  return <pre className={`v2-merge-lines ${tone}`}>{lines.length ? lines.join('\n') : <span className="v2-hint">(nothing)</span>}</pre>;
}

export function ConflictDialog({ base, mine, theirs, check, save, onClose }: ConflictDialogProps) {
  const chunks = useMemo<MergeChunk[]>(() => merge3(base, mine, theirs), [base, mine, theirs]);
  const [choices, setChoices] = useState<MergeChoice[]>(() => defaultChoices(chunks));
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<ConflictCheck | null>(null);
  const [error, setError] = useState('');
  const shown = chunks.map((c, i) => ({ c, i })).filter(({ c }) => c.kind !== 'same');
  const conflicts = shown.filter(({ c }) => c.kind === 'conflict');
  const undecided = conflicts.filter(({ i }) => choices[i] !== 'mine' && choices[i] !== 'theirs').length;
  const merged = useMemo(() => buildMerged(chunks, choices), [chunks, choices]);
  const set = (i: number, v: MergeChoice) => { setProblems(null); setChoices((cs) => cs.map((x, k) => (k === i ? v : x))); };

  const checkAndSave = async () => {
    if (merged === null) return;
    setBusy(true); setError(''); setProblems(null);
    try {
      const r = await check(merged);
      if (r.errors > 0) { setProblems(r); return; }
      if (await save(merged)) onClose();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const mineCount = shown.filter(({ c }) => c.kind === 'change' && c.side === 'mine').length;
  const theirCount = shown.filter(({ c }) => c.kind === 'change' && c.side === 'theirs').length;
  return (
    <Modal title="Compare and merge" onClose={onClose} width={980} sticky buttons={<>
      <button className="btn" onClick={onClose} disabled={busy} data-testid="merge-cancel">Cancel</button>
      <button className="btn btn-primary" onClick={() => void checkAndSave()} disabled={busy || merged === null} aria-busy={busy || undefined} data-testid="merge-save"
        title={merged === null ? 'Choose a version for every place you both changed' : 'Check the merged document, then save it'}>{busy ? <Spinner /> : <Icon name="check" size={12} />}Check and save</button>
    </>}>
      <div className="v2-merge" data-testid="merge-dialog">
        <p style={{ marginTop: 0 }}>
          Someone else saved this document after you opened it. {mineCount} change{mineCount === 1 ? '' : 's'} of yours and {theirCount} of theirs do not touch each other and are all kept unless you untick them.
          {conflicts.length ? <> In <strong>{conflicts.length} place{conflicts.length === 1 ? '' : 's'}</strong> you both changed the same text: choose which version stays.</> : null}
          {' '}The result is checked before it is saved.
        </p>
        {undecided ? <Alert tone="warn"><span data-testid="merge-undecided">{undecided} place{undecided === 1 ? '' : 's'} still to decide.</span></Alert> : null}
        {problems ? <Alert tone="bad"><div data-testid="merge-invalid"><strong>The merged document has {problems.errors} error{problems.errors === 1 ? '' : 's'}, so it was not saved.</strong> Change your choices, or cancel and download your version from the banner.
          {problems.messages.length ? <ul style={{ margin: '6px 0 0' }}>{problems.messages.slice(0, 8).map((m, k) => <li key={k}>{m}</li>)}</ul> : null}</div></Alert> : null}
        {error ? <Alert tone="bad">{error}</Alert> : null}
        {!shown.length ? <p className="v2-hint">Both versions are the same: saving keeps it as it is.</p> : null}
        <ol className="v2-merge-list">
          {shown.map(({ c, i }, n) => c.kind === 'change' ? (
            <li key={i} className={`v2-merge-item ${c.side}`} data-testid="merge-change" data-side={c.side}>
              <label className="v2-row" style={{ gap: 6 }}>
                <input type="checkbox" checked={choices[i] !== false} onChange={(e) => set(i, e.target.checked)} aria-label={`Keep change ${n + 1}: ${SIDE[c.side].toLowerCase()}`} />
                <strong>{SIDE[c.side]}</strong><span className="v2-hint">keep it</span>
              </label>
              <div className="v2-merge-cols"><div><div className="v2-hint">Before</div><Lines lines={c.base} tone="del" /></div><div><div className="v2-hint">After</div><Lines lines={c.lines} tone="add" /></div></div>
            </li>
          ) : c.kind === 'conflict' ? (
            <li key={i} className="v2-merge-item conflict" data-testid="merge-conflict" role="radiogroup" aria-label={`Place ${n + 1} you both changed`}>
              <div className="v2-row" style={{ gap: 6 }}><Icon name="warn" size={14} /><strong>You both changed this</strong>{c.base.length ? <span className="v2-hint">(it was: {c.base.join(' ').slice(0, 120)})</span> : null}</div>
              <div className="v2-merge-cols">
                <label className={`v2-merge-pick${choices[i] === 'mine' ? ' on' : ''}`}><span className="v2-row" style={{ gap: 6 }}><input type="radio" name={`merge-${i}`} checked={choices[i] === 'mine'} onChange={() => set(i, 'mine')} data-testid="merge-pick-mine" />Keep yours</span><Lines lines={c.mine} tone="plain" /></label>
                <label className={`v2-merge-pick${choices[i] === 'theirs' ? ' on' : ''}`}><span className="v2-row" style={{ gap: 6 }}><input type="radio" name={`merge-${i}`} checked={choices[i] === 'theirs'} onChange={() => set(i, 'theirs')} data-testid="merge-pick-theirs" />Keep theirs</span><Lines lines={c.theirs} tone="plain" /></label>
              </div>
            </li>
          ) : null)}
        </ol>
      </div>
    </Modal>
  );
}
