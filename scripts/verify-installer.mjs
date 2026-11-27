#!/usr/bin/env node
// =============================================================================
// Proves the installer on this machine, without touching anything system-wide:
//   a silent PER-USER install (/CURRENTUSER: no administrator rights, no service, no firewall rule) into a scratch folder whose name has spaces and
//   non-ASCII letters, with the data and the configuration in other scratch folders; then
//   - the files, state.dir and agastya.ini are as asked          - the installed server starts, answers, logs where state.dir says
//   - the program folder is NOT written to while it runs          - an upgrade over the top: ini and data kept, database backed up first
//   - uninstall: the program, the shortcuts and the uninstall entry go; the data and the configuration stay.
// Everything it creates is removed at the end (even when a check fails).
//
//   node scripts/verify-installer.mjs [--setup <Setup.exe>] [--port 4072]
// =============================================================================

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const port = Number(arg('--port', '4072'));
if (port < 4070 || port > 4079) { console.error('Use a port from 4070 to 4079 (the range this check is allowed to use).'); process.exit(2); }

const product = JSON.parse(fs.readFileSync(path.join(root, 'packaging', 'product.json'), 'utf8'));
// WP-13 (DEP-004): the expected version is the package's, never a literal.
const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
let setup = arg('--setup');
if (!setup) {
  const rel = path.join(root, 'release');
  const c = fs.existsSync(rel) ? fs.readdirSync(rel).filter((f) => /-Setup\.exe$/.test(f)).map((f) => path.join(rel, f)) : [];
  setup = c.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}
if (!setup || !fs.existsSync(setup)) { console.error('No Setup.exe found. Pass --setup <path> or run npm run package:win first.'); process.exit(2); }

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail && !ok ? `\n          ${detail}` : ''}`); return !!ok; };

// scratch layout: spaces and non-ASCII letters on purpose
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-inst-'));
const inst = path.join(work, 'Prüfung Übung é', 'Agastya Platform');
const data = path.join(work, 'Daten Ünï', 'ws');
const state = path.join(work, 'Zustand ü');
const setupLog = path.join(work, 'setup.log');
const uninstKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{${product.appId}}_is1`;
const startMenu = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Agastya Platform');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const regHas = (key) => spawnSync('reg', ['query', key], { encoding: 'utf8' }).status === 0;
function manifest(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const s = fs.statSync(p); out.push(`${path.relative(dir, p)}|${s.size}|${Math.floor(s.mtimeMs)}`); } } };
  walk(dir);
  return out.sort();
}
function install(extra = []) {
  return spawnSync(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', `/DIR=${inst}`, `/DATADIR=${data}`, `/STATEDIR=${state}`,
    `/PORT=${port}`, '/NOSERVICE', `/LOG=${setupLog}`, ...extra], { encoding: 'utf8', timeout: 600000 });
}
async function health(ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) }); if (r.ok) return await r.json(); } catch { /* not yet */ }
    await sleep(500);
  }
  return null;
}
const portFree = async () => { try { await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) }); return false; } catch { return true; } };

