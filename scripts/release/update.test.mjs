// WP-25: the offline update engine of the Windows host (packaging/host/Update.cs) against real packages (scripts/release/update-package.mjs).
//   node --test scripts/release/update.test.mjs          (needs backend/dist: cd backend && npx tsc -p .)
// Everything happens in a temporary folder: AgastyaCtl.exe is compiled there, each "version" is a small product tree whose runtime is this
// Node.js and whose server is a stand-in that answers /api/version and /api/ready (one variant breaks the database and never becomes ready),
// while the pre-update backup and the first administrator use the REAL backend scripts on a REAL database. The signing certificates are
// throwaway self-signed .pfx files made in the temporary folder; no certificate store, service, registry key or port of the machine is used
// (ports are free ones on 127.0.0.1).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeManifest, sha256File } from './lib.mjs';
import { signingConfig, signFiles, signDetached } from './signing.mjs';
import { buildUpdatePackage } from './update-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const DIST = path.join(ROOT, 'backend', 'dist', 'services', 'platformBackup.js');
const skip = process.platform !== 'win32' ? 'Windows only' : !fs.existsSync(CSC) ? `no C# compiler at ${CSC}` : !fs.existsSync(DIST) ? 'build the backend first (backend/dist)' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-wp25-update-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const put = (p, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const APP_ID = 'A4F8C61E-1D9A-4BF9-B9B8-092ECA4E3CBC';

function makeCert(name, subject) {
  const dir = path.join(tmp, name); const pw = crypto.randomBytes(18).toString('base64url');
  const g = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'signing', 'New-SigningCertificate.ps1'),
    '-OutDir', dir, '-Subject', subject, '-Mode', 'SelfSigned', '-Years', '1'], { encoding: 'utf8', env: { ...process.env, AGASTYA_PFX_PASSWORD: pw } });
  assert.equal(g.status, 0, g.stdout + g.stderr);
  return signingConfig({ ...process.env, AGASTYA_SIGN_PFX: path.join(dir, 'agastya-codesign.pfx'), AGASTYA_SIGN_PASSWORD: pw, AGASTYA_SIGN_THUMBPRINT: '', AGASTYA_SIGN_CMD: '', AGASTYA_SIGN_TIMESTAMP_URL: '' });
}

/** The stand-in server. mode: ok | break-db (changes the database, /api/ready 503 for ever). */
const serverJs = (mode) => `'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'version.json'), 'utf8')).version;
const ws = process.env.AGASTYA_WORKSPACE_DIR;
if (${JSON.stringify(mode)} === 'break-db') {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(ws, 'publisher.db')); db.exec('CREATE TABLE IF NOT EXISTS broken_update_was_here (x)'); db.close();
}
const lock = path.join(ws, '.agastya-server.lock');
fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() }));
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const srv = http.createServer((req, res) => {
  if (req.url === '/api/health') return send(res, 200, { status: 'ok', version });
  if (req.url === '/api/version') return send(res, 200, { product: 'Agastya Platform', version, schema: { compatible: true }, shell: { webview2: process.env.AGASTYA_WEBVIEW2_VERSION || null } });
  if (req.url === '/api/ready') return ${JSON.stringify(mode)} === 'break-db' ? send(res, 503, { status: 'not-ready' }) : send(res, 200, { status: 'ready' });
  send(res, 404, {});
});
srv.listen(Number(process.env.PORT), process.env.AGASTYA_HOST || '127.0.0.1');
const bye = () => { try { fs.rmSync(lock, { force: true }); } catch {} process.exit(0); };
process.stdin.on('end', bye); process.stdin.on('close', bye); process.stdin.resume();
`;

