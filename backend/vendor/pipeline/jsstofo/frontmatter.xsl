<?xml version="1.0" encoding="UTF-8"?>
<!-- ********************************************************************
     JSS to XSL-FO: Front matter

     Renders the fixed prelim pages of the stencil, in order:
       title page (joint) -> title page -> proprietary -> foreword ->
       record of changes -> associated handbooks -> safety warning ->
       first aid -> cautions/notes -> demolition -> change notice ->
       list of abbreviations -> contents / annexures / figures / tables ->
       system name -> description of symbols
     ******************************************************************** -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">

    <!-- Whether the single title page prints the "INBR No.:" line. Declared here, in the file both the JSS and the S1000D direct engine include, with the
         historical behaviour as the default; only the JSS authoring build sets it to 0, and only for the stencils that have no INBR line (see services/jss/registry.ts). -->
    <xsl:param name="cover.inbr.show">1</xsl:param>

    <!-- Where the standard cover prints its date and "Under the Authority of" block: 0 = at the end of the cover's body (as always), 1 = in the foot region of the first page,
         above the classification banner (as the xignal-jss cover already does). Only the JSS authoring build sets 1 (services/jss/service.ts layoutParamsFor). -->
    <xsl:param name="cover.authority.foot">0</xsl:param>
    <!--
      changenotice.layout   classic (default): the Change Notice page as it has always been printed (3 ruled rows, table font).
                            grid: the pro-forma of the L&T User Handbook: the publisher letterhead, a header row and 11 ruled rows (12 pt), the Pages / Enclosures /
                            Sheets lines, and the codes box with its note. Only the JSS authoring build sends it (services/jss/service.ts layoutParamsFor), so the
                            S1000D direct engine, which shares this file, and the old JSS path print what they printed before.
    -->
    <xsl:param name="changenotice.layout">classic</xsl:param>

    <!--
      ref.layout          0 (default): every page as it has always been printed. 1: the L&T reference layout (the Naval stencil of NTG Mumbai, 40 pages), for the JSS authoring build only
                          (services/jss/service.ts layoutParamsFor): the cover and the title page on 25 mm margins with the Code No. / Rev No. lines (the title page follows the cover's blank
                          back), page titles underlined, the running head and foot as the reference prints them, the chapter divider and the section headings as it sets them.
      restricted.scope    all (default): the classification in the running head and foot of every page, as always. cover: on the cover and the title page only (the Land system).
                          reference: on the cover, the title page and the Change Notice page (the Naval system, as the reference prints it).
      red.color           the red of the notices and boxes: #CC0000 as always; the reference prints #FF0000.
      Declared here, in the file both engines include, with the old behaviour as the default; the S1000D direct engine and the old JSS path never send them.
    -->
    <xsl:param name="ref.layout">0</xsl:param>
    <xsl:param name="restricted.scope">all</xsl:param>
    <xsl:param name="red.color">#CC0000</xsl:param>
    <xsl:variable name="lref" select="$ref.layout = '1'"/>
    <!-- the Change Notice letterhead logo and the gap under it: 26 pt and 21.6 pt as always; 34 pt and 5.6 pt under the reference layout (a taller picture, the same page height: the table still starts at 163 pt and the page still holds its 15 rows and the codes box) -->
    <!-- the space above the date and authority block: 6 mm as always; none under the reference layout, where the block sits in the foot region of the cover master -->
    <xsl:variable name="authority.gap"><xsl:choose><xsl:when test="$lref">0pt</xsl:when><xsl:otherwise>6mm</xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:variable name="cn.logo.height"><xsl:choose><xsl:when test="$lref">34pt</xsl:when><xsl:otherwise>26pt</xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:variable name="cn.logo.gap"><xsl:choose><xsl:when test="$lref">5.6pt</xsl:when><xsl:otherwise>21.6pt</xsl:otherwise></xsl:choose></xsl:variable>
    <!-- the size of the tables on the front-matter pages: the reference sets them in 12 pt; the old layouts in the table size -->
    <xsl:variable name="fm.table.size"><xsl:choose><xsl:when test="$lref">12pt</xsl:when><xsl:otherwise><xsl:value-of select="$table-font-size"/></xsl:otherwise></xsl:choose></xsl:variable>

    <!-- Whether the Foreword prints its "L&T Document No.:" line. The stencil forewords (UHB, MM, ORM) have none. Default 1 = as before; only the JSS authoring build sets 0. -->
    <xsl:param name="foreword.documentNo.show">1</xsl:param>

    <!-- Whether a cover title that contains line breaks is set one line per row (the MM and ORM stencil covers have a two-line title). Default 0 = the title is
         one block exactly as before; only the JSS authoring build sets 1. -->
    <xsl:param name="cover.title.split">0</xsl:param>

    <!-- Three pages whose table differs in the list stencils (Manufacturer's Recommended List of Spares, Complete Equipment Schedule, List of SMT / STE). Each default is what the page
         always was; only the JSS authoring build sets the others.
           roc.layout          "amendments": the Amendments table (Sr. No. | Page No. | Para Reference | Amendment / Required | Authority with Ref No. & Date) instead of the Change Notice table
           abbrev.layout       "numbered": Sr. No. | Abbreviations issued | For, instead of Abbreviations | Description
           safety.footer.show  0: no "FOR FIRST AID IN CASE OF ELECTRIC SHOCK SEE THE FOLLOWING PAGE" line under the safety warning
         The labels of the new tables are declared here (not in the engine's main stylesheet) because the S1000D direct engine includes this file too and does not declare them. -->
    <xsl:param name="roc.layout">change-notice</xsl:param>
    <xsl:param name="abbrev.layout">description</xsl:param>
    <xsl:param name="safety.footer.show">1</xsl:param>
    <xsl:param name="fm.label.amend.colSrNo"/>
    <xsl:param name="fm.label.amend.colPage"/>
    <xsl:param name="fm.label.amend.colPara"/>
    <xsl:param name="fm.label.amend.colAmendment"/>
    <xsl:param name="fm.label.amend.colAuthority"/>
    <xsl:param name="fm.label.abbrev.colSrNo"/>
    <xsl:param name="fm.label.abbrev.colIssued"/>
    <xsl:param name="fm.label.abbrev.colFor"/>

    <!--
      Everything from the proprietary page onward is grouped into "parts",
      each its own page-sequence that opens on an odd (right-hand) page and
      pads itself to end even (see prelim-part-sequence in pagesetup.xsl) —
      the same right-hand-opening convention chapters use, applied to the
      front matter. Roman numbering still increments continuously across
      parts; only the grouping into separate sequences is new. Every named
      section gets its own part, including first aid and each of the
      contents/figures/tables/annexures pages, so each one individually opens
      on the right regardless of how long the section before it ran.

      The two cover pages (joint title, title) are emitted separately by the
      jssbook template because they use the banner layout and carry no folio;
      their own always-exactly-two-pages construction already guarantees the
      first prelim part below opens on a true odd page.
    -->

    <!--
      A page heading: the project's own wording when it has set one, otherwise
      the stencil's. Kept as a named template because XSLT cannot look a
      parameter up by name, so each call site has to pass its own override in.
    -->
    <!--
      A fixed piece of front-matter wording — a column heading, a caption, the
      run-in before a table. Prints the project's override when there is one
      and the stencil's own wording otherwise, so a book that sets nothing
      looks exactly as it did.

      Separate from fm-heading, which is only for a page's own title. These are
      the strings inside the page, and there are enough of them that the
      alternative — a parameter used once, hardcoded at its single call site —
      is what left every one of them uneditable.
    -->
    <xsl:template name="fm-label">
        <xsl:param name="override"/>
        <xsl:param name="default"/>
        <xsl:choose>
            <xsl:when test="normalize-space($override) != ''"><xsl:value-of select="$override"/></xsl:when>
            <xsl:otherwise><xsl:value-of select="$default"/></xsl:otherwise>
        </xsl:choose>
    </xsl:template>

    <xsl:template name="fm-heading">
        <xsl:param name="override"/>
        <xsl:param name="default"/>
        <xsl:choose>
            <xsl:when test="normalize-space($override) != ''"><xsl:value-of select="$override"/></xsl:when>
            <xsl:otherwise><xsl:value-of select="$default"/></xsl:otherwise>
        </xsl:choose>
    </xsl:template>

    <xsl:template name="frontmatter-prelims">
        <xsl:variable name="fm" select="frontmatter"/>
        <!--
          One page-sequence per front-matter page, in DOCUMENT ORDER.

          This used to name each page explicitly, in a fixed sequence, which
          meant the running order was hardcoded here as well as in the code that
          builds the frontmatter block — two lists to keep in step by hand. Now
          whatever the build puts in <frontmatter>, in whatever order, is what
          gets rendered, so turning a page off or moving it is a data change
          rather than a stylesheet change, and both engines follow the same
          list automatically.

          The two cover pages are excluded: they are emitted separately by the
          jssbook template because they use the banner layout and carry no
          folio.
        -->
        <xsl:for-each select="$fm/*[not(self::titlePageJoint or self::titlePage)]">
            <xsl:call-template name="prelim-part-sequence">
                <xsl:with-param name="content"><xsl:apply-templates select="."/></xsl:with-param>
                <xsl:with-param name="first">
                    <xsl:choose>
                        <xsl:when test="position() = 1">1</xsl:when>
                        <xsl:otherwise>0</xsl:otherwise>
                    </xsl:choose>
                </xsl:with-param>
            </xsl:call-template>
        </xsl:for-each>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                   1. TITLE PAGE (JOINTLY PUBLISHED)                   -->
    <!-- ==================================================================== -->
    <xsl:template match="titlePageJoint">
        <xsl:variable name="content">
            <fo:block text-align="right" font-weight="bold" space-after="3mm">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.titleJoint.publicationNo"/><xsl:with-param name="default">&lt;&lt;Publication No&gt;&gt;: </xsl:with-param></xsl:call-template>
                <xsl:value-of select="$meta/publicationNo"/>
            </fo:block>

            <xsl:call-template name="red-box">
                <xsl:with-param name="content">
                    <fo:block><xsl:apply-templates select="disclosureNotice/node()"/></fo:block>
                </xsl:with-param>
            </xsl:call-template>

            <xsl:call-template name="national-emblem"/>

            <fo:block text-align="center" font-weight="bold"
                      font-family="{$cover.title.font-family}" font-size="{$cover.title.font-size}" space-after="5mm">
                <fo:block><xsl:value-of select="documentType"/></fo:block>
                <fo:block space-before="3mm">FOR</fo:block>
                <fo:block space-before="5mm"><xsl:value-of select="$system.name"/></fo:block>
            </fo:block>

            <fo:block text-align="center" font-weight="bold" font-size="13pt" space-after="4mm">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.titleJoint.nsn"/><xsl:with-param name="default">NSN: </xsl:with-param></xsl:call-template><xsl:value-of select="$meta/nsn"/>
            </fo:block>
            <fo:block text-align="center" font-weight="bold" font-size="13pt" space-after="4mm">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.titleJoint.contractNo"/><xsl:with-param name="default">Contract No.: </xsl:with-param></xsl:call-template><xsl:value-of select="$meta/contractNo"/>
            </fo:block>
            <fo:block text-align="center" font-weight="bold" font-size="13pt" space-after="6mm">
                <xsl:text>(</xsl:text><xsl:value-of select="$meta/projectCode"/><xsl:text>)</xsl:text>
            </fo:block>

            <xsl:call-template name="red-box">
                <xsl:with-param name="content">
                    <fo:block><xsl:apply-templates select="repairNotice/node()"/></fo:block>
                </xsl:with-param>
            </xsl:call-template>

            <fo:block text-align="center" font-weight="bold" space-after="4mm">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.titleJoint.publishedBy"/><xsl:with-param name="default">Jointly Prepared &amp; Published by:</xsl:with-param></xsl:call-template>
            </fo:block>
            <xsl:call-template name="publisher-row"/>
            <xsl:if test="$cover.authority.foot != '1'"><xsl:call-template name="authority-block"/></xsl:if>
        </xsl:variable>

        <xsl:call-template name="cover-page-sequence">
            <xsl:with-param name="content" select="$content"/>
            <xsl:with-param name="foot" select="$cover.authority.foot"/>
        </xsl:call-template>
        <xsl:call-template name="cover-blank-verso"/>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                        2. TITLE PAGE (SINGLE)                         -->
    <!-- One block per line of a cover title that contains line breaks (used only when cover.title.split = 1). -->
    <xsl:template name="cover-title-lines">
        <xsl:param name="text"/>
        <xsl:choose>
            <xsl:when test="contains($text, '&#10;')">
                <fo:block><xsl:value-of select="substring-before($text, '&#10;')"/></fo:block>
                <xsl:call-template name="cover-title-lines"><xsl:with-param name="text" select="substring-after($text, '&#10;')"/></xsl:call-template>
            </xsl:when>
            <xsl:otherwise><fo:block><xsl:value-of select="$text"/></fo:block></xsl:otherwise>
        </xsl:choose>
    </xsl:template>

    <!-- ==================================================================== -->
    <xsl:template match="titlePage">
        <xsl:variable name="content">
            <!-- Code No. / Rev No. at the top left of the cover (UHB stencil). Printed only
                 when the project sets them, so a book without them is unchanged. -->
            <xsl:if test="normalize-space($cover.codeNo) != ''">
                <fo:block text-align="left" font-weight="bold">Code No.: <xsl:value-of select="$cover.codeNo"/></fo:block>
            </xsl:if>
            <xsl:if test="normalize-space($cover.revNo) != ''">
                <fo:block text-align="left" font-weight="bold" space-after="4mm">Rev No.: <xsl:value-of select="$cover.revNo"/></fo:block>
            </xsl:if>
            <!-- The stencil covers of UHB, MM and ORM carry Code No. and Rev No. but no INBR No.: a JSS document of such a type turns this line off with cover.inbr.show = 0.
                 Every other book keeps it (the default is 1), and so does every S1000D build, which shares this file but never sets the parameter. -->
            <xsl:if test="$cover.inbr.show != '0'">
                <fo:block text-align="right" font-weight="bold" space-after="4mm">
                    <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.title.inbrNo"/><xsl:with-param name="default">INBR No.:</xsl:with-param></xsl:call-template><xsl:value-of select="$meta/inbrNo"/>
                </fo:block>
            </xsl:if>

            <xsl:call-template name="red-box">
                <xsl:with-param name="content">
                    <fo:block><xsl:apply-templates select="disclosureNotice/node()"/></fo:block>
                </xsl:with-param>
            </xsl:call-template>

            <xsl:call-template name="national-emblem"/>

            <fo:block text-align="center" font-weight="bold"
                      font-family="{$cover.title.font-family}" font-size="{$cover.title.font-size}"
                      text-decoration="underline" space-after="8mm">
                <xsl:choose>
                    <xsl:when test="$cover.title.split = '1' and contains(documentType, '&#10;')">
                        <xsl:call-template name="cover-title-lines"><xsl:with-param name="text" select="string(documentType)"/></xsl:call-template>
                    </xsl:when>
                    <xsl:otherwise><xsl:value-of select="documentType"/></xsl:otherwise>
                </xsl:choose>
            </fo:block>
            <fo:block text-align="center" font-weight="bold"
                      font-family="{$cover.title.font-family}" font-size="{$cover.title.font-size}"
                      text-decoration="underline" space-after="8mm">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.title.for"/><xsl:with-param name="default">FOR</xsl:with-param></xsl:call-template>
            </fo:block>
            <fo:block text-align="center" font-weight="bold"
                      font-family="{$cover.title.font-family}" font-size="{$cover.title.font-size}"
                      text-decoration="underline" space-after="8mm">
                <xsl:value-of select="$system.name"/>
            </fo:block>

            <xsl:call-template name="red-box">
                <xsl:with-param name="content">
                    <fo:block><xsl:apply-templates select="repairNotice/node()"/></fo:block>
                </xsl:with-param>
            </xsl:call-template>

            <fo:block text-align="center" space-before="6mm" space-after="4mm">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.title.publishedBy"/><xsl:with-param name="default">Prepared &amp; Published by</xsl:with-param></xsl:call-template>
            </fo:block>
            <xsl:for-each select="$meta/publishers/publisher[1]">
                <xsl:if test="logo/@src">
                    <fo:block text-align="center" space-after="3mm">
                        <!-- logo/@width and @height, when set on this publisher in
                             Settings, override the built-in 20mm-tall/auto-width
                             default so a house with an unusually wide or tall mark
                             is not forced into it. -->
                        <fo:external-graphic src="url('{logo/@src}')" scaling="uniform">
                            <xsl:attribute name="content-height">
                                <xsl:choose>
                                    <xsl:when test="logo/@height"><xsl:value-of select="logo/@height"/></xsl:when>
                                    <xsl:otherwise>20mm</xsl:otherwise>
                                </xsl:choose>
                            </xsl:attribute>
                            <xsl:if test="logo/@width">
                                <xsl:attribute name="content-width"><xsl:value-of select="logo/@width"/></xsl:attribute>
                            </xsl:if>
                        </fo:external-graphic>
                    </fo:block>
                </xsl:if>
                <fo:block text-align="center">
                    <xsl:for-each select="name | addressLine">
                        <fo:block><xsl:value-of select="."/></fo:block>
                    </xsl:for-each>
                </fo:block>
            </xsl:for-each>

            <xsl:if test="$cover.authority.foot != '1'"><xsl:call-template name="authority-block"/></xsl:if>
        </xsl:variable>

        <xsl:call-template name="cover-page-sequence">
            <xsl:with-param name="content" select="$content"/>
            <xsl:with-param name="foot" select="$cover.authority.foot"/>
        </xsl:call-template>
        <xsl:call-template name="cover-blank-verso"/>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--        2b. TITLE PAGE, xignal-jss layout (one page, measured)         -->
    <!-- ==================================================================== -->
    <!--
      The reference prints a single title page. Every gap below is the one measured on RDR-1671Y-00061-00.pdf page 1 (baselines: publication no.
      766.4, rev. no. 752.0, box 722.3 ... , title 544.7, FOR 502.8, system 461.0, box 418.5 ... , publisher 331.5 / 300.1 / 199.3). Box borders are
      1.133 pt, the text inside is justified, and the date and authority block is not in this flow (it is in the page's foot region).
    -->
    <xsl:template name="xjss-box">
        <xsl:param name="content"/>
        <xsl:param name="before">0pt</xsl:param>
        <fo:block border="1.133pt solid #CC0000" padding="2.3pt 5.67pt" color="#CC0000" text-align="justify" space-before="{$before}">
            <xsl:copy-of select="$content"/>
        </fo:block>
    </xsl:template>

    <xsl:template match="titlePage | titlePageJoint" mode="xjss-cover">
        <xsl:variable name="content">
            <fo:block text-align="right" font-weight="bold">
                <fo:block>
                    <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.title.inbrNo"/><xsl:with-param name="default">INBR No.:</xsl:with-param></xsl:call-template><xsl:text> </xsl:text><xsl:value-of select="$meta/inbrNo"/>
                </fo:block>
                <xsl:if test="normalize-space($cover.revNo) != ''"><fo:block>Rev. No.: <xsl:value-of select="$cover.revNo"/></fo:block></xsl:if>
            </fo:block>

            <xsl:call-template name="xjss-box">
                <xsl:with-param name="before">11.8pt</xsl:with-param>
                <xsl:with-param name="content"><fo:block><xsl:apply-templates select="disclosureNotice/node()"/></fo:block></xsl:with-param>
            </xsl:call-template>

            <!-- The national emblem: 36.7 mm tall in the reference; the space is kept when no artwork is supplied. -->
            <fo:block-container height="104.1pt" space-before="6.7pt">
                <fo:block text-align="center" line-height="0">
                    <xsl:if test="$meta/emblem/@src">
                        <fo:external-graphic src="url('{$meta/emblem/@src}')" content-height="104.1pt" scaling="uniform"/>
                    </xsl:if>
                </fo:block>
            </fo:block-container>

            <xsl:variable name="tfs" select="$cover.title.font-size"/>
            <fo:block text-align="center" font-weight="bold" font-family="{$cover.title.font-family}" font-size="{$tfs}" text-decoration="underline" space-before="2.7pt" space-after="8mm">
                <xsl:value-of select="documentType"/>
            </fo:block>
            <fo:block text-align="center" font-weight="bold" font-family="{$cover.title.font-family}" font-size="{$tfs}" text-decoration="underline" space-after="8mm">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.title.for"/><xsl:with-param name="default">FOR</xsl:with-param></xsl:call-template>
            </fo:block>
            <fo:block text-align="center" font-weight="bold" font-family="{$cover.title.font-family}" font-size="{$tfs}" text-decoration="underline" space-after="23.3pt">
                <xsl:value-of select="$system.name"/>
            </fo:block>

            <xsl:call-template name="xjss-box">
                <xsl:with-param name="content"><fo:block><xsl:apply-templates select="repairNotice/node()"/></fo:block></xsl:with-param>
            </xsl:call-template>

            <fo:block text-align="center" space-before="26pt" space-after="6mm">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.title.publishedBy"/><xsl:with-param name="default">Prepared &amp; Published by</xsl:with-param></xsl:call-template>
            </fo:block>
            <!-- publisher: its name, then the logo, then the remaining lines (the reference's order) -->
            <xsl:for-each select="$meta/publishers/publisher[1]">
                <xsl:variable name="lines" select="name | addressLine"/>
                <fo:block text-align="center" space-after="1mm"><xsl:value-of select="$lines[1]"/></fo:block>
                <xsl:if test="logo/@src">
                    <fo:block text-align="center" space-after="1mm">
                        <fo:external-graphic src="url('{logo/@src}')" scaling="uniform">
                            <xsl:attribute name="content-height"><xsl:choose><xsl:when test="logo/@height"><xsl:value-of select="logo/@height"/></xsl:when><xsl:otherwise>80.7pt</xsl:otherwise></xsl:choose></xsl:attribute>
                            <xsl:if test="logo/@width"><xsl:attribute name="content-width"><xsl:value-of select="logo/@width"/></xsl:attribute></xsl:if>
                        </fo:external-graphic>
                    </fo:block>
                </xsl:if>
                <fo:block text-align="center">
                    <xsl:for-each select="$lines[position() &gt; 1]"><fo:block><xsl:value-of select="."/></fo:block></xsl:for-each>
                </fo:block>
            </xsl:for-each>
        </xsl:variable>

        <xsl:call-template name="cover-page-sequence-xjss">
            <xsl:with-param name="content" select="$content"/>
        </xsl:call-template>
        <xsl:call-template name="cover-blank-verso"/>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--   2c. COVER AND TITLE PAGE, L&T reference layout (ref.layout = 1)      -->
    <!-- ==================================================================== -->
    <!--
      The reference prints the cover (page 1), a blank back with nothing on it (2), the title page - the same page again (3) - and a back that carries only "This page is
      intentionally left blank." (4); the proprietary notice is then page i. Both pages: the classification top and bottom (12 pt, bold, underlined, red), Code No. and Rev No. right
      aligned, the notice boxes with a thin red rule, the emblem 104 pt tall, the title in 16 pt bold underlined, the date and the authority in the foot above the classification.
      Text sizes and positions measured on Stencil_Naval_system_NTG Mumbai.pdf pages 1 and 3.
    -->
    <xsl:template name="lref-box">
        <xsl:param name="content"/>
        <xsl:param name="before">0pt</xsl:param>
        <fo:block border="0.75pt solid {$red.color}" padding="2.5pt 6pt 2.5pt 6pt" margin-left="0mm" margin-right="0mm"
                  color="{$red.color}" text-align="justify" space-before="{$before}">
            <xsl:copy-of select="$content"/>
        </fo:block>
    </xsl:template>

    <xsl:template match="titlePage" mode="lref-cover">
        <xsl:variable name="content">
            <fo:block text-align="right">
                <fo:block><fo:inline font-weight="bold">Code No.: </fo:inline><xsl:value-of select="$cover.codeNo"/></fo:block>
                <fo:block><fo:inline font-weight="bold">Rev No.: </fo:inline><xsl:value-of select="$cover.revNo"/></fo:block>
            </fo:block>

            <xsl:call-template name="lref-box">
                <xsl:with-param name="before">14pt</xsl:with-param>
                <xsl:with-param name="content"><fo:block><xsl:apply-templates select="disclosureNotice/node()"/></fo:block></xsl:with-param>
            </xsl:call-template>

            <fo:block-container height="104pt" space-before="18pt">
                <fo:block text-align="center" line-height="0">
                    <xsl:if test="$meta/emblem/@src">
                        <fo:external-graphic src="url('{$meta/emblem/@src}')" content-height="104pt" scaling="uniform"/>
                    </xsl:if>
                </fo:block>
            </fo:block-container>

            <fo:block text-align="center" font-weight="bold" font-family="{$cover.title.font-family}" font-size="{$cover.title.font-size}"
                      text-decoration="underline" space-before="17pt" space-after="3.6pt">
                <xsl:choose>
                    <xsl:when test="$cover.title.split = '1' and contains(documentType, '&#10;')">
                        <xsl:call-template name="cover-title-lines"><xsl:with-param name="text" select="string(documentType)"/></xsl:call-template>
                    </xsl:when>
                    <xsl:otherwise><xsl:value-of select="documentType"/></xsl:otherwise>
                </xsl:choose>
            </fo:block>
            <fo:block text-align="center" font-weight="bold" font-family="{$cover.title.font-family}" font-size="{$cover.title.font-size}"
                      text-decoration="underline" space-after="3.6pt">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.title.for"/><xsl:with-param name="default">FOR</xsl:with-param></xsl:call-template>
            </fo:block>
            <fo:block text-align="center" font-weight="bold" font-family="{$cover.title.font-family}" font-size="{$cover.title.font-size}"
                      text-decoration="underline">
                <xsl:value-of select="$system.name"/>
            </fo:block>

            <xsl:call-template name="lref-box">
                <xsl:with-param name="before">14pt</xsl:with-param>
                <xsl:with-param name="content"><fo:block><xsl:apply-templates select="repairNotice/node()"/></fo:block></xsl:with-param>
            </xsl:call-template>

            <fo:block text-align="center" space-before="22pt" space-after="4pt">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.title.publishedBy"/><xsl:with-param name="default">Prepared &amp; Published by</xsl:with-param></xsl:call-template>
            </fo:block>
            <xsl:for-each select="$meta/publishers/publisher[1]">
                <xsl:if test="logo/@src">
                    <fo:block text-align="center" line-height="0">
                        <fo:external-graphic src="url('{logo/@src}')" scaling="uniform">
                            <xsl:attribute name="content-height">
                                <xsl:choose>
                                    <xsl:when test="logo/@height"><xsl:value-of select="logo/@height"/></xsl:when>
                                    <xsl:otherwise>80pt</xsl:otherwise>
                                </xsl:choose>
                            </xsl:attribute>
                            <xsl:if test="logo/@width"><xsl:attribute name="content-width"><xsl:value-of select="logo/@width"/></xsl:attribute></xsl:if>
                        </fo:external-graphic>
                    </fo:block>
                </xsl:if>
                <fo:block text-align="center" line-height="16pt">
                    <xsl:for-each select="name | addressLine"><fo:block><xsl:value-of select="."/></fo:block></xsl:for-each>
                </fo:block>
            </xsl:for-each>
        </xsl:variable>

        <!-- ONE title page and its back (owner, 2026-11-27: the same page printed a second time was a doubled title page) -->
        <xsl:call-template name="cover-page-sequence-lref"><xsl:with-param name="content" select="$content"/></xsl:call-template>
        <xsl:if test="$blank.versos = '1'"><xsl:call-template name="cover-blank-lref"><xsl:with-param name="legend">1</xsl:with-param></xsl:call-template></xsl:if>
    </xsl:template>

    <!-- Shared cover-page furniture -->
    <xsl:template name="national-emblem">
        <fo:block text-align="center" space-after="4mm">
            <xsl:choose>
                <xsl:when test="$meta/emblem/@src">
                    <fo:external-graphic src="url('{$meta/emblem/@src}')"
                                         content-height="28mm" scaling="uniform"/>
                </xsl:when>
                <xsl:otherwise>
                    <!-- Reserve the emblem's space when no artwork is supplied so
                         the page composition still matches the stencil. -->
                    <fo:block-container height="28mm" width="100%">
                        <fo:block/>
                    </fo:block-container>
                </xsl:otherwise>
            </xsl:choose>
        </fo:block>
    </xsl:template>

    <!--
      The joint title page holds 1, 2 or 3 publishers. The row always used a
      fixed 3-column table, so 1 publisher landed in the leftmost third (and
      looked left-aligned) and 2 publishers filled only the left two-thirds
      (and looked shifted left) instead of being centered as a group. Sizing
      the table to the actual publisher count fixes both: 1 publisher gets a
      single full-width centered cell, 2 publishers get two equal centered
      halves, and 3 publishers keep today's even three-way split.
    -->
    <xsl:template name="publisher-row">
        <xsl:variable name="pubCount" select="count($meta/publishers/publisher)"/>
        <!--
          Zero publishers used to fall through to the "otherwise" 3-column
          branch below and then for-each over an empty node-set: a
          <fo:table-row> with no cells at all, which XSL-FO forbids outright
          ("fo:table-row is missing child elements") and FOP refuses to
          render — not a cosmetic gap, a build that produces no PDF.
          Never hit by an ordinary project (branding.publishers always has at
          least the house default), first hit by a pmRef annex whose own
          branding was never configured, since its title page is generated
          from ITS OWN settings rather than the master's. Absent publishers
          now means no publisher block at all, matching "nothing configured,
          nothing shown" elsewhere in this front matter rather than a broken
          table.
        -->
        <xsl:if test="$pubCount &gt; 0">
        <fo:table table-layout="fixed" width="100%" space-after="6mm">
            <xsl:choose>
                <xsl:when test="$pubCount = 1">
                    <fo:table-column column-width="proportional-column-width(1)"/>
                </xsl:when>
                <xsl:when test="$pubCount = 2">
                    <fo:table-column column-width="proportional-column-width(1)"/>
                    <fo:table-column column-width="proportional-column-width(1)"/>
                </xsl:when>
                <xsl:otherwise>
                    <fo:table-column column-width="proportional-column-width(1)"/>
                    <fo:table-column column-width="proportional-column-width(1)"/>
                    <fo:table-column column-width="proportional-column-width(1)"/>
                </xsl:otherwise>
            </xsl:choose>
            <fo:table-body>
                <fo:table-row>
                    <xsl:for-each select="$meta/publishers/publisher">
                        <fo:table-cell padding="2mm" text-align="center">
                            <xsl:if test="logo/@src">
                                <fo:block space-after="2mm">
                                    <!-- Fitted inside a box: logos vary from
                                         square roundels to wide wordmarks, and
                                         constraining height alone lets a wide
                                         one overrun its column. The box itself
                                         is logo/@width x @height when set in
                                         Settings for this publisher, else the
                                         42mm x 18mm default. -->
                                    <fo:external-graphic src="url('{logo/@src}')"
                                                         content-width="scale-down-to-fit"
                                                         content-height="scale-down-to-fit"
                                                         scaling="uniform">
                                        <xsl:attribute name="width">
                                            <xsl:choose>
                                                <xsl:when test="logo/@width"><xsl:value-of select="logo/@width"/></xsl:when>
                                                <xsl:otherwise>42mm</xsl:otherwise>
                                            </xsl:choose>
                                        </xsl:attribute>
                                        <xsl:attribute name="height">
                                            <xsl:choose>
                                                <xsl:when test="logo/@height"><xsl:value-of select="logo/@height"/></xsl:when>
                                                <xsl:otherwise>18mm</xsl:otherwise>
                                            </xsl:choose>
                                        </xsl:attribute>
                                    </fo:external-graphic>
                                </fo:block>
                            </xsl:if>
                            <fo:block><xsl:value-of select="name"/></fo:block>
                            <xsl:for-each select="addressLine">
                                <fo:block><xsl:value-of select="."/></fo:block>
                            </xsl:for-each>
                        </fo:table-cell>
                    </xsl:for-each>
                </fo:table-row>
            </fo:table-body>
        </fo:table>
        </xsl:if>
    </xsl:template>

    <xsl:template name="authority-block">
        <fo:table table-layout="fixed" width="100%" space-before="{$authority.gap}">
            <!-- L&T reference: the date at the left, the authority on two lines (left aligned) from 47% of the text width (x = 284 pt on the reference) -->
            <fo:table-column><xsl:attribute name="column-width"><xsl:choose><xsl:when test="$lref">proportional-column-width(47)</xsl:when><xsl:otherwise>proportional-column-width(1)</xsl:otherwise></xsl:choose></xsl:attribute></fo:table-column>
            <fo:table-column><xsl:attribute name="column-width"><xsl:choose><xsl:when test="$lref">proportional-column-width(53)</xsl:when><xsl:otherwise>proportional-column-width(1)</xsl:otherwise></xsl:choose></xsl:attribute></fo:table-column>
            <fo:table-body>
                <fo:table-row>
                    <fo:table-cell display-align="after">
                        <fo:block>
                            <xsl:value-of select="$meta/month"/>
                            <xsl:text>, </xsl:text>
                            <xsl:value-of select="$meta/year"/>
                        </fo:block>
                    </fo:table-cell>
                    <fo:table-cell>
                        <xsl:attribute name="text-align"><xsl:choose><xsl:when test="$lref">left</xsl:when><xsl:otherwise>right</xsl:otherwise></xsl:choose></xsl:attribute>
                        <fo:block>Under the Authority of</fo:block>
                        <fo:block>Secretary, Ministry of Defence, Govt. of India</fo:block>
                    </fo:table-cell>
                </fo:table-row>
            </fo:table-body>
        </fo:table>
    </xsl:template>

    <!-- Blank verso following a cover page keeps the banner but has no folio -->
    <xsl:template name="cover-blank-verso">
        <xsl:if test="$blank.versos = '1'">
            <xsl:call-template name="cover-page-sequence">
                <xsl:with-param name="content">
                    <fo:block-container height="{$cover-blank-height}" display-align="center">
                        <xsl:if test="$xjss"><xsl:attribute name="margin-right">5mm</xsl:attribute></xsl:if>
                        <fo:block text-align="center" font-weight="bold">
                            <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.title.blankPage"/><xsl:with-param name="default">This page is intentionally left blank.</xsl:with-param></xsl:call-template>
                        </fo:block>
                    </fo:block-container>
                </xsl:with-param>
            </xsl:call-template>
        </xsl:if>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                   3. PROPRIETARY INFORMATION NOTICE                   -->
    <!-- ==================================================================== -->
    <xsl:template match="proprietary">
        <fo:block>
            <xsl:call-template name="red-box">
                <xsl:with-param name="content">
                    <fo:block text-align="center" font-weight="bold" font-size="{$heading2-size}"
                              space-after="5mm" text-decoration="underline">
                        <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.proprietary.heading"/><xsl:with-param name="default">RESTRICTION ON USE, DUPLICATION OR DISCLOSURE OF PROPRIETARY INFORMATION</xsl:with-param></xsl:call-template>
                    </fo:block>
                    <xsl:apply-templates select="para"/>
                </xsl:with-param>
            </xsl:call-template>
            <xsl:if test="applicability">
                <fo:block border="0.8pt solid {$red.color}" padding="2mm" color="{$red.color}"
                          margin-left="0mm" margin-right="0mm"
                          text-align="center" font-weight="bold">
                    <xsl:value-of select="applicability"/>
                </fo:block>
            </xsl:if>
        </fo:block>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                             4. FOREWORD                               -->
    <!-- ==================================================================== -->
    <xsl:template match="foreword">
        <xsl:choose>
            <!-- L&T reference: the box 23 pt lower, its text on 20.5 pt lines (1.7), the title 25 pt in from the top rule -->
            <xsl:when test="$lref">
                <fo:block break-before="page" padding-top="23pt">
                    <fo:block border="0.8pt solid black" padding="25pt 4mm 13pt 4mm" margin-left="0mm" margin-right="0mm" line-height="20.5pt">
                        <xsl:call-template name="foreword-content"/>
                    </fo:block>
                </fo:block>
            </xsl:when>
            <xsl:otherwise>
                <fo:block break-before="page" border="0.8pt solid black" padding="4mm"
                          margin-left="0mm" margin-right="0mm">
                    <xsl:call-template name="foreword-content"/>
                </fo:block>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>

    <xsl:template name="foreword-content">
            <fo:block text-align="center" font-weight="bold" font-size="{$heading2-size}"
                      space-after="4mm">
                <xsl:if test="$lref"><xsl:attribute name="space-after">5pt</xsl:attribute><xsl:attribute name="text-decoration">underline</xsl:attribute></xsl:if>
                <xsl:call-template name="fm-heading"><xsl:with-param name="override" select="$fm.title.foreword"/><xsl:with-param name="default">FOREWORD</xsl:with-param></xsl:call-template>
            </fo:block>
            <xsl:if test="$foreword.documentNo.show != '0'">
                <fo:block space-after="4mm">
                    <xsl:if test="$lref"><xsl:attribute name="space-after">20.5pt</xsl:attribute></xsl:if>
                    <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.foreword.documentNo"/><xsl:with-param name="default">L&amp;T Document No.: </xsl:with-param></xsl:call-template>
                    <xsl:value-of select="$meta/ltDocumentNo"/>
                </fo:block>
            </xsl:if>
            <xsl:choose>
                <!-- the first paragraph indented 42 pt, 10.5 pt before the address block -->
                <xsl:when test="$lref">
                    <fo:block text-indent="42pt" space-after="10.5pt"><xsl:apply-templates select="para"/></fo:block>
                </xsl:when>
                <xsl:otherwise><xsl:apply-templates select="para"/></xsl:otherwise>
            </xsl:choose>
            <xsl:apply-templates select="deflist"/>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                         5. RECORD OF CHANGES                          -->
    <!-- ==================================================================== -->
    <xsl:template match="recordOfChanges">
        <fo:block break-before="page">
            <xsl:call-template name="page-title">
                <xsl:with-param name="text">
                    <xsl:call-template name="fm-heading">
                        <xsl:with-param name="override" select="$fm.title.recordOfChanges"/>
                        <xsl:with-param name="default">RECORD OF CHANGES</xsl:with-param>
                    </xsl:call-template>
                </xsl:with-param>
            </xsl:call-template>
            <!-- No width="100%": a percentage resolves against the containing
                 reference area, not against this table's padded, bordered
                 parent, so the table came out wider than the box that draws
                 the rule around it. Omitting it lets the table take the
                 parent's actual content width. -->
            <xsl:choose>
            <xsl:when test="$roc.layout = 'amendments'">
                <fo:table table-layout="fixed" font-size="{$fm.table.size}">
                    <fo:table-column column-width="proportional-column-width(14.7)"/>
                    <fo:table-column column-width="proportional-column-width(20.3)"/>
                    <fo:table-column column-width="proportional-column-width(30.6)"/>
                    <fo:table-column column-width="proportional-column-width(62.5)"/>
                    <fo:table-column column-width="proportional-column-width(41.8)"/>
                    <fo:table-header>
                        <fo:table-row font-weight="bold">
                            <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.amend.colSrNo"/><xsl:with-param name="default">Sr. No.</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                            <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.amend.colPage"/><xsl:with-param name="default">Page No.</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                            <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.amend.colPara"/><xsl:with-param name="default">Para Reference</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                            <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.amend.colAmendment"/><xsl:with-param name="default">Amendment / Required</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                            <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.amend.colAuthority"/><xsl:with-param name="default">Authority with Ref No. &amp; Date</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        </fo:table-row>
                    </fo:table-header>
                    <fo:table-body>
                        <xsl:call-template name="empty-rows">
                            <xsl:with-param name="count">
                                <xsl:choose>
                                    <xsl:when test="@rows"><xsl:value-of select="@rows"/></xsl:when>
                                    <xsl:otherwise>21</xsl:otherwise>
                                </xsl:choose>
                            </xsl:with-param>
                            <xsl:with-param name="cols">5</xsl:with-param>
                        </xsl:call-template>
                    </fo:table-body>
                </fo:table>
            </xsl:when>
            <xsl:otherwise>
            <fo:table table-layout="fixed" font-size="{$fm.table.size}">
                <fo:table-column column-width="proportional-column-width(1.2)"/>
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-column column-width="proportional-column-width(2.6)"/>
                <fo:table-column column-width="proportional-column-width(1.1)"/>
                <fo:table-header>
                    <fo:table-row font-weight="bold">
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.roc.colChangeNotice"/><xsl:with-param name="default">Change Notice No.</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.roc.colAuthority"/><xsl:with-param name="default">Authority</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.roc.colIncorporatedBy"/><xsl:with-param name="default">Incorporated by "Name &amp; Rank" in block letters</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.roc.colInitials"/><xsl:with-param name="default">Initials with Date</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                    </fo:table-row>
                </fo:table-header>
                <fo:table-body>
                    <fo:table-row>
                        <xsl:call-template name="roc-cell"><xsl:with-param name="t">(1)</xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-cell"><xsl:with-param name="t">(2)</xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-cell"><xsl:with-param name="t">(3)</xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-cell"><xsl:with-param name="t">(4)</xsl:with-param></xsl:call-template>
                    </fo:table-row>
                    <xsl:call-template name="empty-rows">
                        <xsl:with-param name="count">
                            <xsl:choose>
                                <xsl:when test="@rows"><xsl:value-of select="@rows"/></xsl:when>
                                <xsl:otherwise>20</xsl:otherwise>
                            </xsl:choose>
                        </xsl:with-param>
                        <xsl:with-param name="cols">4</xsl:with-param>
                    </xsl:call-template>
                </fo:table-body>
            </fo:table>
            </xsl:otherwise>
            </xsl:choose>
        </fo:block>
    </xsl:template>

    <xsl:template name="roc-head">
        <xsl:param name="t"/>
        <fo:table-cell border="0.6pt solid black" padding="1.5mm">
            <fo:block text-align="center"><xsl:value-of select="$t"/></fo:block>
        </fo:table-cell>
    </xsl:template>

    <xsl:template name="roc-cell">
        <xsl:param name="t"/>
        <fo:table-cell border="0.6pt solid black" padding="1.5mm">
            <fo:block text-align="center"><xsl:value-of select="$t"/></fo:block>
        </fo:table-cell>
    </xsl:template>

    <!-- Emits N blank ruled rows; used by the pro-forma tables -->
    <xsl:template name="empty-rows">
        <xsl:param name="count"/>
        <xsl:param name="cols"/>
        <xsl:if test="$count &gt; 0">
            <fo:table-row height="7mm">
                <xsl:call-template name="empty-cells">
                    <xsl:with-param name="cols" select="$cols"/>
                </xsl:call-template>
            </fo:table-row>
            <xsl:call-template name="empty-rows">
                <xsl:with-param name="count" select="$count - 1"/>
                <xsl:with-param name="cols" select="$cols"/>
            </xsl:call-template>
        </xsl:if>
    </xsl:template>

    <xsl:template name="empty-cells">
        <xsl:param name="cols"/>
        <xsl:if test="$cols &gt; 0">
            <fo:table-cell border="0.6pt solid black" padding="1.5mm">
                <fo:block>&#160;</fo:block>
            </fo:table-cell>
            <xsl:call-template name="empty-cells">
                <xsl:with-param name="cols" select="$cols - 1"/>
            </xsl:call-template>
        </xsl:if>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                       6. ASSOCIATED HANDBOOKS                         -->
    <!-- ==================================================================== -->
    <xsl:template match="associatedHandbooks">
        <fo:block break-before="page">
            <xsl:call-template name="page-title">
                <xsl:with-param name="text">
                    <xsl:call-template name="fm-heading">
                        <xsl:with-param name="override" select="$fm.title.associatedHandbooks"/>
                        <xsl:with-param name="default">ASSOCIATED HANDBOOKS</xsl:with-param>
                    </xsl:call-template>
                </xsl:with-param>
            </xsl:call-template>
            <fo:block space-after="3mm">
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.handbooks.introBefore"/><xsl:with-param name="default">Technical literature for </xsl:with-param></xsl:call-template>
                <fo:inline font-weight="bold">
                    <xsl:text>"</xsl:text><xsl:value-of select="$system.name"/><xsl:text>"</xsl:text>
                </fo:inline>
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.handbooks.introAfter"/><xsl:with-param name="default"> comprises of the following:</xsl:with-param></xsl:call-template>
            </fo:block>
            <fo:table table-layout="fixed" width="100%" font-size="{$fm.table.size}">
                <fo:table-column column-width="18mm"/>
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-column column-width="35mm"/>
                <fo:table-header>
                    <fo:table-row font-weight="bold">
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.handbooks.colSr"/><xsl:with-param name="default">Sr. No.</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.handbooks.colTitle"/><xsl:with-param name="default">Document Title</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.handbooks.colInbr"/><xsl:with-param name="default">INBR No.</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                    </fo:table-row>
                </fo:table-header>
                <fo:table-body>
                    <xsl:for-each select="handbook">
                        <fo:table-row>
                            <fo:table-cell border="0.6pt solid black" padding="1.5mm">
                                <fo:block text-align="center"><xsl:value-of select="@sr"/></fo:block>
                            </fo:table-cell>
                            <fo:table-cell border="0.6pt solid black" padding="1.5mm">
                                <fo:block><xsl:value-of select="title"/></fo:block>
                            </fo:table-cell>
                            <fo:table-cell border="0.6pt solid black" padding="1.5mm">
                                <fo:block><xsl:value-of select="inbr"/></fo:block>
                            </fo:table-cell>
                        </fo:table-row>
                    </xsl:for-each>
                </fo:table-body>
            </fo:table>
        </fo:block>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                          7. SAFETY WARNING                            -->
    <!-- ==================================================================== -->
    <xsl:template match="safetyWarning">
        <fo:block break-before="page">
            <xsl:call-template name="red-box">
                <xsl:with-param name="align">center</xsl:with-param>
                <xsl:with-param name="content">
                    <fo:block font-weight="bold" font-size="{$heading2-size}" space-after="4mm"
                              text-decoration="underline">
                        <xsl:if test="$lref"><xsl:attribute name="space-after">14.3pt</xsl:attribute></xsl:if>
                        <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.safety.heading"/><xsl:with-param name="default">SAFETY WARNING</xsl:with-param></xsl:call-template>
                    </fo:block>
                    <xsl:for-each select="line">
                        <fo:block>
                            <xsl:if test="@emphasis = 'strong' or $lref">
                                <xsl:attribute name="font-weight">bold</xsl:attribute>
                            </xsl:if>
                            <xsl:if test="@space-before">
                                <xsl:attribute name="space-before"><xsl:value-of select="@space-before"/></xsl:attribute>
                                <!-- the reference leaves two blank lines between the groups: 10 pt more than the stencil's 6 mm -->
                                <xsl:if test="$lref"><xsl:attribute name="padding-top">10pt</xsl:attribute></xsl:if>
                            </xsl:if>
                            <xsl:apply-templates/>
                        </fo:block>
                    </xsl:for-each>
                </xsl:with-param>
            </xsl:call-template>
            <xsl:if test="$safety.footer.show != '0'">
            <fo:block text-align="center" font-weight="bold" text-decoration="underline">
                <xsl:if test="$lref"><xsl:attribute name="color">black</xsl:attribute></xsl:if>
                <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.safety.footer"/><xsl:with-param name="default">FOR FIRST AID IN CASE OF ELECTRIC SHOCK SEE THE FOLLOWING PAGE</xsl:with-param></xsl:call-template>
            </fo:block>
            </xsl:if>
        </fo:block>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--             8. FIRST AID IN CASE OF ELECTRIC SHOCK                    -->
    <!-- ==================================================================== -->
    <xsl:template match="firstAid">
        <fo:block break-before="page">
            <xsl:call-template name="page-title">
                <xsl:with-param name="color" select="$red.color"/>
                <xsl:with-param name="text">
                    <xsl:call-template name="fm-heading">
                        <xsl:with-param name="override" select="$fm.title.firstAid"/>
                        <xsl:with-param name="default">FIRST AID IN CASE OF ELECTRIC SHOCK</xsl:with-param>
                    </xsl:call-template>
                </xsl:with-param>
            </xsl:call-template>
            <!--
              As in the stencil: the single illustration on the left (it already
              carries all four figures and their labels), unruled, with the
              numbered steps ruled as a grid on the right. The image cell spans
              every step row plus the closing row.

              The rule belongs to the step grid itself, NOT to a wrapper block
              around the whole page. Wrapping it meant a width="100%" table
              inside a padded, bordered block — and a percentage width resolves
              against the containing reference area, not against that padded
              parent, so the table came out wider than the box drawing the rule
              and punched straight through it (six FOP overflow warnings on this
              page alone). Letting the cells carry the border removes the
              nesting the two disagreed about.
            -->
            <fo:table table-layout="fixed" width="100%" font-size="{$fm.table.size}">
                <!-- The artwork column follows the artwork, plus its 2mm gutter.
                     Fixed at 36mm it did not: narrowing the picture left a
                     36mm hole instead of giving the step text more width, so
                     the image-width setting appeared to do nothing. -->
                <fo:table-column column-width="{concat($firstaid.image.width, ' + 4mm')}"/>
                <fo:table-column column-width="8mm"/>
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-body>
                    <xsl:for-each select="step">
                        <fo:table-row>
                            <!-- Emitted once, on the first row, spanning the rest.
                                 The span includes the closing row so that the
                                 closing statement can start in column 2 and stay
                                 inside the ruled grid instead of running under
                                 the artwork. -->
                            <xsl:if test="position() = 1">
                                <fo:table-cell padding-right="2mm" display-align="before"
                                               number-rows-spanned="{count(../step) + count(../closing)}">
                                    <fo:block>
                                        <!-- Settings win over the stencil's default src, so a
                                             project can supply its own artwork without editing
                                             the shipped stencil. -->
                                        <xsl:variable name="src">
                                            <xsl:choose>
                                                <xsl:when test="$firstaid.image != ''"><xsl:value-of select="$firstaid.image"/></xsl:when>
                                                <xsl:otherwise><xsl:value-of select="../figure/@src"/></xsl:otherwise>
                                            </xsl:choose>
                                        </xsl:variable>
                                        <xsl:if test="$src != ''">
                                            <!--
                                              Sized to FILL the page, not to a fixed 32mm width.
                                              This artwork is a tall strip (about 1:3.6) and its
                                              cell spans every row, so it is what sets the height
                                              of the whole block: at 32mm wide it came out 115mm
                                              tall and left the bottom third of the page empty.
                                              Both dimensions are given and the scaling is uniform,
                                              so the picture grows as large as fits inside them and
                                              keeps its proportions whatever artwork is supplied.
                                            -->
                                            <fo:external-graphic src="url('{$src}')"
                                                                 width="{$firstaid.image.width}"
                                                                 height="{$firstaid.image.height}"
                                                                 content-width="scale-to-fit"
                                                                 content-height="scale-to-fit"
                                                                 scaling="uniform"/>
                                        </xsl:if>
                                    </fo:block>
                                </fo:table-cell>
                            </xsl:if>
                            <fo:table-cell padding="1.5mm" border="0.6pt solid black"
                                           display-align="before">
                                <fo:block><xsl:value-of select="position()"/><xsl:text>.</xsl:text></fo:block>
                            </fo:table-cell>
                            <fo:table-cell padding="1.5mm" border="0.6pt solid black">
                                <xsl:apply-templates select="para"/>
                            </fo:table-cell>
                        </fo:table-row>
                    </xsl:for-each>
                    <xsl:if test="closing">
                        <fo:table-row>
                            <!-- Columns 2-3 only: column 1 is still covered by the
                                 artwork's row span above. -->
                            <fo:table-cell number-columns-spanned="2" padding="1.5mm"
                                           border="0.6pt solid black">
                                <fo:block font-weight="bold" text-align="justify">
                                    <xsl:value-of select="closing"/>
                                </fo:block>
                            </fo:table-cell>
                        </fo:table-row>
                    </xsl:if>
                </fo:table-body>
            </fo:table>
        </fo:block>
    </xsl:template>

    <!-- First-aid step paragraphs are justified, as in the stencil -->
    <xsl:template match="step/para">
        <fo:block space-after="1.5mm" text-align="justify"><xsl:apply-templates/></fo:block>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                          9. CAUTIONS / NOTES                          -->
    <!-- ==================================================================== -->
    <xsl:template match="cautionsNotes">
        <fo:block break-before="page">
            <xsl:call-template name="red-box">
                <xsl:with-param name="content">
                    <fo:block text-align="center" font-weight="bold" font-size="{$heading2-size}"
                              space-after="4mm" text-decoration="underline">
                        <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.cautions.heading"/><xsl:with-param name="default">CAUTIONS/ NOTES</xsl:with-param></xsl:call-template>
                    </fo:block>
                    <!-- A page with no items (the MM and ORM stencils' Cautions / Notes page is a title only) has no list: fo:list-block must contain a list-item, so an empty one
                         used to fail the whole build. Pages that have items are unchanged. -->
                    <xsl:if test="item">
                    <fo:list-block provisional-distance-between-starts="10mm"
                                   provisional-label-separation="2mm">
                        <xsl:for-each select="item">
                            <fo:list-item space-after="2mm">
                                <fo:list-item-label end-indent="label-end()">
                                    <fo:block font-weight="bold">
                                        <xsl:value-of select="position()"/><xsl:text>.</xsl:text>
                                    </fo:block>
                                </fo:list-item-label>
                                <fo:list-item-body start-indent="body-start()">
                                    <fo:block font-weight="bold"><xsl:apply-templates/></fo:block>
                                </fo:list-item-body>
                            </fo:list-item>
                        </xsl:for-each>
                    </fo:list-block>
                    </xsl:if>
                </xsl:with-param>
            </xsl:call-template>
        </fo:block>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--            10. DEMOLITION OF MATERIAL TO PREVENT ENEMY USE            -->
    <!-- ==================================================================== -->
    <xsl:template match="demolition">
        <fo:block break-before="page">
            <xsl:call-template name="red-box">
                <xsl:with-param name="content">
                    <fo:block text-align="center" font-weight="bold" font-size="{$heading2-size}"
                              space-after="4mm" text-decoration="underline">
                        <xsl:call-template name="fm-heading"><xsl:with-param name="override" select="$fm.title.demolition"/><xsl:with-param name="default">DEMOLITION OF MATERIAL TO PREVENT ENEMY USE</xsl:with-param></xsl:call-template>
                    </fo:block>
                    <xsl:for-each select="part">
                        <fo:block font-weight="bold" space-before="3mm" space-after="1mm">
                            <xsl:text>(</xsl:text>
                            <xsl:call-template name="jss-alpha">
                                <xsl:with-param name="n" select="position()"/>
                            </xsl:call-template>
                            <xsl:text>)&#160;&#160;</xsl:text>
                            <xsl:value-of select="title"/>
                        </fo:block>
                        <fo:block margin-left="8mm">
                            <xsl:apply-templates select="*[not(self::title)]"/>
                        </fo:block>
                    </xsl:for-each>
                </xsl:with-param>
            </xsl:call-template>
        </fo:block>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                          11. CHANGE NOTICE                            -->
    <!-- ==================================================================== -->
    <xsl:template match="changeNotice">
        <xsl:choose>
        <xsl:when test="$changenotice.layout = 'grid'"><xsl:call-template name="change-notice-grid"/></xsl:when>
        <xsl:otherwise>
        <fo:block break-before="page">
            <xsl:call-template name="page-title">
                <xsl:with-param name="text">
                    <xsl:call-template name="fm-heading">
                        <xsl:with-param name="override" select="$fm.title.changeNotice"/>
                        <xsl:with-param name="default">CHANGE NOTICE</xsl:with-param>
                    </xsl:call-template>
                </xsl:with-param>
            </xsl:call-template>
            <xsl:if test="$meta/publishers/publisher[1]/logo/@src">
                <fo:block space-after="3mm">
                    <fo:external-graphic src="url('{$meta/publishers/publisher[1]/logo/@src}')"
                                         content-height="10mm" scaling="uniform"/>
                    <fo:inline font-weight="bold" font-style="italic" font-size="{$heading2-size}">
                        <xsl:text>  </xsl:text>
                        <xsl:value-of select="$meta/publishers/publisher[1]/name"/>
                    </fo:inline>
                </fo:block>
            </xsl:if>

            <fo:table table-layout="fixed" width="100%" font-size="{$fm.table.size}" space-after="6mm">
                <fo:table-column column-width="proportional-column-width(1.3)"/>
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-column column-width="proportional-column-width(1.2)"/>
                <fo:table-header>
                    <!-- Header words are long relative to the column width, so
                         this row is set a step smaller to avoid overflow. -->
                    <fo:table-row font-weight="bold" font-size="8.5pt">
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.change.colTitle"/><xsl:with-param name="default">TITLE OF PUBLICATION</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.change.colCode"/><xsl:with-param name="default">CODE NO. AND DATE</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.change.colPrevious"/><xsl:with-param name="default">PREVIOUS CHANGE</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.change.colNoticeNo"/><xsl:with-param name="default">CHANGE NOTICE NO. AND DATE</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                    </fo:table-row>
                </fo:table-header>
                <fo:table-body>
                    <xsl:call-template name="empty-rows">
                        <xsl:with-param name="count">
                            <xsl:choose>
                                <xsl:when test="@rows"><xsl:value-of select="@rows"/></xsl:when>
                                <xsl:otherwise>3</xsl:otherwise>
                            </xsl:choose>
                        </xsl:with-param>
                        <xsl:with-param name="cols">4</xsl:with-param>
                    </xsl:call-template>
                </fo:table-body>
            </fo:table>

            <fo:block text-align="right" space-after="6mm">
                <fo:block>No. of Pages&#160;&#160;:</fo:block>
                <fo:block>No. of Sheets&#160;:</fo:block>
                <fo:block>Enclosures&#160;&#160;&#160;&#160;:</fo:block>
            </fo:block>

            <fo:table table-layout="fixed" width="100%" font-size="{$fm.table.size}">
                <fo:table-column column-width="proportional-column-width(1.6)"/>
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-body>
                    <fo:table-row>
                        <fo:table-cell border="0.6pt solid black" padding="2mm">
                            <fo:block font-weight="bold" space-after="2mm">CODES FOR INCORPORATION OF CHANGES:</fo:block>
                            <fo:block space-after="1.5mm"><fo:inline font-weight="bold">(R)</fo:inline> By Replacement/ addition of sheet(s)</fo:block>
                            <fo:block space-after="1.5mm"><fo:inline font-weight="bold">(H)</fo:inline> By Hand-correction</fo:block>
                            <fo:block space-after="1.5mm"><fo:inline font-weight="bold">(P)</fo:inline> By pasting the enclosed matter</fo:block>
                            <fo:block><fo:inline font-weight="bold">(A)</fo:inline> Additional information - only to be filed in the publication</fo:block>
                        </fo:table-cell>
                        <fo:table-cell border="0.6pt solid black" padding="2mm">
                            <fo:block font-weight="bold" space-after="2mm">NOTE:</fo:block>
                            <fo:block>This document should be filed/ pasted in the copy of the Publication before the CONTENTS Page. After carrying out (R), (H) or (P) entry should be made in Record of Changes Page.</fo:block>
                        </fo:table-cell>
                    </fo:table-row>
                </fo:table-body>
            </fo:table>
        </fo:block>
        </xsl:otherwise>
        </xsl:choose>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--   11b. CHANGE NOTICE, grid layout (changenotice.layout = grid)        -->
    <!-- Measured on the L&T User Handbook page: Arial 12 pt, a 1 pt rule on every line, columns 334 : 200 : 153 : 236, a 40 pt header row and rows of 22.3 pt   -->
    <!-- (15 of them by the owner's request of 2026-11-26, the row height unchanged and what follows pushed down), the Pages line over the Enclosures / Sheets line, -->
    <!-- a 178 pt box split 69.5 : 30.5 (the codes and the note, justified). The letterhead is the publisher's logo alone: no name beside it.                  -->
    <!-- ==================================================================== -->
    <xsl:template name="change-notice-grid">
        <xsl:variable name="rule">1pt solid black</xsl:variable>
        <xsl:variable name="logo" select="$meta/publishers/publisher[1]/logo/@src"/>
        <fo:block break-before="page" font-size="12pt">
            <xsl:if test="$restricted.scope = 'reference'"><xsl:call-template name="classification-banner"/></xsl:if>
            <fo:block text-align="center" font-size="{$heading2-size}" font-weight="bold" padding-top="7.3pt" space-after="0pt" keep-with-next.within-page="always">
                <xsl:if test="$lref"><xsl:attribute name="text-decoration">underline</xsl:attribute></xsl:if>
                <xsl:call-template name="fm-heading">
                    <xsl:with-param name="override" select="$fm.title.changeNotice"/>
                    <xsl:with-param name="default">CHANGE NOTICE</xsl:with-param>
                </xsl:call-template>
            </fo:block>
            <!-- the publisher letterhead: the publisher's logo, and nothing beside it -->
            <xsl:if test="$logo">
                <fo:block start-indent="9pt" space-before="-9pt" space-after="{$cn.logo.gap}" line-height="{$cn.logo.height}">
                    <fo:external-graphic src="url('{$logo}')" content-height="{$cn.logo.height}" scaling="uniform"/>
                </fo:block>
            </xsl:if>

            <fo:table table-layout="fixed" width="100%" border-collapse="collapse">
                <fo:table-column column-width="proportional-column-width(334)"/>
                <fo:table-column column-width="proportional-column-width(200)"/>
                <fo:table-column column-width="proportional-column-width(153)"/>
                <fo:table-column column-width="proportional-column-width(236)"/>
                <fo:table-header>
                    <fo:table-row height="37.6pt" font-weight="bold" line-height="17.3pt">
                        <fo:table-cell border="{$rule}" padding="1.2pt 3.5pt 0 3.5pt" display-align="before"><fo:block>
                            <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.change.colTitle"/><xsl:with-param name="default">TITLE OF PUBLICATION</xsl:with-param></xsl:call-template>
                        </fo:block></fo:table-cell>
                        <fo:table-cell border="{$rule}" padding="1.2pt 3.5pt 0 3.5pt" display-align="before"><fo:block>
                            <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.change.colCode"/><xsl:with-param name="default">CODE No. AND DATE</xsl:with-param></xsl:call-template>
                        </fo:block></fo:table-cell>
                        <fo:table-cell border="{$rule}" padding="1.2pt 3.5pt 0 3.5pt" display-align="before"><fo:block>
                            <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.change.colPrevious"/><xsl:with-param name="default">PREVIOUS CHANGE</xsl:with-param></xsl:call-template>
                        </fo:block></fo:table-cell>
                        <fo:table-cell border="{$rule}" padding="1.2pt 3.5pt 0 3.5pt" display-align="before"><fo:block>
                            <xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.change.colNoticeNo"/><xsl:with-param name="default">CHANGE NOTICE No. AND DATE</xsl:with-param></xsl:call-template>
                        </fo:block></fo:table-cell>
                    </fo:table-row>
                </fo:table-header>
                <fo:table-body>
                    <xsl:call-template name="change-notice-grid-rows"><xsl:with-param name="count" select="15"/></xsl:call-template>
                </fo:table-body>
            </fo:table>

            <!-- the Pages line over the Enclosures / Sheets line: the colons end where the pro-forma has them -->
            <fo:table table-layout="fixed" width="100%" space-before="20.8pt">
                <fo:table-column column-width="305pt"/>
                <fo:table-column column-width="137pt"/>
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-body>
                    <fo:table-row height="22.9pt">
                        <fo:table-cell display-align="center"><fo:block>&#160;</fo:block></fo:table-cell>
                        <fo:table-cell display-align="center"><fo:block text-align="right">No. of Pages:</fo:block></fo:table-cell>
                        <fo:table-cell><fo:block>&#160;</fo:block></fo:table-cell>
                    </fo:table-row>
                    <fo:table-row height="22.9pt">
                        <fo:table-cell display-align="center"><fo:block text-align="right">Enclosures:</fo:block></fo:table-cell>
                        <fo:table-cell display-align="center"><fo:block text-align="right">Sheets:</fo:block></fo:table-cell>
                        <fo:table-cell><fo:block>&#160;</fo:block></fo:table-cell>
                    </fo:table-row>
                </fo:table-body>
            </fo:table>

            <fo:table table-layout="fixed" width="100%" space-before="8.8pt" border-collapse="collapse">
                <fo:table-column column-width="proportional-column-width(695)"/>
                <fo:table-column column-width="proportional-column-width(305)"/>
                <fo:table-body>
                    <fo:table-row height="175.8pt">
                        <fo:table-cell border="{$rule}" padding="1.7pt 4.2pt 0 4.2pt">
                            <fo:block font-weight="bold">CODES FOR INCORPORATION OF CHANGES:</fo:block>
                            <fo:list-block provisional-distance-between-starts="24.5pt" provisional-label-separation="0pt">
                                <xsl:call-template name="change-notice-code"><xsl:with-param name="code">(R)</xsl:with-param><xsl:with-param name="text">By Replacement/addition of sheet(s)</xsl:with-param><xsl:with-param name="before">25.8pt</xsl:with-param></xsl:call-template>
                                <xsl:call-template name="change-notice-code"><xsl:with-param name="code">(H)</xsl:with-param><xsl:with-param name="text">By Hand-correction</xsl:with-param></xsl:call-template>
                                <xsl:call-template name="change-notice-code"><xsl:with-param name="code">(P)</xsl:with-param><xsl:with-param name="text">By pasting the enclosed matter</xsl:with-param></xsl:call-template>
                                <xsl:call-template name="change-notice-code"><xsl:with-param name="code">(A)</xsl:with-param><xsl:with-param name="text">Additional information - only to be filed in the publication</xsl:with-param><xsl:with-param name="before">23.4pt</xsl:with-param></xsl:call-template>
                            </fo:list-block>
                        </fo:table-cell>
                        <fo:table-cell border="{$rule}" padding="1.7pt 6pt 0 5.8pt">
                            <fo:block font-weight="bold">NOTE:</fo:block>
                            <fo:block text-align="justify" line-height="14.3pt" space-before="7pt">This document should be filed pasted in the copy of the Publication before the CONTENTS Page. After carrying out (R), (H) or (P) entry should be made in Record of Changes Page.</fo:block>
                        </fo:table-cell>
                    </fo:table-row>
                </fo:table-body>
            </fo:table>
            <xsl:if test="$restricted.scope = 'reference'"><fo:block space-before="10pt"><xsl:call-template name="classification-banner"/></fo:block></xsl:if>
        </fo:block>
    </xsl:template>

    <xsl:template name="change-notice-grid-rows">
        <xsl:param name="count"/>
        <xsl:if test="$count &gt; 0">
            <fo:table-row height="21.3pt">
                <fo:table-cell border="1pt solid black"><fo:block>&#160;</fo:block></fo:table-cell>
                <fo:table-cell border="1pt solid black"><fo:block>&#160;</fo:block></fo:table-cell>
                <fo:table-cell border="1pt solid black"><fo:block>&#160;</fo:block></fo:table-cell>
                <fo:table-cell border="1pt solid black"><fo:block>&#160;</fo:block></fo:table-cell>
            </fo:table-row>
            <xsl:call-template name="change-notice-grid-rows"><xsl:with-param name="count" select="$count - 1"/></xsl:call-template>
        </xsl:if>
    </xsl:template>

    <xsl:template name="change-notice-code">
        <xsl:param name="code"/>
        <xsl:param name="text"/>
        <xsl:param name="before">22.8pt</xsl:param>
        <fo:list-item space-before="{$before}">
            <fo:list-item-label end-indent="label-end()"><fo:block font-weight="bold" font-size="10.5pt"><xsl:value-of select="$code"/></fo:block></fo:list-item-label>
            <fo:list-item-body start-indent="body-start()"><fo:block><xsl:value-of select="$text"/></fo:block></fo:list-item-body>
        </fo:list-item>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                      12. LIST OF ABBREVIATIONS                        -->
    <!-- ==================================================================== -->
    <xsl:template match="listOfAbbreviations">
        <fo:block break-before="page">
            <xsl:call-template name="page-title">
                <xsl:with-param name="text">
                    <xsl:call-template name="fm-heading">
                        <xsl:with-param name="override" select="$fm.title.listOfAbbreviations"/>
                        <xsl:with-param name="default">LIST OF ABBREVIATIONS</xsl:with-param>
                    </xsl:call-template>
                </xsl:with-param>
            </xsl:call-template>
            <xsl:choose>
            <xsl:when test="$abbrev.layout = 'numbered'">
                <fo:table table-layout="fixed" width="100%" font-size="{$fm.table.size}">
                    <fo:table-column column-width="proportional-column-width(22.5)"/>
                    <fo:table-column column-width="proportional-column-width(40)"/>
                    <fo:table-column column-width="proportional-column-width(107.5)"/>
                    <fo:table-header>
                        <fo:table-row font-weight="bold">
                            <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.abbrev.colSrNo"/><xsl:with-param name="default">Sr. No.</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                            <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.abbrev.colIssued"/><xsl:with-param name="default">Abbreviations issued</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                            <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.abbrev.colFor"/><xsl:with-param name="default">For</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        </fo:table-row>
                    </fo:table-header>
                    <fo:table-body>
                        <xsl:choose>
                            <xsl:when test="abbreviation">
                                <xsl:for-each select="abbreviation">
                                    <xsl:sort select="translate(@term, $lower, $upper)"/>
                                    <fo:table-row>
                                        <fo:table-cell border="0.6pt solid black" padding="1.5mm">
                                            <fo:block text-align="center"><xsl:value-of select="position()"/></fo:block>
                                        </fo:table-cell>
                                        <fo:table-cell border="0.6pt solid black" padding="1.5mm">
                                            <fo:block font-weight="bold"><xsl:value-of select="@term"/></fo:block>
                                        </fo:table-cell>
                                        <fo:table-cell border="0.6pt solid black" padding="1.5mm">
                                            <fo:block><xsl:value-of select="."/></fo:block>
                                        </fo:table-cell>
                                    </fo:table-row>
                                </xsl:for-each>
                            </xsl:when>
                            <xsl:otherwise>
                                <xsl:call-template name="empty-rows">
                                    <xsl:with-param name="count">16</xsl:with-param>
                                    <xsl:with-param name="cols">3</xsl:with-param>
                                </xsl:call-template>
                            </xsl:otherwise>
                        </xsl:choose>
                    </fo:table-body>
                </fo:table>
            </xsl:when>
            <xsl:otherwise>
            <fo:table table-layout="fixed" width="100%" font-size="{$fm.table.size}">
                <fo:table-column column-width="50mm"/>
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-header>
                    <fo:table-row font-weight="bold">
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.abbrev.colTerm"/><xsl:with-param name="default">Abbreviations</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                        <xsl:call-template name="roc-head"><xsl:with-param name="t"><xsl:call-template name="fm-label"><xsl:with-param name="override" select="$fm.label.abbrev.colMeaning"/><xsl:with-param name="default">Description</xsl:with-param></xsl:call-template></xsl:with-param></xsl:call-template>
                    </fo:table-row>
                </fo:table-header>
                <fo:table-body>
                    <xsl:choose>
                        <xsl:when test="abbreviation">
                            <!--
                              Alphabetical, not as authored. A list of
                              abbreviations is looked things up in, never read
                              through, so the only order that helps a reader is
                              the one they can search by eye.

                              Sorted on the term folded to capitals, because
                              XSLT 1.0 sorts by code point: unfolded, every
                              lower-case term would file after every upper-case
                              one and "mm" would sit below "ZZ".
                            -->
                            <xsl:for-each select="abbreviation">
                                <xsl:sort select="translate(@term, $lower, $upper)"/>
                                <fo:table-row>
                                    <fo:table-cell border="0.6pt solid black" padding="1.5mm">
                                        <fo:block font-weight="bold"><xsl:value-of select="@term"/></fo:block>
                                    </fo:table-cell>
                                    <fo:table-cell border="0.6pt solid black" padding="1.5mm">
                                        <fo:block><xsl:value-of select="."/></fo:block>
                                    </fo:table-cell>
                                </fo:table-row>
                            </xsl:for-each>
                        </xsl:when>
                        <xsl:otherwise>
                            <xsl:call-template name="empty-rows">
                                <xsl:with-param name="count">9</xsl:with-param>
                                <xsl:with-param name="cols">2</xsl:with-param>
                            </xsl:call-template>
                        </xsl:otherwise>
                    </xsl:choose>
                </fo:table-body>
            </fo:table>
            </xsl:otherwise>
            </xsl:choose>
        </fo:block>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                        13. SYSTEM NAME PAGE                           -->
    <!-- ==================================================================== -->
    <xsl:template match="systemNamePage">
        <fo:block break-before="page">
            <xsl:call-template name="page-title">
                <xsl:with-param name="text" select="translate($system.name, $lower, $upper)"/>
            </xsl:call-template>
            <xsl:choose>
                <!--
                  Drawn here rather than handed to the graphic template,
                  which bounds a picture by the FIGURE caps — the limits meant
                  for illustrations inside the text. A system illustration is
                  a page of its own and usually wants to be larger, so it has
                  its own bounds, defaulting to the figure caps so an
                  untouched project looks exactly as it did.

                  Bounds, not sizes: scaling stays uniform, so several
                  pictures of different shapes each grow as large as fit and
                  keep their proportions.
                -->
                <xsl:when test="graphic/@src">
                    <xsl:for-each select="graphic">
                        <fo:block text-align="center" space-after="4mm">
                            <!-- Both dimensions given, not a max-height:
                                 max-height caps the viewport and not the
                                 picture, which FOP then draws past the box
                                 and over whatever follows. -->
                            <fo:external-graphic src="url('{@src}')"
                                                 width="{$systemimage.max.width}"
                                                 height="{$systemimage.max.height}"
                                                 content-width="scale-down-to-fit"
                                                 content-height="scale-down-to-fit"
                                                 scaling="uniform"/>
                        </fo:block>
                    </xsl:for-each>
                </xsl:when>
                <xsl:when test="figure | graphic | image">
                    <xsl:apply-templates select="figure | graphic | image"/>
                </xsl:when>
                <xsl:otherwise>
                    <!-- Empty ruled frame reserving the system illustration area -->
                    <fo:block-container height="200mm" border="0.8pt solid black">
                        <fo:block/>
                    </fo:block-container>
                </xsl:otherwise>
            </xsl:choose>
        </fo:block>
    </xsl:template>

    <!-- ==================================================================== -->
    <!--                     14. DESCRIPTION OF SYMBOLS                        -->
    <!-- ==================================================================== -->
    <!--
      Two-column page: hazard symbols on the left, notice-box legends on the
      right, exactly as the stencil lays it out.
    -->
    <xsl:template match="descriptionOfSymbols">
        <fo:block break-before="page">
            <xsl:call-template name="page-title">
                <xsl:with-param name="text">
                    <xsl:call-template name="fm-heading">
                        <xsl:with-param name="override" select="$fm.title.descriptionOfSymbols"/>
                        <xsl:with-param name="default">DESCRIPTION OF SYMBOLS</xsl:with-param>
                    </xsl:call-template>
                </xsl:with-param>
            </xsl:call-template>
            <fo:table table-layout="fixed" width="100%">
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-column column-width="6mm"/>
                <fo:table-column column-width="proportional-column-width(1)"/>
                <fo:table-body>
                    <fo:table-row>
                        <!-- Left column: hazard symbols. A project with no symbols
                             (e.g. a software SOP) must still emit a block here, or
                             the table-cell is left childless, which FOP rejects. -->
                        <fo:table-cell>
                            <xsl:choose>
                                <xsl:when test="symbolList/symbol">
                                    <xsl:for-each select="symbolList/symbol">
                                        <fo:block space-after="4mm">
                                            <fo:table table-layout="fixed" width="100%">
                                                <fo:table-column column-width="14mm"/>
                                                <fo:table-column column-width="proportional-column-width(1)"/>
                                                <fo:table-body>
                                                    <fo:table-row>
                                                        <fo:table-cell display-align="center">
                                                            <fo:block>
                                                                <xsl:choose>
                                                                    <xsl:when test="@src">
                                                                        <fo:external-graphic src="url('{@src}')"
                                                                                             content-width="10mm"
                                                                                             scaling="uniform"/>
                                                                    </xsl:when>
                                                                    <xsl:otherwise>
                                                                        <fo:block-container height="10mm" width="10mm"
                                                                                            border="0.6pt solid black">
                                                                            <fo:block/>
                                                                        </fo:block-container>
                                                                    </xsl:otherwise>
                                                                </xsl:choose>
                                                            </fo:block>
                                                        </fo:table-cell>
                                                        <fo:table-cell display-align="center" padding-left="2mm">
                                                            <fo:block font-size="{$fm.table.size}">
                                                                <xsl:apply-templates/>
                                                            </fo:block>
                                                        </fo:table-cell>
                                                    </fo:table-row>
                                                </fo:table-body>
                                            </fo:table>
                                        </fo:block>
                                    </xsl:for-each>
                                </xsl:when>
                                <xsl:otherwise><fo:block/></xsl:otherwise>
                            </xsl:choose>
                        </fo:table-cell>

                        <fo:table-cell><fo:block/></fo:table-cell>

                        <!-- Right column: NOTE / WARNING / CAUTION legends -->
                        <fo:table-cell>
                            <xsl:apply-templates select="noticeList/*"/>
                        </fo:table-cell>
                    </fo:table-row>
                </fo:table-body>
            </fo:table>
        </fo:block>
    </xsl:template>

</xsl:stylesheet>
