# Agastya platform: software audit, architecture and deployment strategy

**Audit-only deliverable.** The audit itself changed nothing in the application: no source file, schema, dependency, installer or test; its output is this folder (`docs/audit/`), which is new and not committed. Implementation of the audit's phases has **not** started and does not start until the owner has reviewed the audit and approved a phase. **One exception, after the audit and at the owner's explicit request:** a scoped fix of the JSS/JSG Publication and Explore pages, the Codes button, a leave guard and deletes on those pages (`16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md` section 2). It is not an audit phase and approves none. The owner's Phase 2 brief (UI/UX redesign and code cleanup) is an audit addition, also in `16`; it is **not** implemented.

| | |
|---|---|
| Audited | `Agastya-platform-v2` (offline S1000D / JSS / JSG authoring and publishing suite: Express + TypeScript backend with `node:sqlite` and a vendored XSLT/FOP engine; React + Vite frontend with three framework-free editors; Inno Setup installer with a C# service/tray host) |
| Audit period | 2026-11-26 to 2026-11-27 (addendum 16: 2026-11-27) |
| Method | Twelve audit agents, each owning an area, reading code, running non-destructive probes on scratch servers and scratch workspaces, and researching standards and competitors; one lead who merged, cross-checked and corrected the reports |
| **Audit status** | **PARTIAL.** Broad and deep on code structure, security, data, deployment design, UX and performance shape, and measured where it states numbers. Not run: the installer, the VM harness, 65 of 83 backend test files, a JSG PDF build, assistive technology, multi-user load. The repository's Playwright suite was first run after the audit, by the scoped fix: on Chrome stable 70 of 133 passed and it cannot finish (a tab crash in the Studio); on Edge 132 of 133 passed (`16` section 2.2). It is **not a certification** of the product. Full list: `15-AUDIT-COVERAGE-AND-VERIFICATION.md` |
| Findings | **322**: 9 P0, 88 P1, 169 P2, 56 P3 (304 from the audit, 18 from addendum 16). Each carries an evidence label (VERIFIED / OBSERVED / SUSPECTED / RECOMMENDATION / NOT VERIFIED) |
| Roadmap | 36 work packages in 10 phases (WP-34 to WP-36 from addendum 16); every finding assigned to exactly one package (`14-PRIORITIZED-IMPLEMENTATION-ROADMAP.md`) |

## 1. Executive summary

The product is a competent, unusually well-tested single-machine suite. Its S1000D authoring, validation and publish gate are the strongest parts: the gate is three-layered, all 276 API routes carry exactly one authorisation guard (verified by a live router dump), the JSS layout work is protected by an isolation fingerprint test, and nothing in the Node code makes an outbound network call. The architectural instincts are sound (one process, files plus SQLite, a vendored engine with strict exception discipline, framework-free editors) and the audit recommends **keeping them**.

It is **not yet production-grade or enterprise-grade**, for five reasons that recur across every area:

1. **A set of exploitable holes that need no new architecture.** Any project editor can redirect a project's file paths and read or write outside the project; the XML safety guard is bypassed by a decoy comment; the publisher-logo field makes the PDF renderer fetch URLs; temporary passwords are `username@year`. All were reproduced on scratch servers.
2. **Data safety is thinner than it looks.** The "Database backup" is a project-folder ZIP without the database and cannot be restored; project and JSS/JSG files are overwritten in place with no atomic write and (for JSS/JSG) no history; version guards on saves are optional; boot can delete a project's membership if its folder is momentarily missing.
3. **A build is not a job, and scale breaks it.** Validation, BREX and the publish gate run on the single request thread (stalls of 2 s to 81 s at 200-1000 modules); the schema pass fails above about 850 modules and the gate then blames a healthy module; the S1000D FO stage grows super-quadratically with figures (100 modules: 36-154 s on the audit host); one hung FOP process stalls every publish while health stays green.
4. **The delivery chain is unproven.** Installer and executables are unsigned, the release folder predates 18 commits, there is no CI, lint or gate of any kind, 43 tests skip silently on a clean checkout, and the offline guarantee is proven for one format on a host with a network card. Nobody (including this audit) has executed the installer.
5. **The UI is calm but unfinished as a system.** Four token vocabularies, 15 failing contrast pairs, a JSG editor that is not themed in dark mode, three editors that behave as three products, a 29% editing area at 1366x768, no project home, and three data-loss defects in the editors.

None of this argues for a rewrite. It argues for a **sequenced hardening programme**: close the holes and data-loss defects first (phase 1A), put a test gate in front of the core (1B), build four shared foundations (application context, one owner of project files, a restorable backup, a supported runtime), then the job service, performance, the design system and UX redesign, the installer family for the standalone mode, and only then the client/server mode and enterprise administration.

## 2. Most critical findings

### P0 (9 findings, 7 distinct problems)

| ID | Problem | Evidence | Package |
|---|---|---|---|
| SEC-002 = S1K-001 = PUB-001 | The settings route trusts the request body: any project editor can set path fields in `project.json` and read or write files outside the project (cross-project IDOR), including via a forged project archive | VERIFIED (three agents independently) | WP-01 |
| SEC-001 | The XML safety guard is bypassed by a decoy comment: XXE reopened on every XML write route | VERIFIED | WP-02 |
| SEC-003 | Publisher-logo field: the PDF renderer fetches attacker-chosen URLs (SSRF) and local files during every build | VERIFIED | WP-02 |
| SEC-011 | `xi:include` pulls local files into the rendered PDF | VERIFIED | WP-02 |
| PERF-001 | Validation, BREX and the publish gate run on the request thread; one author freezes the server for everyone (2-81 s) | VERIFIED | WP-32 (stop-gap), WP-14 |
| PERF-002 | The schema pass fails above about 850 modules; the gate refuses publication naming a healthy module while `schemaChecked` claims every module | VERIFIED | WP-32 |
| PERF-003 | The S1000D FO stage is super-quadratic in figure-bearing modules; the repository's own 500-module baseline could not be reproduced | VERIFIED (shape); the 500-module figure is an extrapolation | WP-33 |

### Selected P1 findings by area (88 in all; the register is in `14`, appendix A)

| Area | Examples |
|---|---|
| Security | Temporary passwords derivable (PLT-014, SEC-004, ENT-002); rate limiter keyed on username+IP and blind to a proxy (SEC-007/008); WebSocket outlives a revoked session (SEC-010); installer grants `BUILTIN\Users` Modify on data folders (ENT-004, SEC-005); no TLS in LAN mode (ENT-001, SEC-006) |
| Data and reliability | "Database backup" is not a backup and has no restore (PLT-001, ENT-006, DEP-008); non-atomic writes (REL-001); JSS/JSG source overwritten in place (ARC-001, PUB-007); `busy_timeout` 0 and orphan folders (PLT-002); project delete keeps history that a same-name project inherits (PLT-004); older build opens a newer database silently (DEP-002) |
| Publication | No deadline, cancel, queue or report for builds (PUB-003/004/005); a release approves a hash only and archives nothing (PUB-006); S1000D to JSS/JSG conversion loses pictures (PUB-008); hung FOP blocks all publishes (DEP-028) |
| Editors / UX | Ctrl+S swallowed in JSS/JSG after the S1000D editor opened, and a dirty document can save into another project (FE-001); unsaved work lost on navigation, on 401 and on a 409 (FE-002/003; the navigation part is mitigated on four surfaces, the rest is GAP-001); JSS Publication page ended in "Internal error" (UX-001, resolved on 2026-11-27: `16` section 2); editing surface 29% of a 1366x768 screen (UX-002); Chrome stable tab crash opening a data module (UX-011, cause unknown; reproduced five more times in the Chrome runs of 2026-11-27; Edge runs the same tests green) |
| Design / themes | Four token vocabularies (DS-001); disabled and busy states look enabled (DS-002); JSG editor not themed in dark (TH-001); 15 failing contrast pairs (TH-002); administrator accent can give 1.51:1 text (TH-003) |
| Deployment | Unsigned artefacts, no SBOM (DEP-003); stale unversioned release (DEP-004); runtimes with no patch process and Node 22 leaving security support on 2027-04-30 (DEP-005, ENT-008); "works offline" proven for one format only (DEP-006); concurrency model cannot support several authors safely (DEP-016) |
| Quality | No CI/lint/hooks (QA-001); tests that need poppler tools fail with TypeErrors (QA-003); no regression test for how the PDF looks (QA-006); unresolved intermittent native crash in the primary run (QA-019) |

## 3. Recommended architecture

Full detail: `03-ARCHITECTURE-AUDIT.md` (sections on engines and the recommended design), `10-DATABASE-AND-DATA-STRATEGY.md`, `09-DEPLOYMENT-ARCHITECTURE.md`.

* **Keep** the single-process server, files plus SQLite, the vendored engine with its exception discipline, and the framework-free editors. Evolve toward a **modular monolith**: one codebase, one set of services, two deployment modes.
* **Add explicit seams** (all behind interfaces whose first implementation is today's code): `Config`, an application context, `ContentStore` (the one owner of project files: atomic write, revision, mandatory version guard, check-out lease), `AuthProvider` (local accounts first, LDAPS later), an event bus and a `JobService`.
* **Make long work a job:** a SQLite job table plus a small pool of worker processes with a reduced environment, per-job directories, deadlines with kill-tree, a bounded and restartable FOP pool, stored build reports, a release archive and a cache keyed by input hash. Validation and the gate run in the same pool. Engines plug in through adapters (validate / prepare / post-process) so S1000D, JSS and JSG share one runner while keeping their own stylesheets.
* **Concurrency:** mandatory `baseHash` on every write plus a per-user check-out lease with expiry. No CRDT or operational transform.
* **Database:** keep SQLite. Move to PostgreSQL only if a measured trigger is reached (p95 write latency above 200 ms or event-loop lag above 100 ms under the stated load, two server nodes, RPO below one minute, or a mandated corporate database).
* **Not proposed:** microservices, a message broker, containers, Electron, Tauri, MSIX.

## 4. Recommended UI direction

Full detail: `06-UI-UX-AUDIT.md` (navigation section 6, workspace section 7, workflows section 9), `07-DESIGN-SYSTEM-PROPOSAL.md`, `08-DARK-LIGHT-THEME-STRATEGY.md`. Six verified HTML mockups are in `mockups/` (open `mockups/index.html`; each was checked in Edge at 1366x768, 1280x720 and 1920x1080 in both themes: 0 horizontal overflow, 0 contrast failures, no console errors).

* **Navigation:** Home (recent, folders, all projects, "needs me") then a **Project Home**, then Write / Structure / Graphics / Check / Review and release / Settings. Workspace and Projects merge into Home; Backup moves to account settings and the project menu; Explore, Publication and the DM panel's tree become one Structure view.
* **One workspace shell, three document adapters** (S1000D, JSS, JSG): the same header, save/dirty vocabulary, shortcuts, command palette and recovery. Default **Write** mode gives the editing surface at least 55% of a 1366x768 screen (29% today); the ribbon collapses to a slim strip with a context toolbar; the Problems panel is a bottom drawer of at most 25% height; a Focus toggle hides everything but the surface; a quick switcher (Ctrl+K) and find/replace in JSS.
* **Problems and review in one place:** one server-side problems model; review comments visible in the editors, not only on the Release page; "reviewed" marks stored on the server.
* **Accessibility:** WCAG 2.2 AA with an automated gate (axe on ten named routes), landmarks and a skip link, focus-trapping dialogs, keyboard-only completion of five core tasks.

### Design system and themes (dark and light are equal priority)

* **Three token tiers** (primitives, semantic roles, component) generated from one definition and **verified by script in both themes**: 109 colour pairs, 0 failures (minimum text contrast 4.54:1 light and 4.57:1 dark; UI components 3.04 and 3.10). The token files are in `mockups/tokens.css`.
* **Dark is a designed theme, not an inversion:** lighter surfaces with a hairline ring instead of shadows, a lighter accent, status colours that carry an icon or label.
* **Mechanism kept** (`data-theme` on `<html>`, applied before first paint, three user choices System / Light / Dark); added: a validated administrator-accent pipeline, a paper/canvas/viewer policy (print sheets stay white inside a themed canvas), forced-colors support, two density modes, and per-theme visual regression.
* **Type:** system stacks (Segoe UI Variable / Cascadia Mono / Consolas), no web fonts, a scale of 8 sizes replacing 45; Arial kept for print sheets by the earlier owner decision.
* **Migration** is phased and reversible, starting with a report-only lint for hard-coded colours.

## 5. Deployment recommendation

Full detail: `09-DEPLOYMENT-ARCHITECTURE.md`, `12-ENTERPRISE-READINESS.md`, `13-INDUSTRY-RESEARCH-AND-BENCHMARKING.md`.

**One codebase, two modes, four artefacts, all built with Inno Setup** (an MSI wrapper only if a customer mandates Group Policy deployment; Electron, Tauri and MSIX rejected with reasons in 09 section 5):

| Artefact | Purpose | Notes |
|---|---|---|
| **Standalone-Setup** (Mode A) | One machine, one user or a few; the same server on loopback plus a WebView2 launcher (default-browser fallback) | Data outside the program folder and kept on uninstall; no mandatory decisions beyond accepting defaults (gate G-DEP-2: at most one) |
| **Client-Setup** (Mode B) | Thin client: WebView2 shell, first-run server-address wizard, `/api/version` handshake | Refuses a server it does not match |
| **Server-Offline-Setup** (Mode B) | The same server as a Windows service with native TLS, firewall rule, scheduled central backup | Refuses non-loopback binding without TLS; hash guard and check-out mandatory |
| **Offline-Update** | Signed package carried in by media | Versioned program folders with an atomic pointer, pre-update backup, automatic rollback on a failed health check, downgrade refused |

Common to all: signed (organisation CA or purchased certificate, always timestamped), SBOM, SHA-256 and signature verifiable offline, a support bundle that never contains secrets, structured logs and a readiness endpoint. The offline guarantee must be **proven** (clean no-NIC VMs, outbound-connection audit, CSP `default-src 'self'` with zero violations), not asserted; today it is proven for one format on a host with a network card.

## 6. Roadmap in one table

Detail, per-package acceptance criteria and test cases: `14-PRIORITIZED-IMPLEMENTATION-ROADMAP.md`. Sizes are effort bands (S <= 2 days, M <= 1 week, L <= 3 weeks, XL more), not calendar time.

| Phase | Theme | Work packages | Exit gate (summary) |
|---|---|---|---|
| 1A | Containment: close the P0 holes, data-loss defects, broken workflows | WP-01 path safety, WP-02 XML/SSRF, WP-03 account/session hardening, WP-04 file permissions, WP-05 editor data-loss, WP-06 project lifecycle, WP-07 broken features, WP-32 validation truthfulness | No unresolved P0 security or data-integrity finding; hostile-input tests green; 1000-module project validates with 0 unchecked |
| 1B | Offline quality gate before refactoring | WP-08 CI and deterministic tests, WP-09 authorisation matrix | One command, three green runs, every skip reasoned |
| 2 | Foundations | WP-10 application context and seams, WP-11 file integrity and guards, WP-12 backup/restore/migrations, WP-13 runtime and version identity | Restore tested by script; downgrade refused; runtime decision recorded |
| 3 | Engines and publication | WP-14 job service, WP-33 FO-stage scaling, WP-15 JSG parity and conversion fidelity, WP-16 one validation framework | Every build a job with deadline and report; golden output byte-identical |
| 4 | Performance | WP-17 backend/DB/validation, WP-18 frontend delivery | Benchmarks B1-B13 gated; targets T1-T18 met or waived |
| 5 | Design system and themes | WP-19 tokens and states, WP-20 theme and visual validation, WP-34 feature-preservation baseline | 0 colour literals outside tokens; contrast and per-theme regression in the gate; baseline diff gate; browser suite runs to the end |
| 6 | UX redesign and cleanup | WP-21 editor host and chrome, WP-22 navigation/home/review, WP-23 accessibility, WP-35 remaining screens in batches, WP-36 cleanup after regression sign-off | WCAG 2.2 AA gate green; five tasks keyboard-only; every screen on tokens in both themes; feature checklist signed; cleanup verified |
| 7 | Mode A product | WP-24 signing/SBOM/offline verification, WP-25 standalone installer, update, rollback | Signed Setup and Update verified on clean no-NIC VMs |
| 8 | Mode B product | WP-26 TLS and protocol, WP-27 directory sign-on (customer-driven), WP-28 Client and Server installers | N concurrent authors without silent overwrite; restore drill passed |
| 9 | Enterprise operations | WP-29 tamper-evident audit, retention, operations | Audit chain verifiable offline |
| 10 | Release | WP-30 final QA and chaos suite, WP-31 optional items | Every production-readiness gate PASS or owner-signed waiver; independent penetration test |

**Mandatory vs optional.** Mandatory for a production release in either mode: WP-01 to WP-14, WP-24, WP-25, WP-30, WP-32, WP-33 (the last for S1000D manuals above about 50 figure-bearing modules). Mandatory only for Mode B: WP-26, WP-28. Mandatory for enterprise buyers: WP-23, WP-29. Recommended: WP-15 to WP-22, and WP-34 to WP-36 (the owner's Phase 2 brief; WP-34 is required before any screen is redesigned). Customer-driven: WP-27 (directory sign-on, fine-grained permissions). Optional: WP-31 (licensing, SMTP notifications, MSI).

### Decisions needed from the owner

Twenty (D1 to D15 from the audit, D16 to D20 from addendum 16), listed with the finding, the package and the audit's recommendation in `14` section 5. The five new ones: how far to redesign the three editors (D16), whether the redesign starts after phases 1A and 1B or in parallel (D17), the reference browser for the interface and its tests (D18), the scope of the cleanup (D19) and the visual direction (D20). The ones that change scope or order: the runtime baseline (move off Node 22 before 2027-04-30?), the supported scale for Mode B (concurrent authors, projects, modules), the signing certificate route, whether directory sign-on or an MSI is required, the typical and largest S1000D project size (decides how urgent the FO-stage fix is), the compatibility window for mandatory version guards, and the SQLite durability setting.

## 7. Verification evidence, in brief

Tests run by the audit: frontend default suite 581 of 587 (4 five-second timeouts that pass alone, 2 skipped); 18 of 83 backend test files, 151 of 154 tests (failures: one 600 s timeout and missing `pdfimages`/`pdfinfo`); isolation 6/6, Naval JSS 26/26, importer 41/41, authorisation and route-guard 8/8, `tsc --noEmit` clean in both packages; `npm audit` backend 0 vulnerabilities, frontend 8 (7 moderate, 1 low; one moderate in a runtime dependency). Probes on scratch servers: the security payloads, the offline sinkhole run, backup stall, scale series to 1000 modules, a FOP-hang simulation, ~140 UI screenshots, theme sweeps. Side effect: two git-ignored result files under `frontend/verification-results/` were regenerated by test runs. Addendum 16 (2026-11-27), after the scoped fix: frontend unit suite 606 of 609 (1 five-second timeout that passes alone, 2 skipped); backend identity tests 11 of 11; `tsc --noEmit` clean in both packages; browser suite on Chrome stable, one clean run: 70 passed, 5 failed, 58 did not run (an order-dependent first-run test, and four Studio tab crashes, UX-011); on Edge 132 of 133 (the one failure is a stale assertion for the removed "SNS defaults" screen); every spec for the changed surfaces green on both (`doc-pages` 14/14, `jss-editor` 12/12, `jsg-editor` 11/11, `zz-responsive-layout` 18/18). Detail: `15-AUDIT-COVERAGE-AND-VERIFICATION.md`.

## 8. Reports

| File | Content |
|---|---|
| `README.md` | This summary |
| [`01-CODEBASE-UNDERSTANDING.md`](01-CODEBASE-UNDERSTANDING.md) | Repository, stack, 126-feature inventory, 276 routes, module relationships, execution flows |
| [`02-FUNCTIONAL-AUDIT.md`](02-FUNCTIONAL-AUDIT.md) | Feature-by-feature verdicts: platform, S1000D, JSS/JSG/publication, frontend shell |
| [`03-ARCHITECTURE-AUDIT.md`](03-ARCHITECTURE-AUDIT.md) | Existing architecture, coupling, shared services, recommended architecture |
| [`04-PERFORMANCE-AUDIT.md`](04-PERFORMANCE-AUDIT.md) | Backend, database, document-processing and frontend performance; benchmark suite B1-B13; targets T1-T18 |
| [`05-SECURITY-AND-RELIABILITY-AUDIT.md`](05-SECURITY-AND-RELIABILITY-AUDIT.md) | Security and reliability findings with live probe results; recovery strategy |
| [`06-UI-UX-AUDIT.md`](06-UI-UX-AUDIT.md) | Screen-by-screen audit, navigation and editor redesign, workflows, accessibility |
| [`07-DESIGN-SYSTEM-PROPOSAL.md`](07-DESIGN-SYSTEM-PROPOSAL.md) | Tokens, typography, spacing, components, migration, mockups |
| [`08-DARK-LIGHT-THEME-STRATEGY.md`](08-DARK-LIGHT-THEME-STRATEGY.md) | Semantic mapping, parity, state tables, automated theme validation |
| [`09-DEPLOYMENT-ARCHITECTURE.md`](09-DEPLOYMENT-ARCHITECTURE.md) | Offline audit, Mode A and Mode B, installers, updates |
| [`10-DATABASE-AND-DATA-STRATEGY.md`](10-DATABASE-AND-DATA-STRATEGY.md) | Database assessment, migrations, backup, restore, retention |
| [`11-TESTING-AND-QA-STRATEGY.md`](11-TESTING-AND-QA-STRATEGY.md) | Existing tests, coverage gaps, test plan, deployment testing |
| [`12-ENTERPRISE-READINESS.md`](12-ENTERPRISE-READINESS.md) | Enterprise gap matrix, security requirements, measurable gates G-SEC / G-REL / G-PERF / G-OFF / G-DEP / G-UX / G-Q |
| [`13-INDUSTRY-RESEARCH-AND-BENCHMARKING.md`](13-INDUSTRY-RESEARCH-AND-BENCHMARKING.md) | Competitors, standards, technology comparisons, 41 sources |
| [`14-PRIORITIZED-IMPLEMENTATION-ROADMAP.md`](14-PRIORITIZED-IMPLEMENTATION-ROADMAP.md) | 36 work packages, dependencies, acceptance criteria, 20 owner decisions, full finding register |
| [`15-AUDIT-COVERAGE-AND-VERIFICATION.md`](15-AUDIT-COVERAGE-AND-VERIFICATION.md) | Coverage register, who verified what, open unknowns |
| [`16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md`](16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md) | What changed after the audit; the owner's Phase 2 brief (UI/UX redesign and cleanup) against the audit; 18 new findings; feature-preservation baseline and checklist; cleanup register; UI-detail standard; roadmap changes |
| [`baseline/`](baseline/README.md) | Read-only "before" inventory for the preservation checklist: routes and rails, Studio commands, tests, page and test-id surface, hygiene counters |
| [`mockups/`](mockups/index.html) | Six HTML mockups in both themes plus `tokens.css` and `components.css` |
| `_parts/` | Working parts that were assembled into reports 02, 03 and 04, kept for traceability (finding IDs are the same) |

Finding ID prefixes: PLT platform core, S1K S1000D, PUB publication and JSS/JSG, FE frontend, UX user experience, DS design system, TH themes, DEP deployment, QA testing, PERF performance, ENT enterprise, RES research recommendation, ARC architecture, SEC security, REL reliability; from addendum 16: GAP gaps and improvement potential, UID user-interface detail, CLN cleanup.

## 9. What happens next

The audit ends here. **No implementation will start until the owner has reviewed the audit and explicitly approved the next phase.** The audit's recommendation is to approve phase 1A first (it needs no architecture decision, and it closes the verified security and data-loss holes), and to answer the decisions in `14` section 5 before phases 2 and 7.

**Phase 2 (the owner's UI/UX redesign and cleanup brief)** is audited in `16` and not started. Before it can be approved the owner needs to answer D16 to D20; the audit recommends that its first, risk-free steps (the feature-preservation baseline, the token and theme work behind a report-only lint, and the approval of a visual direction) may run in parallel with phase 1A, and that no screen batch starts before WP-05, WP-19 and WP-34 and before the browser suite runs to the end on the chosen reference browser.
