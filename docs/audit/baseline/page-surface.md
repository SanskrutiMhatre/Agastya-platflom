# Page and component surface (baseline)

Captured 2026-11-27. `data-testid` values are the contract between the screens and the browser tests: a redesigned screen keeps the id on the equivalent control, or the test is changed on purpose with a recorded reason.

| File | Lines | Test ids |
|---|---|---|
| `components/ActivityView.tsx` | 86 | activity-feed, activity-people, activity-project, activity-projects |
| `components/CirPicker.tsx` | 56 | cir-pick-add, cir-pick-row |
| `components/DocCodes.tsx` | 119 | convert-findings, convert-go, convert-open, convert-run, export-project-archive (+1 computed) |
| `components/GraphicsView.tsx` | 117 | graphic, graphic-preview, graphics-list, graphics-pager (+1 computed) |
| `components/Icon.tsx` | 29 | - |
| `components/MissingBrex.tsx` | 36 | create-brex, missing-brex |
| `components/Oversight.tsx` | 92 | backup, project-status, status-row, team-row, team-table |
| `components/PageHeader.tsx` | 23 | - |
| `components/PublishRefusal.tsx` | 104 | publish-refusal, refusal-ask-editor, refusal-message, refusal-release-note, waiver-offer, waiver-reason, waiver-record, waiver-subjects |
| `components/ReviewReader.tsx` | 119 | moved-comments, pin-add, pin-text, pinned-comment, reader-block, review-reader |
| `components/SampleButton.tsx` | 24 |  (+1 computed) |
| `components/ThemeToggle.tsx` | 16 | theme-toggle |
| `components/lists.tsx` | 64 |  (+6 computed) |
| `components/pdf/LazyPdfViewer.tsx` | 35 | - |
| `components/pdf/PdfJsViewer.tsx` | 547 | - |
| `components/project.tsx` | 333 | import-as-findings, project-card, wiz-back, wiz-codes-selected, wiz-create, wiz-detected, wiz-domain, wiz-done, wiz-done-close, wiz-done-open, wiz-import-file, wiz-import-reasons, wiz-issue, wiz-manual-type, wiz-mic, wiz-name, wiz-next, wiz-preset, wiz-review, wiz-source, wiz-source-confirm, wiz-source-confirmed, wiz-source-problem, wiz-start-create, wiz-start-import (+3 computed) |
| `components/ui.tsx` | 148 | - |
| `layouts/AppShell.tsx` | 102 | account-menu, bell, unread-count |
| `layouts/ProjectShell.tsx` | 89 | - |
| `pages/Activity.tsx` | 59 | approvals-queue |
| `pages/AdminS1000d.tsx` | 242 | cat-add, cat-code, cat-edit-save, cat-issue, cat-row, cat-save, cat-source, cat-technical, cat-title, coverage, default-evidence, ext-admin, impact, preset-model, preset-new, preset-row, s1000d-catalogue, sns-presets |
| `pages/Administrator.tsx` | 308 | audit-export, config-add, config-row, config-save, licence, maintenance, platform-settings, roles, settings-save, visual-save, visual-settings (+4 computed) |
| `pages/AuthScreens.tsx` | 150 | - |
| `pages/BackupPage.tsx` | 25 | - |
| `pages/Cir.tsx` | 132 | cir-add, cir-copy, cir-create, cir-edit, cir-file, cir-list, cir-row, cir-submit, cir-use |
| `pages/Graphics.tsx` | 35 | graphics-project |
| `pages/Notifications.tsx` | 57 | mark-all-read, notification, notifications |
| `pages/Overview.tsx` | 146 | - |
| `pages/PreviewWindow.tsx` | 77 | popout-pdf, popout-run |
| `pages/Projects.tsx` | 87 | import-as-open, project-row |
| `pages/Settings.tsx` | 287 | new-author |
| `pages/Workspace.tsx` | 134 | - |
| `pages/project/AncillaryPage.tsx` | 187 | anc-field, anc-fields, anc-heading, anc-print, anc-reset, anc-row, anc-save, anc-xml, ancillary |
| `pages/project/AncillaryRoute.tsx` | 14 | - |
| `pages/project/DocExplorePage.tsx` | 176 | explore-chapter, explore-detail, explore-detail-code, explore-dm, explore-picture, explore-row, explore-search, explore-sub, explore-tree |
| `pages/project/DocPublicationPage.tsx` | 347 | add-chapter, appendices, build-publication, chapter, doc-codes-pmc, doc-codes-show-dmc, download-pdf, identity-save, plates, pub-appendix, pub-code, pub-identity, pub-locked, pub-module, pub-picture, pub-pictures, pub-plate, pub-tree, save-publication, undo-arrangement, unsaved-bar (+1 computed) |
| `pages/project/EditorPage.tsx` | 153 | editor-split, save-now, save-state, studio-host, toggle-side |
| `pages/project/EditorRoute.tsx` | 19 | - |
| `pages/project/ExplorePage.tsx` | 177 | explore-detail, explore-dm, explore-row, explore-tree |
| `pages/project/ExploreRoute.tsx` | 15 | - |
| `pages/project/GraphicsPage.tsx` | 78 | graphics-add, graphics-drop, graphics-file |
| `pages/project/JsgAncillaryPage.tsx` | 407 | jsg-anc-certificate, jsg-anc-cover, jsg-anc-editor, jsg-anc-lines, jsg-anc-paras, jsg-anc-photos, jsg-anc-preface, jsg-anc-preview, jsg-anc-print, jsg-anc-row, jsg-anc-rows, jsg-anc-save, jsg-ancillary |
| `pages/project/JsgEditorPage.tsx` | 256 | jsg-autosave, jsg-check, jsg-download, jsg-generate, jsg-host, jsg-import-word, jsg-note, jsg-save, jsg-split, jsg-state, jsg-word-input, pdf-pane |
| `pages/project/JssEditorPage.tsx` | 234 | jss-check, jss-download, jss-generate, jss-host, jss-note, jss-save, jss-split, jss-state, pdf-pane |
| `pages/project/ProjectSettingsPage.tsx` | 245 | assign-author, assign-manager, auto-add, export-card, header-logo, house-style, manual-type, page-furniture, side-publisher, side-text, team-members |
| `pages/project/PublicationPage.tsx` | 287 | add-chapter, build-publication, chapter, generate-anyway, pool-item, pub-module, pub-pool, pub-tree, save-publication, unsaved-bar |
| `pages/project/PublicationRoute.tsx` | 16 | - |
| `pages/project/PublishWaivers.tsx` | 54 | publish-waivers, waiver-list, waiver-remove, waiver-row |
| `pages/project/ReleasePage.tsx` | 205 | approve, comment-add, comment-text, download-pdf, pending-request, request-release, review-comment, review-reader-card, review-status, review-thread, send-back, send-back-reason, submit-card |
| `pages/project/S1000dConfig.tsx` | 327 | change-mic, codes-selected, mic-apply, mic-new, mic-plan, mic-preview, preset-apply, preset-select, s1000d-codes, s1000d-config, s1000d-identity, s1000d-save-codes, s1000d-save-identity, s1000d-sns, s1000d-types, sns-add, sns-code, sns-preset, sns-report, sns-row, sns-save, sns-title (+1 computed) |
| `pages/project/ValidationPage.tsx` | 157 | issue, issue-detail, issue-list, run-validation, validation-issue |
| `pages/project/editor/EditorSide.tsx` | 223 | chapter-node, cir-pick, collapse-side, dm-list, dm-row, import-anyway, import-keep-code, import-package, import-problems, import-raw, import-raw-input, import-recode, new-dm, unplaced-group, view-all, view-tree |
| `pages/project/editor/ImportAssignPanel.tsx` | 114 | assign-dest, assign-done, assign-error, assign-go, assign-newfolder, assign-panel, pool-empty, pool-group, pool-list, pool-row, pool-select-all, pool-ticked |
| `pages/project/editor/ImportPackageDialog.tsx` | 218 | goto-place, import-another, import-apply, import-choose, import-close, import-error, import-pkg-files, import-pkg-folder, import-pkg-zip, import-progress, import-scan, opt-neutralise, opt-overwrite, opt-publication, pick-files, pick-folder, pick-zip, report-stale, scan-cancel, selection, selection-clear, selection-summary, tab-import, tab-place |
| `pages/project/editor/ImportReportView.tsx` | 150 | finding-group, import-report, repair-rule, report-flavour, tile-files (+3 computed) |
| `pages/project/editor/ImportResultView.tsx` | 86 | import-result, res-changes, res-media, res-new, res-placeholders, res-pool, res-replaced, result-headline, result-publication |
| `pages/project/editor/PdfPane.tsx` | 184 | generate-anyway, generate-btn, pdf-pane, pdf-shown, popout-build, popout-quick, popped-note, quick-preview-btn |
| `pages/project/reused/PublishSettings.tsx` | 600 | - |

337 literal test ids in 58 files.
