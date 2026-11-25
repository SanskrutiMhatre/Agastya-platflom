# JSS Naval stencil analysis

Source: the ten Word stencils in `Sampels/NAval_stencil/` (read from their `word/document.xml`: headings, tables, section setup, headers/footers), compared with the PDFs the
platform builds from a new project of each type. Land types are in `JSS_STENCIL_ANALYSIS.md`; the vendor changes are in `JSS_VENDOR_EXCEPTIONS.md`. Customer documents are not copied
into the repository; the tests read the stencils from `Sampels/` and skip when the folder is absent.

Everything below is classified: **From the stencil** (read, not chosen), **Assumed** (the stencil does not settle it; the choice is named so it can be changed), **Not done**.

## 1. The ten types

| Wizard type (`id`) | Stencil | Family | Body | Body page | Chapters |
|---|---|---|---|---|---|
| User Handbook (`naval-uhb`) | `1_User_Handbook` | handbook | chapter manual | A4 portrait | fixed, from the stencil's headings |
| TM Part I Technical Description (`naval-tm-1`) | `TM_Part-I_Technical_Description` | handbook | chapter manual | A4 portrait | fixed |
| TM Part II Maintenance (`naval-tm-2`) | `TM_Part-II_Maintenance` | handbook | chapter manual | A4 portrait | fixed |
| TM Part III Overhaul (`naval-tm-3`) | `TM_Part-III_Overhaul` | handbook | chapter manual | A4 portrait | fixed |
| TM Part IV Vol 1 Parts List (`naval-tm-4-1`) | `TM_Part-IV_Vol1_Part_List` | parts | parts list | A4 landscape | the author's (one per system / sub-system) |
| TM Part IV Vol 2 Illustrations (`naval-tm-4-2`) | `TM_Part-IV_Vol2_Illustrations` | parts | illustrations | A4 landscape | the author's, three levels |
| Design Specification (`naval-ds`) | `Design_Specification` | handbook | chapter manual | A4 portrait | fixed |
| MRLS (`naval-mrls`) | `MRLS` | list | one wide table per section | **A3 landscape** | one chapter, sections |
| Complete Equipment Schedule (`naval-ces`) | `Complete_Equipment_Schedule` | list | four tables | A4 portrait | one chapter, four fixed sections |
| List of SMT / STE (`naval-smt-ste`) | `List_of_SMT_STE` | list | one table + figure sheets | A4 landscape | one chapter, no sections |

*Fixed* = the registry type refuses other chapters (`JSS-CHAPTERS`) and the editor offers no add/remove; *the author's* = free chapters (`chapterRule: 'free'`), added/removed/moved in
the editor, numbers renumbered.

## 2. From the stencil

* **Frame by family.** Handbooks and Part IV: Record of Changes (4 columns), Associated Handbooks, Change Notice, 2-column Abbreviations, SAFETY WARNING with the "SEE OVERLEAF" line.
  Lists: AMENDMENTS (5 columns), WARNING page of their own (four lines, no "see overleaf" line), "DEMOLITION OF EQUIPMENT TO PREVENT ENEMY USE", numbered Abbreviations
  (Sr. No. | Abbreviations issued | For), symbols with "Denote ..." legends, then Contents; no Associated Handbooks, Change Notice or Cautions page. Vol 2 has no Abbreviations page.
  Built and asserted in `jss-naval.test.js` (three frame tests).
* **No chapter divider** in the list stencils and the Part IV volumes: the chapter heading is the first thing on the first body page, numbered 1-1 (`chapter.divider = 0`).
* **Foreword** per stencil, all ten compared against the stencil text: e-mail `defence@larsentoubro.com` for UHB, TM I-III and Vol 2, `PESDT@larsentoubro.com` for Vol 1, DS, MRLS, CES and SMT/STE;
  company lines "L&T Defence" / "L&T PES" / "L&T Precision Engineering and Systems"; five different postal addresses (registry `ADDRESS_*`); "Document No." label on the SMT/STE foreword.
* **Cover.** Publisher block "L&T Precision Engineering and Systems, LARSEN & TOUBRO LIMITED" on every stencil (the Land house template says "L&T Defence,"); the list stencils carry a
  Code No. and no INBR No.; the notice differs between handbooks ("... NOT HOLDING AN OFFICIAL POSITION IN THE SERVICE OF GOVERNMENT OF INDIA") and lists ("... NOT AUTHORISED TO RECEIVE IT").
  Cover title lines are the stencils' (two or three lines, split with `cover.title.split`).
