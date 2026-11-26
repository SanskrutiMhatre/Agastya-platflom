## 5. Screen-by-screen gap analysis

Priority is the priority of the recommendation (P1 fix soon, P2 plan, P3 when convenient). A "screenshot" reference names a file in the auditor's scratch folder; it is evidence, not a deliverable. Evidence labels as in section 1; a row with no label is VERIFIED from a screenshot or the code named.

### 5.1 Sign-in, setup and onboarding

| Screen | What is there | Problems | Recommendation | Pri |
|---|---|---|---|---|
| First-run setup (`00-setup.png`) | Card: full name, username (rule shown), password and repeat (rule shown), "Create administrator". States "nothing ships with a default" | No show/hide password. Nothing says what happens next; the administrator lands on an empty Overview | Add a reveal toggle. After setup show a short first-run checklist (originator company, language and country defaults, first user, first project) | P3 |
| Sign in and error (`04`, `05`) | Username, password, "Forgot your password?". Error "Invalid username or password." | Tagline reads "Offline, on-premises S1000D authoring and publishing." (`AuthScreens.tsx:68`) although JSS and JSG are first-class (UX-026) | Name all three document families | P3 |
| Reset password (`06-forgot.png`) | Honest offline copy: approval by an administrator, "Ask an administrator" | The sign-in error stays on screen after switching to this view (UX-023). "Back to sign in" and "Forgot" are `<a href="#">` used as buttons (`AuthScreens.tsx:63,73,117,139`) | Clear errors on mode change; render these as buttons styled as links | P2 |
| Forced password change, onboarding gate | New account chooses its own username and password (`AuthScreens.tsx:100-139`) | Code only. Same `<a href="#">` for Sign out | As above | P3 |
| Session loss by newer sign-in | Audit log records `auth.session.displaced` on every sign-in (`99-admin-audit.png`) | What the displaced user sees is NOT VERIFIED (UX-022) | Show a clear "You were signed out because this account signed in elsewhere" screen | P2 |

### 5.2 Platform shell and main dashboard

| Screen | What is there | Problems | Recommendation | Pri |
|---|---|---|---|---|
| Shell: sidebar and top bar (`AppShell.tsx`) | 224 px sidebar with seven to nine role-filtered items, 52 px top bar with page title, theme toggle, bell, account menu; "Offline · on-premises" footer | The top-bar title repeats the page header directly below it on every page ("Administrator" twice, `90`, `91`): 52 px spent on nothing. No breadcrumb, no search or quick switcher. No skip link, no `main` landmark (UX-005) | Replace the title with breadcrumb plus quick switcher (Ctrl+K); add landmarks | P1 |
| Account menu | Account settings, Sign out | `role="menu"` but arrow-key navigation and focus return not implemented (`AppShell.tsx:87-91`) | Roving focus or drop the menu role | P2 |
| Overview (author, `10`) | Greeting; four count tiles; Recent projects cards; Recent activity feed | Three sample-project buttons beside "New project" (UX-014). Activity feed shows `auth.session.displaced` (UX-015). Tiles are counts, not actions: nothing says what needs the author's attention | "Continue" card for the last document; "Needs you" list (review comments, failed validation); move samples to an empty-state or Help | P1 |
| Overview (administrator, `90`) | Six tiles, filterable project table, People table, activity | Project table rows have no keyboard target (`Oversight.tsx:47`, UX-005). People table repeats every project name in one tall cell | Row link; show a count with a popover | P2 |
| Workspace (`11`) | Folders as sections, project cards (`role="link"`, keyboard reachable), filter, New folder | Folder actions are three icon buttons (members, rename, delete) with tooltips only. Same projects as Overview and Projects (UX-014) | Fold into one Home with views (section 6) | P2 |
| Projects (`12`) | Table: search, sort, Back up, Import package, three sample buttons, New project; per-row Copy | "New project" is pushed off-screen at 1366 px and below (UX-006). The row opens a project on click only: after New project, Tab reaches only the Copy buttons (UX-005). Backup button here, on Overview, on Backup, in Settings | Wrap the toolbar, keep one primary action; make the name a link; one Backup entry | P1 |
| Graphics (library) | Read-only graphics across projects (shares `GraphicsView`) | Code only for content states | None beyond UX-020 | P3 |
| CIR (`14`) | Empty state, Upload and Create data module, filter | "CIR" is unexplained in the sidebar (the page title spells it out) | Tooltip or label "Shared modules (CIR)" | P3 |
| Backup (`15`) | One card: "Back up my projects", ZIP | Says nothing about restoring (import lives on Projects). A fourth place for the same action | Add "To restore, use Import package" with a link; keep a single entry point | P2 |
| Activity (administrator, project manager; `99c`) | Range select, four tiles, release requests waiting, tabs Projects/People/Activity feed | A long project title runs under the Open button on cards (UX-025) | Truncate with ellipsis, reserve the button column | P3 |
| Notifications (`17`) | All/Unread, Mark all as read; empty state | Only the empty state was seen; click-through behaviour NOT VERIFIED (UX-029) | Entries must deep-link to the file and line | P2 |
| Settings (`16`) | Tabs Account and Backup; profile; change password; Sign out | Sign out sits below the fold at 768 px high | Move Sign out to the account menu only | P3 |
| Administrator (`91`-`99`) | Left sub-navigation of about 20 entries in four groups plus an "Advanced" fold; Users table (role select, Reset password, Disable); catalogues with filter and tabs (`93`); numbering presets (`94`); audit log (`99`) | Three levels of navigation inside one page. Users has no search or bulk action. SNS: the "Choose a preset to see its entries" hint sits far below a long table. Audit log: no user or date filter, raw `::ffff:127.0.0.1` (UX-025) | Make the sub-navigation a searchable list; add filters; show IPv4 cleanly | P2 |

