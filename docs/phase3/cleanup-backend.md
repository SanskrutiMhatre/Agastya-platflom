# Phase 8: backend cleanup, performance follow-ups and feature gaps

Branch `worktree-agent-ab356b4e8e7b9c366` (from local `main` 422528f), 2026-11-28. Scope: the backend items of the phase 8 brief, the two
small frontend features it names, the perf-budget rule and the architecture documents. The editors and collaboration (`frontend/src/collab`,
`studio`, `jss`, `jsg`, `backend/src/services/collab`, `backend/src/shared/collab|jss|jsg`) belong to the parallel agent and were not touched.
No migration was needed. No PDF output path was touched (the PDF baselines are unchanged by construction; `wp30-pdf-regression` is owed, see
the end).

## Before and after (`backend/scripts/bench/phase3-baseline.js --only api,validation`, port 4391, throwaway workspace)

Same machine, same day; this host also ran the other agent's work, so single runs are noisy. "after" = the final code (runs 1 and 4);
runs 2 and 3 measured a variant (module create through the grouped writer) that was slower and was taken back (item 3). ms.

| Measure | before | after (run 1) | after (run 4, API only) | variant (runs 2 / 3) | target |
|---|---|---|---|---|---|
| Package import, 1,000 modules | 12,075 | 9,991 | 9,873 | 11,037 / 9,628 | - |
| Module create at 1,000, seq median / p95 | 49.8 / 71.1 | 23.8 / 86.8 | 22.4 / 84.2 | 46.2 / 104.2, 50.2 / 139.4 | p95 200 |
| Module create at 1,000, 10 at once p95 | 508.9 | 249.5 | 247.0 | 431.7 / 401.6 | p95 200 |
| Event-loop max over save + create at 1,000 | 486.3 | 236.2 | 248.5 | 276.3 / 257.3 | 100 |
| Save at 1,000, 10 at once p95 | 98.3 | 104.0 | 113.8 | 104.8 / 93.4 | - |
| Validation of 200, after one edit | 1,009 | 747 | - | 747 | 500 |
| Validation of 200, warm fresh (3 runs) | 820-871 | 363-401 | - | 358-435 | - |
| Validation of 200, cached | 12 | 19 | - | 14 | - |
| `any` in backend (lint ratchet) | 278 (baseline 277) | 277 | 277 | - | 277 |

In process (scratch profile of `validateProject` after one edit, 200 modules): 1,102 ms before -> 532 ms (applicability 331 -> 58,
BREX 263 -> 25; XML + XSD 328 and ids 61 are what is left). Module create in process at 1,000 modules, sequential, 40 creates: 23.6 ms each
(fsync 26 % of the time, the rest spread: rename, copy of the PM backup, index update).

Targets not met: create p95 under 10-way concurrency and the event-loop stall at 1,000 modules (see item 3 for what is left), and validation
after one edit (747 vs 500 over HTTP; the XSD of the edited module plus the project-wide id/xref pass remain).

## 1. Batched atomic writes (`backend/src/storage/atomicWrite.ts`)

