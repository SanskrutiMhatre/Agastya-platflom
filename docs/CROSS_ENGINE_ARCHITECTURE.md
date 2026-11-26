# Cross-engine compatibility and import system

Written 2026-11-26. Covers the brief "Cross-Engine Compatibility and Import System" (blank vs. imported JSS XML, packages from the older PDF Publication Tool, conversion between S1000D, JSS and JSG, document codes kept in the backend).

## 1. What was wrong (measured, not assumed)

| Observation | Cause | Fix |
|---|---|---|
| A package written by the older tool (`PDF_PublishingTool-main`, "JSS Publisher") imported into a blank JSS project with the **chapters empty** and its documents put "by number" into the last chapter | The older tool wraps the chapters in `Publication > "Chapter" > "1" > [chapter heading page, documents]`. The importer only looked for a chapter title at the **top level** of the contents list | `jss/rwi/map.ts` finds the chapter entry anywhere in the contents list; a numbered folder around it is the chapter's scope; the heading page it holds is not a section |
| Its **front-matter pages** (title page, foreword, lists, safety pages) appeared as body sections | Reserved information codes at the zero system code were not recognised by the importer | `jss/rwi/importer.ts` uses the existing `jssdm/reserved.ts classifyFrontMatter`; the pages are set aside, reported, and kept in the package record |
| Dozens of **false schema errors** ("`infoEntityIdent` is not a valid value of `xs:ENTITY`") | The older tool writes an empty `<!DOCTYPE dmodule []>` and never declares its pictures | `jss/rwi/validate.ts declareUsedPictures`: the pictures a document uses are declared **for the check only** |
| `note`, `warning`, `caution`, `acronymDefinition`, `dmRef` inside a paragraph or a cell were unsupported | Mapper vocabulary was descript-only | `map.ts`: their words are kept (notices led by NOTE / CAUTION / WARNING, a reference by its title) |
| Export of such a project reported every section as "not written to the package" | The exporter compared the file name with the code, but the older tool's file names carry `_001-00_EN-IN` | `exporter.ts` compares by code |

**On "blank JSS vs. imported JSS use different XML":** both are the same file, `publication.xml`, root `<jssbook>`, validated by `schemas/jss/jss-1.0.xsd`. The older tool's *own* JSS book (`s1000dtojss` output) is the same dialect (same vocabulary as the authoring XML). What differed was the **package** being read (S1000D data modules + publication module), not the authored XML. After this work an older-tool package and a blank project produce the same kind of document, and the S1000D side (DMC, PMC, ICN) is kept in the backend (section 3), not in the XML.

The vendored stage-1 stylesheets (`backend/vendor/pipeline/s1000dtojss`) are the older tool's own S1000D-to-JSS mapping and are **unchanged**. The importer maps the same S1000D structures into the authoring model directly.

## 2. Import of the older tool's packages