* **Tables**, with the stencils' own heads, merges and proportional widths (the stencil's Word column widths in mm, kept as `N*` proportions): parts list (10 columns), MRLS (14 columns on an
  18-column grid, "Recommended Nos." spanning five), CES (four tables), SMT/STE (11 columns, "Recommended numbers of Qty." spanning four). A test compares every head cell and merge with the stencil's XML.
* **Page sizes**: MRLS body A3 landscape (420 x 297 mm), SMT/STE, Vol 1 and Vol 2 body A4 landscape (297 x 210 mm), the others A4 portrait throughout. Read from the built PDFs' `/MediaBox`.
* **Headings** of every fixed type, in the stencil's order and to the depth it shows (`registry-naval.ts`, `*_CHAPTERS`); a test checks that a new project of each type validates and that a
  type with fixed chapters refuses others.

## 3. Assumed (not settled by a stencil, named so they can be changed)

1. **Vol 1 parts table.** The stencil refers to "Annx XIV" for the page format and does not include it. The ten columns, widths and the `[1]..[10]` numbering row are those of the **Land `Vol_1_PL`
   stencil** (same publisher; the Naval text itself speaks of Column (8) "P" and Column (9) DS Cat. No.). If the Naval annex is supplied, `PARTS_TABLE` is the one place to change.
2. **Vol 1 landscape.** The body is landscape because ten columns do not fit a portrait text area (as in the Land Vol 1); this was a layout choice, not read from a landscape section of the Naval stencil.
3. **MRLS sections.** Which sections an MRLS has depends on the equipment; the registry starts with five (Mechanical, Hydraulic, Electrical/Electronic/Navigation, Winch, IPP) and marks the last
   four `example: true` so they are easy to remove or rename.
4. **SMT/STE figure sheets** are authored as figures under the heading "Figure / Diagram of Special Maintenance Tool (SMT) and Special Test Equipment (STE)"; the figure numbering and
   caption style is the platform's, not the stencil's.
5. **Widths are proportions, not millimetres.** The pipeline uses one set of page margins for every orientation, the stencils use different margins on their landscape sections; a fixed width
   would overflow the narrower text area. The columns keep the stencil's relative widths.
6. **Landscape and A3 margins** are the pipeline's, not the stencils' (see 5).
7. **Stencil typo corrected:** "Safety Intsructions" (TM Part II heading) is written "Safety Instructions", as for the Land types; the stencil itself is not edited.
8. **Design Specification cover**: no INBR No. line on the cover (`coverInbr: false`), Code No. only, as the other stencils without it.
9. The **headings of a type with free chapters** (Vol 1, Vol 2) start from one placeholder chapter ("System or Subsystem Name") taken from the stencil's own placeholder.

## 4. Not done / known differences (not hidden)

* **Blank-row counts of the placeholder Abbreviations table** differ between stencils (UHB 9, TM I 13, TM II 12, TM III 13, Vol 1 9, DS 33 rows); the engine prints 9 (2 columns) or 16
  (numbered), whatever the stencil. They are empty placeholder rows an author replaces with the list; no content differs.
* **Headers and footers** are the pipeline's page furniture (running title, "Page | n" folios, RESTRICTED) for every type; the Naval stencils' own header/footer variants (e.g. the header
  "User Handbook / System Name", the `<<Project Name>> (xx) RESTRICTED` footer of the list stencils) were **not** compared one by one. Not completed.
* **Look, not measured:** borders, positions on the page and fonts were compared by eye on the Land types' renders; for the Naval PDFs the text, order, page sizes, table heads and columns are
  asserted, but no raster comparison could be made here (no page rasteriser in this environment). The editor's on-screen look of the new types was not checked in a browser.
* **Unresolved image warnings** (`Media/...`): since the owner's commit c4bc7bf (section 7) the emblem and the first-aid figures of a project that has none are the shipped stencil artwork, so only the author's own illustrations can still be unresolved until they are uploaded under Settings > Branding. (Read from the code, see section 7; not re-checked per Naval type.)
* **Land Vol 1 / Vol 2** (separate Land types) are untouched.

## 5. Root causes found and fixed on the way

