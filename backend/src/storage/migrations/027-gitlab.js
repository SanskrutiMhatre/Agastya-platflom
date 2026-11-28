'use strict';
// Migration 027-gitlab (Phase 3, decision P3-5: the intranet GitLab integration). One body per database engine (WP-10); additive only.
// Number: 027 was the next free number when this was written (after WP-14's 026-jobs). Other Phase 3 areas add migrations in parallel;
// if one of them also took 027, the lead renumbers this file at merge (its content does not depend on any other migration's tables).

const step = {
    /*
      027 - GitLab.
      gitlab_settings        one row: the administrator's configuration (address, CA, OAuth application id, timeouts; JSON) and the
                             secrets (OAuth application secret, service token) encrypted with the secrets key (services/secretBox.ts).
                             `verified_at` is the last successful connection test: the feature is visible only while it is set.
      gitlab_accounts        one row per Agastya user who connected their own GitLab account (OAuth or personal access token); the tokens
                             encrypted. Revoked by the user (disconnect) or an administrator.
      gitlab_oauth_states    a pending OAuth authorization (state -> user, PKCE verifier encrypted, where to return), ten minutes.
      gitlab_links           an Agastya project linked to a GitLab project: which one, which branch, and the commit it was last in step with.
      gitlab_sync_files      per linked project: the git blob id of every tracked file at that commit (the base of the three-way pull).
      gitlab_releases        what was uploaded as a GitLab release (tag, assets, metadata).
      gitlab_merge_requests  reviews started as merge requests: the MR, its last known state and approvals, and the GitLab notes already
                             brought in as review comments (so a sync never adds one twice).
    */
    name: '027-gitlab',
    sql: `CREATE TABLE IF NOT EXISTS gitlab_settings (
            id                INTEGER PRIMARY KEY CHECK (id = 1),
            config            TEXT NOT NULL,
            secrets           TEXT,
            verified_at       TEXT,
            verified_version  TEXT,
            updated_at        TEXT NOT NULL,
            updated_by        TEXT
          );
          CREATE TABLE IF NOT EXISTS gitlab_accounts (
            user_id          TEXT PRIMARY KEY,
            method           TEXT NOT NULL,
            gitlab_user_id   INTEGER,
            gitlab_username  TEXT,
            gitlab_name      TEXT,
            gitlab_email     TEXT,
            token            TEXT NOT NULL,
            refresh_token    TEXT,
            expires_at       TEXT,
            scopes           TEXT,
            connected_at     TEXT NOT NULL,
            refreshed_at     TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_gitlab_accounts_gl ON gitlab_accounts(gitlab_user_id);
          CREATE TABLE IF NOT EXISTS gitlab_oauth_states (
            state       TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL,
            verifier    TEXT NOT NULL,
            return_to   TEXT,
            created_at  TEXT NOT NULL,
            expires_at  TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS gitlab_links (
            project_id           TEXT PRIMARY KEY,
            gitlab_project_id    INTEGER NOT NULL,
            path_with_namespace  TEXT NOT NULL,
            web_url              TEXT,
            branch               TEXT NOT NULL,
            base_commit          TEXT,
            options              TEXT,
            linked_by            TEXT,
            linked_at            TEXT NOT NULL,
            last_push_at         TEXT,
            last_pull_at         TEXT
          );
          CREATE TABLE IF NOT EXISTS gitlab_sync_files (
            project_id  TEXT NOT NULL,
            path        TEXT NOT NULL,
            blob_sha    TEXT NOT NULL,
            PRIMARY KEY (project_id, path)
          );
          CREATE TABLE IF NOT EXISTS gitlab_releases (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            tag         TEXT NOT NULL,
            name        TEXT,
            kind        TEXT NOT NULL,
            web_url     TEXT,
            assets      TEXT,
            metadata    TEXT,
            created_at  TEXT NOT NULL,
            created_by  TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_gitlab_releases_project ON gitlab_releases(project_id, created_at);
          CREATE TABLE IF NOT EXISTS gitlab_merge_requests (
            project_id      TEXT NOT NULL,
            iid             INTEGER NOT NULL,
            source_branch   TEXT NOT NULL,
            target_branch   TEXT NOT NULL,
            title           TEXT,
            web_url         TEXT,
            state           TEXT,
            release_id      TEXT,
            created_by      TEXT,
            created_at      TEXT NOT NULL,
            synced_at       TEXT,
            approvals       TEXT,
            imported_notes  TEXT,
            PRIMARY KEY (project_id, iid)
          );`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
