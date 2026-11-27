# Manual walk-through (WP-34, report 16 section 5.5)

What the parity check and the tests cannot see. For **every redesigned screen group** of [`CHECKLIST.md`](CHECKLIST.md), one person walks this list on the **old** build and on the **new** build, fills one copy of the table below, and signs the group's row in the checklist. A "no" blocks the batch unless the owner records a decision (and the decision id goes in the Notes column).

Setup:

* Old build: the commit the batch starts from (`parity-baseline.json` → `commit`, or the batch's base). New build: the batch's last commit. Same workspace copy for both (copy it; never use the live `workspace\`).
* Reference browser: Edge / WebView2 (decision D18). Chrome stable crashes in the Studio (UX-011) and is not a valid run.
* Accounts: one per role: administrator, project manager, author, reviewer, viewer.
* Samples: the three sample packages in `SAMPLE PROJECTS/` (S1000D, JSS, JSG).

## Per screen group

Group: ______________________  Batch: ________  Old commit: ________  New commit: ________  Walked by: ____________  Date: ________

| # | Check | Old | New | Same? | Notes |
|---|---|---|---|---|---|
| 1 | Every control of the old screen is findable on the new one (use the group's checklist rows; a control moved to a menu counts, a removed one does not) | | | | |
| 2 | Roles: with each of administrator, project manager, author, reviewer, viewer, the same actions are possible and the same are refused (buttons hidden or disabled, server refusals shown) | | | | |
| 3 | Every validation message appears for the same input (empty, too long, wrong format, duplicate, forbidden) | | | | |
| 4 | Import of the three sample packages gives the same report (counts, findings, repairs) | | | | |
| 5 | Export and archive give files with the same contents: compare the file lists and the hashes (`certutil -hashfile <file> SHA256`) | | | | |
| 6 | A PDF build of one S1000D, one JSS and one JSG sample is byte-identical to the baseline (the golden output of G-Q-4; `backend/test/golden-*`) | | | | |
| 7 | Every keyboard shortcut works: the Studio accelerators (`parity-baseline.json` → `keys`, `studio ...`), the JSS and JSG keys (`jss ...`, `jsg ...`, `jsg-ispl ...`, described in `frontend/src/lib/editorShortcuts.ts`) | | | | |
| 8 | Tab order is the visual order; focus is visible on every control; Escape closes what it closed before | | | | |
| 9 | The screen works at 1280 x 720, 1366 x 768 and 1920 x 1080, and at 125 % and 150 % Windows scaling: nothing cut off, no sideways scroll | | | | |
| 10 | Both themes (light and dark): every state (hover, focus, disabled, busy, error) readable | | | | |

Sign-off: ____________________ (the owner or the person the owner names)

## Results table for the batch (WP-34 acceptance: before and after of all suites in one table)

| Suite | Command | Before (old commit) | After (new commit) |
|---|---|---|---|
| Parity | `npm run check:parity` (frontend) | | |
| Frontend unit | `npx vitest run` (frontend) | | |
| Frontend verification | `npm run test:verify` (frontend) | | |
| Backend | `npm run gate` stages security, backend, pdf-smoke, backend-heavy | | |
| Browser (Edge) | `npm run gate:nightly` stage e2e, `E2E_CHANNEL=msedge` | | |
| Theme and contrast | `npm run lint:theme` (frontend) | | |
