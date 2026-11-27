'use strict';
// Migration 015-review-config-cir. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      Review comments, administrator reference data and the shared CIR.

      review_comments: what a Project Manager says while a manual is in review, and what the author
      answers. A comment belongs to the PROJECT (it outlives a single release request); release_id says
      which request it was sent back with. dm_file optionally points at one data module.

      config_items: the Administrator's reference tables (enterprises, info codes, SNS ...) and the
      platform's own settings, one generic shape: (collection, id) -> JSON.

      cir_modules: the shared Common Information Repository. The XML lives in workspace/cir/<file>;
      this table is its index (who added it, what it is).
    */
    name: '015-review-config-cir',
    sql: `
      CREATE TABLE IF NOT EXISTS review_comments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  TEXT NOT NULL,
        release_id  TEXT,
        user_id     TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'comment',
        body        TEXT NOT NULL,
        dm_file     TEXT,
        created_at  TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_review_project ON review_comments(project_id, id);

      CREATE TABLE IF NOT EXISTS config_items (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );

      CREATE TABLE IF NOT EXISTS cir_modules (
        id        TEXT PRIMARY KEY,
        file      TEXT NOT NULL UNIQUE,
        title     TEXT,
        info_name TEXT,
        dmc       TEXT,
        info_code TEXT,
        kind      TEXT,
        note      TEXT,
        added_by  TEXT,
        added_at  TEXT NOT NULL
      );
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
