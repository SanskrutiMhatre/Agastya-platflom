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

## Phase 2

### WP-11 File integrity: atomic writes, history, mandatory version guards and check-out for all formats (REL-001, PLT-009, ARC-001, PUB-007, PUB-010, DEP-016, ENT-016, REL-002, PLT-020, PLT-021, REL-007, PERF-010, RES-001, FE-008, SEC-017; PUB-029 and PUB-021 not done) - done in part (see limits)

Decisions taken from the audit (no owner question):
* **D2 (compatibility window).** The audit recommends one release with a logged warning, then refusal. Taken as: the guard **refuses
  by default** (428 `BASE_HASH_REQUIRED`), because the phase-2 exit asks for a mandatory guard and every client in this repository
  (web screens, Studio, e2e specs, backend tests) now sends the hash. `AGASTYA_BASEHASH_COMPAT=1` is the window: a write without the
  hash goes through with a `[version-guard]` warning in the log, for scripts outside the repository.
* **D22 (lock granularity).** Taken as assumed: per chapter (JSS `<chapter>`) and per section (JSG `<section>`, `<plate>`,
  `<appendix>`). A save from an older version is merged three ways by part under a short per-document write lock; the base comes from
  the revision history by hash. Both sides changing the same part, or the frame (everything outside the parts: front matter, meta),
  answers 409 `STALE_DOCUMENT` with `{ currentHash, conflicts, xml }`. A stale save that changes nothing of its own stays a conflict
  (nothing to merge; the earlier contract, kept by `jsg-engine`). Check-out leases per part, with the whole document (part `''`) as the
  fallback. RES-001: hash guard plus per-user lease, not CRDT/OT.

What changed:
* **Atomic writes (REL-001, PLT-009).** `storage/atomicWrite.ts` `writeFileAtomic`: sibling temporary file
  `.<name>.tmp-<pid>-<12 hex>`, fsync, rename over the target (retried on Windows `EPERM`/`EACCES`/`EBUSY`), folder fsync on POSIX.
  `ContentStore.writeText` and the new `writeBuffer` use it, so every content write behind the WP-10 seam is atomic. Writers that
  bypassed the seam now go through it: `csdbObjects`, `jssdm/service`, `modelCode`, `pm`, `projects`, `sns/service`, `xengine/identity`,
  `xengine/convert`, `importer/apply`, `projectArchive`, the JSS ancillary pages, the media upload and the PMC import; the house template
  is written with `writeFileAtomic`. At start, `sweepTempFiles` removes temporary files older than one minute under `projects/`.
* **History first (PLT-009, ENT-016, ARC-001, PUB-007).** `services/projectFiles.ts` `saveRevisioned`: content on disk that is not the
  head revision is recorded as `on-disk` (a hand edit, or a crash after an old write), then the new content, then the atomic write. A
  history that cannot be recorded fails the save with 500 `REVISION_FAILED` and leaves the file as it was. A new file is written, indexed
  and recorded, and removed again if recording fails. Deleting a data module records its last content first and is refused the same way
  (`recordBeforeDelete`; it used to log and delete anyway). Users: `csdb.writeDm`/`createDm`, `csdbObjects.writeObject`, the JSS and JSG
  source.
* **JSS/JSG history (ARC-001, PUB-007).** `services/oneFileDocument.ts` `saveOneFileDocument` (merge, lease check, revision, write) is
  used by both engines' `writeSource`. `routes/documentHistory.ts` adds `GET <base>/history`, `GET <base>/history/:rev` and
  `POST <base>/history/:rev/restore` (guarded) on `/api/projects/:id/jss` and `/jsg`; a restore adds a revision and removes none.
  `POST /api/projects/:id/dms/:file/history/:rev/restore` does the same for data modules.
* **Mandatory version guard (DEP-016, PLT-020, FE-008, ENT-016).** `services/versionGuard.ts` `versionGuard(what)` reads `baseHash` from
  the body or `If-Match`. On PUT `dms/:file`, `objects/:file`, `pmc`, `settings`, `jss`, `jsg`, `ancillary/:page` and the three restore
  routes. Routes that had no guard now refuse a stale version (409 `EDIT_CONFLICT`): `pm.writePm`, `ancillary.writeAncillary`, settings
  (`version` = hash of project.json plus the house template); their reads return `hash`/`version`. The DM write is serialised per file
  (`withDocumentLock`), so two saves from one version cannot both pass the check.
* **Check-out leases (RES-001, PUB-010).** Migration `023-document-leases` (additive): table `document_leases` (key `document_id, part`)
  and `cir_modules.updated_by`/`updated_at`. `repositories/leaseRepository.ts` takes a lease in one `INSERT … ON CONFLICT DO UPDATE …
  WHERE` (same holder, or expired); contract case in `wp10-storage-contract`. `services/leases.ts`; routes `POST/DELETE/GET
  …/checkout(s)` on DM, JSS and JSG. Default 60 minutes (`AGASTYA_LEASE_MINUTES`). Saving or deleting a part under another user's live
  lease answers 423 `CHECKED_OUT` naming the holder; a project owner/manager or administrator can break a lease, audited
  (`*.checkout-broken`).
* **Common Information Repository (REL-002, SEC-017, PLT-021).** Only the uploader, a project manager or an administrator may replace a
  module (others 403 `CIR_REPLACE_ROLE`). A replacement must name the current version in `baseHashes` (without it 409 `CIR_EXISTS` with
  the current hashes; stale 409 `EDIT_CONFLICT`); all are checked before anything is written. Who replaced it and when are recorded and
  shown (`updatedBy`, `updatedByName`, `updatedAt`) beside the original uploader.
* **Uploads to disk with a whole-request cap (REL-007, PERF-010, PLT-021).** `services/uploads.ts` `CappedDiskStorage` streams to the
  upload folder and stops a request as soon as its total passes the cap (`LIMIT_TOTAL_SIZE` → 413 `UPLOAD_TOO_LARGE`), removing the parts
  already written; `discardWhenDone` removes the files when the response closes. Project uploads (64 MB per file, 1000 files, 1 GB in
  all), the package importer (`MAX_PACKAGE_BYTES`) and the CIR (16 MB, 100 files, 256 MB; it was memory storage) use it.
* **Clients.** Studio saves objects with the hash it opened (it sent `''`); Publication sends `pmc.hash`; Publish settings sends
  `version` and keeps the new one; the ancillary page sends the page hash; the JSS and JSG editors reload the merged document after a
  merged save (toast); the CIR upload asks "Replace …?" on `CIR_EXISTS` and resends with `baseHashes`. e2e specs `00-platform`,
  `jsg-editor`, `publish-waivers` send the hash in their direct PUTs (not run).
