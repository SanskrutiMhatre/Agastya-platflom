// The JSS document types: one entry per stencil in `manual format/JSS0251-stencils`, with the structure the stencil fixes.
// See docs/JSS_STENCIL_ANALYSIS.md for how each entry was read from the stencil's Word XML.
//
// A type is `ready` only when the whole path exists for it (schema, editor, XML, PDF). The others are listed so the catalogue is the
// whole stencil inventory, and are refused with the reason rather than offered half-built.
//
// The shared frame (title pages, notices, record of changes, contents ... symbols) is NOT part of a type: it is identical for all
// of them and comes from the project's Settings, so it cannot drift between types. What the type decides about the frame is only
// the wording of the cover title.

import { NAVAL_TYPES } from './registry-naval';

export type BodyKind = 'chapter-manual' | 'parts-list' | 'illustrations' | 'single-table';
/** The two domains of the JSS stencils: JSS-0251 (Land) and the Naval set. A type's id is unique across both because a project stores it. */
export type JssDomain = 'land' | 'naval';
export type PageOrientation = 'landscape' | 'a3-landscape';

/** One cell of a stencil table's head. A merged head (rowspan / colspan) is written as the stencil merges it. */
export interface HeadCell {
  text: string; colspan?: number; rowspan?: number;
  /** The stencil's wording is a prompt the project adapts ("Recommended Nos. for 52 Systems for Two Years"): the cell must be there, its words are not compared. */
  open?: boolean;
}

/**
 * A table the stencil fixes: its columns (widths as proportions, so it fits whatever page the pipeline lays it on), its head and how many blank rows a new one starts with.
 * The author fills the rows; the head is the stencil's and the document is checked against it (JSS-TABLE-TEMPLATE).
 */
export interface TableTemplate { widths: string; head: HeadCell[][]; blankRows: number; /** Caption the stencil gives this table ("Table 1: ..."), when it has one. */ caption?: string }

/** Where a type's contents come from: a Word stencil of JSS 0251, or (for a type the stencil set does not contain) the nearest stencil's body on the shared frame. */
export type TypeSource = 'stencil' | 'derived';

/** What a new document has under a heading before the author writes anything: the stencil's own tables (heads only, a few empty rows) and its fixed sentences. */
export type StartBlock = { para: string } | { table: { title: string; columns: string[]; widths?: string; rows?: number } };

export interface OutlineNode {
  title: string;
  children?: OutlineNode[];
  /** The stencil's starting content under this heading (tables with their heads, fixed sentences). */
  start?: StartBlock[];
  /** A section the stencil sets on a landscape page (parts lists, the rotable list, drawings). */
  orientation?: 'landscape';
  /** A heading the stencil shows as an example to be renamed or repeated ("Assembly-1", "Unit-1"): left out of the starting skeleton. */
  example?: boolean;
  /** The table the stencil puts under this heading (a parts list, a list of spares ...). Written into the starting skeleton and checked on validation. */
  table?: TableTemplate;
  /** A sentence the stencil prints before that table, written into the starting skeleton. */
  intro?: string;
  /** A page break and a bold centred line that introduces a sheet of figures after the table (List of SMT / STE: "Figure / Diagram of ..."), written into the starting skeleton. */
  figuresHeading?: string;
}

export interface JssDocType {
  id: string;
  /** Which stencil set this type belongs to (the wizard's Domain). */
  domain: JssDomain;
  /** The name the stencil's cover gives the publication. */
  label: string;
  /** The stencil file this type was read from. */
  stencil: string;
  /** `derived`: the stencil set has no file for this document; its body is built on the shared frame and the nearest stencil's tables (see `derivedFrom`). */
  source?: TypeSource;
  derivedFrom?: string;
  bodyKind: BodyKind;
  ready: boolean;
  /** Why it is not ready (shown to the person, never hidden). */
  notReady?: string;
  /** The chapters the stencil fixes, in order. A document of this type has exactly these chapters, in this order (unless chapterRule is 'free'). */
  chapters?: OutlineNode[];
  /**
   * 'fixed' (the default): the stencil names every chapter and a document has exactly those. 'free': the chapters are the author's, one per system or sub-system (Part IV volumes);
   * the outline then only supplies the first chapter to start from.
   */
  chapterRule?: 'fixed' | 'free';
  /** True when the stencil also fixes the sections under each chapter (Complete Equipment Schedule): they must be present, in this order. */
  sectionsFixed?: boolean;
  /** The page the stencil sets the body on when it is not the portrait A4 of the chapter manuals: written on each chapter as its orientation. */
  bodyPage?: PageOrientation;
  /** The table every table of the document follows (parts list, MRLS, SMT / STE): the pipeline checks the number of columns and the head. */
  tableTemplate?: TableTemplate;
  /** False when the stencil does not caption its tables (a missing caption is then not reported). Default true. */
  captionTables?: boolean;
  /**
   * The list stencils (MRLS, Complete Equipment Schedule, List of SMT / STE) have an Amendments table of five columns, a numbered list of abbreviations ("Sr. No. | Abbreviations issued | For")
   * and no "first aid" line under the safety warning: the build sets roc.layout, abbrev.layout and safety.footer.show.
   */
  listFrame?: boolean;
  /** False when the stencil has no chapter divider page: its first chapter opens with the heading and goes straight on to the sections (the list stencils, Part IV Vol 1 and 2). Default true. */
  chapterDivider?: boolean;
  /** The publisher block of the stencil's cover ("Prepared & Published by"). A new project starts with it (Settings > Branding can change it); the Land stencils use the house template's. */
  publisher?: { name: string; addressLines: string[] };
  /** Whether the Foreword has the "L&T Document No." line. Read from the stencils: the Land ones do not, the Naval handbooks do. Default false. */
  forewordDocumentNo?: boolean;
  /** Front-matter pages (ids of the catalogue in vendor/engine/frontMatterPages) this stencil does not have. */
  omitPages?: string[];
  /** The deepest heading level the stencil defines (Heading 1 = chapter). */
  maxDepth: number;
  /** The title of the book as the stencil's cover words it, used when the author has not given one. */
  defaultBookName: string;
  /** The cover's title lines exactly as the stencil prints them. */
  coverTitle: string[];
  /** Whether the stencil's cover has an "INBR No." line. Read from the stencils: only UHB2's does; the others have Code No. and Rev No. only. */
  coverInbr: boolean;
  /**
   * Front-matter wording and pages that differ from the shared defaults in this stencil, laid over the project's Settings (a key the project sets itself wins).
   * Objects are merged into the Settings' own; a list (the safety warning's lines, the page order) replaces it.
   */
  frontMatter?: Record<string, unknown>;
}

