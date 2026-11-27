'use strict';
// WP-12 (audit PLT-006, PLT-011, ARC-003, DEP-002, ENT-013, PLT-013, G-REL-3, G-REL-9): the migration framework around the additive migrations.
// Each case builds its own application context on a throwaway data folder (createAppContext), never the real one.
//
//   - the list is well formed (unique names and numbers, no gap, new steps appended)
//   - a database from a NEWER build is refused (unknown migration, or user_version above what this build knows) and left untouched
//   - an applied migration that was edited afterwards is refused, naming it
//   - a damaged file is refused at start (quick_check)
//   - before ANY pending migration (not only 016) a verified copy is taken; it predates the migration and is restorable
//   - when the copy cannot be made, nothing is migrated
//   - checksums, the program version and user_version are recorded; old pre-migration copies are pruned to the newest N

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temps = [];
const tmp = (p = 'agastya-wp12-mig-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); temps.push(d); return d; };
process.env.AGASTYA_WORKSPACE_DIR = tmp('agastya-wp12-default-');      // nothing below may ever resolve the developer's real workspace
test.after(() => { for (const d of temps) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* Windows: a handle may linger */ } });

const { DatabaseSync } = require('node:sqlite');
const { buildConfig } = require('../dist/config');
const { createAppContext } = require('../dist/appContext');
const schema = require('../dist/storage/schema');
const { ORDER, forDialect } = require('../dist/storage/migrations');
const STEPS = forDialect('sqlite');
const LAST = ORDER[ORDER.length - 1];

/** A started context on `ws` (a new folder by default), with an administrator and one registered project so the database is "in use". */
function populated(ws = tmp()) {
  const ctx = createAppContext(buildConfig({ AGASTYA_WORKSPACE_DIR: ws }));
  ctx.start();
  ctx.db.prepare("INSERT INTO users (id, username, full_name, role, password_hash, created_at, updated_at) VALUES ('u1', 'admin', 'Admin', 'admin', '$argon2id$x', '2026-11-27T00:00:00Z', '2026-11-27T00:00:00Z')").run();
  ctx.repos.registry.upsertProject({ id: 'p1', name: 'Handbook', now: '2026-11-27T00:00:00Z' });
  ctx.close();
  return ws;
}
const open = (ws, o = {}) => new DatabaseSync(path.join(ws, 'publisher.db'), o);
const startOn = (ws, env = {}) => { const ctx = createAppContext(buildConfig({ AGASTYA_WORKSPACE_DIR: ws, ...env })); try { return ctx.start(); } finally { ctx.close(); } };
const backups = (ws) => (fs.existsSync(path.join(ws, 'backups')) ? fs.readdirSync(path.join(ws, 'backups')).filter((f) => f.endsWith('.db')).sort() : []);

test('PLT-011: the migration list is well formed; duplicates, gaps and steps not appended are refused', () => {
  schema.checkOrder(ORDER);
  assert.throws(() => schema.checkOrder([...ORDER, ORDER[3]]), /listed twice/);
  assert.throws(() => schema.checkOrder([...ORDER, '022-another-022']), /Two migrations carry the number 022/);
  assert.throws(() => schema.checkOrder([...ORDER, '024-skips-023']), /023 is missing/);
  const n = ORDER.length; const next = String(n + 1).padStart(3, '0'); const after = String(n + 2).padStart(3, '0');
  assert.throws(() => schema.checkOrder([...ORDER, `${after}-b`, `${next}-a`]), new RegExp(`${next}-a must be appended after ${after}`));
  assert.doesNotThrow(() => schema.checkOrder([...ORDER, `${next}-a`, `${after}-b`]));
  assert.throws(() => schema.checkOrder([...ORDER, 'not-numbered']), /is not NNN-name/);
});

test('PLT-011: checksums, the program version and user_version are recorded for every applied migration', () => {
  const ws = populated();
  const db = open(ws, { readOnly: true });
  const rows = db.prepare('SELECT name, checksum, app_version FROM schema_migrations').all();
  assert.equal(rows.length, STEPS.length);
  for (const r of rows) {
    assert.equal(r.checksum, schema.migrationChecksum(STEPS.find((s) => s.name === r.name)), r.name);
    assert.match(String(r.app_version), /^\d+\.\d+\.\d+/);
  }
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, schema.migrationNumber(LAST));
  db.close();
});

