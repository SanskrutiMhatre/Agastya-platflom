// WP-25 (QA-009, G-DEP-1, G-DEP-5): the real Inno Setup script (packaging/installer/agastya.iss) compiled and run SILENTLY, per user, into a
// temporary folder: install with an unattended first administrator, upgrade N-1 -> N (verified pre-update backup, version folders), one-command
// rollback, uninstall keeping the data, uninstall with /PURGEDATA.
//   node --test scripts/release/installer.test.mjs        (needs Inno Setup 6 and backend/dist; skipped without them)
// The product inside is small (the host, this Node.js, a stand-in server, the real backup and first-administrator tools) and the installer is
// built with a RANDOM AppId, so no real installation of the product is seen or touched. What a per-user install writes outside the temporary
// folder - the HKCU uninstall entry of that AppId and the Start-menu folder - is removed by the uninstaller and checked here; a leftover
// uninstall key is deleted in the cleanup. No service, firewall rule, certificate store or Program Files folder is used.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeManifest } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const ISCC = [process.env.ISCC_PATH, path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe', 'C:\\Program Files\\Inno Setup 6\\ISCC.exe'].filter(Boolean).find((p) => fs.existsSync(p));
const skip = process.platform !== 'win32' ? 'Windows only' : !fs.existsSync(CSC) ? 'no C# compiler' : !ISCC ? 'Inno Setup 6 is not installed'
  : !fs.existsSync(path.join(ROOT, 'backend', 'dist', 'services', 'platformBackup.js')) ? 'build the backend first' : false;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-wp25-setup-'));
