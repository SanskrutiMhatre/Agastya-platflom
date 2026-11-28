# Live co-editing: the binding contract (Phase 3, P3-1)

This is what a format (S1000D data module, JSS book, JSG handbook, or a future one) must provide to be edited live. Everything else
(rooms, sign-in and authorisation, the check-out lock, review and release locks, persistence, crash replay, external changes, limits,
audit, presence, acknowledgements) belongs to the collaboration core and is the same for every format. The S1000D Studio is the first and,
in P3-1, the only bound format. JSS and JSG are **not** bound. A backend test registers a stand-in format for them to prove the contract
(`backend/test/collab-rooms.test.js`, "the binding contract ...").

Design record and reasons: `docs/phase3/collaboration.md`.

## 1. Names and the wire

* One room per document: `<projectId>/<kind>/<docPath>`, where `kind` is `dm` | `jss` | `jsg` (`ROOM_KINDS` in
  `backend/src/shared/collab/protocol.ts`).
  * `docPath` is the format's own name for the document: the DMC file name for `dm`, and for example `book` or a chapter key for the others.
  * `parseRoom()` refuses `..`, empty segments, backslashes and unknown kinds.
* The frames are binary, on the platform's one authenticated `/ws` socket. The JSON text messages keep their 4 KB limit.
* The frame layout is defined once, in `shared/collab/protocol.ts`, and the server and the browser import the same file:
  * the client sends JOIN, LEAVE, UPDATE, AWARENESS and FLUSH;
  * the server sends STATE, SYNC2, SYNC1, REMOTE, ACK, AWARE, ERROR and FLUSHED.
* A new format adds **no** new message types.

## 2. Server side: `CollabFormat` (`backend/src/services/collab/formats.ts`)

```ts
register({
  kind: 'jss',                                   // the room kind
  writeRole: 'editor', writeCap: 'jss.write',    // project role + capability a writer needs (readers: viewer + project.read)
  resolve(projectId, docPath): string,           // project-relative posix path of the file; throw {status:404, code:'NOT_FOUND'} if absent
  toY(text, ydoc, origin): void,                 // fill an empty Y.Doc from the file
  fromY(ydoc): string,                           // the file's text for a Y.Doc (deterministic: same Y state -> same bytes)
  reconcile(ydoc, text, origin): void,           // bring a Y.Doc to changed file text with the fewest Y operations
  writeBack(projectId, rel, text, actor, revision): Promise<void>,   // validate + write; revision=true -> saveRevisioned(...)
  readOnly?(projectId, rel, docPath, user, projectRole): {code, reason} | null,   // format-specific locks (LOCKED, LINKED, ...)
  leasePart?: '',                                // which check-out covers the room ('' = whole document)
});
```

The format must meet these rules:

1. **Deterministic text.**
   * `fromY(toY(x))` is stable: the second round trip changes nothing.
   * The S1000D form passes this on every sample module (test "the server form is stable").
   * A format whose canvas re-serialises differently from its file must use the canvas's serialiser on the server. The S1000D Studio's
     serialiser was moved to `backend/src/shared/collab/xmlForm.ts` for this reason.
2. **Minimal reconcile.**
   * `reconcile` is used for external changes: a save by version, an import, a GitLab pull, or a file edited on disk.
   * It must change only what differs, so the people in the room keep their unwritten edits.
   * The core runs it on a copy of the last written state and applies only the difference. This is a three-way merge.
3. **`writeBack` refuses what a normal save would refuse,** with the same checks and limits as the format's HTTP save (for example size
   and identity uniqueness for data modules). A refusal keeps the room's content, and members get `WRITE_BACK_REFUSED`.
   * Write with `content.writeText` (atomic). When `revision` is set, write with `saveRevisioned(..., 'collab', { selfWritten: true })`.
   * `selfWritten` keeps the room's own writes from being recorded as "changed on disk".
4. **The Y schema** is the format's choice.
   * XML formats can reuse `services/collab/xml.ts`: an `XmlFragment('xml')` holding the elements, text in `XmlText`, attributes as Y
     attributes, and the doctype and XML declaration in `Map('meta')`.
   * The browser binding must use the same schema (`backend/src/shared/collab/ydom.ts` is shared).
   * **Schema 2 (Phase 8): blocks and placements.** A movable element is a block in `Map('blocks')` (id -> `Y.XmlElement`); the tree holds
     a placeholder `#ref {id, tok}`, and `Map('place')` maps the id to the token of the live placeholder. A move writes a new placeholder
     and sets `place`; the content element is never re-created, so concurrent typing in a moved block is kept (concurrent moves: last
     writer wins on `place`; undo of a move restores the token). Read the tree only through `ychildren` / `liveKids` / `treeParent` /
     `rawIndex` / `liveIndex` / `liveAt`, observe it with `observeTree`, and give undo `undoScope(ydoc)`. Schema-1 rooms read unchanged and
     become blocks lazily on the first move (no epoch change, no migration); a browser bundle from before schema 2 must be reloaded after
     the deploy. Record: `docs/phase3/cleanup-collab.md`.
5. **No import cycles.** The core reaches broadcast, release and content through hooks, which are checked by ARC-006.
   * A format module may import its own services.
   * Nothing the core imports at load time may import `services/collab/*`.

What the core does for every format, so a format must **not** do it itself:

* **Sign-in and access.**
  * The session is checked on connect.
  * The Origin is checked as in WP-26.
  * The session is re-checked when the socket re-checks.
  * A per-message authorisation cache is refreshed every 10 s, and at once when a check-out or release request changes or the socket re-checks the session.
* **Refusals.** An update from a reader is refused with READ_ONLY, and so is an update to a document that someone else has checked out
  (CHECKED_OUT) or that is in a pending release (IN_REVIEW). A refused update is never applied or logged.
* **Persistence.**
  * Each update goes into SQLite in batches (`collab_updates`, migration `030-collab-documents`).
  * ACK is sent only after the batch is committed.
  * The log is compacted into a snapshot (`collab_docs.state`).
  * The file is written back after 2 s of quiet, or at most every 10 s.
  * A revision is cut every 10 minutes, on FLUSH(revision), at unload and at server stop.
  * Replay at start recovers what a crash left unwritten.
* **External changes.**
  * The content-write hook covers any writer that goes through the content store.
  * The sweep compares file size and mtime every 3 s.
  * `services/externalChanges.onFilesChangedExternally` carries the GitLab pull and any announced writer.
  * Each of these becomes a minimal merge, attributed in the audit (`collab.external-change`).
  * A deleted file closes the room (GONE).
* **Limits.**
  * Updates are at most `AGASTYA_COLLAB_MAX_UPDATE_BYTES` (2 MiB); larger ones get TOO_LARGE.
  * The rate is at most 600 messages per 10 s. Three times that closes the socket with code 1008.
  * JSON frames are at most 4 KB (code 1009).
  * Rooms are loaded on first join and unloaded after 60 s idle, with at most `AGASTYA_COLLAB_MAX_ROOMS` in memory.
* **Audit.**
  * The write-back with a revision is logged as `collab.revision`.
  * External merges are logged as `collab.external-change`.
  * Check-out and check-in keep their existing lease audit entries (WP-29).

## 3. Browser side

| Piece | File | What a binding uses |
|---|---|---|
| Socket | `frontend/src/lib/progress.ts` | `sendBinary`, `subscribeBinary`, `socketBuffered`, `socketOpen` (already used by `LiveRoom`) |
| Room | `frontend/src/collab/client.ts` `LiveRoom` | `new LiveRoom(roomName(pid, kind, docPath), userId, events)`, `open()`, `doc` (Y.Doc), `awareness`, `status` (`saved` / `syncing` / `offline`), `unacknowledged`, `flush(revision)`, `setPresence(state)`, `close(keep)`. Local changes are Y transactions with origin `ORIGIN_LOCAL`, and the room sends them itself, coalesced over 50 ms, holding while the socket buffer is over 1 MB |
| Offline keep | `frontend/src/collab/pending.ts` | Done by `LiveRoom`: unacknowledged updates are kept in IndexedDB (`kv`, key `collab-pending:<user>:<room>`) and re-sent at the next join of the same epoch |
| Canvas binding | the format's own (S1000D: `frontend/src/collab/binding.ts` `DomBinding`) | The format's own code (see below) |
| Presence | `frontend/src/collab/cursors.ts` | `colorFor(userId)` (theme tokens only), and `CursorLayer` when the canvas is DOM-based and can map a Y relative position to a DOM range |

A canvas binding must do the following:

1. **Pull the room's content into the canvas at `synced`.** When `reset` is set, rebuild from it: the room was rebuilt and pending updates
   from another epoch were dropped.
2. **Local edits become Y edits.**
   * Apply them in one `doc.transact(fn, ORIGIN_LOCAL)` per user command, from the canvas's own change records. The S1000D Studio uses
     MutationObserver records on its own document model.
   * Do not re-serialise the whole document.
   * The canvas's editing logic stays as it is (D16).
3. **Remote edits become minimal canvas edits.**
   * Observe the Y tree (`observeDeep`) and ignore `ORIGIN_LOCAL`.
   * Change only the affected nodes.
   * Keep the caret: translate it through Y relative positions, or adjust it by the text delta.
4. **Undo and redo use a `Y.UndoManager` with `trackedOrigins = {ORIGIN_LOCAL}`,** so a person undoes only their own changes. The canvas's
   own undo stack is not used while live (`EditorDocument.setCollab`).
5. **Read-only.**
   * On `state.writable === false`, show `state.reason` (for example "Locked by …" or "You are reviewing …") and stop local edits.
   * On a READ_ONLY error, take back the refused local change from the room's state. The server already refused it, so it cannot have
     spread.
6. **Dirty means `room.unacknowledged > 0`.** The page warns on leave only then. Drafts and edit-by-version (`baseHash`, EDIT_CONFLICT) are
   not used for a live document.
7. **Validation runs on the canvas's current text,** which is the merged state, on its usual debounce. It never blocks typing.
8. **Comments** are anchored with `Y.createRelativePositionFromTypeIndex` on the text type and sent as `anchor.y = { start, end }`
   (base64, at most 400 characters each) beside the existing `anchor.path/tag/text`. To show one, resolve it with
   `createAbsolutePositionFromRelativePosition`.

## 4. Turning it off

`AGASTYA_COLLAB=0` turns live co-editing off for the whole site: a JOIN is answered DISABLED, and every editor then saves by version as before. A page whose join fails
(the server is off, a non-member, or a parse problem) falls back to the classic flow for that document.
