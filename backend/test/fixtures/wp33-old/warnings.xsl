<?xml version="1.0" encoding="UTF-8"?>
<!-- ********************************************************************
     S1000D to XSL-FO: Warnings and Cautions
     
     Contains templates for processing warning and caution elements,
     including referenced warnings and cautions.
     ******************************************************************** -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">
    <!-- ==================================================================== -->
    <!--                    WARNING AND CAUTION REFS SECTION                   -->
    <!-- ==================================================================== -->
    <xsl:template match="warningAndCautionPara">
        <fo:block id="{generate-id()}" padding-top="{$standard-leading}">
            <xsl:apply-templates/>
        </fo:block>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    WARNING (Block)                                    -->
    <!-- ==================================================================== -->
    <xsl:template match="warning">
        <xsl:call-template name="notice">
            <xsl:with-param name="label">WARNING</xsl:with-param>
            <xsl:with-param name="color" select="$notice.warning.color"/>
        </xsl:call-template>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    CAUTION (Block)                                    -->
    <!-- ==================================================================== -->
    <xsl:template match="caution">
        <xsl:call-template name="notice">
            <xsl:with-param name="label">CAUTION</xsl:with-param>
            <xsl:with-param name="color" select="$notice.caution.color"/>
        </xsl:call-template>
    </xsl:template>

    <!--
      The note lived in common.xsl and warning/caution were defined BOTH there
      and here, at equal import precedence and equal priority — an outright
      conflict that xsltproc resolved silently by taking whichever came last.
      All three now live here, in one place, so what renders is decided by
      reading rather than by include order.
    -->
    <xsl:template match="note">
        <xsl:choose>
            <!--
              'label': a note is not a framed hazard notice but a bold "Note N"
              line, numbered through the data module, with its text set under
              it, indented, in the body weight - how the Xignal reference sets
              it. A note that follows another note takes no space above (the
              first one's bottom padding already separates them); any other
              note takes the usual space above.
            -->
            <xsl:when test="$note.style = 'label'">
                <!-- Inside a list item the note sits at the item's own text edge (the indent it inherits from the list item body),
                     directly under the paragraph above it; anywhere else it is placed from the publication's inner margin. -->
                <fo:block padding-bottom="{$note.pad.bottom}">
                    <xsl:if test="not(parent::listItem)">
                        <xsl:attribute name="start-indent"><xsl:value-of select="$inner-type-limit"/></xsl:attribute>
                    </xsl:if>
                    <xsl:attribute name="space-before">
                        <xsl:choose>
                            <xsl:when test="parent::listItem">0pt</xsl:when>
                            <xsl:when test="preceding-sibling::*[1][self::note]">0pt</xsl:when>
                            <xsl:otherwise><xsl:value-of select="$note.space.before"/></xsl:otherwise>
                        </xsl:choose>
                    </xsl:attribute>
                    <xsl:call-template name="unique-id-attr"/>
                    <fo:block font-weight="bold" keep-with-next.within-column="always">
                        <xsl:text>Note </xsl:text>
                        <xsl:number count="note" level="any" from="dmodule"/>
                    </fo:block>
                    <xsl:for-each select="notePara">
                        <fo:block>
                            <xsl:attribute name="start-indent">
                                <xsl:choose>
                                    <xsl:when test="parent::note/parent::listItem">inherited-property-value(start-indent) + <xsl:value-of select="$note.text.indent"/></xsl:when>
                                    <xsl:otherwise><xsl:value-of select="$inner-type-limit"/> + <xsl:value-of select="$note.text.indent"/></xsl:otherwise>
                                </xsl:choose>
                            </xsl:attribute>
                            <xsl:if test="preceding-sibling::notePara">
                                <xsl:attribute name="space-before"><xsl:value-of select="$para.space.before"/></xsl:attribute>
                            </xsl:if>
                            <xsl:apply-templates/>
                        </fo:block>
                    </xsl:for-each>
                </fo:block>
            </xsl:when>
            <xsl:otherwise>
                <xsl:call-template name="notice">
                    <xsl:with-param name="label">NOTE</xsl:with-param>
                    <xsl:with-param name="color" select="$notice.note.color"/>
                    <xsl:with-param name="content" select="notePara"/>
                    <xsl:with-param name="quiet">1</xsl:with-param>
                </xsl:call-template>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>

    <!--
      One notice, in whichever of the three styles $notice.style names.

      $content defaults to the warning/caution child element; a note passes its
      own. $quiet marks the note, which is informational and so is not set in
      bold or given the heavy rules the hazard notices get.
    -->
    <!--
      How the notice's own text is set. Shared by all three styles so that
      changing the frame never changes whether the words are readable as a
      hazard, and applied as ATTRIBUTES on the body block rather than by
      rewriting the string: text-transform leaves inline markup — an
      emphasis, a cross reference, a part number — exactly as authored,
      where translate() would have to walk the tree and would flatten it.
    -->
    <xsl:template name="notice-text-attrs">
        <xsl:if test="$notice.text.bold != '0'">
            <xsl:attribute name="font-weight">bold</xsl:attribute>
        </xsl:if>
        <xsl:if test="$notice.text.caps != '0'">
            <xsl:attribute name="text-transform">uppercase</xsl:attribute>
        </xsl:if>
    </xsl:template>

    <xsl:template name="notice">
        <xsl:param name="label"/>
        <xsl:param name="color"/>
        <xsl:param name="content" select="warningAndCautionPara"/>
        <xsl:param name="quiet">0</xsl:param>

        <xsl:choose>
            <!-- boxed -->
            <xsl:when test="$notice.style = 'boxed'">
                <fo:block keep-together.within-page="always"
                          margin-top="{$standard-leading}" margin-bottom="{$standard-leading}"
                          start-indent="{$inner-type-limit}">
                    <xsl:call-template name="unique-id-attr"/>
                    <fo:block border="2pt solid {$color}" padding="3mm">
                        <!-- The label sits in its own box, centred, above the
                             text. A block-container rather than a bordered
                             block so the border hugs the word instead of
                             running the width of the outer box. -->
                        <fo:block text-align="center" space-after="3mm">
                            <fo:inline border="2pt solid {$color}"
                                       color="{$color}" font-weight="bold"
                                       padding-left="12mm" padding-right="12mm"
                                       padding-top="1mm" padding-bottom="1mm">
                                <xsl:value-of select="$label"/>
                            </fo:inline>
                        </fo:block>
                        <fo:block>
                            <xsl:call-template name="notice-text-attrs"/>
                            <xsl:apply-templates select="$content"/>
                        </fo:block>
                    </fo:block>
                </fo:block>
            </xsl:when>

            <!-- jss -->
            <xsl:when test="$notice.style = 'jss'">
                <fo:block space-before="4mm" space-after="4mm"
                          keep-together.within-page="always"
                          start-indent="{$inner-type-limit}">
                    <xsl:call-template name="unique-id-attr"/>
                    <fo:block background-color="{$color}" color="white" font-weight="bold"
                              font-size="9pt" padding="1mm" padding-left="2mm">
                        <xsl:if test="$quiet = '1'">
                            <xsl:attribute name="font-style">italic</xsl:attribute>
                        </xsl:if>
                        <!-- The base-14 fonts carry no warning triangle, so
                             the alert is a boxed exclamation mark. -->
                        <fo:inline border="0.6pt solid white"
                                   padding-left="1mm" padding-right="1mm">!</fo:inline>
                        <xsl:text>  </xsl:text>
                        <xsl:value-of select="$label"/>
                    </fo:block>
                    <fo:block padding-top="1mm" padding-left="2mm" padding-bottom="1mm"
                              border-bottom="0.8pt solid black">
                        <xsl:call-template name="notice-text-attrs"/>
                        <xsl:apply-templates select="$content"/>
                    </fo:block>
                </fo:block>
            </xsl:when>

            <!--
              hazard: the industrial "hazard tape" frame — a diagonal
              yellow/black striped border for CAUTION, red/white for
              WARNING, around centred text on white. NOTE falls back to a
              plain thin border rather than either stripe set: a note is
              informational, not a hazard, and striping it would say
              something the content doesn't mean.

              Built as a 3x3 table rather than a border property: XSL-FO has
              no diagonal border, so the frame is four striped table-cells
              (plus four striped corners) surrounding a white centre cell,
              each side painted with the same tileable SVG background-image
              the corners use. A table cell's background always covers its
              full allocated area regardless of what is actually inside it,
              which is what lets the thin top/bottom/side cells paint a
              continuous frame at a fixed thickness while the centre cell's
              own content — however long — sets the row's real height.

              The stripe table sits inside two nested fo:block borders — a
              grey outer line then a black inner line — matching the
              reference hazard-tape artwork, which frames the diagonal
              stripes the same way before the content area.
            -->
            <xsl:when test="$notice.style = 'hazard'">
                <xsl:variable name="stripe.image">
                    <xsl:choose>
                        <xsl:when test="$label = 'CAUTION'"><xsl:value-of select="$notice.hazard.caution.image"/></xsl:when>
                        <xsl:when test="$label = 'WARNING'"><xsl:value-of select="$notice.hazard.warning.image"/></xsl:when>
                        <xsl:otherwise/>
                    </xsl:choose>
                </xsl:variable>
                <fo:block keep-together.within-page="always"
                          margin-top="{$standard-leading}" margin-bottom="{$standard-leading}"
                          start-indent="{$inner-type-limit}">
                    <xsl:call-template name="unique-id-attr"/>
                    <fo:block border="0.75pt solid #999999" padding="1mm">
                        <fo:block border="1.25pt solid black">
                            <fo:table table-layout="fixed" width="100%">
                                <fo:table-column column-width="4mm"/>
                                <fo:table-column column-width="proportional-column-width(1)"/>
                                <fo:table-column column-width="4mm"/>
                                <fo:table-body>
                                    <fo:table-row>
                                        <xsl:call-template name="hazard-frame-cell">
                                            <xsl:with-param name="image" select="$stripe.image"/>
                                        </xsl:call-template>
                                        <xsl:call-template name="hazard-frame-cell">
                                            <xsl:with-param name="image" select="$stripe.image"/>
                                        </xsl:call-template>
                                        <xsl:call-template name="hazard-frame-cell">
                                            <xsl:with-param name="image" select="$stripe.image"/>
                                        </xsl:call-template>
                                    </fo:table-row>
                                    <fo:table-row>
                                        <fo:table-cell background-image="url('{$stripe.image}')" background-repeat="repeat">
                                            <fo:block/>
                                        </fo:table-cell>
                                        <fo:table-cell background-color="white" padding="4mm">
                                            <fo:block text-align="center" font-weight="bold" font-size="12pt" space-after="2mm">
                                                <xsl:value-of select="$label"/>
                                            </fo:block>
                                            <fo:block text-align="center">
                                                <xsl:call-template name="notice-text-attrs"/>
                                                <xsl:apply-templates select="$content"/>
                                            </fo:block>
                                        </fo:table-cell>
                                        <fo:table-cell background-image="url('{$stripe.image}')" background-repeat="repeat">
                                            <fo:block/>
                                        </fo:table-cell>
                                    </fo:table-row>
                                    <fo:table-row>
                                        <xsl:call-template name="hazard-frame-cell">
                                            <xsl:with-param name="image" select="$stripe.image"/>
                                        </xsl:call-template>
                                        <xsl:call-template name="hazard-frame-cell">
                                            <xsl:with-param name="image" select="$stripe.image"/>
                                        </xsl:call-template>
                                        <xsl:call-template name="hazard-frame-cell">
                                            <xsl:with-param name="image" select="$stripe.image"/>
                                        </xsl:call-template>
                                    </fo:table-row>
                                </fo:table-body>
                            </fo:table>
                        </fo:block>
                    </fo:block>
                </fo:block>
            </xsl:when>

            <!--
              band: the Xignal reference's notice - a wide band of diagonal stripes (red/white for WARNING, black/yellow for CAUTION)
              with a white box inset in it holding the label, centred, and the text in bold, ragged right with its last line centred.
              The stripes are ONE tile image painted behind the whole band, so they run unbroken around the box.

              FOP puts a block's border and padding OUTSIDE its start-indent (the indent is the content edge), so both blocks are
              indented by what hangs outside them: the band's outline + stripe margin, and for the box also its own border + padding.
              That makes the band span the full text width and the box sit inset by the stripe margin, as on the reference.
            -->
            <xsl:when test="$notice.style = 'band'">
                <xsl:variable name="band.image">
                    <xsl:choose>
                        <xsl:when test="$label = 'CAUTION'"><xsl:value-of select="$notice.band.caution.image"/></xsl:when>
                        <xsl:when test="$label = 'WARNING'"><xsl:value-of select="$notice.band.warning.image"/></xsl:when>
                        <xsl:otherwise/>
                    </xsl:choose>
                </xsl:variable>
                <xsl:variable name="band.edge" select="number($notice.band.outline.width) + number($notice.band.pad)"/>
                <xsl:variable name="box.edge" select="number($notice.box.border.width) + number($notice.box.pad)"/>
                <fo:block keep-together.within-page="always"
                          space-before="{$notice.band.space.before}" space-after="{$notice.band.space.after}"
                          start-indent="{$inner-type-limit} + {$band.edge}pt" end-indent="{$band.edge}pt">
                    <xsl:call-template name="unique-id-attr"/>
                    <fo:block border="{$notice.band.outline.width}pt solid {$notice.band.outline.color}" padding="{$notice.band.pad}pt">
                        <xsl:if test="string($band.image) != ''">
                            <xsl:attribute name="background-image">url('<xsl:value-of select="$band.image"/>')</xsl:attribute>
                            <xsl:attribute name="background-repeat">repeat</xsl:attribute>
                        </xsl:if>
                        <fo:block background-color="white" border="{$notice.box.border.width}pt solid black" padding="{$notice.box.pad}pt"
                                  start-indent="{$inner-type-limit} + {$band.edge + $box.edge}pt" end-indent="{$band.edge + $box.edge}pt">
                            <fo:block text-align="center" font-weight="bold" font-size="12pt" space-after="{$notice.box.label.gap}pt">
                                <xsl:value-of select="$label"/>
                            </fo:block>
                            <!-- Ragged right, the last line centred (measured: the reference does not justify). The paragraphs are set
                                 here rather than through warningAndCautionPara, whose own leading would stack on the label gap. -->
                            <fo:block text-align="start" text-align-last="center">
                                <xsl:call-template name="notice-text-attrs"/>
                                <xsl:for-each select="$content">
                                    <fo:block>
                                        <xsl:if test="position() &gt; 1">
                                            <xsl:attribute name="space-before"><xsl:value-of select="$para.space.before"/></xsl:attribute>
                                        </xsl:if>
                                        <xsl:apply-templates/>
                                    </fo:block>
                                </xsl:for-each>
                            </fo:block>
                        </fo:block>
                    </fo:block>
                </fo:block>
            </xsl:when>

            <!-- classic (default) -->
            <xsl:otherwise>
                <fo:block keep-together.within-page="always"
                          margin-top="{$standard-leading}" margin-bottom="{$standard-leading}">
                    <xsl:call-template name="unique-id-attr"/>
                    <fo:block font-weight="bold" text-align="center" padding-bottom="3pt">
                        <xsl:if test="$quiet != '1'">
                            <xsl:attribute name="text-decoration">underline</xsl:attribute>
                        </xsl:if>
                        <xsl:value-of select="$label"/>
                    </fo:block>
                    <fo:block start-indent="10mm" end-indent="10mm">
                        <xsl:call-template name="notice-text-attrs"/>
                        <xsl:apply-templates select="$content"/>
                    </fo:block>
                </fo:block>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>
    <!--
      One striped cell for the hazard frame's top and bottom rows (six
      calls: three cells each). Thickness comes from the cell's own top+
      bottom padding around an empty block, not an explicit height — an
      fo:block-container with a fixed height inside a table-cell is a known
      source of FOP layout trouble (an early attempt at this using one
      produced a page with no text on it at all, no error reported). Padding
      is the same lever every other cell in this stylesheet already uses to
      set a fixed visual size, so it stays inside FOP's well-trodden path.
      The middle row's own left/right border cells are written directly at
      their call site instead of through this template, because they must
      NOT force a height — they need to inherit whatever height the centre
      content cell in that same row establishes.
    -->
    <xsl:template name="hazard-frame-cell">
        <xsl:param name="image"/>
        <fo:table-cell background-image="url('{$image}')" background-repeat="repeat"
                       padding-top="2mm" padding-bottom="2mm" padding-left="0" padding-right="0">
            <fo:block/>
        </fo:table-cell>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    WARNING REFS ATTRIBUTE                             -->
    <!-- ==================================================================== -->
    <xsl:template match="@warningRefs">
        <xsl:variable name="refs" select="."/>
        <xsl:call-template name="process-warning-refs">
            <xsl:with-param name="refs" select="$refs"/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template name="process-warning-refs">
        <xsl:param name="refs"/>
        <xsl:choose>
            <xsl:when test="contains($refs, ' ')">
                <xsl:variable name="first" select="substring-before($refs, ' ')"/>
                <xsl:variable name="rest" select="substring-after($refs, ' ')"/>
                <xsl:apply-templates select="//warning[@id = $first]"/>
                <xsl:call-template name="process-warning-refs">
                    <xsl:with-param name="refs" select="$rest"/>
                </xsl:call-template>
            </xsl:when>
            <xsl:otherwise>
                <xsl:apply-templates select="//warning[@id = $refs]"/>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    CAUTION REFS ATTRIBUTE                             -->
    <!-- ==================================================================== -->
    <xsl:template match="@cautionRefs">
        <xsl:variable name="refs" select="."/>
        <xsl:call-template name="process-caution-refs">
            <xsl:with-param name="refs" select="$refs"/>
        </xsl:call-template>
    </xsl:template>
    <xsl:template name="process-caution-refs">
        <xsl:param name="refs"/>
        <xsl:choose>
            <xsl:when test="contains($refs, ' ')">
                <xsl:variable name="first" select="substring-before($refs, ' ')"/>
                <xsl:variable name="rest" select="substring-after($refs, ' ')"/>
                <xsl:apply-templates select="//caution[@id = $first]"/>
                <xsl:call-template name="process-caution-refs">
                    <xsl:with-param name="refs" select="$rest"/>
                </xsl:call-template>
            </xsl:when>
            <xsl:otherwise>
                <xsl:apply-templates select="//caution[@id = $refs]"/>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    WARNINGS GROUP                                     -->
    <!-- ==================================================================== -->
    <xsl:template match="warningsGroup">
        <fo:block id="{generate-id()}">
            <xsl:apply-templates/>
        </fo:block>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    CAUTIONS GROUP                                     -->
    <!-- ==================================================================== -->
    <xsl:template match="cautionsGroup">
        <fo:block id="{generate-id()}">
            <xsl:apply-templates/>
        </fo:block>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    DANGER (Higher severity than warning)              -->
    <!-- ==================================================================== -->
    <xsl:template match="danger">
        <fo:block keep-together.within-page="always"
            margin-top="{$standard-leading}" margin-bottom="{$standard-leading}">
            <xsl:call-template name="unique-id-attr"/>
            <fo:block font-weight="bold" text-align="center" text-decoration="underline"
                padding-bottom="3pt">
                <xsl:text>DANGER</xsl:text>
            </fo:block>
            <!-- A danger outranks a warning; it follows the same text rule,
                 or the most severe notice in the book would be the one set
                 most quietly. -->
            <fo:block start-indent="10mm" end-indent="10mm">
                <xsl:call-template name="notice-text-attrs"/>
                <xsl:apply-templates/>
            </fo:block>
        </fo:block>
    </xsl:template>
    <!-- ==================================================================== -->
    <!--                    ATTENTIONLIST WARNINGS/CAUTIONS                    -->
    <!-- ==================================================================== -->
    <xsl:template match="attentionListAndWarning">
        <fo:block padding-top="{$standard-leading}">
            <xsl:apply-templates/>
        </fo:block>
    </xsl:template>
    <!--
      attentionRandomList and attentionSequentialList themselves live in
      lists.xsl, next to their fo:list-item template and the plain
      randomList/sequentialList they mirror. A second, blank-shaped copy of
      both lived here, at the same priority and included after lists.xsl — an
      outright conflict xsltproc resolved by silently taking this one. Both
      copies were missing the fo:list-block their own children need, so which
      one won made no visible difference: either way, a note or warning
      containing one of these lists made FOP reject the entire document.
    -->
</xsl:stylesheet>