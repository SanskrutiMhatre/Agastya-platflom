#!/usr/bin/env node
'use strict';
// =============================================================================
// Multi-user acceptance harness for a Mode B team server (audit WP-28: G-PERF-4, G-REL-4, decision D3; addendum 17 section 2).
//
// N scripted authors work at the same time, each with its own account, session and WebSocket (presence heartbeat), on S1000D projects:
// they read data modules and lists, check out their own module, save it with its version and check it in, race each other on a shared
// "hot" module without a check-out (the version guard must refuse every stale save), look at who is working where, and now and then run
// the project validation. The harness measures every request (p50 / p95 / p99 / max per action), counts errors, conflicts and refusals,
// the time from a check-out until every other reader of the project is told (PRD-003: within 5 seconds), and reads the server's own figures
// (GET /api/admin/metrics: event-loop delay, statement time, slow statements = lock waits, request percentiles). At the end it proves that
// no accepted save was silently overwritten: per module, the accepted saves must form ONE chain from the first version to the version on
// the server (two accepted saves made from the same version would be a lost update).
//
//   node scripts/load-test.js [--authors 50] [--projects 10] [--duration 120] [--warmup 15] [--think 1000-3000]
//                             [--no-validate] [--drill] [--keep] [--out result.json] [--profile <dir>]
//        Starts its own server (dist/index.js) on a free loopback port with a NEW temporary data folder, seeds it, runs, stops it and
//        removes the folder (unless --keep). --drill then times a restore drill on that data: platform backup, restore into a new folder,
//        a server started on it, an author signed in and her module read (the RTO components of PRD-007 for this data size).
//   node scripts/load-test.js --base https://docs.example.local:4040 --admin <user> --admin-password-file <file> [same options]
//        Runs against a server that is already running (a real Mode B install; the harness on one or several client machines). It creates
//        load-test accounts (load-<run>-NN) and projects there: use a test server, never production. With a private CA set
//        NODE_EXTRA_CA_CERTS=<ca.pem> so the harness trusts the server certificate.
//
// Exit code 0 = ran and the acceptance held (0 errors, 0 silent overwrites, notices within 5 s), 1 = an acceptance figure failed,
// 2 = could not run (arguments, server, seeding).
// The figures depend on the machine: say which one, how many cores, and what else was running when you report them.
// =============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { monitorEventLoopDelay, performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);
if (flag('help') || flag('h')) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 28).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }

const AUTHORS = Number(opt('authors', 50));
const PROJECTS = Number(opt('projects', 10));
const DURATION_S = Number(opt('duration', 120));
const WARMUP_S = Number(opt('warmup', 15));
const [THINK_MIN, THINK_MAX] = String(opt('think', '1000-3000')).split('-').map(Number);
const VALIDATE = !flag('no-validate');
const OUT = opt('out');
const BASE_ARG = opt('base');
const PW = 'Load-Test-Passw0rd!';
const RUN = crypto.randomBytes(3).toString('hex');
const SAMPLE = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const CLIENT_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'package.json'), 'utf8')).version;
const NOTICE_LIMIT_MS = 5000;

if (![AUTHORS, PROJECTS, DURATION_S, WARMUP_S, THINK_MIN, THINK_MAX].every((n) => Number.isFinite(n) && n >= 0) || AUTHORS < 2 || PROJECTS < 1) {
  console.error('Bad arguments (see --help).'); process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const between = (a, b) => a + Math.random() * Math.max(0, b - a);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── measurements ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let measuring = false;
const lat = new Map();           // action -> [ms]
const codes = new Map();         // action -> { status: count }
const errors = [];               // { action, status, message }
const notices = [];              // ms from check-out request to a reader's 'leases' message
const saves = new Map();         // file key -> [{ base, hash }]
let wsMessages = 0; let wsDrops = 0;
function record(action, ms, status) {
  if (!measuring) return;
  if (!lat.has(action)) { lat.set(action, []); codes.set(action, {}); }
  lat.get(action).push(ms);
  const c = codes.get(action); c[status] = (c[status] ?? 0) + 1;
}
const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };
const harnessLoop = monitorEventLoopDelay({ resolution: 10 }); harnessLoop.enable();

