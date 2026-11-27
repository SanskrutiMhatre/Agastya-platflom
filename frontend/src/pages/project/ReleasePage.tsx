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
import { Alert, Badge, ConfirmModal, Empty, Field, Loading, errText, fmtDate, ago, useAsync } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { ReviewReader } from '../../components/ReviewReader';
import { PublishRefusal } from '../../components/PublishRefusal';
import { canWrite, useProject } from '../../layouts/ProjectShell';
import { refusalOf, type Refusal } from '../../lib/waivers';
import { useUi } from '../../store/ui';

const STATE: Record<ReviewState, { label: string; tone?: 'ok' | 'warn' | 'bad' | 'accent' }> = {
  draft: { label: 'Not submitted' },
  in_review: { label: 'In review', tone: 'warn' },
  changes_requested: { label: 'Changes requested', tone: 'bad' },
  approved: { label: 'Approved', tone: 'ok' },
};

export function ReleasePage() {
  const { id, role, can, reload } = useProject();
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
  if (rel.error || !rel.data) return <div className="v2-page"><Alert tone="bad">{rel.error}</Alert></div>;
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
    <div key={c.id} className={`v2-rv ${c.kind === 'changes' ? 'changes' : ''} ${c.resolved ? 'done' : ''}`} data-testid="review-comment" data-kind={c.kind}>
      <div className="v2-rv-head">
        <b>{c.byName ?? c.by ?? 'Someone'}</b>
        {c.kind === 'changes' ? <Badge tone="bad">Sent back</Badge> : null}
        {c.dmFile ? <Badge title="The data module this refers to">{c.dmFile}</Badge> : null}
        {c.anchor ? <button type="button" className="btn btn-sm" title="Show this place in the data module" onClick={() => setReading(c.dmFile!)}>On “{c.anchor.text.slice(0, 40)}{c.anchor.text.length > 40 ? '…' : ''}”</button> : null}
        <span className="v2-hint" title={fmtDate(c.at)}>{ago(c.at)}</span>
        {rv.canComment ? (
          <label className="v2-row" style={{ marginLeft: 'auto', gap: 6 }}>
            <input type="checkbox" checked={c.resolved} disabled={busy} onChange={(e) => void act(() => contentApi.resolveComment(id, c.id, e.target.checked), e.target.checked ? 'Marked as done' : 'Reopened')} aria-label={`Mark comment by ${c.byName ?? c.by} as done`} />Done
          </label>
        ) : c.resolved ? <Badge tone="ok">Done</Badge> : null}
      </div>
      <p className="v2-rv-body">{c.body}</p>
    </div>
  );

  return (
    <div className="v2-page">
      <PageHeader icon="rocket" title="Review and release" sub="Submit the manual to the Project Manager, answer their comments, and release it once approved."
        stats={[
          { label: 'Status', value: r.staleRelease && rv.state === 'draft' ? 'Changed since release' : st.label, tone: st.tone ?? (r.staleRelease ? 'warn' : undefined) },
          { label: 'Review round', value: rv.round || '—' },
          { label: 'Open comments', value: rv.open, tone: rv.open ? 'warn' : undefined },
          { label: 'Releases', value: r.history.filter((h) => h.status === 'approved').length },
        ]} />

      {/* WP-35 (group 9): the review task takes the wide column; the watermark, a setting changed once, the narrow one (audit 5.4 Release) */}
      <div className="v2-grid v2-split">
        <div className="v2-stack">
          {refusal ? <PublishRefusal refusal={refusal} projectId={id} can={can} mode="release" onDismiss={() => setRefusal(null)} /> : null}
          <div className="v2-card v2-card-pad" data-testid="review-status" data-state={rv.state}>
            <div className="v2-row v2-spread"><h3 style={{ margin: 0 }}>Status</h3>
              <Badge tone={st.tone}>{rv.state === 'approved' && r.release ? <><Icon name="ok" size={12} />Approved — Release {r.release.number}</> : st.label}</Badge>
            </div>
            <p style={{ marginBottom: 0 }}>
              {rv.state === 'approved' && r.release ? <>Release {r.release.number} took effect {fmtDate(r.release.scheduledAt)}. The PDF has no “NOT RELEASED” stamp and names the release in its running head.</>
                : rv.state === 'in_review' ? <>Waiting for the Project Manager. Until it is approved every PDF is stamped <strong>NOT RELEASED</strong>.</>
                  : rv.state === 'changes_requested' ? <>The Project Manager sent the manual back. Read the comments below, make the changes, then resubmit.</>
                    : r.staleRelease ? <>Release {r.staleRelease.number} was approved for <strong>different content</strong>. The manual has changed since, so PDFs are stamped <strong>NOT RELEASED</strong> until it is approved again.</>
                      : <>Every PDF is stamped <strong>NOT RELEASED</strong>. Submit the manual for review when it is finished.</>}
            </p>
            <div className="v2-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <a className="btn btn-primary" href={contentApi.downloadUrl(id)} download data-testid="download-pdf"><Icon name="download" />{rv.state === 'approved' ? 'Download released PDF' : 'Download PDF (NOT RELEASED)'}</a>
              <span className="v2-hint">{rv.state === 'approved' ? 'No watermark.' : 'Carries the NOT RELEASED watermark until approval.'} Built fresh from the current content.</span>
            </div>
            <p className="v2-hint" style={{ marginBottom: 0 }}>Covers {r.sources} source file{r.sources === 1 ? '' : 's'}: the publication module, the data modules placed in it, and its front matter.</p>
          </div>

          {rv.state === 'in_review' && r.pending ? (
            <div className="v2-card v2-card-pad" data-testid="pending-request">
              <h3 className="v2-mt0">Waiting for review</h3>
              <p>Submitted {fmtDate(r.pending.requestedAt)}{r.pending.requestedBy ? ` by ${r.pending.requestedBy}` : ''}.{r.pending.note ? <> Note: “{r.pending.note}”.</> : null}</p>
              {r.canApprove ? (
                <div className="v2-stack">
                  {confirmApprove ? <ConfirmModal title="Approve and release this manual?" confirmLabel="Approve" onClose={() => setConfirmApprove(false)} onConfirm={() => { setConfirmApprove(false); act(() => contentApi.decideRelease(id, r.pending!.id, true), 'Approved - the manual is released'); }} body={<p>The in-work data modules it covers are issued and the manual becomes the released version{r.pending.scheduledAt ? ` on ${fmtDate(r.pending.scheduledAt)}` : ''}. The approval is recorded under your name.</p>} /> : null}
                  <Field label="Comments for the author" hint="Needed to send the manual back. Approving needs none."><textarea className="v2-textarea" rows={3} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What must change?" data-testid="send-back-reason" /></Field>
                  <div className="v2-row">
                    <button className="btn btn-primary" disabled={busy} onClick={() => setConfirmApprove(true)} data-testid="approve">Approve</button>
                    <button className="btn" disabled={busy || (!reason.trim() && open.length === 0)} onClick={() => act(() => contentApi.sendBack(id, r.pending!.id, reason), 'Sent back to the author', () => setReason(''))} data-testid="send-back"><Icon name="undo" size={14} />Send back for changes</button>
                  </div>
                </div>
              ) : r.approveBlocked ? <Alert tone="warn">{r.approveBlocked}</Alert> : <p className="v2-hint">Only the Project Manager of this project, or an administrator, can approve it or send it back.</p>}
              {writable ? <div style={{ marginTop: 10 }}><button className="btn btn-sm" disabled={busy} onClick={() => act(() => contentApi.withdrawRelease(id, r.pending!.id), 'Withdrawn')}>Withdraw the submission</button></div> : null}
            </div>
          ) : writable ? (
            <div className="v2-card v2-card-pad" data-testid="submit-card">
              <h3 className="v2-mt0">{submitLabel}</h3>
              {rv.state === 'changes_requested' && open.length ? <Alert tone="warn">{open.length} comment{open.length === 1 ? ' is' : 's are'} still open. Mark each one done when you have dealt with it.</Alert> : null}
              <form className="v2-stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <Field label="Note for the Project Manager"><textarea className="v2-textarea" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={rv.state === 'changes_requested' ? 'What did you change?' : 'Anything the reviewer should know?'} /></Field>
                <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />Take effect at a later date once approved</label>
                {later ? <Field label="Takes effect" hint="Never in the past."><input className="v2-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field> : null}
                <div><button className="btn btn-primary" disabled={busy} data-testid="request-release"><Icon name="send" />{submitLabel}</button></div>
              </form>
            </div>
          ) : <Alert>Editors and owners can submit a manual for review.</Alert>}

          <div className="v2-card v2-card-pad" data-testid="review-thread">
            <h3 className="v2-mt0">Review comments</h3>
            {rv.comments.length === 0 ? <Empty title="No comments yet" /> : <div className="v2-stack">{rv.comments.map(commentRow)}</div>}
            {rv.canComment ? (
              <form className="v2-stack" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) void addComment(); }}>
                <textarea className="v2-textarea" rows={2} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" aria-label="New comment" data-testid="comment-text" />
                <div className="v2-row" style={{ flexWrap: 'wrap' }}>
                  <select className="v2-select" style={{ height: 30, maxWidth: 320 }} value={dmFile} onChange={(e) => setDmFile(e.target.value)} aria-label="About data module">
                    <option value="">About the whole manual</option>
                    {(dms.data ?? []).map((d) => <option key={d.file} value={d.file}>{d.techName || d.file}</option>)}
                  </select>
                  <button className="btn btn-sm btn-primary" disabled={busy || !text.trim()} data-testid="comment-add"><Icon name="comment" size={13} />Comment</button>
                </div>
              </form>
            ) : null}
          </div>

          <div className="v2-card v2-card-pad" data-testid="review-reader-card">
            <h3 className="v2-mt0">Read and comment</h3>
            <p className="v2-sub v2-mt0">{rv.canComment ? 'Open a data module and click the place you want to comment on.' : 'Open a data module to see the comments where they were made.'}</p>
            <select className="v2-select" style={{ height: 30, maxWidth: 360, marginBottom: 10 }} value={reading} onChange={(e) => setReading(e.target.value)} aria-label="Data module to read">
              <option value="">Choose a data module…</option>
              {(dms.data ?? []).map((d) => <option key={d.file} value={d.file}>{d.techName || d.file}{rv.comments.some((c) => c.dmFile === d.file && !c.resolved) ? '  •' : ''}</option>)}
            </select>
            {reading ? <ReviewReader projectId={id} file={reading} comments={rv.comments} canComment={rv.canComment} canResolve={rv.canComment} onChanged={() => { rel.reload(); reload(); }} /> : null}
          </div>

          <div className="v2-card">
            <div className="v2-card-head">History</div>
            {r.history.length === 0 ? <Empty title="Nothing submitted yet" /> : (
              <table className="v2-table"><thead><tr><th>Release</th><th>Submitted</th><th>Outcome</th><th>By</th></tr></thead>
                <tbody>{r.history.map((h) => <tr key={h.id}><td>{h.releaseNumber ? `Release ${h.releaseNumber}` : '—'}</td><td title={fmtDate(h.requestedAt)}>{ago(h.requestedAt)}</td>
                  <td><Badge tone={h.status === 'approved' ? 'ok' : h.status === 'rejected' ? 'bad' : 'warn'}>{h.status === 'rejected' ? 'changes requested' : h.status === 'pending' ? 'in review' : h.status}</Badge></td><td>{h.requestedBy ?? '—'}</td></tr>)}</tbody></table>
            )}
          </div>
        </div>

        <div className="v2-card v2-card-pad">
          <h3 className="v2-mt0">Watermark</h3>
          <p className="v2-sub v2-mt0">Printed across every page of an <strong>approved</strong> manual when enabled. An unapproved manual is always stamped “NOT RELEASED” in orange, and this setting cannot turn that off.</p>
          <div className="v2-stack">
            <label className="v2-row"><input type="checkbox" checked={wm.enabled} disabled={!writable} onChange={(e) => { setWm({ ...wm, enabled: e.target.checked }); setWmDirty(true); }} />Print a watermark on released copies</label>
            <Field label="Text"><input className="v2-input" value={wm.text} maxLength={120} disabled={!writable} onChange={(e) => { setWm({ ...wm, text: e.target.value }); setWmDirty(true); }} placeholder="e.g. CONTROLLED COPY" /></Field>
            <Field label="Style">
              <select className="v2-select" value={wm.style} disabled={!writable} onChange={(e) => { setWm({ ...wm, style: e.target.value }); setWmDirty(true); }}>
                {r.watermarkStyles.map((s) => <option key={s} value={s}>{s === 'diagonal' ? 'Diagonal across the page' : s === 'horizontal' ? 'Horizontal, centred' : 'Tiled, repeated over the page'}</option>)}
              </select>
            </Field>
            <div aria-label="Watermark preview" className="v2-wm-preview">
              {wm.enabled && wm.text ? (wm.style === 'tiled'
                ? <div className="v2-wm-tiles">{Array.from({ length: 15 }, (_, i) => <span key={i}>{wm.text}</span>)}</div>
                : <span className={`v2-wm-one${wm.style === 'diagonal' ? ' diagonal' : ''}`}>{wm.text}</span>)
                : <span className="v2-hint v2-wm-empty">{wm.enabled ? 'Enter the watermark text' : 'No watermark on released copies'}</span>}
            </div>
            {writable ? <div><button className="btn btn-primary" disabled={!wmDirty || busy} onClick={() => act(async () => { await contentApi.saveWatermark(id, wm); setWmDirty(false); }, 'Watermark saved')}>Save watermark</button></div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
