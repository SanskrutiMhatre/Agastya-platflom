# JSG engine and editors (User Handbook, Illustrated Spare Parts List)

Date: 2026-11-23. JSG = Joint Services Guide: a third publication format, separate from JSS (Joint Services Specification, `<jssbook>`) and S1000D. The two document types come from the
three Word files in `manual format/JSG_FORMAT/` (see `JSG_STENCIL_ANALYSIS.md`). **No reference PDF exists, so nothing below claims visual fidelity to the stencils**: every value comes from
the Word XML (page setup, styles, numbering, run properties, drawing sizes, table grids) and is marked *declared* below; every choice the Word files do not settle is marked *assumed* and
listed in section 5.

## 1. Where it lives

| Part | Files |
|---|---|
| Schema | `backend/schemas/jsg/jsg-1.0.xsd` (one `<jsgdoc type="uhb|ispl">`) |
| Engine (XSLT -> XSL-FO, Apache FOP makes the PDF) | `backend/schemas/jsg/engine/jsg.xsl`, `jsg-common.xsl`, `jsg-uhb.xsl`, `jsg-ispl.xsl`; the stencil's artwork in `engine/assets/` |
| Server | `backend/src/services/jsg/{registry,service,engine}.ts`, `backend/src/routes/jsg.ts` |
| Editors | `frontend/src/jsg/{model,xml,shared,editor,ispl-editor}.ts`, `frontend/src/pages/project/JsgEditorPage.tsx`, `frontend/src/api/jsg.ts` |
| Tests | `backend/test/jsg-engine.test.js`, `backend/test/jsg-ispl.test.js`, `frontend/src/jsg/jsg.test.ts`, `frontend/e2e/jsg-editor.spec.ts` |

The stylesheets live under `backend/schemas/` only because the installer already copies that folder; they are not S1000D schemas. The engine runner calls the bundled `xsltproc` and Java/FOP
directly; it reads the toolchain paths from `vendor/engine/paths.js` and the font file from `vendor/engine/fontconf.js` and changes neither. It does not call `publisher.ts`, `buildJss` or
`buildS1000dToFo`.

Shared platform files touched (additive only): `backend/src/app.ts` (register the routes), `backend/src/services/formats.ts` (JSG ready, its two types), `backend/src/services/projects.ts`
(create a JSG project), `frontend/src/pages/project/EditorRoute.tsx` (open the JSG editor for `format === 'jsg'`), and two assertions in `backend/test/project-formats.test.js` that said JSG
was "not ready".

## 2. Workflow, both formats

* **Create**: New project -> format JSG -> Land -> User Handbook or Illustrated Spare Parts List. The project gets `jsg-document.xml` (not `publication.xml`), `project.json` `format: "jsg"`,
  `jsgDocType`. The starting document is the stencil's own outline (UHB) or the stencil's standard wording plus one plate (ISPL).
* **Edit**: the editor page picks the editor by `docType`. Both have an outline on the left, a toolbar, Check, Save (Ctrl+S works anywhere on the page), Generate PDF, and the server-built
  PDF beside the editor.
* **Save / open**: `PUT/GET /api/projects/:id/jsg`. Malformed XML is refused (400); schema-invalid XML is saved as a draft and reported (the findings appear in the outline); a stale
  `baseHash` is a 409; a document of the wrong type is refused.
* **Validate**: XSD (`jsg-1.0.xsd`) then JSG rules: unknown / wrong-type body, table grid and widths, picture paths must be project-relative, cross-references resolve; ISPL: plate references
  unique (error), a plate whose parent plate is missing, an empty plate, a view with parts but no picture, a repeated item number (warnings).
* **PDF**: `POST .../jsg/build` validates fresh, hashes the file before and after rendering, runs the JSG stylesheets and FOP, writes `jsg-output.pdf`; `GET .../jsg/pdf` serves it.
  Roles: viewer reads, editor saves, reviewer and above build (the same guards as the other formats; `test/routes-guarded.test.js` covers the new routes).
