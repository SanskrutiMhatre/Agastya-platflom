'use strict';
// Migration 010-folder-permissions. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      Dashboard-folder ownership and access.

      A folder is still the `group` string its projects carry (and, when
      empty, a name in workspace.json). These tables hold only what a string
      cannot: who created it, who else may act on it, and who has asked.

      Keyed by folder_key — the trimmed, lower-cased name — because folders
      are compared case-insensitively everywhere else; a rename re-keys the
      rows. A folder with NO owner row predates this migration: it is treated
      as owned by the administrators, so only they (and anyone they grant)
      may file into it.
    */
    name: '010-folder-permissions',
    sql: `
      CREATE TABLE IF NOT EXISTS folder_owners (
        folder_key  TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        owner_id    TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS folder_grants (
        folder_key  TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        can_move    INTEGER NOT NULL DEFAULT 0,
        can_rename  INTEGER NOT NULL DEFAULT 0,
        can_delete  INTEGER NOT NULL DEFAULT 0,
        granted_by  TEXT,
        granted_at  TEXT NOT NULL,
        PRIMARY KEY (folder_key, user_id)
      );
      CREATE TABLE IF NOT EXISTS folder_access_requests (
        id          TEXT PRIMARY KEY,
        folder_key  TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        status      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        decided_by  TEXT,
        decided_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_folder_requests_open ON folder_access_requests(folder_key, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_requests_one_pending
        ON folder_access_requests(folder_key, user_id) WHERE status = 'pending';
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
