'use strict';
// Shared harness: boots the REAL app in-process on a throwaway workspace and
// gives tests a tiny cookie-aware HTTP client. Run `npm run build` first - the
// tests exercise the compiled output, exactly what ships.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const SAMPLES = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'samples');

async function boot() {
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
  const close = () => new Promise((r) => { try { require('../dist/services/publisher').stopRenderer(); } catch { /* none */ } server.close(r); });
  return { base, ws, Client, sample, SAMPLES, close };
}

module.exports = { boot, SAMPLES };

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
