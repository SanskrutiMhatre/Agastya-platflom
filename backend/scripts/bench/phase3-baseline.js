'use strict';
// Phase 3 performance baseline (docs/phase3/DECISIONS.md P3-3: no rewrite, optimise in place; this file says where the time and memory go).
// Reuses the ideas of wp17-bench.js (raw node:http keep-alive, because fetch quantises to 15.6 ms on Windows; the package import as the real
// writer path) but runs the REAL server as a separate process (`node dist/index.js`, worker-mode jobs, warm FOP in the workers), so its memory,
// the job workers and the FOP JVMs are measured as they run in the product, and the harness's own memory is not mixed in.
//
//   node scripts/bench/phase3-baseline.js [--port 4301] [--only api,validation,pdf,ws] [--dms 1000] [--val 200] [--pdfdms 100]
//                                         [--seq 20] [--conc 10] [--rounds 5] [--sockets 50] [--out FILE.json] [--md FILE.md] [--keep]
//                                         [--cpuprof DIR]   (the server process runs with --cpu-prof; profile written when it stops)
//
// Sections (each one optional with --only):
//   api         seq (one at a time) and conc (10 at once, `--rounds` batches) latencies of overview, workspace, projects, summary, release, dms,
//               explore, pmc, save, create on a small project (the S1000D sample) and on a `--dms` module project; the Server-Timing db share
//   validation  `--val` modules: the first run of a fresh server (cold worker, cold schemas), a fresh run in the warm worker, a cached run,
//               and a fresh run after one module changed; with BREX
//   pdf         S1000D sample, JSS Land sample, JSG handbook sample, and a `--pdfdms` module S1000D publication: wall time and the stage
//               timings from the build's own log (validate, xslt, fop), peak server RSS and peak FOP JVM working set while it builds
//   ws          WebSocket fan-out: `--sockets` sockets (5 per person) on one project; one person's presence change and a check-out reach
//               every other socket: time to the last and the p95 socket
// Always: the server's memory (RSS, heap, workers, JVMs) and event-loop delay after each section (GET /api/admin/perf).
//
// Never uses ports 4040/4041/4050/4060/4061; the workspace is a throwaway folder (removed at the end unless --keep). Build first: npx tsc -p .
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http'); const { spawn } = require('child_process');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const PORT = Number(opt('port', 4301));
const ONLY = new Set(String(opt('only', 'api,validation,pdf,ws')).split(',').filter(Boolean));
const N_DMS = Number(opt('dms', 1000)); const N_VAL = Number(opt('val', 200)); const N_PDF = Number(opt('pdfdms', 100));
const SEQ = Number(opt('seq', 20)); const CONC = Number(opt('conc', 10)); const ROUNDS = Number(opt('rounds', 5)); const SOCKETS = Number(opt('sockets', 50));
const OUT = opt('out', ''); const MD = opt('md', ''); const KEEP = flag('keep');
const CPUPROF = opt('cpuprof', '');          // a folder: the server runs with --cpu-prof (summarise with scripts/bench/cpuprofile-top.js)
if ([4040, 4041, 4050, 4060, 4061].includes(PORT)) { console.error(`port ${PORT} belongs to another run (4040/4041 the real server, 4050/4060/4061 the test suites)`); process.exit(2); }

