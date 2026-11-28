// =============================================================================
// Live co-editing rooms (Phase 3, P3-1, P3-2): one Y document per project document, served over the platform's /ws socket.
//
// A room is loaded when its first member joins and unloaded after it has been empty for `idleUnloadMs` (written back first). While it is
// loaded it holds the merged Y document, the awareness of its members (who is there, their cursors) and the state of its file:
//
//   * every change a member sends is authorised (role, capability, check-out, review lock, locked document), merged, sent on to the other
//     members (coalesced per member, with backpressure) and appended to the update log in the database in batches (one transaction every
//     `persistMs`, never one fsync per keystroke). The sender gets ACK(seq) once the change is stored: that is when its page says "Saved".
//   * the log is the source until the file has the change: `writeBackMs` after the last change (at the latest `writeBackMaxMs` after the
//     first unwritten one) the document is serialised in the Studio's form and written to the project file through the atomic write;
//     every `revisionMinutes`, on Save, when the room closes and at server stop the write also cuts a revision in the history.
//   * a change to the file that did not come from the room (an import, a conversion, a restore, a save by version, a later git pull) is
//     merged into the room as the difference between the file the room last wrote and the file now (a three-way merge: the people in the
//     room keep their unwritten edits) and reaches them like any other change.
//   * a server that stops or crashes loses nothing that was acknowledged: the next start replays the log after `written_seq` and writes
//     the file.
// =============================================================================

import fs from 'fs';
import crypto from 'crypto';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';
import type { WebSocket } from 'ws';
import { config, nowIso } from '../../config';
import { authz, repos, content, audit, store } from '../../context';
import { enc, decode, MSG, parseRoom, type RoomState, type CollabError, type Decoded } from '../../shared/collab/protocol';
import { formatOf, type CollabFormat } from './formats';
import { sha256, NotWellFormedError } from './xml';
import { withDocumentLock } from '../projectFiles';
import { registerGauge } from '../metrics';
import { documentIdOf } from '../projectFiles';
import { onContentWrite } from '../../storage/contentStore';
import { setCollabHooks } from '../broadcast';
import { releaseSources, onReleaseChange } from '../release';
import { onFilesChangedExternally, type FilesChangedExternally } from '../externalChanges';

// ---------------------------------------------------------------- connections and members

export interface CollabConnection { id: number; ws: WebSocket; user: { id: string; username: string; role?: string; full_name?: string | null; fullName?: string | null }; sessionId: string }

interface Access {
  writable: boolean; code: string | null; reason: string | null; role: string; canComment: boolean;
  lock: RoomState['lock']; at: number;
}

interface Member {
  conn: CollabConnection; room: Room; access: Access;
  /** awareness client ids this member speaks for */
  clientIds: Set<number>;
  /** remote updates waiting to be sent (merged into one frame) */
  out: Uint8Array[]; outBytes: number; outTimer: NodeJS.Timeout | null;
  /** client seqs applied but not yet acknowledged (acknowledged after the next persisted batch) */
  unacked: number[];
  lastRenew: number;
}

interface ConnState { conn: CollabConnection; rooms: Map<string, Member>; window: { start: number; n: number; bytes: number } }

const conns = new Map<number, ConnState>();
const rooms = new Map<string, Room>();
const loading = new Map<string, Promise<Room>>();

const SEND_SKIP_BYTES = 1 << 20;      // a member this far behind gets its remote updates held (merged) until its socket drains
const SEND_CLOSE_BYTES = 8 << 20;     // this far behind: closed; it reconnects and syncs from its state vector
const WINDOW_MS = 10_000;
const WINDOW_MAX_MSGS = 600;          // a page batches typing every 50 ms (20/s) and cursor moves; three times that is not a page
const WINDOW_MAX_BYTES = 32 << 20;
const MAX_AWARENESS_BYTES = 16 * 1024;
const ACCESS_TTL_MS = 10_000;
const LEASE_RENEW_MS = 60_000;
const ORIGIN_LOAD = Symbol('collab-load');
const ORIGIN_EXTERNAL = Symbol('collab-external');

const counters = { updates: 0, updateBytes: 0, refused: 0, writeBacks: 0, revisions: 0, externalMerges: 0, persistedBatches: 0, persistedUpdates: 0, closedSlow: 0 };
registerGauge('collabRooms', () => rooms.size);
registerGauge('collabMembers', () => { let n = 0; for (const r of rooms.values()) n += r.members.size; return n; });
registerGauge('collabUpdates', () => counters.updates);
registerGauge('collabRefused', () => counters.refused);
registerGauge('collabWriteBacks', () => counters.writeBacks);

// ---------------------------------------------------------------- persistence (batched)

interface Pending { room: Room; seq: number; data: Uint8Array; userId: string | null; at: string }
let queue: Pending[] = [];
let persistTimer: NodeJS.Timeout | null = null;

/** Store every queued update now (one transaction), then acknowledge what was waiting for it. Never throws. */
export function persistNow(): boolean {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  if (queue.length) {
    const batch = queue;
    try {
      repos.collab.appendBatch(batch.map((p) => ({ room: p.room.name, seq: p.seq, data: p.data, userId: p.userId, at: p.at })));
      queue = [];
      counters.persistedBatches++; counters.persistedUpdates += batch.length;
    } catch (e) {
      // a busy or full database: keep the batch and try again shortly; nothing is acknowledged until it is stored
      console.warn('[collab] storing updates failed, retrying:', (e as Error).message);
      schedulePersist(500);
      return false;
    }
  }
  for (const r of rooms.values()) for (const m of r.members.values()) if (m.unacked.length) {
    const top = Math.max(...m.unacked); m.unacked = [];
    sendTo(m.conn, enc.ack(r.name, top));
  }
  return true;
}
function schedulePersist(ms = config.collab.persistMs): void {
  if (!persistTimer) { persistTimer = setTimeout(() => { persistTimer = null; persistNow(); }, ms); persistTimer.unref?.(); }
}

