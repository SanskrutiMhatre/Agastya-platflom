// Streaming uploads: multipart files go to disk as they arrive (never held in memory), up to a configurable size.
//   AGASTYA_MAX_UPLOAD_BYTES   per file, default 2 GB (2 147 483 648)
//   AGASTYA_REQUEST_TIMEOUT_MS how long one request may take to arrive in full, default 3 hours. Node's own default is 5 minutes, which cuts a
//                              2 GB upload on a slow link with a 408 (measured, Phase 18); the header timeout stays at its short default.
// A route that accepts a file reads it from `file.path` and removes it with `discard` when done (also on error).
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { config, envPositive } from '../config';

// WP-10 (PLT-032): the limits come from the one typed configuration; envPositive lives there and is re-exported for compatibility.
export { envPositive };
export const MAX_UPLOAD_BYTES = config.limits.maxUploadBytes;
export const uploadTmp = (): string => { const d = path.join(os.tmpdir(), 'agastya-uploads'); fs.mkdirSync(d, { recursive: true }); return d; };
export const diskUpload = (opts: { files?: number } = {}) => multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => cb(null, uploadTmp()), filename: (_r, _f, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.upload`) }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: opts.files ?? 1 },
});
/**
 * WP-11 (REL-007, PERF-010, PLT-021): disk storage with a cap on the WHOLE request. multer's own limits are per file and per count; the
 * running total is checked here as each chunk arrives, so a request that is too large is refused (error code LIMIT_TOTAL_SIZE) while it
 * streams, before the rest is read - never after everything was held in memory. Files already written by the request are removed.
 */
const requestTotals = new WeakMap<object, number>();
class CappedDiskStorage implements multer.StorageEngine {
  constructor(private readonly totalBytes: number) {}
  _handleFile(req: Express.Request, file: Express.Multer.File, cb: (error?: Error | null, info?: Partial<Express.Multer.File>) => void): void {
    const dir = uploadTmp();
    const dest = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.upload`);
    const out = fs.createWriteStream(dest);
    let size = 0; let done = false;
    const fail = (e: Error): void => { if (done) return; done = true; file.stream.unpipe(out); out.destroy(); fs.unlink(dest, () => undefined); file.stream.resume(); cb(e); };
    file.stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      const total = (requestTotals.get(req) ?? 0) + chunk.length; requestTotals.set(req, total);
      if (total > this.totalBytes) fail(Object.assign(new Error(`The upload is larger than ${Math.round(this.totalBytes / 1024 ** 2)} MB in total.`), { code: 'LIMIT_TOTAL_SIZE' }));
    });
    out.on('error', (e) => fail(e));
    out.on('finish', () => { if (!done) { done = true; cb(null, { destination: dir, filename: path.basename(dest), path: dest, size }); } });
    file.stream.pipe(out);
  }
  _removeFile(_req: Express.Request, file: Express.Multer.File, cb: (error: Error | null) => void): void { fs.unlink(file.path, () => cb(null)); }
}
/** Disk upload with per-file, file-count AND whole-request limits (see CappedDiskStorage). */
export const cappedDiskUpload = (opts: { files: number; fileSize: number; totalBytes: number }) =>
  multer({ storage: new CappedDiskStorage(opts.totalBytes), limits: { fileSize: Math.min(opts.fileSize, MAX_UPLOAD_BYTES), files: opts.files } });
/** Remove a request's uploaded files once its response is over (success or error). Call it right after the upload middleware succeeded. */
export const discardWhenDone = (req: Express.Request, res: { on(event: 'close', fn: () => void): unknown }): void => {
  res.on('close', () => {
    const many = Array.isArray(req.files) ? req.files : req.files ? Object.values(req.files).flat() : [];
    discard([...many, ...(req.file ? [req.file] : [])]);
  });
};
/** The bytes of an uploaded file: from disk (disk storage), or the buffer of a memory upload. */
export const uploadedBytes = (f: { path?: string; buffer?: Buffer }): Buffer => (f.buffer ?? fs.readFileSync(String(f.path)));

export const discard = (files: Array<{ path?: string }> | undefined): void => { for (const f of files ?? []) if (f.path) try { fs.unlinkSync(f.path); } catch { /* gone */ } };
export const tooLarge = (): { error: string; code: string } => ({ error: `A file is larger than the upload limit (${Math.round(MAX_UPLOAD_BYTES / 1024 ** 2)} MB; set AGASTYA_MAX_UPLOAD_BYTES to change it).`, code: 'FILE_TOO_LARGE' });

/** Time one request may take to arrive in full. Bounded (not disabled) so a stalled client cannot hold a connection forever. */
export const REQUEST_TIMEOUT_MS = config.limits.requestTimeoutMs;
/**
 * Server timeouts. requestTimeout: see above. keepAliveTimeout: Node closes an idle connection after 5 s, so a client (or a proxy) that reuses it a moment later
 * is reset ("fetch failed" / ECONNRESET) - seen in the test harness after a slow synchronous step, and a known cause of sporadic errors behind proxies.
 * 65 s is longer than the usual client / load-balancer idle timeout; headersTimeout must stay above it.
 */
export const KEEP_ALIVE_MS = 65_000;
export const tuneServer = (s: import('http').Server): void => { s.requestTimeout = REQUEST_TIMEOUT_MS; s.keepAliveTimeout = KEEP_ALIVE_MS; s.headersTimeout = KEEP_ALIVE_MS + 1_000; };

/** Remove upload files an aborted or crashed request left behind (older than the longest request can last, plus an hour). */
export function sweepStaleUploads(now = Date.now(), dir = uploadTmp()): number {
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.upload')) continue;
    const p = path.join(dir, f);
    try { if (now - fs.statSync(p).mtimeMs > REQUEST_TIMEOUT_MS + 3600_000) { fs.unlinkSync(p); n++; } } catch { /* gone */ }
  }
  return n;
}
