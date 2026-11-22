'use strict';
// Authentication / governance store over the existing publisher.db.
//
// Every schema change here is an ADDITIVE migration, tracked in
// schema_migrations: new tables, new indexes, or new columns on existing
// tables — never a rewrite, never a drop. The pre-existing `projects` and
// `files` tables from engine/db.js are left exactly as they are; governance
// columns are added alongside so an already-populated database upgrades in
// place without losing a row.
//
// All timestamps are ISO strings supplied by the caller, matching the rest
// of the codebase (the engine stays free of ambient clock reads under test).

const MIGRATIONS = [
  {
    name: '014-notifications',
    sql: `
      CREATE TABLE IF NOT EXISTS notifications (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT NOT NULL REFERENCES users(id),
        kind       TEXT NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT,
        project_id TEXT,
        actor_id   TEXT,
        created_at TEXT NOT NULL,
        read_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_notes_user ON notifications(user_id, read_at, id);
    `,
  },
  {
    /*
      Review comments, administrator reference data and the shared CIR.

      review_comments: what a Project Manager says while a manual is in review, and what the author
      answers. A comment belongs to the PROJECT (it outlives a single release request); release_id says
      which request it was sent back with. dm_file optionally points at one data module.

      config_items: the Administrator's reference tables (enterprises, info codes, SNS ...) and the
      platform's own settings, one generic shape: (collection, id) -> JSON.

      cir_modules: the shared Common Information Repository. The XML lives in workspace/cir/<file>;
      this table is its index (who added it, what it is).
    */
    name: '015-review-config-cir',
    sql: `
      CREATE TABLE IF NOT EXISTS review_comments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  TEXT NOT NULL,
        release_id  TEXT,
        user_id     TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'comment',
        body        TEXT NOT NULL,
        dm_file     TEXT,
        created_at  TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_review_project ON review_comments(project_id, id);

      CREATE TABLE IF NOT EXISTS config_items (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );

      CREATE TABLE IF NOT EXISTS cir_modules (
        id        TEXT PRIMARY KEY,
        file      TEXT NOT NULL UNIQUE,
        title     TEXT,
        info_name TEXT,
        dmc       TEXT,
        info_code TEXT,
        kind      TEXT,
        note      TEXT,
        added_by  TEXT,
        added_at  TEXT NOT NULL
      );
    `,
  },
  {
    name: '001-users-sessions-audit',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id                   TEXT PRIMARY KEY,
        username             TEXT NOT NULL COLLATE NOCASE UNIQUE,
        full_name            TEXT NOT NULL,
        role                 TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
        password_hash        TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        onboarding_pending   INTEGER NOT NULL DEFAULT 0,
        username_locked      INTEGER NOT NULL DEFAULT 0,
        disabled_at          TEXT,
        active_project_id    TEXT,
        created_by           TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id),
        token_hash  TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at  TEXT,
        revoke_reason TEXT,
        ip          TEXT,
        user_agent  TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS audit_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        at             TEXT NOT NULL,
        actor_id       TEXT,
        actor_username TEXT,
        ip             TEXT,
        action         TEXT NOT NULL,
        target_type    TEXT,
        target_id      TEXT,
        project_id     TEXT,
        meta           TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at);
      CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_log(action);
    `,
  },
  {
    name: '002-reset-queue',
    sql: `
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id),
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        requested_at TEXT NOT NULL,
        requested_ip TEXT,
        decided_by   TEXT,
        decided_at   TEXT
      );
      -- ONE pending request per account, enforced by the database itself.
      CREATE UNIQUE INDEX IF NOT EXISTS ux_reset_pending
        ON password_reset_requests(user_id) WHERE status = 'pending';
    `,
  },
  {
    name: '003-membership-invitations',
    sql: `
      CREATE TABLE IF NOT EXISTS project_members (
        project_id TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL CHECK (role IN ('owner','editor','reviewer','viewer')),
        added_at   TEXT NOT NULL,
        added_by   TEXT,
        PRIMARY KEY (project_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS ix_members_user ON project_members(user_id);
      CREATE TABLE IF NOT EXISTS project_invitations (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL CHECK (role IN ('owner','editor','reviewer','viewer')),
        status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
        invited_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      -- ONE pending invitation per (project, user).
      CREATE UNIQUE INDEX IF NOT EXISTS ux_invite_pending
        ON project_invitations(project_id, user_id) WHERE status = 'pending';
    `,
  },
  {
    // Governance columns on the EXISTING projects registry — additive ALTERs.
    // Existing rows default to 'active' (they are the pre-auth legacy
    // projects: live content, no owner yet, adoptable by an administrator).
    name: '004-project-governance',
    columns: [
      ['projects', 'status', "TEXT NOT NULL DEFAULT 'active'"],
      ['projects', 'requested_by', 'TEXT'],
      ['projects', 'decided_by', 'TEXT'],
      ['projects', 'decided_at', 'TEXT'],
    ],
  },
  {
    name: '005-documents-revisions',
    sql: `
      CREATE TABLE IF NOT EXISTS documents (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        rel_path   TEXT NOT NULL,
        kind       TEXT NOT NULL DEFAULT 'other',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        missing_at TEXT,
        UNIQUE (project_id, rel_path)
      );
      CREATE INDEX IF NOT EXISTS ix_documents_project ON documents(project_id);
      CREATE TABLE IF NOT EXISTS blobs (
        hash       TEXT PRIMARY KEY,
        content    BLOB NOT NULL,
        size       INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revisions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES documents(id),
        hash        TEXT NOT NULL REFERENCES blobs(hash),
        reason      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        created_by  TEXT,
        contributors TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_revisions_doc ON revisions(document_id, id);
      CREATE TABLE IF NOT EXISTS doc_state (
        document_id TEXT PRIMARY KEY REFERENCES documents(id),
        state       BLOB,
        updated_at  TEXT
      );
    `,
  },
  {
    /*
      Release maintenance — per DOCUMENT, because a publication's parts are
      released on their own schedules. A release is requested with a date and
      time that may not be in the past, and only becomes real when a software
      administrator approves it. The release NUMBER is assigned at approval,
      not at request, so "Release 1" always means the first release that
      actually happened and a rejected request leaves no gap.
    */
    name: '007-releases',
    sql: `
      CREATE TABLE IF NOT EXISTS releases (
        id             TEXT PRIMARY KEY,
        document_id    TEXT NOT NULL REFERENCES documents(id),
        project_id     TEXT NOT NULL,
        release_number INTEGER,
        scheduled_at   TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        note           TEXT,
        requested_by   TEXT NOT NULL,
        requested_at   TEXT NOT NULL,
        decided_by     TEXT,
        decided_at     TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_releases_doc ON releases(document_id, id);
      CREATE INDEX IF NOT EXISTS ix_releases_project ON releases(project_id);
      CREATE INDEX IF NOT EXISTS ix_releases_status ON releases(status);
      -- One request in flight per document, enforced by the database.
      CREATE UNIQUE INDEX IF NOT EXISTS ux_release_pending
        ON releases(document_id) WHERE status = 'pending';
    `,
  },
  {
    /*
      A release covers the whole PDF, and covers ONE state of it.

      Two corrections to 007, both additive:

      1. Scope. A release is a property of the publication, not of one data
         module — you release the book, not a page of it. Numbering and the
         one-in-flight rule move from the document to the project. The old
         per-document pending index is replaced (an index carries no data, so
         nothing is lost by swapping it).

      2. Binding. `content_hash` records the fingerprint of every source file
         the PDF was built from at the moment the release was requested. A
         build compares that hash against the publication as it stands now: if
         a single line has changed since approval, the release no longer
         applies and the PDF is stamped NOT RELEASED again. Without this an
         approval would silently keep endorsing content nobody approved.

      `document_id` is kept and still points at the publication module, so
      every existing row stays valid and the release history keeps its link to
      a real document.
    */
    name: '008-release-scope-and-content',
    columns: [['releases', 'content_hash', 'TEXT']],
    sql: `
      DROP INDEX IF EXISTS ux_release_pending;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_release_pending_project
        ON releases(project_id) WHERE status = 'pending';
    `,
  },
  {
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
  },
  {
    // Document locks. A locked document is writable/deletable only by a
    // project owner; everyone else — editors included — is read-only on it.
    // Additive columns on the existing documents table.
    name: '006-document-locks',
    columns: [
      ['documents', 'locked_at', 'TEXT'],
      ['documents', 'locked_by', 'TEXT'],
    ],
  },
  {
    /*
      Dashboard-folder ownership and access.

      A folder is still the `group` string its projects carry (and, when
      empty, a name in workspace.json). These tables hold only what a string
      cannot: who created it, who else may act on it, and who has asked.

      Keyed by folder_key — the trimmed, lower-cased name — because folders
      are compared case-insensitively everywhere else; a rename re-keys the
      rows. A folder with NO owner row predates this migration: it is treated
      as owned by the administrators, so only they (and anyone they grant)
      may file into it.
    */
    name: '010-folder-permissions',
    sql: `
      CREATE TABLE IF NOT EXISTS folder_owners (
        folder_key  TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        owner_id    TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS folder_grants (
        folder_key  TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        can_move    INTEGER NOT NULL DEFAULT 0,
        can_rename  INTEGER NOT NULL DEFAULT 0,
        can_delete  INTEGER NOT NULL DEFAULT 0,
        granted_by  TEXT,
        granted_at  TEXT NOT NULL,
        PRIMARY KEY (folder_key, user_id)
      );
      CREATE TABLE IF NOT EXISTS folder_access_requests (
        id          TEXT PRIMARY KEY,
        folder_key  TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        status      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        decided_by  TEXT,
        decided_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_folder_requests_open ON folder_access_requests(folder_key, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_requests_one_pending
        ON folder_access_requests(folder_key, user_id) WHERE status = 'pending';
    `,
  },
  {
    /*
      The SECOND level of access, and the approval queue that structural
      changes now go through.

      access_role is folder-level access: one project role — viewer, reviewer,
      editor or owner — held on every project filed in that folder, present
      and future, without being named on each one. The first level is
      project_members and is untouched: access to a single project stays a
      membership. A user can have both, and the stronger of the two wins.

      folder_key on the projects registry mirrors the `group` each
      project.json carries. The file stays the source of truth — this column
      is an index over it, written wherever the group is written, because
      authorization has to answer "which folder is this project in?" on every
      request and cannot open a file per project to do it.

      change_requests is the queue. Creating, renaming, moving, copying or
      deleting a folder or a project is a structural change: for anyone who is
      not a software administrator it is recorded here, with the arguments it
      will be carried out with, and nothing happens until an administrator
      approves it. Content editing never comes through here.

      Grants that already exist get NO access_role. can_move / can_rename /
      can_delete were permission to arrange the dashboard, never permission to
      read what is filed there, and a migration must not quietly turn one into
      the other.
    */
    name: '011-folder-access-and-changes',
    columns: [
      ['folder_grants', 'access_role', 'TEXT'],
      ['projects', 'folder_key', 'TEXT'],
    ],
    sql: `
      CREATE TABLE IF NOT EXISTS change_requests (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','failed')),
        payload      TEXT NOT NULL,
        summary      TEXT NOT NULL,
        project_id   TEXT,
        folder_key   TEXT,
        requested_by TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        decided_by   TEXT,
        decided_at   TEXT,
        error        TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_changes_open ON change_requests(status, created_at);
      CREATE INDEX IF NOT EXISTS ix_changes_user ON change_requests(requested_by, status);
      CREATE INDEX IF NOT EXISTS ix_changes_project ON change_requests(project_id, status);
      CREATE INDEX IF NOT EXISTS ix_changes_folder ON change_requests(folder_key, status);
    `,
  },
  {
    /*
      When the person who asked was told the answer.

      A decided request is a NOTIFICATION — approved, rejected, or it could
      not be carried out — and a notification's life ends when it has been
      read, not when a clock says so. Without somewhere to record that, the
      feed kept every decision for a fixed day: a dashboard showing seven
      "approved and carried out" lines above the projects, long after anyone
      cared. Pending requests are not notifications and are unaffected: they
      are live state, and they stay until they are decided.
    */
    name: '012-change-seen',
    columns: [['change_requests', 'seen_at', 'TEXT']],
  },
  {
    /*
      Roles for the three kinds of person this platform has:

        global   admin | project_manager | author        (was admin | user; every 'user' is an author)
        project  viewer < reviewer < editor < manager < owner   ('manager' is new)

      SQLite cannot widen a CHECK constraint in place, so the three tables that carry the old lists
      are rebuilt. Foreign keys must be OFF while a referenced table is dropped and renamed (the
      PRAGMA is a no-op inside a transaction, which is why `fkOff` is handled by migrate()).
    */
    name: '013-manager-and-author-roles',
    fkOff: true,
    sql: `
      CREATE TABLE users_new (
        id                   TEXT PRIMARY KEY,
        username             TEXT NOT NULL COLLATE NOCASE UNIQUE,
        full_name            TEXT NOT NULL,
        role                 TEXT NOT NULL DEFAULT 'author' CHECK (role IN ('admin','project_manager','author')),
        password_hash        TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        onboarding_pending   INTEGER NOT NULL DEFAULT 0,
        username_locked      INTEGER NOT NULL DEFAULT 0,
        disabled_at          TEXT,
        active_project_id    TEXT,
        created_by           TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );
      INSERT INTO users_new (id, username, full_name, role, password_hash, must_change_password, onboarding_pending,
                             username_locked, disabled_at, active_project_id, created_by, created_at, updated_at)
        SELECT id, username, full_name, CASE role WHEN 'user' THEN 'author' ELSE role END, password_hash, must_change_password,
               onboarding_pending, username_locked, disabled_at, active_project_id, created_by, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      CREATE TABLE project_members_new (
        project_id TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL CHECK (role IN ('owner','manager','editor','reviewer','viewer')),
        added_at   TEXT NOT NULL,
        added_by   TEXT,
        PRIMARY KEY (project_id, user_id)
      );
      INSERT INTO project_members_new SELECT project_id, user_id, role, added_at, added_by FROM project_members;
      DROP TABLE project_members;
      ALTER TABLE project_members_new RENAME TO project_members;
      CREATE INDEX IF NOT EXISTS ix_members_user ON project_members(user_id);

      CREATE TABLE project_invitations_new (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id    TEXT NOT NULL REFERENCES users(id),
        role       TEXT NOT NULL CHECK (role IN ('owner','manager','editor','reviewer','viewer')),
        status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
        invited_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      INSERT INTO project_invitations_new SELECT id, project_id, user_id, role, status, invited_by, created_at, decided_at FROM project_invitations;
      DROP TABLE project_invitations;
      ALTER TABLE project_invitations_new RENAME TO project_invitations;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_invite_pending ON project_invitations(project_id, user_id) WHERE status = 'pending';
    `,
  },
  {
    /*
      S1000D reference configuration: catalogues, SNS and per-project configuration. ADDITIVE ONLY.

      ref_sources        where reference data came from (file, sha-256, rule, limitation) - provenance is data, not a comment
      ref_codes          information / learn / learn-event / item-location codes, per S1000D issue. origin 'brex' rows are read
                         from the bundled default BREX and are never edited; origin 'custom' rows are the administrator's own
      ref_code_ranges    ranges the BREX leaves "project available" (a pattern, not a list: any code matching it is BREX-valid)
      ref_dmtype_codes   which codes a DM type RECOMMENDS (its default code lives in the dm-types table) (advice, never a restriction - BREX stays the validation authority)
      sns_presets / sns_preset_nodes   reusable SNS starting points (e.g. the S1000D 4.2 maintained SNS tables)
      project_config     one row per project: its S1000D configuration (MIC, issue, language, BREX, publication defaults ...)
      project_codes      the codes a project has enabled, when it narrows the catalogue (config.codeMode = 'selected')
      project_sns        the project's OWN SNS hierarchy: (project_id, path) -> title; path is "21", "21/1/0", "21/1/0/00"
      project_dm_types   the DM types a project offers (absent row = offered)
      catalogue_impacts  a record of every confirmed catalogue change that touched projects (what was previewed, who confirmed)
    */
    name: '016-s1000d-reference',
    sql: `
      CREATE TABLE IF NOT EXISTS ref_sources (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, file TEXT, sha256 TEXT, issue TEXT,
        limitation TEXT, loaded_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ref_codes (
        kind TEXT NOT NULL, issue TEXT NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('brex','custom')),
        source_id TEXT, rule_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (kind, issue, code)
      );
      CREATE TABLE IF NOT EXISTS ref_code_ranges (
        kind TEXT NOT NULL, issue TEXT NOT NULL, pattern TEXT NOT NULL, title TEXT NOT NULL, source_id TEXT, rule_id TEXT,
        PRIMARY KEY (kind, issue, pattern)
      );
      CREATE TABLE IF NOT EXISTS ref_dmtype_codes (
        schema TEXT NOT NULL, code TEXT NOT NULL, source_id TEXT NOT NULL, PRIMARY KEY (schema, code)
      );
      CREATE TABLE IF NOT EXISTS sns_presets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, source TEXT NOT NULL, limitation TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sns_preset_nodes (
        preset_id TEXT NOT NULL REFERENCES sns_presets(id) ON DELETE CASCADE, path TEXT NOT NULL,
        level INTEGER NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL, definition TEXT,
        PRIMARY KEY (preset_id, path)
      );
      CREATE TABLE IF NOT EXISTS project_config (
        project_id TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
      );
      CREATE TABLE IF NOT EXISTS project_codes (
        project_id TEXT NOT NULL, kind TEXT NOT NULL, code TEXT NOT NULL, PRIMARY KEY (project_id, kind, code)
      );
      CREATE TABLE IF NOT EXISTS project_sns (
        project_id TEXT NOT NULL, path TEXT NOT NULL, level INTEGER NOT NULL, code TEXT NOT NULL, title TEXT NOT NULL,
        preset_id TEXT, PRIMARY KEY (project_id, path)
      );
      CREATE TABLE IF NOT EXISTS project_dm_types (
        project_id TEXT NOT NULL, schema TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (project_id, schema)
      );
      CREATE TABLE IF NOT EXISTS catalogue_impacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_id TEXT, change TEXT NOT NULL, impact TEXT NOT NULL
      );
    `,
  },
  {
    /*
      Phase 17 - complete S1000D implementation. Additive only: nothing existing is altered or dropped.
        lifecycle_events   every working revision, issue, supersession and obsolescence of a CSDB object, with who, why and when
        cir_links          a project's linked copy of a Common Information Repository module: which CIR revision it was copied from,
                           so "update available" can be computed, and who approved each update
        ext_profiles       Administrator-registered extension profiles (namespace + XSD)
        project_ext        the profiles a project has explicitly enabled
    */
    name: '017-s1000d-completion',
    sql: `
      CREATE TABLE IF NOT EXISTS lifecycle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, file TEXT NOT NULL, action TEXT NOT NULL,
        from_file TEXT, reason TEXT, detail TEXT, actor_id TEXT, actor_username TEXT, at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lifecycle_project ON lifecycle_events(project_id, file);
      CREATE TABLE IF NOT EXISTS cir_links (
        project_id TEXT NOT NULL, file TEXT NOT NULL, cir_file TEXT NOT NULL, cir_issue TEXT NOT NULL, cir_hash TEXT NOT NULL, local_hash TEXT NOT NULL,
        linked_at TEXT NOT NULL, linked_by TEXT, approved_issue TEXT, approved_by TEXT, approved_at TEXT,
        PRIMARY KEY (project_id, file)
      );
      CREATE TABLE IF NOT EXISTS ext_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, namespace TEXT NOT NULL UNIQUE, xsd_name TEXT NOT NULL, xsd_sha256 TEXT NOT NULL,
        description TEXT, created_by TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_ext (
        project_id TEXT NOT NULL, profile_id TEXT NOT NULL REFERENCES ext_profiles(id) ON DELETE CASCADE,
        enabled_by TEXT, enabled_at TEXT NOT NULL, PRIMARY KEY (project_id, profile_id)
      );
    `,
  },
  {
    /*
      018 - SNS presets can belong to a model: the Administrator types the model code (and, in the preset's name, the model name), builds the model's systems,
      subsystems and assemblies once, and a project with that model code is offered that SNS when it is created. Additive: one nullable column.
    */
    name: '018-sns-preset-model',
    sql: `ALTER TABLE sns_presets ADD COLUMN model_code TEXT;`,
  },
  {
    /* 019 - a review comment can be pinned to an element of a data module: JSON {path: child-index path, tag, text: the words it was made on}. Additive. */
    name: '019-review-comment-anchor',
    sql: `ALTER TABLE review_comments ADD COLUMN anchor TEXT;`,
  },
];

/*
  Role strength as a number, inside SQL, so a project membership and a
  folder-level grant can be compared in the query that reads them. The order
  is the one ROLE_RANK in authz.js uses; anything else (NULL, an unknown
  string) is 0, weaker than every real role.
*/
const rankSql = (col) =>
  `CASE ${col} WHEN 'owner' THEN 5 WHEN 'manager' THEN 4 WHEN 'editor' THEN 3 WHEN 'reviewer' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END`;

class AuthStore {
  constructor(db) {
    this.db = db;
    this._stmts = new Map();
  }

  stmt(sql) {
    let s = this._stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); this._stmts.set(sql, s); }
    return s;
  }

  migrate(nowIso) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TEXT NOT NULL
    );`);
    const applied = new Set(this.db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
    for (const m of MIGRATIONS) {
      if (applied.has(m.name)) continue;
      if (m.fkOff) this.db.exec('PRAGMA foreign_keys = OFF');
      this.db.exec('BEGIN');
      try {
        if (m.sql) this.db.exec(m.sql);
        if (m.columns) {
          for (const [table, col, def] of m.columns) {
            const has = this.db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, col);
            if (!has) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
          }
        }
        this.db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(m.name, nowIso);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw new Error(`Migration ${m.name} failed: ${e.message}`);
      } finally {
        if (m.fkOff) {
          this.db.exec('PRAGMA foreign_keys = ON');
          const bad = this.db.prepare('PRAGMA foreign_key_check').all();
          if (bad.length) throw new Error(`Migration ${m.name} left ${bad.length} broken foreign key(s).`);
        }
      }
    }
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---- users --------------------------------------------------------------

  createUser({ id, username, fullName, role, passwordHash, mustChangePassword = 0, onboardingPending = 0, usernameLocked = 0, createdBy = null, now }) {
    this.stmt(`INSERT INTO users
      (id, username, full_name, role, password_hash, must_change_password, onboarding_pending, username_locked, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, username, fullName, role, passwordHash, mustChangePassword ? 1 : 0, onboardingPending ? 1 : 0, usernameLocked ? 1 : 0, createdBy, now, now);
    return this.getUser(id);
  }

  getUser(id) {
    return this.stmt('SELECT * FROM users WHERE id = ?').get(id) || null;
  }

  findUserByUsername(username) {
    return this.stmt('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username || '')) || null;
  }

  listUsers() {
    return this.stmt('SELECT * FROM users ORDER BY created_at').all();
  }

  /*
    Prefix/substring search for the invite & member autocomplete. Username is
    matched as a prefix, full name as a substring; disabled accounts are
    excluded. Bounded result set — never a full directory dump.
  */
  searchUsers(query, limit = 8) {
    const q = String(query || '').trim();
    if (!q) return [];
    const esc = q.replace(/[%_\\]/g, '\\$&');
    return this.stmt(`
      SELECT username, full_name, role FROM users
      WHERE disabled_at IS NULL
        AND (username LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\')
      ORDER BY
        CASE WHEN username LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
        username
      LIMIT ?
    `).all(esc + '%', '%' + esc + '%', esc + '%', Math.min(limit, 20));
  }

  countAdmins() {
    return this.stmt("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  }

  anyAdminExists() { return this.countAdmins() > 0; }

  updateUser(id, fields, now) {
    const allowed = ['full_name', 'role', 'password_hash', 'must_change_password', 'onboarding_pending', 'username_locked', 'disabled_at', 'active_project_id', 'username'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return this.getUser(id);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    this.stmt(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), now, id);
    return this.getUser(id);
  }

  // ---- sessions -----------------------------------------------------------

  /*
    SINGLE ACTIVE SESSION, done atomically and in the safe order: the new
    session row is persisted FIRST, then every other live session for the
    account is revoked, all inside one transaction. A crash between the two
    statements can therefore never leave the account with zero valid
    sessions after a successful login.
  */
  insertSessionDisplacing({ id, userId, tokenHash, now, expiresAt, ip, userAgent }) {
    return this.tx(() => {
      this.stmt(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent)
                 VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, userId, tokenHash, now, expiresAt, now, ip || null, userAgent || null);
      const r = this.stmt(`UPDATE sessions SET revoked_at = ?, revoke_reason = 'displaced'
                           WHERE user_id = ? AND id != ? AND revoked_at IS NULL`)
        .run(now, userId, id);
      return { displaced: Number(r.changes) };
    });
  }

  /*
    Token → session + user in ONE query. Unknown token, revoked session,
    expired session and disabled account all fall out of the same WHERE
    clause, so no code path can forget one of them.
  */
  resolveSession(tokenHash, nowIso) {
    return this.stmt(`
      SELECT s.id AS session_id, s.user_id, s.created_at AS session_created_at,
             s.expires_at, s.last_seen_at, u.*
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
        AND u.disabled_at IS NULL
    `).get(tokenHash, nowIso) || null;
  }

  touchSession(sessionId, now) {
    this.stmt('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, sessionId);
  }

  revokeSessionById(sessionId, reason, now) {
    const r = this.stmt('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL')
      .run(now, reason, sessionId);
    return Number(r.changes);
  }

  revokeAllSessionsForUser(userId, reason, now, exceptSessionId = null) {
    const r = exceptSessionId
      ? this.stmt('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL')
        .run(now, reason, userId, exceptSessionId)
      : this.stmt('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(now, reason, userId);
    return Number(r.changes);
  }

  listActiveSessions(nowIso) {
    return this.stmt(`
      SELECT s.id, s.user_id, s.created_at, s.expires_at, s.last_seen_at, s.ip, s.user_agent,
             u.username, u.full_name, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL AND s.expires_at > ?
      ORDER BY s.last_seen_at DESC
    `).all(nowIso);
  }

  // ---- notifications ------------------------------------------------------

  insertNotification({ userId, kind, title, body, projectId, actorId, now }) {
    this.stmt('INSERT INTO notifications (user_id, kind, title, body, project_id, actor_id, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(userId, kind, title, body || null, projectId || null, actorId || null, now);
  }

  listNotifications(userId, limit = 100) {
    return this.stmt('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
  }

  countUnreadNotifications(userId) {
    return this.stmt('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
  }

  markNotificationsRead(userId, ids, now) {
    if (!ids) return this.stmt('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId).changes;
    let n = 0;
    for (const id of ids) n += this.stmt('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(now, Number(id), userId).changes;
    return n;
  }

  // ---- audit --------------------------------------------------------------

  appendAudit({ at, actorId, actorUsername, ip, action, targetType, targetId, projectId, meta }) {
    this.stmt(`INSERT INTO audit_log (at, actor_id, actor_username, ip, action, target_type, target_id, project_id, meta)
               VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(at, actorId || null, actorUsername || null, ip || null, action,
        targetType || null, targetId || null, projectId || null,
        meta ? JSON.stringify(meta) : null);
  }

  listAudit({ limit = 200, before = null, action = null } = {}) {
    if (before && action) {
      return this.stmt('SELECT * FROM audit_log WHERE id < ? AND action LIKE ? ORDER BY id DESC LIMIT ?').all(before, action + '%', limit);
    }
    if (before) return this.stmt('SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, limit);
    if (action) return this.stmt('SELECT * FROM audit_log WHERE action LIKE ? ORDER BY id DESC LIMIT ?').all(action + '%', limit);
    return this.stmt('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  }

  // ---- password reset queue ----------------------------------------------

  createResetRequest({ id, userId, now, ip }) {
    try {
      this.stmt('INSERT INTO password_reset_requests (id, user_id, status, requested_at, requested_ip) VALUES (?,?,?,?,?)')
        .run(id, userId, 'pending', now, ip || null);
      return { created: true };
    } catch (e) {
      // Partial unique index: one pending request per account. A duplicate
      // submission is a silent success for the caller (neutral response).
      if (/UNIQUE/i.test(e.message)) return { created: false, duplicate: true };
      throw e;
    }
  }

  listResetRequests(status = 'pending') {
    return this.stmt(`
      SELECT r.*, u.username, u.full_name, u.role, u.username_locked, u.disabled_at
      FROM password_reset_requests r JOIN users u ON u.id = r.user_id
      WHERE r.status = ? ORDER BY r.requested_at
    `).all(status);
  }

  getResetRequest(id) {
    return this.stmt('SELECT * FROM password_reset_requests WHERE id = ?').get(id) || null;
  }

  decideResetRequest(id, status, decidedBy, now) {
    const r = this.stmt(`UPDATE password_reset_requests SET status = ?, decided_by = ?, decided_at = ?
                         WHERE id = ? AND status = 'pending'`)
      .run(status, decidedBy, now, id);
    return Number(r.changes) === 1;
  }

  // ---- project governance -------------------------------------------------

  getProjectRow(projectId) {
    return this.stmt('SELECT * FROM projects WHERE id = ?').get(projectId) || null;
  }

  setProjectStatus(projectId, status, decidedBy, now) {
    this.stmt('UPDATE projects SET status = ?, decided_by = ?, decided_at = ?, updated_at = ? WHERE id = ?')
      .run(status, decidedBy || null, now, now, projectId);
  }

  setProjectRequestedBy(projectId, userId, status, now) {
    this.stmt('UPDATE projects SET requested_by = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(userId, status, now, projectId);
  }

  listProjectsByStatus(status) {
    return this.stmt('SELECT * FROM projects WHERE status = ? ORDER BY created_at').all(status);
  }

  // Projects with no owner at all — the legacy pre-auth content, surfaced to
  // administrators for explicit adoption (never silently assigned).
  listOwnerlessProjects() {
    return this.stmt(`
      SELECT p.* FROM projects p
      WHERE NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.role = 'owner')
      ORDER BY p.id
    `).all();
  }

  // Every project (for the administrator's ownership-management view).
  listAllProjects() {
    return this.stmt("SELECT * FROM projects WHERE type <> 'CIR' ORDER BY COALESCE(last_opened, updated_at) DESC").all();
  }

  // The Common Information Repository's own workspace (a system project: never listed, open to every signed-in user).
  getCirProjectRow() {
    return this.stmt("SELECT * FROM projects WHERE type = 'CIR' LIMIT 1").get() || null;
  }

  // The owner memberships of a project, with the person's identity.
  listOwners(projectId) {
    return this.stmt(`
      SELECT m.user_id, u.username, u.full_name, u.disabled_at
      FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ? AND m.role = 'owner'
      ORDER BY u.username
    `).all(projectId);
  }

  // ---- membership ---------------------------------------------------------

  getMembership(projectId, userId) {
    return this.stmt('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId) || null;
  }

  listMembers(projectId) {
    return this.stmt(`
      SELECT m.*, u.username, u.full_name, u.role AS global_role, u.disabled_at
      FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ? ORDER BY
        CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'editor' THEN 2 WHEN 'reviewer' THEN 3 ELSE 4 END,
        u.username
    `).all(projectId);
  }

  /*
    Every project this user may open, by EITHER level of access: a membership
    on the project itself, or a role granted on the folder it is filed in.

    `member_role` is the stronger of the two — that is the role they really
    hold — and `access_via` says which level it came from, so a screen can
    tell someone why they can see something they were never named on.
  */
  listProjectsForUser(userId) {
    return this.stmt(`
      SELECT p.*,
        CASE WHEN ${rankSql('m.role')} >= ${rankSql('g.access_role')} THEN m.role ELSE g.access_role END AS member_role,
        CASE WHEN ${rankSql('g.access_role')} > ${rankSql('m.role')} THEN 'folder' ELSE 'project' END AS access_via
      FROM projects p
      LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?
      LEFT JOIN folder_grants g ON g.folder_key = p.folder_key AND g.user_id = ?
                                AND g.access_role IS NOT NULL
      WHERE (m.user_id IS NOT NULL OR g.user_id IS NOT NULL) AND p.type <> 'CIR'
      ORDER BY COALESCE(p.last_opened, p.updated_at) DESC
    `).all(userId, userId);
  }

  upsertMember(projectId, userId, role, addedBy, now) {
    this.stmt(`INSERT INTO project_members (project_id, user_id, role, added_at, added_by)
               VALUES (?,?,?,?,?)
               ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`)
      .run(projectId, userId, role, now, addedBy || null);
  }

  removeMember(projectId, userId) {
    const r = this.stmt('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId);
    return Number(r.changes);
  }

  countOwners(projectId) {
    return this.stmt("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'owner'").get(projectId).n;
  }

  // Called when a project disappears from disk or is deleted: memberships and
  // invitations point at nothing and are cleared. Revisions and audit rows
  // are history and stay.
  clearProjectGovernance(projectId) {
    this.stmt('DELETE FROM project_members WHERE project_id = ?').run(projectId);
    this.stmt("UPDATE project_invitations SET status = 'revoked' WHERE project_id = ? AND status = 'pending'").run(projectId);
    // A queued change against a project that no longer exists can never be
    // carried out; it is closed here rather than left for an administrator to
    // approve into an error.
    this.stmt(`UPDATE change_requests SET status = 'failed', error = 'The project no longer exists.'
               WHERE project_id = ? AND status = 'pending'`).run(projectId);
  }

  // ---- releases -----------------------------------------------------------

  createRelease({ id, documentId, projectId, scheduledAt, note, requestedBy, contentHash, now }) {
    try {
      this.stmt(`INSERT INTO releases (id, document_id, project_id, scheduled_at, status, note, requested_by, requested_at, content_hash)
                 VALUES (?,?,?,?, 'pending', ?,?,?,?)`)
        .run(id, documentId, projectId, scheduledAt, note || null, requestedBy, now, contentHash || null);
      return { created: true };
    } catch (e) {
      // The partial unique index is the real guard against two in-flight
      // requests for one project.
      if (/UNIQUE/i.test(e.message)) return { created: false, duplicate: true };
      throw e;
    }
  }

  getRelease(id) {
    return this.stmt('SELECT * FROM releases WHERE id = ?').get(id) || null;
  }

  /*
    The release a PROJECT is currently on: the highest-numbered approved
    release whose scheduled moment has arrived. A release approved for a
    future date is real but not yet in force, which is what lets a team line
    an issue up in advance.

    Note this answers "what has been approved", NOT "is the PDF released" —
    the caller still has to check the content hash against the publication as
    it stands, because an approval covers the content that was approved.
  */
  currentRelease(projectId, nowIso) {
    return this.stmt(`SELECT * FROM releases
                      WHERE project_id = ? AND status = 'approved' AND scheduled_at <= ?
                      ORDER BY release_number DESC LIMIT 1`)
      .get(projectId, nowIso) || null;
  }

  // The approved release for this project that has not taken effect yet.
  /*
    An approved release whose moment has not arrived yet. Not the current
    release — the PDF still carries the NOT RELEASED stamp until this date —
    but settled, which is the difference between "nobody has approved this"
    and "approved, effective on Friday".
  */
  scheduledRelease(projectId, nowIso) {
    return this.stmt(`SELECT * FROM releases
                      WHERE project_id = ? AND status = 'approved' AND scheduled_at > ?
                      ORDER BY scheduled_at ASC LIMIT 1`)
      .get(projectId, nowIso) || null;
  }

  pendingRelease(projectId) {
    return this.stmt(`SELECT * FROM releases WHERE project_id = ? AND status = 'pending' LIMIT 1`)
      .get(projectId) || null;
  }

  listReleasesForDocument(documentId) {
    return this.stmt('SELECT * FROM releases WHERE document_id = ? ORDER BY id DESC').all(documentId);
  }

  listReleasesForProject(projectId) {
    return this.stmt(`
      SELECT r.*, d.rel_path, u.username AS requested_by_username
      FROM releases r
      JOIN documents d ON d.id = r.document_id
      LEFT JOIN users u ON u.id = r.requested_by
      WHERE r.project_id = ? ORDER BY r.id DESC
    `).all(projectId);
  }

  listPendingReleases() {
    return this.stmt(`
      SELECT r.*, d.rel_path, p.name AS project_name, u.username AS requested_by_username, u.full_name AS requested_by_name
      FROM releases r
      JOIN documents d ON d.id = r.document_id
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON u.id = r.requested_by
      WHERE r.status = 'pending' ORDER BY r.scheduled_at
    `).all();
  }

  /*
    Approve inside one transaction: the next release number is read and
    written under the same write lock, so two administrators approving at the
    same moment cannot both mint "Release 3".
  */
  approveRelease(id, decidedBy, now) {
    return this.tx(() => {
      const r = this.stmt("SELECT * FROM releases WHERE id = ? AND status = 'pending'").get(id);
      if (!r) return null;
      // Numbered per PROJECT: the release is of the publication, so the book's
      // second release is "Release 2" whichever of its modules changed.
      const max = this.stmt("SELECT MAX(release_number) AS n FROM releases WHERE project_id = ? AND status = 'approved'")
        .get(r.project_id).n || 0;
      const next = max + 1;
      this.stmt("UPDATE releases SET status = 'approved', release_number = ?, decided_by = ?, decided_at = ? WHERE id = ?")
        .run(next, decidedBy, now, id);
      return { ...r, status: 'approved', release_number: next };
    });
  }

  rejectRelease(id, decidedBy, now) {
    const r = this.stmt(`UPDATE releases SET status = 'rejected', decided_by = ?, decided_at = ?
                         WHERE id = ? AND status = 'pending'`).run(decidedBy, now, id);
    return Number(r.changes) === 1;
  }

  withdrawRelease(id, documentId) {
    const r = this.stmt(`DELETE FROM releases WHERE id = ? AND document_id = ? AND status = 'pending'`)
      .run(id, documentId);
    return Number(r.changes) === 1;
  }

  // ---- document locks -----------------------------------------------------

  lockDocument(docId, userId, now) {
    const r = this.stmt('UPDATE documents SET locked_at = ?, locked_by = ?, updated_at = ? WHERE id = ? AND locked_at IS NULL')
      .run(now, userId, now, docId);
    return Number(r.changes) === 1; // false if it was already locked
  }

  unlockDocument(docId, now) {
    const r = this.stmt('UPDATE documents SET locked_at = NULL, locked_by = NULL, updated_at = ? WHERE id = ? AND locked_at IS NOT NULL')
      .run(now, docId);
    return Number(r.changes) === 1; // false if it was not locked
  }

  // The rel_paths of every locked document in a project — for the file tree
  // to badge locked files without a round-trip per file.
  listLockedPaths(projectId) {
    return this.stmt('SELECT rel_path FROM documents WHERE project_id = ? AND locked_at IS NOT NULL')
      .all(projectId).map((r) => r.rel_path);
  }

  // ---- invitations --------------------------------------------------------

  createInvitation({ id, projectId, userId, role, invitedBy, now }) {
    try {
      this.stmt(`INSERT INTO project_invitations (id, project_id, user_id, role, status, invited_by, created_at)
                 VALUES (?,?,?,?, 'pending', ?, ?)`)
        .run(id, projectId, userId, role, invitedBy, now);
      return { created: true };
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return { created: false, duplicate: true };
      throw e;
    }
  }

  listInvitationsForUser(userId) {
    return this.stmt(`
      SELECT i.*, p.name AS project_name, p.type AS project_type, u.username AS invited_by_username, u.full_name AS invited_by_name
      FROM project_invitations i
      JOIN projects p ON p.id = i.project_id
      LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.user_id = ? AND i.status = 'pending'
      ORDER BY i.created_at DESC
    `).all(userId);
  }

  listInvitationsForProject(projectId) {
    return this.stmt(`
      SELECT i.*, u.username, u.full_name
      FROM project_invitations i JOIN users u ON u.id = i.user_id
      WHERE i.project_id = ? AND i.status = 'pending'
      ORDER BY i.created_at
    `).all(projectId);
  }

  getInvitation(id) {
    return this.stmt('SELECT * FROM project_invitations WHERE id = ?').get(id) || null;
  }

  /*
    Accept/decline are BOUND TO THE INVITED USER in the WHERE clause: the
    status flip only happens when (id, user_id, 'pending') all match, so no
    one can act on another account's invitation, and membership is written
    only inside the same transaction as a successful flip.
  */
  acceptInvitation(invitationId, userId, now) {
    return this.tx(() => {
      const inv = this.stmt(`SELECT * FROM project_invitations WHERE id = ? AND user_id = ? AND status = 'pending'`)
        .get(invitationId, userId);
      if (!inv) return null;
      const r = this.stmt(`UPDATE project_invitations SET status = 'accepted', decided_at = ?
                           WHERE id = ? AND user_id = ? AND status = 'pending'`)
        .run(now, invitationId, userId);
      if (Number(r.changes) !== 1) return null;
      this.stmt(`INSERT INTO project_members (project_id, user_id, role, added_at, added_by)
                 VALUES (?,?,?,?,?)
                 ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role`)
        .run(inv.project_id, userId, inv.role, now, inv.invited_by);
      return inv;
    });
  }

  declineInvitation(invitationId, userId, now) {
    return this.tx(() => {
      const inv = this.stmt(`SELECT * FROM project_invitations WHERE id = ? AND user_id = ? AND status = 'pending'`)
        .get(invitationId, userId);
      if (!inv) return null;
      this.stmt(`UPDATE project_invitations SET status = 'declined', decided_at = ?
                 WHERE id = ? AND user_id = ? AND status = 'pending'`)
        .run(now, invitationId, userId);
      return inv;
    });
  }

  // ---- review comments ----------------------------------------------------

  listComments(documentId) {
    return this.stmt(`SELECT c.*, u.username AS author_username, u.full_name AS author_name,
                             r.username AS resolver_username
                      FROM doc_comments c
                      LEFT JOIN users u ON u.id = c.created_by
                      LEFT JOIN users r ON r.id = c.resolved_by
                      WHERE c.document_id = ?
                      ORDER BY c.resolved_at IS NOT NULL, c.line IS NULL, c.line, c.created_at`)
      .all(String(documentId));
  }

  // Every open comment in a project, for the review queue.
  listProjectComments(projectId, { openOnly = true } = {}) {
    return this.stmt(`SELECT c.*, d.rel_path, u.username AS author_username
                      FROM doc_comments c
                      JOIN documents d ON d.id = c.document_id
                      LEFT JOIN users u ON u.id = c.created_by
                      WHERE d.project_id = ?${openOnly ? ' AND c.resolved_at IS NULL' : ''}
                      ORDER BY d.rel_path, c.line IS NULL, c.line`)
      .all(String(projectId));
  }

  getComment(id) {
    return this.stmt('SELECT * FROM doc_comments WHERE id = ?').get(String(id)) || null;
  }

  addComment({ id, documentId, line, anchorText, body, userId, now }) {
    this.stmt(`INSERT INTO doc_comments
                 (id, document_id, line, anchor_text, body, created_by, created_at)
               VALUES (?,?,?,?,?,?,?)`)
      .run(id, String(documentId), line == null ? null : Number(line),
           anchorText == null ? null : String(anchorText), String(body), String(userId), now);
    return this.getComment(id);
  }

  // Resolving is reversible: a comment closed by mistake can be reopened
  // rather than deleted, so the discussion is not lost with it.
  setCommentResolved(id, resolved, userId, now) {
    this.stmt('UPDATE doc_comments SET resolved_at = ?, resolved_by = ? WHERE id = ?')
      .run(resolved ? now : null, resolved ? String(userId) : null, String(id));
    return this.getComment(id);
  }

  deleteComment(id) {
    this.stmt('DELETE FROM doc_comments WHERE id = ?').run(String(id));
  }

  revokeInvitation(invitationId, projectId, now) {
    const r = this.stmt(`UPDATE project_invitations SET status = 'revoked', decided_at = ?
                         WHERE id = ? AND project_id = ? AND status = 'pending'`)
      .run(now, invitationId, projectId);
    return Number(r.changes) === 1;
  }

  // ---- dashboard folders: owner, grants, access requests -----------------
  // All keyed by folderKey(name): trimmed + lower-cased, matching how folder
  // names are compared everywhere else.

  getFolderOwner(key) {
    return this.stmt(`SELECT f.*, u.username, u.full_name FROM folder_owners f
                      LEFT JOIN users u ON u.id = f.owner_id WHERE f.folder_key = ?`).get(key) || null;
  }

  listFolderOwners() {
    return this.stmt(`SELECT f.*, u.username, u.full_name FROM folder_owners f
                      LEFT JOIN users u ON u.id = f.owner_id`).all();
  }

  // First writer wins: a folder that already has an owner keeps it.
  setFolderOwnerIfAbsent(key, name, ownerId, now) {
    this.stmt(`INSERT OR IGNORE INTO folder_owners (folder_key, name, owner_id, created_at)
               VALUES (?, ?, ?, ?)`).run(key, name, ownerId, now);
  }

  getFolderGrant(key, userId) {
    return this.stmt('SELECT * FROM folder_grants WHERE folder_key = ? AND user_id = ?').get(key, userId) || null;
  }

  listFolderGrants(key) {
    return this.stmt(`SELECT g.*, u.username, u.full_name FROM folder_grants g
                      JOIN users u ON u.id = g.user_id
                      WHERE g.folder_key = ? ORDER BY u.username`).all(key);
  }

  // Replace the whole grant set for a folder in one transaction, so a save
  // that removes someone actually removes them. A grant is a folder-level
  // access role; a row with no role is no grant at all, so it is dropped.
  replaceFolderGrants(key, grants, grantedBy, now) {
    this.db.exec('BEGIN');
    try {
      this.stmt('DELETE FROM folder_grants WHERE folder_key = ?').run(key);
      const ins = this.stmt(`INSERT INTO folder_grants
        (folder_key, user_id, can_move, can_rename, can_delete, access_role, granted_by, granted_at)
        VALUES (?, ?, 0, 0, 0, ?, ?, ?)`);
      for (const g of grants) {
        if (!g.role) continue;
        ins.run(key, g.userId, g.role, grantedBy, now);
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // Give one person folder-level access, leaving everyone else's alone —
  // what accepting a request for a folder does.
  grantFolderAccess(key, userId, role, grantedBy, now) {
    if (this.getFolderGrant(key, userId)) {
      this.stmt(`UPDATE folder_grants SET access_role = ?, granted_by = ?, granted_at = ?
                 WHERE folder_key = ? AND user_id = ?`).run(role, grantedBy, now, key, userId);
    } else {
      this.stmt(`INSERT INTO folder_grants
        (folder_key, user_id, can_move, can_rename, can_delete, access_role, granted_by, granted_at)
        VALUES (?, ?, 0, 0, 0, ?, ?, ?)`).run(key, userId, role, grantedBy, now);
    }
  }

  // The folder-level role this user holds on a given project's folder, or
  // null. Reads the folder from the registry mirror, never from disk.
  folderRoleForProject(projectId, userId) {
    const r = this.stmt(`
      SELECT g.access_role AS role FROM projects p
      JOIN folder_grants g ON g.folder_key = p.folder_key AND g.user_id = ?
      WHERE p.id = ? AND p.folder_key IS NOT NULL AND g.access_role IS NOT NULL
    `).get(userId, String(projectId));
    return r ? r.role : null;
  }

  // Which folders this user has folder-level access to, for the dashboard.
  listFolderAccessFor(userId) {
    return this.stmt(`SELECT folder_key, access_role FROM folder_grants
                      WHERE user_id = ? AND access_role IS NOT NULL`).all(userId);
  }

  /*
    The registry's mirror of which folder a project is filed in. project.json
    stays the source of truth; this is written beside every write of it, and
    re-stated on the startup scan, so a row can never drift unnoticed for
    long. '' (ungrouped) is stored as NULL, so "in no folder" cannot join to
    a grant.
  */
  setProjectFolder(projectId, folderKey) {
    this.stmt('UPDATE projects SET folder_key = ? WHERE id = ?').run(folderKey || null, String(projectId));
  }

  // ---- change requests ----------------------------------------------------

  createChangeRequest({ id, kind, payload, summary, projectId, folderKey, requestedBy, now }) {
    this.stmt(`INSERT INTO change_requests
      (id, kind, status, payload, summary, project_id, folder_key, requested_by, created_at)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`)
      .run(id, kind, JSON.stringify(payload || {}), summary, projectId || null, folderKey || null, requestedBy, now);
    return this.getChangeRequest(id);
  }

  getChangeRequest(id) {
    return this.stmt(`SELECT c.*, u.username, u.full_name FROM change_requests c
                      LEFT JOIN users u ON u.id = c.requested_by
                      WHERE c.id = ?`).get(String(id)) || null;
  }

  // Is the same change already waiting? Asking twice should join the queue
  // once, not stack two applications of the same operation.
  findPendingChange({ kind, projectId, folderKey }) {
    return this.stmt(`SELECT * FROM change_requests
                      WHERE status = 'pending' AND kind = ?
                        AND COALESCE(project_id,'') = COALESCE(?,'')
                        AND COALESCE(folder_key,'') = COALESCE(?,'')`)
      .get(kind, projectId || null, folderKey || null) || null;
  }

  listPendingChanges() {
    return this.stmt(`SELECT c.*, u.username, u.full_name FROM change_requests c
                      LEFT JOIN users u ON u.id = c.requested_by
                      WHERE c.status = 'pending' ORDER BY c.created_at`).all();
  }

  countPendingChanges() {
    return this.stmt("SELECT COUNT(*) AS n FROM change_requests WHERE status = 'pending'").get().n;
  }

  // What this user has asked for: everything still waiting, plus recent
  // decisions so a rejection is seen rather than silently disappearing.
  listChangesFor(userId) {
    return this.stmt(`SELECT * FROM change_requests
                      WHERE requested_by = ?
                        AND (status = 'pending' OR seen_at IS NULL)
                      ORDER BY created_at DESC`).all(userId);
  }

  /*
    Mark decisions as read. Only this person's own, and only ones that have
    been decided — a pending request is not something you can have been told
    about, and marking it read would hide work that has not happened yet.
  */
  markChangesSeen(userId, ids, now) {
    const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).slice(0, 500);
    if (!list.length) return 0;
    const holes = list.map(() => '?').join(',');
    const r = this.db.prepare(`UPDATE change_requests SET seen_at = ?
                               WHERE requested_by = ? AND status != 'pending' AND seen_at IS NULL
                                 AND id IN (${holes})`).run(now, userId, ...list);
    return Number(r.changes);
  }

  // Pending changes against these projects, so a list can mark them.
  listPendingChangeTargets() {
    return this.stmt(`SELECT kind, project_id, folder_key, requested_by FROM change_requests
                      WHERE status = 'pending'`).all();
  }

  // A request that was approved and then could not be carried out. Separate
  // from decideChangeRequest because by then it is no longer pending, and the
  // administrator still needs to see what happened.
  markChangeFailed(id, error) {
    this.stmt("UPDATE change_requests SET status = 'failed', error = ? WHERE id = ?")
      .run(String(error || 'Could not be carried out.'), String(id));
  }

  decideChangeRequest(id, status, decidedBy, now, error) {
    const r = this.stmt(`UPDATE change_requests SET status = ?, decided_by = ?, decided_at = ?, error = ?
                         WHERE id = ? AND status = 'pending'`)
      .run(status, decidedBy, now, error || null, String(id));
    return Number(r.changes) === 1;
  }

  // A pending request per (folder, user) at most — asking twice returns the
  // one already waiting rather than stacking duplicates on the owner.
  createFolderRequest({ id, key, userId, now }) {
    const open = this.stmt(`SELECT * FROM folder_access_requests
                            WHERE folder_key = ? AND user_id = ? AND status = 'pending'`).get(key, userId);
    if (open) return open;
    this.stmt(`INSERT INTO folder_access_requests (id, folder_key, user_id, status, created_at)
               VALUES (?, ?, ?, 'pending', ?)`).run(id, key, userId, now);
    return this.getFolderRequest(id);
  }

  getFolderRequest(id) {
    return this.stmt(`SELECT r.*, u.username, u.full_name FROM folder_access_requests r
                      LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?`).get(String(id)) || null;
  }

  listPendingFolderRequests() {
    return this.stmt(`SELECT r.*, u.username, u.full_name FROM folder_access_requests r
                      LEFT JOIN users u ON u.id = r.user_id
                      WHERE r.status = 'pending' ORDER BY r.created_at`).all();
  }

  decideFolderRequest(id, status, decidedBy, now) {
    const r = this.stmt(`UPDATE folder_access_requests SET status = ?, decided_by = ?, decided_at = ?
                         WHERE id = ? AND status = 'pending'`).run(status, decidedBy, now, String(id));
    return Number(r.changes) === 1;
  }

  // A renamed folder carries its owner, grants and history with it.
  rekeyFolder(fromKey, toKey, toName) {
    this.db.exec('BEGIN');
    try {
      this.stmt('UPDATE folder_owners SET folder_key = ?, name = ? WHERE folder_key = ?').run(toKey, toName, fromKey);
      this.stmt('UPDATE folder_grants SET folder_key = ? WHERE folder_key = ?').run(toKey, fromKey);
      this.stmt('UPDATE folder_access_requests SET folder_key = ? WHERE folder_key = ?').run(toKey, fromKey);
      this.stmt('UPDATE change_requests SET folder_key = ? WHERE folder_key = ?').run(toKey, fromKey);
      this.stmt('UPDATE projects SET folder_key = ? WHERE folder_key = ?').run(toKey, fromKey);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // A deleted folder takes its access rules with it, so a later folder of the
  // same name starts clean instead of inheriting strangers' grants.
  dropFolder(key) {
    this.stmt('DELETE FROM folder_owners WHERE folder_key = ?').run(key);
    this.stmt('DELETE FROM folder_grants WHERE folder_key = ?').run(key);
    this.stmt(`UPDATE folder_access_requests SET status = 'rejected' WHERE folder_key = ? AND status = 'pending'`).run(key);
    this.stmt(`UPDATE change_requests SET status = 'failed', error = 'The folder no longer exists.'
               WHERE folder_key = ? AND status = 'pending' AND project_id IS NULL`).run(key);
  }
  // ---- review comments ----------------------------------------------------

  addReviewComment({ projectId, releaseId, userId, kind, body, dmFile, anchor, now }) {
    const r = this.stmt(`INSERT INTO review_comments (project_id, release_id, user_id, kind, body, dm_file, anchor, created_at)
                         VALUES (?,?,?,?,?,?,?,?)`).run(projectId, releaseId || null, userId, kind || 'comment', body, dmFile || null, anchor || null, now);
    return Number(r.lastInsertRowid);
  }

  listReviewComments(projectId) {
    return this.stmt(`SELECT c.*, u.username AS username, u.full_name AS full_name, u.role AS user_role,
                             ru.username AS resolved_by_username
                      FROM review_comments c
                      LEFT JOIN users u ON u.id = c.user_id
                      LEFT JOIN users ru ON ru.id = c.resolved_by
                      WHERE c.project_id = ? ORDER BY c.id`).all(projectId);
  }

  getReviewComment(id) {
    return this.stmt('SELECT * FROM review_comments WHERE id = ?').get(Number(id)) || null;
  }

  setReviewCommentResolved(id, userId, now) {
    const r = userId
      ? this.stmt('UPDATE review_comments SET resolved_at = ?, resolved_by = ? WHERE id = ?').run(now, userId, Number(id))
      : this.stmt('UPDATE review_comments SET resolved_at = NULL, resolved_by = NULL WHERE id = ?').run(Number(id));
    return Number(r.changes) === 1;
  }

  // ---- administrator reference data / platform settings -------------------

  configList(collection) {
    return this.stmt('SELECT id, data, created_at, updated_at FROM config_items WHERE collection = ? ORDER BY created_at, id')
      .all(String(collection)).map((r) => ({ ...JSON.parse(r.data), id: r.id, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  configGet(collection, id) {
    const r = this.stmt('SELECT id, data, created_at, updated_at FROM config_items WHERE collection = ? AND id = ?').get(String(collection), String(id));
    return r ? { ...JSON.parse(r.data), id: r.id, createdAt: r.created_at, updatedAt: r.updated_at } : null;
  }

  configCount(collection) {
    return this.stmt('SELECT COUNT(*) AS n FROM config_items WHERE collection = ?').get(String(collection)).n;
  }

  configPut(collection, id, data, now) {
    const { id: _drop, createdAt: _c, updatedAt: _u, ...rest } = data;
    this.stmt(`INSERT INTO config_items (collection, id, data, created_at, updated_at) VALUES (?,?,?,?,?)
               ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      .run(String(collection), String(id), JSON.stringify(rest), now, now);
  }

  configDelete(collection, id) {
    return Number(this.stmt('DELETE FROM config_items WHERE collection = ? AND id = ?').run(String(collection), String(id)).changes) === 1;
  }

  // ---- shared CIR ---------------------------------------------------------

  cirList() {
    return this.stmt(`SELECT m.*, u.username AS added_by_username, u.full_name AS added_by_name
                      FROM cir_modules m LEFT JOIN users u ON u.id = m.added_by ORDER BY m.file`).all();
  }

  cirGet(id) {
    return this.stmt('SELECT * FROM cir_modules WHERE id = ?').get(String(id)) || null;
  }

  cirByFile(file) {
    return this.stmt('SELECT * FROM cir_modules WHERE file = ?').get(String(file)) || null;
  }

  cirUpsert({ id, file, title, infoName, dmc, infoCode, kind, note, addedBy, now }) {
    this.stmt(`INSERT INTO cir_modules (id, file, title, info_name, dmc, info_code, kind, note, added_by, added_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(file) DO UPDATE SET title = excluded.title, info_name = excluded.info_name, dmc = excluded.dmc,
                 info_code = excluded.info_code, kind = excluded.kind, note = excluded.note, added_by = excluded.added_by, added_at = excluded.added_at`)
      .run(id, file, title || null, infoName || null, dmc || null, infoCode || null, kind || null, note || null, addedBy || null, now);
  }

  cirDelete(id) {
    return Number(this.stmt('DELETE FROM cir_modules WHERE id = ?').run(String(id)).changes) === 1;
  }
}

module.exports = { AuthStore, MIGRATIONS };
