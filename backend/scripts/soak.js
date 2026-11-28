#!/usr/bin/env node
'use strict';
// =============================================================================
// Soak run (audit WP-30, gate G-REL-7): the scripted workflow at a steady load for a long time, watching for drift - memory, handles and
// event-loop delay of the server and of its whole process tree (job workers, their JVMs) - and for crashes.
//
//   node scripts/soak.js [--minutes 60] [--authors 20] [--projects 5] [--sample 60] [--publish-every 300] [--backup-every 900]
//                        [--validate-every 0] [--out soak.json]
//
// What runs, against its OWN server (dist/index.js, a new temporary data folder, a free loopback port; removed afterwards):
//   - the WP-28 multi-user harness (scripts/load-test.js --base ...): N authors reading, checking out, saving with the version guard, racing on a
//     hot module, presence over WebSocket, and the project validation now and then; for the whole run
//   - a PDF publication of the sample project every --publish-every seconds (a job in a worker process: the JVM is the likely leak)
//   - a platform backup every --backup-every seconds (SQLite image + every file + manifest)
// Every --sample seconds: the server's RSS and heap and its event-loop delay for that interval (GET /api/admin/metrics, then reset), and for
// the server and every process below it (PowerShell Get-Process / Win32_Process): working set, private bytes, handle count, thread count.
// At the end: per series the least-squares slope per hour over the samples after the first 10 minutes (warm-up: JIT, caches, the JVM's heap
// growing to its working size) and the median of the first and last sixth; any crash (the server process ending, a 5xx answer) is a failure.
// Limits for the drift are to be set from a baseline (12 section 8.2, G-REL-7): this script REPORTS the slopes; it fails only on a crash, an
// error answer, a failed publish/backup, or a load-test acceptance failure.
//
// The 24-hour soak of G-REL-7 is this script with --minutes 1440 on a quiet reference machine (see docs/audit/RELEASE-EVIDENCE.md).
// Exit 0 = no crash and no failure, 1 = a failure, 2 = could not run.
// =============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const MINUTES = Number(opt('minutes', 60)); const AUTHORS = Number(opt('authors', 20)); const PROJECTS = Number(opt('projects', 5));
const SAMPLE_S = Number(opt('sample', 60)); const PUBLISH_S = Number(opt('publish-every', 300)); const BACKUP_S = Number(opt('backup-every', 900));
const OUT = opt('out');
const PW = 'Soak-Test-Passw0rd!';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

// A session can end during a soak for policy reasons, not faults: single session (the load harness signs in as the same administrator, which
// ends this script's session), the 30-minute idle limit, the 12-hour absolute limit (a 24-hour soak). On a 401 the client signs in again once
// and repeats the request; every such sign-in is counted in the result (relogins), so it stays visible.
let relogins = 0;
class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.creds = null; }
  async req(method, url, body) {
    const r = await this.once(method, url, body);
    if (r.status !== 401 || !this.creds || url.startsWith('/api/auth/')) return r;
    const l = await this.once('POST', '/api/auth/login', this.creds); if (l.status !== 200) return r;
    relogins++; return this.once(method, url, body);
  }
  async once(method, url, body) {
    const headers = {}; if (this.cookie) headers.cookie = this.cookie;
    let payload; if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const t0 = Date.now(); const res = await fetch(this.base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const json = type.includes('json') ? await res.json().catch(() => null) : (await res.arrayBuffer(), null);
    return { status: res.status, json, ms: Date.now() - t0 };
  }
}

