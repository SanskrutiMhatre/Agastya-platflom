// Review and release: the manual goes from the author to the Project Manager and back until it is approved.
//
//   Author submits  ->  Project Manager reads, comments, then approves or sends it back with reasons
//   Author fixes the comments and resubmits  ->  ...  ->  approved: the PDF has no watermark
//
// Until approval every PDF carries NOT RELEASED (the build stamps it by itself; the watermark settings
// below cannot turn that off). A release covers one state of the content: any later change takes the
// approval away and the next PDF is stamped again. These live on the project dashboard, never in the editor.

import { useEffect, useState } from 'react';
import { contentApi, type ReviewComment, type ReviewState } from '../../api';
import { jsgApi } from '../../api/jsg';
import { Callout, ConfirmModal, EmptyState, Field, Loading, Pill, errText, fmtDate, ago, useAsync, type Tone } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { ReviewReader } from '../../components/ReviewReader';
import { PublishRefusal } from '../../components/PublishRefusal';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { refusalOf, type Refusal } from '../../lib/waivers';
import { useUi } from '../../store/ui';
import { GitlabMergeRequests } from '../../components/GitlabMrs';

const STATE: Record<ReviewState, { label: string; tone?: 'ok' | 'warn' | 'bad' | 'accent' }> = {
  draft: { label: 'Not submitted' },
  in_review: { label: 'In review', tone: 'warn' },
  changes_requested: { label: 'Changes requested', tone: 'bad' },
  approved: { label: 'Approved', tone: 'ok' },
};
/** The page-head figures use the short tones; the mockup badge uses its own names. */
const TONE: Record<string, Tone | undefined> = { ok: 'success', warn: 'warning', bad: 'danger', accent: 'accent' };

