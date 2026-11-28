# Phase 3, P3-1 / P3-2: real-time collaborative editing

Status 2026-11-28: built on branch `worktree-agent-a9419f2ee204a6a7b`, and the targeted tests are green (section 7). It is the
**default** for S1000D data modules. JSS and JSG still save by version; their binding is the contract in `docs/phase3/COLLAB-CONTRACT.md`.

What changes for the user:

* Several authors edit one data module at once.
* Reviewers and viewers see every change as it is typed and can comment.
* Nothing needs saving. The status reads "Saved", "Syncing…" or "Offline - changes kept locally".
* Check-out is now an *optional* exclusive lock: "Locked by X". Others still read and comment, and see the holder's changes live. The lock
  expires after inactivity, an admin or PM can release it, and submitting for release locks the documents automatically.

## 1. Architecture

```
 browser (each person)                                         server (one process)
 ─────────────────────                                         ───────────────────────────────────────────────
 Studio canvas (EditorDocument, D16 logic unchanged)
   │ MutationObserver records          ▲ applyRemote (minimal DOM)
   ▼                                   │
 DomBinding  (collab/binding.ts) ── Y.Doc ── Y.UndoManager (own origin only)
   │ ORIGIN_LOCAL txns                 ▲ REMOTE / SYNC2
   ▼                                   │
 LiveRoom (collab/client.ts)  50 ms coalescing, backpressure,      /ws (existing socket, WP-26 auth + Origin + re-check)
   pending updates -> IndexedDB until ACK  ═══ binary frames ═══▶  broadcast.ts ─(hooks)─▶ collab/rooms.ts
 CursorLayer (collab/cursors.ts) ◀─ awareness                         │ per-message authorisation (role, check-out,
 TeamChip / explorer faces ◀─ presence                                │ release lock, format readOnly), rate + size limits
                                                                      ▼
                                                    Room: Y.Doc + Awareness, one per document, loaded on first join
                                                      │ batched persist (100 ms) -> SQLite collab_updates -> ACK
                                                      │ compaction -> collab_docs.state (snapshot)
                                                      │ write-back: debounced 2 s / max 10 s -> format.writeBack
                                                      │   (atomic write; revision every 10 min, on Save, unload, stop)
                                                      │ external file change -> 3-way minimal merge (reconcile)
                                                      ▼
                                                    project file (the same bytes a Studio save writes)
```

* **Core (all formats):**
  * `backend/src/services/collab/rooms.ts` (rooms, access, persistence, write-back, external changes, limits, metrics);
  * `formats.ts` (the `CollabFormat` registry);
  * `xml.ts` (the XML ⇄ Y form, reconcile);
  * `backend/src/shared/collab/{protocol,ydom,xmlForm}.ts` (shared with the browser);
  * `backend/src/repositories/collabRepository.ts`;
  * migration `030-collab-documents`.
* **S1000D binding:**
  * `frontend/src/collab/{client,binding,cursors,studio,pending}.ts`;
  * the glue in `frontend/src/lib/studioSession.ts`, `frontend/src/studio/core/document.ts` and `frontend/src/studio/ui/editor.ts`.

## 2. Decisions and reasons

