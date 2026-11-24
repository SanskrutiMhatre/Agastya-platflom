// The JSG document types: one entry per JSG stencil file in `manual format/JSG_FORMAT` (docs/JSG_STENCIL_ANALYSIS.md).
//
// JSG = Joint Services Guide. Nothing here is shared with the JSS registry (services/jss/registry.ts) or with S1000D.
//
// A type is `ready` only when the whole path exists for it (schema, editor, engine, PDF). A type that is listed but not ready is refused with its reason.

export interface OutlineNode { title: string; children?: OutlineNode[] }
export interface AppendixSeed { label: string; title: string }

export interface JsgDocType {
  id: 'uhb' | 'ispl';
  label: string;
  /** The Word file this type was read from. */
  stencil: string;
  ready: boolean;
  notReady?: string;
  /** The cover title the stencil prints. */
  coverTitle: string;
  /** The skeleton the stencil starts a new document with (chapters > sections > clauses), UHB only. */
  chapters?: Array<{ title: string; sections: Array<{ title: string; clauses?: string[] }> }>;
  appendices?: AppendixSeed[];
}

// Titles are the stencil's. Four slips in the stencil are corrected in the skeleton ("Ponits Peculiar", "Peridical", "Activites", "USe"); the stencil itself is untouched.
const UHB_CHAPTERS: NonNullable<JsgDocType['chapters']> = [
  { title: 'General Description', sections: [
    { title: 'Introduction', clauses: ['General', 'Special Features and Specifications', 'System Tree Chart'] },
    { title: 'Description', clauses: ['General Arrangements', 'Main Assemblies'] },
  ] },
  { title: 'Installation, Operation and Use', sections: [
    { title: 'Preparation for Use', clauses: ['General Points', 'Points Peculiar to any Particular', 'Location / Condition'] },
    { title: 'Installation Operation', clauses: ['Installation Procedure', 'Starting Up', 'Points to be Checked During Operation / Use', 'Switching Off', 'Post-operational Checks / Activities'] },
  ] },
  { title: 'Maintenance, Adjustments and Repairs', sections: [
    { title: 'Maintenance', clauses: ['Routine Maintenance', 'Periodical'] },
    { title: 'Adjustment', clauses: ['Permanent Adjustments'] },
    { title: 'Repairs', clauses: ['Scope of Unit Repairs & Spare Parts'] },
  ] },
  { title: 'Transportation', sections: [
    { title: 'Transportation in Assembled Condition', clauses: ['By Hand', 'By Rail', 'By Air', 'By Animal', 'By Road', 'By Water Transport'] },
    { title: 'Transportation in Crates' },
  ] },
  { title: 'Packing', sections: [
    { title: 'Special Features and Hazards', clauses: ['Special Features and Hazards'] },
    { title: 'Packing and Preservation', clauses: ['Preservation Procedure'] },
    { title: 'Pack Design', clauses: ['Containers', 'Waterproofing, Drainage, Ventilation', 'Cushioning Lifting Devices'] },
    { title: 'Inspection', clauses: ['Routine', 'Periodical'] },
    { title: 'Packing Drill', clauses: ['Dismantling', 'Preservation', 'Containers', 'Packing and Marking'] },
  ] },
];

const UHB_APPENDICES: AppendixSeed[] = [
  { label: 'H', title: 'System Specification' },
  { label: 'J', title: 'Carried Spares Part List' },
  { label: 'K', title: 'Carried Tool List' },
  { label: 'M', title: 'Fault Diagnosis Chart' },
  { label: 'N', title: 'Lubricating Chart and Recommended Lubricant' },
  { label: 'AA', title: 'Electrical Wiring Diagram' },
  { label: 'AB', title: 'Recommended Spares for Two Years Maintenance and One Overhaul' },
  { label: 'AC', title: 'Special Tool List' },
  { label: 'AD', title: 'List of Firms Service Centre with Postal Address' },
];

export const JSG_TYPES: JsgDocType[] = [
  { id: 'uhb', label: 'User Handbook', stencil: 'JSG_UHB_Stencil.docx', ready: true, coverTitle: 'USER HANDBOOK', chapters: UHB_CHAPTERS, appendices: UHB_APPENDICES },
  { id: 'ispl', label: 'Illustrated Spare Parts List', stencil: 'JSG_ISPL_Format.docx', ready: true, coverTitle: 'ILLUSTRATED SPARE PARTS LIST (ISPL)' },
];

/**
 * The standard wording of the ISPL preface, exactly as the stencil (JSG_ISPL_Format.docx) prints it: seven numbered paragraphs, the lettered list under paragraph 3 and its NOTE.
 * (The stencil's own spelling "ssupercede" is corrected to "supersede"; nothing else is changed.) A new ISPL starts with it; the author may edit it.
 */
export const ISPL_PREFACE: Array<{ kind: 'para' | 'note' | 'list'; text?: string; items?: string[] }> = [
  { kind: 'para', text: 'This Illustrated Spare Parts List (ISPL) has been prepared for identifying any component, part or assembly of parts likely to be required as replacements. All concerned will use the Cat Sec. / Part No., NSN and DCAN and designations given in this list when demanding spare part or when referring in correspondence to any part of the equipment. All demands for items listed herein must be submitted to appropriate authority in accordance with standing instruction.' },
  { kind: 'para', text: 'The Cat Sec. / Part No. (when quoted initially) and Designation of all \u2018P\u2019 marked items quoted in the list will be supersede by NSN and codified designation respectively as soon as such items will be codified:' },
  { kind: 'para', text: 'When demanding spare parts, following particulars must be quoted:' },
  { kind: 'list', items: [
    'Relevant Section / Sub-section of Catalogue of Ordnance Stores (i.e. COS) or Catalogue of Engineer Stores (i.e. COES) or Catalogue of Mechanical Transport Stores (i.e. CMTS) or Catalogue of Clothing (i.e. COC).',
    'Cat Sec. / Part No. or NSN or DCAN of spare parts along with their designation.',
    'Designation and Cat Sec. / Part No. or NSN or DCAN of the main equipment.',
  ] },
  { kind: 'note', text: '(NOTE \u2013 The above mentioned Catalogues belong to Army only. Navy and Air Force to mention their respective Catalogues under which the equipment/items are provided by them).' },
  { kind: 'para', text: 'Certain items included in this ISPL have not been marked \u2018P\u2019 (Provided) by concerned MAG since they are not considered to be provisioned for maintenance of the equipment. But User Unit / EME workshop may demand certain non \u2018P\u2019 items which they consider essential for maintenance purpose.' },
  { kind: 'para', text: 'All amendment to this list will be forwarded to all concerned by the concerned AHSP / department primarily responsible for providing the equipment. It is essential that this list should be carefully amended and date of each amendment entered.' },
  { kind: 'para', text: 'Abbreviations and symbols appearing in this list are given further in Abbreviations.' },
  { kind: 'para', text: 'Queries relating to this ISPL must be referred to Controller / HOE of the concerned office by whom this ISPL has been published. The name and address of the publisher is shown on cover page / cover leaf of this ISPL.' },
];

export const jsgTypeById = (id: unknown): JsgDocType | undefined => JSG_TYPES.find((t) => t.id === id);
