# Test inventory (baseline)

Captured 2026-11-27. The behaviour the redesign must not change is, today, defined by these tests. Phase 2 starts by running all of them and recording the result; it ends by running them again and comparing.

## Browser tests (Playwright, `frontend/e2e`)

### doc-pages.spec.ts (14 test blocks)

1. the rail of a JSS and a JSG document has Explore and Publication, and the Publication page does not end in an error
2. the codes are not a strip on the editor page, and there is no Codes button: the code beside a heading is a badge, switched on from the Publication page
3. Publication (JSS, fixed chapters): the chapters are shown with their codes and cannot be moved; the sections can, and the code goes with the section
4. Publication: a section is dragged into another chapter and dropped, saved, and keeps its code
5. Publication: Open in editor goes to the section; Discard throws the arrangement away
6. Publication (JSS with chapters of its own): add a chapter, rename it, move it, save; the document has it
7. Publication (JSG User Handbook): move a chapter with the buttons, save, and the JSG document follows
8. Publication (JSG parts list): the plates are listed and are not arranged here
9. Explore (JSS): hierarchy with codes, search, expand and collapse, detail panel, table and pictures views
10. Explore (JSG): the same, for a handbook
11. on a phone and a tablet the two pages do not scroll sideways
12. Publication (JSS with chapters of its own): delete a section and a chapter, undo, save; the document and its codes follow; the last chapter cannot be deleted
13. unsaved work is not lost by clicking a tab: Publication asks, and Stay / Leave without saving / Save and leave each do what they say
14. unsaved work in the JSS and the JSG editor is not lost by clicking a tab either; Save and leave keeps it

### jsg-editor.spec.ts (11 test blocks)

1. the New project wizard offers JSG with both types ready
2. UHB: opens the JSG editor (not the Studio, not the JSS editor) with the stencil outline and numbering
3. UHB: edit a paragraph, a heading, a table and a list; Ctrl+S saves valid JSG XML
4. UHB: reload - the saved work is there; the PDF is built by the JSG engine
5. UHB: a problem is shown, not hidden - a draft that breaks the schema is saved and a PDF is refused
6. ISPL: opens the ISPL editor with the stencil preface, the tables and the first plate
7. ISPL: add a plate with a picture and parts, paste rows; Ctrl+S saves valid JSG XML
8. ISPL: the stencil-style page preview beside the grid shows the selected plate and follows every edit
9. ISPL: reload - the plate, the picture and the parts are still there; the PDF is built by the JSG engine
10. JSG sample and ancillary pages: create the sample from the button, tick pages off, edit a page, save; the document follows and the editor finds and undoes
11. ISPL sample and ancillary pages: create the sample, tick pages off, edit the preface and the amendments, save; the editor shows plates and appendices without the front pages

### jss-editor.spec.ts (12 test blocks)

1. the catalogue offers the 18 types of the JSS catalogue, all ready
2. opening a JSS project opens the JSS editor, with the stencil chapters locked and the outline beside the sheet
3. writing: a paragraph with bold text, a list that nests, a captioned table, a note, a cross-reference
4. saving writes the XML: it is the project's source, valid against the schema, and holds exactly what was written
5. a reload shows the same document; undo goes back through what was written
6. Generate PDF builds the publication from the saved XML on the server, and the PDF says what was written
7. a problem the schema or the stencil finds is marked on the sheet and listed, the PDF is refused, and fixing it clears it
8. merging cells: Merge right and Merge down in the browser, saved as colspan / rowspan, built into the PDF, and split again
9. content order: a document whose content follows a sub-section opens as unsaved with an explanation, the problem is listed, and saving writes it in order
10. a second author's save is not overwritten silently: the stale save is refused and offers the saved document
11. the S1000D Studio is untouched: an S1000D project still opens the Studio
12. ancillary pages: a rail item, tick which pages print, edit the words of one, and give it back to Settings

### platform.spec.ts (44 test blocks)

