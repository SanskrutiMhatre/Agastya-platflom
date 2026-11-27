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
| First-run setup (administrator account) | | `00-platform.spec` first run (order dependent, GAP-007); backend `wp03-auth` | |
| Sign in, wrong password message, lockout | | backend `wp03-auth`, `rbac` | |
| Forgot password (reset by administrator approval) | | backend `wp04-reset-admin` | |
| Onboarding of an invited person, forced password change | | `00-platform.spec` "a second person" | |
| Re-login dialog over the page (`reauth-dialog`, `reauth-password`, `reauth-submit`, `reauth-signout`) | | `wp05-dataloss.spec` | |
| Server-unreachable banner (`server-unreachable`) | | none: no test uses the id (gap) | |
| Activity heartbeat and idle sign-out (no visible control) | | backend `wp03-auth` | |

## 2. Platform shell: overview, workspace, projects, activity, notifications

Source files: `layouts/AppShell.tsx`, `pages/Overview.tsx`, `pages/Workspace.tsx`, `pages/Projects.tsx`, `pages/Activity.tsx`, `pages/Notifications.tsx`, `components/ActivityView.tsx`, `components/Oversight.tsx`, `components/ThemeToggle.tsx`, `components/windowing.tsx`. Routes `/overview`, `/workspace`, `/projects`, `/activity [if canMonitor(user)]`, `/notifications`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Dashboard per role (overview) | | `00-platform.spec` roles block | |
| Workspace and project lists, search and filters (`project-card`, `project-row`, `list-all`, `list-more`, `virtual-rows`) | | `00-platform.spec`, `wp18-performance.spec` | |
| Activity page for monitors only (`activity-feed`, `activity-people`, `activity-project(s)`, `approvals-queue`) | | `00-platform.spec` roles | |
| Team and status oversight (`team-table`, `team-row`, `status-row`, `project-status`, `backup`) | | `00-platform.spec` | |
| Notification bell, unread count, feed, mark all read (`bell`, `unread-count`, `notifications`, `notification`, `mark-all-read`) | | `00-platform.spec` | |
| Account menu (`account-menu`), theme toggle and choice (`theme-toggle`, `theme-choice`) | | `zz-theme-states.spec` | |
| Focus tooltip (`focus-tooltip`) | | `zz-theme-states.spec` | |

## 3. Create project, import a package, export or archive, convert, delete

