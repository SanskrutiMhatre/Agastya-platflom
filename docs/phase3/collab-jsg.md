# Phase 3 (P3-1): JSG live co-editing

The JSG editors (User Handbook `frontend/src/jsg/editor.ts`, Illustrated Spare Parts List `frontend/src/jsg/ispl-editor.ts`) are bound to the
collaboration core as `docs/phase3/COLLAB-CONTRACT.md` requires, the same way as the S1000D Studio and JSS. A JSG document opens live by default.
When the room cannot be joined (`AGASTYA_COLLAB=0`, an old server, a time-out), the page edits and saves by version as before.

## What works

* **Room** `<projectId>/jsg/document`, kind `jsg`, write role `editor`, capability `dm.write` (the capability PUT /jsg needs), `leasePart ''`
  (any check-out of the document locks the room).
* **Concurrent typing in one block merges** character by character: paragraphs, text parts, notes, ISPL view notes, appendix table cells.
* **Structural edits merge deterministically.** These are chapters, sections, appendices, tables, rows, lists, figures, notices, and for the
  ISPL plates, views and parts rows. A paragraph someone types in keeps its Y identity when another person adds or removes blocks around it.
* **ISPL parts rows merge per cell.** The fields of `<part>` are XML attributes. Two people editing two cells of one row both keep their
  change. Two people editing the *same* cell: the last writer wins for that cell (see Limits).
* **Remote carets and selections** with names and colours: an overlay over the sheet. Rich text uses Yjs relative positions. A form field
  uses the element's position plus the attribute name and offset.
* **Presence in the outline**: faces (`data-testid="jsg-row-people"`) on the chapter, section, plate or appendix row each person is in.
* **Per-user undo/redo** (`Y.UndoManager`, only this person's changes). The handbook's Undo/Redo buttons and Ctrl+Z/Y delegate to it. The
  ISPL editor had no undo; in live mode Ctrl+Z/Y in it are the room's per-person undo.
* **Continuous saving**, with the host's save-state words: "Saved", "Syncing…", "Offline - changes kept locally". Save (Ctrl+S, the button,
  and Generate/Preview/Convert/Export, which save first) asks the room to write the file now and record a revision (`flush(true)`).
* **Unsent changes stay in IndexedDB** (LiveRoom pending store). A live document keeps no local draft. A draft from an earlier visit that
  is recovered becomes this person's change in the room (`JsgLive.adopt`).
* **Reviewer live read-only view.** Readers, someone else's check-out and the review lock all open the editor read-only, with the lock
  banner `data-testid="collab-lock"`. The editor is rebuilt when writability changes. A change the server refuses is taken back from the room.
