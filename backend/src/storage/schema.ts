// =============================================================================
// The migration framework around the additive migrations (audit WP-12: PLT-011, PLT-006, ARC-003, DEP-002, ENT-013, PLT-013).
//
// The migrations themselves stay where WP-10 put them (storage/migrations/, one file per step, run by AuthStore.migrate in the order of
// ORDER). This module adds what the audit found missing around them, in the order AppContext.start() calls it:
//
//   checkOrder        the list is well formed: unique names, unique NNN- prefixes, and every step after the historical ones appended in
//                     ascending order (the first 21 keep the order the existing databases ran them in; it is not sorted on purpose).
//   inspectSchema     what this database has applied against what this build knows: a migration this build does not know, or a
//                     user_version above the highest number it knows, is a database written by a NEWER build -> refused (downgrade guard).
//                     A recorded checksum that differs from the step's current body -> refused, naming the migration (tampering, or a
//                     shipped migration that was edited instead of a new one being added).
//   quickCheck        PRAGMA quick_check, so a damaged file is reported at start with a clear message instead of failing later.
//   snapshotBeforePendingMigrations
//                     ONE consistent copy (VACUUM INTO) before the first pending migration of ANY number runs, verified with quick_check,
//                     never overwriting a file; the last N are kept. A failure STOPS the upgrade (the old 016-only snapshot logged and went on).
//   recordApplied     after the run: the checksum and the program version of every step that has none yet, and PRAGMA user_version.
//
// Forward only: there are no "down" migrations; the way back is the pre-migration snapshot (docs/OPERATIONS.md, "Upgrades and rollback").
// Additive only: the two bookkeeping columns on schema_migrations are added with ALTER TABLE ... ADD COLUMN, nothing is rewritten.
// =============================================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase } from './sqlite';
import { tempNameFor, commitFile, discardTemp } from './atomicWrite';

/** `postSql` (WP-29) runs after `columns`, so a step can index a column it adds; every part of a step is re-runnable (IF NOT EXISTS). */
export interface MigrationStep { name: string; sql?: string; columns?: unknown; fkOff?: boolean; postSql?: string }

/** A database this build must not open (newer schema, edited migration, damaged file, failed safety copy). The message is for an operator. */
export class SchemaError extends Error {
  constructor(public code: 'NEWER_DATABASE' | 'CHECKSUM_MISMATCH' | 'DAMAGED' | 'SNAPSHOT_FAILED' | 'BAD_ORDER', message: string) {
    super(message); this.name = 'SchemaError';
  }
}

/** The number in front of a migration name ("021-project-lifecycle" -> 21). */
export const migrationNumber = (name: string): number => {
  const m = /^(\d{3})-[a-z0-9-]+$/.exec(name);
  if (!m) throw new SchemaError('BAD_ORDER', `Migration name ${JSON.stringify(name)} is not NNN-name.`);
  return Number(m[1]);
};

/** The historical steps whose order is not numeric (014 and 015 ran first on every database that exists). */
const HISTORICAL = 21;

/** Refuse a malformed list: duplicate names or numbers, or a new step that is not appended after the highest number. */
export function checkOrder(order: string[]): void {
  const seenName = new Set<string>(); const seenNo = new Set<number>();
  let highest = 0;
  order.forEach((name, i) => {
    const n = migrationNumber(name);
    if (seenName.has(name)) throw new SchemaError('BAD_ORDER', `Migration ${name} is listed twice.`);
    if (seenNo.has(n)) throw new SchemaError('BAD_ORDER', `Two migrations carry the number ${String(n).padStart(3, '0')} (${name}).`);
    seenName.add(name); seenNo.add(n);
    if (i >= HISTORICAL && n <= highest) throw new SchemaError('BAD_ORDER', `Migration ${name} must be appended after ${String(highest).padStart(3, '0')}, with a higher number.`);
    highest = Math.max(highest, n);
  });
  for (let n = 1; n <= highest; n++) if (!seenNo.has(n)) throw new SchemaError('BAD_ORDER', `Migration number ${String(n).padStart(3, '0')} is missing (a gap in the list).`);
}

/** SHA-256 of what a step does (its SQL, its added columns, its foreign-key mode), so an edited shipped step is detected. */
export function migrationChecksum(m: MigrationStep): string {
  // postSql joins the digest only when a step has one, so the recorded checksums of every earlier step stay what they were
  return crypto.createHash('sha256').update(JSON.stringify({ sql: m.sql ?? null, columns: m.columns ?? null, fkOff: !!m.fkOff, ...(m.postSql ? { postSql: m.postSql } : {}) })).digest('hex');
}

