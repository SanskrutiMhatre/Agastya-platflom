// Compression and caching of what the server sends (audit WP-18: FE-027, PERF-016). Node's own zlib only: no new dependency, works offline.
//
//  * API answers: a JSON, text or XML body of 1 KB or more that goes out through res.send / res.json is gzip-compressed when the client accepts
//    it (Vary: Accept-Encoding). Streams, files (PDFs, downloads, sendFile) and binary bodies are untouched.
//  * The built client: hashed files under /assets/ are "public, max-age=31536000, immutable" (their name changes with their content);
//    index.html stays "no-cache" so a new build is picked up on the next load; every other file revalidates as before. Text files of 1 KB or
//    more are sent brotli- or gzip-compressed, compressed once per file version and kept in a bounded memory cache.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export const MIN_COMPRESS_BYTES = 1024;
export const IMMUTABLE = 'public, max-age=31536000, immutable';
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|ecmascript|xml|xhtml\+xml|wasm|manifest\+json|xslt\+xml|x-javascript)\b|image\/svg\+xml|[^;]*\+(xml|json)\b)/i;
/** Vite writes hashed names as `<name>-<8 or more url-safe characters>.<ext>` under assets/. */
const HASHED = /^\/assets\/(?:[^/]+\/)*[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

/** The Studio's schema folder names (`/schemas/4-2/...`) and the server's set each one is served from (backend/schemas/<set>). */
export const STUDIO_SCHEMA_SETS: Record<string, string> = { '4-2': '4.2', '5-0': '5.0', '6': '6.0', '7': '7.0' };

export const isCompressible =(type: string): boolean => COMPRESSIBLE.test(type);
export const isHashedAsset = (urlPath: string): boolean => HASHED.test(urlPath);

/** The best of `order` the client accepts: highest q first, the server's order among equal q (browsers list gzip before br at the same q). */
export function wantsEncoding(req: Pick<Request, 'headers'>, order: ('br' | 'gzip')[]): 'br' | 'gzip' | null {
  const header = String(req.headers['accept-encoding'] ?? '');
  if (!header.trim()) return null;
  const q = new Map<string, number>();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const qp = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const v = qp ? Number(qp.slice(2)) : 1;
    q.set(name, Number.isFinite(v) ? v : 0);
  }
  let best: 'br' | 'gzip' | null = null; let bestQ = 0;
  for (const enc of order) {
    const v = q.has(enc) ? q.get(enc)! : (q.get('*') ?? 0);
    if (v > bestQ) { best = enc; bestQ = v; }
  }
  return best;
}

/** gzip for res.send / res.json bodies (API answers). */
export function compressResponses(req: Request, res: Response, next: NextFunction): void {
  const send = res.send;
  res.send = function sendCompressed(this: Response, body?: unknown) {
    try {
      if (req.method === 'HEAD' || res.getHeader('Content-Encoding') || res.statusCode === 204 || res.statusCode === 304) return send.call(this, body);
      if (typeof body !== 'string' && !Buffer.isBuffer(body)) return send.call(this, body);      // objects come back through res.json as a string
      let type = String(res.getHeader('Content-Type') ?? '');
      if (!type || !isCompressible(type)) return send.call(this, body);
      const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
      if (buf.length < MIN_COMPRESS_BYTES) return send.call(this, body);
      res.vary('Accept-Encoding');
      const enc = wantsEncoding(req, ['gzip', 'br']);
      if (!enc) return send.call(this, body);
      // a string body would have been given a charset by res.send; a Buffer is not, so keep what the client was told
      if (typeof body === 'string' && !/charset=/i.test(type)) { type = `${type}; charset=utf-8`; res.setHeader('Content-Type', type); }
      const out = enc === 'gzip'
        ? zlib.gzipSync(buf, { level: buf.length > 512 * 1024 ? 4 : 6 })
        : zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      res.setHeader('Content-Encoding', enc);
      return send.call(this, out);
    } catch {
      return send.call(this, body);
    }
  } as typeof res.send;
  next();
}

interface Packed { size: number; mtimeMs: number; enc: 'br' | 'gzip'; data: Buffer }

/** The built client with long-lived caching of hashed files and pre-compressed text files. */
export function clientStatic(dir: string, opts: { maxCacheBytes?: number; maxFileBytes?: number } = {}): RequestHandler {
  const root = path.resolve(dir);
  const maxCache = opts.maxCacheBytes ?? 128 * 1024 * 1024;
  const maxFile = opts.maxFileBytes ?? 24 * 1024 * 1024;
  const cache = new Map<string, Packed>();
  const pending = new Map<string, Promise<Packed>>();
  let cached = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mime: { lookup(p: string): string; charsets: { lookup(t: string): string | false } } = (express.static as any).mime;

  const cacheControl = (res: Response, urlPath: string, file: string): void => {
    if (file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    else if (isHashedAsset(urlPath)) res.setHeader('Cache-Control', IMMUTABLE);
  };
  const plain = express.static(root, {
    setHeaders: (res, file) => { cacheControl(res as Response, ((res as Response).req as Request).path, file); },
  });

  const pack = (file: string, st: fs.Stats, enc: 'br' | 'gzip'): Promise<Packed> => {
    const key = `${file}\0${enc}`;
    const hit = cache.get(key);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) { cache.delete(key); cache.set(key, hit); return Promise.resolve(hit); }
    const run = pending.get(key);
    if (run) return run;
    const p = fs.promises.readFile(file).then((raw) => new Promise<Packed>((resolve, reject) => {
      const done = (err: Error | null, data: Buffer) => { if (err) return reject(err); resolve({ size: st.size, mtimeMs: st.mtimeMs, enc, data }); };
      // compressed on the thread pool, once per file version; quality 9 / level 9 is a one-off cost the cache pays back on every later load
      if (enc === 'br') zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }, done);
      else zlib.gzip(raw, { level: 9 }, done);
    })).then((packed) => {
      const old = cache.get(key); if (old) { cached -= old.data.length; cache.delete(key); }
      cache.set(key, packed); cached += packed.data.length;
      for (const [k, v] of cache) { if (cached <= maxCache) break; cache.delete(k); cached -= v.data.length; }
      return packed;
    }).finally(() => { pending.delete(key); });
    pending.set(key, p);
    return p;
  };

  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel: string;
    try { rel = decodeURIComponent(req.path); } catch { return plain(req, res, next); }
    if (rel.includes('\0')) return plain(req, res, next);
    const file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) return plain(req, res, next);
    const type = mime.lookup(file);
    const enc = req.headers.range ? null : wantsEncoding(req, ['br', 'gzip']);
    if (!enc || !isCompressible(type)) return plain(req, res, next);
    fs.stat(file, (err, st) => {
      if (err || !st.isFile() || st.size < MIN_COMPRESS_BYTES || st.size > maxFile) return plain(req, res, next);
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${enc}"`;
      res.vary('Accept-Encoding');
      cacheControl(res, req.path, file);
      if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'public, max-age=0');
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', st.mtime.toUTCString());
      const charset = mime.charsets.lookup(type);
      res.setHeader('Content-Type', charset ? `${type}; charset=${charset}` : type);
      if (req.fresh) { res.statusCode = 304; res.removeHeader('Content-Type'); return void res.end(); }
      pack(file, st, enc).then((p) => {
        res.setHeader('Content-Encoding', p.enc);
        res.setHeader('Content-Length', String(p.data.length));
        if (req.method === 'HEAD') return void res.end();
        res.end(p.data);
      }, () => { res.removeHeader('ETag'); res.removeHeader('Content-Encoding'); plain(req, res, next); });
    });
  };
}
