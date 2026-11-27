'use strict';
// Migration 012-change-seen. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      When the person who asked was told the answer.

      A decided request is a NOTIFICATION — approved, rejected, or it could
      not be carried out — and a notification's life ends when it has been
      read, not when a clock says so. Without somewhere to record that, the
      feed kept every decision for a fixed day: a dashboard showing seven
      "approved and carried out" lines above the projects, long after anyone
      cared. Pending requests are not notifications and are unaffected: they
      are live state, and they stay until they are decided.
    */
    name: '012-change-seen',
    columns: [['change_requests', 'seen_at', 'TEXT']],
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
