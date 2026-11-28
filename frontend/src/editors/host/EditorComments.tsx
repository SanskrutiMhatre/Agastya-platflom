// WP-22 (UX-009, 06 section 9.2): the Project Manager's review comments, inside the editors.
//
// The comments used to be readable only on the Release page, so an author fixing a text had to leave the editor to see what was asked. The
// editor header now carries a "Comments" button with the number still open; it opens a panel beside the document that lists them (the open
// data module's first in the S1000D editor), steps through them (Alt+Shift+N next, Alt+Shift+P previous: useHostKeys), opens the data module a
// comment is about, and marks a comment done or reopens it, on the same server record the Release page shows. Nothing is anchored inside the
// editing surface itself: the "Moved or changed" logic of ReviewReader stays where it is (the Release page's reading view).
//
// Phase 3 (P3-1): in a live document a reviewer (or an author) comments while the others type: "Comment on the selection" pins the
// comment to the selected words with Yjs relative positions (they follow the words through everyone's edits), every comment panel of the
// project reloads at once (the socket's { type: 'comments' }), and "Show" puts the caret on the commented words.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { contentApi, type ReviewComment } from '../../api';
import { Icon } from '../../components/Icon';
import { Badge, ago, errText, fmtDate } from '../../components/ui';
import { may, type Can } from '../../lib/roles';
import { useUi } from '../../store/ui';
import { subscribe } from '../../lib/progress';
import type { ReviewAnchor } from '../../api';
import '../../styles/pages/editor-host.css';   // WP-35 second pass: the comments panel's styles load with the editor chunks

export interface EditorCommentsState {
  comments: ReviewComment[];
  open: ReviewComment[];
  reload: () => void;
  shown: boolean;
  setShown: (v: boolean) => void;
  /** the comment the author is on (stepping moves it) */
  at: number | null;
  step: (dir: 1 | -1) => void;
  canResolve: boolean;
  /** Phase 3: this person may add a comment */
  canComment: boolean;
}

/** Phase 3: what a page offers the panel to pin a new comment (the selection) and to show a pinned one. */
export interface CommentPinning {
  /** the open document and the anchor of its selection, or null (nothing selected, not a document) */
  anchor(): { file: string; anchor: ReviewAnchor } | null;
  /** put the caret on a comment's words (true when it could) */
  reveal?(file: string, anchor: ReviewAnchor): boolean;
}

/** The comments of the project, the open ones of `activeFile` first. Loaded once, again after a change, and when the panel opens. */
export function useEditorComments(projectId: string, can: Can, activeFile?: string | null, onOpen?: (c: ReviewComment) => void): EditorCommentsState {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [shown, setShown] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const readable = may(can, 'release.read');
  const reload = useCallback(() => {
    if (!readable) return;
    contentApi.release(projectId).then((r) => setComments(r.review.comments), () => undefined);
  }, [projectId, readable]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (shown) reload(); }, [shown, reload]);
  // P3-1: a comment made or resolved by anyone reaches every open panel without a refresh
  useEffect(() => subscribe((m) => { if (m.projectId === projectId && m.type === 'comments') reload(); }), [projectId, reload]);
  const open = useMemo(() => {
    const list = comments.filter((c) => !c.resolved);
    return activeFile ? [...list.filter((c) => c.dmFile === activeFile), ...list.filter((c) => c.dmFile !== activeFile)] : list;
  }, [comments, activeFile]);
  const step = useCallback((dir: 1 | -1) => {
    if (!open.length) { setShown(true); return; }
    setShown(true);
    setAt((i) => {
      const n = i === null ? (dir === 1 ? 0 : open.length - 1) : (i + dir + open.length) % open.length;
      const c = open[n]; if (c && onOpen && c.dmFile && c.dmFile !== activeFile) onOpen(c);
      return n;
    });
  }, [open, onOpen, activeFile]);
  return { comments, open, reload, shown, setShown, at, step, canResolve: may(can, 'review.comment'), canComment: may(can, 'review.comment') };
}

/** The header button: "Comments" with the number still open. Absent when the project has no comment at all. */
/** `always` (Phase 3): shown with no comments yet too, so the first comment can be made on a live document */
export function CommentsButton({ state, always = false }: { state: EditorCommentsState; always?: boolean }) {
  if (!state.comments.length && !always) return null;
  const n = state.open.length;
  return (
    <button className={`btn btn-sm${state.shown ? ' is-on' : ''}`} onClick={() => state.setShown(!state.shown)} aria-expanded={state.shown} aria-controls="editor-comments"
      data-testid="editor-comments" title={`Review comments: ${n} open (next Alt+Shift+N, previous Alt+Shift+P)`} aria-keyshortcuts="Alt+Shift+N Alt+Shift+P">
      <Icon name="comment" size={12} />Comments{n ? <span className="v2-count" data-testid="editor-comments-open">{n}</span> : null}
    </button>
  );
}

