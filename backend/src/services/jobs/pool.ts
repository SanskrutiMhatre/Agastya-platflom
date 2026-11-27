// =============================================================================
// WP-14: the worker pool and its supervisor.
//
// Worker processes are started on demand (child_process.fork of worker.js) up to a maximum, reused for later jobs, replaced after a number
// of jobs (so the FOP JVM a worker keeps warm cannot grow without end, PERF-008) and ended when idle. Each one is put into the job object
// (jobObject.ts) before it gets work, runs at below-normal priority, and has a V8 heap limit.
//
// A job that must stop - cancelled, past its deadline, or the server stopping - ends with its whole process tree (taskkill /T on Windows:
// the worker, its JVM, a running xsltproc). A worker that dies by itself fails only the job it was running, with a message; the next job
// gets a new worker. Nothing a worker does can stop the server.
// =============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fork, spawn, spawnSync, type ChildProcess } from 'child_process';
import { JobObjectHolder, type JobObjectLimits, type JobObjectStatus } from './jobObject';
import type { FromWorker, JobKind, Lane, ToWorker, WireError } from './protocol';

export type AbortReason = 'cancel' | 'timeout' | 'shutdown';

/** Why a job ended without an answer from its worker. */
export class WorkerAbort extends Error {
  constructor(public reason: AbortReason | 'crash', message: string, public exitCode?: number | null, public signal?: string | null) { super(message); this.name = 'WorkerAbort'; }
}

export interface PoolOptions {
  max: number; heapMb: number; env: Record<string, string>; jobsPerWorker: number; idleMs: number;
  limits: JobObjectLimits | null;
  /** The worker entry (default: worker.js beside this file). */
  entry?: string;
}

export interface RunHooks { onBroadcast(projectId: string, msg: Record<string, unknown>): void; onStart?(pid: number): void }
export interface RunOutcome { ok: true; result: unknown; inputHash?: string | null }
export interface RunningJob { promise: Promise<RunOutcome | { ok: false; error: WireError }>; kill(reason: AbortReason): void; pid: number }

interface Worker {
  child: ChildProcess; pid: number; jobs: number; warmBuild: boolean;
  ready: Promise<void>; idle: NodeJS.Timeout | null;
  current: { jobId: string; resolve(v: RunOutcome | { ok: false; error: WireError }): void; reject(e: Error): void; hooks: RunHooks; abort: AbortReason | null } | null;
  ending: boolean;
}

/** Ends a process and every process it started. */
export function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } resolve(); return; }
    const t = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    t.on('exit', () => resolve()); t.on('error', () => { try { process.kill(pid); } catch { /* gone */ } resolve(); });
  });
}

export class WorkerPool {
  private workers = new Set<Worker>();
  readonly holder: JobObjectHolder;
  private readonly entry: string;
  private stopped = false;
  spawned = 0; crashed = 0;

  constructor(private readonly o: PoolOptions) {
    this.holder = new JobObjectHolder(o.limits);
    this.entry = o.entry ?? path.join(__dirname, 'worker.js');
  }

  /** Workers can only run from the compiled tree (dist/); under ts-node the service runs jobs inline. */
  available(): boolean { return fs.existsSync(this.entry); }

  /** True when a job could start now: an idle worker, or room for a new one. */
  canTake(): boolean {
    if (this.stopped) return false;
    for (const w of this.workers) if (!w.current && !w.ending) return true;
    return this.liveCount() < this.o.max;
  }

  private liveCount(): number { let n = 0; for (const w of this.workers) if (!w.ending) n++; return n; }

