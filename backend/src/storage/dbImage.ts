// =============================================================================
// A consistent image of publisher.db and the checks run on an image (audit WP-12: PLT-001, G-REL-1, G-REL-9).
//
//   imageDatabase        writes a complete copy of the live database to a file with the SQLite online-backup API (node:sqlite `backup`,
//                        page steps, so the event loop is not held for the whole copy), falling back to VACUUM INTO for a handle that is
//                        not a node:sqlite DatabaseSync. The copy is switched to rollback-journal mode so it is ONE self-contained file.
//   inspectDatabaseFile  integrity_check, foreign_key_check, the applied migrations, user_version, and per table the row count and a SHA-256
//                        over its rows (what "100 % table equality after restore" is measured with).
//   inspectDatabaseFileAsync  the same in a worker thread (dbInspectWorker.ts), so checking a large image does not stall the server.
//
// SQL lives here because this is the storage engine (test/wp10-seams.test.js allows src/storage/).
// =============================================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import type { SqlDatabase } from './sqlite';

/** Copy the live database to `file` (which must not exist). */
export async function imageDatabase(db: SqlDatabase, file: string): Promise<void> {
  if (fs.existsSync(file)) throw new Error(`${file} already exists.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { db.exec('PRAGMA wal_checkpoint(PASSIVE);'); } catch { /* a busy checkpoint is not an error: the backup API reads the WAL too */ }
  if (db instanceof DatabaseSync) await sqliteBackup(db, file, { rate: 256 });
  else db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const copy = new DatabaseSync(file);
  try { copy.exec('PRAGMA journal_mode = DELETE;'); } finally { copy.close(); }
  for (const side of ['-wal', '-shm']) if (fs.existsSync(file + side)) throw new Error(`The database image left ${path.basename(file + side)} behind.`);
}

export interface TableFacts { rows: number; sha256: string }
export interface DatabaseFacts {
  /** 'ok', or the first problems integrity_check found. */
  integrity: string;
  foreignKeyErrors: number;
  applied: string[];
  userVersion: number;
  tables: Record<string, TableFacts>;
}

/** A value as it goes into a row digest: BLOBs as hex (JSON would turn a Uint8Array into an object of indices). */
const cell = (v: unknown): unknown => (v instanceof Uint8Array ? `x'${Buffer.from(v).toString('hex')}'` : typeof v === 'bigint' ? v.toString() : v);

/** Facts about a database file, read-only. */
export function inspectDatabaseFile(file: string): DatabaseFacts {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integ = (db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>).map((r) => String(Object.values(r)[0]));
    const fk = (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
    let applied: string[] = [];
    try { applied = (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as Array<{ name: string }>).map((r) => String(r.name)); } catch { /* no table yet */ }
    const userVersion = Number((db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version ?? 0);
    const tables: Record<string, TableFacts> = {};
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    for (const t of names) {
      const q = `"${t.replace(/"/g, '""')}"`;
      const cols = (db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t) as Array<{ name: string }>).length;
      let stmt;
      try { stmt = db.prepare(`SELECT * FROM ${q} ORDER BY rowid`); } catch { stmt = db.prepare(`SELECT * FROM ${q} ORDER BY ${Array.from({ length: cols }, (_v, i) => i + 1).join(', ')}`); }
      const h = crypto.createHash('sha256'); let rows = 0;
      for (const r of stmt.iterate() as Iterable<Record<string, unknown>>) { h.update(JSON.stringify(Object.values(r).map(cell))); h.update('\n'); rows++; }
      tables[t] = { rows, sha256: h.digest('hex') };
    }
    return { integrity: integ.length === 1 && integ[0] === 'ok' ? 'ok' : integ.slice(0, 5).join('; '), foreignKeyErrors: fk, applied, userVersion, tables };
  } finally { db.close(); }
}

/** inspectDatabaseFile in a worker thread. */
export function inspectDatabaseFileAsync(file: string): Promise<DatabaseFacts> {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'dbInspectWorker.js'), { workerData: { file } });
    let settled = false;
    w.once('message', (m: { ok: boolean; facts?: DatabaseFacts; error?: string }) => { settled = true; if (m.ok && m.facts) resolve(m.facts); else reject(new Error(m.error || 'database check failed')); });
    w.once('error', (e) => { if (!settled) { settled = true; reject(e); } });
    w.once('exit', (code) => { if (!settled) { settled = true; reject(new Error(`database check stopped (exit ${code})`)); } });
  });
}

/** SHA-256 of a file, streamed. */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file, { highWaterMark: 1024 * 1024 }).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