// ── Body kind A: chapter manuals ──────────────────────────────────────────────────────────────────────────────────────────────────
// Titles are the stencil's. Four stencil spelling slips are corrected in the skeleton ("Maintenace", "Miscellanoeous", "general",
// "handling and Packing"); the stencil itself is not edited.

const SUBSYSTEM_FAMILIES = ['Mechanical', 'Electrical/Electronic', 'Hydraulic', 'Pneumatic'];
const perFamily = (fmt: (f: string) => string, kids?: OutlineNode[]): OutlineNode[] => SUBSYSTEM_FAMILIES.map((f) => ({ title: fmt(f), children: kids }));

const UHB_CHAPTERS: OutlineNode[] = [
  { title: 'Leading Particulars and General Data', children: [
    { title: 'Purpose' }, { title: 'Features' },
    { title: 'System Specifications', children: [{ title: 'Technical Specifications' }, { title: 'Environmental Specifications' }] },
  ] },
  { title: 'Brief Technical Description', children: [
    { title: 'System Tree Chart' },
    { title: 'System Composition', children: [{ title: 'Details of Sub-Systems' }, { title: 'Location of Sub-Systems' }] },
    { title: 'Brief Description of Mechanical Sub-Systems', children: [{ title: 'Assembly-1', example: true }] },
    { title: 'Brief Description of Electrical/Electronic Sub-Systems', children: [{ title: 'Unit-1', example: true }] },
    { title: 'Brief Description of Hydraulic Sub-Systems', children: [{ title: 'Unit-1', example: true }] },
    { title: 'Brief Description of Pneumatic Sub-Systems', children: [{ title: 'Unit-1', example: true }] },
    { title: 'Brief Description of Miscellaneous Units', children: [{ title: 'Unit-1', example: true }] },
    { title: 'System Operation' },
  ] },
  { title: 'Unpacking and Removal of Preservatives', children: [
    { title: 'Packing Details' },
    { title: 'Unpacking and Removal of Preservatives', children: perFamily((f) => `Procedure to Unpack ${f.replace('/', ' / ')} Sub-Systems`) },
    { title: 'Preservation Instructions', children: perFamily((f) => `Preservation Procedure for ${f.replace('/', ' / ')} Sub-Systems`) },
  ] },
  { title: 'Preparation for Use and Installation Specification', children: [
    { title: 'Precaution and Safety Instructions' },
    { title: 'Installation Procedure', children: [
      { title: 'Installation Sequence' },
      ...perFamily((f) => `Installation Procedure for ${f} Sub-Systems`),
    ] },
    { title: 'List of Installation Drawings' },
    { title: 'Functional Testing' },
  ] },
  { title: 'Operating Instructions', children: [
    { title: 'Precaution and Safety Measures', children: [{ title: 'General Safety Instructions' }, { title: 'Safety Features in System' }] },
    { title: 'Modes of Operation' }, { title: 'Pre-Operation Checks / Activities' }, { title: 'Operating Procedure' },
    { title: 'Post-Operation Checks / Activities' }, { title: 'Miscellaneous Procedures' },
  ] },
  { title: "User's Servicing and Maintenance Instructions", children: [
    { title: 'General' },
    ...perFamily((f) => `Maintenance Tasks for ${f} Sub-Systems`, [{ title: 'List of Maintenance Tasks' }, { title: 'Maintenance Procedures' }]),
    { title: 'Likely Faults and Fault Drill' },
  ] },
  { title: 'Miscellaneous', children: [
    { title: 'List of On-Board and Installation Spares' }, { title: 'List of Tools for User Maintenance' },
    { title: 'Handling and Packing Instructions' }, { title: 'Stowage / Storage Instructions' }, { title: 'Performance Reports' },
  ] },
];

