// =============================================================================
// The audit trail's reading side (audit WP-29: ENT-003, ENT-017). Rows are WRITTEN by the AuthStore (core/auth/store.js appendAudit, which
// computes the chain); this repository reads them for verification and export, keeps the checkpoints and the retention anchor, and holds
// the append-only history of publication-gate waivers.
// =============================================================================

import { SqliteRepository } from './sqliteBase';

export type AuditRow = Record<string, unknown> & { id: number };
/** `from` and `to` are inclusive ISO instants (the viewer sends the end of the day for a date). */
export interface AuditFilter { action?: string | null; actor?: string | null; project?: string | null; from?: string | null; to?: string | null }
export interface AuditCheckpoint { id?: number; at: string; seq: number; row_hash: string; chain_key: string; reason: string; signature: string }
export interface AuditAnchor { seq: number; row_hash: string; archived_at: string; archive: string | null }
export interface WaiverEvent {
  id?: number; project_id: string; waiver_id: string; event: 'added' | 'removed' | 'replaced' | 'expired'; kind: string; subject: string;
  reason: string | null; expires_at: string | null; actor: string | null; at: string;
}

export interface AuditRepository {
  /** Chained rows with seq > afterSeq, in seq order, at most `limit`. */
  chainedAfter(afterSeq: number, limit: number): AuditRow[];
  /** The first chained row (lowest seq), or null when no row is chained yet. */
  firstChained(): { id: number; seq: number } | null;
  /** Rows without a sequence number: those before the first chained row (written before the chain existed) and those after it (inserted around the chain). */
  unchained(firstChainedId: number | null, limit: number): { before: number; after: number; afterIds: number[] };
  /** The chained row at a sequence number, or null. */
  rowAtSeq(seq: number): AuditRow | null;
  anchor(): AuditAnchor | null;
  insertCheckpoint(cp: AuditCheckpoint): number;
  checkpoints(limit: number): AuditCheckpoint[];
  /** Rows matching the filter with id > afterId, oldest first, at most `limit` (the streamed export). */
  page(filter: AuditFilter, afterId: number, limit: number): AuditRow[];
  count(filter: AuditFilter): number;
  /** Rows per action name, newest first (the coverage view and the support bundle carry names only). */
  actionCounts(): Array<{ action: string; n: number }>;
  insertWaiverEvent(e: WaiverEvent): void;
  waiverEvents(projectId: string, limit: number): WaiverEvent[];
}

function whereOf(f: AuditFilter): { sql: string; args: Array<string | number> } {
  const where: string[] = []; const args: Array<string | number> = [];
  if (f.action) { where.push("action LIKE ? ESCAPE '\\'"); args.push(String(f.action).replace(/[%_\\]/g, '\\$&') + '%'); }
  if (f.actor) { where.push('actor_username = ? COLLATE NOCASE'); args.push(String(f.actor)); }
  if (f.project) { where.push('project_id = ?'); args.push(String(f.project)); }
  if (f.from) { where.push('at >= ?'); args.push(String(f.from)); }
  if (f.to) { where.push('at <= ?'); args.push(String(f.to)); }
  return { sql: where.length ? ` AND ${where.join(' AND ')}` : '', args };
}

export class SqliteAuditRepository extends SqliteRepository implements AuditRepository {
  chainedAfter(afterSeq: number, limit: number): AuditRow[] {
    return this.q('SELECT * FROM audit_log WHERE seq IS NOT NULL AND seq > ? ORDER BY seq LIMIT ?').all(afterSeq, limit) as AuditRow[];
  }
  firstChained(): { id: number; seq: number } | null {
    const r = this.q('SELECT id, seq FROM audit_log WHERE seq IS NOT NULL ORDER BY seq LIMIT 1').get() as { id: number; seq: number } | undefined;
    return r ? { id: Number(r.id), seq: Number(r.seq) } : null;
  }
  unchained(firstChainedId: number | null, limit: number): { before: number; after: number; afterIds: number[] } {
    if (firstChainedId === null) {
      const all = this.q('SELECT COUNT(*) AS n FROM audit_log WHERE seq IS NULL').get() as { n: number };
      return { before: Number(all.n), after: 0, afterIds: [] };
    }
    const before = this.q('SELECT COUNT(*) AS n FROM audit_log WHERE seq IS NULL AND id < ?').get(firstChainedId) as { n: number };
    const after = this.q('SELECT COUNT(*) AS n FROM audit_log WHERE seq IS NULL AND id > ?').get(firstChainedId) as { n: number };
    const ids = this.q('SELECT id FROM audit_log WHERE seq IS NULL AND id > ? ORDER BY id LIMIT ?').all(firstChainedId, limit) as Array<{ id: number }>;
    return { before: Number(before.n), after: Number(after.n), afterIds: ids.map((r) => Number(r.id)) };
  }
  rowAtSeq(seq: number): AuditRow | null {
    return (this.q('SELECT * FROM audit_log WHERE seq = ?').get(seq) as AuditRow | undefined) ?? null;
  }
  anchor(): AuditAnchor | null {
    const r = this.q('SELECT seq, row_hash, archived_at, archive FROM audit_chain_anchor WHERE id = 1').get() as AuditAnchor | undefined;
    return r ? { seq: Number(r.seq), row_hash: String(r.row_hash), archived_at: String(r.archived_at), archive: r.archive ?? null } : null;
  }
  insertCheckpoint(cp: AuditCheckpoint): number {
    const r = this.q('INSERT INTO audit_checkpoints (at, seq, row_hash, chain_key, reason, signature) VALUES (?,?,?,?,?,?)')
      .run(cp.at, cp.seq, cp.row_hash, cp.chain_key, cp.reason, cp.signature);
    return Number(r.lastInsertRowid);
  }
  checkpoints(limit: number): AuditCheckpoint[] {
    return this.q('SELECT * FROM audit_checkpoints ORDER BY id DESC LIMIT ?').all(limit) as unknown as AuditCheckpoint[];
  }
  page(filter: AuditFilter, afterId: number, limit: number): AuditRow[] {
    const w = whereOf(filter);
    return this.q(`SELECT * FROM audit_log WHERE id > ?${w.sql} ORDER BY id LIMIT ?`).all(afterId, ...w.args, limit) as AuditRow[];
  }
  count(filter: AuditFilter): number {
    const w = whereOf(filter);
    return Number((this.q(`SELECT COUNT(*) AS n FROM audit_log WHERE 1 = 1${w.sql}`).get(...w.args) as { n: number }).n);
  }
  actionCounts(): Array<{ action: string; n: number }> {
    return (this.q('SELECT action, COUNT(*) AS n FROM audit_log GROUP BY action ORDER BY MAX(id) DESC').all() as Array<{ action: string; n: number }>)
      .map((r) => ({ action: String(r.action), n: Number(r.n) }));
  }
  insertWaiverEvent(e: WaiverEvent): void {
    this.q(`INSERT INTO publish_waiver_events (project_id, waiver_id, event, kind, subject, reason, expires_at, actor, at)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(e.project_id, e.waiver_id, e.event, e.kind, e.subject, e.reason, e.expires_at, e.actor, e.at);
  }
  waiverEvents(projectId: string, limit: number): WaiverEvent[] {
    return this.q('SELECT * FROM publish_waiver_events WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(projectId, limit) as unknown as WaiverEvent[];
  }
}