// ---------------------------------------------------------------- the room

export class Room {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  readonly members = new Map<number, Member>();
  epoch = '';
  seq = 0;
  writtenSeq = 0;
  baseHash = '';
  /** the Y state the file holds (the base of a three-way merge with a changed file) */
  baseState: Uint8Array = new Uint8Array();
  /** the file's size and time when the room last read or wrote it */
  stat: { size: number; mtimeMs: number } | null = null;
  revisionAt = 0;
  /** the document index id of the file (leases name it); null until the file is indexed */
  docId: string | null = null;
  dirtySince = 0;
  lastChange = 0;
  idleSince = Date.now();
  closed: { code: string; reason: string } | null = null;
  /** people whose changes are not in a revision yet; the last one is named as the revision's author */
  contributors = new Map<string, { id: string; username: string }>();
  private writeTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> | null = null;
  /** the hash of the text this room is writing right now (its own write, not an external change) */
  selfWrite: string | null = null;
  /** who changed the file from outside (services/externalChanges: a GitLab pull...), for the merge of exactly that content (its hash) */
  externalBy: { source: string; actor: { id: string; username: string }; hash: string } | null = null;
  updatesSinceCompact = 0;
  bytesSinceCompact = 0;

  constructor(readonly name: string, readonly projectId: string, readonly docPath: string, readonly rel: string, readonly format: CollabFormat) {
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);                       // the server has no cursor
    this.doc.on('update', (u: Uint8Array, origin: unknown) => this.onUpdate(u, origin));
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      if (!changed.length) return;
      const frame = enc.aware(this.name, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      for (const m of this.members.values()) if (m !== origin) sendTo(m.conn, frame);
    });
  }

  get abs(): string { return content.pathOf(this.projectId, this.rel); }

  private onUpdate(u: Uint8Array, origin: unknown): void {
    if (origin === ORIGIN_LOAD) return;
    const from = origin && typeof origin === 'object' && 'conn' in (origin as Member) ? (origin as Member) : null;
    this.seq++;
    queue.push({ room: this, seq: this.seq, data: u, userId: from?.conn.user.id ?? null, at: nowIso() });
    this.updatesSinceCompact++; this.bytesSinceCompact += u.length;
    schedulePersist();
    for (const m of this.members.values()) if (m !== from) queueRemote(m, u);
    if (from) this.contributors.set(from.conn.user.id, { id: from.conn.user.id, username: from.conn.user.username });
    this.lastChange = Date.now();
    if (!this.dirtySince) this.dirtySince = this.lastChange;
    this.scheduleWriteBack();
  }

  private scheduleWriteBack(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    const now = Date.now();
    const wait = Math.max(0, Math.min(config.collab.writeBackMs, this.dirtySince + config.collab.writeBackMaxMs - now));
    this.writeTimer = setTimeout(() => { this.writeTimer = null; void this.writeBack({}).catch(() => undefined); }, wait);
    this.writeTimer.unref?.();
  }

  get dirty(): boolean { return this.seq > this.writtenSeq || this.dirtySince > 0; }

  /**
   * Write the merged document to its file (and, with `revision` or when the last revision is older than `revisionMinutes`, cut a revision).
   * Serialised per room and with the document's write lock (the same lock a save by version takes), so a save and a write-back never
   * interleave. A refused write (an identity clash, a module over the size limit) keeps the room's state and tells its members.
   */
  writeBack(opts: { revision?: boolean; reason?: string }): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.closed) return;
      persistNow();                                                     // the log first: written_seq never runs ahead of what is stored
      await withDocumentLock(`${this.projectId}:${this.rel}`, async () => {
        this.checkFile();                                               // a change to the file not yet seen is merged first
        const text = this.format.fromY(this.doc);
        const hash = sha256(text);
        const seq = this.seq;
        const revision = !!opts.revision || (this.contributors.size > 0 && Date.now() - this.revisionAt >= config.collab.revisionMinutes * 60_000);
        const needsWrite = hash !== this.baseHash;
        const needsRevision = revision && this.contributors.size > 0;
        if (needsWrite || needsRevision) {
          const actor = [...this.contributors.values()].pop() ?? { id: 'system', username: 'system' };
          this.selfWrite = hash;
          try {
            await this.format.writeBack(this.projectId, this.rel, text, actor, needsRevision);
          } catch (e) {
            const err = e as { message?: string; code?: string };
            this.broadcastError({ code: 'WRITE_BACK_REFUSED', message: `Your changes are kept here but were not written to the project file: ${err.message ?? e}` });
            console.warn(`[collab] ${this.name}: write-back refused: ${err.message ?? e}`);
            this.dirtySince = Date.now();
            return;
          } finally { this.selfWrite = null; }
          counters.writeBacks++;
          if (needsRevision) {
            counters.revisions++;
            this.revisionAt = Date.now();
            audit({ actorId: actor.id === 'system' ? null : actor.id, actorUsername: actor.username, action: 'collab.revision', projectId: this.projectId, targetType: 'project', targetId: this.projectId,
              meta: { file: this.docPath, kind: this.format.kind, authors: [...this.contributors.values()].map((c) => c.username), reason: opts.reason ?? 'interval', hash } });
            this.contributors.clear();
          }
        }
        this.baseHash = hash;
        this.baseState = Y.encodeStateAsUpdate(this.doc);
        this.writtenSeq = seq;
        if (this.seq === seq) this.dirtySince = 0;
        this.stat = statOf(this.abs);
        repos.collab.markWritten(this.name, seq, hash, nowIso(), needsRevision ? nowIso() : null);
        this.maybeCompact();
      });
    };
    const prev = this.writing ?? Promise.resolve();
    const next = prev.then(run, run);
    this.writing = next.finally(() => { if (this.writing === next) this.writing = null; });
    return next;
  }

  /** Replace the stored snapshot by the current state once enough updates piled up (only right after a write-back: snapshot_seq <= written_seq). */
  private maybeCompact(force = false): void {
    if (!force && this.updatesSinceCompact < 500 && this.bytesSinceCompact < (1 << 20)) return;
    if (this.writtenSeq !== this.seq) return;
    try { repos.collab.compact(this.name, Y.encodeStateAsUpdate(this.doc), this.seq, nowIso()); this.updatesSinceCompact = 0; this.bytesSinceCompact = 0; } catch (e) { console.warn('[collab] compaction failed:', (e as Error).message); }
  }

  /** Has the file changed since the room last read or wrote it? Then merge the change (called before a write-back and by the poll). */
  checkFile(force = false): void {
    if (this.closed) return;
    const st = statOf(this.abs);
    if (!st) { this.close('GONE', 'This document was deleted or moved.'); return; }
    if (!force && this.stat && st.size === this.stat.size && st.mtimeMs === this.stat.mtimeMs) return;
    let text: string;
    try { text = fs.readFileSync(this.abs, 'utf8'); } catch { return; }
    const hash = sha256(text);
    this.stat = st;
    if (hash === this.baseHash || hash === this.selfWrite) return;
    this.mergeExternal(text, hash);
  }

  /** Merge a changed file into the room: the difference between the file the room last wrote and this one, applied to the live document. */
  mergeExternal(text: string, hash: string): void {
    try {
      const base = new Y.Doc({ gc: false });
      Y.applyUpdate(base, this.baseState, ORIGIN_LOAD);
      const before = Y.encodeStateVector(base);
      this.format.reconcile(base, text, ORIGIN_EXTERNAL);
      const diff = Y.encodeStateAsUpdate(base, before);
      const newBase = Y.encodeStateAsUpdate(base);
      base.destroy();
      Y.applyUpdate(this.doc, diff, ORIGIN_EXTERNAL);
      this.baseState = newBase;
      this.baseHash = hash;
      counters.externalMerges++;
      const by = this.externalBy && this.externalBy.hash === hash ? this.externalBy : null;
      if (by) this.externalBy = null;
      audit({ actorId: by?.actor.id ?? null, actorUsername: by?.actor.username ?? 'system', action: 'collab.external-change', projectId: this.projectId, targetType: 'project', targetId: this.projectId, meta: { file: this.docPath, kind: this.format.kind, hash, ...(by ? { source: by.source } : {}) } });
      // the people in the room had unwritten edits on top: the merged result goes to the file at the next write-back
      if (Y.encodeStateVector(this.doc).length && this.format.fromY(this.doc) !== text) { this.dirtySince = this.dirtySince || Date.now(); this.scheduleWriteBack(); }
    } catch (e) {
      if (e instanceof NotWellFormedError || (e as { code?: string }).code === 'NOT_WELL_FORMED') {
        // the file was replaced with text that is not XML (an import without validation): the room cannot hold it; it closes and the
        // next open edits the file by version, where the author sees the problem
        this.close('NOT_WELL_FORMED', 'The project file of this document was replaced with text that is not well-formed XML. Reopen it to see the problem.');
        try { repos.collab.remove(this.name); } catch { /* best effort */ }
        return;
      }
      console.warn(`[collab] ${this.name}: external change not merged: ${(e as Error).message}`);
    }
  }

  broadcastError(err: CollabError): void {
    const frame = enc.error(this.name, err);
    for (const m of this.members.values()) sendTo(m.conn, frame);
  }

  /** The room ends (its document went, or it can no longer hold the file): members become read-only with the reason. */
  close(code: string, reason: string): void {
    if (this.closed) return;
    this.closed = { code, reason };
    for (const m of this.members.values()) { m.access = { ...m.access, writable: false, code, reason }; sendState(m); }
    if (this.writeTimer) { clearTimeout(this.writeTimer); this.writeTimer = null; }
  }

  destroy(): void {
    if (this.writeTimer) { clearTimeout(this.writeTimer); this.writeTimer = null; }
    this.awareness.destroy();
    this.doc.destroy();
  }
}