**Change.** `writeFilesAtomic(files, precommit?)`: every file is written to its own temporary sibling (`wx`), all are fsynced at once on the
libuv pool (async `fsync`, not one blocking call after another), closed, then `precommit` runs (the caller's last checks, e.g. "still
unique", "does not exist yet"), then each temporary file is renamed over its target and finally each distinct directory is fsynced **once**.
Any failure before the renames discards every temporary file (nothing changes); a failure during the renames removes the temporaries not
renamed and throws `BatchWriteError(failure, renamed[])`, so the caller knows exactly which files landed. The reasoning (why each file's
data is durable before any rename, why one directory fsync per directory is enough, why Windows' EPERM on a directory fsync is ignored as
before) is in the file's header comment.

`contentStore.writeTexts`, `projectFiles.saveNewRevisionedBatch` (records each file's revision; a revision that cannot be recorded removes
the whole batch, as `saveRevisioned` does for one file) and `csdb.createDms` (every check of `createDm` in the same order, plus "the same
module twice in one group" -> `DUPLICATE_DMC`, re-checked against the identity index in `precommit`) build on it. The package import
(`packages.ts`) writes new modules in groups of `IMPORT_WRITE_GROUP` (20) through `createDms`.

**Measured.** Scratch micro-bench, 1,000 x 8 KB files on this disk: one by one 5.3 s; batch with sequential fsync 3.9-4.4 s; batch with the
fsyncs on the pool 3.4 s with the longest loop gap 50-65 ms per group of 50. Package import of 1,000 modules: 12.1 s -> 10.0-11.0 s.

**Files.** `backend/src/storage/atomicWrite.ts`, `storage/contentStore.ts`, `services/projectFiles.ts`, `services/csdb.ts`, `services/packages.ts`.

**Risks.** A crash between two renames leaves some files of a group written and others not; the import already reports per file, and each
landed file has its revision. The group size trades loop stalls (bigger groups = longer synchronous rename runs) against fsync overlap.

## 2. Document index `deleteDm`: remove one entry

**Change.** `csdb.deleteDm` calls the new `docIndex.removeFile(projectId, dir, rel, at)` (`backend/src/core/collab/docindex.js`): the file's
own row is marked missing, exactly as a full walk would mark it; if the file is still there it is re-read (`syncFile`); if the index had no
row for it, the full `syncProject` runs as before. **Files.** `core/collab/docindex.js` (the old index module, not the collaboration code),
`services/csdb.ts`. **Test.** `phase8-cleanup.test.js` "deleteDm marks the entry missing exactly as a full sync would".

## 3. Module create at 1,000 modules: append one PM entry

**Change.** `pm.placeNewDm` first tries `appendPmEntry`: when the PM file on disk is the server's own canonical text (the memo of the last
full write: same stat signature, the parsed model equal to the kept one) the new entry is serialised alone under the same header and inserted
before `</content>`; the result is read back (parsed: one entry more, no warnings; the slice re-serialises identically) before it is written.
Otherwise the full rewrite runs as before. `appendedPmText` is exported so the test proves the bytes equal the full rewrite.

The append applies from the second write of a PM the server did not write itself: the first full rewrite of a foreign PM can complete its
header (e.g. adds the enterprise name), and only that rewritten text is the fixed point the append extends. Uniqueness of the new module was
already checked against the kept identity index (`csdbIndex` `identityClash`), not by walking the folder. Tried and taken back: a single
create through the grouped writer (a group of one, fsync on the pool): over HTTP it doubled the sequential median (46-50 ms against 22-24 ms,
runs 2 and 3 above), so a create keeps the one-file writer and only the package import uses groups.

**Test.** `phase8-cleanup.test.js`: byte-identical to the full rewrite on the six Xignal annexure PMCs, the front-matter PMC, a 1,000-entry
PM, an empty PM and one with XInclude references; `placeNewDm` takes the append path and the result equals a full rewrite.

**What is left** (why p95 under 10-way concurrency is still above 200 ms): ten creates at once queue behind the per-project document lock and
each one's fsync; the remaining synchronous work per create is the PM backup copy, the identity and document index updates and the response
listing. Next steps if wanted: drop the per-create `.bak` copy of the PM (the revision log already keeps every version), and batch index
updates of concurrent creates.

## 4. Package import off the request thread

**Not moved.** The import stays in the server process (it already yields between groups and reports progress). Reason: it has to take the
same document locks, write through the same revisioned writer and update the same in-memory indexes (kept CSDB listing, identity index,
document index) as every other write; those live in the server process. A worker would need a second copy of all of them, or a lock protocol
across threads, for a step whose CPU part (parsing, XSD) already runs in the job pool. The blocking part that was left, the per-file fsync,
now runs on the libuv pool (item 1).

## 5. Incremental BREX and applicability

**Change.** `brex.ts`: the BREX chain of each (issue, declared BREX) is resolved once per validation pass (`BrexRun.chains`), and each
module's facts (content hash, issue, declared BREX) are kept per file (`FileMemo`, keyed by size, mtime, ctime, inode), so an unchanged module
is not read and parsed again; `checkModuleBrexFile` is the file-based entry point `validation.ts` now uses. The existing result memo (module
hash + rule set) does the rest. `applicability.ts` `validateProject` keeps each module's problems with its file signature and the project
context it was checked in (ACT/CCT/PCT model, files, CSDB folder); a module whose applicability refers to other modules is always re-checked.

**Test.** `phase8-cleanup.test.js` "validation after one edit equals a run with every cache cleared" (issue ids stripped). `wp17-brex-fast`,
`brex-gate`, `applic-publish`, `wp32-validation-scale` pass.

## 6. Dependencies

`tailwindcss` removed from `frontend` devDependencies (it generated nothing: no `@tailwind` directive anywhere, audit DS-008; PostCSS ran only
autoprefixer). Lockfile: 828 lines removed, nothing else changed. Every other dependency of `backend/` and `frontend/` was checked by
search and is imported (`ts-node-dev` by the backend `dev` script). `lib0`, `yjs`, `y-protocols` untouched. Frontend build passes.

## 7. Lint and cleanup

The one new backend `any` came with the collaboration merge (238b6c2): `CollabHooks.connect`'s `user`. It is now `CollabUser` (the session
layer's public user) in `services/broadcast.ts`. `any.backend` 277 = baseline. The two stale `check:cleanup` allow-list entries
(`shellSlots.tsx` `TopbarActions`, `StatusItems`, now referenced) were removed. What `check:cleanup` / lint still report is all in the other
agent's area: `src/collab/client.ts::liveRoom`, `src/jss/live.ts::JSS_COMMENT_FILE`, `src/studio/core/xml.ts::serializeDoctype` (exports
referenced nowhere) and `lib0` (imported only by yjs).

