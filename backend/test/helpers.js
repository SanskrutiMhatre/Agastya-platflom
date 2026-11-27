'use strict';
// Shared harness: boots the REAL app in-process on a throwaway workspace and
// gives tests a tiny cookie-aware HTTP client. Run `npm run build` first - the
// tests exercise the compiled output, exactly what ships.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const SAMPLES = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'samples');
// The 21-type x 4-issue data modules the e2e suite also uses (QA-014, ARC-023). Every backend test reaches them through this one constant, so
// moving the folder (to a neutral test-fixtures/ at the root) is a one-line change here.
const DM21 = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21');

// Where suites write their result files (per type x issue tables for docs/DM_TYPE_VERIFICATION.md). The CI gate points this at its evidence folder
// (QA-010, QA-017); by default it is the git-ignored frontend/verification-results that scripts/verify-report.mjs reads.
const RESULTS = process.env.AGASTYA_TEST_RESULTS || path.resolve(__dirname, '..', '..', 'frontend', 'verification-results');

// Temporary folders made by a test file, removed when its process ends (QA-010: the suite used to leave thousands of folders in %TEMP%).
// AGASTYA_KEEP_TEMP=1 keeps them for debugging.
const temps = new Set();
function rmQuiet(d) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); return true; } catch { return false; } }
process.on('exit', () => { if (process.env.AGASTYA_KEEP_TEMP) return; for (const d of temps) rmQuiet(d); });
/** A new temporary folder that is removed when the test process ends. */
function tmp(prefix = 'agastya-test-') { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.add(d); return d; }

// QA-015: the tests run the compiled dist/. Editing src/ and running a test file without rebuilding used to test the old code silently.
let freshChecked = false;
function assertDistFresh() {
  if (freshChecked || process.env.AGASTYA_SKIP_DIST_CHECK) return; freshChecked = true;
  const root = path.resolve(__dirname, '..'); const app = path.join(root, 'dist', 'app.js');
  if (!fs.existsSync(app)) throw new Error('backend/dist is missing: build first (`npx tsc -p .` in backend/, or `npm run build`)');
  const built = fs.statSync(app).mtimeMs; const newer = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.ts') && fs.statSync(f).mtimeMs > built + 1000) newer.push(path.relative(root, f)); } };
  walk(path.join(root, 'src'));
  if (newer.length) throw new Error(`backend/dist is older than src/ (${newer.slice(0, 3).join(', ')}${newer.length > 3 ? ', ...' : ''}): the tests would run stale code. Rebuild with \`npx tsc -p .\` in backend/.`);
}

async function boot() {
  assertDistFresh();
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-v2-test-'));
  process.env.AGASTYA_WORKSPACE_DIR = ws;
  // The workspace is read from the environment ONCE, when dist/config is first loaded. A test that required anything from dist/ before calling
  // boot() would have frozen the default workspace - the developer's real one - and the app would then open, seed and write to THAT instead of
  // the throwaway folder. Refuse before dist/app (which opens the database on load) is touched.
  const loaded = require('../dist/config').config.workspaceDir;
  if (path.resolve(loaded) !== path.resolve(ws)) {
    throw new Error(`boot(): dist/config was loaded before boot() set AGASTYA_WORKSPACE_DIR, so it points at ${loaded} instead of the throwaway ${ws}. `
      + 'Require anything from ../dist only AFTER calling boot() (or set AGASTYA_WORKSPACE_DIR yourself before the first require).');
  }
  const { createApp } = require('../dist/app');
  const server = http.createServer(createApp());
  require('../dist/services/uploads').tuneServer(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  class Client {
    constructor(name) { this.name = name; this.cookie = ''; }
    async req(method, url, body, extraHeaders = {}) {
      const headers = { ...extraHeaders };
      if (this.cookie) headers.cookie = this.cookie;
      let payload;
      if (body instanceof FormData) payload = body;
      else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
      const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
      const set = res.headers.get('set-cookie');
      if (set) this.cookie = set.split(';')[0];
      const type = res.headers.get('content-type') || '';
      let json = null; let buf = null;
      if (type.includes('json')) json = await res.json().catch(() => null);
      else buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, json, buf, headers: res.headers };
    }
    get(u) { return this.req('GET', u); }
    post(u, b) { return this.req('POST', u, b ?? {}); }
    put(u, b) { return this.req('PUT', u, b); }
    patch(u, b) { return this.req('PATCH', u, b); }
    del(u) { return this.req('DELETE', u); }
  }

  const sample = (n) => fs.readFileSync(path.join(SAMPLES, n), 'utf8');
  // close(): stop the renderer and the server, close the database, and remove the throwaway workspace (QA-010). On Windows a file still held by
  // a child process cannot be removed at once; the exit handler tries again. AGASTYA_KEEP_TEMP=1 keeps the workspace.
  const close = () => new Promise((r) => { try { require('../dist/services/publisher').stopRenderer(); } catch { /* none */ } server.close(r); })
    .then(() => {
      try { require('../dist/context').registryDb.close(); } catch { /* already closed */ }
      temps.add(ws); if (!process.env.AGASTYA_KEEP_TEMP && rmQuiet(ws)) temps.delete(ws);
    });
  return { base, ws, Client, sample, SAMPLES, close };
}

module.exports = { boot, SAMPLES, DM21, RESULTS, tmp };

/**
 * Check a ZIP with a tool that is NOT this project's own reader (a verifier that shares the writer's mistakes proves nothing):
 * Python's zipfile, Info-ZIP's "unzip -t", or libarchive's bsdtar (the tar.exe in Windows 10+ System32, "bsdtar" elsewhere; it reads ZIP and ZIP64
 * and fails on a bad CRC when an entry is read). GNU tar cannot read ZIP, so a tar that says so is not a verifier and is skipped.
 * Returns the name of the tool used; throws when the archive is rejected, or when the machine has no independent tool.
 */
function verifyZip(file) {
  const { spawnSync } = require('child_process');
  const cwd = path.dirname(file); const name = path.basename(file);          // relative name: a drive letter (C:) is read as host:path by some tars
  const winTar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe') : 'bsdtar';
  const attempts = [['python3', ['-m', 'zipfile', '-t', name]], ['python', ['-m', 'zipfile', '-t', name]], ['unzip', ['-tqq', name]], [winTar, ['-xOf', name]]];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.error) continue;                                              // not installed
    const err = (r.stderr || '').trim();
    if (/Python was not found/i.test(err) || /does not look like a tar archive/i.test(err) || /Cannot connect to/i.test(err)) continue;   // a Store stub, or a tar that cannot read ZIP
    if (r.status !== 0) throw new Error(`${path.basename(cmd)} rejected ${name}: ${err.slice(0, 300)}`);
    return path.basename(cmd);
  }
  throw new Error('no independent ZIP verifier on this machine (need python3, unzip or bsdtar)');
}

module.exports.verifyZip = verifyZip;
