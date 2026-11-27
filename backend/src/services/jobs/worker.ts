// =============================================================================
// WP-14: the job worker process (started by pool.ts with child_process.fork, AGASTYA_JOB_WORKER=1).
//
// It opens the same workspace and database as the server (without migrating: context.ts), runs one job at a time (kinds.ts) and reports
// back over the IPC channel: the job's progress messages (every `broadcast` of the services, relayed so the server can record and deliver
// them), then the result or the error as plain data. The FOP JVM it starts for a build gets the configured heap limit and lives as long as
// this worker; the pool replaces the worker after a number of jobs, so the JVM cannot grow without end (PERF-008).
//
// When the server goes away the IPC channel closes: the worker stops its JVM and exits, so no java.exe is left behind (the Windows job
// object, jobObject.ts, also guarantees that when the server is killed outright).
// =============================================================================

import { config, vendor } from '../../config';
import { setBroadcastSink } from '../broadcast';
import { runKind } from './kinds';
import { serializeError, type FromWorker, type ToWorker } from './protocol';

const fopd = vendor('engine/fopd');
const paths = vendor('engine/paths');

if (config.jobs.fopHeapMb > 0) {
  const heap = `-Xmx${config.jobs.fopHeapMb}m`;
  fopd.configure({ jvmArgs: [heap] });                                   // the warm renderer (vendor exception "fopd bounds")
  if (!paths.FOP_ARGS.includes(heap)) paths.FOP_ARGS.unshift(heap);       // the fallback launch and the JSG build: java <heap> -cp ...
}

const send = (m: FromWorker): void => { try { process.send?.(m); } catch { /* the server is gone: the disconnect handler ends this process */ } };

setBroadcastSink((projectId, msg) => send({ t: 'broadcast', projectId, msg: msg as unknown as Record<string, unknown> }));

let current: string | null = null;
process.on('message', (m: ToWorker) => {
  if (!m || m.t !== 'run') return;
  current = m.jobId;
  void runKind(m.kind, m.projectId, m.params ?? {}).then(
    (out) => send({ t: 'done', jobId: m.jobId, ok: true, result: out.result, inputHash: out.inputHash ?? null }),
    (e) => send({ t: 'done', jobId: m.jobId, ok: false, error: serializeError(e) }),
  ).finally(() => { current = null; });
});

const stop = (code: number): void => { try { fopd.stop(); } catch { /* not started */ } process.exit(code); };
process.on('disconnect', () => stop(0));
process.on('uncaughtException', (e) => {
  console.error('[job-worker] uncaught:', e);
  if (current) send({ t: 'done', jobId: current, ok: false, error: serializeError(e) });
  stop(1);
});
process.on('unhandledRejection', (e) => { console.error('[job-worker] unhandled rejection:', e); });

send({ t: 'ready', pid: process.pid });
