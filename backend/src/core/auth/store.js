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

// WP-10 (PRD-002): the migrations live in storage/migrations/, one engine-neutral file per step; this store runs the SQLite bodies.
const MIGRATIONS = require('../../storage/migrations').forDialect('sqlite');
const auditChain = require('./auditChain');
const STMT_CACHE_MAX = 500;

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
    this._txDepth = 0;
    this.auditKey = null;
  }

  stmt(sql) {
    let s = this._stmts.get(sql);
    if (!s) {
      // WP-10 (PLT-031): bounded. Statements built from changing text (a SET list, an IN list) would otherwise grow the cache for ever.
      if (this._stmts.size >= STMT_CACHE_MAX) this._stmts.clear();
      s = this.db.prepare(sql); this._stmts.set(sql, s);
    }
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
        if (m.postSql) this.db.exec(m.postSql);   // WP-29: after the columns, so a step can index a column it adds
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
    // WP-29: re-entrant. A critical action (context.auditedTx) runs the change and its audit row in one transaction, and the change may
    // itself use tx(): the inner one is a savepoint, so a failure inside still undoes only what it wrote and the outer decides the rest.
    if (this._txDepth > 0 || this.db.isTransaction === true) {
      const sp = `sp_${this._txDepth}`;
      this._txDepth++;
      this.db.exec(`SAVEPOINT ${sp}`);
      try { const out = fn(); this.db.exec(`RELEASE ${sp}`); return out; }
      catch (e) { this.db.exec(`ROLLBACK TO ${sp}`); this.db.exec(`RELEASE ${sp}`); throw e; }
      finally { this._txDepth--; }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this._txDepth = 1;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    } finally {
      this._txDepth = 0;
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
    const allowed = ['full_name', 'role', 'password_hash', 'must_change_password', 'onboarding_pending', 'username_locked', 'disabled_at', 'active_project_id', 'username',
      // WP-27 (migration 024): directory link, why an account is disabled, the read-only auditor flag
      'auth_source', 'external_id', 'directory_dn', 'directory_checked_at', 'disabled_reason', 'auditor'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return this.getUser(id);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    this.stmt(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...keys.map((k) => fields[k]), now, id);
    if (keys.includes('disabled_at') || keys.includes('role') || keys.includes('auditor')) this.emitAccessChanged(id);
    return this.getUser(id);
  }

  /** WP-27: the accounts that sign in against the directory (the sync job checks each of them). */
  listDirectoryUsers() {
    return this.stmt("SELECT * FROM users WHERE auth_source = 'directory' ORDER BY username").all();
  }

  /** WP-27: the account a directory entry was provisioned as (by its stable id), or null. */
  findUserByExternalId(externalId) {
    if (!externalId) return null;
    return this.stmt("SELECT * FROM users WHERE auth_source = 'directory' AND external_id = ?").get(String(externalId)) || null;
  }

  /*
    Access-change notices (WP-03, SEC-010 / PLT-017): a session ended, an account was disabled or changed role, a
    membership changed. The WebSocket broadcaster listens and closes or re-authorises the affected connections at once,
    instead of letting a revoked browser keep receiving project messages. `userId` null means "anyone may be affected".
  */
  onAccessChanged(fn) { (this._accessListeners || (this._accessListeners = new Set())).add(fn); return () => this._accessListeners.delete(fn); }
  emitAccessChanged(userId) {
    for (const fn of this._accessListeners || []) { try { fn(userId ?? null); } catch { /* a listener never breaks the write */ } }
  }

  // ---- sessions -----------------------------------------------------------

  /*
    SINGLE ACTIVE SESSION, done atomically and in the safe order: the new
    session row is persisted FIRST, then every other live session for the
    account is revoked, all inside one transaction. A crash between the two
    statements can therefore never leave the account with zero valid
    sessions after a successful login.
  */
  insertSessionDisplacing(args) {
    const out = this._insertSessionDisplacing(args);
    if (out.displaced) this.emitAccessChanged(args.userId);
    return out;
  }

  _insertSessionDisplacing({ id, userId, tokenHash, now, expiresAt, ip, userAgent, displace = true }) {
    return this.tx(() => {
      this.stmt(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, ip, user_agent)
                 VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, userId, tokenHash, now, expiresAt, now, ip || null, userAgent || null);
      if (!displace) return { displaced: 0 };   // the security policy allows several sessions per account (WP-03)
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

  /* Why a token no longer signs anyone in (WP-03, UX-022): 'displaced', 'idle', 'expired', 'signout', ... or null when unknown. */
  sessionEndReason(tokenHash, nowIso) {
    const r = this.stmt(`SELECT s.revoked_at, s.revoke_reason, s.expires_at, u.disabled_at
                         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(tokenHash);
    if (!r) return null;
    if (r.disabled_at) return 'disabled';
    if (r.revoked_at) return r.revoke_reason || 'revoked';
    if (r.expires_at <= nowIso) return 'expired';
    return null;
  }

  /* Is this session still live (WebSocket re-check after a revoke, PLT-017)? */
  sessionIsLive(sessionId, nowIso) {
    return !!this.stmt(`SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
                        WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled_at IS NULL`).get(sessionId, nowIso);
  }

  /* Does the user own or manage at least one project (they may look people up to add them, SEC-004)? */
  managesAnyProject(userId) {
    return !!this.stmt("SELECT 1 FROM project_members WHERE user_id = ? AND role IN ('owner','manager') LIMIT 1").get(userId);
  }

  // ---- sign-in throttle (020) ---------------------------------------------

  throttleGet(key) {
    const r = this.stmt('SELECT attempts FROM login_throttle WHERE key = ?').get(key);
    if (!r) return [];
    try { const a = JSON.parse(r.attempts); return Array.isArray(a) ? a.filter((x) => typeof x === 'number') : []; } catch { return []; }
  }

  throttlePut(key, attempts, now) {
    if (!attempts.length) { this.stmt('DELETE FROM login_throttle WHERE key = ?').run(key); return; }
    this.stmt(`INSERT INTO login_throttle (key, attempts, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET attempts = excluded.attempts, updated_at = excluded.updated_at`).run(key, JSON.stringify(attempts), now);
  }

  throttlePrune(olderThanIso) {
    this.stmt('DELETE FROM login_throttle WHERE updated_at < ?').run(olderThanIso);
  }

  revokeSessionById(sessionId, reason, now) {
    const r = this.stmt('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL')
      .run(now, reason, sessionId);
    if (Number(r.changes)) this.emitAccessChanged(null);
    return Number(r.changes);
  }

  revokeAllSessionsForUser(userId, reason, now, exceptSessionId = null) {
    const r = exceptSessionId
      ? this.stmt('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL')
        .run(now, reason, userId, exceptSessionId)
      : this.stmt('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(now, reason, userId);
    if (Number(r.changes)) this.emitAccessChanged(userId);
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

  /**
   * WP-29 (ENT-003): the key of the audit chain (core/auth/auditChain.js), set by the application context and the offline tools.
   * Without it rows are written as before (seq NULL) - only a store built by hand in a test does that.
   */
  setAuditKey(k) { this.auditKey = k || null; }

  appendAudit({ at, actorId, actorUsername, ip, action, targetType, targetId, projectId, meta }) {
    const row = {
      at, actor_id: actorId || null, actor_username: actorUsername || null, ip: ip || null, action,
      target_type: targetType || null, target_id: targetId || null, project_id: projectId || null,
      meta: meta ? JSON.stringify(meta) : null,
    };
    if (!this.auditKey) {
      this.stmt(`INSERT INTO audit_log (at, actor_id, actor_username, ip, action, target_type, target_id, project_id, meta)
                 VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(row.at, row.actor_id, row.actor_username, row.ip, row.action, row.target_type, row.target_id, row.project_id, row.meta);
      return null;
    }
    // Reading the head and writing the next row is one write transaction (another process - a console tool - cannot fork the chain;
    // the unique index on seq would refuse it anyway). Inside a caller's transaction (a critical action) a savepoint does the same.
    const nested = this.db.isTransaction === undefined ? true : !!this.db.isTransaction;
    this.db.exec(nested ? 'SAVEPOINT audit_append' : 'BEGIN IMMEDIATE');
    try {
      const head = this.auditChainHead();
      row.seq = head.seq + 1; row.prev_hash = head.hash; row.chain_key = this.auditKey.id;
      row.row_hash = auditChain.rowHash(this.auditKey.key, row);
      this.stmt(`INSERT INTO audit_log (at, actor_id, actor_username, ip, action, target_type, target_id, project_id, meta, seq, prev_hash, row_hash, chain_key)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(row.at, row.actor_id, row.actor_username, row.ip, row.action, row.target_type, row.target_id, row.project_id, row.meta,
          row.seq, row.prev_hash, row.row_hash, row.chain_key);
      this.db.exec(nested ? 'RELEASE audit_append' : 'COMMIT');
    } catch (e) {
      if (nested) { this.db.exec('ROLLBACK TO audit_append'); this.db.exec('RELEASE audit_append'); } else this.db.exec('ROLLBACK');
      throw e;
    }
    return { seq: row.seq, hash: row.row_hash };
  }

  /** The last chained row ({seq, hash}); the retention anchor when every chained row was archived; {0, GENESIS} for a new chain. */
  auditChainHead() {
    const last = this.stmt('SELECT seq, row_hash FROM audit_log WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 1').get();
    if (last) return { seq: Number(last.seq), hash: String(last.row_hash) };
    const anchor = this.stmt('SELECT seq, row_hash FROM audit_chain_anchor WHERE id = 1').get();
    if (anchor) return { seq: Number(anchor.seq), hash: String(anchor.row_hash) };
    return { seq: 0, hash: auditChain.GENESIS };
  }

  /**
   * The audit viewer and the export (WP-29): newest first, optional filters. `action` is a prefix; `actor` the username (exact,
   * case-insensitive); `project` the project id; `from`/`to` ISO times (from inclusive, to exclusive); `before` an id for paging.
   */
  listAudit({ limit = 200, before = null, action = null, actor = null, project = null, from = null, to = null } = {}) {
    const where = []; const args = [];
    if (before) { where.push('id < ?'); args.push(Number(before)); }
    if (action) { where.push("action LIKE ? ESCAPE '\\'"); args.push(String(action).replace(/[%_\\]/g, '\\$&') + '%'); }
    if (actor) { where.push('actor_username = ? COLLATE NOCASE'); args.push(String(actor)); }
    if (project) { where.push('project_id = ?'); args.push(String(project)); }
    if (from) { where.push('at >= ?'); args.push(String(from)); }
    if (to) { where.push('at <= ?'); args.push(String(to)); }
    const sql = `SELECT * FROM audit_log${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
    return this.stmt(sql).all(...args, Number(limit));
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
    this.emitAccessChanged(userId);
  }

  removeMember(projectId, userId) {
    const r = this.stmt('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId);
    if (Number(r.changes)) this.emitAccessChanged(userId);
    return Number(r.changes);
  }

  countOwners(projectId) {
    return this.stmt("SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'owner'").get(projectId).n;
  }

  // Called when a project disappears from disk or is deleted: memberships and
  // invitations point at nothing and are cleared. Revisions and audit rows
  // are history and stay.
  // ---- project lifecycle (WP-06) -------------------------------------------

  /** PLT-003: the folder was not there at a start. Marked, never deleted. */
  markProjectMissing(projectId, now) { this.stmt('INSERT OR IGNORE INTO project_missing (project_id, since) VALUES (?, ?)').run(projectId, now); }
  clearProjectMissing(projectId) { this.stmt('DELETE FROM project_missing WHERE project_id = ?').run(projectId); }
  listMissingProjects() { return this.stmt('SELECT project_id AS projectId, since FROM project_missing ORDER BY since').all(); }
  projectMissingSince(projectId) { const r = this.stmt('SELECT since FROM project_missing WHERE project_id = ?').get(projectId); return r ? r.since : null; }

  /**
   * PLT-004: whether an id was ever used by a project: a registered or deleted project, or rows left from one (documents, releases,
   * members, review comments). A new project never takes such an id, so nothing of an earlier project can reappear under it.
   */
  projectIdUsed(id) {
    return !!(this.stmt('SELECT 1 FROM projects WHERE id = ?').get(id)
      || this.stmt('SELECT 1 FROM project_tombstones WHERE id = ?').get(id)
      || this.stmt('SELECT 1 FROM documents WHERE project_id = ? LIMIT 1').get(id)
      || this.stmt('SELECT 1 FROM releases WHERE project_id = ? LIMIT 1').get(id)
      || this.stmt('SELECT 1 FROM project_members WHERE project_id = ? LIMIT 1').get(id)
      || this.stmt('SELECT 1 FROM review_comments WHERE project_id = ? LIMIT 1').get(id));
  }

  /**
   * PLT-004: a deleted project's content goes with it, in one transaction: documents with their revisions, state, locks and comments,
   * releases, review comments, lifecycle and CIR links, extensions, project notifications. The audit log stays (it is the record of what
   * happened); the id is tombstoned. Blobs are content-addressed and shared, so they are left for a later clean-up.
   */
  purgeProjectContent(projectId, { name = null, by = null, now }) {
    return this.tx(() => {
      const docs = 'SELECT id FROM documents WHERE project_id = ?';
      const n = (sql) => Number(this.db.prepare(sql).run(projectId).changes || 0);
      const out = {
        revisions: n(`DELETE FROM revisions WHERE document_id IN (${docs})`),
        docState: n(`DELETE FROM doc_state WHERE document_id IN (${docs})`),
        docComments: n(`DELETE FROM doc_comments WHERE document_id IN (${docs})`),
        releases: n('DELETE FROM releases WHERE project_id = ?'),
        documents: n('DELETE FROM documents WHERE project_id = ?'),
        reviewComments: n('DELETE FROM review_comments WHERE project_id = ?'),
        lifecycle: n('DELETE FROM lifecycle_events WHERE project_id = ?'),
        cirLinks: n('DELETE FROM cir_links WHERE project_id = ?'),
        extensions: n('DELETE FROM project_ext WHERE project_id = ?'),
        notifications: n('DELETE FROM notifications WHERE project_id = ?'),
      };
      this.stmt('DELETE FROM project_missing WHERE project_id = ?').run(projectId);
      this.stmt('INSERT OR REPLACE INTO project_tombstones (id, name, deleted_at, deleted_by) VALUES (?, ?, ?, ?)').run(projectId, name, now, by);
      return out;
    });
  }

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

  // The fingerprint of what was issued, recorded when a release is carried out (formerly an inline UPDATE in routes/project-content.ts; WP-10).
  setReleaseContentHash(id, contentHash) {
    this.stmt('UPDATE releases SET content_hash = ? WHERE id = ?').run(contentHash, id);
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
    return this.stmt(`SELECT m.*, u.username AS added_by_username, u.full_name AS added_by_name, v.username AS updated_by_username, v.full_name AS updated_by_name
                      FROM cir_modules m LEFT JOIN users u ON u.id = m.added_by LEFT JOIN users v ON v.id = m.updated_by ORDER BY m.file`).all();
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

  // WP-11 (SEC-017): who last replaced a module; the first uploader (added_by) is kept.
  cirTouch(file, userId, now) {
    return Number(this.stmt('UPDATE cir_modules SET updated_by = ?, updated_at = ? WHERE file = ?').run(userId || null, now, String(file)).changes) === 1;
  }

  cirDelete(id) {
    return Number(this.stmt('DELETE FROM cir_modules WHERE id = ?').run(String(id)).changes) === 1;
  }
}

module.exports = { AuthStore, MIGRATIONS };
