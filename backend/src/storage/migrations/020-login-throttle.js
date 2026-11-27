'use strict';
// Migration 020-login-throttle. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      020 - the per-account sign-in throttle lives in the database (audit WP-03: SEC-007, REL-006): a restart no longer
      resets it, and it counts every address together, so rotating addresses does not help. One row per throttled name:
      the attempt times of the current window as a JSON array. Additive: a new table.
    */
    name: '020-login-throttle',
    sql: `CREATE TABLE IF NOT EXISTS login_throttle (
            key        TEXT PRIMARY KEY,
            attempts   TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
