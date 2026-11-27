// WP-24: the Windows host's integrity check (--verify, --doctor [--deep]), the doctor's sensitivity to seeded faults (G-DEP-4) and the support
// bundle's redaction (RES-006 canary test).
//   node --test scripts/release/host.test.mjs
// AgastyaCtl.exe is compiled from packaging/host/*.cs into a temporary product tree with the .NET Framework compiler that ships with Windows
// (as scripts/package-windows.mjs does). The signed case uses a throwaway self-signed certificate made in the temporary folder; no certificate
// store is touched. A folder made read-only for the fault test gets its deny entry removed again before it is deleted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeManifest, MANIFEST_NAME } from './lib.mjs';
import { signingConfig, signFiles, signDetached } from './signing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const skip = process.platform !== 'win32' ? 'Windows only' : !fs.existsSync(CSC) ? `no C# compiler at ${CSC}` : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-wp24-host-'));
const cleanups = [];
after(() => { for (const c of cleanups.reverse()) try { c(); } catch { /* best effort */ } fs.rmSync(tmp, { recursive: true, force: true }); });
const put = (dir, rel, content) => { const p = path.join(dir, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

let ctlBuilt;
function compileCtl() {
  if (ctlBuilt) return ctlBuilt;
  const out = path.join(tmp, 'build', 'AgastyaCtl.exe');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const srcs = fs.readdirSync(path.join(ROOT, 'packaging', 'host')).filter((f) => f.endsWith('.cs')).map((f) => path.join(ROOT, 'packaging', 'host', f));
  const r = spawnSync(CSC, ['-nologo', '-platform:x64', '-target:exe', '-r:System.ServiceProcess.dll', '-r:System.IO.Compression.dll', '-r:System.Security.dll', `-out:${out}`, ...srcs], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /warning CS/, 'the host compiles without warnings (the packager refuses warnings)');
  return (ctlBuilt = out);
}
const ctl = (tree, args, opts = {}) => spawnSync(path.join(tree, 'AgastyaCtl.exe'), args, { encoding: 'utf8', timeout: 120000, ...opts });

/** A small product tree: the host, a stand-in runtime and server code, and its manifest. */
function integrityTree(name) {
  const t = path.join(tmp, name);
  fs.mkdirSync(t, { recursive: true });
  fs.copyFileSync(compileCtl(), path.join(t, 'AgastyaCtl.exe'));
  put(t, 'runtime/node.exe', crypto.randomBytes(4096));
  put(t, 'app/backend/dist/index.js', 'console.log("server")\n');
  put(t, 'app/backend/schemas/5.0/descript.xsd', '<xs:schema/>');
  put(t, 'version.json', '{"version":"9.9.9"}\n');
  return t;
}

describe('AgastyaCtl --verify and the doctor file check', { skip }, () => {
  test('an intact unsigned tree verifies; every kind of change is named and makes it fail', () => {
    const t = integrityTree('i1');
    writeManifest(t, { product: 'Agastya Platform', version: '9.9.9', commit: 'test' });
    let r = ctl(t, ['--verify']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[ OK \] 5 program files match MANIFEST\.sha256 \(every file hashed/);
    assert.match(r.stdout, /\[WARN\] MANIFEST\.sha256 is not signed/);
    assert.equal(ctl(t, ['--verify', '--require-signed']).status, 1, 'unsigned fails when a signature is required');
    // logs, config and data written by the installation do not count
    put(t, 'logs/agastya-host.log', 'x'); put(t, 'config/agastya.ini', 'Port=1');
    // a changed schema (same size): found by --verify (every file hashed), not by the quick check, which hashes only executables and server code
    put(t, 'app/backend/schemas/5.0/descript.xsd', '<xs:schemA/>');
    r = ctl(t, ['--verify']);
    assert.equal(r.status, 1); assert.match(r.stdout, /changed: app\/backend\/schemas\/5\.0\/descript\.xsd/);
    put(t, 'app/backend/schemas/5.0/descript.xsd', '<xs:schema/>');
    // a planted DLL beside the program and a changed server file: the quick check of --doctor sees both
    put(t, 'version.dll', 'planted'); put(t, 'app/backend/dist/index.js', 'console.log("evil!")\n');
    r = ctl(t, ['--doctor', '--home', path.join(tmp, 'i1-home')]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[FAIL\] program files differ from MANIFEST\.sha256 - changed: app\/backend\/dist\/index\.js; not part of the product: version\.dll/);
    fs.rmSync(path.join(t, 'runtime', 'node.exe'));
    assert.match(ctl(t, ['--verify']).stdout, /missing: runtime\/node\.exe/);
  });

  test('a signed tree: the manifest signature must hold and its signer must be the signer of AgastyaCtl.exe', () => {
    const certDir = path.join(tmp, 'cert'); const pw = crypto.randomBytes(18).toString('base64url');
    const g = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'signing', 'New-SigningCertificate.ps1'),
      '-OutDir', certDir, '-Subject', 'CN=Agastya WP-24 Host Test Only, C=IN', '-Mode', 'SelfSigned', '-Years', '1'], { encoding: 'utf8', env: { ...process.env, AGASTYA_PFX_PASSWORD: pw } });
    assert.equal(g.status, 0, g.stdout + g.stderr);
    const cfg = signingConfig({ ...process.env, AGASTYA_SIGN_PFX: path.join(certDir, 'agastya-codesign.pfx'), AGASTYA_SIGN_PASSWORD: pw, AGASTYA_SIGN_THUMBPRINT: '', AGASTYA_SIGN_CMD: '', AGASTYA_SIGN_TIMESTAMP_URL: '' });
    const t = integrityTree('i2');
    signFiles(cfg, [path.join(t, 'AgastyaCtl.exe')]);
    const mf = writeManifest(t, { product: 'Agastya Platform', version: '9.9.9', commit: 'test' }).file;
    signDetached(cfg, [mf]);
    let r = ctl(t, ['--verify', '--require-signed']);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /\[ OK \] MANIFEST\.sha256 signed by CN=Agastya WP-24 Host Test Only, C=IN \([0-9A-F]{40}\), the signer of this program; Authenticode: signed and intact; its root certificate is not trusted/);
    // the manifest re-written to hide a change: the signature no longer holds
    const orig = fs.readFileSync(mf, 'utf8');
    fs.writeFileSync(mf, orig.replace('# commit: test', '# commit: tset'));
    r = ctl(t, ['--verify']);
    assert.equal(r.status, 1); assert.match(r.stdout, /\[FAIL\] MANIFEST\.sha256\.sig does not hold: MANIFEST\.sha256 was changed after it was signed/);
    fs.writeFileSync(mf, orig);
    // a manifest signed by somebody else's certificate is refused, even though that signature is itself valid
    const other = path.join(tmp, 'cert2'); const pw2 = crypto.randomBytes(18).toString('base64url');
    assert.equal(spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'signing', 'New-SigningCertificate.ps1'),
      '-OutDir', other, '-Subject', 'CN=Someone Else Test Only', '-Mode', 'SelfSigned', '-Years', '1'], { encoding: 'utf8', env: { ...process.env, AGASTYA_PFX_PASSWORD: pw2 } }).status, 0);
    signDetached(signingConfig({ ...process.env, AGASTYA_SIGN_PFX: path.join(other, 'agastya-codesign.pfx'), AGASTYA_SIGN_PASSWORD: pw2, AGASTYA_SIGN_THUMBPRINT: '', AGASTYA_SIGN_CMD: '' }), [mf]);
    r = ctl(t, ['--verify']);
    assert.equal(r.status, 1); assert.match(r.stdout, /\[FAIL\] MANIFEST\.sha256 is signed by CN=Someone Else Test Only/);
    // the executable itself changed after signing: WinVerifyTrust says so
    signDetached(cfg, [mf]);
    const exe = path.join(t, 'AgastyaCtl.exe');
    const copy = path.join(t, 'copy-of-ctl.exe'); fs.copyFileSync(exe, copy);
    const b = fs.readFileSync(copy); b[0x200] ^= 0x01; fs.writeFileSync(copy, b);
    const ac = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${copy}').Status`], { encoding: 'utf8' });
    assert.equal(ac.stdout.trim(), 'HashMismatch');
  });
});

