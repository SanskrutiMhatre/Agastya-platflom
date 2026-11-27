// WP-28: the Mode B team-server path of the Windows host (packaging/host/TeamServer.cs), run for real in a temporary folder.
//   node --test scripts/release/teamserver.test.mjs
// AgastyaCtl.exe is compiled from packaging/host/*.cs (as scripts/package-windows.mjs does) into a temporary product tree whose app\backend is
// a junction to this checkout's backend (built dist/) and whose runtime\node.exe is this Node. Nothing machine-wide is touched: no Windows
// service, no firewall rule (--firewall is not used), no certificate store; the throwaway CA and server certificate live in the temporary
// folder, and the server listens on 127.0.0.1 only (Mode B on loopback, the same-computer case WP-26 allows).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const DIST = path.join(ROOT, 'backend', 'dist', 'index.js');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const skip = process.platform !== 'win32' ? 'Windows only' : !fs.existsSync(CSC) ? `no C# compiler at ${CSC}` : !fs.existsSync(DIST) ? 'backend/dist is not built' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-wp28-team-'));
const procs = [];
after(() => { for (const p of procs) { try { p.kill(); } catch { /* gone */ } } try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch { /* a log still open */ } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function productTree() {
  const t = path.join(tmp, 'product');
  fs.mkdirSync(path.join(t, 'runtime'), { recursive: true }); fs.mkdirSync(path.join(t, 'app'), { recursive: true });
  const srcs = fs.readdirSync(path.join(ROOT, 'packaging', 'host')).filter((f) => f.endsWith('.cs')).map((f) => path.join(ROOT, 'packaging', 'host', f));
  // the product version goes in as the packager puts it (AssemblyVersion); a build without it is version 0.0.0 - an "old client"
  const asm = path.join(tmp, 'AssemblyInfo.cs');
  fs.writeFileSync(asm, `using System.Reflection;\r\n[assembly: AssemblyVersion("${VERSION}.0")]\r\n`);
  for (const [out, extra] of [['AgastyaCtl.exe', [asm]], ['AgastyaCtl-old.exe', []]]) {
    const r = spawnSync(CSC, ['-nologo', '-platform:x64', '-target:exe', '-r:System.ServiceProcess.dll', '-r:System.IO.Compression.dll', '-r:System.Security.dll', `-out:${path.join(t, out)}`, ...srcs, ...extra], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /warning CS/);
  }
  try { fs.linkSync(process.execPath, path.join(t, 'runtime', 'node.exe')); } catch { fs.copyFileSync(process.execPath, path.join(t, 'runtime', 'node.exe')); }
  fs.symlinkSync(path.join(ROOT, 'backend'), path.join(t, 'app', 'backend'), 'junction');
  return t;
}
const ctl = (tree, args) => spawnSync(path.join(tree, 'AgastyaCtl.exe'), args, { encoding: 'utf8', timeout: 180000 });
const iniOf = (home) => fs.readFileSync(path.join(home, 'agastya.ini'), 'utf8');
const addIni = (home, text) => fs.appendFileSync(path.join(home, 'agastya.ini'), `\r\n${text}\r\n`);
const acl = (dir) => spawnSync('icacls.exe', [dir], { encoding: 'utf8' }).stdout;

function call(port, ca, method, url, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { host: `localhost:${port}`, origin: `https://localhost:${port}` };
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = data.length; }
    if (cookie) headers.cookie = cookie;
    const req = https.request({ host: '127.0.0.1', servername: 'localhost', port, method, path: url, ca, headers }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch { /* not json */ } resolve({ status: res.statusCode, json, cookie: (res.headers['set-cookie'] || [])[0]?.split(';')[0] }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
async function waitHttps(port, ca, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if ((await call(port, ca, 'GET', '/api/ready')).status === 200) return true; } catch { /* not yet */ } await sleep(400); }
  return false;
}
function consoleRun(tree, home) {
  const p = spawn(path.join(tree, 'AgastyaCtl.exe'), ['--home', home, '--console'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  procs.push(p);
  return { p, out: () => out, done: new Promise((r) => p.on('exit', (c) => r(c))) };
}

describe('the team server configured and started by AgastyaCtl', { skip }, () => {
  let tree; let home; let port; let ca; let thumb;

  test('--configure-server refuses what cannot work and changes nothing then', () => {
    tree = productTree(); home = path.join(tmp, 'server-home'); fs.mkdirSync(home);
    let r = ctl(tree, ['--home', home, '--configure-server', '--name', 'docs.example.local']);
    assert.equal(r.status, 2, r.stdout + r.stderr); assert.match(r.stderr, /needs a certificate/);
    r = ctl(tree, ['--home', home, '--configure-server', '--make-cert']);
    assert.equal(r.status, 2); assert.match(r.stderr, /needs at least one --name/);
    r = ctl(tree, ['--home', home, '--configure-server', '--name', 'bad name!', '--make-cert']);
    assert.equal(r.status, 2); assert.match(r.stderr, /not a host name/);
    r = ctl(tree, ['--home', home, '--configure-server', '--name', 'x', '--cert', 'a.pem']);
    assert.equal(r.status, 2); assert.match(r.stderr, /go together/);
    assert.equal(fs.existsSync(path.join(home, 'agastya.ini')), false, 'nothing was written');
  });

  test('--make-cert: a private CA and a server certificate in tls\\, agastya.ini written, tls\\ limited, the CA key out of the service\'s reach', async () => {
    port = await freePort();
    const r = ctl(tree, ['--home', home, '--configure-server', '--name', 'localhost', '--bind', '127.0.0.1', '--port', String(port), '--make-cert', '--days', '30']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Team server configured/); assert.match(r.stdout, /Move .*ca-key\.pem to offline storage/);
    const ini = iniOf(home);
    for (const line of ['Bind=127.0.0.1', 'Mode=server', `Port=${port}`, 'ServerNames=localhost', 'Certificate=tls\\server.pem', 'Key=tls\\server-key.pem']) assert.ok(ini.includes(line), `${line} in\n${ini}`);
    const tls = path.join(home, 'tls');
    for (const f of ['server.pem', 'server-key.pem', 'ca.pem', path.join('ca', 'ca-key.pem')]) assert.ok(fs.existsSync(path.join(tls, f)), f);
    assert.equal(fs.readdirSync(tls).filter((f) => f.startsWith('.new-')).length, 0, 'no staging folder left');
    const a = acl(tls); const b = acl(path.join(tls, 'ca'));
    assert.match(a, /LOCAL SERVICE/); assert.doesNotMatch(a, /BUILTIN\\Users|Authenticated Users|Everyone/);
    assert.doesNotMatch(b, /LOCAL SERVICE/, 'the service cannot read the CA key');
    ca = fs.readFileSync(path.join(tls, 'ca.pem'));
    thumb = crypto.createHash('sha256').update(new crypto.X509Certificate(fs.readFileSync(path.join(tls, 'server.pem'))).raw).digest('hex').toUpperCase();
  });

  test('--console serves HTTPS with that certificate; [backup], [server] and the TLS settings reach the server; a client checks the handshake', async () => {
    addIni(home, '[backup]\r\nIntervalHours=6\r\nCopyTo=standby\r\n\r\n[server]\r\nMaxConnections=321\r\nLeaseMinutes=45');
    // the [server] section appears twice now; the host reads every line, so the later keys still apply
    const run = consoleRun(tree, home);
    assert.ok(await waitHttps(port, ca), `the server answered over HTTPS\n${run.out()}`);
    const v = await call(port, ca, 'GET', '/api/version');
    assert.equal(v.status, 200); assert.equal(v.json.product, 'Agastya Platform');
    const setup = await call(port, ca, 'POST', '/api/auth/setup', { username: 'admin', password: 'Correct-Horse-9!', fullName: 'Admin' });
    assert.equal(setup.status, 200, JSON.stringify(setup.json));
    const m = await call(port, ca, 'GET', '/api/admin/metrics', undefined, setup.cookie);
    assert.equal(m.status, 200);
    assert.equal(m.json.server.mode, 'server'); assert.equal(m.json.server.tls, true);
    assert.equal(m.json.server.wsMaxClients, 321); assert.equal(m.json.server.leaseMinutes, 45);
    assert.deepEqual(m.json.server.backup, { intervalHours: 6, copyTo: true });

    // a client installation: [client] Server= and the pinned thumbprint; the Windows store does not trust the throwaway CA
    const client = path.join(tmp, 'client-home'); fs.mkdirSync(client);
    fs.writeFileSync(path.join(client, 'agastya.ini'), `[client]\r\nServer=https://localhost:${port}/\r\n`);
    let c = ctl(tree, ['--home', client, '--check-server']);
    assert.equal(c.status, 1, c.stdout); assert.match(c.stdout, /certificate is not trusted/);
    fs.appendFileSync(path.join(client, 'agastya.ini'), `Thumbprint=${thumb.match(/../g).join(':')}\r\n`);
    c = ctl(tree, ['--home', client, '--check-server']);
    assert.equal(c.status, 0, c.stdout); assert.match(c.stdout, /\[ OK \] the server certificate is the pinned one/); assert.match(c.stdout, /\[ OK \] .* answers: Agastya Platform/);
    assert.match(c.stdout, /is accepted/);
    // upgrade order (server first, then clients): a client older than the server's minimum is told so
    const old = spawnSync(path.join(tree, 'AgastyaCtl-old.exe'), ['--home', client, '--check-server'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(old.status, 1, old.stdout); assert.match(old.stdout, /older than the server accepts/);
    fs.writeFileSync(path.join(client, 'agastya.ini'), `[client]\r\nServer=https://localhost:${port}/\r\nThumbprint=${'00'.repeat(32)}\r\n`);
    c = ctl(tree, ['--home', client, '--check-server']);
    assert.equal(c.status, 1, 'a different pinned certificate is refused');
    assert.equal(ctl(tree, ['--home', client, '--console']).status, 1, 'a client runs no server');
    assert.equal(ctl(tree, ['--home', client, '--check-server', 'http://docs.example.local/']).status, 1, 'plain HTTP to a network name is refused');
    run.p.kill(); await run.done;
    // the host's job object takes the server with it
    for (let i = 0; i < 40 && (await call(port, ca, 'GET', '/api/health').then(() => true, () => false)); i++) await sleep(250);
    assert.equal(await call(port, ca, 'GET', '/api/health').then(() => true, () => false), false, 'the server stopped with the host');
  });

  test('a wrong team-server setting stops the server with the setting named in the server log', async () => {
    const bad = path.join(tmp, 'bad-home'); fs.mkdirSync(bad);
    const p2 = await freePort();
    fs.writeFileSync(path.join(bad, 'agastya.ini'), `[server]\r\nPort=${p2}\r\nBind=127.0.0.1\r\n\r\n[backup]\r\nIntervalHours=often\r\n`);
    const run = consoleRun(tree, bad);
    await Promise.race([run.done, sleep(15000)]);
    run.p.kill(); await run.done;
    const log = fs.readFileSync(path.join(bad, 'logs', 'agastya-server.log'), 'utf8');
    assert.match(log, /AGASTYA_BACKUP_INTERVAL_HOURS/);
  });
});
