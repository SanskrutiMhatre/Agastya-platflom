# Vendor exceptions made for JSS authoring

`backend/vendor/` is third-party code and is not edited. These are the exceptions, each made with the owner's approval. (The earlier exceptions for the S1000D
work are listed in `docs/S1000D_COMPLETE_IMPLEMENTATION.md`, section 10.)

## Exception: `cover.inbr.show` (approved 2026-11-23)

**Reason.** The stencil covers of the User Handbook (UHB), Technical Manual Part II (MM) and Part III (ORM) carry **Code No.** and **Rev No.** at the top left and
have **no "INBR No." line**. The title-page template printed it unconditionally, and its label could not be blanked (`fm-label` falls back to the default
"INBR No.:" for an empty override). UHB2's cover does carry INBR No., so the line cannot simply be removed.

**Affected file (one).** `backend/vendor/pipeline/jsstofo/frontmatter.xsl`:
1. a top-level `<xsl:param name="cover.inbr.show">1</xsl:param>`, with the historical behaviour as its default;
2. an `<xsl:if test="$cover.inbr.show != '0'">` around the one `<fo:block>` that prints the INBR line in the `titlePage` template (the standard layout).
   The Xignal-layout cover (`mode="xjss-cover"`) and the joint cover are untouched.

**Whether the file is shared: yes.** The S1000D direct engine includes it (`s1000dtofo/frontmatter-shared.xsl` includes `../jsstofo/frontmatter.xsl`), so it is rendered
by S1000D builds as well as JSS ones.

**Isolation measures.**
* The default is `1`: any build that does not set the parameter prints the line exactly as before. The S1000D direct engine, the S1000D-through-JSS path and the
  old JSS User Handbook path never set it.
* The parameter is set in exactly one place, `backend/src/services/publisher.ts`, and only when the project is a JSS-authored document (`authoring: 'jss-xml'`)
  whose registry entry has `coverInbr: false` (`backend/src/services/jss/registry.ts`). In the registry only UHB2 has `coverInbr: true`, read from its stencil.
