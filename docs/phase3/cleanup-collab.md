# Phase 8: editors and collaboration cleanup

This is the work branch for the editors and live co-editing part of the phase 8 brief. It was started from local `main` 422528f on
2026-11-28, and `main` (0a100f3, the backend cleanup) has been merged in with `--no-ff`.

Scope:

* `frontend/src/collab`, `studio`, `jss`, `jsg`;
* the editor pages;
* `backend/src/services/collab`;
* `backend/src/shared/collab|jss|jsg`;
* the e2e specs that broke by design under live co-editing.

No migration was added: the next free migration number is still 031. No PDF output path was touched.

## 1. The data-loss gap: a moved block keeps concurrent edits (Yjs schema 2)

**Before.** Yjs 13 has no move operation. A moved block (Move up/down, indent/outdent, a section dragged, an ISPL plate or row
reordered) reached Y as a delete plus an insert. If another author was typing in that block at the same moment, their typing was lost.

**Now.** The schema is `backend/src/shared/collab/ydom.ts`, schema 2.

* Every movable element is a **block**: `ydoc.getMap('blocks')` maps a block id to its `Y.XmlElement`.
* The tree holds only a placeholder, `Y.XmlElement('#ref', { id, tok })`.
* `ydoc.getMap('place')` maps a block id to the **token** of its live placeholder.
* A move writes a new placeholder with a new token, sets `place[id] = tok`, and deletes the old placeholder. The content element is never
  re-created, so typing that happens at the same time lands in it.
* Concurrent moves of one block resolve last-writer-wins on `place`. Only one placeholder is live; the others read as absent.
* Tokens were chosen over `client:clock` keys because of undo. An undo of a move re-creates the old placeholder, and that is a new item
  with a new clock. The token travels with the attribute, so the undo also restores `place`, and the block comes back where it was.
* The readers resolve placeholders: `ychildren`, `liveKids`, `treeParent`, `rawIndex`, `liveIndex`, `liveAt`, `observeTree` (events
  batched per transaction) and `undoScope` (the tree, `blocks` and `place`).
* The bindings that move blocks with it are S1000D (`frontend/src/collab/binding.ts`), JSS (`shared/jss/yjss.ts`) and JSG
  (`shared/collab/jsgForm.ts`). Caret anchors, remote carets and comment anchors survive a move.

**Migration is lazy.** There is no epoch change and no DB migration.

* A schema-1 room (elements directly in the tree) reads unchanged.
* Its elements become blocks the first time they are moved.
* A browser bundle from before this change cannot read placeholders, so **stale clients must reload after the deploy**. The epoch is the
  same, so they are not forced to reload.

**Tests**

* `collab-rooms.test.js`, legacy test: a schema-1 room is built by hand, gets a lazy block on the first move, and the second move keeps
  concurrent typing.
* `collab-jss.test.js` (9/9), over a socket: a paragraph moves below a list and section `smv2` is indented into `smv1` while the other
  author types in both. Both edits are kept.
* `collab-jsg.test.js` (10/10):
  * handbook: a paragraph moves below a clause, and a section moves to the front;
  * ISPL: a plate moves while the other author edits a part designation and title.
* `frontend/src/collab/binding.test.ts` (12/12):
  * move down while typing;
  * demote while typing;
  * two concurrent moves while typing;
  * undo of a move keeps the other author's typing;
  * the selected table follows a remote move.

## 2. The known gaps

| Gap | Now |
|---|---|
| Element selection (a selected table or figure) not re-mapped after a remote change | **Fixed.** S1000D: `remapElementSelection` in `binding.ts` re-points the selection; when the element is gone it becomes a caret. JSS: the model keeps object identity through a move, so the selection follows it. JSG: `liveRedraw` re-selects the model object. |
| No remote caret in JSG ISPL appendix cells | **Fixed.** Cells are text slots (`kind: 'cell'`): carets and selections are encoded and drawn there. A cell made of several text parts places the caret approximately (by character offset across the parts). |
| Undo history lost when the editor is rebuilt (a check-out taken or freed, the review lock) | **Fixed (JSG).** The undo manager is kept per Y doc across a rebuild, and destroyed only on leaving. JSS keeps one binding per room. |
| Per-chapter check-out locks the whole live book | **Not done, documented.** See below. A related bug was fixed: lease renewal renewed every held lease as whole-document. It now renews each lease with its own part (`renewLease` in `rooms.ts`). |
| Quick preview / Generate asked the room for a revision each time | **Fixed.** A preview calls `save({ revision: false })`, which is `flush(false)` while live: the file is written, no history entry is made, and the save state is not touched. Generate still records a revision. |

