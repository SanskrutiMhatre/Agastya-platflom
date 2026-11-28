# Agastya Platform v2 - architecture and technology stack

Written 2026-11-23 from the source on disk at commit `9f6926c` (branch `main`, working tree clean when the survey began). This is a read-only investigation:
nothing was changed, built, run or committed except this file. Where a statement comes from a document (`README.md`, `memory.md`, `docs/*.md`) and was **not** re-checked
against code, it says so ("per docs"). Section 14 lists what was and was not verified.

> **Corrections since this survey (2026-11-27, audit WP-13: ARC-015, PLT-025).** This file is a snapshot of 2026-11-23 and some statements are now wrong:
> **JSG is built** (`formats.ts` lists it `ready: true`; 2 JSG types, both ready; see `docs/JSG_ENGINE.md`). **All 28 JSS types** of the Land and Naval registries
> are ready (`jssTypesOf('land')` + `jssTypesOf('naval')`, none refused). The runtime is **Node.js 24 LTS** (pinned 24.22.3 in `packaging/product.json`; 22.13+
> still runs a development checkout), see `docs/BUNDLED-COMPONENTS.md`. **Argon2id is required**: the server refuses to start without the `argon2` module;
> scrypt only verifies legacy hashes (asynchronously) and they are re-hashed with Argon2id at the next sign-in. Temporary passwords are
> `<username>-<8 random characters>` (`policy.js`). The version is served by `GET /api/version`. Routes with no screen are listed in `docs/API-ONLY-ROUTES.md`.

---

## 0. The three formats - do not confuse them

The word "JSS" is used for two different things in this code base, and "JSG" is a third thing (built since this survey: see the corrections above). Keep these apart.

| Term | What it is here | Where it lives |
|---|---|---|
| **S1000D** | The international XML specification for technical publications. Content = **data modules** (`DMC-*.xml`) in a per-project **CSDB** plus a **publication module** (`publication.xml`, root `<pm>`). Four issues are installed: 4.2, 5.0, 6.0, 7.0 (3.0 and 4.1 schema folders also exist). Authored in the **S1000D Studio** editor. | `backend/schemas/{3.0,4.1,4.2,5.0,6.0,7.0}`, `backend/vendor/pipeline/s1000dtofo`, `frontend/src/studio` |
| **JSS** (document format) | **Joint Services Specification** manuals (JSS-0251, Land and Naval domains). Here: ONE hand-authored XML file per project, root **`<jssbook>`**, validated against `backend/schemas/jss/jss-1.0.xsd` (283 lines) and the stencil's rules, authored in the separate **JSS editor**. Project marker: `project.json -> authoring: "jss-xml"`, `jssDocType: uhb | mm | orm`. | `backend/src/services/jss/`, `frontend/src/jss/`, `frontend/src/pages/project/JssEditorPage.tsx` |
| **JSS book** (pipeline format) | The same `<jssbook>` vocabulary is also the **intermediate** format of the older route "S1000D data modules -> JSS book (`s1000dtojss`) -> XSL-FO (`jsstofo`)". So `jsstofo` renders *both* hand-authored JSS documents and S1000D content that was converted to a JSS book. | `backend/vendor/pipeline/{s1000dtojss,jsstofo}` |
| **JSS Publisher** | A *separate older product* (not in this repo) from which this platform copied its auth, governance, SQLite layer and publishing engine. Do not read "JSS" in a code comment as "JSS document" without checking. | `backend/vendor/engine`, `backend/src/core/**` |
| **JSG** | **Joint Services Guide** (`JSG-0308`, Land, User Handbook). **Not implemented**: `formats.ts` lists it with `ready: false` and the server refuses to create it. Only the customer's stencil folder `manual format/JSG_FORMAT` exists on disk. | `backend/src/services/formats.ts` |

Project format is `project.json.format` = `s1000d | jss | jsg` (older projects without it are inferred, `projects.ts:isS1000dProject`). A **JSS project is not an S1000D project**:
it has no CSDB, no BREX, no S1000D configuration, no SNS (verified: `isS1000dProject` gates those; `publishGate.ts` branches on `isJssAuthored` first).

`s1000d` projects are created with the layout profile `xignal-s1000d` and pipeline `s1000dtofo` (direct). `jss` projects use pipeline `s1000dtojss` (a name that is misleading for
hand-authored JSS: the S1000D->JSS stage is skipped, see section 6).

---

## 1. What the product is

An **offline, on-premises** Windows-first server (also runs from source on any OS with Java) for authoring and publishing technical manuals: a main dashboard
(Overview, Workspace, Projects, Graphics, CIR, Backup, Activity, Administrator, Settings) and a dashboard per project (Editor, Explore, Publication, Graphics, Validation, Release, CSDB, Settings).
One Node process serves the REST API, a WebSocket and the built React client. It contacts no network at run time (per docs; `scripts/verify-package-offline.mjs` exists to prove it).

It was assembled on 2026-11-15 from three earlier projects (Agastya V1, JSS Publisher, S1000D Studio) that share no code with each other, then extended (S1000D Phases 17-22, JSS authoring merge on 2026-11-23).
Repo-local history lives in `memory.md` (442 lines, 127 KB), `README.md` (35 KB) and 14 documents in `docs/`.

---

## 2. Repository layout