const statOf = (abs: string): { size: number; mtimeMs: number } | null => { try { const s = fs.statSync(abs); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } };

// ---------------------------------------------------------------- loading and unloading

class CollabHttpError extends Error { constructor(readonly code: string, message: string) { super(message); } }

/** The room of `name`, loaded (from its log, or from the file the first time) if it is not in memory. */
export function getRoom(name: string): Promise<Room> {
  const have = rooms.get(name);
  if (have && !have.closed) return Promise.resolve(have);
  const busy = loading.get(name);
  if (busy) return busy;
  const p = (async () => {
    if (have?.closed) { rooms.delete(name); have.destroy(); }
    const parsed = parseRoom(name);
    if (!parsed) throw new CollabHttpError('BAD_ROOM', 'That is not a document.');
    const format = formatOf(parsed.kind);
    if (!format) throw new CollabHttpError('NOT_SUPPORTED', 'Live editing is not available for this kind of document yet.');
    let rel: string;
    try { rel = format.resolve(parsed.projectId, parsed.docPath); } catch (e) { throw new CollabHttpError((e as { code?: string }).code ?? 'NOT_FOUND', (e as Error).message); }
    if (rooms.size >= config.collab.maxRooms) unloadIdle(true);
    if (rooms.size >= config.collab.maxRooms) throw new CollabHttpError('BUSY', 'The server holds as many live documents as it may. Try again in a minute.');
    const room = new Room(name, parsed.projectId, parsed.docPath, rel, format);
    try { loadRoom(room); } catch (e) { room.destroy(); throw e; }
    try { room.docId = await documentIdOf(parsed.projectId, rel); } catch { room.docId = null; }
    rooms.set(name, room);
    return room;
  })();
  loading.set(name, p);
  p.then(() => loading.delete(name), () => loading.delete(name));
  return p;
}

