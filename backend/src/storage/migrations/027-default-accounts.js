'use strict';
// Migration 027-default-accounts (Phase 3, decision P3-6: the standalone EXE's default accounts; docs/phase3/standalone.md). One body per
// database engine (WP-10); additive only: one new table and two new columns on users, nothing rewritten, no row changed.
// The number 027 was the next free one when this was written; another Phase 3 area may add a migration in parallel - the later merge then
// renumbers its own step (storage/schema.ts checkOrder refuses two steps with one number).

const step = {
    /*
      027 - default accounts of a standalone installation.

      users.default_account   1 = created by the standalone first start with a fixed, published password (core/auth/defaultAccounts.js).
                              Stays 1 for the life of the account, so the audit and the administration page can always say which ones they were.
      users.default_password  1 = the account still has that fixed password. Cleared by every password change (store.updateUser), so it is
                              the administration page's "still has the default password" and the sign-in rule's "only from this computer".
      platform_init           one row per one-time initialisation step of this data folder (key -> what happened, when). 'default_accounts'
                              is written once: 'created' on a fresh standalone data folder, 'skipped-existing-users' on one that already had
                              accounts. While the row exists the default accounts are never created again (deleted, renamed or upgraded).
                              'default_credentials_ack' records that the first-launch screen with the credentials was acknowledged.
      The SQL is one line on purpose: the step's checksum (storage/schema.ts) is taken over this text, and a line ending cannot change it.
    */
    name: '027-default-accounts',
    sql: 'CREATE TABLE IF NOT EXISTS platform_init (key TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);',
    columns: [
      ['users', 'default_account', 'INTEGER NOT NULL DEFAULT 0'],
      ['users', 'default_password', 'INTEGER NOT NULL DEFAULT 0'],
    ],
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
