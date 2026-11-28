/**
 * S1000D domain knowledge: schema/issue detection, data module code
 * formatting/parsing, identification metadata access.
 */
import { textOf } from './xml';
import { detectSchemaOf, type XRoot } from '../../../../backend/src/shared/collab/xmlForm';

export const ISSUES = ['4-1', '4-2', '5-0', '6', '7'] as const;
export type Issue = (typeof ISSUES)[number];
export const ISSUE_LABEL: Record<string, string> = { '4-1': '4.1', '4-2': '4.2', '5-0': '5.0', '6': '6', '7': '7' };
/** Default BREX data module per issue (systemDiffCode of DMC-S1000D-?-04-10-0301-00A-022A-D). */
export const DEFAULT_BREX: Record<string, string> = { '4-1': 'E', '4-2': 'F', '5-0': 'G', '6': 'H', '7': 'J' };

export const SCHEMAS: Record<string, string> = {
  descript: 'Descriptive',
  proced: 'Procedural',
  fault: 'Fault information',
  ipd: 'Illustrated parts data',
  crew: 'Crew/Operator information',
  brex: 'Business rules exchange (BREX)',
  comrep: 'Common information repository',
  checklist: 'Maintenance checklist',
  learning: 'Learning',
  process: 'Process',
  schedul: 'Maintenance planning',
  sb: 'Service bulletin',
  wrngdata: 'Wiring data',
  wrngflds: 'Wiring data description',
  container: 'Container',
  frontmatter: 'Front matter',
  appliccrossreftable: 'Applicability cross-reference table',
  condcrossreftable: 'Conditions cross-reference table',
  prdcrossreftable: 'Products cross-reference table',
  brdoc: 'Business rules document',
  scocontent: 'SCORM content package',
  icnmetadata: 'ICN metadata',
  dml: 'Data management list',
  pm: 'Publication module',
};

export interface SchemaRef {
  issue: string;
  schema: string;
  url: string | null;
}

/** Detects S1000D issue + schema from xsi:noNamespaceSchemaLocation (or root element heuristics). Phase 3: shared with the collaboration server. */
export function detectSchema(doc: Document): SchemaRef | null {
  return detectSchemaOf(doc.documentElement as unknown as XRoot | null);
}

export function schemaUrl(issue: string, schema: string): string {
  return `http://www.s1000d.org/S1000D_${issue}/xml_schema_flat/${schema}.xsd`;
}

// -------------------------------------------------------------- DMC handling
export interface DmCodeParts {
  modelIdentCode: string;
  systemDiffCode: string;
  systemCode: string;
  subSystemCode: string;
  subSubSystemCode: string;
  assyCode: string;
  disassyCode: string;
  disassyCodeVariant: string;
  infoCode: string;
  infoCodeVariant: string;
  itemLocationCode: string;
  learnCode?: string;
  learnEventCode?: string;
}

export const DMC_ATTRS: (keyof DmCodeParts)[] = [
  'modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode',
  'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode', 'learnCode', 'learnEventCode',
];

export function readDmCode(el: Element | null): DmCodeParts | null {
  if (!el) return null;
  const g = (n: string) => el.getAttribute(n) ?? '';
  return {
    modelIdentCode: g('modelIdentCode'), systemDiffCode: g('systemDiffCode'), systemCode: g('systemCode'),
    subSystemCode: g('subSystemCode'), subSubSystemCode: g('subSubSystemCode'), assyCode: g('assyCode'),
    disassyCode: g('disassyCode'), disassyCodeVariant: g('disassyCodeVariant'), infoCode: g('infoCode'),
    infoCodeVariant: g('infoCodeVariant'), itemLocationCode: g('itemLocationCode'),
    learnCode: el.getAttribute('learnCode') ?? undefined, learnEventCode: el.getAttribute('learnEventCode') ?? undefined,
  };
}

/** Formats as "DMC-MIC-SDC-SYS-SUB-SUBSUB-ASSY-DISASSY+V-INFO+V-ILC" (S1000D chap 4.3). */
export function formatDmc(p: DmCodeParts, prefix = true): string {
  let s = [
    p.modelIdentCode, p.systemDiffCode, p.systemCode, p.subSystemCode + p.subSubSystemCode, p.assyCode,
    p.disassyCode + p.disassyCodeVariant, p.infoCode + p.infoCodeVariant, p.itemLocationCode,
  ].join('-');
  if (p.learnCode) s += '-' + p.learnCode + (p.learnEventCode ?? '');
  return (prefix ? 'DMC-' : '') + s;
}

