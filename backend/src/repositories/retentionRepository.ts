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
}
