'use strict';
// Migration 009-document-comments. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /*
      Review comments on a document.

      Notes ABOUT a data module, never inside it: nothing here reaches the XML,
      the CRDT or the PDF. That separation is deliberate — a review note is not
      part of the publication, and after a week of documents merging with
      themselves, anything that does not have to touch the document text should
      not.

      Anchored by line AND by the text of that line. A comment that only knows
      "line 42" points at the wrong place the moment someone inserts a
      paragraph above it, and a review tool that quietly mis-points is worse
      than none — so the line text is kept and used to find the line again, or
      to say honestly that it has gone.

      document_id, not a path: identity survives a rename or a move, which is
      what the documents table exists for.
    */
    name: '009-document-comments',
    sql: `
      CREATE TABLE IF NOT EXISTS doc_comments (
        id           TEXT PRIMARY KEY,
        document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        line         INTEGER,
        anchor_text  TEXT,
        body         TEXT NOT NULL,
        created_by   TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        resolved_at  TEXT,
        resolved_by  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_doc_comments_doc ON doc_comments(document_id);
      CREATE INDEX IF NOT EXISTS idx_doc_comments_open ON doc_comments(document_id, resolved_at);
    `,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
