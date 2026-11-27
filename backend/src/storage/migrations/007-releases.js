'use strict';
// Migration 007-releases. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      Release maintenance — per DOCUMENT, because a publication's parts are
      released on their own schedules. A release is requested with a date and
      time that may not be in the past, and only becomes real when a software
      administrator approves it. The release NUMBER is assigned at approval,
      not at request, so "Release 1" always means the first release that
      actually happened and a rejected request leaves no gap.
    */
    name: '007-releases',
    sql: `
      CREATE TABLE IF NOT EXISTS releases (
        id             TEXT PRIMARY KEY,
        document_id    TEXT NOT NULL REFERENCES documents(id),
        project_id     TEXT NOT NULL,
        release_number INTEGER,
        scheduled_at   TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        note           TEXT,
        requested_by   TEXT NOT NULL,
        requested_at   TEXT NOT NULL,
        decided_by     TEXT,
        decided_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_releases_doc ON releases(document_id, id);
      CREATE INDEX IF NOT EXISTS ix_releases_project ON releases(project_id);
      CREATE INDEX IF NOT EXISTS ix_releases_status ON releases(status);
      -- One request in flight per document, enforced by the database.
      CREATE UNIQUE INDEX IF NOT EXISTS ux_release_pending
        ON releases(document_id) WHERE status = 'pending';
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
