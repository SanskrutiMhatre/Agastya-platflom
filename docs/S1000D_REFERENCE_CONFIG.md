# S1000D reference configuration

Information-code catalogues, the SNS, project configuration, data module creation and applicability. This is the technical reference for
migration 016 and the services behind it. Nothing here claims behaviour the code does not have; limitations are listed at the end.

## 1. The model: global catalogue → project configuration → data module

| Level | Owner | Where it lives | Notes |
|---|---|---|---|
| Global catalogue | Administrator | `ref_codes`, `ref_code_ranges`, `ref_sources`, `ref_dmtype_codes`, `sns_presets`, `sns_preset_nodes` | per S1000D issue; BREX rows are read-only |
| Project configuration | project owner / manager | `project_config` (JSON, versioned), `project_codes`, `project_sns`, `project_dm_types` | one row per project; never shared between projects |
| Data module | author | the DMC and the XML itself | the New data module wizard offers what the project enables; **the server enforces it for new modules** |

A change to the catalogue never rewrites a project; a project is never read through another project. There is exactly one configuration system:
the retired flat `info-codes` and `sns` tables and the global `applicability` list are gone from the Administrator (§8, migration).

## 2. Information-code catalogue and provenance

The master catalogue is the **official default BREX of each issue** (`backend/brex/DMC-S1000D-{F,G,H,J}-04-10-0301-00A-022A-D_001-00_EN-US.XML`):

| Kind | BREX rule | 4.2 | 5.0 | 6.0 | 7.0 |
|---|---|---|---|---|---|
| Information codes (listed) | BREX-S1-00180 | 574 | 577 | 579 | 579 |
| …"project available" ranges (patterns) | BREX-S1-00180 | 14 | 14 | 14 | 14 |
| Learn codes | BREX-S1-00139 | 125 | 125 | 125 | 125 |
| Learn event codes | BREX-S1-00141 | 5 | 5 | 5 | 5 |
| Item location codes | BREX-S1-00138 | 5 | 5 | 5 | 5 |

(The BREX holds 588 / 591 / 593 / 593 values for rule 00180; 14 of each are range patterns such as `[0][1-9A-B][A-Z]`, "Project available", which are stored
as ranges, not expanded into codes.) 4.2 → 5.0 adds 025, 026 and 235; 6.0 and 7.0 are identical. All 21 DM-type default codes exist in all four issues.

`ref_sources` records, per issue, the file, its **SHA-256**, the issue and a limitation text; each `ref_codes` row records its rule and source. The Administrator
screen shows them. Seeding runs on every start (`bootReference`), refreshes `origin = 'brex'` rows from the files and never touches custom rows.

**Custom codes** (Administrator) are flagged: a code inside a "project available" range is accepted by the BREX; any other custom code is *outside the BREX* and a
data module using it fails BREX-S1-00180 unless the project's own BREX allows it. Custom codes are edited/deleted only after an **impact preview** (§7).

**Limitation:** only the S1000D **Issue 4.2** specification text is available to this project. Issues 5.0, 6.0 and 7.0 are covered by their default BREX alone.

### DM-type compatibility is advice, not a restriction
BREX does not say which codes suit which DM type, so nothing is enforced. Two pieces of advice are shown and labelled: the type's own default code (`dm-types`), and
the s1kd-newdm code→schema map (`backend/reference/dmtype-recommendations.json`, **not S1000D text**). Any enabled code may be used with any type; BREX judges validity.

### Defaults that had been unresolved
`crew` 131, `frontmatter` 001 and the placeholders `schedul`, `scocontent`, `wrngdata`, `wrngflds` 000 had not been confirmed against an authoritative reference
(see §12: only `wrngdata` and `scocontent` are still open).

## 3. SNS

Hierarchy (`services/sns.ts`): **system** (2–3 chars → `systemCode`) → **subsystem** (2 chars = sub + sub-sub → `subSystemCode` + `subSubSystemCode`) → **assembly** (2 or 4 chars → `assyCode`).
A node's path is its codes joined by `/` (`21`, `21/10`, `21/10/00`), so its parent is implied by the path: **cycles cannot be expressed**. The API additionally refuses a child whose parent
is missing, duplicate paths, bad code lengths, deleting a branch without `cascade`, and recoding/deleting a node that existing data modules use (`409 IN_USE`).
Recoding moves the whole branch. Search keeps ancestors. Import/export: CSV (`system,subsystem,assembly,title`) and JSON (nested tree); import supports a **dry run** and reports every error with its line.

