# Phase 3 performance baseline (2026-11-28)

Measured once on `main`'s code (2367c77 plus this branch's instrumentation, which the numbers include; the UI change does not affect them), on
the audit host: Intel i7-6820HQ, 8 logical CPUs, 48 GB, Windows Server 2025, Node 22.23.2, Edge (stable). The server ran as its own process
(`node backend/dist/index.js`, worker-mode jobs, warm FOP in the job workers) on port 4301 (the browser probe on 4302) with a throwaway workspace.
This host is shared and varies up to 2x between runs (audit 04 section 6.4): treat single numbers as +/- 30 %.

Raw results: `docs/phase3/perf-baseline.json` (`backend`, `frontend`, `cpuProfile`). Budgets derived from them: `docs/phase3/perf-budgets.json`
(53 budgets: today 18 meet their target, 35 are over target, none fails its regression guard). To repeat:

```
cd backend && npx tsc -p . && node scripts/bench/phase3-baseline.js --port 4301 --out b.json --md b.md [--cpuprof DIR]
cd frontend && npx vite build --manifest && node scripts/perf/phase3-frontend.mjs --port 4302 --out f.json --md f.md
node scripts/ci/perf-budgets.mjs --backend backend/b.json --frontend frontend/f.json
```

## Headline numbers

| Measure | Small (3 modules) | 1,000 modules | Target |
|---|---|---|---|
| `/summary` seq median / p95, 10 at once p95 | 4.7 / 6.1, 50 ms | 61 / 115, **687 ms** | 100 seq (T5), 200 concurrent (P3-2) |
| `/overview` (dashboard) seq median, 10 at once p95 | 5.5, 46 ms | **165**, **1,442 ms** | 100 (T6), 200 |
| `/release`, `/dms`, `/explore`, `/pmc` seq median | 2-5 ms | 49-64 ms (p95 73-103) | 100 |
| the same, 10 at once p95 | 18-33 ms | 492-791 ms | 200 |
| save one module, seq median / p95 | 20 / 50 ms | 20 / 27 ms | 20 (T3) |
| create one module, seq median, 10 at once p95 | 40, 530 ms | **95**, **1,010 ms** | 50 (T4), 200 |
| event-loop stall (max) during those sets | 447 ms (creates) | **1,709 ms** (overviews), 956 (creates) | 100 (T1) |
| package import, 1,000 modules | | **18.2 s, event loop blocked 10.6 s** | well under 60 s, no stall over 100 ms |

| Validation, 200 modules, BREX | ms |
|---|---|
| first run of a fresh server (cold worker, schemas, BREX) | 6,786 |
| fresh run, warm worker (median of 3) | 1,276 (no BREX 989) |
| re-run of unchanged content ("cached") | **1,256** (target 500, T7) |
| re-run after one module changed | 1,330 |

| PDF build (wall, through the API) | first | rebuild, nothing changed | stages of the rebuild (validate / XSLT / FOP) |
|---|---|---|---|
| S1000D sample (3 modules, 419 KB) | 6.2 s (FOP 4.7 s: cold JVM) | **2.2 s** (target 0.1 s, T12) | 0.9 / 0.17 / 1.1 s |
| JSS Land sample (600 KB) | 2.7 s | 2.1 s | 0.24 / 0.17 / 1.6 s |
| JSG handbook sample (104 pages) | 7.3 s | 6.4 s | 0.3 / 0.38 / 5.7 s (two FOP passes) |
| S1000D 100 modules (1.5 MB) | 11.2 s | 10.5 s | **3.5** / 1.7 / 5.1 s |

WebSocket fan-out: a presence change reaches the last of 50 sockets (10 people x 5) in 2.3 ms median (p95 2.4); a check-out notice in 5.4 ms; none missed.

Memory (server process): 144 MB RSS idle after boot, 242 MB after the 1,000-module API set (heap 144 MB), back to 98-110 MB later. Job workers
120-293 MB each; the FOP JVM of a build worker 590-600 MB working set after the builds (one JVM).

