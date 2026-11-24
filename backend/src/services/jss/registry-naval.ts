// The JSS NAVAL document types: one entry per stencil in `Sampels/NAval_stencil`, with what each stencil fixes.
// Read from the stencils' Word XML (document.xml: headings, tables, section setup) - see docs/JSS_NAVAL_STENCIL_ANALYSIS.md for every value and
// for what the stencils do NOT settle (those choices are listed there as assumptions, never presented as stencil facts).
//
// Three families share this file:
//   handbooks   User Handbook, TM Part I, II, III, Design Specification: chapter manuals with the same frame as the Land handbooks
//   parts       TM Part IV Vol 1 (parts list) and Vol 2 (illustrations): the chapters are the author's (one per system / sub-system)
//   lists       MRLS, Complete Equipment Schedule, List of SMT / STE: a wide table is the body, with a frame of their own (Amendments, Warning ...)
//
// Types are keyed `naval-...` because a Land type is already called `uhb` / `mm` / `orm` and a project stores the id.

import type { HeadCell, JssDocType, OutlineNode, TableTemplate } from './registry';

// ── Tables the stencils fix ──────────────────────────────────────────────────────────────────────────────
// Widths are the stencils' own, kept as PROPORTIONS ("12.9*"): the pipeline's landscape pages are not the stencils' (it uses one set of margins for every
// orientation), so a fixed millimetre width would overflow where a proportion fits.

const cells = (...texts: string[]): HeadCell[] => texts.map((text) => ({ text }));
const stars = (mm: number[]): string => mm.map((v) => `${v}*`).join(' ');

/** Vol 1 parts list. The Naval stencil points to "Annx XIV" for the page format and does not include it, so the format is the one of the Land Vol_1_PL stencil (same publisher, same ten columns: the Naval text itself speaks of Column (8) 'P' and Column (9) DS Cat. No.). */
export const PARTS_TABLE: TableTemplate = {
  widths: stars([10.8, 55, 45.6, 20.3, 30.4, 17.8, 25.3, 10.1, 27.9, 23.5]),
  head: [
    cells('Sl. No.', 'Description', 'Manufacturer’s Part No.', 'Cct Ref.', 'Fig, Item', 'No. Off', 'Para Ref.', '‘P’', 'DS Cat No.', 'Remarks'),
    cells('[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]', '[8]', '[9]', '[10]'),
  ],
  blankRows: 3,
};

/** MRLS: 14 columns on an 18-column grid; "Recommended Nos." spans five. */
export const MRLS_TABLE: TableTemplate = {
  widths: stars([12.9, 30.5, 36, 88, 17.5, 15, 25, 27.5, 15, 12.5, 10, 10, 12.5, 30, 7.5, 7.5, 7.5, 24.8]),
  head: [
    [
      { text: 'Sr. No.', rowspan: 2 }, { text: 'Sub Assembly', rowspan: 2 }, { text: 'Part No.', rowspan: 2 }, { text: 'Nomenclature', rowspan: 2 }, { text: 'Source of Supply', rowspan: 2 },
      { text: 'Nos. of Fitted', rowspan: 2 }, { text: 'ISPL Ref.', rowspan: 2 }, { text: 'Unit Cost, Rs.', rowspan: 2 },
      { text: 'Recommended Nos. for 52 Systems for Two Years', colspan: 5, open: true },
      { text: 'Total Cost, Rs.', rowspan: 2 }, { text: 'H M L', rowspan: 2 }, { text: 'F N S', rowspan: 2 }, { text: 'V E D', rowspan: 2 }, { text: 'Remarks', rowspan: 2 },
    ],
    cells('Unit Repair point (26)', 'Field Repair Point (22)', 'COD (1)', 'ABW', 'Total Qty.'),
  ],
  blankRows: 3,
};

/** Complete Equipment Schedule: four tables, one per section. */
const CES_SYSTEM: TableTemplate = {
  widths: stars([9.8, 42.6, 35, 15, 35, 12.5, 19.9]),
  head: [cells('Sr. No.', 'Description', 'Manufacturer’s Part No.', 'Annotation', 'Section and CAT Part No. for Future Demand', 'Qty. No.', 'Remark')],
  blankRows: 3,
};
const CES_ACCESSORIES: TableTemplate = {
  widths: stars([14.9, 53.9, 41.9, 19.6, 15.2, 24.2]),
  head: [cells('Sr. No.', 'Description', 'Manufacturer’s Part No.', 'Annotation', 'Qty. No.', 'Remark')],
  blankRows: 3,
};
const CES_SPARES: TableTemplate = {
  widths: stars([15.1, 54.6, 42.5, 21.3, 13, 23.4]),
  head: [cells('Sr. No.', 'Description', 'Manufacturer’s Part No.', 'Annotation', 'Qty. No.', 'Remark')],
  blankRows: 3,
};
const CES_TOOLS: TableTemplate = {
  widths: stars([12.5, 74.9, 15.7, 34.3, 14.9, 17.6]),
  head: [cells('Sr. No.', 'Description', 'Annotation', 'Manufacturer’s Part No.', 'Qty. No.', 'Remark')],
  blankRows: 3,
};

