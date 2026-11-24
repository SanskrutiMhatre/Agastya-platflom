# RWI project import and export for JSS: investigation and architecture

Date: 2026-11-24. Status: Phase 1 (investigation) is complete and recorded here; sections 5-8 are the design the implementation follows. Every number below was measured on
`SAMPLE PROJECTS/JSS-0251/RWI.zip` (10.3 MB, extracted into a scratch folder; nothing in the repository was changed to produce this report). The sample is the **only** RWI package available: where this
report says "the RWI format", it means what that one package shows. No specification of RWI itself was supplied, and the meaning of the name "RWI" is not stated anywhere in the files.

## 1. What the package is

```
RWI.zip
  RWI/
    PMC-IETM.xml                 the publication module   (S1000D <pm>, 18.6 KB)
    XML/DMC-GAV-A-00-00-00-NN A-040A-D.xml   33 data modules, NN = 01 .. 33   (S1000D <dmodule>, 3-54 KB each)
    ICN/ICN-GAV-000000-1-00000-NNNNN-A-001-01.png   109 illustrations   (PNG, 8-bit, 22-80 KB)
```
No manifest, no DDN/delivery note, no BREX, no applicability tables, no `.pdf`. 146 zip entries, nothing encrypted, 10.2 MB uncompressed.

It is **standard S1000D Issue 4.2 content** (`xsi:noNamespaceSchemaLocation=".../S1000D_4-2/xml_schema_flat/descript.xsd"`), not a private XML dialect. Every module is a `descript`
module (information code 040), validated with the platform's own validator: **33 of 33 modules are schema-valid, 0 errors**. The publication module is **not** valid against `pm.xsd` 4.2 (2 errors, section 2.2).

## 2. Findings

### 2.1 Data modules
* Root `<dmodule>`, UTF-8 (valid, no replacement characters), 19 of 33 carry a DOCTYPE whose internal subset declares each picture: `<!ENTITY ICN-... SYSTEM "ICN-....png" NDATA PNG>` with `<!NOTATION PNG SYSTEM "PNG">`.
  The entity target is a **bare file name** while the files are in the sibling `ICN/` folder, so the declared path does not resolve from `XML/`; pictures have to be found *by name* in `ICN/`.
* Identity is the same in every module: model code `GAV`, system `00`, sub-system `0`/`0`, assembly `00`, disassembly code **01..33** (the running number), information code `040A`, location `D`; issue `001-00`; language **`en` / country `IN`**;
  file name = the code (no `_001-00_EN-US` suffix); all 33 file names match their own code.
* `dmTitle` is a **placeholder in every module** ("System" / "Maintenance Procedure"). The real title is `levelledPara/title` inside the content, and the publication's `dmRef` carries a third wording
  (e.g. PMC "Purpose", module "Purpose"; PMC "Features", module "FEATURES"; PMC "SYSTEM SPECIFICATIONS", module "SYSTEM SPECIFICATIONS"). Using `dmTitle` would name every section "System".
* `dmStatus` is template boilerplate (security 01, enterprise code `12345`, empty `applic`, brex reference to `S1000D-H-04-10-0301-00A-022A-D`, `qualityAssurance/unverified`).
* Content vocabulary (all 33 modules, 5,070 elements): `levelledPara` (135, always titled, nested to 5 deep), `para` (2,031), `title`, `sequentialList`/`listItem` (99 / 430), `figure`/`graphic` (88), `symbol` (24),
  CALS `table`/`tgroup`/`colspec`/`thead`/`tbody`/`row`/`entry` (29 tables, 1,313 cells; `namest`/`nameend` spans 8, `morerows` 17), `note` (1), `warning` (1). **Nothing else**: no `emphasis`, no sub/superscript,
  no `proceduralStep`, no `internalRef`/`dmRef` inside content, no applicability.
* Patterns that have no direct JSS form: a **list inside a `para`** (99 times, including a list inside a list item's `para`); a **`symbol` (small picture) as the only content of a table cell** (all 24 uses are in
  table cells); `table/@frame`; figure/table `id`s (`fig-001`, `tbl-001` ...) that restart in every module (117 ids - 88 figures and 29 tables - use only 24 distinct values; none is repeated inside one module).

