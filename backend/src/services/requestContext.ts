// The request a piece of code is running for (audit WP-03): its client address and a correlation id, without passing `req`
// through every service. Set by one middleware at the start of every request; read by audit() (every audit row gets the IP,
// ENT-011) and by the error handler (a 500 answers with the id only, the details go to the server log, PLT-019 / SEC-013).
import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

/** `dbMs` / `dbN`: the database time and statement count of this request (services/metrics.ts adds to them; the Server-Timing header). */
export interface RequestContext { id: string; ip: string; method: string; path: string; dbMs?: number; dbN?: number }

const als = new AsyncLocalStorage<RequestContext>();

export const currentRequest = (): RequestContext | undefined => als.getStore();

/** A short random id an administrator can quote and find in the server log. */
export const newRequestId = (): string => crypto.randomBytes(6).toString('hex');

/** Express middleware: run the rest of the request inside its context. `ipOf` is the one client-address rule (clientIp). */
export function requestContextMiddleware(ipOf: (req: any) => string) {
  return (req: any, res: any, next: () => void): void => {
    const ctx: RequestContext = { id: newRequestId(), ip: ipOf(req), method: req.method, path: String(req.originalUrl || req.url || '').split('?')[0] };
    req.requestId = ctx.id;
    res.setHeader('X-Request-Id', ctx.id);
    als.run(ctx, next);
  };
}
