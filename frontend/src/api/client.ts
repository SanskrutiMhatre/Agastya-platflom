// Thin fetch wrapper. Everything is same-origin (the Vite proxy in dev, the Express
// server in production), so the HttpOnly session cookie travels by itself.
import { shared, invalidate } from './query';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public body?: Record<string, unknown>) {
    super(message);
  }
  get isConflict() { return this.status === 409; }
  get isUnauthorized() { return this.status === 401; }
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized = () => undefined;
/** The session store registers here so a 401 anywhere signs the user out once, centrally. */
export const setUnauthorizedHandler = (fn: Unauthorized): void => { onUnauthorized = fn; };
/** For callers that cannot use `request` (an upload that reports progress goes through XMLHttpRequest): a 401 still signs the user out once. */
export const signalUnauthorized = (): void => onUnauthorized();

/**
 * FE-003: while someone is signed in, a 401 does not throw their work away. The session store asks them to sign in again over the page
 * (the editor stays mounted) and resolves true once they have; the request that got the 401 is then sent again, so a Save that met an
 * expired session completes. It resolves false when they choose to sign out instead, and the request fails as before.
 */
type Reauth = () => Promise<boolean>;
let reauth: Reauth | null = null;
export const setReauthHandler = (fn: Reauth | null): void => { reauth = fn; };
/** The sign-in endpoints themselves are never replayed (a wrong password is a 401 too). */
const isAuthUrl = (url: string) => /^\/api\/auth\//.test(url);

export async function request<T = unknown>(method: string, url: string, body?: unknown, opts: { raw?: boolean; quiet401?: boolean; background?: boolean; replayed?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  // WP-18: a write makes every answer read before it old (api/query.ts); once before it is sent and once after it is answered.
  const write = method !== 'GET' && method !== 'HEAD';
  if (write) invalidate();
  try { return await send<T>(method, url, body, opts); } finally { if (write) invalidate(); }
}

async function send<T>(method: string, url: string, body: unknown, opts: { raw?: boolean; quiet401?: boolean; background?: boolean; replayed?: boolean; signal?: AbortSignal }): Promise<T> {
  const headers: Record<string, string> = {};
  // A timer's request (badge counts, status checks) is not the person working: it does not keep the session from going idle (WP-03).
  if (opts.background) headers['x-agastya-background'] = '1';
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }

  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', signal: opts.signal });
  if (opts.raw && res.ok) return res as unknown as T;

  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !opts.quiet401) {
      if (reauth && !opts.replayed && !isAuthUrl(url)) {
        if (await reauth()) return request<T>(method, url, body, { ...opts, replayed: true });
      } else onUnauthorized();
    }
    const message = (data && (data.error as string)) || `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, data?.code, data ?? undefined);
  }
  return data as T;
}

/**
 * A GET through the query layer (api/query.ts, WP-18): identical GETs in flight share one request, an answer is reused for a few hundred ms
 * (or `ttl`), every write clears both, `fresh` always goes to the server, `signal` cancels this caller's wait.
 */
export const get = <T,>(url: string, o?: { quiet401?: boolean; background?: boolean; ttl?: number; fresh?: boolean; signal?: AbortSignal }) =>
  shared<T>(`${url}${o?.background ? '\u0000bg' : ''}${o?.quiet401 ? '\u0000q' : ''}`,
    (signal) => request<T>('GET', url, undefined, { quiet401: o?.quiet401, background: o?.background, signal }),
    { ttl: o?.ttl, fresh: o?.fresh, signal: o?.signal });
export const post = <T,>(url: string, body: unknown = {}, o?: { quiet401?: boolean }) => request<T>('POST', url, body, o);
export const put = <T,>(url: string, body: unknown) => request<T>('PUT', url, body);
export const patch = <T,>(url: string, body: unknown) => request<T>('PATCH', url, body);
export const del = <T,>(url: string) => request<T>('DELETE', url);
