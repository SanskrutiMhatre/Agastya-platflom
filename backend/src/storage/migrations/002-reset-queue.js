'use strict';
// Migration 002-reset-queue. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    name: '002-reset-queue',
    sql: `
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id),
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        requested_at TEXT NOT NULL,
        requested_ip TEXT,
        decided_by   TEXT,
        decided_at   TEXT
      );
      -- ONE pending request per account, enforced by the database itself.
      CREATE UNIQUE INDEX IF NOT EXISTS ux_reset_pending
        ON password_reset_requests(user_id) WHERE status = 'pending';
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
