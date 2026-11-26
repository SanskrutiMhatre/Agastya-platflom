# 08 - Dark / light theme strategy (agent E2)

**Scope and method.** This report covers how light and dark themes work in the Agastya platform today, which surfaces are not at parity, and what to build so that the two themes stay equivalent: a semantic token mapping with side-by-side values, a parity matrix, an interaction-state table per component, and an automated validation plan (lint, coverage, contrast, visual regression, component tests, a test matrix). It is a concept and sketch document: **nothing in the repository was changed or implemented**; the scripts mentioned live in my scratch folder and were run read-only against `frontend/src` and `docs/audit/mockups/`. The design system itself (typography, spacing, density, component standards, migration) is in [07-DESIGN-SYSTEM-PROPOSAL.md](07-DESIGN-SYSTEM-PROPOSAL.md); screen-level UX is in [06-UI-UX-AUDIT.md](06-UI-UX-AUDIT.md) (agent E1); test-suite structure is in [11-TESTING-AND-QA-STRATEGY.md](11-TESTING-AND-QA-STRATEGY.md) (agent G), whose sections 10.7 (accessibility) and 10.8 (light/dark visual regression) this plan complements.

Method: source reading of the theme mechanics; a computed-style contrast sweep (Edge 158, 1366x768, both themes, 17 routes and 13 editor states) against a scratch server on port 4057 with seeded sample data; targeted behaviour probes (theme controls, administrator accent, disabled controls); a static contrast check of every token pair (`E2/check-tokens.mjs`, 109 pairs x 2 themes, 0 failures for the proposed set; for the current definitions 108 pairs give 15 failing pairs plus 4 decorative card-rule pairs, `E2/current-contrast.md`); and a read-only lint and token-coverage run over `frontend/src`. Evidence labels follow the common brief (VERIFIED, OBSERVED, SUSPECTED, NOT VERIFIED, RECOMMENDATION).

## 1. Coverage

| Area / path | Status | Verification | Limits |
|---|---|---|---|
| Theme mechanics: `index.html`, `main.tsx`, `store/ui.ts`, `store/appSettings.ts`, `components/ThemeToggle.tsx`, `lib/studioSession.ts`, `studio/ui/{app,commands,dialogs}.ts` | Inspected | read; behaviour exercised on the scratch server | server-side persistence of per-user theme: none found, NOT searched in the database layer |
| Token definitions: `studio/styles/app.css`, `document.css`, `styles/platform.css` | Inspected | read; coverage script; static contrast | - |
| Platform routes (17) and Studio/JSS/JSG states (13), light and dark | Inspected | computed-style sweep, `E2/sweep.json`, `E2/states.json`, screenshots in `E2/shots/` | seeded sample data only; hover/press states by static check; no text over images |
| JSG and JSS injected CSS (`jsg/shared.ts`, `jsg/ispl-*.ts`, `jss/style.ts`) | Partially inspected | CSS read; dark rendering swept | editing logic not read |
| pdf.js viewer, Release page, Review reader | Partially inspected | inline colours read; viewer and release page rendered in both themes | `ReviewReader` not rendered |
| Login, first-run setup, `PreviewWindow` | Not inspected | - | not rendered in either theme |
| PDF output (pdfmake and FOP) | Not inspected | colour literals counted only | print output is a paper rendering, out of theme scope |
| Forced colors, `prefers-contrast`, screen readers | Not inspected | no rule exists; probe not run | no Windows High Contrast session available |
| Web research | Inspected | sources in 07 section 4 | several by search snippet, marked there |

## 2. Executive summary

Theming works mechanically: one attribute, one pre-paint script, OS following. It fails on **governance**. Nothing guarantees that a colour added today has a dark value, passes contrast, or avoids a literal; the numbers show the result.

- 7 distinct contrast failures measured at runtime in the real screens (6 in dark, 1 in light) and 15 failing pairs in the current token definitions (TH-002), including 2.35:1 on the selected JSG tab and 2.72:1 on its outline headings, next to white tabs and buttons on the dark toolbar (TH-001).
- The administrator accent is applied identically to both themes and is not checked: `#ffcc00` gives 1.51:1 button text in light, `#1d3a8a` gives 1.77:1 in dark (TH-003).
- Three theme controls exist, one of them (Studio Settings) is a visible no-op that shows the wrong value; the toggle cannot return to "system" (TH-004).
- 336 colour literals outside any token file, 14 never-used and 1 undefined variable, and one colour (`--info`) that is defined for light only (TH-005, coverage run).
- Paper, canvas and viewer policy is inconsistent: the pdf.js viewer is always dark with hard-coded hex values, the release-page watermark preview is hard-coded white (TH-007).
- No forced-colors or prefers-contrast support, no automated theme test of any kind (TH-006, TH-009).

The proposal fixes the mechanism's gaps (three-way control that includes System, a validated accent pipeline, a defined paper policy) and, more importantly, makes parity enforceable by script: a token source verified in both themes, a lint that bans literals, a coverage check, and per-theme screenshot baselines. Section 7 is the plan; section 6 lists what each component must look like in every state.

### Strengths

- One mechanism: `<html data-theme>`; an inline script applies the stored or OS choice before first paint (`index.html:9-12`), so there is no light flash for dark users; the OS preference is followed live while the choice is System (`main.tsx:13`).
- `color-scheme` is declared in the HTML (`index.html:6`) and per theme (`app.css:45,82`), so native scrollbars, form controls and the autofill style follow the theme.
- The Studio observes `data-theme` and re-themes CodeMirror (`studioSession.ts:119`); the platform owns the switch when the Studio is embedded (`studio/ui/app.ts:60-62,368`); the XML syntax colours are variables.
- The existing layout spec already runs every route in both `colorScheme`s (`frontend/e2e/zz-responsive-layout.spec.ts`), so the harness for the visual tests exists.
- The JSS editor's own CSS is almost entirely token-based and keeps the print sheet white by design (`jss/style.ts`).
- The dark palette is a considered one (blue-grey surfaces, not pure black, a lighter accent), not an inversion; the problems are in the details listed below.

## 3. Current-state theme audit

### 3.1 How it works today

| Mechanism | What it does | Evidence |
|---|---|---|
| Attribute | `document.documentElement.dataset.theme` is `'dark'` or `'light'`; CSS selectors `:root[data-theme='dark']` | `store/ui.ts:10-13`, `app.css:47` |
| Choice | `ThemeChoice = 'system' \| 'light' \| 'dark'` in `localStorage['agastya.theme']`; System means the key is absent | `store/ui.ts:3-8,28-31` |
| First paint | inline script sets `dark` when stored `dark`, or when nothing is stored and the OS prefers dark | `index.html:9-12` |
| OS changes | media-query listener re-applies while the choice is System | `main.tsx:13` |
| Administrator default | applied only after login, only when no stored choice exists | `store/appSettings.ts:11-20` |
| Administrator accent | one hex written to `--accent` and `--accent-soft` (`+ '26'`) on `<html>`, for both themes; `--accent-strong` and `--accent-text` untouched | `appSettings.ts:14`; `app.css:7-10,49-52` |
| Embedded Studio | the platform owns the theme; the Studio re-themes CodeMirror through a `MutationObserver` | `studioSession.ts:63-64,119`; `studio/ui/app.ts:60-62,368` |
| Studio standalone setting | `settings.theme` (`system/light/dark`) with its own copy of the apply function | `studio/ui/app.ts:363-389`, `dialogs.ts:1146,1160,1174` |
| Token files | `app.css:4-83` (light/dark), `document.css:4-41` (`.design-scroll` scope), `platform.css:193-204` (`--x-*` compat) | 07 DS-001 |

### 3.2 Measured results (computed styles, Edge 158, both themes)

| Check | Result | Evidence |
|---|---|---|
| Platform routes, light | 17 routes, 0 failures | `E2/sweep.json` |
| Platform routes, dark | 2 failures: segmented-control count `4.29:1` on the selected segment; Release hint over a hard-coded white box `3.23:1` | `sweep.json` (`overview`, `release`) |
| Editor states, light | 13 states; split XML view: 96 text nodes at `3.85:1` (all `<` and `>` brackets, `--xml-bracket #7a8294`) | `E2/states.json` |
| Editor states, dark | DM row meta on the active row `4.29:1`; ribbon `Live validation` `4.20:1`; `.jsg-nav h4` "Outline" `2.72:1`; `.jsg-tab.on` "Insert" `2.35:1` (dark-theme accent text on the legacy light-blue hover fill `#e8f0fe`); several states repeat the DM row | `states.json` |
| Static token pairs (current files) | light: `--warning` text 4.08 / on soft 3.75, caution label 3.40, bracket 3.85, faint on hover 4.37, input border 1.66; dark: faint on hover and selected 4.21 / 4.29, accent on pressed 4.20, white on success toast 2.07, white on rail badge 2.70, `--sel` on page 2.44, input border 1.58 | `E2/current-contrast.md` |
| Disabled controls | `.btn`, `.btn-primary`, `.input`, `.v2-input` computed styles identical to enabled | `E2/probe-components.json` (07 DS-002) |
| Theme controls | Studio Settings "Theme" shows "system" whatever the platform theme is; saving it changes only a stored value, not `data-theme` (light to dark: select shows dark, `data-theme` stays light) | `E2/lead-checks.json`, `shots/lead-after-settings-save-*.png` |
| Accent override | `#ffcc00` accepted by the API (200); `#1d3a8a` accepted; primary button text 1.51:1 (light) and 1.77:1 (dark) | `E2/probe-accent.json` |
| Literals | 336 literals outside token files (lint run); 14 defined-never-used and 1 used-undefined variable; `--info` defined for light only | section 7.1-7.2 |

