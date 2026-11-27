// =============================================================================
// The SQLite engine: opening publisher.db (audit WP-10, PRD-002).
//
// `openSqlite` does what vendor/engine/db.js `open()` did for the server (same file, same pragmas, same two registry tables), but returns a
// NEW handle on every call instead of a module-wide one, so two application contexts (two workspaces) can live in one process and a test
// can build an isolated one. vendor/engine/db.js stays for the break-glass reset-admin script, which opens the database on its own.
// =============================================================================

import path from 'path';
import { instrumentDatabase } from '../services/metrics';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

/** The part of a node:sqlite handle the repositories use. A second engine's adapter offers the same shape. */
export interface SqlStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): any;          // eslint-disable-line @typescript-eslint/no-explicit-any
  all(...params: unknown[]): any[];        // eslint-disable-line @typescript-eslint/no-explicit-any
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  close(): void;
}

/** The registry tables the engine has always created at open (they predate the tracked migrations, so they are not in schema_migrations). */
export const BASE_SCHEMA = `
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'JSS',   -- 'S1000D' | 'JSS'
      template    TEXT DEFAULT 'default',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      last_opened TEXT
    );
    CREATE TABLE IF NOT EXISTS files (
      project_id  TEXT NOT NULL,
      rel_path    TEXT NOT NULL,
      kind        TEXT NOT NULL,                 -- 'pmc' | 'dmc' | 'media' | 'frontmatter' | 'other'
      chapter     TEXT,
      updated_at  TEXT NOT NULL,
      PRIMARY KEY (project_id, rel_path)
    );
  `;

export function openSqlite(workspaceDir: string): SqlDatabase {
  const db = new DatabaseSync(path.join(workspaceDir, 'publisher.db'));
  // A second process (the break-glass reset-admin script, a backup) waits up to 5 s for a write lock instead of failing at once with
  // "database is locked" while the server runs (audit PLT-012).
  db.exec('PRAGMA busy_timeout = 5000;');
  // WP-06 (PLT-010): enforced references, stated rather than left to the library default.
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(BASE_SCHEMA);
  // WP-17 (PERF-009, decision D14): in WAL mode NORMAL keeps the database consistent after any crash of the application or the machine; a power
  // cut can lose only the last commits before it. An autocommit write costs about 0.1 ms instead of 3 ms (FULL syncs the log on every commit).
  // Migrations run under FULL (appContext.start). AGASTYA_DB_SYNCHRONOUS=FULL keeps FULL throughout.
  db.exec(`PRAGMA synchronous = ${dbSynchronous()};`);
  // 64 MB page cache (the default is 2 MB) and temporary tables in memory: reads of the hot tables stay off the disk.
  db.exec('PRAGMA cache_size = -65536; PRAGMA temp_store = MEMORY;');
  // WP-28: every statement is timed (services/metrics.ts: on a synchronous engine a slow statement is a lock wait that stalls everyone)
  return instrumentDatabase(db);
}

/** The working `synchronous` level: NORMAL (decision D14), or FULL when AGASTYA_DB_SYNCHRONOUS=FULL. */
export function dbSynchronous(): 'NORMAL' | 'FULL' {
  return String(process.env.AGASTYA_DB_SYNCHRONOUS ?? '').trim().toUpperCase() === 'FULL' ? 'FULL' : 'NORMAL';
}

export function setSynchronous(db: SqlDatabase, level: 'NORMAL' | 'FULL'): void { db.exec(`PRAGMA synchronous = ${level};`); }

/**
 * WP-17 (PERF-009): write the write-ahead log back into the database file and truncate it once the server has been idle (no change on this
 * connection for one interval after a change). Without it the log only shrinks at a clean stop. The checkpoint never waits for a reader (another
 * process, a job worker): busy_timeout is 0 for that one statement, so a busy database simply means "next time" and the request thread is never
 * held. Returns a stop function; the timer does not keep the process alive.
 */
export function startIdleCheckpoint(db: SqlDatabase, everyMs = 60000): () => void {
  let seen = -1; let dirty = true;                                         // the start itself wrote (migrations, sessions)
  const changes = (): number => Number((db.prepare('SELECT total_changes() AS n').get() as { n: number | bigint }).n);
  const tick = (): void => {
    try {
      const n = changes();
      if (seen >= 0 && n !== seen) { dirty = true; seen = n; return; }   // still being written: wait for a quiet interval
      seen = n;
      if (!dirty) return;
      db.exec('PRAGMA busy_timeout = 0;');
      try { const r = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy?: number } | undefined; if (!r || !Number(r.busy)) dirty = false; } finally { db.exec('PRAGMA busy_timeout = 5000;'); }
    } catch (e) { console.warn('[db] idle checkpoint skipped:', (e as Error).message); }
  };
  const t = setInterval(tick, everyMs); t.unref();
  return () => clearInterval(t);
}

/** WP-06 (REL-003): a clean stop writes the write-ahead log back into the database file and closes it. */
export function closeSqlite(db: SqlDatabase): void {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (e) { console.warn('[db] checkpoint at stop failed:', (e as Error).message); }
  try { db.close(); } catch { /* already closed */ }
}
