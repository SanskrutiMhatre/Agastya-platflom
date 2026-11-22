// =============================================================================
// ZIP reading and writing - offline, no dependency, ZIP64-capable, streaming.
//
//   ZipFileReader   opens a ZIP on disk (random access through a file descriptor, so a 2 GB archive is never loaded into memory),
//                   reads the central directory (ZIP64 EOCD / extra fields included) and streams one entry at a time.
//   safeEntryName   the one place that decides whether an entry name may be written inside a directory (ZIP Slip, absolute paths,
//                   drive letters, NUL, backslash tricks, "..").
//   ZipStreamWriter writes a ZIP to a Writable with back-pressure: files are streamed (deflate, data descriptor), the central
//                   directory switches to ZIP64 records when a size/offset/count needs it.
//
// Limits are explicit (ExtractLimits) so an upload cannot become a zip bomb: entry count, total and per-entry uncompressed size,
// and a compression-ratio ceiling. Encrypted entries and unsupported methods are refused, never skipped silently.
// =============================================================================

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Readable, Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';

const SIG_LOCAL = 0x04034b50, SIG_CEN = 0x02014b50, SIG_EOCD = 0x06054b50, SIG_EOCD64 = 0x06064b50, SIG_LOC64 = 0x07064b50, SIG_DESC = 0x08074b50;
const U32 = 0xffffffff, U16 = 0xffff;

export class ZipError extends Error { constructor(message: string, public code: string) { super(message); } }

export interface ZipEntry {
  name: string; method: number; flags: number; crc32: number; compressedSize: number; size: number; localOffset: number; isDirectory: boolean; mtime: Date;
}
export interface ExtractLimits { maxEntries: number; maxTotalBytes: number; maxEntryBytes: number; maxRatio: number }
export const DEFAULT_LIMITS: ExtractLimits = { maxEntries: 100_000, maxTotalBytes: 8 * 1024 ** 3, maxEntryBytes: 4 * 1024 ** 3, maxRatio: 1000 };

/** A name that may be created inside a target directory, or a reason it may not. Returns the normalised relative POSIX path. */
export function safeEntryName(raw: string): string {
  if (typeof raw !== 'string' || !raw.length) throw new ZipError('Empty entry name.', 'UNSAFE_NAME');
  if (raw.includes('\0')) throw new ZipError(`Entry name contains a NUL byte.`, 'UNSAFE_NAME');
  const n = raw.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.startsWith('//')) throw new ZipError(`Absolute entry name refused: ${JSON.stringify(raw)}.`, 'UNSAFE_NAME');
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length) throw new ZipError('Entry name is empty after normalisation.', 'UNSAFE_NAME');
  if (parts.some((p) => p === '..')) throw new ZipError(`Entry name escapes the target directory (ZIP Slip): ${JSON.stringify(raw)}.`, 'UNSAFE_NAME');
  return parts.join('/');
}

/** Absolute destination for an entry, proven to lie inside `root` (also after the filesystem resolves it). */
export function safeJoin(root: string, entryName: string): string {
  const rel = safeEntryName(entryName);
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new ZipError(`Entry resolves outside the target directory: ${JSON.stringify(entryName)}.`, 'UNSAFE_NAME');
  return abs;
}

const readU64 = (b: Buffer, o: number): number => {
  const v = b.readBigUInt64LE(o);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('A ZIP64 value is beyond what this server can address.', 'TOO_LARGE');
  return Number(v);
};

