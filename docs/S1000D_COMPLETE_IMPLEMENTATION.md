# AGASTYA V2 - complete S1000D implementation (Phase 17): architecture and behaviour

This document describes what Phase 17 added and how it works. The statement of what is and is not compliant is in
[S1000D_COMPLIANCE_MATRIX.md](S1000D_COMPLIANCE_MATRIX.md); the earlier phases are in [S1000D_REFERENCE_CONFIG.md](S1000D_REFERENCE_CONFIG.md).

Every behaviour below was decided with the project owner before it was built (the decisions are repeated where they matter). Where the S1000D
specification text was available only for Issue 4.2, anything specification-dependent in 5.0 / 6.0 / 7.0 is marked UNVERIFIED rather than assumed.

## 1. The document-type registry

`backend/src/services/registry.ts` is the one list of document types: schema (XSD stem), name, category (data module, PM, DML, DDN, comment, update,
SCORM, IMF), the S1000D file-name prefix and, for data modules, the default information code. Which issues *have* the XSD is **read from
`backend/schemas/<issue>/`**, never typed in (`coverage()`), so a cell is "missing" only because the file is missing.

* The 21 data module types are unchanged; the Administrator "DM types" seed is derived from the registry (`dmTypeSeed()`), not a second list.
* Adding a verified type = put its XSD under `backend/schemas/<issue>/`, add one entry to `DOC_TYPES`, (a template in the editor and a rendering rule if
  it must render). Validation, the coverage matrix, the project type filter and the HTML/PDF fallbacks pick it up.
* `GET /api/s1000d/coverage` and Administrator > Standards coverage show the generated matrix.

Not invented: no TECHREP / JSS / JSG types; no 7.0 DDN / Comment / Update / SCORM (the schemas are not bundled).

## 2. CSDB objects other than data modules (`csdbObjects.ts`)

