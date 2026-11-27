/**
 * New data module templates. Every template is validated against the official
 * S1000D schemas for issues 4.2, 5.0, 6 and 7 by the unit test suite.
 */
import { DEFAULT_BREX, DmCodeParts, schemaUrl, todayParts } from './s1000d';
import { escapeAttr, escapeText } from './xml';

export interface NewDmOptions {
  issue: string;
  schema: string;
  code: DmCodeParts;
  language: string;
  country: string;
  issueNumber: string;
  inWork: string;
  techName: string;
  infoName: string;
  security: string;
  enterpriseCode: string;
  enterpriseName: string;
  /** The originator, when it is not the responsible partner company (the default: the same enterprise). */
  originatorCode?: string;
  originatorName?: string;
  applicability: string;
  date?: Date;
  /** Optional project BREX DMC; defaults to the S1000D default BREX for the issue. */
  brex?: DmCodeParts;
}

export interface TemplateDef {
  schema: string;
  label: string;
  description: string;
  infoCode: string;
  infoName: string;
  body: string;
}

export const TEMPLATES: TemplateDef[] = [
  {
    schema: 'descript',
    label: 'Descriptive',
    description: 'Descriptive information with levelled paragraphs, figures and tables.',
    infoCode: '040',
    infoName: 'Description of how it is made and its function',
    body: `<description>
  <levelledPara>
    <title>General</title>
    <para>Type the description here.</para>
  </levelledPara>
</description>`,
  },
  {
    schema: 'proced',
    label: 'Procedural',
    description: 'Maintenance procedure with preliminary requirements, steps and close-up.',
    infoCode: '520',
    infoName: 'Remove procedure',
    body: `<procedure>
  <preliminaryRqmts>
    <reqCondGroup>
      <noConds/>
    </reqCondGroup>
    <reqSupportEquips>
      <noSupportEquips/>
    </reqSupportEquips>
    <reqSupplies>
      <noSupplies/>
    </reqSupplies>
    <reqSpares>
      <noSpares/>
    </reqSpares>
    <reqSafety>
      <noSafety/>
    </reqSafety>
  </preliminaryRqmts>
  <mainProcedure>
    <proceduralStep>
      <para>Type the first step here.</para>
    </proceduralStep>
  </mainProcedure>
  <closeRqmts>
    <reqCondGroup>
      <noConds/>
    </reqCondGroup>
  </closeRqmts>
</procedure>`,
  },
  {
    schema: 'fault',
    label: 'Fault isolation',
    description: 'Fault isolation procedure with yes/no decision steps.',
    infoCode: '421',
    infoName: 'Fault isolation',
    body: `<faultIsolation>
  <faultIsolationProcedure>
    <isolationProcedure>
      <preliminaryRqmts>
        <reqCondGroup>
          <noConds/>
        </reqCondGroup>
        <reqSupportEquips>
          <noSupportEquips/>
        </reqSupportEquips>
        <reqSupplies>
          <noSupplies/>
        </reqSupplies>
        <reqSpares>
          <noSpares/>
        </reqSpares>
        <reqSafety>
          <noSafety/>
        </reqSafety>
      </preliminaryRqmts>
      <isolationMainProcedure>
        <isolationStep id="isol-0001">
          <action>Check the system indicator.</action>
          <isolationStepQuestion>Is the indicator on?</isolationStepQuestion>
          <isolationStepAnswer>
            <yesNoAnswer>
              <yesAnswer nextActionRefId="isol-end1"/>
              <noAnswer nextActionRefId="isol-end2"/>
            </yesNoAnswer>
          </isolationStepAnswer>
        </isolationStep>
        <isolationProcedureEnd id="isol-end1">
          <action>The system is serviceable.</action>
        </isolationProcedureEnd>
        <isolationProcedureEnd id="isol-end2">
          <action>Replace the unit.</action>
        </isolationProcedureEnd>
      </isolationMainProcedure>
      <closeRqmts>
        <reqCondGroup>
          <noConds/>
        </reqCondGroup>
      </closeRqmts>
    </isolationProcedure>
  </faultIsolationProcedure>
</faultIsolation>`,
  },
  {
    schema: 'crew',
    label: 'Crew/Operator',
    description: 'Crew reference card with challenge-and-response drill steps.',
    infoCode: '131',
    infoName: 'Normal operation',
    body: `<crew>
  <crewRefCard>
    <title>Before start</title>
    <crewDrill>
      <crewDrillStep>
        <challengeAndResponse>
          <challenge>
            <para>Parking brake</para>
          </challenge>
          <response>
            <para>SET</para>
          </response>
        </challengeAndResponse>
      </crewDrillStep>
    </crewDrill>
  </crewRefCard>
</crew>`,
  },
  {
    schema: 'ipd',
    label: 'Illustrated parts data',
    description: 'Parts catalog with catalog sequence numbers and part references.',
    infoCode: '941',
    infoName: 'Illustrated parts data',
    body: `<illustratedPartsCatalog>
  <catalogSeqNumber figureNumber="01" item="001" indenture="1">
    <itemSeqNumber itemSeqNumberValue="00A">
      <quantityPerNextHigherAssy>1</quantityPerNextHigherAssy>
      <partRef manufacturerCodeValue="00000" partNumberValue="PN-0001"/>
    </itemSeqNumber>
  </catalogSeqNumber>
</illustratedPartsCatalog>`,
  },
  {
    schema: 'brex',
    label: 'Business rules exchange',
    description: 'Project BREX with context (structure object) rules.',
    infoCode: '022',
    infoName: 'Business rules exchange',
    body: `<brex>
  <contextRules>
    <structureObjectRuleGroup>
      <structureObjectRule>
        <objectPath allowedObjectFlag="0">//emphasis[@emphasisType = 'em05']</objectPath>
        <objectUse>Strikethrough emphasis must not be used.</objectUse>
      </structureObjectRule>
    </structureObjectRuleGroup>
  </contextRules>
</brex>`,
  },
  {
    schema: 'comrep',
    label: 'Common information repository',
    description: 'Repository of reusable warnings and cautions.',
    infoCode: '00L',
    infoName: 'Warnings and cautions repository',
    body: `<commonRepository>
  <warningRepository>
    <warningSpec>
      <warningIdent warningIdentNumber="WRN-0001"/>
      <warningAndCautionPara>Hazardous voltage. Disconnect power before maintenance.</warningAndCautionPara>
    </warningSpec>
  </warningRepository>
</commonRepository>`,
  },
  {
    schema: 'appliccrossreftable',
    label: 'Applicability cross-reference table',
    description: 'ACT: the applicability properties and their allowed values.',
    infoCode: '00W',
    infoName: 'Applicability cross-reference table',
    body: `<applicCrossRefTable>
  <productAttributeList>
    <productAttribute id="prodattr-0001">
      <name>Version</name>
      <displayName>Version</displayName>
      <descr>Product version</descr>
      <enumeration applicPropertyValues="A"/>
    </productAttribute>
  </productAttributeList>
</applicCrossRefTable>`,
  },
  {
    schema: 'condcrossreftable',
    label: 'Conditions cross-reference table',
    description: 'CCT: the conditions that applicability can depend on.',
    infoCode: '00Q',
    infoName: 'Conditions cross-reference table',
    body: `<condCrossRefTable>
  <condTypeList>
    <condType id="condtype-0001">
      <name>Environment</name>
      <descr>Environmental conditions</descr>
    </condType>
  </condTypeList>
  <condList>
    <cond id="cond-0001" condTypeRefId="condtype-0001">
      <name>Temperature</name>
      <descr>Ambient temperature</descr>
    </cond>
  </condList>
</condCrossRefTable>`,
  },
  {
    schema: 'prdcrossreftable',
    label: 'Product cross-reference table',
    description: 'PCT: which product instances have which property values.',
    infoCode: '00P',
    infoName: 'Product cross-reference table',
    body: `<productCrossRefTable>
  <product>
    <assign applicPropertyIdent="prodattr-0001" applicPropertyType="prodattr" applicPropertyValue="A"/>
  </product>
</productCrossRefTable>`,
  },
  {
    schema: 'brdoc',
    label: 'Business rules document',
    description: 'Human-readable business rules (decision points).',
    infoCode: '024',
    infoName: 'Business rules',
    body: `<brDoc/>`,
  },
  {
    schema: 'checklist',
    label: 'Checklist',
    description: 'Operator checklist with items to check.',
    infoCode: '135',
    infoName: 'Normal operation procedures checklist',
    body: `<checkList>
  <checkListInfo>
    <checkListItems>
      <checkListItem>
        <name>Item</name>
      </checkListItem>
    </checkListItems>
  </checkListInfo>
</checkList>`,
  },
  {
    schema: 'container',
    label: 'Container',
    description: 'Groups references to other data modules.',
    infoCode: '914',
    infoName: 'Container data module',
    body: `<container>
  <refs>
    <dmRef>
      <dmRefIdent>
        <dmCode modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="040" infoCodeVariant="A" itemLocationCode="D"/>
      </dmRefIdent>
    </dmRef>
  </refs>
</container>`,
  },
  {
    schema: 'frontmatter',
    label: 'Front matter',
    description: 'Publication title page.',
    infoCode: '001',
    infoName: 'Title page',
    body: `<frontMatter>
  <frontMatterTitlePage>
    <pmTitle>Publication title</pmTitle>
    <pmCode modelIdentCode="EXAMPLE" pmIssuer="00000" pmNumber="00001" pmVolume="00"/>
    <issueInfo issueNumber="001" inWork="00"/>
    <issueDate year="@@YEAR@@" month="@@MONTH@@" day="@@DAY@@"/>
    <security securityClassification="01"/>
    <responsiblePartnerCompany enterpriseCode="00000">
      <enterpriseName>Example Company</enterpriseName>
    </responsiblePartnerCompany>
  </frontMatterTitlePage>
</frontMatter>`,
  },
  {
    schema: 'learning',
    label: 'Learning',
    description: 'Training content: a learning plan.',
    infoCode: '952',
    infoName: 'Generic learning content',
    body: `<learning>
  <learningPlan/>
</learning>`,
  },
  {
    schema: 'process',
    label: 'Process',
    description: 'A sequence of data modules or steps.',
    infoCode: '951',
    infoName: 'Generic process',
    body: `<process>
  <dmSeq>
    <dmNode>
      <proceduralStep>
        <para>Type the first step here.</para>
      </proceduralStep>
    </dmNode>
  </dmSeq>
</process>`,
  },
  {
    schema: 'sb',
    label: 'Service bulletin',
    description: 'Service bulletin with management, planning and accomplishment information.',
    infoCode: '930',
    infoName: 'Service bulletin',
    body: `<sb>
  <sbManagementInfo>
    <sbCompliance sbComplianceCategory="sbcc01"/>
    <sbTaskType sbTaskCategory="sbtc01"/>
    <sbOriginalIssueDate>
      <issueDate year="@@YEAR@@" month="@@MONTH@@" day="@@DAY@@"/>
    </sbOriginalIssueDate>
  </sbManagementInfo>
  <sbRevisionInfo>
    <noInfo/>
  </sbRevisionInfo>
  <sbSummary>
    <noInfo/>
  </sbSummary>
  <sbPlanningInfo>
    <noInfo/>
  </sbPlanningInfo>
  <sbMaterialInfo>
    <noInfo/>
  </sbMaterialInfo>
  <sbAccomplishmentInstructions>
    <noInfo/>
  </sbAccomplishmentInstructions>
  <sbAdditionalInfo>
    <noInfo/>
  </sbAdditionalInfo>
</sb>`,
  },
  {
    schema: 'schedul',
    label: 'Maintenance schedule',
    description: 'Maintenance planning: inspections and their definitions.',
    infoCode: '000',
    infoName: 'Maintenance planning (set the information code for your project)',
    body: `<maintPlanning>
  <inspectionDefinition>
    <inspection/>
  </inspectionDefinition>
</maintPlanning>`,
  },
  {
    schema: 'scocontent',
    label: 'SCO content',
    description: 'SCORM learning object content.',
    infoCode: '000',
    infoName: 'SCO content (set the information code for your project)',
    body: `<scoContent/>`,
  },
  {
    schema: 'wrngdata',
    label: 'Wiring data',
    description: 'Wiring data (wires, connectors, harnesses).',
    infoCode: '000',
    infoName: 'Wiring data (set the information code for your project)',
    body: `<wiringData/>`,
  },
  {
    schema: 'wrngflds',
    label: 'Wiring fields',
    description: 'Wiring data field definitions.',
    // S1000D 4.2 Chap 5.2.1.4: wiring data description modules are coded 029 (Data structure). Was a 000 placeholder before the specification was checked.
    infoCode: '029',
    infoName: 'Wiring data description (data structure)',
    body: `<wiringFields/>`,
  },
];

