#!/usr/bin/env node
// =============================================================================
// Offline verification of a release (audit WP-24: RES-005, DEP-003, DEP-013, ENT-014). Reads files only; no network, changes nothing.
//
//   node scripts/release/verify-release.mjs [--release DIR] [--tree DIR] [--thumbprint SHA1] [--require-signed] [--require-timestamp] [--json]
//
//   --release DIR   a release folder: SHA256SUMS.txt matches every file it lists, SHA256SUMS.txt.sig is a valid signature over it, the SBOM is
//                   listed (so the signature covers it) and passes the structural check, and Authenticode on the .exe files there.
//                   Default: release/. The staged product tree inside it (Agastya-Platform-*-win-x64) is checked as --tree too.
//   --tree DIR      a product tree (staged, unzipped portable, or an installed program folder): every file of MANIFEST.sha256 present with its
//                   hash, no unlisted file outside the installation's own (config, data, logs, uninstaller), MANIFEST.sha256.sig valid, and the
//                   manifest signer the same certificate as the Authenticode signer of AgastyaCtl.exe.
//   --thumbprint    pin the signing certificate (SHA-1, as Windows shows it); otherwise any certificate is reported and the operator compares it
//                   with the thumbprint published out of band (docs/SIGNING.md).
//   --require-signed     unsigned = FAIL (a release); without it an unsigned development build is WARN.
//   --require-timestamp  an Authenticode signature without an RFC 3161 time stamp = FAIL.
//
// Exit 0 when nothing FAILs. Windows PowerShell users without Node: scripts/signing/Verify-Release.ps1 (shipped next to Setup.exe) does the same.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANIFEST_NAME, verifySignature, verifyTree, parseSums, sha256File, authenticode, signedIntact, isPe, parseManifest } from './lib.mjs';
import { checkSbom } from './sbom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Run the checks; returns { ok, rows: [{ status: PASS|WARN|FAIL, check, detail }] }. */
export async function verifyRelease({ release, tree, thumbprint, requireSigned = false, requireTimestamp = false, authenticodeCheck = process.platform === 'win32' } = {}) {
  const rows = [];
  const add = (status, check, detail) => rows.push({ status, check, detail });
  const signers = new Set();
  const sigRow = (label, file) => {
    const v = verifySignature(file, { thumbprint });
    if (v.ok) { signers.add(v.thumbprint); add('PASS', `${label} signature`, `signed by ${v.signer} (${v.thumbprint})${v.selfIssued ? ', self-issued certificate' : ''}`); }
    else if (v.unsigned && !requireSigned) add('WARN', `${label} signature`, `${v.reason}: integrity rests on the hashes alone (development build)`);
    else add('FAIL', `${label} signature`, v.reason);
  };
  const trees = [];
  if (tree) trees.push(path.resolve(tree));

  if (release) {
    const dir = path.resolve(release);
    const sums = path.join(dir, 'SHA256SUMS.txt');
    if (!fs.existsSync(sums)) add('FAIL', 'SHA256SUMS.txt', `missing in ${dir}`);
    else {
      let list = [];
      try { list = parseSums(fs.readFileSync(sums, 'utf8')); } catch (e) { add('FAIL', 'SHA256SUMS.txt', e.message); }
      const bad = [];
      for (const { sha256, file } of list) {
        const p = path.join(dir, file);
        if (!fs.existsSync(p)) bad.push(`${file} missing`); else if (sha256File(p) !== sha256) bad.push(`${file} does not match`);
      }
      add(bad.length ? 'FAIL' : 'PASS', 'release checksums', bad.join('; ') || `${list.length} file(s) match SHA256SUMS.txt`);
      sigRow('SHA256SUMS.txt', sums);
      const sbom = list.find((x) => /\.cdx\.json$/i.test(x.file));
      if (!sbom) add(requireSigned ? 'FAIL' : 'WARN', 'SBOM', 'no *.cdx.json listed in SHA256SUMS.txt');
      else {
        const problems = checkSbom(path.join(dir, sbom.file));
        add(problems.length ? 'FAIL' : 'PASS', 'SBOM', problems.join('; ') || `${sbom.file} is listed in the signed checksums and well formed`);
      }
    }
    if (!tree) for (const d of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const p = path.join(dir, d);
      if (/^Agastya-Platform-.*-win-x64$/.test(d) && fs.statSync(p).isDirectory()) trees.push(p);
    }
    if (authenticodeCheck) {
      const exes = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.exe$/i.test(n)).map((n) => path.join(dir, n)) : [];
      await authenticodeRows(exes, dir);
    }
  }

  for (const t of trees) {
    const r = verifyTree(t, { deep: true });
    if (r.error) add('FAIL', `manifest of ${path.basename(t)}`, r.error);
    else {
      const detail = [r.missing.length && `missing: ${r.missing.slice(0, 5).join(', ')}${r.missing.length > 5 ? ` (+${r.missing.length - 5})` : ''}`,
        r.changed.length && `changed: ${r.changed.slice(0, 5).join(', ')}${r.changed.length > 5 ? ` (+${r.changed.length - 5})` : ''}`,
        r.extra.length && `not in the manifest: ${r.extra.slice(0, 5).join(', ')}${r.extra.length > 5 ? ` (+${r.extra.length - 5})` : ''}`].filter(Boolean).join('; ');
      add(r.ok ? 'PASS' : 'FAIL', `manifest of ${path.basename(t)}`, detail || `${r.checked} files match ${MANIFEST_NAME} (version ${r.header.version}, commit ${String(r.header.commit).slice(0, 12)})`);
    }
    if (fs.existsSync(path.join(t, MANIFEST_NAME))) sigRow(`${MANIFEST_NAME} of ${path.basename(t)}`, path.join(t, MANIFEST_NAME));
    if (authenticodeCheck && fs.existsSync(path.join(t, MANIFEST_NAME))) {
      let pes = [];
      try { pes = parseManifest(fs.readFileSync(path.join(t, MANIFEST_NAME), 'utf8')).entries.map((e) => e.path).filter(isPe); } catch { /* reported above */ }
      await authenticodeRows(pes.map((r) => path.join(t, ...r.split('/'))), t, { ownOnly: true });
    }
  }
  if (signers.size > 1) add('FAIL', 'one signer', `the release is signed by ${signers.size} different certificates: ${[...signers].join(', ')}`);

  async function authenticodeRows(files, base, { ownOnly = false } = {}) {
    if (!files.length) return;
    let res;
    try { res = await authenticode(files); } catch (e) { add('FAIL', 'Authenticode', e.message); return; }
    const unsigned = []; const broken = []; const noTs = []; const foreign = []; let good = 0;
    for (const a of res) {
      const rel = path.relative(base, a.file).split(path.sep).join('/');
      if (a.status === 'HashMismatch') { broken.push(rel); continue; }
      if (!signedIntact(a)) { unsigned.push(rel); continue; }
      good++;
      if (!a.timestamped) noTs.push(rel);
      // the product's own executables and the installer must carry the certificate that signed the manifest / checksums; the other files may
      // keep a vendor signature (node.exe, the JRE) or carry ours (re-signed third-party files such as xsltproc.exe)
      const own = /^Agastya(Ctl|Platform)\.exe$/i.test(rel) || /Setup\.exe$/i.test(rel);
      if (signers.size && !signers.has(a.thumbprint) && (own || !ownOnly)) foreign.push(`${rel} is signed by ${a.subject} (${a.thumbprint}), not by the manifest/checksum signer`);
    }
    const where = path.basename(base);
    if (broken.length) add('FAIL', `Authenticode in ${where}`, `changed after signing (HashMismatch): ${broken.join(', ')}`);
    if (unsigned.length) add(requireSigned ? 'FAIL' : 'WARN', `Authenticode in ${where}`, `not signed: ${unsigned.slice(0, 8).join(', ')}${unsigned.length > 8 ? ` (+${unsigned.length - 8})` : ''}`);
    if (noTs.length && good) add(requireTimestamp ? 'FAIL' : 'WARN', `time stamps in ${where}`, `signed without an RFC 3161 time stamp (stops verifying when the certificate expires): ${noTs.slice(0, 5).join(', ')}${noTs.length > 5 ? ` (+${noTs.length - 5})` : ''}`);
    if (foreign.length) add('FAIL', `signer in ${where}`, foreign.slice(0, 5).join('; '));
    if (!broken.length && !unsigned.length && !foreign.length) add('PASS', `Authenticode in ${where}`, `${good} file(s) signed and intact${noTs.length ? '' : ', time-stamped'}`);
  }

  return { ok: !rows.some((r) => r.status === 'FAIL'), rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const tree = opt('--tree');
  const release = opt('--release') || (tree ? undefined : path.join(ROOT, 'release'));
  const res = await verifyRelease({ release, tree, thumbprint: opt('--thumbprint'), requireSigned: argv.includes('--require-signed'), requireTimestamp: argv.includes('--require-timestamp') });
  if (argv.includes('--json')) console.log(JSON.stringify(res, null, 2));
  else {
    for (const r of res.rows) console.log(`${r.status.padEnd(4)}  ${r.check}: ${r.detail}`);
    console.log(res.ok ? '\nverify-release: OK' : '\nverify-release: FAILED');
  }
  process.exit(res.ok ? 0 : 1);
}
