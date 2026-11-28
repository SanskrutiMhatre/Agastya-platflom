// Phase 3 (P3-5): merge requests in GitLab for the project's review. Shown on the Repository page (with "open a review") and on the Review
// and release page (status, approvals, discussions). Sync brings GitLab's notes in as review comments and, when the project lets GitLab
// approvals count, approves the pending release under the approving Project Manager's name. Renders nothing while GitLab is off or the
// project is not linked.
import { useState } from 'react';
import { gitlabApi, type GitlabMr, type GitlabReviewer, type GitlabSync } from '../api/gitlab';
import { Icon } from './Icon';
import { Callout, Field, Modal, Pill, errText, fmtDate, useAsync, type Tone } from './ui';
import { useUi } from '../store/ui';

const RANK: Record<string, number> = { viewer: 0, reviewer: 1, editor: 2, manager: 3, owner: 4 };
export const atLeast = (role: string | undefined, min: keyof typeof RANK): boolean => (RANK[role ?? ''] ?? -1) >= RANK[min];
const STATE_TONE: Record<string, Tone | undefined> = { opened: 'info', merged: 'success', closed: undefined };

function OpenMr({ id, onClose, onOpened }: { id: string; onClose: () => void; onOpened: () => void }) {
  const toast = useUi((s) => s.toast);
  const people = useAsync(() => gitlabApi.reviewers(id), [id]);
  const [title, setTitle] = useState(''); const [desc, setDesc] = useState(''); const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await gitlabApi.openMr(id, { title: title.trim(), description: desc.trim() || undefined, reviewers: [...pick] });
      toast(`Merge request !${r.mr.iid} opened${r.unmappedReviewers.length ? ` (not in GitLab: ${r.unmappedReviewers.join(', ')})` : ''}`, 'success');
      onOpened(); onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const toggle = (r: GitlabReviewer) => { const n = new Set(pick); if (n.has(r.userId)) n.delete(r.userId); else n.add(r.userId); setPick(n); };
  return (
    <Modal title="Open a review in GitLab" onClose={onClose} width={560}
      buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !title.trim()} onClick={() => void go()} data-testid="gitlab-mr-create">{busy ? 'Opening…' : 'Open merge request'}</button></>}>
      <div className="stack adm-gap">
        <p className="faint">The project's changes go to a new review branch and a merge request into the project branch. Merging it in GitLab brings the project branch here.</p>
        <Field label="Title"><input className="input" value={title} maxLength={250} onChange={(e) => setTitle(e.target.value)} data-testid="gitlab-mr-title" /></Field>
        <Field label="Description"><textarea className="input" rows={3} maxLength={20000} value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="gitlab-mr-description" /></Field>
        <Field label="Reviewers" hint="Members who connected GitLab become reviewers of the merge request.">
          <div className="stack" data-testid="gitlab-mr-reviewers">
            {(people.data ?? []).map((r) => (
              <label key={r.userId} className="row"><input type="checkbox" checked={pick.has(r.userId)} disabled={!r.gitlab} onChange={() => toggle(r)} data-testid={`gitlab-mr-reviewer-${r.username}`} />
                <span>{r.fullName} <span className="faint">({r.role}{r.gitlab ? `, GitLab ${r.gitlab.username}` : ', not connected to GitLab'})</span></span></label>
            ))}
            {people.data && !people.data.length ? <span className="faint">No other members to ask.</span> : null}
          </div>
        </Field>
        {err ? <Callout tone="danger">{err}</Callout> : null}
      </div>
    </Modal>
  );
}

