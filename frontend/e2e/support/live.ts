// Live co-editing (Phase 3) in the specs that test the classic save-by-version flow.
//
// Since Phase 3 every editor opens its document live (a room, changes sent as they are typed, no draft, no PUT, no edit conflict). The
// classic flow still exists: it is what an editor falls back to when the room cannot be joined (contract item C24) - a server started with
// AGASTYA_COLLAB=0 answers every join with DISABLED - and those specs keep testing it, in that situation.
//
// classicOnly(page): this page's joins are answered DISABLED, exactly as such a server answers them (the same frame, made with the shared
// protocol encoder); everything else on the socket (progress, presence) goes through. The rest of the run stays live.

import type { Page, BrowserContext } from '@playwright/test';
import { decode, enc, MSG } from '../../../backend/src/shared/collab/protocol';

export async function classicOnly(target: Page | BrowserContext): Promise<void> {
  await target.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (typeof m !== 'string') {
        const msg = decode(new Uint8Array(m));
        if (msg && msg.type === MSG.JOIN) { ws.send(Buffer.from(enc.error(msg.room, { code: 'DISABLED', message: 'Live editing is switched off on this server.' }))); return; }
      }
      server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
}
