// =============================================================================
// The mandatory version guard of content writes (audit WP-11: DEP-016, PLT-020, FE-008, ENT-016, ARC-001; decision D2).
//
// Every route that replaces an existing document (a data module, a CSDB object, the JSS book, the JSG document, the publication module,
// an ancillary page, the project settings) states the version it was made from: `baseHash` in the JSON body, or an If-Match header
// (the hash, optionally quoted). Without it the write is refused with 428 BASE_HASH_REQUIRED - before WP-11 a client that left it out
// overwrote silently (last writer wins). The route's service compares the hash with the current file and answers 409 with the current
// version when it is stale.
//
// Decision D2 (compatibility window): AGASTYA_BASEHASH_COMPAT=1 lets an old script through with a logged warning for one release; by
// default the guard refuses. Every client in this repository sends the hash (checked when the guard was made mandatory).
//
// The middleware is marked (`isVersionGuard`), so test/wp11-integrity.test.js finds every guarded route in the live route table and
// fails when a content-write route has none (the per-route guard presence test of the roadmap).
// =============================================================================

import type { Request, RequestHandler } from 'express';
import { config } from '../config';

/** The version a request names: `baseHash` in the body, else If-Match. '' when it names none. */
export function baseHashOf(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.baseHash === 'string' && body.baseHash.trim()) return body.baseHash.trim();
  const h = req.headers['if-match'];
  const raw = (Array.isArray(h) ? h[0] : h ?? '').trim().replace(/^W\//, '');
  return raw.replace(/^"(.*)"$/, '$1').trim();
}

type Marked = RequestHandler & { isVersionGuard?: boolean; versionOf?: string };

/** The guard. `what` names the document for the message ("data module", "JSS document" ...). The hash is left in `res.locals.baseHash`. */
export function versionGuard(what: string): RequestHandler {
  const mw: Marked = (req, res, next) => {
    const hash = baseHashOf(req);
    if (hash) { res.locals.baseHash = hash; return next(); }
    if (config.baseHashCompat) {
      console.warn(`[version-guard] ${req.method} ${req.originalUrl}: saved without baseHash (AGASTYA_BASEHASH_COMPAT=1 window); the next release refuses this.`);
      res.locals.baseHash = undefined;
      return next();
    }
    res.status(428).json({
      error: `This save does not say which version of the ${what} it was made from, so it could overwrite someone else's changes. Load the ${what} first and send its hash as "baseHash" (or an If-Match header).`,
      code: 'BASE_HASH_REQUIRED',
    });
  };
  mw.isVersionGuard = true; mw.versionOf = what;
  return mw;
}