* **Comments anchored to live text.** The file is named `jsg/jsg-document.xml` (main's review rule `(jss|jsg)/<file>`). The anchor is the
  element path/tag/text plus `y.start`/`y.end` relative positions. The comments panel can show a comment's words after others have edited.
* **Optional check-out lock**: TeamChip says "Locked by"; the other author is read-only and still sees the holder's changes.
* **External changes merge without clobbering live edits.** These are a PUT /jsg from another client, Word import, conversion, restore
  and GitLab pull. Every content write is noticed by the core's write listener and the sweep. `jsgReconcile` merges the file into the
  room 3-way (core `external change`), changing only what differs.
* **Properties panel, Quick preview, Check and Generate** work on the live state. The editor model is the merged document, and
  Save/Generate flush first so the server builds the merged file.

## Design

* **Shared model and serializer.** `frontend/src/jsg/model.ts` and `xml.ts` moved to `backend/src/shared/jsg/`; the frontend files
  re-export them, so every import path is unchanged.
  * `parseJsg(xml)` stays in the frontend (it uses DOMParser). The shared reader is `readJsg(element)`, which works on any DOM, including
    xmldom on the server.
  * `readJsgWith(root, onOrigin)` reports which element each model object came from (used for caret and comment mapping).
  * The serializer is unchanged.
  * As a result, the server's write-back is the editor's own `serializeJsg`, byte for byte, including empty attributes (GAP-005).
* **Y schema** (`backend/src/shared/collab/jsgForm.ts`): the canonical XML (`serializeJsg(readJsg(x))`) in ydom's form. Whitespace-only
  text in element-only containers is dropped; mixed content is kept. `JSG_DOC_PATH='document'`, `JSG_FILE='jsg-document.xml'`.
* **Keyed minimal reconcile** (`reconcileKeyed`), used both server-side (`jsgReconcile`) and in the browser. It works in five steps:
  1. Attributes are synced.
  2. The equal prefix and suffix are trimmed.
  3. An LCS of the middle is computed (bounded at 40k comparisons).
  4. Unmatched children of the same kind are paired and recursed into; text is diffed into a minimal insert/delete.
  5. The rest is deleted or inserted.

  Equality uses `isEqualNode` in the browser and a memoised fingerprint on the server.
* **Server format** (`backend/src/services/collab/jsg.ts`, registered from `backend/src/index.ts`): `resolve`, `toY`, `fromY`, `reconcile`
  and `writeBack`.
  * `writeBack` refuses what a save refuses: empty content, more than 50 MB, unsafe XML, a DOCTYPE, malformed XML, and a root type other
    than the project's.
  * Otherwise it writes through `saveRevisioned(..., 'collab', {selfWritten:true})` when a revision is asked for, or `content.writeText`
    otherwise. `syncIdentity` follows.
* **Browser binding** (`frontend/src/collab/jsg.ts`, lazy-loaded with the page's first live document).
  * **Local → Y.** On every editor change (`touch`/`afterEdit`/`redraw` → `JsgCollab.changed(typing)`), the binding serializes the model,
    parses it, normalizes it and reconciles it into Y against the shadow (a DOM copy of Y, child for child), with origin `ORIGIN_LOCAL`.
    Non-typing commands close the undo capture.
  * **Y → local.** For a remote change (or this person's undo), the binding rebuilds the shadow, reads it into a model and lays it onto
    the editor's model in place (`patchObj`/`patchArr`: unchanged objects keep their identity).
    * If only leaf values changed and each has a drawn field (a "slot"), those fields are redrawn in place with the caret moved through
      the text change.
    * Otherwise the sheet is redrawn, and focus and caret return to the same field.
* **Editor hooks** (additive; the editing logic is unchanged, D16):
  * `JsgLiveSurface`/`JsgSlot`/`JsgCollab` in `jsg/shared.ts`;
  * slots registered where fields are drawn (`richEl`, `titleEl`, the ISPL inputs and rich fields);
  * `setCollab`, `liveSlots`, `liveRedraw`, `afterRemote`, `liveParts`.
  * While live, `touch` reports to the binding instead of marking dirty, `isDirty` is "unacknowledged by the server", and the handbook's
    own checkpoint history is off.
* **Page** (`JsgEditorPage.tsx`):
  * joins after load and builds the editor from the room's model (the room may be ahead of the file);
  * uses main's shared host API (`host.liveRef = {flush}`, `host.setLive`, `live`/`pinning`/`commentsFile` on DocEditorShell);
  * shows the lock banner, skips the one-minute autosave while live (the checkbox stays, disabled), and keeps Save enabled.

## Shared core and host changes (for reconciling with JSS)

* **Collab core** (`frontend/src/collab/{client,binding,cursors}.ts`, `backend/src/services/collab/*` other than the new `jsg.ts`,
  `backend/src/shared/collab/{protocol,ydom,xmlForm}.ts`): **no changes.**
  * New files only: `backend/src/shared/collab/jsgForm.ts` (the JSG Y form and `reconcileKeyed`; it could serve JSS too) and
    `backend/src/services/collab/jsg.ts`.
* **Host:** after `git merge main` the JSG page uses main's JSS-era API unchanged. My parallel version of the same hooks was dropped in the
  merge (commit 47f43f7).
* **review.ts:** main's `(jss|jsg)/<file>` rule is kept. My narrower `jsg-document.xml` rule was dropped.
* **No migration.** The next free number is still the one after 030.

## Moves (the lead's question)

Yjs 13.6 has no move operation on `XmlFragment`/`XmlElement` children, so a moved block (UHB Arrange up/down, ISPL plate or row order)
reaches Y as a delete plus an insert, the same as in JSS.
* What `reconcileKeyed` gives: its LCS keeps the longest unchanged run. Swapping two neighbours therefore re-inserts only one of them, and
  every other block keeps its identity.
* Which of the two blocks keeps its identity is decided by the LCS, not by who is typing where. Concurrent typing inside the re-inserted
  block during the move is lost; typing in any other block is kept.
* Removing this gap would need a move-aware schema, for example a `Y.Array` of block ids with content in a `Y.Map` keyed by id, or the
  fractional-index ordering attribute pattern. That is a contract-level change for S1000D, JSS and JSG together, not done here.
* A cheaper mitigation, also not done: in `reconcileKeyed`, when a gap pairs a deleted and an inserted element with equal fingerprints,
  prefer to keep the one that holds a remote caret.

## Limits

* **Same ISPL cell, or the same title, edited by two people at once: last writer wins** for that cell. This applies to part fields, plate
  ref/title/caption, view caption, graphic label, and chapter/section/table/figure titles, all of which are attributes. The model holds
  them as strings, so character merging would need them as Y text, which means changing the JSG XML form. Different cells of one row merge.
* **ISPL appendix cells** (`<cell><text>`) show as plain inputs: they merge by character in Y, but the remote caret is not drawn inside them.
* **Moved blocks**: see above.
* **Ancillary pages** (cover, certificate, preface…) are edited elsewhere and still save by version. They are part of the same file, so
  their save reaches the room as an external change and merges.
* **Undo history is lost** when the editor is rebuilt because the person's writability changed (a check-out taken or freed, the review lock).
* **Find/replace "Replace all"** in the handbook is one change; a remote change during it is merged at the model level afterwards.

## Tests (run)

* `backend/test/collab-jsg.test.js`, 8/8. It covers:
  * kind registration;
  * byte-identical round trips (samples, plus empty attributes);
  * minimal reconcile (no-op on the same text, unwritten edits kept);
  * concurrent merges: paragraph, section add with block delete, cells of one ISPL row, row add/delete, same-cell LWW;
  * socket: two editors in a paragraph, reviewer READ_ONLY, flush and history 'collab';
  * socket ISPL row cells;
  * write-back refusal (WRITE_BACK_REFUSED, file unchanged);
  * external change via PUT /jsg;
  * check-out lock (whole document and part).
* `frontend/e2e/collab-jsg.spec.ts`, 4/4 (Edge, port 4372/4373, temp workspace). It covers:
  * two authors in one handbook paragraph (merged on both pages, named caret, outline face, Save writes the file, per-person undo/redo);
  * an ISPL row edited in two cells by two people;
  * the reviewer live view plus a comment on selected words;
  * the check-out lock.
* `collab-rooms` and the guard tests (authz-matrix, wp29-audit-coverage, wp11-integrity, wp10-seams, routes-guarded): 58/58 with
  collab-jsg, after the merge.
* Both `tsc`, `lint:theme` (0 literals, 0 contrast failures), `check:parity` PASS, and the JSG vitest suite 33/33.
* `npm run lint`: only the known leftovers (`liveRoom`, `serializeDoctype`, `lib0`, any.backend +1), plus `src/jss/live.ts::JSS_COMMENT_FILE`
  from the JSS merge (not mine).
* `backend/scripts/bench/collab-load.js` (now with `--jsg 4 --jsg-clients 3 --jsg-typists 5`), one run on port 4371:
  * S1000D: 120 clients, p50 8 / p95 25 / max 77 ms;
  * JSS: p50 9 / p95 28 / max 69 ms;
  * **JSG: 4 documents (2 handbooks, 2 parts lists), 15 clients, 5 typists in one paragraph, 910 keystrokes, p50 9 / p95 29 / max 70 ms,
    converged, written back**;
  * server: CPU 28.7 % of one core, RSS 171 MB.

## Possible regressions and checks owed

* `frontend/e2e/wp05-dataloss.spec.ts`, case "FE-006: the JSG editor keeps a draft too". A live JSG document keeps no local draft (its
  unsent changes are in IndexedDB), so `draft-found` will not appear after a reload with collaboration on. This is the same consequence
  the JSS record notes for its draft case. The test needs updating for the intended change (or running with `AGASTYA_COLLAB=0`). Not run
  here (no broad suites).
* JSG e2e specs not run here (`jsg-*.spec.ts`, `doc-pages.spec.ts`, `wp05`, the visual suite). They now open live by default:
  * the save state reads "Saved"/"Syncing…" instead of "Unsaved changes";
  * Save is enabled when clean;
  * the auto-save checkbox is disabled while live.
* `npm run gate` was not run (owner policy for this task).
