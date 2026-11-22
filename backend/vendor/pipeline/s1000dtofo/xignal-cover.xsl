<?xml version="1.0" encoding="UTF-8"?>
<!-- ********************************************************************
     S1000D to XSL-FO: the Xignal cover — the publication's title-page DATA MODULE printed as page 1.

     In the Xignal / Docuneering reference (RDR-1671Y-00039-00) the first page of the book is not a page built from the
     publication module's metadata: it is the title-page data module itself (infoCode 001, <frontMatterTitlePage>), printed
     with the ordinary data-module head and foot. It is listed once in the contents ("Title page") and is NOT printed a second
     time in the body.

     Active only when $layout.profile = 'xignal' AND the S1000D front-matter style is in use AND the publication's first data
     module is such a title page. When it is not (a publication whose first module is something else), the page the engine
     generates from the publication module (frontmatter-s1000d.xsl, s1000d-title-page-generated) is set with these same
     parameters, so the two covers have one size and one spacing; any other layout profile prints the page it always did.

     Geometry, measured on the reference (A4 portrait, points; the head/foot are the profile's own):
       publication title   24 pt bold, line 1.2, left
       publication code    14 pt bold, 29 pt under the title
       issue line          14 pt bold, "Issue No. nnn, yyyy-mm-dd" — the PUBLICATION's date (the title module's own date is
                           older and is not what the reference prints)
       product picture     174.2 mm wide, centred on the text block (4.2 mm wider than it), 14.6 pt under the issue line's baseline
       "Publisher:"        8 pt, then the publisher's logo 30 mm wide
     The company name is printed only when there is no logo to carry it (the reference prints the logo alone, although S1000D requires the
     title page to name its publisher - BREX-S1-00113 - so a valid title page always has a name in its data).

     The product picture is an anchor (cover-picture-<module>): the List of illustrations has a row for it that jumps here.
     The publisher's logo is the title page's own (<publisherLogo>), else the platform's default publisher logo ($publisher.logo.uri,
     supplied by the build like the default header logo; a project can switch it off). Both covers print it through
     xs-cover-publisher below.
     ******************************************************************** -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">

  <xsl:param name="xs.cover.title.size">24pt</xsl:param>
  <xsl:param name="xs.cover.sub.size">14pt</xsl:param>
  <xsl:param name="xs.cover.top">28.3pt</xsl:param>
  <xsl:param name="xs.cover.code.gap">28.45pt</xsl:param>
  <xsl:param name="xs.cover.issue.gap">8.5pt</xsl:param>
  <xsl:param name="xs.cover.image.gap">8.5pt</xsl:param>
  <xsl:param name="xs.cover.image.width">174.2mm</xsl:param>
  <xsl:param name="xs.cover.image.overhang">2.1mm</xsl:param>
  <xsl:param name="xs.cover.publisher.gap">11.3pt</xsl:param>
  <xsl:param name="xs.cover.logo.gap">0.9pt</xsl:param>
  <xsl:param name="xs.cover.logo.width">30mm</xsl:param>
  <!-- The platform's default publisher logo: a path relative to the project folder, empty = none. Used only where no logo of the
       publication's own is given. -->
  <xsl:param name="publisher.logo.uri" select="''"/>

  <!-- The cover is wanted at all: the profile, the S1000D prelims. -->
  <xsl:variable name="xs.cover.on" select="$layout.profile = 'xignal' and $frontmatter.style = 's1000d'"/>

  <!--
    The title-page module of one publication module: the module its FIRST data-module reference points at, when that module
    carries a <frontMatterTitlePage>. Returns that module's generate-id, or nothing. (Keyed on the reference, not on "the first
    title page in the file", so a nested publication module never borrows its parent's cover.)
  -->
  <xsl:template name="xs-cover-id">
    <xsl:param name="pm" select="."/>
    <xsl:if test="$xs.cover.on">
      <!-- The publication's first data module, in document order: a module the build has inlined in its place (what this application's
           resolved publication does) or a reference to one (a hand-written publication module). -->
      <xsl:variable name="first" select="($pm/content//dmodule | $pm/content//dmRef)[1]"/>
      <xsl:choose>
        <xsl:when test="$first/self::dmodule">
          <xsl:if test="$first/content/frontMatter/frontMatterTitlePage"><xsl:value-of select="generate-id($first)"/></xsl:if>
        </xsl:when>
        <xsl:when test="$first/self::dmRef">
          <xsl:variable name="code">
            <xsl:apply-templates select="$first/dmRefIdent/identExtension"/>
            <xsl:apply-templates select="$first/dmRefIdent/dmCode"/>
          </xsl:variable>
          <xsl:for-each select="$all.dmodules[content/frontMatter/frontMatterTitlePage]">
            <xsl:variable name="c"><xsl:call-template name="get.dmcode"/></xsl:variable>
            <xsl:if test="$c = $code"><xsl:value-of select="generate-id(.)"/></xsl:if>
          </xsl:for-each>
        </xsl:when>
      </xsl:choose>
    </xsl:if>
  </xsl:template>

  <!-- The title-page module itself (a node-set of 0 or 1), for the template above's answer. -->
  <xsl:template name="xs-cover-dm">
    <xsl:param name="pm" select="."/>
    <xsl:variable name="id"><xsl:call-template name="xs-cover-id"><xsl:with-param name="pm" select="$pm"/></xsl:call-template></xsl:variable>
    <xsl:if test="$id != ''">
      <xsl:for-each select="$all.dmodules[generate-id(.) = $id]">
        <xsl:apply-templates select="." mode="xs-cover"/>
      </xsl:for-each>
    </xsl:if>
  </xsl:template>

  <!-- The page: its own page sequence, numbered from 1, with the data module's own head and foot. -->
  <xsl:template match="dmodule" mode="xs-cover">
    <xsl:call-template name="page-sequence">
      <xsl:with-param name="last" select="1"/>
      <xsl:with-param name="first" select="1"/>
      <xsl:with-param name="content">
        <!-- The same anchor every data module carries, so the contents link, its page number and the PDF bookmark find the cover. -->
        <fo:block id="content-start-{generate-id()}">
          <xsl:call-template name="generate-markers"/>
          <xsl:apply-templates select="content/frontMatter/frontMatterTitlePage" mode="xs-cover"/>
          <fo:block>
            <xsl:call-template name="end-of-datamodule-marker"/>
          </fo:block>
        </fo:block>
      </xsl:with-param>
    </xsl:call-template>
  </xsl:template>

  <!-- Where a picture's file is: the entity the module declares, else the file the build found by ICN. -->
  <xsl:template name="xs-icn-src">
    <xsl:param name="icn"/>
    <xsl:variable name="uri" select="unparsed-entity-uri($icn)"/>
    <xsl:choose>
      <xsl:when test="$uri != ''"><xsl:value-of select="$uri"/></xsl:when>
      <xsl:otherwise><xsl:value-of select="$image.dims/img[@stem = translate($icn, $upper.abc, $lower.abc)]/@src"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template match="frontMatterTitlePage" mode="xs-cover">
    <xsl:variable name="pmm" select="/pm/identAndStatusSection/pmAddress"/>
    <xsl:variable name="c" select="pmCode"/>
    <xsl:variable name="num">
      <xsl:choose>
        <xsl:when test="issueInfo/@issueNumber"><xsl:value-of select="issueInfo/@issueNumber"/></xsl:when>
        <xsl:otherwise><xsl:value-of select="$pmm/pmIdent/issueInfo/@issueNumber"/></xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <xsl:variable name="d" select="($pmm/pmAddressItems/issueDate | issueDate)[1]"/>

    <fo:block font-size="{$xs.cover.title.size}" font-weight="bold" line-height="1.2" padding-top="{$xs.cover.top}">
      <xsl:value-of select="normalize-space(pmTitle)"/>
    </fo:block>
    <xsl:if test="$c">
      <fo:block font-size="{$xs.cover.sub.size}" font-weight="bold" space-before="{$xs.cover.code.gap}" space-before.conditionality="retain">
        <xsl:value-of select="concat($c/@modelIdentCode, '-', $c/@pmIssuer, '-', $c/@pmNumber, '-', $c/@pmVolume)"/>
      </fo:block>
    </xsl:if>
    <fo:block font-size="{$xs.cover.sub.size}" font-weight="bold" space-before="{$xs.cover.issue.gap}" space-before.conditionality="retain">
      <xsl:value-of select="$fm.label.s1000d.issueNo"/>
      <xsl:value-of select="$num"/>
      <xsl:if test="$d">
        <xsl:text>, </xsl:text>
        <xsl:value-of select="concat($d/@year, '-', $d/@month, '-', $d/@day)"/>
      </xsl:if>
    </fo:block>

    <xsl:variable name="pic" select="normalize-space(productIllustration/graphic/@infoEntityIdent)"/>
    <xsl:if test="$pic != ''">
      <xsl:variable name="src"><xsl:call-template name="xs-icn-src"><xsl:with-param name="icn" select="$pic"/></xsl:call-template></xsl:variable>
      <xsl:if test="$src != ''">
        <fo:block id="cover-picture-{generate-id(ancestor::dmodule[1])}" space-before="{$xs.cover.image.gap}" space-before.conditionality="retain"
                  start-indent="-{$xs.cover.image.overhang}" end-indent="-{$xs.cover.image.overhang}" text-align="center">
          <fo:external-graphic src="url('{$src}')" content-width="{$xs.cover.image.width}" content-height="auto" scaling="uniform"/>
        </fo:block>
      </xsl:if>
    </xsl:if>

    <xsl:call-template name="xs-cover-publisher">
      <xsl:with-param name="logo" select="normalize-space(publisherLogo/symbol/@infoEntityIdent)"/>
      <xsl:with-param name="enterprise" select="normalize-space(responsiblePartnerCompany/enterpriseName)"/>
    </xsl:call-template>
  </xsl:template>

  <!--
    The "Publisher:" block, one template for both covers (this one and the page the engine generates when there is no title-page module).
      logo        the publisher's logo as the title page names it (an ICN), or empty
      logo.src    a logo file the caller already has the path of, or empty
      enterprise  the enterprise name to fall back on when the build has no company line
    The logo, in this order: the title page's own, the file the caller was handed, the platform's default publisher logo. A logo is the
    publisher's name in the reference and nothing is printed under it, so the name is printed only when there is no logo to carry it
    (S1000D requires the title page to NAME its publisher in the data, BREX-S1-00113, so "the page names one" cannot decide this). What is printed is the company line the publication is set up with (settings,
    publication comment or brand pack: the same line the second margin mark carries); the enterprise name held in the data is only the
    fallback, because a code name such as the one an S1000D registry holds for the enterprise is not how the organisation signs its
    publications.
  -->
  <xsl:template name="xs-cover-publisher">
    <xsl:param name="logo"/>
    <xsl:param name="logo.src"/>
    <xsl:param name="enterprise"/>
    <xsl:variable name="own">
      <xsl:if test="$logo != ''"><xsl:call-template name="xs-icn-src"><xsl:with-param name="icn" select="$logo"/></xsl:call-template></xsl:if>
    </xsl:variable>
    <xsl:variable name="src">
      <xsl:choose>
        <xsl:when test="$own != ''"><xsl:value-of select="$own"/></xsl:when>
        <xsl:when test="normalize-space($logo.src) != ''"><xsl:value-of select="normalize-space($logo.src)"/></xsl:when>
        <xsl:otherwise><xsl:value-of select="normalize-space($publisher.logo.uri)"/></xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <fo:block font-size="8pt" space-before="{$xs.cover.publisher.gap}" space-before.conditionality="retain">
      <xsl:value-of select="$fm.label.s1000d.publisher"/>
    </fo:block>
    <xsl:if test="$src != ''">
      <fo:block space-before="{$xs.cover.logo.gap}" space-before.conditionality="retain">
        <fo:external-graphic src="url('{$src}')" content-width="{$xs.cover.logo.width}" content-height="auto" scaling="uniform"/>
      </fo:block>
    </xsl:if>
    <xsl:variable name="publisher.name">
      <xsl:if test="$src = ''">
        <xsl:choose>
          <xsl:when test="normalize-space($xs.mark.company) != ''"><xsl:value-of select="normalize-space($xs.mark.company)"/></xsl:when>
          <xsl:otherwise><xsl:value-of select="$enterprise"/></xsl:otherwise>
        </xsl:choose>
      </xsl:if>
    </xsl:variable>
    <xsl:if test="$publisher.name != ''">
      <fo:block font-size="{$table-font-size}">
        <xsl:value-of select="$publisher.name"/>
      </fo:block>
    </xsl:if>
  </xsl:template>

</xsl:stylesheet>