function dosToDate(time: number, date: number): Date {
  return new Date(((date >> 9) & 0x7f) + 1980, Math.max(0, ((date >> 5) & 0xf) - 1), (date & 0x1f) || 1, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
}

export class ZipFileReader {
  private fd: number; entries: ZipEntry[] = []; size: number;
  private constructor(public file: string) { this.fd = fs.openSync(file, 'r'); this.size = fs.fstatSync(this.fd).size; }

  static open(file: string, limits: ExtractLimits = DEFAULT_LIMITS): ZipFileReader {
    const r = new ZipFileReader(file);
    try { r.readDirectory(limits); } catch (e) { r.close(); throw e; }
    return r;
  }
  close(): void { try { fs.closeSync(this.fd); } catch { /* already closed */ } }

  private read(pos: number, len: number): Buffer {
    const b = Buffer.alloc(len); const n = fs.readSync(this.fd, b, 0, len, pos);
    if (n !== len) throw new ZipError('The ZIP file is truncated.', 'BAD_ZIP');
    return b;
  }

  private readDirectory(limits: ExtractLimits): void {
    if (this.size < 22) throw new ZipError('Not a ZIP file (too small).', 'BAD_ZIP');
    const tailLen = Math.min(this.size, 22 + U16);
    const tail = this.read(this.size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === SIG_EOCD) { e = i; break; }
    if (e < 0) throw new ZipError('Not a ZIP file (no end-of-central-directory record).', 'BAD_ZIP');
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    const eocdPos = this.size - tailLen + e;
    if (count === U16 || cdSize === U32 || cdOff === U32) {
      if (eocdPos < 20) throw new ZipError('ZIP64 locator missing.', 'BAD_ZIP');
      const loc = this.read(eocdPos - 20, 20);
      if (loc.readUInt32LE(0) !== SIG_LOC64) throw new ZipError('ZIP64 locator missing.', 'BAD_ZIP');
      const z64Pos = readU64(loc, 8);
      const z = this.read(z64Pos, 56);
      if (z.readUInt32LE(0) !== SIG_EOCD64) throw new ZipError('ZIP64 end record missing.', 'BAD_ZIP');
      count = readU64(z, 32); cdSize = readU64(z, 40); cdOff = readU64(z, 48);
    }
    if (count > limits.maxEntries) throw new ZipError(`The archive has ${count} entries; the limit is ${limits.maxEntries}.`, 'LIMIT');
    if (cdSize > 512 * 1024 * 1024 || cdOff + cdSize > this.size) throw new ZipError('Central directory is inconsistent with the file size.', 'BAD_ZIP');
    const cd = this.read(cdOff, cdSize);
    let p = 0; let total = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CEN) throw new ZipError('Corrupt central directory.', 'BAD_ZIP');
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), t = cd.readUInt16LE(p + 12), d = cd.readUInt16LE(p + 14);
      const crc32 = cd.readUInt32LE(p + 16); let csize = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32); let off = cd.readUInt32LE(p + 42);
      const name = cd.toString((flags & 0x800) ? 'utf8' : 'latin1', p + 46, p + 46 + nl);
      const extra = cd.subarray(p + 46 + nl, p + 46 + nl + xl);
      for (let x = 0; x + 4 <= extra.length;) {
        const id = extra.readUInt16LE(x), len = extra.readUInt16LE(x + 2);
        if (id === 1) { let q = x + 4; if (size === U32) { size = readU64(extra, q); q += 8; } if (csize === U32) { csize = readU64(extra, q); q += 8; } if (off === U32) off = readU64(extra, q); }
        x += 4 + len;
      }
      total += size;
      if (size > limits.maxEntryBytes) throw new ZipError(`Entry ${JSON.stringify(name)} is ${size} bytes; the per-file limit is ${limits.maxEntryBytes}.`, 'LIMIT');
      if (total > limits.maxTotalBytes) throw new ZipError(`The archive would expand beyond ${limits.maxTotalBytes} bytes.`, 'LIMIT');
      if (csize > 0 && size / csize > limits.maxRatio && size > 1024 * 1024) throw new ZipError(`Entry ${JSON.stringify(name)} has a compression ratio above ${limits.maxRatio}:1 (possible zip bomb).`, 'LIMIT');
      this.entries.push({ name, method, flags, crc32, compressedSize: csize, size, localOffset: off, isDirectory: /\/$/.test(name) || /\\$/.test(name), mtime: dosToDate(t, d) });
      p += 46 + nl + xl + cl;
    }
  }

  /** The entry's bytes, decompressed as a stream, with size and CRC checked at the end. */
  open(entry: ZipEntry): Readable {
    if (entry.flags & 1) throw new ZipError(`Entry ${JSON.stringify(entry.name)} is encrypted; encrypted archives are not supported.`, 'UNSUPPORTED');
    if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`Entry ${JSON.stringify(entry.name)} uses compression method ${entry.method}, which is not supported (only stored and deflate).`, 'UNSUPPORTED');
    const lh = this.read(entry.localOffset, 30);
    if (lh.readUInt32LE(0) !== SIG_LOCAL) throw new ZipError('Corrupt local header.', 'BAD_ZIP');
    const start = entry.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const raw = fs.createReadStream(this.file, { start, end: start + Math.max(entry.compressedSize, 1) - 1, highWaterMark: 256 * 1024 });
    const source: Readable = entry.compressedSize === 0 ? Readable.from([]) : raw;
    let seen = 0; let crc = 0;
    const check = new Transform({
      transform(chunk, _e, cb) {
        seen += chunk.length; crc = zlib.crc32(chunk, crc);
        if (seen > entry.size) return cb(new ZipError(`Entry ${JSON.stringify(entry.name)} is larger than its header says (zip bomb or corrupt).`, 'BAD_ZIP'));
        cb(null, chunk);
      },
      flush(cb) {
        if (seen !== entry.size) return cb(new ZipError(`Entry ${JSON.stringify(entry.name)} is shorter than its header says.`, 'BAD_ZIP'));
        if ((crc >>> 0) !== (entry.crc32 >>> 0)) return cb(new ZipError(`Entry ${JSON.stringify(entry.name)} failed its CRC-32 check.`, 'BAD_ZIP'));
        cb();
      },
    });
    const body = entry.method === 8 ? source.pipe(zlib.createInflateRaw()) : source;
    source.on('error', (e) => body.destroy(e));
    if (body !== source) body.on('error', (e) => { source.destroy(); check.destroy(e); });       // a corrupt deflate stream must not leave the file open
    check.on('close', () => { if (!source.destroyed) source.destroy(); });
    return body.pipe(check);
  }

  async readBuffer(entry: ZipEntry): Promise<Buffer> {
    const chunks: Buffer[] = [];
    await pipeline(this.open(entry), new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } }));
    return Buffer.concat(chunks);
  }

  /** Extract everything under `root`, refusing unsafe names. Existing files are NOT overwritten unless `overwrite`. Returns the written relative names. */
  async extractTo(root: string, opts: { overwrite?: boolean; filter?: (e: ZipEntry) => boolean } = {}): Promise<string[]> {
    const written: string[] = []; const seen = new Set<string>();
    for (const e of this.entries) {
      const rel = safeEntryName(e.name);
      if (opts.filter && !opts.filter(e)) continue;
      const key = rel.toLowerCase();
      if (seen.has(key)) throw new ZipError(`Duplicate entry name ${JSON.stringify(rel)} in the archive.`, 'UNSAFE_NAME');
      seen.add(key);
      const abs = safeJoin(root, rel);
      if (e.isDirectory) { fs.mkdirSync(abs, { recursive: true }); continue; }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (!opts.overwrite && fs.existsSync(abs)) throw new ZipError(`${rel} already exists.`, 'EXISTS');
      await pipeline(this.open(e), fs.createWriteStream(abs, { flags: opts.overwrite ? 'w' : 'wx' }));
      written.push(rel);
    }
    return written;
  }
}

