## 12. Prioritised UX findings

Heading format: `UX-id · priority · evidence label · size · title`. P1 findings use the full form; P2 and P3 use the compact form. All findings were measured or read on the isolated scratch instance (Edge, port 4056) unless the label says otherwise. Paths are relative to the repository root `Agastya-platform-v2`; `Agastya-platform-v2/backend/dist/...` lines are compiled output and are given only where the TypeScript source is named beside them.

### UX-001 · P1 · VERIFIED · S · JSS Publication page ends in "Internal error"

**Category:** Functional defect in navigation.
**Problem:** every JSS project shows "Publication" in the project rail; opening it renders "Internal error" instead of a page.
**Evidence:** `73-jss-publication.png` (Land); the Naval project was not opened on this page. `frontend/src/layouts/ProjectShell.tsx:54` adds the Publication item for everything except JSG (`jsg ? [] : [...]`), so JSS receives it. The page calls `contentApi.pmc(id)`, which hits `GET /api/projects/:id/pmc` (`backend/src/routes/project-content.ts:202`); the compiled chain `backend/dist/services/pm.js:63/66/71` then `importer/pmComplete.js:72`, `importer/identity.js:112`, `backend/vendor/engine/pmc.js:204` throws "Not a publication module: no <pm> root element" and the route answers 500.
**Current implementation:** the rail is built from the format, with a special case for JSG only; the Publication page assumes an S1000D publication module.
**Recommendation:** hide the item for JSS as for JSG, or let the route answer 404 or an empty body for non-S1000D projects and let the page say "JSS documents are built from the editor (Generate PDF)" with a link. Long term, Project Home (UX-007) shows build state for every format.
**Expected outcome:** no destination in the rail ends in an error.
**Dependencies:** the route guard belongs to the back-end owner; the UI change is independent.
**Risks:** a JSS user may expect build history there; check where JSS output lives (the Release page offers the PDF, `75-jss-release.png`) before removing the item.
**Acceptance criteria:** for JSS Land, JSS Naval, JSG user handbook and JSG spare parts list, every rail item opens a page with no error banner and no 5xx in the server log.
**Test cases:** Playwright, per project type: click each rail item, record `page.on('response')`, fail on status 500 or the text "Internal error". API test: `GET /pmc` on a JSS project returns a 4xx with a message.

### UX-002 · P1 · VERIFIED · M · The editing surface gets 29% of a 1366x768 screen by default

**Category:** Layout and editor workspace.
**Problem:** the area where authors spend their day is the smallest region on the screen. Default Split view with the DM panel open leaves 592 by 513 px at 1366x768 (28.9% of the viewport); with Outline, Attributes and Problems panes also open, 730 by 341 px (23.7%). At 1920x1080 the default gives 902 by 825 px (35.9%).
**Evidence:** `getBoundingClientRect` of `.editor-host` in four states (table in section 7.2); `hd-s1k-split.png`. At 1920x1080: top bar 42 px, ribbon 131 px, status bar 18 px, rail 56 px, DM panel 248 px, PDF pane 705 px.
**Current implementation:** `frontend/src/pages/project/EditorPage.tsx` defaults to Split (view saved in `agastya.editor.view`); the DM panel is open; the Studio ribbon is always fully expanded; `frontend/src/lib/studioSession.ts:108-114` already closes the three Studio panes on first run, which shows the problem was noticed.
**Recommendation:** section 7.2: default to Write mode without the preview, collapsible ribbon with a context toolbar, Focus mode, Problems as a bottom drawer of at most 25% height, preview as an opt-in panel with a stale indicator.
**Expected outcome:** at least 55% of a 1366x768 screen for the editing surface by default, 70% in Focus mode.
**Dependencies:** the shell work in UX-003; a Studio API to collapse the ribbon (the layout toggles in `studio/ui/app.ts` `applyLayout()` suggest it is feasible; NOT VERIFIED).
**Risks:** authors who like seeing the PDF lose the default; remember the last mode per user. A collapsed ribbon hides commands: keep File, search and the palette one click away.
**Acceptance criteria:** the same measurement script, fresh browser profile: `.editor-host` at least 55% of the viewport area at 1366x768 and at 1920x1080; Focus mode at least 70%; the Problems drawer never exceeds 25% of the height; the last mode survives a reload.
**Test cases:** Playwright measuring `.editor-host` in default, Focus and Problems-open states at both sizes; visual snapshot of each.

