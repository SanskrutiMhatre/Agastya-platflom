// =============================================================================
// A minimal ZIP reader (stored + deflated entries, no encryption, no ZIP64).
//
// services/zip.ts only WRITES archives. An import package arrives as a zip (the Vektra plugin ships
// XML.zip and ICN.zip), so the importer needs to read one without adding a dependency.
//
// A package comes from outside the trust boundary, so the reader refuses what makes zips dangerous:
//   - path traversal ("../", absolute paths, drive letters) - entries are normalised or skipped, never trusted
//   - decompression bombs - every entry is inflated with a hard output ceiling, and the grand total is capped
//   - absurd entry counts
// =============================================================================

import zlib from 'zlib';
import type { PackageEntry } from './types';

export interface ZipLimits {
  maxEntries: number;
  /** Largest single entry, uncompressed. */
  maxEntryBytes: number;
  /** Sum of all entries, uncompressed. */
  maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 20000, maxEntryBytes: 256 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024 };

export class ZipError extends Error {}

export const isZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) && (b[3] === 0x04 || b[3] === 0x06);

/** A safe, forward-slash relative path, or null for an entry that must be ignored (directory, traversal, absolute). */
export function safeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/');
  if (!name || name.endsWith('/')) return null;
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null;
  const parts = name.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

export function readZip(buf: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): { entries: PackageEntry[]; skipped: Array<{ name: string; reason: string }> } {
  // End of central directory: scan backwards (the record may be followed by a comment of up to 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('Not a zip archive (no end-of-central-directory record).');
  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw new ZipError('ZIP64 archives are not supported.');
  if (count > limits.maxEntries) throw new ZipError(`The archive holds ${count} entries; at most ${limits.maxEntries} are accepted.`);

  const entries: PackageEntry[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  let total = 0;
  let p = dirOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('The zip central directory is damaged.');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const rawName = buf.toString(flags & 0x0800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    const name = safeEntryName(rawName);
    if (name === null) { if (!rawName.endsWith('/')) skipped.push({ name: rawName, reason: 'unsafe path' }); continue; }
    if (flags & 1) { skipped.push({ name: rawName, reason: 'encrypted' }); continue; }
    if (size > limits.maxEntryBytes) { skipped.push({ name: rawName, reason: `larger than ${limits.maxEntryBytes} bytes` }); continue; }
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError(`The archive expands to more than ${limits.maxTotalBytes} bytes; refused.`);

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError(`The zip entry ${rawName} is damaged.`);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const body = buf.subarray(dataStart, dataStart + compSize);
    let bytes: Buffer;
    if (method === 0) bytes = Buffer.from(body);
    else if (method === 8) {
      try { bytes = zlib.inflateRawSync(body, { maxOutputLength: Math.max(size, 1) + 1024 }); }
      catch (e) { throw new ZipError(`The zip entry ${rawName} could not be unpacked: ${(e as Error).message}`); }
    } else { skipped.push({ name: rawName, reason: `compression method ${method} is not supported` }); continue; }
    entries.push({ name, bytes });
  }
  return { entries, skipped };
}
