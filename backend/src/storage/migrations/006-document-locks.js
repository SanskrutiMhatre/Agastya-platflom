'use strict';
// Migration 006-document-locks. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    // Document locks. A locked document is writable/deletable only by a
    // project owner; everyone else — editors included — is read-only on it.
    // Additive columns on the existing documents table.
    name: '006-document-locks',
    columns: [
      ['documents', 'locked_at', 'TEXT'],
      ['documents', 'locked_by', 'TEXT'],
    ],
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
