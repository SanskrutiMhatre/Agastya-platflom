# Phase 3 (P3-1): the JSS binding of the collaboration core

This is the record of how the JSS editor was bound to the live co-editing core, following `COLLAB-CONTRACT.md`. The JSS book now behaves
like an S1000D data module:

* Co-editing is live by default.
* People see each other's carets and selections, with names and colours, and their faces in the outline.
* Each person has their own undo and redo.
* Saving is continuous, with the same words as S1000D: "Saved", "Syncing…", and "Offline - changes kept locally".
* Changes the server has not acknowledged yet are kept in IndexedDB.
* Reviewers get a live, read-only view.
* Comments are anchored to the live text.
* Check-out is an optional lock, shown as "Locked by X".
* External changes are merged into the live document instead of overwriting it.

Branch: `worktree-agent-ab031df2cb7ba0cc4`, built on main `238b6c2`.

## 1. Files

| File | What |
|---|---|
| `backend/src/shared/jss/model.ts`, `xml.ts` | **Moved** (with `git mv`) from `frontend/src/jss/`, so that the server reads and writes the book with the same parser and serializer as the editor. `xml.ts` now takes an optional DOMParser (xmldom on the server) and gains `parseJssElement(root)`. Nothing else changed. `frontend/src/jss/model.ts` and `xml.ts` are now one-line re-exports, so every existing import still works. |
| `backend/src/shared/jss/yjss.ts` (new) | The Y schema of a JSS book (section 2), plus `loadDoc`, `reconcileDoc`, `readDoc`, the `Reader` and the `Sync`. It is shared by the server and the browser. |
| `backend/src/services/jss/collab.ts` (new) | The `CollabFormat` for kind `jss` and `registerJssCollab()`. |
| `backend/src/services/jss/service.ts` | `writeSource` now runs its checks through two exported helpers, `assertJssText` and `assertJssType`, and the live write-back runs exactly the same checks. The behaviour of a normal save is unchanged. |
| `backend/src/routes/jss.ts` | `registerJssRoutes` calls `registerJssCollab()` first. Registering here, not in `formats.ts`, avoids an import cycle (ARC-006). |
| `backend/src/services/review.ts` | **Shared**: the comment `dmFile` check also accepts `jss/<name>` and `jsg/<name>`. The JSS book is `jss/book`. |
| `frontend/src/jss/editor.ts` | Hooks for the live binding (section 3). The way the editor edits (D16) and every `data-testid` are unchanged. |
| `frontend/src/jss/live.ts` (new, loaded lazily) | The browser binding: the room, local→Y, Y→local, the UndoManager, presence and carets, outline faces, and comment anchors. |
| `frontend/src/jss/style.ts` | The caret, selection and face styles, scoped under `.jss-collab-cursors` and `.jss-ol-*`. They use tokens only (`lint:theme` reports 0). |
| `frontend/src/pages/project/JssEditorPage.tsx` | Joins the room. If the join fails, the page falls back to the classic flow. It also shows the `collab-lock` banner, runs a debounced check of the merged text, keeps Save enabled while live, and passes the comment pinning. |
| `frontend/src/editors/host/useDocEditor.tsx`, `DocEditorShell.tsx`, `EditorComments.tsx` | **Shared with JSG**. These changes are additive (section 4). |
| `backend/test/collab-jss.test.js` (new) | The backend proof: 8 tests. |
| `frontend/e2e/collab-jss.spec.ts` (new) | The browser proof: 4 tests. |
| `backend/scripts/bench/collab-load.js` | Extended with JSS books, through the flags `--jss`, `--jss-clients` and `--jss-typists`. |

No migration was added; the next free number is still 031. No dependency changed.

## 2. Decisions

* **Room and document.** A project holds one JSS book, so the room is `<projectId>/jss/book`. `resolve` maps it to the project's
  `publication.xml`, and returns 404 for a project that is not JSS-authored. The write role is `editor` and the capability is `dm.write`,
  the same as `PUT /jss`.
* **Schema.** The Y tree has the shape of the editor's model, written as XML elements:
  * the root `jssbook` holds `bookmeta` and `body`;
  * `body` holds `chapter`, which holds `title`, then the blocks, then the sections;
  * the blocks are `para`, `list/item`, `table/thead|tbody/row/cell`, `figure/graphics|legend`, the notices and `pageBreak`;
  * inline content (`b`, `i`, `u`, `sup`, `sub`, `br`, `xref`) is held as XmlText.

  The server's text is `serializeJss(readDoc(ydoc))`, so a live write-back is **byte-identical** to a normal save of the same model. The
  backend test proves this on the uhb, mm and orm skeletons, on rich content, and on a live edit.