// ── HTTP client per author ───────────────────────────────────────────────────────────────────────────────────────────────────────────
let BASE = BASE_ARG ? BASE_ARG.replace(/\/$/, '') : '';
class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(action, method, url, body, expect = [200]) {
    const headers = { 'x-agastya-client': CLIENT_VERSION, origin: BASE };
    if (this.cookie) headers.cookie = this.cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const t0 = performance.now();
    let res; let json = null;
    try {
      res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0];
      const text = await res.text();
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    } catch (e) {
      const ms = performance.now() - t0;
      record(action, ms, 'neterr');
      if (measuring) errors.push({ action, status: 'network', message: e.message });
      return { status: 0, json: null, ms };
    }
    const ms = performance.now() - t0;
    record(action, ms, res.status);
    if (measuring && !expect.includes(res.status)) errors.push({ action, status: res.status, message: JSON.stringify(json)?.slice(0, 200) });
    return { status: res.status, json, ms };
  }
}

async function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.unref(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

async function waitReady(base, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`${base}/api/ready`); if (r.status === 200) return true; } catch { /* not yet */ }
    await sleep(250);
  }
  return false;
}

function startServer(workspace, port, logFile) {
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), AGASTYA_HOST: '127.0.0.1', AGASTYA_WORKSPACE_DIR: workspace, AGASTYA_SHUTDOWN_ON_STDIN_CLOSE: '1' };
  for (const k of Object.keys(env)) if (/^AGASTYA_(TLS|DIRECTORY|MODE|BACKUP_COPY)/.test(k)) delete env[k];
  const out = fs.openSync(logFile, 'a');
  // --profile <dir>: a V8 CPU profile of the server (written when it stops), to see where the time goes at the ceiling
  const prof = opt('profile'); const nodeArgs = prof ? ['--cpu-prof', `--cpu-prof-dir=${path.resolve(prof)}`] : [];
  const child = spawn(process.execPath, [...nodeArgs, path.join(ROOT, 'dist', 'index.js')], { cwd: ROOT, env, stdio: ['pipe', out, out], windowsHide: true });
  child.on('exit', (c) => { child.exited = c ?? -1; });
  return child;
}
async function stopServer(child) {
  if (!child || child.exited !== undefined) return;
  try { child.stdin.end(); } catch { /* gone */ }
  for (let i = 0; i < 100 && child.exited === undefined; i++) await sleep(200);
  if (child.exited === undefined) child.kill();
}

// ── WebSocket per author (presence + notices) ────────────────────────────────────────────────────────────────────────────────────────
let WebSocket = null;
try { WebSocket = require('ws'); } catch { /* fall back to the global WebSocket below */ }
const checkoutsInFlight = new Map();   // projectId|file -> start of the latest check-out request (performance.now())
function openSocket(a) {
  return new Promise((resolve) => {
    const url = `${BASE.replace(/^http/, 'ws')}/ws?client=${encodeURIComponent(CLIENT_VERSION)}`;
    const ws = new WebSocket(url, { headers: { cookie: a.client.cookie, origin: BASE } });
    ws.on('open', () => resolve(ws));
    ws.on('error', () => { wsDrops++; resolve(null); });
    ws.on('close', () => { if (a.ws === ws) { a.ws = null; if (running) wsDrops++; } });
    ws.on('message', (data) => {
      wsMessages++;
      let m; try { m = JSON.parse(String(data)); } catch { return; }
      if (m.type === 'leases' && !m.released && measuring) {
        const t0 = checkoutsInFlight.get(`${m.projectId}|${path.posix.basename(String(m.path))}`);
        if (t0 !== undefined && m.holder !== a.username) notices.push(performance.now() - t0);
      }
    });
  });
}
function presence(a, projectId, doc, mode = 'viewing') {
  if (!a.ws || a.ws.readyState !== 1) return;
  try { a.ws.send(JSON.stringify({ type: 'presence', projectId, doc, mode })); } catch { /* closed */ }
}

