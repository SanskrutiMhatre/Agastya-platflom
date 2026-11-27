'use strict';
// Migration 023-document-leases (audit WP-11: ENT-016, DEP-016, RES-001, SEC-017). One body per database engine (WP-10); additive only.

const step = {
    /*
      023 - check-out leases and repository provenance.
      document_leases: a per-user check-out of a document (part '' = the whole document) or of one part of a one-file document (a JSS
      chapter, a JSG section, plate or appendix: decision D22). A lease expires at expires_at unless renewed; an expired row is simply
      taken over by the next author. cir_modules.updated_by / updated_at: who last replaced a module of the Common Information
      Repository (SEC-017: the repository view named only the first uploader). Additive: one new table, two new columns.
    */
    name: '023-document-leases',
    sql: `CREATE TABLE IF NOT EXISTS document_leases (
            document_id TEXT NOT NULL,
            part        TEXT NOT NULL DEFAULT '',
            project_id  TEXT NOT NULL,
            user_id     TEXT NOT NULL,
            username    TEXT,
            acquired_at TEXT NOT NULL,
            renewed_at  TEXT NOT NULL,
            expires_at  TEXT NOT NULL,
            PRIMARY KEY (document_id, part)
          );
          CREATE INDEX IF NOT EXISTS idx_document_leases_project ON document_leases(project_id);`,
    columns: [
      ['cir_modules', 'updated_by', 'TEXT'],
      ['cir_modules', 'updated_at', 'TEXT'],
    ],
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
