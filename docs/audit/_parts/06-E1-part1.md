# 06 · UI/UX audit and workflow redesign proposal

Auditor: E1 (finding prefix `UX`) · Date: 2026-11-26 · Scope: the whole Agastya user interface (platform shell, project pages, the three embedded editors, wizards, dialogs) and the UX/workflow redesign. Colour tokens, theming and mockups are agent E2's and are deliberately absent here.

## 1. Scope and method

This audit combines reading the UI code with looking at the running product.

1. **Code.** I read the route table and shells (`frontend/src/App.tsx`, `layouts/AppShell.tsx`, `layouts/ProjectShell.tsx`), the shared primitives (`components/ui.tsx`, `styles/platform.css`), every page under `frontend/src/pages` that is listed in section 4, the three editors (`src/studio`, `src/jss`, `src/jsg`) at the level of layout, commands, keyboard handling and save logic, and the Playwright responsive spec (`frontend/e2e/zz-responsive-layout.spec.ts`).
2. **Running product.** I built the frontend into a scratch folder (`vite build --outDir <scratch>`), booted a scratch backend on port 4056 with a scratch workspace (no real workspace, no ports 4040/4041), created an administrator through the real first-run screen, then seeded an author, a project manager and six projects through the API: an S1000D sample, an empty S1000D project, two JSG samples (user handbook, illustrated spare parts list) and two JSS projects (Land user handbook, Naval TM-1).
3. **Capture and measurement.** Playwright with the Edge channel, headless. About 140 screenshots at 1366x768, 1920x1080, 820x1100 and 390x780, each looked at; `getBoundingClientRect` measurements of the editing surface; Tab-order and focus probes; horizontal-overflow probes at 390, 820, 1024, 1280 and 1366 px; one measured timing of the editor opening.

Evidence labels used throughout: **VERIFIED** (reproduced in the running instance or measured, or a plain fact in the code), **OBSERVED** (seen in a screenshot or in code but not measured or exercised end to end), **SUSPECTED**, **RECOMMENDATION** (a proposal, not a defect), **NOT VERIFIED** (not checked). Sizes: S under a day, M a few days, L one to three weeks, XL more.

## 2. Coverage

| Area | Status | What was done | Limits |
|---|---|---|---|
| Setup, login, login error, forgot-password | Inspected | Screenshots, flow driven, code read | Forced password change and onboarding gate: code only |
| App shell, sidebar, top bar, account menu, notifications | Inspected | Screenshots, keyboard probe (14 Tab stops), code | Notification list with real entries not seen (empty only) |
| Overview (author, administrator) | Inspected | Screenshots at 1366 and 390 | Project-manager variant: code only |
| Workspace, Projects, Graphics, CIR, Backup | Inspected | Screenshots at 1366; overflow probes 1024-1366; narrow shots | Graphics and CIR with content: code only |
| Activity, Settings (account, approvals, sessions) | Inspected | Screenshots, code | |
| Administrator (users, roles, catalogue, SNS, DM types, cages, maintenance, visual, audit log) | Partially inspected | Screenshots of nine sections, code of the page | Language/country/classification/interface-language/PDF-customisation, templates, partner/originator companies, DDN, Advanced, JSS manual types: code only |
| New-project wizard (5 steps, import step) | Inspected | Screenshots of each step, error state, Escape and Tab behaviour | |
| Project: Explore, Publication, Graphics, Validation, Release, Settings | Inspected | Screenshots (S1000D, JSS, JSG); code | Validation with findings, Release with a submitted review and comments, waiver dialog: code only |
| S1000D Studio (ribbon, Design/Tags/Split/XML views, panes, palette, shortcuts, find/replace, element picker, File menu, new-DM dialog, Settings dialog, malformed-XML dialog, validation) | Inspected | Screenshots, DOM measurements | Right-click context menu: capture failed, not seen. Dialogs not listed here: code only |
| JSS editor (Land, Naval), JSS ancillary, JSS publication/graphics/release/settings | Inspected | Screenshots at both sizes | Editing interaction depth (tables, cross-references): not exercised |
| JSG editors (user handbook, spare parts list), JSG ancillary | Inspected | Screenshots at both sizes | Large-document typing latency not measured |
| PDF pane, pop-out preview window, PDF viewer controls | Partially inspected | Empty state and toolbar seen | A generated PDF was not displayed in the pane; pop-out not opened |
| Import-package dialog, Import PM, waiver and refusal dialogs | Partially inspected | Code read | Not rendered |
| Dark theme | Not inspected | | Belongs to E2 |
| Screen reader, Windows High Contrast, touch, real users | Not inspected | | No assistive technology available; see section 11 |
| Chrome stable | Not inspected | | The tab crashed in this environment (UX-011); Edge used throughout |