### 2.2 Publication module (`PMC-IETM.xml`)
* `<pm>`, code `MODEL / 00000 / 00001 / 00` (template defaults), issue 001-00, language `en`/`US`, enterprise `00000`/"ENTERPRISE", dated 2026-10-17.
* Seven titled `pmEntry` chapters - **exactly the seven chapters of the JSS User Handbook stencil**: Leading Particulars and General Data; Brief Technical Description; Unpacking and Removal of Preservatives;
  Preparation for Use and Installation Specification; Operating Instructions; User's Servicing and Maintenance Instructions; Miscellaneous. Each module sits in its own untitled wrapper `pmEntry`.
* **Defects of the source** (measured): (a) it names only **23 of the 33 modules** - 10 are orphans (09, 13, 14, 15, 16, 17, 19, 20, 21, 22; their titles - Payloads, AMDI, RADAR Altimeter, Avionics Suite, Power Supply Scheme,
  Parachute Recovery, Catapult Launcher, Launcher, Aircraft Fuelling Trolley, System Operation - and numbers show they belong in "Brief Technical Description" between the modules that are listed); (b) a stray empty `pmEntry`
  titled "User's Servicing and Maintenance Instructions" inside "Brief Technical Description" (a second, real chapter of that name is listed later); (c) schema errors: that empty entry, and `qualityAssurance` out of order;
  (d) **every `dmRef` says language `US`, every module says `IN`**, so a reference cannot be resolved by the full identity (it resolves by the module code alone); (e) the `dmRef` titles differ from the modules' own.

### 2.3 Illustrations
* 109 files; 112 distinct pictures are named by the modules (88 figure graphics + 24 symbols); **99 exist, 13 are missing from `ICN/`** (numbers 10, 11, 29, 31, 33, 36, 40, 48, 52, 53, 91, 92, 93 - the gaps in the numbering 1-122);
  **10 files are never used** (113-122). No picture is used twice. Sizes are normal (none above 4 MP).

### 2.4 Source defects that the JSS rules would otherwise reject
* **Two modules nest headings 5 levels deep** (18, 32); the JSS stencil allows 5 including the chapter, so their deepest level would be heading 6 (`JSS-DEPTH`).
* **One table is structurally broken** (module 32, "Maintenance Activities for electrical/Electronic System": declared 3 columns, rows of 3, then 8, 8, 8, 8, then 2 cells ...); JSS would refuse it (`JSS-TABLE-SHAPE`).
* One table (module 13) has no `colspec` for its declared column (harmless for JSS).

## 3. The native JSS side (read from the current code)

* The document is one file, `publication.xml`, root `<jssbook docType="uhb" schemaVersion="1.0">` = `<bookmeta>` + `<body>` of `<chapter number>`; a chapter or section holds blocks (`para`, `list`, `table`, `figure`, `note`, `warning`, `caution`,
  `pageBreak`) **then** its sub-sections. Inline text: `b i u sup sub br xref`. Lists `alpha|roman|number|bullet|dash`, nestable. Tables: optional `<title>`, `thead`, `tbody`, cells with `colspan`/`rowspan`/`align`; **a cell holds
  text, paragraphs and lists, not pictures**. Figures: `title`, `graphic[@src]` (a project-relative path such as `Media/x.png`), `legend/keyitem`.
  Identifiers: only optional `id` on chapter, section, table and figure (XML IDs, unique in the document). **No metadata beyond `bookmeta`** (no source identity, no issue/language/security).
* Server rules (`services/jss/service.ts`): the UHB body must have **exactly the stencil's seven chapters in order with those titles**; heading depth <= the stencil's limit (registry `maxDepth`, currently 6; the importer reads it from there); table grids consistent; a picture that is not in the project is an **error**
  (`JSS-GRAPHIC-MISSING`, blocks the PDF); `xref` targets must exist; a chapter's own content precedes its sub-sections.
* Persistence: `publication.xml` + `Media/` (pictures) + `project.json` (`authoring: "jss-xml"`, `jssDocType`) + `jss/frontmatter/*.xml` (the ancillary pages, a separate layer written from Settings).
  The editor round-trips `id`s on chapters, sections, tables and figures.
* **Existing S1000D-to-JSS converter** (`vendor/pipeline/s1000dtojss`, XSLT): a *render-time* transformation that feeds the PDF pipeline. It covers almost the same vocabulary, but it maps `levelledPara[title]` to
  sections, keeps only `@id`, turns `symbol` into a block `<graphic>`, flattens lists, drops everything it does not know and keeps **no source metadata** - it produces a disposable book, not an editable document with
  provenance. It is used here as a mapping reference only; it is not extended and not called.
