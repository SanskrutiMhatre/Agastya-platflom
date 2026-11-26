# 17 - Addendum: production architecture positions and assumed targets

**Status.** Audit addendum, written 2026-11-27 at the owner's request. **Nothing here is approved or started.** No application code, schema, dependency or installer was changed. The audit status stays **PARTIAL**.

**What the owner asked.** (1) Why were microservices, PostgreSQL, co-editing, a React rewrite of the editors, Electron and "no cloud" left out of the roadmap? (2) The product goes to production: propose the best solution. (3) Ask all open questions at once and do not wait: recommend the best answer for each and update the roadmap.

**What was done.** Every open question below got a recommended answer. The roadmap (report 14) was updated on those answers, which are marked as **assumed defaults**: the owner can overrule any of them, and the affected decision (D3, D21, D22, D23) says what changes if so. This addendum adds 7 findings (PRD-001 to PRD-007), 1 work package (WP-37), 3 decisions (D21 to D23) and changes to 8 existing packages.

**Honest limit.** The audit never received a supported-scale statement (decision D3 stayed open), so its first answer was the cautious one. The figures in section 2 are **recommendations, not facts about any customer and not measurements**. The multi-user acceptance test of WP-28 is what proves or disproves them, and the PostgreSQL trigger (section 3) is the safety valve if they turn out to be too low.

---

## 1. Why the six options were left out of the first roadmap

The audit judged each option against the stated product: an **offline, one-click Windows product** that runs as one PC (Mode A) or one LAN server (Mode B), with its content in files and a small SQLite database. Against that product, each option cost more than it removed. Section 3 gives the reason per option and, for a production release, what to build instead.

## 2. The open questions, asked together, with the answer assumed for the roadmap

| # | Question | Recommended answer (assumed) | Why | What depends on it |
|---|---|---|---|---|
| Q1 | How many authors work at the same time at the largest customer? | **Mode A: 1. Mode B team tier: 25 concurrent authors (100 named users), 100 projects.** Acceptance test at 2x = 50 scripted authors | The SQLite writer queue handles short writes at this size (13 section 7: milliseconds per transaction); the content is in files, so the database is not the hot path | D3, WP-28 (G-REL-4, G-PERF-4), D21 trigger |
| Q2 | Largest manual to validate and publish? | **Validate up to 5,000 modules per project; publish up to 2,000 modules of which 500 figure-bearing** | WP-32 already tests 1,000, 2,000 and 5,000 modules; the figure-bearing number sets the urgency of WP-33 (D15) | D15, D3, WP-32, WP-33 |
| Q3 | Is failover or high availability required? | **No automatic failover in the first production release.** Daily backup by default, hourly selectable; RPO = time since the last backup; RTO measured at the first restore drill and not promised before; a documented warm-standby procedure (restore the latest backup on a second machine). High availability only with the PostgreSQL tier (D21) | Automatic failover needs two server nodes and a networked database, which SQLite cannot provide (13 section 7); the cost is justified only when a customer requires it | D21, PRD-007, WP-12, WP-28 |
| Q4 | Does the customer have IT staff, or does one person install it? | **Mode A: assume no IT staff (at most one decision at install, G-DEP-2). Mode B: assume one administrator with a guided installer and an administrator guide; no domain assumption** | The installer family and the audit's G-DEP gates were written for this; directory sign-on stays optional (D5) | WP-25, WP-28, D5 |

If a real answer differs, the roadmap changes only where the last column points.

## 3. Positions on the six options

