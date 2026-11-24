# Agastya Platform v2

An offline, on-premises platform for authoring and publishing **S1000D** technical publications, in the
spirit of Xignal: a main dashboard (Overview, Workspace, Projects, Graphics, CIR, Backup, Activity, Administrator, Settings),
and a dashboard per project (Editor, Explore, Publication, Graphics, Validation, Release, Settings). Notifications are a bell
beside an icon-only account menu in the top bar. Nothing calls out to the network.

```
backend/    Express + TypeScript API (node:sqlite for accounts and governance, files on disk for content)
  src/core/   authentication, sessions, permissions, document history  (from JSS Publisher)
  src/services/ projects & folders, CSDB, publication module, validation, release, publisher
  vendor/     publishing engine, XSLT pipelines and bundled tools (xsltproc, Apache FOP) - third-party, do not edit
  schemas/    S1000D XSD sets, one directory per issue
frontend/   React 18 + Vite + Tailwind + Zustand
  src/studio/ the S1000D Studio editor (framework-free TypeScript), embedded - see "Studio patches"
  src/pages/  the dashboards;  src/pages/project/ the six project areas
```

## Run it

Prerequisites: **Node.js 22.5+** (uses the built-in `node:sqlite`) and a **Java 11+** runtime (Apache FOP renders the PDF; `npm run doctor` checks this).
xsltproc, FOP and a Java runtime are bundled for Windows; elsewhere Java must be on PATH.

```bash
npm run install:all
npm run doctor          # is this machine able to publish?
npm run build
npm start               # http://localhost:4040  - one process serves the UI and the API
```

First visit: the app asks you to create the software administrator. Nothing ships with a default account or password.
Forgot it later? On the server machine: `npm run reset-admin -- <username> <new-password>`.

Development: `npm run dev:backend` (port 4040) and `npm run dev:frontend` (port 5174, proxies `/api` and `/ws`).

**From a git checkout:** two things are deliberately not in the repository. The proprietary Arial fonts are left out (copy `arial.ttf`, `arialbd.ttf`, `ariali.ttf` and `arialbi.ttf` from `C:\Windows\Fonts` into `backend/vendor/tools/fonts/` if you hold the licence; without them PDFs are set in Liberation Sans, which has the same character widths - see `backend/vendor/tools/fonts/README.md`). The customer's reference publications in `SAMPLE PROJECTS/` are left out too; the tests that read them skip themselves when the folder is empty - see `SAMPLE PROJECTS/README.md`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4040` | HTTP port |
| `AGASTYA_WORKSPACE_DIR` | `../workspace` | projects, house templates and `publisher.db` |
| `AGASTYA_CLIENT_DIST` | `../frontend/dist` | the built client |
| `AGASTYA_SECURE_COOKIES` | unset | `1` marks the session cookie Secure (also automatic behind a TLS proxy) |
| `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` | unset | unattended first administrator (forced password change at first sign-in) |
| `JSS_JAVA` | bundled runtime, else `java` | path to a Java runtime |

## Tests

```bash
npm test                # builds, then: backend (node:test) + frontend (vitest) + browser end-to-end (Playwright)
```

The end-to-end suite starts the real server on a throwaway workspace and drives the product in Chrome
(`E2E_CHANNEL=msedge` for Edge), writing screenshots to `frontend/test-results/shots`.

Linux needs `xsltproc`, a JRE and `xmllint` on the PATH; the repo's `backend/vendor/tools-linux/` links to them.

### Draft saving and publication

| Action | Malformed XML | Well-formed, schema-invalid XML | Valid XML |
|---|---|---|---|
| **Save** a data module (editor, API, import) | refused, 400 `MALFORMED_XML`, nothing stored | **saved as a draft** | saved |
| **Browser Quick preview** (pdfmake, in the page) | n/a (never saved) | works on the draft | works |
| **Server PDF**: Generate (full build) and server Quick preview | n/a | **refused**, 422 `VALIDATION_FAILED` | built |
| **Release**: request, and approval | n/a | **refused**, 422 `VALIDATION_FAILED` | allowed |