* **Local to Y.** After every change, the editor calls `host.onChange(at)`. Typing into a text updates only that text: `Sync.node` or
  `Sync.title` on that paragraph, run, title or key item, and the change becomes the common prefix and suffix diff of the XmlText. Any other
  change (a command or a structural edit) runs `Sync.doc`. `Sync.doc` is a keyed diff that matches by model object identity and keeps the
  longest increasing subsequence, so unchanged nodes and their Y identity stay. Everything happens in one `ORIGIN_LOCAL` transaction. The
  document is never re-serialised to be sent.
* **Y to local.** Remote events (`observeDeep`, any origin other than `ORIGIN_LOCAL`) change the model in place through a `Reader` that
  reuses the mapped objects. When the events touch only texts, the editor redraws just those texts and the caret keeps its place in the
  words (`shiftOffset`). When the structure changes, the whole sheet is redrawn and the caret and the scroll position are kept.
* **Undo.** The live document uses `Y.UndoManager` with `trackedOrigins: {ORIGIN_LOCAL}` and a capture time of 600 ms. Typing counts as
  one step, and every command is its own step (`stopCapturing`). While the document is live, the editor's own XML-snapshot history is off.
* **External changes** go through `reconcileDoc`, which is `ydom.reconcile`: positional and minimal. These are a PUT from another tab, a
  conversion, an import, a restore and a GitLab pull. The backend test shows that a one-word change costs 30 bytes.
* **Write-back** refuses exactly what a normal save refuses:
  * empty or too large;
  * unsafe XML or a DOCTYPE;
  * malformed;
  * not native JSS;
  * a document type different from the project's.

  When it is accepted, it writes a revision (`saveRevisioned`, `selfWritten`), updates the identity record, and starts JSS validation on
  the written XML without waiting for it.
* **Check-out.** `leasePart` returns `''`. This means **any** lease locks the whole room, whether it covers the whole document or a single
  chapter (D22). That is coarser than D22, which lets two people hold two different chapters. See the gaps in section 6.
* **Fallback.** A failed join (`DISABLED`, `NOT_SUPPORTED`, `TIMEOUT`, `BUSY`, or any other error) opens the classic save-by-version
  editor, as contract item C24 requires.
* **Validation** runs on the merged text, 2.5 s after the last change. It never blocks typing.
* **Comments** use the file `jss/book` and anchor `{path, tag, text, y:{start,end}}`, where `start` and `end` are Y relative positions.
  Typing a comment moves the focus to the comment box, so the binding keeps the last selection made on the sheet and uses that.

## 3. Editor hooks (`frontend/src/jss/editor.ts`)

None of these hooks changes how the editor edits.

* The host gets `onChange?(at)`. `TextSlot` records which model node and which text slot an editable element is: `inline`, `title`,
  `num` or `text`.
* `setCollab(EditorCollab|null)` hands undo, redo and "unsaved" over to the room.
* There are lookups between elements and slots (`slotOf`, `slotEl`), access to the sheet and outline (`scrollHost`, `paperEl`,
  `outlineRowFor`, `sectionOf`), and an `onOutlineDrawn` callback.
* `setReadOnly(ro)` changes read-only at run time and redraws.
* `applyRemote(texts|null)` redraws the changed texts or the whole sheet.
* `refreshToolbar()`.

## 4. Changes to the shared core and host (for the lead and the JSG agent)

* `frontend/src/collab`, `backend/src/services/collab`, `shared/collab`: **no changes**.
* `backend/src/services/review.ts`: the `dmFile` check also accepts `^(jss|jsg)/[A-Za-z0-9._-]{1,64}$`, so JSG can use it too.
* `useDocEditor.tsx` adds:
  * the exported types `LiveDocHandle` and `LiveSaveState`;
  * a `liveRef` (when it is set, `save()` calls `flush(true)` and keeps no local draft);
  * `live` and `setLive`, which pass `saveState.live` through.

  Nothing changes while `liveRef` is null.
