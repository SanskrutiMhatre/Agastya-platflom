# AGASTYA V2 - S1000D compliance matrix (Phase 17, 2026-11-21; updated in Phase 18, 2026-11-22)

**How to read this.** Every row says what the platform does, the evidence (an automated test, or a measurement) and the honest limits. Status:

| Status | Meaning |
|---|---|
| **PASS** | Implemented and verified by the automated tests named, for the scope stated. |
| **PARTIAL** | Implemented, with the gap stated in the row. |
| **MISSING** | Not implemented, or the schema is not bundled (nothing is invented). |
| **UNVERIFIED** | Implemented, but the S1000D evidence for that issue was not available (only the 4.2 specification text is), or the provenance of the schema is unverified. No compliance claim is made. |
| **NOT APPLICABLE** | Does not apply to this platform. |

Specification evidence: **Issue 4.2 text only** (S1000D-A-07-05-0100-00A-040A-A "File naming conventions", Chap 7.3.3 multimedia, Chap 4.x). Issues 5.0, 6.0 and 7.0
were checked against their bundled schemas and default BREX only. Schema provenance: the 4.2 / 5.0 / 6.0 DDN, Comment, Update and SCORM content package schemas
are *copied toolkit sources with no independently verified official origin* (accepted by the project owner and recorded in `backend/schemas/PROVENANCE.md`);
Issue 7.0 provenance as a whole is **UNVERIFIED** and its DDN / Comment / Update / SCORM schemas are **MISSING**.

## 1. Coverage matrix: document type x issue (generated from `backend/schemas/`, `GET /api/s1000d/coverage`)

"XSD" = the schema file is bundled for that issue. For data module types, validation, BREX, applicability, import/export, PDF and HTML rendering and the editor
template apply uniformly to all 21 and are verified per issue (rows 3-9 below). Per-type tests: `frontend/src/studio/__tests__/dmtypes.test.ts` and
`verify/inventory.test.ts` (21 types x 4 issues: XSD, content model, tag rules), `backend/test/pdf21.test.js` (168 PDF renderings), `backend/test/html-publish.test.js` (84 HTML renderings).

| Schema | Name | Category | File prefix | 4.2 | 5.0 | 6.0 | 7.0 |
|---|---|---|---|---|---|---|---|
| descript | Descriptive | dm | DMC | XSD | XSD | XSD | XSD |
| proced | Procedural | dm | DMC | XSD | XSD | XSD | XSD |
| fault | Fault isolation | dm | DMC | XSD | XSD | XSD | XSD |
| crew | Crew / operator | dm | DMC | XSD | XSD | XSD | XSD |
| ipd | Illustrated parts data | dm | DMC | XSD | XSD | XSD | XSD |
| brex | Business rules exchange | dm | DMC | XSD | XSD | XSD | XSD |
| comrep | Common information repository | dm | DMC | XSD | XSD | XSD | XSD |
| appliccrossreftable | Applicability cross-reference table | dm | DMC | XSD | XSD | XSD | XSD |
| condcrossreftable | Conditions cross-reference table | dm | DMC | XSD | XSD | XSD | XSD |
| prdcrossreftable | Products cross-reference table | dm | DMC | XSD | XSD | XSD | XSD |
| brdoc | Business rules document | dm | DMC | XSD | XSD | XSD | XSD |
| checklist | Checklist | dm | DMC | XSD | XSD | XSD | XSD |
| container | Container | dm | DMC | XSD | XSD | XSD | XSD |
| frontmatter | Front matter | dm | DMC | XSD | XSD | XSD | XSD |
| learning | Learning | dm | DMC | XSD | XSD | XSD | XSD |
| process | Process | dm | DMC | XSD | XSD | XSD | XSD |
| sb | Service bulletin | dm | DMC | XSD | XSD | XSD | XSD |
| schedul | Maintenance schedule | dm | DMC | XSD | XSD | XSD | XSD |
| scocontent | SCORM content | dm | DMC | XSD | XSD | XSD | XSD |
| wrngdata | Wiring data | dm | DMC | XSD | XSD | XSD | XSD |
| wrngflds | Wiring fields | dm | DMC | XSD | XSD | XSD | XSD |
| pm | Publication module | pm | PMC | XSD | XSD | XSD | XSD |
| dml | Data management list | dml | DML | XSD | XSD | XSD | XSD |
| ddn | Data dispatch note | ddn | DDN | XSD | XSD | XSD | **MISSING** |
| comment | Comment | comment | COM | XSD | XSD | XSD | **MISSING** |
| update | Data update file | update | UPF | XSD | XSD | XSD | **MISSING** |
| scormcontentpackage | SCORM content package | scorm | SMC | XSD | XSD | XSD | **MISSING** |
| icnmetadata | Illustration / multimedia metadata (IMF) | imf | IMF | XSD | XSD | XSD | XSD |


