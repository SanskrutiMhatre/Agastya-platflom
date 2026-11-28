// =============================================================================
// The live co-editing wire protocol (Phase 3, P3-1): binary frames on the platform's one authenticated /ws socket (the JSON text frames
// of progress, presence and check-out notices are unchanged). ONE definition for the server (services/collab) and the browser
// (frontend/src/collab). Built on Yjs updates and state vectors and on y-protocols' awareness encoding; the framing is ours so that the
// server can authorise every message, acknowledge what it has stored, and say why it refused something.
//
//   frame   = varUint type, varString room, payload
//   room    = "<projectId>/<kind>/<document path>"   e.g. "p-1a2b/dm/DMC-BIKE-A-00-00-00-00A-040A-A_001-00_EN-US.XML"
//
//   client -> server                                     server -> client
//   JOIN      varString epoch, varUint8Array stateVector  STATE    varString JSON RoomState (after a join, and when access changes)
//   LEAVE     -                                          SYNC2    varUint8Array update, varUint reset (1: drop your copy first)
//   UPDATE    varUint seq, varUint8Array update           SYNC1    varUint8Array stateVector (send what I miss as one UPDATE)
//   AWARENESS varUint8Array awarenessUpdate              REMOTE   varUint8Array update (someone else's change, merged)
//   FLUSH     varUint seq, varUint revision (1: also     ACK      varUint seq (every UPDATE up to seq is stored)
//             cut a revision in the history)             AWARE    varUint8Array awarenessUpdate
//                                                        ERROR    varString JSON {code, message, seq?}
//                                                        FLUSHED  varUint seq, varString JSON {hash, revision}
// =============================================================================

import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export const MSG = {
  JOIN: 1, LEAVE: 2, UPDATE: 3, AWARENESS: 4, FLUSH: 5,
  STATE: 10, SYNC2: 11, SYNC1: 12, REMOTE: 13, ACK: 14, AWARE: 15, ERROR: 16, FLUSHED: 17,
} as const;
export type MsgType = (typeof MSG)[keyof typeof MSG];

