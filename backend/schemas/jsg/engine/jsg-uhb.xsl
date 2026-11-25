<?xml version="1.0" encoding="UTF-8"?>
<!--
  JSG engine - the User Handbook (JSG_UHB_Stencil / JSG_UHB_Format).

  Order of the printed book (docs/JSG_STENCIL_ANALYSIS.md section 4):
    cover | amendments | warning | demolition | first aid | associated documents | abbreviations | preface | do's | don'ts | important points | system photos |
    contents | list of figures | list of tables | then CHAPTER n > SECTION n > n.n clauses | appendices.
  Every part starts on a right-hand page; the verso in between prints "This page is intentionally left blank." (the blank master, jsg-common.xsl).
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">

  <xsl:template match="jsgdoc[@type = 'uhb']" mode="document">
    <xsl:call-template name="uhb-cover"/>
    <xsl:call-template name="uhb-front"/>
    <xsl:apply-templates select="chapter" mode="uhb"/>
    <xsl:if test="appendices/appendix"><xsl:call-template name="appendices-divider"/></xsl:if>
    <xsl:apply-templates select="appendices/appendix" mode="uhb"/>
  </xsl:template>

  <!-- the appendices are the last SECTION of the last chapter in the stencil ("SECTION 6 / APPENDICES"): a divider page and its blank verso, then each appendix -->
  <xsl:template name="appendices-divider">
    <fo:page-sequence master-reference="portrait" initial-page-number="auto" format="1" font-family="{$font.body}" font-size="12pt" force-page-count="end-on-even">
      <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="true()"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <fo:block id="{generate-id(appendices)}" text-align="center" font-weight="bold" font-size="22pt" color="{$color.heading}" line-height="25.3pt" space-before="80mm">
          <fo:block>SECTION <xsl:value-of select="count(chapter[last()]/section) + 1"/></fo:block><fo:block space-before="12.65pt">APPENDICES</fo:block>
        </fo:block>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <!-- ===== cover ===== -->
  <xsl:template name="uhb-cover">
    <fo:page-sequence master-reference="cover-seq" format="i" initial-page-number="1" force-page-count="end-on-even" font-family="{$font.body}" font-size="12pt">
      <xsl:call-template name="head-foot"><xsl:with-param name="page-numbers" select="false()"/><xsl:with-param name="blank" select="true()"/><xsl:with-param name="bold" select="true()"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <fo:block text-align="right" font-weight="bold" font-size="14pt" space-after="10pt"><xsl:value-of select="meta/docNo"/>&#160;</fo:block>
        <fo:table table-layout="fixed" width="100%" space-after="10pt">
          <fo:table-column column-width="100%"/>
          <fo:table-body><fo:table-row><fo:table-cell border="0.5pt solid {$color.red}" padding="2.85pt 5.4pt">
            <fo:block color="#FF0000" text-align="justify" font-size="12pt">THE INFORMATION GIVEN IN THIS DOCUMENT IS NOT TO BE PUBLISHED OR COMMUNICATED, EITHER DIRECTLY OR INDIRECTLY TO THE PRESS OR TO ANY PERSON NOT AUTHORISED TO RECEIVE IT.</fo:block>
          </fo:table-cell></fo:table-row></fo:table-body>
        </fo:table>
        <fo:block text-align="center" space-before="6pt" space-after="0.5pt">
          <fo:external-graphic content-height="40.2mm" content-width="30.2mm" scaling="uniform">
            <xsl:attribute name="src"><xsl:choose><xsl:when test="meta/emblem != ''">url('<xsl:value-of select="meta/emblem"/>')</xsl:when><xsl:otherwise>url('<xsl:value-of select="$assets.url"/>/emblem.png')</xsl:otherwise></xsl:choose></xsl:attribute>
          </fo:external-graphic>
        </fo:block>
        <fo:block text-align="center" font-weight="bold" font-size="18pt" color="{$color.title}" line-height="20.7pt" space-before="0.5pt">
          <xsl:value-of select="meta/title"/>
          <xsl:if test="meta/subtitle != ''"><fo:block><xsl:value-of select="meta/subtitle"/></fo:block></xsl:if>
          <fo:block font-size="14pt">FOR</fo:block>
        </fo:block>
        <fo:block text-align="center" font-weight="bold" font-size="18pt" color="{$color.title}" line-height="20.7pt" space-before="15.5pt" space-after="1.3pt"><xsl:value-of select="meta/projectName"/></fo:block>
        <fo:block text-align="center" font-size="14pt" line-height="18.5pt">A/T or S/O No.: <xsl:value-of select="meta/atNo"/></fo:block>
        <fo:block text-align="center" font-size="14pt" line-height="18.5pt">DATED: <xsl:value-of select="meta/dated"/></fo:block>
        <fo:block text-align="center" font-size="14pt" line-height="18.5pt">NSN: <xsl:value-of select="meta/nsn"/></fo:block>
        <fo:block text-align="center" font-weight="bold" space-before="14.5pt">SUPPLIED BY:</fo:block>
        <fo:block-container height="47.9pt" text-align="center" overflow="visible"><fo:block line-height="0pt" font-size="0pt">
          <fo:external-graphic content-height="16.9mm" content-width="20.1mm" scaling="uniform">
            <xsl:attribute name="src"><xsl:choose><xsl:when test="meta/logo != ''">url('<xsl:value-of select="meta/logo"/>')</xsl:when><xsl:otherwise>url('<xsl:value-of select="$assets.url"/>/supplier-logo.png')</xsl:otherwise></xsl:choose></xsl:attribute>
          </fo:external-graphic>
        </fo:block></fo:block-container>
        <xsl:choose>
          <xsl:when test="meta/supplier/line">
            <xsl:for-each select="meta/supplier/line"><fo:block text-align="center" line-height="15.9pt"><xsl:value-of select="."/></fo:block></xsl:for-each>
          </xsl:when>
          <xsl:otherwise>
            <fo:block text-align="center" line-height="15.9pt">LARSEN &amp; TOUBRO LIMITED,</fo:block>
            <fo:block text-align="center" line-height="15.9pt">PUNE 410507 INDIA</fo:block>
          </xsl:otherwise>
        </xsl:choose>
        <fo:block text-align="center" font-weight="bold" space-before="14pt">ISSUED BY:</fo:block>
        <xsl:for-each select="meta/issuedBy/line"><fo:block text-align="center" line-height="15.9pt"><xsl:value-of select="."/></fo:block></xsl:for-each>
        <!-- the stencil keeps four lines for the issuing authority before the date: whatever the lines do not fill stays empty -->
        <xsl:variable name="gap"><xsl:choose><xsl:when test="57.4 - 15.87 * count(meta/issuedBy/line) &gt; 0"><xsl:value-of select="57.4 - 15.87 * count(meta/issuedBy/line)"/></xsl:when><xsl:otherwise>0</xsl:otherwise></xsl:choose></xsl:variable>
        <fo:block padding-top="{$gap}pt"/>
        <fo:block text-align="left" space-after="13.2pt" line-height="15.9pt"><xsl:value-of select="meta/issueDate"/></fo:block>
        <fo:block text-align="justify" line-height="15.9pt" start-indent="0mm"><fo:inline>EQUIPMENT LIFE:</fo:inline><xsl:text> </xsl:text><xsl:value-of select="meta/equipmentLife"/></fo:block>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <!-- ===== front matter ===== -->
  <xsl:template name="uhb-front">
    <fo:page-sequence master-reference="portrait" format="i" initial-page-number="auto" force-page-count="end-on-even" font-family="{$font.body}" font-size="12pt">
      <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="true()"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <!-- the order of the filled handbook: certificate, associated handbooks, amendments, warning, demolition, first aid, abbreviations, preface, do's and don'ts,
             important points, photos, contents, the lists. A page is printed when it has its content (or always has one) and is not switched off in front/@omit. -->
        <xsl:if test="front/certificate and not(contains($omit, ' certificate '))"><xsl:call-template name="uhb-certificate"/></xsl:if>
        <xsl:if test="front/associated and not(contains($omit, ' associated '))"><xsl:call-template name="uhb-associated"/></xsl:if>
        <xsl:if test="not(contains($omit, ' amendments '))"><xsl:call-template name="uhb-amendments"/></xsl:if>
        <xsl:if test="not(contains($omit, ' warning '))"><xsl:call-template name="uhb-warning"/></xsl:if>
        <xsl:if test="not(contains($omit, ' demolition '))"><xsl:call-template name="uhb-demolition"/></xsl:if>
        <xsl:if test="not(contains($omit, ' firstAid '))"><xsl:call-template name="uhb-firstaid"/></xsl:if>
        <xsl:if test="not(contains($omit, ' abbreviations '))"><xsl:call-template name="uhb-abbreviations"/></xsl:if>
        <xsl:if test="front/preface and not(contains($omit, ' preface '))"><xsl:call-template name="uhb-preface"/></xsl:if>
        <xsl:if test="(front/dos and not(contains($omit, ' dos '))) or (front/donts and not(contains($omit, ' donts ')))"><xsl:call-template name="uhb-dos"/></xsl:if>
        <xsl:if test="front/important and not(contains($omit, ' important '))"><xsl:call-template name="uhb-items"><xsl:with-param name="title">IMPORTANT POINTS</xsl:with-param><xsl:with-param name="items" select="front/important/item"/></xsl:call-template></xsl:if>
        <xsl:if test="front/photos and not(contains($omit, ' photos '))"><xsl:call-template name="uhb-photos"/></xsl:if>
        <xsl:if test="not(contains($omit, ' contents '))"><xsl:call-template name="uhb-contents"/></xsl:if>
        <xsl:if test="not(contains($omit, ' listOfFigures '))"><xsl:call-template name="uhb-list-of-figures"/></xsl:if>
        <xsl:if test="not(contains($omit, ' listOfTables '))"><xsl:call-template name="uhb-list-of-tables"/></xsl:if>
        <fo:block id="front-last"/>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <!-- CERTIFICATE (the filled handbook, page 3): a spaced title, the sentence with the pages counted by the build, then the signature table -->
  <xsl:template name="uhb-certificate">
    <fo:block break-before="odd-page">
      <fo:block font-weight="bold" font-size="18pt" color="{$color.heading}" text-align="center" space-after="13.8pt">C E R T I F I C A T E</fo:block>
      <fo:block font-size="14pt" text-align="justify" line-height="16.1pt">
        <xsl:apply-templates select="front/certificate/node()" mode="cert"/>
      </fo:block>
      <fo:table table-layout="fixed" width="100%" font-size="14pt" space-before="64.4pt">
        <fo:table-column column-width="25.3mm"/><fo:table-column column-width="36.2mm"/><fo:table-column column-width="19.6mm"/><fo:table-column column-width="28.9mm"/><fo:table-column column-width="50mm"/>
        <fo:table-body>
          <fo:table-row height="24pt"><fo:table-cell><fo:block>Date :</fo:block></fo:table-cell><fo:table-cell><fo:block/></fo:table-cell><fo:table-cell><fo:block/></fo:table-cell><fo:table-cell><fo:block>Name</fo:block></fo:table-cell><fo:table-cell><fo:block>:</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row height="24pt"><fo:table-cell><fo:block/></fo:table-cell><fo:table-cell><fo:block/></fo:table-cell><fo:table-cell><fo:block/></fo:table-cell><fo:table-cell><fo:block>Designation</fo:block></fo:table-cell><fo:table-cell><fo:block>:</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row height="24pt"><fo:table-cell><fo:block/></fo:table-cell><fo:table-cell><fo:block/></fo:table-cell><fo:table-cell><fo:block/></fo:table-cell><fo:table-cell><fo:block>Organization</fo:block></fo:table-cell><fo:table-cell><fo:block>:</fo:block></fo:table-cell></fo:table-row>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <!-- the certificate sentence: {docNo}, {total}, {frontLast} and {mainLast} are filled in at build time -->
  <xsl:template match="text()" mode="cert">
    <xsl:call-template name="cert-text"><xsl:with-param name="t" select="."/></xsl:call-template>
  </xsl:template>
  <xsl:template match="b" mode="cert"><fo:inline font-weight="bold"><xsl:apply-templates mode="cert"/></fo:inline></xsl:template>
  <xsl:template match="i" mode="cert"><fo:inline font-style="italic"><xsl:apply-templates mode="cert"/></fo:inline></xsl:template>
  <xsl:template match="u" mode="cert"><fo:inline text-decoration="underline"><xsl:apply-templates mode="cert"/></fo:inline></xsl:template>
  <xsl:template match="sup|sub|br|xref" mode="cert"><xsl:apply-templates select="." mode="inline"/></xsl:template>
  <xsl:template name="cert-text">
    <xsl:param name="t"/>
    <xsl:choose>
      <xsl:when test="contains($t, '{')">
        <xsl:value-of select="substring-before($t, '{')"/>
        <xsl:variable name="tok" select="substring-before(substring-after($t, '{'), '}')"/>
        <xsl:choose>
          <xsl:when test="$tok = 'docNo'"><fo:inline font-weight="bold" font-size="12pt"><xsl:value-of select="/jsgdoc/meta/docNo"/></fo:inline></xsl:when>
          <xsl:when test="$tok = 'total'"><xsl:choose><xsl:when test="$pages.total != ''"><xsl:value-of select="$pages.total"/></xsl:when><xsl:otherwise>___</xsl:otherwise></xsl:choose></xsl:when>
          <xsl:when test="$tok = 'frontLast'"><fo:page-number-citation ref-id="front-last"/></xsl:when>
          <xsl:when test="$tok = 'mainLast'"><fo:page-number-citation ref-id="main-last"/></xsl:when>
          <xsl:otherwise>{<xsl:value-of select="$tok"/>}</xsl:otherwise>
        </xsl:choose>
        <xsl:call-template name="cert-text"><xsl:with-param name="t" select="substring-after(substring-after($t, '{'), '}')"/></xsl:call-template>
      </xsl:when>
      <xsl:otherwise><xsl:value-of select="$t"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="uhb-amendments">
    <fo:block break-before="page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">AMENDMENTS</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" font-size="12pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(840)"/>
        <fo:table-column column-width="proportional-column-width(1161)"/>
        <fo:table-column column-width="proportional-column-width(1769)"/>
        <fo:table-column column-width="proportional-column-width(3501)"/>
        <fo:table-column column-width="proportional-column-width(2359)"/>
        <fo:table-header><fo:table-row font-weight="bold" text-align="center">
          <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>S. No.</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>Page No.</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>Para Reference</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>Amendment Required</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>Authority with Ref. No. &amp; Date</fo:block></fo:table-cell>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="front/amendments/row">
            <fo:table-row height="24.35pt">
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block text-align="center"><xsl:value-of select="@no"/>&#160;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block text-align="center"><xsl:value-of select="@page"/>&#160;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block><xsl:value-of select="@para"/>&#160;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block><xsl:value-of select="@required"/>&#160;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block><xsl:value-of select="@authority"/>&#160;</fo:block></fo:table-cell>
            </fo:table-row>
          </xsl:for-each>
          <xsl:call-template name="blank-rows">
            <xsl:with-param name="n"><xsl:choose><xsl:when test="front/amendments/@minRows"><xsl:value-of select="front/amendments/@minRows - count(front/amendments/row)"/></xsl:when><xsl:otherwise><xsl:value-of select="20 - count(front/amendments/row)"/></xsl:otherwise></xsl:choose></xsl:with-param>
            <xsl:with-param name="cols" select="5"/><xsl:with-param name="h">24.35pt</xsl:with-param>
          </xsl:call-template>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="abbr-blank-rows">
    <xsl:param name="from"/><xsl:param name="to"/>
    <xsl:if test="$from &lt;= $to">
      <fo:table-row>
        <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="4pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block text-align="center"><xsl:value-of select="$from"/></fo:block></fo:table-cell>
        <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="4pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block>&#160;</fo:block></fo:table-cell>
        <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="4pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block>&#160;</fo:block></fo:table-cell>
      </fo:table-row>
      <xsl:call-template name="abbr-blank-rows"><xsl:with-param name="from" select="$from + 1"/><xsl:with-param name="to" select="$to"/></xsl:call-template>
    </xsl:if>
  </xsl:template>

  <xsl:template name="blank-rows">
    <xsl:param name="n"/><xsl:param name="cols"/><xsl:param name="h">8mm</xsl:param>
    <xsl:if test="$n &gt; 0">
      <fo:table-row height="{$h}">
        <xsl:call-template name="blank-cells"><xsl:with-param name="c" select="$cols"/></xsl:call-template>
      </fo:table-row>
      <xsl:call-template name="blank-rows"><xsl:with-param name="n" select="$n - 1"/><xsl:with-param name="cols" select="$cols"/><xsl:with-param name="h" select="$h"/></xsl:call-template>
    </xsl:if>
  </xsl:template>
  <xsl:template name="blank-cells">
    <xsl:param name="c"/>
    <xsl:if test="$c &gt; 0">
      <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block>&#160;</fo:block></fo:table-cell>
      <xsl:call-template name="blank-cells"><xsl:with-param name="c" select="$c - 1"/></xsl:call-template>
    </xsl:if>
  </xsl:template>

  <xsl:template name="uhb-warning">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">WARNING</xsl:with-param><xsl:with-param name="after">0pt</xsl:with-param></xsl:call-template>
      <!-- the stencil: red text, hanging 227 twips, line 480 (double), 12 pt before -->
      <xsl:for-each select="front/warning/item">
        <fo:list-block provisional-distance-between-starts="11.35pt" space-after="13.8pt" color="{$color.red}"><xsl:if test="position() = 1"><xsl:attribute name="space-before">12pt</xsl:attribute></xsl:if>
          <fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block line-height="13.8pt"><xsl:number format="1"/>.</fo:block></fo:list-item-label>
            <fo:list-item-body start-indent="body-start()"><fo:block text-align="justify" line-height="13.8pt"><xsl:apply-templates mode="inline"/></fo:block></fo:list-item-body></fo:list-item>
        </fo:list-block>
      </xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-demolition">
    <fo:block break-before="odd-page">
      <fo:block font-weight="bold" font-size="14pt" color="{$color.heading}" text-align="center" line-height="20.7pt" space-after="30pt">DEMOLITION OF EQUIPMENT<fo:block/>TO PREVENT ENEMY USE</fo:block>
      <xsl:choose>
        <xsl:when test="front/demolition/para"><xsl:for-each select="front/demolition/para"><fo:block text-align="justify" color="{$color.red}" line-height="15.9pt"><xsl:apply-templates mode="inline"/></fo:block></xsl:for-each></xsl:when>
        <xsl:otherwise><fo:block text-align="justify" color="{$color.red}" line-height="15.9pt">THE DEMOLITION OF THE EQUIPMENT WILL BE HELD ONLY ON THE ORDER OF THE COMMANDING OFFICER.</fo:block></xsl:otherwise>
      </xsl:choose>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-firstaid">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">FIRST AID IN CASE OF ELECTRICAL SHOCK</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" border-collapse="collapse">
        <fo:table-column column-width="11mm"/><fo:table-column column-width="149mm"/>
        <fo:table-body>
          <xsl:choose>
            <xsl:when test="front/firstAid/item">
              <xsl:for-each select="front/firstAid/item">
                <fo:table-row><fo:table-cell border="0.5pt solid black" padding="3pt" color="{$color.red}"><fo:block><xsl:number format="1"/>.</fo:block></fo:table-cell>
                  <fo:table-cell border="0.5pt solid black" padding="3pt" color="{$color.red}"><fo:block text-align="justify"><xsl:apply-templates mode="inline"/></fo:block></fo:table-cell></fo:table-row>
              </xsl:for-each>
            </xsl:when>
            <xsl:otherwise>
              <fo:table-row><fo:table-cell border="0.5pt solid black" padding="3pt" color="{$color.red}"><fo:block>1.</fo:block></fo:table-cell>
                <fo:table-cell border="0.5pt solid black" padding="3pt" color="{$color.red}"><fo:block text-align="justify">Shift the person to the nearest medical centre immediately, who is affected by electrical shock.</fo:block></fo:table-cell></fo:table-row>
              <fo:table-row><fo:table-cell border="0.5pt solid black" padding="3pt" color="{$color.red}"><fo:block>2.</fo:block></fo:table-cell>
                <fo:table-cell border="0.5pt solid black" padding="3pt" color="{$color.red}">
                  <fo:block>i) Terminate the battery connection of vehicle.</fo:block><fo:block>ii) Find fault in defective cable / wire.</fo:block><fo:block>iii) Replace defective cable / wire from vehicle chassis.</fo:block></fo:table-cell></fo:table-row>
            </xsl:otherwise>
          </xsl:choose>
        </fo:table-body>
      </fo:table>
    </fo:block>
    <fo:block break-before="page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">FIRST AID IN CASE OF ELECTRIC SHOCK</xsl:with-param></xsl:call-template>
      <!-- the stencil's table: a 48.4 mm column holding the four figures, a 7.4 mm column of step numbers, a text column -->
      <fo:table table-layout="fixed" width="100%" border-collapse="collapse" font-size="12pt">
        <fo:table-column column-width="48.4mm"/><fo:table-column column-width="7.4mm"/><fo:table-column column-width="104.2mm"/>
        <fo:table-body>
          <fo:table-row><fo:table-cell number-rows-spanned="6" padding="3pt">
            <xsl:call-template name="first-aid-figure"><xsl:with-param name="file">firstaid-1.png</xsl:with-param><xsl:with-param name="caption">Figure. 1</xsl:with-param></xsl:call-template>
            <xsl:call-template name="first-aid-figure"><xsl:with-param name="file">firstaid-2.png</xsl:with-param><xsl:with-param name="caption">Figure. 2</xsl:with-param></xsl:call-template>
            <xsl:call-template name="first-aid-figure"><xsl:with-param name="file">firstaid-3.png</xsl:with-param><xsl:with-param name="caption">Figure. 3</xsl:with-param></xsl:call-template>
            <xsl:call-template name="first-aid-figure"><xsl:with-param name="file">firstaid-4.png</xsl:with-param><xsl:with-param name="caption">Figure. 4</xsl:with-param></xsl:call-template>
          </fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block>1.</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block text-align="justify">SWITCH OFF. If this is not possible, PROTECT YOURSELF with dry insulating material and pull the victim clear of the conductor. DO NOT TOUCH THE VICTIM WITH YOUR BARE HANDS until he is clear of the conductor, but DO NOT WASTE TIME.</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block>2.</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block text-align="justify">(a) Place the victim in the supine position.</fo:block><fo:block text-align="justify" space-before="4pt">(b) Keep the air passages clear by turning the head to one side, opening the patient's mouth and clearing it of water, saline, mucus or blood, a lot of which might have accumulated in the back of the throat. (Figure 1)</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block>3.</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block text-align="justify">If the jaw is rigid, try to force the mouth open by pressure on the gum behind the last molar tooth of the lower jaw. When the upper air passages thus cleared, tilt the head backward and force the jaw forward from the angles of the jaw in front of the ears. This would prevent mechanical obstructions to the upper air passages. (Figure 2-3)</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block>4.</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block text-align="justify">(a) Then hold the chin up and forward with one hand and pinch the nostrils of the victim with the other. (Figure 3)</fo:block><fo:block text-align="justify" space-before="4pt">(b) Take a very deep breath and apply your mouth to that of the victim and blow into his mouth, until the chest of the victim moves up indicating filling of the lungs. (NEVER ALLOW THE CHIN TO SAG). (Figure 4)</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block>5.</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block text-align="justify">When the chest has moved up, withdraw your mouth and allow the chest to slink back. REPEAT this process every three to four seconds until the victim begins to breathe again or until he taken over by a medical attendant. This method can be continued in an ambulance during transit of the patient from the site of accident to the nearest medical centre.</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell number-columns-spanned="2" border="0.5pt solid black" padding="3pt" font-weight="bold" text-align="justify">
            <fo:block line-height="20.7pt">HAVE SOMEONE ELSE AND SEND FOR A DOCTOR.</fo:block><fo:block line-height="20.7pt">KEEP PATIENT WARM AND LOOSEN HIS CLOTHING.</fo:block><fo:block line-height="20.7pt">DO NOT GIVE LIQUIDS UNTIL THE PATIENT IS CONSCIOUS.</fo:block></fo:table-cell></fo:table-row>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-associated">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">ASSOCIATED HANDBOOKS</xsl:with-param><xsl:with-param name="after"><xsl:choose><xsl:when test="front/associated/@intro != ''">6pt</xsl:when><xsl:otherwise>14pt</xsl:otherwise></xsl:choose></xsl:with-param></xsl:call-template>
      <xsl:if test="front/associated/@intro != ''"><fo:block space-after="8pt"><xsl:value-of select="front/associated/@intro"/></fo:block></xsl:if>
      <fo:table table-layout="fixed" width="100%" font-size="12pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(606)"/><fo:table-column column-width="proportional-column-width(3500)"/>
        <fo:table-column column-width="proportional-column-width(2971)"/><fo:table-column column-width="proportional-column-width(2553)"/>
        <fo:table-header><fo:table-row font-weight="bold" height="16.8pt">
          <fo:table-cell border="0.5pt solid black" padding-left="5.4pt" padding-right="5.4pt"><fo:block text-align="center" line-height="13.8pt">Sr. No.</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding-left="5.4pt" padding-right="5.4pt"><fo:block line-height="13.8pt">Document Title</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding-left="5.4pt" padding-right="5.4pt"><fo:block line-height="13.8pt">Document No.</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding-left="5.4pt" padding-right="5.4pt"><fo:block line-height="13.8pt">Remark</fo:block></fo:table-cell>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="front/associated/doc">
            <!-- a document number shared by the volumes under it is one cell: the empty ones that follow join the number above -->
            <xsl:variable name="k" select="count(preceding-sibling::doc[@docNo != '']) + number(@docNo != '')"/>
            <xsl:variable name="shared" select="count(following-sibling::doc[not(@docNo != '')][count(preceding-sibling::doc[@docNo != '']) = $k])"/>
            <fo:table-row height="20.85pt">
              <fo:table-cell border="0.5pt solid black" padding-left="5.4pt" padding-right="5.4pt"><fo:block text-align="center" line-height="13.8pt"><xsl:number format="1"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-left="5.4pt" padding-right="5.4pt"><fo:block line-height="13.8pt"><xsl:value-of select="@title"/></fo:block></fo:table-cell>
              <xsl:if test="@docNo != '' or not(preceding-sibling::doc)">
                <fo:table-cell border="0.5pt solid black" padding-left="5.4pt" padding-right="5.4pt">
                  <xsl:if test="$shared &gt; 0"><xsl:attribute name="number-rows-spanned"><xsl:value-of select="$shared + 1"/></xsl:attribute></xsl:if>
                  <fo:block line-height="13.8pt"><xsl:value-of select="@docNo"/>&#160;</fo:block>
                </fo:table-cell>
              </xsl:if>
              <fo:table-cell border="0.5pt solid black" padding-left="5.4pt" padding-right="5.4pt"><fo:block line-height="13.8pt"><xsl:value-of select="@remark"/>&#160;</fo:block></fo:table-cell>
            </fo:table-row>
          </xsl:for-each>
          <xsl:if test="not(front/associated/doc)"><xsl:call-template name="blank-rows"><xsl:with-param name="n" select="1"/><xsl:with-param name="cols" select="4"/></xsl:call-template></xsl:if>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-abbreviations">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">ABBREVIATIONS</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" font-size="12pt" line-height="20.7pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(1020)"/><fo:table-column column-width="proportional-column-width(2519)"/><fo:table-column column-width="proportional-column-width(6088)"/>
        <fo:table-header><fo:table-row font-weight="bold" text-align="center">
          <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="4pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block>Sr. No.</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="4pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block>Abbreviation Issued</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="4pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block>For</fo:block></fo:table-cell>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="front/abbreviations/abbr">
            <fo:table-row>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="4pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block text-align="center"><xsl:number format="1"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="4pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block><xsl:value-of select="@short"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="4pt" padding-left="5.4pt" padding-right="5.4pt"><fo:block><xsl:value-of select="@long"/></fo:block></fo:table-cell>
            </fo:table-row>
          </xsl:for-each>
          <!-- the stencil's table is numbered 1..37 whether or not the rows are filled: pad to minRows with numbered empty rows -->
          <xsl:call-template name="abbr-blank-rows">
            <xsl:with-param name="from" select="count(front/abbreviations/abbr) + 1"/>
            <xsl:with-param name="to"><xsl:choose><xsl:when test="front/abbreviations/@minRows"><xsl:value-of select="front/abbreviations/@minRows"/></xsl:when><xsl:otherwise>0</xsl:otherwise></xsl:choose></xsl:with-param>
          </xsl:call-template>
          <xsl:if test="not(front/abbreviations/abbr) and not(front/abbreviations/@minRows &gt; 0)"><xsl:call-template name="blank-rows"><xsl:with-param name="n" select="1"/><xsl:with-param name="cols" select="3"/></xsl:call-template></xsl:if>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-preface">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">PREFACE</xsl:with-param></xsl:call-template>
      <xsl:for-each select="front/preface/para">
        <fo:list-block provisional-distance-between-starts="18pt" start-indent="18pt" space-after="8pt">
          <fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block><xsl:number format="1"/>.</fo:block></fo:list-item-label>
            <fo:list-item-body start-indent="body-start()"><fo:block text-align="justify" line-height="15.9pt"><xsl:apply-templates mode="inline"/></fo:block></fo:list-item-body></fo:list-item>
        </fo:list-block>
      </xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-items">
    <xsl:param name="title"/><xsl:param name="items"/>
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text" select="$title"/></xsl:call-template>
      <xsl:for-each select="$items">
        <fo:list-block provisional-distance-between-starts="18pt" start-indent="18pt">
          <fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block><xsl:number format="1"/></fo:block></fo:list-item-label>
            <fo:list-item-body start-indent="body-start()"><fo:block text-align="justify" line-height="15.9pt"><xsl:apply-templates mode="inline"/></fo:block></fo:list-item-body></fo:list-item>
        </fo:list-block>
      </xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-dos">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">DO&#8217;S</xsl:with-param><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
      <xsl:for-each select="front/dos/item"><fo:block start-indent="36pt" text-indent="-18pt" text-align="justify" line-height="15.9pt"><xsl:number format="1"/>.&#160;&#160;<xsl:apply-templates mode="inline"/></fo:block></xsl:for-each>
      <xsl:call-template name="front-title"><xsl:with-param name="text">DONT&#8217;S</xsl:with-param><xsl:with-param name="align">left</xsl:with-param><xsl:with-param name="before">41.4pt</xsl:with-param></xsl:call-template>
      <xsl:for-each select="front/donts/item"><fo:block start-indent="36pt" text-indent="-18pt" text-align="justify" line-height="15.9pt"><xsl:number format="1"/>.&#160;&#160;<xsl:apply-templates mode="inline"/></fo:block></xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-photos">
    <fo:block break-before="odd-page">
      <xsl:choose>
        <xsl:when test="front/photos/graphic"><xsl:for-each select="front/photos/graphic">
          <fo:block text-align="center" space-after="14pt" keep-together.within-page="always">
            <fo:block space-after="6pt"><xsl:call-template name="graphic"/></fo:block>
            <xsl:if test="@label != ''"><fo:block font-weight="bold" font-size="14pt" color="{$color.heading}"><xsl:value-of select="@label"/></fo:block></xsl:if>
          </fo:block>
        </xsl:for-each></xsl:when>
        <xsl:otherwise><fo:block text-align="center">SYSTEM PHOTOS</fo:block></xsl:otherwise>
      </xsl:choose>
    </fo:block>
  </xsl:template>

  <!-- ===== contents (a table: CHAPTERS | DESCRIPTION | PAGE No.), list of figures, list of tables ===== -->
  <xsl:template name="uhb-contents">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">CONTENTS</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" font-size="12pt" border-collapse="collapse">
        <fo:table-column column-width="31.9mm"/><fo:table-column column-width="112.5mm"/><fo:table-column column-width="25.3mm"/>
        <fo:table-header><fo:table-row font-weight="bold" text-align="left" color="{$color.heading}" height="26.9pt">
          <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>CHAPTERS</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>DESCRIPTION</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block text-align="center">PAGE No.</fo:block></fo:table-cell>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="chapter">
            <fo:table-row font-weight="bold" color="{$color.heading}" height="26.9pt">
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>CHAPTER <xsl:value-of select="position()"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block><xsl:value-of select="translate(@title, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block text-align="center"><fo:page-number-citation ref-id="{generate-id()}"/></fo:block></fo:table-cell>
            </fo:table-row>
            <xsl:for-each select="section">
              <fo:table-row height="26.9pt">
                <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>Section <xsl:value-of select="position()"/></fo:block></fo:table-cell>
                <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block><xsl:value-of select="@title"/></fo:block></fo:table-cell>
                <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block text-align="center"><fo:page-number-citation ref-id="{generate-id()}"/></fo:block></fo:table-cell>
              </fo:table-row>
            </xsl:for-each>
          </xsl:for-each>
          <xsl:if test="not(chapter) and not(appendices/appendix)"><xsl:call-template name="blank-rows"><xsl:with-param name="n" select="1"/><xsl:with-param name="cols" select="3"/></xsl:call-template></xsl:if>
          <xsl:if test="appendices/appendix">
            <fo:table-row height="26.9pt">
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>Section <xsl:value-of select="count(chapter[last()]/section) + 1"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>Appendices</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block text-align="center"><fo:page-number-citation ref-id="{generate-id(appendices)}"/></fo:block></fo:table-cell>
            </fo:table-row>
          </xsl:if>
          <xsl:for-each select="appendices/appendix">
            <fo:table-row height="26.9pt">
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block>Appendix &#8216;<xsl:value-of select="@label"/>&#8217;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block><xsl:value-of select="@title"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding-top="2pt" padding-bottom="2pt" padding-left="5.4pt" padding-right="5.4pt" display-align="center"><fo:block text-align="center"><fo:page-number-citation ref-id="{generate-id()}"/></fo:block></fo:table-cell>
            </fo:table-row>
          </xsl:for-each>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-list-of-figures">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">LIST OF FIGURES</xsl:with-param><xsl:with-param name="after">0pt</xsl:with-param></xsl:call-template>
      <xsl:for-each select="//figure">
        <xsl:variable name="n"><xsl:number level="any" count="figure"/></xsl:variable>
        <fo:block text-align-last="justify" line-height="20.7pt" end-indent="2em" text-indent="0">
          Figure <xsl:value-of select="$n"/>: <xsl:value-of select="@title"/>
          <fo:leader leader-pattern="dots"/><fo:page-number-citation ref-id="figc-{$n}"/>
        </fo:block>
      </xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-list-of-tables">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">LIST OF TABLES</xsl:with-param><xsl:with-param name="after">0pt</xsl:with-param></xsl:call-template>
      <xsl:for-each select="//table[@title]">
        <xsl:variable name="n"><xsl:number level="any" count="table[@title]"/></xsl:variable>
        <fo:block text-align-last="justify" line-height="20.7pt">
          Table <xsl:value-of select="$n"/>: <xsl:value-of select="@title"/>
          <fo:leader leader-pattern="dots"/><fo:page-number-citation ref-id="tabc-{$n}"/>
        </fo:block>
      </xsl:for-each>
    </fo:block>
  </xsl:template>

  <!-- ===== body: CHAPTER divider, SECTION divider, then the numbered clauses ===== -->
  <xsl:template match="chapter" mode="uhb">
    <fo:page-sequence master-reference="portrait" format="1" font-family="{$font.body}" font-size="12pt" force-page-count="end-on-even">
      <xsl:attribute name="initial-page-number"><xsl:choose><xsl:when test="not(preceding-sibling::chapter)">1</xsl:when><xsl:otherwise>auto</xsl:otherwise></xsl:choose></xsl:attribute>
      <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="true()"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <fo:block id="{generate-id()}" text-align="center" font-weight="bold" font-size="22pt" color="{$color.heading}" line-height="25.3pt" space-before="80mm">
          <fo:block>CHAPTER <xsl:value-of select="count(preceding-sibling::chapter) + 1"/></fo:block><fo:block space-before="12.65pt"><xsl:value-of select="translate(@title, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/></fo:block>
        </fo:block>
      </fo:flow>
    </fo:page-sequence>
    <xsl:apply-templates select="section" mode="uhb"/>
  </xsl:template>

  <xsl:template match="section" mode="uhb">
    <xsl:variable name="master">
      <xsl:choose>
        <xsl:when test="@orientation = 'landscape'">l-page</xsl:when>
        <xsl:when test="@orientation = 'a3-landscape'">a3-page</xsl:when>
        <xsl:otherwise>portrait</xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <!-- the SECTION divider page -->
    <fo:page-sequence master-reference="portrait" initial-page-number="auto" format="1" font-family="{$font.body}" font-size="12pt" force-page-count="end-on-even">
      <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="true()"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <fo:block id="{generate-id()}" text-align="center" font-weight="bold" font-size="22pt" color="{$color.heading}" line-height="25.3pt" space-before="80mm">
          <fo:block>SECTION <xsl:value-of select="count(preceding-sibling::section) + 1"/></fo:block><fo:block space-before="12.65pt"><xsl:value-of select="translate(@title, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/></fo:block>
        </fo:block>
      </fo:flow>
    </fo:page-sequence>
    <!-- the section's content. A portrait section whose clauses ask for a landscape page is cut into runs of one orientation (the stencil's 1.3 System Tree Chart
         is a landscape page between portrait ones); the last run alone is padded to an even page, so the pages follow each other as the stencil's do. -->
    <xsl:choose>
      <xsl:when test="$master = 'portrait' and clause[@orientation and @orientation != 'portrait']">
        <xsl:for-each select="*[not(preceding-sibling::*) or string(self::clause/@orientation[. != 'portrait']) != string(preceding-sibling::*[1][self::clause]/@orientation[. != 'portrait'])]">
          <xsl:variable name="o" select="string(self::clause/@orientation[. != 'portrait'])"/>
          <xsl:variable name="m"><xsl:choose><xsl:when test="$o = 'landscape'">l-page</xsl:when><xsl:when test="$o = 'a3-landscape'">a3-page</xsl:when><xsl:otherwise>portrait</xsl:otherwise></xsl:choose></xsl:variable>
          <xsl:variable name="last" select="not(following-sibling::*[string(self::clause/@orientation[. != 'portrait']) != string(preceding-sibling::*[1][self::clause]/@orientation[. != 'portrait'])])"/>
          <fo:page-sequence master-reference="{$m}" initial-page-number="auto" format="1" font-family="{$font.body}" font-size="12pt">
            <xsl:attribute name="force-page-count"><xsl:choose><xsl:when test="$last">end-on-even</xsl:when><xsl:otherwise>no-force</xsl:otherwise></xsl:choose></xsl:attribute>
            <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="$m = 'portrait'"/></xsl:call-template>
            <fo:flow flow-name="xsl-region-body">
              <xsl:call-template name="emit-run"><xsl:with-param name="node" select="."/></xsl:call-template>
              <fo:block/>
            </fo:flow>
          </fo:page-sequence>
        </xsl:for-each>
      </xsl:when>
      <!-- a section with nothing in it (the stencil's "Transportation in Crates") has no content page: its divider and the blank verso after it are all it prints -->
      <xsl:when test="not(*)"/>
      <xsl:otherwise>
        <fo:page-sequence master-reference="{$master}" initial-page-number="auto" format="1" font-family="{$font.body}" font-size="12pt" force-page-count="end-on-even">
          <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="$master = 'portrait'"/></xsl:call-template>
          <fo:flow flow-name="xsl-region-body">
            <xsl:apply-templates select="*" mode="body"/>
            <xsl:if test="not(following-sibling::section) and not(../following-sibling::chapter) and not(/jsgdoc/appendices/appendix)"><fo:block id="main-last"/></xsl:if>
            <fo:block/>
          </fo:flow>
        </fo:page-sequence>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- a node and the siblings after it that share its orientation -->
  <xsl:template name="emit-run">
    <xsl:param name="node"/>
    <xsl:apply-templates select="$node" mode="body"/>
    <xsl:variable name="next" select="$node/following-sibling::*[1]"/>
    <xsl:if test="$next and string($next[self::clause]/@orientation[. != 'portrait']) = string($node[self::clause]/@orientation[. != 'portrait'])">
      <xsl:call-template name="emit-run"><xsl:with-param name="node" select="$next"/></xsl:call-template>
    </xsl:if>
  </xsl:template>

  <!-- a clause: its number is the SECTION number and the path of clauses below it ("2.1", "2.1.3") -->
  <xsl:template match="clause" mode="body">
    <xsl:variable name="depth" select="count(ancestor::clause) + 1"/>
    <xsl:variable name="sec" select="count(ancestor::section/preceding-sibling::section) + 1"/>
    <xsl:variable name="path"><xsl:number level="multiple" count="clause" from="section" format="1.1"/></xsl:variable>
    <xsl:variable name="left">
      <xsl:choose><xsl:when test="$depth = 1">22.7pt</xsl:when><xsl:when test="$depth = 2">58.7pt</xsl:when><xsl:when test="$depth = 3">65.2pt</xsl:when><xsl:otherwise>72.3pt</xsl:otherwise></xsl:choose>
    </xsl:variable>
    <xsl:variable name="hang">
      <xsl:choose><xsl:when test="$depth = 1">22.7pt</xsl:when><xsl:when test="$depth = 2">36pt</xsl:when><xsl:when test="$depth = 3">42.6pt</xsl:when><xsl:otherwise>49.6pt</xsl:otherwise></xsl:choose>
    </xsl:variable>
    <fo:block id="{generate-id()}" font-weight="bold" color="{$color.heading}" space-before="12pt" space-after="6pt" keep-with-next.within-page="always"
              start-indent="{$left}" text-indent="-{$hang}" line-height="13.8pt">
      <xsl:value-of select="$sec"/>.<xsl:value-of select="$path"/><xsl:text>&#160;&#160;</xsl:text>
      <xsl:value-of select="translate(@title, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/>
    </fo:block>
    <xsl:apply-templates select="*" mode="body"/>
  </xsl:template>

  <!-- ===== appendices ===== -->
  <xsl:template match="appendix" mode="uhb">
    <xsl:variable name="master">
      <xsl:choose>
        <xsl:when test="@orientation = 'landscape'">l-page</xsl:when>
        <xsl:when test="@orientation = 'a3-landscape'">a3-page</xsl:when>
        <xsl:otherwise>portrait</xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <fo:page-sequence master-reference="{$master}" initial-page-number="auto" format="1" font-family="{$font.body}" font-size="12pt" force-page-count="end-on-even">
      <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="$master = 'portrait'"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <fo:block id="{generate-id()}" text-align="right" font-weight="bold" color="{$color.heading}" text-decoration="underline" space-after="4pt">APPENDIX &#8216;<xsl:value-of select="@label"/>&#8217;</fo:block>
        <fo:block text-align="center" font-weight="bold" color="{$color.heading}" text-decoration="underline" space-after="14pt"><xsl:value-of select="translate(@title, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/></fo:block>
        <xsl:apply-templates select="*" mode="body"/>
        <xsl:if test="not(following-sibling::appendix)"><fo:block id="main-last"/></xsl:if>
        <fo:block/>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <xsl:template name="first-aid-figure">
    <xsl:param name="file"/><xsl:param name="caption"/>
    <fo:block text-align="left" space-after="4pt" keep-together.within-page="always">
      <fo:block font-size="12pt" font-weight="bold" space-after="2pt" keep-with-next.within-page="always"><xsl:value-of select="$caption"/></fo:block>
      <fo:external-graphic src="url('{$assets.url}/{$file}')" content-width="44mm" content-height="scale-to-fit" scaling="uniform"/>
    </fo:block>
  </xsl:template>

</xsl:stylesheet>
