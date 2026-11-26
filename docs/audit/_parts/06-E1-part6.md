## 13. Unknowns and limitations

1. **No assistive technology was run.** Screen-reader behaviour of the platform pages and of the Studio, JSS and JSG editing surfaces is NOT VERIFIED. Section 10 reports structure, focus and keyboard probes only; it is not a conformance claim.
2. **No users were observed.** Rankings come from expert inspection of the running product and the code, not from task timing or interviews. Where a persona's workflow is described (sections 8 and 9) it follows the product's own role model (`frontend/src/lib/roles.ts`), not field research.
3. **One browser engine.** Everything was captured in headless Edge. Chrome stable crashed the tab on opening a data module in this environment (UX-011); whether that is the product or the environment is not known. Firefox was not tried. How the shipped product is hosted for end users (browser, installed window) was not checked.
4. **One machine, small data.** The scratch instance ran on a Windows Server 2025 evaluation image without a GPU, with six small projects. Measurements are layout measurements (pixels, overflow), not performance measurements. The only timing taken is a single editor-open time (about 1.0 s shell, 0.5 s first data module). Typing latency, scroll smoothness and validation cost on large documents are NOT VERIFIED; the 47,447-word JSG sample loaded and displayed, nothing more was measured.
5. **Not rendered.** The right-click context menu in Studio (the capture failed); the Release page with a submitted review and comments; the waiver dialog; the import-package result; a generated PDF in the PDF pane and the pop-out window; Notifications with entries; Graphics and CIR with content; Administrator sections for language, country, classification, interface language, PDF customisation, templates, partner and originator companies, DDN, Advanced and JSS manual types; the project-manager, reviewer and viewer variants of each page. These were read in code or are listed as "code only" in section 2.
6. **Studio's own dialogs** (`frontend/src/studio/ui/dialogs.ts`) are a separate implementation from `components/ui.tsx`; whether they trap focus is NOT VERIFIED (UX-004).
7. **Back-end capabilities assumed by the proposals are unchecked.** Project-wide search and replace, a per-user preference store, server-side review state (UX-008), comment anchoring for JSS and JSG (UX-009), build-position mapping for click-to-source (7.6), health data for an administrator Home (6.4). Each is flagged NOT VERIFIED where proposed.
8. **Colour, contrast, theming and dark mode** are outside this report (agent E2). Contrast ratios were not assessed.
9. **Diagrams.** The Mermaid blocks were written to standard syntax but not rendered with a Mermaid renderer.
10. **Scratch artefacts.** Scripts, screenshots, the scratch build and the scratch workspace live in the auditor's scratchpad folder, not in the repository. The scratch server on port 4056 was started and stopped by this audit only. No repository file other than the report parts under `docs/audit` was changed.

### Cross-cutting leads for other agents

| Lead | Where | For |
|---|---|---|
| `GET /pmc` answers 500 for a JSS project (no guard for non-S1000D) | `backend/src/routes/project-content.ts:202`, throwing in `backend/vendor/engine/pmc.js:204` | JSS and publication agent, back-end |
| One shared `Modal` without focus trap, focus return or stacked Escape | `frontend/src/components/ui.tsx:57-72` | Frontend platform agent |
| Clickable table rows with no keyboard target | `frontend/src/pages/Projects.tsx:59`, `frontend/src/components/Oversight.tsx:47`, `frontend/src/pages/AdminS1000d.tsx:160` | Frontend platform agent |
| Reviewed-finding state stored in browser storage | `frontend/src/pages/project/ValidationPage.tsx:23-27` | Data strategy and security agents |
| Session displacement on every sign-in, raw IPv4-mapped address in the audit log | `frontend/src/store/session.ts:44`; `99-admin-audit.png` | Security agent |
| Responsive spec covers only three project pages; default browser channel is Chrome | `frontend/e2e/zz-responsive-layout.spec.ts`, `frontend/playwright.config.ts` | Testing and QA agent |
| Tab crash in Chrome stable when opening a data module (environment or product) | UX-011 | Performance and QA agents |
| Large-document typing latency unmeasured | JSG sample, 47,447 words | Performance agent |
| JSS has no draft store; JSG autosave key is per browser | `frontend/src/pages/project/JssEditorPage.tsx:161`, `JsgEditorPage.tsx:43` | JSS and JSG agent |
| `.v2-empty strong { display: block }` breaks the PDF placeholder; Studio Settings duplicates the platform theme control; reduced motion only in Studio CSS | `frontend/src/styles/platform.css:69`; `55-settings.png`; `frontend/src/studio/styles/app.css:528` | Design system agent (E2) |

## 14. Suggested order of work

| Wave | Items | Why this order |
|---|---|---|
| 1, days | UX-001 (hide or guard JSS Publication), UX-006 (wrap toolbars), UX-004 (Modal focus trap), UX-005 (skip link, `main`, project-name links, Space key), UX-015, UX-016, UX-023, UX-026 | Each is S, visible or blocking, and independent. They remove the plainly broken impressions and the Level A keyboard failures |
| 2, weeks | UX-002 (default layout and Focus mode), UX-010 (autosave and recovery for JSS and JSG), UX-007 (Project Home and labelled rail), UX-014 (one project list, samples to empty state), UX-017 (find in JSS) | Biggest gain per author-hour; mostly front-end |
| 3, a quarter | UX-008 (one problems model with server-side review state), UX-009 (review comments in the editor), UX-003 (shared editor shell in stages), UX-013 (Structure page), UX-021 (quick switcher) | Needs the back end and touches the engines; the earlier waves reduce risk |
| Backlog | UX-012, UX-018 to UX-020, UX-022, UX-024, UX-025, UX-027 to UX-029 | Polish, plus verification passes that need seeded data |