function loadRoom(room: Room): void {
  const abs = room.abs;
  const text = fs.readFileSync(abs, 'utf8');
  const diskHash = sha256(text);
  room.stat = statOf(abs);
  const row = repos.collab.get(room.name);
  if (!row) {
    try { room.format.toY(text, room.doc, ORIGIN_LOAD); } catch (e) { throw new CollabHttpError((e as { code?: string }).code ?? 'NOT_WELL_FORMED', (e as Error).message); }
    room.epoch = crypto.randomUUID();
    room.doc.getMap('meta').set('epoch', room.epoch);           // ORIGIN_LOAD is not in this transaction: the epoch is an ordinary first update
    const snapshot = Y.encodeStateAsUpdate(room.doc);
    repos.collab.create({ room: room.name, projectId: room.projectId, kind: room.format.kind, relPath: room.rel, epoch: room.epoch, snapshot, baseHash: diskHash, now: nowIso() });
    // the epoch update above was queued as seq 1; the snapshot already holds it
    queue = queue.filter((q) => q.room !== room);
    room.seq = 0; room.writtenSeq = 0; room.baseHash = diskHash; room.baseState = snapshot; room.dirtySince = 0; room.updatesSinceCompact = 0; room.bytesSinceCompact = 0;
    room.revisionAt = Date.now();
    return;
  }
  room.epoch = row.epoch;
  // the state the file holds: snapshot + updates up to written_seq; then the rest of the log
  if (row.snapshot) Y.applyUpdate(room.doc, row.snapshot, ORIGIN_LOAD);
  const updates = repos.collab.updatesAfter(room.name, row.snapshot_seq);
  let i = 0;
  for (; i < updates.length && updates[i].seq <= row.written_seq; i++) Y.applyUpdate(room.doc, updates[i].data, ORIGIN_LOAD);
  room.baseState = Y.encodeStateAsUpdate(room.doc);
  for (; i < updates.length; i++) Y.applyUpdate(room.doc, updates[i].data, ORIGIN_LOAD);
  room.seq = repos.collab.maxSeq(room.name);
  room.writtenSeq = row.written_seq;
  room.baseHash = row.base_hash ?? '';
  room.revisionAt = row.revision_at ? Date.parse(row.revision_at) : 0;
  room.updatesSinceCompact = updates.length;
  if (room.seq > room.writtenSeq) room.dirtySince = Date.now();
  if (diskHash !== room.baseHash) {
    // a crash after the file was written but before the log said so: the file already holds the room's state
    if (sha256(room.format.fromY(room.doc)) === diskHash) { room.baseHash = diskHash; room.baseState = Y.encodeStateAsUpdate(room.doc); room.writtenSeq = room.seq; room.dirtySince = 0; repos.collab.markWritten(room.name, room.seq, diskHash, nowIso()); }
    else room.mergeExternal(text, diskHash);                       // changed while nobody had it open (an import, a git pull)
  }
}

/** Unload rooms nobody is in (written back first). `pressure`: also those empty for less than the idle time. */
function unloadIdle(pressure = false): void {
  const now = Date.now();
  for (const r of [...rooms.values()]) {
    if (r.members.size) continue;
    if (!pressure && now - r.idleSince < config.collab.idleUnloadMs) continue;
    void unload(r);
  }
}

async function unload(r: Room): Promise<void> {
  if (rooms.get(r.name) !== r) return;
  if (!r.closed && r.dirty) await r.writeBack({ revision: true, reason: 'closed' }).catch(() => undefined);
  else if (!r.closed && r.contributors.size) await r.writeBack({ revision: true, reason: 'closed' }).catch(() => undefined);
  if (r.members.size) return;                                            // someone came back while it was writing
  rooms.delete(r.name);
  r.destroy();
}

// ---------------------------------------------------------------- access

