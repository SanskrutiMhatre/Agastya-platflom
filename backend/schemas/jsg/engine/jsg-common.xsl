<?xml version="1.0" encoding="UTF-8"?>
<!--
  JSG engine - shared pieces: page geometry, running head and foot, inline text, paragraphs, lists, tables, figures, notices.

  Everything here is written for the JSG stencils (JSG_UHB_Stencil / JSG_UHB_Format / JSG_ISPL_Format). Nothing is shared with the JSS or S1000D stylesheets:
  this is a separate engine, and its values are the stencils' declared values (docs/JSG_STENCIL_ANALYSIS.md).

  Units: Word twips are converted to mm / pt where they appear (1 twip = 0.05 pt; 567 twips = 1 cm).
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">

  <!-- ===== parameters (all set by the build; the defaults are the stencils') ===== -->
  <xsl:param name="classification">RESTRICTED</xsl:param>
  <xsl:param name="blank.text">This page is intentionally left blank.</xsl:param>
  <xsl:param name="font.body">Times New Roman,Times,serif,DejaVu Sans</xsl:param>
  <xsl:param name="color.heading">#0000FF</xsl:param>
  <xsl:param name="color.title">#3333FF</xsl:param>
  <!-- the stencil's own artwork (emblem, supplier logo, first-aid figures): a file URL, set by the build -->
  <xsl:param name="assets.url"/>
  <xsl:param name="color.red">#FF0000</xsl:param>

  <!-- ===== page geometry (mm). A4 portrait is 210 x 296.9 in the stencils ===== -->
  <xsl:variable name="page.w">210mm</xsl:variable>
  <xsl:variable name="page.h">296.9mm</xsl:variable>
  <xsl:variable name="m.top">20mm</xsl:variable>
  <xsl:variable name="m.bottom">20mm</xsl:variable>
  <xsl:variable name="m.inner">25mm</xsl:variable>
  <xsl:variable name="m.outer">15mm</xsl:variable>

  <xsl:template name="layout-master-set">
    <fo:layout-master-set>
      <!-- portrait, mirrored margins: recto has the binding on the left -->
      <fo:simple-page-master master-name="p-odd" page-width="{$page.w}" page-height="{$page.h}" margin="0">
        <fo:region-body margin-top="{$m.top}" margin-bottom="{$m.bottom}" margin-left="{$m.inner}" margin-right="{$m.outer}"/>
        <fo:region-before extent="{$m.top}" margin-left="{$m.inner}" margin-right="{$m.outer}" display-align="before"/>
        <fo:region-after extent="{$m.bottom}" margin-left="{$m.inner}" margin-right="{$m.outer}" display-align="after"/>
      </fo:simple-page-master>
      <fo:simple-page-master master-name="p-even" page-width="{$page.w}" page-height="{$page.h}" margin="0">
        <fo:region-body margin-top="{$m.top}" margin-bottom="{$m.bottom}" margin-left="{$m.outer}" margin-right="{$m.inner}"/>
        <fo:region-before extent="{$m.top}" margin-left="{$m.outer}" margin-right="{$m.inner}" display-align="before"/>
        <fo:region-after extent="{$m.bottom}" margin-left="{$m.outer}" margin-right="{$m.inner}" display-align="after"/>
      </fo:simple-page-master>
      <!-- a page that exists only to put the next part on a right-hand page: the head, then the sentence -->
      <fo:simple-page-master master-name="p-blank-odd" page-width="{$page.w}" page-height="{$page.h}" margin="0">
        <fo:region-body margin-top="{$m.top}" margin-bottom="{$m.bottom}" margin-left="{$m.inner}" margin-right="{$m.outer}"/>
        <fo:region-before region-name="blank-head" extent="40mm" margin-left="{$m.inner}" margin-right="{$m.outer}" display-align="before"/>
        <fo:region-after extent="{$m.bottom}" margin-left="{$m.inner}" margin-right="{$m.outer}" display-align="after"/>
      </fo:simple-page-master>
      <fo:simple-page-master master-name="p-blank-even" page-width="{$page.w}" page-height="{$page.h}" margin="0">
        <fo:region-body margin-top="{$m.top}" margin-bottom="{$m.bottom}" margin-left="{$m.outer}" margin-right="{$m.inner}"/>
        <fo:region-before region-name="blank-head" extent="40mm" margin-left="{$m.outer}" margin-right="{$m.inner}" display-align="before"/>
        <fo:region-after extent="{$m.bottom}" margin-left="{$m.outer}" margin-right="{$m.inner}" display-align="after"/>
      </fo:simple-page-master>
      <!-- the cover: 25 mm both sides -->
      <fo:simple-page-master master-name="cover" page-width="{$page.w}" page-height="{$page.h}" margin="0">
        <fo:region-body margin-top="{$m.top}" margin-bottom="{$m.top}" margin-left="25mm" margin-right="25mm"/>
        <fo:region-before extent="{$m.top}" margin-left="25mm" margin-right="25mm" display-align="before"/>
        <fo:region-after extent="{$m.top}" margin-left="25mm" margin-right="25mm" display-align="after"/>
      </fo:simple-page-master>
      <!-- landscape A4 (296.9 x 210), margins 20 / 20 / 15 / 15 -->
      <fo:simple-page-master master-name="l-page" page-width="296.9mm" page-height="210mm" margin="0">
        <fo:region-body margin-top="20mm" margin-bottom="20mm" margin-left="15mm" margin-right="15mm"/>
        <fo:region-before extent="20mm" margin-left="15mm" margin-right="15mm" display-align="before"/>
        <fo:region-after extent="20mm" margin-left="15mm" margin-right="15mm" display-align="after"/>
      </fo:simple-page-master>
      <!-- landscape A3 (419.9 x 297) -->
      <fo:simple-page-master master-name="a3-page" page-width="419.9mm" page-height="297mm" margin="0">
        <fo:region-body margin-top="20mm" margin-bottom="20mm" margin-left="20mm" margin-right="20mm"/>
        <fo:region-before extent="20mm" margin-left="20mm" margin-right="20mm" display-align="before"/>
        <fo:region-after extent="20mm" margin-left="20mm" margin-right="20mm" display-align="after"/>
      </fo:simple-page-master>

      <!-- the cover is page one; the page after it is a blank verso (so the next part starts on a right-hand page) -->
      <fo:page-sequence-master master-name="cover-seq">
        <fo:repeatable-page-master-alternatives>
          <fo:conditional-page-master-reference master-reference="cover" page-position="first"/>
          <fo:conditional-page-master-reference master-reference="p-blank-odd" odd-or-even="odd" blank-or-not-blank="blank"/>
          <fo:conditional-page-master-reference master-reference="p-blank-even" odd-or-even="even" blank-or-not-blank="blank"/>
          <fo:conditional-page-master-reference master-reference="p-odd" odd-or-even="odd"/>
          <fo:conditional-page-master-reference master-reference="p-even" odd-or-even="even"/>
        </fo:repeatable-page-master-alternatives>
      </fo:page-sequence-master>
      <fo:page-sequence-master master-name="portrait">
        <fo:repeatable-page-master-alternatives>
          <fo:conditional-page-master-reference master-reference="p-blank-odd" odd-or-even="odd" blank-or-not-blank="blank"/>
          <fo:conditional-page-master-reference master-reference="p-blank-even" odd-or-even="even" blank-or-not-blank="blank"/>
          <fo:conditional-page-master-reference master-reference="p-odd" odd-or-even="odd"/>
          <fo:conditional-page-master-reference master-reference="p-even" odd-or-even="even"/>
        </fo:repeatable-page-master-alternatives>
      </fo:page-sequence-master>
    </fo:layout-master-set>
  </xsl:template>

  <!-- ===== running head and foot: the classification, centred, top and bottom; the page number in brackets under the foot ===== -->
  <xsl:template name="head-foot">
    <xsl:param name="page-numbers" select="true()"/>
    <!-- only the portrait page-sequence-master has the blank-page master (and its "blank-head" region) -->
    <xsl:param name="blank" select="false()"/>
    <fo:static-content flow-name="xsl-region-before">
      <fo:block font-size="9pt" text-align="center" padding-top="10mm"><xsl:value-of select="$classification"/></fo:block>
    </fo:static-content>
    <xsl:if test="$blank">
      <fo:static-content flow-name="blank-head">
        <fo:block font-size="9pt" text-align="center" padding-top="10mm"><xsl:value-of select="$classification"/></fo:block>
        <fo:block text-align="center" font-size="12pt" line-height="18pt" space-before="10mm"><xsl:value-of select="$blank.text"/></fo:block>
      </fo:static-content>
    </xsl:if>
    <fo:static-content flow-name="xsl-region-after">
      <fo:block font-size="10pt" text-align="center" padding-bottom="10mm">
        <fo:block><xsl:value-of select="$classification"/></fo:block>
        <xsl:if test="$page-numbers">
          <fo:block>(<fo:page-number/>)</fo:block>
        </xsl:if>
      </fo:block>
    </fo:static-content>
  </xsl:template>

  <!-- ===== inline text ===== -->
  <xsl:template match="b" mode="inline"><fo:inline font-weight="bold"><xsl:apply-templates mode="inline"/></fo:inline></xsl:template>
  <xsl:template match="i" mode="inline"><fo:inline font-style="italic"><xsl:apply-templates mode="inline"/></fo:inline></xsl:template>
  <xsl:template match="u" mode="inline"><fo:inline text-decoration="underline"><xsl:apply-templates mode="inline"/></fo:inline></xsl:template>
  <xsl:template match="sup" mode="inline"><fo:inline baseline-shift="super" font-size="75%"><xsl:apply-templates mode="inline"/></fo:inline></xsl:template>
  <xsl:template match="sub" mode="inline"><fo:inline baseline-shift="sub" font-size="75%"><xsl:apply-templates mode="inline"/></fo:inline></xsl:template>
  <xsl:template match="br" mode="inline"><fo:block/></xsl:template>
  <xsl:template match="xref" mode="inline">
    <fo:basic-link internal-destination="{@to}"><xsl:apply-templates mode="inline"/></fo:basic-link>
  </xsl:template>
  <xsl:template match="text()" mode="inline"><xsl:value-of select="."/></xsl:template>

  <!-- ===== paragraphs: L2 .. L5 are the stencil's left indents (454, 1174, 1304, 1474 twips) ===== -->
  <xsl:template name="indent-of">
    <xsl:param name="n" select="2"/>
    <xsl:choose>
      <xsl:when test="$n = 3">58.7pt</xsl:when>
      <xsl:when test="$n = 4">65.2pt</xsl:when>
      <xsl:when test="$n = 5">73.7pt</xsl:when>
      <xsl:otherwise>22.7pt</xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template match="para" mode="body">
    <xsl:variable name="ind"><xsl:call-template name="indent-of"><xsl:with-param name="n" select="@indent"/></xsl:call-template></xsl:variable>
    <fo:block start-indent="{$ind}" text-align="{@align}" line-height="15.9pt" space-before="3pt" space-after="3pt">
      <xsl:if test="not(@align)"><xsl:attribute name="text-align">justify</xsl:attribute></xsl:if>
      <xsl:apply-templates mode="inline"/>
    </fo:block>
  </xsl:template>

  <!-- lists: alpha (a)(b) hanging 25.5pt, number 1. 2., step "Step 1)" hanging 45.4pt, bullet / dash -->
  <xsl:template match="list" mode="body">
    <xsl:variable name="ind"><xsl:call-template name="indent-of"><xsl:with-param name="n" select="@indent"/></xsl:call-template></xsl:variable>
    <xsl:variable name="hang">
      <xsl:choose>
        <xsl:when test="@type = 'step'">45.4pt</xsl:when>
        <xsl:when test="@type = 'alpha'">25.5pt</xsl:when>
        <xsl:otherwise>22.7pt</xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <fo:list-block provisional-distance-between-starts="{$hang}" provisional-label-separation="4pt" start-indent="{$ind}" space-before="3pt" space-after="3pt">
      <xsl:for-each select="item">
        <fo:list-item space-before="3pt" space-after="3pt">
          <fo:list-item-label end-indent="label-end()">
            <fo:block>
              <xsl:choose>
                <xsl:when test="../@type = 'alpha'">(<xsl:number format="a"/>)</xsl:when>
                <xsl:when test="../@type = 'step'">Step <xsl:number format="1"/>)</xsl:when>
                <xsl:when test="../@type = 'bullet'">&#8226;</xsl:when>
                <xsl:when test="../@type = 'dash'">-</xsl:when>
                <xsl:otherwise><xsl:number format="1"/>.</xsl:otherwise>
              </xsl:choose>
            </fo:block>
          </fo:list-item-label>
          <fo:list-item-body start-indent="body-start()">
            <xsl:apply-templates mode="list-part"/>
          </fo:list-item-body>
        </fo:list-item>
      </xsl:for-each>
    </fo:list-block>
  </xsl:template>
  <xsl:template match="text" mode="list-part">
    <fo:block text-align="justify" line-height="15.9pt"><xsl:apply-templates mode="inline"/></fo:block>
  </xsl:template>
  <xsl:template match="para" mode="list-part">
    <fo:block text-align="justify" line-height="15.9pt"><xsl:apply-templates mode="inline"/></fo:block>
  </xsl:template>
  <xsl:template match="list" mode="list-part"><xsl:apply-templates select="." mode="body"/></xsl:template>

  <!-- ===== figures: the picture(s), then "Figure n: title" (the stencil's Caption: bold, centred, keep-with-next) ===== -->
  <xsl:template name="graphic">
    <fo:external-graphic src="url('{@src}')" content-width="scale-down-to-fit" content-height="scale-down-to-fit" width="100%" scaling="uniform">
      <xsl:if test="@width"><xsl:attribute name="width"><xsl:value-of select="@width"/></xsl:attribute></xsl:if>
      <xsl:if test="@height"><xsl:attribute name="height"><xsl:value-of select="@height"/></xsl:attribute></xsl:if>
    </fo:external-graphic>
  </xsl:template>

  <xsl:template match="figure" mode="body">
    <xsl:variable name="n"><xsl:number level="any" count="figure"/></xsl:variable>
    <fo:block id="fig-{$n}" text-align="center" space-before="6pt" keep-with-next.within-page="always">
      <xsl:if test="@id"><xsl:attribute name="id"><xsl:value-of select="@id"/></xsl:attribute></xsl:if>
      <xsl:for-each select="graphic">
        <fo:block text-align="center" space-after="3pt"><xsl:call-template name="graphic"/></fo:block>
      </xsl:for-each>
    </fo:block>
    <fo:block font-weight="bold" text-align="center" space-before="6pt" space-after="6pt" start-indent="7.1pt" id="figc-{$n}">Figure <xsl:value-of select="$n"/>: <xsl:value-of select="@title"/></fo:block>
  </xsl:template>

  <!-- ===== notices ===== -->
  <xsl:template match="note | warning | caution" mode="body">
    <fo:block start-indent="22.7pt" space-before="6pt" space-after="6pt" border="0.75pt solid black" padding="4pt" keep-together.within-page="always">
      <fo:block font-weight="bold"><xsl:value-of select="translate(local-name(), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/></fo:block>
      <xsl:for-each select="para"><fo:block text-align="justify" line-height="15.9pt"><xsl:apply-templates mode="inline"/></fo:block></xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template match="pageBreak" mode="body"><fo:block break-after="page"/></xsl:template>

  <!-- ===== tables: Times New Roman 10 pt, thin black grid, header row bold and repeated across pages ===== -->
  <xsl:template name="col-widths">
    <xsl:param name="list"/>
    <xsl:param name="n"/>
    <xsl:variable name="first" select="substring-before(concat(normalize-space($list), ' '), ' ')"/>
    <xsl:if test="$first != ''">
      <fo:table-column column-width="proportional-column-width({$first})"/>
      <xsl:call-template name="col-widths"><xsl:with-param name="list" select="substring-after(normalize-space($list), ' ')"/></xsl:call-template>
    </xsl:if>
  </xsl:template>

  <xsl:template match="table" mode="body">
    <xsl:variable name="n"><xsl:number level="any" count="table[@title]"/></xsl:variable>
    <xsl:if test="@title">
      <fo:block id="tabc-{$n}" font-weight="bold" text-align="center" space-before="6pt" space-after="6pt" keep-with-next.within-page="always">Table <xsl:value-of select="$n"/>: <xsl:value-of select="@title"/></fo:block>
    </xsl:if>
    <xsl:call-template name="grid-table"/>
  </xsl:template>

  <xsl:template name="grid-table">
    <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse" space-after="6pt">
      <xsl:choose>
        <xsl:when test="@widths"><xsl:call-template name="col-widths"><xsl:with-param name="list" select="@widths"/></xsl:call-template></xsl:when>
        <xsl:otherwise>
          <xsl:for-each select="(head/row | body/row)[1]/cell"><fo:table-column column-width="proportional-column-width(1)"/></xsl:for-each>
        </xsl:otherwise>
      </xsl:choose>
      <xsl:if test="head">
        <fo:table-header><xsl:apply-templates select="head/row" mode="row"><xsl:with-param name="head" select="true()"/></xsl:apply-templates></fo:table-header>
      </xsl:if>
      <fo:table-body><xsl:apply-templates select="body/row" mode="row"/></fo:table-body>
    </fo:table>
  </xsl:template>

  <xsl:template match="row" mode="row">
    <xsl:param name="head" select="false()"/>
    <fo:table-row keep-together.within-page="always">
      <xsl:apply-templates select="cell" mode="cell"><xsl:with-param name="head" select="$head"/></xsl:apply-templates>
    </fo:table-row>
  </xsl:template>

  <xsl:template match="cell" mode="cell">
    <xsl:param name="head" select="false()"/>
    <fo:table-cell border="0.5pt solid black" padding="2pt" display-align="center">
      <xsl:if test="@colspan"><xsl:attribute name="number-columns-spanned"><xsl:value-of select="@colspan"/></xsl:attribute></xsl:if>
      <xsl:if test="@rowspan"><xsl:attribute name="number-rows-spanned"><xsl:value-of select="@rowspan"/></xsl:attribute></xsl:if>
      <xsl:variable name="align">
        <xsl:choose><xsl:when test="@align = 'justify'">justify</xsl:when><xsl:when test="@align"><xsl:value-of select="@align"/></xsl:when><xsl:when test="$head">center</xsl:when><xsl:otherwise>left</xsl:otherwise></xsl:choose>
      </xsl:variable>
      <fo:block text-align="{$align}" line-height="11.5pt">
        <xsl:if test="$head or @bold = 'true'"><xsl:attribute name="font-weight">bold</xsl:attribute></xsl:if>
        <xsl:choose>
          <xsl:when test="*"><xsl:apply-templates mode="cellpart"/></xsl:when>
          <xsl:otherwise><xsl:text>&#160;</xsl:text></xsl:otherwise>
        </xsl:choose>
      </fo:block>
    </fo:table-cell>
  </xsl:template>
  <xsl:template match="text" mode="cellpart"><fo:block><xsl:apply-templates mode="inline"/></fo:block></xsl:template>
  <xsl:template match="para" mode="cellpart"><fo:block><xsl:apply-templates mode="inline"/></fo:block></xsl:template>
  <xsl:template match="list" mode="cellpart"><xsl:apply-templates select="." mode="body"/></xsl:template>
  <xsl:template match="graphic" mode="cellpart"><fo:block text-align="center"><xsl:call-template name="graphic"/></fo:block></xsl:template>

  <!-- ===== a part title page / page title helper ===== -->
  <xsl:template name="front-title">
    <xsl:param name="text"/>
    <xsl:param name="align">center</xsl:param>
    <!-- the stencil sets every front-matter title bold, blue (#0000FF), 14 pt -->
    <fo:block font-weight="bold" font-size="14pt" color="{$color.heading}" text-align="{$align}" space-after="14pt" keep-with-next.within-page="always"><xsl:value-of select="$text"/></fo:block>
  </xsl:template>

</xsl:stylesheet>