The publication gate (`backend/src/services/publishGate.ts`) runs a **fresh** validation on every one of those server actions: well-formedness, then
the XSD of each module's own declared issue (4.2, 5.0, 6, 7 are installed). It never reads an earlier validation report. It covers the data modules the
publication contains (or the one module being previewed); drafts that are not in the publication do not block it. A module the checker could not judge
(an issue with no installed schema, XInclude, the checker failing to run) counts as **not valid**. The files are hashed before validation and again right
before rendering, so what is published is what was checked (otherwise 409 `CHANGED_DURING_VALIDATION`). The refusal names the modules and carries the
findings (`modules`, `findings`, `validatedAt`); the editor, the Publication page and the Release page show the message.

Limits: each gated request validates the whole project (about 0.5 s for 21 modules, proportionally more for large projects); the publication module
(`publication.xml`) itself is not XSD-validated (it is not a data module); BREX is part of the gate too (next section).

### BREX (business rules) enforcement

A data module is valid for publication only if it satisfies **the S1000D schema and the business rules (BREX) that apply to it**. BREX is checked by the
same publication gate (`backend/src/services/publishGate.ts`, engine in `backend/src/services/brex.ts`): the full build, the server Quick preview, a release
request and a release approval all run a fresh BREX check, and a breach at error level blocks with a 422 `VALIDATION_FAILED` that names the rule and quotes its own
words (`findings[].kind` is `brex`, or `brex-source` when the BREX itself cannot be used). Saving is unaffected: a module that breaks a rule is a draft.
The Validation page includes BREX by default and lists the same findings (source "Business rules (BREX)").

**Which BREX applies.** The module's own `brexDmRef`: the project's data module with that code, else the bundled official default of the module's issue
(`backend/brex/`: 4.2 = F, 5.0 = G, 6 = H, 7 = J, the same files the Studio bundles). A module that names no BREX gets the default of its issue. A BREX
reference chain is followed (a project BREX usually references the S1000D default, and both apply).

| Checked | Meaning |
|---|---|
| context rules | `objectPath` (XPath 1.0, case-sensitive) with `allowedObjectFlag` 0 (must not appear) or 2 (value restricted: `single` with `\|` alternatives, `range` `lo~hi`, `pattern` an XSD regex); only for the schema named by `rulesContext` |
| severity | `brsl01` = error (blocks); `brsl02`..`brsl09` = warning (reported, never blocks) |
| SNS rules, notation rules | the module's system / sub-system / sub-sub-system / assembly code must exist in the BREX SNS; forbidden NOTATIONs may not be declared |
| the BREX itself | blocks publication when it cannot be used: named but not in the project (and not an official default), a rule with an invalid XPath or no path, or a BREX data module that is not valid against its own schema |

**Not enforced, and said so** (reported as warnings, counted in the result): XPath 2.0 rules, value patterns the engine cannot translate, value restrictions
written only in prose, `allowedObjectFlag="1"` (the schema gives it no meaning; the official default BREX has none). Only the data modules in the publication are
gated; the Studio's BREX library in the browser is still per browser, not per project.

#### Gate waivers (drafts only)

A package imported from another tool often names an organisation BREX it does not ship (the Xignal sample names `DMC-RDR-A-00-00-00-00A-022A-D`), and the
author cannot make one appear. The gate stays strict, but an **editor** (or above) may record a **waiver** for exactly that case:

```
GET    /api/projects/:id/publish-waivers          anyone who can see the project
POST   /api/projects/:id/publish-waivers          editor+   { "kind": "brex-missing", "subject": "<BREX code the finding names>", "reason": "<at least 10 characters>" }
DELETE /api/projects/:id/publish-waivers/:wid     editor+
```

A waiver records who, when and why (`publish-waivers.json` in the project, and the audit log). It lets the **full build and the server Quick preview** of
*unreleased* work go ahead; the build log then says `BREX ... is not available - its business rules are NOT enforced in this draft build (waived by ...)`.
It never covers a **release request or approval** (the finding says so), never covers a different BREX, and does nothing once the content is released.
Only `brex-missing` exists: a BREX that is present but invalid, and every schema error, cannot be waived.

### Xignal-style publications

Choosing the `xignal-s1000d` house template (`backend/templates/xignal-s1000d.house.json`, `layout.profile = "xignal"`) turns on the page furniture and
layout rules measured on the Xignal reference publication RDR-1671Y-00039-00: Arial text (Liberation Sans, then DejaVu Sans, behind it), the A4 body
geometry and baseline pitch, per-module numbering, margin marks, figure sizing from the picture's own DPI with ICN lines, "Fig N" cross-references, untitled
tables, "(Continued)" captions, blank pad pages and A3 foldouts. Every one of those knobs defaults to the old behaviour, so the other templates repaginate
exactly as before.

