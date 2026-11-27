'use strict';
// Migration 019-review-comment-anchor. Moved verbatim from core/auth/store.js by WP-10 (PRD-002): one file per migration, with one body per database engine.
// `sqlite` is the only engine today; a PostgreSQL adapter (WP-37) adds its own body under its own key and the same name. Never edit a
// migration that has shipped: add a new file instead (additive only, see core/auth/store.js).

const step = {
    /* 019 - a review comment can be pinned to an element of a data module: JSON {path: child-index path, tag, text: the words it was made on}. Additive. */
    name: '019-review-comment-anchor',
    sql: `ALTER TABLE review_comments ADD COLUMN anchor TEXT;`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