| # | Decision | Reason |
|---|---|---|
| C1 | Yjs 13.6.27 + y-protocols 1.0.6 (+ lib0 0.2.114), exact pins, copied into `node_modules` (no network) | The brief named them. They are pure JS, MIT, have no service or CDN, and the server can run the same CRDT |
| C2 | Binary frames on the **existing** `/ws` socket, with our own framing (`shared/collab/protocol.ts`) and not y-websocket | One socket keeps one auth path (WP-26 session, Origin, re-check), one connection count and one limit. Our framing lets the server authorise every message, ACK what it stored and say why it refused something, which y-websocket's sync step 2 cannot |
| C3 | One room per document: `<projectId>/<kind>/<docPath>` | The brief requires it. It bounds memory and the authorisation scope, and maps 1:1 to the file and its lock |
| C4 | The server holds the authoritative Y.Doc and checks access **per message**, refusing (not applying) reader updates, updates to a document checked out by someone else, and updates to a document in a pending release | A client cannot be trusted to hold itself read-only. A refused update never reaches the log or the other members |
| C5 | Y schema: `XmlFragment('xml')` mirroring the DOM 1:1, text in `XmlText`, attributes as Y attributes, doctype and XML declaration in `Map('meta')` | Concurrent typing in one paragraph merges character by character. Structural edits (insert, remove, move of elements) merge deterministically. The Studio's DOM maps node for node, so remote changes re-render only the changed nodes |
| C6 | The server serialises with **the Studio's own serialiser** (moved to `shared/collab/xmlForm.ts`) | A live write-back is byte-identical to a Studio save. No diff noise appears in revisions, and the PDF and validation pipelines see the same file |
| C7 | Persist first, then ACK; batches every 100 ms in one SQLite transaction | "No edit is ever lost": an ACKed update survives a crash. Batching avoids an fsync per keystroke. WAL with one commit per batch means there is no fsync storm with 100+ users |
| C8 | Write-back is debounced (2 s quiet, 10 s max) through the format's `writeBack` (atomic write, same checks as a save). A **revision** is cut every 10 min, on Save/FLUSH, at unload and at stop | The file stays current for PDF, validation, export and git without one revision per keystroke burst. The history stays useful |
| C9 | `saveRevisioned(..., { selfWritten: true })` | The room's own writes must not show as "changed on disk" revisions or echo back as external changes |
| C10 | External changes (a save by version, an import, a file on disk, a GitLab pull) become a **three-way merge**: reconcile a copy of the last-written state to the new file, then apply only that difference | People in the room keep their unwritten edits. A reload would drop them, and a blind overwrite would clobber the file |
| C11 | Three sources of external change: the content-write hook, a 3 s size+mtime sweep, and `services/externalChanges.onFilesChangedExternally` (GitLab), which adds the source and actor to the audit and an `EXTERNAL_CHANGE` notice to the members. An announced deletion closes the room | The hook covers in-process writers, the sweep covers files changed outside the process, and the event covers writers that know who acted |
| C12 | Crash safety: the log is the source until written back. At start, `replayPending()` writes every room whose log is ahead of its file | A stop or crash between ACK and write-back loses nothing |
| C13 | Epoch per room; a client's pending updates from another epoch are dropped at join (SYNC2 reset) | A room rebuilt from the file (log removed: a file replaced by non-XML, a deletion) cannot accept updates built on the old history, which would duplicate content |
| C14 | Limits: an update is at most 2 MiB (TOO_LARGE); at most 600 messages per 10 s, and more than three times that closes with 1008; JSON text frames stay at 4 KB (1009); `maxPayload = max(4 KB, maxUpdate + 4 KB)`; at most 2000 rooms; idle unload after 60 s | A misbehaving or hostile page cannot exhaust the server. The JSON surface keeps its WP-26 limit |
| C15 | Backpressure: the client holds sending while `bufferedAmount` is over 1 MB and coalesces over 50 ms. The server queues remote updates per member and merges them (`Y.mergeUpdates`) while that member's socket buffer is over 1 MB; a member more than 8 MB behind is closed and re-syncs from its state vector at reconnect | Slow clients do not grow server memory without bound |
| C16 | Per-user undo/redo: `Y.UndoManager`, `trackedOrigins = {ORIGIN_LOCAL}`, typing merged into one step, other commands one step each | "Undo is per user": Ann's Ctrl+Z never takes back Ben's words |
| C17 | Unacknowledged updates go to IndexedDB (`kv` store, `collab-pending:<user>:<room>`) until ACK; leaving the page warns only while some are unacknowledged | Offline or a crashed tab keeps the work. There is no needless "unsaved changes" prompt when everything is stored |
| C18 | Check-out stays as the optional exclusive lock (the existing leases: expiry after inactivity, release by an admin or PM, WP-29 audit), now enforced per message and pushed live (`leases` broadcast, then `refreshDocument`). A release request locks the documents it covers (IN_REVIEW) via `release.ts` listeners | The brief requires it. It reuses the audited lease model instead of a second lock |
| C19 | Cycle-free wiring: `broadcast.setCollabHooks`, `contentStore.onContentWrite`, `release.onReleaseChange`, `externalChanges.onFilesChangedExternally` | ARC-006 forbids runtime import cycles (lazy requires included). The core subscribes, and nothing the core imports at load time imports the core |
| C20 | Comments: `anchor.y = {start, end}` (base64 Y relative positions, at most 400 characters) beside the existing `path/tag/text`; `{type:'comments'}` broadcast after add or resolve | The anchor follows the words through everyone's edits. It is an additive extension of the comments model (no migration needed: the anchor is JSON). Panels refresh without a reload |
| C21 | Presence: name, colour (a theme token chosen from the user id) and cursor (Y relative positions) in awareness. Carets and selections are drawn on the canvas, faces appear in the explorer rows, and TeamChip reads "Locked by" | The brief requires it. Colours stay on tokens (lint:theme) |
| C22 | The collab client is lazy-loaded with the first live document | It keeps the EditorPage chunk within its budget (883 KB, which was 990 KB eagerly) |
| C23 | Validation runs on the canvas's merged text on its usual debounce; it never blocks typing | The brief requires it. The Studio's checks are unchanged |
| C24 | Fallback: a failed join (server off, `AGASTYA_COLLAB=0`, a non-member, a parse failure) opens the document in the classic edit-by-version flow | Nobody is locked out of a document by the new path |