Browser (Edge): initial JS+CSS 144.6 KB gzip (3 files; budget 180 KB). Cold first load until ready: overview 0.7 s (LCP 0.56 s), project home 0.3 s,
Studio 1.0 s, JSS 0.9 s, JSG 1.0-1.2 s with a 354-416 ms long task. Interaction (Event Timing, INP-style worst): typing 32-40 ms, module switch
24-64 ms, panel toggles 24-56 ms in all three editors. Quick preview until the draft is drawn: Studio 7.4 s, JSS 5.5 s, JSG 10.0 s. Studio heap
8.8 -> 15.2 MB after 10 module switches (after GC; DOM nodes fell, listeners +63).

## Ranked hotspots (where time and memory go, with evidence)

Ranking: what blocks other users or the author most, times how often it happens. The CPU figures are from the profiled run
(`--cpuprof`, server main thread, 190 s, 63 s busy; `cpuProfile` in the JSON).

1. **Package import blocks the server thread for 10.6 s at 1,000 modules** (18.2 s total). Evidence: `eventLoop.after-import-1000.max` = 10,628 ms;
   the route's database time is 980 ms; the profile's top native costs over the run are `stat` 8.8 s, `fsync` 6.7 s, `readFileUtf8` 4.1 s, `open`
   1.6 s, `rename` 0.9 s - per-file synchronous stat/write/fsync/rename on the request thread. Every other author waits that long. Move the import's
   file work to the job worker (as validation and builds already are) or make it asynchronous with yields; batch the fsyncs (one directory fsync
   per batch). Targets T1, T4.
2. **Project reads at 1,000 modules are synchronous full scans: 50-165 ms each, and 10 at once queue behind each other (p95 0.5-1.4 s, event-loop
   stalls 0.5-1.7 s).** Evidence: `apiLarge` seq vs conc; Server-Timing shows only 0.2-1.8 ms of that in SQLite, so it is file and XML work: in the
   profile `listDms` 1.4 s and `summaryFrom` 1.3 s self (`services/csdbIndex.ts`), `statSync` per module (`csdbIndex.ts` 144/260, `pm.ts` 74/93),
   the PM re-parsed by `vendor/engine/pmc.js` (`decodeText` 1.9 s, `parseAttrs` 0.9 s, `parseXml` 0.8 s), `structuredClone` of memoised parse
   results on every read (4.2 s; `pm.ts` `readModel`/`parsedPm`, also `brex.ts`, `jss/service.ts`), `path.join`/`normalize` 3.3 s, and
   `release.ts` `fingerprintOf`. `/overview` is the worst (165 ms seq) because it aggregates every project. Fix: keep the CSDB index in memory per
   project, invalidated by the writers (one stat of the directory instead of one per file), hand out frozen results instead of cloning, cache the
   parsed PM by mtime, compute the release fingerprint once per request. This is the P3-2 blocker: at 100 users these queue. Targets T5, T6, P3-2.
3. **Creating a module costs 95 ms at 1,000 modules (40 ms at 3) and stalls the loop up to 0.96 s when 10 arrive at once.** Evidence:
   `apiLarge.create`, `loop.large.create`; in the profiled run the server process started an `xmllint-wasm` worker thread per check, each about 600 ms
   of mostly WebAssembly instantiation and thread bootstrap (`xmllint-node.js` `ja`/`ia`, `compileForInternalLoader`), plus the uniqueness scan
   over the CSDB. Fix: one long-lived validator per schema set (audit 9.1 "validator warm-up"), uniqueness from the index. Target T4.
4. **Validation re-runs do not get cheaper: unchanged content takes 1.26 s, the same as a fresh run; the publish gate re-validates on every build
   (3.5 s of a 10.5 s rebuild at 100 modules, 0.9 s of 2.2 s for the 3-module sample).** Evidence: `validation.cached` vs `warmFresh`,
   `pdf.*.warm.stages.validate`. The per-module result cache is either not consulted on these paths or the job overhead (worker round trip, project
   scan, BREX chain load) dominates. Fix: key results by module hash + schema + BREX chain hash and answer an unchanged project without entering the
   worker; let the gate trust the cache and re-check only project-level rules. Targets T7, T12.
