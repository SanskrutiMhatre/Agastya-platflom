// =============================================================================
// The job service (audit WP-14: PERF-001, PUB-003, PUB-004, PUB-027, DEP-028, PERF-008, PRD-001).
//
// Validation, the publish gate and every publication build used to run inside the HTTP request, on the server's only thread: a 200-module
// validation with business rules froze every other user for seconds, and one hung FOP stopped every build. They are now jobs:
//
//   * a job has an id, a record (repositories/jobRepository.ts, migration 026) and a log of its progress lines, so it outlives the request,
//     a client that reconnects can replay it (GET /api/projects/:id/jobs/:jobId), and a restart marks it "interrupted" instead of losing it;
//   * it runs in a worker process (pool.ts), never on the server's thread; the worker is in a Windows job object (jobObject.ts);
//   * admission: at most `validationSlots` validation/gate jobs and `buildSlots` builds at once, server-wide, the rest queue in order;
//   * one job at a time per project, of any kind (PUB-021: a preview and a full build of one project no longer write the same files at once);
//   * a deadline (a job past it is killed with its process tree and fails with a message: DEP-028), cancel, and crash isolation;
//   * a second identical request while the first is still queued joins it instead of queueing another build (a double click);
//   * every state change and progress line goes to the project's readers over the WebSocket, tagged with the job id.
//
// The routes keep their request/response contract: `run()` submits and waits, and the route answers with the same body (or the same error)
// as before. `?async=1` on the validation and publish routes answers 202 with the job instead (the job flow for a future client).
// =============================================================================

import crypto from 'crypto';
import { config, nowIso } from '../../config';
import { repos } from '../../context';
import { deliver, setBroadcastSink, type BroadcastMessage } from '../broadcast';
import type { JobRow, JobState } from '../../repositories';
import { runKind } from './kinds';
import { WorkerPool, WorkerAbort, type RunningJob } from './pool';
import { LANE_OF, deserializeError, serializeError, type JobKind, type Lane, type WireError } from './protocol';

export { isJobKind, type JobKind } from './protocol';

export interface Actor { id?: string | null; username?: string | null }
export interface SubmitInput { kind: JobKind; projectId: string | null; params?: Record<string, unknown>; actor?: Actor | null }

/** What a client sees of a job (GET /jobs/:id, the WebSocket "job" message). */
export interface JobView {
  id: string; kind: string; projectId: string | null; state: JobState; createdAt: string; startedAt: string | null; finishedAt: string | null;
  actor: string | null; position?: number; error?: { message: string; code?: string; status?: number } | null; cached?: boolean;
}

interface Job {
  id: string; kind: JobKind; lane: Lane; projectId: string | null; params: Record<string, unknown>; key: string;
  state: JobState; createdAt: string; startedAt: string | null; actor: Actor | null;
  done: Promise<unknown>; resolve(v: unknown): void; reject(e: Error): void;
  seq: number; running: RunningJob | null; inlineAbort: boolean; timer: NodeJS.Timeout | null; cancelledBy: string | null;
}

const MAX_LOG_LINES = 2000;
const queue: Job[] = [];
const active = new Map<string, Job>();                 // by job id
const busyProjects = new Map<string, Job>();           // project id -> its running job
const laneActive: Record<Lane, number> = { validation: 0, build: 0 };
let pool: WorkerPool | null = null;
let initialised = false;
let counters = { submitted: 0, coalesced: 0, succeeded: 0, failed: 0, cancelled: 0, timedOut: 0, crashed: 0 };

const laneCap = (l: Lane): number => (l === 'validation' ? config.jobs.validationSlots : config.jobs.buildSlots);
const projectKey = (j: Job): string => j.projectId ?? `job:${j.id}`;

function usesWorkers(): boolean {
  if (config.jobs.mode === 'inline') return false;
  return getPool().available();
}

