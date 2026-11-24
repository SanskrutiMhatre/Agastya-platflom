// The JSS document types: one entry per stencil in `manual format/JSS0251-stencils`, with the structure the stencil fixes.
// See docs/JSS_STENCIL_ANALYSIS.md for how each entry was read from the stencil's Word XML.
//
// A type is `ready` only when the whole path exists for it (schema, editor, XML, PDF). The others are listed so the catalogue is the
// whole stencil inventory, and are refused with the reason rather than offered half-built.
//
// The shared frame (title pages, notices, record of changes, contents ... symbols) is NOT part of a type: it is identical for all
// of them and comes from the project's Settings, so it cannot drift between types. What the type decides about the frame is only
// the wording of the cover title.

export type BodyKind = 'chapter-manual' | 'parts-list' | 'illustrations' | 'single-table';

export interface OutlineNode {
  title: string;
  children?: OutlineNode[];
  /** A heading the stencil shows as an example to be renamed or repeated ("Assembly-1", "Unit-1"): left out of the starting skeleton. */
  example?: boolean;
}

export interface JssDocType {
  id: string;
  /** The name the stencil's cover gives the publication. */
  label: string;
  /** The stencil file this type was read from. */
  stencil: string;
  bodyKind: BodyKind;
  ready: boolean;
  /** Why it is not ready (shown to the person, never hidden). */
  notReady?: string;
  /** The chapters the stencil fixes, in order. A document of this type has exactly these chapters, in this order. */
  chapters?: OutlineNode[];
  /** The deepest heading level the stencil defines (Heading 1 = chapter). */
  maxDepth: number;
  /** The title of the book as the stencil's cover words it, used when the author has not given one. */
  defaultBookName: string;
  /** The cover's title lines exactly as the stencil prints them. */
  coverTitle: string[];
  /** Whether the stencil's cover has an "INBR No." line. Read from the stencils: only UHB2's does; the others have Code No. and Rev No. only. */
  coverInbr: boolean;
  /**
   * Front-matter pages that differ between stencils, read from them (docs/JSS_STENCIL_ANALYSIS.md): UHB has a System Name page and no Cautions / Notes page; MM and ORM
   * have a Cautions / Notes page (title only, the author fills it) and no System Name page. Left out for a type that is not built yet: it is read when the type is.
   */
  frontPages?: { cautionsNotes: boolean; systemNamePage: boolean };
  /** Front-matter wording that differs from the shared defaults in this stencil (the MM and ORM stencils name a different building in the Foreword's postal address). */
  frontMatter?: { foreword?: { postalAddress: string[] }; noticeLegends?: { note: string; warning: string; caution: string } };
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

const later = (kind: string): string => `The ${kind} body is not built yet; the stencil is analysed (docs/JSS_STENCIL_ANALYSIS.md) but its editor, schema and layout are a later step.`;
const manualNext = 'Chapter manual not yet taken through the end-to-end check; the first slice is UHB, MM and ORM.';

export const JSS_TYPES: JssDocType[] = [
  { id: 'uhb', label: 'User Handbook', stencil: 'UHB.docx', bodyKind: 'chapter-manual', ready: true, chapters: UHB_CHAPTERS, maxDepth: 6, defaultBookName: 'User Handbook', coverInbr: false, coverTitle: ['USER HANDBOOK'], frontPages: { cautionsNotes: false, systemNamePage: true } },
  { id: 'mm', label: 'Technical Manual - Part II Maintenance', stencil: 'MM.docx', bodyKind: 'chapter-manual', ready: true, chapters: MM_CHAPTERS, maxDepth: 6, defaultBookName: 'Technical Manual Part II Maintenance', coverInbr: false, coverTitle: ['TECHNICAL MANUAL', 'PART II MAINTENANCE'], frontPages: { cautionsNotes: true, systemNamePage: false }, frontMatter: { foreword: { postalAddress: ['Head, Documentation & Training,', 'L&T Defence, Larsen & Toubro.', 'Defence Engineering Block, Gate No. 1,', 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'] }, noticeLegends: { note: 'Denote additional information.', warning: 'Denote possibility of danger to personnel due to improper use of equipment.', caution: 'Denote possibility of damage to equipment.' } } },
  { id: 'orm', label: 'Technical Manual - Part III Overhaul and Reconditioning', stencil: 'ORM.docx', bodyKind: 'chapter-manual', ready: true, chapters: ORM_CHAPTERS, maxDepth: 6, defaultBookName: 'Technical Manual Part III Overhaul and Reconditioning', coverInbr: false, coverTitle: ['TECHNICAL MANUAL', 'PART III OVERHAUL AND RECONDITIONING'], frontPages: { cautionsNotes: true, systemNamePage: false }, frontMatter: { foreword: { postalAddress: ['Head, Documentation & Training,', 'L&T Defence, Larsen & Toubro.', 'Defence Engineering Block, Gate No. 1,', 'Saki Vihar Road, Powai.', 'Mumbai - 400 072.'] }, noticeLegends: { note: 'Denote additional information.', warning: 'Denote possibility of danger to personnel due to improper use of equipment.', caution: 'Denote possibility of damage to equipment.' } } },
  { id: 'uhb2', label: 'User Handbook (variant 2)', stencil: 'UHB2.docx', bodyKind: 'chapter-manual', ready: false, notReady: 'UHB2 is kept separate from UHB (different chapter 1 sections, INBR cover, Times New Roman tables, A3 fold-outs); its outline and tables are the next chapter-manual step.', maxDepth: 6, defaultBookName: 'User Handbook', coverInbr: true, coverTitle: ['USER HANDBOOK'] },
  { id: 'tm-pi', label: 'Technical Manual - Part I Technical Information', stencil: 'TM_PI.docx', bodyKind: 'chapter-manual', ready: false, notReady: manualNext, maxDepth: 6, defaultBookName: 'Technical Manual Part I Technical Information', coverInbr: false, coverTitle: ['TECHNICAL MANUAL', 'PART I TECHNICAL INFORMATION'] },
  { id: 'ds', label: 'Design Specification', stencil: 'DS.docx', bodyKind: 'chapter-manual', ready: false, notReady: manualNext, maxDepth: 6, defaultBookName: 'Design Specification', coverInbr: false, coverTitle: ['DESIGN SPECIFICATION'] },
  { id: 'tote-cs', label: 'Table of Tools and Equipment and Carried Spares', stencil: 'TOTE_and_CS.docx', bodyKind: 'chapter-manual', ready: false, notReady: manualNext, maxDepth: 6, defaultBookName: 'Table of Tools and Equipment and Carried Spares', coverInbr: false, coverTitle: ['TABLE OF TOOLS AND EQUIPMENT AND CARRIED SPARES'] },
  { id: 'prs', label: 'Permissive Repair Schedule', stencil: 'PRS.docx', bodyKind: 'chapter-manual', ready: false, notReady: manualNext, maxDepth: 6, defaultBookName: 'Permissive Repair Schedule', coverInbr: false, coverTitle: ['PERMISSIVE REPAIR SCHEDULE'] },
  { id: 'mrls', label: "Manufacturer's Recommended List of Spares (MRLS)", stencil: 'MRLS.docx', bodyKind: 'single-table', ready: false, notReady: later('single-table list'), maxDepth: 1, defaultBookName: "Manufacturer's Recommended List of Spares (MRLS)", coverInbr: false, coverTitle: ["MANUFACTURER'S RECOMMENDED LIST OF SPARES (MRLS)"] },
  { id: 'rotable', label: 'Rotable List, Norms of Consumption, Mandatory / Non-Mandatory Spares List', stencil: 'ROTABLE.docx', bodyKind: 'single-table', ready: false, notReady: later('single-table list'), maxDepth: 1, defaultBookName: 'Rotable List, Norms of Consumption, Mandatory / Non-Mandatory Spares List', coverInbr: false, coverTitle: ['ROTABLE LIST, NORMS OF CONSUMPTION, MANDATORY / NON-MANDATORY SPARES LIST FOR EACH SYSTEM'] },
  { id: 'vol-1-pl', label: "Technical Manual - Part IV Volume 1 Manufacturer's Parts List", stencil: 'Vol_1_PL.docx', bodyKind: 'parts-list', ready: false, notReady: later('parts-list'), maxDepth: 2, defaultBookName: "Technical Manual Part IV Volume 1 Manufacturer's Parts List", coverInbr: false, coverTitle: ['TECHNICAL MANUAL', "PART IV VOLUME 1 MANUFACTURER'S PARTS LIST"] },
  { id: 'vol-2-illustrations', label: 'Technical Manual - Part IV Volume 2 Illustrations', stencil: 'Vol_2_Illustrations.docx', bodyKind: 'illustrations', ready: false, notReady: later('illustrations'), maxDepth: 2, defaultBookName: 'Technical Manual Part IV Volume 2 Illustrations', coverInbr: false, coverTitle: ['TECHNICAL MANUAL', 'PART IV VOLUME 2 ILLUSTRATIONS'] },
  { id: 'ispl', label: 'Illustrative Spares Part List (ISPL)', stencil: 'ISPL.docx', bodyKind: 'parts-list', ready: false, notReady: later('parts-list'), maxDepth: 3, defaultBookName: 'Illustrative Spares Part List (ISPL)', coverInbr: false, coverTitle: ['ILLUSTRATIVE SPARES PART LIST (ISPL)'] },
  { id: 'ispl-wrt-jss', label: 'Illustrative Spares Part List (ISPL), JSS cross-referenced', stencil: 'ISPL_wrt_JSS.docx', bodyKind: 'parts-list', ready: false, notReady: later('parts-list') + ' It differs from ISPL only in that the assembly index of each chapter is made of live cross-references to the assembly headings.', maxDepth: 3, defaultBookName: 'Illustrative Spares Part List (ISPL)', coverInbr: false, coverTitle: ['ILLUSTRATIVE SPARES PART LIST (ISPL)'] },
];

export const jssTypeById = (id: unknown): JssDocType | undefined => JSS_TYPES.find((t) => t.id === id);

export const readyJssTypes = (): JssDocType[] => JSS_TYPES.filter((t) => t.ready);

/** The sections of a stencil outline that go into a new document (examples left out), as plain nested titles. */
export function skeletonOf(nodes: OutlineNode[] | undefined): OutlineNode[] {
  return (nodes ?? []).filter((n) => !n.example).map((n) => ({ title: n.title, children: n.children ? skeletonOf(n.children) : undefined }));
}
