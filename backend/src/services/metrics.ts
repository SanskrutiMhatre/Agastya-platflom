// =============================================================================
// Server load figures for a Mode B team server (audit WP-28: G-PERF-4, G-REL-4, decision D3; addendum 17 section 3, the D21 triggers).
//
// What an administrator (and the multi-user acceptance harness, backend/scripts/load-test.js) needs to see whether the one Node process
// and the one SQLite writer still keep up:
//   * event-loop delay (perf_hooks histogram, 10 ms resolution): a long synchronous step stalls every author at once;
//   * database statement time: node:sqlite is synchronous, so a statement that waits for a lock (busy_timeout, another process such as the
//     backup CLI holding the write lock) blocks the event loop for that long. Every statement is timed; one of 50 ms or more is counted as
//     "slow" (the proxy for a lock wait), and "database is locked" errors are counted;
//   * request time over the last 4,096 API requests (p50 / p95 / p99), in-flight requests, and the 5xx count;
//   * WebSocket connections and presence entries (services/broadcast, services/presence).
// Nothing is written to disk. GET /api/admin/metrics shows it; POST /api/admin/metrics/reset starts a new measuring window.
// The D21 switch criteria (addendum 17): p95 write latency above 200 ms or event-loop lag above 100 ms under the stated load.
//
// Phase 3 (performance baseline, docs/phase3/ui-and-baseline.md): every /api answer carries a `Server-Timing` header (`db;dur=…;desc="n
// statements"`, `total;dur=…` = time to the first byte), the database time is counted per request through the request context that already
// exists (services/requestContext.ts: no extra async hook), and the last ROUTE_RING requests are kept with their route template (never a
// concrete path) so GET /api/admin/perf (services/perfReport.ts) can list the slowest. Per-route totals are bounded to MAX_ROUTES keys.
// =============================================================================

import { monitorEventLoopDelay, performance, type IntervalHistogram } from 'perf_hooks';
import type { Request, Response, NextFunction } from 'express';
import type { SqlDatabase, SqlStatement } from '../storage/sqlite';
import { currentRequest } from './requestContext';
import { routeOf } from './log';

export const SLOW_STATEMENT_MS = 50;
const RING = 4096;

let loop: IntervalHistogram | null = null;
let windowStart = Date.now();

const db = { statements: 0, totalMs: 0, maxMs: 0, slow: 0, locked: 0, maxSql: '' };
const req = { ring: new Float64Array(RING), writes: new Float64Array(RING), n: 0, wn: 0, total: 0, errors5xx: 0, inFlight: 0, maxInFlight: 0 };
type Gauge = () => number;
const gauges = new Map<string, Gauge>();

function ensureLoop(): IntervalHistogram {
  if (!loop) { loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable(); }
  return loop;
}

/** A named live figure (WebSocket clients, presence entries) that the snapshot reads when asked. */
export function registerGauge(name: string, g: Gauge): void { gauges.set(name, g); }

function timed<T>(sql: string, fn: () => T): T {
  const t0 = performance.now();
  try { return fn(); } catch (e) {
    if (/database is locked|SQLITE_BUSY/i.test(String((e as Error)?.message))) db.locked++;
    throw e;
  } finally {
    const ms = performance.now() - t0;
    db.statements++; db.totalMs += ms;
    const ctx = currentRequest(); if (ctx) { ctx.dbMs = (ctx.dbMs ?? 0) + ms; ctx.dbN = (ctx.dbN ?? 0) + 1; }
    if (ms >= SLOW_STATEMENT_MS) db.slow++;
    if (ms > db.maxMs) { db.maxMs = ms; db.maxSql = sql.replace(/\s+/g, ' ').slice(0, 80); }
  }
}

/**
 * Time every statement of this handle. The handle object itself is kept (node:sqlite's backup() needs the real DatabaseSync); only its
 * `prepare` and `exec` are wrapped, and each prepared statement's run/get/all.
 */
