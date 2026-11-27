#!/usr/bin/env node
// =============================================================================
// The offline update package (audit WP-25: DEP-023, QA-009; format read by packaging/host/Update.cs).
//
//   node scripts/release/update-package.mjs --stage <product tree> --out <file.agupdate> [--min-from 2.0.0] [--notes "..."]
//        signs update-info.txt with the release certificate when AGASTYA_SIGN_THUMBPRINT / AGASTYA_SIGN_PFX is set (scripts/release/signing.mjs)
//
// The package is a ZIP (no compression library needed on the customer side: .NET's ZipArchive reads it):
//   update-info.txt       format: agastya-update/1, product, app-id, version, min-from-version, commit, built-at, manifest-sha256, files, bytes
//   update-info.txt.sig   detached signature over update-info.txt (agastya-detached-signature/1, lib.mjs) - absent in an unsigned build
//   payload/<path>        every file listed in the tree's MANIFEST.sha256, plus MANIFEST.sha256 and its .sig
// update-info.txt names the SHA-256 of the payload manifest, so one signature covers every file. The installed AgastyaCtl.exe accepts the
// package only when that signature holds and its signer signed the installed program (or is listed in [update] TrustedThumbprints).
// =============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MANIFEST_NAME, SIG_SUFFIX, parseManifest, sha256 } from './lib.mjs';
import { signingConfig, signDetached } from './signing.mjs';

export const UPDATE_FORMAT = 'agastya-update/1';
export const INFO_NAME = 'update-info.txt';

// ---- a small ZIP writer (stored or deflated entries, UTF-8 names, fixed time stamps so the same tree gives the same bytes) ------------------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0; let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const DOS_TIME = 0; const DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1;   // 2026-01-01 00:00 for every entry

export function writeZip(out, entries) {
  // entries: [{ name, file } | { name, data }]
  const fd = fs.openSync(out, 'w');
  const central = []; let offset = 0;
  const write = (b) => { fs.writeSync(fd, b); offset += b.length; };
  try {
    for (const e of entries) {
      const data = e.data ?? fs.readFileSync(e.file);
      const name = Buffer.from(e.name, 'utf8');
      const crc = crc32(data);
      const deflated = data.length > 64 ? zlib.deflateRawSync(data, { level: 6 }) : null;
      const store = !deflated || deflated.length >= data.length;
      const body = store ? data : deflated;
      if (offset + body.length + 30 + name.length > 0xfffffff0 || data.length > 0xfffffff0) throw new Error('the update package would exceed 4 GB (ZIP64 is not written)');
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(store ? 0 : 8, 8);
      h.writeUInt16LE(DOS_TIME, 10); h.writeUInt16LE(DOS_DATE, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22);
      h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
      central.push({ name, crc, csize: body.length, usize: data.length, method: store ? 0 : 8, offset });
      write(h); write(name); write(body);
    }
    const cdStart = offset;
    for (const c of central) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(DOS_TIME, 12); h.writeUInt16LE(DOS_DATE, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.usize, 24);
      h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(c.offset, 42);
      write(h); write(c.name);
    }
    if (central.length > 0xffff) throw new Error('too many files for a ZIP without ZIP64');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
    write(end);
  } finally { fs.closeSync(fd); }
}

/** The update-info.txt text. */
export function formatInfo(o) {
  return [`format: ${UPDATE_FORMAT}`, `product: ${o.product}`, `app-id: ${o.appId ?? ''}`, `version: ${o.version}`, `min-from-version: ${o.minFromVersion}`,
    `commit: ${o.commit ?? ''}`, `built-at: ${o.builtAt ?? ''}`, `manifest-sha256: ${o.manifestSha256}`, `files: ${o.files}`, `bytes: ${o.bytes}`,
    ...(o.notes ? [`notes: ${String(o.notes).replace(/[\r\n]+/g, ' ')}`] : []), ''].join('\n');
}

/**
 * Build `out` from the product tree `stage` (which must carry MANIFEST.sha256; its .sig when the release is signed).
 * `signing` = signingConfig() or null; when it can sign, update-info.txt gets its detached signature. Returns { out, info, signed }.
 */
export function buildUpdatePackage({ stage, out, minFromVersion = '2.0.0', notes = '', signing = null, product = 'Agastya Platform', appId = '' }) {
  const mfFile = path.join(stage, MANIFEST_NAME);
  if (!fs.existsSync(mfFile)) throw new Error(`${mfFile} is missing: the update payload is defined by the product's manifest`);
  const mfBytes = fs.readFileSync(mfFile);
  const { header, entries } = parseManifest(mfBytes.toString('utf8'));
  const version = header.version;
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error(`the manifest's version "${version}" is not x.y.z`);
  if (!/^\d+\.\d+\.\d+$/.test(minFromVersion)) throw new Error(`--min-from "${minFromVersion}" is not x.y.z`);
  const bytes = entries.reduce((n, e) => n + e.size, 0);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-update-'));
  try {
    const infoFile = path.join(work, INFO_NAME);
    const info = { product, appId, version, minFromVersion, commit: header.commit, builtAt: new Date().toISOString(), manifestSha256: sha256(mfBytes), files: entries.length, bytes, notes };
    fs.writeFileSync(infoFile, formatInfo(info));
    let signed = false;
    if (signing && signing.canSignManifest) { signDetached(signing, [infoFile]); signed = fs.existsSync(infoFile + SIG_SUFFIX); }
    const zipEntries = [{ name: INFO_NAME, file: infoFile }];
    if (signed) zipEntries.push({ name: INFO_NAME + SIG_SUFFIX, file: infoFile + SIG_SUFFIX });
    zipEntries.push({ name: `payload/${MANIFEST_NAME}`, data: mfBytes });
    if (fs.existsSync(mfFile + SIG_SUFFIX)) zipEntries.push({ name: `payload/${MANIFEST_NAME}${SIG_SUFFIX}`, file: mfFile + SIG_SUFFIX });
    for (const e of entries) zipEntries.push({ name: `payload/${e.path}`, file: path.join(stage, ...e.path.split('/')) });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    const partial = out + '.partial';
    writeZip(partial, zipEntries);
    fs.renameSync(partial, out);
    return { out, info, signed };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

// ---- command line -----------------------------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const stage = opt('--stage'); const out = opt('--out');
  if (!stage || !out) { console.error('Usage: node scripts/release/update-package.mjs --stage <product tree> --out <file.agupdate> [--min-from x.y.z] [--notes "..."]'); process.exit(2); }
  const signing = signingConfig();
  if (signing.problems.length) { console.error(`signing set-up: ${signing.problems.join('; ')}`); process.exit(1); }
  let appId = '';
  try { appId = JSON.parse(fs.readFileSync(path.join(stage, 'version.json'), 'utf8')).appId || ''; } catch { /* a tree without version.json */ }
  try {
    const r = buildUpdatePackage({ stage: path.resolve(stage), out: path.resolve(out), minFromVersion: opt('--min-from') || '2.0.0', notes: opt('--notes') || '', signing, appId });
    console.log(`${r.out}: version ${r.info.version}, ${r.info.files} files, ${(r.info.bytes / 1048576).toFixed(1)} MB, ${r.signed ? 'signed' : 'UNSIGNED'}`);
  } catch (e) { console.error(`FAILED: ${e.message}`); process.exit(1); }
}