// ── seeding ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function variantOf(xml, n) {
  // a module of its own: the same content under another assembly code (only the identity's dmCode, not the references)
  const code = String(n).padStart(2, '0');
  return xml.replace('assyCode="00" disassyCode="00"', `assyCode="${code}" disassyCode="00"`);
}
const fileOf = (n) => SAMPLE.replace('-29-10-00-00A-', `-29-10-${String(n).padStart(2, '0')}-00A-`);

async function account(admin, username, fullName, role) {
  const made = await admin.req('seed', 'POST', '/api/team/users', { username, fullName, role }, [201]);
  if (made.status !== 201) throw new Error(`creating ${username} failed: ${made.status} ${JSON.stringify(made.json)}`);
  const c = new Client(username);
  if ((await c.req('seed', 'POST', '/api/auth/login', { username, password: made.json.tempPassword })).status !== 200) throw new Error(`${username} could not sign in`);
  if ((await c.req('seed', 'POST', '/api/auth/onboarding', { username, password: PW })).status !== 200) throw new Error(`${username} could not finish onboarding`);
  return c;
}

async function seed(admin) {
  const xml = fs.readFileSync(path.join(ROOT, 'samples', SAMPLE), 'utf8');
  // administrators oversee; a project manager owns the projects (as on a real team server)
  const pm = await account(admin, `load-${RUN}-pm`, 'Load project manager', 'project_manager');
  const projects = [];
  for (let p = 0; p < PROJECTS; p++) {
    const r = await pm.req('seed', 'POST', '/api/projects/sample', { folder: `load-${RUN}` }, [201]);
    if (r.status !== 201) throw new Error(`creating a project failed: ${r.status} ${JSON.stringify(r.json)}`);
    projects.push({ id: r.json.project.id, files: [SAMPLE], hot: SAMPLE, members: [] });
  }
  const authors = [];
  for (let i = 0; i < AUTHORS; i++) {
    const username = `load-${RUN}-${String(i + 1).padStart(2, '0')}`;
    const c = await account(admin, username, `Load author ${i + 1}`, 'author');
    // two projects each: a home project (with a module of her own) and a neighbour
    const home = projects[i % PROJECTS]; const next = projects[(i + 1) % PROJECTS];
    const n = 1 + Math.floor(i / PROJECTS);                     // assembly codes 01.. per project
    const own = fileOf(n);
    const cr = await pm.req('seed', 'POST', `/api/projects/${home.id}/dms`, { file: own, xml: variantOf(xml, n) }, [201]);
    if (cr.status !== 201) throw new Error(`creating ${own} failed: ${cr.status} ${JSON.stringify(cr.json)}`);
    home.files.push(own);
    for (const pr of new Set([home, next])) {
      const as = await pm.req('seed', 'POST', `/api/projects/${pr.id}/assign`, { username, role: 'editor' }, [200]);
      if (as.status !== 200) throw new Error(`assigning ${username} failed: ${as.status} ${JSON.stringify(as.json)}`);
      pr.members.push(username);
    }
    authors.push({ username, client: c, home, next, own, ws: null, edits: 0 });
  }
  return { projects, authors };
}

// ── the author's day ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const WEIGHTS = [['read', 30], ['edit', 22], ['hot', 10], ['list', 13], ['dmlist', 10], ['home', 12], ...(VALIDATE ? [['validate', 3]] : [])];
const TOTAL = WEIGHTS.reduce((s, [, w]) => s + w, 0);
function chooseAction() { let r = Math.random() * TOTAL; for (const [a, w] of WEIGHTS) { if ((r -= w) < 0) return a; } return 'read'; }

function edited(xml, who, n) { return xml.replace('<para>', `<para>[${who} edit ${n}] `); }
function noteSave(projectId, file, base, hash) {
  const k = `${projectId}/${file}`;
  if (!saves.has(k)) saves.set(k, []);
  saves.get(k).push({ base, hash });
}

