# S1000D XSD schema sets

One directory per **specification issue**. Copied unmodified from
`Toolkit/xml-validator-main/xml-validator-main`, which keeps the official
S1000D releases separated:

| Directory | Source                     | Files |
|-----------|----------------------------|-------|
| `3.0/`    | `react-editor/public/schemas/3.0` | 24 |
| `4.1/`    | `xml_schema_flat_V.4.1`    | 31 |
| `4.2/`    | `xml_schema_flat_V.4.2`    | 33 |
| `5.0/`    | `xml_schema_flat_V.05`     | 33 |
| `6.0/`    | `xml_schema_flat_V.06`     | 33 |

`xml.xsd` (the W3C namespace schema, identical across issues) was added to the
sets that omit it, since every S1000D schema imports it.

## Why per issue

The application previously validated everything against a single flat
`Shema_S1000D/` folder, and that folder was a **mixture**: `descript.xsd`
carried `Issue number: 5.0` while `proced.xsd` and `fault.xsd` carried `4.2`.
Every description module was therefore checked against 5.0 rules and every
procedure against 4.2, regardless of what the module itself declared — and the
app ships templates for Issues 2.3, 4.1 and 4.2, so the mismatch was routine.

The difference is not academic. In `ipd.xsd`:

```
4.1   figureNumberAttType = xs:positiveInteger, pattern \d{2}
4.2   figureNumberAttType = xs:string,          pattern [A-Z0-9]{1}[0-9]{1}
```

so `figureNumber="00"` is valid under 4.2 and invalid under 4.1. A single
schema set cannot be right for both.

## Choosing a set

`services/SchemaIssue.ts` reads the issue from the document's own
`xsi:noNamespaceSchemaLocation` (`.../S1000D_4-2/...`). `issueNumber` inside
`<dmIdent>` is deliberately **not** used — that is the revision of the
DOCUMENT, not the version of the specification.

When the declared issue has no set installed, the nearest **older** one is used
and the substitution is reported in the validation result, never applied
silently. Issue 2.3 has no published flat schema set here, so 2.3 modules
resolve to 3.0 and say so.

`Shema_S1000D/` is left in place because the HTML and PDF stylesheets reference
it. Validation no longer reads from it.

## What is committed

All five issue sets, about 34 MB.

They have to be here, not merely on the machine that happens to build the
installer. `build.files` in package.json includes `schemas/`, and
electron-builder packages from the WORKING DIRECTORY rather than from git — so
a set present locally but missing from the repository produces two installers
of the same version offering different validation menus, depending on who built
them, with nothing in the interface to show the difference.

Every publication in this workspace declares Issue 4.2 (989 declarations, no
other issue anywhere). The rest are carried for content that arrives from
elsewhere: a supplier's modules, or a publication being migrated between
issues.

Nothing breaks if a file declares an issue that is not installed. The validator
reports it — "declares S1000D Issue 5.0, and no schema set for that issue is
installed (available: ...)" — rather than passing it silently, which would read
as "checked and fine".

The validation panel lists whatever is in this directory, read at run time. To
add an issue, copy its directory in; to withdraw one, delete it. Neither needs
a code change.

## Character entity sets (`<issue>/ent/`)

Issues 3.0, 4.2 and 5.0 also carry the official S1000D/OASIS character entity
sets, copied unmodified from the LIRX schema pack under
`Toolkit/Mid_final/Vektra/Settings/Validation/LIRXSchemaPack/S1000D_*/ent`.
Twenty files each: the `ISOEntities` driver and the nineteen ISO sets it pulls
in (`iso-num.ent`, `iso-tech.ent`, and so on).

4.1 and 6.0 have no set here because the pack has none for them. They are
deliberately NOT mapped to a neighbouring issue: substituting one issue's
characters for another's would be silent and unverifiable, and the missing
mapping shows up as a warning instead.

They matter more than they look. A document declares them by URL —

    <!ENTITY % ISOEntities PUBLIC "..." "http://www.s1000d.org/S1000D_4-2/ent/ISOEntities">

— and every tool here runs with the network off, so without a local copy the
entities are never defined and libxml2 DROPS them: `40&deg;C` publishes as
`40C`. No error, just characters missing from the manual.

server/engine/catalog.js maps those URLs onto these directories at start-up and
hands the catalogue to xsltproc, the validator and the XML language server, so
documents keep the URLs they were authored with and still resolve locally.

## Local change: offline `xml.xsd` import (2026-11-16)

The only edit to these copies: every `<xs:import ... schemaLocation="http://www.w3.org/2001/xml.xsd"/>`
now reads `schemaLocation="xml.xsd"` (the identical W3C file already sits beside it in each issue
folder). Reason: the validator is WebAssembly libxml2 with no network, so the URL import could not be
resolved, the schema failed to compile and every XSD check was silently downgraded to an info-level
"Schema check could not run". The frontend copy (`frontend/public/schemas`) already used the local name.

## Issue 7 and issue-6 detection (2026-11-16)

