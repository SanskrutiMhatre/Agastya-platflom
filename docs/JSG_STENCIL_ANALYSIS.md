# JSG stencil analysis (Phase 1)

Date: 2026-11-23. Source of truth: the three Word files in `manual format/JSG_FORMAT/`, read directly from their Word XML (`document.xml`, `styles.xml`,
`numbering.xml`, headers and footers). Values below are the **declared** values (page setup, styles, numbering); nothing here was measured from a rendered
page, because no JSG PDF exists in the repository and the Word-to-PDF export started for this analysis had not produced a file when this was written
(see section 7). Nothing in the repository was changed to produce this file; the Word files were copied into the session scratchpad and unpacked there.

JSG = **Joint Services Guide** (`formats.ts` lists "JSG-0308", Land). It is not JSS (Joint Services *Specification*, JSS-0251) and not S1000D.

## 1. What is on disk

| File | Size | Role | Evidence |
|---|---|---|---|
| `JSG_UHB_Stencil.docx` | 233 KB | **Empty stencil** of the User Handbook: placeholders ("PROJECT NAME", "MONTH, YEAR", "FIGURE NAME"), one example table, no body text | 402 body elements, 6 images, 26 header/footer pairs |
| `JSG_UHB_Format.docx` | 123 MB | The **same layout filled in**: a complete User Handbook (Modular Bridge, 128+ figures, 306 images) | 2,621 body elements, 7.5 MB `document.xml`, 29 headers / 28 footers |
| `JSG_ISPL_Format.docx` | 16 MB | A filled **Illustrated Spare Parts List** (100 m Infantry Foot Bridge Floating): plate pages with exploded views and parts tables | 419 body elements, 43 images |

No other JSG material exists: no JSG PDF, no JSG XML, no sample project (`SAMPLE PROJECTS/` holds only JSS-0251 and S1000D; a file-name search for "jsg" finds only these three).

## 2. JSG document types

Two types are evidenced by the files. **Nothing else is claimed.**

| Id | Name | Evidence | Body kind |
|---|---|---|---|
| `uhb` | User Handbook | stencil + filled sample | chapters (CHAPTER > SECTION > numbered paragraphs), appendices |
| `ispl` | Illustrated Spare Parts List | filled sample (no empty stencil) | plates: exploded view image + parts table, in landscape |

`formats.ts` already lists JSG Land with only "User Handbook" (`ready:false`). The ISPL type is new information from `JSG_ISPL_Format.docx`.
Open question for the owner: whether other JSG manual types exist that were not supplied (the JSS side has 15 stencils; JSG has 3 files).

## 3. Shared characteristics (all three files)

* **Page**: A4 portrait 210 x 296.9 mm. Mirror margins and different odd/even headers are on (`settings.xml`: `mirrorMargins`, `evenAndOddHeaders`).
* **Margins (mm)**: top 20, bottom 13.5, inner 25, outer 15, header 10, footer 10 for body and most front matter; title page 20/20/25/25.
* **Landscape sections**: A4 landscape 296.9 x 210 (margins 20/20/15/15 or 25/15/13.5/20) for wide tables and figures; one **A3 landscape** 419.9 x 297 (UHB sample). The ISPL is mostly landscape.
* **Numbering**: front matter lower-roman, restarting at the cover; the body restarts at 1 in decimal. The footer shows the page as `(n)` between parentheses.
* **Running head/foot**: the single word `RESTRICTED` in the header and in the footer (both centred), on every page. The stencil's header 3 carries a book title line
  ("... Technical Manual Part I: Technical Information"); the filled sample does not use it. (Classification wording is data, not a constant: see section 6.)
* **Default font**: Times New Roman 12 pt, justified, single line (`Normal`: after 0, line 240). Tables use Times New Roman 10 pt in `Table Grid`.
* **"This page is intentionally left blank."**: a centred paragraph on a verso page inserted before every part that must start on a right-hand page. 26-71 section
  breaks per file ("next page" / "next column" types) implement this.