```
Agastya-platform-v2/
  package.json            root scripts only (no dependencies); install:all, build, start, test, verify, package:win
  README.md  memory.md    product docs / project log (see section 14 on trusting them)
  backend/                Express 4 + TypeScript API                  22.5k lines TS/JS in src/ (130 files)
    src/index.ts app.ts config.ts context.ts       entry, Express wiring, paths, the singleton services
    src/routes/           16 route modules (~250 HTTP endpoints incl. auth)
    src/services/         ~60 service modules + sns/ importer/ jss/ jssdm/ subfolders
    src/core/auth/        11 plain-JS modules copied from JSS Publisher (users, sessions, authz, grants, policy ...)
    src/core/collab/      docindex.js, revisions.js (document index + immutable revisions)
    vendor/engine/        publishing engine, plain JS, "third party, do not edit"       (+ pipeline = 26.6k lines JS/XSL)
    vendor/pipeline/      XSLT: s1000dtofo, s1000dtojss, jsstofo, jss (front-matter statics), wellformed.xsl
    vendor/tools/         bundled Win32 toolchain: Apache FOP 2.10, Temurin JRE 21.0.13.1, libxslt 1.1.28 (xsltproc), fonts, fop.xconf
    vendor/tools-linux/   links/config for Linux (no JRE bundled)
    schemas/              S1000D XSD sets per issue + schemas/jss/jss-1.0.xsd + PROVENANCE.md
    brex/                 official default BREX per issue (F=4.2, G=5.0, H=6, J=7) + S1000D-default-4.2.xml
    reference/ templates/ templates-optional/ samples/ assets/ scripts/
    test/                 71 files (451 test()/it() calls), node:test
  frontend/               React 18 + Vite 5 + Tailwind 3 + Zustand    34k lines in src/ (179 files)
    src/pages src/layouts src/components src/api src/store src/lib      the platform UI
    src/studio/           S1000D Studio (framework-free TS) embedded; core, ui, validation, export (pdfmake), view
    src/jss/              JSS editor (framework-free TS), independent of src/studio
    e2e/                  Playwright specs (17 files, 119 test() calls)
  scripts/                start.mjs, package-windows.mjs, verify-*.mjs, signing/, vm-acceptance/
  packaging/ release/     Inno Setup installer, C# tray/service host, build output (git-ignored)
  workspace/              RUNTIME DATA (git-ignored): publisher.db(+wal/shm), projects/, templates/, backups/
  docs/                   14 .md files (+ legal/, sample-comparison/)
  SAMPLE PROJECTS/ "manual format/"   customer material, git-ignored (only README.md of the first is tracked)
```

---

## 3. Technology stack and versions

Versions below are the **declared ranges** from `package.json`; installed versions are in the lockfiles (not enumerated here).

| Layer | Technology |
|---|---|
| Runtime | Node.js **>= 22.5** (`backend/package.json` engines). Installed on this machine: **v22.14.0**. The vendored JSS engine's comments say "Node 24"; 22.x works but prints an ExperimentalWarning for `node:sqlite` (per docs). |
| Language | TypeScript `^5.5.3`, strict, target ES2022. Backend `module: CommonJS`; frontend `ESNext`. Parts are plain JavaScript (`core/auth`, `core/collab`, `vendor/engine`). |
| Backend | Express `^4.19.2`, `multer ^2.0.2` (uploads), `ws ^8.18.3` (WebSocket), `@xmldom/xmldom ^0.9.10`, `xpath ^0.0.34` (BREX XPath 1.0), `xmllint-wasm ^5.1.0` (XSD validation in-process), `jpeg-js`. Optional: `argon2 ^0.41.1` (falls back to scrypt). Dev: `ts-node-dev`, `@types/*`. |
| Database | **SQLite via the built-in `node:sqlite` (`DatabaseSync`)**, file `workspace/publisher.db`, `PRAGMA journal_mode = WAL`. No ORM; hand-written SQL in `core/auth/store.js` (1,571 lines) and `vendor/engine/db.js`. |
| Frontend | React `^18.3.1`, react-router-dom `^6.28`, Zustand `^4.5.4`, Tailwind `^3.4.6` (preflight off, utility classes only; platform classes are prefixed `v2-`), Vite `^5.4`, `pdfjs-dist ^4.10` (PDF viewing). |
| Studio editor | CodeMirror 6 (`@codemirror/*`), `pdfmake ^0.3.13` (browser PDF, in a Web Worker), `xmllint-wasm ^5.3.0` (browser XSD), `lucide`. Own grammar compiler and content-model engine. |
| Tests | Backend `node --test`; frontend `vitest ^2.1` + `jsdom ^25`; `@playwright/test ^1.49` (uses installed Chrome; `E2E_CHANNEL=msedge` for Edge). |
| Publishing toolchain | **xsltproc (libxslt 1.1.28 win32)** for XSLT 1.0; **Apache FOP 2.10** for XSL-FO -> PDF, run as a **warm JVM** (`vendor/engine/fopd.js` + `fopserver/`) with fallback to `fop.bat`; **Temurin JRE 21.0.13.1** bundled (modules java.base/xml/desktop/...); Saxon was used by Agastya V1's HTML publisher but the v2 HTML publisher is pure TS (`htmlPublish.ts`). |
| Packaging | Inno Setup 6 installer + portable zip; C# 5 host programs (`AgastyaPlatform.exe` tray/service, `AgastyaCtl.exe`) compiled with the .NET Framework `csc.exe`; ships its own 64-bit Node 22. Optional code signing (`scripts/signing`, `docs/SIGNING.md`). |
| Default port | `4040` (`PORT`); dev client `5174` (proxies `/api` and `/ws`); e2e server `4050`. |

---

## 4. High-level architecture

