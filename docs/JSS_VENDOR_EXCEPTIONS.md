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
