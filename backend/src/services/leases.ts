// =============================================================================
// Check-out leases (audit WP-11: ENT-016, DEP-016, RES-001; decision D22).
//
// An author checks out a data module, or one part of a JSS book (a chapter) or of a JSG document (a section, plate or appendix). The lease
// lasts `leaseMinutes` (default 60) and is renewed by checking out again; it expires on its own, so a closed laptop never blocks a team.
// While it runs, a save by anyone else that changes what it covers is refused (423 CHECKED_OUT, naming the holder). A project owner, a
// manager or an administrator may break a lease; the route records that in the audit log. Part '' is the whole document: it excludes
// every part lease of other users, and a part lease excludes another user's whole-document lease.
//
// Leases are on top of the version guard, not instead of it: a save without a lease still needs the right baseHash.
// =============================================================================

import { config, nowIso } from '../config';
import { repos } from '../context';
import { HttpError, notFound } from './http';
import { documentIdOf } from './projectFiles';
import type { LeaseRow } from '../repositories';

export interface LeaseActor { id: string; username?: string }
export interface LeaseView { part: string; holderId: string; holder: string | null; acquiredAt: string; expiresAt: string; mine: boolean }

const view = (r: LeaseRow, me: string | null): LeaseView => ({ part: r.part, holderId: r.user_id, holder: r.username, acquiredAt: r.acquired_at, expiresAt: r.expires_at, mine: r.user_id === me });
const live = (r: LeaseRow, now: string): boolean => r.expires_at > now;

export const checkedOut = (r: LeaseRow): HttpError => new HttpError(423,
  `${r.part ? `This part (${r.part})` : 'This document'} is checked out by ${r.username ?? 'another author'} until ${r.expires_at}. Ask them to check it in, or ask a project owner to break the check-out.`,
  'CHECKED_OUT', { holder: r.username, holderId: r.user_id, part: r.part, expiresAt: r.expires_at });

async function docId(projectId: string, rel: string): Promise<string> {
  const id = await documentIdOf(projectId, rel);
  if (!id) throw notFound('No such document.');
  return id;
}

/** The unexpired leases on one document. */
export async function leasesOf(projectId: string, rel: string, me: string | null): Promise<LeaseView[]> {
  const id = await documentIdOf(projectId, rel); const now = nowIso();
  return id ? repos.leases.listForDocument(id).filter((r) => live(r, now)).map((r) => view(r, me)) : [];
}

/** Check out (or renew one's own check-out of) a document or a part of it. 423 when another author holds it, or holds what overlaps it. */
export async function checkOut(projectId: string, rel: string, part: string, actor: LeaseActor, minutes = config.leaseMinutes): Promise<LeaseView> {
  const id = await docId(projectId, rel); const now = nowIso();
  const others = repos.leases.listForDocument(id).filter((r) => live(r, now) && r.user_id !== actor.id);
  const clash = others.find((r) => r.part === part || r.part === '' || part === '');
  if (clash) throw checkedOut(clash);
  const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
  if (!repos.leases.acquire({ documentId: id, part, projectId, userId: actor.id, username: actor.username ?? null, now, expiresAt })) {
    const holder = repos.leases.get(id, part);
    if (holder) throw checkedOut(holder);
  }
  return view(repos.leases.get(id, part) as LeaseRow, actor.id);
}

/** Check in. `breakIt`: remove another author's lease (the route allows it to owners, managers and administrators). */
/**
 * `inTx` (WP-29): runs the release in one transaction with its audit row - the routes pass auditedTx for a BREAK, so a break whose audit
 * row cannot be written does not happen (fail closed).
 */
export interface CheckInResult { released: boolean; holder: string | null }
export async function checkIn(projectId: string, rel: string, part: string, actor: LeaseActor, breakIt = false,
  inTx?: (fn: () => CheckInResult) => CheckInResult): Promise<CheckInResult> {
  const id = await docId(projectId, rel);
  const run = (): CheckInResult => {
    const row = repos.leases.get(id, part);
    if (!row) return { released: false, holder: null };
    if (row.user_id !== actor.id && !breakIt && live(row, nowIso())) throw checkedOut(row);
    return { released: repos.leases.release(id, part, row.user_id === actor.id || breakIt ? null : actor.id), holder: row.username };
  };
  return inTx ? inTx(run) : run();
}

/**
 * Refuse a save by `actor` when another author's live lease covers it: the whole document, or one of `parts` (the parts this save changes).
 * `parts` undefined = the save changes the document as a whole (a data module), so every lease of another author refuses it.
 */
export async function assertNotLeasedByOther(projectId: string, rel: string, actor: LeaseActor, parts?: string[]): Promise<void> {
  const id = await documentIdOf(projectId, rel);
  if (!id) return;
  const now = nowIso();
  for (const r of repos.leases.listForDocument(id)) {
    if (!live(r, now) || r.user_id === actor.id) continue;
    if (parts === undefined || r.part === '' || parts.includes(r.part)) throw checkedOut(r);
  }
}

/** The live leases of a project, for the file tree and the editors. */
export function projectLeases(projectId: string, me: string | null): Array<LeaseView & { documentId: string }> {
  return repos.leases.listActive(projectId, nowIso()).map((r) => ({ ...view(r, me), documentId: r.document_id }));
}
