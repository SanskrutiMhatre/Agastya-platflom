#!/usr/bin/env node
// =============================================================================
// Builds the Windows release of Agastya Platform.
//
//   npm run package:win                 package what is built (fails if the build is out of date)
//   npm run package:win -- --build      build the backend and the frontend first
//   options: --no-installer   skip Setup.exe          --no-zip   skip the portable ZIP
//            --out <dir>      output folder (default: release)
//            --node <node.exe>   the Node.js runtime to ship (default: the one running this script; must be 64-bit Windows and the Node line
//                                pinned in packaging/product.json runtime.node, Node 24 LTS since WP-13)
//            --no-arial       leave the four proprietary Arial font files out (Liberation Sans, metric-compatible, is used instead). Use it when
//                             the party distributing the product does not hold a licence that lets it redistribute Arial.
//            --release        a customer release (WP-24): refuses an unsigned or untimestamped build, a tree with uncommitted changes, the
//                             placeholder publisher data and a missing EULA, and fails unless the finished release verifies offline.
//
// Output (in release/):
//   Agastya-Platform-<version>-win-x64/                 the staged product (what both packages contain)
//   Agastya-Platform-<version>-win-x64-portable.zip     unzip anywhere and run AgastyaPlatform.exe
//   Agastya-Platform-<version>-win-x64-Setup.exe        the installer
//   Agastya-Platform-<version>-win-x64-SBOM.cdx.json    the software bill of materials (CycloneDX 1.5; also inside the product as SBOM.cdx.json)
//   Verify-Release.ps1                                  offline verifier for the customer (Windows PowerShell 5.1, no other tool)
//   SHA256SUMS.txt (+ SHA256SUMS.txt.sig when signed)   checksums of the above; the signature covers them all
//   BUILD-INFO.json                                     commit, toolchain, signing set-up, artefact hashes
// Inside the product: MANIFEST.sha256 (+ .sig): SHA-256 of every shipped file, checked by AgastyaCtl.exe --verify and at every start.
//
// Code signing (WP-24, docs/SIGNING.md): set AGASTYA_SIGN_THUMBPRINT (certificate store / HSM) or AGASTYA_SIGN_PFX + AGASTYA_SIGN_PASSWORD, and
// AGASTYA_SIGN_TIMESTAMP_URL; scripts/release/signing.mjs explains them. Every unsigned .exe/.dll/.node of the product, Setup.exe and the
// uninstaller get an Authenticode signature; the manifest and SHA256SUMS.txt a detached signature with the same certificate. AGASTYA_SIGN_CMD
// (a command with $f) still works for the executables. Without any, the output is unsigned and Windows SmartScreen will warn on first run.
// =============================================================================

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signingConfig, releaseSigningRefusals, signFiles, signDetached, describeSigning } from './release/signing.mjs';
import { writeManifest, authenticode, signedIntact, isPe, listFiles, formatSums, MANIFEST_NAME } from './release/lib.mjs';
import { buildSbom, checkSbom, sbomStats } from './release/sbom.mjs';
import { verifyRelease } from './release/verify-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

const log = (m) => console.log(`[package] ${m}`);
const fail = (m) => { console.error(`[package] ERROR: ${m}`); process.exit(1); };

if (process.platform !== 'win32') fail('This script builds the Windows release and must run on Windows.');
if (process.arch !== 'x64') fail('Run it with a 64-bit Node.js.');

const product = JSON.parse(fs.readFileSync(path.join(root, 'packaging', 'product.json'), 'utf8'));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = rootPkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`package.json version "${version}" must be x.y.z`);

const outDir = path.resolve(opt('--out') || path.join(root, 'release'));
const stageName = `Agastya-Platform-${version}-win-x64`;
const stage = path.join(outDir, stageName);
const zipPath = path.join(outDir, `${stageName}-portable.zip`);
const setupName = `${stageName}-Setup.exe`;
const nodeExe = path.resolve(opt('--node') || process.execPath);
const noArial = flag('--no-arial');
const releaseMode = flag('--release');
const signing = signingConfig();

function run(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...o });
  if (r.error) fail(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) fail(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')} ... exited with ${r.status}`);
}
function capture(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: root, maxBuffer: 256 * 1024 * 1024, ...o });
  if (r.error) fail(`${cmd}: ${r.error.message}`);
  return r;
}
const newest = (dir) => {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
};
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

