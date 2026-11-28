// Phase 3 (P3-4): the Comments panel of the PDF review. Counts, filters (status, type, author, page, module, needs re-anchoring), search,
// the list of threads (click or Enter jumps the PDF to the place; Up/Down move through the list), and the selected thread with its
// replies and the actions the reader's project role allows.

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { pdfReviewApi, type PdfAnnotation, type PdfAnnotationStatus, type PdfMe } from '../../api/pdfReview';
import { ConfirmModal, Pill, Seg, ago, errText, fmtDate } from '../ui';
import { Icon } from '../Icon';
import { KIND_LABEL, PLACEMENT_LABEL, STATUS_LABEL, authorOf, countThreads, editorLink, filterThreads, moduleOf, type ThreadFilter } from '../../lib/pdfReview';
import { useUi } from '../../store/ui';

const STATUS_TONE: Record<PdfAnnotationStatus, 'warning' | 'success' | 'danger' | 'info'> = { open: 'warning', resolved: 'success', accepted: 'success', rejected: 'danger' };

export function PdfCommentsPanel({ projectId, annotations, me, focusId, onFocus, filter, setFilter, onChanged, onPlaceAgain, readOnly }: {
  projectId: string; annotations: PdfAnnotation[]; me: PdfMe | null; focusId: string | null; onFocus: (id: string) => void;
  filter: ThreadFilter; setFilter: (f: ThreadFilter) => void; onChanged: (a: PdfAnnotation | null, removedId?: string) => void;
  onPlaceAgain?: (id: string) => void; readOnly?: boolean;
}) {
  const toast = useUi((s) => s.toast);
  const list = useMemo(() => filterThreads(annotations, filter), [annotations, filter]);
  const counts = useMemo(() => countThreads(annotations), [annotations]);
  const authors = useMemo(() => [...new Map(annotations.map((a) => [a.author.id, authorOf(a)])).entries()], [annotations]);
  const modules = useMemo(() => [...new Map(annotations.filter((a) => a.source).map((a) => [moduleOf(a), a.source!.title || moduleOf(a)])).entries()], [annotations]);
  const listRef = useRef<HTMLDivElement>(null);
  const sel = annotations.find((a) => a.id === focusId) ?? null;
  const can = me?.can;

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.prv-item') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[Math.min(items.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) { e.preventDefault(); next.focus(); next.click(); }
  };
  const set = (p: Partial<ThreadFilter>): void => setFilter({ ...filter, ...p });

  return (
    <aside className="prv-panel" aria-label="Comments" data-testid="pdf-comments-panel">
      <div className="prv-panel-head">
        <h3><Icon name="comment" />Comments<span className="badge accent" data-testid="pdf-count-open">{counts.open} open</span></h3>
        <div className="prv-counts" aria-label="Counts">
          {counts.required ? <Pill tone="danger" title="Open and required before release">{counts.required} required</Pill> : null}
          {counts.orphaned ? <Pill tone="warning" title="Could not be placed on the current PDF">{counts.orphaned} need re-anchoring</Pill> : null}
          <Pill>{counts.resolved + counts.accepted + counts.rejected} closed</Pill>
          <Pill>{counts.total} in all</Pill>
        </div>
        <Seg label="Status" value={filter.status === 'all' || filter.status === 'open' || filter.status === 'closed' ? filter.status : 'all'} testId="pdf-filter-status"
          options={[{ value: 'open', label: 'Open', count: counts.open }, { value: 'closed', label: 'Closed', count: counts.total - counts.open }, { value: 'all', label: 'All', count: counts.total }]}
          onChange={(v) => set({ status: v })} />
        <div className="prv-filters">
          <input className="input wide" type="search" placeholder="Search comments…" aria-label="Search comments" value={filter.text} onChange={(e) => set({ text: e.target.value })} data-testid="pdf-search" />
          <select className="select" aria-label="Type" value={filter.kind} onChange={(e) => set({ kind: e.target.value as ThreadFilter['kind'] })} data-testid="pdf-filter-kind">
            <option value="all">All types</option><option value="comment">Comments</option><option value="suggestion">Suggestions</option><option value="remark">Remarks</option>
          </select>
          <select className="select" aria-label="Author" value={filter.author} onChange={(e) => set({ author: e.target.value })}>
            <option value="">Everyone</option>{authors.map(([idv, n]) => <option key={idv} value={idv}>{n}</option>)}
          </select>
          <input className="input" inputMode="numeric" placeholder="Page" aria-label="Page" value={filter.page} onChange={(e) => set({ page: e.target.value.replace(/\D/g, '') })} />
          <select className="select" aria-label="Module" value={filter.module} onChange={(e) => set({ module: e.target.value })}>
            <option value="">Any module</option>{modules.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <label className="check wide"><input type="checkbox" checked={filter.placement === 'orphaned'} onChange={(e) => set({ placement: e.target.checked ? 'orphaned' : 'all' })} />Only those that need re-anchoring</label>
        </div>
      </div>
      <div className="prv-list" ref={listRef} onKeyDown={onKey} role="list" aria-label="Comment threads">
        {list.length === 0 ? <div className="empty-state"><Icon name="comment" size={24} /><div className="title">{annotations.length ? 'No comment matches the filters' : 'No comments yet'}</div>
          {!annotations.length && can?.create && !readOnly ? <div>Select text on the page, or draw an area with the Area tool, to comment.</div> : null}</div> : null}
        {list.map((a) => (
          <div role="listitem" key={a.id}>
            <button type="button" className="prv-item" aria-current={a.id === focusId} onClick={() => onFocus(a.id)} data-testid="pdf-thread-item" data-id={a.id} data-status={a.status} data-state={a.anchorState} data-page={a.page}>
              <span className="head"><span className={`prv-kind ${a.kind}`} aria-hidden="true" /><strong>{authorOf(a)}</strong>{KIND_LABEL[a.kind]} · p. {a.page}
                <span className="grow" /><Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>{a.required ? <Pill tone="danger">Required</Pill> : null}</span>
              {a.anchor.quote ? <span className="q">“{a.anchor.quote.exact}”</span> : a.anchor.area ? <span className="q">Area on the page</span> : null}
              <span className="body">{a.body || (a.kind === 'suggestion' ? `→ “${a.replacement ?? ''}”` : '')}</span>
              {a.anchorState !== 'placed' ? <span className="prv-orphan">{PLACEMENT_LABEL[a.anchorState]}{a.anchorState === 'orphaned' ? ` (was on page ${a.page})` : ''}</span> : null}
              <span className="head">{ago(a.createdAt)}{a.replies.length ? ` · ${a.replies.length} repl${a.replies.length === 1 ? 'y' : 'ies'}` : ''}{a.source ? ` · ${a.source.title}` : ''}</span>
            </button>
          </div>
        ))}
      </div>
      {sel ? <ThreadDetail key={sel.id} projectId={projectId} a={sel} me={me} readOnly={readOnly} onChanged={onChanged} onPlaceAgain={onPlaceAgain} toast={toast} /> : null}
    </aside>
  );
}