// ── Writer ───────────────────────────────────────────────────────────────────

const w16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const w32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const w64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
function dosOf(d: Date) { return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }

interface CenRec { name: Buffer; method: number; time: number; date: number; crc: number; csize: number; size: number; offset: number }

export class ZipStreamWriter {
  private offset = 0; private cen: CenRec[] = [];
  /** `forceZip64` writes ZIP64 structures even for small entries (used by tests and by callers that already know a part is huge). */
  private failure: Error | null = null;
  constructor(private out: Writable, private opts: { forceZip64?: boolean } = {}) { out.on('error', (e) => { this.failure = e; }); }

  private async put(b: Buffer): Promise<void> {
    this.offset += b.length;
    if (this.failure) throw this.failure;
    if (!this.out.write(b)) await new Promise<void>((res, rej) => { const ok = () => { this.out.off('error', fail); res(); }; const fail = (e: Error) => { this.out.off('drain', ok); rej(e); }; this.out.once('drain', ok); this.out.once('error', fail); });
  }

  /** Add a file from disk, streamed: never held in memory. */
  async addFile(name: string, abs: string, opts: { store?: boolean } = {}): Promise<void> {
    const st = fs.statSync(abs);
    await this.addStream(name, fs.createReadStream(abs, { highWaterMark: 256 * 1024 }), st.size, st.mtime, opts.store);
  }