### 3.3 Where the dark theme is a re-skin, not a design

1. **The JSG editor keeps its legacy light stylesheet.** `jsg/shared.ts:51-90` declares white buttons (`:60`), a light-blue hover fill (`:61`) and `#5a6572` headings (`:53`); the token-based rules at `:95-130` (for example `.jsg-tab`, specificity 0,1,0) lose to the legacy `.jsg-bar button` rules (0,1,1 and, for hover, 0,3,1), so in dark the unselected tabs and the "+ Chapter" buttons stay white, the hovered selected tab "Insert" is accent text on light blue (2.35:1) and the outline headings are 2.72:1 (TH-001).
2. **Faint text is a single value used on four surface states.** `--text-faint` is legible on the panel but falls under 4.5:1 on hover, selected and pressed surfaces in both themes (TH-002).
3. **A solid status colour with white text was chosen in light and reused in dark** (`.v2-toast.success`, `.v2-rail-badge`): 2.07:1 and 2.70:1 in dark (TH-002).
4. **The accent is one hex for both themes** (TH-003).
5. **Document-view colours** (`--sel`, `--note-c`) are defined for light and partly forgotten in the dark block of `document.css` (TH-005).
6. **Viewer and paper**: the pdf.js viewer paints its own dark canvas with 19 hex values regardless of theme; the Release watermark preview is hard-coded white; the Studio page follows the theme while the JSS and JSG sheets stay white (TH-007).

## 4. The semantic token mapping (light and dark, side by side)

The values below are the proposal as implemented in `docs/audit/mockups/tokens.css`; every row is checked by `E2/check-tokens.mjs` in both themes against the pairs it participates in (109 pairs, text 4.5:1, UI 3:1; 0 failures). The column "Replaces" shows the current variable that the legacy alias block maps onto the new token. "(new)" means no current equivalent.

Design rules behind the values:

- **Surfaces step lighter in dark** (`canvas #111419` < `panel #171b22` < `raised #1e232c`); light uses white panels on a grey canvas. Raised is white in light (it separates by border and shadow) and lighter in dark (it separates by tone).
- **Two selection tokens plus hover**: `surface-selected` for a focused list, `surface-selected-inactive` for an unfocused one, `surface-selected-hover` for the hover over a selected row.
- **Status colours come as a family** (text, subtle fill, border, solid) because the same hue needs a different luminance on each theme: text on subtle fill is at least 4.5:1 in both.
- **`text-tertiary` is the former "faint"**, raised until it passes 4.5:1 on every surface it can sit on (panel, hover, selected, pressed).
- **`border-control` is the 3:1 border** (WCAG 1.4.11) for inputs and checkboxes; `border-default` and `border-subtle` are decorative.
- **`paper*` tokens are the same in both themes on purpose**; `viewer-canvas` is the themed surface around the pages.

| Token | Light | Dark | Replaces (current variable) | Role |
|---|---|---|---|---|
| **Surfaces** | | | | |
| `surface-canvas` | `#f3f5f8` | `#111419` | `--bg` | app background behind panels and document pages |
| `surface-panel` | `#ffffff` | `#171b22` | `--bg-elev` `--x-surface` `--x-white` | sidebars, cards, tables, editors (level 1) |
| `surface-raised` | `#ffffff` | `#1e232c` | (new) | menus, popovers, dialogs, command palette (level 2) |
| `surface-inset` | `#eceff4` | `#0d1015` | `--bg-sunken` `--x-surface-alt` | wells: input fields, code gutters, table headers, search boxes |
| `surface-chrome` | `#eaeef4` | `#0e1116` | (new) | activity bar, status bar, title bar |
| `surface-hover` | `#e9edf3` | `#222833` | `--bg-hover` | row / button hover |
| `surface-pressed` | `#dde3ec` | `#2b3240` | `--bg-active` | pressed / active |
| `surface-selected` | `#e6eeff` | `#1b2a47` | `--accent-soft` | selected row (focused list) - accent subtle |
| `surface-selected-hover` | `#d9e5ff` | `#223457` | (new) | selected row under the pointer |
| `surface-selected-inactive` | `#e1e6ee` | `#232a36` | (new) | selected row when its list has no focus (VS Code pair) |
| `surface-disabled` | `#eef1f5` | `#1a1f27` | (new) | disabled control fill |
| `scrim` | `rgba(16,22,34,0.40)` | `rgba(0,0,0,0.62)` | (new) | modal backdrop (darker in dark theme so dialogs still separate) |
| **Text** | | | | |
| `text-primary` | `#1a2030` | `#e6e9f0` | `--text` `--xml-text` `--x-text` | body, headings, values |
| `text-secondary` | `#475266` | `#aab3c3` | `--text-muted` `--x-text-muted` | labels, secondary lines |
| `text-tertiary` | `#5b6579` | `#939db0` | `--text-faint` `--x-text-faint` | hints, meta, placeholders (still >= 4.5:1 on every surface) |
| `text-disabled` | `#98a1b3` | `#5d6676` | (new) | disabled text (WCAG-exempt, kept legible) |
| `text-on-accent` | `#ffffff` | `#ffffff` | `--accent-text` | text on accent fills |
| `text-link` | `#2456c9` | `#86abff` | `--x-accent` | links and accent-coloured text |
| `text-on-warning-solid` | `#1a2030` | `#1a2030` | (new) | text on warning solid |
| **Borders and focus** | | | | |
| `border-subtle` | `#e3e7ee` | `#262c37` | (new) | hairlines between rows (decorative) |
| `border-default` | `#d3d9e3` | `#333a47` | `--border` `--x-line` | card, panel and table outlines (decorative) |
| `border-control` | `#7d889d` | `#6b768c` | `--border-strong` `--x-line-strong` | inputs, checkboxes, toggles, segmented controls (>= 3:1, WCAG 1.4.11) |
| `focus-ring` | `#2456c9` | `#86abff` | (new) | keyboard focus outline (>= 3:1 against both neighbours) |
| **Accent** | | | | |
| `accent` | `#2456c9` | `#3666df` | (new) | primary button / active indicator fill |
| `accent-hover` | `#1b45a6` | `#2f5fd2` | `--accent-strong` | primary hover |
| `accent-pressed` | `#163a8c` | `#274fb0` | (new) | primary pressed |
| **Status** | | | | |
| `danger` | `#b42323` | `#ff8a82` | `--x-error` | error text/icon |
| `danger-subtle` | `#fdecec` | `#3a1f22` | `--danger-soft` | error alert fill |
| `danger-border` | `#f1bcbc` | `#6e3036` | (new) | error alert outline |
| `danger-solid` | `#b42323` | `#c93f3a` | `--toast-error` | error solid fill (destructive button) |
| `warning` | `#8a4f00` | `#f2b450` | `--x-warn` | warning text/icon |
| `warning-subtle` | `#fff4e0` | `#37290f` | `--warning-soft` | warning alert fill |
| `warning-border` | `#f0cf9a` | `#6b5120` | (new) | warning alert outline |
| `warning-solid` | `#ffb020` | `#f2b450` | (new) | warning solid fill (dark text on it) |
| `success` | `#17703f` | `#5fd093` | `--x-ok` | success text/icon |
| `success-subtle` | `#e3f5ea` | `#12301f` | `--success-soft` | success alert fill |
| `success-border` | `#a9dcbd` | `#2a5e41` | (new) | success alert outline |
| `success-solid` | `#17703f` | `#25804f` | (new) | success solid fill |
| `info` | `#0e6f8c` | `#6ec5e8` | (new) | info text/icon |
| `info-subtle` | `#e1f3f9` | `#0f2e3a` | (new) | info alert fill |
| `info-border` | `#a5d6e6` | `#1f5568` | (new) | info alert outline |
| `info-solid` | `#0e6f8c` | `#1f7f9f` | (new) | info solid fill |
| **Overlays and highlights** | | | | |
| `tooltip-bg` | `#1f2633` | `#2b3240` | (new) | tooltip fill (dark in light theme; raised + border in dark theme: no glare) |
| `tooltip-text` | `#f3f5f8` | `#e6e9f0` | (new) | tooltip text |
| `find-match` | `#ffe58a` | `#5e4d0e` | (new) | search hit |
| `find-current` | `#ffb15c` | `#8a4a10` | (new) | current search hit |
| **Syntax (CodeMirror)** | | | | |
| `syntax-tag` | `#1f7a35` | `#7ee787` | `--xml-tag` | element names |
| `syntax-attr` | `#6f42c1` | `#d2a8ff` | `--xml-attr` | attribute names |
| `syntax-value` | `#b3261e` | `#ffa198` | `--xml-value` | attribute values |
| `syntax-comment` | `#606b7d` | `#8b949e` | `--xml-comment` | comments |
| `syntax-pi` | `#8a5d00` | `#e3b341` | `--xml-pi` | processing instructions |
| `syntax-bracket` | `#5f6a7f` | `#8b949e` | `--xml-bracket` | angle brackets |
| `syntax-entity` | `#005cc5` | `#79c0ff` | `--xml-entity` | entities |
| **Document canvas and print sheet** | | | | |
| `doc-page` | `#ffffff` | `#1b2029` | `--page-bg` | S1000D design-view page |
| `doc-text` | `#1b1f27` | `#e1e5ec` | `--page-text` |  |
| `doc-muted` | `#5b6372` | `#a1a9b8` | `--page-muted` |  |
| `doc-rule` | `#d6dbe4` | `#3a404c` | `--page-rule` |  |
| `doc-warning` | `#c8102e` | `#ff6b72` | (new) | WARNING label |
| `doc-caution` | `#8a4f00` | `#f0b44a` | (new) | CAUTION label |
| `doc-note` | `#3f5f8f` | `#8fb2ff` | (new) | NOTE label |
| `doc-selection` | `#2456c9` | `#86abff` | `--sel` | step numbers, selection outline (was missing in dark) |
| `paper` | `#ffffff` | `#ffffff` | (new) | print-fidelity sheet (JSS/JSG): white as printed in both themes |
| `paper-ink` | `#000000` | `#000000` | (new) | text on print sheet |
| `paper-muted` | `#4a5160` | `#4a5160` | (new) | secondary text on print sheet |
| `paper-rule` | `#9aa3b2` | `#9aa3b2` | (new) | rules and table borders on print sheet |
| `paper-accent` | `#1d4ed8` | `#1d4ed8` | (new) | links and headings on print sheet |
| `paper-warning` | `#c8102e` | `#c8102e` | (new) | WARNING / watermark ink on print sheet |
| `viewer-canvas` | `#d5dae3` | `#0b0d11` | (new) | area around PDF pages |

