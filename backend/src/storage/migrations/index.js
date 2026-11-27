'use strict';
// The schema migrations, in the order they run (the order of the former MIGRATIONS array in core/auth/store.js, kept exactly: 014 and 015
// ran first on the databases that exist). Each file names one step and carries a body per engine; `forDialect` hands a runner the
// steps of its engine and refuses when one is missing, so an engine cannot silently skip a step (WP-10, PRD-002).

const ORDER = [
  '014-notifications',
  '015-review-config-cir',
  '001-users-sessions-audit',
  '002-reset-queue',
  '003-membership-invitations',
  '004-project-governance',
  '005-documents-revisions',
  '007-releases',
  '008-release-scope-and-content',
  '009-document-comments',
  '006-document-locks',
  '010-folder-permissions',
  '011-folder-access-and-changes',
  '012-change-seen',
  '013-manager-and-author-roles',
  '016-s1000d-reference',
  '017-s1000d-completion',
  '018-sns-preset-model',
  '019-review-comment-anchor',
  '020-login-throttle',
  '021-project-lifecycle',
  // WP-12: from here on every step is appended with the next number (storage/schema.ts checkOrder refuses anything else).
  '022-audit-project-index',
  '023-document-leases',
  '024-directory-groups-permissions',
  '025-audit-chain',               // WP-29
  '026-jobs',                      // WP-14
];

const MIGRATIONS = ORDER.map((name) => require(`./${name}`));

function forDialect(dialect) {
  return MIGRATIONS.map((m) => {
    if (!m[dialect]) throw new Error(`Migration ${m.name} has no ${dialect} body.`);
    return { name: m.name, ...m[dialect] };
  });
}

module.exports = { ORDER, MIGRATIONS, forDialect };