// ---- 1. the build must be current ----------------------------------------------------------------------------------------------------------
if (flag('--build')) { log('building the backend and the frontend'); const n = npmCmd(); run(n.cmd, [...n.pre, 'run', 'build'], { shell: n.shell }); }
function npmCmd() {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(cli) ? { cmd: process.execPath, pre: [cli] } : { cmd: 'npm.cmd', pre: [], shell: true };
}
const beDist = path.join(root, 'backend', 'dist', 'index.js');
const feDist = path.join(root, 'frontend', 'dist', 'index.html');
if (!fs.existsSync(beDist) || !fs.existsSync(feDist)) fail('There is no build. Run with --build (or npm run build first).');
if (newest(path.join(root, 'backend', 'src')) > fs.statSync(beDist).mtimeMs) fail('backend/dist is older than backend/src. Run with --build.');
if (newest(path.join(root, 'frontend', 'src')) > fs.statSync(feDist).mtimeMs) fail('frontend/dist is older than frontend/src. Run with --build.');

// ---- 1b. a customer release refuses what it must not ship (WP-24: DEP-003, DEP-020, QA-001) -------------------------------------------------
if (signing.problems.length) fail(`the signing set-up is not usable: ${signing.problems.join('; ')}`);
if (releaseMode) {
  const refusals = releaseSigningRefusals(signing);
  const dirtyNow = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' });
  if (dirtyNow.status === 0 && dirtyNow.stdout.trim()) refusals.push('the working tree has uncommitted changes: a release is built from a commit');
  if (!product.copyright || !product.url) refusals.push('packaging/product.json copyright and url are empty: set the distributing organisation (DEP-020)');
  if (!fs.existsSync(path.join(root, 'docs', 'EULA.txt'))) refusals.push('docs/EULA.txt is missing: the installer must show the approved licence (DEP-020; template docs/legal/EULA.template.txt)');
  if (refusals.length) fail(`--release refused:\n  - ${refusals.join('\n  - ')}`);
  log(`release build; signing ${JSON.stringify(describeSigning(signing))}`);
}

// ---- 2. the Node.js runtime ----------------------------------------------------------------------------------------------------------------
if (!fs.existsSync(nodeExe)) fail(`node.exe not found: ${nodeExe}`);
const nodeVer = capture(nodeExe, ['--version']).stdout.trim();
// WP-13 (ENT-008): the runtime is pinned in packaging/product.json (runtime.node). Same major, not older than the pin, and enough support left.
const pin = product.runtime || {};
const pinParts = String(pin.node || '').split('.').map(Number);
const verParts = nodeVer.replace(/^v/, '').split('.').map(Number);
if (pinParts.length !== 3 || pinParts.some((n) => !Number.isInteger(n))) fail('packaging/product.json runtime.node must be the pinned x.y.z Node.js version.');
if (verParts[0] !== pinParts[0]) fail(`The shipped Node.js must be ${pinParts[0]}.x (pinned ${pin.node} in packaging/product.json); ${nodeExe} is ${nodeVer}. Pass --node <path to the pinned node.exe>.`);
if (verParts[1] < pinParts[1] || (verParts[1] === pinParts[1] && verParts[2] < pinParts[2])) fail(`${nodeExe} is ${nodeVer}, older than the pinned ${pin.node} (packaging/product.json): it lacks security fixes the pin has.`);
if (verParts.join('.') !== pin.node) log(`NOTE: shipping Node.js ${nodeVer}, newer than the pin ${pin.node}; update runtime.node in packaging/product.json to record it.`);
const supportMonths = (new Date(pin.nodeEndOfLife) - new Date()) / (30.44 * 864e5);
if (!(supportMonths >= (pin.minSupportMonths ?? 12))) fail(`Node.js ${pinParts[0]} reaches end of life on ${pin.nodeEndOfLife} (${supportMonths.toFixed(1)} months): move the pin to a supported LTS line (docs/BUNDLED-COMPONENTS.md).`);
const bePkgVersion = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'package.json'), 'utf8')).version;
if (bePkgVersion !== version) fail(`backend/package.json version ${bePkgVersion} differs from package.json ${version}: the server reports the backend's (WP-13, one version).`);
const nodeArch = capture(nodeExe, ['-p', 'process.arch']).stdout.trim();
if (nodeArch !== 'x64') fail(`The shipped node.exe must be 64-bit (it is ${nodeArch}).`);
const nodeLicence = path.join(path.dirname(nodeExe), 'LICENSE');
if (!fs.existsSync(nodeLicence)) fail(`Refusing to ship node.exe without its licence: ${nodeLicence} is missing (use the official zip distribution).`);

