// Build progress over the authenticated /ws socket. One shared connection; each
// message is tagged with its project id and the server only sends a project's
// messages to people who can read that project.
//
// Phase 3 (P3-1): the same socket carries live co-editing as binary frames (frontend/src/collab/client.ts). A binary listener also hears
// when the socket opens and closes, so a live document can rejoin and say "Offline - changes kept locally" in between.

import { useEffect, useState } from 'react';
import { signalUnauthorized } from '../api/client';
import { useSession } from '../store/session';
import { CLIENT_VERSION } from './handshake';

/** The server closes a socket whose session ended (sign-out, a newer sign-in, idle or time limit, account disabled) with this code. */
const SESSION_ENDED = 4401;

export interface ProgressMsg {
  type: 'progress' | 'reload' | 'presence' | 'leases' | 'pdf-annotations' | 'comments'; projectId: string;
  /** Phase 3 'pdf-annotations': the PDF (its key in the project), what changed, the thread and its new state (lib/pdfReview.ts) */
  fileKey?: string; change?: 'created' | 'updated' | 'deleted' | 'reanchored'; id?: string; annotation?: unknown; message?: string; done?: boolean; error?: boolean; file?: string; line?: number; hint?: string; preview?: boolean; kind?: string;
  /** WP-28 'leases': the document (path in the project), the part, who held / holds it, and whether it was given back (or broken) */
  path?: string; part?: string; holder?: string | null; released?: boolean; broken?: boolean;
}

type Listener = (m: ProgressMsg) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry = 0;
let wanted = 0;
// WP-28: the last presence this page announced, sent again after a reconnect (the server forgets a connection that closed)
let lastPresence: string | null = null;

/** P3-1: a live co-editing client: binary frames, and the socket opening (again) or closing. */
export interface BinaryListener { frame(data: Uint8Array): void; open(): void; closed(): void }
const binary = new Set<BinaryListener>();

/** Send one binary frame; false when the socket is not open (the caller keeps it and sends it after the next open). */
export function sendBinary(data: Uint8Array): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try { socket.send(data); return true; } catch { return false; }
}
/** Bytes the browser has not sent yet (backpressure: a live client holds its changes while this is large). */
export function socketBuffered(): number { return socket?.bufferedAmount ?? 0; }
export const socketOpen = (): boolean => !!socket && socket.readyState === WebSocket.OPEN;

/** Listen for binary frames; keeps the socket open like subscribe(). */
export function subscribeBinary(l: BinaryListener): () => void {
  binary.add(l); wanted++; connect();
  if (socketOpen()) queueMicrotask(() => l.open());
  return () => { binary.delete(l); wanted--; if (wanted === 0) { socket?.close(); socket = null; } };
}

/** Send a message over the shared socket (WP-28: presence). Kept and sent again when the socket (re)opens. */
export function sendPresence(msg: Record<string, unknown>): void {
  lastPresence = JSON.stringify({ type: 'presence', ...msg });
  if (socket && socket.readyState === WebSocket.OPEN) { try { socket.send(lastPresence); } catch { /* closing */ } }
}

function connect() {
  if (socket || wanted === 0) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // WP-26: the page's version rides on the upgrade (a browser cannot set headers there); a server that no longer accepts it refuses with 426.
  const ws = new WebSocket(`${proto}://${location.host}/ws?client=${encodeURIComponent(CLIENT_VERSION)}`);
  ws.binaryType = 'arraybuffer';
  socket = ws;
  ws.onopen = () => {
    retry = 0; if (lastPresence) { try { ws.send(lastPresence); } catch { /* closing */ } }
    binary.forEach((l) => { try { l.open(); } catch { /* a listener's problem */ } });
  };
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) { const u = new Uint8Array(ev.data); binary.forEach((l) => { try { l.frame(u); } catch { /* a listener's problem */ } }); return; }
    try { const m = JSON.parse(ev.data) as ProgressMsg; listeners.forEach((l) => l(m)); } catch { /* ignore malformed */ }
  };
  ws.onclose = (ev) => {
    if (socket === ws) socket = null;
    binary.forEach((l) => { try { l.closed(); } catch { /* a listener's problem */ } });
    // FE-011: a socket whose session ended is not retried blindly. The session store learns why and shows the sign-in page;
    // signing in again (a new subscribe) reconnects. Nor is a socket retried while nobody is signed in.
    if (ev.code === SESSION_ENDED) { signalUnauthorized(); return; }
    if (useSession.getState().status !== 'authed') return;
    if (wanted > 0) setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
  };
  ws.onerror = () => ws.close();
}

export function subscribe(l: Listener): () => void {
  listeners.add(l); wanted++; connect();
  return () => { listeners.delete(l); wanted--; if (wanted === 0) { socket?.close(); socket = null; } };
}

export interface ProgressState { lines: string[]; failed: ProgressMsg | null; reloadTick: number; clear: () => void }

export function useProgress(projectId: string): ProgressState {
  const [lines, setLines] = useState<string[]>([]);
  const [failed, setFailed] = useState<ProgressMsg | null>(null);
  const [reloadTick, setTick] = useState(0);
  useEffect(() => subscribe((m) => {
    if (m.projectId !== projectId || m.preview || m.type === 'presence' || m.type === 'leases' || m.type === 'pdf-annotations' || m.type === 'comments') return;
    if (m.type === 'reload') { setTick((t) => t + 1); return; }
    if (m.message) setLines((l) => [...l.slice(-199), m.message!]);
    if (m.error) setFailed(m);
  }), [projectId]);
  return { lines, failed, reloadTick, clear: () => { setLines([]); setFailed(null); } };
}
