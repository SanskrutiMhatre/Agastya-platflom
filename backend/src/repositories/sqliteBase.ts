// =============================================================================
// Shared plumbing of the SQLite repositories (audit WP-10, PRD-002).
//
// Every SQL statement of the platform lives under src/repositories/ (plus the AuthStore and the collaboration index in core/, which are
// repositories in all but name, and the engine bootstrap in src/storage/). Services call repository methods; they never see SQL, so a
// second engine (WP-37) is a new set of classes behind the same interfaces, checked by the same contract suite
// (test/wp10-storage-contract.test.js). test/wp10-seams.test.js fails when SQL appears anywhere else.
// =============================================================================

import type { SqlDatabase, SqlStatement } from '../storage/sqlite';

/** A unit of work: everything `fn` writes is committed together, or nothing is. */
export interface UnitOfWork { transaction<T>(fn: () => T): T }

export abstract class SqliteRepository {
  // Only fixed SQL text is cached: the cache holds one entry per statement written in this file, so it cannot grow (PLT-031).
  private readonly stmts = new Map<string, SqlStatement>();
  constructor(protected readonly db: SqlDatabase) {}
  protected q(sql: string): SqlStatement {
    let s = this.stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this.stmts.set(sql, s); }
    return s;
  }
}

/** A deferred transaction (BEGIN ... COMMIT / ROLLBACK), as the services wrote it before WP-10. Not re-entrant, like before. */
export function sqliteTransaction<T>(db: SqlDatabase, fn: () => T): T {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** `LIKE` pattern for "everything below this path" with the wildcard characters of the path escaped (used with ESCAPE '\'). */
export const belowPattern = (p: string): string => p.replace(/[%_\\]/g, '\\$&') + '/%';