  async addBuffer(name: string, data: Buffer, mtime = new Date()): Promise<void> { await this.addStream(name, Readable.from([data]), data.length, mtime); }

  private async addStream(rawName: string, src: Readable, knownSize: number, mtime: Date, store?: boolean): Promise<void> {
    const name = Buffer.from(safeEntryName(rawName), 'utf8');
    const method = store || knownSize === 0 ? 0 : 8;
    const big = this.opts.forceZip64 || knownSize >= 0xf0000000 || this.offset >= 0xf0000000;
    const { time, date } = dosOf(mtime);
    const offset = this.offset;
    const extra = big ? Buffer.concat([w16(1), w16(16), w64(0), w64(0)]) : Buffer.alloc(0);
    await this.put(Buffer.concat([w32(SIG_LOCAL), w16(big ? 45 : 20), w16(0x0808), w16(method), w16(time), w16(date), w32(0), w32(big ? U32 : 0), w32(big ? U32 : 0), w16(name.length), w16(extra.length), name, extra]));
    let crc = 0, size = 0, csize = 0;
    const meter = new Transform({ transform(c, _e, cb) { crc = zlib.crc32(c, crc); size += c.length; cb(null, c); } });
    const counter = new Transform({ transform(c, _e, cb) { csize += c.length; cb(null, c); } });
    const sink = new Writable({ write: (c, _e, cb) => { this.put(c).then(() => cb(), cb); } });
    await pipeline(src, meter, ...(method === 8 ? [zlib.createDeflateRaw({ level: 6 })] : []), counter, sink);
    await this.put(big ? Buffer.concat([w32(SIG_DESC), w32(crc), w64(csize), w64(size)]) : Buffer.concat([w32(SIG_DESC), w32(crc), w32(csize), w32(size)]));
    this.cen.push({ name, method, time, date, crc, csize, size, offset });
  }

  async finish(): Promise<void> {
    const cdStart = this.offset; let cdSize = 0;
    for (const r of this.cen) {
      const needs = this.opts.forceZip64 || r.size >= U32 || r.csize >= U32 || r.offset >= U32;
      const z = needs ? Buffer.concat([w16(1), w16(24), w64(r.size), w64(r.csize), w64(r.offset)]) : Buffer.alloc(0);
      const rec = Buffer.concat([w32(SIG_CEN), w16(needs ? 45 : 20), w16(needs ? 45 : 20), w16(0x0808), w16(r.method), w16(r.time), w16(r.date), w32(r.crc),
        w32(needs ? U32 : r.csize), w32(needs ? U32 : r.size), w16(r.name.length), w16(z.length), w16(0), w16(0), w16(0), w32(0), w32(needs ? U32 : r.offset), r.name, z]);
      cdSize += rec.length; await this.put(rec);
    }
    const n = this.cen.length; const z64 = this.opts.forceZip64 || n >= U16 || cdSize >= U32 || cdStart >= U32;
    if (z64) {
      const z64Pos = this.offset;
      await this.put(Buffer.concat([w32(SIG_EOCD64), w64(44), w16(45), w16(45), w32(0), w32(0), w64(n), w64(n), w64(cdSize), w64(cdStart)]));
      await this.put(Buffer.concat([w32(SIG_LOC64), w32(0), w64(z64Pos), w32(1)]));
    }
    await this.put(Buffer.concat([w32(SIG_EOCD), w16(0), w16(0), w16(z64 ? U16 : n), w16(z64 ? U16 : n), w32(z64 ? U32 : cdSize), w32(z64 ? U32 : cdStart), w16(0)]));
    await new Promise<void>((res, rej) => { if (this.failure) return rej(this.failure); this.out.once('error', rej); this.out.end(res); });
  }
}