// ---- 3. a clean stage ----------------------------------------------------------------------------------------------------------------------
log(`staging ${stageName} in ${rel(outDir) || outDir}`);
if (noArial) log('building WITHOUT the Arial fonts (--no-arial)');
else log('NOTE: the proprietary Arial font files (Arial, and Arial Narrow when it is in backend/vendor/tools/fonts) are included, as decided for this product. Whoever distributes it must hold a licence that allows redistributing them; build with --no-arial otherwise.');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
const mk = (...p) => { const d = path.join(stage, ...p); fs.mkdirSync(d, { recursive: true }); return d; };

const SKIP_DIR = new Set(['test', 'tests', '__tests__', 'docs', 'example', 'examples', 'benchmark', 'benchmarks', '.github']);
// fs.cpSync is deliberately not used: on Node 22.23 / Windows it creates a wrongly named folder (UTF-8 bytes read as Latin-1) and copies nothing
// where it should when the destination path has non-ASCII characters, e.g. a build folder under a user profile named "José".
function copyFiltered(from, to, extraSkip) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) {
      const src = path.join(from, name);
      if (extraSkip && extraSkip(src, name)) continue;
      copyFiltered(src, path.join(to, name), extraSkip);
    }
  } else fs.copyFileSync(from, to);
}

// ---- 4. the application --------------------------------------------------------------------------------------------------------------------
const be = path.join(root, 'backend');
const appBe = mk('app', 'backend');
log('copying the backend (compiled), the schemas, templates and the publishing engine');
// reference/ (S1000D data-module type evidence, the maintained SNS tables) and assets/ (the default header logo) are read at run time: the backend does not start without them
for (const d of ['dist', 'schemas', 'templates', 'templates-optional', 'brex', 'samples', 'reference', 'assets']) copyFiltered(path.join(be, d), path.join(appBe, d));
fs.copyFileSync(path.join(be, 'package.json'), path.join(appBe, 'package.json'));
mk('app', 'backend', 'scripts');
for (const s of ['doctor.js', 'reset-admin.js', 'recover-structure.js']) fs.copyFileSync(path.join(be, 'scripts', s), path.join(appBe, 'scripts', s));
// vendor: the engine, the pipelines and the tools. Not used at run time and left out: FOP's javadocs (94 MB of HTML) and its examples, two stray test
// files that were left in FOP's folder (example.fo, output.pdf), and the HTML documentation of libxslt. They also hold the longest paths in the tree.
copyFiltered(path.join(be, 'vendor'), path.join(appBe, 'vendor'), (src) => {
  const r = path.relative(path.join(be, 'vendor'), src).split(path.sep).join('/');
  return /^tools\/fop-2\.10\/javadocs(\/|$)/.test(r) || /^tools\/fop-2\.10\/fop\/(examples(\/|$)|example\.fo$|output\.pdf$)/.test(r)
    || /^tools\/libxslt-[^/]+\/share\/doc(\/|$)/.test(r) || /\.(map|log)$/.test(r) || (noArial && /^tools\/fonts\/arial[a-z]*\.ttf$/i.test(r))
    // WP-13 (DEP-021): code nothing in the product calls stays out of the install - the dormant licence check of the older product (kept in the
    // source, pinned by a test, until decision D12) and the Linux tool stubs (the product is Windows-only)
    || r === 'engine/license.js' || /^tools-linux(\/|$)/.test(r);
});

log('copying the web client');
copyFiltered(path.join(root, 'frontend', 'dist'), path.join(mk('app', 'frontend'), 'dist'), (src) => src.endsWith('.map'));