Accepted layouts (both verified):
- **flat** (data modules and the publication module side by side) — what the older tool ships and what the Xignal sample is;
- **`.jsspub.zip`** (the older tool's own export): `manifest.json`, `project/project.json`, `project/csdb/*`, `project/PM/publication.xml`, `project/Media/*`, `templates/*`. The reader is folder-agnostic and recognises files by content; non-document files are reported as ignored.

### Kinds of document that are mapped

The older tool maps more than descriptions. The importer now carries the same kinds into the editor's own blocks, the way the older tool's stage-1 stylesheet does (`vendor/pipeline/s1000dtojss/schemas.xsl`, read only):

| Kind (content root) | Becomes |
|---|---|
| description | sections, paragraphs, lists, tables, figures, notices (as before) |
| procedure | a section "Preliminary Requirements" (estimated time, tables for required conditions, personnel, support equipment, consumables, spares, and the safety notices; an empty group prints one "None" row), the steps, then "Requirements After Job Completion". A titled step is a section; untitled steps are one numbered list (lettered inside, roman inside that); a note, warning or caution inside a step stays in the step as a bold-led paragraph |
| fault isolation / fault reporting | one section per isolation step ("Isolation Step n" when it has no title) with its action, "Question: …", "Yes: …" and "No: …"; the isolation end points; descriptions of faults |
| crew | a section per reference card and drill; drill steps as a list; challenge / response pairs as a two-column table |
| illustrated parts catalogue | its figures, then one table "Illustrated Parts List" (figure-item, part number, CAGE, nomenclature with a dot for each indenture level, quantity, unit) |

What is not carried (reported, `content-mapped`): links, applicability, and other S1000D-only detail; a picture or table between steps ends the numbered list (a list in the editor cannot hold one) and the steps after it start again at 1 (`steps-split`). Any other kind of document (a checklist, a schedule …) keeps its text and is named in the report (`content-type`).

Measured on the real Xignal JSS-0251 package (customer data, not in the repository): 7 documents → 19 sections in the correct chapters; 17 front-matter pages and the chapter heading pages set aside; 0 false errors; export check has no errors (8 warnings for pictures that the sample does not contain).

## 3. Document codes kept in the backend (DMC, PMC, ICN, contents list)

`backend/src/services/xengine/` — `outline.ts` (a format-neutral outline of a JSS or JSG document), `identity.ts` (the rules), `project.ts` (facts from settings / SNS / an imported package, sync on save), `routes/identity.ts`.

Stored in `<project>/doc-identity.json`, **beside** the document; the editors' XML carries no codes.

Rules:
1. **From the structure, never random.** A chapter is a system (`01`, `02` ...), a section of it a sub-system (`1`..`Z`, then the next assembly row). When the project's SNS has a system row with the chapter's title, its system code is used; a sub-system row with the section's title gives the sub-system. A chapter that has imported sections keeps their system code for new sections.
2. **Made once and kept.** Reordering, renaming (matched by `id`, then chapter + title, then position) and moving a section never change its code. A removed section's code is **retired** and never given to another section; if the section returns, it gets its code back.
3. **Unique** inside the project (checked against every code ever made, imported ones included).
4. **Imported codes are kept as received** (`origin: imported`): DMC, publication code (issuer, number, volume, issue, language), picture names (`ICN-…`). Importing a package renews the record from the package.
5. **Hidden by default.** `show: { dmc, pmc, icn, toc }`, all `false`. The data is always kept and returned; `show` says what the editor displays.
6. Model code: project settings' MIC, else the document's Project code, else the book / project name; changeable (`PUT …/identity`), which rewrites the model code in every *generated* code (imported ones are never touched). Patterns: model code 2–14 `[A-Z0-9]`, issuer 5, number 5, volume 2.
7. ICN: `ICN-<MIC>-<diff>-<system><sub><subsub><assy>-1-<enterprise>-<seq5>-A-001-01`; a picture already named `ICN-…` keeps its name.

The JSS exporter now uses these codes for sections the package never had (it used to number them positionally in system `00`), and the publication code and picture names. The model code in a generated code is still the document's **Project code** when one is set (the owner's existing contract: native export asks for it).

Routes: `GET /api/projects/:id/identity`, `PUT …/identity`, `PUT …/identity/visibility`. Saving a JSS or JSG document keeps the record in step (best-effort; a save is never refused because of it).

## 4. Conversion between formats

`services/xengine/convert.ts`, `routes/xengine.ts`, `jsg-model.ts`. Every conversion makes a **new project**; the source is never changed; whatever the target cannot hold is a **finding** (nothing is dropped silently); a failed conversion deletes the half-made project.