let running = true;
const validating = new Set();
async function act(a) {
  const c = a.client; const action = chooseAction();
  const pr = Math.random() < 0.7 ? a.home : a.next;
  switch (action) {
    case 'read': {
      const f = pick(pr.files);
      presence(a, pr.id, { kind: 'dm', path: f }, 'viewing');
      await c.req('dm.read', 'GET', `/api/projects/${pr.id}/dms/${f}`);
      await c.req('dm.checkouts', 'GET', `/api/projects/${pr.id}/dms/${f}/checkout`);
      break;
    }
    case 'edit': {
      const f = a.own; const p = a.home.id;
      presence(a, p, { kind: 'dm', path: f }, 'editing');
      checkoutsInFlight.set(`${p}|${f}`, performance.now());
      const co = await c.req('dm.checkout', 'POST', `/api/projects/${p}/dms/${f}/checkout`, {}, [200]);
      if (co.status !== 200) break;
      const got = await c.req('dm.read', 'GET', `/api/projects/${p}/dms/${f}`);
      if (got.status !== 200) break;
      await sleep(between(200, 600));                      // typing
      const xml = edited(got.json.xml, a.username, ++a.edits);
      const put = await c.req('dm.save', 'PUT', `/api/projects/${p}/dms/${f}`, { xml, baseHash: got.json.hash }, [200]);
      if (put.status === 200) noteSave(p, f, got.json.hash, put.json.hash ?? sha(xml));
      await c.req('dm.checkin', 'DELETE', `/api/projects/${p}/dms/${f}/checkout`, undefined, [200]);
      break;
    }
    case 'hot': {
      const f = pr.hot;
      presence(a, pr.id, { kind: 'dm', path: f }, 'editing');
      const got = await c.req('dm.read', 'GET', `/api/projects/${pr.id}/dms/${f}`);
      if (got.status !== 200) break;
      await sleep(between(100, 800));
      const xml = edited(got.json.xml, a.username, ++a.edits);
      // racing without a check-out: 409 (another save came first) and 423 (someone holds it) are the guard working, not errors
      const put = await c.req('dm.save.contended', 'PUT', `/api/projects/${pr.id}/dms/${f}`, { xml, baseHash: got.json.hash }, [200, 409, 423]);
      if (put.status === 200) noteSave(pr.id, f, got.json.hash, put.json.hash ?? sha(xml));
      break;
    }
    case 'list':
      presence(a, pr.id, null);
      await c.req('projects.list', 'GET', '/api/projects');
      await c.req('project.summary', 'GET', `/api/projects/${pr.id}/summary`);
      break;
    case 'dmlist':
      await c.req('dms.list', 'GET', `/api/projects/${pr.id}/dms?slim=1`);
      break;
    case 'home':
      presence(a, pr.id, null);
      await c.req('project.presence', 'GET', `/api/projects/${pr.id}/presence`);
      await c.req('project.checkouts', 'GET', `/api/projects/${pr.id}/checkouts`);
      break;
    case 'validate':
      // one validation per project at a time, as people do (the button is busy while it runs)
      if (validating.has(pr.id)) { await c.req('project.summary', 'GET', `/api/projects/${pr.id}/summary`); break; }
      validating.add(pr.id);
      try { await c.req('project.validate', 'POST', `/api/projects/${pr.id}/validation`, {}, [200]); } finally { validating.delete(pr.id); }
      break;
    default: break;
  }
}

async function author(a, until) {
  await sleep(Math.random() * Math.max(THINK_MAX, 1000));   // people do not all start in the same millisecond
  let lastBeat = 0;
  while (running && Date.now() < until) {
    if (!a.ws && WebSocket) a.ws = await openSocket(a);
    if (Date.now() - lastBeat > 25_000) { presence(a, a.home.id, null); lastBeat = Date.now(); }
    try { await act(a); } catch (e) { if (measuring) errors.push({ action: 'harness', status: 'exception', message: e.message }); }
    await sleep(between(THINK_MIN, THINK_MAX));
  }
}

