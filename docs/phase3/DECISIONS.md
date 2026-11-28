# Phase 3 - owner decisions (2026-11-28)

These supersede the matching positions in `docs/audit/17-ADDENDUM-PRODUCTION-ARCHITECTURE-POSITIONS.md`.

| # | Topic | Decision |
|---|---|---|
| P3-1 | Real-time collaboration | Live co-editing is the DEFAULT for S1000D, JSS and JSG (several authors in one document, authors and reviewers at the same time, changes visible without refresh, no lost edits). Check-out stays as an OPTIONAL exclusive lock (others read and comment; inactivity expiry; admin/PM release; submitting for release locks automatically). Supersedes doc 17 "co-editing: no, check-out". |
| P3-2 | Scale | Design for 100+ concurrent users on one server (bounded memory per document, idle unload, backpressure), not only the first workload. |
| P3-3 | Backend technology | No rewrite (Go/Rust/C++/Ruby evaluated): request handling is already 12-75 ms at 1,000 modules after WP-17; the slow work is validation (xmllint-wasm, BREX) and PDF (xsltproc C + FOP Java), which a rewrite does not touch; FOP has no equal-fidelity Go/Rust replacement; Yjs (collaboration) is JavaScript-native. Optimise in place; a native module only for a measured hotspot that misses its target. Frontend stays React + Vite. |
| P3-4 | PDF review | Reviewers annotate generated or project PDFs (text selection or area), comments/suggestions/remarks, a Comments panel, click jumps to page and spot, anchors survive rebuilds, link back to the source module, permissions by project role. |
| P3-5 | GitLab | Offline intranet GitLab, configured by the administrator, hidden from others until the connection test passes; users connect their own accounts. All three: project repositories with push/pull, release and PDF storage, merge requests for review and approval. |
| P3-6 | Standalone accounts | Standalone EXE creates default accounts with FIXED credentials (Admin: `Admin@123`; other roles generic); every default user must change the password at first sign-in; credentials shown after installation with "Save a copy". Common-server mode unchanged (admin created at first start, others through user management). |
| P3-7 | Process | Implement all phases end to end; targeted checks only during implementation; one comprehensive verification at the end, fix and re-run failed checks until release criteria pass. No push or release without the owner's word. |

Order: 1 small UI, 2 performance baseline + instrumentation, 3 collaboration (S1000D, JSS, JSG), 4 PDF review, 5 standalone accounts, 6 GitLab,
7 performance optimisation, 8 cleanup and architecture, 9 comprehensive verification. Independent areas run in parallel.
Each area keeps its change record in `docs/phase3/<area>.md` (files changed, dependencies, decisions, possible regressions, checks still owed).