test('ENT-013 / DEP-002 / G-REL-3: a database from a newer build is refused with a clear message, and left exactly as it was', () => {
  const ws = populated();
  const db = open(ws); db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES ('099-from-the-future', '2027-01-01T00:00:00Z')").run(); db.close();
  const before = fs.readFileSync(path.join(ws, 'publisher.db'));
  assert.throws(() => startOn(ws), (e) => e.name === 'SchemaError' && e.code === 'NEWER_DATABASE' && /newer version of Agastya Platform/.test(e.message) && /099-from-the-future/.test(e.message));
  assert.deepEqual(backups(ws), [], 'no copy, no migration');
  assert.ok(fs.readFileSync(path.join(ws, 'publisher.db')).equals(before), 'the file is untouched');

  const ws2 = populated();
  const db2 = open(ws2); db2.exec(`PRAGMA user_version = ${schema.migrationNumber(LAST) + 5}`); db2.close();
  assert.throws(() => startOn(ws2), (e) => e.code === 'NEWER_DATABASE' && /schema level/.test(e.message));
});

test('PLT-011: an applied migration that was edited afterwards stops the start, naming the migration', () => {
  const ws = populated();
  const db = open(ws); db.prepare("UPDATE schema_migrations SET checksum = 'edited' WHERE name = '021-project-lifecycle'").run(); db.close();
  assert.throws(() => startOn(ws), (e) => e.code === 'CHECKSUM_MISMATCH' && /021-project-lifecycle/.test(e.message));
});

test('PLT-013 / G-REL-9: a damaged database file is refused at start with a clear message', () => {
  const ws = populated();
  const db = open(ws);
  db.exec('CREATE TABLE filler (id INTEGER PRIMARY KEY, body TEXT); CREATE INDEX ix_filler ON filler(body);');
  const ins = db.prepare('INSERT INTO filler (body) VALUES (?)'); for (let i = 0; i < 3000; i++) ins.run(`row ${i} `.repeat(20));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;'); db.close();
  const file = path.join(ws, 'publisher.db');
  const buf = fs.readFileSync(file); const page = 4096;
  for (let p = Math.floor(buf.length / page) - 40; p < Math.floor(buf.length / page) - 5; p++) buf.fill(0xA5, p * page + 8, p * page + 600);  // scribble over index and table pages
  fs.writeFileSync(file, buf);
  assert.throws(() => startOn(ws), (e) => /integrity check|malformed|corrupt/i.test(e.message));
});