export function instrumentDatabase(handle: SqlDatabase): SqlDatabase {
  ensureLoop();
  const h = handle as SqlDatabase & { __timed?: boolean };
  if (h.__timed) return handle;
  const prepare = handle.prepare.bind(handle);
  const exec = handle.exec.bind(handle);
  const wrapStatement = (sql: string, s: SqlStatement): SqlStatement => new Proxy(s, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (typeof v !== 'function') return v;
      if (prop === 'run' || prop === 'get' || prop === 'all') return (...args: unknown[]) => timed(sql, () => v.apply(target, args));
      return v.bind(target);
    },
  });
  Object.defineProperty(h, 'prepare', { value: (sql: string) => wrapStatement(sql, prepare(sql)), configurable: true, writable: true });
  Object.defineProperty(h, 'exec', { value: (sql: string) => timed(sql, () => exec(sql)), configurable: true, writable: true });
  Object.defineProperty(h, '__timed', { value: true });
  return handle;
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ---- per-route figures (Phase 3): the last ROUTE_RING requests, and totals per route template (bounded)
export const ROUTE_RING = 512;
export const MAX_ROUTES = 300;
export interface RouteSample { route: string; method: string; status: number; ms: number; dbMs: number; dbN: number; at: number }
const recent: Array<RouteSample | undefined> = new Array(ROUTE_RING);
let recentN = 0;
const byRoute = new Map<string, { count: number; totalMs: number; maxMs: number; dbMs: number; errors5xx: number }>();
let routesDropped = 0;

const r1 = (v: number): number => Math.round(v * 10) / 10;

function recordRoute(s: RouteSample): void {
  recent[recentN++ % ROUTE_RING] = s;
  const key = `${s.method} ${s.route}`;
  let a = byRoute.get(key);
  if (!a) {
    if (byRoute.size >= MAX_ROUTES) { routesDropped++; return; }
    a = { count: 0, totalMs: 0, maxMs: 0, dbMs: 0, errors5xx: 0 }; byRoute.set(key, a);
  }
  a.count++; a.totalMs += s.ms; a.dbMs += s.dbMs; if (s.ms > a.maxMs) a.maxMs = s.ms; if (s.status >= 500) a.errors5xx++;
}

/** The slowest of the last ROUTE_RING requests, and the routes with the highest mean (route templates only, never ids or file names). */
export function routeFigures(top = 20): { recentSlowest: RouteSample[]; routesByMean: Array<{ route: string; count: number; meanMs: number; maxMs: number; meanDbMs: number; errors5xx: number }>; tracked: number; dropped: number; ring: number } {
  const xs = recent.filter((x): x is RouteSample => !!x).sort((a, b) => b.ms - a.ms).slice(0, top);
  const routes = [...byRoute].map(([route, a]) => ({ route, count: a.count, meanMs: r1(a.totalMs / a.count), maxMs: r1(a.maxMs), meanDbMs: r1(a.dbMs / a.count), errors5xx: a.errors5xx }))
    .sort((a, b) => b.meanMs - a.meanMs).slice(0, top);
  return { recentSlowest: xs, routesByMean: routes, tracked: byRoute.size, dropped: routesDropped, ring: Math.min(recentN, ROUTE_RING) };
}

/** Express middleware: request time of every /api request into the ring buffers, and the Server-Timing header of its answer. */
export function requestMetrics(r: Request, res: Response, next: NextFunction): void {
  if (!r.path.startsWith('/api/')) { next(); return; }
  ensureLoop();
  const t0 = performance.now();
  req.inFlight++; if (req.inFlight > req.maxInFlight) req.maxInFlight = req.inFlight;
  // the request context is made by the next middleware; the first database statement or the answer's head reads it from the async context
  let ctx: ReturnType<typeof currentRequest>;
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: unknown[]) {
    ctx = ctx ?? currentRequest();
    if (!res.headersSent && !res.getHeader('Server-Timing')) {
      const dbMs = ctx?.dbMs ?? 0; const dbN = ctx?.dbN ?? 0;
      res.setHeader('Server-Timing', `db;dur=${dbMs.toFixed(1)};desc="${dbN} statements", total;dur=${(performance.now() - t0).toFixed(1)}`);
    }
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  } as typeof res.writeHead;
  let done = false;
  const finish = (): void => {
    if (done) return; done = true;
    req.inFlight--;
    const ms = performance.now() - t0;
    req.ring[req.n++ % RING] = ms; req.total++;
    if (WRITE.has(r.method)) req.writes[req.wn++ % RING] = ms;
    if (res.statusCode >= 500) req.errors5xx++;
    recordRoute({ route: routeOf(r), method: r.method, status: res.statusCode, ms: r1(ms), dbMs: r1(ctx?.dbMs ?? 0), dbN: ctx?.dbN ?? 0, at: Date.now() });
  };
  res.on('finish', finish); res.on('close', finish);
  next();
}