```
 Browser (React SPA, one origin)                                       Windows service / tray host or `npm start`
 +--------------------------------------------+                       +----------------------------------------------------------+
 | AppShell  /overview /workspace /projects   |   HTTP /api/*         | Node 22 process (backend/dist/index.js)                  |
 | ProjectShell /projects/:id/{editor,...}    | --------------------> |  Express app (app.ts)                                    |
 |   EditorRoute --+--> S1000D Studio (TS)    |   cookie session      |   json 25 MB, Origin check, /api/health                  |
 |                 +--> JSS editor (TS)       |   WS /ws (build log)  |   registerAuthRoutes + 16 route modules                  |
 | pdf.js viewer, pdfmake Worker (browser PDF)| <-------------------- |   guards: requireAuth/Admin/Roles/Project (authz.js)     |
 +--------------------------------------------+                       |  services/*  (csdb, pm, validation, release, publisher..)|
                                                                      |  context.ts: ONE sqlite handle, AuthStore, Sessions, Authz|
                                                                      |  broadcast.ts: authenticated WebSocket                   |
                                                                      +---------+------------------------------+-----------------+
                                                                                |                              |
                                          +-----------------------------------+ |                              | spawn (execFile)
                                          | workspace/  (AGASTYA_WORKSPACE_DIR)| |                              v
                                          |  publisher.db  (SQLite, WAL)       |<+        vendor/engine -> xsltproc (stage 1/2 XSLT)
                                          |  projects/<id>/ project.json       |          -> FOP warm JVM (fopd) / fop.bat -> PDF
                                          |     publication.xml  csdb/DMC-*.xml|          xmllint-wasm (XSD) in-process
                                          |     Media/  _resolved-pm.xml ...   |
                                          |  templates/ (house + brand packs)  |
                                          |  backups/ (VACUUM INTO snapshots)  |
                                          +------------------------------------+
```

**Content on disk, governance in SQLite.** Data modules, `publication.xml`, `project.json`, media and generated PDFs are files under `workspace/projects/<id>/`; `publisher.db`
holds accounts, sessions, membership, invitations, folders, audit, releases, review comments, notifications, the document index and revisions, and the S1000D reference/config tables.
The registry (`projects`, `files` tables in `vendor/engine/db.js`) only indexes the folders; `reconcileRegistry()` re-registers folders found on disk at start-up.

**Single process, single SQLite handle.** `context.ts` is the only place the store, sessions, rate limiter, authz, doc index and revisions are constructed; everything imports from it.
Consequence: no horizontal scaling, and rate-limit / build-serialisation state is in memory.

### 4.1 Phase 3 components (added 2026-11-28, phase 8)

Phase 3 added these parts to the picture above. Each has its own record; this section says where it sits and what it owns.