describe('AgastyaCtl --doctor detects seeded faults (G-DEP-4)', { skip }, () => {
  let tree; let home; let port;
  before(async () => {
    tree = path.join(tmp, 'doc'); home = path.join(tmp, 'doc-home');
    fs.mkdirSync(tree, { recursive: true });
    fs.copyFileSync(compileCtl(), path.join(tree, 'AgastyaCtl.exe'));
    fs.mkdirSync(path.join(tree, 'runtime'));
    try { fs.linkSync(process.execPath, path.join(tree, 'runtime', 'node.exe')); } catch { fs.copyFileSync(process.execPath, path.join(tree, 'runtime', 'node.exe')); }
    put(tree, 'app/backend/dist/index.js', '');
    put(tree, 'app/frontend/dist/index.html', '<!doctype html>');
    put(tree, 'app/backend/vendor/tools/fop.xconf', '<fop/>');
    put(tree, 'app/backend/node_modules/express/package.json', '{}');
    fs.mkdirSync(path.join(tree, 'app', 'backend', 'schemas'), { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'backend', 'vendor', 'tools', 'jre'), path.join(tree, 'app', 'backend', 'vendor', 'tools', 'jre'), 'junction');
    port = await freePort();
    put(home, 'agastya.ini', `[server]\nPort=${port}\nBind=loopback\n`);
  });
  const doctor = (extra = []) => ctl(tree, ['--doctor', '--home', home, ...extra]);
  const ini = (text) => put(home, 'agastya.ini', text);

  test('a healthy tree passes', () => {
    const r = doctor();
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /\[ OK \] Node\.js runtime v/); assert.match(r.stdout, /\[ OK \] Java runtime/); assert.match(r.stdout, new RegExp(`port ${port} is free`));
    assert.match(r.stdout, /\[WARN\] MANIFEST\.sha256 is missing/, 'a tree without a manifest is reported, not failed');
  });
  test('missing runtime, missing JRE, port in use, bad ini value, read-only data folder: each is a FAIL with exit 1', async () => {
    const node = path.join(tree, 'runtime', 'node.exe'); const aside = node + '.aside';
    fs.renameSync(node, aside);
    let r = doctor(); assert.equal(r.status, 1); assert.match(r.stdout, /\[FAIL\] missing: .*runtime\\node\.exe/); assert.match(r.stdout, /\[FAIL\] the bundled Node\.js does not run/);
    fs.renameSync(aside, node);

    const jre = path.join(tree, 'app', 'backend', 'vendor', 'tools', 'jre');
    fs.renameSync(jre, jre + '-aside');
    r = doctor(); assert.equal(r.status, 1); assert.match(r.stdout, /\[FAIL\] the bundled Java runtime does not run/);
    fs.renameSync(jre + '-aside', jre);

    const srv = net.createServer(); await new Promise((res) => srv.listen(port, '127.0.0.1', res));
    try { r = doctor(); assert.equal(r.status, 1); assert.match(r.stdout, new RegExp(`\\[FAIL\\] port ${port} is in use`)); } finally { await new Promise((res) => srv.close(res)); }

    ini(`[server]\nPort=99999\n`);
    r = doctor(); assert.equal(r.status, 1); assert.match(r.stdout, /\[FAIL\] agastya\.ini line 2: Port must be 1-65535 \(the default is used instead\)/);
    ini(`[server]\nPort=${port}\nNoSuchKey=1\n`);
    r = doctor(); assert.equal(r.status, 0, 'an unknown key stays a warning'); assert.match(r.stdout, /\[WARN\] agastya\.ini line 3: unknown setting 'server.nosuchkey'/);

    const data = path.join(tmp, 'readonly-data'); fs.mkdirSync(data);
    const who = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    const deny = spawnSync('icacls', [data, '/deny', `${who}:(OI)(CI)(W)`], { encoding: 'utf8' });
    assert.equal(deny.status, 0, deny.stdout + deny.stderr);
    cleanups.push(() => spawnSync('icacls', [data, '/remove:d', who]));
    ini(`[server]\nPort=${port}\n[storage]\nDataDir=${data}\n`);
    r = doctor(); assert.equal(r.status, 1); assert.match(r.stdout, /\[FAIL\] the data folder .* is not writable/);
    spawnSync('icacls', [data, '/remove:d', who]);
    ini(`[server]\nPort=${port}\nBind=loopback\n`);
  });
});