/** The event-loop delay histogram (ms): percentiles, mean, deviation, and the number of samples, since the last reset. */
export function eventLoopHistogram(): { count: number; min: number; mean: number; stddev: number; max: number; percentiles: Record<string, number> } {
  const l = ensureLoop();
  const percentiles: Record<string, number> = {};
  for (const p of [50, 75, 90, 95, 99, 99.9]) percentiles[`p${p}`] = ms(l.percentile(p));
  const ns = (v: number): number => (Number.isFinite(v) ? ms(v) : 0);
  return { count: Number((l as IntervalHistogram & { count?: number }).count ?? 0), min: ns(l.min), mean: ns(l.mean), stddev: ns(l.stddev), max: ns(l.max), percentiles };
}

/** The live gauges (WebSocket clients, presence entries, ...). */
export function liveGauges(): Record<string, number> {
  const live: Record<string, number> = {};
  for (const [k, g] of gauges) { try { live[k] = g(); } catch { live[k] = -1; } }
  return live;
}

function percentiles(buf: Float64Array, n: number): { count: number; p50: number; p95: number; p99: number; max: number } {
  const k = Math.min(n, RING);
  if (!k) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const xs = Array.from(buf.subarray(0, k)).sort((a, b) => a - b);
  const at = (p: number): number => Math.round(xs[Math.min(k - 1, Math.floor(p * k))] * 10) / 10;
  return { count: n, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: Math.round(xs[k - 1] * 10) / 10 };
}

const ms = (ns: number): number => Math.round((ns / 1e6) * 10) / 10;

export interface MetricsSnapshot {
  since: string; seconds: number; pid: number; rssMb: number; heapMb: number;
  eventLoop: { p50: number; p99: number; max: number; mean: number };
  db: { statements: number; meanMs: number; maxMs: number; maxSql: string; slow: number; slowThresholdMs: number; locked: number };
  requests: { count: number; p50: number; p95: number; p99: number; max: number; inFlight: number; maxInFlight: number; errors5xx: number;
    writes: { count: number; p50: number; p95: number; p99: number; max: number } };
  live: Record<string, number>;
  /** addendum 17 section 3: the figures that say "time to look at the PostgreSQL tier" */
  d21: { writeP95Over200ms: boolean; eventLoopP99Over100ms: boolean };
}

export function snapshot(): MetricsSnapshot {
  const l = ensureLoop();
  const mem = process.memoryUsage();
  const live: Record<string, number> = {};
  for (const [k, g] of gauges) { try { live[k] = g(); } catch { live[k] = -1; } }
  const all = percentiles(req.ring, req.total); const writes = percentiles(req.writes, req.wn);
  const loopP99 = ms(l.percentile(99));
  return {
    since: new Date(windowStart).toISOString(), seconds: Math.round((Date.now() - windowStart) / 1000), pid: process.pid,
    rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576),
    eventLoop: { p50: ms(l.percentile(50)), p99: loopP99, max: ms(l.max), mean: ms(l.mean) },
    db: { statements: db.statements, meanMs: db.statements ? Math.round((db.totalMs / db.statements) * 100) / 100 : 0, maxMs: Math.round(db.maxMs * 10) / 10, maxSql: db.maxSql, slow: db.slow, slowThresholdMs: SLOW_STATEMENT_MS, locked: db.locked },
    requests: { ...all, inFlight: req.inFlight, maxInFlight: req.maxInFlight, errors5xx: req.errors5xx, writes },
    live,
    d21: { writeP95Over200ms: writes.p95 > 200, eventLoopP99Over100ms: loopP99 > 100 },
  };
}

/** Start a new measuring window (the counters, the histogram and the ring buffers; live gauges are not counters). */
export function reset(): void {
  ensureLoop().reset();
  windowStart = Date.now();
  Object.assign(db, { statements: 0, totalMs: 0, maxMs: 0, slow: 0, locked: 0, maxSql: '' });
  req.n = 0; req.wn = 0; req.total = 0; req.errors5xx = 0; req.maxInFlight = req.inFlight;
  recent.fill(undefined); recentN = 0; byRoute.clear(); routesDropped = 0;
}
