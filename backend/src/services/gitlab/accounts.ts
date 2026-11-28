// =============================================================================
// GitLab accounts of Agastya users (Phase 3, P3-5): OAuth authorization code + PKCE (S256) against the intranet GitLab, a personal access
// token as the fallback, refresh, disconnect and the administrator's revoke. Tokens are sealed at rest and used only on the server.
//
// OAuth: POST /api/gitlab/connect/oauth makes a one-use `state` (bound to the signed-in user, ten minutes) and a PKCE verifier (sealed), and
// answers the authorize URL. GitLab sends the browser back to <appUrl>/api/gitlab/oauth/callback?code&state; the callback takes the state
// (one use), checks it belongs to the same signed-in user, exchanges the code with the verifier and the application secret, reads /user and
// stores the account. A token about to expire is refreshed before use; a refresh GitLab refuses disconnects the account (the person
// reconnects) - never a silent failure later.
// =============================================================================

import crypto from 'crypto';
import { nowIso } from '../../config';
import { repos } from '../../context';
import { bad, HttpError } from '../http';
import { open, seal } from '../secretBox';
import { GitlabError, gitlabRequest, type GitlabAuth } from './http';
import { activeSettings, endpointOf, redirectUriOf } from './settings';
import type { GitlabAccountRow } from '../../repositories/gitlabRepository';

const STATE_MINUTES = 10;
const b64url = (b: Buffer): string => b.toString('base64url');

export interface GitlabUser { id: number; username: string; name?: string; email?: string; public_email?: string; commit_email?: string }

export const notConnected = (): HttpError => new HttpError(409, 'Connect your GitLab account first (your account menu, or the Repository page).', 'GITLAB_NOT_CONNECTED');

/** Where the callback may send the browser: a path of this application, nothing else (no open redirect). */
export function safeReturnTo(raw: unknown): string {
  const s = String(raw ?? '');
  return /^\/(?![/\\])[A-Za-z0-9/_\-.%?=&]*$/.test(s) && !s.includes('..') ? s.slice(0, 300) : '/overview';
}

export function startOauth(userId: string, returnTo: unknown): { authorizeUrl: string } {
  const s = activeSettings();
  if (!s.config.oauthAppId) throw bad('The administrator has not set up GitLab sign-in (OAuth); connect with a personal access token instead.', 'GITLAB_NO_OAUTH');
  repos.gitlab.purgeOauthStates(nowIso());
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const now = Date.now();
  repos.gitlab.putOauthState({ state, user_id: userId, verifier: seal(verifier), return_to: safeReturnTo(returnTo), created_at: new Date(now).toISOString(), expires_at: new Date(now + STATE_MINUTES * 60_000).toISOString() });
  const u = new URL(`${s.config.baseUrl}/oauth/authorize`);
  u.searchParams.set('client_id', s.config.oauthAppId);
  u.searchParams.set('redirect_uri', redirectUriOf(s.config.appUrl));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'api read_user');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return { authorizeUrl: u.toString() };
}

interface TokenAnswer { access_token: string; refresh_token?: string; expires_in?: number; created_at?: number; scope?: string; token_type?: string }

const expiry = (t: TokenAnswer): string | null => (t.expires_in ? new Date(((t.created_at ? t.created_at * 1000 : Date.now())) + t.expires_in * 1000).toISOString() : null);

async function whoAmI(auth: GitlabAuth): Promise<GitlabUser> {
  const s = activeSettings();
  const r = await gitlabRequest<GitlabUser>(endpointOf(s.config), { path: '/api/v4/user', auth }, 'your GitLab user');
  if (!r.data || typeof r.data.id !== 'number') throw new GitlabError(502, 'GitLab did not say who the token belongs to.', 'GITLAB_UPSTREAM');
  return r.data;
}

function store(userId: string, method: 'oauth' | 'pat', me: GitlabUser, t: { token: string; refresh: string | null; expiresAt: string | null; scopes: string | null }): GitlabAccountRow {
  const row: GitlabAccountRow = {
    user_id: userId, method, gitlab_user_id: me.id, gitlab_username: me.username, gitlab_name: me.name ?? null,
    gitlab_email: me.commit_email || me.email || me.public_email || null,
    token: seal(t.token), refresh_token: t.refresh ? seal(t.refresh) : null, expires_at: t.expiresAt, scopes: t.scopes, connected_at: nowIso(), refreshed_at: null,
  };
  repos.gitlab.putAccount(row);
  return row;
}

/** The OAuth callback: returns where to send the browser, and the account. Throws a 400 for a bad/expired/foreign state. */
export async function finishOauth(userId: string, code: string, state: string): Promise<{ returnTo: string; account: GitlabAccountRow }> {
  const s = activeSettings();
  const st = repos.gitlab.takeOauthState(String(state ?? ''));
  if (!st || st.user_id !== userId || Date.parse(st.expires_at) < Date.now()) throw bad('This GitLab sign-in link has expired or belongs to another session. Start "Connect GitLab" again.', 'GITLAB_STATE');
  if (!code) throw bad('GitLab did not send an authorization code.', 'GITLAB_NO_CODE');
  const t = await gitlabRequest<TokenAnswer>(endpointOf(s.config), { method: 'POST', path: '/oauth/token', form: {
    grant_type: 'authorization_code', code: String(code), redirect_uri: redirectUriOf(s.config.appUrl), client_id: String(s.config.oauthAppId), client_secret: String(s.secrets.clientSecret ?? ''), code_verifier: open(st.verifier),
  } }, 'the GitLab sign-in');
  if (!t.data?.access_token) throw new GitlabError(502, 'GitLab did not hand out a token.', 'GITLAB_UPSTREAM');
  const me = await whoAmI({ kind: 'bearer', token: t.data.access_token });
  const account = store(userId, 'oauth', me, { token: t.data.access_token, refresh: t.data.refresh_token ?? null, expiresAt: expiry(t.data), scopes: t.data.scope ?? null });
  return { returnTo: st.return_to ?? '/overview', account };
}