function ThreadDetail({ projectId, a, me, readOnly, onChanged, onPlaceAgain, toast }: {
  projectId: string; a: PdfAnnotation; me: PdfMe | null; readOnly?: boolean; onChanged: (a: PdfAnnotation | null, removedId?: string) => void;
  onPlaceAgain?: (id: string) => void; toast: (m: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(a.body);
  const [replacement, setReplacement] = useState(a.replacement ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const can = me?.can; const own = me?.id === a.author.id;
  const write = !readOnly && !!can;
  const link = editorLink(projectId, a);
  const run = async (fn: () => Promise<{ annotation: PdfAnnotation } | { ok: true }>, ok: string, after?: () => void): Promise<void> => {
    setBusy(true);
    try { const r = await fn(); onChanged('annotation' in r ? r.annotation : null, 'annotation' in r ? undefined : a.id); toast(ok, 'success'); after?.(); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  const status = (s: PdfAnnotationStatus, ok: string) => run(() => pdfReviewApi.setStatus(projectId, a.id, s), ok);
  return (
    <section className="prv-thread" aria-label="Selected comment" data-testid="pdf-thread" data-id={a.id}>
      <div className="row"><span className={`prv-kind ${a.kind}`} aria-hidden="true" /><strong>{KIND_LABEL[a.kind]}</strong><span className="meta">by {authorOf(a)} · <span title={fmtDate(a.createdAt)}>{ago(a.createdAt)}</span> · page {a.page}</span></div>
      {a.anchorState === 'orphaned' ? <div className="prv-orphan" data-testid="pdf-needs-reanchor">Needs re-anchoring: these words were not found in the current PDF (last on page {a.page}{a.orig.page !== a.page ? `, first on page ${a.orig.page}` : ''}).</div> : null}
      {a.anchorState === 'moved' ? <div className="meta">Moved by a rebuild{a.anchor.fuzzy ? ' (the words changed a little)' : ''}; first made on page {a.orig.page}.</div> : null}
      {a.anchor.quote ? <p className="quote">“{a.anchor.quote.exact}”</p> : null}
      {editing ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(() => pdfReviewApi.edit(projectId, a.id, { body, ...(a.kind === 'suggestion' ? { replacement } : {}), updatedAt: a.updatedAt }), 'Comment changed', () => setEditing(false)); }}>
          <textarea className="input grow" rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Comment text" />
          {a.kind === 'suggestion' ? <textarea className="input grow" rows={2} maxLength={4000} value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Replacement text" /> : null}
          <button className="btn sm primary" disabled={busy}>Save</button><button type="button" className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : <>
        {a.body ? <p className="body">{a.body}</p> : null}
        {a.kind === 'suggestion' ? <p className="replace" data-testid="pdf-replacement">Replace with: “{a.replacement ?? ''}”</p> : null}
      </>}
      <div className="row">
        <Pill tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Pill>{a.statusBy && a.status !== 'open' ? <span className="meta">by {a.statusBy}</span> : null}
        {a.required ? <Pill tone="danger">Required before release</Pill> : null}
        {a.source ? <span className="meta" title="Where these words come from">in {a.source.title}</span> : null}
      </div>
      {a.replies.map((r) => <div className="reply" key={r.id}><div className="who">{r.author.name ?? r.author.username} · {ago(r.createdAt)}</div><p className="body">{r.body}</p></div>)}
      {write ? <div className="row">
        {a.status === 'open' && can!.resolve ? <button className="btn sm" disabled={busy} onClick={() => void status('resolved', 'Resolved')} data-testid="pdf-status-resolve"><Icon name="ok" size={14} />Resolve</button> : null}
        {a.status !== 'open' && can!.resolve ? <button className="btn sm" disabled={busy} onClick={() => void status('open', 'Reopened')} data-testid="pdf-status-reopen"><Icon name="undo" size={14} />Reopen</button> : null}
        {a.kind === 'suggestion' && a.status === 'open' && can!.decide ? <>
          <button className="btn sm" disabled={busy} onClick={() => void status('accepted', 'Suggestion accepted')} data-testid="pdf-status-accept"><Icon name="check" size={14} />Accept</button>
          <button className="btn sm" disabled={busy} onClick={() => void status('rejected', 'Suggestion rejected')} data-testid="pdf-status-reject"><Icon name="close" size={14} />Reject</button>
        </> : null}
        {(own || can!.moderate) && !editing && can!.reply ? <button className="btn sm subtle" onClick={() => setEditing(true)} data-testid="pdf-edit"><Icon name="edit" size={14} />Edit</button> : null}
        {(own || can!.moderate) && can!.reply ? <button className="btn sm subtle" onClick={() => setConfirmDelete(true)} data-testid="pdf-delete"><Icon name="trash" size={14} />Delete</button> : null}
        {a.anchorState !== 'placed' && can!.create && onPlaceAgain ? <button className="btn sm subtle" onClick={() => onPlaceAgain(a.id)} data-testid="pdf-place-again" title="Select the words (or draw the area) where this comment belongs now">Place again</button> : null}
      </div> : null}
      {link ? <div className="row"><Link className="btn sm" to={link} data-testid="pdf-open-editor"><Icon name="editor" size={14} />Open in editor</Link></div> : null}
      {write && can!.reply ? (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) void run(() => pdfReviewApi.reply(projectId, a.id, reply), 'Reply added', () => setReply('')); }}>
          <textarea className="input grow" rows={2} maxLength={4000} placeholder="Reply…" aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} data-testid="pdf-reply-text" />
          <button className="btn sm primary" disabled={busy || !reply.trim()} data-testid="pdf-reply-send"><Icon name="send" size={14} />Reply</button>
        </form>
      ) : null}
      {confirmDelete ? <ConfirmModal title="Delete this comment?" danger confirmLabel="Delete" body={<p>The thread and its replies are removed for everyone. Resolving keeps it on record instead.</p>}
        onClose={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); void run(() => pdfReviewApi.remove(projectId, a.id), 'Comment deleted'); }} /> : null}
    </section>
  );
}