**Why per-part live locking was not done.**

* A server-side refusal of an update that touches a checked-out chapter leaves the change in the sender's Y doc. Yjs cannot take back one
  part of an update, so the room and that client diverge until a reset.
* SYNC2 (the catch-up after a reconnect) would also have to be checked, or it bypasses the check.
* A safe version needs client-side refusal per part: the editor keeps the chapter read-only, and the server checks as a backstop with a
  reset. That is a contract change for all three formats.
* Until then, a chapter check-out while live locks the room for the others, as before. The check-out test now asserts that only
  `[chapterId]` is in `/checkouts` while typing, and that check-in frees the room.

## 3. JSG opening long task

`frontend/src/jsg/editor.ts` now renders in slices:

1. The navigation is drawn first.
2. Each chapter heading, section and appendix is a job, run in 30 ms slices on `setTimeout`.
3. At the end, `'jsg-rendered'` is dispatched, and the live binding redraws carets.

Anything that needs the whole sheet first calls `ensureRendered()`: the live slots, go-to-module, find and the inspector.

Measured with `frontend/scripts/perf/phase3-frontend.mjs` (Edge, port 4381). The results are under the scratch folder: `perf-before.json`,
`perf-after.json` and `perf-after2.json`.

| Measure | before | after (2 runs) | target |
|---|---|---|---|
| JSG cold open, longest task | 263 ms | 197 / 169 ms | < 200 ms |
| JSG warm open, longest task | 118 ms | 87 / 91 ms | - |
| JSS (not changed; noise) | 241 ms | 190 / 220 ms | - |

## 4. Lint leftovers

* Removed the unused exports `liveRoom` (`collab/client.ts`), `JSS_COMMENT_FILE` (`jss/live.ts`) and `serializeDoctype` (the
  `studio/core/xml.ts` re-export).
* **lib0** stays a frontend runtime dependency. It is imported by `backend/src/shared/collab/protocol.ts`, which Vite bundles into the
  frontend (`resolve.dedupe`), so it is used. The cleanup scan (`frontend/scripts/cleanup/scan.mjs`) now also counts imports from
  `backend/src/shared`, with a comment saying why. There was no allow-list entry and no package.json change.
