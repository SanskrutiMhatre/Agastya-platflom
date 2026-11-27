'use strict';
// WP-26 (ENT-001, SEC-006, DEP-010): network security and the client/server protocol.
//   * configuration: Mode A refuses a network address; Mode B on the network refuses to start without TLS; every error names the variable;
//   * the certificate: PEM or PKCS#12, wrong key / wrong passphrase / expired stop the start naming the variable;
//   * Mode B over TLS (a real server process, a throwaway CA and server certificate made in a temp folder, nothing installed anywhere):
//     HTTPS answers, a plain HTTP request to the same port gets no HTTP answer, Secure cookies, HSTS, wss works, a client that trusts only
//     the CA connects, the Host rule includes the certificate's names;
//   * Mode A listens on loopback only (a connection to this machine's network address is refused);
//   * Host rule (DNS rebinding) and the client-version handshake, over HTTP and the WebSocket upgrade.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const net = require('node:net');
const http = require('node:http'); const https = require('node:https');
const { spawn, spawnSync } = require('node:child_process');
const WebSocket = require('ws');
const { boot, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DIST = path.resolve(__dirname, '..', 'dist', 'index.js');
let h;

test.before(async () => { h = await boot({ ws: true }); });
test.after(async () => { if (h) await h.close(); });

// ---- helpers -----------------------------------------------------------------------------------------------------------------------------

const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

/** A raw request with any Host header (fetch does not let a test choose it). */
function raw(base, { method = 'GET', path: p = '/api/health', headers = {}, body } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const r = http.request({ host: u.hostname, port: u.port, method, path: p, headers: { ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

/** Start dist/index.js with `env` (on top of a clean copy of this process's environment). Resolves `ready` when it listens. */
function serve(env) {
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (/^AGASTYA_(MODE|HOST|TLS_|SERVER_NAMES|HSTS|SECURE_COOKIES)/.test(k)) delete base[k];
  const child = spawn(process.execPath, [DIST], { env: { ...base, AGASTYA_SHUTDOWN_ON_STDIN_CLOSE: '1', AGASTYA_NO_WORKSPACE_LOCK: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    const t = setInterval(() => { if (/running on https?:/.test(out)) { clearInterval(t); resolve(); } }, 50);
    void exited.then((code) => { clearInterval(t); reject(new Error(`server exited (${code}): ${out.slice(-1200)}`)); });
  });
  const stop = async () => { if (child.exitCode === null) { child.stdin.end(); await exited; } };
  return { child, ready, exited, stop, log: () => out };
}

function pki() {
  const { makeCertificate } = require('../dist/services/tlsCert');
  const dir = tmp('agastya-wp26-pki-');
  const ca = makeCertificate({ commonName: 'WP-26 test CA', ca: true });
  const leaf = makeCertificate({ commonName: 'agastya.test', altNames: ['agastya.test', 'localhost', '127.0.0.1'], issuer: ca });
  const other = makeCertificate({ commonName: 'other' });
  const expired = makeCertificate({ commonName: 'old', altNames: ['localhost'], notBefore: new Date(Date.now() - 400 * 86400_000), notAfter: new Date(Date.now() - 86400_000) });
  const w = (f, s) => { const p = path.join(dir, f); fs.writeFileSync(p, s); return p; };
  return {
    dir, ca,
    caFile: w('ca.pem', ca.certPem), cert: w('server.pem', leaf.certPem), key: w('server-key.pem', leaf.keyPem),
    otherKey: w('other-key.pem', other.keyPem), expiredCert: w('expired.pem', expired.certPem), expiredKey: w('expired-key.pem', expired.keyPem),
    fingerprint: leaf.fingerprint256,
  };
}

/** An HTTPS request that trusts only `ca` (and sends `host` as the name the client asked for). */
function tlsGet(port, p, { ca, servername = 'agastya.test', headers = {}, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const r = https.request({ host: '127.0.0.1', port, path: p, method, ca, servername, headers: { host: `${servername}:${port}`, ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

function findOpenssl() {
  const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
  for (const c of candidates) { const r = spawnSync(c, ['version'], { encoding: 'utf8' }); if (r.status === 0) return c; }
  return null;
}

// ---- configuration -------------------------------------------------------------------------------------------------------------------------

test('configuration: Mode A is loopback only, Mode B on the network needs TLS; each refusal names the variable', () => {
  const { buildConfig, ConfigError, isLoopbackHost } = require('../dist/config');
  const { listenAddresses } = require('../dist/services/network');
  const refuses = (env, variable) => assert.throws(() => buildConfig(env), (e) => e instanceof ConfigError && e.variable === variable && e.message.startsWith(`${variable}:`), `${JSON.stringify(env)} -> ${variable}`);

  const a = buildConfig({});
  assert.equal(a.mode, 'local'); assert.equal(a.host, undefined); assert.equal(a.tls, null); assert.equal(a.secureCookies, false);
  assert.deepEqual(listenAddresses(a), ['127.0.0.1', '::1'], 'Mode A without AGASTYA_HOST listens on the loopback addresses only');
  for (const host of ['127.0.0.1', '::1', 'localhost', '127.0.0.5']) assert.equal(buildConfig({ AGASTYA_HOST: host }).host, host);
  for (const host of ['0.0.0.0', '::', '192.168.1.20', 'docs.example.local']) refuses({ AGASTYA_HOST: host }, 'AGASTYA_HOST');
  refuses({ AGASTYA_MODE: 'cluster' }, 'AGASTYA_MODE');

  refuses({ AGASTYA_MODE: 'server' }, 'AGASTYA_TLS_CERT');                                  // every interface, no certificate
  refuses({ AGASTYA_MODE: 'server', AGASTYA_HOST: '0.0.0.0' }, 'AGASTYA_TLS_CERT');
  assert.equal(buildConfig({ AGASTYA_MODE: 'server', AGASTYA_HOST: '127.0.0.1' }).tls, null, 'Mode B behind a TLS proxy on this computer');
  const b = buildConfig({ AGASTYA_MODE: 'server', AGASTYA_HOST: '0.0.0.0', AGASTYA_TLS_CERT: 'c.pem', AGASTYA_TLS_KEY: 'k.pem' });
  assert.deepEqual(b.tls, { certFile: 'c.pem', keyFile: 'k.pem', pfxFile: undefined, passphraseFile: undefined });
  assert.equal(b.secureCookies, true, 'TLS on: cookies are Secure');
  assert.deepEqual(listenAddresses(buildConfig({ AGASTYA_MODE: 'server', AGASTYA_TLS_PFX: 'x.pfx' })), [undefined]);

  refuses({ AGASTYA_TLS_CERT: 'c.pem' }, 'AGASTYA_TLS_KEY');
  refuses({ AGASTYA_TLS_KEY: 'k.pem' }, 'AGASTYA_TLS_CERT');
  refuses({ AGASTYA_TLS_PFX: 'x.pfx', AGASTYA_TLS_CERT: 'c.pem' }, 'AGASTYA_TLS_PFX');
  refuses({ AGASTYA_TLS_PASSPHRASE_FILE: 'pw.txt' }, 'AGASTYA_TLS_PASSPHRASE_FILE');
  refuses({ AGASTYA_SERVER_NAMES: 'https://docs.example' }, 'AGASTYA_SERVER_NAMES');
  refuses({ AGASTYA_SERVER_NAMES: 'docs.example:4040' }, 'AGASTYA_SERVER_NAMES');
  assert.deepEqual(buildConfig({ AGASTYA_SERVER_NAMES: 'Docs.Example.local, 10.0.0.5, *.corp.local' }).serverNames, ['docs.example.local', '10.0.0.5', '*.corp.local']);
  refuses({ AGASTYA_HSTS_MAX_AGE: '-1' }, 'AGASTYA_HSTS_MAX_AGE');
  assert.equal(buildConfig({}).hstsMaxAge, 15552000); assert.equal(buildConfig({ AGASTYA_HSTS_MAX_AGE: '0' }).hstsMaxAge, 0);

  for (const l of ['127.0.0.1', '127.1.2.3', '::1', '[::1]', 'localhost', 'LOCALHOST', 'app.localhost', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']) assert.equal(isLoopbackHost(l), true, l);
  for (const n of ['0.0.0.0', '10.0.0.1', 'localhost.evil.example', '128.0.0.1', '::', 'example.com']) assert.equal(isLoopbackHost(n), false, n);
});

test('the Host rule: loopback names always; configured names, certificate names and wildcards in Mode B; anything else refused', () => {
  const { hostCheckFor, hostOnly } = require('../dist/services/network');
  assert.equal(hostOnly('Docs.Example:4040'), 'docs.example'); assert.equal(hostOnly('[::1]:4040'), '::1'); assert.equal(hostOnly('example.'), 'example');
  const a = hostCheckFor({ mode: 'local', host: undefined, serverNames: [] });
  for (const ok of [undefined, '', 'localhost:4040', '127.0.0.1:4040', '[::1]:4040', 'LOCALHOST']) assert.equal(a(ok), true, String(ok));
  for (const bad of ['evil.example:4040', 'localhost.evil.example', '192.168.1.20:4040', 'agastya.test']) assert.equal(a(bad), false, bad);
  const b = hostCheckFor({ mode: 'server', host: '10.0.0.5', serverNames: ['docs.example.local', '*.corp.local'] }, ['agastya.test', '0:0:0:0:0:0:0:1', 'fe80:0:0:0:0:0:0:1']);
  for (const ok of ['docs.example.local:443', 'a.corp.local', 'agastya.test:4040', '10.0.0.5:4040', '[fe80::1]:4040', 'localhost']) assert.equal(b(ok), true, ok);
  for (const bad of ['corp.local', 'a.b.corp.local', 'evil.example', '10.0.0.6']) assert.equal(b(bad), false, bad);
  assert.equal(hostCheckFor({ mode: 'server', host: undefined, serverNames: ['*'] })('anything.example'), true, '"*" turns the rule off on purpose');
});

test('the certificate: wrong key, unreadable file, expired, wrong PKCS#12 passphrase each stop the start naming the variable', () => {
  const { loadTls } = require('../dist/services/network');
  const { ConfigError } = require('../dist/config');
  const k = pki();
  const named = (fn, variable, re) => assert.throws(fn, (e) => e instanceof ConfigError && e.variable === variable && (!re || re.test(e.message)), variable);
  const good = loadTls({ certFile: k.cert, keyFile: k.key });
  assert.equal(good.info.fingerprint256, k.fingerprint); assert.deepEqual(good.info.altNames, ['agastya.test', 'localhost', '127.0.0.1']);
  assert.ok(good.info.daysLeft > 300 && good.info.source === 'pem');
  named(() => loadTls({ certFile: k.cert, keyFile: k.otherKey }), 'AGASTYA_TLS_KEY', /not the private key/);
  named(() => loadTls({ certFile: path.join(k.dir, 'missing.pem'), keyFile: k.key }), 'AGASTYA_TLS_CERT', /cannot read/);
  named(() => loadTls({ certFile: k.key, keyFile: k.key }), 'AGASTYA_TLS_CERT', /not a PEM certificate/);
  named(() => loadTls({ certFile: k.expiredCert, keyFile: k.expiredKey }), 'AGASTYA_TLS_CERT', /expired/);
  named(() => loadTls({ certFile: k.cert, keyFile: k.key, passphraseFile: path.join(k.dir, 'nope.txt') }), 'AGASTYA_TLS_PASSPHRASE_FILE');
});

test('PKCS#12: a .pfx with its passphrase file loads; a wrong passphrase names AGASTYA_TLS_PFX', (t) => {
  const openssl = findOpenssl();
  if (!openssl) { t.skip('no openssl on this machine to write a .pfx (the PEM path is covered above)'); return; }
  const { loadTls } = require('../dist/services/network');
  const k = pki(); const pfx = path.join(k.dir, 'server.pfx');
  const r = spawnSync(openssl, ['pkcs12', '-export', '-in', k.cert, '-inkey', k.key, '-out', pfx, '-passout', 'pass:wp26-pass'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  fs.writeFileSync(path.join(k.dir, 'pw.txt'), 'wp26-pass\r\n'); fs.writeFileSync(path.join(k.dir, 'bad.txt'), 'wrong');
  const m = loadTls({ pfxFile: pfx, passphraseFile: path.join(k.dir, 'pw.txt') });
  assert.equal(m.info.source, 'pfx'); assert.equal(m.info.fingerprint256, k.fingerprint); assert.ok(m.info.altNames.includes('agastya.test'));
  assert.throws(() => loadTls({ pfxFile: pfx, passphraseFile: path.join(k.dir, 'bad.txt') }), (e) => e.variable === 'AGASTYA_TLS_PFX');
});

// ---- Host rule and version handshake on the in-process server ---------------------------------------------------------------------------

test('DNS rebinding: a request or an upgrade naming another host gets 421, first-run setup included; loopback names pass', async () => {
  const port = new URL(h.base).port;
  const evil = `rebind.evil.example:${port}`;
  const setup = await raw(h.base, { method: 'POST', path: '/api/auth/setup', headers: { host: evil, origin: `http://${evil}` }, body: JSON.stringify({ username: 'mallory', password: PW, fullName: 'M' }) });
  assert.equal(setup.status, 421, 'a rebound page cannot create the first administrator');
  assert.equal(setup.json.code, 'MISDIRECTED_REQUEST');
  assert.equal((await raw(h.base, { path: '/', headers: { host: evil } })).status, 421, 'nor read the application');
  assert.equal((await raw(h.base, { path: '/api/auth/setup', headers: { host: evil } })).status, 421);
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) assert.equal((await raw(h.base, { headers: { host } })).status, 200, host);
  const stillFresh = await raw(h.base, { path: '/api/auth/setup' });
  assert.equal(stillFresh.json.setupRequired, true, 'nothing was created');

  const admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  const ws = await h.socket(admin, { origin: `http://${evil}`, headers: { host: evil } });
  assert.equal(ws.status, 421, 'the WebSocket follows the same Host rule');
  const ok = await h.socket(admin);
  assert.equal(ok.opened, true); ok.close();
  const sub = await h.socket(admin, { path: '/wsx' });
  assert.equal(sub.opened, false, 'only the exact /ws path upgrades');
});

test('version handshake: an older client gets 426 on the API and the WebSocket; the version routes always answer', async () => {
  const admin = new h.Client('admin2');
  const me = await admin.req('POST', '/api/auth/login', { username: 'admin', password: PW });
  assert.equal(me.status, 200);
  const v = await admin.get('/api/version');
  assert.equal(v.status, 200); assert.equal(v.json.minClientVersion, '2.0.0'); assert.equal(v.json.apiVersion, 1);

  const old = await admin.req('GET', '/api/auth/me', undefined, { 'x-agastya-client': '1.9.9' });
  assert.equal(old.status, 426); assert.equal(old.json.code, 'CLIENT_TOO_OLD'); assert.equal(old.json.minClientVersion, '2.0.0');
  assert.equal((await admin.req('GET', '/api/auth/me', undefined, { 'x-agastya-client': '2.0.0-rc.1' })).status, 426, 'a pre-release ranks below its release');
  assert.equal((await admin.req('GET', '/api/auth/me', undefined, { 'x-agastya-client': 'garbage' })).status, 426);
  for (const p of ['/api/version', '/api/health', '/api/ready']) assert.ok([200, 503].includes((await admin.req('GET', p, undefined, { 'x-agastya-client': '1.0.0' })).status), p);
  assert.equal((await admin.req('GET', '/api/auth/me', undefined, { 'x-agastya-client': '2.0.0' })).status, 200);
  assert.equal((await admin.req('GET', '/api/auth/me', undefined, { 'x-agastya-client': '2.7.1' })).status, 200, 'a newer client of the same API');
  assert.equal((await admin.get('/api/auth/me')).status, 200, 'a request that does not say (a script) is not refused');

  const oldWs = await h.socket(admin, { path: '/ws?client=1.2.0' });
  assert.equal(oldWs.status, 426);
  const newWs = await h.socket(admin, { path: '/ws?client=2.0.0' });
  assert.equal(newWs.opened, true); newWs.close();

  const { compareVersions } = require('../dist/services/version');
  assert.ok(compareVersions('2.10.0', '2.9.9') > 0); assert.ok(compareVersions('2.0.0', '2.0.0-beta') > 0); assert.equal(compareVersions('v2.0.0', '2.0.0'), 0);
  assert.ok(compareVersions('x', '0.0.1') < 0);
});

// ---- real server processes -------------------------------------------------------------------------------------------------------------

test('Mode B over TLS: HTTPS only on the port, Secure cookies, HSTS, wss, the certificate names; a client trusting only the CA connects', { timeout: 120000 }, async () => {
  const k = pki(); const port = await freePort();
  const s = serve({ AGASTYA_WORKSPACE_DIR: tmp('agastya-wp26-b-'), PORT: String(port), AGASTYA_MODE: 'server', AGASTYA_HOST: '127.0.0.1', AGASTYA_TLS_CERT: k.cert, AGASTYA_TLS_KEY: k.key, AGASTYA_SERVER_NAMES: 'docs.example.local' });
  try {
    await s.ready;
    assert.match(s.log(), /running on https:\/\/localhost:\d+/);
    assert.match(s.log(), /Mode B \(server\).*TLS, certificate/);
    const ca = k.ca.certPem;
    const health = await tlsGet(port, '/api/health', { ca });
    assert.equal(health.status, 200);
    assert.equal(health.headers['strict-transport-security'], 'max-age=15552000', 'HSTS on a Mode B TLS answer');
    assert.equal((await tlsGet(port, '/api/version', { ca })).json.apiVersion, 1);

    // a plain HTTP request to the TLS port gets no HTTP answer (G-SEC-1: 0 plain-HTTP responses)
    const plain = await new Promise((resolve) => {
      const r = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 5000 }, (res) => resolve({ status: res.statusCode }));
      r.on('error', (e) => resolve({ error: e.code || e.message })); r.on('timeout', () => { r.destroy(); resolve({ error: 'timeout' }); });
    });
    assert.equal(plain.status, undefined, `plain HTTP must not be answered: ${JSON.stringify(plain)}`);
    // a client that does not trust the CA is refused by the TLS layer
    await assert.rejects(tlsGet(port, '/api/health', {}), /self-signed|unable to verify|certificate/i);

    // first administrator over TLS: the session cookie is Secure
    const setup = await tlsGet(port, '/api/auth/setup', { ca, method: 'POST', headers: { origin: `https://agastya.test:${port}` }, body: JSON.stringify({ username: 'admin', password: PW, fullName: 'Admin' }) });
    assert.equal(setup.status, 200, JSON.stringify(setup.json));
    const cookie = String(setup.headers['set-cookie']);
    assert.match(cookie, /;\s*Secure/i, cookie);
    const jar = cookie.split(';')[0];

    // the Host rule knows the certificate's names and the configured ones, and nothing else
    assert.equal((await tlsGet(port, '/api/auth/me', { ca, headers: { cookie: jar } })).status, 200, 'agastya.test (certificate)');
    assert.equal((await tlsGet(port, '/api/health', { ca, headers: { host: `docs.example.local:${port}` } })).status, 200, 'AGASTYA_SERVER_NAMES');
    assert.equal((await tlsGet(port, '/api/health', { ca, headers: { host: `evil.example:${port}` } })).status, 421);

    // wss with the session; ws:// to the same port fails
    const wss = await new Promise((resolve) => {
      const w = new WebSocket(`wss://127.0.0.1:${port}/ws`, { ca, servername: 'agastya.test', headers: { cookie: jar, origin: `https://agastya.test:${port}`, host: `agastya.test:${port}` } });
      w.on('open', () => { w.close(); resolve('open'); }); w.on('unexpected-response', (_q, res) => resolve(res.statusCode)); w.on('error', (e) => resolve(`error ${e.message}`));
    });
    assert.equal(wss, 'open');
    const ws = await new Promise((resolve) => {
      const w = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: jar } });
      w.on('open', () => { w.close(); resolve('open'); }); w.on('unexpected-response', (_q, res) => resolve(res.statusCode)); w.on('error', () => resolve('refused'));
    });
    assert.equal(ws, 'refused', 'no plain WebSocket on the TLS port');
  } finally { await s.stop(); }
});

test('the server refuses to start: Mode B on the network without TLS, Mode A on a network address, an expired certificate', { timeout: 120000 }, async () => {
  const k = pki();
  const cases = [
    [{ AGASTYA_MODE: 'server', AGASTYA_HOST: '0.0.0.0' }, /AGASTYA_TLS_CERT: Mode B listens on 0\.0\.0\.0/],
    [{ AGASTYA_HOST: '0.0.0.0' }, /AGASTYA_HOST: "0\.0\.0\.0" is not a loopback address/],
    [{ AGASTYA_MODE: 'server', AGASTYA_HOST: '127.0.0.1', AGASTYA_TLS_CERT: k.expiredCert, AGASTYA_TLS_KEY: k.expiredKey }, /AGASTYA_TLS_CERT: the certificate expired/],
    [{ AGASTYA_MODE: 'server', AGASTYA_HOST: '127.0.0.1', AGASTYA_TLS_CERT: k.cert, AGASTYA_TLS_KEY: k.otherKey }, /AGASTYA_TLS_KEY: .* is not the private key/],
  ];
  for (const [env, re] of cases) {
    const s = serve({ AGASTYA_WORKSPACE_DIR: tmp('agastya-wp26-no-'), PORT: String(await freePort()), ...env });
    s.ready.catch(() => undefined);
    const code = await s.exited;
    assert.notEqual(code, 0, JSON.stringify(env));
    assert.match(s.log(), re);
    assert.doesNotMatch(s.log(), /running on/, 'nothing listened');
  }
});

test('Mode A by default: loopback only (127.0.0.1 and ::1); the machine\'s network address is refused', { timeout: 120000 }, async () => {
  const port = await freePort();
  const s = serve({ AGASTYA_WORKSPACE_DIR: tmp('agastya-wp26-a-'), PORT: String(port) });
  try {
    await s.ready;
    assert.match(s.log(), /running on http:\/\/localhost:\d+ {2}\(listening on 127\.0\.0\.1/);
    assert.match(s.log(), /Mode A \(this computer only\); listens on loopback/);
    assert.equal((await raw(`http://127.0.0.1:${port}`)).status, 200);
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) {
      const r = await new Promise((resolve) => { const c = net.connect(port, lan.address); c.on('connect', () => { c.destroy(); resolve('connected'); }); c.on('error', (e) => resolve(e.code)); });
      assert.notEqual(r, 'connected', `nothing answers on ${lan.address}:${port}`);
    }
  } finally { await s.stop(); }
});