**Where it stands** (measured 20 Nov 2026 on the sample's 32 modules, built through the importer): 30 of 32 modules have the reference's page count and
foldouts, 42 of their 92 pages have the same first and last body line to within 1 pt, 25 of 33 pictures sit within 0.5 pt of the reference, and the
rotated margin marks of the probe pages are identical. **Not matched yet:** the cover / front-matter module `32A-001A` (9 pages here, 1 in the reference),
`913A` (6 pages, reference 4; the source content differs), one table whose row-spanned rows split differently (`400A`), the diagonal NOT RELEASED watermark
(extra here on purpose: it marks any unreleased build), and the 10 pt page-top sub-heading offset. `test/fixtures/golden/xignal-sample.json` records all of this.

Marking text (header logo, margin marks) is resolved once per build, in this order: **Settings that are filled in**, then the publication module's own
directives (`<?agastya company="..."?>`), then the brand pack (`templates/brand/<id>/brand.json` with its logo), then derived values, else left out with a
note - a missing logo never blocks a build. A directive only fills what Settings leave blank; when Settings override one, the build log says so, so an
imported file never silently changes what a controlled document prints. Only `neutral` (nothing printed) is seeded into a workspace.
`backend/templates-optional/brand/lnt-xignal` (the L&T logo and company line taken from the reference PDF) is **not** seeded, because the right to
redistribute another organisation's logo is not established: copy that folder into `<workspace>/templates/brand/` to use it, then pick it in the project's
Settings. `GET /api/brand-packs` lists what is installed.

**Golden-master test** (`backend/test/golden-xignal.test.js`): imports the sample through the real importer, publishes with the gate on (the one recorded
waiver above), then compares geometry - page counts, first/last body lines of the pages that matched, picture boxes, margin marks - with the stored
reference. It only ratchets forward: after a layout improvement run `node scripts/golden-xignal.js <reference.pdf> <platform-build.pdf>` and review the diff.
It skips, saying why, when the sample is not at `SAMPLE PROJECTS/S1000D/...` (override with `GOLDEN_SAMPLE_DIR`).

### JSS editor: what an author can do, and what the PDF does with it

The JSS editor's toolbar is in four tabs (**Write**, **Insert**, **Arrange**, **Document**); Undo and Redo stay beside them.

* **Headings:** six levels, the chapter being level 1 (`maxDepth: 6` for the chapter manuals). The Arrange tab has **Demote / Promote**; a seventh level is refused (`JSS-DEPTH`).
* **Chapter titles** print at **20-22 pt** (21 pt unless Settings give a size in that range): `clampChapterTitleSize()` in `publisher.ts` applies it to every JSS build, so an older template that says 18 pt is brought into range. The seeded JSS templates say 21 pt.
* **Notices** hold paragraphs **and lists** (a list may hold lists); a list put in from the caret inside a notice goes into that notice. A notice and a **table** span the **full text width at every heading level** (1.1.2.1 as much as 1.1): `warnings.xsl` and `tables.xsl` reset the section's indent.
* **Lists in lists:** Tab / Shift+Tab, or the **Nest / Un-nest** buttons, or the List menu.
* **Tables:** **Align** a cell, a column or the whole table (left, centre, right, justified); **Equal columns** and **Widths...** divide the full width.
* **Blank pages** (the pad pages that close a chapter or a front-matter part) carry the running head, the foot and the page number in every profile (`pagesetup.xsl`). The cover's own blank verso keeps only the classification banner, as the cover does.
* **Ancillary pages** (project rail, JSS projects): the pages before the body, in print order, each with a checkbox for whether it prints and an editor for what it says (the words as text fields; the XML for the structure). Backend: `GET/PUT /api/projects/:id/ancillary`, `GET/PUT /api/projects/:id/ancillary/:page`, `POST .../:page/reset`. A page edited here is kept when Settings change (the engine rewrites only a file that is still exactly what it wrote); **Give back to Settings** removes the edit. The saved page list is always written whole, in catalogue order, because the engine prints in the order of that list.
* The **Manufacturer's Part List** type is no longer in the Land catalogue.

Three vendored stylesheets changed for this (`warnings.xsl`, `tables.xsl`, `pagesetup.xsl`, in `backend/vendor/pipeline/jsstofo/`), at the owner's request.

### Xignal-style JSS handbook (best effort)

The `xignal-jss` document type (`backend/templates/xignal-jss.house.json`, `layout.profile = "xignal-jss"`) is the User Handbook with the page furniture of the
Xignal reference RDR-1671Y-00061-00 (JSS-0251, 50 pages): mirrored 25 / 15 mm margins, Arial 12 pt, a two-line running head (publication id over system name,
outer edge) over a 1.13 pt rule, the foot rule with the "Page | n" box on the outer edge, running head and foot also on the blank pad pages, and the blank-page
legend in Arial Bold 12 pt. Head and foot lines, rules, the folio box and the legend are within 0.1 pt of the reference; `test/jss-xignal-look.test.js` holds them.
It prints one title page and no classification on the running pages, as the reference does. The body follows the reference too: each chapter opens on a centred
21 pt divider (20-22 pt by decision; the reference's 18 pt) ("None" when it has no sub-sections) and a blank verso so its text starts on a right-hand page, a data module has no heading of its own, first-level
headings are bold upper case and unnumbered, second-level ones are "(a)"-lettered, and tables span the full text width (the reference sets them in their section's indent; the authors asked for full width) with 0.708 pt rules (measured on pp. 35-50;
chapter 1 is 7 body pages and chapter 3 is 4 in both books). The default User Handbook type is untouched.

Xignal's publication wrapper (the book entry with a "Front matter" folder and a "Chapter" folder holding folders named "1", "3") is unwrapped on import:
the chapters are lifted to the top and numbered by their folder names (`backend/src/services/jssdm/unwrap.ts`). Front-matter modules that the front-matter
import has read into Settings are left out of the body (the build log says how many), so they do not print twice.

**What is not matched, and why.** The reference's "(Continued)" caption above a table that runs onto another page is not reproduced (the engine repeats the header
row of a table that breaks across pages, not its caption), figures, notices and cross-reference styles keep the User Handbook
values because the reference has too few of them to measure, and the platform's front matter is 32 pages where the reference's is 34. The unit-tested
numbers are in `test/jss-xignal-look.test.js`; everything else was compared against the reference by rendering both and measuring, not by a pixel diff.

### Importing a package (Xignal, Vektra, any S1000D set)

```
POST /api/projects/:id/import/scan         files and/or a zip -> report; nothing is written          (author+)
POST /api/projects/:id/import/apply        the same upload -> repairs what is repairable, writes, returns the change log   (author+)
GET  /api/projects/:id/import/unassigned   modules no publication claimed, the sub-publications, where they can go        (viewer+)
POST /api/projects/:id/import/assign       move pool modules into the publication                    (whoever may write the publication)
GET  /api/projects/:id/import/report       what earlier imports did: the batches, and one batch's change log (?batch=<id>, default the latest)   (viewer+)
```

An annexure is a `pmRef` to another publication module. This build never embeds another publication, so such an entry prints nothing: the importer keeps the
entry (so the table of contents still names it), and every publication build says "Annexure ... is NOT part of this PDF" in its log and its warnings.

The importer repairs the defects of the Vektra output itself rather than expecting the plugin to change (`test/importer-repairs.test.js` lists what is covered). A package can be hundreds of files, mostly graphics, so
the upload ceiling is higher than the data-module import's. The importer's numbering model (`/api/projects/:id/sns-rows*`, organisation default at `/api/sns/defaults`;
the project-level SNS of the S1000D reference configuration, with its presets, is `/api/projects/:id/sns` and is separate)
derives and validates structure and learns it from modules without replacing an existing title on its own. An import preview (organisation defaults or BREX) lists the
rows already present, the rows that differ, and marks the ones that differ only in capital letters. The Administrator's older two-column SNS table is retired (the SNS
presets replaced it); rows an upgraded database may still hold in it are merged into the defaults once at the first read, and again on request
(`POST /api/sns/defaults/merge-legacy`, administrator, `{apply:false}` previews). Every derive keeps the publication
module it replaces as `<name>.bak` and as a timestamped copy (`<name>.<yyyymmdd-hhmmss>.bak`, the newest 20 are kept). Xignal front-matter modules and the settings that
feed them convert both ways through `/api/projects/:id/jssdm/{import-frontmatter,generate,status}`. JSG is not built (on hold).

