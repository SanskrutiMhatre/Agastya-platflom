// =============================================================================
// The Standard Numbering System (SNS) as data: rows, their validation, and look-ups.
//
// An SNS row names one node of the tree that the data module code spells out:
//
//     systemCode            (2-3)   e.g. A05        "System Maintenance Concept"
//       subSystemCode       (1)     e.g. 4          "Preventive maintenance"
//         subSubSystemCode  (1)     e.g. 0          ...
//           assyCode        (2|4)   e.g. 00         ...
//
// plus an OPTIONAL systemDiffCode: a row that carries one applies only to data modules with that difference code; a
// row without one applies to every difference code (a more specific row wins).
//
// A row is the same JSON in every place it is stored (the organisation defaults, a project's sns.json), so the pure
// logic lives here and the persistence in store.ts. Nothing in this file touches the disk or the database.
// =============================================================================

import { SNS_CODE_RULES, SNS_LEVELS, parseDmCode, type DmCodeParts, type SnsCodeKey, type SnsLevel } from './codes';

export interface SnsRow {
  id: string;
  /** '' = every difference code. */
  systemDiffCode: string;
  systemCode: string;
  /** '' when the row is a system. */
  subSystemCode: string;
  /** '' unless the row is a sub-sub-system or an assembly. */
  subSubSystemCode: string;
  /** '' unless the row is an assembly. */
  assyCode: string;
  title: string;
}
export type SnsRowData = Omit<SnsRow, 'id'>;

export const TITLE_MAX = 255;

const up = (v: unknown): string => String(v ?? '').trim().toUpperCase();

/** The level a row sits at: the deepest code it carries. */
export function levelOf(r: Pick<SnsRowData, 'subSystemCode' | 'subSubSystemCode' | 'assyCode'>): SnsLevel {
  if (r.assyCode) return 'assy';
  if (r.subSubSystemCode) return 'subsubsystem';
  if (r.subSystemCode) return 'subsystem';
  return 'system';
}

/** Identity of a node: two rows with the same key are the same node. */
export const rowKey = (r: Pick<SnsRowData, 'systemDiffCode' | 'systemCode' | 'subSystemCode' | 'subSubSystemCode' | 'assyCode'>): string =>
  [r.systemDiffCode, r.systemCode, r.subSystemCode, r.subSubSystemCode, r.assyCode].join('|');

/** "A05-40-00" for display and for messages (the system difference code is shown separately). */
export function displayCode(r: Pick<SnsRowData, 'systemCode' | 'subSystemCode' | 'subSubSystemCode' | 'assyCode'>): string {
  const mid = `${r.subSystemCode}${r.subSubSystemCode}`;
  return [r.systemCode, mid, r.assyCode].filter(Boolean).join('-');
}

const FIELD_LABEL: Record<SnsCodeKey, string> = {
  systemDiffCode: 'System difference code', systemCode: 'System code', subSystemCode: 'Sub-system code',
  subSubSystemCode: 'Sub-sub-system code', assyCode: 'Assembly code',
};

/**
 * Turn loose input (an HTTP body, a CSV line, a learned proposal) into a row, or say what is wrong with it.
 * Codes are trimmed and upper-cased (the schemas only accept upper case); the title is trimmed, stripped of control
 * characters and whitespace-collapsed. Every problem is reported, not just the first.
 */
