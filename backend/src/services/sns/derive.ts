// =============================================================================
// Deriving a publication structure from data module codes and the SNS.
//
//   deriveStructure(dmList, sns, options)  ->  a nested tree: system -> sub-system -> sub-sub-system -> assembly -> data modules
//
// WHAT GOES WHERE
//   A data module belongs to the deepest SNS node its code names. A zero code ("0", "00", "0000") means "this level itself",
//   so A05-00-00-00A sits directly in system A05, and A05-40-00-..A directly in sub-system 4 of A05 (`collapseZero`, on by
//   default; with it off a zero level gets a node of its own only where the SNS defines one).
//   A level the SNS does not define is skipped, and the module hangs from the deepest ancestor that is defined
//   (`match: 'partial'`). A module whose SYSTEM is not in the SNS - or any module that is not a full match when
//   `unmatched: 'unclassified'` - goes to an "Unclassified" node at the end of the book.
//
// WHAT ORDER
//   Modules of one node: by SNS code, then by information code through a table of groups (codes.ts INFO_CODE_GROUPS:
//   0xx description, 1xx operation, 2xx servicing ... 9xx miscellaneous), then information-code variant, disassembly
//   code, item location, language, issue, file. Every step is data (`OrderConfig`): replace the group table, rank or pin single
//   information codes, or re-sort the keys. Nodes of one level: by code. A node's own modules come before its child nodes.
//
// STABLE
//   Pure and total: no clock, no randomness, no locale-dependent comparison, a tie broken by file name. The same modules in
//   any input order give a deep-equal result.
//
// Only the NEWEST issue of a data module (same code and language) is placed; the older ones are listed in `superseded`.
// =============================================================================

import { DEFAULT_ORDER_KEYS, compareKeys, infoGroupOf, infoSortKey, isZeroCode, parseDmCode, type DmCodeParts, type OrderConfig, type OrderKey, type SnsLevel } from './codes';
import type { DmLike } from './dms';
import { SnsTree, displayCode, type SnsRow, type SnsRowData } from './model';

export type DmInput = Partial<DmLike> & Record<string, unknown>;

export interface DeriveOptions {
  order?: OrderConfig;
  /** A zero code is "this level itself" (default true). */
  collapseZero?: boolean;
  /** 'deepest' (default): hang a partly matched module on its deepest defined ancestor. 'unclassified': only a full match leaves Unclassified. */
  unmatched?: 'deepest' | 'unclassified';
  unclassifiedTitle?: string;
  /** Place only the newest issue of a module (default true). */
  latestOnly?: boolean;
  /** Files (or a predicate) that must not be placed, e.g. generated or consumed front matter. */
  exclude?: readonly string[] | ((dm: DmLike) => boolean);
  /** Place data modules that are not publishable content too (BREX, cross-reference tables, common information repositories). Default false: they are skipped and listed in `skipped`. */
  includeNonContent?: boolean;
}

/** Information codes of data modules that support a publication but are not printed in it. */
export const NON_CONTENT_INFO_CODES: Readonly<Record<string, string>> = {
  '022': 'a BREX data module', '00W': 'an applicability cross-reference table', '00Q': 'a conditions cross-reference table',
  '00P': 'a products cross-reference table', '00L': 'a common information repository',
};

export interface StructDm {
  kind: 'dm';
  file: string;
  dmc: string;
  techName: string;
  infoName: string;
  title: string;
  infoCode: string;
  /** Id of the information-code group ('0xx' ... '9xx') or ''. */
  infoGroup: string;
  dmCode: Record<string, string>;
  identExtension?: Record<string, string>;
  issueInfo?: Record<string, string>;
  language?: Record<string, string>;
  issueDate?: Record<string, string>;
  match: 'full' | 'partial';
  /** The levels the SNS does not define, when the match is partial. */
  missing?: string[];
}

export interface StructModule {
  kind: 'module';
  id: string;
  level: SnsLevel | 'unclassified';
  /** "A05", "A05-4", "A05-40", "A05-40-00" */
  code: string;
  title: string;
  titleSource: 'sns' | 'fixed';
  systemDiffCode: string;
  rowId?: string;
  children: Array<StructModule | StructDm>;
}

