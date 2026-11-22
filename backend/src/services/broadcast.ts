// =============================================================================
// Broadcast - build progress over WebSocket, to the people who may see it.
//
// Unlike the Agastya V1 broadcaster (receive-only, unauthenticated, and sent
// every project's messages to every client), this one authenticates the upgrade
// from the same session cookie as the HTTP API and delivers a project's
// messages only to users who can read that project. See "Security concerns" in
// the Agastya documentation: an open /ws leaked project ids and error text.
// =============================================================================

import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';
import { authz } from '../context';

interface Client { ws: WebSocket; user: any }

const wss = new WebSocketServer({ noServer: true });
const clients = new Set<Client>();

export function attach(server: HttpServer): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url || !req.url.startsWith('/ws')) { socket.destroy(); return; }
    const auth = authz.authForUpgrade(req);
    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, user: auth.user };
      clients.add(client);
      ws.on('close', () => clients.delete(client));
      ws.on('error', () => clients.delete(client));
    });
  });
}

export type BroadcastMessage =
  | { type: 'progress'; message: string; done?: boolean; error?: boolean; file?: string; line?: number; hint?: string; preview?: boolean }
  | { type: 'reload'; kind?: string };

/** Send `msg` (tagged with the project id) to every connected user who can read that project. */
export function broadcast(projectId: string, msg: BroadcastMessage): void {
  const payload = JSON.stringify({ ...msg, projectId });
  for (const c of clients) {
    if (c.ws.readyState !== WebSocket.OPEN) continue;
    const v = authz.evaluate(c.user, projectId, { minRole: 'viewer', cap: 'project.read' });
    if (v.ok) c.ws.send(payload);
  }
}

export function close(): void {
  for (const c of clients) { try { c.ws.close(); } catch { /* already closed */ } }
  clients.clear();
  wss.close();
}
