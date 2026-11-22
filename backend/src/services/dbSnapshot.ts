// =============================================================================
// A consistent copy of publisher.db, taken once before a migration first runs on a database that already holds projects.
//
// The copy is made with VACUUM INTO, so it is a complete, valid database even while the original is in WAL mode. It is never taken for a fresh
// database (nothing to protect) and never taken twice for the same migration (once the migration is recorded the function returns at the first check).
//
// A file that already has the standard name is NEVER the answer to "has this database been protected": it can belong to a different database (a
// workspace that was copied, or a database restored over one that had been migrated before). In that case the copy is written under a time-stamped
// name beside it, and the existing file is left exactly as it is.
// =============================================================================

import fs from 'fs';
import path from 'path';

type Sqlite = { prepare(sql: string): { get(...p: unknown[]): any }; exec(sql: string): void };

const stamp = (iso: string): string => iso.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');

/**
 * Snapshot `sqlite` into <workspaceDir>/backups/ before `migration` first runs. Returns the path of the copy, or null when none was needed
 * (the migration is already recorded, the database is fresh, or it holds no projects).
 */
export function snapshotBeforeMigration(sqlite: Sqlite, workspaceDir: string, migration: string, nowIso: string, log: (m: string) => void = console.error): string | null {
  try {
    const has = (sql: string, ...p: unknown[]): any => { try { return sqlite.prepare(sql).get(...p); } catch { return undefined; } };
    if (has('SELECT 1 AS x FROM schema_migrations WHERE name = ?', migration)) return null;
    if (!has('SELECT 1 AS x FROM schema_migrations LIMIT 1') || !Number(has('SELECT COUNT(*) AS n FROM projects')?.n)) return null;
    const dir = path.join(workspaceDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    let file = path.join(dir, `publisher-before-${migration}.db`);
    for (let n = 0; fs.existsSync(file); n++) file = path.join(dir, `publisher-before-${migration}-${stamp(nowIso)}${n ? `-${n}` : ''}.db`);
    sqlite.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    return file;
  } catch (e) {
    log(`[migration] pre-migration snapshot failed: ${(e as Error).message}`);
    return null;
  }
}
