// SNS presets (global) and each project's own SNS hierarchy (services/sns.ts holds the rules; this holds the statements).

import { SqliteRepository, belowPattern } from './sqliteBase';
import type { SqlDatabase } from '../storage/sqlite';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SnsPresetRow { id: string; name: string; source: string; limitation: string | null; model_code: string | null; systems: number; entries: number }
export interface SnsNodeRow { path: string; level: number; code: string; title: string; definition?: string | null; preset_id?: string | null }

export interface SnsRepository {
  // presets
  presetSource(id: string): string | undefined;
  presetNodeCount(id: string): number;
  upsertSpecPreset(p: { id: string; name: string; source: string; limitation: string | null; now: string }): void;
  insertCustomPreset(p: { id: string; name: string; source: string; now: string; model: string | null }): void;
  listPresets(): SnsPresetRow[];
  presetExists(id: string): boolean;
  presetNameTaken(name: string): boolean;
  setPresetModel(id: string, model: string | null): void;
  deletePreset(id: string): void;
  presetNodes(id: string): SnsNodeRow[];
  clearPresetNodes(id: string): void;
  insertPresetNode(presetId: string, n: { path: string; level: number; code: string; title: string; definition: string }): void;
  presetNodeExists(presetId: string, path: string): boolean;
  /** Add a node of a custom preset, or retitle it when it exists. */
  putPresetNode(presetId: string, n: { path: string; level: number; code: string; title: string }): void;
  presetPathsBelow(presetId: string, path: string): string[];
  /** Delete a node and everything below it; the number of rows removed. */
  deletePresetBranch(presetId: string, path: string): number;
  // project SNS
  listProjectNodes(projectId: string): SnsNodeRow[];
  projectNode(projectId: string, path: string): SnsNodeRow | undefined;
  /** Add a node, or retitle it when it exists. */
  putProjectNode(projectId: string, n: { path: string; level: number; code: string; title: string; presetId: string | null }): void;
  insertProjectNode(projectId: string, n: { path: string; level: number; code: string; title: string; presetId: string | null }): void;
  setProjectNodeTitle(projectId: string, path: string, title: string): void;
  /** The node and everything below it, ordered by path. */
  projectBranch(projectId: string, path: string): SnsNodeRow[];
  projectPathsBelow(projectId: string, path: string): string[];
  deleteProjectBranch(projectId: string, path: string): number;
}

export class SqliteSnsRepository extends SqliteRepository implements SnsRepository {
  constructor(db: SqlDatabase) { super(db); }

