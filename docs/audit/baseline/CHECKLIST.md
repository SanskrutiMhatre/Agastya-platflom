# Feature-preservation checklist, by screen group (WP-34)

This is the maintained form of report 16, section 5.4. **A redesign batch (WP-21, WP-22, WP-35) fills the rows of the groups it touches**, and the owner signs each group. A control with no new home blocks the batch.

How it fits with the machine check:

* `npm run check:parity` (in `frontend/`, also the `parity` stage of `scripts/ci/gate.mjs`) compares the code with `parity-baseline.json`. Any route, rail item, Studio command, key, `data-testid` or test that is gone fails, unless `parity-explanations.json` has a row for it. **Every row there must also appear here** (in the "New home" column of its group), so the reason is reviewed with the screen, not only in JSON.
* The "Source files" line of each group says which baseline items belong to it: the `testids` category lists the file of every id, the `routes` category the path, the `rail` category the kind.
* What the diff cannot see (behaviour, permissions, messages, results) is the manual walk-through in [`WALKTHROUGH.md`](WALKTHROUGH.md); its sign-off goes in the last column here.

* The "Guarding test" column was filled on 2026-11-27 from report 16 section 5.4 and a search of `frontend/e2e` for each test id; it is a starting point, not a proof. `parity-baseline.json` → `info.testidsWithoutBrowserTest` lists the 145 test ids that no browser spec mentions (regenerated with the baseline). A batch that touches one of those controls adds a guard or records the gap here.

Columns: **Old control** (what exists today, with its baseline key) · **New home** (where it is after the batch; "unchanged" is a valid answer) · **Guarding test** (what protects it today; "none" is listed as a gap) · **Sign-off** (who, date, walk-through done).

Screens the owner removed **before** the baseline are not present features and have no row: the Files (CSDB) page, the second SNS screen ("SNS defaults"), the Brand pack screen, the applicability UI (settings section, Configuration… beside Generate, the editor picker), the Codes strip and Codes button of the JSS/JSG editors, the PMC/ICN/contents switches. They are listed in `parity-baseline.json` under `removedByOwner`; the check fails if one of their old addresses becomes a page again or the test that guards their absence disappears.

---

## 1. Sign-in, setup, reset, onboarding, forced password change

Source files: `pages/AuthScreens.tsx`, `components/SessionDialogs.tsx`, `App.tsx` (session effects).

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| First-run setup (administrator account) | WP-35: same screen and fields; both password fields are the shared PasswordInput (Show/Hide with aria-pressed, Caps Lock notice); a mismatch is the Repeat field's own error (aria-invalid, focus moves there) instead of a banner; nothing is sent while they differ (UID-001, UID-002) | `00-platform.spec` first run (order dependent, GAP-007); backend `wp03-auth` | |
| Sign in, wrong password message, lockout | WP-35: same form; Password is a PasswordInput (`password-reveal`, `caps-lock`); the server's refusal names no field and stays in the banner; "Forgot your password?" is a real button styled as a link (was `<a href="#">`); the card's footnote says Offline · on-premises. `zz-core-routes.spec` now finds the two link-buttons by role button; new `wp35-redesign.spec` (reveal, Caps Lock) | backend `wp03-auth`, `rbac` | |
| Forgot password (reset by administrator approval) | WP-35: unchanged; "Back to sign in" is a button styled as a link | backend `wp04-reset-admin` | |
| Onboarding of an invited person, forced password change | WP-35: same fields; PasswordInput everywhere, mismatch on the Repeat field; Sign out is a button styled as a link. The forms' submit is the only non-`type=button` button (AuthScreens.test helper targets it) | `00-platform.spec` "a second person" | |
| Re-login dialog over the page (`reauth-dialog`, `reauth-password`, `reauth-submit`, `reauth-signout`) | WP-35: unchanged ids; the password is a PasswordInput (Show/Hide, Caps Lock) | `wp05-dataloss.spec` | |
| Server-unreachable banner (`server-unreachable`) | WP-22: unchanged id and place; it now also appears when a request fails to connect or gets 502/503/504 while signed in, clears on the next good answer, polls every 5 s and follows the browser offline/online events (UX-025) | none: no test uses the id (gap) | |
| Activity heartbeat and idle sign-out (no visible control) | | backend `wp03-auth` | |

