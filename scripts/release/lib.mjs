// =============================================================================
// Release integrity (audit WP-24: DEP-003, DEP-013, DEP-026, ENT-014, RES-005): the file manifest of a shipped tree and the detached signature
// format shared by the packager, the offline verifiers (scripts/release/verify-release.mjs, scripts/signing/Verify-Release.ps1) and the
// Windows host (packaging/host/Integrity.cs, `AgastyaCtl --verify`).
//
// MANIFEST.sha256 - one line per shipped file, sorted by path (ordinal), UTF-8, LF:
//     # agastya-manifest/1
//     # product: Agastya Platform
//     # version: 2.0.0
//     # commit: <git sha>
//     # files: <n>
//     <sha256 hex> <size in bytes> <path relative to the tree, forward slashes>
//   The path is the rest of the line (it may contain spaces). The manifest never lists itself, its signature, or the files that belong to the
//   running installation rather than to the release (RUNTIME_OWNED below).
//
// <file>.sig - a detached signature over the exact bytes of <file>, "key: value" lines so that PowerShell 5.1 and C# 5 read it without a
// JSON library:
//     format: agastya-detached-signature/1
//     algorithm: RSA-PKCS1-SHA256 | ECDSA-P1363-SHA256
//     signed-file: MANIFEST.sha256
//     signed-sha256: <hex of the signed bytes>
//     signer: <certificate subject>
//     thumbprint: <SHA-1 of the certificate, upper-case hex, as Windows shows it>
//     certificate: <base64 DER of the signing certificate>
//     signature: <base64>
//   It is made with the same certificate that Authenticode-signs the executables (scripts/signing/Sign-Manifest.ps1), so "the manifest signer
//   is the signer of AgastyaCtl.exe" can be checked offline with no other key. Which certificate to trust is decided out of band: a pinned
//   thumbprint (--thumbprint) or the Windows chain (an internal root pushed by policy, docs/SIGNING.md).
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_NAME = 'MANIFEST.sha256';
export const SIG_SUFFIX = '.sig';
export const MANIFEST_FORMAT = 'agastya-manifest/1';
export const SIG_FORMAT = 'agastya-detached-signature/1';

/** Files and folders in an installed or portable tree that the installation itself writes; they are never in the manifest and never "extra". */
export const RUNTIME_OWNED = [
  /^MANIFEST\.sha256(\.sig)?$/,
  /^portable\.flag$/, /^state\.dir$/, /^config\//, /^data\//, /^logs\//,
  /^unins\d{3}\.(exe|dat|msg)$/i,            // the Inno Setup uninstaller, written at install time (signed by Inno with SignedUninstaller=yes)
];
export const isRuntimeOwned = (rel) => RUNTIME_OWNED.some((re) => re.test(rel));

export const sha256File = (file) => {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
};
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Every file under dir as a relative forward-slash path, sorted ordinally. */
export function listFiles(dir) {
  const out = [];
  const walk = (d, pre) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = pre ? `${pre}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else if (e.isFile()) out.push(rel);
    }
  };
  walk(dir, '');
  return out.sort(ordinal);
}
export const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The manifest text of a tree. `meta` = { product, version, commit }. */
export function buildManifest(dir, meta = {}) {
  const files = listFiles(dir).filter((rel) => !isRuntimeOwned(rel));
  const lines = [`# ${MANIFEST_FORMAT}`, `# product: ${meta.product ?? ''}`, `# version: ${meta.version ?? ''}`, `# commit: ${meta.commit ?? ''}`, `# files: ${files.length}`];
  for (const rel of files) {
    if (/[\r\n]/.test(rel)) throw new Error(`a file name contains a line break: ${JSON.stringify(rel)}`);
    const p = path.join(dir, ...rel.split('/'));
    lines.push(`${sha256File(p)} ${fs.statSync(p).size} ${rel}`);
  }
  return lines.join('\n') + '\n';
}

