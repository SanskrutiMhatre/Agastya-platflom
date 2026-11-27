'use strict';
// WP-09 (QA-005, ARC-016, G-SEC-10): the role x route authorisation matrix.
//
// routes-guarded.test.js proves that every route has A guard; this file pins WHICH guard, and what it does for every kind of caller.
//
//   1. The matrix is derived from the live router: for every API route (method + path, with every route layer registered for that pair
//      chained in order, as Express runs them) every guard is called in-process for twelve principals - anonymous, a person still in
//      onboarding, a person forced to change the password, a plain Author and a Project Manager who are not members, the administrator,
//      and one member per project role (viewer, reviewer, editor, manager, owner). The result ('ok', 401, 403, 404) is compared with the
//      committed snapshot test/fixtures/authz-policy.snapshot.json. A new route, a removed route or a changed guard changes the snapshot,
//      so the change needs a reviewed diff (AGASTYA_UPDATE_AUTHZ_SNAPSHOT=1 rewrites it).
//   2. The boundaries are then proved over HTTP, end to end: anonymous 401 on every non-public route; a non-member gets the uniform 404
//      on every project route; the role one step below the minimum gets 403; the minimum role gets past the guard on every GET.
//   3. Policy rules hold for every route: project writes guarded at viewer level and state-changing routes guarded only by sign-in
//      (the handler decides) each need a stated reason in test/fixtures/authz-allow.json - the owner-blessed list of intended differences.
//   4. Every route is referenced by at least one other test, e2e spec or script, or is listed (with a reason) as not yet referenced.
//      The list may only shrink: a listed route that a test now references fails until it is taken off the list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const SNAPSHOT = path.join(__dirname, 'fixtures', 'authz-policy.snapshot.json');
const ALLOW = path.join(__dirname, 'fixtures', 'authz-allow.json');
const GLOBAL = ['anon', 'onboarding', 'pwchange', 'author', 'pm', 'admin'];
const MEMBERS = ['viewer', 'reviewer', 'editor', 'manager', 'owner'];
const PRINCIPALS = [...GLOBAL, ...MEMBERS];
const RANK = { viewer: 1, reviewer: 2, editor: 3, manager: 4, owner: 5 };
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// The 403 codes a guard answers with; a 403 with any other code comes from a handler (the request got past the guard).
const GUARD_403 = new Set(['INSUFFICIENT_ROLE', 'ADMIN_ONLY', 'ROLE_REQUIRED', 'ONBOARDING_REQUIRED', 'PASSWORD_CHANGE_REQUIRED', 'PROJECT_PENDING', 'PROJECT_CLOSED']);

let h; let app; let pid; const who = {};

test.before(async () => {
  h = await boot();
  const admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  who.admin = admin; who.anon = new h.Client('anon');
  const make = async (name, role = 'author', { onboard = true } = {}) => {
    const m = await admin.post('/api/team/users', { username: name, fullName: `${name} tester`, role });
    assert.equal(m.status, 201, JSON.stringify(m.json));
    const c = new h.Client(name); c.id = m.json.user.id;
    assert.equal((await c.post('/api/auth/login', { username: name, password: m.json.tempPassword })).status, 200);
    if (onboard) assert.equal((await c.post('/api/auth/onboarding', { username: name, password: PW })).status, 200);
    return c;
  };
  who.onboarding = await make('mxonboard', 'author', { onboard: false });
  // forced password change: an onboarded person whose password the administrator reset
  const pw = await make('mxpwchange');
  const reset = await admin.post(`/api/admin/users/${pw.id}/reset`, {});
  assert.equal(reset.status, 200);
  who.pwchange = new h.Client('mxpwchange');
  assert.equal((await who.pwchange.post('/api/auth/login', { username: 'mxpwchange', password: reset.json.tempPassword })).status, 200);
  assert.equal((await who.pwchange.get('/api/auth/me')).json.user.mustChangePassword, true, 'the reset forces a password change');
  who.author = await make('mxauthor');
  who.pm = await make('mxpm', 'project_manager');
  who.owner = await make('mxowner');
  for (const r of ['viewer', 'reviewer', 'editor', 'manager']) who[r] = await make(`mx${r}`);
  const mk = await who.owner.post('/api/projects', { name: 'Matrix', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(mk.status, 201, JSON.stringify(mk.json)); pid = mk.json.project.id;
  for (const r of ['viewer', 'reviewer', 'editor', 'manager']) {
    assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: `mx${r}`, role: r })).status, 200);
  }
  const members = (await who.owner.get(`/api/projects/${pid}/members`)).json.members;
  for (const r of MEMBERS) assert.ok(members.some((m) => m.username === `mx${r}` && m.role === r), `member ${r}`);
  app = require('../dist/app').createApp();
});
test.after(async () => { if (h) await h.close(); });

