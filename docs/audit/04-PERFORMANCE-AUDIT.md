# 04 - Performance, scalability and document-processing audit (backend, database, engines)

**Author:** audit agent H (finding prefix PERF) · **Date:** 2026-11-26 · **Status:** audit only, no repository file changed.

**Scope and method.** Backend request paths, the SQLite layer, the publishing engine (validation, BREX, xsltproc, FOP) and the project archive / backup paths of `Agastya-platform-v2`. Static review of the code (about 60 files, listed in the coverage table) was followed by measurements on a **scratch server** (port 4062, scratch workspace, measurement hooks on 4063; never 4040/4041, never `workspace\`). Every number below was measured by me on this machine unless it is labelled otherwise; a number that comes from another agent or from a repo document is cited as such. At most 12 PDF renders were made (11 server publishes in `m4`, plus one direct cold `java` FOP run); the FO-stage scaling runs (`m12*`) are `xsltproc` only and produce no PDF. The scratch server and all processes I started have been stopped.

**Reading guide.** Section 1 = environment and method (read the caveats first). Section 2 = coverage. Section 3 = measured results. Section 4 = findings PERF-001 to PERF-019 (P0 first). Section 5 = strengths. Sections 6-11 = benchmark suite, profiling plan, proposed targets, recommendations by theme, cross-cutting leads, unknowns and limitations. Section 12 = frontend performance (platform shell, agent D, findings FE-027 to FE-033).

---

## 1. Environment and methodology

### 1.1 Machine, runtime, tools (all VERIFIED on this host)

| Item | Value |
|---|---|
| CPU / RAM | Intel Core i7-6820HQ, 4 cores / 8 threads, 47.8 GiB |
| OS / disk | Windows Server 2025 Datacenter Evaluation 10.0.26100; Samsung 860 EVO SSD, NTFS |
| **Node used for every measurement** | **v22.23.2** (`C:\Users\Admin\Desktop\_tools\node-v22.23.2-win-x64\node.exe`; I read the path of the running scratch server process, PID 14600 / 16552, from the OS, not from my shell) |
| Engine tools bundled in the repo | JRE Temurin 21.0.13.1 (`vendor/tools/jre`), FOP 2.10, **xsltproc libxslt 1.1.28 win32-x86** (`vendor/tools/libxslt-1.1.28-win32-x86`; `xsltproc --version`: libxml 20903 / libxslt 10128), xmllint-wasm 5.3.0; **no Ghostscript** (`vendor/tools/ghostscript` does not exist) |
| Load on the machine | Shared with about 12 other audit agents. System CPU was about 49% before I started, sampler medians of 45-100% during builds and 3% at the end. CPU-bound numbers therefore carry noise; I saw up to about 2x run-to-run difference for the same CPU-bound call (BREX of one 100 KB module: 3.0 s and 1.6 s; validation of 200 modules: 5.9 s and 3.4 s). Ratios and shapes are reliable, absolute CPU times are not. |

**Node version versus the repository's own baseline (lead request from agent I).** The only baseline in the repo, `docs/S1000D_COMPLIANCE_MATRIX.md:96-113` ("Machine: 8 CPUs, Node 26.13, quiet", `backend/scripts/perf-phase17.js 500 1000`), was reportedly taken on Node 26.13. The operating system of that run is not stated; the same document's test notes (lines 90-95) record Linux images (Alpine 3.24 / Debian, libxml 2.13.9 or 2.9.14), so a Linux run is likely but NOT VERIFIED. **My runs used Node v22.23.2 on Windows**, which is the version the lead says the packaged `runtime\node.exe` carries (I did not run that binary; NOT VERIFIED by me). So the two sets differ in Node major version, OS, xsltproc build (bundled libxslt 1.1.28 32-bit here), CPU and background load. Where I could compare like with like I did (section 3.7): the baseline's "PDF of the 500-module publication in 73.2 s" is **not reproducible in kind** on this host (PERF-003). I did not run `perf-phase17.js` itself, because its `boot()` listens on an ephemeral port outside my allowed range (4062/4063).

### 1.2 Method, and the measurement artefacts I found and removed

* **Latency** is measured with raw `node:http` and a keep-alive agent. A first run with Node's `fetch` showed every latency quantised to about 15.6 ms (the Windows timer tick); that run is kept as `m1_api_latency_FETCH_ARTIFACT.json` in my scratch folder as evidence and is **not used**. Sequential runs are N=100 (N=30/20 where stated); concurrent runs are 100 requests over 10 clients.
* **Event-loop delay (ELD)** is read from an in-process `perf_hooks.monitorEventLoopDelay` histogram (resolution 5 ms) exposed by a measurement preload (`--require preload.js`, main thread only; it reads memory, forces GC on request and can start/stop an inspector CPU profile). **Floor:** on this host an idle server shows ELD mean about 14 ms and p50 about 15.7 ms (Windows timer tick), so ELD values below about 20 ms are noise. "ELD max" is the longest single time the thread did not return to the event loop during the measured window.
* **Health probe**: a second keep-alive connection polls `/api/health` every 20-50 ms during heavy calls. Note: in the 1000-module gate run (`m13`) the probe reported a 670 ms maximum while ELD reported 81 s. The probe's keep-alive socket was probably reset by the server's 65 s keep-alive timeout during the 81 s stall (OBSERVED, not confirmed); in every other run the two agree (for example 11.17 s ELD and 11.14 s probe for the 100-module build). Where they disagree I quote ELD.
* **Memory**: Node RSS from `process.memoryUsage` after forced GC, peak from `resourceUsage().maxRSS`, child processes (java, xsltproc) from a PowerShell sampler reading `Win32_Process.PeakWorkingSetSize` every 100-250 ms. Windows working sets shrink when idle (RSS fell from 650 MB to 160 MB between tests with no restart), so "RSS after" is only comparable within one run.
* **Builds are single samples** (budget of about 12 renders). They show shape and order of magnitude, not distributions. Everything else has N >= 10 unless stated.
* **Synthetic data** (generated by my scripts, never customer material): description data modules cloned from the repo's own sample project (8.9 KB each, one titled figure each, unique codes), optionally padded with `levelledPara` blocks to a target size; clones of the repo's e2e fixture (`frontend/e2e/fixtures/dm21/5-0`, 4.2 KB, one titled figure) for the baseline cross-check. Synthetic data repeat `id` values across modules (legal in S1000D, ids are unique only within a module); an experiment with ids made unique (section 3.7) shows this is not the cause of the main slowdown.

### 1.3 Scratch workspace state at the end of the run (for scale context)

About 282 project folders, 308 MB of projects (of which 240 MB is one deliberate media payload), `publisher.db` 39.5 MB plus a 13.9 MB WAL; tables: `audit_log` 2,492 rows, `revisions` 1,711, `blobs` 1,304 (34.1 MB of content), `documents` 5,080, `notifications` 262, `sessions` 28. Server boot to first healthy response: **1.34-1.39 s**, with 3 projects and again with about 280 projects (VERIFIED; `reconcileRegistry` does not scale visibly at this size).

---

## 2. Coverage

| Area / path | Status | Verification done | Limits |
|---|---|---|---|
| `backend/src/index.ts`, `app.ts`, `context.ts`, `config.ts` (boot, middleware, limits) | Inspected | code + boot timing | - |
| `services/publisher.ts`, `publishGate.ts`, `release.ts` (build chain, gate, fingerprint) | Inspected | code, 11 builds, CPU profile | builds are single samples |
| `vendor/engine/build.js`, `fopd.js`, `fontconf.js`, `paths.js`, `fopserver/FopServer.java` | Inspected | code, timing, MaxListeners warning observed, cold `java` run | no hang test (see DEP-028) |
| `vendor/engine/validateXml.js`, `validateSchema.js`, `xmllint-wasm` | Inspected | code, 5 scaling series, breaking point found | wasm internals not read |
| `services/validation.ts`, `brex.ts`, `applicability.ts` | Inspected | code, CPU profiles, 3 scaling series | BREX rule engine only profiled, not rewritten |
| `services/csdb.ts`, `pm.ts`, `projects.ts`, `core/collab/docindex.js`, `revisions.js` | Inspected | code, CPU profiles, scaling to 1000 modules | - |
| `core/auth/store.js`, `sessions.js`, `authz.js`, `crypto.js`, `vendor/engine/db.js` | Inspected | code, pragma and write-cost benchmark on a scratch DB, password-hash timing | no query plan review of every statement |
| `routes/project-content.ts`, `workspace.ts`, `team.ts`, `jss.ts`, `importer.ts`, `xengine.ts`, `packages.ts` | Inspected | code + request timing | JSG routes only read |
| `services/backup.ts`, `zip.ts`, `zipio.ts`, `projectArchive.ts`, `uploads.ts` | Inspected | code, backup/export/import timing, 240 MB payload | ZIP64 above 4 GiB not run |
| `services/broadcast.ts` (WebSocket) | Inspected | code, 100-subscriber build | no 1000-socket test |
| `services/jss/service.ts`, JSS build path | Partially | 2 UHB builds, JSS GET/PUT/validate timing | only the UHB seed document, no large JSS book |
| JSG engine (`services/jsg/*`) | Not inspected | - | out of this audit's measured scope |
| Frontend polling and rendering | Not inspected | - | agent D's section is spliced at the end |
| `docs/S1000D_COMPLIANCE_MATRIX.md` baseline | Read | compared (section 1.1, PERF-003) | baseline script not run (port rule) |
| Real `workspace\` and ports 4040/4041 | Not touched | by brief | all numbers are from scratch data |
| Linux / macOS behaviour, a non-SSD disk, a LAN client | Not inspected | - | NOT VERIFIED; Windows spawn and timer costs differ |

---

## 3. Measured results

All times are milliseconds unless a unit is shown. "seq" = sequential, "c10" = 10 concurrent clients. Evidence label for the whole section: **VERIFIED** (measured by me) except where a row says otherwise.

### 3.1 API latency on a small workspace (3 projects, 3 modules; N=100 per cell)

| Endpoint | bytes | seq median | seq p95 | c10 median | c10 p95 | c10 req/s |
|---|---:|---:|---:|---:|---:|---:|
| `GET /api/health` | 67 | 1.08 | 1.26 | 7.9 | 14.4 | 1035 |
| `GET /api/auth/me` | 325 | 1.27 | 1.56 | 10.0 | 25.6 | 781 |
| `GET /api/notifications/unread-count` | 12 | 1.32 | 1.62 | 9.5 | 32.3 | 752 |
| `GET /api/projects` (3 projects) | 1,672 | 3.14 | 3.66 | 30.4 | 52.3 | 300 |
| `GET /api/overview` | 2,646 | 6.40 | 7.57 | 70.8 | 90.6 | 134 |
| `GET /api/workspace` | 1,686 | 4.91 | 5.84 | 69.7 | 163.5 | 126 |
| `GET /projects/:id` | 573 | 2.20 | 2.52 | 26.3 | 48.9 | 335 |
| `GET /projects/:id/summary` | 895 | 13.16 | 14.97 | 152.8 | 243.3 | 61 |
| `GET /projects/:id/dms` (3 modules) | 2,309 | 3.23 | 3.70 | 37.1 | 79.2 | 236 |
| `GET /projects/:id/dms/:file` (9.6 KB) | 9,636 | 2.22 | 2.73 | 23.4 | 46.8 | 370 |
| `GET /projects/:id/explore` | 1,452 | 3.93 | 4.90 | 45.3 | 76.3 | 207 |
| `GET /projects/:id/pmc` | 1,968 | 3.99 | 4.49 | 36.6 | 55.1 | 256 |
| `GET /projects/:id/settings` | 6,614 | 2.40 | 2.68 | 21.3 | 44.2 | 410 |
| `GET /projects/:id/validation` (last run) | 80 | 2.11 | 2.33 | 21.9 | 79.0 | 315 |
| `GET /projects/:id/release` | 354 | 18.71 | 21.18 | 270.3 | 446.4 | 36 |
| `GET /projects/:id/media` | 97 | 2.13 | 2.55 | 21.9 | 67.4 | 338 |
| `GET /projects/:id/publish/status` | 149 | 1.22 | 1.47 | 10.2 | 31.0 | 730 |
| `GET /api/formats` | 4,126 | 1.05 | 1.23 | 9.5 | 39.6 | 632 |

Writes on the same workspace: `POST /projects` sample project 199 ms, JSS UHB project 97 ms, empty S1000D project 71 ms; `PUT /dms/:file` (50 saves) median 38 ms, p95 71 ms.

**Reading.** On a small workspace every read is cheap (1-19 ms). With 10 clients the median is about **10x the sequential median for every endpoint** (`/summary` 13.2 to 152.8 ms, `/release` 18.7 to 270 ms), which is the signature of one thread serving everything: concurrency adds latency, never throughput. Throughput is about 1000 req/s for trivial calls and 36-61 req/s for `/release` and `/summary` even on 3 modules.

### 3.2 Project count (author who created the projects; N=30 sequential, 100 at c10)

| | 3 projects | 50 | 200 |
|---|---:|---:|---:|
| `GET /api/projects` seq median (bytes) | 3.3 (1.7 KB) | 24.6 (26.8 KB) | 95.8 (107 KB) |
| `GET /api/projects` c10 median | 28.9 | 266 | 819 |
| `GET /api/overview` seq median | 6.9 | 57.9 | 167.1 |
| `GET /api/overview` c10 median (req/s) | 67 (145) | 622 (16) | 2,325 (4) |
| `GET /api/workspace` seq median | 4.9 | 39.8 | 120.1 |
| `GET /api/workspace` c10 median (req/s) | 48 (203) | 562 (16) | 1,536 (6) |
| `GET /api/projects` administrator seq median | 3.0 | 26.1 | 113.6 |
| `GET /api/admin/projects` seq median | 1.6 | 12.6 | 40.8 |
| `POST /projects` median (first 50 / last 50 of 200 created) | 84 | | 124 |

Growth is linear in the number of projects (about 0.5 ms per project per list call) and **no list is paginated**: 107 KB per `/api/projects` call at 200 projects. The dashboard pair `/api/overview` + `/api/workspace` costs about 290 ms of thread time at 200 projects. The shell polls the unread count every 30 s (`frontend/src/layouts/AppShell.tsx:45`), which costs 1.3 ms and is not an issue.

### 3.3 Member-only users and folders (cross-check of agent A, PLT-008)

Agent A reported (probe `p3`, `docs/audit/10-DATABASE-AND-DATA-STRATEGY.md` PLT-008): for a member-only author `/api/workspace` 65 ms (10 projects), 360 ms (30), 1019 ms (60); `/api/overview` 54, 382, 1397 ms; a folder-owner stays at 23-64 ms. I re-measured with my own method in two shapes (N=30 sequential):

| Shape (my method) | members / folders | member-only `/api/workspace` | member-only `/api/overview` | creator `/api/workspace` |
|---|---:|---:|---:|---:|
| **No folders**, member of the first K of 211 projects (`m10`) | 10 | 44.5 | 49.4 | 95.6 |
| | 30 | 47.6 | 59.4 | 94.9 |
| | 60 | 54.8 | 74.2 | 91.5 |
| | 100 / 200 | 68.1 / 101.8 | 92.5 / 147.8 | 91.7 / 92.8 |
| **Each project in its own folder** (A's shape), 271 projects on the platform (`m10b`) | 10 | **512.7** | **562.4** | 96.9 |
| | 30 | **1,446.8** | **1,499.3** | 109.0 |
| | 60 | **3,195.2** | **3,275.2** | 121.6 |

**Difference from A, explained.** My first cross-check (no folders) did **not** reproduce A's slowness: member-only cost stays at 45-102 ms. A's slowness appears only when projects are filed in folders. With A's shape I reproduce it and it is worse in absolute terms (3.2 s at 60 folders against A's 1.0 s) because my workspace holds 271 projects against about 60 in A's probe. The cost per folder is 53 ms here (3,195 / 60) and 17 ms in A's run: the ratio of the platform sizes (271/60 = 4.5) explains most of the 3.1x difference in per-folder cost. Cause (code): `folderVisibleTo` (`services/projects.ts:374-380`) calls `store.listProjectsForUser` and `workspace.listProjects(workspaceDir)` (a disk scan of **every project on the platform**) once per folder, for any caller who is neither administrator, folder manager nor grantee. See PERF-007.

### 3.4 Growth of one project's CSDB (synthetic modules, 8.9 KB each; N=10 per cell)

| Modules in the project | 50 | 200 | 500 | 1000 |
|---|---:|---:|---:|---:|
| CSDB size | 0.5 MB | 2.0 MB | 5.1 MB | 10.2 MB |
| `GET /dms` median (response) | 14 (41 KB) | 41 (163 KB) | 125 (408 KB) | 258 (815 KB) |
| `GET /summary` median | 53 | 281 | 655 | **1,481** |
| `GET /explore` median (response) | 12 (13 KB) | 44 (51 KB) | 145 (127 KB) | 289 (254 KB) |
| `GET /pmc` median (response) | 15 (20 KB) | 43 (77 KB) | 139 (192 KB) | 321 (383 KB) |
| `GET /release` median / p95 | 110 / 190 | 303 / 368 | 902 / 935 | **2,202 / 2,878** |
| `POST /dms` (create) median over the 100 creates ending at this count | 40 (first 50) | 95 (101-200) | 247 (401-500) | **551 (901-1000)** |
| `POST /validation` (no BREX) wall | 1.5 s | 5.9 s | 17.8 s | 23.2 s (and 14.2 s on repeat) |
| ...event-loop max stall during that call | 0.3 s | 2.0 s | **6.9 s** | **5.7 s / 5.1 s** |
| ...Node peak RSS | 192 MB | 200 MB | 261 MB | 453 MB |
| ...schema check outcome | 50 checked | 200 | 500 | **batch failed: "memory access out of bounds"** (PERF-002) |
| `GET /api/overview`, `/api/projects` (author, 200+ projects) | 187 / 93 | 185 / 54 | 293 / 111 | 347 / 140 |
| `PUT /dms/:file` (save one module; N=20) | 15.5 ms at 3 modules | | | **165.7 ms (p95 285)** at 1000 |
| `GET /dms/:file` (read one module) | 1.6 | | | 1.8 |

**Reading.** Every operation that touches the whole CSDB is linear in the module count and none is cached: listing 815 KB of JSON at 1000 modules, `/summary` 1.5 s, `/release` 2.2 s, and a **single save of one module costs 166 ms** because it re-reads the head of every module (PERF-005). Creating the 1000 modules one by one took 309 s of request time (5.2 minutes), with the per-create median rising from 40 ms (first 50) to 551 ms (modules 901-1000; slowest single create 987 ms): create is O(n), a batch of n is O(n^2). Reading one module is constant (1.8 ms).

**Publication gate at 1000 modules (`m13`, `POST /release`, no PDF).** Wall 91.4 s, event-loop stall **81.2 s**, Node RSS 175 to 630 MB, process tree peak 1,336 MB, answer **422 `VALIDATION_FAILED`** naming module 0001 as "Could not be checked against a schema" (the batch ceiling of PERF-002; the module itself is fine). The health probe reported only 670 ms (see 1.2 for why the stall is quoted from ELD).

### 3.5 One large data module (a project holding only that module; 1 run per cell)

| Size of the module | 100,507 B | 1,011,723 B | 10,185,867 B |
|---|---:|---:|---:|
| `POST /dms` create (= event-loop stall) | 159 | 439 | 1,686 |
| `GET /dms/:file` | 20 | 31 | 198 |
| `PUT /dms/:file` save (= stall) | 61 | 376 | 1,486 |
| `POST /validation` no BREX (stall) | 795 (153) | 1,144 (454) | 3,191 (2,401); reports **1 schema error** ("Element 'levelledPara': This element is not expected") |
| `POST /validation` with BREX (stall) | 3,040 (2,517) | **168,543 (168,041)** | **not finished after 5 min 20 s; aborted by me** (server RSS above 920 MB) |
| `POST /release` gate, no PDF (stall) | 6,308 (4,945) | **141,291 (140,929)** | not run |

The 10 MB module is valid by construction (same generator as the 1 MB module, which validates clean); why the schema pass reports an error at that size is **NOT VERIFIED** (hypothesis: a libxml2 content-model limit on tens of thousands of siblings). BREX cost grew 55x (3.0 to 168.5 s) for 10x the size, i.e. about size^1.7; with the faster 1.6 s observation of the 100 KB case in a later profile run the growth is about 105x. The modules are synthetic and flat (4,400 `levelledPara` siblings in the 1 MB case), which is the worst case for the BREX XPath evaluator (PERF-004); real modules are deeper and less flat.

### 3.6 Publishing: builds, cold and warm, concurrent (11 server publishes, single samples)

| Build | wall | server total | phases (ms) | ELD max | Node peak RSS | JVM peak WS |
|---|---:|---:|---|---:|---:|---:|
| S1000D sample (3 modules), **first build after process start** | 5,942 | 3,734 | validate+gate 2,051 · FO 247 · FOP 3,437 | 1,107 | 342 MB | 263 MB |
| same, warm | 3,193 | 1,860 | validate 1,303 · FO 161 · FOP 1,677 | 325 | 342 | 401 |
| same, warm, **100 WebSocket subscribers** | 2,696 | 1,283 | validate 1,319 · FO 138 · FOP 1,069 | 387 | 342 | 463 |
| JSS UHB seed, first | 2,785 | 2,460 | validate 240 · rest | 127 | 342 | 502 |
| JSS UHB seed, warm | 1,539 | 1,280 | - | 77 | 342 | 511 |
| **3 simultaneous publishes** of 3 different S1000D projects | 4,885 for all three; they finish at 3,100 / 3,927 / 4,885 | 1,101 / 1,710 / 2,364 | the three PDF renders run one after another in the single FOP lane | 517 | - | - |
| 2 simultaneous publishes of the same project | 3,827; finish at 2,116 / 3,827 | 797 / 701 | second "Validating" message appears at 2,117 ms: serialised per project | - | - | - |
| **100 synthetic modules** (8.9 KB each, one titled figure each) | **179,165** | 166,299 | validate+gate **12,645** · **FO (xsltproc) 154,440** · FOP 11,780 · PDF 2.95 MB | 11,174 (during validation) | 418 | **756** |
| Direct cold `java ... org.apache.fop.cli.Main`, same FO as the sample build (outside the server) | 4,297 | - | one-shot JVM | - | - | 207 |

**Reading.** (1) The warm JVM matters: the same FO takes 1.1-1.7 s in the warm daemon and 4.3 s in a fresh `java` process (about 3x). The very first warm render (3.4 s) is itself slower than later ones because the JVM is still compiling. (2) Validation is 55-70% of a small build (1.3 s of 1.9 s) and it runs **again on every publish even when nothing changed** (builds 2 and 3 re-validated and re-rendered identical content). (3) Simultaneous publishes are serialised at the FOP stage; three at once finish in 4.9 s against about 5.2 s for the sum of their own server times (a gain of about 6%; the last user waited 4.9 s for a 2.4 s job). (4) The 100-module build is dominated by **xsltproc FO generation, 154 s, the object of PERF-003**. (5) 100 WebSocket subscribers add no measurable cost (build time and ELD are within run-to-run noise; about 14 progress messages per build). (6) The JVM's working set grows with every build and never shrinks: 95 MB idle, 263, 401, 463, 502, 511, then **756 MB** after the 100-module build; **707 MB** when idle after the whole suite (OS measurement, PID 15796). It is started without heap flags (`fopd.js:49`).

The server log (scratch run) contains `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 exit listeners added to [ChildProcess]` after the 11th render: VERIFIED listener leak in `vendor/engine/fopd.js:105` (`proc.once('exit', onExit)` per render, never removed).

### 3.7 The FO stage in isolation (xsltproc only, no PDF), same stylesheet and flags as the build

| Modules in the publication | 3 | 10 | 25 | 50 | 100 |
|---|---:|---:|---:|---:|---:|
| My modules (8.9 KB, one titled figure each) | 266 | 476 | 2,258 | 14,652 | **154,440** (from the 100-module build) |
| Same, **figures removed** (`m12b`) | | | 543 | 1,582 | |
| Same 25 modules, **ids made unique per module** (`m12`) | | | 1,931 | | |
| Clones of the repo's e2e fixture (4.2 KB, one titled figure) (`m12c`) | | | 914 | 4,992 | **36,509** |

* Doubling the modules multiplies the time by 6.5x (25 to 50) and 10.5x (50 to 100): worse than quadratic.
* Removing the figures removes almost all of it (25 modules: 2.26 s to 0.54 s; 50: 14.65 s to 1.58 s). Making ids unique changes it by only 15%. So the cost follows **titled figures x document size**, not duplicate ids.
* `xsltproc --profile` on the 25-module input ranks the named template `s1000d-loi` (List of Illustrations) first, 8x above the next template (relative ordering only; the profiler's absolute unit does not match wall time on this build).
* The code that does this (OBSERVED): `vendor/pipeline/s1000dtofo/frontmatter-s1000d.xsl:716-757` loops over every titled figure of every module and, for each row, evaluates `generate-id((//dmodule//figure[title])[1])` over the whole document and calls `unique-id`, which for a repeated id runs `count(preceding::*[@id = current()/@id])` (`s1000dtofo.xsl:1163-1177`).

### 3.8 Project archive, import and backup

| Operation (N shown) | Result | Event-loop stall (ELD max) | Node RSS |
|---|---|---:|---|
| `GET /projects/:id/export`, 3 modules (N=5) | 56-87 ms, 35 KB zip | 9-20 ms | flat |
| export, 100 modules (N=5) | 206-253 ms, 303 KB | 11-16 ms | flat |
| export, 1000 modules, 10.2 MB (N=3) | 1.16-1.18 s, 2.77 MB | 17-21 ms | flat |
| `POST /xengine/import` of those archives, 3 / 100 / 1000 modules | 239-315 ms / 726-831 ms / 4.77 s | 132-156 ms / 120-150 ms / **599 ms** | flat |
| `POST /dms-import`, 100 files in one multipart request | 2.2 s (22 ms per module; one-by-one creates cost 27-40 ms each in a small project) | not meaningful (histogram not reset) | +4 MB |
| `POST /import/scan` of a 157 MB package zip (20 modules + one 150 MB file) | 730 ms | 368 ms | peak **1,066 MB** from a 611 MB baseline (+455 MB, 2.9x the upload) |
| `GET /api/backup`, author scope, 14.45 MB zip (N=3) | 2.2-4.2 s | **2,142-4,194 ms (equals the whole request)** | not meaningful at this size (working-set trimming between calls) |
| `GET /api/backup`, administrator scope, 14.48 MB (N=3) | 2.2-2.4 s | 2,138-2,349 ms | not meaningful at this size |
| **Backup with a 240 MB media payload** (author) | 9.9 s, 266 MB zip | **9,404 ms** (probe 9,461 ms) | 604 to **928 MB** (+323), peak 1,182 MB, 254 MB held as ArrayBuffers |
| same, administrator scope | 9.5 s, 266 MB | 8,993 ms | 603 to 931 MB |
| **Streaming project export of the same 240 MB payload** | 9.8 s, 252 MB zip | **17 ms** (probe 3 ms) | 674 to 603 MB (no growth) |

**Cross-check of agent A (PLT-005, probe `p4`).** A measured a 240 MB payload: 15.8 s total, a health stall of 14.2 s, RSS 130 to 370 MB, 252 MB zip. I measure 9.9 s, a 9.4 s stall (95% of the request, the same shape), RSS +323 MB (peak 1,182 MB), 266 MB zip. The 1.6x difference in time is consistent with background load and with A's per-call PowerShell RSS sampling; the conclusion (the whole backup runs on the event loop and in memory) is confirmed. The streaming export, which exists in the same code base, moves the same bytes in the same time with **no stall and no memory growth**: that is the design to reuse (PERF-006).

### 3.9 SQLite (a scratch database opened exactly as `vendor/engine/db.js:20-22` opens the app's; 500 autocommit inserts into a table with two indexes)

| Setting | effective pragmas | insert median / p95 | 500 inserts in one transaction |
|---|---|---:|---:|
| As the app (WAL only) | `synchronous=2 (FULL)`, `busy_timeout=0`, `foreign_keys=1`, `cache_size=-2000` (2 MB), `temp_store=0`, `mmap_size=0` | **3.26 / 4.97 ms** | 9 ms |
| WAL + `synchronous=NORMAL` | `synchronous=1` | **0.08 / 0.17 ms** | 7 ms |
| NORMAL + `busy_timeout=5000`, 64 MB cache, `temp_store=MEMORY` | | 0.08 / 0.18 ms | 7 ms |

Without `synchronous=NORMAL` every autocommit write (each audit row, notification, session touch, review comment) costs 3.3 ms of **synchronous** thread time on this SSD, 40x more than with NORMAL, and 500 of them take 1.7 s against 9 ms in one transaction. `grep` for `quick_check`, `integrity_check` and `busy_timeout` in `backend/src` and `backend/vendor/engine` finds none (VERIFIED). Agent A's `PLT-002` already covers `busy_timeout` = 0 (second writer fails immediately).

**Cost of a boot-time check** (`m15`, on a `VACUUM INTO` copy of the 39.4 MB scratch database): `PRAGMA quick_check` 41 ms (37 ms on repeat), `integrity_check` 58 ms, `VACUUM` 925 ms; all returned `ok`.

### 3.10 Memory and leak signal

| Probe | Result |
|---|---|
| 6,000 x `GET /summary`, then 200 x `PUT` (one new revision each), then 200 x `POST review/comments`, forced GC before each reading | `heapUsed` 42.6 MB to 42.4 MB (flat); RSS plateaus at 157-163 MB (about +1 MB per 1,000 requests, flattening); active handles constant at 8. **No leak signal** in the request path. |
| 200 projects created through the API | latency +48% over the run (create 84 to 124 ms), no memory finding |
| Repeated builds | Node RSS 274 to 307 MB over 6 builds (flat within noise); **the JVM grows** (section 3.6) |
| `exit` listeners on the FOP process | one added per render, none removed (warning after 11) |
| Uploads temp folder (`agastya-uploads`) after all runs | 0 files left (hourly sweep exists, `index.ts:29-30`) |
| Derived files per project | the 100-module project holds `jss-output.fo` (5.0 MB) and `jss-output.pdf` (2.95 MB) next to 0.9 MB of sources; the backup includes them (only `node_modules` and `.git` are skipped, `backup.ts:14`), the export does not |

### 3.11 Where the time goes (inspector CPU profiles, 0.5 ms sampling, taken inside the running server)

| Scenario | Wall | Top findings (inclusive unless "self") |
|---|---:|---|
| `GET /release` x3, 1000-module project | 4.8 s (1.6 s each) | `publicationSources` 72% (`listDms` 36%, publication parse 22%); `releaseStateOf` to `publicationFingerprint` 70%; `releaseOverview` to `reviewState` 55% (`listDms` again); native `open/read/close/stat` 48% of self time. The module list is rebuilt, by opening every file, **at least three times per request**. |
| `GET /summary` x3, 1000 modules | 3.2 s | `listDms` 54%, `releaseStateOf` 49%, `explore` 26%, `readHead` 31% |
| `POST /dms` x5 into the 1000-module project | 2.8 s (560 ms each) | `listDms` **76%**: `assertUnique` 39% and `placeNewDm` 50% each re-scan the CSDB; publication parse/rewrite 12% |
| `POST /validation` (no BREX), 200 modules | 3.4 s | `spawn` (native, main thread) **40.7% self** (one `xsltproc` per module for well-formedness); `applicIssues` (parses every module with xmldom) 14%; `catalogEnv`/`writeCatalog` 5.7% |
| same with BREX | 20.1 s | `checkModuleBrex` 81%, `evaluateXPath` 75%; self time in `xpath.js:217 assign` 29%, `XPathContext.extend` 11% |
| BREX of one 100 KB module | 1.6 s | `compareDocumentPosition` in `@xmldom/xmldom/lib/dom.js:1595` **37.6% self** (node-set ordering over thousands of siblings) |

### 3.12 Costs of the pieces, in isolation (engine modules called directly, 200 synthetic modules unless stated)

| Piece | Cost |
|---|---|
| one `xsltproc` well-formedness check (`validateXml.js:47`), 40 runs | median 39 ms (min 24, p95 183) per file; 200 files over the pool of 6: 2.1 s |
| xmllint-wasm, one document per call (`validateDocument`-style) | 282 ms median per call (schema preload and a new `worker_threads` Worker each call) |
| xmllint-wasm, batch (`validateProjectSchema`) | 10 docs 341 ms · 50 docs 353 ms · 200 docs 506 ms · 400 docs 902 ms · 600 docs 892 ms · 800 docs (7.2 MB) 816 ms · **900 docs (8.0 MB) fails** · **1000 docs (8.9 MB) fails** |
| xmllint-wasm, one 25 MB module | fails: "libxml2: out of memory" |
| hash of all sources (the fingerprint, `release.ts:36`), 200 files | 43 ms (so 1000 modules is about 0.2 s; the rest of `/release` is the repeated module listing) |
| 12 KB head read + stat of 200 files (`listDms`) | 28 ms (about 0.14 ms per module; 1000 modules, three times, is the profile above) |
| xmldom parse of 200 modules | 495 ms (2.5 ms each; `applicability.validateProject` and BREX do this per validation) |
| Argon2id password verify (`crypto.js`, native binding, **active here**) | 67 ms, off the event loop (largest timer gap while verifying: 16 ms) |
| `scryptSync` N=2^15 (the fallback when the Argon2 binding does not load) | 144 ms median, **on the event loop** |
| JSS document `GET` / `POST validate` / `PUT` (UHB seed, N=20) | 96 / 97 / 102 ms median; event-loop stall 20 ms (the time is off-thread: a Worker and the schema per call). S1000D module read is 2 ms. |

---

## 4. Findings

Summary (details follow; "S/M/L" is the honest effort, not a target date).

| ID | Priority | Label | Size | One line |
|---|---|---|---|---|
| PERF-001 | P0 | VERIFIED | L | Validation, BREX, the gate and CSDB-scanning reads run on the single request thread; stalls of 2-170 s freeze every user |
| PERF-002 | P0 | VERIFIED | M | Schema pass fails silently above about 8 MB / 850 modules; the gate then blames module 0001; `schemaChecked` overstates |
| PERF-003 | P0 | VERIFIED | L | S1000D FO stage is super-quadratic in figure-bearing modules: 100 modules = 36-154 s; the repo's 500-module baseline is not reproducible here |
| PERF-004 | P1 | VERIFIED | M | BREX costs about 85 ms per small module and grows about size^1.7 (xpath on xmldom) |
| PERF-005 | P1 | VERIFIED | M | Every save/create/read re-reads the whole CSDB: save 15 to 166 ms, create 40 to 551 ms, `/release` 19 ms to 2.2 s at 1000 modules |
| PERF-006 | P1 | VERIFIED | M | `/api/backup` is built in memory on the event loop: 240 MB = 9.4 s stall, +323 MB; the streaming writer exists |
| PERF-007 | P1 | VERIFIED | M | Dashboard is O(folders x all projects) for non-owners: 3.2 s at 60 folders / 271 projects |
| PERF-008 | P1 | VERIFIED | M | One FOP JVM: no deadline (DEP-028), working set 95 to 756 MB and never shrinks, listener leak, no admission control |
| PERF-009 | P2 | VERIFIED | S | SQLite: `synchronous=FULL` costs 3.3 ms per autocommit write (40x NORMAL); no busy timeout, no boot check |
| PERF-010 | P2 | VERIFIED | M | Package scan, `/media` and `dms-import` buffer uploads in memory (157 MB zip = +455 MB peak) |
| PERF-011 | P2 | VERIFIED | S | JSS document `GET` runs a full validation every time (96 ms against 2 ms) |
| PERF-012 | P2 | VERIFIED | M | No cached or incremental build: unchanged content is re-validated and re-rendered; fingerprint computed three times |
| PERF-013 | P2 | VERIFIED | S | Process spawn is 41% of validation time on Windows: one `xsltproc` per module for well-formedness |
| PERF-014 | P2 | VERIFIED | S | Large single bodies stall the thread (10 MB module: 1.7 s create, 1.5 s save); revisions store full copies |
| PERF-015 | P3 | OBSERVED | S | `GET /publish/download` can start a full build inside a GET |
| PERF-016 | P3 | OBSERVED | S | Lists are unpaginated and uncompressed (815 KB `/dms` at 1000 modules) |
| PERF-017 | P3 | OBSERVED | S | The scrypt fallback blocks the thread 144 ms per login when the Argon2 binding is missing |
| PERF-018 | P3 | OBSERVED | S | WebSocket broadcast does a database-backed authorisation per client per message; no backpressure |
| PERF-019 | P3 | VERIFIED | S | PDF compression step is a silent no-op (no Ghostscript bundled) |

### PERF-001 · P0 · VERIFIED · L · Validation, BREX, the publication gate and CSDB-scanning reads run on the single request thread; one author can freeze the server for every user

**Category** Scalability and availability (single-threaded server doing CPU work in request handlers).
**Problem** Node serves every request on one thread. The whole validation pipeline, the BREX checker, the applicability check, the duplicate-id and ICN scans and the publication gate are synchronous CPU or synchronous file loops inside the HTTP handler, and **every publish runs the gate first**. While one runs, no other request is answered: not the health check, not a login, not another author's save. In server mode (several users on one machine) one author's click stops all of them; on a single desktop it freezes the UI of the same user.
**Evidence** (all VERIFIED, scratch server): event-loop stall during `POST /validation` without BREX: 0.3 s (50 modules), 2.0 s (200), **6.9 s (500)**, 5.7 s (1000); with BREX one 100 KB module stalls 2.5 s, **one 1 MB module 168 s**, a 10 MB module did not finish in 5 min 20 s; `POST /release` (gate) on the 1000-module project: **81 s** stall (wall 91 s, `m13`); the 100-module publish: 11.2 s stall during its validation phase; backup 9.4 s (PERF-006); read endpoints `/summary` 1.5 s and `/release` 2.2 s at 1000 modules (PERF-005). With 10 concurrent clients the median latency is 10x the sequential one for every endpoint (3.1). Code: `routes/project-content.ts:264-277` (validation), `services/validation.ts:153-244` (`runValidation`: BREX loop at 217-232 calls `checkModuleBrex` once per module with `fs.readFileSync`; `applicIssues` parses every module; `duplicateIds`, `undeclaredIcns`, `missingGraphics` read every file), `services/publishGate.ts:50-95` (same BREX loop), `services/publisher.ts:341` (gate inside every publish). Profile (3.11): 75% of a 200-module BREX validation is inside `evaluateXPath`, 40% of a no-BREX validation is `spawn`.
**Root cause** No separation between the request thread and CPU work: no worker pool, no job queue, services written with synchronous fs and pure-JS XML/XPath. Only `xsltproc` and the xmllint-wasm Worker are off-thread, and those are started from the main thread (PERF-013).
**Current implementation** Handlers `await` the service; progress is sent over WebSocket (`broadcast.ts`) but computed on the same thread, so the progress messages themselves are delayed.
**Recommendation** (1) A small in-process job runner with a pool of `worker_threads` (size = cores - 1, minimum 1) for validation, BREX, applicability, id/ICN scans and the gate; the HTTP call returns a job id or awaits it, and the WebSocket channel already in place carries progress. Packaging note: workers must resolve `vendor/` the way `fopd.js` does for `.asar.unpacked`. (2) Make the unit of work one module: cache each module's result by (content hash, BREX chain hash, schema issue) so unchanged modules cost nothing (PERF-004, PERF-012). (3) **Interim, S-sized:** `await setImmediate()` between modules in the BREX, applicability and scan loops so the thread never holds for more than about 50 ms; this alone makes the server responsive during validation although the validation is not faster. (4) Admission control: at most one or two validation jobs server-wide, the rest queued (PERF-008, section 9.4).
**Expected outcome** Event-loop max below 100 ms during any validation; throughput for other users unaffected; wall time of a 1000-module validation bounded by core count instead of a single core; repeat validation of unchanged modules near zero.
**Expected benefit** Other users, and the same user in another tab, stay responsive during validation: stalls of 2-168 s fall below 100 ms; with caching a repeat validation costs almost nothing; with the pool a 1000-module validation can use all cores instead of one.
**Complexity** L: the interim yielding is S (2 days); the worker pool plus caching is the L part.
**Dependencies** PERF-002 (batches become worker jobs), PERF-004, PERF-005, PERF-008; DEP-028 (supervision of long jobs).
**Risks** Worker memory (each worker may load the schema set, about 6-8 MB, and parse documents; keep the pool small); deterministic ordering of findings (sort as today); tests that call services in-process need a synchronous fallback; the packaged layout (asar); a worker crash must fail the job, not the server.
**Regression risk** Medium. It changes how every long operation is executed. The JSON report (findings and their order) must be identical to today on D0, D1 and the e2e fixtures.
**Acceptance criteria** While a 200-module BREX validation runs, `/api/health` and `/api/auth/me` have p99 below 100 ms; the 1000-module validation shows event-loop max below 100 ms; a second validation of an unchanged project takes at most 20% of the first; killing a worker mid-job returns a clear error and the next job works.
**Test cases** ELD during validation at 200 and 1000 modules; two users validating at once while a third saves a module; unchanged re-run; corrupt module; worker killed; job timeout.
**Benchmark methodology** B3 and B8 (section 6). Dataset D1 at 200 and 1000 modules. Run `POST /validation` (with and without BREX) while a second client polls `/api/health` every 20 ms and a third saves a module every second; record event-loop delay max, health p99, save latency and validation wall time; 5 repeats, median; compare with 3.4 and 3.5.

### PERF-002 · P0 · VERIFIED · M · The schema pass fails silently above about 8 MB of modules per schema (about 850 modules); the gate then refuses publication naming module 0001; `schemaChecked` still claims every module

**Category** Scalability and validation correctness.
**Problem** `validateProjectSchema` sends **all modules of one issue and schema file to one xmllint-wasm call**, and the WASM heap has a fixed default limit (32 MiB), which also holds the schema set (6-8 MB). Above about 7-8 MB of module text the call dies; the failure is caught and reported as one **info** note, attached to the first module of the batch. The run then says `schemaChecked: 1000, errors: 0`. The publication gate does treat an unchecked module as blocking, so it fails closed, but with a message that points at a module that is perfectly fine ("Could not be checked against a schema ... Fix it and try again"), and the user cannot fix it because nothing is wrong with that module. A manual of about 850 or more modules therefore cannot be published at all.
**Evidence** VERIFIED. Engine called directly: batches of 10 to 800 modules (7.2 MB) pass; **900 modules (8.0 MB) and 1000 modules (8.9 MB) fail with "memory access out of bounds"**; a single 25 MB module fails with "libxml2: out of memory". Through the API on the 1000-module project (twice): `POST /validation` returns `schemaChecked 1000, unchecked 1, summary error 0`, the issue list begins with the info "Schema check could not run ... memory access out of bounds"; `POST /release` returns **422 `VALIDATION_FAILED`**: "Not published: 1 data module is not valid against the S1000D schema (first: DMC-...-0001-...xml - Could not be checked against a schema). Fix it and try again." with one finding. A synthetic 10 MB single module validated, but reported one schema error whose cause I could not establish (NOT VERIFIED). Code: `vendor/engine/validateSchema.js:77-154` (modules grouped per `issue|schema`), `:159-175` (one `validateXML` call per group), `:176-186` (the catch adds one info note with `rel: g.docs[0].rel`), `services/validation.ts:241-244` (`unchecked` built from that single note), `services/publishGate.ts:78-80` (one finding per `unchecked` file), `node_modules/xmllint-wasm/index-node.js:85,111-115` (memory pages default; the API accepts up to 4 GiB, the repo passes nothing), `:200` (one new Worker per call).
**Root cause** Unbounded batch size against a fixed WASM memory; the error path loses the identity of the modules that were not checked.
**Current implementation** One batch per schema; a failed batch is reduced to one info note.
**Recommendation** (1) Batch by bytes, not by count: at most about 3-4 MB of module text (roughly 400 modules) per call, several calls in a worker pool (PERF-001). (2) Pass explicit `initialMemoryPages` / `maxMemoryPages` sized to the largest module plus the schema set. (3) If a batch still fails, retry module by module so exactly the failing module is named; if one module is too large for the validator, say "too large to validate (limit X MB)" for that module only. (4) Never count a module in `schemaChecked` unless it was judged; put **every** module of a failed batch in `unchecked`. (5) Make the message truthful: "the validator ran out of memory for N modules" rather than "not valid".
**Expected outcome** 5000-module projects validate; the gate's message names the real cause and scope.
**Expected benefit** Manuals of 1000 to 5000 modules become publishable, and the message matches the cause.
**Complexity** M (about a week with tests).
**Dependencies** PERF-001 (same job unit), gate waiver policy (`waivable`), PERF-014 (maximum module size).
**Risks** More WASM instantiations (about 280 ms fixed cost each, so 12 calls for 5000 modules is about 3.4 s of overhead, acceptable); the finding order and counts must stay stable for tests.
**Regression risk** Low to medium. Results for projects that already validate must stay identical; the number of WASM instantiations (about 280 ms fixed each) grows.
**Acceptance criteria** Projects of 1000, 2000 and 5000 modules validate with 0 unchecked and the same findings as per-module validation of the same data; a 25 MB module produces one clear per-module message; `schemaChecked` equals the number of modules actually judged.
**Test cases** The `m8` series (batch ceiling); a module that crashes the validator; 5000 modules; mixed issues (4.2 + 5.0 groups).
**Benchmark methodology** B11. Dataset D1 at 600, 800, 1000, 2000 and 5000 modules plus one 25 MB module, through the API and through the engine call; record `schemaChecked`, `unchecked`, wall time and process peak memory. The fix passes when `unchecked` is 0 for all valid data.

### PERF-003 · P0 · VERIFIED · L · The S1000D FO stage (xsltproc, vendored stylesheet) is super-quadratic in figure-bearing modules: 100 modules take 36-154 s here, and the repository's own 500-module PDF baseline cannot be reproduced

**Category** Document-processing scalability (publishing engine).
**Problem** Publication time explodes as modules are added. The user sees a spinner for minutes; every other build of that project waits behind it (per-project serialisation); and the work is a single `xsltproc` process, so adding cores does not help.
**Evidence** VERIFIED on this host. In the server, the 100-module publish spent **154.4 s of 166.3 s** in "Rendering XSL-FO (direct S1000D)". With `xsltproc` run alone on the same input (same stylesheet and flags): 3 modules 0.27 s, 10 modules 0.48 s, 25 modules 2.26 s, 50 modules 14.65 s, 100 modules 154 s (factors 6.5x and 10.5x per doubling). With **clones of the repository's own e2e fixture** (`frontend/e2e/fixtures/dm21/5-0`, 4.2 KB, one titled figure): 25 modules 0.9 s, 50 modules 5.0 s, **100 modules 36.5 s** (factor 7.3x per doubling). Removing the figures from the 25- and 50-module inputs cuts the time from 2.26 to 0.54 s and from 14.65 to 1.58 s. Making all ids unique changes it by 15% only. `xsltproc --profile` ranks the template `s1000d-loi` (List of Illustrations) first, 8x above the next. The repo baseline (`docs/S1000D_COMPLIANCE_MATRIX.md:96-113`, Node 26.13, 8 CPUs, quiet) gives **73.2 s for the whole PDF of 500 modules**. **Extrapolation, not measured:** continuing the 36.5 s per 100 modules at the observed growth would put 500 modules at about an hour for the FO stage alone; I did not run 500.
**Root cause** OBSERVED in code and consistent with every experiment above: `vendor/pipeline/s1000dtofo/frontmatter-s1000d.xsl:716-757` loops over every titled figure of every module and, for each row, evaluates `generate-id((//dmodule//figure[title])[1])` against the whole document and calls `unique-id`, whose duplicate branch (`vendor/pipeline/s1000dtofo/s1000dtofo.xsl:1163-1177`) runs `count(preceding::*[@id = current()/@id])`. Each is O(document) per figure and the document grows with the module count, so the total is O(figures x document). Figure numbering (`mode="number"`) and other front-matter loops were not isolated.
**Current implementation** One `xsltproc --xinclude` transform of the whole resolved publication with the bundled **libxslt 1.1.28, 32-bit** (`vendor/tools/libxslt-1.1.28-win32-x86`), then FOP.
**Why the baseline differs: NOT VERIFIED.** Candidates: a different (newer) libxslt and operating system in the baseline run, and different data. I could not run `perf-phase17.js` (its `boot()` uses an ephemeral port outside my allowed range). What I can say is that the repo's own fixture, run through the repo's own stylesheet on the Windows toolchain the installer ships, is already at 36.5 s for 100 modules with the same super-quadratic shape.
**Recommendation** (1) Replace the per-figure whole-document scans by keys and one-time variables: compute `(//dmodule//figure[title])[1]` once outside the loop; build the duplicate-id suffix from a keyed position (`key('by-id', @id)`) instead of `preceding::`; (2) profile the other front-matter and numbering templates with `xsltproc --profile` at 100 modules before and after (I profiled 25 only); (3) keep XPath 1.0 (libxslt 1.1.28 has no XSLT 2.0 grouping); (4) add the FO-stage scaling benchmark B6 to the test run so a regression shows within minutes. **Do not change output**: the FO and the PDF must stay identical (golden tests).
**Expected outcome** FO stage of 100 modules from 36-154 s to under 10 s (estimate: the same 50-module input without figures took 1.6 s); growth no worse than n^1.3.
**Expected benefit** FO stage for 100 modules from 36-154 s to about 10 s or less; a 500-module publication becomes a matter of minutes instead of an extrapolated hour (extrapolation, not measured).
**Complexity** L: the stylesheet fix itself is small, the proof that the output is unchanged across the Xignal golden files and JSS/S1000D samples is the work.
**Dependencies** PERF-012 (a build cache would hide, not fix, this), the vendor-exception rules in `docs/JSS_VENDOR_EXCEPTIONS.md`, `backend/scripts/golden-xignal.js` and `sample-compare.js`.
**Risks** Changed ids or numbering break cross-references (the stylesheet comment says a reference into a repeated id must resolve to its first occurrence); FO differences; behaviour on newer libxslt must be re-checked if the toolchain is updated.
**Regression risk** High. The stylesheet produces numbering and cross-references; byte-identical FO and PDF text on the golden sets is the gate.
**Acceptance criteria** FO byte-identical before and after for the sample, the fixture clones and the Xignal golden set; B6: 100 modules at most 10 s, 50 to 100 factor at most 2.5x; full 100-module publish at most 40 s.
**Test cases** Figures with duplicate ids across modules; zero figures; one module with 200 figures; 500-module run; cross-reference to a repeated id.
**Benchmark methodology** B6 with D2 at 25, 50 and 100 modules (`xsltproc` only, same flags `--xinclude --nonet`, 5 repeats, no PDF), report the ratio 50 to 100; `xsltproc --profile` before and after at 100 modules (ranking of templates); then B5 with D1 at 100 modules for the end-to-end publish.

### PERF-004 · P1 · VERIFIED · M · BREX checking costs about 85 ms per small module and grows about size^1.7: the pure-JS XPath engine over xmldom is the hot spot

**Category** CPU cost of validation.
**Problem** BREX is an optional but, in the publication gate, mandatory step for S1000D projects, and it is the most expensive part of validation. For 200 small modules it is 16.7 s of the 20.1 s validation (3.4 s without BREX); for a flat 1 MB module it is 168 s.
**Evidence** VERIFIED. Profile of the 200-module BREX validation: `checkModuleBrex` 81% inclusive, `evaluateXPath` 75%, self time in `xpath.js:217 assign` 29% and `XPathContext.extend` 11%. Profile of one 100 KB module: `compareDocumentPosition` in `@xmldom/xmldom/lib/dom.js:1595` 37.6% self. Sizes: 100 KB 3.0 s (1.6 s in a quieter run), 1 MB 168.5 s. Code: `services/brex.ts:376-` (`checkBrexModels` loops `for rule of b.rules` and calls `evaluateXPath(repairXPath(rule.objectPath), doc)` for every rule on every module), `:151` (`evaluateXPath`), `:617-628` (only rule *lint* is cached, not results), `:619` (`checkModuleBrex`), call sites `services/validation.ts:217-232` and `services/publishGate.ts:88-95`.
**Root cause** One XPath evaluation per rule per module through pure JavaScript; node-set ordering in the `xpath` package calls `compareDocumentPosition`, which walks sibling chains, so wide documents are quadratic-ish; the DOM is re-parsed per module and per run; results are never cached.
**Current implementation** As above; the check runs inside the request (PERF-001).
**Recommendation** (1) Cache the result per (module content hash, resolved BREX chain hash, issue): unchanged modules are free, and the project-wide check becomes incremental. (2) Evaluate simple absolute-path rules ("this element must not occur", "this attribute value must be in the list") in **one traversal** that collects element and attribute paths into maps, instead of R separate XPath runs. (3) Run what remains in the worker pool (PERF-001). (4) Before choosing a different engine for the remaining rules, measure candidates on B4; I have not measured any alternative, so a replacement engine is an option, not a recommendation.
**Expected outcome** Second validation of an unchanged 200-module project: BREX cost about zero; first run at most about 20 ms per typical module.
**Expected benefit** BREX stops dominating validation (16.7 of 20.1 s for 200 modules) and unchanged modules cost nothing on re-run.
**Complexity** M.
**Dependencies** PERF-001, PERF-012.
**Risks** Semantic equivalence of BREX rules (flag 0/1/2 handling, severities, value lists, SNS and notation rules) is the risk: the existing BREX tests must stay green (not run by me) and findings must be diffed on the sample and the e2e fixtures.
**Regression risk** Medium. BREX semantics (flags, value lists, severities, notation rules) must not change; diff findings on D0, the e2e fixtures and D1.
**Acceptance criteria** 200 modules: at most 5 s cold, at most 1 s with a warm cache; a 1 MB module at most 10 s; identical findings before and after on the corpus; cache invalidates when the BREX module or the issue changes.
**Test cases** Changed module, changed BREX, changed issue, rule that matches thousands of siblings, rule with XPath 2.0 syntax (skipped today with a note).
**Benchmark methodology** B4. Dataset D1 at 200 modules and D3 at 100 KB and 1 MB. Time `POST /validation` with BREX on a cold and on a warm cache, record event-loop delay max; take an inspector CPU profile and confirm that `evaluateXPath` falls below 10% inclusive.

### PERF-005 · P1 · VERIFIED · M · Every save, create and read endpoint re-reads the whole CSDB; cost per operation is linear in the module count (save 15 to 166 ms, create 40 to 551 ms, `/release` 19 ms to 2.2 s at 1000 modules)

**Category** Missing caching / index; repeated expensive work on request paths.
**Problem** Module identity, size and the publication are derived from the file system on every call. Saving one module re-reads the first 12 KB of all modules to check uniqueness; creating one does that twice plus a full document-index walk and a rewrite of the publication; the release endpoints list the CSDB at least three times per request. A batch of n creates is O(n^2) (the 1000 creates took 309 s of request time), and an author's editor autosave pays the linear cost on every save.
**Evidence** VERIFIED, tables 3.4 and 3.11. Save: 15.5 ms at 3 modules, **165.7 ms (p95 285)** at 1000; create 40 ms (first 50) to 551 ms (modules 901-1000); `/summary` 13 ms to 1,481 ms; `/release` 19 ms to 2,202 ms (p95 2,878); `/dms` 815 KB. Profiles: `listDms` is 76% of `POST /dms`, 54% of `/summary`, 36% of `/release` plus a further 37% through `reviewState`. Code: `services/csdb.ts:116-128` (`listDms`: `readdir` + `stat` + 12 KB head read + `parseIdent` per file), `:173-179` (`assertUnique` calls `listDms`), `:196` (`writeDm` calls `assertUnique` on **every save**), `:216-230` (`createDm`: `assertUnique`, `assertNewDmAllowed`, `docIndex.syncProject`, revision), `services/pm.ts:80` (`placeNewDm`), `:134` (`writePm`), `:162` (`explore`), `:217` (`publicationSources`), `services/release.ts:36,96` (fingerprint and `releaseStateOf`, called three times per build at `publisher.ts:295,341,365`).
**Root cause** No in-memory or database index of module identity; all state is re-derived from the file system on every call; no cache keyed by (path, mtime, size).
**Current implementation** Correct but O(n) per call, everywhere.
**Recommendation** (1) A per-project `CsdbIndex` map (file to identity summary, size, mtime, hash) built lazily and **updated in place** by `createDm`, `writeDm`, `deleteDm`, import, restore (all writers already pass through `csdb.ts` and `projectArchive.ts`); `assertUnique` becomes a lookup by `identityKey`; `listDms` serves the index. (2) Memoise `releaseStateOf` per request and make the fingerprint incremental (rehash only files whose mtime or size changed). (3) Parse the publication once per request. (4) Window `/dms` and `/explore` (PERF-016).
**Expected outcome** Save at most 20 ms and create at most 50 ms at 1000 modules; `/summary` and `/release` at most 100 ms.
**Expected benefit** Editor autosave and creation stay constant-time as the manual grows; a batch of 1000 creates becomes linear instead of quadratic; dashboard and release panels answer in about 100 ms.
**Complexity** M.
**Dependencies** PERF-001, PERF-012, PERF-016.
**Risks** Stale index when files change outside the API (manual copies, restore, importer): guard with the directory mtime and a rescan on mismatch, and invalidate in every writer; no multi-process sharing exists today, so no distributed invalidation is needed.
**Regression risk** Medium. A stale index is the main risk (guard with directory mtime and a rescan); API outputs must be byte-identical.
**Acceptance criteria** B3 thresholds above at 1000 modules; creating 1000 modules in a loop shows a flat (not rising) per-create time; identical JSON for the endpoints before and after.
**Test cases** Create/save/delete/import/restore keep the index consistent; external file added; duplicate identity detection unchanged.
**Benchmark methodology** B3. Dataset D1 at 1000 modules: N=20 saves, creates in blocks of 100 (plot median per block: expect a flat line), N=10 for every read endpoint; same machine, quiet, same Node.

### PERF-006 · P1 · VERIFIED · M · `GET /api/backup` builds the whole ZIP in memory on the event loop with the legacy writer: 240 MB stalls the server for 9.4 s and holds +323 MB; the streaming writer already exists and does the same job with a 17 ms stall

**Category** Unbounded in-memory buffering and a blocking request. Same defect as agent A's PLT-005 (confirmed and quantified here, not duplicated); agent F's lead (`team.ts:137-140`) is the same code.
**Problem** The backup is the safety net, and taking it freezes the server in proportion to the data, while memory grows by the size of the archive plus working copies.
**Evidence** VERIFIED, table 3.8: 14.5 MB of projects 2.2-4.2 s with a stall equal to the request; **240 MB payload: 9.9 s, stall 9.4 s (health probe 9.46 s), RSS 604 to 928 MB (peak 1,182 MB), 266 MB response**; administrator scope 9.5 s and 9.0 s. The streaming project export of the same payload: 9.8 s, **stall 17 ms, probe 3 ms, RSS flat**. Cross-check of A's numbers (15.8 s, 14.2 s, +240 MB) is in 3.8. Code: `routes/team.ts:132-141` (`chunks.push`, `Buffer.concat`), `services/backup.ts:30-52` (`fs.readFileSync` of every file, `zip.add`), `services/zip.ts:14-23` (`ZipWriter`, synchronous `deflateRawSync`; A reports 16/32-bit fields with no ZIP64), `services/zipio.ts` (the streaming ZIP64 writer used by the project export in `routes/xengine.ts`). The backup also includes regenerable derived files (only `node_modules` and `.git` are skipped, `backup.ts:14`): in my 100-module project `jss-output.fo` is 5.0 MB and the PDF 2.95 MB against 0.9 MB of sources.
**Root cause** The legacy synchronous writer is still behind `/api/backup`.
**Current implementation** `writeBackup(user, sink)` reads each file with `fs.readFileSync`, adds it to the legacy `ZipWriter` (synchronous `deflateRawSync`); the route collects the chunks in an array and sends one `Buffer.concat` at the end.
**Recommendation** Write `writeBackup` on `ZipStreamWriter` straight to `res` with backpressure and `fs.createReadStream`; exclude derived artefacts by default (`jss-output.fo/pdf`, `jss-preview.*`, `_resolved-pm.xml`, `.ext-host`); store already-compressed media (png, jpg, mp4, pdf, zip) without deflate; take a consistent `publisher.db` copy with `VACUUM INTO` (as `dbSnapshot.ts` does) so the backup contains the database (PLT-001); optionally run the deflate in a worker.
**Expected outcome** Stall at most 20 ms and RSS growth at most 50 MB for any size; time comparable to the export (about 41 s per GB on incompressible data on this host).
**Expected benefit** No stall for other users during a backup, flat memory, larger payloads possible, smaller archives.
**Complexity** M.
**Dependencies** PLT-001 / PLT-005 (agent A), PERF-001.
**Risks** ZIP64 readers in old tools; the restore path does not exist yet (PLT-001), so changing the archive layout needs a version marker.
**Regression risk** Low. The format stays a ZIP; verify with a ZIP tester and by restoring one project.
**Acceptance criteria** B7: event-loop max below 50 ms and RSS delta below 50 MB during a 240 MB backup; archive passes `python -m zipfile -t` and contains `publisher.db`; backup size without derived files is smaller than today's.
**Test cases** 0 projects, 1 large file, 10,000 small files, 5 GB (ZIP64), client disconnect mid-stream (stream must stop reading), concurrent edit during backup.
**Benchmark methodology** B7. Dataset D4 (240 MB) for the author scope and the administrator scope, 3 repeats each, plus D1 at 1000 modules; health probe every 20 ms, event-loop delay histogram, RSS before, after and peak.

### PERF-007 · P1 · VERIFIED · M · The dashboard is O(folders x all projects on the platform) for non-owners: 3.2 s per request at 60 folders and 271 projects

**Category** N+1 over the file system (agent A's PLT-008, reproduced and explained).
**Problem** `/api/workspace` and `/api/overview` are the first calls after login and on every dashboard visit. For an author who is only a member (the normal case for authors), cost per request grows with the number of folders **times** the number of projects on the whole platform.
**Evidence** VERIFIED, table 3.3: member-only at 10 / 30 / 60 folders: `/api/workspace` **513 / 1,447 / 3,195 ms**, `/api/overview` 562 / 1,499 / 3,275 ms, while the creator stays at 97-122 ms and a folder-less member-only user at 45-55 ms. Agent A measured 65 / 360 / 1019 ms in a platform of about 60 projects; the per-folder cost scales with platform size (17 ms at about 60 projects, 53 ms at 271). Code: `services/projects.ts:374-380` (`folderVisibleTo` calls `store.listProjectsForUser` and `workspace.listProjects(workspaceDir)` **inside the per-folder loop** of `workspaceFor`, `:389-405`), `:90-117` (`projectCard`: `readProjectJson`, `readdir` for the module count, `existsSync`, `listOwners` per project), routes `workspace.ts:32,58`. Responses are not paginated (107 KB at 200 projects).
**Root cause** Visibility is re-derived from disk per folder instead of once per request.
**Current implementation** As above.
**Recommendation** In `workspaceFor`, compute the user's project-id set and the platform project list **once** and pass them into the folder check (cost O(folders + projects)); cache `projectCard` fields that need the file system (`dmCount`, `hasPdf`) with invalidation on writes (PERF-005's index gives `dmCount` for free); paginate `/api/projects`.
**Expected outcome** Member-only dashboard at 60 folders and 271 projects at most 100 ms (55 ms is already measured for the folder-less case); at 100 folders and 1000 projects at most 150 ms.
**Expected benefit** Dashboard cost independent of the folder count; the first screen after login in about 100 ms for authors.
**Complexity** M.
**Dependencies** PERF-005, PERF-016.
**Risks** Visibility semantics (folder grants against project membership) must not change: diff the JSON for a matrix of users on a fixed workspace.
**Regression risk** Low to medium. Visibility semantics (folder grants against membership) must not change: compare the JSON for the persona matrix.
**Acceptance criteria** B10 thresholds; byte-identical JSON for the user matrix.
**Test cases** Admin, folder owner, grantee, member-only, no access; renamed and deleted folders.
**Benchmark methodology** B10 and B2. Dataset D5 with 10, 30 and 60 folders and the four personas (administrator, folder owner, member-only, creator), N=30 sequential; the folder-less member-only case is the control.

### PERF-008 · P1 · VERIFIED · M · One FOP JVM serves the whole server: no per-render deadline (agent F, DEP-028), working set 95 to 756 MB and never shrinks, an exit-listener leak, and no admission control

**Category** Build concurrency control and process lifecycle. The hang scenario (a stuck JVM blocks every publish while `/api/health` stays green) is **DEP-028, VERIFIED by agent F, and is not repeated here**; my own measurements agree with its premises (global single lane, no timeout).
**Problem** Besides hangs, the shared JVM has three measurable problems: it grows without bound, leaks a listener per render, and builds from different users are served first come, first served with no visibility.
**Evidence** VERIFIED. (a) **Working set:** 95 MB idle, 263, 401, 463, 502, 511, **756 MB** after the 100-module build, **707 MB idle after the suite**; the JVM is started without heap flags (`vendor/engine/fopd.js:49`), so the maximum heap is a quarter of RAM (12.8 GB on this machine, VERIFIED with `java -XX:+PrintFlagsFinal` on the bundled JRE, which also reports G1 as the collector). (b) **Listener leak:** `MaxListenersExceededWarning ... 11 exit listeners added to [ChildProcess]` in the server log after the 11th render; `fopd.js:103-105` adds `proc.once('exit', onExit)` per render and never removes it. (c) **Single lane:** three simultaneous publishes of three projects finish at 3.1, 3.9 and 4.9 s (server times 1.1, 1.7, 2.4 s): the PDF steps run strictly one after another (`fopd.js:39,92-110`, one `queue`); the per-project serial chain (`services/publisher.ts:55`, keys `:full`, `:preview`, `:configured`) is the only other control; there is no global limit on how many validations, `xsltproc` processes or fallback `java` processes run at once. (d) **Cold fallback cost:** a fresh `java` run of the same FO takes 4.3 s against 1.1-1.7 s warm.
**Root cause** The daemon was designed as a start-up optimisation, not as a managed service.
**Current implementation** `startRenderer()` (`publisher.ts:45-47`) starts and warms one JVM; a render waits for `OK`/`ERR`/exit; on failure the code falls back to a one-shot `java`.
**Recommendation** (1) Per-render deadline with kill and restart (DEP-028). (2) JVM flags from configuration: `-Xmx` (for example the smaller of 25% of RAM and 1-2 GB), a serial or small parallel GC, and a recycle policy (restart the daemon after N renders or when its working set exceeds a threshold, scheduled when idle; the warm-up cost is about 4 s). (3) Remove the per-render listener (one exit handler for the process). (4) A global job queue with per-user fairness, priorities (single-module preview above publish above validation above backup), visible position and cancel (section 9.4); when RAM allows, a second FOP lane, to be measured on B5 before adopting (the 3-simultaneous test is the benchmark).
**Expected outcome** Bounded JVM memory; no warning; a short job never waits behind a long one without the user seeing why.
**Expected benefit** Bounded, predictable FOP memory; a visible queue; no listener warning; a hung render no longer needs a restart (DEP-028).
**Complexity** M.
**Dependencies** DEP-028, PERF-001 (same job runner), PERF-012.
**Risks** A recycle during a build must not drop a render (drain first); a lower `-Xmx` can fail very large publications: derive from the largest tested FO (5 MB FO here took 756 MB of JVM).
**Regression risk** Medium. A recycle during a render must drain first; a lower heap cap can fail very large publications.
**Acceptance criteria** JVM working set stays under the configured cap over 100 consecutive builds; zero listener warnings; three simultaneous publishes show queue positions; a deadline-killed render is retried once and reported.
**Test cases** 100 renders in a row; kill the JVM mid-render; two users, three projects; preview while a long publish runs.
**Benchmark methodology** B5. 100 consecutive builds of D0 with the JVM working set sampled every 250 ms and warnings counted; 3 simultaneous publishes of 3 projects (finish times); repeat with 5 simultaneous after any second-lane change; keep the `-Xlog:gc*` output.

### PERF-009 · P2 · VERIFIED · S · SQLite is opened with WAL only: every autocommit write pays a full sync (3.3 ms, 40x NORMAL); no busy timeout; no boot-time check

**Problem** `vendor/engine/db.js:20-22` sets only `journal_mode = WAL`. The defaults then apply: `synchronous = FULL`, `busy_timeout = 0`, 2 MB page cache, `temp_store` on disk. Most mutations write their audit row, notification or session update as separate autocommit statements.
**Evidence** VERIFIED (3.9): 500 autocommit inserts, median **3.26 ms** (p95 4.97) under the app's settings against **0.08 ms** (p95 0.17) with `synchronous=NORMAL`; 500 inserts in one transaction 9 ms. `busy_timeout` reads 0 (second writer fails at once: agent A's PLT-002). No `quick_check` or `integrity_check` exists in `backend/src` or `vendor/engine` (grep). Cost of a boot-time check, measured on the 39.5 MB scratch database: `quick_check` **41 ms**, `integrity_check` 58 ms, `VACUUM` 0.9 s; scratch WAL file 13.9 MB with no checkpoint on idle. This answers agent I's lead about `db.js:20-22`: confirmed, and the check is cheap.
**Recommendation** At open: `PRAGMA synchronous=NORMAL` (with WAL this keeps the database consistent after an application crash and risks only the most recent commits on a power cut; document the trade-off, keep FULL during migrations), `busy_timeout=5000`, `cache_size=-65536`, `temp_store=MEMORY`; run `quick_check` at boot (about 1 ms per MB measured) and log the result; `wal_checkpoint(TRUNCATE)` when idle and on shutdown; wrap multi-statement mutations in the existing `store.tx`. The database is **not** the bottleneck anywhere I measured (all hot spots are file scans and CPU); no engine change is justified by my data.
**Acceptance** Audit write at most 0.2 ms; a deliberate second writer waits instead of failing; boot logs `quick_check: ok`.

### PERF-010 · P2 · VERIFIED · M · Package scan, `/media` and `dms-import` hold whole uploads in memory (157 MB zip: +455 MB peak)

**Problem** Most upload routes stream to disk (`services/uploads.ts`, used by graphics, JSG, JSS-RWI, packages, xengine), but `routes/importer.ts:36-43` uses `multer.memoryStorage()` with up to 512 MB per file, 5000 files and 1 GB in total ("the platform holds it in memory while it works"), and `routes/project-content.ts:42` uses it for `/media` (64 MB per file), `/pmc/import` and `dms-import`.
**Evidence** VERIFIED: `POST /import/scan` of a 157 MB zip took 730 ms and raised Node RSS from 611 MB to a peak of **1,066 MB** (+455 MB, 2.9x the upload); `dms-import` of 100 files 2.2 s. A 1 GB package would, by the same ratio, need about 3 GB (extrapolation, not measured).
**Recommendation** Move `importer.ts` and `/media` to `diskUpload`; read zip entries through the existing streaming reader (`zipio.ts`); keep memory storage only for small text files; cap concurrent import jobs.
**Acceptance** B7/B9: a 1 GB package import raises RSS by less than 200 MB.

### PERF-011 · P2 · VERIFIED · S · JSS document `GET` runs a full validation on every read (96 ms against 2 ms for an S1000D module)

**Problem** `routes/jss.ts:37-47` returns `report: await validateJss(...)` with every `GET`, and `services/jss/service.ts:201` validates through a fresh xmllint-wasm Worker that compiles the schema each time.
**Evidence** VERIFIED: UHB seed document `GET` 96.0 ms median, `POST validate` 96.8 ms, `PUT` 102 ms (N=20), event-loop stall only 20 ms (the work is off-thread); S1000D module read 2.2 ms.
**Recommendation** Cache the report by content hash and return it with the document (or return it only from `validate` and `PUT`); reuse one long-lived validator worker per schema.
**Acceptance** `GET` at most 10 ms.

### PERF-012 · P2 · VERIFIED · M · No cached or incremental build: unchanged content is re-validated and re-rendered, and the release fingerprint is computed three times per publish

**Problem** A publish of unchanged content repeats the whole gate and the whole render, and the release state is recomputed three times per build.
**Evidence** VERIFIED: builds 2 and 3 of the unchanged 3-module sample repeated the full gate (1.3-2.0 s of a 1.3-3.7 s build) and the full render; at 100 modules the gate alone is 12.6 s. `publisher.ts:295,341,365` each call `releaseStateOf`, which lists the CSDB and hashes every source file. `GET /publish/download` skips the build when the stored fingerprint matches (`project-content.ts:383-391`), but `POST /publish` never does.
**Recommendation** Store the gate result with the fingerprint and skip the gate when it matches; when fingerprint and settings equal the last build and the PDF exists, return it unless the author asks to rebuild; compute the release state once per build. A per-module FO cache is not possible with the single-transform design (note, not a proposal).
**Acceptance** Second publish of unchanged content at most 100 ms and says why; "Rebuild" forces.

### PERF-013 · P2 · VERIFIED · S · Process spawn is 41% of validation time on Windows: one `xsltproc` per module for well-formedness

**Problem** `vendor/engine/validateXml.js:47,73-93` starts one `xsltproc` per module (pool of 6) just to check well-formedness; on Windows `CreateProcess` runs synchronously on the main thread. `catalogEnv()` also rewrites a catalog file on each call.
**Evidence** VERIFIED: `spawn` is **40.7% self time** (1.4 s of 3.5 s) in the 200-module validation profile; 39 ms median per spawn (24-183 ms); 200 files over 6 workers 2.1 s; `catalogEnv`/`writeCatalog` 5.7%.
**Recommendation** Check well-formedness in process (xmldom's SAX parser, or the xmllint-wasm call that parses anyway and reports line numbers) and keep `xsltproc` for the build only; cache the catalog environment.
**Acceptance** 1000-module well-formedness at most 3 s with no process spawn.

### PERF-014 · P2 · VERIFIED · S · Large single bodies stall the thread, and every revision stores a full copy

**Problem** `express.json({ limit: '25mb' })` (`app.ts:45`) parses on the thread; a large module then goes through validation of content, hashing and writes synchronously. `revisions` store the whole module per save (`blobs`: 1,304 rows, 34.1 MB in my scratch database), with no retention (agent A's PLT-007).
**Evidence** VERIFIED (3.5): a 10.2 MB module: create **1,686 ms**, save **1,486 ms**, both entirely a stall; 1 MB: 439 / 376 ms.
**Recommendation** Enforce a documented maximum module size (for example 5 MB) with a clear message, route larger bodies through the worker (PERF-001), compress blobs at rest or store deltas, and apply retention (PLT-007).
**Acceptance** No request above 100 ms of stall at the documented maximum.

### PERF-015 · P3 · OBSERVED · S · `GET /publish/download` can start a full build inside a GET

**Problem** A `GET` can run a full build: a browser refresh or a proxy retry starts another one, and a client or proxy timeout cuts a long build off from the user.
**Evidence** OBSERVED in code, not exercised by a measurement: `routes/project-content.ts:383-391` awaits `publisher.buildPublication` when the PDF is missing or its fingerprint is stale, before sending the file (builds through `POST /publish` are measured, section 3.6).
**Recommendation** Return 409 or 202 with a job id; the UI posts `/publish` first.
**Acceptance** `GET` never builds.

### PERF-016 · P3 · OBSERVED · S · Lists are unpaginated and uncompressed

**Problem** Every list returns everything, uncompressed; the cost grows with the data.
**Evidence** Sizes VERIFIED by measurement: `/api/projects` 107 KB at 200 projects, `/dms` 815 KB, `/pmc` 383 KB, `/explore` 254 KB at 1000 modules (3.2, 3.4); no `compression` middleware (no such dependency in `package.json`, none in `app.ts`); Express's default weak ETag is computed after the body is built, so a 304 saves bandwidth, not server work. Harmless on loopback, noticeable on a LAN.
**Recommendation** `limit`/cursor on `/api/projects`, `/dms` and `/explore`; gzip for JSON above 1 KB when the peer is not loopback.
**Acceptance** First page of 50 items; response at most 20 KB.

### PERF-017 · P3 · OBSERVED · S · The scrypt fallback blocks the thread 144 ms per login when the Argon2 binding does not load

**Problem** If the optional native Argon2 binding does not load on a target machine, every login hashes with `scryptSync` on the event loop.
**Evidence** `core/auth/crypto.js:14-17` (optional `argon2`), `:19-40` (`scryptSync`, N=2^15). VERIFIED: on this host Argon2id verify is 67 ms and **off the event loop** (largest timer gap 16 ms); `scryptSync` costs 144 ms median on the loop. If the native binding fails on a target machine, a login burst (for example 20 users at the start of a shift) stalls the server for about 3 s.
**Recommendation** Use asynchronous `crypto.scrypt` for the fallback; log `usingArgon2()` at boot.
**Acceptance** Login does not move the event-loop histogram above its floor.

### PERF-018 · P3 · OBSERVED · S · WebSocket broadcast does a database-backed authorisation per client per message and has no backpressure

**Problem** Each broadcast message evaluates authorisation (`authz.evaluate`, which reads the project row through the store) once per connected client and never checks backpressure.
**Evidence** `services/broadcast.ts:44-50` loops over all clients and calls `authz.evaluate(c.user, projectId, ...)` for each; no `ws.bufferedAmount` check. VERIFIED no measurable cost at 100 subscribers and about 14 messages per build (build 1.28 s against 1.86 s without subscribers, ELD 387 against 325 ms: within noise); it would matter with hundreds of sockets and chatty events.
**Recommendation** Index clients by project, authorise at subscribe time and on membership events, drop sockets that do not drain.
**Acceptance** 500 sockets: broadcast cost below 5 ms per message.

### PERF-019 · P3 · VERIFIED · S · The PDF compression step is a silent no-op (no Ghostscript bundled)

**Problem** A user can select a PDF compression level but, without Ghostscript, nothing is compressed and the only trace is a log line.
**Evidence** `vendor/tools/ghostscript` does not exist (VERIFIED by listing); `vendor/engine/build.js:273-278` returns early with the log line "PDF compression skipped (Ghostscript not available)" (agent F reports the same; whether the UI setting stays selectable is NOT VERIFIED by me). PDF sizes here: sample 464 KB, 100 modules 2.95 MB (uncompressed images).
**Recommendation** Hide or disable the setting when the tool is absent, or ship the tool; measure output size and time with it before adopting.
**Acceptance** The setting reflects what the build can do.

---

## 5. Strengths (what already performs well, VERIFIED unless marked)

1. **The streaming ZIP64 project export** (`services/zipio.ts`, used by `routes/xengine.ts`) moves a 240 MB payload in 9.8 s with a 17 ms event-loop stall and no memory growth; a 1000-module project (10.2 MB) exports in 1.2 s with a 17-21 ms stall. This is the right design and PERF-006 asks only that the backup use it.
2. **Most uploads already stream to disk** (`services/uploads.ts` `diskUpload`: graphics, JSG, JSS-RWI, packages, xengine); the upload temp folder held 0 files after all my runs, and an hourly sweep exists (`index.ts:29-30`).
3. **No memory leak in the request path**: heap flat (42.6 to 42.4 MB) after 6,000 reads, 200 saves and 200 review comments; RSS plateaus; handles constant (3.10).
4. **Single-module reads are constant-time** (1.6 ms at 3 modules, 1.8 ms at 1000) and small-workspace reads are 1-19 ms (3.1); server boot to first healthy response is 1.34-1.39 s with 3 projects and with about 280 (3.1, 1.3).
5. **Per-project build serialisation** (`serial()`, `publisher.ts:55`): two simultaneous publishes of one project ran one after another and neither failed; in the three-project test all three publishes completed (one after another in the FOP lane).
6. **The warm FOP daemon** is about 3x faster than a fresh JVM per render (1.1-1.7 s against 4.3 s) and the one-shot fallback exists (`build.js`); the `xsltproc` stage is asynchronous `execFile`, and schema validation of a JSS document runs in a Worker (event-loop stall 20 ms for a 96 ms request).
7. **The login hash is strong and, with the native binding, off the event loop** (Argon2id 67 ms, largest timer gap 16 ms).
8. **The publication gate fails closed**: an unchecked module blocks the publication (`publishGate.ts:78-80`) instead of publishing unvalidated content; the weakness is the message and the batch ceiling (PERF-002), not the policy.
9. **The database is not a bottleneck** in anything I measured: prepared statements are cached in `AuthStore`, WAL is on, `quick_check` of a 39.5 MB database costs 41 ms; `dms-import` of 100 modules costs 22 ms each. The cost centres are file scans (PERF-005, PERF-007) and CPU (PERF-001, PERF-003, PERF-004).
10. **WebSocket progress scales to 100 subscribers** with no measurable effect on a build (3.6).
11. **Existing perf harness and gates in the repo**: `backend/scripts/perf-phase17.js` and the baseline table in `docs/S1000D_COMPLIANCE_MATRIX.md:96-113` show that scaling was thought about for S1000D validation and PDF time; the suite below extends that idea (PERF-003 shows the PDF figure does not hold on the Windows toolchain).

---

## 6. Benchmark suite proposal

### 6.1 Principle

A suite a maintainer can run **offline, on one machine, in under 40 minutes**, producing one JSON file per run that a script compares with a stored baseline. Everything it needs is already in the repository or my scratch scripts (not committed by me: this audit changes no repository file): a scratch workspace, an HTTP client on raw `node:http` keep-alive (not `fetch`, which on Windows quantises to 15.6 ms), an event-loop-delay histogram, a child-process memory sampler and a synthetic data generator. No network is needed (`xsltproc` runs with `--nonet`, schemas and the JRE are bundled). RECOMMENDATION: place the scripts in `backend/scripts/bench/` and a baseline JSON per machine class next to them.

### 6.2 Datasets (all synthetic or generated; never customer material)

| Id | Content | Generator |
|---|---|---|
| D0 | repository sample project (3 modules) + JSS UHB seed | the platform's own sample/seed routes |
| D1 | synthetic S1000D project of 50 / 200 / 500 / 1000 modules, 8.9 KB each, one titled figure each, unique codes | `dmgen.mjs` (clones the sample module) |
| D2 | clones of one repo fixture module (`frontend/e2e/fixtures/dm21/5-0`) in 25 / 50 / 100 copies, for the FO stage | `m12c_fixture_clones.mjs` |
| D3 | single modules of 100 KB, 1 MB, 10 MB (padded with `levelledPara`) | `m3_large_dm.mjs` |
| D4 | one project with a 240 MB media payload | `m5b_backup_payload.mjs` |
| D5 | platform with 200-300 projects, a share of them filed in 60 folders, and 4 user personas (admin, folder owner, member-only, creator) | `m2a`, `m10b` |
| D6 | package zip of about 157 MB (20 modules + one large file) | `m9b_package_scan.mjs` |
| D7 | scratch `publisher.db` of about 40 MB | the database produced by D5 and D1 |

### 6.3 Benchmarks, baseline (this audit) and regression thresholds

"Threshold" = a run **fails** when the median of 5 repeats is worse than the value. Thresholds are baseline x 1.25 for latency and memory on a quiet machine, and baseline x 1.5 for CPU-bound builds until a quiet machine is used (reasoning in 6.4). Baselines are from the shared, noisy host of this audit (section 1.1); the first quiet-machine run should replace them.

| Id | Scenario (dataset) | Metric | Baseline (this audit) | Fail threshold | Target (section 8) |
|---|---|---|---|---|---|
| B1 | Read API latency, 3 projects (D0) | seq median and c10 p95 of the 18 endpoints in 3.1 | 1-19 ms / 14-446 ms | any median > 1.25x or +2 ms | unchanged |
| B2 | Project-count scaling (D5, 3 / 50 / 200 projects) | `/api/projects`, `/overview`, `/workspace` seq median | 96 / 167 / 120 ms at 200 | > 1.25x; and slope above 0.6 ms per project | at most 100 ms at 200 |
| B3 | CSDB scaling (D1, 50-1000) | `PUT` one module, `POST` one module, `/summary`, `/release`, `/dms`; ELD max during `POST /validation` | 166 / 551 / 1,481 / 2,202 ms; 5.7 s at 1000 | > 1.25x; ELD max > 100 ms once PERF-001 is fixed | save 20, create 50, reads 100 ms |
| B4 | BREX (D1 200 modules; D3 100 KB, 1 MB) | validation wall with BREX; ELD max | 20.1 s (200); 3.0 s / 168 s | > 1.5x | 5 s / 10 s |
| B5 | Builds (D0 cold, warm, 3 simultaneous; D1 100 modules; 100 consecutive builds) | wall, server phases, JVM peak working set, listener warnings | 5.9 / 3.2 s; 4.9 s; 179 s; JVM 95 to 756 MB | > 1.5x; JVM growth > 10% between build 20 and build 100; any warning | see section 8 |
| B6 | FO stage only (D2) | `xsltproc` wall at 25 / 50 / 100 modules; ratio 50 to 100 | 0.9 / 5.0 / 36.5 s; 7.3x | > 1.25x at 100; ratio > 3x | 100 modules at most 10 s; ratio at most 2.5x |
| B7 | Backup / export / import (D4, D1 1000) | request time, ELD max, RSS delta | backup 9.9 s, 9.4 s, +323 MB; export 9.8 s, 17 ms, 0 | ELD max > 50 ms; RSS delta > 50 MB | stall 50 ms; +50 MB |
| B8 | Responsiveness during jobs (D1 200 modules: validation, build, backup running) | `/api/health` and `/api/auth/me` p99 while the job runs | stall up to 2-81 s | p99 > 100 ms | 100 ms |
| B9 | Upload memory (D6) | peak RSS delta of `/import/scan`, `/media`, `dms-import` | +455 MB for 157 MB | > 1.25x; later > 100 MB | 100 MB |
| B10 | Member-only dashboard with folders (D5 at 10 / 30 / 60 folders, 271 projects) | `/workspace` and `/overview` seq median for the member-only persona | 513 / 1,447 / 3,195 ms | > 1.25x | at most 100 ms at 60 folders |
| B11 | Validator ceiling (D1 600 / 800 / 1000 / 2000 / 5000 modules, one 25 MB module) | `unchecked` count, wall | 800 pass, 900 fail | any `unchecked` > 0 for valid data | 0 up to 5000 |
| B12 | SQLite write cost (D7) | 500 autocommit inserts median; `quick_check` ms | 3.26 ms; 41 ms | > 1.25x | at most 0.2 ms |
| B13 | Login burst (20 concurrent logins) | ELD max, p95 login latency | not measured as a burst; 67 ms per verify, 144 ms scrypt fallback | ELD max > 100 ms | 100 ms |

B1-B3, B5-B7, B10 and B12 each already exist as a measurement script in my scratch folder (names in section 1.2 and the coverage table); B4, B8, B9, B11 and B13 are combinations of those scripts and need a thin runner. Nothing is automated in the repository today.

### 6.4 Threshold justification

* **Interactive-latency norms (general usability guidance, not measured by me):** about 100 ms feels instantaneous, about 1 s keeps the user's flow, about 10 s is the limit of attention. They set the **targets**: editor save and navigation at or below 100 ms, any user-started analysis that stays above 1 s needs progress, and nothing above 10 s without a visible progress bar and a way to carry on working.
* **Regression thresholds come from the baseline's own spread.** On sequential calls (N=100) the p95 is 1.1-1.2x the median (health 1.26 / 1.08; summary 14.97 / 13.16; save 71 / 38 is the exception at 1.9x because writes touch the disk). A 25% margin on the **median of 5 repeats** is therefore above the noise of the measurement and below a change a user can feel for any call above 20 ms. For calls under 2 ms use "+2 ms" because the timer resolution dominates.
* **CPU-bound calls get 1.5x** because on this shared host the same call varied by up to 2x (BREX of one 100 KB module 3.0 and 1.6 s; 200-module validation 5.9 and 3.4 s). On a quiet machine this should be tightened to 1.25x after 10 repeats show the real spread.
* **Super-linear shapes are checked by ratio, not only by absolute time** (B2 slope, B6 ratio 50 to 100, B3 flat per-create time): a stylesheet or index regression usually shows first as a changed exponent.

### 6.5 Offline repeat-run protocol

1. Quiet machine (no other build running; record CPU load, Node version, free RAM, OS, whether on battery). 2. Generate datasets once into a scratch workspace, outside `workspace\`, on a port outside the product's (the repo harness' `boot()` must accept a fixed port). 3. Start the server with the measurement preload (event-loop histogram, forced GC, profile start/stop endpoints). 4. Each scenario: 2 warm-up runs discarded, then 5 measured; report median, p95, max and ELD max. 5. Write one JSON per run with the environment block. 6. A comparison script prints the table above with pass/fail. 7. Run the full suite nightly or before each release candidate, the quick subset (B1, B3 at 200, B6 at 50, B12) on every pull request. 8. Keep baselines per machine class; never compare Windows with Linux numbers (spawn cost and timer resolution differ, section 1.2).

---

## 7. Profiling plan

| Layer | Tool (available offline) | Procedure | Status |
|---|---|---|---|
| Node main thread | `node --cpu-prof --cpu-prof-dir <d>` or the inspector `Profiler` domain started and stopped over an endpoint | run B3 / B4 scenario, 3 repeats; load the `.cpuprofile` in Chrome DevTools offline or with a small analyser (mine: `cpuprof_top.mjs`, self and inclusive per function); look at inclusive time first, then self | **VERIFIED**: I used the inspector method; results in 3.11 |
| Event loop | `perf_hooks.monitorEventLoopDelay` (histogram, 5-10 ms resolution) and `performance.eventLoopUtilization()` | expose on a debug endpoint; ELD max is the stall a user would feel | **VERIFIED** (all stall numbers) |
| GC and heap | `--trace-gc`, `--heap-prof`, `process.memoryUsage()` after `global.gc()`, `resourceUsage().maxRSS` | B7 and B9; look for `arrayBuffers` (Buffer.concat) and external memory | **VERIFIED** for memory and ArrayBuffers; `--heap-prof` NOT RUN |
| Flame graphs | clinic.js (doctor, flame, bubbleprof) and 0x are npm packages | **I could not install packages** (audit rule), so NOT RUN. Offline equivalent: `--cpu-prof` plus DevTools flame view, or `node --prof` and `node --prof-process`, both built in | NOT VERIFIED (tools); the built-in equivalents are VERIFIED |
| `xsltproc` | `xsltproc --profile` (template time table on stderr) and `--timing` | run on the FO input of B6 at 25 and 100 modules, before and after a stylesheet change; compare the **ranking** (the absolute unit of the 1.1.28 build did not match wall time) | **VERIFIED** for 25 modules (`s1000d-loi` first); 100 modules and numbering templates NOT RUN |
| FOP / JVM | **Java Flight Recorder**: `-XX:StartFlightRecording=filename=fop.jfr,settings=profile,duration=120s`; read with `jfr print --events jdk.GarbageCollection,jdk.CPULoad,jdk.ObjectAllocationSample fop.jfr` and `jfr summary`; plus `-Xlog:gc*:file=gc.log` and `-XX:NativeMemoryTracking=summary` with `jcmd <pid> VM.native_memory` | **The bundled JRE cannot do it**: `java --list-modules` shows only `java.base, java.datatransfer, java.desktop, java.logging, java.prefs, java.xml` (no `jdk.jfr`, no `jcmd`, no `jfr` tool). Use a full Temurin 21 **JDK** on the audit machine only, started with the same class path as `fopd.js:49`, fed with the FO files saved by B5 | NOT RUN, tool absent; `-Xlog:gc*` is available in the bundled JRE (core flag) and is the cheap first step |
| SQLite | `EXPLAIN QUERY PLAN` for the hot statements; a debug wrapper that logs statements slower than 5 ms; `PRAGMA quick_check` | the DB did not appear in any profile above 5%, so this is low priority | **VERIFIED** only that no query showed in the CPU profiles |
| OS level | Windows: `typeperf` / `Get-Counter` for process counters, `wpr`/`wpa` (built in) for a spawn-cost and disk trace; Process Explorer is not bundled | sample child working sets (my PowerShell sampler uses `Win32_Process`) | **VERIFIED** (sampler); `wpr` NOT RUN |
| Per-phase timing in production | structured log line per build phase (validate, gate, FO, FOP, PDF) with duration and module count; the progress messages already carry phase names | RECOMMENDATION (also the input for PERF-012's decision) | NOT VERIFIED |

**Order of use.** (1) ELD and `/api/health` during the scenario to find *whether* the thread is blocked; (2) `--cpu-prof` to find *where*; (3) `xsltproc --profile` for the FO stage; (4) JFR only for FOP memory growth and render time; (5) re-run the same B-scenario to prove the change. Always profile with the 1000-module dataset (B3) and the 100-module build (B5/B6): the small sample hides every problem in this report.

---

## 8. Proposed targets and their justification

Targets are proposals; each cites the measurement it improves and the norm it rests on (6.4). "Now" is VERIFIED on this host.

| # | Metric | Now | Proposed target | Justification |
|---|---|---|---|---|
| T1 | Event-loop max stall during any request (validation, gate, backup, import) | 2.0-168 s (up to 81 s for the 1000-module gate) | at most 100 ms | One thread serves all users; a 100 ms stall is the largest delay not noticed as lag. Needs the worker pool or at minimum yielding (PERF-001). |
| T2 | `/api/health` p99 while a job runs | seconds | at most 100 ms | Health and login must survive a long build; same norm. |
| T3 | Save of one module at 1000 modules | 166 ms (p95 285) | at most 20 ms | Editor autosave must not exceed the perception threshold; 20 ms leaves room for disk. 3-module value is already 15 ms. |
| T4 | Create one module at 1000 modules | 551 ms (rising) | at most 50 ms, flat | A batch of 1000 should take under a minute, not 5. |
| T5 | `/summary`, `/release`, `/explore`, `/pmc` at 1000 modules | 1.5 s / 2.2 s / 0.29 s / 0.32 s | at most 100 ms each | They are called on page entry and on every build; they only reflect an index. |
| T6 | Member-only dashboard, 60 folders / 271 projects | 3.2 s | at most 100 ms (55 ms folder-less measured) | First screen after login. |
| T7 | Validation without BREX, 200 modules | 3.4-5.9 s, blocking | at most 2 s in a worker; unchanged re-run at most 0.5 s | Under the 10 s attention limit and non-blocking. |
| T8 | BREX, 200 modules / 1 MB module | 16.7 s / 168 s | at most 5 s / 10 s cold; at most 1 s warm for 200 | Same norms; 1 MB flat module is the stress case. |
| T9 | Schema validation ceiling | fails at about 850 modules | 0 unchecked up to 5000 modules | Real manuals are in the hundreds, large programmes in the thousands (the repo's own baseline uses 500 and 1000). |
| T10 | FO stage, 100 modules | 36.5 s (fixture) / 154 s (synthetic) | at most 10 s; 50 to 100 ratio at most 2.5x | Estimated from the same input without figures (50 modules in 1.6 s); keeps a full 100-module publish near 30-40 s. |
| T11 | Full publish, 100 modules | 179 s | at most 40 s | Under a minute with progress; the user can keep working because of T1. |
| T12 | Publish of unchanged content | 1.3-3.7 s (sample), 12.6 s gate (100 modules) | at most 100 ms and says "up to date" | PERF-012. |
| T13 | Backup of 240 MB | 9.4 s stall, +323 MB RSS | stall at most 50 ms, RSS delta at most 50 MB | Equal to the existing streaming export (17 ms, 0 MB). |
| T14 | Upload of 157 MB package | +455 MB peak | at most +100 MB | Memory proportional to the largest in-flight chunk, not to the upload (PERF-010). |
| T15 | FOP JVM working set | 95 to 756 MB, unbounded | stays under a configured cap over 100 builds (for example 1 GB, RECOMMENDATION to be set from B5 data) | PERF-008. |
| T16 | Autocommit write | 3.26 ms | at most 0.2 ms | `synchronous=NORMAL` measured 0.08 ms. |
| T17 | Login with the scrypt fallback | 144 ms on the loop | 0 ms on the loop | PERF-017. |
| T18 | Boot to healthy | 1.34-1.39 s at 280 projects | at most 2 s at 1000 projects (not measured at 1000: NOT VERIFIED) | Server restart should be invisible. |

---

## 9. Recommendations by theme

### 9.1 Caching

* **CSDB index** per project (identity, size, mtime, hash), updated by writers, invalidated by directory mtime (PERF-005). This single structure removes the repeated `listDms`, makes `assertUnique` a lookup, gives `dmCount` to the dashboard (PERF-007) and a cheap fingerprint (PERF-012).
* **Validation results by content hash**: key (module hash, issue, schema version) for the schema check and (module hash, BREX chain hash) for BREX (PERF-004). Store in `publisher.db` or beside the project; invalidate when the BREX module, the schema pack or the engine version changes.
* **Release state once per request / per build** (it is computed three times per build today, `publisher.ts:295,341,365`).
* **Validator and schema warm-up**: keep one long-lived xmllint-wasm worker per schema (about 280 ms fixed per call today, JSS document `GET` 96 ms; PERF-011).
* **HTTP caching**: strong ETags from the index hash for `/dms`, `/explore`, `/pmc` so repeat polls return 304 without rebuilding the body (PERF-016). Not measured.

### 9.2 Incremental builds

* **Skip when nothing changed** (PERF-012): fingerprint plus settings equal to the last build and the PDF present means return it. Measured cost avoided: the whole gate (1.3-12.6 s) and the render.
* **Validate only changed modules** in the gate, trusting the cache for the rest; the project-level checks (duplicate ids, ICN, applicability, PM) are the part that must still look at everything, and they need the index to be cheap.
* **FO generation is one transform over the whole publication** (`--xinclude` over `_resolved-pm.xml`), so per-module FO caching is not possible without redesigning the stylesheet; the realistic gain is fixing the quadratic templates (PERF-003), then caching at the PDF level.
* **Preview builds** (single module) already exist (`:preview`); keep them free of the whole-project gate where the module alone is what is rendered (the code already narrows the gate to `{ file }`).

### 9.3 Parallel processing

* **Validation**: pool of `worker_threads` (cores - 1) over modules; xmllint-wasm batches by size (about 3-4 MB), well-formedness in process (PERF-013); BREX per module in the pool (PERF-001/004). All embarrassingly parallel per module; expected speed-up near the core count (4 cores here; untested).
* **FOP**: one lane today (3 simultaneous publishes serialised, 4.9 s). A second warm JVM is a RAM/latency trade (each is 0.4-0.75 GB after use); decide from B5 with 3-5 simultaneous users before adopting.
* **`xsltproc`** is single-process by nature; parallelism for the FO stage can come only from splitting the publication into independent books, a content decision, not a code change.

### 9.4 Background job queue with worker processes

One in-process job manager (no external broker; the product is an offline desktop/LAN installation) with: a persistent job record (id, kind, project, user, state, progress, result, error) in SQLite; **worker threads** for CPU-bound validation, BREX and scans, **child processes** for `xsltproc` and FOP (already the case); a global concurrency limit per kind (for example one FOP render, two validations, one backup, one import) and a per-user fairness rule; priorities (single-module preview, then publish, then validation, then backup/export); cancel; a deadline per job with kill and restart (DEP-028); WebSocket progress (already present); and a visible "queued, position 2" message. HTTP handlers for long jobs return 202 with a job id; short ones can still await. This is the structural answer to PERF-001, PERF-006, PERF-008 and DEP-028 together. RECOMMENDATION; no part of it exists today except the per-project `serial()` chain and the single FOP queue.

### 9.5 Database tuning (SQLite)

`synchronous=NORMAL` (with WAL), `busy_timeout=5000`, 64 MB cache, `temp_store=MEMORY`, boot `quick_check`, idle `wal_checkpoint(TRUNCATE)`, transactions around multi-statement mutations (PERF-009); retention or compression for `revisions`/`blobs` (34 MB after about 1,700 revisions in my scratch database; agent A's PLT-007); keep file-system truth for module content (the DB does not need to hold it). I measured no query that needs an index; the hot paths are file scans.

### 9.6 Streaming for large files

Backup through `ZipStreamWriter` with backpressure (PERF-006); disk uploads for the importer and `/media` (PERF-010); read zip entries as streams; hash files with `crypto.createHash` over a read stream when above 1 MB; a documented maximum module size and a non-blocking path for larger bodies (PERF-014).

### 9.7 Pagination and payload size

`limit`/cursor on `/api/projects`, `/dms`, `/explore`, `/pmc`, admin lists and audit queries; summary counters served from the index; gzip for JSON responses to non-loopback peers (PERF-016). The frontend (agent D's section) must adopt the pages; the shell's 30 s unread poll costs 1.3 ms and is not a concern.

---

## 10. Cross-cutting leads for other agents (file and line, as read by me)

| For | Lead |
|---|---|
| A (database) | `vendor/engine/db.js:20-22` only sets WAL; `routes/team.ts:132-141` + `services/backup.ts:40,53` buffer the whole backup (PERF-006); `services/projects.ts:374-380` per-folder disk scan (PERF-007, your PLT-008, reproduced with the platform-size effect). |
| F (deployment) | `vendor/engine/fopd.js:49` JVM started without heap or GC flags; `:105` leaked exit listener; `:39,92-110` single queue and no deadline (your DEP-028); bundled JRE has no `jdk.jfr`/`jcmd` so JVM diagnostics need a JDK; `build.js:277` Ghostscript step is a no-op. |
| I (asked about the Node baseline and `db.js`) | `vendor/pipeline/s1000dtofo/frontmatter-s1000d.xsl:716-757` and `s1000dtofo.xsl:1163-1177`: per-figure whole-document XPath (PERF-003); the 73.2 s baseline for 500 modules (`docs/S1000D_COMPLIANCE_MATRIX.md:96-113`) is not reproducible on the Windows toolchain; `vendor/engine/validateSchema.js:176-186` batch failure reduced to one note on module 0001 (PERF-002). |
| Security agents | `routes/importer.ts:43` and `routes/project-content.ts:42` hold uploads in memory (importer limits: 512 MB per file, 5000 files, 1 GB per package, `importer.ts:38-41`) = a memory-exhaustion lever for any authenticated user; `app.ts:45` 25 MB JSON bodies parsed on the thread; `core/auth/crypto.js:21,35` scrypt fallback on the loop; `services/broadcast.ts:46-48` authorisation per client per message. |
| JSS agent | `routes/jss.ts:46` every `GET` validates (96 ms); `services/jss/service.ts:201` one Worker and schema compile per call. |
| Gate / UX agent | `services/publishGate.ts:78-80` and `services/validation.ts:241-244` produce "not valid against the S1000D schema" for a module that was merely not checked. |
| D (frontend) | `frontend/src/layouts/AppShell.tsx:45` polls every 30 s (cheap); unpaginated lists (107 KB `/api/projects` at 200 projects, 815 KB `/dms` at 1000 modules) are rendered by the client; the build call blocks up to minutes on one HTTP request with progress only over WebSocket. |

---

## 11. Unknowns and limitations

* **Shared, noisy host** (about 12 agents): absolute CPU numbers vary by up to 2x; shapes and ratios are reliable. A quiet-machine re-run is needed before thresholds are set in stone.
* **Node 22.23.2 on Windows**, not the baseline's Node 26.13 (and not run on the packaged `runtime\node.exe`, NOT VERIFIED). Linux/macOS, HDD, and LAN clients were not tested.
* **Builds are single samples** (11 server publishes and one direct `java` run, within the budget of about 12). Concurrency was tested with 2-3 simultaneous publishes only; 5-10 simultaneous users were not.
* **PERF-003 baseline difference is unresolved**: I could not run `perf-phase17.js` (ephemeral port), did not run a 500-module FO build (would exceed the practical time), and did not identify why the repo baseline reports 73.2 s for 500 modules. The 500-module and "about an hour" figures are extrapolations and are labelled so.
* **The 10 MB module schema error** and the **10 MB BREX** result are not explained or finished (aborted at 5 min 20 s).
* **Synthetic data** (flat, repeated ids, one figure per module): real manuals have deeper structure, more figures per module and tables; BREX and FO effects may differ in either direction.
* **Not measured:** JSG engine, large JSS books, the Common Information Repository paths, `/api/admin/*` beyond list timing, 1000 concurrent WebSockets, ZIP64 above 4 GiB, a boot with 1000 projects, an in-product restore (does not exist, PLT-001), Windows installer start-up, antivirus effects on spawn cost, and `quick_check` on a multi-GB database.
* **Tools not run:** clinic.js, 0x (cannot install), JFR (bundled JRE lacks the module), `heap-prof`, `wpr`.
* **No repository file was modified**, no test suite was run (they use ephemeral ports), and the real `workspace\` and ports 4040/4041 were never touched. All scratch processes I started are stopped.

---

## 12. Frontend performance (platform shell, measured by agent D; finding prefix FE)

Section 12 was written by the frontend agent (D) and is reproduced here so that this report holds all performance findings. Its findings carry the prefix FE and are numbered 027-033 inside the frontend series.


**Agent D · finding prefix FE (FE-027 onward).** Scope: bundle composition and initial load, code splitting, `public/` assets, request patterns, DOM size and virtualization, leaks, and a benchmark method with justified targets. Editor internals are out of scope.

**Method.** (1) Production build into a scratch directory (`npx vite build --outDir <scratch>\fe-dist --emptyOutDir`, exit 0, 29.6 s, 2,285 modules); sizes read from the emitted files, gzip and brotli computed with Node `zlib` (`scratchpad\D\chunks.mjs`). (2) A scratch backend on port 4055 served that build; I seeded one S1000D project and grew it to 3, 100 and 500 data modules by cloning the sample (`scale.mjs`), and timed the list endpoints 5 times each (median reported, from Node on the same machine, so no network cost). (3) Playwright with the installed Edge 158 (headless) and, for the first cold-load and editor-open run only, Chrome 158, using Chrome DevTools Protocol for `Network` and `Performance.getMetrics` (JS heap, DOM nodes, event listeners) after a forced GC (`pw-perf2.mjs`, `pw-save.mjs`, `pw-behave.mjs`). Everything ran on localhost on a shared Windows Server 2025 machine with about 12 other agents active, so **absolute times are only indicative; ratios and counts are the evidence**. Numbers with no browser or server involvement (sizes) are exact.

### 12.1 Coverage

| Area | Status | Verification | Limits |
|---|---|---|---|
| Chunk sizes, initial-load closure, duplicates | Inspected | Build and `chunks.mjs` (raw, gzip, brotli) | Sizes of the `dist` tree only; no source-map explorer |
| Static serving (compression, caching, headers) | Inspected | `curl -I` with `Accept-Encoding: gzip, br` on the scratch server | Only the Express static path; no reverse proxy tested |
| `public/` (57 MB, 316 files) | Inspected | `du`-style sizing, file counts, hash comparison of schemas against `backend/schemas` | |
| Cold load, login, dashboard, editor open, save traffic | Inspected | CDP measurements in Edge (Chrome for the first run) | Localhost only; no network throttling; one run each (login/dashboard) |
| List endpoints at 3 / 100 / 500 data modules | Inspected | 5 repeated calls, median | 500 is the largest size; no 5,000 run |
| Heap, DOM and listener growth | Partially inspected | 16 Studio mount/unmount cycles | JSS/JSG editors, pdf.js viewer with a large PDF and the Quick-preview loop were not exercised |
| Re-render profiling (React Profiler) | Not inspected | | No profiler run; findings are from code reading and DOM counts |
| Real network (slow LAN, Wi-Fi) | Not inspected | | NOT VERIFIED: no throttled run |

### 12.2 Measured bundle composition (production build)

**Initial load** (what a signed-out user downloads; `index.html` entry plus static imports):

| File | Raw | gzip | brotli |
|---|---:|---:|---:|
| `assets/index-FrlWPtMj.js` (app, zustand, lucide icons, pages, API) | 345,877 B | 91,460 | 74,142 |
| `assets/react-DQuNv9yH.js` (react, react-dom, router) | 164,583 B | 53,629 | not recorded |
| `assets/index-CvebbDGy.css` | 82,439 B | 16,199 | not recorded |
| **Total** | **592,899 B** | **161,288** | **135,391** |

The entry chunk contains no CodeMirror, pdf.js or pdfmake (checked by marker strings). The browser transferred 595,813 B in 6 requests for the cold login screen, all uncompressed (FE-027).

**Lazy chunks** (loaded on demand):

| Chunk | Raw | gzip | When |
|---|---:|---:|---|
| `EditorPage` (Studio, CodeMirror, xmllint wrapper) | 857,873 B | 268,638 | first S1000D editor |
| `PdfJsViewer` | 343,816 B | about 101.6 K | first PDF view |
| `pdf.worker.min-*.mjs` (pdf.js worker) | 1,375,838 B | not recorded | with the viewer |
| `JssEditorPage` | 103,822 B | | JSS editor |
| `JsgEditorPage` | 71,299 B | | JSG editor |
| `pdf-*.js` (Studio PDF export, dynamic import of pdfmake and fonts) | 61,363 B | | on export |
| `pdf-worker-*.js` | 33,041 B | | on export |
| `xml-*.js` | 32,683 B | | |
| `JsgAncillaryPage`, `AncillaryPage` | 24,471 / 9,584 B | | |
| `pdfmake-CIABZyyV.js` and `pdfmake-CJMTA-YC.js` | 1.86 MB each | | main-thread and worker graph, **both emitted**, about 2.75 MB wasted with the fonts (FE-031) |
| Roboto font data (twice), Helvetica (twice), Courier (twice) | 855 KB each Roboto | about 464 KB gzip each | same cause |
| `public/vendor/xmllint/xmllint.wasm` | 778,732 B | | XSD validation worker |

Vite warns that chunks exceed 1,500 kB. The whole scratch `dist` is 65 MB and the stale `frontend/dist` in the repo is also 65 MB.

### 12.3 Browser measurements (CDP, localhost)

| Scenario | Result |
|---|---|
| Cold load, login screen | Chrome: DCL 73 ms, first contentful paint 104 ms, 6 requests, 595,813 B, JS 2 files / 511,084 B, heap 2.3 MB, 68 nodes. Edge: DCL 76 ms, FCP 116 ms, same bytes. All responses `identity` encoded. |
| Warm reload (HTTP cache) | 6 requests (conditional), 1,409 B, load 55 to 77 ms: assets are served `Cache-Control: public, max-age=0` with ETag, so every reload revalidates every file. |
| Login to dashboard | 9 to 10 requests, 6.7 to 6.9 KB, 917 to 948 ms (the `POST /auth/login` itself 299 to 455 ms), heap 3.1 MB, 355 nodes. Contains **3 x `/auth/me` and 2 x `/notifications/unread-count`** (FE-020). |
| Open S1000D editor, 500 data modules | Chrome 1,609 ms, Edge 2,508 ms to first data-module row. 7 requests, 1,394,218 B including the 858 KB editor chunk. API: summary 580 to 1,274 ms, brex/missing 492 to 595 ms, dms 145 to 154 ms (402,614 B), explore 344 to 364 ms (124,936 B), media 284 to 314 ms, settings 289 to 318 ms. Heap 9.2 MB, **8,859 DOM nodes, 1,347 listeners, 500 `dm-row` elements** (FE-030). |
| One save in the Studio | `PUT /dms/:file` plus 6 GETs (summary, media, settings, dms twice, explore). 3 DMs: 7 requests, 5.3 KB, follow-ups done in about 33 ms. **500 DMs: 528,605 B and about 1.2 s of follow-ups** (FE-029). |
| 45 s idle in the editor | `GET /brex/missing` twice (20 s poll). |
| 65 s idle on `/overview` | Only `GET /notifications/unread-count`, twice (30 s poll). |
| 16 mount/unmount cycles of the Studio route | nodes 12,094 / 19,800 / 19,800 (before / after 8 / after 16), listeners 1,566 / 2,598 / 2,598, heap 13.9 / 15.0 / 15.1 MB. Plateau, no per-cycle growth. |

**List endpoints against data-module count** (median of 5, server on localhost, `scale.mjs`):

| Data modules | `/dms` | `/explore` | `/summary` | `/brex/missing` | `/pmc` |
|---:|---|---|---|---|---|
| 3 | 8.8 ms, 2.3 KB | 10.6 ms, 1.4 KB | 29 ms | 16.6 ms | 14 ms, 2.0 KB |
| 100 | 43.8 ms, 80 KB | 49.2 ms, 25.5 KB | 236 ms | 104 ms | 34 ms, 38 KB |
| 500 | 110 ms, 402 KB | 110 ms, 125 KB | **573 ms** | **258 ms** | 121 ms, 187 KB |

Summary grows by about 1.1 ms per data module and `/brex/missing` by about 0.5 ms per module. Both are called from the editor shell (summary on load and after every save; brex/missing every 20 s while a S1000D project page is open). Creating 400 modules took 77 s (about 190 ms per module), shown only as a data-preparation note.

### 12.4 Findings

#### FE-027 · P2 · VERIFIED · S · Static assets are served uncompressed with no long-lived caching
**Problem** Every response is sent as `identity`, hashed filenames carry `max-age=0` (revalidate every time), and there is no `immutable`. The initial load is 593 KB raw against 161 KB gzip / 135 KB brotli (−73% / −77%); the Studio chunk is 858 KB raw against 269 KB gzip (−69%).
**Evidence** `curl -s -H 'Accept-Encoding: gzip, br' -D - /assets/index-FrlWPtMj.js` on the scratch server: no `Content-Encoding`, `Content-Length: 345877`, `Cache-Control: public, max-age=0`, ETag and Last-Modified present. `backend/src/app.ts:100-107` sets only `no-cache` for `index.html`; `backend/package.json` has no `compression` dependency. The browser run confirms 6 conditional requests on every reload.
**Impact** On a LAN the cost is small (localhost FCP about 110 ms), so this is not an emergency; it matters on slow or shared links, VPN, and for the 1.4 MB first editor open.
**Recommendation** Serve `dist/assets/*` with `Cache-Control: public, max-age=31536000, immutable` and enable gzip or brotli (pre-compress at build and serve `.br`/`.gz` with `express-static-gzip`-style logic, or the `compression` middleware; pre-compression avoids CPU cost on a single-process server). Keep `index.html` `no-cache`.
**Acceptance** `curl -I` on a hashed asset shows `immutable` and `Content-Encoding: br|gzip`; reload issues 0 asset requests.
**Dependencies** Agent F (packaging), FE-017 (security headers in the same middleware).

#### FE-028 · P2 · VERIFIED · S · Background polling and refresh-on-save issue server work that grows with project size
**Evidence** `MissingBrex` polls `GET /brex/missing` every 20 s per open S1000D project page (verified: 2 calls in 45 s). That call costs 17 ms at 3 modules, 104 ms at 100 and 258 ms at 500, so one open tab consumes about 1.3% of one server core at 500 modules (258 ms / 20 s), and each additional editor user adds the same on a single-process Node server. `AppShell` polls the unread count every 30 s (cheap: 5 to 8 ms). `PdfPane` has "Refresh on save" on by default and posts a PDF preview build on every save without debounce (`PdfPane.tsx`; the preview was closed in my save run, so the server cost of the build was NOT measured).
**Recommendation** Ask for `/brex/missing` only after saves and on window focus (or push it over the existing WebSocket); cache it server-side per project revision; debounce the preview refresh (for example 3 s after the last save) and skip it while a build runs.
**Acceptance** An idle editor tab sends no periodic project requests; two saves within 3 s trigger one preview build.

#### FE-029 · P2 · VERIFIED · M · One save triggers 6 follow-up requests whose cost grows with project size
**Evidence** `studioSession.ts:save()` calls `onSaved()` and `refreshProjectData()`; `EditorPage` `onSaved` bumps `savedTick`, `sideKey` and calls the project `reload()`. Result (`pw-save.mjs`): `PUT /dms/<file>` then `GET /summary`, `/media`, `/settings`, `/dms`, `/explore`, `/dms`. At 500 data modules the follow-ups are 528,605 B and finish about 1.2 s after the save (summary 766 ms, dms 900 ms, explore 1,019 ms, second dms 1,166 ms; the requests are issued together and complete between 0.77 and 1.17 s, consistent with one busy server thread). The `/dms` list is requested twice and `/media` and `/settings` have not changed.
**Current implementation** Fire-and-forget refreshes with no invalidation logic.
**Recommendation** After a save, update the one changed row from the `PUT` response (it returns `file`, `hash`, `modified`) and re-request only what the save can change (summary counters, once). Add the query layer of FE-020 so `/dms` is requested once. Longer term, add `ETag`/`If-None-Match` or a `?since=` filter to `/dms` and `/explore`.
**Expected outcome** Save plus follow-up: 2 requests, under 10 KB at any project size.
**Acceptance** `pw-save.mjs` shows at most 2 GETs and under 20 KB for the 500-module project.
**Dependencies** FE-020.

#### FE-030 · P2 · VERIFIED · M · The editor side list and several tables render every row; opening a large project is slow and DOM-heavy
**Evidence** 500 data modules produce 500 `dm-row` elements, 8,859 DOM nodes and 1,347 listeners on first open (at most about 17 nodes and 2.7 listeners per row, an upper bound that includes the rest of the page) and a first usable editor in 1.6 to 2.5 s on localhost, dominated by `summary`, `brex/missing` and the 402 KB `/dms` JSON (about 800 B per data module). `EditorSide` lists all modules without windowing; `Projects.tsx` sorts and filters in memory without virtualization; `PublicationPage` pool, `ValidationPage` findings and `Workspace` are likewise unwindowed. The pdf.js viewer, by contrast, windows its pages correctly.
**Recommendation** Window the DM list and the publication pool (a 60-line fixed-row-height windowing hook is enough, no library needed), paginate or server-filter `/dms` above about 200 entries, and send a slim row (file, title, status, hash) for the list.
**Acceptance** With 500 modules the editor opens in under 1 s on localhost, with fewer than 3,000 nodes in the side panel; with 5,000 modules it stays responsive (NOT YET MEASURED: needs a 5,000-module scratch project).
**Test cases** `pw-perf2.mjs` `editor` phase at 500 and 5,000 modules; scroll test.

#### FE-031 · P2 · VERIFIED · S · The build emits duplicate bundles and one global chunk rule, and the 1.5 MB chunk warning is silenced
**Evidence** `dist/assets` contains `pdfmake-CIABZyyV.js` and `pdfmake-CJMTA-YC.js` (1.86 MB each) and two copies each of the Roboto (855 KB, about 464 KB gzip), Helvetica and Courier font modules, so about 2.75 MB of the 5.5 MB raw is a second copy (pdfmake 1,864,998 and 1,864,996 B; Roboto 855,294 and 855,252 B; Helvetica 24,424 and 24,382 B; Courier 10,810 and 10,768 B). Cause: `studio/export/fonts.ts:42` dynamically imports `pdfmake/build/pdfmake.js?raw` and the font modules, and `fonts.ts` is reachable from two graphs, the page (`pdf-publication.ts:39-47` calls `assemble()` on the main thread when `workerAvailable()` is false or the worker is unavailable) and the worker (`pdf-worker.ts` via `pdf-assemble.ts`, started in `pdf-worker-client.ts:30`); Vite bundles a worker as a separate graph and emits its own copy of each dynamic chunk, and the two copies differ only in the hash and a few bytes of path text (`worker: { format: 'es' }` and the Studio's `pdf-worker-client.ts`). `vite.config.ts` has a single `manualChunks` entry (`react`), `chunkSizeWarningLimit: 1500`. The Studio CSS (`studio/styles/app.css` and `document.css`, 58.7 KB raw) is imported in the entry (`main.tsx:5-6`), so it is in the 82 KB CSS every signed-out visitor downloads and its selectors are global.
**Impact** Only the lazy export path pays for the duplicates, so first-load impact is nil; it costs build time, disk (the installer) and invites accidental cross-graph imports.
**Recommendation** Load the PDF export through the worker only (so pdfmake is bundled once), or configure `worker.rollupOptions` so both graphs share the font and pdfmake modules. Import the Studio CSS from the lazy Studio chunk. Lower `chunkSizeWarningLimit` to about 900 so new oversize chunks are visible.
**Acceptance** One `pdfmake-*.js` in `dist`; entry CSS under 30 KB.

#### FE-032 · P2 · OBSERVED · S · `public/` is 57 MB and holds a second copy of the XSD schemas
**Evidence** `frontend/public`: `schemas` 38 MB (170 files; issues 4-1, 4-2, 5-0, 6, 7 and entity files; largest XSDs about 425 KB), `grammar` 17 MB (131 JSON files plus `index.json`), `brex` 1.9 MB (7), `vendor` 796 KB (xmllint wasm), `samples` 36 KB (5). The schema files equal `backend/schemas` (42 MB) after line-ending normalisation (the two trees differ only in CRLF), and the provenance note `backend/schemas/PROVENANCE.md` documents only the backend copy. Both trees ship in the installer and in `dist` (65 MB).
**Impact** Two sources of truth that can diverge silently (the server validates with one copy, the browser with the other); about 38 MB duplicated in the install; Vite copies 316 files on every build.
**Recommendation** Keep one copy: either serve `backend/schemas` through a read-only route used by the Studio worker, or generate `frontend/public/schemas` from it during the build. Add a check (hash list) to CI. Grammar JSON (17 MB) is only needed by the Studio, so it should only be fetched on use (already the case: not in the entry; fetched on demand, NOT measured).
**Acceptance** One authoritative schema tree; a build step or test fails if the copies differ.
**Dependencies** Agent F (packaging size), agent B (schema ownership).

#### FE-033 · P3 · RECOMMENDATION · S · No performance budget or regression check exists
There is no bundle-size gate, no request-count check and no metrics. See section 5 for a proposal.

### 12.5 Re-render, virtualization and leak review

* **Re-render.** No React Profiler run (NOT VERIFIED). By reading: `PublicationPage` recomputes `describe()` for each row on every render; `Projects` re-sorts on every render of the page; `useAsync` creates a new state object per resolution. None of these was measured as slow at 500 items; the DOM size (FE-030) is the visible cost.
* **Virtualization.** Present only in the pdf.js viewer (visible plus or minus one viewport). Absent in DM list, publication pool, projects table, validation findings, audit log (the audit filter also issues one request per keystroke).
* **Leaks.** Shell-level cleanup of `BroadcastChannel`, blob URLs, WebSocket subscription count, pdf.js listeners and RAF is correct by reading. The 16-cycle test shows a plateau, not growth. Unreleased: the Studio singleton's page-wide listeners and `MutationObserver` (by design, FE-023); IndexedDB drafts are never deleted on logout (FE-024). JSS/JSG editor and pdf.js viewer leaks: NOT VERIFIED.
* **Workers.** `xsd.ts` creates a new Web Worker per validation run and terminates it after the reply (120 s timeout), so each run pays the wasm start-up (778 KB module compile). Reuse of one worker is a possible optimisation; validation latency was not measured because Chrome crashed on the Studio (see below).

**Chrome note.** Headless Chrome 158 crashed the renderer on opening a data module in the Studio (3 of 3 here; agents E1 and G also 3 of 3; Edge 0 of 6 or more). Blocking the xmllint wasm removed it. Root cause NOT VERIFIED. All Studio timings in this file come from Edge; the Chrome run is reported only for cold load, dashboard and editor open (which completed before the crash).

### 12.6 Benchmark methodology and targets

**Scenarios (repeatable, scripts are in `scratchpad\D`):**

| ID | Scenario | Script | Metric |
|---|---|---|---|
| B1 | Cold and warm load of the login screen | `pw-perf2.mjs cold` | requests, bytes, DCL, FCP, heap |
| B2 | Login to dashboard | `pw-perf2.mjs login` | requests, duplicated identity calls |
| B3 | Open the editor at N modules (3, 100, 500, 5,000) | `scale.mjs` plus `pw-perf2.mjs editor` | time to first row, bytes, nodes, listeners |
| B4 | One save | `pw-save.mjs` | follow-up request count and bytes |
| B5 | 16 mount/unmount cycles | `pw-perf2.mjs cycles` | heap, nodes, listeners plateau |
| B6 | Idle 60 s on dashboard and editor | `pw-perf2.mjs idle`, `pw-behave.mjs t1` | background requests per minute |
| B7 | Server list endpoints at N | `scale.mjs` | median ms, bytes |

Run each at least 5 times on an otherwise idle machine, report the median and the spread, and record browser, build hash and N. Add a throttled profile (for example 1.5 Mbit/s, 100 ms RTT through CDP `Network.emulateNetworkConditions`) to represent a remote site.

**Proposed targets (RECOMMENDATION; they are proposals tied to today's measurements, not requirements I found in the repo):**

| Metric | Today | Proposed budget | Why this number |
|---|---|---|---|
| Initial JS + CSS, gzip | 161 KB | at most 180 KB, ratcheted down | Current plus 10% so regressions fail the build; the app is already well split |
| Studio chunk, gzip | 269 KB | at most 300 KB | Same ratchet |
| Identity requests on navigation | 2 per navigation, 3 on login | 0 on navigation, 1 on login | FE-020 removes the duplication entirely |
| Follow-up requests after a save | 6 GET, 528 KB at 500 modules | at most 2 GET, under 20 KB | FE-029 |
| Editor open at 500 modules, localhost | 1.6 to 2.5 s | under 1 s | Nielsen's response-time limits (0.1 s, 1 s, 10 s) put 1 s as the point where the user notices the delay but keeps the flow; INP "good" threshold is 200 ms, LCP "good" is 2.5 s, CLS 0.1 (Core Web Vitals thresholds as published on web.dev; I did not re-fetch the page in this run) |
| Idle background requests per tab | about 5 per minute (3 brex + 2 unread) | 0 to 2 | FE-028 |
| Per-cycle growth over 16 mounts | 0 after the first cycles | 0 | Keep as a regression check |

### 12.7 Unknowns and limitations

* No network throttling, no React Profiler, no 5,000-module project, no large-PDF viewer test, no JSS/JSG heap test.
* The preview-on-save server cost and the XSD validation latency were not measured (Studio crash in Chrome; the preview pane was closed in the save run).
* Server timings are from the same machine as the browser, with other agents running, so absolute values are noisy; counts and bytes are exact.
* Numbers are for my scratch build `fe-dist` (not the repo's stale `frontend/dist`).
