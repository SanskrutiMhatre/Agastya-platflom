// =============================================================================
// The GitLab HTTP client (Phase 3, P3-5). The only code that talks to GitLab.
//
// SSRF protection: every request is built from the ONE configured instance (scheme, host, port and an optional path prefix such as
// https://git.corp/gitlab) and a path under that prefix that starts with /api/v4/ or /oauth/. A path with `..`, a backslash, a scheme, an
// `@` before the host or anything that resolves to another origin is refused before a socket is opened; redirects are never followed (a 3xx
// is an error). Nothing a user types becomes a host name: GitLab project ids and paths are URL-encoded into path segments.
//
// TLS: the administrator's CA bundle (PEM) is given to this client's own https.Agent as its only trust anchors (when one is configured),
// so nothing is installed machine-wide and other outbound TLS of the process is unaffected. TLS 1.2 minimum. A certificate problem is
// reported as GITLAB_TLS with the reason.
//
// Robustness: a per-request deadline (config timeoutMs), and retries with back-off for reads (GET/HEAD) on a connection error, 429 or 5xx
// (Retry-After honoured up to 10 s). Writes are never retried automatically (a commit or a release must not be made twice).
// =============================================================================

import https from 'https';
import http from 'http';
import { HttpError } from '../http';

export interface GitlabEndpoint {
  /** The instance, e.g. https://gitlab.corp.local or https://git.corp/gitlab (no trailing slash). */
  baseUrl: string;
  /** PEM bundle of the internal CA (null: the system trust store). */
  caPem: string | null;
  timeoutMs: number;
  retries: number;
  allowHttp?: boolean;
}

export type GitlabAuth = { kind: 'bearer'; token: string } | { kind: 'private'; token: string } | null;

export interface GitlabRequest {
  method?: string;
  /** Path under the instance: /api/v4/... or /oauth/... */
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: GitlabAuth;
  json?: unknown;
  /** A raw body (an upload); a Buffer. */
  body?: Buffer;
  contentType?: string;
  /** Form-encoded body (OAuth token endpoint). */
  form?: Record<string, string>;
  /** Return the body as a Buffer instead of parsing JSON. */
  raw?: boolean;
  /** Override the endpoint's timeout for this call (uploads). */
  timeoutMs?: number;
}

export interface GitlabResponse<T = unknown> { status: number; headers: http.IncomingHttpHeaders; data: T; buffer?: Buffer }

/** A GitLab problem, mapped onto an answer of our own API. Never 401: that would sign the person out of Agastya. */
export class GitlabError extends HttpError {
  constructor(status: number, message: string, code: string, public readonly upstreamStatus: number | null = null, extra: Record<string, unknown> = {}) {
    super(status, message, code, { upstreamStatus, ...extra });
    this.name = 'GitlabError';
  }
}

