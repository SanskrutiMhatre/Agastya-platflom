# 15 - Audit coverage and verification (version 2: agent J register + lead merge)

Scope and method. This register lists every top-level and second-level folder or module of `Agastya-platform-v2`, what it is, how big it is, which audit agent owns it, what has actually been inspected, how it was verified, and what is left. It is the single place where "was this looked at?" is answered. Version 1 was written by agent J (the mapper) at the end of the discovery pass; the lead merges the other agents' coverage into it. Counts are for tracked files (Git) taken from `loc.json` produced by `loc.mjs` (physical lines, including comments); items that are git-ignored or generated are marked "not counted". Where a row says "Pending - owner", agent J did not read it and has no claim about its content.

## How to read and extend this register

- **Inspected by** lists the owning agents first, then `J` if the mapper also looked. Agent letters: A platform and database, B S1000D, C JSS, JSG and publication, D frontend shell, E1 UX, E2 design system, F deployment and offline, G testing and QA, H performance, I research and enterprise readiness, S security and reliability.
- **Status** vocabulary: `Inspected` (read in full or the relevant parts in full), `Partially inspected` (parts read, the rest named under Limits), `Listed only` (directory listing, hashes or counts, no content), `Not inspected`, `Pending - owner` (not read by J; the owning agent should overwrite this cell with its own status and verification). Rows written by J carry J's own status only; they do not stand in for the owner.
- To extend: overwrite `Status`, `Verification done` and `Limits` in the owner's row, keep the row order, and add rows beneath a folder if the owner splits it. Add new top-level folders to the first table.
- Evidence labels follow the audit brief: VERIFIED (a command or test was run), OBSERVED (read in code or output), SUSPECTED, RECOMMENDATION, NOT VERIFIED.

### Top-level areas

| Area | What it is | Files / lines (tracked) | Inspected by | Status | Verification done | Limits |
|---|---|---|---|---|---|---|
| `(root files)` | package.json (orchestration scripts), README.md, memory.md (owner work log), .gitignore, .gitattributes | 5 / 845 | J; I | Partially inspected | npm scripts read; README and memory.md spot-checked for stale claims | prose not read in full |
| `.git` | Git history (86 MB) | not counted | none | Not inspected | size only (no git command that changes state) | history, branch and tag state not examined |
| `backend/` | Express + TypeScript API, vendored engine, bundled tools, schemas, tests | 1,019 / 1,093,848 (74.8 MB) | A, B, C, F, G, S; J | Partially inspected | every second-level folder listed below | see rows below |
| `frontend/` | React + Vite shell, three embedded editors, Playwright e2e, public assets | 658 / 912,298 (59.7 MB) | D, E1, E2, G; J | Partially inspected | every second-level folder listed below | see rows below |
| `packaging/` | Inno Setup script, C# host, ini template, third-party notices, icons | 13 / 2,085 | F; J | Partially inspected | see second-level rows | installer not built or run |
| `scripts/` | start, package-windows, verify-*, signing, vm-acceptance | 13 / 1,909 | F, G; J | Partially inspected | see second-level rows | not run |
| `docs/` | operator guides, architecture notes, work logs, audit output | 24 / 4,314 | I, all; J | Partially inspected | see second-level rows | not read in full |
| `release/` | staged installer output (git-ignored) | not counted | F | Partially inspected | listing, `runtime/node.exe --version` (v22.23.2), argon2 prebuild listing | binaries and installer not examined |
| `workspace/` | owner runtime data and publisher.db (git-ignored) | not counted | none | Not inspected by design | the brief forbids reading it | - |
| `SAMPLE PROJECTS/`, `manual format/` | customer reference material (git-ignored) | not counted | none | Not inspected | not read or quoted | - |

### Second-level folders and modules