// ── the acceptance check: no lost update ─────────────────────────────────────────────────────────────────────────────────────────────
async function verifyNoSilentOverwrite(admin) {
  const out = { modules: 0, acceptedSaves: 0, silentOverwrites: 0, brokenChains: 0, finalMismatch: 0, details: [] };
  for (const [key, list] of saves) {
    out.modules++; out.acceptedSaves += list.length;
    const byBase = new Map();
    for (const s of list) byBase.set(s.base, (byBase.get(s.base) ?? 0) + 1);
    const dup = [...byBase.values()].filter((n) => n > 1).reduce((s, n) => s + n - 1, 0);
    out.silentOverwrites += dup;
    // the chain: from the base nobody produced, follow base -> hash through every accepted save
    const produced = new Set(list.map((s) => s.hash));
    const starts = [...byBase.keys()].filter((b) => !produced.has(b));
    const next = new Map(list.map((s) => [s.base, s.hash]));
    let at = starts[0]; let steps = 0;
    while (next.has(at) && steps <= list.length) { at = next.get(at); steps++; }
    if (starts.length !== 1 || steps !== list.length) { out.brokenChains++; out.details.push({ key, starts: starts.length, steps, saves: list.length }); }
    const [pid, file] = key.split('/');
    const now = await admin.req('verify', 'GET', `/api/projects/${pid}/dms/${file}`);
    if (now.status !== 200 || now.json.hash !== at) { out.finalMismatch++; out.details.push({ key, server: now.json?.hash, chainEnd: at }); }
  }
  return out;
}

