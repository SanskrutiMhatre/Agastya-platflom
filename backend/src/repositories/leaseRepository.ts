// =============================================================================
// Check-out leases (audit WP-11: ENT-016, DEP-016, RES-001; decision D22). Behind an interface like every repository (WP-10, PRD-002).
// A lease is (document, part) -> holder until expires_at. `acquire` is one statement: it takes a free or expired lease, or renews the
// caller's own, and does nothing when someone else holds it - so two authors can never hold the same lease, whatever the timing.
// =============================================================================

import { SqliteRepository } from './sqliteBase';

export interface LeaseRow { document_id: string; part: string; project_id: string; user_id: string; username: string | null; acquired_at: string; renewed_at: string; expires_at: string }

export interface LeaseRepository {
  /** Take (or renew one's own) lease. False when another user holds it and it has not expired at `now`. */
  acquire(l: { documentId: string; part: string; projectId: string; userId: string; username: string | null; now: string; expiresAt: string }): boolean;
  get(documentId: string, part: string): LeaseRow | null;
  /** Every lease row of a document (expired ones included; callers compare expires_at). */
  listForDocument(documentId: string): LeaseRow[];
  /** The unexpired leases of a project. */
  listActive(projectId: string, now: string): LeaseRow[];
  /** Give a lease back: only the holder's when `userId` is given, any holder's when it is null (an owner or administrator breaking it). */
  release(documentId: string, part: string, userId: string | null): boolean;
  /** Drop expired rows. */
  purgeExpired(now: string): number;
}

export class SqliteLeaseRepository extends SqliteRepository implements LeaseRepository {
  acquire(l: { documentId: string; part: string; projectId: string; userId: string; username: string | null; now: string; expiresAt: string }): boolean {
    const r = this.q(`INSERT INTO document_leases (document_id, part, project_id, user_id, username, acquired_at, renewed_at, expires_at)
                      VALUES (?,?,?,?,?,?,?,?)
                      ON CONFLICT(document_id, part) DO UPDATE SET
                        acquired_at = CASE WHEN document_leases.user_id = excluded.user_id AND document_leases.expires_at > excluded.renewed_at THEN document_leases.acquired_at ELSE excluded.acquired_at END,
                        user_id = excluded.user_id, username = excluded.username, project_id = excluded.project_id,
                        renewed_at = excluded.renewed_at, expires_at = excluded.expires_at
                      WHERE document_leases.user_id = excluded.user_id OR document_leases.expires_at <= excluded.renewed_at`)
      .run(l.documentId, l.part, l.projectId, l.userId, l.username, l.now, l.now, l.expiresAt);
    return Number(r.changes) === 1;
  }
  get(documentId: string, part: string): LeaseRow | null {
    return (this.q('SELECT * FROM document_leases WHERE document_id = ? AND part = ?').get(documentId, part) as LeaseRow | undefined) ?? null;
  }
  listForDocument(documentId: string): LeaseRow[] {
    return this.q('SELECT * FROM document_leases WHERE document_id = ? ORDER BY part').all(documentId) as unknown as LeaseRow[];
  }
  listActive(projectId: string, now: string): LeaseRow[] {
    return this.q('SELECT * FROM document_leases WHERE project_id = ? AND expires_at > ? ORDER BY document_id, part').all(projectId, now) as unknown as LeaseRow[];
  }
  release(documentId: string, part: string, userId: string | null): boolean {
    const r = userId === null
      ? this.q('DELETE FROM document_leases WHERE document_id = ? AND part = ?').run(documentId, part)
      : this.q('DELETE FROM document_leases WHERE document_id = ? AND part = ? AND user_id = ?').run(documentId, part, userId);
    return Number(r.changes) === 1;
  }
  purgeExpired(now: string): number { return Number(this.q('DELETE FROM document_leases WHERE expires_at <= ?').run(now).changes); }
}
