'use strict';
// Migration 017-s1000d-completion. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      Phase 17 - complete S1000D implementation. Additive only: nothing existing is altered or dropped.
        lifecycle_events   every working revision, issue, supersession and obsolescence of a CSDB object, with who, why and when
        cir_links          a project's linked copy of a Common Information Repository module: which CIR revision it was copied from,
                           so "update available" can be computed, and who approved each update
        ext_profiles       Administrator-registered extension profiles (namespace + XSD)
        project_ext        the profiles a project has explicitly enabled
    */
    name: '017-s1000d-completion',
    sql: `
      CREATE TABLE IF NOT EXISTS lifecycle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, file TEXT NOT NULL, action TEXT NOT NULL,
        from_file TEXT, reason TEXT, detail TEXT, actor_id TEXT, actor_username TEXT, at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lifecycle_project ON lifecycle_events(project_id, file);
      CREATE TABLE IF NOT EXISTS cir_links (
        project_id TEXT NOT NULL, file TEXT NOT NULL, cir_file TEXT NOT NULL, cir_issue TEXT NOT NULL, cir_hash TEXT NOT NULL, local_hash TEXT NOT NULL,
        linked_at TEXT NOT NULL, linked_by TEXT, approved_issue TEXT, approved_by TEXT, approved_at TEXT,
        PRIMARY KEY (project_id, file)
      );
      CREATE TABLE IF NOT EXISTS ext_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, namespace TEXT NOT NULL UNIQUE, xsd_name TEXT NOT NULL, xsd_sha256 TEXT NOT NULL,
        description TEXT, created_by TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_ext (
        project_id TEXT NOT NULL, profile_id TEXT NOT NULL REFERENCES ext_profiles(id) ON DELETE CASCADE,
        enabled_by TEXT, enabled_at TEXT NOT NULL, PRIMARY KEY (project_id, profile_id)
      );
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
