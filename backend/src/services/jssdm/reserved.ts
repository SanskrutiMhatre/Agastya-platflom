// =============================================================================
// Xignal's front-matter convention: data modules with RESERVED information codes (and the zero SNS code 00-0-0-00) ARE the
// prelim pages of a JSS publication. Verified on the JSS-0251 sample (18 such modules in one PMC "Front matter" group):
//
//   001 title page          021 proprietary notice     023 foreword            00T record of changes
//   00V associated handbooks 012 safety (disassy 01 safety warning, 02 first aid, 03 cautions / notes)
//   005 list of abbreviations 009 list of contents      00A list of figures     00Z list of tables
//   007 description of symbols
//   X01..X04 custom: in the sample X01 demolition, X02 change notice, X03 list of annexures, X04 system name
//
// The X codes are the customer's own, so they are recognised by NAME first (the module's infoName / techName, or the title of the
// publication entry that places it) and by the sample's numbering only as a fallback, which the report says.
// The page ids are the engine's (vendor/engine/frontMatterPages.js CATALOGUE) so the result drives the engine without translation;
// `listOfAnnexures` is the one Xignal page the engine has no counterpart for.
// =============================================================================

export type PageId =
  | 'titlePage' | 'proprietary' | 'foreword' | 'recordOfChanges' | 'associatedHandbooks' | 'safetyWarning' | 'firstAid' | 'cautionsNotes'
  | 'demolition' | 'changeNotice' | 'listOfAbbreviations' | 'listOfContents' | 'listOfFigures' | 'listOfTables' | 'systemNamePage'
  | 'descriptionOfSymbols' | 'listOfAnnexures';

export interface PageDef {
  page: PageId;
  infoCode: string;
  /** Disassembly code Xignal uses for this page (the three 012 pages are told apart by it). */
  disassy: string;
  /** What the page is called in the publication. */
  label: string;
  /** A name that marks the page when the code alone is ambiguous (X codes, other 012 pages). */
  hint?: RegExp;
}

/** The pages, in the order the Xignal sample lists them (which is also the engine's default order, less the joint title page). */
export const PAGE_DEFS: readonly PageDef[] = [
  { page: 'titlePage', infoCode: '001', disassy: '00', label: 'Title Page' },
  { page: 'proprietary', infoCode: '021', disassy: '00', label: 'Restriction on use, duplication or disclosure of proprietary information' },
  { page: 'foreword', infoCode: '023', disassy: '00', label: 'Foreword' },
  { page: 'recordOfChanges', infoCode: '00T', disassy: '00', label: 'Record of changes' },
  { page: 'associatedHandbooks', infoCode: '00V', disassy: '00', label: 'Associated handbooks' },
  { page: 'safetyWarning', infoCode: '012', disassy: '01', label: 'Safety warning', hint: /safety|warning/i },
  { page: 'firstAid', infoCode: '012', disassy: '02', label: 'First aid in case of electric shock', hint: /first\s*aid/i },
  { page: 'cautionsNotes', infoCode: '012', disassy: '03', label: 'Cautions/ Notes', hint: /caution|notes?\b/i },
  { page: 'demolition', infoCode: 'X01', disassy: '00', label: 'Demolition of material to prevent enemy use', hint: /demolition/i },
  { page: 'changeNotice', infoCode: 'X02', disassy: '00', label: 'Change notice', hint: /change\s*notice/i },
  { page: 'listOfAbbreviations', infoCode: '005', disassy: '00', label: 'List of abbreviations' },
  { page: 'listOfContents', infoCode: '009', disassy: '00', label: 'List of contents' },
  { page: 'listOfAnnexures', infoCode: 'X03', disassy: '00', label: 'List of annexures', hint: /annexure/i },
  { page: 'listOfFigures', infoCode: '00A', disassy: '00', label: 'List of figures' },
  { page: 'listOfTables', infoCode: '00Z', disassy: '00', label: 'List of tables' },
  { page: 'systemNamePage', infoCode: 'X04', disassy: '00', label: 'System name', hint: /system\s*(name|illustration)/i },
  { page: 'descriptionOfSymbols', infoCode: '007', disassy: '00', label: 'Description of symbols' },
];

export const pageDef = (p: PageId): PageDef => PAGE_DEFS.find((d) => d.page === p) as PageDef;

/** The information codes that can mark a front-matter module. */
export const RESERVED_INFO_CODES: ReadonlySet<string> = new Set(PAGE_DEFS.map((d) => d.infoCode));

/** A code worth looking at in the front-matter position: a reserved one, or any customer X code (reported when this code has no page for it). */
export const couldBeFrontMatterCode = (infoCode: string): boolean => RESERVED_INFO_CODES.has(String(infoCode ?? '').toUpperCase()) || /^X[A-Z0-9]{2}$/i.test(String(infoCode ?? ''));

export interface FmIdentity {
  infoCode: string;
  disassyCode?: string;
  systemCode: string;
  subSystemCode: string;
  subSubSystemCode: string;
  assyCode: string;
  infoName?: string;
  techName?: string;
  /** Title of the publication entry that places the module, when a publication is known. */
  entryTitle?: string;
}

export type Classification =
  | { kind: 'page'; page: PageId; via: 'code' | 'disassy' | 'name' | 'convention' }
  | { kind: 'unknown'; reason: string }
  | { kind: 'body' };

const isZero = (c: string): boolean => /^0+$/.test(c || '');

/**
 * Is this data module a front-matter page, and which one?
 *   body     not front matter (an ordinary module, or a 009 chapter heading, which sits in a real system)
 *   page     recognised
 *   unknown  carries a reserved code in the front-matter position but its page is not one this code knows (reported, left in the body)
 */
export function classifyFrontMatter(d: FmIdentity): Classification {
  const info = String(d.infoCode ?? '').toUpperCase();
  // A custom X code is the customer's own: at the front-matter position it is reported even when this code has no page for it.
  if (!couldBeFrontMatterCode(info)) return { kind: 'body' };
  // Front matter lives at the zero SNS code. A 009 in a real system is a chapter heading page.
  if (!(d.systemCode === '00' && isZero(d.subSystemCode) && isZero(d.subSubSystemCode) && isZero(d.assyCode))) return { kind: 'body' };

  const names = [d.infoName, d.techName, d.entryTitle].filter(Boolean).join(' | ');
  const sameCode = PAGE_DEFS.filter((p) => p.infoCode === info);
  if (sameCode.length === 1 && !/^X/.test(info)) return { kind: 'page', page: sameCode[0].page, via: 'code' };

  if (info === '012') {
    const byDisassy = sameCode.find((p) => p.disassy === (d.disassyCode ?? ''));
    if (byDisassy) return { kind: 'page', page: byDisassy.page, via: 'disassy' };
    const byName = sameCode.find((p) => p.hint && p.hint.test(names));
    return byName ? { kind: 'page', page: byName.page, via: 'name' } : { kind: 'unknown', reason: `information code 012 with disassembly code ${d.disassyCode || '?'} is not safety warning (01), first aid (02) or cautions (03), and its title does not say.` };
  }
  // X01..X04: the customer's own codes.
  const byName = PAGE_DEFS.filter((p) => /^X/.test(p.infoCode)).find((p) => p.hint && p.hint.test(names));
  if (byName) return { kind: 'page', page: byName.page, via: 'name' };
  const byConvention = sameCode[0];
  if (byConvention) return { kind: 'page', page: byConvention.page, via: 'convention' };
  return { kind: 'unknown', reason: `information code ${info} is a custom code and its title ("${d.infoName || d.techName || ''}") does not name a page this code knows.` };
}
