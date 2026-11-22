// =============================================================================
// Agastya Platform v2 - server entry point.
// =============================================================================

import { tuneServer, sweepStaleUploads } from './services/uploads';
import http from 'http';
import { config, nowIso } from './config';
import { createApp } from './app';
import { store, audit, workspaceDir } from './context';
import * as broadcast from './services/broadcast';
import { reconcileRegistry } from './services/projects';
import { startRenderer, stopRenderer, rendererStatus } from './services/publisher';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureBootstrapAdmin } = require('./core/auth/bootstrap');

let server: http.Server | null = null;

export async function start(port: number = config.port): Promise<number> {
  await reconcileRegistry();
  await ensureBootstrapAdmin({ store, audit, now: () => new Date() });

  const app = createApp();
  startRenderer();

  return new Promise((resolve, reject) => {
    const s = http.createServer(app);
    tuneServer(s);
    try { sweepStaleUploads(); } catch { /* the temp folder is a convenience */ }
    setInterval(() => { try { sweepStaleUploads(); } catch { /* best effort */ } }, 3600_000).unref();     // aborted uploads must not pile up on a server that stays up
    broadcast.attach(s);
    s.on('error', reject);
    const onListening = (): void => {
      server = s;
      const bound = (s.address() as { port: number }).port;
      const r = rendererStatus();
      console.log(`Agastya Platform v2 running on http://localhost:${bound}${config.host ? `  (listening on ${config.host} only)` : ''}`);
      console.log(`  Workspace: ${workspaceDir}`);
      console.log(`  Renderer:  ${r.warm ? 'warm FOP ready' : 'cold (per-request FOP)'}  java=${r.java}`);
      console.log(`  Setup:     ${store.anyAdminExists() ? 'administrator exists' : 'first run - open the app to create the administrator'}  (${nowIso()})`);
      resolve(bound);
    };
    if (config.host) s.listen(port, config.host, onListening);
    else s.listen(port, onListening);
  });
}

export function stop(): void {
  stopRenderer();
  broadcast.close();
  if (server) { server.close(); server = null; }
}

if (require.main === module) {
  start().catch((e) => { console.error('Failed to start:', e); process.exit(1); });
  const shutdown = (sig: string) => { console.log(`\n${sig} - shutting down`); stop(); setTimeout(() => process.exit(0), 500).unref(); };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Windows cannot deliver SIGTERM to a child process, so the packaged launcher (and the Windows service) asks for a clean stop by closing this
  // process's standard input. The server then closes its connections and the warm renderer, and the database is not cut off mid-write.
  if (process.env.AGASTYA_SHUTDOWN_ON_STDIN_CLOSE === '1') {
    process.stdin.on('end', () => shutdown('stdin closed'));
    process.stdin.on('error', () => undefined);
    process.stdin.resume();
  }
}
