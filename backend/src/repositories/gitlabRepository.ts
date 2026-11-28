// =============================================================================
// GitLab integration records (Phase 3, P3-5; migration 028-gitlab). Behind an interface like every repository (WP-10, PRD-002).
// Secrets arrive here already sealed (services/secretBox.ts); this file never sees a plain token.
// =============================================================================

import { SqliteRepository } from './sqliteBase';

export interface GitlabSettingsRow { config: string; secrets: string | null; verified_at: string | null; verified_version: string | null; updated_at: string; updated_by: string | null }
export interface GitlabAccountRow {
  user_id: string; method: 'oauth' | 'pat'; gitlab_user_id: number | null; gitlab_username: string | null; gitlab_name: string | null; gitlab_email: string | null;
  token: string; refresh_token: string | null; expires_at: string | null; scopes: string | null; connected_at: string; refreshed_at: string | null;
}
export interface GitlabOauthStateRow { state: string; user_id: string; verifier: string; return_to: string | null; created_at: string; expires_at: string }
export interface GitlabLinkRow {
  project_id: string; gitlab_project_id: number; path_with_namespace: string; web_url: string | null; branch: string; base_commit: string | null;
  options: string | null; linked_by: string | null; linked_at: string; last_push_at: string | null; last_pull_at: string | null;
}
export interface GitlabReleaseRow { id: string; project_id: string; tag: string; name: string | null; kind: string; web_url: string | null; assets: string | null; metadata: string | null; created_at: string; created_by: string | null }
export interface GitlabMrRow {
  project_id: string; iid: number; source_branch: string; target_branch: string; title: string | null; web_url: string | null; state: string | null;
  release_id: string | null; created_by: string | null; created_at: string; synced_at: string | null; approvals: string | null; imported_notes: string | null;
}

export interface GitlabRepository {
  getSettings(): GitlabSettingsRow | null;
  putSettings(r: GitlabSettingsRow): void;
  deleteSettings(): void;

  getAccount(userId: string): GitlabAccountRow | null;
  listAccounts(): GitlabAccountRow[];
  /** The Agastya user connected to this GitLab user id, if any. */
  accountByGitlabUser(gitlabUserId: number): GitlabAccountRow | null;
  putAccount(r: GitlabAccountRow): void;
  updateTokens(userId: string, t: { token: string; refreshToken: string | null; expiresAt: string | null; refreshedAt: string }): void;
  deleteAccount(userId: string): boolean;
  deleteAllAccounts(): number;

  putOauthState(r: GitlabOauthStateRow): void;
  /** Take (read and delete) a pending state: one use only. */
  takeOauthState(state: string): GitlabOauthStateRow | null;
  purgeOauthStates(now: string): void;

  getLink(projectId: string): GitlabLinkRow | null;
  putLink(r: GitlabLinkRow): void;
  setLinkSync(projectId: string, s: { branch: string; baseCommit: string | null; at: string; kind: 'push' | 'pull' | 'branch' }): void;
  setLinkOptions(projectId: string, options: string): void;
  deleteLink(projectId: string): void;

  syncFiles(projectId: string): Map<string, string>;
  /** Replace the whole base of a project in one transaction. */
  replaceSyncFiles(projectId: string, files: Map<string, string>): void;

  addRelease(r: GitlabReleaseRow): void;
  listReleases(projectId: string): GitlabReleaseRow[];

  putMr(r: GitlabMrRow): void;
  getMr(projectId: string, iid: number): GitlabMrRow | null;
  listMrs(projectId: string): GitlabMrRow[];
  updateMr(projectId: string, iid: number, f: { state: string | null; approvals: string | null; importedNotes: string | null; syncedAt: string; webUrl?: string | null }): void;
}

