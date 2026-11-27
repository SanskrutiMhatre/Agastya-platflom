'use strict';
// Migration 008-release-scope-and-content. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      A release covers the whole PDF, and covers ONE state of it.

      Two corrections to 007, both additive:

      1. Scope. A release is a property of the publication, not of one data
         module — you release the book, not a page of it. Numbering and the
         one-in-flight rule move from the document to the project. The old
         per-document pending index is replaced (an index carries no data, so
         nothing is lost by swapping it).

      2. Binding. `content_hash` records the fingerprint of every source file
         the PDF was built from at the moment the release was requested. A
         build compares that hash against the publication as it stands now: if
         a single line has changed since approval, the release no longer
         applies and the PDF is stamped NOT RELEASED again. Without this an
         approval would silently keep endorsing content nobody approved.

      `document_id` is kept and still points at the publication module, so
      every existing row stays valid and the release history keeps its link to
      a real document.
    */
    name: '008-release-scope-and-content',
    columns: [['releases', 'content_hash', 'TEXT']],
    sql: `
      DROP INDEX IF EXISTS ux_release_pending;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_release_pending_project
        ON releases(project_id) WHERE status = 'pending';
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
