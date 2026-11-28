# Audit and roadmap phase - checklist

State on 2026-11-28. Detail and limits of every item: `docs/audit/IMPLEMENTATION-LOG.md`. Release gates:
`docs/audit/RELEASE-EVIDENCE.md`. Roadmap and decisions: `docs/audit/14-PRIORITIZED-IMPLEMENTATION-ROADMAP.md`.

Legend: ✅ done · ◐ done in part (limits in the log) · ⏸ parked by decision · 🔄 in progress · ⬜ not started

## 1. The owner's requirements

- [x] Offline, on-premises Windows product for S1000D, JSS and JSG, going to production
- [x] Full software audit (`docs/audit/01`-`17`: 329 findings, 37 work packages, decisions D1-D23)
- [x] Implement the whole roadmap end to end without stopping; take the audit's recommendation for every decision
- [x] No fake completion, no weakened tests, no feature lost; owner-removed features stay removed; Arial kept
- [x] The original database is the source of truth; migrations are additive only
- [x] Work in parallel to finish fast
- [x] The UI looks like the approved mockups (`docs/audit/mockups/`): built, owner review pending (section 4)

## 2. Architecture positions (audit doc 17)

| Option | Position taken |
|---|---|
| Microservices | Not now: one server plus background worker processes (WP-14) |
| PostgreSQL | Conditional (D21): SQLite for one PC and one LAN server; the storage layer is made ready (WP-10); the adapter (WP-37) is built only when a trigger fires (more than about 25 concurrent authors, a second server, high availability or point-in-time recovery, a mandated corporate database, or measured write p95 > 200 ms / event-loop lag > 100 ms) |
| Real-time co-editing | Not for document structure: check-out / check-in instead (WP-11, WP-28) |
| React rewrite of the editors | Keep the editing canvases, replace what surrounds them (D16) |
| Electron | No: a small WebView2 launcher (WP-25) |
| Cloud | None needed at run time |

## 3. Work packages

### Phase 1 - safety and quick fixes
- ✅ WP-01 Project settings, path safety, project-kind integrity
- ✅ WP-02 XML safety guard, external-resource policy for builds
- ✅ WP-03 Account, session and network hardening
- ✅ WP-04 File permissions, service identity, admin tools
- ✅ WP-05 Editor data-loss fixes
- ✅ WP-06 Project lifecycle (delete, busy, shutdown)
- ✅ WP-07 Broken or misleading features fixed
- ✅ WP-32 Truthful validation at scale

### Phase 2 - foundations
- ◐ WP-08 Offline quality gate (CI, deterministic tests, tool provisioning)
- ✅ WP-09 Authorisation matrix and hostile-input tests
- ◐ WP-10 Application context and storage seams (SQL layer ready for PostgreSQL; the user/auth store is not behind an interface; the very large route functions were not split)
- ◐ WP-11 Atomic writes, history, version guards, check-out for all formats
- ✅ WP-12 Complete backup, tested restore, safe migrations
- ◐ WP-13 Runtime baseline, dead-code removal

### Phases 3-4 - jobs, formats, performance
- ◐ WP-14 Background jobs (not done: job screens, release archive, build cache)
- ✅ WP-15 JSG parity and conversion fidelity
- ◐ WP-16 One validation framework
- ✅ WP-17 Performance (two targets still missed: create at 1,000 modules 65 ms vs 50 ms; warm revalidate 1.7 s vs 1 s)
- ✅ WP-18 Frontend performance
- ✅ WP-33 S1000D formatting-stage (XSLT/FOP) scaling

### Phases 5-6 - UI
- ✅ WP-19 Design tokens, dark/light parity
- ✅ WP-20 Automated theme and visual checks
- ✅ WP-34 Feature-preservation guard (parity check)
- ✅ WP-21 Shared editor header, layouts, command palette
- ◐ WP-22 Navigation, project home, problems, review
- ◐ WP-23 Accessibility (WCAG 2.2 AA)
- ◐ WP-35 Screen redesign: kept the old look; being redone to the mockups (section 4)
- ✅ WP-36 Cleanup gate

### Phases 7-8 - release, enterprise, operations
- ✅ WP-24 Signing, SBOM, integrity, offline verification (tooling done; a real certificate is still needed)
- ✅ WP-25 Standalone installer, launcher, offline update and rollback
- ✅ WP-26 Network security
- ◐ WP-27 Directory sign-on, groups, fine-grained permissions
- ✅ WP-28 Client and server installers, central backup, concurrency
- ✅ WP-29 Tamper-evident audit trail, retention
- ✅ WP-30 Final QA: PDF regression, chaos (100 kills), air gap, 30-minute soak, release evidence
- ⏸ WP-31 Optional, demand-driven items
- ⏸ WP-37 PostgreSQL adapter (conditional, see section 2)

**Total: 35 of 37 merged, 2 parked.**

## 4. UI redesign to the approved mockups (2026-11-28)