/** List of SMTs and STEs: 11 columns on an 11-column grid; "Recommended numbers of Qty." spans four. */
export const SMT_TABLE: TableTemplate = {
  widths: stars([12.4, 20, 35, 42.5, 15, 15, 12.5, 12.5, 52.5, 22.5, 26.7]),
  caption: 'List of SMT and STE',
  head: [
    [
      { text: 'Sr. No.', rowspan: 2 }, { text: 'NSN', rowspan: 2 }, { text: 'Manufacturing Part No.', rowspan: 2 }, { text: 'Designation', rowspan: 2 },
      { text: 'Recommended numbers of Qty.', colspan: 4 }, { text: 'Brief Purpose', rowspan: 2 }, { text: 'Figure Number', rowspan: 2 }, { text: 'Remarks', rowspan: 2 },
    ],
    cells('FD Repair Point (22)', 'Trg Estt: EME Scl (1)', 'ABW (1)', 'Total Qty. Nos.'),
  ],
  blankRows: 3,
};

// ── The wording of the frame that differs between the stencils ────────────────────────────────────────────

const FOREWORD_TEXT_DEFENCE = 'Every care has been taken in the preparation of this document. The technical content has been authenticated. However, the reader is requested to communicate by E-mail/ Letter/ Telephone/ Fax to Larsen & Toubro, if any error is observed or there are any suggestions to improve this document.';
const FOREWORD_TEXT_LTD = FOREWORD_TEXT_DEFENCE.replace('to Larsen & Toubro,', 'to Larsen & Toubro Limited,');
const compact = (t: string): string => t.replace('E-mail/ Letter/ Telephone/ Fax', 'E-mail/Letter/Telephone/Fax');

const foreword = (text: string, email: string, postalAddress: string[]) => ({ text, email, postalAddress, telephone: ['022 - 6705 4950'], fax: ['022 - 6705 3234', '022 - 6705 5914'] });