export interface Structure {
  roots: StructModule[];
  counts: { dms: number; modules: number; full: number; partial: number; unclassified: number; superseded: number; skipped: number };
  superseded: Array<{ file: string; supersededBy: string }>;
  skipped: Array<{ file: string; reason: string }>;
  warnings: string[];
}

const up = (v: unknown): string => String(v ?? '').trim().toUpperCase();
const LEVEL_NAME: Record<SnsLevel, string> = { system: 'system', subsystem: 'sub-system', subsubsystem: 'sub-sub-system', assy: 'assembly' };

interface Item { dm: DmLike; parts: DmCodeParts; file: string }

function toItem(x: DmInput, index: number): Item | { skip: string } {
  const parts = parseDmCode(x);
  if (!parts) return { skip: 'no readable data module code' };
  const file = String(x.file ?? x.dmc ?? `dm-${index}`);
  const dm = x as unknown as DmLike;
  return { dm: { ...dm, file, dmc: String(x.dmc ?? file) }, parts, file };
}

const issueKey = (d: DmLike): string => `${d.issueNumber ?? ''}-${d.inWork ?? ''}`;

/** Sort-key builders, one per `OrderKey`. */
function keyOf(k: OrderKey, it: Item, cfg: OrderConfig): Array<string | number> {
  const p = it.parts;
  switch (k) {
    case 'sns': return [p.systemCode, p.systemDiffCode, `${p.subSystemCode}${p.subSubSystemCode}`, p.assyCode];
    case 'info': return infoSortKey(p.infoCode, cfg);
    case 'infoVariant': return [p.infoCodeVariant];
    case 'disassy': return [p.disassyCode, p.disassyCodeVariant];
    case 'location': return [p.itemLocationCode];
    case 'language': return [String(it.dm.language ?? '')];
    case 'issue': return [issueKey(it.dm)];
    case 'file': return [it.file];
  }
}

function comparatorFor(cfg: OrderConfig): (a: Item, b: Item) => number {
  const keys = cfg.keys && cfg.keys.length ? cfg.keys : DEFAULT_ORDER_KEYS;
  return (a, b) => {
    for (const k of keys) { const c = compareKeys(keyOf(k, a, cfg), keyOf(k, b, cfg)); if (c) return c; }
    return compareKeys([a.file], [b.file]);                    // total order, whatever the keys: a tie never depends on input order
  };
}

const moduleCode = (r: SnsRowData): string => displayCode(r);

