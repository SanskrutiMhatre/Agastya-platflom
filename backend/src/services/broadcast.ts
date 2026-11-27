// =============================================================================
// Broadcast - build progress over WebSocket, to the people who may see it.
//
// Unlike the Agastya V1 broadcaster (receive-only, unauthenticated, and sent
// every project's messages to every client), this one authenticates the upgrade
// from the same session cookie as the HTTP API and delivers a project's
// messages only to users who can read that project. See "Security concerns" in
// the Agastya documentation: an open /ws leaked project ids and error text.
//
// WP-03 (SEC-010, PLT-017, FE-011, ENT-012, PERF-018):
//   * the upgrade obeys the same Origin rule as every state-changing HTTP request;
//   * a connection belongs to one session: when that session ends (sign-out, a newer sign-in, idle or absolute limit,
//     an administrator revoking it, the account disabled), the socket is closed with code 4401 and the reason, so the
//     browser stops reconnecting and can say why; the store announces every such change and a sweep every 30 s catches
//     a session that simply ran out;
//   * whether a user may read a project is decided once and cached per connection (refreshed after 10 s, and at once
//     when the store announces a change for that user), instead of one database lookup per client per message;
//   * backpressure: a client that does not keep up is skipped for progress lines, and closed when it falls far behind.
//
// WP-28 (team server, PRD-003): the socket also carries presence. A page sends { type: 'presence', projectId, doc?, mode? } (services/presence.ts);
// it is accepted only for a project the user can read, at most 4 KB, and at most 20 messages per 10 seconds per connection (more are dropped;
// past 100 in one window the connection is closed with 1008). Readers of a project get { type: 'presence' } when its set of people changes and
// { type: 'leases', ... } when a check-out is taken, given back or broken. Limits: AGASTYA_WS_MAX_CLIENTS connections on the server (503 above
// it) and 8 per session (429): a misbehaving page cannot exhaust the server for the rest of the team.
// =============================================================================

import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { authz, store, sessionsSvc } from '../context';
import { originAllowed } from './origin';
import { hostAllowed } from './network';
import { clientAccepted } from './version';
import { config } from '../config';
import * as presence from './presence';
import { registerGauge } from './metrics';

interface Client { id: number; ws: WebSocket; user: any; sessionId: string; can: Map<string, { ok: boolean; at: number }>; inbox: { start: number; n: number } }

export const WS_CLOSE_SESSION_ENDED = 4401;
const AUTH_CACHE_MS = 10_000;
const SKIP_PROGRESS_BYTES = 1 << 20;    // 1 MB queued: progress lines are skipped for this client
const CLOSE_BACKLOG_BYTES = 8 << 20;    // 8 MB queued: the client is closed (it reconnects and reloads)

export const MAX_SOCKETS_PER_SESSION = 8;
const MAX_INBOUND_BYTES = 4096;
const INBOX_WINDOW_MS = 10_000;
const INBOX_MAX = 20;

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_INBOUND_BYTES });
const clients = new Set<Client>();
let nextId = 1;
let sweep: NodeJS.Timeout | null = null;
let presenceSweep: NodeJS.Timeout | null = null;
let unlisten: (() => void) | null = null;
registerGauge('wsClients', () => clients.size);
registerGauge('presenceEntries', () => presence.size());

/** A connection is gone: forget it, and tell its project when that removed someone from it. */
function forget(c: Client): void {
  const had = clients.delete(c);
  const pid = presence.dropConnection(c.id);
  if (had && pid) announcePresence(pid);
}

function endSession(c: Client, reason: string): void {
  forget(c);
  try { c.ws.close(WS_CLOSE_SESSION_ENDED, reason.slice(0, 120)); } catch { /* already closed */ }
}

/** One message from a page. Only presence is understood; anything else, or too much of it, is dropped. */
function inbound(c: Client, data: unknown): void {
  const now = Date.now();
  if (now - c.inbox.start > INBOX_WINDOW_MS) { c.inbox.start = now; c.inbox.n = 0; }
  if (++c.inbox.n > INBOX_MAX) {
    // a page sends one heartbeat in 25 s: five times the limit in one window is not a page, it is a loop or an attack
    if (c.inbox.n > INBOX_MAX * 5) { forget(c); try { c.ws.close(1008, 'too many messages'); } catch { /* gone */ } }
    return;
  }
  let m: { type?: unknown; projectId?: unknown; doc?: unknown; mode?: unknown } | null;
  try { m = JSON.parse(String(data)); } catch { return; }
  if (!m || typeof m !== 'object' || m.type !== 'presence') return;
  const pid = typeof m.projectId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(m.projectId) ? m.projectId : null;
  if (pid && !mayRead(c, pid)) return;
  const changed = presence.setPresence(c.id, c.user, pid, presence.cleanDoc(m.doc), m.mode === 'editing' ? 'editing' : 'viewing', now);
  for (const p of changed) announcePresence(p);
}

/** Tell a project's readers that its set of people changed (they ask GET /api/projects/:id/presence for the list). */
function announcePresence(projectId: string): void { broadcast(projectId, { type: 'presence' }); }