## 3. Files changed

**Backend.**

* New:
  * `src/services/collab/{rooms,formats,xml}.ts`;
  * `src/shared/collab/{protocol,ydom,xmlForm}.ts`;
  * `src/repositories/collabRepository.ts`;
  * `src/storage/migrations/030-collab-documents.js`;
  * `test/helpers-collab.js`, `test/collab-rooms.test.js`, `scripts/bench/collab-load.js`.
* Changed:
  * `src/services/broadcast.ts`: binary routing, hooks, the 4 KB text limit kept, maxPayload, and the `comments` message.
  * `src/services/release.ts`: change listeners.
  * `src/services/review.ts`: `anchor.y`.
  * `src/routes/project-content.ts`: the comments broadcast.
  * `src/services/projectFiles.ts`: `selfWritten`.
  * `src/storage/contentStore.ts`: the `onContentWrite` hook.
  * `src/core/auth/store.js`: the purge covers the collab rows.
  * `src/config.ts`: the `collab` block.
  * `src/index.ts`: start, stop and graceful shutdown.
  * `src/repositories/index.ts` and `src/storage/migrations/index.js`.
  * `test/wp10-seams.test.js`: the pinned migration list.

**Frontend.**

* New:
  * `src/collab/{client,binding,cursors,studio,pending}.ts`, `src/collab/binding.test.ts`;
  * `e2e/collab-s1000d.spec.ts`.
* Changed:
  * `src/lib/progress.ts`: binary frames.
  * `src/lib/studioSession.ts`: join live, fallback, flush on save, anchors.
  * `src/studio/core/document.ts`: `setCollab`, `applyRemote`, delegated undo and dirty.
  * `src/studio/ui/editor.ts`: the lock banner `collab-lock`, `onDestroy`.
  * `src/studio/ui/app.ts`: no drafts for live documents.
  * `src/editors/host/{saveState.ts,TeamChip.tsx,EditorComments.tsx}`.
  * `src/pages/project/EditorPage.tsx`, `src/pages/project/editor/EditorSide.tsx`.
  * `src/api/index.ts`: `ReviewAnchor.y`.
  * CSS: `studio/styles/app.css`, `styles/pages/editor-host.css`.
  * `tsconfig.json` paths and the `vite.config.ts` dedupe, so the page has one Yjs instance.

**Docs.** This file, `COLLAB-CONTRACT.md`, `docs/BUNDLED-COMPONENTS.md` (the three packages).

**New test ids.**

* Added: `collab-lock`, `collab-cursors`, `dm-row-people`, `comment-new`/`comment-add` (and their `-inline` forms) and
  `editor-comment-show`.
* None removed.
* `lease-other` now reads "Locked by" while live; it is unchanged when not live.

## 4. Dependencies

The three packages are added to `backend/package.json` and `frontend/package.json` with exact versions. `isomorphic.js` comes in only as
lib0's own dependency. No other package was removed or upgraded.

