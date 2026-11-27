'use strict';
// Migration 021-project-lifecycle. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      021 - project lifecycle (audit WP-06: PLT-003, PLT-004). project_missing: a project whose folder was not there at a start is
      marked, never deleted; its row and memberships stay until an administrator decides. project_tombstones: the id of a deleted
      project is never given to a new one, so nothing of the old project (documents, releases, locks) can reappear under it.
      Additive: two new tables.
    */
    name: '021-project-lifecycle',
    sql: `CREATE TABLE IF NOT EXISTS project_missing (
            project_id TEXT PRIMARY KEY,
            since      TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS project_tombstones (
            id         TEXT PRIMARY KEY,
            name       TEXT,
            deleted_at TEXT NOT NULL,
            deleted_by TEXT
          );`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