`7.0/` is a copy of the Issue 7 flat schemas the Studio ships (`frontend/public/schemas/7`, which already imports `xml.xsd` locally).
Before this, no Issue 7 set was installed, and `vendor/engine/validateSchema.js` could not read the declaration `S1000D_6` / `S1000D_7`
(no minor number), so server-side schema checking was silently skipped for issues 6 and 7 (an info-level "Not checked" note).
The parser now accepts a missing minor number as `.0` (a one-line edit to the vendored file, recorded in memory.md).

## Phase 17: document types beyond the 21 data modules (2026-11-21)

Which schemas exist, per issue (generated from this directory - `GET /api/s1000d/coverage`, Administrator > Standards coverage):

| Schema | 4.2 | 5.0 | 6.0 | 7.0 |
|---|---|---|---|---|
| `ddn.xsd` (data dispatch note) | present | present | present | **MISSING** |
| `comment.xsd` | present | present | present | **MISSING** |
| `update.xsd` (data update file) | present | present | present | **MISSING** |
| `scormcontentpackage.xsd` | present | present | present | **MISSING** |
| `xcf.xsd` | present | present | present | **MISSING** |
| `dml.xsd`, `icnmetadata.xsd`, `pm.xsd` | present | present | present | present |

**Provenance of the DDN, Comment, Update, SCORM content package and XCF schemas (4.2 / 5.0 / 6.0):** they are the copied toolkit sources listed
above (`Toolkit/xml-validator-main`), carried unmodified apart from the offline `xml.xsd` import. **There is no independently verified official
origin for them.** The project owner accepted them on that basis (Phase 17 decision) and asked that they be recorded exactly so: they are used for
validation, templates and rendering, and no claim of "official schema" is made for them.

**Issue 7.0:** the four document schemas above are not bundled, and the 7.0 set as a whole is a copy of the Studio's `frontend/public/schemas/7`
whose own origin is not verified - overall 7.0 provenance is **UNVERIFIED**. Nothing was invented or back-ported from another issue: asking the
platform for a 7.0 Comment, Update or DDN is refused with `NO_SCHEMA`, and the compliance matrix marks those cells MISSING.

**Missing dependency found in Phase 18 - the IEEE LOM schema (SCORM content package).** `scormcontentpackage.xsd` (4.2 / 5.0 / 6.0) imports
`../lom_schema/lom.xsd` (namespace `http://ltsc.ieee.org/xsd/LOM`, element `lom`). That folder is **not in this repository** (nor in the toolkit copy that was
supplied), so the schema **does not compile** (libxml2: "The QName value '{http://ltsc.ieee.org/xsd/LOM}lom' does not resolve to a(n) element declaration").
Consequence, measured: SCORM content packages are **not schema-checked at all** - the platform stores them (well-formed, correct root and file name) and reports
them as *not schema-checked*, never as valid (`test/scorm-validation.test.js`). The Phase 17 statements that SCORM packages were "validated against their XSD"
were wrong and are corrected in the compliance matrix. The official IEEE LTSC address (`http://ltsc.ieee.org/xsd/lomv1.0/lom.xsd`) redirects to a login-gated
document site and returns HTML, not a schema; **no substitute was downloaded or written**, because a schema of unknown origin would make the provenance worse, not
better. To close the gap, supply the toolkit's own `lom_schema` folder (the exact files the toolkit's SCORM schema was built against): place it at
`backend/schemas/lom_schema/` (since WP-18 the Studio reads 4.2 / 5.0 / 6.0 from here too; 4.1 would also need `frontend/public/schemas/lom_schema/`), then `test/scorm-validation.test.js` fails on purpose and the matrix row can be
upgraded. The Studio's SCORM editing therefore has grammar-level evidence only (compiled grammar), not XSD evidence.

The frontend copies (`frontend/public/schemas/<issue>/`) of the four 4.2/5.0/6.0 schemas were added in Phase 17 (byte-identical to these) so the Studio
grammars (`frontend/public/grammar/`, built with `frontend/scripts/build-grammar.mjs`) cover them.

## One copy for the browser and the server (WP-18, audit FE-032, 2026-11-27)

The Studio's in-browser check used its own copies in `frontend/public/schemas/{4-2,5-0,6,7}` (31 MB). They equalled `4.2/`, `5.0/`, `6.0/` and
`7.0/` here apart from line endings and the `xml-stylesheet` processing instruction at the top of `xml.xsd` (checked with
`diff -rq --strip-trailing-cr` before removal; this tree also holds `xcf.xsd` and the entity folders the Studio copy lacked). They were removed:
the backend serves these four sets at `/schemas/4-2/`, `/schemas/5-0/`, `/schemas/6/` and `/schemas/7/` (`services/delivery.ts`
`STUDIO_SCHEMA_SETS`, the Vite dev server proxies the same paths), so the browser and the server validate against the same files, and the
Studio tests and `frontend/scripts/build-grammar.mjs` read them from here. Two folders stay in the client because their content differs and
choosing one is a validation decision, not a size one: `frontend/public/schemas/4-1` (its `brex.xsd` and `process.xsd` differ from `4.1/`) and
`frontend/public/schemas/ent` (its `ISOEntities` header and `iso-pub.ent` `rdquor` differ from `4.2/ent`). `test/wp18-delivery.test.js` fails if the
removed folders come back or if the route stops serving this tree's bytes.