| Area | What it is | Files / lines (tracked) | Inspected by | Status | Verification done | Limits |
|---|---|---|---|---|---|---|
| `backend/src` (app.ts, config.ts, context.ts, index.ts, types.d.ts) | app wiring, 5 settings, singleton context, start/stop | 5 / 352 | A; J | Inspected | read in full: middleware order, wiring, start and shutdown | - |
| `backend/src/core/auth` | identity, sessions, authz, SQLite store (36 tables, 19 migrations), policy, rate limit, XML guard | 11 / 3,556 | A, S; J | Partially inspected | login, sessions, `requireAuth`/`requireProject`, crypto read; DDL parsed by script; `rbac.test.js` run 7/7 | 966-line `registerAuthRoutes` read only around login/logout/me; store.js methods not read |
| `backend/src/core/collab` | document index and revisions (blobs by hash) | 2 / 190 | A; J | Partially inspected | `classifyKind` and sync read | `revisions.js` not read in full |
| `backend/src/routes` | 21 route registrars, 276 routes | 21 / 2,623 | A, B, C, S; J | Partially inspected | full inventory by script, checked against live router (0 unguarded); handlers read for DM CRUD, release, publish, validate, import, backup, jss, jsg, workspace | other handler bodies not read |
| `backend/src/services` (top-level files) | projects, csdb, publisher, publishGate, validation, brex, pm, release, review, backup, packages, cir, lifecycle, applicability, platform, uploads, zip ... | 58 / 9,104 | A, B, C, H; J | Partially inspected | first comment of every file; csdb, projects, publisher, publishGate, backup, release, pm, dbSnapshot read | brex, applicability, lifecycle, packages internals not read |
| `backend/src/services/importer` | package scanner, repairs, apply, assign, PDF structure recovery | 22 / 3,475 | B, S; J | Partially inspected | headers; `apply.ts` lines 60-150; flow traced (trace 7.7) | repair rules not read |
| `backend/src/services/jss` (incl. `rwi`) | JSS authoring service, registry (Land, Naval), RWI import/export mapping | 14 / 3,189 | C; J | Partially inspected | `service.ts` writeSource, headers; duplicate model functions measured by script | mapping and exporters not read |
| `backend/src/services/jsg` | JSG service, engine (xsltproc + FOP), DOCX import | 6 / 1,412 | C; J | Partially inspected | `service.ts:197` save, `engine.ts` serial queue | DOCX import not read |
| `backend/src/services/jssdm` | JSS front-matter data modules and sidecar | 8 / 1,893 | C; J | Partially inspected | headers; sidecar write pattern | not read |
| `backend/src/services/sns` | SNS model, derive, learn, store | 8 / 1,578 | B; J | Partially inspected | headers only; routes inventoried | not read |
| `backend/src/services/xengine` | cross-engine identity records, conversions, project import | 5 / 1,145 | C; J | Partially inspected | headers; `convert.ts` zipOfS1000dProject, `project.ts` syncIdentity | conversion rules not read |
| `backend/vendor/engine` | vendored publishing engine: build, config, paths, FOP server, validators | 32 / 6,731 | C; J | Partially inspected | `build.js` (`buildJss`, `buildS1000dToFo`), `fopd.js` read; function sizes by script | `config.js` stage2Params, `pmc.js`, `resolveDmRefs.js` not read |
| `backend/vendor/pipeline` | XSLT pipelines (S1000D to FO, JSS to FO, JSS book) | 64 / 21,211 (1.2 MB) | C, B | Owner status: section A | listed only | stylesheets not read |
| `backend/vendor/tools` (fonts, fop-2.10, jre, libxslt) | bundled FOP 2.10, Temurin JRE 21.0.13.1, libxslt 1.1.28, fonts | 4,356 tracked files / 58 MB | F, C; J | Partially inspected | `xsltproc --version` and `java -version` run; directory listings | licences, integrity hashes, font coverage not reviewed |
| `backend/vendor/tools-linux` | Linux fonts, FOP, libxslt | not counted | F | Owner status: section A | listed only | not inspected |
| `backend/schemas` | S1000D XSDs (issues 3.0, 4.1, 4.2, 5.0, 6.0, 7.0), JSG and JSS XSDs, PROVENANCE.md | 256 / 936,262 (40.4 MB) | B, C | Listed only (J: hashes); owner pending | SHA-256 duplicate scan against `frontend/public/schemas` | content not read |
| `backend/brex`, `reference`, `assets`, `templates`, `templates-optional` | default BREX modules, reference lists, logos, project templates | 22 / 36,869 (3.0 MB) | B, A | Listed only (J: duplicates); owner pending | duplicate detection (BREX copies in `frontend/public/brex`) | content not read |
| `backend/samples` | JSG sample books (UHB 23 MB, ISPL 3.5 MB) | 333 / 39,835 (26.6 MB) | C | Owner status: section A | duplicate detection only | not read |
| `backend/scripts` | doctor, reset-admin, sample builders, perf probes, golden-xignal | 13 / 902 | F, G; J | Partially inspected | listed; env-var greps | not read |
| `backend/test` | node:test suite (83 files, 539 test calls) and 50 fixture files | 136 / 21,567 (1.3 MB) | G; J | Partially inspected | names listed; route references matched by script; `rbac.test.js` and `zipio.test.js` run | full suite not run (shared machine) |
| `backend/dist`, `backend/node_modules` | compiled output and dependencies (git-ignored) | not counted | F, H | Listed only (J) | `dist/app` loaded by `dump-routes.js` to dump the live router (scratch workspace, no listen) | not audited |
| `backend` config (package.json, package-lock.json, tsconfig.json) | dependencies, scripts, compiler options | 3 / 1,954 | F; J | Inspected | dependencies and locked versions extracted by script (`deps.mjs`) | - |
| `frontend/src` (App.tsx, main.tsx) | router table and bootstrap | 2 / 103 | D; J | Inspected | read; route table in section 8.2 | - |
| `frontend/src/pages` | 35 page components (project, settings, admin) | 35 / 6,066 | D, E1; J | Partially inspected | every file header read; `JssEditorPage`, `JsgEditorPage` save and autosave read | page bodies not read |
| `frontend/src/components`, `layouts` | shared UI, PDF viewer, shells | 23 / 2,407 | D, E2; J | Partially inspected | headers; `ui.tsx` fan-in by script | not read |
| `frontend/src/api`, `store`, `lib`, `styles` | client wrappers (about 230), Zustand stores, helpers, CSS | 35 / 3,103 | D, E2; J | Partially inspected | `api/client.ts` read; wrapper usage scanned by script (`apiuse.mjs`); `studioSession.ts` save and draft paths | styles not read |
| `frontend/src/studio/core`, `validation` | XML model, grammar, operations, XSD and BREX validation in the browser | 16 / 5,207 | B | Owner status: section A | import graph and size by script only | not read |
| `frontend/src/studio/ui`, `view` | Studio application shell, editors, dialogs, panels, Design and Tags views | 15 / 8,013 | B, E1; J | Partially inspected | `app.ts` draft and host paths read (ARC-002, ARC-012); cycle found by script | rest not read |
| `frontend/src/studio/export` | client-side publication PDF (pdfmake), fonts | 19 / 3,295 | B, H | Owner status: section A | size and reachability only (ARC-012) | not read |
| `frontend/src/studio/__tests__`, `styles` | Studio unit tests and CSS | 57 / 4,100 (1.7 MB) | G, E2 | Owner status: section A | listed only | not run |
| `frontend/src/jss` | JSS editor (framework-free) | 15 / 3,586 | C, E1 | Owner status: section A | import isolation by script; duplicate model functions (ARC-007) | editor not read |
| `frontend/src/jsg` | JSG User Handbook and Spare Parts List editors | 10 / 2,264 | C, E1, S | Owner status: section A | import isolation, `innerHTML` counts by script (lead S1) | editors not read |
| `frontend/e2e` | Playwright specs (12, 100 tests) and fixtures (dm21 and others) | 104 / 9,278 | G; J | Partially inspected | test names listed; fixture coupling found (ARC-023) | not run |
| `frontend/public` | XSD copies, compiled grammars, BREX, samples, xmllint wasm, pdf worker | 316 / 859,525 (55.3 MB) | B, H; J | Listed only (J: hashes); owner pending | SHA-256 duplicate scan against `backend/schemas` (ARC-010) | content not read |
| `frontend` config and helpers (vite, tailwind, postcss, tsconfig, `scripts/build-grammar.mjs`, `test-support`) | build configuration and the grammar generator | 11 / 5,351 | D, E2, F; J | Partially inspected | `package.json`, vite config, `build-grammar.mjs` header read | - |
| `frontend/dist` | built client (git-ignored) | not counted (65 MB) | H | Listed only (J) | asset listing and duplicate-chunk count (ARC-021) | bundle contents not analysed |
| `frontend/test-results`, `verification-results` | run output of earlier e2e and verification runs (git-ignored) | not counted | G | Not inspected | - | - |
| `packaging/host`, `installer` | C# tray and service host; Inno Setup script | 2 / 1,324 | F; J | Partially inspected | headers and section names read | installer `[Code]` section not read; nothing built or run |
| `packaging/assets`, `third-party`, ini template, product.json | icons, notices, configuration template | 11 / 761 | F, I | Owner status: section A | listed only | not read |
| `scripts` (top level) | start, package-windows, import-vim-dicts, verify-e2e, verify-elements, verify-installer, verify-package-offline, verify-report | 8 / 1,380 | F, G; J | Partially inspected | `package-windows.mjs` dependency staging and env greps read | not run |
| `scripts/signing`, `vm-acceptance` | code-signing hooks, VM acceptance checks | 5 / 529 | F | Owner status: section A | listed only | not read |
| `docs` (22 documents, `legal`, `sample-comparison`) | operator guides, architecture notes, work logs | 24 files / 4,314 lines (counted before docs/audit existed) | I, F; J | Partially inspected | headers; stale-claim spot checks (README:204, architecture document); OPERATIONS.md sections 7-8 | not read in full |
| `docs/audit` | this audit | varies | lead | n/a | written by the audit agents | - |

