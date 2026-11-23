# JSS stencil analysis

Source: the 17 Word files in `manual format/JSS0251-stencils/`, read directly from their Word XML (`document.xml`, `styles.xml`,
`settings.xml`, headers and footers). No Word or LibreOffice render was available, so layout numbers are the *declared* values
(page setup, styles), not measured from a rendered page. Analysis date: 2026-11-23.

## 1. The finding that shapes the design

**The 17 stencils are not 17 layouts. They are one shared frame plus a handful of body kinds.**

Every stencil opens with the same ~25-item front-matter sequence, in the same order, and uses the same page setup. Only the body
(from the first Heading 1 on) differs. So the JSS side needs **one frame definition and seven body profiles**, not 17 separate
implementations.

### 1.1 Shared frame (identical in all stencils except `Cover_page` and `Footer_sample`)

Order, each followed by an "This page is intentionally left blank." verso where the next item must start on a right-hand page:

1. Cover: "Code No.", "Rev No.", proprietary notice box, **title block**, handbook-authority notice, "Prepared & Published by L&T Defence", month/year, "Under the Authority of", document code (twice)
2. Restriction on use / proprietary information (boxed)
3. Foreword
4. Record of Changes (22-row table: Change Notice No. / Authority / Incorporated by / Initials with date)
5. Associated Handbooks (table: Sl. No. / Document Title / Code No.)
6. Safety Warning, First Aid in case of electric shock (4-figure table), Demolition of material (the stencils differ on whether the last one is present once or twice)
7. Change Notice form (title, code no. and date, previous change, change notice no. and date, pages / enclosures / sheets)
8. List of Abbreviations (table)
9. List of Contents (TOC), List of Figures, List of Tables (not in every stencil)
10. System Name page
11. Description of Symbols (18-row table of warning/caution/note symbols)
12. Body

Page setup of the frame (A4 210 x 296.9 mm, **mirror margins and even/odd headers on in every file**):

| Part | Top | Bottom | Inner | Outer | Header / footer | Numbering |
|---|---|---|---|---|---|---|
| Title page | 20 | 20 | 25 | 25 | 10 / 10 | lower roman, different first page |
| Front matter (most pages) | 20 | 13.5 | 25 | 15 | 10 / 2.5 | lower roman |
| Proprietary-notice section | 20 | 15.2 | 30.5 | 15 | 10 / 2.5 | lower roman |
| Symbols page | 15 | 25 | 20 | 12.5 | 10 / 2.5 | lower roman |
| Body | 20 | 13.5 | 25 | 15 | 10 / 2.5 | decimal, restarts at 1 |
| Landscape body (tables) | 25 or 20 | 15 or 20 | 13.5 or 15 | 20 or 15 | 10..20 / 2.5..20 | decimal |
| A3 landscape fold-out (UHB2, Footer_sample) | 25 | 15 | 30.5 / 13.5 | 15 / 20 | 10 / 2.5 | decimal |

Many sections are `vAlign=center` (blank versos, title pages). Header 9 pt, footer 10 pt right-aligned (UHB styles).

### 1.2 Typography (UHB stencil, the reference for the manuals)

| Element | Style | Font / size | Spacing | Indent |
|---|---|---|---|---|
| Body | Normal | Arial 12, justified | after 0, single | none |
| Chapter title | Heading 1 | Arial Bold 18, left | 1.15 | 0 |
| Section | Heading 2 | Arial Narrow Bold 14, **caps**, keep-with-next | before 12 after 6 | 0.8 cm hanging |
| Sub-section | Heading 3 | Arial Bold 12, justified | before 12 after 6 | 2.07 cm, 1.27 cm hanging |
| Level 4 / 5 | Heading 4 / 5 | as Heading 3 | | 2.5 / 2.8 cm |
| Paragraph under H2..H5 | L2-Para .. L5-Para | Arial 12 | 1.15 | 0.7 / 2.07 / 2.5 / 2.8 cm |
| Lettered / roman lists | L2/L3-alphanumbering, L3/L4-romanlist | Arial 12 | after 3 | numbered, hanging 0.63 cm |
| Caption | Caption | Arial Bold 12, centred | before 6 after 6 | |
| TOC 1 / 2 / 3 | | bold caps / regular / regular | | 0 / 1.65 / 3.05 cm |
| Table text | Table Grid | Times New Roman 10 (UHB2: NTG_* styles) | | |