function getPool(): WorkerPool {
  if (!pool) {
    const l = config.jobs.limits;
    pool = new WorkerPool({
      max: config.jobs.workers, heapMb: config.jobs.workerHeapMb, env: config.jobs.workerEnv,
      jobsPerWorker: config.jobs.jobsPerWorker, idleMs: config.jobs.idleMs,
      limits: l.enabled ? { processMb: l.processMb, jobMb: l.jobMb, cpuPercent: l.cpuPercent, activeProcesses: l.activeProcesses } : null,
    });
    process.once('exit', () => { try { pool?.killAllNow(); } catch { /* best effort */ } });
  }
  return pool;
}

/** Once per process: unfinished records of a previous run become "interrupted", old records go, and progress lines are routed to jobs. */
function init(): void {
  if (initialised) return;
  initialised = true;
  try {
    const n = repos.jobs.interruptUnfinished(nowIso(), JSON.stringify({ message: 'The server stopped while this job was queued or running. Nothing was published by it; run it again.', code: 'JOB_INTERRUPTED', status: 503 }));
    if (n) console.warn(`[jobs] ${n} job(s) were interrupted by the last stop`);
    if (config.jobs.keepDays > 0) repos.jobs.purgeFinishedBefore(new Date(Date.now() - config.jobs.keepDays * 86_400_000).toISOString());
  } catch (e) { console.warn('[jobs] could not tidy the job records:', (e as Error).message); }
  // A progress line of a running job (from a worker, or from inline work) is recorded in its log and delivered tagged with the job id.
  setBroadcastSink((projectId, msg) => relay(projectId, msg as unknown as Record<string, unknown>));
}

function relay(projectId: string, msg: Record<string, unknown>): void {
  const job = busyProjects.get(projectId);
  if (job) {
    if (msg.type === 'progress' && typeof msg.message === 'string') appendLog(job, msg);
    deliver(projectId, { ...msg, jobId: job.id } as unknown as BroadcastMessage);
  } else deliver(projectId, msg as unknown as BroadcastMessage);
}

function appendLog(job: Job, msg: Record<string, unknown>): void {
  if (job.seq >= MAX_LOG_LINES) return;
  job.seq++;
  const { type: _t, projectId: _p, ...line } = msg;
  try { repos.jobs.appendLog(job.id, job.seq, nowIso(), JSON.stringify(line)); } catch { /* the line still reaches the sockets */ }
}

function view(j: Job): JobView {
  return { id: j.id, kind: j.kind, projectId: j.projectId, state: j.state, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: null, actor: j.actor?.username ?? null, position: j.state === 'queued' ? queue.indexOf(j) + 1 : undefined };
}

function announce(j: Job, extra: Partial<JobView> = {}): void {
  if (!j.projectId) return;
  deliver(j.projectId, { type: 'job', job: { ...view(j), ...extra } as unknown as Record<string, unknown> });
}

/** Submits a job; returns at once. A queued job of the same kind, project and parameters is joined instead of queueing a second one. */
export function submit(input: SubmitInput): { id: string; done: Promise<unknown>; coalesced: boolean } {
  init();
  const params = input.params ?? {};
  const key = `${input.kind}|${input.projectId ?? ''}|${JSON.stringify(params)}`;
  const same = queue.find((q) => q.key === key);
  if (same) { counters.coalesced++; return { id: same.id, done: same.done, coalesced: true }; }
  let resolve!: (v: unknown) => void; let reject!: (e: Error) => void;
  const done = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
  done.catch(() => undefined);                       // a fire-and-forget submit must not become an unhandled rejection
  const job: Job = {
    id: crypto.randomUUID(), kind: input.kind, lane: LANE_OF[input.kind], projectId: input.projectId, params, key,
    state: 'queued', createdAt: nowIso(), startedAt: null, actor: input.actor ?? null, done, resolve, reject,
    seq: 0, running: null, inlineAbort: false, timer: null, cancelledBy: null,
  };
  repos.jobs.insert({ id: job.id, kind: job.kind, projectId: job.projectId, params: JSON.stringify(params), actorId: job.actor?.id ?? null, actorName: job.actor?.username ?? null, createdAt: job.createdAt });
  counters.submitted++;
  queue.push(job);
  active.set(job.id, job);
  announce(job);
  pump();
  return { id: job.id, done, coalesced: false };
}

