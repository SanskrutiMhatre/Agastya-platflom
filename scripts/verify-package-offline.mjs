#!/usr/bin/env node
// =============================================================================
// Proves that the PACKAGED product runs completely offline, using the artefact that is actually shipped (the portable ZIP, or a staged folder).
//
//   node scripts/verify-package-offline.mjs [--zip <file> | --dir <staged folder>] [--port 4073]
//                                           [--import-dir <folder of S1000D files>] [--import-limit 8] [--keep]
//
// What it does, in this order (every step is a numbered check; the exit code is 0 only if none failed):
//   1. Static: the web client loads nothing from another host (HTML, CSS, @font-face, every relative url() resolves to a file that is shipped).
//   2. Instruments, each proved by a canary that MUST be caught before its silence is believed:
//        - a Node preload that records every connection / DNS lookup / UDP send to anything that is not this computer;
//        - a JVM proxy trap (all http/https from the PDF renderer is sent to a local port that records it);
//        - an operating-system poll of the TCP table for every process that runs from the product folder;
//        - a browser request log (Chrome with name resolution switched off for every host but 127.0.0.1).
//   3. The portable ZIP, unpacked into a folder with spaces and non-ASCII letters: it starts, answers, asks for the first administrator, and keeps
//      its data beside itself.
//   4. The installed layout with the PROGRAM FOLDER READ-ONLY (a copy, with every file marked read-only), a data folder elsewhere: the whole workflow
//      with all four instruments watching - first administrator, an author, the ready-made sample project published to PDF, an S1000D import of a subset
//      of --import-dir (read-only use of that folder), validation, a gated publish with a draft waiver, and the web client's pages in Chrome.
//   5. After it ran: nothing was written into the program folder; nothing is left running; every scratch folder is deleted.
//
// It only ever uses ports 4070-4079 and folders it creates itself under the system temp folder. It never touches ./workspace.
// =============================================================================

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const basePort = Number(arg('--port', '4073'));
const TRAP_PORT = 4079;
if (!(basePort >= 4070 && basePort + 1 < TRAP_PORT)) { console.error('--port must leave room for a second port below 4079 (use 4070-4077).'); process.exit(2); }
const portA = basePort, portB = basePort + 1;

