'use strict';
// TEMPORARY - DELETE THIS FILE AT MERGE. Number 025 belongs to WP-29 (audit trail), developed in parallel. The WP-14 branch carries this
// no-op step only so that its own 026-jobs passes the gap check of storage/schema.ts (checkOrder) and the branch can be tested alone.
// It must never reach main: a database that applied it would refuse WP-29's real 025 as "unknown". Replace it with WP-29's step.

module.exports = { name: '025-reserved-drop-at-merge', sqlite: { sql: 'SELECT 1;', columns: undefined, fkOff: false } };
