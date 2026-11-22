// =============================================================================
// S1000D data module code structure, as far as the Standard Numbering System needs it.
//
// The patterns are the ones the bundled Issue 4.2 schemas enforce (schemas/4.2/descript.xsd, and identical in
// 4.1, 5.0, 6.0 and 7.0), so a code this module accepts is a code a data module can carry:
//
//   systemDiffCode    [A-Z0-9]{1,4}
//   systemCode        [A-Z0-9]{2,3}
//   subSystemCode     [A-Z0-9]{1}
//   subSubSystemCode  [A-Z0-9]{1}
//   assyCode          [A-Z0-9]{2} or [A-Z0-9]{4}      (the schema allows exactly 2 or 4 characters, NOT 3)
//   infoCode          [A-Z0-9]{3}
//
// This file is pure (no I/O, no database): everything here is safe to call from tests and from the HTTP layer alike.
// =============================================================================

export type SnsLevel = 'system' | 'subsystem' | 'subsubsystem' | 'assy';
export const SNS_LEVELS: readonly SnsLevel[] = ['system', 'subsystem', 'subsubsystem', 'assy'];

export const SNS_CODE_RULES = {
  systemDiffCode: { re: /^[A-Z0-9]{1,4}$/, text: '1 to 4 letters or digits' },
  systemCode: { re: /^[A-Z0-9]{2,3}$/, text: '2 or 3 letters or digits' },
  subSystemCode: { re: /^[A-Z0-9]$/, text: '1 letter or digit' },
  subSubSystemCode: { re: /^[A-Z0-9]$/, text: '1 letter or digit' },
  assyCode: { re: /^(?:[A-Z0-9]{2}|[A-Z0-9]{4})$/, text: '2 or 4 letters or digits (the S1000D schemas allow exactly 2 or 4, not 3)' },
} as const;
export type SnsCodeKey = keyof typeof SNS_CODE_RULES;

/** The codes of a data module that identify where it sits in the SNS (plus the ones the ordering needs). */
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
}

const up = (v: unknown): string => String(v ?? '').trim().toUpperCase();

/**
 * The code parts of whatever identifies a data module: the attributes of its <dmCode> (or an object carrying them as
 * `dmCodeAttrs`), a DMC string such as `RDR-A-A05-40-00-01A-258A-D`, or a data module file name. null when it is none of those.
 */
