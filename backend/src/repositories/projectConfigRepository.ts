// A project's S1000D configuration row, its selected codes and its offered DM types (services/projectConfig.ts holds the rules).

import { SqliteRepository, sqliteTransaction } from './sqliteBase';
import type { SqlDatabase } from '../storage/sqlite';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ProjectConfigRow { project_id: string; data: string; version: number; created_at: string; updated_at: string; updated_by: string | null }

export interface ProjectConfigRepository {
  get(projectId: string): ProjectConfigRow | undefined;
  insert(projectId: string, data: string, now: string, by: string | null): void;
  /** Replace the document and raise its version by one. */
  update(projectId: string, data: string, now: string, by: string | null): void;
  /** Copy the selected codes, the SNS and the DM-type choices of one project into another (rows already there are kept). */
  copyProjectRows(fromId: string, toId: string): void;
  /** Remove the configuration, codes, SNS and DM-type rows of a project. */
  deleteProject(projectId: string): void;
  selectedCodes(projectId: string, kind: string): string[];
  /** Replace the selection of one kind, in one transaction. */
  replaceSelectedCodes(projectId: string, kind: string, codes: string[]): void;
  disabledTypes(projectId: string): string[];
  /** Replace the list of DM types the project does NOT offer, in one transaction. */
  replaceDisabledTypes(projectId: string, disabled: string[]): void;
  recordImpact(at: string, actorId: string | null, change: string, impact: string): void;
}

export class SqliteProjectConfigRepository extends SqliteRepository implements ProjectConfigRepository {
  constructor(db: SqlDatabase) { super(db); }

  get(projectId: string): ProjectConfigRow | undefined { return this.q('SELECT * FROM project_config WHERE project_id = ?').get(projectId); }
  insert(projectId: string, data: string, now: string, by: string | null): void {
    this.q('INSERT INTO project_config (project_id, data, version, created_at, updated_at, updated_by) VALUES (?,?,1,?,?,?)').run(projectId, data, now, now, by);
  }
  update(projectId: string, data: string, now: string, by: string | null): void {
    this.q('UPDATE project_config SET data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE project_id = ?').run(data, now, by, projectId);
  }
  copyProjectRows(fromId: string, toId: string): void {
    this.q('INSERT OR IGNORE INTO project_codes (project_id, kind, code) SELECT ?, kind, code FROM project_codes WHERE project_id = ?').run(toId, fromId);
    this.q('INSERT OR IGNORE INTO project_sns (project_id, path, level, code, title, preset_id) SELECT ?, path, level, code, title, preset_id FROM project_sns WHERE project_id = ?').run(toId, fromId);
    this.q('INSERT OR IGNORE INTO project_dm_types (project_id, schema, enabled) SELECT ?, schema, enabled FROM project_dm_types WHERE project_id = ?').run(toId, fromId);
  }
  deleteProject(projectId: string): void {
    this.q('DELETE FROM project_config WHERE project_id = ?').run(projectId);
    this.q('DELETE FROM project_codes WHERE project_id = ?').run(projectId);
    this.q('DELETE FROM project_sns WHERE project_id = ?').run(projectId);
    this.q('DELETE FROM project_dm_types WHERE project_id = ?').run(projectId);
  }
  selectedCodes(projectId: string, kind: string): string[] {
    return (this.q('SELECT code FROM project_codes WHERE project_id = ? AND kind = ? ORDER BY code').all(projectId, kind) as any[]).map((r) => r.code);
  }
  replaceSelectedCodes(projectId: string, kind: string, codes: string[]): void {
    sqliteTransaction(this.db, () => {
      this.q('DELETE FROM project_codes WHERE project_id = ? AND kind = ?').run(projectId, kind);
      for (const c of codes) this.q('INSERT INTO project_codes (project_id, kind, code) VALUES (?,?,?)').run(projectId, kind, c);
    });
  }
  disabledTypes(projectId: string): string[] {
    return (this.q('SELECT schema FROM project_dm_types WHERE project_id = ? AND enabled = 0').all(projectId) as any[]).map((r) => r.schema);
  }
  replaceDisabledTypes(projectId: string, disabled: string[]): void {
    sqliteTransaction(this.db, () => {
      this.q('DELETE FROM project_dm_types WHERE project_id = ?').run(projectId);
      for (const t of disabled) this.q('INSERT INTO project_dm_types (project_id, schema, enabled) VALUES (?,?,0)').run(projectId, t);
    });
  }
  recordImpact(at: string, actorId: string | null, change: string, impact: string): void {
    this.q('INSERT INTO catalogue_impacts (at, actor_id, change, impact) VALUES (?,?,?,?)').run(at, actorId, change, impact);
  }
}