export class SqliteGitlabRepository extends SqliteRepository implements GitlabRepository {
  getSettings(): GitlabSettingsRow | null { return (this.q('SELECT * FROM gitlab_settings WHERE id = 1').get() as GitlabSettingsRow | undefined) ?? null; }
  putSettings(r: GitlabSettingsRow): void {
    this.q(`INSERT INTO gitlab_settings (id, config, secrets, verified_at, verified_version, updated_at, updated_by) VALUES (1,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET config = excluded.config, secrets = excluded.secrets, verified_at = excluded.verified_at,
              verified_version = excluded.verified_version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .run(r.config, r.secrets, r.verified_at, r.verified_version, r.updated_at, r.updated_by);
  }
  deleteSettings(): void { this.q('DELETE FROM gitlab_settings WHERE id = 1').run(); }

  getAccount(userId: string): GitlabAccountRow | null { return (this.q('SELECT * FROM gitlab_accounts WHERE user_id = ?').get(userId) as GitlabAccountRow | undefined) ?? null; }
  listAccounts(): GitlabAccountRow[] { return this.q('SELECT * FROM gitlab_accounts ORDER BY connected_at').all() as unknown as GitlabAccountRow[]; }
  accountByGitlabUser(id: number): GitlabAccountRow | null { return (this.q('SELECT * FROM gitlab_accounts WHERE gitlab_user_id = ? LIMIT 1').get(id) as GitlabAccountRow | undefined) ?? null; }
  putAccount(r: GitlabAccountRow): void {
    this.q(`INSERT INTO gitlab_accounts (user_id, method, gitlab_user_id, gitlab_username, gitlab_name, gitlab_email, token, refresh_token, expires_at, scopes, connected_at, refreshed_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET method = excluded.method, gitlab_user_id = excluded.gitlab_user_id, gitlab_username = excluded.gitlab_username,
              gitlab_name = excluded.gitlab_name, gitlab_email = excluded.gitlab_email, token = excluded.token, refresh_token = excluded.refresh_token,
              expires_at = excluded.expires_at, scopes = excluded.scopes, connected_at = excluded.connected_at, refreshed_at = excluded.refreshed_at`)
      .run(r.user_id, r.method, r.gitlab_user_id, r.gitlab_username, r.gitlab_name, r.gitlab_email, r.token, r.refresh_token, r.expires_at, r.scopes, r.connected_at, r.refreshed_at);
  }
  updateTokens(userId: string, t: { token: string; refreshToken: string | null; expiresAt: string | null; refreshedAt: string }): void {
    this.q('UPDATE gitlab_accounts SET token = ?, refresh_token = ?, expires_at = ?, refreshed_at = ? WHERE user_id = ?').run(t.token, t.refreshToken, t.expiresAt, t.refreshedAt, userId);
  }
  deleteAccount(userId: string): boolean { return Number(this.q('DELETE FROM gitlab_accounts WHERE user_id = ?').run(userId).changes) === 1; }
  deleteAllAccounts(): number { return Number(this.q('DELETE FROM gitlab_accounts').run().changes); }

  putOauthState(r: GitlabOauthStateRow): void {
    this.q('INSERT INTO gitlab_oauth_states (state, user_id, verifier, return_to, created_at, expires_at) VALUES (?,?,?,?,?,?)')
      .run(r.state, r.user_id, r.verifier, r.return_to, r.created_at, r.expires_at);
  }
  takeOauthState(state: string): GitlabOauthStateRow | null {
    const row = (this.q('SELECT * FROM gitlab_oauth_states WHERE state = ?').get(state) as GitlabOauthStateRow | undefined) ?? null;
    if (row) this.q('DELETE FROM gitlab_oauth_states WHERE state = ?').run(state);
    return row;
  }
  purgeOauthStates(now: string): void { this.q('DELETE FROM gitlab_oauth_states WHERE expires_at <= ?').run(now); }

  getLink(projectId: string): GitlabLinkRow | null { return (this.q('SELECT * FROM gitlab_links WHERE project_id = ?').get(projectId) as GitlabLinkRow | undefined) ?? null; }
  putLink(r: GitlabLinkRow): void {
    this.q(`INSERT INTO gitlab_links (project_id, gitlab_project_id, path_with_namespace, web_url, branch, base_commit, options, linked_by, linked_at, last_push_at, last_pull_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(project_id) DO UPDATE SET gitlab_project_id = excluded.gitlab_project_id, path_with_namespace = excluded.path_with_namespace,
              web_url = excluded.web_url, branch = excluded.branch, base_commit = excluded.base_commit, options = excluded.options,
              linked_by = excluded.linked_by, linked_at = excluded.linked_at, last_push_at = excluded.last_push_at, last_pull_at = excluded.last_pull_at`)
      .run(r.project_id, r.gitlab_project_id, r.path_with_namespace, r.web_url, r.branch, r.base_commit, r.options, r.linked_by, r.linked_at, r.last_push_at, r.last_pull_at);
  }
  setLinkSync(projectId: string, s: { branch: string; baseCommit: string | null; at: string; kind: 'push' | 'pull' | 'branch' }): void {
    if (s.kind === 'push') this.q('UPDATE gitlab_links SET branch = ?, base_commit = ?, last_push_at = ? WHERE project_id = ?').run(s.branch, s.baseCommit, s.at, projectId);
    else if (s.kind === 'pull') this.q('UPDATE gitlab_links SET branch = ?, base_commit = ?, last_pull_at = ? WHERE project_id = ?').run(s.branch, s.baseCommit, s.at, projectId);
    else this.q('UPDATE gitlab_links SET branch = ?, base_commit = ? WHERE project_id = ?').run(s.branch, s.baseCommit, projectId);
  }
  setLinkOptions(projectId: string, options: string): void { this.q('UPDATE gitlab_links SET options = ? WHERE project_id = ?').run(options, projectId); }
  deleteLink(projectId: string): void {
    this.q('DELETE FROM gitlab_links WHERE project_id = ?').run(projectId);
    this.q('DELETE FROM gitlab_sync_files WHERE project_id = ?').run(projectId);
  }

  syncFiles(projectId: string): Map<string, string> {
    const rows = this.q('SELECT path, blob_sha FROM gitlab_sync_files WHERE project_id = ?').all(projectId) as Array<{ path: string; blob_sha: string }>;
    return new Map(rows.map((r) => [String(r.path), String(r.blob_sha)]));
  }
  replaceSyncFiles(projectId: string, files: Map<string, string>): void {
    this.db.exec('SAVEPOINT gitlab_sync');
    try {
      this.q('DELETE FROM gitlab_sync_files WHERE project_id = ?').run(projectId);
      const ins = this.q('INSERT INTO gitlab_sync_files (project_id, path, blob_sha) VALUES (?,?,?)');
      for (const [p, sha] of files) ins.run(projectId, p, sha);
      this.db.exec('RELEASE gitlab_sync');
    } catch (e) { this.db.exec('ROLLBACK TO gitlab_sync'); this.db.exec('RELEASE gitlab_sync'); throw e; }
  }

  addRelease(r: GitlabReleaseRow): void {
    this.q('INSERT INTO gitlab_releases (id, project_id, tag, name, kind, web_url, assets, metadata, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(r.id, r.project_id, r.tag, r.name, r.kind, r.web_url, r.assets, r.metadata, r.created_at, r.created_by);
  }
  listReleases(projectId: string): GitlabReleaseRow[] { return this.q('SELECT * FROM gitlab_releases WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as unknown as GitlabReleaseRow[]; }

  putMr(r: GitlabMrRow): void {
    this.q(`INSERT INTO gitlab_merge_requests (project_id, iid, source_branch, target_branch, title, web_url, state, release_id, created_by, created_at, synced_at, approvals, imported_notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(r.project_id, r.iid, r.source_branch, r.target_branch, r.title, r.web_url, r.state, r.release_id, r.created_by, r.created_at, r.synced_at, r.approvals, r.imported_notes);
  }
  getMr(projectId: string, iid: number): GitlabMrRow | null { return (this.q('SELECT * FROM gitlab_merge_requests WHERE project_id = ? AND iid = ?').get(projectId, iid) as GitlabMrRow | undefined) ?? null; }
  listMrs(projectId: string): GitlabMrRow[] { return this.q('SELECT * FROM gitlab_merge_requests WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as unknown as GitlabMrRow[]; }
  updateMr(projectId: string, iid: number, f: { state: string | null; approvals: string | null; importedNotes: string | null; syncedAt: string; webUrl?: string | null }): void {
    this.q('UPDATE gitlab_merge_requests SET state = ?, approvals = ?, imported_notes = ?, synced_at = ?, web_url = COALESCE(?, web_url) WHERE project_id = ? AND iid = ?')
      .run(f.state, f.approvals, f.importedNotes, f.syncedAt, f.webUrl ?? null, projectId, iid);
  }
}