Heading numbering is one multilevel list (`1`, `1.1`, `1.1.1`, ...). Tables and figures are numbered per chapter ("Table 11", "Figure 21" =
chapter + sequence) in a caption above the table / below the figure. A chapter opens with "This chapter covers the following topics:" and
a two-column table of first-level sections, then a page break, and closes with "--------- End of Chapter ---------".

## 2. Document types

| # | Stencil | Kind | Body structure | Notes |
|---|---|---|---|---|
| 1 | **UHB** | Manual | 7 fixed chapters: Leading Particulars and General Data; Brief Technical Description; Unpacking and Removal of Preservatives; Preparation for Use and Installation Specification; Operating Instructions; User's Servicing and Maintenance Instructions; Miscellaneous | Already built (`uhb`, `xignal-jss` profiles) |
| 2 | **UHB2** | Manual | Same 7 chapters, richer examples (Dimensions and Weight, Electrical Specs, Ship Services tables) | Cover says "INBR No."; Times New Roman body in places, `NTG_*` table styles, 5.5-13 pt sizes, A3 landscape fold-out. A variant, not a different type |
| 3 | **MM** | Manual | 4 chapters: Inspection and Maintenance Routine; Test Equipment; Fault Diagnosis; Typical Test Readings | Maintenance charts, fault-diagnosis tables, procedures with numbered steps (L4) |
| 4 | **ORM** | Manual | 5 chapters: Dismantling and Re-assembly; Test Specification and Alignment Procedure; Specifications of Special Components; Special Test Equipment/Rigs/Jigs; Special Protective Measures | Heavy use of L4 lettered steps and bold sub-paragraphs (`L4-Para-Bold`) |
| 5 | **TM_PI** | Manual | 4 chapters: Brief Technical Specifications; Brief Principles of Operation; Detailed Circuit Theory; Drawings / Documents | Landscape section for drawings |
| 6 | **DS** | Manual | Chapter 1 General Information (Role, Brief Description, Overall Performance Specifications), chapter 2 Detailed Technical Specifications (Related Documents, Associated Items), ... | Specification tables "Sl. No. / Attribute / Specification" |
| 7 | **TOTE_and_CS** | Manual / list | One chapter: Table of Tools & Equipment and Carried Spares: List of Tools; Spares and Spare Box; per-assembly spares tables | Tables "Sl. No. / Spares / Qty / UOM" |
| 8 | **PRS** | Schedule | One chapter: Importance of Permissive Repair; Permissive Repair Schedule | 44-row table: Sl. No. / Subsystem-Unit / Light / Field / Base Repair / Remarks |
| 9 | **MRLS** | List | One chapter, one 68-row table: Ser. / Part No. / Item-Equipment Description / Qty / UoM / ISPL Ref. | Extra front-matter page "Associated handbooks" |
| 10 | **ROTABLE** | List | One chapter, one landscape table: Item No / Designation / Section & Cat/Part No. for future demand / Qty / Mandatory & Non-Mandatory Spares / Norms of Consumption / Remarks | Only stencil with a single landscape A4 section (12.7 mm margins) |
| 11 | **Vol_1_PL** | Parts list | Chapters per subsystem family (Mechanical / Electrical-Electronic / Hydraulic / Pneumatic), each: "This chapter contains parts list of following assemblies", then one parts table per assembly | Landscape tables; the parts table has 10 columns (below) |
| 12 | **Vol_2_Illustrations** | Illustrations | Same chapters; each assembly = one figure with caption | Landscape pages |
| 13 | **Manufacturer's Part List** | Parts list + figures | Vol 1 + Vol 2 together: per assembly a parts table and its figure | |
| 14 | **ISPL** | Illustrated parts list | Chapters per subsystem family; per assembly: figure(s) with caption(s) followed by the parts table; "Figure" captions with views | Landscape; 3 + 2 landscape sections |
| 15 | **ISPL_wrt_JSS** | Illustrated parts list | Same as ISPL (1594 vs 1592 paragraphs; differs in a few fields only) | Treat as the JSS-conformant variant of ISPL; diff to be confirmed |
| 16 | **Cover_page** | Frame part | The cover on its own: title block, notice boxes, "Publication No", L&T block | Source of truth for the cover |
| 17 | **Footer_sample** | Layout sample | A short UHB chapter with TOC, tree-chart A3 landscape pages and the footer variants | Source for footer / fold-out geometry, not a document type |

**Parts table (10 columns, shared by Vol_1_PL, MPL, ISPL):** Sl. No. / Description / Manufacturer's Part No. / Cct Ref. / Fig.-Item / No. Off /
Para Ref. / 'P' / DS Cat No. / Remarks, with a numbered sub-row "(1) ... (10)" under the head.

