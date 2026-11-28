// =============================================================================
// GitLab configuration (Phase 3, P3-5): what the administrator enters, the connection test, and whether the feature is on.
//
// The feature is ON only when a configuration was saved after a SUCCESSFUL connection test (gitlab_settings.verified_at). Until then every
// GitLab route except the administrator's own answers 404 FEATURE_OFF and the client shows nothing GitLab-related.
//
// Stored: the non-secret configuration as JSON (address, CA bundle, OAuth application id, whether personal access tokens are accepted, the
// Agastya address for the redirect URI, timeouts) and the secrets (OAuth application secret, optional service token) sealed with the
// secrets key (services/secretBox.ts). The secrets never leave the server: the administrator's page sees "set / not set".
// =============================================================================

import crypto from 'crypto';
import { config, nowIso } from '../../config';
import { repos } from '../../context';
import { HttpError, bad } from '../http';
import { open, seal } from '../secretBox';
import { GitlabError, gitlabRequest, normaliseBaseUrl, type GitlabEndpoint } from './http';

export interface GitlabConfig {
  baseUrl: string;
  /** PEM bundle of the internal CA; null = the system trust store. */
  caPem: string | null;
  /** The address people use to open Agastya (the OAuth redirect URI is <appUrl>/api/gitlab/oauth/callback). */
  appUrl: string;
  oauthAppId: string | null;
  /** Personal access tokens accepted as the fallback sign-in to GitLab. */
  allowPat: boolean;
  timeoutMs: number;
  retries: number;
  /** Largest single file a push sends (bytes); bigger files are refused with the Git LFS note. */
  maxFileBytes: number;
  /** A push is split into commits of at most this many bytes of content. */
  maxCommitBytes: number;
}
export interface GitlabSecrets { clientSecret?: string | null; serviceToken?: string | null }

export const DEFAULTS = { timeoutMs: 20_000, retries: 2, maxFileBytes: 50 * 1024 * 1024, maxCommitBytes: 16 * 1024 * 1024 };
export const CALLBACK_PATH = '/api/gitlab/oauth/callback';
export const redirectUriOf = (appUrl: string): string => `${appUrl.replace(/\/+$/, '')}${CALLBACK_PATH}`;

export const featureOff = (): HttpError => new HttpError(404, 'Not found', 'FEATURE_OFF');

/** The saved configuration with its secrets, or null. A secret that cannot be opened (other key) reads as absent, with `secretProblem`. */
export function loadSettings(): null | { config: GitlabConfig; secrets: GitlabSecrets; verifiedAt: string | null; verifiedVersion: string | null; updatedAt: string; updatedBy: string | null; secretProblem: string | null } {
  const row = repos.gitlab.getSettings();
  if (!row) return null;
  let cfg: GitlabConfig;
  try { cfg = { ...DEFAULTS, ...(JSON.parse(row.config) as GitlabConfig) }; } catch { return null; }
  let secrets: GitlabSecrets = {}; let secretProblem: string | null = null;
  if (row.secrets) { try { secrets = JSON.parse(open(row.secrets)) as GitlabSecrets; } catch (e) { secretProblem = (e as Error).message; } }
  return { config: cfg, secrets, verifiedAt: row.verified_at, verifiedVersion: row.verified_version, updatedAt: row.updated_at, updatedBy: row.updated_by, secretProblem };
}

/** Is the integration on (configured and verified)? */
export function gitlabEnabled(): boolean { const s = loadSettings(); return !!(s && s.verifiedAt); }

/** The saved, verified configuration; throws 404 FEATURE_OFF when the integration is off. */
export function activeSettings(): NonNullable<ReturnType<typeof loadSettings>> {
  const s = loadSettings();
  if (!s || !s.verifiedAt) throw featureOff();
  return s;
}

export const endpointOf = (c: GitlabConfig): GitlabEndpoint => ({ baseUrl: c.baseUrl, caPem: c.caPem, timeoutMs: c.timeoutMs, retries: c.retries, allowHttp: config.gitlab.allowHttp });

