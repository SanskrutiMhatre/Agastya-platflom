#!/usr/bin/env node
// Release readiness (RES-011, WP-08): the static release gates in one read-only command.
//
//   node scripts/ci/readiness.mjs [--release DIR] [--install DIR] [--evidence DIR] [--allow-not-run]
//
// Each gate is PASS, FAIL or NOT RUN (its input is absent, or it is not automated yet). The script exits non-zero when any gate FAILs, and also when
// any is NOT RUN unless --allow-not-run is given: a release needs every gate. It prints the gate ids and writes readiness.md / readiness.json into
// the evidence folder (default verification-results/readiness/<date>) for the release record. It changes nothing.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const RELEASE = path.resolve(opt('release', path.join(ROOT, 'release')));
const INSTALL = opt('install');
const EVIDENCE = path.resolve(opt('evidence', path.join(ROOT, 'verification-results', 'readiness', new Date().toISOString().slice(0, 10))));
fs.mkdirSync(EVIDENCE, { recursive: true });

const gates = [];
const gate = (id, name, fn) => { let r; try { r = fn(); } catch (e) { r = { status: 'FAIL', detail: e.message }; } gates.push({ id, name, ...r }); };
const git = (...a) => { const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
const head = git('rev-parse', 'HEAD');
const ps = (cmd) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });

gate('G-SEC-5', 'every route is guarded (static route-guard test)', () => {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/routes-guarded.test.js'], { cwd: path.join(ROOT, 'backend'), encoding: 'utf8' });
  const pass = /# pass (\d+)/.exec(r.stdout)?.[1]; const fail = /# fail (\d+)/.exec(r.stdout)?.[1];
  return { status: r.status === 0 ? 'PASS' : 'FAIL', detail: `routes-guarded.test.js: ${pass ?? '?'} pass, ${fail ?? '?'} fail` };
});
gate('G-SEC-5b', 'every state-changing route writes an audit record (static audit-coverage test)', () => {
  const f = path.join(ROOT, 'backend', 'test', 'wp29-audit-coverage.test.js');
  if (!fs.existsSync(f)) return { status: 'NOT RUN', detail: 'backend/test/wp29-audit-coverage.test.js does not exist yet (WP-29 / G-SEC-5)' };
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/wp29-audit-coverage.test.js'], { cwd: path.join(ROOT, 'backend'), encoding: 'utf8' });
  return { status: r.status === 0 ? 'PASS' : 'FAIL', detail: 'wp29-audit-coverage.test.js' };
});
gate('G-SEC-4', 'audit integrity: seeded tampering (edit, delete middle, forge, cut the end) is detected; G-REL-8 fault-injected audit writes', () => {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/wp29-audit-trail.test.js'], { cwd: path.join(ROOT, 'backend'), encoding: 'utf8' });
  const pass = /# pass (\d+)/.exec(r.stdout)?.[1]; const fail = /# fail (\d+)/.exec(r.stdout)?.[1];
  return { status: r.status === 0 ? 'PASS' : 'FAIL', detail: `wp29-audit-trail.test.js: ${pass ?? '?'} pass, ${fail ?? '?'} fail (also covers G-REL-8)` };
});
gate('QA-001', 'the release artefacts were built from this commit, from a clean tree', () => {
  const f = path.join(RELEASE, 'BUILD-INFO.json');
  if (!fs.existsSync(f)) return { status: 'NOT RUN', detail: `${f} is absent (build with npm run package:win)` };
  const b = JSON.parse(fs.readFileSync(f, 'utf8'));
  const bad = [];
  if (b.commit !== head) bad.push(`built from ${String(b.commit).slice(0, 12)}, HEAD is ${head.slice(0, 12)}`);
  if (b.dirty) bad.push('built from a tree with uncommitted changes');
  for (const o of b.outputs || []) {
    const p = path.join(RELEASE, o.file);
    if (!fs.existsSync(p)) bad.push(`${o.file} is missing`);
    else if (crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') !== o.sha256) bad.push(`${o.file} does not match its recorded hash`);
  }
  return { status: bad.length ? 'FAIL' : 'PASS', detail: bad.join('; ') || `commit ${head.slice(0, 12)}, ${(b.outputs || []).length} artefacts verified` };
});
gate('G-SEC-11a', 'the installer and the product executables carry a valid, time-stamped Authenticode signature', () => {
  if (process.platform !== 'win32') return { status: 'NOT RUN', detail: 'Windows only' };
  // WP-24: the installer, and AgastyaPlatform.exe / AgastyaCtl.exe of the staged product (the audit's "installer + 2 executables")
  const exes = fs.existsSync(RELEASE) ? fs.readdirSync(RELEASE).filter((n) => /\.exe$/i.test(n)).map((n) => path.join(RELEASE, n)) : [];
  for (const d of fs.existsSync(RELEASE) ? fs.readdirSync(RELEASE).filter((n) => /^Agastya-Platform-.*-win-x64$/.test(n)) : []) {
    for (const e of ['AgastyaPlatform.exe', 'AgastyaCtl.exe']) if (fs.existsSync(path.join(RELEASE, d, e))) exes.push(path.join(RELEASE, d, e));
  }
  if (!exes.length) return { status: 'NOT RUN', detail: `no .exe in ${RELEASE}` };
  const bad = [];
  for (const e of exes) {
    const r = ps(`$s = Get-AuthenticodeSignature -LiteralPath '${e.replace(/'/g, "''")}'; '{0}|{1}' -f $s.Status, [bool]$s.TimeStamperCertificate`);
    const [status, ts] = r.stdout.trim().split('|');
    if (status !== 'Valid') bad.push(`${path.basename(e)}: ${status || r.stderr.trim()}`);
    else if (ts !== 'True') bad.push(`${path.basename(e)}: Valid but not time-stamped`);
  }
  return { status: bad.length ? 'FAIL' : 'PASS', detail: bad.join('; ') || `${exes.length} file(s) Valid and time-stamped` };
});
gate('G-SEC-11b', 'the Node runtime the product ships has at least 12 months of support left', () => {
  // WP-13 (ENT-008): what is checked is the runtime the product SHIPS - the one recorded in release/BUILD-INFO.json when a release is present,
  // otherwise the pin in packaging/product.json - not the Node that happens to run this script.
  // Node release schedule (nodejs.org/about/releases, as known on 2026-11-27): even majors are LTS for 30 months after their April release.
  const EOL = { 20: '2026-04-30', 22: '2027-04-30', 24: '2028-04-30', 26: '2029-04-30' };
  const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'packaging', 'product.json'), 'utf8'));
  const pinned = product.runtime?.node;
  const buildInfo = path.join(RELEASE, 'BUILD-INFO.json');
  const shipped = fs.existsSync(buildInfo) ? String(JSON.parse(fs.readFileSync(buildInfo, 'utf8')).node || '').replace(/^v/, '') : null;
  const ver = shipped || pinned;
  if (!ver) return { status: 'FAIL', detail: 'packaging/product.json has no runtime.node pin' };
  const major = Number(ver.split('.')[0]);
  if (!EOL[major]) return { status: 'FAIL', detail: `Node ${ver} is not an LTS line this script knows` };
  const min = product.runtime?.minSupportMonths ?? 12;
  const months = (new Date(EOL[major]) - new Date()) / (30.44 * 864e5);
  const notes = [`Node ${ver} (${shipped ? 'release/BUILD-INFO.json' : 'pin in packaging/product.json'}): end of life ${EOL[major]}, ${months.toFixed(1)} months left`];
  if (shipped && pinned && shipped !== pinned) notes.push(`the release was built with ${shipped}, the pin is ${pinned}`);
  const bad = months < min || (shipped && pinned && Number(shipped.split('.')[0]) !== Number(pinned.split('.')[0]));
  return { status: bad ? 'FAIL' : 'PASS', detail: notes.join('; ') };
});
gate('RES-005', 'a software bill of materials ships with the release, is listed in the checksums and checks', () => {
  // WP-24: the packager writes <stage>-SBOM.cdx.json (CycloneDX 1.5) and lists it in SHA256SUMS.txt, whose signature therefore covers it
  const sbom = fs.existsSync(RELEASE) ? fs.readdirSync(RELEASE).filter((n) => /\.cdx\.json$/i.test(n)) : [];
  if (!sbom.length) return { status: 'NOT RUN', detail: `no *.cdx.json in ${RELEASE} (build with npm run package:win)` };
  const sums = path.join(RELEASE, 'SHA256SUMS.txt');
  const listed = fs.existsSync(sums) ? fs.readFileSync(sums, 'utf8') : '';
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release', 'sbom.mjs'), '--check', path.join(RELEASE, sbom[0])], { encoding: 'utf8' });
  const bad = [];
  if (!listed.includes(`*${sbom[0]}`)) bad.push(`${sbom[0]} is not listed in SHA256SUMS.txt`);
  if (r.status !== 0) bad.push((r.stderr || r.stdout).trim().split(/\r?\n/).slice(0, 4).join(' '));
  return { status: bad.length ? 'FAIL' : 'PASS', detail: bad.join('; ') || `${sbom[0]}: ${r.stdout.trim()}` };
});
gate('G-SEC-11c', 'the release verifies offline: checksums, their signature, the signed manifest of every product file, one signer', () => {
  if (!fs.existsSync(path.join(RELEASE, 'SHA256SUMS.txt'))) return { status: 'NOT RUN', detail: `no SHA256SUMS.txt in ${RELEASE}` };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release', 'verify-release.mjs'), '--release', RELEASE, '--require-signed', '--require-timestamp', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  let res; try { res = JSON.parse(r.stdout); } catch { return { status: 'FAIL', detail: (r.stderr || r.stdout).trim().slice(0, 400) }; }
  const fails = res.rows.filter((x) => x.status === 'FAIL');
  return { status: res.ok ? 'PASS' : 'FAIL', detail: fails.map((x) => `${x.check}: ${x.detail}`).join('; ') || `${res.rows.length} checks passed` };
});
gate('G-DEP-4', 'the doctor detects seeded faults; --verify and the support bundle behave (fault-injection test)', () => {
  if (process.platform !== 'win32') return { status: 'NOT RUN', detail: 'Windows only' };
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', path.join(ROOT, 'scripts', 'release', 'host.test.mjs')], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const pass = /# pass (\d+)/.exec(r.stdout)?.[1]; const fail = /# fail (\d+)/.exec(r.stdout)?.[1];
  return { status: r.status === 0 ? 'PASS' : 'FAIL', detail: `scripts/release/host.test.mjs: ${pass ?? '?'} pass, ${fail ?? '?'} fail (seeded: missing runtime, missing JRE, port in use, bad ini value, read-only data folder; not seeded: low disk, stopped service, expired TLS certificate)` };
});
gate('G-DEP-3', 'the deployment detection rule reports the installed copy', () => {
  if (!INSTALL) return { status: 'NOT RUN', detail: 'pass --install <folder of an installed copy>; the SCCM/Intune run itself is manual (docs/DEPLOYMENT-KIT.md)' };
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'packaging', 'deploy', 'Detect-AgastyaPlatform.ps1'), '-MinimumVersion', version], { encoding: 'utf8' });
  const out = r.stdout.trim();
  return { status: r.status === 0 && out ? 'PASS' : 'FAIL', detail: out || `not detected (exit ${r.status})` };
});
gate('G-SEC-6', 'the installed copy grants write access to its data folder only to administrators and the service identity', () => {
  if (!INSTALL) return { status: 'NOT RUN', detail: 'pass --install <folder of an installed copy>' };
  const r = spawnSync('icacls', [INSTALL], { encoding: 'utf8' });
  if (r.status !== 0) return { status: 'FAIL', detail: r.stderr.trim() || `icacls exit ${r.status}` };
  const broad = r.stdout.split(/\r?\n/).filter((l) => /(Everyone|BUILTIN\\Users|Authenticated Users):.*\((?:[^)]*[FMW][^)]*)\)/.test(l));
  return { status: broad.length ? 'FAIL' : 'PASS', detail: broad.join(' | ') || 'no write grant to Everyone, Users or Authenticated Users' };
});
gate('G-OFF-2', 'no Content-Security-Policy violation in the e2e run', () => ({ status: 'NOT RUN', detail: 'not automated yet: the e2e suite does not collect CSP reports (WP-09)' }));
gate('G-DEP-6', 'doctor passes on a clean install', () => {
  if (!INSTALL) return { status: 'NOT RUN', detail: 'pass --install <folder of an installed copy>' };
  const ctl = path.join(INSTALL, 'AgastyaCtl.exe');
  if (!fs.existsSync(ctl)) return { status: 'FAIL', detail: `${ctl} is missing` };
  const r = spawnSync(ctl, ['--doctor'], { encoding: 'utf8' });   // was 'doctor', which the host rejects as an unknown argument (fixed in WP-24)
  return { status: r.status === 0 ? 'PASS' : 'FAIL', detail: (r.stdout || r.stderr).trim().split(/\r?\n/).slice(-1)[0] || `exit ${r.status}` };
});
gate('DEP-013', 'every file of the installed copy matches its signed manifest (AgastyaCtl --verify --require-signed)', () => {
  if (!INSTALL) return { status: 'NOT RUN', detail: 'pass --install <folder of an installed copy>' };
  const ctl = path.join(INSTALL, 'AgastyaCtl.exe');
  if (!fs.existsSync(ctl)) return { status: 'FAIL', detail: `${ctl} is missing` };
  const r = spawnSync(ctl, ['--verify', '--require-signed'], { encoding: 'utf8', maxBuffer: 16 << 20 });
  const lines = (r.stdout || r.stderr).trim().split(/\r?\n/).filter((l) => /^\[(FAIL|WARN)\]/.test(l));
  return { status: r.status === 0 ? 'PASS' : 'FAIL', detail: lines.join(' | ') || (r.stdout || '').trim().split(/\r?\n/).slice(-1)[0] };
});