const MM_CHAPTERS: OutlineNode[] = [
  { title: 'Inspection and Maintenance Routine', children: [
    { title: 'Importance of Routine Maintenance' },
    ...perFamily((f) => `${f === 'Mechanical' ? 'Routine Maintenance' : 'Maintenance Tasks'} for ${f} Sub-Systems`),
  ] },
  { title: 'Test Equipment', children: perFamily((f) => `Test Equipment for ${f} Sub-Systems`, [{ title: 'List of Test Equipment' }, { title: 'Procedure to Use Test Equipment' }]) },
  { title: 'Fault Diagnosis', children: perFamily((f) => `Fault Diagnosis For ${f} Sub-Systems`, [{ title: 'Safety Instructions' }, { title: 'Fault Diagnosis' }]) },
  { title: 'Typical Test Readings', children: perFamily((f) => `Test Procedure For ${f} Sub-Systems`) },
];

const ORM_CHAPTERS: OutlineNode[] = [
  { title: 'Dismantling and Re-assembly', children: perFamily((f) => `Dismantling and Re-assembly of ${f} Sub-Systems`, [{ title: 'General / Safety Instructions' }]) },
  { title: 'Test Specification and Alignment Procedure' },
  { title: 'Specifications of Special Components' },
  { title: 'Special Test Equipment/Rigs/Jigs' },
  { title: 'Special Protective Measures' },
];


// ── The types the stencils define beyond UHB, MM and ORM ───────────────────────────────────────────────────────────────────────────
// Every outline below is read from the stencil's Word file (headings by style, tables by their head row and caption; docs/JSS_STENCIL_ANALYSIS.md). The headings the stencil shows as
// examples to be renamed or repeated ("Assembly-1", "Unit-1") are left out unless the type is useless without one (a parts list needs an assembly to hold its table).

const tbl = (title: string, columns: string[], rows = 3, widths?: string): StartBlock => ({ table: { title, columns, rows, ...(widths ? { widths } : {}) } });
const SPEC_COLS = ['Sl. No.', 'Attribute', 'Specification'];
const PARAM_COLS = ['Sl. No.', 'Parameter', 'Value'];
const spec = (title: string, rows = 4): StartBlock => tbl(title, SPEC_COLS, rows, '10* 45* 45*');
const param = (title: string, rows = 4): StartBlock => tbl(title, PARAM_COLS, rows, '10* 40* 50*');
/** The ten columns of the parts table that Vol 1 and the ISPLs share (stencil Vol_1_PL, ISPL). */
const PARTS_COLS = ['Sl. No.', 'Description', "Manufacturer's Part No.", 'Cct Ref.', 'Fig. - Item', 'No. Off', 'Para Ref.', "'P'", 'DS Cat No.', 'Remarks'];
const partsTable = (title: string): StartBlock => tbl(title, PARTS_COLS, 3, '6* 22* 18* 8* 12* 7* 9* 4* 11* 10*');
const sec = (title: string, start?: StartBlock[], children?: OutlineNode[], orientation?: 'landscape'): OutlineNode => ({ title, ...(start ? { start } : {}), ...(children ? { children } : {}), ...(orientation ? { orientation } : {}) });
const fam = (fmt: (f: string) => string, kids?: OutlineNode[], start?: StartBlock[]): OutlineNode[] => SUBSYSTEM_FAMILIES.map((f) => ({ title: fmt(f), ...(kids ? { children: kids } : {}), ...(start ? { start } : {}) }));

// TM Part I - Technical Information (TM_PI.docx): 4 chapters, headings to level 5
const TM_PI_CHAPTERS: OutlineNode[] = [
  { title: 'Brief Technical Specifications', children: [
    sec('Purpose'), sec('Features'),
    sec('System Specifications', undefined, [sec('Technical Specifications', [spec('Technical Specifications', 6)]), sec('Environmental Specifications', [spec('Environmental Specifications')])]),
  ] },
  { title: 'Brief Principles of Operation', children: [
    sec('System Tree Chart'),
    sec('System Composition', undefined, [
      sec('Details of Sub-Systems', [tbl('System Composition', ['Sl. No.', 'Name of Unit / Assembly', 'Quantity', 'Illustration', 'Designation'], 4, '8* 28* 12* 22* 30*')]),
      sec('Location of Sub-Systems'),
    ]),
    sec('System Operation'),
  ] },
  { title: 'Detailed Circuit Theory', children: [
    { title: 'Brief Description of Mechanical Sub-Systems', children: [{ title: 'Assembly-1', example: true }] },
    { title: 'Brief Description of Electrical/Electronic Sub-Systems', children: [{ title: 'Unit-1', example: true }] },
    { title: 'Brief Description of Hydraulic Sub-Systems', children: [{ title: 'Unit-1', example: true }] },
    { title: 'Brief Description of Pneumatic Sub-Systems', children: [{ title: 'Unit-1', example: true }] },
    { title: 'Brief Description of Miscellaneous Units', children: [{ title: 'Unit-1', example: true }] },
  ] },
  { title: 'Drawings / Documents', children: SUBSYSTEM_FAMILIES.map((f) => sec(`${f.replace('/', ' / ')} Sub-Systems`, [tbl(`${f.replace('/', ' / ')} Sub-Systems Drawings and Documents`, ['Sl. No.', 'Description', 'Drawing / Document No.', 'No. of Sheets / Pages', 'Revision'], 3, '6* 30* 30* 18* 16*')])) },
];

