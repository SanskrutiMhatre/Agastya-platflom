# Phase 3 - standalone accounts (P3-6)

Owner decision P3-6 (`docs/phase3/DECISIONS.md`): two separate initialisation workflows.

* **A. Standalone EXE** (one computer): the first start of a fresh data folder creates one account per role with **fixed** credentials, every
  one forced to change its password at the first sign-in; the credentials are shown after installation (Setup's finish page and the
  application's first screen) with *Save a copy*.
* **B. Common server with clients**: unchanged. No default accounts; the administrator is created at the first start (the setup screen, or
  `INITIAL_ADMIN_*` / Setup `/ADMINUSER`), everyone else through user management.

## What was built

| Area | What |
|---|---|
| Mode | `AGASTYA_DEPLOYMENT=standalone\|server` (`config.deployment`). Unset = `server`, so a developer run, the e2e suite and every server from before P3-6 behave exactly as before. `standalone` needs Mode A (`AGASTYA_MODE=local`, loopback): standalone with `AGASTYA_MODE=server` stops at start naming the variable. Persistent through `agastya.ini [server] Deployment=` (Setup writes it; the host passes `AGASTYA_DEPLOYMENT`). Read-only on the administration page. |
| Accounts | `core/auth/policy.js DEFAULT_ACCOUNTS`: `admin`/`Admin@123` (admin), `manager`/`Manager@123` (project_manager), `author`/`Author@123` (author), `auditor`/`Auditor@123` (author + read-only auditor flag). These are the platform's real global roles (`GLOBAL_ROLES`) plus the WP-27 auditor flag. Reviewer, editor, viewer, manager and owner are **project** roles, granted per project, so they get no account of their own (a "reviewer" login would just be an Author). |
| Once per data folder | `core/auth/defaultAccounts.js ensureDefaultAccounts`, called by `services/firstRun.ts` (server start, `index.ts`) and by `backend/scripts/default-accounts.js` (Setup). Standalone only; the decision is recorded in `platform_init` (`default_accounts` = `created` or `skipped-existing-users`) in the same transaction as the accounts. A data folder with any account (an upgrade, the owner's real database) gets nothing and is marked so; deleted default accounts are never recreated; a server run writes nothing at all. |
| Forced change | Created with `must_change_password=1` and the new `default_password=1`; the session layer and `gatesOf` treat `default_password` as a forced change too (defence in depth). Every route except the four gate exits answers 403 `PASSWORD_CHANGE_REQUIRED` (the read-only auditor's project writes answer `READ_ONLY_ACCOUNT` one step earlier). |
| No reuse | `policy.validatePassword` refuses every default password (any case), before the length rule, with its own message - in the change, setup and onboarding flows alike, for every account. The normal policy (minimum length 15 by default) applies to the new password. |
| Remote refusal | A correct default password from an address that is not loopback (socket peer AND `req.ip`) is refused: 403 `DEFAULT_PASSWORD_REMOTE`, audited `auth.login.refused` (reason `default-password-remote`), no session. |
| Audit (WP-29) | `user.default_account_created` per account (meta `defaultAccount`, `forcedChange`, role; no password); `auth.password.changed` gains `forced`, `defaultAccount`, `defaultPasswordEnded`; `auth.default_credentials.acknowledged`; `auth.login.refused`. Labels in `frontend/src/lib/activity.ts`. |
| First launch | `GET /api/auth/setup` adds `deployment` and, on a standalone installation, to a loopback caller, until acknowledged, `defaultCredentials` (only the accounts that still have their default password). New public route `POST /api/auth/default-credentials/acknowledge` (standalone + loopback only, else 404; records `default_credentials_ack`; audited). Frontend: "Your sign-in details" screen (auth card) with the table, *Save a copy...* (`lib/saveTextAs.ts`: the browser's save dialog, so the person picks the file), *I have stored them*, *Sign in now (show this again next time)*. |
| Forced-change screen | `AuthScreens.tsx ForcedChange`: for a default account it says why ("a default account ... its password is published"), labels the field *Default password* and states the policy. |
| Admin | `GET /api/admin/health` adds `deployment: { mode, defaultAccounts: [{ username, role, defaultPassword, ... }] }`; `publicUser` adds `defaultAccount`, `defaultPassword`. Administration > Access > Security shows "Deployment: Standalone / Common server" (read-only, both modes); the overview shows it on a standalone installation with the accounts still on their default password; the users table has a *Default password* badge. Every new password hash clears `default_password` (`store.updateUser`), so an administrator's reset also ends it. |
| Installer | `packaging/installer/agastya.iss`: `WantedDeployment` (LAN or `/CLIENTOF` = server, else standalone) into the ini template's `Deployment=@DEPLOYMENT@`; an upgraded ini without `Deployment` gets it once from what the installation already is (`ExistingIsCommonServer`). After `/ADMINUSER`, `CreateDefaultAccounts` runs `AgastyaCtl.exe --default-accounts`; on exit 0 the finish page shows the credentials in a read-only memo with *Save a copy...* (`GetSaveFileName` + `SaveStringToFile`, only to the chosen file; nothing goes to Setup's log). Silent: nothing shown; the application's first screen shows them. Host: `Settings.Deployment`, `AGASTYA_DEPLOYMENT`, `--default-accounts` (`Updater.DefaultAccounts`), `--configure-server` and `--install-service --lan` set `Deployment=server`. Portable ZIP: `Deployment=standalone`. |
| Release evidence | G-SEC-2 row of `docs/audit/RELEASE-EVIDENCE.md`: recorded exception for the fixed default credentials with their mitigations. |

### Why Setup creates the accounts itself

Setup's finish page must show credentials that really exist, and the server has not started yet when it is shown (and may never start in
Setup's process: the service starts afterwards, the tray application on *Start now*). So Setup runs the server's own first-start step through
`AgastyaCtl.exe --default-accounts` (the same pattern as `/ADMINUSER` -> `--first-admin`): the database is opened through the normal start
sequence under the data-folder lock. The tool prints usernames only and exits 0 (created) or 3 (nothing to do); Setup shows its own copy of
the fixed list. `backend/test/standalone-accounts.test.js` keeps that copy, the ini template and `policy.DEFAULT_ACCOUNTS` identical. When
the tool cannot run (exit 1), the server creates the accounts at its first start and the application's first screen shows them.

## Files changed

Backend: `src/config.ts`, `src/index.ts`, `src/app.ts`, `src/services/firstRun.ts` (new), `src/core/auth/defaultAccounts.js` (new),
`src/core/auth/policy.js`, `src/core/auth/routes.js`, `src/core/auth/sessions.js`, `src/core/auth/store.js`,
`src/storage/migrations/027-default-accounts.js` (new) + `index.js`, `scripts/default-accounts.js` (new).
Tests: `test/standalone-accounts.test.js`, `test/standalone-server-mode.test.js`, `test/support/first-run-child.js` (new);
`test/wp10-seams.test.js` (the pinned migration list gains 027); `test/fixtures/authz-policy.snapshot.json` (one added public route, reviewed).
Frontend: `src/api/index.ts`, `src/store/session.ts`, `src/pages/AuthScreens.tsx`, `src/pages/Administrator.tsx`, `src/pages/Settings.tsx`,
`src/lib/saveTextAs.ts` (new), `src/lib/activity.ts`, `src/styles/platform.css`, `src/styles/pages/admin.css`; `e2e/standalone-first-run.spec.ts` (new).
Packaging: `packaging/installer/agastya.iss`, `packaging/agastya.ini.template`, `packaging/host/AgastyaHost.cs`, `packaging/host/Update.cs`,
`packaging/host/TeamServer.cs`, `scripts/package-windows.mjs` (ships `default-accounts.js`; the portable ini), `scripts/release/installer.test.mjs` (stand-in script list).
Docs: this file, `docs/OPERATIONS.md` (section 2 "First visit", section 9 table), `docs/audit/RELEASE-EVIDENCE.md` (G-SEC-2).

## Decisions taken here

* Default roles = global roles + auditor; no "reviewer" account (project role). Username `manager` for the Project Manager role.
* The default passwords bypass the password policy at creation (they are 9-11 characters and `Admin@123` is on the common list) - owner
  decision - and are refused by it everywhere afterwards.
* Default for an unspecified run is `server` (no default accounts), so nothing changes for development, the e2e suite or existing servers.
* The first-launch credentials come from a public route, but only to a loopback caller on a standalone installation and only for accounts
  still on their published default; the acknowledgement is public for the same reason (nobody can sign in yet) and changes no account.
* The overview's deployment note appears only on a standalone installation, so the common-server overview (and its visual baseline
  `e2e/visual/__screenshots__/*/administrator.png`) is unchanged; the read-only mode is always under Access > Security.
* Migration number 027 was the next free one. Another Phase 3 area may add a migration in parallel: whoever merges second renumbers its
  own (`checkOrder` refuses a duplicate number) and updates the pinned list in `wp10-seams.test.js`.

## Possible regressions

* `store.updateUser` now writes `default_password = 0` with every `password_hash` change: needs migration 027 applied (it always is after
  `ctx.start()`); a test that builds an `AuthStore` on an unmigrated database and changes a password would fail.
* `validatePassword` refuses the four default passwords for everyone (also as a chosen password on a common server).
* `GET /api/auth/setup` now also returns `deployment`; a client comparing the whole body (none found) would see it.
* `/api/admin/health` has a new `deployment` field; `publicUser` two new booleans.
* A pre-P3-6 standalone installation upgraded with the new Setup gets `Deployment=standalone`; with users present nothing happens, and an
  installation whose data folder has no account yet (setup never completed) gets the default accounts at its next start.
* Setup on a standalone install now runs one more tool (`--default-accounts`, a few seconds of Argon2 + migrations) before the finish page.
* `scripts/release/installer.test.mjs` installs without `/LAN`, so its installs are standalone now: with `/ADMINUSER` (its first install)
  no default accounts are made; its stand-in server does not run the real tool's database step. Not run here (it installs).

## Checks run (targeted, 2026-11-28)

* `backend`: `npx tsc --noEmit -p .` clean; `test/standalone-accounts.test.js` 13/13 (the non-loopback test ran against this computer's LAN
  address), `test/standalone-server-mode.test.js` 2/2; guard tests `authz-matrix` 6/6 (snapshot regenerated after review: one added
  public route), `wp29-audit-coverage` 2/2, `wp11-integrity` 16/16, `wp10-seams` 11/11.
* `frontend`: `npx tsc --noEmit -p .` clean; `npm run lint:theme` 0 literals; vitest `AuthScreens.test.tsx` + `stores.test.ts` 17/17;
  `e2e/standalone-first-run.spec.ts` 3/3 with `AGASTYA_DEPLOYMENT=standalone E2E_PORT=4332 E2E_CHANNEL=msedge` (temp workspace), and 3
  skipped on a common server (`E2E_PORT=4333`). Screenshots of the three screens were looked at (light theme).
* Packaging: the host compiles with the release's csc flags (0 warnings) into a scratch folder; `agastya.iss` compiles with ISCC against a
  dummy source folder in a scratch folder (nothing signed, nothing installed).

## Checks owed (final verification phase)

* **Installer build and install verification** on a clean VM (not on a development machine: it writes Program Files, ProgramData, the
  registry and the Start menu): build with `npm run package:win`; install interactively without *Allow other computers* -> the finish page
  shows the four accounts, *Save a copy...* writes only the chosen file, `agastya.ini` has `Deployment=standalone`, the application's first
  screen shows the same list until *I have stored them*; sign in as `admin`/`Admin@123` -> forced change. Install with `/LAN` and with
  `/CLIENTOF` -> `Deployment=server`, no finish-page credentials, the setup screen. Silent standalone install -> no finish page, first screen
  shows them. Upgrade an existing installation (with users) -> no default accounts, its users kept, `Deployment` filled in once.
  `/ADMINUSER` + standalone -> only that administrator. Then `scripts/release/installer.test.mjs` on the VM.
* Finish-page layout at 125 % / 150 % display scaling (the memo and the button below the *Start now* checkbox).
* Dark theme look of the first-launch screen and the Security note (tokens only; not screenshotted here).
* WebView2 shell: *Save a copy...* uses `showSaveFilePicker` (expected in WebView2); if the shell refuses it, the fallback is an ordinary
  download, which WebView2 saves to Downloads without asking - verify on the packaged app.
* Full suites (`npm run gate`, the full e2e run, the visual suite) in the comprehensive verification.
