# Agastya Platform v2 - instructions for Claude

Offline, on-premises authoring and publishing suite for technical manuals in three formats: **S1000D** (data modules, publication
modules, XSD + BREX validation), **JSS** (Indian Joint Services Specification books, Land and Naval) and **JSG** (User Handbook and
Illustrated Spare Parts List). Output is print-quality PDF through XSLT + Apache FOP. Backend: Express + TypeScript + `node:sqlite`
(`backend/`). Frontend: React + Vite (`frontend/`), with three editing canvases: the S1000D Studio, the JSS sheet and the JSG editor.
Windows is the main target; everything (Java, FOP, xsltproc) is bundled so the product runs with no network.

## First, on a new machine

Do `SETUP.md` from top to bottom before changing code: install, build, start the app with a real database, and run `npm run gate`
until it is green. Do not start work on a machine where that has not passed.

## Read before changing anything

1. `memory.md`, section 0 "Current state" (what is done, what is in progress, what the owner decided).
2. `docs/audit/IMPLEMENTATION-LOG.md`, newest sections first: every work package, what was done, what was not and why.
3. `docs/audit/14-PRIORITIZED-IMPLEMENTATION-ROADMAP.md` (work packages WP-01..37 and decisions D1-D23) and
   `docs/audit/RELEASE-EVIDENCE.md` (the 47 release gates and their state).
4. `docs/phase3/DECISIONS.md` and the records next to it: real-time collaboration (`COLLAB-CONTRACT.md` is how an editor binds),
   PDF review, GitLab, standalone accounts, performance baseline and budgets.
5. `docs/audit/mockups/index.html`: the owner-approved UI. New or changed screens must look like these.
6. `git log --oneline -30`.

## Rules (the quality bar)

* **No feature lost.** `npm run check:parity` must pass. Anything removed, renamed or moved gets a row in
  `docs/audit/baseline/parity-explanations.json` saying where it went. Keep `data-testid`s on the equivalent new element.
* **Owner-removed features stay removed**, even where a mockup still draws them: the CSDB/Files page, System 2 SNS, Brand pack, all
  applicability UI, the editor Codes strip and Codes button, PMC/ICN/contents switches.
* **Database:** the owner's data is the source of truth. Change the schema only with a new, additive migration in `backend/src/storage/`
  (next free number); never edit an applied migration or delete data.
* **New routes** must pass the guard tests: `test/authz-matrix.test.js` (policy snapshot; a sign-in-only write needs a reason in
  `test/fixtures/authz-allow.json`; regenerate the snapshot with `AGASTYA_UPDATE_AUTHZ_SNAPSHOT=1` only after reviewing the diff),
  `test/wp29-audit-coverage.test.js` (every write is audited or listed with a reason), `test/wp11-integrity.test.js`,
  `test/wp10-seams.test.js`. Every route is referenced by a test.
* **Colours only from tokens** (`frontend/src/styles/tokens/tokens.json`); `npm --prefix frontend run lint:theme` = 0 literals, 0
  contrast failures. `--accent` is a fill; accent-coloured text uses `--text-link`. Both themes must work.
* **Never weaken a test** to make it pass, and never fake a result. Update a test only for an intended, explained change.
* **PDF baselines** change only with `node backend/scripts/pdf-baseline.js --update`, after looking at the new pages; say why in the commit.
* **Vendored code** (`backend/vendor/`) changes only as a recorded exception in `docs/JSS_VENDOR_EXCEPTIONS.md`.
* Arial stays the house font.
* **Live co-editing is the default.** An editor change goes through its collaboration binding: the server's write-back must stay
  byte-identical to a normal save, and `reconcile` must change only what differs. Never delete+recreate a block that has content.
* **Speed budgets** (`docs/phase3/perf-budgets.json`) are checked nightly; a change that slows a measured path must say why.

## Commands

| What | Command |
|---|---|
| PR gate (run before you finish) | `npm run gate` |
| Types | `cd backend && npx tsc --noEmit -p .`; `cd frontend && npx tsc --noEmit -p .` |
| Lint, parity, cleanup | `npm run lint`, `npm run check:parity`, `npm run check:cleanup` |
| Backend tests (rebuild dist first: `cd backend && npx tsc -p .`) | `cd backend && node --test --test-concurrency=1 test/<file>.test.js` |
| Frontend unit | `cd frontend && npx vitest run` |
| One browser spec | `cd frontend && E2E_PORT=41xx E2E_CHANNEL=msedge npx playwright test e2e/<spec>` |

## Habits that avoid breakage

* Merge with `git merge --no-ff`. In `docs/audit/IMPLEMENTATION-LOG.md` and `docs/OPERATIONS.md` conflicts usually mean both sides
  added a section: keep both.
* After every merge: both `tsc`, lint, parity, cleanup, and the guard tests above.
* On Windows, write multi-line scripts to a file instead of `node -e` with regexes or backticks (shell escaping has broken files).
  Files use CRLF; conflict-marker scripts must accept `\r\n`.
* Never run two Playwright runners on one port; the full suite owns 4050. Use `E2E_CHANNEL=msedge` (Chrome stable crashes in the Studio).
* Never touch `workspace/` (the live data) or a server you did not start. Never push or change git config without the owner asking.
* End commit messages with the attribution lines the session gives you.