### UX-003 · P1 · VERIFIED · XL · Three editors behave as three products

**Category:** Consistency and learnability.
**Problem:** the same job (write a long technical document, check it, build it) is done with three different headers, toolbars, save vocabularies and keyboard sets.
**Evidence:**

| | S1000D Studio | JSS | JSG |
|---|---|---|---|
| Header | Panel toggle, crumb, "All changes saved" or "Save (n)" (`EditorPage.tsx:118-134`) | Badge, Check, Save, Import project, Export (twice), Codes, Convert, Generate PDF (`JssEditorPage.tsx:176-183`) | Import Word, Auto-save checkbox, Check, Save, Codes, Convert, Export, Generate PDF (`JsgEditorPage.tsx:194-200`) |
| Toolbar | Ribbon File, Home, Insert, Review, View, Tools | Tabs Write, Insert, Arrange, Document | Tabs Write, Insert, Table, Arrange, Document |
| Find and replace | Find, Replace, Go to ID | None found (`jss/editor.ts`) | Ctrl+F, Ctrl+H bar (`jsg/editor.ts:94,167`) |
| Command palette | Yes (`commands.ts:169`) | No | No |
| Shortcuts | Full registry | Ctrl+S, Ctrl+Z, Ctrl+Y (`jss/editor.ts:162`) | Ctrl+S, F, H, Z, Y |
| Save state words | "All changes saved" | "Unsaved changes" or "Saved" with a relative time | Same as JSS |
| Recovery | Recovery drafts (on by default) | None | None; autosave opt-in |
| Problems | Pane with counts | Strip "Problems: 0 errors, 52 warnings" | Check button |

**Current implementation:** each editor is a framework-free component with its own chrome, mounted by a React page that duplicates the split and divider logic three times (`EditorPage.tsx:142-147`, `JsgEditorPage.tsx:225`, `JssEditorPage.tsx:201`).
**Recommendation:** section 7.1, in stages that do not touch the engines: (1) one header and one save-state vocabulary; (2) one shortcut table, Ctrl+F and Ctrl+K in all three; (3) one problems drawer fed by a common model (UX-008); (4) one split and divider component.
**Expected outcome:** one set of habits for authors and trainers; one accessibility fix lands everywhere.
**Dependencies:** UX-008, UX-010; the owners of the JSS and JSG engines.
**Risks:** large; regressions in engines tuned to the customer's format; mitigate by keeping the adapters thin and extending the existing end-to-end suites.
**Acceptance criteria:** in all three editors the same state words, Ctrl+S, Ctrl+F, Ctrl+K, Esc behaviour, and a single shortcuts dialog.
**Test cases:** one parameterised Playwright spec over the three formats asserting those behaviours.

### UX-004 · P1 · VERIFIED · S · Dialogs do not trap or restore focus