## Verification registry (what J ran, so that others can repeat it)

All scripts are in the scratch folder of agent J (the J folder of the audit scratchpad), take the repository path as an argument and write nothing into the repository.

| Check | Script | Input | Result | Limits |
|---|---|---|---|---|
| File and line counts | `loc.mjs` | tracked files (6,093) | per-folder counts in this register | physical lines; binary files count bytes only |
| Static route table | `routes.mjs` | `backend/src/routes/*.ts`, `core/auth/routes.js`, `app.ts` | 276 routes with guard, handler line, test references | regular-expression scan; literal path matching |
| Live router dump | `dump-routes.js` | `backend/dist/app` loaded with a scratch `AGASTYA_WORKSPACE_DIR`; no port opened | 282 router rows, 276 unique, 0 unguarded `/api` routes | reflects the compiled `dist`, which may lag the source |
| Frontend API usage | `fe-api.mjs`, `apiuse.mjs` | `frontend/src` | 54 routes without a literal caller; 43 of about 230 wrappers uncalled | lexical; URLs built from variables are missed |
| Import graph, cycles, fan-in/out | `graph.mjs`, `lib.mjs` | backend 187 files, frontend 183 files | 3 backend cycles (1 runtime), 1 frontend cycle | lexical; dynamic `require(variable)` invisible |
| Layering probes | `layers.mjs` | both trees | rules in section 8.4 of doc 01 | pattern-based |
| DB tables and touchers | `tables.mjs` | `core/auth/store.js` DDL and `backend/src` | 38 tables, 4 without a writer, 18 unused `AuthStore` methods | string match on table names |
| Dead exports | `dead.mjs` | 2,499 exports in 338 files | 34 unreferenced, 4 unimported files | namespace imports may hide uses |
| Duplicate functions | `dup.mjs` | function bodies of 4+ lines | 8 exact groups, 99 same-name groups | same name is not same behaviour |
| Function and file sizes | `sizes.mjs` | all source files | hot spots in section 8.7 | counts comments |
| Duplicate files | `filedup.mjs` | all tracked files (SHA-256) | 75 groups, 12.2 MB redundant | exact bytes only |
| Third-party inventory | `deps.mjs` | both `package.json` and lockfiles, `node_modules/*/package.json` licence fields | counts and licences in section 3 of doc 01 | declared licences only |
| Tool versions | shell | `xsltproc.exe --version`, `java.exe -version`, `release/.../runtime/node.exe --version` | libxml 2.9.3, libxslt 1.1.28, Temurin 21.0.13.1, Node v22.23.2 | no CVE mapping |
| Tests run | `node --test` | `backend/test/rbac.test.js`, `backend/test/zipio.test.js` | 7 of 7 and 5 of 5 pass | 2 of 83 backend test files; no frontend unit test, no Playwright |
| Pure-function probe | `pmprobe.cjs` | `vendor/engine/pmc.parsePm` on a `<jssbook>` | throws "Not a publication module" | one input |