export function deriveStructure(dmList: ReadonlyArray<DmInput>, sns: SnsTree | ReadonlyArray<Partial<SnsRow> & Pick<SnsRowData, 'systemCode' | 'title'>> | null | undefined, options: DeriveOptions = {}): Structure {
  const tree = SnsTree.from(sns);
  const cfg = options.order ?? {};
  const collapseZero = options.collapseZero !== false;
  const policy = options.unmatched ?? 'deepest';
  const latestOnly = options.latestOnly !== false;
  const unclassifiedTitle = options.unclassifiedTitle ?? 'Unclassified';
  const compare = comparatorFor(cfg);

  const skipped: Structure['skipped'] = [];
  const warnings: string[] = [];
  let items: Item[] = [];
  dmList.forEach((x, i) => {
    const it = toItem(x, i);
    if ('skip' in it) { skipped.push({ file: String(x.file ?? x.dmc ?? `#${i + 1}`), reason: it.skip }); return; }
    const what = NON_CONTENT_INFO_CODES[it.parts.infoCode];
    if (what && !options.includeNonContent) skipped.push({ file: it.file, reason: `Information code ${it.parts.infoCode} is ${what}: it supports the publication and is not printed in it.` });
    else items.push(it);
  });

  const ex = options.exclude;
  if (ex) {
    const set = Array.isArray(ex) ? new Set((ex as readonly string[]).map((f) => f.toLowerCase())) : null;
    items = items.filter((it) => !(set ? set.has(it.file.toLowerCase()) : (ex as (dm: DmLike) => boolean)(it.dm)));
  }

  // Newest issue of each module only.
  const superseded: Structure['superseded'] = [];
  if (latestOnly) {
    const best = new Map<string, Item>();
    for (const it of items) {
      const k = `${it.dm.dmc}|${it.dm.language ?? ''}|${JSON.stringify(it.dm.identExtension ?? {})}`;
      const cur = best.get(k);
      if (!cur) { best.set(k, it); continue; }
      const newer = issueKey(it.dm) > issueKey(cur.dm) || (issueKey(it.dm) === issueKey(cur.dm) && it.file < cur.file);
      if (newer) { superseded.push({ file: cur.file, supersededBy: it.file }); best.set(k, it); } else superseded.push({ file: it.file, supersededBy: cur.file });
    }
    const keep = new Set(best.values());
    items = items.filter((it) => keep.has(it));
    superseded.sort((a, b) => compareKeys([a.file], [b.file]));
  }

  // Nodes are created lazily as modules are placed.
  const roots: StructModule[] = [];
  const index = new Map<string, StructModule>();
  const mkModule = (m: Omit<StructModule, 'kind' | 'children'>): StructModule => ({ kind: 'module', ...m, children: [] });
  const getModule = (list: StructModule['children'], m: Omit<StructModule, 'kind' | 'children'>): StructModule => {
    let node = index.get(m.id);
    if (!node) { node = mkModule(m); index.set(m.id, node); list.push(node); }
    return node;
  };
  let unclassified: StructModule | undefined;
  const counts = { dms: 0, modules: 0, full: 0, partial: 0, unclassified: 0, superseded: superseded.length, skipped: skipped.length };

  // Pass 1: which SNS rows each module hangs from (no nodes are created yet, so a module that ends up Unclassified leaves no empty node behind).
  interface Plan { item: Item; chain: Array<{ row: SnsRow; level: SnsLevel }>; match: 'full' | 'partial'; missing: string[] }
  const plans: Plan[] = [];
  for (const it of items) {
    const p = it.parts;
    const sysRow = tree.find(p.systemDiffCode, p.systemCode);
    if (!sysRow) { plans.push({ item: it, chain: [], match: 'partial', missing: ['system'] }); continue; }
    const levels: Array<{ level: SnsLevel; codes: [string, string, string]; zero: boolean }> = [
      { level: 'subsystem', codes: [p.subSystemCode, '', ''], zero: isZeroCode(p.subSystemCode) },
      { level: 'subsubsystem', codes: [p.subSystemCode, p.subSubSystemCode, ''], zero: isZeroCode(p.subSubSystemCode) },
      { level: 'assy', codes: [p.subSystemCode, p.subSubSystemCode, p.assyCode], zero: isZeroCode(p.assyCode) },
    ];
    const chain: Plan['chain'] = [{ row: sysRow, level: 'system' }];
    const missing: string[] = [];
    for (const lv of levels) {
      const row = tree.find(p.systemDiffCode, p.systemCode, lv.codes[0], lv.codes[1], lv.codes[2]);
      if (lv.zero && (collapseZero || !row)) continue;         // a zero code is not a level of its own (unless the SNS says it is and collapsing is off)
      if (!row) { missing.push(`${LEVEL_NAME[lv.level]} ${displayCode({ systemCode: p.systemCode, subSystemCode: lv.codes[0], subSubSystemCode: lv.codes[1], assyCode: lv.codes[2] })}`); continue; }
      chain.push({ row, level: lv.level });
    }
    plans.push({ item: it, chain, match: missing.length ? 'partial' : 'full', missing });
  }

  const mkDm = (it: Item, match: 'full' | 'partial', missing: string[]): StructDm => {
    const d = it.dm;
    const g = infoGroupOf(it.parts.infoCode, cfg.groups);
    return {
      kind: 'dm', file: it.file, dmc: d.dmc, techName: d.techName ?? '', infoName: d.infoName ?? '',
      title: [d.techName, d.infoName].filter(Boolean).join(' - '),
      infoCode: it.parts.infoCode, infoGroup: g ? g.group.id : '',
      dmCode: { ...(d.dmCodeAttrs ?? codeAttrs(it.parts)) },
      identExtension: d.identExtension && Object.keys(d.identExtension).length ? { ...d.identExtension } : undefined,
      issueInfo: d.issueInfoAttrs && Object.keys(d.issueInfoAttrs).length ? { ...d.issueInfoAttrs } : (d.issueNumber ? { issueNumber: d.issueNumber, inWork: d.inWork ?? '00' } : undefined),
      language: d.languageAttrs && Object.keys(d.languageAttrs).length ? { ...d.languageAttrs } : undefined,
      issueDate: d.issueDate && Object.keys(d.issueDate).length ? { ...d.issueDate } : undefined,
      match, ...(missing.length ? { missing } : {}),
    };
  };

  // Pass 2: create the nodes and place the modules, in book order.
  const mkNode = (row: SnsRow, level: SnsLevel, list: StructModule['children']) => getModule(list, {
    id: `${level}:${[row.systemDiffCode, row.systemCode, row.subSystemCode, row.subSubSystemCode, row.assyCode].join('|')}`,
    level, code: moduleCode(row), title: row.title, titleSource: 'sns', systemDiffCode: row.systemDiffCode, rowId: row.id,
  });
  for (const pl of [...plans].sort((a, b) => compare(a.item, b.item))) {
    if (!pl.chain.length || (policy === 'unclassified' && pl.match !== 'full')) {
      unclassified ??= mkModule({ id: 'unclassified', level: 'unclassified', code: '', title: unclassifiedTitle, titleSource: 'fixed', systemDiffCode: '' });
      unclassified.children.push(mkDm(pl.item, 'partial', pl.missing));
      counts.unclassified++;
      continue;
    }
    let list: StructModule['children'] = roots;
    let node: StructModule | undefined;
    for (const step of pl.chain) { node = mkNode(step.row, step.level, list); list = node.children; }
    node!.children.push(mkDm(pl.item, pl.match, pl.missing));
    counts[pl.match]++;
  }

  // Modules before child nodes; child nodes by code. (The modules were pushed in order already; sort the nodes.)
  const finish = (mod: StructModule): void => {
    const dms = mod.children.filter((c): c is StructDm => c.kind === 'dm');
    const mods = mod.children.filter((c): c is StructModule => c.kind === 'module').sort(cmpModule);
    mods.forEach(finish);
    mod.children = [...dms, ...mods];
    counts.modules++;
  };
  roots.sort(cmpModule);
  roots.forEach(finish);
  if (unclassified) { counts.modules++; roots.push(unclassified); warnings.push(`${counts.unclassified} data module${counts.unclassified === 1 ? ' is' : 's are'} not in the SNS and ${counts.unclassified === 1 ? 'was' : 'were'} placed under "${unclassifiedTitle}".`); }
  if (counts.partial) warnings.push(`${counts.partial} data module${counts.partial === 1 ? '' : 's'} name${counts.partial === 1 ? 's' : ''} a sub-level the SNS does not define; ${counts.partial === 1 ? 'it hangs' : 'they hang'} from the nearest defined level.`);
  counts.dms = counts.full + counts.partial + counts.unclassified;
  return { roots, counts, superseded, skipped, warnings };
}

const cmpModule = (a: StructModule, b: StructModule): number => compareKeys([a.code, a.systemDiffCode], [b.code, b.systemDiffCode]);

function codeAttrs(p: DmCodeParts): Record<string, string> {
  return {
    modelIdentCode: p.modelIdentCode, systemDiffCode: p.systemDiffCode, systemCode: p.systemCode, subSystemCode: p.subSystemCode,
    subSubSystemCode: p.subSubSystemCode, assyCode: p.assyCode, disassyCode: p.disassyCode, disassyCodeVariant: p.disassyCodeVariant,
    infoCode: p.infoCode, infoCodeVariant: p.infoCodeVariant, itemLocationCode: p.itemLocationCode,
  };
}

/** Every data module of a structure, in book order. */
export function structureDms(s: Structure): StructDm[] {
  const out: StructDm[] = [];
  const walk = (list: Array<StructModule | StructDm>) => { for (const c of list) { if (c.kind === 'dm') out.push(c); else walk(c.children); } };
  walk(s.roots);
  return out;
}
