// =============================================================================
// Live co-editing (Phase 3, P3-1): a room client over the page's one /ws socket (lib/progress.ts).
//
// A LiveRoom holds the Y document of one project document and keeps it in step with the server's room:
//   * JOIN with the state vector it has (and the room's epoch, once known); the server answers with what is missing (SYNC2) and asks for
//     what it lacks (SYNC1), which is answered with one UPDATE. That is also the whole reconnect story: nothing is "resent" by hand.
//   * local changes are coalesced (one frame every 50 ms at most while someone types), held while the socket's send buffer is full
//     (backpressure), numbered, and kept until the server's ACK says they are stored; meanwhile they are also in IndexedDB (pending.ts).
//   * the save state the page shows follows from that: "Saved" (nothing unacknowledged), "Syncing" (sent, not yet stored), "Offline -
//     changes kept locally" (no socket).
//   * awareness (who is here, their cursor) rides on the same socket (y-protocols/awareness).
// The frames are the shared protocol (backend/src/shared/collab/protocol.ts); docs/phase3/COLLAB-CONTRACT.md describes them.
// =============================================================================

import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { enc, decode, MSG, type RoomState, type CollabError, type AwarenessState } from '../../../backend/src/shared/collab/protocol';
import { subscribeBinary, sendBinary, socketBuffered, socketOpen } from '../lib/progress';
import { loadPending, savePending } from './pending';

export type LiveStatus = 'saved' | 'syncing' | 'offline';

/** Origins of Y transactions: changes that came from the server are never sent back to it. */
export const ORIGIN_REMOTE = Symbol('collab-remote');
/** This person's own changes (the binding's edits); Y.UndoManager tracks only these. */
export const ORIGIN_LOCAL = Symbol('collab-local');

const COALESCE_MS = 50;
const HOLD_BUFFERED = 1 << 20;
const MAX_FRAME_UPDATE = 1536 * 1024;          // below the server's 2 MB limit: a merged batch above this is sent as its separate changes
const JOIN_TIMEOUT_MS = 15_000;

export interface LiveRoomEvents {
  /** what this person may do in the room (writable, the lock, the role), on join and whenever it changes */
  state?(s: RoomState): void;
  status?(s: LiveStatus): void;
  error?(e: CollabError): void;
  /** the room's content arrived (first: the first time; reset: the room was rebuilt and the document must be rebuilt from it) */
  synced?(first: boolean, reset: boolean): void;
  /** another person's change or awareness arrived */
  awareness?(): void;
}

const rooms = new Map<string, LiveRoom>();
let unsubscribe: (() => void) | null = null;

function ensureSocket(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeBinary({
    frame: (data) => { const m = decode(data); if (m) rooms.get(m.room)?.onFrame(m); },
    open: () => { for (const r of rooms.values()) r.onOpen(); },
    closed: () => { for (const r of rooms.values()) r.onClosed(); },
  });
}
function releaseSocket(): void { if (!rooms.size && unsubscribe) { unsubscribe(); unsubscribe = null; } }

let seqCounter = 0;

export class LiveRoom {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  state: RoomState | null = null;
  status: LiveStatus = 'offline';
  epoch = '';
  synced = false;
  private outbox: Uint8Array[] = [];
  private sent = new Map<number, Uint8Array>();
  private timer: number | null = null;
  private saveTimer: number | null = null;
  private joinWait: { resolve: () => void; reject: (e: Error) => void; timer: number } | null = null;
  private flushWait = new Map<number, (info: { hash: string | null }) => void>();
  private restored: Uint8Array | null = null;
  private closedForGood = false;