// ---- what to test ---------------------------------------------------------------------------------------------------------------------------------
let zip = arg('--zip'); const dirArg = arg('--dir');
const rel = path.join(root, 'release');
if (!zip && !dirArg && fs.existsSync(rel)) {
  zip = fs.readdirSync(rel).filter((f) => /-portable\.zip$/i.test(f) || /^Agastya-Platform-.*-win-x64\.zip$/i.test(f)).map((f) => path.join(rel, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
if (!zip && !dirArg) { console.error('Nothing to test. Pass --zip <portable ZIP> or --dir <staged folder>, or run npm run package:win first.'); process.exit(2); }
if (zip && !fs.existsSync(zip)) { console.error(`Not found: ${zip}`); process.exit(2); }
const importDir = arg('--import-dir') || path.resolve(root, 'SAMPLE PROJECTS', 'S1000D', 'PMC-RDR-1671Y-00039-00_001-01.xml (2)');
const importLimit = Number(arg('--import-limit', '8'));

// ---- reporting --------------------------------------------------------------------------------------------------------------------------------------
const results = [];
let n = 0;
const check = (name, ok, detail) => { n++; results.push({ name, ok: !!ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${String(n).padStart(2)}. ${name}${!ok && detail ? `\n            ${String(detail).split('\n').join('\n            ')}` : ''}`); return !!ok; };
const skip = (name, why) => { n++; results.push({ name, ok: true, skipped: true }); console.log(`  SKIP  ${String(n).padStart(2)}. ${name} - ${why}`); };
const head = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- scratch ----------------------------------------------------------------------------------------------------------------------------------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-off-'));
const portableDir = path.join(work, 'Portable Prüfung é');          // spaces + non-ASCII on purpose
const readonlyDir = path.join(work, 'Schreibgeschützt Ü', 'Agastya Platform');
const homeDir = path.join(work, 'Daten und Zustand ü');
const netlog = path.join(work, 'net.log');
const trapFile = path.join(work, 'net-trap.cjs');
const trapHits = [];
const kids = new Set();

function tree(dir) { // the folder that holds AgastyaPlatform.exe (a ZIP may have one wrapping folder)
  if (fs.existsSync(path.join(dir, 'AgastyaPlatform.exe'))) return dir;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'AgastyaPlatform.exe'))) return path.join(dir, e.name);
  return null;
}
// (not fs.cpSync: on Node 22.23 / Windows it mis-handles non-ASCII destination paths, which this script uses on purpose)
function copyTree(from, to) {
  if (fs.statSync(from).isDirectory()) { fs.mkdirSync(to, { recursive: true }); for (const name of fs.readdirSync(from)) copyTree(path.join(from, name), path.join(to, name)); }
  else fs.copyFileSync(from, to);
}
function manifest(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const s = fs.statSync(p); out.push(`${path.relative(dir, p)}|${s.size}|${Math.floor(s.mtimeMs)}`); } } };
  walk(dir);
  return out.sort();
}
function setReadOnly(dir, on) { spawnSync('attrib', [on ? '+R' : '-R', path.join(dir, '*'), '/S'], { stdio: 'ignore' }); }

// ---- 1. static ---------------------------------------------------------------------------------------------------------------------------------------
function staticScan(program) {
  head('1. Static scan of the web client');
  const dist = path.join(program, 'app', 'frontend', 'dist');
  check('the web client is in the package', fs.existsSync(path.join(dist, 'index.html')));
  const all = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push(p); } };
  walk(dist);
  const external = [], unresolved = [], hosts = new Map();
  for (const f of all) {
    const ext = path.extname(f).toLowerCase();
    if (!['.html', '.css', '.js', '.mjs'].includes(ext)) continue;
    const t = fs.readFileSync(f, 'utf8');
    if (ext === '.html') for (const m of t.matchAll(/<(script|img|link|iframe|source|video|audio|embed|object)\b[^>]*?\b(?:src|href|data)\s*=\s*["'](https?:)?\/\/[^"']+["']/gi)) external.push(`${path.relative(dist, f)}: ${m[0].slice(0, 100)}`);
    if (ext === '.css' || ext === '.html') {
      for (const m of t.matchAll(/@import\s+(?:url\()?\s*["']?(https?:)?\/\/[^"')\s]+/gi)) external.push(`${path.relative(dist, f)}: ${m[0].slice(0, 100)}`);
      for (const m of t.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        const u = m[1].trim();
        if (/^(https?:)?\/\//i.test(u)) { external.push(`${path.relative(dist, f)}: url(${u.slice(0, 80)})`); continue; }
        if (/^(data:|#|about:)/i.test(u)) continue;
        const target = u.startsWith('/') ? path.join(dist, u.split(/[?#]/)[0]) : path.resolve(path.dirname(f), u.split(/[?#]/)[0]);
        if (!fs.existsSync(target)) unresolved.push(`${path.relative(dist, f)}: ${u}`);
      }
    }
    for (const m of t.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) hosts.set(m[1].toLowerCase(), (hosts.get(m[1].toLowerCase()) || 0) + 1);
  }
  check('no page, stylesheet or font in the web client is loaded from another host', external.length === 0, external.slice(0, 6).join('\n'));
  check('every url() in the stylesheets (fonts, images) is a file that is shipped', unresolved.length === 0, unresolved.slice(0, 6).join('\n'));
  const names = [...hosts.keys()].sort();
  console.log(`  info  host names that appear as TEXT in the web client scripts (not loads; the browser log in step 4 is the proof): ${names.length ? names.join(', ') : 'none'}`);
}

// ---- 2. instruments ----------------------------------------------------------------------------------------------------------------------------------
const TRAP_JS = `'use strict';
const fs = require('fs'), net = require('net'), dns = require('dns'), dgram = require('dgram');
const log = process.env.AGASTYA_NETLOG;
const local = (h) => !h || h === 'localhost' || h === '::1' || h === '[::1]' || h === '0.0.0.0' || h === '::' || /^127\\./.test(String(h));
const rec = (kind, target) => { try { fs.appendFileSync(log, JSON.stringify({ kind, target: String(target), pid: process.pid }) + '\\n'); } catch (e) {} };
const oc = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  let h, p; let o = a[0];
  if (Array.isArray(o)) o = o[0]; // net.connect() hands the already-normalised [options, callback] pair down
  if (o && typeof o === 'object') { if (!o.path) { h = o.host; p = o.port; if (!local(h)) rec('connect', h + ':' + p); } }
  else if (typeof o === 'number' || /^\\d+$/.test(String(o))) { h = typeof a[1] === 'string' ? a[1] : undefined; p = o; if (!local(h)) rec('connect', h + ':' + p); }
  return oc.apply(this, a);
};
const ol = dns.lookup;
dns.lookup = function (host, ...r) { if (!local(host)) rec('dns', host); return ol.call(this, host, ...r); };
if (dns.promises && dns.promises.lookup) { const opl = dns.promises.lookup; dns.promises.lookup = function (host, ...r) { if (!local(host)) rec('dns', host); return opl.call(this, host, ...r); }; }
const os_ = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (...a) { const ad = a.find((x, i) => typeof x === 'string' && i > 1); if (ad && !local(ad)) rec('udp', ad); return os_.apply(this, a); };
`;
function instrumentEnv() {
  fs.writeFileSync(trapFile, TRAP_JS);
  fs.writeFileSync(netlog, '');
  return {
    ...process.env,
    NODE_OPTIONS: `--require "${trapFile.replace(/\\/g, '/')}"`,
    AGASTYA_NETLOG: netlog,
    // Default nonProxyHosts (localhost, 127.*, [::1]) stays: only traffic to other hosts is sent to the trap.
    JAVA_TOOL_OPTIONS: `-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=${TRAP_PORT} -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=${TRAP_PORT}`,
  };
}
const netlogLines = () => (fs.existsSync(netlog) ? fs.readFileSync(netlog, 'utf8').split('\n').filter(Boolean) : []);
function startTrap() {
  return new Promise((resolve, reject) => {
    const s = net.createServer((sock) => { sock.once('data', (d) => trapHits.push(String(d).split('\r\n')[0].slice(0, 120))); sock.on('error', () => {}); setTimeout(() => sock.destroy(), 300); });
    s.on('error', reject); s.listen(TRAP_PORT, '127.0.0.1', () => resolve(s));
  });
}
const PS_POLL = `
$root = $env:AGASTYA_VERIFY_ROOT; $seen = @{}
while ($true) {
  $pids = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.ProcessId })
  if ($pids.Count -gt 0) {
    Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { ($pids -contains $_.OwningProcess) -and $_.State -ne 'Listen' -and (@('127.0.0.1','::1','0.0.0.0','::') -notcontains $_.RemoteAddress) } | ForEach-Object {
      $k = "$($_.OwningProcess) $($_.RemoteAddress):$($_.RemotePort)"
      if (-not $seen.ContainsKey($k)) { $seen[$k] = 1; [Console]::Out.WriteLine("CONN $k $($_.State)"); [Console]::Out.Flush() }
    }
  }
  [Console]::Out.WriteLine("TICK"); [Console]::Out.Flush(); Start-Sleep -Milliseconds 250
}`;
function startPoll(program) {
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS_POLL, 'utf16le').toString('base64')],
    { env: { ...process.env, AGASTYA_VERIFY_ROOT: program }, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const state = { ticks: 0, conns: [], proc: p };
  let buf = '';
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l === 'TICK') state.ticks++; else if (l.startsWith('CONN ')) state.conns.push(l.slice(5)); } });
  kids.add(p);
  return state;
}

// ---- servers -----------------------------------------------------------------------------------------------------------------------------------------
function startServer(program, extraArgs, env) {
  const child = spawn(path.join(program, 'AgastyaCtl.exe'), ['--console', ...extraArgs], { env: env || process.env, stdio: 'ignore', windowsHide: true });
  kids.add(child);
  return child;
}
async function health(port, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) }); if (r.ok) return await r.json(); } catch { /* not yet */ }
    await sleep(400);
  }
  return null;
}
const portFree = async (port) => { try { await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1200) }); return false; } catch { return true; } };
async function stopServer(child, port) {
  if (child && child.pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await portFree(port)); i++) await sleep(400);
  return portFree(port);
}

class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.cookieName = ''; this.cookieValue = ''; }
  async req(method, url, body, timeout = 120000) {
    const headers = {}; if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (body instanceof FormData) payload = body; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + url, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    const set = res.headers.get('set-cookie');
    if (set) { this.cookie = set.split(';')[0]; const i = this.cookie.indexOf('='); this.cookieName = this.cookie.slice(0, i); this.cookieValue = this.cookie.slice(i + 1); }
    const type = res.headers.get('content-type') || '';
    let json = null, buf = null;
    if (type.includes('json')) json = await res.json().catch(() => null); else buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, json, buf };
  }
}
const pdfPages = (b) => (b ? (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length : 0);
const PW = 'Correct-Horse-9!';

// ---- the browser -------------------------------------------------------------------------------------------------------------------------------------
function findChrome() {
  const c = [process.env.CHROMIUM_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
  return c.find((p) => fs.existsSync(p));
}
async function browserRun(base, client, projectId) {
  let chromium;
  try { chromium = createRequire(path.join(root, 'frontend', 'package.json'))('playwright').chromium; } catch { return { skipped: 'Playwright is not installed in frontend/node_modules (run npm install there)' }; }
  const exe = findChrome();
  if (!exe) return { skipped: 'no Chrome or Edge found (set CHROMIUM_PATH)' };
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--no-first-run', '--disable-background-networking'] });
  const ctx = await browser.newContext();
  const seen = [], failed = [], errors = [], pages = [];
  // Logging is attached to every page the context ever opens (a pop-up to another site would be seen too).
  ctx.on('page', (p) => {
    p.on('request', (r) => seen.push(r.url()));
    p.on('requestfailed', (r) => failed.push(`${r.url()} (${r.failure() && r.failure().errorText})`));
    p.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  });
  // canary: the logger must see a request to another host. It gets a page of its own that is closed afterwards: Chrome keeps auto-reloading a page
  // that failed with a name-resolution error, and those reloads would abort the navigations that follow.
  const canaryPage = await ctx.newPage();
  await canaryPage.goto('http://offline-canary.invalid/x', { timeout: 8000 }).catch(() => {});
  const canarySeen = seen.some((u) => u.includes('offline-canary.invalid'));
  await canaryPage.close();
  seen.length = 0; failed.length = 0;
  const page = await ctx.newPage();
  await ctx.addCookies([{ name: client.cookieName, value: client.cookieValue, url: base }]);
  const routes = ['/overview', '/projects', `/projects/${projectId}/editor`, `/projects/${projectId}/explore`, `/projects/${projectId}/publication`, `/projects/${projectId}/validation`, '/settings'];
  for (const r of routes) {
    let rendered = false;
    try {
      await page.goto(base + r, { waitUntil: 'load', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      rendered = await page.evaluate(() => { const el = document.getElementById('root'); return !!el && el.children.length > 0 && (el.innerText || '').trim().length > 0; });
    } catch { /* recorded as not rendered */ }
    pages.push({ r, rendered });
  }
  const fonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].map((f) => `${f.family}:${f.status}`); }).catch(() => []);
  await browser.close();
  const origin = new URL(base).origin;
  const outside = seen.filter((u) => !/^(data:|blob:|about:)/i.test(u) && new URL(u).origin !== origin);
  return { canarySeen, pages, outside, failed, errors, fonts, count: seen.length };
}

// ---- the workflow ------------------------------------------------------------------------------------------------------------------------------------
async function workflow(base) {
  const out = {};
  const admin = new Client(base);
  let r = await admin.req('GET', '/api/auth/setup'); out.setupRequired = r.json && r.json.setupRequired;
  r = await admin.req('POST', '/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' }); out.setup = r.status;
  const made = await admin.req('POST', '/api/team/users', { username: 'alice', fullName: 'Alice Author', role: 'author' }); out.userCreated = made.status;
  const alice = new Client(base);
  r = await alice.req('POST', '/api/auth/login', { username: 'alice', password: made.json && made.json.tempPassword }); out.login = r.status;
  r = await alice.req('POST', '/api/auth/onboarding', { username: 'alice', password: PW }); out.onboarding = r.status;
  out.alice = alice;

  // the ready-made sample project -> PDF
  r = await alice.req('POST', '/api/projects/sample', {}); out.sample = r.status;
  const sid = r.json && r.json.project && r.json.project.id; out.sampleId = sid;
  if (sid) {
    const t = Date.now();
    r = await alice.req('POST', `/api/projects/${sid}/publish`, {}, 600000); out.samplePublish = r.status; out.samplePublishDetail = r.status === 200 ? '' : JSON.stringify(r.json || (r.buf && r.buf.toString().slice(0, 300))).slice(0, 600);
    out.samplePublishMs = Date.now() - t;
    if (r.status === 200) { const pdf = await alice.req('GET', `/api/projects/${sid}/publish/pdf`); out.samplePdf = pdf.buf; }
  }

  // an S1000D import of a subset of a real package
  if (fs.existsSync(importDir)) {
    const names = fs.readdirSync(importDir);
    const pmc = names.find((x) => /^PMC.*\.xml$/i.test(x));
    const dmcs = names.filter((x) => /^DMC.*\.xml$/i.test(x)).sort().slice(0, importLimit);
    const icns = new Set();
    for (const f of [pmc, ...dmcs].filter(Boolean)) for (const m of fs.readFileSync(path.join(importDir, f), 'utf8').matchAll(/infoEntityIdent="(ICN-[^"]+)"/g)) icns.add(m[1]);
    const pics = names.filter((x) => [...icns].some((i) => x.startsWith(i)));
    const files = [pmc, ...dmcs, ...pics].filter(Boolean);
    out.importFiles = files.length;
    r = await alice.req('POST', '/api/projects', { name: 'Import check', pipeline: 's1000dtofo', profile: 'xignal-s1000d' }); out.importProject = r.status;
    const pid = r.json && r.json.project && r.json.project.id; out.importId = pid;
    if (pid) {
      const form = () => { const fd = new FormData(); for (const f of files) fd.append('files', new Blob([fs.readFileSync(path.join(importDir, f))]), f); return fd; };
      r = await alice.req('POST', `/api/projects/${pid}/import/scan`, form(), 300000); out.scan = r.status;
      r = await alice.req('POST', `/api/projects/${pid}/import/apply`, form(), 300000); out.apply = r.status; out.applyDetail = r.status === 200 ? '' : JSON.stringify(r.json).slice(0, 400);
      r = await alice.req('POST', `/api/projects/${pid}/validation`, {}, 300000); out.validation = r.status;
      r = await alice.req('POST', `/api/projects/${pid}/publish`, {}, 600000); out.importGate = r.status;
      if (r.status === 422 && r.json && r.json.findings) {
        const f = r.json.findings.find((x) => x.kind === 'brex-source' && /is not available/.test(x.title));
        if (f) {
          const subject = f.title.replace(/^BREX /, '').replace(/ is not available$/, '');
          const w = await alice.req('POST', `/api/projects/${pid}/publish-waivers`, { kind: 'brex-missing', subject, reason: 'Offline verification: the organisation BREX is not part of the sample package; draft build only.' });
          out.waiver = w.status;
          r = await alice.req('POST', `/api/projects/${pid}/publish`, {}, 600000);
        }
      }
      out.importPublish = r.status; out.importPublishDetail = r.status === 200 ? '' : JSON.stringify(r.json || (r.buf && r.buf.toString().slice(0, 300))).slice(0, 600);
      if (r.status === 200) { const pdf = await alice.req('GET', `/api/projects/${pid}/publish/pdf`); out.importPdf = pdf.buf; }
    }
  }
  return out;
}

// ---- main --------------------------------------------------------------------------------------------------------------------------------------------
let trapServer = null, poll = null, server = null;
let program = null; // the unpacked / copied product used for instruments
try {
  console.log(`Package:  ${zip || dirArg}\nScratch:  ${work}`);

  // unpack
  head('Unpacking');
  if (zip) {
    fs.mkdirSync(portableDir, { recursive: true });
    const x = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', portableDir], { encoding: 'utf8' });
    check('the ZIP unpacks (into a folder with spaces and non-ASCII letters)', x.status === 0, x.stderr);
  } else copyTree(path.resolve(dirArg), portableDir);
  const pTree = tree(portableDir);
  if (!pTree) throw new Error('AgastyaPlatform.exe was not found in the package.');
  check('the package has the host, the runtime and the application', ['AgastyaPlatform.exe', 'AgastyaCtl.exe', 'runtime/node.exe', 'app/backend/dist/index.js', 'app/frontend/dist/index.html', 'app/backend/vendor/tools/jre/bin/java.exe'].every((f) => fs.existsSync(path.join(pTree, f))));
  check('the ZIP is a portable package (portable.flag)', !zip || fs.existsSync(path.join(pTree, 'portable.flag')));

  staticScan(pTree);

  // ---- instruments + canaries
  head('2. Instruments (each must catch its canary before silence means anything)');
  trapServer = await startTrap();
  const env = instrumentEnv();
  const nodeExe = path.join(pTree, 'runtime', 'node.exe');
  const c1 = spawnSync(nodeExe, ['-e', "require('net').connect(80,'192.0.2.1').on('error',()=>{}).setTimeout(300,function(){this.destroy()});require('dns').lookup('offline-canary.invalid',()=>{})"], { env, timeout: 15000 });
  const canaryLines = netlogLines();
  check('Node preload: a connection and a DNS lookup to another host are recorded', canaryLines.some((l) => l.includes('192.0.2.1')) && canaryLines.some((l) => l.includes('offline-canary.invalid')), `exit ${c1.status}; log: ${canaryLines.join(' | ')}`);
  fs.writeFileSync(netlog, '');
  // JVM: FOP asked to fetch an image from another host must go to the trap
  const fopHome = path.join(pTree, 'app', 'backend', 'vendor', 'tools', 'fop-2.10', 'fop');
  const javaExe = path.join(pTree, 'app', 'backend', 'vendor', 'tools', 'jre', 'bin', 'java.exe');
  const fo = path.join(work, 'canary.fo');
  fs.writeFileSync(fo, '<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-width="50mm" page-height="50mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block><fo:external-graphic src="url(http://offline-canary.invalid/x.png)"/></fo:block></fo:flow></fo:page-sequence></fo:root>');
  const before = trapHits.length;
  // Asynchronous on purpose: the trap lives in this process, and a blocked process cannot answer the proxy request the renderer waits on.
  await new Promise((resolve) => {
    const jp = spawn(javaExe, ['-cp', `${path.join(fopHome, 'build')}\\*;${path.join(fopHome, 'lib')}\\*`, 'org.apache.fop.cli.Main', '-fo', fo, '-pdf', path.join(work, 'canary.pdf')], { env, stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => spawnSync('taskkill', ['/F', '/T', '/PID', String(jp.pid)], { stdio: 'ignore' }), 60000);
    jp.on('close', () => { clearTimeout(timer); resolve(); });
    jp.on('error', () => { clearTimeout(timer); resolve(); });
  });
  await sleep(500);
  check('JVM proxy trap: an http request made by the PDF renderer reaches the trap', trapHits.length > before, 'The renderer did not send the canary request to the proxy trap; the trap cannot vouch for the renderer.');
  trapHits.length = 0;
  program = pTree;

  // ---- 3. portable
  head('3. The portable ZIP, as unpacked');
  fs.mkdirSync(path.join(pTree, 'config'), { recursive: true });
  fs.writeFileSync(path.join(pTree, 'config', 'agastya.ini'), `[server]\r\nPort=${portA}\r\nBind=loopback\r\n[app]\r\nOpenBrowser=0\r\n`);
  const doc = spawnSync(path.join(pTree, 'AgastyaCtl.exe'), ['--doctor'], { encoding: 'utf8', timeout: 60000 });
  check('AgastyaCtl --doctor finds nothing wrong', doc.status === 0, `${doc.stdout}`);
  server = startServer(pTree, []);
  const hp = await health(portA);
  check('the portable server starts and answers', hp && hp.status === 'ok', JSON.stringify(hp));
  const su = await fetch(`http://127.0.0.1:${portA}/api/auth/setup`).then((r) => r.json()).catch(() => null);
  check('a fresh copy asks for the first administrator (no default password ships)', su && su.setupRequired === true, JSON.stringify(su));
  const ui = await fetch(`http://127.0.0.1:${portA}/`).then((r) => r.text()).catch(() => '');
  check('and serves the web client', /id=["']root["']/.test(ui));
  await sleep(800);
  check('its data and logs are beside it (portable mode)', fs.existsSync(path.join(pTree, 'data', 'workspace', 'publisher.db')) && fs.existsSync(path.join(pTree, 'data', 'logs', 'agastya-server.log')));
  check('the portable server stops cleanly and leaves nothing listening', await stopServer(server, portA)); server = null;

  // ---- 4. read-only installed layout with a real workflow
  head('4. Installed layout, program folder READ-ONLY, full workflow, every instrument watching');
  copyTree(pTree, readonlyDir);
  fs.rmSync(path.join(readonlyDir, 'portable.flag'), { force: true });
  fs.rmSync(path.join(readonlyDir, 'config'), { recursive: true, force: true });
  fs.rmSync(path.join(readonlyDir, 'data'), { recursive: true, force: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(path.join(homeDir, 'agastya.ini'), `[server]\r\nPort=${portB}\r\nBind=loopback\r\n[app]\r\nOpenBrowser=0\r\n`);
  setReadOnly(readonlyDir, true);
  const m0 = manifest(readonlyDir);
  program = readonlyDir;
  poll = startPoll(readonlyDir);
  await sleep(2500);
  const cenv = instrumentEnv();
  // OS-level canary: a process from the product folder that tries to reach another host must be seen by the TCP poll
  const canarySock = spawn(path.join(readonlyDir, 'runtime', 'node.exe'), ['-e', "const s=require('net').connect({port:80,host:'192.0.2.1'});s.on('error',()=>{});setTimeout(()=>process.exit(0),4000)"], { stdio: 'ignore', windowsHide: true });
  kids.add(canarySock);
  await sleep(3500);
  check('TCP poll: a connection attempt to another host from the product folder is seen', poll.ticks > 3 && poll.conns.some((c) => c.includes('192.0.2.1')), `ticks=${poll.ticks}; saw: ${poll.conns.join(' | ') || 'nothing'}`);
  poll.conns.length = 0; fs.writeFileSync(netlog, ''); trapHits.length = 0;

  server = startServer(readonlyDir, ['--home', homeDir], cenv);
  const hb = await health(portB);
  check('the server starts from the read-only program folder', hb && hb.status === 'ok', JSON.stringify(hb));
  const baseB = `http://127.0.0.1:${portB}`;
  const wf = await workflow(baseB);
  check('first-run setup: the administrator is created', wf.setupRequired === true && wf.setup === 200, `setupRequired=${wf.setupRequired}, setup=${wf.setup}`);
  check('an author account is created and signs in', wf.userCreated < 300 && wf.login === 200 && wf.onboarding === 200, `create=${wf.userCreated} login=${wf.login} onboarding=${wf.onboarding}`);
  check('the ready-made sample project is created', wf.sample === 201, `status ${wf.sample}`);
  check(`it publishes to PDF (${wf.samplePublishMs ?? '?'} ms)`, wf.samplePublish === 200, wf.samplePublishDetail);
  check('the PDF is a real PDF with pages', wf.samplePdf && wf.samplePdf.slice(0, 5).toString() === '%PDF-' && pdfPages(wf.samplePdf) >= 3 && wf.samplePdf.length > 20000, wf.samplePdf ? `${wf.samplePdf.length} bytes, ${pdfPages(wf.samplePdf)} pages` : 'no PDF');
  if (fs.existsSync(importDir)) {
    check(`an S1000D package subset (${wf.importFiles ?? '?'} files, opened read-only) imports`, wf.importProject === 201 && wf.scan === 200 && wf.apply === 200, `project=${wf.importProject} scan=${wf.scan} apply=${wf.apply} ${wf.applyDetail || ''}`);
    check('the imported project validates', wf.validation === 200, `status ${wf.validation}`);
    check(`the imported project publishes (gate answered ${wf.importGate}${wf.waiver ? `, draft waiver ${wf.waiver}` : ''})`, wf.importPublish === 200, wf.importPublishDetail);
    check('its PDF is a real PDF with pages', wf.importPdf && wf.importPdf.slice(0, 5).toString() === '%PDF-' && pdfPages(wf.importPdf) >= 2, wf.importPdf ? `${wf.importPdf.length} bytes, ${pdfPages(wf.importPdf)} pages` : 'no PDF');
  } else skip('S1000D import and publish', `${importDir} was not found (pass --import-dir)`);

  const br = await browserRun(baseB, wf.alice, wf.sampleId || wf.importId || '');
  if (br.skipped) skip('the web client in Chrome', br.skipped);
  else {
    check('browser log: a request to another host is recorded (canary)', br.canarySeen);
    check(`the web client pages render (${br.pages.map((p) => `${p.r}:${p.rendered ? 'ok' : 'EMPTY'}`).join(' ')})`, br.pages.every((p) => p.rendered), br.pages.filter((p) => !p.rendered).map((p) => p.r).join(', '));
    check(`the browser made ${br.count} requests, all to this server`, br.outside.length === 0 && br.failed.length === 0, [...br.outside, ...br.failed].slice(0, 8).join('\n'));
    check('no script error on any page', br.errors.length === 0, br.errors.slice(0, 4).join('\n'));
    console.log(`  info  fonts the pages use: ${br.fonts.length ? [...new Set(br.fonts)].join(', ') : 'none reported'}`);
  }
  await sleep(1500);

  // ---- 5. verdicts
  head('5. Verdict');
  const lines = netlogLines();
  check('Node: no connection, DNS lookup or UDP send to another host', lines.length === 0, lines.slice(0, 8).join('\n'));
  check('JVM: nothing reached the proxy trap', trapHits.length === 0, trapHits.slice(0, 8).join('\n'));
  check('OS: no process of the product held a connection to another host', poll.conns.length === 0, poll.conns.slice(0, 8).join('\n'));
  check('the TCP poll ran throughout (it was not silent because it was dead)', poll.ticks > 30, `ticks=${poll.ticks}`);
  const stopped = await stopServer(server, portB); server = null;
  check('the server stops cleanly and leaves nothing listening', stopped);
  const m1 = manifest(readonlyDir);
  const changed = m1.filter((l) => !m0.includes(l)).concat(m0.filter((l) => !m1.includes(l)));
  check('nothing was written into the program folder', changed.length === 0, changed.slice(0, 6).join('\n'));
  const projectsMade = fs.existsSync(path.join(homeDir, 'workspace', 'projects')) ? fs.readdirSync(path.join(homeDir, 'workspace', 'projects')).length : 0;
  check('the data went where it was told (publisher.db and the projects are in the data folder)', fs.existsSync(path.join(homeDir, 'workspace', 'publisher.db')) && projectsMade >= (fs.existsSync(importDir) ? 2 : 1), `projects in the data folder: ${projectsMade}`);
} catch (e) {
  check('verification ran to the end', false, e.stack || String(e));
} finally {
  if (server) { try { spawnSync('taskkill', ['/F', '/T', '/PID', String(server.pid)], { stdio: 'ignore' }); } catch { /* gone */ } }
  for (const k of kids) { try { if (k.pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(k.pid)], { stdio: 'ignore' }); } catch { /* gone */ } }
  if (trapServer) trapServer.close();
  await sleep(800);
  if (!has('--keep')) {
    try { setReadOnly(readonlyDir, false); } catch { /* best effort */ }
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { console.log(`  note  could not remove ${work}: ${e.message}`); }
  } else console.log(`\n  kept: ${work}`);
}
const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped).length;
console.log(`\n${results.length - failed.length - skipped} passed, ${failed.length} failed, ${skipped} skipped (${results.length} checks).`);
process.exit(failed.length ? 1 : 0);