/** The panel beside the document. */
/** `inline`: the list in the Properties panel's Comments tab (UI redesign, mockup editor.html): always drawn, without the floating frame and head. */
export function CommentsPanel({ projectId, state, activeFile, onOpen, inline = false, pinning }: { projectId: string; state: EditorCommentsState; activeFile?: string | null; onOpen?: (c: ReviewComment) => void; inline?: boolean; pinning?: CommentPinning }) {
  const toast = useUi((s) => s.toast);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const add = async () => {
    const at = pinning?.anchor() ?? null;
    if (!draft.trim()) return;
    if (!at) { toast('Select the words the comment is about in the document first.', 'info'); return; }
    setBusy(true);
    try { await contentApi.addComment(projectId, draft.trim(), at.file, at.anchor); setDraft(''); toast('Comment added', 'success'); state.reload(); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  if (!state.shown && !inline) return null;
  const list = done ? state.comments : state.open;
  const current = state.at !== null ? state.open[state.at] : null;
  const resolve = async (c: ReviewComment, resolved: boolean) => {
    setBusy(true);
    try { await contentApi.resolveComment(projectId, c.id, resolved); toast(resolved ? 'Marked as done' : 'Reopened', 'success'); state.reload(); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <aside className={inline ? 'v2-edcomments is-inline' : 'v2-edcomments'} id={inline ? undefined : 'editor-comments'} aria-label="Review comments" {...(inline ? { 'data-testid': 'comments-inline' } : { 'data-testid': 'comments-panel' })}>
      {inline ? null : <div className="v2-edcomments-head">
        <b>Review comments</b><span className="v2-hint">{state.open.length} open</span>
        <span className="spacer" />
        <button className="icon-btn" onClick={() => state.step(-1)} title="Previous comment (Alt+Shift+P)" aria-label="Previous comment" data-testid="comment-prev" disabled={!state.open.length}><Icon name="up" size={14} /></button>
        <button className="icon-btn" onClick={() => state.step(1)} title="Next comment (Alt+Shift+N)" aria-label="Next comment" data-testid="comment-next" disabled={!state.open.length}><Icon name="down" size={14} /></button>
        <button className="icon-btn" onClick={() => state.setShown(false)} title="Close" aria-label="Close the comments" data-testid="comments-close"><Icon name="close" size={14} /></button>
      </div>}
      {pinning && state.canComment && activeFile ? (
        <div className="v2-edcomments-new">
          <textarea className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Comment on the selected words…" aria-label="New comment" {...(inline ? { 'data-testid': 'comment-new-inline' } : { 'data-testid': 'comment-new' })} />
          <button className="btn btn-sm btn-primary" disabled={busy || !draft.trim()} onClick={() => void add()} title="Pin the comment to the words selected in the document" {...(inline ? { 'data-testid': 'comment-add-inline' } : { 'data-testid': 'comment-add' })}><Icon name="comment" size={12} />Comment on the selection</button>
        </div>
      ) : null}
      <label className="v2-row v2-hint v2-edcomments-done"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />Show the comments marked done</label>
      <div className="v2-edcomments-list">
        {list.length === 0 ? <p className="v2-hint v2-edcomments-empty">No open comments.</p> : list.map((c) => (
          <div key={c.id} className={`v2-rv ${c.kind === 'changes' ? 'changes' : ''} ${c.resolved ? 'done' : ''}${current?.id === c.id ? ' is-current' : ''}`} {...(inline ? {} : { 'data-testid': 'editor-comment' })} data-current={current?.id === c.id || undefined}>
            <div className="v2-rv-head">
              <b>{c.byName ?? c.by ?? 'Someone'}</b>
              {c.kind === 'changes' ? <Badge tone="bad">Sent back</Badge> : null}
              <span className="v2-hint" title={fmtDate(c.at)}>{ago(c.at)}</span>
            </div>
            {c.dmFile ? <div className="v2-hint v2-trunc" title={c.dmFile}>{c.dmFile === activeFile ? (activeFile.includes('/') ? 'This document' : 'This data module') : c.dmFile}{c.anchor ? ` · on “${c.anchor.text.slice(0, 50)}${c.anchor.text.length > 50 ? '…' : ''}”` : ''}</div> : null}
            <p className="v2-rv-body">{c.body}</p>
            <div className="v2-row v2-edcomment-acts">
              {c.dmFile && c.dmFile === activeFile && c.anchor?.y && pinning?.reveal ? <button className="btn btn-sm" onClick={() => { if (!pinning.reveal!(c.dmFile!, c.anchor!)) toast('Those words are no longer in the document.', 'info'); }} {...(inline ? {} : { 'data-testid': 'editor-comment-show' })}><Icon name="search" size={12} />Show</button> : null}
              {c.dmFile && onOpen && c.dmFile !== activeFile ? <button className="btn btn-sm" onClick={() => onOpen(c)} {...(inline ? {} : { 'data-testid': 'editor-comment-open' })}><Icon name="editor" size={12} />Open the data module</button> : null}
              {state.canResolve ? <button className="btn btn-sm" disabled={busy} onClick={() => void resolve(c, !c.resolved)} {...(inline ? {} : { 'data-testid': 'editor-comment-done' })}><Icon name="check" size={12} />{c.resolved ? 'Reopen' : 'Done'}</button> : null}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