Source files: `components/project.tsx` (wizard), `pages/Projects.tsx`, `components/DocCodes.tsx`, `pages/project/ProjectSettingsPage.tsx` (Danger tab), `pages/project/editor/ImportPackageDialog.tsx`, `ImportReportView.tsx`, `ImportResultView.tsx`, `ImportAssignPanel.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| New project wizard: start create / import, name, domain, manual type, source, MIC, issue, preset, codes, review, done (`wiz-*`, 25 ids) | | `s1000d-config.spec` (wizard), `jsg-editor.spec` (JSG offered), `zz-verify-wizard.spec` | |
| Import as a project with findings (`import-as-findings`, `import-as-open`, `wiz-import-file`, `wiz-import-reasons`, `wiz-detected`) | | `project-import-package.spec`, `zz-import-refusal.spec` | |
| Import a package into a project: files / folder / ZIP, scan, options, report, apply, place, assign (`import-*`, `pick-*`, `opt-*`, `selection*`, `tab-*`, `assign-*`, `pool-*`, `res-*`, `report-*`, `finding-group`, `repair-rule`, `tile-files`) | | `project-import-package.spec` | |
| Export project archive (`export-project-archive`, `export-card`) and archive import | | backend `project-archive`; no browser test uses the ids (gap) | |
| Convert between formats, six conversions (`convert-run`, `convert-go`, `convert-open`, `convert-findings`, `convert-to-*` computed) | | backend `xengine-convert` (no browser test: gap) | |
| Delete project (Danger tab) | | backend `wp06-lifecycle`, `lifecycle` | |

## 4. Project rail and badges

Source files: `layouts/ProjectShell.tsx`, `layouts/projectRail.ts`. Baseline category `rail` (23 items: S1000D 7, JSS 7, JSG 7, CIR 2).

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Editor, Explore, Publication, Graphics, Release, Settings (S1000D, JSS, JSG) | | `doc-pages.spec` (JSS/JSG rail), `00-platform.spec` (S1000D); `parity-dump.test.ts` per kind | |
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
| Validation (schema, BREX), live validation, problems pane, next/previous problem | | `zz-dmtypes.spec`, `publish-gate.spec` | |
| Drafts, recovery, conflict dialog | WP-21: unchanged; the refused-save dialog gains "Compare and merge…" (the host's ConflictDialog: per-change choice, schema+BREX check before the save) | `wp05-dataloss.spec`; `editors/host/merge.test.ts` | |
| Module list and tree, new module, CIR pick, side collapse (`dm-list`, `dm-row`, `chapter-node`, `new-dm`, `view-all`, `view-tree`, `toggle-side`, `collapse-side`, `cir-pick`) | WP-21: unchanged; `toggle-side` is the lead button of the shared editor header; the panel steps aside in focus mode | `00-platform.spec` | |
| Save state and Save now (`save-state`, `save-now`), split (`editor-split`) | WP-21: the shared header (`editor-header`); `save-state` is always shown (the host's words: All changes saved / Unsaved changes (n documents) / Saving… / Saved HH:MM), `save-now` beside it while something is unsaved; `editor-split` unchanged, Split/PDF in the shared "Editor layout" group (Editor = Write is the new default) | `wp05-dataloss.spec`, `wp21-editor-chrome.spec` | |
| Quick preview, Generate, pop-out windows (`quick-preview-btn`, `generate-btn`, `generate-anyway`, `popout-*`, `pdf-pane`, `pdf-shown`, `pdf-progress`, `pdf-cancel`) | WP-21: while the PDF pane is closed (Write) Quick preview and Generate sit in the header (`chrome-preview-slot`, same ids, drawn in one place at a time) and open the pane when pressed; in Split/PDF they are in the "PDF controls" toolbar as before; pop-out buttons stay in the pane | `zz-dmtypes.spec`, `publish-gate.spec`, `00-platform.spec` (Split first) | |

## 6. S1000D Explore and Publication

Source files: `pages/project/ExplorePage.tsx`, `pages/project/PublicationPage.tsx`, `pages/project/PublishWaivers.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Explore tree and detail (`explore-tree`, `explore-row`, `explore-dm`, `explore-detail`) | | `00-platform.spec` | |
| Publication: add chapter, place modules from the pool, drag and drop, save, unsaved bar, build (`add-chapter`, `pub-pool`, `pool-item`, `pub-tree`, `chapter`, `pub-module`, `save-publication`, `unsaved-bar`, `build-publication`, `generate-anyway`) | | `00-platform.spec` publication | |
| Waivers list and removal (`publish-waivers`, `waiver-*`) | | `publish-waivers.spec` | |
| Leave guard (`leave-stay`, `leave-discard`, `leave-save`) | | `doc-pages.spec` 13, `wp05-dataloss.spec` | |

## 7. JSS and JSG Explore and Publication

Source files: `pages/project/DocExplorePage.tsx`, `pages/project/DocPublicationPage.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Explore: hierarchy, table and pictures views, search, detail with code, open in editor (`explore-*`) | | `doc-pages.spec` 9, 10 | |
| Publication: arrange, rename, add and delete chapter, delete section, undo, save, identity, ICN names, appendices, plates, build, download (`pub-*`, `add-chapter`, `undo-arrangement`, `identity-save`, `appendices`, `plates`, `build-publication`, `download-pdf`) | | `doc-pages.spec` 3-8, 12; `docPublication.test.ts` | |
| Code badge switches (`doc-codes-show-dmc`, `doc-codes-pmc`) | | `doc-pages.spec` 2 | |
| Leave guard | | `doc-pages.spec` 13, 14 | |

## 8. Validation

Source files: `pages/project/ValidationPage.tsx`, `components/PublishRefusal.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Run validation, findings by severity, detail, jump to the editor (`run-validation`, `issue-list`, `issue`, `issue-detail`, `validation-issue`) | | `00-platform.spec` validation | |
| Mark reviewed, CSV export | | `00-platform.spec` (reviewed marks are browser-only, FE-015) | |
| Publish refusal and waiver offer (`publish-refusal`, `refusal-*`, `waiver-offer`, `waiver-reason`, `waiver-record`, `waiver-subjects`) | | `publish-gate.spec`, `publish-waivers.spec` | |

## 9. Release and review