DML, DDN, COM (comment), UPF/UPE (data update file), SMC/SME (SCORM content package) and IMF (ICN metadata) live beside the data modules in `csdb/`.
File names follow S1000D Issue 4.2 Chap 7.5.1 (control number from the object's own identification section; upper case):

| Object | File name |
|---|---|
| DDN | `DDN-MI-SENDER-RECEIVER-YEAR-SEQ.XML` |
| DML | `DML-MI-SENDER-T-YEAR-SEQ_III-WW.XML` (T = c/p/s from `dmlType`) |
| COM | `COM-MI-ORIGINATOR-YEAR-SEQ-T_LL-CC.XML` (the 4.2 examples also use `_LL_CC`; both are accepted) |
| UPF / UPE | `UPF-<update code>_III-WW_LL-CC.XML` (UPE with the identExtension prefix) |
| SMC / SME | `SMC-MI-ISSUER-NUMBER-VV_III-WW_LL-CC.XML` |
| IMF | `IMF-<ICN without ICN->_III-WW.XML` |

`validateObject` refuses unsafe XML (XXE / entity bombs - never lenient), a wrong root element and a file name that does not match the identification.
`GET/POST/PUT/DELETE /api/projects/:id/objects[/:file]`, `POST .../objects/new` (templates), `GET .../objects/:file/html`, `POST .../objects/:file/pdf`.
Comment and Update are **document-type support only** (template, XSD validation, import/export, HTML + PDF rendering, DML references). There is no
comment-and-answer workflow (future scope, as decided).

Templates (`objectTemplates.ts`) are built per issue from the bundled schema and **validated against it before being returned**. DML and DDN are
generated (`dispatch.ts`), also validated; the SCORM package is imported, not authored.

## 3. Revisions and lifecycle (`lifecycle.ts`)

* Every issue / in-work revision is **its own file**. History = the set of files plus `lifecycle_events` rows (who, why, when, from which file).
* An unpinned `<dmRef>` resolves to the highest issue, then the highest in-work; a pinned one (with `<issueInfo>`) to exactly that revision. A
  pinned revision that does not exist, and a reference to an obsolete module, are **errors** (validation + publication gate).
  Before a build, references to modules that have more than one revision file are rewritten to `xi:include` of the right file
  (`rewriteRevisionRefs`); modules with a single revision go through the engine's own resolver exactly as before.
* `POST .../dms/:file/working-revision`: copies the latest revision as in-work +1. Only identification attributes (`issueInfo`, `issueDate`) are edited,
  by text edit; the rest of the module is byte-identical. Existing `001-00` files are never touched.
* `GET .../change-suggestions`: compares a revision with its predecessor and **suggests** change marks; nothing is written until the author picks and
  applies (`POST .../change-marks` adds `changeMark`/`changeType` to exactly the chosen elements, in place).
* **Release approval** issues every in-work revision of the publication as the next issue: issue +1, in-work 00, `dmStatus/@issueType="changed"`, as a
  new file; the approved release's content fingerprint is re-recorded for that content.
* `issue`, `supersede`, `obsolete` are Project-Manager actions, need a reason, are audited, and write the next issue with `issueType="deleted"` (a
  superseding module is named in the record). Obsolete modules are not resolved into publications.

## 4. Extensions (`extensions.ts`)

The bundled XSDs have no `xs:any`, so foreign-namespace content fails the host schema by definition. Rules:

1. Foreign content is **never dropped or rewritten**: import, edit, save and export carry the text as it is (stored and returned byte for byte).
2. A namespace with no profile is a validation **error** (module, namespace, line, fix).
3. An Administrator registers a profile (namespace + one self-contained XSD whose `targetNamespace` equals it; no import/include; unsafe XML refused).
4. A project must **enable** the profile; a registered-but-not-enabled namespace is an error too.
5. For an enabled profile the foreign elements are validated against the profile's XSD, and the rest of the module against the host S1000D schema with
   those elements set aside (line numbers preserved). Foreign *attributes* are kept and reported as not validated (informational).

## 5. Packages, import and export (`zipio.ts`, `packages.ts`)

`zipio.ts` is an offline, dependency-free **ZIP64-capable** reader and writer: random access reader (the archive is never loaded into memory), streaming
deflate writer with data descriptors, ZIP64 records where a size/offset/count needs them. Safety is built in: names are normalised and refused if
absolute, drive-lettered, containing NUL or `..` (ZIP Slip); duplicates are refused; encrypted entries and unsupported methods are refused, not skipped;
limits on entry count, per-entry and total expanded size and compression ratio (zip bombs); CRC and size are checked while reading.

**Project settings travel with a project package (Phase 21, `packageSettings.ts`).** `manifest.json` carries `project.settings`: the project configuration (responsible partner, originator,
security, BREX, code mode, SNS enforcement, applicability references, country), the selected information codes, the data module types the project does not offer, and **both SNS systems side
by side** (system 1: the presets / project table; system 2: the row model and its ordering) - never converted into each other (`docs/SNS_SYSTEMS.md`). They are restored only when a package **starts
a new project** (the import-first wizard way), field by field through the same validators the screens use; an invalid value is left out and reported (`settings.notes` in the response and the
configuration's origin notes), the import never fails because of it, and what the data modules say (model code, issue, language) always wins over the manifest. A package without settings (another
tool, an older version) imports as before, with the configuration derived from the data modules. Importing into an *existing* project never touches its settings (`test/package-settings.test.js`).

* **Project package** (`GET .../packages/project`): `manifest.json` (SHA-256 per file) + `csdb/` + `Media/` + `publication.xml`.
* **Delivery package** (`POST .../packages/delivery`): the S1000D transfer package of Chap 7.5.1 - **one DDN + flat data files** (no directories) - from the
  publication (PM, its data modules, their ICNs and IMFs, ACT/CCT/PCT, BREX) or from selected modules, an optional generated DML, and an
  `AGASTYA-MANIFEST.json` (an AGASTYA addition, stated as such). DDN sender/receiver come from the Administrator's enterprise lists, or a controlled free
  entry (5-character code + name); the DDN's required `<authorization>` defaults to the sender's name (and the package notes say so). **No DDN is produced for
  7.0** (no schema): the package carries its manifest only.
* **Import** (`POST .../packages/import`, multipart streamed to disk, default limit 2 GB, `AGASTYA_MAX_UPLOAD_BYTES`): PLAN (unpack to a staging directory,
  classify every file, validate each with the scope that fits it, compare with the project) then APPLY. Nothing is written if any file is rejected unless
  "partial" is requested; a failure part-way removes what the import created. **Validation scope**: a data module is checked against *its own declared
  schema* only; ids are never compared across modules (S1000D requires uniqueness within one module). Existing files are never overwritten unless asked;
  the source ZIP is never modified; a manifest mismatch refuses the package. A report (every file: accepted / unchanged / skipped / rejected + why) is
  returned and stored under `.import-reports/`.

## 6. HTML publication (`htmlPublish.ts`)

AGASTYA's own static format (S1000D does not define one): `index.html` (title, classification and release markings, nested contents - every dmRef of
every entry, list of illustrations, list of abbreviations), one page per data module with navigation, `assets/`, `style.css`; a ZIP of it. It is built only from
modules that pass the publication gate, optionally for one applicability configuration. **Nothing is silently omitted**: known elements map to HTML,
every other element is rendered generically (name, attributes, children). Multimedia is linked (no playback). Output is escaped; the served preview has a
`default-src 'none'` CSP. `test/html-publish.test.js` proves every word of all 84 fixtures (21 types x 4 issues) reaches the HTML.

