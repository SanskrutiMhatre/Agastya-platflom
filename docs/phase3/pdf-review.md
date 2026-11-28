# Phase 3 P3-4: PDF review

Reviewers comment on the generated PDF itself, or on any PDF stored in the project. They select words, or draw an area, and attach a
**comment**, a **suggestion** (with replacement text) or a **remark**. Threads have replies and a status (open, resolved, accepted or
rejected). They are drawn on the page and listed in a Comments panel. After a rebuild each thread follows its words. A thread that
cannot be placed is kept and flagged "Needs re-anchoring".

Branch `worktree-agent-a0dacfbd0b706f771`. Migration **028-pdf-annotations**. It was 027 until main took 027-default-accounts. The
collaboration branch may also claim 028 (its notes name `028-collab-documents`). If it does, renumber this one on merge: only the step
name, `migrations/index.js` and the pinned list in `test/wp10-seams.test.js` change.

## Model

PDF annotations are a separate model from the data-module review comments (`review_comments`, 009/019) and from the editors' live
comments (the collaboration work). Their names avoid both: tables `pdf_*`, the WebSocket message `pdf-annotations`, routes under
`/pdf-review`, components under `components/pdfreview`.

**Tables:**
* `pdf_annotations`: one thread root. It holds:
  * `file_key`: the PDF's path in the project
  * the kind, the status, and whether the thread is `required` before release
  * the body and the replacement text
  * the anchor
  * `file_hash`: the version the anchor was placed on
  * `anchor_state`: `placed`, `moved`, `unverified` or `orphaned`
  * `orig_*`: where the thread was first made
  * `source`: the traced data module or document section
* `pdf_annotation_replies`
* `pdf_review_versions`: every version (SHA-256) of a reviewed PDF the server has seen, so a thread can say "version 2 of 2"
* `pdf_review_settings`: per project, `block_release` (default off)

**Anchor**, in the shared module `backend/src/shared/pdfAnchor.ts` (the client and the server use the same code):
* the page
* rectangles in PDF user space, so they do not depend on the zoom
* a text quote: the exact words, plus 40 characters of prefix and suffix
* for an area: the rectangle, plus the quote of the text inside it and that text's box

**Re-anchoring.** The server re-anchors when a PDF version is first listed, so there is one authoritative placement and it is
testable. The search runs in this order:
1. an exact match in the old page ± 3 pages, scored by the context and by how close it is to the old place
2. an approximate match (Sellers, at most 25% edits; a long quote is matched by its head and tail) in the same pages
3. an exact match anywhere in the document

If nothing is found the thread becomes `orphaned`. It is never deleted: it keeps its last page and quote, and "Place again" lets a
reviewer re-select its place. An area without text is kept on its page as `unverified`. Page text is read with the pdf.js build the
importer already uses, cached per version.

**Version identity.** `GET file` streams the bytes with an `X-Pdf-Hash` header. The client makes anchors against the same bytes it
shows. A new thread on a stale version gets 409 `PDF_CHANGED`.

**Source link.** The quote is searched in the project's sources:
* S1000D: the folded text of each data module. The thread links to `editor?file=<DM>`.
* JSS/JSG: the module elements in outline order. The thread links to `editor?goto=<outline key>`.

FOP emits no per-block ids, so the text is the only link.

## Permissions (project role ladder)

| Who | Can |
|---|---|
| viewer | read, export |
| reviewer | create, reply, resolve or reopen |
| editor (Author) | the same, plus accept or reject suggestions |
| manager (PM), owner, admin | the same, plus edit or delete anyone's thread, plus the block-release setting |

* The writer of a thread may edit it.
* The writer may delete it until someone else has replied.
* Accept and reject apply only to suggestions (`NOT_A_SUGGESTION`).
* WP-27 capabilities apply:
  * `project.read` for reads
  * `pdfreview.comment` for writes
  * `pdfreview.settings` for the setting
* Every write is audited: `pdfreview.created`, `edited`, `deleted`, `replied`, `status`, `placed`, `settings`, `exported`.

## Routes (`/api/projects/:id/pdf-review`)

| Method and route | Minimum role and cap |
|---|---|
| `GET files`, `file?key=`, `annotations?key=`, `summary`, `export?format=csv\|xfdf&key=` | viewer, `project.read` |
| `POST annotations` | reviewer, `pdfreview.comment` |
| `PUT annotations/:aid`, `DELETE annotations/:aid` | reviewer, `pdfreview.comment` |
| `POST annotations/:aid/replies`, `/status`, `/place` | reviewer, `pdfreview.comment` |
| `PUT settings` | manager, `pdfreview.settings` |

* Release: `GET release` includes `pdfReview` (open, openRequired, total, blockRelease).
* When the setting is on, `POST release` and the approval refuse with 409 `PDF_REVIEW_OPEN` while required threads are open.
* Exports:
  * CSV: one row per thread and one per reply
  * XFDF: highlight annotations with QuadPoints, a square for an area, replies `inreplyto`, status as a Review state reply. Acrobat
    can import it.
* Live updates: every change is broadcast as `{type:'pdf-annotations', fileKey, change, id, annotation}` on the project socket. There
  is no polling.

## UI

* `/projects/:id/review-pdf?key=&a=`: the full-page review. It has:
  * a file picker and the version
  * the selection popover (Comment / Suggest change / Remark)
  * the Area tool
  * a composer with the type, the text, the replacement and "Required before release"
  * CSV and XFDF export, and Reload