* **Merged with main 54874d8.** The JSS/JSG editor behaviour lives in WP-21's shared host (`editors/host/useDocEditor.tsx`): every save sends the loaded hash; a save the server merged (D22) reloads the merged document; a 409 `STALE_DOCUMENT` (an overlapping part) opens WP-21's banner and "Compare and merge…", whose save names the hash it compared against; a 423 `CHECKED_OUT` is shown as the server's message naming the holder. Migration 023 follows WP-12's 022; `wp12-migrations` takes the duplicate and gap cases from the tip of the list, and its pending-migration case makes 022 and every later step pending (it checks 022's index).

Tests: new `test/wp11-integrity.test.js` (registered in `scripts/ci/test-plan.json`):
* an injected failure before the rename leaves the old file and no temporary file; the start-up sweep;
* **G-REL-2 kill harness**: a child process rewrites a 3 MB / 5 MB file in a loop and is SIGKILLed at 100 random points: 0 torn files;
* **guard presence from the live route table** (`createApp()._router.stack`, marker `isVersionGuard`): the 10 content-write routes must
  carry it; every other project PUT/PATCH must be on an exemption list with a stated reason, and every exemption must name a real route;
* 428 without a version and 409 with a stale one on dms, pmc, settings, jss, jsg; `If-Match` accepted;
* an injected history failure: save → 500 `REVISION_FAILED`, file unchanged; delete → refused, module kept; a hand edit on disk is kept
  as `on-disk`;
* JSS and JSG: 3 saves → 3 revisions, exact bytes back, restore guarded and adding a revision;
* D22: two chapters (JSS) and two sections (JSG) merged; the same chapter → 409 `STALE_DOCUMENT` naming it;
* leases: one holder, 423 naming the holder, another chapter free, renewal, an author's break refused, the owner's break audited, an
  expired lease taken over, the holder still saves;
* **G-REL-4**: 500 rounds of two authors saving a DM from one version (1,000 saves): 500 accepted, 500 refused, 0 silent overwrites;
  JSS same chapter, 50 racing rounds: exactly one winner each;
* an upload over the 256 MB CIR total → 413, no files left behind.

Existing tests now name the version they read before each PUT (admin-ops, api, applic-external, brex-gate, dmtypes, fo-guard,
golden-xignal, html-gate, jsg-engine, jsg-ispl, jsg-word, jss-authoring, jss-cover-isolation, jss-naval, jss-rwi-verify,
jss-stencil-corrections, jssdm-http, pm-multi-ref, publish-gate, publish-waivers, wp02-routes, phase13, settings-hostile-input,
cir-links); the `phase13` CIR test checks the new replace rules. `wp10-seams` lists `023-document-leases` (WP-12 holds 022).

Limits / not done:
* PERF-010 RSS acceptance not met: uploads stream to disk, but the package importer still reads the whole archive into memory for its
  analysis. Not measured.
* No lease UI (check-out button or holder badge in the file tree or editors); leases work through the API and the editors show the 423
  message.
* PUB-029 (derived files out of the project folder) deferred to WP-15 (job directories). PUB-021 not done, including the per-project
  build lock (PUB-021 a).
* The settings save still writes the house template before the project part is validated (a refused project part can leave a changed
  template).
* SEC-017 "guard-bypassing XML is accepted" not addressed beyond the replace rules.
* The merge is by part only: cross-part data (numbering, front matter) is in the frame and conflicts as a whole; the identity record
  (`doc-identity.json`) is a separate file, atomic but not merged.
* Not run: Playwright, the full backend suite, the gate, full vitest.

## Phase 4

### WP-21 Editor host contract and unified editor chrome (UX-003, UX-002, UX-017, UX-012, UX-020, FE-021, FE-025, PRD-004, GAP-004) - done, with the limits listed

Decision D16 taken as the audit recommends: the chrome, panels and modes are unified, the three canvases (Studio, JSS sheet, JSG
sheet) are kept as they are. No feature removed: the parity check reports 0 removals (routes 72, rail 23, commands 113 -> 115, keys
125 -> 153, test ids 372 -> 398, tests 275 -> 310).

* **The host** (`frontend/src/editors/host/`): `saveState.ts` (one vocabulary: Saving… / Save failed: retry / Unsaved changes (n
  documents) / Saved HH:MM / All changes saved), `useEditorLayout.ts` (Editor | Split | PDF, divider by pointer and arrow keys,
  focus mode, `reveal()`; per-format storage `agastya.<format>.view|split|focus`; **Write is the default of a new session**),
  `EditorHeader.tsx` (one header: lead, title, document, state chip, page actions, Commands Ctrl+K, shortcuts F1, focus Ctrl+., the
  "Editor layout" group, theme), `useHostKeys.ts` (Ctrl+K / Ctrl+Shift+P, F1, Ctrl+., Ctrl+F / Ctrl+H, Esc; never while a dialog is
  open or when the editor already handled the key), `CommandPalette.tsx` (the header actions, the host commands and every toolbar
  button of the editor, `data-cmd`, by name; the hidden toolbar tab is opened before its button is pressed), `ShortcutsDialog.tsx`
  (from `lib/editorShortcuts.ts`, so the dialog and the registry cannot drift), `FindBar.tsx` (JSS find and replace),
  `merge.ts` + `ConflictDialog.tsx` (three-way line merge: patience anchors + LCS; per-change and per-conflict choice; the merged text
  is parsed and validated by the server before it is saved), `useDocEditor.tsx` (the JSS/JSG contract: load, save, check, generate,
  drafts, conflict banner, leave guard, deep link) + `DocEditorShell.tsx` + `DocPdfPane.tsx`, `testIds.ts` (the old test ids
  written out in full so the parity scan still sees them where they are drawn).
* **JSS** (`JssEditorPage.tsx`, now an adapter): the shared header with every former button and id (Check, Save, packages, Convert,
  Export project, Generate PDF); Write by default, Generate opens the PDF pane; **find and replace** (UX-017: count, next/previous,
  replace, replace all as one Undo step, match case; CSS Custom Highlight with the `--paper-find*` tokens); palette and shortcuts
  dialog (UX-017); compare and merge on a refused save; focus mode.
* **JSG** (`JsgEditorPage.tsx`, the same adapter shape): same header and keys (Ctrl+F/H stay the JSG editor's own find bar);
  autosave, Word import, Convert (UHB), Export kept; the Word import's `window.confirm` became a ConfirmModal "Replace this
  handbook?" (GAP-002, WP-35's finding, done in passing); the ISPL editor gets its own shortcuts list.
* **S1000D** (`EditorPage.tsx`, `PdfPane.tsx`, `lib/studioSession.ts`, `studio/ui/app.ts`, `studio/ui/commands.ts`): the shared header
  (the data-module panel toggle as its lead); `save-state` always shown, `save-now` beside it while unsaved; in Write, Quick preview
  and Generate are drawn in the header (same ids, one place at a time) and open the PDF pane; the Studio's ribbon **folds to its 32 px
  tab strip** by default inside the platform (a tab click shows that tab until a command is used, Esc or a click elsewhere; the pin,
  a double-click on a tab or Ctrl+F1 keeps it open; remembered; standalone Studio unchanged); new commands `view.ribbon` (Ctrl+F1)
  and `view.focus` (Ctrl+.), Ctrl+K added to `tools.palette`; the refused-save dialog gains "Compare and merge…" (base = the text the
  hash stands for, kept per open module; the merged text is checked with the Studio's schema+BREX validation before it is saved over
  the other version).
* **Focus mode** (all three): the project rail, the side panels and the PDF step aside; `html[data-editor-focus]`; slim header.
* **GAP-004**: `goToModule` in `jss/editor.ts` and `jsg/editor.ts` honours `#n` (the n-th id-less section of that title, as
  `xengine/outline.ts keyOf` numbers them); a deep link that matches nothing shows `goto-missing` instead of silently landing at the top.
* **Registry and parity**: `lib/editorShortcuts.ts` gains the `host.*` entries and `shortcutsFor()`; `editorShortcuts.test.ts` and
  `scripts/parity/scan.mjs` scan the three host files. CHECKLIST.md sections 5, 13 and 14 filled in.
* **Measured** (`e2e/wp21-editor-chrome.spec.ts`, fresh profile, 1366x768, Write): S1000D `.editor-host` 61.3% (80.6% in focus),
  JSS host 86.5% (95.6%), JSG host 86.0% (95.6%). Before: 28.9% (UX-002).
* **Tests**: new `editors/host/merge.test.ts` (10) and `editors/host/FindBar.test.ts` (3; it caught a live-Range bug in Replace all:
  a change to a text node moved the other matches in it); new e2e `wp21-editor-chrome.spec.ts` (12: header, keys, palette,
  shortcuts, focus and the 55%/70% measures per editor; Esc; Ctrl+S/Ctrl+F per editor; JSS find/replace; JSS compare-and-merge;
  deep link; the folding ribbon; no sideways scroll at 683/820/1024 px). `00-platform.spec.ts` "Quick preview and Generate live
  together in the panel on the right" now first checks the header slot and switches to Split (Write is the default now).
* **Runs**: `wp21-editor-chrome.spec.ts` alone on port 4071 with msedge after `vite build`: 12/12 on the last run (earlier runs found
  the Replace-all bug above and a Studio XML-view find check that had to accept CodeMirror's own search panel). Not run: the main e2e
  suite (the lead's), the visual suite, full vitest, the backend suite, the gate.
* **Limits**: after the JSS find bar is closed with Esc, Ctrl+S did not save in the e2e run (the find bar now hands the focus back to
  the sheet, but that was not enough there; the Save button and Ctrl+S with the caret in the text work, both tested); the spec saves
  with the button at that point and this is open for WP-22. The Problems pane as a bottom drawer of at most 25% height (06 section 7.2) is not done; Esc leaves focus mode in JSS and
  JSG, in the Studio the Studio's own Esc (clear the selection) comes first, so Ctrl+. or the header button leaves it there; the
  visual baselines of the three editors (`e2e/visual`) change (new header, folded ribbon, Write default) and need re-capturing by
  whoever runs the visual suite; the server still writes `t:` keys for id-less sections (preferring ids server-side is not in
  this package); the JSG compare-and-merge path is the JSS one (same hook) but only the JSS path has an e2e test.

### WP-22 Navigation, project home, problems and review workflow (UX-007, UX-008, UX-009, UX-013, UX-014, UX-021, UX-024, UX-025, UX-029, FE-015, FE-016, PRD-003, GAP-003, GAP-006, GAP-008) - done in part (see limits)

Branch `worktree-agent-ae54629ef365272f3` (from `fdfbc27`). Nothing was removed: `check:parity` PASS with no new explanation row.

* **Where am I (UX-007, UX-009)**: every project page except the editor has a breadcrumb bar (`ProjectShell`, `project-bar`: Projects or
  Repository / project name / section, plus Jump to). The rail gains a first item **Home** (not for CIR) and a pin at its foot (`rail-pin`,
  remembered in `agastya.rail.pinned`) that writes the labels out (176 px rail); unpinned it stays icon-only with tooltips, as `00-platform.spec` guards.
* **Project Home (UX-013, PRD-003 part)**: `/projects/:id/home` (`ProjectHomePage`): Continue (the last data module or document opened in this
  browser, `lib/continueDoc.ts`), Check (counts of the last run, reviewed count, Run check for S1000D with `validate.run`), Review (state, round, open
  comments), Build (last build); "Needs attention" (open comments, changes requested, a release waiting for the user's decision, errors, unplaced or
  missing modules, a stale build) and "This week" (with `activity.read`). The summary route returns `review` and `problems.reviewed` for it.
* **Quick switcher (UX-021)**: Ctrl/Cmd+K outside the editors (the editors keep Ctrl+K for their command palette) and a "Jump to… Ctrl K" button in
  the top bar and in the project bar (`components/QuickSwitcher.tsx`, the WP-21 `CommandPalette` with its own wording): pages, the project's
  sections, every project the user can open, and the S1000D project's data modules. Registered as `platform.jump` in `editorShortcuts.ts`; the
  parity scanner reads its key handler.
* **One problems model, team "reviewed" marks (UX-008, FE-015)**: `lib/problems.ts` (one `Problem` shape, one severity wording, adapters from the
  Validation page, the document editors and the server). Backend `services/problems.ts` + `routes/problems.ts`: `GET /api/projects/:id/problems`
  (last run joined with the marks and the brex waivers), `GET|PUT /api/projects/:id/problems/reviewed` (PUT: reviewer and up, capability
  `problems.review`, audited `problems.reviewed` / `problems.unreviewed`). Marks are stored in `problem-reviews.json` in the project folder (atomic
  write, as `publishWaivers.ts`), not a migration, to stay clear of WP-11/WP-16. The Validation page shows who marked and when; marks kept in the
  browser before are moved to the server once.
* **Comments in the editor (GAP-006 part, FE-016)**: a Comments button in the shared editor header of all three editors (S1000D, JSS, JSG) with the
  open count; a side panel listing the open comments (those of the open data module first), Open the data module, Done/Reopen (`review.comment`),
  "show done"; Alt+Shift+N / Alt+Shift+P step through them; Escape closes the panel. Same data as the Release page (`contentApi.release`).
* **Problems drawer (WP-21 open item)**: the Studio's bottom pane is at most 25% of the window (CSS and the drag clamp, 60% -> 25%), Escape in it hides
  it; the JSS problems list is capped at min(190px, 25vh) and closes with Escape.
* **JSS Esc then Ctrl+S (WP-21 open item)**: the JSS editor listens for Ctrl+S on the document (not only inside the paper) unless a dialog is open or
  the key was handled; unit test in `jss/editor.test.ts`, browser test in `wp22-navigation.spec`.
* **Errors and connection (UX-025 part)**: an error boundary around the page outlet of both shells (`error-boundary`: Try again, Reload, Copy
  details), reset on navigation. The existing `server-unreachable` banner now also follows failed fetches and 502/503/504 answers, clears on the next
  good answer, polls every 5 s, and follows the browser `offline`/`online` events. The audit log adds filters by user and by day and shows an IPv4
  address without `::ffff:`.
* **Publication page (GAP-003)**: add a section to a chapter (only where the stencil leaves sections to the author), add an appendix and delete one
  (JSG; a JSS document has no appendices in its model), and Redo beside Undo; the edits go into the document through the same `applyToJss`/`applyToJsg`
  as the other edits (`lib/docPublication.ts`, tests in `docPublication.test.ts`).
* **Wizard (UX-024)**: the model code and the enterprise code show an example and the rule before input; the model code last used in this browser
  is offered (`wiz-mic-last`).
* Recorded decisions: opening a project still lands in the Editor (owner rule; Home is the first rail item and in the switcher). Marking a finding
  reviewed is now a team action for reviewers and up; a viewer used to keep private browser marks and now sees the button disabled. The drawer cap
  also limits how far a user can drag the Studio's bottom pane (25% instead of 60%), in the platform and the standalone Studio. Rail labels are not
  renamed and Explore/Publication are not merged into a Structure page (guarded by e2e and the owner's layout; left to WP-35).
* Verified (2026-11-27): frontend `tsc --noEmit` clean; vitest `src/editors src/parity src/lib/editorShortcuts.test.ts src/components src/styles
  src/jss src/lib/docPublication.test.ts src/lib/problems.test.ts` 22 files / 348 tests pass; `lint:theme` 0 literals; `vite build` OK;
  `check:bundle` PASS (advisory: entry stylesheet over its 30 KB advisory budget, as before); `node scripts/ci/lint.mjs` ratchet unchanged;
  `check:parity` PASS. Backend `tsc` clean; `wp22-problems` 4/4, `authz-matrix` 6/6 (snapshot regenerated for the 3 new routes, reviewed),
  `wp10-seams` 11/11, `routes-guarded` 1/1, `wp13-permissions` 3/3. Browser: `e2e/wp22-navigation.spec.ts` alone on port 4091 (Edge) 7/7 (keyboard
  for the pin, Home, Ctrl+K, marking reviewed, Alt+Shift+N, Esc+Ctrl+S). Visual/a11y suite on port 4092: first run 61 passed, 6 failed (the six screens below, all the intended project bar/rail change), baselines updated, then a full re-run 67 passed, 7 skipped (the keyboard tests skip the dark project by design: "keyboard behaviour does not depend on the theme"); axe and keyboard tests all pass, none allow-listed.
* Baselines updated (looked at each diff: the 40 px project bar and the Home and pin rail items, nothing else): `e2e/visual/__screenshots__/{light,dark}/{publication,validation,release}.png`.
* Not done: the Overview/Workspace/Projects merge and the sample buttons (UX-014: `00-platform.spec` creates samples from /workspace while projects
  exist; left to WP-35 with the shell redesign); presence and edit leases on Home (PRD-003: needs WP-11's version guards); a per-user "show code"
  preference (GAP-008: no per-user preference store yet, the switch stays per project); imported-fixture browser tests of comments (GAP-006 beyond
  the sample); new screen captures for the user guide (UX-029); comment markers in the editing surface margin (only the panel list); ellipsis on
  Activity card titles (UX-025 rest); the full e2e suite, the full vitest and the gate were not run (port 4050 belongs to the lead).
* Fix after the merges (2026-11-27): `e2e/doc-pages.spec.ts` "a section is dragged into another chapter..." failed from ce025dc on (its second
  drag changed nothing, Save never appeared, the serial spec stopped there). Bisected on frontend/src only: passes at f514f38 (WP-11), fails at
  7c2d9ea (this WP-22 merge). Cause: the 40 px project bar (the row sits 62 px lower in all) pushes the moved section, last in chapter 2, below the
  950 px window, so Playwright's `dragTo` presses on it after scrolling it into view and then scrolls back to the target before the first move;
  Edge/Chromium start no drag when the page scrolls between press and move (no `dragstart` was fired). Not a product fault: the WP-11 frontend
  fails the same way at an 850 px window, and the current frontend passes at 1150 px. The test now scrolls the moved row to the bottom edge and
  asserts both rows are fully in view before the same `dragTo`; its assertions are unchanged. doc-pages 14/14, wp22-navigation 7/7,
  wp21-editor-chrome 12/12 alone on port 4103 (Edge); frontend `tsc`, vitest `src/parity`, `check.mjs` and `lint.mjs` clean.

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
### WP-24 Release engineering: signing, SBOM, integrity, offline verification (DEP-003, ENT-014, RES-005, DEP-020, DEP-006, DEP-014, DEP-019, DEP-026, ENT-007, DEP-024, RES-006, DEP-013)

* **Signing as one configured step** (`scripts/release/signing.mjs`): `AGASTYA_SIGN_THUMBPRINT` (+ `AGASTYA_SIGN_STORE`; certificate store or
  hardware token, the only route for a public certificate after the CA/B Forum rules of 1 March 2026) or `AGASTYA_SIGN_PFX` + `AGASTYA_SIGN_PASSWORD`;
  `AGASTYA_SIGN_TIMESTAMP_URL`; `AGASTYA_SIGNTOOL` (default: newest x64 signtool of an installed Windows SDK, fallback `Set-AuthenticodeSignature`);
  legacy `AGASTYA_SIGN_CMD` kept. The packager signs every PE file of the stage that carries no signature (vendor-signed `node.exe` / JRE keep
  theirs), Inno signs Setup and the uninstaller through `signing.mjs --sign` (password never on the ISCC command line), `--show` prints the set-up.
* **Integrity**: `MANIFEST.sha256` (format `agastya-manifest/1`, SHA-256 + size of every shipped file, runtime-owned paths excluded) inside the
  product, `SHA256SUMS.txt` over all release outputs; both get a detached signature (`agastya-detached-signature/1`, RSA-PKCS1/ECDSA-P1363 SHA-256,
  certificate embedded) by `scripts/signing/Sign-Manifest.ps1` with the Authenticode certificate. Verifiers: `scripts/release/verify-release.mjs`
  (build side, run by the packager as its last step), `scripts/signing/Verify-Release.ps1` (customer side, PS 5.1, shipped beside Setup), and the host
  (`packaging/host/Integrity.cs`): `AgastyaCtl --verify [--require-signed]`, `--doctor` quick / `--doctor --deep`, and a quick check in the background
  at every server start (log line + Application-log warning). The manifest signer must equal the Authenticode signer of `AgastyaCtl.exe`
  (WinVerifyTrust, cache only, no revocation fetch).
* **SBOM** (`scripts/release/sbom.mjs`): CycloneDX 1.5, no network, content-derived serial number; npm packages from what the stage really ships
  (lockfile integrity as hash; a package not in the lockfile at that place/version is marked and refuses a `--release`), web-client npm from the
  frontend lockfile, non-npm components from `packaging/bundled-components.json` with file hashes. Written into the product and the release folder;
  `--check` validates it (against the stage when given).
* **Release mode** (`--release`): refuses unsigned, untimestamped (unless `AGASTYA_SIGN_ALLOW_NO_TIMESTAMP=1`, recorded), dirty tree, lockfile drift,
  empty `copyright`/`url` in `packaging/product.json`, missing `docs/EULA.txt`; the final verification then requires signed + time-stamped.
* **Support and deployment**: `AgastyaCtl --support-bundle [file]` (`packaging/host/SupportBundle.cs`, allow-list ZIP, line redaction of
  passwords/Bearer/Basic/session cookies/argon2+scrypt hashes, no database or project data); `--doctor` now FAILs on an unusable ini value (WARN for
  an unknown key) and reports integrity. `packaging/deploy/Detect-AgastyaPlatform.ps1` (uninstall key `{AppId}_is1` + file version);
  `docs/DEPLOYMENT-KIT.md` (silent commands, Inno exit codes, detection rule, Intune/ConfigMgr/GPO recipes, Windows support matrix with NOT VERIFIED rows).
* **Gates**: `scripts/ci/readiness.mjs` G-SEC-11a (Setup + both host exes Valid and time-stamped), G-SEC-11c (verify-release signed+timestamped),
  RES-005 (SBOM checks and is covered by the sums), G-DEP-4 (host.test.mjs), G-DEP-3 (detection, with `--install`), DEP-013 (installed `--verify
  --require-signed`); G-DEP-6 fixed (`--doctor`, was `doctor`). `scripts/ci/gate.mjs`: new `release-tools` stage from `test-plan.json`
  `scriptTests`, package stage = release-tools, package (`--release` in the release profile), verify-package, verify-release.
  `scripts/vm-acceptance/Test-InstallerInVm.ps1` gained `-RequireSigned` and a WP-24 block (signatures, `--verify`, seeded fault, start-up log line,
  support bundle without db/admin password) - parse-checked only, **not run** in a guest.
* Docs: `docs/SIGNING.md` (rewritten), `docs/DEPLOYMENT-KIT.md` (new), `docs/OPERATIONS.md`, `docs/PACKAGING.md`, `docs/BUNDLED-COMPONENTS.md`.
* Recorded decisions: the start-up integrity check is log-only (never blocks an air-gapped site); a detached-signature format of our own instead of
  CMS/catalog files (verifiable by Node, PS 5.1 and .NET 4 without extra tools); unsigned third-party PE files are signed by us, vendor signatures
  are never replaced; a release ships exactly the lockfile.
* Verified (2026-11-27): `scripts/release/release.test.mjs` 8/8 and `scripts/release/host.test.mjs` 6/6 (throwaway certificates in temp folders;
  tampering: changed byte, same-size change, missing file, planted DLL, foreign signer, edited manifest; doctor seeded faults; support-bundle canaries;
  detection against a throwaway HKCU uninstall key, removed afterwards); `node scripts/ci/lint.mjs` exit 0; `node --check` on the changed scripts.
  A **complete package** was built with signing on, into a scratch folder (Node 24.22.3, installer included, a throwaway self-signed `.pfx`
  `CN=Agastya WP-24 Package Test Only`, no time stamp): 12 of 84 PE files signed by us, 72 vendor-signed, SBOM 261 components (148 backend npm),
  manifest 2,437 files, signed manifest and sums, packager self-verification OK (2 warnings: no time stamp). Independently re-checked with
  `Verify-Release.ps1 -Thumbprint ... -RequireSigned` (OK), `AgastyaCtl.exe --verify --require-signed` on the stage (intact) and
  `verify-release.mjs --release` (OK). The certificate-store mode was exercised once: the same throwaway certificate imported into
  **CurrentUser\My only**, signtool + `Sign-Manifest.ps1` by thumbprint, verified, and the certificate and its key deleted straight after. No other
  store was touched; the scratch folder (pfx, password, package) was deleted. That first package run had found a real bug (SBOM compared the shipped
  `node_modules` with the lockfile and failed on a nested `ms`); fixed by listing what ships and marking drift.
* Not done / blocked: **real certificate** (owner, decision D4) and therefore a time-stamped signature (no TSA reachable here); the VM matrix and
  no-NIC runs (G-OFF-1/3/4, Windows 10/11/Server 2019/2022, ARM64) need guest images; the new VM-harness block was not executed; Intune/ConfigMgr
  run of the detection rule (no tenant); MSI (WP-31/D6); unattended first administrator from the installer (WP-25); structured JSON logs and
  Event-Log security events (WP-29); low-disk / stopped-service / TLS-certificate doctor faults; the release installer in `release/` was not rebuilt.
### WP-16 One validation framework and shared helpers (S1K-002, S1K-003, S1K-006, S1K-007, PUB-022, ARC-007, ARC-008, ARC-018, PUB-028) - done in part (see limits)

Behaviour-preserving unless stated; decisions taken from the audit's recommendations (no owner question).

* **Validation framework** (`services/validationFramework.ts`, 03 section 4): one finding model (`Issue`, `issueOf` = the former private
  `norm`), rule sets per standard (`RuleSet`: id, standard, `applies(input)`, `run(input)`), one runner (`runRuleSets`: in order, a
  `setImmediate` turn before each set, as WP-32 put between the scans) and `summarise`. A rule set takes plain data (`ValidationInput`: ids,
  folders, issue in use, flags) and returns plain data, never a request, so WP-14 can run it in a worker. `validation.ts` keeps the schema
  stage (well-formedness, XSD, extensions: what it finds decides what the others read) and lists the S1000D rule sets
  (`S1000D_RULE_SETS`: applic, graphics, ids, icn, pm, brex; BREX only when asked and only for an S1000D project). Same issues, same order,
  same notes, same messages; the only difference is one more event-loop turn (before BREX). `Issue`/`Severity` are re-exported from
  `validation.ts` for the existing importers.
* **Format-neutral gate (S1K-006)** (`services/publishChecks.ts`, a leaf): `registerPublishCheck({ format, owns, check })`, the S1000D check
  registered by `publishGate.ts` as the default, the JSS check by `jss/service.ts` when the engine loads (the `documentCreators` pattern of
  WP-10; `app.ts` and `publisher.ts` load it). `assertPublishable` is one line; `publishGate.ts` no longer imports the JSS service. Messages
  and codes unchanged (`NOT_S1000D` for a one-module preview of a JSS document). JSG keeps publishing through its own engine
  (`assertJsgPublishable`) and is not registered: registering it would change what the S1000D publish route does for a JSG project.
* **Waiver subjects (S1K-002)** (`publishWaivers.ts`): `waiverSubject()` takes the issue/language suffix and `.xml` off and folds the case, at
  write time (stored as the gate names it) and at match time (a stored older waiver still matches); a missing `DMC-` prefix is accepted.
  Matching is now equality of the normalised subjects. Changed on purpose: the former `endsWith` match let a waiver for `022A-D` cover every
  BREX ending so, and a file-name subject (`..._001-00_EN-US.XML`) was accepted (201) and never matched; now it matches.
* **One source for the XSD-pattern translator and the BREX value forms (S1K-003, ARC-008)**: `backend/src/shared/xsdRegex.ts` and
  `backend/src/shared/brexValues.ts` (`valueMatches`, `contextApplies`, `isXPath2`; no Node, DOM or outside imports, checked by the test).
  The backend compiles them; the Studio imports them by relative path (`frontend/src/studio/validation/brex.ts`, `ui/panels.ts`);
  `frontend/src/studio/core/xsdRegex.ts` and `backend/src/services/xsdRegex.ts` are gone. `vite.config.ts` lets the dev server read that
  folder (`server.fs.allow`: the default root plus `backend/src/shared`); `scripts/package-windows.mjs` treats a change there as making
  `frontend/dist` stale. The BREX parse and document walk stay per runtime (xmldom + `xpath` vs the browser DOM); the parity suite stays as
  the guard. The frontend `isXPath2` had `matches` twice in its alternation: same semantics.
* **Shared helpers (PUB-028, S1K-007)**: `backend/src/lib/xml.ts` (`escText` & < >, `escAttr` & < > ", `readAttrs`) and `lib/hash.ts`
  (`sha256`, `sha256File` streamed in 1 MB blocks, `sha256FileOr`). Replaced: the 14 `esc` copies (each caller keeps the variant it had:
  `escAttr` where the copy escaped `"`), the 6 attribute escapers built on them (`escA`/`escAttr` in jsg/docx, jsg/service, jss/service,
  jss/rwi/canonical, jss/rwi/serialize, jssdm/toDms, and the inline one in xengine/jsg-model), `importer/xmlScan` `escapeText/escapeAttr`
  (now re-exports), the 5 named hash helpers (`csdbIndex.sha`, `jss/service.sha`, `jsg/service.sha`, `jss/rwi/exporter.sha`,
  `publishGate.sha` = `sha256FileOr`) and the streaming file hash of `packages.ts`; the attribute reader of `csdbIndex`, `csdbObjects`,
  `lifecycle`, `sns/dms`, `findings`, `packages`, `projectConfig` (2) and `jssdm/fromDms` is `readAttrs` (re-exported by `xmlHead.ts`, as
  S1K-007 asked). Exported names (`esc`, `sha`, `escA`, `escapeText`) are kept as re-exports, so no importer changed. Left on purpose:
  the two serialisers that escape attributes as `& " <` without `>` (`miniXml.ts`, `importer/xmlScan.ts` setAttrs) - switching them would
  change bytes the importer writes; the inline hashes that slice or hash JSON (`applicEval`, `jss/ancillary`, `release` digest Buffers).
* **JSS document projects (PUB-022, ARC-018)**: `projectRecord.assertS1000dPublication(projectId)` (409 `JSS_PROJECT_PROTECTED`, the guard's
  message) is called by the writers themselves: `pm.writePm` (PUT pmc, import/assign, placeNewDm, sample), the `pmc/import` route before it
  writes, `importer/apply.applyImport`, `sns/service.applyDerived` and `jssdm.generateForProject` with `pm: 'merge'`. `routes/jss-guard.ts`
  stays as defence in depth (decision: no global allow-list middleware, the audit's own recommendation is "decide inside the writers").
  Found while doing it: `POST sns-rows/derive` with `apply` (one of the "NOT VERIFIED" writers of ARC-018) was not in the guard's list and
  its writer did not check the project kind (on a JSS project without data modules it stopped at "empty publication"; with modules in the
  CSDB nothing stood between it and the JSS document - read from the code, not reproduced on the old build); it is now refused with 409. Kept as designed: a NEW JSS project made from an S1000D package
  (`POST /api/projects/import`, format jss) takes the package's publication (`xengine-import-wizard.test.js` "keeps the data"), so the
  package importer does not assert; `packages/import` into an existing JSS project is refused by the guard as before.
* New test `test/wp16-validation-framework.test.js` (default backend stage: `test-plan.json` lists only the special stages): lib helpers
  pinned (escapes, attributes, 2 MB streamed hash, the services hand out the shared functions); the duplicate scan (no escaper, hash helper,
  attribute reader, XSD translator or BREX value-form function outside `lib/` and `shared/`, the Studio copy is gone, both runtimes import
  `shared/`, `shared/` is runtime-free); the framework (normalisation, order, skipped set, a turn between sets, S1000D rule-set list and the
  BREX condition); the gate registry (JSS check owns a JSS project, the S1000D one is the default, a probe format plugs in without touching
  the gate, `publishGate.ts` code has no JSS reference); waiver subjects (file name = bare code = no prefix; a different BREX and a mere
  suffix do not match; the second form replaces instead of adding); and the table of every route that can write publication.xml on a JSS
  project (PUT pmc, pmc/import, import/apply, import/assign, packages/import, dms-import, sns-rows/derive apply, jssdm/generate merge: 409
  and the file byte-identical) plus the writers called below the routes (writePm, applyImport, applyDerived: 409).
* Verified (backend `tsc` 0 errors, frontend `tsc --noEmit` 0 errors, `scripts/ci/lint.mjs` green with `any.backend` lowered 280 -> 279
  (the untyped `norm` parameter went); each backend file alone, `--test-concurrency=1`, `AGASTYA_CLIENT_DIST` at the main checkout's
  `frontend/dist`): new `wp16-validation-framework` 6/6; `wp32-validation-scale` 8/8, `wp32-validator-crash` 1/1, `brex` 16/16,
  `applicability` 4/4, `repeated-dm-ids` 6/6, `extensions` 5/5, `jss-authoring` 12/12 (1 skip: stencils not in the checkout),
  `importer-repairs` 19/19, `importer-scan` 16/16, `importer-structure` 12/12, `jssdm` 20/20, `jssdm-http` 9/9, `wp10-seams` 11/11,
  `wp10-storage-contract` 10/10, `publish-waivers` 2/2, `html-gate` 1/1, `html-publish` 6/6, `csdb-objects` 4/4, `import` 5/5,
  `importer-http` 12/12, `packages` 10/10, `project-formats` 4/4, `routes-guarded` 1/1, `settings-hostile-input` 6/6, `sns` 16/16,
  `sns-http` 10/10, `sns-polish` 4/4, `sns-separation` 6/6, `lifecycle` 5/5, `lifecycle-reinstate` 2/2, `jsg-engine` 7/7, `jsg-ispl` 5/5,
  `wp07-jsg-deep-path` 1/1, `xengine-convert` 7/7, `xengine-import-wizard` 4/4, `xengine-legacy-import` 5/5, `xengine-identity` 11/11,
  `xengine-content-types` 2/2, `xengine-pictures` 2/2, `pm-multi-ref` 5/5, `object-docs` 4/4, `api` 17/17, `phase13` 12/12,
  `import-enterprise-refusal` 2/2, `wp06-lifecycle` 5/5, `brex-gate` 3/3 (962 s), `publish-gate` 21/24 then the three failures re-run
  alone 4/4 (with the 5-0 setup): the three were HTTP 500 from `EPERM ... rename ... %TEMP%\jsspub-s1000d-catalog.xml` in
  `vendor/engine/catalog.js` - every process on the machine writes that ONE temp file, and other agents' suites ran at the same time
  (a pre-existing shared-temp race, not touched here; worth its own fix: a per-process catalog name). Frontend: `brex-parity` 4/4
  (AGASTYA_VERIFY=1, against this build of the server engine), `lib/waivers.test.ts` 12/12, `vite build` to a scratch folder bundles
  `backend/src/shared` (the Studio chunk contains the shared code). Not runnable here: `brex-xpath` (needs a native `xmllint` on PATH;
  4/4 fail with no libxml2 counts, an environment limit).
* `wp32-event-loop` (limit 100 ms) did not hold on this machine under the load of the parallel agents (CPU at 99 %, validation 16-21 s
  instead of 11.6 s). A/B on the same load, the 8a04aa2 build against this one, alternately: base 82.8 / 140.1 ms, WP-16 131.9 / 86.4 /
  119.3 ms (two more single runs of WP-16: 95.3 ms pass, 136.2 ms). The stall is one BREX check of one module stretched by the load
  (WP-32's stated limit, WP-14's job); the runner adds no work to a turn. To be re-checked by the lead on a quiet machine.
* Not done, and why:
  - ARC-007 document model (JSS/JSG vocabulary in `jss/rwi/canonical.ts`, `xengine/jsg-model.ts`, `frontend/src/jss/xml.ts`,
    `frontend/src/jsg/xml.ts`): the copies have already diverged in output (the editor writes `indent="none"`, drops empty marks,
    self-closes an empty `xref`, writes a chapter `orientation` and a section title on the section's own line; the backend canonical model has none of these, and the two name a
    notice's content differently).
    One shared module therefore changes what the converters or the editor write: a behaviour decision with the round-trip suites, not a
    mechanical refactor. Recommended as its own change: the editor's writer (the superset) moved to `backend/src/shared/`, the canonical
    model extended to it, `xengine-convert`, `jss/jss.test.ts`, `jsg/jsg.test.ts` as the guard.
  - ZIP: `services/zip.ts` (the weak writer) guards the backup, which WP-12 (in parallel) owns; `importer/zipRead.ts` was left beside
    `zipio.ts`. PNG encoders: the vendor copy stays (ARC-007 says so).
  - `serial` (2 job chains) and `runTool` (process runner): WP-14's job service, as 03 section 3 recommends. `paths.ts` / `atomic.ts`: WP-11.
  - Frontend escapers (`studio/core/xml.ts` and the JSS/JSG editors' own) were not part of the PUB-028 count and were not touched.

## Phase 7

### WP-29 Audit trail, retention and operations (ENT-003, REL-008, ENT-017, ENT-020, RES-004; gates G-SEC-4, G-SEC-5, G-REL-8) - done, with the limits listed

Decisions taken from the audit (no owner question): an HMAC-SHA-256 hash chain with the key in a file outside the database (not a
signature per row, not an external timestamping service, which an air-gapped site cannot reach); signed checkpoints kept in three places
(database, backup folder, Windows Application log) so a cut at the end is visible; critical actions fail closed, all others go ahead and
are flagged (ENT-003); a reason is kept for every waiver change, and a waiver may expire, at most 3 years ahead (ENT-017); stable event
ids 4100-4199 written by the existing host program, no new agent (RES-004); the event source is registered at install time only.

* **Migration 025-audit-chain** (additive; after WP-11's 023-document-leases and WP-27's 024-directory-groups-permissions). `audit_log` gains `seq, prev_hash, row_hash, chain_key` (via the idempotent
  `columns` mechanism); new `postSql` step (runs after columns; in the checksum only when present) adds the unique `ix_audit_seq` and
  `ix_audit_actor`; tables `audit_checkpoints`, `audit_chain_anchor` (one row), `publish_waiver_events`. Rows from before keep `seq` NULL
  and are counted "before the chain", never rewritten.
* **Chain** (`core/auth/auditChain.js`, `store.appendAudit`): each row's HMAC covers its canonical content and the previous hash; the
  append reads the head and inserts in one IMMEDIATE transaction (or a SAVEPOINT inside a caller's); `store.tx` is now re-entrant through
  savepoints. Key: `AGASTYA_AUDIT_KEY_FILE`, default `<data>\audit-key\audit-hmac.key`; the packaged host points it at
  `<state>\keys\audit-hmac.key`. Made on first start; a damaged key file stops the start; the offline tools never make one.
* **Verification** (`services/auditTrail.ts`, `storage/auditOffline.ts`, `scripts/agastya-audit.js verify`, `AgastyaCtl --verify-audit`,
  `GET /api/admin/audit/verify`, the daily housekeeping job, `npm run doctor` and `--doctor` rows): names edited, deleted, forged and
  outside-the-chain rows, rows under another key, invalid checkpoint signatures, a tail cut and a rebuilt chain against a checkpoint.
  Exit 0/1/2. A failure raises event 4101 and notifies administrators. Retention archives only a prefix of the chain and records the anchor
  in the same transaction. Checkpoints: with every backup, every `AGASTYA_AUDIT_CHECKPOINT_HOURS` (24), and on demand.
* **Fail closed** (`appContext.auditStrict/auditedTx`, `AuditUnavailableError` 503 `AUDIT_UNAVAILABLE`): sign-in, platform role and account
  enable/disable/update, project membership (add, assign, role change, remove), release approve/reject (both routes), backup restore. Any
  other failed audit write: counted on the Security page, `<data>\logs\audit-failures.log` (with `critical`), event 4100.
* **Coverage** (G-SEC-5, `test/wp29-audit-coverage.test.js`, readiness G-SEC-5b): every POST/PUT/PATCH/DELETE in `src/routes` and
  `core/auth/routes.js` audits or is on a reasoned allow-list (27 entries; stale entries fail too). It found two gaps, now audited:
  identity visibility (`identity.visibility`) and review comment resolve/reopen.
* **Fingerprint** (ENT-020): `release.requested`, `release.approved`, `release.rejected` carry the content hash.
* **Export and viewer**: `GET /api/admin/audit/export?format=csv|jsonl&action&actor&project&from&to` streams every row (2 000 a page,
  back-pressure), itself audited; the maintenance `audit.csv` lost its 5 000-row cap; the viewer filters by person, project and inclusive
  time. Admin UI: filters, filtered CSV/JSON Lines export, "Verify chain" with the problems; Security page shows the last verification.
* **Waivers** (ENT-017): history (added/replaced/removed with reasons) returned with the list and shown on the Publication page; removal
  asks for a reason; optional expiry (30/90/180 days) in the record dialog; an expired waiver no longer applies and is marked.
* **Security events** (`services/securityEvents.ts`): 19 ids (table in `docs/OPERATIONS.md` section 13, kept equal by a test), raised from
  the audit writer by action, plus a failed-sign-in burst (5 in 15 min, once per window) and the throttle. Sinks: the JSON log, stdout
  `##agastya-event|id|level|text` when `AGASTYA_EVENT_SINK=host`, and a test sink. Host (`packaging/host/AuditTools.cs`): parses those
  lines (ids 4100-4199 only) and writes `EventLog.WriteEntry(source, text, type, id)` when the source exists; `AGASTYA_HOST_EVENTLOG=off`
  keeps tests out of the real log; `--verify-audit`; doctor row; support bundle includes `agastya-server.jsonl`; the packager ships
  `agastya-audit.js`.
* **Structured logs** (`services/log.ts`): JSON lines on stdout in production (`AGASTYA_LOG_FORMAT`), always a rotated
  `agastya-server.jsonl` (`AGASTYA_LOG_DIR`, `_MAX_MB` 10, `_KEEP` 5), redaction of passwords, argon2/scrypt/bcrypt hashes, session
  cookies and Bearer/Basic values; an access line per request with the route template (`AGASTYA_ACCESS_LOG`).
* Verified (backend `tsc` 0 errors; each file alone, `--test-concurrency=1`, `AGASTYA_CLIENT_DIST` = the main checkout's `frontend/dist`):
  new `wp29-audit-trail` 11/11 (G-SEC-4: edited, deleted-middle, forged, unchained-insert rows each detected, CLI exit 1; newest 10 rows
  cut detected against the backup-folder checkpoint with the database checkpoints deleted, and against an auditor's `--checkpoints` file;
  forged checkpoint reported; wrong key, missing key (exit 2, no new key), damaged key stops the start; chain survives backup + restore into
  a new folder and continues; retention anchor; G-REL-8: role change, sign-in, release approval and membership refused with 503 and rolled
  back, ordinary sign-out goes ahead with counter, `audit-failures.log` and event 4100, chain still intact; 20 000-row JSONL and CSV export
  with filters; events 4120/4110/4111, host line format, every id in OPERATIONS.md; waiver history, expiry, reasons; JSON log lines parse,
  seeded secrets absent, rotation keeps 2), new `wp29-audit-coverage` 2/2, `wp10-storage-contract` 12/12 (new audit/anchor/waiver-event
  case), `notifications` 6/6, `admin-ops` 8/8, `wp12-backup-restore` 7/7, `wp12-migrations` 10/10, `wp10-seams` 11/11, `authz-matrix` 6/6
  (snapshot regenerated: exactly the 5 new audit routes added), `routes-guarded` 1/1, `auth-http` 10/10, `api` 17/17,
  `publish-waivers` 2/2, `phase13` 12/12, `wp07-small-fixes` 4/4, `wp04-reset-admin` 1/1, `wp03-auth` 11/11, `auth-core` 11/11, `rbac` 7/7.
  Host: both executables compile with the packager's `csc` flags without warnings; new `scripts/release/host-audit.test.mjs` 2/2 (event-line
  parsing incl. refusals; `--verify-audit` 0/1/2 and the doctor OK/FAIL/WARN rows on a real data folder), `host.test.mjs` 6/6. Frontend:
  `tsc --noEmit` clean; vitest `audit-viewer` 3/3, `publish-waivers-history` 3/3, `importRefusal` + `PlatformBackups` + `a11y` 15/15.
  `scripts/ci/lint.mjs` green. Tests registered in `scripts/ci/test-plan.json` (security stage; host-audit in release-tools); readiness
  G-SEC-5b now runs the coverage test and a G-SEC-4 row runs the trail test.
* Not done / limits: someone holding both the database and the key can rebuild the chain, and a tail cut is only visible against a
  checkpoint taken after the cut rows (documented, OPERATIONS.md section 13). Playwright, the full backend suite, the gate and full vitest
  were not run (by instruction); `e2e/publish-waivers.spec.ts` was adapted to the new removal dialog but not executed. The host's event
  writing to a real Application log was not exercised (tests use `AGASTYA_HOST_EVENTLOG=off`); registering the source stays an install-time
  step. The frontend was not rebuilt.
* **Merge with main ea34c5b (WP-11, WP-22, WP-25, WP-27).** Migration renumbered 025. WP-27's read-only auditor: the reading audit routes -
  verify (now `GET`, since an auditor may not POST), checkpoint list, export, event list - are `requireGlobal('audit.read')`; taking a
  checkpoint stays `requireAdmin`; WP-27's guards on `GET /api/admin/audit` and `maintenance/audit.csv` kept, with WP-29's behaviour (no
  cap, streamed, inclusive `to`); an auditor's verification and exports are audited (test). Fail closed extended to WP-27's group
  membership, group deletion, project group grants, capability rules and directory mappings (`critical()` in `routes/access.ts`), and to
  WP-11's check-out BREAK (`leases.checkIn` takes the transaction wrapper; the release and its row commit together). Security events: those
  actions map to 4121/4120, a check-out break to 4150, and `user.updated` with WP-27's `auditor` or `auth_source` to 4120. Coverage: WP-27's
  17 routes, WP-22's reviewed marks and WP-11's history/check-out routes all audit (directory sync is allow-listed: the service audits
  every outcome). WP-25's `AgastyaCtl` scripts (first-admin, the backup tool) get the server's key file. The audit viewer keeps WP-22's
  `plainIp`; its client-side who/day narrowing is replaced by the server-side person/project/date filters (which also reach the export).
  Verified after the merge: backend `tsc` clean; `wp29-audit-trail` 11/11 (now incl. auditor access and group / group-grant fail-closed),
  `wp29-audit-coverage` 2/2, `wp27-directory` 15/15, `wp27-permissions` 7/7, `wp11-integrity` 16/16, `wp22-problems` 4/4, `wp10-seams`
  11/11, `wp10-storage-contract` 14/14, `wp12-migrations` 10/10, `wp12-backup-restore` 7/7, `authz-matrix` 6/6 (snapshot diff against
  main: exactly the 5 audit routes), `routes-guarded` 1/1, `auth-http` 10/10, `api` 17/17, `admin-ops` 8/8, `publish-waivers` 2/2;
  `host-audit` 2/2, `host` 6/6, `update` 6/6; both host executables compile without warnings; frontend `tsc` clean, vitest
  `audit-viewer` + `publish-waivers-history` + `problems` 11/11, `frontend/scripts/parity/check.mjs` PASS; lint green; Playwright
  `e2e/publish-waivers.spec.ts` alone (port 4098, Edge) 8/8.
## Phase 8 (continued)

### WP-27 Directory sign-on, central administration and fine-grained permissions (ENT-005, DEP-015, PLT-016, ENT-023; ENT-022 and RES-003 not done) - done in part (see limits)

Branch `worktree-agent-ae6519e7918fa58ba` (from 54874d8). Owner approval: implement without asking; decisions below take the audit's
recommendation.

* **Directory sign-on (ENT-005, DEP-015).** A second provider behind the WP-03 `AuthProvider` seam (`core/auth/directory.js`), chosen when
  `config.directory` is set; otherwise the local provider exactly as before (Mode A unchanged, proved by `wp27-permissions` test 1 and the
  unchanged auth suites). LDAPv3 over **LDAPS only** (`core/auth/ldap.js`: BER encoder/decoder, simple bind, search, unbind; TLS 1.2+,
  certificate verified against `AGASTYA_DIRECTORY_CA_FILE` or the system store). Service bind, then a typed filter search for the person
  (user-supplied text is never pasted into a filter string; RFC 4515 escaping is not needed because filters are encoded as BER structures),
  then a bind as the person's DN (an empty password is refused before any bind: no unauthenticated-bind bypass). Groups from `memberOf`,
  or Active Directory's in-chain rule (`1.2.840.113556.1.4.1941`) when `AGASTYA_DIRECTORY_NESTED_GROUPS=1`. Several URLs are tried in order.
* **Group-to-role mapping and JIT provisioning.** `directory_group_map` (Administrator > Directory sign-on): a directory group DN gives a
  global role (admin / project_manager / author / auditor) and/or feeds a local group. Strongest role wins; auditor only when it is the only
  role. First sign-in creates the account through `provisionUser` (no local password: hash `!directory`); later sign-ins update name, role
  (never demoting the last active administrator) and the directory-fed group memberships (local memberships are kept).
* **Offboarding.** At sign-in (unknown, disabled in AD via `userAccountControl`, or in no mapped group) and in a periodic sync
  (`services/directorySync.ts`, every `AGASTYA_DIRECTORY_SYNC_HOURS`, first run 15 min after start; *Sync now*). Sessions end. An account the
  directory disabled (`disabled_reason='directory'`) is reinstated when the directory lets it in again; one an administrator disabled is not.
  A sync that would disable every directory account (2 or more) changes nothing (`directory.sync.failed`).
* **Break-glass.** A local account name never consults the directory; directory down -> `503 DIRECTORY_UNAVAILABLE` for domain sign-ins
  only; the last local administrator cannot be switched to the directory (`BREAK_GLASS_REQUIRED`). Password change / reset / forgot refuse
  directory accounts (`409 DIRECTORY_ACCOUNT`).
* **Central administration and fine-grained permissions (PLT-016, ENT-023)** through the existing guard/capability system, so the authz
  matrix and the `can` map remain the single source of truth:
  - Groups (`access_groups`, `access_group_members`) and project group grants (`project_group_grants`): a person's project role is the
    strongest of membership, folder and group (`authz.evaluate`).
  - Capability rules (`project_capability_rules`, per project, subject user or group, `allow` / `deny`): evaluated in `requireProject` for the
    route's declared `cap`. Deny wins (`403 CAPABILITY_DENIED`); allow lifts the role-ladder refusal for that one capability. Owners and
    software administrators are never affected; `project.access` itself is never subject to rules. The project card's `can` map applies the
    same rules (`permissions.canFor`).
  - Auditor (read-only) role: a flag on the account (`users.auditor`), not a fourth global role (keeps every `role` check unchanged). Viewer on
    every active project, the user list and the audit log (`requireGlobal('access.read' | 'audit.read')`, a new guard class in the matrix);
    every non-GET refused (`403 READ_ONLY_ACCOUNT`) except its own sign-in gates.
  - No escalation: nobody grants a project role above their own (`ROLE_ABOVE_YOURS`).
  - Administrator > Roles lists every capability with its minimum role (`/api/admin/roles` `capabilities`).
  - Routes: `routes/access.ts`; SQL in `repositories/accessRepository.ts` (wp10 seam; contract case added); migration
    `024-directory-groups-permissions` (additive).
* **UI.** Administrator > Groups, Administrator > Directory sign-on (`pages/AccessAdmin.tsx`), Project settings > Access (group grants and
  single-action rules), Users list shows *Directory* / *Auditor* / *Offboarded by the directory*, *Make auditor*, no *Reset password* for
  directory accounts. Docs: OPERATIONS.md section 5 "Mode B: directory sign-on" and "Auditors and fine-grained permissions".
* **Decisions recorded.**
  - No LDAP library is in `node_modules` and none can be installed offline: a small own LDAPv3 client (bind/search/unbind only), tested
    against an in-process fake LDAPS server (`test/helpers-ldap.js`).
  - LDAPS only (no plain LDAP, no StartTLS): meets AD channel binding / signing requirements without SASL.
  - A directory URL in Mode A is a start-up error (desktop keeps local accounts).
  - Configuration by environment variables (`AGASTYA_DIRECTORY_*`, typed in `config.ts`); an `agastya.ini [directory]` section is left
    to the launcher owner (WP-25 was changing the launcher in parallel).
  - Migration 023 (`023-document-leases`) is WP-11's file copied verbatim (commit 0011621) because `checkOrder` refuses a gap; if WP-29 or
    another package also took 024, the lead renumbers at merge (the file content is independent).
* **Tests run** (each file alone, `node --test --test-concurrency=1`): `wp27-directory` 15/15, `wp27-permissions` 7/7, `authz-matrix` 6/6
  (snapshot regenerated with `AGASTYA_UPDATE_AUTHZ_SNAPSHOT=1` and reviewed: 17 new routes, `GET /api/admin/users`, `/audit`,
  `/maintenance/audit.csv` moved from `requireAdmin` to `requireGlobal(...)` with the same answers for every existing role plus the auditor
  column; the auditor gets 403 on every write except the 7 `/api/auth/*` gate routes), `auth-core` 11/11, `auth-http` 10/10, `wp03-auth`
  11/11, `rbac` 7/7, `routes-guarded` 1/1, `wp13-permissions` 3/3, `wp10-seams` 11/11, `wp10-storage-contract` 12/12, `admin-ops` 8/8,
  `ws-broadcast` 5/5, `settings-hostile-input` 6/6, `wp06-lifecycle` 5/5, `wp26-network` 9/9 (one earlier run failed test 7, the
  Mode B TLS test, under the parallel agents' load; a re-run alone passed 9/9, and the file was not changed). Backend `tsc` clean; lint ratchet unchanged
  (any.backend 279, require 46). Frontend: `tsc --noEmit` clean, `vitest` `pages/AccessAdmin.test.tsx` 4/4, `PlatformBackups.test.tsx` 2/2;
  `check:parity` PASS. Not run (per the brief): Playwright, the full backend suite, the gate, full vitest.
* **Not done, and why.**
  - A test against a real Active Directory: external (steps in OPERATIONS.md).
  - Kerberos / NTLM integrated sign-on, TOTP second factor, OIDC/SAML (RES-003, optional): not in this package; LDAPS bind covers Mode B on a
    domain network. OIDC would be a third provider behind the same seam.
  - ENT-022 classification-based export control (P3, optional): not started.
  - A Playwright journey for the new screens: not written or run (the brief excludes Playwright here).
### WP-25 Standalone installer, launcher, offline update and rollback, Mode A (DEP-023, QA-009, PRD-005; gates G-DEP-1/2/5, G-REL-3) - done, with the limits listed

* **Versioned program folder** (`packaging/host/Update.cs`, `AgastyaHost.cs`): each version's full tree lives in `<install>\versions\<version>\`.
  `current` and `previous` are pointer files, written atomically. `AgastyaPlatform.exe` and `AgastyaCtl.exe` at the root are a launcher: copies of
  the current version's, refreshed by renaming the old file aside, so a running launcher never blocks an update. A flat 2.0.0 install, portable copy
  or dev tree is moved into `versions\<ver>` on its first update. `state.dir`, `portable.flag`, the `agastya.ini` lookup and the service binPath use
  the install folder, never the version folder. New commands: `--versions`, `--prune-versions`, `--repair-launcher`. `--doctor` shows the version
  folder, launcher drift, the versions kept and WebView2.
* **Offline update package** `.agupdate` (`scripts/release/update-package.mjs`): the packager builds it as step 10b and lists it in SHA256SUMS.
  `--no-update` skips it; release mode requires it to be signed. It is a ZIP holding:
  - `update-info.txt`: format, product, app-id, version, min-from-version, commit, manifest hash, counts, notes;
  - `update-info.txt.sig`: the WP-24 detached signature;
  - `payload/`: the whole tree with its signed `MANIFEST.sha256`.

  Each package carries the full tree; there are no deltas.
* **`AgastyaCtl --verify-update <file>` and `--apply-update <file>`**:
  - **Verified before anything changes:** safe entry names; signature; trust; product and app-id; newer version; min-from range; every payload file
    streamed against the manifest; completeness; disk space. The signer is trusted when it matches the Authenticode signer of the installed
    `AgastyaCtl.exe`, the signer of the installed manifest `.sig`, or a `[update] TrustedThumbprints` entry. An unsigned package needs
    `--allow-unsigned`.
  - **Apply:**
    1. Stop everything. Stopped means the port no longer answers and `.agastya-server.lock` holds no live pid. There is no fixed wait.
    2. Make a **pre-update platform backup** with `backend/scripts/agastya-backup.js --kind pre-update`, then verify it with a test restore.
    3. Copy the DB files while the server is stopped.
    4. Extract the package (zip-slip guard, new files only).
    5. Switch the pointers and start the new version.
    6. **Health check:** `/api/version` must report the expected version and `compatible:true`, then `/api/ready` must return 200, within
       `HealthSeconds` (default 60).
  - **On failure, automatic rollback:** the pointers go back, the DB files are restored from the stopped-state copy, and the old version is started
    and checked. The failed DB is kept in `backups\failed-update-...`.
  - Exit codes: 0/1/2/10/11/12/13/14/20/21/22 (`docs/OPERATIONS.md` section 8).
  - Writes `update-history.txt` and `logs\update-*.log`. Keeps `KeepVersions` old versions (default 2). `--rollback [--restore-db]` rolls back by
    hand.
  - The Add/Remove Programs `DisplayVersion` follows updates and rollbacks, so the WP-24 detection rule stays right.
* **Setup** (`packaging/installer/agastya.iss`):
  - Installs into `versions\{#AppVersion}` plus the launcher.
  - `PrepareToInstall` runs the new `AgastyaCtl --install-dir {app} --prepare-upgrade`, which stops the server and makes a verified pre-update
    backup. If that fails, Setup exits with 7 and nothing has changed. The old `Sleep 4000` stop and the plain DB copy are gone.
  - `ssPostInstall` runs `--activate`.
  - Upgrades skip the data and port pages.
  - The firewall rule is bound to the port, because node.exe moves with each version.
  - `/ADMINUSER=` and `/ADMINPASSWORDFILE=` create the first administrator unattended through `backend/scripts/first-admin.js`. The password goes on
    stdin only; it is temporary and must be changed at the first sign-in. Nothing happens if an admin already exists.
  - Uninstall keeps the data unless `/PURGEDATA` is given or the user answers Yes (default No). `--remove-data --confirm` refuses drive roots,
    profile and system folders, and the program folder.
  - Version folders, pointers and history are removed with the program.
* **Window and WebView2 (PRD-005)**:
  - The host detects the Evergreen WebView2 runtime (the EdgeUpdate client `pv` value).
  - It opens the UI as an Edge app window (`msedge --app=`). Without Edge it falls back to the default browser and shows a tray notice.
    `[app] Window=auto|app|browser` chooses.
  - `/api/version` reports `shell.webview2` and `shell.window` (`backend/src/config.ts`, `app.ts`).
  - The build never downloads Microsoft's offline runtime installer. When `packaging/redist/MicrosoftEdgeWebView2RuntimeInstallerX64.exe` is present,
    it ships in `redist\`. Setup runs it on a machine without the runtime, and every offline update runs it again.
* **Other changes:**
  - `scripts/verify-installer.mjs`, `Verify-Release.ps1 -Tree` and `verify-release.mjs --tree` follow `current` into the version folder.
  - `Test-InstallerInVm.ps1` expects the version folder and the port-bound rule (parse-checked only).
  - The support bundle carries the newest update, rollback and setup logs.
  - `agastya.ini.template` gained an `[update]` section.
  - Docs: `OPERATIONS.md` sections 1, 2, 8, 9 and 10; `DEPLOYMENT-KIT.md`; `PACKAGING.md`.
* **Recorded decisions:**
  - **An Edge app window, not an embedded WebView2 control.** The WebView2 SDK is not available offline. The Edge window uses the same engine, in a
    separate window.
  - Update packages carry the full tree, no deltas.
  - The installed version's Ctl applies an update. The new version's backup tool is used only when the installed version has none.
  - A Setup upgrade gets the verified backup and a one-command `--rollback`, but **no automatic health-checked rollback**: by then Inno has replaced
    the launcher.
  - A rollback restores the DB files only. Project files are covered by the pre-update platform backup.
  - Trust on install: the installed signer is the anchor.
  - KeepVersions 2; HealthSeconds 60.
  - Migrations stay additive. `--rollback` without `--restore-db` refuses (exit 22) when the previous version cannot open the newer database.
* **Verified (2026-11-27).** Every run used throwaway self-signed `.pfx` files in temp folders; no certificate store was touched. Every install went
  into `%TEMP%`.
  - `scripts/release/update.test.mjs`: 6/6, against the real `agastya-backup.js` and `first-admin.js` with the compiled backend. Covered:
    - refusals (unsigned, stranger signer, tampered payload, older, same, min-from, truncated zip), with the program and DB byte-identical afterwards;
    - a good update, with the pre-update backup re-verified and the launcher refreshed;
    - a broken update (DB break, `/api/ready` 503): exit 20, the DB byte-identical, the failed DB kept aside;
    - pruning with KeepVersions=1;
    - `--rollback` twice, and `--restore-db`;
    - flat adoption;
    - `--prepare-upgrade` and `--activate`;
    - first-admin run twice (the second run changes nothing);
    - `--remove-data` refusals.
  - `scripts/release/installer.test.mjs`: 1/1 with **the real Inno installer**.
    - Two Setups (1.0.0 and 1.1.0, random AppId) built with ISCC.
    - Installed with `/VERYSILENT /CURRENTUSER /DIR=%TEMP%\...` plus `/ADMINUSER` and `/ADMINPASSWORDFILE`: the admin was created.
    - Upgraded with a verified backup.
    - `--rollback`: the launcher and Add/Remove Programs back at 1.0.0.
    - Uninstalled keeping the data, reinstalled, then uninstalled with `/PURGEDATA`.
    - Afterwards its HKCU uninstall key, Start-menu folder and temp folder are gone (checked).
    - A first run failed on a real bug: the ini template path after the move to `versions\`. It is fixed in `agastya.iss`, and a missing template is
      now logged instead of passing silently. I removed that run's leftover Start-menu folder by hand.
  - Also run and passing:
    - `scripts/release/host.test.mjs` 6/6;
    - `scripts/release/release.test.mjs` 8/8;
    - backend `test/wp13-version.test.js` 4/4;
    - `npx tsc -p .`;
    - `node scripts/ci/lint.mjs` (exit 0);
    - `node --check` on the changed scripts;
    - the PowerShell parse of `Verify-Release.ps1` and `Test-InstallerInVm.ps1`.
  - `installer.test.mjs` and `update.test.mjs` are registered in `test-plan.json` `scriptTests.release-tools`.
* **Not done or blocked externally:**
  - The clean-VM matrix (G-DEP-1/2 on Windows 10/11/Server, per-machine install, service path) and the VM harness changes were not executed.
  - The **service** update path (stopping and starting the Windows service) is coded, but only the console path was run.
  - No real certificate or time stamp (D4).
  - The WebView2 offline redist binary is not in the repository (it is a Microsoft download, under Microsoft's licence). The WebView2-missing path on
    a Server SKU was not tried.
  - No full `npm run package:win` with the update package; it needs `frontend/dist` and the bundled runtimes.
  - G-REL-3 was not run against a real previous release; only the synthetic 1.0.0/1.1.0 stages.
## Phase 6

### WP-35 Screen-by-screen redesign of the remaining screens on the design system (GAP-002, UX-025, UID-*, 08 section 8.2) - done in part (see limits); branch `wp35-redesign`

Rule followed: no feature lost. Parity (`node scripts/parity/check.mjs`) PASS with nothing removed, so no explanation row was needed;
the baseline was re-captured with `npm run parity:update` at the end. Owner-removed screens stay removed (CSDB page, System 2 SNS,
Brand pack, applicability UI, Codes strip and button, PMC/ICN/contents switches). Opening a project still lands in the Editor.
D20 (take the audit's recommendations and mockups) applied where the change is safe; what was not taken is listed below.

* Batch 1 (158416f), groups 1, 2, 3, 14, 16:
  - Dialog service (GAP-002): `lib/dialogs.ts` (`confirmDialog`, `promptDialog`, `alertDialog`; promise API that the framework-free
    JSG editors can call) and `components/DialogHost.tsx` (each request a `Modal`; testids `app-dialog`, `app-dialog-confirm`,
    `app-dialog-cancel`, `app-dialog-input`; a dangerous action focuses Cancel). Every native `confirm`/`prompt`/`alert` replaced:
    ErrorBoundary (copy details), CIR (replace in repository), EditorPage (discard unsaved), PublicationPage (empty save, replace by
    import), JsgAncillaryPage (reload saved handbook), JSG editor (last chapter names the chapter), ISPL editor (delete plate names the
    plate with its view and part counts, delete appendix, remove the only view, two Paste rows now a multi-line prompt).
    `lib/dialogs.test.tsx` is an architecture test: no native dialog call in any non-test source file.
  - Password field: `components/PasswordInput.tsx` (Show/Hide toggle with `aria-pressed`, Caps Lock notice in a status region tied
    with `aria-describedby`, re-hidden 60 s after blur) on all 12 password inputs. The repeat-password check (Setup, Onboarding,
    forced change, Settings) marks the repeat field and focuses it; nothing is sent while they differ.
  - Context menu: `components/ContextMenu.tsx` (right click, Shift+F10 or the ContextMenu key; arrows, Home/End, Escape) on the
    Projects rows (Open, Copy project...) and on Workspace folder headings (New project here, Folder access, Rename, Delete). Each
    entry repeats an action that is still on the page.
  - Samples: the three sample buttons sit behind one `samples-menu` disclosure (ids of the three buttons kept) on Overview,
    Projects and Workspace.
  - Auth screens: link-styled buttons instead of `href="#"`, inline styles moved to classes, footnote "Offline · on-premises".
* Batch 2 (6636f1b), groups 2, 6, 9, 11, 12: sidebar grouped (work / Library / Manage headings, active page bar), CIR hint, account
  menu on classes; Overview and Oversight sections on the design-system classes and a main/side grid; ActivityView titles truncate
  with a full title (UX-025); Release: task column wide, watermark in a narrow column (kept visible: the platform e2e fills it);
  Publish waivers explanation in a disclosure whose summary states the rule (draft builds only).
* Batch 3 (6b9863c): Structure (Explore, Validation, Publication, ancillary) and editor-host CSS moved out of the entry stylesheet
  into `styles/pages/structure.css` and `styles/pages/editor-host.css`, loaded with their lazy chunks (entry 68.1 -> 63.1 KB).
  A clash fixed before commit: the new grid class first reused `.v2-split`, the editor/PDF splitter (keyboard divider test caught
  it); it is `.v2-cols-main`. New `e2e/wp35-redesign.spec.ts`.
* Specs adjusted for moved selectors (no assertion weakened): `jsg-editor` (paste in the app dialog; samples menu first),
  `00-platform` (samples menu before `create-sample`; NOT run here, the main suite is reserved), `zz-core-routes` (Forgot / Back to
  sign in are buttons), `wp05-dataloss` FE-005 (also asserts no app dialog), `AuthScreens.test` (submit is the non-toggle button).
* Tests run (all on this branch): `tsc --noEmit` clean; vitest `src/editors src/parity src/components src/styles src/lib src/pages`
  28 files, 343 tests passed; `lint:theme` 0 colour literals; `scripts/ci/lint.mjs` ratchets ok; `vite build` ok; `check:bundle`
  PASS (entry stylesheet 63.1 KB, still over the 30 KB advisory); visual/a11y/keyboard (port 4096, msedge) 67 passed, 7 skipped
  (the keyboard spec skips its dark-theme copy by design); e2e alone on port 4095: `wp35-redesign` 4/4, `jsg-editor` 11/11,
  `wp05-dataloss` 10/10, `zz-core-routes` 5/5. Not run (by the brief): full vitest, backend suite, gate, main e2e suite.
* Visual baselines updated after looking at each diff (15): light+dark administrator, overview, projects, publication, release,
  sign-in, workspace; light settings. Changes: nav groups and active bar, Samples button, Show toggle, auth footnote, Release grid,
  waiver disclosure; administrator/settings/overview also gain the WP-22 "Jump to" button that was never re-baselined there.
* Decisions (recorded for the owner): Overview, Workspace and Projects not merged into one page, Explore and Publication not merged
  into one Structure page, rail labels not renamed - each is guarded by owner layout e2e and touches pages that parallel WPs edit;
  the Release watermark stays visible; no backup-restore hint (it would describe behaviour not verified here); Settings keeps Sign out.
* Not done, and why: the Structure and Overview/Workspace/Projects merges (above); the tooltip codemod (UID-003) across all icon
  buttons; new designs for the remaining 08 section 8.2 screens (Graphics, Validation, JSS editor chrome, Administrator - the last
  left to WP-27); entry stylesheet still 63.1 KB against the 30 KB advisory (the remaining bulk is shared shell/component CSS);
  Caps Lock e2e uses events carrying the modifier state (headless browsers do not toggle Caps Lock); owner sign-off pending.

**Second pass (2026-11-27, branch `worktree-agent-a178eccaa8b3d75e5` from `ce025dc`, main `b173829` merged in).** Rule kept: nothing lost;
`check:parity` PASS with nothing removed and no explanation row; baseline re-captured with `npm run parity:update` (routes 76, rail 26,
commands 115, keys 162, test ids 486, tests 344: the additions are WP-28's ids and the new unit test).

* **UID-003 (5184de1)**: `IconButton` in `components/ui.tsx` (aria-label + title; `FocusTooltip` shows the title on keyboard focus).
  Nineteen icon or glyph buttons completed (Modal close, toast dismiss, the PDF viewer's outline/page/zoom/match/twisty, S1000D
  catalogue Edit/Delete, preset node delete, backups delete, JSG ancillary remove, team remove, folder access remove, publish settings
  remove). Architecture test `components/iconButtons.test.ts` parses every `.tsx` with the TypeScript compiler and fails on an icon-only
  `<button>` (no letter or digit in its children) without both `aria-label`/`aria-labelledby` and `title`; it has its own non-vacuity
  cases. The framework-free editors build buttons with DOM calls, so the runtime rule `icon-button-tooltip` (serious) joins
  `e2e/visual/a11y-audit.ts`: it runs on the ten named routes in both themes (the Studio, JSS and JSG editors among them) and is proven by a
  planted defect in `a11y.spec.ts`. No allow-list entry.
* **Graphics (9cc7ae1)**: both Graphics pages without inline styles; the tile thumbnail shows its transparency checkerboard again (an
  inline `background: none` had hidden it); zoom buttons carry a tooltip and a focus ring; `styles/pages/graphics.css` with the chunks.
* **Validation (2a7e0fe, presentational only, separate commit for WP-14)**: mockup `validation.html`: one filter bar (each severity chip
  shows its count, "n of m shown"), list beside a sticky detail panel, file group headings, a Reviewed badge on reviewed findings (the
  dimming stays), the detail as a term list. Run, issue choice, WP-22's problems model and server marks, CSV and the jump are untouched.
* **Administrator (a297dc9)**: Administrator, Users and Audit logs (Settings.tsx), Groups, Directory sign-on and Project Access
  (AccessAdmin, WP-27), S1000D catalogue and Numbering, platform backups: over a hundred inline styles replaced by
  `styles/pages/admin.css` (section heading, layout helpers, maintenance cards with the action at the foot); the section navigation is a
  card with an accent bar on the current section. Every control, route and test id kept; WP-29's audit viewer only restyled.
* **Editor chrome (b516b29)**: inside WP-21's host, the header title, comments panel, merge dialog and JSG autosave switch lose their
  inline styles; the header/focus-mode/comments CSS loads with the editor chunks. TeamChip (WP-28) untouched. A header separator was tried
  and dropped (it led the wrapped second row).
* **UX-014 and the Structure page: not merged (recorded decision).** The conditions of the brief cannot all hold: `00-platform.spec`
  asserts the sidebar links Overview, Workspace and Projects (line 109) and that sign-in lands on `/overview` (`toHaveURL(/\/overview$/)`,
  lines 541 and 1000), and it asserts the rail items Editor, Explore, Publication, ... (line 155); `doc-pages.spec` asserts the rail links
  Explore and Publication and the headings "Explore"/"Publication" (lines 48, 172). A merged page behind redirects changes those
  assertions, which the brief forbids; keeping them all would make the merge two tabs that are the same two pages. Rail labels not renamed.
* **Entry stylesheet (44a7af3)**: 62.0 KB (63.1 at the first pass, plus WP-28) -> 55.1 KB. Editor-only rules (split, divider, data-module
  panel, PDF bar and placeholder, import dialog tiles/diff/progress, embedded Studio containment and the narrow-window media block that
  overrides them) into `editor-host.css`; Notifications, Project Home and the preview pop-out get page sheets; `pdf.css` (pdf.js text layer)
  is imported by the viewer. Rules that `states.css` styles at equal specificity (`v2-dm`, `v2-chap`, `v2-filter`, `v2-link`) stay in the
  entry so the state rules keep winning; admin gap/margin helpers carry the extra class so they never depend on sheet order. The rest of
  the entry is tokens.css (18.7 KB, both themes, must stay) and the shell/shared component CSS: the 30 KB advisory is not reachable without
  splitting the shell itself; `check:bundle` PASS (advisory only).
* **Found and fixed on the way**: the first pass put the person's name in the account menu, against `00-platform`'s owner rule (the menu
  shows only the role) - restored (00-platform had not been run by the first pass). The merge of main brought two `window.confirm`
  calls (WP-28: break a check-out in TeamChip and WorkingNow) that the GAP-002 architecture test refuses: both now use `confirmDialog`
  (danger); `TeamChip.test` answers the dialog service and still asserts it was asked.
* Tests run (this branch, after the merge): frontend `tsc --noEmit` clean; vitest `src/editors src/parity src/components src/styles src/lib
  src/pages` 33 files, 359 tests passed (after the confirm fix); `lint:theme` 0 literals; `scripts/ci/lint.mjs` ratchets unchanged;
  `vite build` OK; `check:bundle` PASS; visual/a11y/keyboard (port 4096, msedge): 61 passed, 7 skipped (the keyboard spec's dark copy, by
  design), 6 failed on intended changes, re-baselined, then those 6 passed; a11y and keyboard all pass, none allow-listed. e2e alone on port
  4095 (msedge): `00-platform` 41/41; one runner, --workers=1, 13 specs (wp35-redesign, wp22-navigation, publish-gate, wp21-editor-chrome, jss-editor, jsg-editor, doc-pages, s1000d-config, zz-core-routes, wp05-dataloss, zz-layout-strict, zz-responsive-layout, zz-theme-states) 144 passed, 1 failed, 10 not run: doc-pages "a section is dragged into another chapter ... keeps its code" fails at its second drag (drop back before the first row of chapter 1 leaves the page unchanged, so Save never appears); it fails the same way with the frontend of ce025dc (checked out, built and run on the same backend), so it predates this pass and is NOT fixed here; doc-pages without that test: 13/13 passed.
* Baselines updated after looking at each diff (6): light+dark `administrator` (navigation card, this pass), `jss-editor` and
  `jsg-editor` (WP-22's Home rail item and pin and WP-28's Check out button, never re-baselined there: the older diffs stayed under the
  0.2 % threshold).
* Not done: the merges above (decision); the 30 KB advisory; owner sign-off of the CHECKLIST rows; the full e2e suite, full vitest,
  backend suite and gate (not run, by the brief).

## Phase 8 (Mode B team server)

### WP-28 Mode B team server: install path, multi-user operation, load acceptance, availability position (PRD-003, PRD-007, G-REL-4 under load, G-PERF-4 at the addendum's assumed scale; gates measured on a shared machine, see conditions) - done, with the limits listed

Branch `worktree-agent-a32d4a700783ef242` (from ea34c5b). Owner approval: implement without asking; decisions take the audit's recommendation.
Scale assumption (addendum 17, Q1): 25 concurrent authors (100 named users), 100 projects; acceptance at 2x = 50 scripted authors.

* **Presence (PRD-003).** `services/presence.ts`: who has which project and document open, **in memory only** (never written; the test scans
  every file of the data folder for the marker), keyed by WebSocket connection, 75 s TTL with a 25 s heartbeat, swept every 15 s; dropped at
  once on close, sign-out / session end, and when the person loses read access (`broadcast.recheck`). The socket now accepts exactly one
  inbound message type (`{type:'presence'}`, readers of the project only), max 4 KB (larger closes 1009), more than 20 per 10 s dropped and more
  than 100 closes 1008. An unchanged heartbeat sends nothing to others. `GET /api/projects/:id/presence` (viewer) gives people and leases.
* **Check-out notices.** `leases.ts` broadcasts `{type:'leases', path, part, holder, released, broken}` on a new check-out, check-in, expiry
  release and break (renewal is silent); `projectLeases` carries the file path.
* **Session and connection limits.** `AGASTYA_WS_MAX_CLIENTS` (default 1000; beyond: 503) and 8 sockets per session (beyond: 429).
* **Metrics.** `services/metrics.ts`: request ring buffers (all / writes, p50/p95/p99, in-flight, 5xx), event-loop delay
  (`monitorEventLoopDelay`), every SQLite statement timed through a proxy on the handle (slow >= 50 ms as the lock-wait proxy, `database is
  locked` counted), gauges (sockets, presence entries), memory, and the **D21 triggers** (write p95 > 200 ms, event-loop p99 > 100 ms).
  `GET /api/admin/metrics`, `POST /api/admin/metrics/reset` (admin, audited `metrics.reset`). Authz snapshot regenerated for these three routes
  (reviewed).
* **Warm standby (PRD-007).** `[backup] CopyTo` / `AGASTYA_BACKUP_COPY_DIR` (absolute, else a start-up `ConfigError`): after each scheduled
  backup the archive is copied there (`copyBackupTo`, verified), `lastCopy` recorded, `backup.copied` / `backup.copy_failed` audited,
  administrators notified on failure, copies pruned like the originals.
* **UI (small, on design-system tokens, WP-35 runs in parallel).** `editors/host/TeamChip.tsx` in the S1000D editor and in `DocEditorShell`
  (JSS / JSG): the faces of the others in the project, what they have open, the lease state of the open document with Check out / Check in /
  Break (owner, manager, admin; confirmed), a toast when a document held by someone else is released. Project Home: *Working now* card
  (`components/WorkingNow.tsx`). `lib/presence.ts` announces the open document and re-sends it after a reconnect.
* **Host and installer (Mode B install path).** `packaging/host/TeamServer.cs`:
  - `agastya.ini` `[directory]` (the WP-27 deferral), `[backup]` (`Dir`, `IntervalHours`, `Keep`, `CopyTo`, `RestoreTestDays`), `[server]
    MaxConnections`, `LeaseMinutes` -> `AGASTYA_*` (paths relative to agastya.ini); `[client] Server` / `Thumbprint`.
  - `AgastyaCtl.exe --configure-server --name ... [--bind] [--port] (--make-cert | --pfx [--passphrase-file] | --cert --key) [--firewall]`:
    material into `<state>\tls` (earlier files kept as `.old-<time>`), `[server]`/`[tls]` written, `tls\` limited to SYSTEM, Administrators,
    LOCAL SERVICE (read); the private CA key in `tls\ca\`, which LOCAL SERVICE cannot read. `--firewall` only elevated.
  - `--check-server [url]`: the client/server handshake from a client (certificate trusted or pinned SHA-256, `/api/version`,
    `minClientVersion` both ways, schema compatible); `--doctor` runs it on a client installation; `--console` / the tray on a client open the
    server and run nothing.
  - Installer (`agastya.iss`): with LAN, `ConfigureTeamServer` runs `--configure-server` before the service is registered (`/SERVERNAMES`,
    `/TLSPFX` + `/TLSPASSFILE`, `/TLSCERT` + `/TLSKEY`, otherwise a private CA for the computer name; an upgrade with TLS already configured
    is left alone); `/CLIENTOF=<url>` writes `[client] Server` and installs no service. Template: commented `[directory]`, `[backup]`,
    `[client]` sections.
* **Load harness.** `backend/scripts/load-test.js`: N scripted authors, each with its own account, a WebSocket with presence, and a mix of
  check-out / read / save / check-in on its own module, **contended saves on a shared module without a lease** (the version guard decides),
  project / module lists, dashboard, presence, optional whole-project validation; check-out notice latency measured from the action to the
  other authors' sockets; server metrics read (reset after warm-up); the harness's own event-loop delay reported. **No-lost-update proof**:
  per module, the accepted saves must form one chain of base hash -> new hash and the server's final hash must equal the chain end.
  `--drill`: backup, restore into a new folder, start a server on it, first read, all timed. `--base <url>` runs against an existing server
  (external multi-machine runs); `--profile <dir>` writes a V8 CPU profile of its own server. Exit 0 PASS, 1 FAIL, 2 could not run.
* **Measured results.** All on **this shared 8-core machine (Intel i7-6820HQ, 2.7 GHz) while other agents were building and testing**, the
  harness and the server on the same computer, loopback HTTP (no TLS on the wire), own temporary workspace, short runs (45-126 s measured
  after a 10-15 s warm-up). 50 authors throughout. Client-side times include the harness's own queueing (its event-loop p99 stayed 24-25 ms).

  | Run | Projects | Think | Measured | Requests (/s) | p50 / p95 / p99 / max (ms) | Errors | Write p95 | Notice p95 / max, >5 s | Server loop p99 / max | Statements: max, slow, locked | Server-side p95 / write p95 | Saves accepted, silent overwrites | Result |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | A normal, validation on, drill | 10 | 1-3 s | 126 s | 3,387 (26.8) | 639 / 1,957 / 3,394 / 27,702 | 0 | 1,743 | 1,710 / 3,393, 0 | 1,874 / 3,295 | 399 ms, 10, 0 | 44 / 80 | 525, 0 | PASS (D21 event loop) |
  | B normal, no validation | 10 | 1-3 s | 123 s | 6,419 (52.2) | 20 / 79 / 151 / 380 | 0 | 88 | 75 / 376, 0 | 69 / 354 | 206 ms, 12, 0 | 26 / 37 | 985, 0 | PASS, no D21 trigger |
  | C stress | 10 | 0.1-0.5 s | 61 s | 5,270 (86.3) | 363 / 653 / 828 / 975 | 0 | 673 | 636 / 886, 0 | 826 / 909 | 83 ms, 2, 0 | 35 / 49 | 816, 0 | PASS (D21 event loop) |
  | D stress, CPU-profiled | 10 | 0.1-0.5 s | 45 s | 4,907 (106.4) | 275 / 419 / 473 / 571 | 0 | 427 | 414 / 548, 0 | 459 / 550 | 66 ms, 2, 0 | 25 / 28 | 767, 0 | PASS (D21 event loop) |
  | E normal, 100 projects | 100 | 1-3 s | 93 s | 4,863 (52.3) | 17 / 46 / 76 / 194 | 0 | 57 | 43 / 73, 0 | 40 / 123 | 21 ms, 0, 0 | 20 / 22 | 770, 0 | PASS, no D21 trigger |

  Drill (run A, 1,009,065-byte archive): backup 3,710 ms, restore 2,609 ms, start to ready 1,830 ms, first read 2,192 ms, **8.5 s total**.
  Contended saves on the shared module: 122 / 254 / 195 accepted with 11 / 30 / 63 refused `409` in A / B / C; every refusal is the guard
  working, not an error. In E (100 projects, 101 modules, 107 s to seed) the 50 authors are spread over 100 projects, so each project has
  fewer watchers (455 notices) and the shared module saw no conflict (199 accepted, 0 refused): it proves the 100-project size, not contention.

  **Reading.** At 2x the assumed concurrency, at a normal working pace, the server meets the targets (B: p95 79 ms, no D21 trigger, 0 errors,
  every check-out notice within 0.4 s, no lock waits) - **except while a whole-project validation runs**: it executes on the main thread
  (p50 18.4 s at this size) and everything else queues behind it (A). That is PERF-001; it is fixed by moving validation into the job
  service (WP-14, in progress in parallel; nothing was built here). **Measured ceiling** on this machine: one CPU core, about 86-106 requests/s
  (C, D), reached at roughly 4x the normal pace of 50 people; past it, server-side handling stays at p95 25-35 ms and the waiting grows (the
  event-loop delay is the queue). The CPU profile at the ceiling: ~25% of busy time in SQLite statement execution (statements are prepared
  per call: ~5% in `prepare` alone - a statement cache is the cheap next step), ~10% in file reads / `fsync`. No `database is locked` in any
  run; the slowest statement was 399 ms (A, behind validation).
* **Decisions recorded.**
  - Clients are browsers or a client installation of the same host (`[client] Server`, `/CLIENTOF`), not a separate slim Client-Setup.exe:
    one package, one signing and update path (audit recommendation for the smallest surface).
  - Presence in memory only, per connection, no new table; check-out stays the WP-11 lease (no new locking model). No migration was needed
    (027 unused).
  - The private CA is the default on a LAN install with no certificate given (the server must not start without TLS, WP-26); the CA key is
    kept out of the service's reach and the runbook says to move it offline.
  - The firewall rule stays the WP-25 port rule; `--configure-server --firewall` exists for a hand configuration and was **not executed**.
  - Availability position as the addendum: no automatic failover; daily backup default, hourly selectable; RPO = interval; RTO measured at
    the first drill (8.5 s machine time measured here on 1 MB; the runbook asks for the customer's own number).
* **Docs.** OPERATIONS.md section 13 *Team server runbook (Mode B)*: install, `--configure-server`, ini keys, clients and CA distribution,
  presence and check-out, backup + warm standby + manual failover + drill, upgrade order and client/server version matrix, capacity with the
  measured table, metrics and D21 triggers, running the harness against a real server. Section 5 (firewall now port-bound) and the
  directory section (ini keys) updated.
* **Tests run** (each alone): backend `wp28-team-server` 6/6 (new: presence for readers only, silent heartbeat, notices within 5 s, renewal
  silent, break notice, sign-out removes presence, nothing on disk, 9th socket 429, oversize 1009, flood 1008, metrics shape/reset/403,
  standby copy ok / failure audited / relative path refused), `ws-broadcast` 5/5, `routes-guarded` 1/1, `wp10-seams` 11/11, `wp11-integrity`
  16/16, `authz-matrix` 6/6; `scripts/release/teamserver.test.mjs` 4/4 (new: AgastyaCtl compiled from `packaging/host/*.cs` without warnings
  into a temp product tree; `--configure-server` refusals change nothing; `--make-cert` writes ini + tls, ACLs checked with `icacls`, CA key
  not readable by LOCAL SERVICE; `--console` serves HTTPS with it; `[backup]`/`[server]` keys reach the server (read back from
  `/api/admin/metrics`); `--check-server` fails on an untrusted certificate, passes with the pinned thumbprint, fails on a wrong pin and for a
  0.0.0 client; a client refuses `--console`; a bad ini value stops the server with the variable named), `host.test.mjs` 6/6,
  `installer.test.mjs` 1/1 (ISCC compiles the changed script; per-user silent install/upgrade/uninstall in temp). Frontend: `tsc --noEmit`
  clean, `TeamChip.test.tsx` 4/4, theme lint 0 literals, `check:parity` PASS. `scripts/ci/lint.mjs` exit 0 (any.backend unchanged at 279).
  Backend `tsc` clean. New tests registered in `scripts/ci/test-plan.json` (`security`, `release-tools`). Load runs A-E above.
  Not run (per the brief): the main Playwright suite, full suites, the gate.
* **External (needs real machines; built and documented, not run here).**
  - Real separate client computers and network, TLS on the wire under load, a domain / Active Directory: `load-test.js --base` and
    OPERATIONS.md 13.6.
  - A clean-VM install as a real Windows service with the firewall rule and a listener scan (WP-26 left it here): no service, firewall rule
    or certificate-store change was made on this machine; the installer's LAN path (`ConfigureTeamServer`) was compiled but not executed in
    admin mode (the installer test is per-user, where LAN is unavailable). `/CLIENTOF` was compiled, not executed.
  - The first restore drill on the customer's data (RTO).
* **Not done, and why.**
  - Whole-project validation still blocks the event loop under load: WP-14's job service (not duplicated here).
  - No metrics screen (API only), to keep UI additions small while WP-35 redesigns screens.
  - No two-browser Playwright spec (presence is covered by the backend test over real sockets and the TeamChip component test).
  - DPAPI protection of the PFX passphrase file (ACL-protected file only).
  - Statement caching in the storage layer (found by the profile; not a WP-28 change).

## Phase 3 (WP-14)

### WP-14 Job service: validation, gate and publication in worker processes (PERF-001, PUB-027, PUB-003, PUB-004, PUB-005, PUB-006, DEP-028, PERF-008, PERF-012, PERF-015, PUB-031, PUB-019, FE-010, FE-028, PRD-001) - done in part (backend; see limits)

Branch `wp-14-job-service`, merged with main b173829. Migration **026-jobs**, after WP-27's `024-directory-groups-permissions`
and WP-29's `025-audit-chain`. While 024/025 were not yet on main, the branch carried two no-op placeholders so its gap check passed.
They were deleted in the merge and appear in no shipped list. The G-REL-3 matrix harness (`wp12-migrations`) now runs a step's
`postSql` after its columns, as `AuthStore.migrate` does. With 026 appended, its "stopped after the last but one step" case lands
right after 025, whose indexes are in `postSql`.

* Design (`backend/src/services/jobs/`):
  - `index.ts`, the service, holds the queue and the job records:
    - Two admission lanes. Validation (`validate`, `gate`) has 2 slots and builds (`publish`, `preview`, `configured`, `html`,
      `jsg`) have 2. Each lane is capped by the pool size, `max(1, min(cores-1, slots))`.
    - One job per project at a time, of any kind (PUB-021a: one build lock per project). Projects run in parallel.
    - A job identical to one already queued joins it instead of queueing twice.
    - Timeout: `AGASTYA_JOB_TIMEOUT_MINUTES`, default 30, answers 504 `JOB_TIMEOUT`.
    - Cancel answers 409 `JOB_CANCELLED`. A worker that dies answers 500 `JOB_WORKER_CRASHED`, with a memory hint when its peak was
      at least 80 % of the limit. An allocation the job object refuses answers 507 `JOB_MEMORY_LIMIT`.
    - Shutdown or restart marks running jobs `interrupted` with 503 `JOB_INTERRUPTED`.
    - Errors cross the process boundary serialised and are rebuilt as the same `HttpError` (status, code, message, extra), so every
      route answers exactly as before.
  - `pool.ts`, the supervisor:
    - Workers are `fork`s of `dist/services/jobs/worker.js` with `--max-old-space-size` (`AGASTYA_WORKER_HEAP_MB`, default 4096)
      and below-normal priority.
    - A worker is recycled after `AGASTYA_JOBS_PER_WORKER` jobs (50; PERF-008, so the warm JVM cannot grow without end) and ended
      after 10 idle minutes.
    - A job that must stop is ended with its whole process tree (`taskkill /T /F`). A worker crash fails its job only.
    - Under ts-node, with no compiled worker, jobs run inline; `AGASTYA_JOBS=inline` forces this.
  - `jobObject.ts`, the Windows job object (PRD-001, addendum 17), with no native dependency:
    - A PowerShell 5.1 helper compiles a small C# class (CreateJobObject, SetInformationJobObject extended and CPU-rate limits,
      AssignProcessToJobObject, QueryInformationJobObject). It holds the job open, and every worker is assigned to it.
    - Limits: per-process memory (`AGASTYA_JOB_PROCESS_MB`, half of RAM clamped to 1-8 GB), all-jobs memory (`AGASTYA_JOB_MEMORY_MB`,
      75 % of RAM), active processes (workers x 8), and a CPU rate of (cores-1)/cores.
    - `KILL_ON_JOB_CLOSE`: when the server dies by any means, the helper's stdin closes, the job closes, and the workers, their JVMs
      and any xsltproc go with it.
  - `worker.ts` runs one job at a time. It gives the warm FOP JVM `-Xmx` (`AGASTYA_FOP_HEAP_MB`, default 1536) through the vendored
    `fopd.configure` and `FOP_ARGS`, and relays progress broadcasts to the server over IPC. Workers skip migrations and the
    snapshot (`AGASTYA_JOB_WORKER=1`) and get a reduced environment: secrets and `NODE_OPTIONS`/`JAVA_*_OPTIONS` are dropped.
  - Progress (PUB-019/FE-010):
    - Worker broadcasts reach the existing WebSocket channel tagged with `jobId` and are kept in `job_log`.
    - A new `{type:'job'}` message carries state changes.
    - `GET /api/projects/:id/jobs/:jobId?after=n` replays the log, so a client that reconnects misses nothing.
  - Restart-safe records (repository `jobRepository.ts`, tables `jobs` and `job_log`, migration 026):
    - At start, unfinished records become `interrupted`.
    - Finished records older than `AGASTYA_JOB_KEEP_DAYS` (30) are purged.
    - Contract-test case added to `wp10-storage-contract`.
* Moved into workers:
  - validation (`POST /validation`, and `/findings` when it must run one);
  - the publish gate (`assertPublishable`, at release submit and approve and before every build);
  - PDF publication (`POST /publish`, `GET /publish/download` when stale, admin rebuild-pdfs);
  - server preview, configuration PDFs, the HTML package, and JSG builds.
* HTTP compatibility:
  - Every route answers as before (same bodies, same errors).
  - New: an `X-Job-Id` header; `?async=1` (or `async: true` in the body) on validation and publish answers 202 with the job.
  - `POST /publish` adds `jobId` and `report`. The report holds the build's notes (image references, security, warm FOP
    unavailable, building anyway) (PUB-031).
  - New routes:
    - `GET /api/projects/:id/jobs` (viewer)
    - `GET /api/projects/:id/jobs/:jobId` (viewer)
    - `POST .../jobs/:jobId/cancel` (reviewer with publish.build; audited as `job.cancelled`)
    - `GET /api/admin/jobs` (admin)
  - The authz snapshot was regenerated for these four routes, after review.
* Validation cache (PERF-012):
  - Validation records a fingerprint of its inputs in `.validation.json`:
    - project files by path, size and mtime;
    - the project configuration row, extensions, lifecycle, CIR links and the DM-type list;
    - the options and the build version.
  - An unchanged project answers the stored run with `cached: true`. `fresh: true` forces a run.
  - The publish gate never uses the cache.
* Vendored engine change: `vendor/engine/fopd.js` (exception "fopd bounds", recorded in S1000D_COMPLETE_IMPLEMENTATION.md
  section 10, item 9):
  - JVM arguments can be configured.
  - The exit listener of each render is removed when its reply arrives (it leaked one listener per render).
  - `pid()` was added.
* Deleting a built project: each worker's warm JVM holds the pictures it embedded (as the in-process renderer did), so
  `releaseRenderer()` now also ends the idle workers synchronously through a hook (`renderer.onReleaseRenderer`). A worker that
  is running a job is left alone. Checked by `project-delete-after-build` and by `wp14-jobs`.
* Measured:
  - Event loop during a 210-module validation with BREX (`wp32-event-loop`, limit 100 ms, not loosened):
    - Before (in-process, WP-16 log): 69-75 ms on a quiet machine; 82-148 ms under the parallel agents' load (failing).
    - After, earlier today: 30.1 / 41.9 / 43.9 ms in three runs (validation 18-22 s, 435-532 health answers).
    - After, with the machine at 100 % CPU (validation 62-79 s instead of 18-22 s): 210.8 ms and 146.1 ms, both failing.
    - An idle Node process with no work at all, measured at the same time (scratch probe: an HTTP server answering every 40 ms):
      176.4 ms and 76.8 ms. So the operating system alone causes stalls of this size under that load, and the in-process
      validation that WP-32 measured is no longer on the server's thread.
    - After the merge with main, machine at about 40 % CPU: **20.9 / 63.1 / 54.3 / 23.6 / 48.5 ms** in five runs, all passing (validation
      16.3-17.9 s, 450-516 health answers, slowest answer 20.6-64.8 ms). The fifth ran right after publish-gate.
    - The measured request now sends `fresh: true` and asserts it was not served from the cache. Otherwise the second run would
      measure a cache hit.
  - Cache: validation 8597 ms (21667 ms under load), then the unchanged project in 29 ms (28 ms under load).
  - Job object: a 4 GB allocation under a 400 MB per-process limit is refused (`JOB_MEMORY_LIMIT`), and the next job on the same
    service runs. After `taskkill /F` of the server process alone (not its tree), its workers and a child they spawned end within
    the wait, and a restarted service shows the running job as `interrupted` (`wp14-job-limits`).
* Tests:
  - New: `wp14-jobs` (9) and `wp14-job-limits` (1), registered in `scripts/ci/test-plan.json`.
  - Run on the merged build (2bfc37a), one file at a time:
    - all passing: `wp14-jobs` 9/9, `wp14-job-limits` 1/1, `wp32-event-loop` 5/5 runs, `wp32-validation-scale` 8/8,
      `wp32-validator-crash` 1/1, `wp16-validation-framework` 6/6, `wp22-problems` 4/4, `wp11-integrity` 16/16, `wp10-seams` 11/11,
      `wp10-storage-contract` 15/15, `wp12-migrations` 10/10, `wp29-audit-coverage` 2/2, `wp29-audit-trail` 11/11,
      `wp28-team-server` 6/6, `authz-matrix` 6/6, `routes-guarded` 1/1, `ws-broadcast` 5/5, `api` 17/17, `publish-gate` 24/24
      (741 s), `pdf21` 8/8 (620 s).
    - Before the merge, on 15010fd, all passing: `html-publish` 6/6, `applic-publish` 12/12, `jsg-engine` 7/7, `jss-authoring` 13/13,
      `golden-xignal` 4/4, `pdf-reference` 2/2, `brex-gate` 3/3 (826 s), `project-delete-after-build` 3/3.
  - Lint green; `any.backend` went from 279 to 278 and the baseline was lowered.
* Not done, and why:
  - Release archive (PUB-006) and a build-output cache: not built. A reused PDF must be proven byte-identical first, and that is
    its own change.
  - Frontend job flow (progress panel, cancel button, FE-028): the backend contract is ready (the `job` WebSocket message, the
    log replay, cancel, `?async=1`). The screens belong to the frontend packages running in parallel, and the existing screens keep
    working unchanged.
  - `GET /publish/download` still builds when the PDF is stale (through a job), because the frontend relies on it.
  - When PowerShell is unavailable or blocked, there is no job object. Status `unavailable` is shown in `/api/admin/jobs`, and the
    workers still run with heap limits and tree-kill on cancel, timeout and shutdown. A hard kill of the server can then leave
    orphaned workers.
  - Not run: the T15 test (100 builds, JVM growth). Instead, recycling after 50 jobs and `-Xmx` bound the JVM. The `-Xmx` default
    of 1536 MB is a judgement: the largest sample books built under it in `golden-xignal` and `pdf21`.
  - Non-Windows: no job object. Kill uses SIGKILL of the worker only.

## Phase 6 (WP-36)

### WP-36 Post-redesign cleanup and the removal-completeness gate (CLN-001, CLN-002, CLN-003, CLN-004; ARC-011 `codemirror`, ARC-012 pdf definition helpers) - done (front end); server routes kept by decision

Decision D19 (scope), taken as the audit recommends and recorded here: remove what the scan proves unused in the front end, item by
item, each with its evidence; keep every server route of `docs/API-ONLY-ROUTES.md`. The owner's lists of 2026-11-26 removed the SNS
System 2, Brand pack, CSDB and applicability screens and said "backend, data and API stay"; that rule is above the audit's D8/D19
route list, so no route, service or backend test was removed (and WP-15/WP-17 own most of the backend this week). Nothing a user sees
was removed: `check:parity` PASS with nothing removed and no explanation row (the two "added" items are WP-14's backend tests).

* The scan (`frontend/scripts/cleanup/scan.mjs`, TypeScript compiler AST, so comments are never references):
  - files nothing imports from `src/main.tsx` (static, dynamic `import()`, `new URL(.., import.meta.url)`, CSS `@import`);
    test-only files and ambient `.d.ts` are kept by rule;
  - exports that no other file of `src`, `e2e`, `scripts`, `test-support` or the configs names, and that their own file uses no further
    (identifiers plus the words of string literals, so `window.studio.<name>` in a browser-test string counts);
  - CSS classes of `src/**/*.css` that no non-test source of `frontend/src` or `backend/src` names (string, template and JSX text
    words, which covers the DOM-built Studio/JSS/JSG editors and server-built HTML); a template or concatenation ending in `prefix-`
    marks that prefix's classes as generated (x- 95, sev- 3, toast- 2 today);
  - runtime dependencies (`dependencies`) that nothing imports.
  `allowlist.json` holds the reasoned exceptions (CodeMirror's own `cm-*`, pdf.js `markedContent`/`endOfContent`; an entry needs a
  reason, a stale entry warns). `check.mjs` is the report (`npm run check:cleanup`, `--report`, `--json`, `--verbose`).
* Removal completeness (`removed-features.json`): for each feature the owner removed (CSDB page, System 2 SNS, Brand pack,
  applicability UI, Codes strip/button, PMC/ICN/contents switches) its deleted files (taken from e85fa94 and c61ec89), identifiers,
  strings (endpoints, test ids, labels), CSS class prefixes, rail labels and code patterns (`show.pmc|icn|toc`) must not come back in
  the non-test source; one allowed occurrence (the `sns-defaults` redirect path). The routes the owner kept must stay listed in
  `docs/API-ONLY-ROUTES.md` (a note there says so). Routes and redirects of the removed screens stay with the parity check.
* Wired in: `scripts/ci/lint.mjs` hard rules (dead files, exports, classes, dependencies, allow-list problems, removal debris; so
  `npm run lint`, the gate's lint stage and the pre-push hook hold them at zero); new gate stage `cleanup` after `parity` in the pr,
  nightly and release profiles (the scan's own tests, then the report `cleanup.md` in the evidence); `npm run check:cleanup` (root and
  frontend), `npm run test:cleanup` (frontend). The CLN-004 removal checklist is `.github/pull_request_template.md` (client route,
  rail/labels, API wrapper, server route or its API-ONLY row, helpers, CSS, test ids with an absence test, docs, a removed-features
  entry, lint).
* First run of the scan on a2c5b31: 0 files (WP-13 had removed `api/publish.ts`), 18 exports, 38 classes (23 real, 15 library),
  1 dependency, 6 pieces of removal debris (5 `applic-*`/`v2-brandprev` classes, `applicXml`). After: all zero outside the allow-list.
* Removed (commits 1abafb1, ad41ac3, 0b1d36b, 16e6080; evidence in each message):
  - 20 exports: the audit's 12 still present (`ShowMore`, `cloneDoc`, `cellAt`, `moduleIds`, `labelFor`, `mergeAdjacentFormatting` with
    its helper `sameAttrs`, `cellStart`, `serializeRaw`, `formatXmlText`, `elementIndexAtOffset`, `resolvePath`, `CONTENT_H`; the four
    role helpers had gone in WP-13), six found since (`JssType`, `isAbort`, `delDraftsOf` - sign-out purges through `lib/draftPurge` -,
    `fromServer`, `buildPdfDocDefinition`, `buildCombinedPdfDocDefinition`: ARC-012) and the two they left unused
    (`buildPublicationDefinition`, `dmcOf`).
  - 23 CSS classes (3,716 bytes of rules): `applic-rows/-row/-vals/-tools` (applicability picker), `v2-brandprev` (Brand pack),
    `v2-subtabs/-subtab` (System 2 SNS tabs), `type-card*`, `v2-crumbs`, `v2-page-narrow`, `v2-pside`, `v2-pside-head`, `v2-quick`,
    `.v2-tile .ic`, `.v2-tile .stat`, `.v2-grid.tiles`, `v2-saved`, `v2-w-44`, `v2-w-210`. The audit's `is-collapsed` and `v2-nav-head`
    are used again (WP-21, WP-35) and stay.
  - Removal debris: `NewDmOptions.applicXml` and `.actRef`, set only by the removed `studio/ui/applicPicker.ts`; the template now writes
    directly what it always wrote with both undefined (the plain-text `<applic>`), byte for byte.
  - `codemirror` (the meta-package; nothing imports it, its dependencies are all direct ones) from `package.json` and the lockfile, by
    hand and offline; node_modules untouched.
  - Tests deleted: none. No test assertion changed.
* Sizes (vite build, `check:bundle`), a2c5b31 -> after: initial load 435.5 -> 433.9 KB raw (130.1 -> 129.8 KB gzip), entry stylesheet
  55.1 -> 53.5 KB, Studio chunk 846.8 -> 846.6 KB (the bundler had already dropped the unused functions), `dist/assets` 6,539,523 ->
  6,535,785 bytes. Sources: app.css 33,922 -> 32,778 B, platform.css 39,093 -> 37,162 B, editor-host.css 10,233 -> 9,646 B, admin.css
  4,566 -> 4,512 B; `frontend/src` 207 lines removed, 10 added.
* Backend: an ad-hoc search for `backend/src` files that no backend, test, script, packaging or frontend file names found none (only the
  ambient `types.d.ts`). Backend exports were not swept (WP-15/WP-17 work in those files; `vendor/` is out of bounds), and the services
  that only the kept routes use (`services/sns/*`, `applicability.writeModel`, `publisher.buildConfiguredPublication`,
  `listConfiguredPdfs`) stay with them.
* Tests run (this branch, after all removals): frontend `tsc --noEmit` clean; vitest `src/editors src/parity src/components src/styles
  src/lib src/pages src/jss src/api` 40 files, 446 passed, 14 skipped (`jss/naval.test.ts` skips itself without the Naval stencils), and
  `src/studio src/jsg src/store` 10 files, 441 passed, 2 skipped (the fixture writers, `WRITE_FIXTURES` only); `lint:theme` 0 colour
  literals; `vite build` OK; `check:bundle` PASS (entry stylesheet still over the 30 KB advisory); `node scripts/parity/check.mjs` PASS,
  nothing removed; `node --test scripts/cleanup/scan.test.mjs` 9/9; `check.mjs` PASS; `node scripts/ci/lint.mjs` all green, ratchets
  unchanged (any.backend 278, any.frontend 50, require 46/4); negative run: an orphan file with an export, an unused class and the
  `codemirror` line put back made lint/check fail on each, exit 1. Backend `tsc -p .` clean (no backend source changed). Visual/a11y/
  keyboard suite (port 4106, msedge): 67 passed, 7 skipped (the keyboard spec's own dark-theme skip), no baseline changed. e2e alone on
  port 4105 (msedge, one worker): `zz-core-routes`, `doc-pages`, `wp35-redesign`, `wp22-navigation` 30/30; `00-platform` 41/41.
* Not run (by the brief): the gate (so the new `cleanup` stage was exercised only through its two commands), the full vitest and e2e
  suites, the backend suite (no backend file changed).
* Left: backend dead-export sweep (after WP-15/WP-17); the kept API-only routes stay until the owner decides otherwise (D8/D19);
  `frontend-hygiene.json` in the baseline folder is the audit's snapshot and is not regenerated (the gate's report is the live count).
## Phase 4 (WP-15)

### WP-15 JSG parity and conversion fidelity (PUB-011, PUB-008, PUB-009, PUB-015, ARC-024, PUB-016, PUB-017, PUB-018, GAP-005) - done, with the limits listed

Branch `worktree-agent-a721009b2b8bc5c9d`, from 4994249. No migration.

* **JSG release, watermark, warm FOP (PUB-011).**
  - `services/jsg/engine.ts`: the build reads the release state (`release.ts` `releaseStateOf`). Until a release is approved, every page master but the
    cover carries the NOT RELEASED watermark (`watermark.js`, the same one the other engines use; the project's own watermark settings apply as there).
    The build renders on the warm FOP JVM (`fopd.js`) and falls back to java with a log line. It writes `.jsg-publish-state.json` (fingerprint, released).
  - Routes: `POST /jsg/build` runs as a job (`jobs.submit`) and answers with `jobId`, `report` (`jobs.buildReport`), `released`, `releaseLabel`, `warmFop`.
    `GET /jsg/pdf` sets `X-Release-State` and `X-Pdf-Stale`. New `GET /jsg/pdf/download` (reviewer, `publish.build`) rebuilds first when the file is
    stale. The authz snapshot was regenerated for this one reviewed addition.
  - Release through the shared routes: the JSG check is registered in `publishChecks.ts` (`jsg/service.ts`), so an invalid document is refused at
    submit (422 `VALIDATION_FAILED`). A new registry, `services/ownEngines.ts`, tells `release.ts` which file the release is recorded against and what the
    fingerprint covers (`jsg-document.xml` + `Media/**`). It also tells `publisher.ts` to refuse a JSG project (409 `JSG_DOCUMENT`, on publish, configured
    builds and front-matter sync). Neither shared file names JSG, so the jsg-engine ISOLATION test is unchanged and passes.
  - Frontend: the Release page downloads the JSG PDF from `/jsg/pdf/download` and says what a JSG release covers (`ReleasePage.tsx`, `api/jsg.ts`).
  - `wp16-validation-framework`: the expected formats list now includes `jsg` (an intended change; the test still checks that the gate has no
    format branch).
* **Conversion fidelity (PUB-008, PUB-009, PUB-015, ARC-024).** Recorded in `docs/CROSS_ENGINE_ARCHITECTURE.md` section 4, "WP-15":
  - Untitled continuation `levelledPara`s let a warning or caution appear anywhere in a section without blocking the export (reproduced before the
    fix: EXPORT_BLOCKED, "Element 'warning': This element is not expected").
  - Figure legends are kept: as an S1000D `definitionList`, and as paragraphs in JSG.
  - One `pmEntry` per module removes the "chapter-unknown (untitled)" drift on the return trip.
  - `pmHeader.ts` `completePmStatus` makes the publication module schema-valid on import and on every Explorer save.
  - Every picture of `csdb/` and `Media/` is packed under `ICN/`.
  - Losses the reader sees are `warning`, not `info`.
  - `pm-multi-ref.test.js` `refsIn` now leaves out the header's new `brexDmRef`. The test still counts the four module references it is about.
* **PDF document properties (PUB-017, decision D9).** Title, Author, Subject and Keywords for S1000D, JSS and JSG, written as an XMP `fo:declarations`
  packet. For S1000D and JSS this goes through a new optional `onFo` hook in `vendor/engine/build.js` (exception "FO hook",
  `docs/JSS_VENDOR_EXCEPTIONS.md`; `docs/S1000D_COMPLETE_IMPLEMENTATION.md` section 10 item 10); JSG writes the packet in its own engine.
  Decision D9 follows the audit's recommendation: Arial stays, and there is no tagged PDF and no PDF/A, since neither standard requires them.
  `test/pdftools.js` gains `info` (pdf.js `getMetadata`), because poppler's `pdfinfo` is not available.
* **PUB-016.**
  - (a) Ghostscript, following the audit's recommendation to delete the path: the platform passes `pdfCompressLevel: 0`. Ghostscript is not shipped and
    no screen offered the setting; `build.js` keeps its unused code.
  - (b) The image optimiser runs inside the WP-14 publish worker process, not in the API process. This holds by construction. The 100 ms acceptance
    figure was not measured.
* **PUB-018 (decision D11).** HTML publication stays API-only and S1000D-only (recorded in `docs/API-ONLY-ROUTES.md`).
* **GAP-005.** `frontend/src/lib/roundtrip-bytes.test.ts` covers all 28 JSS starting documents (`__fixtures__/jss-skeletons.json`, generated from the
  backend `skeletonXml`) and the two JSG reference documents. A save of an unchanged document:
  - keeps the model and every text and attribute value;
  - is idempotent;
  - differs from the original only in layout. For JSS that is the indentation and `<cell/>` written as `<cell></cell>`. For JSG it is the indentation and
    the order of the front pages (`xs:all`).
  - Two JSG differences were fixed in `jsg/xml.ts` rather than accepted: the supplier and issuer lines in `<meta>`, and plate `divider=`/`caption=` order.
* **Tests run** (backend one file at a time after a clean build; NAVAL_STENCILS and VEKTRA_SAMPLE set):
  - All files passed except the three listed under Limits:
    - new: wp15-conversion-fidelity 4/4, wp15-jsg-release 4/4;
    - JSG: jsg-engine 7/7, jsg-ispl 5/5, jsg-word 3/3;
    - xengine: content-types 2/2, convert 7/7, identity 11/11, import-wizard 4/4, legacy-import 5/5, pictures 2/2;
    - JSS: jss-rwi 7/7, jss-authoring 13/13, jssdm 24/24, jssdm-http 10/10;
    - PM: pm-multi-ref 5/5 (after the `refsIn` change), pm-multiref 3/3;
    - importer and packages: importer-http 12/12, importer-repairs 20/20, importer-scan 19/19, importer-structure 18/18, import 5/5, packages 10/10,
      project-archive 5/5;
    - platform: wp14-jobs 9/9, wp11-integrity 16/16, wp10-seams 11/11, wp10-storage-contract 15/15, authz-matrix 6/6, wp29-audit-coverage 2/2,
      wp16-validation-framework 6/6, api 17/17, release-issue 1/1, publish-gate 24/24.
  - Frontend: tsc clean; vitest roundtrip-bytes + src/jsg + src/jss + docPublication 182/182; parity check PASS. `scripts/ci/lint.mjs` green.
  - New tests registered in `scripts/ci/test-plan.json`: wp15-jsg-release under pdfSmoke, wp15-conversion-fidelity under heavy.
* **Limits.**
  - Two failures that look older than this branch, not re-run on the base commit:
    - `jss-rwi-verify` 2/3: "saving over a newer save is refused" got 200, not 409. The test re-sends the identical text with the old hash, and the
      WP-11 merge accepts it. No WP-15 change touches the JSS save path.
    - `phase13` 11/12: the admin roles list has 4 roles where the test expects 3, which looks like WP-27's role addition.
  - Not run: the main Playwright suite, the gate, golden/pdf21 suites. No Playwright spec was added for the Release page change.
  - JSG's running head does not name the release number, unlike S1000D and JSS.

### WP-17 Backend, database and validation performance (PERF-004, PERF-005, PERF-007, PLT-008, PERF-009, PERF-011, PERF-013, PERF-014) - done, with one target missed (create)

Branch `wp-17-backend-perf` from 4994249. No migration (028 was kept free; WP-15 may take 027). PERF-002 and PERF-003 were closed by
WP-32 and WP-33. PUB-006 and the build-output cache are not part of WP-17 and were not taken.

All numbers are medians from `backend/scripts/bench/wp17-bench.js` (new; `--only csdb,dash,sqlite,jss,validation,large`) on this
machine: Node 22.23.2, i7-6820HQ, Windows Server 2025, **shared with other agents' test runs while measured**, so single values move by
10-30 %. Before = 4994249, after = this branch.

| Measure (audit benchmark) | Before | After | Target |
|---|---|---|---|
| B3 save, 1000-module project | 56.9 ms | 12.1-13.9 ms | <=20 ms |
| B3 create, 1000-module project | 158.8 ms | 62-79 ms (49.7 ms at 100 modules) | <=50 ms - **missed** |
| B3 `/summary` | 716 ms | 63-75 ms | <=100 ms |
| B3 `/release` | 961 ms | 54-62 ms | <=100 ms |
| B3 `/dms`, `/explore`, `/pmc` | 64 / 140 / 133 ms | 47-65 / 50-57 / 49-75 ms | - |
| B3 package import of 1000 modules | 45.8 s | 12.5-13.0 s | - |
| B10 member-only `/api/workspace`, 60 folders, 271 projects | 4876 ms | 108 ms | <=100 ms (at the edge; 33 ms in the test's smaller workspace) |
| B10 member-only `/api/overview` | 5200 ms | 98 ms | - |
| B12 SQLite autocommit insert | 3.22 ms | 0.06 ms | <=0.2 ms |
| PERF-011 JSS document GET | 157 ms | 5.1 ms | <=10 ms |
| B4 validation, 200 modules, BREX, cold | 21-27 s | 16.7 s first run in a fresh worker; BREX itself 4.9 s (inline profile) | <=5 s BREX |
| B4 validation after one module edited | 15.2 s | 1.7 s | <=1 s warm (BREX of the unchanged modules is served from the cache; the rest is XSD and the other checks) |
| B4 validation unchanged (cached run) | 33 ms | 16 ms | - |
| PERF-014 create / save, 1 MB module | 123 / 147 ms | 87 / 91 ms | - |
| PERF-014 create / save, 10 MB module | 948 / 955 ms | 718 / 921 ms | - |

* Changes:
  - **SQLite** (`storage/sqlite.ts`, `appContext.ts`, `config.ts`, `index.ts`; PERF-009, PLT-008):
    - `synchronous = NORMAL` in WAL mode (decision **D14**, taken as the audit recommends): the database stays consistent after any
      crash, and a power cut can lose only the last commits before it. `AGASTYA_DB_SYNCHRONOUS=FULL` (`config.database.synchronous`)
      keeps FULL. Migrations always run under FULL and the working level is restored after them.
    - `cache_size` 64 MB (was 2 MB), `temp_store = MEMORY`.
    - The start runs `PRAGMA quick_check` and logs `[db] quick_check: ok (N ms)`.
    - `startIdleCheckpoint`: once the database has been quiet for 60 s after a change, `wal_checkpoint(TRUNCATE)` runs with
      `busy_timeout = 0` for that one statement, so it never waits for a reader and never holds a request. The timer is unref'd.
  - **Dashboard** (`services/projects.ts`, `routes/workspace.ts`; PERF-007): `folderVisibility(user)` reads the user's project set,
    grants and the folder list once per request, instead of once per folder (it re-listed every project for every folder). The
    folders shown to each persona are unchanged (test below).
  - **CSDB** (`services/csdbIndex.ts`, `csdb.ts`, `projectFiles.ts`, `core/collab/docindex.js`, `fileMemo.ts`; PERF-005):
    - The duplicate-identity check reads an in-memory identity index instead of opening every module on each create and save.
      The index is rebuilt when the folder's mtime changes (a file added, removed or renamed outside the platform) and at the latest
      after 60 s, and the platform's own create, save and delete update it in place. The clash reported is the same file as before
      (the same sort order).
    - The listing records each file's stat, so the release fingerprint reuses it instead of a second stat per file (1000 stats cost
      54 ms here, the directory read 2.4 ms).
    - The document index takes one file at a time on create and save (`syncFile`) instead of walking the whole project.
    - `FileMemo` also keys on the file id (`ino`), so a file replaced within the same mtime tick is not mistaken for the old one.
  - **Publication module** (`services/pm.ts`): the parse of `publication.xml` is kept per file version and handed out as a copy. The
    read-back that `writePm` already makes as its safety check is kept as the next parse, and PM references are memoised. A create
    no longer parses the whole publication twice.
  - **Release view** (`routes/project-content.ts`, `services/release.ts`, `review.ts`): `GET /release` and `/summary` compute the
    release state once and hand it to the review and release overviews (each computed it again). `POST /release` keeps its own full
    computation.
  - **JSS** (`services/jss/service.ts`, `routes/jss.ts`; PERF-011): GET reuses the kept report of the same text while every picture
    the check looked up still gives the same answer. Any change of the text, or a picture added or removed, gets a fresh check.
    `POST /validate` always checks fresh.
  - **BREX** (`services/brex.ts`, `validation.ts`, `publishGate.ts`; PERF-004):
    - A rule whose path starts with an element name the module does not contain is compiled (so a bad rule still fails as before)
      but not evaluated: it cannot select anything. Only simple top-level steps take the shortcut (no axes, functions or
      namespaces). The parity test runs every rule of every bundled BREX against the corpus with and without it.
    - Results are kept per module, keyed by the SHA-256 of the module text and of the BREX models applied (with their issue); at most
      4000, and results with more than 500 findings are not kept. **The publish gate uses this cache too**: it is keyed by content,
      not by time, so an identical input gives an identical answer. The gate's own "never use the cached run" rule (WP-14) is about
      the run-level fingerprint and is unchanged.
    - One `BrexRun` per pass shares the project BREX lookup and the directory listing between modules.
  - **Well-formedness** (`vendor/engine/validateXml.js`, vendored; PERF-013): up to 200 files per `xsltproc` call. A batch that
    reports anything is checked again one file per process, so findings are word for word the old ones. Recorded in
    `docs/S1000D_COMPLETE_IMPLEMENTATION.md` section 10, item (10).
  - **Module size** (`services/csdb.ts`, `config.ts`; PERF-014): a documented maximum for modules created or saved in the editor:
    `config.limits.maxModuleBytes`, 16 MiB by default (`AGASTYA_MAX_MODULE_BYTES`). Above it the answer is 413 `MODULE_TOO_LARGE`
    with the size, the limit and what to do, and nothing is written. Imports are not limited. **Decision:** the audit names 5 MB "for
    example". I chose 16 MiB so that no module that can be saved today becomes unsaveable (the JSON body limit is 25 MB). The audit's
    "no stall above 100 ms at the maximum" holds only at about 1 MB here, so large modules still stall the thread: about 0.35 s at
    4 MB, 0.9 s at 10 MB. Revisions are not compressed (no migration was written).
* Tests (new, registered as heavy in `scripts/ci/test-plan.json`):
  - `wp17-brex-fast.test.js` (5):
    - parity of the shortcut over every bundled BREX and the corpus;
    - the simple shapes;
    - full check equals the reference check without the shortcut;
    - a kept result equals a fresh one, and the cache misses on a changed BREX, a changed module and another issue;
    - batched well-formedness over 420 files with three bad ones, giving the single-file findings.
  - `wp17-perf.test.js` (9):
    - SQLite pragmas, the quick_check log line, and FULL on request;
    - autocommit < 1 ms;
    - **a second writer waits** for a lock held by another process instead of failing;
    - the idle checkpoint truncates the log;
    - identity-index invalidation through create, save (identity changed, own identity, other letter case), delete, and a file
      added and then removed by hand;
    - JSS report reuse (text changed, picture added; GET equals a fresh validate);
    - dashboard persona equality (member-only, grantee, no access, creator, admin) and a flat member cost from 10 to 60 folders
      (25.6 -> 33.5 ms);
    - B3 shapes from 100 to 1000 modules (save 24.0 -> 16.6 ms, create 49.7 -> 71.4 ms);
    - the module-size limit on create and save.
* Tests run (one file at a time, `node --test --test-concurrency=1`, with NAVAL_STENCILS and VEKTRA_SAMPLE set):
  - New: `wp17-brex-fast` 5/5 and `wp17-perf` 9/9. The final run measured save 22.2 -> 22.4 ms and create 47.7 -> 64.9 ms from 100 to
    1000 modules, and the member dashboard at 26.2 -> 31.3 ms from 10 to 60 folders.
  - Required list, all passing:
    - `wp32-validation-scale` 8/8, `wp32-event-loop` 1/1, `wp32-validator-crash` 1/1, `wp14-jobs` 9/9;
    - `wp16-validation-framework` 6/6, `wp33-fo-equivalence` 5/5, `wp33-fo-scaling` 1/1;
    - `brex-gate` 3/3 (989 s), `publish-gate` 24/24 (746 s), `pdf21` 8/8 (954 s), `golden-xignal` 4/4, `pdf-reference` 2/2;
    - `wp10-seams` 11/11, `wp10-storage-contract` 15/15, `wp28-team-server` 6/6, `authz-matrix` 6/6.
  - Also run, all passing:
    - `api` 17/17, `brex` 16/16, `csdb-objects` 4/4, `pm-multi-ref` 5/5, `pm-multiref` 3/3, `release-issue` 1/1;
    - `wp22-problems` 4/4, `wp11-integrity` 16/16, `wp12-migrations` 10/10, `jss-authoring` 13/13, `wp13-permissions` 3/3;
    - `admin-ops` 8/8, `rbac` 7/7, `wp18-delivery` 7/7, `deep-workspace` 2/2.
  - `phase13` 11/12. The failing case counts 4 roles where it expects 3. WP-27's "Auditor (read-only)" entry in
    `routes/admin.ts` makes the fourth, and this branch does not touch that file or the test. Not fixed here.
  - Lint green. `any.backend` went from 278 to 277, and the baseline was lowered.
* Not done, and why:
  - **Create at 1000 modules stays above 50 ms** (62-79 ms; 49.7 ms at 100 modules). What remains grows with the publication: the
    rewrite of `publication.xml` (serialise, the safety re-parse, the `.bak` copy, and an atomic write with fsync), plus the
    module's own atomic write with fsync. Removing the re-parse or the fsync would weaken a safety check, so neither was done.
  - BREX cold: 4.9 s for 200 modules measured inline, inside the 5 s target. The first validation in a fresh worker took 16.7 s
    wall time (worker start, XSD, the other checks, and a shared machine).
  - The `cached` field of the bench script's validation section always reads false; the timings are right.
  - The load harness was not run.

## Phase 9 (WP-30)

### WP-30 Final QA, benchmarking and release (QA-006, QA-008; gates G-REL-2, G-REL-7, G-OFF-1/2/4, G-Q-4, G-Q-6) - done, with the limits listed

The status of every gate is in `docs/audit/RELEASE-EVIDENCE.md` (PASS / FAIL / EXTERNAL, with evidence or procedure).

* **PDF regression (QA-006)**: `backend/test/wp30-pdf-regression.test.js` with `backend/test/pdfregress.js`.
  * Renderer: pdf.js 4.10 on @napi-rs/canvas, both already in `frontend/node_modules`.
  * Five books: S1000D plain and Xignal, JSS UHB, JSS-0251 (RWI package) and the JSG UHB.
  * Baselines:
    * 3 pages per book, chosen by text density, rendered at 0.5 scale; at most 0.2 % of pixels may differ, with dates and times masked.
    * The manifest also records the page count, fonts, internal links, bookmarks and the unembedded base-14 faces.
    * Re-take only with `node scripts/pdf-baseline.js --update [books]`.
  * Customer material:
    * The JSS-0251 page images are git-ignored (renders of the customer's material); without them the raster test skips with the reason.
    * The other checks still run.
  * Proofs:
    * Sensitivity: a changed document gives 0.312 %, so the test fails as it should.
    * Specificity: only the issue month changed gives 0.000 %.
  * Wiring: `test-plan.json` `pdfSmoke`, skip budget 7 (RWI package or Arial absent).
  * Found during the work (QA-006a, open): FOP does not embed the base-14 faces. The JSG body text is Times.
    * The first font check missed this, because pdf.js with its standard font data reports such a face as having a file.
    * The fonts are now read from a document opened without that data.
    * The unembedded faces are recorded per book as a ratchet (may only shrink).
* **Chaos (QA-008)**: `backend/test/wp30-chaos.test.js` (`heavy`). It runs the real server on a temp workspace and a free port, and kills the
  whole tree (`taskkill /T /F`, own PIDs only) at fractions of the measured duration of:
  * a publication (async job),
  * a package import,
  * a platform backup (160 MB of media),
  * a migration (a 240 MB database at user_version 21).

  After every restart it checks:
  * `quick_check` and `foreign_key_check`;
  * no torn file (XML parses, a PDF has its header and `%%EOF`, every `.db` passes `quick_check`; temporary names only as debris);
  * the committed module and its history;
  * the job is shown `interrupted`, no half-made project remains, and a cut-off backup is not listed;
  * a retry succeeds, and a later start or backup sweeps the debris.

  Defects found and fixed:
  * `atomicWrite.commitFile/copyFileAtomic/discardTemp`: PDF builds (S1000D full and preview, configured builds, JSS, JSG) render to a
    temporary name and are committed by fsync and rename.
  * `schema.ts`: the pre-migration safety copy goes VACUUM INTO a temporary name, is verified, then renamed; stale copies and their `-journal`
    are swept at start.
  * `platformBackup.ts`: `.zip.partial` files and `.staging-` folders idle for 10 minutes are swept.
* **Air gap**: `backend/test/wp30-airgap.test.js` (`heavy`) and `test/fixtures/airgap-hook.js`.
  * The hook is preloaded into the server and every forked worker. It refuses and logs non-loopback TCP/TLS/HTTP/fetch, non-local DNS and
    off-machine UDP.
  * The TCP table of the process tree (JVMs included) is polled from outside.
  * A control case proves the hook works.
  * A static scan of `frontend/dist` checks for foreign hosts.
  * `readiness.mjs` row G-OFF-2 now runs that scan (it was NOT RUN).
  * The machine's network configuration was observed only; it was not changed.
* **Soak**: `backend/scripts/soak.js`.
  * It runs its own server with the WP-28 harness for the whole run, a publication every 5 min and a backup every 15 min.
  * It samples the server's metrics and the process tree's private bytes, handles and threads, and reports slopes per hour after a
    10-minute warm-up.
  * It fails only on a crash, a 5xx answer, a failed publication or backup, or a failed load acceptance.
  * A 401 from session policy is answered by signing in again and counted. No security setting is changed.
  * `load-test.js --base` got the same re-login, for its administrator client only (`adminRelogins` in its result). The soak shares that
    account, and the single-session default ends one of the two sessions.
* **Measured.**
  * PDF regression: 12/12, about 57 s.
  * Chaos at N=3: 4/4 (12 kill points, 200 s). Release figure `CHAOS_KILLS=25`: 4/4, **100 kill points** in 23.8 min, 0 corrupt databases, 0 torn files, every retry ok. G-REL-4 load cases: 5 clients 1,069 and 10 clients 1,184 accepted saves, 0 silent overwrites.
  * Air gap: 3/3, with 0 outbound attempts, 0 non-loopback connections in 67 polls, and the hook in the server and 1 worker.
  * Soak, 30 min:
    * 0 crashes and 0 failures; 37,460 requests, 0 errors, 0 silent overwrites.
    * **RSS 121 to 195 MB with a flat heap** (open finding for the 24 h soak).
    * A first 60-minute attempt was cut off at 10 minutes by a session interruption.
* **Tests re-run alone after the product changes, all passing:**
  * Storage and migrations: `wp12-migrations` 10, `wp11-integrity` 16, `db-snapshot` 4, `s1000d-migration` 2, `wp12-backup-restore` 7.
  * Builds and jobs: `jsg-engine` 7, `pdf-furniture` 2, `applic-publish` 12, `wp14-jobs` 9, `project-delete-after-build` 3, `api` 17,
    `wp15-jsg-release` 4.
  * For the evidence:
    * Access and audit: `routes-guarded` 1, `rbac` 7, `authz-matrix` 6, `wp03-auth` 11, `auth-core` 11, `auth-http` 10, `wp26-network` 9,
      `wp29-audit-trail` 11, `wp29-audit-coverage` 2.
    * Other backend: `settings-hostile-input` 6, `tools-canary` 6, `uploads-config` 4, `wp28-team-server` 6, `wp13-version` 4,
      `wp17-perf` 9.
    * Golden and reference outputs: `golden-xignal` 4, `pdf-reference` 2, `s1000d-reference` 18, `jss-cover-isolation` 6,
      `jss-reference-layout` 2.
  * Release tools: `release.test.mjs` 8, `host-audit.test.mjs` 2, `teamserver.test.mjs` 4, `update.test.mjs` 6.
  * Playwright, on port 4111 with Edge: the visual config's `a11y.spec` and `keyboard.spec` gave 33 passed and 7 skipped (keyboard in dark,
    by design); `wp05-dataloss.spec` 10/10.
  * Build and hygiene: backend `tsc` and frontend `tsc --noEmit` clean; `vite build` twice gave byte-identical output (262 files); lint exit 0,
    parity PASS, `check:cleanup` PASS.
* **Not done, and why.**
  * `readiness.mjs` was not run as a whole, and `host.test.mjs` and `installer.test.mjs` were not run. They write HKCU keys or a Start-menu
    folder, and this run was told to make no registry or system change. The test-backed readiness rows were run as single files instead.
  * The full gate was not run, by instruction (the lead runs `gate:release`).
  * The 24 h soak, and the VM, no-NIC, certificate and screen-reader gates, are documented as EXTERNAL with procedures.
  * Gate FAILs left open, with their reasons in RELEASE-EVIDENCE:
    * G-SEC-2: temporary-password entropy is about 39.6 bits against the gate's 60.
    * G-SEC-3: the injected-clock points are not scripted.
    * G-SEC-7: there is no single canary run through every flow.
    * G-SEC-8 and G-OFF-2: CSP violations are not collected in a browser.
    * G-DEP-4: 5 of 8 doctor faults are seeded.
    * G-UX-2: 2 of 5 tasks are scripted keyboard-only.
    * G-UX-5: 10 cases of the 20 asked.
    * G-Q-2: 76 of 94 P0/P1 ids are named in tests.
    * QA-006a: the base-14 fonts are not embedded.
    * G-REL-2: no kill case during release approval (the other sites reach n = 100).


## UI redesign step 1 (owner-approved mockups)

Date 2026-11-28. Specification: the six mockups in `docs/audit/mockups/`, approved by the owner on 2026-11-28. Step 1 is the design
system, the two shells and screen 1. Screens 2-6 were built in parallel by other agents on top of the design-system commit.

**Design system (commit d216069; fixes 7ffe644).**
* `tokens.json` holds every colour of the mockup `tokens.css`, in both themes. The new semantic tokens are: surface-chrome,
  surface-selected-hover and -inactive, text-link, focus-ring, accent-pressed, the status -border/-solid/-subtle sets,
  text-on-warning-solid, tooltip-*, shadow-3, scrollbar-*, border-subtle and viewer-canvas-themed. It also holds the scale: space-*,
  fs-*, lh-*, fw-*, radius-md/xl, the layout sizes, dur-* and ease. Density adds control-h, row-h, table-row-h, icon-btn and pad-ctl.
* `--accent` is a fill now, with white text in both themes. Accent-coloured text uses `--text-link` and focus outlines use
  `--focus-ring` (47 places moved). The administrator accent drives accent, text-link and focus-ring.
* Contrast: 298 checks, 0 failing. Colour literals: 0.
* `styles/components.css` has the mockup components with the mockup class names. It also has the shared page pieces: .pane,
  .pane-head, .toolbar, .vsep, .chip(s), .switch, .toggle, .kv, .sec-h, .tile-ic, .scroll, .empty-state, .kpis.
* `components/ui.tsx` adds Card, StatTile, Pill, Dot, Progress, Callout, Seg, EmptyState and initialsOf. `Icon` adds the mockup icons.
* Fixes found by the e2e runs:
  * The mockup `.app` grid also matched the S1000D Studio root, which is also `.app`. This moved the build log out of the editor
    pane. The Studio root is now `.app.s1k-studio`, and the shell rules skip it. `.brand`, `.pane` and `.toast` skip the Studio too.
  * `.btn` from components.css overrode `.btn-primary`, `.btn-sm`, `.btn-danger` and `.btn-danger-solid`, because it loads later.
    These four are now aliases of the mockup modifiers.
  * `.btn` no longer animates its fill.

**Global shell (`layouts/AppShell.tsx`, `styles/shell.css`; mockups workspace.html and admin.html).**
* The top bar holds:
  * the brand;
  * the breadcrumb (group / page, the page name is the h1);
  * the search trigger (Ctrl+K, the existing quick switcher);
  * the offline/server mark (`net-state`);
  * the bell (`bell`, `unread-count`);
  * the three-state theme switch;
  * the icon-only account menu (`components/AccountMenu.tsx`, role only).
* The side navigation uses the mockup groups (Library, Operations, Platform). It has the same items, roles and test ids as before,
  and a footer with "Offline · on-premises" and the version.

**Project shell (`layouts/ProjectShell.tsx`, `layouts/shellSlots.tsx`).**
* The activity bar (`.activity` / `.act-btn`) holds the back link, the project initial, the areas with their badges, Settings at the
  foot and the pin. Its landmarks, `v2-rail*` classes, `rail-pin` and data-tip labels are kept.
* The top bar shows "Projects / project / page" with the role, then the page actions slot (`<TopbarActions>`), "Jump to…", the theme
  switch and the account menu. It keeps the test ids `project-bar` and `project-bar-name`.
* A status bar (`project-status-bar`) holds the page items (`<StatusItems>`), or by default the server state, engine and module count.
* The editor page keeps its own header and status bar, in the compact density, with no shell top bar (the owner rule asserted in
  wp22-navigation).

**Screen 1 (`pages/Overview.tsx`, `Projects.tsx`, `Workspace.tsx`, `components/Oversight.tsx`, `styles/pages/dashboard.css`).**
* The Overview for each role has: the greeting and page actions, four stat tiles, then two columns.
  * Left: "Continue where you left off", the Projects card with the release-status filter, and the team.
  * Right: "Needs your attention" (approvals, invitations, admin queues, with their actions), "Recent activity" and "System" (server,
    network, version; for the administrator also the last backup and the audit log).
* Projects and Workspace use the same page head and cards. Every route, action and test id is kept.

**Owner-rule assertions changed.**
1. 00-platform: "the theme is one icon button" became "the theme is an icon-only switch", because the mockups draw a three-state
   switch. The renamed test is in parity-explanations.json.
2. wp35-redesign: the nav group heading "Manage" is now the mockup's "Operations".

visual/screens.spec.ts now clicks `theme-dark` / `theme-light` instead of toggling.

**Cleanup.** Removed the CSS the new shell made dead: v2-nav*, v2-side-note, v2-osec*, v2-page-head, v2-kpi, cols-4, v2-feed-line,
v2-theme-toggle, the old rail and breadcrumb-bar rules, and v2-issue/v2-sev from structure.css. The mockup library classes that no
page uses yet, and the two slot exports, are in the cleanup allow-list for screens 2-6. `adm-cols` (from the screen 6 merge) is also
there, for the screen 6 owner to use or drop.

**Not done in step 1.**
* The account menu keeps the existing items (Account settings, Sign out).
* The dashboard's "Modules complete" and "Validation" columns are not drawn. The oversight API has no per-project validation or
  completion figure, so the table shows Data modules and People instead.
* No new backend endpoint.

## UI redesign: editor chrome, second pass (owner's requests 2026-11-28)

The same chrome in the S1000D, JSS and JSG editors. Nothing about editing, WP-05 data-loss protection, check-out or autosave changed (D16).
The JSS/JSG paper and canvas styles were not touched.

* **Panel toggles.** The top bar has three VS Code-style toggles: explorer, Problems and Properties
  (`editors/host/ChromeControls.tsx` PanelToggles). Pressed means open. Each has `aria-pressed` and a tooltip with its key.
  * Every panel head has a close button (PanelClose): the explorer, the JSG Problems panel, the JSS Problems drawer, the React
    Properties panel, and the Studio's Properties and Problems panes.
  * Keys: Ctrl+Shift+B (explorer), Ctrl+J (Problems), Ctrl+Alt+Shift+B (Properties). Ctrl+B is Bold in all three editors and
    Ctrl+Alt+B is the Studio's bulleted list, so VS Code's own keys could not be used.
  * The keys are answered in `useHostKeys.ts` and listed in `lib/editorShortcuts.ts`. The palette has them: in JSS/JSG through
    the host commands, in the Studio through the new `StudioHost.commands`, which replace `view.props` / `view.problems`.
  * The state is remembered per format in the existing keys (`agastya.{jss,jsg}.explorer/.props.v2/.problems`,
    `agastya.editor.side`, Studio `studio.layout`). Default: everything open.
  * The S1000D `toggle-side` button moved from before the crumbs into this group. Its test id is kept.
* **S1000D Quick preview, Refresh, Generate.** These are now in the top bar next to Validate in every view (`chrome-preview-slot`).
  * Refresh on save is a pressed/unpressed toggle beside Quick preview (testid `preview-autorefresh`, same `agastya.pdf.auto` key).
  * The PDF pane keeps only viewing controls: the two pop-out windows, the download and, in PDF-only view, the layout switch.
  * Test ids `quick-preview-btn` and `generate-btn` are kept.
* **Quick preview for JSS and JSG.** New routes POST `/api/projects/:id/jss/preview` and `/jsg/preview`. They run as the WP-14
  jobs `doc-preview` and `jsg-preview` (build lane), at reviewer level with `publish.preview`, like the S1000D preview.
  * Each renders the saved document to `_quick-preview.pdf` through the same pipeline as Generate.
  * No release stamp, no build state, no reload broadcast. These job kinds are not listed in the Publication history.
    `_`-files are left out of project archives and cleared with the other previews.
  * The top bar has Quick preview with its Refresh on save toggle. The PDF pane labels what it shows ("Quick preview (draft)"
    or "Generated PDF") and downloads that PDF.
  * Guard tests: authz snapshot regenerated with two reviewed rows (same as the S1000D preview row); wp29 reasons added.
    New test: `backend/test/editor-quick-preview.test.js`.
* **JSS/JSG Properties panel.** Same widths as S1000D (288 px), tabs Element / Document / Comments.
  * Element shows the editor's own reading of the block at the cursor: the new read-only `inspect()` in `jss/editor.ts` and
    `jsg/editor.ts`, with element, attributes, the list item or table cell, and the section it is in. It is not editable there;
    the toolbar edits.
  * Document adds the identification written in the document (its cover fields).
  * Comments is the existing review-comments panel with its empty state.
* **Editor | Split | PDF.** A labelled segmented control (icon and word, tooltips "Editor only", "Editor and PDF side by side",
  "PDF only"; Ctrl+Shift+1/2/3) at the right end of the document tab row, in all three editors.
  * In S1000D it is placed in a slot after the Studio's tabs. In PDF-only view it heads the PDF pane, because the Studio is hidden.
  * WP-21 layout logic is unchanged. The group is still named "Editor layout".
* **Tests.**
  * `e2e/wp21-editor-chrome.spec.ts`: the switch is now looked for in the tab row (`view-switch`), not in the header. New tests:
    toggles + close buttons + keys + reload, per editor; switch labels/tooltips/keys, per editor; JSS/JSG Quick preview
    (draft PDF, no publication made); S1000D buttons in the top bar in every view.
  * `e2e/00-platform.spec.ts`: Quick preview and Generate are expected in the top bar, not the PDF controls.
  * Parity: two explanation rows (`toggle-side`, `quick-preview-btn`, now given by the shared component).

## Phase 3 (owner's final decisions P3-1..P3-7, 2026-11-28)

Decisions: `docs/phase3/DECISIONS.md`. Each area keeps its own record (files changed, decisions, possible regressions, checks owed);
this section is the index. Order followed (P3-7): small UI -> baseline -> collaboration -> PDF review -> standalone accounts ->
GitLab -> performance -> cleanup -> comprehensive verification. Only targeted checks ran during implementation.

| Step | Record | Merge | Migration |
|---|---|---|---|
| Small UI + performance baseline | `docs/phase3/ui-and-baseline.md`, `perf-baseline.md`, `perf-budgets.json` | 069d507 | - |
| Collaboration core + S1000D | `docs/phase3/collaboration.md`, `COLLAB-CONTRACT.md` | 238b6c2 | 030-collab-documents |
| Collaboration JSS | `docs/phase3/collab-jss.md` | 9d2f0e4 | - |
| Collaboration JSG (handbook + ISPL) | `docs/phase3/collab-jsg.md` | 76a9cdd | - |
| PDF review | `docs/phase3/pdf-review.md` | 3a00fc4 | 028-pdf-annotations |
| Standalone default accounts | `docs/phase3/standalone.md` | a3d9a8b, 2ac4fb2 | 027-default-accounts |
| GitLab (intranet) | `docs/phase3/gitlab.md`, `docs/OPERATIONS.md` section 15 | c8a1b65 | 029-gitlab (renumbered from 030 at merge) |
| Performance | `docs/phase3/performance.md` | 422528f | - |
| Cleanup, backend | `docs/phase3/cleanup-backend.md` | 0a100f3 | - |
| Cleanup, editors/collaboration | `docs/phase3/cleanup-collab.md` | 061f2ab | - (Yjs room schema 2, old rooms convert lazily) |

Merge notes by the lead: GitLab's migration renumbered to 029 so main has no gap (`storage/schema.ts` refuses gaps); ProjectShell
kept main's status bar (renderer status removed in step 1) plus the GitLab rail flag; `services/firstRun.ts` typed imports (lint
ratchet); `POST /api/auth/default-credentials/acknowledge` added to the intended public surface in `routes-guarded`.

Headline numbers (this host, noisy): project reads at 1,000 modules, 10 concurrent p95 0.6-1.0 s -> 17-100 ms; import stall 8.3 s ->
61 ms; unchanged re-validation 1.27 s -> 0.016 s; unchanged PDF rebuild 2.5-6.7 s -> ~0.02 s; Studio chunk 277 -> 138 KB gzip;
collab load 120 clients p95 19-29 ms, 171 MB RSS. PDF output byte-identical (wp30-pdf-regression baselines unchanged).

Owed to Phase 9: everything in `docs/audit/PHASE-CHECKLIST.md` section 8, step 9.
