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
