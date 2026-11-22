<?xml version="1.0" encoding="UTF-8"?>
<!-- ********************************************************************
     S1000D to XSL-FO: the Xignal divider page — a data module with NO content prints as a title-only page.

     The Xignal reference marks the start of each annexure with a data module that has an empty <description/>: its techName and infoName
     are the whole of it. They are printed centred on an otherwise empty page, the title at a fixed height, the infoName under it. The
     engine's own page for such a module (title, a contents list, empty "References" and "Description" headings) is kept for every
     other profile.

     Active only when $layout.profile = 'xignal'.

     The title is broken the way the reference breaks it: NOT greedily, but into the fewest lines that the text block allows and then
     with the least total raggedness, i.e. the smallest sum over the lines of (free space on the line) squared, the last line included
     ("Annexure 'C' - User Handbook" / "for 30kVA DG Search Radar", not a full first line and a short second one; and for the three-line
     "Annexure 'H' - User Hand" / "book of MIL Grade 1.5 TR" / "Vertical Slip-on Air Conditioner", which no single line width produces
     greedily). XSL-FO has no such rule, so it is done here from Arial Bold's advance widths (Liberation Sans Bold has the same ones):
     an exact search over the break positions for up to four lines (xs-split), and the narrowest-width greedy fill (xs-narrowest) for
     anything longer or a word wider than the line. Measured on the eight annexure titles of the reference this reproduces every break.

     Geometry, measured on the reference (A4 portrait, points): title 24 pt bold, line 28.8, first baseline 255 pt below the top of the
     text area; infoName 18 pt regular, its baseline 37.8 under the last title line.
     ******************************************************************** -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">

  <xsl:param name="xs.divider.top">255.1pt</xsl:param>
  <xsl:param name="xs.divider.title.size">24pt</xsl:param>
  <xsl:param name="xs.divider.sub.size">18pt</xsl:param>
  <xsl:param name="xs.divider.sub.gap">14.2pt</xsl:param>

  <xsl:variable name="xs.divider.on" select="$layout.profile = 'xignal'"/>

  <!-- Arial Bold advance widths (1/1000 em): the characters, and three digits for each of them in the same order. -->
  <xsl:variable name="xs.cw.chars"><xsl:text> !"#$%&amp;'()*+,-./0123456789:;&lt;=&gt;?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~</xsl:text></xsl:variable>
  <xsl:variable name="xs.cw.widths">278333474556556889722238333333389584278333278278556556556556556556556556556556333333584584584611975722722722722667611778722278556722611833722778667778722667611722667944667667611333278333584556333556611556611556333611611278278556278889611611611611389556333611556778556556500389280389584</xsl:variable>
  <xsl:variable name="xs.cw.space" select="278"/>

  <!-- Width of a string, in 1/1000 em. A character outside ASCII counts 600. -->
  <xsl:template name="xs-bw">
    <xsl:param name="s"/>
    <xsl:param name="acc" select="0"/>
    <xsl:choose>
      <xsl:when test="string-length($s) = 0"><xsl:value-of select="$acc"/></xsl:when>
      <xsl:otherwise>
        <xsl:variable name="c" select="substring($s, 1, 1)"/>
        <xsl:variable name="w">
          <xsl:choose>
            <xsl:when test="contains($xs.cw.chars, $c)">
              <xsl:value-of select="number(substring($xs.cw.widths, string-length(substring-before($xs.cw.chars, $c)) * 3 + 1, 3))"/>
            </xsl:when>
            <xsl:otherwise>600</xsl:otherwise>
          </xsl:choose>
        </xsl:variable>
        <xsl:call-template name="xs-bw">
          <xsl:with-param name="s" select="substring($s, 2)"/>
          <xsl:with-param name="acc" select="$acc + $w"/>
        </xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- "w1;w2;..." — the width of each word of a text that ends in a space. -->
  <xsl:template name="xs-wwidths">
    <xsl:param name="t"/>
    <xsl:if test="string-length($t) &gt; 0">
      <xsl:call-template name="xs-bw"><xsl:with-param name="s" select="substring-before($t, ' ')"/></xsl:call-template>
      <xsl:text>;</xsl:text>
      <xsl:call-template name="xs-wwidths"><xsl:with-param name="t" select="substring-after($t, ' ')"/></xsl:call-template>
    </xsl:if>
  </xsl:template>

  <!-- Lines a greedy fill needs for these word widths when a line may be $max wide. -->
  <xsl:template name="xs-gcount">
    <xsl:param name="ws"/>
    <xsl:param name="max"/>
    <xsl:param name="cur" select="0"/>
    <xsl:param name="n" select="1"/>
    <xsl:choose>
      <xsl:when test="$ws = ''"><xsl:value-of select="$n"/></xsl:when>
      <xsl:otherwise>
        <xsl:variable name="w" select="number(substring-before($ws, ';'))"/>
        <xsl:variable name="rest" select="substring-after($ws, ';')"/>
        <xsl:choose>
          <xsl:when test="$cur = 0">
            <xsl:call-template name="xs-gcount"><xsl:with-param name="ws" select="$rest"/><xsl:with-param name="max" select="$max"/><xsl:with-param name="cur" select="$w"/><xsl:with-param name="n" select="$n"/></xsl:call-template>
          </xsl:when>
          <xsl:when test="$cur + $xs.cw.space + $w &lt;= $max">
            <xsl:call-template name="xs-gcount"><xsl:with-param name="ws" select="$rest"/><xsl:with-param name="max" select="$max"/><xsl:with-param name="cur" select="$cur + $xs.cw.space + $w"/><xsl:with-param name="n" select="$n"/></xsl:call-template>
          </xsl:when>
          <xsl:otherwise>
            <xsl:call-template name="xs-gcount"><xsl:with-param name="ws" select="$rest"/><xsl:with-param name="max" select="$max"/><xsl:with-param name="cur" select="$w"/><xsl:with-param name="n" select="$n + 1"/></xsl:call-template>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- The narrowest line width (to within 4 units) that still fits the text in $n lines: a bisection, the count never rises as the width does. -->
  <xsl:template name="xs-narrowest">
    <xsl:param name="ws"/>
    <xsl:param name="n"/>
    <xsl:param name="lo" select="0"/>
    <xsl:param name="hi"/>
    <xsl:choose>
      <xsl:when test="$hi - $lo &lt;= 4"><xsl:value-of select="$hi"/></xsl:when>
      <xsl:otherwise>
        <xsl:variable name="mid" select="floor(($lo + $hi) div 2)"/>
        <xsl:variable name="c">
          <xsl:call-template name="xs-gcount"><xsl:with-param name="ws" select="$ws"/><xsl:with-param name="max" select="$mid"/></xsl:call-template>
        </xsl:variable>
        <xsl:choose>
          <xsl:when test="number($c) &lt;= $n">
            <xsl:call-template name="xs-narrowest"><xsl:with-param name="ws" select="$ws"/><xsl:with-param name="n" select="$n"/><xsl:with-param name="lo" select="$lo"/><xsl:with-param name="hi" select="$mid"/></xsl:call-template>
          </xsl:when>
          <xsl:otherwise>
            <xsl:call-template name="xs-narrowest"><xsl:with-param name="ws" select="$ws"/><xsl:with-param name="n" select="$n"/><xsl:with-param name="lo" select="$mid"/><xsl:with-param name="hi" select="$hi"/></xsl:call-template>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- Width of "w1;w2;..." set on one line: the words plus a space between each pair. -->
  <xsl:template name="xs-wsum">
    <xsl:param name="ws"/>
    <xsl:param name="acc" select="0"/>
    <xsl:param name="n" select="0"/>
    <xsl:choose>
      <xsl:when test="$ws = ''"><xsl:value-of select="$acc"/></xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="xs-wsum">
          <xsl:with-param name="ws" select="substring-after($ws, ';')"/>
          <xsl:with-param name="acc" select="$acc + number(substring-before($ws, ';')) + (($n &gt; 0) * $xs.cw.space)"/>
          <xsl:with-param name="n" select="$n + 1"/>
        </xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!--
    The best way to set the words $ws on exactly $n lines of at most $max: "cost:k1,k2,..." (words on each line; cost = the sum of the
    squared free space of the lines), or nothing when it cannot be done. The first line takes 1, 2, ... words in turn and the rest is
    split the same way, keeping the cheapest; a tie keeps the split with the shorter first line.
  -->
  <xsl:template name="xs-split">
    <xsl:param name="ws"/>
    <xsl:param name="n"/>
    <xsl:param name="max"/>
    <xsl:choose>
      <xsl:when test="$ws = ''"/>
      <xsl:when test="$n = 1">
        <xsl:variable name="tw"><xsl:call-template name="xs-wsum"><xsl:with-param name="ws" select="$ws"/></xsl:call-template></xsl:variable>
        <xsl:if test="number($tw) &lt;= $max">
          <xsl:value-of select="concat(($max - $tw) * ($max - $tw), ':', string-length($ws) - string-length(translate($ws, ';', '')))"/>
        </xsl:if>
      </xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="xs-split-try">
          <xsl:with-param name="n" select="$n"/>
          <xsl:with-param name="max" select="$max"/>
          <xsl:with-param name="cur" select="number(substring-before($ws, ';'))"/>
          <xsl:with-param name="rest" select="substring-after($ws, ';')"/>
        </xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="xs-split-try">
    <xsl:param name="n"/>
    <xsl:param name="max"/>
    <xsl:param name="k" select="1"/>
    <xsl:param name="cur"/>
    <xsl:param name="rest"/>
    <xsl:param name="best" select="''"/>
    <xsl:variable name="left" select="string-length($rest) - string-length(translate($rest, ';', ''))"/>
    <xsl:choose>
      <!-- every remaining line needs a word -->
      <xsl:when test="$left &lt; $n - 1"><xsl:value-of select="$best"/></xsl:when>
      <xsl:otherwise>
        <xsl:variable name="sub">
          <xsl:call-template name="xs-split">
            <xsl:with-param name="ws" select="$rest"/>
            <xsl:with-param name="n" select="$n - 1"/>
            <xsl:with-param name="max" select="$max"/>
          </xsl:call-template>
        </xsl:variable>
        <xsl:variable name="total" select="($max - $cur) * ($max - $cur) + number(substring-before($sub, ':'))"/>
        <xsl:variable name="best2">
          <xsl:choose>
            <xsl:when test="$sub != '' and ($best = '' or $total &lt; number(substring-before($best, ':')))">
              <xsl:value-of select="concat($total, ':', $k, ',', substring-after($sub, ':'))"/>
            </xsl:when>
            <xsl:otherwise><xsl:value-of select="$best"/></xsl:otherwise>
          </xsl:choose>
        </xsl:variable>
        <xsl:variable name="w" select="number(substring-before($rest, ';'))"/>
        <xsl:choose>
          <xsl:when test="$rest != '' and $cur + $xs.cw.space + $w &lt;= $max">
            <xsl:call-template name="xs-split-try">
              <xsl:with-param name="n" select="$n"/>
              <xsl:with-param name="max" select="$max"/>
              <xsl:with-param name="k" select="$k + 1"/>
              <xsl:with-param name="cur" select="$cur + $xs.cw.space + $w"/>
              <xsl:with-param name="rest" select="substring-after($rest, ';')"/>
              <xsl:with-param name="best" select="string($best2)"/>
            </xsl:call-template>
          </xsl:when>
          <xsl:otherwise><xsl:value-of select="$best2"/></xsl:otherwise>
        </xsl:choose>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- The first $k words of "w1 w2 ... " as one line of text. -->
  <xsl:template name="xs-take">
    <xsl:param name="t"/>
    <xsl:param name="k"/>
    <xsl:param name="acc" select="''"/>
    <xsl:choose>
      <xsl:when test="$k &lt;= 0 or $t = ''"><xsl:value-of select="normalize-space($acc)"/></xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="xs-take">
          <xsl:with-param name="t" select="substring-after($t, ' ')"/>
          <xsl:with-param name="k" select="$k - 1"/>
          <xsl:with-param name="acc" select="concat($acc, substring-before($t, ' '), ' ')"/>
        </xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- "w1 w2 ... " without its first $k words. -->
  <xsl:template name="xs-drop">
    <xsl:param name="t"/>
    <xsl:param name="k"/>
    <xsl:choose>
      <xsl:when test="$k &lt;= 0 or $t = ''"><xsl:value-of select="$t"/></xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="xs-drop">
          <xsl:with-param name="t" select="substring-after($t, ' ')"/>
          <xsl:with-param name="k" select="$k - 1"/>
        </xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- One centred block per line, the words on each given by $counts ("3,4,2,"). -->
  <xsl:template name="xs-flines">
    <xsl:param name="t"/>
    <xsl:param name="counts"/>
    <xsl:param name="first" select="1"/>
    <xsl:if test="$counts != ''">
      <xsl:variable name="k" select="number(substring-before($counts, ','))"/>
      <xsl:call-template name="xs-divider-line">
        <xsl:with-param name="text"><xsl:call-template name="xs-take"><xsl:with-param name="t" select="$t"/><xsl:with-param name="k" select="$k"/></xsl:call-template></xsl:with-param>
        <xsl:with-param name="first" select="$first"/>
      </xsl:call-template>
      <xsl:call-template name="xs-flines">
        <xsl:with-param name="t"><xsl:call-template name="xs-drop"><xsl:with-param name="t" select="$t"/><xsl:with-param name="k" select="$k"/></xsl:call-template></xsl:with-param>
        <xsl:with-param name="counts" select="substring-after($counts, ',')"/>
        <xsl:with-param name="first" select="0"/>
      </xsl:call-template>
    </xsl:if>
  </xsl:template>

  <!-- Greedy fill at $max, one centred block per line. $t is the words (ending in a space), $ws their widths. -->
  <xsl:template name="xs-glines">
    <xsl:param name="t"/>
    <xsl:param name="ws"/>
    <xsl:param name="max"/>
    <xsl:param name="line" select="''"/>
    <xsl:param name="cur" select="0"/>
    <xsl:param name="first" select="1"/>
    <xsl:choose>
      <xsl:when test="$ws = ''">
        <xsl:if test="$line != ''"><xsl:call-template name="xs-divider-line"><xsl:with-param name="text" select="$line"/><xsl:with-param name="first" select="$first"/></xsl:call-template></xsl:if>
      </xsl:when>
      <xsl:otherwise>
        <xsl:variable name="word" select="substring-before($t, ' ')"/>
        <xsl:variable name="w" select="number(substring-before($ws, ';'))"/>
        <xsl:choose>
          <xsl:when test="$line = ''">
            <xsl:call-template name="xs-glines"><xsl:with-param name="t" select="substring-after($t, ' ')"/><xsl:with-param name="ws" select="substring-after($ws, ';')"/><xsl:with-param name="max" select="$max"/><xsl:with-param name="line" select="$word"/><xsl:with-param name="cur" select="$w"/><xsl:with-param name="first" select="$first"/></xsl:call-template>
          </xsl:when>
          <xsl:when test="$cur + $xs.cw.space + $w &lt;= $max">
            <xsl:call-template name="xs-glines"><xsl:with-param name="t" select="substring-after($t, ' ')"/><xsl:with-param name="ws" select="substring-after($ws, ';')"/><xsl:with-param name="max" select="$max"/><xsl:with-param name="line" select="concat($line, ' ', $word)"/><xsl:with-param name="cur" select="$cur + $xs.cw.space + $w"/><xsl:with-param name="first" select="$first"/></xsl:call-template>
          </xsl:when>
          <xsl:otherwise>
            <xsl:call-template name="xs-divider-line"><xsl:with-param name="text" select="$line"/><xsl:with-param name="first" select="$first"/></xsl:call-template>
            <xsl:call-template name="xs-glines"><xsl:with-param name="t" select="substring-after($t, ' ')"/><xsl:with-param name="ws" select="substring-after($ws, ';')"/><xsl:with-param name="max" select="$max"/><xsl:with-param name="line" select="$word"/><xsl:with-param name="cur" select="$w"/><xsl:with-param name="first" select="0"/></xsl:call-template>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="xs-divider-line">
    <xsl:param name="text"/>
    <xsl:param name="first"/>
    <fo:block font-size="{$xs.divider.title.size}" font-weight="bold" line-height="1.2" text-align="center">
      <xsl:if test="$first = 1"><xsl:attribute name="padding-top"><xsl:value-of select="$xs.divider.top"/></xsl:attribute></xsl:if>
      <xsl:value-of select="$text"/>
    </fo:block>
  </xsl:template>

  <!-- The page: a data module whose content is empty. Context: the dmodule. -->
  <xsl:template name="xs-divider-page">
    <xsl:variable name="t" select="identAndStatusSection/dmAddress/dmAddressItems/dmTitle"/>
    <xsl:variable name="title" select="normalize-space($t/techName)"/>
    <xsl:variable name="sub" select="normalize-space($t/infoName)"/>
    <!-- the text block's width in 1/1000 em of the title size: page width less both margins -->
    <xsl:variable name="pt">
      <xsl:call-template name="xs-pt"><xsl:with-param name="v" select="$page-width"/></xsl:call-template>
    </xsl:variable>
    <xsl:variable name="mi">
      <xsl:call-template name="xs-pt"><xsl:with-param name="v" select="$margin-inner"/></xsl:call-template>
    </xsl:variable>
    <xsl:variable name="mo">
      <xsl:call-template name="xs-pt"><xsl:with-param name="v" select="$margin-outer"/></xsl:call-template>
    </xsl:variable>
    <xsl:variable name="size">
      <xsl:call-template name="xs-pt"><xsl:with-param name="v" select="$xs.divider.title.size"/></xsl:call-template>
    </xsl:variable>
    <xsl:variable name="maxu" select="floor((number($pt) - number($mi) - number($mo)) * 1000 div number($size))"/>
    <xsl:variable name="words" select="concat($title, ' ')"/>
    <xsl:variable name="ws"><xsl:call-template name="xs-wwidths"><xsl:with-param name="t" select="$words"/></xsl:call-template></xsl:variable>
    <xsl:variable name="n">
      <xsl:call-template name="xs-gcount"><xsl:with-param name="ws" select="string($ws)"/><xsl:with-param name="max" select="$maxu"/></xsl:call-template>
    </xsl:variable>
    <xsl:variable name="narrow">
      <xsl:call-template name="xs-narrowest"><xsl:with-param name="ws" select="string($ws)"/><xsl:with-param name="n" select="number($n)"/><xsl:with-param name="hi" select="$maxu"/></xsl:call-template>
    </xsl:variable>
    <!-- two to four lines: the least-ragged split ("cost:k1,k2,..."); otherwise nothing, and the narrowest-width fill below is used -->
    <xsl:variable name="split">
      <xsl:if test="number($n) &gt; 1 and number($n) &lt;= 4">
        <xsl:call-template name="xs-split">
          <xsl:with-param name="ws" select="string($ws)"/>
          <xsl:with-param name="n" select="number($n)"/>
          <xsl:with-param name="max" select="$maxu"/>
        </xsl:call-template>
      </xsl:if>
    </xsl:variable>
    <xsl:call-template name="page-sequence">
      <xsl:with-param name="last" select="1"/>
      <xsl:with-param name="first" select="1"/>
      <xsl:with-param name="content">
        <fo:block>
          <xsl:call-template name="generate-markers"/>
          <fo:block id="content-start-{generate-id()}">
            <xsl:choose>
              <xsl:when test="$title != '' and string($split) != ''">
                <xsl:call-template name="xs-flines">
                  <xsl:with-param name="t" select="$words"/>
                  <xsl:with-param name="counts" select="concat(substring-after(string($split), ':'), ',')"/>
                </xsl:call-template>
              </xsl:when>
              <xsl:when test="$title != ''">
                <xsl:call-template name="xs-glines">
                  <xsl:with-param name="t" select="$words"/>
                  <xsl:with-param name="ws" select="string($ws)"/>
                  <xsl:with-param name="max" select="number($narrow)"/>
                </xsl:call-template>
              </xsl:when>
              <xsl:otherwise><fo:block padding-top="{$xs.divider.top}"/></xsl:otherwise>
            </xsl:choose>
            <xsl:if test="$sub != ''">
              <fo:block font-size="{$xs.divider.sub.size}" line-height="1.2" text-align="center" space-before="{$xs.divider.sub.gap}" space-before.conditionality="retain">
                <xsl:value-of select="$sub"/>
              </fo:block>
            </xsl:if>
          </fo:block>
          <fo:block>
            <xsl:call-template name="end-of-datamodule-marker"/>
          </fo:block>
        </fo:block>
      </xsl:with-param>
    </xsl:call-template>
  </xsl:template>

</xsl:stylesheet>