// ── restore drill (PRD-007: RTO components for this data size) ───────────────────────────────────────────────────────────────────────
async function drill(workspace, logFile, someone) {
  const cli = path.join(ROOT, 'scripts', 'agastya-backup.js');
  const t0 = performance.now();
  const b = spawnSync(process.execPath, [cli, 'backup', '--workspace', workspace, '--kind', 'cli'], { encoding: 'utf8' });
  const backupMs = performance.now() - t0;
  if (b.status !== 0) return { ok: false, step: 'backup', message: (b.stderr || b.stdout).slice(-400) };
  const archive = (b.stdout.match(/(\S+\.zip)/) || [])[1] || fs.readdirSync(path.join(workspace, 'backups', 'platform')).filter((f) => f.endsWith('.zip')).map((f) => path.join(workspace, 'backups', 'platform', f)).pop();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-load-restored-'));
  fs.rmSync(target, { recursive: true, force: true });
  const t1 = performance.now();
  const r = spawnSync(process.execPath, [cli, 'restore', archive, target], { encoding: 'utf8' });
  const restoreMs = performance.now() - t1;
  if (r.status !== 0) return { ok: false, step: 'restore', message: (r.stderr || r.stdout).slice(-400) };
  const port = await freePort(); const t2 = performance.now();
  const child = startServer(target, port, logFile);
  const saved = BASE; BASE = `http://127.0.0.1:${port}`;
  try {
    const ready = await waitReady(BASE);
    const startMs = performance.now() - t2;
    if (!ready) return { ok: false, step: 'start', message: 'the restored server did not become ready' };
    const c = new Client(someone.username);
    const login = await c.req('drill', 'POST', '/api/auth/login', { username: someone.username, password: PW });
    const read = await c.req('drill', 'GET', `/api/projects/${someone.home.id}/dms/${someone.own}`);
    const firstUseMs = performance.now() - t2;
    return { ok: login.status === 200 && read.status === 200, archiveBytes: fs.statSync(archive).size, backupMs: Math.round(backupMs), restoreMs: Math.round(restoreMs),
      startToReadyMs: Math.round(startMs), startToFirstReadMs: Math.round(firstUseMs), totalMs: Math.round(backupMs + restoreMs + firstUseMs), restoredFolder: flag('keep') ? target : undefined };
  } finally {
    await stopServer(child); BASE = saved;
    if (!flag('keep')) fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!WebSocket) { console.error('The "ws" package is needed (run from backend/ with its node_modules).'); process.exit(2); }
  let child = null; let workspace = null; const logFile = path.join(os.tmpdir(), `agastya-load-${RUN}.log`);
  const admin = new Client('admin');
  const started = new Date().toISOString();
  if (!BASE) {
    if (!fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) { console.error('Build the backend first (npx tsc -p . in backend/).'); process.exit(2); }
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-load-'));
    const port = await freePort();
    BASE = `http://127.0.0.1:${port}`;
    child = startServer(workspace, port, logFile);
    if (!(await waitReady(BASE))) { console.error(`The server did not become ready; log: ${logFile}`); await stopServer(child); process.exit(2); }
    const s = await admin.req('seed', 'POST', '/api/auth/setup', { username: 'admin', password: PW, fullName: 'Load Admin' });
    if (s.status !== 200) { console.error(`setup failed: ${s.status}`); await stopServer(child); process.exit(2); }
  } else {
    const u = opt('admin'); const f = opt('admin-password-file');
    if (!u || !f) { console.error('--base needs --admin and --admin-password-file'); process.exit(2); }
    const l = await admin.req('seed', 'POST', '/api/auth/login', { username: u, password: fs.readFileSync(f, 'utf8').trim() });
    if (l.status !== 200) { console.error(`admin sign-in failed: ${l.status}`); process.exit(2); }
  }
  let result;
  try {
    console.log(`[load] server ${BASE}${workspace ? ` (data ${workspace})` : ''}; seeding ${PROJECTS} projects and ${AUTHORS} authors...`);
    const tSeed = performance.now();
    const world = await seed(admin);
    console.log(`[load] seeded in ${Math.round(performance.now() - tSeed)} ms; ${AUTHORS} authors for ${DURATION_S} s (warm-up ${WARMUP_S} s, think ${THINK_MIN}-${THINK_MAX} ms)`);
    const until = Date.now() + (WARMUP_S + DURATION_S) * 1000;
    const runs = world.authors.map((a) => author(a, until));
    await sleep(WARMUP_S * 1000);
    await admin.req('metrics', 'POST', '/api/admin/metrics/reset', {});
    harnessLoop.reset(); measuring = true;
    const tRun = performance.now();
    const samples = [];
    const sampler = setInterval(async () => { const m = await admin.req('metrics', 'GET', '/api/admin/metrics'); if (m.json) samples.push({ t: Math.round((performance.now() - tRun) / 1000), loopMax: m.json.eventLoop.max, loopP99: m.json.eventLoop.p99, ws: m.json.live.wsClients, inFlight: m.json.requests.inFlight, rssMb: m.json.rssMb }); }, 5000);
    await Promise.all(runs);
    clearInterval(sampler);
    measuring = false; running = false;
    const seconds = (performance.now() - tRun) / 1000;
    const server = (await admin.req('metrics', 'GET', '/api/admin/metrics')).json;
    for (const a of world.authors) { try { a.ws?.close(); } catch { /* closed */ } }
    const integrity = await verifyNoSilentOverwrite(admin);
    const actions = {};
    let total = 0;
    for (const [k, xs] of lat) { total += xs.length; actions[k] = { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), p99: pct(xs, 0.99), max: pct(xs, 1), status: codes.get(k) }; }
    const all = [...lat.entries()].filter(([k]) => k !== 'metrics').flatMap(([, xs]) => xs);
    const writes = ['dm.save', 'dm.save.contended', 'dm.checkout', 'dm.checkin'].flatMap((k) => lat.get(k) ?? []);
    const cont = codes.get('dm.save.contended') ?? {};
    result = {
      harness: 'backend/scripts/load-test.js', started, machine: { cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memGb: Math.round(os.totalmem() / 1073741824), platform: `${os.platform()} ${os.release()}`, node: process.version, loadavgNote: 'shared machine; other work was running' },
      config: { authors: AUTHORS, projects: PROJECTS, durationS: DURATION_S, warmupS: WARMUP_S, thinkMs: [THINK_MIN, THINK_MAX], validate: VALIDATE, base: BASE_ARG ? BASE : 'own server (loopback, Mode A listener, plain HTTP)' },
      totals: { requests: total, seconds: Math.round(seconds), rps: Math.round((total / seconds) * 10) / 10, errors: errors.length, p50: pct(all, 0.5), p95: pct(all, 0.95), p99: pct(all, 0.99), max: pct(all, 1),
        writeP95: pct(writes, 0.95), contendedSaves: { accepted: cont[200] ?? 0, refused409: cont[409] ?? 0, refused423: cont[423] ?? 0 } },
      notices: { n: notices.length, p50: pct(notices, 0.5), p95: pct(notices, 0.95), max: pct(notices, 1), over5s: notices.filter((x) => x > NOTICE_LIMIT_MS).length },
      websocket: { messages: wsMessages, drops: wsDrops },
      actions, integrity, server, serverSamples: samples,
      harnessEventLoop: { p99: Math.round(harnessLoop.percentile(99) / 1e5) / 10, max: Math.round(harnessLoop.max / 1e5) / 10 },
      errorSample: errors.slice(0, 20),
    };
    if (flag('drill') && workspace) {
      await stopServer(child); child = null;
      console.log('[load] restore drill...');
      result.drill = await drill(workspace, logFile, world.authors[0]);
    }
  } finally {
    running = false;
    await stopServer(child);
    if (workspace && !flag('keep')) fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  const ok = result.totals.errors === 0 && result.integrity.silentOverwrites === 0 && result.integrity.brokenChains === 0 && result.integrity.finalMismatch === 0 && result.notices.over5s === 0;
  result.acceptance = { ok, rule: '0 errors, 0 silent overwrites (one chain per module, final version on the server = chain end), every check-out notice within 5 s' };
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  printSummary(result);
  console.log(`[load] server log: ${logFile}`);
  process.exit(ok ? 0 : 1);
}