| From → To | How | Verified by |
|---|---|---|
| S1000D → JSS | the package importer (older tool's mapping), codes and originals kept in the package record, identity seeded from it | `xengine-convert`, `xengine-legacy-import` |
| S1000D → JSG | same mapping onto the JSS User Handbook chapters, written as a JSG document (empty chapters left out) | same |
| JSS → JSG | block for block; sub-sections become clauses; a chapter's own text becomes a first section of the same name | `xengine-convert` |
| JSG → JSS | chapters matched by title, else by position when the counts agree, else added to the last chapter; appendices become sections of the last chapter | same |
| JSS → S1000D | exporter → the platform's own S1000D importer into a new S1000D project | same |
| JSG → S1000D | JSG → JSS (short-lived copy, deleted) → as above | same |

Import with a choice of source and target: `POST /api/xengine/import` (`file`, `source` = `auto|s1000d|jss|jsg`, `target`, `name`). A `.zip` is an S1000D package (or the older tool's export); an `.xml` is one JSS or JSG document. A mismatch between the chosen source and the file is refused in words (`WRONG_SOURCE`). `GET /api/xengine/formats` lists the conversions.

What cannot be carried (reported each time): JSG front pages (made by the target from its settings), JSG ISPL plates and parts (an ISPL is refused: no counterpart), pictures inside JSG table cells, JSS figure legends, JSS links to outside addresses, lists inside notices, headings deeper than the target allows (written as a bold line).

## 5. User interface

- One import dialog: **New project > Import a package** (the Projects page's **Import package** button opens the same dialog). Step 1: choose the file (.zip or .xml). The server's first look (`POST /api/projects/import/detect`: entry names of a zip, the root element of an xml) is shown as a guess; the person **confirms it or chooses again** (S1000D package / JSS document / JSG document). A choice the file cannot satisfy is explained at once (a .zip is never a JSS document; an .xml is never a package; a JSG ISPL is not convertible) and nothing is sent until it is confirmed. Step 2: name, folder and what to import it as (S1000D, or JSS / JSG with domain and manual type). S1000D to S1000D is the platform's ordinary S1000D import; every other pair is a conversion (`/api/xengine/import`, which honours folder, domain and manual type), and its findings are shown before the new project is opened.
- The Administrator's enterprise lists (RPC / Originator CAGE codes) are an S1000D authoring rule: they refuse an import **into an S1000D project** only. A package imported as JSS or JSG keeps the enterprises as received and the report says how many were not in the lists.
- JSS and JSG editors (toolbar): **Codes** — the four switches (all off), the publication identity, the table of sections and pictures with their codes; **Convert** — choose the target, see the findings, open the new project.
- A strip under the toolbar appears only for what is switched on.

## 6. Project archive: Export of a whole project (2026-11-26)

`backend/src/services/projectArchive.ts`; routes `GET /api/projects/:id/export` (any format; needs read access) and the archive branch of `POST /api/xengine/import`;
`POST /api/projects/import/detect` adds `archive: { format, domain, manualType, name }` when the upload is one.

- **File:** `<project id>.jsspub.zip`, the older tool's layout (`manifest.json`, `comments.json`, `project/**`, `templates/<ref>.house.json`, `templates/brand/<id>/**`). The manifest has
  `generator: "Agastya"`, `manifestVersion: 1`, the `format`, `domain`, `manualType`, `templateRef`, and for S1000D the project's `settings` (the same record a project package carries).
- **What is left out:** what a build writes again (the PDF, the FO, the driver stylesheets, `_` files, the validation and publish state, backups).
- **Restore:** always a NEW project of the same format; nothing is overwritten. Names and XML are checked before anything is created (zip-slip, the XML safety guard, a newer
  manifest, no `project.json`); a failure part-way removes the half-made project. The house style and brand pack are written only when the workspace has none of that name. For S1000D the configuration is
  derived from the data modules (they win, as for every import), and a project with no data module yet gets its model code, issue and language back from the manifest. Review comments come back under the
  person who imports, each naming its first author and date; resolved ones stay resolved.
- **Different format:** an archive is imported as what it holds. To change format, import it and use Convert (section 4).
- **Verified:** `backend/test/project-archive.test.js` (JSS edited with a comment, JSG, S1000D with a data module and settings, the imported copy exported again, refusals, read access).
- **Not verified:** a real older-tool `.jsspub.zip` was never seen; ours follows its documented layout, so that tool reading ours (and ours reading its) is untested.

## 7. Status

**Completed and verified by automated tests** (`xengine-identity` 11, `xengine-legacy-import` 5, `xengine-content-types` 2, `xengine-convert` 7, the owner's `jss-rwi` 7 on the real RWI sample, `jss-naval` and `jss-cover-isolation` 6 unchanged: 64 backend tests; frontend 252 unit tests):
- chapters, front matter, heading pages, false errors and inline notices of the older tool's packages (both layouts); imported codes kept; export of such a project without false errors;
- procedures, fault isolation, crew and parts documents imported as sections, numbered lists and tables, in order;
- the front-matter pages and chapter heading pages of an imported package go out again in the older tool's own layout (publication entry, "Front matter", "Chapter" > number > heading page + documents), and the exported package imports back to the same document and the same codes;
- codes: deterministic, unique, stable under reorder / rename / removal, imported kept, hidden by default, changeable, JSS and JSG; the project's SNS rows decide the system and sub-system a section gets, and the sub-systems the rows name are given out before the free ones;
- the section code beside each heading in the JSS editor and in the JSG User Handbook editor, drawn only when the "Document codes (DMC)" switch is on, never part of the document (unit tests);
- all six conversions and the source/target import with source checking.

**Verified, but only on one real package:** the older tool's real Xignal package (measured by hand, not kept as a test because it is a customer document).

**Implemented, type-checked, not verified in a browser by me:** the Codes / Convert / Import package screens and the section badges (frontend `tsc` and unit tests pass; no automated browser test for these screens).

**Externally blocked (this machine):** `jss-authoring`, `jsg-engine`, `jsg-ispl` have 4 tests that need `pdfinfo` / `pdfimages` (Xpdf here has `pdftotext` only). They fail the same way without these changes.

**Not completed:**
- The older tool's own `.jsspub.zip` export and a package with procedural, fault or crew data from the real tool have not been seen: the mapping follows its stylesheet and export code, and is tested on small synthetic packages in the same shape. A real package may show a difference.
- Our output has not been compared page by page with the older tool's PDF of the same package.
- ICN and contents-list badges are in the Codes panel and strip, not beside each picture or contents line in the editor; the section code (DMC) is beside each heading.
- A picture or table between two steps ends the numbered list (the editor's list cannot hold one); the next steps restart at 1. Reported on import.
- A project imported before front-matter pages were kept cannot have them put back; the export says so and asks for the package to be imported again.
- The JSS ↔ JSG round trip is checked for content and structure, not for byte-identical XML; JSG ISPL is not convertible.
- S1000D → JSS/JSG relies on the contents list's chapter titles matching the stencil's; unmatched headings go to the last chapter (the owner's existing rule, reported).