1. first run: set up the administrator and land on the platform overview
2. the administrator oversees but does not create projects: its navigation has no Workspace, Projects has no New project
3. the administrator creates an Author: the username is suggested from the name, the temporary password is username@year
4. the Author signs in with it, chooses a password and lands on her own dashboard
5. main dashboard has Overview, Workspace, Projects, Graphics, CIR, Backup and Settings; Notifications is a bell beside an icon-only account menu; the theme is one icon button
6. workspace: create a folder and a project inside it
7. projects list shows it; opening it lands in the Editor, with an icon-only rail (no overview page)
8. editor: import data modules, open one in the Studio, edit it and save to the server
9. editor: Quick preview and Generate live together in the panel on the right
10. editor: the left panel can be hidden and shown again, and the editor takes the room
11. editor: Quick preview and Generate each open in a window of their own and stay in sync with the editor
12. publication: add a chapter, place data modules, save; explore shows the hierarchy
13. editor: the saved publication hierarchy shows in the left panel, with its data modules in their chapters
14. publication: chapters can be rearranged by drag and drop, and modules added to a chosen chapter
15. validation: run, review a finding, jump to it in the editor
16. release: the Author requests, cannot approve; the administrator approves; Release 1; watermark saved
17. project settings: general, publishing (reused screen), team
18. main settings: administrator sees people, approvals, sessions, the audit log and a backup of the platform
19. the Author can back up her own projects
20. a new project can start as a User Handbook: seven chapters ready in Publication, the engine fixed to the JSS book
21. graphics: a project lists only its own ICNs and symbols; the main page lists every project's
22. CIR: an Author adds a common data module for everyone and copies one into a project
23. administrator: every V1 section is there; reference data is edited, maintenance and settings do real things
24. new data module: language, country, type, security, enterprise and more are dropdowns of what the Administrator maintains; English / India are selected
25. CIR: create a data module in the repository with the wizard (its own unique code), then add it to a project from the editor
26. a second person: account creation, onboarding, sharing and read-only access
27. administrator creates an Author and sees the one-time temporary password
28. the new user must onboard before anything else, then has no projects
29. the owner gives her view access; she finds the project read-only
30. sample project and unique data modules
31. a data module cannot be imported twice into the same project
32. one click creates a sample project with data modules, a figure and a publication; it builds
33. new data module: takes the project's model code, blocks duplicates, suggests the next free code, saves under its DMC name
34. the data-module list can be resized by dragging its edge, and the width is remembered
35. dark mode: the PDF viewer toolbar follows the theme (it was hard-coded white)
36. roles: administrator -> Project Manager -> Author
37. the administrator creates a Project Manager
38. the Project Manager creates an Author, a project, and assigns the Author
39. the Author sees only the assigned project, cannot approve, and asks for a release
40. the Project Manager is notified of the request, approves it from Activity; the Author is notified of the decision
41. the administrator sees the projects with their release status, the team and all activity
42. the Project Manager dashboard shows her team and projects
43. review: submit, comment, send back with reasons, resubmit, approve - then the author downloads the clean PDF
44. every user lands on their own dashboard after signing in, whatever page the last user left

### project-import-package.spec.ts (9 test blocks)

1. the icon is beside the two import buttons, which are still there
2. choose a .zip, scan it: a readable report, and nothing is written
3. apply: the change log, the modules in the list, and the publication
4. place the module no publication claimed into a chapter; the pool empties
5. a refused import keeps the selection and says why; "replace existing" then succeeds
6. files and folders work too: a folder keeps its structure, and the project's own list is updated
7. a 700-graphic package is summarised, not listed: long lists show their first rows and a "Show all"
8. a viewer does not see the import actions
9. no console errors came from the dialog

### publish-gate.spec.ts (3 test blocks)

1. a schema-invalid draft is saved, then Generate, the server preview and a release request are refused with the reason
2. fixing the module unblocks Generate, and a release can then be requested
3. a BREX breach is a draft that saves, then Generate is refused with the rule named; the Validation page lists it; fixing it unblocks

### publish-waivers.spec.ts (8 test blocks)

1. the server Quick preview is refused for the missing BREX, and an editor is offered a waiver
2. Generate is refused; a reason that is too short is rejected; a recorded waiver lets the draft build go ahead
3. with the waiver recorded, the server Quick preview renders too
4. the Publication page lists the waiver (subject, reason, who, when); removing it makes the gate strict again; a build there can record it afresh
5. the Release page shows the refusal as it is, says a waiver does not cover a release, and offers none
6. another kind of refusal (a schema error) never offers a waiver
7. a reviewer, who can build, sees the refusal but no waiver action
8. a viewer reads the waivers on the Publication page but cannot remove one

### s1000d-config.spec.ts (5 test blocks)

1. New project wizard: four steps with validation, a review, and the configuration it created
2. project settings → S1000D: identity, information codes, SNS editing and search
3. New data module wizard follows the project: fixed MIC and issue, SNS pickers, enabled codes
4. Administrator → S1000D catalogue: provenance per issue, custom codes outside the BREX are flagged
5. no applicability tools: no Applicability section in the settings, no Configuration… button beside Generate

### zz-dmtypes.spec.ts (5 test blocks)

1. open the project editor and import the seven rich modules plus the figure
2. ${t.label}: opens, renders, is schema-valid, enforces its tag rules, edits and saves
3. quick preview of each type: the server (FOP) renders it and the PDF page is drawn
4. the server agrees: validation of the saved project finds no schema errors
5. wizard: all 21 types can be created from scratch, are valid in the Studio, use their own tag rules, and save as valid XSD on the server

### zz-import-refusal.spec.ts (1 test blocks)

1. a package naming an unregistered enterprise is imported, and the result says which enterprise and what an Administrator can do

### zz-responsive-layout.spec.ts (1 test blocks)

1. ${screen.name}: ${size.name}, ${scheme} theme - no sideways scroll, nothing cut off

### zz-verify-21.spec.ts (4 test blocks)

1. issue ${issue}
2. import the 21 modules
3. each of the 21 types: own rules, XSD-valid, suggestions, refusals, malformed XML, edit + save + reopen
4. reload: every edit persisted, every module reopens with its own rules, and the server finds the project schema-valid

### zz-verify-wizard.spec.ts (1 test blocks)

1. wizard, issue ${issue}: all 21 types are offered, each creates its own schema, root, info code and editor

Total test blocks found by the scan: 118 (some are generated in loops, so the runner's count differs: the full run on 2026-11-27 listed 133 tests).

## Unit tests (Vitest, `frontend/src`)

30 files: components 2, jsg 4, jss 6, lib 5, studio 13.

## Backend tests (`node --test`, `backend/test`)

83 files.
