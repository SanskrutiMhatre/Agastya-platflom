// =============================================================================
// Retention of housekeeping rows (audit WP-12: PLT-007, ENT-015). Dates are ISO strings, compared as text like everywhere in the schema.
//
// Only rows that no longer do anything are removed: sessions that ended (expired or revoked) before the cut-off, notifications READ before it,
// password-reset requests DECIDED before it. Audit rows are read in id order so the caller can write them to an archive file first, and are
// then removed up to the last id it archived - never a row it did not write out.
// =============================================================================

import { SqliteRepository } from './sqliteBase';

export interface RetentionRepository {
  purgeEndedSessions(beforeIso: string): number;
  purgeReadNotifications(beforeIso: string): number;
  purgeDecidedResetRequests(beforeIso: string): number;
  /** Audit rows older than `beforeIso` with id > afterId, oldest first, at most `limit`. */
  auditRowsBefore(beforeIso: string, afterId: number, limit: number): Array<Record<string, unknown> & { id: number }>;
  /** Remove audit rows older than `beforeIso` with id <= maxId (the ones the caller archived). */
  deleteAuditUpTo(beforeIso: string, maxId: number): number;
  /** WP-29: the lowest id of an audit row NOT older than `beforeIso` (null = none). Retention removes only rows before it, so it always
   *  takes a prefix of the chain and never opens a gap in the middle of it. */
  firstAuditIdNotBefore(beforeIso: string): number | null;
  /** WP-29: the last chained row retention removed (after archiving it); the first remaining row of the chain is checked against it. */
  setAuditAnchor(a: { seq: number; row_hash: string; archived_at: string; archive: string | null }): void;
}

const n = (r: { changes: number | bigint }): number => Number(r.changes);

export class SqliteRetentionRepository extends SqliteRepository implements RetentionRepository {
  purgeEndedSessions(beforeIso: string): number {
    return n(this.q('DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR (revoked_at IS NULL AND expires_at < ?)').run(beforeIso, beforeIso));
  }
  purgeReadNotifications(beforeIso: string): number {
    return n(this.q('DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?').run(beforeIso));
  }
  purgeDecidedResetRequests(beforeIso: string): number {
    return n(this.q("DELETE FROM password_reset_requests WHERE status <> 'pending' AND decided_at IS NOT NULL AND decided_at < ?").run(beforeIso));
  }
  auditRowsBefore(beforeIso: string, afterId: number, limit: number): Array<Record<string, unknown> & { id: number }> {
    return this.q('SELECT * FROM audit_log WHERE at < ? AND id > ? ORDER BY id LIMIT ?').all(beforeIso, afterId, limit) as Array<Record<string, unknown> & { id: number }>;
  }
  deleteAuditUpTo(beforeIso: string, maxId: number): number {
    return n(this.q('DELETE FROM audit_log WHERE at < ? AND id <= ?').run(beforeIso, maxId));
  }
  firstAuditIdNotBefore(beforeIso: string): number | null {
    const r = this.q('SELECT MIN(id) AS id FROM audit_log WHERE at >= ?').get(beforeIso) as { id: number | null } | undefined;
    return r && r.id !== null ? Number(r.id) : null;
  }
  setAuditAnchor(a: { seq: number; row_hash: string; archived_at: string; archive: string | null }): void {
    this.q(`INSERT INTO audit_chain_anchor (id, seq, row_hash, archived_at, archive) VALUES (1,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, row_hash = excluded.row_hash, archived_at = excluded.archived_at, archive = excluded.archive`)
      .run(a.seq, a.row_hash, a.archived_at, a.archive);
  }
}