/** Connect with a personal access token (when the administrator accepts them). The token must carry the `api` scope. */
export async function connectWithToken(userId: string, token: string): Promise<GitlabAccountRow> {
  const s = activeSettings();
  if (!s.config.allowPat) throw bad('The administrator does not accept personal access tokens; use "Sign in with GitLab".', 'GITLAB_PAT_OFF');
  const tok = String(token ?? '').trim();
  if (!/^[A-Za-z0-9_\-.]{16,255}$/.test(tok)) throw bad('That is not a GitLab personal access token.', 'GITLAB_BAD_TOKEN');
  const me = await whoAmI({ kind: 'private', token: tok });
  let scopes: string | null = null;
  try {
    const r = await gitlabRequest<{ scopes?: string[]; expires_at?: string | null }>(endpointOf(s.config), { path: '/api/v4/personal_access_tokens/self', auth: { kind: 'private', token: tok } }, 'the token');
    scopes = (r.data?.scopes ?? []).join(' ') || null;
    if (r.data?.scopes && !r.data.scopes.includes('api')) throw bad('The token needs the "api" scope (it has: ' + r.data.scopes.join(', ') + ').', 'GITLAB_TOKEN_SCOPE');
  } catch (e) { if ((e as HttpError).code === 'GITLAB_TOKEN_SCOPE') throw e; /* older GitLab without the endpoint: the first real call says */ }
  return store(userId, 'pat', me, { token: tok, refresh: null, expiresAt: null, scopes });
}

/** The token of a user, refreshed when it is about to expire; throws GITLAB_NOT_CONNECTED. */
export async function authFor(userId: string): Promise<GitlabAuth & object> {
  const s = activeSettings();
  const a = repos.gitlab.getAccount(userId);
  if (!a) throw notConnected();
  let token: string;
  try { token = open(a.token); } catch { repos.gitlab.deleteAccount(userId); throw notConnected(); }
  if (a.method === 'pat') return { kind: 'private', token };
  if (a.expires_at && Date.parse(a.expires_at) - Date.now() < 60_000) {
    if (!a.refresh_token) { repos.gitlab.deleteAccount(userId); throw notConnected(); }
    try {
      const t = await gitlabRequest<TokenAnswer>(endpointOf(s.config), { method: 'POST', path: '/oauth/token', form: {
        grant_type: 'refresh_token', refresh_token: open(a.refresh_token), client_id: String(s.config.oauthAppId), client_secret: String(s.secrets.clientSecret ?? ''), redirect_uri: redirectUriOf(s.config.appUrl),
      } }, 'refreshing your GitLab sign-in');
      if (!t.data?.access_token) throw new Error('no token');
      repos.gitlab.updateTokens(userId, { token: seal(t.data.access_token), refreshToken: t.data.refresh_token ? seal(t.data.refresh_token) : a.refresh_token, expiresAt: expiry(t.data), refreshedAt: nowIso() });
      token = t.data.access_token;
    } catch (e) {
      const g = e as GitlabError;
      if (g instanceof GitlabError && (g.code === 'GITLAB_REFUSED' || g.code === 'GITLAB_AUTH')) { repos.gitlab.deleteAccount(userId); throw notConnected(); }
      throw e;
    }
  }
  return { kind: 'bearer', token };
}

/** The service token, when the administrator set one. */
export function serviceAuth(): GitlabAuth {
  const s = activeSettings();
  return s.secrets.serviceToken ? { kind: 'private', token: s.secrets.serviceToken } : null;
}

/** Disconnect (the user) or revoke (an administrator): an OAuth token is revoked at GitLab too (best effort), then the row goes. */
export async function removeAccount(userId: string): Promise<{ removed: boolean; revokedAtGitlab: boolean }> {
  const a = repos.gitlab.getAccount(userId);
  if (!a) return { removed: false, revokedAtGitlab: false };
  let revoked = false;
  try {
    const s = activeSettings();
    if (a.method === 'oauth' && s.config.oauthAppId) {
      await gitlabRequest(endpointOf(s.config), { method: 'POST', path: '/oauth/revoke', form: { token: open(a.token), client_id: s.config.oauthAppId, client_secret: String(s.secrets.clientSecret ?? '') } }, 'revoking the token');
      revoked = true;
    }
  } catch { /* GitLab unreachable or the feature off: the local row is removed anyway; the token expires at GitLab */ }
  return { removed: repos.gitlab.deleteAccount(userId), revokedAtGitlab: revoked };
}

/** An account as the browser may see it (no token). */
export function accountView(a: GitlabAccountRow | null) {
  if (!a) return null;
  return { method: a.method, gitlabUserId: a.gitlab_user_id, username: a.gitlab_username, name: a.gitlab_name, email: a.gitlab_email, connectedAt: a.connected_at, expiresAt: a.expires_at, scopes: a.scopes };
}
