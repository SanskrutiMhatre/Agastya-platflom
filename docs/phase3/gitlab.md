# Phase 3, P3-5: intranet GitLab integration

Decision P3-5 (docs/phase3/DECISIONS.md): an offline, self-managed GitLab on the intranet (internal CA, no internet), configured by the
administrator and hidden from everyone else until the connection test passed. People connect their own accounts. Three uses: project
repositories with push and pull, PDF and release storage, merge requests for review and approval.

## Architecture

```
browser ──(session cookie)──> Agastya routes/gitlab.ts ──> services/gitlab/* ──(https, uploaded CA, SSRF guard)──> GitLab REST API v4 + OAuth
                                       │                         │
                                       │                         ├─ settings.ts   configuration, connection test, feature gate
                                       │                         ├─ accounts.ts   OAuth code + PKCE, personal access tokens, refresh, revoke
                                       │                         ├─ repo.ts       link, push, pull (three-way), branches, history
                                       │                         ├─ review.ts     release upload, merge requests, approvals, notes
                                       │                         ├─ merge3.ts     line-based three-way merge (Myers diff)
                                       │                         └─ http.ts       the only HTTP client: URL guard, TLS, timeouts, retries, error mapping
                                       └─ repositories/gitlabRepository.ts  (all SQL; migration 030-gitlab)
```

* **REST API only, no git binary.** Push = Commits API with multi-file actions (create/update/delete, base64 for binary). Pull = Tree API
  (recursive, paged) + Blobs API, compare via the Commits list. Nothing is cloned; nothing is written outside the project's own files.
* **Feature gate.** `gitlab_settings.verified_at` is set only by a Save whose connection test passed. Until then every non-admin GitLab route
  answers `404 {code: FEATURE_OFF}` (after the normal guard, so a non-member still gets the uniform 404), `/api/gitlab/me` included; the rail
  has no Repository page, the account page no GitLab card, the Review page no merge-request card.
* **Secrets.** Application secret, service token, user access/refresh tokens and the PKCE verifier are sealed with AES-256-GCM
  (`services/secretBox.ts`, `v1:<keyId>:<iv>:<tag>:<ct>`). The key is a file: `AGASTYA_SECRETS_KEY_FILE`, default `<workspace>/keys/secrets.key`
  (created on first use, outside the database). No route returns a secret or token; the admin form only says "Saved".
* **SSRF.** `http.ts urlFor()` builds every URL from the configured base URL plus a path that must start with `/api/v4/` or `/oauth/`, refuses
  dot segments (also encoded), `\`, `//`, `@`, query/fragment characters in the path, and checks origin + path prefix of the result. Redirects are
  never followed. The base URL must be https (http only with `AGASTYA_GITLAB_ALLOW_HTTP=1`, for a lab), without credentials, query or fragment.
* **TLS.** The uploaded CA bundle (PEM; a private key is refused) goes into a per-CA `https.Agent` (`ca`, TLS 1.2+) used only for GitLab
  requests. Nothing is installed in the Windows store or Node's global trust.
* **Errors never look like an Agastya sign-out.** An upstream 401 becomes `409 GITLAB_AUTH`; 403 `GITLAB_FORBIDDEN`; 404 `GITLAB_NOT_FOUND`;
  400/409/422 `GITLAB_REFUSED`; 413; 429 → 503; 3xx → 502 `GITLAB_REDIRECT`; TLS → 502 `GITLAB_TLS`; timeout → 504 `GITLAB_TIMEOUT`.
  Reads (GET) are retried on network errors, 429 and 5xx with backoff and `Retry-After`; writes are never retried.
* **What is pushed.** The project's source files (`listArchiveFiles`), minus anything under a `_` or `.` segment, temporary/backup files,
  `Thumbs.db`/`desktop.ini`, and the PDF/FO a build writes at the project top. S1000D projects add `.agastya/settings.json` (the package
  settings needed to rebuild). The author name/e-mail is the Agastya person (e-mail from their GitLab account, else `<user>@users.agastya.invalid`).
  Large pushes are split into commits of at most `maxCommitBytes` (16 MB) / 500 actions ("(part i of n)"); one file above `maxFileBytes`
  (50 MB) is refused with `413 GITLAB_FILE_TOO_LARGE` and an LFS note (Git LFS through the REST API is not supported; keep such files out of
  the project or put them in LFS by hand).
