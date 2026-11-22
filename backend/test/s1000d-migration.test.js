'use strict';
// Migration 016 on a REALISTIC pre-existing database: real sample modules, a mixed-issue project, an empty project, and the retired flat
// reference tables with an administrator's own rows. Each boot is a separate process on the same workspace, like a real upgrade.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const child = path.join(__dirname, 'fixtures', 'migration-child.js');
function run(ws, mode) {
  const r = spawnSync(process.execPath, [child, mode], { env: { ...process.env, AGASTYA_WORKSPACE_DIR: ws }, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout.split('@@').pop());
}
const hashDir = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]));
const dbPath = (ws) => path.join(ws, 'publisher.db');

test('upgrading a populated pre-016 database: snapshot, derived configuration, untouched data modules, legacy rows carried, idempotent', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-mig-'));
  const { projects } = run(ws, 'seed');

  // --- make it a PRE-016 database: drop everything migration 016 added, forget it ran, and put the retired flat rows back
  const db = new DatabaseSync(dbPath(ws));
  for (const t of ['ref_sources', 'ref_codes', 'ref_code_ranges', 'ref_dmtype_codes', 'sns_preset_nodes', 'sns_presets', 'project_config', 'project_codes', 'project_sns', 'project_dm_types', 'catalogue_impacts']) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec("DELETE FROM schema_migrations WHERE name IN ('016-s1000d-reference', '018-sns-preset-model')");   // 018 only alters a table 016 created, so a real pre-016 install has not run it either
  db.exec("DELETE FROM config_items WHERE collection = 'app-state' AND id = 'migrated:flat-reference-016'");   // (the first boot of a real pre-016 install never ran it)
  const now = new Date().toISOString();
  const put = (c, id, data) => db.prepare('INSERT OR REPLACE INTO config_items (collection, id, data, created_at, updated_at) VALUES (?,?,?,?,?)').run(c, id, JSON.stringify(data), now, now);
  // seeds of the old tables (demo content) + two rows an administrator authored
  put('info-codes', 'a', { code: '040', name: 'Description' }); put('info-codes', 'b', { code: '9Q9', name: 'Customer procedure' });
  put('sns', 'a', { code: '00', name: 'General' }); put('sns', 'b', { code: '31', name: 'Indicating and recording' });
  db.close();

  // the data modules, hashed before the upgrade
  const csdb = (id) => path.join(ws, 'projects', id, 'csdb');
  const before = Object.fromEntries(Object.entries(projects).map(([k, id]) => [k, hashDir(csdb(id))]));
  assert.ok(Object.keys(before.p1).length >= 3, 'the sample project has real modules');

  // --- upgrade
  const rep = run(ws, 'report');

  // a consistent snapshot of the OLD database exists and can be opened
  const snap = path.join(ws, 'backups', 'publisher-before-016-s1000d-reference.db');
  assert.ok(fs.existsSync(snap), 'pre-migration snapshot written');
  const s = new DatabaseSync(snap, { readOnly: true });
  assert.equal(s.prepare('SELECT COUNT(*) AS n FROM projects').get().n >= 3, true, 'the snapshot holds the projects');
  assert.equal(s.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'project_config'").get().n, 0, 'and predates the migration');
  s.close();

  // every project got a configuration derived from what it holds
  const C = rep.configs;
  const real = C['Handbook (real modules)'];
  assert.equal(real.config.origin.by, 'migration');
  assert.equal(real.config.mic, 'S1KSTUDIO', 'one MIC, taken from the modules');
  // the three real sample modules declare Issue 5.0, 4.2 and 5.0: that is a MIXED project, and the migration does not pick for the owner
  assert.equal(real.config.issue, null);
  assert.ok(real.config.origin.notes.some((n) => /different S1000D issues \((4\.2, 5\.0|5\.0, 4\.2)\)/.test(n)), JSON.stringify(real.config.origin.notes));
  assert.equal(real.dmCount, Object.keys(before.p1).filter((f) => /^DMC-.*\.xml$/i.test(f)).length);
  assert.deepEqual(real.lock.fields, ['mic'], 'the MIC is locked (modules exist); the issue is not set, so the owner may still choose it');
  assert.equal(real.config.codeMode, 'all', 'no code was narrowed');
  assert.equal(real.config.snsEnforced, false, 'an existing project is not suddenly held to an SNS');
  assert.deepEqual(real.config.applicability, { act: null, cct: null, pct: null }, 'applicability is never assigned');

  const mixed = C['Merged (mixed)'];
  assert.equal(mixed.config.mic, '', 'two MICs: none chosen');
  assert.equal(mixed.config.issue, null, 'two issues: none chosen');
  assert.ok(mixed.config.origin.notes.some((n) => /different model identification codes/.test(n)));
  assert.ok(mixed.config.origin.notes.some((n) => /different S1000D issues/.test(n)));
  assert.deepEqual(mixed.lock.fields, [], 'nothing to lock until the owner chooses');

  const empty = C['Empty'];
  assert.equal(empty.dmCount, 0); assert.equal(empty.config.mic, '');

  // data modules are byte-for-byte unchanged
  for (const [k, id] of Object.entries(projects)) assert.deepEqual(hashDir(csdb(id)), before[k], `${k}: modules untouched`);

  // the reference data exists; the administrator's own legacy rows were carried, the seeds were not
  assert.deepEqual(rep.overview.map((o) => o[0]), ['4-2', '5-0', '6', '7']);
  assert.ok(rep.overview.every(([, n]) => n >= 574));
  assert.ok(rep.overview.every(([, , custom]) => custom === 1), 'only 9Q9 was carried (040 is a BREX code; the flat seeds are demo content)');
  assert.ok(rep.presets.includes('spec42-8-2-1'));
  const db2 = new DatabaseSync(dbPath(ws));
  assert.equal(db2.prepare("SELECT COUNT(*) AS n FROM config_items WHERE collection = 'info-codes'").get().n, 2, 'the old rows are not deleted');
  const migrated = db2.prepare("SELECT n.path, n.title FROM sns_preset_nodes n JOIN sns_presets p ON p.id = n.preset_id WHERE p.name = 'Migrated flat SNS'").all();
  assert.deepEqual(migrated.map((r) => [r.path, r.title]), [['31', 'Indicating and recording']]);
  const versions = Object.fromEntries(db2.prepare('SELECT project_id, version FROM project_config').all().map((r) => [r.project_id, r.version]));
  db2.close();

  // --- idempotent: another start changes nothing
  run(ws, 'report');
  const db3 = new DatabaseSync(dbPath(ws));
  const again = Object.fromEntries(db3.prepare('SELECT project_id, version FROM project_config').all().map((r) => [r.project_id, r.version]));
  assert.deepEqual(again, versions);
  assert.equal(db3.prepare("SELECT COUNT(*) AS n FROM ref_codes WHERE origin = 'custom'").get().n, 4, 'no duplicates on a second start (9Q9 x 4 issues)');
  db3.close();
  fs.rmSync(ws, { recursive: true, force: true });
});

test('a fresh install takes no snapshot (there is nothing to protect) and seeds the catalogue', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-fresh-'));
  const rep = run(ws, 'seed');
  assert.ok(rep.projects.p1);
  assert.equal(fs.existsSync(path.join(ws, 'backups', 'publisher-before-016-s1000d-reference.db')), false);
  fs.rmSync(ws, { recursive: true, force: true });
});