// ---- 5. production dependencies only -------------------------------------------------------------------------------------------------------
log('collecting the production dependencies of the backend');
const npm = npmCmd();
const ls = capture(npm.cmd, [...npm.pre, 'ls', '--omit=dev', '--all', '--parseable', '--prefix', be], { shell: npm.shell });
const prodDirs = ls.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && s !== be && s.startsWith(path.join(be, 'node_modules')));
if (prodDirs.length < 20) fail(`npm ls returned only ${prodDirs.length} production packages; is backend/node_modules installed (npm run install:all)?\n${ls.stderr}`);
const npmPackages = [];
for (const dir of prodDirs) {
  const dest = path.join(appBe, path.relative(be, dir));
  copyFiltered(dir, dest, (src, base) => {
    if (src === dir) return false;                                  // never skip the package itself
    const stat = fs.statSync(src);
    if (stat.isDirectory()) return SKIP_DIR.has(base) || base === 'node_modules'; // nested node_modules are listed separately by npm ls
    return /\.(map|md|markdown|ts|mts|cts)$/i.test(base) && !/^(licen[cs]e|copying|notice)/i.test(base);
  });
  const pre = path.join(dest, 'prebuilds');
  if (fs.existsSync(pre)) {
    for (const d of fs.readdirSync(pre)) if (d !== 'win32-x64') fs.rmSync(path.join(pre, d), { recursive: true, force: true });
    if (!fs.existsSync(path.join(pre, 'win32-x64'))) fail(`${path.basename(dir)} has native prebuilds but none for win32-x64`);
  }
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const lic = typeof pj.license === 'string' ? pj.license : pj.license && pj.license.type ? pj.license.type : Array.isArray(pj.licenses) ? pj.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN';
  const files = fs.readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice|unlicense)/i.test(f) && fs.statSync(path.join(dir, f)).isFile());
  npmPackages.push({ name: pj.name, version: pj.version, license: lic, homepage: pj.homepage || (pj.repository && (pj.repository.url || pj.repository)) || '', dir, files });
}
log(`  ${npmPackages.length} packages`);

// ---- 6. the runtime, the host program ------------------------------------------------------------------------------------------------------
fs.copyFileSync(nodeExe, path.join(mk('runtime'), 'node.exe'));

const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!fs.existsSync(csc)) fail(`The .NET Framework 4 C# compiler was not found at ${csc}`);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-pkg-'));
const asmInfo = path.join(work, 'AssemblyInfo.cs');
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const copyright = product.copyright || `Copyright (C) ${new Date().getFullYear()} ${product.publisher}`;
fs.writeFileSync(asmInfo, [
  'using System.Reflection;',
  `[assembly: AssemblyTitle("${q(product.name)}")]`,
  `[assembly: AssemblyDescription("${q(product.description)}")]`,
  `[assembly: AssemblyCompany("${q(product.publisher)}")]`,
  `[assembly: AssemblyCopyright("${q(copyright)}")]`,
  `[assembly: AssemblyProduct("${q(product.name)}")]`,
  `[assembly: AssemblyVersion("${version}.0")]`,
  `[assembly: AssemblyFileVersion("${version}.0")]`,
  '',
].join('\r\n'));
// every .cs file of packaging/host (AgastyaHost.cs, and WP-24's Integrity.cs and SupportBundle.cs)
const hostSrc = fs.readdirSync(path.join(root, 'packaging', 'host')).filter((f) => f.endsWith('.cs')).sort().map((f) => path.join(root, 'packaging', 'host', f));
const icon = path.join(root, 'packaging', 'assets', 'agastya.ico');
const common = ['-nologo', '-platform:x64', '-optimize+', `-win32icon:${icon}`, '-r:System.ServiceProcess.dll', '-r:System.IO.Compression.dll', '-r:System.Security.dll'];
log('compiling the host program (AgastyaPlatform.exe, AgastyaCtl.exe)');
for (const [out, extra] of [
  ['AgastyaPlatform.exe', ['-target:winexe', '-define:GUI', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll']],
  ['AgastyaCtl.exe', ['-target:exe']],
]) {
  const r = capture(csc, [...common, ...extra, `-out:${path.join(stage, out)}`, ...hostSrc, asmInfo]);
  if (r.status !== 0) fail(`csc failed for ${out}:\n${r.stdout}\n${r.stderr}`);
  const warn = (r.stdout + r.stderr).split(/\r?\n/).filter((l) => /warning CS/.test(l));
  if (warn.length) fail(`the host compiles with warnings, fix them:\n${warn.join('\n')}`);
}
fs.rmSync(work, { recursive: true, force: true });

// ---- 6b. no path may be so long that an ordinary install folder would hit Windows' 260-character limit --------------------------------------
{
  let longest = { len: 0, p: '' };
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); const r = path.relative(stage, p); if (r.length > longest.len) longest = { len: r.length, p: r }; if (e.isDirectory()) walk(p); } };
  walk(stage);
  log(`  longest path inside the product: ${longest.len} characters`);
  if (longest.len > 150) fail(`A path inside the product is ${longest.len} characters long (${longest.p}). Installed under a folder of 100+ characters it would exceed Windows' 260-character limit. Exclude it from the package.`);
}