// ── the candidate the administrator submits ─────────────────────────────────────────────────────────────────────────────────────

export interface CertInfo { subject: string; issuer: string; validTo: string; fingerprint256: string; ca: boolean }

/** Parse a PEM bundle: every certificate in it, or a 400 saying what is wrong. Private keys are refused (never upload one here). */
export function parseCaBundle(pem: string): CertInfo[] {
  const text = String(pem ?? '').replace(/\r\n/g, '\n').trim();
  if (/PRIVATE KEY/.test(text)) throw bad('That file holds a private key. Upload only the CA certificate (the public part, PEM).', 'GITLAB_CA_PRIVATE_KEY');
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (!blocks.length) throw bad('The CA certificate must be PEM text (-----BEGIN CERTIFICATE----- ...). Convert a .cer/.der file to PEM first.', 'GITLAB_CA_NOT_PEM');
  if (blocks.length > 20) throw bad('The CA bundle has more than 20 certificates.', 'GITLAB_CA_TOO_MANY');
  return blocks.map((b) => {
    let x: crypto.X509Certificate;
    try { x = new crypto.X509Certificate(b); } catch (e) { throw bad(`A certificate in the bundle cannot be read: ${(e as Error).message}`, 'GITLAB_CA_UNREADABLE'); }
    return { subject: x.subject.replace(/\n/g, ', '), issuer: x.issuer.replace(/\n/g, ', '), validTo: new Date(x.validTo).toISOString(), fingerprint256: x.fingerprint256, ca: x.ca };
  });
}

export interface Candidate { config: GitlabConfig; secrets: GitlabSecrets; testToken: string | null }

const int = (v: unknown, d: number, lo: number, hi: number): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const str = (v: unknown, max = 2000): string => String(v ?? '').trim().slice(0, max);