| Component | Where | What it owns / how it fits | Record |
|---|---|---|---|
| **Collaboration core** (live co-editing) | `backend/src/services/collab/*`, `backend/src/shared/collab/*`, `frontend/src/collab/*`; rooms over the one authenticated WebSocket (`broadcast.ts` `CollabHooks`) | Yjs (CRDT) documents per open document; the server holds the room, applies updates, persists them through the same revisioned, atomic writer as a save (`projectFiles.ts`), so revisions, locks and audit are unchanged. Check-out is an optional exclusive lock. S1000D data modules by default; JSS and JSG bind through `COLLAB-CONTRACT.md` | `docs/phase3/collaboration.md`, `collab-jss.md`, `collab-jsg.md`, `COLLAB-CONTRACT.md` |
| **PDF review** | `backend/src/services/pdfReview/*`, `routes/pdfReview.ts`, `shared/pdfAnchor.ts` (one anchor module for browser and server), migration 028; `frontend/src/components/pdfreview/*` | Threads anchored on a page of a project PDF (text quote + rectangles + the PDF version's SHA-256); re-anchored by quote when a new build changes the PDF; replies, status by role, CSV/XFDF export, **XFDF import** (phase 8), the release block setting. Travels in the **project archive** as `pdf-review.json` (phase 8: new ids, anchors kept) | `docs/phase3/pdf-review.md` |
| **GitLab** | `backend/src/services/gitlab/*`, `routes/gitlab.ts`; `frontend/src/pages/project/RepositoryPage.tsx`, `pages/AdminGitlab.tsx` | Optional, off by default; an administrator switches it on. Per-person OAuth or token; the Repository page (rail, Ctrl+K "Jump to", Project Home tile only while enabled) | `docs/phase3/gitlab.md` |
| **Build cache** | `services/publisher.ts` + build fingerprint | A build whose inputs (sources, settings, house style, tools) are unchanged is "up to date": the PDF is served, FOP does not run again | `docs/phase3/performance.md` section 5 |
| **Validation cache** | `services/validation.ts` (`.validation.json` + per-module result memo keyed by content hash and rule set), `services/brex.ts` (per-pass chain memo, per-file module facts), `services/applicability.ts` (per-module results) | An unchanged module is not checked again; after one edit only that module (and what depends on it) is re-checked; the results equal a full run (`test/phase8-cleanup.test.js`) | `docs/phase3/performance.md` section 4, `docs/phase3/cleanup-backend.md` item 5 |
| **Kept CSDB listing** | `services/csdbIndex.ts` (`FileMemo` per file: size, mtime, ctime, inode), identity index | The listing of a project's modules is kept in memory and refreshed per changed file instead of re-reading the folder; uniqueness of a new module is checked against the kept identity index; writes go through `storage/atomicWrite.ts` (single file and, phase 8, batches with one fsync pass) | `docs/phase3/performance.md` section 1, `docs/phase3/cleanup-backend.md` items 1-3 |
| **Standalone accounts** | `core/auth/*`, setup flow | Installations without a directory: Setup creates the accounts itself; same session, role and audit model | `docs/phase3/standalone.md` |

Still one process: the import, the validation and the collaboration rooms run in the server process, because the document locks, the revision
log and the room state live there (`docs/phase3/cleanup-backend.md` item 4); heavy CPU parts run in the job pool (`services/jobs/`, worker threads) or as
child processes.

---

## 5. Backend in detail

### 5.1 Start-up sequence (`index.ts`, `context.ts`, `app.ts`)
1. `context.ts` (on import): `ensureWorkspace`, seed house templates into `workspace/templates` (copy only when absent; a template that declares a higher `revision` replaces the old one and keeps a `.revN.bak`), open `publisher.db`, take a `VACUUM INTO` snapshot before migration `016` if the DB already holds projects (`dbSnapshot.ts`), run `store.migrate()`.
2. `start()`: `reconcileRegistry()`, `ensureBootstrapAdmin` (reads `INITIAL_ADMIN_USERNAME/PASSWORD`, otherwise the first visit shows a Setup screen), `createApp()` (also runs `bootReference()`: S1000D catalogues, 8 SNS presets, per-project config backfill), `startRenderer()` (warm FOP; failure = fall back to cold `fop.bat`), HTTP server, `broadcast.attach`, hourly stale-upload sweep.
3. Optional `AGASTYA_SHUTDOWN_ON_STDIN_CLOSE=1` makes the Windows service host stop it cleanly.

### 5.2 HTTP surface
~250 `app.<verb>('/api/...')` registrations (counted by grep; some paths are built from a `base` template string). Route modules:

| Module | Purpose |
|---|---|
| `core/auth/routes.js` | setup, login/logout/me, change-password, onboarding, forgot, invitations, project members, admin users/resets/releases/approvals/sessions/audit |
| `routes/workspace.ts` | overview, folders (+ access grants), projects CRUD, sample project, formats / document-types |
| `routes/project-content.ts` | data modules, media, explore, publication structure (`pmc`), validation, BREX helpers, release, review comments, watermark, **publish** (build, status, download, per-DM preview, pdf), project settings |
| `routes/s1000d.ts` | catalogue, presets, per-project S1000D config, model code, SNS (per project + admin), applicability, configuration-specific publishing |
| `routes/sns.ts`, `routes/importer.ts`, `routes/packages.ts`, `routes/lifecycle.ts` | separate SNS ordering/derive/learn; package scan/apply/repair; delivery packages, CSDB objects (DML/DDN/comment/update/IMF/SCORM), HTML publication; issue/obsolete/supersede/reinstate |
| `routes/jss.ts`, `routes/jssdm.ts` | **JSS** document get/put/validate + types/schema; front-matter data-module import/generate (S1000D side) |
| `routes/team.ts`, `routes/admin.ts`, `routes/graphics.ts`, `routes/cir.ts`, `routes/extensions.ts`, `routes/waivers.ts`, `routes/brand.ts` | team/notifications/backup/oversight; admin config & maintenance; graphics; Common Information Repository; extension profiles; gate waivers; brand packs |

Cross-cutting: a global `express.json({limit:'25mb'})`; a cross-origin **write refusal** (state-changing request whose `Origin` host differs from `Host` and is not in `AGASTYA_DEV_ORIGINS` -> 403); unknown `/api/*` -> JSON 404; SPA fallback for everything else; a final handler maps disk-full errors and hides all other errors as `500 Internal error`.

### 5.3 Authentication and authorization (verified in `core/auth/*`)
- Passwords: Argon2id, required since WP-13 (the server refuses to start without the native `argon2`; scrypt only verifies legacy hashes, off the event loop, and they are re-hashed at sign-in) (`crypto.js`). Policy (`policy.js`): 8-128 chars + common-password denylist; reserved usernames; random temporary passwords; the compiled-in master-password backdoor of JSS Publisher is neutralised (`masterPassword.js` is an inert stub; a test proves it - per `memory.md`).
- Sessions: opaque cookie `agastya_session`, 7-day absolute TTL (`sessions.js`), HttpOnly, SameSite=Lax, `Secure` when `AGASTYA_SECURE_COOKIES=1` or behind a TLS proxy (`trust proxy 1`). One active session per account (per docs). Last-seen touched at most once a minute.
- Account gates: onboarding pending and forced password change block every route except their own exit.
- Global roles: `admin | project_manager | author` (migration `013`). Project roles: `viewer(1) < reviewer(2) < editor(3) < manager(4) < owner(5)` (`authz.js ROLE_RANK`). Folder grants apply to every project filed in the folder. Admin: oversight + owner-equivalent technical rights, **cannot create projects** (403 `ADMIN_NO_PROJECTS`). `grants.js` encodes who may create/grant whom.
- Guard contract: every route must carry exactly one guard (`requireAuth`, `requireAdmin`, `requireRoles`, `requireProject(minRole, {from:'param'})`, or `publicRoute(reason)`); `test/routes-guarded.test.js` statically enforces it. Denials: 401 unauthenticated, **404** for non-members (membership is never disclosed), 403 insufficient role/gate.
- WebSocket `/ws`: upgrade authenticated from the same cookie; messages filtered to users who can read the project (`broadcast.ts`). V1's open `/ws` is fixed.

### 5.4 Database (verified in `store.js`, `vendor/engine/db.js`)
Migrations are an inline `MIGRATIONS` array applied in **array order**, each in its own transaction, recorded in `schema_migrations`; additive only (`columns:` entries add columns idempotently), `fkOff` migrations rebuild tables and run `foreign_key_check`.
Applied set (names from code): 001 users/sessions/audit, 002 reset queue, 003 membership/invitations, 004 project governance, 005 documents/revisions, 006 document locks, 007 releases, 008 release scope/content, 009 document comments, 010 folder permissions, 011 folder access & change requests, 012 change-seen, 013 manager/author roles, 014 notifications, 015 review comments + config_items + cir_modules, 016 S1000D reference (ref_sources, ref_codes, ref_code_ranges, ref_dmtype_codes, sns_presets, sns_preset_nodes, project_config, project_codes, project_sns, project_dm_types, catalogue_impacts), 017 completion (lifecycle_events, cir_links, ext_profiles, project_ext), 018 SNS preset model, 019 review-comment anchor. Registry tables `projects`, `files` are created by `engine/db.js`.
**Finding:** in the source array `014` and `015` are listed *before* `001`, and `006` after `009`. It works on a fresh database only because SQLite does not check a `REFERENCES users(id)` target at table-creation time; the name order is not execution order. A reader assuming numeric order would be wrong.
Other tables referenced in memory/docs but not individually verified here: `folder_owners`, `folder_grants`, `folder_access_requests`, `change_requests` (created by 010/011; the **approval queue they were built for is not wired in v2**).

### 5.5 Files on disk per project (`workspace/projects/<id>/`)
`project.json` (single settings document: name, `format`, `domain`, `manualType`, `type`, `pipeline`, `templateRef`, `input{pm,csdbDir,mediaDir}`, `frontMatter`, `s1000dFrontMatter`, `layout`, `pageSetup`, `watermark`, `output`, `authoring`, `jssDocType`, ...), `publication.xml`, `csdb/DMC-*.xml`, `Media/`, `.validation.json` (last validation run), `.publish-state.json` (what the last full build claimed: fingerprint + released), `publish-waivers.json`, `configurations/*.pdf`, build intermediates (`_resolved-pm.xml`, `_jss-book.xml`, `jss-output.fo`, `jss-output.pdf`, `jss-preview.pdf`, `_preview-*.xml`, `.configured/<name>/`). Output names are fixed (`jss-output.pdf` even for S1000D), which is why builds are serialised per project.

### 5.6 Key services (read in full or in the parts quoted)
- **csdb.ts** - DM files are the truth; identity parsed from the first 12 KB; writes: XXE/entity safety (`xmlGuard`), "document twice" guard, locks, SHA-256 optimistic concurrency (409), immutable revision; malformed XML refused, schema-invalid saved as draft; identity = code+issue+language must be unique (`409 DUPLICATE_DMC`).
- **validation.ts** - one normalised issue list from sources `xml, xsd, brex, graphics, ids, icn, pm, applic`; XSD against the issue each module *declares*; last run cached in `.validation.json`.
- **publishGate.ts** - a PDF/release needs a **fresh** validation: well-formed -> XSD of the module's own issue -> BREX (`brex.ts`, XPath 1.0 only) -> applicability; files hashed before and after (`CHANGED_DURING_VALIDATION`); a module that could not be checked counts as invalid; recorded **waivers** can stand in for a missing BREX in *draft* builds only. For JSS projects it delegates to `assertJssPublishable`.
- **release.ts** - fingerprint = hash of publication sources + a fixed list of settings keys; released = approved release whose fingerprint still matches; any later change drops it back and the next PDF is stamped **NOT RELEASED**. Approval needs admin, or PM with manager/owner role on that project.
- **publisher.ts** - see section 6.
- **lifecycle.ts** - multiple issue/in-work files per module, pinned vs unpinned refs, issue/obsolete/supersede/reinstate, change-mark suggestions.
- **applicability.ts / applicEval.ts** - ACT/CCT/PCT checks and configuration-specific publications (filtered copy built in `.configured/`).
- **sns.ts + sns/** - two independent SNS systems (global presets / per-project hierarchy, and a separate "separate SNS" ordering model with learn/derive); deletion blocked while modules use a code.
- **importer/** - package scan -> repair -> structure -> apply, flavour detection (xignal-jss, xignal-s1000d, vektra, generic), PDF-TOC structure recovery, ZIP reader with ZIP-slip/bomb guards (`zipio.ts`, offline ZIP64 writer).
- **htmlPublish.ts** - static HTML site/zip (no script, no network, everything HTML-escaped); `cir.ts` shared Common Information Repository (a system project, never published/released); `extensions.ts`; `graphics.ts`/`assets.ts`/`mediaFormats.ts`; `backup.ts` + `zip.ts` (own ZIP writer, no dependency); `notifications.ts`, `activity.ts`, `oversight.ts`.
- **jssdm/** - **S1000D** front-matter data modules <-> project Settings (`fromDms`, `toDms`, sidecar `consumed`/`generated` bookkeeping, `prune`, `unwrap` Xignal's wrapper folder). Despite the name it is not the JSS authoring path.

---

## 6. Publishing pipelines (three, all ending in XSL-FO + FOP)

`publisher.ts` decides per build. Release state decides the watermark (`resolveMarks`), never the project's own setting: unreleased = **NOT RELEASED**.

```
                    +--------------------------- assertPublishable (fresh XML/XSD/BREX/applic, hashes) ---------------------------+
                    |                                                                                                            |
 A. S1000D DIRECT   |  publication.xml (<pm>) + csdb/*.xml                                                                       |
    pipeline        |   -> rewriteRevisionRefs -> resolveDmRefs (dmRef -> xi:include) -> repairIncludePaths -> guardMissingIncludes
    's1000dtofo'    |   -> injectDirectFrontMatter (from Settings) -> _resolved-pm.xml                                          |
                    |   -> engine.buildS1000dToFo: xsltproc s1000dtofo.xsl -> jss-output.fo -> FOP -> jss-output.pdf             |
                    |   page furniture: xignal profile (brand pack, logo, margin marks) OR sideText.ts defaults                  |
                    +------------------------------------------------------------------------------------------------------------+
 B. S1000D via JSS  same input prep, then dropConsumedModules + unwrapChapterFolders, then
    pipeline        |   -> engine.buildJss: stage1 s1000dtojss.xsl -> jss-book.xml (<jssbook>) -> stage2 jsstofo.xsl -> FO -> FOP
    's1000dtojss'   |   (the project's pipeline setting selects A or B for an S1000D <pm>)
 C. JSS-AUTHORED    |  publication.xml (<jssbook>, authoring 'jss-xml')   [isJssAuthored]
    (hand-written)  |   -> composeBook: add shared frame pages (title, notices, record of changes, contents ... symbols) from Settings
    document        |      -> _jss-book.xml -> engine.buildJss with isS1000D=false (stage 1 skipped) -> jsstofo.xsl -> FO -> FOP
                    |   stencil layout parameters via layoutParamsFor (Arial Narrow headings, cover title lines, cover.inbr.show ...)
                    +------------------------------------------------------------------------------------------------------------+
 D. Server preview of ONE data module: a generated minimal <pm> (`_preview-pm.xml`) through A or B, no front matter.
 E. Configuration-specific PDF: filtered copies in .configured/<name>/ through renderFull (always NOT RELEASED, S1000D only).
 F. Browser quick preview: Studio's pdfmake in a Web Worker (works on drafts; independent of the server).
```

Notes verified in code: builds are serialised per `projectId:kind` (`serial()` promise chain); progress goes out over `/ws`; failures go through `explainBuildFailure` (summary, file, line, hint); the S1000D direct engine reaches the JSS stylesheets through **one include only** (`frontmatter-shared.xsl` -> `../jsstofo/frontmatter.xsl`) and a `cover.inbr.show` parameter was added to that shared file as a documented exception (`docs/JSS_VENDOR_EXCEPTIONS.md`) - so a JSS edit can still affect S1000D output; `jss-cover-isolation.test.js` guards it with canonicalised FO fingerprints.

---

## 7. S1000D side (editor, schemas, validation, rendering)

- **Editor**: `frontend/src/studio` is a copy of S1000D Studio (standalone product, own git history upstream) embedded with a patch to `ui/app.ts` (`StudioHost` interface: open/save through the API with the loaded hash, ICN artwork from project media, quick preview, go-to-line, silent close, embedded UI trims, four absolute asset URLs `/schemas /vendor /brex /samples`). `lib/studioSession.ts` keeps **one `App` instance for the page** (it binds global listeners in its constructor), so open documents and undo survive navigating away.
- The XML DOM is the model; grammar compiled from the XSDs (`frontend/scripts/build-grammar.mjs`), a Brzozowski-derivative content-model engine, in-browser XSD via `xmllint-wasm`, in-browser BREX (`studio/validation/brex.ts`), MutationObserver undo/redo.
- **Server validation** is separate code (backend `xmllint-wasm`, `brex.ts`, `applicability.ts`). The Studio's own BREX library is **per browser**, not per project; server validation uses the project's BREX data module (or the official default of the module's issue).
- Coverage: 21 data module types x issues 4.2/5.0/6.0/7.0 (matrix in `docs/S1000D_COMPLIANCE_MATRIX.md`, per docs). Schema provenance is **unverified for 7.0** and the DDN/Comment/Update/SCORM schemas of 4.2-6.0 are "copied toolkit sources with no independently verified origin" (`backend/schemas/PROVENANCE.md`; 7.0 has none of those four).
- Rendering: `s1000dtofo` XSLT (per-type stylesheets: descript, proced, fault, crew, ipd, tables, warnings, lists ...), Xignal layout profile (`xignal-cover.xsl`, `xignal-furniture.xsl`, `xignal-divider.xsl`), brand packs under `templates/brand/`.

## 8. JSS side (editor, schema, validation, rendering)

- **Editor**: `frontend/src/jss/` (model, xml reader/writer, ops, numbering, inline, style, `editor.ts` 979 lines) is independent of `src/studio` (only `EditorRoute.tsx` chooses between them: `summary.project.authoring === 'jss-xml'`). `JssEditorPage.tsx` shows the editor beside the server-built PDF (edit/split/pdf views). The model is a plain DOM-free tree; reading refuses anything the schema forbids rather than dropping it.
- **Source of truth**: one `publication.xml` (`<jssbook>`) per project containing identity (`<bookmeta>`) and body (chapters/sections/paragraphs/lists/tables/figures/notices/page breaks). The **shared frame** (title pages, foreword, record of changes, contents, symbols) is **not** in the document: it comes from the project's Settings and is added at build time by `composeBook`, so all types print the same frame.
- **API**: `GET/PUT /api/projects/:id/jss` (PUT with `baseHash`, malformed refused, schema-invalid saved as draft), `POST .../validate`, `GET /api/jss/types`, `GET /api/jss/schema`.
- **Validation** (`jss/service.ts validateJss`): XSD (`jss-1.0.xsd`) + stencil rules (table grid consistency, etc.); `assertJssPublishable` re-checks and hashes before a PDF/release.
- **Type registry** (`jss/registry.ts`): 15 document types read from the customer's JSS0251 Word stencils. **Ready: `uhb`, `mm`, `orm`** (chapter manuals). **Not ready, refused with a reason:** `uhb2`, `tm-pi`, `ds`, `tote-cs`, `prs` (chapter manuals "not yet taken through the end-to-end check"), `mrls`, `rotable` (single-table), `vol-1-pl`, `mpl`, `ispl`, `ispl-wrt-jss` (parts lists), `vol-2-illustrations`. The **Naval** domain lists ten manual types, **all `ready: false`**. **JSG** ready: false.
- The publisher also supports a *second, older* JSS route: S1000D modules converted to a JSS book (`profiles.ts` "UHB" profile; `xignal-jss` house template; the README's "Xignal-style JSS handbook (best effort)"). That is S1000D content, not the JSS authoring path.

---

## 9. Frontend architecture

- Entry `main.tsx` -> `App.tsx`: session status (`loading | authed | gated | ...`) selects `AuthScreens` (setup, sign-in, forgot, onboarding, forced change) or the router. On sign-in/out the URL is reset to `/overview` (a `/` navigate races the index redirect).
- Routes: `AppShell` -> `overview, workspace, projects, activity (admin/PM), notifications, graphics, cir, backup, administrator/* (admin), settings/*`; `preview/:id/:mode` (pop-out window fed by `lib/previewBus.ts` BroadcastChannel); `ProjectShell` -> `editor, explore, publication, validation, graphics, release, csdb, settings/*` (project index redirects to `editor`).
- State: Zustand stores (`session`, `ui`, `inbox`, `appSettings`, `navStore`) plus `studioSession`'s own store. API layer `src/api/*.ts` over a small fetch wrapper (`client.ts`: same-origin cookie, central 401 -> sign-out, `ApiError` with `status/code/body`).
- Design system: the platform shares the Studio's CSS tokens (`:root` variables, `html[data-theme]`) so one theme switch covers both editors; `x-*` classes/`--x-*` tokens are a compat layer for screens reused from Agastya V1; Tailwind preflight is off.
- Build: `tsc --noEmit && vite build`; target es2022; a `react` manual chunk; editors are lazy-loaded (`EditorRoute`); chunk-size warning raised to 1500 kB; worker format ES (pdfmake worker).

---

## 10. Configuration, deployment, operations

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 4040 | HTTP port |
| `AGASTYA_HOST` | all interfaces (packaged product sets `127.0.0.1`) | bind address |
| `AGASTYA_WORKSPACE_DIR` | `../workspace` | projects, templates, `publisher.db` |
| `AGASTYA_CLIENT_DIST` | `../frontend/dist` | built client |
| `AGASTYA_SECURE_COOKIES` | unset | `1` = Secure cookie |
| `AGASTYA_DEV_ORIGINS` | `http://localhost:5174` | extra allowed Origins for writes |
| `INITIAL_ADMIN_USERNAME` / `_PASSWORD` | unset | unattended first admin |
| `JSS_JAVA` | bundled JRE, else `java` | Java runtime |
| `AGASTYA_SHUTDOWN_ON_STDIN_CLOSE` | unset | clean stop when the service host closes stdin |

Deployment modes: (a) `npm start` (`scripts/start.mjs` rebuilds a stale backend/frontend first; a server run from an old build silently lacks routes); (b) Windows installer/portable zip with tray app or service, optional LAN firewall rule, data kept on uninstall (`docs/PACKAGING.md`, `docs/OPERATIONS.md`); (c) behind a TLS reverse proxy (`trust proxy 1`). Backup: `GET /api/backup` streams a ZIP (projects, users, memberships, audit; no password hashes) scoped to what the caller may see; **no restore feature** (per docs). Database restore after the 2026-11-22 incident is documented in `docs/DATABASE_RESTORATION.md`; `dbSnapshot.ts` now never trusts an existing file name as proof of a snapshot.

---

## 11. Development workflow

```
npm run install:all          # backend + frontend dependencies
npm run doctor               # Node >= 22, node:sqlite, Java, xsltproc, FOP, schemas, 259-char Windows path budget, client build
npm run dev:backend          # ts-node-dev --transpile-only, :4040
npm run dev:frontend         # vite :5174, proxies /api and /ws to :4040
npm run build                # tsc (backend) ; tsc --noEmit && vite build (frontend)
npm start                    # rebuild if stale, then node backend/dist/index.js
npm run reset-admin -- <username>          # asks for the password (or --stdin)
npm run package:win [-- --build --no-installer --no-zip --no-arial]   # Windows installer/zip
```
Gotchas: the e2e server runs `backend/dist`, so **build before testing** (root `npm test` does); Windows path limit 259 characters for the bundled native tools; proprietary Arial / Arial Narrow fonts are git-ignored (PDFs fall back to Liberation Sans if absent, `fop.xconf` omits missing faces); `SAMPLE PROJECTS/` and `manual format/` are git-ignored customer material and dependent tests skip themselves when absent; never `git add -A` on a tree holding them.

---

## 12. Tests

| Suite | Command | Size (counted, not run) |
|---|---|---|
| Backend | `npm run test:backend` = `node --test test/*.test.js` | 71 files, 451 `test()/it()` calls, ~11k lines. Areas: auth/RBAC/route-guard coverage, projects/CSDB/api, validation/BREX/gate/waivers, release/lifecycle, SNS (two systems), importer, packages/zip, HTML publish, applicability, brand packs, Xignal PDF furniture, 21-type PDF rendering, JSS authoring/stencil corrections/cover isolation, migrations/db-snapshot, security |
| Frontend unit | `npm run test:frontend` = `vitest run` excluding the heavy `verify/` set | 24 `*.test.ts` outside the studio folder plus 14 under `src/studio/__tests__`; jsdom |
| Studio verification | `npm run test:verify`, `test:verify:elements`, `test:verify:e2e`, `npm run verify` | element/rule/BREX-parity/21-type x 4-issue checks; `verify-report.mjs` collates |
| End-to-end | `npm run test:e2e` (Playwright, real server on a throwaway workspace, Chrome/Edge) | 17 spec files, 119 `test()` calls; the `zz-verify-*` specs (about 5 minutes) run only with `VERIFY_E2E` |
| Packaging | `verify:package`, `scripts/verify-installer.mjs`, `scripts/vm-acceptance/` | offline-runtime and installer proofs |

**Last recorded results (from `docs/JSS_MERGE_2026-11-23.md`, not re-run for this report):** backend 491 tests, 490 pass, 0 fail, **1 cancelled by its own 600 s limit** (`publish-gate.test.js` "all 21 types" takes ~430 s alone, so it overruns when 66 other files run in parallel; the same happened on 2026-11-17 and 11-22); `tsc --noEmit` clean; `vitest run src/jss src/components` 66 pass. **Not run at the merge:** the JSS editor Playwright spec (`frontend/e2e/jss-editor.spec.ts`), the frontend `verify` suites, the installer build. The Studio's own 660-unit suite is not run against the embedded copy (per `memory.md`).

---

## 13. Incomplete features, technical debt and limitations

**Incomplete / not built**
1. **JSG**: nothing beyond the stencil folder; server refuses creation. **Naval JSS**: all ten manual types `ready:false`. **JSS**: 12 of 15 document types not ready (section 8); only chapter-manual bodies exist for `uhb/mm/orm`; parts-list, illustration and single-table body kinds have no schema/editor/layout.
2. JSS Publisher features **not ported**: approval queues for structure changes, folder-access requests, change-request flow (tables exist, unused), notifications beyond the v2 set, backup **restore**, licensing, Electron shell, Excel DMRL import, batch rename (per docs).
3. No real-time co-editing: optimistic concurrency only (409 "copy your work, reopen"). Viewers can type in the Studio (no read-only mode); the save is refused with 403. No per-DM workflow-status UI.
4. S1000D: BREX XPath 2.0 not evaluated (reported as warnings); no 7.0 DDN/Comment/Update/SCORM schemas; schema provenance unverified; compliance evidence is the 4.2 spec text only (per docs).
5. The Studio's BREX library is per browser; Studio quick preview cannot resolve entity-declared graphics unless they are in the project's `csdb/Media`.

**Technical debt / design limitations**
1. **Vendored code is not really frozen**: `backend/vendor/pipeline/jsstofo/frontmatter.xsl` carries a documented exception (`cover.inbr.show`) and `s1000dtofo` is edited on purpose; `backend/vendor/engine/*` is "do not edit" but is what the whole publishing path runs on and has no type checking (`vendor()` returns `any`). The S1000D engine's single include of a JSS stylesheet couples the two formats at one point.
2. Misleading names: `jss-output.pdf`, `buildJss`, `s1000dtojss` (pipeline value for hand-authored JSS), `jssdm` (S1000D front-matter), `JSS_JAVA`.
3. Untyped core: `core/auth/*.js` (store.js 1,571 lines, routes.js 1,014) and `core/collab` are plain JS; `context.ts` exports them as `any`.
4. Migration array is not in numeric order (section 5.4) and migrations are additive only; the `projects`/`files` registry tables are created outside the migration list.
5. Single-process, in-memory state (rate limiter, per-project build serialisation, one warm FOP); one active session per account; bundled toolchain is Win32-only (Linux needs xsltproc + Java + xmllint; `tools-linux` has no JRE).
6. `node:sqlite` is experimental on Node 22 (the engine targets 24); `argon2` is optional and normally absent (scrypt fallback).
7. The long `publish-gate` test exceeds the runner's own timeout under parallel load; two copies of the project forked from `96333a6` were merged by hand (`docs/JSS_MERGE_2026-11-23.md`), so line endings are mixed LF/CRLF in many files.
8. Windows 259-character path limit constrains project-id length and workspace location; the frontend editor chunk is large (~1.1 MB, lazy).
9. Owner decision pending: shipping Arial/Arial Narrow in the installer (licence position).
10. `memory.md` and `README.md` are long, partly narrative logs; some statements are historic (e.g. phase test counts) and will have drifted.

**Security notes visible in code (positive):** every route guarded and tested; 404-not-403 for non-members; XXE/entity guard on XML writes; ZIP-slip/bomb/CRC guards; HTML publish escapes everything; `execFile` (no shell strings) for external tools; secrets stripped from audit metadata; cross-origin write refusal. **Not verified at runtime** in this investigation.

---

## 14. How this report was produced - and its limits

**Read and checked against code:** `package.json` files, `index.ts`, `app.ts`, `config.ts`, `context.ts`, `formats.ts`, `jss/registry.ts`, `jss/service.ts` (first 70 lines + export list), `routes/jss.ts`, `publisher.ts` (all), `publishGate.ts` (header + start), `validation.ts`/`release.ts`/`csdb.ts` (headers), `projects.ts` (header + exports), `broadcast.ts`, `authz.js`/`policy.js`/`crypto.js`/`sessions.js` (relevant parts), `store.js` migration list and `migrate()`, `engine/db.js`, `doctor.js`, `start.mjs`, `vite.config.ts`, `playwright.config.ts`, `App.tsx`, `EditorRoute.tsx`, `JssEditorPage.tsx` (top), `jss/model.ts`, `studioSession.ts` (top), the `.gitignore`, plus directory listings and endpoint/line/test counts by grep.

**Taken from documents, not re-verified:** test pass counts and run times, "one active session per account", phase histories, the S1000D compliance matrix, packaging steps, backup/restore semantics, `memory.md` phase notes (the file was read only to line 184 plus selected lines; its remaining ~260 lines were searched, not read).

**Skimmed only (purpose from headers/names):** `applicability.ts`, `applicEval.ts`, `lifecycle.ts`, `sns/*`, `importer/*`, `extensions.ts`, `cir.ts`, `htmlPublish.ts` body, `brex.ts` body, the XSLT stylesheets (listed, not read), `engine/build.js` internals, Studio core/export code, JSS editor internals, the Windows host `AgastyaHost.cs`, installer scripts.

**Not done:** no test, build, typecheck or server run (they write build output and test workspaces); no dependency-version lookup from lockfiles; no runtime security verification; endpoint count (~250) is a grep count and may include a few non-route matches.

Before building on any area listed under "skimmed only", read its code first.
