// =============================================================================
// Agastya Platform v2 - server entry point.
// =============================================================================

import { tuneServer, sweepStaleUploads } from './services/uploads';
import type http from 'http';
import path from 'path';
import { sweepTempFiles } from './storage/atomicWrite';
import { config, nowIso } from './config';
import { createApp } from './app';
import { store, audit, workspaceDir, registryDb, defaultContext } from './context';
import { startScheduler, stopScheduler } from './services/dataProtection';
import { startDirectorySync } from './services/directorySync';
import { acquireWorkspaceLock, releaseWorkspaceLock } from './services/workspaceLock';
import * as broadcast from './services/broadcast';
import { reconcileRegistry, sweepPendingImports } from './services/projects';
import { startRenderer, stopRenderer, rendererStatus } from './services/publisher';
import { shutdownJobs } from './services/jobs';
import { loadTls, listen, hostCheckFor, setHostCheck, describeNetwork } from './services/network';
import { installLogging } from './services/log';
import { enableHostEventSink } from './services/securityEvents';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureBootstrapAdmin } = require('./core/auth/bootstrap');
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { assertPasswordHashing } from './core/auth/crypto';

let servers: http.Server[] = [];

export async function start(port: number = config.port): Promise<number> {
  // WP-29 (ENT-007, RES-004): every console line becomes a structured log record (JSON on standard output in production, and always JSON
  // in <log dir>/agastya-server.jsonl, rotated); security events also go to the Windows host when it asked for them.
  installLogging(config);
  enableHostEventSink(config.log.eventSink === 'host');
  // WP-13 (ARC-019): Argon2 is required. Without it no stored password can be checked, so the server stops here with the cause instead of
  // starting and refusing every sign-in.
  assertPasswordHashing();
  // WP-26: the certificate is read and checked before anything else (a bad one stops here naming the variable), and the Host rule learns
  // the names in it.
  const material = config.tls ? loadTls(config.tls) : null;
  setHostCheck(hostCheckFor(config, material?.info.altNames ?? []));
  if (material && material.info.daysLeft <= 30) console.warn(`[network] the TLS certificate expires in ${material.info.daysLeft} days (${material.info.validTo}); renew it (docs/OPERATIONS.md)`);
  // WP-06 (DEP-017): one server per data folder; a second one stops here naming the owner's process. Test harnesses that start several
  // in-process apps on one workspace on purpose opt out with AGASTYA_NO_WORKSPACE_LOCK=1.
  if (config.workspaceLock) acquireWorkspaceLock(workspaceDir);
  try { sweepPendingImports(); } catch (e) { console.warn('[start] unfinished imports:', (e as Error).message); }    // REL-004: an import cut off by a crash
  try { const n = sweepTempFiles(path.join(workspaceDir, 'projects')); if (n) console.warn(`[start] removed ${n} temporary file(s) left by interrupted saves`); } catch { /* best effort */ }   // WP-11: a save cut off between write and rename
  await reconcileRegistry();
  await ensureBootstrapAdmin({ store, audit, env: config.initialAdmin, now: () => new Date() });

  const app = createApp();
  // WP-14: builds run in job workers, each with its own bounded JVM; the server keeps a warm one only when jobs run inline
  if (config.jobs.mode === 'inline') startRenderer();

  try { sweepStaleUploads(); } catch { /* the temp folder is a convenience */ }
  setInterval(() => { try { sweepStaleUploads(); } catch { /* best effort */ } }, 3600_000).unref();     // aborted uploads must not pile up on a server that stays up
  startScheduler(defaultContext());   // WP-12: scheduled backup, weekly restore test, retention (first run 10 minutes after start)
  startDirectorySync(defaultContext());   // WP-27: directory offboarding sync (Mode B with a directory only; daily by default)
  // WP-26: Mode A listens on loopback only, Mode B on the network with TLS only (services/network.ts; the certificate was checked above).
  const l = await listen(app, port, config, material, (s) => { tuneServer(s); broadcast.attach(s); });
  servers = l.servers;
  const r = rendererStatus();
  console.log(`Agastya Platform v2 running on ${l.scheme}://localhost:${l.port}  (listening on ${l.addresses.join(', ')})`);
  console.log(`  Network:   ${describeNetwork(config, material?.info ?? null)}`);
  console.log(`  Workspace: ${workspaceDir}`);
  console.log(`  Renderer:  ${r.warm ? 'warm FOP ready' : 'cold (per-request FOP)'}  java=${r.java}`);
  console.log(`  Setup:     ${store.anyAdminExists() ? 'administrator exists' : 'first run - open the app to create the administrator'}  (${nowIso()})`);
  return l.port;
}

export function stop(): void {
  stopScheduler();
  stopRenderer();
  void shutdownJobs();
  broadcast.close();
  for (const s of servers) s.close();
  servers = [];
  releaseWorkspaceLock();
}

/**
 * WP-06 (REL-003): a clean stop. New connections are refused at once; requests already running (a long build, a large upload) get up to
 * `graceMs` to finish; then the write-ahead log is checkpointed, the database closed and the data folder given back.
 */
export function shutdownGracefully(graceMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    const all = servers; servers = [];
    let done = false;
    const finish = (): void => {
      if (done) return; done = true;
      stopScheduler();
      try { stopRenderer(); } catch { /* best effort */ }
      void shutdownJobs().catch(() => undefined);           // WP-14: workers and their JVMs end with the server (the job object makes sure)
      try { registryDb.close(); } catch (e) { console.warn('[stop] database close:', (e as Error).message); }
      releaseWorkspaceLock();
      resolve();
    };
    try { broadcast.close(); } catch { /* best effort */ }
    if (!all.length) return finish();
    let open = all.length;
    for (const s of all) {
      s.close(() => { if (--open === 0) finish(); });
      s.closeIdleConnections?.();                   // keep-alive sockets with nothing running must not hold the stop
    }
    setTimeout(() => { console.warn('[stop] requests still running after the grace period; stopping anyway'); for (const s of all) s.closeAllConnections?.(); finish(); }, graceMs).unref();
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
  if (config.shutdownOnStdinClose) {
    process.stdin.on('end', () => shutdown('stdin closed'));
    process.stdin.on('error', () => undefined);
    process.stdin.resume();
  }
}