- ✅ Design system from the mockups (tokens with the mockup names, `components.css`, `ui.tsx` pieces; 298 contrast checks, 0 failing)
- ✅ Screen 2 - Project dashboard (`ProjectHomePage`)
- ✅ Screen 3 - Editor workspace for S1000D, JSS and JSG (Explorer, tabs, toolbar, path bar, Properties, Problems, status bar)
- ✅ Screen 4 - Publication and PDF preview
- ✅ Screen 5 - Validation report
- ✅ Screen 6 - Administration, settings, users, access, audit, backups and the other global pages
- ✅ Screen 1 - Global shell, project shell and main dashboard
- ✅ Shared fixes: button hover in the light theme, the editor "Built in" log line, themed PDF canvas token, unused shared classes (lint)
- ✅ Restart :4040 with the new UI for the owner's review
- ✅ Exact-match pass (owner: "make it look exactly like the mockup"): each screen screenshotted side by side with its mockup at 1366 and 1920, light and dark, and fixed until only real data differs. Merged: validation, project dashboard, publication, administration, shells + tokens + main dashboard, editor (all panes open as drawn)
- ✅ Theme: only Light and Dark, one toggle button (no System); a stored "system" becomes light
- ✅ Tokens equal the mockup's `tokens.css` value for value (0 differences); visual suite 67/67 on two consecutive full runs

## 5. Other work this session

- ✅ Owner commit `d87dc48` (dummy-data samples, JSS Land/Naval samples) merged and fitted to the audit line
- ✅ `CLAUDE.md`, `SETUP.md` and `memory.md` (section 0, current state) written for other developers
- ✅ :4040 runs the new code on the owner's real data (migrations 022-026 applied; pre-upgrade copy kept in `_db-backups/before-audit-line-2026-11-28`)

## 6. Release state (`docs/audit/RELEASE-EVIDENCE.md`)

- 47 gates: **11 PASS, 10 FAIL, 26 EXTERNAL**
- FAIL, measured shortfalls: temporary passwords about 40 bits of entropy (target 60); 76 of 94 P0/P1 findings named in a test
- FAIL, coverage gaps: what ran passed, but less than the gate asks (timing points, canary run, CSP reports in a browser, kill during release approval, doctor faults, keyboard-only tasks, case count)
- Open defects: FOP does not embed the base-14 fonts (QA-006a, ratcheted); server memory grew 121 -> 195 MB in a 30-minute soak and then levelled
- EXTERNAL (need things this machine does not have): clean Windows VMs, a real code-signing certificate (D4), a real Active Directory, an independent penetration test, the 24-hour soak, screen-reader users, separate client machines

## 7. Still to do

- ✅ Finish screen 1 and the shared fixes; merge
- ✅ Owner review of the exact-match UI on :4040 (round 2 items done)
- ⬜ Re-run the full release gate on a quiet machine; fix what it finds (now part of Phase 9 below)
- 🔄 Push `main` to GitHub: the owner pushes before Phase 9 testing starts
- ⬜ External gates (section 6), with the owner

## 8. Phase 3 (owner's final decisions, `docs/phase3/DECISIONS.md`)

Testing policy (P3-7): targeted checks only while implementing; one comprehensive verification at the end.

- ✅ 1. Small UI: "Offline · on-premises · v… · Server connected" text, Wi-Fi icon and sidebar Settings removed (069d507)
- ✅ 2. Performance baseline + instrumentation: Server-Timing, admin perf report, bench scripts, 53 budgets, nightly stage (069d507)
- ✅ 3. Real-time collaboration: core + S1000D (238b6c2, migration 030), JSS (9d2f0e4), JSG handbook + ISPL (76a9cdd)
- ✅ 4. PDF review annotations (3a00fc4, migration 028); archive export/import + XFDF import (0a100f3)
- ✅ 5. Standalone default accounts + forced password change (a3d9a8b, migration 027; fix-ups 2ac4fb2)
- ✅ 6. GitLab integration for an offline intranet instance (c8a1b65, migration 029)
- ✅ 7. Performance optimisations (422528f)
- ✅ 8. Cleanup: backend (0a100f3: batched fsync, PM append, incremental BREX, tailwind removed, any typed, docs); editors/collaboration
  (061f2ab: moved block keeps concurrent typing, selection re-map, kept undo, JSG opening in slices 263 -> <200 ms, one XML escaper,
  live-editing spec rewrites with classic coverage). Not built: per-chapter live lock (a chapter check-out locks the whole live book)
- ✅ Owner pushed `main` up to 0137b2c; ⬜ owner pushes the cleanup merge 061f2ab
- ⬜ 9. Comprehensive final verification, in parallel shards on separate ports (fix and re-run only what fails):
  - ⬜ Full gate (excluding the package/readiness stages: they write HKCU and need a real certificate)
  - ⬜ Backend suite, frontend vitest, all e2e specs (sharded), visual suite (alone, one ordered run, baselines re-captured once
    then verified by a second run; the Studio, JSS and JSG editor baselines change by design with live editing)
  - ⬜ All three editors; collaboration concurrency, sync, conflicts (collab-load 120+ clients across S1000D/JSS/JSG)
  - ⬜ Author and reviewer workflows; PDF annotations; GitLab, repositories, MRs (mock GitLab)
  - ⬜ Standalone and server installs; auth, authz, security scans
  - ⬜ API, DB, memory, CPU, frontend performance (speed budgets, median of 3, re-measured on a quiet machine); soak capped at 2 h
  - ⬜ Offline/intranet operation; full build, packaging, installer build
  - EXTERNAL (cannot run here): real intranet GitLab (OAuth consent, CA chains, approvals CE/EE, package registry limits), clean
    Windows VM install, 125%/150% DPI on real screens, real code-signing certificate, 24 h soak, reference-machine load run

Known gaps carried into Phase 9 (documented in the phase records): same-field edits in JSG attributes are last-writer-wins; a
PDF text selection across a page break is cut at the page edge; import still runs in the server process (yielding, batched).