* **Pull.** The base of every path is its blob sha at the last synced commit (`gitlab_sync_files`). Per file: only GitLab changed → apply;
  only here → keep; both → line merge3 for text (clean → write merged), otherwise a conflict. With an open conflict nothing is written
  (`409 GITLAB_PULL_CONFLICTS` with the list) until the person chooses `mine` or `theirs` per file. A head that moved since the summary is
  refused (`GITLAB_HEAD_MOVED`). Writes go through `saveRevisioned` (reason `gitlab-pull`; text) or the content store (binary),
  `recordBeforeDelete` for deletions, document leases are respected (a file leased by someone else is "blocked", not written), XML safety is
  checked, `noteDmWritten` updates the CSDB index, `docIndex.syncProject` runs, and a `reload` broadcast with `kind: 'external'` goes to the
  project room. `project.json` keeps the platform-owned keys (`PROTECTED_PROJECT_KEYS`); the settings file is applied through `restoreSettings`.
* **"Files changed externally" hook for the collaboration work:** `backend/src/services/externalChanges.ts`.
  `onFilesChangedExternally(fn)` → unsubscribe; the event is `{ projectId, source: 'gitlab', actor: {id, username}, files: [{ path, change:
  'added'|'modified'|'deleted', before: sha256|null, after: sha256|null }], detail, at }`, raised synchronously after all writes and revisions
  are done, paths project-relative with `/`. Listeners must not throw (errors are caught and logged).
* **Release storage.** `POST .../gitlab/releases {kind: 'release'|'build', includeArchive}`: the PDF (`jss-output.pdf`, or `jsg-output.pdf`),
  optionally the project package (`exportProjectArchive`) and a `metadata.json` (issue, watermark state, build/job id, release number,
  approvals) go to the Generic Package Registry (`agastya-<slug>` / `r<n>` or `build-<stamp>`), then a GitLab Release with tag
  `agastya-r<n>` / `agastya-build-<stamp>` at the synced commit with asset links and a metadata table. `kind: release` needs an approved,
  current release and a PDF built after it. With the project option "Store every release in GitLab", an approval triggers a background build
  and upload (audited `gitlab.release.uploaded` / `.failed`, `automatic: true`).
* **Merge requests.** "Open a review" pushes the project's unpushed changes to a new branch `agastya/review-<stamp>` (from the project
  branch; the project branch itself does not move) and opens an MR into the project branch, reviewers mapped through their connected GitLab
  accounts (the unmapped are named back). Sync reads the MR, approvals, reviewers and discussions: non-system notes become review comments once
  each (author = the connected Agastya person, else "From GitLab, <name>"), a reviewer state `requested_changes` becomes a "changes" comment.
  With the project option "GitLab approvals count", an approval in GitLab by a mapped person who may decide the release (manager or admin,
  not the requester under separation of duties) approves the pending release through the very same decision function as the Approve button
  (`routes/project-content.ts decision()`, exposed via `services/releaseEvents.ts`; the audit row carries `via: gitlab-mr-<iid>`). Merge (from
  Agastya or seen by a sync) pulls the project branch into the project.
* **Permissions** (capability strings, so capability rules can narrow them): viewer `gitlab.read`; editor `gitlab.push`, `gitlab.pull`,
  `gitlab.mr`; reviewer `gitlab.mr.sync`, `gitlab.mr.approve`; manager `gitlab.link`, `gitlab.branch` (switch), `gitlab.release`,
  `gitlab.mr.merge`. Creating a branch is `gitlab.push` (editor). Every call to GitLab uses the person's own token; reads (branches, history)
  fall back to the service token when the person is not connected and one is configured. Writes are never done with the service token.
* **Audit** (WP-29): `gitlab.config.tested/saved/removed`, `gitlab.account.connected/disconnected/revoked`, `gitlab.connect.started/failed`,
  `gitlab.project.linked/unlinked/options`, `gitlab.pushed`, `gitlab.pulled`, `gitlab.branch.created/switched`, `gitlab.release.uploaded/failed`,
  `gitlab.mr.opened/synced/approved/merged`; `release.approved` with `via` for a counted GitLab approval.

## Files

New: `backend/src/routes/gitlab.ts`, `backend/src/services/gitlab/{http,settings,accounts,repo,review,merge3}.ts`,
`backend/src/services/{secretBox,externalChanges,releaseEvents}.ts`, `backend/src/repositories/gitlabRepository.ts`,
`backend/src/storage/migrations/030-gitlab.js`, `backend/test/gitlab.test.js`, `backend/test/fixtures/mock-gitlab/server.js`,
`frontend/src/api/gitlab.ts`, `frontend/src/pages/AdminGitlab.tsx`, `frontend/src/components/{GitlabConnect,GitlabMrs}.tsx`,
`frontend/src/pages/project/RepositoryPage.tsx`, `frontend/e2e/gitlab.spec.ts`.

