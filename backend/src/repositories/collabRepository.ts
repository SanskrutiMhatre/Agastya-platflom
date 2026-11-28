// =============================================================================
// Live co-editing rooms (Phase 3, P3-1): the room record and its Yjs update log (migration 027). Behind an interface like every
// repository (WP-10, PRD-002). The update log is append-only between compactions; `compact` replaces the snapshot and drops the updates
// it covers in one transaction, so a crash in the middle leaves either the old snapshot with its updates or the new one.
// =============================================================================

import { SqliteRepository, sqliteTransaction } from './sqliteBase';

export interface CollabDocRow {
  room: string; project_id: string; kind: string; rel_path: string; epoch: string;
  snapshot: Uint8Array | null; snapshot_seq: number; base_hash: string | null; written_seq: number;
  revision_at: string | null; created_at: string; updated_at: string;
}
export interface CollabUpdateRow { seq: number; data: Uint8Array; user_id: string | null }
export interface CollabUpdateIn { room: string; seq: number; data: Uint8Array; userId: string | null; at: string }

export interface CollabRepository {
  get(room: string): CollabDocRow | null;
  create(r: { room: string; projectId: string; kind: string; relPath: string; epoch: string; snapshot: Uint8Array; baseHash: string; now: string }): void;
  /** The updates of a room after `afterSeq`, in order. */
  updatesAfter(room: string, afterSeq: number): CollabUpdateRow[];
  /** The highest stored seq of a room (0 when none). */
  maxSeq(room: string): number;
  /** Append many updates (of any rooms) in one transaction: one fsync for a batch, not one per keystroke. */
  appendBatch(rows: CollabUpdateIn[]): void;
  /** The file now holds the effect of every update up to `writtenSeq`; its content hash is `baseHash`. */
  markWritten(room: string, writtenSeq: number, baseHash: string, now: string, revisionAt?: string | null): void;
  /** Replace the snapshot by the state at `seq` and drop the updates it covers. */
  compact(room: string, snapshot: Uint8Array, seq: number, now: string): void;
  /** Rooms whose update log holds changes the file does not have yet (the start-up replay). */
  pendingRooms(): string[];
  /** A room's record and updates go (its document was deleted or rebuilt; the next join starts a new epoch). */
  remove(room: string): void;
  /** The rooms of one document path of a project. */
  roomsFor(projectId: string, relPath: string): string[];
}

export class SqliteCollabRepository extends SqliteRepository implements CollabRepository {
  get(room: string): CollabDocRow | null {
    const r = this.q('SELECT * FROM collab_docs WHERE room = ?').get(room) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      room: String(r.room), project_id: String(r.project_id), kind: String(r.kind), rel_path: String(r.rel_path), epoch: String(r.epoch),
      snapshot: r.snapshot ? new Uint8Array(r.snapshot as Uint8Array) : null, snapshot_seq: Number(r.snapshot_seq), base_hash: (r.base_hash as string | null) ?? null,
      written_seq: Number(r.written_seq), revision_at: (r.revision_at as string | null) ?? null, created_at: String(r.created_at), updated_at: String(r.updated_at),
    };
  }
  create(r: { room: string; projectId: string; kind: string; relPath: string; epoch: string; snapshot: Uint8Array; baseHash: string; now: string }): void {
    this.q(`INSERT INTO collab_docs (room, project_id, kind, rel_path, epoch, snapshot, snapshot_seq, base_hash, written_seq, revision_at, created_at, updated_at)
            VALUES (?,?,?,?,?,?,0,?,0,NULL,?,?)`).run(r.room, r.projectId, r.kind, r.relPath, r.epoch, r.snapshot, r.baseHash, r.now, r.now);
  }
  updatesAfter(room: string, afterSeq: number): CollabUpdateRow[] {
    return (this.q('SELECT seq, data, user_id FROM collab_updates WHERE room = ? AND seq > ? ORDER BY seq').all(room, afterSeq) as Array<Record<string, unknown>>)
      .map((r) => ({ seq: Number(r.seq), data: new Uint8Array(r.data as Uint8Array), user_id: (r.user_id as string | null) ?? null }));
  }
  maxSeq(room: string): number {
    const r = this.q('SELECT MAX(seq) AS m FROM collab_updates WHERE room = ?').get(room) as { m: number | bigint | null } | undefined;
    const d = this.q('SELECT snapshot_seq FROM collab_docs WHERE room = ?').get(room) as { snapshot_seq: number | bigint } | undefined;
    return Math.max(Number(r?.m ?? 0), Number(d?.snapshot_seq ?? 0));
  }
  appendBatch(rows: CollabUpdateIn[]): void {
    if (!rows.length) return;
    sqliteTransaction(this.db, () => {
      const ins = this.q('INSERT INTO collab_updates (room, seq, data, user_id, created_at) VALUES (?,?,?,?,?)');
      for (const r of rows) ins.run(r.room, r.seq, r.data, r.userId, r.at);
    });
  }
  markWritten(room: string, writtenSeq: number, baseHash: string, now: string, revisionAt: string | null = null): void {
    if (revisionAt) this.q('UPDATE collab_docs SET written_seq = MAX(written_seq, ?), base_hash = ?, revision_at = ?, updated_at = ? WHERE room = ?').run(writtenSeq, baseHash, revisionAt, now, room);
    else this.q('UPDATE collab_docs SET written_seq = MAX(written_seq, ?), base_hash = ?, updated_at = ? WHERE room = ?').run(writtenSeq, baseHash, now, room);
  }
  compact(room: string, snapshot: Uint8Array, seq: number, now: string): void {
    sqliteTransaction(this.db, () => {
      this.q('UPDATE collab_docs SET snapshot = ?, snapshot_seq = ?, updated_at = ? WHERE room = ?').run(snapshot, seq, now, room);
      this.q('DELETE FROM collab_updates WHERE room = ? AND seq <= ?').run(room, seq);
    });
  }
  pendingRooms(): string[] {
    return (this.q(`SELECT d.room AS room FROM collab_docs d WHERE EXISTS (SELECT 1 FROM collab_updates u WHERE u.room = d.room AND u.seq > d.written_seq) ORDER BY d.room`).all() as Array<{ room: string }>)
      .map((r) => String(r.room));
  }
  remove(room: string): void {
    sqliteTransaction(this.db, () => {
      this.q('DELETE FROM collab_updates WHERE room = ?').run(room);
      this.q('DELETE FROM collab_docs WHERE room = ?').run(room);
    });
  }
  roomsFor(projectId: string, relPath: string): string[] {
    return (this.q('SELECT room FROM collab_docs WHERE project_id = ? AND rel_path = ?').all(projectId, relPath) as Array<{ room: string }>).map((r) => String(r.room));
  }
}