// ---- 7. documents, licences, version -------------------------------------------------------------------------------------------------------
const docs = mk('docs');
for (const f of ['OPERATIONS.md', 'PACKAGING.md']) { const p = path.join(root, 'docs', f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(docs, f)); }
fs.copyFileSync(path.join(root, 'packaging', 'agastya.ini.template'), path.join(docs, 'agastya.ini.template'));
fs.writeFileSync(path.join(docs, 'README.txt'), [
  `${product.name} ${version}`,
  '',
  'Start it from the Start menu ("Agastya Platform"), or run AgastyaPlatform.exe. It opens in your web browser at http://localhost:4040/ (the port',
  'can be changed in agastya.ini). The first person to open it creates the administrator account; nothing ships with a default password.',
  '',
  'This program needs no internet connection and makes none.',
  '',
  'Administrators: see OPERATIONS.md (service, network access, backups, logs, upgrades) and run   AgastyaCtl.exe --doctor   to check the installation.',
  'Licences of the software included in this product: THIRD-PARTY-NOTICES.txt and the "licenses" folder.',
  '',
].join('\r\n'));

const lic = mk('licenses');
const copyLic = (from, toName) => { fs.mkdirSync(path.dirname(path.join(lic, toName)), { recursive: true }); fs.copyFileSync(from, path.join(lic, toName)); return `licenses/${toName.split(path.sep).join('/')}`; };
const safe = (s) => s.replace(/[\\/:*?"<>|@]/g, '_');
const rows = []; // { component, version, licence, files[], note }
rows.push({ component: 'Node.js', version: nodeVer, licence: 'see file', files: [copyLic(nodeLicence, 'node/LICENSE')], note: 'runtime\\node.exe' });
const fopHome = path.join(be, 'vendor', 'tools', 'fop-2.10');
rows.push({ component: 'Apache FOP', version: '2.10', licence: 'Apache-2.0', files: ['LICENSE', 'NOTICE'].map((f) => copyLic(path.join(fopHome, f), `fop/${f}`)), note: 'app\\backend\\vendor\\tools\\fop-2.10 (and the libraries in its lib folder, each under its own licence; their names are listed in fop/lib-listing.txt)' });
const fopLib = path.join(fopHome, 'fop', 'lib');
if (fs.existsSync(fopLib)) fs.writeFileSync(path.join(lic, 'fop', 'lib-listing.txt'), fs.readdirSync(fopLib).sort().join('\r\n') + '\r\n');
const jreHome = path.join(be, 'vendor', 'tools', 'jre');
const jreRelease = fs.readFileSync(path.join(jreHome, 'release'), 'utf8');
const jreVer = (jreRelease.match(/JAVA_RUNTIME_VERSION="([^"]+)"/) || jreRelease.match(/JAVA_VERSION="([^"]+)"/) || [, 'unknown'])[1];
rows.push({ component: 'Eclipse Temurin JRE (jlink image)', version: jreVer, licence: 'GPL-2.0 with Classpath Exception', files: [copyLic(path.join(jreHome, 'NOTICE'), 'jre/NOTICE')], note: 'app\\backend\\vendor\\tools\\jre; the licences of its modules are in its own "legal" folder' });
for (const f of ['LICENSE_DEJAVU', 'LICENSE_LIBERATION']) rows.push({ component: f === 'LICENSE_DEJAVU' ? 'DejaVu Sans fonts' : 'Liberation Sans fonts', version: '', licence: 'see file', files: [copyLic(path.join(be, 'vendor', 'tools', 'fonts', f), `fonts/${f}`)], note: 'app\\backend\\vendor\\tools\\fonts' });
if (!noArial) rows.push({ component: 'Arial fonts (arial.ttf, arialbd.ttf, ariali.ttf, arialbi.ttf; and arialn.ttf, arialnb.ttf, arialni.ttf, arialnbi.ttf, Arial Narrow, when present)', version: '', licence: 'proprietary (Monotype / Microsoft)', files: [], note: 'Copied from a licensed Windows installation. Not open-source software: the party distributing this product must hold a licence that allows it to redistribute these files (see app\\backend\\vendor\\tools\\fonts\\README.md). Without them the product prints in Liberation Sans, which has the same character widths.' });
else rows.push({ component: 'Arial fonts', version: '', licence: 'not included', files: [], note: 'This build was made with --no-arial; documents are set in Liberation Sans, which has the same character widths.' });
rows.push({ component: 'xsltproc.exe with libxslt 1.1.28, libxml2 2.9.3, libexslt (MIT); zlib 1.2.8 (zlib licence); libiconv 1.14 and GnuWin32 regex 2.7 (LGPL 2.1); libgcc (GPL 3.0 with the GCC Runtime Library Exception); winpthreads (MIT-style)', version: '', licence: 'see the files named below', files: [], note: 'app\\backend\\vendor\\tools\\libxslt-1.1.28-win32-x86\\bin. The LGPL libraries are separate DLL files and can be replaced by another build of the same library; their source locations are given in their licence file.' });
// licence texts the vendored third-party tools do not carry themselves (fetched from upstream and recorded with their source)
const tp = path.join(root, 'packaging', 'third-party');
if (fs.existsSync(tp)) for (const f of fs.readdirSync(tp).filter((n) => n.endsWith('.txt')).sort()) {
  const row = rows.find((r) => r.component.startsWith('xsltproc.exe with libxslt'));
  if (!row) fail('packaging/third-party holds licence texts, but the table has no row for xsltproc/libxslt to list them under - the row was renamed; fix the lookup above.');
  row.files.push(copyLic(path.join(tp, f), `third-party/${f}`));
}
for (const p of npmPackages.sort((a, b) => a.name.localeCompare(b.name))) {
  const files = p.files.map((f) => copyLic(path.join(p.dir, f), `npm/${safe(p.name)}@${p.version}/${f}`));
  rows.push({ component: p.name, version: p.version, licence: p.license, files, note: files.length ? '' : 'the package ships no licence file; the licence above is the one it declares in package.json' });
}

const notices = [];
notices.push(`${product.name} ${version} - third-party software notices`, '='.repeat(78), '',
  'This product includes the software listed below. Each component is used under its own licence; the licence texts that accompany the components',
  'are in the "licenses" folder next to this file, and are reproduced after the list. This file is generated when the product is built from the licence',
  'files in the build, not written by hand.', '');
for (const r of rows) {
  notices.push(`* ${r.component}${r.version ? ' ' + r.version : ''}`, `    licence: ${r.licence}`);
  if (r.note) notices.push(`    where:   ${r.note}`);
  if (r.files.length) notices.push(`    texts:   ${r.files.join(', ')}`);
}
notices.push('', '='.repeat(78), 'LICENCE TEXTS', '='.repeat(78));
const seen = new Set();
for (const r of rows) for (const f of r.files) {
  const text = fs.readFileSync(path.join(stage, f.split('/').join(path.sep)), 'utf8');
  const h = crypto.createHash('sha256').update(text).digest('hex');
  if (seen.has(h)) continue; seen.add(h);
  notices.push('', '-'.repeat(78), `${r.component}${r.version ? ' ' + r.version : ''}   (${f})`, '-'.repeat(78), text.replace(/\r?\n/g, '\r\n').trimEnd());
}
fs.writeFileSync(path.join(stage, 'THIRD-PARTY-NOTICES.txt'), notices.join('\r\n') + '\r\n');
log(`  notices: ${rows.length} components, ${seen.size} distinct licence texts`);

// The commit the build was made from (QA-001, WP-08): scripts/ci/readiness.mjs refuses artefacts whose commit is not the verified one, or that
// were built from a tree with uncommitted changes.
const gitOut = (...a) => { const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
const buildCommit = gitOut('rev-parse', 'HEAD') || 'unknown';
const buildDirty = gitOut('status', '--porcelain', '--untracked-files=no') !== '';
fs.writeFileSync(path.join(stage, 'version.json'), JSON.stringify({
  product: product.name, version, platform: 'win-x64', builtAt: new Date().toISOString(),
  node: nodeVer, java: jreVer, fop: '2.10', packages: npmPackages.length, commit: buildCommit, dirty: buildDirty,
}, null, 2) + '\n');

// ---- 8. signing (WP-24) -----------------------------------------------------------------------------------------------------------------------
// Every portable-executable file of the product that carries no signature yet is signed (the host executables, and the third-party files their
// vendors shipped unsigned: xsltproc.exe and its DLLs, the argon2 native module); vendor-signed files (node.exe, the JRE) keep theirs.
const signed = signing.mode !== 'none';
const peFiles = listFiles(stage).filter(isPe).map((r) => path.join(stage, ...r.split('/')));
let peStatus = await authenticode(peFiles);
if (signed) {
  const toSign = peStatus.filter((a) => a.status === 'NotSigned').map((a) => a.file);
  log(`signing ${toSign.length} of ${peFiles.length} executable files (${peFiles.length - toSign.length} already carry their vendor's signature)`);
  try { signFiles(signing, toSign, { description: product.name, log }); } catch (e) { fail(e.message); }
  peStatus = await authenticode(peFiles);
  const bad = peStatus.filter((a) => !signedIntact(a));
  if (bad.length) fail(`after signing, ${bad.length} file(s) still carry no intact signature: ${bad.slice(0, 5).map((a) => `${path.relative(stage, a.file)} ${a.status}`).join(', ')}`);
  if (releaseMode && signing.timestampUrl) {
    const own = peStatus.filter((a) => toSign.includes(a.file) && !a.timestamped);
    if (own.length) fail(`${own.length} signature(s) carry no time stamp although AGASTYA_SIGN_TIMESTAMP_URL is set: ${own.slice(0, 3).map((a) => path.basename(a.file)).join(', ')}`);
  }
} else log(`signing is not configured: the ${peStatus.filter((a) => a.status === 'NotSigned').length} unsigned executable files and the installer stay UNSIGNED (Windows SmartScreen will warn on first run)`);

// ---- 8b. the software bill of materials, from the shipped bytes (DEP-026, RES-005) -------------------------------------------------------------
const builtAt = new Date().toISOString();
const sbomBuilt = buildSbom({ stage, commit: buildCommit, builtAt, product, version, nodeVersion: nodeVer });
if (sbomBuilt.problems.length) fail(`SBOM: ${sbomBuilt.problems.join('; ')}`);
fs.writeFileSync(path.join(stage, 'SBOM.cdx.json'), JSON.stringify(sbomBuilt.bom, null, 2) + '\n');
{
  const problems = checkSbom(path.join(stage, 'SBOM.cdx.json'), { stage });
  if (problems.length) fail(`the SBOM does not check: ${problems.join('; ')}`);
  const s = sbomStats(sbomBuilt.bom);
  log(`  SBOM: ${s.components} components (${s.backendNpm} backend npm, ${s.frontendNpm} web-client npm, ${s.other} other)`);
}

// ---- 8c. the file manifest of the product, signed with the same certificate (DEP-013) ----------------------------------------------------------
const manifest = writeManifest(stage, { product: product.name, version, commit: buildCommit });
log(`  ${MANIFEST_NAME}: ${manifest.count} files`);
if (signed && signing.canSignManifest) { try { log(signDetached(signing, [manifest.file])); } catch (e) { fail(e.message); } }
else if (signed) log(`NOTE: ${MANIFEST_NAME} is not signed (AGASTYA_SIGN_CMD alone cannot sign it; set AGASTYA_SIGN_THUMBPRINT or AGASTYA_SIGN_PFX)`);

// ---- 9. the portable ZIP -------------------------------------------------------------------------------------------------------------------
const outputs = [];
if (!flag('--no-zip')) {
  log('building the portable ZIP');
  fs.writeFileSync(path.join(stage, 'portable.flag'), 'This file makes the program keep its configuration, data and logs next to itself instead of in C:\\ProgramData.\r\n');
  mk('config');
  fs.writeFileSync(path.join(stage, 'config', 'agastya.ini'), fs.readFileSync(path.join(root, 'packaging', 'agastya.ini.template'), 'utf8')
    .replace('@PORT@', String(product.defaultPort)).replace('@BIND@', 'loopback').replace('@DATADIR@', '').replace('@SERVICENAME@', product.defaultServiceName));
  fs.rmSync(zipPath, { force: true });
  const tar = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe');
  if (!fs.existsSync(tar)) fail('tar.exe (bsdtar, part of Windows 10 and later) is needed to build the ZIP.');
  run(tar, ['-a', '-c', '-f', zipPath, '-C', outDir, stageName]);
  outputs.push(zipPath);
}

// ---- 10. the installer ---------------------------------------------------------------------------------------------------------------------
if (!flag('--no-installer')) {
  const iscc = [process.env.ISCC_PATH, path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe', 'C:\\Program Files\\Inno Setup 6\\ISCC.exe'].filter(Boolean).find((p) => fs.existsSync(p));
  if (!iscc) fail('Inno Setup 6 was not found. Install it from https://jrsoftware.org/isinfo.php (or set ISCC_PATH to ISCC.exe), or run with --no-installer.');
  log(`building the installer with ${iscc}`);
  const args = ['/Q', `/DAppVersion=${version}`, `/DSourceDir=${stage}`, `/DOutputDir=${outDir}`, `/DRepoRoot=${root}`, `/DSetupIcon=${icon}`,
    `/DAppGuid=${product.appId}`, `/DAppPublisher=${product.publisher}`, `/DAppCopyright=${copyright}`, `/DAppUrl=${product.url || ''}`, `/DFirewallRule=${product.firewallRuleName}`];
  // Inno Setup signs Setup.exe and the uninstaller through the same configuration ($q is Inno's quote, $f the quoted file name); the password
  // stays in the environment, it is never on the ISCC command line
  if (signed) args.push('/DSigned=1', `/Sagastyasign=$q${process.execPath}$q $q${path.join(root, 'scripts', 'release', 'signing.mjs')}$q --sign $f`);
  args.push(path.join(root, 'packaging', 'installer', 'agastya.iss'));
  run(iscc, args);
  const setup = path.join(outDir, setupName);
  if (!fs.existsSync(setup)) fail(`The installer compiler finished but ${setupName} is not there.`);
  outputs.push(setup);
}

// ---- 11. the SBOM and the verifier beside the artefacts, checksums, their signature (WP-24) --------------------------------------------------
const sbomOut = path.join(outDir, `${stageName}-SBOM.cdx.json`);
fs.copyFileSync(path.join(stage, 'SBOM.cdx.json'), sbomOut);
const verifier = path.join(outDir, 'Verify-Release.ps1');
fs.copyFileSync(path.join(root, 'scripts', 'signing', 'Verify-Release.ps1'), verifier);
// the deployment kit's detection rule for Intune / Configuration Manager (DEP-014, ENT-014; docs/DEPLOYMENT-KIT.md)
const detect = path.join(outDir, 'Detect-AgastyaPlatform.ps1');
fs.copyFileSync(path.join(root, 'packaging', 'deploy', 'Detect-AgastyaPlatform.ps1'), detect);
outputs.push(sbomOut, verifier, detect);
for (const f of ['SHA256SUMS.txt.sig']) fs.rmSync(path.join(outDir, f), { force: true });   // never leave the signature of an older build
fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), formatSums(outDir, outputs.map((f) => path.basename(f))));
if (signed && signing.canSignManifest) { try { log(signDetached(signing, [path.join(outDir, 'SHA256SUMS.txt')])); } catch (e) { fail(e.message); } }

// the toolchain that made the build (DEP-026, reproducible-build record)
const firstLine = (cmd, args) => { try { const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true }); return (r.stdout || r.stderr || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || null; } catch { return null; } };
const toolchain = { packagerNode: process.version, shippedNode: nodeVer, csc: firstLine(csc, ['-help']), java: jreVer, signtool: signing.signtool || null, os: `${os.type()} ${os.release()}` };
fs.writeFileSync(path.join(outDir, 'BUILD-INFO.json'), JSON.stringify({
  version, commit: buildCommit, dirty: buildDirty, builtAt, node: nodeVer, release: releaseMode, signed, signing: describeSigning(signing), toolchain,
  manifest: { files: manifest.count, signed: fs.existsSync(manifest.file + '.sig') }, sbom: path.basename(sbomOut),
  outputs: outputs.map((f) => ({ file: path.basename(f), sha256: sha256(f) })),
}, null, 2) + '\n');

// ---- 12. the finished release must verify offline, the way the customer will check it -------------------------------------------------------------
const check = await verifyRelease({ release: outDir, requireSigned: releaseMode, requireTimestamp: releaseMode && !signing.allowNoTimestamp, thumbprint: signing.thumbprint || undefined });
for (const r of check.rows) if (r.status !== 'PASS' || releaseMode) log(`  verify: ${r.status} ${r.check}: ${r.detail}`);
if (!check.ok) fail('the release does not verify (scripts/release/verify-release.mjs); see the FAIL lines above');
log(`  verify-release: OK (${check.rows.filter((r) => r.status === 'PASS').length} checks passed, ${check.rows.filter((r) => r.status === 'WARN').length} warnings)`);

log('done:');
for (const f of outputs) log(`  ${path.basename(f)}   ${(fs.statSync(f).size / 1048576).toFixed(1)} MB`);
log(`  staged folder: ${stage}`);
log(`  SHA256SUMS.txt written${fs.existsSync(path.join(outDir, 'SHA256SUMS.txt.sig')) ? ' and signed' : ''}`);
if (!signed) log('NOTE: unsigned build. For distribution, sign it (AGASTYA_SIGN_THUMBPRINT or AGASTYA_SIGN_PFX) - see docs/SIGNING.md.');
