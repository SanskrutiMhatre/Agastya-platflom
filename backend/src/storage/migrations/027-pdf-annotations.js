'use strict';
// Migration 027-pdf-annotations (Phase 3, P3-4: PDF review). One body per database engine (WP-10); additive only (new tables, nothing
// existing is touched). Number chosen by the PDF review branch as the next free one after 026-jobs; the collaboration branch may also
// claim 027 in parallel; the lead renumbers on merge (the step's name is all that has to change, nothing refers to the number).

const step = {
    /*
      027 - PDF review annotations: notes ON a PDF page (a generated build, a quick preview or a PDF stored in the project), never inside a
      source document. Deliberately apart from review_comments (notes about a data module, 009/019) and from the editors' live comments
      (the collaboration work): a PDF annotation is anchored in the PDF, not in the XML.

      pdf_annotations       one thread root. file_key = the PDF's path in the project ("jss-output.pdf", "Media/ref.pdf"). The anchor is the
                            page, rectangles in PDF user space (zoom-independent) and a text quote (exact, prefix, suffix); file_hash is the
                            SHA-256 of the PDF version the anchor was placed on. A newer build is re-anchored by the quote; an anchor that
                            cannot be placed keeps its last page and quote with anchor_state 'orphaned' ("needs re-anchoring"), never deleted.
                            orig_* keep where it was first made. source = the data module / document section it was traced to (JSON).
      pdf_annotation_replies the replies of a thread, in order.
      pdf_review_versions   every version (hash) of a reviewed PDF the server has seen, so "anchored on version 3, the file is now version 4"
                            can be said.
      pdf_review_settings   per project: block a release while required comments are open (default off).
    */
    name: '027-pdf-annotations',
    sql: `CREATE TABLE IF NOT EXISTS pdf_annotations (
            id            TEXT PRIMARY KEY,
            project_id    TEXT NOT NULL,
            file_key      TEXT NOT NULL,
            kind          TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'open',
            required      INTEGER NOT NULL DEFAULT 0,
            body          TEXT NOT NULL,
            replacement   TEXT,
            page          INTEGER NOT NULL,
            anchor        TEXT NOT NULL,
            file_hash     TEXT NOT NULL,
            anchor_state  TEXT NOT NULL DEFAULT 'placed',
            orig_page     INTEGER NOT NULL,
            orig_hash     TEXT NOT NULL,
            orig_quote    TEXT,
            source        TEXT,
            created_by    TEXT NOT NULL,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL,
            status_by     TEXT,
            status_at     TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_pdf_annotations_file ON pdf_annotations(project_id, file_key);
          CREATE INDEX IF NOT EXISTS idx_pdf_annotations_status ON pdf_annotations(project_id, status);
          CREATE TABLE IF NOT EXISTS pdf_annotation_replies (
            id             TEXT PRIMARY KEY,
            annotation_id  TEXT NOT NULL REFERENCES pdf_annotations(id) ON DELETE CASCADE,
            body           TEXT NOT NULL,
            created_by     TEXT NOT NULL,
            created_at     TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_pdf_annotation_replies ON pdf_annotation_replies(annotation_id, created_at);
          CREATE TABLE IF NOT EXISTS pdf_review_versions (
            project_id  TEXT NOT NULL,
            file_key    TEXT NOT NULL,
            hash        TEXT NOT NULL,
            pages       INTEGER,
            seen_at     TEXT NOT NULL,
            PRIMARY KEY (project_id, file_key, hash)
          );
          CREATE TABLE IF NOT EXISTS pdf_review_settings (
            project_id     TEXT PRIMARY KEY,
            block_release  INTEGER NOT NULL DEFAULT 0,
            updated_by     TEXT,
            updated_at     TEXT
          );`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