function computeAccess(conn: CollabConnection, room: Room): Access {
  const now = Date.now();
  const read = authz.evaluate(conn.user, room.projectId, { minRole: 'viewer', cap: 'project.read' });
  if (!read.ok) return { writable: false, code: 'FORBIDDEN', reason: 'You no longer have access to this project.', role: 'none', canComment: false, lock: null, at: now };
  const role = String(read.role);
  const canComment = role !== 'viewer' || conn.user.role === 'admin';
  const lock = leaseOf(room, conn.user.id);
  const no = (code: string, reason: string): Access => ({ writable: false, code, reason, role, canComment, lock, at: now });
  if (room.closed) return no(room.closed.code, room.closed.reason);
  const write = authz.evaluate(conn.user, room.projectId, { minRole: room.format.writeRole, cap: room.format.writeCap });
  if (!write.ok) return no('ROLE', role === 'reviewer' ? 'You are reviewing this document: you see every change as it is made and can comment, but not edit.' : 'You can read this document but not change it.');
  if (lock && !lock.mine) return no('CHECKED_OUT', `Locked by ${lock.holder ?? 'another author'}: they checked this document out. You see their changes as they make them and can comment.`);
  const review = inReview(room.projectId, room.rel);
  if (review) return no('IN_REVIEW', review);
  const extra = room.format.readOnly?.(room.projectId, room.rel, room.docPath, conn.user, role);
  if (extra) return no(extra.code, extra.reason);
  return { writable: true, code: null, reason: null, role, canComment, lock, at: now };
}

function leaseOf(room: Room, me: string): RoomState['lock'] {
  if (!room.docId) return null;
  try {
    const now = nowIso();
    const part = room.format.leasePart ?? '';
    const row = repos.leases.listForDocument(room.docId).find((r) => r.expires_at > now && (r.part === '' || part === '' || r.part === part));
    return row ? { holder: row.username, holderId: row.user_id, mine: row.user_id === me, expiresAt: row.expires_at } : null;
  } catch { return null; }
}

// Submitting a manual for release locks its documents while the request is pending (P3-1). The sources of a project are asked for at most
// every 15 seconds (and again at once when a request is made, withdrawn or decided: refreshProject).
const reviewCache = new Map<string, { at: number; pendingSince: string | null; sources: Set<string> }>();
function inReview(projectId: string, rel: string): string | null {
  let c = reviewCache.get(projectId);
  if (!c || Date.now() - c.at > 15_000) {
    let pendingSince: string | null = null; let sources = new Set<string>();
    try {
      const pending = store.pendingRelease(projectId) as { requested_at?: string } | null;
      if (pending) {
        pendingSince = pending.requested_at ?? '';

        sources = new Set(releaseSources(projectId).map((s: string) => s.replace(/\\/g, '/')));
      }
    } catch { /* no release machinery for this project: nothing is in review */ }
    c = { at: Date.now(), pendingSince, sources };
    reviewCache.set(projectId, c);
  }
  if (c.pendingSince === null) return null;
  if (!c.sources.has(rel)) return null;
  return 'This manual was submitted for release: its documents are locked until the Project Manager approves it or sends it back. You can read and comment.';
}

function refreshMember(m: Member, force = false): void {
  const prev = m.access;
  if (!force && Date.now() - prev.at < ACCESS_TTL_MS) return;
  const next = computeAccess(m.conn, m.room);
  m.access = next;
  if (next.writable !== prev.writable || next.code !== prev.code || JSON.stringify(next.lock) !== JSON.stringify(prev.lock) || next.role !== prev.role) sendState(m);
  if (next.code === 'FORBIDDEN') leave(m);
}

/** Recompute who may write in the rooms of one document (a check-out was taken or given back) or of a whole project. */
export function refreshDocument(projectId: string, rel: string | null): void {
  if (rel === null) reviewCache.delete(projectId);
  for (const r of rooms.values()) {
    if (r.projectId !== projectId) continue;
    if (rel !== null && !samePath(r.rel, rel)) continue;
    for (const m of r.members.values()) refreshMember(m, true);
  }
}
const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** A person's access changed (a role, a membership, a session): recheck their memberships at once. */
export function refreshUser(userId: string | null): void {
  for (const r of rooms.values()) for (const m of r.members.values()) if (userId === null || m.conn.user.id === userId) refreshMember(m, true);
}

function stateOf(m: Member): RoomState {
  return { room: m.room.name, epoch: m.room.epoch, writable: m.access.writable, reason: m.access.reason, code: m.access.code, lock: m.access.lock,
    role: m.access.role, canComment: m.access.canComment, hash: m.room.baseHash || null };
}
function sendState(m: Member): void { sendTo(m.conn, enc.state(m.room.name, stateOf(m))); }

// ---------------------------------------------------------------- sending

function sendTo(conn: CollabConnection, frame: Uint8Array): boolean {
  const ws = conn.ws;
  if (ws.readyState !== 1) return false;
  if (ws.bufferedAmount > SEND_CLOSE_BYTES) { counters.closedSlow++; try { ws.terminate(); } catch { /* gone */ } return false; }
  try { ws.send(frame, { binary: true }); return true; } catch { return false; }
}