* This exception changed no file under `backend/vendor/pipeline/s1000dtofo/` (the S1000D engine's own stylesheets). At the time a manifest test pinned all of them; since the merge
  with the S1000D Phase 20-22d work (which edits that folder on purpose) the guard is the output fingerprints below plus a test that the S1000D engine reaches the JSS
  stylesheets through one include only (see `docs/JSS_MERGE_2026-11-23.md`).
* No S1000D configuration, XML structure or generation code was changed.

**Regression tests** (`backend/test/jss-cover-isolation.test.js`, 6 tests):
* the registry flags (only UHB2 has an INBR cover);
* JSS-authored UHB, MM and ORM: cover is Code No., Rev No., then the notice; no INBR block in the XSL-FO;
* the stylesheet itself: default and an explicit `1` print INBR (what UHB2 gets), `0` removes it, and the only difference in the output is that block;
* S1000D direct, S1000D through JSS, and the old JSS UHB path: the normalised XSL-FO has the same SHA-256 as the output of the code **before** the exception
  (`test/fixtures/cover-baseline.json`; the checkout location and attribute order are ignored, so it holds in any folder), the old JSS path still prints INBR No. on its cover,
  and the parameter is never sent to those builds;
* the S1000D engine includes one JSS stylesheet only (`frontmatter-shared.xsl` -> `../jsstofo/frontmatter.xsl`), so there is one way for a JSS edit into an S1000D build;
* the parameter appears in one vendored file only and is set in one place only.
The guard was checked to be able to fail: flipping the stylesheet's default to `0` makes the stylesheet test and the S1000D fingerprint test fail.

**Before and after, measured** (same project content rendered by the code before and after; normalised XSL-FO compared, then the PDF text of every page):

| Case | XSL-FO | PDF pages | PDF text |
|---|---|---|---|
| JSS-authored UHB | only the INBR block removed (86 chars), everything else byte-identical | 48 -> 48 | page 1 only |
| JSS-authored MM | same | 42 -> 42 | page 1 only |
| JSS-authored ORM | same | 44 -> 44 | page 1 only |
| Old JSS User Handbook (S1000D data modules through `s1000dtojss`) | identical | 52 -> 52 | identical |
| S1000D sample, direct engine | identical | 20 -> 20 | identical |
| S1000D sample, through `s1000dtojss` + `jsstofo` | identical | 36 -> 36 | identical |

UHB2 is not yet a buildable type (its body is a later step); what is verified for it is the stylesheet default and the registry flag, plus the old JSS path, which
has the same INBR cover and is unchanged.

**To undo.** Remove the `xsl:if` and the `xsl:param` from `frontmatter.xsl`, the `coverInbr` field and the line in `publisher.ts`, and the test file.

---

## Exceptions: the stencil corrections of 2026-11-23 (approved)

The owner approved correcting the remaining stencil differences of UHB, MM and ORM. The method is the same as for `cover.inbr.show`: **every new behaviour is a stylesheet
parameter whose default is the old behaviour**, set only by the JSS authoring build (`layoutParamsFor` in `backend/src/services/jss/service.ts`, called from
`publisher.ts` for a project with `authoring: 'jss-xml'`). S1000D direct, S1000D through JSS, an imported JSS book and the old JSS User Handbook path send none of them.

| Parameter | Declared in | Default (= before) | Why |
|---|---|---|---|
| `cover.inbr.show` | `jsstofo/frontmatter.xsl` (shared) | `1` | UHB/MM/ORM covers have no INBR No. (exception above) |
| `cover.title.split` | `jsstofo/frontmatter.xsl` (shared) | `0` | the MM and ORM stencil covers set their title on two lines ("TECHNICAL MANUAL" / "PART II MAINTENANCE"); the title is split at line breaks only when this is `1` |
| `foreword.documentNo.show` | `jsstofo/frontmatter.xsl` (shared) | `1` | the stencil Foreword has no "L&T Document No." line |
| `para.after` | `jsstofo/jsstofo.xsl` (was a variable, now a parameter with the same default expression) | `3mm` (`2mm` for the Xignal layout) | the stencils' paragraph styles have no space after a paragraph; set to `0mm` |
| `heading.1.font` ... `heading.4.font` | `jsstofo/jsstofo.xsl`, used in `jsstofo/body.xsl` | empty = the body font | Heading 2 is Arial Narrow in the stencils; only level 1 is set |
| `heading.1.gap` ... `heading.4.gap` | `jsstofo/jsstofo.xsl`, used in `jsstofo/body.xsl` | empty = derived from the body indent, as before | the engine ties the heading text and the text under it to one indent; the stencils have the heading text at 8 mm and the paragraphs under it at 7 mm |

Other vendored changes:
* `jsstofo/frontmatter.xsl`, `cautionsNotes` template: the list is only written when there are items. An empty `fo:list-block` is invalid FO and failed the whole build; a page with items is unchanged. (The MM and ORM stencils' Cautions / Notes page is a title with an empty body.)
* `backend/vendor/tools/fop.xconf`: the four Arial Narrow faces are registered, like Arial. The files (`arialn.ttf`, `arialnb.ttf`, `arialni.ttf`, `arialnbi.ttf`, copied from the build machine's Windows fonts) are proprietary and git-ignored by the existing `arial*.ttf` rule; a machine without them still builds (`engine/fontconf.js` leaves a missing face out and the font stack falls through to Arial / Liberation Sans, which is wider). See `tools/fonts/README.md`.

Changes that are **not** vendor changes, made through settings and data:
* the `jss-stencil` house template (`backend/templates/jss-stencil.house.json`, revision 2): Arial with Liberation Sans behind it, the stencil's Demolition wording, the Associated Handbooks headings "Sl. No." / "Code No." and its eleven empty rows, the "SEE OVERLEAF" first-aid reference, no sample cautions;
* the registry (`services/jss/registry.ts`): which pages a stencil has (UHB: System Name page, no Cautions page; MM and ORM: Cautions page, no System Name page) and the wording that differs between stencils (the Foreword's building, the symbols legends);
* a template that declares a `revision` is replaced in an existing workspace when the shipped revision is higher, the old copy kept as `<name>.rev<N>.bak`; no other template is touched (`backend/src/context.ts`).

**Isolation, proved** (`backend/test/jss-cover-isolation.test.js`): each parameter appears only in the files named above; none appears in `s1000dtofo/` or `s1000dtojss/`; none is sent to an S1000D or legacy build;
the 28 files of `vendor/pipeline/s1000dtofo/` are byte-identical to before; and the normalised XSL-FO of the S1000D direct engine, of S1000D through JSS, and of the old JSS User Handbook is identical to the output of the code before any of these changes.

**Before and after, with every change above in place** (normalised XSL-FO against the output of the original code; then the text of every PDF page):

| Case | XSL-FO |
|---|---|
| S1000D sample, direct engine | identical |
| S1000D sample, through `s1000dtojss` + `jsstofo` | identical |
| old JSS User Handbook (S1000D data modules through JSS) | identical |
| JSS-authored UHB, MM, ORM | differ, as intended |

**To undo** a parameter: remove its `xsl:param` and the use of it, and its entry in `layoutParamsFor`.

## Exceptions: the Naval types (2026-11-24, made under the standing brief "small, parameterised, old behaviour as default")

Five more stylesheet parameters, for the ten Naval stencils. Same method as above: **each is declared with the old behaviour as its default**, is set only by the JSS authoring
build (`layoutParamsFor`, from fields of the registry type), and is not sent to an S1000D build, an imported JSS book or the old JSS User Handbook path.

| Parameter | Declared in | Default (= before) | Why | Set by (registry field) |
|---|---|---|---|---|
| `chapter.pageBreak` | `jsstofo/jsstofo.xsl`, used in `jsstofo/body.xsl` | `0` | A `<pageBreak/>` written directly in a chapter (not in a section) was never selected by the chapter template and was dropped silently. It is a defect for the Land types too; fixing it for every document would change old output, so it is on for JSS-authored books only | every JSS-authored book |
| `chapter.divider` | `jsstofo/jsstofo.xsl`, used in `jsstofo/body.xsl` | `1` | A chapter with sections always began with a portrait divider page (heading + topics list). The MRLS, Complete Equipment Schedule and the Part IV volumes have none: the heading opens the first body page, which is folio 1-1. With `0` the heading is passed to `emit-orientation-runs` as `lead` and that first run claims the folio restart the divider had | `chapterDivider: false` |
| `roc.layout` | `jsstofo/frontmatter.xsl` (shared) | `change-notice` | MRLS, CES and SMT/STE print an **Amendments** table of five columns (Sr. No., Page No., Para Reference, Amendment / Required, Authority with Ref No. & Date), 21 blank rows, instead of the four-column Change Notice table | `listFrame: true` |
| `abbrev.layout` | `jsstofo/frontmatter.xsl` (shared) | `description` | the same stencils number the abbreviations: Sr. No. / Abbreviations issued / For (16 blank rows) instead of Abbreviations / Description | `listFrame: true` |
| `safety.footer.show` | `jsstofo/frontmatter.xsl` (shared) | `1` | the same stencils have no "FOR FIRST AID IN CASE OF ELECTRIC SHOCK SEE ..." line under the WARNING | `listFrame: true` |

The labels of the two new tables (`fm.label.amend.*`, `fm.label.abbrev.colSrNo/colIssued/colFor`) are declared in `jsstofo/frontmatter.xsl` next to the switches, **not** in `jsstofo.xsl`:
`frontmatter.xsl` is included by the S1000D direct engine, which declares none of them, so a label declared anywhere else would be an unresolved variable there. They are empty by
default and fall back to the English wording in the template (`fm-label`), exactly like the labels that exist.

**Isolation, proved again** (`backend/test/jss-cover-isolation.test.js`, all its tests pass): every parameter of this and the sections above is found only in the files named (the six
declared in `frontmatter.xsl`, which the S1000D direct engine also includes, only there; the others only in `jsstofo/`); none is in `s1000dtofo/` or `s1000dtojss/`; none is set in `publisher.ts`; each default is
asserted as written above; the normalised XSL-FO of the S1000D direct engine, of S1000D through JSS and of the old JSS User Handbook is
identical to the baseline captured before any of these changes. (The baseline carries `capturedOn`: those documents print the build date, so the comparison maps today's date to the
capture date; without that the guard failed on the date alone, not on a layout change.)

**Other changes made for the Naval types that are not vendor changes:** the registry (`registry-naval.ts`), the schema enum and `Chapter/@orientation`, the stencil tables and publisher
block (`NAVAL_PUBLISHER`, copied into the project as `Media/publisher-logo.png` + `project.json`), `HeadCell.open` (a head cell whose words are the author's, not the stencil's, so the
head check ignores it: the MRLS "Recommended Nos. for 52 Systems for Two Years").

**To undo** a parameter: remove its `xsl:param`, the branch that uses it, its entry in `layoutParamsFor` and its row in this table and in the isolation test.

## Changes made by the owner, not parameterised (commit eb43711, 2026-11-24; merged with the Naval work the same day)

These are **not** exceptions of the kind above: the owner changed the shared stylesheets for every profile, on purpose, so there is no parameter and no old behaviour to fall back to.
They are listed so that nobody mistakes the changed S1000D-through-JSS and old-UHB fingerprints for a regression.

| File | What changed, for every build that goes through `jsstofo` |
|---|---|
| `vendor/pipeline/jsstofo/pagesetup.xsl` | the pad pages that close a chapter (`body-before-blank` / `body-after-blank`) and a front-matter part carry the running head, the foot and the page number, in every profile (before: the prelim ones only in `xignal-jss`, the body ones not at all) |
| `vendor/pipeline/jsstofo/tables.xsl` | a table spans the full text width at every heading level (the Xignal profile used to set it in its section's indent) |
| `vendor/pipeline/jsstofo/warnings.xsl` | a note, warning or caution spans the full text width at every heading level; a paragraph in it keeps its own alignment |
| `templates/uhb.house.json`, `jss-stencil.house.json`, `xignal-jss.house.json` | chapter titles 21 pt (20-22 pt by decision); `clampChapterTitleSize()` in `publisher.ts` brings an older value into range for every JSS-authored build |

**Isolation after the merge** (`backend/test/jss-cover-isolation.test.js`). The S1000D direct engine does not include these files and did not move: its fingerprint still equals the 2026-11-23 value.
The other two baselines (`legacy-jss-uhb`, `s1000d-via-jss`) were **re-captured on 2026-11-24**, because both run `jsstofo`. Shown to be the whole cause, not assumed: with exactly the four files above
(the three stylesheets and `uhb.house.json`) put back to their content before the merge, all three builds gave the 2026-11-23 values again, byte for byte. The Naval parameters of the section above
were in the tree for that measurement, so they too are shown to change none of the three builds.

## Change made by the owner: default artwork (commit c4bc7bf, 2026-11-24; merged with the Naval work 2026-11-25)

Not a stylesheet exception: `applyDefaultArtwork()` in `publisher.ts` supplies the emblem, the Larsen & Toubro logo and the first-aid figures (`vendor/pipeline/jss/artwork`, from the JSS-0251 stencil) to **every
JSS book** (written in the editor, built from S1000D modules or imported) whose project has no such file in its `Media` folder, and never to the direct S1000D engine. It changes the XSL-FO of the two JSS
paths in the isolation guard, so `legacy-jss-uhb` and `s1000d-via-jss` were **re-captured on 2026-11-25**. Shown to be the whole cause: with `applyDefaultArtwork` switched off, all three builds gave the previous
values again, byte for byte; with it on, the only differences in the XSL-FO are the `src` of the emblem, publisher-logo and first-aid pictures (12 lines in the old JSS path, 8 in S1000D through JSS) and the
first-aid box height (115 mm to 145 mm) in the old JSS path. `s1000d-direct` did not move.

---

## Exception: `cover.authority.foot` (approved 2026-11-26, the owner's request "move the date and name to the footer of the first page")

**Reason.** The standard JSS cover printed the month and year, and the "Under the Authority of / Secretary, Ministry of Defence, Govt. of India" block, at the end of the
cover's body, right under the publisher. The owner asked for them in the **footer of the first page**. The Xignal-layout cover (`mode="xjss-cover"`) already does this (the
reference prints them in the foot region); the standard cover now can too.

**Affected files (two).**
1. `backend/vendor/pipeline/jsstofo/frontmatter.xsl`: a top-level `<xsl:param name="cover.authority.foot">0</xsl:param>`; in the `titlePage` and `titlePageJoint` templates the call
   to `authority-block` is wrapped in `<xsl:if test="$cover.authority.foot != '1'">`, and the call to `cover-page-sequence` passes the parameter on as `foot`.
2. `backend/vendor/pipeline/jsstofo/pagesetup.xsl`: a page master `cover-foot` (the cover master with a 28 mm foot region), written only when the parameter is `1` and the layout
   is not Xignal; `cover-page-sequence` takes an optional `foot` parameter and, when it is `1`, uses that master and prints the authority block above the classification banner
   in the foot region. The blank verso that follows the cover keeps the plain cover master.

**Whether the files are shared: `frontmatter.xsl` yes** (the S1000D direct engine reaches it through `frontmatter-shared.xsl`), **`pagesetup.xsl` no** (the S1000D engine has its own).
The S1000D engine's own `cover-page-sequence` does not declare `foot`; XSLT 1.0 ignores a parameter the called template does not declare.

**Isolation measures.**
* The default is `0`: a build that does not send the parameter prints the block in the body exactly as before (S1000D direct, S1000D through JSS, the old JSS path).
* The parameter is sent from one place, `layoutParamsFor` in `backend/src/services/jss/service.ts`, so only a JSS-authored document moves the block. The Xignal JSS layout ignores it.
* No S1000D engine stylesheet was touched.

**To undo.** Remove the `xsl:param`, the two `xsl:if` wrappers and the two `foot` with-params from `frontmatter.xsl`, the `cover-foot` master and the `foot` branch from
`pagesetup.xsl`, and the `cover.authority.foot` entry from `layoutParamsFor`.


---

## Exception: `changenotice.layout` (approved 2026-11-26, the owner's request "make the Change Notice page exactly like the picture", for JSS only)

**Reason.** The Change Notice of a JSS publication was the old three-row page (table font, wide logo, "No. of Pages / No. of Sheets / Enclosures" stacked on the right). The owner's reference
page (the L&T User Handbook) is a pro-forma: the publisher letterhead, a header row and ruled rows in 12 pt (**fifteen** since the owner's request of 2026-11-26), the Pages line over the Enclosures / Sheets line, and a bordered
box that holds the codes for incorporation of changes (R, H, P, A) and, to its right, the justified note. The measurements behind the page are in the comment of the new template.

**Affected file (one).** `backend/vendor/pipeline/jsstofo/frontmatter.xsl`: a top-level `<xsl:param name="changenotice.layout">classic</xsl:param>`; the `changeNotice` template
now chooses: `grid` calls the new named template `change-notice-grid` (with its helpers `change-notice-grid-rows` and `change-notice-code`), anything else runs the old body, which is
untouched inside `xsl:otherwise`. The grid page reads the same configuration as the classic one (the four column headings through `fm.label.change.*`, the page title through
`fm.title.changeNotice`, the publisher logo and name of the book's metadata); the row count is fixed at fifteen (the `rows` attribute of `<changeNotice>` belongs to
the classic layout). The row height is the pro-forma's; the extra rows push the Pages lines and the codes box down, and all of it still fits on the one page (checked on the 24 ready JSS types that print a Change Notice).
The letterhead is the publisher's logo alone (the logo of the book's first publisher, the one the cover prints): the publisher name is no longer printed beside it.

**Whether the file is shared: yes** (the S1000D direct engine reaches it through `frontmatter-shared.xsl`).

**Isolation measures.**
* The default is `classic`: a build that does not send the parameter prints the page it always printed (S1000D direct, S1000D through JSS, the old JSS path). The fingerprints of
  `jss-cover-isolation.test.js` did not move.
* The parameter is sent from one place, `layoutParamsFor` in `backend/src/services/jss/service.ts`, so only a JSS-authored document gets the pro-forma.
* No S1000D engine stylesheet was touched. The running head and foot of the page are the JSS pages' own and were not changed.
* `backend/test/jss-change-notice.test.js`: the stylesheet with and without the parameter (the rest of the book is the same) and a real JSS UHB build (the page text of the pro-forma, on one page).

**Not reproduced.** The reference page shows a black line-art emblem with the name "L&T Defence"; the page prints the logo the project is configured with (the L&T artwork) and no name.

**To undo.** Remove the `xsl:param`, the `xsl:choose` wrapper of the `changeNotice` template and the three `change-notice-*` templates from `frontmatter.xsl`, and the
`changenotice.layout` entry from `layoutParamsFor`.


---

## Exceptions: the L&T reference layout (approved 2026-11-26, the owner's request "JSS Styling Standardization": every JSS document of both systems as `Stencil_Naval_system_NTG Mumbai` is set)

**Reason.** The owner named the Naval stencil of NTG Mumbai (40 pages, a Word file and its PDF) as the default styling of all JSS documentation - header and footer, page layout, fonts, watermarks, logos, front pages,
chapters and ancillary pages - "including the placement and formatting of every element", with exactly two differences between the Land and the Naval system (below). Most of it is page setup and type, which the house template
`jss-stencil.house.json` carries (revision 3: 10 pt running head and foot, 12 pt classification, 16 pt cover title, 18 pt chapter title, 7 mm bottom margin, 6.5 mm body bottom margin and footer). The rest needed the vendored
stylesheets; it is switched on by one parameter, `ref.layout`, sent only for a JSS-authored document that is not on the Xignal JSS layout (that layout keeps its own profile).

**Parameters** (every default is the old behaviour; all are sent from `layoutParamsFor` in `backend/src/services/jss/service.ts` and nowhere else):

| parameter | default | JSS-authored value | what it does |
|---|---|---|---|
| `ref.layout` | `0` | `1` | the reference layout: cover (page 1), its blank back with nothing on it (2), the title page (3, the cover again) and its back with only the legend (4), cover and title page on 25 mm margins with Code No. / Rev No. right aligned, thin red-ruled notice boxes, the date and authority block in a foot region above the classification (baselines 758 / 772 / 810 pt), running head and foot as the reference draws them (10 pt, book name over system name, 0.5 pt rules, 5.4 pt inset), page titles underlined and 11 pt lower, the red notice pages 23 pt lower with the box padded, a 12 pt front-matter table size, the Foreword on 20.5 pt lines, the contents lines 20.5 pt apart, the chapter divider (title 18 pt underlined, topics between double rules, `---End of Chapter---`), section headings underlined, the first section of a chapter 23 pt lower |
| `restricted.scope` | `all` | Land `cover`, Naval `reference` | where the classification prints: `all` = every page (as always); `cover` = the cover and the title page only (**Land**); `reference` = the cover, the title page and the Change Notice page (**Naval**, as the reference prints it). Neither prints it in the running head and foot |
| `chapter.title.align` | `left` | Land `left`, Naval `center` | where a chapter's title starts on its divider page (**the second difference between the systems**) |
| `heading.underline` | none | `1 2 3 4` | the section-heading levels that are underlined |
| `red.color` | `#CC0000` | `#FF0000` | the red of the notices and boxes (the reference prints pure red) |

**Affected files.** `jsstofo/frontmatter.xsl` (declares `ref.layout`, `restricted.scope`, `red.color` and the variables built on them - the file the S1000D direct engine includes - and holds the reference cover / title page,
the Foreword, safety, authority-block and Change Notice edits), `jsstofo/common.xsl`, `body.xsl`, `headers_footers.xsl`, `pagesetup.xsl`, `toc.xsl`, `jsstofo.xsl` (JSS-only: the page setup, the running head and foot, the divider,
the heading and the page-title / red-box blocks; `chapter.title.align` and `heading.underline` are declared in `jsstofo.xsl`). **Shared: yes, for the three declared in `frontmatter.xsl`.**

**Isolation measures.**
* Every edit is behind `$lref` / a parameter whose default is the old value, and the old structure is emitted untouched in the `xsl:otherwise` branch (for the red box and the Foreword the old FO is byte-identical, not just equal in
  effect). `test/jss-cover-isolation.test.js` fingerprints (S1000D direct, S1000D through the JSS pipeline, the old JSS User Handbook) did not move; its parameter table now lists the five new parameters, where each is declared and
  used, and that the shared three default to the old behaviour. One normalisation was added (see "logo" below).
* Not sent to the Xignal JSS layout (`layout.profile = xignal-jss`), which keeps its own cover, head and foot.
* `test/jss-reference-layout.test.js` (new): both systems' cover / blank back / title page / back, the running head at the reference's 40 pt, 18 pt chapters, RESTRICTED on pages 1 and 3 only (Land) or also on the Change Notice
  (Naval), the chapter at the left margin (Land) or centred (Naval), and the same positions in both systems.

**The two differences between the systems** (everything else is the same code with the same values): `restricted.scope` (Land: cover and title page; Naval: those and the Change Notice) and `chapter.title.align` (Land: left;
Naval: centre). The reading of "the Land system shows the watermark only on the first two pages": the first two printed pages of the cover are page 1 and the title page (page 3); the NOT RELEASED watermark is a different thing and
stays status-driven in both systems.

**The logo.** The L&T Precision Engineering logo the owner supplied (`backend/assets/L&T Precision Engineering Logo.png`, identical to `assets/default-publisher-logo.png`) is the Larsen & Toubro fallback for every JSS book
(`applyDefaultArtwork` in `publisher.ts`; before: `vendor/pipeline/jss/artwork/lt-logo.png`), on the cover, the title page and the Change Notice letterhead (34 pt tall under the reference layout; the page keeps its 15 rows
and codes box on one page). A project's own `Media/publisher-logo.png` still wins. The isolation guard maps the one changed file name back, so its fingerprints still prove the layout of the old paths is unchanged.

**Chapter title size.** `clampChapterTitleSize` (publisher.ts) now returns 18 pt (a Settings size between 18 and 22 pt is kept) for every JSS document except the Xignal JSS layout, which keeps the 20-22 pt of the owner's
decision of 2026-11-24. The two decisions concern different layouts; the reference decision (18 pt) is the later one.

**Not reproduced.** The reference's system pictures (the first-aid figure sheet with its "Figure. N" labels, the symbol icons) and the default texts of the Cautions / Notes page; the reference's hyperlinked e-mail address and
its sample address block (the Foreword prints the project's own); the NOT RELEASED watermark (a blank stencil has none).

**To undo.** Remove the `lref`-guarded branches and the three parameters from `frontmatter.xsl`, the two from `jsstofo.xsl`, the `ref.layout` / `restricted.scope` / `chapter.title.align` / `heading.underline` /
`red.color` entry from `layoutParamsFor`, and restore revision 2 of `jss-stencil.house.json` (the previous copy is kept as `jss-stencil.house.json.rev2.bak` in a workspace that has been upgraded).

## Exception: `foGuard` (2026-11-27, audit work package WP-02, findings SEC-003 and SEC-011; made under the owner's approval of the audit roadmap)

**Reason.** Apache FOP fetches whatever an `fo:external-graphic`, a `background-image` or an SVG `<image>` names. The audit reproduced a build in which the bundled Java
requested `http://127.0.0.1:<port>/pixel.png` because a publisher logo in `project.json` named it (server-side request forgery), and showed that a picture reference can
also name any file of the machine. The settings route now refuses such values, but the XSL-FO is assembled from several places (project settings, brand packs, stylesheet
parameters, generated front matter, older projects and imported archives), so the check has to sit where every build passes.

**Affected files.** One new file, `backend/vendor/engine/foGuard.js`, and two call sites in `backend/vendor/engine/build.js` (the JSS-path build and the S1000D direct build),
each one line before the existing `checkImages` step. Outside the vendor folder the same function is called by `services/jsg/engine.ts` (JSG) and `services/objectRender.ts`
(single-object PDF), and `services/publisher.ts` passes the allowed folders (`resourceRootsFor`: the project, the shared templates and brand packs, `backend/assets`,
`backend/schemas`, `backend/vendor/pipeline`; the build folder and the vendored engine are always allowed).

**Behaviour.** A reference that is a `data:image/...` value or a local file inside an allowed folder is kept; an SVG is kept only when its own references obey the same rule.
Anything else (http, https, jar, ftp, UNC, a drive path or `..` outside the allowed folders) is replaced by a 1x1 transparent PNG, the build log says which reference was
refused, and the build goes on. `fo:basic-link` destinations are links in the PDF, never fetched, and are not touched.

**Isolation measures.** When no reference is refused the FO file is not rewritten at all (byte-identical; the unit test checks the content and the modification time), so the
output of every legitimate build is unchanged. No stylesheet, configuration or generated structure was changed.

**Regression tests** (`backend/test/fo-guard.test.js`, 4 tests): allowed references are untouched; nine kinds of hostile reference plus a background image and an inline SVG
image are blanked; the reference forms FOP understands; and end to end, a logo URL planted in `project.json` pointing at a loopback listener is refused by the settings route
and, written to disk directly, is never requested by a build (the listener records nothing). The guard was checked to be able to fail: with `confineFo` disabled the end-to-end
test fails with `GET /pixel.png Java/21.0.13.1` on the listener.

**To undo.** Delete `foGuard.js` and the `foGuard` lines in `build.js`, `jsg/engine.ts` and `objectRender.ts`.

## Exception: "FO-stage scaling" (2026-11-27, audit work package WP-33, finding PERF-003 (P0); made under the owner's approval of the audit roadmap)

**Reason.** The FO stage of the direct S1000D engine (one `xsltproc` run of `s1000dtofo/s1000dtofo.xsl` over the whole publication) grew super-quadratically
with figure-bearing data modules: 9.9 s for 50 and an extrapolated hour for 500 modules on the shipped libxslt 1.1.28. The causes were whole-book XPath scans
evaluated once per figure, per repeated id, per reference or per abbreviation, and one expression (`//dmodule//figure[title]`) that libxml2 evaluates with a
quadratic merge even when it runs once.

**Affected files.** `backend/vendor/pipeline/s1000dtofo/frontmatter-s1000d.xsl` (list of illustrations: the first titled figure is computed once, on the descendant axis;
list of abbreviations: a new key `acronym-by-term`), `s1000dtofo.xsl` (`unique-id` and `dm-occurrence-suffix` read a position in an existing key instead of counting
`preceding::`), `refs.xsl` (`internalRef` fallback evaluated only when there is no enclosing module; `footnoteRef` by key), `warnings.xsl` (`@warningRefs` / `@cautionRefs`
by key). The JSS stylesheets were measured and are already linear; nothing there changed.

**Behaviour.** None: the same FO. Each replacement selects the same node-set (in document order) or the same number by construction, and where a key might not hold a node
the old expression stays as the fallback. libxslt makes `generate-id()` from memory addresses, so two runs of even the unchanged stylesheet differ in those ids; the
FO is therefore compared after renaming generated ids in order of first appearance, which accepts a one-to-one renaming and nothing else.

**Isolation measures.** No parameter, no new output; every other profile and pipeline is untouched. The pre-change stylesheets are kept in
`backend/test/fixtures/wp33-old/` (test data only, never loaded by a build).

**Regression tests.** `backend/test/wp33-fo-equivalence.test.js` (old against new FO under the default and Xignal profiles: cloned publications with a reprint, warning and
caution references, footnotes, an id nested in an element with the same id, repeated abbreviations, no figures, 200 figures in one module, the 21-type fixtures in four
issues and the rich set; it fails on a one-step change of the duplicate-id count), `backend/test/wp33-fo-scaling.test.js` (benchmark B6, 50 to 500 modules, limits on time
and growth). Results and timings: `docs/audit/IMPLEMENTATION-LOG.md`, WP-33.

**To undo.** Copy the four files from `backend/test/fixtures/wp33-old/` back over `backend/vendor/pipeline/s1000dtofo/`.

## Exception: "FO hook" (2026-11-27, audit work package WP-15, finding PUB-017; made under the owner's approval of the audit roadmap)

**Reason.** PDFs had no document properties (Title, Author, Subject, Keywords). FOP fills them from an `fo:declarations` XMP packet. Writing one from the
stylesheets of each engine would have meant new parameters in each; one hook in the build driver lets the platform write the packet into the FO that the
stylesheets already produced.

**Affected file.** `backend/vendor/engine/build.js`: an optional `onFo(foAbsPath)` option, called in `buildJss` and `buildS1000dToFo` after the
WP-02 `foGuard.confineFo` step and before FOP. Nothing else in the vendored tree changed; no stylesheet changed.

**Behaviour.** Without the option: none. With it (the platform always passes it: `services/publisher.ts` `pdfInfoFor`, `services/pdfInfo.ts`), the FO gains one
`fo:declarations` block after `fo:layout-master-set`; layout, pages and text are the same. The JSG engine writes the same packet itself (`services/jsg/engine.ts`),
since it does not go through `build.js`.

**Not done, on purpose (decision D9, the audit's recommendation).** No tagged PDF (FOP accessibility) and no PDF/A: neither JSS-0251 nor S1000D asks for them.
Arial stays (owner decision); the licence basis is in `backend/vendor/tools/fonts/README.md`.

**Regression tests.** `backend/test/wp15-jsg-release.test.js` reads Title, Author, Subject, Keywords and Creator of a JSG, a JSS and an S1000D PDF with pdf.js.

**To undo.** Remove the two `if (typeof o.onFo === 'function')` lines (and the option comment) from `build.js`.
