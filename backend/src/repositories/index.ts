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
import { SqliteRetentionRepository, type RetentionRepository } from './retentionRepository';
import { SqliteAuditRepository, type AuditRepository } from './auditRepository';
import { SqliteLeaseRepository, type LeaseRepository, type LeaseRow } from './leaseRepository';
import { SqliteAccessRepository, type AccessRepository } from './accessRepository';
import { SqliteJobRepository, type JobRepository, type JobRow, type JobLogRow, type JobState } from './jobRepository';
import { SqliteCollabRepository, type CollabRepository, type CollabDocRow, type CollabUpdateRow, type CollabUpdateIn } from './collabRepository';
import { SqlitePdfAnnotationRepository, type PdfAnnotationRepository } from './pdfAnnotationRepository';

export type { ProjectRegistry, SnsRepository, ProjectConfigRepository, ReferenceRepository, ActivityRepository, CirLinkRepository, ExtensionRepository, LifecycleRepository, RetentionRepository, AuditRepository, AccessRepository, UnitOfWork, LeaseRepository, LeaseRow, JobRepository, JobRow, JobLogRow, JobState, PdfAnnotationRepository, CollabRepository, CollabDocRow, CollabUpdateRow, CollabUpdateIn };

export interface Repositories extends UnitOfWork {
  /** The engine behind these repositories ('sqlite'); a contract test and the migration runner use it to pick a dialect. */
  readonly dialect: string;
  /** Throws when the database does not answer (the readiness probe, PLT-031). */
  ping(): void;
  /** The names of the schema migrations this database has applied, in order; [] when none ran yet (the version handshake, WP-13). */
  appliedMigrations(): string[];
  registry: ProjectRegistry;
  sns: SnsRepository;
  projectConfig: ProjectConfigRepository;
  reference: ReferenceRepository;
  cirLinks: CirLinkRepository;
  lifecycle: LifecycleRepository;
  extensions: ExtensionRepository;
  activity: ActivityRepository;
  /** Check-out leases of documents and document parts (WP-11). */
  leases: LeaseRepository;
  /** WP-12 (PLT-007, ENT-015): housekeeping rows past their retention. */
  retention: RetentionRepository;
  /** WP-29 (ENT-003, ENT-017): the audit chain's reading side, checkpoints, anchor, export pages; waiver history. */
  audit: AuditRepository;
  /** WP-27 (PLT-016, ENT-005): groups, group grants, capability rules, the directory group map. */
  access: AccessRepository;
  /** WP-14 (PUB-004): job records and their progress lines. */
  jobs: JobRepository;
  /** Phase 3 (P3-4): PDF review annotations, replies, reviewed PDF versions and the release setting (migration 027). */
  pdfAnnotations: PdfAnnotationRepository;
  /** Phase 3 (P3-1): live co-editing rooms and their Yjs update logs. */
  collab: CollabRepository;
}

export function createSqliteRepositories(db: SqlDatabase): Repositories {
  return {
    dialect: 'sqlite',
    ping: (): void => { db.prepare('SELECT 1 AS ok').get(); },
    appliedMigrations: (): string[] => {
      try { return (db.prepare('SELECT name FROM schema_migrations ORDER BY name').all() as Array<{ name: unknown }>).map((r) => String(r.name)); } catch { return []; }
    },
    transaction: <T>(fn: () => T): T => sqliteTransaction(db, fn),
    registry: new SqliteProjectRegistry(db),
    sns: new SqliteSnsRepository(db),
    projectConfig: new SqliteProjectConfigRepository(db),
    reference: new SqliteReferenceRepository(db),
    cirLinks: new SqliteCirLinkRepository(db),
    lifecycle: new SqliteLifecycleRepository(db),
    extensions: new SqliteExtensionRepository(db),
    activity: new SqliteActivityRepository(db),
    leases: new SqliteLeaseRepository(db),
    retention: new SqliteRetentionRepository(db),
    audit: new SqliteAuditRepository(db),
    access: new SqliteAccessRepository(db),
    jobs: new SqliteJobRepository(db),
    pdfAnnotations: new SqlitePdfAnnotationRepository(db),
    collab: new SqliteCollabRepository(db),
  };
}
