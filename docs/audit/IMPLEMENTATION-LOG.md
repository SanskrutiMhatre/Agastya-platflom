# Implementation log

The audit roadmap (`14-PRIORITIZED-IMPLEMENTATION-ROADMAP.md`) is executed in order under the owner's execution directive of 2026-11-27
("treat the entire approved audit and implementation roadmap as one continuous end-to-end mission"). Open decisions take the audit's
recommended or assumed answer. One local checkpoint commit per work package (nothing is pushed). Every entry says what was done, how it was
verified, and what is left or blocked.

## Phase 1A

### WP-01 Path safety of project.json (SEC-002, S1K-001, PUB-001, PUB-026) - done

* `services/projects.ts`: `safeProjectRel` (relative, no `..`, no drive, no `:`, no reserved device names, no trailing dot or space);
  `csdbRel` / `mediaRel` / `pmRel` validate and fall back to the standard folder; `unsafeInputFields`, `cleanInput`,
  `PROTECTED_PROJECT_KEYS`; `scanUnsafeProjectPaths()` at start-up reports (does not change) a poisoned project.json (D13).
* `PUT /api/projects/:id/settings`: 400 `UNSAFE_PATH` for a hostile file location, 400 `PROTECTED_SETTING` for a change of id, format,
  authoring or type; name, folder and input always keep the value on disk.
* Project archive import: the kind comes from the target, unsafe locations are dropped and reported.
* Every raw `input.csdbDir|mediaDir|pm` read (publisher, graphics, validation, docindex) goes through the helpers; an architecture test keeps it so.
* Verified: `test/settings-hostile-input.test.js` 6/6; 68/68 in the related suites.

### WP-02 XML guard, resource confinement, child processes (SEC-001, SEC-003, SEC-011, PUB-002, PUB-014, PLT-018, PUB-030, PUB-024, PUB-025, S1K-005) - done

* `core/auth/xmlGuard.js` rewritten as a tokenizer: comments, PIs and CDATA are skipped (the decoy DOCTYPE of SEC-001/PLT-018), one DOCTYPE
  only, none after the root, ASCII-compatible encodings only, NUL refused; parsed external entities, internal parameter entities,
  nested or markup-carrying internal entities, conditional sections refused; character references decoded before every check;
  `xi:include` under any prefix (also bound by a DTD default attribute) confined to relative paths inside the project; `xml:base`
  confined; a DTD mode for `.dtd`/`.ent` files; entity text capped at 64 KB and the expansion of all references at 8 MB (S1K-005).
  Corpus check: 1586 shipped files, the old and new guard agree on every one.
* The guard runs on the JSS and JSG document saves and on ancillary-page saves (PUB-014, PUB-002); JSS and JSG documents may not carry a
  DOCTYPE (400 `DOCTYPE_REFUSED`); `composeBook` re-checks every front-matter page and leaves an unsafe one out (PUB-002).
* Vendor exception `foGuard` (`docs/JSS_VENDOR_EXCEPTIONS.md`): every FO is confined before FOP renders it, in the S1000D, JSS, JSG and
  single-object paths; a URL, UNC or out-of-tree picture becomes a blank and is logged (SEC-003, SEC-011).
* Publisher logos and emblems are refused at the settings write unless they are a relative path in the project or a data: image (400 `UNSAFE_ARTWORK`).
* Child processes get an allow-listed environment (`paths.childEnv`, also for LemMinX): no `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`,
  `JDK_JAVA_OPTIONS`, `CLASSPATH`, `NODE_OPTIONS` or session secrets (PUB-030, environment part).
* Book metadata replacement uses a function (`$&`, `$$`, `$'` print as written, PUB-024); a parameter value with both quote kinds is passed
  to xsltproc as an XPath `concat()` (PUB-025).
* Verified: `test/xml-guard.test.js` 4/4 (37 refused payloads, legitimate S1000D constructs, every shipped XML/DTD/ENT file, artwork rule);
  `test/fo-guard.test.js` 5/5 including the audit's own SSRF reproduction end to end (a loopback listener records no request; with the guard
  disabled it records `GET /pixel.png Java/21.0.13.1`); `test/wp02-routes.test.js` 7/7 (JSS and JSG payload refusal, the ancillary canary
  in the PDF, metadata patterns, both quote kinds on the bundled xsltproc, entity bounds).
* Left for later packages, by the roadmap: `-Xmx`, priority and job objects for the tools belong to the worker design (PUB-027, PUB-003);
  S1000D front-matter files and the publication module XInclude (PUB-013) are covered by the guard on their write routes.

* Proven to fail without the fix: with the ancillary write check disabled in `dist` the ancillary test fails; with only the compose
  filter disabled it fails too (both restored byte-identical).

### WP-03 Account, session and edge hardening (PLT-014, SEC-004, ENT-002, SEC-007, SEC-008, ENT-011, PLT-023, REL-006, SEC-010, PLT-017, FE-011, PERF-018, SEC-016, ENT-010, PLT-022, UX-022, PLT-015, ENT-009, PLT-019, SEC-013, ENT-012, FE-017, RES-009, SEC-012) - done

* Temporary passwords: `<username>-` plus 8 characters from `crypto.randomInt` (no `username@year`).
* `/api/users/search` only for administrators, Project Managers and people who manage a project.
* Sign-in throttle: 10 per 15 min per account, over every address, kept in the database (migration `020-login-throttle`), and
  100 per 15 min per address over every account. A success clears only that account's counter.
* Client address: `trust proxy` from `AGASTYA_TRUST_PROXY` (default loopback); the audit row carries it; a request id in
  `AsyncLocalStorage` and the `X-Request-Id` header.
* Audit metadata redaction keeps fingerprints (`contentHash`) and drops secrets by name and by value (hash formats, cookies). A failing audit
  write is counted, appended to `workspace/logs/audit-failures.log`, and shown to administrators (`GET /api/admin/health`, Security page).
* Sessions follow an administrator policy (Administrator > Security; D7): idle 30 min, absolute 12 h with a matching cookie
  `Max-Age`, one session per person, separation of duties on, password minimum 15. A background request
  (`x-agastya-background: 1`) is not activity; typing, clicking and scrolling are reported at most every 4 minutes.
  A 401 says why (`SESSION_DISPLACED`, `SESSION_IDLE`, `SESSION_EXPIRED`, `ACCOUNT_DISABLED`, `SESSION_REVOKED`); the sign-in page shows it.
* WebSocket: Origin checked at the upgrade (403); a disable, revoke or newer sign-in closes the socket within the same tick (code 4401,
  plus a 30 s sweep); a slow client is skipped above 1 MB buffered and dropped above 8 MB; the client does not retry after 4401.
* Separation of duties: the requester cannot approve (403 `SEPARATION_OF_DUTIES`, before anything is issued); the release page says why.
  The administrator may switch it off for a one-person installation; the change is audited.
* A 500 answers `{ error, code: 'INTERNAL', id }` and never the raw message; a malformed body is a 400.
* Security headers: CSP (`default-src 'self'`, no inline script; the theme script moved to `/theme-init.js`), nosniff,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`, COOP, Permissions-Policy; `/api/` answers carry `frame-ancestors 'self'`.
  Residual: `script-src 'unsafe-eval'` stays because pdfmake (`studio/export/pdfmake-patch.ts`) uses `new Function`; removing it needs a
  build-time patch of pdfmake (recorded for the performance/front-end phase).
* New passwords follow the policy minimum and refuse a bare username, name or product word with digits and symbols around it.
* Verified: `test/wp03-auth.test.js` 11/11; 73/73 in api, notifications, phase13, phase17-security, publish-gate, rbac, release-issue,
  routes-guarded, xengine-legacy-import, wp02-routes, xml-guard, fo-guard, wp04-reset-admin.
* Also fixed: `xengine-legacy-import.test.js` still expected the four code switches c61ec89 removed (`show` is `{ dmc }` only).

### WP-04 File permissions, service identity and admin tooling (ENT-004, SEC-005, DEP-012, DEP-022, PLT-012, DEP-009) - done (VM run pending)

* Installer: the state and data folders lose inheritance from `C:\ProgramData`; only SYSTEM and Administrators (full) and the server's identity
  (LOCAL SERVICE with the service, otherwise the installing user) get access; an upgrade removes the old Users and Authenticated Users grants.
* `reset-admin` never takes the password on the command line: it asks twice without echo, or reads one line with `--stdin`.
  `AgastyaCtl --reset-admin <user>` runs it with the configured data folder (elevated prompt). The database opener sets `busy_timeout`
  5000 so the reset works while the server runs.
* The service stops with error 1067 when the supervisor gives up (it no longer stays RUNNING), and `sc failureflag 1` makes Windows run the
  recovery actions on that stop too.
* Verified here: the installer script compiles with ISCC 6 (setup built into the scratchpad from the existing release folder); both host programs
  compile with no warning; `--help` lists the command and a missing user name gives usage; the exact `icacls` commands were run on a scratch
  folder carrying a Users grant and an inherited Authenticated Users grant, and the result was SYSTEM, Administrators and LOCAL SERVICE only;
  `test/wp04-reset-admin.test.js` 1/1 (refused on argv, piped works, the password is in no file of the workspace).
* Pending (environment): `scripts/vm-acceptance/Test-InstallerInVm.ps1` now checks G-SEC-6 (no ACE outside SYSTEM, Administrators,
  LOCAL SERVICE, CREATOR OWNER; inheritance cut). It needs Hyper-V and a guest image, which this machine does not run; WP-08 runs it.

### WP-05 Editor data loss and session handling in the shell (FE-001..FE-007, S1K-004, ARC-002, FE-024, PUB-023, FE-023, FE-012, GAP-001) - done

* The Studio's page-wide listeners act only while the Studio is on the page and the event is its own (FE-001: Ctrl+S in the JSS or JSG
  editor is never taken; FE-023: a file dropped elsewhere is not opened); they sit on one `AbortController` and `dispose()` removes them.
  `window.studio` exists only in development or under automation (`navigator.webdriver`).
* A 401 while someone is signed in keeps the page: a "Sign in again" dialog appears over it, the request that met the 401 waits and is sent
  again after the sign-in (a Save goes through). Only a 401 signs anyone out; a network error or a 5xx shows "The server is not answering"
  and retries (FE-004). The activity report and a background check every minute run on every page, the editors included (FE-003).
* The project shell is keyed by the project id (FE-005).
* Drafts: the Studio's drafts carry `<user>/<project>` and are offered back when that person opens that module again (FE-006, S1K-004,
  ARC-002); the JSS and JSG editors write a draft to IndexedDB every 3 s while there are unsaved changes and offer it on open (PUB-023);
  JSG autosave is on by default. A save removes the draft.
* A refused save (someone else saved first) keeps the author's version: download it, or (manager, owner) save it over the other; reopening
  theirs asks in the platform's dialog (FE-007). The Studio offers the download.
* Sign-out: a sign-out the person chooses removes their drafts in both stores from any page (`lib/draftPurge.ts`) and drops the Studio
  instance, its documents and cached artwork; an ended session keeps the person's own drafts (FE-024).
* Confirmation first for role and access changes, maintenance jobs that change data, and release approval (FE-012); the JSS ancillary page
  uses the platform dialog instead of `window.confirm`. Both ancillary pages have the leave guard (GAP-001).
* Verified: `e2e/wp05-dataloss.spec.ts` 10/10 in Edge (cross-editor Ctrl+S, drop on another page, revoke while typing with the save
  replayed, a 503 from `/api/auth/me`, Back and Forward between projects, JSS and JSG draft recovery after reload, conflict download and
  reopen, sign-out by session end and from the menu). The menu sign-out test found a real defect in the first version (drafts survived a
  sign-out from a page that had not loaded the editor code); fixed by `draftPurge.ts`.
* Found by the first full e2e run after WP-03 to WP-05 (96 passed, 3 failed, 44 not run): (1) the CSP's `connect-src 'self'` stopped pdf.js
  reading a rendered PDF from its `blob:` URL, so no preview page was drawn; `connect-src` now also allows `blob:` and `data:` (content the
  page already holds; no other origin). (2) `jss-editor.spec.ts` still drove the old conflict flow (`window.confirm`); it now uses the banner
  and the platform dialog. (3) The first-run test needs an empty workspace but seven specs sorted before it and created the administrator,
  so it failed and its serial file skipped 44 tests; the file is now `00-platform.spec.ts` and runs first (every other spec already copes
  with an existing administrator).
* Found by the full e2e run on the Phase 1A commit (f16f2ea; 122 passed, 1 failed, 25 not run): (4) the release test clicked Approve and
  waited for "Approved", but WP-05 had replaced the browser confirm box (accepted by Playwright on its own) with the platform dialog
  "Approve and release this manual?"; the test now confirms in that dialog and checks it closes. (5) Behind it, the administrator test
  still listed the "SNS defaults" section the owner removed on 2026-11-26; it now asserts the section is absent. After both:
  `00-platform.spec.ts` 41/41 and the whole Edge suite **148/148** (9.4 min).
* Frontend unit tests on f16f2ea: type check clean. A full `vitest run` alongside three agents gave 5 s default-timeout failures
  (`naval.test.ts`, `verify/objects.test.ts`: 34/34 when run alone) and a worker crash in the heavy `verify/` schema files
  (`controls`, `brex-xpath`, `editor-controls`, 20 min). Both are QA-scope findings of WP-08 (timeouts, the native crash); the three
  heavy files are re-run on an idle machine after WP-08.

### WP-06 Project lifecycle integrity (PLT-003, PLT-004, PLT-002, PLT-010, REL-003, REL-004, DEP-017) - done

* Start-up reconcile never deletes: a project whose folder is not there keeps its row and memberships, is marked (migration
  `021-project-lifecycle`, table `project_missing`), audited once (`project.folder_missing`) and shown with a **Folder missing** badge;
  the mark goes when the folder comes back. An administrator can still delete it (the confirmation takes the registered name).
* Delete removes the project's content in one transaction: documents with revisions, state, locks and comments, releases, review comments,
  lifecycle and CIR links, extensions and project notifications (`store.purgeProjectContent`). The audit log stays; the id is tombstoned
  (`project_tombstones`) and a new project never takes an id that a project, a tombstone or left-over rows already used (PLT-004).
  Content-addressed blobs are shared between projects and are left for the storage clean-up of a later package.
* Database: `busy_timeout` 5000 and `foreign_keys` ON stated at open; a lock held past the timeout answers 503 `BUSY` with `Retry-After`
  (API and sign-in) instead of 500; project creation rolls back its folder when the registry insert fails (PLT-002).
* One server per data folder: `.agastya-server.lock` with process id and host; a second server stops with "already in use by another
  Agastya Platform server (process N)"; a lock of a dead process is taken over (DEP-017).
* Clean stop: refuses new connections, lets running requests finish for up to 15 s, checkpoints the WAL, closes the database and gives the
  lock back; no fixed 500 ms exit any more (REL-003).
* Imports: a project made by an import (project archive, package import, the six conversions) carries a pending mark until the import has
  finished. A failure discards it at once; a stop in the middle leaves the mark and the next start removes the project and audits
  `project.import_discarded` (REL-004). The mark is used instead of a staging folder plus rename because an import also writes database
  rows (configuration, index, comments), which a folder rename cannot make atomic.
* PLT-010, partly: foreign keys are stated; the unused tables (`files`, `doc_state`, `doc_comments`, `folder_access_requests`,
  `change_requests`) and a `project_id` foreign key are left for the migration-framework package (PLT-011), which can rebuild tables after
  a snapshot; dropping or rebuilding tables here would not be additive.
* Verified: `test/wp06-lifecycle.test.js` 5/5: same-name recreate after delete (other id, one revision, no lock, `foreign_key_check` clean),
  folder missing and back, failed and cut-off imports, a second server refused, a request still sending its body during the stop is
  answered (past the old 500 ms), WAL empty after the stop, a dead lock taken over, a 1.5 s external lock waited for, a 9 s one answered
  503 with no folder left. Proven to fail: with the id check and the purge disabled in `dist` the first test fails.
* Known limit: a process id reused by an unrelated program after a crash makes the lock look held; the message names the file to delete.

### WP-07 Broken or misleading features (UX-001, FE-009, DEP-011, DEP-027, FE-013, UX-015, UX-016, DS-004, UX-018, UX-019, UX-023, PUB-012, PUB-020, SEC-015, ARC-020, SEC-014, PLT-024, UX-026, UX-006, PERF-019) - done

* UX-001 / FE-009: the JSS and JSG pages were already fixed (`docs/audit/16`); `readPm` now answers 400 `NOT_A_PM` for a file that is not a
  publication module instead of a 500.
* DEP-011: the JSG build passes its stylesheet as an absolute location, as the S1000D and JSS builds do.
* DEP-027 / PERF-019: "Image compression" is no longer offered (Ghostscript is not shipped, so it did nothing); the build keeps its gate for an
  installation that provides Ghostscript (`JSS_GS`).
* FE-013: the administrator's card is "Project data export" and says what it leaves out (passwords, settings, release records; no restore);
  the Backup page and the administrator guide say the same. The real database backup with restore is WP-12.
* UX-015: every action the server writes has a sentence; an unknown one is worded from its code, so no dotted code is shown as a sentence;
  the author's Overview leaves out sign-in bookkeeping; the audit log shows the sentence with the code beside it (its filter takes codes).
* UX-016 / DS-004: the block rule applies to the empty-state title only (`.v2-empty-title`); the PDF placeholder's rules moved to
  `.v2-empty-steps` (they used to make every empty state left-aligned in 300 px).
* UX-018: the JSG cover form uses the platform's field look (label above a full-width input, two columns where there is room).
* UX-019: the two different exports in the JSS header have two names ("Export JSS package", "Export project"); the module panel's header
  wraps instead of cutting "Publication". The labelled Document menu is WP-22.
* UX-023 / UX-026: the sign-in error is cleared when switching to and from the reset screen; the tagline names S1000D, JSS and JSG.
* PUB-012: the shipped templates no longer name a developer screenshot or six symbol icons that do not exist; a symbol without a picture
  has no `src` (the page draws its empty frame for the author's own icon).
* PUB-020: the default emblem, first-aid figures and L&T logo are absolute `file:` URLs (they were eleven `../` steps, with no route at all
  across drives); the FO image check understands `file:` URLs and absolute paths.
* SEC-015 / ARC-020: one CSV cell writer (`services/csv.ts`, `lib/csv.ts`) for the SNS, preset, audit and validation exports: quotes doubled,
  and a cell starting with `= + - @`, tab or CR gets a leading apostrophe.
* SEC-014 / PLT-024: package downloads are named after the project; the CIR extension refusal is a 403 `CIR_NO_EXTENSIONS`, not a 500.
* UX-006: the Projects toolbar and the three editor headers wrap instead of pushing controls past the right edge (stop-gap before WP-22).
* Baselines: `test/fixtures/cover-baseline.json` re-captured for all three builds, because PUB-012 changes their FO on purpose. Measured as
  the earlier re-captures were: with the three template/front-matter files put back, all three builds give the previous values again; with
  them, the only differences are the left-out screenshot (3 lines in the direct S1000D engine) and the seven pictures replaced by frames
  (30 lines on the two JSS paths). The same measurement shows that PUB-020 does not move any fingerprint.
* Verified: `test/wp07-small-fixes.test.js` 4/4 (JSS and JSG `pmc` 4xx; a new JSS book's FO resolves every picture, 0 empty, 0 missing;
  CSV cells including the SNS export end to end and the audit export; package file name; CIR extension 403);
  `test/wp07-jsg-deep-path.test.js` 1/1 (fails with the old relative form: "failed to load external entity ../../.."); the cover-isolation,
  publisher-logo, fo-guard, jss-authoring and jsg-engine suites pass apart from the two known poppler tests;
  `e2e/zz-core-routes.spec.ts` 5/5 in Edge (25 routes of the three project kinds and the platform at 1280, 1366 and 1440 px with no server
  error or script error; New project, Generate, the PDF switch, the save state and the module-panel switch visible inside the viewport; the
  sign-in screen; the empty states). Proven to fail: without the toolbar and header fixes it fails at 1280 px.
* Limit: a working folder deeper than 248 characters still stops the 32-bit tools (xsltproc cannot use it as its current folder); the
  doctor's long-workspace warning covers it, and the job service (WP-14) can stage builds in a short folder.

### WP-32 Validation that tells the truth at scale, plus an event-loop stop-gap (PERF-002; PERF-001 interim) - done

* PERF-002 (`vendor/engine/validateSchema.js`, vendor change recorded in `S1000D_COMPLETE_IMPLEMENTATION.md` section 10): the schema pass
  batches modules by bytes (at most 3.5 MB of text per validator call) and gives each call WebAssembly memory sized to its batch and the
  schema set, up to the 4 GiB maximum. A batch the validator cannot run is retried module by module; only the module it cannot judge is
  reported ("ran out of memory on this module (N MB)", or "too large ... (limit 256 MB)"), and only judged modules count in `checked`.
  Measured: a single module of 25, 60 and 120 MB is judged with sized memory, so the audit's "25 MB fails" no longer happens and the limit
  is the real one, not a guess.
* Also fixed: xmllint ends each invalid document with "<name> fails to validate", a line with no location, and it was pinned on the FIRST
  module of the batch, so a clean module was reported as not matching the schema whenever another module in its group was invalid. The
  line now goes to the module it names and is dropped when that module already has its specific errors. A project with an invalid module
  therefore shows one fewer (false) error; nothing else in its findings changes.
* The gate keeps refusing an unchecked module, but says why: the module's own reason travels into the finding, and the summary says "the
  schema check could not judge N data modules" instead of counting them as "not valid against the S1000D schema".
* PERF-001 stop-gap (`services/yieldLoop.ts`): the applicability, missing-graphics and BREX loops give the event loop a turn every 25 ms,
  and the scans that run back to back (applicability, graphics, duplicate ids, ICN declarations, publication, revisions) each get a turn
  of their own. Validation is not faster (210 modules with BREX: 11.6 s before and after); the server answers during it. The applicability
  check is now async (`validateProject`), and its three routes await it. The real fix, validation in a worker, is WP-14.
* Verified: `test/wp32-validation-scale.test.js` 8/8 (600, 900, 1000, 2000 and 5000 modules: all judged, none unchecked, errors exactly on
  the planted modules; 40 modules across Issue 4.2 and 5.0 give the same modules, lines and messages as checking each module alone; a
  25 MB module is judged and its error found on the right line; no error on the first module of a batch); all 8 fail on the previous
  engine. `test/wp32-validator-crash.test.js` 1/1 (a validator failure on one module of a 30-module batch: one call, then 30 single calls;
  only that module is reported, with its size; the invalid module beside it is still found; `checked` is 29).
  `test/wp32-event-loop.test.js` 1/1 (210 modules with BREX through the API, a second client polling `/api/health` every 20 ms: longest
  event-loop stall 69-75 ms over three runs, every poll answered; with the between-scan turns removed: 201 ms; with the in-loop yields
  removed: 5381 ms).
* Limit: one BREX check of one module is not split (about 70 ms for these modules; the audit measured 2.5 s for a 100 KB module and
  168 s for 1 MB, PERF-001). Those stall until WP-14 moves BREX into a worker.
* Test fix found by the full backend run (`test/jsg-word.test.js`): the order checks searched for `CERTIFICATE` and `APPX ‘A’`, but the
  owner's stencil (c4bc7bf, unchanged) sets the title letter-spaced as literal text ("C E R T I F I C A T E"), and xpdf's pdftotext
  (Git for Windows ships it; poppler is not installed here) writes the curly quotes as `` `A' ``. The text helper now reads a letter-spaced
  title as one word and the two quote forms alike; the order assertions are unchanged. The ISPL test now passes; the JSG sample test runs
  on to its page count, which needs poppler's `pdfinfo` (WP-08).