### 5.3 Create and import

| Screen | What is there | Problems | Recommendation | Pri |
|---|---|---|---|---|
| New-project wizard (`20`-`26`) | Five steps (start, project, model and identity, and so on), Back/Next, error state, an import branch | Model code starts empty with no example and no inline rule; "Responsible partner company" is a bare 5-character code plus name (UX-024). Escape closed the whole wizard at once (`25-wiz-after-esc.png`); by code a click on the backdrop does too, because this dialog is not `sticky` (`components/project.tsx:206`, `ui.tsx:58-64`), and nothing asks before discarding (UX-004). No focus trap | Persist a draft while the dialog is open; ask before discarding; pre-fill from the last project | P2 |
| Import package dialog (`ImportPackageDialog.tsx`) | Progress in a `role="status"` region | Code only | Keep; verify the result summary links to the first failing file | P3 |

### 5.4 Inside a project (S1000D)

| Screen | What is there | Problems | Recommendation | Pri |
|---|---|---|---|---|
| Project rail (`ProjectShell.tsx`) | 56 px icon-only rail: back, project tile, Editor, Explore, Publication, Graphics, Validation (badge), Release (badge), Settings. CSS tooltips (`data-tip`) plus `aria-label` | No project home. The project name appears only in a tooltip and on some pages: it is absent from Validation, Release and Settings headers (`35`, `36`, `37`). Icons alone for eight destinations | Add Project Home; show the name and a label rail (pinnable) (UX-007) | P1 |
| Editor page header (`EditorPage.tsx:118-134`) | DM-panel toggle, project name, breadcrumb of the open file, save state or "Save (n)", Editor / Split / PDF | Below ~900 px the ribbon groups run beyond the right edge (UX-020). The persisted view makes the first impression Split with a 29% editing area (UX-002) | Default to Editor with a one-click preview; see section 7 | P1 |
| DM panel (`EditorSide.tsx`) | Publication / All tree, search, New, five icon-only buttons (import, problems, package, library, refresh) | Five icon-only buttons; the Publication/All switch is clipped to "Publica" at 248 px (`31`) | Labelled menu "More"; widen the switch | P2 |
| Studio ribbon and views (`30`-`53`) | File, Home, Insert, Review, View, Tools tabs; Design, Tags, Split, XML; Outline, Attributes/Elements, Problems panes (closed by default); status bar with word count, S1000D issue, validity | Ribbon is 131 px tall and labels are clipped at 1366 and even 1920 px with the DM panel open: "Delete elemen", "Select element / parent" (`hd-s1k-split.png`, UX-012). Studio Settings repeats a Theme control already on the platform bar (`55`) | Collapsible ribbon; overflow menu; one theme control | P2 |
| Command palette, shortcuts (`44`, `45`) | Palette lists File and Edit commands with shortcuts | Commands only: no project navigation (Validation, Release), no file jump (UX-021). Mod+Shift+P may collide with a browser's private-window key (UX-027) | Add navigation and file commands; bind Ctrl+K as well | P2 |
| Find and replace (`46`) | Find, Replace, Go to ID; scopes (all, content, element) | Searches the open data module only | Project-wide search (section 7.5) | P2 |
| Malformed XML dialog (`62`) | "XML is not well-formed", Go to error, Discard XML changes, banner in the view | A good pattern; keep | Reuse in JSS/JSG | |
| Explore (`32`) | Tree with expand/collapse, search, Hierarchy/All toggle, five tiles, side panel "Select a data module" | The same tree as Publication and the DM panel (UX-013); the side panel is empty until a click | Merge into one Structure page | P2 |
| Publication (`33`) | Tiles, chapters with drag handles and up/down/remove buttons, unplaced pool, Output (View in editor, Export PM, Import PM), Build publication, Publish waivers card | Long waiver paragraph competes with the structure; page is S1000D-only and dead for JSS (UX-001) | Collapse waivers into a disclosure; hide for JSS | P1 |
| Project Graphics | Drop zone, `GraphicsView` with delete | None beyond narrow widths | | P3 |
| Validation (`35`) | Issue selector, Include BREX, Run validation; after a run: filters, findings by file, detail panel, Open at line, Mark reviewed, CSV | Needs a manual run although the editor validates live. "Reviewed" lives in `localStorage` (`ValidationPage.tsx:23`). Row `role="button"` handles Enter only, not Space (`:118`) (UX-008, UX-005) | One problems model shared by editor and page; store reviewed server-side | P1 |
| Release (`36`) | Status tiles, Download PDF (NOT RELEASED), Submit for review with note and delayed-effect option, Review comments, Watermark card | Watermark settings occupy as much space as Submit. Comments appear only here (UX-009). Reviewer is always "the Project Manager" | Reorder by task; surface open comments elsewhere | P1 |
| Waiver and refusal UI (`PublishRefusal.tsx`) | Findings list, Build drafts without this BREX, reason (10 to REASON_MAX characters), what a waiver does not cover | Code only (not rendered). Strong copy | Keep. The refusal is an `Alert` with `role="alert"` (`ui.tsx:28`) | P3 |
| Project settings (`37`) | Tabs General, S1000D, Publishing, Team, Activity, Danger zone; tiles for members, type, your access | Folder is a free-text field, not a picker. PDF layout checkboxes sit in General next to a separate Publishing tab | Picker; group by task | P3 |

