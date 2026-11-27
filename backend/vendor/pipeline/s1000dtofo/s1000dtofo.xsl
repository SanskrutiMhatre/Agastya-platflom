<?xml version="1.0" encoding="UTF-8"?>
<!-- ********************************************************************
     S1000D to XSL-FO Transformation Stylesheet
     
     This is the main entry point for transforming S1000D XML directly
     to XSL-FO for PDF generation, bypassing the intermediate DocBook step.
     
     Based on the modular architecture of s1000dtodb stylesheets.
     
     Copyright (C) 2024
     ******************************************************************** -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
  xmlns:fo="http://www.w3.org/1999/XSL/Format"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xlink="http://www.w3.org/1999/xlink">
    <!-- ==================================================================== -->
    <!--                         OUTPUT CONFIGURATION                          -->
    <!-- ==================================================================== -->
    <xsl:output method="xml" indent="no" encoding="UTF-8"/>
    <!-- ==================================================================== -->
    <!--                         PAGE PARAMETERS                               -->
    <!-- ==================================================================== -->
    <!-- Paper size: A4 (default) or A3. Override with stringparam paper.size. -->
    <xsl:param name="paper.size">A4</xsl:param>
    <xsl:param name="page-height">
        <xsl:choose>
            <xsl:when test="$paper.size = 'A3'">420mm</xsl:when>
            <xsl:otherwise>297mm</xsl:otherwise>
        </xsl:choose>
    </xsl:param>
    <xsl:param name="page-width">
        <xsl:choose>
            <xsl:when test="$paper.size = 'A3'">297mm</xsl:when>
            <xsl:otherwise>210mm</xsl:otherwise>
        </xsl:choose>
    </xsl:param>
    <xsl:param name="page-margin-top">11mm</xsl:param>
    <xsl:param name="page-margin-bottom">12mm</xsl:param>
    <xsl:param name="page-margin-left">25mm</xsl:param>
    <xsl:param name="page-margin-right">15mm</xsl:param>
    <!--
      Binding (inner) and trimmed (outer) margins for double-sided printing.
      These sit on the PAGE master, mirrored between recto and verso, so the
      body, the running head and the running foot all occupy the same
      horizontal band. They used to be split between the page master and an
      extra margin on region-body alone, which left the header/footer rules
      starting 15mm outside the text they belong to.
    -->
    <xsl:param name="margin-inner">25mm</xsl:param>
    <xsl:param name="margin-outer">15mm</xsl:param>
    <xsl:param name="body-margin-top">25mm</xsl:param>
    <xsl:param name="body-margin-bottom">30mm</xsl:param>
    <xsl:param name="region-before-extent">15mm</xsl:param>
    <!-- Breathing room kept clear below the header logo, so it cannot touch
         the rule or the text under it. Subtracted from the header extent to
         give the logo its ceiling; see the "logo" template. -->
    <xsl:param name="logo.header.margin">4mm</xsl:param>
    <xsl:param name="region-after-extent">25mm</xsl:param>
    <!-- ==================================================================== -->
    <!--                         TYPOGRAPHY PARAMETERS                         -->
    <!-- ==================================================================== -->
    <xsl:param name="font-family">Helvetica</xsl:param>
    <!--
      Fonts consulted for any character the main font does not contain.

      The base-14 PDF fonts are WinAnsi-encoded: they have no glyph for
      characters as ordinary in a technical manual as U+2265 GREATER-THAN OR
      EQUAL TO. FOP does not fail on a missing glyph — it prints "#" and logs a
      warning nobody reads, so "≥ 40 mm" silently became "# 40 mm" in the PDF.

      FOP resolves a comma-separated font-family per CHARACTER, so listing the
      base-14 Symbol and ZapfDingbats after the main font fills the gaps at no
      cost: no font files to ship, and text the main font can render is
      completely unaffected because it is still tried first. Between them these
      two cover the maths, Greek, arrows, ticks and typographic punctuation a
      manual actually uses.

      Set this empty to go back to a single font.
    -->
    <!--
      DejaVu Sans comes first: it is a bundled Unicode font (registered in
      tools/fop.xconf) and covers the Latin Extended-B, punctuation and symbol
      ranges the base-14 fonts and Symbol both lack, e.g. U+01A5 LATIN SMALL
      LETTER P WITH HOOK, which used to print as "#". Symbol and ZapfDingbats
      stay after it as a last resort for the few dingbats DejaVu lacks.
    -->
    <xsl:param name="font.fallback">DejaVu Sans,Symbol,ZapfDingbats</xsl:param>
    <xsl:variable name="font-stack">
        <xsl:value-of select="$font-family"/>
        <xsl:if test="normalize-space($font.fallback) != ''">
            <xsl:value-of select="concat(',', $font.fallback)"/>
        </xsl:if>
    </xsl:variable>
    <xsl:variable name="monospace-stack">
        <xsl:value-of select="$monospace-font"/>
        <xsl:if test="normalize-space($font.fallback) != ''">
            <xsl:value-of select="concat(',', $font.fallback)"/>
        </xsl:if>
    </xsl:variable>
    <!-- Same setting as jsstofo.xsl, redeclared here because the two engines
         are separate compilations sharing jsstofo/frontmatter.xsl's markup —
         see the identical note there for what this drives and why. -->
    <xsl:param name="cover.title.font-family" select="$font-stack"/>
    <xsl:param name="cover.title.font-size">14pt</xsl:param>
    <!-- Code No. / Rev No. lines on the title page; empty = not printed. -->
    <xsl:param name="cover.codeNo"/>
    <xsl:param name="cover.revNo"/>
    <xsl:param name="font-size">10pt</xsl:param>
    <xsl:param name="standard-leading">8pt</xsl:param>
    <xsl:param name="inner-type-limit">20mm</xsl:param>
    <!--
      Where a table's left edge sits.

      Defaults to $inner-type-limit, which is the width of the number column in
      a heading — so a table lines up with the heading TEXT above it (the "R"
      of "RADAR SPECIFICATIONS"), and with the body paragraphs, rather than
      starting out at the page margin under the heading's number. Set it to 0mm
      to pin tables to the margin as before.
    -->
    <xsl:param name="table.indent"><xsl:value-of select="$inner-type-limit"/></xsl:param>
    <xsl:param name="body.start.indent">20mm</xsl:param>

    <!-- ==================================================================== -->
    <!--            SETTINGS PARAMETERS SHARED WITH THE JSS ENGINE             -->
    <!-- ==================================================================== -->
    <!--
      Everything below is driven from Settings. They were previously hardcoded
      here (or in an attribute-set), so the Headings, Lists and Figures tabs
      silently did nothing on this engine while working on the JSS one — the
      build filters out any parameter the stylesheet does not declare, and 40
      of the 55 it sends had no home.

      Defaults deliberately mirror jsstofo's, so an unset value renders the
      same on both engines rather than quietly diverging.
    -->
    <xsl:param name="line-height">1.35</xsl:param>
    <xsl:param name="header-footer-size">9pt</xsl:param>
    <!--
      The security classification banner ("RESTRICTED" and friends).

      Everything about it used to be hardcoded at the point of use, so a
      customer whose house style wants it black, larger, or sitting further
      from the text had no way to say so. Each value below defaults to what the
      engine already produced, so an unset project renders byte-identically to
      before and only a deliberate change moves anything.

      Padding rather than margin: the direct engine draws the banner inside a
      header/footer table cell, where padding is the lever that actually moves
      it. The same properties then mean the same thing on both engines.
    -->
    <xsl:param name="classification.size"/>            <!-- empty = follow header-footer-size -->
    <xsl:param name="classification.color">inherit</xsl:param>
    <xsl:param name="classification.weight">bold</xsl:param>
    <xsl:param name="classification.decoration">none</xsl:param>
    <xsl:param name="classification.align">center</xsl:param>

    <!--
      The running header's publication line.

      By default it is the model identification code followed by the word
      PUBLICATION — "MLOC PUBLICATION" — which is what the code says the
      publication IS, and comes from each data module's own dmCode. Neither
      half could be changed without editing this stylesheet.

      header.publication.text replaces the whole line when set, for a book that
      must say something else entirely; header.publication.suffix changes only
      the word after the code, which is the common case and the one worth
      being able to translate.
    -->
    <!--
      Where figure numbers restart.

      "module" is how S1000D numbers them and has always been the behaviour
      here: each data module counts from 1, because a module is a unit that can
      be reissued or reused on its own and its figures belong to it. Read as a
      publication, though, a list of figures that says Fig 1 fourteen times
      identifies nothing — which is the case for "continuous", counting once
      through the whole book.

      Neither is wrong; they answer different questions. The default stays
      "module" because changing it renumbers every figure in every existing
      publication.
    -->
    <xsl:param name="figure.numbering">module</xsl:param>

    <!--
      Where page numbers restart: at the start of every data module
      ("chapter", matching S1000D's own default page-oriented presentation
      rule — "each data module... starts on page one", Issue 4.2 §2.2 TOC —
      a business rule a project is free to override), or once through the
      whole publication ("continuous", this engine's previous and only
      behaviour, every page-sequence carrying initial-page-number="auto").
    -->
    <xsl:param name="page.numbering">chapter</xsl:param>

    <xsl:param name="header.publication.text"/>
    <xsl:param name="header.publication.suffix"> PUBLICATION</xsl:param>
    <!-- The line that closes a data module, printed in the flow where the
         module ends. Blank the text to suppress it entirely. -->
    <!-- ================================================================ -->
    <!--  SIDE NOTES (rotated text down the outer margin)                   -->
    <!-- ================================================================ -->
    <!--
      Two independent lines, each switchable, set sideways in the outer
      margin of every body page:

        draft note   free text the publisher types in Settings, e.g.
                     "This is a draft copy of issue 001-01. Printed ...".
        produced by  a fixed prefix plus the enterprise name taken from
                     pmStatus/responsiblePartnerCompany/enterpriseName, so it
                     follows the publication rather than being retyped.

      Off by default: a finished manual should carry neither unless its
      publisher asks for them.
    -->
    <xsl:param name="side.note.enabled">0</xsl:param>
    <xsl:param name="side.note.text"/>
    <xsl:param name="produced.by.enabled">0</xsl:param>
    <xsl:param name="produced.by.prefix">Produced by: </xsl:param>
    <!-- Geometry. The band is positioned from the TOP-LEFT of the page
         because FOP renders an absolutely positioned container placed that
         way and silently drops one anchored by bottom/right. -->
    <xsl:param name="side.note.font.size">8pt</xsl:param>
    <xsl:param name="side.note.margin">7mm</xsl:param>
    <xsl:param name="side.note.length">110mm</xsl:param>
    <xsl:param name="side.note.top">35mm</xsl:param>
    <!--
      Leave empty to have it computed: the line is placed so its foot clears
      the footer rule by $side.note.clearance. A fixed value cannot do that,
      because where the footer starts depends on the page height, the bottom
      margin and the footer's own extent, all three configurable — a default
      that sits nicely on A4 with a 16mm footer runs straight through the rule
      on anything else.
    -->
    <xsl:param name="produced.by.top"/>
    <xsl:param name="side.note.clearance">6mm</xsl:param>

    <!-- ================================================================ -->
    <!--  XIGNAL LAYOUT PROFILE  (see xignal-furniture.xsl)                  -->
    <!-- ================================================================ -->
    <!-- 'xignal' = the data-module-per-page furniture measured from the Xignal /
         Docuneering S1000D reference. Empty keeps the engine's own. -->
    <xsl:param name="layout.profile"/>
    <!--
      Does the PUBLICATION's classification print in the running head and foot of the prelim pages (title continuation, contents, lists)?
      The engine's own layout says yes: front matter belongs to no data module, and an unmarked page in a classified book is the page a reader
      checks first. The Xignal reference says no: on its 569 front-matter pages not one carries a marking, while every data module page carries its
      module's own class. The Xignal profile therefore follows the reference; 'yes' / 'no' (the stylesheet parameter prelim.classification) override either default. Body pages
      are not affected: they always print the class of their own module.
    -->
    <xsl:param name="prelim.classification"/>
    <xsl:variable name="prelim.classification.on"
      select="$prelim.classification = 'yes' or ($prelim.classification != 'no' and $layout.profile != 'xignal')"/>
    <!--
      The room reserved under the last line of every data module. The engine's own profiles keep 20mm, a margin that was put there so the end
      of a module never touches the footer. It has a cost under FOP: the padding belongs to the block that wraps the whole module, so the
      module's LAST paragraph has to fit with all 20mm below it, or the whole paragraph moves to a new page - even with plenty of room,
      a two-line paragraph at the end of a list was carried over alone. The Xignal reference does not reserve it: 20 of its 308 modules end
      their last page inside that zone (last lines at 107, 110, 112 pt where the zone would stop them at 154). The profile therefore has none.
    -->
    <xsl:variable name="dm.end.padding">
        <xsl:choose>
            <xsl:when test="$layout.profile = 'xignal'">0mm</xsl:when>
            <xsl:otherwise>20mm</xsl:otherwise>
        </xsl:choose>
    </xsl:variable>
    <!-- Sheet a &lt;foldout&gt; prints on: 'a4' (the engine's own A4 landscape,
         the default) or 'a3' (the Xignal reference puts every foldout on one A3
         landscape sheet followed by a blank A3 verso). -->
    <xsl:param name="foldout.sheet">a4</xsl:param>
    <!-- 'pmCode' prints the publication module's own code in the head. -->
    <xsl:param name="header.publication.source"/>
    <!-- Class-to-marking table "01=|02=RESTRICTED|03=RESTRICTED"; see the
         security template in headers_footers.xsl. -->
    <xsl:param name="classification.map"/>
    <!-- Header logo: header.logo.uri (a path relative to the project folder, empty = none) is declared once, in headers_footers.xsl, for both the
         default layout and the Xignal one; a second declaration here would be an error. Its height in the Xignal head: -->
    <xsl:param name="header.logo.height">41.6pt</xsl:param>
    <!-- On a verso the logo sits this far in from the start of its column. -->
    <xsl:param name="header.logo.even.offset">19pt</xsl:param>
    <!-- Head and foot bands are this tall (the rule sits at its far edge). -->
    <xsl:param name="xs.hf.height">19mm</xsl:param>
    <!-- Foot row pitch / paddings, in points, measured from the reference. -->
    <xsl:param name="xs.foot.row.a">16.1pt</xsl:param>
    <xsl:param name="xs.foot.row.b">18.8pt</xsl:param>
    <xsl:param name="xs.foot.pad.top">4.9pt</xsl:param>
    <xsl:param name="xs.rule.width">1.13pt</xsl:param>
    <xsl:param name="xs.applic.size">10pt</xsl:param>
    <!-- On an A3 landscape page the head and foot are the A4 portrait block
         pushed against the right-hand edge (inner margin on that side). -->
    <xsl:param name="xs.a3.left">200mm</xsl:param>
    <xsl:param name="xs.a3.right">10mm</xsl:param>
    <!-- Margin marks. Text is resolved per build (engine/brand.js); an empty
         text leaves that mark out. Geometry in points from the page edge:
         x = where the rotated line's baseline sits, measured from the left
         page edge on the recto and (mirrored by the same offsets) the verso. -->
    <xsl:param name="xs.mark.draft"/>
    <xsl:param name="xs.mark.printed"/>
    <xsl:param name="xs.mark.company"/>
    <xsl:param name="xs.mark.font.size">8pt</xsl:param>
    <xsl:param name="xs.mark.recto.draft.x">32.4</xsl:param>
    <xsl:param name="xs.mark.recto.printed.x">42.0</xsl:param>
    <xsl:param name="xs.mark.recto.company.x">55.1</xsl:param>
    <xsl:param name="xs.mark.verso.draft.x">556.8</xsl:param>
    <xsl:param name="xs.mark.verso.printed.x">566.4</xsl:param>
    <xsl:param name="xs.mark.verso.company.x">542.6</xsl:param>
    <!-- Vertical centre of the draft/printed pair, measured UP from the page
         bottom; the company line starts this far up from the bottom edge. -->
    <xsl:param name="xs.mark.center.y">422.4</xsl:param>
    <xsl:param name="xs.mark.company.y">96.4</xsl:param>
    <!-- baseline offset inside the rotated container (8 pt text), calibrated. -->
    <xsl:param name="xs.mark.baseline.offset">6.9</xsl:param>
    <!-- ================================================================ -->
    <!--  BODY STYLE KNOBS (defaults are what the engine has always done)     -->
    <!-- ================================================================ -->
    <!-- Alignment of running text: 'justify' (engine default) or 'start' (ragged right). -->
    <xsl:param name="body.text.align">justify</xsl:param>
    <!-- Module title (techName) and the centred section labels (infoName, "References", "Description"). -->
    <xsl:param name="centerhead1.padding.top">12pt</xsl:param>
    <xsl:param name="centerhead1.padding.bottom">8pt</xsl:param>
    <xsl:param name="centerhead2.padding.top">10pt</xsl:param>
    <!-- 'padding' keeps the top space at the head of a page; 'space' is a forced space-before that is dropped there -->
    <xsl:param name="centerhead2.top.space">padding</xsl:param>
    <xsl:param name="centerhead2.padding.bottom">6pt</xsl:param>
    <xsl:param name="centerhead2.font.style">normal</xsl:param>
    <!-- Space above "Table of contents" / "List of tables" / "List of figures". -->
    <xsl:param name="sidehead0.space.before">16pt</xsl:param>
    <!-- Per-module contents and lists. toc.flat=1: every level shares one number
         column and one title column, entries are set tight, links are not coloured;
         toc.extra.entries=1: the module's infoName and its References table are
         listed too (the References table is printed for every S1000D module). -->
    <xsl:param name="toc.flat">0</xsl:param>
    <xsl:param name="toc.extra.entries">0</xsl:param>
    <xsl:param name="toc.link.color">blue</xsl:param>
    <xsl:param name="toc.entry.left">17mm</xsl:param>
    <xsl:param name="toc.number.width">13.6mm</xsl:param>
    <xsl:param name="toc.entry.gap">2pt</xsl:param>
    <xsl:param name="toc.heading.page.shift">0pt</xsl:param>
    <!-- Space between a contents/list heading and its first entry. -->
    <xsl:param name="toc.list.gap">6pt</xsl:param>
    <!-- References table: 'boxed' (engine default) or 'rules' (horizontal rules only). -->
    <xsl:param name="refs.table.style">boxed</xsl:param>
    <xsl:param name="refs.header.doc">Chap No./Document No.</xsl:param>
    <xsl:param name="refs.cell.pad">3.5pt</xsl:param>
    <xsl:param name="refs.rule.color">black</xsl:param>
    <!-- 1 keeps the two-space gap in "Table 1  References" (FOP collapses plain spaces). -->
    <xsl:param name="caption.keep.double.space">0</xsl:param>
    <!-- Running paragraphs: space above (optimum / minimum / maximum). -->
    <xsl:param name="para.space.before">10pt</xsl:param>
    <xsl:param name="para.space.min">8pt</xsl:param>
    <xsl:param name="para.space.max">12pt</xsl:param>
    <!-- Space above a table block / a figure's picture (default: the standard leading). -->
    <xsl:param name="table.padding.top" select="$standard-leading"/>
    <!-- Padding inside every table cell, and the gap between a table's caption and the table. -->
    <xsl:param name="table.padding.bottom">0pt</xsl:param>
    <!-- 1 = the rows tied together by a row span are kept on one page -->
    <xsl:param name="table.rowspan.group.keep">0</xsl:param>
    <!-- 1 = a table without a title still gets "Table N" and a List of tables line; 0 = it gets neither and is not counted -->
    <xsl:param name="table.untitled.numbered">1</xsl:param>
    <!-- how the space above a table or references block is made: 'padding' (kept at a page top) or 'space' (dropped there) -->
    <xsl:param name="table.top.space">padding</xsl:param>
    <xsl:param name="table.cell.padding">1.5mm</xsl:param>
    <!-- 1 repeats the table's caption, with the text below, above the repeated header on every later page. -->
    <xsl:param name="table.continued.caption">0</xsl:param>
    <xsl:param name="table.continued.text">(Continued)</xsl:param>
    <!-- The fixed height of that caption row: the caption's line plus the gap under it (see table-caption-row). -->
    <xsl:param name="table.continued.row.height">16pt</xsl:param>
    <!-- How a randomList's listItemPrefix codes are drawn: 'engine' (the engine's own) or 'xignal'. -->
    <xsl:param name="list.prefix.style">engine</xsl:param>
    <!-- Space above a paragraph inside a list item (optimum / minimum / maximum), and above a random list as a block. -->
    <xsl:param name="list.para.space.before">10pt</xsl:param>
    <xsl:param name="list.para.space.min">8pt</xsl:param>
    <xsl:param name="list.para.space.max">12pt</xsl:param>
    <xsl:param name="list.block.space.before">0pt</xsl:param>
    <xsl:param name="list.nested.pad.bottom">0pt</xsl:param>
    <xsl:param name="list.cell.pad.top">0pt</xsl:param>
    <xsl:param name="list.cell.pad.bottom">0pt</xsl:param>
    <xsl:param name="table.caption.space.after">6pt</xsl:param>
    <!-- The References block: space above its caption, under its caption, and after the table. -->
    <!-- 1 lists every dmRef/pmRef found anywhere in a module when it has no refs element (engine default);
         0 lists only what the module's own refs element names, and "None" otherwise. -->
    <xsl:param name="refs.scan.body">1</xsl:param>
    <!-- 1 lists a procedure's step titles in its contents (engine default); 0 lists only its sections. -->
    <xsl:param name="toc.include.steps">1</xsl:param>
    <!-- 1 = the References caption is kept with its table (and the sub-heading above it) -->
    <xsl:param name="refs.caption.keep">0</xsl:param>
    <xsl:param name="refs.padding.top" select="$standard-leading"/>
    <xsl:param name="refs.caption.space.after">6pt</xsl:param>
    <xsl:param name="refs.space.after">0pt</xsl:param>
    <xsl:param name="figure.padding.top" select="$standard-leading"/>
    <!-- 'always' keeps every table row whole (engine default); 'auto' lets a row-spanned group split over a page. -->
    <xsl:param name="table.row.keep">always</xsl:param>
    <!-- Likewise for a row that starts a row span ('always' is the engine's own behaviour). -->
    <xsl:param name="table.rowspan.keep">always</xsl:param>
    <!-- 1 keeps a table's caption with the table that follows it (no caption stranded at a page foot). -->
    <xsl:param name="table.caption.keep">0</xsl:param>
    <!-- Space after the contents block and the lists; and above the "Table of contents" heading itself. -->
    <xsl:param name="toc.space.after">16pt</xsl:param>
    <xsl:param name="toc.heading.space.before" select="$sidehead0.space.before"/>
    <xsl:param name="end.of.dm.text">End of data module</xsl:param>
    <!-- No longer read: the line moved back into the running foot (below the
         classification, headers_footers.xsl), which has no space-before of
         its own to set — a table row is either empty or isn't. Left declared
         rather than removed, so a build still passing it as a stringparam is
         ignored rather than broken. -->
    <xsl:param name="end.of.dm.space.before">8mm</xsl:param>
    <xsl:param name="classification.padding.top">0pt</xsl:param>
    <xsl:param name="classification.padding.bottom">0pt</xsl:param>
    <xsl:param name="classification.padding.left">0pt</xsl:param>
    <xsl:param name="classification.padding.right">0pt</xsl:param>

    <!-- Front-matter first-aid artwork (see jsstofo.xsl). -->
    <!-- Per-page heading overrides from Settings; empty = use the stencil wording. -->
    <xsl:param name="fm.title.recordOfChanges"/>
    <xsl:param name="fm.title.associatedHandbooks"/>
    <xsl:param name="fm.title.firstAid"/>
    <xsl:param name="fm.title.changeNotice"/>
    <xsl:param name="fm.title.listOfAbbreviations"/>
    <xsl:param name="fm.title.descriptionOfSymbols"/>
    <xsl:param name="fm.title.foreword"/>
    <xsl:param name="fm.title.demolition"/>
    <xsl:param name="fm.title.listOfContents"/>
    <xsl:param name="fm.title.listOfFigures"/>
    <xsl:param name="fm.title.listOfTables"/>
    <!--
      Overrides for the fixed wording inside the front-matter pages —
      column headings, captions, the run-in sentences. Empty means "use
      the stencil wording", so a project that sets none is unchanged.
    -->
    <xsl:param name="fm.label.abbrev.colMeaning"/>
    <xsl:param name="fm.label.abbrev.colTerm"/>
    <xsl:param name="fm.label.cautions.heading"/>
    <xsl:param name="fm.label.change.colCode"/>
    <xsl:param name="fm.label.change.colNoticeNo"/>
    <xsl:param name="fm.label.change.colPrevious"/>
    <xsl:param name="fm.label.change.colTitle"/>
    <xsl:param name="fm.label.foreword.documentNo"/>
    <xsl:param name="fm.label.handbooks.colInbr"/>
    <xsl:param name="fm.label.handbooks.colSr"/>
    <xsl:param name="fm.label.handbooks.colTitle"/>
    <xsl:param name="fm.label.handbooks.introAfter"/>
    <xsl:param name="fm.label.handbooks.introBefore"/>
    <xsl:param name="fm.label.proprietary.heading"/>
    <xsl:param name="fm.label.roc.colAuthority"/>
    <xsl:param name="fm.label.roc.colChangeNotice"/>
    <xsl:param name="fm.label.roc.colIncorporatedBy"/>
    <xsl:param name="fm.label.roc.colInitials"/>
    <xsl:param name="fm.label.safety.footer"/>
    <xsl:param name="fm.label.safety.heading"/>
    <xsl:param name="fm.label.title.blankPage"/>
    <xsl:param name="fm.label.title.for"/>
    <xsl:param name="fm.label.title.inbrNo"/>
    <xsl:param name="fm.label.title.publishedBy"/>
    <xsl:param name="fm.label.titleJoint.contractNo"/>
    <xsl:param name="fm.label.titleJoint.nsn"/>
    <xsl:param name="fm.label.titleJoint.publicationNo"/>
    <xsl:param name="fm.label.titleJoint.publishedBy"/>

    <xsl:param name="firstaid.image"/>
    <xsl:param name="firstaid.image.width">58mm</xsl:param>
    <xsl:param name="firstaid.image.height">215mm</xsl:param>
    <!-- Chapter title, and the two front-matter title sizes. -->
    <xsl:param name="heading1-size">16pt</xsl:param>
    <xsl:param name="heading2-size">12pt</xsl:param>
    <xsl:param name="heading3-size">11pt</xsl:param>

    <!-- Body headings, levels 1-4. spaceBefore/After become padding, indent
         becomes start-indent, uppercase folds the title text. -->
    <xsl:param name="heading.1.size">12pt</xsl:param>
    <xsl:param name="heading.1.spaceBefore">5mm</xsl:param>
    <xsl:param name="heading.1.spaceAfter">2mm</xsl:param>
    <xsl:param name="heading.1.indent">0mm</xsl:param>
    <xsl:param name="heading.1.uppercase">1</xsl:param>
    <xsl:param name="heading.2.size">11pt</xsl:param>
    <xsl:param name="heading.2.spaceBefore">5mm</xsl:param>
    <xsl:param name="heading.2.spaceAfter">2mm</xsl:param>
    <xsl:param name="heading.2.indent">15mm</xsl:param>
    <xsl:param name="heading.2.uppercase">0</xsl:param>
    <xsl:param name="heading.3.size">11pt</xsl:param>
    <xsl:param name="heading.3.spaceBefore">5mm</xsl:param>
    <xsl:param name="heading.3.spaceAfter">2mm</xsl:param>
    <xsl:param name="heading.3.indent">15mm</xsl:param>
    <xsl:param name="heading.3.uppercase">0</xsl:param>
    <xsl:param name="heading.4.size">11pt</xsl:param>
    <xsl:param name="heading.4.spaceBefore">5mm</xsl:param>
    <xsl:param name="heading.4.spaceAfter">2mm</xsl:param>
    <xsl:param name="heading.4.indent">15mm</xsl:param>
    <xsl:param name="heading.4.uppercase">0</xsl:param>
    <!--
      bodyIndent is accepted but not applied. In jsstofo a heading is a
      hanging-indent list-block, so the title and the paragraphs beneath it
      share one derived indent; headings here are plain blocks with no such
      column. Declaring it keeps the build from filtering it and makes the
      omission explicit rather than looking like an oversight.
    -->
    <xsl:param name="heading.1.bodyIndent"/>
    <xsl:param name="heading.2.bodyIndent"/>
    <xsl:param name="heading.3.bodyIndent"/>
    <xsl:param name="heading.4.bodyIndent"/>

    <!-- Lists (Settings > Lists). Bare mm numbers; units added at use. -->
    <xsl:param name="list.gap.alpha">8</xsl:param>
    <xsl:param name="list.gap.roman">10</xsl:param>
    <xsl:param name="list.gap.bullet">5</xsl:param>
    <xsl:param name="list.item.space">1.5</xsl:param>
    <xsl:param name="list.indent">0</xsl:param>

    <!-- Figure size caps, in mm, by effective orientation. -->
    <!-- Height an icon-style <symbol> renders at. Symbols are hazard/notice
         icons, not figures, so they get their own small size rather than the
         page-sized figure caps below. -->
    <xsl:param name="symbol.size">10mm</xsl:param>
    <xsl:param name="graphic.cap.portrait.w">167</xsl:param>
    <xsl:param name="graphic.cap.portrait.h">235</xsl:param>
    <!--
      The system-illustration page's own picture bounds, separate from the
      figure caps: that page is given over to the illustration, so it usually
      wants to be larger than a picture sitting in the text. Defaults to the
      figure caps, so a project that sets neither is unchanged.
    -->
    <xsl:param name="systemimage.max.width"><xsl:value-of select="concat($graphic.cap.portrait.w, 'mm')"/></xsl:param>
    <xsl:param name="systemimage.max.height"><xsl:value-of select="concat($graphic.cap.portrait.h, 'mm')"/></xsl:param>

    <xsl:param name="graphic.cap.landscape.w">254</xsl:param>
    <xsl:param name="graphic.cap.landscape.h">148</xsl:param>
    <xsl:param name="graphic.cap.a3landscape.w">377</xsl:param>
    <xsl:param name="graphic.cap.a3landscape.h">235</xsl:param>
    <!-- ==================================================================== -->
    <!--                         CONTENT PARAMETERS                            -->
    <!-- ==================================================================== -->
    <!-- When set, adds the "Printed $date.time" statement to the left margin. -->
    <xsl:param name="date.time"/>
    <!-- Document format: S1000D or JSS -->
    <xsl:param name="document.format">S1000D</xsl:param>
    <!-- Security classification override: empty = use from XML, '01'=Unclassified, '02'=Restricted,
         '03'=Confidential, '04'=Secret, '05'=Top Secret, or any custom label (e.g. 'Demo') -->
    <xsl:param name="security.classification"/>
    <!-- How the server-produced watermark tiles (the image URI itself is
         declared with the other content parameters below). -->
    <xsl:param name="watermark.repeat">no-repeat</xsl:param>
    <!-- Release the document is on, e.g. "Release 2"; empty when unreleased. -->
    <xsl:param name="release.label"/>
    <!-- Show unimplemented markup in red for debugging -->
    <xsl:param name="show.unimplemented.markup">0</xsl:param>
    <!-- Whether to show the default heading based on the DM schema -->
    <xsl:param name="show.schema.heading">1</xsl:param>
    <!-- Hide empty preliminary requirements tables -->
    <xsl:param name="hide.empty.proced.rqmts">0</xsl:param>
    <!-- Hide the References table if there are no references -->
    <xsl:param name="hide.empty.refs.table">0</xsl:param>
    <!-- Show the ICN on graphics -->
    <xsl:param name="show.graphic.icn">1</xsl:param>
    <!-- The ICN line under a picture: its size and alignment, and the space above a figure's caption. -->
    <xsl:param name="graphic.icn.size">8pt</xsl:param>
    <xsl:param name="graphic.icn.align">center</xsl:param>
    <xsl:param name="graphic.icn.a3.end.indent">0pt</xsl:param>
    <xsl:param name="figure.caption.space.before">2mm</xsl:param>
    <xsl:param name="figure.caption.space.after">2mm</xsl:param>
    <xsl:param name="figure.space.before">0pt</xsl:param>
    <!-- the word an in-text reference to a figure opens with ("Figure 3"; some house styles print "Fig 3") -->
    <xsl:param name="xref.figure.label">Figure</xsl:param>
    <!-- 1 = size a picture from the resolution its file declares (PNG pHYs / JFIF); 0 = always 96 dpi -->
    <xsl:param name="graphic.use.dpi">0</xsl:param>
    <!--
      Double-sided printing discipline. When 1, every data module ends on an
      even page so the next always starts on a right-hand page, and any page
      FOP inserts to achieve that carries the "intentionally left blank"
      legend. Set to 0 for single-sided output with no filler pages.
      Mirrors the JSS pipeline's parameter of the same name.
    -->
    <xsl:param name="blank.versos">1</xsl:param>

    <!-- ==================================================================== -->
    <!--                       GRAPHICS / FIGURES                              -->
    <!-- ==================================================================== -->
    <!-- Largest area a figure may occupy. An image with no explicit
         reproduction size is fitted inside this box at its true aspect ratio,
         so it is never stretched to the text width nor allowed to run past the
         bottom of the page. -->
    <xsl:param name="graphic.max.width">167mm</xsl:param>
    <xsl:param name="graphic.max.height">180mm</xsl:param>
    <!-- Columns in a figure's callout key. -->
    <xsl:param name="figure.legend.cols">2</xsl:param>
    <!-- How many nested section levels the contents page lists under each data
         module. Deeper levels still render in the body, they are just not
         itemised in the contents. -->
    <!--
      How many levels below the chapter the contents lists: 1 for topics only
      (1.1), 2 to add their sections (1.1.1). Counted identically by the JSS
      engine, so the one Settings control means the same thing in both.
    -->
    <xsl:param name="toc.section.depth">1</xsl:param>
    <!--
      Contents layout. Entries sit $toc.entry.indent from the margin, and each
      further level steps in by exactly one $toc.label.width — the fixed column
      the entry number is set in. Stepping by the column width is what puts a
      nested number square under its parent's title:

          1.1     Introduction to the Equipment
                  1.1.1   Introduction to the Equipment

      Widen toc.label.width if a publication numbers deeply enough for a label
      to reach the title beside it.
    -->
    <xsl:param name="toc.entry.indent">6mm</xsl:param>
    <xsl:param name="toc.label.width">14mm</xsl:param>
    <!-- Font size inside tables and the callout key. -->
    <xsl:param name="table-font-size">9pt</xsl:param>
    <!-- Where graphics live when a data module declares no ICN entity, and the
         extension to assume — mirrors the JSS pipeline's fallback. -->
    <xsl:param name="graphics.dir">Media/</xsl:param>
    <xsl:param name="graphics.ext">.png</xsl:param>
    <!--
      Side-car index of real image pixel sizes, written per build by
      engine/imageDims.js. XSLT 1.0 cannot measure an image, and the author's
      data modules must not be modified to carry the numbers (unlike the JSS
      pipeline, which can stamp them onto its generated book), so the sizes
      arrive alongside instead. An absent file simply means every graphic falls
      back to scale-down-to-fit.
    -->
    <xsl:param name="image.dims.file">_image-dims.xml</xsl:param>
    <!-- Second argument is the source tree: document() otherwise resolves the
         href against the STYLESHEET's location (pipeline/s1000dtofo/), not the
         project directory the index actually sits in. -->
    <xsl:variable name="image.dims" select="document($image.dims.file, /)/imageDims"/>
    <!-- Case-folding pairs for the filename lookup (index keys are lowercased). -->
    <xsl:variable name="upper.abc">ABCDEFGHIJKLMNOPQRSTUVWXYZ</xsl:variable>
    <xsl:variable name="lower.abc">abcdefghijklmnopqrstuvwxyz</xsl:variable>
    <!-- Include the "Part No." prefix on identNumber -->
    <xsl:param name="part.no.prefix">1</xsl:param>
    <!-- Width of the term column in a definition list -->
    <xsl:param name="definition.list.term.width">50mm</xsl:param>
    <!-- Watermark SVG file URI: empty = no watermark. Generated by the server
         (engine/watermark.js) from the project's release state and watermark
         settings, and applied as a region-body background — see
         pagesetup.xsl's watermark-bg-attrs. -->
    <xsl:param name="watermark.image.uri"></xsl:param>
    <!-- Applicability display settings -->
    <xsl:param name="applic.prefix">Applicable to: </xsl:param>
    <xsl:param name="highlight.applic">0</xsl:param>
    <!-- Change bar settings -->
    <xsl:param name="change.bar.width">2pt</xsl:param>
    <xsl:param name="change.bar.color">black</xsl:param>
    <xsl:param name="change.bar.style">solid</xsl:param>
    <!-- Warning/caution box display -->
    <xsl:param name="warning-caution-boxes" select="false()"/>
    <!-- ================================================================ -->
    <!--  NOTICE STYLE  (warnings, cautions and notes)                      -->
    <!-- ================================================================ -->
    <!--
      Which of four looks a notice takes. Purely presentational — the same
      source renders as any of them, so a publication can follow whichever
      house style its customer expects:

        classic  centred underlined label, body indented either side.
                 What this engine has always produced; the default, so no
                 existing book changes appearance without being asked.
        jss      the coloured title band with a boxed "!" and a rule under
                 the text, matching the JSS engine's stencil.
        boxed    a ruled box with the label in its own smaller box at the
                 top, label and rules in the notice's colour.
        hazard   a diagonal hazard-stripe frame (yellow/black for CAUTION,
                 red/white for WARNING) around centred text on white, the
                 industrial "hazard tape" look — see the notice template
                 in warnings.xsl for how the frame itself is built.
    -->
    <xsl:param name="notice.style">classic</xsl:param>
    <!-- How a NOTE is set: 'notice' (framed like a warning, the engine's own) or 'label' ("Note N" over indented text). -->
    <xsl:param name="note.style">notice</xsl:param>
    <xsl:param name="note.space.before">8.5pt</xsl:param>
    <xsl:param name="note.pad.bottom">0pt</xsl:param>
    <xsl:param name="note.text.indent">8mm</xsl:param>
    <xsl:param name="notice.warning.color">#EE0000</xsl:param>
    <xsl:param name="notice.caution.color">#EE0000</xsl:param>
    <xsl:param name="notice.note.color">#8DB4D8</xsl:param>
    <!--
      The hazard-stripe tile images the 'hazard' notice style frames itself
      with. Empty by default and injected at build time (see build.js,
      alongside blank.page.svg) with the real path next to this stylesheet
      — a packaged build's project directory has no fixed relationship to
      the app's own files, so the path can't be a literal here.
    -->
    <xsl:param name="notice.hazard.caution.image"/>
    <xsl:param name="notice.hazard.warning.image"/>
    <!--
      The 'band' notice style (the Xignal reference's frame): a wide diagonal-striped band with a white box inset in it. Tile images are
      injected at build time like the hazard ones. Sizes are in points, as measured on the reference: the band's outline 0.7, the stripe
      margin around the box 14.17 (5 mm), the box's own border 1.4 and padding 11.34 (4 mm), the gap between its label and its text 8.5.
    -->
    <xsl:param name="notice.band.caution.image"/>
    <xsl:param name="notice.band.warning.image"/>
    <xsl:param name="notice.band.outline.width">0.7</xsl:param>
    <xsl:param name="notice.band.outline.color">#BFBFBF</xsl:param>
    <xsl:param name="notice.band.pad">14.17</xsl:param>
    <xsl:param name="notice.box.border.width">1.4</xsl:param>
    <xsl:param name="notice.box.pad">11.34</xsl:param>
    <xsl:param name="notice.box.label.gap">8.5</xsl:param>
    <xsl:param name="notice.band.space.before">11.3pt</xsl:param>
    <xsl:param name="notice.band.space.after">7.5pt</xsl:param>
    <!--
      How the TEXT of a notice is set, independent of which frame is around
      it. Both default on, because the convention this engine is built for
      sets hazard text in bold capitals so it cannot be skimmed past.

      Capitals are done with text-transform rather than by translating the
      string, so inline markup inside the notice — an emphasis, a cross
      reference, a part number — survives intact. Settable because it is a
      house decision, not a fact: long notices in capitals are markedly
      harder to read, and a customer whose style guide says sentence case
      should not have to edit a stylesheet to get it.
    -->
    <xsl:param name="notice.text.caps">1</xsl:param>
    <xsl:param name="notice.text.bold">1</xsl:param>
    <!-- ==================================================================== -->
    <!--                         COMMON VARIABLES                              -->
    <!-- ==================================================================== -->
    <xsl:variable name="lower">abcdefghijklmnopqrstuvwxyz</xsl:variable>
    <xsl:variable name="upper">ABCDEFGHIJKLMNOPQRSTUVWXYZ</xsl:variable>
    <xsl:variable name="number">0123456789.</xsl:variable>
    <xsl:variable name="all.dmodules" select="//dmodule"/>
    <!-- JSS alphanumeric sequence (excluding i, o, v) -->
    <xsl:variable name="jss.alpha.lower">abcdefghjklmnpqrstuwxyz</xsl:variable>
    <xsl:variable name="jss.alpha.upper">ABCDEFGHJKLMNPQRSTUWXYZ</xsl:variable>
    <!-- ==================================================================== -->
    <!--                         INCLUDE MODULES                               -->
    <!-- ==================================================================== -->
    <!-- Page layout and masters -->
    <xsl:include href="pagesetup.xsl"/>
    <!-- Headers and footers -->
    <xsl:include href="headers_footers.xsl"/>
    <!-- Xignal-profile head, foot and margin marks -->
    <xsl:include href="xignal-furniture.xsl"/>
    <!-- Xignal cover: the title-page data module printed as page 1 -->
    <xsl:include href="xignal-cover.xsl"/>
    <!-- Xignal divider page: a data module with no content prints as a title-only page -->
    <xsl:include href="xignal-divider.xsl"/>
    <!-- Common templates (paragraphs, inline elements, etc.) -->
    <xsl:include href="common.xsl"/>
    <!-- Table handling -->
    <xsl:include href="tables.xsl"/>
    <!-- Figure and graphic handling -->
    <xsl:include href="figures.xsl"/>
    <!-- List handling (random, sequential, definition) -->
    <xsl:include href="lists.xsl"/>
    <!-- Table of contents, list of figures, list of tables -->
    <xsl:include href="toc.xsl"/>
    <!-- Preliminary requirements tables -->
    <xsl:include href="requirements.xsl"/>
    <!-- Descriptive data module processing -->
    <xsl:include href="descript.xsl"/>
    <!-- AGASTYA addition: print view of the non-narrative data module types (shared with the JSS engine) -->
    <xsl:include href="../support-view.xsl"/>
    <!-- Procedural data module processing -->
    <xsl:include href="proced.xsl"/>
    <!-- Fault isolation processing -->
    <xsl:include href="fault.xsl"/>
    <!-- Illustrated Parts Data (IPD) processing -->
    <xsl:include href="ipd.xsl"/>
    <!-- Crew/Operator data module processing -->
    <xsl:include href="crew.xsl"/>
    <!-- Front matter and identification -->
    <xsl:include href="frontmatter.xsl"/>
    <!-- Settings-driven front matter, shared with the JSS pipeline. -->
    <xsl:include href="frontmatter-shared.xsl"/>
    <xsl:include href="frontmatter-s1000d.xsl"/>
    <!-- References and cross-references -->
    <xsl:include href="refs.xsl"/>
    <!-- Warnings and cautions -->
    <xsl:include href="warnings.xsl"/>
    <!-- ==================================================================== -->
    <!--                    ADDITIONAL PARAMETERS                              -->
    <!-- ==================================================================== -->
    <!-- Fonts -->
    <xsl:param name="monospace-font">Courier</xsl:param>
    <xsl:param name="footnote-size">8pt</xsl:param>
    <!-- Colors -->
    <xsl:param name="color-link">#0000FF</xsl:param>
    <xsl:param name="color-warning">#CC0000</xsl:param>
    <xsl:param name="color-caution">#FF9900</xsl:param>
    <xsl:param name="color-danger">#990000</xsl:param>
    <xsl:param name="color-note">#006600</xsl:param>
    <xsl:param name="color-blue">#0066CC</xsl:param>
    <xsl:param name="color-green">#006600</xsl:param>
    <xsl:param name="color-red">#CC0000</xsl:param>
    <!-- Background colors -->
    <xsl:param name="table-header-bg">#E0E0E0</xsl:param>
    <xsl:param name="warning-bg">#FFF0F0</xsl:param>
    <xsl:param name="caution-bg">#FFFCE0</xsl:param>
    <xsl:param name="danger-bg">#FFE0E0</xsl:param>
    <xsl:param name="note-bg">#F0FFF0</xsl:param>
    <!-- Symbol URLs -->
    <xsl:param name="warning.symbol.url"/>
    <xsl:param name="caution.symbol.url"/>
    <xsl:param name="logo.url"/>
    <!--
      Path to intentionally-blank.svg, used as a page background in
      pagesetup.xsl. Defaulted to the dev-checkout layout; a packaged build's
      project directory has no fixed number of ".." steps back to the app's
      own files, so the build passes the real relative path in instead.
    -->
    <xsl:param name="blank.page.svg">../../../server/pipeline/s1000dtofo/intentionally-blank.svg</xsl:param>
    <!-- The legend actually used: the Xignal profile's own ("Intentionally left blank.", measured on the reference) when that profile is on. -->
    <xsl:variable name="blank.page.bg">
        <xsl:choose>
            <xsl:when test="$layout.profile = 'xignal' and contains($blank.page.svg, 'intentionally-blank.svg')">
                <xsl:value-of select="concat(substring-before($blank.page.svg, 'intentionally-blank.svg'), 'intentionally-blank-xignal.svg')"/>
            </xsl:when>
            <xsl:otherwise><xsl:value-of select="$blank.page.svg"/></xsl:otherwise>
        </xsl:choose>
    </xsl:variable>
    <!-- Content generation options -->
    <xsl:param name="generate.toc">1</xsl:param>
    <xsl:param name="generate.lof">1</xsl:param>
    <xsl:param name="generate.lot">1</xsl:param>
    <xsl:param name="generate.title.page">0</xsl:param>
    <xsl:param name="generate.copyright.page">0</xsl:param>
    <xsl:param name="generate.record.of.revisions">0</xsl:param>
    <xsl:param name="show.dm.status">0</xsl:param>
    <!-- Reference display -->
    <xsl:param name="dmref.show.title">1</xsl:param>
    <xsl:param name="pmref.show.title">1</xsl:param>
    <!-- ==================================================================== -->
    <!--                    ATTRIBUTE SETS                                     -->
    <!-- ==================================================================== -->
    <xsl:attribute-set name="centerhead1">
        <xsl:attribute name="font-size"><xsl:value-of select="$heading1-size"/></xsl:attribute>
        <xsl:attribute name="font-weight">bold</xsl:attribute>
        <xsl:attribute name="text-align">center</xsl:attribute>
        <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
        <xsl:attribute name="padding-top"><xsl:value-of select="$centerhead1.padding.top"/></xsl:attribute>
        <xsl:attribute name="padding-bottom"><xsl:value-of select="$centerhead1.padding.bottom"/></xsl:attribute>
    </xsl:attribute-set>
    <xsl:attribute-set name="centerhead2">
        <xsl:attribute name="font-size"><xsl:value-of select="$heading2-size"/></xsl:attribute>
        <xsl:attribute name="font-weight">bold</xsl:attribute>
        <xsl:attribute name="font-style"><xsl:value-of select="$centerhead2.font.style"/></xsl:attribute>
        <xsl:attribute name="text-align">center</xsl:attribute>
        <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
        <xsl:attribute name="padding-top">
            <xsl:choose>
                <xsl:when test="$centerhead2.top.space = 'space'">0pt</xsl:when>
                <xsl:otherwise><xsl:value-of select="$centerhead2.padding.top"/></xsl:otherwise>
            </xsl:choose>
        </xsl:attribute>
        <xsl:attribute name="space-before">
            <xsl:choose>
                <xsl:when test="$centerhead2.top.space = 'space'"><xsl:value-of select="$centerhead2.padding.top"/></xsl:when>
                <xsl:otherwise>0pt</xsl:otherwise>
            </xsl:choose>
        </xsl:attribute>
        <xsl:attribute name="space-before.precedence">force</xsl:attribute>
        <xsl:attribute name="padding-bottom"><xsl:value-of select="$centerhead2.padding.bottom"/></xsl:attribute>
    </xsl:attribute-set>
    <xsl:attribute-set name="centerhead3">
        <xsl:attribute name="font-size"><xsl:value-of select="$heading3-size"/></xsl:attribute>
        <xsl:attribute name="font-weight">bold</xsl:attribute>
        <xsl:attribute name="text-align">center</xsl:attribute>
        <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
        <xsl:attribute name="padding-top">8pt</xsl:attribute>
        <xsl:attribute name="padding-bottom">4pt</xsl:attribute>
    </xsl:attribute-set>
    <!--
      SIDEHEADS: the numbered headings in the body.

      The space above a heading is space-before, not padding-top. Padding is
      part of the block's own area and is painted wherever the block lands, so
      a heading carried over to a new page arrived with 5mm of its previous
      page's breathing room printed above it — sitting visibly lower than the
      body text on any other page, for no reason a reader could see. Space is
      conditional and is discarded at a page break, which is exactly the
      behaviour a heading wants: separation from what came before, and nothing
      at all when nothing came before.

      Minimum and maximum are pinned to the same value so the space cannot be
      stretched or squeezed to fill a page; only the page-break discard is
      wanted here, not elastic spacing.
    -->
    <xsl:attribute-set name="sidehead1">
        <xsl:attribute name="font-size"><xsl:value-of select="$heading.1.size"/></xsl:attribute>
        <xsl:attribute name="font-weight">bold</xsl:attribute>
        <xsl:attribute name="start-indent"><xsl:value-of select="$heading.1.indent"/></xsl:attribute>
        <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
        <!-- space-before, not padding-top: padding is PAINTED at a page
             break and pushed the heading down the page, while space is
             discarded there. See the note above the attribute sets. -->
        <xsl:attribute name="space-before.minimum"><xsl:value-of select="$heading.1.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.optimum"><xsl:value-of select="$heading.1.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.maximum"><xsl:value-of select="$heading.1.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.conditionality">discard</xsl:attribute>
        <xsl:attribute name="padding-bottom"><xsl:value-of select="$heading.1.spaceAfter"/></xsl:attribute>
    </xsl:attribute-set>
    <xsl:attribute-set name="sidehead2">
        <xsl:attribute name="font-size"><xsl:value-of select="$heading.2.size"/></xsl:attribute>
        <xsl:attribute name="font-weight">bold</xsl:attribute>
        <xsl:attribute name="start-indent"><xsl:value-of select="$heading.2.indent"/></xsl:attribute>
        <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
        <!-- space-before, not padding-top: padding is PAINTED at a page
             break and pushed the heading down the page, while space is
             discarded there. See the note above the attribute sets. -->
        <xsl:attribute name="space-before.minimum"><xsl:value-of select="$heading.2.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.optimum"><xsl:value-of select="$heading.2.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.maximum"><xsl:value-of select="$heading.2.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.conditionality">discard</xsl:attribute>
        <xsl:attribute name="padding-bottom"><xsl:value-of select="$heading.2.spaceAfter"/></xsl:attribute>
    </xsl:attribute-set>
    <xsl:attribute-set name="sidehead3">
        <xsl:attribute name="font-size"><xsl:value-of select="$heading.3.size"/></xsl:attribute>
        <xsl:attribute name="font-weight">bold</xsl:attribute>
        <xsl:attribute name="start-indent"><xsl:value-of select="$heading.3.indent"/></xsl:attribute>
        <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
        <!-- space-before, not padding-top: padding is PAINTED at a page
             break and pushed the heading down the page, while space is
             discarded there. See the note above the attribute sets. -->
        <xsl:attribute name="space-before.minimum"><xsl:value-of select="$heading.3.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.optimum"><xsl:value-of select="$heading.3.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.maximum"><xsl:value-of select="$heading.3.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.conditionality">discard</xsl:attribute>
        <xsl:attribute name="padding-bottom"><xsl:value-of select="$heading.3.spaceAfter"/></xsl:attribute>
    </xsl:attribute-set>
    <xsl:attribute-set name="sidehead4">
        <xsl:attribute name="font-size"><xsl:value-of select="$heading.4.size"/></xsl:attribute>
        <xsl:attribute name="font-weight">bold</xsl:attribute>
        <xsl:attribute name="start-indent"><xsl:value-of select="$heading.4.indent"/></xsl:attribute>
        <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
        <!-- space-before, not padding-top: padding is PAINTED at a page
             break and pushed the heading down the page, while space is
             discarded there. See the note above the attribute sets. -->
        <xsl:attribute name="space-before.minimum"><xsl:value-of select="$heading.4.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.optimum"><xsl:value-of select="$heading.4.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.maximum"><xsl:value-of select="$heading.4.spaceBefore"/></xsl:attribute>
        <xsl:attribute name="space-before.conditionality">discard</xsl:attribute>
        <xsl:attribute name="padding-bottom"><xsl:value-of select="$heading.4.spaceAfter"/></xsl:attribute>
    </xsl:attribute-set>
    <xsl:attribute-set name="sidehead5">
        <xsl:attribute name="font-size">10pt</xsl:attribute>
        <xsl:attribute name="font-weight">bold</xsl:attribute>
        <xsl:attribute name="font-style">italic</xsl:attribute>
        <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
        <xsl:attribute name="space-before.minimum">4pt</xsl:attribute>
        <xsl:attribute name="space-before.optimum">4pt</xsl:attribute>
        <xsl:attribute name="space-before.maximum">4pt</xsl:attribute>
        <xsl:attribute name="space-before.conditionality">discard</xsl:attribute>
        <xsl:attribute name="padding-bottom">2pt</xsl:attribute>
    </xsl:attribute-set>
    <xsl:attribute-set name="table-cell">
        <xsl:attribute name="padding">2mm</xsl:attribute>
        <xsl:attribute name="border">0.5pt solid black</xsl:attribute>
    </xsl:attribute-set>
    <!-- ==================================================================== -->
    <!--                         ROOT TEMPLATE                                 -->
    <!-- ==================================================================== -->
    <xsl:template match="/">
        <fo:root>
            <!-- Page layout master set -->
            <xsl:call-template name="layout-master-set"/>
            <!-- PDF navigation pane. Must sit between the layout-master-set
                 and the first page-sequence: fo:root's content model is
                 (layout-master-set, declarations?, bookmark-tree?,
                 page-sequence+), so anywhere else is a validation error. -->
            <xsl:call-template name="bookmark-tree"/>
            <!-- Process the document content -->
            <xsl:apply-templates select="*|processing-instruction('page-break')"/>
        </fo:root>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    PUBLICATION MODULE HANDLING                        -->
    <!-- ==================================================================== -->
    <xsl:template match="publication">
        <xsl:choose>
            <xsl:when test="pm">
                <xsl:apply-templates select="pm"/>
            </xsl:when>
            <xsl:otherwise>
                <xsl:apply-templates select="dmodule"/>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>
    <xsl:template match="pm">
        <!--
          Settings-driven front matter, rendered by the same templates the JSS
          pipeline uses (see frontmatter-shared.xsl). The build injects a
          <bookmeta> block and a <frontmatter> block into the publication
          module when this pipeline is selected; with neither present this is a
          no-op and the book starts at its first chapter exactly as before.
        -->
        <xsl:choose>
            <!--
              The S1000D-default prelims: title page, table of contents, list
              of illustrations, list of abbreviations. Built from the
              publication module itself, so they need no injected front matter
              and appear whether or not the JSS blocks are present.
            -->
            <xsl:when test="$frontmatter.style = 's1000d'">
                <xsl:call-template name="s1000d-frontmatter"/>
            </xsl:when>
            <xsl:when test="frontmatter">
                <xsl:apply-templates select="frontmatter/titlePageJoint | frontmatter/titlePage"/>
                <xsl:call-template name="frontmatter-prelims"/>
            </xsl:when>
        </xsl:choose>
        <xsl:apply-templates select="content/pmEntry"/>
    </xsl:template>

    <!-- Injected metadata is data for the front matter, not content to render. -->
    <xsl:template match="pm/bookmeta"/>
    <!--
      pm as a pmEntry's child is a pmRef, resolved (see resolvePmRefs in
      resolveDmRefs.js): a whole OTHER publication module, complete with its
      own injected bookmeta/frontmatter, nested here rather than merged into
      this one. match="pm" above is not anchored to the document root — it
      fires on ANY pm element — so simply reaching it here recurses the
      entire pipeline (its own front matter, its own content/pmEntry chapters)
      for free. A real, hand-authored pmEntry never nests a literal <pm>
      itself, so this is additive only.
    -->
    <xsl:template match="pmEntry">
        <xsl:apply-templates select="pmEntry|dmRef|dmodule|pm"/>
    </xsl:template>
    <xsl:template match="pmEntry/dmRef">
        <xsl:variable name="dm.ref.dm.code">
            <xsl:apply-templates select="dmRefIdent/identExtension"/>
            <xsl:apply-templates select="dmRefIdent/dmCode"/>
        </xsl:variable>
        <!-- Xignal cover: when this reference is the publication's title-page module it is already printed as page 1 (xignal-cover.xsl), so it is not printed again here. -->
        <xsl:variable name="is.cover">
            <xsl:if test="$xs.cover.on">
                <xsl:variable name="cid">
                    <xsl:call-template name="xs-cover-id">
                        <xsl:with-param name="pm" select="ancestor::pm[1]"/>
                    </xsl:call-template>
                </xsl:variable>
                <xsl:if test="$cid != ''">
                    <xsl:for-each select="$all.dmodules[generate-id(.) = $cid]">
                        <xsl:variable name="cover.dm.code">
                            <xsl:call-template name="get.dmcode"/>
                        </xsl:variable>
                        <xsl:if test="$dm.ref.dm.code = $cover.dm.code">1</xsl:if>
                    </xsl:for-each>
                </xsl:if>
            </xsl:if>
        </xsl:variable>
        <xsl:variable name="module.content">
            <xsl:for-each select="$all.dmodules">
                <xsl:variable name="dm.code">
                    <xsl:call-template name="get.dmcode"/>
                </xsl:variable>
                <xsl:if test="$dm.ref.dm.code = $dm.code and $is.cover != '1'">
                    <xsl:apply-templates select="."/>
                </xsl:if>
            </xsl:for-each>
        </xsl:variable>
        <xsl:choose>
            <xsl:when test="$is.cover = '1'"/>
            <xsl:when test="normalize-space($module.content)">
                <xsl:copy-of select="$module.content"/>
            </xsl:when>
            <xsl:otherwise>
                <xsl:message>
                    <xsl:text>PM references unknown DM: </xsl:text>
                    <xsl:value-of select="$dm.ref.dm.code"/>
                </xsl:message>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    FALLBACK FOR UNHANDLED ELEMENTS                    -->
    <!-- ==================================================================== -->
    <xsl:template match="*" priority="-1">
        <!-- One line, so the build can parse and tally these into warnings
             instead of them scrolling past on stderr unread. -->
        <xsl:message>Unhandled element: <xsl:call-template name="element.name"/></xsl:message>
        <xsl:if test="$show.unimplemented.markup != 0 and ancestor-or-self::dmodule">
            <fo:block color="red">
                <xsl:apply-templates select="." mode="literal"/>
            </fo:block>
        </xsl:if>
    </xsl:template>
    <xsl:template match="*" mode="literal">
        <xsl:text>&lt;</xsl:text>
        <xsl:value-of select="name()"/>
        <xsl:for-each select="@*">
            <xsl:text> </xsl:text>
            <xsl:value-of select="name()"/>
            <xsl:text>="</xsl:text>
            <xsl:value-of select="."/>
            <xsl:text>"</xsl:text>
        </xsl:for-each>
        <xsl:text>></xsl:text>
        <xsl:apply-templates mode="literal"/>
        <xsl:text>&lt;/</xsl:text>
        <xsl:value-of select="name()"/>
        <xsl:text>></xsl:text>
    </xsl:template>
    <xsl:template name="element.name">
        <xsl:for-each select="parent::*">
            <xsl:call-template name="element.name"/>
            <xsl:text>/</xsl:text>
        </xsl:for-each>
        <xsl:value-of select="name()"/>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    UTILITY TEMPLATES                                  -->
    <!-- ==================================================================== -->
    <xsl:template name="get.dmcode">
        <xsl:for-each select="ancestor-or-self::dmodule">
            <xsl:apply-templates select="identAndStatusSection/dmAddress/dmIdent/identExtension"/>
            <xsl:apply-templates select="identAndStatusSection/dmAddress/dmIdent/dmCode"/>
        </xsl:for-each>
    </xsl:template>
    <xsl:template name="get.infocode">
        <xsl:choose>
            <xsl:when test="ancestor-or-self::dmRef">
                <xsl:apply-templates select="ancestor-or-self::dmRef/dmRefIdent/dmCode/@infoCode"/>
            </xsl:when>
            <xsl:otherwise>
                <xsl:apply-templates select="ancestor-or-self::dmodule/identAndStatusSection/dmAddress/dmIdent/dmCode/@infoCode"/>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>
    <xsl:template name="copy.id">
        <xsl:if test="@id">
            <xsl:attribute name="id">
                <xsl:text>ID_</xsl:text>
                <xsl:call-template name="get.dmcode"/>
                <xsl:call-template name="dm-occurrence-suffix"/>
                <xsl:text>-</xsl:text>
                <xsl:value-of select="@id"/>
            </xsl:attribute>
        </xsl:if>
    </xsl:template>
    <xsl:key name="by-id" match="*[@id]" use="@id"/>
    <!--
      An id attribute for an element that may carry an authored @id.

      An S1000D @id is only unique WITHIN its data module — two modules both
      numbering their first figure "fig-001" is entirely legal — so a book made
      of many modules repeats ids, and FOP treats a duplicate id as FATAL: it
      abandons the whole render. That is why Generate produced no PDF while a
      single-module Quick Preview (which cannot collide) looked perfectly fine.

      The FIRST element carrying a given id keeps it exactly as authored, and
      each later one gets a two-digit sequence appended (fig-001, then
      fig-00101, fig-00102 ...). Keeping the first unchanged is the important
      half: internalRef targets a bare authored id, so every reference still
      lands on a real destination. Scoping the ids by dmCode instead would have
      been tidier, but it silently broke every reference that pointed at a
      figure in another module — a dangling link rather than a wrong one.

      A reference into a repeated id therefore resolves to its first
      occurrence. That matches how the JSS engine has always behaved.

      Falls back to a generated id when there is no @id, so the attribute is
      never written empty — also invalid, and previously emitted by the
      warning/caution/danger templates for any unlabelled block.
    -->
    <!--
      The id STRING for the context element. Anything that links to one of
      these elements must call this too, with the target as the context node —
      the List of Figures builds its link that way. A linker that reproduced
      the rule by hand instead is exactly how every repeated figure's entry
      ended up pointing at the first copy.
    -->
    <xsl:template name="unique-id">
        <xsl:choose>
            <xsl:when test="not(@id)">
                <xsl:value-of select="generate-id()"/>
            </xsl:when>
            <!-- Keyed, so the overwhelmingly common "not a duplicate" case
                 costs a hash lookup rather than a document scan. -->
            <xsl:when test="generate-id(.) = generate-id(key('by-id', @id)[1])">
                <xsl:value-of select="@id"/>
            </xsl:when>
            <!--
              A repeated id: the id plus how many elements before this one (preceding::, so not counting ancestors) carry it.
              WP-33 / PERF-003 (vendor exception "FO-stage scaling"): that count used to be count(preceding::*[@id = current()/@id]),
              a scan of the whole book per element, i.e. O(figures x book) and the main cost of the FO stage. It is now read from
              this element's position in key('by-id', @id), which holds every element with this id in document order: the ones
              before it are its preceding:: matches plus its ancestors with the same id, so the ancestors are subtracted. Same
              number, by construction; the old expression is kept as the fallback for a node the key does not hold (a node of a
              result tree fragment), so nothing can change there either.
            -->
            <xsl:otherwise>
                <xsl:variable name="me" select="generate-id(.)"/>
                <xsl:variable name="pos">
                    <xsl:for-each select="key('by-id', @id)">
                        <xsl:if test="generate-id(.) = $me"><xsl:value-of select="position()"/></xsl:if>
                    </xsl:for-each>
                </xsl:variable>
                <xsl:choose>
                    <xsl:when test="string($pos) != ''">
                        <xsl:value-of select="concat(@id,
                            format-number($pos - 1 - count(ancestor::*[@id = current()/@id]), '00'))"/>
                    </xsl:when>
                    <xsl:otherwise>
                        <xsl:value-of select="concat(@id,
                            format-number(count(preceding::*[@id = current()/@id]), '00'))"/>
                    </xsl:otherwise>
                </xsl:choose>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>
    <xsl:template name="unique-id-attr">
        <xsl:attribute name="id">
            <xsl:call-template name="unique-id"/>
        </xsl:attribute>
    </xsl:template>
    <!--
      Which print of a data module the context node is in: nothing for the first print, "_x2", "_x3" ... for later ones.

      A publication may print one module several times (the same module reused under more than one chapter or sub-publication).
      Every print carries the same authored ids and the same dmCode, so the dmCode-scoped ids built from them would repeat, and
      FOP treats a repeated id as fatal. The suffix keeps them unique while leaving the first print - and so every document
      that prints each module once - exactly as it was.

      Whatever links to one of these ids builds it the same way, with the target (or the referencing node, which is in the same
      module) as the context, so a link always lands in its own print. dm-code-key (refs.xsl) is the string the dm-by-code key
      is built from.
    -->
    <xsl:template name="dm-occurrence-suffix">
        <xsl:variable name="dm" select="ancestor-or-self::dmodule[1]"/>
        <xsl:if test="$dm/identAndStatusSection/dmAddress/dmIdent/dmCode">
            <xsl:variable name="key">
                <xsl:apply-templates select="$dm" mode="dm-code-key"/>
            </xsl:variable>
            <xsl:variable name="same" select="key('dm-by-code', string($key))"/>
            <xsl:if test="generate-id($same[1]) != generate-id($dm)">
                <!--
                  WP-33 / PERF-003: the print number is this module's position among the modules with its code ($same is in
                  document order and modules do not nest, so the ones before it are exactly its preceding:: ones). It was
                  counted by intersecting $same with $dm/preceding::dmodule, a scan of the book for EVERY id of a reprinted
                  module. The old expression stays as the fallback for a module the key does not hold.
                -->
                <xsl:variable name="me" select="generate-id($dm)"/>
                <xsl:variable name="pos">
                    <xsl:for-each select="$same">
                        <xsl:if test="generate-id(.) = $me"><xsl:value-of select="position()"/></xsl:if>
                    </xsl:for-each>
                </xsl:variable>
                <xsl:text>_x</xsl:text>
                <xsl:choose>
                    <xsl:when test="string($pos) != ''"><xsl:value-of select="number($pos)"/></xsl:when>
                    <xsl:otherwise>
                        <xsl:variable name="before" select="$dm/preceding::dmodule"/>
                        <xsl:value-of select="count($same[count(. | $before) = count($before)]) + 1"/>
                    </xsl:otherwise>
                </xsl:choose>
            </xsl:if>
        </xsl:if>
    </xsl:template>
    <xsl:template name="generate-link-id">
        <xsl:param name="localId"/>
        <xsl:text>ID_</xsl:text>
        <xsl:choose>
            <xsl:when test="ancestor-or-self::dmodule[1]/identAndStatusSection/dmAddress/dmIdent/dmCode">
                <xsl:apply-templates select="ancestor-or-self::dmodule[1]/identAndStatusSection/dmAddress/dmIdent/dmCode"/>
                <xsl:call-template name="dm-occurrence-suffix"/>
            </xsl:when>
            <xsl:otherwise>
                <xsl:value-of select="generate-id(ancestor-or-self::dmodule[1])"/>
            </xsl:otherwise>
        </xsl:choose>
        <xsl:text>-</xsl:text>
        <xsl:value-of select="$localId"/>
    </xsl:template>
</xsl:stylesheet>