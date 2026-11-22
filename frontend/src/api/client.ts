// Thin fetch wrapper. Everything is same-origin (the Vite proxy in dev, the Express
// server in production), so the HttpOnly session cookie travels by itself.

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

export async function request<T = unknown>(method: string, url: string, body?: unknown, opts: { raw?: boolean; quiet401?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }

  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  if (opts.raw && res.ok) return res as unknown as T;

  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !opts.quiet401) onUnauthorized();
    const message = (data && (data.error as string)) || `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, data?.code, data ?? undefined);
  }
  return data as T;
}

export const get = <T,>(url: string, o?: { quiet401?: boolean }) => request<T>('GET', url, undefined, o);
export const post = <T,>(url: string, body: unknown = {}, o?: { quiet401?: boolean }) => request<T>('POST', url, body, o);
export const put = <T,>(url: string, body: unknown) => request<T>('PUT', url, body);
export const patch = <T,>(url: string, body: unknown) => request<T>('PATCH', url, body);
export const del = <T,>(url: string) => request<T>('DELETE', url);
