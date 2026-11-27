'use strict';
// Air-gapped operation (WP-30; gates G-OFF-1 and G-OFF-4 on this machine, G-OFF-2 statically). The REAL server (dist/index.js, its job workers
// and their JVMs) runs with outbound network access refused, and the scripted workflow must still work end to end:
//   sign-in and set-up, the S1000D sample project validated, published as PDF and as HTML, a JSS document published, the JSG sample built,
//   a platform backup taken and verified.
// How "refused" is enforced and observed:
//   - inside every Node process (server and each forked job worker): test/fixtures/airgap-hook.js refuses TCP/TLS/HTTP/fetch/WebSocket to any
//     non-loopback address, every DNS lookup other than localhost and every UDP datagram off the machine, and logs each attempt;
//   - outside, for every process of the server's tree (the JVMs included): the TCP table (Get-NetTCPConnection) is polled during the whole
//     workflow; any connection whose remote end is not loopback is recorded.
// Passing means: every step succeeded, the hook logged 0 attempts, and the poll saw 0 non-loopback connections - with proof that the hook was
// loaded in the workers and that the poll saw the JVMs. A control case shows the hook does refuse and log an outbound attempt.
// Limits (said in docs/audit/RELEASE-EVIDENCE.md): this is a process-level air gap on a networked machine, not a machine with its adapter
// disabled; a JVM's DNS query goes through the Windows DNS client service and is not attributed to it; installer and uninstaller are not run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { tmp } = require('./helpers');

const DIST = path.resolve(__dirname, '..', 'dist', 'index.js');
const HOOK = path.join(__dirname, 'fixtures', 'airgap-hook.js');
const PW = 'Correct-Horse-9!';
const SKIP = process.platform !== 'win32' && 'Windows only (Get-NetTCPConnection)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const readLog = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('control: the hook refuses and logs an outbound TCP connection, a DNS lookup and a fetch, and lets loopback through', { timeout: 60000 }, () => {
  const log = path.join(tmp('agastya-wp30-airgap-ctl-'), 'airgap.log');
  const script = `
    const net = require('net'); const dns = require('dns');
    const out = {};
    const s = net.createServer().listen(0, '127.0.0.1', async () => {
      const port = s.address().port;
      out.loopback = await new Promise((r) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r('connected'); }); c.on('error', (e) => r(e.code)); });
      out.tcp = await new Promise((r) => { const c = net.connect(80, '192.0.2.1', () => r('connected')); c.on('error', (e) => r(e.code)); });
      out.dns = await dns.promises.lookup('example.com').then(() => 'resolved', (e) => e.code);
      out.fetch = await fetch('http://192.0.2.1/').then(() => 'fetched', (e) => (e.cause && e.cause.code) || e.message);
      s.close(); console.log(JSON.stringify(out));
    });`;
  const r = spawnSync(process.execPath, ['--require', HOOK, '-e', script], { env: { ...process.env, AIRGAP_LOG: log }, encoding: 'utf8', timeout: 50000 });
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out, { loopback: 'connected', tcp: 'EACCES', dns: 'EACCES', fetch: 'EACCES' }, r.stderr);
  const blocked = readLog(log).filter((e) => e.event === 'blocked').map((e) => `${e.kind} ${e.dest}`);
  assert.deepEqual(blocked.sort(), ['dns.lookup example.com', 'tcp 192.0.2.1:80', 'tcp 192.0.2.1:80'].sort());
});

const POLL = `param($root, $out, $stop)
$loop = @('127.0.0.1', '::1', '0.0.0.0', '::')
while (-not (Test-Path $stop)) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
  $ids = New-Object System.Collections.Generic.HashSet[int]; [void]$ids.Add([int]$root)
  do { $n = $ids.Count; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId) } } } while ($ids.Count -ne $n)
  $names = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | ForEach-Object { $_.Name })
  $bad = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids.Contains([int]$_.OwningProcess) -and -not ($loop -contains $_.RemoteAddress) -and -not ($_.RemoteAddress -like '127.*') -and -not ($_.RemoteAddress -like '::ffff:127.*') })
  foreach ($c in $bad) { Add-Content -Path $out -Value (ConvertTo-Json -Compress @{ event = 'conn'; pid = $c.OwningProcess; remote = "$($c.RemoteAddress):$($c.RemotePort)"; state = "$($c.State)" }) }
  Add-Content -Path $out -Value (ConvertTo-Json -Compress @{ event = 'tick'; procs = $ids.Count; names = ($names -join ',') })
  Start-Sleep -Milliseconds 300
}`;