function queueRemote(m: Member, u: Uint8Array): void {
  m.out.push(u); m.outBytes += u.length;
  if (m.outTimer) return;
  m.outTimer = setTimeout(() => flushRemote(m), 0);
}
function flushRemote(m: Member): void {
  m.outTimer = null;
  if (!m.out.length) return;
  const ws = m.conn.ws;
  if (ws.readyState !== 1) { m.out = []; m.outBytes = 0; return; }
  if (ws.bufferedAmount > SEND_SKIP_BYTES) {
    // backpressure: hold (and merge) until the socket drains; a member that falls far behind is closed by sendTo
    if (m.out.length > 1) m.out = [Y.mergeUpdates(m.out)];
    if (m.outBytes > SEND_CLOSE_BYTES) { counters.closedSlow++; try { ws.terminate(); } catch { /* gone */ } return; }
    m.outTimer = setTimeout(() => flushRemote(m), 50);
    return;
  }
  const u = m.out.length === 1 ? m.out[0] : Y.mergeUpdates(m.out);
  m.out = []; m.outBytes = 0;
  sendTo(m.conn, enc.remote(m.room.name, u));
}

// ---------------------------------------------------------------- messages

/** A connection opened (services/broadcast.ts): it may now join rooms. */
export function connect(conn: CollabConnection): void { conns.set(conn.id, { conn, rooms: new Map(), window: { start: Date.now(), n: 0, bytes: 0 } }); }

/** A connection closed: it leaves every room it was in. */
export function disconnect(connId: number): void {
  const cs = conns.get(connId);
  if (!cs) return;
  conns.delete(connId);
  for (const m of [...cs.rooms.values()]) leave(m);
}

function leave(m: Member): void {
  const r = m.room;
  if (r.members.get(m.conn.id) !== m) return;
  r.members.delete(m.conn.id);
  conns.get(m.conn.id)?.rooms.delete(r.name);
  if (m.outTimer) { clearTimeout(m.outTimer); m.outTimer = null; }
  if (m.clientIds.size) awarenessProtocol.removeAwarenessStates(r.awareness, [...m.clientIds], m);
  if (!r.members.size) { r.idleSince = Date.now(); if (r.dirty) void r.writeBack({ reason: 'left' }).catch(() => undefined); }
}

const errorTo = (conn: CollabConnection, room: string, err: CollabError): void => { sendTo(conn, enc.error(room, err)); };

/** One binary frame from a page. Never throws. */
export async function onMessage(connId: number, data: Uint8Array): Promise<void> {
  const cs = conns.get(connId);
  if (!cs) return;
  const now = Date.now();
  if (now - cs.window.start > WINDOW_MS) cs.window = { start: now, n: 0, bytes: 0 };
  cs.window.n++; cs.window.bytes += data.length;
  if (cs.window.n > WINDOW_MAX_MSGS || cs.window.bytes > WINDOW_MAX_BYTES) {
    counters.refused++;
    if (cs.window.n > WINDOW_MAX_MSGS * 3) { try { cs.conn.ws.close(1008, 'too many messages'); } catch { /* gone */ } }
    return;                                                     // dropped: the page re-sends what was not acknowledged
  }
  const msg = decode(data);
  if (!msg) { counters.refused++; return; }
  try { await handle(cs, msg); } catch (e) { errorTo(cs.conn, msg.room, { code: 'SERVER_ERROR', message: (e as Error).message }); }
}

async function handle(cs: ConnState, msg: Decoded): Promise<void> {
  const conn = cs.conn;
  switch (msg.type) {
    case MSG.JOIN: return join(cs, msg.room, msg.epoch, msg.sv);
    case MSG.LEAVE: { const m = cs.rooms.get(msg.room); if (m) leave(m); return; }
    case MSG.UPDATE: {
      const m = cs.rooms.get(msg.room);
      if (!m) return errorTo(conn, msg.room, { code: 'NOT_JOINED', message: 'Join the document first.', seq: msg.seq });
      if (msg.update.length > config.collab.maxUpdateBytes) { counters.refused++; return errorTo(conn, msg.room, { code: 'TOO_LARGE', message: `That change is larger than ${Math.round(config.collab.maxUpdateBytes / 1048576)} MB. Make it in smaller steps.`, seq: msg.seq }); }
      refreshMember(m);
      if (!m.access.writable) {
        // a reviewer's or viewer's page, or someone else's check-out: refused here whatever the page did (per-message authorisation)
        if (isEmptyUpdate(msg.update)) { m.unacked.push(msg.seq); schedulePersist(); return; }
        counters.refused++;
        return errorTo(conn, msg.room, { code: 'READ_ONLY', message: m.access.reason ?? 'You cannot change this document.', seq: msg.seq });
      }
      try { Y.applyUpdate(m.room.doc, msg.update, m); } catch { counters.refused++; return errorTo(conn, msg.room, { code: 'BAD_UPDATE', message: 'The change could not be read.', seq: msg.seq }); }
      counters.updates++; counters.updateBytes += msg.update.length;
      // a change that depends on one the server does not have yet is held by Yjs: it is acknowledged only once it is part of the document
      const st = m.room.doc.store as unknown as { pendingStructs: unknown; pendingDs: unknown };
      if (!st.pendingStructs && !st.pendingDs) m.unacked.push(msg.seq);
      else sendTo(conn, enc.sync1(m.room.name, Y.encodeStateVector(m.room.doc)));
      schedulePersist();
      renewLease(m);
      return;
    }
    case MSG.AWARENESS: {
      const m = cs.rooms.get(msg.room);
      if (!m || msg.update.length > MAX_AWARENESS_BYTES) return;
      if (!awarenessIsOwn(msg.update, m)) { counters.refused++; return; }
      awarenessProtocol.applyAwarenessUpdate(m.room.awareness, msg.update, m);
      return;
    }
    case MSG.FLUSH: {
      const m = cs.rooms.get(msg.room);
      if (!m) return errorTo(conn, msg.room, { code: 'NOT_JOINED', message: 'Join the document first.' });
      persistNow();
      if (m.access.writable) await m.room.writeBack({ revision: msg.revision, reason: 'save' });
      sendTo(conn, enc.flushed(m.room.name, msg.seq, { hash: m.room.baseHash || null, revision: msg.revision }));
      return;
    }
    default: return;
  }
}

