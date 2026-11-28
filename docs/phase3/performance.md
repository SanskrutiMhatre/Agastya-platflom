# Phase 7: performance for 100+ users on one server

Branch `perf/phase7`. Decisions P3-2 (100+ concurrent users on one server) and P3-3 (no rewrite: optimise in place, a native module
only for a measured hotspot that still misses its target) apply. Nothing here is a rewrite; no native module was needed. No migration.
No feature, route, permission or audit record was removed or changed in meaning; the PDF bytes of every build are those of the engine
as before (wp30-pdf-regression 10/10 against the unchanged baselines, which were not re-taken).

Measured on the baseline host (i7-6820HQ x 8, 48 GB, Windows Server 2025, Node 22.23) with `backend/scripts/bench/phase3-baseline.js`
(the real server, worker-mode jobs, warm FOP in the workers) and `frontend/scripts/perf/phase3-frontend.mjs` (Edge). "Before" is the
bench run on `main` (069d507) on the same day, same host; this host varies up to 2x between runs (audit 04 section 6.4), so only large
differences are claimed.

Raw reports (this host, 2026-11-28): before = the bench on `main`; after = the full bench on this branch, with the PDF section
re-run after the last build-cache fix (front-matter pages copied from the engine). Note: the PDF sizes differ between the two columns
because the "before" run had no Arial installed in this checkout (git-ignored, licensed; Liberation Sans was used); the after run has
it, as a real installation does. Same engine, same baselines.

## Before and after

### API at 1,000 modules (ms; seq = one at a time, conc = 10 at once; loop = longest event-loop stall in that part)

| Endpoint | seq median before / after | seq p95 before / after | 10-conc p95 before / after | loop max before / after | target |
|---|---|---|---|---|---|
| overview | 72 / 6.3 | 117 / 7.2 | 711 / 63 | 689 / 67 | seq 100, conc 200, loop 100: **met** |
| summary | 66 / 6.7 | 93 / 7.8 | 768 / 65 | 811 / 70 | **met** |
| release | 49 / 2.0 | 64 / 2.3 | 677 / 17 | 729 / 18 | **met** |
| dms (795 KB) | 46 / 4.8 | 85 / 12.5 | 608 / 100 | 533 / 51 | **met** |
| explore | 43 / 6.5 | 60 / 11.3 | 418 / 67 | 381 / 78 | **met** |
| pmc | 72 / 7.9 | 85 / 11.9 | 1004 / 58 | 985 / 68 | **met** |
| save | 34 / 18.6 | 52 / 20.3 | 264 / 107 | 173 / 116 | seq met; conc 100 not quite |
| create | 172 / 55 | 343 / 86 | 1020 / 572 | 1095 / 518 | not met (see request 5) |

Small project (3 modules): every read stays 2-5 ms; create 10 at once 403 -> 239 ms p95, loop 395 -> 222 ms.

### Import, validation, PDF