### WP-19 Design tokens, component states, dark/light parity (DS-001, DS-002, DS-003, DS-005, DS-006, DS-007, DS-008, DS-009, TH-001..TH-008, UID-002, UID-003, UID-004) - done, with the limits listed

* DS-001 / DS-009 / TH-002 (one token source): `frontend/src/styles/tokens/tokens.json` is the only place a colour is written. Three tiers:
  primitives (`--p-*`), semantic tokens with a required [light, dark] pair, `fixed` tokens that are the same in both themes (paper, PDF
  viewer, shadows), and an alias tier that keeps the old names (`--bg`, `--text-faint`, `--x-*`, `--page-*`, `--xml-*` ...) pointing at the
  semantic ones. `scripts/tokens/build-tokens.mjs` writes `src/styles/tokens/tokens.css` (imported first in `main.tsx`); `--check` fails
  when the CSS is stale. The three old token blocks (Studio `app.css`, the `.design-scroll` block of `document.css`, the `--x-*` block of
  `platform.css`) are gone. Migrated to tokens: shell, Studio, JSS (`jss/style.ts`, `jss/editor.ts`), JSG (`jsg/shared.ts` BASE_CSS rewritten,
  `editor.ts`, `ispl-editor.ts`, `ispl-preview.ts`), CodeMirror syntax colours, the PDF viewer (`PdfJsViewer.tsx`, `LazyPdfViewer.tsx`,
  `pdf.css`), the release paper preview, the review comment marks, the explore page.