### Offline runtime and licences

Everything runs without the network. Windows ships with xsltproc, Apache FOP 2.10 and a Java 21 runtime (`backend/vendor/tools/jre`); `JSS_JAVA` overrides it.
**That runtime is Eclipse Temurin 21.0.13.1+2 (Eclipse Adoptium), licensed GPL-2.0 with the Classpath Exception** — free to redistribute with the product; the licence texts are in `backend/vendor/tools/jre/legal/` and the project notice in `backend/vendor/tools/jre/NOTICE`, and both must travel with it. It is a trimmed image (built with `jlink --strip-debug --no-header-files --no-man-pages --compress=zip-6`) of just `java.base`, `java.xml`, `java.desktop`, `java.prefs`, `java.logging` and
`java.datatransfer`; a full runtime works too (re-run the build tests after swapping it). The Oracle 21.0.8 image it replaced (Oracle No-Fee Terms) was kept outside the repo at `_backups/jre-oracle-21.0.8-2026-11-20`. Source archive: `OpenJDK21U-jdk_x64_windows_hotspot_21.0.13.1_2.zip`, SHA-256 `bbebea1469996b276683c9299c227b294f85c847039c82633218186a4ad4fbf2`. Fonts and the Arial
decision: `backend/vendor/tools/fonts/README.md`. A font file that is not installed never stops a build (it falls through to the next font in the stack).