export function templateFor(schema: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.schema === schema);
}

function indent(s: string, pad: string): string {
  return s.split('\n').map((l) => (l ? pad + l : l)).join('\n');
}

function dmCodeXml(p: DmCodeParts): string {
  const attrs: [string, string | undefined][] = [
    ['modelIdentCode', p.modelIdentCode], ['systemDiffCode', p.systemDiffCode], ['systemCode', p.systemCode],
    ['subSystemCode', p.subSystemCode], ['subSubSystemCode', p.subSubSystemCode], ['assyCode', p.assyCode],
    ['disassyCode', p.disassyCode], ['disassyCodeVariant', p.disassyCodeVariant], ['infoCode', p.infoCode],
    ['infoCodeVariant', p.infoCodeVariant], ['itemLocationCode', p.itemLocationCode], ['learnCode', p.learnCode],
    ['learnEventCode', p.learnEventCode],
  ];
  return '<dmCode ' + attrs.filter(([, v]) => v).map(([k, v]) => `${k}="${escapeAttr(v!)}"`).join(' ') + '/>';
}

export function defaultBrexCode(issue: string): DmCodeParts {
  return {
    modelIdentCode: 'S1000D', systemDiffCode: DEFAULT_BREX[issue] ?? 'G', systemCode: '04', subSystemCode: '1',
    subSubSystemCode: '0', assyCode: '0301', disassyCode: '00', disassyCodeVariant: 'A', infoCode: '022',
    infoCodeVariant: 'A', itemLocationCode: 'D',
  };
}