export const ROOM_KINDS = ['dm', 'jss', 'jsg'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

/** What the server tells a member of a room about it. */
export interface RoomState {
  room: string;
  /** the room's identity: a client holding state of another epoch must drop it (the room was rebuilt from the file) */
  epoch: string;
  /** may this connection change the document now */
  writable: boolean;
  /** why not, in words for the person (null when writable) */
  reason: string | null;
  /** machine form of the reason: ROLE (viewer/reviewer), CHECKED_OUT, IN_REVIEW, LOCKED, LINKED, GONE, ... */
  code: string | null;
  /** the exclusive check-out, when one is held */
  lock: { holder: string | null; holderId: string; mine: boolean; expiresAt: string } | null;
  /** this connection's project role */
  role: string;
  /** may this connection write review comments */
  canComment: boolean;
  /** hash of the XML the server last wrote to (or read from) the file */
  hash: string | null;
}

export interface CollabError { code: string; message: string; seq?: number }

export const ROOM_RE = /^([A-Za-z0-9][\w-]{0,63})\/(dm|jss|jsg)\/([^\u0000-\u001f]{1,300})$/;

export function roomName(projectId: string, kind: RoomKind, docPath: string): string { return `${projectId}/${kind}/${docPath}`; }

export function parseRoom(room: string): { projectId: string; kind: RoomKind; docPath: string } | null {
  const m = ROOM_RE.exec(room);
  if (!m) return null;
  if (m[3].includes('..') || m[3].startsWith('/') || m[3].includes('\\')) return null;
  return { projectId: m[1], kind: m[2] as RoomKind, docPath: m[3] };
}

// ---------------------------------------------------------------- encoding

const frame = (type: MsgType, room: string, body: (e: encoding.Encoder) => void): Uint8Array => {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  encoding.writeVarString(e, room);
  body(e);
  return encoding.toUint8Array(e);
};

export const enc = {
  join: (room: string, epoch: string, sv: Uint8Array) => frame(MSG.JOIN, room, (e) => { encoding.writeVarString(e, epoch); encoding.writeVarUint8Array(e, sv); }),
  leave: (room: string) => frame(MSG.LEAVE, room, () => undefined),
  update: (room: string, seq: number, u: Uint8Array) => frame(MSG.UPDATE, room, (e) => { encoding.writeVarUint(e, seq); encoding.writeVarUint8Array(e, u); }),
  awareness: (room: string, u: Uint8Array) => frame(MSG.AWARENESS, room, (e) => encoding.writeVarUint8Array(e, u)),
  flush: (room: string, seq: number, revision: boolean) => frame(MSG.FLUSH, room, (e) => { encoding.writeVarUint(e, seq); encoding.writeVarUint(e, revision ? 1 : 0); }),
  state: (room: string, s: RoomState) => frame(MSG.STATE, room, (e) => encoding.writeVarString(e, JSON.stringify(s))),
  sync2: (room: string, u: Uint8Array, reset: boolean) => frame(MSG.SYNC2, room, (e) => { encoding.writeVarUint8Array(e, u); encoding.writeVarUint(e, reset ? 1 : 0); }),
  sync1: (room: string, sv: Uint8Array) => frame(MSG.SYNC1, room, (e) => encoding.writeVarUint8Array(e, sv)),
  remote: (room: string, u: Uint8Array) => frame(MSG.REMOTE, room, (e) => encoding.writeVarUint8Array(e, u)),
  ack: (room: string, seq: number) => frame(MSG.ACK, room, (e) => encoding.writeVarUint(e, seq)),
  aware: (room: string, u: Uint8Array) => frame(MSG.AWARE, room, (e) => encoding.writeVarUint8Array(e, u)),
  error: (room: string, err: CollabError) => frame(MSG.ERROR, room, (e) => encoding.writeVarString(e, JSON.stringify(err))),
  flushed: (room: string, seq: number, info: { hash: string | null; revision: boolean }) => frame(MSG.FLUSHED, room, (e) => { encoding.writeVarUint(e, seq); encoding.writeVarString(e, JSON.stringify(info)); }),
};

export type Decoded =
  | { type: typeof MSG.JOIN; room: string; epoch: string; sv: Uint8Array }
  | { type: typeof MSG.LEAVE; room: string }
  | { type: typeof MSG.UPDATE; room: string; seq: number; update: Uint8Array }
  | { type: typeof MSG.AWARENESS; room: string; update: Uint8Array }
  | { type: typeof MSG.FLUSH; room: string; seq: number; revision: boolean }
  | { type: typeof MSG.STATE; room: string; state: RoomState }
  | { type: typeof MSG.SYNC2; room: string; update: Uint8Array; reset: boolean }
  | { type: typeof MSG.SYNC1; room: string; sv: Uint8Array }
  | { type: typeof MSG.REMOTE; room: string; update: Uint8Array }
  | { type: typeof MSG.ACK; room: string; seq: number }
  | { type: typeof MSG.AWARE; room: string; update: Uint8Array }
  | { type: typeof MSG.ERROR; room: string; error: CollabError }
  | { type: typeof MSG.FLUSHED; room: string; seq: number; info: { hash: string | null; revision: boolean } };

/** Decode one frame; null for anything malformed (the server drops it, and counts it against the sender). */
export function decode(buf: Uint8Array): Decoded | null {
  try {
    const d = decoding.createDecoder(buf);
    const type = decoding.readVarUint(d);
    const room = decoding.readVarString(d);
    switch (type) {
      case MSG.JOIN: return { type, room, epoch: decoding.readVarString(d), sv: decoding.readVarUint8Array(d) };
      case MSG.LEAVE: return { type, room };
      case MSG.UPDATE: return { type, room, seq: decoding.readVarUint(d), update: decoding.readVarUint8Array(d) };
      case MSG.AWARENESS: return { type, room, update: decoding.readVarUint8Array(d) };
      case MSG.FLUSH: return { type, room, seq: decoding.readVarUint(d), revision: decoding.readVarUint(d) === 1 };
      case MSG.STATE: return { type, room, state: JSON.parse(decoding.readVarString(d)) as RoomState };
      case MSG.SYNC2: return { type, room, update: decoding.readVarUint8Array(d), reset: decoding.readVarUint(d) === 1 };
      case MSG.SYNC1: return { type, room, sv: decoding.readVarUint8Array(d) };
      case MSG.REMOTE: return { type, room, update: decoding.readVarUint8Array(d) };
      case MSG.ACK: return { type, room, seq: decoding.readVarUint(d) };
      case MSG.AWARE: return { type, room, update: decoding.readVarUint8Array(d) };
      case MSG.ERROR: return { type, room, error: JSON.parse(decoding.readVarString(d)) as CollabError };
      case MSG.FLUSHED: return { type, room, seq: decoding.readVarUint(d), info: JSON.parse(decoding.readVarString(d)) };
      default: return null;
    }
  } catch { return null; }
}

/** Awareness state a client publishes. The server checks `user.id` against the connection's account. */
export interface AwarenessUser { id: string; name: string; color: string }
export interface AwarenessState {
  user: AwarenessUser;
  /** base64 Y relative positions of the selection (anchor and head), or null */
  cursor: { anchor: string; head: string } | null;
  /** 'editing' or 'viewing' (a read-only member) */
  mode?: 'editing' | 'viewing';
}

/** Base64 of bytes, the same in Node and the browser. */
export function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