  presetSource(id: string): string | undefined { return (this.q('SELECT source FROM sns_presets WHERE id = ?').get(id) as any)?.source; }
  presetNodeCount(id: string): number { return Number((this.q('SELECT COUNT(*) AS n FROM sns_preset_nodes WHERE preset_id = ?').get(id) as any).n); }
  upsertSpecPreset({ id, name, source, limitation, now }: { id: string; name: string; source: string; limitation: string | null; now: string }): void {
    this.q(`INSERT INTO sns_presets (id, name, source, limitation, created_at) VALUES (?,?,?,?,?)
                  ON CONFLICT(id) DO UPDATE SET source = excluded.source, limitation = excluded.limitation`).run(id, name, source, limitation, now);
  }
  insertCustomPreset({ id, name, source, now, model }: { id: string; name: string; source: string; now: string; model: string | null }): void {
    this.q('INSERT INTO sns_presets (id, name, source, limitation, created_at, model_code) VALUES (?,?,?,?,?,?)').run(id, name, source, null, now, model);
  }
  listPresets(): SnsPresetRow[] {
    return this.q(`SELECT p.*, (SELECT COUNT(*) FROM sns_preset_nodes n WHERE n.preset_id = p.id AND n.level = 1) AS systems,
                               (SELECT COUNT(*) FROM sns_preset_nodes n WHERE n.preset_id = p.id) AS entries FROM sns_presets p ORDER BY p.id`).all();
  }
  presetExists(id: string): boolean { return !!this.q('SELECT id FROM sns_presets WHERE id = ?').get(id); }
  presetNameTaken(name: string): boolean { return !!this.q('SELECT 1 FROM sns_presets WHERE lower(name) = lower(?)').get(name); }
  setPresetModel(id: string, model: string | null): void { this.q('UPDATE sns_presets SET model_code = ? WHERE id = ?').run(model, id); }
  deletePreset(id: string): void {
    this.q('DELETE FROM sns_preset_nodes WHERE preset_id = ?').run(id);
    this.q('DELETE FROM sns_presets WHERE id = ?').run(id);
  }
  presetNodes(id: string): SnsNodeRow[] { return this.q('SELECT * FROM sns_preset_nodes WHERE preset_id = ? ORDER BY rowid').all(id); }
  clearPresetNodes(id: string): void { this.q('DELETE FROM sns_preset_nodes WHERE preset_id = ?').run(id); }
  insertPresetNode(presetId: string, n: { path: string; level: number; code: string; title: string; definition: string }): void {
    this.q('INSERT INTO sns_preset_nodes (preset_id, path, level, code, title, definition) VALUES (?,?,?,?,?,?)').run(presetId, n.path, n.level, n.code, n.title, n.definition);
  }
  presetNodeExists(presetId: string, path: string): boolean { return !!this.q('SELECT 1 FROM sns_preset_nodes WHERE preset_id = ? AND path = ?').get(presetId, path); }
  putPresetNode(presetId: string, n: { path: string; level: number; code: string; title: string }): void {
    this.q(`INSERT INTO sns_preset_nodes (preset_id, path, level, code, title, definition) VALUES (?,?,?,?,?, '{}')
                 ON CONFLICT(preset_id, path) DO UPDATE SET title = excluded.title`).run(presetId, n.path, n.level, n.code, n.title);
  }
  presetPathsBelow(presetId: string, path: string): string[] {
    return (this.q(`SELECT path FROM sns_preset_nodes WHERE preset_id = ? AND path LIKE ? ESCAPE '\\'`).all(presetId, belowPattern(path)) as any[]).map((r) => r.path);
  }
  deletePresetBranch(presetId: string, path: string): number {
    return Number(this.q(`DELETE FROM sns_preset_nodes WHERE preset_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`).run(presetId, path, belowPattern(path)).changes);
  }

  listProjectNodes(projectId: string): SnsNodeRow[] { return this.q('SELECT * FROM project_sns WHERE project_id = ? ORDER BY path').all(projectId); }
  projectNode(projectId: string, path: string): SnsNodeRow | undefined { return this.q('SELECT * FROM project_sns WHERE project_id = ? AND path = ?').get(projectId, path); }
  putProjectNode(projectId: string, n: { path: string; level: number; code: string; title: string; presetId: string | null }): void {
    this.q(`INSERT INTO project_sns (project_id, path, level, code, title, preset_id) VALUES (?,?,?,?,?,?)
                 ON CONFLICT(project_id, path) DO UPDATE SET title = excluded.title`).run(projectId, n.path, n.level, n.code, n.title, n.presetId);
  }
  insertProjectNode(projectId: string, n: { path: string; level: number; code: string; title: string; presetId: string | null }): void {
    this.q('INSERT INTO project_sns (project_id, path, level, code, title, preset_id) VALUES (?,?,?,?,?,?)').run(projectId, n.path, n.level, n.code, n.title, n.presetId);
  }
  setProjectNodeTitle(projectId: string, path: string, title: string): void { this.q('UPDATE project_sns SET title = ? WHERE project_id = ? AND path = ?').run(title, projectId, path); }
  projectBranch(projectId: string, path: string): SnsNodeRow[] {
    return this.q(`SELECT * FROM project_sns WHERE project_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\') ORDER BY path`).all(projectId, path, belowPattern(path));
  }
  projectPathsBelow(projectId: string, path: string): string[] {
    return (this.q(`SELECT path FROM project_sns WHERE project_id = ? AND path LIKE ? ESCAPE '\\'`).all(projectId, belowPattern(path)) as any[]).map((r) => r.path);
  }
  deleteProjectBranch(projectId: string, path: string): number {
    return Number(this.q(`DELETE FROM project_sns WHERE project_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`).run(projectId, path, belowPattern(path)).changes);
  }
}