export function GitlabMergeRequests({ id, role, allowOpen, onSynced }: { id: string; role: string; allowOpen?: boolean; onSynced?: () => void }) {
  const toast = useUi((s) => s.toast);
  const mrs = useAsync(() => gitlabApi.mrs(id), [id]);
  const [opening, setOpening] = useState(false);
  const [busy, setBusy] = useState('');
  const [last, setLast] = useState<Record<number, GitlabSync>>({});
  if (mrs.data === null && !mrs.loading && !mrs.error) return null;     // GitLab is off
  if (mrs.error && /not linked/i.test(mrs.error)) return null;
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { const r = await fn(); if (r && typeof r === 'object' && 'mr' in r) setLast((x) => ({ ...x, [(r as GitlabSync).mr.iid]: r as GitlabSync })); toast(ok, 'success'); mrs.reload(); onSynced?.(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(''); }
  };
  const list: GitlabMr[] = mrs.data ?? [];
  if (!allowOpen && !list.length) return null;                         // the Review page shows the card only once a review exists in GitLab
  return (
    <section className="card" aria-labelledby="gl-mr-h" data-testid="gitlab-mrs">
      {opening ? <OpenMr id={id} onClose={() => setOpening(false)} onOpened={mrs.reload} /> : null}
      <div className="card-head"><h3 id="gl-mr-h"><Icon name="mr" />GitLab merge requests <span className="count">{list.length}</span></h3>
        {allowOpen && atLeast(role, 'editor') ? <button className="btn sm" onClick={() => setOpening(true)} data-testid="gitlab-mr-open"><Icon name="plus" />Open a review</button> : null}</div>
      {mrs.error ? <div className="card-body"><Callout tone="danger">{mrs.error}</Callout></div> : list.length === 0 ? <div className="card-body"><p className="faint">No review has been opened in GitLab for this project.</p></div> : (
        <div className="card-body stack adm-gap">
          {list.map((m) => {
            const s = last[m.iid];
            const a = s?.mr.approvals ?? m.approvals;
            return (
              <div key={m.iid} className="stack" data-testid={`gitlab-mr-${m.iid}`}>
                <div className="row wrap">
                  <strong>!{m.iid} {m.title}</strong>
                  <Pill tone={STATE_TONE[s?.mr.state ?? m.state]} >{s?.mr.state ?? m.state}</Pill>
                  {a ? <Pill tone={a.approved ? 'success' : 'warning'} >{a.approved ? 'Approved in GitLab' : `${a.left ?? '?'} approval${a.left === 1 ? '' : 's'} to go`}</Pill> : null}
                  {m.webUrl ? <a className="btn sm" href={m.webUrl} target="_blank" rel="noreferrer"><Icon name="external" />Open in GitLab</a> : null}
                </div>
                <p className="faint adm-xs">{m.sourceBranch} → {m.targetBranch} · opened {fmtDate(m.createdAt)}{m.by ? ` by ${m.by}` : ''}{m.syncedAt ? ` · last read ${fmtDate(m.syncedAt)}` : ''}</p>
                {a?.by.length ? <p className="adm-xs">Approved by {a.by.map((b) => b.agastyaUser ? `${b.name} (${b.agastyaUser})` : b.name).join(', ')}</p> : null}
                {a?.reviewers.some((r) => r.state === 'requested_changes') ? <Callout tone="warning">Changes requested in GitLab by {a.reviewers.filter((r) => r.state === 'requested_changes').map((r) => r.name).join(', ')}.</Callout> : null}
                {s ? <p className="adm-xs" data-testid="gitlab-mr-sync-result">{s.imported ? `${s.imported} note${s.imported === 1 ? '' : 's'} added to the review comments. ` : 'No new notes. '}{s.approvedRelease ? `The release was approved through GitLab by ${s.approvedRelease.by}. ` : ''}{s.approvalNote ?? ''}{s.pulled ? ` Project updated from GitLab (${s.pulled.applied} file${s.pulled.applied === 1 ? '' : 's'}).` : ''}{s.pullError ? ` The project could not be updated: ${s.pullError}` : ''}</p> : null}
                {s?.discussions.length ? (
                  <ul className="adm-xs">{s.discussions.flatMap((d) => d.notes.map((n, i) => <li key={`${d.id}-${i}`}><strong>{n.author}</strong>{n.file ? <span className="mono"> {n.file}</span> : null}: {n.body}</li>))}</ul>
                ) : null}
                {m.state === 'opened' ? (
                  <div className="row wrap">
                    {atLeast(role, 'reviewer') ? <button className="btn sm" disabled={!!busy} onClick={() => void act(`s${m.iid}`, () => gitlabApi.syncMr(id, m.iid), 'Read from GitLab')} data-testid="gitlab-mr-sync"><Icon name="refresh" />{busy === `s${m.iid}` ? 'Reading…' : 'Sync from GitLab'}</button> : null}
                    {atLeast(role, 'reviewer') ? <button className="btn sm" disabled={!!busy} onClick={() => void act(`a${m.iid}`, () => gitlabApi.approveMr(id, m.iid), 'Approved in GitLab')} data-testid="gitlab-mr-approve"><Icon name="ok" />Approve in GitLab</button> : null}
                    {atLeast(role, 'manager') ? <button className="btn sm" disabled={!!busy} onClick={() => void act(`m${m.iid}`, () => gitlabApi.mergeMr(id, m.iid), 'Merged in GitLab')} data-testid="gitlab-mr-merge"><Icon name="merge" />Merge</button> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
