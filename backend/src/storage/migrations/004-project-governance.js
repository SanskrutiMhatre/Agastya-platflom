'use strict';
// Migration 004-project-governance. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    // Governance columns on the EXISTING projects registry — additive ALTERs.
    // Existing rows default to 'active' (they are the pre-auth legacy
    // projects: live content, no owner yet, adoptable by an administrator).
    name: '004-project-governance',
    columns: [
      ['projects', 'status', "TEXT NOT NULL DEFAULT 'active'"],
      ['projects', 'requested_by', 'TEXT'],
      ['projects', 'decided_by', 'TEXT'],
      ['projects', 'decided_at', 'TEXT'],
    ],
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