## Gaps J knows about

1. No agent has yet been recorded for `backend/vendor/pipeline` (about 21,000 lines of XSLT) beyond its owner row; the layout rules of every PDF live there.
2. `backend/vendor/tools-linux` and the Linux/macOS story are not covered by any listed document I read.
3. `frontend/src/studio` (107 files, 20,600 lines) is the largest piece of code that J read least; it is owned by B and E1.
4. The installer source (`packaging/installer`, 438 lines) and the C# host (`packaging/host`, 886 lines) were not read beyond their headers; owner F.
5. 74 of 276 routes have no test reference (doc 01 section 8.1); agent G owns closing this.
6. The Unknowns in doc 01 section 11 are the open verification items of the mapper.

---

# Lead merge (version 2): owner coverage, verification across all agents, open unknowns

## A. Owner status for the rows J marked "Pending - owner"

Taken from each agent's own final report; where an agent did not report on a row, the row says so. These supersede the `Pending - owner` cells above.

| Area | Owner(s) | Status | Verification done (by the owner) | Limits |
|---|---|---|---|---|
| `backend/vendor/pipeline` (XSLT, ~21,000 lines) | C | Partially inspected | stylesheet sizes, `document()`/include use, output read through 3 real builds; vendor-exception discipline and the isolation fingerprint test read (`jss-cover-isolation` 6/6 run by G) | layout rules inside the stylesheets not re-read line by line; Naval types other than TM-1 not built by C |
| `backend/vendor/tools-linux` | F | Not inspected (listing only) | - | Linux/macOS story not audited; the product is Windows-first |
| `backend/schemas` | B | Partially inspected | PROVENANCE.md read; XSD validation exercised through the validator tests and a live round trip; no diff against official S1000D releases | content not compared with the standard |
| `backend/brex`, `reference`, `assets`, `templates`, `templates-optional` | B, C | Partially inspected | default BREX behaviour exercised by B (layering, severity, XPath 2.0 handling); templates read by C (found `Media/*.png` references that do not exist, PUB-005) | templates-optional and reference lists not read in full |
| `backend/samples` | C, F | Partially inspected | JSG sample route exercised by F (500 in a deep workspace, DEP-011); no content read | no JSG PDF was built successfully in any probe |
| `frontend/src/studio/core`, `validation` | B | Partially inspected | `core/document.ts`, `validation/xsd.ts`, `validation/brex.ts` read; ops/table/grammar read for shape; browser XSD/BREX parity reasoned from the parity suite | not every operation read line by line; Studio `verify` suites not run |
| `frontend/src/studio/ui`, `view` | B, E1, D | Partially inspected | `app.ts`, `editor.ts`, `storage.ts`, `validator.ts` read; behaviour driven in Edge by E1 and D (Ctrl+S capture handler, draft writes) | dialogs and panels read only as far as the findings; headless Chrome 158 crashes when a DM opens (QA-022) |
| `frontend/src/studio/export` | D | Partially inspected (bundle only) | build analysis found the duplicated pdfmake/Roboto chunks (FE-031) | export logic not audited |
| `frontend/src/studio/__tests__`, `styles` | G, E2 | Partially inspected | default frontend suite run by G (581 pass, 4 timeouts, 2 skip); CSS measured by E2 | `verify` suites not run |
| `frontend/src/jss`, `frontend/src/jsg` | C, E1, S, D | Partially inspected | `vitest src/jss src/jsg` 123/124 (one 5 s timeout) by C; all 25 `innerHTML` sinks of JSG checked by S (no problem); editors driven by E1 | JSG editor driven by code only in D's pass; large-document typing latency not measured |
| `frontend/public` | D | Partially inspected | sized: `public/schemas` (38 MB) duplicates `backend/schemas` (FE-032) | content not read |
| `frontend/dist` | D | Inspected (scratch build) | D built into a scratch directory and measured chunks (593 KB initial raw / 161 KB gzip) | repo `dist` itself not analysed |
| `packaging/assets`, `third-party`, ini template, `product.json` | F | Inspected | read | - |
| `scripts/signing`, `scripts/vm-acceptance` | F, G | Inspected (read in full) | not run: need a signing certificate / Hyper-V guest and install software | `Get-AuthenticodeSignature` appears nowhere in the scripts (QA) |
| `packaging/host`, `installer` | F | Inspected | read in full; compiled `AgastyaCtl.exe --doctor` run (exit 0); service/tray paths not executed | installer never executed by anyone |
| `frontend/test-results`, `verification-results` | G | Touched by the audit | G's test runs rewrote the git-ignored `verification-results/inventory.json` (previous content unrecoverable) and `publish-gate.json` (content identical) | no tracked file changed (`git status` at the end of the audit: only `docs/audit/` untracked) |