### 5.5 JSS and JSG

| Screen | What is there | Problems | Recommendation | Pri |
|---|---|---|---|---|
| JSS editor (`70`, `71`, `hd-jss`) | Own header: state badge, Check, Save, Import project, Export, Codes, Convert, Generate PDF, Editor/Split/PDF; ribbon Write/Insert/Arrange/Document with ARIA tabs; outline; findings strip "Problems: 0 errors, 52 warnings" | Two Export buttons (UX-019). No find or replace, no palette; only Ctrl+S/Z/Y (`jss/editor.ts:162`) (UX-017). No autosave (UX-010). Header "PDF" segment beyond the right edge at 1280 px (UX-006); sideways scroll below ~1100 px (UX-020) | Bring onto the shared editor shell (section 7) | P1 |
| JSS Publication (`73`) | A rail item | Ends in "Internal error" (UX-001) | Hide the item or build a JSS build page | P1 |
| JSS Ancillary, Graphics, Release, Settings (`72`, `74`-`76`) | Same shells as S1000D | None beyond shell issues | | P3 |
| JSG editors (`80`, `82`, `hd-jsg`) | Toolbar Import Word, Auto-save (opt-in), Check, Save, Codes, Convert, Export, Generate PDF; Write/Insert/Table/Arrange/Document; Find and Replace; outline with chapters and appendices; status bar counts (47,447 words in the sample) | Header "PDF" segment beyond the right edge at 1366 px, "Split" and "PDF" at 1280 (UX-006). Opt-in autosave stored per browser (`JsgEditorPage.tsx:43`). Cover and ancillary information is "edited elsewhere": a banner inside the document says so | Merge ancillary pages into the document tree | P2 |
| JSG ancillary (`81`) | Checklist in print order, form per page | The Cover form is unstyled: labels and inputs flow inline, two-line lists in raw buttons (UX-018) | Use the standard `Field` layout | P2 |
