<?xml version="1.0" encoding="UTF-8"?>
<!-- ********************************************************************
     S1000D to XSL-FO: "xignal" layout profile — running head, running foot
     and the rotated margin marks.

     Reproduces the page furniture of the Xignal / Docuneering S1000D
     Publication Builder output (reference: RDR-1671Y-00039-00, measured page
     by page). Active only when $layout.profile = 'xignal'; headers_footers.xsl
     dispatches here and otherwise keeps the engine's own furniture.

     Geometry, all measured from the reference (A4 portrait, points):
       head   a 19 mm band, rule 1.13 pt at its lower edge
              recto: logo | classification | publication code
              verso: publication code | classification | logo
       foot   a 19 mm band, rule 1.13 pt at its upper edge
              row A  applicability (10 pt) | data module code (bold)
              row B  "End of data module" (last page of a module only)
              row C  recto: classification | date  Page n
                     verso: Page n  date | classification
       marks  three 8 pt lines turned 90 degrees in the outer margin:
              draft line and printed stamp (a centred pair) and the company line

     Everything that is wording comes in as a parameter, resolved once per build
     (engine/brand.js): settings, publication comments, brand pack — in that
     order. An empty value simply leaves the item out.
     ******************************************************************** -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">

  <!-- Any CSS-style length to points. mm, cm, in and pt are what Settings can hold. -->
  <xsl:template name="xs-pt">
    <xsl:param name="v"/>
    <xsl:variable name="n" select="number(translate($v, translate($v, '0123456789.', ''), ''))"/>
    <xsl:variable name="u" select="translate($v, '0123456789.', '')"/>
    <xsl:choose>
      <xsl:when test="$u = 'mm'"><xsl:value-of select="$n * 2.834646"/></xsl:when>
      <xsl:when test="$u = 'cm'"><xsl:value-of select="$n * 28.34646"/></xsl:when>
      <xsl:when test="$u = 'in'"><xsl:value-of select="$n * 72"/></xsl:when>
      <xsl:otherwise><xsl:value-of select="$n"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- ==================================================================== -->
  <!--  RUNNING HEAD                                                          -->
  <!-- ==================================================================== -->
  <!--
    On an A3 landscape sheet the head and foot are the A4 portrait block set
    against the right-hand edge. The offset is made with a spacer COLUMN, not
    with margin-left on a block: FOP inherits that indent into the nested table
    and applies it twice, which put the whole block off the page.
  -->
  <xsl:template name="xs-a3-block">
    <xsl:param name="what"/>
    <xsl:param name="verso">0</xsl:param>
    <xsl:param name="height"/>
    <fo:table table-layout="fixed" width="100%">
      <fo:table-column column-width="{$xs.a3.left}"/>
      <fo:table-column column-width="proportional-column-width(1)"/>
      <fo:table-column column-width="{$xs.a3.right}"/>
      <fo:table-body>
        <fo:table-row>
          <xsl:if test="$height != ''"><xsl:attribute name="height"><xsl:value-of select="$height"/></xsl:attribute></xsl:if>
          <fo:table-cell><fo:block/></fo:table-cell>
          <fo:table-cell>
            <xsl:choose>
              <xsl:when test="$what = 'head'"><xsl:call-template name="xs-header-core"><xsl:with-param name="verso" select="$verso"/></xsl:call-template></xsl:when>
              <xsl:otherwise><xsl:call-template name="xs-footer-core"><xsl:with-param name="verso" select="$verso"/></xsl:call-template></xsl:otherwise>
            </xsl:choose>
          </fo:table-cell>
          <fo:table-cell><fo:block/></fo:table-cell>
        </fo:table-row>
      </fo:table-body>
    </fo:table>
  </xsl:template>

  <xsl:template name="xs-header">
    <xsl:param name="verso">0</xsl:param>
    <xsl:param name="a3">0</xsl:param>
    <xsl:choose>
      <xsl:when test="$a3 = '1'">
        <xsl:call-template name="xs-a3-block"><xsl:with-param name="what">head</xsl:with-param><xsl:with-param name="verso" select="$verso"/></xsl:call-template>
      </xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="xs-header-core"><xsl:with-param name="verso" select="$verso"/></xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="xs-header-core">
    <xsl:param name="verso">0</xsl:param>
    <!--
      The rule is the border of ONE container, not of the table: a table draws
      its bottom border cell by cell, and three abutting strokes anti-alias into
      a grey, slightly broken line where the reference has a single black one.
      The container is half a rule shorter than the band so the rule's centre
      lands on the band's edge, as the reference's does.
    -->
    <xsl:variable name="hh">
      <xsl:call-template name="xs-pt"><xsl:with-param name="v" select="$xs.hf.height"/></xsl:call-template>
    </xsl:variable>
    <fo:block-container height="{$hh - 0.565}pt" overflow="visible" border-bottom="{$xs.rule.width} solid black"
        font-family="{$font-stack}" font-size="{$header-footer-size}" font-weight="bold" line-height="1.2">
      <fo:table table-layout="fixed" width="100%">
        <fo:table-column column-width="proportional-column-width(1)"/>
        <fo:table-column column-width="proportional-column-width(1)"/>
        <fo:table-column column-width="proportional-column-width(1)"/>
        <fo:table-body>
          <fo:table-row>
            <fo:table-cell text-align="start" display-align="before">
              <fo:block>
                <xsl:choose>
                  <xsl:when test="$verso = '1'"><xsl:call-template name="xs-pubcode"/></xsl:when>
                  <xsl:otherwise><xsl:call-template name="xs-logo"/></xsl:otherwise>
                </xsl:choose>
              </fo:block>
            </fo:table-cell>
            <fo:table-cell text-align="center" display-align="before">
              <fo:block>
                <fo:retrieve-marker retrieve-class-name="chapter.classification"
                    retrieve-position="first-including-carryover" retrieve-boundary="page-sequence"/>
              </fo:block>
            </fo:table-cell>
            <!-- the outer cell ends flush with the rule on both sides: the publication code on a recto, the logo on a verso -->
            <fo:table-cell display-align="before" text-align="end">
              <fo:block>
                <xsl:choose>
                  <xsl:when test="$verso = '1'"><xsl:call-template name="xs-logo"/></xsl:when>
                  <xsl:otherwise><xsl:call-template name="xs-pubcode"/></xsl:otherwise>
                </xsl:choose>
              </fo:block>
            </fo:table-cell>
          </fo:table-row>
        </fo:table-body>
      </fo:table>
    </fo:block-container>
  </xsl:template>

  <xsl:template name="xs-pubcode">
    <fo:retrieve-marker retrieve-class-name="publication.code"
        retrieve-position="first-including-carryover" retrieve-boundary="page-sequence"/>
  </xsl:template>

  <!-- The logo is a plain project-relative file: no marker, no data-module
       lookup. Left out (not an error) when there is none. -->
  <xsl:template name="xs-logo">
    <xsl:if test="normalize-space($header.logo.uri) != ''">
      <fo:external-graphic src="url('{$header.logo.uri}')" content-height="{$header.logo.height}"
          content-width="{$header.logo.height}" scaling="uniform"/>
    </xsl:if>
  </xsl:template>

  <!-- ==================================================================== -->
  <!--  RUNNING FOOT                                                          -->
  <!-- ==================================================================== -->
  <xsl:template name="xs-footer">
    <xsl:param name="verso">0</xsl:param>
    <xsl:param name="a3">0</xsl:param>
    <xsl:param name="page-h" select="$page-height"/>
    <xsl:param name="page-w" select="$page-width"/>
    <!-- Marks stand in the outer margin of ordinary (A4 portrait) pages only;
         the reference carries none on its A3 landscape sheets. -->
    <xsl:if test="$a3 != '1' and $page-h = $page-height and $page-w = $page-width">
      <xsl:call-template name="xs-marks"><xsl:with-param name="verso" select="$verso"/></xsl:call-template>
    </xsl:if>
    <xsl:choose>
      <xsl:when test="$a3 = '1'">
        <fo:block-container height="{$xs.hf.height}" overflow="visible" display-align="before">
          <xsl:call-template name="xs-a3-block"><xsl:with-param name="what">foot</xsl:with-param><xsl:with-param name="verso" select="$verso"/><xsl:with-param name="height" select="$xs.hf.height"/></xsl:call-template>
        </fo:block-container>
      </xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="xs-footer-core"><xsl:with-param name="verso" select="$verso"/></xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="xs-footer-core">
    <xsl:param name="verso">0</xsl:param>
    <!--
      The master bottom-aligns this region (display-align="after"). FOP sizes
      that alignment from the FIRST row of a table only, so a three-row foot
      slid down by (region height - first row) and its last row left the page.
      Two measures make the foot immune to that and to its own content:

        * the whole foot is one block-container of exactly the region's height,
          so there is nothing left over for FOP to align, and it starts at the
          region's top edge, where the reference puts its rule;
        * each of the three rows is itself a fixed-height container, so a row
          can never grow or shrink with its text. "End of data module" is
          present only on a module's last page; without a fixed row its absence
          would move the date/page line up and down from page to page.
    -->
    <fo:block-container height="{$xs.hf.height}" overflow="visible" display-align="before">
      <!-- Row A: applicability and the data module code, under the rule -->
      <fo:block-container height="{$xs.foot.row.a}" overflow="visible" border-top="{$xs.rule.width} solid black"
          font-family="{$font-stack}" font-size="{$header-footer-size}" font-weight="bold" line-height="1.12">
        <!-- The code gets the larger share (3 of 5): it is one unbreakable-looking string, and a long model identification code
             (EXAMPLE-A-00-00-00-00A-009A-D) must stay on one line as the reference's does; the applicability wraps happily. -->
        <fo:table table-layout="fixed" width="100%">
          <xsl:choose>
            <xsl:when test="$verso = '1'">
              <fo:table-column column-width="proportional-column-width(3)"/>
              <fo:table-column column-width="proportional-column-width(2)"/>
            </xsl:when>
            <xsl:otherwise>
              <fo:table-column column-width="proportional-column-width(2)"/>
              <fo:table-column column-width="proportional-column-width(3)"/>
            </xsl:otherwise>
          </xsl:choose>
          <fo:table-body>
            <fo:table-row>
              <xsl:choose>
                <xsl:when test="$verso = '1'">
                  <fo:table-cell text-align="start" padding-top="{$xs.foot.pad.top}">
                    <fo:block><xsl:call-template name="xs-dmc"/></fo:block>
                  </fo:table-cell>
                  <fo:table-cell text-align="end" padding-top="{$xs.foot.pad.top}">
                    <xsl:call-template name="xs-applic"/>
                  </fo:table-cell>
                </xsl:when>
                <xsl:otherwise>
                  <fo:table-cell text-align="start" padding-top="{$xs.foot.pad.top}">
                    <xsl:call-template name="xs-applic"/>
                  </fo:table-cell>
                  <fo:table-cell text-align="end" padding-top="{$xs.foot.pad.top}">
                    <fo:block><xsl:call-template name="xs-dmc"/></fo:block>
                  </fo:table-cell>
                </xsl:otherwise>
              </xsl:choose>
            </fo:table-row>
          </fo:table-body>
        </fo:table>
      </fo:block-container>
      <!-- Row B: "End of data module" (centred; empty on every other page) -->
      <fo:block-container height="{$xs.foot.row.b}" overflow="visible"
          font-family="{$font-stack}" font-size="{$header-footer-size}" font-weight="bold" line-height="1.12">
        <fo:block text-align="center" padding-top="{$xs.foot.pad.top}">
          <fo:retrieve-marker retrieve-class-name="chapter.end.of.dm"
              retrieve-position="first-including-carryover" retrieve-boundary="page-sequence"/>
        </fo:block>
      </fo:block-container>
      <!-- Row C: classification and date / page number -->
      <fo:block-container height="{$xs.foot.row.a}" overflow="visible"
          font-family="{$font-stack}" font-size="{$header-footer-size}" font-weight="bold" line-height="1.12">
        <fo:table table-layout="fixed" width="100%">
          <fo:table-column column-width="proportional-column-width(1)"/>
          <fo:table-column column-width="proportional-column-width(1)"/>
          <fo:table-column column-width="proportional-column-width(1)"/>
          <fo:table-body>
            <fo:table-row>
              <xsl:choose>
                <xsl:when test="$verso = '1'">
                  <fo:table-cell text-align="start" padding-top="{$xs.foot.pad.top}">
                    <fo:block><xsl:text>Page </xsl:text><fo:page-number/><xsl:text>&#160; </xsl:text><xsl:call-template name="xs-issue-date"/></fo:block>
                  </fo:table-cell>
                  <fo:table-cell text-align="center" padding-top="{$xs.foot.pad.top}">
                    <fo:block><xsl:call-template name="xs-classification"/></fo:block>
                  </fo:table-cell>
                  <fo:table-cell padding-top="{$xs.foot.pad.top}"><fo:block/></fo:table-cell>
                </xsl:when>
                <xsl:otherwise>
                  <fo:table-cell padding-top="{$xs.foot.pad.top}"><fo:block/></fo:table-cell>
                  <fo:table-cell text-align="center" padding-top="{$xs.foot.pad.top}">
                    <fo:block><xsl:call-template name="xs-classification"/></fo:block>
                  </fo:table-cell>
                  <fo:table-cell text-align="end" padding-top="{$xs.foot.pad.top}">
                    <fo:block><xsl:call-template name="xs-issue-date"/><xsl:text>&#160; Page </xsl:text><fo:page-number/></fo:block>
                  </fo:table-cell>
                </xsl:otherwise>
              </xsl:choose>
            </fo:table-row>
          </fo:table-body>
        </fo:table>
      </fo:block-container>
    </fo:block-container>
  </xsl:template>

  <xsl:template name="xs-applic">
    <fo:block font-size="{$xs.applic.size}" font-weight="normal">
      <xsl:value-of select="$applic.prefix"/>
      <fo:retrieve-marker retrieve-class-name="chapter.applicability"
          retrieve-position="first-including-carryover" retrieve-boundary="page-sequence"/>
    </fo:block>
  </xsl:template>

  <xsl:template name="xs-dmc">
    <fo:retrieve-marker retrieve-class-name="chapter.data.module.code"
        retrieve-position="first-including-carryover" retrieve-boundary="page-sequence"/>
  </xsl:template>

  <xsl:template name="xs-issue-date">
    <fo:retrieve-marker retrieve-class-name="chapter.issue.date"
        retrieve-position="first-including-carryover" retrieve-boundary="page-sequence"/>
  </xsl:template>

  <xsl:template name="xs-classification">
    <fo:retrieve-marker retrieve-class-name="chapter.classification"
        retrieve-position="first-including-carryover" retrieve-boundary="page-sequence"/>
  </xsl:template>

  <!-- ==================================================================== -->
  <!--  MARGIN MARKS                                                          -->
  <!-- ==================================================================== -->
  <!--
    One line of text turned 90 degrees (reading upward), positioned from the
    page's top-left corner — the only anchor FOP honours for a fixed container.
    The container is as long as the line may be; text-align decides where the
    text sits inside that length. $x is where the BASELINE ends up, measured
    from the left page edge; $y is measured UP from the page bottom and is
    either the centre of the line ('center') or where it starts ('start', the
    first character at $y and the line running up from there).
  -->
  <xsl:template name="xs-mark">
    <xsl:param name="text"/>
    <xsl:param name="x"/>
    <xsl:param name="y"/>
    <xsl:param name="align">start</xsl:param>
    <xsl:if test="normalize-space($text) != ''">
      <xsl:variable name="ph">
        <xsl:call-template name="xs-pt"><xsl:with-param name="v" select="$page-height"/></xsl:call-template>
      </xsl:variable>
      <xsl:variable name="len" select="260"/>
      <xsl:variable name="top">
        <xsl:choose>
          <xsl:when test="$align = 'center'"><xsl:value-of select="($ph - $y) - $len div 2"/></xsl:when>
          <xsl:otherwise><xsl:value-of select="($ph - $y) - $len"/></xsl:otherwise>
        </xsl:choose>
      </xsl:variable>
      <fo:block-container absolute-position="fixed" top="{$top}pt" left="{$x - $xs.mark.baseline.offset}pt"
          width="{$len}pt" height="14pt" reference-orientation="90">
        <fo:block font-family="{$font-stack}" font-size="{$xs.mark.font.size}" font-weight="normal"
            line-height="1.2" wrap-option="no-wrap" text-align="{$align}">
          <xsl:value-of select="$text"/>
        </fo:block>
      </fo:block-container>
    </xsl:if>
  </xsl:template>

  <xsl:template name="xs-marks">
    <xsl:param name="verso">0</xsl:param>
    <xsl:variable name="dx"><xsl:choose>
      <xsl:when test="$verso = '1'"><xsl:value-of select="$xs.mark.verso.draft.x"/></xsl:when>
      <xsl:otherwise><xsl:value-of select="$xs.mark.recto.draft.x"/></xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:variable name="px"><xsl:choose>
      <xsl:when test="$verso = '1'"><xsl:value-of select="$xs.mark.verso.printed.x"/></xsl:when>
      <xsl:otherwise><xsl:value-of select="$xs.mark.recto.printed.x"/></xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:variable name="cx"><xsl:choose>
      <xsl:when test="$verso = '1'"><xsl:value-of select="$xs.mark.verso.company.x"/></xsl:when>
      <xsl:otherwise><xsl:value-of select="$xs.mark.recto.company.x"/></xsl:otherwise></xsl:choose></xsl:variable>
    <xsl:call-template name="xs-mark">
      <xsl:with-param name="text" select="$xs.mark.draft"/><xsl:with-param name="x" select="$dx"/>
      <xsl:with-param name="y" select="$xs.mark.center.y"/><xsl:with-param name="align">center</xsl:with-param>
    </xsl:call-template>
    <xsl:call-template name="xs-mark">
      <xsl:with-param name="text" select="$xs.mark.printed"/><xsl:with-param name="x" select="$px"/>
      <xsl:with-param name="y" select="$xs.mark.center.y"/><xsl:with-param name="align">center</xsl:with-param>
    </xsl:call-template>
    <xsl:call-template name="xs-mark">
      <xsl:with-param name="text" select="$xs.mark.company"/><xsl:with-param name="x" select="$cx"/>
      <xsl:with-param name="y" select="$xs.mark.company.y"/><xsl:with-param name="align">start</xsl:with-param>
    </xsl:call-template>
  </xsl:template>

</xsl:stylesheet>