// Design Specification (DS.docx): 4 chapters
const DS_CHAPTERS: OutlineNode[] = [
  { title: 'General Information', children: [sec('Role'), sec('Brief Description'), sec('Overall Performance Specifications', [spec('Specifications of System', 6)])] },
  { title: 'Detailed Technical Specifications', children: [
    sec('Related Documents', [tbl('List of Related Documents', ['Sl. No.', 'Document / Drawing Name', 'Code No.'], 4, '10* 45* 45*')]),
    sec('Associated Items', undefined, [
      sec('System', [tbl('System Marking', ['Sl. No.', 'Service Designation', 'Service Catalogue No.', 'Serial No.', "Manufacturer's Code / Initials", 'Year of Manufacture', 'Service Arrow'], 2, '6* 20* 18* 14* 20* 12* 10*')]),
      sec('Subsystems', [tbl('Subsystems Marking', ['Sl. No.', 'Subsystem / Unit Designation', 'DS Cat No. / Service Store Reference No.', 'Source', 'Date of Manufacture', 'Joint Service Code (if applicable)'], 3, '8* 22* 24* 16* 16* 14*')]),
      sec('Circuit References'),
    ]),
    sec('Specification for Subsystems', undefined, [{ title: 'Assembly', example: true }]),
  ] },
  { title: 'Conditions of Use', children: [
    sec('Climatic and Durability Requirements and Category', undefined, [sec('Test Conditions', [param('Climatic Conditions According to Test Conditions', 5)])]),
    sec('Transportation Requirements'), sec('Associated Equipment'),
  ] },
  { title: 'Description of Tests', children: [
    sec('Technical Evaluation'),
    sec('Acceptance Tests', undefined, [sec('Pre-production Tests'), sec('Acceptance Inspection Tests')]),
    sec('Performance Check'),
  ] },
];

// Table of Tools and Equipment and Carried Spares (TOTE_and_CS.docx): one chapter
const TOTE_CHAPTERS: OutlineNode[] = [
  { title: 'Table of Tools & Equipment and Carried Spares', children: [
    sec('List of Tools', [tbl('List of Tools', ['Sl. No.', 'Tools', 'Qty', 'UOM'], 4, '10* 66* 10* 14*')]),
    sec('Spares and Spare Box', undefined, [sec('Spares for Assembly', [tbl('Spares for Assembly', ['Sl. No.', 'Spares', 'Qty', 'UOM'], 4, '10* 66* 10* 14*')])]),
  ] },
];

// Permissive Repair Schedule (PRS.docx): one chapter, one 6-column table
const PRS_CHAPTERS: OutlineNode[] = [
  { title: 'Permissive Repair Schedule', children: [
    sec('Importance of Permissive Repair'),
    sec('Permissive Repair Schedule', [tbl('Permissive Repair Schedule', ['Sl. No.', 'Subsystem / Unit', 'Light Repair', 'Field Repair', 'Base Repair', 'Remarks'], 5, '9* 24* 16* 16* 15* 20*')]),
  ] },
];

// Manufacturer's Recommended List of Spares (MRLS.docx): one chapter holding one table
const MRLS_CHAPTERS: OutlineNode[] = [
  { title: "Manufacturer's Recommended List of Spares (MRLS)", start: [tbl("Manufacturer's Recommended List of Spares", ['Ser.', 'Part No.', 'Item / Equipment Description', 'Qty', 'UoM', 'ISPL Ref. (Figure No., Item No.)'], 5, '8* 20* 30* 8* 8* 26*')] },
];

// Rotable List (ROTABLE.docx): one chapter, one table, landscape
const ROTABLE_CHAPTERS: OutlineNode[] = [
  { title: 'Rotable List (O & I Level)', children: [
    sec('Rotable List', [tbl('Rotable List (O & I Level)', ['Item No.', 'Designation', 'Section & Cat / Part No. for Future Demand', 'Qty. (No.)', 'Mandatory & Non-Mandatory Spares', 'Norms of Consumption', 'Remarks'], 5, '6* 14* 16* 7* 30* 14* 13*')], undefined, 'landscape'),
  ] },
];

// Technical Manual Part IV Volume 1 (Vol_1_PL.docx): the chapters are the subsystem families, each holds one parts table per assembly (landscape)
const FAMILY_TITLES = ['Mechanical Sub-Systems', 'Electrical / Electronic Sub-Systems', 'Hydraulic Sub-Systems', 'Pneumatic Sub-Systems'];
const VOL1_CHAPTERS: OutlineNode[] = FAMILY_TITLES.map((t, i) => ({ title: t, children: [sec(`Assembly-${i + 1}`, [partsTable(`Parts List of Assembly-${i + 1}`)], undefined, 'landscape')] }));

