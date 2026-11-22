# Bundled fonts

| Files | Family | Used for | Licence |
|---|---|---|---|
| `arial.ttf`, `arialbd.ttf`, `ariali.ttf`, `arialbi.ttf` | Arial | the face the Xignal / S1000D reference publications are set in; the `xignal-s1000d` house template asks for it first | **proprietary** (Monotype / Microsoft) - see below |
| `LiberationSans-{Regular,Bold,Italic,BoldItalic}.ttf` | Liberation Sans | the stand-in for Arial: metric-compatible (every glyph has Arial's advance width), so line breaks and page breaks do not move; only the shapes differ | SIL Open Font License 1.1 - `LICENSE_LIBERATION` |
| `DejaVuSans{,-Bold,-Oblique,-BoldOblique}.ttf` | DejaVu Sans | characters the faces above do not have (e.g. U+01A5, many symbols) | DejaVu Fonts License (Bitstream Vera + Arev; permissive) - `LICENSE_DEJAVU` |

**Arial is not stored in the git repository.** It is proprietary: only a party that holds a licence for it may redistribute it, and pushing to a
remote is distribution (`.gitignore` lists `arial*.ttf`). On a machine that holds the licence, copy `arial.ttf`, `arialbd.ttf`, `ariali.ttf` and
`arialbi.ttf` from `C:\Windows\Fonts` into this folder; otherwise build with `--no-arial` (`npm run package:win -- --build --no-arial`) and the
documents are set in Liberation Sans, which has the same character widths. `vendor/engine/fontconf.js` leaves a missing font out of the FOP
configuration, so a checkout without Arial still builds PDFs.

## How a font is chosen

FOP resolves a comma-separated `font-family` **per character**. The Xignal house template sets

    typography.family = "Arial,Liberation Sans"

and `s1000dtofo.xsl` appends `font.fallback` (`DejaVu Sans,Symbol,ZapfDingbats`), so the stack is

    Arial -> Liberation Sans -> DejaVu Sans -> Symbol -> ZapfDingbats

Each character uses the first face in that list that has it. All of them are registered in `../fop.xconf`.
Both renderers read that one file: the `fop` launcher via `-c` (`engine/build.js`) and the warm daemon via its first
argument (`engine/fopd.js`). Keep them in step - configure only one and whether a character renders would depend on
whether the daemon happened to be warm.

The other house templates still use Helvetica (a PDF base-14 font, never embedded) with DejaVu behind it, exactly as
before, so documents published with them repaginate identically.

## Arial: what was done, and what you must be able to show

The four Arial files were copied from the build machine's own Windows fonts (file dates 1 April 2024) because the
publisher stated that it holds the licence to ship them. That is the publisher's decision and the licence is the
publisher's to hold: Arial is not free software, and the Windows end-user licence is generally *not* a licence to
redistribute the font inside another product. Keep the evidence of the licence you rely on with your release records.

If that licence cannot be shown for a given delivery, **delete the four `arial*.ttf` files. Nothing else needs to change.**
Builds then fall through to Liberation Sans. Because Liberation Sans is metric-compatible, pagination, line breaks and
the geometry measured against the reference stay the same; only the letter shapes change. The golden-master test
(`test/golden-xignal.test.js`) compares geometry, not shapes, so it keeps passing either way.

This is not FOP's own behaviour. FOP 2.10 **aborts the whole render** ("Failed to read font file arial.ttf", exit 1, no
PDF) when `fop.xconf` lists a file that is not there and a document asks for that family - verified, and kept verified
by `test/fop-fonts.test.js`. So every consumer (`engine/build.js`, both call sites, and the warm daemon in
`engine/fopd.js`) asks `engine/fontconf.js` which configuration to use: the real `fop.xconf` when every listed file is
installed, otherwise a copy without the missing entries (written once to the temp folder under a name derived from its
content), with one log line naming what was left out. `missingFonts()` in the same module lists the absent files.

The TrueType files allow embedding (OS/2 `fsType` 8, editable embedding), so the PDFs carry the subset they use and
render the same on a machine that has none of these fonts.

## DejaVu licence

`LICENSE_DEJAVU` is the upstream `LICENSE` of the DejaVu fonts, downloaded from
https://github.com/dejavu-fonts/dejavu-fonts/blob/version_2_37/LICENSE (the same bytes as `master`; SHA-256
`7a083b136e64d064794c3419751e5c7dd10d2f64c108fe5ba161eae5e5958a93`) for the bundled version 2.37 (the version is in the font's own
name table). The font file also carries a shorter copy of the same licence in its name table; the two agree apart from one typo in
the embedded copy ("Tavmjung"). The licence only requires that the copyright notice and permission notice travel with the fonts,
which this file does. Nothing is fetched at run time: the product runs fully offline.

## Platforms

Windows is the shipped platform (see `docs/PACKAGING.md`). Linux packaging, if it is ever wanted, assembles its own tools tree (see the notes in
`engine/paths.js`); whatever builds it must copy the Arial (if kept), Liberation Sans and DejaVu files, their licences and `fop.xconf`
there. `font-base` in `fop.xconf` resolves relative to the file itself, which is why one config serves both platform layouts.