export function normalizeRow(input: unknown): { row?: SnsRowData; errors: string[] } {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const row: SnsRowData = {
    systemDiffCode: up(o.systemDiffCode), systemCode: up(o.systemCode), subSystemCode: up(o.subSystemCode),
    subSubSystemCode: up(o.subSubSystemCode), assyCode: up(o.assyCode),
    // eslint-disable-next-line no-control-regex
    title: String(o.title ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(),
  };
  if (!row.systemCode) errors.push('System code is required.');
  for (const k of Object.keys(SNS_CODE_RULES) as SnsCodeKey[]) {
    const v = row[k];
    if (v && !SNS_CODE_RULES[k].re.test(v)) errors.push(`${FIELD_LABEL[k]} "${v}" is not valid: it must be ${SNS_CODE_RULES[k].text}, upper case.`);
  }
  if (row.subSubSystemCode && !row.subSystemCode) errors.push('A sub-sub-system code needs a sub-system code.');
  if (row.assyCode && (!row.subSystemCode || !row.subSubSystemCode)) errors.push('An assembly code needs a sub-system code and a sub-sub-system code.');
  if (!row.title) errors.push('A title is required.');
  if (row.title.length > TITLE_MAX) errors.push(`The title is longer than ${TITLE_MAX} characters.`);
  return errors.length ? { errors } : { row, errors };
}

export interface SnsProblem {
  severity: 'error' | 'warn';
  code: 'DUPLICATE' | 'ORPHAN' | 'INVALID';
  message: string;
  rowIds: string[];
}

/** The data of a row's parent (undefined for a system). */
function parentOf(r: SnsRowData): SnsRowData | undefined {
  const lvl = levelOf(r);
  if (lvl === 'system') return undefined;
  const p = { ...r };
  if (lvl === 'assy') p.assyCode = '';
  else if (lvl === 'subsubsystem') p.subSubSystemCode = '';
  else p.subSystemCode = '';
  return p;
}

/**
 * Problems of a whole set: invalid rows, duplicates (the same node twice) and orphans (a sub-system whose system is not
 * defined, ...). An orphan is a warning: the tree is still usable, but derive would have nowhere sensible to hang it.
 */
export function validateRowSet(rows: readonly SnsRow[]): SnsProblem[] {
  const out: SnsProblem[] = [];
  const seen = new Map<string, SnsRow>();
  const keys = new Set<string>();
  const diffless = new Set<string>();
  for (const r of rows) {
    const n = normalizeRow(r);
    if (!n.row) { out.push({ severity: 'error', code: 'INVALID', message: `${displayCode(r) || r.id}: ${n.errors.join(' ')}`, rowIds: [r.id] }); continue; }
    const k = rowKey(n.row);
    const twin = seen.get(k);
    if (twin) out.push({ severity: 'error', code: 'DUPLICATE', message: `${displayCode(r)}${r.systemDiffCode ? ` (difference code ${r.systemDiffCode})` : ''} is defined twice: "${twin.title}" and "${r.title}".`, rowIds: [twin.id, r.id] });
    else seen.set(k, r);
    keys.add(k);
    if (!r.systemDiffCode) diffless.add(k);
  }
  for (const r of rows) {
    const parent = parentOf(r);
    if (!parent) continue;
    if (!keys.has(rowKey(parent)) && !diffless.has(rowKey({ ...parent, systemDiffCode: '' }))) {
      out.push({ severity: 'warn', code: 'ORPHAN', message: `${displayCode(r)} has no parent: ${displayCode(parent)} is not defined.`, rowIds: [r.id] });
    }
  }
  return out;
}

export const compareRows = (a: SnsRowData, b: SnsRowData): number => {
  const ka = [a.systemCode, a.systemDiffCode, a.subSystemCode, a.subSubSystemCode, a.assyCode];
  const kb = [b.systemCode, b.systemDiffCode, b.subSystemCode, b.subSubSystemCode, b.assyCode];
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return a.title === b.title ? 0 : a.title < b.title ? -1 : 1;                  // a duplicate node: the title decides which one wins, not the input order
};
/** The canonical order of rows: by system code, then difference code, sub-system, sub-sub-system, assembly. */
export const sortRows = <T extends SnsRowData>(rows: readonly T[]): T[] => [...rows].sort(compareRows);

export interface SnsNodeView { row: SnsRow; level: SnsLevel; children: SnsNodeView[] }

export interface SnsLookup { system?: SnsRow; subsystem?: SnsRow; subsubsystem?: SnsRow; assy?: SnsRow }

/** An indexed set of rows: the thing `deriveStructure` and `snsTitle` consult. */
export class SnsTree {
  readonly rows: SnsRow[];
  private readonly byKey = new Map<string, SnsRow>();

  constructor(rows: ReadonlyArray<Partial<SnsRow> & Pick<SnsRowData, 'systemCode' | 'title'>> = []) {
    // A row without an id gets one from its own code, never from its position in the input: the same SNS in another order is the same tree.
    const made = new Map<string, number>();
    this.rows = rows.map((r) => {
      const row: SnsRow = {
        id: r.id === undefined || r.id === null || r.id === '' ? '' : String(r.id), systemDiffCode: up(r.systemDiffCode), systemCode: up(r.systemCode), subSystemCode: up(r.subSystemCode),
        subSubSystemCode: up(r.subSubSystemCode), assyCode: up(r.assyCode), title: String(r.title ?? '').trim(),
      };
      return row;
    });
    for (const r of sortRows(this.rows)) {
      if (r.id) continue;
      const k = rowKey(r);
      const n = made.get(k) ?? 0;
      made.set(k, n + 1);
      r.id = n ? `r:${k}#${n}` : `r:${k}`;
    }
    for (const r of sortRows(this.rows)) if (!this.byKey.has(rowKey(r))) this.byKey.set(rowKey(r), r);       // first of a duplicate wins, deterministically
  }

  static from(sns: SnsTree | ReadonlyArray<Partial<SnsRow> & Pick<SnsRowData, 'systemCode' | 'title'>> | null | undefined): SnsTree {
    if (sns instanceof SnsTree) return sns;
    return new SnsTree(sns ?? []);
  }

  /** The row at exactly this node: the one for the module's difference code if there is one, else the one for every difference code. */
  find(diff: string, sys: string, sub = '', subsub = '', assy = ''): SnsRow | undefined {
    return this.byKey.get([up(diff), up(sys), up(sub), up(subsub), up(assy)].join('|')) ?? this.byKey.get(['', up(sys), up(sub), up(subsub), up(assy)].join('|'));
  }

  /** The rows that name each level of a data module's code (a level with no row is simply absent). */
  lookup(dmCode: unknown): SnsLookup {
    const p = parseDmCode(dmCode);
    if (!p) return {};
    return this.lookupParts(p);
  }

  lookupParts(p: Pick<DmCodeParts, 'systemDiffCode' | 'systemCode' | 'subSystemCode' | 'subSubSystemCode' | 'assyCode'>): SnsLookup {
    const d = p.systemDiffCode;
    return {
      system: this.find(d, p.systemCode),
      subsystem: this.find(d, p.systemCode, p.subSystemCode),
      subsubsystem: this.find(d, p.systemCode, p.subSystemCode, p.subSubSystemCode),
      assy: this.find(d, p.systemCode, p.subSystemCode, p.subSubSystemCode, p.assyCode),
    };
  }

  /** The title at one level of a module's code, or the most specific one that exists ('auto'). null when nothing is defined. */
  title(dmCode: unknown, level: SnsLevel | 'auto' = 'auto'): string | null {
    const l = this.lookup(dmCode);
    if (level !== 'auto') return l[level]?.title ?? null;
    for (let i = SNS_LEVELS.length - 1; i >= 0; i--) { const r = l[SNS_LEVELS[i]]; if (r) return r.title; }
    return null;
  }

  /** The rows as a nested tree (orphans become roots), in canonical order. */
  nested(): SnsNodeView[] {
    const nodes = new Map<SnsRow, SnsNodeView>();
    for (const r of sortRows(this.rows)) nodes.set(r, { row: r, level: levelOf(r), children: [] });
    const roots: SnsNodeView[] = [];
    for (const [r, n] of nodes) {
      const lvl = levelOf(r);
      let parent: SnsRow | undefined;
      if (lvl === 'assy') parent = this.find(r.systemDiffCode, r.systemCode, r.subSystemCode, r.subSubSystemCode);
      else if (lvl === 'subsubsystem') parent = this.find(r.systemDiffCode, r.systemCode, r.subSystemCode);
      else if (lvl === 'subsystem') parent = this.find(r.systemDiffCode, r.systemCode);
      const pn = parent && parent !== r ? nodes.get(parent) : undefined;
      (pn ? pn.children : roots).push(n);
    }
    return roots;
  }
}

/** The title of one level of a data module's code in an SNS, or null. `snsTitle(dmCode, sns, 'system' | 'subsystem' | 'subsubsystem' | 'assy' | 'auto')`. */
export function snsTitle(dmCode: unknown, sns: SnsTree | ReadonlyArray<Partial<SnsRow> & Pick<SnsRowData, 'systemCode' | 'title'>>, level: SnsLevel | 'auto' = 'auto'): string | null {
  return SnsTree.from(sns).title(dmCode, level);
}