// Technical Manual Part IV Volume 2 (Vol_2_Illustrations.docx): the same chapters; each assembly holds its figure (the author adds the picture)
const VOL2_CHAPTERS: OutlineNode[] = FAMILY_TITLES.map((t, i) => ({ title: t, children: [sec(`Assembly-${i + 1}`, undefined, undefined, 'landscape')] }));

// Illustrative Spares Part List (ISPL.docx, ISPL_wrt_JSS.docx): subsystem families with an assembly's figure(s) and parts table
const ISPL_CHAPTERS: OutlineNode[] = [
  { title: 'Mechanical Subsystems', children: [sec('Assembly-1', [partsTable('Parts List of Assembly-1')], undefined, 'landscape')] },
  { title: 'Electronics and Electrical Subsystems', children: [sec('Assembly-2', [partsTable('Parts List of Assembly-2')], undefined, 'landscape')] },
  { title: 'Miscellaneous Items', children: [sec('Assembly-3', [partsTable('Parts List of Assembly-3')], undefined, 'landscape')] },
];

// Technical Manual Part I Volume 2 - Drawings: the stencil set has no file for it. Its body is chapter 4 of TM_PI ("Drawings / Documents": one list of drawings and documents per
// subsystem family) with the landscape drawing pages of Vol_2_Illustrations: per family, the list, then a landscape section to hold each drawing.
const TM_PI_VOL2_CHAPTERS: OutlineNode[] = FAMILY_TITLES.map((t, i) => ({ title: t, children: [
  sec('List of Drawings', [tbl(`List of ${t} Drawings`, ['Sl. No.', 'Description', 'Drawing / Document No.', 'No. of Sheets / Pages', 'Revision'], 3, '6* 30* 30* 18* 16*')]),
  sec(`Drawing-${i + 1}`, undefined, undefined, 'landscape'),
] }));

// User Handbook, variant 2 (UHB2.docx): the seven chapters of the UHB, with the chapter 1 sections of this variant
const UHB2_CHAPTERS: OutlineNode[] = [
  { title: 'Leading Particulars and General Data', children: [
    sec('Purpose'), sec('Features'),
    sec('System Specifications', undefined, [sec('Dimensions and Weight', [tbl('Dimensions and Weight', SPEC_COLS, 4, '10* 45* 45*')]), sec('Electrical Specifications', [tbl('Electrical Specifications', SPEC_COLS, 4, '10* 45* 45*')]), sec('Environmental Specifications', [tbl('Environmental Specifications', SPEC_COLS, 4, '10* 45* 45*')])]),
    sec('Ship Services', [tbl('Ship Services', SPEC_COLS, 4, '10* 45* 45*')]),
  ] },
  { title: 'Brief Technical Description', children: [
    sec('System Tree Chart'),
    sec('System Composition', undefined, [sec('Details of Sub-Systems'), sec('Location of Sub-Systems')]),
    { title: 'Brief Description of Mechanical Sub-Systems', children: [{ title: 'Assembly-1', example: true }] },
    { title: 'Brief Description of Electrical/Electronic Sub-Systems', children: [{ title: 'Unit-1', example: true }] },
    { title: 'Brief Description of Hydraulic Sub-Systems', children: [{ title: 'Assembly-1', example: true }] },
    { title: 'Brief Description of Pneumatic Sub-Systems', children: [{ title: 'Assembly-1', example: true }] },
    { title: 'Brief Description of Miscellaneous Sub-Systems', children: [{ title: 'Assembly-1', example: true }] },
    sec('System Operation'),
  ] },
  { title: 'Unpacking and Removal of Preservatives', children: [
    sec('General Packing Details'),
    sec('Unpacking and Removal of Preservatives', undefined, perFamily((f) => `Procedure to Unpack ${f.replace('/', ' / ')} Sub-Systems`)),
    sec('General Preservation Instructions', undefined, perFamily((f) => `Preservation Procedure for ${f.replace('/', ' / ')} Sub-Systems`)),
  ] },
  { title: 'Preparation for Use and Installation Specification', children: [
    sec('Precaution and Safety Instructions'),
    sec('Installation Procedure', undefined, [sec('Installation Sequence'), ...perFamily((f) => `Installation Procedure for ${f.replace('/', ' / ')} Sub-Systems`), sec('Post Installation Check')]),
    sec('List of Installation Drawings'), sec('Functional Testing'),
  ] },
  { title: 'Operating Instructions', children: [
    sec('Precaution and Safety Measures', undefined, [sec('General Safety Instructions')]),
    sec('Modes of Operation'), sec('Pre-Operation Checks / Activities'), sec('Operating Procedure'), sec('Post Operation Checks / Activities'),
  ] },
  { title: "User's Servicing and Maintenance Instructions", children: [
    sec('General', undefined, [sec('Safety Instruction')]),
    ...perFamily((f) => `Maintenance Tasks for ${f.replace('/', ' / ')} Sub-Systems`),
    sec('Likely Faults and Fault Drill / Troubleshooting'),
  ] },
  { title: 'Miscellaneous', children: [
    sec('List of On-Board Spares (OBS)'), sec('List of Tools for User Maintenance'), sec('Handling and Packing Instructions'), sec('Stowage / Storage Instructions'), sec('Performance Reports'),
  ] },
];