### 4.1 Accent: one input, two derived variants

| Item | Light | Dark | Rule |
|---|---|---|---|
| `accent` | `#2456c9` | `#3666df` | fill for primary buttons and the selected-tab line; white text 6.46:1 / 5.09:1 |
| `text-link` | `#2456c9` | `#86abff` | link and active-item text, at least 4.5:1 on panel and on selected surfaces |
| `surface-selected` | `#e6eeff` | `#1b2a47` | subtle accent tint, checked against `text-link` |
| `focus-ring` | `#2456c9` | `#86abff` | at least 3:1 against panel and against selected |

Proposed pipeline for the administrator setting (TH-003): the form takes one brand hex; a function derives the light and dark variants (adjust lightness until white text on the fill is at least 4.5:1 and the fill is at least 3:1 against panel); the preview shows both themes with the measured ratios; **Save is refused** when a derived variant cannot pass; the server re-validates (today `backend/src/services/platform.ts:33,49` accepts any `#rrggbb`). The mockup `admin.html` shows the preview and the two-theme check.

## 5. Parity matrix

Status key: OK = verified at runtime or by static check in this audit; GAP = a measured or read defect (finding named); NOT VERIFIED = not exercised.

| Surface | Light | Dark | Token-driven | Evidence / gap |
|---|---|---|---|---|
| Platform shell (top bar, nav, cards, tables, forms) | OK | GAP (2 low-contrast spots) | yes, via `--bg` and `--x-*` aliases | segmented-control count 4.29; faint-on-hover (TH-002) |
| Login, first-run setup | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | `AuthScreens.tsx` not rendered |
| Studio chrome (ribbon, tree, panes, status bar) | OK | GAP | yes | DM row meta 4.29, ribbon `Live validation` 4.20 (TH-002) |
| Studio document view (Design, Tags) | OK | GAP (static) | partial: `.design-scroll` set of 14 variables | `--sel` not redefined for dark, 2.44 by calculation; runtime not exercised (TH-005) |
| CodeMirror XML view | GAP | OK | yes, `--xml-*` | light brackets 3.85 on 96 nodes (TH-002) |
| JSS editor UI | OK | OK | yes (`jss/style.ts`, 38 literals remain) | no failure in the sweep |
| JSS paper sheet | OK (white by design) | OK (white by design) | `#fff`/`#000` literals | policy to formalise (TH-007) |
| JSG editor UI | OK | GAP | no: legacy light block wins | 2.72 and 2.35 (TH-001) |
| JSG paper sheet and ISPL grid | OK | GAP | no: `ispl-editor.ts` 14 literals, `ispl-preview.ts` 13 | `.jsg-grid th #f1f3f5`, `.jsg-note #5a6572` (TH-001) |
| pdf.js viewer (`PdfJsViewer.tsx`) | always dark | always dark | no: 19 literals, `var(--x-accent,#6cf)` | not theme-aware by design or by accident, undecided (TH-007) |
| Release page watermark preview | OK | GAP | no: hard-coded white box | hint 3.23 (TH-007) |
| Administrator appearance (accent, default theme) | GAP | GAP | n/a | override unvalidated (TH-003); default theme applied after login (TH-008) |
| Studio Settings dialog | GAP | GAP | n/a | duplicate no-op Theme control (TH-004) |
| Review reader (`ReviewReader.tsx`) | NOT VERIFIED | NOT VERIFIED | 3 literals | not rendered |
| Preview window (`PreviewWindow.tsx`) | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | not rendered |
| Toasts (shell and Studio) | OK | GAP | partly: `.toast-warning #8a5300` literal | white on success 2.07 (TH-002) |
| Scrim behind dialogs | OK | GAP (weak) | `rgba(15,20,30,.42)` both themes | too light on a dark surface (DS-005) |
| Forced colors / high contrast | GAP | GAP | no rules | TH-006 |
| PDF output | paper | paper | print palette (`pdf-theme.ts`, 6 literals) | out of scope |

Reading the matrix: of 19 rows, 11 show a GAP in dark, 4 in light, and 3 are NOT VERIFIED; the viewer and the PDF output are fixed-palette by design. Every GAP maps to one finding below.

## 6. Interaction states per component

The table cells name tokens; light and dark differ only through the token values in section 4. All of this is implemented in `docs/audit/mockups/components.css` and exercised on the six screens, except where marked "proposed". Pairs that carry text or a UI boundary are in the 109-pair check, so every cell below that has a foreground and a background is verified in both themes.

**Cross-cutting rules**

- **Focus** is never removed: `outline: 2px solid var(--focus-ring)` with `outline-offset: 2px` (inputs: `-1px`, inside the border). `:focus-visible` only, so mouse clicks do not paint rings; ring contrast is at least 3:1 against panel and selected surfaces in both themes (6.46 / 7.63 and 5.55 / 6.32).
- **Disabled** is a fill and text change (`surface-disabled`, `text-disabled`, `border-subtle`) plus `cursor: not-allowed`, never opacity alone. Disabled text is WCAG-exempt but is kept at 2.6:1 (light) and 2.98:1 (dark) so it stays readable; a tooltip explains why where the action is important.
- **Error** is colour plus icon plus text (`aria-invalid`, `aria-describedby`), never border colour alone. **Success** is never colour alone either.
- **Loading** is `aria-busy="true"`: a 12 px spinner in `currentColor`, width unchanged, pointer events off. Skeletons use `surface-inset`.
- **Selected vs selected-inactive:** lists show `surface-selected` while focused and `surface-selected-inactive` otherwise.
- **Direction of change:** in light theme hover and pressed are darker than the base (`#ffffff` to `#e9edf3` to `#dde3ec`); in dark they are lighter (`#171b22` to `#222833` to `#2b3240`). Components use the tokens and never reason about direction.

**A. Controls**

| Component | Default | Hover | Active (pressed) | Selected | Focus | Disabled | Error / success | Loading |
|---|---|---|---|---|---|---|---|---|
| Button | `surface-panel`, `text-primary`, `border-default` | `surface-hover`, border `border-control` | `surface-pressed` | `aria-pressed`: `surface-selected`, `text-link` | ring | `surface-disabled`, `text-disabled`, `border-subtle` | n/a | spinner, `aria-busy` |
| Primary button | `accent`, `text-on-accent` | `accent-hover` | `accent-pressed` | n/a | ring (offset 2 so it is not on the fill) | `surface-disabled` fill, `text-disabled` | n/a | spinner |
| Danger button | text `danger` on panel | `danger-subtle`, border `danger-border` | `surface-pressed` | n/a | ring | as button | solid variant `danger-solid` + `text-on-accent` | spinner |
| Icon button | transparent, `text-secondary` | `surface-hover`, `text-primary` | `surface-pressed` | `surface-selected`, `text-link` | ring | `text-disabled`, no fill | badge dot `danger-solid` ringed by panel | n/a |
| Input / textarea | `surface-panel`, `border-control`, placeholder `text-tertiary` | border `text-secondary` | n/a | n/a | 2 px ring inside, border `focus-ring` | `surface-disabled`, `text-disabled`, `border-subtle` | error: border `danger` + icon + message in `danger`; success: message with `success` icon (proposed), border unchanged | inline spinner at the end (proposed) |
| Select | as input | as input | n/a | n/a | as input | as input | as input | n/a |
| Checkbox / radio | `surface-panel`, `border-control` | border `text-secondary` | `surface-pressed` | checked: `accent` fill, white mark | ring | `surface-disabled`, `border-subtle` | error: border `danger` | n/a |
| Segmented control | track `surface-inset`; items `text-secondary` | `surface-hover` | `surface-pressed` | item `surface-panel`, `text-primary`, `shadow-1` | ring | `text-disabled` | n/a | n/a |