| Symptom | Root cause | Fix |
|---|---|---|
| a `<pageBreak/>` in a chapter vanished from the PDF | the chapter template selected `para | list | table | figure | note | warning | caution` only | `chapter.pageBreak` (vendor exception) |
| the editor rejected a landscape chapter | `parseJss` is strict and `Chapter/@orientation` was unknown to it | `orientation` in the model and XML reader/writer |
| MRLS head check warned on the author's wording | a head cell can hold an author's words | `HeadCell.open` |
| isolation guard failed on the date | the S1000D baseline prints the build date | `capturedOn` in the baseline; today mapped to it |
| cover said "L&T Defence," | publisher is a house-template value | `publisher` on the registry type, copied into the project |
| the list types printed a divider page, the Change Notice table, a 2-column abbreviations table and the first-aid line | the frame was the handbook's | `chapter.divider`, `roc.layout`, `abbrev.layout`, `safety.footer.show` (vendor exceptions) |

## 6. After the merge with the ancillary-pages commit (2026-11-24)

The owner's commit eb43711 added the Ancillary pages editor (which pages print, their headings, the XML of each), six heading levels for chapter manuals, notices that hold lists, 21 pt chapter titles and
full-width tables and notices. How the Naval types meet it:

* **Six heading levels.** The five Naval chapter manuals (UHB, TM I-III, DS) take `maxDepth: 6` like the Land chapter manuals. Part IV Vol 1 / Vol 2 and the list types keep their own limits (2, 3, 2).
* **One list of pages the stencil does not have.** The build (`composeBook`) and the Ancillary pages editor both read the registry's `omitPages` (the old `frontPages` of the Land types is the same idea and is gone).
  The owner's editor read `frontPages`, which the Naval types do not set; left like that it would have offered pages that never print (e.g. Vol 2's Abbreviations).
* **The stencil's own page list survives a choice.** The list stencils bring their own order and choices (Demolition before First aid, the Contents last, no Associated Handbooks, "AMENDMENTS"). Saving an
  ancillary choice used to rewrite the whole list from the catalogue: it switched the pages the stencil leaves out back on, dropped the headings and reshuffled the book. It now starts from the list in
  force and keeps its order (`saveAncillaryChoices`, tested in `jss-naval.test.js`).
* **A list in force that is an array replaces, it does not merge** (`applyJssFrontMatter`): the safety warning's lines and the page list are lists; spreading a list into an object would turn it into `{0:..., 1:...}`.
* Not done: the Ancillary pages editor was not opened in a browser for a Naval project, and the playwright spec of the owner's commit (`frontend/e2e/jss-editor.spec.ts`) was not run (it needs the app and a browser).

## 7. After the merge with the JSG / default-artwork / import-export commits (2026-11-25)

The owner's commits c4bc7bf (JSG Word import and editors, default stencil artwork for every JSS book) and d727032 (import of a finished project package into a JSS document, export back as a package)
met the Naval work. The text merge was clean; what was checked on the combined code:

* **Default artwork** (`applyDefaultArtwork` in `publisher.ts`): a JSS project with no emblem, no Larsen & Toubro publisher logo or no first-aid figure of its own prints the pictures of the JSS-0251
  stencils shipped in `vendor/pipeline/jss/artwork`. A file the project has always wins, so the Naval types keep the publisher logo they copy into the project (`Media/publisher-logo.png`, `NAVAL_PUBLISHER`).
  The Naval list stencils have no first-aid page, so they print no first-aid figures; the Naval handbooks and Part IV print the JSS-0251 figures. **Assumed:** the pictures of the Naval stencils
  were not compared with those of the Land stencil. If they differ, the project's own `Media` files override the defaults.
* **Import / export of a project package** (`services/jss/rwi`): the importer reads the project's registry type (`maxDepth`, `id`, default book name), so it works for the Naval types as it does for
  the Land ones. A package is a chapter-by-chapter body: into a type with **fixed chapters** (UHB, TM I-III, DS, MRLS, CES, SMT/STE) the imported chapters will not match the stencil's headings and the
  document check reports it (`JSS-CHAPTERS`), as it should; it is meant for the types with the author's own chapters. Not exercised for a Naval type here; the package sample the owner's tests use
  is not in this checkout, so four of its tests are skipped.
* **Isolation baselines** (`jss-cover-isolation`): `legacy-jss-uhb` and `s1000d-via-jss` re-captured again, because default artwork is applied to both. With `applyDefaultArtwork` switched off all three builds gave
  the previous values byte for byte; with it on the only differences are the `src` of the emblem, publisher-logo and first-aid pictures and the first-aid box height (115 mm to 145 mm). The direct S1000D engine did not move.
* **Not run:** `pdfimages` (used by the owner's first artwork test to count the pictures in the PDF) is not installed here, so that one assertion could not run; the same test's `artwork/...` checks on the XSL-FO are
  what the isolation probe above confirms.