const ADDRESS_DEFENCE = ['Head, Documentation & Training,', 'L&T Defence, Larsen & Toubro.', 'Defence Engineering Block, Gate No. 1,', 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'];
const ADDRESS_PES = ['Head, Documentation & Training,', 'L&T PES, Larsen & Toubro Limited.', 'PES Engineering Block, Gate No. 1,', 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'];
const ADDRESS_DS = ['Head, Documentation & Training,', 'L&T Precision Engineering and Systems,', '3rd Floor Q3, L&T Innovation Campus, Tower B, Gate No. 2,', 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'];
const ADDRESS_LIST = ['Head, Documentation & Training,', 'L&T Precision Engineering and Systems,', 'Defence Engineering Block,', '4th Floor - A Wing, L&T Gate No. 1,', 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'];
const ADDRESS_SMT = ['Head, Documentation & Training,', 'L&T Precision Engineering and Systems,', 'Larsen & Toubro Limited.', 'Defence Engineering Block, Gate No. 1', 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'];

/** The cover of every Naval stencil is published by "L&T Precision Engineering and Systems, LARSEN & TOUBRO LIMITED" (the Land house template says "L&T Defence,"). */
const NAVAL_PUBLISHER = { name: 'L&T Precision Engineering and Systems,', addressLines: ['LARSEN & TOUBRO LIMITED'] };

/** The handbooks' Associated Handbooks table heads ("Sr. No." / "INBR No."); the Land house template words them "Sl. No." / "Code No.". */
const HANDBOOK_LABELS = { handbooks: { colSr: 'Sr. No.', colInbr: 'INBR No.' }, safety: { footer: 'FOR FIRST AID IN CASE OF ELECTRIC SHOCK SEE OVERLEAF' } };

const LEGENDS_LIST = { note: 'Denote additional information.', warning: 'Denote possibility of danger to personnel due to improper use of equipment.', caution: 'Denote possibility of damage to equipment.' };

/** The list stencils open with a WARNING page of its own, in place of the handbooks' SAFETY WARNING. */
const LIST_WARNING = [
  { text: 'System to be SWITCH OFF before servicing the equipment.' },
  { text: 'In event of abnormal operation (unusual sounds, oil leakage, smoke etc.) immediately stop operation and take appropriate corrective measures.', spaceBefore: '4mm' },
  { text: 'Operating sequence given in the ‘User Handbook’ must be strictly followed.', spaceBefore: '4mm' },
  { text: 'Person standing near vehicle must maintain safe distance from the vehicle when it is in operation.', spaceBefore: '4mm' },
];

/** The list stencils' Demolition page: "DEMOLITION OF EQUIPMENT TO PREVENT ENEMY USE", methods named in capitals. */
const LIST_DEMOLITION = {
  parts: [
    { paras: ['The demolition procedure outlined below will be used to prevent the enemy from using or salvaging the equipment. DEMOLITION OF THE EQUIPMENT WILL BE HELD ONLY ON ORDER OF THE COMMANDING OFFICER.'] },
    {
      title: 'METHOD OF DESTRUCTION', paras: ['Use any or all the following methods to destroy the equipment.'], listType: 'roman',
      items: [
        'SMASH: Control panel thermostat, switches contenders, evaporator cell, condenser cell or other controls be smashed by use of sledges, handles, hammers and pickaxes if applicable.',
        'CUT: Cut the Cords, Headsets and Wiring: use axes, hand-axes or hatchets, if applicable.',
        'BURN: Burn the Cords, Resistors, Capacitors, Coils, Wiring, and Technical Manuals, use Gasoline, Kerosene, Oil, Flamethrowers or Incendiary, if applicable.',
        'BEND: Bend the panels, cabinet and chassis, if applicable.',
        'EXPLOSIVES: If explosives are necessary, use firearms, grenades or TNT, if applicable.',
        'DISPOSAL: Bury or scatter the destroyed parts in slits trenches, fox holes or other holes or throw them into streams, if applicable.',
      ],
    },
  ],
};

/** Front-matter pages in the order the list stencils print them (Amendments for Record of Changes; no Associated Handbooks, Change Notice, lists of figures). */
const listPages = (withTables: boolean) => [
  { id: 'titlePageJoint', enabled: true }, { id: 'titlePage', enabled: true }, { id: 'proprietary', enabled: true }, { id: 'foreword', enabled: true },
  { id: 'recordOfChanges', enabled: true, title: 'AMENDMENTS' },
  { id: 'associatedHandbooks', enabled: false },
  { id: 'safetyWarning', enabled: true }, { id: 'demolition', enabled: true, title: 'DEMOLITION OF EQUIPMENT TO PREVENT ENEMY USE' }, { id: 'firstAid', enabled: true },
  { id: 'cautionsNotes', enabled: false }, { id: 'changeNotice', enabled: false },
  { id: 'listOfAbbreviations', enabled: true, title: 'ABBREVIATIONS' },
  { id: 'systemNamePage', enabled: true },
  { id: 'descriptionOfSymbols', enabled: true },
  { id: 'listOfContents', enabled: true, title: 'CONTENTS' },
  { id: 'listOfFigures', enabled: false }, { id: 'listOfTables', enabled: withTables },
];

// ── Chapter outlines (headings of the stencils, in order) ─────────────────────────────────────────────────────────────
// The stencil spells "Safety Intsructions" in TM Part II; the skeleton uses the correct spelling (as for the Land types), the stencil itself is not edited.

const EE = 'Electrical/ Electronic Subsystems';

const UHB_CHAPTERS: OutlineNode[] = [
  { title: 'Leading Particulars and General Data', children: [
    { title: 'Purpose' }, { title: 'Features' },
    { title: 'System Specifications', children: [{ title: 'Dimensions and Weight' }, { title: 'Power Requirement and Consumption' }, { title: 'Environmental Specifications' }] },
  ] },
  { title: 'Brief Technical Description', children: [
    { title: 'System Tree Chart' },
    { title: 'System Composition', children: [{ title: 'Details of Subsystems' }] },
    { title: `Brief Description of ${EE}`, children: [{ title: 'System or sub-system are', example: true }] },
    { title: 'System Operation' },
  ] },
  { title: 'Unpacking and Removal of Preservatives', children: [
    { title: 'General Packing Details' },
    { title: 'Unpacking and Removal of Preservatives', children: [{ title: `Procedure to Unpack ${EE}` }] },
    { title: 'General Preservation Instructions', children: [{ title: `Preservation Procedure for ${EE}` }] },
  ] },
  { title: 'Preparation for Use and Installation Specification', children: [
    { title: 'Precaution and Safety Instructions' },
    { title: 'Installation Procedure', children: [{ title: `Installation Procedure for ${EE}` }, { title: 'Installation Procedure for Software' }, { title: 'Post Installation Check' }] },
    { title: 'List of Installation Drawings' },
  ] },
  { title: 'Operating Instructions', children: [
    { title: 'Precaution and Safety Measures' }, { title: 'Modes of Operation' }, { title: 'Pre-operation Checks/ Activities' }, { title: 'Operating Procedure' }, { title: 'Post Operation Checks/ Activities' },
  ] },
  { title: "User's Servicing and Maintenance Instructions", children: [
    { title: 'General', children: [{ title: 'Safety Instruction' }] },
    { title: `Maintenance Tasks for ${EE}`, children: [{ title: 'List of Maintenance Tasks' }] },
    { title: 'Likely Faults and Fault Drill/ Troubleshooting' },
  ] },
  { title: 'Miscellaneous', children: [
    { title: 'List of On-board Spares (OBS)' }, { title: 'List of Tools for User Maintenance' }, { title: 'Handling and Packing Instructions' }, { title: 'Stowage/ Storage Instructions' }, { title: 'Performance Reports' },
  ] },
];

const TM1_CHAPTERS: OutlineNode[] = [
  { title: 'Brief Technical Specifications' },
  { title: 'Brief Principles of Operation' },
  { title: 'Detailed Circuit Theory' },
];

const TM2_CHAPTERS: OutlineNode[] = [
  { title: 'Inspection and Maintenance Routine', children: [
    { title: `Routine Maintenance Tasks for ${EE}`, children: [{ title: 'Safety Instruction' }, { title: 'List of Maintenance Tasks' }] },
  ] },
  { title: 'Test Equipment', children: [{ title: 'List of Test Equipment' }] },
  { title: 'Fault Diagnosis', children: [{ title: 'Safety Instructions' }, { title: 'Fault Diagnosis/ Troubleshooting' }] },
  { title: 'Typical Test Readings' },
];

const TM3_CHAPTERS: OutlineNode[] = [
  { title: 'Dismantling and Re-assembly', children: [{ title: 'General Safety Instructions' }, { title: 'Procedure to dismantling and re-assembly' }] },
  { title: 'Test Specification and Alignment Procedure' },
  { title: 'Specifications of Special Components' },
  { title: 'Special Test Equipment/ Rigs/ Jigs' },
  { title: 'Special Protective Measures', children: [
    { title: 'Special protective measures to be observed during repair and overhaul' }, { title: 'Safety Instructions' }, { title: 'Hazards Related to Electric Current' },
  ] },
];

const DS_CHAPTERS: OutlineNode[] = [
  { title: 'General Information', children: [
    { title: 'Purpose' }, { title: 'Features' },
    { title: 'System Specifications', children: [{ title: 'Dimensions and Weight' }, { title: 'Power Requirement and Consumption' }, { title: 'Environmental Specifications' }] },
  ] },
  { title: 'System Configuration', children: [{ title: 'System Tree Chart' }, { title: 'System Composition', children: [{ title: 'Details of Subsystems' }] }] },
  { title: 'Detailed Technical Specification', children: [{ title: 'Brief Description of Mechanical and Electronic Subsystems' }] },
  { title: 'Conditions of Use' },
];

/** Vol 1: the chapters are the author's, one per system or sub-system (the stencil's placeholder is "System or Subsystem Name"); an assembly is a section with its parts table. */
const V1_CHAPTERS: OutlineNode[] = [
  { title: 'System or Subsystem Name', children: [{ title: 'Assembly Name', table: PARTS_TABLE }] },
];

/** Vol 2: one chapter per system or sub-system, sub-assemblies below it (the stencil's own example goes to heading level 3: "1.1.1 Data Acquisition Model"). */
const V2_CHAPTERS: OutlineNode[] = [{ title: 'System or Sub-system Name' }];

const MRLS_CHAPTERS: OutlineNode[] = [
  { title: "Manufacturer's Recommended List of Spares", children: [
    { title: 'Mechanical Section', table: MRLS_TABLE },
    { title: 'Hydraulic Section', table: MRLS_TABLE, example: true },
    { title: 'Electrical, Electronic and Navigation Section', table: MRLS_TABLE, example: true },
    { title: 'Winch Section', table: MRLS_TABLE, example: true },
    { title: 'Integrated Power Pack (IPP) Section', table: MRLS_TABLE, example: true },
  ] },
];

const CES_CHAPTERS: OutlineNode[] = [
  { title: 'Complete Equipment Schedule', children: [
    { title: 'Details of System', table: CES_SYSTEM, intro: 'Summary of items forming complete equipment including details of accessories, spares, tools and technical literature:' },
    { title: 'Accessories', table: CES_ACCESSORIES },
    { title: 'Carried Spares', table: CES_SPARES },
    { title: 'Carried Tools', table: CES_TOOLS },
  ] },
];

const SMT_CHAPTERS: OutlineNode[] = [{ title: 'List of SMTs and STEs', table: SMT_TABLE, figuresHeading: 'Figure / Diagram of Special Maintenance Tool (SMT) and Special Test Equipment (STE)' }];

// ── The ten types ────────────────────────────────────────────────────────────────────────────────────────

const handbook = (t: Pick<JssDocType, 'id' | 'label' | 'stencil' | 'chapters' | 'defaultBookName' | 'coverTitle'> & Partial<JssDocType>): JssDocType => ({
  domain: 'naval', bodyKind: 'chapter-manual', ready: true, maxDepth: 6, coverInbr: true, forewordDocumentNo: true, publisher: NAVAL_PUBLISHER,
  ...t,
  frontMatter: { foreword: foreword(FOREWORD_TEXT_DEFENCE, 'defence@larsentoubro.com', ADDRESS_DEFENCE), labels: HANDBOOK_LABELS, ...(t.frontMatter ?? {}) },
});

export const NAVAL_TYPES: JssDocType[] = [
  handbook({ id: 'naval-uhb', label: 'User Handbook', stencil: '1_User_Handbook.docx', chapters: UHB_CHAPTERS, defaultBookName: 'User Handbook', coverTitle: ['USER HANDBOOK'] }),
  handbook({
    id: 'naval-tm-1', label: 'Technical Manual - Part I Technical Description', stencil: 'TM_Part-I_Technical_Description.docx', chapters: TM1_CHAPTERS,
    defaultBookName: 'Technical Manual Part I Technical Description', coverTitle: ['TECHNICAL MANUAL', 'PART I TECHNICAL INFORMATION', 'TECHNICAL DESCRIPTION'], maxDepth: 6,
  }),
  handbook({ id: 'naval-tm-2', label: 'Technical Manual - Part II Maintenance', stencil: 'TM_Part-II_Maintenance.docx', chapters: TM2_CHAPTERS, defaultBookName: 'Technical Manual Part II Maintenance', coverTitle: ['TECHNICAL MANUAL', 'PART II MAINTENANCE'] }),
  handbook({
    id: 'naval-tm-3', label: 'Technical Manual - Part III Overhaul', stencil: 'TM_Part-III_Overhaul.docx', chapters: TM3_CHAPTERS,
    defaultBookName: 'Technical Manual Part III Overhaul', coverTitle: ['TECHNICAL MANUAL', 'PART – III', 'OVERHAULING AND RECONDITIONING INSTRUCTIONS'],
  }),
  {
    id: 'naval-tm-4-1', domain: 'naval', label: 'Technical Manual - Part IV Vol 1 Parts List', stencil: 'TM_Part-IV_Vol1_Part_List.docx', bodyKind: 'parts-list', ready: true,
    chapters: V1_CHAPTERS, chapterRule: 'free', maxDepth: 2, publisher: NAVAL_PUBLISHER, chapterDivider: false, defaultBookName: 'Technical Manual Part IV Volume 1 Parts List',
    coverTitle: ['TECHNICAL MANUAL', 'PART IV MANUFACTURER’S PARTS LIST', 'VOLUME 1 PARTS LIST'], coverInbr: false, forewordDocumentNo: true,
    bodyPage: 'landscape', tableTemplate: PARTS_TABLE, captionTables: false, omitPages: ['listOfFigures', 'listOfTables'],
    frontMatter: { foreword: foreword(FOREWORD_TEXT_LTD, 'PESDT@larsentoubro.com', ADDRESS_PES), labels: HANDBOOK_LABELS },
  },
  {
    id: 'naval-tm-4-2', domain: 'naval', label: 'Technical Manual - Part IV Vol 2 Illustrations', stencil: 'TM_Part-IV_Vol2_Illustrations.docx', bodyKind: 'illustrations', ready: true,
    chapters: V2_CHAPTERS, chapterRule: 'free', maxDepth: 3, publisher: NAVAL_PUBLISHER, chapterDivider: false, defaultBookName: 'Technical Manual Part IV Volume 2 Illustrations',
    coverTitle: ['TECHNICAL MANUAL', 'PART – IV MANUFACTURER’S PARTS LIST', 'VOLUME 2 OF 2 ILLUSTRATIONS'], coverInbr: true, forewordDocumentNo: true,
    bodyPage: 'landscape', omitPages: ['listOfAbbreviations', 'listOfTables'],
    frontMatter: { foreword: foreword(compact(FOREWORD_TEXT_DEFENCE), 'defence@larsentoubro.com', ADDRESS_DEFENCE), labels: HANDBOOK_LABELS },
  },
  handbook({
    id: 'naval-ds', label: 'Design Specification', stencil: 'Design_Specification.docx', chapters: DS_CHAPTERS, defaultBookName: 'Design Specification', coverTitle: ['DESIGN SPECIFICATION'], coverInbr: false,
    frontMatter: { foreword: foreword(FOREWORD_TEXT_LTD, 'PESDT@larsentoubro.com', ADDRESS_DS), labels: HANDBOOK_LABELS },
  }),
  listType({
    id: 'naval-mrls', label: 'MRLS', stencil: 'MRLS.docx', chapters: MRLS_CHAPTERS, defaultBookName: 'Manufacturer’s Recommended List of Spares (MRLS)',
    coverTitle: ['MANUFACTURER’S RECOMMENDED LIST OF SPARES (MRLS)'], bodyPage: 'a3-landscape', tableTemplate: MRLS_TABLE, withTables: false,
  }),
  listType({
    id: 'naval-ces', label: 'Complete Equipment Schedule', stencil: 'Complete_Equipment_Schedule.docx', chapters: CES_CHAPTERS, defaultBookName: 'Complete Equipment Schedule (CES)',
    coverTitle: ['COMPLETE EQUIPMENT SCHEDULE (CES)'], sectionsFixed: true, withTables: false,
  }),
  listType({
    id: 'naval-smt-ste', label: 'List of SMT / STE', stencil: 'List_of_SMT_STE.docx', chapters: SMT_CHAPTERS, defaultBookName: 'List of Special Maintenance Tools (SMTs) and Special Test Equipment (STEs)',
    coverTitle: ['LIST OF SPECIAL MAINTENANCE TOOLS (SMTS)', 'AND', 'SPECIAL TEST EQUIPMENT (STES)'], bodyPage: 'landscape', tableTemplate: SMT_TABLE, withTables: true, captionTables: true,
    address: ADDRESS_SMT, documentNoLabel: 'Document No.',
  }),
];

/** A list stencil: Code No. on the cover (no INBR No.), Amendments, the WARNING page, "DEMOLITION OF EQUIPMENT", Abbreviations, Symbols with "Denote ...", then Contents. */
function listType(t: Pick<JssDocType, 'id' | 'label' | 'stencil' | 'chapters' | 'defaultBookName' | 'coverTitle'> & Partial<JssDocType> & { withTables: boolean; address?: string[]; documentNoLabel?: string }): JssDocType {
  const { withTables, address, documentNoLabel, ...rest } = t;
  return {
    domain: 'naval', bodyKind: 'single-table', ready: true, maxDepth: 2, coverInbr: false, forewordDocumentNo: !!documentNoLabel, captionTables: false, publisher: NAVAL_PUBLISHER, listFrame: true, chapterDivider: false,
    ...rest,
    frontMatter: {
      titlePage: { disclosureNotice: 'THE INFORMATION GIVEN IN THIS DOCUMENT IS NOT TO BE PUBLISHED OR COMMUNICATED, EITHER DIRECTLY OR INDIRECTLY TO THE PRESS OR TO ANY PERSON NOT AUTHORISED TO RECEIVE IT.' },
      foreword: foreword(FOREWORD_TEXT_LTD.replace('E-mail/ Letter/ Telephone/ Fax', 'E-mail/Letter/Telephone/Fax'), 'PESDT@larsentoubro.com', address ?? ADDRESS_LIST),
      noticeLegends: LEGENDS_LIST,
      safetyWarning: LIST_WARNING,
      labels: { safety: { heading: 'WARNING', footer: '' }, ...(documentNoLabel ? { foreword: { documentNo: documentNoLabel } } : {}) },
      demolition: LIST_DEMOLITION,
      pages: listPages(withTables),
    },
  };
}