Source files: `pages/project/ReleasePage.tsx`, `components/ReviewReader.tsx`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Request, approve, send back with reason, resubmit (`request-release`, `pending-request`, `approve`, `send-back`, `send-back-reason`, `submit-card`) | | `00-platform.spec` release; backend `release-issue`, `rbac` (separation of duties) | |
| Review comments and threads (`review-*`, `comment-add`, `comment-text`) | | `00-platform.spec` review | |
| Read-only reviewer reader with pinned comments (`review-reader`, `reader-block`, `pin-add`, `pin-text`, `pinned-comment`, `moved-comments`) | | `00-platform.spec` review | |
| Download released PDF (`download-pdf`), watermark | | `00-platform.spec` | |

## 10. Graphics

Source files: `pages/Graphics.tsx`, `pages/project/GraphicsPage.tsx`, `components/GraphicsView.tsx`. Routes `/graphics`, `/projects/:id/graphics`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| List per project and main list, pager, preview (`graphics-list`, `graphic`, `graphic-preview`, `graphics-pager`, `graphics-project`) | | `00-platform.spec` graphics | |
| Upload by file or drop, ICN names (`graphics-add`, `graphics-drop`, `graphics-file`) | | `00-platform.spec` graphics | |
| Delete a graphic | | `00-platform.spec` graphics | |

## 11. CIR repository

Source files: `pages/Cir.tsx`, `components/CirPicker.tsx`. Route `/cir`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Create a common data module with the wizard, list, edit, file, submit (`cir-create`, `cir-list`, `cir-row`, `cir-edit`, `cir-file`, `cir-submit`, `cir-add`) | | `00-platform.spec` CIR | |
| Copy into a project, use (`cir-copy`, `cir-use`, `cir-pick-row`, `cir-pick-add`) | | `00-platform.spec` CIR | |

## 12. Ancillary pages (JSS / JSG)

Source files: `pages/project/AncillaryPage.tsx`, `pages/project/JsgAncillaryPage.tsx`. Route `/projects/:id/ancillary`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| JSS: cover, front matter, checklist, amendments, preface fields, print, reset, save, XML (`anc-*`, `ancillary`) | | `jss-editor.spec` | |
| JSG: cover, certificate, preface, photos, lines, paragraphs, rows, preview, print, save (`jsg-anc-*`, `jsg-ancillary`) | | `jsg-editor.spec` (ISPL ancillary); JSG Cover form unstyled (UX-018) | |

## 13. JSS editor

Source files: `jss/**`, `pages/project/JssEditorPage.tsx`. Baseline keys `jss ...` (registry `lib/editorShortcuts.ts`) and `handler jss/...`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Stencil outline, add chapter, paper, source view, problems (`jss-editor`, `jss-paper`, `jss-source`, `jss-problems`, `jss-add-chapter`) | | `jss-editor.spec` (12), `jss/*.test.ts` | |
| Save, check, generate PDF, download, split, state (`jss-save`, `jss-check`, `jss-generate`, `jss-download`, `jss-split`, `jss-state`, `jss-note`) | WP-21: the shared editor header (`editor-header`, DocEditorShell) carries Check, Save, packages, Convert, Export project and Generate PDF with the same ids; `jss-state` uses the host's words; `jss-split`, `jss-host`, `jss-download`, `jss-note` are drawn by the host (`editors/host/testIds.ts`); Generate opens the PDF pane | `jss-editor.spec`, `wp21-editor-chrome.spec` | |
| Package import and export (`jss-import`, `jss-import-file`, `jss-import-confirm`, `jss-export`, `jss-package-findings`) | | backend `jssdm`, `jssdm-http`; no browser test uses the ids (gap) | |
| Drafts and conflict (`draft-*`, `conflict-*`, `jss-conflict`) | WP-21: the host's banners (useDocEditor), same ids; the conflict banner adds `conflict-compare` (Compare and merge…) | `wp05-dataloss.spec`, `wp21-editor-chrome.spec` | |
| Every key of the JSS registry (Mod+S/Z/Y, Tab, Shift+Tab, Enter, Shift+Enter, Backspace, arrows, dialog Enter/Escape) | WP-21: all kept in `jss/editor.ts`; the host adds Ctrl+K / Ctrl+Shift+P (palette), F1 (shortcuts dialog), Ctrl+. (focus), Ctrl+F / Ctrl+H (find), Esc (`host.*` in the registry) | `editorShortcuts.test.ts`, `jss/editor.test.ts`, `wp21-editor-chrome.spec` | |
| No find or replace exists (UX-017): not a feature to preserve, a gap | WP-21: closed. The host's find bar (`host-find`, `find-input`, `replace-input`, `replace-one`, `replace-all`) over the paper's editable text, one undo step per replace | `wp21-editor-chrome.spec` | |