| Option | Position for production | Why (evidence) | Production design (what is built) | Change it when |
|---|---|---|---|---|
| **Microservices** | **Not now.** Modular monolith with a job service and worker processes (WP-14) | The measured problems (a frozen request thread, one hung FOP JVM stalling every publish: PERF-001, DEP-028) are process-isolation problems; separate services would multiply ports, installers, signing and failure modes on a user's PC (03 section 6) | Worker processes with reduced environment; **OS-level resource limits and supervision (PRD-001)**; every document engine behind an interface so one can be moved out later | The product becomes a hosted multi-tenant service, or a second server node is needed |
| **PostgreSQL** | **Conditional adapter for Mode B Enterprise (WP-37, D21).** SQLite stays for Mode A and the team tier | Content lives in files; one writer at a time fits short writes; PostgreSQL adds a Windows service, credentials, upgrades and backups on the customer machine (13 section 7). The real risk is the experimental `node:sqlite` on Node 22 (ENT-008, DEP-005), handled in WP-13 | The storage seam of WP-10 is made **SQL-dialect-clean** (no direct SQL outside repositories), so the adapter is a contained job: about 51 `dbh()` call sites and direct SQL in 5 service files today | p95 write latency above 200 ms or event-loop lag above 100 ms under the stated load; more than one server host; recovery to a point in time required; a mandated corporate database |
| **Co-editing (CRDT / OT)** | **Not for structure. Collaborative check-out instead** (WP-11, WP-22, WP-21) | A data module is validated as a whole against the schema and BREX; no source shows that merging concurrent structural XML edits stays valid (13 section 8); authors work on different modules; approval is bound to a hash of exact files | Mandatory hash guard + per-user lease with administrator break; **chapter / section-level leases for JSS and JSG (D22)**; **presence and lock visibility (PRD-003)**; **side-by-side conflict comparison (PRD-004)**. Live co-editing only for free-text leaf elements behind a server-side validity check, only on customer demand | A customer needs several people in one data module at once and accepts a validity guard |
| **React rewrite of the editors** | **Replace the surroundings piece by piece; keep the canvases** (WP-21, WP-35, decision D16) | The canvases hold years of behaviour (87+ Studio commands, JSS and JSG fidelity, many tests); the defects are in chrome, session and host contract, not in the canvas technology; "no feature lost" is a requirement | Baseline harness first (WP-34); one host contract (WP-21); toolbars, panels, dialogs, inspectors and problem lists move to React on the design system; a canvas is rebuilt only where a measured defect justifies it, smallest editor first, with parity proven on the baseline | The owner chooses a full rebuild in D16 (then one editor at a time on the same harness) |
| **Electron** | **No. WebView2 host** (WP-25) | Electron ships Chromium + Node per client (about 150 MB or more) and the owner would patch Chromium; it supports only the latest three major versions (09, source S12). The C# host already owns tray, supervisor, single instance and ports | Thin WebView2 window; **offline runtime provisioning (PRD-005)**; default-browser fallback; the runtime version reported by `/api/version` | A need for OS integration the C# host cannot provide |
| **Cloud dependency** | **None required at run time; optional connected services only on demand** (WP-31, PRD-006) | Offline is the requirement (the audit's acceptance VMs have no network card); the vendor-side build, signing and SBOM pipeline may run anywhere | Signed update, licence and support-bundle exchange work **by media** (USB, e-mail); an optional connected mode (update check, support upload) is **off by default**, opt-in per customer, signed responses, allow-listed host | A customer asks for connected updates or remote support |

---

## 4. Findings

### PRD-001 · P1 · RECOMMENDATION · M · Worker processes need operating-system resource limits and a supervisor

**Category:** Reliability / architecture.
**Problem:** WP-14 bounds the PDF tool (FOP, a Java process) with deadlines and a heap limit, but a heap limit does not cap the process (native memory, threads, children) and does not stop a runaway worker from taking the memory of a shared server. One FOP build peaked near 480 MB and the JVM reached 756 MB over repeated builds (03, 04), so on a Mode B server with several concurrent builds a single bad job can starve every author.
**Evidence:** RECOMMENDATION. The figures are from the audit (03, 04). Windows job objects are a standard Windows facility; Node has no built-in API for them, so they are applied by the C# host or a small launcher. Not tested here.
**Current implementation:** none: no worker processes exist (03 section 6); the FOP JVM is long-lived and shared (DEP-028).
**Recommendation:** start every worker and the FOP JVM inside a Windows job object with a per-process and a per-job memory limit, a CPU rate cap, an active-process limit and kill-on-close; a supervisor restarts a crashed worker and fails only its job with a clear message; limits are configuration (installer defaults by memory size); every document engine is called through one interface so it can be moved out of the process later.
**Expected outcome:** a runaway job is stopped by the operating system, not by a timer; the server stays responsive; the engine boundary is explicit.
**Dependencies:** WP-14, WP-13 (runtime), the C# host.
**Risks:** limits set too low fail legitimate large builds (set from the baseline of WP-17 on the chosen runtime); behaviour on Windows Server SKUs NOT VERIFIED.
**Acceptance criteria:** a worker that allocates beyond its limit is terminated and its job fails with a message while `/api/health` stays within the budget of WP-14; killing the server kills every worker (no orphan `java.exe`); the next job succeeds.
**Test cases:** a synthetic memory-hog worker; kill-the-parent test; 100 builds with the limit set at the measured peak plus 25 %.

### PRD-002 · P2 · RECOMMENDATION · XL · A PostgreSQL storage adapter for Mode B Enterprise, built only when a trigger fires

**Category:** Architecture / scalability.
**Problem:** SQLite is right for one host and short writes, but it cannot serve a second server node, cannot give point-in-time recovery, and cannot be shared over a network file system (13 section 7). If the supported scale (D3) or a customer exceeds that, the only answer today would be a rewrite, because about 51 `dbh()` call sites and direct SQL in five service files bypass the `AuthStore` class.
**Evidence:** 13 section 7 (verdict, the trigger list and the grep result for the call sites). RECOMMENDATION: no PostgreSQL work was done or measured.
**Current implementation:** one embedded database through `node:sqlite`; SQL spread over the stores and five services.
**Recommendation:** (1) in Phase 2, WP-10 makes the seam dialect-clean: every query lives in a repository behind an interface, migrations are engine-neutral files, and one contract test suite runs against any engine; (2) in Phase 8, WP-37 adds a PostgreSQL adapter, a Server-Setup option, a PostgreSQL-aware backup and restore (base backup plus archived logs), and the same contract suite; the choice is made at install time and stored in the configuration; Mode A never uses it; (3) the adapter is built only if a trigger of section 3 fires or the owner decides so in D21.
**Expected outcome:** the product can scale beyond one host without a rewrite, and the cheaper SQLite deployment stays the default.
**Dependencies:** WP-10, WP-12, WP-13, WP-26, WP-28; D21.
**Risks:** a second engine doubles the test matrix and the support surface; SQL differences (types, locking, upsert, date handling) hide in repositories only if WP-10 is strict; air-gapped installation of PostgreSQL needs its own installer, service account and upgrade path.
**Acceptance criteria:** the contract suite passes on both engines; a restore drill passes on the PostgreSQL backup (G-REL-1, G-REL-3); 50 scripted authors on PostgreSQL meet the thresholds of WP-28; the standalone installer is byte-for-byte unaffected.
**Test cases:** the contract suite, run in the gate on both engines; migration up and down tests; kill-the-database test.

### PRD-003 · P2 · RECOMMENDATION · M · Authors cannot see who else is working where

**Category:** Collaboration / UX.
**Problem:** with check-out leases (WP-11) an author learns about a lock only when a save or a check-out is refused. There is no list of who holds what, no notice when a module is released, and no read-only view of another author's current state.
**Evidence:** RECOMMENDATION; the lock today is owner-only and invisible in the lists (13 section 8; `project-content.ts`).
**Current implementation:** the server holds an owner-only lock; the lists and editors show nothing about other authors.
**Recommendation:** show lease holders on the Explore, Publication and editor surfaces (a name and a time, from the same record); a short-lived presence heartbeat over the existing WebSocket (reusing the session checks of WP-03); a notice when a module the author asked for is released; a read-only open of a leased module.
**Expected outcome:** teams coordinate without calling each other; refused saves become rare.
**Dependencies:** WP-11, WP-03 (WebSocket session handling), WP-22.
**Risks:** presence data is personal data in some jurisdictions (keep it in memory, never in the audit store beyond the lease record).
**Acceptance criteria:** two scripted users see each other's leases within 5 seconds; a revoked or expired session disappears from presence; no presence data is written to disk.
**Test cases:** two-browser e2e; session-expiry test; reconnect test.

### PRD-004 · P2 · RECOMMENDATION · M · A refused save offers no way to compare or merge

**Category:** Data integrity / UX.
**Problem:** WP-05 gives the author "keep / export / discard" after a version conflict. The author cannot see what changed on the server, so keeping own work risks overwriting the other change, and discarding loses own work.
**Evidence:** RECOMMENDATION; FE-008 and the conflict dialog described in WP-05.
**Current implementation:** a message and, after WP-05, three buttons.
**Recommendation:** a side-by-side comparison of the server version and the author's version (text and XML aware), with per-change selection for changes that do not overlap; the merged result is **validated (schema and BREX) before it can be saved**, and is saved with a new base hash; changes that overlap stay a manual choice.
**Expected outcome:** a conflict ends in a validated document, not in a lost edit.
**Dependencies:** WP-11 (mandatory hash and the 409 carrying the server version), WP-21 (host contract), WP-05.
**Risks:** a merge can produce a document that is well-formed but wrong in meaning, which is why validation and an explicit review step are required; keep merge to non-overlapping hunks.
**Acceptance criteria:** G-REL-4 stays at 0 silent overwrites; a merged document that fails validation cannot be saved; the three editors use the same dialog.
**Test cases:** non-overlapping and overlapping conflicts per format; validation-failure merge.

### PRD-005 · P2 · RECOMMENDATION · M · The WebView2 runtime must be provisioned and patched on air-gapped machines

**Category:** Deployment.
**Problem:** the standalone and client products open in a WebView2 window. The runtime is installed with Windows 11 and updated through Windows Update, but an isolated Windows Server or Windows 10 machine may have none or an old one. WP-25 records WebView2 on Server SKUs as NOT VERIFIED.
**Evidence:** RECOMMENDATION; 09 section on the shell; WP-25 risk.
**Current implementation:** none (the shell is not built).
**Recommendation:** detect the runtime at install and at start; ship the offline (standalone) runtime installer with every product release so each offline update also refreshes it; report the runtime version in `/api/version`; keep the default-browser fallback and say so on screen; document the patch path for sites that block Windows Update. Edge is already the reference browser for the interface tests (D18).
**Expected outcome:** the product opens on a clean offline machine without a decision, and the runtime does not silently age.
**Dependencies:** WP-25, WP-24, D18.
**Risks:** the offline runtime installer adds size to every package; a fixed-version runtime would make the product the owner of its patches, which is why the standalone Evergreen installer is recommended.
**Acceptance criteria:** on clean no-network VMs (Windows 10, 11, Server 2022, 2025) the product opens in the window after install, or in the browser with a visible notice; the runtime version appears in the version endpoint.
**Test cases:** the VM matrix of WP-24 with and without the runtime pre-installed.

### PRD-006 · P3 · RECOMMENDATION · M · Optional connected services, off by default

**Category:** Operations / enterprise.
**Problem:** "no cloud" was stated as an absolute. The requirement is that nothing needs the internet at run time; some customers may still want connected updates or remote support.
**Evidence:** RECOMMENDATION; 13 section 9.
**Current implementation:** none; the licence module is dormant (ENT-019).
**Recommendation:** an optional connected mode: update check, signed update download, support-bundle upload, all **off by default**, enabled per customer by an administrator, to an allow-listed host, with signed responses and no telemetry; the offline equivalents (signed update package, support bundle by e-mail or USB) stay the primary route; built only when a customer asks (WP-31).
**Expected outcome:** the offline guarantee is kept and a connected customer is not turned away.
**Dependencies:** WP-24, WP-25, WP-29, WP-31.
**Risks:** every connected feature is attack surface and a firewall conversation; keep it out of the default install.
**Acceptance criteria:** with the mode off, the no-network capture of G-OFF shows zero connection attempts; with it on, only the allow-listed host is contacted.
**Test cases:** the packet capture of the air-gap suite in both states.

### PRD-007 · P2 · RECOMMENDATION · M · No stated availability position for Mode B

**Category:** Reliability / documentation.
**Problem:** Mode B is a single server with no failover. Nothing states what happens when it fails, how long recovery takes, or how a second machine takes over, so an administrator cannot plan.
**Evidence:** RECOMMENDATION; 13 section 9.1 (RPO and RTO); G-REL-1; D3.
**Current implementation:** the backup is not restorable (WP-12 fixes this); no procedure exists.
**Recommendation:** state the position: no automatic failover in the first production release; daily backup by default with an hourly option; RPO = time since the last backup; RTO measured at the first restore drill and published with the drill result; a warm-standby procedure (scheduled copy of the backup to a second machine, restore and switch the clients by changing the server address); a monthly restore-test reminder in the administrator screen; high availability only through the PostgreSQL tier (D21).
**Expected outcome:** administrators know what they are buying and can rehearse a recovery.
**Dependencies:** WP-12, WP-28, WP-29; D3, D21.
**Risks:** an RTO promised before it is measured would be wrong; publish it only after the drill.
**Acceptance criteria:** the restore drill and the warm-standby switch-over are executed from the written procedure on two clean VMs and timed; the figures appear in the administrator guide.
**Test cases:** the drill, run in the release suite of WP-30.

---

## 5. What changed in the roadmap (report 14)

* **New package WP-37** (phase 8): PostgreSQL storage adapter for Mode B Enterprise (PRD-002). Class: enterprise, conditional on D21.
* **WP-10:** the storage seam must be dialect-clean (a contract test suite, no SQL outside repositories).
* **WP-11:** leases and hash guards are per chapter (JSS) and per section (JSG), not per whole document (D22).
* **WP-14:** PRD-001 (job objects, supervision, engine interface).
* **WP-21:** PRD-004 (conflict comparison in the host contract). **WP-22:** PRD-003 (presence and lock visibility).
* **WP-25:** PRD-005 (WebView2 runtime). **WP-28:** PRD-007 (availability position, warm standby) and the acceptance figures of D3. **WP-31:** PRD-006.
* **Decisions:** D3 now carries the assumed figures of section 2; **D21** PostgreSQL adapter, **D22** lock granularity for JSS and JSG, **D23** optional connected services.
* **Section 8** of the roadmap ("what this roadmap deliberately does not propose") is replaced by the positions of section 3, each with its trigger.
* **Counts:** 329 findings (P0 9, P1 89, P2 174, P3 57), 37 work packages, 23 decisions.

## 6. Not verified

No PostgreSQL work, job-object behaviour on Windows Server, WebView2 offline installation or merge behaviour was run or measured; every figure in section 2 is a recommendation; no customer was consulted. The audit status stays **PARTIAL**.