describe('AgastyaCtl --support-bundle', { skip }, () => {
  test('contains the named reports and logs, and none of the seeded secrets, the database or project names', () => {
    const tree = integrityTree('sb'); writeManifest(tree, { version: '9.9.9', commit: 'test' });
    const home = path.join(tmp, 'sb-home');
    const C = { pw: 'Canary-Pw-7731!', tok: 'tokCANARY99abcdef', sid: 'CANARYSID123456', hash: '$argon2id$v=19$m=65536,t=3,p=4$CANARYSALT$CANARYHASHVALUE', proj: 'CanaryProjectX', dbtext: 'CANARY-DB-CONTENT' };
    put(home, 'agastya.ini', `[server]\nPort=1\n[security]\nSecureCookies=0\nAdminPassword=${C.pw}\nTlsKeyPassword = ${C.pw}\n`);
    put(home, 'logs/agastya-server.log', [
      '2026-11-27 10:00:00.000 INFO server listening',
      `2026-11-27 10:00:01.000 WARN login failed {"username":"bob","password":"${C.pw}"}`,
      `2026-11-27 10:00:02.000 INFO Authorization: Bearer ${C.tok}`,
      `2026-11-27 10:00:03.000 INFO set-cookie: agastya_session=${C.sid}; Path=/; HttpOnly`,
      `2026-11-27 10:00:04.000 INFO reset token=${C.tok} for user 7`,
      `2026-11-27 10:00:05.000 INFO stored ${C.hash}`,
      `2026-11-27 10:00:06.000 INFO cookie agastya_session=${C.sid}`,
    ].join('\r\n') + '\r\n');
    put(home, 'logs/agastya-host.log', `2026-11-27 INFO started\r\n2026-11-27 INFO env AGASTYA_SIGN_PASSWORD=${C.pw}\r\n`);
    put(home, 'workspace/publisher.db', C.dbtext);
    put(home, `workspace/projects/${C.proj}/project.json`, `{"name":"${C.proj}"}`);
    const zip = path.join(tmp, 'bundle.zip');
    const r = ctl(tree, ['--support-bundle', zip, '--home', home]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = path.join(tmp, 'bundle-x'); fs.mkdirSync(out);
    const x = spawnSync(path.join(process.env.WINDIR, 'System32', 'tar.exe'), ['-xf', zip, '-C', out], { encoding: 'utf8' });
    assert.equal(x.status, 0, x.stderr);
    const files = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } }; walk(out);
    const names = files.map((f) => path.relative(out, f).split(path.sep).join('/')).sort();
    for (const n of ['README.txt', 'version.txt', 'doctor.txt', 'integrity.txt', 'agastya.ini', 'logs/agastya-server.log', 'logs/agastya-host.log', 'system.txt', 'data-folder.txt']) assert.ok(names.includes(n), `${n} in ${names}`);
    assert.ok(!names.some((n) => /publisher\.db|project\.json/.test(n)), 'no database or project file');
    const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const [k, v] of Object.entries(C)) assert.ok(!all.includes(v), `canary ${k} leaked`);
    assert.ok(!all.includes('CANARYHASH') && !all.includes('CANARYSID'), 'no fragment of a secret');
    const iniOut = fs.readFileSync(path.join(out, 'agastya.ini'), 'utf8');
    assert.match(iniOut, /Port=1/); assert.match(iniOut, /AdminPassword=\*\*\*/); assert.match(iniOut, /TlsKeyPassword=\*\*\*/);
    const log = fs.readFileSync(path.join(out, 'logs', 'agastya-server.log'), 'utf8');
    assert.match(log, /server listening/); assert.match(log, /"password":\*\*\*/); assert.match(log, /Authorization: \*\*\*/); assert.match(log, /agastya_session=\*\*\*/);
    assert.match(fs.readFileSync(path.join(out, 'data-folder.txt'), 'utf8'), /project folders: 1 \(names not included\)/);
    assert.match(fs.readFileSync(path.join(out, 'integrity.txt'), 'utf8'), /program files match MANIFEST\.sha256/);
  });
});