test('the workflow runs with outbound network access refused: 0 outbound attempts from Node, 0 non-loopback connections from the process tree', { skip: SKIP, timeout: 1800000 }, async (t) => {
  const dir = tmp('agastya-wp30-airgap-'); const ws = path.join(dir, 'data'); fs.mkdirSync(ws);
  const log = path.join(dir, 'airgap.log'); const polled = path.join(dir, 'poll.log'); const stopFile = path.join(dir, 'stop'); const pollScript = path.join(dir, 'poll.ps1');
  fs.writeFileSync(pollScript, POLL);
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, AGASTYA_WORKSPACE_DIR: ws, PORT: String(port), AGASTYA_SHUTDOWN_ON_STDIN_CLOSE: '1', AIRGAP_LOG: log };
  delete env.AGASTYA_HOST; delete env.AGASTYA_MODE;
  const server = spawn(process.execPath, ['--require', HOOK, DIST], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; server.stdout.on('data', (d) => { out += d; }); server.stderr.on('data', (d) => { out += d; });
  let exit; const exited = new Promise((r) => server.on('exit', (c) => { exit = c; r(c); }));
  const poller = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', pollScript, String(server.pid), polled, stopFile], { stdio: 'ignore', windowsHide: true });
  const steps = {};
  try {
    for (let i = 0; i < 600 && !/running on http/.test(out); i++) { if (exit !== undefined) throw new Error(`server exited ${exit}: ${out.slice(-800)}`); await sleep(100); }
    assert.match(out, /running on http/, out.slice(-800));
    let cookie = '';
    const req = async (method, url, body, who) => {
      const headers = {}; const c = who ? who.cookie : cookie; if (c) headers.cookie = c;
      if (body !== undefined) { headers['content-type'] = 'application/json'; }
      const res = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie'); if (set) { if (who) who.cookie = set.split(';')[0]; else cookie = set.split(';')[0]; }
      const type = res.headers.get('content-type') || '';
      return { status: res.status, json: type.includes('json') ? await res.json().catch(() => null) : null, buf: type.includes('json') ? null : Buffer.from(await res.arrayBuffer()) };
    };
    const must = async (label, p, okStatus = [200, 201]) => { const r = await p; assert.ok(okStatus.includes(r.status), `${label}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); steps[label] = r.status; return r; };
    await must('setup', req('POST', '/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' }));
    const made = await must('user', req('POST', '/api/team/users', { username: 'gina', fullName: 'Gina', role: 'author' }));
    const a = { cookie: '' };
    await must('login', req('POST', '/api/auth/login', { username: 'gina', password: made.json.tempPassword }, a));
    await must('onboarding', req('POST', '/api/auth/onboarding', { username: 'gina', password: PW }, a));
    const s = (await must('S1000D sample', req('POST', '/api/projects/sample', {}, a))).json.project.id;
    const v = await must('S1000D validation', req('POST', `/api/projects/${s}/validation`, {}, a));
    t.diagnostic(`validation answered ${JSON.stringify(v.json).slice(0, 160)}`);
    await must('S1000D PDF', req('POST', `/api/projects/${s}/publish`, {}, a));
    const pdf = await must('S1000D PDF download', req('GET', `/api/projects/${s}/publish/pdf`, undefined, a)); assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
    await must('S1000D HTML', req('POST', `/api/projects/${s}/publish/html`, {}, a));
    const j = (await must('JSS project', req('POST', '/api/projects', { name: 'Air-gapped JSS', format: 'jss', domain: 'land', manualType: 'uhb' }, a))).json.project.id;
    await must('JSS PDF', req('POST', `/api/projects/${j}/publish`, {}, a));
    const g = (await must('JSG sample', req('POST', '/api/projects/sample-jsg', {}, a))).json.project.id;
    await must('JSG PDF', req('POST', `/api/projects/${g}/jsg/build`, {}, a));
    const b = await must('platform backup', req('POST', '/api/admin/backups', {}));
    const vb = await must('backup verify', req('POST', `/api/admin/backups/${b.json.name}/verify`, {})); assert.equal(vb.json.ok, true);
  } finally {
    fs.writeFileSync(stopFile, '');
    await Promise.race([new Promise((r) => poller.on('exit', r)), sleep(20000)]);
    if (alive(poller.pid)) spawnSync('taskkill', ['/PID', String(poller.pid), '/T', '/F'], { stdio: 'ignore' });
    try { server.stdin.end(); } catch { /* gone */ }
    await Promise.race([exited, sleep(30000)]);
    if (alive(server.pid)) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  const events = readLog(log); const poll = fs.existsSync(polled) ? fs.readFileSync(polled, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const loaded = new Set(events.filter((e) => e.event === 'loaded').map((e) => e.pid));
  const workers = events.filter((e) => e.event === 'loaded' && /worker\.js$/.test(e.main)).map((e) => e.pid);
  const ticks = poll.filter((e) => e.event === 'tick'); const javaSeen = ticks.filter((e) => /java\.exe/i.test(e.names)).length;
  const blocked = events.filter((e) => e.event === 'blocked'); const conns = poll.filter((e) => e.event === 'conn');
  t.diagnostic(`steps ${JSON.stringify(steps)}`);
  t.diagnostic(`hook loaded in ${loaded.size} Node process(es) (server ${server.pid}, ${workers.length} job worker(s)); ${blocked.length} outbound attempt(s) refused`);
  t.diagnostic(`TCP table polled ${ticks.length} times over the server's tree (up to ${Math.max(0, ...ticks.map((x) => x.procs))} processes; a JVM present in ${javaSeen} polls); ${conns.length} non-loopback connection(s)`);
  assert.ok(loaded.has(server.pid), 'the hook was loaded in the server');
  assert.ok(workers.length >= 1, 'and in the job workers (the builds and the validation ran there)');
  assert.ok(ticks.length >= 10 && javaSeen >= 1, 'the poll ran through the workflow and saw the JVMs');
  assert.deepEqual(blocked.map((e) => `${e.kind} ${e.dest} (pid ${e.pid}) ${e.stack.join(' < ')}`), [], 'no Node process tried to reach the network');
  assert.deepEqual(conns.map((c) => `${c.remote} ${c.state} (pid ${c.pid})`), [], 'no process of the tree held a connection to a non-loopback address');
});

test('G-OFF-2 (static): the built client loads nothing from another host - no http(s) URL in a src/href/url()/@import of frontend/dist', { timeout: 60000 }, (t) => {
  const dist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) return t.skip('frontend/dist is not built (npx vite build in frontend/)');
  const hits = []; let files = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(html|css|js|mjs|json|webmanifest)$/.test(e.name)) {
    files++; const text = fs.readFileSync(p, 'utf8');
    const res = [/\b(?:src|href|action|poster|data)\s*=\s*["']?(https?:)?\/\/[^"'\s>]+/gi, /url\(\s*["']?(?:https?:)?\/\/[^)"']+/gi, /@import\s+(?:url\()?["']?(?:https?:)?\/\/[^"')\s;]+/gi,
      /\bimport\s*\(\s*["'](?:https?:)?\/\/[^"']+/g, /\bimportScripts\s*\(\s*["'](?:https?:)?\/\/[^"']+/g, /new\s+(?:Worker|SharedWorker|WebSocket|EventSource)\s*\(\s*["'](?:https?|wss?):\/\/[^"']+/g];
    for (const re of res) for (const m of text.matchAll(re)) if (!/\/\/(?:www\.)?(?:w3\.org|s1000d\.org)\//.test(m[0])) hits.push(`${path.relative(dist, p)}: ${m[0].slice(0, 120)}`);
  } } };
  walk(dist);
  t.diagnostic(`${files} files of frontend/dist scanned`);
  assert.deepEqual(hits, [], 'a resource the browser would fetch from another host');
});