export function buildDataModule(o: NewDmOptions): string {
  const t = templateFor(o.schema);
  if (!t) throw new Error('No template for schema ' + o.schema);
  const d = todayParts(o.date);
  const brex = o.brex ?? defaultBrexCode(o.issue);
  const ent = `enterpriseCode="${escapeAttr(o.enterpriseCode)}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<dmodule xmlns:dc="http://www.purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="${schemaUrl(o.issue, o.schema)}">
  <identAndStatusSection>
    <dmAddress>
      <dmIdent>
        ${dmCodeXml(o.code)}
        <language languageIsoCode="${escapeAttr(o.language)}" countryIsoCode="${escapeAttr(o.country)}"/>
        <issueInfo issueNumber="${escapeAttr(o.issueNumber)}" inWork="${escapeAttr(o.inWork)}"/>
      </dmIdent>
      <dmAddressItems>
        <issueDate year="${d.year}" month="${d.month}" day="${d.day}"/>
        <dmTitle>
          <techName>${escapeText(o.techName)}</techName>${o.infoName ? `
          <infoName>${escapeText(o.infoName)}</infoName>` : ''}
        </dmTitle>
      </dmAddressItems>
    </dmAddress>
    <dmStatus issueType="new">
      <security securityClassification="${escapeAttr(o.security)}"/>
      <responsiblePartnerCompany ${ent}>
        <enterpriseName>${escapeText(o.enterpriseName)}</enterpriseName>
      </responsiblePartnerCompany>
      <originator ${o.originatorCode ? `enterpriseCode="${escapeAttr(o.originatorCode)}"` : ent}>
        <enterpriseName>${escapeText(o.originatorCode ? (o.originatorName ?? '') : o.enterpriseName)}</enterpriseName>
      </originator>
      <applic>
        <displayText>
          <simplePara>${escapeText(o.applicability || 'All')}</simplePara>
        </displayText>
      </applic>
      <brexDmRef>
        <dmRef>
          <dmRefIdent>
            ${dmCodeXml(brex)}
          </dmRefIdent>
        </dmRef>
      </brexDmRef>
      <qualityAssurance>
        <unverified/>
      </qualityAssurance>
    </dmStatus>
  </identAndStatusSection>
  <content>
${indent(t.body.replace('@@YEAR@@', d.year).replace('@@MONTH@@', d.month).replace('@@DAY@@', d.day), '    ')}
  </content>
</dmodule>
`;
}

export function defaultNewDmOptions(schema = 'descript', issue = '4-2'): NewDmOptions {
  const t = templateFor(schema) ?? TEMPLATES[0];
  return {
    issue,
    schema: t.schema,
    code: {
      modelIdentCode: 'EXAMPLE', systemDiffCode: 'A', systemCode: '00', subSystemCode: '0', subSubSystemCode: '0',
      assyCode: '00', disassyCode: '00', disassyCodeVariant: 'A', infoCode: t.infoCode, infoCodeVariant: 'A',
      itemLocationCode: 'D',
    },
    language: 'en',
    country: 'US',
    issueNumber: '001',
    inWork: '00',
    techName: 'Example system',
    infoName: t.infoName,
    security: '01',
    enterpriseCode: '00000',
    enterpriseName: 'Example Company',
    applicability: 'All',
  };
}
