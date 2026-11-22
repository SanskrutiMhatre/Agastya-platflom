'use strict';
// Immutable, content-addressed revisions.
//
// A revision is (document, sha256, reason, when, who). The bytes live once
// in `blobs`, keyed by their own hash — identical content across any number
// of documents and revisions is stored a single time, and cutting a revision
// whose content equals the current head is a no-op that REUSES the head
// (dedup by construction). Reading a revision back re-hashes the blob and
// refuses a mismatch loudly: corrupted history must never be served as if
// it were the real thing.

const crypto = require('crypto');

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

class Revisions {
  constructor(store) {
    this.store = store;
  }

  head(documentId) {
    return this.store.stmt('SELECT * FROM revisions WHERE document_id = ? ORDER BY id DESC LIMIT 1')
      .get(documentId) || null;
  }

  list(documentId, limit = 100) {
    return this.store.stmt(`
      SELECT r.id, r.document_id, r.hash, r.reason, r.created_at, r.created_by, r.contributors, b.size
      FROM revisions r JOIN blobs b ON b.hash = r.hash
      WHERE r.document_id = ? ORDER BY r.id DESC LIMIT ?
    `).all(documentId, limit);
  }

  /*
    Cut a revision from `content`. Returns { revision, reused } — reused=true
    when the head already has this exact content, in which case nothing is
    written and the head is the revision.
  */
  cut(documentId, content, { reason, createdBy = null, contributors = null, now }) {
    const buf = Buffer.from(String(content ?? ''), 'utf8');
    const hash = sha256hex(buf);
    return this.store.tx(() => {
      const head = this.head(documentId);
      if (head && head.hash === hash) return { revision: head, reused: true };
      this.store.stmt('INSERT OR IGNORE INTO blobs (hash, content, size, created_at) VALUES (?,?,?,?)')
        .run(hash, buf, buf.length, now);
      const r = this.store.stmt(`INSERT INTO revisions (document_id, hash, reason, created_at, created_by, contributors)
                                 VALUES (?,?,?,?,?,?)`)
        .run(documentId, hash, reason || 'save', now, createdBy,
          contributors && contributors.length ? JSON.stringify(contributors) : null);
      const rev = this.store.stmt('SELECT * FROM revisions WHERE id = ?').get(Number(r.lastInsertRowid));
      return { revision: rev, reused: false };
    });
  }

  /*
    Reproduce a revision's exact content. The hash is re-verified against the
    stored bytes on EVERY read — a mismatch throws rather than quietly
    serving corrupt content downstream.
  */
  content(revisionId) {
    const row = this.store.stmt(`
      SELECT r.*, b.content AS blob FROM revisions r JOIN blobs b ON b.hash = r.hash WHERE r.id = ?
    `).get(revisionId);
    if (!row) return null;
    const buf = Buffer.from(row.blob);
    const actual = sha256hex(buf);
    if (actual !== row.hash) {
      throw new Error(`Revision ${revisionId} is corrupt: stored hash ${row.hash} != computed ${actual}. Refusing to serve it.`);
    }
    return { revision: row, content: buf.toString('utf8') };
  }
}

module.exports = { Revisions, sha256hex };