/**
 * Parses a DMC string. Accepts "DMC-" prefix or not; tolerates issue/language suffix (_001-00_EN-US).
 * Uses the standard segment lengths for the variable-length fields that are unambiguous.
 */
export function parseDmc(input: string): DmCodeParts | null {
  let s = input.trim().replace(/\.xml$/i, '');
  s = s.replace(/^DMC-/i, '');
  s = s.replace(/_.*$/, '');
  const segs = s.split('-');
  if (segs.length < 8) return null;
  const [mic, sdc, sys, subsub, assy, dis, info, ilc, learn] = segs;
  if (!/^[A-Z0-9]{2,14}$/i.test(mic)) return null;
  if (subsub.length < 2 || dis.length < 3 || info.length < 4 || ilc.length !== 1) return null;
  const p: DmCodeParts = {
    modelIdentCode: mic.toUpperCase(),
    systemDiffCode: sdc.toUpperCase(),
    systemCode: sys.toUpperCase(),
    subSystemCode: subsub.slice(0, 1).toUpperCase(),
    subSubSystemCode: subsub.slice(1).toUpperCase(),
    assyCode: assy.toUpperCase(),
    disassyCode: dis.slice(0, 2).toUpperCase(),
    disassyCodeVariant: dis.slice(2).toUpperCase(),
    infoCode: info.slice(0, 3).toUpperCase(),
    infoCodeVariant: info.slice(3).toUpperCase(),
    itemLocationCode: ilc.toUpperCase(),
  };
  if (learn) {
    p.learnCode = learn.slice(0, 3).toUpperCase();
    p.learnEventCode = learn.slice(3).toUpperCase();
  }
  return p;
}

export function validateDmcParts(p: DmCodeParts): string[] {
  const errs: string[] = [];
  const chk = (v: string, re: RegExp, label: string) => {
    if (!re.test(v)) errs.push(label);
  };
  chk(p.modelIdentCode, /^[A-Z0-9]{2,14}$/, 'Model identification code: 2–14 uppercase alphanumerics');
  chk(p.systemDiffCode, /^[A-Z0-9]{1,4}$/, 'System difference code: 1–4 alphanumerics');
  chk(p.systemCode, /^[A-Z0-9]{2,3}$/, 'System code: 2–3 alphanumerics');
  chk(p.subSystemCode, /^[A-Z0-9]$/, 'Subsystem code: 1 alphanumeric');
  chk(p.subSubSystemCode, /^[A-Z0-9]$/, 'Sub-subsystem code: 1 alphanumeric');
  chk(p.assyCode, /^[A-Z0-9]{2}$|^[A-Z0-9]{4}$/, 'Unit or assembly code: 2 or 4 alphanumerics');
  chk(p.disassyCode, /^[A-Z0-9]{2}$/, 'Disassembly code: 2 alphanumerics');
  chk(p.disassyCodeVariant, /^[A-Z0-9]{1,3}$/, 'Disassembly code variant: 1–3 alphanumerics');
  chk(p.infoCode, /^[A-Z0-9]{3}$/, 'Information code: 3 alphanumerics');
  chk(p.infoCodeVariant, /^[A-Z0-9]$/, 'Information code variant: 1 alphanumeric');
  chk(p.itemLocationCode, /^[ABCDT]$/, 'Item location code: A, B, C, D or T');
  if (p.learnCode) chk(p.learnCode, /^[TH][A-Z0-9]{2}$/, 'Learn code: T or H followed by 2 alphanumerics');
  if (p.learnEventCode) chk(p.learnEventCode, /^[A-E]$/, 'Learn event code: A–E');
  return errs;
}

export function writeDmCode(el: Element, p: DmCodeParts) {
  for (const k of DMC_ATTRS) {
    const v = p[k];
    if (v == null || v === '') {
      if (k === 'learnCode' || k === 'learnEventCode') el.removeAttribute(k);
      else el.setAttribute(k, '');
    } else el.setAttribute(k, v);
  }
}

