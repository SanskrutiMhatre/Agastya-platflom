// The project registry (the `projects` and `files` tables): the same methods, statements and defaults as vendor/engine/db.js, bound to one
// database handle instead of a module-wide one (WP-10), so each application context has its own.

import { SqliteRepository } from './sqliteBase';
import { closeSqlite, type SqlDatabase } from '../storage/sqlite';

export interface RegistryProjectRow { id: string; name: string; type: string; template: string | null; created_at: string; updated_at: string; last_opened: string | null }

export interface ProjectRegistry {
  upsertProject(p: { id: string; name: string; type?: string; template?: string; now: string }): void;
  touchOpened(id: string, now: string): void;
  getProject(id: string): RegistryProjectRow | null;
  listProjects(): RegistryProjectRow[];
  deleteProject(id: string): void;
  replaceFileIndex(projectId: string, rows: Array<{ rel_path: string; kind: string; chapter?: string | null }>, now: string): void;
  listFiles(projectId: string): Array<Record<string, unknown>>;
  /** Checkpoint and close the database this registry is bound to (a clean stop). */
  close(): void;
}

export class SqliteProjectRegistry extends SqliteRepository implements ProjectRegistry {
  constructor(db: SqlDatabase) { super(db); }

  upsertProject({ id, name, type, template, now }: { id: string; name: string; type?: string; template?: string; now: string }): void {
    const existing = this.q('SELECT id, created_at FROM projects WHERE id = ?').get(id);
    if (existing) {
      this.q('UPDATE projects SET name=?, type=?, template=?, updated_at=? WHERE id=?').run(name, type || 'JSS', template || 'default', now, id);
    } else {
      this.q('INSERT INTO projects (id,name,type,template,created_at,updated_at,last_opened) VALUES (?,?,?,?,?,?,?)')
        .run(id, name, type || 'JSS', template || 'default', now, now, null);
    }
  }

  touchOpened(id: string, now: string): void { this.q('UPDATE projects SET last_opened=?, updated_at=? WHERE id=?').run(now, now, id); }

  getProject(id: string): RegistryProjectRow | null { return this.q('SELECT * FROM projects WHERE id=?').get(id) || null; }

  listProjects(): RegistryProjectRow[] { return this.q('SELECT * FROM projects ORDER BY COALESCE(last_opened, updated_at) DESC').all(); }

  deleteProject(id: string): void {
    this.q('DELETE FROM files WHERE project_id=?').run(id);
    this.q('DELETE FROM projects WHERE id=?').run(id);
  }

  replaceFileIndex(projectId: string, rows: Array<{ rel_path: string; kind: string; chapter?: string | null }>, now: string): void {
    this.q('DELETE FROM files WHERE project_id=?').run(projectId);
    const ins = this.q('INSERT OR REPLACE INTO files (project_id,rel_path,kind,chapter,updated_at) VALUES (?,?,?,?,?)');
    for (const r of rows) ins.run(projectId, r.rel_path, r.kind, r.chapter || null, now);
  }

  listFiles(projectId: string): Array<Record<string, unknown>> { return this.q('SELECT * FROM files WHERE project_id=? ORDER BY rel_path').all(projectId); }

  private closed = false;
  close(): void { if (this.closed) return; this.closed = true; closeSqlite(this.db); }
}