## 7. Graphics and multimedia (`assets.ts`, `mediaFormats.ts`)

The format table is the one in S1000D 4.2 Chap 7.3.3 (audio, video, 3D, miscellaneous) and Chap 7.5.1 (CGM, CG4, TIF, JPG, PNG, GIF, PDF); formats
accepted beyond it (svg, bmp, webp, webm) are marked `platform`. Types that can carry active content (JS, CSS, DOC, XLS, PPT/PPS, MDB, MPP, ZIP, FLA) are in
the specification but **stored only when an administrator enables them** (`PUT /api/admin/asset-policy`); SVG with script / handlers / `foreignObject` is refused.
`GET .../assets`: inventory with SHA-256, ICN parsing, broken references (`infoEntityIdent` and `<!ENTITY ... SYSTEM>`), orphans, duplicates by content,
unsupported formats, missing IMF. Uploads stream to disk (`uploads.ts`).

## 8. CIR linked copies (`cir.ts`)

Copying a Common Information Repository module into a project creates a **linked copy** (`cir_links`: the CIR content hash it was taken from). The repository
changing marks it `update-available` and notifies the project's approvers; a Project Manager approves (`POST .../cir-links/:file/update`), which replaces the
copy (history kept; a locally modified copy needs an explicit confirmation). A linked copy cannot be edited in the project (`CIR_LINKED`) - the shared module
is changed in the repository - unless the link is detached. Copies made before this phase have no link and behave as before.

## 9. Findings (`findings.ts`)

`GET .../findings[?run=1]`: one shape for every result - module, rule, XML location, message, **suggested fix** - from the validation run (XSD, BREX,
applicability, graphics, publication, extensions) and project consistency (file name vs identification, MIC, issue, DM type, information code, SNS,
cross-module `dmRef`, ICN references, asset integrity).

## 10. Changed vendored code

* `backend/vendor/engine/pmc.js` (approved): only the first `<dmRef>` of a `<pmEntry>` is modelled; further `<dmRef>`s used to be dropped on read and now fall into
  the entry's `extra`, which is written back verbatim - a `pmEntry` listing several modules keeps all of them. A comment marks the change. **No licensing
  code was touched**: `vendor/engine/license.js` is byte-identical (SHA-256 `52728f63...ae283a`, asserted in `test/pm-multiref.test.js`).

* `backend/vendor/engine/catalog.js` (approved in Phase 18, third vendor exception): `writeCatalog()` rewrote the shared libxml2 catalogue file with a truncate-then-write
  on **every** `xmllint` / `xsltproc` launch, so a child that started during a rewrite read an empty file ("jsspub-s1000d-catalog.xml, line 1: Document is empty") and a
  valid data module was reported as "XML cannot be parsed" (22 modules on a 218-module import). It now writes only when the content changed, through a temp file and a rename
  (`test/catalog-race.test.js`: 236 319 of 668 200 concurrent reads were torn before, 0 after, on Linux and Windows). Nothing else in the file changed.