* The Comments panel:
  * counts
  * filters: status (open, closed, all), type, author, page, module, needs re-anchoring
  * search
  * Up and Down move through the list; click or Enter jumps to the place and marks the highlight
  * the thread detail: replies, the actions the role allows, "Open in editor" and "Place again"
* Review and release: a **PDF review** card with the open and required counts and the block-release switch (PM only). It embeds the
  view, links to the full page, and adds an "Open PDF comments" stat in the page head.
* The editor PDF panes (S1000D `PdfPane`, JSS/JSG `DocPdfPane`; not the canvases) show the threads read-only on the generated PDF,
  plus a "Review (n open)" link. A click on a highlight opens that thread. A Quick preview is a browser-held draft, so it gets only the
  link.
* `PdfJsViewer` gains additive, optional props: `pageOverlay`, `jumpTo`, `onDocument`, `onPagesMouseUp`, `pagesClass`. Existing
  callers are unchanged.
* Tokens: `pdf-annot-comment`, `-suggestion`, `-remark`, `-closed`, `-draft` and `-focus`. They are fixed tokens, translucent over the
  white paper (the paper stays white in both themes). They have coverage exemptions like `viewer-highlight`, because the text under
  them is canvas pixels. `lint:theme` reports 0 literals and 0 contrast failures.

## Files

* Backend:
  * new: `src/shared/pdfAnchor.ts`, `src/storage/migrations/028-pdf-annotations.js`, `src/repositories/pdfAnnotationRepository.ts`,
    `src/services/pdfReview/{index,files,pdfText,source}.ts`, `src/routes/pdfReview.ts`, `test/pdf-review.test.js`
  * changed: `src/app.ts`, `src/repositories/index.ts`, `src/services/broadcast.ts`, `src/routes/project-content.ts` (release counts
    and block), `src/storage/migrations/index.js`, `test/wp10-seams.test.js`, `test/wp11-integrity.test.js` (two PUT exemptions:
    annotation edit is optimistic on `updatedAt`; settings is a single flag), `test/fixtures/authz-policy.snapshot.json` (exactly the
    12 new routes)
* Frontend:
  * new: `src/api/pdfReview.ts`, `src/lib/pdfReview.ts`, `src/components/pdfreview/*`, `src/pages/project/PdfReviewPage.tsx`,
    `src/styles/pages/pdf-review.css`, `e2e/pdf-review.spec.ts`
  * changed: `App.tsx` (route), `api/index.ts` (type), `lib/progress.ts` (message type), `components/pdf/PdfJsViewer.tsx`,
    `pages/project/ReleasePage.tsx`, `pages/project/editor/PdfPane.tsx`, `editors/host/DocPdfPane.tsx`, `JssEditorPage.tsx`,
    `JsgEditorPage.tsx` (pass `projectId`), `styles/tokens/tokens.json` and `tokens.css`, `scripts/tokens/coverage-exempt.json`

No new dependencies. The server reuses the pdfjs-dist legacy build the importer already loads.

## Checks run (targeted, per the owner's testing policy)

* Both `tsc` runs are clean.
* Backend, all passing:
  * `pdf-review.test.js` 8/8: routes, permissions, re-anchoring (moved, fuzzy, orphaned, unverified, place again), source trace,
    CSV/XFDF, release block, audit, WebSocket push
  * `authz-matrix`, `wp29-audit-coverage`, `wp11-integrity`, `wp10-seams`
* `routes-guarded` fails, but only on main's new public route `POST /api/auth/default-credentials/acknowledge` (P3-6). That route is
  not part of this work.
* `e2e/pdf-review.spec.ts` (Edge, port 4322): 4/4.
  1. Select text, comment, the thread appears in the panel and on the page.
  2. Clicking a thread scrolls to it and marks it; the keyboard works.
  3. A reviewer cannot accept a suggestion; the Author replies and accepts; the reviewer sees it live.
  4. A new PDF version moves the threads, flags the one whose words are gone, and the Release card counts them.
* `lint:theme` clean, `check:parity` PASS.
* `npm run lint`: the pdf-review CSS is clean. The two failing counts are main's, not this diff's: `any.backend` (+1) and
  `require.backend-ts` (+1). This branch's diff against main adds no `any` and no `require(`.

## Possible regressions and checks owed

* **PdfJsViewer:**
  * the overlay renders only when a caller passes `pageOverlay`
  * the pages box gets `onMouseUp` and an optional extra class
  * owed: the visual suite of the viewer, and `wp18-performance` (the overlay is per page and lazy)
* **Editor PDF panes:**
  * one extra `GET annotations` per pane mount, plus a socket listener
  * owed: `wp21-editor-chrome`, `jss-editor`, `jsg-editor`, and the S1000D Studio e2e
* **Release:** the extra check is a no-op unless the setting is on. Owed: `publish-gate` and the release tests.
* **Owed overall:** the full `npm run gate`, the visual/theme suite (new page and card in both themes), and the states test sheets
  list (the new CSS is not in `states.test.ts`).
* **Not done:**
  * annotations are not yet in the project archive Export/Import
  * re-anchoring is not audited (it is a system action on read; the new place is pushed over the socket)
  * an XFDF import (from Acrobat) is not built
  * the selection maps only rectangles inside the page where the selection started (a selection across a page break is cut at the
    page edge)
