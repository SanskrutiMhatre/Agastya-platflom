'use strict';
// Session lifecycle: opaque random tokens, stored server-side as SHA-256
// only, delivered in an HttpOnly SameSite=Lax cookie. A fresh session is
// minted at EVERY authentication boundary (login, onboarding completion,
// password change) so a pre-auth cookie value can never ride into an
// authenticated session (no fixation).

const { newToken, sha256hex, newId } = require('./crypto');

const COOKIE_NAME = 'agastya_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days absolute

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function cookieFor(token, { secure = false, maxAgeMs = SESSION_TTL_MS } = {}) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie({ secure = false } = {}) {
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

class SessionService {
  constructor(store, { now = () => new Date(), secureCookies = false } = {}) {
    this.store = store;
    this.now = now;
    // Manual override ONLY: force every cookie Secure regardless of what the
    // request looks like. Per-request auto-detection (isSecureReq, below) is
    // what actually covers the common case — this stays for an operator who
    // wants Secure forced on unconditionally.
    this.secureCookies = secureCookies;
  }

  /*
    Whether THIS request arrived over a channel where a Secure cookie makes
    sense: real TLS on the socket, or (since server.js sets `trust proxy`)
    X-Forwarded-Proto: https from a reverse proxy terminating TLS in front of
    us. Express's req.secure covers both. Deciding this per request, instead
    of once at boot from an env var, means a TLS-terminating proxy added in
    front of a plain-HTTP deployment gets Secure cookies automatically —
    nobody has to remember to also flip JSSPUB_SECURE_COOKIES. A deployment
    with no TLS anywhere (plain HTTP dev, LAN-only, the packaged desktop app
    talking to its own loopback server) is unaffected: req.secure is false,
    so cookies keep working exactly as before.
  */
  isSecureReq(req) {
    return this.secureCookies || !!req?.secure;
  }

  /*
    Mint a session for a user, displacing every other live session for the
    account (single active session). Returns the raw token exactly once —
    only its hash is persisted.
  */
  issue(userId, { ip, userAgent, req } = {}) {
    const token = newToken();
    const now = this.now();
    const { displaced } = this.store.insertSessionDisplacing({
      id: newId(),
      userId,
      tokenHash: sha256hex(token),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      ip, userAgent,
    });
    return { token, displaced, cookie: cookieFor(token, { secure: this.isSecureReq(req) }) };
  }

  // Resolve a request's cookie to session+user in one store query.
  resolveFromCookieHeader(cookieHeader) {
    const token = parseCookies(cookieHeader)[COOKIE_NAME];
    if (!token || token.length < 20 || token.length > 128) return null;
    const row = this.store.resolveSession(sha256hex(token), this.now().toISOString());
    if (!row) return null;
    return {
      session: {
        id: row.session_id,
        createdAt: row.session_created_at,
        expiresAt: row.expires_at,
        lastSeenAt: row.last_seen_at,
      },
      user: {
        id: row.user_id,
        username: row.username,
        fullName: row.full_name,
        role: row.role,
        mustChangePassword: !!row.must_change_password,
        onboardingPending: !!row.onboarding_pending,
        usernameLocked: !!row.username_locked,
        disabledAt: row.disabled_at,
        activeProjectId: row.active_project_id,
        createdAt: row.created_at,
      },
    };
  }

  revokeByCookieHeader(cookieHeader, reason) {
    const token = parseCookies(cookieHeader)[COOKIE_NAME];
    if (!token) return 0;
    const row = this.store.resolveSession(sha256hex(token), this.now().toISOString());
    if (!row) return 0;
    return this.store.revokeSessionById(row.session_id, reason || 'signout', this.now().toISOString());
  }

  clearCookieValue(req) { return clearCookie({ secure: this.isSecureReq(req) }); }
}

module.exports = { SessionService, COOKIE_NAME, SESSION_TTL_MS, parseCookies, cookieFor, clearCookie };