const BACKEND = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(BACKEND, '..');
const FIX = path.join(ROOT, 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');
const WS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-p3bench-'));
process.env.AGASTYA_WORKSPACE_DIR = WS_DIR;               // belt and braces: nothing in this process may open the developer's workspace
const PW = 'Correct-Horse-9!';

const now = () => process.hrtime.bigint();
const msSince = (t) => Number(now() - t) / 1e6;
const r2 = (v) => Math.round(v * 100) / 100;
function stats(xs) {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, median: r2(q(0.5)), p95: r2(q(0.95)), max: r2(s[s.length - 1]), min: r2(s[0]), mean: r2(s.reduce((a, b) => a + b, 0) / s.length) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the server under test --------------------------------------------------------------------------------------------------------
function startServer() {
  const env = { ...process.env, PORT: String(PORT), AGASTYA_HOST: '127.0.0.1', AGASTYA_WORKSPACE_DIR: WS_DIR, AGASTYA_SHUTDOWN_ON_STDIN_CLOSE: '1',
    // phase 7: the db detail of Server-Timing is for administrators only by default; the bench measures as authors, so it asks for all
    AGASTYA_SERVER_TIMING: process.env.AGASTYA_SERVER_TIMING || 'full' };
  const dist = path.join(ROOT, 'frontend', 'dist'); if (fs.existsSync(path.join(dist, 'index.html'))) env.AGASTYA_CLIENT_DIST = dist;
  const prof = CPUPROF ? ['--cpu-prof', `--cpu-prof-dir=${path.resolve(CPUPROF)}`] : [];
  const child = spawn(process.execPath, [...prof, path.join(BACKEND, 'dist', 'index.js')], { cwd: BACKEND, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const log = []; const keep = (d) => { log.push(String(d)); if (log.length > 400) log.shift(); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  return { child, log };
}
async function waitHealthy(ms = 60_000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { const r = await raw('GET', '/api/health'); if (r.status === 200) return; } catch { /* not yet */ }
    await sleep(250);
  }
  throw new Error('the server did not answer /api/health');
}
function stopServer(s) {
  return new Promise((resolve) => {
    let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
    s.child.on('exit', fin);
    try { s.child.stdin.end(); } catch { /* gone */ }
    setTimeout(() => { try { s.child.kill(); } catch { /* gone */ } setTimeout(fin, 2000); }, 20_000).unref();
  });
}

// ---- HTTP ---------------------------------------------------------------------------------------------------------------------------
const agent = new http.Agent({ keepAlive: true, maxSockets: 32 });
function raw(method, url, body, headers = {}, cookie = '') {
  return new Promise((resolve, reject) => {
    const hd = { ...headers }; if (cookie) hd.cookie = cookie;
    let payload = null;
    if (body !== undefined && !(body instanceof Buffer)) { payload = Buffer.from(JSON.stringify(body)); hd['content-type'] = 'application/json'; }
    else if (body instanceof Buffer) payload = body;
    if (payload) hd['content-length'] = payload.length;
    const t = now();
    const rq = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers: hd, agent }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => {
        const ms = msSince(t); const buf = Buffer.concat(chunks); let json = null;
        if (String(res.headers['content-type'] || '').includes('json')) { try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ } }
        resolve({ status: res.statusCode, json, bytes: buf.length, ms, headers: res.headers });
      });
    });
    rq.on('error', reject); if (payload) rq.write(payload); rq.end();
  });
}
class C {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(method, url, body, headers) {
    const r = await raw(method, url, body, headers, this.cookie);
    const set = r.headers['set-cookie']; if (set) this.cookie = String(set[0]).split(';')[0];
    return r;
  }
  get(u) { return this.req('GET', u); } post(u, b) { return this.req('POST', u, b ?? {}); } put(u, b) { return this.req('PUT', u, b); } del(u) { return this.req('DELETE', u); }
}
const must = (r, what, ok = [200, 201]) => { if (!ok.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`); return r; };
/** `db;dur=1.2;desc="5 statements", total;dur=8.0` -> { db, dbN, total } */
function serverTiming(h) {
  const v = String(h['server-timing'] || ''); const m = /db;dur=([0-9.]+);desc="(\d+) statements"/.exec(v); const t = /total;dur=([0-9.]+)/.exec(v);
  return { db: m ? Number(m[1]) : null, dbN: m ? Number(m[2]) : null, total: t ? Number(t[1]) : null };
}

// multipart for the package import (one file field + text fields)
function multipart(fields, fileField, fileName, data) {
  const b = `----p3bench${Date.now().toString(16)}`; const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: application/zip\r\n\r\n`), data, Buffer.from(`\r\n--${b}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${b}` };
}

