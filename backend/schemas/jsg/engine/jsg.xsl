<?xml version="1.0" encoding="UTF-8"?>
<!--
  JSG engine entry point: <jsgdoc> (schemas/jsg/jsg-1.0.xsd) -> XSL-FO. Apache FOP turns the FO into the PDF (services/jsg/engine.ts).
  Independent of the JSS (jsstofo) and S1000D (s1000dtofo) stylesheets: nothing is included from them and nothing of this is included by them.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:fo="http://www.w3.org/1999/XSL/Format">
  <xsl:output method="xml" indent="no" encoding="UTF-8"/>
  <xsl:include href="jsg-common.xsl"/>
  <xsl:include href="jsg-uhb.xsl"/>
  <xsl:include href="jsg-ispl.xsl"/>

  <xsl:template match="/jsgdoc">
    <fo:root>
      <xsl:call-template name="layout-master-set"/>
      <xsl:apply-templates select="." mode="document"/>
    </fo:root>
  </xsl:template>
</xsl:stylesheet>