**Category:** Accessibility (WCAG 2.4.3 Focus Order, with 2.1.2 and 3.2 related).
**Problem:** with a dialog open, Tab walks into the page behind it. In a probe on the New-project wizard, 50 of 60 Tab presses landed outside the dialog. Closing does not return focus to the control that opened it.
**Evidence:** the probe; `frontend/src/components/ui.tsx:57-72` (`Modal`: Escape handler on `window`, `aria-modal="true"`, no trap, no focus return, no `inert` on the page). The wizard's `Modal` is not `sticky` (`components/project.tsx:206`), so a backdrop click or Escape closes it at once (`25-wiz-after-esc.png`).
**Current implementation:** one shared `Modal` serves every platform dialog (wizard, confirm, prompt, waiver, graphics preview, import).
**Recommendation:** fix once in `Modal`: focus the first control on open, trap Tab and Shift+Tab, make the app root `inert` while open, return focus on close, make Escape close only the top dialog, and ask before discarding a partly filled wizard.
**Expected outcome:** every platform dialog becomes keyboard-safe from one change.
**Dependencies:** none. Studio's own dialogs (`frontend/src/studio/ui/dialogs.ts`) are a separate implementation: NOT VERIFIED.
**Risks:** nested dialogs (the waiver opens above a refusal); a focus trap must not fight the PDF viewer or CodeMirror.
**Acceptance criteria:** with any platform dialog open, 60 consecutive Tab presses never leave it; on close focus is on the opener; with two dialogs open, Escape closes only the upper one; the wizard asks before closing when it holds input.
**Test cases:** Playwright: open the wizard, Tab 60 times, assert `document.activeElement.closest('.modal')`; close and assert focus; repeat for the waiver dialog.

### UX-005 · P1 · VERIFIED · M · No landmarks or skip link; menus and clickable rows only partly keyboard-operable

**Category:** Accessibility (WCAG 2.1.1, 2.4.1, 2.4.2, 4.1.2).
**Problem:** (a) there is no `main` landmark and no skip link; the page title is "Agastya Platform" on every route. (b) On Projects, the administrator Overview and the numbering-preset list, a project or row opens only by clicking the row: after "New project", Tab reaches only the Copy buttons, and 0 of 6 rows in the administrator table had a keyboard target. (c) `div role="button"` rows handle Enter but not Space. (d) The account menu has `role="menu"` without arrow-key behaviour. (e) The editor/PDF divider is pointer-only.
**Evidence:** queries on `/overview`: `main` count 0, skip link absent, one `h1`, title "Agastya Platform". Tab probe on `/projects` (Copy buttons only), row probe on `/overview` as administrator (0 of 6). Code: `frontend/src/pages/Projects.tsx:59`, `components/Oversight.tsx:47`, `pages/AdminS1000d.tsx:160` (`tr.clickable onClick`), `pages/project/ValidationPage.tsx:118`, `jss/editor.ts:630,672`, `layouts/AppShell.tsx:87-91`, `pages/project/EditorPage.tsx:147`. Index title: `frontend/index.html:7`.
**Current implementation:** shell and pages are `div` based with a mouse-first click handler; Workspace and Overview cards are correct (`role="link" tabindex="0"`).
**Recommendation:** add `main` and a skip link; make the project name a real link in tables; handle Space and Enter on role-button rows or use `button`; give the account menu arrow-key and Escape handling or drop the role; add arrow-key resizing to the divider; set `document.title` per route.
**Expected outcome:** a keyboard-only user can open a project, move through a table, and bypass the sidebar.
**Dependencies:** none.
**Risks:** low; the Studio contenteditable surface is separate (NOT VERIFIED).
**Acceptance criteria:** Tab from the page top reaches a skip link first; Enter on a project name opens the project; Space and Enter activate every `role="button"` row; the account menu responds to arrows and Escape; the divider resizes with arrow keys; titles differ per route.
**Test cases:** Playwright keyboard scripts for each of those; a landmark query asserting exactly one `main`.

### UX-006 · P1 · VERIFIED · S · Primary controls fall off-screen at 1280 and 1366 px