| What | before | after | target |
|---|---|---|---|
| Package import, 1,000 modules | 15.2 s, loop stall 8.3 s | 12.4 s, loop p99 61 ms (max 222 ms, which the histogram shares with the creates before it) | 10 s; stall 100 ms: stall nearly met, time not |
| Validation, 200 modules, cold (first of the server) | 7.7 s | 5.6 s | 5 s |
| Validation, warm fresh run | 1.4-2.2 s | 0.79-0.90 s | 1 s: **met** |
| Validation, unchanged content | 1.27 s | 0.016 s | 0.5 s: **met** |
| Validation, after one edit | 1.38 s | 1.39 s | 0.5 s: not met (BREX re-runs over all modules; only the schema half is per module) |
| S1000D sample PDF, unchanged rebuild | 2.48 s | 0.02 s | 0.1 s: **met** |
| S1000D sample PDF, real rebuild (warm): gate | 0.90 s | 0.15 s | 0.3 s: **met** |
| S1000D sample PDF, first build of the server | 7.8 s | 7.7 s (6.6 s in another run) | 5 s (JVM start; pre-warm helps when the build comes later than 1.5 s after start) |
| JSS Land sample, real rebuild | 1.7 s | 3.2 s (2.1-2.9 s in other runs) | 2 s; FOP time, noise of this host |
| JSG handbook, unchanged rebuild | 5.6 s | 0.015 s | - |
| JSG handbook, real rebuild | 5.6 s | 5.6 s (two FOP passes) | 4 s: not met (see section 6) |
| 100-module publication, first build | 10.1 s | 7.6 s | met |
| 100-module publication, real rebuild: gate | 1.5 s | 0.72 s | 1 s: **met** |
| 100-module publication, unchanged rebuild | 6.7 s | 0.02 s | - |
| Server RSS after the 1,000-module API set | 204 MB | 204 MB | 250 MB: met |
| FOP JVM working set at the end | 603 MB | 631 MB | 900 MB: met |
| Server boot to /api/health | 2.6 s | 1.8 s | 2 s: met |

### Frontend (Edge, new profile)

