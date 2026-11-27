'use strict';
// TEMPORARY - DELETE THIS FILE AT MERGE. Number 024 belongs to WP-27 (directory sign-on), developed in parallel. The WP-14 branch carries this
// no-op step only so that its own 026-jobs passes the gap check of storage/schema.ts (checkOrder) and the branch can be tested alone.
// It must never reach main: a database that applied it would refuse WP-27's real 024 as "unknown". Replace it with WP-27's step.

module.exports = { name: '024-reserved-drop-at-merge', sqlite: { sql: 'SELECT 1;', columns: undefined, fkOff: false } };
