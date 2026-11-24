<?xml version="1.0" encoding="UTF-8"?>
<!--
  JSG engine - the Illustrated Spare Parts List (JSG_ISPL_Format.docx).

  Printed order (docs/JSG_STENCIL_ANALYSIS.md section 5):
    cover | verso | CERTIFICATE | PREFACE | AMENDMENTS | ABBREVIATIONS | LIST OF EQUIPMENT ALREADY SUPPLIED | CONTENTS (plate index) | the plates.
  A plate is: [a divider page for the first plate] then, for every view, a PICTURE page (plate caption, the picture(s), the red view caption) and a TABLE page (plate
  caption, the parts table). The plates are landscape A4 (296.9 x 210 mm, margins 20 / 20 / 15 / 15); the page number of those pages is printed under RESTRICTED in the
  header, RESTRICTED alone in the foot (header12 / footer11 of the Word file).

  Values: Times New Roman; front-matter titles bold #2D2DFF 18 pt (CONTENTS 14 pt); the Caption style is red bold 14 pt centred; tables are Times New Roman 10 pt with a
  0.5 pt grid; the parts table widths are the stencil's (twips, as proportions).
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">

  <xsl:param name="color.ispl">#2D2DFF</xsl:param>
  <xsl:variable name="upper">ABCDEFGHIJKLMNOPQRSTUVWXYZ</xsl:variable>
  <xsl:variable name="lower">abcdefghijklmnopqrstuvwxyz</xsl:variable>

  <xsl:template match="jsgdoc[@type = 'ispl']" mode="document">
    <xsl:call-template name="ispl-cover"/>
    <xsl:call-template name="ispl-front"/>
    <xsl:for-each select="plates/plate">
      <xsl:call-template name="ispl-plate"/>
    </xsl:for-each>
  </xsl:template>

  <!-- ===== cover (same family as the User Handbook's; the field order differs: NSN, A/T or S/O No., DATED) ===== -->
  <xsl:template name="ispl-cover">
    <fo:page-sequence master-reference="cover-seq" format="i" initial-page-number="1" force-page-count="end-on-even" font-family="{$font.body}" font-size="12pt">
      <xsl:call-template name="head-foot"><xsl:with-param name="page-numbers" select="false()"/><xsl:with-param name="blank" select="true()"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <fo:block text-align="right" font-weight="bold" font-size="14pt" space-after="10pt"><xsl:value-of select="meta/docNo"/>&#160;</fo:block>
        <fo:table table-layout="fixed" width="100%" border="0.75pt solid black" space-after="10pt">
          <fo:table-column column-width="100%"/>
          <fo:table-body><fo:table-row><fo:table-cell padding="3pt">
            <fo:block color="{$color.red}" text-align="justify">THE INFORMATION GIVEN IN THIS DOCUMENT IS NOT TO BE PUBLISHED OR COMMUNICATED, EITHER DIRECTLY OR INDIRECTLY TO THE PRESS OR TO ANY PERSON NOT AUTHORISED TO RECEIVE IT.</fo:block>
          </fo:table-cell></fo:table-row></fo:table-body>
        </fo:table>
        <fo:block text-align="center" space-before="6pt" space-after="10pt">
          <fo:external-graphic content-height="40.2mm" content-width="30.2mm" scaling="uniform">
            <xsl:attribute name="src"><xsl:choose><xsl:when test="meta/emblem != ''">url('<xsl:value-of select="meta/emblem"/>')</xsl:when><xsl:otherwise>url('<xsl:value-of select="$assets.url"/>/emblem.png')</xsl:otherwise></xsl:choose></xsl:attribute>
          </fo:external-graphic>
        </fo:block>
        <fo:block text-align="center" font-weight="bold" font-size="18pt" color="{$color.title}" line-height="20.7pt" space-before="14pt"><xsl:value-of select="meta/title"/></fo:block>
        <fo:block text-align="center" font-weight="bold" font-size="18pt" color="{$color.title}" line-height="20.7pt">FOR</fo:block>
        <fo:block text-align="center" font-weight="bold" font-size="18pt" color="{$color.title}" line-height="20.7pt" space-after="10pt"><xsl:value-of select="meta/projectName"/></fo:block>
        <fo:block text-align="center" font-size="14pt" line-height="20.7pt">NSN: <xsl:value-of select="meta/nsn"/></fo:block>
        <fo:block text-align="center" font-size="14pt" line-height="20.7pt">A/T or S/O No.: <xsl:value-of select="meta/atNo"/></fo:block>
        <fo:block text-align="center" font-size="14pt" line-height="20.7pt">DATED: <xsl:value-of select="meta/dated"/></fo:block>
        <fo:block text-align="center" font-weight="bold" space-before="14pt">SUPPLIED BY:</fo:block>
        <fo:block text-align="center" space-before="3pt">
          <fo:external-graphic content-height="16.9mm" content-width="20.1mm" scaling="uniform">
            <xsl:attribute name="src"><xsl:choose><xsl:when test="meta/logo != ''">url('<xsl:value-of select="meta/logo"/>')</xsl:when><xsl:otherwise>url('<xsl:value-of select="$assets.url"/>/supplier-logo.png')</xsl:otherwise></xsl:choose></xsl:attribute>
          </fo:external-graphic>
        </fo:block>
        <xsl:choose>
          <xsl:when test="meta/supplier/line"><xsl:for-each select="meta/supplier/line"><fo:block text-align="center" font-weight="bold" line-height="15.9pt"><xsl:value-of select="."/></fo:block></xsl:for-each></xsl:when>
          <xsl:otherwise><fo:block text-align="center" font-weight="bold" line-height="15.9pt">LARSEN &amp; TOUBRO LIMITED,</fo:block><fo:block text-align="center" font-weight="bold" line-height="15.9pt">PUNE 410507 INDIA</fo:block></xsl:otherwise>
        </xsl:choose>
        <fo:block text-align="center" font-weight="bold" space-before="14pt">ISSUED BY:</fo:block>
        <xsl:for-each select="meta/issuedBy/line"><fo:block text-align="center" line-height="15.9pt"><xsl:value-of select="."/></fo:block></xsl:for-each>
        <fo:block text-align="left" space-before="10pt" space-after="10pt" line-height="15.9pt"><xsl:value-of select="meta/issueDate"/></fo:block>
        <fo:table table-layout="fixed" width="100%" border="0.75pt solid black" font-size="11pt">
          <fo:table-column column-width="40mm"/><fo:table-column column-width="120mm"/>
          <fo:table-body><fo:table-row>
            <fo:table-cell padding="3pt" border="0.75pt solid black"><fo:block><fo:inline font-weight="bold">EQUIPMENT LIFE</fo:inline>: </fo:block></fo:table-cell>
            <fo:table-cell padding="3pt" border="0.75pt solid black"><fo:block text-align="left"><xsl:value-of select="meta/equipmentLife"/></fo:block></fo:table-cell>
          </fo:table-row></fo:table-body>
        </fo:table>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <!-- ===== front matter ===== -->
  <xsl:template name="ispl-title">
    <xsl:param name="text"/><xsl:param name="size">18pt</xsl:param>
    <fo:block font-weight="bold" font-size="{$size}" color="{$color.ispl}" text-align="center" space-after="12pt" keep-with-next.within-page="always"><xsl:value-of select="$text"/></fo:block>
  </xsl:template>

  <xsl:template name="ispl-front">
    <fo:page-sequence master-reference="portrait" format="i" initial-page-number="auto" force-page-count="end-on-even" font-family="{$font.body}" font-size="12pt">
      <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="true()"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <xsl:call-template name="ispl-certificate"/>
        <xsl:if test="front/preface"><xsl:call-template name="ispl-preface"/></xsl:if>
        <xsl:call-template name="ispl-amendments"/>
        <xsl:call-template name="ispl-abbreviations"/>
        <xsl:call-template name="ispl-supplied"/>
        <xsl:call-template name="ispl-contents"/>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <xsl:template name="ispl-certificate">
    <fo:block>
      <xsl:call-template name="ispl-title"><xsl:with-param name="text">C E R T I F I C A T E</xsl:with-param></xsl:call-template>
      <fo:block text-align="justify" font-size="14pt" line-height="20.7pt" space-before="40pt" space-after="60pt"><xsl:apply-templates select="front/certificate/node()" mode="inline"/></fo:block>
      <!-- the stencil's signature block: Date on the left, Name / Designation / Group on the right -->
      <fo:table table-layout="fixed" width="100%" font-size="14pt">
        <fo:table-column column-width="50%"/><fo:table-column column-width="50%"/>
        <fo:table-body>
          <fo:table-row height="12mm"><fo:table-cell><fo:block>Date :</fo:block></fo:table-cell><fo:table-cell><fo:block>Name&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;:</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row height="12mm"><fo:table-cell><fo:block>&#160;</fo:block></fo:table-cell><fo:table-cell><fo:block>Designation :</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row height="12mm"><fo:table-cell><fo:block>&#160;</fo:block></fo:table-cell><fo:table-cell><fo:block>Group&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;:</fo:block></fo:table-cell></fo:table-row>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <!-- the preface: numbered paragraphs (indent 2) with the lettered sub-list (hanging 680 twips) and its NOTE (indent 3) -->
  <xsl:template name="ispl-preface">
    <fo:block break-before="odd-page">
      <xsl:call-template name="ispl-title"><xsl:with-param name="text">PREFACE</xsl:with-param></xsl:call-template>
      <xsl:for-each select="front/preface/*">
        <xsl:choose>
          <xsl:when test="self::para and (not(@indent) or @indent = 2)">
            <fo:block text-align="justify" line-height="15.9pt" space-after="12pt"><xsl:value-of select="count(preceding-sibling::para[not(@indent) or @indent = 2]) + 1"/>. <xsl:apply-templates mode="inline"/></fo:block>
          </xsl:when>
          <xsl:when test="self::para">
            <fo:block text-align="justify" line-height="15.9pt" start-indent="34pt" space-after="12pt"><xsl:apply-templates mode="inline"/></fo:block>
          </xsl:when>
          <xsl:otherwise>
            <fo:list-block provisional-distance-between-starts="34pt" space-after="6pt">
              <xsl:for-each select="item">
                <fo:list-item space-after="6pt"><fo:list-item-label end-indent="label-end()"><fo:block>(<xsl:number format="a"/>)</fo:block></fo:list-item-label>
                  <fo:list-item-body start-indent="body-start()"><xsl:apply-templates mode="list-part"/></fo:list-item-body></fo:list-item>
              </xsl:for-each>
            </fo:list-block>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="ispl-cell">
    <xsl:param name="text" select="''"/><xsl:param name="align">center</xsl:param><xsl:param name="bold" select="false()"/><xsl:param name="span" select="1"/>
    <fo:table-cell border="0.5pt solid black" padding="1.4pt 3pt" display-align="center" number-columns-spanned="{$span}">
      <fo:block text-align="{$align}" line-height="11.5pt">
        <xsl:if test="$bold"><xsl:attribute name="font-weight">bold</xsl:attribute></xsl:if>
        <xsl:choose><xsl:when test="string($text) != ''"><xsl:value-of select="$text"/></xsl:when><xsl:otherwise>&#160;</xsl:otherwise></xsl:choose>
      </fo:block>
    </fo:table-cell>
  </xsl:template>

  <xsl:template name="ispl-amendments">
    <fo:block break-before="odd-page">
      <xsl:call-template name="ispl-title"><xsl:with-param name="text">AMENDMENTS</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(1893)"/><fo:table-column column-width="proportional-column-width(2775)"/>
        <fo:table-column column-width="proportional-column-width(2482)"/><fo:table-column column-width="proportional-column-width(2480)"/>
        <fo:table-header><fo:table-row>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Amendment No.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Authority</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Date of Amendment</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">By Whom Amended</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="front/amendments/row">
            <fo:table-row height="9mm">
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@no"/></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@authority"/></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@date"/></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@by"/></xsl:call-template>
            </fo:table-row>
          </xsl:for-each>
          <xsl:call-template name="blank-rows">
            <xsl:with-param name="n"><xsl:choose><xsl:when test="front/amendments/@minRows"><xsl:value-of select="front/amendments/@minRows - count(front/amendments/row)"/></xsl:when><xsl:otherwise><xsl:value-of select="20 - count(front/amendments/row)"/></xsl:otherwise></xsl:choose></xsl:with-param>
            <xsl:with-param name="cols" select="4"/><xsl:with-param name="h">9mm</xsl:with-param>
          </xsl:call-template>
          <xsl:if test="not(front/amendments) or (front/amendments/@minRows = 0 and not(front/amendments/row))"><xsl:call-template name="blank-rows"><xsl:with-param name="n" select="1"/><xsl:with-param name="cols" select="4"/></xsl:call-template></xsl:if>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="ispl-abbreviations">
    <fo:block break-before="odd-page">
      <xsl:call-template name="ispl-title"><xsl:with-param name="text">ABBREVIATIONS</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(1020)"/><fo:table-column column-width="proportional-column-width(2519)"/><fo:table-column column-width="proportional-column-width(6088)"/>
        <fo:table-header><fo:table-row>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Sr. No.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Abbreviation Issued</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">For</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="front/abbreviations/abbr">
            <fo:table-row>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="position()"/></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@short"/><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@long"/><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
            </fo:table-row>
          </xsl:for-each>
          <xsl:if test="not(front/abbreviations/abbr)"><xsl:call-template name="blank-rows"><xsl:with-param name="n" select="1"/><xsl:with-param name="cols" select="3"/></xsl:call-template></xsl:if>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="ispl-supplied">
    <fo:block break-before="odd-page">
      <xsl:call-template name="ispl-title"><xsl:with-param name="text">LIST OF EQUIPMENT ALREADY SUPPLIED AGAINST AT/SO</xsl:with-param></xsl:call-template>
      <fo:block text-align="justify" line-height="15.9pt" space-before="12pt" space-after="12pt">
        <fo:inline font-weight="bold">Name of the Equipment</fo:inline>: <xsl:value-of select="front/supplied/@equipment"/><xsl:if test="meta/atNo != ''"> supplied against A/T or S/O No. <xsl:value-of select="meta/atNo"/></xsl:if><xsl:if test="meta/dated != ''"> Dated <xsl:value-of select="meta/dated"/></xsl:if>.
      </fo:block>
      <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(1164)"/><fo:table-column column-width="proportional-column-width(2191)"/>
        <fo:table-column column-width="proportional-column-width(3212)"/><fo:table-column column-width="proportional-column-width(3063)"/>
        <fo:table-header><fo:table-row>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">S. No.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">DCAN No. / NSN</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Name of Item</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Supply Order Details</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="front/supplied/row">
            <fo:table-row>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@no"/></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@dcan"/></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@name"/><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@order"/><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
            </fo:table-row>
          </xsl:for-each>
          <!-- the stencil's table holds one row reading "Nil" when nothing has been supplied -->
          <xsl:if test="not(front/supplied/row)"><fo:table-row><xsl:call-template name="ispl-cell"><xsl:with-param name="text">Nil</xsl:with-param><xsl:with-param name="span" select="4"/></xsl:call-template></fo:table-row></xsl:if>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <!-- the contents: one row per plate, its pages as "first-last" -->
  <xsl:template name="ispl-contents">
    <fo:block break-before="odd-page">
      <xsl:call-template name="ispl-title"><xsl:with-param name="text">CONTENTS</xsl:with-param><xsl:with-param name="size">14pt</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(1209)"/><fo:table-column column-width="proportional-column-width(5387)"/>
        <fo:table-column column-width="proportional-column-width(1842)"/><fo:table-column column-width="proportional-column-width(1130)"/>
        <fo:table-header><fo:table-row>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">SR. NO.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <fo:table-cell border="0.5pt solid black" padding="1.4pt 3pt" display-align="center"><fo:block text-align="left" font-weight="bold">DESCRIPTION OF ASSEMBLY<fo:block/>/ SUB-ASSEMBLY / COMPONENTS</fo:block></fo:table-cell>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">PLATE REFERENCE</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">PAGE NO.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="plates/plate">
            <fo:table-row>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="position()"/></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="align">left</xsl:with-param>
                <xsl:with-param name="text"><xsl:choose><xsl:when test="@caption != ''"><xsl:value-of select="translate(@caption, $lower, $upper)"/></xsl:when><xsl:otherwise><xsl:value-of select="translate(@title, $lower, $upper)"/></xsl:otherwise></xsl:choose></xsl:with-param></xsl:call-template>
              <xsl:call-template name="ispl-cell"><xsl:with-param name="text">PLATE &#8211; <xsl:value-of select="@ref"/></xsl:with-param></xsl:call-template>
              <fo:table-cell border="0.5pt solid black" padding="1.4pt 3pt" display-align="center"><fo:block text-align="center" line-height="11.5pt"><fo:page-number-citation ref-id="pl-{generate-id()}"/>&#8211;<fo:page-number-citation ref-id="pe-{generate-id()}"/></fo:block></fo:table-cell>
            </fo:table-row>
          </xsl:for-each>
          <xsl:if test="not(plates/plate)"><xsl:call-template name="blank-rows"><xsl:with-param name="n" select="1"/><xsl:with-param name="cols" select="4"/></xsl:call-template></xsl:if>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <!-- ===== plates ===== -->
  <xsl:template name="ispl-landscape-head-foot">
    <fo:static-content flow-name="xsl-region-before">
      <fo:block font-size="9pt" text-align="center" padding-top="10mm"><xsl:value-of select="$classification"/></fo:block>
      <fo:block font-size="10pt" text-align="center">(<fo:page-number/>)</fo:block>
    </fo:static-content>
    <fo:static-content flow-name="xsl-region-after">
      <fo:block font-size="10pt" text-align="center" padding-bottom="10mm"><xsl:value-of select="$classification"/></fo:block>
    </fo:static-content>
  </xsl:template>

  <!-- "PLATE - I-A BRIDGING SYSTEM" -->
  <xsl:template name="plate-caption">
    <xsl:choose>
      <xsl:when test="@caption != ''"><xsl:value-of select="@caption"/></xsl:when>
      <xsl:otherwise>PLATE &#8211; <xsl:value-of select="@ref"/><xsl:text> </xsl:text><xsl:value-of select="translate(@title, $lower, $upper)"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="ispl-plate">
    <xsl:variable name="plate" select="."/>
    <fo:page-sequence master-reference="l-page" format="1" font-family="{$font.body}" font-size="12pt">
      <xsl:attribute name="initial-page-number"><xsl:choose><xsl:when test="not(preceding-sibling::plate)">1</xsl:when><xsl:otherwise>auto</xsl:otherwise></xsl:choose></xsl:attribute>
      <xsl:call-template name="ispl-landscape-head-foot"/>
      <fo:flow flow-name="xsl-region-body">
        <fo:block id="pl-{generate-id()}" font-size="1pt" line-height="1pt">&#160;</fo:block>
        <xsl:if test="@divider = 'true'">
          <fo:block text-align="center" font-weight="bold" font-size="36pt" color="{$color.heading}" line-height="46.6pt" space-before="30mm" break-after="page">
            PLATE &#8211; <xsl:value-of select="@ref"/><fo:block/><xsl:value-of select="translate(@title, $lower, $upper)"/>
            <fo:block space-before="8pt"><xsl:value-of select="translate(/jsgdoc/meta/projectName, $lower, $upper)"/></fo:block>
          </fo:block>
        </xsl:if>
        <xsl:for-each select="view">
          <xsl:variable name="last" select="position() = last()"/>
          <!-- the picture page -->
          <fo:block text-align="center" font-weight="bold" font-size="14pt" color="{$color.red}" space-after="12pt" keep-with-next.within-page="always">
            <xsl:for-each select="$plate"><xsl:call-template name="plate-caption"/></xsl:for-each>
          </fo:block>
          <xsl:call-template name="ispl-pictures"/>
          <xsl:if test="@caption != ''"><fo:block text-align="center" font-weight="bold" font-size="14pt" color="{$color.red}" space-before="8pt"><xsl:value-of select="@caption"/></fo:block></xsl:if>
          <xsl:if test="$plate/@divider = 'true' and position() = 1">
            <xsl:call-template name="ispl-index"><xsl:with-param name="plate" select="$plate"/></xsl:call-template>
          </xsl:if>
          <!-- the table page -->
          <xsl:if test="part">
            <fo:block break-before="page" text-align="center" font-weight="bold" font-size="14pt" color="{$color.red}" space-after="12pt" keep-with-next.within-page="always">
              <xsl:for-each select="$plate"><xsl:call-template name="plate-caption"/></xsl:for-each>
            </fo:block>
            <xsl:call-template name="ispl-parts"><xsl:with-param name="plate" select="$plate"/></xsl:call-template>
          </xsl:if>
          <xsl:if test="not($last)"><fo:block break-after="page" font-size="1pt" line-height="1pt">&#160;</fo:block></xsl:if>
        </xsl:for-each>
        <fo:block id="pe-{generate-id()}" font-size="1pt" line-height="1pt">&#160;</fo:block>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <!-- the picture(s) of a view: one centred picture, or a grid with the label of each below it -->
  <xsl:template name="ispl-pictures">
    <xsl:variable name="n" select="count(graphic)"/>
    <xsl:variable name="cols"><xsl:choose><xsl:when test="$n &lt;= 1">1</xsl:when><xsl:when test="$n = 2 or $n = 4">2</xsl:when><xsl:otherwise>3</xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:variable name="h"><xsl:choose><xsl:when test="$n &lt;= 1">115mm</xsl:when><xsl:when test="$n &lt;= 3">75mm</xsl:when><xsl:otherwise>42mm</xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:choose>
      <xsl:when test="$n = 0"><fo:block text-align="center" color="#808080" space-before="30mm">(no picture)</fo:block></xsl:when>
      <xsl:when test="$n = 1">
        <fo:block text-align="center">
          <fo:external-graphic src="url('{graphic/@src}')" width="266mm" height="{$h}" content-width="scale-to-fit" content-height="scale-to-fit" scaling="uniform"/>
        </fo:block>
      </xsl:when>
      <xsl:otherwise>
        <fo:table table-layout="fixed" width="100%">
          <xsl:call-template name="repeat-col"><xsl:with-param name="n" select="$cols"/></xsl:call-template>
          <fo:table-body>
            <xsl:for-each select="graphic[(position() - 1) mod $cols = 0]">
              <xsl:variable name="row" select=". | following-sibling::graphic[position() &lt; $cols]"/>
              <fo:table-row>
                <xsl:for-each select="$row"><fo:table-cell padding="2mm" text-align="center"><fo:block text-align="center">
                  <fo:external-graphic src="url('{@src}')" width="{floor(262 div $cols) - 6}mm" height="{$h}" content-width="scale-to-fit" content-height="scale-to-fit" scaling="uniform"/>
                </fo:block></fo:table-cell></xsl:for-each>
              </fo:table-row>
              <fo:table-row>
                <xsl:for-each select="$row"><fo:table-cell padding="0 2mm 2mm 2mm"><fo:block text-align="center" font-size="10pt"><xsl:value-of select="@label"/>&#160;</fo:block></fo:table-cell></xsl:for-each>
              </fo:table-row>
            </xsl:for-each>
          </fo:table-body>
        </fo:table>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>
  <xsl:template name="repeat-col">
    <xsl:param name="n"/>
    <xsl:if test="$n &gt; 0"><fo:table-column column-width="proportional-column-width(1)"/><xsl:call-template name="repeat-col"><xsl:with-param name="n" select="$n - 1"/></xsl:call-template></xsl:if>
  </xsl:template>

  <!-- the index of the first plate: its sub-plates (the plates whose reference is this one plus "-X") -->
  <xsl:template name="ispl-index">
    <xsl:param name="plate"/>
    <xsl:variable name="r" select="concat($plate/@ref, '-')"/>
    <xsl:variable name="kids" select="/jsgdoc/plates/plate[starts-with(@ref, $r) and not(contains(substring-after(@ref, $r), '-')) and not(contains(substring-after(@ref, $r), '/'))]"/>
    <xsl:if test="$kids">
      <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse" space-before="10pt">
        <fo:table-column column-width="proportional-column-width(6923)"/><fo:table-column column-width="proportional-column-width(8205)"/>
        <fo:table-header><fo:table-row>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Plate Ref. No.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Designation</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="$kids"><fo:table-row>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@ref"/></xsl:call-template>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@title"/></xsl:call-template>
          </fo:table-row></xsl:for-each>
        </fo:table-body>
      </fo:table>
    </xsl:if>
  </xsl:template>

  <!-- the parts table: 11 columns on a plate with a "for 1 set" column, else 10 (the stencil's twips as proportions) -->
  <xsl:template name="ispl-parts">
    <xsl:param name="plate"/>
    <xsl:variable name="set" select="$plate/@setColumn = 'true'"/>
    <xsl:variable name="unit" select="/jsgdoc/meta/qtyUnit"/>
    <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse">
      <xsl:choose>
        <xsl:when test="$set">
          <xsl:for-each select="document('')/*/xsl:variable[@name='widths11']/w"><fo:table-column column-width="proportional-column-width({.})"/></xsl:for-each>
        </xsl:when>
        <xsl:otherwise>
          <xsl:for-each select="document('')/*/xsl:variable[@name='widths10']/w"><fo:table-column column-width="proportional-column-width({.})"/></xsl:for-each>
        </xsl:otherwise>
      </xsl:choose>
      <fo:table-header>
        <fo:table-row>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Item No.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Plate Ref. No.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <fo:table-cell border="0.5pt solid black" padding="1.4pt 3pt" display-align="center"><fo:block text-align="center" font-weight="bold" line-height="11.5pt">'P'<fo:block font-size="6.5pt">Provide</fo:block></fo:block></fo:table-cell>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">NSN</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Designation</xsl:with-param><xsl:with-param name="bold" select="true()"/><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="bold" select="true()"/>
            <xsl:with-param name="text"><xsl:choose><xsl:when test="$set and $unit != ''">No. Off (<xsl:value-of select="$unit"/>)</xsl:when><xsl:otherwise>No. Off</xsl:otherwise></xsl:choose></xsl:with-param></xsl:call-template>
          <xsl:if test="$set"><xsl:call-template name="ispl-cell"><xsl:with-param name="text">No. Off (For 1 Set)</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template></xsl:if>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Drg. No.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Firms Part No.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Unit Price Rs.</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
          <xsl:call-template name="ispl-cell"><xsl:with-param name="text">Remark</xsl:with-param><xsl:with-param name="bold" select="true()"/></xsl:call-template>
        </fo:table-row>
      </fo:table-header>
      <fo:table-body>
        <xsl:for-each select="part">
          <fo:table-row keep-together.within-page="always">
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@item"/></xsl:call-template>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@plateRef"/></xsl:call-template>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@provide"/></xsl:call-template>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@nsn"/></xsl:call-template>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@designation"/><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@qty"/></xsl:call-template>
            <xsl:if test="$set"><xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@qtySet"/></xsl:call-template></xsl:if>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@drg"/></xsl:call-template>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@firmPart"/></xsl:call-template>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@price"/><xsl:with-param name="align">right</xsl:with-param></xsl:call-template>
            <xsl:call-template name="ispl-cell"><xsl:with-param name="text" select="@remark"/><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
          </fo:table-row>
        </xsl:for-each>
      </fo:table-body>
    </fo:table>
  </xsl:template>

  <xsl:variable name="widths11"><w>704</w><w>992</w><w>708</w><w>2411</w><w>2551</w><w>1135</w><w>1132</w><w>1843</w><w>1135</w><w>1419</w><w>1098</w></xsl:variable>
  <xsl:variable name="widths10"><w>705</w><w>1132</w><w>711</w><w>2411</w><w>3119</w><w>850</w><w>1985</w><w>1147</w><w>1262</w><w>1806</w></xsl:variable>

</xsl:stylesheet>