/** Submits and waits: the result, or the error the work threw (rebuilt, so a route answers exactly as before). */
export async function run<T = unknown>(input: SubmitInput): Promise<T & { jobId?: string }> {
  const s = submit(input);
  const r = await s.done;
  return r as T & { jobId?: string };
}

function pump(): void {
  for (let i = 0; i < queue.length; i++) {
    const j = queue[i];
    if (busyProjects.has(projectKey(j))) continue;
    if (laneActive[j.lane] >= laneCap(j.lane)) continue;
    const viaWorkers = usesWorkers();
    if (viaWorkers && !getPool().canTake()) break;
    queue.splice(i, 1); i--;
    start(j, viaWorkers);
  }
}

function start(j: Job, viaWorkers: boolean): void {
  j.state = 'running'; j.startedAt = nowIso();
  busyProjects.set(projectKey(j), j);
  laneActive[j.lane]++;
  repos.jobs.markRunning(j.id, j.startedAt, null);
  announce(j);
  j.timer = setTimeout(() => abort(j, 'timeout'), config.jobs.timeoutMs);
  j.timer.unref();
  const work: Promise<{ ok: true; result: unknown; inputHash?: string | null } | { ok: false; error: WireError }> = viaWorkers
    ? (j.running = getPool().run(j.id, j.kind, j.lane, j.projectId, j.params, {
        onBroadcast: (projectId, msg) => relay(projectId, msg),
        onStart: (pid) => { try { repos.jobs.markRunning(j.id, j.startedAt!, pid); } catch { /* the record keeps no pid */ } },
      })).promise
    : runKind(j.kind, j.projectId, j.params).then((o) => ({ ok: true as const, result: o.result, inputHash: o.inputHash ?? null }), (e) => ({ ok: false as const, error: serializeError(e) }));
  void work.then(
    (out) => {
      if (j.inlineAbort) return;                                     // inline work cannot be killed; its late answer is dropped
      if (out.ok) finish(j, 'succeeded', out.result, null, out.inputHash ?? null);
      else finish(j, 'failed', null, memoryHint(out.error));
    },
    (e: Error) => {
      if (j.inlineAbort) return;
      const a = e instanceof WorkerAbort ? e : null;
      const minutes = Math.round(config.jobs.timeoutMs / 60_000);
      if (a?.reason === 'cancel') finish(j, 'cancelled', null, { name: 'HttpError', status: 409, code: 'JOB_CANCELLED', message: `The job was cancelled${j.cancelledBy ? ` by ${j.cancelledBy}` : ''}. Nothing was published by it.` });
      else if (a?.reason === 'timeout') { counters.timedOut++; finish(j, 'failed', null, { name: 'HttpError', status: 504, code: 'JOB_TIMEOUT', message: `The job ran longer than its limit (${minutes} minute${minutes === 1 ? '' : 's'}) and was stopped, with every program it had started. Other work was not affected; try again, and if it happens again the document may make the PDF tool loop.` }); }
      else if (a?.reason === 'shutdown') finish(j, 'interrupted', null, { name: 'HttpError', status: 503, code: 'JOB_INTERRUPTED', message: 'The server is stopping; the job was ended. Run it again when the server is back.' });
      else { counters.crashed++; void crashMessage(e.message).then((m) => finish(j, 'failed', null, { name: 'HttpError', status: 500, code: 'JOB_WORKER_CRASHED', message: m })); }
    },
  );
}