* `DocEditorShell.tsx` adds the optional props `live`, `pinning` and `commentsFile`:
  * `TeamChip` gets `live`;
  * `CommentsButton` gets `always={!!pinning}`;
  * `CommentsPanel` gets `activeFile` and `pinning`;
  * `useEditorComments` gets the file.

  Without these props, the shell behaves as it did before.
* `EditorComments.tsx`: a comment on the active file reads "This document" when the file name contains `/`, and "This data module"
  otherwise.

## 5. Possible regressions (by design; not run, per the testing policy)

These existing specs assume the classic JSS save. They need updating for the live default, or a run with `AGASTYA_COLLAB=0`:

* `e2e/jss-editor.spec.ts`. I checked this one: it now fails at its 2nd test, because `jss-state` reads "Saved" instead of "All changes
  saved". Its "Unsaved changes" states and its stale-save conflict test (EDIT_CONFLICT) do not occur on a live document.
* `e2e/wp05-dataloss.spec.ts`: the JSS draft and conflict cases. A live document makes no draft.
* `e2e/wp21-editor-chrome.spec.ts`: the JSS row expects "All changes saved" and "Unsaved changes".
* `e2e/doc-pages.spec.ts` line 282: `jss-state` "Unsaved changes".
* JSS visual baselines: the lock banner, faces in the outline, and the comment button, which is always shown while live.
* Anything that counts `PUT /jss` calls while editing. A live book writes through the room.

## 6. Known gaps

* **Per-chapter check-out** (D22) locks the whole live book for the others, not only the chapter.
* A moved block (Move up or Move down, an indent change) is synced as a delete plus an insert. If another author is typing in that block at
  the same moment, their concurrent edits in it are lost. Edits made after the move are not affected.
* Element-level selection (a selected table or figure) is not re-mapped after a remote structural change. Text carets are.
* The read-only sheet of a reviewer or a locked author is redrawn when the lock comes or goes, and the scroll position is kept.
* The outline faces come from awareness, at the section of each person's caret. The shell's TeamChip faces still come from page presence.
* Generate PDF and Quick preview call the host's `save()` first. While the book is live, that is `flush(true)`: the server writes the merged
  book before the build. A side effect is that every preview also asks for a revision, so auto-preview can add history entries. Whether the
  core's revision interval throttles these was not checked. A `flush(false)` path for previews would avoid them.

## 7. Checks run (2026-11-28) and checks owed

* `backend`: `npx tsc --noEmit -p .` is clean. `frontend`: `npx tsc --noEmit -p .` is clean, and `lint:theme` shows 0 literals.
* `node --test test/collab-jss.test.js` gives **8/8**. It covers:
  * registration;
  * the byte-identical round trip;
  * the minimal reconcile;
  * concurrent merges: one paragraph, a section, a list item, a table row, a caution;
  * write-back refusal;
  * external changes: PUT, restore, GitLab;
  * the reviewer and the check-out lock;
  * an anchored comment.
* `collab-rooms.test.js` and the guard tests (authz-matrix, wp29-audit-coverage, wp11-integrity, wp10-seams, routes-guarded), together
  with collab-jss, give **58/58**.
* `vitest src/jss` gives **92/92**.
* `e2e/collab-jss.spec.ts` (Edge, port 4362) gives **4/4**. It covers:
  * two authors typing in one paragraph at once, carets with names, outline faces, the file written, and per-person undo and redo;
  * a structural edit (a new list) merged with concurrent typing;
  * the reviewer's live read-only view, with a comment pinned to selected words and "Show" after more typing;
  * the check-out lock with check-in.
* Load (`node backend/scripts/bench/collab-load.js --port 4361`, one run on this machine). The JSS row ran in the same 20 s window as the
  S1000D row:

  | | clients | typists in one paragraph | keystrokes (observed) | latency p50 / p95 / max | converged | written back |
  |---|---|---|---|---|---|---|
  | S1000D | 120 over 40 modules | 15 | 2732 (2732) | 6 / 19 / 78 ms | yes | yes |
  | JSS | 15 over 4 books | 5 | 912 (912) | 8 / 25 / 79 ms | yes | yes |

  The server used 27.3 % of one core, with an RSS of 162 MB and a heap of 47 MB. 44 rooms were loaded.

**Owed:**

* The full backend, vitest, e2e and visual suites, and `npm run gate`.
* Updating the specs listed in section 5.
* `check:cleanup` and `npm run lint`.
* A load run on the reference machine.