## 4. User Handbook (`uhb`)

### 4.1 Front matter, in order (from the stencil and the filled sample)
1. **Cover**: top right document number (bold 14 pt, e.g. `CQAE/UH/E2/24/1A`); a **red-text boxed notice** "THE INFORMATION GIVEN IN THIS DOCUMENT IS NOT TO BE PUBLISHED ..."; emblem picture; centred bold blue (`#3333FF`) 18 pt title "USER HANDBOOK" with a second line (e.g. "(VOLUME I-BRIDGING SYSTEM)") and "FOR" at 14 pt; project name; `A/T or S/O No.`, `DATED`, `NSN` at 14 pt; "SUPPLIED BY:" + company logo + "LARSEN & TOUBRO LIMITED, PUNE 410507 INDIA"; "ISSUED BY:" + authority lines; month, year; a boxed **EQUIPMENT LIFE** table.
2. Verso (blank).
3. **AMENDMENTS** table (21 rows; columns S. No., Page No., Para Reference, Amendment Required, Authority with Ref. No. & date, ...).
4. **Warning** page (numbered 1.-6.), **Demolition of equipment to prevent enemy use** page, **First aid in case of electrical shock** (a 2-row text table, then a 6-row table with four figures).
5. **Associated documents** table (28 rows: Sr. No., Document Title, Document No., Remark) - filled sample only.
6. **ABBREVIATIONS** table (38 rows: Sr. No., Abbreviation, For).
7. **PREFACE** (list paragraphs), **DO'S** and **DON'TS** lists, **IMPORTANT POINTS**, **SYSTEM PHOTOS**.
8. **CONTENTS** (a 3-column table CHAPTERS / DESCRIPTION / PAGE No.), **LIST OF FIGURES** and **LIST OF TABLES** (Word TOC fields over the `Caption` style, with dot leaders).

### 4.2 Body: styles and numbering (from `styles.xml` / `numbering.xml`)

| Role | Style | Look | Numbering |
|---|---|---|---|
| Part divider page | `Section` (based on Heading1) | centred bold caps blue `#0000FF`, 22 pt, own page | `CHAPTER %1` |
| Chapter title | `Heading1` | centred bold caps blue 22 pt, line 360 | `SECTION %1` (decimal, one count across the book) |
| Heading | `Heading2` | bold caps blue 12 pt, before 12 pt / after 6 pt, keep-with-next, hanging 454 twips | `%1.%2` |
| Sub-heading | `Heading3`, `Heading4`, `Heading-5` | same face, hanging 720 / 851 / 992 | `%1.%2.%3`, `%1.%2.%3.%4` |
| Paragraph | `L2-Para` (left 454), `L3-Para` (left 1174), `L4-Para` (1304), `L5_Para` (1474) | justified, line 276 | none |
| Lettered list | `L2-alphanumbering`, `L3-alphanumeric` | justified | `(a)` lowercase letter |
| Procedure step | `Step1` | left 2081 hanging 907 | `Step %1)` |
| Plain list | `List Paragraph` | line 276 | `%1.` |
| Caption | `Caption` | centred bold black, keep-with-next, before/after 6 pt; fields `SEQ Figure` / `SEQ Table` | "Figure n: ..." / "Table n: ..." |
| Front-matter title | `Title` | centred bold 16 pt | none |

Chapters in the filled sample: GENERAL DESCRIPTION (INTRODUCTION, DESCRIPTION), INSTALLATION, OPERATION AND USE (PREPARATION FOR USE, INSTALLATION OPERATION),
MAINTENANCE, ADJUSTMENTS AND REPAIRS (MAINTENANCE, ADJUSTMENT, REPAIRS), TRANSPORTATION, PACKING (SPECIAL FEATURES AND HAZARDS, PACKING AND PRESERVATION, INSPECTION, PACKING DRILL), APPENDICES (A1, B1, C1, D1, E1, F1, G1, H1, J1, K1 ...; the stencil lists H, J, K, M, N, AA, AB, AC, AD).
Counts in the filled sample: 309 captions, 64 Heading3, 54 Heading4, 57 Heading-5, 181 `Step1` steps, 49 two-row tables (figure + legend).