// ---- data ---------------------------------------------------------------------------------------------------------------------------
const tplName = fs.readdirSync(FIX).find((f) => f.includes('-040A-D_')); const TPL = fs.readFileSync(path.join(FIX, tplName), 'utf8');
function moduleXml(i, pad = '') {
  const attrs = `systemDiffCode="A" systemCode="${String(Math.floor(i / 10000) % 100).padStart(2, '0')}" subSystemCode="${Math.floor(i / 1000) % 10}" subSubSystemCode="${Math.floor(i / 100) % 10}" assyCode="${String(i % 100).padStart(2, '0')}" disassyCode="00" disassyCodeVariant="A"`;
  let xml = TPL.replace(/(<dmCode\s)[^>]*?(infoCode=)/, `$1modelIdentCode="EXAMPLE" ${attrs} $2`).replace(/<techName>[^<]*<\/techName>/, `<techName>Perf module ${i}</techName>`);
  if (pad) xml = xml.replace('</description>', pad + '</description>');
  const code = /<dmIdent>[\s\S]*?<dmCode\s+([^>]*?)\s*\/>/.exec(xml)[1]; const a = Object.fromEntries([...code.matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
  const dmc = `${a.modelIdentCode}-${a.systemDiffCode}-${a.systemCode}-${a.subSystemCode}${a.subSubSystemCode}-${a.assyCode}-${a.disassyCode}${a.disassyCodeVariant}-${a.infoCode}${a.infoCodeVariant}-${a.itemLocationCode}`;
  return { xml, file: `DMC-${dmc}_001-00_EN-US.XML`, ref: `<dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef>` };
}
const S1K = { pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } };

(async () => {
  const out = {
    kind: 'agastya-phase3-baseline', version: 1, at: new Date().toISOString(), node: process.version, platform: `${process.platform} ${os.release()}`,
    cpus: os.cpus().length, cpu: os.cpus()[0]?.model, totalMemMB: Math.round(os.totalmem() / 1048576), freeMemMB: Math.round(os.freemem() / 1048576),
    params: { port: PORT, dms: N_DMS, val: N_VAL, pdfdms: N_PDF, seq: SEQ, conc: CONC, rounds: ROUNDS, sockets: SOCKETS, only: [...ONLY] },
    server: {}, results: {}, memory: {}, eventLoop: {}, routesByPhase: {}, routes: null, errors: [],
  };
  const srv = startServer();
  const t0 = now();
  try {
    await waitHealthy();
    out.server.bootMs = Math.round(msSince(t0));
    const Z = require(path.join(BACKEND, 'dist', 'services', 'zipio'));

    const admin = new C('admin'); must(await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Bench Admin' }), 'setup');
    if (!admin.cookie) must(await admin.post('/api/auth/login', { username: 'admin', password: PW }), 'admin login');
    async function person(name) {
      const m = must(await admin.post('/api/team/users', { username: name, fullName: `${name} Bench`, role: 'author' }), 'user');
      const c = new C(name); must(await c.post('/api/auth/login', { username: name, password: m.json.tempPassword }), 'login');
      must(await c.post('/api/auth/onboarding', { username: name, password: PW }), 'onboarding'); return c;
    }
    const w = await person('bench');
    const perf = async (label, osList = true) => {
      const p = must(await admin.get(`/api/admin/perf?top=25${osList ? '' : '&os=0'}`), 'perf').json;
      out.memory[label] = { rssMb: p.memory.rssMb, heapUsedMb: p.memory.heapUsedMb, workers: (p.renderer?.workers ?? []).map((x) => x.workingSetMb), jvmWorkingSetMb: p.renderer?.jvmWorkingSetMb ?? null, jvms: p.renderer?.jvms?.length ?? null };
      out.eventLoop[label] = { p50: p.eventLoop.percentiles.p50, p99: p.eventLoop.percentiles.p99, max: p.eventLoop.max, mean: p.eventLoop.mean };
      // the metrics window is reset before each section, so the route figures are kept per section and merged at the end
      out.routesByPhase[label] = { slowest: p.routes.recentSlowest.slice(0, 10), byMean: p.routes.routesByMean };
      return p;
    };
    const resetWindow = async () => must(await admin.post('/api/admin/metrics/reset', {}), 'reset');
    await perf('idle-after-boot');

    async function importProject(name, n, pad = '') {
      const pid = must(await w.post('/api/projects', { name, ...S1K }), 'project').json.project.id;
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'p3bench-pkg-')); const zp = path.join(work, 'p.zip'); const zw = new Z.ZipStreamWriter(fs.createWriteStream(zp)); const refs = [];
      for (let i = 1; i <= n; i++) { const m = moduleXml(i, pad); refs.push(m.ref); await zw.addBuffer(`csdb/${m.file}`, Buffer.from(m.xml)); }
      await zw.addBuffer('publication.xml', Buffer.from(`<?xml version="1.0"?><pm><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="EXAMPLE" pmIssuer="00000" pmNumber="00001" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="GB"/><issueInfo issueNumber="001" inWork="00"/></pmIdent><pmAddressItems><issueDate year="2025" month="01" day="01"/><pmTitle>Perf</pmTitle><shortPmTitle>P</shortPmTitle></pmAddressItems></pmAddress><pmStatus><security securityClassification="01"/></pmStatus></identAndStatusSection><content>${refs.map((r, i) => `<pmEntry><pmEntryTitle>M${i + 1}</pmEntryTitle>${r}</pmEntry>`).join('')}</content></pm>`));
      await zw.finish();
      const mp = multipart({ replacePm: '1', skipChecks: '1' }, 'file', 'p.zip', fs.readFileSync(zp));
      fs.rmSync(work, { recursive: true, force: true });
      const t = now(); const imp = await w.req('POST', `/api/projects/${pid}/packages/import`, mp.body, { 'content-type': mp.type }); const importMs = msSince(t);
      must(imp, 'import', [200]);
      return { pid, importMs: Math.round(importMs) };
    }

    // ── api ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    if (ONLY.has('api')) {
      const sample = must(await w.post('/api/projects/sample', {}), 'sample').json.project.id;
      let createSeq = 50_000;
      async function apiSet(pid, label) {
        const U = `/api/projects/${pid}`; const res = {};
        const reads = [['overview', '/api/overview'], ['workspace', '/api/workspace'], ['projects', '/api/projects'], ['summary', `${U}/summary`], ['release', `${U}/release`], ['dms', `${U}/dms`], ['explore', `${U}/explore`], ['pmc', `${U}/pmc`]];
        // the event-loop delay of each endpoint's own measuring window (which step blocks the server thread)
        const loopMax = async () => { const p = must(await admin.get('/api/admin/perf?os=0&top=1'), 'perf').json; return { p99: p.eventLoop.percentiles.p99, max: p.eventLoop.max }; };
        for (const [k, u] of reads) {
          await resetWindow();
          const seq = []; const db = []; let bytes = 0;
          for (let i = 0; i < 2; i++) must(await w.get(u), k);                 // warm caches the way a person moving around does
          for (let i = 0; i < SEQ; i++) { const r = must(await w.get(u), k); seq.push(r.ms); const st = serverTiming(r.headers); if (st.db != null) db.push(st.db); bytes = r.bytes; }
          const conc = []; const wall = [];
          for (let b = 0; b < ROUNDS; b++) { const t = now(); const rs = await Promise.all(Array.from({ length: CONC }, () => w.get(u))); wall.push(msSince(t)); for (const r of rs) { must(r, k); conc.push(r.ms); } }
          res[k] = { seq: stats(seq), conc: stats(conc), concBatchWall: stats(wall), serverDbMs: stats(db), bytes, eventLoop: await loopMax() };
        }
        await resetWindow();
        // save: one module at a time (sequential), and CONC different modules at once
        const list = must(await w.get(`${U}/dms`), 'dms').json; const files = (list.dms ?? list.items ?? list).map((d) => d.file ?? d.name ?? d).filter((f) => typeof f === 'string' && /^DMC-/i.test(f));
        const docs = {};
        for (const f of files.slice(0, CONC)) { const d = must(await w.get(`${U}/dms/${encodeURIComponent(f)}`), 'read').json; docs[f] = { xml: d.xml, hash: d.hash }; }
        const bump = (f, i) => { const d = docs[f]; const xml = /<techName>[^<]*<\/techName>/.test(d.xml) ? d.xml.replace(/<techName>([^<]*?)( v\d+)?<\/techName>/, `<techName>$1 v${i}</techName>`) : d.xml.replace('</dmodule>', `<!-- v${i} --></dmodule>`); return xml; };
        const save1 = []; const first = files[0];
        for (let i = 0; i < SEQ; i++) { const xml = bump(first, i); const r = must(await w.put(`${U}/dms/${encodeURIComponent(first)}`, { xml, baseHash: docs[first].hash }), 'save'); docs[first] = { xml, hash: r.json.hash }; save1.push(r.ms); }
        const saveC = []; const saveWall = [];
        for (let b = 0; b < ROUNDS; b++) {
          const t = now();
          const rs = await Promise.all(files.slice(0, CONC).map(async (f) => { const xml = bump(f, 1000 + b); const r = must(await w.put(`${U}/dms/${encodeURIComponent(f)}`, { xml, baseHash: docs[f].hash }), 'save conc'); docs[f] = { xml, hash: r.json.hash }; return r; }));
          saveWall.push(msSince(t)); for (const r of rs) saveC.push(r.ms);
        }
        res.save = { seq: stats(save1), conc: stats(saveC), concBatchWall: stats(saveWall), concModules: Math.min(CONC, files.length), eventLoop: await loopMax() };
        await resetWindow();
        // create: new modules one at a time and CONC at once
        const cr1 = []; for (let i = 0; i < SEQ; i++) { const m = moduleXml(createSeq++); const r = must(await w.post(`${U}/dms`, { file: m.file, xml: m.xml }), 'create'); cr1.push(r.ms); }
        const crC = []; const crWall = [];
        for (let b = 0; b < ROUNDS; b++) { const ms = Array.from({ length: CONC }, () => moduleXml(createSeq++)); const t = now(); const rs = await Promise.all(ms.map((m) => w.post(`${U}/dms`, { file: m.file, xml: m.xml }))); crWall.push(msSince(t)); for (const r of rs) { must(r, 'create conc'); crC.push(r.ms); } }
        res.create = { seq: stats(cr1), conc: stats(crC), concBatchWall: stats(crWall), eventLoop: await loopMax() };
        const p = await perf(`after-api-${label}`, false);
        res.eventLoopDuring = { p50: p.eventLoop.percentiles.p50, p99: p.eventLoop.percentiles.p99, max: p.eventLoop.max };
        res.slowestRoutes = p.routes.routesByMean.slice(0, 12);
        return res;
      }
      out.results.apiSmall = { project: 'S1000D sample', modules: (must(await w.get(`/api/projects/${sample}/summary`), 'summary').json.dataModules?.total) ?? null, ...(await apiSet(sample, 'small')) };
      const big = await importProject('Bench 1000', N_DMS);
      out.results.import = { modules: N_DMS, importMs: big.importMs };
      await perf('after-import-1000');
      out.results.apiLarge = { project: `${N_DMS} modules`, modules: N_DMS, ...(await apiSet(big.pid, 'large')) };
    }

    // ── validation ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    if (ONLY.has('validation')) {
      const v = await importProject('Bench validation', N_VAL, '<!-- val -->'); const U = `/api/projects/${v.pid}`; const r = { modules: N_VAL };
      const run = async (body) => { const t = now(); const x = must(await w.post(`${U}/validation`, body), 'validation'); return { ms: Math.round(msSince(t)), summary: x.json?.run?.summary, cached: !!x.json?.run?.cached }; };
      await resetWindow();
      r.coldFirstRun = await run({ brex: true, fresh: true });                 // the first validation of this server: worker, schemas and BREX cold
      r.warmFresh = []; for (let i = 0; i < 3; i++) r.warmFresh.push(await run({ brex: true, fresh: true }));
      r.warmNoBrexFresh = await run({ brex: false, fresh: true });
      r.cached = await run({ brex: true });
      const one = moduleXml(3, '<!-- val -->').file; const cur = must(await w.get(`${U}/dms/${one}`), 'read').json;
      must(await w.put(`${U}/dms/${one}`, { xml: cur.xml.replace(/<techName>[^<]*<\/techName>/, '<techName>Changed</techName>'), baseHash: cur.hash }), 'save');
      r.afterOneEdit = await run({ brex: true });
      r.warmFreshMedianMs = stats(r.warmFresh.map((x) => x.ms)).median;
      const p = await perf('after-validation');
      r.eventLoopDuring = { p50: p.eventLoop.percentiles.p50, p99: p.eventLoop.percentiles.p99, max: p.eventLoop.max };
      out.results.validation = r;
    }

    // ── pdf ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    if (ONLY.has('pdf')) {
      /** sample the server and JVM memory every second while `fn` runs */
      async function sampled(fn) {
        let peak = { rssMb: 0, jvmWorkingSetMb: 0, workerMb: 0 }; let on = true;
        const loop = (async () => { while (on) { try { const p = (await admin.get('/api/admin/perf?top=1&fresh=1')).json; if (p) { peak.rssMb = Math.max(peak.rssMb, p.memory.rssMb); peak.jvmWorkingSetMb = Math.max(peak.jvmWorkingSetMb, p.renderer?.jvmWorkingSetMb ?? 0); peak.workerMb = Math.max(peak.workerMb, ...(p.renderer?.workers ?? []).map((x) => x.workingSetMb ?? 0), 0); } } catch { /* next */ } await sleep(3000); } })();   // the process list costs a PowerShell start: not more often
        try { return { value: await fn(), peak }; } finally { on = false; await loop; }
      }
      /** the build's log lines -> stage timings: validate (gate), xslt (front matter, map, FO), fop (PDF), plus the engine's own breakdown */
      async function stagesOf(pid, jobId) {
        const j = must(await w.get(`/api/projects/${pid}/jobs/${jobId}`), 'job').json; const job = j.job ?? j;
        const lines = (job.log ?? []).map((l) => ({ at: Date.parse(l.at), message: String(l.message ?? '') }));
        const start = Date.parse(job.startedAt ?? job.createdAt); const end = Date.parse(job.finishedAt ?? '') || (lines.length ? lines[lines.length - 1].at : start);
        const timeline = lines.map((l, i) => ({ t: l.at - start, dur: (i + 1 < lines.length ? lines[i + 1].at : end) - l.at, message: l.message.slice(0, 140) }));
        const st = { queueMs: Date.parse(job.startedAt ?? job.createdAt) - Date.parse(job.createdAt), jobMs: end - start, validate: 0, xslt: 0, fop: 0, other: 0 };
        for (const x of timeline) {
          const m = x.message;
          if (/^Validat|schema|stencil rules/i.test(m)) st.validate += x.dur;
          else if (/Generating PDF|\(FOP\)|FOP via java|warm FOP/i.test(m) && !/^Done/.test(m)) st.fop += x.dur;
          else if (/XSL|FO\b|front|map|book|Rendering|Engine:|transform/i.test(m) && !/^Done/.test(m)) st.xslt += x.dur;
          else if (!/^Done/.test(m)) st.other += x.dur;
        }
        const done = lines.map((l) => l.message).find((m) => /^Done in/.test(m)) ?? '';
        const breakdown = {};
        for (const mm of done.matchAll(/(\w+) ([0-9.]+)(ms|s)\b/g)) breakdown[mm[1]] = Math.round(Number(mm[2]) * (mm[3] === 's' ? 1000 : 1));
        if (breakdown.pdf != null) { st.engineFop = breakdown.pdf; st.engineXslt = (breakdown.fo ?? 0) + (breakdown.front ?? 0) + (breakdown.map ?? 0) + (breakdown.img ?? 0); }
        st.engineBreakdown = breakdown; st.done = done.slice(0, 160);
        return { stages: st, timeline };
      }
      async function build(label, pid, url) {
        const runOne = async () => { const t = now(); const r = must(await w.post(url, {}), `build ${label}`); return { wallMs: Math.round(msSince(t)), totalMs: r.json.totalMs, bytes: r.json.bytes, jobId: r.json.jobId ?? r.headers['x-job-id'] }; };
        const first = await sampled(runOne);
        const second = await sampled(runOne);                              // warm: the worker's JVM and the stylesheets are loaded
        // phase 7: with the build cache (services/buildCache.ts) an unchanged rebuild answers from the last build; `rebuilt` is a real build
        // in the warm worker, after a change that alters no page (a trailing newline in project.json)
        try { fs.appendFileSync(path.join(WS_DIR, 'projects', pid, 'project.json'), '\n'); } catch { /* the third run is then cached too */ }
        const third = await sampled(runOne);
        const s1 = await stagesOf(pid, first.value.jobId); const s2 = await stagesOf(pid, second.value.jobId); const s3 = await stagesOf(pid, third.value.jobId);
        return { first: { ...first.value, peak: first.peak, stages: s1.stages }, warm: { ...second.value, peak: second.peak, stages: s2.stages }, rebuilt: { ...third.value, peak: third.peak, stages: s3.stages }, timelineWarm: s2.timeline, timelineRebuilt: s3.timeline };
      }
      const res = {};
      await resetWindow();
      const s = must(await w.post('/api/projects/sample', {}), 'sample').json.project.id;
      res.s1000dSample = await build('S1000D sample', s, `/api/projects/${s}/publish`);
      const jss = must(await w.post('/api/projects/sample-jss', { domain: 'land' }), 'jss sample').json.project.id;
      res.jssLandSample = await build('JSS Land sample', jss, `/api/projects/${jss}/publish`);
      const jsg = must(await w.post('/api/projects/sample-jsg', { kind: 'uhb' }), 'jsg sample').json.project.id;
      res.jsgUhbSample = await build('JSG handbook sample', jsg, `/api/projects/${jsg}/jsg/build`);
      const big = await importProject(`Bench PDF ${N_PDF}`, N_PDF, '<!-- pdf -->');
      res[`s1000d${N_PDF}`] = await build(`S1000D ${N_PDF} modules`, big.pid, `/api/projects/${big.pid}/publish`);
      const p = await perf('after-pdf');
      res.eventLoopDuring = { p50: p.eventLoop.percentiles.p50, p99: p.eventLoop.percentiles.p99, max: p.eventLoop.max };
      out.results.pdf = res;
    }

    // ── ws ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    if (ONLY.has('ws')) {
      const WebSocket = require(path.join(BACKEND, 'node_modules', 'ws'));
      const pid = must(await w.post('/api/projects', { name: 'Bench WS', ...S1K }), 'ws project').json.project.id;
      const m = moduleXml(77); must(await w.post(`/api/projects/${pid}/dms`, { file: m.file, xml: m.xml }), 'ws module');
      const people = [w]; const perPerson = 5; const nPeople = Math.ceil(SOCKETS / perPerson);
      for (let i = 1; i < nPeople; i++) { const c = await person(`benchws${i}`); must(await w.post(`/api/projects/${pid}/assign`, { username: `benchws${i}`, role: 'editor' }), 'assign'); people.push(c); }
      const open = (c) => new Promise((resolve, reject) => {
        const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { cookie: c.cookie, origin: `http://127.0.0.1:${PORT}` } });
        const waiters = []; s.on('message', (d) => { let msg; try { msg = JSON.parse(String(d)); } catch { return; } const t = now(); for (const x of [...waiters]) if (x.pred(msg)) { waiters.splice(waiters.indexOf(x), 1); x.resolve(t); } });
        s.on('open', () => resolve({ s, wait: (pred, ms = 5000) => new Promise((r) => { const x = { pred, resolve: r }; waiters.push(x); setTimeout(() => { const i = waiters.indexOf(x); if (i >= 0) { waiters.splice(i, 1); r(null); } }, ms); }) }));
        s.on('unexpected-response', (_q, res) => reject(new Error(`ws upgrade ${res.statusCode}`))); s.on('error', reject);
      });
      const socks = []; const t = now();
      for (const c of people) for (let k = 0; k < perPerson && socks.length < SOCKETS; k++) socks.push({ c, ...(await open(c)) });
      const r = { sockets: socks.length, people: people.length, openAllMs: Math.round(msSince(t)) };
      // every socket says it is in the project (as a page does); then the sender's presence changes are announced to the others
      for (const x of socks) x.s.send(JSON.stringify({ type: 'presence', projectId: pid, doc: { kind: 'page', path: 'home' } }));
      await sleep(800);
      const sender = socks[0]; const others = socks.filter((x) => x.c !== sender.c);
      const lastP = []; const p95P = []; const missP = [];
      for (let round = 0; round < 8; round++) {
        const waits = others.map((x) => x.wait((msg) => msg.type === 'presence', 3000));
        const t1 = now(); sender.s.send(JSON.stringify({ type: 'presence', projectId: pid, doc: { kind: 'dm', path: `F${round}` }, mode: round % 2 ? 'editing' : 'viewing' }));
        const at = await Promise.all(waits); const lat = at.filter(Boolean).map((x) => Number(x - t1) / 1e6);
        missP.push(at.length - lat.length); if (lat.length) { lastP.push(Math.max(...lat)); p95P.push(stats(lat).p95); }
        await sleep(700);                                                   // under the per-connection presence rate (20 per 10 s)
      }
      r.presence = { toLastSocket: stats(lastP), p95Socket: stats(p95P), missed: missP.reduce((a, b) => a + b, 0) };
      // a check-out over HTTP announced to every reader
      const lastL = []; const missL = [];
      for (let round = 0; round < 5; round++) {
        const waits = socks.slice(1).map((x) => x.wait((msg) => msg.type === 'leases', 5000));
        const t1 = now(); must(await w.post(`/api/projects/${pid}/dms/${encodeURIComponent(m.file)}/checkout`, {}), 'checkout');
        const at = await Promise.all(waits); const lat = at.filter(Boolean).map((x) => Number(x - t1) / 1e6);
        missL.push(at.length - lat.length); if (lat.length) lastL.push(Math.max(...lat));
        must(await w.del(`/api/projects/${pid}/dms/${encodeURIComponent(m.file)}/checkout`), 'release', [200, 204]);
        await sleep(300);
      }
      r.checkout = { toLastSocket: stats(lastL), missed: missL.reduce((a, b) => a + b, 0) };
      const p = await perf('with-ws-clients', false); r.wsClientsSeen = p.live.wsClients;
      for (const x of socks) { try { x.s.close(); } catch { /* closed */ } }
      out.results.ws = r;
    }

    await perf('end');
    // every route seen in any section, by its highest mean in one section (the whole-run view of the slow routes)
    const merged = new Map();
    for (const [phase, x] of Object.entries(out.routesByPhase)) for (const r of x.byMean) { const m = merged.get(r.route); if (!m || r.meanMs > m.meanMs) merged.set(r.route, { ...r, phase }); }
    out.routes = { routesByMean: [...merged.values()].sort((a, b) => b.meanMs - a.meanMs) };
  } catch (e) {
    out.errors.push(String(e && e.stack || e));
    out.serverLogTail = srv.log.slice(-40).join('').slice(-6000);
  } finally {
    agent.destroy();
    await stopServer(srv);
    if (!KEEP) { try { fs.rmSync(WS_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* a child still holds a file */ } }
    else out.workspace = WS_DIR;
  }
  out.wallSeconds = Math.round(msSince(t0) / 1000);
  const text = JSON.stringify(out, null, 1);
  if (OUT) fs.writeFileSync(OUT, text); else console.log(text);
  if (MD) fs.writeFileSync(MD, markdown(out));
  process.exit(out.errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// ---- markdown summary -----------------------------------------------------------------------------------------------------------------
function markdown(o) {
  const L = [];
  L.push(`# Phase 3 performance baseline (${o.at.slice(0, 10)})`, '');
  L.push(`Machine: ${o.cpu} x ${o.cpus}, ${o.totalMemMB} MB, ${o.platform}, Node ${o.node}. Server boot ${o.server.bootMs ?? '-'} ms. Wall ${o.wallSeconds} s.`, '');
  if (o.errors.length) L.push('**Errors:**', '', '```', ...o.errors, '```', '');
  for (const key of ['apiSmall', 'apiLarge']) {
    const a = o.results[key]; if (!a) continue;
    L.push(`## API latency: ${a.project} (${a.modules} modules)`, '', 'Milliseconds, client side (keep-alive). conc = 10 requests at once, per-request latency; batch wall = time for all 10.', '',
      '| Endpoint | seq median | seq p95 | 10-conc median | 10-conc p95 | batch wall p95 | server db median | loop max | bytes |', '|---|---|---|---|---|---|---|---|---|');
    for (const k of ['overview', 'workspace', 'projects', 'summary', 'release', 'dms', 'explore', 'pmc', 'save', 'create']) {
      const x = a[k]; if (!x) continue;
      L.push(`| ${k} | ${x.seq.median} | ${x.seq.p95} | ${x.conc.median} | ${x.conc.p95} | ${x.concBatchWall.p95} | ${x.serverDbMs?.median ?? '-'} | ${x.eventLoop?.max ?? '-'} | ${x.bytes ?? '-'} |`);
    }
    L.push('', `Event loop over the save and create part: p99 ${a.eventLoopDuring.p99} ms, max ${a.eventLoopDuring.max} ms.`, '');
  }
  if (o.results.import) L.push(`Package import of ${o.results.import.modules} modules: ${o.results.import.importMs} ms.`, '');
  const v = o.results.validation;
  if (v) {
    L.push(`## Validation (${v.modules} modules, BREX on)`, '', '| Run | ms | errors | warnings |', '|---|---|---|---|');
    const row = (n, x) => L.push(`| ${n} | ${x.ms} | ${x.summary?.error ?? '-'} | ${x.summary?.warn ?? '-'} |`);
    row('cold (first of the server)', v.coldFirstRun); v.warmFresh.forEach((x, i) => row(`warm fresh ${i + 1}`, x)); row('warm fresh, no BREX', v.warmNoBrexFresh); row('cached', v.cached); row('after one edit', v.afterOneEdit);
    L.push('');
  }
  const p = o.results.pdf;
  if (p) {
    L.push('## PDF builds', '', '| Build | run | wall ms | job ms | validate | xslt | fop | engine xslt | engine fop | peak server RSS MB | peak JVM MB | PDF KB |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [k, b] of Object.entries(p)) {
      if (!b || !b.first) continue;
      for (const [run, x] of [['first', b.first], ['warm', b.warm], ['rebuilt', b.rebuilt]].filter((e) => e[1])) L.push(`| ${k} | ${run} | ${x.wallMs} | ${x.stages.jobMs} | ${x.stages.validate} | ${x.stages.xslt} | ${x.stages.fop} | ${x.stages.engineXslt ?? '-'} | ${x.stages.engineFop ?? '-'} | ${x.peak.rssMb} | ${x.peak.jvmWorkingSetMb} | ${Math.round((x.bytes ?? 0) / 1024)} |`);
    }
    L.push('');
  }
  const ws = o.results.ws;
  if (ws) L.push('## WebSocket fan-out', '', `${ws.sockets} sockets (${ws.people} people). Presence change to the last socket: median ${ws.presence.toLastSocket.median} ms, p95 ${ws.presence.toLastSocket.p95} ms (missed ${ws.presence.missed}). Check-out notice to the last socket: median ${ws.checkout.toLastSocket.median} ms, max ${ws.checkout.toLastSocket.max} ms (missed ${ws.checkout.missed}).`, '');
  L.push('## Memory and event loop by phase', '', '| Phase | server RSS MB | heap MB | workers MB | JVMs | JVM MB | loop p99 ms | loop max ms |', '|---|---|---|---|---|---|---|---|');
  for (const [k, m] of Object.entries(o.memory)) { const e = o.eventLoop[k] || {}; L.push(`| ${k} | ${m.rssMb} | ${m.heapUsedMb} | ${(m.workers || []).join(' / ') || '-'} | ${m.jvms ?? '-'} | ${m.jvmWorkingSetMb ?? '-'} | ${e.p99 ?? '-'} | ${e.max ?? '-'} |`); }
  L.push('');
  if (o.routes) { L.push('## Slowest routes (highest mean in any section)', '', '| Route | section | count | mean ms | max ms | mean db ms |', '|---|---|---|---|---|---|'); for (const r of o.routes.routesByMean.slice(0, 25)) L.push(`| ${r.route} | ${r.phase} | ${r.count} | ${r.meanMs} | ${r.maxMs} | ${r.meanDbMs} |`); L.push(''); }
  return L.join('\n');
}