* `backend/vendor/pipeline/s1000dtofo/ipd.xsl` (approved in Phase 18, fourth exception): the ids `ipd-toc`, `ipd-lof` and `ipd-parts-list` were the same in every
  illustrated parts data module, so a publication with two or more of them failed to build as PDF (FOP: "ID values must be unique") and their contents links pointed
  at the first module. Each id now carries its own module (`generate-id` of the enclosing `dmodule`), and every reference uses the same expression
  (`test/pdf-multi-ipd.test.js`, failing first; the PDF text of a single-IPD publication is identical before and after).
* `backend/vendor/engine/resolveDmRefs.js` (approved in Phase 18, fifth exception): `readOwnDmCode` / `readOwnPmMeta` read a fixed 8 KiB head, so a data module whose
  DOCTYPE declares its graphics (one `<!ENTITY ... NDATA>` per ICN, as every real handbook does) had its own `<dmCode>` beyond that, was never indexed, and was **silently
  left out of the PDF** (only a log line said its publication entry "refers to a data module this project does not have"). Measured on the 00039 sample: **1 of its 218 modules** is affected (its `<dmIdent>` starts at byte 25 339; 65 words were missing from the PDF until the fix).
  A shared `readHead` now grows (8 KiB, doubling, at most 4 MiB) until the root element and its identification block are read (`test/pdf-long-doctype.test.js`, failing first).

* `backend/vendor/engine/build.js` and `validateXml.js` (Phase 21, 2026-11-22, **exception A**): xsltproc joins a *relative* stylesheet location to the working directory as a string
  before it opens it. The project folder is the working directory and the stylesheets are in the application folder, so the location was one `../` per level of the project's own
  path plus the way down to the pipeline - past Windows' 260 characters while the real path is short (`warning: failed to load external entity ../../../..`; measured: a project folder
  of 136 characters on a checkout under `C:\Users\...` already failed; an installed application with a long user name and an 80-character project name reaches it). The engine now hands xsltproc
  **absolute** locations (`absLoc`, and a `file:` URL in the generated driver stylesheet), which also works when the workspace and the application are on different drives. Verified: same PDF text
  at 30 / 70 / 100 / 120 characters of workspace depth (`test/deep-workspace.test.js`; failing first). What cannot be fixed: a **file** whose own path is 260+ characters cannot be opened by the
  bundled libxml2 at all; it was reported as "XML cannot be parsed", and is now reported as "File path too long" with what to do. `npm run doctor` checks the workspace path length.
* `backend/vendor/pipeline/support-view.xsl`, `s1000dtofo/descript.xsl`, `s1000dtofo/tables.xsl` (Phase 21, **exception B**): FOP refused a publication with "Property ID ... previously used"
  (`brex-gate`, `publish-gate`: a BREX-clean build failed). libxslt 1.1.28 reuses memory between result tree fragments, so `generate-id()` of nodes in a freed fragment repeats; ids built from it
  collided across support modules. A `node-gid` template builds the id from the enclosing module's id plus the node's document position, and the three places that built ids from
  `generate-id()` of fragment nodes use it. PDF text is unchanged.
* `backend/vendor/pipeline/s1000dtofo/s1000dtofo.xsl`, `headers_footers.xsl`, `frontmatter-shared.xsl` (Phase 21, **exception C**): the classification marker of the prelim pages (contents, lists; the markers
  of the front-matter flows and the publication-module fallback of `generate-markers`) is conditional on `$prelim.classification.on`, declared in `s1000dtofo.xsl` from the new parameter
  `prelim.classification` (`yes` / `no`; empty = on, except under `layout.profile = xignal`, which follows the reference: its 569 front-matter pages print no classification). Body pages and the title-page
  data module keep the class of their own module; every other profile is unchanged (`test/xignal-prelim-marking.test.js`).