| What | before (phase 3 baseline) | after | target |
|---|---|---|---|
| Studio chunk (EditorPage) | 878 KB raw / 277 KB gzip | 454 KB / 138 KB (+ codemirror 424 KB / 139 KB, cacheable across releases) | 300 KB gzip: met |
| Initial load (index.html) | 148 KB gzip | 146 KB gzip | 180 KB: met |
| Studio ready / JSS ready / JSG ready | 986 / 889 / 1,025 ms | 1,025 / 643 / 1,023 ms | 1,000 ms: about the same (this host's noise) |
| JSG opening longest task | 354-416 ms | 246 ms | 200 ms: not met (canvas, request 4) |
| Quick preview, first of a session (Studio / JSS / JSG) | 7.4 / 5.5 / 10.0 s | 5.4 / 3.5 / 10.0 s | 3 / 3 / 5 s; a repeated preview of unchanged content is answered from the build cache |
| Typing, worst keystroke (Studio / JSS / JSG) | 32 / 40 / 32 ms | 32 / 48 / 24 ms | 50 ms: met |

## The changes, hotspot by hotspot

### 1. Project reads at 1,000 modules (overview, summary, release, dms, explore, pmc)

**Hotspot.** Every project read listed the CSDB folder and opened every module's head (1,000 `open` + `read` per request), cloned the
parsed publication module (`structuredClone` of 1,000 entries) and recomputed the release fingerprint. Ten at once serialised on the
event loop: 600-1,000 ms p95 and as long a stall.

**Change.**
* `services/csdbIndex.ts`: the module listing is kept per CSDB folder. It is trusted while the folder's modification time is unchanged
  (a module added, removed or renamed by hand changes it) and re-checked file by file after `AGASTYA_CSDB_LIST_TTL_MS` (default 5 s; an
  edit made in place by hand, outside the platform, does not change the folder). An unchanged file keeps its summary object. Every write
  the platform makes (create, save, delete, import) updates the one entry from the text it has just written, so a freshly written file is
  never opened again (on Windows that open waits for the virus scanner). Summaries are frozen and shared. `listingToken(projectId)`
  changes with every change of the listing, for answers derived from it.
* `services/pm.ts`: the kept parse of `publication.xml` is deep-frozen and shared (no clone per read); a caller that changes it gets an
  error, not a silently changed cache. `writePm` primes the memo with the read-back it already makes (and, when the header was completed
  after serialising, with a parse of the header alone), so the next create does not parse the whole publication again. `GET /pmc`'s hash
  is kept per file version.
* `services/release.ts`: the display fingerprint (what the dashboard shows) is kept per project while the listing token, the PM file, the
  front-matter folders and `project.json` are unchanged. The decision fingerprint (release approval, the build) is still computed from
  disk every time.
* `services/projectRecord.ts`: the text of `project.json` is kept per file version and parsed per call (a caller may change its copy).
* `GET /dms`: the JSON answer is kept per project for the same listing token, lock set and query (stringifying the 795 KB list was most
  of the route's time).

**Files.** `backend/src/services/{csdbIndex,csdb,pm,release,projectRecord}.ts`, `backend/src/routes/project-content.ts`.

**Risks.** A module edited in place by hand outside the platform shows its new title after at most 5 s (configurable; 0 = re-check
every request). Frozen shared objects: a caller that mutated a returned model would now throw (none does; the targeted tests cover the
callers).

### 2. Package import off the request path

**Hotspot.** The 1,000-module import ran 15 s in one synchronous stretch: an 8.3 s event-loop stall, during which nobody else was served.

**Change.** `services/packages.ts`: the import yields to the event loop every 15 ms (`setImmediate`), runs one at a time per project,
reads each staged file once (hash and text from the same bytes), skips the second content check of a module it has just validated
(`createDm(..., { contentChecked: true })`), and reports progress over the project's WebSocket at most every 500 ms.

**Not done, and why.** The import still runs in the server process, not in a job worker: it takes document locks and writes revisions,
and the locks live in the server process (see "Requests for the lead"). One fsync per file remains (atomicWrite.ts is off-limits).

### 3. Statement timing (WP-28 Proxy) and Server-Timing

**Change.** `services/metrics.ts`: the statement-timing Proxy is replaced by own-property wrappers of `run`, `get` and `all`, defined once
per prepared statement. `Server-Timing` carries `total` for everyone and the database detail (`db;dur;desc="n statements"`) only for
administrators (`AGASTYA_SERVER_TIMING=admin`, the default; `full` = everyone, as the bench measures; `off` = no header).

**Test change (intended).** `test/phase3-perf.test.js` asserts that an author sees no `db` part and an administrator does.

### 4. Validation and the publish gate

**Hotspot.** Every validation ran xmllint over every module (1.3-2.2 s for 200 modules even with nothing changed: the run cache of WP-14
only helped when the options were the same as last time); the publish gate validated every module again (0.9 s for the sample, 1.5 s for
100 modules).

**Change.** `services/validation.ts`: each module's schema verdict is kept by the SHA-256 of its bytes, together with the program build
and the S1000D issue it was checked against, in memory (8,000 entries) and on disk under `<workspace>/.agastya-cache/validation-xsd/`
(written as a temporary file and renamed, no fsync: a lost entry is only a cache miss; entries older than 30 days are pruned once per
process). A verdict whose check could not run is never kept. The run replaced by a new run is kept as `.validation.prev.json`, so
switching between two option sets (BREX on and off; the package export's BREX-less run) answers from it when its input fingerprint still
holds. The cache folder is left out of platform backups, the kept run out of project archives and job fingerprints.

**Files.** `backend/src/services/validation.ts`, `services/jobs/{kinds,fingerprint}.ts`, `services/platformBackup.ts`,
`services/projectArchive.ts`.

**Not done, and why.** A warm xmllint worker pool (item 3 of the brief): xmllint-wasm starts a worker thread and compiles the module for
every call and keeps no state between calls; a persistent wrapper needs its own worker around the package's internals. With the verdict
cache the pool would only speed up modules whose bytes changed, and that work already runs off the event loop. Deferred; the create path
is bounded by the publication rewrite (below), not by the validator.

### 5. Build cache: unchanged = up to date (PERF-012)

**Change.** `services/buildCache.ts` computes the input key of a build: the content hash (kept per file version) of every file of the
project folder except the build's own outputs and intermediates; the front-matter pages the build generates from Settings while they
still equal the stamp the build wrote (`_frontmatter-generated.json`), or the shipped page the build copies in when it is missing
(an edited page counts as content); the house templates; the program
build; the FOP heap; the database rows a build reads (configuration, extensions, lifecycle, CIR links, data-module types, security
classes, the registry row without its times); the waivers (with their expiry) and the release rows; the build's options; the calendar
day. The full build (`publisher.buildPublication`), the one-module preview, the JSS/JSG Quick preview and the JSG build compare it with
the key the last build of the same kind recorded, and with the PDF's file signature (size, times, file id): when both are unchanged the
answer is the PDF already on disk, its notes repeated, `upToDate: true` in `POST /publish`. The key recorded is the one taken BEFORE the
build ran (a change made while it ran is a change next time), except that differences consisting only of front-matter pages the build
itself regenerated are accepted. The administrator's "rebuild every PDF" forces a build.

**Why the output is identical.** A cache hit returns the previous file unchanged; a miss runs the same engine as before.

**Files.** `backend/src/services/{buildCache,publisher}.ts`, `services/jsg/engine.ts`, `services/jobs/kinds.ts`, `routes/admin.ts`,
`routes/project-content.ts`.

**Risks.** An input the key does not know about would serve a stale PDF. Everything a build reads was traced (project folder,
`templates/`, the bundled engine, schemas and assets (covered by the program build), and the database rows listed); a new input added
to the build later must be added to the key. "Partial FO reuse" (re-rendering only changed modules) was not attempted: FOP lays out the
whole book (page numbers, cross references), so a partial FO is not byte-identical.

### 6. FOP and the JVM

**Change.** One job worker and its FOP JVM are started 1.5 s after the server listens (`AGASTYA_PREWARM`, default on), off the request
path, and the renderer's warm-up render runs in it; the first build or preview after a start no longer pays the cold JVM. It is an
ordinary idle worker afterwards: preferred for builds, ended after `AGASTYA_WORKER_IDLE_MINUTES` (default 10) like any other, which
releases the JVM's memory (the existing idle release). The heap cap stays 1,536 MB (`AGASTYA_FOP_HEAP_MB`; the JVM peaked at about
600 MB working set in the bench).

**Not done, and why.** The JSG handbook's second FOP pass (the certificate prints the page count): a single pass needs
`fo:page-number-citation-last` in `schemas/jsg/engine/jsg.xsl`, which changes the PDF bytes and would require new PDF baselines; the
build cache removes the repeated cost of an unchanged handbook.

### 7. Frontend

**Change.** `frontend/vite.config.ts`: CodeMirror and Lezer are a chunk of their own (`codemirror`). The Studio chunk (EditorPage) goes
from 878 KB to 454 KB raw (277 to 138 KB gzip); the editor route loads both in parallel; the CodeMirror chunk does not change between
product releases, so it stays cached across updates. The initial load is unchanged (146.6 KB gzip, budget 180 KB). Quick preview: an
unchanged document is answered from the build cache (above).

**Not done, and why.**
* The JSG editor's opening long task (354-416 ms) is the editor canvas building the document (`frontend/src/jsg`), which this phase may
  not edit; see "Requests for the lead".
* Unused dependencies: none of the runtime dependencies of either package is unused (the lint's own check agrees). `tailwindcss` in the
  frontend's devDependencies is unused (postcss.config.js no longer runs it, audit DS-008) but removing it needs `npm uninstall` to
  rewrite the lock file correctly (its own dependencies), and this phase runs no npm install; listed for the lead.

## Requests for the lead (changes in areas this phase may not edit)

1. **`backend/src/storage/atomicWrite.ts`: one fsync per batch.** The 1,000-module import does about 1,000 file fsyncs plus as many
   directory operations (about 5 s of the 12 s). A `writeFilesAtomic(files[])` that writes every temporary file, fsyncs each, renames all
   and fsyncs each parent directory once would keep the crash guarantee (a file is either the old or the new version) at one directory
   fsync per folder instead of one per file. The import (`packages.ts` apply loop) would call it once per batch of 50.
2. **Document index, `deleteDm`.** Deleting one module calls `syncProject` (a full walk of the project folder); a per-file removal would do.
3. **Import fully off the request thread.** Needs document locks and revision writes usable from a job worker process (they live in the
   server process today). With that, `kind: 'import'` could run in the job runner like a build.
4. **JSG editor opening long task.** In `frontend/src/jsg` (the canvas): building the 104-page handbook's DOM in one task. Rendering the
   sections in idle slices (or virtualising pages off screen) would bring the 354-416 ms below 200 ms.
5. **Create at 1,000 modules (loop stall about 800 ms for 10 creates at once).** Each create rewrites the whole 271 KB publication module
   (serialise, read back, check, fsync): about 70 ms of synchronous work. An append of one entry into the existing text (with the same
   read-back check) would make it constant-time; it is in `services/pm.ts` + the vendored `engine/pmc.js` serialiser, a fidelity-sensitive
   change worth its own review.
6. **Frontend devDependency `tailwindcss`**: `npm --prefix frontend uninstall -D tailwindcss` (unused since DS-008).

## Checks owed

* The full gate (`npm run gate`) and the browser suites: this phase ran only the targeted tests below, by the brief.
* A run on the reference VM (Mode B, many real users): the bench simulates 10 concurrent requests.
* The bench numbers on a quiet machine: this host varies up to 2x.

## Tests run (targeted, by the brief; each file alone, throwaway workspace)

New: `backend/test/phase7-perf.test.js` (gate stage pdfSmoke): the listing after create, save, delete, a file added by hand and an
in-place edit after the TTL equals a fresh scan; `GET /dms` after a save and a lock; the kept PM model equals a fresh parse and is
frozen; display fingerprint = decision fingerprint; kept schema verdicts = verdicts with the cache emptied; the previous run answers a
switch of options and is stale after an edit; an unchanged rebuild is the same PDF file, a change of content or option builds again, a
PDF changed by hand is rebuilt, an unchanged module preview is not rendered again.

Passed: phase7-perf 5/5, phase3-perf 3/3, wp17-perf 9/9, packages 10/10, api 17/17, wp14-jobs 9/9, wp14-job-limits 1/1,
wp16-validation-framework 6/6, wp22-problems 5/5, wp17-brex-fast 5/5, brex-gate 3/3, publish-gate 24/24, publish-waivers 2/2,
editor-quick-preview 3/3, release-issue 1/1, wp15-jsg-release 4/4, publisher-logo 2/2, project-archive 5/5, wp32-validator-crash 1/1,
wp32-validation-scale 8/8, wp32-event-loop 1/1, wp12-backup-restore 7/7, html-publish 6/6, applic-publish 12/12, jsg-engine 7/7,
wp30-pdf-regression 10/10 (unchanged baselines, raster comparison included), uploads-config 4/4; guards: authz-matrix 6/6,
wp29-audit-coverage 2/2, wp11-integrity 16/16, wp10-seams 11/11, routes-guarded 1/1; step 1 also pm-multi-ref, pm-multiref, csdb-objects,
import, importer-http. `scripts/ci/perf-budgets.test.mjs` 3/3. Backend and frontend `tsc`, `npm run lint` (any ratchet at the
baseline), `check-bundle` PASS.

## Settings added (all optional)

| Variable | Default | Meaning |
|---|---|---|
| `AGASTYA_SERVER_TIMING` | `admin` | `admin`: database detail in Server-Timing for administrators only; `full`: for everyone; `off`: no header |
| `AGASTYA_CSDB_LIST_TTL_MS` | `5000` | how long a kept module listing is trusted for a hand edit in place (0 = re-check every request) |
| `AGASTYA_PREWARM` | on | start one job worker and its FOP JVM at server start |

`docs/phase3/perf-budgets.json`: each budget carries its phase 7 value (`phase7`); for every backend target met, `max` was lowered to the
larger of the target and 1.5 x the new value; the five build budgets whose meaning the build cache changed (gate, FO, JSS and JSG warm
builds) now read the bench's `rebuilt` run (a real build in the warm worker).
