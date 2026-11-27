'use strict';
// WP-10 (PLT-028, PLT-030, PLT-031, PLT-032, ARC-006, PLT-027, PRD-002): the application context and its seams, kept true by test.
//
//   * no module under src/ reads process.env except config.ts
//   * no runtime import cycle among the compiled modules (requires inside functions count: a lazy require only hides a cycle)
//   * no SQL outside the repositories (an explicit allow-list names what cannot move yet, and why)
//   * two application contexts on two workspaces live in one process without seeing each other's data
//   * a migration failure is an error of start(), not of building the context; the migration files are complete per engine
//   * an invalid configuration value stops with the variable's name
//
// This file never calls boot(): it builds its own contexts on throwaway workspaces (the facade in dist/context is never loaded here).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

function walk(dir, pick, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pick, out); else if (pick(e.name)) out.push(p);
  }
  return out;
}
const rel = (p, base = SRC) => path.relative(base, p).split(path.sep).join('/');
/** Source text without comments, so a sentence that mentions SQL or require() is not code. Strings are kept. */
function stripComments(text) {
  let out = ''; let i = 0; let q = null;
  while (i < text.length) {
    const c = text[i]; const n = text[i + 1];
    if (q) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (c === '/' && n === '/') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
    out += c; i++;
  }
  return out;
}
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('PLT-032: no module under src/ reads process.env except config.ts', () => {
  const hits = [];
  for (const f of walk(SRC, (n) => /\.(ts|js)$/.test(n))) {
    if (rel(f) === 'config.ts') continue;
    stripComments(fs.readFileSync(f, 'utf8')).split('\n').forEach((l, i) => { if (/\bprocess\.env\b/.test(l)) hits.push(`${rel(f)}:${i + 1}`); });
  }
  assert.deepEqual(hits, [], 'read the value from config (buildConfig) instead');
});