## 8. Feature gaps

* **PDF review in the project archive.** Export adds `pdf-review.json` (format `ReviewArchive` in `services/pdfReview/index.ts`): every
  thread with kind, status, required, text, replacement, page, anchor, PDF version, original placement, source link, author name, times and
  replies; every version seen of every reviewed PDF; the release-block setting. Import (`importReview`, step 7 of the archive restore) gives
  every thread and reply a new id, keeps the anchor exactly (checked as a request's anchor, but the stored quote context and the `fuzzy` flag
  are kept untrimmed), keeps the PDF version and times, makes the importer the author with the first author's name and date in front of the
  text (the convention of the review comments), and restores the versions and the setting. A bad thread is left out and named in the
  findings. The restore count is `restored.pdfComments`. Repository: `allVersions`, `touch` added (no schema change).
* **XFDF import.** `POST /api/projects/:id/pdf-review/import` `{ key, xfdf }` (reviewer, `pdfreview.comment`; audited `pdfreview.imported`).
  Text markup (highlight, underline, strikeout, squiggly) -> its QuadPoints are the rectangles and the words under them, read from the PDF
  on disk, are the quote (with context), so the thread re-anchors like any other; markup over no text, shapes, notes, stamps and free text ->
  an area. `inreplyto` -> a reply (a reply to a reply goes to the same thread); a Review state (Completed, Accepted, Rejected, Cancelled) ->
  resolved. XML safety as an upload (`checkXmlSafetyOf`), 8 MB and 5,000-annotation limits; skipped items are named in the answer. UI:
  an "Import XFDF" icon button (upload icon) in the PDF review bar (reviewers and up). The authz snapshot row was added after review: the same policy as the other
  reviewer routes of the PDF review.
* **GitLab Repository page.** Offered in Ctrl+K "Jump to" and as a Project Home tile, only while an administrator has GitLab switched on
  (the same check as the rail, `gitlabApi.enabled()`).