/** Every /api route of the live router as { key: 'METHOD /path', method, path, layers: [route], routerLayers: [Layer] } in registration order. */
function routeTable() {
  const byKey = new Map();
  for (const layer of app._router.stack) {
    if (!layer.route || !String(layer.route.path).startsWith('/api/')) continue;
    for (const m of Object.keys(layer.route.methods)) {
      const method = m.toUpperCase(); const key = `${method} ${layer.route.path}`;
      if (!byKey.has(key)) byKey.set(key, { key, method, path: layer.route.path, layers: [], routerLayers: [] });
      byKey.get(key).layers.push(layer.route); byKey.get(key).routerLayers.push(layer);
    }
  }
  return [...byKey.values()];
}
const guardsOf = (route) => route.stack.map((s) => s.handle).filter((f) => f.isAuthGuard || f.isPublicMarker);
const guardLabel = (r) => r.layers.map((l) => guardsOf(l).map((g) => g.isAuthGuard || 'public').join('+')).join(' > ');
const isProjectRoute = (r) => r.layers.some((l) => guardsOf(l).some((g) => /^requireProject/.test(g.isAuthGuard || '')));
const isPublic = (r) => r.layers.some((l) => guardsOf(l).some((g) => g.isPublicMarker));
/** The minimum project role of a project route: the strictest guard of its chain (every guard must let the caller through). */
const minRole = (r) => r.layers.flatMap((l) => guardsOf(l)).map((g) => /^requireProject\((\w+)/.exec(g.isAuthGuard || '')).filter(Boolean)
  .map((m) => m[1]).sort((a, b) => RANK[b] - RANK[a])[0];

/** Run the guards of a route chain in-process for one principal: 'ok', or the status (and code) the first refusing guard answers. */
function decide(r, client) {
  // The parameters exactly as Express would give them for the URL the HTTP probes send (a repeated parameter name overwrites the first).
  const url = urlFor(r); const headers = client && client.cookie ? { cookie: client.cookie, 'x-agastya-background': '1' } : { 'x-agastya-background': '1' };
  for (const [i, l] of r.layers.entries()) {
    const rl = r.routerLayers[i]; assert.ok(rl.match(url), `${url} does not match ${r.key}`);
    const req = { headers, params: { ...rl.params }, query: {}, method: r.method, url };
    for (const g of guardsOf(l)) {
      if (g.isPublicMarker) continue;
      let passed = false; const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
      g(req, res, () => { passed = true; });
      if (!passed) return String(res.statusCode);
    }
  }
  return 'ok';
}

function matrix() {
  const routes = {};
  for (const r of routeTable().sort((a, b) => a.key.localeCompare(b.key))) {
    const cells = PRINCIPALS.map((p) => decide(r, who[p]));
    routes[r.key] = `${guardLabel(r)} :: ${cells.slice(0, GLOBAL.length).join(' ')} | ${cells.slice(GLOBAL.length).join(' ')}`;
  }
  return { _about: 'WP-09 role x route matrix (backend/test/authz-matrix.test.js). Each row: guard chain :: result for the columns. Regenerate with AGASTYA_UPDATE_AUTHZ_SNAPSHOT=1 and review the diff.', _columns: `${GLOBAL.join(' ')} | ${MEMBERS.join(' ')}`, routes };
}

test('the effective authorisation policy of every route matches the reviewed snapshot', () => {
  const now = matrix();
  if (process.env.AGASTYA_UPDATE_AUTHZ_SNAPSHOT === '1') { fs.writeFileSync(SNAPSHOT, `${JSON.stringify(now, null, 1)}\n`); return; }
  assert.ok(fs.existsSync(SNAPSHOT), 'no snapshot yet: run once with AGASTYA_UPDATE_AUTHZ_SNAPSHOT=1 and commit test/fixtures/authz-policy.snapshot.json');
  const was = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const added = Object.keys(now.routes).filter((k) => !(k in was.routes));
  const removed = Object.keys(was.routes).filter((k) => !(k in now.routes));
  const changed = Object.keys(now.routes).filter((k) => k in was.routes && was.routes[k] !== now.routes[k]).map((k) => `${k}\n      was ${was.routes[k]}\n      now ${now.routes[k]}`);
  assert.equal(now._columns, was._columns, 'principal columns');
  assert.deepEqual({ added, removed, changed }, { added: [], removed: [], changed: [] },
    'the authorisation policy changed: review the difference, then regenerate the snapshot with AGASTYA_UPDATE_AUTHZ_SNAPSHOT=1');
  assert.ok(Object.keys(now.routes).length > 250, `the whole route table (${Object.keys(now.routes).length})`);
});

test('policy rules hold for every route (100% of routes classified)', () => {
  const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
  const problems = []; const counts = {};
  const gateExits = { onboarding: new Set(allow.onboardingGateExits), pwchange: new Set(allow.passwordChangeGateExits) };
  for (const r of routeTable()) {
    // A repeated parameter name: Express keeps the last value, so `/api/projects/:id/x/:id` hands the guard the wrong project id
    // (found by this matrix: packages/import-reports/:id answered 404 to everyone).
    const names = (r.path.match(/:\w+/g) || []);
    if (new Set(names).size !== names.length) problems.push(`${r.key}: a parameter name is used twice`);
    const cells = Object.fromEntries(PRINCIPALS.map((p) => [p, decide(r, who[p])]));
    let cls;
    if (isPublic(r)) cls = 'public';
    else if (isProjectRoute(r)) cls = `project:${minRole(r)}`;
    else cls = guardLabel(r);
    counts[cls] = (counts[cls] || 0) + 1;
    if (cls === 'public') { if (PRINCIPALS.some((p) => cells[p] !== 'ok')) problems.push(`${r.key}: public route refuses someone`); continue; }
    if (cells.anon !== '401') problems.push(`${r.key}: anonymous gets ${cells.anon}, not 401`);
    for (const g of ['onboarding', 'pwchange']) {
      const want = gateExits[g].has(r.key) ? 'ok' : '403';
      if (cells[g] !== want) problems.push(`${r.key}: ${g} gets ${cells[g]}, expected ${want}`);
    }
    if (cells.admin !== 'ok') problems.push(`${r.key}: the administrator is refused (${cells.admin})`);
    if (isProjectRoute(r)) {
      const need = RANK[minRole(r)];
      for (const p of ['author', 'pm']) if (cells[p] !== '404') problems.push(`${r.key}: non-member ${p} gets ${cells[p]}, not the uniform 404`);
      for (const m of MEMBERS) { const want = RANK[m] >= need ? 'ok' : '403'; if (cells[m] !== want) problems.push(`${r.key}: ${m} gets ${cells[m]}, expected ${want}`); }
      if (WRITE.has(r.method) && need === RANK.viewer && !allow.viewerWrites[r.key]) problems.push(`${r.key}: a state-changing project route guarded at viewer level needs a reason in authz-allow.json viewerWrites`);
    } else if (cls === 'requireAdmin') {
      for (const p of ['author', 'pm', ...MEMBERS]) if (cells[p] !== '403') problems.push(`${r.key}: ${p} gets ${cells[p]} on an administrator route`);
    } else if (cls === 'requireRoles(admin,project_manager)') {
      if (cells.pm !== 'ok') problems.push(`${r.key}: the Project Manager is refused`);
      for (const p of ['author', ...MEMBERS]) if (cells[p] !== '403') problems.push(`${r.key}: ${p} gets ${cells[p]}`);
    } else if (cls === 'requireAuth') {
      for (const p of ['author', 'pm', ...MEMBERS]) if (cells[p] !== 'ok') problems.push(`${r.key}: signed-in ${p} gets ${cells[p]}`);
      if (WRITE.has(r.method) && !allow.authOnlyWrites[r.key]) problems.push(`${r.key}: a state-changing route guarded only by sign-in needs a reason in authz-allow.json authOnlyWrites (the handler must decide)`);
    } else problems.push(`${r.key}: unclassified guard chain "${cls}"`);
  }
  for (const k of [...Object.keys(allow.viewerWrites), ...Object.keys(allow.authOnlyWrites)]) if (!routeTable().some((r) => r.key === k)) problems.push(`authz-allow.json lists ${k}, which is not a route any more`);
  assert.deepEqual(problems, []);
  // the classes seen; every route falls in exactly one of them
  assert.deepEqual(Object.keys(counts).sort(), ['project:editor', 'project:manager', 'project:owner', 'project:reviewer', 'project:viewer', 'public', 'requireAdmin', 'requireAuth', 'requireRoles(admin,project_manager)'].sort(), JSON.stringify(counts));
});

/** A URL for a route: the project id for :id on a project route, harmless placeholders for the rest. */
function urlFor(r) {
  const proj = isProjectRoute(r);
  return r.path.replace(/:(\w+)/g, (_m, k) => (k === 'id' && proj ? pid : k === 'file' ? 'ZZ-MATRIX.XML' : 'zzmatrix')).replace(/\*/g, 'x');
}
const send = (c, r) => c.req(r.method, urlFor(r), WRITE.has(r.method) ? {} : undefined);

test('over HTTP: anonymous 401 on every non-public route; a non-member gets the uniform 404 on every project route', async () => {
  const bad = [];
  for (const r of routeTable()) {
    if (isPublic(r)) continue;
    const a = await send(who.anon, r); if (a.status !== 401) bad.push(`anon ${r.key} -> ${a.status}`);
    if (!isProjectRoute(r)) continue;
    const o = await send(who.author, r);
    if (o.status !== 404 || JSON.stringify(o.json) !== '{"error":"Not found"}') bad.push(`non-member ${r.key} -> ${o.status} ${JSON.stringify(o.json)}`);
  }
  assert.deepEqual(bad, []);
});

test('over HTTP: one step below the minimum role is refused with 403 by the guard', async () => {
  const bad = []; let n = 0;
  for (const r of routeTable()) {
    if (isPublic(r)) continue;
    let below = null;
    if (isProjectRoute(r)) below = MEMBERS[RANK[minRole(r)] - 2] || null;
    else if (guardLabel(r) === 'requireAdmin') below = 'pm';
    else if (guardLabel(r) === 'requireRoles(admin,project_manager)') below = 'author';
    if (!below) continue;
    n++;
    const res = await send(who[below], r);
    if (res.status !== 403 || !GUARD_403.has(res.json && res.json.code)) bad.push(`${below} ${r.key} -> ${res.status} ${JSON.stringify(res.json)}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(n > 150, `boundary requests sent: ${n}`);
});

test('over HTTP: the minimum role gets past the guard on every GET route', async () => {
  const bad = []; let n = 0;
  for (const r of routeTable()) {
    if (r.method !== 'GET' || isPublic(r)) continue;
    // A GET that builds the publication first (about 25 s of FOP); its guard is pinned by the in-process matrix and the below-minimum probe.
    if (r.key === 'GET /api/projects/:id/publish/download') continue;
    let p;
    if (isProjectRoute(r)) p = minRole(r);
    else if (guardLabel(r) === 'requireAdmin') p = 'admin';
    else if (guardLabel(r) === 'requireRoles(admin,project_manager)') p = 'pm';
    else p = 'author';
    n++;
    const res = await send(who[p], r);
    const refusedByGuard = res.status === 401 || (res.status === 403 && GUARD_403.has(res.json && res.json.code)) || (isProjectRoute(r) && res.status === 404 && JSON.stringify(res.json) === '{"error":"Not found"}' && !/:(?!id\b)\w+|\*/.test(r.path));
    if (refusedByGuard) bad.push(`${p} ${r.key} -> ${res.status} ${JSON.stringify(res.json)}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(n > 100, `GET routes probed: ${n}`);
});

// ---- 4. every route is referenced somewhere else -----------------------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..', '..');
function corpus() {
  const files = [];
  const walk = (d, re) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!/^(node_modules|fixtures|test-results.*|dist)$/.test(e.name)) walk(f, re); } else if (re.test(e.name)) files.push(f); } };
  walk(path.join(ROOT, 'backend', 'test'), /\.(js|mjs)$/);
  walk(path.join(ROOT, 'frontend', 'e2e'), /\.(ts|js|mjs)$/);
  walk(path.join(ROOT, 'scripts'), /\.(mjs|js|cjs|ps1)$/);
  walk(path.join(ROOT, 'backend', 'scripts'), /\.(mjs|js|cjs)$/);
  return files.filter((f) => path.basename(f) !== 'authz-matrix.test.js').map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Loose reference: the path with its parameters as wildcards, or, for a project route, its tail after a `${...}` prefix. */
function referenced(r, text) {
  const seg = (p) => p.split(/(:\w+|\*)/).map((s) => (s === '*' ? '[^\'"`\\s]+' : /^:\w+$/.test(s) ? '[^/\'"`\\s?]+' : esc(s))).join('');
  if (new RegExp(seg(r.path)).test(text)) return true;
  const tail = /^\/api\/projects\/:id(\/.+)$/.exec(r.path);
  return !!(tail && new RegExp(`\\}${seg(tail[1])}(?![\\w-])`).test(text));
}

test('every route is referenced by another test, e2e spec or script, or listed with a reason (the list only shrinks)', () => {
  const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8')).unreferenced;
  const text = corpus();
  const missing = []; const stale = [];
  for (const r of routeTable()) {
    const ref = referenced(r, text);
    if (!ref && !allow[r.key]) missing.push(r.key);
    if (ref && allow[r.key]) stale.push(r.key);
  }
  for (const k of Object.keys(allow)) if (!routeTable().some((r) => r.key === k)) stale.push(`${k} (not a route any more)`);
  assert.deepEqual({ missing, stale }, { missing: [], stale: [] }, 'missing: write a test for the route (or list it with a reason); stale: take it off authz-allow.json "unreferenced"');
});