// ------------------------------------------------------------ identification
export interface DmIdentInfo {
  dmc: string;
  parts: DmCodeParts | null;
  issueNumber: string;
  inWork: string;
  language: string;
  country: string;
  techName: string;
  infoName: string;
  issueDate: string;
  security: string;
  issueType: string;
}

export function find(root: Node | null, name: string): Element | null {
  if (!root) return null;
  const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument!;
  const base = root.nodeType === 9 ? doc.documentElement : (root as Element);
  if (!base) return null;
  if (base.nodeName === name) return base;
  return base.getElementsByTagName(name)[0] ?? null;
}

export function readIdent(doc: Document): DmIdentInfo | null {
  const root = doc.documentElement;
  if (!root) return null;
  const ident = find(root, 'dmIdent') ?? find(root, 'pmIdent');
  if (!ident) return null;
  const code = find(ident, 'dmCode');
  const parts = readDmCode(code);
  const issue = find(ident, 'issueInfo');
  const lang = find(ident, 'language');
  const status = find(root, 'dmStatus');
  const sec = status ? find(status, 'security') : null;
  const date = find(root, 'issueDate');
  return {
    dmc: parts ? formatDmc(parts) : '',
    parts,
    issueNumber: issue?.getAttribute('issueNumber') ?? '',
    inWork: issue?.getAttribute('inWork') ?? '',
    language: lang?.getAttribute('languageIsoCode') ?? '',
    country: lang?.getAttribute('countryIsoCode') ?? '',
    techName: textOf(find(root, 'techName')),
    infoName: textOf(find(root, 'infoName')),
    issueDate: date ? `${date.getAttribute('year') ?? ''}-${date.getAttribute('month') ?? ''}-${date.getAttribute('day') ?? ''}` : '',
    security: sec?.getAttribute('securityClassification') ?? '',
    issueType: status?.getAttribute('issueType') ?? '',
  };
}

/** Standard S1000D file name: DMC-..._001-00_EN-US.XML */
export function dmFileName(info: DmIdentInfo): string {
  if (!info.parts) return 'datamodule.xml';
  let s = formatDmc(info.parts);
  if (info.issueNumber) s += `_${info.issueNumber}-${info.inWork || '00'}`;
  if (info.language) s += `_${info.language.toUpperCase()}-${info.country.toUpperCase()}`;
  return s + '.XML';
}

/** Generated text for a dmRef: DMC plus optional titles. */
export function dmRefLabel(dmRef: Element): { dmc: string; title: string } {
  const code = find(dmRef, 'dmCode');
  const parts = readDmCode(code);
  const tech = textOf(find(dmRef, 'techName'));
  const info = textOf(find(dmRef, 'infoName'));
  return { dmc: parts ? formatDmc(parts) : 'DMC-?', title: [tech, info].filter(Boolean).join(' - ') };
}

export const SECURITY_LABELS: Record<string, string> = {
  '01': 'Unclassified', '02': 'Restricted', '03': 'Confidential', '04': 'Secret', '05': 'Top secret',
};

export const INTERNAL_REF_TYPES: Record<string, string> = {
  figure: 'irtt01', table: 'irtt02', multimedia: 'irtt03', supply: 'irtt04', supportEquipDescr: 'irtt05', spareDescr: 'irtt06',
  levelledPara: 'irtt07', proceduralStep: 'irtt08', graphic: 'irtt09', multimediaObject: 'irtt10', hotspot: 'irtt11',
  parameter: 'irtt12', zoneRef: 'irtt13', workLocation: 'irtt14', sbMaterialSet: 'irtt15', accessPointRef: 'irtt16',
  footnote: 'irtt18',
};

export const EMPHASIS_TYPES: Record<string, string> = {
  em01: 'Bold', em02: 'Italic', em03: 'Underline', em04: 'Overline', em05: 'Strikethrough',
};

/** Today's date as S1000D issueDate attributes. */
export function todayParts(d = new Date()) {
  return { year: String(d.getFullYear()), month: String(d.getMonth() + 1).padStart(2, '0'), day: String(d.getDate()).padStart(2, '0') };
}