export interface SchemaState {
  /** true when no migration has ever run (a new data folder): nothing to protect, nothing to compare. */
  fresh: boolean;
  applied: string[];
  pending: string[];
  userVersion: number;
  /** The highest migration number this build knows. */
  latestNumber: number;
}

const tableExists = (db: SqlDatabase, name: string): boolean => !!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const hasColumn = (db: SqlDatabase, table: string, col: string): boolean => !!db.prepare('SELECT 1 AS x FROM pragma_table_info(?) WHERE name = ?').get(table, col);

/** Make sure schema_migrations exists and carries the two bookkeeping columns (additive; a pre-WP-12 table gets them added). */
export function ensureMigrationTable(db: SqlDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
  if (!hasColumn(db, 'schema_migrations', 'checksum')) db.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;');
  if (!hasColumn(db, 'schema_migrations', 'app_version')) db.exec('ALTER TABLE schema_migrations ADD COLUMN app_version TEXT;');
}

/**
 * Compare the database with the steps this build knows and refuse what must not be opened. Reads only (plus ensureMigrationTable when
 * `prepare` is true). Throws SchemaError NEWER_DATABASE / CHECKSUM_MISMATCH.
 */
export function inspectSchema(db: SqlDatabase, steps: MigrationStep[], opts: { prepare?: boolean } = {}): SchemaState {
  const latestNumber = steps.reduce((n, s) => Math.max(n, migrationNumber(s.name)), 0);
  const userVersion = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0);
  const exists = tableExists(db, 'schema_migrations');
  if (opts.prepare) ensureMigrationTable(db);
  const rows = exists || opts.prepare
    ? (db.prepare(`SELECT name${hasColumn(db, 'schema_migrations', 'checksum') ? ', checksum' : ', NULL AS checksum'} FROM schema_migrations`).all() as Array<{ name: string; checksum: string | null }>)
    : [];
  const known = new Map(steps.map((s) => [s.name, s]));
  const unknown = rows.map((r) => r.name).filter((n) => !known.has(n));
  if (unknown.length || userVersion > latestNumber) {
    throw new SchemaError('NEWER_DATABASE',
      `This database was written by a newer version of Agastya Platform (${unknown.length ? `migration${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} unknown to this version` : `schema level ${userVersion}, this version knows up to ${latestNumber}`}). ` +
      'Opening it with this older version could damage it, so the server does not start. Install the newer version again, or restore a backup taken with this version (docs/OPERATIONS.md, "Restore").');
  }
  for (const r of rows) {
    if (r.checksum && r.checksum !== migrationChecksum(known.get(r.name) as MigrationStep)) {
      throw new SchemaError('CHECKSUM_MISMATCH',
        `Migration ${r.name} differs from the one this database applied (checksum). A shipped migration must never be edited; add a new one instead. The server does not start.`);
    }
  }
  const applied = new Set(rows.map((r) => r.name));
  return { fresh: rows.length === 0, applied: [...applied], pending: steps.map((s) => s.name).filter((n) => !applied.has(n)), userVersion, latestNumber };
}

/** PRAGMA quick_check; throws SchemaError DAMAGED naming the first problems. */
export function quickCheck(db: SqlDatabase, label = 'The database'): void {
  let msgs: string[];
  try { msgs = (db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>).map((r) => String(Object.values(r)[0])); } catch (e) { msgs = [(e as Error).message]; }
  if (msgs.length !== 1 || msgs[0] !== 'ok') {
    throw new SchemaError('DAMAGED', `${label} failed its integrity check (${msgs.slice(0, 3).join('; ')}${msgs.length > 3 ? '; ...' : ''}). ` +
      'Stop here and restore the latest backup (docs/OPERATIONS.md, "Restore"); do not keep writing to this file.');
  }
}