// The three schedules the stencil set does not contain a file for (Complete Equipment Schedule, Field Inspection Standard, Base Inspection Standard). They are built on the shared
// frame and on the body of the nearest stencils (PRS and TOTE_and_CS: one chapter of fixed headings holding captioned tables), so they print, validate and export like the rest.
// When the owner supplies their stencils the outlines below are replaced by the stencil's own headings.
const CES_CHAPTERS: OutlineNode[] = [
  { title: 'Complete Equipment Schedule', children: [
    sec('General'),
    sec('Schedule of Equipment', undefined, [
      sec('Main Equipment', [tbl('Main Equipment', ['Sl. No.', 'Nomenclature', 'Part No. / Cat No.', 'Qty', 'UOM', 'Remarks'], 4, '8* 30* 22* 8* 8* 24*')]),
      sec('Accessories and Attachments', [tbl('Accessories and Attachments', ['Sl. No.', 'Nomenclature', 'Part No. / Cat No.', 'Qty', 'UOM', 'Remarks'], 4, '8* 30* 22* 8* 8* 24*')]),
      sec('Tools and Test Equipment', [tbl('Tools and Test Equipment', ['Sl. No.', 'Nomenclature', 'Part No. / Cat No.', 'Qty', 'UOM', 'Remarks'], 4, '8* 30* 22* 8* 8* 24*')]),
      sec('Spares and Consumables', [tbl('Spares and Consumables', ['Sl. No.', 'Nomenclature', 'Part No. / Cat No.', 'Qty', 'UOM', 'Remarks'], 4, '8* 30* 22* 8* 8* 24*')]),
      sec('Publications and Documents', [tbl('Publications and Documents', ['Sl. No.', 'Title', 'Code No.', 'Qty', 'Remarks'], 3, '8* 42* 24* 8* 18*')]),
    ]),
  ] },
];
const inspection = (level: 'Field' | 'Base'): OutlineNode[] => [
  { title: 'Introduction', children: [sec('Scope'), sec('Applicability'), sec(`${level} Inspection Levels`), sec('Safety Precautions')] },
  { title: `${level} Inspection Standards`, children: [
    sec('Inspection Procedure'),
    sec('Inspection Schedule', [tbl(`${level} Inspection Schedule`, ['Sl. No.', 'Subsystem / Unit', 'Inspection Check', 'Standard', 'Limits / Tolerance', 'Remarks'], 5, '8* 20* 26* 16* 16* 14*')]),
    sec('Special Tools and Test Equipment', [tbl('Special Tools and Test Equipment', ['Sl. No.', 'Nomenclature', 'Part No. / Cat No.', 'Qty', 'Remarks'], 3, '8* 40* 24* 8* 20*')]),
  ] },
  { title: 'Acceptance and Rejection Criteria', children: [sec('Acceptance Criteria'), sec('Rejection Criteria'), sec('Records and Reports')] },
];


