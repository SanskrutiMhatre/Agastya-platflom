// The copy of publisher.db taken before a migration first runs (services/dbSnapshot.ts).
//
// The case that matters: a file with the standard name already sits in backups/ but belongs to ANOTHER database (a workspace that was copied, or a
// database restored over one that had been migrated before). It must not be taken as proof that THIS database was protected, and it must not be touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { snapshotBeforeMigration } = require('../dist/services/dbSnapshot');

const MIG = '016-s1000d-reference';
const NOW = '2026-11-22T16:19:52.123Z';

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-snap-')); }
/** A database as it is just before 016: migrations 001-015 recorded, optionally with projects. */
function database(dir, { projects = 1, migrated = false, applied = 15 } = {}) {
  const db = new DatabaseSync(path.join(dir, 'publisher.db'));
  db.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);');
  for (let i = 1; i <= applied; i++) db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(String(i).padStart(3, '0') + '-x', NOW);
  if (migrated) db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(MIG, NOW);
  for (let i = 0; i < projects; i++) db.prepare('INSERT INTO projects VALUES (?, ?)').run(`p${i}`, `Project ${i}`);
  return db;
}
const names = (dir) => (fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')).sort() : []);
const quiet = () => undefined;

test('a database with projects gets a complete, readable copy under the standard name', () => {
  const dir = workspace(); const db = database(dir, { projects: 3 });
  const file = snapshotBeforeMigration(db, dir, MIG, NOW, quiet);
  assert.equal(path.basename(file), `publisher-before-${MIG}.db`);
  const copy = new DatabaseSync(file, { readOnly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM projects').get().n, 3);
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  copy.close(); db.close();
});

test('nothing is copied for a fresh database, for one without projects, or once the migration is recorded', () => {
  for (const opts of [{ projects: 0, applied: 0 }, { projects: 0 }, { projects: 2, migrated: true }]) {
    const dir = workspace(); const db = database(dir, opts);
    assert.equal(snapshotBeforeMigration(db, dir, MIG, NOW, quiet), null, JSON.stringify(opts));
    assert.deepEqual(names(dir), [], 'no backups folder content');
    db.close();
  }
});

test('a file that already has the standard name is left exactly as it is, and this database is still copied beside it', () => {
  const dir = workspace(); const db = database(dir, { projects: 2 });
  fs.mkdirSync(path.join(dir, 'backups'));
  const decoy = path.join(dir, 'backups', `publisher-before-${MIG}.db`);
  fs.writeFileSync(decoy, 'the other database');
  const before = fs.readFileSync(decoy);

  const file = snapshotBeforeMigration(db, dir, MIG, NOW, quiet);
  assert.notEqual(file, decoy);
  assert.match(path.basename(file), new RegExp(`^publisher-before-${MIG}-20261122-161952Z\\.db$`));
  assert.ok(fs.readFileSync(decoy).equals(before), 'the existing file is untouched');
  const copy = new DatabaseSync(file, { readOnly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) n FROM projects').get().n, 2, 'the copy is THIS database');
  copy.close();

  // the same second again: a third file, never an overwrite
  const again = snapshotBeforeMigration(db, dir, MIG, NOW, quiet);
  assert.notEqual(again, file); assert.notEqual(again, decoy);
  assert.equal(names(dir).length, 3);
  db.close();
});

test('a failure is reported, not thrown, and not swallowed silently', () => {
  const dir = workspace(); const real = database(dir, { projects: 1 });
  const broken = { prepare: (sql) => real.prepare(sql), exec: () => { throw new Error('disk full'); } };
  const seen = [];
  assert.equal(snapshotBeforeMigration(broken, dir, MIG, NOW, (m) => seen.push(m)), null);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /pre-migration snapshot failed: disk full/);
  real.close();
});