const APP_ID = crypto.randomUUID().toUpperCase();
const UNINSTALL_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{${APP_ID}}_is1`;
const startMenu = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Agastya Platform');
const startMenuExisted = fs.existsSync(startMenu);
after(() => {
  spawnSync('reg', ['delete', UNINSTALL_KEY, '/f'], { encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
});
const put = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const keyExists = () => spawnSync('reg', ['query', UNINSTALL_KEY], { encoding: 'utf8' }).status === 0;

const SERVER = `'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'version.json'), 'utf8')).version;
const lock = path.join(process.env.AGASTYA_WORKSPACE_DIR, '.agastya-server.lock');
fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() }));
http.createServer((q, r) => { r.writeHead(q.url === '/api/version' || q.url === '/api/ready' || q.url === '/api/health' ? 200 : 404, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ version, schema: { compatible: true }, status: 'ready' })); }).listen(Number(process.env.PORT), '127.0.0.1');
const bye = () => { try { fs.rmSync(lock, { force: true }); } catch {} process.exit(0); };
process.stdin.on('end', bye); process.stdin.on('close', bye); process.stdin.resume();
`;

function setupFor(version) {
  const stage = path.join(tmp, `stage-${version}`);
  const asm = put(path.join(tmp, `asm-${version}.cs`), `using System.Reflection;\n[assembly: AssemblyVersion("${version}.0")]\n[assembly: AssemblyFileVersion("${version}.0")]\n`);
  const srcs = fs.readdirSync(path.join(ROOT, 'packaging', 'host')).filter((f) => f.endsWith('.cs')).map((f) => path.join(ROOT, 'packaging', 'host', f));
  fs.mkdirSync(stage, { recursive: true });
  for (const [out, extra] of [['AgastyaCtl.exe', ['-target:exe']], ['AgastyaPlatform.exe', ['-target:winexe', '-define:GUI', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll']]]) {
    const r = spawnSync(CSC, ['-nologo', '-platform:x64', '-r:System.ServiceProcess.dll', '-r:System.IO.Compression.dll', '-r:System.Security.dll', ...extra, `-out:${path.join(stage, out)}`, ...srcs, asm], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  fs.mkdirSync(path.join(stage, 'runtime')); fs.copyFileSync(process.execPath, path.join(stage, 'runtime', 'node.exe'));
  put(path.join(stage, 'app', 'backend', 'dist', 'index.js'), SERVER);
  for (const s of ['agastya-backup.js', 'first-admin.js']) put(path.join(stage, 'app', 'backend', 'scripts', s), `require(${JSON.stringify(path.join(ROOT, 'backend', 'scripts', s))});\n`);
  put(path.join(stage, 'app', 'frontend', 'dist', 'index.html'), '<!doctype html>');
  fs.mkdirSync(path.join(stage, 'docs')); fs.copyFileSync(path.join(ROOT, 'packaging', 'agastya.ini.template'), path.join(stage, 'docs', 'agastya.ini.template'));
  put(path.join(stage, 'version.json'), JSON.stringify({ product: 'Agastya Platform', appId: APP_ID, version }) + '\n');
  writeManifest(stage, { product: 'Agastya Platform', version, commit: 'test' });
  const out = path.join(tmp, 'setups');
  const r = spawnSync(ISCC, ['/Q', `/DAppVersion=${version}`, `/DSourceDir=${stage}`, `/DOutputDir=${out}`, `/DSetupIcon=${path.join(ROOT, 'packaging', 'assets', 'agastya.ico')}`,
    `/DAppGuid=${APP_ID}`, '/DAppPublisher=Agastya WP-25 Test', `/DFirewallRule=Agastya WP-25 Test ${APP_ID}`, path.join(ROOT, 'packaging', 'installer', 'agastya.iss')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return path.join(out, `Agastya-Platform-${version}-win-x64-Setup.exe`);
}

describe('the real installer, silent and per user, in a temporary folder', { skip }, () => {
  test('install with a first administrator, upgrade with a verified backup, rollback, uninstall keeping the data, uninstall with /PURGEDATA', async () => {
    assert.ok(!keyExists());
    const s100 = setupFor('1.0.0'); const s110 = setupFor('1.1.0');
    const prog = path.join(tmp, 'Program Folder'); const state = path.join(tmp, 'State Folder'); const ws = path.join(state, 'workspace');
    const port = await freePort();
    const pw = put(path.join(tmp, 'pw.txt'), 'Temp-Setup-Pass-77!\r\n');
    const setup = (exe, extra, log) => spawnSync(exe, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', `/DIR=${prog}`, `/STATEDIR=${state}`, `/LOG=${path.join(tmp, log)}`, ...extra], { encoding: 'utf8', timeout: 600000 });
    const ctl = (args) => spawnSync(path.join(prog, 'AgastyaCtl.exe'), args, { encoding: 'utf8', timeout: 300000 });
    const pointer = (n) => (fs.existsSync(path.join(prog, n)) ? fs.readFileSync(path.join(prog, n), 'utf8').trim() : null);

    // 1. a first installation: no question, the administrator is created from the password file
    let r = setup(s100, [`/PORT=${port}`, '/ADMINUSER=siteadmin', `/ADMINPASSWORDFILE=${pw}`], 'install-100.log');
    assert.equal(r.status, 0, fs.readFileSync(path.join(tmp, 'install-100.log'), 'utf8').slice(-3000));
    assert.equal(pointer('current'), '1.0.0');
    assert.ok(fs.existsSync(path.join(prog, 'versions', '1.0.0', 'runtime', 'node.exe')));
    assert.ok(fs.existsSync(path.join(ws, 'publisher.db')), 'the first administrator created the database');
    assert.ok(keyExists(), 'per-user uninstall entry');
    assert.match(fs.readFileSync(path.join(state, 'agastya.ini'), 'utf8'), new RegExp(`Port=${port}`));
    const v = ctl(['--verify']); assert.equal(v.status, 0, v.stdout);
    const dbBefore = fs.readFileSync(path.join(ws, 'publisher.db'));

    // 2. upgrade N-1 -> N: Setup's own new AgastyaCtl stops, backs up and verifies before anything is copied
    r = setup(s110, [], 'install-110.log');
    assert.equal(r.status, 0, fs.readFileSync(path.join(tmp, 'install-110.log'), 'utf8').slice(-3000));
    assert.equal(pointer('current'), '1.1.0'); assert.equal(pointer('previous'), '1.0.0');
    const backups = fs.readdirSync(path.join(ws, 'backups', 'platform')).filter((n) => /-pre-update\.zip$/.test(n));
    assert.equal(backups.length, 1, 'one verified pre-update platform backup');
    const upLog = fs.readdirSync(path.join(state, 'logs')).find((n) => /^setup-upgrade-/.test(n));
    assert.match(fs.readFileSync(path.join(state, 'logs', upLog), 'utf8'), /pre-update backup written and verified/);
    assert.deepEqual(fs.readFileSync(path.join(ws, 'publisher.db')), dbBefore, 'the upgrade did not change the database');
    assert.match(ctl(['--version']).stdout, /Agastya Platform 1\.1\.0/);

    // 3. one-command rollback to the version Setup replaced
    r = ctl(['--rollback']);
    assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(pointer('current'), '1.0.0');
    assert.match(ctl(['--version']).stdout, /Agastya Platform 1\.0\.0/, 'the launcher is the rolled-back version\'s');
    assert.match(spawnSync('reg', ['query', UNINSTALL_KEY, '/v', 'DisplayVersion'], { encoding: 'utf8' }).stdout, /DisplayVersion\s+REG_SZ\s+1\.0\.0/, 'Add/Remove Programs follows the rollback');

    // 4. uninstall keeps the data
    const unins = path.join(prog, 'unins000.exe'); assert.ok(fs.existsSync(unins));
    r = spawnSync(unins, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { encoding: 'utf8', timeout: 300000 });
    assert.equal(r.status, 0);
    for (let k = 0; k < 120 && (fs.existsSync(path.join(prog, 'versions')) || keyExists()); k++) await new Promise((res) => setTimeout(res, 500));
    assert.ok(!fs.existsSync(path.join(prog, 'versions')) && !fs.existsSync(path.join(prog, 'AgastyaCtl.exe')), 'the program is removed, offline-update folders included');
    assert.ok(!keyExists(), 'the uninstall entry is removed');
    assert.ok(fs.existsSync(path.join(ws, 'publisher.db')) && fs.existsSync(path.join(state, 'agastya.ini')), 'the data and the configuration are kept');
    if (!startMenuExisted) assert.ok(!fs.existsSync(startMenu), 'the Start-menu folder is removed');

    // 5. reinstall over the kept data (no administrator question: it exists), then uninstall with /PURGEDATA
    r = setup(s110, [], 'install-again.log');
    assert.equal(r.status, 0);
    assert.equal(pointer('current'), '1.1.0');
    r = spawnSync(path.join(prog, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/PURGEDATA'], { encoding: 'utf8', timeout: 300000 });
    assert.equal(r.status, 0);
    for (let k = 0; k < 120 && (fs.existsSync(ws) || keyExists()); k++) await new Promise((res) => setTimeout(res, 500));
    assert.ok(!fs.existsSync(ws) && !fs.existsSync(state), '/PURGEDATA removed the data and the configuration');
    assert.ok(!keyExists());
  });
});
