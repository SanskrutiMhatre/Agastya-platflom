'use strict';
// Migration 025-audit-chain (audit WP-29: ENT-003, ENT-017, RES-004). One file per migration, one body per database engine (WP-10).
// Never edit a migration that has shipped: add a new file instead (additive only; the framework in storage/schema.ts records a checksum).

const step = {
    /*
      025 - a tamper-evident audit trail and durable waivers. Additive: four new columns on audit_log (NULL on every existing row: rows
      written before the chain are never rewritten, the verifier counts them as "before the chain"), a unique index on the sequence
      number (two rows can never claim the same place), and three new tables:
        audit_checkpoints   "the chain had <seq> rows ending in <row_hash>" at a time, signed with the chain key; written with every
                            platform backup and daily (a copy also goes to the backup folder and the Windows Application log)
        audit_chain_anchor  one row: the last row retention removed after archiving it, so the first remaining row is checked against it
        publish_waiver_events  append-only history of publication-gate waivers (added / removed / replaced / expired) with reason,
                            actor and time (ENT-017); the active set stays in the project's publish-waivers.json
    */
    name: '025-audit-chain',
    // Every part is re-runnable: tables and indexes IF NOT EXISTS, columns added only when missing, the indexes on the new columns after them.
    columns: [
      ['audit_log', 'seq', 'INTEGER'],
      ['audit_log', 'prev_hash', 'TEXT'],
      ['audit_log', 'row_hash', 'TEXT'],
      ['audit_log', 'chain_key', 'TEXT'],
    ],
    postSql: `CREATE UNIQUE INDEX IF NOT EXISTS ix_audit_seq ON audit_log(seq);
              CREATE INDEX IF NOT EXISTS ix_audit_actor ON audit_log(actor_id, id);`,
    sql: `CREATE TABLE IF NOT EXISTS audit_checkpoints (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            at         TEXT NOT NULL,
            seq        INTEGER NOT NULL,
            row_hash   TEXT NOT NULL,
            chain_key  TEXT NOT NULL,
            reason     TEXT NOT NULL,
            signature  TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS audit_chain_anchor (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            seq        INTEGER NOT NULL,
            row_hash   TEXT NOT NULL,
            archived_at TEXT NOT NULL,
            archive    TEXT
          );
          CREATE TABLE IF NOT EXISTS publish_waiver_events (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            waiver_id  TEXT NOT NULL,
            event      TEXT NOT NULL,
            kind       TEXT NOT NULL,
            subject    TEXT NOT NULL,
            reason     TEXT,
            expires_at TEXT,
            actor      TEXT,
            at         TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS ix_waiver_events_project ON publish_waiver_events(project_id, id);`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff, postSql: step.postSql } };
