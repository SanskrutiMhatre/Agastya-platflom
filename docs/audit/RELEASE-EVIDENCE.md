# Release evidence (WP-30)

Every production-readiness gate of `12-ENTERPRISE-READINESS.md` section 8, with its status on branch `wp30-release-qa` (based on main
`a79e6b3`), measured on **2026-11-28** on the shared build machine (Intel i7-6820HQ, 8 logical cores, Windows Server 2025, Node 22.23.2
running the tests; other agents were building and testing on it at the same time).

**Rule used.**

* **PASS**: every criterion of the gate was measured here and met. The evidence is a command run on this branch, named in the row.
* **FAIL**: a criterion was measured and not met, *or* the coverage that could be produced here falls short of what the gate asks. The reason
  is given.
* **EXTERNAL**: the gate needs something this agent did not have or was not allowed to do. Examples: a clean VM, a disabled network adapter, a
  real code-signing certificate, a release candidate from the release gate, real users, a person with a screen reader, or a test that writes to
  the registry (not allowed in this run). The exact procedure is given, and whatever could be done here is listed as partial evidence.

Nothing is counted from an earlier package's log unless it was re-run on this branch; where a row cites an earlier package, it says so.

## Counts

| Area | PASS | FAIL | EXTERNAL |
|---|---|---|---|
| G-SEC (12) | 5 | 4 | 3 |
| G-REL (9) | 3 | 1 | 5 |
| G-PERF (4) | 0 | 0 | 4 |
| G-OFF (4) | 0 | 1 | 3 |
| G-DEP (6) | 0 | 1 | 5 |
| G-UX (6) | 1 | 2 | 3 |
| G-Q (6) | 2 | 1 | 3 |
| **Total (47)** | **11** | **10** | **26** |

The 10 FAILs are G-SEC-2 (a measured shortfall), G-Q-2 (a measured shortfall), and eight coverage gaps: G-SEC-3, G-SEC-7, G-SEC-8, G-REL-2,
G-OFF-2, G-DEP-4, G-UX-2 and G-UX-5. In those eight, what was run passed, but less was run than the gate asks. QA-006a (base-14 fonts not
embedded) is an open product defect found by this package; no gate row covers it, so it is listed separately below.

The release gate itself (`npm run gate:release`: G-Q-1, G-Q-5, and `readiness.mjs` with a release folder) was **not** run by WP-30. By
instruction, the lead runs it on the merged branch. Every number below comes from a single file run on its own
(`node --test --test-concurrency=1 <file>`, or one Playwright spec on port 4111).

## What WP-30 added, and what it found

