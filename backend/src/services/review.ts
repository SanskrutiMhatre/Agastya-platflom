// =============================================================================
// Manual review - the human side of the release flow.
//
//   Author finishes the manual      -> submits it for review          (a release request)
//   Project Manager reads it        -> comments on it, or approves
//   Project Manager sends it back   -> "changes requested", with the reasons
//   Author fixes it                 -> resubmits                       (a new release request)
//   Project Manager approves        -> the publication is RELEASED: its PDF has no watermark
//
// This is NOT a second workflow beside release. A release request already carries the approval
// rules (who may decide, the content fingerprint, the NOT RELEASED watermark that stays on every
// build until approval) - review adds what was missing around it: comments, sending back with
// reasons, and a state a person can read.
//
// States (derived, never stored, so they cannot drift from the release table):
//   draft              nothing submitted yet (or the last approval no longer covers the content)
//   in_review          a request is waiting for the Project Manager
//   changes_requested  the Project Manager sent it back; the author has work to do
//   approved           released: the content still matches what was approved
// =============================================================================

import { nowIso } from '../config';
import { store } from '../context';
import { bad, notFound } from './http';
import { releaseStateOf } from './release';

type Row = Record<string, any>;

export type ReviewState = 'draft' | 'in_review' | 'changes_requested' | 'approved';

/** `known`: the release state the caller has already computed in this request (WP-17: a page view computes it once, not three times). */
export function reviewState(projectId: string, known?: Pick<ReturnType<typeof releaseStateOf>, 'released' | 'pending' | 'staleRelease'>): { state: ReviewState; round: number } {
  const st = known ?? releaseStateOf(projectId);
  const history: Row[] = store.listReleasesForProject(projectId);          // newest first
  const round = history.filter((h) => h.status !== 'withdrawn').length;
  if (st.released) return { state: 'approved', round };
  if (st.pending) return { state: 'in_review', round };
  const latest = history[0];
  if (latest && latest.status === 'rejected' && !st.staleRelease) return { state: 'changes_requested', round };
  return { state: 'draft', round };
}

export const commentView = (c: Row) => ({
  id: c.id, kind: c.kind, body: c.body, dmFile: c.dm_file, anchor: parseAnchor(c.anchor), releaseId: c.release_id,
  by: c.username ?? null, byName: c.full_name ?? null, byRole: c.user_role ?? null,
  at: c.created_at, resolved: !!c.resolved_at, resolvedAt: c.resolved_at ?? null, resolvedBy: c.resolved_by_username ?? null,
});

export interface Anchor { path: string; tag: string; text: string }
function parseAnchor(raw: unknown): Anchor | null { try { return raw ? (JSON.parse(String(raw)) as Anchor) : null; } catch { return null; } }
/** A pin is an element of one data module: its child-index path from the root, its tag and the words it carried when the comment was made (so a moved element can still be recognised). */
function cleanAnchor(raw: any, dmFile: string | null): string | null {
  if (raw == null) return null;
  if (!dmFile) throw bad('A comment pinned to a place must say which data module it is in.', 'ANCHOR_NEEDS_DM');
  const path = String(raw.path ?? '');
  if (!/^\d+(\/\d+){0,40}$/.test(path)) throw bad('That is not a place in the data module.', 'BAD_ANCHOR');
  const tag = String(raw.tag ?? '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60);
  return JSON.stringify({ path, tag, text: clean(raw.text, 200) });
}

export const listComments = (projectId: string) => store.listReviewComments(projectId).map(commentView);

const clean = (s: unknown, max: number) => String(s ?? '').replace(/\r/g, '').trim().slice(0, max);

export function addComment(projectId: string, userId: string, body: { body?: string; dmFile?: string; anchor?: unknown; releaseId?: string }, kind: 'comment' | 'changes' = 'comment'): number {
  const text = clean(body.body, 4000);
  if (!text) throw bad('A comment cannot be empty.', 'COMMENT_EMPTY');
  const dmFile = clean(body.dmFile, 200) || null;
  if (dmFile && !/^DMC-[A-Za-z0-9._-]+\.xml$/i.test(dmFile)) throw bad('That is not a data module file name.', 'BAD_FILE_NAME');
  return store.addReviewComment({ projectId, releaseId: body.releaseId ?? null, userId, kind, body: text, dmFile, anchor: cleanAnchor(body.anchor, dmFile), now: nowIso() });
}

/** The author marks a comment as dealt with (or reopens it); anyone who can comment may. */
export function setResolved(projectId: string, commentId: number, userId: string, resolved: boolean): void {
  const c = store.getReviewComment(commentId);
  if (!c || c.project_id !== projectId) throw notFound('No such comment.');
  store.setReviewCommentResolved(commentId, resolved ? userId : null, nowIso());
}

export const openComments = (projectId: string): number => store.listReviewComments(projectId).filter((c: Row) => !c.resolved_at).length;
