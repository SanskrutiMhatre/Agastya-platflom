'use strict';
// Migration 003-membership-invitations. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    name: '003-membership-invitations',
    sql: `
      CREATE TABLE IF NOT EXISTS project_members (
        project_id TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL CHECK (role IN ('owner','editor','reviewer','viewer')),
        added_at   TEXT NOT NULL,
        added_by   TEXT,
        PRIMARY KEY (project_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS ix_members_user ON project_members(user_id);
      CREATE TABLE IF NOT EXISTS project_invitations (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL CHECK (role IN ('owner','editor','reviewer','viewer')),
        status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
        invited_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      -- ONE pending invitation per (project, user).
      CREATE UNIQUE INDEX IF NOT EXISTS ux_invite_pending
        ON project_invitations(project_id, user_id) WHERE status = 'pending';
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