**Presets** are reusable starting points; a project *copies* a preset and then owns its SNS. The eight **S1000D Issue 4.2 Maintained SNS** tables (Chap 8.2.1–8.2.8) ship as read-only presets
(2,414 entries) extracted by `backend/scripts/extract-sns-presets.js` from word coordinates of `S1000D_Issue_4.2.pdf`, pages 3081–3354, and **self-checked** against the specification's own
table captions (every captioned table's first row must be the system its caption names; the script exits non-zero otherwise). The specification disagrees with itself in places
(a caption, the chapter index and the table giving different titles; Chap 8.2.5 defines systems 42, 46 and 72 twice). Those are recorded in the preset file (`specInconsistencies`), the table
row is used, and ambiguous systems are **not** applied to projects automatically. 8.2.2's one-letter "system categories" are grouping rows, not copied. Ranges "available for projects" stay ranges.
Limitation: 4.2 only.

## 4. Project configuration

`project_config.data` (`ProjectConfig`, `services/projectConfig.ts`): MIC, issue (`4-2|5-0|6|7`), language, country, responsible partner, originator, security, BREX (`default` or a project BREX data module),
`codeMode` (`all` | `selected`), `snsEnforced`, `pmTemplate`, applicability table file names, and `origin` (wizard / api / migration + notes).

* **One issue setting.** `config.issue`, when set, is what the Validation page and the build gate use (`projectIssue`); `PUT …/validation/issue` cannot contradict it (`409 ISSUE_FROM_CONFIG`).
* **Lock.** MIC and issue cannot change once the project has data modules (`409 CONFIG_LOCKED`, with the explanation: create a new project and bring the data modules across re-coded and re-validated; the platform never rewrites DMCs).
* **Permissions.** Read: any project member. Write: project owner or manager. Admins manage only the global catalogue.
* **API default.** A project created through the API without `s1000d` is *unconstrained* (no MIC, no issue, nothing enforced). The creation wizard always sends a configuration (defaults: Issue 5.0, en-IN, security 01, every code offered, 21 types).
* **PM template.** The project's PM starting point is the existing *Starts as* profile (`services/profiles.ts`), recorded as `pmTemplate`. The Administrator's separate "PM templates" table still has no behaviour (it never had).

### Server-side rules for a NEW data module (`newDmProblems`)
`POST /dms` and a non-"without validation" import are refused (`400 CONFIG_MISMATCH`, every problem listed) when: the MIC differs from the project's; the module's issue differs; its type is not offered;
the information code is not enabled (`codeMode = selected`); or (`snsEnforced` and the SNS has entries) the system / subsystem / assembly is not in the project SNS. BREX, ACT/CCT/PCT data modules are exempt from the SNS rule.
Editing an existing module is never held to these rules (XSD and BREX judge it). *Import without validation* is the explicit escape.

## 5. New data module wizard
`StudioHost.projectRefs` (loaded from `GET /api/projects/:id/s1000d` and `/applicability`) makes the wizard: show the project's MIC (read-only) and issue (disabled); default language/country/enterprises/security/BREX from the
configuration; list only the offered types; pick system → subsystem from the project SNS (assemblies as suggestions); list the enabled information codes grouped *Suggested for this type* / *Every enabled code* (the type's own default is always shown,
flagged when not enabled, with the unconfirmed-default note); item location codes from the catalogue; learn and learn-event codes for learning modules; and build structured applicability. Standalone Studio (no host) is unchanged.
The DMC preview and the existing identity-uniqueness check are as before.

## 6. Applicability (`services/applicability.ts`)
Implemented: authoring of the project's **ACT (00W), CCT (00Q) and PCT (00P)** as real data modules in the CSDB (info codes from BREX-S1-00180 titles), **XSD-checked before anything is stored**, in all four issues; reading them back;
DM-level selection written as `<applic><assert|evaluate>` plus `<applicCrossRefTableRef>`; and **reference validation** with the data module, line and XPath: `applicRefId` → `<applic id>`; `applicPropertyIdent` → ACT `productAttribute` (prodattr) or
CCT `cond` (condition); `applicPropertyValues` → declared enumeration / pattern / data type (syntax `A`, `A|B`, `1~5`, `1~2|5~10`); the DM's ACT reference; ACT → CCT/PCT references; table integrity. Problems appear in the project's Validation run (source `applic`) and in Settings → S1000D → Applicability.
Semantics follow Chap 3.9.5.3 (the bicycle examples are the test model). Configuration-specific publication is §13. Applicability **errors** are part of the publication gate (§14). Element-level `applicRefId` authoring is in the Properties pane (§15).
A table cannot be emptied once written (a table needs ≥1 entry); delete its data module instead.

## 7. Administrator
*Administrator → S1000D → Code catalogue*: per-issue counts, sources (file, hash, rule, limitation), unconfirmed defaults, browser per kind, custom codes. *SNS presets*: list, view, copy, custom create/edit/delete, import/export.
Editing or deleting a custom code calls `POST /api/admin/s1000d/codes/impact` → projects that selected it, data modules that use it → confirmation (`409 IMPACT_CONFIRMATION_REQUIRED` otherwise) → recorded in `catalogue_impacts` and the audit log. No data module is changed.

## 8. Migration 016 (additive only) and rollback
Tables added: `ref_sources`, `ref_codes`, `ref_code_ranges`, `ref_dmtype_codes`, `sns_presets`, `sns_preset_nodes`, `project_config`, `project_codes`, `project_sns`, `project_dm_types`, `catalogue_impacts`. Nothing is dropped or rewritten.

On start (`app.ts` → `bootReference`): (1) if the database already holds projects and 016 has not run, a consistent snapshot is written first (`workspace/backups/publisher-before-016-s1000d-reference.db`, `VACUUM INTO`); (2) the catalogues and presets are seeded;
(3) rows an administrator authored in the retired flat tables are **copied once** (unknown info codes → custom codes in every issue; flat SNS rows → the preset "Migrated flat SNS"); the old rows stay in `config_items` and rows equal to the old demo seeds are skipped;
(4) every project without a configuration gets one **derived from its contents** — MIC and issue when all data modules agree (otherwise left unset with a note: mixed MICs / issues), language, BREX reference; `codeMode = all`, `snsEnforced = false`, applicability empty.
**No data module is read-modified, re-coded, or given applicability.** The whole thing is idempotent.

**Manual rollback:** stop the server; replace `workspace/publisher.db` with the snapshot (and delete `-wal`/`-shm` files); start the previous build. The new tables are simply absent from the older database.

## 9. API
Read (signed in): `GET /api/s1000d/catalogue?issue&kind`, `/presets`, `/presets/:id`, `POST /api/s1000d/validate-config`.
Admin: `GET /api/admin/s1000d/overview`, `POST /codes`, `PUT /codes`, `DELETE /codes`, `POST /codes/impact`, `POST /presets`, `/presets/:id/{duplicate,import}`, `PUT|DELETE /presets/:id/nodes`, `GET /presets/:id/export`, `DELETE /presets/:id`.
Project: `GET|PUT /api/projects/:id/s1000d`, `PUT …/s1000d/codes`, `PUT …/s1000d/dm-types`, `GET|POST|PATCH|DELETE …/sns`, `POST …/sns/preset`, `GET …/sns/export`, `POST …/sns/import`, `GET|PUT …/applicability`, `GET …/applicability/validate`; `POST /api/projects` accepts `s1000d`.

## 10. Shared repository (CIR)
The CIR holds modules of every model code and issue by design, so it has **no configuration** (`getConfig` returns an unconstrained one that is never stored) and a copy out of the CIR into a project is **not** held to the project's MIC / issue / SNS (`createDm(..., { fromRepository: true })`); XSD and BREX still judge it.

## 11. Tests (actual, 2026-11-21)
Backend `node --test test/*.test.js`: 123 tests, 121 pass, 0 fail, 2 todo (pre-existing). New: `s1000d-reference.test.js` (16), `s1000d-migration.test.js` (2), `applicability.test.js` (3). Frontend unit 388 pass / 2 skipped; verification suites 382 pass; Playwright (`VERIFY_E2E=1`) 76 pass including `e2e/s1000d-config.spec.ts` (5).

## 12. Default information codes - verified against the specification (2026-11-21)
`backend/reference/dmtype-spec-evidence.json` records what the **S1000D 4.2** text says about the six defaults, with the chapters read (`services/s1000dRef.ts` `SPEC_EVIDENCE`):

| Type | Default | Verdict | Evidence |
|---|---|---|---|
| crew | 131 | **supported** | Chap 3.9.5.2.6 (crew schema = crew/operator description and operation); Chap 5.2.3.2 lists IC 111/112/121/131/141/151 for crew operation modules; Chap 8.4.2: 131 = normal operation procedure for crew members |
| frontmatter | 001 | **confirmed** | Chap 3.9.5.2.16 (front matter schema, title page branch); Chap 5.3.1.1 Table 2 codes the Title page module 001 |
| schedul | 000 | **confirmed** | Chap 3.9.5.2.5; Chap 5.2.1.6: maintenance planning modules are coded 000 (SNS 05) |
| wrngflds | 000 -> **029** | **corrected** | Chap 5.2.1.4: wiring data description modules are coded 029 (catalogue title "Data structure"). The default was changed; installations whose row still holds the old placeholder are updated once (`bootReference`), an administrator's own value is never overwritten |
| wrngdata | 000 | **multiple - still flagged** | Chap 5.2.1.4 pairs the wiring data schema with 031, 056, 057, 058 by content; no single default exists (051/052/055 use the descriptive schema). The codes are offered as advice |
| scocontent | 000 | **unresolved - still flagged** | Chap 3.9.5.2.17 names no code (granularity follows the SNS and information codes) |
Limitation: 4.2 text only; 5.0/6.0/7.0 rest on their default BREX (the same codes exist in all four catalogues - tested). The change to `wrngflds` is the only default altered; it is easy to reverse (`dm-types` table, `templates.ts`) if you disagree.

## 13. Configuration-specific publication (`services/applicEval.ts`, `publisher.ts`)
A **configuration** = a PCT product and/or ad-hoc values (ad-hoc values replace the product's for the same property); values are checked against the ACT/CCT definitions.
* `assert`: any selected value matches any token of `applicPropertyValues` (`A`, `A|B`, `1~5`; a range compares numerically when value and both ends are numbers, otherwise as text - the spec's alphanumeric serial-number range example).
* `evaluate and|or`: three-valued (true / false / **unresolved**). A property the configuration does not give is *not satisfied*: it makes the result unresolved unless the logic already decides (false AND x = false, true OR x = true).
* Unresolved results that matter **block** the build (`422 APPLICABILITY_UNRESOLVED`, every place listed with data module, line, XPath). Nothing is built from a guess.
* False applicability removes: an element whose `applicRefId` is false; a data module whose `dmStatus/applic` is false; a `pmEntry` whose `applicRefId` is false; the `dmRef`/include of an excluded module; and PM entries left empty (innermost first). Content without `applicRefId`, and an `<applic>` with display text only, is always included.
* The build works in `.configured/<name>/` (filtered copies; artwork linked) through the same pipeline as the normal build (`renderFull`), then stores `configurations/<PM code>_<product|values-hash>.pdf`. Sources are never touched; the unfiltered publication and its PDF are unchanged unless a configuration is chosen.
* A configuration PDF is **always stamped NOT RELEASED** (a release approves the unfiltered content, not a filtered derivative).
* API: `GET /publish/configurations`, `POST /publish/configured/plan` (what a build would decide, no build), `POST /publish/configured`, `GET /publish/configured/:name`. UI: Editor -> PDF pane -> **Configuration...** (product, values, Check, Generate PDF).
* The publication's data modules are read from the raw PM XML (`pm.ts rawPmReferences`): the editor's PM model keeps only the first dmRef of a `pmEntry`, which had left later references unvalidated by the gate.

## 14. Validation in the publication pipeline
`publishGate.ts` now enforces three layers before build, preview, release request/approval and configuration builds: XSD, BREX **and applicability references** (errors in the modules in scope, and errors in the project's own ACT/CCT/PCT). Applicability warnings never block. The Validation page shows the same issues (source `applic`).

## 15. applicRefId authoring in the editor (platform only; standalone Studio unchanged)
Properties pane: `applicRefId` is a dropdown of the `<applic id>` definitions of THIS data module, described by what they assert; **New...** opens a picker built from the project's ACT/CCT (`ui/applicPicker.ts`, shared with the New data module wizard) and `editor.addApplicDefinition` adds the `<applic>` to `content/referencedApplicGroup` (created after `<refs>` when missing), points the element at it, and adds `applicCrossRefTableRef` to `dmStatus` when absent - one undo step. Verified XSD-valid in all four issues. The Studio patch is limited to `ui/applicPicker.ts` (new), `ui/editor.ts` (`addApplicDefinition`), `ui/panels.ts` (the row), `ui/dialogs.ts` (dialog + wizard reuse), `core/templates.ts`/`core/reference.ts` (options), `styles/app.css`.

## 16. PDF rendering of all 21 types (both engines)
Narrative types (`descript, proced, fault, crew, checklist, process, learning, ipd, sb`), support types (`brex, comrep, container, frontmatter, brdoc, schedul, scocontent, wrngdata, wrngflds`) and reference types (`appliccrossreftable, condcrossreftable, prdcrossreftable`) all print their full content in the direct S1000D -> FO engine and the S1000D -> JSS -> FO engine.
* `backend/vendor/pipeline/support-view.xsl` (AGASTYA addition; vendor provenance noted in its header) turns a support/reference module's `<content>` into the `<description>` the engines already print (levelledPara, tables, lists) using the house styles. BREX: one table per rule group (Rule ID, object path, flag, severity, description, allowed values); ACT/CCT/PCT: dedicated tables; everything else: generic headings with Field/Value tables, so no element or attribute value is dropped.
* Edits to vendored files (minimal, each commented "AGASTYA"): `s1000dtofo/descript.xsl` (calls the view for other content roots), `s1000dtofo/s1000dtofo.xsl` and `s1000dtojss/s1000dtojss.xsl` (include), `s1000dtofo/crew.xsl` (titles of reference cards/drills), `s1000dtofo/frontmatter.xsl` (title-page fields and nested information page), `s1000dtojss/schemas.xsl` (fault isolation wrapper fixed, isolation end points, crew reference card and step titles). Licensing code untouched.
* Verified by `backend/test/pdf21.test.js`: 21 types x 4 issues x 2 engines = 168 renderings, every word of every module's content present in its PDF.

## 17. Comparison with the 20 Nov 2026 reference publications
`backend/test/pdf-reference.test.js` builds the two supplied publications and compares (not pixel parity): data module codes, titles, issue dates, content completeness, page count (tolerance 0.5x-2x), intentionally blank pages; results in `DM_TYPE_VERIFICATION.md` 5.7. Findings: all codes, titles, dates and every content word are present; page counts 40 vs 44 and 32 vs 30; blank pages 9 vs 13 and 8 vs 8. The User Handbook's title-page module breaks default BREX rules BREX-S1-00035 and -00113, so the gate refuses it (left out of the comparison); the samples name a project BREX that is not in the zips (a stand-in was added). The samples contain no applicability assertions, so applicability is tested on the specification's bicycle example.

## 18. Review of the new code
`/code-review` (high) on the code of this work found ten issues, all fixed and covered by tests: watermark file in configuration builds; configuration PDFs claiming a release; item-location/learn codes emptied by "selected" mode; Issue 5.0 never flagged by the new-module check; dead snapshot function; value-list input losing commas and labels; null not clearing an applicability reference; multi-issue code add not atomic; configuration file names that could collide; SNS edit applying the title before refusing the code change. The `/simplify` agents were rate-limited and returned nothing; the pass was done by hand (unused parameters/exports/imports removed, start-up seeding skips unchanged BREX files and presets).