let signedCtl; let signedPlatform; let release; let stranger;
before(() => {
  if (skip) return;
  const build = path.join(tmp, 'build'); fs.mkdirSync(build);
  const srcs = fs.readdirSync(path.join(ROOT, 'packaging', 'host')).filter((f) => f.endsWith('.cs')).map((f) => path.join(ROOT, 'packaging', 'host', f));
  const common = ['-nologo', '-platform:x64', '-r:System.ServiceProcess.dll', '-r:System.IO.Compression.dll', '-r:System.Security.dll'];
  for (const [out, extra] of [['AgastyaCtl.exe', ['-target:exe']], ['AgastyaPlatform.exe', ['-target:winexe', '-define:GUI', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll']]]) {
    const r = spawnSync(CSC, [...common, ...extra, `-out:${path.join(build, out)}`, ...srcs], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /warning CS/, 'the host compiles without warnings (the packager refuses warnings)');
  }
  release = makeCert('cert-release', 'CN=Agastya WP-25 Update Test Only, C=IN');
  stranger = makeCert('cert-stranger', 'CN=Someone Else WP-25 Test Only');
  signFiles(release, [path.join(build, 'AgastyaCtl.exe'), path.join(build, 'AgastyaPlatform.exe')]);
  signedCtl = path.join(build, 'AgastyaCtl.exe'); signedPlatform = path.join(build, 'AgastyaPlatform.exe');
});

/** A product tree of `version` (signed with `cert` unless null). `tamper` changes one file after the manifest was written. */
function productTree(name, version, { mode = 'ok', cert = release, tamper = false } = {}) {
  const t = path.join(tmp, 'trees', name);
  fs.mkdirSync(t, { recursive: true });
  fs.copyFileSync(signedCtl, path.join(t, 'AgastyaCtl.exe'));
  fs.copyFileSync(signedPlatform, path.join(t, 'AgastyaPlatform.exe'));
  fs.mkdirSync(path.join(t, 'runtime'));
  fs.copyFileSync(process.execPath, path.join(t, 'runtime', 'node.exe'));
  put(path.join(t, 'app', 'backend', 'dist', 'index.js'), serverJs(mode));
  // the real tools, loaded from the repository's backend (they find backend/dist beside themselves)
  for (const s of ['agastya-backup.js', 'first-admin.js']) put(path.join(t, 'app', 'backend', 'scripts', s), `require(${JSON.stringify(path.join(ROOT, 'backend', 'scripts', s))});\n`);
  put(path.join(t, 'app', 'frontend', 'dist', 'index.html'), `<!doctype html><title>${version}</title>`);
  put(path.join(t, 'version.json'), JSON.stringify({ product: 'Agastya Platform', version, appId: APP_ID }) + '\n');
  const mf = writeManifest(t, { product: 'Agastya Platform', version, commit: 'test' }).file;
  if (cert) signDetached(cert, [mf]);
  if (tamper) put(path.join(t, 'app', 'frontend', 'dist', 'index.html'), `<!doctype html><title>${version.replace(/./g, 'X')}</title>`);   // same size
  return t;
}

function pkg(name, version, o = {}) {
  const tree = productTree(name, version, o);
  return buildUpdatePackage({ stage: tree, out: path.join(tmp, 'packages', `${name}.agupdate`), minFromVersion: o.minFrom || '1.0.0', signing: o.unsigned ? null : (o.signWith || release), appId: APP_ID }).out;
}

/** An installation as Setup lays it out: versions\<v>\, the launcher, current, state.dir; agastya.ini and a real database in the state folder. */
async function install(name, version, { flat = false, keep = 2 } = {}) {
  const inst = path.join(tmp, name, 'program'); const state = path.join(tmp, name, 'state'); const ws = path.join(state, 'workspace');
  const tree = productTree(`${name}-${version}`, version);
  fs.mkdirSync(inst, { recursive: true });
  if (flat) { fs.cpSync(tree, inst, { recursive: true }); }
  else {
    fs.cpSync(tree, path.join(inst, 'versions', version), { recursive: true });
    for (const f of ['AgastyaCtl.exe', 'AgastyaPlatform.exe']) fs.copyFileSync(path.join(tree, f), path.join(inst, f));
    fs.writeFileSync(path.join(inst, 'current'), `${version}\r\n`);
  }
  fs.writeFileSync(path.join(inst, 'state.dir'), state + '\r\n');
  const port = await freePort();
  put(path.join(state, 'agastya.ini'), `[server]\r\nPort=${port}\r\nBind=loopback\r\n[storage]\r\nDataDir=${ws}\r\n[app]\r\nOpenBrowser=0\r\n[update]\r\nHealthSeconds=15\r\nKeepVersions=${keep}\r\n`);
  const pwFile = put(path.join(tmp, name, 'admin-password.txt'), 'Temp-Pass-For-WP25-9!\r\n');
  const ctl = (args) => spawnSync(path.join(inst, 'AgastyaCtl.exe'), args, { encoding: 'utf8', timeout: 300000 });
  const fa = ctl(['--first-admin', 'siteadmin', '--password-file', pwFile]);
  assert.equal(fa.status, 0, fa.stdout + fa.stderr);
  return { inst, state, ws, port, ctl, db: path.join(ws, 'publisher.db') };
}

const pointer = (inst, n) => (fs.existsSync(path.join(inst, n)) ? fs.readFileSync(path.join(inst, n), 'utf8').trim() : null);
const versionsIn = (inst) => fs.readdirSync(path.join(inst, 'versions')).sort();
function snapshot(dir) {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = sha256File(p); } };
  walk(dir); return out;
}
const portFree = (port) => new Promise((res) => { const s = net.createConnection({ port, host: '127.0.0.1' }); s.on('connect', () => { s.destroy(); res(false); }); s.on('error', () => res(true)); });

describe('offline update packages: verification refuses before anything changes', { skip }, () => {
  test('signer, integrity, version and range rules; the installation and the database stay byte-identical', async () => {
    const i = await install('refuse', '1.0.0');
    const before = { prog: snapshot(i.inst), db: sha256File(i.db) };
    const cases = [
      [pkg('r-unsigned', '1.1.0', { unsigned: true }), 10, /the package is not signed/],
      [pkg('r-stranger', '1.1.0', { signWith: stranger, cert: stranger }), 10, /signed by CN=Someone Else WP-25 Test Only .* not the signer of the installed program/],
      [pkg('r-tampered', '1.1.0', { tamper: true }), 10, /payload file app\/frontend\/dist\/index\.html does not match the manifest/],
      [pkg('r-older', '0.9.0'), 11, /older than the installed 1\.0\.0; an update never goes back/],
      [pkg('r-same', '1.0.0'), 11, /version 1\.0\.0 is already installed/],
      [pkg('r-range', '1.1.0', { minFrom: '1.0.5' }), 11, /updates 1\.0\.5 or later; the installed version is 1\.0\.0/],
    ];
    for (const [file, code, msg] of cases) {
      const v = i.ctl(['--verify-update', file]);
      assert.equal(v.status, code, `${path.basename(file)}: ${v.stdout}${v.stderr}`); assert.match(v.stdout, msg);
      const a = i.ctl(['--apply-update', file]);
      assert.equal(a.status, code, `${path.basename(file)} apply: ${a.stdout}${a.stderr}`); assert.match(a.stdout, /REFUSED/);
    }
    // a package whose ZIP was damaged in transit
    const good = pkg('r-good', '1.1.0');
    const broken = path.join(tmp, 'packages', 'r-truncated.agupdate'); fs.writeFileSync(broken, fs.readFileSync(good).subarray(0, 4000));
    assert.equal(i.ctl(['--verify-update', broken]).status, 10);
    // --allow-unsigned is the only way an unsigned package passes the check (test machines)
    const u = i.ctl(['--verify-update', cases[0][0], '--allow-unsigned']);
    assert.equal(u.status, 0, u.stdout); assert.match(u.stdout, /UNSIGNED/);
    const g = i.ctl(['--verify-update', good]);
    assert.equal(g.status, 0, g.stdout); assert.match(g.stdout, /OK: version 1\.1\.0 \(from 1\.0\.0\), \d+ files, .*signed by CN=Agastya WP-25 Update Test Only/);
    const now = snapshot(i.inst);
    for (const k of Object.keys(now)) if (/^update-history\.txt$/.test(k)) delete now[k];   // the refusals are recorded, nothing else
    assert.deepEqual(now, before.prog, 'no program file, pointer or launcher changed');
    assert.equal(sha256File(i.db), before.db, 'the database is untouched');
  });
});

describe('offline update: apply, automatic rollback, versions kept, manual rollback', { skip }, () => {
  let i;
  before(async () => { i = await install('apply', '1.0.0'); });

  test('a good update: verified pre-update backup, switch, health check; the previous version is kept', async () => {
    const dbBefore = sha256File(i.db);
    const r = i.ctl(['--apply-update', pkg('a-110', '1.1.0')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /pre-update backup written and verified: .*agastya-backup-\d{8}-\d{6}Z-pre-update\.zip/);
    assert.match(r.stdout, /version 1\.1\.0 answers \/api\/version and \/api\/ready/);
    assert.equal(pointer(i.inst, 'current'), '1.1.0'); assert.equal(pointer(i.inst, 'previous'), '1.0.0');
    assert.deepEqual(versionsIn(i.inst), ['1.0.0', '1.1.0']);
    assert.equal(sha256File(path.join(i.inst, 'AgastyaCtl.exe')), sha256File(path.join(i.inst, 'versions', '1.1.0', 'AgastyaCtl.exe')), 'the launcher is the new version\'s');
    assert.equal(sha256File(i.db), dbBefore, 'the stand-in server does not touch the database');
    // the backup is a real platform backup that restores completely (the real tool, run again here)
    const archive = /pre-update backup written and verified: (.+\.zip)/.exec(r.stdout)[1].trim();
    const v = spawnSync(process.execPath, [path.join(ROOT, 'backend', 'scripts', 'agastya-backup.js'), 'verify', archive], { encoding: 'utf8' });
    assert.equal(v.status, 0, v.stdout + v.stderr); assert.match(v.stdout, /restores completely/);
    assert.ok(fs.readdirSync(path.join(i.state, 'logs')).some((f) => /^update-\d{8}-\d{6}\.log$/.test(f)), 'an update log is written');
    assert.ok(await portFree(i.port), 'nothing was running before, nothing runs after');
    assert.match(i.ctl(['--versions']).stdout, /\* 1\.1\.0 {2}\(current\)[\s\S]*1\.0\.0 {2}\(previous/);
    const d = i.ctl(['--doctor']);
    assert.match(d.stdout, /\[ OK \] version 1\.1\.0 is current; earlier versions kept for a rollback: 1\.0\.0 \(previous\)/);
  });

  test('an update that breaks the database and never becomes ready is rolled back automatically, the database restored', async () => {
    const dbBefore = sha256File(i.db);
    const r = i.ctl(['--apply-update', pkg('a-120-broken', '1.2.0', { mode: 'break-db' })]);
    assert.equal(r.status, 20, r.stdout + r.stderr);
    assert.match(r.stdout, /health check failed after 15 s: \/api\/ready answered 503/);
    assert.match(r.stdout, /database restored from/);
    assert.match(r.stdout, /ROLLED BACK: version 1\.1\.0 runs again/);
    assert.equal(pointer(i.inst, 'current'), '1.1.0'); assert.equal(pointer(i.inst, 'previous'), '1.0.0');
    assert.deepEqual(versionsIn(i.inst), ['1.0.0', '1.1.0'], 'the failed version folder is removed');
    assert.equal(sha256File(i.db), dbBefore, 'the database is byte-identical to before the update');
    const aside = fs.readdirSync(path.join(i.ws, 'backups')).filter((n) => n.startsWith('failed-update-1.2.0-'));
    assert.equal(aside.length, 1, 'the database the failed version left is kept aside, not deleted');
    assert.ok(await portFree(i.port));
    assert.match(fs.readFileSync(path.join(i.inst, 'update-history.txt'), 'utf8'), /\|1\.1\.0\|1\.2\.0\|rolled-back\|/);
  });

  test('KeepVersions limits the earlier versions kept; --rollback goes back one version and forward again', () => {
    fs.appendFileSync(path.join(i.state, 'agastya.ini'), '');
    const ini = path.join(i.state, 'agastya.ini');
    fs.writeFileSync(ini, fs.readFileSync(ini, 'utf8').replace('KeepVersions=2', 'KeepVersions=1'));
    let r = i.ctl(['--apply-update', pkg('a-121', '1.2.1')]);
    assert.equal(r.status, 0, r.stdout);
    r = i.ctl(['--apply-update', pkg('a-130', '1.3.0')]);
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual(versionsIn(i.inst), ['1.2.1', '1.3.0'], 'older versions beyond KeepVersions=1 were removed');
    r = i.ctl(['--rollback']);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /ROLLED BACK to 1\.2\.1/);
    assert.equal(pointer(i.inst, 'current'), '1.2.1'); assert.equal(pointer(i.inst, 'previous'), '1.3.0');
    assert.equal(sha256File(path.join(i.inst, 'AgastyaCtl.exe')), sha256File(path.join(i.inst, 'versions', '1.2.1', 'AgastyaCtl.exe')));
    r = i.ctl(['--rollback']);
    assert.equal(r.status, 0, r.stdout); assert.equal(pointer(i.inst, 'current'), '1.3.0');
    // --rollback --restore-db: back to the database copy taken before the update to 1.3.0; the newer database is kept aside
    r = i.ctl(['--rollback', '--restore-db']);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /the database is the copy taken before the update to 1\.3\.0 \(the newer one is kept in .*rolled-back-from-1\.3\.0-/);
  });
});

describe('an installation made before versioned folders (flat layout)', { skip }, () => {
  test('is adopted into versions\\<its version> by the first update and can be rolled back to', async () => {
    const i = await install('flat', '1.0.0', { flat: true });
    const r = i.ctl(['--apply-update', pkg('f-110', '1.1.0')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /the installed program \(version 1\.0\.0\) was moved to .*versions\\1\.0\.0/);
    assert.deepEqual(versionsIn(i.inst), ['1.0.0', '1.1.0']);
    assert.ok(!fs.existsSync(path.join(i.inst, 'app')) && !fs.existsSync(path.join(i.inst, 'runtime')), 'the flat program files moved');
    assert.ok(fs.existsSync(path.join(i.inst, 'state.dir')), 'state.dir stays beside the launcher');
    assert.equal(pointer(i.inst, 'previous'), '1.0.0');
    // the adopted folder still verifies against its own manifest
    assert.equal(spawnSync(path.join(i.inst, 'versions', '1.0.0', 'AgastyaCtl.exe'), ['--verify'], { encoding: 'utf8' }).status, 0);
  });
});

describe('Setup steps, first administrator and data removal', { skip }, () => {
  test('--prepare-upgrade makes a verified backup; --activate switches; --first-admin is idempotent; --remove-data needs --confirm and refuses foreign folders', async () => {
    const i = await install('setup', '1.0.0');
    // Setup runs its own new AgastyaCtl.exe (from its temporary folder) against the installed folder
    const newCtl = path.join(tmp, 'setup-tmp', 'AgastyaCtl.exe'); fs.mkdirSync(path.dirname(newCtl)); fs.copyFileSync(signedCtl, newCtl);
    const run = (args) => spawnSync(newCtl, ['--install-dir', i.inst, ...args], { encoding: 'utf8', timeout: 300000 });
    let r = run(['--prepare-upgrade', '1.1.0']);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /pre-update backup written and verified/);
    fs.cpSync(productTree('setup-1.1.0', '1.1.0'), path.join(i.inst, 'versions', '1.1.0'), { recursive: true });   // what Setup's [Files] does
    r = run(['--activate', '1.1.0']);
    assert.equal(r.status, 0, r.stdout); assert.equal(pointer(i.inst, 'current'), '1.1.0'); assert.equal(pointer(i.inst, 'previous'), '1.0.0');
    // first administrator: the second run changes nothing; the password never appears on a command line
    const again = i.ctl(['--first-admin', 'someoneelse', '--password-file', path.join(tmp, 'setup', 'admin-password.txt')]);
    assert.equal(again.status, 0, again.stdout); assert.match(again.stdout, /An administrator already exists/);
    assert.equal(i.ctl(['--first-admin', 'x', '--password-file', path.join(tmp, 'nope.txt')]).status, 2);
    // data removal
    assert.equal(i.ctl(['--remove-data']).status, 2);
    const ini = path.join(i.state, 'agastya.ini'); const iniText = fs.readFileSync(ini, 'utf8');
    fs.writeFileSync(ini, iniText.replace(/DataDir=.*/, `DataDir=${os.homedir()}`));
    r = i.ctl(['--remove-data', '--confirm']);
    assert.equal(r.status, 1); assert.match(r.stderr, /Not removed: .* \(a system or profile folder\)/);
    fs.writeFileSync(ini, iniText);
    r = i.ctl(['--remove-data', '--confirm']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(i.ws) && !fs.existsSync(i.state), 'data and state folders removed');
    assert.ok(fs.existsSync(path.join(i.inst, 'AgastyaCtl.exe')), 'the program is not touched by data removal');
  });
});