/** Read the administrator's form. A blank secret keeps the saved one; `clearClientSecret` / `clearServiceToken` remove it. */
export function candidateFrom(body: Record<string, unknown>, fallbackAppUrl: string): Candidate {
  const saved = loadSettings();
  const baseUrl = normaliseBaseUrl(str(body.baseUrl), config.gitlab.allowHttp);
  const caRaw = body.caPem === undefined ? saved?.config.caPem ?? null : (str(body.caPem, 200_000) || null);
  if (caRaw) parseCaBundle(caRaw);
  const appUrlRaw = str(body.appUrl) || saved?.config.appUrl || fallbackAppUrl;
  let appUrl: string;
  try { const u = new URL(appUrlRaw); if (!/^https?:$/.test(u.protocol) || u.search || u.hash || u.username) throw new Error(); appUrl = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`; } catch { throw bad('The Agastya address must be the http(s) address people open Agastya with, e.g. https://agastya.corp.local.', 'GITLAB_BAD_APP_URL'); }
  const oauthAppId = str(body.oauthAppId, 200) || null;
  const keep = (field: 'clientSecret' | 'serviceToken', clear: unknown): string | null => {
    if (clear === true) return null;
    const v = str(body[field], 500);
    return v || (saved?.secrets[field] ?? null);
  };
  const cfg: GitlabConfig = {
    baseUrl, caPem: caRaw, appUrl, oauthAppId,
    allowPat: body.allowPat === undefined ? (saved?.config.allowPat ?? true) : body.allowPat === true,
    timeoutMs: int(body.timeoutMs ?? saved?.config.timeoutMs, DEFAULTS.timeoutMs, 2_000, 300_000),
    retries: int(body.retries ?? saved?.config.retries, DEFAULTS.retries, 0, 5),
    maxFileBytes: int(body.maxFileBytes ?? saved?.config.maxFileBytes, DEFAULTS.maxFileBytes, 1024 * 1024, 2 * 1024 ** 3),
    maxCommitBytes: int(body.maxCommitBytes ?? saved?.config.maxCommitBytes, DEFAULTS.maxCommitBytes, 1024 * 1024, 512 * 1024 * 1024),
  };
  const secrets: GitlabSecrets = { clientSecret: keep('clientSecret', body.clearClientSecret), serviceToken: keep('serviceToken', body.clearServiceToken) };
  if (cfg.oauthAppId && !secrets.clientSecret) throw bad('An OAuth application needs its secret as well as its application id.', 'GITLAB_SECRET_MISSING');
  if (!cfg.oauthAppId && !cfg.allowPat) throw bad('Users need a way to connect: set up the OAuth application, or accept personal access tokens.', 'GITLAB_NO_AUTH_METHOD');
  return { config: cfg, secrets, testToken: str(body.testToken, 500) || null };
}

// ── the connection test ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CheckRow { id: string; label: string; ok: boolean | null; detail: string; required: boolean }
export interface TestReport { ok: boolean; checks: CheckRow[]; version: string | null; ms: number }

/**
 * Run the checks: the address and CA, the TLS connection, the version API (with the service token, or a token typed only for the test),
 * the OAuth application (Doorkeeper's answer to a dummy authorization code: invalid_grant = the application id and secret are right,
 * invalid_client = they are not), and the service token's user. `ok` = every required check passed.
 */
export async function testConnection(c: Candidate): Promise<TestReport> {
  const t0 = Date.now();
  const checks: CheckRow[] = [];
  const ep = endpointOf(c.config);
  const add = (r: CheckRow): void => { checks.push(r); };
  add({ id: 'address', label: 'Address', ok: true, detail: c.config.baseUrl, required: true });
  if (c.config.caPem) {
    const certs = parseCaBundle(c.config.caPem);
    const expired = certs.filter((x) => Date.parse(x.validTo) < Date.now());
    add({ id: 'ca', label: 'CA certificate', ok: expired.length === 0, detail: expired.length ? `expired: ${expired.map((x) => x.subject).join('; ')}` : certs.map((x) => `${x.subject} (until ${x.validTo.slice(0, 10)})`).join('; '), required: true });
  } else add({ id: 'ca', label: 'CA certificate', ok: null, detail: 'none uploaded: the system trust store is used', required: false });

  // TLS and reachability: /api/v4/version answers 401 without a token, which still proves the TLS handshake and that this is GitLab's API.
  const token = c.secrets.serviceToken || c.testToken;
  let version: string | null = null;
  try {
    const r = await gitlabRequest<{ version?: string; revision?: string }>(ep, { path: '/api/v4/version', auth: token ? { kind: 'private', token } : null }, 'the version API');
    version = r.data?.version ?? null;
    add({ id: 'tls', label: 'TLS connection', ok: true, detail: `${new URL(c.config.baseUrl).host}: certificate trusted`, required: true });
    add({ id: 'version', label: 'Version API', ok: !!version, detail: version ? `GitLab ${version}${r.data?.revision ? ` (${r.data.revision})` : ''}` : 'no version in the answer', required: true });
  } catch (e) {
    const g = e as GitlabError;
    if (g instanceof GitlabError && g.code === 'GITLAB_AUTH') {
      add({ id: 'tls', label: 'TLS connection', ok: true, detail: `${new URL(c.config.baseUrl).host}: certificate trusted`, required: true });
      add({ id: 'version', label: 'Version API', ok: token ? false : null, detail: token ? 'the token was refused' : 'reachable (401 without a token); enter a service token or a test token to read the version', required: !!token });
    } else {
      add({ id: 'tls', label: 'TLS connection', ok: false, detail: (e as Error).message, required: true });
    }
  }
  const reachable = checks.some((x) => x.id === 'tls' && x.ok);

  if (c.config.oauthAppId) {
    if (!reachable) add({ id: 'oauth', label: 'OAuth application', ok: false, detail: 'not checked: GitLab could not be reached', required: true });
    else {
      try {
        await gitlabRequest(ep, { method: 'POST', path: '/oauth/token', form: { grant_type: 'authorization_code', code: `agastya-connection-test-${crypto.randomBytes(6).toString('hex')}`, redirect_uri: redirectUriOf(c.config.appUrl), client_id: c.config.oauthAppId, client_secret: String(c.secrets.clientSecret ?? '') } }, 'the OAuth check');
        add({ id: 'oauth', label: 'OAuth application', ok: false, detail: 'GitLab accepted a dummy authorization code; this is not a GitLab OAuth endpoint', required: true });
      } catch (e) {
        const g = e as GitlabError;
        const upstream = g instanceof GitlabError ? g.upstreamStatus : null;
        const msg = g.message;
        if (upstream === 400 || /invalid_grant/i.test(msg)) add({ id: 'oauth', label: 'OAuth application', ok: true, detail: `application ${c.config.oauthAppId} and its secret are accepted; redirect URI ${redirectUriOf(c.config.appUrl)}`, required: true });
        else if (upstream === 401 || /invalid_client/i.test(msg)) add({ id: 'oauth', label: 'OAuth application', ok: false, detail: 'GitLab does not know this application id and secret (invalid_client)', required: true });
        else add({ id: 'oauth', label: 'OAuth application', ok: false, detail: msg, required: true });
      }
    }
  } else add({ id: 'oauth', label: 'OAuth application', ok: null, detail: 'not set up: users connect with a personal access token', required: false });

  if (c.secrets.serviceToken) {
    if (!reachable) add({ id: 'service', label: 'Service token', ok: false, detail: 'not checked: GitLab could not be reached', required: true });
    else {
      try {
        const u = await gitlabRequest<{ username?: string; name?: string }>(ep, { path: '/api/v4/user', auth: { kind: 'private', token: c.secrets.serviceToken } }, 'the service token');
        add({ id: 'service', label: 'Service token', ok: true, detail: `acts as @${u.data?.username ?? '?'}`, required: true });
      } catch (e) { add({ id: 'service', label: 'Service token', ok: false, detail: (e as Error).message, required: true }); }
    }
  } else add({ id: 'service', label: 'Service token', ok: null, detail: 'none: server-side uploads use the acting user\'s own token', required: false });
  add({ id: 'pat', label: 'Personal access tokens', ok: null, detail: c.config.allowPat ? 'accepted as the fallback' : 'not accepted', required: false });

  const ok = checks.filter((x) => x.required).every((x) => x.ok === true);
  return { ok, checks, version, ms: Date.now() - t0 };
}

/** Save a candidate that passed its test. */
export function saveSettings(c: Candidate, report: TestReport, actorId: string): void {
  if (!report.ok) throw new HttpError(422, 'The connection test did not pass; nothing was saved.', 'GITLAB_TEST_FAILED', { report });
  const secrets: GitlabSecrets = {};
  if (c.secrets.clientSecret) secrets.clientSecret = c.secrets.clientSecret;
  if (c.secrets.serviceToken) secrets.serviceToken = c.secrets.serviceToken;
  repos.gitlab.putSettings({
    config: JSON.stringify(c.config), secrets: Object.keys(secrets).length ? seal(JSON.stringify(secrets)) : null,
    verified_at: nowIso(), verified_version: report.version, updated_at: nowIso(), updated_by: actorId,
  });
}

/** What the administrator's page shows (no secrets). */
export function describeSettings(fallbackAppUrl: string) {
  const s = loadSettings();
  const appUrl = s?.config.appUrl ?? fallbackAppUrl;
  return {
    configured: !!s, enabled: !!(s && s.verifiedAt),
    verifiedAt: s?.verifiedAt ?? null, verifiedVersion: s?.verifiedVersion ?? null, updatedAt: s?.updatedAt ?? null,
    config: s ? { ...s.config, caPem: s.config.caPem } : { baseUrl: '', caPem: null, appUrl, oauthAppId: null, allowPat: true, ...DEFAULTS },
    ca: s?.config.caPem ? (() => { try { return parseCaBundle(s.config.caPem!); } catch { return []; } })() : [],
    hasClientSecret: !!s?.secrets.clientSecret, hasServiceToken: !!s?.secrets.serviceToken, secretProblem: s?.secretProblem ?? null,
    redirectUri: redirectUriOf(appUrl),
    accounts: repos.gitlab.listAccounts().length,
  };
}