## B. What each agent covered (their own statements, condensed)

| Agent | Fully / mostly inspected | Partially | Not inspected | Headline NOT VERIFIED |
|---|---|---|---|---|
| **A** platform + DB | core/auth, core/collab, all listed routes and services, `vendor/engine` db/workspace/license, doctor/reset-admin scripts, admin/auth/settings/backup pages, 87 test names | assets, registry, zipio, packages, projectArchive (platform side), Workspace/Overview/Activity/Notifications/Cir/Graphics/Oversight pages | the real `workspace\` (forbidden by the brief) | ZIP64 above 4 GiB; two servers on one workspace; reverse proxy; which hash (Argon2 or scrypt) ran |
| **B** S1000D | validation, wellFormed, xsd-regex, brex, applicability, csdb*, release, review, lifecycle, publishGate, waivers, pm, projectArchive, importer scanner/apply/repair, S1000D routes, xmlGuard, Studio document/app/editor/storage/validator | sns/*, modelCode, objectRender/Templates, Studio ops/table/grammar | `vendor/pipeline` internals, `publisher.ts` (agent C), Studio unit/verify suites and Playwright | a dynamic XXE-exfiltration test was stopped by a safety classifier and not resubmitted; verdicts rest on code reading plus one benign xsltproc probe (S later reproduced XXE/SSRF live) |
| **C** JSS/JSG/publication | publisher.ts, vendor/engine build/fopd/paths/FopServer, publishGate, release, jss/service, ancillary, jsg engine+service, xengine convert/identity/project, jss/jsg/xengine routes, settings route | RWI, htmlPublish, XSLT pipelines, frontend editors, PublicationPage, JSG docx importers | jssdm internals, 17 Land and 9 Naval types beyond those built, JsgAncillaryPage | no JSG PDF built; parallel real builds and a FOP hang not provoked (F later simulated the hang) |
| **D** frontend shell | App, layouts, store, api client, all pages, studioSession, progress, previewBus, PdfPane/EditorSide, pdf viewer, vite/tailwind/tsconfig/package, `public/` sizing | PublishSettings, Import* dialogs, ProjectSettings/Release/Explore (read, not driven), api/importer/xengine/s1000d (skimmed) | - | no vitest/e2e by D; no throttled network, React Profiler, 5,000-DM or large-PDF test; JSG editor driven by code only |
| **E1** UX | auth screens, shell, Overview, Workspace, Projects, Graphics, CIR, Backup, Activity, Settings, wizard, project pages (S1000D/JSS/JSG), Studio, JSS and JSG editors; ~140 screenshots at 1366x768, 1920x1080, 820, 390 | Administrator (9 of ~20 sections), PDF pane, import/waiver dialogs (code only) | dark theme and contrast (E2), screen readers, real users, Chrome | no assistive technology; Studio context menu capture failed; large-document typing latency |
| **E2** design system | styles (platform, pdf, studio), ui.tsx, theme mechanics, JSG/JSS CSS, tailwind config; runtime sweep of 17 routes and 13 editor states in both themes; contrast computations | pdf viewer, Release page | login/setup, PreviewWindow, ReviewReader, PDF print output | no screen reader or Windows High Contrast; lint/Stylelint sketches not run; first-visit theme flash not captured |
| **F** deployment/offline | packaging scripts, installer, host, verify/VM scripts, signing, docs, `release/` listing and signatures, offline URL sweep, probe on 4058, hang simulation | auth/RBAC/editors (other areas), third-party binaries (versions and signatures only) | Windows versions other than Server 2025 | installer, VM harness, `verify-installer`, `verify-package-offline` never run; the probe host had a NIC, so "no traffic" is weak evidence |
| **G** QA | test inventory, CI/lint/hook absence, route-to-test map (282 routes), frontend default suite run, 18 backend files run, browser/layout probes | 14 tests read in depth, verify and VM scripts (structure), e2e specs (counted and mapped) | coverage percentages (no tooling) | the other 65 backend files, `test:verify` families, the repo's Playwright suite, installer and VM scripts |
| **H** performance | boot, publisher/gate/release, engine build/FOP/validators, validation/BREX, CSDB/PM/projects, auth/SQLite, main routes, backup/zip/export/import, WebSocket; measured: 18 endpoints, project and CSDB scaling to 1000 modules, large single modules, 11 builds, FO-stage scaling, archives and backup, a memory-leak probe, SQLite pragmas, CPU profiles | JSG, large JSS books, the frontend (agent D's part), CIR paths, `/api/admin/*` beyond list timing | clinic.js and 0x (no installs allowed), JFR (the bundled JRE has 6 modules, no `jdk.jfr`/`jcmd`), the packaged `runtime\node.exe`, Linux, HDD and LAN clients, concurrency above 3 publishes, boot with 1000 projects, a hung FOP (DEP-028 covers it) | the repository's own 500-module PDF baseline (73.2 s) could not be reproduced and the reason is unknown; the 500-module and "about an hour" figures are extrapolations; one 10 MB module gave a schema error whose cause is unexplained and BREX did not finish in 5 min 20 s; the host was shared and noisy (CPU times varied up to 2x: shapes and ratios are reliable, absolute times are not); builds are single samples; the repo's test suites and `perf-phase17.js` were not run (they use ephemeral ports) |
| **I** research/enterprise | auth core, authz, sessions, policy, rate limiter, release, review, waivers, backup, activity, notifications, `license.js`, app/context/config/index, installer script, OPERATIONS and SIGNING docs; 41 research sources | `AgastyaHost.cs` (service account, recovery, event log), `store.js` beyond line 900, frontend (grep only) | installer, server, browser, load tests were not run | competitor facts are vendor claims; RWS Contenta, Inmedius/Aptly, Astoria/Quanos S1000D support not verifiable; normative S1000D/ASD CSDB access-control text not obtainable |
| **J** mapper | `backend/src` top-level files, `frontend/src/App.tsx` and `main.tsx`, package configs | core/auth, core/collab, routes, services, importer, jss/jsg/xengine, vendor/engine, frontend pages/api/lib, studio app, e2e names, packaging, docs | `workspace\`, customer sample folders, `.git` history, `tools-linux` | all counts are lexical scripts; installer `[Code]` section; XSLT layout rules |
| **S** security/reliability | route-guard dump (283 routes), auth core, XML guard, zip readers, build pipeline, broadcast, packaging/installer scripts, `npm audit` (registry reachable: backend 0, frontend 8 with 7 moderate/1 low, one runtime `react-router` moderate) | bundled-binary CVEs (versions only, no citations pulled), installer ACLs (read, not run) | - | Argon2 vs scrypt in the packaged build (F later confirmed Argon2 loads); session/limiter persistence across restart (later closed by REL-006); interrupted-publish atomicity; SVG exploit in a real browser; Excel formula execution |

## C. Verification executed across the audit (repeatable)

| Who | What was run | Result |
|---|---|---|
| G | frontend `vitest` default suite (as `npm test` defines it) | 581 pass, 4 fail (5 s timeouts, pass alone), 2 skip |
| G | 18 of 83 backend test files, one at a time | 154 tests, 151 pass; failures: `publish-gate` cancelled at its 600 s limit, TypeErrors from missing `pdfimages`/`pdfinfo`; `jss-cover-isolation` 6/6, `jss-naval` 26/26, `jss-authoring` 12/13 |
| G | `tsc --noEmit` backend and frontend | clean |
| B | importer scanner/apply/repair tests | 41/41 |
| C | `xengine-convert` tests; `vitest src/jss src/jsg` | 7/7; 123/124 (one timeout) |
| I, J | `rbac`, `routes-guarded`, `zipio` | 8/8, 7/7, 5/5 |
| J | live router dump (compiled `dist`, no listen) | 276 unique routes, 0 unguarded `/api` routes |
| S | probes on a scratch instance (ports 4060-4061): XXE decoy, settings path trick, forged archive, SSRF via logo, xi:include, temp-password pre-hijack, limiter, WebSocket after disable, SVG, CSV, header dump, restart persistence | see `05-SECURITY-AND-RELIABILITY-AUDIT.md` verdict table |
| A | scratch probes p1-p10: schema (38 tables, 23 indexes, 11 FKs, 19 migrations, WAL, integrity ok), scale (65 ms to 1019 ms author dashboard at 10 to 60 projects), backup stall (240 MB: 15.8 s, 14.2 s health stall), recreate-same-name inheritance, self-approval, busy timeout | see `10-DATABASE-AND-DATA-STRATEGY.md` |
| F | offline probe (Node net/dns trap, TCP poll, proxy sinkhole) over S1000D, JSS and JSG publishes; FOP/Batik behind a sinkhole; FOP-hang simulation; `AgastyaCtl --doctor`; Authenticode; SHA-256 of Setup.exe | no outbound connection observed (weak evidence: NIC present); hang blocks all publishes; binaries NotSigned; checksum equal |
| D, E1, E2 | scratch frontend build + Edge/Playwright runs | chunk sizes, ~140 screenshots, theme sweeps, contrast tables |
| H | scratch server on ports 4062/4063 and scratch workspace (never 4040/4041, never `workspace\`); synthetic S1000D projects of 50-1000 modules, large single modules, 240 MB media payload, 157 MB package zip, 271-project dashboard with folders; event-loop delay probe; `xsltproc --profile`; CPU profiles | PERF-001..019 and benchmarks B1-B13 (04). Backup of 240 MB re-measured: 9.9 s with a 9.4 s stall and +323 MB, against agent A's 15.8 s and 14.2 s (different runs, noisy host; both agree on the defect). Agent A's dashboard slowness reproduced only when projects are filed in folders (3.2 s at 60 folders / 271 projects; 55 ms folder-less) |

Side effects of the audit on the repository: **none to tracked files** (`git status` shows only `docs/audit/` as new). G's runs regenerated two git-ignored result files (see section A). No port 4040/4041 and no `workspace\` access by any agent (each agent's own statement; the lead did not independently monitor ports).

## D. Open unknowns and areas the audit could not cover (consolidated)

1. **Installer, service and update behaviour were never executed** (F, G, I): behaviour is inferred from code and one doctor run. A clean-VM, no-NIC run is the first verification item of the roadmap (`14`, phase 7).
2. **Windows support matrix** (10/11, Server 2016-2025, ARM64), WebView2 on Server SKUs, and the real offline behaviour with the NIC disabled are NOT VERIFIED.
3. **No JSG PDF has been built successfully in any probe**; the 17 Land and 9 Naval types other than those built were not rendered; large-document typing latency (JSG 47,447 words loaded only) is unmeasured.
4. **Assistive technology and real users**: no screen reader, no High Contrast session, no usability test (E1, E2).
5. **Cause of the headless Chrome 158 tab crash** (reproduced on 2026-11-27; Edge runs the same tests green, see section E) when a data module opens (blocking `xmllint-wasm` removes it, D) is unknown; Edge is unaffected; the unresolved native crash in `docs/PDF21_CRASH_INVESTIGATION.md` may share a cause.
6. **Competitor and standards research** relies on vendor pages and secondary summaries for several items (I); normative S1000D/ASD CSDB access-control text was not obtainable.
7. **Customer stencils/documents** were used only for layout comparison and are not quoted; fidelity against them was not re-measured by this audit beyond the existing isolation test.
8. **Real workspace and its data volume**: the owner's `workspace\` was never opened, so scale figures come from synthetic scratch data only.
9. **Bundled-binary CVE applicability** (libxslt 1.1.28, FOP 2.10/Batik 1.18, Temurin 21.0.13.1, xmllint-wasm) was assessed by version only, not by exploitability in this product.
10. **Performance numbers (agent H):** measured on one shared Windows Server host on Node 22 (the repository's own figures were taken on Node 26); CPU-bound times varied up to 2x between runs, builds are single samples, data was synthetic (flat modules, one figure each), and the repository's 500-module baseline could not be reproduced (PERF-003). The packaged runtime, Linux, spinning disks, LAN clients, concurrency above 3 publishes, the JSG engine, large JSS books and boot with 1000 projects were not measured. The three P0 performance findings are VERIFIED as shapes (a stall, a ceiling, a super-quadratic curve); the figure "about an hour for 500 modules" is an extrapolation.
11. **Agents' status:** all twelve agents delivered a final report. Agent H's report arrived after the first version of this register had been merged, which is why its row is filled in here; no agent reported touching `workspace\`, port 4040 or 4041, or any tracked repository file.
12. Rows of the first register still marked "Listed only" (`backend/schemas` content, `frontend/public` content, `backend/samples` content) are exactly that.

## E. Addendum 16 (2026-11-27): what was added to the coverage

Written after the owner's scoped fix and the Phase 2 brief (`16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md`). The audit status stays **PARTIAL**.

| Area | Inspected | Verification done | Limits |
|---|---|---|---|
| JSS/JSG Explore and Publication pages, leave guard, Codes removal, deep link (`frontend/src/pages/project/Doc*Page.tsx`, `lib/docPublication.ts`, `lib/leaveGuard.tsx`, `main.tsx`, both editors, `components/DocCodes.tsx`, backend `services/xengine/identity.ts`) | Read in full by the lead who wrote them (not an independent review) | `tsc` both packages; 22 unit tests; backend identity tests 11/11; browser tests `doc-pages` 14, `jss-editor` 12, `jsg-editor` 11, `zz-responsive-layout` 18 on Chrome and on Edge | Not independently reviewed; GAP-003 to GAP-006 list what is unverified |
| Front-end hygiene (import graph, unused exports, CSS, dependencies, leftovers, colours, tooltips, dialogs, password fields) | `frontend/src` (158 source files, 32,285 lines), `frontend/e2e`, `backend/package.json` | Read-only scripts; the strongest candidates re-checked by hand; false positives recorded (report 16 section 6) | Text scans: generated class names, ambient declarations, vendored code and computed ids are invisible to them |
| Feature-preservation baseline (`baseline/`) | Routes, rail items, Studio command registry, test titles, test ids | Generated by script; the Studio commands written out literally (87); five generator sites not expanded | A run-time dump of the command registry and a registry for JSS/JSG keys are still to be made (WP-34) |
| Browser suite (133 tests) | All specs | Chrome stable, one clean full run: 70 passed, 5 failed, 58 did not run; Edge: 132 of 133 (platform 40 of 41, the other ten files 92 of 92) | Single runs; one stale test (`platform.spec.ts:488`); the order dependency and the Chrome crash are findings (GAP-007, UX-011) |
| Unit suite | `npm test` | 606 passed, 2 skipped, 1 timeout under load (passes alone) | Same flake class as the audit's four |

**Update to open unknown 5 (Chrome tab crash):** reproduced on 2026-11-27 in five places with Chrome stable on the audit host; **Edge ran the same 133 tests green except one stale assertion**, which confirms the audit's note that Edge is unaffected and makes Edge the practical reference browser for any regression baseline (decision D18). The cause on Chrome is still unknown.

**Addendum 17 (production architecture positions, 2026-11-27)** is a design proposal built from the evidence already in reports 03, 04, 09, 10, 12 and 13; nothing new was run or measured. Its seven findings (PRD-001 to PRD-007) are all RECOMMENDATION, and its production targets are assumed defaults, not customer facts (`17` section 2 and section 6).

Side effects of this addendum on the repository: the application files changed by the scoped fix (listed in `16` section 2.1), the new `docs/audit/16-*.md` and `docs/audit/baseline/`, regenerated `14`, small status notes under UX-001, UX-011, UX-013, FE-002 and FE-009, and the updated `README.md`, `15` and `docs/CROSS_ENGINE_ARCHITECTURE.md`. Test runs wrote only into git-ignored result folders. No port 4040/4041 and no `workspace\` access; two overlapping test runners were started by mistake early on, their output was discarded and the numbers above come from single runners.

**Conclusion on completeness.** Every top-level area and every second-level module is accounted for in the tables above. The audit is **broad and deep on code structure, security, data, deployment design and UX, and measured where it states numbers, but it is partial** in the areas listed in section D. It must not be read as a certification of the product.