export function writeManifest(dir, meta) {
  const text = buildManifest(dir, meta);
  fs.writeFileSync(path.join(dir, MANIFEST_NAME), text);
  return { file: path.join(dir, MANIFEST_NAME), count: Number(/^# files: (\d+)$/m.exec(text)[1]) };
}

export function parseManifest(text) {
  const header = {}; const entries = [];
  const lines = text.split('\n');
  if (lines[0] !== `# ${MANIFEST_FORMAT}`) throw new Error(`not an ${MANIFEST_FORMAT} manifest`);
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('# ')) { const m = /^# ([a-z]+): ?(.*)$/.exec(line); if (m) header[m[1]] = m[2]; continue; }
    const m = /^([0-9a-f]{64}) (\d+) (.+)$/.exec(line);
    if (!m) throw new Error(`malformed manifest line: ${line.slice(0, 120)}`);
    entries.push({ sha256: m[1], size: Number(m[2]), path: m[3] });
  }
  if (header.files !== undefined && Number(header.files) !== entries.length) throw new Error(`the manifest says ${header.files} files but lists ${entries.length}`);
  return { header, entries };
}

/**
 * Compare a tree with its manifest. deep = hash every file; otherwise size only, plus the hash of `alwaysHash` paths (regexes).
 * Returns { ok, checked, missing[], changed[], extra[] }.
 */
export function verifyTree(dir, { deep = true, alwaysHash = [] } = {}) {
  const mf = path.join(dir, MANIFEST_NAME);
  if (!fs.existsSync(mf)) return { ok: false, error: `${MANIFEST_NAME} is missing`, checked: 0, missing: [], changed: [], extra: [] };
  const { header, entries } = parseManifest(fs.readFileSync(mf, 'utf8'));
  const listed = new Set(entries.map((e) => e.path));
  const missing = []; const changed = [];
  for (const e of entries) {
    const p = path.join(dir, ...e.path.split('/'));
    let st; try { st = fs.statSync(p); } catch { missing.push(e.path); continue; }
    if (st.size !== e.size) { changed.push(e.path); continue; }
    if (deep || alwaysHash.some((re) => re.test(e.path))) if (sha256File(p) !== e.sha256) changed.push(e.path);
  }
  const extra = listFiles(dir).filter((rel) => !listed.has(rel) && !isRuntimeOwned(rel));
  return { ok: !missing.length && !changed.length && !extra.length, header, checked: entries.length, missing, changed, extra };
}

// ---- detached signatures ------------------------------------------------------------------------------------------------------------------

export function parseSignature(text) {
  const o = {};
  for (const line of text.split(/\r?\n/)) { const m = /^([a-z0-9-]+):\s?(.*)$/.exec(line); if (m) o[m[1]] = m[2].trim(); }
  if (o.format !== SIG_FORMAT) throw new Error(`not an ${SIG_FORMAT} signature file`);
  for (const k of ['algorithm', 'signed-file', 'signed-sha256', 'thumbprint', 'certificate', 'signature']) if (!o[k]) throw new Error(`the signature file has no "${k}"`);
  return o;
}

export function formatSignature({ algorithm, signedFile, signedSha256, signer, thumbprint, certificate, signature }) {
  return [`format: ${SIG_FORMAT}`, `algorithm: ${algorithm}`, `signed-file: ${signedFile}`, `signed-sha256: ${signedSha256}`, `signer: ${signer}`,
    `thumbprint: ${thumbprint}`, `certificate: ${certificate}`, `signature: ${signature}`, ''].join('\n');
}

/** SHA-1 thumbprint (upper-case hex) of a DER certificate, the way Windows shows it. */
export const thumbprintOf = (der) => crypto.createHash('sha1').update(der).digest('hex').toUpperCase();

/**
 * Verify `<file>.sig` against `<file>`. Returns { ok, reason?, signer, thumbprint, notAfter, selfIssued }.
 * The signature proves the bytes were signed by the holder of the embedded certificate's key. Whether that certificate is the right one is the
 * caller's decision: pass `thumbprint` to pin it (the verifiers also compare it with the Authenticode signer of the executables).
 */
export function verifySignature(file, { thumbprint } = {}) {
  const sigFile = file + SIG_SUFFIX;
  if (!fs.existsSync(sigFile)) return { ok: false, reason: `${path.basename(sigFile)} is missing (the file is not signed)`, unsigned: true };
  let s;
  try { s = parseSignature(fs.readFileSync(sigFile, 'utf8')); } catch (e) { return { ok: false, reason: e.message }; }
  const data = fs.readFileSync(file);
  const der = Buffer.from(s.certificate, 'base64');
  let cert;
  try { cert = new crypto.X509Certificate(der); } catch (e) { return { ok: false, reason: `the embedded certificate cannot be read: ${e.message}` }; }
  const tp = thumbprintOf(der);
  const out = { signer: cert.subject.replace(/\n/g, ', '), thumbprint: tp, notAfter: cert.validTo, selfIssued: cert.issuer === cert.subject };
  if (path.basename(file) !== s['signed-file']) return { ...out, ok: false, reason: `the signature is for ${s['signed-file']}, not ${path.basename(file)}` };
  if (tp !== s.thumbprint.toUpperCase()) return { ...out, ok: false, reason: 'the thumbprint line does not match the embedded certificate' };
  if (sha256(data) !== s['signed-sha256'].toLowerCase()) return { ...out, ok: false, reason: `${path.basename(file)} was changed after it was signed (SHA-256 differs)` };
  let good = false;
  try {
    const sig = Buffer.from(s.signature, 'base64');
    if (s.algorithm === 'RSA-PKCS1-SHA256') good = crypto.verify('sha256', data, { key: cert.publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, sig);
    else if (s.algorithm === 'ECDSA-P1363-SHA256') good = crypto.verify('sha256', data, { key: cert.publicKey, dsaEncoding: 'ieee-p1363' }, sig);
    else return { ...out, ok: false, reason: `unknown algorithm ${s.algorithm}` };
  } catch (e) { return { ...out, ok: false, reason: `the signature cannot be checked: ${e.message}` }; }
  if (!good) return { ...out, ok: false, reason: 'the signature does not match (the file or the signature was altered)' };
  if (thumbprint && tp !== thumbprint.replace(/\s/g, '').toUpperCase()) return { ...out, ok: false, reason: `signed by ${tp}, expected ${thumbprint.toUpperCase()}` };
  return { ...out, ok: true };
}

// ---- SHA256SUMS.txt ------------------------------------------------------------------------------------------------------------------------

export function parseSums(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line);
    if (!m) throw new Error(`malformed SHA256SUMS line: ${line.slice(0, 120)}`);
    out.push({ sha256: m[1].toLowerCase(), file: m[2] });
  }
  return out;
}
export const formatSums = (dir, files) => files.map((f) => `${sha256File(path.join(dir, f))} *${f}`).join('\n') + '\n';

