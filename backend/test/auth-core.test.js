'use strict';
// WP-09 (QA-004): the authentication core as units - no server. The sign-in throttle with an injected clock, the session service
// with an injected clock (absolute and idle limits, displacement, revocation, the reason a cookie stopped working), the password
// policy table, the grant rule, password hashing (the argon2 path and the scrypt fallback) and the same-origin rule.
// The HTTP side is auth-http.test.js; the role x route matrix is authz-matrix.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { RateLimiter, MAX_ATTEMPTS, WINDOW_MS } = require('../dist/core/auth/rateLimit');
const { SessionService, COOKIE_NAME, parseCookies, cookieFor, clearCookie } = require('../dist/core/auth/sessions');
const { AuthStore } = require('../dist/core/auth/store');
const policy = require('../dist/core/auth/policy');
const { checkGrant } = require('../dist/core/auth/grants');
const authCrypto = require('../dist/core/auth/crypto');
const { originAllowed } = require('../dist/services/origin');

// ---- sign-in throttle --------------------------------------------------------------------------------------------------------------------

test('throttle: ten attempts per account in the window, the eleventh refused with a Retry-After that counts down; the window slides', () => {
  let t = 1_000_000; const rl = new RateLimiter({ now: () => t });
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal(rl.attempt('Asha', `10.0.0.${i}`).allowed, true, `attempt ${i + 1}`);
  const r = rl.attempt('asha', '10.0.0.99');
  assert.equal(r.allowed, false, 'the eleventh attempt, from another address and in another case, is refused');
  assert.equal(r.retryAfterSeconds, WINDOW_MS / 1000);
  t += 60_000; assert.equal(rl.attempt('ASHA', '10.0.0.1').retryAfterSeconds, WINDOW_MS / 1000 - 60, 'Retry-After counts down');
  t = 1_000_000 + WINDOW_MS; assert.equal(rl.attempt('asha', '10.0.0.1').allowed, true, 'the oldest attempt left the window');
});

test('throttle: two people behind one address do not lock each other out; a success clears only that account', () => {
  const t = 5_000_000; const rl = new RateLimiter({ now: () => t });
  for (let i = 0; i < MAX_ATTEMPTS; i++) rl.attempt('ravi', '192.0.2.1');
  assert.equal(rl.attempt('ravi', '192.0.2.1').allowed, false);
  assert.equal(rl.attempt('meena', '192.0.2.1').allowed, true, 'another account from the same address');
  rl.clear('meena', '192.0.2.1');
  assert.equal(rl.attempt('ravi', '192.0.2.1').allowed, false, 'clearing meena does not clear ravi');
});

test('throttle: one address cycling through usernames is limited; the per-account counter lives in the store', () => {
  const t = 9_000_000; const rows = new Map();
  const store = { throttleGet: (k) => rows.get(k) || [], throttlePut: (k, a) => { if (a.length) rows.set(k, a); else rows.delete(k); }, throttlePrune: () => {} };
  const rl = new RateLimiter({ now: () => t, ipMax: 5, store });
  for (let i = 0; i < 5; i++) assert.equal(rl.attempt(`user${i}`, '203.0.113.9').allowed, true);
  assert.equal(rl.attempt('user99', '203.0.113.9').allowed, false, 'the address is limited across usernames');
  assert.deepEqual(rows.get('user0'), [t], 'the account counter is in the store (it survives a restart)');
  const again = new RateLimiter({ now: () => t, store });
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) again.attempt('user0', `198.51.100.${i}`);
  assert.equal(again.attempt('user0', '198.51.100.200').allowed, false, 'a new limiter (a restart) continues the stored count');
});

// ---- sessions ------------------------------------------------------------------------------------------------------------------------------

function sessionWorld(policyValue = { idleMinutes: 30, absoluteHours: 12, singleSession: true }) {
  const db = new DatabaseSync(':memory:'); const store = new AuthStore(db);
  let t = Date.parse('2026-11-27T08:00:00Z'); const now = () => new Date(t);
  // the two tables the vendored registry (vendor/engine/db.js open()) creates before the auth migrations run
  db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'JSS', template TEXT DEFAULT 'default', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened TEXT); CREATE TABLE files (project_id TEXT NOT NULL, rel_path TEXT NOT NULL, kind TEXT NOT NULL, chapter TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, rel_path));");
  store.migrate(now().toISOString());
  const user = store.createUser({ id: 'u1', username: 'asha', fullName: 'Asha Rao', role: 'author', passwordHash: 'x', now: now().toISOString() });
  const svc = new SessionService(store, { now, policy: { read: () => policyValue } });
  const cookieHeader = (issued) => issued.cookie.split(';')[0];
  return { store, svc, user, cookieHeader, advance: (ms) => { t += ms; }, db };
}

