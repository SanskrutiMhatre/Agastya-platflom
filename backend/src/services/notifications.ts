// =============================================================================
// Notifications - a per-user inbox written when something happens that a
// person needs to know about (an approval to decide, a decision, a change in
// their access). Rows are private: every read and write is scoped to the
// signed-in user's id.
// =============================================================================

import { store } from '../context';
import { nowIso } from '../config';

type Row = Record<string, any>;

export type NoteKind =
  | 'approval.requested' | 'approval.approved' | 'approval.rejected' | 'approval.withdrawn'
  | 'access.granted' | 'access.changed' | 'access.removed' | 'access.shared'
  | 'account.created' | 'project.created'
  | 'review.submitted' | 'review.resubmitted' | 'review.changes_requested' | 'review.comment'
  | 'cir.update';

export interface Note { kind: NoteKind; title: string; body?: string; projectId?: string | null; actorId?: string | null }

/** Put one notification in each recipient's inbox. Never throws: a failed notification must not undo the action it reports. */
export function notify(recipients: Array<string | null | undefined>, n: Note): void {
  try {
    const seen = new Set<string>();
    for (const id of recipients) {
      if (!id || id === n.actorId || seen.has(id)) continue;      // nobody is notified about their own action
      seen.add(id);
      store.insertNotification({ userId: id, kind: n.kind, title: n.title, body: n.body ?? null, projectId: n.projectId ?? null, actorId: n.actorId ?? null, now: nowIso() });
    }
  } catch (e) { console.error('[notify] failed (action unaffected):', (e as Error).message); }
}

export const adminIds = (): string[] => store.listUsers().filter((u: Row) => u.role === 'admin' && !u.disabled_at).map((u: Row) => u.id);

/** The Project Managers who decide for a project (manager/owner role on a project_manager account). */
export function managersOf(projectId: string): string[] {
  return store.listMembers(projectId)
    .filter((m: Row) => m.global_role === 'project_manager' && (m.role === 'manager' || m.role === 'owner') && !m.disabled_at)
    .map((m: Row) => m.user_id);
}

/** Who should hear about a release request: the project's managers, or the administrators when it has none. */
export const approversOf = (projectId: string): string[] => { const m = managersOf(projectId); return m.length ? m : adminIds(); };

export const list = (userId: string, limit = 100) => ({
  unread: store.countUnreadNotifications(userId) as number,
  items: store.listNotifications(userId, limit).map((r: Row) => ({
    id: r.id, kind: r.kind, title: r.title, body: r.body, projectId: r.project_id, at: r.created_at, read: !!r.read_at,
  })),
});