let host = null;
try {
  console.log(`Installer: ${setup}\nScratch:   ${work}\n`);

  // ---- first installation
  console.log('First installation (silent, per-user, /NOSERVICE):');
  const r1 = install();
  check('Setup exits with code 0', r1.status === 0, `exit ${r1.status}; see ${setupLog}`);
  const ctl = path.join(inst, 'AgastyaCtl.exe');
  // WP-25 (DEP-023): the program is in versions\<version>\ and "current" names it; the launcher sits beside it
  const current = fs.existsSync(path.join(inst, 'current')) ? fs.readFileSync(path.join(inst, 'current'), 'utf8').trim() : '';
  const prog = path.join(inst, 'versions', current || 'missing');
  check('"current" names the installed version', current === expectedVersion, current || 'no current file');
  check('the program is in the chosen folder (spaces, non-ASCII)', fs.existsSync(path.join(inst, 'AgastyaPlatform.exe')) && fs.existsSync(ctl) && fs.existsSync(path.join(prog, 'runtime', 'node.exe')) && fs.existsSync(path.join(prog, 'app', 'backend', 'dist', 'index.js')));
  check('licences are installed', fs.existsSync(path.join(prog, 'THIRD-PARTY-NOTICES.txt')) && fs.existsSync(path.join(prog, 'licenses', 'node', 'LICENSE')));
  check('no portable.flag and no sample config leaked into the installed program folder', !fs.existsSync(path.join(inst, 'portable.flag')) && !fs.existsSync(path.join(inst, 'config')) && !fs.existsSync(path.join(prog, 'portable.flag')) && !fs.existsSync(path.join(prog, 'config')));
  check('state.dir points at the chosen state folder', fs.existsSync(path.join(inst, 'state.dir')) && fs.readFileSync(path.join(inst, 'state.dir'), 'utf8').replace(/^﻿/, '').trim() === state, fs.existsSync(path.join(inst, 'state.dir')) ? fs.readFileSync(path.join(inst, 'state.dir'), 'utf8') : 'missing');
  const iniPath = path.join(state, 'agastya.ini');
  const ini = fs.existsSync(iniPath) ? fs.readFileSync(iniPath, 'utf8').replace(/^﻿/, '') : '';
  check('agastya.ini has the port and the data folder that were asked for', ini.includes(`Port=${port}`) && ini.includes(`DataDir=${data}`) && /Bind=loopback/.test(ini), ini.split('\n').filter((l) => /^(Port|DataDir|Bind)=/.test(l)).join(' | '));
  check('the data folder was created', fs.existsSync(data));
  check('Start menu shortcuts exist', fs.existsSync(path.join(startMenu, 'Agastya Platform.lnk')));
  check('the uninstall entry is registered', regHas(uninstKey));
  check('no Windows service was registered (/NOSERVICE)', spawnSync('sc', ['query', product.defaultServiceName]).status === 1060);

  // ---- run the installed product
  console.log('\nRunning the installed product:');
  const doc = spawnSync(ctl, ['--doctor'], { encoding: 'utf8' });
  check('AgastyaCtl --doctor reports no problem (picks its config up from state.dir)', doc.status === 0 && doc.stdout.includes(`port ${port} is free`), `exit ${doc.status}\n${doc.stdout}`);
  const before = manifest(inst);
  host = spawn(ctl, ['--console'], { stdio: 'ignore', windowsHide: true });
  const h = await health();
  check('the installed server answers on the chosen port', h && h.status === 'ok' && h.version === expectedVersion, JSON.stringify(h));
  const v = await fetch(`http://127.0.0.1:${port}/api/version`).then((r) => r.json()).catch(() => null);
  check('/api/version agrees with the package and the stamped build (WP-13)', v && v.version === expectedVersion && v.build?.packaged === true && v.schema?.compatible === true, JSON.stringify(v));
  const ui = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text()).catch(() => '');
  check('and serves the web client', /id=["']root["']/.test(ui));
  await sleep(1500);
  const hostLog = path.join(state, 'logs', 'agastya-host.log');
  check('logs go to the state folder', fs.existsSync(hostLog) && fs.existsSync(path.join(state, 'logs', 'agastya-server.log')));
  check('publisher.db was created in the data folder', fs.existsSync(path.join(data, 'publisher.db')));
  spawnSync('taskkill', ['/F', '/T', '/PID', String(host.pid)], { stdio: 'ignore' }); // only the process tree this script started (the job object also ends node and java)
  host = null;
  for (let i = 0; i < 40 && !(await portFree()); i++) await sleep(500);
  check('stopping the host leaves nothing listening', await portFree());
  const after = manifest(inst);
  const changed = after.filter((l) => !before.includes(l)).concat(before.filter((l) => !after.includes(l)));
  check('nothing was written into the program folder while it ran', changed.length === 0, changed.slice(0, 5).join('\n          '));

  // ---- upgrade in place
  console.log('\nUpgrade in place (the same installer over the installed copy):');
  fs.appendFileSync(iniPath, '\n; kept-across-upgrade-marker\n');
  fs.writeFileSync(path.join(data, 'user-file.txt'), 'user data');
  const r2 = install();
  check('Setup exits with code 0', r2.status === 0, `exit ${r2.status}; see ${setupLog}`);
  check('agastya.ini was kept, with the administrator\'s edit', fs.readFileSync(iniPath, 'utf8').includes('kept-across-upgrade-marker'));
  check('the data was kept', fs.readFileSync(path.join(data, 'user-file.txt'), 'utf8') === 'user data' && fs.existsSync(path.join(data, 'publisher.db')));
  // WP-25 (DEP-001, G-DEP-5): a platform backup of kind pre-update, made and verified by a restore before Setup replaced anything
  const pdir = path.join(data, 'backups', 'platform');
  const backups = fs.existsSync(pdir) ? fs.readdirSync(pdir).filter((d) => /-pre-update(-\d+)?\.zip$/.test(d)) : [];
  check('a platform backup was made before the upgrade', backups.length === 1, JSON.stringify(backups));
  const upLog = fs.existsSync(path.join(state, 'logs')) ? fs.readdirSync(path.join(state, 'logs')).find((n) => n.startsWith('setup-upgrade-')) : null;
  check('and verified by a restore before anything was replaced', !!upLog && /pre-update backup written and verified/.test(fs.readFileSync(path.join(state, 'logs', upLog), 'utf8')), upLog || 'no setup-upgrade log');

  // ---- uninstall
  console.log('\nUninstall:');
  const un = spawnSync(path.join(inst, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { encoding: 'utf8', timeout: 300000 });
  check('the uninstaller exits with code 0', un.status === 0, `exit ${un.status}`);
  for (let i = 0; i < 20 && fs.existsSync(path.join(inst, 'AgastyaPlatform.exe')); i++) await sleep(500);
  check('the program files are gone', !fs.existsSync(path.join(inst, 'AgastyaPlatform.exe')) && !fs.existsSync(path.join(inst, 'versions')) && !fs.existsSync(path.join(inst, 'app')));
  check('the Start menu shortcuts are gone', !fs.existsSync(path.join(startMenu, 'Agastya Platform.lnk')));
  check('the uninstall entry is gone', !regHas(uninstKey));
  check('the data and the configuration were KEPT', fs.existsSync(path.join(data, 'publisher.db')) && fs.existsSync(path.join(data, 'user-file.txt')) && fs.existsSync(iniPath));
} catch (e) {
  check('verification ran to the end', false, e.stack || String(e));
} finally {
  if (host) spawnSync('taskkill', ['/F', '/T', '/PID', String(host.pid)], { stdio: 'ignore' });
  // make sure nothing of this test is left behind, even if a step failed half-way
  const un = path.join(inst, 'unins000.exe');
  if (fs.existsSync(un)) spawnSync(un, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { timeout: 300000 });
  await sleep(1500);
  if (regHas(uninstKey)) spawnSync('reg', ['delete', uninstKey, '/f'], { stdio: 'ignore' });
  if (fs.existsSync(startMenu)) fs.rmSync(startMenu, { recursive: true, force: true });
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