**Category:** Responsive layout.
**Problem:** the "New project" button on Projects lies beyond the right edge of the viewport (right edge at 1461 px) at 1366, 1280 and 1024 px wide, because the toolbar does not wrap. In the editors the header does not scroll, so controls beyond the edge cannot be reached with the mouse: the JSG "PDF" segment at 1366 px; the JSS "PDF" segment at 1280 px; the JSG "Split" and "PDF" at 1280 px.
**Evidence:** probes `s73-overflow` and `s75-jsshdr`: Projects `newProjectRight` 1461 at all three widths; header `scrollWidth` equals its width. `12-projects.png` shows the button cut at 1366; `25-wiz-after-esc.png` shows the page scrolled sideways. Code: `frontend/src/pages/Projects.tsx:49` (a row of up to seven buttons, no wrap).
**Current implementation:** a flex row with fixed buttons; three sample-project buttons share the row (UX-014).
**Recommendation:** let toolbars wrap; keep one primary action and fold the rest into a "More" menu; move sample buttons to the empty state (UX-014); in editor headers keep state, Editor/Split/PDF and Generate visible and fold Import, Codes, Convert and Export into a Document menu.
**Expected outcome:** every primary action is visible at the most common laptop widths.
**Dependencies:** UX-014 and UX-003 reduce the number of controls.
**Risks:** folding actions can hide ones people use daily: keep Generate and Save visible.
**Acceptance criteria:** at 1280x720 and 1366x768, on Projects, Workspace and the three editor pages, every button and link with a visible box has `right <= innerWidth`; at 1024 on platform pages.
**Test cases:** extend `frontend/e2e/zz-responsive-layout.spec.ts` with those routes and widths and a bounding-box assertion.

### UX-007 · P1 · VERIFIED · M · A project has no home

**Category:** Information architecture.
**Problem:** opening a project lands in the Editor. Project status is split over a Validation badge, a Release badge, Publication tiles ("Last build: never"), and Settings > Activity. The rail has eight icon-only destinations with CSS tooltips; the project name is missing from the Validation, Release and Settings headers.
**Evidence:** `frontend/src/layouts/ProjectShell.tsx:53-56,69-75` (rail items; `data-tip` tooltips), the route table in `frontend/src/App.tsx` (no project index route), `35-validation.png`, `36-release.png`, `37-psettings.png` (no project name beyond the rail tile "S").
**Current implementation:** a 56 px rail, one page per item.
**Recommendation:** Project Home and a labelled rail (section 6.5), plus a breadcrumb.
**Expected outcome:** one screen answers "what is the state of this manual and what is next".
**Dependencies:** UX-008 (problems model), release status API (exists), JSS and JSG status fields (NOT VERIFIED).
**Risks:** a home page that only repeats counts adds a click: it must carry actions ("Continue", "Run check", "Submit for review").
**Acceptance criteria:** the project route lands on Home (or opens the editor via "Continue" in one click); Home shows Continue, Check, Review and Build cards for all three formats; the project name is visible on every project page; rail labels appear on hover and on keyboard focus.
**Test cases:** Playwright: open each project type, assert the four cards and that every project page contains the project name; keyboard focus on a rail item shows its label.

### UX-008 · P1 · VERIFIED · L · Five problem surfaces, and "reviewed" marks live in one browser

