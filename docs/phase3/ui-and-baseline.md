# Phase 3, steps 1 and 2: small UI changes, performance baseline and instrumentation

Change record (DECISIONS.md: every area keeps one). Branch `worktree-agent-ac42b7ab89bb00312`, started from `main` 2367c77.
Owner process rule P3-7: targeted checks only; the comprehensive verification is owed at the end (list below).

## 1. Small UI changes (owner)

| Request | Done |
|---|---|
| Remove "Offline · on-premises · v2.0.0 · Server connected" and similar status text that only states that | Global sidebar foot removed (AppShell). Project status bar: "Renderer ready" / "Renderer starts with the first build" and "Offline · on-premises" removed; it keeps the project's format and data module count, and shows "Server not answering" (danger dot) only while the connection is lost. Publication page status: "Renderer ready" after a build now reads "Built" (it was the build state, mislabelled). |
| Keep the version reachable for support | Account menu > **About Agastya** (`data-testid="about-agastya"`) opens the app dialog: product name, version, "Offline, on-premises authoring and publishing for S1000D, JSS and JSG". The Administrator's Licence card still shows the version and deployment. |
| Remove the Wi-Fi / offline icon and the listeners that only fed it | `NetState` (`data-testid="net-state"`) removed from the global top bar. The project shell's `GET /publish/status` request on every project open (it only fed "Renderer ready") removed, with the client function `contentApi.rendererStatus`. The connection banner (`SessionDialogs.tsx`, `server-unreachable`) and its probe (5 s while lost, browser offline/online events) are unchanged: they protect work and were not only feeding the icon. No new polling. |
| Settings appears twice; keep one (the account menu) | The sidebar item Platform > Settings is removed for every role. `/settings` and its tabs are unchanged and reached from Account menu > Account settings (and the Ctrl+K switcher lists "Settings"). The administrator's "items waiting" count that the sidebar item carried moved to the account button (badge, also in its accessible name) and beside "Account settings" in the menu (Overview and Settings > Approvals still show the queues). For non-administrators the "Platform" group heading no longer appears (it held only Settings). |

Not changed on purpose: the sign-in card footnote "Offline · on-premises" (AuthScreens), the Administrator header and Licence card, the admin Oversight health list (Server connected / Network offline): these are not shell status bars, and the Oversight list is an administrator's health view, not a status line.