* DS-003 (literal lint): `scripts/tokens/lint-colors.mjs` counts hex, rgb()/hsl() and named colours in value position in every .css/.ts/.tsx
  under `src/` except the token files and tests; exit 1 above 0. Report-only, with the reason printed: the pdfmake print palette
  (`studio/export/pdf-theme.ts` 6, `pdf-layouts.ts` 2, `pdf-content.ts` 1: the exported PDF's paper, not the screen) and one line written
  into a blank pop-up window that has no stylesheet (`studio/ui/panels.ts` 1). Count at f16f2ea (same script over `git archive f16f2ea`):
  **356**; now **0**. `npm run lint:theme` runs build-check + contrast + lint.
* TH-005 / TH-002 (contrast): `scripts/tokens/check-contrast.mjs` checks 103 declared pairs in both themes (206 checks; text 4.5:1,
  UI/large 3:1, alpha composited over the panel) and fails on any `var(--x)` under `src/` that nothing defines (coverage); unused aliases
  are listed as a warning. Same 103 pairs on the old values: 37 of 206 failing; now 0 failing in light and 0 in dark.
* TH-001 (JSG chrome): the generic `.jsg-bar button` rule that out-specified the tabbed toolbar is scoped to `.jsg-bar:not(.jsg-tabbed)`;
  the toolbar, tabs, navigator and find panel use the shared tokens, so dark no longer shows a light toolbar and the selected tab reads
  hovered or not (static test + e2e). The sheet stays on paper tokens (white in both themes).
* TH-003 (administrator accent): `src/lib/accent.ts` `deriveAccent()` makes a light and a dark variant of any #rrggbb so that the accent is
  4.5:1 on panel, canvas, hover, pressed and its own soft tint, and the text on it is 4.5:1; it darkens (light) or lightens (dark) in
  small steps and reports `adjusted`. `store/appSettings.ts` sets `--admin-*-light/-dark`, which `tokens.css` reads through
  `var(--admin-accent-light, ...)`. The server validates with the same function (`backend/src/services/accent.ts`, generated copy; a
  vitest proves equal output over 265 colours). Administrator > Visual shows a light and a dark preview of the result and says when the
  colour was adjusted. #ffcc00 (1.51:1 light) and #1d3a8a (1.77:1 dark) are repaired.
* TH-004 / TH-008 (theme choice): Account settings has an "Appearance" card (`data-testid="theme-choice"`): Follow the system / Light /
  Dark; "Follow the system" removes the personal choice. The administrator default theme is cached in `agastya.theme.default` and
  `theme-init.js` uses it before paint, so a person without a choice gets the organisation default with no flash. The header toggle keeps
  its behaviour and test id. The Studio's own Theme field is hidden when the Studio runs inside the shell (one control, not two).
* UID-004: `color-scheme: light` / `dark` is set on the root by `tokens.css`, so native controls, scrollbars and date pickers follow the
  chosen theme, not the OS.
* DS-002 (component states): `src/styles/states.css` (loaded last). Disabled = surface-disabled + text-disabled + border, cursor
  not-allowed, never opacity alone (the opacity rules of `.icon-btn`, `.vs-btn`, `.rb`, `.fm-item`, `.ctx-item`, `.x-btn`, `.picker-item`,
  JSG cover inputs, JSS tools were removed); busy = `aria-busy="true"` spinner, width kept, no pointer events (ConfirmModal and PromptModal
  set it); active = surface-pressed; focus-visible = 2px focus ring on segments, tabs, list rows; selected keeps the existing classes;
  `.btn-danger-solid` is now a real class (ConfirmModal no longer patches it with an inline style). Inputs get a 3:1 control edge
  (`--border-control`, WCAG 1.4.11). `src/styles/states.test.ts` evaluates the cascade of the real stylesheets with the token values of
  both themes: 17 controls x their states = 64 cells x 2 themes, each must exist, differ from the default and stay readable.
* UID-002: `Field` sets `aria-invalid` on its control when it has an error; the control gets a danger border and the message a "!" mark.
* DS-005: the shell `Modal` moves focus into the dialog (an autoFocus field keeps it), traps Tab, and returns focus to the trigger on close.
  Toasts have a Dismiss button, pause while hovered or focused, and an error stays 10 s (was 6 s); errors use `role="alert"`.
* UID-003: `components/FocusTooltip.tsx` shows the `title` of the control that has keyboard focus (`:focus-visible`) as a themed tooltip,
  hidden on blur, scroll or Escape. Titles stay (accessible names and `getByTitle` are unchanged); the project rail keeps its own labels.
* TH-006: `@media (forced-colors: active)` gives buttons, menus, cards, toasts and badges a system border, selected rows a Highlight
  outline, disabled controls GrayText, dots and the primary button `forced-color-adjust: none` with a ButtonText edge;
  `@media (prefers-contrast: more)` turns decorative borders into control borders and faint text into secondary text.
* TH-007: every semantic token has a dark value by construction (the build rejects a semantic entry without one; a test proves it).
* DS-006 / DS-007 (partly): density tokens (`--btn-h`, `--btn-h-sm`, `--input-h`, `--studio-input-h`, `--btn-pad-x`, `--row-pad-y`,
  `--table-pad-y`, `--page-pad`, `--card-pad`) with comfortable and compact values; the administrator "compact layout" switches them
  (`html.v2-compact` / `[data-density='compact']`). Comfortable values equal the old sizes. Font-size, radius, z-index and motion scales are
  tokens. Not done: the toolbar overflow behaviour and migrating every hard-coded size in the Studio ribbon (WP-21).
* DS-008: `tailwind.config.ts` deleted, `postcss.config.js` runs only autoprefixer (Tailwind generated nothing: no `@tailwind` anywhere).
  The `tailwindcss` devDependency is still in `package.json`; removing it needs a lock-file update, left to the lead.
* Fonts: the UI font (Arial/Segoe stack) is unchanged. The mono stack is the offline system stack `'Cascadia Code', 'Cascadia Mono',
  Consolas, 'Liberation Mono', 'Courier New', monospace` (JetBrains Mono, which was never bundled, is dropped).
* Intentional visual changes (everything else is meant to look as before in light):
  - faint/tertiary text a little darker in light (#646c7e -> #5d6475) and lighter in dark (#8590a2 -> #959eae);
  - warning text #b86b00 -> #a25e00, caution #c27c00 -> #a36800, the XML bracket colour #7a8294 -> #646b79 (light);
  - input borders darker (control edge #7e8595 light / #767c8a dark) - the most visible change;
  - dark: pressed surface #2c3a58 -> #27344f, success toast #25804f, info #79a8ff, document selection #8fb2ff, scrim 0.62, find-match
    and broken-link colours with dark variants, applicability colour #c4a3f5;
  - rail badge text uses the on-accent ink (dark text in dark theme); badges got `.bad/.warn/.ok` classes instead of inline colours;
  - PDF viewer accent #66ccff and its outline text on the viewer ink; ISPL preview notes and empty text white on the dark preview;
  - JSG chrome in light now uses the shared tokens (borders #cfd4da -> #d9dde6, navigator headings in the faint-text colour, find items in
    the shared colours); the JSG picture picker is a themed dialog on the scrim instead of inline styles; the JSS dialog uses the scrim token;
  - disabled controls show a grey surface and grey text instead of half-transparent; disabled cursor is not-allowed;
  - the administrator colour picker starts at the default accent #2456c9.
* Verified: `node scripts/tokens/build-tokens.mjs --check` ok; `check-contrast.mjs` 206 checks, 0 failing, coverage clean;
  `lint-colors.mjs` 0 (baseline 356); vitest `src/lib/accent.test.ts` 5/5, `src/styles/tokens/tokens.test.ts` 7/7 (including negative
  cases: a weakened token, a missing dark value, an undefined variable, five planted literals), `src/styles/states.test.ts` 131/131,
  `src/jsg/editor.test.ts` + `src/jsg/ispl-preview.test.ts` + `src/jss/editor.test.ts` 55/55; frontend and backend `tsc --noEmit` clean;
  `vite build` ok.
* Not run here: `e2e/zz-theme-states.spec.ts` (Playwright, both themes: computed states, JSG chrome in dark, modal focus trap and return,
  toast dismiss, theme choice, keyboard tooltip, accent repair and the server's 400 on a non-colour). It must be run by the single e2e
  runner (Edge). The full vitest run was not done (focused files only).
* Limits: the static matrix reads equal-specificity cascade in source order, not real selector specificity (the e2e spec covers the
  browser); the keyboard tooltip covers `title` on focusable elements only; the pdfmake print palette keeps literals by design.

## Phase 4 (taken early, in parallel with Phase 1B)

### WP-18 Frontend performance and delivery (FE-020, FE-027, FE-029, FE-030, FE-031, FE-032, FE-026, FE-033, PERF-016) - done, two parts left (see end)

* Compression and caching (FE-027, PERF-016), `services/delivery.ts`, Node's own zlib (no new dependency; nothing usable was in
  node_modules): API answers of 1 KB or more that go out through `res.send`/`res.json` and are JSON, text or XML are gzip for a client
  that accepts it (`Vary: Accept-Encoding`; ETag and 304 still work); files, streams and binary bodies are untouched. The built client:
  hashed `/assets/*` are `public, max-age=31536000, immutable`, `index.html` and the SPA fallback `no-cache`, every other file revalidates
  as before; text files of 1 KB or more go out brotli (or gzip), compressed once per file version on the thread pool and kept in a 128 MB
  memory cache; a Range request or a client that wants identity gets the plain file. Measured on the built client: initial load
  (theme-init, entry, react, CSS) 655,724 B on the wire before, 165,356 B after (brotli); the Studio chunk 862,011 B before, 245,398 B after.
* Server work at scale (PERF-016, FE-028 part), `services/fileMemo.ts`: a module's identity (list), the BREX it names (`/brex/missing`) and,
  for the dashboard display only, its content digest (release state on `/summary` and the oversight list) are kept per file and computed
  again when the file's size, mtime or ctime changes; decisions (submit, approve, build) still hash every file. `/summary` lists the modules
  once instead of three times (`explore`, `publicationSources` and the fingerprint take the list the route already read). At 500 modules,
  median of 5, same machine, same load, before / after: `/summary` 229 / 38 ms, `/brex/missing` 213 / 44 ms, `/dms` 89 / 35 ms,
  `/explore` 78 / 27 ms (the earlier, more loaded run: 759 / 300, 786 / 153, 441 / 141 ms). `/dms` 380,574 B becomes 8,874 B gzip.
* Opt-in paging (PERF-016), `services/paging.ts`: `GET /api/projects` and `GET /api/projects/:id/dms` take `limit` (1-1000), `offset` and
  `q`; `/dms` also `fields=list` (the slim row a list shows). Without them the answer is exactly the old one, so every caller keeps working
  (all current callers want the whole list and filter it themselves; the long-list cost on the page is handled by windowing below). First
  page: `/api/projects?limit=20` 10,643 B, `/dms?limit=50` 38,054 B identity (both far under 20 KB gzip).
* Query layer (FE-020), `frontend/src/api/query.ts`, used by every `get()`: identical GETs in flight share one request, an answer is reused
  for 300 ms (or the caller's `ttl`), every write through the client (and the importer's XMLHttpRequest uploads) drops every entry and every
  request in flight, a caller's AbortSignal cancels its wait and the shared request only when nobody waits; each caller gets its own copy.
  Navigation refreshes the session and the unread count with a 30 s reuse window (any write clears it; the minute heartbeat and the
  half-minute count still go to the server), so moving between pages asks `/api/auth/me` zero times and signing in asks it once.
* One save (FE-029): `PUT` plus `/summary`, `/media`, `/settings`, `/dms`, `/explore`, `/dms` (6 GETs) before; now `PUT` plus `/dms` (the
  Studio and the side list ask together; one request) and `/summary` = 2 GETs. Media and settings cannot change by a save; the publication
  tree is asked for again only when the save created a new module (`onSaved(created)`, `EditorSide` `treeKey`). Not measured in a
  browser here (no Playwright run allowed); the unit test simulates the two callers and `e2e/wp18-performance.spec.ts` B4 measures it.
* Long lists (FE-030), `frontend/src/components/windowing.tsx`: the editor's "All" list is virtualised (rows in view plus 12 each side,
  spacers for the rest: at most about 45 of 5,000 rows drawn); the chapter tree, the Projects table, the Validation findings, the
  Publication pool and the audit log draw their first 100 rows and more as the end comes into view (or "Show more" / "Show all"). Lists of
  up to 200 rows are drawn in full, as before, so the existing tests and small projects see no change. The audit filter asks the server
  300 ms after typing pauses, not per key.
* One copy of pdfmake (FE-031): pdfmake and its Roboto, Helvetica and Courier files are URL assets fetched and evaluated the way the bundle
  already was (`fonts.ts`), so the page and the PDF worker share one file each instead of a copy per graph; the unit tests keep the import
  path (removed from the build). `dist/assets` 31 files with 2 copies of each, now 26 with one (about 2.7 MB less); a Node check evaluated the
  built assets and printed a PDF. `chunkSizeWarningLimit` 1500 to 900 (no chunk is over it).
* One schema tree (FE-032): `frontend/public/schemas/{4-2,5-0,6,7}` (31 MB) were the server's `4.2`, `5.0`, `6.0`, `7.0` apart from line
  endings and one processing instruction (checked before removal); they are gone, the backend serves its own sets at `/schemas/<issue>/`
  (the Vite dev server proxies them), the Studio tests and `build-grammar.mjs` read them from `backend/schemas`. `4-1` and `ent` stay in the
  client because their content differs (recorded in `backend/schemas/PROVENANCE.md`; choosing one changes validation results). `dist` 63 MB
  to 32 MB. The packaged layout already ships `backend/schemas` (`package-windows.mjs`, the host's self-check), so the installer needs nothing new.
* Budgets (FE-026, FE-033): `frontend/scripts/check-bundle.mjs` (`npm run check:bundle` after a build) fails on initial JS + CSS over 180 KB
  gzip (now 178.0 KB), the Studio chunk over 300 KB gzip (263.7 KB) and a second copy of pdfmake or a font; the 30 KB entry-CSS budget is a
  warning (82.1 KB) until the Studio styles move (below). `e2e/wp18-performance.spec.ts` holds the browser probes with the audit's budgets:
  B1 initial wire bytes and headers, B2 `/auth/me` on sign-in and navigation, B4 GETs per save, B3 rows and nodes at 500 modules, B7 first-page size.
* Verified: `backend/test/wp18-delivery.test.js` 7/7 (compression and 304, immutable and no-cache headers, br/gzip/identity/Range/HEAD,
  path escape, the schema route serving the server's bytes and the removed folders staying removed, paging and slim rows with the default
  unchanged, the memo seeing a same-size edit, a changed BREX reference and a new file at once); `api` 17/17, `routes-guarded` 1/1,
  `release-issue` 1/1, `wp03-auth` 11/11, `phase13` 12/12, `phase17-security` 5/5. Frontend: `tsc` clean, `vite build`, vitest
  `api/query.test.ts` 9/9, `components/windowing.test.ts` 4/4 (found and fixed an empty window when scrolled past the end),
  `studio/__tests__/dmtypes` 178/178 (1 env-gated skip), `isoentities` 4/4, `extensions` 6/6, `lib`, `waivers`, `importRefusal` 29/29.
* Left: (1) the Studio stylesheets (58.7 KB of the 82 KB entry CSS) still load with the entry: they also define the app-wide tokens and
  resets, which WP-19 (design tokens) is rewriting; moving them belongs with it. (2) `e2e/wp18-performance.spec.ts` was written, not run
  (the lead's runner); the per-save and navigation counts above are by construction and unit test until it runs.
* Follow-up after the WP-18 + WP-19 merge (a6fc459), item (1) done. Merged, `check:bundle` failed: initial 186.6 KB gzip, entry CSS
  101.3 KB raw. Now: initial 122.0 KB gzip (budget 180), entry CSS 59.3 KB raw, Studio chunk 264.0 KB gzip (budget 300).
  - The app-wide head of `studio/styles/app.css` (resets, body, buttons, fields, modal dialogs, spinner and `@keyframes spin`, which
    states.css uses, reduced motion, the print body rule, the `.x-table` margin used by two platform pages) is `styles/base.css` in the
    entry. `app.css` and `document.css` load with the Studio editor (`studio/styles/load.ts`, from `EditorRoute`) as `?url` links put
    AHEAD of the entry sheets, so the cascade is the old one (platform.css and states.css override Studio rules by coming later). Only
    base.css moved relative to them; two rules that beat a base rule by order alone are restated one step more specific (end of app.css).
    states.test.ts reads the sheets in the new cascade order. The JSS/JSG editors and the platform pages use only base.css classes (grep).
  - Pages a session does not start on (Settings, Administrator, Backup, Activity, Notifications, Graphics, CIR, the preview window,
    the project Explore/Publication/Validation/Graphics/Ancillary/Release/Settings pages) are lazy routes: entry JS 368.7 -> 148.7 KB.
  - Entry CSS is still over 30 KB (tokens.css for both themes, platform.css whole); the CSS budget stays advisory. Splitting platform.css
    per page changes its cascade and was not done.
  - Regression fixed (e2e 00-platform "the saved publication hierarchy shows in the left panel"): with the progressive tree, collapsing
    the only open chapter made the row total, and so the draw limit, 0, and the chapter itself was skipped, so the tree vanished. The
    layout is now `pages/project/editor/publicationTree.ts`, which counts down only when the limit cuts rows;
    `publicationTree.test.ts` (5) failed 2/5 on the old logic and passes.

### Environment notes

* `pdfinfo` and `pdfimages` (poppler) are not installed on this machine; only `pdftotext` is. Four existing print tests need them
  (`jsg-engine` "a new User Handbook prints the stencil", `jsg-word` two sample tests, `jss-authoring` "default artwork") and fail at that
  call, after their FO assertions pass. Recorded for WP-08: the CI gate declares and checks its tools. (Resolved by WP-08: no test needs
  poppler or xpdf any more; the four tests pass.)

## Phase 1B

### WP-08 Offline quality gate: CI, deterministic tests, tool provisioning (QA-001, QA-002, QA-003, QA-007, QA-010, QA-011, QA-014, QA-015, QA-017, QA-018, QA-019, QA-022, UX-011, ARC-023, ARC-014, PLT-026, RES-011, GAP-007) - done in part (see limits)

* QA-003 (`backend/test/pdftools.js`): one PDF reader for the tests, built on the pdf.js already in `frontend/node_modules` (found the way
  `services/importer/recover/pdfjs.ts` finds it, or `AGASTYA_PDFJS_DIR`). `readPdf(file|buffer)` gives `pageCount`, `pageSize(n)`,
  `text({first,last,mode})` (modes `layout` like `pdftotext -layout`, `plain`, `raw` like `-raw`; pages end with `\f`) and, with
  `{ images: true }`, `imageCount(n?)` = pictures painted (was `pdfimages -list`). Parsed once per buffer/file. All 17 backend files that
  spawned `pdftotext`/`pdfinfo`/`pdfimages` use it (`applic-publish`, `dmtypes`, `jsg-engine`, `jsg-word`, `jss-authoring`,
  `jss-change-notice`, `jss-cover-foot`, `jss-cover-isolation`, `jss-naval`, `jss-stencil-corrections`, `object-docs`, `pdf-furniture`,
  `pdf-long-doctype`, `pdf-multi-ipd`, `pdf-reference`, `pdf21`, `wp02-routes`), and so does the e2e `jss-editor.spec.ts`, whose two PDF
  checks were silently skipped whenever pdftotext was missing (`if (!t.error)`). One extractor on every machine: the xpdf/poppler difference
  of QA-003 is gone. `pdf-furniture`'s fallback (count `/Subtype /Image` in the file bytes) is replaced by the painted-picture count, which is
  stronger. No test spawns a PDF program any more (`grep -rn "'pdftotext'\|'pdfinfo'\|'pdfimages'" backend/test frontend/e2e`: none);
  `backend/scripts/sample-compare.js` and `extract-sns-presets.js` (developer tools, not tests) still need poppler and say so.
* Canary (`backend/test/tools-canary.test.js`, first stage of the gate): dist built and not older than src; pdf.js reads a vendored PDF (page
  count, size, text, pictures); Java starts (bundled JRE or `JSS_JAVA`) and FOP's folders exist; xsltproc starts; xmllint-wasm validates;
  Liberation Sans present (Arial reported). Each failure names the tool, where it looked and how to provide it; the versions are printed
  and land in the evidence (`meta.json`). Shown: `JSS_JAVA=C:/nope/java.exe` gives `not ok 3 - Java runs ... 'Java could not be started as
  "C:/nope/java.exe" (ENOENT). The bundled JRE belongs at ...\vendor\tools\jre\bin; set JSS_JAVA to use another.'`, the others pass.
* QA-001 / QA-017 / QA-019 (`scripts/ci/gate.mjs`, `test-plan.json`, `skip-budget.json`, `.github/workflows/gate.yml`, root scripts
  `npm run gate | gate:nightly | gate:release | lint | readiness`): the pipeline as a repository script. Stages build -> frontend-build ->
  typecheck -> lint -> tools -> security -> backend -> pdf-smoke -> backend-heavy -> frontend -> frontend-verify -> e2e -> package ->
  readiness; profiles pr / nightly / release. Every backend file runs in its own `node --test` process with a default per-test limit
  (15 min unless the test sets one) and a wall limit per file (20 min; 60 min for the heavy shard), after which the process tree is killed
  and reported TIMEOUT; an exit with 0xC0000005 (or another native status) is reported as NATIVE CRASH with its file; nothing is retried.
  The heavy shard (`pdf21`, `brex-gate`, `publish-gate`, `dmtypes`, `golden-xignal`, `jss-naval`, `jss-stencil-corrections`,
  `pdf-reference`, `wp32-validation-scale`, `jsg-word`, `jss-authoring`) runs one file at a time. Evidence per run
  (`verification-results/ci/<time>-<commit>/`, git-ignored): commit and dirty flag, Node, OS, tool versions, one TAP file per test file,
  vitest/Playwright junit, `skips.json`, `summary.json`, `summary.md`. The workflow file runs the same script on a self-hosted Windows runner
  (offline `npm ci`, evidence uploaded); `scripts/ci/hooks/pre-push` is a quick local gate (not installed: `git config core.hooksPath
  scripts/ci/hooks` in a checkout that wants it). `backend npm test` now builds (`pretest: tsc`) and runs the gate's backend stages; the old
  all-parallel run is `npm run test:parallel`. `backend/scripts/test-verify.js` runs its three heavy files with `--test-concurrency=1`.
* QA-007 (skip policy): the gate reads every `# SKIP` from the TAP output and fails when a skip has no reason, when a file not in
  `scripts/ci/skip-budget.json` skips, or when a file skips more than its budget. The budget (16 files, 46 on a clean checkout without the
  customer material; Windows-only tests on other platforms) is counted from the skip sites; every skip is listed with its reason in
  `summary.md`. The skips that had no reason now carry one (importer-scan 3, importer-structure 6, importer-repairs 1, jss-rwi 4).
  Not done: synthetic stand-ins for the customer material (decision D10); the customer suites still run only where the material is.
* QA-002: vitest `testTimeout`/`hookTimeout` 30 s (`frontend/vite.config.ts`). The heavy verification suites (`rules`, `controls`, `editor`,
  `editor-controls`, `elements`, `brex-parity`, `brex-xpath`) are left out of a bare `vitest run` unless `AGASTYA_VERIFY=1`; `npm run
  test:verify` (`frontend/scripts/run-verify.mjs`) runs them one file at a time, `scripts/verify-elements.mjs` sets the variable. This
  answers the lead's full-vitest run of 2026-11-27 (5 s timeouts in `naval.test.ts` and `objects.test.ts`, and a tinypool worker lost,
  "onUnexpectedExit", during `controls`, `brex-xpath`, `editor-controls`): those heavy files ran in the parallel pool beside everything
  else. `publish-gate.test.js`: the one 21-type test with a 600 s limit is a setup test plus one test per type (120 s each), same checks.
* QA-010: `helpers.boot().close()` closes the database and removes the workspace; `helpers.tmp(prefix)` makes a folder that is removed when
  the file's process ends (37 `mkdtempSync` sites in 25 files moved to it, and the local `tmp()` of 4 more; 13 files without the helpers import keep theirs). The per-file
  PDF temp files of the PDF tests are gone (pdf.js reads the buffer). The gate gives every test process its own TEMP/TMP under a gate
  folder and counts what is left. `AGASTYA_TEST_RESULTS` (gate: the evidence folder) receives the result tables that went into
  `frontend/verification-results` (backend `publish-gate`, `brex-gate`, `dmtypes`, `pdf21`, `pdf-reference`; frontend `verify/lib.ts`;
  `scripts/verify-report.mjs` reads it); the default is unchanged so the report keeps working. `AGASTYA_KEEP_TEMP=1` keeps everything.
* QA-015: `helpers.boot()` refuses to start when a `src/*.ts` is newer than `dist/app.js` ("rebuild with `npx tsc -p .`"); the canary
  checks the same; `pretest: tsc`.
* QA-011 / QA-022 / UX-011 / GAP-007 (`frontend/playwright.config.ts`): port from `E2E_PORT` (default 4050) for the base URL, the health
  URL and the server (`PORT` passed to `serve.mjs`); output folder `test-results-<port>` off 4050; a lock file per port
  (`%TEMP%/agastya-e2e-<port>.lock`) refuses a second runner on the same port with the holder's pid; default browser `msedge` (D18, Chrome
  with `E2E_CHANNEL=chrome`); junit via `E2E_JUNIT`. The stale "SNS defaults" assertion is the lead's fix in the main checkout (not
  touched here). Not done: per-worker servers, a crash-labelling fixture (`page.on('crash')`), the Chrome crash root cause (UX-011 stays
  open; the reference browser is Edge).
* QA-014 / ARC-023: one `DM21` constant in `helpers.js` for the 21-type fixtures (every such path, in 30 files), so moving them is one line; the
  fixtures still live under `frontend/e2e/fixtures/dm21` (not moved: the e2e suite reads them too). Paths that left the repository now need
  an environment variable: `jss-naval` (`NAVAL_STENCILS`, default `manual format/NAval_stencil`, was `../../../Sampels/NAval_stencil`),
  `importer-repairs`/`importer-scan` (`VEKTRA_SAMPLE`, default `SAMPLE PROJECTS/RWI`, was `../RWI`), `jss-rwi-verify` (`RWI_ZIP`; the
  Downloads folder is no longer searched). On the owner's machine those tests now skip, with the reason, until the material is placed there
  or the variable is set. Phase-named files (`phase13`, `phase17-security`, `pdf21`) are not renamed.
* QA-018: `catalog-race-concurrent` asserts that the catalogue exists instead of passing with no assertion; `jsg-word` ISPL checked
  `!includes('C E R T I F I C A T E')` after a helper that joins letter-spaced titles, so it could never fail: it checks `CERTIFICATE`;
  `jss-naval` collapsed `/s+/g` (the letter s) instead of `/\s+/g` before checking that two pages are absent. Not done: font embedding via
  a font list (the substring check of `jss-stencil-corrections:80` stays), baseline-review rule.
* ARC-014 (`scripts/ci/lint.mjs`, `lint-baseline.json`): no dependency (no ESLint is installed and the gate is offline). Hard rules: no
  `.only(` in any test, no `debugger`. Ratchets: explicit `any` backend 280 / frontend 50, `require(` in TypeScript backend 48 / frontend 4;
  growth fails. Not done: a real ESLint set (`react-hooks/exhaustive-deps`).
* RES-011 (`scripts/ci/readiness.mjs`, read-only): G-SEC-5 route guard (runs `routes-guarded.test.js`), G-SEC-5b audit coverage (NOT RUN: no
  such test yet), QA-001 artefact commit (`release/BUILD-INFO.json`, now written by `package-windows.mjs` with the commit, dirty flag and
  artefact hashes; `version.json` in the package carries the commit too), G-SEC-11a Authenticode, G-SEC-11b Node end-of-life margin, RES-005
  SBOM, G-SEC-6 ACL of an installed copy and G-DEP-6 doctor (`--install DIR`), G-OFF-2 (NOT RUN: not automated). Exit non-zero on FAIL and on
  NOT RUN unless `--allow-not-run`; `readiness.md/json` in the evidence. Today: G-SEC-5 PASS; **G-SEC-11b FAIL: Node 22 reaches end of life
  on 2027-04-30, 5.1 months from now** (input to the runtime decision of WP-13); seven NOT RUN (no release folder or installed copy here).
* QA-019 (the native crash): not reproduced and not fixed. What changed: no gate stage runs the heavy files in parallel any more, each file
  is its own process, a crash is reported with the file and its status instead of a silent cancellation, and a hang ends at the file limit.
  Hypothesis worth testing on the runner (not measured): since WP-32 a schema batch asks for WebAssembly memory sized to the batch (up to
  4 GiB), so parallel heavy files can commit far more memory than before; the 2026-11-23 investigation already saw 69 MB free at one crash.
  The 50-run soak of the recommendation needs the machine alone.
* Clean-checkout failures found by the gate itself: `xml-guard` "every XML ... shipped in the repository" required more than 500 files,
  a number reached only with the git-ignored customer material (272 here); it now requires every git-tracked XML/DTD/ENT file to be
  scanned (stronger: a file the walk misses fails it). `wp03-auth` "security headers" reads the served client's CSP and fails without
  `frontend/dist` (the API answers `default-src 'none'`); the pr profile therefore builds the frontend before the security stage.
* PLT-026: not addressed here (platform-core regression tests are WP-09 work).
* Verified (each file alone, `--test-concurrency=1`, this machine shared with two other agents): `jsg-engine` 7/7 (was 6/7, TypeError at
  `pdfinfo`), `jsg-word` 3/3 (the sample test reached `pdfinfo` and failed), `jss-authoring` 12/12 + 1 skip (stencils absent; "default
  artwork" failed at `pdfimages`); gate run 1 (`tools,lint,pdf-smoke`, 9 PDF files): 11/11 steps green, 0 skips, 13 temp entries left (the
  test files' own temp folders, since moved to `helpers.tmp`); vitest `naval.test.ts` + `verify/objects.test.ts` 34/34 in 41 s; a bare
  `vitest run` of `brex-xpath.test.ts` reports it excluded; frontend `tsc --noEmit` 0 errors; backend `tsc` 0 errors; lint green.
  A wider run found three failures (the two clean-checkout ones above and a helpers import inside a function in `wp07-jsg-deep-path`,
  introduced by the `tmp` change, fixed). Then three consecutive gate runs of the same 40 files (build + frontend-build in the first; lint,
  tools, security 9 files, pdf-smoke 9, backend 21), `--jobs 2`: each 221 tests, 206 pass, 15 skips (all with reasons, within the budget),
  0 fail, about 7 minutes each; 9-10 temporary entries left per run, all written by the product or the JVM (`agastya-uploads`,
  `jss-fop-warmup.pdf`, `jsspub-s1000d-catalog.xml`, `hsperfdata_*`, `imageio*.tmp`) or by two files without the helpers import
  (`wp04-reset-admin`, `deep-workspace`'s padding folder); no `agastya-v2-test-*` workspace. Skip policy shown failing: a budget without
  `jss-rwi` and with `importer-scan` at 2 gives "jss-rwi.test.js: 4 skip(s) but the file has no entry" and "importer-scan.test.js: 3 skips,
  the budget allows 2", gate FAILED.
  Heavy shard, one file at a time (customer stencils via `NAVAL_STENCILS` and the main checkout's `manual format`, read only): `pdf21` 8/8
  (577 s), `publish-gate` 24/24 in its new per-type form (634 s, 25-47 s per type), `dmtypes` 32/32, `jss-naval` 26/26,
  `jss-stencil-corrections` 15/15, 0 skips: the pdf.js conversions of these files and the two QA-018 fixes hold on the real material.
  Not run here: `pdf-reference`, `golden-xignal`, `brex-gate`, `wp32-validation-scale`.
* Limits: a full backend, vitest and e2e run of this branch is still to do (the lead's machine time); the three consecutive full runs of
  G-Q-5 therefore stand for the subsets above only. The `layout` text of pdf.js is close to `pdftotext -layout` but not identical (column
  spacing is estimated from glyph widths); the converted tests passed unchanged in their assertions, except where noted above.

## Phase 5

### WP-34 Feature-preservation baseline and parity harness (GAP-009) - done (machine part); the checklist rows are filled per batch

* Generators moved into `frontend/scripts/parity/` (written afresh; the audit's scratchpad `baseline.js` / `analyse.js` were not in the
  repository): `scan.mjs` (static: routes of `App.tsx` and the three nested route files, with permission condition and page/redirect in
  the key, `REFERENCE.map` expanded; every `data-testid` in all of `src/` in its four literal forms, computed ones counted per file; browser
  test titles, unit and backend test files; the keys compared in the editors' own keydown handlers), `diff.mjs` (baseline vs current,
  explanations), `check.mjs` (CLI). A file that declares `<Route>` and is not in `ROUTE_MOUNTS` fails the scan, so no routes go unseen.
* Run-time dump: `src/parity/surface.ts` + `parity-dump.test.ts` call `buildCommands()` and `RIBBON` (so the five generator sites are
  expanded), the rail per kind and the shortcut registries. `check.mjs` runs that test with `PARITY_DUMP=<file>`; in the everyday vitest
  run the same test compares commands, rail and registry keys with the baseline itself, checks every ribbon id names a command and that no
  accelerator is bound twice. No browser needed (the risk named in the roadmap for the run-time dump does not apply).
* The rail moved into a pure function `layouts/projectRail.ts` (`projectRailItems`), rendered unchanged by `ProjectShell` (the unused
  `jsgUhb` local went with it).
* JSS/JSG shortcut registry (none existed): `src/lib/editorShortcuts.ts`, 25 entries (JSS 13, JSG 11, ISPL 1) with keys, action, where
  and file. `editorShortcuts.test.ts` holds it to the handlers: the key names compared in each of `jss/editor.ts`, `jss/dom.ts`,
  `jsg/editor.ts`, `jsg/shared.ts`, `jsg/ispl-editor.ts` must equal the registry's for that file. The handlers were not changed.
* Baseline `docs/audit/baseline/parity-baseline.json` (generated, at 7eb0160 + this package): routes 72 (58 pages, 14 redirects), rail 23
  (S1000D 7, JSS 7, JSG 7, CIR 2), commands 113, keys 125 (Studio 58 accelerators on 57 commands, JSS 14, JSG 13, ISPL 1, handler-scan 39),
  testids 372, tests 275 (e2e 139 in 17 specs, unit 39, backend 97). Explanations `parity-explanations.json` (empty). Removals fail unless
  explained row by row (category, key, reason, newHome, checklistRow, decision, batch, date); additions are listed and never fail;
  `parity:update` refuses while a removal is unexplained.
* Screens the owner removed before the baseline (CSDB page, the second SNS screen, Brand pack screen, applicability UI, Codes strip and
  button, PMC/ICN/contents switches) are in `removedByOwner`, not present features: their old addresses are redirects, and the check fails
  if one becomes a page again, its redirect disappears, or the browser test guarding its absence is gone.
* Gate: new `parity` stage after `lint` in all three profiles (report `parity.md` in the evidence), in the pre-push hook, and
  `npm run check:parity` / `parity:update` / `parity:scan` (frontend) plus `check:parity` at the root.
* Checklist `docs/audit/baseline/CHECKLIST.md` (18 screen groups of 16 section 5.4, old control with its baseline ids, new home, guarding
  test, sign-off, and a batch log); walk-through `WALKTHROUGH.md` (the ten checks of 5.5 plus the before/after results table).
* Counts against the audit's text scan (457440f): routes 25 declarations in `App.tsx` = 24 routes + 1 pathless layout route; the 48 others
  are the nested `<Routes>` of Administrator (28, 11 of them from `REFERENCE.map`), Settings (9) and project settings (11), which the audit
  did not count. Rail: 10 source lines vs 23 rendered items over four kinds. Commands: 87 literal + 26 generated (emphasis 5, table 10,
  cell align 4, valign 3, views 4) = 113. Test ids: the audit's method (`data-testid="..."` in `.tsx` under components/layouts/pages) gives
  373 in 61 files at 7eb0160 (337 in 58 at 457440f: the ids added by WP-03, 05, 07, 18, 19); the baseline's 372 is the number of distinct
  values over all of `src/` in all literal forms. Tests: 118 blocks in 13 specs then, 139 in 17 now (four new specs since); unit 30 -> 39
  (36 + three of this package); backend 83 -> 97.
* Verified: `npx tsc --noEmit -p .` 0 errors; `npx vitest run src/parity src/lib/editorShortcuts.test.ts` 17/17; `check:parity` PASS;
  negative run: a command and a rail item added to a copy of the baseline gave "2 unexplained removal(s)", exit 1, and the vitest dump test
  failed the same way; restored, PASS. `scripts/ci/lint.mjs`: all ratchets green except `any.backend` 282 vs 280, which this package does
  not touch (backend unchanged; it was already so at 7eb0160). Not run: the gate, the full vitest, Playwright, the backend suite.
* Left: the "New home" and "Sign-off" columns are filled by each redesign batch (WP-21, WP-22, WP-35); the before column of the results
  table needs a full run on Edge (D18); 145 test ids are named by no browser spec (`info.testidsWithoutBrowserTest`), the guard gaps a batch
  must close or record; computed test ids are counted, not listed.
### WP-09 Authorisation matrix and hostile-input test suites (QA-004, QA-005, ARC-016, QA-021, QA-023, QA-016) - done, the e2e part not run (see limits)

Branch `wp09-authz-matrix` (from 7eb0160).

* QA-004 / ARC-016 (`backend/test/authz-matrix.test.js`, `test/fixtures/authz-policy.snapshot.json`, `test/fixtures/authz-allow.json`): the
  role x route matrix is generated from the app itself. The Express router is walked and each route's guard chain is read from the markers in
  `core/auth/authz.js`. Every layer registered for the same method and path counts as one route. Each guard is called in-process for
  11 principals: anonymous, onboarding-gated, password-change-gated, author, PM, admin, and project viewer / reviewer / editor / manager /
  owner. The parameters come from `Layer.match()`, exactly as Express sets them. The result is one row per route (about 280 routes),
  compared with the committed snapshot. A change to any route's policy fails the test until the snapshot is regenerated
  (`AGASTYA_UPDATE_AUTHZ_SNAPSHOT=1`) and reviewed in the diff. Rules checked for every route:
  - no parameter name is repeated;
  - anonymous gets 401;
  - only the listed exits get past the onboarding and password-change gates;
  - an admin passes;
  - a non-member gets the uniform 404;
  - the member ladder is monotone;
  - a write at viewer level or with sign-in only needs a reason in `authz-allow.json` (7 viewer-level and 21 sign-in-only writes are listed
    with reasons).
  Over HTTP, on a booted server:
  - anonymous gets 401 on every non-public route;
  - a non-member gets 404 on every project route;
  - one role below the minimum gets the guard's 403 (more than 150 routes);
  - the minimum role passes the guard on every GET.
  Last, every route must be referenced by another backend test, e2e spec or script, or be listed with a reason. That list is empty now:
  every route is referenced, and a stale entry fails. Mutation check: changing the waivers DELETE guard from editor to viewer (in dist)
  made tests 1 and 2 fail.
* Defects found and fixed, each with a test:
  1. `GET /api/projects/:id/packages/import-reports/:id` repeated `:id`. Express gave the report id to the project guard, so the route
     answered 404 to everyone. It is now `:reportId` (`routes/packages.ts`), asserted in `packages.test.js` (200 with items; 404 for a
     non-member). The matrix rule "no repeated parameter name" keeps it from coming back.
  2. Security: with the single-session policy off, a password change and onboarding left the account's other sessions alive. `issue()`
     displaces only under single-session. Both handlers in `core/auth/routes.js` now end every other session first, with the new reason
     `password-changed` (`authz.js` END_MESSAGES: SESSION_REVOKED, "...the password of this account was changed"). Asserted in
     `auth-http.test.js`.
  3. The SNS preset JSON written by the export route could not be imported back (`services/sns.ts` parseImport). The
     `{format:'agastya-sns-preset', nodes:[{path,title}]}` form is now accepted, with the depth check. Round trip asserted in
     `admin-ops.test.js`.
  4. QA-021 / PUB-008: a conversion from S1000D dropped the ICN artwork that the product keeps beside the data modules (`csdb/`).
     `zipOfS1000dProject` packed `csdb/` with `/\.xml$/` only; it now also takes `^ICN-` files (`services/xengine/convert.ts`).
  The matrix found no role-level authorisation defect: every HTTP boundary matched the declared policy.
* QA-005 (suites for the auth core and the hostile edges):
  - `auth-core.test.js` (unit, no server):
    - RateLimiter with an injected clock: window, Retry-After, per-account limit across IPs, per-IP limit, persistence.
    - SessionService on an in-memory AuthStore: cookie attributes, idle and absolute expiry with their reasons, displacement,
      multi-session, revoke, disabled account.
    - Also the password policy, usernames and temporary passwords, checkGrant, hashing (argon2 or scrypt, plus the scrypt fallback
      format) and originAllowed.
  - `auth-http.test.js`:
    - cookie flags, and Secure behind `x-forwarded-proto`;
    - logout kills the session on the server;
    - a password change or onboarding ends the other sessions;
    - disable and enable; the last admin cannot be disabled (409);
    - admin reset, both kinds;
    - session list and revoke;
    - the audit is admin-only, with paging, the action-prefix filter and CSV;
    - cross-origin writes, sign-in included, get 403;
    - forgot answers a neutral 202, the reset queue can be approved and rejected, and the shared limit gives 429;
    - CSV user import is all or nothing.
  - WebSocket harness: `boot({ ws: true })` in `test/helpers.js` attaches the real broadcaster and returns `socket(client, { origin,
    headers, path })` with `messages`, `waitFor()` and `closed`. `ws-broadcast.test.js`:
    - an upgrade without a cookie or with a forged one gets 401; another origin gets 403; another path is refused;
    - messages are filtered per project (owner, viewer and admin receive; the member of another project does not);
    - a real build broadcast reaches members only;
    - a member who is removed stops receiving at once and receives again when re-added;
    - a 4401 close on logout, on displacement and on admin revoke; the 401 on reconnect carries `X-Session-Ended: admin-revoked`.
  - `admin-ops.test.js` exercises the routes that no test called before: ownership governance, approvals and release queues (unknown ids
    give 404), oversight, folders and folder access grants, invitations decline and withdraw, DM history, lock and open, publish status,
    preset export, import and duplicate, SNS export and import, BREX import preview, waivers, JSG schema, and editing and resetting an
    ancillary page.
* QA-021 (`backend/test/xengine-pictures.test.js`):
  - S1000D to JSS and to JSG on the sample project: every picture the source documents refer to arrives with the same SHA-256, and every
    picture reference of the converted document resolves to a file.
  - JSS to S1000D and to JSG: a figure's PNG in `Media/` arrives byte for byte, and the reference resolves.
  - Before the convert.ts fix the S1000D to JSS case failed: `csdb/ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg` was lost.
* QA-016 (frontend component tests in jsdom; no new dependency):
  - `vite.config.ts` now includes `src/**/*.test.tsx`.
  - `src/testing/render.tsx` is a small harness built on react-dom/client and act (`render`, `$`, `button`, `field` by label, `type`,
    `click`, `key`, `settle`, `cleanup`).
  - `components/ui.test.tsx` covers:
    - Modal: role and label; Escape, the close button and a backdrop click close it, sticky ignores the backdrop; focus goes in and comes
      back; the Tab trap;
    - ConfirmModal: busy state and the danger style;
    - PromptModal: trimmed submit, a refusal shown as an alert with aria-invalid, Enter submits;
    - Field: label and hint wiring;
    - Toasts: at most four, dismiss, 3.2 s and 10 s.
  - `pages/AuthScreens.test.tsx` covers the sign-in, forgot-password, first-run, onboarding and forced-change forms: what is sent, a
    password mismatch is refused without calling the server, server refusals are shown, the signed-out reason is shown.
  - `store/stores.test.ts` covers:
    - the session state machine: authed and gated; a 401 when nobody is signed in leads to anon or setup with the reason; a 401 while
      working opens the re-login dialog; an unreachable server shows the banner and retries; the background check; logout, its listeners
      and the inbox reset; another user on the same page; resume and abandon;
    - theme and toasts in the UI store;
    - the inbox store.
  - Defect fixed: `Field` pointed its label at the generated id even when the control had its own `id`, so the label named nothing
    (`components/ui.tsx`).
* QA-023 (`frontend/e2e/zz-layout-strict.spec.ts`, new; `zz-responsive-layout.spec.ts` untouched):
  - No overflow excuse: a visible control must lie inside the viewport and inside every `overflow: hidden|clip` ancestor, unless a
    scrolling box lets the person reach it.
  - Widths 1024, 1280, 1366, 1440 and 1920 px, on 9 screens. The primary action (New project) must be visible and inside the viewport.
    A script error on the page is always a failure.
  - Report-only by default (findings are attached as annotations and printed); `E2E_LAYOUT_STRICT=1` makes every finding a failure.
* `scripts/ci/test-plan.json`: `authz-matrix`, `auth-core`, `auth-http`, `ws-broadcast` and `admin-ops` are in the security stage.
  `xengine-pictures` runs in the default backend stage.

Tests run (backend one file at a time after `npx tsc -p .`; frontend per file):

| Test | Result |
| --- | --- |
| `authz-matrix` | 6/6 (re-run after the last change) |
| `auth-core` | 11/11 |
| `auth-http` | 10/10 |
| `ws-broadcast` | 5/5 |
| `admin-ops` | 8/8 |
| `packages` | 10/10 |
| `xengine-pictures` | 2/2 (1 of 2 failed before the fix) |
| `xengine-convert` | 7/7 |
| `phase17-security` | 5/5 |
| `wp03-auth` | 10/11. The failure is "security headers", the known clean-checkout failure: `frontend/dist` is missing in the worktree (see WP-08). |
| vitest `components/ui.test.tsx` | 10/10 |
| vitest `pages/AuthScreens.test.tsx` | 6/6 |
| vitest `store/stores.test.ts` | 11/11 |

`npx tsc --noEmit -p .` (frontend) is clean, and the e2e spec type-checks on its own.

Limits / open:

* Not run, as instructed: Playwright (so `zz-layout-strict.spec.ts` has never run; its first report decides when the gate sets
  `E2E_LAYOUT_STRICT=1`), the full backend suite, full vitest and the gate. The lead should run them; the Field label change touches every
  form.
* Lint ratchet: `any.backend` reads 282 against the baseline of 280. The +2 is already present at 7eb0160; this WP adds none (the
  counts in `sns.ts` and `packages.ts` are unchanged).
* Seen, not changed: in `core/auth/policy.js` the product word `s1000d` in PRODUCT_WORDS can never match, because the comparison strips
  digits first.
* The approval and pending-project paths of the admin queues were exercised only with unknown ids (404), not with a real pending project.
  The finer checks inside the folder and CIR handlers are covered by the matrix at guard level only.
* Owner blessing wanted: the 7 viewer-level writes and the 21 sign-in-only writes in `authz-allow.json` are recorded as intended, each with a
  reason (open, copy, convert, the publish plan, the delivery package, JSS and JSG validate; sign-out, activity, password change, onboarding, invitations, folders, creating and importing projects,
  notifications, CIR, S1000D config validation; folder and CIR handlers check ownership themselves). The audit's recommendation was taken; the owner can strike any of them, and the test will then demand the guard.
## Phase 2

### WP-10 Explicit application context and storage/auth seams (PLT-028, PLT-030, PLT-031, PLT-032, ARC-006, PLT-027, PRD-002; ARC-017 not done) - done in part (see limits)

Decisions taken from the audit (no owner question): `context.ts` stays as a compatibility facade so the importing modules do not change;
the 109-method `AuthStore` is not put behind an interface (03 section 6); the storage seam is dialect-clean now and the PostgreSQL adapter
waits for a D21 trigger (WP-37); migrations stay additive and keep their names and order; behaviour is unchanged unless stated below.

* **Config (PLT-032).** `config.ts` builds one typed, validated `Config` with `buildConfig(env)` (pure; `config` = the process's, built once
  at first load, as the test harness expects). It is the only module under `src/` that reads `process.env`: `index.ts` (workspace lock,
  stdin shutdown, first-run administrator), `services/origin.ts` (dev origins), `services/uploads.ts` and `services/packages.ts` (upload,
  timeout and expanded-size limits), `services/importer/recover/pdfjs.ts` and `core/auth/bootstrap.js` (its `env` now comes from the
  caller) read the configuration. An invalid `PORT` stops with `PORT: ...` (`ConfigError`); `describeConfig` prints it without secrets.
  `envPositive` moved to `config.ts` and is re-exported by `uploads.ts`. `AGASTYA_MAX_EXPANDED_BYTES` is now read once at start, like the
  other limits (it was read per import). Outside `src/`: the vendored engine (`vendor/engine/paths.js` `JSS_JAVA`, `JSS_GS`, the allow-listed
  child environment; `catalog.js` `XML_CATALOG_FILES`) and the operator scripts keep their own reads (vendored code / separate tools).
* **AppContext (PLT-028).** `appContext.ts` `createAppContext(config, overrides)` builds what `context.ts` built at import (workspace
  skeleton and templates, database handle, `AuthStore`, sessions, throttle, security policy, authz, document index, revisions, the audit
  writer with its own failure counter) plus the seams below; `start()` takes the pre-migration snapshot and runs the migrations, so a
  migration error is an error of `start()` (tested); `close()` checkpoints and closes. `context.ts` builds the default context, starts it
  at import exactly as before and re-exports the same names plus `defaultContext()`, `repos`, `content`, `authProvider`.
  `storage/sqlite.ts` `openSqlite` returns a new handle per call (same file, pragmas and registry tables as `vendor/engine/db.js`, whose
  module-wide handle made a second context impossible); the registry methods moved to `repositories/projectRegistry.ts` bound to that
  handle. `vendor/engine/db.js` stays for `scripts/reset-admin.js`. Two contexts on two workspaces run in one test process without seeing
  each other's users, registry rows, content or audit rows.
* **Seams.** `ContentStore` (`storage/contentStore.ts`, default `LocalFolderStore`, paths confined to the project folder): project.json
  (`services/projectRecord.ts`), data-module read/save/create/delete (`csdb.ts`), the JSS and JSG document read/save (`jss/service.ts`,
  `jsg/service.ts`). Writes are plain writes as before; WP-11 makes them atomic and revisioned in this one place. `SessionStore` and
  `LimiterStore` (`storage/authStores.ts`) name what `sessions.js` and `rateLimit.js` use; defaults are the `AuthStore` tables;
  `MemoryLimiterStore` is the in-process alternative. `AuthProvider` (`core/auth/provider.js`, local accounts by default): the login route
  authenticates through it with the same steps (own password, master credential only after it failed, disabled refused, dummy work for an
  unknown name; same audit rows). `provisionUser` refuses for local accounts (directory sign-on is WP-27, D5).
* **Import cycle (ARC-006).** The 8-module cycle (`csdb`, `projectConfig`, `projects`, `sns`, `jss/native`, `jss/service`, `jsg/service`,
  `xengine/project`) is gone: the project record functions moved to the leaf `services/projectRecord.ts`, the read-only CSDB index to
  `services/csdbIndex.ts` (`projects.ts` and `csdb.ts` re-export them), and `createProject` asks `services/documentCreators.ts` for the JSS or
  JSG creator, which each engine registers when it loads (`app.ts` loads both explicitly), instead of `require()`-ing them; the lazy
  `require('../context')` in `createProject` is an import. Runtime cycle count over the compiled tree: 0 (tested; requires inside functions
  are counted). Lazy requires that are not cycles remain in `activity.ts`, `assets.ts`, `cir.ts`, `sample.ts`.
* **Dialect-clean storage (PRD-002, PLT-030).** Every statement that sat in services and routes moved into `src/repositories/` behind
  interfaces (`Repositories`: `registry`, `sns`, `projectConfig`, `reference`, `cirLinks`, `lifecycle`, `extensions`, `activity`, a
  `transaction()` unit of work and `ping()`), SQL text unchanged: `sns.ts` (37 sites), `s1000dRef.ts` (21), `projectConfig.ts` (15),
  `extensions.ts` (12) and its route, `cir.ts` (6), `lifecycle.ts` (3), `activity.ts` (3), `bootReference.ts` (1),
  `routes/project-content.ts` (the release fingerprint, now `AuthStore.setReleaseContentHash`), `dbSnapshot.ts` (moved to `storage/`, old
  path re-exports). The migrations are one file per step in `storage/migrations/` with a body per engine (`sqlite` today; `forDialect`
  refuses an engine that lacks a step), the order and SQL byte-identical to the former array (checked by comparing the evaluated objects).
  Grep test: SQL (statement shapes, `.prepare(`, `.stmt(`, `store.db`, `BEGIN/COMMIT/ROLLBACK`) is allowed only in `repositories/`,
  `storage/`, `core/auth/store.js` (the AuthStore, deliberately not interfaced) and `core/collab/` (document index and revisions, written on
  the AuthStore's statement cache); the allow-list for anything else is empty. Contract suite `test/wp10-storage-contract.test.js` runs every
  repository and both limiter stores through one `contract(engine, make)` function, today with `sqlite`.
* **Process-local state (PLT-031).** Pending package-import tokens are kept as a record beside the upload (`storage/pendingImports.ts`),
  so a pending import survives a restart within its hour (and expires after it, also on read); `GET /api/ready` (public, listed in
  `routes-guarded`) answers 503 naming the failing check when the database does not answer, the data folder is not writable or free disk is
  under `AGASTYA_READY_MIN_FREE_BYTES` (256 MB); the `AuthStore` statement cache is capped (500). Clean shutdown with checkpoint was WP-06.
  WebSocket clients and the warm renderer stay process-local (multi-node work, not Mode A/B single host).
* Tests changed: `settings-hostile-input` architecture test now exempts `services/projectRecord.ts` (the code moved there from
  `projects.ts`); `routes-guarded` lists `GET /api/ready` in the intended public set.
* Not done: ARC-017 (split `registerAuthRoutes` and the other god functions under 300 lines) was left out to keep this diff mechanical;
  the AuthStore and `core/collab` keep their SQL (see above); routes and services still import the facade rather than receiving `ctx`
  (new code can take an `AppContext`; migrating the 74 importers is opportunistic, as the audit recommends).
* Verified (backend `tsc` 0 errors; each file alone, `--test-concurrency=1`, against the final build unless noted; `AGASTYA_CLIENT_DIST`
  pointed at the main checkout's `frontend/dist` because the worktree has no client build, which `wp03-auth` "security headers" needs):
  new `wp10-seams` 11/11 (no `process.env` outside config, cycle count 0, SQL grep with empty allow-list and a non-vacuity check, typed
  config errors, two isolated contexts, AuthProvider answers, migration failure in `start()`, migration files, pending import across a
  restart, readiness) and `wp10-storage-contract` 9/9 (sqlite); `routes-guarded` 1/1, `project-formats` 4/4, `settings-hostile-input` 6/6.
  On the build before the last cosmetic edit (an unused require removed from `projects.ts`): `api` 17/17, `csdb-objects` 4/4, `packages`
  10/10, `project-archive` 5/5, `importer-http` 12/12, `import` 5/5, `jss-authoring` 12/12, `jsg-engine` 7/7, `xengine-convert` 7/7,
  `xengine-import-wizard` 4/4, `phase17-security` 5/5, `phase13` 12/12, `notifications` 6/6, `wp07-small-fixes` 4/4, `wp06-lifecycle` 5/5,
  `cir-links` 4/4, `lifecycle` 5/5, `sns-http` 10/10, `s1000d-reference` 18/18, `rbac` 7/7, `wp03-auth` 11/11, `jssdm-http` 9/9,
  `pm-multi-ref` 5/5, `extensions` 5/5, `release-issue` 1/1; earlier builds of this package: `sns` 16/16, `sns-polish` 4/4,
  `sns-separation` 6/6, `lifecycle-reinstate` 2/2, `db-snapshot` 4/4, `s1000d-migration` 2/2, `uploads-config` 4/4, `wp04-reset-admin` 1/1.
  Not run: the full backend suite, the PDF-heavy files, vitest, Playwright (left to the lead's merged run).
## Phase 5 (taken early)

### WP-20 Automated theme and visual validation (TH-009, QA-012, RES-007, QA-013, DS-010) - done, with the limits listed

What WP-19 already had is not repeated (colour-literal lint, static contrast pairs, undefined-variable coverage, static state matrix). Added, in the
order of 08 section 7:

* 7.2 token coverage (`frontend/scripts/tokens/check-coverage.mjs`, now part of `npm run lint:theme`): (1) pair completeness (7.6 #17): every
  colour token the code uses as a text colour must be the foreground of a contrast pair, every one used as a background the background of one;
  (2) one theme mechanism (7.6 #10): `prefers-color-scheme` and setting `data-theme` only in the theme owners; (3) no bare `var(--p-*)` primitive
  outside the tokens (except the accent preview cards, which render the other theme on purpose); (4) unused colour tokens listed (warning:
  `--surface-raised`). Reviewed exceptions in `scripts/tokens/coverage-exempt.json`, a reason each (13 decorative backgrounds: scrim, change
  bars, handles, pdf.js highlight over canvas-drawn text ...; `main.tsx` = the store's wiring; `studio/ui/app.ts` standalone mode, to go with the
  host contract of WP-21). A stale exemption fails (ratchet). First run: **31 colour tokens were in use with no contrast pair**, i.e. never
  checked; 18 pairs added to `tokens.json` (paper tints under paper ink, the PDF page label, the ISPL empty text, the JSS cross-reference ink; the
  JSG placeholder and the watermark preview as floors, like WP-19's `paper-placeholder`), the rest exempted as decorative. `check-contrast.mjs`
  now composites a translucent `paper-*` tint over the paper (over the panel it made the JSS focus tint read 1.37:1 in dark; on the real white
  paper it is 19:1). Pairs 103 -> 121 (242 checks), 0 failing. `src/styles/tokens/coverage.test.ts` 3/3 (tree passes; five planted violations
  and a stale exemption fail).
* 7.5 component theme tests (`src/components/theme.test.ts`, vitest/jsdom): the shared components (Badge, Alert, Field hint/error, ConfirmModal
  danger and busy, PromptModal, Toasts, Spinner, Empty, PageHeader with stats, Section, ThemeChoiceControl, buttons) are rendered with React in
  both themes and styled by the real entry sheets through a small cascade (Element.matches on the real selectors, specificity, custom-property
  inheritance, var() fallbacks, alpha compositing; jsdom applies no custom properties). Per component and theme: no inline colour, every var()
  resolves, every text 4.5:1 (3:1 large) on the background it sits on, dark differs from light. Plus the live switch of ThemeToggle and
  ThemeChoiceControl, and a non-vacuity test (planted inline colour, faded text, undefined variable). 15/15.
* 7.3 runtime sweep and G-UX-1 (`frontend/e2e/visual/a11y-audit.ts`, `a11y.spec.ts`). axe-core is **not** available offline here (no
  `axe-core` entry in `%LOCALAPPDATA%\npm-cache\_cacache\index-v5`, none in node_modules), so an in-repository subset of axe's WCAG A/AA rules,
  with axe's rule ids and impact levels, runs in the page: html-has-lang, document-title, button-name, link-name, label, select-name, image-alt,
  frame-title, aria-roles, aria-valid-attr-value (dangling idrefs), duplicate-id-aria, aria-hidden-focus, nested-interactive, target-size (WCAG
  2.2 2.5.8 with the spacing and inline exceptions), color-contrast (the 7.3 sweep: every visible text node, opacity chain, backgrounds
  composited through the ancestors, large-text rule; paper sheets, canvas and pdf.js pages skipped because the paper pairs cover them; text over
  images listed as incomplete), and landmark-one-main / page-has-heading-one as moderate (reported, not budgeted). Budget: 0 serious/critical on
  the ten named routes (sign-in, workspace, project, Studio, JSS editor, JSG editor, Publish = publication, Release, Admin, Settings) in both
  themes; waivers only through `a11y-allowlist.json` (reason, package, expiry; an expired one fails): **empty**. A planted-defects test proves
  every rule fires and a clean page passes. Note: "project" redirects to the Studio today (no project home until WP-22). Moving to axe is a
  one-line change in the spec once `@axe-core/playwright` is in the offline cache.
* 7.4 visual regression (`frontend/playwright.visual.config.ts`, `e2e/visual/screens.spec.ts`): its own config, port (`E2E_PORT`, default 4060),
  server, workspace, output folder (`test-results-visual-<port>`) and lock; the main config now ignores `e2e/visual/`. Projects `light` and
  `dark`; each picture first asserts `html[data-theme]`. 13 key screens (sign-in, overview, workspace, projects, project, Studio, JSS editor,
  JSG editor, publication, validation, release, administrator, settings) + the design-system fixture, 1366x768, both themes = **28 baselines**
  (`e2e/visual/__screenshots__/<theme>/`, 1.8 MB; reviewed once). Flake control: channel msedge pinned (version written to
  `__screenshots__/BROWSER.txt`: msedge 158.0.4370.33; a major change is reported), `stable.css` pins the UI font to Arial and mono to Consolas
  and stops animations, caret and the focus tooltip; device scale 1, reduced motion, UTC, en-GB; fixed seed names (`seed.ts`, idempotent);
  dates, times, ids and versions found by their text are masked; `maxDiffPixelRatio` 0.002. Guard against a vacuous baseline: the dark
  workspace must have a mean luminance below 0.35 and the light one above 0.6 (decoded in the browser), and the toggle repaints without reload.
* DS-010 (`e2e/visual/design-system.html`): the living style guide as a fixture: every shared shell component in its states (buttons in five
  variants x default/hover/focus/disabled/busy, icon buttons, segmented control, tabs, fields default/focus/error/disabled, select, textarea,
  badges and alerts in every tone, empty state, dialog, toasts, page header with stats, section, table), served on the app's origin with the
  BUILT entry stylesheet. A picture per theme, and a computed-style test with real :hover, keyboard :focus-visible and :disabled (state differs
  from default, hover text 4.5:1, 2px focus ring 3:1 against the card, every status colour 4.5:1). A fixture, not a dev route: a route would
  either ship in the bundle or be missing from the built app the suite tests.
* QA-013 performance probes (`scripts/ci/perf.mjs`, `perf-compare.mjs`, `perf-compare.test.mjs`): runs `backend/scripts/perf-phase17.js`
  (import, export, validation, findings, assets, HTML, delivery, optional PDF, peak RSS) `--repeat` times, takes the per-metric median, appends
  it to a history (`AGASTYA_PERF_HISTORY`, default `verification-results/perf-history/perf.jsonl`) and compares it with the median of the last
  five comparable runs (same size, host, CPU count, Node major): +25 % ALERT, +40 % FAIL, steps under 50 ms not judged, no verdict before three
  runs (no budget number is invented). A probe whose HTTP steps failed is not recorded. Decision (audit 10.5: "alert at +25 %, fail a release
  at +40 %"): the nightly (100 modules, 200 pictures, 1 run) reports and exits 0; the release (500/1 000, PDF, 3 repeats) exits 1 on FAIL.
  Reason, measured here: identical 10-module runs on this shared host gave the delivery step 1 420 to 2 423 ms, so one run a night would fail
  on noise.
* Gate (`scripts/ci/gate.mjs`): new stages `theme` (pr, nightly, release: the four token checks, each recorded), `visual` (nightly, release:
  the visual config on `E2E_VISUAL_PORT`, default 4060, junit into the evidence) and `perf` (nightly, release: the rule's unit test, then the
  probe). `.github/workflows/gate.yml` sets `E2E_VISUAL_PORT` and a history folder outside the checkout (a clean checkout deletes ignored
  folders). Scripts: root `npm run perf`, frontend `npm run test:visual`. `.gitignore`: `test-results-*/` (the per-port folders of WP-08 were not
  ignored).
* Defects found by the new checks, fixed:
  - JSS outline rows: 23 px tall adjacent `role=button` targets (target-size, WCAG 2.5.8, 34 per page in both themes): `min-height: 24px`
    (`jss/style.ts`);
  - toast dismiss button: opacity 0.85 put the "x" at 4.25:1 (light) / 4.03:1 (dark) on the success toast, and it was a 15 px target: full
    ink, a 24 px target with negative margins so the toast keeps its height, hover = a currentColor tint (`styles/states.css`);
  - PDF viewer page-number label: #aaaaaa on the white page, 2.32:1 -> #5d6475 (6:1) (`tokens.json` primitive `viewer-page-label`);
  - 31 colour tokens in use without a contrast pair (above).
  Found, not fixed (moderate, not budgeted; landmarks and the skip link are WP-23, UX-005): no `main` landmark on any of the ten routes; no
  level-one heading on publication and release.
* Verified (this worktree; Playwright only with my own config on port 4061, `--output=test-results-wp20`, Edge 158; port 4050 and the main suite
  not touched): `npm run -s lint:theme` ok; vitest `src/styles/tokens/coverage.test.ts` 3/3, `tokens.test.ts` 7/7, `src/components/theme.test.ts`
  15/15, `src/styles/states.test.ts` 131/131; `node --test scripts/ci/perf-compare.test.mjs` 9/9; `perf.mjs --size 10,10,0` five times into a
  scratch history (BASELINE three times, then verdicts; report-only and strict exits as designed); frontend `tsc --noEmit` clean, the
  e2e/visual files type-checked strict on their own; `check:bundle` PASS; `scripts/ci/lint.mjs` ok; `node --check scripts/ci/gate.mjs`.
  Visual suite: run 1 took the baselines (56/58; the planted-defects test showed that names were only checked on elements with a size, so an
  empty 0x0 link escaped: fixed); run 2 without updating, after the toast fix: 57/58, the dark design-system picture failed with 4 302 px
  changed because the toasts had grown 1 px - the regression check doing its job; the toast margin was corrected and the design-system tests
  then passed against the original baselines. Final full run on the final build (run 3, no update): **58/58 passed in 2.6 min**; only the
  moderate landmark/heading notes printed.
* Not done / limits: axe-core itself (the in-repo subset is narrower, and no automated tool judges the contenteditable editors; the manual
  checklist and screen-reader pass of RES-007 stay manual); widths other than 1366 and the `forced-colors` / `contrast-more` projects of 7.4;
  overlay-state pictures (command palette, context menu, file menu, form with errors) beyond the fixture's dialog and toasts; the fixture
  pictures show hover/focus samples in their resting look (the computed test drives the real states); the gate itself was not run here (lead's
  instruction); the perf history needs three runner runs before it judges; the main e2e suite (`zz-theme-states.spec.ts` touches the toast) and
  the full vitest are for the lead's run.
## Phase 2

### WP-13 Runtime baseline, version identity and dead-code removal (ENT-008, DEP-018, DEP-005, ARC-009, DEP-004, ARC-013, FE-018, DEP-021, FE-019, ARC-004, ARC-011, ARC-015, PLT-025, ARC-019, PERF-017) - done in part (see limits)

* Runtime decision (D1, ENT-008, DEP-018): **Node 24 LTS**, pinned to **24.22.3** (EOL 2028-04-30) in `packaging/product.json` `runtime`
  (version, end of life, SHA-256 of the official win-x64 zip, source URL, `minSupportMonths` 12). The zip was downloaded and its SHA-256
  checked (`e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f`); a copy is at `C:\Users\Admin\Desktop\_tools\node-v24.22.3-win-x64`.
  `scripts/package-windows.mjs` now refuses a runtime of another major, older than the pin, or with fewer than 12 months of support left, and
  refuses to package when `backend/package.json`'s version differs from the root one. `backend/package.json` engines `^24.11.0 || ^22.13.0`
  (development still runs on 22). Readiness G-SEC-11b checks the shipped runtime (BUILD-INFO, else the pin): PASS, 17.1 months left.
  `npm run doctor` says "Node.js 24 LTS (or 22.13+ for development)". The stale "built into Node 24" comment of `vendor/engine/db.js` fixed.
* `node:sqlite` re-checked (DEP-018): `backend/test/wp13-sqlite-contract.test.js` (pragmas incl. WAL, prepared statements, foreign keys and
  cascade, commit/rollback, large BLOBs, `VACUUM INTO`, a second connection under WAL) passes 8/8 on Node 24.22.3 and on Node 22.23.2.
* Patch cadence (DEP-005, ARC-009): `docs/BUNDLED-COMPONENTS.md` - versions read from the shipped files (Node 24.22.3, Temurin 21.0.13.1+2,
  FOP 2.10 / Batik 1.18, libxslt 1.1.28 / libxml2 2.9.3 32-bit), support dates, the open FOP/Batik advisories, a quarterly window per
  component, and the recorded libxslt decision (keep until an in-house 64-bit build or in-JVM XSLT is proven equal on the golden set).
* Version identity (DEP-004): `backend/src/services/version.ts` is the one source - the root `package.json` version (a packaged install
  reads the `version.json` the packager writes), `API_VERSION` 1 and `MIN_CLIENT_VERSION` 2.0.0, and the schema level (the migrations the
  code knows against those the database applied; migrations the code does not know = a newer database, `compatible: false`). Public route
  `GET /api/version` returns `{product, version, apiVersion, minClientVersion, schema:{level,latest,applied,compatible}, build:{commit,builtAt,packaged}}`;
  `/api/health` reports the same version. `scripts/verify-installer.mjs` reads the expected version from the root `package.json` (was the
  literal "2.0.0") and checks `/api/version` agrees (version, packaged, schema compatible). Test `wp13-version.test.js` (4).
* Argon2 hard requirement (ARC-019, PERF-017): `argon2` moved from optional to required dependencies (lockfile flags updated);
  `crypto.js` `assertPasswordHashing()` is the first call of `start()` - without the module the server exits 1 with a message naming the
  module and how to repair the install; `npm run doctor` has a row for it. New hashes are always Argon2id; scrypt is only used to verify
  legacy `$scrypt$` hashes, asynchronously (`crypto.scrypt`, off the event loop), and a legacy hash is re-hashed with Argon2id at the next
  successful sign-in (not via the master path). Test `wp13-password-hashing.test.js` (3: the event loop keeps ticking during a legacy verify;
  a preload hiding argon2 gives the clear error and `dist/index.js` exits 1; the rehash on login).
* Server-computed `can` map (FE-019, ARC-004): `requireProject` guards now carry `minRole` and `cap`; `services/permissions.ts` builds the
  capability table from the registered routes once at start (`capabilityTableFrom(app)`: the highest minimum role per capability), and
  every project card carries `can` (`canFor(role, status)`; a project that is not active gives only `project.read`, to its owner). The client
  (`lib/roles.ts` `may(can, cap)`, `ProjectShell` `ctx.can`, `canWrite(can)` / `canBuild(can)`) asks the map instead of repeating role
  ranks: Ancillary, DocPublication, EditorSide, PdfPane, Editor, Graphics, JSG/JSS editors and ancillary, Publication, Release, Explore
  (lock = `doc.lock`), Validation (`validate.run`), Project settings (rename, members, delete, publishing), CIR target list, PublishRefusal,
  PublishWaivers, ImportPackageDialog. Kept as UI policy (not an authorisation rule): JSG "Save mine over theirs" for manager/owner. Removed
  the dead role helpers `canWriteRole`, `canManageRole`, `canChooseBrandPack`, `canEditSns`, `canEditSnsDefaults`. Test `wp13-permissions.test.js` (3).
* Dead code (ARC-011, DEP-021, FE-018): removed 40 client wrappers nothing called and `frontend/src/api/publish.ts` (`publishApi`, never
  imported): `csdbApi.{objects, deleteObject, newObject, generateDml, objectHtmlUrl, assets, findings, exportProjectUrl, importPackage,
  delivery, html, buildHtml, lifecycle, workingRevision, suggestions, applyMarks, issue, obsolete, reinstate, supersede, cirLinks,
  approveCir, detachCir, extensions, setExtension}` with their now-unused types; `workspaceApi.{documentTypes, importProject, invite}`;
  `contentApi.revision`; `configApi.collections`; `jssApi.types`; `packageApi.importReport`; `pmcApi.get`;
  `s1000dApi.{importPreset, configurations, planConfigured, buildConfigured, configuredUrl, applicability, saveApplicability}` with the
  applicability and configuration types. Removed `backend/vendor/engine/lemminx.js` and `comments.js` (nothing requires them).
  `vendor/engine/license.js` stays in the source (pinned by a hash in `pm-multiref.test.js`, decision D12 open) but is excluded from the
  package, as is `vendor/tools-linux` (the product is Windows-only).
* Dead routes (ARC-013, D8) - **none removed**, by decision: the owner's lists of 2026-11-26 removed the screens of SNS System 2, the brand
  packs, the CSDB page and all applicability screens and said "backend, data and API stay"; D19 also puts the route list with the WP-36
  cleanup after the regression sign-off. A first pass that removed 26 routes (SNS rows and defaults, brand packs, applicability,
  configured publication) and adapted their tests was reverted before commit for that reason. The routes without a client caller are listed,
  per group with the reason they are kept, in `docs/API-ONLY-ROUTES.md` (ARC-013 acceptance). Services orphaned only if those routes go
  later (for WP-36): `services/sns/{service,derive,learn,pmxml}`, `applicability.writeModel`, `publisher.buildConfiguredPublication`, `listConfiguredPdfs`.
* Documentation (ARC-015, PLT-025): README prerequisites say Node 24 LTS and point to `BUNDLED-COMPONENTS.md`; the README's "JSG is not
  built" is corrected; `PROJECT_ARCHITECTURE_AND_TECH_STACK.md` (a 2026-11-23 snapshot) has a corrections block (JSG built, all 28 JSS types
  ready, Node 24, Argon2 required, temporary password format, `/api/version`, API-only list) and its password line fixed; the stale
  "Surname@Year" comments in `core/auth/routes.js` and `policy.js` now describe the random temporary password.
* Not done here: `codemirror` (no import, ARC-011) stays in `frontend/package.json` - removing it changes the lockfile, which was not done
  offline; `studio/export/pdf.ts` `buildPdfDocDefinition` and the pdfmake generator (ARC-012) and duplicate chunks in `frontend/dist`
  (ARC-021) are left for WP-36/WP-18; the two copies of the S1000D schemas (ARC-010) are left; `FE-022` (typed API) is not started.
* Verification (run 2026-11-27, one file at a time): on Node 22.23.2 - `wp13-version` 4/4, `wp13-password-hashing` 3/3,
  `wp13-permissions` 3/3, `wp13-sqlite-contract` 8/8, `routes-guarded` 1/1, `rbac` 7/7, `api` 17/17, `wp04-reset-admin` 1/1,
  `phase17-security` 5/5, `sns-separation` 6/6, `applicability` 4/4, `brand-packs-route` 2/2, `pm-multiref` 3/3, `applic-publish` 12/12,
  `package-settings` 5/5, `xengine-identity` 11/11, `sns-http` 10/10, `sns-polish` 4/4, `applic-external` 7/7. On Node 24.22.3 -
  `wp13-sqlite-contract` 8/8, `wp13-version` 4/4, `wp13-password-hashing` 3/3, `wp13-permissions` 3/3, `routes-guarded` 1/1. `wp03-auth`
  10/11: "security headers on the API and on the application" fails because this worktree has no `frontend/dist` (the page it checks is not
  served) - environmental, not this package. Frontend: `tsc --noEmit` clean; vitest `src/api/query.test.ts` + `src/lib/importPackage.test.ts` 31/31.
* Limits: the installer is **not** rebuilt with Node 24 (release work: `npm run package:win -- --node C:\Users\Admin\Desktop\_tools\node-v24.22.3-win-x64\node.exe`,
  then `verify-installer`); the full backend suite, the gate and Playwright were not run on Node 24 (or on this branch); the performance
  baseline (B1-B13) is not re-taken on Node 24, so the phase-2 exit criterion "baseline re-measured" is open.

### WP-12 Data protection: complete backup, tested restore, safe migrations, retention (PLT-001, PLT-005, PERF-006, PLT-006, PLT-007, PLT-011, PLT-013, DEP-001 part, DEP-002, DEP-008, ENT-006, ENT-013, ENT-015, ARC-005, DEP-025, PLT-029, RES-002, DEP-013, ARC-003) - done, with the limits listed

Decisions taken from the audit (no owner question): the platform backup is a ZIP (the existing ZIP64 streaming writer) of a SQLite
online-backup image + every data-folder file + a SHA-256 manifest; restore goes only into a NEW or empty folder and the switch-over is an
operator step (point `AGASTYA_WORKSPACE_DIR` at it), so the owner's live data folder is never overwritten; migrations stay additive and
forward-only ("down" = the pre-migration copy); the historical migration order (014, 015 first) is kept and only new steps must be appended
in number order; schedule 24 h, retention 7/4/12 for scheduled backups only (manual / pre-update archives are kept until an administrator
deletes them); pre-migration copies keep the newest 5; housekeeping retention 30 d sessions / 90 d read notifications / 90 d decided reset
requests / 730 d audit (archived to a gzip file first); all are settings, 0 = off / keep for ever. RPO = backup interval, RTO = measured by Verify.

* **Migration framework (PLT-011, PLT-006, ARC-003, DEP-002, ENT-013, PLT-013).** `storage/schema.ts`, called by `AppContext.start()` in this
  order before anything is written: `checkOrder` (unique names and NNN numbers, no gap, new steps appended), `quickCheck` (a damaged file stops
  the start: "failed its integrity check ... restore the latest backup"), `inspectSchema` (a migration unknown to this build or a
  `user_version` above its highest number = a database from a NEWER build: refused, file untouched; a recorded checksum that differs from the
  step = an edited shipped migration: refused naming it), `snapshotBeforePendingMigrations` (ONE `VACUUM INTO` copy before the first pending
  step of ANY number, `publisher-before-<step>.db`, never overwriting, checked with quick_check; failure = `SNAPSHOT_FAILED`, nothing migrated;
  newest 5 kept), then `AuthStore.migrate` unchanged, then `recordApplied` (SHA-256 checksum + program version per step, backfilled for
  existing rows, and `PRAGMA user_version`). `schema_migrations` gets two columns by `ALTER TABLE ADD COLUMN` (additive). `context.ts` prints
  the refusal on top before the process stops. The old 016-only `snapshotBeforeMigration` is kept unchanged for its test, no longer called.
* **Migration 022-audit-project-index** (PLT-007): `ix_audit_project ON audit_log(project_id, id)`; the activity query plan uses it (tested).
  NOTE for the merge: if another package also added a `022-...`, renumber one of them (`checkOrder` refuses two 022s).
* **Platform backup (PLT-001, PLT-005, PERF-006, DEP-008, DEP-025, ENT-006, ARC-005).** `storage/dbImage.ts` (node:sqlite `backup()` in page
  steps, VACUUM INTO fallback, image switched to rollback journal = one self-contained file; `inspectDatabaseFile` = integrity_check,
  foreign_key_check, applied migrations, user_version, per table rows + SHA-256 over every row; run in a worker thread so the server keeps
  answering), `services/platformBackup.ts` (`createPlatformBackup`: image checked before use, every file streamed from disk into the ZIP with
  its SHA-256 (`ZipStreamWriter.addFile` now returns size/CRC/SHA-256), `.partial` + fsync + rename, one at a time (`BUSY`); excludes the live
  db/wal/shm, the server lock and `backups/`), `restorePlatformBackup` (refuses a non-empty target, a non-ZIP, a foreign/newer manifest format,
  a backup whose manifest OR database carries migrations this build does not know, a missing or an unlisted entry, any size/SHA-256
  mismatch, a database whose integrity, foreign keys or any table's rows/digest differ; extracts into a sibling staging folder and renames
  only when everything matched; leaves nothing on failure), `verifyPlatformBackup` (= restore into a scratch folder, then removed),
  `retainedBackups`/`pruneScheduledBackups` (grandfather-father-son), `copyBackupTo` (copy + SHA-256 comparison, never overwrites).
* **Jobs (ENT-006, RES-002 9.7, PLT-007, ENT-015).** `services/dataProtection.ts`: `backupNow` (audited `backup.created`/`backup.failed`),
  `restoreTest` (newest backup; failure audited and sent to every administrator's notifications), `runRetention` (repository
  `repositories/retentionRepository.ts`; audit rows paged by id, written to `<workspace>/audit-archive/audit-<ids>-<date>.jsonl.gz`, read back,
  then removed up to the archived id - so the archive travels with the next backup), `tick` (scheduled backup when due + pruning, restore test
  weekly, retention daily; each independent), `startScheduler` (from `index.ts` only, first run 10 min after start, hourly, unref'd; stopped on
  shutdown), `status`. State in `<backup dir>/backup-state.json` (atomic write). Config (`config.ts`): `AGASTYA_BACKUP_DIR`,
  `AGASTYA_BACKUP_INTERVAL_HOURS`, `AGASTYA_BACKUP_KEEP`, `AGASTYA_KEEP_MIGRATION_SNAPSHOTS`, `AGASTYA_RESTORE_TEST_DAYS`,
  `AGASTYA_RETENTION_{SESSIONS,NOTIFICATIONS,RESET_REQUESTS}_DAYS`, `AGASTYA_AUDIT_RETENTION_DAYS` (invalid values stop the start, named).
* **Routes (administrators only, authz snapshot updated: 8 new rows, all `requireAdmin`).** `routes/backups.ts`: `GET/POST /api/admin/backups`,
  `GET .../:name/download` (streamed), `POST .../:name/verify|copy|restore`, `DELETE .../:name`; names must match the archive pattern (no path
  parts); copy/restore targets must be absolute and outside the running data folder and the backups folder; restore answers the switch-over steps.
* **Project files export (PERF-006, PLT-005, DEP-025, PLT-029).** `GET /api/backup` keeps its scope and content (authors: their projects) but is
  now streamed from disk with the ZIP64 writer through a pipeline (a client that disconnects stops it), one at a time per server (409 `BUSY`);
  its manifest says `restorable: false`. The in-memory `services/zip.ts` is deleted.
* **CLI and doctor (DEP-013, PLT-013, DEP-001 part).** `backend/scripts/agastya-backup.js backup|verify|restore|check` (works with the server
  running; `--kind pre-update` for the installer of WP-25). `npm run doctor`: database quick_check, schema not newer than this version, newest
  platform backup under 7 days (read-only open).
* **UI.** Administrator > Maintenance: new *Platform backup* panel (`pages/PlatformBackups.tsx`: back up now, stale/failed warnings, schedule
  and last restore test, per archive Download / Verify / Copy to... / Restore... / delete, the switch-over steps after a restore); the old card
  renamed *Project files export* with "not a backup" wording; the Backup page's administrator note points to the platform backup; activity labels.
* **Docs.** `docs/OPERATIONS.md` sections 7-8 rewritten: what the backup holds, schedule, restore test, copy elsewhere, CLI, restore runbook
  (never overwrite; switch-over), RPO/RTO, pre-migration copies, retention, forward-only upgrades and the downgrade refusal, the SQLite
  switch criteria (RES-002); five new rows in "When something is wrong".
* Verified (backend `tsc` 0 errors; each file alone, `--test-concurrency=1`, `AGASTYA_CLIENT_DIST` = the main checkout's `frontend/dist`):
  new `wp12-migrations` 10/10 (order rules; checksums/version/user_version recorded; newer database refused and the file byte-identical;
  edited migration refused; a scribbled database refused at start; the copy before a pending 022 predates it, holds the data and, put in place
  of the database in a new folder, starts with the data; synthetic future step gets its own copy beside an existing file; copy failure =
  nothing migrated; snapshot pruning; the G-REL-3 matrix: databases stopped after steps 1, 3, 13, 15, 16, 18, 20, 21 upgrade to the same
  schema as a new one with their rows, a named copy, foreign_key_check and quick_check clean); new `wp12-backup-restore` 7/7 (G-REL-1: every
  table incl. audit_log row-for-row and every file byte-for-byte equal after a restore, a server started from `dist/index.js` on the restored
  folder signs `meera` in with her old password and serves the module, its history and `/api/version` compatible; a backup during concurrent
  saves verifies; a second concurrent backup BUSY; refusals: non-empty target, truncated, changed file, added entry, newer manifest, a database
  carrying an unknown migration behind a clean manifest, a foreign format - nothing left behind; admin routes incl. 403 for a project manager,
  download = file, path-traversal name 404, verify, copy + no overwrite, restore refused inside the data folder / relative, restore, refused
  twice, delete; GFS keeps 7 days / one per month for 12 months / manual and foreign files; retention with archive file and the query plan;
  the schedule due/not due); `wp10-storage-contract` 11/11 (new retention case); `wp10-seams` 11/11 (ORDER with 022 appended); `db-snapshot`
  4/4; `s1000d-migration` 2/2 (the generic copy keeps the 016 name); `wp06-lifecycle` 5/5; `project-archive` 5/5; `notifications` 6/6
  (the streamed export); `phase13` 12/12; `wp13-version` 4/4; `api` 17/17; `admin-ops` 8/8; `packages` 10/10; `authz-matrix` 6/6 (after the
  reviewed snapshot update); `routes-guarded` 1/1; `zipio` 5/5; `settings-hostile-input` 6/6; `wp02-routes` 6/6; `wp03-auth` 11/11; `rbac` 7/7;
  `phase17-security` 5/5; `project-formats` 4/4; `import-enterprise-refusal` 2/2; `wp13-sqlite-contract` 8/8. CLI tried by hand on a scratch workspace: backup, verify, restore, restore into a non-empty
  folder refused, check; `npm run doctor` with `AGASTYA_WORKSPACE_DIR` = that workspace shows the three new rows ok. Frontend: `tsc --noEmit`
  clean; vitest `src/pages/PlatformBackups.test.tsx` 2/2. `node scripts/ci/lint.mjs` green (no new `any` / `require(`).
* Limits / not done: (1) DEP-001 installer side - `packaging/host/AgastyaHost.cs` still makes its fixed-wait `pre-upgrade-*` copy; making the
  installer call `agastya-backup.js backup --kind pre-update` and refuse to continue on failure belongs to WP-25 (release engineering runs in
  parallel; the packaging code was not touched). The server-side generic pre-migration copy now covers every start, installer or not.
  (2) "Restore ... runs migrations": the restore does not migrate; the first start on the restored folder does, after its own verified copy
  (proven in `wp12-migrations`). (3) The weekly restore test checks files, tables, integrity and foreign keys; it does not boot a second server
  (the round-trip test does that). (4) ZIP64 is exercised by the writer's forced-ZIP64 case in `zipio.test.js`, not by a real 4 GiB backup;
  no 1 GB event-loop measurement was taken on this machine (shared host). (5) The archive is not encrypted (it holds password hashes); the
  docs say to keep it administrator-only; encryption at rest is left to the OS / WP-28 (central backup). (6) Revisions and blobs are not
  purged by retention (the audit: explicit action only). (7) The node:sqlite `backup()` call exists in Node 22.23.2 (used here) and is part of
  Node 24 (WP-13 pin); it was not run on 24.22.3 in this package. (8) Playwright, the full backend suite and the gate were not run.
## Phase 3

### WP-33 S1000D FO-stage scaling, the vendored stylesheet (PERF-003, P0) - done

* Cause, measured here (`xsltproc --profile` at 50 and 500 modules, then by removing one piece at a time): the List of Illustrations
  evaluated `generate-id((//dmodule//figure[title])[1])` once per figure, and libxml2 evaluates `//dmodule//figure[title]` with a
  quadratic merge (it rewrites `//x` to `descendant::x` only when the step has no predicate, so every node of every module went through
  a duplicate-checked merge): about 25 s at 500 modules even when evaluated ONCE. Next, `unique-id`'s `count(preceding::*[@id = ...])`
  for every repeated id (about 8 s at 500 modules), `internalRef`'s fallback `//*[@id = $target][not($dm)]` (a book walk per reference
  even when it is thrown away), `dm-occurrence-suffix` (a `preceding::dmodule` intersection per id of a reprinted module), the
  abbreviation de-duplication (`preceding::acronym` per acronym), `footnoteRef` and `@warningRefs`/`@cautionRefs` (`//footnote[...]`,
  `//warning[...]` per reference).
* Changed (vendor exception "FO-stage scaling", recorded in `docs/JSS_VENDOR_EXCEPTIONS.md` and `docs/S1000D_COMPLETE_IMPLEMENTATION.md`
  section 10): `s1000dtofo/frontmatter-s1000d.xsl` (first titled figure once, on `//dmodule/descendant::figure[title]`; key
  `acronym-by-term`), `s1000dtofo.xsl` (`unique-id`: position in the existing `by-id` key minus same-id ancestors; `dm-occurrence-suffix`:
  position in `dm-by-code`; the old expressions stay as fallbacks for a node a key does not hold), `refs.xsl` (`internalRef` fallback
  as `(/)[not($dm)]//*[...]`, evaluated only without an enclosing module; `footnoteRef` by key), `warnings.xsl` (warning/caution
  references by key). XSLT 1.0 only, libxslt 1.1.28 checked to support keys on result tree fragments in document order.
* Equivalence. libxslt builds `generate-id()` from memory addresses: the UNCHANGED stylesheet run twice on the same 3 modules gives
  different bytes. Byte identity is therefore impossible even before/before; the criterion is byte identity after renaming generated
  ids in order of first appearance (`test/helpers-fo-compare.js`, accepts a one-to-one renaming only; a changed authored id or a link
  moved to another element is a difference). Evidence:
  - `test/wp33-fo-equivalence.test.js` (new, pdf-smoke stage, 40 s): pre-WP-33 stylesheets (kept in `test/fixtures/wp33-old`) against the
    current ones, default and Xignal profiles: cloned publications (3 and 25 modules, ids repeated, a reprint), edge cases (warning and
    caution references with one and two ids, footnotes, an id inside an element with the same id, repeated acronyms with spacing
    variants, cross-references to repeated ids, a reprint), no titled figure, one module with 200 figures, the 21-type fixtures of
    issues 4.2 / 5.0 / 6 / 7 and the rich set: 5/5 pass. It was shown to fail: with the duplicate count off by one it reports `dup00`
    against `dup01`.
  - Every FO the relevant suites built through the product was captured (a `--require` hook on `execFile`, scratch only) and re-run
    with the old stylesheets on the same input and driver: 104 builds, 104 equivalent, 0 different (`golden-xignal` 1 = the 218-module
    Xignal sample, `pdf-reference` 2 = the 20 Nov customer publications, `pdf21` 84, `applic-publish` 10, `pdf-furniture` 3,
    `publisher-logo` 3, `pdf-multi-ipd` 1); 6 more from a first `applic-publish` run could not be replayed (the test deletes its
    build folders) and were covered by a second run with folder snapshots.
* Timings on this host (shared 8-core Windows machine, other work running; bundled 32-bit libxslt 1.1.28; FO stage only, `xsltproc
  --xinclude --nonet`; clones of the e2e description module, two titled figures each, Xignal profile):

  | modules | before | after |
  |---|---|---|
  | 3 | 0.12 s | 0.13 s |
  | 25 | 1.06 s | 0.30 s |
  | 50 | 7.80 s | 0.46 s |
  | 100 | 61.5 s | 0.90 s |
  | 200 | 535 s | 2.8 s |
  | 500 | not run (extrapolated over an hour) | 9.3 s |

  Default profile after: 0.48 / 0.97 / 1.89 / 9.18 s for 50 / 100 / 200 / 500. Growth now about n^1.3 (100 to 500), 50 to 100 ratio
  about 2. Acceptance of the roadmap: 100 modules at most 10 s (0.9 s), 50 to 100 at most 2.5x (1.9-2.1x). The remaining super-linear
  part at 500 is the duplicate-id position search (a key of 500 same-id figures walked per figure, about 2 s at 500): it only grows
  with the number of copies of ONE id.
* `test/wp33-fo-scaling.test.js` (benchmark B6, new, heavy stage, 14 s): 50/100/200/500 modules; limits 100 modules < 15 s, 500 < 90 s,
  each doubling < 3x, growth 100 to 500 below n^2. Two runs here: 0.40/0.86/2.13/7.99 s (n^1.38) and 0.42/0.80/1.81/6.89 s (n^1.34).
* Other paths checked: the JSS pipeline (s1000dtojss + jsstofo) on the same inputs is linear already (stage 1 0.34 / 1.11 s, stage 2
  0.95 / 4.36 s for 100 / 500 modules; stage 1 reads each module with `document()`, so its `//` are per module); not changed. Left
  as they are, by decision (no measured cost in the product's paths, output-identity risk not worth it): `xsl:number level="any"`
  without a module boundary (footnotes in `common.xsl`, figures under the opt-in `figure.numbering = continuous`, chapter numbers under
  `document.format = JSS`), which walk back to the start of the book per number; the JSG stylesheets
  (`schemas/jsg/engine/*.xsl`, `xsl:number level="any"` per figure/table, one Word-derived book per build); the
  `//identAndStatusSection` lookups of `descript.xsl` under `document.format = JSS` (they read the first module's title; a global
  variable would change the result inside the support-view node-set).
* Regression tests run, each alone, with the new stylesheets: `golden-xignal` 4/4 (with the sample via a read-only junction to the main
  checkout's `SAMPLE PROJECTS/S1000D`), `pdf-reference` 2/2, `pdf21` 8/8 (804 s), `applic-publish` 12/12 (twice), `pdf-furniture` 2/2,
  `pdf-multi-ipd` 1/1, `xignal-cover` 12/12, `xignal-prelim-marking` 5/5, `repeated-dm-ids` 6/6, `publisher-logo` 2/2,
  `s1000d-reference` 18/18, `wp33-fo-equivalence` 5/5, `wp33-fo-scaling` 1/1 (twice). Not run: `publish-gate`, `brex-gate`, the full
  suites. `scripts/ci/lint.mjs` reports `any.backend` 282 against a baseline of 280: not from this package (no TypeScript changed here).
* Not done: the end-to-end acceptance "full 100-module publish at most 40 s" was not measured through the server (the FO stage it was
  dominated by is now under 1 s); a re-check on a newer libxslt if the toolchain changes.

## Phase 8

### WP-26 Network security and the client/server protocol (ENT-001, SEC-006, DEP-010) - done (installer TLS page and VM listener scan left to WP-28)

Decisions taken from the audit (no owner question): native TLS in the Node server (no bundled proxy); a network address without TLS is
**refused at start**, not warned about (roadmap "refuse non-loopback binding without TLS"; G-SEC-1 counts 0 plain-HTTP answers); a reverse
proxy is supported only on the same computer (Mode B on 127.0.0.1); HSTS on in Mode B over TLS, 180 days, no includeSubDomains or preload
(roadmap "HSTS for server mode"; ENT-001's "off by default" was the earlier position); the administrator supplies the certificate, an
internal CA is the recommended path, and the generator is a separate tool, not a default (ENT-001); a passphrase only from a file.

* **Config (WP-10 rules: only `config.ts` reads the environment; each error names the variable).** New `AGASTYA_MODE` (`local` = Mode A,
  default; `server` = Mode B), `AGASTYA_TLS_CERT` + `AGASTYA_TLS_KEY` or `AGASTYA_TLS_PFX`, `AGASTYA_TLS_PASSPHRASE_FILE`,
  `AGASTYA_SERVER_NAMES`, `AGASTYA_HSTS_MAX_AGE`. `buildConfig` refuses: a non-loopback `AGASTYA_HOST` in Mode A (`AGASTYA_HOST: ... is not a
  loopback address`); Mode B on a network address, or on every interface, without a certificate (`AGASTYA_TLS_CERT: Mode B listens on ...`);
  half a PEM pair; PEM and PFX together; a passphrase file alone; a server name with a scheme or port; a negative HSTS age. TLS on forces
  `secureCookies`. `isLoopbackHost` (127/8, ::1, IPv4-mapped, `localhost`, `*.localhost`) is the one loopback test.
* **Listening (`services/network.ts`, `index.ts`).** Mode A with no `AGASTYA_HOST` now listens on **127.0.0.1 and ::1** (same port; ::1
  skipped with a warning when the machine lacks it) instead of every interface: from this computer `localhost` keeps working whichever
  address family a client tries first (browser, Vite proxy, Playwright), and nothing listens on a network interface. The packaged product
  already set 127.0.0.1 and is unchanged. With TLS the listener is `https.createServer` (TLS 1.2 minimum); a plain HTTP request to that port
  gets no HTTP answer (the TLS layer drops it). `start()`, `stop()` and `shutdownGracefully()` handle a list of servers (the drain waits for
  all). The start-up log has a `Network:` line (mode, addresses, certificate subject and names, days left, SHA-256 thumbprint).
* **Certificate (`loadTls`).** Read and checked before the workspace lock: unreadable file, not a certificate, key not matching
  (`X509Certificate.checkPrivateKey`), wrong passphrase, unreadable PKCS#12 (`AGASTYA_TLS_PFX`), expired - each stops the start naming the
  variable; 30 days or less left is a warning at every start. The PKCS#12 details are read from a server-side `TLSSocket` on its context.
* **Host rule (DNS rebinding; the same on HTTP and the WebSocket).** Every request and every upgrade must name a loopback host, an
  `AGASTYA_SERVER_NAMES` entry (one-label wildcards; `*` turns the rule off on purpose), a name or address in the certificate, or the
  `AGASTYA_HOST` address; otherwise `421 {code: MISDIRECTED_REQUEST}`. Before this, `Origin` was only compared with `Host`, so a page whose DNS
  name was re-pointed at 127.0.0.1 passed the Origin check - for example it could create the first administrator of a fresh install (now a
  test). Order at the WebSocket upgrade: exact path `/ws` (it was any path starting with `/ws`), Host (421), Origin (403), client version
  (426), session (401).
* **Version handshake (WP-13 `/api/version`).** Server: a request carrying `X-Agastya-Client` older than `MIN_CLIENT_VERSION` (a pre-release
  ranks below its release; a malformed value counts as old) gets `426 {code: CLIENT_TOO_OLD, minClientVersion, version}`; `/api/version`,
  `/api/health` and `/api/ready` always answer; a request without the header (scripts, tools) is not refused; the WebSocket takes the same
  value as `?client=`. Client (`frontend/src/lib/handshake.ts`): the version is the root `package.json`, written in by Vite (`define`
  `__AGASTYA_CLIENT_VERSION__`), API level 1; `GET /api/version` once at start; every API request sends the header and the socket the
  parameter; a page below `minClientVersion`, a server on a newer API level, or a 426 opens a sticky "A newer version is on the server -
  Reload" dialog over the page (the page stays mounted, drafts are kept); a server on an older API level says the server needs an update.
  A network failure is not a mismatch (the existing "not answering" banner handles it).
* **HSTS** (`securityHeaders.ts`): `Strict-Transport-Security: max-age=<AGASTYA_HSTS_MAX_AGE>` on TLS answers in Mode B only (never on
  `localhost`, where it would pin every other local web server of the machine to HTTPS).
* **Administrator tooling.** `backend/scripts/make-tls-cert.js --out <dir> --name <host> [--name ...] [--days] [--with-ca]` writes a server
  certificate (ECDSA P-256, subjectAltName, serverAuth), self-signed or signed by a new private CA, and prints the thumbprints and settings;
  it installs nothing. The DER writer is `src/services/tlsCert.ts` (Node can sign but not write certificates); the tests use the same writer,
  so they need no OpenSSL (the PKCS#12 test uses `openssl` when present and skips otherwise). `npm run doctor` has a "Network and TLS" row
  (FAIL with the server's own message when the setting cannot start; certificate days left). Host program (`packaging/host/AgastyaHost.cs`):
  new ini keys `[server] Mode, ServerNames` and `[tls] Certificate, Key, Pfx, PassphraseFile, HstsMaxAge` (relative to `agastya.ini`) passed
  as environment; a `Bind` other than loopback means Mode B; the liveness probe tries HTTP, then HTTPS on 127.0.0.1 (TLS 1.2; certificate not
  checked for this loopback probe only); the browser URL is `https://` with TLS; `--doctor` FAILs a network `Bind` without TLS and shows the
  certificate's days left. `agastya.ini.template` documents the keys; `docs/OPERATIONS.md` section 5 "Mode B: TLS" (internal CA, private CA
  tool, same-machine proxy, host names, renewal and rotation on air-gapped networks, handshake).
* Verified (backend `tsc` 0 errors; each file alone, `--test-concurrency=1`, `AGASTYA_CLIENT_DIST` = the main checkout's `frontend/dist`):
  new `wp26-network` 9/9 - configuration refusals naming each variable; Host rule incl. wildcards, IPv6 and certificate names; certificate
  errors; PKCS#12 with a passphrase file (openssl present, not skipped); DNS-rebinding setup refused with 421 and nothing created, WebSocket
  421, exact `/ws`; 426 for old, pre-release and malformed client versions on HTTP and the WebSocket, version routes exempt; a real Mode B
  process with a throwaway CA and server certificate in a temp folder: HTTPS with a client trusting only the CA, plain HTTP to the port
  unanswered, a client without the CA refused, `Secure` session cookie, HSTS, Host rule with certificate and configured names, `wss` works
  and `ws` does not; Mode B without TLS on 0.0.0.0, Mode A on 0.0.0.0, an expired certificate and a wrong key each exit non-zero naming the
  variable and never listen; Mode A by default listens on loopback and this machine's LAN address refuses the connection. Also `wp03-auth`
  11/11, `auth-http` 10/10, `auth-core` 11/11, `ws-broadcast` 5/5, `routes-guarded` 1/1, `phase17-security` 5/5, `wp10-seams` 11/11,
  `wp13-version` 4/4, `authz-matrix` 6/6 (snapshot unchanged: no route added), `wp06-lifecycle` 5/5, `wp13-password-hashing` 3/3,
  `uploads-config` 4/4. Frontend: `tsc --noEmit` clean; vitest `src/lib/handshake.test.ts` 5/5, `src/api/query.test.ts` +
  `src/components/ui.test.tsx` 19/19, `importRefusal` + `waivers` + `AuthScreens` + `stores` 33/33. Host program: both executables compile
  with the packager's `csc` flags (into a scratch folder; not executed). `scripts/ci/lint.mjs` green; `wp26-network.test.js` is in the
  security stage of `scripts/ci/test-plan.json`. `make-tls-cert.js --with-ca` and the doctor row were run by hand (three configurations).
* Not done / left: the installer's LAN page does not collect a certificate yet - an upgraded `Bind=lan` install without `[tls]` now stops
  the server with a clear log line and a `--doctor` FAIL; the installer TLS page, a DPAPI-protected passphrase and the service-only ACL on
  `tls\` belong to WP-28. G-SEC-1's listener scan on a VM (`Get-NetTCPConnection`) was not run here. The frontend was not rebuilt and
  Playwright was not run (what a browser on this computer sees on loopback is unchanged). The host program's `--doctor` and probe changes
  were compiled, not executed. Certificate pinning for a thin Mode B client (WP-28) is not built; browsers use the Windows trust store.
## Phase 6 (taken early)

### WP-23 Accessibility to WCAG 2.2 AA (UX-004, UX-005, FE-014, ENT-018, UX-010, UX-027, UX-028) - done in part (automated and keyboard parts; manual screen-reader pass open)

* Landmarks and bypass (UX-005 a, WCAG 1.3.1 / 2.4.1): the main shell wraps its pages in `<main id="main-content">` (`.v2-main-region`, the
  same flex column the page had); the project shell's content column is now `<main>`; the sign-in screens are a `<main>`. Every signed-in
  page starts with a skip link (`components/a11y.tsx` `SkipLink`, `data-testid="skip-link"`): hidden until it has keyboard focus, it moves
  focus to the main landmark without changing the address (no `#hash` route). Inside the platform the Studio's own `<main class="center">`
  becomes a named region (`role="region"`, "Document"), so a page has exactly one main; the standalone Studio keeps its `<main>`.
* Headings (WCAG 1.3.1): `PageHeader` renders `h1` on project pages and `h2` under the main shell, whose top bar already holds the page's
  `h1` (context `HeadingLevel`); same look (`.v2-ph-text :is(h1, h2)`). Fixes "no level-one heading" on Publication, Release, Explore,
  Validation, Graphics, Ancillary and project Settings (WP-20's report named publication and release).
* Titles (UX-005, WCAG 2.4.2): `useDocumentTitle` gives every route its own title: "Projects · Agastya Platform",
  "Publication · <project> · Agastya Platform", "Sign in · Agastya Platform" (app name from the administrator settings).
* Rows (UX-005 b, FE-014, WCAG 2.1.1): the project name in the Projects and the oversight status tables is a real link (`RowLink`: Enter
  opens, Ctrl/middle click opens a tab, the row click still works); the numbering-preset rows and the Explore tables (S1000D and JSS/JSG
  documents, pictures) get a button on the name (`RowButton`, `aria-pressed` for the selected row). Validation issue rows and the JSS
  outline/problem rows (`role="button"`) now answer Space as well as Enter.
* Account menu (UX-005 d, WCAG 4.1.2): focus goes to the first item on open; Up/Down (wrapping), Home/End move; Escape closes and returns
  focus to the button; Tab closes; Down on the closed button opens it; the menu is named "Account"; items are `tabindex=-1` (roving).
* Tabs: the platform tab strips (Settings, project Settings, S1000D configuration, Activity views, the S1000D code lists, the import dialog)
  move focus with Left/Right/Up/Down/Home/End (`tablistKeys`) and have names. The JSS/JSG/Studio editor toolbars are WP-21's (not touched).
* Dividers (UX-005 e): the editor/PDF divider of the Studio, JSS and JSG pages is focusable and resizes with the arrow keys (2 % steps),
  PageUp/PageDown (8 %), Home/End (limits), stored where a drag stores it; all dividers expose `aria-valuenow/min/max`.
* Dialogs (UX-004, FE-014): WP-19 already trapped and returned focus. Added: Escape closes only the top dialog (a stack in `Modal`); the
  New-project wizard asks "Discard the new project?" before Escape, the close button or a backdrop click throw away typed input. Decision
  (audit's recommendation, the owner's standing approval): the explicit Cancel button closes at once without asking - it is the deliberate
  way out, and the main e2e suite (00-platform) relies on it.
* Status messages (UX-028, WCAG 4.1.3): success and information toasts go into a polite live region that is in the page before any message;
  an error toast is a `role="alert"` outside it (announced at once). Reduced motion: the platform rule already exists in `styles/base.css`
  (moved there by WP-18); the keyboard spec now proves transitions are off under the setting.
* UX-027: the Studio command palette is on Ctrl+K (primary, shown in menus) with Ctrl+Shift+P kept as an alias; Ctrl+K also works from a field.
* UX-010 was done by WP-05 (JSS/JSG drafts in IndexedDB every 3 s, offered on open; JSG autosave on by default); nothing added here.
* Audit extended (`e2e/visual/a11y-audit.ts`), each rule proven by a planted-defect page and a clean twin (`a11y.spec.ts` "the audit finds
  planted keyboard and structure defects (WP-23)"): `focusable-role` (a widget role nobody can Tab to, serious), `clickable-row` (a
  pointer row or list item with no keyboard target, serious; FE-014), `aria-required-attr` (focusable separator, slider, scrollbar without
  `aria-valuenow`, critical), `landmark-no-duplicate-main`, and `skip-link` (a page with a navigation block whose first Tab stop is not a
  link to the main landmark, serious; axe "bypass"). The structure rules `landmark-one-main`, `landmark-no-duplicate-main` and
  `page-has-heading-one` stay "moderate" (axe's level) but are now in the budget of the ten named routes. The allow-list stays empty.
* Keyboard scripts (`e2e/visual/keyboard.spec.ts`, light project only): skip link first and focus to main on two shells; distinct titles on
  eight routes; open a project from the Projects table with Tab and Enter; account menu arrows/End/Escape/Down; Escape on an empty wizard
  closes it and returns focus, on a filled one asks, a second Escape closes only the question; divider arrows/Home/End; live regions exist
  and transitions are off under reduced motion. Unit tests `src/components/a11y.test.tsx` (9): skip link, titles, heading level, row
  link/button, tab keys, splitter keys, Escape on the top of two dialogs, the toast regions.
* Defect found by the new rules and fixed: the Studio inside the project shell made two `main` landmarks (its `main.center`), on the project
  and Studio routes in both themes (`landmark-no-duplicate-main`, run 1).
* Test-harness fix (`e2e/visual/seed.ts`): every spec file signed in again, and each sign-in is an `auth.login` event; the Overview reads
  the newest 12 events before dropping sign-ins, so adding the keyboard spec pushed the seeded project events out and the dark Overview
  baseline failed with "Nothing yet" (runs 1 and 2; 21 084 px, data only, no visual change of mine). Sessions are now reused across spec
  files and projects of the worker (checked with `/api/auth/me`, a fresh sign-in if they ended). No baseline was updated.
* Verified (this worktree, Edge, my own port 4081 and `--output=test-results-wp23`; port 4050 and the main suite not touched): frontend
  `tsc --noEmit` clean, the e2e/visual files type-checked strict on their own; vitest `src/components/a11y.test.tsx` 9/9,
  `src/components/ui.test.tsx` 10/10, `src/components/theme.test.ts` 15/15, `src/styles/states.test.ts` 131/131,
  `src/styles/tokens/coverage.test.ts` 3/3; `npm run -s lint:theme` ok (0 literals); `scripts/ci/lint.mjs` ok (no new any/require);
  `vite build` ok; `check:bundle` PASS; parity check PASS (nothing removed; test ids kept). Visual/a11y suite:
  Run 1: 62 passed, 5 failed (duplicate main on project/studio x2 themes; dark Overview data); run 2 after the Studio fix: 66 passed,
  1 failed (dark Overview data); run 3 after the seed fix: **67 passed, 7 skipped (the keyboard spec in the dark project), 0 failed**, no
  moderate notes left on any named route.
* Not done / limits: G-UX-4, the manual screen-reader pass on three routes, and the manual parts of RES-007 (200 % zoom, reflow) need a person
  with NVDA/JAWS/Narrator: not done. G-UX-2 is covered in part: sign-in is a plain form, opening a project and the dialogs are scripted
  above, but "create and edit a data module, validate, request and approve a release" keyboard-only was not scripted (the Studio's
  contenteditable surface and ribbon are WP-21's chrome). axe-core itself is still not in the offline cache (the in-repo subset grew).
  The editors' own toolbars, menus and tablists (Studio ribbon, JSS/JSG tabs) were left to WP-21 except the targeted fixes named above.
  Not run here: the main e2e suite (00-platform's wizard Cancel and account-menu tests should be unaffected: Cancel still closes at once,
  menu items are still `menuitem` buttons), the full vitest, the backend suite, the gate.