## 5. Possible regressions (expected, by design; not run, per the testing policy)

These existing tests assume that every S1000D save goes by version. They will need updating for the live default, or a
`AGASTYA_COLLAB=0` run:

* `e2e/wp05-dataloss.spec.ts`: the S1000D draft and EDIT_CONFLICT cases. A live document makes no draft (the IndexedDB pending log replaces
  it) and has no edit conflict.
* `e2e/wp21-editor-chrome.spec.ts` compare-and-merge, and the `e2e/00-platform.spec.ts` Studio save flows.
  * Save is now FLUSH; the "Saved" toast still comes.
  * An XML-view edit is merged through the canvas: CodeMirror → document → binding.
* `TeamChip`: "Checked out by" becomes "Locked by" **only** while live; the unit test (not live) is unchanged and passes.
* Visual baselines of the editor: the lock banner, faces in explorer rows, and the comment composer. They show only while live, when
  others are present, or with comment rights.
* Anything that counts PUTs to `/dms/` during editing: a live document writes through the room, not PUT.

## 6. Known gaps

* Element-level selection (a selected figure or table) is not re-mapped on a remote structural change. Text carets are.
* Pending IndexedDB updates from another epoch are dropped at join. This happens only after the room was rebuilt from the file, which is
  rare, and the person is told by the reset.
* ACK covers the highest stored sequence number. A refused update is taken back on the client from the room's state; it is not re-sent.
* The external-change notice is sent when the room's merged base equals the announced hash. If the content-write hook already merged the
  same bytes, the audit entry for that merge says `system`, and the notice still goes.
* JSS and JSG are not bound (out of scope). The contract is proven with a stand-in format in `collab-rooms.test.js`.
* The explorer faces come from page presence (`useTeam`), which updates every few seconds, not from awareness.
* The installer was not rebuilt.

## 7. Checks run (targeted, as the brief asked) and checks owed

Run on 2026-11-28:

* `backend`: `npx tsc --noEmit -p .` clean.
* `node --test test/collab-rooms.test.js`: **14/14**. It covers:
  * merge; ACK; write-back form; history; audit;
  * reviewer read-only; spoofed presence refused; NOT_FOUND;
  * check-out lock live; external merge; GitLab-announced change and deletion; stop/replay;
  * limits 1008/1009/TOO_LARGE; comment anchor; release lock;
  * deterministic structure; stable round trip; the contract with a second format.
* Guard tests: `authz-matrix`, `wp29-audit-coverage`, `wp11-integrity`, `wp10-seams`, plus `ws-broadcast` and `wp28-team-server`: **46/46**.
* `gitlab.test.js`: **13/13**, run because its writer now has a listener.
* `frontend`: `npx tsc --noEmit -p .` is clean, and so is the spec. `lint:theme` shows 0 literals and 0 contrast failures. `check:parity`
  passes.
* `vitest`: `src/collab/binding.test.ts` 7/7 and `TeamChip.test.tsx` 4/4.
* `e2e/collab-s1000d.spec.ts` (Edge, port 4312): **3/3**. It covers:
  * two authors typing in one paragraph at once; carets with names; file written; per-user undo/redo;
  * the reviewer's live, read-only view; a comment pinned and seen live; "Show";
  * the check-out lock with check-in.
* Load: `node backend/scripts/bench/collab-load.js` (port 4311, a separate server process, this machine), one run:

  | clients | accounts | documents | typists in one paragraph | keystrokes | latency p50 / p95 / max | server CPU | server RSS / heap | converged |
  |---|---|---|---|---|---|---|---|---|
  | 120 | 16 | 40 (all loaded) | 15 at 10 chars/s each, 20 s | 2720 (all observed) | **7 / 21 / 36 ms** | **20.9 %** of one core | **164 / 67 MB** | yes, written back |

  Latency is measured from typist to server to observer, for the exact update.

**Owed, not run by this branch (policy: no broad suites):**

* The full backend suite, the full vitest run, the e2e suite, the visual suite and `npm run gate`.
* Updating the expected regressions in section 5.
* A load run on the reference machine.
* `check:cleanup` and `npm run lint`.
* Rebuilding the installer.
