'use strict';
// Migration 024-directory-groups-permissions (audit WP-27: ENT-005, DEP-015, PLT-016, ENT-023). One body per database engine (WP-10);
// additive only: five new tables and six new columns on users, nothing rewritten (the users.role CHECK list is not widened - the
// read-only auditor is a flag beside the role, so no table rebuild is needed).

const step = {
    /*
      024 - directory sign-on, groups and fine-grained project permissions.

      users.auth_source         NULL or 'local' = a local account (password in this database); 'directory' = signs in against the
                                directory (LDAPS); its password_hash is random and unusable.
      users.external_id         the directory's stable id (objectGUID / entryUUID as hex, else the DN).
      users.directory_dn        the entry's DN at the last successful check.
      users.directory_checked_at when the directory last confirmed the account (sign-in or the sync job).
      users.disabled_reason     why disabled_at is set: 'directory' = offboarded by the directory (a later directory sign-in that is
                                allowed again re-enables it); NULL = an administrator disabled it (never re-enabled automatically).
      users.auditor             1 = read-only auditor: reads every project and the audit log, changes nothing (PLT-016, ENT-023).

      access_groups             named groups of people (local, or fed by a directory group through directory_group_map).
      access_group_members      who is in a group; source 'directory' rows are replaced by the sync, 'local' rows by administrators.
      project_group_grants      a project role granted to every member of a group (like folder_grants, per project).
      project_capability_rules  allow / deny one capability (dm.write, publish.build, ...) on one project for a user or a group.
                                Deny wins over every allow and every role, except the administrator and the project's owners.
      directory_group_map       a directory group DN -> a global role (admin / project_manager / author / auditor) and/or a local group.
    */
    name: '024-directory-groups-permissions',
    sql: `
      CREATE TABLE IF NOT EXISTS access_groups (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        created_by  TEXT
      );
      CREATE TABLE IF NOT EXISTS access_group_members (
        group_id  TEXT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
        user_id   TEXT NOT NULL REFERENCES users(id),
        source    TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local','directory')),
        added_at  TEXT NOT NULL,
        added_by  TEXT,
        PRIMARY KEY (group_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS ix_access_group_members_user ON access_group_members(user_id);
      CREATE TABLE IF NOT EXISTS project_group_grants (
        project_id TEXT NOT NULL,
        group_id   TEXT NOT NULL REFERENCES access_groups(id) ON DELETE CASCADE,
        role       TEXT NOT NULL CHECK (role IN ('owner','manager','editor','reviewer','viewer')),
        granted_at TEXT NOT NULL,
        granted_by TEXT,
        PRIMARY KEY (project_id, group_id)
      );
      CREATE INDEX IF NOT EXISTS ix_project_group_grants_group ON project_group_grants(group_id);
      CREATE TABLE IF NOT EXISTS project_capability_rules (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('user','group')),
        subject_id   TEXT NOT NULL,
        capability   TEXT NOT NULL,
        effect       TEXT NOT NULL CHECK (effect IN ('allow','deny')),
        created_at   TEXT NOT NULL,
        created_by   TEXT,
        UNIQUE (project_id, subject_type, subject_id, capability)
      );
      CREATE INDEX IF NOT EXISTS ix_capability_rules_project ON project_capability_rules(project_id);
      CREATE TABLE IF NOT EXISTS directory_group_map (
        id          TEXT PRIMARY KEY,
        group_dn    TEXT NOT NULL COLLATE NOCASE UNIQUE,
        global_role TEXT CHECK (global_role IS NULL OR global_role IN ('admin','project_manager','author','auditor')),
        group_id    TEXT REFERENCES access_groups(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL,
        created_by  TEXT
      );
    `,
    columns: [
      ['users', 'auth_source', 'TEXT'],
      ['users', 'external_id', 'TEXT'],
      ['users', 'directory_dn', 'TEXT'],
      ['users', 'directory_checked_at', 'TEXT'],
      ['users', 'disabled_reason', 'TEXT'],
      ['users', 'auditor', 'INTEGER NOT NULL DEFAULT 0'],
    ],
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
