# 16 - Addendum: post-audit gaps and the Phase 2 brief (UI/UX redesign and code cleanup)

**Status.** Audit addendum, written 2026-11-27. **Audit only:** nothing in this report is approved or started. The redesign and the cleanup described in the owner's "Phase 2" brief are **not implemented**; the owner said implementation starts after everything is audited and approved. The one thing that was changed in the application is the owner-requested scoped fix described in section 2, which is **not** an audit phase and does not approve one.

**Why it exists.** On 2026-11-27 the owner (a) asked for a list of known gaps to be fixed, the Codes button to be removed, and any gaps or improvement potential to be found and added to the audit, and (b) supplied the "Phase 2: Complete UI/UX Redesign & Code Cleanup" brief as an audit addition. This report does both: it records what changed since the audit was written (section 2), maps the brief to what the audit already says and to what is new (section 3), registers **18 new findings** (section 4), defines the feature-preservation baseline and checklist the brief demands (section 5), lists the cleanup candidates with their evidence and their false positives (section 6), sets the standard for "every little detail" (section 7), and says how the brief fits the roadmap, with the changes this needs (sections 8 to 10).

**Reading guide.** Finding IDs follow the register of `14`: priority P0 to P3, an evidence label (VERIFIED, OBSERVED, SUSPECTED, RECOMMENDATION, NOT VERIFIED), an effort band. New prefixes: **GAP** (gaps and improvement potential found by the scoped fix and the survey), **UID** (user-interface detail named in the brief), **CLN** (cleanup). Every new finding is assigned to a work package in `14` (regenerated; the register there is now 322 findings, section 11 here).

---

## 1. Scope of this addendum

| In scope | Out of scope |
|---|---|
| Recording the effect of the 2026-11-27 scoped fix on audit findings | Implementing the redesign or the cleanup |
| New gaps and improvement potential, with evidence | Changing any application file beyond the scoped fix of section 2 |
| Traceability of every requirement of the brief | Removing anything that the brief lists for cleanup (it needs approval and a regression baseline first) |
| The preservation baseline (read-only scripts, `baseline/`) and the checklist method | Calendar time (effort bands only, as in `14`) |
| Roadmap changes (three new work packages, five new owner decisions) | A visual design: the six mockups of `mockups/` remain the only designs; section 8 lists the screens still without one |

Method: read-only scripts over `frontend/src`, `frontend/e2e`, `backend/test` and the audit folder (`scratchpad` scripts, described in section 11); targeted reads of the files named in each finding; the repository's own test suites run once after the scoped fix. Every number below was produced by a script or a command run on 2026-11-27; where a script's raw output was wrong it is corrected in the text (the native-dialog count, the dependency candidates).

---

## 2. What changed since the audit (the scoped fix of 2026-11-27)

### 2.1 What was done

| Change | Where | Effect on the audit |
|---|---|---|
| JSS and JSG projects got their own **Explore** and **Publication** pages (hierarchy, table, picture views, search, detail panel; chapters and sections arranged by drag and drop or buttons, rename, add and delete a chapter, delete a section, undo, unsaved-changes bar, save, build); the S1000D pages are unchanged | `pages/project/DocPublicationPage.tsx`, `DocExplorePage.tsx`, `PublicationRoute.tsx`, `ExploreRoute.tsx`, `lib/docPublication.ts` (22 unit tests), `layouts/ProjectShell.tsx` | UX-001 and FE-009 (the JSS Publication "Internal error") are **resolved**; UX-013 (the same tree shown three ways) now also holds for JSS and JSG, with one shared identity model behind the three views |
| The **codes strip** and the **Codes button** were removed from the JSS and JSG editors; the code beside a heading stays as a badge, switched on from the Publication page | `components/DocCodes.tsx` (now exports only the section-code hook, the findings list and the two project buttons), `JssEditorPage.tsx`, `JsgEditorPage.tsx` | The audit's description of `DocCodes.tsx` as the identity UI (`01` D8, `02`) is out of date: that UI is now the two pages |
| The **PMC, ICN and contents switches** were removed (client and server); `show` is `{ dmc }` only and an old client that sends the other keys is accepted and ignored | `backend/src/services/xengine/identity.ts`, `routes/identity.ts`, `api/xengine.ts`, `test/xengine-identity.test.js` | One dead feature fewer (it is the kind of debris CLN-004 describes) |
| **Leave guard**: a page with unsaved work asks "Stay here / Leave without saving / Save and leave" when a rail tab, a link or the browser's Back button would leave it; the application moved from `BrowserRouter` to a data router so the router can hold a navigation back | `lib/leaveGuard.tsx`, `main.tsx`, wired in `DocPublicationPage`, S1000D `PublicationPage`, `JssEditorPage`, `JsgEditorPage` | FE-002 (unsaved work lost on any in-app navigation) is **partly mitigated**: four surfaces guarded, the rest in GAP-001 |
| **Deep link** from the pages to a section in the editors (`?goto=<module key>`) | `jss/editor.ts`, `jsg/editor.ts` (`goToModule`) | Two more places the editor host contract (WP-21) must absorb; GAP-004 |

### 2.2 Verification of the scoped fix