  private spawnWorker(): Worker {
    const child = fork(this.entry, [], {
      env: this.o.env,
      execArgv: [`--max-old-space-size=${this.o.heapMb}`],
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    });
    this.spawned++;
    const w: Worker = { child, pid: child.pid ?? 0, jobs: 0, warmBuild: false, ready: Promise.resolve(), idle: null, current: null, ending: false };
    // below-normal priority: the server's own requests come first on a busy machine; the JVM and tools inherit it
    try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here: keep normal */ }
    const assigned = child.pid ? this.holder.assign(child.pid).then((r) => { if (!r.ok && this.holder.status.state === 'active') console.warn(`[jobs] worker ${child.pid} is not in the job object: ${r.reason}`); }) : Promise.resolve();
    const hello = new Promise<void>((resolve, reject) => {
      const onMsg = (m: FromWorker): void => { if (m && m.t === 'ready') { child.off('message', onMsg); resolve(); } };
      child.on('message', onMsg);
      child.once('exit', (code) => reject(new WorkerAbort('crash', `The job worker stopped while starting (exit code ${code}).`, code)));
    });
    w.ready = Promise.all([assigned, hello]).then(() => undefined);
    w.ready.catch(() => undefined);
    child.on('message', (m: FromWorker) => this.onMessage(w, m));
    child.on('exit', (code, signal) => this.onExit(w, code, signal));
    child.on('error', (e) => console.warn(`[jobs] worker ${w.pid}: ${e.message}`));
    this.idleRef(w, false);
    this.workers.add(w);
    return w;
  }

  /** A worker keeps the server process alive only while it runs a job (an idle pool never holds a stopping process or a test). */
  private idleRef(w: Worker, busy: boolean): void {
    const ch = w.child as unknown as { ref(): void; unref(): void; channel?: { ref(): void; unref(): void } };
    try { if (busy) { ch.ref(); ch.channel?.ref(); } else { ch.unref(); ch.channel?.unref(); } } catch { /* exited */ }
  }

  private onMessage(w: Worker, m: FromWorker): void {
    const c = w.current;
    if (!m || !c) return;
    if (m.t === 'broadcast') { try { c.hooks.onBroadcast(m.projectId, m.msg); } catch { /* a progress line is never fatal */ } return; }
    if (m.t === 'done' && m.jobId === c.jobId) {
      w.current = null;
      w.jobs++;
      this.idleRef(w, false);
      if (m.ok) c.resolve({ ok: true, result: m.result, inputHash: m.inputHash ?? null }); else c.resolve({ ok: false, error: m.error });
      this.afterJob(w);
    }
  }

  private onExit(w: Worker, code: number | null, signal: string | null): void {
    this.workers.delete(w);
    if (w.idle) { clearTimeout(w.idle); w.idle = null; }
    const c = w.current; w.current = null;
    if (!c) return;
    if (c.abort) { c.reject(new WorkerAbort(c.abort, c.abort, code, signal)); return; }
    this.crashed++;
    c.reject(new WorkerAbort('crash', `The worker process running this job stopped unexpectedly (exit code ${code ?? signal}).`, code, signal));
  }

  private afterJob(w: Worker): void {
    if (this.stopped) { this.end(w); return; }
    if (w.jobs >= this.o.jobsPerWorker) { this.end(w); return; }          // a fresh worker (and JVM) after this many jobs
    if (w.idle) clearTimeout(w.idle);
    w.idle = setTimeout(() => this.end(w), this.o.idleMs);
    w.idle.unref();
  }

  /** Ends an idle worker: closing the channel makes it stop its JVM and exit; a worker that does not is killed after 10 s. */
  private end(w: Worker): void {
    if (w.ending) return;
    w.ending = true;
    if (w.idle) { clearTimeout(w.idle); w.idle = null; }
    try { w.child.disconnect(); } catch { /* already gone */ }
    setTimeout(() => { if (w.child.exitCode === null && w.child.signalCode === null) void killTree(w.pid); }, 10_000).unref();
  }

  /** Runs one job on an idle worker (or a new one). The caller checked canTake(). */
  run(jobId: string, kind: JobKind, lane: Lane, projectId: string | null, params: Record<string, unknown>, hooks: RunHooks): RunningJob {
    let w: Worker | null = null;
    // a build prefers a worker whose JVM is already warm; validation prefers one without (it leaves the JVMs to the builds)
    for (const x of this.workers) {
      if (x.current || x.ending) continue;
      if (!w || (lane === 'build' ? x.warmBuild && !w.warmBuild : !x.warmBuild && w.warmBuild)) w = x;
    }
    if (!w) w = this.spawnWorker();
    if (w.idle) { clearTimeout(w.idle); w.idle = null; }
    if (lane === 'build') w.warmBuild = true;
    const worker = w;
    let settle!: { resolve(v: RunOutcome | { ok: false; error: WireError }): void; reject(e: Error): void };
    const promise = new Promise<RunOutcome | { ok: false; error: WireError }>((resolve, reject) => { settle = { resolve, reject }; });
    worker.current = { jobId, ...settle, hooks, abort: null };
    this.idleRef(worker, true);
    void worker.ready.then(() => {
      if (worker.current?.jobId !== jobId) return;                       // killed while starting
      hooks.onStart?.(worker.pid);
      const msg: ToWorker = { t: 'run', jobId, kind, projectId, params };
      try { worker.child.send(msg); } catch (e) { worker.current = null; settle.reject(new WorkerAbort('crash', `The job could not be handed to its worker: ${(e as Error).message}`)); void killTree(worker.pid); }
    }, (e) => { if (worker.current?.jobId === jobId) { worker.current = null; settle.reject(e as Error); } });
    return {
      promise, pid: worker.pid,
      kill: (reason: AbortReason) => {
        if (worker.current?.jobId !== jobId) return;
        worker.current.abort = reason;
        worker.ending = true;
        void killTree(worker.pid);
      },
    };
  }

  status(): { workers: Array<{ pid: number; busy: boolean; jobs: number; warmBuild: boolean }>; max: number; spawned: number; crashed: number; jobObject: JobObjectStatus } {
    return {
      workers: [...this.workers].map((w) => ({ pid: w.pid, busy: !!w.current, jobs: w.jobs, warmBuild: w.warmBuild })),
      max: this.o.max, spawned: this.spawned, crashed: this.crashed, jobObject: this.holder.status,
    };
  }

  /** Stops every worker (their running jobs end as "shutdown") and closes the job object. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    const all = [...this.workers];
    await Promise.all(all.map(async (w) => {
      if (w.current) w.current.abort = 'shutdown';
      w.ending = true;
      await killTree(w.pid);
    }));
    this.holder.close();
  }

  /**
   * Ends every idle worker with its process tree, synchronously (services/renderer.ts: a warm JVM keeps the pictures it embedded open, and
   * Windows will not delete a file that is open). A worker running a job is left alone. Returns how many ended.
   */
  releaseIdleSync(): number {
    let n = 0;
    for (const w of [...this.workers]) {
      if (w.current || w.ending) continue;
      w.ending = true; n++;
      if (w.idle) { clearTimeout(w.idle); w.idle = null; }
      if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(w.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
      else { try { w.child.kill('SIGKILL'); } catch { /* gone */ } }
    }
    return n;
  }

  /** Synchronous last resort when the server process exits: kill the workers (the job object takes their tools). */
  killAllNow(): void {
    for (const w of this.workers) { try { w.child.kill(); } catch { /* gone */ } }
    this.holder.close();
  }

  /** Lets a stopped pool start again (tests boot several apps in one process). */
  restart(): void { this.stopped = false; }
}
