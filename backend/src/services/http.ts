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
        console.error('[api]', req.method, req.originalUrl, (e as Error).stack ?? e);
        if (res.headersSent) return next(e);
        return res.status(500).json({ error: 'Internal error', details: (e as Error).message });
      });
  };
}

/** The route parameter as a plain string (Express types allow string[]). */
export const param = (req: Request, name: string): string => String(req.params[name] ?? '');
