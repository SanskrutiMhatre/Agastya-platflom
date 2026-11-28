// =============================================================================
// GET /api/admin/perf (Phase 3, performance baseline and instrumentation; docs/phase3/ui-and-baseline.md).
//
// One answer an administrator (and backend/scripts/bench/phase3-baseline.js) reads to see where the server's time and memory go:
//   eventLoop   the event-loop delay histogram since the last reset (services/metrics.ts, 10 ms resolution)
//   memory      this process: RSS, heap used/total, external, array buffers (MB)
//   live        WebSocket clients, presence entries (registered gauges)
//   jobs        queue depth, running per lane, worker mode and the worker pool (services/jobs)
//   renderer    the FOP JVMs (in this process's warm renderer, or the job workers' JVMs) and the workers themselves, with their working set
//   routes      the slowest of the last 512 API requests and the routes with the highest mean (route templates only)
//
// Overhead: the figures are kept by services/metrics.ts at the cost of a few arithmetic operations per request. The process list for the
// renderer memory is read only when this route is asked, asynchronously, with a timeout, and kept for RENDERER_CACHE_MS; `?os=0` skips it,
// `?fresh=1` measures again now (the benchmark samples the JVMs while a build runs).
// =============================================================================

import { execFile } from 'child_process';
import { eventLoopHistogram, liveGauges, routeFigures, snapshot } from './metrics';
import { jobsStatus } from './jobs';
import { rendererPid } from './publisher';

export const RENDERER_CACHE_MS = 10_000;
const OS_TIMEOUT_MS = 5_000;

interface Proc { pid: number; ppid: number; name: string; workingSetMb: number }

function listProcesses(): Promise<Proc[]> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const ps = "Get-CimInstance Win32_Process -Filter \"Name='java.exe' or Name='javaw.exe' or Name='node.exe'\" | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress";
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: OS_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1048576 }, (err, out) => {
        if (err) { resolve([]); return; }
        try {
          const j = JSON.parse(String(out || '[]')); const rows = Array.isArray(j) ? j : [j];
          resolve(rows.map((r: Record<string, unknown>) => ({ pid: Number(r.ProcessId), ppid: Number(r.ParentProcessId), name: String(r.Name), workingSetMb: Math.round(Number(r.WorkingSetSize) / 1048576) })));
        } catch { resolve([]); }
      });
    } else {
      execFile('ps', ['-eo', 'pid=,ppid=,rss=,comm='], { timeout: OS_TIMEOUT_MS, maxBuffer: 4 * 1048576 }, (err, out) => {
        if (err) { resolve([]); return; }
        resolve(String(out).split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 4)
          .map((p) => ({ pid: Number(p[0]), ppid: Number(p[1]), workingSetMb: Math.round(Number(p[2]) / 1024), name: p.slice(3).join(' ') }))
          .filter((p) => /java|node/i.test(p.name)));
      });
    }
  });
}

let cache: { at: number; value: RendererFigures } | null = null;
let pending: Promise<RendererFigures> | null = null;

export interface RendererFigures {
  measuredAt: string;
  inProcessJvmPid: number | null;
  jvms: Array<{ pid: number; parent: number; owner: 'server' | 'worker'; workingSetMb: number }>;
  workers: Array<{ pid: number; workingSetMb: number | null; busy: boolean; jobs: number; warmBuild: boolean }>;
  jvmWorkingSetMb: number;
  available: boolean;
}

async function measureRenderer(): Promise<RendererFigures> {
  const st = jobsStatus() as { pool?: { workers?: Array<{ pid: number; busy: boolean; jobs: number; warmBuild: boolean }> } | null };
  const workers = st.pool?.workers ?? [];
  const procs = await listProcesses();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const owners = new Map<number, 'server' | 'worker'>([[process.pid, 'server'], ...workers.map((w) => [w.pid, 'worker'] as [number, 'worker'])]);
  const jvms = procs.filter((p) => /java/i.test(p.name) && owners.has(p.ppid))
    .map((p) => ({ pid: p.pid, parent: p.ppid, owner: owners.get(p.ppid) as 'server' | 'worker', workingSetMb: p.workingSetMb }));
  return {
    measuredAt: new Date().toISOString(), inProcessJvmPid: rendererPid(), jvms,
    workers: workers.map((w) => ({ pid: w.pid, workingSetMb: byPid.get(w.pid)?.workingSetMb ?? null, busy: w.busy, jobs: w.jobs, warmBuild: w.warmBuild })),
    jvmWorkingSetMb: jvms.reduce((s, j) => s + j.workingSetMb, 0), available: procs.length > 0,
  };
}

/** The renderer figures, read at most every RENDERER_CACHE_MS (concurrent askers share one measurement). */
export function rendererFigures(fresh = false): Promise<RendererFigures> {
  if (!fresh && cache && Date.now() - cache.at < RENDERER_CACHE_MS) return Promise.resolve(cache.value);
  if (!pending) pending = measureRenderer().then((v) => { cache = { at: Date.now(), value: v }; return v; }).finally(() => { pending = null; });
  return pending;
}

const mb = (n: number): number => Math.round((n / 1048576) * 10) / 10;

export async function perfReport({ os = true, top = 20, fresh = false }: { os?: boolean; top?: number; fresh?: boolean } = {}): Promise<Record<string, unknown>> {
  const m = process.memoryUsage();
  const s = snapshot();
  const j = jobsStatus() as { mode?: string; queued?: number; running?: Record<string, number>; slots?: Record<string, number> };
  return {
    at: new Date().toISOString(), since: s.since, seconds: s.seconds, pid: process.pid, uptimeSeconds: Math.round(process.uptime()), node: process.version,
    eventLoop: eventLoopHistogram(),
    memory: { rssMb: mb(m.rss), heapUsedMb: mb(m.heapUsed), heapTotalMb: mb(m.heapTotal), externalMb: mb(m.external), arrayBuffersMb: mb(m.arrayBuffers) },
    live: liveGauges(),
    jobs: { mode: j.mode, queueDepth: j.queued ?? 0, running: j.running ?? {}, slots: j.slots ?? {} },
    requests: s.requests, db: s.db,
    renderer: os ? await rendererFigures(fresh) : null,
    routes: routeFigures(Math.max(1, Math.min(100, top))),
  };
}