Files: `frontend/src/layouts/AppShell.tsx`, `ProjectShell.tsx`, `shellSlots.tsx` (comment), `frontend/src/components/AccountMenu.tsx`,
`frontend/src/styles/shell.css`, `frontend/src/api/index.ts`, `frontend/src/pages/project/pubChrome.tsx`.
Tests changed deliberately: `frontend/e2e/00-platform.spec.ts` (admin and author navigation no longer list Settings; the author test is renamed and now
also checks: no Settings link, no offline/version foot, no `net-state`, Account settings opens `/settings/account`, About shows a version),
`frontend/e2e/visual/keyboard.spec.ts` (the account menu's arrow-key order now has About between Account settings and Sign out).
Parity: `docs/audit/baseline/parity-explanations.json` rows for the renamed test, the `net-state` test id and the sidebar Settings item (`npm run check:parity` PASS).

## 2. Performance baseline and instrumentation (decision P3-3: no rewrite, optimise in place)

### Instrumentation that stays in the product

* `Server-Timing` on every `/api` answer: `db;dur=<ms>;desc="<n> statements", total;dur=<ms>` (total = time to the first byte). The database time
  is counted per request through the request context that already exists (`services/requestContext.ts`, one AsyncLocalStorage that every request
  already enters), so there is no new async hook; the cost is two additions per statement and one header per answer.
* `services/metrics.ts`: a ring of the last 512 API requests (route template, method, status, ms, db ms, statements) and per-route totals bounded to
  300 templates; both reset with the existing metrics window (`POST /api/admin/metrics/reset`). Route templates only (never ids or file names).
* `GET /api/admin/perf` (`requireAdmin`, read-only; `services/perfReport.ts`): event-loop delay histogram (p50 to p99.9, mean, stddev, max), process
  memory (RSS, heap, external, array buffers), live gauges (WebSocket clients, presence entries), job queue depth and running per lane, the renderer:
  each FOP JVM (in-process or a job worker's child) and each job worker with its working set, the slowest recent requests and the routes with the
  highest mean. The process list is read asynchronously (PowerShell CIM on Windows, `ps` elsewhere), with a 5 s timeout, cached 10 s; `?os=0` skips it,
  `?fresh=1` reads it now (the benchmark samples the JVM while a build runs), `?top=N` (1-100).
* Guard tests: authz-matrix snapshot regenerated after review (one row, `GET /api/admin/perf`, the same policy as `/api/admin/metrics`); the route is
  a GET, so wp29 needs no audit entry; wp11, wp10 (no import cycle: metrics -> log -> requestContext) pass. Own test: `backend/test/phase3-perf.test.js`.

### Benchmarks (repeatable)

* `backend/scripts/bench/phase3-baseline.js`: runs the REAL server as a child process (`node dist/index.js`, worker-mode jobs) on its own port and a
  throwaway workspace; sections api / validation / pdf / ws; JSON plus a markdown summary; `--cpuprof DIR` runs the server under `--cpu-prof`
  (summarise with `backend/scripts/bench/cpuprofile-top.js`).
* `frontend/scripts/perf/phase3-frontend.mjs`: Playwright on Edge against the real server serving `frontend/dist` (build with
  `npx vite build --manifest` to name the chunks; without the manifest the chunks are listed by file).
* `docs/phase3/perf-budgets.json` + `scripts/ci/perf-budgets.mjs` (rule tests `scripts/ci/perf-budgets.test.mjs`): each budget has `max` (regression
  guard from the baseline: FAIL) and `target` (the audit's or Phase 3's goal: OVER TARGET, reported). Wired into `scripts/ci/gate.mjs` as the
  `perf-budgets` stage of the nightly and release profiles (ports `PERF_BENCH_PORT` 4310, `PERF_FE_PORT` 4312); not run in this phase.

Results: `docs/phase3/perf-baseline.json` and `docs/phase3/perf-baseline.md` (ranked hotspots).

## Dependencies

None added. The frontend probe uses `@playwright/test` (already a dev dependency) and the installed Edge; the backend bench uses `ws` (already a
dependency) and the backend's own ZIP writer.

## Decisions taken here

* The Settings route stays `/settings` (bookmarks, tests and the e2e specs use it); only the duplicate entry point is gone.
* The administrator's waiting count is not dropped with the sidebar item: it moved to the account button.
* `Server-Timing` is sent to every signed-in client, not only administrators: it carries durations and a statement count, no SQL, no paths, and it is
  what the browser's own developer tools show. If that is unwanted, gate it behind `config.mode === 'local'` or an admin session later.
* The perf route reads the process list only on request, never on a timer.

## Possible regressions to watch

* Visual baselines of the global shell (overview, workspace, settings, administrator) and the project shell (project home, release, publication,
  validation) change: no sidebar foot, no Settings item, no offline icon, shorter project status bar. They need re-capture after review
  (`frontend/e2e/visual`), which the comprehensive verification owns.
* Any e2e step that clicked the sidebar's Settings link (none found by grep; the specs go to `/settings` by URL or through the account menu).
* `zz-layout-strict` / `zz-responsive-layout` measure the shells; the sidebar is one item shorter.
* `res.writeHead` is wrapped for every `/api` answer (to set Server-Timing before the head is sent). A route that writes its head with an unusual
  call shape would still get the header or none; it never blocks the answer.

## Checks run (targeted)

See the hand-back; summary: frontend `tsc`, `lint:theme`, `check:parity`, `check:cleanup`, root lint; backend `tsc`, `phase3-perf.test.js`,
`authz-matrix`, `wp29-audit-coverage`, `wp11-integrity`, `wp10-seams`, `wp28-team-server`; `scripts/ci/perf-budgets.test.mjs`.

## Checks owed for the final verification

* Full e2e (especially `00-platform.spec.ts` with the changed tests, `wp22-navigation`, `wp35-redesign`, `zz-layout-strict`, `zz-responsive-layout`,
  `zz-theme-states`) and the visual suite (`playwright.visual.config.ts`, keyboard spec), with baselines re-captured where the shells changed.
* Frontend vitest (no unit test referenced the removed elements; run anyway).
* The full backend suite (Server-Timing touches every API answer).
* `npm run gate` (pr) and one `gate:nightly` to exercise the new `perf-budgets` stage end to end.