* **One XML escaper** (the lead's request; `wp16-validation-framework` duplicate scan):
  * `backend/src/shared/xmlEscape.ts` holds `escText` and `escAttr`.
  * `lib/xml.ts`, `shared/jss/xml.ts` and `shared/jsg/xml.ts` use it.
  * The byte-preserving writers in `shared/collab/xmlForm.ts` are a different function, renamed `exactText` / `exactAttr`, with a comment.
* **wp16 rule update.** The shared-code rule now allows:
  * relative imports that resolve inside `backend/src/shared`;
  * the packages `yjs` and `lib0` (the shared collab code needs them in both runtimes; the reason is in the test).

  The runtime-globals regex no longer matches `document.` inside a word such as `jsg-document.xml`. wp16 run alone: **6/6**.
* `node scripts/ci/lint.mjs`: exit 0.

## 5. e2e specs rewritten for live co-editing

Every editor opens its document live: changes are sent as they are typed, Save writes through the room, there is no draft, no PUT and no
edit conflict. The classic save-by-version flow still exists as the fallback when the room cannot be joined (C24, `AGASTYA_COLLAB=0`).

`frontend/e2e/support/live.ts` provides `classicOnly(page | context)`. It answers that page's JOIN frames with `ERROR DISABLED`, the
frame a server with `AGASTYA_COLLAB=0` sends, built with the shared protocol encoder. Everything else on the socket passes through.

Each spec keeps every classic assertion on such a page, and adds or rewrites tests for the live behaviour. No assertion was dropped. The
parity rows for the 14 renamed or split tests are in `parity-explanations.json`.

Each spec was run alone with Edge on port 4381, in a temp workspace:

| Spec | Result | Change |
|---|---|---|
| `wp05-dataloss` | 14/14 | FE-001 live + classic. FE-003, FE-006 (JSS, JSG), FE-007 and FE-024 ×2 classic. New live tests: no draft (JSS and JSG, auto-save disabled), another save merges with no conflict. |
| `wp21-editor-chrome` | 22/22 | First view "Saved". Ctrl+S/Ctrl+F run live and classic (the file checked). Find-and-replace sends the change as it is made. PRD-004 compare-and-merge runs classic. |
| `jss-editor` | 13/13 | Live state words. Content order live + classic. Stale-save refusal classic. |
| `jsg-editor` | 12/12 | Live state words, auto-save disabled. New classic test (All changes saved → Unsaved → Saved, auto-save on). |
| `doc-pages` | 15/15 | New live leave test (no question, the text reaches the file). The leave guard runs classic. Selector `.jss-p` → `.jss-para`. |
| `wp22-navigation` | 8/8 | Esc + Ctrl+S live and classic. |
| `wp18-performance` | 6/6 | B4 live (no PUT /dms/, 2 GETs after the key press) and classic (the PUT, 2 GETs after it). |
| `00-platform` | 41/41 | Unchanged: the Studio save flows pass live (the "Saved" toast). |
| `collab-jss`, `collab-jsg`, `collab-s1000d` | 4/4, 4/4, 3/3 | Unchanged; run to check the sliced render, the cell carets and the moves. |

**Two product bugs were found by these runs and fixed:**

* **JSS live undo lost the keyboard.** An undo that removes the focused block (a new paragraph) left focus on `<body>`, so Ctrl+Y no
  longer reached the editor. Classic `restore()` refocuses the sheet; live now does the same (`keepKeyboard`).
* **Section-code badges were missing in live JSS and JSG editors.** The live editor is built after the room is joined, later than the
  effect that hands it the badge function. The effect now also runs when the live editor is built.

**Visual baselines expected to change.** They were not re-taken (brief). They are `e2e/visual/__screenshots__/{light,dark}/`
`studio.png`, `jss-editor.png` and `jsg-editor.png`:

* the save-state word is now "Saved", not "All changes saved";
* JSG shows the auto-save box disabled;
* the people faces and the live/comment controls appear in the header and the outline;
* for a locked document, the lock banner.

## 6. Other checks (2026-11-28)

* `tsc --noEmit`: backend and frontend clean.
* vitest `src/collab src/jss src/jsg src/studio`: 16 files passed, 1 skipped; 534 tests passed, 2 skipped.
* Backend, with `dist` rebuilt:
  * `collab-rooms`, `collab-jss`, `collab-jsg`, `authz-matrix`, `wp29-audit-coverage`, `wp11-integrity` and `wp10-seams`: **69/69**;
  * `routes-guarded`: 1/1;
  * `wp16-validation-framework` alone: 6/6.
* `node backend/scripts/bench/collab-load.js --port 4381`, with its own temp workspace:

  | Load | Latency p50 / p95 / max | Server | Result |
  |---|---|---|---|
  | 120 clients, 40 modules, 15 typists in one module | 8 / 25 / 78 ms | CPU 32% of one core, RSS 174 MB | converged, written back |
  | JSS: 4 books, 15 clients | 10 / 28 / 79 ms | - | converged |
  | JSG: 4 documents, 15 clients | 10 / 28 / 75 ms | - | converged |

  At the end, the script could not remove its own temp folder (`EBUSY` on `publisher.db`). That folder is in `%TEMP%`; nothing else was
  touched.
* `check:parity`: PASS. `lint:theme`: 0 colour literals.

## 7. Owed

* The full `npm run gate` and the full Playwright suite. This brief's policy was targeted runs only.
* Re-taking the three editor visual baselines (above), after looking at them.
* The per-part live lock (section 2), if wanted: a contract change.
* The installer was not rebuilt.