**B. Navigation and data**

| Component | Default | Hover | Active | Selected | Focus | Disabled | Error / success | Loading |
|---|---|---|---|---|---|---|---|---|
| Tab | `text-secondary` | `surface-hover`, `text-primary` | n/a | `text-link` + 2 px `accent` underline | ring | `text-disabled` | n/a | n/a |
| Document tab | on `surface-chrome` | `surface-hover` | n/a | `surface-canvas` joins the page, border `border-default` | ring | n/a | modified dot `warning` (text alternative) | n/a |
| Navigation item | `text-secondary` | `surface-hover` | `surface-pressed` | `surface-selected`, `text-link`, 3 px `accent` edge, `aria-current` | ring | n/a | count in `text-tertiary` | n/a |
| Tree row | `text-primary`, icon `text-tertiary` | `surface-hover` | `surface-pressed` | list focused: `surface-selected`; unfocused: `surface-selected-inactive` | ring | `text-disabled` | status dot `danger` / `warning` / `success` plus count | spinner in the twist |
| Table row | `surface-panel`, rule `border-subtle` | `surface-hover` | n/a | `surface-selected` (+ forced-colors outline, proposed) | ring on the row's control | n/a | `danger-subtle` fill with an icon cell | skeleton rows on `surface-inset` |
| Menu / context item | `surface-raised` | `surface-hover` | `surface-pressed` | active item `surface-hover` (keyboard) | ring | `text-disabled`, `not-allowed` | n/a | n/a |
| Card (link) | `surface-panel`, `border-default` | border `border-control`, `shadow-1` | n/a | n/a | ring on the stretched link | n/a | n/a | skeleton |

**C. Overlays and feedback**

| Component | Default | Hover | Focus | Error / success | Loading |
|---|---|---|---|---|---|
| Dialog | `surface-raised`, border, `shadow-3`, `scrim` behind (0.40 light, 0.62 dark) | n/a | focus moves in, trapped, returns on close | danger dialog: icon circle `danger-subtle` / `danger`; the safe action has initial focus | confirm button `aria-busy`, dialog stays open |
| Toast / alert | `surface-raised`, 3 px left edge in the status colour, icon | pauses auto-dismiss | dismiss button reachable | error: edge and icon `danger`, stays until dismissed; success: `success`, 4 s | n/a |
| Tooltip | `tooltip-bg`, `tooltip-text`, border `border-default` | shown on hover | shown on focus-visible | n/a | n/a |
| Progress | track `surface-inset`; fill `accent` | n/a | n/a | fill `success-solid` / `danger-solid` | indeterminate stripe, label |
| Badge / chip | `surface-inset`, `text-secondary`; status variants use `*-subtle`, text, `*-border` | n/a | ring when interactive | status text always present | n/a |
| Toolbar | `role="toolbar"`, 36 px, rules `border-default` | children | roving tabindex | n/a | n/a |

### 6.1 Where the two themes deliberately differ

| Concern | Light | Dark | Why |
|---|---|---|---|
| Depth | white panels, `shadow-1..3` | lighter surfaces; shadows kept only on floating layers with a 1 px inset ring | a shadow cannot darken a near-black surface; the ring keeps the edge (07 section 5.6) |
| Scrim | `rgba(16,22,34,0.40)` | `rgba(0,0,0,0.62)` | the same alpha barely dims a dark page |
| Accent fill | `#2456c9` | `#3666df` (lighter, still 5.09:1 under white text) | a mid-blue button on near-black needs more luminance to keep 3:1 against the panel (3.39:1) |
| Accent text and focus ring | `#2456c9` | `#86abff` | text on dark surfaces needs about 7:1 for comfort; ring 7.63:1 against panel |
| Status text | `danger #b42323`, `success #17703f`, `warning #8a4f00`, `info #0e6f8c` | `#ff8a82`, `#5fd093`, `#f2b450`, `#6ec5e8` | luminance flips; each is checked on its `*-subtle` fill |
| Solid status fills | `danger-solid #b42323`, `success-solid #17703f` with white text | `#c93f3a`, `#25804f`, still with white text | dark fills are adjusted so white text (4.5:1) and the 3:1 edge against the panel both hold; `warning-solid` (amber) takes dark text `#1a2030` in both themes |
| Selected tint | `#e6eeff` | `#1b2a47` | tint strength tuned so `text-link` stays at least 4.5:1 |
| Paper and pages | white | white | print fidelity; the canvas around them is themed (`viewer-canvas` `#d5dae3` / `#0b0d11`) |
| Images and icons | as is | icons follow `currentColor`; raster screenshots are not inverted; large white images may get a 0.9 brightness filter (proposed, NOT VERIFIED) | Apple HIG advises softening bright images in dark |

## 7. Automated validation plan

Goal: a regression in either theme fails a build before a person sees it. Seven layers, cheapest first. Nothing here is implemented in the repository; the three scripts named `lint-colors.mjs`, `coverage.mjs` and `check-tokens.mjs` exist in my scratch folder, were run read-only, and are about 30 to 70 lines each. The repository has no ESLint or Stylelint today (`frontend/package.json` lists only Vitest, Playwright and the Vite toolchain), so the lint layer adds tooling; the script alone is dependency-free.

| Layer | Detects | Runs | Cost | Today |
|---|---|---|---|---|
| 7.1 Hard-coded colour lint | literals that bypass tokens | pre-commit and CI, seconds | S | 336 hits |
| 7.2 Token coverage | undefined, light-only, unused tokens | CI, seconds | S | 1 undefined, 1 light-only colour, 14 unused |
| 7.3 Static contrast | token pairs that fail 4.5:1 / 3:1 | CI, seconds | S | proposed set 0 of 109 pairs; current files 15 failing |
| 7.3 Runtime contrast sweep | rendered text that fails in a theme | CI nightly or per release, minutes | M | 7 failures found |
| 7.4 Visual regression | any unintended pixel change per theme | CI on a pinned runner, minutes | M | none |
| 7.5 Component theme tests | missing state styles, token drift | CI, minutes | M | none |
| 7.6 Violation checklist | what machines miss | code review | S | none |

### 7.1 Hard-coded colour lint