* **Release (WP-15, PUB-011)**: a JSG document is reviewed and released on the project's Release page, through the same routes as the other formats
  (`POST /api/projects/:id/release`, approve, reject). The publication gate asks the JSG check (`registerPublishCheck` in `services/jsg/service.ts`): an invalid
  document cannot be submitted or approved. A release covers `jsg-document.xml` and every file under `Media/`; any change to them takes the release away.
  Until approval every page but the cover carries the NOT RELEASED watermark (the same `watermark.js` as the other engines, put on the body page masters
  of the JSG FO); after approval the PDF has no watermark (unlike the S1000D / JSS build, the JSG running head does not name the release number). The build runs as a WP-14 job on the warm FOP renderer (`fopd.js`; FOP via java when it
  is not available, and the log says so), answers with its job id and build report, and writes `.jsg-publish-state.json` (what it was built from, released or not).
  `GET .../jsg/pdf` says in `X-Release-State` / `X-Pdf-Stale` whether the file still matches; `GET .../jsg/pdf/download` (the Release page's download) rebuilds first
  when it does not. The PDF carries Title, Author (the issuing authority's lines), Subject (`JSG User Handbook` ...) and Keywords (document number, NSN).
  The shared S1000D / JSS publish route refuses a JSG project (409 `JSG_DOCUMENT`). Test: `backend/test/wp15-jsg-release.test.js`.

## 3. User Handbook - coverage

| Part of the stencil | Status |
|---|---|
| Page A4 210 x 296.9, mirrored margins (25 / 15 mm, top 20, bottom 20), RESTRICTED head and foot (red `#FF0000`, 12 pt, underlined; bold on the cover), page `(n)` in 12 pt, roman front matter, decimal body | declared |
| Cover: document no., red boxed notice, emblem 30.2 x 40.2 mm, bold blue 18 pt title, FOR, project name, NSN / A/T / DATED, SUPPLIED BY + logo 20.1 x 16.9 mm, ISSUED BY, month-year, EQUIPMENT LIFE box (37.7 / 122.4 mm) | declared (sizes from the Word drawings); vertical spacing assumed |
| Verso after the cover with "This page is intentionally left blank." | declared |
| AMENDMENTS (5 columns, the stencil's widths, 21 rows) | declared |
| WARNING (red, hanging 227 twips, double spacing), DEMOLITION (blue title, red text), FIRST AID (2 pages: text table; table with the four stencil figures, 48.4 / 7.4 / 104.2 mm) | declared |
| Associated documents, ABBREVIATIONS (stencil widths), PREFACE, DO'S / DONT'S (left-aligned titles), IMPORTANT POINTS, SYSTEM PHOTOS (plain title) | declared titles and widths where the stencil has them; body spacing assumed |
| Front-matter titles bold blue #0000FF 14 pt | declared (run properties) |
| CONTENTS table (CHAPTERS / DESCRIPTION / PAGE No., 31.9 / 112.5 / 25.3 mm) with page numbers; LIST OF FIGURES / TABLES with dot leaders from the captions | declared widths; line spacing assumed |
| CHAPTER n / SECTION n divider pages, Heading 2-5 as `n.n`, `n.n.n` ... (bold blue caps 12 pt, hanging 454 / 720 / 851 / 992 twips) | declared styles; divider position assumed; SECTION restarts per chapter (read from the stencil's CONTENTS table) |
| Paragraph levels L2-L5 (left 454 / 1174 / 1304 / 1474 twips), lettered lists `(a)`, `Step n)`, numbered lists, notes, figures with "Figure n:" below, tables with "Table n:" above | declared styles |
| Tables: Times New Roman 12 pt (Word's Normal style wins over the Table Grid style's 10 pt), 0.5 pt grid, cell margins 1.4 pt top and bottom and 5.4 pt at the sides (a 17.1 pt row), header row repeated | measured on the stencil render and read from the filled handbook |
| Landscape A4 and A3 sections (per section / appendix) | declared page sizes |
| Appendices: heading right-aligned, bold, blue, underlined; title centred bold blue underlined | declared |

## 4. Illustrated Spare Parts List - coverage

| Part of the stencil | Status |
|---|---|
| Cover (NSN, A/T or S/O, DATED order; title/FOR/equipment 18 pt bold blue; EQUIPMENT LIFE box 40 / 120 mm) | declared |
| CERTIFICATE (18 pt bold #2D2DFF; 14 pt text; Date / Name / Designation / Group block) | declared |
| PREFACE: the stencil's seven numbered paragraphs, the lettered list under 3 (hanging 680 twips) and its NOTE | declared wording ("ssupercede" corrected to "supersede") |
| AMENDMENTS (4 columns: Amendment No., Authority, Date of Amendment, By Whom Amended; the stencil's widths; 21 rows), ABBREVIATIONS, LIST OF EQUIPMENT ALREADY SUPPLIED (4 columns, "Nil" row when empty) | declared |
| CONTENTS (SR. NO. / DESCRIPTION / PLATE REFERENCE / PAGE NO., the stencil's widths; one row per plate with the page range) | declared structure; SR. NO. numbered (assumed, see 5) |
| Plates: landscape A4 296.9 x 210 (margins 20 / 20 / 15 / 15), page number under RESTRICTED in the head, RESTRICTED in the foot | declared |
| Divider page "PLATE - I / GENERAL ASSEMBLY / <equipment>" (36 pt bold blue) and the index of sub-plates (Plate Ref. No. / Designation, 6923 : 8205) | declared |
| Picture page: plate caption (Caption style: red bold 14 pt centred), picture, red bold 14 pt view caption; table page: plate caption + parts table | declared |
| Parts table: 11 columns (Item No., Plate Ref. No., 'P' Provide, NSN, Designation, No. Off (for ...), No. Off (For 1 Set), Drg. No., Firms Part No., Unit Price Rs., Remark) or 10 without the set column; widths = the stencil's twips; Times New Roman 10 pt | declared |
| Pictures in a grid with the item reference under each (e.g. I-B/1) | partly assumed (grid rule) |

## 5. Assumptions and unresolved details (nothing here is verified against a rendering)

1. **No reference PDF.** Pagination (where each page breaks), exact vertical spacing, and line breaking inside FOP versus Word are unverified. Times New Roman is rendered with FOP's built-in
   serif (Times) because no Times New Roman file is bundled; it is metric-compatible but not the same font file.
2. Vertical spacing of the UHB cover and of the CHAPTER / SECTION divider pages (80 mm space-before) is assumed; the Word files use empty paragraphs whose exact effect was not reproduced.
3. Line spacing of the contents and the lists of figures / tables (Word `line=360`) is set to 18 pt; the other paragraph spacings use Word's `line` values as multiples of the single-line height.
4. **SECTION numbering restarts in each CHAPTER** (the stencil's CONTENTS table shows "Section 1, Section 2" under every chapter); the Word numbering definition itself declares no restart.
5. **ISPL CONTENTS "SR. NO."** is empty in the Word sample; the engine numbers the rows 1, 2, 3 ... Remove that column text in `jsg-ispl.xsl` if blanks are wanted.
6. The ISPL contents page range prints "first-last" for every plate, so a one-page plate prints "4-4"; the sample prints ranges only.
7. The ISPL picture grid (2 columns for 2 or 4 pictures, otherwise 3; heights 115 / 75 / 42 mm) is a rule of this engine; the sample's tables of pictures have irregular widths that are not reproduced.
8. The ISPL Word file also has a header "ISPL | Advanced Infantry Floating Foot Bridge" and a footer "Page | n" in one section; which pages use them could not be determined, so they are not implemented.
9. The Associated-documents table of the UHB (sample only) uses proportions 1 : 6 : 3 : 2, not read from the stencil.
10. Bookmarks, cross-reference fields, comments and tracked changes in the Word files are not part of the model. Cross-references inside text (`<xref>`) are supported; the engine prints them as links.
11. Images: the 306 pictures of the filled UHB sample are project data and are not shipped; only the stencil's six pictures are (they belong to the customer who supplied the stencil).
12. The editors show the document in the stencil's typography but do **not** paginate: the PDF beside them does.

## 6. Isolation from JSS and S1000D

* 436 files of the JSS / S1000D engines, schemas, services, editors and templates were fingerprinted before the JSG work began and compared after: all identical.
* `backend/test/jsg-engine.test.js` fails if any JSG code appears in the JSS or S1000D stylesheets, engine files, services or `publisher.ts` / `publishGate.ts`, or if a JSG stylesheet
  includes or names another engine.
* A JSG project has no `publication.xml`, no CSDB, no BREX; the other formats' publish route is never used for it (since WP-15 it refuses one).
* WP-15: the shared release flow (`release.ts`) and the shared build (`publisher.ts`) learn about JSG only through two registries the JSG service fills when it
  loads, `publishChecks.ts` and `ownEngines.ts`; neither file names JSG, so the isolation test above still holds unchanged.

## 7. ISPL page preview (beside the grid)

The ISPL editor keeps its grid-based editing. Beside the grid it can show a **stencil-style page preview** of the selected plate (button "Page preview", on by default, remembered per browser;
`frontend/src/jsg/ispl-preview.ts`). Editing a cell, a caption, a picture or a plate setting redraws it within about 0.12 s; clicking into a plate, or choosing one in the preview's list, selects it.

What it draws, from the same measurements the engine uses (`jsg-ispl.xsl`): landscape A4 pages (296.9 x 210 mm, margins 20 / 20 / 15 / 15), RESTRICTED in the head with the page number under it and
in the foot, the red bold 14 pt plate caption, the pictures (a grid with their labels for several), the red view caption, the plate page and the index of sub-plates on the divider plate, and the
parts table with the stencil's column widths (11 or 10 columns, the header texts including "No. Off (for 100m)") in Times New Roman 10 pt. Pages are numbered as the PDF numbers them
(the first plate's first page is page 1, numbering continues through the plates before the selected one). A unit test reads the column widths out of `jsg-ispl.xsl` and fails if the preview and the engine differ.

Limits, stated plainly:
* **It is a preview, not the PDF.** Where a long parts table breaks onto the next page is *estimated* from the length of the cells (about 5.3 mm per line, 3.9 mm per extra wrapped line); the PDF beside
  the editor is exact. Fonts are the browser's Times New Roman, not FOP's.
* **Numbered callouts are not modelled.** In the Word stencil the item numbers of an exploded view are part of the picture file, so the engine and the preview print the picture as it is; neither
  draws or links callouts, and clicking a part row does not highlight a number on the picture. (That would need a new data model - positions per item - which the stencil does not have.)
* It shows one plate at a time (all of its pages), not the whole list.

## Measured against the stencil (2026-11-24)

The three Word files were rendered with LibreOffice (`soffice --convert-to pdf`; the 123 MB filled handbook takes about a minute) and compared with a new User Handbook built by this engine:

* **Pages and text.** A new User Handbook is **110 pages, the stencil's 110**, and 95 of the 110 pages have the same text. The rest are the stencil's own typos that the skeleton corrects ("Ponits", "Peridical"), the cover's project name and date, and the page after the landscape System Tree Chart (the stencil puts an explicit blank page there). `test/jsg-engine.test.js` ("a new User Handbook prints the stencil") holds the page contents.
* **Furniture.** The classification word is red, 12 pt, underlined in the head and the foot (`header*.xml` / `footer*.xml`: `FF0000`, `sz 24`, underline; the cover's pair is bold); the page number is `(n)`, 12 pt. Head, foot, the cover lines, the CHAPTER / SECTION dividers (22 pt, two lines 38 pt apart), the Warning, Do's and Don'ts lines and the table rows are within about 2 pt of the stencil's positions.
* **Front matter** is the stencil's: Amendments (20 numbered rows of 28.35 pt), Warning (six numbered red lines), Demolition, First aid (two tables, "Figure. n" above each picture), Abbreviations (**37 numbered rows**, `minRows`), Preface (the stencil's four paragraphs), Do's / Don'ts (five numbered lines each), Important Points (numbers without a dot), System photos, Contents (blue bold header and CHAPTER rows, 30.9 pt rows, "Appendix 'H'" in mixed case and a "Section 6 Appendices" row), List of figures and List of tables.
* **Body.** CHAPTER and SECTION dividers, then `n.n` clauses with the stencil's blue 12 pt bold capitals; the starting document carries the stencil's example blocks (1.1 General: a captioned placeholder figure; 1.2: a lettered list and Table 1 "Technical Specifications"; 1.3 System Tree Chart on **its own landscape page**; Appendix H: its 17-row table). The SECTION that holds the appendices has its own divider page. A section with nothing in it prints its divider and the blank verso only.
* **Landscape clause.** `<clause orientation="landscape">` (new) puts a heading on a landscape page inside a portrait section: the section is cut into page runs, and only the last run is padded to an even page.
* **A figure with no picture** is the stencil's captioned placeholder: the schema accepts it, the checker warns (`JSG-FIGURE-EMPTY`), and the PDF prints the caption under an empty line.

LibreOffice is not Word: where the two disagree about spacing (it adds a 1.5-line's extra space below a line, FOP above it) the engine follows the declared Word values and the filled handbook, not the render.


## Illustrated Spare Parts List (ISPL): what the engine follows

Measured against `JSG_ISPL_Format.docx` (rendered with LibreOffice; the filled list imports to 89 pages, as the Word file has):

- Portrait pages are **not** mirrored (25 mm left, 15 mm right); the cover has 20 mm each side. The head is RESTRICTED alone; the foot is the page number in brackets **over** RESTRICTED (portrait: 10 mm from the bottom; landscape: 15 mm).
- Tables are Times New Roman **12 pt**, line 15.8 pt, 3.7 pt cell padding (contents 1.65 pt, abbreviations 5.7 pt); the amendments rows are 10 mm.
- The Plate Ref. column widens to its longest reference ("I-B/2/11/5/13"), as Word fits it; the Designation column gives the width up.
- `front/@omit` accepts `certificate preface amendments abbreviations supplied contents`; every page that stays still starts on an odd page.
- The plate list is followed by `<appendices>` (APPX 'A' ... at the right, blue title, a sentence, a table; each on an odd page with a blank verso, after an APPENDICES page). A view may hold `<note>` lines printed under its parts table.
- The Word importer for this format is `src/services/jsg/docx-ispl.ts`; `node scripts/make-jsg-sample.js ispl` rebuilds `samples/jsg-ispl`.