**Category:** Workflow and consistency.
**Problem:** a finding appears in the Studio Problems pane, on the Validation page, in the publish refusal, in the JSS findings strip and marks, and behind the JSG "Check" button, each with its own wording and persistence. The "reviewed" mark on the Validation page is stored in the browser, so a colleague, or the same author on another PC, sees everything unreviewed.
**Evidence:** `frontend/src/pages/project/ValidationPage.tsx:23-27` (`localStorage` key `agastya.reviewed.<project>`), `components/PublishRefusal.tsx`, `jss/editor.ts:113` (`setFindings`), `55-settings.png` (live validation on in Studio), `35-validation.png` (a manual run is needed).
**Current implementation:** each surface is built separately on top of different report shapes (`ValidationIssue`, gate findings, JSS `Finding`).
**Recommendation:** section 7.4: one problems model (source, severity, file, line, rule, state open, reviewed or waived) behind every surface; store the reviewed state and who and when on the server. The settled gate-and-waiver policy is unchanged.
**Expected outcome:** the number an author sees in the editor equals the number on the Check page; a reviewer's marks are visible to everyone.
**Dependencies:** a server-side store for review state (a schema change, outside this audit's remit).
**Risks:** merging report shapes touches the engines' output adapters; stage it behind a read-only view first.
**Acceptance criteria:** a finding marked reviewed by user A shows as reviewed for user B in another browser; editor chip counts equal Check page counts for one file after the same run; one wording for severities.
**Test cases:** two Playwright contexts; a parity test comparing counts between the pane and the page.

### UX-009 · P1 · VERIFIED · M · Review comments exist only on the Release page

**Category:** Workflow.
**Problem:** the project manager's anchored comments are read and resolved on the Release page; none of the editors shows a comment indicator, so an author fixing a text has to leave the editor to see what was asked. In Studio, the ribbon tab "Review" means validation and change marks, while the platform's "Review and release" means the manager's approval loop: one word, two meanings.
**Evidence:** `frontend/src/pages/project/ReleasePage.tsx:168` renders `ReviewReader`; a search of `src/studio`, `src/jss`, `src/jsg` and the editor pages for review-comment types returned no hits; `commands.ts:131-138` (Review group = validate, BREX, next problem, mark modified). The Release page with a submitted review and comments was not rendered here (code only).
**Current implementation:** comments are anchored by element path and words (`ReviewReader.tsx:1-4`), with a "Moved or changed" list. Good design, wrong place.
**Recommendation:** a Review mode in the editor shell (section 7.3) with comments in the margin, a "next comment" key, an unread count in the header, and a "Comments" tab in the Inspector; rename the Studio ribbon tab to "Check" or "Validate".
**Expected outcome:** the author works from the comments in place.
**Dependencies:** the comment API (exists); JSS and JSG comment anchoring: NOT VERIFIED.
**Risks:** anchoring in a contenteditable surface that is being edited is delicate; the "Moved or changed" logic must carry over.
**Acceptance criteria:** with two open comments on a data module, the author sees both markers in the editor, can step through them, and resolving one updates the Release page.
**Test cases:** Playwright with two contexts (manager comments, author reads); renamed tab asserted.

### UX-010 · P1 · VERIFIED · M · JSS has no autosave or draft recovery; JSG autosave is opt-in and per browser

**Category:** Data safety.
**Problem:** in JSS a closed tab, crash or power loss loses everything since the last manual Save; only a `beforeunload` warning stands in the way. JSG can autosave, but only if each author ticks "Auto-save", remembered in the browser.
**Evidence:** `frontend/src/pages/project/JssEditorPage.tsx:161` (`beforeunload` only; no timer, no draft store); `JsgEditorPage.tsx:43,128-135` (opt-in, one minute after the last change, key `agastya.jsg.autosave`); S1000D has recovery drafts on by default (`55-settings.png`, `studio/ui/app.ts:988` `saveDraft`).
**Current implementation:** three different safety nets (UX-003).
**Recommendation:** section 7.9: autosave on by default for all three, with a local recovery draft that survives a crash and is offered on the next open; keep Save and Ctrl+S.
**Expected outcome:** a crash costs seconds, not hours, in long documents (the JSG sample is 47,447 words).
**Dependencies:** a draft store (browser storage is enough for the first step; server drafts if a multi-PC workflow matters).
**Risks:** autosave of an invalid JSS document must not be mistaken for a clean save: keep the "saved as a draft: n errors" language already used (`JssEditorPage.tsx:117`).
**Acceptance criteria:** edit, kill the tab without saving, reopen: the document offers to restore; JSG autosave is on by default and stored with the user, not the browser.
**Test cases:** Playwright: edit, `page.close()` without saving, reopen and assert the restore prompt and content.

### UX-011 · P1 · OBSERVED · M · Chrome (stable channel, headless) crashed the tab when opening a data module in Studio

**Category:** Reliability seen while testing the UI.
**Problem:** with Playwright's `channel: 'chrome'`, opening a data module in the S1000D editor produced "Page crashed" twice, also with GPU and software rasterizer disabled. The same steps in Edge did not crash and all later captures used Edge.
**Evidence:** the two runs (not kept as artifacts); `frontend/playwright.config.ts` defaults to `channel: 'chrome'`.
**Current implementation:** not investigated; the cause may be this environment (Windows Server 2025 evaluation image, no GPU), a memory limit, or the product.
**Recommendation:** hand to the performance and QA agents to reproduce on a normal workstation with Chrome and with the shipped browser setup, and capture a crash dump or the renderer's console. Until then do not state that Chrome is supported.
**Expected outcome:** either a product fix or a documented environment limit.
**Dependencies:** a Windows 11 workstation with Chrome.
**Risks:** if real, it affects the most common browser; if environmental, no impact.
**Acceptance criteria:** the e2e smoke opens a data module and types in Chrome stable and Edge on a reference machine without a crash.
**Test cases:** run the existing editor e2e against both channels.

### UX-012 · P2 · VERIFIED · S · Studio ribbon labels are clipped and there is no overflow menu

**Problem:** at 1920 px with the DM panel open and Split view, the Structure group reads "Delete elemen" and "Select element" (`hd-s1k-split.png`); at 1366 px the Editing group is cut ("Go to ID /"). The ribbon is 131 px high.
**Evidence:** `hd-s1k-split.png`, `62-s1k-problems.png`.
**Recommendation:** an overflow "More" per group, or shorter labels, or the collapsible ribbon of UX-002.
**Acceptance:** no ribbon label is truncated at 1366x768 in Split view; overflow items reachable by keyboard.

### UX-013 · P2 · OBSERVED · M · Explore, Publication and the DM panel show the same tree three ways

**Problem:** the three show the same chapters and data modules; Explore's side panel is empty until a click (`32-explore.png`, `33-publication.png`, `31-s1k-editor-dm.png`). New users do not know which one to use.
**Evidence:** screenshots; `ProjectShell.tsx:53-54`.
**Recommendation:** one Structure page (tree, build order, not-placed pool, metadata panel); the DM panel stays as the editor's navigator.
**Acceptance:** one tree page; the identity, schema and history panel from Explore appears when a module is selected in Structure.

### UX-014 · P2 · VERIFIED · S · Sample buttons and three overlapping project lists crowd the first screens

**Problem:** "Sample project", "JSG sample" and "ISPL sample" sit beside "New project" on Overview, Workspace and Projects (`Overview.tsx:104`, `Projects.tsx:49`). The same projects appear as cards (Overview), folders (Workspace) and a table (Projects). Backup is offered in the sidebar, Settings, Overview and Projects.
**Evidence:** `10-author-overview.png`, `11-workspace.png`, `12-projects.png`, `15-backup.png`, `16-settings-account.png`.
**Recommendation:** Home with three views; samples in the empty state and in Help; one Backup entry plus a project-menu export.
**Acceptance:** one project list route with Recent, Folders and Table views; sample buttons absent when the user has projects.

### UX-015 · P2 · VERIFIED · S · The activity feed shows a raw event code

**Problem:** the first screen after sign-in lists an internal event name next to plain sentences, and the same names appear in the audit log.
**Evidence:** `10-author-overview.png` shows "rita auth.session.displaced" beside "rita signed in"; `99-admin-audit.png` shows the dotted codes in the Action column.
**Recommendation:** map event codes to sentences; hide sign-in noise from the author's own feed.
**Acceptance:** no dotted event code is visible on Overview, Activity or Notifications.

### UX-016 · P2 · VERIFIED · S · Empty-state typography breaks the PDF placeholder and looks off-centre elsewhere

**Problem:** the PDF placeholder steps are split into one short group of words per line, and other empty states centre the title but left-align the body.
**Evidence:** `hd-s1k-split.png` and `hd-jsg.png` ("Press / Quick preview / to proof ..."); the cause is `.v2-empty strong { display: block }` (`frontend/src/styles/platform.css:69`), which turns inline emphasis into blocks. Off-centre empty states: `35-validation.png`, `32-explore.png`.
**Recommendation:** scope the block rule to the title element; align title and body the same way everywhere.
**Acceptance:** the placeholder reads as three numbered sentences; all empty states align title and body consistently.

### UX-017 · P2 · VERIFIED · M · JSS has no find or replace; JSS and JSG have no command palette

**Problem:** long JSS documents cannot be searched from the editor, and neither JSS nor JSG offers the palette that Studio has.
**Evidence:** the JSS root key handler covers Ctrl+S, Ctrl+Z and Ctrl+Y only (`frontend/src/jss/editor.ts:162`) and no find UI exists in that file; JSG has a find bar (`jsg/editor.ts:167-168`); the palette is registered only in Studio (`studio/ui/commands.ts:169`).
**Recommendation:** the shared find bar and palette of sections 7.5 and 7.7.
**Acceptance:** Ctrl+F opens a find bar in JSS; Ctrl+K opens a palette in all three editors.

### UX-018 · P2 · VERIFIED · S · The JSG ancillary Cover form is unstyled

**Problem:** on the page where a user enters the cover data of every handbook, labels and inputs flow inline with no layout and list rows use raw buttons.
**Evidence:** `81-jsg-ancillary.png`.
**Recommendation:** build it from the platform `Field` layout with a two-column grid and reuse it for the other ancillary pages.
**Acceptance:** each field has its label above a full-width input; the page passes the same visual review as Project settings.

### UX-019 · P2 · VERIFIED · S · Duplicate Export in the JSS header; icon-only buttons in the DM panel

**Problem:** the JSS header shows "Export" twice; the DM panel has five icon-only buttons and a Publication/All switch cut to "Publica".
**Evidence:** `frontend/src/pages/project/JssEditorPage.tsx:180` (`PackagePanel`) and `:183` (`ExportProjectButton`); `31-s1k-editor-dm.png`; `frontend/src/pages/project/editor/EditorSide.tsx`.
**Recommendation:** one Export; a labelled "More" menu in the DM panel and a wider switch.
**Acceptance:** one Export per header; no truncated switch label at 248 px.

### UX-020 · P2 · VERIFIED · M · JSS and JSG pages scroll sideways below about 1100 px; the S1000D ribbon overflows at 820 px

**Problem:** below about 1100 px the JSS and JSG editor pages scroll sideways, the S1000D ribbon runs beyond the edge at 820, and a heading overlaps another on the narrowest Overview. Snapped half-screen windows (about 683 px on a 1366 px screen) are a realistic case.
**Evidence:** page scroll width 1112 (JSS) and 1121 (JSG) at both 390 and 820 px (`m-jss.png`, `t-jss.png`); `t-editor-dm.png` (ribbon groups beyond the right edge, DM panel as an overlay); `m-overview.png` ("Recent projects" heading over the next heading).
**Recommendation:** section 11: fold header actions into a menu; add the editors to the responsive spec.
**Acceptance:** no sideways page scroll at 683, 820 and 1024 px on the three editor pages.

### UX-021 · P2 · RECOMMENDATION · M · No quick switcher or global search

**Problem:** moving between projects, files and pages needs menus and clicks; the palette exists only inside S1000D Studio.
**Evidence:** no search control in `frontend/src/layouts/AppShell.tsx`; palette registered only at `studio/ui/commands.ts:169`; filters exist only per list (`Projects.tsx`, `Workspace.tsx:84`, `EditorSide.tsx`).
**Recommendation:** Ctrl+K "jump to" for projects, files and pages first (section 8); full-text search later and only if the back end can support it (NOT VERIFIED).
**Acceptance:** Ctrl+K opens a list that searches project names and, inside a project, data module titles and codes, and opens the chosen item.

### UX-022 · P2 · SUSPECTED · S · A newer sign-in silently ends the older session

**Problem:** every sign-in displaces the account's previous session; no message explaining that to the displaced user was found.
**Evidence:** `auth.session.displaced` is written on each sign-in (`99-admin-audit.png`); `frontend/src/store/session.ts:44` treats a 401 as "expired, revoked, or displaced". What the displaced user actually sees is NOT VERIFIED.
**Recommendation:** show "You were signed out because this account signed in on another computer" and keep unsaved work as a recovery draft (UX-010).
**Acceptance:** a displaced browser shows that sentence and offers to restore its draft.

### UX-023 · P2 · VERIFIED · S · A sign-in error stays on screen after switching to Reset password

**Problem:** the error from a failed sign-in remains visible on the reset screen.
**Evidence:** `06-forgot.png` shows "Invalid username or password." under the reset form; the error state is shared and not cleared when the mode changes (`frontend/src/pages/AuthScreens.tsx:39-44,63,73`).
**Recommendation:** clear the error on mode change.
**Acceptance:** after switching modes no error text is shown until a new attempt.

### UX-024 · P3 · OBSERVED · S · The project wizard asks for codes with no example

**Problem:** "Model code" starts blank with no example or length rule, and the partner company is a bare "Code (5)" box.
**Evidence:** `22-wiz-model.png`.
**Recommendation:** show an example, the rule and the last used values.
**Acceptance:** each code field shows an example and its rule before input.

### UX-025 · P3 · VERIFIED · S · Audit log and Activity cards need filters and polish

**Problem:** the audit log can be filtered by action only and shows an IPv4-mapped address; Activity cards let a long project title run under the Open button.
**Evidence:** `99-admin-audit.png` (`::ffff:127.0.0.1`, one filter box); `99c-activity.png`.
**Recommendation:** user and date filters, plain IPv4, ellipsis on titles.
**Acceptance:** filter by user and by date; no overlap at 1366 px.

### UX-026 · P3 · VERIFIED · S · The sign-in tagline names only S1000D

**Problem:** the product serves S1000D, JSS and JSG, but the sign-in text mentions one.
**Evidence:** `frontend/src/pages/AuthScreens.tsx:68`: "Offline, on-premises S1000D authoring and publishing."
**Recommendation:** name all three.
**Acceptance:** the line mentions S1000D, JSS and JSG.

### UX-027 · P3 · SUSPECTED · S · The palette shortcut may collide with a browser key

**Problem:** the command palette is bound to Mod+Shift+P, which some browsers use for a private window.
**Evidence:** `frontend/src/studio/ui/commands.ts:169`. The collision itself was not tested in any browser.
**Recommendation:** add Ctrl+K as the primary key and keep Mod+Shift+P as an alias.
**Acceptance:** Ctrl+K opens the palette in each supported browser.

### UX-028 · P3 · VERIFIED · S · The platform styles ignore reduced motion; error toasts are announced politely

**Problem:** the platform stylesheet does not respect the reduced-motion setting, and error toasts share a polite live region with success toasts.
**Evidence:** `prefers-reduced-motion` appears only in `frontend/src/studio/styles/app.css:528` (search of the CSS under `frontend/src`); the toast container is `aria-live="polite"` for every tone (`frontend/src/components/ui.tsx:111`). Inline alerts are correct: `Alert` uses `role="alert"` for the "bad" tone (`ui.tsx:28`), so the publish refusal is announced.
**Recommendation:** put error toasts in an assertive region; add the reduced-motion rule to the platform CSS.
**Acceptance:** an error toast is announced as soon as it appears; animations stop under the reduced-motion setting.

### UX-029 · P3 · NOT VERIFIED · S · Notification content, restricted-role views and unrendered dialogs were not seen

**Problem:** several screens were read in code only, so their real behaviour is unknown.
**Evidence:** only the empty Notifications page was captured (`17-notifications.png`); the project-manager, reviewer and viewer variants, the submitted-review Release page, the waiver dialog and the import result are listed as "code only" in section 2.
**Recommendation:** seed review and release activity in a later pass and capture those screens.
**Acceptance:** every screen in section 2 marked "code only" has a capture that has been reviewed.