What is banned outside `frontend/src/styles/tokens/**` and `public/` (third-party): hex of 3, 4, 6 and 8 digits; `rgb(a)`, `hsl(a)`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color()`; named colours; the same inside TS template strings (the JSS and JSG editors inject CSS as strings), inline `style=` objects, SVG `fill`/`stroke` attributes and canvas `fillStyle`/`strokeStyle`. Explicit opt-out for print palettes: a trailing `/* paper */` comment, reviewed.

| Rule | Regex (JavaScript flavour) | Notes |
|---|---|---|
| hex | `#(?:[0-9a-fA-F]{3,4}\|[0-9a-fA-F]{6}\|[0-9a-fA-F]{8})\b(?![-_\w])` | skip `href="#id"`, `url(#id)`, `id="..."`, `&#x...;` |
| functional | `\b(?:rgba?\|hsla?\|hwb\|lab\|lch\|oklab\|oklch)\(` | `color-mix(` allowed only with `var()` operands |
| named | `(?<![-\w#.])(?:white\|black\|red\|green\|blue\|gray\|grey\|orange\|yellow\|purple\|teal\|navy\|silver)(?![-\w(])\s*(?=[;,)}])` | `transparent`, `inherit`, `currentColor`, `none` are allowed |
| inline colour property | `style=\{\{[^}]*\b(?:color\|background(?:Color)?\|borderColor\|fill\|stroke)\s*:\s*['"]` | in TSX; prefer a class |
| canvas | `\b(?:fill\|stroke)Style\s*=\s*['"`]` | pdf.js overlay code |

Core of the sample script (`lint-colors.mjs`, scratch):

```js
const RULES = [
  ['hex', /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![-_\w])/g],
  ['rgb/hsl/oklch', /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/gi],
  ['named', /(?<![-\w#.])(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|teal|navy|silver)(?![-\w(])\s*(?=[;,)}])/gi],
];
const ALLOW_FILES = [/tokens\.css$/, /[\\/]tokens[\\/].*\.(css|json|ts)$/];
const ALLOW_LINE = /lint-colors-ignore|\/\*\s*paper\s*\*\//;
for (const file of walk(root)) {
  if (ALLOW_FILES.some((r) => r.test(file))) continue;
  lines(file).forEach((line, i) => {
    if (ALLOW_LINE.test(line) || /^\s*(\/\/|\/\*|\*)/.test(line)) return;
    for (const [name, re] of RULES) for (const m of line.matchAll(re)) report(file, i + 1, name, m[0]);
  });
}
process.exit(total ? 1 : 0);                      // in CI: compare with the baseline file instead (ratchet)
```

Measured: `node lint-colors.mjs frontend/src` reports **336 literals in 21 files** (`jsg/shared.ts` 95, `studio/styles/app.css` 77, `document.css` 45, `jss/style.ts` 34, `PdfJsViewer.tsx` 19, `ispl-editor.ts` 14, `ispl-preview.ts` 13, `platform.css` 8, `pdf-theme.ts` 6, then 12 files with 4 or fewer); on `docs/audit/mockups/` it reports 0. Roughly 95 of the 336 are the token definitions that move into `tokens/`.

**Ratchet.** Commit `lint-colors.baseline.json` (`{ "path": count }`); CI fails when any file's count rises or a new file appears, and the per-phase exit criterion in 07 section 5.11 lowers the baseline until it is 0 (then the baseline file is deleted and the lint is absolute).

Stylelint sketch for `.css` (not run: package not installed; rule names are from memory of the Stylelint core list and are NOT VERIFIED against a pinned version):

```json
{ "rules": {
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": ["/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/"]
  },
  "overrides": [ { "files": ["**/styles/tokens/**"], "rules": { "color-no-hex": null, "function-disallowed-list": null } } ] }
```

ESLint sketch for TS/TSX literals (flat config, NOT run, NOT VERIFIED):

```js
{ files: ['src/**/*.{ts,tsx}'], ignores: ['src/styles/tokens/**'],
  rules: { 'no-restricted-syntax': ['error',
    { selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]", message: 'Use var(--token), not a colour literal.' },
    { selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?)\\(/]", message: 'Colour literal in an injected stylesheet.' },
  ] } }
```

Known blind spots: colours built at runtime (`'#' + hex`, the administrator accent), colours inside images, and third-party CSS. The accent is the one runtime colour and has its own validator (TH-003).

### 7.2 Token coverage check

Four rules, run on the source tree, all machine-checkable: (1) every `var(--x)` resolves to a definition (today: `--line` is used and never defined); (2) every colour token defined for light is redefined in the dark block (today: `--info`, so `.sev-info` icons use the light-theme blue `#2563eb` on dark surfaces); (3) every defined token is used or marked public (today: 14 `--x-*` compat tokens are never used); (4) every token in the section 4 table exists in `tokens.css` with both values (so this document and the code cannot drift; generate the table instead of typing it, as I did).

```js
const defined = new Set([...light.keys(), ...dark.keys(), ...scoped.keys(), ...setProperty]);
const undefinedUsed = [...used.keys()].filter((k) => !defined.has(k));
const lightOnly     = [...light].filter(([k, v]) => !dark.has(k) && colourish.test(v.value)).map(([k]) => k);
const unused        = [...defined].filter((k) => !used.has(k) && !setProperty.has(k));
process.exit(undefinedUsed.length || lightOnly.length ? 1 : 0);   // unused is a warning
```

Measured on `frontend/src` (scratch `coverage.mjs`): 67 light-root, 33 dark-root and 14 scoped definitions, 68 variables used; undefined-but-used `--line`; light-only colour `--info`; 14 unused. The checker is regex based and assumes a flat layout (one rule per selector), which is what the generated `tokens.css` provides; a PostCSS parser is the upgrade if needed.

### 7.3 Automated contrast tests

| Layer | What | Thresholds | Result today |
|---|---|---|---|
| Static pairs | `check-tokens.mjs` evaluates a list of 109 (foreground, background, kind) pairs for each theme from the token source | text 4.5, large text and UI 3.0; decorative and disabled pairs only have to stay above a floor | proposed: 0 failures; current definitions: 15 failing pairs (108 checked) |
| Runtime sweep | for every visible text node: effective foreground (opacity applied) over the effective background (composited through ancestors), per route and per editor state, per theme | 4.5, or 3 for text of 24 px or 18.66 px bold | 7 distinct failures; 0 on the 17 platform routes in light |
| Non-text | borders of inputs, checkboxes, focus ring, selected-row marker | 3.0 | static layer only |
| axe-core (secondary net) | `color-contrast` rule through `@axe-core/playwright`, as proposed in 11 section 10.7 | serious and critical fail the test | not present |
| Accent generator | property test over about 200 random hexes plus the known bad ones (`#ffcc00`, `#1d3a8a`, `#000000`, `#ffffff`, `#808080`): the derived light and dark variants either pass all pairs or the save is refused | same | `#ffcc00`: 1.51 light; `#1d3a8a`: 1.77 dark (TH-003) |

The runtime sweep skips elements it cannot judge, and lists them so a person can check: backgrounds with images or gradients, canvas content, disabled controls (exempt), and the paper sheets (`.design-page`, `.jss-paper`, `.jsg-sheet`, pdf pages) which are checked by the `paper*` token pairs instead. Axe is a useful second opinion but, from general knowledge that is NOT VERIFIED here, it reports text over images and pseudo-element content as "incomplete" rather than failing, so it does not replace the sweep.

Sweep core (scratch `sweep.mjs`, runs in the page):

```js
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const el = walker.currentNode.parentElement; if (!el || !visible(el) || el.closest('[disabled],[aria-disabled="true"],.paper')) continue;
  const bg = effectiveBackground(el);               // composite rgba through ancestors; null on image/gradient
  const fg = over(parse(getComputedStyle(el).color), bg, opacityChain(el));
  const need = isLarge(el) ? 3 : 4.5;
  if (bg && ratio(fg, bg) < need) failures.push({ sel: selectorOf(el), ratio: ratio(fg, bg), text: el.textContent.trim().slice(0, 40) });
}
```

Wiring: the sweep runs inside the visual spec's navigation loop (7.4) so each route is visited once per theme; failures print as a table and fail unless the selector is in `contrast-allowlist.json` (a reviewed list with a reason and an expiry date, so waivers cannot become permanent).

### 7.4 Per-theme visual regression

The existing `zz-responsive-layout.spec.ts` already loops 3 widths by 2 `colorScheme`s and saves unchecked screenshots; G's plan (11 section 10.8) converts a stable subset to 56 baselines (14 screens x 2 themes x 2 widths). This section adds the theme-specific mechanics and the overlay states.

Verified from the installed typings (`@playwright/test` 1.65.1 in `frontend/node_modules`; `package.json` asks for `^1.49.0`): `snapshotPathTemplate` with `{projectName}`, `{arg}`, `{ext}`, `toHaveScreenshot` options `maxDiffPixelRatio`, `animations`, `stylePath`, and the context options `colorScheme`, `reducedMotion`, `forcedColors: 'active'` and `contrast: 'more'`.

```ts
// frontend/playwright.visual.config.ts (sketch, not run)
import { defineConfig } from '@playwright/test';
const theme = (name: 'light' | 'dark', width: number) => ({ name: `${name}-${width}`,
  use: { colorScheme: name, viewport: { width, height: width === 1366 ? 768 : 1080 } } });  // sign-in: reuse e2e/support/session.ts
export default defineConfig({
  testDir: './e2e/visual', workers: 1, retries: 0,
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide', stylePath: './e2e/visual/stable.css' } },
  use: { channel: process.env.E2E_CHANNEL || 'msedge', deviceScaleFactor: 1, reducedMotion: 'reduce' },
  projects: [theme('light', 1366), theme('dark', 1366), theme('light', 1920), theme('dark', 1920),
    { name: 'forced-colors', use: { forcedColors: 'active', viewport: { width: 1366, height: 768 } } },
    { name: 'contrast-more', use: { contrast: 'more', viewport: { width: 1366, height: 768 } } }],
});
```

- **Snapshot naming:** `__screenshots__/<theme>-<width>/<screen>[--<state>].png`, for example `dark-1366/editor-s1000d--design.png`, `light-1366/admin--confirm-dialog.png`, `dark-1366/publication--watermark.png`. The theme is a directory (so a reviewer sees both themes side by side in the PR), the state is part of the name, and no platform suffix is needed because the runner is pinned.
- **How the theme is set:** three modes, each with a test. (a) System: emulate `colorScheme` and load the page, which exercises the pre-paint script and the OS listener; (b) explicit: `addInitScript(() => localStorage.setItem('agastya.theme', 'dark'))` before navigation; (c) live switch: click the theme control and assert `html[data-theme]` changes with no reload and the CodeMirror gutter colour follows. Every screenshot test first asserts `await expect(page.locator('html')).toHaveAttribute('data-theme', theme)` so a baseline can never be taken in the wrong theme.
- **Stability:** a test-only `stable.css` (via `stylePath`) pins `--font-ui` and `--font-mono` to Arial and Consolas so baselines test colour and layout, not the machine's Segoe UI Variable build; seeded data with fixed dates; `mask` on timestamps, build ids and the version; animations disabled; one pinned Windows runner image (the VM matrix of 11 section 10.9). Without pinning, expect false diffs from font hinting and DPI.
- **Guard against a vacuous baseline:** a test that takes the same screen in both themes and asserts the mean luminance of the dark image is below 0.35 and of the light above 0.6, so a build where the attribute stops working fails even if someone updates the snapshots.
- **Scope:** G's 14 screens x 2 themes x 2 widths = 56, plus 6 overlay states at 1366 in both themes (confirm dialog, command palette, context menu, toast stack, file menu, a form with errors) = 12, plus the 3 editors' paper views and the pdf viewer at 1366 in both themes = 8, giving 76 images; plus the `forced-colors` and `contrast-more` projects with 6 screens each (12). Run time is NOT MEASURED; the sweep waited 1.2 to 2.8 s per page, so a few minutes for the set is the expectation, not a result.
- **Update policy:** `--update-snapshots` only through a labelled job; a PR that changes baselines must attach the diff images, and light and dark baselines for a screen change together or the reviewer asks why.

### 7.5 Component-level theme tests

Unit tests in jsdom cannot be trusted for this, because (general knowledge, NOT VERIFIED here) jsdom's CSS custom-property and cascade support is limited; use a real browser on a fixture page. The fixture is `design-system.html` (DS-010): every component of 07 section 5.8 in every state of section 6, rendered by the real `components.css`, served at a dev-only route.

```ts
for (const theme of ['light', 'dark'] as const) for (const c of COMPONENTS) for (const state of c.states) {
  test(`${c.name} / ${state} / ${theme}`, async ({ page }) => {
    await page.goto(`/__ds#${c.id}`); await setTheme(page, theme);
    const el = page.locator(`[data-c="${c.id}"][data-s="${state}"]`);
    await forceState(el, state);                    // hover(), mouse.down(), focus via Tab, attribute for the rest
    const cs = await computed(el, ['color', 'backgroundColor', 'borderColor', 'outlineColor', 'cursor']);
    expect(cs).toMatchObject(expectedFor(c, state, theme));   // resolved from the token source
    expect(ratio(cs.color, cs.backgroundColor)).toBeGreaterThanOrEqual(c.minText);
    await expect(el).toHaveScreenshot(`${c.id}--${state}.png`);
  });
}
```

What these tests catch that screenshots do not: a state with no style (disabled looking like default, the DS-002 defect), a state whose colour comes from a literal instead of the token (the expected value is resolved from `tokens.css`), and a theme whose token is missing. `forceState` maps states to real interactions so `:hover`, `:active` and `:focus-visible` are genuinely exercised. Executions: 214 (section 7.7); run time NOT MEASURED, expected to be short because there is no per-test navigation to a heavy page.

### 7.6 Theme-violation detection checklist (code review and CI)

| # | Violation | Detected by |
|---|---|---|
| 1 | colour literal in CSS, TS strings, inline style, SVG, canvas | 7.1 lint |
| 2 | `var(--x)` with no definition, or a colour token without a dark value | 7.2 coverage |
| 3 | `opacity` used to make a disabled or muted state | review (a lint cannot know which selector is a state); component tests compare the disabled colours with the tokens |
| 4 | shadow as the only separation or focus indicator (vanishes in dark and forced colours) | review; forced-colors project screenshot |
| 5 | `outline: none` or `outline: 0` without a replacement | stylelint `declaration-property-value-disallowed-list`, axe |
| 6 | hover style without a matching `:focus-visible` | component tests (focus column) |
| 7 | text smaller than 4.5:1 on any state surface, in either theme | 7.3 static + sweep |
| 8 | status shown by colour alone | review; component tests assert icon or text present |
| 9 | `color-scheme` missing on a new root, iframe or `<dialog>` | lint for `<iframe` and `<dialog` without a scheme; visual baselines (white scrollbar in dark) |
| 10 | a second theme mechanism (a class, `matchMedia` in a component, a copy of `applyTheme`) | grep for `prefers-color-scheme` and `data-theme` outside `store/ui.ts` and `tokens/` |
| 11 | a theme setter that does not go through the store (the Studio Settings select today) | the live-switch test in 7.4 |
| 12 | injected CSS strings that restate the base styles (JSG BASE_CSS) | 7.1 lint plus review of any new `*_CSS` constant |
| 13 | images or SVG with baked-in colours (logos, diagrams) unreadable on the other theme | visual baselines; logo has a light and a dark variant or uses `currentColor` |
| 14 | third-party widget with its own palette (pdf.js toolbar, CodeMirror panels, native `<select>`) | visual baselines of each in both themes |
| 15 | administrator-supplied colour reaching CSS unvalidated | accent generator test; server-side validation test |
| 16 | print palette leaking into the UI or the UI palette into print | `paper*` tokens only inside `.paper`; lint opt-out comment reviewed |
| 17 | a token added with only one value, or a pair not in the pair list | 7.2 and the pair-list completeness check (every token used as text must be in a pair) |
| 18 | z-index, radius, font-size outside the scale | stylelint `declaration-property-value-allowed-list` (07 DS-007) |

### 7.7 Test matrix: components x 10 states

States: `light`, `dark` (baseline appearance in each theme), then `hover`, `active`, `selected`, `focus`, `disabled`, `error`, `success`, `loading`. Cell key: **V** = visual baseline, **A** = computed-style and contrast assertion, `-` = state does not exist for that component. Every state cell runs in both themes. The counts are computed by `E2/gen-matrix.mjs`, not typed.

| Component | light | dark | hover | active | selected | focus | disabled | error | success | loading | Cells |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|--:|
| Button (secondary) | V | V | A V | A V | A V | A V | A V | - | - | A V | 8 |
| Button primary | V | V | A V | A V | - | A V | A V | - | - | A V | 7 |
| Button danger | V | V | A V | A V | - | A V | A V | - | - | A V | 7 |
| Icon button | V | V | A V | A V | A V | A V | A V | - | - | - | 7 |
| Input / textarea | V | V | A V | - | - | A V | A V | A V | A V | - | 7 |
| Select | V | V | A V | - | - | A V | A V | A V | - | - | 6 |
| Checkbox / radio | V | V | A V | A V | A V | A V | A V | A V | - | - | 8 |
| Segmented control | V | V | A V | A V | A V | A V | A V | - | - | - | 7 |
| Tab / document tab | V | V | A V | - | A V | A V | A V | - | - | - | 6 |
| Navigation item | V | V | A V | A V | A V | A V | - | - | - | - | 6 |
| Tree row | V | V | A V | A V | A V | A V | A V | A V | - | A V | 9 |
| Table row | V | V | A V | - | A V | A V | - | A V | - | A V | 7 |
| Menu / context item | V | V | A V | A V | A V | A V | A V | - | - | - | 7 |
| Dialog | V | V | - | - | - | A V | - | A V | - | A V | 5 |
| Toast / alert | V | V | A V | - | - | A V | - | A V | A V | - | 6 |
| Tooltip | V | V | A V | - | - | A V | - | - | - | - | 4 |
| Card (link) | V | V | A V | A V | - | A V | - | - | - | A V | 6 |
| Progress | V | V | - | - | - | - | - | A V | A V | A V | 5 |
| Badge / chip | V | V | - | - | A V | - | - | A V | A V | - | 5 |
| Toolbar | V | V | - | - | - | A V | A V | - | - | - | 4 |
| **Applicable cells** | 20 | 20 | 16 | 10 | 10 | 18 | 12 | 9 | 4 | 8 | **127** |

Totals: 20 components; 40 baseline cells (light, dark) + 87 applicable state cells = 127 cells of 200 possible; each state cell runs in both themes, so 214 test executions (computed-style check "A" plus screenshot "V" where marked).

### 7.8 Rollout of the validation plan

| Step | Delivers | Size | Exit criterion |
|---|---|---|---|
| 1 | `lint:theme` script (lint in report-only mode with the baseline, coverage, static pairs) added to the root test chain before the build | S | baseline committed; a new literal fails CI |
| 2 | runtime contrast sweep over all 17 routes and 13 editor states in both themes, with an allow-list | M | 0 unlisted failures; the 7 known ones fixed or listed with expiry |
| 3 | `design-system.html` fixture and component theme tests (7.5) | M | 214 executions green; deliberately removing `.btn:disabled` fails one test |
| 4 | visual baselines (7.4) on the pinned runner, G's 56 plus overlays | M | a one-token change shows as a diff in both themes; guard test green |
| 5 | forced-colors and contrast-more projects; axe as a secondary net | S | no control loses its boundary or its focus in forced colours |
| 6 | accent generator test with the server validator | S | the 5 known bad values are refused or repaired |

Steps 1 and 2 give most of the protection for the least work and can start before any migration.

## 8. Findings (TH-xxx, theme)

Design-system findings (DS-001 to DS-010) are in 07. Labels follow the common brief.

### TH-001 · P1 · VERIFIED · M · The JSG editor is not themed: legacy light CSS out-specifies the token rules in dark

**Category** Theme parity / one of three editors.
**Problem** In dark theme the JSG editor toolbar shows white tabs and white buttons on a dark bar, the hovered selected tab is accent text on a light-blue fill, and the outline headings are grey on near-black. The editor is usable but looks broken, and the failure is invisible to a contrast tool for the white buttons (dark text on white passes) while the other two fail WCAG.
**Evidence**
- `frontend/src/jsg/shared.ts:60-61` (legacy): `.jsg-bar button{background:#fff;color:#1b1f24;border:1px solid #cfd4da}` and `.jsg-bar button:hover:not(:disabled){background:#e8f0fe}`; `:53` `.jsg-nav h4{color:#5a6572}`. The token-based replacements at `:95-130` (`.jsg-tab`, `.jsg-tb`) have lower specificity (0,1,0 against 0,1,1, and 0,2,0 against 0,3,1 on hover) and lose.
- Runtime (Edge, dark, 1366x768): `.jsg-nav h4` text `rgb(90,101,114)` on `rgb(30,33,40)` = **2.72:1** at 11 px (3 headings); `button.jsg-tab.on` "Insert" `rgb(109,155,255)` on `rgb(232,240,254)` = **2.35:1** (`E2/states.json`, `dark/jsg-insert`; `E2/sweep.json`, `dark/editor-jsg`). Screenshot `E2/shots/s-jsg-insert-dark.png` shows the white tabs "Write, Table, Arrange, Document" and white "+ Chapter" buttons.
- 95 of the 336 colour literals found by the lint are in this file; `ispl-editor.ts` 14, `ispl-preview.ts` 13 more.
**Current implementation** A CSS string (`BASE_CSS`) with a light legacy block (`:51-90`) followed by a token block (`:95-130`), injected at runtime.
**Recommendation** Delete the legacy block, keep one tokenised block written against `--surface-*`, `--text-*`, `--border-*`; the sheet (`.jsg-sheet`) takes `--paper*`; give the ISPL grid and preview the same treatment. The fix is mechanical because the token block already exists.
**Expected outcome** The JSG editor has the same dark appearance as the JSS editor and the Studio chrome; the two failing pairs go to at least 4.5:1.
**Dependencies** DS-001 (tokens), TH-009 (a visual baseline would have caught it).
**Risks** The legacy rules may encode print-preview details that the token block lacks; compare screenshots of the sheet in light before and after (the sheet must not change).
**Acceptance criteria** (1) In dark, no `.jsg-bar` or `.jsg-nav` element has a literal light background (computed `background-color` equals a token value); (2) the sweep reports 0 failures on the three JSG states; (3) light-theme screenshots of the JSG editor are pixel-identical outside the toolbar and outline.
**Test cases** Visual baselines `dark-1366/editor-jsg--insert.png` and `--outline`; sweep on `/projects/<jsg>/editor` with the Insert tab hovered; component test for `.jsg-tab` in the states selected and hover.

### TH-002 · P1 · VERIFIED · M · The current tokens fail WCAG contrast in both themes (15 failing pairs; 7 failures reached the screen)

**Category** Accessibility / theme tokens.
**Problem** Several token pairs are below 4.5:1 for text or 3:1 for control boundaries, so users with low vision or in bright rooms cannot read parts of the interface, and an enterprise accessibility review (VPAT, EN 301 549) would flag them. They are systematic (a single "faint" colour used on four surfaces, solid status fills reused across themes), so each fix removes a class of defects.
**Evidence** Static check of 108 pairs in the current definitions (`E2/current-contrast.md`): 15 failing pairs plus 4 decorative card rules (1.24 to 1.41:1, not WCAG failures).

| Theme | Pair | Ratio |
|---|---|---|
| light | `--text-faint` on hover | 4.37 |
| light | `--warning #b86b00` on panel / on `--warning-soft` | 4.08 / 3.75 |
| light | caution label (`document.css`) on the page | 3.40 |
| light | XML bracket `--xml-bracket #7a8294` on panel | 3.85 |
| light | input border `--border-strong` on panel (1.4.11, needs 3.0) | 1.66 |
| dark | `--text-faint` on hover / on `--accent-soft` | 4.21 / 4.29 |
| dark | accent text on the pressed surface | 4.20 |
| dark | white on `.v2-toast.success` (`--success #57c98a`) | 2.07 |
| dark | white on `.v2-rail-badge` (accent `#6d9bff`) | 2.70 |
| dark | `--sel` on the document page (not redefined in dark) | 2.44 |
| dark | input border on panel | 1.58 |

Runtime confirmation (computed styles): 96 bracket nodes at 3.85:1 in the light split view; segmented-control count 4.29; DM row meta 4.29; ribbon `Live validation` 4.20; the two JSG items of TH-001; the Release hint 3.23 (TH-007). 17 platform routes had 0 failures in light.
**Current implementation** Hand-picked values per theme with no check; `--text-faint` is one value for all backgrounds.
**Recommendation** Adopt the section 4 values (`text-tertiary` is 4.5:1 or better on panel, hover, selected and pressed; `border-control` is 3:1; status colours come as text/subtle/border/solid with checked pairs; white text on `accent` in both themes) through the alias layer, which removes the failures without touching components, then add the check of 7.3 so they cannot return.
**Expected outcome** 0 failing pairs in the token check; the runtime sweep clean except for the listed allow-list.
**Dependencies** DS-001 (alias layer), TH-009 (checks).
**Risks** Slightly darker faint text and a visible control border change the look of dense tables and forms; review the screenshots. Raising the bracket colour makes XML less "quiet".
**Acceptance criteria** `check-tokens` 0 failures over at least 109 pairs in both themes; runtime sweep 0 failures on 17 routes and 13 editor states in both themes; the input border is at least 3:1 on its background.
**Test cases** Weaken `text-tertiary` by one step: the static check must fail; hover a selected DM row in dark: the sweep must pass.

### TH-003 · P1 · VERIFIED · M · The administrator accent is applied unchecked and identically to both themes

**Category** Theme / configuration safety.
**Problem** An administrator can save any `#rrggbb` as the product accent. The same hex then replaces the accent in light and in dark, while the text colour on it (`--accent-text`) stays white in light and near-black in dark. Some choices make primary buttons unreadable, and nothing warns the administrator.
**Evidence**
- `backend/src/services/platform.ts:33,49` accept `^#[0-9a-f]{6}$` and nothing else; `frontend/src/store/appSettings.ts:14` writes `--accent` and `--accent-soft = hex + '26'` on `<html>`, which beats both theme blocks; `--accent-strong` and `--accent-text` (`app.css:8,10,50,52`) are not recomputed.
- Probe on the scratch server (`E2/probe-accent.json`, rita, `/projects`): `#ffcc00` is accepted (HTTP 200): primary button text white on yellow = **1.51:1** in light (dark: 12.16:1 only because the dark text is dark); `#1d3a8a` accepted: **1.77:1** in dark (dark text on navy), 10.37:1 in light. Defaults: 6.46 light, 6.81 dark. Screenshots `E2/shots/accent-ffcc00-light.png`, `accent-1d3a8a-dark.png`.
- Contrast of accent-coloured text on the dark panel for `#1d3a8a`: 1.55:1 (static).
**Current implementation** One hex, inline custom properties, no derived values, no validation beyond the pattern.
**Recommendation** Section 4.1: the setting takes a brand hex; derive light and dark variants (`accent`, hover, pressed, `text-link`, `focus-ring`, `surface-selected`) with a lightness search until white text is at least 4.5:1 and the fill is at least 3:1 against the panel in each theme; show both previews with the measured ratios (the mockup `admin.html`); refuse to save when no variant passes; re-validate on the server with the same function (shared module); write the derived variants as `accent-light` and `accent-dark` that the two theme blocks consume.
**Expected outcome** No accent can produce an unreadable button, and each theme gets an appropriate variant of the brand colour.
**Dependencies** DS-001 (token source), TH-002.
**Risks** Brand teams may reject the derived dark variant; allow an explicit dark override that is still validated. Existing saved accents must be re-derived on upgrade without changing what the administrator typed.
**Acceptance criteria** (1) A saved accent produces at least 4.5:1 for `text-on-accent` and 3:1 for the fill against the panel in both themes, or the save is refused with the reason; (2) the server rejects values the shared function rejects; (3) `#ffcc00` and `#1d3a8a` are either repaired or refused.
**Test cases** Property test over about 200 random hexes plus `#ffcc00`, `#1d3a8a`, `#000000`, `#ffffff`, `#808080`; Playwright: save `#ffcc00`, expect a visible refusal; computed-contrast of the primary button after saving a valid accent in both themes.

### TH-004 · P2 · VERIFIED · M · Theme controls: a toggle that cannot return to System, a Studio setting that does nothing, and no per-user persistence

**Problem** The platform toggle is two-state and, once clicked, the stored choice is permanent: a user can no longer go back to "follow the system". The Studio Settings dialog offers a third Theme control that shows "Follow system" whatever the real theme is, and saving a different value changes a stored value but not the page. The choice lives only in `localStorage`, so it does not follow the person to another browser or PC.
**Evidence**
- `components/ThemeToggle.tsx` sets `light` or `dark` only; `store/ui.ts:3-8,28-31` stores the choice, System means the key is absent, and nothing removes the key.
- `studio/ui/dialogs.ts:1146,1160,1174` builds the select from `s.theme` (Studio's own settings object) and saves it; in embedded mode the platform owns the theme (`studio/ui/app.ts:60-62,368`), so the saved value has no effect. Probe (`E2/lead-checks.json`): select shows `system` in both themes; after choosing the opposite and saving, the select shows it but `data-theme` is unchanged (light stays light, dark stays dark). This confirms the lead from agent E1.
- Only `backend/src/services/platform.ts` mentions a theme (the administrator default); there is no per-user preference.
- Three places can express a theme: the header toggle, the Studio "Dark theme" command (`commands.ts:157`, delegated to the platform when embedded, `app.ts:385`; works) and the Studio Settings select (the no-op above).
**Recommendation** One control with three states (System, Light, Dark; a menu or a segmented control with a tooltip showing the current mode); persist per user on the server when signed in (small `preferences` record) with `localStorage` as the first-paint cache; remove the Studio Settings Theme field when embedded (or bind it to the store); keep the Studio's own switch only for the standalone build.
**Acceptance** A user can select System after choosing Dark and the page follows the OS again; there is exactly one theme control in the embedded Studio; the choice survives a different browser after sign-in.

### TH-005 · P2 · VERIFIED · S · Tokens missing from the dark block silently fall back to light values

**Problem** A variable defined for light and not redefined for dark renders with the light colour on dark surfaces. Two are colours: `--info` (`app.css:27`; `.sev-info .icon` is `#2563eb` on dark panels) and `--sel` (`document.css:18`; step numbers and the caret of the document view, 2.44:1 on the dark page, runtime not exercised). `--zoom`, fonts and radii are theme-independent and fine.
**Evidence** Coverage script over `frontend/src`: 67 light-root and 33 dark-root definitions; the only colour defined for light and not for dark at root level is `--info`; the scoped `.design-scroll` block (14 variables) redefines 13 for dark and omits `--sel` (`document.css:27-41`). One variable is used but never defined (`--line`) and 14 `--x-*` compat tokens are never used.
**Recommendation** The coverage check of 7.2 as a CI rule; define both values for every colour token in the generated `tokens.css`.
**Acceptance** The coverage run exits 0: no undefined, no light-only colour.

### TH-006 · P2 · OBSERVED · M · No forced-colors or prefers-contrast support

**Problem** Windows High Contrast and `prefers-contrast: more` users get the browser's override of author colours with no design for it: backgrounds are replaced, shadows are dropped, and anything that relies on a background tint or a shadow loses its boundary or its selected marker. The product is Windows-only and aimed at enterprise and defence customers, where high-contrast use is plausible.
**Evidence** No `@media (forced-colors)` or `(prefers-contrast)` rule anywhere in `frontend/src` (one `forced-color-adjust: none` in the pdf.js text layer, `pdf.css:21`); selection in the tree, tabs and nav is carried by background colour. Not run in a real Windows High Contrast session (NOT VERIFIED), so the severity of the actual rendering is not measured. The MDN page confirms the behaviour (07 section 4).
**Recommendation** The small block used in the mockups (`components.css` last rule): real borders on controls, `Highlight` outlines on selected nav, tree and tabs, `forced-color-adjust: none` only on the accent button; extend to table rows and tabs; add the two Playwright projects of 7.4 (`forcedColors: 'active'`, `contrast: 'more'`) for 6 screens.
**Acceptance** In the forced-colors project every control has a visible boundary, the selected tree and nav items are distinguishable, and the focus ring is visible.

### TH-007 · P2 · VERIFIED · S · No stated paper, canvas and viewer policy; hard-coded values leak into themed areas

**Problem** What is white, what follows the theme and what is always dark is decided file by file. The Studio design page follows the theme (`document.css:27-41`); the JSS and JSG sheets are white; the pdf.js viewer is dark in both themes (a comment says so, `platform.css:430`) but its toolbar uses themed `--x-white`, and its 19 colour literals include `var(--x-accent, #6cf)` fallbacks; the Release page watermark preview is a hard-coded white box, which is right for a page preview, but the hint text inside it uses the themed `--text-faint` (`.v2-hint`, `platform.css:80`). The mismatch gives a measured 3.23:1 in dark.
**Evidence** `ReleasePage.tsx:192-195` (`background: '#fff'` box with the themed `.v2-hint` span inside: 3.23:1 in dark, `E2/sweep.json` `dark/release`); `PdfJsViewer.tsx` (19 literals; `#3a3a3e` canvas at `:449`, `LazyPdfViewer.tsx:22`), `platform.css:430-432` forces `#d5dae0` and `#fff` for the placeholder.
**Recommendation** The policy of 07 section 5.1 point 3 and 5.9: pages and sheets are always white (`paper*` tokens, inside a `.paper` scope); the canvas around them is the themed `viewer-canvas`; the viewer toolbar uses surface tokens; text inside a page-like box uses `paper-muted` or `paper-ink`.
**Acceptance** The Release hint passes 4.5:1 in both themes; the viewer toolbar and canvas change with the theme (or an explicit decision to keep the viewer dark is documented and tokenised); no colour literal remains in `PdfJsViewer.tsx`.

### TH-008 · P3 · VERIFIED · S · The administrator's default theme applies only after login, so the first paint can be the wrong theme

**Problem** The pre-paint script decides from `localStorage` and the OS only. The administrator default (`theme: 'dark'` for the organisation) is fetched after sign-in and applied then (`appSettings.ts:11-20`), so a new user on a light-OS machine sees light first and then dark. It applies only while no personal choice exists.
**Evidence** `index.html:9-12`, `appSettings.ts:17-19`; the flash itself was not captured (NOT OBSERVED visually).
**Recommendation** Cache the default in `localStorage` (`agastya.theme.default`) on each load and read it in the pre-paint script as the fallback before the OS; or serve it from the HTML shell.
**Acceptance** A first-time user whose administrator default is dark gets dark on the login screen after the first visit, with no light frame.

### TH-009 · P2 · RECOMMENDATION · L · No automated validation of themes of any kind

**Category** Quality automation.
**Problem** Nothing fails when a colour literal is added, a token loses its dark value, a contrast regresses, a state has no style, or a screen looks wrong in one theme; all seven failures and the broken JSG dark toolbar above reached the product that way. G's plan (11 section 10.8) proposes baselines but not the theme-specific checks.
**Evidence** No lint tooling (`frontend/package.json` lists none), no `toHaveScreenshot`, no contrast assertion except one dark PDF-toolbar check (`platform.spec.ts:774`, per 11 QA-012); 336 literals; 15 failing token pairs; 7 runtime failures; the layout spec saves screenshots for people and asserts only overflow.
**Current implementation** Manual review.
**Recommendation** The plan of section 7: lint with baseline ratchet, coverage, static and runtime contrast, per-theme visual baselines with the guard test, component fixture tests (214 executions), a violation checklist, and a rollout in six steps (7.8). Steps 1 and 2 give most of the protection (S + M) and need no migration.
**Expected outcome** A theme regression of the kinds in this report fails CI with a table of what failed.
**Dependencies** DS-010 (fixture page), DS-001 (token source), 11 section 10.8 (baseline runner), the Chrome crash lead (Edge channel).
**Risks** Baselines are brittle across fonts and OS builds (7.4 pins them); the lint needs a ratchet to be adoptable; runtime sweeps are slower than unit tests.
**Acceptance criteria** (1) `lint:theme` in the root test chain, failing on a new literal; (2) the runtime sweep in CI on 17 routes and 13 states in both themes with an expiring allow-list; (3) baselines for the 76 images of 7.4 on a pinned runner plus the guard test; (4) component tests for the 214 executions of 7.7, where removing the `.btn:disabled` rule fails at least one.
**Test cases** Introduce `#ff0000` in a CSS file, delete a dark token, set `--text-tertiary` to `#999`, remove `.btn:disabled`, swap the dark and light `surface-panel`: each must fail a named layer.

## 9. Unknowns and limitations

- **Real assistive technology and high contrast.** No NVDA/JAWS, no Windows High Contrast, no `prefers-contrast` session; TH-006 is OBSERVED from source only.
- **Login, setup and preview screens, ReviewReader** were not rendered in either theme; the parity matrix lists them as NOT VERIFIED.
- **Document view numbering (`--sel`)** in dark is computed statically (2.44:1); the sample module did not render a numbered heading that would exercise it.
- **First-visit flash (TH-008)** is derived from the code path, not captured on video.
- **Runtime sweep scope:** seeded sample data, one viewport (1366x768), Edge only; hover and pressed colours come from the static pair list, except that one hover state (the selected JSG tab) happened to be exercised because the pointer rested on it. Text over images, canvas and pdf pages is not measured.
- **Chrome crash (cross-cutting).** Headless Chrome 158 crashes the tab when a data module is opened in the Studio; the e2e config defaults to `channel: 'chrome'` (`E2E_CHANNEL=msedge` switches it). Cause not verified. The visual-regression plan therefore defaults to Edge.
- **Tools not run:** Stylelint and ESLint sketches were not executed (no installs allowed in this phase; the repository has neither); Playwright option names were checked in the installed typings (1.65.1) but the visual config was not run. Run times of the planned suites are NOT MEASURED.
- **Playwright version mismatch:** `package.json` asks `^1.49.0`, the installed copy is 1.65.1; G's report cites 1.49. Option names above exist in 1.65.1; their availability in 1.49 is NOT VERIFIED.
- **WCAG target:** 11 section 10.7 states WCAG 2.1 AA; I used 2.2 AA (adds focus-appearance and target-size checks). Whether any customer contract requires a level is not in the repository.
- **Dark palette taste** (how blue or how contrasty) is a product decision; the values are verified for contrast, not for brand approval.