function printSummary(r) {
  const t = r.totals; const s = r.server || {};
  console.log(`\n=== ${r.config.authors} authors, ${r.config.projects} projects, ${t.seconds} s measured (think ${r.config.thinkMs.join('-')} ms) on ${r.machine.cpus} cores (${r.machine.cpu}) ===`);
  console.log(`requests ${t.requests} (${t.rps}/s)  p50 ${t.p50} ms  p95 ${t.p95} ms  p99 ${t.p99} ms  max ${t.max} ms  errors ${t.errors}`);
  console.log(`write p95 ${t.writeP95} ms; contended saves: ${t.contendedSaves.accepted} accepted, ${t.contendedSaves.refused409} refused (409), ${t.contendedSaves.refused423} refused (423)`);
  console.log('action'.padEnd(20) + 'n'.padStart(7) + 'p50'.padStart(9) + 'p95'.padStart(9) + 'p99'.padStart(9) + 'max'.padStart(9) + '  status');
  for (const [k, v] of Object.entries(r.actions).sort()) console.log(k.padEnd(20) + String(v.n).padStart(7) + String(v.p50).padStart(9) + String(v.p95).padStart(9) + String(v.p99).padStart(9) + String(v.max).padStart(9) + '  ' + JSON.stringify(v.status));
  console.log(`check-out notices: ${r.notices.n}, p50 ${r.notices.p50} ms, p95 ${r.notices.p95} ms, max ${r.notices.max} ms, over 5 s: ${r.notices.over5s}`);
  if (s.eventLoop) console.log(`server: event loop p50 ${s.eventLoop.p50} / p99 ${s.eventLoop.p99} / max ${s.eventLoop.max} ms; statements ${s.db.statements} (mean ${s.db.meanMs} ms, max ${s.db.maxMs} ms, slow >=${s.db.slowThresholdMs} ms: ${s.db.slow}, locked: ${s.db.locked}); server-side request p95 ${s.requests.p95} ms, write p95 ${s.requests.writes.p95} ms; RSS ${s.rssMb} MB; sockets ${s.live.wsClients}; D21 triggers ${JSON.stringify(s.d21)}`);
  console.log(`harness event loop p99 ${r.harnessEventLoop.p99} ms, max ${r.harnessEventLoop.max} ms (a busy harness inflates the client-side times)`);
  console.log(`integrity: ${r.integrity.acceptedSaves} accepted saves on ${r.integrity.modules} modules; silent overwrites ${r.integrity.silentOverwrites}; broken chains ${r.integrity.brokenChains}; final mismatch ${r.integrity.finalMismatch}`);
  if (r.drill) console.log(`drill: ${JSON.stringify(r.drill)}`);
  if (r.errorSample.length) console.log(`first errors: ${JSON.stringify(r.errorSample.slice(0, 5))}`);
  console.log(`ACCEPTANCE: ${r.acceptance.ok ? 'PASS' : 'FAIL'} (${r.acceptance.rule})`);
}

main().catch((e) => { console.error('[load] failed:', e.stack || e.message); process.exit(2); });
