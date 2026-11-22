<?xml version="1.0" encoding="UTF-8"?>
<!-- ********************************************************************
     AGASTYA addition (not part of the original JSS / s1000dtofo code).

     Print view of the data modules that are not narrative text: BREX, the common information repository (COMREP), the three
     applicability cross-reference tables, business rules documents, checklists, learning, processes, service bulletins,
     maintenance schedules, wiring data and fields, SCORM content, front matter and containers.

     The two PDF engines (s1000dtofo/ and s1000dtojss/) already know how to print a <description> made of <levelledPara>,
     <para>, <table> and <randomList>. This sheet turns such a module's <content> into exactly that, once, and each engine's
     own templates do the printing. So every type reads the same way in either engine, in the house table and list styles.

     Entry point (both engines call it with a <content> as context):   <xsl:call-template name="render-support-content"/>
     It is only used for content roots the engines have no template for, so no existing output changes.

     Rules: nothing is invented and nothing is dropped. Every element becomes a heading (its name, plus its id or title when it
     has one), its attributes and its text-only children become Field / Value rows, and its element children become the next
     heading level. BREX, ACT, CCT and PCT have dedicated tables (rule id, object path, flag, severity, use, allowed values).
     ******************************************************************** -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
  xmlns:exsl="http://exslt.org/common" extension-element-prefixes="exsl" exclude-result-prefixes="exsl">

  <!-- the content roots the engines print natively: never handled here -->
  <xsl:template name="render-support-content">
    <xsl:variable name="view">
      <description>
        <xsl:apply-templates select="*[not(self::description or self::procedure or self::faultIsolation or self::faultReporting
                                           or self::illustratedPartsCatalog or self::crew or self::refs or self::warningsAndCautions
                                           or self::referencedApplicGroup or self::referencedApplicGroupRef)]" mode="sv"/>
      </description>
    </xsl:variable>
    <xsl:apply-templates select="exsl:node-set($view)/description"/>
  </xsl:template>

  <!-- true for the content roots the engines have no template for (used by callers that must decide whether to call the template) -->
  <xsl:template name="is-support-content">
    <xsl:if test="*[not(self::description or self::procedure or self::faultIsolation or self::faultReporting or self::illustratedPartsCatalog
                        or self::crew or self::refs or self::warningsAndCautions or self::referencedApplicGroup or self::referencedApplicGroupRef)]">1</xsl:if>
  </xsl:template>

  <!-- ================================================================ helpers -->
  <xsl:variable name="sv-upper" select="'ABCDEFGHIJKLMNOPQRSTUVWXYZ'"/>
  <xsl:variable name="sv-lower" select="'abcdefghijklmnopqrstuvwxyz'"/>

  <!-- "structureObjectRuleGroup" -> "Structure object rule group" -->
  <xsl:template name="sv-friendly">
    <xsl:param name="n"/>
    <xsl:param name="first" select="1"/>
    <xsl:param name="prev-lower" select="0"/>
    <xsl:if test="string-length($n) &gt; 0">
      <xsl:variable name="c" select="substring($n, 1, 1)"/>
      <xsl:variable name="isup" select="contains($sv-upper, $c)"/>
      <xsl:choose>
        <xsl:when test="$first = 1"><xsl:value-of select="translate($c, $sv-lower, $sv-upper)"/></xsl:when>
        <xsl:when test="$isup and $prev-lower = 1"><xsl:text> </xsl:text><xsl:value-of select="translate($c, $sv-upper, $sv-lower)"/></xsl:when>
        <xsl:when test="$isup"><xsl:value-of select="translate($c, $sv-upper, $sv-lower)"/></xsl:when>
        <xsl:otherwise><xsl:value-of select="$c"/></xsl:otherwise>
      </xsl:choose>
      <xsl:call-template name="sv-friendly">
        <xsl:with-param name="n" select="substring($n, 2)"/>
        <xsl:with-param name="first" select="0"/>
        <xsl:with-param name="prev-lower" select="not($isup)"/>
      </xsl:call-template>
    </xsl:if>
  </xsl:template>

  <!-- an element with text (and inline markup) only: it is a value, not a section -->
  <xsl:template match="*" mode="sv-is-leaf">
    <xsl:if test="not(*[not(self::emphasis or self::subScript or self::superScript or self::acronym or self::verbatimText or self::internalRef or self::symbol)])">1</xsl:if>
  </xsl:template>

  <!-- "MIC-SDC-SYS-SUBSUB-ASSY-DISASSY-INFO-ILC" of a dmCode -->
  <xsl:template match="dmCode" mode="sv-code">
    <xsl:value-of select="@modelIdentCode"/>-<xsl:value-of select="@systemDiffCode"/>-<xsl:value-of select="@systemCode"/>-<xsl:value-of select="@subSystemCode"/><xsl:value-of select="@subSubSystemCode"/>-<xsl:value-of select="@assyCode"/>-<xsl:value-of select="@disassyCode"/><xsl:value-of select="@disassyCodeVariant"/>-<xsl:value-of select="@infoCode"/><xsl:value-of select="@infoCodeVariant"/>-<xsl:value-of select="@itemLocationCode"/>
    <xsl:if test="@learnCode">-<xsl:value-of select="@learnCode"/><xsl:value-of select="@learnEventCode"/></xsl:if>
  </xsl:template>

  <!-- the one-line value of a leaf-like child (a reference gets its code and title) -->
  <xsl:template match="*" mode="sv-value">
    <xsl:choose>
      <xsl:when test="self::dmRef">
        <xsl:apply-templates select=".//dmCode[1]" mode="sv-code"/>
        <xsl:if test=".//dmTitle"> – <xsl:value-of select="normalize-space(.//dmTitle/techName)"/><xsl:if test=".//dmTitle/infoName"> – <xsl:value-of select="normalize-space(.//dmTitle/infoName)"/></xsl:if></xsl:if>
      </xsl:when>
      <xsl:when test="self::pmRef">
        <xsl:value-of select=".//pmCode/@modelIdentCode"/>-<xsl:value-of select=".//pmCode/@pmIssuer"/>-<xsl:value-of select=".//pmCode/@pmNumber"/>-<xsl:value-of select=".//pmCode/@pmVolume"/>
        <xsl:if test=".//pmTitle"> – <xsl:value-of select="normalize-space(.//pmTitle)"/></xsl:if>
      </xsl:when>
      <xsl:otherwise>
        <xsl:value-of select="normalize-space(.)"/>
        <xsl:for-each select="@*[not(starts-with(name(), 'xmlns') or starts-with(name(), 'xsi:') or starts-with(name(), 'xlink:'))]">
          <xsl:if test="position() = 1 and string-length(normalize-space(..)) &gt; 0"><xsl:text> (</xsl:text></xsl:if>
          <xsl:if test="position() &gt; 1">; </xsl:if>
          <xsl:call-template name="sv-friendly"><xsl:with-param name="n" select="local-name()"/></xsl:call-template>: <xsl:value-of select="."/>
          <xsl:if test="position() = last() and string-length(normalize-space(..)) &gt; 0"><xsl:text>)</xsl:text></xsl:if>
        </xsl:for-each>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- one CALS table cell / row -->
  <xsl:template name="sv-cell"><xsl:param name="t"/><entry><para><xsl:value-of select="$t"/></para></entry></xsl:template>

  <!-- ====================================================== generic structure -->
  <!-- every element with children: a heading, its own data, then its children one level down -->
  <xsl:template match="*" mode="sv">
    <xsl:param name="depth" select="1"/>
    <xsl:variable name="leaf"><xsl:apply-templates select="." mode="sv-is-leaf"/></xsl:variable>
    <xsl:choose>
      <xsl:when test="string($leaf) = '1' and not(parent::content)">
        <!-- a stray value at section level: print it as a paragraph -->
        <para><emphasis><xsl:call-template name="sv-friendly"><xsl:with-param name="n" select="local-name()"/></xsl:call-template>:</emphasis><xsl:text> </xsl:text><xsl:apply-templates select="." mode="sv-value"/></para>
      </xsl:when>
      <xsl:otherwise>
        <levelledPara>
          <title>
            <xsl:call-template name="sv-friendly"><xsl:with-param name="n" select="local-name()"/></xsl:call-template>
            <xsl:choose>
              <xsl:when test="title"><xsl:text> – </xsl:text><xsl:value-of select="normalize-space(title[1])"/></xsl:when>
              <xsl:when test="name and not(name/*)"><xsl:text> – </xsl:text><xsl:value-of select="normalize-space(name[1])"/></xsl:when>
              <xsl:when test="@id"><xsl:text> – </xsl:text><xsl:value-of select="@id"/></xsl:when>
              <xsl:when test="*/@warningIdentNumber or */@cautionIdentNumber"><xsl:text> – </xsl:text><xsl:value-of select="*/@warningIdentNumber | */@cautionIdentNumber"/></xsl:when>
            </xsl:choose>
          </title>
          <xsl:call-template name="sv-data"/>
          <xsl:choose>
            <xsl:when test="$depth &lt; 4">
              <xsl:apply-templates select="*[not(self::title)]" mode="sv-child"><xsl:with-param name="depth" select="$depth + 1"/></xsl:apply-templates>
            </xsl:when>
            <xsl:otherwise>
              <!-- deeper than the heading levels the engines print: keep everything as labelled lines (values AND attributes) -->
              <xsl:for-each select="*[not(self::title)]">
                <para><emphasis><xsl:call-template name="sv-friendly"><xsl:with-param name="n" select="local-name()"/></xsl:call-template>:</emphasis><xsl:text> </xsl:text><xsl:apply-templates select="." mode="sv-flat"/></para>
              </xsl:for-each>
            </xsl:otherwise>
          </xsl:choose>
        </levelledPara>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- "value; Label: value (attr: v)" of an element and everything below it, on one line -->
  <xsl:template match="*" mode="sv-flat">
    <xsl:variable name="kids" select="*"/>
    <xsl:choose>
      <xsl:when test="$kids">
        <xsl:for-each select="@*[not(starts-with(name(), 'xmlns') or starts-with(name(), 'xsi:'))]">
          <xsl:call-template name="sv-friendly"><xsl:with-param name="n" select="local-name()"/></xsl:call-template>: <xsl:value-of select="."/>; </xsl:for-each>
        <xsl:for-each select="$kids">
          <xsl:call-template name="sv-friendly"><xsl:with-param name="n" select="local-name()"/></xsl:call-template>: <xsl:apply-templates select="." mode="sv-flat"/><xsl:if test="position() != last()">; </xsl:if>
        </xsl:for-each>
      </xsl:when>
      <xsl:otherwise><xsl:apply-templates select="." mode="sv-value"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- a child of a section: sections for complex children; leaf children are already in the data table -->
  <xsl:template match="*" mode="sv-child">
    <xsl:param name="depth" select="2"/>
    <xsl:variable name="leaf"><xsl:apply-templates select="." mode="sv-is-leaf"/></xsl:variable>
    <xsl:if test="string($leaf) != '1' and not(self::dmRef or self::pmRef)">
      <xsl:apply-templates select="." mode="sv"><xsl:with-param name="depth" select="$depth"/></xsl:apply-templates>
    </xsl:if>
  </xsl:template>

  <!-- Field / Value table: the element's attributes and its text-only children -->
  <xsl:template name="sv-data">
    <xsl:variable name="attrs" select="@*[not(starts-with(name(), 'xmlns') or starts-with(name(), 'xsi:') or starts-with(name(), 'xlink:'))]"/>
    <xsl:variable name="leaves" select="*[not(self::title)][not(*[not(self::emphasis or self::subScript or self::superScript or self::acronym or self::verbatimText or self::internalRef or self::symbol)]) or self::dmRef or self::pmRef]"/>
    <xsl:if test="$attrs or $leaves">
      <table frame="all">
        <tgroup cols="2">
          <colspec colname="c1" colwidth="35*"/>
          <colspec colname="c2" colwidth="65*"/>
          <thead><row><entry><para>Field</para></entry><entry><para>Value</para></entry></row></thead>
          <tbody>
            <xsl:for-each select="$attrs">
              <row>
                <entry><para><xsl:call-template name="sv-friendly"><xsl:with-param name="n" select="local-name()"/></xsl:call-template></para></entry>
                <entry><para><xsl:value-of select="."/></para></entry>
              </row>
            </xsl:for-each>
            <xsl:for-each select="$leaves">
              <row>
                <entry><para><xsl:choose><xsl:when test="self::dmRef">Data module</xsl:when><xsl:when test="self::pmRef">Publication module</xsl:when>
                  <xsl:otherwise><xsl:call-template name="sv-friendly"><xsl:with-param name="n" select="local-name()"/></xsl:call-template></xsl:otherwise></xsl:choose></para></entry>
                <entry><para><xsl:apply-templates select="." mode="sv-value"/></para></entry>
              </row>
            </xsl:for-each>
          </tbody>
        </tgroup>
      </table>
    </xsl:if>
  </xsl:template>

  <!-- ===================================================================== BREX -->
  <xsl:template match="brex" mode="sv">
    <levelledPara>
      <title>Business rules</title>
      <para>This data module holds <xsl:value-of select="count(.//structureObjectRule)"/> structure object rule<xsl:if test="count(.//structureObjectRule) != 1">s</xsl:if>
        in <xsl:value-of select="count(.//structureObjectRuleGroup)"/> group<xsl:if test="count(.//structureObjectRuleGroup) != 1">s</xsl:if>.
        Flag 0: the object must not appear. Flag 1: it may appear, unrestricted. Flag 2: its value is restricted to the values listed.</para>
    </levelledPara>
    <xsl:for-each select="contextRules">
      <levelledPara>
        <title>Context rules<xsl:if test="@rulesContext"> – <xsl:value-of select="@rulesContext"/></xsl:if></title>
        <xsl:for-each select="structureObjectRuleGroup">
          <levelledPara>
            <title>Structure object rule group <xsl:value-of select="position()"/><xsl:if test="@id"> – <xsl:value-of select="@id"/></xsl:if> (<xsl:value-of select="count(structureObjectRule)"/> rules)</title>
            <table frame="all">
              <tgroup cols="6">
                <colspec colname="c1" colwidth="12*"/><colspec colname="c2" colwidth="26*"/><colspec colname="c3" colwidth="6*"/>
                <colspec colname="c4" colwidth="9*"/><colspec colname="c5" colwidth="22*"/><colspec colname="c6" colwidth="25*"/>
                <thead><row>
                  <entry><para>Rule ID</para></entry><entry><para>Object path</para></entry><entry><para>Flag</para></entry>
                  <entry><para>Severity</para></entry><entry><para>Description</para></entry><entry><para>Allowed values</para></entry>
                </row></thead>
                <tbody>
                  <xsl:for-each select="structureObjectRule">
                    <row>
                      <entry><para><xsl:value-of select="normalize-space(string(.//brDecisionRef/@brDecisionIdentNumber | @id))"/></para></entry>
                      <entry><para><xsl:value-of select="normalize-space(objectPath)"/></para></entry>
                      <entry><para><xsl:value-of select="objectPath/@allowedObjectFlag"/></para></entry>
                      <entry><para><xsl:value-of select="@brSeverityLevel"/></para></entry>
                      <entry><para><xsl:value-of select="normalize-space(objectUse)"/></para></entry>
                      <entry><para>
                        <xsl:for-each select="objectValue">
                          <xsl:if test="position() &gt; 1">; </xsl:if>
                          <xsl:value-of select="@valueAllowed"/>
                          <xsl:if test="@valueForm"> [<xsl:value-of select="@valueForm"/>]</xsl:if>
                          <xsl:if test="string-length(normalize-space(.)) &gt; 0"> (<xsl:value-of select="normalize-space(.)"/>)</xsl:if>
                        </xsl:for-each>
                      </para></entry>
                    </row>
                  </xsl:for-each>
                </tbody>
              </tgroup>
            </table>
          </levelledPara>
        </xsl:for-each>
        <!-- anything else a BREX can hold (SNS rules, notation rules, non-context rules): the generic view -->
        <xsl:apply-templates select="*[not(self::structureObjectRuleGroup)]" mode="sv-child"/>
      </levelledPara>
    </xsl:for-each>
    <xsl:apply-templates select="*[not(self::contextRules)]" mode="sv-child"/>
  </xsl:template>

  <!-- ===================================================================== ACT -->
  <xsl:template match="applicCrossRefTable" mode="sv">
    <levelledPara>
      <title>Applicability cross-reference table</title>
      <xsl:if test="productAttributeList">
        <levelledPara>
          <title>Product attributes</title>
          <table frame="all">
            <tgroup cols="5">
              <colspec colname="c1" colwidth="16*"/><colspec colname="c2" colwidth="18*"/><colspec colname="c3" colwidth="28*"/><colspec colname="c4" colwidth="26*"/><colspec colname="c5" colwidth="12*"/>
              <thead><row><entry><para>Identifier</para></entry><entry><para>Name</para></entry><entry><para>Description</para></entry><entry><para>Allowed values</para></entry><entry><para>Type</para></entry></row></thead>
              <tbody>
                <xsl:for-each select="productAttributeList/productAttribute | productAttributeList/externalProductAttribute">
                  <row>
                    <entry><para><xsl:value-of select="@id"/></para></entry>
                    <entry><para><xsl:value-of select="normalize-space(name | displayName[not(../name)])"/></para></entry>
                    <entry><para><xsl:value-of select="normalize-space(descr)"/><xsl:if test="prompt"> (Prompt: <xsl:value-of select="normalize-space(prompt)"/>)</xsl:if></para></entry>
                    <entry><para><xsl:for-each select="enumeration"><xsl:if test="position() &gt; 1">; </xsl:if><xsl:value-of select="@applicPropertyValues"/><xsl:if test="@enumerationLabel"> (<xsl:value-of select="@enumerationLabel"/>)</xsl:if></xsl:for-each>
                      <xsl:if test="@valuePattern"> pattern <xsl:value-of select="@valuePattern"/></xsl:if></para></entry>
                    <entry><para><xsl:choose><xsl:when test="@valueDataType"><xsl:value-of select="@valueDataType"/></xsl:when><xsl:otherwise>string</xsl:otherwise></xsl:choose><xsl:if test="@productIdentifier and @productIdentifier != 'no'">, <xsl:value-of select="@productIdentifier"/> identifier</xsl:if></para></entry>
                  </row>
                </xsl:for-each>
              </tbody>
            </tgroup>
          </table>
        </levelledPara>
      </xsl:if>
      <xsl:if test="condCrossRefTableRef or productCrossRefTableRef or applicCrossRefTableCatalog">
        <levelledPara>
          <title>Related tables</title>
          <xsl:for-each select="condCrossRefTableRef | productCrossRefTableRef | applicCrossRefTableCatalog/applicCrossRefTableRef">
            <para><emphasis><xsl:choose><xsl:when test="self::condCrossRefTableRef">Conditions table:</xsl:when><xsl:when test="self::productCrossRefTableRef">Products table:</xsl:when><xsl:otherwise>Applicability table:</xsl:otherwise></xsl:choose></emphasis>
              <xsl:text> </xsl:text><xsl:apply-templates select=".//dmRef[1]" mode="sv-value"/></para>
          </xsl:for-each>
        </levelledPara>
      </xsl:if>
    </levelledPara>
  </xsl:template>

  <!-- ===================================================================== CCT -->
  <xsl:template match="condCrossRefTable" mode="sv">
    <levelledPara>
      <title>Conditions cross-reference table</title>
      <levelledPara>
        <title>Condition types</title>
        <table frame="all">
          <tgroup cols="4">
            <colspec colname="c1" colwidth="18*"/><colspec colname="c2" colwidth="20*"/><colspec colname="c3" colwidth="32*"/><colspec colname="c4" colwidth="30*"/>
            <thead><row><entry><para>Identifier</para></entry><entry><para>Name</para></entry><entry><para>Description</para></entry><entry><para>Allowed values</para></entry></row></thead>
            <tbody>
              <xsl:for-each select="condTypeList/condType">
                <row>
                  <entry><para><xsl:value-of select="@id"/></para></entry>
                  <entry><para><xsl:value-of select="normalize-space(name)"/></para></entry>
                  <entry><para><xsl:value-of select="normalize-space(descr)"/></para></entry>
                  <entry><para><xsl:for-each select="enumeration"><xsl:if test="position() &gt; 1">; </xsl:if><xsl:value-of select="@applicPropertyValues"/></xsl:for-each><xsl:if test="@valuePattern"> pattern <xsl:value-of select="@valuePattern"/></xsl:if></para></entry>
                </row>
              </xsl:for-each>
            </tbody>
          </tgroup>
        </table>
      </levelledPara>
      <levelledPara>
        <title>Conditions</title>
        <table frame="all">
          <tgroup cols="4">
            <colspec colname="c1" colwidth="18*"/><colspec colname="c2" colwidth="18*"/><colspec colname="c3" colwidth="24*"/><colspec colname="c4" colwidth="40*"/>
            <thead><row><entry><para>Identifier</para></entry><entry><para>Condition type</para></entry><entry><para>Name</para></entry><entry><para>Description</para></entry></row></thead>
            <tbody>
              <xsl:for-each select="condList/cond | condList/externalCond">
                <row>
                  <entry><para><xsl:value-of select="@id"/></para></entry>
                  <entry><para><xsl:value-of select="@condTypeRefId"/></para></entry>
                  <entry><para><xsl:value-of select="normalize-space(name | displayName[not(../name)])"/></para></entry>
                  <entry><para><xsl:value-of select="normalize-space(descr)"/><xsl:if test="prompt"> (Prompt: <xsl:value-of select="normalize-space(prompt)"/>)</xsl:if></para></entry>
                </row>
              </xsl:for-each>
            </tbody>
          </tgroup>
        </table>
      </levelledPara>
      <xsl:apply-templates select="*[not(self::condTypeList or self::condList)]" mode="sv-child"/>
    </levelledPara>
  </xsl:template>

  <!-- ===================================================================== PCT -->
  <xsl:template match="productCrossRefTable" mode="sv">
    <levelledPara>
      <title>Products cross-reference table</title>
      <xsl:for-each select="product">
        <levelledPara>
          <title>Product <xsl:choose><xsl:when test="@id"><xsl:value-of select="@id"/></xsl:when><xsl:otherwise><xsl:value-of select="position()"/></xsl:otherwise></xsl:choose></title>
          <table frame="all">
            <tgroup cols="3">
              <colspec colname="c1" colwidth="40*"/><colspec colname="c2" colwidth="20*"/><colspec colname="c3" colwidth="40*"/>
              <thead><row><entry><para>Property</para></entry><entry><para>Type</para></entry><entry><para>Value</para></entry></row></thead>
              <tbody>
                <xsl:for-each select="assign">
                  <row>
                    <entry><para><xsl:value-of select="@applicPropertyIdent"/></para></entry>
                    <entry><para><xsl:value-of select="@applicPropertyType"/></para></entry>
                    <entry><para><xsl:value-of select="@applicPropertyValue"/></para></entry>
                  </row>
                </xsl:for-each>
              </tbody>
            </tgroup>
          </table>
        </levelledPara>
      </xsl:for-each>
    </levelledPara>
  </xsl:template>

</xsl:stylesheet>
