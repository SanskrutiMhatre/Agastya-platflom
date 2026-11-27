// Small request helpers shared by every router.

import type { Request, Response, NextFunction, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const bad = (message: string, code?: string): HttpError => new HttpError(400, message, code);
export const notFound = (message = 'Not found'): HttpError => new HttpError(404, message, 'NOT_FOUND');
export const forbidden = (message = 'You do not have permission to do that.', code = 'FORBIDDEN'): HttpError => new HttpError(403, message, code);
export const conflict = (message: string, code?: string, extra?: Record<string, unknown>): HttpError => new HttpError(409, message, code, extra);

/** A full disk is the server's condition, not a bug in the request: say so (507) instead of an opaque 500 (measured on a 4.8 GB upload, Phase 18). */
export const diskFull = (e: unknown): HttpError | null => (['ENOSPC', 'EDQUOT'].includes((e as NodeJS.ErrnoException)?.code ?? '')
  ? new HttpError(507, 'The server has run out of disk space, so this could not be completed. Free space on the server (or ask its administrator to) and try again; nothing was changed.', 'DISK_FULL') : null);

/**
 * WP-06 (PLT-002): the database stayed locked by another process (a backup, an antivirus scan, reset-admin) longer than the 5 s busy
 * timeout. That is a passing condition of the server, not a bug: 503 with Retry-After, never a 500 or a lost sign-in.
 */
export const dbBusy = (e: unknown): HttpError | null => {
  const x = e as { errcode?: number; code?: string; message?: string } | null;
  return x && (x.errcode === 5 || x.errcode === 6 || x.code === 'SQLITE_BUSY' || /database is locked|database table is locked/i.test(String(x.message ?? '')))
    ? new HttpError(503, 'The server is busy for a moment (its database is in use). Try again in a few seconds; nothing was changed.', 'BUSY') : null;
};

/** Wrap an async handler so a thrown HttpError becomes its JSON response and anything else a 500. */
export function wrap(fn: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e: unknown) => {
        if (e instanceof HttpError) {
          return res.status(e.status).json({ error: e.message, code: e.code, ...(e.extra ?? {}) });
        }
        const full = diskFull(e);
        if (full) { console.error('[api]', req.method, req.originalUrl, 'disk full:', (e as Error).message); return res.status(full.status).json({ error: full.message, code: full.code }); }
        const busy = dbBusy(e);
        if (busy && !res.headersSent) { console.warn('[api]', req.method, req.originalUrl, 'database busy'); res.setHeader('Retry-After', '3'); return res.status(busy.status).json({ error: busy.message, code: busy.code }); }
        // PLT-019 / SEC-013: the message can name tables, paths or library internals; it goes to the server log under an id, the client gets the id only.
        const id = (req as any).requestId ?? '-';
        console.error(`[api] ${id}`, req.method, req.originalUrl, (e as Error).stack ?? e);
        if (res.headersSent) return next(e);
        return res.status(500).json({ error: 'Something went wrong on the server. If it happens again, give the administrator this reference.', code: 'INTERNAL', id });
      });
  };
}

/** The route parameter as a plain string (Express types allow string[]). */
export const param = (req: Request, name: string): string => String(req.params[name] ?? '');