/** Record checksum and program version for every applied step without one, and set user_version to the highest applied number. */
export function recordApplied(db: SqlDatabase, steps: MigrationStep[], appVersion: string): void {
  ensureMigrationTable(db);
  const byName = new Map(steps.map((s) => [s.name, s]));
  const rows = db.prepare('SELECT name FROM schema_migrations WHERE checksum IS NULL').all() as Array<{ name: string }>;
  const set = db.prepare('UPDATE schema_migrations SET checksum = ?, app_version = COALESCE(app_version, ?) WHERE name = ?');
  for (const r of rows) { const s = byName.get(r.name); if (s) set.run(migrationChecksum(s), appVersion, r.name); }
  const highest = (db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>)
    .reduce((n, r) => (byName.has(r.name) ? Math.max(n, migrationNumber(r.name)) : n), 0);
  db.exec(`PRAGMA user_version = ${Math.trunc(highest)}`);
}

const stamp = (iso: string): string => iso.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
export const SNAPSHOT_PATTERN = /^publisher-before-\d{3}-[a-z0-9-]+?(-\d{8}-\d{6}Z(-\d+)?)?\.db$/;

/**
 * Before the first pending migration runs on a database that is not new: one consistent copy in <workspace>/backups/, named
 * publisher-before-<first pending>.db (or with a time stamp when that name is taken - never an overwrite), checked with quick_check.
 * Then only the newest `keep` pre-migration copies stay. Throws SchemaError SNAPSHOT_FAILED: the caller must not migrate without it.
 */
export function snapshotBeforePendingMigrations(db: SqlDatabase, workspaceDir: string, state: SchemaState, nowIso: string, keep = 5): string | null {
  sweepStaleCopies(path.join(workspaceDir, 'backups'));      // WP-30: every start, pending steps or not (see below)
  if (state.fresh || !state.pending.length) return null;
  const first = state.pending[0];
  let file = '';
  try {
    const dir = path.join(workspaceDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, `publisher-before-${first}.db`);
    for (let n = 0; fs.existsSync(file); n++) file = path.join(dir, `publisher-before-${first}-${stamp(nowIso)}${n ? `-${n}` : ''}.db`);
    // WP-30 (QA-008, found by the chaos suite): the copy is made under a temporary name and gets its real name only once it passed its check. A
    // start killed during VACUUM INTO used to leave a torn `publisher-before-<step>.db` - the very file an operator would restore - beside the
    // good copy the next start made. A stale temporary copy (and the rollback journal SQLite keeps beside it while writing) is removed by a
    // later start, once it is a minute old (sweepStaleCopies above).
    const tmp = tempNameFor(file);
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      verifyCopy(tmp);
      commitFile(tmp, file);
    } catch (e) { discardTemp(tmp); discardTemp(`${tmp}-journal`); throw e; }
  } catch (e) {
    throw new SchemaError('SNAPSHOT_FAILED', `The safety copy of the database before migration ${first} could not be made${file ? ` (${file})` : ''}: ${(e as Error).message}. ` +
      'The upgrade is stopped and the database is unchanged; free disk space or make the backups folder writable, then start again.');
  }
  pruneSnapshots(path.dirname(file), keep, file);
  return file;
}

const STALE_COPY = /^\.publisher-before-.+\.tmp-\d+-[0-9a-f]{12}(-journal|-wal|-shm)?$/;
function sweepStaleCopies(dir: string, olderThanMs = 60_000): void {
  let names: string[] = []; try { names = fs.readdirSync(dir); } catch { return; }
  for (const f of names) if (STALE_COPY.test(f)) { try { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs >= olderThanMs) fs.rmSync(p, { force: true }); } catch { /* in use or gone */ } }
}

function verifyCopy(file: string): void {
  const copy = new DatabaseSync(file, { readOnly: true });
  try { quickCheck(copy as unknown as SqlDatabase, 'The safety copy'); } finally { copy.close(); }
}

/** Keep the newest `keep` pre-migration copies (by modification time); never the one just written. Returns the removed names. */
export function pruneSnapshots(dir: string, keep: number, justWritten?: string): string[] {
  if (!(keep > 0)) return [];
  let files: Array<{ f: string; t: number }> = [];
  try {
    files = fs.readdirSync(dir).filter((f) => SNAPSHOT_PATTERN.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
  } catch { return []; }
  files.sort((a, b) => b.t - a.t);
  const removed: string[] = [];
  for (const { f } of files.slice(keep)) {
    const abs = path.join(dir, f);
    if (justWritten && path.resolve(abs) === path.resolve(justWritten)) continue;
    try { fs.rmSync(abs); removed.push(f); } catch { /* kept; tried again next time */ }
  }
  return removed;
}