test('ARC-006: the compiled backend has no runtime import cycle, and projects.ts requires no sibling service', () => {
  const files = walk(DIST, (n) => n.endsWith('.js'));
  const set = new Set(files); const edges = new Map();
  for (const f of files) {
    const out = new Set();
    for (const m of stripComments(fs.readFileSync(f, 'utf8')).matchAll(/require\(\s*["'`](\.{1,2}\/[^"'`]+)["'`]\s*\)/g)) {
      const t = path.resolve(path.dirname(f), m[1]);
      for (const c of [t, `${t}.js`, path.join(t, 'index.js')]) if (set.has(c)) { out.add(c); break; }
    }
    edges.set(f, out);
  }
  // Tarjan: every strongly connected component larger than one module (or a module that requires itself) is a cycle
  let idx = 0; const st = []; const on = new Set(); const ix = new Map(); const low = new Map(); const cycles = [];
  const visit = (v) => {
    ix.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
    for (const w of edges.get(v)) {
      if (!ix.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), ix.get(w)));
    }
    if (low.get(v) === ix.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(rel(w, DIST)); } while (w !== v); if (c.length > 1 || edges.get(v).has(v)) cycles.push(c.sort()); }
  };
  for (const f of files) if (!ix.has(f)) visit(f);
  assert.equal(files.length > 100, true, 'the compiled tree was found');
  assert.deepEqual(cycles, [], 'runtime import cycles (count must be 0)');

  const projects = stripComments(fs.readFileSync(path.join(SRC, 'services', 'projects.ts'), 'utf8'));
  assert.deepEqual([...projects.matchAll(/require\(\s*'\.\/[^']+'\s*\)/g)].map((m) => m[0]), [], 'projects.ts loads no sibling service lazily');
});

/*
  PRD-002 / PLT-030: SQL lives in the repositories. Allowed everywhere below these places:
    repositories/        the repositories (interfaces + SQLite implementations)
    storage/             the SQLite engine itself: opening the file, its base tables, the migration files, the VACUUM INTO snapshot
    core/auth/store.js   the AuthStore: a repository in all but name; the audit says not to interface its 109 methods until a second
                         engine is real (WP-37 splits it by aggregate)
    core/collab/         the document index and revisions: repositories over the documents/revisions tables, written against the
                         AuthStore's statement cache
  Nothing else may carry SQL. The allow-list below is for code that cannot move yet; each entry says why. It is empty today.
*/
const SQL_HOME = [/^repositories\//, /^storage\//, /^core\/auth\/store\.js$/, /^core\/collab\//];
const SQL_ALLOW = new Map([
  // ['path/to/file.ts', 'reason it cannot move yet'],
]);
const SQL_CODE = [
  /\bSELECT\s+[\s\S]{0,200}?\bFROM\s+[a-z_]/,
  /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+[a-z_]/,
  /\bUPDATE\s+[a-z_]+\s+SET\b/,
  /\bDELETE\s+FROM\s+[a-z_]/,
  /\b(?:CREATE|DROP|ALTER)\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)\b/,
  /\bPRAGMA\s+[a-z_]/,
  /\bVACUUM\b/,
  /\.stmt\(/, /\.prepare\(/, /\bstore\.db\b/, /\.exec\(\s*['"`](?:BEGIN|COMMIT|ROLLBACK)/,
];

test('PRD-002: no SQL outside the repositories (grep over src/, comments excluded)', () => {
  const hits = [];
  for (const f of walk(SRC, (n) => /\.(ts|js)$/.test(n))) {
    const r = rel(f);
    if (SQL_HOME.some((re) => re.test(r)) || SQL_ALLOW.has(r)) continue;
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    for (const re of SQL_CODE) { const m = re.exec(code); if (m) hits.push(`${r}: ${m[0].slice(0, 60).replace(/\s+/g, ' ')}`); }
  }
  assert.deepEqual(hits, [], 'move the statement into a repository (src/repositories/) behind its interface');
  for (const f of SQL_ALLOW.keys()) assert.ok(fs.existsSync(path.join(SRC, f)), `stale allow-list entry ${f}`);
});

test('the grep would catch SQL outside the repositories (the patterns are not vacuous)', () => {
  const sample = stripComments("// SELECT * FROM users in a comment is fine\nconst x = store.db.prepare('SELECT id FROM users WHERE id = ?');\nstore.stmt(`UPDATE releases SET a = 1`);");
  const found = SQL_CODE.filter((re) => re.test(sample)).length;
  assert.ok(found >= 3, `patterns matched ${found}`);
  assert.equal(SQL_CODE.some((re) => re.test(stripComments('// SELECT * FROM users'))), false, 'a comment is not code');
});

test('PLT-032: an invalid configuration value stops start-up with the name of the variable; the configuration is typed', () => {
  const { buildConfig, ConfigError, describeConfig } = require('../dist/config');
  assert.throws(() => buildConfig({ PORT: 'eighty' }), (e) => e instanceof ConfigError && /^PORT:/.test(e.message));
  assert.throws(() => buildConfig({ PORT: '70000' }), /PORT/);
  const c = buildConfig({ AGASTYA_WORKSPACE_DIR: 'X:/ws', PORT: '5000', AGASTYA_TRUST_PROXY: '2', AGASTYA_MAX_UPLOAD_BYTES: 'abc', AGASTYA_DEV_ORIGINS: 'http://a, http://b', INITIAL_ADMIN_PASSWORD: 'hunter2hunter2', INITIAL_ADMIN_USERNAME: 'root' });
  assert.equal(c.port, 5000); assert.equal(c.workspaceDir, 'X:/ws'); assert.equal(c.trustProxy, 2);
  assert.equal(c.limits.maxUploadBytes, 2 * 1024 ** 3, 'an invalid number falls back to the default');
  assert.deepEqual(c.devOrigins, ['http://a', 'http://b']);
  assert.equal(c.workspaceLock, true); assert.equal(buildConfig({ AGASTYA_NO_WORKSPACE_LOCK: '1' }).workspaceLock, false);
  assert.ok(!JSON.stringify(describeConfig(c)).includes('hunter2'), 'the printable configuration carries no secret');
});

function context(name, extraEnv = {}) {
  const { buildConfig } = require('../dist/config');
  const { createAppContext } = require('../dist/appContext');
  const ws = tmp(`agastya-wp10-${name}-`);
  const ctx = createAppContext(buildConfig({ AGASTYA_WORKSPACE_DIR: ws, ...extraEnv }));
  return { ctx, ws };
}

test('PLT-028: two application contexts on two workspaces run in one process without seeing each other', () => {
  const a = context('a'); const b = context('b');
  try {
    a.ctx.start(); b.ctx.start();
    assert.notEqual(a.ctx.db, b.ctx.db, 'each context has its own database handle');
    assert.ok(fs.existsSync(path.join(a.ws, 'publisher.db')) && fs.existsSync(path.join(b.ws, 'publisher.db')));
    const now = new Date().toISOString();
    a.ctx.store.createUser({ id: 'u1', username: 'only-in-a', fullName: 'A', role: 'author', passwordHash: 'x', now });
    assert.ok(a.ctx.store.findUserByUsername('only-in-a'));
    assert.equal(b.ctx.store.findUserByUsername('only-in-a'), null, 'a user made in A is not in B');
    a.ctx.repos.registry.upsertProject({ id: 'p1', name: 'Project A', type: 'S1000D', now });
    assert.equal(a.ctx.repos.registry.getProject('p1').name, 'Project A');
    assert.equal(b.ctx.repos.registry.getProject('p1'), null, 'a project row made in A is not in B');
    fs.mkdirSync(a.ctx.projectDirFor('p1'), { recursive: true });
    a.ctx.content.writeText('p1', 'project.json', '{"name":"Project A"}\n');
    assert.equal(JSON.parse(a.ctx.content.readText('p1', 'project.json')).name, 'Project A');
    assert.equal(b.ctx.content.exists('p1', 'project.json'), false, 'content written in A is not in B');
    assert.throws(() => a.ctx.content.pathOf('p1', '../p2/project.json'), /leaves the project folder/);
    a.ctx.audit({ action: 'wp10.probe', projectId: 'p1', meta: { password: 'secret', contentHash: 'abc' } });
    assert.equal(a.ctx.repos.activity.feed(['p1']).length, 1); assert.equal(b.ctx.repos.activity.feed(['p1']).length, 0);
    assert.equal(a.ctx.auditHealth().failures, 0);
    assert.equal(a.ctx.authProvider.kind, 'local');
  } finally { a.ctx.close(); b.ctx.close(); }
});

test('PLT-027: the local AuthProvider answers the same three ways the login route did', async () => {
  const { ctx } = context('auth'); ctx.start();
  try {
    const { hashPassword } = require('../dist/core/auth/crypto');
    const now = new Date().toISOString();
    ctx.store.createUser({ id: 'u1', username: 'alice', fullName: 'Alice', role: 'author', passwordHash: await hashPassword('correct horse battery'), now });
    assert.deepEqual(await ctx.authProvider.authenticate({ username: 'nobody', password: 'x' }), { ok: false, reason: 'unknown-user' });
    const wrong = await ctx.authProvider.authenticate({ username: 'alice', password: 'wrong' });
    assert.equal(wrong.ok, false); assert.equal(wrong.reason, 'bad-password'); assert.equal(wrong.user.username, 'alice');
    const ok = await ctx.authProvider.authenticate({ username: 'ALICE', password: 'correct horse battery' });
    assert.equal(ok.ok, true); assert.equal(ok.viaMaster, false);
    ctx.store.updateUser('u1', { disabled_at: now }, now);
    const disabled = await ctx.authProvider.authenticate({ username: 'alice', password: 'correct horse battery' });
    assert.equal(disabled.ok, false); assert.equal(disabled.reason, 'disabled');
    assert.equal(ctx.authProvider.resolveSession(''), null);
    assert.throws(() => ctx.authProvider.provisionUser({}), /administrator/);
  } finally { ctx.close(); }
});

test('PLT-028: a migration failure is an error of start(), named, not of building the context; start() is idempotent', () => {
  const { openSqlite } = require('../dist/storage/sqlite');
  const ws = tmp('agastya-wp10-mig-');
  const pre = openSqlite(ws); pre.exec('CREATE TABLE users_new (x TEXT)'); pre.close();     // 013 creates users_new: make it collide
  const { buildConfig } = require('../dist/config'); const { createAppContext } = require('../dist/appContext');
  const ctx = createAppContext(buildConfig({ AGASTYA_WORKSPACE_DIR: ws }));          // building does not migrate
  try {
    assert.throws(() => ctx.start(), /Migration 013-manager-and-author-roles failed/);
  } finally { ctx.close(); }
  const ok = context('idem'); try { ok.ctx.start(); assert.deepEqual(ok.ctx.start(), { snapshot: null }); } finally { ok.ctx.close(); }
});

test('PRD-002: the migration files are complete for the SQLite engine, unique, and in the order the databases already ran them', () => {
  const { ORDER, MIGRATIONS, forDialect } = require('../dist/storage/migrations');
  assert.deepEqual(ORDER, ['014-notifications', '015-review-config-cir', '001-users-sessions-audit', '002-reset-queue', '003-membership-invitations',
    '004-project-governance', '005-documents-revisions', '007-releases', '008-release-scope-and-content', '009-document-comments', '006-document-locks',
    '010-folder-permissions', '011-folder-access-and-changes', '012-change-seen', '013-manager-and-author-roles', '016-s1000d-reference',
    '017-s1000d-completion', '018-sns-preset-model', '019-review-comment-anchor', '020-login-throttle', '021-project-lifecycle', '022-audit-project-index',
    '023-audit-chain'],
  'a shipped migration is never renamed or reordered; a new one is appended');
  assert.equal(new Set(ORDER).size, ORDER.length);
  for (const m of MIGRATIONS) { assert.ok(m.sqlite && (m.sqlite.sql || m.sqlite.columns), `${m.name} has a sqlite body`); assert.equal(path.basename(m.name), m.name); }
  assert.equal(forDialect('sqlite').length, ORDER.length);
  assert.throws(() => forDialect('postgres'), /has no postgres body/, 'an engine without a body for a step is refused, not skipped');
  const files = fs.readdirSync(path.join(SRC, 'storage', 'migrations')).filter((f) => f !== 'index.js').map((f) => f.replace(/\.js$/, ''));
  assert.deepEqual(files.sort(), [...ORDER].sort(), 'every migration file is listed, and every listed step has a file');
});

test('PLT-031: a pending package import survives a restart within its hour, and not after it', () => {
  const { FilePendingImportStore } = require('../dist/storage/pendingImports');
  const dir = tmp('agastya-wp10-pending-'); const token = 'a'.repeat(32); const upload = path.join(dir, `${token}.upload`); fs.writeFileSync(upload, 'zip');
  const t0 = Date.now();
  new FilePendingImportStore(() => dir).put(token, { userId: 'u1', file: upload, name: 'p.zip', at: t0 });
  const afterRestart = new FilePendingImportStore(() => dir);              // a new process: nothing held in memory
  assert.deepEqual(afterRestart.get(token, t0 + 60_000), { userId: 'u1', file: upload, name: 'p.zip', at: t0 });
  assert.equal(afterRestart.get(token, t0 + 3600_001), undefined, 'expired after an hour');
  assert.equal(afterRestart.get('../../etc', t0), undefined, 'only a token is ever a file name');
  afterRestart.sweep(t0 + 3600_001);
  assert.equal(fs.existsSync(upload), false, 'the sweep removes the expired upload'); assert.deepEqual(fs.readdirSync(dir), []);
});

test('PLT-031: readiness reports the database, the data folder and the disk, and fails when the database is gone', () => {
  const { readiness } = require('../dist/services/readiness');
  const { buildConfig } = require('../dist/config');
  const { ctx } = context('ready'); ctx.start();
  assert.deepEqual(readiness(ctx), { ready: true, checks: { database: 'ok', workspace: 'ok', disk: 'ok' } });
  assert.equal(readiness({ ...ctx, config: buildConfig({ AGASTYA_READY_MIN_FREE_BYTES: String(1024 ** 6) }) }).checks.disk, 'failed', 'below the floor');
  assert.equal(readiness({ ...ctx, workspaceDir: path.join(ctx.workspaceDir, 'no-such-folder') }).checks.workspace, 'failed');
  ctx.close();
  const r = readiness(ctx);
  assert.equal(r.ready, false); assert.equal(r.checks.database, 'failed');
});
