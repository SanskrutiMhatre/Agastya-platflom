# 14 - Prioritized implementation roadmap

**Status.** Audit deliverable. **Nothing in this roadmap is approved or started.** It is a proposal for the owner to review; no application code, schema, dependency or installer has been changed by the audit. Implementation starts only after the owner has reviewed the complete audit and approves a phase.

**How it was built.** The 329 findings of the twelve audit areas and of the addenda of reports 16 and 17 (register in section 10) were grouped by root cause into 37 work packages (WP). Several agents found the same defect independently; those findings are merged into one package instead of being scheduled separately (section 7). Every finding is assigned to exactly one package (checked by script; section 10 lists the assignment). Priorities and effort bands come from the finding owners; a package inherits the highest priority among its findings. Evidence labels are the audit labels (VERIFIED / OBSERVED / SUSPECTED / RECOMMENDATION / NOT VERIFIED); the label of each finding is in the section-10 register.

## 1. Reading guide

| Term | Meaning |
|---|---|
| P0 | Security hole, data-loss or corruption risk, broken core workflow, critical reliability issue, architectural blocker |
| P1 | Major functional gap, performance bottleneck, deployment blocker, essential enterprise capability, core UX problem |
| P2 | Maintainability, workflow improvement, consistency, automation |
| P3 | Future or optional |
| S / M / L / XL | Effort bands used by the finding owners: S <= 2 days, M <= 1 week, L <= 3 weeks, XL more. A package size is the audit lead's estimate for the whole package (not the sum of its findings); it is a band, not a schedule, and the audit does not convert it into calendar time |
| Class | **Mandatory**: required for a production-grade release of the product as requested (offline, one-click, two deployment modes). **Mandatory for Mode B / for enterprise**: required only when that deployment or buyer profile is in scope. **Recommended**: clear benefit, evidenced, not a release blocker. **Enterprise, customer-driven**: build when a customer requires it. **Optional**: only on demand |
| Gate IDs (G-SEC-n, G-REL-n, ...) | The measurable production-readiness gates of `12-ENTERPRISE-READINESS.md` section 8; the acceptance criteria below refer to them |

**Status since the audit (2026-11-27, report 16 section 2).** At the owner's explicit request, after the audit, a scoped fix was made that is not an audit phase: UX-001 and FE-009 (the JSS Publication page ending in "Internal error") are **resolved** and stay in WP-07 only as closed items; FE-002 (unsaved work lost on navigation) is **partly mitigated** on four surfaces and the rest is GAP-001 in WP-05. Findings and packages added by report 16 (GAP, UID and CLN findings; WP-34 to WP-36; decisions D16 to D20) are marked in the register by their report. Report 17 (production architecture positions, 2026-11-27) adds findings PRD-001 to PRD-007, WP-37 and decisions D21 to D23, and changes eight existing packages; its figures are assumed defaults that the owner can overrule. Nothing else has changed state: no audit phase is approved or started.

Package IDs are stable labels, not an order: WP-32 and WP-33 were added after the performance measurements arrived and sit in phases 1A and 3; WP-37 was added by the addendum of report 17 (phase 8, conditional); WP-34 to WP-36 were added by the addendum of report 16 (the Phase 2 brief of the owner) and sit in phases 5 and 6. The order of work is the phase, then the dependencies in each package.

The per-package fields cover what the master prompt asks of every roadmap item: unique ID, category, problem and current implementation, evidence (finding IDs with their reports), recommended solution, expected outcome, priority, complexity, dependencies, risks, acceptance criteria and test cases. The "Problem and current implementation" paragraph states what the code does today and why that is a problem; the underlying evidence (file and line, probe output) is in the cited finding, searchable by ID in the report named in the register.

## 2. Recommended sequence and how it differs from the suggested one

The master prompt suggests ten phases and asks that the order be re-evaluated. The ten are kept (their numbers are unchanged from phase 2 on) with four changes that follow from the findings:

| # | Change | Reason (finding evidence) |
|---|---|---|
| 1 | **Phase 1 is split.** 1A (containment) contains only fixes that need no new architecture; 1B (the offline quality gate) is moved up from phase 10 | The six P0 reports and the data-loss defects are reachable in the current build, so they come first. But phases 2-3 change the core, and today nothing gates a change: no CI, 43 tests skip silently, the full parallel run has an unresolved native crash, the configured e2e browser crashes (QA-001, QA-007, QA-019, QA-022) |
| 2 | **Cheap enterprise controls move from phase 9 to 1A**: random temporary passwords, release separation of duties, idle/absolute session limits, security headers, ACL fix | They are small and close verified takeover paths (SEC-004, PLT-015, SEC-016, ENT-012, ENT-004); waiting for the "enterprise" phase leaves known holes open for the whole programme |
| 3 | **The runtime decision (WP-13) and file integrity (WP-11) sit in phase 2, before performance work** | The measured performance figures in the repository were taken on Node 26, not the shipped Node 22 (G-PERF-2); Node 22 leaves security support on 2027-04-30 (ENT-008). A baseline on the wrong runtime would be thrown away. Mandatory version guards and atomic writes are prerequisites for both the job service and Mode B |
| 4 | **The publication job service (WP-14) is a phase-3 item and a prerequisite for performance work and for Mode B** | A hung FOP process stalled all publishes while health stayed green (DEP-028, VERIFIED); per-job directories and a report are what later optimisation and the central server build on |
| 4b | **Three performance findings are P0 but are not all in 1A**: PERF-002 (the gate cannot publish about 850 modules or more and reports them as checked) is in 1A (WP-32); PERF-001 (validation freezes the server) gets an S-sized stop-gap in 1A and its full fix in the job service (WP-14); PERF-003 (FO stage super-quadratic) is a change to a vendored stylesheet with high regression risk and goes to phase 3 behind the golden-output gate (WP-33) | A P0 does not mean "first" when the fix needs a prerequisite (04: PERF-001, PERF-002, PERF-003; 03: the job design) |
| 5 | **Mode A (standalone) before Mode B (client/server)**; the design system before the UX redesign | Mode B reuses the installer family, signing, versioned program folders and the guards of phase 2; screens redesigned before tokens exist would be re-done (DS-001, TH-001..003) |

The effort-ordered list in `12-ENTERPRISE-READINESS.md` section 9 ranks items by cost and benefit for the enterprise-readiness question only. Where it differs, this roadmap (dependency- and risk-ordered across all areas) governs.

## 3. Phase summary

| Phase | Name | Work packages | Highest priority | Exit criteria |
|---|---|---|---|---|
| 1A | Containment: stop takeover, data loss and broken core workflows | WP-01, WP-02, WP-03, WP-04, WP-05, WP-06, WP-07, WP-32 | P0 | No unresolved P0 security or data-integrity finding; hostile-input tests for settings, archive, XML and logo fields green; temp passwords random; the editors cannot silently lose or mis-save work; JSS Publication opens; a 1000-module project validates with 0 unchecked modules and a truthful count; no validation stalls the server for more than about 100 ms. |
| 1B | Safety net: an offline quality gate before refactoring | WP-08, WP-09 | P1 | One command runs build + type check + unit + API + security matrix + a PDF smoke on a clean offline runner, deterministic three times in a row, with every skip justified. |
| 2 | Foundation: seams, file integrity, data protection, runtime baseline | WP-10, WP-11, WP-12, WP-13 | P1 | AppContext + ContentStore in use by projects/csdb/jss/jsg; atomic write + revision + mandatory version guard for all three formats; restore tested by script; downgrade refused; runtime decision recorded and the baseline re-measured on it. |
| 3 | Document engines and publication: jobs, fidelity, consolidation | WP-14, WP-33, WP-15, WP-16 | P0 | Every build and every long validation is a job with deadline, cancel, report, archive and cache; the FOP process is bounded and restartable; JSG on the same runner; conversion preserves pictures; one validation framework; the FO stage of 100 figure-bearing modules finishes within the target with byte-identical output. |
| 4 | Performance and scalability | WP-17, WP-18 | P1 | Benchmarks B1-B13 in the gate with thresholds taken from the baseline on the reference machine; targets T1-T18 met or waived with reason. |
| 5 | Design system and dark/light themes | WP-19, WP-20, WP-34 | P1 | One generated token set, two first-class themes, zero hard-coded colours outside tokens, contrast and per-theme visual regression in the gate. The baseline diff gate (WP-34) is in place and the browser suite runs to the end (GAP-007). |
| 6 | UI/UX redesign and workflow improvements | WP-21, WP-22, WP-23, WP-35, WP-36 | P1 | One editor host contract; project home; one problems model; WCAG 2.2 AA gate green on the ten named routes; keyboard-only completion of the five core tasks. Every screen on the tokens in both themes; the checklist of report 16 section 5.4 signed; the cleanup verified and approved separately. |
| 7 | Mode A: the standalone one-click product | WP-24, WP-25 | P1 | Signed Product-Standalone-Setup.exe and Product-Offline-Update verified on clean no-NIC VMs: install, upgrade, rollback, uninstall, repair, air-gapped workflow. |
| 8 | Mode B: client-server | WP-26, WP-27, WP-28, WP-37 | P1 | Signed Client-Setup and Server-Offline-Setup; N concurrent authors without silent overwrite; TLS only on non-loopback; central backup and restore drill passed; if WP-37 is built, the contract suite and the multi-user acceptance pass on PostgreSQL as well. |
| 9 | Enterprise administration, audit and operations | WP-29 | P1 | Audit chain verifiable offline; support bundle; readiness endpoint; retention jobs; documented operations runbooks. |
| 10 | Final QA, security verification, benchmarking, release | WP-30, WP-31 | P1 | Every gate PASS or an owner-signed waiver; independent penetration test; release notes with SBOM and signatures. |

Why each phase sits where it does:

* **Phase 1A - Containment: stop takeover, data loss and broken core workflows.** Six P0 security reports (three are one root cause), the P0 gate defect that makes manuals of about 850 modules or more unpublishable while reporting them as checked (PERF-002), and the data-loss class are reachable today in the current build. None needs new architecture; each fix ships with its regression test, and the S-sized event-loop yielding from PERF-001 removes the "one author freezes everyone" effect early. Two further P0 findings are not here on purpose: the full fix of PERF-001 needs the job service (WP-14) and PERF-003 is a high-regression-risk change to a vendored stylesheet that needs the golden-output gate of phase 1B first (WP-33).
* **Phase 1B - Safety net: an offline quality gate before refactoring.** Phases 2-3 change the core. Today nothing gates a change (no CI, 43 silently skipped tests, an unresolved native crash in the full run, an e2e browser that crashes). Build the gate first so the refactors are protected.
* **Phase 2 - Foundation: seams, file integrity, data protection, runtime baseline.** Both deployment modes, the job service and most enterprise features need the same four things: an explicit application context, one owner of project files (atomic, versioned, guarded), a backup that can be restored, and a pinned supported runtime. The performance baseline must be taken on the shipped runtime, so the runtime decision belongs here.
* **Phase 3 - Document engines and publication: jobs, fidelity, consolidation.** The publication path is the product. It is synchronous, unbounded and unreported. Fixing it needs the foundation (per-job directories, ContentStore) and removes the largest remaining reliability risks (DEP-028, PERF-001, PERF-008). The FO-stage stylesheet fix (PERF-003, P0) also sits here: it must not change a single byte of output, so it needs the golden-output and PDF-regression gate of phase 1B and the vendor-exception rules in front of it.
* **Phase 4 - Performance and scalability.** The remaining backend and frontend performance work is done after jobs and the runtime exist, against the benchmark suite B1-B13 and targets T1-T18 defined in 04-PERFORMANCE-AUDIT. Baseline measurement starts in phase 1B so regressions are caught during phases 2-3, and it must be repeated on the runtime chosen in WP-13 (the repository's own figures were taken on Node 26, the measurements in 04 on Node 22 on a shared host whose CPU times varied up to 2x: shapes and ratios are reliable, absolute times are not).
* **Phase 5 - Design system and dark/light themes.** Tokens, themes and component states must exist before the UX redesign is built on them (07, 08). The validation lint starts in report-only mode in phase 1-2 so the number only goes down. The feature-preservation baseline (WP-34) is captured here, before any screen changes, because the redesign has to be compared with something.
* **Phase 6 - UI/UX redesign and workflow improvements.** Built on the host contract (phase 0 fixes the worst of it) and the design system. Order by evidence: editor chrome and host contract, then navigation/project home/problems/review, then accessibility. WP-35 applies the system to the remaining screens in batches behind a switch, after the owner approves a direction; WP-36 cleans up after the regression sign-off, never during it.
* **Phase 7 - Mode A: the standalone one-click product.** A signed, versioned, updatable and rollback-safe standalone installer is the first deliverable the owner asked for, and it is the base of Mode B.
* **Phase 8 - Mode B: client-server.** Needs phases 2-3 (guards, check-out, jobs, backup) and 7 (installer family) first. Largest new surface: TLS, version handshake, directory sign-on, client and server installers.
* **Phase 9 - Enterprise administration, audit and operations.** Tamper-evident audit, observability, retention, fine-grained permissions. The cheap controls (separation of duties, idle timeout, headers) already landed in phase 0.
* **Phase 10 - Final QA, security verification, benchmarking, release.** The measurable gates of 12-ENTERPRISE-READINESS section 8 are executed on the release candidate, including the air-gapped suite and the 24 h soak.

## 4. Dependencies and the critical path

Dependencies are listed per package. The chains that decide the schedule are:

1. **Data integrity chain:** WP-01 (path safety) -> WP-11 (atomic writes, history, mandatory guards, check-out) -> WP-14 (job service) -> WP-28 (Mode B installers and concurrency acceptance).
2. **Data protection chain:** WP-06 (project lifecycle) -> WP-12 (complete backup and tested restore) -> WP-25 (Mode A update with pre-update backup) -> WP-28 (central backup).
3. **Release chain:** WP-13 (runtime and version identity) -> WP-24 (signing, SBOM, offline verification) -> WP-25 (Mode A installer, update, rollback) -> WP-26/WP-28 (Mode B).
4. **Quality chain:** WP-08 (offline gate) -> WP-09 (matrices, hostile-input suites) and, via the gate, every refactor in phases 2-3; WP-20 (theme/accessibility automation) feeds WP-23.
5. **UI chain:** WP-05 (data-loss fixes and the host contract basics) -> WP-19 (tokens, themes) -> WP-21 (unified editor chrome) -> WP-22 (navigation, project home, review).

7. **Phase 2 chain (the owner's UI redesign and cleanup brief):** WP-08 (a suite that runs to the end, GAP-007) -> WP-34 (feature-preservation baseline) -> WP-19 (tokens and components) -> WP-21 and WP-22 (editor chrome, navigation) -> WP-35 (remaining screens, in batches) -> WP-36 (cleanup after regression sign-off). Decisions D16 to D20 gate it.
8. **Mode B data tier chain (addendum 17):** WP-10 (a dialect-clean storage seam, contract suite) -> WP-37 (PostgreSQL adapter, conditional on D21) -> WP-28 (multi-user acceptance on the engine the customer chose).
6. **Document-engine chain:** WP-32 (validation truthfulness and stop-gap, phase 1A) -> WP-14 (job service) -> WP-17 (backend performance); WP-08 (golden-output and PDF regression gate) -> WP-33 (FO-stage stylesheet).

Packages with no dependency can start in parallel: in phase 1A all 8; WP-19 (token migration behind a report-only lint) can begin while phase 2 runs because it does not touch the server.

## 5. Decisions the owner must make (they change scope or order)

| # | Decision | Needed by | Findings | Audit recommendation |
|---|---|---|---|---|
| D1 | Runtime baseline: move the bundled runtime to the current LTS line, or keep Node 22 until its end of security support (2027-04-30) | WP-13 (phase 2) | ENT-008, DEP-018 | Move to a supported LTS and re-baseline; keep `node:sqlite` behind the storage seam so a change of driver stays local |
| D2 | Compatibility window for mandatory `baseHash` on writes (clients that omit it today) | WP-11 | DEP-016, PLT-020, FE-008 | One release with a logged warning, then reject; first confirm that no other client (scripts, the cross-engine tools) writes without it |
| D3 | Supported scale: concurrent authors, projects, modules per project, workspace size | WP-28, G-PERF-4 | ENT-016, DEP-016 | **Assumed (addendum 17, section 2): Mode A one author; Mode B team tier 25 concurrent authors (100 named users), 100 projects, up to 5,000 modules validated and 2,000 published per project; acceptance test at 2x = 50 scripted authors.** Test at 2x; the single SQLite writer and single Node process bound the design (D21 and RES-002 list the switch criteria) |
| D4 | Signing certificate: organisation CA, purchased code-signing certificate, or both | WP-24 | DEP-003, ENT-014 | Follow the workflow in `docs/SIGNING.md` after it is corrected for current public-CA rules; timestamp every signature |
| D5 | Is directory sign-on (LDAPS first) required by a customer? | WP-27 | ENT-005, DEP-015 | Only when a customer needs it; build the `AuthProvider` seam in WP-10 regardless |
| D6 | Is an MSI / GPO / SCCM package required? | WP-31, WP-24 | DEP-014, RES-012 | Optional: the Inno Setup silent switches cover Intune/SCCM script deployment; MSI only on demand |
| D7 | Default for separation of duties on single-user installs (requester may approve?) | WP-03 | PLT-015, ENT-009 | Enforce by default; allow a documented administrator override for one-person installs |
| D8 | Confirm the removal of the UI screens whose routes and API wrappers are now unreferenced (about 51 routes, 43 wrappers) | WP-13 | ARC-013, FE-018 | Remove after confirmation; keep the list reviewable (a recorded decision per route group) |
| D9 | Fonts: Arial stays embedded in PDFs (earlier decision) versus a freely redistributable face; PDF document properties and tagging scope | WP-15 | PUB-017 | Keep the earlier decision; record the licence basis; add metadata and tagging only where the standard requires it |
| D10 | Fixtures for tests on a clean machine: synthetic documents versus a private runner that holds customer material | WP-08 | QA-007, QA-014 | Synthetic, non-confidential fixtures for the public gate; keep the customer-material tests as a separate, labelled job |
| D11 | Is HTML publication to be surfaced in the UI (it exists in the backend for S1000D only)? | WP-15 | PUB-018 | Decide after the PDF path is on the job service |
| D12 | Licensing: is a licence check required? (the module is dormant, key custody unknown) | WP-31 | ENT-019, RES-008 | Not until the business needs it; if so, an offline signed licence file with soft failure |
| D13 | Existing projects found to carry unsafe path values by the one-time scan: quarantine automatically or report only? | WP-01 | SEC-002, S1K-001 | Report first (administrator notice), quarantine on confirmation; no data is deleted |
| D14 | SQLite durability setting: accept `synchronous=NORMAL` (writes 40x cheaper; after a power cut only the latest commits may be lost, the database stays consistent), or keep FULL | WP-17 | PERF-009 | Accept NORMAL for the database in WAL mode and keep FULL during migrations; document the trade-off in the operations guide |
| D15 | Typical and largest S1000D project size the product must publish (modules, figure-bearing modules): decides how urgent the FO-stage fix is | WP-33, G-PERF-4 | PERF-003, PERF-002 | State the figure; the measurements show a 100-module project with figures already takes minutes and a project of about 850 modules or more cannot be published until WP-32 lands |
| D16 | How far to redesign the three editors: unify chrome, panels, modes and validation feedback around the existing canvases (the audit proposal) or rebuild the canvases on one shared editor framework (the Phase 2 brief: "completely rethink every editor") | WP-21, WP-35 | UX-003, FE-021, 16 section 9.2 | Chrome, panels and modes first; rebuild a canvas only where a measured defect demands it: the canvases hold years of behaviour and tests, and a rebuild is XL three times with the highest risk of losing a feature |
| D17 | Order: start the Phase 2 redesign after phases 1A and 1B (audit), or in parallel with 1A (brief) | WP-34, WP-19, WP-35 | GAP-009, FE-002, 16 section 9.2 | In parallel: the baseline, the token and theme work behind a report-only lint, the direction approval. After 1A and WP-34: any screen batch |
| D18 | Reference browser for the interface and for its tests: the suite uses Chrome stable by default, whose tab crashes in the Studio on the audit host (Edge does not); Mode A is meant to run in WebView2 | WP-08, WP-34 | UX-011, GAP-007 | Take Edge/WebView2 as the reference (the whole suite was green on Edge on 2026-11-27: 132 of 133, one stale test), track the Chrome crash as UX-011, and accept no screen batch until the suite runs to the end on the reference browser |
| D19 | Scope of the cleanup: the front-end register of 16 section 6 and the dead-route list of D8, approved together, after the regression sign-off | WP-36, WP-13 | CLN-001 to CLN-004, ARC-013, FE-018 | Approve item by item; nothing is deleted before the baseline diff passes |
| D20 | Visual direction for the redesign (the brief names Linear, Figma, JetBrains, VS Code) and approval of the mockups before screen work | WP-35, WP-19 | DS-001, 07 | The owner reviews the mockups in both themes and says what to change; the screens without a design (16 section 8.2) are designed after that, not before |
| D21 | Mode B Enterprise database: SQLite only, a PostgreSQL adapter built now, or a PostgreSQL adapter built when a trigger fires | WP-10, WP-37 | PRD-002, ENT-016, RES-002 | **Assumed: build the dialect-clean seam in WP-10 now; build the adapter (WP-37) only when a trigger fires** (p95 write latency above 200 ms or event-loop lag above 100 ms under the stated load, more than one server host, point-in-time recovery required, or a mandated corporate database). If the owner already knows a customer needs high availability or more than 50 concurrent authors, move WP-37 to the start of phase 8 |
| D22 | Lock granularity for JSS and JSG, which are one document per project: whole document, or per chapter (JSS) and per section (JSG) | WP-11 | PUB-010, ENT-016, PRD-003 | **Assumed: per chapter / per section**, merged under a short document write lock with a per-part hash check; whole-document lease only as the fallback |
| D23 | Optional connected services (update check, signed update download, support-bundle upload): never, on demand, or built | WP-31 | PRD-006 | **Assumed: on demand only**, off by default, opt-in per customer, allow-listed host, signed responses; the offline routes stay the primary ones |

## 6. Work packages

Each package lists its findings as `ID (priority, evidence label)`. The full text of a finding is in the report shown in section 10.

### Phase 1A - Containment: stop takeover, data loss and broken core workflows

#### WP-01 - Project settings, path safety and project-kind integrity (the P0 root cause)

| Field | Value |
|---|---|
| ID | WP-01 |
| Phase | 1A |
| Category | Security / data integrity |
| Priority | **P0** |
| Complexity | L |
| Class | Mandatory |
| Dependencies | none |
| Findings covered | 9: `SEC-002 (P0, VERIFIED)`, `S1K-001 (P0, VERIFIED)`, `PUB-001 (P0, VERIFIED)`, `PUB-026 (P1, VERIFIED)`, `QA-020 (P1, OBSERVED)`, `ARC-022 (P2, OBSERVED)`, `PUB-013 (P2, SUSPECTED)`, `DEP-007 (P2, SUSPECTED)`, `S1K-008 (P3, OBSERVED)` |

**Problem and current implementation.** Any editor can overwrite `project.json` through the settings route. `input.csdbDir/mediaDir/pm` become file paths with no validation, in three helpers and in 11 raw reads in `publisher.ts`; a forged archive can plant the same values; `format`/`authoring` can be deleted. Verified live by three agents: cross-project read/write and file access outside the workspace.

**Recommended solution.** Allow-list the keys of the settings body; validate every path field as a relative path that resolves inside the project root (reuse `safeRelPath`); make `format`/`authoring`/`id` immutable through that route; resolve through ONE helper everywhere (add a grep test that fails on raw `project.input.*` reads); sanitise `project.json` on archive import; one-time scan of existing projects, quarantining bad values with an administrator notice; one predicate for project kind.

**Expected outcome.** The path-traversal and IDOR class is closed at the write point and defended at every read site; kind confusion disappears.

**Risks.** Existing projects that legitimately use a custom `csdbDir` outside the project (none found, NOT VERIFIED on real data) would be flagged; keep the scan report-only first.

**Acceptance criteria.** Hostile values (`../`, absolute, UNC, drive letter, reserved names, ADS) return 400 on the settings route and are ignored on archive import; a poisoned `project.json` on disk cannot reach another project (read-site defence test); no raw `project.input.*` reads remain; G-SEC-10 stays green.

**Test cases.** New `settings-hostile-input` API test (every key, every hostile class); archive-import poisoned-`project.json` test; grep-based architecture test; regression for PUB-001/SEC-002/S1K-001 named by ID (G-Q-2).

#### WP-02 - XML safety guard rewrite and external-resource policy for builds

| Field | Value |
|---|---|
| ID | WP-02 |
| Phase | 1A |
| Category | Security |
| Priority | **P0** |
| Complexity | XL |
| Class | Mandatory |
| Dependencies | none |
| Findings covered | 10: `SEC-001 (P0, VERIFIED)`, `SEC-003 (P0, VERIFIED)`, `SEC-011 (P0, VERIFIED)`, `PUB-002 (P1, VERIFIED)`, `PUB-014 (P2, OBSERVED)`, `PLT-018 (P2, VERIFIED)`, `PUB-030 (P2, OBSERVED)`, `PUB-024 (P3, VERIFIED)`, `PUB-025 (P3, VERIFIED)`, `S1K-005 (P3, OBSERVED)` |

**Problem and current implementation.** The text-scan guard is bypassed by a decoy `<!DOCTYPE` in a comment (XXE reopened on every XML write route, VERIFIED); JSS/JSG saves have no guard at all; `xi:include` is invisible to the guard and puts local files into the PDF (VERIFIED); the publisher-logo field makes FOP fetch URLs (SSRF, VERIFIED); child tools inherit the whole environment; special characters in names corrupt generated XML.

**Recommended solution.** Replace the scan by a parse-based check (no DTD/entity resolution; reject DOCTYPE and entity declarations for every project XML; reject or confine `xi:include` and `document()` to the project/work directory); apply it on every write and import route for all three formats; restrict image/logo sources to project media (no http, UNC or drive paths) and give FOP a resolver limited to the job directory; pass child processes a minimal environment; escape generated XML/XSL values.

**Expected outcome.** Attacker-controlled XML or settings can no longer read local files, make network requests or corrupt generated stylesheets.

**Risks.** Legitimate content that uses DOCTYPE/entities (S1000D entity references to ICNs) must keep working: use an allow-list for NDATA ICN entities only (as today) rather than a blanket reject; keep the golden/isolation tests as the guard against output change.

**Acceptance criteria.** The decoy, PI, CDATA and encoding-trick payloads are rejected on every write route and in import; the canary-file `xi:include` payload no longer reaches the PDF; the SSRF listener records zero requests during a publish; G-SEC probes pass.

**Test cases.** Payload corpus test per route family; XXE/xi:include/SSRF canary tests (loopback listener); golden S1000D/JSS/JSG outputs unchanged.

#### WP-03 - Account, session and network-edge hardening (quick wins)

| Field | Value |
|---|---|
| ID | WP-03 |
| Phase | 1A |
| Category | Security |
| Priority | **P1** |
| Complexity | L |
| Class | Mandatory |
| Dependencies | none |
| Findings covered | 24: `PLT-014 (P1, VERIFIED)`, `SEC-004 (P1, VERIFIED)`, `ENT-002 (P1, VERIFIED)`, `SEC-007 (P1, VERIFIED)`, `SEC-008 (P1, VERIFIED)`, `ENT-011 (P2, VERIFIED)`, `PLT-023 (P2, VERIFIED)`, `REL-006 (P2, VERIFIED)`, `SEC-010 (P1, VERIFIED)`, `PLT-017 (P2, VERIFIED)`, `FE-011 (P2, VERIFIED)`, `PERF-018 (P3, OBSERVED)`, `SEC-016 (P2, VERIFIED)`, `ENT-010 (P2, VERIFIED)`, `PLT-022 (P2, OBSERVED)`, `UX-022 (P2, SUSPECTED)`, `PLT-015 (P1, VERIFIED)`, `ENT-009 (P2, VERIFIED)`, `PLT-019 (P2, VERIFIED)`, `SEC-013 (P3, OBSERVED)`, `ENT-012 (P2, VERIFIED)`, `FE-017 (P2, VERIFIED)`, `RES-009 (P2, RECOMMENDATION)`, `SEC-012 (P2, OBSERVED)` |

**Problem and current implementation.** Temporary passwords are `username@year` and usernames can be enumerated (account pre-hijack, VERIFIED); the limiter is keyed username+IP, reads the socket address behind a declared proxy and loses state on restart; WebSockets outlive revoked sessions and ignore Origin; sessions last 7 days with no idle timeout; the release requester can approve; 500 responses return raw details; no security headers or CSP.

**Recommended solution.** Random temp passwords (CSPRNG, shown once, forced change); restrict user search to administrators/managers or require a shared project; per-IP aggregate throttle plus per-account counter in the database; `clientIp()` honours the configured proxy setting; close sockets on revoke/disable and check Origin; idle (30 min) and absolute (12 h) limits configurable; separation of duties on release (requester != approver, configurable for single-user installs); generic 500 body with a correlation id; CSP and the standard headers on the SPA and API; audit rows get the IP; WebSocket broadcast authorises once per connection or caches the result instead of one database lookup per client per message, and gets backpressure (PERF-018).

**Expected outcome.** The verified takeover and enumeration paths are closed; session lifetime fits shared engineering PCs.

**Risks.** Single-user standalone installs need the separation-of-duties exception; idle timeout can lose edits until WP-05 lands, so ship them together.

**Acceptance criteria.** G-SEC-2, G-SEC-3, G-SEC-8, G-SEC-9 PASS; no `details` in 500 bodies; WebSocket closes within 1 s of disable.

**Test cases.** Auth-core test suite (QA-004): lockout, rotation spray, session lifecycle, WS after disable, Origin; header snapshot test.

#### WP-04 - File permissions, service identity and admin tooling

| Field | Value |
|---|---|
| ID | WP-04 |
| Phase | 1A |
| Category | Security / deployment |
| Priority | **P1** |
| Complexity | M |
| Class | Mandatory |
| Dependencies | none |
| Findings covered | 6: `ENT-004 (P1, VERIFIED)`, `SEC-005 (P1, VERIFIED)`, `DEP-012 (P1, OBSERVED)`, `DEP-022 (P2, VERIFIED)`, `PLT-012 (P2, OBSERVED)`, `DEP-009 (P2, OBSERVED)` |

**Problem and current implementation.** A per-machine install grants BUILTIN\Users Modify on the data and state folders, so any local account bypasses application authorisation; `reset-admin.js` takes the password on the command line; after the supervisor gives up the service looks healthy.

**Recommended solution.** Installer ACLs: SYSTEM + Administrators + service identity only (the tray user for per-user installs); password for reset-admin via prompt/stdin; service reports failure state to the SCM when the supervisor gives up.

**Expected outcome.** Local authorisation cannot be bypassed through the file system.

**Risks.** Tray application running as a normal user needs an explicit grant on its own data folder; test both install types.

**Acceptance criteria.** G-SEC-6 PASS (`icacls` shows no BUILTIN\Users ACE); reset-admin leaves no secret in history/logs.

**Test cases.** Installer ACL check in the VM acceptance script; process-list/log grep for secrets.

#### WP-05 - Editor data-loss defects and session handling in the shell

| Field | Value |
|---|---|
| ID | WP-05 |
| Phase | 1A |
| Category | Reliability / UX |
| Priority | **P1** |
| Complexity | L |
| Class | Mandatory |
| Dependencies | none |
| Findings covered | 14: `FE-001 (P1, VERIFIED)`, `FE-002 (P1, VERIFIED)`, `FE-003 (P1, VERIFIED)`, `FE-004 (P1, VERIFIED)`, `FE-005 (P2, VERIFIED)`, `FE-006 (P1, OBSERVED)`, `S1K-004 (P2, OBSERVED)`, `ARC-002 (P2, OBSERVED)`, `FE-007 (P2, VERIFIED)`, `FE-024 (P2, VERIFIED)`, `PUB-023 (P2, OBSERVED)`, `FE-023 (P2, OBSERVED)`, `FE-012 (P2, OBSERVED)`, `GAP-001 (P2, VERIFIED)` |

**Problem and current implementation.** After the S1000D editor has opened, Ctrl+S in the JSS/JSG editors does nothing and a dirty Studio document was saved into another project (VERIFIED); in-app navigation drops unsaved work; a 401 or a conflict destroys typed text; one 503 on `/auth/me` shows the login screen; Studio drafts are written but never restored; Studio state survives a user switch.

**Recommended solution.** Scope the Studio's global key handler to its own container and remove it on unmount; data router with `useBlocker`; only a 401 signs out, heartbeat inside the project shell, re-login overlay that keeps the editor and replays the save; conflict dialog offers keep/export/discard; restore drafts in host mode, scoped per user and project; clear Studio session on logout; JSS draft in IndexedDB.

**Expected outcome.** No editing path can silently lose or mis-route work.

**Risks.** Touches `App.tsx`, two shells and Studio startup; keep each change small and e2e-covered.

**Acceptance criteria.** G-UX-5 (0 lost edits in 20 fault-injected cases); Ctrl+S saves the focused editor in all three editors after any open order.

**Test cases.** Playwright specs for each defect (cross-editor Ctrl+S, navigate-away, expired session, conflict, restore); run on Edge and Chrome (see WP-08).

#### WP-06 - Project lifecycle integrity (reconcile, delete, busy handling, shutdown)

| Field | Value |
|---|---|
| ID | WP-06 |
| Phase | 1A |
| Category | Data integrity |
| Priority | **P1** |
| Complexity | M |
| Class | Mandatory |
| Dependencies | none |
| Findings covered | 7: `PLT-003 (P1, VERIFIED)`, `PLT-004 (P1, VERIFIED)`, `PLT-002 (P1, VERIFIED)`, `PLT-010 (P2, VERIFIED)`, `REL-003 (P1, VERIFIED)`, `REL-004 (P1, OBSERVED)`, `DEP-017 (P2, VERIFIED)` |

**Problem and current implementation.** Boot reconcile deletes a project row and all memberships when a folder is momentarily absent; deleting a project keeps revisions/locks and a same-name project inherits them; `busy_timeout` is 0 (HTTP 500 and orphan folders on contention); shutdown races a 500 ms timer; a restore can leave a half-created project.

**Recommended solution.** Reconcile marks projects "missing" instead of deleting; delete purges documents, revisions and locks in one transaction; unique project ids not derived from the name alone; `busy_timeout=5000` and `foreign_keys=ON`; wait for in-flight work and checkpoint WAL on shutdown; import creates the project atomically (staging folder, rename).

**Expected outcome.** Membership, history and creation are never lost or inherited by accident.

**Risks.** Behaviour change for deleted-project name reuse; needs a migration for existing orphans.

**Acceptance criteria.** After a project folder is briefly absent at boot, its row and memberships are still there; a project recreated under a deleted project's name shows no old documents, revisions or locks; killing the server during an import leaves no half-created project (G-REL-2 smoke).

**Test cases.** Reconcile, same-name recreate, busy contention and kill-during-restore tests.

#### WP-07 - Broken or misleading features (small, visible)

| Field | Value |
|---|---|
| ID | WP-07 |
| Phase | 1A |
| Category | Functional |
| Priority | **P1** |
| Complexity | M |
| Class | Mandatory |
| Dependencies | none |
| Findings covered | 20: `UX-001 (P1, VERIFIED)`, `FE-009 (P2, VERIFIED)`, `DEP-011 (P2, VERIFIED)`, `DEP-027 (P2, VERIFIED)`, `FE-013 (P2, VERIFIED)`, `UX-015 (P2, VERIFIED)`, `UX-016 (P2, VERIFIED)`, `DS-004 (P2, VERIFIED)`, `UX-018 (P2, VERIFIED)`, `UX-019 (P2, VERIFIED)`, `UX-023 (P2, VERIFIED)`, `PUB-012 (P2, VERIFIED)`, `PUB-020 (P2, SUSPECTED)`, `SEC-015 (P2, VERIFIED)`, `ARC-020 (P3, SUSPECTED)`, `SEC-014 (P3, OBSERVED)`, `PLT-024 (P3, OBSERVED)`, `UX-026 (P3, VERIFIED)`, `UX-006 (P1, VERIFIED)`, `PERF-019 (P3, VERIFIED)` |

**Problem and current implementation.** JSS "Publication" ends in "Internal error"; the JSG build fails in deep workspaces; the "Image compression" setting does nothing; "Database backup" is mislabelled; PDF placeholder styling bug; raw event codes; shipped defaults reference missing artwork; SNS CSV cells unescaped; "New project" and editor controls fall off-screen at 1366/1280.

**Recommended solution.** Fix `readPm` for JSS (domain error or empty state); absolute stylesheet path for JSG; remove or implement the compression setting (hide until Ghostscript ships); rename the backup card until WP-12; fix `.v2-empty strong`; map event codes to labels; one `csvCell()` helper; allow toolbars to wrap/overflow menu (stop-gap before WP-22).

**Expected outcome.** No dead-end screens; labels tell the truth.

**Risks.** Low.

**Acceptance criteria.** The ten core routes open without error; the responsive spec asserts visibility (not just non-overflow) at 1280/1366/1440.

**Test cases.** Playwright route smoke; stricter layout spec (QA-023); CSV helper unit test.

#### WP-32 - Validation that tells the truth at scale, plus an event-loop stop-gap

| Field | Value |
|---|---|
| ID | WP-32 |
| Phase | 1A |
| Category | Correctness / scalability |
| Priority | **P0** |
| Complexity | M |
| Class | Mandatory |
| Dependencies | none |
| Findings covered | 1: `PERF-002 (P0, VERIFIED)` |
| Related findings carried by another package | PERF-001 (interim step only: yielding to the event loop; the full fix is the job service, WP-14) |

**Problem and current implementation.** The schema pass sends all modules of one issue and schema file to a single xmllint-wasm call whose WASM heap has a fixed ceiling that also holds the 6-8 MB schema set. Above about 8 MB of module text (about 850 modules) the call dies; the failure is reduced to one info note attached to module 0001, the run still reports `schemaChecked: 1000, errors: 0`, and the publication gate then refuses with 422 `VALIDATION_FAILED`, naming a module that is perfectly fine and that the user cannot fix (VERIFIED: 800 modules pass, 900 and 1000 fail; a single 25 MB module fails). A manual of about 850 modules or more therefore cannot be published at all, and the count the user sees is false. Separately, validation, BREX, applicability and id/ICN scan loops run synchronously on the request thread (PERF-001), freezing every user for 2-81 s.

**Recommended solution.** Batch by bytes (about 3-4 MB of module text per call, roughly 400 modules) and pass explicit memory pages sized to the largest module plus the schema set; when a batch still fails, retry module by module so exactly the failing module is named, and say "too large to validate (limit X MB)" for a module that is; count a module in `schemaChecked` only if it was actually judged and list every module of a failed batch as unchecked; make the gate message truthful ("the validator ran out of memory for N modules"). Interim stop-gap for PERF-001 (S, about 2 days): `await setImmediate()` between modules in the BREX, applicability and scan loops so the thread never holds for more than about 50 ms; this makes the server responsive during validation although validation itself is not faster.

**Expected outcome.** Manuals of 1000 to 5000 modules validate and publish; the gate's message names the real cause and scope; one author's validation no longer stops other users.

**Risks.** More WASM instantiations (about 280 ms fixed cost each; about 3.4 s of overhead for 12 calls at 5000 modules); finding order and counts must stay stable for existing tests; a synthetic 10 MB module reported a schema error whose cause is NOT VERIFIED (04); yielding changes timing of WebSocket progress messages (they get faster).

**Acceptance criteria.** Projects of 1000, 2000 and 5000 modules validate with 0 unchecked and the same findings as per-module validation of the same data (B11); a 25 MB module yields one clear per-module message; `schemaChecked` equals the number of modules actually judged; while a 200-module validation runs, the event-loop maximum stays below about 100 ms.

**Test cases.** The batch-ceiling series (600, 800, 900, 1000, 2000, 5000 modules); a module that crashes the validator; mixed issue groups (4.2 and 5.0); event-loop delay during validation with a second client polling health.

### Phase 1B - Safety net: an offline quality gate before refactoring

#### WP-08 - Offline quality gate: CI, deterministic tests, tool provisioning

| Field | Value |
|---|---|
| ID | WP-08 |
| Phase | 1B |
| Category | Quality |
| Priority | **P1** |
| Complexity | L |
| Class | Mandatory |
| Dependencies | none |
| Findings covered | 18: `QA-001 (P1, VERIFIED)`, `QA-002 (P2, VERIFIED)`, `QA-003 (P1, VERIFIED)`, `QA-007 (P1, VERIFIED)`, `QA-010 (P2, VERIFIED)`, `QA-011 (P2, VERIFIED)`, `QA-014 (P2, VERIFIED)`, `QA-015 (P2, VERIFIED)`, `QA-017 (P2, VERIFIED)`, `QA-018 (P2, VERIFIED)`, `QA-019 (P1, OBSERVED)`, `QA-022 (P1, VERIFIED)`, `UX-011 (P1, OBSERVED)`, `ARC-023 (P3, OBSERVED)`, `ARC-014 (P3, OBSERVED)`, `PLT-026 (P2, OBSERVED)`, `RES-011 (P2, RECOMMENDATION)`, `GAP-007 (P2, VERIFIED)` |

**Problem and current implementation.** No CI, lint or hooks; the release installer predates 18 commits; 43 tests skip silently; 16 test files need poppler tools that are missing (TypeError, not skip); vitest 5 s default and a 600 s limit produce red runs; the full parallel run has an unresolved native crash (0xC0000005) and hangs; the configured e2e browser crashes the tab; tests leak temp folders and share fixtures across packages.

**Recommended solution.** Self-hosted offline runner (Windows) with stages build -> type check -> unit -> API -> security matrix -> PDF smoke -> e2e (Edge + Chrome channel matrix) -> package; bundle/pin the PDF tools (poppler) or replace with pdfjs-in-Node; explicit skip policy (a skip needs a reason and shows in the report); per-file timeouts; fixed e2e ports per worker; stable fixtures inside each package; root-cause the native crash with the existing investigation as a start; one release-readiness script (RES-011).

**Expected outcome.** A change cannot merge unobserved; skips are visible; the crash is either fixed or isolated.

**Risks.** The crash may be inside `xmllint-wasm` or Node (needs the runtime decision of WP-13); budget for investigation.

**Acceptance criteria.** G-Q-1, G-Q-3, G-Q-5 (3 consecutive green runs); every skip listed with a reason; zero TypeErrors from missing tools.

**Test cases.** The pipeline itself; a canary test that fails if a required tool is missing.

#### WP-09 - Authorisation matrix and hostile-input test suites

| Field | Value |
|---|---|
| ID | WP-09 |
| Phase | 1B |
| Category | Quality / security |
| Priority | **P1** |
| Complexity | M |
| Class | Mandatory |
| Dependencies | WP-08 |
| Findings covered | 6: `QA-004 (P1, VERIFIED)`, `QA-005 (P1, VERIFIED)`, `ARC-016 (P2, OBSERVED)`, `QA-021 (P2, VERIFIED)`, `QA-023 (P2, VERIFIED)`, `QA-016 (P2, OBSERVED)` |

**Problem and current implementation.** The auth core, WebSocket and role-by-route behaviour are untested; 28 routes have no test reference; no test checks pictures in conversions; the responsive spec cannot see the defects; no React component tests.

**Recommended solution.** Generate a role x route matrix from the guard markers with a committed snapshot; WebSocket test harness in `boot()`; auth-core suite; conversion picture test; stricter layout assertions; jsdom component tests for `Modal`, forms, stores.

**Expected outcome.** The controls that exist stay in place as the code changes.

**Risks.** Matrix needs an owner to bless intended differences.

**Acceptance criteria.** G-SEC-10 extended to 100% of routes classified; zero unreferenced routes except an allow-list.

**Test cases.** The suites themselves.

### Phase 2 - Foundation: seams, file integrity, data protection, runtime baseline

#### WP-10 - Explicit application context and storage/auth seams

| Field | Value |
|---|---|
| ID | WP-10 |
| Phase | 2 |
| Category | Architecture |
| Priority | **P1** |
| Complexity | XL |
| Class | Mandatory (enabling) |
| Dependencies | WP-08 |
| Findings covered | 7: `PLT-028 (P1, VERIFIED)`, `PLT-030 (P2, VERIFIED)`, `PLT-031 (P2, VERIFIED)`, `PLT-032 (P3, OBSERVED)`, `ARC-006 (P2, OBSERVED)`, `ARC-017 (P3, OBSERVED)`, `PLT-027 (P2, OBSERVED)` |

**Problem and current implementation.** Import-time singletons (74 importers) with no `Config`, `Storage` or `Auth` seam; process-local state; an 8-module runtime cycle closed by lazy `require()`; SQL outside the store.

**Recommended solution.** Typed `Config` built once; `AppContext` injected; `ContentStore`, `SessionStore`/limiter store and `AuthProvider` interfaces with today's implementations as defaults; migrate service by service behind a compatibility export; do not interface the 109-method `AuthStore` until a second engine is real; make the storage seam **dialect-clean** (addendum 17, PRD-002): every query lives in a repository behind an interface, migrations are engine-neutral files, no direct SQL outside repositories (about 51 `dbh()` call sites and five services bypass the store today), and one contract test suite runs against any engine, so a PostgreSQL adapter (WP-37) is a contained job.

**Expected outcome.** Services testable in isolation; the same code serves Mode A and Mode B; restart-safe state.

**Risks.** Large mechanical diff; do it behind the gate of WP-08, one service per change.

**Acceptance criteria.** No module reads `process.env` outside config; cycle count 0; tests can construct an isolated context; a grep test fails on SQL outside the repositories and a contract test suite runs against the SQLite implementation (PRD-002).

**Test cases.** Existing suites unchanged + isolated-context unit tests.

#### WP-11 - File integrity: atomic writes, history, mandatory version guards and check-out for all formats

| Field | Value |
|---|---|
| ID | WP-11 |
| Phase | 2 |
| Category | Reliability / functional |
| Priority | **P1** |
| Complexity | XL |
| Class | Mandatory |
| Dependencies | WP-01, WP-10 |
| Findings covered | 17: `REL-001 (P1, OBSERVED)`, `PLT-009 (P2, VERIFIED)`, `ARC-001 (P1, OBSERVED)`, `PUB-007 (P1, VERIFIED)`, `PUB-010 (P2, OBSERVED)`, `DEP-016 (P1, OBSERVED)`, `ENT-016 (P2, VERIFIED)`, `REL-002 (P1, OBSERVED)`, `PLT-020 (P2, VERIFIED)`, `PLT-021 (P2, OBSERVED)`, `REL-007 (P2, OBSERVED)`, `PERF-010 (P2, VERIFIED)`, `RES-001 (P2, RECOMMENDATION)`, `FE-008 (P2, VERIFIED)`, `PUB-029 (P2, VERIFIED)`, `PUB-021 (P2, OBSERVED)`, `SEC-017 (P2, VERIFIED)` |

**Problem and current implementation.** DM and project files are written in place (no tmp+rename+fsync) and the revision is cut after the write; JSS/JSG books are one overwritten file with no history; `baseHash` is optional, the DM "lock" only freezes non-owners, CIR/PMC/ancillary/settings have no guard (last write wins, VERIFIED); uploads are buffered in memory; builds write intermediates into the project folder.

**Recommended solution.** One `ProjectFiles` write path: temp file + fsync + rename, revision cut in the same step; revision history for JSS/JSG; mandatory `baseHash` on every write route (409 with the server version); per-user check-out lease with expiry for DM, and **per chapter (JSS) and per section (JSG) rather than per whole document** (decision D22: the server merges a chapter or section into the document under a short document write lock and refuses if the hash of that part changed) (RES-001: hash guard + lease, not CRDT/OT); streaming uploads with caps; derived files out of the project folder (job directories, WP-15).

**Expected outcome.** No silent overwrite, no torn file, history for all three formats; the multi-author model Mode B needs.

**Risks.** Behaviour change for API clients that omit `baseHash` (ship a compatibility window with a logged warning); whole-file JSS/JSG locking is coarse (PUB-010), which D22 addresses with part-level leases; a JSS or JSG document also carries cross-chapter data (identity record, numbering, front matter), so the part merge must be tested on exactly those.

**Acceptance criteria.** G-REL-2 (n=100 kill points, 0 torn files) and G-REL-4 (0 silent overwrites over 1,000 saves per case) PASS.

**Test cases.** Kill-during-write harness; concurrent-save property test; per-route guard presence test generated from the route table.

#### WP-12 - Data protection: complete backup, tested restore, safe migrations, retention

| Field | Value |
|---|---|
| ID | WP-12 |
| Phase | 2 |
| Category | Reliability / data |
| Priority | **P1** |
| Complexity | L |
| Class | Mandatory |
| Dependencies | WP-06, WP-10 |
| Findings covered | 19: `PLT-001 (P1, VERIFIED)`, `PLT-005 (P1, VERIFIED)`, `PERF-006 (P1, VERIFIED)`, `PLT-006 (P1, VERIFIED)`, `PLT-007 (P2, VERIFIED)`, `PLT-011 (P2, VERIFIED)`, `PLT-013 (P2, VERIFIED)`, `DEP-001 (P1, OBSERVED)`, `DEP-002 (P1, VERIFIED)`, `DEP-008 (P1, VERIFIED)`, `ENT-006 (P1, VERIFIED)`, `ENT-013 (P2, VERIFIED)`, `ENT-015 (P2, VERIFIED)`, `ARC-005 (P1, OBSERVED)`, `DEP-025 (P2, VERIFIED)`, `PLT-029 (P2, VERIFIED)`, `RES-002 (P2, RECOMMENDATION)`, `DEP-013 (P2, OBSERVED)`, `ARC-003 (P3, OBSERVED)` |

**Problem and current implementation.** The "backup" is a project-folder ZIP without the database (no password hashes, releases, history, config), has no restore and no verification, is built in memory on the event loop (240 MB: a stall of 14.2 s measured by one agent and 9.4 s, +323 MB, by another on a shared host; the streaming project export of the same payload stalls 17 ms) and any signed-in user can call it; the migration snapshot is hard-coded to migration 016; an older build opens a newer database silently; no retention, no integrity check at start.

**Recommended solution.** Backup = SQLite backup-API image + streamed ZIP64 of project files + SHA-256 manifest, administrator-only, scheduled, retention 7/4/12, copy-to-folder/USB; restore (CLI + guided UI) that verifies, restores into a new folder, refuses downgrades; migration framework (ordered files, checksums, `user_version`, generic pre-snapshot, downgrade guard); `quick_check` at start and in `--doctor`; retention jobs; weekly automated restore test.

**Expected outcome.** A recovery path that is measured, not assumed.

**Risks.** The existing ZIP codec in `zipio.ts` may be reusable, but ZIP64 behaviour above 4 GiB is NOT VERIFIED (10); the packaged Node must provide a SQLite online-backup call, to be confirmed with the runtime decision in WP-13.

**Acceptance criteria.** G-REL-1 (100% table/file/audit equality after restore), G-REL-3, G-REL-9 PASS; RPO/RTO stated in the operations guide.

**Test cases.** Restore round-trip on a populated scratch workspace; downgrade refusal; migration fixture matrix.

#### WP-13 - Runtime baseline, version identity and dead-code removal

| Field | Value |
|---|---|
| ID | WP-13 |
| Phase | 2 |
| Category | Release engineering |
| Priority | **P1** |
| Complexity | L |
| Class | Mandatory |
| Dependencies | WP-08 |
| Findings covered | 19: `ENT-008 (P1, VERIFIED)`, `DEP-018 (P2, VERIFIED)`, `DEP-005 (P1, OBSERVED)`, `ARC-009 (P2, SUSPECTED)`, `DEP-004 (P1, VERIFIED)`, `ARC-013 (P2, OBSERVED)`, `FE-018 (P2, OBSERVED)`, `DEP-021 (P2, VERIFIED)`, `FE-022 (P2, OBSERVED)`, `FE-019 (P2, OBSERVED)`, `ARC-004 (P2, OBSERVED)`, `ARC-010 (P3, OBSERVED)`, `ARC-011 (P3, OBSERVED)`, `ARC-012 (P3, OBSERVED)`, `ARC-015 (P3, VERIFIED)`, `ARC-021 (P3, OBSERVED)`, `PLT-025 (P3, VERIFIED)`, `ARC-019 (P3, OBSERVED)`, `PERF-017 (P3, OBSERVED)` |

**Problem and current implementation.** Bundled Node 22 leaves security support on 2027-04-30 and `node:sqlite` is experimental; FOP 2.10/Batik 1.18 and libxslt 1.1.28 (2013, 32-bit) have no patch process; the version is a literal "2.0.0"; ~51 routes and 43 client wrappers are dead; role rules are duplicated client-side.

**Recommended solution.** Decide and record the runtime (Node 24 LTS or a pinned supported line) and re-baseline performance on it; a documented patch cadence for each bundled component; `/api/version` with app/API/schema levels; remove dead routes and wrappers after the owner confirms the screen removals; server-computed `can` map for the client; make the Argon2 module a hard requirement of the package (or refuse to start with a clear message) so a missing optional module cannot lock every user out, and move any password-hash fallback off the event loop (a scrypt fallback blocks the thread 144 ms per login; ARC-019, PERF-017).

**Expected outcome.** The shipped runtime is supported; versions are queryable; attack surface shrinks.

**Risks.** Runtime change can alter `node:sqlite`/crash behaviour: gate with WP-08 and re-run the full suite.

**Acceptance criteria.** G-SEC-11 runtime criterion; `/api/version` consumed by the installer and the future client; dead-route list approved and removed.

**Test cases.** Full chain on the new runtime; route-removal diff reviewed.

### Phase 3 - Document engines and publication: jobs, fidelity, consolidation

#### WP-14 - Job service: validation, gate and publication in worker processes, with reports, archive, cache and a bounded FOP

| Field | Value |
|---|---|
| ID | WP-14 |
| Phase | 3 |
| Category | Architecture / reliability / performance |
| Priority | **P0** |
| Complexity | XL |
| Class | Mandatory |
| Dependencies | WP-11, WP-10, WP-32 |
| Findings covered | 15: `PERF-001 (P0, VERIFIED)`, `PUB-027 (P1, RECOMMENDATION)`, `PUB-003 (P1, VERIFIED)`, `PUB-004 (P1, VERIFIED)`, `PUB-005 (P1, VERIFIED)`, `PUB-006 (P1, VERIFIED)`, `DEP-028 (P1, VERIFIED)`, `PERF-008 (P1, VERIFIED)`, `PERF-012 (P2, VERIFIED)`, `PERF-015 (P3, OBSERVED)`, `PUB-031 (P2, SUSPECTED)`, `PUB-019 (P2, VERIFIED)`, `FE-010 (P2, OBSERVED)`, `FE-028 (P2, VERIFIED)`, `PRD-001 (P1, RECOMMENDATION)` |

**Problem and current implementation.** Node serves every request on one thread, and the whole validation pipeline, the BREX checker and the publication gate (which every publish runs first) are synchronous CPU or file loops inside the HTTP handler: measured stalls of 2.0 s at 200 modules, 6.9 s at 500, 81 s for the 1000-module gate and 168 s for one 1 MB module under BREX, during which no other user is served (PERF-001, VERIFIED). A build is one synchronous request: no deadline, no cancel, no queue, no stored report, no archive; one FOP JVM serves the whole server, grows from 95 to 756 MB, never shrinks, leaks an exit listener and serialises three simultaneous publishes (PERF-008); a suspended FOP JVM blocked every publish for two users while health stayed green (DEP-028, VERIFIED); `GET /publish/download` can start a full build inside a GET (PERF-015); unchanged content is re-validated and re-rendered every time (PERF-012); a release stores only a hash that ignores Media, template and brand; warnings and missing images never reach the user; unresolved native crashes.

**Recommended solution.** Job table (state, log rows, report, input hash) + a small pool of worker processes or `worker_threads` (cores - 1, minimum 1; 2 FOP slots) with a reduced environment + per-job directories + `runTool` with deadline and kill-tree + validation, BREX, applicability, id/ICN scans and the gate as one-module units of work cached by (content hash, BREX chain hash, schema issue) + admission control (one or two validation jobs server-wide, the rest queued) + a FOP pool with restart, heap limits and listener fix + build report returned and stored + release archive (PDF + fingerprint inputs) + cache by input hash with an "up to date" answer for unchanged content + WebSocket progress with replay; `GET /publish/download` serves an existing artefact and never builds; keep the blocking route as a compatibility wrapper; **start every worker and the FOP JVM inside a Windows job object** (per-process and per-job memory limit, CPU rate cap, active-process limit, kill-on-close) with a supervisor that restarts a crashed worker and fails only its job, and call every document engine through one interface so it can be moved out of the process later (addendum 17, PRD-001). The design and the incremental migration steps are in the engines part of 03-ARCHITECTURE-AUDIT.md (sections 5 and 7).

**Expected outcome.** One hung build is a failed job, not an outage; releases are reproducible and auditable.

**Risks.** Memory budget per slot (one FOP build peaked near 480 MB per 03, and the JVM reached 756 MB over repeated builds per 04; re-measure on the chosen runtime); Windows kill-tree behaviour; workers must resolve `vendor/` in the packaged layout; the JSON report (findings and their order) must stay identical to today on the existing fixtures; tests that call services in-process need a synchronous fallback; keep the vendor-exception discipline and the golden tests as the guard.

**Acceptance criteria.** A suspended JVM fails only its job within the deadline and the next build succeeds (DEP-028 re-run); cancel works; `GET /jobs/:id` replays progress after reconnect; while a 200-module BREX validation runs, `/api/health` and `/api/auth/me` have p99 below 100 ms and the 1000-module validation shows event-loop max below 100 ms (B8, T1, T2); a second validation of an unchanged project takes at most 20% of the first; killing a worker mid-job returns a clear error and the next job works; the JVM working set stays under the configured cap over 100 builds (T15); a worker that exceeds its limit is terminated by the operating system and only its job fails; killing the server leaves no orphan `java.exe` (PRD-001).

**Test cases.** Hang simulation, cancel, parallel-build, restart-during-build, report content, cache hit/miss; event-loop delay during validation at 200 and 1000 modules with a second client polling health every 20 ms and a third saving a module every second; worker killed; job timeout; 100 consecutive builds with listener-warning and JVM-growth checks (B5, B8).

#### WP-33 - S1000D FO-stage scaling (the vendored stylesheet)

| Field | Value |
|---|---|
| ID | WP-33 |
| Phase | 3 |
| Category | Document-processing performance |
| Priority | **P0** |
| Complexity | L |
| Class | Mandatory for S1000D manuals above about 50 figure-bearing modules (confirm typical size, decision D15) |
| Dependencies | WP-08 |
| Findings covered | 1: `PERF-003 (P0, VERIFIED)` |

**Problem and current implementation.** Publication time of the S1000D FO stage grows super-quadratically with figure-bearing modules (VERIFIED on the audit host): the single `xsltproc` run took 0.27 s for 3 modules, 14.65 s for 50 and 154 s for 100 on synthetic modules, and 36.5 s for 100 clones of the repository's own e2e fixture (factors 6.5x to 10.5x per doubling); in the server the 100-module publish spent 154.4 s of 166.3 s in "Rendering XSL-FO". Removing the figures cut 50 modules from 14.65 s to 1.58 s. Profiling ranks the List of Illustrations template first; the cause (OBSERVED, consistent with every experiment) is a per-figure whole-document scan and a `preceding::` duplicate-id count in `frontmatter-s1000d.xsl` and `s1000dtofo.xsl`, i.e. O(figures x document). The repository's own baseline of 73.2 s for a 500-module PDF could not be reproduced on this host and why is NOT VERIFIED (a different libxslt/OS and different data are candidates); a 500-module run was not performed and the "about an hour" figure is an extrapolation.

**Recommended solution.** Replace the per-figure whole-document scans by keys and once-computed variables (compute the first titled figure once outside the loop; build the duplicate-id suffix from a keyed position instead of `preceding::`); profile the other front-matter and numbering templates at 100 modules before and after; keep XPath 1.0 (the bundled libxslt 1.1.28 has no XSLT 2.0 grouping); add the FO-stage scaling benchmark B6 to the gate so a regression shows within minutes. The output must not change: FO and PDF stay byte-identical on the golden sets, and the vendor-exception rules of the JSS stylesheet work are respected.

**Expected outcome.** The FO stage of 100 modules falls from 36-154 s to under 10 s with growth no worse than n^1.3; a full 100-module publish takes about 40 s instead of 179 s.

**Risks.** High regression risk: the stylesheet produces numbering and cross-references, and changed ids or numbering break references to a repeated id (a reference must resolve to its first occurrence); behaviour on a newer libxslt must be re-checked if the toolchain is updated; a build cache (PERF-012, WP-14) would hide this problem rather than fix it; absolute times come from a shared host. First task: re-run B6 on the reference machine and, if possible, on a project of the owner's real size.

**Acceptance criteria.** FO output byte-identical before and after for the sample, the fixture clones and the Xignal golden set; B6: 100 modules at most 10 s with a 50-to-100 ratio of at most 2.5x; a full 100-module publish at most 40 s.

**Test cases.** Figures with duplicate ids across modules; zero figures; one module with 200 figures; a 500-module run; a cross-reference to a repeated id; golden-xignal and sample-compare comparisons before and after.

#### WP-15 - JSG parity and conversion fidelity

| Field | Value |
|---|---|
| ID | WP-15 |
| Phase | 3 |
| Category | Functional |
| Priority | **P1** |
| Complexity | L |
| Class | Recommended |
| Dependencies | WP-14 |
| Findings covered | 9: `PUB-011 (P2, VERIFIED)`, `PUB-008 (P1, VERIFIED)`, `PUB-009 (P1, VERIFIED)`, `PUB-015 (P2, VERIFIED)`, `ARC-024 (P2, SUSPECTED)`, `PUB-016 (P2, VERIFIED)`, `PUB-017 (P2, VERIFIED)`, `PUB-018 (P2, VERIFIED)`, `GAP-005 (P3, NOT VERIFIED)` |

**Problem and current implementation.** JSG has no release, watermark, review or warm FOP; S1000D->JSS/JSG conversion loses pictures stored in `csdb/` and a JSS `<warning>` makes the S1000D export fail; the S1000D this platform writes is itself schema-invalid in places; PDFs have no document properties/tags and embed Arial; HTML publish is backend-only.

**Recommended solution.** Put JSG on the shared runner and release flow; pack artwork from `csdb/`; map warning/caution blocks; schema-validate generated S1000D in tests; PDF metadata and (where feasible) tagged PDF; decide HTML publish scope with the owner.

**Expected outcome.** The three formats behave the same wherever they should.

**Risks.** Arial licence/embedding is an owner decision (memory: Arial kept).

**Acceptance criteria.** Round-trip test preserves pictures; JSG release works; generated S1000D validates.

**Test cases.** Conversion round-trip with pictures; JSG build/release; schema validation of exported S1000D.

#### WP-16 - One validation framework and shared helpers

| Field | Value |
|---|---|
| ID | WP-16 |
| Phase | 3 |
| Category | Maintainability |
| Priority | **P2** |
| Complexity | M |
| Class | Recommended |
| Dependencies | WP-10 |
| Findings covered | 9: `S1K-002 (P2, VERIFIED)`, `S1K-003 (P2, VERIFIED)`, `S1K-006 (P2, OBSERVED)`, `S1K-007 (P3, OBSERVED)`, `PUB-022 (P2, OBSERVED)`, `ARC-007 (P2, OBSERVED)`, `ARC-008 (P3, OBSERVED)`, `ARC-018 (P3, OBSERVED)`, `PUB-028 (P2, VERIFIED)` |

**Problem and current implementation.** Server and browser each carry a BREX/xsd-regex implementation (already diverged once); waiver subject matching is fuzzy; `publishGate` hard-codes a JSS branch; the JSS/JSG model is written 4 times, 14 XML escapers, 5 hash helpers; `jss-guard` is a deny-list.

**Recommended solution.** One validation runner and finding model with rule sets per standard; generate or share the browser BREX/xsd-regex from one source; format-neutral gate interface; shared XML/zip/png/hash helpers; allow-list instead of deny-list for JSS routes.

**Expected outcome.** A fix is made once; results cannot disagree.

**Risks.** Parity suite must stay green throughout.

**Acceptance criteria.** Parity suite unchanged; duplicate-function scan (ARC-007 method) shows the groups removed.

**Test cases.** BREX parity suite; helper unit tests.

### Phase 4 - Performance and scalability

#### WP-17 - Backend, database and validation performance

| Field | Value |
|---|---|
| ID | WP-17 |
| Phase | 4 |
| Category | Performance |
| Priority | **P1** |
| Complexity | L |
| Class | Recommended (measured) |
| Dependencies | WP-13, WP-14 |
| Findings covered | 8: `PERF-004 (P1, VERIFIED)`, `PERF-005 (P1, VERIFIED)`, `PERF-007 (P1, VERIFIED)`, `PLT-008 (P2, VERIFIED)`, `PERF-009 (P2, VERIFIED)`, `PERF-011 (P2, VERIFIED)`, `PERF-013 (P2, VERIFIED)`, `PERF-014 (P2, VERIFIED)` |

**Problem and current implementation.** BREX checking costs about 85 ms per small module and grows about size^1.7 because the pure-JS XPath engine over xmldom is the hot spot (75% of a 200-module BREX run is in `evaluateXPath`; PERF-004). Every save, create and read endpoint re-reads the whole CSDB, so cost is linear in module count: save 15 ms at 3 modules and 166 ms at 1000, create 551 ms, `/release` 2.2 s (PERF-005). The member-only dashboard is O(folders x all projects on the platform): 3.2 s at 60 folders and 271 projects against 55 ms folder-less (PERF-007, PLT-008). SQLite is opened with WAL only: an autocommit write costs 3.26 ms against 0.08 ms with `synchronous=NORMAL`, there is no busy timeout and no boot-time check (PERF-009). JSS document GET runs a full validation on every read (PERF-011); one `xsltproc` is spawned per module for well-formedness, which is 41% of validation time on Windows (PERF-013); large bodies stall the thread and every revision stores a full copy (PERF-014). The database is not the bottleneck anywhere that was measured: all hot spots are file scans and CPU (04).

**Recommended solution.** As recommended per finding in 04 (each carries root cause, change, benefit, regression risk and acceptance): a per-project CSDB index updated in place by the writers (all of which already pass through `csdb.ts` and `projectArchive.ts`), so uniqueness checks and listings are lookups, with the release state memoised and the fingerprint incremental (PERF-005); a per-module BREX result cache plus one-traversal evaluation of the simple absolute-path rules, with any replacement XPath engine chosen only after measuring candidates on benchmark B4 (PERF-004); compute the user's project set once and paginate `/api/projects` for the dashboard (PERF-007); cache the JSS report by content hash (PERF-011); in-process well-formedness checks, keeping `xsltproc` for the build only (PERF-013); a documented maximum module size, compressed or delta revisions and retention (PERF-014, with PLT-007 in WP-12); SQLite at open with `synchronous=NORMAL` (consistent after an application crash; may lose only the latest commits on a power cut; keep FULL during migrations), `busy_timeout=5000`, a larger cache, `quick_check` at boot, WAL checkpoint on idle and shutdown, multi-statement mutations inside the existing transaction helper (PERF-009). Re-baseline on the runtime chosen in WP-13 before starting.

**Expected outcome.** Targets T3-T9, T12, T16 and T18 of 04 met and guarded by benchmarks B1-B4, B10 and B12.

**Risks.** Optimising before the job service exists wastes effort (hence the dependency); `synchronous=NORMAL` is a durability trade-off that the owner must accept (decision D14); an index or cache is a new place for stale-data bugs, so it needs invalidation tests; absolute figures in 04 come from a shared host with up to 2x variation.

**Acceptance criteria.** G-PERF-1..4 with thresholds taken from the baseline on the reference machine; save at 1000 modules at most 20 ms, create at most 50 ms and flat, `/summary` and `/release` at most 100 ms, member-only dashboard at 60 folders at most 100 ms, autocommit write at most 0.2 ms, boot logs `quick_check: ok`; findings and their order unchanged on the existing fixtures.

**Test cases.** The benchmark suite of 04 section 6 (B1-B4, B10, B12) with 5 repeats and ratio checks for super-linear shapes; a deliberate second writer waits instead of failing; cache-invalidation tests (edit, delete, restore, import).

#### WP-18 - Frontend performance and delivery

| Field | Value |
|---|---|
| ID | WP-18 |
| Phase | 4 |
| Category | Performance |
| Priority | **P2** |
| Complexity | M |
| Class | Recommended (measured) |
| Dependencies | WP-05 |
| Findings covered | 9: `FE-020 (P2, VERIFIED)`, `FE-027 (P2, VERIFIED)`, `FE-029 (P2, VERIFIED)`, `FE-030 (P2, VERIFIED)`, `FE-031 (P2, VERIFIED)`, `FE-032 (P2, OBSERVED)`, `FE-026 (P3, OBSERVED)`, `FE-033 (P3, RECOMMENDATION)`, `PERF-016 (P3, OBSERVED)` |

**Problem and current implementation.** No compression and max-age=0 on hashed assets (593 KB initial raw vs 161 KB gzip); one save = PUT + 6 GETs; every row of long lists is rendered (FE-030); /summary 573 ms and /brex/missing 258 ms at 500 DMs; duplicate pdfmake/Roboto (2.75 MB) and a 38 MB duplicate schema tree; no request cache/dedupe.

**Recommended solution.** Compression + immutable caching for hashed assets; small query layer with dedupe/cancel/TTL; virtualise the long lists; share worker chunks (or worker-only path); single copy of the schemas; server-side summary caching; paginate or window the long lists (107 KB `/api/projects`, 815 KB `/dms`; PERF-016).

**Expected outcome.** Faster load, fewer requests, smaller installer.

**Risks.** Query layer is a new place for cache bugs: short TTLs and tests.

**Acceptance criteria.** The budgets set in 04-PERFORMANCE-AUDIT (initial JS, requests per save, rendered rows for long lists) are met.

**Test cases.** Playwright performance probes with budgets; bundle-size check in CI.

### Phase 5 - Design system and dark/light themes

#### WP-19 - Design tokens, component states and dark/light parity

| Field | Value |
|---|---|
| ID | WP-19 |
| Phase | 5 |
| Category | Design system |
| Priority | **P1** |
| Complexity | L |
| Class | Recommended (core to the requested UI outcome) |
| Dependencies | none |
| Findings covered | 19: `DS-001 (P1, VERIFIED)`, `DS-002 (P1, VERIFIED)`, `DS-003 (P2, VERIFIED)`, `DS-005 (P2, VERIFIED)`, `DS-006 (P2, VERIFIED)`, `DS-007 (P2, VERIFIED)`, `DS-008 (P2, VERIFIED)`, `DS-009 (P2, OBSERVED)`, `TH-001 (P1, VERIFIED)`, `TH-002 (P1, VERIFIED)`, `TH-003 (P1, VERIFIED)`, `TH-004 (P2, VERIFIED)`, `TH-005 (P2, VERIFIED)`, `TH-006 (P2, OBSERVED)`, `TH-007 (P2, VERIFIED)`, `TH-008 (P3, VERIFIED)`, `UID-002 (P2, VERIFIED)`, `UID-003 (P2, VERIFIED)`, `UID-004 (P3, SUSPECTED)` |

**Problem and current implementation.** Four token vocabularies and 362 colour literals in 21 files; disabled/busy states identical to enabled; the JSG editor is not themed in dark; 15 failing token pairs (7 reached the screen); the administrator accent is unvalidated (1.51:1 possible); no overflow/density strategy; fonts named but not shipped.

**Recommended solution.** The three-tier token set of 07/08 generated from one definition; migrate the shell, Studio, JSS, JSG and CodeMirror/pdf viewer to it phase by phase behind the report-only lint; component states; contrast guard for the accent; density modes; forced-colors; bundle a licensed mono and UI font or define the offline stack.

**Expected outcome.** One vocabulary, two first-class themes, every state defined.

**Risks.** Legacy CSS specificity (TH-001); migrate one surface at a time with screenshots.

**Acceptance criteria.** 0 colour literals outside tokens; every checked pair >= 4.5:1 (3:1 for UI components) in both themes; the 214-execution component x state matrix of 08 passes.

**Test cases.** Lint, token-coverage and contrast scripts; per-theme visual regression.

#### WP-20 - Automated theme and visual validation

| Field | Value |
|---|---|
| ID | WP-20 |
| Phase | 5 |
| Category | Quality |
| Priority | **P2** |
| Complexity | L |
| Class | Recommended |
| Dependencies | WP-08, WP-19 |
| Findings covered | 5: `TH-009 (P2, RECOMMENDATION)`, `QA-012 (P2, VERIFIED)`, `RES-007 (P2, RECOMMENDATION)`, `QA-013 (P2, VERIFIED)`, `DS-010 (P3, RECOMMENDATION)` |

**Problem and current implementation.** No automated theme, accessibility or visual regression of any kind; performance and scale are measured by hand.

**Recommended solution.** The validation plan of 08 section 7: hard-coded-colour lint (report-only first), token coverage, contrast tests, per-theme Playwright snapshots, axe on the ten named routes, component-level theme tests; performance probes as gated tests.

**Expected outcome.** Theme and accessibility regressions fail the build.

**Risks.** Snapshot flake; pin the browser and fonts.

**Acceptance criteria.** G-UX-1, G-UX-3 automated; baselines reviewed once and versioned.

**Test cases.** The suites themselves.

#### WP-34 - Feature-preservation baseline and parity harness (before any screen is redesigned)

| Field | Value |
|---|---|
| ID | WP-34 |
| Phase | 5 |
| Category | Quality / UX |
| Priority | **P2** |
| Complexity | M |
| Class | Recommended (required by the owner for any redesign: no feature lost) |
| Dependencies | WP-08 |
| Findings covered | 1: `GAP-009 (P2, VERIFIED)` |

**Problem and current implementation.** The owner's first requirement for a redesign is that not one feature is lost, and nothing can prove it: the 126-feature inventory is prose, the browser suite cannot finish with its default browser (Chrome stable crashes in the Studio; it is green on Edge: GAP-007, UX-011), and there is no machine-readable list of routes, rail items per project kind, commands, accelerators and test ids. A text scan finds 25 route declarations, 10 rail item lines, 87 literal Studio commands (plus five generator sites), 337 test ids in 58 files.

**Recommended solution.** Keep the read-only baseline of report 16 (the `baseline/` folder) under version control; move the generator scripts into `frontend/scripts/`; add a run-time dump of the Studio command registry and a registry for the JSS and JSG shortcuts; maintain the per-screen-group checklist of report 16 section 5.4 (old control, new home, guarding test, sign-off) and the manual walk-through of section 5.5; make "baseline diff explained row by row" a gate for every redesign batch.

**Expected outcome.** A removed route, rail item, command, key or test id cannot pass a batch unnoticed; the regression comparison the brief asks for exists.

**Risks.** A text scan under-counts (the files say so); the run-time dump needs a browser that runs the Studio (Edge does; decision D18).

**Acceptance criteria.** The generated files equal the committed ones at the start of Phase 2; at the end every difference has a checklist row with a reason; the number of unexplained differences is zero; the before and after results of all suites are in one table.

**Test cases.** A unit test that runs the generators and fails on any difference not listed in an allow-file; review of the checklist by the owner per batch.

### Phase 6 - UI/UX redesign and workflow improvements

#### WP-21 - Editor host contract and unified editor chrome

| Field | Value |
|---|---|
| ID | WP-21 |
| Phase | 6 |
| Category | UX / architecture |
| Priority | **P1** |
| Complexity | XL |
| Class | Recommended (core to the requested UI outcome) |
| Dependencies | WP-05, WP-19 |
| Findings covered | 9: `UX-003 (P1, VERIFIED)`, `UX-002 (P1, VERIFIED)`, `UX-017 (P2, VERIFIED)`, `UX-012 (P2, VERIFIED)`, `UX-020 (P2, VERIFIED)`, `FE-021 (P2, OBSERVED)`, `FE-025 (P2, OBSERVED)`, `PRD-004 (P2, RECOMMENDATION)`, `GAP-004 (P2, VERIFIED)` |

**Problem and current implementation.** Three editors behave as three products (headers, save vocabularies, shortcuts; JSS has no find or palette); the editing surface is 29% of a 1366x768 screen; the shell re-implements dirty/save/session per editor.

**Recommended solution.** One `useEditorHost` contract (dirty, save, session, shortcuts, drafts) and one workspace shell with three document adapters; collapsible panels, command palette, find/replace for JSS; the editor layout of 06 section 7 and mockups/editor.html; keep the framework-free editors, unify their chrome; the host contract carries one **conflict comparison** dialog (server version against the author version, per-change selection for non-overlapping changes, validation before save; addendum 17, PRD-004).

**Expected outcome.** The editing area is the primary focus; behaviour is the same everywhere.

**Risks.** Largest UI change; ship per editor behind a switch, JSS first.

**Acceptance criteria.** In Write mode the editing surface takes at least 55% of a 1366x768 screen (the figure proposed in 06 section 7; confirm in the first usability round, G-UX-6); same save/dirty/shortcut set in all editors.

**Test cases.** Playwright editor-chrome conformance spec run against all three editors.

#### WP-22 - Navigation, project home, problems and review workflow

| Field | Value |
|---|---|
| ID | WP-22 |
| Phase | 6 |
| Category | UX |
| Priority | **P1** |
| Complexity | L |
| Class | Recommended |
| Dependencies | WP-19, WP-21 |
| Findings covered | 15: `UX-007 (P1, VERIFIED)`, `UX-008 (P1, VERIFIED)`, `UX-009 (P1, VERIFIED)`, `UX-013 (P2, OBSERVED)`, `UX-014 (P2, VERIFIED)`, `UX-021 (P2, RECOMMENDATION)`, `UX-024 (P3, OBSERVED)`, `UX-025 (P3, VERIFIED)`, `UX-029 (P3, NOT VERIFIED)`, `FE-015 (P2, OBSERVED)`, `FE-016 (P2, VERIFIED)`, `PRD-003 (P2, RECOMMENDATION)`, `GAP-003 (P2, VERIFIED)`, `GAP-006 (P3, NOT VERIFIED)`, `GAP-008 (P3, RECOMMENDATION)` |

**Problem and current implementation.** No project home; icon-only rail; five problem surfaces; review comments only on the Release page; "reviewed" marks in localStorage; three tree views; no quick switcher or global search; no error boundary or offline handling.

**Recommended solution.** Navigation of 06 section 6 (Home, Project Home, Write, Structure, Graphics, Check, Review and release); one problems model server-side; review comments surfaced in the editors; Ctrl+K switcher; error boundaries and connection-lost banner; **lease holders and presence** on Explore, Publication and the editors (a read-only open of a leased module, a notice when it is released; addendum 17, PRD-003).

**Expected outcome.** Authors, reviewers, publishers and admins each land on what needs them.

**Risks.** Review data model needs a small server change (reviewed marks).

**Acceptance criteria.** The five core tasks completed keyboard-only (G-UX-2); first-use task success measured with >= 5 users (G-UX-6).

**Test cases.** Task-flow e2e; usability round.

#### WP-23 - Accessibility to WCAG 2.2 AA

| Field | Value |
|---|---|
| ID | WP-23 |
| Phase | 6 |
| Category | UX / compliance |
| Priority | **P1** |
| Complexity | M |
| Class | Mandatory for enterprise procurement |
| Dependencies | WP-20 |
| Findings covered | 7: `UX-004 (P1, VERIFIED)`, `UX-005 (P1, VERIFIED)`, `FE-014 (P2, VERIFIED)`, `ENT-018 (P2, SUSPECTED)`, `UX-010 (P1, VERIFIED)`, `UX-027 (P3, SUSPECTED)`, `UX-028 (P3, VERIFIED)` |

**Problem and current implementation.** Dialogs do not trap or restore focus; no landmarks or skip link; rows and menus only partly keyboard-operable; conformance unmeasured; JSS has no autosave.

**Recommended solution.** Accessible primitives (`Modal`, row links, menus), landmarks, skip link, focus-visible everywhere; axe gate; manual screen-reader pass on three routes; autosave/draft for JSS (if not done in WP-05).

**Expected outcome.** Measured conformance instead of a claim.

**Risks.** Hand-built widgets need manual review beyond axe.

**Acceptance criteria.** G-UX-1 (0 serious/critical), G-UX-2, G-UX-4.

**Test cases.** axe via Playwright; keyboard task scripts.

#### WP-35 - Screen-by-screen redesign of the remaining screens on the design system

| Field | Value |
|---|---|
| ID | WP-35 |
| Phase | 6 |
| Category | UX |
| Priority | **P2** |
| Complexity | XL |
| Class | Recommended (requested by the owner: Phase 2 brief) |
| Dependencies | WP-19, WP-20, WP-21, WP-22, WP-34 |
| Findings covered | 3: `GAP-002 (P2, VERIFIED)`, `UID-001 (P2, VERIFIED)`, `UID-005 (P3, RECOMMENDATION)` |

**Problem and current implementation.** The roadmap has packages for the design system (WP-19), editor chrome (WP-21), navigation and review (WP-22) and accessibility (WP-23), but none that redesigns the screens in between: sign-in and onboarding, settings and backup, the wizard and import dialogs, Explore, Release and the reviewer reader, Graphics, CIR, Ancillary pages, S1000D settings and catalogue administration, Activity and Notifications, preview windows, empty/error/offline states (report 16 section 8.2). Six mockups exist; most screens have none. Details the brief names are open: password show/hide (UID-001), eleven native browser dialogs next to the themed modals (GAP-002), no context menus (UID-005).

**Recommended solution.** After the owner approves a direction (decision D20), design and build these screens in batches (auth and settings; workspace, projects, wizard, import; project pages; editor chrome per editor, JSS first), each behind one switch and flipped only when its rows of the checklist (WP-34) are signed, using the components of WP-19 (field with validation, password field, tooltip, select, dialog service, context menu). Replace every native dialog by the dialog service.

**Expected outcome.** One consistent product on tokens in both themes, with every feature still reachable.

**Risks.** Largest UI change; scope growth: the screen list of report 16 section 8.2 is the scope. Two designs must never be mixed in one navigation: batch switches.

**Acceptance criteria.** Every screen of 16 section 8.2 and of the project rail is on the tokens in both themes at 1280, 1366 and 1920 px and at 125 % and 150 % scaling; the criteria of report 16 section 7 hold; the checklist of 16 section 5.4 is signed; zero native dialogs in the source; G-UX-1 to G-UX-3 pass on the ten named routes.

**Test cases.** Per-screen Playwright in both themes and three sizes with screenshot baselines; axe scans; keyboard-only walk-through of the five core tasks (G-UX-2); the architecture test for native dialogs.

#### WP-36 - Post-redesign cleanup and the removal-completeness gate

| Field | Value |
|---|---|
| ID | WP-36 |
| Phase | 6 |
| Category | Maintainability |
| Priority | **P3** |
| Complexity | M |
| Class | Recommended (requested by the owner, after regression sign-off) |
| Dependencies | WP-35, WP-13, WP-34 |
| Findings covered | 4: `CLN-001 (P3, VERIFIED)`, `CLN-002 (P3, VERIFIED)`, `CLN-003 (P3, VERIFIED)`, `CLN-004 (P3, VERIFIED)` |
| Related findings carried by another package | ARC-013 and FE-018 (dead routes and client wrappers) are carried by WP-13 and decision D8; WP-36 repeats the front-end sweep after the redesign because the redesign orphans code |

**Problem and current implementation.** Features removed from the screens leave their routes, wrappers, helpers and styles behind (CLN-004): one orphan file, 16 exports referenced nowhere (three are leftovers of the removed SNS and Brand pack screens), 20 dead CSS classes (the applicability UI among them), one unused meta-package. The redesign will create more.

**Recommended solution.** After the regression sign-off of WP-35, run the register of report 16 section 6 once: remove what is verified unused (build, tests, visual diff per item), keep the ambient declarations, generated classes and library classes the scan cannot see, and add the unreferenced-export and class report to the gate with a reasoned allow-list and a removal checklist in the pull request template.

**Expected outcome.** A smaller front end with the dead-code count at zero and no growth.

**Risks.** A name used by a string or a generated class the scan cannot see; a visual diff and the suites before and after cover it. Server routes need the owner's confirmation (D8, D19).

**Acceptance criteria.** The listed items are removed with no difference in the baseline diff, the visual comparison or the suites; the report shows zero unreferenced exports and classes outside the allow-list.

**Test cases.** Build, unit, browser and backend suites before and after; the report script has its own tests.

### Phase 7 - Mode A: the standalone one-click product

#### WP-24 - Release engineering: signing, SBOM, integrity, offline verification

| Field | Value |
|---|---|
| ID | WP-24 |
| Phase | 7 |
| Category | Release engineering |
| Priority | **P1** |
| Complexity | L |
| Class | Mandatory |
| Dependencies | WP-13 |
| Findings covered | 11: `DEP-003 (P1, VERIFIED)`, `ENT-014 (P2, VERIFIED)`, `RES-005 (P2, RECOMMENDATION)`, `DEP-020 (P2, VERIFIED)`, `DEP-006 (P1, VERIFIED)`, `DEP-014 (P2, OBSERVED)`, `DEP-019 (P2, OBSERVED)`, `DEP-026 (P3, RECOMMENDATION)`, `ENT-007 (P1, VERIFIED)`, `DEP-024 (P2, RECOMMENDATION)`, `RES-006 (P2, RECOMMENDATION)` |

**Problem and current implementation.** Setup, host executables and `xsltproc.exe` are unsigned (the script has no timestamp by default); no SBOM or detection rule; the offline claim is proven for one format on a host with a NIC; the Windows support matrix is untested; no support bundle; static health; unstructured logs.

**Recommended solution.** Signing pipeline with timestamp using an organisation CA/certificate (SIGNING.md), SBOM, SHA-256 + signature verification offline; clean no-NIC VM matrix (Windows 10/11, Server 2019/2022/2025) running the full workflow; structured logs with correlation ids, readiness endpoint, support bundle that never contains secrets.

**Expected outcome.** Artefacts that managed endpoints accept and support can diagnose.

**Risks.** Certificate procurement/internal CA rollout is an owner task.

**Acceptance criteria.** G-SEC-11, G-OFF-1..4, G-DEP-3, G-DEP-4 PASS.

**Test cases.** VM acceptance scripts extended (signature check, no-NIC workflow, doctor fault injection).

#### WP-25 - Standalone installer, launcher, offline update and rollback (Mode A)

| Field | Value |
|---|---|
| ID | WP-25 |
| Phase | 7 |
| Category | Deployment |
| Priority | **P1** |
| Complexity | XL |
| Class | Mandatory (Mode A) |
| Dependencies | WP-12, WP-13, WP-24 |
| Findings covered | 3: `DEP-023 (P2, OBSERVED)`, `QA-009 (P1, VERIFIED)`, `PRD-005 (P2, RECOMMENDATION)` |

**Problem and current implementation.** Program files are replaced in place so rollback means reinstalling; the upgrade test is same-version only; no downgrade guard in the installer path; no signed update package.

**Recommended solution.** Per 09: Inno Setup family; versioned program folders with an atomic pointer and automatic rollback on failed health check; `Product-Standalone-Setup.exe` with loopback server + WebView2 launcher (fallback to the default browser); `Product-Offline-Update` (signed, version-checked, pre-update backup via WP-12, data preserved); silent switches and exit codes documented; **WebView2 runtime provisioning**: detect at install and at start, bundle the offline (standalone) runtime installer with every release so each offline update refreshes it, report its version in `/api/version`, keep the default-browser fallback with a visible notice (addendum 17, PRD-005).

**Expected outcome.** One-click install, safe upgrade, one-click rollback, clean uninstall.

**Risks.** WebView2 on Server SKUs is NOT VERIFIED; keep the browser fallback.

**Acceptance criteria.** G-DEP-1, G-DEP-2 (<= 1 mandatory decision), G-DEP-5, G-REL-3 PASS on clean VMs.

**Test cases.** VM matrix: install, upgrade N-2 -> N, rollback, repair, uninstall (keep/remove data).

### Phase 8 - Mode B: client-server

#### WP-26 - Network security and the client/server protocol

| Field | Value |
|---|---|
| ID | WP-26 |
| Phase | 8 |
| Category | Security / deployment |
| Priority | **P1** |
| Complexity | L |
| Class | Mandatory for Mode B |
| Dependencies | WP-03, WP-13 |
| Findings covered | 3: `ENT-001 (P1, VERIFIED)`, `SEC-006 (P1, VERIFIED)`, `DEP-010 (P1, VERIFIED)` |

**Problem and current implementation.** No TLS: the installer's LAN option sends passwords and session cookies in clear; no version handshake.

**Recommended solution.** Native TLS (internal CA or self-signed with pinned thumbprint distributed by the server installer) or a documented proxy; refuse non-loopback binding without TLS; `/api/version` handshake enforced by the client; secure cookies; HSTS for server mode.

**Expected outcome.** Mode B is safe on a private network.

**Risks.** Certificate lifecycle on air-gapped networks needs a documented rotation.

**Acceptance criteria.** G-SEC-1 PASS (0 plain-HTTP responses on non-loopback listeners).

**Test cases.** Listener scan; handshake refusal tests (old client, newer server).

#### WP-27 - Directory sign-on, central administration and fine-grained permissions

| Field | Value |
|---|---|
| ID | WP-27 |
| Phase | 8 |
| Category | Enterprise |
| Priority | **P1** |
| Complexity | L |
| Class | Enterprise, customer-driven |
| Dependencies | WP-10, WP-26 |
| Findings covered | 6: `ENT-005 (P1, VERIFIED)`, `DEP-015 (P2, RECOMMENDATION)`, `PLT-016 (P1, OBSERVED)`, `ENT-023 (P3, OBSERVED)`, `ENT-022 (P3, OBSERVED)`, `RES-003 (P3, RECOMMENDATION)` |

**Problem and current implementation.** Accounts are local only (no LDAP/AD/SSO/MFA); RBAC is five ordered roles with no groups or per-document permissions.

**Recommended solution.** LDAPS first (group-to-role mapping, local break-glass administrator) through the `AuthProvider` seam; optional Kerberos/NTLM later; per-project permissions and groups; capability evaluation instead of the `cap` labels.

**Expected outcome.** Accounts follow the organisation; permissions match roles.

**Risks.** Only where a customer needs it (essential enterprise, not essential production).

**Acceptance criteria.** Directory user can sign in, be mapped and be offboarded centrally; permission matrix test.

**Test cases.** LDAP test double; matrix snapshot.

#### WP-28 - Client and Server installers, central backup, concurrency acceptance

| Field | Value |
|---|---|
| ID | WP-28 |
| Phase | 8 |
| Category | Deployment |
| Priority | **P1** |
| Complexity | XL |
| Class | Mandatory for Mode B |
| Dependencies | WP-25, WP-26, WP-11, WP-12 |
| Findings covered | 1: `PRD-007 (P2, RECOMMENDATION)` |

**Problem and current implementation.** Only one deployment shape exists (09 DEP design): there is no client-only installer, no server-only offline package and no first-run server wizard.

**Recommended solution.** `Product-Client-Setup.exe` (WebView2 shell + first-run server address wizard + handshake + optional local cache) and `Product-Server-Offline-Setup` (service, TLS, firewall rule, central backup schedule, admin guide), both from the same codebase and family of the standalone installer; multi-user acceptance with N scripted authors, where N is the figure of decision D3 (assumed: 25 concurrent, tested at 2x = 50); a written **availability position** (no automatic failover in the first release, daily backup by default and hourly selectable, RPO = time since the last backup, RTO measured at the first drill and published, a warm-standby procedure on a second machine; addendum 17, PRD-007).

**Expected outcome.** Mode B deliverable.

**Risks.** Scale claim must be stated and tested (G-PERF-4 is an owner decision).

**Acceptance criteria.** G-REL-4 at the stated user count; restore drill from the central backup; client/server version matrix.

**Test cases.** Multi-client harness; upgrade order tests (server first, then clients).

#### WP-37 - PostgreSQL storage adapter for Mode B Enterprise (conditional)

| Field | Value |
|---|---|
| ID | WP-37 |
| Phase | 8 |
| Category | Architecture / scalability |
| Priority | **P2** |
| Complexity | XL |
| Class | Enterprise, conditional on decision D21 (build only when a trigger fires or the owner decides) |
| Dependencies | WP-10, WP-12, WP-13, WP-26 |
| Findings covered | 1: `PRD-002 (P2, RECOMMENDATION)` |

**Problem and current implementation.** SQLite is the right engine for one host and short writes, but it cannot serve a second server node, cannot give point-in-time recovery and cannot be shared over a network file system. If the supported scale (D3) or a customer exceeds that, the only answer today would be a rewrite, because about 51 `dbh()` call sites and direct SQL in five services bypass the store.

**Recommended solution.** In phase 2, WP-10 makes the storage seam dialect-clean (repositories, engine-neutral migrations, one contract suite). In phase 8, add a PostgreSQL adapter that passes the same contract suite, a Server-Setup option chosen at install time and stored in the configuration (Mode A never uses it), a PostgreSQL-aware backup and restore (base backup plus archived logs) behind the WP-12 interface, and the install, service-account and upgrade path for an air-gapped site. Build it only if a trigger fires (p95 write latency above 200 ms or event-loop lag above 100 ms under the stated load; more than one server host; point-in-time recovery required; a mandated corporate database) or the owner decides in D21.

**Expected outcome.** The product can scale beyond one host without a rewrite, and the cheaper SQLite deployment stays the default and the only one in Mode A.

**Risks.** A second engine doubles the test matrix and the support surface; SQL differences (types, locking, upsert, dates) stay inside repositories only if WP-10 is strict; PostgreSQL on an air-gapped machine needs its own installer and upgrade path; high availability needs more than the adapter (a second node and a failover procedure).

**Acceptance criteria.** The contract suite passes on both engines in the gate; a restore drill from the PostgreSQL backup passes (G-REL-1, G-REL-3); 50 scripted authors on PostgreSQL meet the thresholds of WP-28; the standalone installer is unchanged.

**Test cases.** Contract suite on both engines; migration up and down; kill-the-database test; restore drill; the WP-28 multi-user acceptance on PostgreSQL.

### Phase 9 - Enterprise administration, audit and operations

#### WP-29 - Audit trail, retention and operations

| Field | Value |
|---|---|
| ID | WP-29 |
| Phase | 9 |
| Category | Enterprise / operations |
| Priority | **P1** |
| Complexity | L |
| Class | Mandatory for enterprise |
| Dependencies | WP-12 |
| Findings covered | 5: `ENT-003 (P1, VERIFIED)`, `REL-008 (P2, VERIFIED)`, `ENT-017 (P2, VERIFIED)`, `ENT-020 (P2, VERIFIED)`, `RES-004 (P2, RECOMMENDATION)` |

**Problem and current implementation.** The audit log is not tamper-evident, fails open, has no retention or off-box export, rows lack the IP, the redactor strips the release fingerprint, waiver reasons are lost.

**Recommended solution.** Hash-chained audit with periodic signed checkpoints and an offline verify command; fail-closed for critical actions; Windows Event Log mirror with stable event ids; retention and archive; waiver history.

**Expected outcome.** Evidence an auditor can trust.

**Risks.** Chain design must tolerate restore.

**Acceptance criteria.** G-SEC-4, G-SEC-5, G-REL-8 PASS.

**Test cases.** Seeded-tamper tests; fault-injected audit write.

### Phase 10 - Final QA, security verification, benchmarking, release

#### WP-30 - Final QA, benchmarking and release

| Field | Value |
|---|---|
| ID | WP-30 |
| Phase | 10 |
| Category | Quality |
| Priority | **P1** |
| Complexity | L |
| Class | Mandatory |
| Dependencies | WP-08, WP-25, WP-28 |
| Findings covered | 2: `QA-006 (P1, VERIFIED)`, `QA-008 (P1, VERIFIED)` |

**Problem and current implementation.** No PDF raster/font/link regression and no chaos tests exist; gates are defined but never executed on a release candidate.

**Recommended solution.** PDF regression (pdftoppm + pixel diff against approved baselines, fonts-embedded and link checks) for the three formats; chaos suite (kill during publish/import/backup/migration); 24 h soak; air-gapped run; independent penetration test; execute every gate of 12 section 8.

**Expected outcome.** A release that is evidenced, not asserted.

**Risks.** None specific.

**Acceptance criteria.** All gates PASS or an owner-signed waiver; findings closed with regression tests named by ID (G-Q-2).

**Test cases.** The gate run itself.

#### WP-31 - Optional, demand-driven items (do only when a customer or the owner asks)

| Field | Value |
|---|---|
| ID | WP-31 |
| Phase | 10 |
| Category | Optional |
| Priority | **P3** |
| Complexity | M |
| Class | Optional |
| Dependencies | none |
| Findings covered | 6: `ENT-019 (P3, VERIFIED)`, `RES-008 (P3, RECOMMENDATION)`, `ENT-021 (P3, OBSERVED)`, `RES-010 (P3, RECOMMENDATION)`, `RES-012 (P3, RECOMMENDATION)`, `PRD-006 (P3, RECOMMENDATION)` |

**Problem and current implementation.** The licence module is dormant (key custody unknown); notifications are in-app only; no MSI/GPO package exists.

**Recommended solution.** Licensing: an offline signed licence file with soft failure and no hardware lock (RES-008) only if the business needs it; internal SMTP relay notifications (RES-010) only for sites that have one; MSI wrapper (RES-012) only when a customer mandates GPO/SCCM; optional **connected services** (update check, signed update download, support-bundle upload) off by default, opt-in per customer, allow-listed host, signed responses, no telemetry (PRD-006, decision D23).

**Expected outcome.** Capabilities exist when someone needs them, without carrying the cost before.

**Risks.** Each adds surface (key management, mail credentials, a second installer).

**Acceptance criteria.** Per item, agreed when the demand exists.

**Test cases.** Per item.

## 7. Root-cause clusters (findings reported more than once)

Different agents reported the same defect under different IDs. They are scheduled once. A finding appears in the package that fixes the root cause.

| Cluster | Finding IDs | Package |
|---|---|---|
| Project settings trusted raw (path traversal, IDOR, forged archive, kind confusion) | SEC-002, S1K-001, PUB-001, PUB-026, QA-020, ARC-022 | WP-01 |
| XML safety guard bypass and missing external-resource policy | SEC-001, PLT-018, SEC-011, PUB-002, PUB-014, SEC-003 | WP-02 |
| Temporary passwords and account takeover | PLT-014, SEC-004, ENT-002 | WP-03 |
| Rate limiter keyed on username+IP and proxy-blind IP | SEC-007, SEC-008, PLT-023, ENT-011 | WP-03 |
| WebSocket outlives the session and ignores Origin | SEC-010, PLT-017, FE-011, ENT-012 | WP-03 |
| No separation of duties on release approval | PLT-015, ENT-009 | WP-03 |
| Installer grants BUILTIN\Users Modify on data folders | ENT-004, SEC-005, DEP-012 | WP-04 |
| "Database backup" is not a database backup and cannot be restored | PLT-001, ENT-006, DEP-008, ARC-005, FE-013, PLT-005, DEP-025, PERF-006 | WP-12, WP-07 |
| Validation, BREX and the gate run on the request thread; one FOP JVM serves everyone; no deadline | PERF-001, PERF-008, DEP-028, PUB-003, PUB-004 | WP-14 |
| Every build and validation starts from zero (no cache) | PUB-019, PERF-012 | WP-14 |
| SQLite opened with defaults: no busy timeout, FULL sync, no integrity check | PLT-002, PERF-009, DEP-017, PLT-013 | WP-06, WP-17, WP-12 |
| Member-only dashboard cost grows with folders x projects | PLT-008, PERF-007 | WP-17 |
| Uploads buffered whole in memory | PLT-021, REL-007, PERF-010 | WP-11 |
| The PDF compression step is wired but does nothing | DEP-027, PUB-016, PERF-019 | WP-07, WP-15 |
| Argon2 module optional: lock-out risk and a blocking scrypt fallback | ARC-019, PERF-017 | WP-13 |
| JSS/JSG source overwritten in place, no history, optional version guard | ARC-001, PUB-007, REL-001, PLT-009, DEP-016, ENT-016, PLT-020, FE-008, REL-002 | WP-11 |
| Builds are synchronous, unbounded and unreported | PUB-003, PUB-004, PUB-005, PUB-006, DEP-028, PUB-027, FE-010 | WP-14 |
| No TLS in LAN mode | ENT-001, SEC-006, DEP-010 | WP-26 |
| No idle timeout / long sessions | SEC-016, ENT-010, PLT-022 | WP-03 |
| Migration snapshot hard-coded and no downgrade guard | PLT-006, DEP-001, DEP-002, ENT-013, PLT-011 | WP-12 |
| Node 22 end of support and experimental node:sqlite | ENT-008, DEP-018, DEP-005 | WP-13 |
| Unsigned artefacts, no SBOM, stale release | DEP-003, ENT-014, DEP-004, RES-005 | WP-24, WP-13 |
| Chrome tab crash and weak responsive spec | UX-011, QA-022, QA-023 | WP-08, WP-09 |
| Modal and keyboard accessibility | UX-004, UX-005, DS-005, FE-014 | WP-23, WP-19 |
| JSS "Publication" Internal error | UX-001, FE-009 | WP-07 |

## 8. Positions on the architectural options (revised by addendum 17)

The first version of this roadmap listed six things it deliberately did not propose. For a production release each now has a position, a production design and a trigger; the reasoning and the evidence are in `17-ADDENDUM-PRODUCTION-ARCHITECTURE-POSITIONS.md` section 3. Where an option is not built, it is because the audit found it would cost more than it removes for an offline, one-click Windows product; each is reversible when its trigger is reached.

| Option | Position | What is built instead or in addition | Change it when |
|---|---|---|---|
| Microservices, broker, containers | Not now: modular monolith with a job service and worker processes (WP-14) | OS resource limits and supervision (PRD-001); every engine behind an interface | The product becomes hosted multi-tenant, or a second server node is needed |
| PostgreSQL | Conditional adapter for Mode B Enterprise (WP-37, D21); SQLite stays for Mode A and the team tier | A dialect-clean storage seam in phase 2 (WP-10) so the adapter is a contained job | p95 write latency above 200 ms or event-loop lag above 100 ms under the stated load; more than one server host; point-in-time recovery required; a mandated corporate database |
| CRDT / operational transform | Not for structure: collaborative check-out | Mandatory hash guard and per-part leases (WP-11, D22); presence (PRD-003); conflict comparison (PRD-004) | A customer needs several people in one data module at once and accepts a validity guard; then free-text leaf elements only |
| React rewrite of the three editors | Replace the surroundings piece by piece; keep the canvases (WP-21, WP-35, D16) | Baseline harness (WP-34), host contract, React toolbars, panels, dialogs and inspectors on the design system | The owner chooses a full rebuild in D16: one editor at a time on the same harness |
| Electron / Tauri / MSIX | No: a thin WebView2 host in the existing C# host, Inno Setup for the installer family (09) | Offline WebView2 runtime provisioning (PRD-005) | A need for OS integration the C# host cannot provide |
| Cloud dependency | None required at run time; optional connected services on demand (WP-31, D23) | Signed update, licence and support exchange by media; connected mode off by default (PRD-006) | A customer asks for connected updates or remote support |

## 9. Risks of the roadmap itself

| Risk | Mitigation |
|---|---|
| Phase 2 touches the core (application context, file writes, backup) and can regress the strongest area (S1000D) | Phase 1B first; golden and isolation tests (G-Q-4) unchanged unless re-baselined with a recorded reason; one service migrated per change |
| The native crash and hangs in the full test run may be inside the runtime or `xmllint-wasm` (QA-019, PUB-031, QA-022) | Investigation is budgeted in WP-08; the runtime decision (WP-13) may resolve it; if not, isolate the affected tests with an explicit, reported skip |
| Installer, service and update behaviour was never executed by the audit (see 15) | The first task of WP-24/WP-25 is a clean-VM, no-network run of the current installer, before any change to it |
| Mandatory version guards change API behaviour | Compatibility window and logged warning (decision D2) |
| Findings labelled OBSERVED or SUSPECTED may not reproduce | Each package starts by turning its observed findings into failing tests (G-Q-2); a finding that does not reproduce is closed with the evidence |
| Scale claims for Mode B are unmeasured (no multi-user load test exists) | Decision D3 and the G-PERF-4 / G-REL-4 acceptance in WP-28 |
| Performance figures in 04 come from a shared Windows Server host on Node 22 where CPU times varied up to 2x, builds are single samples, and the repository's own 500-module baseline (73.2 s, Node 26) could not be reproduced | Treat shapes and ratios as reliable and absolute times as indicative; take the real baseline on a quiet reference machine and the chosen runtime in phase 1B/4, and set thresholds from its own run-to-run spread (G-PERF-3) |
| Effort bands are the finding owners' estimates | Re-estimate each package after its failing tests exist; the audit does not provide calendar time |

## 10. Appendix A - every finding and the package that carries it

Sorted by priority, then by ID. "Report" is the document that contains the full finding (search by ID).

| ID | Pri | Evidence | Size | Package | Title | Report |
|---|---|---|---|---|---|---|
| PERF-001 | P0 | VERIFIED | L | WP-14 | Validation, BREX, the publication gate and CSDB-scanning reads run on the single request thread; one author can freeze the server for every user | 04-PERFORMANCE-AUDIT.md |
| PERF-002 | P0 | VERIFIED | M | WP-32 | The schema pass fails silently above about 8 MB of modules per schema (about 850 modules); the gate then refuses publication naming module 0001; `schemaChecked` still claims every module | 04-PERFORMANCE-AUDIT.md |
| PERF-003 | P0 | VERIFIED | L | WP-33 | The S1000D FO stage (xsltproc, vendored stylesheet) is super-quadratic in figure-bearing modules: 100 modules take 36-154 s here, and the repository's own 500-module PDF baseline cannot be reproduced | 04-PERFORMANCE-AUDIT.md |
| PUB-001 | P0 | VERIFIED | S | WP-01 | Settings route trusts the body: any editor can read any file and write XML to any path, and can change what kind of project it is (cross-ref S1K-001) | 02-FUNCTIONAL-AUDIT.md |
| S1K-001 | P0 | VERIFIED | M | WP-01 | Project settings let any project editor redirect the CSDB/media/publication paths outside the project (and workspace), enabling cross-project read/write and likely host path traversal | 02-FUNCTIONAL-AUDIT.md |
| SEC-001 | P0 | VERIFIED | XL | WP-02 | The XML safety guard is bypassed by a decoy comment, reopening XXE on every XML write route | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-002 | P0 | VERIFIED | L | WP-01 | Unvalidated `project.json` path fields give cross-project IDOR and file access outside the workspace | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-003 | P0 | VERIFIED | L | WP-02 | SSRF (and local-file access) through the publisher-logo field, fetched by FOP during every build | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-011 | P0 | VERIFIED | M | WP-02 | `xi:include` targets are not checked by the XML guard, and local file content reaches the rendered PDF | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| ARC-001 | P1 | OBSERVED | M | WP-11 | A JSS or JSG book is one file, overwritten in place, with no revision history, no backup copy and (JSS) no draft recovery | 01-CODEBASE-UNDERSTANDING.md |
| ARC-005 | P1 | OBSERVED | M | WP-12 | The application's "Backup" is an in-memory file export without the database, has no restore, and the operations guide presents it as an alternative to backing up the data folder | 01-CODEBASE-UNDERSTANDING.md |
| DEP-001 | P1 | OBSERVED | S | WP-12 | The pre-upgrade database copy is best-effort and thin: a fixed 4 s wait, failure only logged, no retention, absent outside the installer | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-002 | P1 | VERIFIED | M | WP-12 | A newer database is opened silently by an older build, and the migration snapshot exists for one migration only | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-003 | P1 | VERIFIED | M | WP-24 | Every Agastya-built binary and the installer ship unsigned, and the signing workflow cannot meet current public-CA rules | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-004 | P1 | VERIFIED | S | WP-13 | Version identity is not managed: "2.0.0" is a literal, the build in `release/` is older than the source, and there is no version/compatibility endpoint | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-005 | P1 | OBSERVED | L | WP-13 | Bundled runtimes have no patch process and some sit inside published advisory ranges | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-006 | P1 | VERIFIED | M | WP-24 | "Works offline" is documented as a guarantee but proven only for one format, on a networked host | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-008 | P1 | VERIFIED | M | WP-12 | "Database backup" in the UI is not a restorable backup, and there is no scheduled or central backup | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-010 | P1 | VERIFIED | M | WP-26 | LAN mode serves login and session cookies over plain HTTP; the server has no TLS, no security headers and no version handshake | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-012 | P1 | OBSERVED | S | WP-04 | A per-machine install grants every local user Modify on the database and state folders | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-016 | P1 | OBSERVED | L | WP-11 | The concurrency model does not support several authors: optional version guards, one restrictive DM lock, no JSS/JSG check-out, last-writer-wins settings | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-028 | P1 | VERIFIED | M | WP-14 | A hung FOP JVM blocks every publish for every user, the health endpoint stays green, and nothing in the server or the host notices | 09-DEPLOYMENT-ARCHITECTURE.md |
| DS-001 | P1 | VERIFIED | L | WP-19 | Four overlapping token vocabularies and no single source of truth | 07-DESIGN-SYSTEM-PROPOSAL.md |
| DS-002 | P1 | VERIFIED | M | WP-19 | Disabled and busy states are missing or identical to the enabled state on core controls | 07-DESIGN-SYSTEM-PROPOSAL.md |
| ENT-001 | P1 | VERIFIED | M | WP-26 | No TLS in the server: credentials and session cookies travel in clear when the product is opened to the LAN | 12-ENTERPRISE-READINESS.md |
| ENT-002 | P1 | VERIFIED | S | WP-03 | Temporary passwords are `username@year`: a new or reset account can be taken over by anyone who knows the username | 12-ENTERPRISE-READINESS.md |
| ENT-003 | P1 | VERIFIED | M | WP-29 | The audit trail is not tamper-evident, fails open, has no retention or off-box export, and is capped on export | 12-ENTERPRISE-READINESS.md |
| ENT-004 | P1 | VERIFIED | M | WP-04 | A per-machine install grants BUILTIN\Users Modify on the data and state folders: any local user can bypass the application's access control | 12-ENTERPRISE-READINESS.md |
| ENT-005 | P1 | VERIFIED | L | WP-27 | No directory or SSO integration: accounts, passwords and offboarding are all local | 12-ENTERPRISE-READINESS.md |
| ENT-006 | P1 | VERIFIED | M | WP-12 | Backup and disaster recovery are incomplete: the in-app backup omits the database, has no restore, is user-reachable and unscheduled | 12-ENTERPRISE-READINESS.md |
| ENT-007 | P1 | VERIFIED | M | WP-24 | Observability is thin for an air-gapped product: static health, unstructured logs, no support bundle, security events not in the Event Log | 12-ENTERPRISE-READINESS.md |
| ENT-008 | P1 | VERIFIED | M | WP-13 | The bundled runtime (Node 22) leaves security support on 2027-04-30 and its SQLite module is still experimental; performance numbers were measured on a different runtime | 12-ENTERPRISE-READINESS.md |
| FE-001 | P1 | VERIFIED | M | WP-05 | Ctrl+S in the JSS/JSG editors is swallowed by the Studio once the S1000D editor has been opened, and can save a stray Studio document into another project | 02-FUNCTIONAL-AUDIT.md |
| FE-002 | P1 | VERIFIED | M | WP-05 | Unsaved work is lost on any in-app navigation: only `beforeunload` guards exist | 02-FUNCTIONAL-AUDIT.md |
| FE-003 | P1 | VERIFIED | M | WP-05 | A revoked or expired session is not noticed while editing, and the first write that gets a 401 destroys the editor and its unsaved text | 02-FUNCTIONAL-AUDIT.md |
| FE-004 | P1 | VERIFIED | S | WP-05 | Any failure of `/api/auth/me` is treated as "signed out"; one 503 swaps the app to the login screen | 02-FUNCTIONAL-AUDIT.md |
| FE-006 | P1 | OBSERVED | M | WP-05 | Studio draft recovery is switched off in platform mode, but the drafts are still written every 2.5 s | 02-FUNCTIONAL-AUDIT.md |
| PERF-004 | P1 | VERIFIED | M | WP-17 | BREX checking costs about 85 ms per small module and grows about size^1.7: the pure-JS XPath engine over xmldom is the hot spot | 04-PERFORMANCE-AUDIT.md |
| PERF-005 | P1 | VERIFIED | M | WP-17 | Every save, create and read endpoint re-reads the whole CSDB; cost per operation is linear in the module count (save 15 to 166 ms, create 40 to 551 ms, `/release` 19 ms to 2.2 s at 1000 modules) | 04-PERFORMANCE-AUDIT.md |
| PERF-006 | P1 | VERIFIED | M | WP-12 | `GET /api/backup` builds the whole ZIP in memory on the event loop with the legacy writer: 240 MB stalls the server for 9.4 s and holds +323 MB; the streaming writer already exists and does the same job with a 17 ms stall | 04-PERFORMANCE-AUDIT.md |
| PERF-007 | P1 | VERIFIED | M | WP-17 | The dashboard is O(folders x all projects on the platform) for non-owners: 3.2 s per request at 60 folders and 271 projects | 04-PERFORMANCE-AUDIT.md |
| PERF-008 | P1 | VERIFIED | M | WP-14 | One FOP JVM serves the whole server: no per-render deadline (agent F, DEP-028), working set 95 to 756 MB and never shrinks, an exit-listener leak, and no admission control | 04-PERFORMANCE-AUDIT.md |
| PLT-001 | P1 | VERIFIED | L | WP-12 | "Database backup" is a project-folder ZIP; there is no database backup and no restore | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-002 | P1 | VERIFIED | S | WP-06 | SQLite `busy_timeout` is 0: any second writer turns into HTTP 500, and project creation leaves an orphan | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-003 | P1 | VERIFIED | S | WP-06 | Boot-time `reconcileRegistry` deletes a project's row and all memberships when its folder is momentarily absent; restoring the folder does not restore access | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-004 | P1 | VERIFIED | S | WP-06 | Deleting a project keeps its documents, revisions and locks; creating a project with the same name re-attaches them to a different owner | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-005 | P1 | VERIFIED | M | WP-12 | `/api/backup` is built in memory on the event loop; large workspaces stall the whole server and the ZIP writer has no ZIP64 | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-006 | P1 | VERIFIED | S | WP-12 | The pre-migration snapshot is hard-coded to one migration (016); future migrations run without an automatic safety copy | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-014 | P1 | VERIFIED | S | WP-03 | Temporary password is `username@year`: an unauthenticated person can take over a new or reset account before its owner signs in | 02-FUNCTIONAL-AUDIT.md |
| PLT-015 | P1 | VERIFIED | S | WP-03 | No separation of duties on release: the person who requests a release can approve it | 02-FUNCTIONAL-AUDIT.md |
| PLT-016 | P1 | OBSERVED | L | WP-27 | RBAC is five ordered roles; `cap` strings are labels; no fine-grained, group or per-document permissions | 02-FUNCTIONAL-AUDIT.md |
| PLT-028 | P1 | VERIFIED | XL | WP-10 | No explicit application context: import-time singletons prevent server-mode variants, in-process restore and isolated tests, and can write to the wrong workspace | 03-ARCHITECTURE-AUDIT.md |
| PRD-001 | P1 | RECOMMENDATION | M | WP-14 | Worker processes need operating-system resource limits and a supervisor | 17-ADDENDUM-PRODUCTION-ARCHITECTURE-POSITIONS.md |
| PUB-002 | P1 | VERIFIED | S | WP-02 | XInclude in an ancillary page pulls any local file (also other projects' files) into the PDF | 02-FUNCTIONAL-AUDIT.md |
| PUB-003 | P1 | VERIFIED | M | WP-14 | No timeout, no cancellation, one global warm-FOP queue: a hung or slow render blocks every build | 02-FUNCTIONAL-AUDIT.md |
| PUB-004 | P1 | VERIFIED | M | WP-14 | A build is one synchronous HTTP request; no job identity, no queue, no replay of progress | 02-FUNCTIONAL-AUDIT.md |
| PUB-005 | P1 | VERIFIED | M | WP-14 | What the build knew about the document is thrown away: dropped content, missing images and FOP warnings never reach the user | 02-FUNCTIONAL-AUDIT.md |
| PUB-006 | P1 | VERIFIED | M | WP-14 | A release approves a hash only: the released PDF/content is not archived, and the hash leaves out pictures, the house template and the brand pack | 02-FUNCTIONAL-AUDIT.md |
| PUB-007 | P1 | VERIFIED | S | WP-11 | JSS/JSG source documents, `project.json` and `doc-identity.json` are overwritten in place: no atomic write, no version history | 02-FUNCTIONAL-AUDIT.md |
| PUB-008 | P1 | VERIFIED | S | WP-15 | S1000D -> JSS/JSG conversion silently loses every picture that sits beside the data modules; the JSS -> S1000D -> JSS round trip drifts | 02-FUNCTIONAL-AUDIT.md |
| PUB-009 | P1 | VERIFIED | M | WP-15 | A valid JSS document with a warning (or caution) block in a section cannot be exported to S1000D; the failure comes after 12-17 s of work | 02-FUNCTIONAL-AUDIT.md |
| PUB-026 | P1 | VERIFIED | M | WP-01 | Cross-check for S1K-001: JSS shares the settings route and all the unvalidated path helpers; JSG does not; the project-kind predicates disagree | 02-FUNCTIONAL-AUDIT.md |
| PUB-027 | P1 | RECOMMENDATION | L | WP-14 | Introduce one publication job service (queue, worker processes, per-job work directories, build report) shared by S1000D, JSS and JSG | 03-ARCHITECTURE-AUDIT.md |
| QA-001 | P1 | VERIFIED | M | WP-08 | No automated gate of any kind: no CI, no lint, no hooks, installer older than HEAD | 11-TESTING-AND-QA-STRATEGY.md |
| QA-003 | P1 | VERIFIED | S | WP-08 | Tests that need poppler tools fail with a TypeError (or weaken silently) when the tool is missing, and the tools are found only by accident of the shell's PATH | 11-TESTING-AND-QA-STRATEGY.md |
| QA-004 | P1 | VERIFIED | M | WP-09 | The authentication core has no direct tests: rate limiting, session lifecycle, password policy, logout, change-password, disable, revoke, audit, cross-origin refusal | 11-TESTING-AND-QA-STRATEGY.md |
| QA-005 | P1 | VERIFIED | M | WP-09 | No role-by-route authorisation matrix; 28 API routes unreferenced by any test; the WebSocket channel cannot be reached by the backend suite | 11-TESTING-AND-QA-STRATEGY.md |
| QA-006 | P1 | VERIFIED | L | WP-30 | The product's deliverable is a PDF and there is no regression test for how it looks: no raster comparison, no fonts-embedded check, no link/bookmark check; the only geometry golden needs customer material | 11-TESTING-AND-QA-STRATEGY.md |
| QA-007 | P1 | VERIFIED | M | WP-08 | About 43 tests skip silently on any checkout without the customer material, so a green run on a clean runner proves materially less | 11-TESTING-AND-QA-STRATEGY.md |
| QA-008 | P1 | VERIFIED | L | WP-30 | No reliability or chaos tests: nothing kills the server mid-publish, mid-import, mid-backup or mid-migration, and nothing injects disk-full, FOP failure or concurrent publishes | 11-TESTING-AND-QA-STRATEGY.md |
| QA-009 | P1 | VERIFIED | M | WP-25 | Installer verification gaps: upgrade tested only as same-version reinstall, no rollback, no signature check, no test for the service host, outputs not tied to the commit | 11-TESTING-AND-QA-STRATEGY.md |
| QA-019 | P1 | OBSERVED | M | WP-08 | The primary regression run (`node --test test/*.test.js`) has an unresolved intermittent native crash and long hangs, so it cannot yet be used as an automated gate | 11-TESTING-AND-QA-STRATEGY.md |
| QA-020 | P1 | OBSERVED | S | WP-01 | No test sends hostile values to the routes that rewrite a project's configuration; the settings route lets a project editor replace `input.csdbDir`, `input.mediaDir` and `input.pm`, which become file-system paths | 11-TESTING-AND-QA-STRATEGY.md |
| QA-022 | P1 | VERIFIED | M | WP-08 | The e2e suite's configured browser (installed Chrome, headless) crashes the tab when an S1000D data module is opened; the suite has one browser, no matrix and no crash handling | 11-TESTING-AND-QA-STRATEGY.md |
| REL-001 | P1 | OBSERVED | M | WP-11 | Data-module and project-file writes are not atomic | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| REL-002 | P1 | OBSERVED | S | WP-11 | The Common Information Repository's writes skip optimistic-concurrency checking | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| REL-003 | P1 | VERIFIED | S | WP-06 | Graceful shutdown races a flat 500 ms timer instead of waiting for in-flight work | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| REL-004 | P1 | OBSERVED | M | WP-06 | Project-archive restore can leave a half-created project if the process dies mid-import | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-004 | P1 | VERIFIED | M | WP-03 | Predictable temporary passwords, plus unrestricted username enumeration, allow account pre-hijack at scale | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-005 | P1 | VERIFIED | M | WP-04 | The installer grants every local Windows account write access to the database and project files | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-006 | P1 | VERIFIED | M | WP-26 | The LAN deployment mode has no TLS anywhere; credentials and session cookies travel in clear text | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-007 | P1 | VERIFIED | S | WP-03 | The rate limiter is keyed `username\|ip`: unlimited username-rotation guessing, and shared-IP lockout of real users | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-008 | P1 | VERIFIED | M | WP-03 | `clientIp()` reads the raw socket peer, ignoring the declared reverse-proxy deployment | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-010 | P1 | VERIFIED | S | WP-03 | WebSocket connections are not closed when the underlying session is revoked | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| TH-001 | P1 | VERIFIED | M | WP-19 | The JSG editor is not themed: legacy light CSS out-specifies the token rules in dark | 08-DARK-LIGHT-THEME-STRATEGY.md |
| TH-002 | P1 | VERIFIED | M | WP-19 | The current tokens fail WCAG contrast in both themes (15 failing pairs; 7 failures reached the screen) | 08-DARK-LIGHT-THEME-STRATEGY.md |
| TH-003 | P1 | VERIFIED | M | WP-19 | The administrator accent is applied unchecked and identically to both themes | 08-DARK-LIGHT-THEME-STRATEGY.md |
| UX-001 | P1 | VERIFIED | S | WP-07 | JSS Publication page ends in "Internal error" | 06-UI-UX-AUDIT.md |
| UX-002 | P1 | VERIFIED | M | WP-21 | The editing surface gets 29% of a 1366x768 screen by default | 06-UI-UX-AUDIT.md |
| UX-003 | P1 | VERIFIED | XL | WP-21 | Three editors behave as three products | 06-UI-UX-AUDIT.md |
| UX-004 | P1 | VERIFIED | S | WP-23 | Dialogs do not trap or restore focus | 06-UI-UX-AUDIT.md |
| UX-005 | P1 | VERIFIED | M | WP-23 | No landmarks or skip link; menus and clickable rows only partly keyboard-operable | 06-UI-UX-AUDIT.md |
| UX-006 | P1 | VERIFIED | S | WP-07 | Primary controls fall off-screen at 1280 and 1366 px | 06-UI-UX-AUDIT.md |
| UX-007 | P1 | VERIFIED | M | WP-22 | A project has no home | 06-UI-UX-AUDIT.md |
| UX-008 | P1 | VERIFIED | L | WP-22 | Five problem surfaces, and "reviewed" marks live in one browser | 06-UI-UX-AUDIT.md |
| UX-009 | P1 | VERIFIED | M | WP-22 | Review comments exist only on the Release page | 06-UI-UX-AUDIT.md |
| UX-010 | P1 | VERIFIED | M | WP-23 | JSS has no autosave or draft recovery; JSG autosave is opt-in and per browser | 06-UI-UX-AUDIT.md |
| UX-011 | P1 | OBSERVED | M | WP-08 | Chrome (stable channel, headless) crashed the tab when opening a data module in Studio | 06-UI-UX-AUDIT.md |
| ARC-002 | P2 | OBSERVED | S | WP-05 | S1000D Studio drafts are saved to the browser but never offered back in the embedded product | 01-CODEBASE-UNDERSTANDING.md |
| ARC-004 | P2 | OBSERVED | S | WP-13 | Route capability labels (`cap`) are decoration: authorisation is by role rank only | 01-CODEBASE-UNDERSTANDING.md |
| ARC-006 | P2 | OBSERVED | M | WP-10 | `services/projects.ts` is a hub inside an 8-module runtime cycle that is closed by lazy `require()` calls | 01-CODEBASE-UNDERSTANDING.md |
| ARC-007 | P2 | OBSERVED | M | WP-16 | The JSS/JSG document vocabulary is implemented four times and the xml helper functions about a dozen times | 01-CODEBASE-UNDERSTANDING.md |
| ARC-009 | P2 | SUSPECTED | S | WP-13 | The bundled XML/XSLT libraries are old and 32-bit | 01-CODEBASE-UNDERSTANDING.md |
| ARC-013 | P2 | OBSERVED | S | WP-13 | About 51 routes and 43 client wrappers are unreachable from the UI after the recent screen removals | 01-CODEBASE-UNDERSTANDING.md |
| ARC-016 | P2 | OBSERVED | M | WP-09 | 74 of 276 routes have no test or e2e reference; the gaps cluster in user administration | 01-CODEBASE-UNDERSTANDING.md |
| ARC-022 | P2 | OBSERVED | M | WP-01 | "What kind of project is this" is decided four different ways, and `publisher.ts` reads `project.input.*` directly instead of the helpers | 01-CODEBASE-UNDERSTANDING.md |
| ARC-024 | P2 | SUSPECTED | S | WP-15 | Converting or exporting an S1000D project through the cross-engine tool packs only `.xml` files from `csdb/`, but ICN artwork lives in `csdb/` by the project's own convention | 01-CODEBASE-UNDERSTANDING.md |
| DEP-007 | P2 | SUSPECTED | S | WP-01 | JSS image validation skips scheme-less authority paths (`//host/share/x.png`), which then reach FOP unchanged | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-009 | P2 | OBSERVED | S | WP-04 | After the supervisor gives up, the service keeps running and the Service Control Manager reports it healthy | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-011 | P2 | VERIFIED | S | WP-07 | The JSG build passes xsltproc a relative `..\..\` stylesheet path and fails in deep workspaces | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-013 | P2 | OBSERVED | M | WP-12 | No integrity check at start, no repair mode, checksums cover only two files | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-014 | P2 | OBSERVED | M | WP-24 | Enterprise rollout has no MSI, no GPO/SCCM/Intune recipe and no unattended first-admin or TLS configuration | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-015 | P2 | RECOMMENDATION | L | WP-27 | Identity is local-only: no AD/LDAP/OIDC hook, 7-day absolute sessions | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-017 | P2 | VERIFIED | S | WP-06 | SQLite is opened with no busy timeout and nothing prevents two server processes on one workspace | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-018 | P2 | VERIFIED | M | WP-13 | `node:sqlite` is still an experimental Node module, and the bundled runtime is not a stable pin | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-019 | P2 | OBSERVED | M | WP-24 | Windows support matrix is untested; x64 only; a 32-bit `xsltproc.exe` is in the critical path | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-020 | P2 | VERIFIED | S | WP-24 | No EULA is shown and the publisher metadata is a placeholder | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-021 | P2 | VERIFIED | S | WP-13 | Dead vendored code from the older Electron product ships in the install | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-022 | P2 | VERIFIED | S | WP-04 | `reset-admin.js` takes the new password on the command line | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-023 | P2 | OBSERVED | M | WP-25 | Program files are replaced in place; no versioned folders, so rollback is "reinstall the old Setup" | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-024 | P2 | RECOMMENDATION | S | WP-24 | No support bundle | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-025 | P2 | VERIFIED | S | WP-12 | The platform backup route buffers the entire archive in memory | 09-DEPLOYMENT-ARCHITECTURE.md |
| DEP-027 | P2 | VERIFIED | S | WP-07 | The PDF recompression step is wired and offered in the UI, but the tool is not shipped, so the setting silently does nothing | 09-DEPLOYMENT-ARCHITECTURE.md |
| DS-003 | P2 | VERIFIED | L | WP-19 | Two parallel component vocabularies with different sizes and behaviour | 07-DESIGN-SYSTEM-PROPOSAL.md |
| DS-004 | P2 | VERIFIED | S | WP-07 | CSS collisions: `.v2-empty strong` breaks the PDF placeholder lists; duplicated `.v2-tile`; undefined and unused tokens | 07-DESIGN-SYSTEM-PROPOSAL.md |
| DS-005 | P2 | VERIFIED | M | WP-19 | Dialogs and toasts: no focus management in the shell modal, weak scrim, toasts not operable by keyboard | 07-DESIGN-SYSTEM-PROPOSAL.md |
| DS-006 | P2 | VERIFIED | M | WP-19 | No layout or density system: toolbars clip at 1280-1440 px; "compact" changes three rules | 07-DESIGN-SYSTEM-PROPOSAL.md |
| DS-007 | P2 | VERIFIED | S | WP-19 | Scale sprawl: 23 radii, 45 font sizes, 12 z-index values, 683 inline styles | 07-DESIGN-SYSTEM-PROPOSAL.md |
| DS-008 | P2 | VERIFIED | S | WP-19 | Tailwind is installed and configured but generates nothing | 07-DESIGN-SYSTEM-PROPOSAL.md |
| DS-009 | P2 | OBSERVED | S | WP-19 | Fonts are named but not shipped, so the XML view renders in whatever mono font the machine has | 07-DESIGN-SYSTEM-PROPOSAL.md |
| ENT-009 | P2 | VERIFIED | S | WP-03 | No separation of duties: the person who requests a release can approve it | 12-ENTERPRISE-READINESS.md |
| ENT-010 | P2 | VERIFIED | S | WP-03 | Sessions last 7 days with no idle timeout | 12-ENTERPRISE-READINESS.md |
| ENT-011 | P2 | VERIFIED | M | WP-03 | Authentication hardening gaps: throttle only, in-memory, proxy-blind, directory enumeration | 12-ENTERPRISE-READINESS.md |
| ENT-012 | P2 | VERIFIED | S | WP-03 | No security headers on the application; WebSocket upgrade does not check Origin | 12-ENTERPRISE-READINESS.md |
| ENT-013 | P2 | VERIFIED | S | WP-12 | The database has no "schema newer than this program" guard, so downgrades corrupt silently | 12-ENTERPRISE-READINESS.md |
| ENT-014 | P2 | VERIFIED | M | WP-24 | Release artefacts are unsigned and unlisted: no signature, no SBOM, no deployment-tool detection kit | 12-ENTERPRISE-READINESS.md |
| ENT-015 | P2 | VERIFIED | M | WP-12 | No retention or compaction for audit, sessions, notifications and revisions | 12-ENTERPRISE-READINESS.md |
| ENT-016 | P2 | VERIFIED | M | WP-11 | Concurrency guard is optional and the "lock" is an owner freeze, not a check-out | 12-ENTERPRISE-READINESS.md |
| ENT-017 | P2 | VERIFIED | S | WP-29 | Waivers lose their history and reasons | 12-ENTERPRISE-READINESS.md |
| ENT-018 | P2 | SUSPECTED | M | WP-23 | Accessibility conformance is unmeasured; there is no automated gate | 12-ENTERPRISE-READINESS.md |
| ENT-020 | P2 | VERIFIED | S | WP-29 | The audit redactor removes the release fingerprint from `release.requested` events | 12-ENTERPRISE-READINESS.md |
| FE-005 | P2 | VERIFIED | S | WP-05 | Changing `:id` renders the new project with the previous project's summary, mounting the wrong editor for one render | 02-FUNCTIONAL-AUDIT.md |
| FE-007 | P2 | VERIFIED | S | WP-05 | Save conflicts offer only "discard", never keep or export the author's version | 02-FUNCTIONAL-AUDIT.md |
| FE-008 | P2 | VERIFIED | S | WP-11 | Optimistic concurrency is optional on the server and absent on several writes (last write wins) | 02-FUNCTIONAL-AUDIT.md |
| FE-009 | P2 | VERIFIED | S | WP-07 | The "Publication" rail item of a JSS project opens a page that fails with "Internal error" | 02-FUNCTIONAL-AUDIT.md |
| FE-010 | P2 | OBSERVED | M | WP-14 | Build is one blocking request; the UI cannot recover the outcome, and the result carries no report | 02-FUNCTIONAL-AUDIT.md |
| FE-011 | P2 | VERIFIED | M | WP-03 | WebSocket: a revoked session's socket stays open and keeps receiving project messages; the client retries blindly | 02-FUNCTIONAL-AUDIT.md |
| FE-012 | P2 | OBSERVED | S | WP-05 | Consequential actions run on one click without confirmation | 02-FUNCTIONAL-AUDIT.md |
| FE-013 | P2 | VERIFIED | S | WP-07 | "Database backup" is not a database backup, has no restore, and runs through a bare link | 02-FUNCTIONAL-AUDIT.md |
| FE-014 | P2 | VERIFIED | S | WP-23 | Keyboard access: clickable table rows have no keyboard semantics, modals have no focus management | 02-FUNCTIONAL-AUDIT.md |
| FE-015 | P2 | OBSERVED | S | WP-22 | Validation "reviewed" marks live only in the browser's localStorage | 02-FUNCTIONAL-AUDIT.md |
| FE-016 | P2 | VERIFIED | S | WP-22 | No error boundary and no offline/connection-lost handling | 02-FUNCTIONAL-AUDIT.md |
| FE-017 | P2 | VERIFIED | S | WP-03 | The SPA is served without CSP, frame, sniffing or referrer headers | 02-FUNCTIONAL-AUDIT.md |
| FE-018 | P2 | OBSERVED | M | WP-13 | Backend features and API methods with no UI (feature parity gaps and dead code) | 02-FUNCTIONAL-AUDIT.md |
| FE-019 | P2 | OBSERVED | S | WP-13 | Role and permission rules are duplicated in the client | 02-FUNCTIONAL-AUDIT.md |
| FE-020 | P2 | VERIFIED | M | WP-18 | Data fetching has no cache, de-duplication or cancellation, and navigation multiplies requests | 03-ARCHITECTURE-AUDIT.md |
| FE-021 | P2 | OBSERVED | M | WP-21 | The three editors are hosted three different ways and the shell re-implements dirty, save, shortcut and recovery handling in each | 03-ARCHITECTURE-AUDIT.md |
| FE-022 | P2 | OBSERVED | M | WP-13 | API typing is hand-copied and weak at the edges; swallowed errors and escape hatches are common | 03-ARCHITECTURE-AUDIT.md |
| FE-023 | P2 | OBSERVED | S | WP-05 | The Studio installs page-wide listeners once and never scopes or removes them; `window.studio` is exposed in production | 03-ARCHITECTURE-AUDIT.md |
| FE-024 | P2 | VERIFIED | S | WP-05 | The Studio session, its open documents and its drafts survive logout and a different user's sign-in | 03-ARCHITECTURE-AUDIT.md |
| FE-025 | P2 | OBSERVED | M | WP-21 | Monolithic components and three CSS vocabularies slow change; the shell has no component-level tests | 03-ARCHITECTURE-AUDIT.md |
| FE-027 | P2 | VERIFIED | S | WP-18 | Static assets are served uncompressed with no long-lived caching | 04-PERFORMANCE-AUDIT.md |
| FE-028 | P2 | VERIFIED | S | WP-14 | Background polling and refresh-on-save issue server work that grows with project size | 04-PERFORMANCE-AUDIT.md |
| FE-029 | P2 | VERIFIED | M | WP-18 | One save triggers 6 follow-up requests whose cost grows with project size | 04-PERFORMANCE-AUDIT.md |
| FE-030 | P2 | VERIFIED | M | WP-18 | The editor side list and several tables render every row; opening a large project is slow and DOM-heavy | 04-PERFORMANCE-AUDIT.md |
| FE-031 | P2 | VERIFIED | S | WP-18 | The build emits duplicate bundles and one global chunk rule, and the 1.5 MB chunk warning is silenced | 04-PERFORMANCE-AUDIT.md |
| FE-032 | P2 | OBSERVED | S | WP-18 | `public/` is 57 MB and holds a second copy of the XSD schemas | 04-PERFORMANCE-AUDIT.md |
| GAP-001 | P2 | VERIFIED | S | WP-05 | The unsaved-work guard covers four surfaces; other surfaces that hold unsaved state are still unguarded | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| GAP-002 | P2 | VERIFIED | M | WP-35 | Two confirmation idioms: eleven native browser dialogs remain next to the application's own modals | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| GAP-003 | P2 | VERIFIED | S | WP-22 | The JSS/JSG Publication page cannot add a section or an appendix, cannot delete an appendix, and undoes one step at a time | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| GAP-004 | P2 | VERIFIED | S | WP-21 | The deep link into an editor fails silently, and the keys it uses embed titles | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| GAP-007 | P2 | VERIFIED | S | WP-08 | The browser suite is order dependent, has no runner lock, is not gated, and cannot finish on its default browser | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| GAP-009 | P2 | VERIFIED | M | WP-34 | There is no feature-preservation baseline, so "no feature lost" cannot be proved for a redesign | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| PERF-009 | P2 | VERIFIED | S | WP-17 | SQLite is opened with WAL only: every autocommit write pays a full sync (3.3 ms, 40x NORMAL); no busy timeout; no boot-time check | 04-PERFORMANCE-AUDIT.md |
| PERF-010 | P2 | VERIFIED | M | WP-11 | Package scan, `/media` and `dms-import` hold whole uploads in memory (157 MB zip: +455 MB peak) | 04-PERFORMANCE-AUDIT.md |
| PERF-011 | P2 | VERIFIED | S | WP-17 | JSS document `GET` runs a full validation on every read (96 ms against 2 ms for an S1000D module) | 04-PERFORMANCE-AUDIT.md |
| PERF-012 | P2 | VERIFIED | M | WP-14 | No cached or incremental build: unchanged content is re-validated and re-rendered, and the release fingerprint is computed three times per publish | 04-PERFORMANCE-AUDIT.md |
| PERF-013 | P2 | VERIFIED | S | WP-17 | Process spawn is 41% of validation time on Windows: one `xsltproc` per module for well-formedness | 04-PERFORMANCE-AUDIT.md |
| PERF-014 | P2 | VERIFIED | S | WP-17 | Large single bodies stall the thread, and every revision stores a full copy | 04-PERFORMANCE-AUDIT.md |
| PLT-007 | P2 | VERIFIED | M | WP-12 | No retention or purge; `audit_log` has no `project_id` index | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-008 | P2 | VERIFIED | M | WP-17 | Dashboard routes do per-project work for member-only users (linear growth) | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-009 | P2 | VERIFIED | M | WP-11 | Content writes are not atomic and the revision is cut after the file is written (errors swallowed) | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-010 | P2 | VERIFIED | S | WP-06 | Only 11 foreign keys in 38 tables; dead tables remain | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-011 | P2 | VERIFIED | S | WP-12 | Migration framework gaps: unsorted array, no checksum, no down, no schema version | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-012 | P2 | OBSERVED | S | WP-04 | `reset-admin.js` takes the password on the command line, makes no snapshot and sets no busy timeout | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-013 | P2 | VERIFIED | S | WP-12 | No scheduled integrity check; `doctor` does not examine the database | 10-DATABASE-AND-DATA-STRATEGY.md |
| PLT-017 | P2 | VERIFIED | S | WP-03 | WebSocket stays authorised after session revocation or account disable, and ignores Origin | 02-FUNCTIONAL-AUDIT.md |
| PLT-018 | P2 | VERIFIED | S | WP-02 | `checkXmlSafety` is bypassed by a decoy DOCTYPE inside a comment or processing instruction | 02-FUNCTIONAL-AUDIT.md |
| PLT-019 | P2 | VERIFIED | S | WP-03 | 500 responses return `details: <raw error message>` | 02-FUNCTIONAL-AUDIT.md |
| PLT-020 | P2 | VERIFIED | S | WP-11 | Saves without `baseHash` overwrite silently (lost update) | 02-FUNCTIONAL-AUDIT.md |
| PLT-021 | P2 | OBSERVED | S | WP-11 | CIR upload uses memory storage (16 MB x up to 100 files per request) and replaces modules without a version check | 02-FUNCTIONAL-AUDIT.md |
| PLT-022 | P2 | OBSERVED | S | WP-03 | Session policy gaps: single session, no idle timeout, plain HTTP, `Secure` cookie opt-in | 02-FUNCTIONAL-AUDIT.md |
| PLT-023 | P2 | VERIFIED | S | WP-03 | Login rate limiter is in-memory, shared with forgot-password, and keyed on the socket address (the proxy address behind a reverse proxy) | 02-FUNCTIONAL-AUDIT.md |
| PLT-026 | P2 | OBSERVED | M | WP-08 | Test gaps in the platform core | 02-FUNCTIONAL-AUDIT.md |
| PLT-027 | P2 | OBSERVED | L | WP-10 | Authentication is hard-wired to local accounts; no seam for SSO, directory sign-on or two-factor | 03-ARCHITECTURE-AUDIT.md |
| PLT-029 | P2 | VERIFIED | S | WP-12 | Duplicated implementations, notably the weak ZIP writer guarding the backup | 03-ARCHITECTURE-AUDIT.md |
| PLT-030 | P2 | VERIFIED | M | WP-10 | Untyped core boundary and SQL outside the store | 03-ARCHITECTURE-AUDIT.md |
| PLT-031 | P2 | VERIFIED | M | WP-10 | Process-local state, shallow health check and no graceful database shutdown | 03-ARCHITECTURE-AUDIT.md |
| PRD-002 | P2 | RECOMMENDATION | XL | WP-37 | A PostgreSQL storage adapter for Mode B Enterprise, built only when a trigger fires | 17-ADDENDUM-PRODUCTION-ARCHITECTURE-POSITIONS.md |
| PRD-003 | P2 | RECOMMENDATION | M | WP-22 | Authors cannot see who else is working where | 17-ADDENDUM-PRODUCTION-ARCHITECTURE-POSITIONS.md |
| PRD-004 | P2 | RECOMMENDATION | M | WP-21 | A refused save offers no way to compare or merge | 17-ADDENDUM-PRODUCTION-ARCHITECTURE-POSITIONS.md |
| PRD-005 | P2 | RECOMMENDATION | M | WP-25 | The WebView2 runtime must be provisioned and patched on air-gapped machines | 17-ADDENDUM-PRODUCTION-ARCHITECTURE-POSITIONS.md |
| PRD-007 | P2 | RECOMMENDATION | M | WP-28 | No stated availability position for Mode B | 17-ADDENDUM-PRODUCTION-ARCHITECTURE-POSITIONS.md |
| PUB-010 | P2 | OBSERVED | L | WP-11 | One XML file per book means whole-document locking: parallel authors on different chapters collide | 02-FUNCTIONAL-AUDIT.md |
| PUB-011 | P2 | VERIFIED | M | WP-15 | JSG is a third, separate orchestrator with no release, watermark, review or warm FOP | 02-FUNCTIONAL-AUDIT.md |
| PUB-012 | P2 | VERIFIED | S | WP-07 | Shipped defaults reference artwork that does not exist: a developer screenshot name and six symbol icons | 02-FUNCTIONAL-AUDIT.md |
| PUB-013 | P2 | SUSPECTED | S | WP-01 | S1000D publication-module / data-module includes and JSS `graphic src` are not confined to the project folder | 02-FUNCTIONAL-AUDIT.md |
| PUB-014 | P2 | OBSERVED | S | WP-02 | JSS and JSG saves do not run the XML safety guard that the CSDB uses | 02-FUNCTIONAL-AUDIT.md |
| PUB-015 | P2 | VERIFIED | S | WP-15 | The S1000D that this platform writes is itself schema-invalid, and conversion losses are labelled `info` | 02-FUNCTIONAL-AUDIT.md |
| PUB-016 | P2 | VERIFIED | S | WP-15 | Two compression features are dead or blocking | 02-FUNCTIONAL-AUDIT.md |
| PUB-017 | P2 | VERIFIED | S | WP-15 | PDFs carry no document properties, are not tagged, and embed proprietary Arial | 02-FUNCTIONAL-AUDIT.md |
| PUB-018 | P2 | VERIFIED | S | WP-15 | HTML publication is backend-only and S1000D-only | 02-FUNCTIONAL-AUDIT.md |
| PUB-019 | P2 | VERIFIED | L | WP-14 | Every build starts from zero: whole-book re-render, whole-project validation per gate | 02-FUNCTIONAL-AUDIT.md |
| PUB-020 | P2 | SUSPECTED | S | WP-07 | Default artwork is referenced through a long `../` chain from the project folder | 02-FUNCTIONAL-AUDIT.md |
| PUB-021 | P2 | OBSERVED | S | WP-11 | Smaller orchestration hazards | 02-FUNCTIONAL-AUDIT.md |
| PUB-022 | P2 | OBSERVED | S | WP-16 | `jss-guard` is a deny-list of routes | 02-FUNCTIONAL-AUDIT.md |
| PUB-023 | P2 | OBSERVED | S | WP-05 | The JSS editor has no draft recovery; JSG autosave is off by default | 02-FUNCTIONAL-AUDIT.md |
| PUB-028 | P2 | VERIFIED | S | WP-16 | Helpers are copied instead of shared: 14 XML escapers, 5 hash helpers, 2 job chains | 03-ARCHITECTURE-AUDIT.md |
| PUB-029 | P2 | VERIFIED | S | WP-11 | Builds write intermediate and result files into the project folder | 03-ARCHITECTURE-AUDIT.md |
| PUB-030 | P2 | OBSERVED | S | WP-02 | External tools run with the server's whole environment and no resource limits | 03-ARCHITECTURE-AUDIT.md |
| PUB-031 | P2 | SUSPECTED | M | WP-14 | Intermittent native crash and hangs reported by the owner's own investigation point at in-process validation and FOP under load | 03-ARCHITECTURE-AUDIT.md |
| QA-002 | P2 | VERIFIED | S | WP-08 | The default gates fail by timeout: frontend 4 of 587 tests at vitest's 5 s default, and the backend 21-type publish-gate test at its own 600 s limit | 11-TESTING-AND-QA-STRATEGY.md |
| QA-010 | P2 | VERIFIED | S | WP-08 | Tests leak temp folders and write into the source tree | 11-TESTING-AND-QA-STRATEGY.md |
| QA-011 | P2 | VERIFIED | M | WP-08 | e2e suite cannot run in parallel or on a busy port; spec order matters; browser unpinned | 11-TESTING-AND-QA-STRATEGY.md |
| QA-012 | P2 | VERIFIED | M | WP-20 | No accessibility tests and no automated visual or theme regression | 11-TESTING-AND-QA-STRATEGY.md |
| QA-013 | P2 | VERIFIED | M | WP-20 | Performance and scale are measured by hand and not gated | 11-TESTING-AND-QA-STRATEGY.md |
| QA-014 | P2 | VERIFIED | S | WP-08 | Cross-package and out-of-repository fixture coupling; phase-named test files | 11-TESTING-AND-QA-STRATEGY.md |
| QA-015 | P2 | VERIFIED | S | WP-08 | Backend tests run against compiled `dist`; a stale build is tested silently | 11-TESTING-AND-QA-STRATEGY.md |
| QA-016 | P2 | OBSERVED | M | WP-09 | No React component tests | 11-TESTING-AND-QA-STRATEGY.md |
| QA-017 | P2 | VERIFIED | S | WP-08 | Test evidence is not kept: results are git-ignored, local, and one report was generated under a different Node version than the product ships | 11-TESTING-AND-QA-STRATEGY.md |
| QA-018 | P2 | VERIFIED | S | WP-08 | A few tests can pass without asserting | 11-TESTING-AND-QA-STRATEGY.md |
| QA-021 | P2 | VERIFIED | S | WP-09 | Cross-engine conversion tests do not check pictures: graphics stored in `csdb/` are dropped by the S1000D-to-JSS/JSG conversion and nothing would notice | 11-TESTING-AND-QA-STRATEGY.md |
| QA-023 | P2 | VERIFIED | S | WP-09 | The responsive-layout spec is weaker than the defects it is meant to catch: it visits 3 project pages at 3 widths, excuses clipped controls, and passes while "New project" and the editor mode switches are off-screen at common laptop widths | 11-TESTING-AND-QA-STRATEGY.md |
| REL-006 | P2 | VERIFIED | S | WP-03 | Sessions survive a restart; the login lockout does not | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| REL-007 | P2 | OBSERVED | S | WP-11 | Uploads are fully memory-buffered with no aggregate cap enforced before buffering | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| REL-008 | P2 | VERIFIED | S | WP-29 | The audit trail records who changed content but not from where: only login, backup and reset rows carry an IP | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| RES-001 | P2 | RECOMMENDATION | M | WP-11 | Concurrency model: mandatory hash guard + per-user check-out lease; do not adopt CRDT/OT | 12-ENTERPRISE-READINESS.md |
| RES-002 | P2 | RECOMMENDATION | S | WP-12 | Keep SQLite; write down the switch criteria; harden how it is opened | 12-ENTERPRISE-READINESS.md |
| RES-004 | P2 | RECOMMENDATION | M | WP-29 | Off-box audit: Windows Event Log events with stable ids + signed checkpoints | 12-ENTERPRISE-READINESS.md |
| RES-005 | P2 | RECOMMENDATION | M | WP-24 | Air-gapped release engineering: sign, timestamp, SBOM, verify offline | 12-ENTERPRISE-READINESS.md |
| RES-006 | P2 | RECOMMENDATION | M | WP-24 | Support bundle and readiness design (what goes in, what must never) | 12-ENTERPRISE-READINESS.md |
| RES-007 | P2 | RECOMMENDATION | M | WP-20 | Accessibility test approach for a hand-built UI | 12-ENTERPRISE-READINESS.md |
| RES-009 | P2 | RECOMMENDATION | S | WP-03 | Align password and session defaults to SP 800-63B-4 and OWASP | 12-ENTERPRISE-READINESS.md |
| RES-011 | P2 | RECOMMENDATION | M | WP-08 | One release-readiness script that runs the static gates | 12-ENTERPRISE-READINESS.md |
| S1K-002 | P2 | VERIFIED | S | WP-16 | Publish-waiver `subject` matching is fragile and fails silently for a correctly-shaped but differently-formatted subject | 02-FUNCTIONAL-AUDIT.md |
| S1K-003 | P2 | VERIFIED | S | WP-16 | Two hand-synchronized BREX/XSD-pattern implementations (server vs. browser) have already diverged once and have no enforced re-sync discipline | 02-FUNCTIONAL-AUDIT.md |
| S1K-004 | P2 | OBSERVED | S | WP-05 | Autosave/crash-recovery (IndexedDB drafts) is implemented but never activated inside the embedded product | 02-FUNCTIONAL-AUDIT.md |
| S1K-006 | P2 | OBSERVED | M | WP-16 | `publishGate.ts` hard-codes a JSS branch instead of exposing a format-neutral interface | 03-ARCHITECTURE-AUDIT.md |
| SEC-012 | P2 | OBSERVED | S | WP-03 | The audit log fails open and its secret-redaction filter is too broad to be reliable | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-015 | P2 | VERIFIED | S | WP-07 | SNS CSV exports write cells unescaped, so a project member can plant spreadsheet formulas | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-016 | P2 | VERIFIED | S | WP-03 | Sessions never expire on inactivity: seven days from sign-in, persistent cookie, `last_seen_at` is display-only | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-017 | P2 | VERIFIED | S | WP-11 | Any author can overwrite another user's common module; provenance keeps the original uploader; guard-bypassing XML is accepted | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| TH-004 | P2 | VERIFIED | M | WP-19 | Theme controls: a toggle that cannot return to System, a Studio setting that does nothing, and no per-user persistence | 08-DARK-LIGHT-THEME-STRATEGY.md |
| TH-005 | P2 | VERIFIED | S | WP-19 | Tokens missing from the dark block silently fall back to light values | 08-DARK-LIGHT-THEME-STRATEGY.md |
| TH-006 | P2 | OBSERVED | M | WP-19 | No forced-colors or prefers-contrast support | 08-DARK-LIGHT-THEME-STRATEGY.md |
| TH-007 | P2 | VERIFIED | S | WP-19 | No stated paper, canvas and viewer policy; hard-coded values leak into themed areas | 08-DARK-LIGHT-THEME-STRATEGY.md |
| TH-009 | P2 | RECOMMENDATION | L | WP-20 | No automated validation of themes of any kind | 08-DARK-LIGHT-THEME-STRATEGY.md |
| UID-001 | P2 | VERIFIED | S | WP-35 | Password fields have no show/hide control and no caps-lock hint | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| UID-002 | P2 | VERIFIED | M | WP-19 | Form validation feedback is mostly a banner after submit; the field component's error state is used in 2 of 130 places and `aria-invalid` appears nowhere | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| UID-003 | P2 | VERIFIED | M | WP-19 | Tooltips are the browser's `title` attribute in 237 places; keyboard and touch users never see them | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| UX-012 | P2 | VERIFIED | S | WP-21 | Studio ribbon labels are clipped and there is no overflow menu | 06-UI-UX-AUDIT.md |
| UX-013 | P2 | OBSERVED | M | WP-22 | Explore, Publication and the DM panel show the same tree three ways | 06-UI-UX-AUDIT.md |
| UX-014 | P2 | VERIFIED | S | WP-22 | Sample buttons and three overlapping project lists crowd the first screens | 06-UI-UX-AUDIT.md |
| UX-015 | P2 | VERIFIED | S | WP-07 | The activity feed shows a raw event code | 06-UI-UX-AUDIT.md |
| UX-016 | P2 | VERIFIED | S | WP-07 | Empty-state typography breaks the PDF placeholder and looks off-centre elsewhere | 06-UI-UX-AUDIT.md |
| UX-017 | P2 | VERIFIED | M | WP-21 | JSS has no find or replace; JSS and JSG have no command palette | 06-UI-UX-AUDIT.md |
| UX-018 | P2 | VERIFIED | S | WP-07 | The JSG ancillary Cover form is unstyled | 06-UI-UX-AUDIT.md |
| UX-019 | P2 | VERIFIED | S | WP-07 | Duplicate Export in the JSS header; icon-only buttons in the DM panel | 06-UI-UX-AUDIT.md |
| UX-020 | P2 | VERIFIED | M | WP-21 | JSS and JSG pages scroll sideways below about 1100 px; the S1000D ribbon overflows at 820 px | 06-UI-UX-AUDIT.md |
| UX-021 | P2 | RECOMMENDATION | M | WP-22 | No quick switcher or global search | 06-UI-UX-AUDIT.md |
| UX-022 | P2 | SUSPECTED | S | WP-03 | A newer sign-in silently ends the older session | 06-UI-UX-AUDIT.md |
| UX-023 | P2 | VERIFIED | S | WP-07 | A sign-in error stays on screen after switching to Reset password | 06-UI-UX-AUDIT.md |
| ARC-003 | P3 | OBSERVED | S | WP-12 | The pre-migration database snapshot is hard-coded to one migration | 01-CODEBASE-UNDERSTANDING.md |
| ARC-008 | P3 | OBSERVED | S | WP-16 | The BREX evaluator and the XSD-regex translator exist in both the backend and the Studio | 01-CODEBASE-UNDERSTANDING.md |
| ARC-010 | P3 | OBSERVED | S | WP-13 | Two copies of the S1000D schemas and BREX ship, and the compiled Studio grammars are generated by a script no npm command runs | 01-CODEBASE-UNDERSTANDING.md |
| ARC-011 | P3 | OBSERVED | S | WP-13 | Dead-code candidates | 01-CODEBASE-UNDERSTANDING.md |
| ARC-012 | P3 | OBSERVED | S | WP-13 | The browser-side publication PDF generator (3,295 lines, pdfmake) cannot be reached from the embedded product | 01-CODEBASE-UNDERSTANDING.md |
| ARC-014 | P3 | OBSERVED | S | WP-08 | No linter or formatter; 326 `any`; lazy requires bypass the type checker | 01-CODEBASE-UNDERSTANDING.md |
| ARC-015 | P3 | VERIFIED | S | WP-13 | Two documents tell new readers that JSG does not exist and that most JSS types are not ready | 01-CODEBASE-UNDERSTANDING.md |
| ARC-017 | P3 | OBSERVED | M | WP-10 | God functions and files | 01-CODEBASE-UNDERSTANDING.md |
| ARC-018 | P3 | OBSERVED | S | WP-16 | The JSS guard is a deny-list of six S1000D writer routes | 01-CODEBASE-UNDERSTANDING.md |
| ARC-019 | P3 | OBSERVED | S | WP-13 | A database holding Argon2 hashes locks every user out if the optional module is missing | 01-CODEBASE-UNDERSTANDING.md |
| ARC-020 | P3 | SUSPECTED | S | WP-07 | The audit CSV export does not neutralise spreadsheet formulas | 01-CODEBASE-UNDERSTANDING.md |
| ARC-021 | P3 | OBSERVED | S | WP-13 | Duplicate hashed chunks in `frontend/dist` | 01-CODEBASE-UNDERSTANDING.md |
| ARC-023 | P3 | OBSERVED | S | WP-08 | The backend test suite reads fixtures that live in the frontend tree | 01-CODEBASE-UNDERSTANDING.md |
| CLN-001 | P3 | VERIFIED | S | WP-36 | One frontend file has no importer: `frontend/src/api/publish.ts` | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| CLN-002 | P3 | VERIFIED | S | WP-36 | Sixteen frontend exports are referenced nowhere, three of them leftovers of removed screens; 27 more are used only by tests | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| CLN-003 | P3 | VERIFIED | S | WP-36 | 20 CSS classes are defined and never used; 115 more reported by the scan are generated or belong to libraries and must stay | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| CLN-004 | P3 | VERIFIED | M | WP-36 | Removing a feature from the screens leaves its routes, client wrappers, helpers and styles behind, and nothing in the change process removes them | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| DEP-026 | P3 | RECOMMENDATION | S | WP-24 | No SBOM and no reproducible-build record | 09-DEPLOYMENT-ARCHITECTURE.md |
| DS-010 | P3 | RECOMMENDATION | M | WP-20 | No living style guide | 07-DESIGN-SYSTEM-PROPOSAL.md |
| ENT-019 | P3 | VERIFIED | S | WP-31 | The licence module is dormant and its public key custody is unknown | 12-ENTERPRISE-READINESS.md |
| ENT-021 | P3 | OBSERVED | S | WP-31 | Notifications are in-app only | 12-ENTERPRISE-READINESS.md |
| ENT-022 | P3 | OBSERVED | M | WP-27 | S1000D security classification and data restrictions do not influence access or export | 12-ENTERPRISE-READINESS.md |
| ENT-023 | P3 | OBSERVED | M | WP-27 | Roles are fixed in code | 12-ENTERPRISE-READINESS.md |
| FE-026 | P3 | OBSERVED | S | WP-18 | Build configuration is minimal and hides size regressions | 03-ARCHITECTURE-AUDIT.md |
| FE-033 | P3 | RECOMMENDATION | S | WP-18 | No performance budget or regression check exists | 04-PERFORMANCE-AUDIT.md |
| GAP-005 | P3 | NOT VERIFIED | S | WP-15 | Saving from the Publication page re-serialises the whole JSS or JSG document; byte stability of untouched content was not measured | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| GAP-006 | P3 | NOT VERIFIED | S | WP-22 | Explore thumbnails, ICN search and the plates list were exercised only on starter and sample content | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| GAP-008 | P3 | RECOMMENDATION | S | WP-22 | "Show the code beside headings" is a project-wide stored setting that changes the editor for everyone | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| PERF-015 | P3 | OBSERVED | S | WP-14 | `GET /publish/download` can start a full build inside a GET | 04-PERFORMANCE-AUDIT.md |
| PERF-016 | P3 | OBSERVED | S | WP-18 | Lists are unpaginated and uncompressed | 04-PERFORMANCE-AUDIT.md |
| PERF-017 | P3 | OBSERVED | S | WP-13 | The scrypt fallback blocks the thread 144 ms per login when the Argon2 binding does not load | 04-PERFORMANCE-AUDIT.md |
| PERF-018 | P3 | OBSERVED | S | WP-03 | WebSocket broadcast does a database-backed authorisation per client per message and has no backpressure | 04-PERFORMANCE-AUDIT.md |
| PERF-019 | P3 | VERIFIED | S | WP-07 | The PDF compression step is a silent no-op (no Ghostscript bundled) | 04-PERFORMANCE-AUDIT.md |
| PLT-024 | P3 | OBSERVED | S | WP-07 | Small defects: extension 403 may become 500; package downloads named `project-project.zip` | 02-FUNCTIONAL-AUDIT.md |
| PLT-025 | P3 | VERIFIED | S | WP-13 | Documentation contradicts the code in places | 02-FUNCTIONAL-AUDIT.md |
| PLT-032 | P3 | OBSERVED | S | WP-10 | Configuration is scattered and partly hard-coded | 03-ARCHITECTURE-AUDIT.md |
| PRD-006 | P3 | RECOMMENDATION | M | WP-31 | Optional connected services, off by default | 17-ADDENDUM-PRODUCTION-ARCHITECTURE-POSITIONS.md |
| PUB-024 | P3 | VERIFIED | S | WP-02 | `composeBook` mangles book metadata containing `$` patterns | 02-FUNCTIONAL-AUDIT.md |
| PUB-025 | P3 | VERIFIED | S | WP-02 | A project text with both quote kinds stops the build (tool behaviour verified; the exact entry fields by code reading) | 02-FUNCTIONAL-AUDIT.md |
| RES-003 | P3 | RECOMMENDATION | L | WP-27 | Identity roadmap beyond LDAPS (optional, customer-driven) | 12-ENTERPRISE-READINESS.md |
| RES-008 | P3 | RECOMMENDATION | M | WP-31 | If licensing is required: offline signed licence file, soft failure, no mandatory hardware binding | 12-ENTERPRISE-READINESS.md |
| RES-010 | P3 | RECOMMENDATION | S | WP-31 | Optional internal SMTP relay notifications (ENT-021) | 12-ENTERPRISE-READINESS.md |
| RES-012 | P3 | RECOMMENDATION | M | WP-31 | MSI only on demand | 12-ENTERPRISE-READINESS.md |
| S1K-005 | P3 | OBSERVED | S | WP-02 | Entity-declaration guard caps count, not total expansion size | 02-FUNCTIONAL-AUDIT.md |
| S1K-007 | P3 | OBSERVED | S | WP-16 | Four near-identical "read attributes off a string" helpers | 03-ARCHITECTURE-AUDIT.md |
| S1K-008 | P3 | OBSERVED | S | WP-01 | Format inferred partly by template-name convention | 03-ARCHITECTURE-AUDIT.md |
| SEC-013 | P3 | OBSERVED | S | WP-03 | The generic error handler echoes the raw exception message | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| SEC-014 | P3 | OBSERVED | S | WP-07 | Exported package/delivery ZIPs are always named "project" | 05-SECURITY-AND-RELIABILITY-AUDIT.md |
| TH-008 | P3 | VERIFIED | S | WP-19 | The administrator's default theme applies only after login, so the first paint can be the wrong theme | 08-DARK-LIGHT-THEME-STRATEGY.md |
| UID-004 | P3 | SUSPECTED | S | WP-19 | 40 native `<select>` elements; the platform styles do not set `color-scheme`, so the open list and scrollbars may follow the system theme and not the chosen one | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| UID-005 | P3 | RECOMMENDATION | S | WP-35 | Context menus exist only in the Studio design view; trees and tables in the platform pages have none | 16-ADDENDUM-POST-AUDIT-GAPS-AND-PHASE-2-BRIEF.md |
| UX-024 | P3 | OBSERVED | S | WP-22 | The project wizard asks for codes with no example | 06-UI-UX-AUDIT.md |
| UX-025 | P3 | VERIFIED | S | WP-22 | Audit log and Activity cards need filters and polish | 06-UI-UX-AUDIT.md |
| UX-026 | P3 | VERIFIED | S | WP-07 | The sign-in tagline names only S1000D | 06-UI-UX-AUDIT.md |
| UX-027 | P3 | SUSPECTED | S | WP-23 | The palette shortcut may collide with a browser key | 06-UI-UX-AUDIT.md |
| UX-028 | P3 | VERIFIED | S | WP-23 | The platform styles ignore reduced motion; error toasts are announced politely | 06-UI-UX-AUDIT.md |
| UX-029 | P3 | NOT VERIFIED | S | WP-22 | Notification content, restricted-role views and unrendered dialogs were not seen | 06-UI-UX-AUDIT.md |

## 11. Appendix B - counts

Findings in the register: **329** (P0 9, P1 89, P2 174, P3 57).

| Package | Phase | Pri | Size | Class | Findings | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|---|---|---|---|
| WP-01 | 1A | P0 | L | Mandatory | 9 | 3 | 2 | 3 | 1 |
| WP-02 | 1A | P0 | XL | Mandatory | 10 | 3 | 1 | 3 | 3 |
| WP-03 | 1A | P1 | L | Mandatory | 24 | 0 | 7 | 15 | 2 |
| WP-04 | 1A | P1 | M | Mandatory | 6 | 0 | 3 | 3 | 0 |
| WP-05 | 1A | P1 | L | Mandatory | 14 | 0 | 5 | 9 | 0 |
| WP-06 | 1A | P1 | M | Mandatory | 7 | 0 | 5 | 2 | 0 |
| WP-07 | 1A | P1 | M | Mandatory | 20 | 0 | 2 | 13 | 5 |
| WP-32 | 1A | P0 | M | Mandatory | 1 | 1 | 0 | 0 | 0 |
| WP-08 | 1B | P1 | L | Mandatory | 18 | 0 | 6 | 10 | 2 |
| WP-09 | 1B | P1 | M | Mandatory | 6 | 0 | 2 | 4 | 0 |
| WP-10 | 2 | P1 | XL | Mandatory (enabling) | 7 | 0 | 1 | 4 | 2 |
| WP-11 | 2 | P1 | XL | Mandatory | 17 | 0 | 5 | 12 | 0 |
| WP-12 | 2 | P1 | L | Mandatory | 19 | 0 | 9 | 9 | 1 |
| WP-13 | 2 | P1 | L | Mandatory | 19 | 0 | 3 | 8 | 8 |
| WP-14 | 3 | P0 | XL | Mandatory | 15 | 1 | 8 | 5 | 1 |
| WP-33 | 3 | P0 | L | Mandatory for S1000D manuals above about 50 figure-bearing modules (confirm typical size, decision D15) | 1 | 1 | 0 | 0 | 0 |
| WP-15 | 3 | P1 | L | Recommended | 9 | 0 | 2 | 6 | 1 |
| WP-16 | 3 | P2 | M | Recommended | 9 | 0 | 0 | 6 | 3 |
| WP-17 | 4 | P1 | L | Recommended (measured) | 8 | 0 | 3 | 5 | 0 |
| WP-18 | 4 | P2 | M | Recommended (measured) | 9 | 0 | 0 | 6 | 3 |
| WP-19 | 5 | P1 | L | Recommended (core to the requested UI outcome) | 19 | 0 | 5 | 12 | 2 |
| WP-20 | 5 | P2 | L | Recommended | 5 | 0 | 0 | 4 | 1 |
| WP-34 | 5 | P2 | M | Recommended (required by the owner for any redesign: no feature lost) | 1 | 0 | 0 | 1 | 0 |
| WP-21 | 6 | P1 | XL | Recommended (core to the requested UI outcome) | 9 | 0 | 2 | 7 | 0 |
| WP-22 | 6 | P1 | L | Recommended | 15 | 0 | 3 | 7 | 5 |
| WP-23 | 6 | P1 | M | Mandatory for enterprise procurement | 7 | 0 | 3 | 2 | 2 |
| WP-35 | 6 | P2 | XL | Recommended (requested by the owner: Phase 2 brief) | 3 | 0 | 0 | 2 | 1 |
| WP-36 | 6 | P3 | M | Recommended (requested by the owner, after regression sign-off) | 4 | 0 | 0 | 0 | 4 |
| WP-24 | 7 | P1 | L | Mandatory | 11 | 0 | 3 | 7 | 1 |
| WP-25 | 7 | P1 | XL | Mandatory (Mode A) | 3 | 0 | 1 | 2 | 0 |
| WP-26 | 8 | P1 | L | Mandatory for Mode B | 3 | 0 | 3 | 0 | 0 |
| WP-27 | 8 | P1 | L | Enterprise, customer-driven | 6 | 0 | 2 | 1 | 3 |
| WP-28 | 8 | P1 | XL | Mandatory for Mode B | 1 | 0 | 0 | 1 | 0 |
| WP-37 | 8 | P2 | XL | Enterprise, conditional on decision D21 (build only when a trigger fires or the owner decides) | 1 | 0 | 0 | 1 | 0 |
| WP-29 | 9 | P1 | L | Mandatory for enterprise | 5 | 0 | 1 | 4 | 0 |
| WP-30 | 10 | P1 | L | Mandatory | 2 | 0 | 2 | 0 | 0 |
| WP-31 | 10 | P3 | M | Optional | 6 | 0 | 0 | 0 | 6 |

Package sizes: S 0, M 11, L 17, XL 9 (37 packages).

