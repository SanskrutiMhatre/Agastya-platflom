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
  // WP-28: every statement is timed (services/metrics.ts: on a synchronous engine a slow statement is a lock wait that stalls everyone)
  return instrumentDatabase(db);
}

/** WP-06 (REL-003): a clean stop writes the write-ahead log back into the database file and closes it. */
export function closeSqlite(db: SqlDatabase): void {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch (e) { console.warn('[db] checkpoint at stop failed:', (e as Error).message); }
  try { db.close(); } catch { /* already closed */ }
}