* **PDF regression (QA-006)**:
  * Files: `backend/test/wp30-pdf-regression.test.js`, helpers in `backend/test/pdfregress.js`, baselines in
    `backend/test/fixtures/pdf-regression/`.
  * Books: S1000D plain and Xignal, JSS UHB, JSS-0251 (from the customer's RWI package) and the JSG UHB.
  * Raster check: 3 pages per book, rendered by pdf.js. At most 0.2 % of pixels may differ, with dates masked.
  * Also checked: every font embedded, and every link and bookmark resolves. Page count, fonts, links and bookmarks must equal the baseline.
  * A sensitivity case (a changed document) must fail, at 0.312 %. A specificity case (only the date changed) must pass, at 0.000 %.
  * Baselines change only through `node scripts/pdf-baseline.js --update`.
  * Result: 12/12, wired into the gate's `pdf-smoke` stage.
* **QA-006a, open defect (FAIL finding)**: FOP leaves the PDF base-14 faces **unembedded**, so a viewer substitutes its own font:
  * S1000D plain: Courier, Courier-Bold, Helvetica, Helvetica-Bold, Helvetica-Oblique.
  * S1000D Xignal: Courier, Helvetica-Bold.
  * JSS: Helvetica-Bold.
  * JSG: Helvetica-Bold and its whole body text in Times-Roman, Times-Bold and Times-BoldItalic.

  The first version of the check could not see this. With pdf.js's standard font data loaded, pdf.js reports an unembedded base-14 face as
  having a file. Fonts are now read from a document opened without that data, and a hand-made PDF with unembedded Helvetica is reported as
  not embedded. The lists are a ratchet (`knownNotEmbedded` in each manifest): a new unembedded face fails the test, and the list may only
  shrink. Fix: map those names onto embedded, metric-compatible faces in the FOP configuration, then re-take the baselines.
* **JSG output has 0 internal links and 0 bookmarks** in 402 pages. S1000D has 52 and 69 links, JSS 85 and 315. This is recorded in the
  baseline as an observation, not as a gate failure: no gate requires links in JSG.
* **Chaos (QA-008)**: `backend/test/wp30-chaos.test.js`, in the `heavy` plan. It found and fixed three real defects:
  * A kill during a PDF build left a 0-byte or torn PDF **under its final name** (S1000D, JSS, preview, configured builds, JSG).
  * A kill during the pre-migration safety copy left a torn `publisher-before-<step>.db` under the canonical name.
  * A cut-off backup left `.zip.partial` files and `.staging-` folders that were never removed.

  Builds and copies now write to a temporary name and are committed with fsync and rename. Stale temporary files are swept at start, and by
  the next backup after 10 idle minutes.
* **Air gap (G-OFF)**: `backend/test/wp30-airgap.test.js`, in the `heavy` plan, plus the `G-OFF-2` row of `readiness.mjs`.
* **Soak (G-REL-7)**: `backend/scripts/soak.js`.
  * Found: **resident memory of the server grows while its JS heap does not**.
  * 30-minute run: RSS went from 121 to 195 MB and private bytes from 129 to 200 MB, while the heap stayed between 24 and 41 MB.
  * Growth was linear at about 3 MB a minute until minute 27, then flat for the last 3 samples.
  * 30 minutes cannot tell a leak from an allocator or cache reaching its working size. The 24-hour soak is what decides it (G-REL-7 below).

## G-SEC Security

| Gate | Status | Evidence / reason / procedure |
|---|---|---|
| G-SEC-1 TLS on every non-loopback listener | PASS | `wp26-network` 9/9. Mode A binds loopback only, and a network address is refused. Mode B on the network refuses to start without TLS, and over TLS it serves HTTPS only on the port, with Secure cookies, HSTS and wss. The `Get-NetTCPConnection` listener scan on an *installed service* is part of G-DEP-1's VM run. |
| G-SEC-2 credentials not derivable | **FAIL** | `wp03-auth` 11/11: temporary passwords come from a CSPRNG, 200 generated passwords are distinct, none is `username@year`, and the old guessable form is refused. **But the entropy is short of the gate's 60 bits:** the random part is 8 characters from a 31-symbol alphabet (`[a-hjkmnp-z2-9]`), which is about 39.6 bits (`policy.tempPasswordFor`). It is mitigated by single use (onboarding gate) and by the sign-in throttle, but the criterion is not met. Fix: 12 characters (about 59.4 bits) or 13 (about 64.4 bits). |
| G-SEC-3 session limits | **FAIL** (coverage) | `wp03-auth`: the 12 h absolute limit (expiry and `Max-Age=43200`) and the 30 min idle limit (a session idle for 31 min gets a 401 with code `SESSION_IDLE`; background requests do not count as activity); limits are configurable (`security-policy` test). The gate's **n = 20 injected-clock timing points** are not scripted: one point each side. |
| G-SEC-4 audit integrity | PASS | `wp29-audit-trail` 11/11. An edited row, a deleted middle row, a forged row and a row inserted outside the chain are each detected. Deleting the newest 10 rows is detected against the checkpoint in the backup folder. |
| G-SEC-5 audit coverage | PASS | `wp29-audit-coverage` 2/2 (every state-changing route audits or is allow-listed with a reason); `routes-guarded` 1/1. |
| G-SEC-6 data/state folder ACLs on an install | EXTERNAL | Needs an installed copy. Run `node scripts/ci/readiness.mjs --install "<install dir>"` (row G-SEC-6, `icacls`) on a clean VM after a per-machine install. Not run: no installation was made on this machine. |
| G-SEC-7 secrets never in logs, bundle, audit | **FAIL** (coverage) | Partial evidence: `wp29-audit-trail` (structured logs: seeded secrets absent) and `wp03-auth` (audit metadata keeps fingerprints and drops secrets). The gate asks for one canary run through login, reset, **CSV import, backup and support bundle**, with every output grepped. No single test does that. The support-bundle canaries live in `scripts/release/host.test.mjs`, which was not run here (it writes a throwaway HKCU key). |
| G-SEC-8 security headers and CSP | **FAIL** (coverage) | `wp03-auth` "security headers on the API and on the application" passes, and CSP is `default-src 'self'`. **0 CSP violations across ten routes in a browser is not collected**: no spec listens for `securitypolicyviolation` or console CSP reports. Fix: one Playwright fixture that fails on a violation, over `e2e/visual/routes.ts`. |
| G-SEC-9 brute force | PASS | `wp03-auth`: (a) after 10 wrong passwords from 10 addresses, the 11th attempt, even with the right password and from a new address, gets 429 with Retry-After; the counter is in the database; the burst is a security event (`wp29-audit-trail` RES-004). (b) One address cycling through usernames is limited (429 within 101 attempts). |
| G-SEC-10 authorization coverage | PASS | `routes-guarded` 1/1, `rbac` 7/7, `authz-matrix` 6/6. |
| G-SEC-11 supply chain | EXTERNAL | Needs the real code-signing certificate and a time-stamp authority (owner, decision D4). Procedure: build with `AGASTYA_SIGN_THUMBPRINT=<thumbprint> npm run package:win -- --release`, then `node scripts/ci/readiness.mjs` (rows G-SEC-11a, G-SEC-11c, RES-005). Partial evidence: `scripts/release/release.test.mjs` 8/8 (signing, manifest, tampering, SBOM with throwaway certificates in temp folders). Row 11b (bundled Node EOL) is met: the pin `packaging/product.json` is Node 24.22.3, end of life 2028-04-30, about 17 months away against a 12-month minimum. |
| G-SEC-12 known-vulnerability scan | EXTERNAL | Needs the npm advisory database: `npm audit --omit=dev` in `backend/` and `frontend/` on a networked machine, or an imported advisory mirror. Not run: no network by rule. |

## G-REL Reliability

| Gate | Status | Evidence / reason / procedure |
|---|---|---|
| G-REL-1 backup/restore round trip | PASS | `wp12-backup-restore` 7/7: every table row for row, every file byte for byte, the same people can sign in. Refusals (truncated, changed, added entry, newer build) are named. A backup taken during saves restores consistently. The audit chain survives backup and restore (`wp29-audit-trail`). RTO: WP-28's drill measured 8.5 s on 1 MB; the customer's own figure comes from the first drill (OPERATIONS.md 13). |
| G-REL-2 crash safety | **FAIL** (coverage) | `CHAOS_KILLS=25 node --test test/wp30-chaos.test.js`: 4/4 in 23.8 min, **100 hard kills of the whole server tree** (25 each during a publication, a package import, a 160 MB backup and a migration of a 240 MB database). After every one: **0 corrupt databases** (`quick_check` and `foreign_key_check` on `publisher.db`, `quick_check` on every safety copy), **0 torn files**, 0 half-made projects, 0 cut-off backups listed, committed data and history intact, and every retry succeeded. 46 publication kills found the job running and it showed `interrupted`; 4 came after it had finished. 2 migration kills came after the start had completed. The default run is N=3 (12 kill points) in the `heavy` plan; set `CHAOS_KILLS=25` for the release figure. The **save** site is covered at file level by WP-11's harness (`wp11-integrity`: 100 kills during 3 and 5 MB rewrites, 0 torn files; re-run here, 16/16). **Not covered: a kill during release approval.** It is one of the four sites the gate names, so the gate is not met. Fix: a fifth case in `wp30-chaos.test.js` that kills during `POST .../releases/:id/approve`. |
| G-REL-3 upgrade/downgrade matrix | EXTERNAL | Needs real N-1 and N-2 releases. Procedure: install N-2 and N-1 on a VM with each of the 6 data states, upgrade to N, compare, and check that an older build refuses a newer database. Partial evidence: `scripts/release/update.test.mjs` 6/6 (synthetic 1.0.0 to 1.1.0 stages, verified backup, rollback), and `wp12-backup-restore` (a newer build is refused). |
| G-REL-4 concurrent saves | PASS | 0 silent overwrites in every case. Each accepted save forms one chain of base hash to new hash per module, and the server's final version equals the end of the chain. **2 clients:** `wp11-integrity` (re-run 16/16), 500 rounds of two authors saving one module from the same version (1,000 saves): 500 accepted, 500 refused. **5 clients:** `load-test.js --authors 5 --projects 1 --duration 330 --think 100-400` gave 1,069 accepted saves on 6 modules (own and shared) and 263 accepted / 115 refused (409) on the shared module without a lease; 0 errors. **10 clients:** `--authors 10 --duration 180` gave 1,184 accepted saves on 11 modules and 206 accepted / 178 refused on the shared module; 0 errors. Also the 30-minute soak with 20 clients: 0 silent overwrites. |
| G-REL-5 disk full, read-only volume | EXTERNAL | Needs a small VHD or quota volume, which needs administrator disk tooling (not allowed here). Procedure: mount a 2 GB VHD, put the workspace on it, fill it with publish and import until ENOSPC, n = 10, then check `quick_check`, that the service stays up, and recovery after space is freed. Partial evidence: `uploads-config` 4/4 (ENOSPC answers 507 `DISK_FULL` with a plain message) and `db-snapshot` 4/4 (a failed pre-migration copy is reported). |
| G-REL-6 service recovery | EXTERNAL | Needs the installed Windows service. Procedure: `taskkill /F` the service's node process, time the restart (`sc qfailure AgastyaPlatform` shows 5 s) and the time until `/api/ready` answers 200. |
| G-REL-7 24 h soak | EXTERNAL | Procedure, on a quiet reference machine with nothing else running, from `backend/` after `npx tsc -p .`: **`node scripts/soak.js --minutes 1440 --out soak-24h.json`** (20 authors on 5 projects through the WP-28 harness, a PDF publication every 5 min, a backup every 15 min, a sample every 60 s). Limits are then set from that baseline; the server's RSS and private bytes slope per hour is the series to watch (finding above). Partial evidence, this run (`soak.js --minutes 30`): 0 crashes, 0 failures, 6/6 publications, 2/2 backups, 37,460 load requests at p95 36.9 ms with 0 errors and 0 silent overwrites, load acceptance PASS. Event-loop p99 25.7 ms first and last. Server handles 313 to 310, threads 15 to 14, the process tree stable at 6 processes (one JVM). **RSS 121 to 195 MB, private bytes 129 to 200 MB, heap 31 to 34 MB.** 29 sessions were renewed after policy 401s, because the harness shares the administrator account under the single-session default. A first 60-minute attempt was cut off at 10 minutes when the session was interrupted (no failure up to then); this is why the run was 30 minutes. |
| G-REL-8 audit write failure | PASS | `wp29-audit-trail`: a critical action whose audit row cannot be written is refused and rolled back; an ordinary one goes ahead and is flagged. |
| G-REL-9 database health checks | EXTERNAL | Partial evidence: `quick_check` and `foreign_key_check` pass after every restart in the chaos suite (start-up check, then each kill case); `wp12-migrations` 10/10 (`quick_check` at start and in the migration path). The gate also asks that `--doctor` reports it; that is tested by `scripts/release/host.test.mjs`, not run here because it writes a throwaway HKCU uninstall key. The lead runs it in the release gate's `release-tools` stage. |

## G-PERF Performance

| Gate | Status | Evidence / reason / procedure |
|---|---|---|
| G-PERF-1 interactive p95 | EXTERNAL | Targets are set on a defined reference machine with the shipped runtime, not on this shared host. Procedure: `node scripts/ci/perf.mjs --profile release` five times on the reference machine; the median and spread become the baseline. Partial evidence: `wp17-perf` 9/9 (save and create costs from 100 to 1000 modules, dashboard costs); the WP-28 and WP-30 load runs (p95 36.9 ms for 20 authors in the soak). |
| G-PERF-2 batch operations | EXTERNAL | As G-PERF-1: `perf.mjs --profile release` (500 modules, 1000 pictures, with the PDF), with 3 repeats, on the reference machine. |
| G-PERF-3 regression rule | EXTERNAL | The rule is implemented (`scripts/ci/perf-compare.mjs`: alert at +25 %, fail at +40 % against the median of the last five comparable runs; there is no verdict before three runs exist). No history exists for a reference machine yet. |
| G-PERF-4 supported scale | EXTERNAL | Needs the owner's scale statement (decision), then a test at 2x that figure. WP-28 measured 50 authors with 10 and with 100 projects (see IMPLEMENTATION-LOG WP-28; not re-run here). |

## G-OFF Offline operation

| Gate | Status | Evidence / reason / procedure |
|---|---|---|
| G-OFF-1 zero outbound connections | EXTERNAL | The gate covers install, start, workflow and uninstall with an outbound firewall block and a connection audit log on a clean VM. Procedure: in the VM, block outbound traffic with Windows Firewall, turn on WFP auditing (`auditpol /set /subcategory:"Filtering Platform Connection" /failure:enable`), install silently, run the workflow, uninstall, and count Security-log events 5157 for node, java, AgastyaCtl and AgastyaPlatform. Nothing on this machine's firewall or audit policy was changed. Partial evidence (start and workflow): `wp30-airgap` 3/3. The real server runs with a preload (`test/fixtures/airgap-hook.js`) in itself and its job workers that refuses and logs every non-loopback TCP/TLS/HTTP/fetch, every non-local DNS lookup and every off-machine UDP. The workflow was sign-in, S1000D validation, PDF and download, HTML, JSS PDF, JSG PDF, backup and verify, all 2xx. Results: **0 outbound attempts** in 2 Node processes (server and job worker); the TCP table of the whole process tree was polled 67 times (up to 7 processes, a JVM in 60 polls) with **0 non-loopback connections**. A control case shows the hook does refuse and log 192.0.2.1:80, a DNS lookup of example.com and a fetch. |
| G-OFF-2 no external resources in the UI | **FAIL** (coverage) | Static half met: `wp30-airgap` scans 203 files of `frontend/dist` and finds no `src`, `href`, `url()`, `@import`, `import()`, Worker or WebSocket to a foreign host (XML namespaces excluded). `readiness.mjs` now runs this scan. CSP half not collected (CSP report-only across ten routes; see G-SEC-8). |
| G-OFF-3 clean-machine install, no network | EXTERNAL | Procedure: on each supported OS image with the adapter disabled, `Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG=install.log`, then first sign-in (`scripts/vm-acceptance/Test-InstallerInVm.ps1 -RequireSigned`). Not run: no VM images. |
| G-OFF-4 all features with the adapter disabled | EXTERNAL | Procedure: as G-OFF-3, then the scripted workflow and the help pages with the adapter disabled. Partial evidence: the process-level air gap above (PDF publication, validation against the bundled XSD sets, HTML, JSS, JSG and backup all worked with outbound access refused). Help pages were not exercised. |

## G-DEP Deployment

| Gate | Status | Evidence / reason / procedure |
|---|---|---|
| G-DEP-1 silent install/upgrade/repair/uninstall | EXTERNAL | Clean VMs (Windows 10/11/Server 2019/2022), per-machine and per-user. Procedure: `docs/DEPLOYMENT-KIT.md` silent commands with `scripts/vm-acceptance/Test-InstallerInVm.ps1`. `scripts/release/installer.test.mjs` (a real per-user Inno install in temp) was **not run here**, because it writes an HKCU uninstall key and a Start-menu folder. |
| G-DEP-2 one-click decisions | EXTERNAL | Count the mandatory wizard pages on a VM install. |
| G-DEP-3 detection rule | EXTERNAL | Needs an installed copy and SCCM or Intune: `node scripts/ci/readiness.mjs --install "<dir>"` (row G-DEP-3), then the tenant run per `docs/DEPLOYMENT-KIT.md`. |
| G-DEP-4 doctor sensitivity | **FAIL** (coverage) | `scripts/release/host.test.mjs` seeds 5 of the 8 faults (missing runtime, missing JRE, port in use, bad ini value, read-only data folder). **Low disk, stopped service and expired TLS certificate are not seeded** (as `readiness.mjs` row G-DEP-4 states). host.test was not re-run here (HKCU write). |
| G-DEP-5 upgrade safety | EXTERNAL | Snapshot before every migrating upgrade, and rollback tested end to end once per release with a real release. Partial evidence: `update.test.mjs` 6/6 (verified backup before the switch; rollback to 1.0.0 on synthetic stages); `wp12-migrations` 10/10 (pre-migration snapshot); chaos (a torn snapshot can no longer take the canonical name). |
| G-DEP-6 time to first sign-in on a reference VM | EXTERNAL | Measure on the reference VM: from Setup start to the first sign-in page (`readiness.mjs --install` row G-DEP-6 runs `AgastyaCtl --doctor`). |

## G-UX UI and UX

| Gate | Status | Evidence / reason / procedure |
|---|---|---|
| G-UX-1 automated accessibility scan, ten routes | PASS | `npx playwright test -c playwright.visual.config.ts e2e/visual/a11y.spec.ts e2e/visual/keyboard.spec.ts` (Edge, port 4111): **33 passed, 7 skipped** (the keyboard spec skips the dark theme by design), 0 failed. It covers the ten named routes in both themes, with no serious or critical violation outside the dated allow-list, and the WCAG 1.4.3 contrast sweep. axe-core itself is not in the offline cache; the rules are the in-repository subset (`e2e/visual/a11y-audit.ts`, WP-20/23). |
| G-UX-2 keyboard-only core tasks | **FAIL** (coverage) | `keyboard.spec.ts` passes (skip link, opening a project with Tab and Enter, the account menu, Escape and dialogs, the divider, titles, live regions). Of the five tasks, sign-in and opening/creating a project are scripted. **"Create and edit a data module, validate, request and approve a release" keyboard-only is not scripted** (WP-23 limit). |
| G-UX-3 visual criteria | EXTERNAL | Text contrast is automated (a11y spec, both themes). Target size, reflow at 320 px and 200 % zoom need a person (WP-23 limit). Procedure: Edge at 320 px width and 200 % zoom over `e2e/visual/routes.ts`, with the WCAG 2.5.8 target-size check by hand. |
| G-UX-4 manual screen-reader pass | EXTERNAL | NVDA or Narrator on sign-in, the Studio and Publish, logging blockers. |
| G-UX-5 no lost typed content | **FAIL** (coverage) | `e2e/wp05-dataloss.spec.ts` **10/10** (Edge, port 4111): a session revoked while typing, a failed `/auth/me`, a reload with unsaved text, a refused save, sign-out. That is 10 scripted cases, not the gate's **20 fault-injected cases**. |
| G-UX-6 first-use task success | EXTERNAL | A usability round with at least 5 new authors. |

## G-Q Quality

| Gate | Status | Evidence / reason / procedure |
|---|---|---|
| G-Q-1 full chain on the release candidate | EXTERNAL | The lead's release gate: `npm run gate:release` on the merged branch with the shipped Node (24.22.3). Not run by WP-30, by instruction. |
| G-Q-2 a regression test names every closed P0/P1 finding | **FAIL** | Measured by a grep of every test and spec file (222 files) for each P0/P1 id in the roadmap's findings table: **76 of 94** are named. Missing: DEP-001, DEP-003, DEP-005, DEP-006, DEP-012, ENT-004, ENT-007, FE-002, PERF-008, PUB-005, PUB-006, QA-001, QA-007, QA-019, QA-020, QA-022, UX-010, UX-011. Several are covered by tests that do not name the id; the gate asks for the name. |
| G-Q-3 type check and build | PASS | `npx tsc -p .` in `backend/`: 0 errors. `npx tsc --noEmit` in `frontend/`: 0 errors. `npx vite build` run twice into two folders gave **262 files, byte-identical** (SHA-256). Lint (`scripts/ci/lint.mjs`) exits 0; parity check PASS; `check:cleanup` PASS. |
| G-Q-4 golden and isolation outputs | PASS | `wp30-pdf-regression` 12/12 (with the QA-006a ratchet), `golden-xignal` 4/4, `pdf-reference` 2/2, `s1000d-reference` 18/18, `jss-cover-isolation` 6/6, `jss-reference-layout` 2/2. No baseline was re-taken except the recorded `knownNotEmbedded` field. |
| G-Q-5 test stability | EXTERNAL | Three consecutive full release-gate runs with no retry-only pass: the lead's gate. |
| G-Q-6 readiness script exits 0 | EXTERNAL | Every row named by the gate is now automated: G-OFF-2 moved from NOT RUN to a real check in WP-30. Exit 0 needs a release folder (signed) and `--install`. Procedure: `node scripts/ci/readiness.mjs --release release --install "<dir>"`. **`readiness.mjs` was not run as a whole here**: its G-DEP-4 row runs `host.test.mjs`, which writes an HKCU key. Its other test-backed rows were run as single files above: G-SEC-5 `routes-guarded` 1/1, G-SEC-5b `wp29-audit-coverage` 2/2, G-SEC-4 `wp29-audit-trail` 11/11, G-OFF-2 `wp30-airgap` 3/3. Its artefact rows (QA-001, G-SEC-11a/c, RES-005) are NOT RUN without a release folder, and its install rows (G-DEP-3/6, G-SEC-6, DEP-013) are NOT RUN without `--install`. |

## Other tests run on this branch (all passing, one file at a time)

* Backend:
  * `api` 17, `applic-publish` 12, `auth-core` 11, `auth-http` 10, `db-snapshot` 4, `jsg-engine` 7, `pdf-furniture` 2, `project-delete-after-build` 3;
  * `s1000d-migration` 2, `settings-hostile-input` 6, `tools-canary` 6, `wp11-integrity` 16, `wp12-migrations` 10, `wp13-version` 4;
  * `wp14-jobs` 9, `wp15-jsg-release` 4, `wp28-team-server` 6.
* Release tools: `scripts/release/release.test.mjs` 8, `host-audit.test.mjs` 2, `teamserver.test.mjs` 4, `update.test.mjs` 6.
* Not run here, because they change registry or user-profile state: `host.test.mjs` (throwaway HKCU uninstall key) and `installer.test.mjs`
  (HKCU uninstall key and Start-menu folder of a per-user install).
