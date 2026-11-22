# Real-project round trip and comparison with the reference PDFs (Phase 18, 2026-11-22)

Two real publications were taken through the platform on **temporary copies** (the originals under `SAMPLE PROJECTS/` and `Samples.zip` were only read): imported through the
validating package importer, validated (XSD, BREX, publication module, graphics, findings), built as PDF (publication gate on) and as static HTML, and compared with the PDF each
was supplied with. The harness is `backend/scripts/sample-compare.js`; the raw measurements are `docs/sample-comparison/*.report.json`. Page images of the first
comparison are in `agastya-platform/screenshots/pdf-comparison-00033/` (outside this folder). Run on Linux (Debian 12, Java 21, poppler) because the Windows machine has no native `xmllint`.

**What this is not:** no claim of pixel parity, of equality with the other tool's layout, or of complete S1000D compliance. The reference PDFs were produced by another tool and are
used as references for content, order, contents list, graphics, pagination, blank pages and layout.

## 1. Maintenance Manual RDR-1671Y-00033 (the sample you asked for)

| Area | Result |
|---|---|
| Package | `PMC-RDR-1671Y-00033-00_000-01.xml (1).zip`, 667 KB: 9 data modules, 8 graphics, 1 publication module |
| Import (strict, per-file XSD checks) | 18 files accepted, 0 rejected, 0.7 s. (A new project already holds an empty publication module; the package's own PM replaces it with `replacePm`.) |
| Validation | 10 files schema-checked, 9 BREX-checked, 0 unchecked. **5 errors**: 4 x "publication entry has no data module" (the PM lists a title page, contents, list of illustrations and list of abbreviations as `#Front-Matter` data modules that are **not in the package**; the original tool generated them) and 1 x "BREX data module unavailable" (the modules name the project BREX `DMC-RDR-A-00-00-00-00A-022A-D`, which is not in the package). 3 info, 9 cross-reference warnings. |
| Deviation | A stand-in BREX with that code (the platform's 4.2 test BREX, no project rules of its own) was added to the **copy** so the build could run; the gate had refused it without. The 4 PM errors remain; PM errors do not block the gate. |
| PDF | built in 4.7 s: **32 pages** (reference 30, x1.07) |
| HTML | built in 1.1 s: 9 pages, 10 html files, 674 KB zip |
| Content | 444 distinct words in the 9 modules: **0 missing from the PDF, 0 missing from the HTML**, 9 of 9 titles present in both |
| Data module order | all 9 modules located in both PDFs; **0 of 36 pairs ordered differently** between ours and the reference |
| Table of contents | 3 pages in both; **the same 9 data module codes** in both, none only in one |
| Graphics | 8 graphics referenced; our PDF carries **8 distinct images** (13 placements); the reference 10 distinct (59 placements: logo, repeated artwork); 8 figure captions in both |
| Pagination, blank pages | page size A4 in both; **"intentionally left blank" pages 8 vs 8**; no empty pages in either |
| Layout (measured, 30-31 sampled pages) | fonts Helvetica/DejaVu (ours) vs Arial (reference); median margins left/right/top/bottom 64/51/35/35 pt (ours) vs 24/43/29/34 pt (reference); running header "RESTRICTED / 160KVA" (our project settings) vs "CONFIDENTIAL / RDR-1671Y-00033-00" |
| Cover (looked at) | same title, issue number and publisher text; the reference has the L&T logo, two photographs and a CONFIDENTIAL header; ours has a RESTRICTED header, a "NOT RELEASED" watermark (by design: an unreleased build) and no cover artwork (the artwork `Media/Satya.png`, `Media/JACKSON.png` is not in the package). The issue date reads 2026-02-02 (reference) and 2026-02-03 (ours); the cause was not investigated. |

**Verdict for 00033:** content, data module order, contents list, graphics and blank-page behaviour match the reference on every measure taken; layout (fonts, margins, headers, cover artwork) differs by design and is recorded, not asserted.

## 2. User Handbook RDR-1671Y-00039 (scale test; not a Maintenance Manual)

| Area | Result |
|---|---|
| Package | a folder copy of `PMC-RDR-1671Y-00039-00_001-01.xml (2)`, zipped for import: 183 MB, 710 files = 218 data modules + 491 graphics + 1 publication module |
| Import (strict) | 710 accepted, 0 rejected (7-28 s depending on the run) |
| **What the supplied PM publishes** | **35 `dmRef` and 9 `pmRef`**: only **30 of the 216 usable data modules** are referenced; the nine `pmRef` point to other publication modules (`RDR-1671Y-00010-00`, `-00041-00`, `-00043-00`, ...) that are **not in the package**, so 186 modules are reached by no supplied PM. The reference's 1,502 pages come from the full publication tree this package does not contain. |
| Validation | 219 files schema-checked, 218 BREX-checked. **11 errors**: 9 schema errors on `publication.xml` (each of the 9 `pmRef` has `pmRefAddressItems` without the required `pmRefIdent`; **confirmed independently with native xmllint against the 4.2 `pm.xsd`**), 1 applicability (a module refers to an applicability cross-reference table the project does not have), 1 BREX unavailable (project BREX not in the package). 16 applicability warnings. With the stand-in BREX, 23 BREX errors against the default BREX appear (BREX-S1-00035 x9, -00113 x9, -00038 x2, -00264 x3: title pages without a publisher name and similar, in the package's own modules). |
| Gate and deviations | the publication gate refused 2 modules of the supplied PM (`...A00-00-00-32A-001A-D` title page: BREX-S1-00035 and -00113; `...A05-50-00-00A-400A-D`: BREX-S1-00208, "pf08" is not a permitted `listItemPrefix`). They were **removed from the copy** (never edited) so the rest could be built. A stand-in BREX was added as for 00033. |

### 2a. Comparison on the supplied PM (30 modules)

| Area | Result |
|---|---|
| PDF | 128 pages in 31 s (the reference has 1,502 pages for the full publication, so the page ratio of 0.09 means nothing) |
| HTML | 30 pages, 86.8 MB zip, 31 html files |
| Content | 2,621 distinct words: **0 missing from the PDF, 0 missing from the HTML, 0 titles missing** |
| Table of contents | the same 30 data module codes in both; ours has 7 contents pages, the reference 155 (its contents list the whole 216-module publication) |
| Order | all 30 modules located in both; **33 of 435 pairs are ordered differently** (first body page carrying the title; titles recur in running text and the reference interleaves the sub-publications, so this is indicative, not proof) |
| Graphics | the 30 modules reference 40 graphics: **40 of 40 present** (78 placements) |
| Blank pages | 24 "intentionally left blank" pages in 128 (19 %) vs 221 in 1,502 (15 %) |
| Layout | A4 plus 2 landscape pages in both (ours A4, reference A3); fonts Helvetica/DejaVu/Courier vs Arial; median margins 44/71/35/35 pt vs 24/43/29/34 pt |

### 2b. Scale build (SYNTHETIC publication module, not the original structure)

A flat publication module listing every data module (alphabetical by code) was written into the copy, to run both engines on all the content. The gate refused 14 of the 216 modules (9 title-page type modules: BREX-S1-00035/-00113; 2 x BREX-S1-00038; 2 x BREX-S1-00264; 1 x missing ACT); they were removed from the copy and listed in the report.

| Area | Result |
|---|---|
| PDF | **202 modules, 848 pages, 91 s, 141 MB**; 13,360 distinct words: **0 missing**; **0 titles missing**; **455 of 455 referenced graphics placed**; 131 intentionally blank pages, 0 empty pages |
| HTML | 202 pages, 455 assets, **0 words missing, 0 titles missing** |

## 3. Defects this work found in the platform (all fixed, each with a failing-first test)

| # | Defect | Effect | Fix |
|---|---|---|---|
| 1 | Shared libxml2 catalogue file rewritten (truncate-then-write) on every `xmllint`/`xsltproc` launch | valid modules reported "XML cannot be parsed" (22 of 218 on this import, intermittent) | write only when changed, via temp file + rename (vendor exception 3); `catalog-race.test.js`: 236,319 of 668,200 concurrent reads torn before, 0 after |
| 2 | `ipd.xsl` gave every illustrated parts module the same ids | **any publication with two or more IPD modules failed as PDF** (`BUILD_FAILED`, duplicate id) | ids carry their module (vendor exception 4); `pdf-multi-ipd.test.js`; single-IPD PDF text identical before/after |
| 3 | Reference resolver read a fixed 8 KiB head of each data module | a module whose DOCTYPE declares many graphics was **silently left out of the PDF** (1 of 218 here, 65 words) | head grows until the identification is read (vendor exception 5); `pdf-long-doctype.test.js` |
| 4 | Node's 5 min request timeout and 5 s keep-alive | a 4.8 GB upload was cut (HTTP 408); idle reused connections reset | `requestTimeout` 3 h (`AGASTYA_REQUEST_TIMEOUT_MS`), keep-alive 65 s |
| 5 | A full disk answered with an opaque 500 | no usable message | `507 DISK_FULL` with a plain message |

Evidence that fixes 2 and 3 changed nothing for ordinary publications: the 00033 round trip was re-run after both and is **identical on every measure** (32 pages, 8 blank pages, 444/0 words, 9 HTML pages, 8 distinct images, 0 order differences).

## 4. Limits of this comparison

* The reference PDFs are another tool's output: differences in layout are expected and are recorded, not judged defects.
* Page-order evidence uses the first body page that carries a module's title; repeated titles make it indicative.
* Fonts and page sizes were surveyed on the first 120 pages, margins and headers on 12-31 sampled pages (reading all 1,502 pages of the 215 MB PDF takes tens of minutes through the container mount).
* The original publication structure of 00039 (the nine sub-publications) is not in the package, so a faithful page-for-page comparison of that handbook is **not possible**; the scale build is synthetic.
* The "Maintenance Manual" you asked for is 00033; 00039 is a User Handbook that was used as a scale test, as you chose.