So **15 document types** (17 files minus `Cover_page`, a frame part, and `Footer_sample`, a layout sample), and **ISPL / ISPL_wrt_JSS** and **UHB / UHB2** are variants
of one type each. Grouped by what the editor must offer:

| Body kind | Types | Editor needs |
|---|---|---|
| **A. Chapter manual** | UHB, UHB2, MM, ORM, TM_PI, DS, TOTE_and_CS, PRS | headings 1-5, numbered paragraphs L2-L5, lettered / roman lists, tables, figures, notes / cautions / warnings, procedure steps, chapter intro table |
| **B. Parts list** | Vol_1_PL, MPL, ISPL | assembly blocks: heading, figure(s), 10-column parts table |
| **C. Illustrations** | Vol_2_Illustrations | assembly blocks with figures only |
| **D. Single table list** | MRLS, ROTABLE | one wide table with fixed columns |

## 3. What is already in the repository

* `backend/vendor/engine/frontMatterPages.js` + `frontmatter.js`: the shared cover / notice / record-of-changes pages (built from the UHB stencil).
* `backend/templates/uhb.house.json`, `xignal-jss.house.json`: typography and page furniture for the manual look.
* `backend/src/services/profiles.ts`: the `uhb` / `xignal-jss` profiles, with the 7 chapters.
* **Gaps:** no profile, outline or layout for MM, ORM, TM_PI, DS, TOTE_and_CS, PRS, MRLS, ROTABLE, Vol_1_PL, Vol_2, MPL, ISPL. Parts-table and single-table layouts (landscape, 10 columns) have no template. The editor offers only S1000D data module types. `docs/` Phase 6 notes recorded the earlier decision to reuse the S1000D editor with a profile; the brief now asks for a separate JSS authoring model, which replaces that decision.

## 4. Not yet measured (needs a render or the owner's decision)

* ISPL vs ISPL_wrt_JSS: the actual difference.
* UHB2 vs UHB: whether UHB2 is the newer house style that UHB should be migrated to.
* Running header / footer text per stencil (headers are in `header*.xml`, 22-98 per file, mostly the same shape; not yet tabulated).
* Landscape and A3 section margins: which are intentional house style and which are leftovers from copy-paste (the values are inconsistent between stencils).
* Arial Narrow / Arial Bold are not bundled; FOP substitutes Helvetica.

## 5. Comparisons asked for (2026-11-23)

**ISPL vs ISPL_wrt_JSS.** Text, styles, headers and footers are identical. Two differences only: (1) in ISPL_wrt_JSS the eight assembly-index entries of the chapter
introduction table (1.1 to 2.4) are live paragraph-number cross-references (`REF _Ref... \r \h`) to the assembly headings, where ISPL has plain text; (2) one page
break less. Both types are kept; ISPL_wrt_JSS will differ by making that index from cross-references. Neither is built yet (parts-list body, a later slice).

**UHB vs UHB2.** Same seven chapter titles, but UHB2 is not interchangeable: its chapter 1 has different sections (Dimensions and Weight, Electrical Specifications, Ship Services),
the cover carries only "INBR No.", tables use `NTG_*` styles in Times New Roman, text sizes range 5.5-13 pt, and it has A3 landscape fold-outs. UHB stays as it is; UHB2 is its own type
(not ready).

## 6. What is built (first slice: shared frame + UHB, MM, ORM)

| Part | Where |
|---|---|
| JSS XML schema 1.0 (no S1000D structures) | `backend/schemas/jss/jss-1.0.xsd` |
| Document type registry (15 types, 3 ready) | `backend/src/services/jss/registry.ts` |
| Validation (XSD + stencil rules), composing the book, gate | `backend/src/services/jss/service.ts`, `routes/jss.ts`, `publishGate.ts` |
| House style read from the stencil | `backend/templates/jss-stencil.house.json` |
| Editor (framework-free) | `frontend/src/jss/` (model, xml, numbering, ops, inline, dom, editor, style) |
| Page, routing | `frontend/src/pages/project/JssEditorPage.tsx`, `EditorRoute.tsx` |

Flow: editor -> XML (`publication.xml`, root `<jssbook>`, the project's source of truth) -> server validates -> the shared frame (cover, notices, record of changes, contents, lists, symbols,
from Settings) is added to a working copy `_jss-book.xml` -> `jsstofo` -> XSL-FO -> FOP. The author's body is passed on unchanged.

