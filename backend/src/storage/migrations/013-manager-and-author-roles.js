'use strict';
// Migration 013-manager-and-author-roles. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      Roles for the three kinds of person this platform has:

        global   admin | project_manager | author        (was admin | user; every 'user' is an author)
        project  viewer < reviewer < editor < manager < owner   ('manager' is new)

      SQLite cannot widen a CHECK constraint in place, so the three tables that carry the old lists
      are rebuilt. Foreign keys must be OFF while a referenced table is dropped and renamed (the
      PRAGMA is a no-op inside a transaction, which is why `fkOff` is handled by migrate()).
    */
    name: '013-manager-and-author-roles',
    fkOff: true,
    sql: `
      CREATE TABLE users_new (
        id                   TEXT PRIMARY KEY,
        username             TEXT NOT NULL COLLATE NOCASE UNIQUE,
        full_name            TEXT NOT NULL,
        role                 TEXT NOT NULL DEFAULT 'author' CHECK (role IN ('admin','project_manager','author')),
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
      INSERT INTO users_new (id, username, full_name, role, password_hash, must_change_password, onboarding_pending,
                             username_locked, disabled_at, active_project_id, created_by, created_at, updated_at)
        SELECT id, username, full_name, CASE role WHEN 'user' THEN 'author' ELSE role END, password_hash, must_change_password,
               onboarding_pending, username_locked, disabled_at, active_project_id, created_by, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      CREATE TABLE project_members_new (
        project_id TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL CHECK (role IN ('owner','manager','editor','reviewer','viewer')),
        added_at   TEXT NOT NULL,
        added_by   TEXT,
        PRIMARY KEY (project_id, user_id)
      );
      INSERT INTO project_members_new SELECT project_id, user_id, role, added_at, added_by FROM project_members;
      DROP TABLE project_members;
      ALTER TABLE project_members_new RENAME TO project_members;
      CREATE INDEX IF NOT EXISTS ix_members_user ON project_members(user_id);

      CREATE TABLE project_invitations_new (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL CHECK (role IN ('owner','manager','editor','reviewer','viewer')),
        status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
        invited_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      INSERT INTO project_invitations_new SELECT id, project_id, user_id, role, status, invited_by, created_at, decided_at FROM project_invitations;
      DROP TABLE project_invitations;
      ALTER TABLE project_invitations_new RENAME TO project_invitations;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_invite_pending ON project_invitations(project_id, user_id) WHERE status = 'pending';
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
