'use strict';
// Migration 005-documents-revisions. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    name: '005-documents-revisions',
    sql: `
      CREATE TABLE IF NOT EXISTS documents (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        rel_path   TEXT NOT NULL,
        kind       TEXT NOT NULL DEFAULT 'other',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        missing_at TEXT,
        UNIQUE (project_id, rel_path)
      );
      CREATE INDEX IF NOT EXISTS ix_documents_project ON documents(project_id);
      CREATE TABLE IF NOT EXISTS blobs (
        hash       TEXT PRIMARY KEY,
        content    BLOB NOT NULL,
        size       INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revisions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES documents(id),
        hash        TEXT NOT NULL REFERENCES blobs(hash),
        reason      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        created_by  TEXT,
        contributors TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_revisions_doc ON revisions(document_id, id);
      CREATE TABLE IF NOT EXISTS doc_state (
        document_id TEXT PRIMARY KEY REFERENCES documents(id),
        state       BLOB,
        updated_at  TEXT
      );
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
