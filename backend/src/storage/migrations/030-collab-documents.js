'use strict';
// Migration 030-collab-documents (Phase 3, P3-1: live co-editing). One body per database engine (WP-10); additive only.

const step = {
    /*
      030 - the live co-editing rooms (services/collab).
      collab_docs: one row per document that has been edited live (room = "<projectId>/<kind>/<path>"). It holds the room's identity
      (epoch: a client holding state of another epoch drops it), the last compacted Yjs state (snapshot, up to snapshot_seq), the hash of
      the XML last read from or written to the project file (base_hash) and the last update whose effect is in that file (written_seq).
      collab_updates: the Yjs updates after the snapshot, in order. Until an update is written back to the file it is the only copy of that
      change on the server, so a crash loses nothing: the next start replays the updates after written_seq and writes the file.
      Additive: two new tables.
    */
    name: '030-collab-documents',
    sql: `CREATE TABLE IF NOT EXISTS collab_docs (
            room          TEXT PRIMARY KEY,
            project_id    TEXT NOT NULL,
            kind          TEXT NOT NULL,
            rel_path      TEXT NOT NULL,
            epoch         TEXT NOT NULL,
            snapshot      BLOB,
            snapshot_seq  INTEGER NOT NULL DEFAULT 0,
            base_hash     TEXT,
            written_seq   INTEGER NOT NULL DEFAULT 0,
            revision_at   TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_collab_docs_project ON collab_docs(project_id);
          CREATE TABLE IF NOT EXISTS collab_updates (
            room        TEXT NOT NULL,
            seq         INTEGER NOT NULL,
            data        BLOB NOT NULL,
            user_id     TEXT,
            created_at  TEXT NOT NULL,
            PRIMARY KEY (room, seq)
          );`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
