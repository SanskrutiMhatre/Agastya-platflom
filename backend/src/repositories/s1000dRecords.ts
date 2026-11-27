// Phase 17 records of the S1000D side: CIR linked copies, lifecycle events, extension profiles; and the activity read over the audit log.
// (services/cir.ts, lifecycle.ts, extensions.ts and activity.ts hold the rules.)

import { SqliteRepository } from './sqliteBase';
import type { SqlDatabase } from '../storage/sqlite';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CirLinkRow { project_id: string; file: string; cir_file: string; cir_issue: string; cir_hash: string; local_hash: string; linked_at: string; linked_by: string | null; approved_issue: string | null; approved_by: string | null; approved_at: string | null }

export interface CirLinkRepository {
  /** Record (or replace) a linked copy. */
  put(l: CirLinkRow): void;
  get(projectId: string, file: string): CirLinkRow | undefined;
  listForProject(projectId: string): CirLinkRow[];
  /** Links to a repository module whose recorded content differs from `hash`. */
  listStale(cirFile: string, hash: string): CirLinkRow[];
  approve(projectId: string, file: string, u: { issue: string; hash: string; by: string; at: string }): void;
  /** Remove a link; false when there was none. */
  remove(projectId: string, file: string): boolean;
}

export class SqliteCirLinkRepository extends SqliteRepository implements CirLinkRepository {
  constructor(db: SqlDatabase) { super(db); }
  put(l: CirLinkRow): void {
    this.q('INSERT OR REPLACE INTO cir_links (project_id, file, cir_file, cir_issue, cir_hash, local_hash, linked_at, linked_by, approved_issue, approved_by, approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(l.project_id, l.file, l.cir_file, l.cir_issue, l.cir_hash, l.local_hash, l.linked_at, l.linked_by, l.approved_issue, l.approved_by, l.approved_at);
  }
  get(projectId: string, file: string): CirLinkRow | undefined { return this.q('SELECT * FROM cir_links WHERE project_id = ? AND file = ?').get(projectId, file); }
  listForProject(projectId: string): CirLinkRow[] { return this.q('SELECT * FROM cir_links WHERE project_id = ? ORDER BY file').all(projectId); }
  listStale(cirFile: string, hash: string): CirLinkRow[] { return this.q('SELECT * FROM cir_links WHERE cir_file = ? AND cir_hash != ?').all(cirFile, hash); }
  approve(projectId: string, file: string, u: { issue: string; hash: string; by: string; at: string }): void {
    this.q('UPDATE cir_links SET cir_issue = ?, cir_hash = ?, local_hash = ?, approved_issue = ?, approved_by = ?, approved_at = ? WHERE project_id = ? AND file = ?')
      .run(u.issue, u.hash, u.hash, u.issue, u.by, u.at, projectId, file);
  }
  remove(projectId: string, file: string): boolean { return !!Number(this.q('DELETE FROM cir_links WHERE project_id = ? AND file = ?').run(projectId, file).changes); }
}

export interface LifecycleEventRow { id: number; project_id: string; file: string; action: string; from_file: string | null; reason: string | null; detail: string | null; actor_id: string | null; actor_username: string | null; at: string }

export interface LifecycleRepository {
  record(e: { projectId: string; file: string; action: string; from: string | null; reason: string | null; detail: string | null; actorId: string | null; actorUsername: string | null; at: string }): void;
  /** The events of one file (as itself or as the file it came from), newest first; or the newest 500 of the project. */
  list(projectId: string, file?: string): LifecycleEventRow[];
}

export class SqliteLifecycleRepository extends SqliteRepository implements LifecycleRepository {
  constructor(db: SqlDatabase) { super(db); }
  record(e: { projectId: string; file: string; action: string; from: string | null; reason: string | null; detail: string | null; actorId: string | null; actorUsername: string | null; at: string }): void {
    this.q('INSERT INTO lifecycle_events (project_id, file, action, from_file, reason, detail, actor_id, actor_username, at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(e.projectId, e.file, e.action, e.from, e.reason, e.detail, e.actorId, e.actorUsername, e.at);
  }
  list(projectId: string, file?: string): LifecycleEventRow[] {
    return file ? this.q('SELECT * FROM lifecycle_events WHERE project_id = ? AND (file = ? OR from_file = ?) ORDER BY id DESC').all(projectId, file, file)
      : this.q('SELECT * FROM lifecycle_events WHERE project_id = ? ORDER BY id DESC LIMIT 500').all(projectId);
  }
}

export interface ExtProfileRow { id: string; name: string; namespace: string; xsd_name: string; xsd_sha256: string; description: string | null; created_by: string | null; created_at: string }

export interface ExtensionRepository {
  listProfiles(): ExtProfileRow[];
  getProfile(id: string): ExtProfileRow | undefined;
  byNamespace(ns: string): ExtProfileRow | undefined;
  nameTaken(name: string): boolean;
  insertProfile(p: ExtProfileRow): void;
  deleteProfile(id: string): void;
  /** How many projects have this profile enabled. */
  projectCount(profileId: string): number;
  enabledFor(projectId: string): string[];
  enable(projectId: string, profileId: string, by: string, at: string): void;
  disable(projectId: string, profileId: string): void;
}

export class SqliteExtensionRepository extends SqliteRepository implements ExtensionRepository {
  constructor(db: SqlDatabase) { super(db); }
  listProfiles(): ExtProfileRow[] { return this.q('SELECT * FROM ext_profiles ORDER BY name').all(); }
  getProfile(id: string): ExtProfileRow | undefined { return this.q('SELECT * FROM ext_profiles WHERE id = ?').get(id); }
  byNamespace(ns: string): ExtProfileRow | undefined { return this.q('SELECT * FROM ext_profiles WHERE namespace = ?').get(ns); }
  nameTaken(name: string): boolean { return !!this.q('SELECT 1 FROM ext_profiles WHERE name = ?').get(name); }
  insertProfile(p: ExtProfileRow): void {
    this.q('INSERT INTO ext_profiles (id, name, namespace, xsd_name, xsd_sha256, description, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(p.id, p.name, p.namespace, p.xsd_name, p.xsd_sha256, p.description, p.created_by, p.created_at);
  }
  deleteProfile(id: string): void { this.q('DELETE FROM ext_profiles WHERE id = ?').run(id); }
  projectCount(profileId: string): number { return Number((this.q('SELECT COUNT(*) AS n FROM project_ext WHERE profile_id = ?').get(profileId) as any).n); }
  enabledFor(projectId: string): string[] { return (this.q('SELECT profile_id FROM project_ext WHERE project_id = ?').all(projectId) as any[]).map((r) => r.profile_id); }
  enable(projectId: string, profileId: string, by: string, at: string): void {
    this.q('INSERT OR IGNORE INTO project_ext (project_id, profile_id, enabled_by, enabled_at) VALUES (?,?,?,?)').run(projectId, profileId, by, at);
  }
  disable(projectId: string, profileId: string): void { this.q('DELETE FROM project_ext WHERE project_id = ? AND profile_id = ?').run(projectId, profileId); }
}

export interface ActivityRepository {
  /** Per project, person and action: how many audit rows since `since`, and the newest. */
  actionStats(projectIds: string[], since: string): Array<{ project_id: string; actor_id: string | null; action: string; n: number; last: string }>;
  /** Per project and person: the newest audit row ever. */
  lastActive(projectIds: string[]): Array<{ project_id: string; actor_id: string; last: string }>;
  /** The newest 60 audit rows of these projects. */
  feed(projectIds: string[]): Array<{ id: number; at: string; actor_username: string | null; action: string; project_id: string | null; meta: string | null }>;
}

export class SqliteActivityRepository extends SqliteRepository implements ActivityRepository {
  constructor(db: SqlDatabase) { super(db); }
  // The IN list has one placeholder per project, so these statements are prepared each time (never cached: their text varies).
  private marks(n: number): string { return Array.from({ length: n }, () => '?').join(','); }
  actionStats(projectIds: string[], since: string) {
    if (!projectIds.length) return [];
    return this.db.prepare(
      `SELECT project_id, actor_id, action, COUNT(*) AS n, MAX(at) AS last FROM audit_log
     WHERE project_id IN (${this.marks(projectIds.length)}) AND at >= ? GROUP BY project_id, actor_id, action`).all(...projectIds, since);
  }
  lastActive(projectIds: string[]) {
    if (!projectIds.length) return [];
    return this.db.prepare(
      `SELECT project_id, actor_id, MAX(at) AS last FROM audit_log WHERE project_id IN (${this.marks(projectIds.length)}) AND actor_id IS NOT NULL GROUP BY project_id, actor_id`).all(...projectIds);
  }
  feed(projectIds: string[]) {
    if (!projectIds.length) return [];
    return this.db.prepare(
      `SELECT id, at, actor_username, action, project_id, meta FROM audit_log WHERE project_id IN (${this.marks(projectIds.length)}) ORDER BY id DESC LIMIT 60`).all(...projectIds);
  }
}