test('sessions: the cookie is HttpOnly, SameSite=Lax, Path=/, its Max-Age is the absolute limit; Secure on a secure request; only the hash is stored', () => {
  const w = sessionWorld();
  const s = w.svc.issue('u1', { ip: '127.0.0.1' });
  assert.match(s.cookie, new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200$`));
  assert.match(w.svc.issue('u1', { req: { secure: true } }).cookie, /; Secure$/);
  assert.match(clearCookie({}), /Max-Age=0/);
  const token = s.cookie.split(';')[0].split('=')[1];
  const raw = JSON.stringify(w.db.prepare('SELECT * FROM sessions').all());
  assert.ok(!raw.includes(token), 'the raw token is never stored');
  assert.equal(parseCookies('a=1; agastya_session="abc%20d"; b').agastya_session, 'abc d');
  assert.match(cookieFor('t', { maxAgeMs: 1000 }), /Max-Age=1/);
});

test('sessions: absolute limit and idle limit end a session, with the reason the next request is told', () => {
  const w = sessionWorld();
  const a = w.svc.issue('u1'); const ch = w.cookieHeader(a);
  assert.equal(w.svc.resolveFromCookieHeader(ch).user.username, 'asha');
  w.advance(29 * 60_000); assert.ok(w.svc.resolveFromCookieHeader(ch), 'used within the idle limit');
  w.store.touchSession(w.svc.resolveFromCookieHeader(ch).session.id, new Date(Date.parse('2026-11-27T08:29:00Z')).toISOString());
  w.advance(31 * 60_000);
  assert.equal(w.svc.resolveFromCookieHeader(ch), null, 'idle for 31 minutes');
  assert.equal(w.svc.endReasonFromCookieHeader(ch), 'idle');
  // absolute: keep it busy, it still ends after 12 hours
  const b = w.svc.issue('u1'); const bh = w.cookieHeader(b);
  for (let i = 0; i < 12 * 4; i++) { w.advance(15 * 60_000); const r = w.svc.resolveFromCookieHeader(bh); if (r) w.store.touchSession(r.session.id, new Date(Date.parse(r.session.lastSeenAt) + 15 * 60_000).toISOString()); }
  assert.equal(w.svc.resolveFromCookieHeader(bh), null, 'ended at the absolute limit although it was in use');
  assert.equal(w.svc.endReasonFromCookieHeader(bh), 'expired');
});

test('sessions: a new sign-in displaces the other (single session); with the policy off both live; revoke and disable end it', () => {
  const w = sessionWorld();
  const first = w.cookieHeader(w.svc.issue('u1'));
  const second = w.svc.issue('u1');
  assert.equal(second.displaced, 1);
  assert.equal(w.svc.resolveFromCookieHeader(first), null); assert.equal(w.svc.endReasonFromCookieHeader(first), 'displaced');
  const multi = sessionWorld({ idleMinutes: 0, absoluteHours: 12, singleSession: false });
  const m1 = multi.cookieHeader(multi.svc.issue('u1')); const m2 = multi.cookieHeader(multi.svc.issue('u1'));
  assert.ok(multi.svc.resolveFromCookieHeader(m1) && multi.svc.resolveFromCookieHeader(m2), 'both sessions live');
  assert.equal(multi.svc.revokeByCookieHeader(m1, 'signout'), 1);
  assert.equal(multi.svc.resolveFromCookieHeader(m1), null); assert.equal(multi.svc.endReasonFromCookieHeader(m1), 'signout');
  assert.ok(multi.svc.resolveFromCookieHeader(m2), 'the other session is untouched');
  multi.store.updateUser('u1', { disabled_at: new Date().toISOString() }, new Date().toISOString());
  assert.equal(multi.svc.resolveFromCookieHeader(m2), null, 'a disabled account signs nobody in');
  assert.equal(multi.svc.endReasonFromCookieHeader(m2), 'disabled');
  assert.equal(w.svc.resolveFromCookieHeader(`${COOKIE_NAME}=short`), null, 'a malformed token');
  assert.equal(w.svc.resolveFromCookieHeader(''), null);
});

// ---- password policy ---------------------------------------------------------------------------------------------------------------------

test('password policy: the accept/refuse table', () => {
  const ctx = { min: 15, context: ['asha.rao', 'Asha Rao'] };
  const table = [
    ['', false], ['short-pass-12', false], ['x'.repeat(129), false], ['password123', false, { min: 8 }], ['Password123', false, { min: 8 }],
    ['asha.rao-2026-!!', false], ['AshaRao!!2026###', false], ['agastya-123456789', false], ['Publisher-2026-2026!', false],
    ['blue harbour lantern 7', true], ['correct horse battery staple', true], ['x'.repeat(128), true],
  ];
  for (const [pw, ok, opts] of table) assert.equal(policy.validatePassword(pw, opts || ctx).ok, ok, JSON.stringify(pw));
  assert.equal(policy.validatePassword(12345678).ok, false, 'not a string');
});

test('usernames, names and temporary passwords', () => {
  assert.equal(policy.validateUsername('Asha.Rao').username, 'asha.rao');
  for (const bad of ['ab', '-asha', 'asha rao', 'a'.repeat(33), 'admin', 'root', 'api']) assert.equal(policy.validateUsername(bad).ok, false, bad);
  assert.equal(policy.validateUsername('admin', { allowReserved: true }).ok, true, 'only bootstrap may take a reserved name');
  assert.equal(policy.validateFullName('  Asha   Rao ').fullName, 'Asha Rao'); assert.equal(policy.validateFullName('').ok, false);
  assert.match(policy.tempPasswordFor('Asha'), /^asha-[a-hjkmnp-z2-9]{8}$/);
  assert.equal(policy.suggestUsername('Asha Rao', (u) => u === 'asha'), 'asha.r');
});

// ---- grants ------------------------------------------------------------------------------------------------------------------------------

test('grants: who may give whom which project role', () => {
  const author = { role: 'author' }; const pm = { role: 'project_manager' };
  const g = (actorRole, target, role, currentRole) => checkGrant({ actor: {}, actorRole, target, role, currentRole });
  assert.equal(g('owner', author, 'editor').ok, true);
  assert.equal(g('owner', author, 'manager').status, 400, 'an Author never gets manager');
  assert.equal(g('owner', pm, 'manager').ok, true);
  assert.equal(g('owner', author, 'owner').ok, true);
  assert.equal(g('manager', author, 'owner').status, 403, 'only an owner makes an owner');
  assert.equal(g('manager', pm, 'manager').status, 403, 'a manager cannot make a manager');
  assert.equal(g('manager', author, 'editor').ok, true);
  assert.equal(g('manager', author, 'viewer', 'owner').status, 403, 'a manager cannot change an owner');
  assert.equal(g('manager', pm, undefined, 'manager').status, 403, 'nor remove a manager');
  assert.equal(g('owner', author, 'superuser').status, 400, 'unknown role');
});

// ---- password hashing --------------------------------------------------------------------------------------------------------------------

test('hashing: argon2id when the binding loads, scrypt otherwise; both verify; a tampered or unknown hash never verifies', async () => {
  const h = await authCrypto.hashPassword('blue harbour lantern 7');
  if (authCrypto.usingArgon2()) assert.match(h, /^\$argon2id\$/); else assert.match(h, /^\$scrypt\$/);
  assert.equal(await authCrypto.verifyPassword(h, 'blue harbour lantern 7'), true);
  assert.equal(await authCrypto.verifyPassword(h, 'blue harbour lantern 8'), false);
  // the fallback path, whichever is active: a scrypt hash in the documented format verifies
  const crypto = require('node:crypto'); const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('fallback secret 99', salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * (1 << 15) * 8 * 2 });
  const scrypt = `$scrypt$N=32768,r=8,p=1$${salt.toString('base64')}$${key.toString('base64')}`;
  assert.equal(await authCrypto.verifyPassword(scrypt, 'fallback secret 99'), true, 'scrypt fallback hashes verify');
  assert.equal(await authCrypto.verifyPassword(scrypt, 'fallback secret 98'), false);
  const flipped = scrypt.slice(0, -4) + (scrypt.slice(-4, -3) === 'A' ? 'B' : 'A') + scrypt.slice(-3);
  assert.equal(await authCrypto.verifyPassword(flipped, 'fallback secret 99'), false, 'a tampered hash');
  for (const junk of ['', null, 'plain', '$md5$abc', '$scrypt$N=x']) assert.equal(await authCrypto.verifyPassword(junk, 'x'), false, String(junk));
  assert.equal(await authCrypto.dummyVerify('x'), false);
  assert.match(authCrypto.newToken(), /^[A-Za-z0-9_-]{43}$/); assert.notEqual(authCrypto.newToken(), authCrypto.newToken());
  assert.equal(authCrypto.sha256hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

// ---- same-origin rule --------------------------------------------------------------------------------------------------------------------

test('origin rule: same host or no Origin passes; another origin, a lookalike or a malformed value is refused', () => {
  assert.equal(originAllowed(undefined, 'host:4040'), true, 'no Origin: not a browser page');
  assert.equal(originAllowed('http://host:4040', 'host:4040'), true);
  assert.equal(originAllowed('https://host:4040', 'host:4040'), true, 'the scheme does not matter, the host and port do');
  for (const o of ['http://host:4041', 'http://evil.example', 'http://host:4040.evil.example', 'null', 'not a url', 'http://HOST:4040x']) assert.equal(originAllowed(o, 'host:4040'), false, o);
  assert.equal(originAllowed('http://localhost:5174', 'localhost:4040'), true, 'the development server origin (AGASTYA_DEV_ORIGINS default)');
});