## 5. Illustrated Spare Parts List (`ispl`)

* **Cover**: same family as the UHB cover with the title "ILLUSTRATED SPARE PARTS LIST (ISPL)" / "FOR" / equipment name (18 pt bold blue, line 360), NSN, A/T or S/O No., DATED, SUPPLIED BY, ISSUED BY and a boxed EQUIPMENT LIFE table.
* **Front matter**: CERTIFICATE (page count, signature table), PREFACE (numbered 1.-7., sub-list `SAR alphanumeric` with hanging 680), AMENDMENTS (columns Amendment No., Authority, Date of Amendment, By Whom Amended), ABBREVIATIONS, LIST OF EQUIPMENT ALREADY SUPPLIED AGAINST AT/SO (table), CONTENTS (columns SR. NO., DESCRIPTION OF ASSEMBLY / SUB-ASSEMBLY / COMPONENTS, PLATE REFERENCE, PAGE NO.).
* **Body = plates**: a plate divider page (36 pt bold blue "PLATE - I / GENERAL ASSEMBLY"), then for each plate one or more **view pages** (centred exploded-view picture, red bold 14 pt view caption, caption line "PLATE I-A BRIDGING SYSTEM") followed by the **parts table**.
* **Parts table**: 11 columns - Item No., Plate Ref. No., 'P' Provide, NSN, Designation, No. Off (for 100 m), No. Off (for 1 Set), Drg. No., Firms Part No., Unit Price Rs., Remark (the sub-assembly plates have a single No. Off column: 10 columns). Bold centred header, centred cells except Designation (left) and price (right).
* Plate references nest: `I-A/1`, `I-B/2/9/5` (sub-assembly plates). No paragraph of the sample uses a heading style (plate titles are direct-formatted); the file's `Heading1` style is a boxed grey (`E7E6E6`) centred bold caps 14 pt style, unlike the UHB's blue heading, and its `Caption` style is **red** bold 14 pt.
* Sections: nine lower-roman front-matter sections, then landscape sections (A4 landscape 296.9 x 210, margin 20/20/15/15) for the plates; the page numbering of the body restarts at 1.

## 6. Differences from JSS and S1000D (so nothing is shared by accident)

| | JSG | JSS (`<jssbook>`) | S1000D |
|---|---|---|---|
| Font | Times New Roman 12 | Arial / Arial Narrow headings | Arial / Liberation Sans |
| Heading look | blue caps (UHB) or boxed grey (ISPL) | Arial Narrow black | per profile |
| Chapter numbering | `CHAPTER n` > `SECTION n` > `n.n` | Chapter n > n.n | none (DMC titles) |
| Page marking | `RESTRICTED` header and footer, page `(n)` | header/footer from Settings | per profile |
| Landscape plates | ISPL pages | rare | per module |

Classification wording (`RESTRICTED`) is held as data (a field of the document), not hard-coded, because the sample shows it is the document's own marking.

## 7. What is not known yet (honest gaps)

1. **No rendered reference.** Word was driven through COM to export the three files to PDF (needed to compare layouts); the export of the 233 KB stencil had not completed after
   about four minutes. Until reference PDFs exist, "matches the stencil" can only mean "matches the declared styles", which is the standard the JSS work used and documented.
2. Table column widths, cell shading and border weights are in `document.xml` but have only been sampled (cover boxes, parts table headers), not catalogued.
3. Numbering of Heading1 across chapters (`SECTION n` continuing vs restarting per `CHAPTER`) is read from `numbering.xml` (single abstract numbering, no restart declared); it should be confirmed on a rendered page.
4. Whether further JSG manual types exist (see section 2).
5. The 123 MB UHB file is mostly pictures (306 images, most of them exploded views); the PDF engine must cope with that volume.