* `backend/vendor/pipeline/s1000dtofo/frontmatter-s1000d.xsl`, `headers_footers.xsl`, `xignal-cover.xsl` (Phase 22, 2026-11-23, **exception D**, all behind `layout.profile = xignal`, every other profile unchanged): (1) the contents
  Page column is resolved once into `$toc.page.show` - a project that states `toc.s1000d.showPage` ('1'/'0') is obeyed, otherwise the Xignal profile prints none (the reference list has four columns) and every other
  profile keeps it, so an older workspace copy of the house template cannot bring the column back; (2) the cover generated from the publication module (used when the first module is not a title-page module) is set with the
  same `xs.cover.*` geometry as the title-page-module cover (24 pt title, 14 pt code and issue line, 8 pt "Publisher:"), and the publisher line prints the resolved company line (`xs.mark.company`: settings, publication comment
  or brand pack) before the enterprise name held in the data; on the title-page-module cover the text is printed only when the page names an enterprise or has no logo to carry the name; (3) `generate-markers` takes an optional
  `info` parameter: the generated contents (009), list of illustrations (00A) and abbreviations (005) pages print a data module code in the foot (model identification code - system difference code of the first module -
  00-00-00-00A - information code + variant A - D, one code, printed once) and the publication's applicability, or "All" when it states none, as the data-module pages do. Tests: `test/xignal-cover.test.js` (3 new or
  changed), `golden-xignal.test.js` (the reference title page still agrees).
  **Phase 22b (same day):** (4) `headers_footers.xsl` `security`: a class-to-marking table with an EMPTY entry (Xignal: class 01) no longer silences the marking the project itself states
  (`$security.classification`, Settings > Security classification, "stamped on every page"; "Unclassified" states nothing): the empty entry falls back to it, a filled entry is that class's own marking;
  (5) the generated title page passes `info` 001 to `generate-markers`: it carries a data module code and is classified like the title-page module would be (unless `prelim.classification` = no);
  (6) `xignal-furniture.xsl` footer row A gives the data module code 3 of 5 parts of the width (it was 1 of 3 on odd pages), so a long model identification code stays on one line;
  (7) `engine/brand.js` + `publisher.ts`: `showWhen: "inWork"` also prints the draft-copy note on a build that is NOT released (the NOT RELEASED watermark is on the same pages); a caller that does not state the
  release state keeps the old rule. Tests: `xignal-prelim-marking.test.js` (+2), `brand.test.js` (+1), `xignal-cover.test.js`.
  **Phase 22c (same day):** (8) `frontmatter-s1000d.xsl`: under the Xignal profile every header row of the contents, illustrations and abbreviations tables has the reference's 0.25 mm hairline ABOVE as well as below
  (`xs-fm-head-rules`), and the last page of each table closes with one more hairline (`xs-fm-end-rule`); measured against RDR-1671Y-00039-00 the rules are within 0.1 pt (the cell padding moved 0.7 pt from below the text to above it and
  the caption row lost its extra 1.4 pt so rules and text both land on the reference); (9) the illustrations list links as the reference does: the module code (first figure of a module only) is a blue link to the module, the figure
  number and title are black links to the figure; (10) `ipd.xsl`: a parts-catalogue figure now also carries the standard figure id (`unique-id`), which the illustrations list links to - before, its row had no target and a click fell back
  to page 1. Tests: `repeated-dm-ids.test.js` (+1, fails without the fix), `xignal-cover.test.js` (rules, closing rule, link colours; the 1 mm padding assertion now reads the 4-value shorthand).
  **Phase 22d (same day):** (11) `xignal-cover.xsl` / `frontmatter-s1000d.xsl`: the product picture on the Xignal cover is an anchor (`cover-picture-<module>`) and the List of illustrations has its FIRST row for it
  (the module code is a blue link to the cover, "Fig 1" / "Product illustration" are black links to the picture); (12) one `xs-cover-publisher` block for both covers: the logo is the title page's own `<publisherLogo>`, else the
  platform default `publisher.logo.uri` (`assets/default-publisher-logo.png`, copied into the build by `sideText.publisherLogoParams`, called from the Xignal branch of `furnitureFor` in `publisher.ts`; project switch
  `publisherLogo: false` in project.json / `PATCH` `publisherLogo`, no screen for it yet), 30 mm wide; the name is printed only when there is no logo (S1000D requires the title page to NAME its publisher, BREX-S1-00113, so
  "the page names one" cannot decide it). The picture itself is data: `<productIllustration>` of the title-page module (Studio's Front matter template does not offer one). Tests: `xignal-cover.test.js` (+2), `publisher-logo.test.js` (new).

* **Audit implementation, 2026-11-27** (`docs/audit/IMPLEMENTATION-LOG.md`; each change carries an `AGASTYA` / `WP-` comment; nothing in `license.js` was touched):
  (1) `db.js` (WP-04, WP-06): `PRAGMA busy_timeout = 5000` and `foreign_keys = ON` at open; a new `close()` checkpoints the write-ahead log and closes the database at a clean stop.
  (2) `workspace.js` (WP-06, PLT-004): `uniqueId` and `createProject` take an optional `isTaken` check, so the platform can refuse an id an earlier (deleted) project used; without it the behaviour is unchanged.
  (3) `frontmatter.js` (WP-07, PUB-012): a description-of-symbols entry without a picture is written without `src` (it was `src=""`, which the stylesheet took for a picture); the page draws its empty frame.
  (4) `foChecks.js` (WP-07, PUB-020): the FO image check resolves `file:` URLs and absolute paths as well as paths relative to the build folder, because the stencil's default artwork is now passed as `file:` URLs.
  (5) `validateSchema.js` (WP-32, PERF-002): the project schema check batches modules by bytes (at most 3.5 MB of text per validator call, memory sized to the batch) instead of one call per schema; a batch the
  validator cannot run is retried module by module, a module it cannot hold is reported as too large with the limit, and only a module that was judged counts in `checked`. Results for projects that validated before
  are the same findings (`test/wp32-validation-scale.test.js`).
  (6) `vendor/pipeline/jss/frontmatter/13-description-of-symbols.xml` (generated, shipped): the six symbol pictures that were never shipped are left out (WP-07, PUB-012).
  (7) `vendor/pipeline/s1000dtofo/frontmatter-s1000d.xsl`, `s1000dtofo.xsl`, `refs.xsl`, `warnings.xsl` (WP-33, PERF-003, exception "FO-stage scaling" in
  `docs/JSS_VENDOR_EXCEPTIONS.md`): whole-book XPath scans evaluated per figure, per repeated id, per reference and per abbreviation are replaced by `xsl:key` lookups and
  values computed once (the list of illustrations' first titled figure, on the descendant axis because libxml2 merges `//dmodule//figure[title]` quadratically; `unique-id`
  and `dm-occurrence-suffix` read a position in a key instead of counting `preceding::`; the old expressions remain as fallbacks). The FO is the same up to a renaming of
  `generate-id()` values, which libxslt changes from run to run anyway (`test/wp33-fo-equivalence.test.js`; 104 product builds of the PDF suites re-run with the old
  stylesheets, all equivalent). FO stage, 200 figure-bearing modules: 535 s before, 2.8 s after; 500 modules 9.3 s (`test/wp33-fo-scaling.test.js`). The pre-change files are
  in `backend/test/fixtures/wp33-old/`.
  (8) `catalog.js` (third vendor exception, amended 2026-11-27 after WP-16 found HTTP 500s): the generated libxml2 catalogue is named
  after a hash of its content (`jsspub-s1000d-catalog-<16 hex>.xml` in the temp folder) instead of one shared name. Every checkout and install
  writes its own absolute schema paths, so a build could read a catalogue that pointed at another checkout's schemas, and a rename over a file
  another process held open failed on Windows (EPERM). Identical content still shares one file; the atomic write is unchanged
  (`test/catalog-race.test.js`).

## 11. Migration

`017-s1000d-completion` (additive; nothing altered or dropped): `lifecycle_events`, `cir_links`, `ext_profiles`, `project_ext`. Existing data is unaffected;
existing `001-00` files, existing CIR copies and existing projects behave as before.

## 12. Configuration

| Setting | Default |
|---|---|
| `AGASTYA_MAX_UPLOAD_BYTES` | 2 147 483 648 (per uploaded file) |
| `AGASTYA_MAX_EXPANDED_BYTES` | 8 589 934 592 (total expanded size of one package) |
| `AGASTYA_REQUEST_TIMEOUT_MS` | 10 800 000 (3 h: how long one request may take to arrive in full; Node's own default of 5 min cut a 4.8 GB upload with HTTP 408) |

A blank or invalid value of any `AGASTYA_*` number falls back to its default (it never becomes 0 or NaN). Aborted-upload temp files older than the request timeout plus one hour are
removed at start-up and hourly. A full disk is answered with `507 DISK_FULL` and a plain message instead of an opaque 500.
| ZIP entry count / ratio limits | 100 000 entries / 1000:1 (`DEFAULT_LIMITS` in `zipio.ts`) |
