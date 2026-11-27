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
// =============================================================================

import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { authz, store, sessionsSvc } from '../context';
import { originAllowed } from './origin';

interface Client { ws: WebSocket; user: any; sessionId: string; can: Map<string, { ok: boolean; at: number }> }

export const WS_CLOSE_SESSION_ENDED = 4401;
const AUTH_CACHE_MS = 10_000;
const SKIP_PROGRESS_BYTES = 1 << 20;    // 1 MB queued: progress lines are skipped for this client
const CLOSE_BACKLOG_BYTES = 8 << 20;    // 8 MB queued: the client is closed (it reconnects and reloads)

const wss = new WebSocketServer({ noServer: true });
const clients = new Set<Client>();
let sweep: NodeJS.Timeout | null = null;
let unlisten: (() => void) | null = null;

function endSession(c: Client, reason: string): void {
  clients.delete(c);
  try { c.ws.close(WS_CLOSE_SESSION_ENDED, reason.slice(0, 120)); } catch { /* already closed */ }
}

/** Re-check the connections of `userId` (or of everyone): close those whose session ended, forget cached permissions. */
export function recheck(userId: string | null): void {
  const now = new Date().toISOString();
  for (const c of [...clients]) {
    if (userId && c.user.id !== userId) continue;
    c.can.clear();
    let live = false;
    try { live = store.sessionIsLive(c.sessionId, now); } catch { live = true; /* a busy database is not a revocation */ }
    if (!live) endSession(c, 'session-ended');
  }
}

export function attach(server: HttpServer): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url || !req.url.startsWith('/ws')) { socket.destroy(); return; }
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const auth = authz.authForUpgrade(req);
    if (!auth) {
      const reason = sessionsSvc.endReasonFromCookieHeader(req.headers.cookie || '');
      socket.write(`HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n${reason ? `X-Session-Ended: ${reason}\r\n` : ''}\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, user: auth.user, sessionId: auth.session.id, can: new Map() };
      clients.add(client);
      ws.on('close', () => clients.delete(client));
      ws.on('error', () => clients.delete(client));
    });
  });
  if (!unlisten && typeof store.onAccessChanged === 'function') unlisten = store.onAccessChanged((userId: string | null) => recheck(userId));
  if (!sweep) { sweep = setInterval(() => recheck(null), 30_000); sweep.unref(); }
}

export type BroadcastMessage =
  | { type: 'progress'; message: string; done?: boolean; error?: boolean; file?: string; line?: number; hint?: string; preview?: boolean }
  | { type: 'reload'; kind?: string };

function mayRead(c: Client, projectId: string): boolean {
  const hit = c.can.get(projectId);
  if (hit && Date.now() - hit.at < AUTH_CACHE_MS) return hit.ok;
  const ok = !!authz.evaluate(c.user, projectId, { minRole: 'viewer', cap: 'project.read' }).ok;
  c.can.set(projectId, { ok, at: Date.now() });
  return ok;
}

/** Send `msg` (tagged with the project id) to every connected user who can read that project. */
export function broadcast(projectId: string, msg: BroadcastMessage): void {
  const payload = JSON.stringify({ ...msg, projectId });
  for (const c of clients) {
    if (c.ws.readyState !== WebSocket.OPEN) continue;
    if (c.ws.bufferedAmount > CLOSE_BACKLOG_BYTES) { clients.delete(c); try { c.ws.terminate(); } catch { /* gone */ } continue; }
    if (msg.type === 'progress' && !msg.done && !msg.error && c.ws.bufferedAmount > SKIP_PROGRESS_BYTES) continue;
    if (mayRead(c, projectId)) c.ws.send(payload);
  }
}

export function close(): void {
  for (const c of clients) { try { c.ws.close(); } catch { /* already closed */ } }
  clients.clear();
  if (sweep) { clearInterval(sweep); sweep = null; }
  if (unlisten) { unlisten(); unlisten = null; }
  wss.close();
}