| Check | Result |
|---|---|
| `tsc --noEmit`, frontend and backend | 0 errors |
| Unit tests, `lib/docPublication.test.ts` | 22 of 22 (including 5 for deleting) |
| Frontend unit suite, `npm test` | 606 passed, 2 skipped, **1 failed**: the known five-second timeout of `jss/naval.test.ts` under load (the audit recorded four of this kind, README section 7); it passes alone, 18 of 18 |
| Backend identity tests | 11 of 11 |
| Browser tests of the surfaces that changed, in the full run | `doc-pages` 14 of 14, `jss-editor` 12 of 12, `jsg-editor` 11 of 11, `zz-responsive-layout` 18 of 18, `project-import-package` 9 of 9, `zz-import-refusal` 1 of 1 |
| Browser suite as a whole (133 tests, one worker), **Chrome stable** (the suite's default) | one clean full run: **70 passed, 5 failed, 58 did not run.** Not caused by the scoped fix; see below |
| The same suite on **Microsoft Edge** (`E2E_CHANNEL=msedge`), run as two sequential invocations because of the order dependency below | **132 passed, 1 failed.** `platform.spec.ts` 40 of 41 (1.2 minutes), the other ten spec files 92 of 92 (4.8 minutes), including `doc-pages` 14, `jss-editor` 12, `jsg-editor` 11, `zz-responsive-layout` 18, `zz-dmtypes` 11, `publish-gate` 3, `publish-waivers` 8, `s1000d-config` 5. The one failure is a stale assertion (below), not a regression |

**Why the whole browser suite does not finish with the default browser (GAP-007, and UX-011 reproduced).**

1. `platform.spec.ts` begins with "first run: set up the administrator" and expects a server with no administrator. Specs that sort before it (`doc-pages`, `jsg-editor`, `jss-editor` and others) create the administrator when it is missing, so in a full run that first test fails, and because the spec is serial, **its other 40 tests are skipped**. Run alone on a fresh server, `platform.spec.ts` passes its first seven tests.
2. Then the Chrome tab **crashes** ("Target crashed") whenever the S1000D Studio opens a data module: it ended `platform` at its eighth test (run alone), `publish-gate`, `publish-waivers`, `s1000d-config` and `zz-dmtypes` in the full run, and the same four specs failed at the same places in an earlier full run. This is finding **UX-011**, which the audit recorded as OBSERVED before the scoped fix; it is now reproduced in the clean full run (four specs) and in a run of `platform.spec.ts` alone (a fifth place); an earlier full run, which overlapped with another runner and was discarded, showed the same four. On **Edge** the crash does not occur (the audit had already noted that Edge is unaffected, `15` section D item 5): the whole Studio suite runs green. The practical consequence for Phase 2: **the browser regression baseline can be obtained on Edge today and cannot be obtained on Chrome stable**; the audit recommends Edge (the Mode A shell is WebView2, which is Edge's engine) as the reference browser (decision D18) and the Chrome crash as a separate defect to find.
3. **One stale assertion.** On Edge the only failing test is `platform.spec.ts:483`, "administrator: every V1 section is there": it still expects an "SNS defaults" link in the Administrator navigation (line 488), a screen the owner removed on 2026-11-26. It is not related to the scoped fix and was not changed here (it is the test-side of CLN-004: a removal that left something behind). With it excluded, the Edge run of `platform.spec.ts` is 40 of 40.
4. An overlapping second runner (a leftover from an earlier launch) shared port 4050 and the `test-results` folder with the clean run and produced `ENOENT` trace errors and cross-contaminated results; that run was discarded and the numbers above come from a single runner. The harness has no lock against this.

The audit's status stays **PARTIAL**; this addendum does not raise it.

---

## 3. The Phase 2 brief against the audit

The brief has five sections. The table says, for each requirement, where the audit already answers it, what is new in this addendum, and what is still open.

### 3.1 Traceability

| Brief requirement | Audit source (existing) | New in this addendum | Work package | Open |
|---|---|---|---|---|
| **1. Rethink the experience, not a reskin**: layouts, navigation, sidebars, toolbars, dashboards, workspaces | `06` sections 5 to 7 (screen gap analysis, navigation architecture, workspace and editor redesign), UX-002, UX-003, UX-006, UX-007, UX-014, UX-021; six mockups | Screens with no design yet (section 8.2) | WP-21, WP-22, WP-35 | Owner decision D20 (direction) |
| Reusable components and patterns | `07` (token and component proposal), DS-001 to DS-010 | The new Doc pages draw the same rows, save bar and detail panel as the S1000D pages (8.3, item 6) | WP-19 | none |
| Editors reimagined (canvas, toolbars, outline, properties, XML/Design/Split, validation feedback, tables, figures, pagination, navigation) | `06` section 7 (one workspace shell, three adapters; modes; validation feedback; search; preview; shortcuts; large documents; save state), UX-002, UX-003, UX-012, UX-017, UX-020, FE-021 | **Conflict:** the audit chose to unify the chrome and keep the three framework-free editors (`14` section 8); the brief asks to "completely rethink" every editor | WP-21 | **D16** |
| Detail: password show/hide | `06` section 10 lists 3.3.8 as NOT VERIFIED | **UID-001** | WP-35 | none |
| Detail: forms with validation and error feedback | UX-023 | **UID-002** | WP-19 | none |
| Detail: consistent alerts, confirmations, notifications | DS-005, FE-012, UX-015 | **GAP-002** | WP-35 | none |
| Detail: button and icon states | DS-002 | none | WP-19 | none |
| Detail: tooltips, dropdowns, context menus, dialogs | UX-004, DS-005, FE-014 (dialogs) | **UID-003, UID-004, UID-005** | WP-19, WP-35 | none |
| Detail: loading, empty and error states | UX-016, FE-016 | none | WP-19, WP-22 | none |
| Detail: tables, trees, search, toolbars consistent | UX-013, DS-003, DS-006 | **GAP-003** (the new pages lack add-section and add-appendix) | WP-22 | none |
| **Responsive**: no overlap, no clipping, no horizontal overflow, adaptive toolbars, collapsible panels | UX-006, UX-020, DS-006, `06` section 11; `zz-responsive-layout` (18 tests) | The new Doc pages were tested at phone and tablet width (no sideways scroll) | WP-19, WP-21 | Studio ribbon at 820 px (UX-012) |
| **Dark and light, equal polish; no hard-coded colours; third-party components themed** | `08`, TH-001 to TH-009, DS-001 | Re-measured: **266** colour literals in code lines of 21 files outside token definitions (96 token definition lines excluded); 10 `outline: none` against 9 `:focus-visible` rules | WP-19, WP-20 | A declared exception policy for paper and PDF viewer (TH-007) |
| **2. Preserve every feature**; checklist; verify after | `01` section 5 (126-feature inventory), 276 routes, `11` (tests) | **The baseline** (`baseline/`) and the checklist method (section 5); **GAP-009** (no baseline existed) | WP-34 | The Studio command list needs a run-time dump (browser crash, GAP-007) |
| **3. Cleanup**, after the redesign, verified before removal | `01` sections 8.5 and 8.6, ARC-013, FE-018 (51 routes, 43 wrappers, decision D8), FE-032, DS-004, DS-008, ARC-015 | The frontend register with false positives (section 6); **CLN-001 to CLN-004** | WP-13 (backend, early), WP-36 (frontend, after the redesign) | **D19** (scope approval) |
| **4. Execution order** (ten steps) | `14` sections 2 to 4 (phases, critical path) | The mapping and the two places where the brief's order and the audit's differ (section 9) | WP-34, WP-35, WP-36 | **D17** |
| **5. Final verification and five reports** | `12` section 8 (gates G-UX, G-Q), `15` | The five reports and what each must contain (section 10) | WP-30, WP-34, WP-36 | none |

### 3.2 What the brief changes in the roadmap

1. It adds an **explicit parity step** (WP-34) that the roadmap did not have: nothing in `14` says how "no feature lost" is proved.
2. It adds **a screen-by-screen program** (WP-35): `14` has packages for the design system, the editor chrome, navigation and accessibility, but none that redesigns the screens in between (sign-in, settings, administrator, workspace, projects, wizard, import, validation, release, graphics, CIR, ancillary, S1000D settings).
3. It adds **a separate cleanup after regression** (WP-36): the roadmap had dead-code removal only in phase 2 (WP-13), which cannot see the code the redesign will orphan.
4. It raises one **conflict** (D16) and one **sequencing question** (D17), section 9.

---

## 4. New findings

### 4.1 Gaps and improvement potential (GAP)

### GAP-001 · P2 · VERIFIED · S · The unsaved-work guard covers four surfaces; other surfaces that hold unsaved state are still unguarded

**Category:** Data-loss risk, remainder of FE-002 after the scoped fix.
**Problem:** a page that holds local edits and is left through the rail, a link or Back loses them silently, except on the four surfaces that now use the guard. The same defect class, the same user harm.
**Evidence:** `lib/leaveGuard.tsx` is used by `DocPublicationPage`, `PublicationPage`, `JssEditorPage` and `JsgEditorPage` only. `JsgAncillaryPage.tsx:78,94-96` keeps a `dirty` flag and a `beforeunload` listener but nothing for in-app navigation, so a rail click discards the checklist and front-matter edits. `AncillaryPage.tsx:53-56` asks with a native `window.confirm` when the author switches page **inside** the screen; the rail is not guarded. Forms with a Save button and local state, not run: `ProjectSettingsPage`, `S1000dConfig`, `Settings`, `Administrator`, `AdminS1000d` (SUSPECTED). The S1000D Studio keeps its drafts in a session that survives navigation (FE-024), so it is not part of this finding.
**Current implementation:** one hook per page; each page decides alone whether to use it (FE-021: the shell re-implements dirty and save per editor).
**Recommendation:** one convention. A page registers its dirty state and its save function once (a `useDirtyForm` over `useLeaveGuard`), every page with a Save button uses it, and the shell shows a marker on the rail item of a tab with unsaved work. Do it as part of WP-05 so the data-loss class closes in one package.
**Expected outcome:** no navigation path loses typed work without a question.
**Dependencies:** `lib/leaveGuard.tsx` and the data router already exist; WP-21 absorbs the convention into the editor host contract.
**Risks:** a guard on a form whose "dirty" is computed wrongly nags on every click; test each page with an untouched form.
**Acceptance criteria:** for every page that has a Save control and local state, an edit followed by a rail click, a link click or Back shows the question; an untouched page never shows it.
**Test cases:** a Playwright conformance spec that visits each such page, types in the first field, clicks a rail item, and asserts the dialog; the same with no edit asserts none.

### GAP-002 · P2 · VERIFIED · M · Two confirmation idioms: eleven native browser dialogs remain next to the application's own modals

**Category:** Consistency, themed components.
**Problem:** the application has `ConfirmModal` and `PromptModal` (themed, with a danger tone and a busy state) and also calls the browser's own `confirm` and `prompt` eleven times. Native dialogs ignore the theme, cannot show detail, block the page, and cannot be driven reliably by browser tests.
**Evidence (a count of `window.confirm|prompt(` calls, corrected by hand; a first script count of 16 included two definitions of the Studio's own dialog API and lines that only mention the word):** `jsg/editor.ts:672` (remove last chapter), `jsg/ispl-editor.ts:126` (delete plate), `:181` (delete appendix), `:217` and `:274` (`prompt` for pasted rows), `:278` (remove only view), `pages/project/AncillaryPage.tsx:55`, `EditorPage.tsx:95` (switch project with unsaved documents), `JsgEditorPage.tsx:150` (replace the handbook with an import), `PublicationPage.tsx:118` (save an empty publication) and `:140` (replace the publication with an import).
**Current implementation:** the framework-free JSG editors cannot import React components, so they call the browser; the React pages call it out of habit.
**Recommendation:** one dialog service with a function API (`confirm(options): Promise<boolean>`, `prompt`) that React pages and the framework-free editors can both call, rendering the themed modal; replace all eleven. The danger tone and the exact consequence ("this removes plate 3 and its 14 parts") belong in the message.
**Expected outcome:** alerts, confirmations and prompts look and behave the same everywhere and follow the theme (brief section 1).
**Dependencies:** DS-005 (dialog focus management) should land first so the new service is built on the fixed modal.
**Risks:** the editors call these synchronously inside event handlers; an asynchronous dialog changes the control flow and needs care in `ispl-editor.ts`.
**Acceptance criteria:** zero `window.confirm`, `window.prompt`, `window.alert` in `frontend/src` (an architecture test greps for them, the Studio's own dialog class excepted).
**Test cases:** the existing specs that accept native dialogs are updated to click the modal; one spec per replaced call asserts the message text.

### GAP-003 · P2 · VERIFIED · S · The JSS/JSG Publication page cannot add a section or an appendix, cannot delete an appendix, and undoes one step at a time

**Category:** Feature parity of the new pages with the S1000D page.
**Problem:** the S1000D Publication page adds content to a chosen chapter; the new page for JSS and JSG can arrange, rename and delete, and add a **chapter**, but not add a section into an existing chapter, not add an appendix, and not delete an appendix. Those still require the editor. Undo removes the last edit only; there is no redo.
**Evidence:** the `Edit` union in `lib/docPublication.ts` has `moveChapter`, `moveSection`, `moveAppendix`, `renameChapter`, `renameSection`, `removeChapter`, `removeSection`, `addChapter` and nothing else; `DocPublicationPage.tsx` offers one Undo button that pops the last edit.
**Current implementation:** by design for the first version (the owner's request was the codes and the drag and drop); not a defect, a gap.
**Recommendation:** add `addSection` (a title, placed in a chapter, honouring `sectionsFixed`), `addAppendix`, `removeAppendix`; give undo a stack with redo. The same operations already exist in the editors' model (`jss/ops.ts`, `jsg/xml.ts`), so the page applies them to the same document.
**Expected outcome:** structure work is complete on one page; the editor is for content.
**Dependencies:** none.
**Risks:** a new section needs a stable identity key before its first save (the identity record re-syncs on save, as for a new chapter).
**Acceptance criteria:** on a free-chapter JSS type and on a JSG handbook, add a section and an appendix, undo, redo, save; the document and the codes match; fixed-chapter and fixed-section types refuse the operation with the stencil rule named.
**Test cases:** unit tests in `docPublication.test.ts` for each new edit; a Playwright test per kind.

### GAP-004 · P2 · VERIFIED · S · The deep link into an editor fails silently, and the keys it uses embed titles

**Category:** Reliability of a new cross-page feature.
**Problem:** "Open in editor" from the pages passes `?goto=<module key>`. The editors return `false` when the key is not found, and the page ignores it: the author lands at the top with no message. Module keys without an element id embed the normalised title and a counter (`t:<chapter>:<title>#n`), so a rename or a duplicate title can point at another section or none.
**Evidence:** `JssEditorPage.tsx:107-108` calls `editorRef.current?.goToModule(goto)` and discards the result; the key forms are in `services/xengine/identity.ts` (read, not exercised with duplicate titles: the mis-resolution part is SUSPECTED).
**Current implementation:** one effect per editor page, a 150 ms timer.
**Recommendation:** show "That section is no longer in the document" when the result is false; prefer element ids in keys and keep the title form only as a fallback; put the whole mechanism in the editor host contract (WP-21) instead of two copies.
**Expected outcome:** a deep link either lands or says why not.
**Dependencies:** WP-21.
**Risks:** none significant.
**Acceptance criteria:** a link to a deleted section shows the message; a link to the second of two sections with equal titles lands on the second.
**Test cases:** Playwright: delete a section, open the old link; add two equal titles, open the second.

### GAP-005 · P3 · NOT VERIFIED · S · Saving from the Publication page re-serialises the whole JSS or JSG document; byte stability of untouched content was not measured

**Category:** Fidelity risk.
**Problem:** the page applies its edits by parsing the document with the editor's model and serialising it back. The editors' own Save does the same, so no new risk class is added, but nobody has measured whether content the model does not know (comments, processing instructions, whitespace, unknown elements) survives.
**Evidence:** `applyToJss` and `applyToJsg` in `lib/docPublication.ts` use `parseJss/serializeJss` and `parseJsg/serializeJsg`; no test compares the bytes of untouched parts.
**Current implementation:** whole-document round trip.
**Recommendation:** a round-trip test over every fixture and sample (parse, serialise, compare); if content is lost, edit the DOM in place for structure-only changes.
**Expected outcome:** a structure-only change leaves every other byte alone, or the loss is known and documented.
**Dependencies:** WP-15 (conversion fidelity) owns the same question for the other engines.
**Risks:** none.
**Acceptance criteria:** the round-trip test passes on all fixtures or lists the exact differences.
**Test cases:** `docPublication.test.ts` and `jss/xml.test.ts` round-trip cases.

### GAP-006 · P3 · NOT VERIFIED · S · Explore thumbnails, ICN search and the plates list were exercised only on starter and sample content

**Category:** Unverified area of the new pages.
**Problem:** the picture view loads thumbnails through `graphicsApi.url(id, file)` and hides a picture whose image fails; ICN names and the plates list come from the identity record. The tests use the starter documents and one sample. Imported packages with nested media folders, SVG-only figures, very long titles and 500 pictures were not tried.
**Evidence:** `e2e/doc-pages.spec.ts` (fixtures: new projects of four kinds).
**Current implementation:** works on the tested content.
**Recommendation:** add an imported-package fixture (the repository has import samples under `frontend/public/samples` and `e2e/fixtures`) to the page tests; measure the page with 500 pictures.
**Expected outcome:** the pages are known to work on real content.
**Dependencies:** WP-08 fixtures.
**Risks:** none.
**Acceptance criteria:** the Explore and Publication pages open without error and with correct thumbnails on an imported package and on a 500-picture synthetic project.
**Test cases:** Playwright with the import fixture; a generated project for the size case.

### GAP-007 · P2 · VERIFIED · S · The browser suite is order dependent, has no runner lock, is not gated, and cannot finish on its default browser

**Category:** Test infrastructure (the precondition for every regression claim of Phase 2).
**Problem:** see section 2.2: a first-run test that fails when an earlier spec created the administrator and takes 40 serial tests down with it; a shared port and `test-results` folder with no lock, so two overlapping runs corrupt each other; the Studio tab crash (UX-011) of Chrome stable that stops the S1000D specs (Edge runs them green); and one stale test that nobody noticed because nothing runs the suite on every change.
**Evidence:** the run logs of 2026-11-27: Chrome stable 70 passed, 5 failed, 58 did not run; `platform.spec.ts` alone on Chrome: 7 passed then "Target crashed"; the same suite on Edge: 132 of 133, the one failure being `platform.spec.ts:488` (expects the removed "SNS defaults" link); `e2e/serve.mjs` (fixed port, `reuseExistingServer: false`), `playwright.config.ts` (`workers: 1`, one output folder).
**Current implementation:** the suite relies on file order and on a fresh server.
**Recommendation:** every spec file gets its own workspace and port (a Playwright project or fixture), the first-run test creates its own server, a lock file refuses a second runner, `describe.serial` blocks fail fast with a clear message; run the suite on Edge by default (D18) and track the Chrome crash as its own defect (UX-011); put the suite behind the gate of WP-08 so a stale test is found the day the screen is removed.
**Expected outcome:** the whole suite runs in any order, alone or together, and its result means something.
**Dependencies:** WP-08; D18.
**Risks:** per-spec servers cost start-up time (not measured).
**Acceptance criteria:** the full suite passes three times in a row in random order on a clean machine; running a spec twice at once is refused.
**Test cases:** the suite itself, run with `--shard` and shuffled order in CI.

### GAP-008 · P3 · RECOMMENDATION · S · "Show the code beside headings" is a project-wide stored setting that changes the editor for everyone

**Category:** Product decision.
**Problem:** the switch on the Publication page is stored in the project's identity record, so one author turning it on changes every other author's editor. A display preference belongs to the person.
**Evidence:** `PUT /api/projects/:id/identity/visibility` writes `show.dmc` into `doc-identity.json`; `DocPublicationPage.tsx` (the checkbox `doc-codes-show-dmc`).
**Current implementation:** inherited from the earlier per-project switches; kept as the single remaining switch.
**Recommendation:** store it per user (the account's preferences, as the theme should be, TH-004), with the project value as the default for a new user.
**Expected outcome:** one person's view setting does not change another's screen.
**Dependencies:** TH-004 (per-user preferences).
**Risks:** none.
**Acceptance criteria:** two users of one project see their own setting.
**Test cases:** API test with two sessions; Playwright with two contexts.

### GAP-009 · P2 · VERIFIED · M · There is no feature-preservation baseline, so "no feature lost" cannot be proved for a redesign

**Category:** Quality gate missing for the owner's highest-priority requirement.
**Problem:** the brief makes "not a single feature lost" the first priority. Today the evidence for what exists is prose (the 126-feature inventory in `01`) and tests that currently cannot all run (GAP-007). There is no machine-readable list of routes, rail items per project kind, commands, accelerators or test ids to compare before and after.
**Evidence:** 25 route declarations and 10 rail item lines in `App.tsx` and `ProjectShell.tsx` (project kind decides which show); 87 Studio commands written out literally in `studio/ui/commands.ts` plus five generator sites that a text scan cannot expand; keyboard handling in the JSS and JSG editors is in handlers with no registry; 337 literal `data-testid` values in 58 files; 133 browser tests (118 test blocks by a text scan), 30 unit test files, 83 backend test files. All of it is now written down in `baseline/` (this addendum creates it; it is documentation, not product code).
**Current implementation:** none before this addendum.
**Recommendation:** WP-34: keep the baseline files under version control, regenerate them as the first and last step of Phase 2, make the diff a gate, add the run-time dump of the Studio command registry and a registry for the JSS and JSG shortcuts, and keep the checklist of section 5.
**Expected outcome:** a removed route, rail item, command, key or test id cannot pass unnoticed.
**Dependencies:** WP-08 (a running suite).
**Risks:** a text scan under-counts (stated in the files); the run-time dump needs a browser that runs the Studio (Edge does).
**Acceptance criteria:** the generated files equal the committed ones at the start; every difference at the end has a row in the checklist with a reason; the number of unexplained differences is zero.
**Test cases:** a unit test that runs the generators and fails on a difference not listed in an allow-file.

### 4.2 User-interface detail (UID)

### UID-001 · P2 · VERIFIED · S · Password fields have no show/hide control and no caps-lock hint

**Category:** Forms and accessibility, named in the brief.
**Problem:** there are 11 password inputs (8 in `AuthScreens.tsx`: sign-in, setup, reset, onboarding, forced change; 3 in `Settings.tsx`: change password) and none has a control to reveal the value, none warns that caps lock is on, and "repeat password" fields invite a mismatch that a reveal would prevent. WCAG 2.2 3.3.8 (accessible authentication) is listed as NOT VERIFIED in `06` section 10.
**Evidence:** `grep` for `type="password"`: 11 hits in 2 files; no `showPassword`, `reveal`, `getModifierState` in `frontend/src/pages` or `components`; all 11 carry an `autoComplete` attribute (17 in the two files), which is correct and stays.
**Current implementation:** plain `<input type="password">` inside `Field`.
**Recommendation:** one `PasswordField` component (toggle button with `aria-pressed` and a label that says what it does, caps-lock notice, the rule shown as the user types, paste and password-manager friendly), used by every password input; the toggle resets to hidden when the field loses focus for a long time or the page changes.
**Expected outcome:** the eleven fields behave the same; a person can check what they typed.
**Dependencies:** WP-19 (Field and input states).
**Risks:** showing a password on a shared screen: the default stays hidden.
**Acceptance criteria:** every password input offers a reveal control reachable by keyboard; caps lock shows a notice; paste is not blocked; an axe scan of the five screens finds nothing new.
**Test cases:** Playwright on each screen (toggle, type, caps lock via `keyboard.press('CapsLock')`); unit test of the component.

### UID-002 · P2 · VERIFIED · M · Form validation feedback is mostly a banner after submit; the field component's error state is used in 2 of 130 places and `aria-invalid` appears nowhere

**Category:** Forms, named in the brief.
**Problem:** the brief asks for proper validation and error feedback. `Field` can show an `error` and wires `aria-describedby`, but only two of 130 `<Field>` uses pass `error`, and no control sets `aria-invalid`. Most forms report problems in an `Alert` or a toast after the request fails, without marking the field or moving focus to it.
**Evidence:** `components/ui.tsx:36` (`Field` with `error`); `grep '<Field[^>]*error='`: 2 uses; `grep aria-invalid`: 0 hits in `frontend/src`.
**Current implementation:** server-side messages shown generically; client-side checks are scattered.
**Recommendation:** a form pattern in the design system: per-field message under the control, `aria-invalid`, a summary at the top that links to the first error and receives focus on submit, inline validation on blur (not on every key), a consistent success state; server errors that name a field are mapped onto it. Start with the five forms in `AuthScreens`, the wizard, and the three settings forms.
**Expected outcome:** the person sees which field is wrong and why, and a screen reader announces it.
**Dependencies:** WP-19.
**Risks:** a server message that names no field stays in the banner; do not invent a mapping.
**Acceptance criteria:** the ten most-used forms mark invalid fields (`aria-invalid`, visible state in both themes), focus the first error on submit, and keep the typed values.
**Test cases:** Playwright per form with an invalid submit; axe for the invalid state.

### UID-003 · P2 · VERIFIED · M · Tooltips are the browser's `title` attribute in 237 places; keyboard and touch users never see them

**Category:** Interaction polish, named in the brief.
**Problem:** icon-only buttons depend on a `title` tooltip that appears after a delay, only on mouse hover, in the operating system's style, and is not reliably announced. The platform rail has its own CSS tooltip (`data-tip`, three uses in one file) that also shows on focus; the Studio has its own. Three mechanisms, none shared.
**Evidence:** `title="` or `title={`: 237 occurrences in 45 files (largest: `EditorSide.tsx` 17, `DocPublicationPage.tsx` 16, `Overview.tsx` 13); `data-tip` 3 uses in `ProjectShell.tsx`; Studio `title:` attributes 23; 240 `aria-label`s in 49 files (good: names exist).
**Current implementation:** per-call-site attributes.
**Recommendation:** one `Tooltip` component (shows on hover and keyboard focus, themed, dismissible with Escape, never the only carrier of a name, supports the shortcut hint) and replace `title` on icon-only controls; keep `title` only on truncated text.
**Expected outcome:** the same hint appears for mouse and keyboard in both themes.
**Dependencies:** WP-19.
**Risks:** hundreds of call sites: do it by a codemod with review, not by hand.
**Acceptance criteria:** every icon-only control has an accessible name and a themed tooltip on focus.
**Test cases:** Playwright: Tab to ten icon buttons and assert the tooltip; axe for names.

### UID-004 · P3 · SUSPECTED · S · 40 native `<select>` elements; the platform styles do not set `color-scheme`, so the open list and scrollbars may follow the system theme and not the chosen one

**Category:** Theme parity, named in the brief ("dropdowns").
**Problem:** native selects are used in 18 files (largest: `components/project.tsx` 7, `S1000dConfig.tsx` 6, `ProjectSettingsPage.tsx` 4). `color-scheme` is set in the Studio's stylesheet (`studio/styles/app.css:45,82`) but not in `styles/platform.css`; if the user chooses Dark in the application while the system is Light, the browser draws the open list, the scrollbars and the autofill colours in light.
**Evidence:** `grep color-scheme frontend/src`: only the Studio file and the theme store's media query; not run in a browser (SUSPECTED).
**Current implementation:** native controls.
**Recommendation:** set `color-scheme` per theme on the root; keep native selects where the list is short (platform behaviour), add a searchable listbox for the long lists (country, language, enterprise codes, the 21 data module types).
**Expected outcome:** dropdowns follow the theme; long lists are searchable.
**Dependencies:** WP-19, TH-004.
**Risks:** a custom listbox must meet the keyboard pattern; keep the native one as the fallback.
**Acceptance criteria:** in each theme with the opposite system setting, an open select, a scrollbar and an autofilled field show the chosen theme.
**Test cases:** Playwright with `colorScheme` emulation opposite to the app theme and a screenshot comparison.

### UID-005 · P3 · RECOMMENDATION · S · Context menus exist only in the Studio design view; trees and tables in the platform pages have none

**Category:** Interaction patterns, named in the brief.
**Problem:** right-click and the keyboard menu key do nothing on a chapter, a section, a project card or a table row of the platform pages, while the actions exist as buttons (rename, delete, move, open in editor, copy code). The brief asks for polished context menus; whether to have them is a design decision.
**Evidence:** `grep contextmenu|onContextMenu`: one file, `studio/view/design.ts`.
**Current implementation:** buttons per row.
**Recommendation:** one `ContextMenu` component fed by the same action list as the row's buttons (so a feature is never only in the menu), opened by right-click, the menu key and Shift+F10, closing on Escape; apply to the Publication and Explore trees, project cards and tables.
**Expected outcome:** frequent actions are one gesture away without crowding the row.
**Dependencies:** WP-19.
**Risks:** hidden-only features: the rule above prevents it.
**Acceptance criteria:** every action available in a row's menu is also available through a visible control or the keyboard.
**Test cases:** Playwright: right-click and keyboard open on four surfaces.

### 4.3 Cleanup (CLN)

### CLN-001 · P3 · VERIFIED · S · One frontend file has no importer: `frontend/src/api/publish.ts`

**Category:** Dead code.
**Problem:** `publishApi` (10 lines, "adapter for the reused PmcBuilder") is referenced nowhere.
**Evidence:** an import graph from `main.tsx` over the 158 non-test TypeScript files and the stylesheets reaches all but two; those two are `api/publish.ts` (no reference by name or path in `src` or `e2e`) and `studio/export/pdfmake.d.ts`, which is an **ambient type declaration** that the compiler picks up without an import and **must stay** (a false positive of the script, kept in the register so nobody removes it). `01` section 8.5 already named `publish.ts`.
**Current implementation:** orphaned after the PmcBuilder reuse was dropped.
**Recommendation:** delete `publish.ts` in WP-36 after a build and the test run.
**Expected outcome:** one file fewer.
**Dependencies:** none.
**Risks:** none.
**Acceptance criteria:** `tsc` and `vite build` pass without it.
**Test cases:** the build.

### CLN-002 · P3 · VERIFIED · S · Sixteen frontend exports are referenced nowhere, three of them leftovers of removed screens; 27 more are used only by tests

**Category:** Dead code.
**Problem:** exported functions and components with no use anywhere in `src` or `e2e`.
**Evidence (name search over every file; none appears outside its declaration):** `components/lists.tsx::ShowMore`; `jss/model.ts::cloneDoc`; `jss/ops.ts::cellAt`; `lib/pmcTree.ts::moduleIds`, `labelFor`; `lib/roles.ts::canManageRole`, `canChooseBrandPack`, `canEditSns`, `canEditSnsDefaults` (the last three, by their names, belong to the SNS and Brand pack screens the owner removed on 2026-11-26); `studio/core/ops.ts::mergeAdjacentFormatting`; `studio/core/table.ts::cellStart`; `studio/core/xml.ts::serializeRaw`, `formatXmlText`, `elementIndexAtOffset`, `resolvePath`; `studio/export/pdf-theme.ts::CONTENT_H`. Another 27 exports are used only by test files (acceptable), and 223 only inside their own file (over-exposed, not a defect).
**Current implementation:** left behind when the callers were removed.
**Recommendation:** remove after confirming each in a build; keep the test-only ones.
**Expected outcome:** smaller surface, no misleading permission helpers (FE-019 notes the duplicated rules).
**Dependencies:** none.
**Risks:** a name used by string (`window.studio.<name>` in tests): the search covered `e2e`.
**Acceptance criteria:** the 16 are gone; build, unit suite and browser suites unchanged.
**Test cases:** the build and the suites before and after (the baseline).

### CLN-003 · P3 · VERIFIED · S · 20 CSS classes are defined and never used; 115 more reported by the scan are generated or belong to libraries and must stay

**Category:** Dead styles.
**Problem:** 628 class names are defined in the frontend stylesheets; 135 never appear as a literal in any source file. Of these, **115 are false positives**: `x-*` (95, built from XML element names by the Studio's renderer: `x-${display}`, `x-${nodeName}`), `cm-*` (13, CodeMirror's own classes), `sev-*` and `toast-*` (5, built as `sev-${severity}` and `toast-${kind}`), `markedContent` and `endOfContent` (2, pdf.js text layer). **20 are real candidates:** `type-cards`, `type-card`, `type-card-title`, `type-card-desc`, `type-card-code`; `applic-rows`, `applic-row`, `applic-vals`, `applic-tools` (the applicability UI the owner removed); `is-collapsed`; `v2-nav-head`, `v2-crumbs`, `v2-page-narrow`; `stat`; `v2-pside`, `v2-pside-head`; `v2-quick`, `v2-brandprev` (the removed Brand pack screen); `v2-subtabs`, `v2-subtab`. Ten were confirmed by hand with a search of every `.ts` and `.tsx` file (`v2-pside` is a prefix of a used class, the exact token is not used); the other ten follow the same script.
**Current implementation:** styles outlive the screens they styled (CLN-004).
**Recommendation:** remove after a build and a visual diff of the affected screens (WP-36); fold the rest into the token work (DS-004, DS-007).
**Expected outcome:** about 20 dead rules fewer, and a script that separates real candidates from generated names.
**Dependencies:** none.
**Risks:** a class built from a variable the script cannot see; the visual diff covers it.
**Acceptance criteria:** the 20 are removed with no visual difference on the screens of the baseline.
**Test cases:** screenshot comparison of the baseline pages in both themes.

### CLN-004 · P3 · VERIFIED · M · Removing a feature from the screens leaves its routes, client wrappers, helpers and styles behind, and nothing in the change process removes them

**Category:** Process, the cause of CLN-001 to CLN-003 and of ARC-013 and FE-018.
**Problem:** the owner removed several features from the screens in recent days (applicability tools, the SNS and Brand pack screens, the CSDB page, the PMC/ICN/contents switches, the Codes button). Each removal left something: styles (`applic-*`, `v2-brandprev`), permission helpers (`canEditSns`, `canChooseBrandPack`), and, as ARC-013 and FE-018 measured, about 51 routes and 43 client wrappers with no caller. The PMC/ICN/contents switches were removed end to end on 2026-11-27 and are the one complete example.
**Evidence:** CLN-002, CLN-003, the findings above, and the memory of removals recorded in the project notes; the end-to-end removal is the diff of the scoped fix.
**Current implementation:** removal is a UI edit; no checklist asks what else only that screen used.
**Recommendation:** a "removal checklist" in the change process (client route, API wrapper, server route and its tests, helper, style, test id, documentation line) and a script in the gate that lists exports, routes and classes with no reference; WP-36 runs it once for the backlog and then keeps it on.
**Expected outcome:** removals are complete; the dead-code count stops growing.
**Dependencies:** D8 (the owner's confirmation of the dead-route list), WP-13.
**Risks:** removing server routes that an external script still calls; D8 exists for that.
**Acceptance criteria:** the script reports zero unreferenced exports and classes outside a reasoned allow-list; the removal checklist is part of the pull request template.
**Test cases:** the script's own unit tests; it runs in CI.

---

## 5. The feature-preservation baseline and checklist

### 5.1 What "preserved" means

A feature is preserved when, after the redesign, **every user can still do what they could do**, with the same permissions, the same validations, the same results of import, export and build, and the same keys, unless the owner recorded a decision to change one. Moving, merging or demoting a control into a secondary menu is allowed; removing it is not.

### 5.2 The baseline (this addendum creates it)

`baseline/` holds read-only snapshots taken before any Phase 2 change. See its `README.md`.

| File | What it freezes | Count today |
|---|---|---|
| `routes-and-rail.md` | Application routes; which rail items each project kind shows (S1000D, JSS, JSG, CIR) and the conditions | 25 route declarations, 10 rail item lines |
| `studio-commands.md` | S1000D Studio commands with ids, groups and accelerators; the keys found in the JSS and JSG editors | 87 literal commands (+ 5 generator sites to expand at run time) |
| `tests.md` | Every browser test title by spec; unit and backend test counts | 13 spec files (two, `zz-verify-*`, run only with `VERIFY_E2E`); 118 test blocks found by the scan and 133 tests listed by the runner (loops generate some); 30 unit files; 83 backend files |
| `page-surface.md` | Lines and `data-testid` values per page and shared component | 58 files, 337 test ids |
| `frontend-hygiene.json` | The counters behind section 6 | n/a |

The scripts are in the audit lead's scratchpad (`baseline.js`, `analyse.js`); Phase 2's first task is to move them into `frontend/scripts/` (WP-34) so anyone can regenerate the files.

### 5.3 Sources of truth for features

1. `01-CODEBASE-UNDERSTANDING.md` section 5: **126 features** with purpose, files, APIs, validation, errors, tests, limits (5.1 platform, 5.2 S1000D, 5.3 publishing and release, 5.4 JSS/JSG/cross-engine, 5.5 packaging and quality, 5.6 finer capabilities).
2. `01` Appendix A and section 8.1: 276 server routes with their guards (the permissions that must not change).
3. `baseline/`: the front-end surface.
4. The browser, unit and backend tests: behaviour.

### 5.4 The checklist, by screen group

One row per screen group; **the last column is filled by Phase 2** for every feature of the first two. "Guard" says which test protects it today and where there is none.

| Screen group | Features that must survive (feature ids of `01`, plus what the baseline shows) | Guard today | Guard gap | New home |
|---|---|---|---|---|
| Sign-in, setup, reset, onboarding, forced password change | A-series platform features (accounts, sessions, reset by administrator approval) | `platform.spec` (first run, second person), backend auth tests | the first-run test is order dependent (GAP-007); one stale test (`SNS defaults`) | |
| Platform shell: overview, workspace, projects, activity, notifications | dashboards by role, project lists, search and filters, notification feed, theme | `platform.spec` roles block | blocked by the Studio crash in this environment | |
| Create project, import a package, export or archive a project, convert between formats, delete | wizard (S1000D identity, codes), import with report, archive export and import, six conversions | `project-import-package.spec`, `zz-import-refusal.spec`, `platform.spec` | conversions: backend tests only | |
| Project rail and badges | Editor, Explore, Publication, Graphics, Ancillary pages (JSS/JSG), Validation (S1000D), Release, Settings; badges (errors, pending, R<n>) | `jss-editor`, `jsg-editor`, `doc-pages` for the rail per kind | S1000D rail: `platform.spec` | |
| S1000D Studio | 87+ commands, XML / Design / Split views, find and replace, tables, figures, validation (schema and BREX), drafts, recovery, quick preview and Generate windows | `zz-dmtypes` (21 types), `platform.spec`, 30 unit-test files of `studio/` | none runnable on Chrome stable (UX-011); all run on Edge | |
| S1000D Explore and Publication | hierarchy, add chapter, place modules, drag and drop, save, import or replace the publication | `platform.spec` (publication tests) | Chrome stable only; green on Edge | |
| JSS and JSG Explore and Publication (new) | hierarchy / table / pictures, search, detail, open in editor, arrange, rename, add and delete chapter, delete section, undo, save, identity, ICN names, build, export, convert, leave guard | `doc-pages.spec` (14), `docPublication.test.ts` (22) | GAP-003, GAP-006 | |
| Validation | run, findings with severity, mark reviewed, CSV, jump to the editor | `platform.spec` (validation), `publish-gate.spec` | Chrome stable crash only; "reviewed" marks live in the browser only (FE-015) | |
| Release and review | request, approve, send back with reasons, resubmit, watermark, read-only reviewer reader, comments | `platform.spec` (release, review) | Chrome stable only; green on Edge | |
| Graphics | list per project and main list, upload, ICN names, preview, delete | `platform.spec` (graphics) | Chrome stable only; green on Edge | |
| CIR repository | create a common data module with the wizard, copy into a project | `platform.spec` (CIR) | Chrome stable only; green on Edge | |
| Ancillary pages (JSS/JSG) | cover, front matter, checklist, amendments, preface | `jsg-editor.spec` (ISPL ancillary), `jss-editor.spec` | the JSG Cover form is unstyled (UX-018) | |
| JSS editor | stencil rules, tables, figures, check, build PDF, import and export, Convert, goto, find | `jss-editor.spec` (12), `jss/*.test.ts` | no find or replace exists (UX-017) | |
| JSG editors | handbook arrange, ISPL plates, parts, appendices, import, build | `jsg-editor.spec` (11), `jsg/*.test.ts` | JSG PDF build not run by the audit | |
| Project settings and S1000D settings | general, publishing (reused screen), team, S1000D catalogue and codes | `platform.spec`, `s1000d-config.spec` | Chrome stable only; green on Edge | |
| Main settings, backup | account, password, theme, backup of own projects | `platform.spec` | Chrome stable only; green on Edge | |
| Administrator | users, approvals, sessions, audit log, reference data, maintenance, backup, S1000D catalogue | `platform.spec` (administrator), `s1000d-config.spec` | Chrome stable only; green on Edge | |
| Preview windows, PDF viewer | quick preview, Generate, synchronised windows, dark-theme viewer | `platform.spec` | Chrome stable only; green on Edge | |

### 5.5 What tests cannot see: the manual walk-through

For each redesigned screen group, a person walks the list below on the old and the new screen and signs the row of 5.4: (1) every control of the old screen is findable; (2) the same account, with each of the roles administrator, project manager, author, reviewer, viewer, can do and cannot do the same things; (3) every validation message appears for the same input; (4) import of the three sample packages gives the same report; (5) export and archive give files with the same contents (compare file lists and hashes); (6) a PDF build of one S1000D, one JSS and one JSG sample is byte-identical to the baseline (the golden output of G-Q-4); (7) every keyboard shortcut of `studio-commands.md` works; (8) tab order is the visual order; (9) the screen works at 1280 x 720, 1366 x 768 and 1920 x 1080 and at 125 % and 150 % scaling; (10) both themes.

---

## 6. Cleanup candidate register (evidence and verdicts)

Counts come from `analyse.js` over `frontend/src` (158 source files without tests, 32,285 physical lines; tests 4,284 lines; CSS 1,356 lines). **Verdict** says what may be done after approval and a regression run; nothing is removed by this audit.

| Class | Raw count | After checking | Verdict | Finding |
|---|---|---|---|---|
| Files with no importer | 2 | 1 real (`api/publish.ts`); 1 ambient declaration that must stay (`studio/export/pdfmake.d.ts`) | remove one | CLN-001 |
| Exports referenced nowhere (not even in their own file) | 16 | 16 (list in CLN-002) | remove | CLN-002 |
| Exports used only by tests | 27 | acceptable | keep | none |
| Exports used only inside their own file | 223 | over-exposed, not a defect | narrow opportunistically | none |
| CSS classes never referenced as a literal | 135 of 628 | 20 real; 115 generated or library classes | remove 20 after a visual diff | CLN-003 |
| Dependencies the script could not find | frontend 4, backend 2 | frontend: `codemirror` (the meta-package; the eight `@codemirror/*` packages are the ones imported) is the only real candidate; `autoprefixer` and `postcss` are used by `postcss.config.js`; `typescript` by the build scripts. Backend: `jpeg-js` is required by the **vendored** `vendor/engine/imageOptim.js` (the script did not scan `vendor`), so it stays; `typescript` is the compiler. Tailwind is installed and generates nothing (DS-008) | remove `codemirror` after a build; DS-008 for Tailwind | `01` 8.5, DS-008 |
| `console.log`, `console.debug`, `console.info` | 0 | clean | none | none |
| `debugger` | 0 | clean | none | none |
| `TODO`, `FIXME`, `HACK`, `XXX` | 0 | clean | none | none |
| `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` | 0 | clean | none | none |
| Commented-out code (pattern scan) | 0 | clean | none | none |
| `console.warn`, `console.error` | 6 in 4 files (Studio) | legitimate reporting | review messages | none |
| `eslint-disable` | 21 in 11 files | most are `react-hooks/exhaustive-deps` on effects | review with FE-022 | FE-022 |
| Explicit `any` (`as any`, `: any`) | 44 in 11 files (`PublishSettings.tsx` 12, `PdfJsViewer.tsx` 9) | type-safety debt | tighten with FE-022 | FE-022 |
| Native `confirm`, `prompt` | 11 calls in 6 files (the script said 16: 5 were false hits) | real | replace | GAP-002 |
| `title="..."` as tooltip | 237 in 45 files | real | replace by a component | UID-003 |
| Colour literals outside token definitions | 266 in 21 files (96 token definition lines excluded; the largest: `jsg/shared.ts` 105, `jss/style.ts` 37, `jsg/ispl-editor.ts` 24, `PdfJsViewer.tsx` 19, `studio/styles/document.css` 19) | partly legitimate (the paper and print preview of the JSS and JSG editors, the PDF viewer) and needs a declared policy (TH-007) | tokenise the chrome; declare the document and viewer exceptions | TH-007, WP-19 |
| `outline: none` | 10 (Studio 9, platform 1) against 9 `:focus-visible` rules | each needs a visible replacement | review | UX-005 |
| `data-testid` values | 337 in 58 files | the contract with the tests | keep or re-home with the checklist | GAP-009 |
| Duplicate implementations | `01` 8.6: 8 exact duplicate bodies, JSS/JSG model serialised in four places, ZIP and PNG helpers twice | real, mostly backend | consolidate in WP-16 | ARC-007, ARC-008 |
| Obsolete assets | `public/` 57 MB with a second copy of the XSD schemas; 75 byte-identical groups, 12.2 MB | real | de-duplicate | FE-032 |
| Stale documentation | README and the architecture document | real | update with the redesign | ARC-015 |

**Method notes and false-positive classes** (so a later person does not repeat the mistakes): the dependency scan must include `vendor/` and config files; generated class names (`x-${...}`, `sev-${...}`, `toast-${...}`) and library classes (`cm-*`, pdf.js) are invisible to a literal search; an ambient `.d.ts` has no importer by design; the dialog count needs a hand check because the Studio defines its own `confirm` and `alert` methods; the route scan cannot see routes built from a variable (`${base}`), so it is not used as evidence for guards (the authorisation matrix of WP-09 is the right instrument).

---

## 7. The standard for "every little detail"

A screen or component is **done** when every row that applies is true, in both themes, at the three window sizes of 5.5 (9), by keyboard alone. This is the definition of done for WP-19, WP-21, WP-22, WP-35.

| Area | Criterion | Anchors |
|---|---|---|
| Tokens | no colour, size, radius, shadow or z-index literal in a component rule; the lint reports zero outside the declared exceptions | DS-001, DS-007, TH-005, TH-007 |
| Buttons and icon buttons | default, hover, active, focus-visible, disabled, busy, selected states exist and differ; a busy button cannot be pressed twice; every icon-only button has a name and a tooltip | DS-002, UID-003 |
| Inputs | label tied to control, hint, error with `aria-invalid`, disabled and read-only look different, password reveal and caps-lock notice, autocomplete correct, no paste block | UID-001, UID-002, `Field` |
| Selects and menus | native for short lists, searchable listbox for long ones, follow the theme (`color-scheme`), keyboard pattern complete, context menu only mirrors visible actions | UID-004, UID-005 |
| Dialogs and confirmations | one service, focus moves in and returns, Escape and scrim behave as designed, danger tone and the exact consequence in the text, no native dialog | GAP-002, UX-004, DS-005 |
| Feedback | success, warning and error toasts consistent, errors persistent until dealt with and announced assertively, background work shows progress | DS-005, UX-028 |
| States | loading (skeleton or spinner by cost), empty (what it is, what to do), error (what happened, retry), offline and session-expired never lose typed work | FE-003, FE-016, UX-016, G-UX-5 |
| Unsaved work | every page with local edits registers with the guard; the rail marks it | GAP-001, FE-002 |
| Tables and trees | one table and one tree component: sort, filter, keyboard rows, selection, virtualisation beyond 200 rows, sticky header, density | UX-013, DS-003, FE-030 |
| Search | one search field pattern, clear button, result count, shortcut | UX-021 |
| Toolbars | adaptive: overflow menu, no clipped labels at 1280 px, same order across editors | DS-006, UX-006, UX-012 |
| Editors | the editing area is at least 55 % of 1366 x 768 in write mode; modes (XML, Design, Split) in one place; validation inline; outline and properties collapsible; same save, dirty, recover and shortcut set | UX-002, UX-003, `06` section 7, G-UX-6 |
| Responsive | no horizontal page scroll from 320 px; no overlap; panels collapse, not clip; 125 % and 150 % scaling | UX-020, `zz-responsive-layout` |
| Themes | both themes pass contrast (4.5:1 text, 3:1 components); third-party parts themed (PDF viewer, code editor, native controls); the first paint is the right theme | TH-001 to TH-009 |
| Accessibility | landmarks, skip link, focus order, target size 24 px, reduced motion, forced colours | UX-005, UX-028, TH-006, G-UX-1 to 4 |
| Performance | no rendering of every row of a large list; route chunks lazy; no regression against the budgets | FE-030, FE-033, PERF-* |

---

## 8. Redesign scope: what exists and what is missing

### 8.1 Designs that exist

The six mockups in `mockups/` (index, workspace, project overview, publication, editor, validation, administration), tokens and components (`tokens.css`, `components.css`), in both themes. They are the audit's proposal for the direction the brief names; they are not an approved design.

### 8.2 Screens with no design yet (needed by "audit and redesign every screen")

Sign-in, setup, reset and onboarding; main settings and backup; the new-project wizard and the import dialog set (six dialogs); Explore (S1000D and Doc pages); Release and the reviewer reader; Graphics (per project and main); CIR repository; Ancillary pages (S1000D-free kinds); S1000D settings and the catalogue administration; Activity and Notifications; the preview windows; the JSS and JSG editor chrome (the Studio chrome is in `editor.html`); empty, error and offline states; the account and role views of restricted users (UX-029 says not seen). WP-35 produces these screen by screen, after WP-19 (tokens and components) and WP-34 (baseline), with the owner approving a direction first (D20).

### 8.3 Opportunities that came out of the survey (RECOMMENDATION, not findings)

1. A **rail marker** for a tab that holds unsaved work (with GAP-001).
2. A **"Move to chapter..."** menu on every section row, so cross-chapter moves do not depend on dragging (keyboard, touch).
3. **Validation findings that open the editor at the row** (the JSS and JSG findings list could use `goToModule` as the pages do).
4. A **command palette** and a **quick project switcher** for the platform shell (UX-021), fed by the same action lists as the buttons.
5. **Per-user view preferences** (GAP-008, TH-004): theme, density, code badges, panel sizes.
6. **Shared page parts**: the S1000D and Doc pages draw the same chapter and module rows, save bar and detail panel twice; the design system's tree and list rows (`07`) should serve both, and the pages are the first test of that.

---

## 9. How the brief fits the roadmap, and where it conflicts

### 9.1 The ten steps of the brief against the phases of `14`

| Brief step | Roadmap | Remark |
|---|---|---|
| 1. Review the audit and the design-system recommendations | Phase 5 entry | Done by this report and `07`, `08` |
| 2. Plan the complete redesign | WP-34, WP-35 plan; D20 | The plan needs the owner's direction first |
| 3. Redesign screen by screen | WP-21, WP-22, WP-35 (phase 6) | After WP-19 and WP-34 |
| 4. Reusable components | WP-19 (phase 5) | Before screens, not during |
| 5. Dark and light parity | WP-19, WP-20 | A gate, not a final check |
| 6. Responsive | WP-19, WP-21, WP-35 | `zz-responsive-layout` extended per screen |
| 7. Verify existing functionality | WP-34 | Needs the suite to run (GAP-007, D18) |
| 8. Regression and visual tests | WP-20, WP-34 | Per batch |
| 9. Cleanup, separately | WP-36 (after WP-35), WP-13 (backend, early) | |
| 10. Full suite again | WP-30 | |

### 9.2 Where the brief and the audit differ

1. **Editors (D16).** The brief wants every editor completely rethought. The audit's `14` section 8 chose to unify the chrome and keep the three framework-free editors, because the canvas code (`jss/editor.ts` 1,134 lines, the JSG editors, the Studio) holds years of behaviour and its tests. Rebuilding the canvases is an XL package times three with the highest risk of losing a feature. The recommendation stays: redesign everything around the canvas (chrome, panels, outline, properties, toolbars, modes, validation feedback) first and rebuild a canvas only where a measured defect demands it.
2. **Order (D17).** The brief begins with the redesign. The audit puts containment of the nine P0 findings and the data-loss defects first (phase 1A), the offline gate next (1B), and the design system before screens (5 before 6). Redesigning screens on top of open data-loss and security defects risks building the new interface on them twice. What can start in parallel with phase 1A without risk: the baseline (WP-34), the token and theme work behind a report-only lint (WP-19), and the approval of the direction (D20).

---

## 10. Risks, acceptance and the five reports

### 10.1 Risks of Phase 2 as a whole

| Risk | Mitigation |
|---|---|
| A feature is lost in a redesign | WP-34 baseline and checklist; parity gate per batch; the manual walk-through (5.5) |
| The suite cannot run (GAP-007, UX-011) so regressions are invisible | D18 and WP-08 first; no screen batch is accepted without a green run of the tests that cover it |
| Two designs live at once confuse users | One switch (`ui.next`) per screen group, flipped by batch after parity is signed; no mixed navigation |
| The redesign orphans code | WP-36 after regression; the removal checklist (CLN-004) |
| Scope growth ("every screen") | the screen list of 8.2 and 5.4 is the scope; a screen not on it needs a decision |
| Visual direction disliked after the work | D20 before WP-35; mockups approved first |
| Performance regression from heavier components | budgets (FE-033) in the gate |

### 10.2 Acceptance of Phase 2 (what "done" means, from the brief's section 5)

Every row of 5.4 has a new home and a signature; every screen of 8.2 and of the project rail is redesigned on the tokens; all three editors keep every capability of `01` section 5.4; both themes and the three window sizes pass the criteria of section 7; no control is unreachable by keyboard; `tsc`, lint and `vite build` are clean; the before and after test results are compared in a table; cleanup (WP-36) is approved separately and followed by a second full run.

### 10.3 The five reports to produce (each concise)

1. UI/UX redesign: screen list, decisions, before and after images in both themes.
2. Functionality preservation: the checklist of 5.4 filled, the baseline diff with a reason per difference.
3. Responsive and theme verification: the screens by window size and theme, axe and contrast results.
4. Code cleanup: what was removed, how each item was verified, what was kept and why (the register of section 6 filled).
5. Tests and remaining issues: before and after, flaky list, open findings.

---

## 11. Counts and limits of this addendum

**Counts after this addendum** (the register in `14` section 10 is regenerated): **322 findings** (9 P0, 88 P1, 169 P2, 56 P3), **36 work packages** in 10 phases, **20 owner decisions** (the first 15 unchanged; D16 to D20 added in `14` section 5). New findings by prefix: GAP 9, UID 5, CLN 4. New packages: WP-34 (baseline and parity harness, phase 5), WP-35 (screen-by-screen redesign, phase 6), WP-36 (post-redesign cleanup, phase 6).

**Not done, and why it matters:** the Studio command registry was not dumped at run time (it needs an Edge session; Chrome stable crashes, GAP-007); no browser session was used for UID-004 (SUSPECTED); the five settings and administrator forms of GAP-001 were not run; the route and guard scan of the backend was not used as evidence; the JSG PDF build and the installer remain unexecuted (`15`). The audit status stays **PARTIAL**.

**Scripts** (read-only; in the audit lead's scratchpad, to move into `frontend/scripts/` by WP-34): `analyse.js` (import graph, unused exports, CSS classes, dependencies, leftovers, colours, shortcuts), `baseline.js` (writes `baseline/`), `scrape.js` and `roadmap.js` (regenerate the finding register and `14`).