/** An allocation the job object refused surfaces in the worker as an ordinary error: say which limit it met. */
function memoryHint(e: WireError): WireError {
  const lim = config.jobs.limits;
  if (e.status || !lim.enabled || pool?.holder.status.state !== 'active' || !/allocation failed|out of memory|ENOMEM/i.test(e.message)) return e;
  return { ...e, name: 'HttpError', status: 507, code: 'JOB_MEMORY_LIMIT', message: `The job needed more memory than its limit (${lim.processMb} MB per process, ${lim.jobMb} MB for all jobs together) and was refused it (${e.message}). Only this job failed.` };
}

async function crashMessage(base: string): Promise<string> {
  let hint = '';
  try {
    const st = await pool?.holder.stats();
    const lim = config.jobs.limits;
    if (st && lim.enabled && st.peakProcessMb >= lim.processMb * 0.8) hint = ` It reached the memory limit of ${lim.processMb} MB per process, and the operating system stopped it.`;
  } catch { /* no statistics */ }
  return `${base}${hint} Only this job failed; the next one gets a new worker.`;
}

function finish(j: Job, state: JobState, result: unknown, error: WireError | null, inputHash: string | null = null): void {
  if (!active.has(j.id)) return;
  active.delete(j.id);
  if (j.timer) { clearTimeout(j.timer); j.timer = null; }
  if (j.state === 'running') {
    laneActive[j.lane]--;
    if (busyProjects.get(projectKey(j)) === j) busyProjects.delete(projectKey(j));
  } else {
    const i = queue.indexOf(j); if (i >= 0) queue.splice(i, 1);
  }
  j.state = state;
  if (state === 'succeeded') counters.succeeded++; else if (state === 'cancelled') counters.cancelled++; else counters.failed++;
  let stored: string | null = null;
  try { stored = result === undefined || result === null ? null : JSON.stringify(result); } catch { stored = null; }
  if (stored && stored.length > 4_000_000) stored = JSON.stringify({ truncated: true, bytes: stored.length });   // a huge validation run stays in .validation.json
  try { repos.jobs.finish(j.id, state, nowIso(), stored, error ? JSON.stringify({ message: error.message, code: error.code, status: error.status }) : null, inputHash); } catch (e) { console.warn('[jobs] could not record the end of a job:', (e as Error).message); }
  const cached = !!(result && typeof result === 'object' && (result as { run?: { cached?: boolean } }).run?.cached);
  announce(j, { finishedAt: nowIso(), error: error ? { message: error.message, code: error.code, status: error.status } : null, cached });
  if (error) j.reject(deserializeError(error));
  else j.resolve(result && typeof result === 'object' && !Array.isArray(result) ? { ...(result as object), jobId: j.id } : result);
  setImmediate(pump);
}

function abort(j: Job, reason: 'cancel' | 'timeout'): void {
  if (!active.has(j.id)) return;
  if (j.state === 'queued') {
    finish(j, reason === 'cancel' ? 'cancelled' : 'failed', null, { name: 'HttpError', status: 409, code: 'JOB_CANCELLED', message: `The job was cancelled${j.cancelledBy ? ` by ${j.cancelledBy}` : ''} before it started.` });
    return;
  }
  if (j.running) { j.running.kill(reason); return; }
  // inline work cannot be stopped: the job is ended now and the work's own answer, when it comes, is dropped
  j.inlineAbort = true;
  if (reason === 'timeout') counters.timedOut++;
  finish(j, reason === 'cancel' ? 'cancelled' : 'failed', null, reason === 'cancel'
    ? { name: 'HttpError', status: 409, code: 'JOB_CANCELLED', message: 'The job was cancelled.' }
    : { name: 'HttpError', status: 504, code: 'JOB_TIMEOUT', message: 'The job ran longer than its limit and was ended.' });
}

/** Cancels a queued or running job of `projectId`. False when it is not running or queued (any more). */
export function cancel(jobId: string, projectId: string, by: string | null): boolean {
  const j = active.get(jobId);
  if (!j || j.projectId !== projectId) return false;
  j.cancelledBy = by;
  abort(j, 'cancel');
  return true;
}

