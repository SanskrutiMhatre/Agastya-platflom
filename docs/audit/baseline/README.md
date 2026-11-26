# Baseline for the Phase 2 feature-preservation checklist

Captured 2026-11-27 by read-only scripts, **before any Phase 2 change**. Nothing here is product code. The aim is that "not a single existing feature is lost" can be checked by a diff and not by memory.

| File | Content |
|---|---|
| [`routes-and-rail.md`](routes-and-rail.md) | 25 route declarations, 10 rail items |
| [`studio-commands.md`](studio-commands.md) | 87 Studio commands |
| [`tests.md`](tests.md) | 13 browser specs, 30 unit-test files, 83 backend test files |
| [`page-surface.md`](page-surface.md) | 58 files, 337 literal test ids |
| [`frontend-hygiene.json`](frontend-hygiene.json) | counters behind the cleanup register (report 16, section 6) |

## How Phase 2 uses it

1. Before the first redesigned screen: run the scripts again (they are described in report 16, section 5) and confirm the files are unchanged; run every test in `tests.md` and record the result as the **before** column.
2. For every screen: copy its row from `page-surface.md` and its controls from the audit feature inventory (`01-CODEBASE-UNDERSTANDING.md` section 5, 126 features) into the checklist of report 16 section 5.4, and fill the "new home" column. A feature with no new home blocks the screen.
3. After the redesign: regenerate, diff against these files, and explain every removed route, rail item, command, test id or key in the checklist. Then run the tests again for the **after** column.
4. What a diff cannot see (behaviour, permissions, validation messages, import/export results) is covered by the tests and by the manual walk-through list in report 16 section 5.5.

## Limits

* The scans are text scans: a route built from a variable, a test id that is computed, or a shortcut handled in a generic handler is under-counted (the files say so where they know). They are a floor, not a proof.
* The backend API surface is not in this baseline: `01-CODEBASE-UNDERSTANDING.md` section 8.1 and Appendix A list 276 routes with guards; a Phase 2 that changes no server code needs no new baseline for it, and the API tests (backend, 83 files) guard it.