Changed: `backend/src/app.ts` (register routes), `backend/src/config.ts` (`gitlab.secretsKeyFile`, `gitlab.allowHttp`),
`backend/src/repositories/index.ts`, `backend/src/storage/migrations/index.js` + `backend/test/wp10-seams.test.js` (030 pinned),
`backend/src/routes/project-content.ts` (the release decision became one function `decision()`; same steps in the same order, plus an optional
`via` in the audit meta and a `release approved` event), `backend/test/fixtures/authz-allow.json` (3 own-account writes) and
`authz-policy.snapshot.json` (32 new routes, additions only), `frontend/src/pages/Administrator.tsx` (System > GitLab),
`frontend/src/pages/Settings.tsx` (GitLab card on Account), `frontend/src/layouts/projectRail.ts` (optional `{ gitlab }`, default off, so the
parity dump is unchanged), `frontend/src/layouts/ProjectShell.tsx`, `frontend/src/App.tsx` (route `projects/:id/repository`),
`frontend/src/pages/project/ReleasePage.tsx` (merge-request card), `frontend/src/components/Icon.tsx` (branch, merge, mr, commit).

Dependencies: none added. Migration: **030-gitlab** (written as 027, renumbered at the merges with main: 027-default-accounts,
028-pdf-annotations, 029 reserved for collaboration). Additive: seven new tables, no existing table touched.
**This branch does not start on its own until 029 exists:** `storage/schema.ts checkOrder` refuses a gap in the numbers. Merge the
collaboration branch (029) first, or before it lands rename `030-gitlab` to `029-gitlab` (file, `name`, `index.js`, `wp10-seams.test.js`).
The checks below were run with exactly that temporary rename, not committed.

## Decisions taken here

* REST only (no git binary): no install, no working copy to keep in step, every write goes through the platform's revision path.
* Conflicts: line three-way merge for text; binary or overlapping changes need a per-file choice. No conflict markers are ever written into XML.
* The OAuth callback is behind the normal session (the browser carries the Lax cookie on the top-level redirect); the state is one-use,
  10 minutes, bound to the person, and the PKCE verifier is sealed in the database.
* Disconnecting GitLab (admin "Switch off") revokes and deletes every person's token but keeps project links, so switching it on again resumes.
* A manager switching branches needs every local change pushed first (`409 GITLAB_LOCAL_CHANGES`).

## Possible regressions

* The release decision refactor (`project-content.ts`): behaviour is meant to be identical; `release-issue.test.js` and the review tests cover it
  (not run here under the owner's targeted-tests policy; owed in the final verification).
* `ProjectShell` asks `/api/gitlab/me` once per project opened (30 s cache); with GitLab off that is a 404 that the client treats as "off".
* Account page: one extra `/api/gitlab/me` request.

## Needs a real intranet GitLab to verify

* The OAuth application flow with GitLab's real consent page, Doorkeeper's actual answers to the dummy-code test (`invalid_grant` vs
  `invalid_client`), token refresh timing, and `/oauth/revoke`.
* The internal CA chain as the real instance serves it (intermediate certificates; a bundle may be needed).
* Approvals API on the installed edition (CE has no approval rules: `approvals_required` may be absent; the code treats "approved" as
  GitLab reports it), `reviewers` endpoint (GitLab 13.8+), `detailed_merge_status`, generic packages being enabled for the group, release
  asset links to package files, request size limits behind the intranet proxy, rate limits.
* Large projects: paging over thousands of tree entries, commit size limits configured on the server.

## Checks run (targeted, per the owner's policy)

* `backend`: `tsc -p .`; `node --test test/gitlab.test.js` (13/13); guard tests `authz-matrix`, `wp29-audit-coverage`, `wp11-integrity`,
  `wp10-seams` (all pass; authz snapshot regenerated after review, additions only).
* `frontend`: `tsc --noEmit`, `lint:theme` (0 literals), `check:parity` (pass), `check:cleanup` (pass), `vite build`.
* e2e: `E2E_PORT=4342 E2E_CHANNEL=msedge npx playwright test e2e/gitlab.spec.ts` against the mock on port 4344.

## Checks owed (final verification)

Full `npm run gate`; `release-issue.test.js`, review/approval tests, the full e2e suite (the rail and account page changed), visual suite
(new screens), and the real-GitLab items above.
