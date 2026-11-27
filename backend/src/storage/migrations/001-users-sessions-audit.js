'use strict';
// Migration 001-users-sessions-audit. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    name: '001-users-sessions-audit',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id                   TEXT PRIMARY KEY,
        username             TEXT NOT NULL COLLATE NOCASE UNIQUE,
        full_name            TEXT NOT NULL,
        role                 TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
        password_hash        TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        onboarding_pending   INTEGER NOT NULL DEFAULT 0,
        username_locked      INTEGER NOT NULL DEFAULT 0,
        disabled_at          TEXT,
        active_project_id    TEXT,
        created_by           TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id),
        token_hash  TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at  TEXT,
        revoke_reason TEXT,
        ip          TEXT,
        user_agent  TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS audit_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        at             TEXT NOT NULL,
        actor_id       TEXT,
        actor_username TEXT,
        ip             TEXT,
        action         TEXT NOT NULL,
        target_type    TEXT,
        target_id      TEXT,
        project_id     TEXT,
        meta           TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
      CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_log(action);
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
