<?xml version="1.0" encoding="UTF-8"?>
<!-- ********************************************************************
     S1000D to XSL-FO: Tables Module
     
     Contains templates for table processing.
     ******************************************************************** -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">
  <!-- ==================================================================== -->
  <!--                         TABLE ATTRIBUTE SETS                          -->
  <!-- ==================================================================== -->
  <!-- Outer frame closed on all four sides, to match the full-grid cell
       ruling above (it previously had no start/end edge). -->
  <xsl:attribute-set name="table">
    <xsl:attribute name="border-before-width.conditionality">retain</xsl:attribute>
    <xsl:attribute name="border-collapse">collapse</xsl:attribute>
    <xsl:attribute name="border">0.6pt solid black</xsl:attribute>
    <xsl:attribute name="table-layout">fixed</xsl:attribute>
    <xsl:attribute name="width">100%</xsl:attribute>
  </xsl:attribute-set>
  <xsl:attribute-set name="table-bordered">
    <xsl:attribute name="border-before-width.conditionality">retain</xsl:attribute>
    <xsl:attribute name="border-collapse">collapse</xsl:attribute>
    <xsl:attribute name="border-start-style">solid</xsl:attribute>
    <xsl:attribute name="border-end-style">solid</xsl:attribute>
    <xsl:attribute name="border-top-style">solid</xsl:attribute>
    <xsl:attribute name="border-bottom-style">solid</xsl:attribute>
    <xsl:attribute name="border-start-width">0.5pt</xsl:attribute>
    <xsl:attribute name="border-end-width">0.5pt</xsl:attribute>
    <xsl:attribute name="border-top-width">0.5pt</xsl:attribute>
    <xsl:attribute name="border-bottom-width">0.5pt</xsl:attribute>
    <xsl:attribute name="border-start-color">black</xsl:attribute>
    <xsl:attribute name="border-end-color">black</xsl:attribute>
    <xsl:attribute name="border-top-color">black</xsl:attribute>
    <xsl:attribute name="border-bottom-color">black</xsl:attribute>
    <xsl:attribute name="table-layout">fixed</xsl:attribute>
    <xsl:attribute name="width">100%</xsl:attribute>
  </xsl:attribute-set>
  <!--
    Cells carry a full box border so tables render as a complete grid, matching
    the JSS pipeline's look (which puts border="0.6pt solid black" on every
    cell). Previously only horizontal rules were drawn — the CALS-faithful
    reading of rowsep/colsep, which left tables with no vertical separators and
    no outer left/right edge. The per-cell rowsep/colsep rules further down are
    now redundant rather than wrong: they re-assert edges this already draws.
  -->
  <xsl:attribute-set name="header-cell">
    <xsl:attribute name="padding"><xsl:value-of select="$table.cell.padding"/></xsl:attribute>
    <xsl:attribute name="border">0.6pt solid black</xsl:attribute>
    <xsl:attribute name="text-align">left</xsl:attribute>
  </xsl:attribute-set>
  <xsl:attribute-set name="body-cell">
    <xsl:attribute name="padding"><xsl:value-of select="$table.cell.padding"/></xsl:attribute>
    <xsl:attribute name="border">0.6pt solid black</xsl:attribute>
    <xsl:attribute name="text-align">left</xsl:attribute>
  </xsl:attribute-set>
  <!--
    The requirements tables (support equipment, consumables, spares, conditions ...): boxed, as the engine has always drawn them, or in the
    "rules" style the Xignal reference uses for them as for its References table - horizontal rules only, above the header row and under
    every row, no vertical lines, 2.85 pt above and below the text and 0.7 pt at the sides - when $refs.table.style = 'rules'. The columns
    of the three four-column tables and the spacing around them are the reference's (measured) in that style.
  -->
  <xsl:variable name="req.rules" select="$refs.table.style = 'rules'"/>
  <xsl:variable name="req.rule"><xsl:text>0.71pt solid </xsl:text><xsl:value-of select="$refs.rule.color"/></xsl:variable>
  <xsl:variable name="req.pad"><xsl:choose><xsl:when test="$req.rules"><xsl:value-of select="concat($refs.cell.pad, ' 0.7pt')"/></xsl:when><xsl:otherwise><xsl:value-of select="$table.cell.padding"/></xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:variable name="req.side"><xsl:choose><xsl:when test="$req.rules">0pt solid black</xsl:when><xsl:otherwise>0.6pt solid black</xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:variable name="req.rule.or.box"><xsl:choose><xsl:when test="$req.rules"><xsl:value-of select="$req.rule"/></xsl:when><xsl:otherwise>0.6pt solid black</xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:variable name="req.body.top"><xsl:choose><xsl:when test="$req.rules">0pt solid black</xsl:when><xsl:otherwise>0.6pt solid black</xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:variable name="req.c1"><xsl:choose><xsl:when test="$req.rules">32</xsl:when><xsl:otherwise>2</xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:variable name="req.c2"><xsl:choose><xsl:when test="$req.rules">36</xsl:when><xsl:otherwise>2</xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:variable name="req.c3"><xsl:choose><xsl:when test="$req.rules">13</xsl:when><xsl:otherwise>1</xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:variable name="req.c4"><xsl:choose><xsl:when test="$req.rules">19</xsl:when><xsl:otherwise>2</xsl:otherwise></xsl:choose></xsl:variable>
  <!-- heading to caption: the 8 pt of the boxed style, 20.5 pt in the reference; caption to table: 6 pt, 3.05 pt -->
  <xsl:variable name="req.gap.top"><xsl:choose><xsl:when test="$req.rules">20.5pt</xsl:when><xsl:otherwise><xsl:value-of select="$standard-leading"/></xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:variable name="req.cap.after"><xsl:choose><xsl:when test="$req.rules"><xsl:value-of select="$refs.caption.space.after"/></xsl:when><xsl:otherwise>6pt</xsl:otherwise></xsl:choose></xsl:variable>
  <xsl:attribute-set name="req-table">
    <xsl:attribute name="border-before-width.conditionality"><xsl:choose><xsl:when test="$req.rules">discard</xsl:when><xsl:otherwise>retain</xsl:otherwise></xsl:choose></xsl:attribute>
    <xsl:attribute name="border-collapse">collapse</xsl:attribute>
    <xsl:attribute name="border"><xsl:value-of select="$req.side"/></xsl:attribute>
    <xsl:attribute name="table-layout">fixed</xsl:attribute>
    <xsl:attribute name="width">100%</xsl:attribute>
  </xsl:attribute-set>
  <xsl:attribute-set name="req-header-cell">
    <xsl:attribute name="padding"><xsl:value-of select="$req.pad"/></xsl:attribute>
    <xsl:attribute name="border-top"><xsl:value-of select="$req.rule.or.box"/></xsl:attribute>
    <xsl:attribute name="border-bottom"><xsl:value-of select="$req.rule.or.box"/></xsl:attribute>
    <xsl:attribute name="border-left"><xsl:value-of select="$req.side"/></xsl:attribute>
    <xsl:attribute name="border-right"><xsl:value-of select="$req.side"/></xsl:attribute>
    <xsl:attribute name="text-align">left</xsl:attribute>
  </xsl:attribute-set>
  <xsl:attribute-set name="req-body-cell">
    <xsl:attribute name="padding"><xsl:value-of select="$req.pad"/></xsl:attribute>
    <xsl:attribute name="border-top"><xsl:value-of select="$req.body.top"/></xsl:attribute>
    <xsl:attribute name="border-bottom"><xsl:value-of select="$req.rule.or.box"/></xsl:attribute>
    <xsl:attribute name="border-left"><xsl:value-of select="$req.side"/></xsl:attribute>
    <xsl:attribute name="border-right"><xsl:value-of select="$req.side"/></xsl:attribute>
    <xsl:attribute name="text-align">left</xsl:attribute>
  </xsl:attribute-set>
  <!-- ==================================================================== -->
  <!--                         TABLE TEMPLATE                                -->
  <!-- ==================================================================== -->
  <xsl:template match="table">
    <!-- $table.indent, not 0: pinned to the margin the table began under the
         heading's NUMBER rather than beside its text, so it hung left of
         everything around it. The fo:table inside still uses 0pt, which is
         relative to this block. -->
    <fo:block padding-bottom="{$table.padding.bottom}" start-indent="{$table.indent}">
      <xsl:call-template name="block-top-space"><xsl:with-param name="size" select="$table.padding.top"/></xsl:call-template>
      <xsl:attribute name="id">
        <xsl:choose>
          <xsl:when test="@id">
            <xsl:call-template name="generate-link-id">
              <xsl:with-param name="localId" select="@id"/>
            </xsl:call-template>
          </xsl:when>
          <xsl:otherwise>
            <xsl:text>table-auto-</xsl:text>
            <xsl:value-of select="generate-id()"/>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:attribute>
      <!-- Table caption. With 'continued captions' on, a table that has rows carries its caption as the
           first row of its own header instead (see the thead template), so the same row repeats on every
           page the table runs onto. -->
      <xsl:if test="(title or $table.untitled.numbered = '1')
                    and not($table.continued.caption = '1' and count(tgroup) = 1 and tgroup/tbody/row/entry)">
      <fo:block font-style="italic" text-align="center" space-after="{$table.caption.space.after}">
        <xsl:if test="$table.caption.keep = '1'">
          <xsl:attribute name="keep-with-next.within-column">always</xsl:attribute>
          <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
        </xsl:if>
        <xsl:apply-templates select="." mode="label"/>
        <xsl:call-template name="caption-gap"/>
        <xsl:value-of select="title"/>
      </fo:block>
      </xsl:if>
      <xsl:apply-templates select="tgroup"/>
    </fo:block>
  </xsl:template>
  <xsl:template match="table" mode="number">
    <xsl:choose>
      <!-- JSS format: chapter-based numbering (1-1, 1-2, etc.) -->
      <xsl:when test="contains($document.format, 'JSS')">
        <!-- Chapter number (count description|procedure|faultIsolation|crew up to current chapter) -->
        <xsl:variable name="chapter-number">
          <xsl:number count="description|procedure|faultIsolation|crew" level="any" from="content"/>
        </xsl:variable>
        <!-- Table number within chapter -->
        <xsl:variable name="table-in-chapter">
          <xsl:number count="table|reqCondGroup|reqSupportEquips|reqSupplies|reqSpares" level="any" from="description|procedure|faultIsolation|crew"/>
        </xsl:variable>
        <xsl:value-of select="$chapter-number"/>
        <xsl:text>-</xsl:text>
        <xsl:value-of select="$table-in-chapter"/>
      </xsl:when>
      <!--
        Per data module, and not currently offered as a choice.

        The References table carries a hardcoded "Table 1" in every module,
        which is the S1000D convention and correct while numbering restarts per
        module. Counting through the book instead would leave seventeen
        Table 1s standing beside tables numbered 7, 11 and 18. Figures have no
        such fixed caption, which is why they DO offer the choice.
      -->
      <!-- A table with no title is not numbered when the house style leaves it uncaptioned. -->
      <xsl:when test="$table.untitled.numbered = '0'">
        <xsl:number count="content|reqCondGroup|reqSupportEquips|reqSupplies|reqSpares|table[title]" level="any" from="dmodule"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:number count="content|reqCondGroup|reqSupportEquips|reqSupplies|reqSpares|table" level="any" from="dmodule"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>
  <xsl:template match="table" mode="label">
    <xsl:text>Table </xsl:text>
    <xsl:apply-templates select="." mode="number"/>
  </xsl:template>
  <!-- ==================================================================== -->
  <!--                         TGROUP TEMPLATE                               -->
  <!-- ==================================================================== -->
  <!--
    A table declares its columns with <colspec>, but authored CALS routinely
    disagrees with itself: a tgroup says cols="2" while a row carries three or
    four <entry> elements, usually because columns of data were added and the
    count was never updated. FOP treats that as FATAL ("the number of cells in
    the row overflows the number of fo:table-columns") and abandons the entire
    render, so one bad table meant no PDF at all.

    Declaring enough columns for the widest row keeps the document renderable.
    The extra columns are proportional, so a correct table is completely
    unaffected — count(colspec) already covers its widest row, and nothing is
    added.
  -->
  <xsl:template match="tgroup">
    <xsl:variable name="declared" select="count(colspec)"/>
    <!-- XSLT 1.0 has no max(): sort the rows by cell count and take the first. -->
    <xsl:variable name="widest">
      <xsl:for-each select="thead/row | tbody/row | row">
        <xsl:sort select="count(entry)" data-type="number" order="descending"/>
        <xsl:if test="position() = 1"><xsl:value-of select="count(entry)"/></xsl:if>
      </xsl:for-each>
    </xsl:variable>
    <!--
      No start-indent here, deliberately: it INHERITS the wrapper's.

      start-indent is an inherited property whose computed value is measured
      from the reference area — the region body — not from the parent block.
      So "0pt" here does not mean "flush with my parent", it means "flush with
      the page margin", and it cancelled the wrapper's indent outright. The
      wrapper appeared correct in the FO and the table still rendered hard
      against the margin, which is a difficult thing to see by reading the
      output.

      end-indent stays 0pt for the same reason read the other way: it pins the
      right edge to the region's end, so the table still runs to the margin.
    -->
    <xsl:variable name="cols">
      <xsl:choose>
        <xsl:when test="number($widest) &gt; $declared"><xsl:value-of select="number($widest)"/></xsl:when>
        <xsl:otherwise><xsl:value-of select="$declared"/></xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <fo:table xsl:use-attribute-sets="table-bordered" table-omit-header-at-break="false"
        end-indent="0pt">
      <xsl:apply-templates select="colspec"/>
      <xsl:call-template name="filler-columns">
        <xsl:with-param name="n" select="number($widest) - $declared"/>
      </xsl:call-template>
      <xsl:apply-templates select="thead">
        <xsl:with-param name="cols" select="number($cols)"/>
      </xsl:apply-templates>
      <xsl:if test="not(thead) and $table.continued.caption = '1' and count(parent::table/tgroup) = 1 and tbody/row/entry
                    and (parent::table/title or $table.untitled.numbered = '1')">
        <fo:table-header start-indent="0pt" end-indent="0pt">
          <xsl:call-template name="table-caption-row"><xsl:with-param name="cols" select="number($cols)"/></xsl:call-template>
        </fo:table-header>
      </xsl:if>
      <xsl:apply-templates select="tbody"/>
    </fo:table>
  </xsl:template>
  <!-- $n equal-width columns; nothing at all when $n is zero, negative or NaN. -->
  <xsl:template name="filler-columns">
    <xsl:param name="n"/>
    <xsl:if test="$n &gt;= 1">
      <fo:table-column column-width="proportional-column-width(1)"/>
      <xsl:call-template name="filler-columns">
        <xsl:with-param name="n" select="$n - 1"/>
      </xsl:call-template>
    </xsl:if>
  </xsl:template>
  <!-- ==================================================================== -->
  <!--                         COLUMN SPEC                                   -->
  <!-- ==================================================================== -->
  <xsl:template match="colspec">
    <fo:table-column>
      <xsl:apply-templates select="@colwidth"/>
    </fo:table-column>
  </xsl:template>
  <xsl:template match="@colwidth">
    <xsl:attribute name="column-width">
      <xsl:choose>
        <xsl:when test="contains(., '*')">
          <xsl:value-of select="concat('proportional-column-width(', substring-before(., '*'), ')')"/>
        </xsl:when>
        <xsl:otherwise>
          <xsl:value-of select="."/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:attribute>
  </xsl:template>
  <!-- ==================================================================== -->
  <!--                         TABLE HEADER                                  -->
  <!-- ==================================================================== -->
  <xsl:template match="thead">
    <xsl:param name="cols" select="1"/>
    <fo:table-header start-indent="0pt" end-indent="0pt" font-weight="bold">
      <xsl:if test="$table.continued.caption = '1' and count(ancestor::table[1]/tgroup) = 1 and ../tbody/row/entry
                    and (ancestor::table[1]/title or $table.untitled.numbered = '1')">
        <xsl:call-template name="table-caption-row"><xsl:with-param name="cols" select="$cols"/></xsl:call-template>
      </xsl:if>
      <xsl:apply-templates select="row"/>
    </fo:table-header>
  </xsl:template>

  <!--
    The caption row of a table whose caption repeats ("Table 2 Title (Continued)"
    on every page after the first). It is the first row of the header, so it
    repeats with it, and its text is RETRIEVED from a marker carried by the body
    rows that start on the page: the first body row's marker is the plain
    caption, every later row's adds the "(Continued)" text, so a page that starts
    on the table shows the plain one and a page that starts part-way shows the
    other.

    The row has a fixed height. FOP sizes a row before it fills in what a marker
    retrieves, so left to the content the row would be as tall as an empty one
    and the retrieved text would print over the rows above. The height is the
    caption's line plus the gap under it, which is what the separate caption
    block and its space-after came to, so a table reads the same as before.
  -->
  <!--
    The space above a table / references block. 'padding' (the default) is kept at the top of a page; 'space' is a
    forced space-before that is dropped there, as it is in the Xignal print: the table then starts at the page top.
  -->
  <xsl:template name="block-top-space">
    <xsl:param name="size"/>
    <xsl:choose>
      <xsl:when test="$table.top.space = 'space'">
        <xsl:attribute name="space-before"><xsl:value-of select="$size"/></xsl:attribute>
        <xsl:attribute name="space-before.precedence">force</xsl:attribute>
      </xsl:when>
      <xsl:otherwise>
        <xsl:attribute name="padding-top"><xsl:value-of select="$size"/></xsl:attribute>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="table-caption-row">
    <xsl:param name="cols" select="1"/>
    <fo:table-row height="{$table.continued.row.height}" keep-with-next.within-column="always">
      <fo:table-cell number-columns-spanned="{$cols}" padding="0pt" border-style="none">
        <fo:block font-weight="normal" font-style="italic" text-align="center">
          <fo:retrieve-table-marker retrieve-class-name="table-continued"
              retrieve-position-within-table="first-starting"
              retrieve-boundary-within-table="table-fragment"/>
        </fo:block>
      </fo:table-cell>
    </fo:table-row>
  </xsl:template>
  <xsl:template match="thead//para">
    <fo:block font-weight="bold">
      <xsl:apply-templates/>
    </fo:block>
  </xsl:template>
  <!-- ==================================================================== -->
  <!--                         TABLE BODY                                    -->
  <!-- ==================================================================== -->
  <xsl:template match="tbody">
    <fo:table-body start-indent="0pt" end-indent="0pt">
      <xsl:apply-templates select="row"/>
    </fo:table-body>
  </xsl:template>
  <xsl:template match="tbody//para">
    <fo:block>
      <xsl:apply-templates/>
    </fo:block>
  </xsl:template>
  <!-- ==================================================================== -->
  <!--                    SOFT WRAPPING IN CELLS                             -->
  <!-- ==================================================================== -->
  <!--
    Long unbroken cell values (part numbers, drawing numbers, file paths) and
    ordinary words in a narrow column otherwise print straight through the column
    rule and over the neighbouring cell. wrap-option="wrap" does not help: it is
    already the default, and the problem is not that wrapping is switched off but
    that the value offers nowhere to wrap. FOP breaks lines per UAX #14, which
    allows a break after an alphabetic hyphen, forbids one inside a numeric
    sequence, and offers none at all inside a word. So "NU-BEJS-0358-22-001A"
    breaks after "NU-" and then overflows, and "Parameter" overflows into the next
    cell in a table whose colspecs carry no colwidth and are therefore split evenly.

    The fix is to offer FOP a break opportunity at every interior position of an
    over-long token and let its line breaker choose the one that best fills the
    cell. Which character to use depends on what the token is:

      prose word   U+00AD SOFT HYPHEN, so a break renders as "Para-" / "meter".
                   FOP draws the hyphen only where it actually breaks and leaves it
                   invisible elsewhere, which is what a reader expects of a wrapped
                   word. (hyphenate="true" is not an option here: no hyphenation
                   patterns are bundled with FOP, so it silently does nothing.)

      identifier   U+200B ZERO WIDTH SPACE, never a hyphen: one inserted into the
                   middle of a part number would read as part of the number.

    Neither character needs a glyph the fonts lack: U+00AD is in WinAnsi, and FOP
    consumes U+200B as a break opportunity without asking the font for it.

    No break is offered within the first or last "edge" characters, so at least three letters stay
    on each line. Without that floor FOP, which picks the break that best
    fills the line rather than the one a dictionary would, produced
    "Fl-owrate". Tokens no
    longer than min-token are copied verbatim and pay no per-character recursion.

min-token is deliberately low. An 11-column table whose colspecs carry no
colwidth gives each column about 15mm, and at 10pt an eight-letter word such
as "Pressure" or "Flowrate" already exceeds that, so a threshold that only
caught long words left the very collisions it was meant to fix. Offering a
break costs nothing when the text fits: FOP takes one only when the line
would otherwise overflow, so wide columns are unaffected.
  -->
  <xsl:param name="table.wrap.min-token">5</xsl:param>
  <xsl:param name="table.wrap.edge">3</xsl:param>
  <!-- 1 offers hyphenated break points inside long prose words in table cells (engine default); 0 wraps at spaces only. -->
  <xsl:param name="table.wrap.hyphen">1</xsl:param>
  <xsl:variable name="zwsp" select="'&#x200B;'"/>
  <xsl:variable name="shy" select="'&#xAD;'"/>
  <xsl:variable name="alpha" select="'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'"/>

  <!-- Outranks the built-in text() rule, and matches cell text only, so every
       text node outside a table is left exactly as it was. -->
  <xsl:template match="text()[ancestor::entry]">
    <xsl:call-template name="soft-wrap-text">
      <xsl:with-param name="text" select="translate(., '&#10;&#13;&#9;', '   ')"/>
    </xsl:call-template>
  </xsl:template>

  <!-- Splits on spaces so only the over-long tokens are examined character by
       character; the spaces themselves are already break opportunities. -->
  <xsl:template name="soft-wrap-text">
    <xsl:param name="text"/>
    <xsl:choose>
      <xsl:when test="contains($text, ' ')">
        <xsl:call-template name="soft-wrap-token">
          <xsl:with-param name="token" select="substring-before($text, ' ')"/>
        </xsl:call-template>
        <xsl:text> </xsl:text>
        <xsl:call-template name="soft-wrap-text">
          <xsl:with-param name="text" select="substring-after($text, ' ')"/>
        </xsl:call-template>
      </xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="soft-wrap-token">
          <xsl:with-param name="token" select="$text"/>
        </xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- A token of letters only is prose and breaks with a visible hyphen;
       anything else is an identifier and breaks invisibly. -->
  <xsl:template name="soft-wrap-token">
    <xsl:param name="token"/>
    <xsl:variable name="len" select="string-length($token)"/>
    <xsl:choose>
      <!-- $table.wrap.hyphen = 0: a prose word is never broken (a house style that wraps only at spaces);
           identifiers keep their invisible break points either way. -->
      <xsl:when test="$len &gt; number($table.wrap.min-token)
                      and not(contains($token, '&#160;'))
                      and not($table.wrap.hyphen = '0' and translate($token, $alpha, '') = '')">
        <xsl:variable name="brk">
          <xsl:choose>
            <xsl:when test="translate($token, $alpha, '') = ''">
              <xsl:value-of select="$shy"/>
            </xsl:when>
            <xsl:otherwise>
              <xsl:value-of select="$zwsp"/>
            </xsl:otherwise>
          </xsl:choose>
        </xsl:variable>
        <xsl:call-template name="soft-wrap-chars">
          <xsl:with-param name="token" select="$token"/>
          <xsl:with-param name="pos" select="1"/>
          <xsl:with-param name="len" select="$len"/>
          <xsl:with-param name="brk" select="$brk"/>
        </xsl:call-template>
      </xsl:when>
      <xsl:otherwise><xsl:value-of select="$token"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- Emits one character at a time, following it with the break character while
       at least "edge" characters remain on either side. -->
  <xsl:template name="soft-wrap-chars">
    <xsl:param name="token"/>
    <xsl:param name="pos"/>
    <xsl:param name="len"/>
    <xsl:param name="brk"/>
    <xsl:if test="$token != ''">
      <xsl:value-of select="substring($token, 1, 1)"/>
      <xsl:if test="$pos &gt;= number($table.wrap.edge) and
                    $len - $pos &gt;= number($table.wrap.edge)">
        <xsl:value-of select="$brk"/>
      </xsl:if>
      <xsl:call-template name="soft-wrap-chars">
        <xsl:with-param name="token" select="substring($token, 2)"/>
        <xsl:with-param name="pos" select="$pos + 1"/>
        <xsl:with-param name="len" select="$len"/>
        <xsl:with-param name="brk" select="$brk"/>
      </xsl:call-template>
    </xsl:if>
  </xsl:template>

  <!-- ==================================================================== -->
  <!--                         TABLE ROWS                                    -->
  <!-- ==================================================================== -->
  <xsl:template match="row">
    <!-- A row that starts a row span is the head of a group FOP can only place as a unit; keeping that
         row whole as well can make the group unbreakable, so $table.rowspan.keep decides for it alone. -->
    <xsl:variable name="row.keep">
      <xsl:choose>
        <xsl:when test="entry[@morerows]"><xsl:value-of select="$table.rowspan.keep"/></xsl:when>
        <xsl:otherwise><xsl:value-of select="$table.row.keep"/></xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <fo:table-row>
      <xsl:attribute name="keep-together.within-column"><xsl:value-of select="$row.keep"/></xsl:attribute>
      <!--
        FOP acts on a row's keep-together only when it is given as within-page; within-column alone leaves a tall row free to split across two
        pages (measured: the same table filled each page to the bottom and ran a page shorter than the reference). The Xignal reference never
        splits a row - its pages end early (at 165, 138, 186 pt on module 400A) when the next row would not fit - and with the keep given as
        within-page the module is 12 pages, as it is there. The profile therefore gives both.
      -->
      <xsl:if test="$layout.profile = 'xignal'">
        <xsl:attribute name="keep-together.within-page"><xsl:value-of select="$row.keep"/></xsl:attribute>
      </xsl:if>
      <xsl:if test="parent::thead">
        <xsl:attribute name="keep-with-next.within-column">always</xsl:attribute>
      </xsl:if>
      <!-- A group of rows tied together by a row span stays on one page: every row of the group but its last is
           kept with the next one. (A group taller than a page cannot be kept and breaks as it must.) -->
      <xsl:if test="$table.rowspan.group.keep = '1' and parent::tbody">
        <xsl:variable name="p" select="count(preceding-sibling::row) + 1"/>
        <xsl:if test="(preceding-sibling::row | self::row)/entry[@morerows][count(../preceding-sibling::row) + 1 + number(@morerows) &gt; $p]">
          <xsl:attribute name="keep-with-next.within-column">always</xsl:attribute>
        </xsl:if>
      </xsl:if>
      <xsl:apply-templates select="entry"/>
    </fo:table-row>
  </xsl:template>
  <!-- ==================================================================== -->
  <!--                         TABLE CELLS                                   -->
  <!-- ==================================================================== -->
  <!--
    An entry's own alignment, or the column's, or whatever the attribute sets
    already default to (left, and however display-align resolves with none
    set — top, in practice).

    CALS lets a table author say a column is centred, or its content sits at
    the top or bottom of a taller row, once on its <colspec> — rather than
    repeating the attribute on every entry down the column, which is the
    ordinary case for a "Sr. No." column or a table whose rows vary in
    height. Those colspecs were read for nothing but width; @align and
    @valign, on them and on an entry itself, were silently ignored, so a
    table authored fully to the CALS model still printed every cell flush
    left and top-aligned.

    One template resolves both attributes — $attr names which — so the
    colname/namest/position rule for finding an entry's column is written
    once rather than twice and kept in exact agreement between the two.

    An entry naming its column by @colname is matched to that colspec
    directly. One with no @colname is matched by ordinal position among the
    entries actually present in ITS OWN row — the row's Nth entry to the
    tgroup's Nth colspec — which is the CALS rule for an unlabelled entry and
    is exactly right for a row with no spanned cells before it. A row after a
    colspanned cell would be off by however many columns that span covered;
    fixing that needs tracking how many physical columns every entry so far
    has consumed.

    The common shape of that case is now handled: a cell in the first column
    that spans down (morerows) - a "(a)" or "1" label running beside several
    rows. Every later row it still covers starts one physical column further
    right, so its first entry belongs to the SECOND colspec, not the first.
    Without that, the second column's text took the first column's centring.
    A row-spanning cell that is not the first entry of its row (one in the
    middle or at the right) is still not tracked.
  -->
  <xsl:template name="entry-cell-attr">
    <xsl:param name="attr"/>
    <!--
      Each colspec is looked up directly with its own XPath predicate rather
      than through a stored "the matching colspec" variable: a variable's
      select is one expression, and choosing between colname/namest/position
      needs a genuine xsl:choose. Repeating the predicate costs nothing here —
      a tgroup's colspec list is a handful of nodes — and keeps everything a
      real node-set, with no RTF/node-set() extension needed to read the
      attribute back out of it.

      @*[local-name() = $attr] rather than a literal @align/@valign, since
      $attr is only known at run time — XPath 1.0 has no @{$name} syntax.
    -->
    <xsl:variable name="colspecs" select="ancestor::tgroup/colspec"/>
    <!--
      Columns still taken, in this entry's row, by first-column cells of the
      rows above that span down over it. In the predicate position() is the
      row's distance back from this row (1 = the row directly above), so a
      cell whose morerows reaches that far is still covering this row.
    -->
    <xsl:variable name="shift" select="count(parent::row/preceding-sibling::row[
        entry[1][not(@colname) and not(@namest)] and number(entry[1]/@morerows) &gt;= position()])"/>
    <xsl:choose>
      <xsl:when test="@*[local-name() = $attr]">
        <xsl:value-of select="@*[local-name() = $attr]"/>
      </xsl:when>
      <xsl:when test="@colname and $colspecs[@colname = current()/@colname]/@*[local-name() = $attr]">
        <xsl:value-of select="$colspecs[@colname = current()/@colname][1]/@*[local-name() = $attr]"/>
      </xsl:when>
      <xsl:when test="@namest and $colspecs[@colname = current()/@namest]/@*[local-name() = $attr]">
        <xsl:value-of select="$colspecs[@colname = current()/@namest][1]/@*[local-name() = $attr]"/>
      </xsl:when>
      <xsl:when test="not(@colname) and not(@namest)
                       and $colspecs[position() = count(current()/preceding-sibling::entry) + 1 + $shift]/@*[local-name() = $attr]">
        <xsl:value-of select="$colspecs[position() = count(current()/preceding-sibling::entry) + 1 + $shift][1]/@*[local-name() = $attr]"/>
      </xsl:when>
    </xsl:choose>
  </xsl:template>

  <!--
    CALS' vertical @valign (top/middle/bottom) to XSL-FO's display-align
    (before/center/after) — different words for the same three positions,
    because CALS was never an FO vocabulary and FOP's property is the
    generic before/after pairing every block-progression property uses.
    Anything else (including no @valign anywhere) is left unset, so display-
    align keeps its formatter default rather than this stylesheet asserting
    one — the same "say nothing, change nothing" rule @align already follows.
  -->
  <xsl:template name="valign-to-display-align">
    <xsl:param name="valign"/>
    <xsl:choose>
      <xsl:when test="$valign = 'top'">before</xsl:when>
      <xsl:when test="$valign = 'middle'">center</xsl:when>
      <xsl:when test="$valign = 'bottom'">after</xsl:when>
    </xsl:choose>
  </xsl:template>

  <xsl:template match="entry">
    <fo:table-cell xsl:use-attribute-sets="body-cell">
      <!--
        Overrides the attribute-set's own text-align, and only when there
        actually is one to apply — an untouched table, with no align anywhere
        in its CALS markup, must render exactly as it always has.
      -->
      <xsl:variable name="align">
        <xsl:call-template name="entry-cell-attr"><xsl:with-param name="attr">align</xsl:with-param></xsl:call-template>
      </xsl:variable>
      <xsl:if test="normalize-space($align) != ''">
        <xsl:attribute name="text-align"><xsl:value-of select="$align"/></xsl:attribute>
      </xsl:if>
      <xsl:variable name="valign">
        <xsl:call-template name="entry-cell-attr"><xsl:with-param name="attr">valign</xsl:with-param></xsl:call-template>
      </xsl:variable>
      <xsl:variable name="display-align">
        <xsl:call-template name="valign-to-display-align"><xsl:with-param name="valign" select="normalize-space($valign)"/></xsl:call-template>
      </xsl:variable>
      <xsl:if test="normalize-space($display-align) != ''">
        <xsl:attribute name="display-align"><xsl:value-of select="$display-align"/></xsl:attribute>
      </xsl:if>
      <!-- Bold: thead cells and first tbody row when no thead present -->
      <xsl:if test="parent::row/parent::thead or
                    (parent::row/parent::tbody and
                     not(parent::row/parent::tbody/parent::tgroup/thead) and
                     not(parent::row/preceding-sibling::row))">
        <xsl:attribute name="font-weight">bold</xsl:attribute>
      </xsl:if>
      <!-- Bottom border: always on thead rows; on tbody rows when rowsep="1" and not the last row -->
      <xsl:if test="parent::row/parent::thead or
                    (parent::row/following-sibling::row and
                     (ancestor::table/@rowsep='1' or ancestor::tgroup/@rowsep='1' or @rowsep='1'))">
        <xsl:attribute name="border-bottom-width">0.5pt</xsl:attribute>
        <xsl:attribute name="border-bottom-style">solid</xsl:attribute>
        <xsl:attribute name="border-bottom-color">black</xsl:attribute>
      </xsl:if>
      <!-- End (right) border: always when colsep="1" and there is a following sibling -->
      <xsl:if test="following-sibling::entry and
                    (ancestor::table/@colsep='1' or ancestor::tgroup/@colsep='1' or @colsep='1' or
                     not(ancestor::table/@colsep) and not(ancestor::tgroup/@colsep))">
        <xsl:attribute name="border-end-width">0.5pt</xsl:attribute>
        <xsl:attribute name="border-end-style">solid</xsl:attribute>
        <xsl:attribute name="border-end-color">black</xsl:attribute>
      </xsl:if>
      <xsl:if test="@namest and @nameend">
        <xsl:attribute name="number-columns-spanned">
          <xsl:call-template name="calculate-colspan">
            <xsl:with-param name="namest" select="@namest"/>
            <xsl:with-param name="nameend" select="@nameend"/>
          </xsl:call-template>
        </xsl:attribute>
      </xsl:if>
      <xsl:if test="@morerows">
        <xsl:attribute name="number-rows-spanned">
          <xsl:value-of select="@morerows + 1"/>
        </xsl:attribute>
      </xsl:if>
      <xsl:if test="$table.continued.caption = '1' and parent::row/parent::tbody and not(preceding-sibling::entry)
                    and count(ancestor::table[1]/tgroup) = 1">
        <fo:marker marker-class-name="table-continued">
          <!-- Inline content only: fo:retrieve-table-marker is an inline-level object, and FOP
               fails the whole render if what it retrieves is a block. -->
          <fo:inline>
            <xsl:apply-templates select="ancestor::table[1]" mode="label"/>
            <xsl:call-template name="caption-gap"/>
            <xsl:value-of select="ancestor::table[1]/title"/>
            <xsl:if test="parent::row/preceding-sibling::row">
              <xsl:text> </xsl:text>
              <xsl:value-of select="$table.continued.text"/>
            </xsl:if>
          </fo:inline>
        </fo:marker>
      </xsl:if>
      <fo:block wrap-option="wrap">
        <xsl:apply-templates/>
      </fo:block>
    </fo:table-cell>
  </xsl:template>
  <!-- Calculate colspan from namest/nameend -->
  <xsl:template name="calculate-colspan">
    <xsl:param name="namest"/>
    <xsl:param name="nameend"/>
    <xsl:variable name="colspecs" select="ancestor::tgroup/colspec"/>
    <xsl:variable name="start-pos">
      <xsl:for-each select="$colspecs">
        <xsl:if test="@colname = $namest">
          <xsl:value-of select="position()"/>
        </xsl:if>
      </xsl:for-each>
    </xsl:variable>
    <xsl:variable name="end-pos">
      <xsl:for-each select="$colspecs">
        <xsl:if test="@colname = $nameend">
          <xsl:value-of select="position()"/>
        </xsl:if>
      </xsl:for-each>
    </xsl:variable>
    <xsl:value-of select="$end-pos - $start-pos + 1"/>
  </xsl:template>
  <!-- ==================================================================== -->
  <!--                    REFERENCES TABLE                                   -->
  <!-- ==================================================================== -->
  <xsl:template name="references">
    <fo:block id="references-section-{generate-id(ancestor::dmodule)}" space-after="{$refs.space.after}">
      <xsl:if test="$centerhead2.top.space = 'space'"><xsl:attribute name="space-after.precedence">force</xsl:attribute></xsl:if>
      <fo:block xsl:use-attribute-sets="centerhead2">References</fo:block>
      <fo:block>
        <xsl:call-template name="block-top-space"><xsl:with-param name="size" select="$refs.padding.top"/></xsl:call-template>
        <fo:block font-style="italic" text-align="center" space-after="{$refs.caption.space.after}">
          <xsl:if test="$refs.caption.keep = '1'">
            <xsl:attribute name="keep-with-next.within-column">always</xsl:attribute>
            <xsl:attribute name="keep-with-next.within-page">always</xsl:attribute>
          </xsl:if>
          <xsl:text>Table 1</xsl:text>
          <xsl:call-template name="caption-gap"/>
          <xsl:text>References</xsl:text>
        </fo:block>
        <fo:table start-indent="0pt" end-indent="0pt" table-layout="fixed" width="100%" border-collapse="collapse">
          <xsl:if test="$refs.table.style != 'rules'">
            <xsl:attribute name="border-before-width.conditionality">retain</xsl:attribute>
            <xsl:attribute name="border">0.6pt solid black</xsl:attribute>
          </xsl:if>
          <fo:table-column column-width="proportional-column-width(1)"/>
          <fo:table-column column-width="proportional-column-width(1)"/>
          <fo:table-header font-weight="bold">
            <fo:table-row keep-with-next.within-column="always">
              <xsl:call-template name="refs-cell">
                <xsl:with-param name="head" select="1"/>
                <xsl:with-param name="content"><fo:block><xsl:value-of select="$refs.header.doc"/></fo:block></xsl:with-param>
              </xsl:call-template>
              <xsl:call-template name="refs-cell">
                <xsl:with-param name="head" select="1"/>
                <xsl:with-param name="content"><fo:block>Title</fo:block></xsl:with-param>
              </xsl:call-template>
            </fo:table-row>
          </fo:table-header>
          <fo:table-body>
            <xsl:choose>
              <xsl:when test="refs/dmRef or refs/pmRef">
                <xsl:apply-templates select="refs/dmRef | refs/pmRef" mode="refs"/>
              </xsl:when>
              <xsl:when test="$refs.scan.body = '1' and (.//dmRef or .//pmRef)">
                <xsl:apply-templates select=".//dmRef | .//pmRef" mode="refs"/>
              </xsl:when>
              <xsl:otherwise>
                <fo:table-row>
                  <xsl:call-template name="refs-cell">
                    <xsl:with-param name="content"><fo:block>None</fo:block></xsl:with-param>
                  </xsl:call-template>
                  <xsl:call-template name="refs-cell">
                    <xsl:with-param name="content"><fo:block> </fo:block></xsl:with-param>
                  </xsl:call-template>
                </fo:table-row>
              </xsl:otherwise>
            </xsl:choose>
          </fo:table-body>
        </fo:table>
      </fo:block>
    </fo:block>
  </xsl:template>

  <!-- The gap between a caption's label and its title. "  " is what the engine
       has always written, but FOP collapses two plain spaces to one; a no-break
       space plus a space keeps the double gap the Xignal reference shows. -->
  <xsl:template name="caption-gap">
    <xsl:choose>
      <xsl:when test="$caption.keep.double.space = '1'"><xsl:text>&#160; </xsl:text></xsl:when>
      <xsl:otherwise><xsl:text>  </xsl:text></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!--
    One cell of the References table, in either style:
      boxed  every cell ruled all round, 1.5 mm padding (the engine's own)
      rules  horizontal rules only - above the header row and under every row -
             no vertical lines and no side padding, as the Xignal reference has it
  -->
  <xsl:template name="refs-cell">
    <xsl:param name="head" select="0"/>
    <xsl:param name="content"/>
    <fo:table-cell>
      <xsl:choose>
        <xsl:when test="$refs.table.style = 'rules'">
          <xsl:attribute name="padding-top"><xsl:value-of select="$refs.cell.pad"/></xsl:attribute>
          <xsl:attribute name="padding-bottom"><xsl:value-of select="$refs.cell.pad"/></xsl:attribute>
          <xsl:attribute name="padding-left">0.7pt</xsl:attribute>
          <xsl:attribute name="padding-right">0.7pt</xsl:attribute>
          <xsl:if test="$head = 1">
            <xsl:attribute name="border-top">0.71pt solid <xsl:value-of select="$refs.rule.color"/></xsl:attribute>
          </xsl:if>
          <xsl:attribute name="border-bottom">0.71pt solid <xsl:value-of select="$refs.rule.color"/></xsl:attribute>
          <xsl:attribute name="text-align">left</xsl:attribute>
        </xsl:when>
        <xsl:otherwise>
          <xsl:attribute name="padding">1.5mm</xsl:attribute>
          <xsl:attribute name="border">0.6pt solid black</xsl:attribute>
          <xsl:attribute name="text-align">left</xsl:attribute>
        </xsl:otherwise>
      </xsl:choose>
      <xsl:copy-of select="$content"/>
    </fo:table-cell>
  </xsl:template>

  <xsl:template match="dmRef" mode="refs">
    <fo:table-row>
      <xsl:call-template name="refs-cell">
        <xsl:with-param name="content"><fo:block><xsl:apply-templates select="."/></fo:block></xsl:with-param>
      </xsl:call-template>
      <xsl:call-template name="refs-cell">
        <xsl:with-param name="content">
          <fo:block>
            <xsl:if test="dmRefAddressItems/dmTitle">
              <xsl:apply-templates select="dmRefAddressItems/dmTitle" mode="refs"/>
            </xsl:if>
          </fo:block>
        </xsl:with-param>
      </xsl:call-template>
    </fo:table-row>
  </xsl:template>
  <xsl:template match="pmRef" mode="refs">
    <fo:table-row>
      <xsl:call-template name="refs-cell">
        <xsl:with-param name="content"><fo:block><xsl:apply-templates select="."/></fo:block></xsl:with-param>
      </xsl:call-template>
      <xsl:call-template name="refs-cell">
        <xsl:with-param name="content"><fo:block><xsl:apply-templates select="pmRefAddressItems/pmTitle"/></fo:block></xsl:with-param>
      </xsl:call-template>
    </fo:table-row>
  </xsl:template>
  <xsl:template match="externalPubRef" mode="refs">
    <fo:table-row>
      <xsl:call-template name="refs-cell">
        <xsl:with-param name="content"><fo:block><xsl:apply-templates select="externalPubRefIdent/externalPubCode"/></fo:block></xsl:with-param>
      </xsl:call-template>
      <xsl:call-template name="refs-cell">
        <xsl:with-param name="content"><fo:block><xsl:apply-templates select="externalPubRefIdent/externalPubTitle"/></fo:block></xsl:with-param>
      </xsl:call-template>
    </fo:table-row>
  </xsl:template>
  <xsl:template match="dmTitle" mode="refs">
    <xsl:apply-templates select="techName" mode="refs"/>
    <xsl:if test="infoName">
      <xsl:text> - </xsl:text>
      <xsl:apply-templates select="infoName" mode="refs"/>
    </xsl:if>
  </xsl:template>
  <xsl:template match="techName|infoName" mode="refs">
    <xsl:apply-templates/>
  </xsl:template>
</xsl:stylesheet>