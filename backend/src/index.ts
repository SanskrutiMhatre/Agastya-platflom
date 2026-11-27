// =============================================================================
// Agastya Platform v2 - server entry point.
// =============================================================================

import { tuneServer, sweepStaleUploads } from './services/uploads';
import http from 'http';
import { config, nowIso } from './config';
import { createApp } from './app';
import { store, audit, workspaceDir, registryDb } from './context';
import { acquireWorkspaceLock, releaseWorkspaceLock } from './services/workspaceLock';
import * as broadcast from './services/broadcast';
import { reconcileRegistry, sweepPendingImports } from './services/projects';
import { startRenderer, stopRenderer, rendererStatus } from './services/publisher';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureBootstrapAdmin } = require('./core/auth/bootstrap');

let server: http.Server | null = null;

export async function start(port: number = config.port): Promise<number> {
  // WP-06 (DEP-017): one server per data folder; a second one stops here naming the owner's process. Test harnesses that start several
  // in-process apps on one workspace on purpose opt out with AGASTYA_NO_WORKSPACE_LOCK=1.
  if (process.env.AGASTYA_NO_WORKSPACE_LOCK !== '1') acquireWorkspaceLock(workspaceDir);
  try { sweepPendingImports(); } catch (e) { console.warn('[start] unfinished imports:', (e as Error).message); }    // REL-004: an import cut off by a crash
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
  releaseWorkspaceLock();
}

/**
 * WP-06 (REL-003): a clean stop. New connections are refused at once; requests already running (a long build, a large upload) get up to
 * `graceMs` to finish; then the write-ahead log is checkpointed, the database closed and the data folder given back.
 */
export function shutdownGracefully(graceMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    const s = server; server = null;
    let done = false;
    const finish = (): void => {
      if (done) return; done = true;
      try { stopRenderer(); } catch { /* best effort */ }
      try { registryDb.close(); } catch (e) { console.warn('[stop] database close:', (e as Error).message); }
      releaseWorkspaceLock();
      resolve();
    };
    try { broadcast.close(); } catch { /* best effort */ }
    if (!s) return finish();
    s.close(() => finish());
    s.closeIdleConnections?.();                     // keep-alive sockets with nothing running must not hold the stop
    setTimeout(() => { console.warn('[stop] requests still running after the grace period; stopping anyway'); s.closeAllConnections?.(); finish(); }, graceMs).unref();
  });
}

if (require.main === module) {
  start().catch((e) => { console.error('Failed to start:', e); process.exit(1); });
  let stopping = false;
  const shutdown = (sig: string): void => {
    if (stopping) return; stopping = true;
    console.log(`\n${sig} - shutting down`);
    void shutdownGracefully().then(() => process.exit(0));
  };
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
