'use strict';
// WP-09 (QA-004): the authentication and account-administration routes over HTTP - the incident-response paths of a multi-user server
// that had no test (logout, change-password, disable/enable, sessions and revoke, the audit read path, the reset queue, CSV import) and
// the cross-origin refusal. wp03-auth.test.js holds the throttle, the session limits and the security headers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const PW2 = 'blue harbour lantern 7';
let h; let admin;

async function person(name, role = 'author') {
  const m = await admin.post('/api/team/users', { username: name, fullName: `${name} tester`, role });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const c = new h.Client(name); c.id = m.json.user.id;
  assert.equal((await c.post('/api/auth/login', { username: name, password: m.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username: name, password: PW })).status, 200);
  return c;
}
const audit = async (action) => (await admin.get(`/api/admin/audit?action=${encodeURIComponent(action)}&limit=50`)).json.entries;

test.before(async () => {
  h = await boot(); admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
});
test.after(async () => { if (h) await h.close(); });

test('sign-in sets a session cookie with the right attributes; sign-out ends the session server-side and clears the cookie', async () => {
  const c = await person('outgoing');
  const login = await new h.Client('peek').post('/api/auth/login', { username: 'outgoing', password: PW });
  assert.match(login.headers.get('set-cookie'), /^agastya_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
  assert.ok(!/Secure/.test(login.headers.get('set-cookie')), 'no Secure flag over plain HTTP (the loopback desktop case)');
  const proxied = await new h.Client('tls').req('POST', '/api/auth/login', { username: 'outgoing', password: PW }, { 'x-forwarded-proto': 'https' });
  assert.match(proxied.headers.get('set-cookie'), /; Secure/, 'Secure behind a trusted TLS proxy (loopback is trusted by default)');
  // c's own session was displaced by those sign-ins; sign in again and sign out
  assert.equal((await c.post('/api/auth/login', { username: 'outgoing', password: PW })).status, 200);
  const kept = c.cookie;
  const out = await c.post('/api/auth/logout', {});
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie'), /^agastya_session=; .*Max-Age=0/);
  const replay = new h.Client('replay'); replay.cookie = kept;
  const r = await replay.get('/api/auth/me');
  assert.equal(r.status, 401, 'the old cookie value is dead on the server, not only in the browser');
  assert.equal(r.json.code, 'UNAUTHENTICATED', 'a cookie the person signed out is simply not signed in');
  assert.ok((await audit('auth.logout')).some((e) => e.actor === 'outgoing'), 'audited');
});

test('change-password: needs the current password, rotates the session and ends every other session of the account', async () => {
  assert.equal((await admin.put('/api/admin/security-policy', { singleSession: false })).status, 200);
  try {
    const a = await person('changer');
    const b = new h.Client('changer-b'); assert.equal((await b.post('/api/auth/login', { username: 'changer', password: PW })).status, 200);
    assert.equal((await a.get('/api/auth/me')).status, 200); assert.equal((await b.get('/api/auth/me')).status, 200);
    const wrong = await a.post('/api/auth/change-password', { currentPassword: 'not-it-at-all-123', newPassword: PW2 });
    assert.equal(wrong.status, 400); assert.match(wrong.json.error, /Current password is incorrect/);
    const before = a.cookie;
    const ok = await a.post('/api/auth/change-password', { currentPassword: PW, newPassword: PW2 });
    assert.equal(ok.status, 200);
    assert.notEqual(a.cookie, before, 'a fresh session cookie (rotation)');
    assert.equal((await a.get('/api/auth/me')).status, 200, 'the changing session continues on its new cookie');
    const other = await b.get('/api/auth/me');
    assert.equal(other.status, 401, 'the other device is signed out even with the single-session policy off (WP-09 fix)');
    assert.equal(other.json.code, 'SESSION_REVOKED'); assert.match(other.json.error, /password .* was changed/);
    const stale = new h.Client('stale'); stale.cookie = before; assert.equal((await stale.get('/api/auth/me')).status, 401, 'the pre-change cookie is dead');
    assert.equal((await new h.Client('x').post('/api/auth/login', { username: 'changer', password: PW })).status, 401, 'the old password no longer works');
    assert.ok((await audit('auth.password.changed')).some((e) => e.actor === 'changer' && e.meta && e.meta.sessionsRevoked >= 1));
    assert.ok(!JSON.stringify(await audit('auth.password.changed')).includes(PW2), 'the new password is not in the trail');
  } finally { assert.equal((await admin.put('/api/admin/security-policy', { singleSession: true })).status, 200); }
});

test('completing onboarding ends every other session that used the temporary password, also with the single-session policy off', async () => {
  assert.equal((await admin.put('/api/admin/security-policy', { singleSession: false })).status, 200);
  try {
    const m = await admin.post('/api/team/users', { username: 'twotemp', fullName: 'Two Temp', role: 'author' });
    const a = new h.Client('twotemp-a'); const b = new h.Client('twotemp-b');
    for (const c of [a, b]) assert.equal((await c.post('/api/auth/login', { username: 'twotemp', password: m.json.tempPassword })).status, 200);
    assert.equal((await a.post('/api/auth/onboarding', { username: 'twotemp', password: PW })).status, 200);
    assert.equal((await a.get('/api/auth/me')).status, 200);
    assert.equal((await b.get('/api/auth/me')).status, 401, 'whoever else held the temporary password is out');
  } finally { assert.equal((await admin.put('/api/admin/security-policy', { singleSession: true })).status, 200); }
});

test('disable ends the live session and refuses sign-in; enable lets the person back in; the last administrator cannot be disabled', async () => {
  const c = await person('pauser');
  const dis = await admin.post(`/api/admin/users/${c.id}/disable`, {});
  assert.equal(dis.status, 200); assert.ok(dis.json.user.disabledAt || dis.json.user.disabled, JSON.stringify(dis.json.user));
  const me = await c.get('/api/auth/me'); assert.equal(me.status, 401); assert.equal(me.json.code, 'ACCOUNT_DISABLED');
  assert.equal((await new h.Client('p2').post('/api/auth/login', { username: 'pauser', password: PW })).status, 401, 'a correct password does not sign a disabled account in');
  assert.equal((await admin.post(`/api/admin/users/${c.id}/enable`, {})).status, 200);
  assert.equal((await c.post('/api/auth/login', { username: 'pauser', password: PW })).status, 200, 'enabled again');
  assert.equal((await admin.post('/api/admin/users/no-such-user/enable', {})).status, 404);
  const adminId = (await admin.get('/api/auth/me')).json.user.id;
  assert.equal((await admin.post(`/api/admin/users/${adminId}/disable`, {})).status, 409, 'the last active administrator');
  const trail = [...await audit('user.disabled'), ...await audit('user.enabled')];
  assert.ok(trail.some((e) => e.action === 'user.disabled' && e.targetId === c.id) && trail.some((e) => e.action === 'user.enabled' && e.targetId === c.id));
});

test('administrator reset: ends the person\'s sessions, the temporary password opens only the change gate (onboarded) or onboarding (never onboarded)', async () => {
  const c = await person('resetme');
  const r = await admin.post(`/api/admin/users/${c.id}/reset`, {});
  assert.equal(r.status, 200); assert.match(r.json.tempPassword, /^resetme-[a-hjkmnp-z2-9]{8}$/);
  const me = await c.get('/api/auth/me'); assert.equal(me.status, 401, 'the live session ended'); assert.equal(me.json.code, 'SESSION_REVOKED');
  assert.equal((await c.post('/api/auth/login', { username: 'resetme', password: PW })).status, 401, 'the old password is gone');
  assert.equal((await c.post('/api/auth/login', { username: 'resetme', password: r.json.tempPassword })).status, 200);
  assert.equal((await c.get('/api/projects')).json.code, 'PASSWORD_CHANGE_REQUIRED');
  const fresh = await admin.post('/api/team/users', { username: 'neverin', fullName: 'Never In', role: 'author' });
  const r2 = await admin.post(`/api/admin/users/${fresh.json.user.id}/reset`, {});
  const n = new h.Client('neverin'); assert.equal((await n.post('/api/auth/login', { username: 'neverin', password: r2.json.tempPassword })).status, 200);
  assert.equal((await n.get('/api/projects')).json.code, 'ONBOARDING_REQUIRED', 'never onboarded: back through onboarding');
  assert.equal((await c.post(`/api/admin/users/${fresh.json.user.id}/reset`, {})).status, 403, 'only an administrator');
  assert.equal((await admin.post('/api/admin/users/zz-none/reset', {})).status, 404);
});

test('sessions: the administrator lists live sessions and revokes one; the person is told why; nobody else can', async () => {
  const c = await person('revokee');
  const list = await admin.get('/api/admin/sessions');
  assert.equal(list.status, 200);
  const mine = list.json.sessions.find((s) => s.username === 'revokee');
  assert.ok(mine && mine.id && mine.expiresAt, 'listed with its limits');
  assert.ok(!JSON.stringify(list.json).includes(c.cookie.split('=')[1]), 'no token in the listing');
  assert.equal((await c.get('/api/admin/sessions')).status, 403);
  assert.equal((await c.post(`/api/admin/sessions/${mine.id}/revoke`, {})).status, 403, 'a person cannot revoke through the admin route');
  assert.equal((await admin.post(`/api/admin/sessions/${mine.id}/revoke`, {})).status, 200);
  const me = await c.get('/api/auth/me'); assert.equal(me.status, 401); assert.equal(me.json.code, 'SESSION_REVOKED');
  assert.equal((await admin.post(`/api/admin/sessions/${mine.id}/revoke`, {})).status, 404, 'a session already ended');
  assert.ok((await audit('auth.session.revoked')).some((e) => e.targetId === mine.id));
});

test('the audit read path is administrator-only, filters by action, pages, and carries the address', async () => {
  const c = await person('auditee');
  assert.equal((await c.get('/api/admin/audit')).status, 403);
  assert.equal((await new h.Client('anon').get('/api/admin/audit')).status, 401);
  const all = await admin.get('/api/admin/audit?limit=5');
  assert.equal(all.status, 200); assert.equal(all.json.entries.length, 5);
  const ids = all.json.entries.map((e) => e.id); assert.deepEqual([...ids].sort((x, y) => y - x), ids, 'newest first');
  const older = await admin.get(`/api/admin/audit?limit=5&before=${ids[4]}`);
  assert.ok(older.json.entries.every((e) => e.id < ids[4]), 'paging with before');
  const logins = await audit('auth.login');
  assert.ok(logins.length > 0 && logins.every((e) => e.action.startsWith('auth.login')), 'the action filter is a prefix (auth.login, auth.login.failed, ...)');
  assert.ok(logins.some((e) => e.actor === 'auditee' && e.ip), 'who and from where');
  const csv = await admin.get('/api/admin/maintenance/audit.csv');
  assert.equal(csv.status, 200); assert.ok(String(csv.buf).includes('auth.login'));
});

test('cross-origin writes are refused with 403; same-origin and Origin-less writes pass; reads are not affected', async () => {
  const c = await person('origins');
  const foreign = await c.req('POST', '/api/projects', { name: 'X-origin' }, { origin: 'http://evil.example' });
  assert.equal(foreign.status, 403); assert.match(foreign.json.error, /Cross-origin/);
  for (const m of ['PUT', 'PATCH', 'DELETE']) assert.equal((await c.req(m, '/api/folders/zz', {}, { origin: 'http://evil.example' })).status, 403, m);
  assert.equal((await c.req('POST', '/api/auth/login', { username: 'origins', password: PW }, { origin: 'http://evil.example' })).status, 403, 'login CSRF refused');
  assert.equal((await c.req('POST', '/api/projects', { name: 'Same origin' }, { origin: h.base })).status, 201);
  assert.equal((await c.req('POST', '/api/projects', { name: 'No origin' })).status, 201);
  assert.equal((await c.req('GET', '/api/projects', undefined, { origin: 'http://evil.example' })).status, 200, 'a read carries no state change');
});

test('forgot-password: a neutral 202 whether or not the account exists; it shares the sign-in limit; the queue is approved or rejected by an administrator', async () => {
  const c = await person('forgetful');
  const anon = new h.Client('anon2');
  const known = await anon.post('/api/auth/forgot', { username: 'forgetful' });
  const unknown = await anon.post('/api/auth/forgot', { username: 'nobody-here' });
  assert.equal(known.status, 202); assert.equal(unknown.status, 202);
  assert.deepEqual(known.json, unknown.json, 'the same body: no account enumeration');
  const q = await admin.get('/api/admin/resets'); assert.equal(q.status, 200);
  const req = q.json.requests.find((r) => r.username === 'forgetful'); assert.ok(req, 'queued');
  assert.equal(q.json.requests.filter((r) => r.username === 'nobody-here').length, 0);
  assert.equal((await c.get('/api/admin/resets')).status, 403);
  const ap = await admin.post(`/api/admin/resets/${req.id}/approve`, {});
  assert.equal(ap.status, 200); assert.match(ap.json.tempPassword, /^forgetful-/);
  assert.equal((await admin.post(`/api/admin/resets/${req.id}/approve`, {})).status, 404, 'decided once');
  const back = new h.Client('forgetful-back');
  assert.equal((await back.post('/api/auth/login', { username: 'forgetful', password: ap.json.tempPassword })).status, 200);
  assert.equal((await back.get('/api/projects')).json.code, 'PASSWORD_CHANGE_REQUIRED', 'the temporary password only opens the change gate');
  assert.equal((await back.post('/api/auth/change-password', { currentPassword: ap.json.tempPassword, newPassword: PW2 })).status, 200);
  assert.equal((await back.get('/api/projects')).status, 200);
  // reject
  await anon.post('/api/auth/forgot', { username: 'forgetful' });
  const again = (await admin.get('/api/admin/resets')).json.requests.find((r) => r.username === 'forgetful');
  assert.equal((await admin.post(`/api/admin/resets/${again.id}/reject`, {})).status, 200);
  assert.equal((await admin.post(`/api/admin/resets/${again.id}/reject`, {})).status, 404);
  assert.equal((await back.get('/api/auth/me')).status, 200, 'a rejected request changes nothing');
  // the shared limit: ten requests for one name, then even a correct sign-in is refused for the window
  for (let i = 0; i < 10; i++) await anon.req('POST', '/api/auth/forgot', { username: 'pm-limit' }, { 'x-forwarded-for': `198.18.0.${i}` });
  const limited = await anon.req('POST', '/api/auth/forgot', { username: 'pm-limit' }, { 'x-forwarded-for': '198.18.1.1' });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('CSV import: preview reports every row; commit is all or nothing; new accounts start in onboarding', async () => {
  const c = await person('csvuser');
  const good = 'username,full_name,role\nimp.one,Imp One,author\nimp.two,Imp Two,project_manager\n';
  const bad = 'username,full_name,role\nimp.three,Imp Three,author\nadmin,Reserved Name,author\nimp.three,Duplicate,author\n';
  assert.equal((await c.post('/api/admin/users/import/preview', { csv: good })).status, 403);
  const pv = await admin.post('/api/admin/users/import/preview', { csv: bad });
  assert.equal(pv.status, 200); assert.equal(pv.json.valid, 1); assert.equal(pv.json.invalid, 2);
  assert.ok(pv.json.rows.find((r) => r.line === 3).errors.length > 0, 'the reserved name');
  assert.equal((await admin.post('/api/admin/users/import/preview', { csv: '' })).status, 400);
  const refused = await admin.post('/api/admin/users/import/commit', { csv: bad });
  assert.equal(refused.status, 400);
  const users = async () => (await admin.get('/api/admin/users')).json.users.map((u) => u.username);
  assert.ok(!(await users()).includes('imp.three'), 'nothing was written');
  const ok = await admin.post('/api/admin/users/import/commit', { csv: good });
  assert.equal(ok.status, 200); assert.equal(ok.json.created.length, 2);
  const one = ok.json.created.find((x) => x.user.username === 'imp.one');
  const n = new h.Client('imp.one');
  assert.equal((await n.post('/api/auth/login', { username: 'imp.one', password: one.tempPassword })).status, 200);
  assert.equal((await n.get('/api/projects')).json.code, 'ONBOARDING_REQUIRED');
  assert.equal((await admin.post('/api/admin/users/import/commit', { csv: good })).status, 400, 'a second commit of the same names is refused');
});
