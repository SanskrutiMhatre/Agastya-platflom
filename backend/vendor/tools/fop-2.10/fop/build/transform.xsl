<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fo="http://www.w3.org/1999/XSL/Format"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    version="1.0">

    <xsl:output indent="yes" method="xml"/>

   <!-- === Parameters === -->
    <xsl:param name="date.time" select="'Not Specified'"/>
    <xsl:param name="publication.code">UNKNOWN PUBLICATION</xsl:param>
    <xsl:param name="body.start.indent">10mm</xsl:param>
    <xsl:param name="show.unimplemented.markup">1</xsl:param>
    <xsl:param name="security.classification">UNCLASSIFIED</xsl:param>
    <xsl:param name="base.font.family">sans-serif</xsl:param>
    <xsl:param name="base.font.size">10pt</xsl:param>
    <xsl:param name="header.footer.font.size">8pt</xsl:param>

    <!-- Global variable for all data modules - useful for TOC and references -->
    <xsl:variable name="all.dmodules" select="//dmodule"/>
     <xsl:variable name="all.tables" select="//table[title]"/>
    <xsl:variable name="all.figures" select="//figure[title]"/>

    <!-- Extract global info (No namespace prefix) -->
    <xsl:variable name="firstTechName" select="(//dmodule/identAndStatusSection/dmAddress/dmIdent/dmTitle/techName)[1]"/>
    <xsl:variable name="eff.pub.code">
        <xsl:choose>
             <xsl:when test="(//pmIdent/pmCode/@pmCode)[1] != ''"><xsl:value-of select="(//pmIdent/pmCode/@pmCode)[1]"/></xsl:when>
             <xsl:otherwise><xsl:value-of select="$publication.code"/></xsl:otherwise>
        </xsl:choose>
     </xsl:variable>

    <!-- === Root Template === -->
    <xsl:template match="/">
        <fo:root>
            <xsl:call-template name="define-page-layouts"/>
 
            <!-- === Table of Contents === -->
            <xsl:call-template name="generate-toc"/>

            <!-- === Main Document Content === -->
            <fo:page-sequence master-reference="main" initial-page-number="auto" id="main-content-start">
                 <!-- Footer -->
                 <fo:static-content flow-name="xsl-region-after">
                     <fo:block text-align="center" font-size="8pt" border-top="0.5pt solid black" padding-top="3pt">
                         <xsl:value-of select="$security.classification"/> | Page <fo:page-number/> of <fo:page-number-citation ref-id="document-end"/>
                     </fo:block>
                 </fo:static-content>

                 <!-- Header -->
                 <fo:static-content flow-name="xsl-region-before">
                     <fo:block text-align="center" font-size="8pt" border-bottom="0.5pt solid black" padding-bottom="3pt">
                         <xsl:value-of select="$publication.code"/> | <xsl:value-of select="/*[1]/descendant::identAndStatusSection[1]/descendant::dmTitle/techName[1]"/>
                     </fo:block>
                 </fo:static-content>

                 <!-- Body -->
                 <fo:flow flow-name="xsl-region-body">
                     <!-- Process each Data Module -->
                     <xsl:apply-templates select="$all.dmodules"/>

                     <!-- Marker for last page number citation -->
                     <fo:block id="document-end"/>
                 </fo:flow>
            </fo:page-sequence>
        </fo:root>
    </xsl:template>

    <!-- === Page Layout Definitions === -->
    <xsl:template name="define-page-layouts">
        <fo:layout-master-set>
            <!-- Master for regular content pages -->
            <fo:simple-page-master master-name="main"
                                   page-height="297mm" page-width="210mm"
                                   margin-top="20mm" margin-bottom="20mm"
                                   margin-left="25mm" margin-right="25mm">
                <fo:region-body margin-top="10mm" margin-bottom="10mm"/>
                <fo:region-before region-name="xsl-region-before" extent="10mm"/>
                <fo:region-after region-name="xsl-region-after" extent="10mm"/>
            </fo:simple-page-master>

            <!-- Master for TOC pages (could have different margins/header/footer if needed) -->
            <fo:simple-page-master master-name="toc"
                                   page-height="297mm" page-width="210mm"
                                   margin-top="20mm" margin-bottom="20mm"
                                   margin-left="25mm" margin-right="25mm">
                <fo:region-body margin-top="10mm" margin-bottom="10mm"/>
                <fo:region-after region-name="xsl-region-after-toc" extent="10mm" precedence="true"/> <!-- Specific TOC footer -->
            </fo:simple-page-master>

            <!-- Page Sequence Master (can define first, odd, even pages if needed) -->
            <!-- For simplicity, using 'main' for all content pages now -->

        </fo:layout-master-set>
    </xsl:template>

    <!-- === Table of Contents Generation === -->
    <xsl:template name="generate-toc">
         <fo:page-sequence master-reference="toc" id="toc-start" initial-page-number="1" force-page-count="end-on-even">
             <!-- TOC Footer (using Roman numerals) -->
             <fo:static-content flow-name="xsl-region-after-toc">
                  <fo:block text-align="center" font-size="8pt" border-top="0.5pt solid black" padding-top="3pt">
                      Page <fo:page-number format="i"/>
                  </fo:block>
             </fo:static-content>

             <fo:flow flow-name="xsl-region-body">
                 <fo:block font-size="16pt" font-weight="bold" text-align="center"
                           space-after="18pt" space-before="24pt">
                     Table of Contents
                 </fo:block>

                 <xsl:for-each select="$all.dmodules">
                     <xsl:variable name="dmCode">
                         <xsl:call-template name="get.dmcode.string">
                           <xsl:with-param name="dmCodeNode" select="identAndStatusSection/dmAddress/dmIdent/dmCode"/>
                         </xsl:call-template>
                     </xsl:variable>
                     <xsl:variable name="dmId" select="concat('dm_', $dmCode)"/> <!-- Generate unique ID for linking -->

                     <fo:block text-align-last="justify" end-indent="0pt" last-line-end-indent="-10pt" space-after="4pt">
                         <!-- Link the TOC entry text -->
                         <fo:basic-link internal-destination="{$dmId}">
                             <!-- Display DM Code and Title -->
                             <xsl:value-of select="$dmCode"/>
                             <xsl:text> - </xsl:text>
                             <xsl:value-of select="identAndStatusSection/dmAddress/dmIdent/dmTitle/techName"/>
                             <xsl:if test="identAndStatusSection/dmAddress/dmIdent/dmTitle/infoName != ''">
                                 <xsl:text> - </xsl:text>
                                 <xsl:value-of select="identAndStatusSection/dmAddress/dmIdent/dmTitle/infoName"/>
                             </xsl:if>
                         </fo:basic-link>
                         <!-- Dot leader -->
                         <fo:leader leader-pattern="dots" leader-length.optimum="100%"/>
                         <!-- Page number citation -->
                         <fo:page-number-citation ref-id="{$dmId}"/>
                     </fo:block>
                 </xsl:for-each>
             </fo:flow>
         </fo:page-sequence>
    </xsl:template>

    <!-- === Data Module Processing === -->
    <xsl:template match="dmodule">
        <xsl:variable name="dmCode">
             <xsl:call-template name="get.dmcode.string">
               <xsl:with-param name="dmCodeNode" select="identAndStatusSection/dmAddress/dmIdent/dmCode"/>
             </xsl:call-template>
        </xsl:variable>
        <xsl:variable name="dmId" select="concat('dm_', $dmCode)"/>

        <!-- Start each DM on a new page -->
        <fo:block break-before="page" id="{$dmId}" font-family="sans-serif">

            <!-- Data Module Title -->
            <fo:block font-size="14pt" font-weight="bold" space-after="12pt" space-before="18pt" keep-with-next.within-page="always">
                <xsl:value-of select="identAndStatusSection/dmAddress/dmIdent/dmTitle/techName"/>
                <xsl:if test="identAndStatusSection/dmAddress/dmIdent/dmTitle/infoName != ''">
                    <fo:block font-size="12pt" font-weight="normal" font-style="italic" space-before="6pt">
                        <xsl:value-of select="identAndStatusSection/dmAddress/dmIdent/dmTitle/infoName"/>
                    </fo:block>
                </xsl:if>
            </fo:block>

            <!-- DM Code -->
             <fo:block font-size="8pt" space-after="10pt" text-align="right">
                 <xsl:value-of select="$dmCode"/>
             </fo:block>

            <!-- Process DM Content -->
            <xsl:apply-templates select="identAndStatusSection"/>
            <xsl:apply-templates select="content"/>

        </fo:block>
    </xsl:template>

    <!-- IdentAndStatusSection (Minimal processing here, title/code handled in dmodule template) -->
    <xsl:template match="identAndStatusSection">
        <!-- Can add processing for issue date, applicability, reason for update etc. if needed -->
         <fo:block font-size="9pt" font-style="italic" space-after="10pt">
             Issue Date: <xsl:value-of select="dmAddress/dmIdent/issueInfo/@issueNumber"/> - <xsl:value-of select="dmStatus/issueDate/@day"/>/<xsl:value-of select="dmStatus/issueDate/@month"/>/<xsl:value-of select="dmStatus/issueDate/@year"/>
         </fo:block>
         <!-- Add more elements like originator, applicability, quality assurance status etc. -->
    </xsl:template>

    <!-- Content Section -->
    <xsl:template match="content">
        <xsl:apply-templates select="description | procedural | illustratedPartsCatalog | faultIsolation | wiringData | *[not(self::refs)]"/>
        <!-- Process References at the end of the content -->
        <xsl:apply-templates select="refs"/>
    </xsl:template>

    <!-- === Basic Content Elements === -->

    <xsl:template match="description | procedural | illustratedPartsCatalog | faultIsolation | wiringData | commonRepositoryData">
         <!-- Process children - specific styling for children like levelledPara, proceduralStep etc. will apply -->
         <xsl:apply-templates/>
    </xsl:template>

    <xsl:template match="levelledPara">
        <!-- Add ID for potential internal referencing -->
        <xsl:variable name="paraId">
             <xsl:choose>
                 <xsl:when test="@id"><xsl:value-of select="@id"/></xsl:when>
                 <xsl:otherwise><xsl:value-of select="generate-id()"/></xsl:otherwise>
             </xsl:choose>
        </xsl:variable>

        <fo:block id="{$paraId}"
                  space-before="6pt"
                  keep-with-next.within-page="always">
            <!-- Paragraph Number -->
            <xsl:variable name="paraNum">
                <xsl:apply-templates select="." mode="number"/>
            </xsl:variable>
            <fo:inline font-weight="bold">
                 <xsl:value-of select="$paraNum"/><xsl:text>. </xsl:text>
            </fo:inline>

            <!-- Paragraph Title -->
            <xsl:if test="title">
                <fo:inline font-weight="bold">
                    <xsl:apply-templates select="title/node()"/>
                    <xsl:text> </xsl:text> <!-- Space after title -->
                </fo:inline>
            </xsl:if>
        </fo:block>
        <!-- Paragraph Content - Process para and nested levelledPara -->
         <fo:block start-indent="{$body.start.indent}">
             <xsl:apply-templates select="para | levelledPara"/>
         </fo:block>
    </xsl:template>

    <!-- Template for extracting paragraphs -->
    <xsl:template match="para">
        <fo:block font-size="10pt" space-after="4pt" text-align="justify">
            <xsl:apply-templates/>
        </fo:block>
    </xsl:template>

    <!-- Handle bold, italics etc. -->
    <xsl:template match="emphasis">
         <fo:inline font-style="italic"><xsl:apply-templates/></fo:inline>
    </xsl:template>
     <xsl:template match="bold"> <!-- Non-S1000D, but common -->
         <fo:inline font-weight="bold"><xsl:apply-templates/></fo:inline>
    </xsl:template>

    <!-- === Lists === -->
    <xsl:template match="itemizedList">
        <fo:list-block provisional-distance-between-starts="{$body.start.indent}"
                       provisional-label-separation="5pt"
                       space-before="6pt" space-after="6pt">
            <xsl:apply-templates select="listItem"/>
        </fo:list-block>
    </xsl:template>

    <xsl:template match="sequentialList">
        <fo:list-block provisional-distance-between-starts="{$body.start.indent}"
                       provisional-label-separation="5pt"
                       space-before="6pt" space-after="6pt">
            <xsl:apply-templates select="listItem"/>
        </fo:list-block>
    </xsl:template>

    <xsl:template match="listItem">
         <fo:list-item>
             <fo:list-item-label end-indent="label-end()">
                 <fo:block>
                     <xsl:choose>
                         <xsl:when test="parent::itemizedList">•</xsl:when> <!-- Bullet -->
                         <xsl:when test="parent::sequentialList">
                            <xsl:number count="listItem" format="a."/> <!-- Simple alpha numbering -->
                            <!-- S1000D often uses more complex list numbering based on nesting -->
                         </xsl:when>
                     </xsl:choose>
                 </fo:block>
             </fo:list-item-label>
             <fo:list-item-body start-indent="body-start()">
                 <fo:block>
                     <xsl:apply-templates/>
                 </fo:block>
             </fo:list-item-body>
         </fo:list-item>
    </xsl:template>

    <!-- === Procedural Steps === -->
    <xsl:template match="proceduralStep">
        <xsl:variable name="stepId">
             <xsl:choose>
                 <xsl:when test="@id"><xsl:value-of select="@id"/></xsl:when>
                 <xsl:otherwise><xsl:value-of select="generate-id()"/></xsl:otherwise>
             </xsl:choose>
        </xsl:variable>
        <fo:block id="{$stepId}" space-before="8pt">
             <xsl:call-template name="labelled.para">
                 <xsl:with-param name="label">
                     <fo:inline font-weight="bold">
                        <xsl:apply-templates select="." mode="number"/>
                        <xsl:text>. </xsl:text>
                    </fo:inline>
                 </xsl:with-param>
                 <xsl:with-param name="content">
                     <!-- This apply-templates generates the FO fragment that gets passed -->
                     <xsl:apply-templates select="para | warning | caution | note | substep | graphic | table"/>
                 </xsl:with-param>
             </xsl:call-template>
        </fo:block>
    </xsl:template>

     <xsl:template match="substep">
         <!-- Basic substep handling - could use nested lists -->
         <fo:block start-indent="{$body.start.indent}" space-before="4pt">
              <xsl:call-template name="labelled.para">
                 <xsl:with-param name="label">
                    <fo:inline>
                        <!-- Simple substep numbering -->
                        <xsl:number count="substep" level="single" format="(a)"/>
                        <xsl:text> </xsl:text>
                    </fo:inline>
                 </xsl:with-param>
                 <xsl:with-param name="content">
                      <!-- This apply-templates generates the FO fragment that gets passed -->
                      <xsl:apply-templates select="para | warning | caution | note | graphic | table"/>
                 </xsl:with-param>
             </xsl:call-template>
         </fo:block>
     </xsl:template>

    <!-- === Warnings, Cautions, Notes === -->
    <xsl:template match="warning | caution | note">
        <fo:block border="1pt solid black"
                  padding="5pt"
                  space-before="8pt"
                  space-after="8pt"
                  keep-together.within-page="always">
            <fo:block font-weight="bold" space-after="4pt">
                <xsl:choose>
                    <xsl:when test="self::warning">WARNING</xsl:when>
                    <xsl:when test="self::caution">CAUTION</xsl:when>
                    <xsl:when test="self::note">NOTE</xsl:when>
                </xsl:choose>
            </fo:block>
            <xsl:apply-templates select="para | sequentialList | itemizedList"/>
        </fo:block>
    </xsl:template>

    <!-- === Figures and Tables === -->
    <xsl:template match="figure">
         <xsl:variable name="figId">
             <xsl:choose>
                 <xsl:when test="@id"><xsl:value-of select="@id"/></xsl:when>
                 <xsl:otherwise><xsl:value-of select="generate-id()"/></xsl:otherwise>
             </xsl:choose>
        </xsl:variable>
         <fo:block id="{$figId}" space-before="10pt" space-after="10pt" keep-together.within-page="always">
              <!-- Figure Number and Title (Caption) -->
             <fo:block text-align="center" font-weight="bold" space-after="4pt">
                 Figure <xsl:apply-templates select="." mode="number"/>. <xsl:value-of select="title"/>
             </fo:block>
             <!-- Graphic Content -->
             <xsl:apply-templates select="graphic"/>
             <!-- Add legend processing if needed -->
         </fo:block>
    </xsl:template>

     <xsl:template match="graphic">
         <!-- Basic graphic handling - assumes infoEntityIdent points to the image file -->
         <fo:block text-align="center">
             <fo:external-graphic src="url('{@infoEntityIdent}.png')" content-width="scale-to-fit" width="90%" content-height="auto" scaling="uniform"/>
             <!-- Adjust src extension (.png, .jpg, .svg etc) as needed -->
             <!-- Ensure images are accessible relative to the FO file or use absolute paths/URLs -->
         </fo:block>
     </xsl:template>


    <xsl:template match="table">
        <xsl:variable name="tableId">
             <xsl:choose>
                 <xsl:when test="@id"><xsl:value-of select="@id"/></xsl:when>
                 <xsl:otherwise><xsl:value-of select="generate-id()"/></xsl:otherwise>
             </xsl:choose>
        </xsl:variable>
        <fo:block id="{$tableId}" space-before="10pt" space-after="10pt" keep-together.within-page="always">
             <!-- Table Number and Title (Caption) -->
             <fo:block text-align="center" font-weight="bold" space-before="4pt" space-after="6pt">
                 Table <xsl:apply-templates select="." mode="number"/>. <xsl:value-of select="title"/>
             </fo:block>
             <!-- Actual Table -->
             <fo:table table-layout="fixed" width="100%" border-collapse="collapse" border="0.5pt solid black">
                 <!-- Define Columns based on tgroup/@cols -->
                 <xsl:apply-templates select="tgroup"/>
             </fo:table>
        </fo:block>
    </xsl:template>

    <xsl:template match="tgroup">
         <xsl:variable name="numCols" select="@cols"/>
         <!-- Define columns - assuming equal width for simplicity -->
         <xsl:for-each select="colspec">
              <fo:table-column column-number="{@colnum}" column-width="proportional-column-width(1)"/>
              <!-- Could use @colwidth if specified -->
         </xsl:for-each>
         <!-- Process Header and Body -->
         <xsl:apply-templates select="thead"/>
         <xsl:apply-templates select="tbody"/>
    </xsl:template>

    <xsl:template match="thead">
        <fo:table-header font-weight="bold" background-color="#f0f0f0">
            <xsl:apply-templates select="row"/>
        </fo:table-header>
    </xsl:template>

    <xsl:template match="tbody">
        <fo:table-body>
            <xsl:apply-templates select="row"/>
        </fo:table-body>
    </xsl:template>

    <xsl:template match="row">
        <fo:table-row>
            <xsl:apply-templates select="entry"/>
        </fo:table-row>
    </xsl:template>

    <xsl:template match="entry">
         <fo:table-cell border="0.5pt solid black" padding="3pt">
             <!-- Handle column spanning (namest/nameend) if needed -->
             <xsl:attribute name="number-columns-spanned">
                  <xsl:call-template name="calculate-col-span">
                       <xsl:with-param name="entryNode" select="."/>
                  </xsl:call-template>
             </xsl:attribute>
             <!-- Handle row spanning (morerows) if needed -->
             <xsl:if test="@morerows">
                 <xsl:attribute name="number-rows-spanned">
                      <xsl:value-of select="@morerows + 1"/>
                 </xsl:attribute>
             </xsl:if>

             <fo:block>
                 <xsl:apply-templates/>
             </fo:block>
         </fo:table-cell>
    </xsl:template>

     <!-- Helper to calculate column span -->
     <xsl:template name="calculate-col-span">
         <xsl:param name="entryNode"/>
         <xsl:variable name="namest" select="$entryNode/@namest"/>
         <xsl:variable name="nameend" select="$entryNode/@nameend"/>
         <xsl:choose>
             <xsl:when test="$namest and $nameend">
                 <xsl:variable name="startCol" select="ancestor::tgroup[1]/colspec[@colname=$namest]/@colnum"/>
                 <xsl:variable name="endCol" select="ancestor::tgroup[1]/colspec[@colname=$nameend]/@colnum"/>
                 <xsl:choose>
                    <xsl:when test="number($startCol) > 0 and number($endCol) >= number($startCol)">
                         <xsl:value-of select="$endCol - $startCol + 1"/>
                    </xsl:when>
                    <xsl:otherwise>1</xsl:otherwise> <!-- Error case -->
                 </xsl:choose>
             </xsl:when>
             <xsl:otherwise>1</xsl:otherwise> <!-- Default span is 1 -->
         </xsl:choose>
     </xsl:template>

    <!-- === References Section === -->
    <xsl:template match="refs">
        <fo:block font-size="12pt" font-weight="bold" space-before="18pt" space-after="6pt" break-before="page">
            References
        </fo:block>
        <!-- Process specific reference types -->
        <xsl:apply-templates select="dmRef | externalPubRef"/>
    </xsl:template>

    <!-- Content References (dmRef) -->
    <xsl:template match="dmRef">
        <xsl:variable name="dm.ref.dm.code.node" select="dmRefIdent/dmCode"/>
        <xsl:variable name="dm.ref.dm.code.string">
             <xsl:call-template name="get.dmcode.string">
                 <xsl:with-param name="dmCodeNode" select="$dm.ref.dm.code.node"/>
             </xsl:call-template>
        </xsl:variable>
        <xsl:variable name="dmId" select="concat('dm_', $dm.ref.dm.code.string)"/>

        <fo:block space-after="4pt" start-indent="{$body.start.indent}">
             <!-- Check if the referenced DM is in the current document set -->
             <xsl:variable name="targetDm" select="$all.dmodules[identAndStatusSection/dmAddress/dmIdent/dmCode[@modelIdentCode=$dm.ref.dm.code.node/@modelIdentCode and @systemDiffCode=$dm.ref.dm.code.node/@systemDiffCode and @systemCode=$dm.ref.dm.code.node/@systemCode and @subSubSystemCode=$dm.ref.dm.code.node/@subSubSystemCode and @subSubSubSystemCode=$dm.ref.dm.code.node/@subSubSubSystemCode and @assyCode=$dm.ref.dm.code.node/@assyCode and @disassyCode=$dm.ref.dm.code.node/@disassyCode and @disassyCodeVariant=$dm.ref.dm.code.node/@disassyCodeVariant and @infoCode=$dm.ref.dm.code.node/@infoCode and @infoCodeVariant=$dm.ref.dm.code.node/@infoCodeVariant and @itemLocationCode=$dm.ref.dm.code.node/@itemLocationCode]]"/>

             <xsl:choose>
                 <xsl:when test="$targetDm">
                     <!-- Create internal link -->
                     <fo:basic-link internal-destination="{$dmId}">
                         <xsl:value-of select="$dm.ref.dm.code.string"/>
                     </fo:basic-link>
                 </xsl:when>
                 <xsl:otherwise>
                     <!-- Just display code if not found locally -->
                     <xsl:value-of select="$dm.ref.dm.code.string"/>
                 </xsl:otherwise>
             </xsl:choose>

             <!-- Display Title -->
             <xsl:text> - </xsl:text>
             <xsl:choose>
                 <xsl:when test="dmRefAddressItems/dmTitle">
                     <xsl:value-of select="dmRefAddressItems/dmTitle/techName"/>
                     <xsl:if test="dmRefAddressItems/dmTitle/infoName != ''">
                         <xsl:text> - </xsl:text>
                         <xsl:value-of select="dmRefAddressItems/dmTitle/infoName"/>
                     </xsl:if>
                 </xsl:when>
                 <xsl:when test="$targetDm/identAndStatusSection/dmAddress/dmIdent/dmTitle">
                     <!-- Get title from target if available -->
                      <xsl:value-of select="$targetDm/identAndStatusSection/dmAddress/dmIdent/dmTitle/techName"/>
                      <xsl:if test="$targetDm/identAndStatusSection/dmAddress/dmIdent/dmTitle/infoName != ''">
                         <xsl:text> - </xsl:text>
                         <xsl:value-of select="$targetDm/identAndStatusSection/dmAddress/dmIdent/dmTitle/infoName"/>
                     </xsl:if>
                 </xsl:when>
                  <xsl:otherwise>
                     <fo:inline font-style="italic">(Title Not Available)</fo:inline>
                 </xsl:otherwise>
             </xsl:choose>
        </fo:block>
    </xsl:template>

     <!-- External Publication References -->
     <xsl:template match="externalPubRef">
         <fo:block space-after="4pt" start-indent="{$body.start.indent}">
             <xsl:value-of select="externalPubRefIdent/externalPubCode"/>
             <xsl:text> - </xsl:text>
             <xsl:value-of select="externalPubRefIdent/externalPubTitle"/>
         </fo:block>
     </xsl:template>

    <!-- === Numbering Templates === -->

    <!-- Numbering for elements within a dmodule -->
    <xsl:template match="levelledPara | figure | table | proceduralStep" mode="number">
        <!-- Hierarchical numbering based on nesting within the content section -->
        <xsl:number level="multiple" count="levelledPara | figure | table | proceduralStep" format="1.1.1" from="content"/>
    </xsl:template>

    <!-- === Internal References === -->
    <xsl:template match="internalRef">
        <xsl:variable name="refId" select="@internalRefId"/>
        <!-- Find the target element anywhere in the document using its ID -->
        <xsl:variable name="target" select="//*[@id = $refId][1]"/> <!-- Use [1] just in case of duplicate IDs -->

        <fo:basic-link internal-destination="{$refId}">
            <xsl:choose>
                <xsl:when test="$target">
                    <!-- Generate text based on target type -->
                    <xsl:choose>
                        <xsl:when test="name($target) = 'levelledPara'">
                            <xsl:text>para </xsl:text>
                            <xsl:apply-templates select="$target" mode="number"/>
                        </xsl:when>
                        <xsl:when test="name($target) = 'figure'">
                            <xsl:text>Figure </xsl:text>
                            <xsl:apply-templates select="$target" mode="number"/>
                        </xsl:when>
                         <xsl:when test="name($target) = 'table'">
                            <xsl:text>Table </xsl:text>
                            <xsl:apply-templates select="$target" mode="number"/>
                        </xsl:when>
                        <xsl:when test="name($target) = 'proceduralStep'">
                            <xsl:text>step </xsl:text>
                            <xsl:apply-templates select="$target" mode="number"/>
                        </xsl:when>
                        <xsl:when test="@internalRefTargetType = 'irtt01' and $target/title"> <!-- Table -->
                             <xsl:text>Table </xsl:text>
                             <xsl:apply-templates select="$target" mode="number"/>
                        </xsl:when>
                        <xsl:when test="@internalRefTargetType = 'irtt02' and $target/title"> <!-- Figure -->
                             <xsl:text>Figure </xsl:text>
                             <xsl:apply-templates select="$target" mode="number"/>
                        </xsl:when>
                        <xsl:when test="@internalRefTargetType = 'irtt05' and $target/para"> <!-- Para -->
                             <xsl:text>para </xsl:text>
                             <xsl:apply-templates select="$target" mode="number"/>
                        </xsl:when>
                         <xsl:when test="@internalRefTargetType = 'irtt11' and $target/para"> <!-- Step -->
                             <xsl:text>step </xsl:text>
                             <xsl:apply-templates select="$target" mode="number"/>
                        </xsl:when>
                        <!-- Add more cases as needed -->
                        <xsl:otherwise>
                            <!-- Fallback: Use provided text or the ID itself -->
                            <xsl:choose>
                                <xsl:when test="normalize-space(.) != ''"><xsl:apply-templates/></xsl:when>
                                <xsl:otherwise><xsl:value-of select="$refId"/></xsl:otherwise>
                            </xsl:choose>
                        </xsl:otherwise>
                    </xsl:choose>
                </xsl:when>
                <xsl:otherwise>
                    <!-- Target not found - display error or placeholder -->
                    <fo:inline color="red" font-weight="bold">
                        [Missing Target: <xsl:value-of select="$refId"/>]
                    </fo:inline>
                    <xsl:apply-templates/> <!-- Display any text content of internalRef -->
                </xsl:otherwise>
            </xsl:choose>
        </fo:basic-link>
    </xsl:template>

    <!-- === Utility Templates === -->

    <!-- Labelled Paragraph Structure (used for steps) -->
    <xsl:template name="labelled.para">
        <xsl:param name="label"/>
        <xsl:param name="content"/>
        <fo:list-block provisional-distance-between-starts="{$body.start.indent}"
                       provisional-label-separation="5pt">
            <fo:list-item>
                <fo:list-item-label end-indent="label-end()">
                    <fo:block>
                        <xsl:copy-of select="$label"/>
                    </fo:block>
                </fo:list-item-label>
                <fo:list-item-body start-indent="body-start()">
                     <!-- **** CORRECTED PART **** -->
                     <fo:block>
                         <xsl:copy-of select="$content"/>
                     </fo:block>
                </fo:list-item-body>
            </fo:list-item>
        </fo:list-block>
    </xsl:template>

    <!-- Helper to construct the standard DM Code string -->
    <xsl:template name="get.dmcode.string">
         <xsl:param name="dmCodeNode"/>
         <xsl:value-of select="concat(
                'DMC-',
                $dmCodeNode/@modelIdentCode, '-',
                $dmCodeNode/@systemDiffCode, '-',
                $dmCodeNode/@systemCode, '-',
                $dmCodeNode/@subSubSystemCode,
                $dmCodeNode/@subSubSubSystemCode, '-',
                $dmCodeNode/@assyCode, '-',
                $dmCodeNode/@disassyCode,
                $dmCodeNode/@disassyCodeVariant, '-',
                $dmCodeNode/@infoCode,
                $dmCodeNode/@infoCodeVariant, '-',
                $dmCodeNode/@itemLocationCode
            )"/>
    </xsl:template>

    <!-- Fallback for unimplemented elements -->
    <xsl:template match="*">
         <xsl:if test="$show.unimplemented.markup = 1">
             <fo:block color="gray" font-style="italic" space-before="6pt" space-after="6pt" border="0.5pt dashed gray" padding="3pt">
                 [Unhandled Element: <xsl:value-of select="name()"/>
                  <xsl:if test="@id"> (ID: <xsl:value-of select="@id"/>)</xsl:if>]
                 <!-- Optionally process children to see what's inside -->
                 <!-- <xsl:apply-templates/> -->
             </fo:block>
         </xsl:if>
    </xsl:template>

    <xsl:template match="text()">
      <!-- Normalize space to avoid excessive whitespace issues, but preserve single spaces -->
      <xsl:value-of select="normalize-space(.)"/>
    </xsl:template>

    <!-- Ignore comments and processing instructions -->
    <xsl:template match="comment() | processing-instruction()"/>

</xsl:stylesheet>