* The platform also has an S1000D *package importer* (`services/importer`) for S1000D projects. It would accept this package as a generic/placeholder-codes S1000D set, i.e. as an S1000D project - not what is wanted here.

## 4. RWI (S1000D 4.2 `descript` + `pm`) versus native JSS

| Source construct | Native JSS | Class | Note |
|---|---|---|---|
| PMC top-level titled `pmEntry` | `chapter` (+ `number`, title) | **direct** | titles equal the stencil's seven (whitespace-normalised) |
| module (`dmodule`) | one top-level `section` of its chapter | **transform** | module = section; the section title is `levelledPara/title`, not `dmTitle` |
| nested `levelledPara` + `title` | nested `section` | **direct** | depth beyond the limit must be repaired (2.4) |
| `para` (text) | `para` | **direct** | |
| `sequentialList`/`listItem` | `list` (type `number`; nested: `alpha`, `roman`) | **transform** | style of nested levels is an assumption (S1000D carries none) |
| list inside a `para` | `list` block after the para's text; inside an item: nested `list` | **transform** | |
| `table` (CALS) | `table` (`title`, `thead`, `tbody`, spans) | **transform** | `colspan = nameend - namest + 1`, `rowspan = morerows + 1`; `frame`/`colspec` dropped; broken grids repaired |
| `figure`/`title`/`graphic` | `figure`/`title`/`graphic[@src="Media/<file>"]` | **direct** | the picture file is copied to `Media/` under its original file name |
| `symbol` as a table cell's only content | **no form** (a cell cannot hold a picture) | **loss risk** | kept in the source record and put back on export (4.1) |
| `note`/`warning` (+ `notePara`/`warningAndCautionPara`) | `note`/`warning` with `para` | **direct** | |
| figure/table `id` | `id` (made unique) | **transform** | `fig-001` repeats across modules: becomes `dm07-fig-001`; original kept in the source record |
| `dmCode`, issue, language, issue date, `dmTitle`, `dmStatus` | **nothing** | **loss risk** | kept in the source record (4.1) |
| PMC identity/status, entry wrappers, PMC titles | **nothing** (only chapters survive) | **loss risk** | kept in the source record |
| DOCTYPE entity declarations | **nothing** | derived | regenerated from the pictures a module uses |
| orphan modules (not in the PMC) | **nothing in the PMC to place them** | **decision** | placed by module number, reported (5.4) |
| ICN files not used by any module | **nothing** | **loss risk** | copied to `Media/` and kept (listed in the report) |
| missing ICN files | error `JSS-GRAPHIC-MISSING` | **conflict** | a labelled placeholder picture is written and marked; export does not ship the placeholder (5.5) |

### 4.1 What would be lost without a source record
Module identity (33 codes, issue, language, issue date), the original wording of titles (PMC vs module), the status/restriction block, the PMC's identity and entry structure (including wrappers and the stray entry), the original
file names, the figure/table ids, the pictures that no module uses, and the 24 symbols (not representable). JSS has nowhere to put these, and the schema must not change, so they go in a **source record beside the document**.

## 5. Import design (RWI ZIP -> extraction -> XML parsing -> validation -> mapping -> canonical JSS model -> JSS editor)

All code is in `backend/src/services/jss/rwi/`, separate from the S1000D code; nothing in `vendor/`, `services/importer/`, `publisher.ts` or the S1000D schemas is edited.

1. **Extraction** (`package.ts`): the existing guarded ZIP reader (`services/zipio`: ZIP-slip, bomb, CRC checks) reads the upload into memory (limits on entry count and size). **Recognition**: a folder holding `XML/*.xml` whose root is
   `dmodule`, one `pm` publication module, and an `ICN/` folder; names are matched case-insensitively and the root folder may be named anything. Anything else is refused with a plain message.
2. **Parsing** (`parse.ts`): each module and the publication module are parsed (the DOCTYPE entity declarations are read first, then the document). Identity, titles, issue/language, the `dmStatus` block (verbatim text),
   the content (verbatim text and a DOM). A file that is not well-formed is reported and skipped, not fatal.
3. **Validation** (`validate.ts`): schema validation against the shipped 4.2 schemas (module -> `descript`/declared schema, publication -> `pm`), reference checks (every `dmRef` resolves **by module code**, every picture exists,
   every orphan, every duplicate id), and structural checks (depth, table grids). Findings are **recorded, never fatal** (a package with source defects must still be importable); only "not a package" stops the import.