### Windows installer and portable package

`npm run package:win -- --build` produces, in `release/`, a self-contained **Setup.exe** (per-machine or per-user, optional Windows service and LAN
firewall rule, upgrade in place with a database backup, uninstall that keeps your data), a **portable ZIP**, and `SHA256SUMS.txt`. Both carry their own
Node.js, Java, FOP, xsltproc and fonts, need no internet and never use it. The server listens on this computer only unless you choose otherwise.

* Installing, running as a service, LAN access, backups, upgrades, silent install, troubleshooting: **docs/OPERATIONS.md**.
* Building, signing, the checks that prove a package, and what you must settle before distributing it (publisher name, icon, Arial licence, end-user
  licence): **docs/PACKAGING.md**. `node scripts/verify-installer.mjs` and `npm run verify:package` test the real artefacts in scratch folders.

### Data module type verification

The 21 data module types of the New data module wizard are verified against the official S1000D XSDs for the four issues
the wizard offers (4.2, 5.0, 6, 7). The heavy suites are kept out of `npm test`:

```bash
npm run test:verify            # tag rules vs the XSD, the real editor, controls, inventory (~6 min) + backend: publication gate and 21-type checks on all four issues (~15 min)
npm run test:verify:elements   # every element of every type on its own, one process per issue (~25 min)
npm run test:verify:e2e        # real browser + server: the wizard and the workflows, 4 issues x 21 types (~12 min)
npm run verify:report          # rebuilds docs/DM_TYPE_VERIFICATION.md from the result files
```

The server refuses malformed XML on save (`services/wellFormed.ts`, 400 `MALFORMED_XML`); well-formed but schema-invalid modules are saved and reported by validation.

`docs/DM_TYPE_VERIFICATION.md` is the 21-type matrix (schemas, tag rules, attributes, realistic XML, editor tests, save/reopen,
per-issue status) with the outstanding gaps. Method: the XSD (through native `xmllint`) is the only authority; the editor's compiled
grammar is what is tested; reference dictionaries (`frontend/src/studio/__tests__/verify/data/`) are an independent cross-check;
every suite has negative controls (a deliberately corrupted grammar must be caught). Realistic modules live in
`frontend/src/studio/__tests__/rich/`; the browser fixtures are regenerated with
`WRITE_FIXTURES=1 npx vitest run src/studio/__tests__/verify/fixtures21.test.ts` (in `frontend/`).

## Review and release

A manual is released only after a person other than its author has approved it.

1. The author finishes the manual and **submits it for review** (Release page). This is a release request; no date is needed.
2. The Project Manager of the project (or an administrator) reads it, can **comment** on the whole manual or on one data module, and
   either **approves** or **sends it back** with reasons (at least one comment is required to send back).