/** The server and every process below it: one PowerShell call (Win32_Process for the tree, Get-Process for the counters). */
function treeStats(rootPid) {
  const ps = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name; $ids = New-Object System.Collections.Generic.HashSet[int]; [void]$ids.Add(${rootPid});
    do { $n = $ids.Count; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId) } } } while ($ids.Count -ne $n)
    $out = foreach ($i in $ids) { $g = Get-Process -Id $i -ErrorAction SilentlyContinue; if ($g) { [pscustomobject]@{ pid = $g.Id; name = $g.ProcessName; ws = $g.WorkingSet64; priv = $g.PrivateMemorySize64; handles = $g.HandleCount; threads = $g.Threads.Count } } }
    @($out) | ConvertTo-Json -Compress`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  try { const v = JSON.parse(r.stdout.trim() || '[]'); return Array.isArray(v) ? v : [v]; } catch { return []; }
}

function slopePerHour(points) {     // points: [[tSeconds, value]]
  const n = points.length; if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p[0], 0) / n; const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0; let sxx = 0; for (const [x, y] of points) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  return sxx ? Math.round(((sxy / sxx) * 3600) * 100) / 100 : null;
}
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function main() {
  if (process.platform !== 'win32') console.warn('[soak] not Windows: the process-tree counters are not collected');
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) { console.error('Build the backend first (npx tsc -p . in backend/).'); process.exit(2); }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-soak-'));
  const logFile = path.join(os.tmpdir(), `agastya-soak-${crypto.randomBytes(3).toString('hex')}.log`);
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), AGASTYA_HOST: '127.0.0.1', AGASTYA_WORKSPACE_DIR: workspace, AGASTYA_SHUTDOWN_ON_STDIN_CLOSE: '1' };
  for (const k of Object.keys(env)) if (/^AGASTYA_(TLS|DIRECTORY|MODE|BACKUP_COPY)/.test(k)) delete env[k];
  const out = fs.openSync(logFile, 'a');
  const server = spawn(process.execPath, [path.join(ROOT, 'dist', 'index.js')], { cwd: ROOT, env, stdio: ['pipe', out, out], windowsHide: true });
  let serverExit = null; server.on('exit', (c) => { serverExit = c ?? -1; });
  const started = new Date().toISOString(); const t0 = Date.now();
  const failures = []; const samples = []; const publishes = []; const backups = [];
  let loadChild = null; let loadExit = null;
  try {
    let up = false; for (let i = 0; i < 480 && !up; i++) { try { up = (await fetch(`${base}/api/ready`)).status === 200; } catch { /* not yet */ } if (!up) await sleep(250); }
    if (!up) { console.error(`[soak] the server did not become ready; log ${logFile}`); process.exit(2); }
    const admin = new Client(base);
    if ((await admin.req('POST', '/api/auth/setup', { username: 'admin', password: PW, fullName: 'Soak Admin' })).status !== 200) { console.error('[soak] setup failed'); process.exit(2); }
    admin.creds = { username: 'admin', password: PW };    const made = await admin.req('POST', '/api/team/users', { username: 'soaker', fullName: 'Soaker', role: 'author' });
    const author = new Client(base); await author.req('POST', '/api/auth/login', { username: 'soaker', password: made.json.tempPassword }); await author.req('POST', '/api/auth/onboarding', { username: 'soaker', password: PW });
    author.creds = { username: 'soaker', password: PW };
    const sample = (await author.req('POST', '/api/projects/sample', {})).json.project.id;
    const pwFile = path.join(workspace, '..', `agastya-soak-admin-${process.pid}.txt`); fs.writeFileSync(pwFile, PW);
    console.log(`[soak] server ${base} (pid ${server.pid}, data ${workspace}); ${MINUTES} min, ${AUTHORS} authors on ${PROJECTS} projects, publish every ${PUBLISH_S} s, backup every ${BACKUP_S} s, sample every ${SAMPLE_S} s`);
    const loadOut = path.join(os.tmpdir(), `agastya-soak-load-${process.pid}.json`);
    loadChild = spawn(process.execPath, [path.join(__dirname, 'load-test.js'), '--base', base, '--admin', 'admin', '--admin-password-file', pwFile, '--authors', String(AUTHORS), '--projects', String(PROJECTS),
      '--duration', String(Math.max(60, MINUTES * 60 - 30)), '--warmup', '15', '--out', loadOut], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let loadLog = ''; loadChild.stdout.on('data', (d) => { loadLog += d; }); loadChild.stderr.on('data', (d) => { loadLog += d; });
    const loadDone = new Promise((r) => loadChild.on('exit', (c) => { loadExit = c; r(c); }));

    const end = t0 + MINUTES * 60_000; let nextPub = Date.now() + 30_000; let nextBak = Date.now() + 60_000; let nextSample = Date.now();
    await admin.req('POST', '/api/admin/metrics/reset', {});
    while (Date.now() < end && serverExit === null) {
      const now = Date.now();
      if (now >= nextSample) {
        nextSample += SAMPLE_S * 1000;
        const m = await admin.req('GET', '/api/admin/metrics').catch(() => null); await admin.req('POST', '/api/admin/metrics/reset', {}).catch(() => null);
        const tree = process.platform === 'win32' ? treeStats(server.pid) : [];
        const me = tree.find((p) => p.pid === server.pid) || {};
        const s = { t: Math.round((now - t0) / 1000), rssMb: m?.json?.rssMb, heapMb: m?.json?.heapMb, loopP99: m?.json?.eventLoop?.p99, loopMax: m?.json?.eventLoop?.max, req5xx: m?.json?.requests?.errors5xx,
          serverHandles: me.handles, serverPrivMb: me.priv ? Math.round(me.priv / 1048576) : undefined, serverThreads: me.threads,
          treeProcs: tree.length, treeHandles: tree.reduce((a, p) => a + (p.handles || 0), 0), treePrivMb: Math.round(tree.reduce((a, p) => a + (p.priv || 0), 0) / 1048576),
          java: tree.filter((p) => /java/i.test(p.name)).length };
        samples.push(s);
        if (s.req5xx) failures.push(`${s.req5xx} server error answer(s) in the interval ending at ${s.t} s`);
        console.log(`[soak] t=${s.t}s rss ${s.rssMb} MB heap ${s.heapMb} MB loop p99 ${s.loopP99} max ${s.loopMax} ms | server handles ${s.serverHandles} priv ${s.serverPrivMb} MB | tree ${s.treeProcs} procs ${s.treeHandles} handles ${s.treePrivMb} MB (${s.java} JVM)`);
      }
      if (PUBLISH_S > 0 && now >= nextPub) {
        nextPub += PUBLISH_S * 1000;
        const r = await author.req('POST', `/api/projects/${sample}/publish`, {}).catch((e) => ({ status: 0, ms: 0, error: e.message }));
        publishes.push({ t: Math.round((now - t0) / 1000), status: r.status, ms: r.ms }); if (r.status !== 200) failures.push(`publish at ${Math.round((now - t0) / 1000)} s answered ${r.status}`);
      }
      if (BACKUP_S > 0 && now >= nextBak) {
        nextBak += BACKUP_S * 1000;
        const r = await admin.req('POST', '/api/admin/backups', {}).catch((e) => ({ status: 0, ms: 0, error: e.message }));
        backups.push({ t: Math.round((now - t0) / 1000), status: r.status, ms: r.ms, bytes: r.json?.bytes }); if (r.status !== 200) failures.push(`backup at ${Math.round((now - t0) / 1000)} s answered ${r.status}`);
      }
      await sleep(1000);
    }
    if (serverExit !== null) failures.push(`the server process ended (exit ${serverExit}) at ${Math.round((Date.now() - t0) / 1000)} s; log ${logFile}`);
    await Promise.race([loadDone, sleep(180_000)]);
    try { fs.writeFileSync(`${logFile}.load.txt`, loadLog); } catch { /* temp */ }
    console.log(`[soak] load harness output: ${logFile}.load.txt`);
    if (loadExit !== 0) failures.push(`the load harness ended with ${loadExit}: ${loadLog.split('\n').filter((l) => /ACCEPTANCE|failed|first errors/.test(l)).join(' | ').slice(0, 600)}`);
    let load = null; try { load = JSON.parse(fs.readFileSync(loadOut, 'utf8')); } catch { /* none */ }
    try { fs.rmSync(pwFile, { force: true }); fs.rmSync(loadOut, { force: true }); } catch { /* temp */ }

    const after = samples.filter((s) => s.t >= 600); const sixth = Math.max(1, Math.floor(samples.length / 6));
    const series = ['rssMb', 'heapMb', 'loopP99', 'serverHandles', 'serverPrivMb', 'serverThreads', 'treeHandles', 'treePrivMb', 'treeProcs'];
    const drift = {};
    for (const k of series) {
      const pts = after.filter((s) => Number.isFinite(s[k])).map((s) => [s.t, s[k]]);
      drift[k] = { slopePerHour: slopePerHour(pts), firstMedian: median(samples.slice(0, sixth).map((s) => s[k]).filter(Number.isFinite)), lastMedian: median(samples.slice(-sixth).map((s) => s[k]).filter(Number.isFinite)), min: Math.min(...samples.map((s) => s[k]).filter(Number.isFinite)), max: Math.max(...samples.map((s) => s[k]).filter(Number.isFinite)) };
    }
    const result = {
      script: 'backend/scripts/soak.js', started, minutes: MINUTES, machine: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGb: Math.round(os.totalmem() / 1073741824), platform: `${os.platform()} ${os.release()}`, node: process.version },
      config: { authors: AUTHORS, projects: PROJECTS, sampleS: SAMPLE_S, publishEveryS: PUBLISH_S, backupEveryS: BACKUP_S },
      crashed: serverExit !== null, failures, relogins, drift, publishes, backups, samples,
      load: load && { adminRelogins: load.adminRelogins, totals: load.totals, integrity: load.integrity, notices: load.notices, acceptance: load.acceptance },
    };
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log('\n=== soak summary ===');
    console.log(`${MINUTES} min; server ${result.crashed ? 'CRASHED' : 'stayed up'}; publishes ${publishes.length} (${publishes.filter((p) => p.status === 200).length} ok); backups ${backups.length} (${backups.filter((b) => b.status === 200).length} ok); sessions renewed after a policy 401: ${relogins}`);
    for (const k of series) console.log(`${k.padEnd(14)} first ${drift[k].firstMedian}  last ${drift[k].lastMedian}  min ${drift[k].min}  max ${drift[k].max}  slope/h after 10 min ${drift[k].slopePerHour}`);
    if (load) console.log(`load: ${load.totals.requests} requests, p95 ${load.totals.p95} ms, errors ${load.totals.errors}; integrity: silent overwrites ${load.integrity.silentOverwrites}; ${load.acceptance?.ok ? 'acceptance PASS' : 'acceptance FAIL'}`);
    console.log(failures.length ? `FAILURES: ${failures.join('; ')}` : 'no crash, no failure');
    process.exitCode = failures.length ? 1 : 0;
  } finally {
    if (loadChild && loadExit === null) try { loadChild.kill(); } catch { /* gone */ }
    try { server.stdin.end(); } catch { /* gone */ }
    for (let i = 0; i < 150 && serverExit === null; i++) await sleep(200);
    if (serverExit === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    try { fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* a handle may linger */ }
    console.log(`[soak] server log: ${logFile}`);
  }
}
main().catch((e) => { console.error('[soak] failed:', e.stack || e.message); process.exit(2); });
