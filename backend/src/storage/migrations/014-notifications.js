'use strict';
// Migration 014-notifications. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    name: '014-notifications',
    sql: `
      CREATE TABLE IF NOT EXISTS notifications (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT NOT NULL REFERENCES users(id),
        kind       TEXT NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT,
        project_id TEXT,
        actor_id   TEXT,
        created_at TEXT NOT NULL,
        read_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_notes_user ON notifications(user_id, read_at, id);
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