5. **A rebuild of unchanged content redoes everything** (2.2 s sample, 10.5 s for 100 modules; target 0.1 s and "up to date", PERF-012). Evidence:
   the warm build timelines run validate, XSLT and FOP again. Fix: fingerprint (content + settings + engine version) equal to the last build and the
   PDF present -> return it.
6. **FOP dominates the PDF time and the JVM dominates memory.** FOP is 50-90 % of every build (5.1 s of 10.5 s at 100 modules; 5.7 s of the JSG
   handbook, which renders twice to put the page count on the certificate); the first build after a server start pays a cold JVM (4.7 s of FOP for
   the 3-module sample, vs 1.1 s warm). One build worker's JVM holds 590-600 MB after the builds; the job workers themselves 120-290 MB. Fix
   candidates: pre-warm the build worker's JVM at start (it is lazily warmed today), a single-pass page count for JSG (`fo:page-number-citation-last`
   or a cheaper count pass), JVM heap cap per T15, and a quick-preview path that renders only the module in hand (Studio preview 7.4 s, JSG 10 s).
7. **The first validation of a server costs 6.8 s for 200 modules** (worker spawn, schema compile, BREX). Pre-warm the validation worker at start
   or after idle; target T8 (5 s).
8. **The existing statement timing (WP-28) itself costs CPU**: `services/metrics.ts` Proxy `get` trap and the per-call closures show 2.4 s self time
   in the profile (`metrics.js:94`, `:99`), about 4 % of the busy time, because every `prepare()` returns a Proxy whose trap allocates a wrapper on
   each property access. Wrap the three methods once per statement instead of a Proxy. Cheap, low risk.
9. **Large list payloads**: `/dms` returns 795 KB for 1,000 modules (the full list), `/explore` 230 KB, `/pmc` 271 KB; JSON stringify shows 0.64 s
   in the profile. The pages already use the paged/slim forms in places (WP-17/18); make the slim, paged form the default and add ETags (audit 9.1).
10. **Browser**: the JSG editor's opening long task (354-416 ms) and the JSS one (90-215 ms) are the only long tasks on first load; Quick preview is
    server-bound (items 5-6). The bundle is within budget; the lazy chunks are large (pdfmake 448 KB and its Roboto font 453 KB gzip, the pdf.js
    worker 394 KB, the Studio 270 KB) but load only on demand. Typing and switching are well under INP "good" (200 ms).

Not a hotspot today: SQLite (0.1-2.4 ms of any read; the 1,000-module import's 980 ms is the one large share), WebSocket fan-out (2-6 ms to 50
sockets), save at 1,000 modules (20 ms), memory growth across module switches (bounded; DOM nodes fell).

## Notes on method

* Latencies are measured by the client over keep-alive `node:http` (fetch quantises to 15.6 ms on Windows). "10 at once" = 10 identical requests
  in flight, per-request latency, `--rounds 5`.
* The per-endpoint event-loop figure is the max of the server's delay histogram (10 ms resolution) over that endpoint's own measuring window.
* PDF stage timings come from the build's own log lines (`/api/projects/:id/jobs/:jobId`): validate = the gate, XSLT = front matter, map, image
  index and FO, FOP = PDF; `engineXslt`/`engineFop` are the engine's own breakdown where it prints one (S1000D, JSS).
* Peak JVM memory is sampled every 3 s during a build through `GET /api/admin/perf?fresh=1` (a PowerShell process list: about 0.6 s per call, off
  the event loop). The first profiled run sampled every 1.5 s and showed one JSG build at 25 s instead of 6-7 s; the published numbers come from the
  run with the slower sampling and no profiler.
* `GET /api/admin/perf` with the process list is itself slow (mean 0.63 s, from PowerShell start-up); `?os=0` answers in about 1 ms.