async function join(cs: ConnState, name: string, epoch: string, sv: Uint8Array): Promise<void> {
  const conn = cs.conn;
  if (!config.collab.enabled) return errorTo(conn, name, { code: 'DISABLED', message: 'Live editing is switched off on this server.' });
  const parsed = parseRoom(name);
  if (!parsed) return errorTo(conn, name, { code: 'BAD_ROOM', message: 'That is not a document.' });
  // a person who may not read the project learns nothing about its documents (the same uniform answer as the HTTP API's 404)
  const read = authz.evaluate(conn.user, parsed.projectId, { minRole: 'viewer', cap: 'project.read' });
  if (!read.ok) return errorTo(conn, name, { code: 'NOT_FOUND', message: 'Not found' });
  if (cs.rooms.size >= 32 && !cs.rooms.has(name)) return errorTo(conn, name, { code: 'TOO_MANY_ROOMS', message: 'This page has too many documents open live.' });
  let room: Room;
  try { room = await getRoom(name); } catch (e) { return errorTo(conn, name, { code: (e as { code?: string }).code ?? 'NOT_FOUND', message: (e as Error).message }); }
  if (!conns.has(conn.id)) return;                               // the socket closed while the room loaded
  const old = cs.rooms.get(name);
  if (old) leave(old);
  const m: Member = { conn, room, access: computeAccess(conn, room), clientIds: new Set(), out: [], outBytes: 0, outTimer: null, unacked: [], lastRenew: 0 };
  if (m.access.code === 'FORBIDDEN') return errorTo(conn, name, { code: 'NOT_FOUND', message: 'Not found' });
  room.members.set(conn.id, m);
  cs.rooms.set(name, m);
  sendState(m);
  const reset = !!epoch && epoch !== room.epoch;
  let diff: Uint8Array;
  try { diff = reset || !sv.length ? Y.encodeStateAsUpdate(room.doc) : Y.encodeStateAsUpdate(room.doc, sv); } catch { diff = Y.encodeStateAsUpdate(room.doc); }
  sendTo(conn, enc.sync2(name, diff, reset));
  sendTo(conn, enc.sync1(name, Y.encodeStateVector(room.doc)));
  const others = [...room.awareness.getStates().keys()];
  if (others.length) sendTo(conn, enc.aware(name, awarenessProtocol.encodeAwarenessUpdate(room.awareness, others)));
}

/** An update that changes nothing (a read-only page answering SYNC1 with what it has: nothing). */
function isEmptyUpdate(u: Uint8Array): boolean {
  try { const meta = Y.parseUpdateMeta(u); if (meta.to.size) return false; const d = Y.decodeUpdate(u); return d.ds.clients.size === 0; } catch { return false; }
}

/** Every awareness state in the update is for a client id this member already speaks for (or a new one), and names this member's account. */
function awarenessIsOwn(update: Uint8Array, m: Member): boolean {
  try {
    const d = decoding.createDecoder(update);
    const n = decoding.readVarUint(d);
    if (n > 8) return false;
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const clientId = decoding.readVarUint(d);
      decoding.readVarUint(d);                                    // clock
      const state = JSON.parse(decoding.readVarString(d)) as { user?: { id?: string } } | null;
      for (const r of rooms.values()) {
        const other = r === m.room ? [...r.members.values()].find((x) => x !== m && x.clientIds.has(clientId)) : undefined;
        if (other) return false;                                  // someone else's client id
      }
      if (state !== null && (typeof state !== 'object' || !state.user || state.user.id !== m.conn.user.id)) return false;
      ids.push(clientId);
    }
    for (const id of ids) m.clientIds.add(id);
    return true;
  } catch { return false; }
}

/** The holder of a check-out keeps it while they work (P3-1: the check-out expires after inactivity, not while someone types). */
function renewLease(m: Member): void {
  const lock = m.access.lock;
  if (!lock || !lock.mine || Date.now() - m.lastRenew < LEASE_RENEW_MS) return;
  m.lastRenew = Date.now();
  const id = m.room.docId;
  if (!id) return;
  try {
    const expiresAt = new Date(Date.now() + config.leaseMinutes * 60_000).toISOString();
    repos.leases.acquire({ documentId: id, part: m.room.format.leasePart ?? '', projectId: m.room.projectId, userId: m.conn.user.id, username: m.conn.user.username, now: nowIso(), expiresAt });
    m.access = { ...m.access, lock: { ...lock, expiresAt } };
  } catch { /* the lease stays as it was */ }
}

// ---------------------------------------------------------------- the file watch, the sweep, start-up replay, stop

let sweepTimer: NodeJS.Timeout | null = null;
let unlistenWrites: (() => void) | null = null;
let unlistenRelease: (() => void) | null = null;
let unlistenExternal: (() => void) | null = null;

