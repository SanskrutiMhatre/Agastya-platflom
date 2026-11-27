// =============================================================================
// Structured server logs (audit WP-29: ENT-007 part 2, RES-004). One small logger, no dependency.
//
//   installLogging(config)   called once by index.ts: every console.log/info/warn/error/debug line of the process becomes one log record.
//                            `json` format: one JSON object per line on standard output ({t, level, msg, req?, ...}); `text`: the line as
//                            before (developer runs). Either way the same records also go, as JSON, to <log dir>/agastya-server.jsonl,
//                            rotated by size (agastya-server.jsonl.1 ... .N).
//   logRecord(level, msg, fields)   a record with fields (the access log, the security events)
//   accessLog()              Express middleware: one record per request - method, route template, status, milliseconds, user id; never a
//                            body, a query string, a cookie or a header value
//
// Redaction (ENT-007: "no secrets"): a value that looks like a password hash, a session cookie, a Bearer/Basic credential or a
// "password=..." pair is replaced before anything is written, whatever the format. Tests that build the app in-process never call
// installLogging, so their console output is unchanged.
// =============================================================================

import fs from 'fs';
import path from 'path';
import util from 'util';
import type { Request, Response, NextFunction } from 'express';
import type { Config } from '../config';
import { currentRequest } from './requestContext';

export type Level = 'debug' | 'info' | 'warn' | 'error';
interface LogSettings { format: 'json' | 'text'; dir: string | null; maxBytes: number; keep: number }

const SECRETS: Array<[RegExp, string]> = [
  [/\$(argon2(id|i|d)?|scrypt|2[aby]?)\$[^\s"';]+/gi, '[redacted-hash]'],          // argon2 parameters contain commas
  [/(agastya_session=)[^\s;"',]+/gi, '$1[redacted]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [redacted]'],
  [/\b((?:new|current|old|temp|initial_admin_)?password|passphrase|secret|token)(["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi, '$1$2[redacted]'],
];
export function redactLine(s: string): string {
  let out = s;
  for (const [re, rep] of SECRETS) out = out.replace(re, rep);
  return out;
}

let settings: LogSettings | null = null;
let fileSize = -1;
const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };

function fileOf(s: LogSettings): string | null { return s.dir ? path.join(s.dir, 'agastya-server.jsonl') : null; }

/** Rotate agastya-server.jsonl -> .1 -> .2 ... keeping `keep` old files. */
function rotate(file: string, keep: number): void {
  try {
    if (keep <= 0) { fs.rmSync(file, { force: true }); return; }
    fs.rmSync(`${file}.${keep}`, { force: true });
    for (let i = keep - 1; i >= 1; i--) if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    fs.renameSync(file, `${file}.1`);
  } catch { /* a log that cannot rotate keeps growing rather than stopping the server */ }
}

function toFile(line: string): void {
  if (!settings) return;
  const file = fileOf(settings);
  if (!file) return;
  try {
    if (fileSize < 0) { fs.mkdirSync(path.dirname(file), { recursive: true }); fileSize = fs.existsSync(file) ? fs.statSync(file).size : 0; }
    if (fileSize + line.length + 1 > settings.maxBytes && fileSize > 0) { rotate(file, settings.keep); fileSize = 0; }
    fs.appendFileSync(file, `${line}\n`);
    fileSize += Buffer.byteLength(line) + 1;
  } catch { /* never let logging break a request */ }
}

/** One record: the JSON line (always to the file; to standard output in json format), or the text line in text format. */
export function logRecord(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const req = currentRequest();
  const rec: Record<string, unknown> = { t: new Date().toISOString(), level, msg: redactLine(msg), ...(req ? { req: req.id } : {}) };
  for (const [k, v] of Object.entries(fields)) rec[k] = typeof v === 'string' ? redactLine(v) : v;
  const json = JSON.stringify(rec);
  toFile(json);
  if (settings && settings.format === 'json') {
    (level === 'error' || level === 'warn' ? original.error : original.log).call(console, json);
  } else if (fields.kind !== 'access') {
    const extra = Object.keys(fields).length ? ` ${redactLine(JSON.stringify(fields))}` : '';
    (level === 'error' || level === 'warn' ? original.error : original.log).call(console, `${redactLine(msg)}${extra}`);
  }
}

/** Route every console line through logRecord. Idempotent; `resetLogging` undoes it (tests). */
export function installLogging(c: Pick<Config, 'log'>): void {
  settings = { format: c.log.format, dir: c.log.dir, maxBytes: c.log.maxBytes, keep: c.log.keep };
  fileSize = -1;
  const route = (level: Level) => (...args: unknown[]): void => logRecord(level, util.format(...args));
  console.log = route('info'); console.info = route('info'); console.warn = route('warn'); console.error = route('error'); console.debug = route('debug');
}
export function resetLogging(): void {
  Object.assign(console, original);
  settings = null; fileSize = -1;
}

/** The route template of a request ("/api/projects/:id/dm"), never the concrete path with its ids or file names. */
function routeOf(req: Request): string {
  const r = (req as Request & { route?: { path?: unknown } }).route;
  if (r && typeof r.path === 'string') return `${req.baseUrl ?? ''}${r.path}`;
  return req.path.startsWith('/api/') ? '(unmatched api)' : '(static)';
}

/** One access record per finished request (when the configuration asks for it). */
export function accessLog() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const user = (req as Request & { auth?: { user?: { id?: string } } }).auth?.user?.id ?? null;
      logRecord(res.statusCode >= 500 ? 'error' : 'info', `${req.method} ${routeOf(req)} ${res.statusCode}`,
        { kind: 'access', method: req.method, route: routeOf(req), status: res.statusCode, ms: Math.round(ms * 10) / 10, user });
    });
    next();
  };
}