## 3. Current UI assessment

**Honest summary.** The platform shell is calm, consistent and well written. A new author can find the project list, create a project and reach an editor without help; the copy explains itself ("Everything about this project that is not authoring", the refusal and waiver text, the offline reminder). The S1000D Studio is a serious editor with a unified command registry and live validation. The weaknesses are structural rather than cosmetic: the editing area is cramped by default, the three editors behave as three products, a project has no home page, problems and review comments are spread over several places, and the basics of keyboard and landmark accessibility are missing. A few plain defects (a dead JSS Publication page, a primary button pushed off-screen) are cheap to fix and visible to everyone.

**What the UI gets right today (strengths).**

1. **One command registry** (`frontend/src/studio/ui/commands.ts:3`): every ribbon button, menu item, palette entry and shortcut maps to one command, with a command palette (Mod+Shift+P) and a shortcuts dialog.
2. **Plain, specific microcopy.** Errors and empty states say what to do. The publish-gate refusal and waiver text (`components/PublishRefusal.tsx`) explains what a waiver covers and, just as important, what it does not.
3. **Role-aware UI.** Read-only roles get an explanation instead of dead buttons (for example the Validation page notice for viewers).
4. **Publication page drag and drop with button alternatives** (`pages/project/PublicationPage.tsx:165`, row buttons for up, down, remove), plus an Undo.
5. **A real review loop on Validation**: filter by severity and check, group by file, open at the exact line, mark reviewed, export CSV (`pages/project/ValidationPage.tsx`).
6. **Anchored review comments** that keep the words they were made on and move to "Moved or changed" if the text changes (`components/ReviewReader.tsx:1-4`). OBSERVED from code; not rendered in this audit.
7. **Careful failure handling in Studio**: a malformed-XML dialog offering "Go to error" or "Discard XML changes" (screenshot `62-s1k-problems.png`), recovery drafts on by default (Studio Settings dialog), `beforeunload` guards in all three editors (`studio/ui/app.ts:427`, `JssEditorPage.tsx:161`, `JsgEditorPage.tsx:179`).
8. **Live save state in the header** of every editor ("All changes saved", "Unsaved changes").
9. **Visible focus**: all 14 focusable elements tried in the shell had a 2 px outline (VERIFIED, Tab probe).
10. **Persisted layout choices** (editor view, split width, list width, pane visibility) in `localStorage` keys `agastya.editor.*`, `agastya.jss.view`, `studio.layout`.
11. **Fast editor start in the scratch run**: editor shell ready in about 1.0 s, first data module open in about 0.5 s (one measurement, small sample project, Edge).
12. **Graphics view built for volume**: paging, kind and usage filters, sort, grid/list, usage list in the preview (`components/GraphicsView.tsx`).

## 4. UX weaknesses, ranked

Ranking weighs how often an author, reviewer, publisher or administrator meets the problem, how much work or trust it costs, and how cheap the fix is. Finding IDs refer to section 12.

| Rank | Weakness | Who feels it | Finding |
|---|---|---|---|
| 1 | The editing surface is small by default and shrinks further with panes: 29% of a 1366x768 screen in the default Split view, 24% with Studio panes open | Authors, all day | UX-002 |
| 2 | Three editors with three toolbars, three save vocabularies, different find/replace and palette support | Authors on mixed projects, trainers | UX-003 |
| 3 | A project has no home; status is scattered over Editor, Validation, Publication, Release and Settings behind a 56 px icon-only rail | Authors, PMs | UX-007 |
| 4 | Five separate problem surfaces; "reviewed" marks live in one browser only | Authors, reviewers | UX-008 |
| 5 | Review comments appear only on the Release page, not where the author fixes things | Authors, PMs | UX-009 |
| 6 | No focus trap in dialogs; no skip link or `main` landmark; partial keyboard operation of menus and clickable rows | Keyboard and assistive-technology users, accessibility procurement | UX-004, UX-005 |
| 7 | The primary "New project" button is off-screen on Projects at 1366 px and below | Every author | UX-006 |
| 8 | JSS Publication shows "Internal error" | Every JSS user | UX-001 |
| 9 | JSS has no autosave or draft recovery; JSG autosave is opt-in | JSS/JSG authors of long documents | UX-010 |
| 10 | Duplicate views of the same tree and the same lists (Explore, Publication, DM panel; Overview, Workspace, Projects) | New users | UX-013, UX-014 |
| 11 | Narrow windows: JSS/JSG editor pages scroll sideways below about 1100 px | Authors with snapped windows | UX-020 |
| 12 | Raw codes and layout slips in visible places (activity feed code, unstyled JSG cover form, broken PDF placeholder text) | Everyone | UX-015, UX-016, UX-018 |
