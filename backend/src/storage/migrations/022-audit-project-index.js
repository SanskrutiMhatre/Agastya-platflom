'use strict';
// Migration 022-audit-project-index (audit WP-12: PLT-007). One file per migration, one body per database engine (WP-10).
// Never edit a migration that has shipped: add a new file instead (additive only; the framework in storage/schema.ts records a checksum).

const step = {
    /*
      022 - the activity views filter and group audit rows by project (repositories/s1000dRecords.ts activity queries) and the
      retention job reads them by age; neither had an index. Additive: one new index, no table touched.
    */
    name: '022-audit-project-index',
    sql: `CREATE INDEX IF NOT EXISTS ix_audit_project ON audit_log(project_id, id);`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