3. The author gets a notification with the reasons, makes the changes, marks each comment **Done**, and **resubmits**. Each pass is a
   review round; the history lists them.
4. On approval the publication is **released**: the PDF has no watermark and names the release in its running head.

Until approval every PDF carries a **NOT RELEASED** watermark, automatically (the watermark settings cannot turn that off). An approval covers
one state of the content: any later change takes it away, the state returns to *Not submitted*, and the next PDF is stamped again.

**Download PDF** (`GET /api/projects/:id/publish/download`) hands out the PDF that matches the current state. If the file on disk was built
before the approval (or from older content) it is rebuilt first, so after approval the author always gets the clean released copy.
States are derived from the release table, never stored: `draft`, `in_review`, `changes_requested`, `approved`. Comments live in
`review_comments` (migration 015). Only the project's Project Manager or an administrator may approve or send back; viewers read but cannot comment.

## Graphics

Per project (`/projects/:id/graphics`): **ICN** artwork (named `ICN-…`, kept beside the data modules where the figure's entity resolves) and
**symbols** (any other image, kept in the project's media folder). Each is listed with the data modules that use it; a graphic still in use is not
deleted without a confirmation (`409 GRAPHIC_IN_USE`). The main dashboard's **Graphics management** (`/graphics`) lists the graphics of every project
the person can open, grouped by project; each project's page shows only its own.

## Common information repository (CIR)

One repository for the whole platform (`/cir`), unlike V1's per-project info-code filter. It is a **shared workspace**: a system project
(`type: 'CIR'`, made on first use, never listed with the projects) that opens in the **normal editor** with the same New data module wizard, so a
common module is created, validated, versioned and given graphics like any other. The code of a data module is **unique inside the repository**
(code + issue + language, the same rule as a project; the wizard moves to the next free assembly code).

- **Create data module** (CIR page) opens the repository's editor with the wizard; **Edit** opens a module in it; **Upload data modules** adds files
  (a module with the same file name is replaced). Uploads are held to the enterprise check.
- **Who may do what:** every signed-in user (Author, Project Manager, administrator) can create, upload and edit; **only a Project Manager or an
  administrator can delete** (`403 CIR_DELETE_ROLE` for an Author, in the CIR page and in the editor's delete button alike).
- **Reuse:** *Add to project* on the CIR page, or, inside any project's editor, the library button **Add from the common repository** (a picker with
  filter and multi-select; modules the project already has are shown as "already here"). A copy becomes that project's own data module and the link
  is recorded in `project.json` under `cirSources`.
- The workspace cannot be renamed, copied, deleted, released or built (`403 CIR_WORKSPACE`); its rail shows only Editor and Graphics. Administrator
  backups include it (`common-information-repository/`). Implementation: `services/cir.ts`, `routes/cir.ts`, authz (`type === 'CIR'` gives every
  user editor, Project Managers manager), table `cir_modules` (who added a module and why).

## S1000D reference configuration, SNS, project creation and data modules

Full reference: [docs/S1000D_REFERENCE_CONFIG.md](docs/S1000D_REFERENCE_CONFIG.md). In short:

* **Global catalogue → project configuration → data module.** The Administrator maintains the per-issue code catalogue (information, learn, learn-event and
  item-location codes) read from each issue's official default BREX, with file / SHA-256 / rule shown, plus SNS presets (the S1000D 4.2 Maintained SNS tables are
  read-only presets). Each project owns its configuration (MIC, issue, language, enterprises, BREX, offered codes and DM types, SNS, applicability); owners and
  managers change it (**Project settings → S1000D**), and MIC and issue lock once data modules exist.
* **New project** is a four-step wizard (project → S1000D identity → codes and structure → review) with sensible defaults (Issue 5.0, en-IN, every code, the 21 types).
* **New data module** wizard follows the project: fixed MIC/issue, system → subsystem from the project SNS, enabled information codes (suggested codes first; the six unconfirmed defaults flagged),
  learn codes, structured applicability. **The server enforces the same rules for new data modules** (`400 CONFIG_MISMATCH`); editing an existing module is never held to them, and *import without validation* is the escape.
* **Applicability:** ACT/CCT/PCT authored as real, XSD-checked data modules; references validated with data module + XML location and enforced by the publication gate (errors block build, preview and release). `applicRefId` is authored in the Properties pane (dropdown of the module's definitions + **New...** from the project's ACT/CCT).
* **Configuration-specific publication:** Editor -> PDF pane -> **Configuration...** builds a separate PDF for a PCT product and/or ad-hoc values (`POST /api/projects/:id/publish/configured`): three-valued applicability evaluation, unresolved properties block the build, filtered PM and content, always stamped NOT RELEASED. The normal Generate is unchanged. See `docs/S1000D_REFERENCE_CONFIG.md` §13.
* **PDF rendering:** all 21 data module types print their full content through both engines (support and reference modules via `backend/vendor/pipeline/support-view.xsl`); verified by `backend/test/pdf21.test.js` (21 x 4 issues x 2 engines) and compared with the 20 Nov reference publications.
* **Default information codes** were checked against the S1000D 4.2 text: crew 131 supported, frontmatter 001 and schedul 000 confirmed, wrngflds corrected to 029; `wrngdata` and `scocontent` remain flagged (§12).
* The wizard still takes languages, countries, DM types, security classes and enterprises from the Administrator's tables (`GET /api/reference`, English / India default).
  Info codes, SNS and applicability are **no longer global lists**: they come from the project.
* Upgrade: migration 016 is additive; a snapshot of the database is taken first and every existing project gets a configuration derived from its contents
  (never editing a data module). Manual rollback is in the document above.

## Complete S1000D implementation (Phase 17)

Architecture: [docs/S1000D_COMPLETE_IMPLEMENTATION.md](docs/S1000D_COMPLETE_IMPLEMENTATION.md). What is and is not compliant (PASS / PARTIAL / MISSING / UNVERIFIED, with measured
test counts): [docs/S1000D_COMPLIANCE_MATRIX.md](docs/S1000D_COMPLIANCE_MATRIX.md). In short:

* **Document-type registry** (`services/registry.ts`): the 21 data module types plus PM, DML, DDN, Comment, Update, SCORM package and ICN metadata; which issue has which XSD is read from `backend/schemas/`
  (Administrator > Standards coverage). Issue 7.0 has no DDN / Comment / Update / SCORM schema: those are MISSING, never invented.
* **CSDB objects** (project > **CSDB**): DML (generated), DDN (generated into delivery packages), Comment, Update, IMF (templates validated against the schema), with S1000D 4.2 Chap 7.5.1 file names,
  HTML and PDF rendering, findings with module / rule / location / fix.
* **Revisions:** every issue / in-work revision is its own file; unpinned references follow the highest revision, pinned ones stay; working revisions, suggested change marks (author-reviewed), release approval issues
  the next issue, supersession / obsolescence (Project Manager, with a reason, audited).
* **Extensions:** foreign-namespace content is preserved; unregistered namespaces are errors; Administrators register profiles (namespace + XSD), projects enable them, enabled content is validated against its own XSD.
* **Packages:** offline ZIP64 reader/writer; project package, S1000D delivery package (one DDN + flat files + manifest), import with a plan/apply report (per-file validation scope, no cross-module id checks),
  uploads stream to disk (default limit 2 GB, `AGASTYA_MAX_UPLOAD_BYTES`).
* **Static HTML publication** (AGASTYA's own format): contents, one page per module, graphics, list of illustrations and abbreviations; ZIP download.
* **Multimedia:** the formats of S1000D 4.2 Chap 7.3.3; active-content types need an administrator's opt-in; asset inventory (hash, ICN, broken references, orphans, duplicates).
* **CIR linked copies:** "update available" notification, Project Manager approval, linked copies are edited in the repository.
* `vendor/engine/pmc.js` keeps every `<dmRef>` of a `<pmEntry>` (approved change); `vendor/engine/license.js` is untouched. Migration 017 is additive.

## Phase 18: remaining S1000D work, real-project round trips (2026-11-22)

Evidence and the PASS / PARTIAL / MISSING / UNVERIFIED statement: [docs/S1000D_COMPLIANCE_MATRIX.md](docs/S1000D_COMPLIANCE_MATRIX.md) (sections 3 and 7). Real projects: [docs/SAMPLE_COMPARISON_REPORT.md](docs/SAMPLE_COMPARISON_REPORT.md).

* **Studio editing of CSDB objects:** project > CSDB > **Edit** opens a Comment, Update file, ICN metadata or SCORM package in the structured editor and saves it back as an object (not as a data module).
  SCORM has grammar-level evidence only: its XSD imports the IEEE LOM schema, which is not bundled, so SCORM packages are reported as *not schema-checked* (see `backend/schemas/PROVENANCE.md`).
* **Applicability:** externalized applicability (`applicRef` into the applicability-annotations CIR module, `referencedApplicGroupRef`) is validated and honoured by configuration publication; `applicConfiguration` is validated and preserved (the 4.2 text defines no filtering for it).
  A configuration value must be one concrete value. Based on the 4.2 text only; later issues UNVERIFIED.
* **Large uploads:** `AGASTYA_REQUEST_TIMEOUT_MS` (default 3 h) alongside `AGASTYA_MAX_UPLOAD_BYTES`; a 4.83 GB ZIP64 package was uploaded over HTTP byte-identical. A full disk answers `507 DISK_FULL`.
* **Publishing fixes found on real data:** publications with two or more illustrated parts modules now build as PDF; data modules with a long DOCTYPE are no longer silently left out of the PDF; a shared XML-catalogue race that made valid modules "unparseable" is fixed.
  Three vendored files changed with approval (`catalog.js`, `ipd.xsl`, `resolveDmRefs.js`; list in `docs/S1000D_COMPLETE_IMPLEMENTATION.md` section 10).
* **Running the suites:** the Studio's verification suites need `xmllint` 2.13 or newer; with the 2.9.14 that Debian ships, 172 of them fail the same way on unchanged code.

## Administrator

`/administrator` (administrators only) has every section of V1's Software Admin Panel: **Roles** (read-only: the code enforces them), **Users**,
**Code catalogue** and **SNS presets** (S1000D), **Country codes**, **Language codes**, **DM types** (seeded with the editor's 21), **PM templates**, **RPC CAGEs**,
**Originator CAGEs**, **Security classifications**, **PDF customisations**, **Data dispatch notes**, **DDN metadata**,
**Interface languages**, **Audit logs** (with CSV export), **Maintenance**, **Visual settings**, **Settings** and **Licence**.
The remaining reference tables share one generic editor (`services/adminConfig.ts`, `config_items` table); seeds are applied once per table.
Maintenance really does: re-index every project, check the installed schema sets, clear temporary preview files, rebuild every PDF (in the
background), back up the platform, export the audit log. Settings (application name, organisation) and Visual settings (accent colour, default
theme, compact layout) are applied for everyone after sign-in. **Licence** is informational: this build enforces no licence key.

### Enterprise check on import

When data modules are imported into a project (or added to the CIR), the responsible partner company is checked against **RPC CAGEs** and the
originator against **Originator CAGEs**: an unregistered **code**, an unregistered **name**, or a registered code and name that belong to
**different enterprises** refuses the whole import and names the problem (`400 IMPORT_REFUSED` with `problems`). The check is **off until
enterprises are registered**: an empty list cannot be checked against, so nothing is refused. Modules that carry a code but no name are checked
on the code alone. Saving in the editor is not checked (only imports and CIR additions).

## Editor defaults

The embedded editor opens with the Navigation, Properties and Problems panes **hidden** and the **Identification** section **folded**; a person opens
them from the View ribbon (their choice is then remembered). Layouts saved before this default are reset once (`agastya.editor.panes.v1`).
The folded section is a host option (`DesignView.defaultIdentCollapsed`); the standalone Studio is unchanged.

## Roles

Global: **administrator** (oversees; creates Project Managers and Authors, owns the Administrator section, owner-equivalent technical rights, does
not create projects), **project manager** (creates Authors and projects, reviews and approves releases of the projects they manage) or **author**.
Per project: **viewer** < **reviewer** (validate, preview, build, comment) < **editor** (change content, submit for review) < **manager** < **owner**
(members, shared house template, deletion). A role granted on a *folder* applies to every project filed in it.

## Studio patches

The embedded editor (`frontend/src/studio`) is a copy of S1000D Studio with a small, host-facing patch to
`ui/app.ts` (a `StudioHost` interface: save to the project, report state, supply PDF settings; quick preview;
go-to-line; silent close) and four absolute asset URLs (`/schemas`, `/vendor`, `/brex`, `/samples`) so it works from
any route. Without a host it behaves as the standalone Studio.