// Front-matter wording per stencil (read from each Word file): the Foreword's postal address and the legends under the notice symbols.
const addr = (house: string, and: boolean): string[] => [`Head, Documentation ${and ? 'and' : '&'} Training,`, `L&T Defence, Larsen ${and ? 'and' : '&'} Toubro.`, `${house}, Gate No. 1,`, 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'];
const LEGENDS_DENOTE = { note: 'Denote additional information.', warning: 'Denote possibility of danger to personnel due to improper use of equipment.', caution: 'Denote possibility of damage to equipment.' };
const FRONT_MM = { foreword: { postalAddress: addr('Defence Engineering Block', false) }, noticeLegends: LEGENDS_DENOTE };
const FRONT_UHB2 = { foreword: { postalAddress: addr('Defence Engineering Block', false) } };
const FRONT_TOTE = { foreword: { postalAddress: addr('Defence Engineering Building', true) }, noticeLegends: LEGENDS_DENOTE };
const FRONT_AND_G = { foreword: { postalAddress: addr('G Building', true) }, noticeLegends: LEGENDS_DENOTE };
const UHB_LIKE: string[] = ['cautionsNotes'];                     // the front pages these stencils leave out (the same list the build uses: JssDocType.omitPages)
const TM_LIKE: string[] = ['systemNamePage'];
const std = { bodyKind: 'chapter-manual' as BodyKind, ready: true, coverInbr: false };

const derivedDrawings = 'The stencil set has no file for the drawings volume: built on the shared frame, the drawings list of TM_PI (chapter 4) and the landscape pages of Vol_2_Illustrations. Replace the outline when the stencil is supplied.';
const derived = 'Built on the shared frame and the body of the nearest stencils (PRS, TOTE_and_CS): the stencil set has no file for it. Replace the outline when the stencil is supplied.';

const LAND_TYPES: Array<Omit<JssDocType, 'domain'>> = [
  { id: 'uhb', label: 'User Handbook', stencil: 'UHB.docx', bodyKind: 'chapter-manual', ready: true, chapters: UHB_CHAPTERS, maxDepth: 6, defaultBookName: 'User Handbook', coverInbr: false, coverTitle: ['USER HANDBOOK'], omitPages: ['cautionsNotes'] },
  { id: 'mm', label: 'Technical Manual - Part II Maintenance', stencil: 'MM.docx', bodyKind: 'chapter-manual', ready: true, chapters: MM_CHAPTERS, maxDepth: 6, defaultBookName: 'Technical Manual Part II Maintenance', coverInbr: false, coverTitle: ['TECHNICAL MANUAL', 'PART II MAINTENANCE'], omitPages: ['systemNamePage'], frontMatter: { foreword: { postalAddress: ['Head, Documentation & Training,', 'L&T Defence, Larsen & Toubro.', 'Defence Engineering Block, Gate No. 1,', 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'] }, noticeLegends: { note: 'Denote additional information.', warning: 'Denote possibility of danger to personnel due to improper use of equipment.', caution: 'Denote possibility of damage to equipment.' } } },
  { id: 'orm', label: 'Technical Manual - Part III Overhaul and Reconditioning', stencil: 'ORM.docx', bodyKind: 'chapter-manual', ready: true, chapters: ORM_CHAPTERS, maxDepth: 6, defaultBookName: 'Technical Manual Part III Overhaul and Reconditioning', coverInbr: false, coverTitle: ['TECHNICAL MANUAL', 'PART III OVERHAUL AND RECONDITIONING'], omitPages: ['systemNamePage'], frontMatter: { foreword: { postalAddress: ['Head, Documentation & Training,', 'L&T Defence, Larsen & Toubro.', 'Defence Engineering Block, Gate No. 1,', 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'] }, noticeLegends: { note: 'Denote additional information.', warning: 'Denote possibility of danger to personnel due to improper use of equipment.', caution: 'Denote possibility of damage to equipment.' } } },
  { id: 'uhb2', label: 'User Handbook (variant 2)', stencil: 'UHB2.docx', ...std, bodyKind: 'chapter-manual', chapters: UHB2_CHAPTERS, maxDepth: 6, defaultBookName: 'User Handbook', coverInbr: true, coverTitle: ['USER HANDBOOK'], omitPages: UHB_LIKE, frontMatter: FRONT_UHB2 },
  { id: 'tm-pi', label: 'Technical Manual - Part I Volume 1 Technical Information', stencil: 'TM_PI.docx', ...std, chapters: TM_PI_CHAPTERS, maxDepth: 6, defaultBookName: 'Technical Manual Part I Volume 1 Technical Information', coverTitle: ['TECHNICAL MANUAL', 'PART I VOLUME 1 TECHNICAL INFORMATION'], omitPages: UHB_LIKE },
  { id: 'tm-pi-vol-2', label: 'Technical Manual - Part I Volume 2 Drawings', stencil: 'TM_PI.docx', source: 'derived', derivedFrom: derivedDrawings, ...std, bodyKind: 'illustrations', chapters: TM_PI_VOL2_CHAPTERS, maxDepth: 3, defaultBookName: 'Technical Manual Part I Volume 2 Drawings', coverTitle: ['TECHNICAL MANUAL', 'PART I VOLUME 2 DRAWINGS'], omitPages: UHB_LIKE },
  { id: 'ds', label: 'Design Specification', stencil: 'DS.docx', ...std, chapters: DS_CHAPTERS, maxDepth: 6, defaultBookName: 'Design Specification', coverTitle: ['DESIGN SPECIFICATION'], omitPages: UHB_LIKE },
  { id: 'tote-cs', label: 'Table of Tools and Equipment and Carried Spares', stencil: 'TOTE_and_CS.docx', ...std, chapters: TOTE_CHAPTERS, maxDepth: 6, defaultBookName: 'Table of Tools and Equipment and Carried Spares', coverTitle: ['TABLE OF TOOLS AND EQUIPMENT AND CARRIED SPARES'], omitPages: UHB_LIKE, frontMatter: FRONT_TOTE },
  { id: 'prs', label: 'Permissive Repair Schedule', stencil: 'PRS.docx', ...std, chapters: PRS_CHAPTERS, maxDepth: 6, defaultBookName: 'Permissive Repair Schedule', coverTitle: ['PERMISSIVE REPAIR SCHEDULE'], omitPages: UHB_LIKE },
  { id: 'mrls', label: "Manufacturer's Recommended List of Spares (MRLS)", stencil: 'MRLS.docx', ...std, bodyKind: 'single-table', chapters: MRLS_CHAPTERS, maxDepth: 2, defaultBookName: "Manufacturer's Recommended List of Spares (MRLS)", coverTitle: ["MANUFACTURER'S RECOMMENDED LIST OF SPARES (MRLS)"], omitPages: UHB_LIKE, frontMatter: FRONT_AND_G },
  { id: 'rotable', label: 'Rotable List, Norms of Consumption, Mandatory / Non-Mandatory Spares List', stencil: 'ROTABLE.docx', ...std, bodyKind: 'single-table', chapters: ROTABLE_CHAPTERS, maxDepth: 2, defaultBookName: 'Rotable List, Norms of Consumption, Mandatory / Non-Mandatory Spares List', coverTitle: ['ROTABLE LIST, NORMS OF CONSUMPTION, MANDATORY / NON-MANDATORY SPARES LIST FOR EACH SYSTEM'], omitPages: UHB_LIKE },
  { id: 'vol-1-pl', label: "Technical Manual - Part IV Volume 1 Manufacturer's Parts List", stencil: 'Vol_1_PL.docx', ...std, bodyKind: 'parts-list', chapters: VOL1_CHAPTERS, maxDepth: 2, defaultBookName: "Technical Manual Part IV Volume 1 Manufacturer's Parts List", coverTitle: ['TECHNICAL MANUAL', "PART IV VOLUME 1 MANUFACTURER'S PARTS LIST"], omitPages: TM_LIKE, frontMatter: FRONT_MM },
  { id: 'vol-2-illustrations', label: 'Technical Manual - Part IV Volume 2 Illustrations', stencil: 'Vol_2_Illustrations.docx', ...std, bodyKind: 'illustrations', chapters: VOL2_CHAPTERS, maxDepth: 2, defaultBookName: 'Technical Manual Part IV Volume 2 Illustrations', coverTitle: ['TECHNICAL MANUAL', 'PART IV VOLUME 2 ILLUSTRATIONS'], omitPages: TM_LIKE, frontMatter: FRONT_MM },
  { id: 'ispl', label: 'Illustrative Spares Part List (ISPL)', stencil: 'ISPL.docx', ...std, bodyKind: 'parts-list', chapters: ISPL_CHAPTERS, maxDepth: 3, defaultBookName: 'Illustrative Spares Part List (ISPL)', coverTitle: ['ILLUSTRATIVE SPARES PART LIST (ISPL)'], omitPages: UHB_LIKE, frontMatter: FRONT_AND_G },
  { id: 'ispl-wrt-jss', label: 'Illustrative Spares Part List (ISPL), JSS cross-referenced', stencil: 'ISPL_wrt_JSS.docx', ...std, bodyKind: 'parts-list', chapters: ISPL_CHAPTERS, maxDepth: 3, defaultBookName: 'Illustrative Spares Part List (ISPL)', coverTitle: ['ILLUSTRATIVE SPARES PART LIST (ISPL)'], omitPages: UHB_LIKE, frontMatter: FRONT_AND_G },
  { id: 'ces', label: 'Complete Equipment Schedule', stencil: 'TOTE_and_CS.docx', source: 'derived', derivedFrom: derived, ...std, chapters: CES_CHAPTERS, maxDepth: 4, defaultBookName: 'Complete Equipment Schedule', coverTitle: ['COMPLETE EQUIPMENT SCHEDULE'], omitPages: UHB_LIKE, frontMatter: FRONT_TOTE },
  { id: 'fis', label: 'Field Inspection Standard', stencil: 'PRS.docx', source: 'derived', derivedFrom: derived, ...std, chapters: inspection('Field'), maxDepth: 4, defaultBookName: 'Field Inspection Standard', coverTitle: ['FIELD INSPECTION STANDARD'], omitPages: UHB_LIKE },
  { id: 'bis', label: 'Base Inspection Standard', stencil: 'PRS.docx', source: 'derived', derivedFrom: derived, ...std, chapters: inspection('Base'), maxDepth: 4, defaultBookName: 'Base Inspection Standard', coverTitle: ['BASE INSPECTION STANDARD'], omitPages: UHB_LIKE },
];

/** Every JSS document type: the Land stencils (JSS-0251) then the Naval ones. The wizard's catalogue (services/formats) is built from this list, so it cannot offer what the engine lacks. */
export const JSS_TYPES: JssDocType[] = [...LAND_TYPES.map((t) => ({ ...t, domain: 'land' as const })), ...NAVAL_TYPES];

export const jssTypesOf = (domain: JssDomain): JssDocType[] => JSS_TYPES.filter((t) => t.domain === domain);

/** A stencil table as the editor offers it: its head and widths, and the section it belongs to (null: any section of the document). */
export interface TemplateInfo extends TableTemplate { forSection: string | null }

/** Every table the stencil of a type fixes, so the editor can insert the stencil's own table rather than a plain one. */
export function tableTemplatesOf(type: JssDocType | undefined): TemplateInfo[] {
  if (!type) return [];
  const out: TemplateInfo[] = type.tableTemplate ? [{ ...type.tableTemplate, forSection: null }] : [];
  const walk = (nodes: OutlineNode[] | undefined): void => { for (const n of nodes ?? []) { if (n.table && n.table !== type.tableTemplate && !out.some((o) => o.forSection === n.title)) out.push({ ...n.table, forSection: n.title }); walk(n.children); } };
  walk(type.chapters);
  return out;
}

export const jssTypeById = (id: unknown): JssDocType | undefined => JSS_TYPES.find((t) => t.id === id);

export const readyJssTypes = (): JssDocType[] => JSS_TYPES.filter((t) => t.ready);

/** The sections of a stencil outline that go into a new document (examples left out), as plain nested titles. */
export function skeletonOf(nodes: OutlineNode[] | undefined): OutlineNode[] {
  return (nodes ?? []).filter((n) => !n.example).map((n) => ({ title: n.title, children: n.children ? skeletonOf(n.children) : undefined, ...(n.start ? { start: n.start } : {}), ...(n.orientation ? { orientation: n.orientation } : {}) }));
}