Tests: `backend/test/jss-authoring.test.js`, `jss-cover-isolation.test.js`, `jss-stencil-corrections.test.js` (these read the stencil Word files: chapters, sections, page setup, type sizes, spacing, indents, page set, front-matter text), `frontend/src/jss/*.test.ts`, `frontend/e2e/jss-editor.spec.ts` (real browser).

## 7. Page-by-page comparison of the front matter (2026-11-23)

Method (`backend/test/jss-stencil-corrections.test.js`, reading the Word files): the front-matter pages of each stencil, in order, against the pages the build produces
(composed book and XSL-FO), then every sentence of at least 28 letters of the stencil's front matter against the generated text.

| Page | Result |
|---|---|
| Order and set of pages | equal to each stencil. UHB has a System Name page and **no** Cautions / Notes page; MM and ORM have a Cautions / Notes page (a title, empty body) and **no** System Name page. Corrected |
| Cover | Code No. and Rev No., the notice, the title (one line for UHB, two for MM and ORM), publisher block: same. No INBR No. (exception 1) |
| Restriction on use, Record of changes, Abbreviations, Contents, Figures, Tables | same words |
| Foreword | had an extra "L&T Document No." line: removed. MM and ORM name "Defence Engineering Block" where UHB has "G Building": now per type. (ORM's stencil omits two punctuation marks in the address: normalised) |
| Associated Handbooks | headed "Sr. No. / INBR No." with a default list: now "Sl. No. / Document Title / Code No." with the stencil's eleven empty rows |
| Safety warning | pointed to "THE FOLLOWING PAGE" where the stencils say "OVERLEAF": corrected |
| Demolition | wording differed ("COMMANDER/ COMMANDING OFFICER", capitalised list terms): now the stencils' |
| Cautions / Notes (MM, ORM) | printed invented sample cautions: now the stencils' title with an empty body |
| Description of symbols | MM and ORM say "Denote ..." where UHB says "Denotes ...": now per type |
| First aid | same, except one word (below) |

## 8. Remaining differences from the stencils (not hidden, not resolved)

**Typography and layout**
* **Heading 3 and below** are set in the body face (Arial Bold); only Heading 2 has a font of its own, because the stencils' other heading styles are Arial Bold already. Where the **Arial Narrow** files are not installed (they are proprietary and git-ignored) headings fall back to Arial / Liberation Sans, which is wider.
* **Arial** itself is likewise a proprietary, git-ignored file; without it Liberation Sans (same widths, different glyph shapes) is used.
* **Lower heading levels** (Heading 4 and 5) have their text at the engine's derived position rather than the stencils' 17 / 20 mm hanging values: only level 1 was corrected.
* **Paragraph line spacing** is 1.15 as the stencil's L2-Para; the stencil's Normal style is single spaced (used by headings and tables).

**Front matter and branding**
* **First-aid page:** one word differs from the stencil: "force the jaw forward from" (ours) / "forwards" (stencil). The page is a shared static file the S1000D direct engine copies as well; the engine's generator cannot emit its closing line, so it could not be moved into the JSS-only template without losing that line.
* **Empty list of figures** prints nothing; the ORM stencil prints Word's own message "No table of figures entries found" (not content).
* **The stencils duplicate the Demolition page** (UHB prints it twice, with slightly different capitalisation); we print it once, in the wording MM, ORM and UHB's second copy share.
* **Emblem and publisher logos** (`Media/Satya.png`, `JACKSON.png`) are not in a new project until uploaded under Settings > Branding, as for every existing project; the cover prints without them. Branding stays in Settings.
* The Cautions / Notes page of MM and ORM carries no body: the stencil's body is the instruction "<<Choose appropriate options from DTFXXX.doc>>", which is for the author, not content.
* The pages are checked for text, order and structure; their **look** (borders, red boxes, positions on the page) was compared by eye against the stencil renders only for the cover and the body, not measured for every front-matter page.

**Editor and structure**
* Rows and columns of a table that has merged cells cannot be added or removed until the cells are split (merging and splitting themselves work; the grid is validated by the server).
* A document that lists content after a sub-section is an error on the server (`JSS-ORDER`, and the schema); the editor opens it, shows the content where the PDF prints it, and marks the document unsaved so the next save writes it in order.

**Not built:** UHB2, TM_PI, DS, TOTE_and_CS, PRS (chapter manuals); parts-list, illustrations and single-table bodies (Vol_1_PL, Vol_2_Illustrations, MPL, ISPL, ISPL_wrt_JSS, MRLS, ROTABLE).