  constructor(readonly name: string, readonly userId: string, private events: LiveRoomEvents = {}) {
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.doc.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== ORIGIN_REMOTE) this.queue(u); });
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === ORIGIN_REMOTE) { this.events.awareness?.(); return; }
      const mine = [...added, ...updated, ...removed].filter((id) => id === this.doc.clientID);
      if (mine.length) this.send(enc.awareness(this.name, awarenessProtocol.encodeAwarenessUpdate(this.awareness, mine)));
    });
  }

  setEvents(e: LiveRoomEvents): void { this.events = e; }

  /** Join the room; resolves once its content is here. Rejects with the server's reason (no access, not a document, not well-formed). */
  async open(): Promise<void> {
    rooms.set(this.name, this);
    ensureSocket();
    const kept = await loadPending(this.userId, this.name);
    if (kept) { this.restored = kept.update; this.epoch = kept.epoch; }
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.joinWait = null; reject(Object.assign(new Error('The live document did not answer.'), { code: 'TIMEOUT' })); }, JOIN_TIMEOUT_MS);
      this.joinWait = { resolve, reject, timer };
      if (socketOpen()) this.onOpen();
    });
  }

  /** The socket is open (again): join with what this page has. */
  onOpen(): void {
    if (this.closedForGood) return;
    // whatever was in flight on the old connection is answered by the server's SYNC1 on this one
    this.sent.clear();
    this.send(enc.join(this.name, this.epoch, Y.encodeStateVector(this.doc)));
    const local = this.awareness.getLocalState();
    if (local) this.send(enc.awareness(this.name, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])));
    this.setStatus(this.outbox.length ? 'syncing' : this.status === 'offline' ? 'syncing' : this.status);
  }

  onClosed(): void { if (!this.closedForGood) this.setStatus('offline'); }

  onFrame(m: NonNullable<ReturnType<typeof decode>>): void {
    switch (m.type) {
      case MSG.STATE: {
        this.state = m.state;
        if (m.state.epoch) this.epoch = m.state.epoch;
        this.events.state?.(m.state);
        return;
      }
      case MSG.SYNC2: {
        const first = !this.synced;
        if (m.reset) {
          // the room was rebuilt (another epoch): what this page holds cannot be merged into it; the binding rebuilds from the room
          this.restored = null;
          this.outbox = []; this.sent.clear();
          void savePending(this.userId, this.name, this.epoch, []);
        }
        Y.applyUpdate(this.doc, m.update, ORIGIN_REMOTE);
        this.synced = true;
        if (this.restored) {
          // changes kept from an earlier visit that never reached the server: given to the room now (a change it has is a no-op)
          const u = this.restored; this.restored = null;
          try { Y.applyUpdate(this.doc, u, ORIGIN_LOCAL); } catch { /* damaged: dropped */ }
        }
        this.events.synced?.(first, m.reset);
        if (this.outbox.length && this.timer === null) this.timer = window.setTimeout(() => this.drain(), 0);
        if (this.joinWait) { window.clearTimeout(this.joinWait.timer); this.joinWait.resolve(); this.joinWait = null; }
        this.refreshStatus();
        return;
      }
      case MSG.SYNC1: {
        this.outbox = [];                                    // the answer below holds every change the server lacks, queued ones too
        const diff = Y.encodeStateAsUpdate(this.doc, m.sv);
        if (diff.length > 2) this.sendUpdate(diff);
        this.refreshStatus();
        return;
      }
      case MSG.REMOTE: Y.applyUpdate(this.doc, m.update, ORIGIN_REMOTE); return;
      case MSG.ACK: {
        for (const s of [...this.sent.keys()]) if (s <= m.seq) this.sent.delete(s);
        this.persistSoon();
        this.refreshStatus();
        return;
      }
      case MSG.AWARE: awarenessProtocol.applyAwarenessUpdate(this.awareness, m.update, ORIGIN_REMOTE); return;
      case MSG.ERROR: {
        if (this.joinWait && !this.synced) {
          window.clearTimeout(this.joinWait.timer);
          this.joinWait.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
          this.joinWait = null;
          return;
        }
        // a refused change: it is not in the room; it stays acknowledged-never, and the binding takes the room's version back
        if (m.error.seq !== undefined) this.sent.delete(m.error.seq);
        this.events.error?.(m.error);
        this.refreshStatus();
        return;
      }
      case MSG.FLUSHED: { const w = this.flushWait.get(m.seq); if (w) { this.flushWait.delete(m.seq); w(m.info); } return; }
      default: return;
    }
  }

  // ------------------------------------------------------------- sending

  private queue(u: Uint8Array): void {
    this.outbox.push(u);
    this.setStatus(socketOpen() ? 'syncing' : 'offline');
    this.persistSoon();
    if (this.timer === null) this.timer = window.setTimeout(() => this.drain(), COALESCE_MS);
  }

  private drain(): void {
    this.timer = null;
    if (!this.outbox.length) return;
    if (!socketOpen() || !this.synced) return;              // kept; the join after the next open sends everything the server lacks
    if (socketBuffered() > HOLD_BUFFERED) { this.timer = window.setTimeout(() => this.drain(), 100); return; }
    const batch = this.outbox; this.outbox = [];
    const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
    if (merged.length <= MAX_FRAME_UPDATE) this.sendUpdate(merged);
    else for (const u of batch) this.sendUpdate(u);
  }

  private sendUpdate(u: Uint8Array): void {
    const seq = ++seqCounter;
    this.sent.set(seq, u);
    this.send(enc.update(this.name, seq, u));
  }

  private send(frame: Uint8Array): void { sendBinary(frame); }

  /** Keep what is not acknowledged in IndexedDB (debounced: one write per quarter second while typing). */
  private persistSoon(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void savePending(this.userId, this.name, this.epoch, [...this.sent.values(), ...this.outbox]);
    }, 250);
  }

  /** Changes this page made that the server has not acknowledged (sent or not). */
  get unacknowledged(): number { return this.sent.size + this.outbox.length; }

  private refreshStatus(): void {
    if (!socketOpen()) this.setStatus('offline');
    else this.setStatus(this.unacknowledged || !this.synced ? 'syncing' : 'saved');
  }

  private setStatus(s: LiveStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.events.status?.(s);
  }

  /** Save: everything sent now, then the server writes the file and (revision) cuts a history entry. Resolves with the file's hash. */
  async flush(revision = true): Promise<{ hash: string | null }> {
    if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; }
    this.drain();
    const seq = ++seqCounter;
    return new Promise((resolve, reject) => {
      const t = window.setTimeout(() => { this.flushWait.delete(seq); reject(new Error('The server did not confirm the save.')); }, 20_000);
      this.flushWait.set(seq, (info) => { window.clearTimeout(t); resolve(info); });
      if (!socketOpen()) { window.clearTimeout(t); this.flushWait.delete(seq); reject(new Error('Offline: your changes are kept in this browser and are sent when the connection is back.')); return; }
      this.send(enc.flush(this.name, seq, revision));
    });
  }

  /** Publish this person's presence (null: none). */
  setPresence(state: AwarenessState | null): void { this.awareness.setLocalState(state); }

  /** Forget this page's unacknowledged changes (they were refused: the room's version is the one to keep) and leave. */
  discard(): void {
    this.outbox = []; this.sent.clear(); this.restored = null;
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    void savePending(this.userId, this.name, this.epoch, []);
    this.close(false);
  }

  /** Leave the room (the document was closed). Unacknowledged changes stay in IndexedDB for the next open. */
  close(keep = true): void {
    if (this.closedForGood) return;
    if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; this.drain(); }
    if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (keep) void savePending(this.userId, this.name, this.epoch, [...this.sent.values(), ...this.outbox]);
    this.closedForGood = true;
    this.send(enc.leave(this.name));
    if (rooms.get(this.name) === this) rooms.delete(this.name);
    this.awareness.destroy();
    this.doc.destroy();
    releaseSocket();
  }
}