export function ReleasePage() {
  const { id, role, can, reload, summary } = useProject();
  const jsg = summary.project.format === 'jsg';                   // WP-15 (PUB-011): a JSG document is released here too; its PDF comes from the JSG engine
  const toast = useUi((s) => s.toast);
  const rel = useAsync(() => contentApi.release(id), [id]);
  const dms = useAsync(() => contentApi.dms(id), [id]);
  const [note, setNote] = useState('');
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [text, setText] = useState('');
  const [dmFile, setDmFile] = useState('');
  const [reading, setReading] = useState('');
  const [busy, setBusy] = useState(false);
  const [wm, setWm] = useState({ enabled: false, text: '', style: 'diagonal' });
  const [wmDirty, setWmDirty] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);   // the publish gate refused the request or the approval; shown as it is, a waiver does not help here

  useEffect(() => { if (rel.data) { setWm(rel.data.watermark); setWmDirty(false); } }, [rel.data]);

  const act = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true); setRefusal(null);
    try { await fn(); toast(ok, 'success'); after?.(); rel.reload(); reload(); } catch (e) { setRefusal(refusalOf(e)); toast(errText(e), 'error'); } finally { setBusy(false); }
  };

  if (rel.loading && !rel.data) return <Loading />;
  if (rel.error || !rel.data) return <div className="v2-page pp"><Callout tone="danger" title="The release record could not be read">{rel.error}</Callout></div>;
  const r = rel.data;
  const rv = r.review;
  const writable = canWrite(can);
  const st = STATE[rv.state];
  const open = rv.comments.filter((c) => !c.resolved);
  const submitLabel = rv.state === 'changes_requested' ? 'Resubmit for review' : 'Submit for review';

  const submit = () => act(
    () => contentApi.requestRelease(id, later && when ? new Date(when).toISOString() : undefined, note),
    rv.state === 'changes_requested' ? 'Resubmitted for review' : 'Submitted for review', () => setNote(''),
  );
  const addComment = () => act(() => contentApi.addComment(id, text, dmFile || undefined), 'Comment added', () => { setText(''); setDmFile(''); });

  const commentRow = (c: ReviewComment) => (
    <div key={c.id} className={`pp-cmt ${c.kind === 'changes' ? 'changes' : ''} ${c.resolved ? 'done' : ''}`} data-testid="review-comment" data-kind={c.kind}>
      <div className="pp-cmt-head">
        <strong>{c.byName ?? c.by ?? 'Someone'}</strong>
        {c.kind === 'changes' ? <Pill tone="danger">Sent back</Pill> : null}
        {c.dmFile ? <Pill title="The data module this refers to">{c.dmFile}</Pill> : null}
        {c.anchor ? <button type="button" className="btn sm" title="Show this place in the data module" onClick={() => setReading(c.dmFile!)}>On “{c.anchor.text.slice(0, 40)}{c.anchor.text.length > 40 ? '…' : ''}”</button> : null}
        <span className="faint" title={fmtDate(c.at)}>{ago(c.at)}</span>
        <span className="grow" />
        {rv.canComment ? (
          <label className="check">
            <input type="checkbox" checked={c.resolved} disabled={busy} onChange={(e) => void act(() => contentApi.resolveComment(id, c.id, e.target.checked), e.target.checked ? 'Marked as done' : 'Reopened')} aria-label={`Mark comment by ${c.byName ?? c.by} as done`} />Done
          </label>
        ) : c.resolved ? <Pill tone="success">Done</Pill> : null}
      </div>
      <p className="pp-cmt-body">{c.body}</p>
    </div>
  );

  const stTone = TONE[st.tone ?? ''];
  return (
    <div className="v2-page pp">
      <PageHeader icon="rocket" title="Review and release" sub="Submit the manual to the Project Manager, answer their comments, and release it once approved."
        actions={<a className="btn primary" href={jsg ? jsgApi.downloadUrl(id) : contentApi.downloadUrl(id)} download data-testid="download-pdf" title={`${rv.state === 'approved' ? 'No watermark.' : 'Carries the NOT RELEASED watermark until approval.'} Built fresh from the current content.`}><Icon name="download" />{rv.state === 'approved' ? 'Download released PDF' : 'Download PDF (NOT RELEASED)'}</a>}
        stats={[
          { label: 'Status', value: r.staleRelease && rv.state === 'draft' ? 'Changed since release' : st.label, tone: st.tone ?? (r.staleRelease ? 'warn' : undefined) },
          { label: 'Review round', value: rv.round || '—' },
          { label: 'Open comments', value: rv.open, tone: rv.open ? 'warn' : undefined },
          { label: 'Releases', value: r.history.filter((h) => h.status === 'approved').length },
        ]} />

      {refusal ? <div className="pp-gap"><PublishRefusal refusal={refusal} projectId={id} can={can} mode="release" onDismiss={() => setRefusal(null)} /></div> : null}

      {/* WP-35 (group 9): the review task takes the wide column; the watermark, a setting changed once, the narrow one (audit 5.4 Release) */}
      <div className="pp-cols">
        <div className="pp-stack">
          <section className="card" data-testid="review-status" data-state={rv.state} aria-labelledby="rel-status-h">
            <div className="card-head"><h3 id="rel-status-h"><Icon name="rocket" />Status</h3>
              <Pill tone={stTone}>{rv.state === 'approved' && r.release ? <><Icon name="ok" size={12} />Approved — Release {r.release.number}</> : st.label}</Pill>
            </div>
            <div className="card-body">
              <p className="pp-lead">
                {rv.state === 'approved' && r.release ? <>Release {r.release.number} took effect {fmtDate(r.release.scheduledAt)}. The PDF has no “NOT RELEASED” stamp and names the release in its running head.</>
                  : rv.state === 'in_review' ? <>Waiting for the Project Manager. Until it is approved every PDF is stamped <strong>NOT RELEASED</strong>.</>
                    : rv.state === 'changes_requested' ? <>The Project Manager sent the manual back. Read the comments below, make the changes, then resubmit.</>
                      : r.staleRelease ? <>Release {r.staleRelease.number} was approved for <strong>different content</strong>. The manual has changed since, so PDFs are stamped <strong>NOT RELEASED</strong> until it is approved again.</>
                        : <>Every PDF is stamped <strong>NOT RELEASED</strong>. Submit the manual for review when it is finished.</>}
              </p>
              <p className="pp-note">{rv.state === 'approved' ? 'The PDF has no watermark.' : 'The PDF carries the NOT RELEASED watermark until approval.'} Built fresh from the current content. Covers {r.sources} source file{r.sources === 1 ? '' : 's'}{jsg ? ': the JSG document and its pictures.' : ': the publication module, the data modules placed in it, and its front matter.'}</p>
            </div>
          </section>

          {rv.state === 'in_review' && r.pending ? (
            <section className="card" data-testid="pending-request" aria-labelledby="rel-pending-h">
              <div className="card-head"><h3 id="rel-pending-h"><Icon name="clock" />Waiting for review</h3>
                {writable ? <button className="btn sm" disabled={busy} onClick={() => act(() => contentApi.withdrawRelease(id, r.pending!.id), 'Withdrawn')}>Withdraw the submission</button> : null}
              </div>
              <div className="card-body pp-form">
                <p>Submitted {fmtDate(r.pending.requestedAt)}{r.pending.requestedBy ? ` by ${r.pending.requestedBy}` : ''}.{r.pending.note ? <> Note: “{r.pending.note}”.</> : null}</p>
                {r.canApprove ? (
                  <>
                    {confirmApprove ? <ConfirmModal title="Approve and release this manual?" confirmLabel="Approve" icon="ok" tone="info" onClose={() => setConfirmApprove(false)} onConfirm={() => { setConfirmApprove(false); act(() => contentApi.decideRelease(id, r.pending!.id, true), 'Approved - the manual is released'); }} body={<p>The in-work data modules it covers are issued and the manual becomes the released version{r.pending.scheduledAt ? ` on ${fmtDate(r.pending.scheduledAt)}` : ''}. The approval is recorded under your name.</p>} /> : null}
                    <Field label="Comments for the author" hint="Needed to send the manual back. Approving needs none."><textarea className="input" rows={3} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What must change?" data-testid="send-back-reason" /></Field>
                    <div className="pp-actions">
                      <button className="btn primary" disabled={busy} onClick={() => setConfirmApprove(true)} data-testid="approve"><Icon name="ok" size={16} />Approve</button>
                      <button className="btn" disabled={busy || (!reason.trim() && open.length === 0)} onClick={() => act(() => contentApi.sendBack(id, r.pending!.id, reason), 'Sent back to the author', () => setReason(''))} data-testid="send-back"><Icon name="undo" size={16} />Send back for changes</button>
                    </div>
                  </>
                ) : r.approveBlocked ? <Callout tone="warning">{r.approveBlocked}</Callout> : <p className="pp-note">Only the Project Manager of this project, or an administrator, can approve it or send it back.</p>}
              </div>
            </section>
          ) : writable ? (
            <section className="card" data-testid="submit-card" aria-labelledby="rel-submit-h">
              <div className="card-head"><h3 id="rel-submit-h"><Icon name="send" />{submitLabel}</h3></div>
              <form className="card-body pp-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                {rv.state === 'changes_requested' && open.length ? <Callout tone="warning">{open.length} comment{open.length === 1 ? ' is' : 's are'} still open. Mark each one done when you have dealt with it.</Callout> : null}
                <Field label="Note for the Project Manager"><textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={rv.state === 'changes_requested' ? 'What did you change?' : 'Anything the reviewer should know?'} /></Field>
                <label className="check"><input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />Take effect at a later date once approved</label>
                {later ? <Field label="Takes effect" hint="Never in the past."><input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field> : null}
                <div><button className="btn primary" disabled={busy} data-testid="request-release"><Icon name="send" size={16} />{submitLabel}</button></div>
              </form>
            </section>
          ) : <Callout>Editors and owners can submit a manual for review.</Callout>}

          <section className="card" data-testid="review-thread" aria-labelledby="rel-cmt-h">
            <div className="card-head"><h3 id="rel-cmt-h"><Icon name="comment" />Review comments{rv.open ? <Pill tone="warning">{rv.open} open</Pill> : null}</h3></div>
            <div className="card-body pp-form">
              {rv.comments.length === 0 ? <EmptyState icon="comment" title="No comments yet" /> : <div className="pp-cmts">{rv.comments.map(commentRow)}</div>}
              {rv.canComment ? (
                <form className="pp-cmt-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void addComment(); }}>
                  <textarea className="input" rows={2} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" aria-label="New comment" data-testid="comment-text" />
                  <div className="pp-actions">
                    <select className="select" value={dmFile} onChange={(e) => setDmFile(e.target.value)} aria-label="About data module">
                      <option value="">About the whole manual</option>
                      {(dms.data ?? []).map((d) => <option key={d.file} value={d.file}>{d.techName || d.file}</option>)}
                    </select>
                    <button className="btn primary" disabled={busy || !text.trim()} data-testid="comment-add"><Icon name="comment" size={16} />Comment</button>
                  </div>
                </form>
              ) : null}
            </div>
          </section>

          {/* Phase 3 (P3-5): the review's merge request in GitLab, once one was opened (nothing while GitLab is off) */}
          <GitlabMergeRequests id={id} role={role} onSynced={() => { rel.reload(); reload(); }} />

          <section className="card" data-testid="review-reader-card" aria-labelledby="rel-read-h">
            <div className="card-head"><h3 id="rel-read-h"><Icon name="file" />Read and comment</h3></div>
            <div className="card-body">
              <p>{rv.canComment ? 'Open a data module and click the place you want to comment on.' : 'Open a data module to see the comments where they were made.'}</p>
              <select className="select pp-reader-pick" value={reading} onChange={(e) => setReading(e.target.value)} aria-label="Data module to read">
                <option value="">Choose a data module…</option>
                {(dms.data ?? []).map((d) => <option key={d.file} value={d.file}>{d.techName || d.file}{rv.comments.some((c) => c.dmFile === d.file && !c.resolved) ? '  •' : ''}</option>)}
              </select>
              {reading ? <ReviewReader projectId={id} file={reading} comments={rv.comments} canComment={rv.canComment} canResolve={rv.canComment} onChanged={() => { rel.reload(); reload(); }} /> : null}
            </div>
          </section>

          <section className="card" aria-labelledby="rel-hist-h">
            <div className="card-head"><h3 id="rel-hist-h"><Icon name="history" />History</h3><span className="faint">{r.history.length} submission{r.history.length === 1 ? '' : 's'}</span></div>
            {r.history.length === 0 ? <EmptyState icon="history" title="Nothing submitted yet" /> : (
              <div className="table-wrap"><table className="table"><thead><tr><th>Release</th><th>Submitted</th><th>Outcome</th><th>By</th></tr></thead>
                <tbody>{r.history.map((h) => <tr key={h.id}><td>{h.releaseNumber ? `Release ${h.releaseNumber}` : '—'}</td><td title={fmtDate(h.requestedAt)}>{ago(h.requestedAt)}</td>
                  <td><Pill tone={h.status === 'approved' ? 'success' : h.status === 'rejected' ? 'danger' : 'warning'}>{h.status === 'rejected' ? 'changes requested' : h.status === 'pending' ? 'in review' : h.status}</Pill></td><td>{h.requestedBy ?? '—'}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </div>

        <section className="card pp-side" aria-labelledby="rel-wm-h">
          <div className="card-head"><h3 id="rel-wm-h"><Icon name="stamp" />Watermark</h3></div>
          <div className="card-body pp-form">
            <p>Printed across every page of an <strong>approved</strong> manual when enabled. An unapproved manual is always stamped “NOT RELEASED” in orange, and this setting cannot turn that off.</p>
            <label className="check"><input type="checkbox" checked={wm.enabled} disabled={!writable} onChange={(e) => { setWm({ ...wm, enabled: e.target.checked }); setWmDirty(true); }} />Print a watermark on released copies</label>
            <Field label="Text"><input className="input" value={wm.text} maxLength={120} disabled={!writable} onChange={(e) => { setWm({ ...wm, text: e.target.value }); setWmDirty(true); }} placeholder="e.g. CONTROLLED COPY" /></Field>
            <Field label="Style">
              <select className="select" value={wm.style} disabled={!writable} onChange={(e) => { setWm({ ...wm, style: e.target.value }); setWmDirty(true); }}>
                {r.watermarkStyles.map((s) => <option key={s} value={s}>{s === 'diagonal' ? 'Diagonal across the page' : s === 'horizontal' ? 'Horizontal, centred' : 'Tiled, repeated over the page'}</option>)}
              </select>
            </Field>
            <div aria-label="Watermark preview" className="v2-wm-preview">
              {wm.enabled && wm.text ? (wm.style === 'tiled'
                ? <div className="v2-wm-tiles">{Array.from({ length: 15 }, (_, i) => <span key={i}>{wm.text}</span>)}</div>
                : <span className={`v2-wm-one${wm.style === 'diagonal' ? ' diagonal' : ''}`}>{wm.text}</span>)
                : <span className="v2-hint v2-wm-empty">{wm.enabled ? 'Enter the watermark text' : 'No watermark on released copies'}</span>}
            </div>
          </div>
          {writable ? <div className="card-foot"><button className="btn primary" disabled={!wmDirty || busy} onClick={() => act(async () => { await contentApi.saveWatermark(id, wm); setWmDirty(false); }, 'Watermark saved')}>Save watermark</button></div> : null}
        </section>
      </div>
    </div>
  );
}
