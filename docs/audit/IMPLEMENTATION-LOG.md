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