4. **Mapping** (`map.ts`) into the **canonical JSS model** (`canonical.ts`, a backend mirror of the editor's model, serialised by the backend with the same rules as the editor): the table in section 4. Repairs, each reported:
   - headings deeper than the stencil allows become a bold lead-in paragraph (text and content kept);
   - an inconsistent table is padded to its widest row (header and short rows get empty cells);
   - orphan modules are placed in the chapter of the nearest lower-numbered listed module, in number order; the stray empty publication entry is dropped;
   - a missing picture gets a placeholder PNG (the existing, recognisable "MISSING GRAPHIC" image) so the document stays valid and buildable; the placeholder is flagged so export never ships it;
   - a `symbol` in a table cell leaves the cell empty in JSS and is recorded against the table and cell position.
5. **Persistence**: `publication.xml` is written through the existing JSS save path (so the schema check and stencil rules run on it), pictures are copied to `Media/` (original file name kept), and the **source record** is
   written to `<project>/rwi-source/` (`manifest.json` + the original XML files verbatim). The result is an ordinary JSS project: the normal editor opens it, no new fields in the JSS schema.
6. **Link between the JSS document and the source record** uses the schema's existing `id` attribute: each imported module's section gets `id="dm-<module code>"`, tables and figures `<module>-<original id>`. The editor
   already preserves them; a section the author adds has no source record and is exported with generated metadata.
7. **Report** (`report.ts`): counts (chapters, sections, paragraphs, lists, tables, figures, pictures), and findings with a plain-language message, a severity and a location (the section title, not a code), covering every
   repair, missing picture, orphan, unsupported construct and source schema error. Stored in the source record and returned to the editor.

## 6. Export design (one Export action)

* **Serializers, not renames** (`export/`): a DM serializer (`<dmodule>` with identAndStatusSection and `description` content, DOCTYPE with the picture entities), a PMC serializer (`<pm>` with a `pmEntry` per chapter and a `dmRef` per
  module), an illustration collector (ICN files). The JSS `publication.xml` is never copied or renamed into the package.
* **One module per top-level section**; a chapter's own introductory content (content before its first section) becomes one extra module titled after the chapter. Nested sections become nested `levelledPara`; tables become CALS tables with
  `colspec`s; lists become `sequentialList`; `xref` to an element of the same module becomes `internalRef`.
* **Identity**: for an imported project the original codes, issue, language, issue date, status block and PMC identity come from the source record; a module whose section was added gets the next free number. A project created natively
  in JSS is exportable **when its Publication code (bookmeta `projectCode`) is present** (it becomes the model identification code, upper-cased); otherwise Export says in plain words what to fill in.
  Defaults for what the JSS document does not carry (issue 001-00, language en/IN as in the sample, security 01, enterprise placeholder as in the sample) are stated in the package report.
* **Round-trip rule**: a module whose section is **unchanged since import** (compared on a canonical form of the section, not on whitespace) is written out **byte-for-byte from the stored original**; a changed module is regenerated by
  the serializer, re-attaching the stored symbols to unchanged cell positions. This makes an untouched import export identical per module, and every edit visible in exactly the modules it touches.
* **Package layout** = the sample's: `<root>/PMC-IETM.xml`, `<root>/XML/DMC-....xml`, `<root>/ICN/ICN-....png`, root folder name from the source record (else `RWI`). New pictures get names in the sample's pattern
  (`ICN-<model code>-000000-1-00000-NNNNN-A-001-01`).
* **Before packaging**: every generated module is validated against the 4.2 schema, the publication against `pm.xsd`, and the references are verified (every `dmRef` has a file, every entity a picture, every figure a declared entity,
  no id repeated inside a module); errors stop the export with plain messages, warnings go into a report file inside the package.
* Differences from the original that cannot be avoided are listed in section 9 and written into the export report.

## 7. User experience

Only two actions in the JSS project: **Import project** (a ZIP) and **Export**. Messages say sections, pictures, tables and "the package"; DMC / PMC / ICN / S1000D appear only in the technical report file and in this document.
After import the user lands in the normal JSS editor with a short summary ("33 sections and 109 pictures imported; 13 pictures were missing and are marked; 10 sections were placed by number") and can open the full list.
Export downloads one ZIP and shows the same kind of summary. Import replaces the project's document (the editor asks first); it is available to editors, export to anyone who can see the project.

## 8. Test plan (implemented with the code)

Recognition and refusal of non-packages; parsing of the real sample; mapping counts and structure (chapters, sections, lists, tables with spans, figures, notes); id uniqueness; reference preservation (original codes, titles, language,
file names, status block); assets (copied, missing placeholders marked, unused kept, symbols recorded); repairs (depth, table, orphans, stray entry) with their report entries; editing after import (the document passes the JSS checks and a
PDF builds); export (layout, schema validity of every module and the publication, reference check, picture names, round trip); unchanged modules byte-identical; edited module differs only where edited; native JSS export
with and without a project code; isolation (no S1000D/JSS engine file changed; JSS regression tests unchanged).

## 9. Assumptions, open points and expected differences

* **The expected package structure is inferred from one sample.** If the consumer of the export needs anything the sample does not show (a manifest, a DDN, different file naming), it is not known and is not produced.
* Nested list style (alpha, roman), the placement of orphan modules and the padding of the broken table are **decisions**, reported on import, and easy to change in `map.ts`.
* A symbol in a table cell is not editable in JSS; it is kept and restored only into the same cell of an unchanged-shape table.
* Expected export differences against the sample: the publication module lists all 33 modules (the source listed 23), the stray empty entry is gone; the status block of the publication is kept as received, so its own schema problem (qualityAssurance before applic) remains and is reported as a warning; the 13 missing
  pictures stay missing (a placeholder is never exported); titles in the publication follow the section titles of the document; any module the author edited is regenerated (equal in meaning, not byte-identical).
* Not covered by the sample, therefore designed but unproven against real data: modules of other types than `descript`, applicability, `internalRef`/`dmRef` inside content, other picture formats, other languages.

## 10. Implementation status (what was built and verified)

Code (all new, isolated; nothing in the S1000D engine, the JSS XML schema, the JSS engine or the vendor pipeline was changed):

* `backend/src/services/jss/rwi/` - `source.ts` (extract, recognise, parse), `validate.ts` (source schema + reference checks), `map.ts` (package -> canonical model), `canonical.ts` (model, JSS XML writer/reader), `record.ts` (source record), `importer.ts` (orchestration), `serialize.ts` (DMC / PMC / ICN serializers), `exporter.ts` (plan, checks, files), `report.ts`.
* `backend/src/routes/jss-rwi.ts`, registered in `app.ts`: `POST .../jss/import-project`, `GET .../jss/import-report`, `GET .../jss/export-check`, `GET .../jss/export`.
* Frontend: `frontend/src/jss/PackagePanel.tsx` (Import project / Export buttons and a plain-language report), `api/jss.ts` (`packageApi`), one line in `JssEditorPage.tsx`.
* Tests: `backend/test/jss-rwi.test.js` (real RWI.zip: 33 documents, 7 chapters, 13 placeholders, 10 placed by number; unchanged export is byte-identical for all 33 documents and the same ICN set; one edit rebuilds exactly one document and the contents list names all 33; native export needs a project code and produces schema-valid documents; refusals; route guards).

Verified: `tsc` clean (backend, frontend); `jss-rwi`, `routes-guarded`, `jss-stencil-corrections`, `jssdm` suites green (46 tests).
Pre-existing and unrelated: `jss-authoring` "default artwork" needs the `pdfimages` tool, which is not installed on this machine.

Unavoidable / chosen differences of an exported package against the original:

1. Unchanged documents are written back byte for byte; an edited document is regenerated (same identity, status and file name; content equal in meaning, formatting normalised).
2. The contents list is regenerated: all documents are listed (including the 10 the original omitted), the empty entry is dropped, language is taken from each document. Its status block is kept as received.
3. Picture placeholders made for the 13 missing pictures are never exported; the references stay and are reported.
4. Not representable in the package format and therefore reported on export: lettered/roman list styles (exported as numbered), page breaks, a figure's numbered key, lists inside notes/warnings (exported as paragraphs).
5. Lists are written inside the preceding paragraph (the 4.2 schema does not allow a list directly in a section).
6. Native projects: modules are numbered from the project code and position; new pictures are given standard picture names; the project code is required.
7. A symbol picture inside a table cell is restored only when the table is edited in place (same row and column).
8. Schema checks of the source keep picture-entity declarations (NDATA only); any other DOCTYPE content is removed before checking.