function rowView(r: JobRow): JobView {
  let error: JobView['error'] = null;
  try { error = r.error ? JSON.parse(r.error) : null; } catch { error = { message: String(r.error) }; }
  return { id: r.id, kind: r.kind, projectId: r.project_id, state: r.state, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, actor: r.actor_name, error };
}

/** One job of a project with its progress lines after `after` (replay), and its result once it has ended. */
export function getJob(projectId: string, jobId: string, after = 0): (JobView & { log: Array<{ seq: number; at: string } & Record<string, unknown>>; result: unknown }) | null {
  init();
  const r = repos.jobs.get(jobId);
  if (!r || r.project_id !== projectId) return null;
  const live = active.get(jobId);
  const base = live ? { ...view(live), error: null } : rowView(r);
  const log = repos.jobs.log(jobId, Math.max(0, after), MAX_LOG_LINES).map((l) => { let m: Record<string, unknown> = {}; try { m = JSON.parse(l.message); } catch { m = { message: l.message }; } return { seq: l.seq, at: l.at, ...m }; });
  let result: unknown = null;
  try { result = r.result ? JSON.parse(r.result) : null; } catch { result = null; }
  return { ...base, log, result };
}

/**
 * PUB-005: the build report - what the build said about the document beyond "done": the gate's notes (waivers, rules not enforced,
 * annexures not printed), image references that do not resolve, pictures refused by the confinement, the warm-FOP fallback.
 */
export function buildReport(projectId: string, jobId: string): { notes: string[]; lines: number } {
  const j = getJob(projectId, jobId);
  if (!j) return { notes: [], lines: 0 };
  const msgs = j.log.map((l) => String(l.message ?? ''));
  return { notes: msgs.filter((m) => /^(Note:|Image references:|Security:|Warm FOP unavailable|Building anyway)/.test(m)), lines: msgs.length };
}

/** The newest jobs of a project. */
export function listJobs(projectId: string, limit = 50): JobView[] {
  init();
  return repos.jobs.listForProject(projectId, Math.min(200, Math.max(1, limit))).map((r) => { const live = active.get(r.id); return live ? view(live) : rowView(r); });
}

/** The service as an administrator sees it (GET /api/admin/jobs). */
export function jobsStatus(): Record<string, unknown> {
  return {
    mode: usesWorkers() ? 'worker' : 'inline',
    slots: { validation: config.jobs.validationSlots, build: config.jobs.buildSlots }, running: { ...laneActive }, queued: queue.length,
    timeoutMinutes: Math.round(config.jobs.timeoutMs / 60_000), fopHeapMb: config.jobs.fopHeapMb, workerHeapMb: config.jobs.workerHeapMb,
    counters: { ...counters }, pool: pool ? pool.status() : null,
  };
}

/** Ends every job and worker (server stop). Queued jobs end as interrupted. */
export async function shutdownJobs(): Promise<void> {
  for (const j of [...queue]) finish(j, 'interrupted', null, { name: 'HttpError', status: 503, code: 'JOB_INTERRUPTED', message: 'The server is stopping; the job did not start.' });
  if (pool) { const p = pool; pool = null; await p.shutdown(); }
}

/** Test hook: the worker pool's status and the job object's statistics. */
export async function poolDiagnostics(): Promise<{ status: ReturnType<WorkerPool['status']> | null; stats: unknown }> {
  return { status: pool ? pool.status() : null, stats: pool ? await pool.holder.stats() : null };
}

/** The error codes a job adds to those of the work itself. */
export const JOB_ERROR_CODES = ['JOB_CANCELLED', 'JOB_TIMEOUT', 'JOB_WORKER_CRASHED', 'JOB_MEMORY_LIMIT', 'JOB_INTERRUPTED'] as const;