// ---- Authenticode (Windows) ------------------------------------------------------------------------------------------------------------------

/**
 * Authenticode status of files, one PowerShell call: [{ file, status, thumbprint, subject, timestamped }]. Windows PowerShell 5.1 is part of
 * every supported Windows; Get-AuthenticodeSignature works offline (it reports an untrusted root as UnknownError/NotTrusted, not as invalid).
 */
export async function authenticode(files) {
  if (process.platform !== 'win32' || !files.length) return [];
  const { spawnSync } = await import('node:child_process');
  const list = path.join(fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'agastya-ac-')), 'files.txt');
  fs.writeFileSync(list, files.join('\n'), 'utf8');
  const script = `$ErrorActionPreference='Stop'; Get-Content -LiteralPath '${list.replace(/'/g, "''")}' -Encoding UTF8 | ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_; ` +
    `$c = $s.SignerCertificate; '{0}|{1}|{2}|{3}|{4}' -f $_, $s.Status, $(if ($c) { $c.Thumbprint } else { '' }), $(if ($s.TimeStamperCertificate) { '1' } else { '0' }), $(if ($c) { $c.Subject } else { '' }) }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', maxBuffer: 64 << 20 });
  fs.rmSync(path.dirname(list), { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`Get-AuthenticodeSignature failed: ${r.stderr.trim().slice(0, 400)}`);
  return r.stdout.split(/\r?\n/).filter(Boolean).map((l) => {
    const [file, status, thumbprint, ts, ...subject] = l.split('|');
    return { file, status, thumbprint, timestamped: ts === '1', subject: subject.join('|') };
  });
}

/** True when Windows reports the file as signed and intact (Valid, or intact but chained to a root this PC does not trust). */
export const signedIntact = (a) => a && a.status !== 'NotSigned' && a.status !== 'HashMismatch' && a.status !== 'NotSupportedFileFormat' && !!a.thumbprint;

/** Portable-executable files of a tree that Authenticode applies to. */
export const isPe = (rel) => /\.(exe|dll|node)$/i.test(rel);