export function parseDmCode(input: unknown): DmCodeParts | null {
  if (input == null) return null;
  if (typeof input === 'string') return parseDmcString(input);
  if (typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const attrs = (typeof o.dmCodeAttrs === 'object' && o.dmCodeAttrs ? o.dmCodeAttrs : typeof o.dmCode === 'object' && o.dmCode ? o.dmCode : o) as Record<string, unknown>;
  if (attrs.systemCode === undefined) {
    const s = typeof o.dmc === 'string' ? o.dmc : typeof o.file === 'string' ? o.file : '';
    return s ? parseDmcString(s) : null;
  }
  return {
    modelIdentCode: up(attrs.modelIdentCode), systemDiffCode: up(attrs.systemDiffCode), systemCode: up(attrs.systemCode),
    subSystemCode: up(attrs.subSystemCode), subSubSystemCode: up(attrs.subSubSystemCode), assyCode: up(attrs.assyCode),
    disassyCode: up(attrs.disassyCode), disassyCodeVariant: up(attrs.disassyCodeVariant),
    infoCode: up(attrs.infoCode), infoCodeVariant: up(attrs.infoCodeVariant), itemLocationCode: up(attrs.itemLocationCode),
  };
}

function parseDmcString(raw: string): DmCodeParts | null {
  let s = raw.trim().replace(/^.*[\\/]/, '').replace(/\.xml$/i, '').replace(/^DMC-/i, '');
  s = s.replace(/_.*$/, '');                                   // _001-00_EN-US issue / language suffix of a file name
  const p = s.toUpperCase().split('-');
  if (p.length !== 8) return null;
  const [model, diff, sys, subsub, assy, disassy, info, loc] = p;
  if (subsub.length !== 2 || disassy.length < 3 || disassy.length > 5 || info.length !== 4 || loc.length !== 1) return null;
  return {
    modelIdentCode: model, systemDiffCode: diff, systemCode: sys, subSystemCode: subsub[0], subSubSystemCode: subsub[1], assyCode: assy,
    disassyCode: disassy.slice(0, 2), disassyCodeVariant: disassy.slice(2), infoCode: info.slice(0, 3), infoCodeVariant: info.slice(3), itemLocationCode: loc,
  };
}

/** "RDR-A-A05-40-00-01A-258A-D" */
export function dmCodeToString(p: DmCodeParts): string {
  return [p.modelIdentCode, p.systemDiffCode, p.systemCode, `${p.subSystemCode}${p.subSubSystemCode}`, p.assyCode,
    `${p.disassyCode}${p.disassyCodeVariant}`, `${p.infoCode}${p.infoCodeVariant}`, p.itemLocationCode].join('-');
}

/** A zero code ("0", "00", "0000") means "this level itself": the data module belongs to the parent, not to a node of its own. */
export const isZeroCode = (c: string | undefined): boolean => !c || /^0+$/.test(c);

// ── Information code groups ──────────────────────────────────────────────────

export interface InfoGroup { id: string; label: string; from: string; to: string }

/**
 * S1000D information codes fall into groups by their first character. The group order IS the order of a book:
 * description first, then operation, servicing, checks, faults, removal, repair, installation, packing, miscellaneous
 * (illustrated parts data, 941 and friends, are 9xx). The table is data: pass your own through `OrderConfig.groups`
 * (the order of the array is the rank) to change it. Bounds are compared as upper-case text, so codes with letters
 * (00A, 0B0, 1ZZ) land in the group of their first character.
 */
export const INFO_CODE_GROUPS: readonly InfoGroup[] = [
  { id: '0xx', label: 'Function, data for plans and description', from: '000', to: '0ZZ' },
  { id: '1xx', label: 'Operation', from: '100', to: '1ZZ' },
  { id: '2xx', label: 'Servicing', from: '200', to: '2ZZ' },
  { id: '3xx', label: 'Examinations, tests and checks', from: '300', to: '3ZZ' },
  { id: '4xx', label: 'Fault reports and isolation procedures', from: '400', to: '4ZZ' },
  { id: '5xx', label: 'Disconnect, remove and disassemble procedures', from: '500', to: '5ZZ' },
  { id: '6xx', label: 'Repairs and locally made procedures, data and tools', from: '600', to: '6ZZ' },
  { id: '7xx', label: 'Assemble, install and connect procedures', from: '700', to: '7ZZ' },
  { id: '8xx', label: 'Package, handling, storage and transportation', from: '800', to: '8ZZ' },
  { id: '9xx', label: 'Miscellaneous, including illustrated parts data', from: '900', to: '9ZZ' },
];

export type OrderKey = 'sns' | 'info' | 'infoVariant' | 'disassy' | 'location' | 'language' | 'issue' | 'file';

export interface OrderConfig {
  /** Replaces the default group table; the position in the array is the rank. */
  groups?: InfoGroup[];
  /** Rank of one exact information code (lower sorts earlier), beating its group. Example: `{ '018': -1 }` puts the introduction first. */
  rank?: Record<string, number>;
  /** Information codes that sort before everything else, in the order listed. */
  pinFirst?: string[];
  /** Information codes that sort after everything else, in the order listed. */
  pinLast?: string[];
  /** The sort keys, most significant first. Default: sns, info, infoVariant, disassy, location, language, issue, file. */
  keys?: OrderKey[];
}

export const DEFAULT_ORDER_KEYS: readonly OrderKey[] = ['sns', 'info', 'infoVariant', 'disassy', 'location', 'language', 'issue', 'file'];

/** The group an information code belongs to (undefined for a malformed code). */
export function infoGroupOf(code: string, groups: readonly InfoGroup[] = INFO_CODE_GROUPS): { index: number; group: InfoGroup } | undefined {
  const c = up(code);
  const index = groups.findIndex((g) => c >= up(g.from) && c <= up(g.to));
  return index < 0 ? undefined : { index, group: groups[index] };
}

/** Sort tuple of an information code under a configuration: [pin bucket, pin position or group rank, code]. */
export function infoSortKey(code: string, cfg: OrderConfig = {}): [number, number, string] {
  const c = up(code);
  const first = (cfg.pinFirst ?? []).map(up).indexOf(c);
  if (first >= 0) return [-1, first, c];
  const last = (cfg.pinLast ?? []).map(up).indexOf(c);
  if (last >= 0) return [1, last, c];
  const own = cfg.rank && Object.prototype.hasOwnProperty.call(cfg.rank, c) ? cfg.rank[c] : undefined;
  if (own !== undefined) return [0, own, c];
  const g = infoGroupOf(c, cfg.groups ?? INFO_CODE_GROUPS);
  return [0, g ? g.index : 1000, c];                           // a code in no group sorts after every group
}

/** Lexicographic comparison of two key tuples (numbers numerically, text by code unit: independent of the machine's locale). */
export function compareKeys(a: ReadonlyArray<string | number>, b: ReadonlyArray<string | number>): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x < y ? -1 : 1;
    const sx = String(x), sy = String(y);
    if (sx !== sy) return sx < sy ? -1 : 1;
  }
  return 0;
}
