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
    <xsl:apply-templates select="appendices/appendix" mode="uhb"/>
  </xsl:template>

  <!-- ===== cover ===== -->
  <xsl:template name="uhb-cover">
    <fo:page-sequence master-reference="cover-seq" format="i" initial-page-number="1" force-page-count="end-on-even" font-family="{$font.body}" font-size="12pt">
      <xsl:call-template name="head-foot"><xsl:with-param name="page-numbers" select="false()"/><xsl:with-param name="blank" select="true()"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <fo:block text-align="right" font-weight="bold" font-size="14pt" space-after="10pt"><xsl:value-of select="meta/docNo"/>&#160;</fo:block>
        <fo:table table-layout="fixed" width="100%" border="0.75pt solid black" space-after="10pt">
          <fo:table-column column-width="100%"/>
          <fo:table-body><fo:table-row><fo:table-cell padding="3pt">
            <fo:block color="#FF0000" text-align="justify" font-size="12pt">THE INFORMATION GIVEN IN THIS DOCUMENT IS NOT TO BE PUBLISHED OR COMMUNICATED, EITHER DIRECTLY OR INDIRECTLY TO THE PRESS OR TO ANY PERSON NOT AUTHORISED TO RECEIVE IT.</fo:block>
          </fo:table-cell></fo:table-row></fo:table-body>
        </fo:table>
        <fo:block text-align="center" space-before="6pt" space-after="10pt">
          <fo:external-graphic content-height="40.2mm" content-width="30.2mm" scaling="uniform">
            <xsl:attribute name="src"><xsl:choose><xsl:when test="meta/emblem != ''">url('<xsl:value-of select="meta/emblem"/>')</xsl:when><xsl:otherwise>url('<xsl:value-of select="$assets.url"/>/emblem.png')</xsl:otherwise></xsl:choose></xsl:attribute>
          </fo:external-graphic>
        </fo:block>
        <fo:block text-align="center" font-weight="bold" font-size="18pt" color="{$color.title}" line-height="20.7pt" space-before="14pt">
          <xsl:value-of select="meta/title"/>
          <xsl:if test="meta/subtitle != ''"><fo:block><xsl:value-of select="meta/subtitle"/></fo:block></xsl:if>
          <fo:block font-size="14pt">FOR</fo:block>
        </fo:block>
        <fo:block text-align="center" font-weight="bold" font-size="18pt" color="{$color.title}" line-height="20.7pt" space-before="12pt" space-after="10pt"><xsl:value-of select="meta/projectName"/></fo:block>
        <fo:block text-align="center" font-size="14pt" line-height="20.7pt">A/T or S/O No.: <xsl:value-of select="meta/atNo"/></fo:block>
        <fo:block text-align="center" font-size="14pt" line-height="20.7pt">DATED: <xsl:value-of select="meta/dated"/></fo:block>
        <fo:block text-align="center" font-size="14pt" line-height="20.7pt">NSN: <xsl:value-of select="meta/nsn"/></fo:block>
        <fo:block text-align="center" font-weight="bold" space-before="14pt">SUPPLIED BY:</fo:block>
        <fo:block text-align="center" space-before="3pt">
          <fo:external-graphic content-height="16.9mm" content-width="20.1mm" scaling="uniform">
            <xsl:attribute name="src"><xsl:choose><xsl:when test="meta/logo != ''">url('<xsl:value-of select="meta/logo"/>')</xsl:when><xsl:otherwise>url('<xsl:value-of select="$assets.url"/>/supplier-logo.png')</xsl:otherwise></xsl:choose></xsl:attribute>
          </fo:external-graphic>
        </fo:block>
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
        <fo:block text-align="left" space-before="10pt" space-after="10pt" line-height="15.9pt"><xsl:value-of select="meta/issueDate"/></fo:block>
        <fo:table table-layout="fixed" width="100%" border="0.75pt solid black" font-size="11pt">
          <fo:table-column column-width="37.7mm"/><fo:table-column column-width="122.3mm"/>
          <fo:table-body><fo:table-row>
            <fo:table-cell padding="3pt" border="0.75pt solid black"><fo:block font-weight="bold">EQUIPMENT LIFE:</fo:block></fo:table-cell>
            <fo:table-cell padding="3pt" border="0.75pt solid black"><fo:block text-align="justify"><xsl:value-of select="meta/equipmentLife"/></fo:block></fo:table-cell>
          </fo:table-row></fo:table-body>
        </fo:table>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <!-- ===== front matter ===== -->
  <xsl:template name="uhb-front">
    <fo:page-sequence master-reference="portrait" format="i" initial-page-number="auto" force-page-count="end-on-even" font-family="{$font.body}" font-size="12pt">
      <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="true()"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <xsl:call-template name="uhb-amendments"/>
        <xsl:call-template name="uhb-warning"/>
        <xsl:call-template name="uhb-demolition"/>
        <xsl:call-template name="uhb-firstaid"/>
        <xsl:if test="front/associated"><xsl:call-template name="uhb-associated"/></xsl:if>
        <xsl:call-template name="uhb-abbreviations"/>
        <xsl:if test="front/preface"><xsl:call-template name="uhb-preface"/></xsl:if>
        <xsl:if test="front/dos or front/donts"><xsl:call-template name="uhb-dos"/></xsl:if>
        <xsl:if test="front/important"><xsl:call-template name="uhb-items"><xsl:with-param name="title">IMPORTANT POINTS</xsl:with-param><xsl:with-param name="items" select="front/important/item"/></xsl:call-template></xsl:if>
        <xsl:if test="front/photos"><xsl:call-template name="uhb-photos"/></xsl:if>
        <xsl:call-template name="uhb-contents"/>
        <xsl:call-template name="uhb-list-of-figures"/>
        <xsl:call-template name="uhb-list-of-tables"/>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <xsl:template name="uhb-amendments">
    <fo:block break-before="page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">AMENDMENTS</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(840)"/>
        <fo:table-column column-width="proportional-column-width(1161)"/>
        <fo:table-column column-width="proportional-column-width(1769)"/>
        <fo:table-column column-width="proportional-column-width(3501)"/>
        <fo:table-column column-width="proportional-column-width(2359)"/>
        <fo:table-header><fo:table-row font-weight="bold" text-align="center">
          <fo:table-cell border="0.5pt solid black" padding="2pt" display-align="center"><fo:block>S. No.</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding="2pt" display-align="center"><fo:block>Page No.</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding="2pt" display-align="center"><fo:block>Para Reference</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding="2pt" display-align="center"><fo:block>Amendment Required</fo:block></fo:table-cell><fo:table-cell border="0.5pt solid black" padding="2pt" display-align="center"><fo:block>Authority with Ref. No. &amp; Date</fo:block></fo:table-cell>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="front/amendments/row">
            <fo:table-row height="9mm">
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block text-align="center"><xsl:value-of select="@no"/>&#160;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block text-align="center"><xsl:value-of select="@page"/>&#160;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@para"/>&#160;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@required"/>&#160;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@authority"/>&#160;</fo:block></fo:table-cell>
            </fo:table-row>
          </xsl:for-each>
          <xsl:call-template name="blank-rows">
            <xsl:with-param name="n"><xsl:choose><xsl:when test="front/amendments/@minRows"><xsl:value-of select="front/amendments/@minRows - count(front/amendments/row)"/></xsl:when><xsl:otherwise><xsl:value-of select="20 - count(front/amendments/row)"/></xsl:otherwise></xsl:choose></xsl:with-param>
            <xsl:with-param name="cols" select="5"/><xsl:with-param name="h">9mm</xsl:with-param>
          </xsl:call-template>
        </fo:table-body>
      </fo:table>
    </fo:block>
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
      <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>&#160;</fo:block></fo:table-cell>
      <xsl:call-template name="blank-cells"><xsl:with-param name="c" select="$c - 1"/></xsl:call-template>
    </xsl:if>
  </xsl:template>

  <xsl:template name="uhb-warning">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">WARNING</xsl:with-param></xsl:call-template>
      <!-- the stencil: red text, hanging 227 twips, line 480 (double), 12 pt before -->
      <xsl:for-each select="front/warning/item">
        <fo:list-block provisional-distance-between-starts="11.35pt" space-before="12pt" color="{$color.red}">
          <fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block line-height="27.6pt"><xsl:number format="1"/>.</fo:block></fo:list-item-label>
            <fo:list-item-body start-indent="body-start()"><fo:block text-align="justify" line-height="27.6pt"><xsl:apply-templates mode="inline"/></fo:block></fo:list-item-body></fo:list-item>
        </fo:list-block>
      </xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-demolition">
    <fo:block break-before="odd-page">
      <fo:block font-weight="bold" font-size="14pt" color="{$color.heading}" text-align="center" line-height="20.7pt" space-after="30pt">DEMOLITION OF EQUIPMENT<fo:block/>TO PREVENT ENEMY USE</fo:block>
      <fo:block text-align="justify" color="{$color.red}" line-height="15.9pt">THE DEMOLITION OF THE EQUIPMENT WILL BE HELD ONLY ON THE ORDER OF THE COMMANDING OFFICER.</fo:block>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-firstaid">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">FIRST AID IN CASE OF ELECTRICAL SHOCK</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" border-collapse="collapse">
        <fo:table-column column-width="11mm"/><fo:table-column column-width="149mm"/>
        <fo:table-body>
          <fo:table-row><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block>1.</fo:block></fo:table-cell>
            <fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block text-align="justify">Shift the person to the nearest medical centre immediately, who is affected by electrical shock.</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell border="0.5pt solid black" padding="3pt"><fo:block>2.</fo:block></fo:table-cell>
            <fo:table-cell border="0.5pt solid black" padding="3pt">
              <fo:block>i) Terminate the battery connection of vehicle.</fo:block><fo:block>ii) Find fault in defective cable / wire.</fo:block><fo:block>iii) Replace defective cable / wire from vehicle chassis.</fo:block></fo:table-cell></fo:table-row>
        </fo:table-body>
      </fo:table>
    </fo:block>
    <fo:block break-before="page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">FIRST AID IN CASE OF ELECTRIC SHOCK</xsl:with-param></xsl:call-template>
      <!-- the stencil's table: a 48.4 mm column holding the four figures, a 7.4 mm column of step numbers, a text column -->
      <fo:table table-layout="fixed" width="100%" border-collapse="collapse" font-size="11pt">
        <fo:table-column column-width="48.4mm"/><fo:table-column column-width="7.4mm"/><fo:table-column column-width="104.2mm"/>
        <fo:table-body>
          <fo:table-row><fo:table-cell number-rows-spanned="6" padding="3pt">
            <xsl:call-template name="first-aid-figure"><xsl:with-param name="file">firstaid-1.png</xsl:with-param><xsl:with-param name="caption">Figure. 1</xsl:with-param></xsl:call-template>
            <xsl:call-template name="first-aid-figure"><xsl:with-param name="file">firstaid-2.png</xsl:with-param><xsl:with-param name="caption">Figure. 2</xsl:with-param></xsl:call-template>
            <xsl:call-template name="first-aid-figure"><xsl:with-param name="file">firstaid-3.png</xsl:with-param><xsl:with-param name="caption">Figure. 3</xsl:with-param></xsl:call-template>
            <xsl:call-template name="first-aid-figure"><xsl:with-param name="file">firstaid-4.png</xsl:with-param><xsl:with-param name="caption">Figure. 4</xsl:with-param></xsl:call-template>
          </fo:table-cell>
          <fo:table-cell padding="3pt"><fo:block>1.</fo:block></fo:table-cell><fo:table-cell padding="3pt"><fo:block text-align="justify">SWITCH OFF. If this is not possible, PROTECT YOURSELF with dry insulating material and pull the victim clear of the conductor. DO NOT TOUCH THE VICTIM WITH YOUR BARE HANDS until he is clear of the conductor, but DO NOT WASTE TIME.</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell padding="3pt"><fo:block>2.</fo:block></fo:table-cell><fo:table-cell padding="3pt"><fo:block text-align="justify">(a) Place the victim in the supine position.</fo:block><fo:block text-align="justify" space-before="4pt">(b) Keep the air passages clear by turning the head to one side, opening the patient's mouth and clearing it of water, saline, mucus or blood, a lot of which might have accumulated in the back of the throat. (Figure 1)</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell padding="3pt"><fo:block>3.</fo:block></fo:table-cell><fo:table-cell padding="3pt"><fo:block text-align="justify">If the jaw is rigid, try to force the mouth open by pressure on the gum behind the last molar tooth of the lower jaw. When the upper air passages thus cleared, tilt the head backward and force the jaw forward from the angles of the jaw in front of the ears. This would prevent mechanical obstructions to the upper air passages. (Figure 2-3)</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell padding="3pt"><fo:block>4.</fo:block></fo:table-cell><fo:table-cell padding="3pt"><fo:block text-align="justify">(a) Then hold the chin up and forward with one hand and pinch the nostrils of the victim with the other. (Figure 3)</fo:block><fo:block text-align="justify" space-before="4pt">(b) Take a very deep breath and apply your mouth to that of the victim and blow into his mouth, until the chest of the victim moves up indicating filling of the lungs. (NEVER ALLOW THE CHIN TO SAG). (Figure 4)</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell padding="3pt"><fo:block>5.</fo:block></fo:table-cell><fo:table-cell padding="3pt"><fo:block text-align="justify">When the chest has moved up, withdraw your mouth and allow the chest to slink back. REPEAT this process every three to four seconds until the victim begins to breathe again or until he taken over by a medical attendant. This method can be continued in an ambulance during transit of the patient from the site of accident to the nearest medical centre.</fo:block></fo:table-cell></fo:table-row>
          <fo:table-row><fo:table-cell padding="3pt"><fo:block/></fo:table-cell><fo:table-cell padding="3pt"><fo:block font-weight="bold">HAVE SOMEONE ELSE AND SEND FOR A DOCTOR.</fo:block><fo:block font-weight="bold">KEEP PATIENT WARM AND LOOSEN HIS CLOTHING.</fo:block><fo:block font-weight="bold">DO NOT GIVE LIQUIDS UNTIL THE PATIENT IS CONSCIOUS.</fo:block></fo:table-cell></fo:table-row>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-associated">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">ASSOCIATED DOCUMENTS</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(1)"/><fo:table-column column-width="proportional-column-width(6)"/>
        <fo:table-column column-width="proportional-column-width(3)"/><fo:table-column column-width="proportional-column-width(2)"/>
        <fo:table-header><fo:table-row font-weight="bold" text-align="center">
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>Sr. No.</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>Document Title</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>Document No.</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>Remark</fo:block></fo:table-cell>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="front/associated/doc">
            <fo:table-row>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block text-align="center"><xsl:number format="1"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@title"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@docNo"/>&#160;</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@remark"/>&#160;</fo:block></fo:table-cell>
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
      <fo:table table-layout="fixed" width="100%" font-size="10pt" border-collapse="collapse">
        <fo:table-column column-width="proportional-column-width(1020)"/><fo:table-column column-width="proportional-column-width(2519)"/><fo:table-column column-width="proportional-column-width(6088)"/>
        <fo:table-header><fo:table-row font-weight="bold" text-align="center">
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>Sr. No.</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>Abbreviation Issued</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>For</fo:block></fo:table-cell>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="front/abbreviations/abbr">
            <fo:table-row>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block text-align="center"><xsl:number format="1"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@short"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@long"/></fo:block></fo:table-cell>
            </fo:table-row>
          </xsl:for-each>
          <xsl:if test="not(front/abbreviations/abbr)"><xsl:call-template name="blank-rows"><xsl:with-param name="n" select="1"/><xsl:with-param name="cols" select="3"/></xsl:call-template></xsl:if>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-preface">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">PREFACE</xsl:with-param></xsl:call-template>
      <xsl:for-each select="front/preface/para">
        <fo:list-block provisional-distance-between-starts="22.7pt" space-after="8pt">
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
        <fo:list-block provisional-distance-between-starts="22.7pt" space-after="6pt">
          <fo:list-item><fo:list-item-label end-indent="label-end()"><fo:block><xsl:number format="1"/>.</fo:block></fo:list-item-label>
            <fo:list-item-body start-indent="body-start()"><fo:block text-align="justify" line-height="15.9pt"><xsl:apply-templates mode="inline"/></fo:block></fo:list-item-body></fo:list-item>
        </fo:list-block>
      </xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-dos">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">DO'S</xsl:with-param><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
      <xsl:for-each select="front/dos/item"><fo:block start-indent="22.7pt" text-indent="-22.7pt" text-align="justify" line-height="15.9pt" space-after="4pt"><xsl:number format="1"/>.&#160;&#160;<xsl:apply-templates mode="inline"/></fo:block></xsl:for-each>
      <xsl:call-template name="front-title"><xsl:with-param name="text">DONT'S</xsl:with-param><xsl:with-param name="align">left</xsl:with-param></xsl:call-template>
      <xsl:for-each select="front/donts/item"><fo:block start-indent="22.7pt" text-indent="-22.7pt" text-align="justify" line-height="15.9pt" space-after="4pt"><xsl:number format="1"/>.&#160;&#160;<xsl:apply-templates mode="inline"/></fo:block></xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-photos">
    <fo:block break-before="odd-page">
      <fo:block text-align="center" space-after="14pt">SYSTEM PHOTOS</fo:block>
      <xsl:for-each select="front/photos/graphic"><fo:block text-align="center" space-after="8pt"><xsl:call-template name="graphic"/></fo:block></xsl:for-each>
    </fo:block>
  </xsl:template>

  <!-- ===== contents (a table: CHAPTERS | DESCRIPTION | PAGE No.), list of figures, list of tables ===== -->
  <xsl:template name="uhb-contents">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">CONTENTS</xsl:with-param></xsl:call-template>
      <fo:table table-layout="fixed" width="100%" font-size="11pt" border-collapse="collapse">
        <fo:table-column column-width="31.9mm"/><fo:table-column column-width="112.5mm"/><fo:table-column column-width="25.3mm"/>
        <fo:table-header><fo:table-row font-weight="bold" text-align="center">
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>CHAPTERS</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>DESCRIPTION</fo:block></fo:table-cell>
          <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>PAGE No.</fo:block></fo:table-cell>
        </fo:table-row></fo:table-header>
        <fo:table-body>
          <xsl:for-each select="chapter">
            <fo:table-row font-weight="bold">
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>CHAPTER <xsl:value-of select="position()"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="translate(@title, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block text-align="center"><fo:page-number-citation ref-id="{generate-id()}"/></fo:block></fo:table-cell>
            </fo:table-row>
            <xsl:for-each select="section">
              <fo:table-row>
                <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>Section <xsl:value-of select="position()"/></fo:block></fo:table-cell>
                <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@title"/></fo:block></fo:table-cell>
                <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block text-align="center"><fo:page-number-citation ref-id="{generate-id()}"/></fo:block></fo:table-cell>
              </fo:table-row>
            </xsl:for-each>
          </xsl:for-each>
          <xsl:if test="not(chapter) and not(appendices/appendix)"><xsl:call-template name="blank-rows"><xsl:with-param name="n" select="1"/><xsl:with-param name="cols" select="3"/></xsl:call-template></xsl:if>
          <xsl:for-each select="appendices/appendix">
            <fo:table-row>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block>APPENDIX '<xsl:value-of select="@label"/>'</fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block><xsl:value-of select="@title"/></fo:block></fo:table-cell>
              <fo:table-cell border="0.5pt solid black" padding="2pt"><fo:block text-align="center"><fo:page-number-citation ref-id="{generate-id()}"/></fo:block></fo:table-cell>
            </fo:table-row>
          </xsl:for-each>
        </fo:table-body>
      </fo:table>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-list-of-figures">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">LIST OF FIGURES</xsl:with-param></xsl:call-template>
      <xsl:for-each select="//figure">
        <xsl:variable name="n"><xsl:number level="any" count="figure"/></xsl:variable>
        <fo:block text-align-last="justify" line-height="18pt" end-indent="2em" text-indent="0">
          Figure <xsl:value-of select="$n"/>: <xsl:value-of select="@title"/>
          <fo:leader leader-pattern="dots"/><fo:page-number-citation ref-id="figc-{$n}"/>
        </fo:block>
      </xsl:for-each>
    </fo:block>
  </xsl:template>

  <xsl:template name="uhb-list-of-tables">
    <fo:block break-before="odd-page">
      <xsl:call-template name="front-title"><xsl:with-param name="text">LIST OF TABLES</xsl:with-param></xsl:call-template>
      <xsl:for-each select="//table[@title]">
        <xsl:variable name="n"><xsl:number level="any" count="table[@title]"/></xsl:variable>
        <fo:block text-align-last="justify" line-height="18pt">
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
          CHAPTER <xsl:value-of select="count(preceding-sibling::chapter) + 1"/>
          <fo:block/>
          <xsl:value-of select="translate(@title, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/>
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
          SECTION <xsl:value-of select="count(preceding-sibling::section) + 1"/>
          <fo:block/>
          <xsl:value-of select="translate(@title, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/>
        </fo:block>
      </fo:flow>
    </fo:page-sequence>
    <!-- the section's content -->
    <fo:page-sequence master-reference="{$master}" initial-page-number="auto" format="1" font-family="{$font.body}" font-size="12pt" force-page-count="end-on-even">
      <xsl:call-template name="head-foot"><xsl:with-param name="blank" select="$master = 'portrait'"/></xsl:call-template>
      <fo:flow flow-name="xsl-region-body">
        <xsl:apply-templates select="*" mode="body"/>
        <fo:block/>
      </fo:flow>
    </fo:page-sequence>
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
        <fo:block id="{generate-id()}" text-align="right" font-weight="bold" color="{$color.heading}" text-decoration="underline" space-after="4pt">APPENDIX '<xsl:value-of select="@label"/>'</fo:block>
        <fo:block text-align="center" font-weight="bold" color="{$color.heading}" text-decoration="underline" space-after="14pt"><xsl:value-of select="translate(@title, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/></fo:block>
        <xsl:apply-templates select="*" mode="body"/>
        <fo:block/>
      </fo:flow>
    </fo:page-sequence>
  </xsl:template>

  <xsl:template name="first-aid-figure">
    <xsl:param name="file"/><xsl:param name="caption"/>
    <fo:block text-align="center" space-after="4pt" keep-together.within-page="always">
      <fo:external-graphic src="url('{$assets.url}/{$file}')" content-width="44mm" content-height="scale-to-fit" scaling="uniform"/>
      <fo:block font-size="10pt"><xsl:value-of select="$caption"/></fo:block>
    </fo:block>
  </xsl:template>

</xsl:stylesheet>