test('PLT-006 / ARC-003: before a pending migration of ANY number a verified copy is taken; it predates the migration and is restorable', () => {
  const ws = populated();
  // make it a database from before the last migration
  const db = open(ws); db.exec('DROP INDEX IF EXISTS ix_audit_project'); db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(LAST); db.exec('PRAGMA user_version = 21'); db.close();

  const { snapshot } = startOn(ws);
  assert.equal(path.basename(snapshot), `publisher-before-${LAST}.db`);
  const copy = new DatabaseSync(snapshot, { readOnly: true });
  assert.equal(copy.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE name = ?').get(LAST).n, 0, 'the copy predates the migration');
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ix_audit_project'").get().n, 0);
  assert.equal(copy.prepare("SELECT username FROM users WHERE id = 'u1'").get().username, 'admin', 'and holds the data');
  copy.close();
  const live = open(ws, { readOnly: true });
  assert.equal(live.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE name = ?').get(LAST).n, 1, 'the migration ran after the copy');
  assert.equal(live.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'ix_audit_project'").get().n, 1);
  live.close();

  // the copy is the way back: put it in place of the database in a new folder and start - the data is there and the migration runs again
  const back = tmp();
  fs.copyFileSync(snapshot, path.join(back, 'publisher.db'));
  const ctx = createAppContext(buildConfig({ AGASTYA_WORKSPACE_DIR: back }));
  try {
    const s = ctx.start();
    assert.ok(s.snapshot, 'restoring an older copy is itself protected by a copy');
    assert.equal(ctx.store.listUsers()[0].username, 'admin');
    assert.ok(ctx.repos.registry.getProject('p1'));
    assert.ok(ctx.repos.appliedMigrations().includes(LAST));
  } finally { ctx.close(); }

  // nothing is copied when nothing is pending, or for a new data folder
  assert.equal(startOn(ws).snapshot, null);
  assert.equal(startOn(tmp()).snapshot, null);
});

test('PLT-006: a synthetic future migration gets its own copy first; an existing file is never overwritten', () => {
  const ws = populated();
  const db = open(ws);
  const future = [...STEPS, { name: '099-dummy', sql: 'CREATE TABLE dummy (x TEXT);' }];
  const state = schema.inspectSchema(db, future);
  assert.deepEqual(state.pending, ['099-dummy']);
  fs.mkdirSync(path.join(ws, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'backups', 'publisher-before-099-dummy.db'), 'another database');
  const file = schema.snapshotBeforePendingMigrations(db, ws, state, '2026-11-27T10:00:00.000Z', 5);
  assert.match(path.basename(file), /^publisher-before-099-dummy-20261127-100000Z\.db$/);
  assert.equal(fs.readFileSync(path.join(ws, 'backups', 'publisher-before-099-dummy.db'), 'utf8'), 'another database');
  db.close();
});

test('PLT-006: when the copy cannot be made, the upgrade stops and nothing is migrated', () => {
  const ws = populated();
  const db = open(ws); db.prepare('DELETE FROM schema_migrations WHERE name = ?').run(LAST); db.exec('PRAGMA user_version = 21'); db.close();
  fs.writeFileSync(path.join(ws, 'backups'), 'a file where the backups folder should be');     // the folder cannot be created
  assert.throws(() => startOn(ws), (e) => e.code === 'SNAPSHOT_FAILED' && new RegExp(`before migration ${LAST}`).test(e.message) && /database is unchanged/.test(e.message));
  const after = open(ws, { readOnly: true });
  assert.equal(after.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE name = ?').get(LAST).n, 0, 'the migration did not run');
  after.close();
});

test('G-REL-3 migration matrix: a database stopped after any earlier step upgrades to the same schema as a new one, with its data, after a copy', () => {
  const { openSqlite } = require('../dist/storage/sqlite');
  /** The schema as SQLite stores it (tables, indexes; the bookkeeping columns of schema_migrations included). */
  const norm = (sql) => (sql == null ? sql : String(sql).replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ ([,)])/g, '$1'));   // layout only, never content
  const dump = (ws) => { const d = open(ws, { readOnly: true }); try { return d.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all().map((r) => ({ ...r, sql: norm(r.sql) })); } finally { d.close(); } };
  const fresh = tmp(); startOn(fresh);
  const target = dump(fresh);
  /** A database as an older build left it: the first `k` steps applied by the same rules as AuthStore.migrate, plus an account once one can exist. */
  const olderBuild = (k) => {
    const ws = tmp(); const db = openSqlite(ws);
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
    for (const m of STEPS.slice(0, k)) {
      if (m.fkOff) db.exec('PRAGMA foreign_keys = OFF');
      if (m.sql) db.exec(m.sql);
      for (const [table, col, def] of m.columns || []) if (!db.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(m.name, '2026-01-01T00:00:00Z');
      if (m.fkOff) db.exec('PRAGMA foreign_keys = ON');
    }
    const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get();
    if (hasUsers) db.prepare("INSERT INTO users (id, username, full_name, role, password_hash, created_at, updated_at) VALUES ('u1', 'keep', 'Keep Me', 'admin', 'h', 'x', 'x')").run();
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'Kept', 'x', 'x')").run();
    db.close();
    return { ws, hasUsers: !!hasUsers };
  };
  for (const k of [1, 3, 13, 15, 16, 18, STEPS.length - 2, STEPS.length - 1]) {
    const { ws, hasUsers } = olderBuild(k);
    const { snapshot } = startOn(ws);
    assert.ok(snapshot && path.basename(snapshot) === `publisher-before-${STEPS[k].name}.db`, `k=${k}: the copy is named after the first pending step`);
    assert.deepEqual(dump(ws), target, `k=${k}: the same schema as a new database`);
    const d = open(ws, { readOnly: true });
    try {
      assert.equal(d.prepare("SELECT name FROM projects WHERE id = 'p1'").get().name, 'Kept', `k=${k}: data kept`);
      if (hasUsers) assert.equal(d.prepare("SELECT username FROM users WHERE id = 'u1'").get().username, 'keep', `k=${k}: account kept`);
      assert.equal(d.prepare('PRAGMA foreign_key_check').all().length, 0);
      assert.equal(d.prepare('PRAGMA quick_check').get().quick_check, 'ok');
      assert.equal(d.prepare('PRAGMA user_version').get().user_version, schema.migrationNumber(LAST));
    } finally { d.close(); }
  }
});

test('PLT-006 retention: only the newest N pre-migration copies are kept; other files in backups/ are never touched', () => {
  const dir = path.join(tmp(), 'backups'); fs.mkdirSync(dir);
  const t0 = Date.now() / 1000;
  for (let i = 0; i < 8; i++) { const f = path.join(dir, `publisher-before-0${10 + i}-step.db`); fs.writeFileSync(f, 'x'); fs.utimesSync(f, t0 - 1000 + i, t0 - 1000 + i); }
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine'); fs.mkdirSync(path.join(dir, 'platform'));
  const removed = schema.pruneSnapshots(dir, 5);
  assert.deepEqual(removed.sort(), ['publisher-before-010-step.db', 'publisher-before-011-step.db', 'publisher-before-012-step.db']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['notes.txt', 'platform', 'publisher-before-013-step.db', 'publisher-before-014-step.db', 'publisher-before-015-step.db', 'publisher-before-016-step.db', 'publisher-before-017-step.db']);
});