/** A writer that is not an editor session changed project files (services/externalChanges: the GitLab pull, branch switch, MR merge).
 *  The files are already on disk: every live room of one of them merges the new content now (as one remote change, a minimal diff on top
 *  of the people's unwritten edits, never a reload that drops them), and its members are told who changed it. A deleted file closes its
 *  room. The content-write hook may already have merged the same bytes; then only the notice goes. */
export function onExternalFiles(ev: FilesChangedExternally): void {
  const byPath = new Map(ev.files.map((f) => [f.path.replace(/\\/g, '/').toLowerCase(), f]));
  for (const r of rooms.values()) {
    if (r.projectId !== ev.projectId || r.closed) continue;
    const f = byPath.get(r.rel.replace(/\\/g, '/').toLowerCase());
    if (!f) continue;
    if (f.change === 'deleted' || !f.after) { r.close('GONE', `This document was deleted by ${ev.source} (${ev.actor.username}).`); try { repos.collab.remove(r.name); } catch { /* best effort */ } continue; }
    r.externalBy = { source: ev.source, actor: ev.actor, hash: f.after };
    const after = f.after;
    setImmediate(() => {
      void withDocumentLock(`${r.projectId}:${r.rel}`, () => {
        r.checkFile(true);
        if (r.closed) return;
        if (r.baseHash === after) r.broadcastError({ code: 'EXTERNAL_CHANGE', message: `${ev.source === 'gitlab' ? 'GitLab' : ev.source} (${ev.actor.username}) changed this document; the change is merged into what you see.` });
        if (r.externalBy?.hash === after) r.externalBy = null;
      });
    });
  }
}

/** Start the room service: the file watch, the sweep, and the replay of updates a stop or crash left unwritten. */
export function start(): void {
  setCollabHooks({ connect, disconnect, onMessage, refreshUser, refreshDocument });
  if (!unlistenWrites) {
    unlistenWrites = onContentWrite((projectId, absPath, kind) => {
      for (const r of rooms.values()) {
        if (r.projectId !== projectId || r.closed) continue;
        let mine: string; try { mine = r.abs; } catch { continue; }
        if (mine.toLowerCase() !== absPath.toLowerCase()) continue;
        if (kind === 'remove') { r.close('GONE', 'This document was deleted or moved.'); try { repos.collab.remove(r.name); } catch { /* best effort */ } continue; }
        if (r.selfWrite) continue;                                   // the room's own write-back
        setImmediate(() => { void withDocumentLock(`${r.projectId}:${r.rel}`, () => r.checkFile()); });
      }
    });
  }
  if (!unlistenExternal) unlistenExternal = onFilesChangedExternally(onExternalFiles);
  if (!unlistenRelease) {

    unlistenRelease = onReleaseChange((projectId) => refreshDocument(projectId, null));
  }
  if (!sweepTimer) {
    sweepTimer = setInterval(() => {
      for (const r of rooms.values()) {
        try { r.checkFile(); } catch { /* next round */ }
        for (const m of r.members.values()) refreshMember(m);
        if (r.closed && !r.members.size) { rooms.delete(r.name); r.destroy(); }
      }
      unloadIdle();
    }, 3000);
    sweepTimer.unref?.();
  }
  setImmediate(() => { void replayPending(); });
}

/** Rooms whose log holds changes the file does not have (the server stopped or crashed): write them now. */
export async function replayPending(): Promise<number> {
  let n = 0;
  let names: string[] = [];
  try { names = repos.collab.pendingRooms(); } catch { return 0; }
  for (const name of names) {
    try {
      const r = await getRoom(name);
      await r.writeBack({ revision: true, reason: 'replay' });
      n++;
      if (!r.members.size) await unload(r);
    } catch (e) { console.warn(`[collab] replay of ${name} failed: ${(e as Error).message}`); }
  }
  if (n) console.log(`[collab] wrote ${n} document(s) back from the co-editing log`);
  return n;
}

/** Store everything, write every changed room back, and end every room (a clean stop). */
export async function stop(): Promise<void> {
  setCollabHooks(null);
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  if (unlistenWrites) { unlistenWrites(); unlistenWrites = null; }
  if (unlistenRelease) { unlistenRelease(); unlistenRelease = null; }
  if (unlistenExternal) { unlistenExternal(); unlistenExternal = null; }
  persistNow();
  for (const r of [...rooms.values()]) {
    if (!r.closed && (r.dirty || r.contributors.size)) await r.writeBack({ revision: true, reason: 'server stop' }).catch(() => undefined);
    r.destroy();
  }
  rooms.clear(); conns.clear();
}

/** The synchronous part of a stop: the log is stored (the next start writes the files). */
export function stopSync(): void {
  setCollabHooks(null);
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  if (unlistenWrites) { unlistenWrites(); unlistenWrites = null; }
  if (unlistenRelease) { unlistenRelease(); unlistenRelease = null; }
  if (unlistenExternal) { unlistenExternal(); unlistenExternal = null; }
  persistNow();
  for (const r of rooms.values()) r.destroy();
  rooms.clear(); conns.clear();
}

/** Tests and the metrics page: what is loaded. */
export function inspect(): Array<{ room: string; members: number; seq: number; writtenSeq: number; dirty: boolean; epoch: string }> {
  return [...rooms.values()].map((r) => ({ room: r.name, members: r.members.size, seq: r.seq, writtenSeq: r.writtenSeq, dirty: r.dirty, epoch: r.epoch }));
}
export function roomNamed(name: string): Room | null { return rooms.get(name) ?? null; }
export { counters as collabCounters, ORIGIN_EXTERNAL };