Not present in any issue and **not invented**: TECHREP, JSS, JSG data module types.

## 2. Requirement matrix

| # | Area | Status | Evidence and limits |
|---|---|---|---|
| 1 | Coverage matrix (DM type / issue / XSD / template / DMC rules / validation...) | **PASS** | Table above is generated; `registry.ts`, `test/csdb-objects.test.js`; Administrator > Standards coverage. |
| 2 | Central schema-driven registry; the 21 types preserved | **PARTIAL** | Backend: one registry; DM-type seed derived from it (PASS). The editor's templates, the Studio's issue/schema tables and a few tests still list the 21 types explicitly, so a new type still needs an editor template and (if it must render) an XSL rule - this is stated in the architecture document; it is not "no scattered edits". |
| 3 | Authoring - 21 DM types | **PASS** | `dmtypes.test.ts`, `verify/inventory.test.ts` (Studio), browser suites. |
| 3a | Authoring - DML, DDN | **PASS** (generated, not hand-edited) | `dispatch.ts`; output validated against the issue's schema before being returned; `object-docs.test.js`, `packages.test.js`. |
| 3b | Authoring - Comment, Update, IMF | **PASS** (4.2 / 5.0 / 6.0; IMF also 7.0) - 7.0 Comment / Update **MISSING** | Template creation, naming, XSD validation, import/export, HTML + PDF rendering, DML references (`object-docs.test.js`) **and, since Phase 18, structured grammar-driven editing in the Studio**: Edit on the CSDB page opens the object in the same editor and saves it back through `/objects` (`studioSession.openObject`; Studio test `verify/objects.test.ts`: opens with the object's own grammar and schema, content unchanged on open, legal insertions through the editor leave the document XSD-valid by native xmllint, undo exact, foreign tags refused - 10 documents: Comment 3, Update 3, IMF 4 across 4.2 / 5.0 / 6.0 / 7.0; browser test `zz-csdb.spec.ts` "Edit opens a CSDB object..." edits through CodeMirror, saves with Ctrl+S and finds the change in the object file and not among the data modules). Comment-and-answer workflow: not built (decided scope). DDN and DML stay generated, not hand-edited (decided). |
| 3c | Authoring - SCORM content package | **PARTIAL** (4.2 / 5.0 / 6.0); 7.0 **MISSING** | Imported, named (SMC), exported, rendered generically, and opened / edited in the Studio with **grammar-level evidence only** (3 fixtures, one each for 4.2 / 5.0 / 6.0, `verify/objects.test.ts`). **CORRECTION of the Phase 17 claim: SCORM packages are NOT schema-validated.** `scormcontentpackage.xsd` imports the IEEE LOM schema (`../lom_schema/lom.xsd`), which is not in the repository, so the XSD does not compile; the platform stores such a package and reports it as *not schema-checked*, never as valid (`scorm-validation.test.js`). The official IEEE address is login-gated and returns HTML; nothing was substituted (see `backend/schemas/PROVENANCE.md`). To close: supply the toolkit's own `lom_schema` folder. |
| 3d | Extensions / foreign namespaces | **PASS** | `extensions.test.js` (preserved byte for byte; unregistered = error; profiles; project opt-in; validated against own XSD; host schema still judges the rest); Studio round trip `extensions.test.ts`. Limit: a foreign *attribute* is preserved but reported as not validated. |
| 4 | Reference management (info codes, SNS, MIC, learn / event / item-location codes, project config, provenance) | **PASS** | Phase 15/16 (`s1000d-reference.test.js` etc.). Information-code defaults of `wrngdata` and `scocontent` remain unresolved against the 4.2 text. |
| 5 | Validation: XSD, BREX, SNS, info codes, DMC, applicability refs, cross-module refs, ICN refs, PM, project consistency | **PASS** (with the limits below) | `findings.ts`, `GET /api/projects/:id/findings`; every finding has module, rule, location and suggested fix (`packages.test.js`). Limits: the PM file is not XSD-checked while it carries `xi:include` (engine rule; reported as "not checked"); BREX rules that need XPath 2.0 are not enforced (reported). Publication gate (XSD + BREX + applicability + revisions + extensions) kept. |
| 6 | Applicability: ACT / CCT / PCT, applicRefId, configuration publishing | **PASS** | Phase 16 `applic-publish.test.js`. |
| 6a | `referencedApplicGroup` | **PASS** | declared and resolved (Phase 16). |
| 6b | `referencedApplicGroupRef`, `applicConfiguration` | **PASS** for externalized applicability (4.2 text + bundled XSDs); `applicConfiguration` **PARTIAL**; 5.0-7.0 semantics **UNVERIFIED** | Worked through the 4.2 text (Chap 3.9.5.3 para 2.1.3.2, 3.9.5.2.1.13, 3.9.5.2.11.12): an `<applicRef applicIdentValue>` + `<dmRef>` (in `<dmStatus>` or `<referencedApplicGroupRef>`) resolves through the CIR's `applicSpec` / `applicMapRefId` to an `<applic>`; resolution is shared by validation (`APPLIC-EXT-REF` error with module and location for a missing CIR module, ident or map target; `applicRefId` may point at an `applicRef` id) and by configuration publication (`applicEval.planDm`, so PDF and HTML both honour it; nothing is excluded on a guess). `applicConfiguration`: the attribute is preserved and its use outside an IPD data module is reported (warning `APPLIC-CONFIG-NOT-IPD`); **the 4.2 text defines no filtering semantics for it, so none was implemented**. A configuration value must now be one concrete value (a set or range such as "A|B" or "1~5" is refused, `buildSelection`). Tests: `applic-external.test.js` (7). |
| 7 | Publication management | **PARTIAL** | Multiple `dmRef` per entry preserved (approved `pmc.js` change; `pm-multiref.test.js`); nested structures; revision-aware references; TOC, list of illustrations and abbreviations, classification and release markings in the **HTML** publication (`html-publish.test.js`); PDF has its existing front-matter pages (contents, figures, tables, abbreviations, record of changes...) and page numbering from Phases 6-16. Not verified in this phase: blank-page rules and page numbering in PDF for the new revision model; PM templates beyond the existing four; configuration publications are PDF and HTML. |
| 8 | Graphics / multimedia | **PARTIAL** | Format table from 4.2 Chap 7.3.3 (audio, video, 3D, misc); active-content types gated by an administrator opt-in; SVG with script refused; asset inventory with SHA-256, ICN parsing, duplicate / orphan / broken-reference / unsupported-format findings; streaming uploads (`phase17-security.test.js`, `packages.test.js`). ICN metadata (IMF) authored and validated. **Not done:** the Graphics page UI does not yet preview non-image media; IMF is not auto-created; no automatic ICN issue/security-field validation against the project's rules beyond the name pattern. Formats beyond 4.2's list (svg, bmp, webp, webm) are labelled `platform`. 5.0 / 6.0 / 7.0 format lists: UNVERIFIED. |
| 9 | CIR | **PASS** | Linked copies, version tracking, "update available" notification, Project Manager approval, protection from accidental local edits, detach: `cir-links.test.js`. Limit: version = content hash + issue number; no multi-level permission model beyond the existing roles. |
| 10 | Lifecycle | **PASS** for what the 4.2 text defines; later issues **UNVERIFIED** | Issue / in-work revisions as separate files, history, change-mark suggestions (author-reviewed), release approval issues the next issue, supersession and obsolescence with reason + audit (`lifecycle.test.js`, `release-issue.test.js`); **reinstatement of an obsolete module (Phase 18)**: issue number at deletion + 1 (Chap 3.5 para 2.3.3.5) with `issueType` `rinstate-status` / `rinstate-changed` / `rinstate-revised` (Chap 3.9.5.1), Project Manager action with a reason, new file, audited, published again, a Reinstate button in the CSDB > Revisions history (`lifecycle-reinstate.test.js`). **"Automatic supersession chains" are NOT defined by the 4.2 text** (its `<supersedure>` element is only a notice in the data module status), so nothing was built or claimed for them. DMC transition rules are applied from the 4.2 text and the schemas; **later-issue rules UNVERIFIED**. DML and DDN generation: PASS (4.2/5.0/6.0; DML also 7.0; DDN 7.0 **MISSING**). Review/approval/release workflow exists (Phases 11-13). |
| 11 | Import / export | **PASS** | DMs, PMs, ICNs, BREX/ACT/CCT/PCT (they are data modules), DML/DDN/COM/UPF/SMC/IMF, project packages, delivery packages; per-file schema scope (never cross-module id checks); preserved sources; clear reports: `packages.test.js`. Limit: JSS exports keep their existing paths (not changed here). |
| 12 | Publishing engines | **PARTIAL** | PDF (both pipelines) for all 21 types (Phase 16); **static HTML** for all 21 types and every other element (`html-publish.test.js`, 84 modules, every word); structured XML export = the project package; publication packages = the delivery package. HTML is AGASTYA's own format (S1000D defines none). Multimedia is linked, not played. `vendor/engine/license.js` untouched (SHA-256 asserted). |
| 13 | Administration, permissions, isolation, audit, secure import/export | **PASS** | `phase17-security.test.js` (anonymous 401, non-member 403/404 on every new route, administrator-only routes, path traversal, asset policy), audit entries on every write action, `routes-guarded.test.js` (every route guarded). |
| 14 | Architecture, backward compatibility, migrations | **PASS** | Migration `017-s1000d-completion` additive; existing `001-00` files, projects, CIR copies behave as before; full prior suites green. |
| 15 | Verification matrix incl. performance and security | **PASS** for upload, ZIP64, security and the real-project round trips; **PARTIAL** for Windows/macOS | Large uploads over real HTTP multipart (client in its own process, `scripts/upload-e2e.js`): **1.9 GB** package accepted, byte-identical (SHA-256), 128 s, server peak 193 MB; **2.1 GB** refused with a clean `413 FILE_TOO_LARGE`; **4.83 GB ZIP64 package with a 4.5 GB entry** (limit raised to 6 GB) accepted, byte-identical, 180 s, server peak 200 MB. Defects found and fixed: Node's 5-minute request timeout cut this upload (HTTP 408; now 3 h, `AGASTYA_REQUEST_TIMEOUT_MS`), idle keep-alive connections were reset (now 65 s), a full disk answered with an opaque 500 (now `507 DISK_FULL`). Real projects: see `docs/SAMPLE_COMPARISON_REPORT.md`. Platforms: uploads were measured on Windows; the full suites ran on Linux (Debian 12, Java 21); macOS not tested. |
| 16 | Documentation | **PASS** | README, `S1000D_COMPLETE_IMPLEMENTATION.md`, this matrix, `PROVENANCE.md`, root `memory.md`. |

## 3. Test results (actual, final run, Phase 18)

Run in a Linux image (Debian 12, Node 22, Java 21, xsltproc, poppler, Chromium) with the original samples mounted read-only; the Windows machine has no native `xmllint`.

* Backend `node --test test/*.test.js`: **217 pass, 0 fail, 0 skipped** (Phase 17: 199; new: `applic-external` 7, `scorm-validation` 4, `uploads-config` 4, `catalog-race` 1, `pdf-multi-ipd` 1, `pdf-long-doctype` 1; the two reference-publication tests now run and pass).
* Frontend / Studio unit `npm test`: **417 pass, 2 skipped, 0 fail** (Phase 17: 401; new: `verify/objects.test.ts` 16). `npm run test:verify` (frontend part): **382 pass, 0 fail** (7 files). Both on **libxml 2.13.9** (Alpine 3.24).
* Playwright, `VERIFY_E2E=1`, whole suite in one uncontended run: **83 pass, 0 fail** (Phase 17: 82; new: the Edit-object browser test).
* Backend `test:verify` (the 21-type publication gate, BREX gate and type checks across issues): **NOT re-run as one chain after the last changes - paused by the project owner's decision (testing is done once, at the end).** Evidence so far: issues 4.2 and 5.0 passed in the chain (365 s, 372 s); issues 6 and 7 exceeded their 600 s limit once in the chain (cause not determined; no memory data) and **passed when run alone in 282 s and 275 s** with a longer limit.
* **Changed since the last full regression (to be covered by the final run):** reinstatement (`lifecycle.ts`, route, CSDB page); verified so far only by `lifecycle-reinstate.test.js` (2 tests) and the type checks.
* **Environment limitation, stated plainly:** on libxml **2.9.14** (Debian 12 and 13; Debian 13 ships "2.12.7 +really2.9.14") 172 Studio tests fail (2 in `isoentities.test.ts`, 170 in the verification suites): the Studio's native-`xmllint` oracle reports "entity references in the node-tree are not supported" and differently ordered errors. The same tests fail identically on a pristine copy of the code and pass on libxml 2.13.9, so it is the validator version, not the code. Tests that rely on that oracle therefore need `xmllint` >= 2.13.

## 4. Measurements (actual)

Machine: 8 CPUs, Node 26.13, quiet. `backend/scripts/perf-phase17.js 500 1000` (500 data modules, 1000 ICN assets, one publication placing every module):

| Step | Time |
|---|---|
| Package import (1501 files, 1.4 MB ZIP, no per-file validation skipChecks) | 3.9 s |
| Project export (2.2 MB) | 0.5 s |
| Validation run (XSD, no BREX) | 3.7 s |
| Findings | 0.2 s |
| Asset inventory (1000 assets, hashed) | 0.02 s |
| Static HTML publication (gate + 500 pages) | 20.4 s |
| Delivery package (DDN + DML + files) | 0.5 s |
| **PDF of the 500-module publication** | **73.2 s** (7.4 MB) |
| Peak RSS | 448 MB |

ZIP64 (`scripts/zip-perf.js`): 2.1 GB entry written in 0.9 s, read back CRC-checked in 1.1 s, peak RSS 139 MB; 4.5 GB entry (true ZIP64) 1.8 s / 2.5 s / 142 MB; both accepted by `python3 -m zipfile -t`. (Sparse files, stored; real data would be slower.)
The perf run found one defect, fixed: the delivery package put every note in a response header (headers overflow at 1000 assets); it is now capped and the full notes are in the manifest.

## 5. Security tests

XXE and entity bombs in data modules, CSDB objects, extension XSDs and SVG (`packages.test.js`, `extensions.test.js`, `phase17-security.test.js`); ZIP Slip (`../`, absolute,
drive-letter, backslash, NUL), duplicate entries, encrypted entries, CRC corruption, truncation, zip-bomb ratio and entry-count limits (`zipio.test.js`, `packages.test.js`);
path traversal in file-name parameters and preview paths; unsafe uploads (script SVG, active-content types, non-ZIP); authorisation bypass and cross-project access on
every new route; extension content can never be executed (rendered as escaped text; the HTML preview is served with `default-src 'none'`, `sandbox`).

## 6. Known limitations and what is not claimed

* No claim that DDN / Comment / Update / SCORM schemas are official (provenance above); none at all for 7.0. **SCORM packages cannot be schema-checked** (missing IEEE LOM schema).
* 5.0 / 6.0 / 7.0 specification-dependent behaviour (file naming, DMC transitions, multimedia lists, externalized-applicability semantics) is **UNVERIFIED**: the rules of the 4.2 text are applied uniformly and flagged.
* Studio structured editing is wired for Comment, Update, IMF and SCORM objects; DDN and DML are generated (decided). Multimedia preview in the Graphics page is not built (decided scope).
* `applicConfiguration` has no filtering semantics (none in the 4.2 text).
* `/code-review` (high) was run on the Phase 18 code and its 10 findings were fixed; `/simplify` was run as four parallel reviews (reuse, simplification, efficiency, altitude) and its findings applied except where noted in `memory.md`. Neither was re-run on the Phase 17 code as a whole.
* Information codes of `wrngdata` and `scocontent` stay **FLAGGED** (checked against the 4.2 catalogue: it names no code for SCO content and four for wiring data), nothing invented.
* Existing `/api/projects/:id/media` and data-module import still use the 64 MB in-memory path (unchanged); package import and graphics upload stream to disk.

## 7. Phase 18 results (2026-11-22)

**Real-project round trips** (full detail: `docs/SAMPLE_COMPARISON_REPORT.md`): the Maintenance Manual 00033 matches its reference PDF on content (444/444 words), data module order, contents list, graphics (8/8) and blank-page behaviour; layout differs by design. The 218-module User Handbook 00039 builds as PDF (202 modules, 848 pages, 0 words and 0 titles missing, 455/455 graphics) and HTML (202 pages) once the gate's refusals (14 modules with real BREX / applicability breaches) are set aside; its own publication module publishes only 30 of the 216 modules (nine `pmRef` point to publication modules that are not in the package) and has 9 genuine schema errors.

**Platform defects found by this work and fixed, each with a failing-first test:** shared XML-catalogue race (valid modules reported as unparseable; vendor exception 3), duplicate FO ids for two or more IPD modules (PDF build failed; vendor exception 4), data modules with a long DOCTYPE silently dropped from the PDF (vendor exception 5), request timeout / keep-alive, full-disk response, applicability edge cases found by `/code-review`.

**Vendor exceptions in total (all documented in `S1000D_COMPLETE_IMPLEMENTATION.md` section 10):** cover Code/Rev No. edit and one regex in `validateSchema.js` (earlier), `pmc.js` (Phase 17), `catalog.js`, `ipd.xsl`, `resolveDmRefs.js` (Phase 18). `license.js` untouched.

**Not done / PARTIAL after Phase 18:** SCORM schema validation (dependency missing), `applicConfiguration` semantics (none in the 4.2 text), multimedia preview (decided scope), the editor's per-type templates and XSL rules (the registry removes scattered edits on the backend only), later-issue (5.0-7.0) specification-dependent rules, macOS.
