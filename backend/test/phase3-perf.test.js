'use strict';
// Phase 3 performance instrumentation (docs/phase3/ui-and-baseline.md): the Server-Timing header on API answers (total and database time),
// and GET /api/admin/perf (administrators only, read-only): event-loop delay histogram, process memory, WebSocket clients, job queue depth,
// the renderer's JVM memory, and the slowest recent routes by route template (never a concrete id or file name); bounded buffers.

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let author; let pid;

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  const made = await admin.post('/api/team/users', { username: 'perf3', fullName: 'Perf Example', role: 'author' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  author = new h.Client('perf3');
  assert.equal((await author.post('/api/auth/login', { username: 'perf3', password: made.json.tempPassword })).status, 200);
  assert.equal((await author.post('/api/auth/onboarding', { username: 'perf3', password: PW })).status, 200);
  pid = (await author.post('/api/projects', { name: 'Perf instrumentation' })).json.project.id;
});
test.after(async () => { if (h) await h.close(); });

const timing = (res) => {
  const v = res.headers.get('server-timing') || '';
  const part = (name) => { const m = new RegExp(`(?:^|,\\s*)${name};dur=([0-9.]+)(?:;desc="(\\d+) statements")?`).exec(v); return m ? { dur: Number(m[1]), n: m[2] === undefined ? null : Number(m[2]) } : null; };
  return { raw: v, db: part('db'), total: part('total') };
};

test('every API answer carries Server-Timing with the total and the database time of that request', async () => {
  const r = await author.get(`/api/projects/${pid}/summary`);
  assert.equal(r.status, 200);
  const t = timing(r);
  assert.ok(t.total && t.total.dur >= 0, `total in ${t.raw}`);
  assert.ok(t.db && t.db.dur >= 0 && t.db.n > 0, `a summary reads the database: ${t.raw}`);
  assert.ok(t.db.dur <= t.total.dur + 1, 'the database time is part of the total');
  // an error answer carries it too, and a refused request that never reached the database says 0 statements or a few (session lookup)
  const no = await author.get('/api/admin/perf');
  assert.equal(no.status, 403);
  assert.ok(timing(no).total, 'a 403 answer is timed');
});

test('GET /api/admin/perf: administrators only; histogram, memory, live gauges, jobs, renderer, slowest routes by template', async () => {
  assert.equal((await author.get('/api/admin/perf')).status, 403);
  for (let i = 0; i < 6; i++) await author.get(`/api/projects/${pid}/summary`);
  const r = await admin.get('/api/admin/perf?top=5');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = r.json;
  assert.ok(p.eventLoop && p.eventLoop.percentiles.p99 >= p.eventLoop.percentiles.p50 && p.eventLoop.max >= 0);
  assert.ok(p.memory.rssMb > 0 && p.memory.heapUsedMb > 0 && p.memory.heapTotalMb >= p.memory.heapUsedMb);
  assert.ok('wsClients' in p.live, 'WebSocket clients are reported');
  assert.equal(typeof p.jobs.queueDepth, 'number');
  assert.ok(p.renderer && Array.isArray(p.renderer.jvms) && Array.isArray(p.renderer.workers) && typeof p.renderer.jvmWorkingSetMb === 'number');
  assert.ok(p.routes.routesByMean.length > 0 && p.routes.routesByMean.length <= 5, 'top limits the lists');
  assert.ok(p.routes.recentSlowest.length <= 5);
  const all = (await admin.get('/api/admin/perf?top=100&os=0')).json.routes;
  const summary = all.routesByMean.find((x) => x.route === 'GET /api/projects/:id/summary');
  assert.ok(summary && summary.count >= 6 && summary.meanDbMs >= 0, `the summary route is listed by its template: ${JSON.stringify(all.routesByMean)}`);
  assert.ok(!JSON.stringify(all).includes(pid), 'no concrete project id in the route figures');
  // ?os=0 skips the process list
  const fast = await admin.get('/api/admin/perf?os=0');
  assert.equal(fast.status, 200); assert.equal(fast.json.renderer, null);
});

test('the route figures are bounded: the recent ring keeps 512, the per-route table at most 300 templates', async () => {
  const m = require('../dist/services/metrics');
  assert.equal(m.ROUTE_RING, 512); assert.equal(m.MAX_ROUTES, 300);
  for (let i = 0; i < 20; i++) await author.get(`/api/projects/${pid}/no-such-route-${i}`);
  const f = m.routeFigures(100);
  assert.ok(f.ring <= m.ROUTE_RING && f.tracked <= m.MAX_ROUTES);
  // unmatched paths fold into one template, so random URLs cannot grow the table
  assert.ok(f.routesByMean.filter((x) => x.route.includes('no-such-route')).length === 0);
});