## 14. JSG editors

Source files: `jsg/**`, `pages/project/JsgEditorPage.tsx`. Baseline keys `jsg ...`, `jsg-ispl ...` and `handler jsg/...`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Handbook editor: sheet, find and replace bar, status (`jsg-sheet`, `jsg-find`, `jsg-status`) | | `jsg-editor.spec` (11), `jsg/*.test.ts` | |
| ISPL plates and parts, preview toggle (`jsg-preview`, `jsg-preview-toggle`) | | `jsg-editor.spec` | |
| Save, autosave, check, generate, download, Word import, split (`jsg-save`, `jsg-autosave`, `jsg-check`, `jsg-generate`, `jsg-download`, `jsg-import-word`, `jsg-word-input`, `jsg-split`, `jsg-state`, `jsg-note`) | WP-21: the shared editor header (DocEditorShell) with the same ids; the Word import's browser confirm became a ConfirmModal "Replace this handbook?" (GAP-002 in passing); `jsg-state` uses the host's words; Generate opens the PDF pane | `jsg-editor.spec`, `wp21-editor-chrome.spec`; backend `jsg-word`, `jsg-engine` | |
| Drafts and conflict (`draft-*`, `conflict-*`, `jsg-conflict`) | WP-21: the host's banners, same ids, plus `conflict-compare` | `wp05-dataloss.spec` | |
| Every key of the JSG registry (Mod+S/F/H/Z/Y, Escape, Enter/Shift+Enter in the find box and in text) | WP-21: all kept (Ctrl+F/H stay the JSG editor's own find bar); the host adds Ctrl+K / Ctrl+Shift+P, F1, Ctrl+., Esc | `editorShortcuts.test.ts`, `wp21-editor-chrome.spec` | |

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
| Account, password, appearance/theme (`appearance`) | | `00-platform.spec`, `zz-theme-states.spec` | |
| Backup of own projects (`backup-scope`) | | none by id (gap); backend backup tests | |
| Authors (managers: `/settings/authors [if isManager]`, `new-author`) | | `00-platform.spec` roles | |
| Users, approvals, sessions, audit (administrators: `/settings/users|approvals|sessions|audit [if isAdmin]`) | | `00-platform.spec` administrator; backend `wp03-auth` | |

## 17. Administrator

Source files: `pages/Administrator.tsx`, `pages/AdminS1000d.tsx`. Routes under `/administrator/` (admins only).

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Users and roles (`roles`) | | `00-platform.spec` administrator | |
| Reference data tables, eleven collections (`config-row`, `config-add`, `config-save`) | | `00-platform.spec` administrator | |
| S1000D catalogue, SNS presets, extensions, coverage (`s1000d-catalogue`, `cat-*`, `sns-presets`, `preset-*`, `ext-admin`, `coverage`, `default-evidence`, `impact`) | | `s1000d-config.spec` 4 | |
| JSS and JSG manual types and stencils (`format-jss`, `format-jsg`) | | `00-platform.spec` | |
| Audit logs with export (`audit-export`) | | `00-platform.spec`; backend audit tests | |
| Security policy: idle, absolute, password minimum, single session, separation of duties (`security-policy`, `sec-*`) | | backend `wp03-auth` | |
| Maintenance, visual settings with accent preview, platform settings, licence (`maintenance`, `visual-settings`, `visual-save`, `accent-*`, `platform-settings`, `settings-save`, `licence`) | | `00-platform.spec` administrator | |

## 18. Preview windows, PDF viewer

Source files: `pages/PreviewWindow.tsx`, `components/pdf/*`. Route `/preview/:id/:mode`.

| Old control | New home | Guarding test | Sign-off |
|---|---|---|---|
| Quick preview and Generate windows, synchronised (`popout-run`, `popout-pdf`) | | `00-platform.spec` | |
| PDF viewer: page input (Enter), search (Enter), zoom, dark-theme viewer | | `00-platform.spec` | |

---

## Batch log

One line per redesign batch: which groups, the parity report (`verification-results/ci/<run>/parity.md`), the before and after test results (one table, WP-34 acceptance), the owner's sign-off.

| Batch | Groups | Parity report | Before / after tests | Owner sign-off |
|---|---|---|---|---|
| | | | | |
