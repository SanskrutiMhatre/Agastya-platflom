// =============================================================================
// The repositories of one application context (audit WP-10, PRD-002).
//
// `Repositories` is what services see: interfaces only. `createSqliteRepositories(db)` is today's (and the default) implementation; a
// PostgreSQL adapter (WP-37, decision D21) supplies the same object and must pass the same contract suite
// (test/wp10-storage-contract.test.js). The 109-method AuthStore (core/auth/store.js) is deliberately NOT behind an interface yet: the audit
// says to split it by aggregate only when a second engine is real.
// =============================================================================

import type { SqlDatabase } from '../storage/sqlite';
import { sqliteTransaction, type UnitOfWork } from './sqliteBase';
import { SqliteProjectRegistry, type ProjectRegistry } from './projectRegistry';
import { SqliteSnsRepository, type SnsRepository } from './snsRepository';
import { SqliteProjectConfigRepository, type ProjectConfigRepository } from './projectConfigRepository';
import { SqliteReferenceRepository, type ReferenceRepository } from './referenceRepository';
import {
  SqliteActivityRepository, SqliteCirLinkRepository, SqliteExtensionRepository, SqliteLifecycleRepository,
  type ActivityRepository, type CirLinkRepository, type ExtensionRepository, type LifecycleRepository,
} from './s1000dRecords';

export type { ProjectRegistry, SnsRepository, ProjectConfigRepository, ReferenceRepository, ActivityRepository, CirLinkRepository, ExtensionRepository, LifecycleRepository, UnitOfWork };

export interface Repositories extends UnitOfWork {
  /** The engine behind these repositories ('sqlite'); a contract test and the migration runner use it to pick a dialect. */
  readonly dialect: string;
  registry: ProjectRegistry;
  sns: SnsRepository;
  projectConfig: ProjectConfigRepository;
  reference: ReferenceRepository;
  cirLinks: CirLinkRepository;
  lifecycle: LifecycleRepository;
  extensions: ExtensionRepository;
  activity: ActivityRepository;
}

export function createSqliteRepositories(db: SqlDatabase): Repositories {
  return {
    dialect: 'sqlite',
    transaction: <T>(fn: () => T): T => sqliteTransaction(db, fn),
    registry: new SqliteProjectRegistry(db),
    sns: new SqliteSnsRepository(db),
    projectConfig: new SqliteProjectConfigRepository(db),
    reference: new SqliteReferenceRepository(db),
    cirLinks: new SqliteCirLinkRepository(db),
    lifecycle: new SqliteLifecycleRepository(db),
    extensions: new SqliteExtensionRepository(db),
    activity: new SqliteActivityRepository(db),
  };
}
