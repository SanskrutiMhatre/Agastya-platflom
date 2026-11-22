// The publish gate's refusal, shown where a build or a release request was refused (Generate, the server Quick preview, the Publication page,
// the Release page). It lists what was found. For ONE kind of finding, a BREX the project does not have, an editor or above is offered a waiver:
// a recorded decision (name, date, reason) to build DRAFTS without it. A waiver is never offered for schema errors, breaches of a business rule
// or a BREX that is invalid, and it never covers a release: on the Release page the refusal is shown as it is, with that said.

import { useState } from 'react';
import type { ProjectRole } from '../api';
import { waiverApi } from '../api/waivers';
import { canRecordWaiver } from '../lib/roles';
import { REASON_MAX, reasonProblem, summariseFindings, waiverOffer, type GateFinding, type Refusal } from '../lib/waivers';
import { Alert, Badge, Field, Modal, Spinner, errText } from './ui';
import { CappedList } from './lists';
import { useUi } from '../store/ui';

const KIND_LABEL: Record<string, string> = { malformed: 'not well-formed', schema: 'schema', unchecked: 'not checked', brex: 'business rule', 'brex-source': 'BREX' };

function WaiverDialog({ projectId, subjects, others, onClose, onRecorded }: { projectId: string; subjects: string[]; others: number; onClose: () => void; onRecorded: () => void }) {
  const toast = useUi((s) => s.toast);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);

  const record = async () => {
    const bad = reasonProblem(reason);
    if (bad) { setProblem(bad); return; }                           // the server checks again; this saves the round trip
    setBusy(true); setProblem('');
    try {
      for (const subject of subjects) await waiverApi.add(projectId, { kind: 'brex-missing', subject, reason: reason.trim() });
      toast(`Waiver recorded for ${subjects.length === 1 ? subjects[0] : `${subjects.length} BREX modules`}. Building a draft…`, 'success');
      onClose(); onRecorded();
    } catch (e) { setProblem(errText(e)); setBusy(false); }
  };

  return (
    <Modal title="Build drafts without this BREX" width={560} sticky onClose={busy ? () => undefined : onClose} buttons={<>
      <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={() => void record()} data-testid="waiver-record">{busy ? <Spinner /> : null}Record the waiver and build</button>
    </>}>
      <div className="v2-stack">
        <p style={{ margin: 0 }}>This project does not contain the BREX {subjects.length === 1 ? 'module' : 'modules'} <strong className="v2-mono" data-testid="waiver-subjects">{subjects.join(', ')}</strong> that {subjects.length === 1 ? 'a data module names' : 'data modules name'}, so its business rules cannot be checked and the build is refused.</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>A waiver covers draft builds only</strong> (Generate and the server Quick preview). A release request or approval is still refused until the BREX is in the project.</li>
          <li>The business rules of {subjects.length === 1 ? 'that BREX are' : 'those BREX modules are'} <strong>not enforced</strong> in the drafts built under the waiver.</li>
          <li>It is recorded with your name and the date, and appears in the build log of every build that relies on it. It can be removed on the Publication page.</li>
        </ul>
        {others > 0 ? <Alert tone="warn">{others} other problem{others === 1 ? ' is' : 's are'} in this refusal. A waiver does not cover {others === 1 ? 'it' : 'them'}: the build is refused again until {others === 1 ? 'it is' : 'they are'} fixed.</Alert> : null}
        <Field label="Why are drafts built without it? (at least 10 characters)" error={problem}>
          <textarea className="v2-textarea" rows={3} maxLength={REASON_MAX} value={reason} autoFocus onChange={(e) => { setReason(e.target.value); if (problem) setProblem(''); }} placeholder="For example: the organisation's BREX is not shipped with the imported package; drafts only until it is supplied." data-testid="waiver-reason" />
        </Field>
        <span className="v2-hint">{reason.trim().length} / {REASON_MAX}</span>
      </div>
    </Modal>
  );
}

/**
 * `mode`: 'draft' for a build (offers the waiver where one applies), 'release' for a release request or approval (never offers it, and says
 * why). `onRecorded` runs after a waiver is recorded: the caller repeats the build.
 */
export function PublishRefusal({ refusal, projectId, role, mode, onRecorded, onDismiss }: {
  refusal: Refusal; projectId: string; role: ProjectRole; mode: 'draft' | 'release'; onRecorded?: () => void; onDismiss?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const offer = waiverOffer(refusal);
  const may = canRecordWaiver(role);
  const summary = summariseFindings(refusal.findings);

  return (
    <div className="v2-stack" style={{ gap: 8 }} data-testid="publish-refusal">
      <Alert tone="bad">
        <div className="v2-row v2-spread" style={{ alignItems: 'flex-start' }}>
          <strong data-testid="refusal-message">{refusal.message}</strong>
          {onDismiss ? <button className="btn btn-sm" onClick={onDismiss} aria-label="Dismiss this message">Dismiss</button> : null}
        </div>
        {summary ? <div style={{ marginTop: 4 }}>{summary}{refusal.total > refusal.findings.length ? `; ${refusal.total - refusal.findings.length} more not listed` : ''}.</div> : null}
        {refusal.findings.length ? (
          <div style={{ marginTop: 6, color: 'var(--text)' }}>
            <CappedList items={refusal.findings} initial={5} page={50} noun="findings" testid="refusal-findings" render={(f: GateFinding) => <>
              <Badge tone="bad">{KIND_LABEL[f.kind] ?? f.kind}</Badge>
              <strong>{f.title}</strong>
              <span className="v2-mono" title={f.file}>{f.file}</span>
              <span className="v2-hint" style={{ flexBasis: '100%' }}>{f.detail}</span>
            </>} />
          </div>
        ) : null}
      </Alert>

      {offer.subjects.length > 0 && mode === 'release' ? (
        <Alert tone="warn"><span data-testid="refusal-release-note"><strong>A waiver does not cover a release.</strong> A waiver lets draft builds go ahead without a BREX the project does not have; a release request or approval is refused until {offer.subjects.length === 1 ? 'that BREX is' : 'those BREX modules are'} in the project ({offer.subjects.join(', ')}).</span></Alert>
      ) : null}

      {offer.subjects.length > 0 && mode === 'draft' ? (
        may ? (
          <div className="v2-row wrap">
            <button className="btn btn-primary" onClick={() => setAsking(true)} data-testid="waiver-offer"><span>Build drafts without {offer.subjects.length === 1 ? 'this BREX' : 'these BREX modules'}…</span></button>
            <span className="v2-hint">Drafts only. Never a release. Recorded with your name, the date and your reason.</span>
          </div>
        ) : <span className="v2-hint" data-testid="refusal-ask-editor">An editor, manager or owner of this project decides whether drafts may be built while {offer.subjects.length === 1 ? 'this BREX is' : 'these BREX modules are'} missing.</span>
      ) : null}
      {asking ? <WaiverDialog projectId={projectId} subjects={offer.subjects} others={offer.blockers.length + (offer.truncated ? 1 : 0)} onClose={() => setAsking(false)} onRecorded={() => onRecorded?.()} /> : null}
    </div>
  );
}