/** Re-check the connections of `userId` (or of everyone): close those whose session ended, forget cached permissions. */
export function recheck(userId: string | null): void {
  const now = new Date().toISOString();
  for (const c of [...clients]) {
    if (userId && c.user.id !== userId) continue;
    c.can.clear();
    let live = false;
    try { live = store.sessionIsLive(c.sessionId, now); } catch { live = true; /* a busy database is not a revocation */ }
    if (!live) { endSession(c, 'session-ended'); continue; }
    // WP-28: someone who lost access to a project leaves its presence list at once
    const pid = presence.projectOf(c.id);
    if (pid && !mayRead(c, pid)) { presence.dropConnection(c.id); announcePresence(pid); }
  }
}

export function attach(server: HttpServer): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // WP-26: exactly /ws (not any path that starts with it); the same Host, Origin and client-version rules as the HTTP API, in that order.
    const url = new URL(req.url ?? '/', 'http://upgrade.invalid');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const refuse = (status: string): void => { socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    if (!hostAllowed(req.headers.host)) { refuse('421 Misdirected Request'); return; }
    if (!originAllowed(req.headers.origin, req.headers.host)) { refuse('403 Forbidden'); return; }
    if (!clientAccepted(url.searchParams.get('client') ?? undefined)) { refuse('426 Upgrade Required'); return; }
    const auth = authz.authForUpgrade(req);
    if (!auth) {
      const reason = sessionsSvc.endReasonFromCookieHeader(req.headers.cookie || '');
      socket.write(`HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n${reason ? `X-Session-Ended: ${reason}\r\n` : ''}\r\n`);
      socket.destroy();
      return;
    }
    // WP-28: connection limits (the server as a whole, then this session)
    if (clients.size >= config.wsMaxClients) { refuse('503 Service Unavailable'); return; }
    let mine = 0; for (const c of clients) if (c.sessionId === auth.session.id) mine++;
    if (mine >= MAX_SOCKETS_PER_SESSION) { refuse('429 Too Many Requests'); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { id: nextId++, ws, user: auth.user, sessionId: auth.session.id, can: new Map(), inbox: { start: Date.now(), n: 0 } };
      clients.add(client);
      ws.on('message', (data) => inbound(client, data));
      ws.on('close', () => forget(client));
      ws.on('error', () => forget(client));
    });
  });
  if (!unlisten && typeof store.onAccessChanged === 'function') unlisten = store.onAccessChanged((userId: string | null) => recheck(userId));
  if (!sweep) { sweep = setInterval(() => recheck(null), 30_000); sweep.unref(); }
  if (!presenceSweep) { presenceSweep = setInterval(() => { for (const p of presence.expire()) announcePresence(p); }, 15_000); presenceSweep.unref(); }
}

export type BroadcastMessage =
  | { type: 'progress'; message: string; done?: boolean; error?: boolean; file?: string; line?: number; hint?: string; preview?: boolean; jobId?: string }
  | { type: 'reload'; kind?: string; jobId?: string }
  /** WP-28: the people in the project changed; ask GET /api/projects/:id/presence */
  | { type: 'presence' }
  /** WP-28: a check-out was taken (released false) or given back / broken / expired (released true) */
  | { type: 'leases'; path: string; part: string; holder: string | null; released: boolean; broken?: boolean }
  /** WP-14: a job changed state (queued, running, succeeded, failed, cancelled). No `message` field, so a progress pane ignores it. */
  | { type: 'job'; job: Record<string, unknown> };

/**
 * WP-14: in a job worker process there are no sockets; the worker hands every message to its server (services/jobs/worker.ts), which
 * records it in the job's log and sends it here. `setBroadcastSink(null)` restores direct delivery.
 */
let sink: ((projectId: string, msg: BroadcastMessage) => void) | null = null;
export function setBroadcastSink(fn: ((projectId: string, msg: BroadcastMessage) => void) | null): void { sink = fn; }

function mayRead(c: Client, projectId: string): boolean {
  const hit = c.can.get(projectId);
  if (hit && Date.now() - hit.at < AUTH_CACHE_MS) return hit.ok;
  const ok = !!authz.evaluate(c.user, projectId, { minRole: 'viewer', cap: 'project.read' }).ok;
  c.can.set(projectId, { ok, at: Date.now() });
  return ok;
}

/** Send `msg` (tagged with the project id) to every connected user who can read that project. */
export function broadcast(projectId: string, msg: BroadcastMessage): void {
  if (sink) { sink(projectId, msg); return; }
  deliver(projectId, msg);
}

/** Send to the sockets of this process (the server side of a worker's relay calls this directly). */
export function deliver(projectId: string, msg: BroadcastMessage): void {
  const payload = JSON.stringify({ ...msg, projectId });
  for (const c of clients) {
    if (c.ws.readyState !== WebSocket.OPEN) continue;
    if (c.ws.bufferedAmount > CLOSE_BACKLOG_BYTES) { forget(c); try { c.ws.terminate(); } catch { /* gone */ } continue; }
    if (msg.type === 'progress' && !msg.done && !msg.error && c.ws.bufferedAmount > SKIP_PROGRESS_BYTES) continue;
    if (mayRead(c, projectId)) c.ws.send(payload);
  }
}

export function close(): void {
  for (const c of clients) { try { c.ws.close(); } catch { /* already closed */ } }
  clients.clear();
  presence.clear();
  if (sweep) { clearInterval(sweep); sweep = null; }
  if (presenceSweep) { clearInterval(presenceSweep); presenceSweep = null; }
  if (unlisten) { unlisten(); unlisten = null; }
  wss.close();
}