## 2. Platform shell: overview, workspace, projects, activity, notifications

Source files: `layouts/AppShell.tsx`, `pages/Overview.tsx`, `pages/Workspace.tsx`, `pages/Projects.tsx`, `pages/Activity.tsx`, `pages/Notifications.tsx`, `components/ActivityView.tsx`, `components/Oversight.tsx`, `components/ThemeToggle.tsx`, `components/windowing.tsx`. Routes `/overview`, `/workspace`, `/projects`, `/activity [if canMonitor(user)]`, `/notifications`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Dashboard per role (overview) | WP-22: unchanged. The top bar gains "Jump to… Ctrl K" (`jump-open`, the quick switcher: pages, projects, data modules); an error inside a page is caught by an error panel (`error-boundary`, `error-retry`, `error-reload`, `error-copy`) instead of a blank screen. Sample buttons and the Overview/Workspace/Projects merge are NOT done (see the WP-22 log) WP-35: sections, split columns and the activity feed are classes, not inline styles; the three sample buttons are behind one Samples button (`samples-menu`, a disclosure; `create-sample`, `create-jsg-sample`, `create-jsg-ispl-sample` kept inside it) (UX-014). Sidebar: the same items, labels and order in three groups (no heading / Library / Manage) with an accent bar on the current page; CIR carries the tooltip "Common information repository"; the account menu names the person above Account settings / Sign out. Overview/Workspace/Projects are NOT merged (decision recorded in the WP-35 log) | `00-platform.spec` roles block | |
| Workspace and project lists, search and filters (`project-card`, `project-row`, `list-all`, `list-more`, `virtual-rows`) | WP-35: unchanged lists and ids; Samples button as on Overview; context menu (right-click, Menu key, Shift+F10) on a Projects row (Open, Copy project…) and on a Workspace folder heading (New project here, Folder access…, Rename folder…, Delete folder…): the same actions as the visible buttons, never only in the menu (UID-005). `00-platform.spec` and `jsg-editor.spec` open the Samples button before clicking a sample; `wp35-redesign.spec` (menu, keyboard) | `00-platform.spec`, `wp18-performance.spec` | |
| Activity page for monitors only (`activity-feed`, `activity-people`, `activity-project(s)`, `approvals-queue`) | WP-35: a long project title on an Activity card ends in an ellipsis and keeps clear of the Open button (UX-025 rest) | `00-platform.spec` roles | |
| Team and status oversight (`team-table`, `team-row`, `status-row`, `project-status`, `backup`) | | `00-platform.spec` | |
| Notification bell, unread count, feed, mark all read (`bell`, `unread-count`, `notifications`, `notification`, `mark-all-read`) | | `00-platform.spec` | |
| Account menu (`account-menu`), theme toggle and choice (`theme-toggle`, `theme-choice`) | WP-35: same items and keys; the menu also shows the person's name above the role. WP-35 second pass: the menu again shows only the role, not the person's name (the first pass added the name; 00-platform's owner rule forbids it) | `zz-theme-states.spec` | |
| Focus tooltip (`focus-tooltip`) | | `zz-theme-states.spec` | |

## 3. Create project, import a package, export or archive, convert, delete

Source files: `components/project.tsx` (wizard), `pages/Projects.tsx`, `components/DocCodes.tsx`, `pages/project/ProjectSettingsPage.tsx` (Danger tab), `pages/project/editor/ImportPackageDialog.tsx`, `ImportReportView.tsx`, `ImportResultView.tsx`, `ImportAssignPanel.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| New project wizard: start create / import, name, domain, manual type, source, MIC, issue, preset, codes, review, done (`wiz-*`, 25 ids) | WP-22: all ids kept; the model code and enterprise code fields show an example and the rule before input, and the wizard offers the model code last used in this browser (`wiz-mic-last`) (UX-024) | `s1000d-config.spec` (wizard), `jsg-editor.spec` (JSG offered), `zz-verify-wizard.spec` | |
| Import as a project with findings (`import-as-findings`, `import-as-open`, `wiz-import-file`, `wiz-import-reasons`, `wiz-detected`) | | `project-import-package.spec`, `zz-import-refusal.spec` | |
| Import a package into a project: files / folder / ZIP, scan, options, report, apply, place, assign (`import-*`, `pick-*`, `opt-*`, `selection*`, `tab-*`, `assign-*`, `pool-*`, `res-*`, `report-*`, `finding-group`, `repair-rule`, `tile-files`) | | `project-import-package.spec` | |
| Export project archive (`export-project-archive`, `export-card`) and archive import | | backend `project-archive`; no browser test uses the ids (gap) | |
| Convert between formats, six conversions (`convert-run`, `convert-go`, `convert-open`, `convert-findings`, `convert-to-*` computed) | | backend `xengine-convert` (no browser test: gap) | |
| Delete project (Danger tab) | | backend `wp06-lifecycle`, `lifecycle` | |

## 4. Project rail and badges

Source files: `layouts/ProjectShell.tsx`, `layouts/projectRail.ts`. Baseline category `rail` (23 items: S1000D 7, JSS 7, JSG 7, CIR 2).

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Editor, Explore, Publication, Graphics, Release, Settings (S1000D, JSS, JSG) | WP-22: all kept, same labels and order; a new first item Home (`/projects/:id/home`, not CIR); opening a project still lands in the Editor (owner rule, `00-platform.spec`). A pin at the foot of the rail (`rail-pin`) writes the labels out, remembered per browser. Every project page except the editor has a breadcrumb bar (`project-bar`, `project-bar-name`) with the project name and Jump to. Merging Explore/Publication into Structure and renaming Validation are deferred to WP-35 | `doc-pages.spec` (JSS/JSG rail), `00-platform.spec` (S1000D); `parity-dump.test.ts` per kind | |
| Ancillary pages (JSS, JSG only) | | `jss-editor.spec`, `jsg-editor.spec` | |
| Validation with error badge (S1000D only) | | `00-platform.spec` validation | |
| Release badge (`!` pending, `R<n>` released) | | `00-platform.spec` release | |
| CIR project: Editor and Graphics only, back link to the repository | | `00-platform.spec` CIR | |
| Missing BREX notice with Create (`missing-brex`, `create-brex`) | | `publish-gate.spec` | |

## 5. S1000D Studio

Source files: `studio/**`, `pages/project/EditorPage.tsx`, `pages/project/editor/EditorSide.tsx`, `pages/project/editor/PdfPane.tsx`. Baseline categories `commands` (113, from the run-time registry) and `keys` (`studio ...` accelerators and `handler studio/ui/app.ts ...`).

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Every command of the registry (File, Edit, Format, Structure, Insert, Table, Review, View, Tools), reachable from ribbon, File menu, context menu or palette | WP-21: unchanged. Inside the platform the ribbon folds to its tab strip by default; a click on a tab shows that tab's commands until one is used (Esc or a click elsewhere folds it again), the pin at the end of the tab strip, a double-click on a tab or Ctrl+F1 (new `view.ribbon`) keeps it open, and the choice is remembered. The palette is also on Ctrl+K and on the header's Commands button | `parity-dump.test.ts` (no command lost, ribbon ids valid, no key clash); 30+ unit files under `studio/` | |
| Every accelerator (`studio <key> -> <command>`) | WP-21: all kept; added Mod+K (palette), Mod+. (`view.focus`, the platform's focus mode), Mod+F1 (`view.ribbon`). F1 is also the header's shortcuts button | `parity-dump.test.ts`; walk-through item 7; `wp21-editor-chrome.spec` | |
| XML / Tags / Design / Split views, synchronised selection | | `zz-dmtypes.spec`, studio unit tests | |
| Find and replace, go to ID | | studio unit tests | |
| Validation (schema, BREX), live validation, problems pane, next/previous problem | WP-22: unchanged; the bottom problems pane is at most 25% of the window high (drag clamp 60% to 25%) and Escape inside it hides it | `zz-dmtypes.spec`, `publish-gate.spec` | |
| Drafts, recovery, conflict dialog | WP-21: unchanged; the refused-save dialog gains "Compare and merge…" (the host's ConflictDialog: per-change choice, schema+BREX check before the save) | `wp05-dataloss.spec`; `editors/host/merge.test.ts` | |
| Module list and tree, new module, CIR pick, side collapse (`dm-list`, `dm-row`, `chapter-node`, `new-dm`, `view-all`, `view-tree`, `toggle-side`, `collapse-side`, `cir-pick`) | WP-21: unchanged; `toggle-side` is the lead button of the shared editor header; the panel steps aside in focus mode | `00-platform.spec` | |
| Save state and Save now (`save-state`, `save-now`), split (`editor-split`) | WP-21: the shared header (`editor-header`); `save-state` is always shown (the host's words: All changes saved / Unsaved changes (n documents) / Saving… / Saved HH:MM), `save-now` beside it while something is unsaved; `editor-split` unchanged, Split/PDF in the shared "Editor layout" group (Editor = Write is the new default) | `wp05-dataloss.spec`, `wp21-editor-chrome.spec` | |
| Quick preview, Generate, pop-out windows (`quick-preview-btn`, `generate-btn`, `generate-anyway`, `popout-*`, `pdf-pane`, `pdf-shown`, `pdf-progress`, `pdf-cancel`) | WP-21: while the PDF pane is closed (Write) Quick preview and Generate sit in the header (`chrome-preview-slot`, same ids, drawn in one place at a time) and open the pane when pressed; in Split/PDF they are in the "PDF controls" toolbar as before; pop-out buttons stay in the pane | `zz-dmtypes.spec`, `publish-gate.spec`, `00-platform.spec` (Split first) | |

## 6. S1000D Explore and Publication

Source files: `pages/project/ExplorePage.tsx`, `pages/project/PublicationPage.tsx`, `pages/project/PublishWaivers.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Explore tree and detail (`explore-tree`, `explore-row`, `explore-dm`, `explore-detail`) | | `00-platform.spec` | |
| Publication: add chapter, place modules from the pool, drag and drop, save, unsaved bar, build (`add-chapter`, `pub-pool`, `pool-item`, `pub-tree`, `chapter`, `pub-module`, `save-publication`, `unsaved-bar`, `build-publication`, `generate-anyway`) | WP-35: unchanged ids; "save an empty publication?" and "replace the publication with an import?" are the application's dialog (`app-dialog`, `app-dialog-confirm`, `app-dialog-cancel`), the replace one in the danger tone (GAP-002). Page styles load with the page chunk (`styles/pages/structure.css`, unchanged rules) | `00-platform.spec` publication | |
| Waivers list and removal (`publish-waivers`, `waiver-*`) | WP-35: same list and ids; the long explanation folds into a disclosure; the visible line keeps "a waiver never covers a release request or approval" (`publish-waivers.spec` reads it in the card) | `publish-waivers.spec` | |
| Leave guard (`leave-stay`, `leave-discard`, `leave-save`) | | `doc-pages.spec` 13, `wp05-dataloss.spec` | |

## 7. JSS and JSG Explore and Publication

Source files: `pages/project/DocExplorePage.tsx`, `pages/project/DocPublicationPage.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Explore: hierarchy, table and pictures views, search, detail with code, open in editor (`explore-*`) | | `doc-pages.spec` 9, 10 | |
| Publication: arrange, rename, add and delete chapter, delete section, undo, save, identity, ICN names, appendices, plates, build, download (`pub-*`, `add-chapter`, `undo-arrangement`, `identity-save`, `appendices`, `plates`, `build-publication`, `download-pdf`) | WP-22: all kept; added: add a section to a chapter where the stencil allows it (`add-section`), add an appendix and delete one in a JSG handbook (`add-appendix`, `delete-appendix`), Redo beside Undo (`redo-arrangement`) (GAP-003) | `doc-pages.spec` 3-8, 12; `docPublication.test.ts` | |
| Code badge switches (`doc-codes-show-dmc`, `doc-codes-pmc`) | | `doc-pages.spec` 2 | |
| Leave guard | | `doc-pages.spec` 13, 14 | |

## 8. Validation

Source files: `pages/project/ValidationPage.tsx`, `components/PublishRefusal.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Run validation, findings by severity, detail, jump to the editor (`run-validation`, `issue-list`, `issue`, `issue-detail`, `validation-issue`) | WP-35 second pass: same controls and ids; filters on one bar (each severity chip shows its count; "n of m shown"), list beside a sticky detail panel, file group headings, the detail as a term list; reviewed findings carry a Reviewed badge besides the dimming. Data flow untouched (presentational only) | `00-platform.spec` validation | |
| Mark reviewed, CSV export | WP-22: same button (`issue-mark-reviewed`); the mark is now the team's, on the server (`/api/projects/:id/problems/reviewed`), shows who and when (`issue-reviewed-by`); reviewers and up may mark (`problems.review`), a viewer sees the button disabled; old browser marks are moved to the server once. CSV unchanged. WP-35 second pass: unchanged buttons and ids; `issue-reviewed-by` is now a <dd> of the detail list | `00-platform.spec`; `wp22-navigation.spec` (team marks seen by a second person); backend `wp22-problems` | |
| Publish refusal and waiver offer (`publish-refusal`, `refusal-*`, `waiver-offer`, `waiver-reason`, `waiver-record`, `waiver-subjects`) | | `publish-gate.spec`, `publish-waivers.spec` | |

## 9. Release and review

Source files: `pages/project/ReleasePage.tsx`, `components/ReviewReader.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Request, approve, send back with reason, resubmit (`request-release`, `pending-request`, `approve`, `send-back`, `send-back-reason`, `submit-card`) | WP-35: same cards and ids; the review task takes the wide column and the Watermark card the narrow one (audit 5.4 Release: reorder by task); watermark preview styles are classes | `00-platform.spec` release; backend `release-issue`, `rbac` (separation of duties) | |
| Review comments and threads (`review-*`, `comment-add`, `comment-text`) | WP-22: unchanged on the Release page; also in every editor: a Comments button in the editor header (`editor-comments`, count `editor-comments-open`), a side panel (`comments-panel`, `editor-comment`, `comment-prev`, `comment-next`, `comments-close`, `editor-comment-open`, `editor-comment-done`), Alt+Shift+N / Alt+Shift+P step through the open comments | `00-platform.spec` review | |
| Read-only reviewer reader with pinned comments (`review-reader`, `reader-block`, `pin-add`, `pin-text`, `pinned-comment`, `moved-comments`) | | `00-platform.spec` review | |
| Download released PDF (`download-pdf`), watermark | | `00-platform.spec` | |

## 10. Graphics

Source files: `pages/Graphics.tsx`, `pages/project/GraphicsPage.tsx`, `components/GraphicsView.tsx`. Routes `/graphics`, `/projects/:id/graphics`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| List per project and main list, pager, preview (`graphics-list`, `graphic`, `graphic-preview`, `graphics-pager`, `graphics-project`) | WP-35 second pass: same controls and ids; no inline styles (toolbar, tiles, list, pager, preview); the tile thumbnail shows the transparency checkerboard again; the zoom buttons carry a tooltip and a focus ring | `00-platform.spec` graphics | |
| Upload by file or drop, ICN names (`graphics-add`, `graphics-drop`, `graphics-file`) | WP-35 second pass: unchanged; drop zone laid out with classes | `00-platform.spec` graphics | |
| Delete a graphic | WP-35 second pass: unchanged | `00-platform.spec` graphics | |

## 11. CIR repository

Source files: `pages/Cir.tsx`, `components/CirPicker.tsx`. Route `/cir`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Create a common data module with the wizard, list, edit, file, submit (`cir-create`, `cir-list`, `cir-row`, `cir-edit`, `cir-file`, `cir-submit`, `cir-add`) | WP-35: same; replacing data modules already in the repository is asked in the application's dialog (danger tone) instead of the browser's confirm | `00-platform.spec` CIR | |
| Copy into a project, use (`cir-copy`, `cir-use`, `cir-pick-row`, `cir-pick-add`) | | `00-platform.spec` CIR | |

## 12. Ancillary pages (JSS / JSG)

Source files: `pages/project/AncillaryPage.tsx`, `pages/project/JsgAncillaryPage.tsx`. Route `/projects/:id/ancillary`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| JSS: cover, front matter, checklist, amendments, preface fields, print, reset, save, XML (`anc-*`, `ancillary`) | | `jss-editor.spec` | |
| JSG: cover, certificate, preface, photos, lines, paragraphs, rows, preview, print, save (`jsg-anc-*`, `jsg-ancillary`) | WP-35: same; "Reload the saved handbook?" after a refused save is the application's dialog | `jsg-editor.spec` (ISPL ancillary); JSG Cover form unstyled (UX-018) | |

## 13. JSS editor

Source files: `jss/**`, `pages/project/JssEditorPage.tsx`. Baseline keys `jss ...` (registry `lib/editorShortcuts.ts`) and `handler jss/...`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Stencil outline, add chapter, paper, source view, problems (`jss-editor`, `jss-paper`, `jss-source`, `jss-problems`, `jss-add-chapter`) | WP-22: unchanged; the problems list is at most 25% of the window high and closes with Escape | `jss-editor.spec` (12), `jss/*.test.ts` | |
| Save, check, generate PDF, download, split, state (`jss-save`, `jss-check`, `jss-generate`, `jss-download`, `jss-split`, `jss-state`, `jss-note`) | WP-21: the shared editor header (`editor-header`, DocEditorShell) carries Check, Save, packages, Convert, Export project and Generate PDF with the same ids; `jss-state` uses the host's words; `jss-split`, `jss-host`, `jss-download`, `jss-note` are drawn by the host (`editors/host/testIds.ts`); Generate opens the PDF pane. WP-35 second pass: the shared header's title and comments panel lose inline styles; header/focus/comments CSS loads with the editor chunk; every id kept | `jss-editor.spec`, `wp21-editor-chrome.spec` | |
| Package import and export (`jss-import`, `jss-import-file`, `jss-import-confirm`, `jss-export`, `jss-package-findings`) | | backend `jssdm`, `jssdm-http`; no browser test uses the ids (gap) | |
| Drafts and conflict (`draft-*`, `conflict-*`, `jss-conflict`) | WP-21: the host's banners (useDocEditor), same ids; the conflict banner adds `conflict-compare` (Compare and merge…) | `wp05-dataloss.spec`, `wp21-editor-chrome.spec` | |
| Every key of the JSS registry (Mod+S/Z/Y, Tab, Shift+Tab, Enter, Shift+Enter, Backspace, arrows, dialog Enter/Escape) | WP-21: all kept in `jss/editor.ts`; the host adds Ctrl+K / Ctrl+Shift+P (palette), F1 (shortcuts dialog), Ctrl+. (focus), Ctrl+F / Ctrl+H (find), Esc (`host.*` in the registry). WP-22: Mod+S saves wherever the focus is on the page (it used to need the focus inside the paper: Esc then Ctrl+S did nothing); Escape in the problems list; host Alt+Shift+N/P (comments) | `editorShortcuts.test.ts`, `jss/editor.test.ts`, `wp21-editor-chrome.spec` | |
| No find or replace exists (UX-017): not a feature to preserve, a gap | WP-21: closed. The host's find bar (`host-find`, `find-input`, `replace-input`, `replace-one`, `replace-all`) over the paper's editable text, one undo step per replace | `wp21-editor-chrome.spec` | |

## 14. JSG editors

Source files: `jsg/**`, `pages/project/JsgEditorPage.tsx`. Baseline keys `jsg ...`, `jsg-ispl ...` and `handler jsg/...`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Handbook editor: sheet, find and replace bar, status (`jsg-sheet`, `jsg-find`, `jsg-status`) | WP-35: same; "− Last chapter" asks in the application's dialog, naming the chapter (GAP-002) | `jsg-editor.spec` (11), `jsg/*.test.ts` | |
| ISPL plates and parts, preview toggle (`jsg-preview`, `jsg-preview-toggle`) | WP-35: same; Delete plate, Delete appendix and Remove view (only view) ask in the application's dialog with the exact consequence ("removes plate I-A with its 2 views and 14 parts"); the two Paste rows prompts are the application's dialog with a multi-line box (`app-dialog-input`) and the column order as the hint. `jsg-editor.spec` fills the dialog instead of accepting a browser prompt; `wp35-redesign.spec` (Delete plate: message, Cancel keeps, focus on Cancel) | `jsg-editor.spec` | |
| Save, autosave, check, generate, download, Word import, split (`jsg-save`, `jsg-autosave`, `jsg-check`, `jsg-generate`, `jsg-download`, `jsg-import-word`, `jsg-word-input`, `jsg-split`, `jsg-state`, `jsg-note`) | WP-21: the shared editor header (DocEditorShell) with the same ids; the Word import's browser confirm became a ConfirmModal "Replace this handbook?" (GAP-002 in passing); `jsg-state` uses the host's words; Generate opens the PDF pane. WP-35 second pass: the autosave switch on a class (same label, title and id) | `jsg-editor.spec`, `wp21-editor-chrome.spec`; backend `jsg-word`, `jsg-engine` | |
| Drafts and conflict (`draft-*`, `conflict-*`, `jsg-conflict`) | WP-21: the host's banners, same ids, plus `conflict-compare` | `wp05-dataloss.spec` | |
| Every key of the JSG registry (Mod+S/F/H/Z/Y, Escape, Enter/Shift+Enter in the find box and in text) | WP-21: all kept (Ctrl+F/H stay the JSG editor's own find bar); the host adds Ctrl+K / Ctrl+Shift+P, F1, Ctrl+., Esc. WP-22: host Alt+Shift+N/P (comments) | `editorShortcuts.test.ts`, `wp21-editor-chrome.spec` | |

## 15. Project settings and S1000D settings

Source files: `pages/project/ProjectSettingsPage.tsx`, `pages/project/S1000dConfig.tsx`. Routes under `/projects/:id/settings/`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| General: manual type, house style, page furniture, side text, header logo, auto-add (`manual-type`, `house-style`, `page-furniture`, `side-text`, `side-publisher`, `header-logo`, `auto-add`) | | `00-platform.spec` | |
| Publishing (the reused publishing screen) | | `00-platform.spec`; backend `package-settings` | |
| S1000D: identity, MIC change plan, information codes, types, SNS editing and presets (`s1000d-*`, `mic-*`, `change-mic`, `codes-selected`, `preset-*`, `sns-*`) | | `s1000d-config.spec` | |
| Team: members, assign manager and author (`team-members`, `assign-manager`, `assign-author`) | | `00-platform.spec` roles | |
| Project activity (managers only: `/projects/:id/settings/activity [if manages]`) | | `00-platform.spec` | |
| Danger: export card, delete (`export-card`) | | backend `wp06-lifecycle` | |

## 16. Main settings, backup

Source files: `pages/Settings.tsx`, `pages/BackupPage.tsx`. Routes `/settings/*`, `/backup`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Account, password, appearance/theme (`appearance`) | WP-35: same; the three password fields are PasswordInputs; a mismatch is the Repeat field's error with focus (`wp35-redesign.spec`) | `00-platform.spec`, `zz-theme-states.spec` | |
| Backup of own projects (`backup-scope`) | | none by id (gap); backend backup tests | |
| Authors (managers: `/settings/authors [if isManager]`, `new-author`) | | `00-platform.spec` roles | |
| Users, approvals, sessions, audit (administrators: `/settings/users|approvals|sessions|audit [if isAdmin]`) | WP-22: unchanged; the audit log adds filters by user (`audit-who`) and day (`audit-day`) and shows an IPv4 address without its `::ffff:` wrapper (UX-025). WP-35 second pass: Users and Audit logs on the administrator classes (no inline styles); every filter, export, Verify chain and id kept | `00-platform.spec` administrator; backend `wp03-auth` | |

## 17. Administrator

Source files: `pages/Administrator.tsx`, `pages/AdminS1000d.tsx`. Routes under `/administrator/` (admins only).

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Users and roles (`roles`) | WP-35 second pass: the section navigation is a card with an accent bar on the current section; Roles, Users, Groups and Directory sign-on (WP-27) on the shared section heading; every control and id kept | `00-platform.spec` administrator | |
| Reference data tables, eleven collections (`config-row`, `config-add`, `config-save`) | WP-35 second pass: same table, filter, add/edit/delete (icon buttons with tooltips); classes instead of inline styles | `00-platform.spec` administrator | |
| S1000D catalogue, SNS presets, extensions, coverage (`s1000d-catalogue`, `cat-*`, `sns-presets`, `preset-*`, `ext-admin`, `coverage`, `default-evidence`, `impact`) | WP-35 second pass: same controls; Edit/Delete icon buttons now carry tooltips (UID-003); classes instead of inline styles | `s1000d-config.spec` 4 | |
| JSS and JSG manual types and stencils (`format-jss`, `format-jsg`) | WP-35 second pass: unchanged | `00-platform.spec` | |
| Audit logs with export (`audit-export`) | WP-35 second pass: WP-29's viewer (filters by action, person, project and dates, CSV/JSON Lines export, Verify chain) restyled only; ids kept | `00-platform.spec`; backend audit tests | |
| Security policy: idle, absolute, password minimum, single session, separation of duties (`security-policy`, `sec-*`) | WP-35 second pass: unchanged fields and ids; classes instead of inline styles | backend `wp03-auth` | |
| Maintenance, visual settings with accent preview, platform settings, licence (`maintenance`, `visual-settings`, `visual-save`, `accent-*`, `platform-settings`, `settings-save`, `licence`) | WP-35 second pass: maintenance cards put the action at the foot; platform backups (Delete has a tooltip) and the accent colour input on classes; ids kept | `00-platform.spec` administrator | |

## 18. Preview windows, PDF viewer

Source files: `pages/PreviewWindow.tsx`, `components/pdf/*`. Route `/preview/:id/:mode`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Quick preview and Generate windows, synchronised (`popout-run`, `popout-pdf`) | | `00-platform.spec` | |
| PDF viewer: page input (Enter), search (Enter), zoom, dark-theme viewer | WP-35 second pass: the glyph buttons (outline, previous/next page, zoom out/in, previous/next match, outline twisty) have names and tooltips (UID-003); pdf.js text-layer CSS loads with the viewer chunk | `00-platform.spec` | |

---

## Batch log

One line per redesign batch: which groups, the parity report (`verification-results/ci/<run>/parity.md`), the before and after test results (one table, WP-34 acceptance), the owner's sign-off.

| Batch | Groups | Parity report | Before / after tests | Owner sign-off |
|---|---|---|---|---|
| WP-22 (2026-11-27) | 1, 2, 3, 4, 5, 7, 8, 9, 13, 14, 16 | `check:parity` PASS, nothing removed | e2e `wp22-navigation.spec` 7/7; visual/a11y suite (6 baselines updated: light+dark publication, validation, release) | |
| WP-35 (2026-11-27, branch `wp35-redesign`) | 1, 2, 3, 6, 9, 11, 12, 14, 16 | `check:parity` PASS, nothing removed (only additions); baseline re-captured with `parity:update` | before (e6f486c): visual/a11y run with the WP-35 changes 48 passed / 19 failed (the layout-class clash, then intended pictures); after: visual/a11y/keyboard 67 passed, 7 skipped (keyboard spec's own dark-theme skip); e2e `wp35-redesign` 4/4, `jsg-editor` 11/11, `wp05-dataloss` 10/10, `zz-core-routes` 5/5; 15 baselines updated (light+dark administrator, overview, projects, publication, release, sign-in, workspace; light settings) | pending |
| WP-35 second pass (2026-11-27) | 2, 8, 10, 13, 14, 16, 17, 18 | `check:parity` PASS, nothing removed (no explanation row) | vitest 33 files; visual/a11y 61 passed + 6 re-baselined; e2e alone: 00-platform 41/41, others listed in IMPLEMENTATION-LOG | |
| WP-36 cleanup (2026-11-28) | none (dead code only) | `check:parity` PASS, nothing removed (no explanation row); new `check:cleanup` PASS | after: vitest 50 files 887 passed; visual/a11y 67 passed, 7 skipped, no baseline changed; e2e 00-platform 41/41, zz-core-routes + doc-pages + wp35-redesign + wp22-navigation 30/30 | |
| | | | | |
