// =============================================================================
// Release decisions as events, and the release decision as a service other modules may call (Phase 3, P3-5).
//
//   onReleaseApproved / emitReleaseApproved   raised by the approve route (routes/project-content.ts) after the approval is committed;
//                                             the GitLab integration listens (upload the released PDF when the project asks for it).
//   setReleaseDecider / decideReleaseAs       the approve route registers its whole decision (permission, separation of duties, publish
//                                             gate, issuing, audited transaction, notifications) here, so a GitLab merge-request approval
//                                             that counts toward the Agastya approval goes through exactly the same steps.
// This module imports nothing, so neither side creates an import cycle.
// =============================================================================

export interface ReleaseApproved { projectId: string; releaseId: string; actor: { id: string; username: string; role: string } }
type Listener = (ev: ReleaseApproved) => void;
const listeners = new Set<Listener>();

export function onReleaseApproved(fn: Listener): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function emitReleaseApproved(ev: ReleaseApproved): void {
  for (const fn of [...listeners]) { try { fn(ev); } catch (e) { console.error('[release-events] a listener failed:', (e as Error).message); } }
}

/** The approver as the release decision needs it: the account, and its effective role on the project. */
export interface DecidingUser { user: { id: string; username: string; role: string; fullName?: string; full_name?: string }; projectRole: string }
export type ReleaseDecider = (projectId: string, releaseId: string, who: DecidingUser, via: string) => Promise<void>;

let decider: ReleaseDecider | null = null;
export function setReleaseDecider(fn: ReleaseDecider): void { decider = fn; }
/** Approve a pending release as `who` through the approve route's own steps; throws what the route would answer. */
export async function decideReleaseAs(projectId: string, releaseId: string, who: DecidingUser, via: string): Promise<void> {
  if (!decider) throw new Error('The release decision is not registered (the project routes are not loaded).');
  await decider(projectId, releaseId, who, via);
}
