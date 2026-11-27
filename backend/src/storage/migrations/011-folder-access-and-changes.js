'use strict';
// Migration 011-folder-access-and-changes. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      The SECOND level of access, and the approval queue that structural
      changes now go through.

      access_role is folder-level access: one project role — viewer, reviewer,
      editor or owner — held on every project filed in that folder, present
      and future, without being named on each one. The first level is
      project_members and is untouched: access to a single project stays a
      membership. A user can have both, and the stronger of the two wins.

      folder_key on the projects registry mirrors the `group` each
      project.json carries. The file stays the source of truth — this column
      is an index over it, written wherever the group is written, because
      authorization has to answer "which folder is this project in?" on every
      request and cannot open a file per project to do it.

      change_requests is the queue. Creating, renaming, moving, copying or
      deleting a folder or a project is a structural change: for anyone who is
      not a software administrator it is recorded here, with the arguments it
      will be carried out with, and nothing happens until an administrator
      approves it. Content editing never comes through here.

      Grants that already exist get NO access_role. can_move / can_rename /
      can_delete were permission to arrange the dashboard, never permission to
      read what is filed there, and a migration must not quietly turn one into
      the other.
    */
    name: '011-folder-access-and-changes',
    columns: [
      ['folder_grants', 'access_role', 'TEXT'],
      ['projects', 'folder_key', 'TEXT'],
    ],
    sql: `
      CREATE TABLE IF NOT EXISTS change_requests (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','failed')),
        payload      TEXT NOT NULL,
        summary      TEXT NOT NULL,
        project_id   TEXT,
        folder_key   TEXT,
        requested_by TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        decided_by   TEXT,
        decided_at   TEXT,
        error        TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_changes_open ON change_requests(status, created_at);
      CREATE INDEX IF NOT EXISTS ix_changes_user ON change_requests(requested_by, status);
      CREATE INDEX IF NOT EXISTS ix_changes_project ON change_requests(project_id, status);
      CREATE INDEX IF NOT EXISTS ix_changes_folder ON change_requests(folder_key, status);
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