const allowNotRun = argv.includes('--allow-not-run');
const failed = gates.filter((g) => g.status === 'FAIL'); const notRun = gates.filter((g) => g.status === 'NOT RUN');
const md = [`# Release readiness ${new Date().toISOString()}`, '', `Commit \`${head}\`; release folder \`${RELEASE}\`; installed copy ${INSTALL ? `\`${INSTALL}\`` : 'not given'}.`, '',
  '| Gate | Check | Result | Detail |', '|---|---|---|---|', ...gates.map((g) => `| ${g.id} | ${g.name} | ${g.status === 'PASS' ? 'PASS' : `**${g.status}**`} | ${String(g.detail).replace(/\|/g, '/')} |`), ''].join('\n');
fs.writeFileSync(path.join(EVIDENCE, 'readiness.md'), md);
fs.writeFileSync(path.join(EVIDENCE, 'readiness.json'), JSON.stringify({ commit: head, gates }, null, 2) + '\n');
for (const g of gates) console.log(`${g.status.padEnd(7)} ${g.id.padEnd(10)} ${g.name}: ${g.detail}`);
console.log(`\nreadiness: ${failed.length} failed${failed.length ? ` (${failed.map((g) => g.id).join(', ')})` : ''}, ${notRun.length} not run${notRun.length ? ` (${notRun.map((g) => g.id).join(', ')})` : ''}; ${path.join(EVIDENCE, 'readiness.md')}`);
process.exit(failed.length || (notRun.length && !allowNotRun) ? 1 : 0);