**Files.** `services/pdfReview/index.ts`, `repositories/pdfAnnotationRepository.ts`, `services/projectArchive.ts`, `routes/pdfReview.ts`,
`test/pdf-review.test.js`, `test/fixtures/authz-policy.snapshot.json`; `frontend/src/api/pdfReview.ts`,
`components/pdfreview/PdfReviewView.tsx`, `components/QuickSwitcher.tsx`, `pages/project/ProjectHomePage.tsx`.

## 9. Server-Timing and a noise-tolerant budget rule

Confirmed: `AGASTYA_SERVER_TIMING` defaults to `admin`: everyone gets the total, only administrators get the database detail
(`services/metrics.ts`; test `phase3-perf` "the database time only for administrators"). New rule in `scripts/ci/perf-budgets.mjs`: a source
may be given several times (`--backend a.json --backend b.json --backend c.json`, or `a,b,c`) and the **median** of the runs is judged, so
one slow run does not fail a budget (two of three must be over `max`); one run behaves as before. The gate's `perf-budgets` stage runs the
backend bench `PERF_BUDGET_RUNS` times (default 3 for the release profile, 1 for the nightly). Rule test added
(`scripts/ci/perf-budgets.test.mjs` 4/4).

## 10. Architecture documents

`docs/PROJECT_ARCHITECTURE_AND_TECH_STACK.md` section 4.1: the Phase 3 components (collaboration core, PDF review, GitLab, build cache,
validation cache, kept CSDB listing, standalone accounts), where each sits and its record. `docs/BUNDLED-COMPONENTS.md`: the Phase 3 packages
re-checked, no new package, tailwindcss removed.

## Tests run (targeted, each file alone, throwaway workspaces)

Backend: `phase8-cleanup` 6/6 (new), `wp11-integrity` 16/16, `packages` 10/10, `api` 17/17, `csdb-objects` 4/4, `pm-multi-ref` 5/5,
`pm-multiref` 3/3, `import` 5/5, `importer-http` 12/12, `phase7-perf` 5/5, `phase3-perf` 3/3, `wp17-perf` 9/9, `wp17-brex-fast` 5/5,
`brex-gate` 3/3, `wp32-validation-scale` 8/8, `wp32-event-loop` 1/1, `wp32-validator-crash` 1/1, `applic-publish` 12/12, `pdf-review` 10/10,
`project-archive` 5/5, `gitlab` 13/13, `publish-gate` 24/24, `wp30-pdf-regression` 10/10 (2 skipped, JSS-0251 package absent), guards `authz-matrix` 6/6, `wp29-audit-coverage` 2/2, `wp10-seams` 11/11, `routes-guarded` 1/1.
`wp16-validation-framework` 5/6: the failing check names `backend/src/shared/jss/xml.ts` and `shared/jsg/xml.ts` (an XML escaper outside
`lib/xml.ts`), files of the other agent's area, not changed here. Scripts: `perf-budgets.test.mjs` 4/4. Both `tsc`, frontend build, `node
scripts/ci/lint.mjs` (fails only on the other agent's exports and `lib0`), `check:parity` PASS, `lint:theme` 0 literals. E2E (msedge, each alone): `gitlab.spec` 7/7 on 4392 (mock 4394; new: the Home tile and the "Jump to" entry), `pdf-review.spec` 5/5 on 4393 (new: XFDF import through the UI). The first try of `pdf-review.spec` failed because a labelled "Import XFDF" button wrapped the PDF toolbar to two rows and page 3 was not rendered in the smaller view; the button is now icon-only (named by `aria-label` and title) and the toolbar stays one row.

## Checks owed (final verification phase)

* `wp30-pdf-regression` ran here 10/10 (2 skipped: the JSS-0251 customer package is not in this checkout); the full `npm run gate` after both phase 8 branches are merged.
* `wp16-validation-framework` duplicate scan: the JSS/JSG `xml.ts` escapers (other agent).
* A quiet-host re-run of the bench (three runs, median) for the create and loop numbers; the targets for create under concurrency, the
  event-loop stall at 1,000 modules and validation after one edit are not met yet (items 3 and 5 say what is left).
* The full backend suite, since the package import now writes through `csdb.createDms` and the grouped writer.