/** Check an instance address. Returns the normalised base URL or throws a 400 naming the problem. */
export function normaliseBaseUrl(raw: string, allowHttp = false): string {
  let u: URL;
  // the URL parser resolves "/a/../b" silently, so dot segments are refused on the text as given
  if (/(^|[\\/])\.\.?([\\/?#]|$)/.test(String(raw ?? '').trim().replace(/^[a-z]+:\/\/[^/]*/i, ''))) throw new GitlabError(400, 'The GitLab address path is not allowed.', 'GITLAB_BAD_URL');
  try { u = new URL(String(raw ?? '').trim()); } catch { throw new GitlabError(400, 'The GitLab address is not a URL (for example https://gitlab.corp.local).', 'GITLAB_BAD_URL'); }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) throw new GitlabError(400, 'The GitLab address must start with https:// (the integration needs TLS).', 'GITLAB_BAD_URL');
  if (u.username || u.password) throw new GitlabError(400, 'The GitLab address must not contain a user name or password.', 'GITLAB_BAD_URL');
  if (u.search || u.hash) throw new GitlabError(400, 'The GitLab address must not have a query (?) or fragment (#).', 'GITLAB_BAD_URL');
  if (!u.hostname) throw new GitlabError(400, 'The GitLab address has no host name.', 'GITLAB_BAD_URL');
  const p = u.pathname.replace(/\/+$/, '');
  if (/(^|\/)\.\.?(\/|$)/.test(p) || p.includes('\\')) throw new GitlabError(400, 'The GitLab address path is not allowed.', 'GITLAB_BAD_URL');
  return `${u.protocol}//${u.host}${p}`;
}

/** The full URL of a request, proven to stay on the configured instance (SSRF guard). Exported for the tests. */
export function urlFor(ep: Pick<GitlabEndpoint, 'baseUrl' | 'allowHttp'>, p: string, query?: GitlabRequest['query']): URL {
  const base = new URL(normaliseBaseUrl(ep.baseUrl, ep.allowHttp));
  if (typeof p !== 'string' || !/^\/(api\/v4|oauth)\//.test(p)) throw new GitlabError(400, 'Refused: not a GitLab API path.', 'GITLAB_PATH_REFUSED');
  const dotty = (s: string): boolean => { let d: string; try { d = decodeURIComponent(s); } catch { return true; } return d.split(/[\\/]/).some((x) => x === '.' || x === '..'); };
  if (p.includes('\\') || p.includes('//') || /[\s#?@]/.test(p) || p.split('/').some(dotty)) {
    throw new GitlabError(400, 'Refused: the request path is not allowed.', 'GITLAB_PATH_REFUSED');
  }
  const prefix = base.pathname.replace(/\/+$/, '');
  const u = new URL(`${base.protocol}//${base.host}${prefix}${p}`);
  if (u.origin !== base.origin || !u.pathname.startsWith(`${prefix}/`)) throw new GitlabError(400, 'Refused: the request would leave the configured GitLab instance.', 'GITLAB_PATH_REFUSED');
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u;
}

/** One path segment, encoded (a project path "group/sub/name" becomes "group%2Fsub%2Fname", a file path likewise). */
export const seg = (v: string | number): string => encodeURIComponent(String(v));

const agents = new Map<string, https.Agent>();
function agentFor(ep: GitlabEndpoint): https.Agent {
  const key = ep.caPem ?? '';
  let a = agents.get(key);
  if (!a) {
    a = new https.Agent({ keepAlive: true, maxSockets: 8, minVersion: 'TLSv1.2', ...(ep.caPem ? { ca: ep.caPem } : {}) });
    if (agents.size > 8) { for (const old of agents.values()) old.destroy(); agents.clear(); }
    agents.set(key, a);
  }
  return a;
}

const TLS_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_GET_ISSUER_CERT', 'CERT_NOT_YET_VALID', 'CERT_UNTRUSTED', 'EPROTO', 'ERR_SSL_WRONG_VERSION_NUMBER']);

function networkError(e: NodeJS.ErrnoException, url: URL): GitlabError {
  const code = String(e.code ?? '');
  if (TLS_CODES.has(code) || /certificate|ssl|tls/i.test(e.message)) {
    return new GitlabError(502, `The TLS connection to ${url.host} was refused: ${e.message}. Check the address and the CA certificate uploaded for GitLab.`, 'GITLAB_TLS', null, { reason: code || e.message });
  }
  if (code === 'GITLAB_TIMEOUT') return new GitlabError(504, `GitLab at ${url.host} did not answer in time.`, 'GITLAB_TIMEOUT');
  return new GitlabError(502, `GitLab at ${url.host} could not be reached (${code || e.message}).`, 'GITLAB_UNAVAILABLE', null, { reason: code || e.message });
}

function messageOf(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const m = d.message ?? d.error_description ?? d.error;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) return m.map(String).join('; ');
  if (m && typeof m === 'object') return Object.entries(m as Record<string, unknown>).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : String(v)}`).join('; ');
  return '';
}

/** Map a GitLab answer that is not 2xx onto our error. */
export function upstreamError(status: number, data: unknown, what: string): GitlabError {
  const m = messageOf(data);
  const tail = m ? `: ${m}` : '';
  if (status === 401) return new GitlabError(409, `GitLab refused the credentials for ${what}${tail}. Reconnect your GitLab account (or ask the administrator to check the service token).`, 'GITLAB_AUTH', 401);
  if (status === 403) return new GitlabError(403, `GitLab does not allow ${what}${tail}.`, 'GITLAB_FORBIDDEN', 403);
  if (status === 404) return new GitlabError(404, `GitLab has no such ${what}${tail}.`, 'GITLAB_NOT_FOUND', 404);
  if (status === 409 || status === 400 || status === 422) return new GitlabError(409, `GitLab refused ${what}${tail}.`, 'GITLAB_REFUSED', status);
  if (status === 413) return new GitlabError(413, `GitLab refused ${what} as too large${tail}.`, 'GITLAB_TOO_LARGE', status);
  if (status === 429) return new GitlabError(503, `GitLab is rate-limiting requests (${what}); try again shortly.`, 'GITLAB_RATE_LIMITED', status);
  if (status >= 300 && status < 400) return new GitlabError(502, `GitLab answered ${what} with a redirect (${status}); redirects are not followed. Check the address (it must be the instance itself, including any path prefix).`, 'GITLAB_REDIRECT', status);
  return new GitlabError(502, `GitLab failed on ${what} (${status})${tail}.`, 'GITLAB_UPSTREAM', status);
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function once(ep: GitlabEndpoint, r: GitlabRequest, url: URL): Promise<{ status: number; headers: http.IncomingHttpHeaders; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { accept: r.raw ? '*/*' : 'application/json', 'user-agent': 'Agastya-Platform' };
    if (r.auth?.kind === 'bearer') headers.authorization = `Bearer ${r.auth.token}`;
    if (r.auth?.kind === 'private') headers['private-token'] = r.auth.token;
    let payload: Buffer | null = null;
    if (r.form) { payload = Buffer.from(new URLSearchParams(r.form).toString()); headers['content-type'] = 'application/x-www-form-urlencoded'; }
    else if (r.json !== undefined) { payload = Buffer.from(JSON.stringify(r.json)); headers['content-type'] = 'application/json'; }
    else if (r.body) { payload = r.body; headers['content-type'] = r.contentType ?? 'application/octet-stream'; }
    if (payload) headers['content-length'] = payload.length;
    const mod = url.protocol === 'http:' ? http : https;
    const req = mod.request(url, { method: r.method ?? 'GET', headers, ...(url.protocol === 'https:' ? { agent: agentFor(ep) } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, buffer: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    const ms = r.timeoutMs ?? ep.timeoutMs;
    req.setTimeout(ms, () => { const e = new Error(`no answer in ${ms} ms`) as NodeJS.ErrnoException; e.code = 'GITLAB_TIMEOUT'; req.destroy(e); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Send one request to the configured instance. Throws GitlabError on any failure (incl. a non-2xx answer). */
export async function gitlabRequest<T = unknown>(ep: GitlabEndpoint, r: GitlabRequest, what = 'the request'): Promise<GitlabResponse<T>> {
  const url = urlFor(ep, r.path, r.query);
  const method = (r.method ?? 'GET').toUpperCase();
  const idempotent = method === 'GET' || method === 'HEAD';
  const tries = idempotent ? Math.max(0, Math.min(5, ep.retries)) + 1 : 1;
  let last: GitlabError | null = null;
  for (let i = 0; i < tries; i++) {
    if (i > 0) await pause(Math.min(10_000, 250 * 2 ** (i - 1)));
    let got: { status: number; headers: http.IncomingHttpHeaders; buffer: Buffer };
    try { got = await once(ep, { ...r, method }, url); } catch (e) {
      last = networkError(e as NodeJS.ErrnoException, url);
      if (last.code === 'GITLAB_TLS') throw last;              // a certificate problem does not go away by trying again
      continue;
    }
    const type = String(got.headers['content-type'] ?? '');
    let data: unknown = null;
    if (!r.raw || got.status >= 300) { if (type.includes('json') && got.buffer.length) { try { data = JSON.parse(got.buffer.toString('utf8')); } catch { data = null; } } }
    if (got.status >= 200 && got.status < 300) return { status: got.status, headers: got.headers, data: (r.raw ? null : data) as T, buffer: r.raw ? got.buffer : undefined };
    last = upstreamError(got.status, data, what);
    if (idempotent && (got.status === 429 || got.status >= 500) && i + 1 < tries) {
      const ra = Number(got.headers['retry-after']);
      if (ra > 0) await pause(Math.min(10_000, ra * 1000));
      continue;
    }
    throw last;
  }
  throw last ?? new GitlabError(502, 'GitLab could not be reached.', 'GITLAB_UNAVAILABLE');
}

/** Every page of a list (x-next-page), up to `maxPages`. */
export async function gitlabAll<T>(ep: GitlabEndpoint, r: GitlabRequest, what: string, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (let n = 0; n < maxPages; n++) {
    const got = await gitlabRequest<T[]>(ep, { ...r, query: { per_page: 100, ...(r.query ?? {}), page } }, what);
    if (Array.isArray(got.data)) out.push(...got.data);
    const next = Number(got.headers['x-next-page']);
    if (!next || next <= page) return out;
    page = next;
  }
  return out;
}
