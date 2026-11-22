// Pure logic of the Standard Numbering System screens: the rows as a tree, which problem belongs to which row, the form's own checks, what a
// cascade touches, how an import or a learning preview is grouped, the request bodies, and the ordering form. No React and no network here, so all
// of it is unit-tested (sns.test.ts).
//
// The server is the authority on every rule (backend/src/services/sns). The checks here only stop an obviously wrong form from being sent and say
// why; their wording is the server's. A refusal from the server is still shown whenever it comes.

import type {
  DeriveBody, DeriveResult, DerivePlacement, DeriveSource, LearnBody, LearnProposal, MergeSummary, OrderConfig, OrderKey, ProposalStatus, SnsConflict, SnsPresent, SnsLevel,
  SnsNodeView, SnsProblem, SnsRejected, SnsRow, SnsRowData, SnsRules, StructDm, StructModule, Structure, ImportBody,
} from '../api/sns';
import { ApiError } from '../api/client';
import { plural } from './importPackage';

export { plural };

// ── codes ─────────────────────────────────────────────────────────────────

const up = (v: unknown): string => String(v ?? '').trim().toUpperCase();

export const LEVEL_LABEL: Record<SnsLevel, string> = { system: 'System', subsystem: 'Sub-system', subsubsystem: 'Sub-sub-system', assy: 'Assembly' };
export const TITLE_MAX = 255;

/** The S1000D 4.2 patterns the schemas enforce (the same as backend/src/services/sns/codes.ts). The server stays the authority. */
export const CODE_PATTERNS: Record<keyof Omit<SnsRowData, 'title'>, { re: RegExp; text: string; label: string }> = {
  systemDiffCode: { re: /^[A-Z0-9]{1,4}$/, text: '1 to 4 letters or digits', label: 'System difference code' },
  systemCode: { re: /^[A-Z0-9]{2,3}$/, text: '2 or 3 letters or digits', label: 'System code' },
  subSystemCode: { re: /^[A-Z0-9]$/, text: '1 letter or digit', label: 'Sub-system code' },
  subSubSystemCode: { re: /^[A-Z0-9]$/, text: '1 letter or digit', label: 'Sub-sub-system code' },
  assyCode: { re: /^(?:[A-Z0-9]{2}|[A-Z0-9]{4})$/, text: '2 or 4 letters or digits (the S1000D schemas allow exactly 2 or 4, not 3)', label: 'Assembly code' },
};
export const CODE_KEYS = ['systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode'] as const;

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

/** "A05-40-00" for display. The difference code is shown on its own. */
export function displayCode(r: Pick<SnsRowData, 'systemCode' | 'subSystemCode' | 'subSubSystemCode' | 'assyCode'>): string {
  return [r.systemCode, `${r.subSystemCode}${r.subSubSystemCode}`, r.assyCode].filter(Boolean).join('-');
}

export const compareRows = (a: SnsRowData, b: SnsRowData): number => {
  const ka = [a.systemCode, a.systemDiffCode, a.subSystemCode, a.subSubSystemCode, a.assyCode];
  const kb = [b.systemCode, b.systemDiffCode, b.subSystemCode, b.subSubSystemCode, b.assyCode];
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return a.title === b.title ? 0 : a.title < b.title ? -1 : 1;
};
export const sortRows = <T extends SnsRowData>(rows: readonly T[]): T[] => [...rows].sort(compareRows);

// ── the form ──────────────────────────────────────────────────────────────

export type FormErrors = Partial<Record<keyof SnsRowData, string>>;

export const emptyForm = (): SnsRowData => ({ systemDiffCode: '', systemCode: '', subSystemCode: '', subSubSystemCode: '', assyCode: '', title: '' });
export const formFromRow = (r: SnsRowData): SnsRowData => ({
  systemDiffCode: r.systemDiffCode, systemCode: r.systemCode, subSystemCode: r.subSystemCode, subSubSystemCode: r.subSubSystemCode, assyCode: r.assyCode, title: r.title,
});

/** A row at the next level down, with the parent's codes filled in. null for an assembly (nothing hangs below it). */
export function childForm(parent: SnsRowData): { form: SnsRowData; field: keyof SnsRowData } | null {
  const lvl = levelOf(parent);
  const base = { ...formFromRow(parent), title: '' };
  if (lvl === 'system') return { form: base, field: 'subSystemCode' };
  if (lvl === 'subsystem') return { form: base, field: 'subSubSystemCode' };
  if (lvl === 'subsubsystem') return { form: base, field: 'assyCode' };
  return null;
}

/** What is sent: codes trimmed and upper case, the title trimmed and its white space collapsed (the server does the same, so what is shown is what is kept). */
export function rowBody(f: SnsRowData): SnsRowData {
  return {
    systemDiffCode: up(f.systemDiffCode), systemCode: up(f.systemCode), subSystemCode: up(f.subSystemCode), subSubSystemCode: up(f.subSubSystemCode), assyCode: up(f.assyCode),
    // eslint-disable-next-line no-control-regex
    title: String(f.title ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

/** The server's checks (normalizeRow), per field. `rules` is the text the server sent; the built-in text is the fallback. */
export function validateForm(form: SnsRowData, rules?: Partial<SnsRules['codes']>): FormErrors {
  const r = rowBody(form);
  const e: FormErrors = {};
  if (!r.systemCode) e.systemCode = 'System code is required.';
  for (const k of CODE_KEYS) {
    const v = r[k];
    if (v && !CODE_PATTERNS[k].re.test(v)) e[k] = `${CODE_PATTERNS[k].label} "${v}" is not valid: it must be ${rules?.[k] ?? CODE_PATTERNS[k].text}, upper case.`;
  }
  if (r.subSubSystemCode && !r.subSystemCode && !e.subSubSystemCode) e.subSubSystemCode = 'A sub-sub-system code needs a sub-system code.';
  if (r.assyCode && (!r.subSystemCode || !r.subSubSystemCode) && !e.assyCode) e.assyCode = 'An assembly code needs a sub-system code and a sub-sub-system code.';
  if (!r.title) e.title = 'A title is required.';
  else if (r.title.length > TITLE_MAX) e.title = `The title is longer than ${TITLE_MAX} characters.`;
  return e;
}
export const hasErrors = (e: FormErrors): boolean => Object.keys(e).length > 0;

// ── the tree ──────────────────────────────────────────────────────────────

/**
 * The rows as a nested tree (an orphan becomes a root), in canonical order. The same rule as the server's SnsTree.nested(): a row hangs from the row at
 * its parent's exact node, else from the one without a difference code. The organisation defaults come without a tree, so this is the one place it is built.
 */
export function buildTree(rows: readonly SnsRow[]): SnsNodeView[] {
  const sorted = sortRows(rows);
  const byKey = new Map<string, SnsRow>();
  for (const r of sorted) if (!byKey.has(rowKey(r))) byKey.set(rowKey(r), r);       // the first of a duplicate wins
  const find = (diff: string, sys: string, sub = '', subsub = '', assy = ''): SnsRow | undefined =>
    byKey.get([diff, sys, sub, subsub, assy].join('|')) ?? byKey.get(['', sys, sub, subsub, assy].join('|'));
  const nodes = new Map<SnsRow, SnsNodeView>();
  for (const r of sorted) nodes.set(r, { row: r, level: levelOf(r), children: [] });
  const roots: SnsNodeView[] = [];
  for (const [r, n] of nodes) {
    let parent: SnsRow | undefined;
    if (n.level === 'assy') parent = find(r.systemDiffCode, r.systemCode, r.subSystemCode, r.subSubSystemCode);
    else if (n.level === 'subsubsystem') parent = find(r.systemDiffCode, r.systemCode, r.subSystemCode);
    else if (n.level === 'subsystem') parent = find(r.systemDiffCode, r.systemCode);
    const pn = parent && parent !== r ? nodes.get(parent) : undefined;
    (pn ? pn.children : roots).push(n);
  }
  return roots;
}

/**
 * The rows a change to `r`'s code would drag along (or a delete would remove): those below it that carry the row's own difference code. This is the
 * server's rule (store.ts descendants), not the shape of the tree: a diffless child under a difference-coded parent is not counted.
 */
export function descendantsOf(rows: readonly SnsRow[], r: SnsRowData & { id?: string }): SnsRow[] {
  const lvl = levelOf(r);
  if (lvl === 'assy') return [];
  return rows.filter((d) => d.id !== r.id && d.systemDiffCode === r.systemDiffCode && d.systemCode === r.systemCode
    && (lvl === 'system' ? levelOf(d) !== 'system'
      : d.subSystemCode === r.subSystemCode && (lvl === 'subsystem' ? levelOf(d) !== 'subsystem' : d.subSubSystemCode === r.subSubSystemCode && levelOf(d) === 'assy')));
}

/** Does changing a row from `before` to `after` change the node it names (and so need its children to follow)? */
export const changesNode = (before: SnsRowData, after: SnsRowData): boolean => rowKey(before) !== rowKey(after);

export function matchesQuery(r: SnsRowData, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const raw = `${r.systemCode}${r.subSystemCode}${r.subSubSystemCode}${r.assyCode}`;
  return `${displayCode(r)} ${raw} ${r.systemDiffCode} ${r.title}`.toLowerCase().includes(q);
}

export interface FlatNode { node: SnsNodeView; depth: number; hasChildren: boolean; open: boolean; below: number }

/**
 * The rows to show, top to bottom: a node is listed when it is not hidden by a closed parent. With a search text, a row is listed when it matches or
 * something below it does (the path to a match is always open), and the open/closed state is set aside.
 */
export function flattenTree(tree: readonly SnsNodeView[], opts: { open: ReadonlySet<string>; query?: string }): FlatNode[] {
  const q = (opts.query ?? '').trim();
  const below = new Map<SnsNodeView, number>();
  const count = (n: SnsNodeView): number => { let c = 0; for (const k of n.children) c += 1 + count(k); below.set(n, c); return c; };
  const kept = new Map<SnsNodeView, boolean>();
  const keep = (n: SnsNodeView): boolean => {
    let any = !q || matchesQuery(n.row, q);
    for (const k of n.children) if (keep(k)) any = true;
    kept.set(n, any);
    return any;
  };
  const out: FlatNode[] = [];
  const walk = (n: SnsNodeView, depth: number): void => {
    if (!kept.get(n)) return;
    const hasChildren = n.children.length > 0;
    const open = q ? n.children.some((k) => kept.get(k)) : opts.open.has(n.row.id);
    out.push({ node: n, depth, hasChildren, open, below: below.get(n) ?? 0 });
    if (open) for (const k of n.children) walk(k, depth + 1);
  };
  for (const r of tree) { count(r); keep(r); }
  for (const r of tree) walk(r, 0);
  return out;
}

/** Every row that has rows below it. */
export function parentIds(tree: readonly SnsNodeView[]): Set<string> {
  const ids = new Set<string>();
  const walk = (n: SnsNodeView) => { if (n.children.length) ids.add(n.row.id); n.children.forEach(walk); };
  tree.forEach(walk);
  return ids;
}

/** A short SNS opens fully; a long one (thousands of rows) opens at its systems only. */
export const OPEN_ALL_UP_TO = 150;
export const initialOpen = (tree: readonly SnsNodeView[], total: number): Set<string> => (total <= OPEN_ALL_UP_TO ? parentIds(tree) : new Set());

// ── problems ──────────────────────────────────────────────────────────────

/** The problems that name a row, by row id. A problem that names two rows (a duplicate) is listed under both. */
export function problemsByRow(problems: readonly SnsProblem[]): Map<string, SnsProblem[]> {
  const m = new Map<string, SnsProblem[]>();
  for (const p of problems) for (const id of p.rowIds) m.set(id, [...(m.get(id) ?? []), p]);
  return m;
}

export interface ProblemSummary { errors: number; warnings: number; duplicates: number; orphans: number; invalid: number; unlocated: number; text: string }

export function summariseProblems(problems: readonly SnsProblem[]): ProblemSummary {
  const n = (f: (p: SnsProblem) => boolean) => problems.filter(f).length;
  const errors = n((p) => p.severity === 'error');
  const warnings = n((p) => p.severity === 'warn');
  const parts = [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean);
  return {
    errors, warnings, duplicates: n((p) => p.code === 'DUPLICATE'), orphans: n((p) => p.code === 'ORPHAN'), invalid: n((p) => p.code === 'INVALID'),
    unlocated: n((p) => p.rowIds.length === 0), text: parts.join(' and ') || 'No problems',
  };
}

/** The worst first, then in the order the server gave them. */
export const orderProblems = (problems: readonly SnsProblem[]): SnsProblem[] =>
  [...problems].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));

export const PROBLEM_LABEL: Record<SnsProblem['code'], string> = { DUPLICATE: 'Defined twice', ORPHAN: 'No parent', INVALID: 'Not valid' };

// ── imports ───────────────────────────────────────────────────────────────

export const importBody = (apply: boolean, overwrite: boolean): ImportBody => ({ apply, overwrite });

export interface MergeView {
  /** rows that are new, in code order */
  add: SnsRow[];
  /** how many rows are already there with the same title */
  same: number;
  /** those rows, in code order (empty when the server only sent the count) */
  present: SnsPresent[];
  /** already there with another title: kept, or replaced when `overwrite` */
  differs: SnsConflict[];
  /** how many of `differs` differ only in capital letters */
  caseOnly: number;
  rejected: SnsRejected[];
  /** titles that will be replaced: only when overwrite is on */
  replace: number;
  willChange: number;
  canApply: boolean;
}

export function groupMerge(r: MergeSummary, overwrite: boolean): MergeView {
  const add = sortRows(r.added);
  const differs = [...r.conflicts].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const replace = overwrite ? differs.length : 0;
  const present = [...(r.present ?? [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { add, same: r.same, present, differs, caseOnly: differs.filter((c) => c.caseOnly).length, rejected: r.rejected, replace, willChange: add.length + replace, canApply: add.length + replace > 0 };
}

/** What an applied merge did, in a sentence. */
export function mergeOutcome(r: MergeSummary): string {
  const replaced = r.conflicts.filter((c) => c.overwritten).length;
  const kept = r.conflicts.length - replaced;
  const parts = [`Added ${plural(r.added.length, 'row')}`];
  if (replaced) parts.push(`replaced ${plural(replaced, 'title')}`);
  if (kept) parts.push(`kept ${plural(kept, 'different title')}`);
  if (r.rejected.length) parts.push(`${plural(r.rejected.length, 'entry', 'entries')} not valid`);
  return `${parts.join(', ')}.`;
}

// ── learning ──────────────────────────────────────────────────────────────

export const DEFAULT_MIN_CONFIDENCE = 0.5;
export type StatusFilter = ProposalStatus | 'all';

export const STATUS_LABEL: Record<ProposalStatus, string> = { new: 'New', exists: 'Already present', conflict: 'Differs (kept)' };

export const pct = (c: number): number => Math.round(Math.min(1, Math.max(0, c)) * 100);

/** The threshold box takes a percentage. Anything that is not a number falls back to `fallback`; the result is 0..1. */
export function parseThreshold(text: string, fallback = DEFAULT_MIN_CONFIDENCE): number {
  const n = Number(text.trim().replace('%', ''));
  if (text.trim() === '' || !Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n / 100));
}

export const confidenceTone = (c: number): 'ok' | 'warn' | 'bad' => (c >= 0.8 ? 'ok' : c >= 0.5 ? 'warn' : 'bad');

/** A proposal can be accepted when it is new and has a title (the server refuses an empty one). */
export const isAcceptable = (p: LearnProposal): boolean => p.status === 'new' && p.row.title.trim() !== '';

export function visibleProposals(ps: readonly LearnProposal[], o: { minConfidence: number; status: StatusFilter }): LearnProposal[] {
  return ps.filter((p) => p.confidence >= o.minConfidence && (o.status === 'all' || p.status === o.status));
}
/** How many of the proposals in the chosen status the threshold hides. */
export const hiddenByThreshold = (ps: readonly LearnProposal[], o: { minConfidence: number; status: StatusFilter }): number =>
  ps.filter((p) => (o.status === 'all' || p.status === o.status) && p.confidence < o.minConfidence).length;

/**
 * The keys to send: what is ticked AND still shown AND can be accepted. A row ticked and then filtered out by a higher threshold is not sent, so what
 * the person sees ticked is exactly what is applied.
 */
export function acceptedKeys(visible: readonly LearnProposal[], ticked: ReadonlySet<string>): string[] {
  return visible.filter((p) => isAcceptable(p) && ticked.has(p.key)).map((p) => p.key);
}

export const learnPreviewBody = (): LearnBody => ({ apply: false });
/** Always an explicit list of keys: never `acceptAll`. */
export const learnApplyBody = (keys: readonly string[], minConfidence: number): LearnBody => ({ apply: true, accept: [...keys], minConfidence });

// ── deriving ──────────────────────────────────────────────────────────────

export interface DeriveOptions {
  sns: DeriveSource; placement: DerivePlacement; unmatched: 'deepest' | 'unclassified'; unclassifiedTitle: string; titleFormat: 'title' | 'code-title';
  collapseZero: boolean; excludeFrontMatter: boolean; pmTitle: string;
}
export const DEFAULT_DERIVE: DeriveOptions = {
  sns: 'project', placement: 'replace', unmatched: 'deepest', unclassifiedTitle: 'Unclassified', titleFormat: 'title', collapseZero: true, excludeFrontMatter: true, pmTitle: '',
};

export const SOURCE_LABEL: Record<DeriveSource, string> = {
  project: 'This project\'s own rows', defaults: 'The organisation defaults', merged: 'Both: the project\'s rows, plus the defaults for what it lacks',
};

export function deriveBody(o: DeriveOptions, apply: boolean): DeriveBody {
  const b: DeriveBody = {
    sns: o.sns, apply, collapseZero: o.collapseZero, unmatched: o.unmatched, excludeFrontMatter: o.excludeFrontMatter, placement: o.placement,
  };
  if (o.unclassifiedTitle.trim()) b.unclassifiedTitle = o.unclassifiedTitle.trim();
  if (o.titleFormat === 'code-title') b.titleFormat = 'code-title';
  if (o.pmTitle.trim()) b.pmTitle = o.pmTitle.trim();
  return b;
}

/** A preview is only good for the options it was made with. */
export const deriveSignature = (o: DeriveOptions): string => JSON.stringify(deriveBody(o, false));

/** What the confirmation says before the publication structure is written. */
export function deriveConfirmation(o: DeriveOptions, r: DeriveResult): { title: string; lines: string[] } {
  const lines: string[] = [];
  if (o.placement === 'replace') {
    lines.push(`The publication structure of this project is REPLACED by the one in the preview: ${plural(r.pm.entries, 'entry', 'entries')} for ${plural(r.structure.counts.dms, 'data module')}.`);
    lines.push('Chapters, their order and their titles as they are arranged on the Publication page are not kept. The previous publication module is saved as a backup file next to it, which the next apply overwrites.');
  } else {
    lines.push(`The publication structure is EXTENDED: the ${plural(r.structure.counts.dms, 'data module')} that no chapter places yet are appended after what is there (${plural(r.pm.entries, 'entry', 'entries')} in all).`);
    lines.push('What the publication already holds is not changed. The previous publication module is saved as a backup file next to it, which the next apply overwrites.');
  }
  lines.push(r.pm.headerFrom === 'existing' ? 'The publication\'s title and codes are kept.' : 'The project has no publication module yet: one is created with a generated header.');
  return { title: 'Change the publication structure?', lines };
}

/** Data modules at or below a node (memoised: a preview can hold thousands). */
const dmCounts = new WeakMap<StructModule, number>();
export function countDms(n: StructModule | StructDm): number {
  if (n.kind === 'dm') return 1;
  const hit = dmCounts.get(n);
  if (hit !== undefined) return hit;
  let c = 0;
  for (const k of n.children) c += countDms(k);
  dmCounts.set(n, c);
  return c;
}

export const levelName = (l: StructModule['level']): string => (l === 'unclassified' ? 'Unclassified' : LEVEL_LABEL[l]);

export function structureTiles(s: Structure, r: Pick<DeriveResult, 'snsRows' | 'pm'>): Array<{ key: string; label: string; value: number }> {
  const all = [
    { key: 'dms', label: 'Data modules placed', value: s.counts.dms },
    { key: 'modules', label: 'Chapters', value: s.counts.modules },
    { key: 'full', label: 'Fully matched', value: s.counts.full },
    { key: 'partial', label: 'Partly matched', value: s.counts.partial },
    { key: 'unclassified', label: 'Unclassified', value: s.counts.unclassified },
    { key: 'superseded', label: 'Older issues left out', value: s.counts.superseded },
    { key: 'skipped', label: 'Skipped', value: s.counts.skipped },
    { key: 'rows', label: 'SNS rows used', value: r.snsRows },
    { key: 'entries', label: 'Publication entries', value: r.pm.entries },
  ];
  return all.filter((t) => ['dms', 'rows', 'entries'].includes(t.key) || t.value > 0);
}

// ── ordering ──────────────────────────────────────────────────────────────

export const ORDER_KEYS: readonly OrderKey[] = ['sns', 'info', 'infoVariant', 'disassy', 'location', 'language', 'issue', 'file'];
export const ORDER_KEY_LABEL: Record<OrderKey, string> = {
  sns: 'SNS code (system, sub-system, assembly)', info: 'Information code, by its group', infoVariant: 'Information code variant', disassy: 'Disassembly code',
  location: 'Item location code', language: 'Language', issue: 'Issue and in-work number', file: 'File name',
};

export interface OrderForm { keys: OrderKey[]; pinFirst: string; pinLast: string; rank: string }

const INFO_CODE = /^[A-Z0-9]{3}$/;

/** "720, 018" -> ['720', '018'] with a message for anything that is not a three-character information code. Repeats are dropped. */
export function parseCodeList(text: string): { codes: string[]; errors: string[] } {
  const codes: string[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const c = raw.toUpperCase();
    if (!INFO_CODE.test(c)) errors.push(`"${raw}" is not an information code (3 letters or digits).`);
    else if (!codes.includes(c)) codes.push(c);
  }
  return { codes, errors };
}

/** Lines such as `018 = -1` (an information code, a rank; lower sorts earlier). */
export function parseRankLines(text: string): { rank: Record<string, number>; errors: string[] } {
  const rank: Record<string, number> = {};
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const m = /^\s*([A-Za-z0-9]{3})\s*[=:]\s*(-?\d{1,6})\s*$/.exec(line);
    if (!m) { errors.push(`Line ${i + 1}: write an information code, "=", and a whole number, for example 018 = -1.`); return; }
    rank[m[1].toUpperCase()] = Number(m[2]);
  });
  return { rank, errors };
}

export const formatRank = (rank: Record<string, number> | undefined): string => Object.entries(rank ?? {}).map(([k, v]) => `${k} = ${v}`).join('\n');

export function orderFormFrom(info: { keys: readonly OrderKey[]; override: OrderConfig | null }): OrderForm {
  const o = info.override;
  return { keys: [...(o?.keys?.length ? o.keys : info.keys)], pinFirst: (o?.pinFirst ?? []).join(', '), pinLast: (o?.pinLast ?? []).join(', '), rank: formatRank(o?.rank) };
}

/**
 * The override to save, or null when the form equals the defaults (the override is then removed). A group table the project already has is carried
 * over untouched: it is not edited here. Anything the server would sort wrongly or fail on is reported instead.
 */
export function buildOrder(form: OrderForm, defaults: readonly OrderKey[], existing: OrderConfig | null): { order: OrderConfig | null; errors: string[] } {
  const errors: string[] = [];
  const first = parseCodeList(form.pinFirst);
  const last = parseCodeList(form.pinLast);
  const ranks = parseRankLines(form.rank);
  errors.push(...first.errors.map((e) => `Pinned first: ${e}`), ...last.errors.map((e) => `Pinned last: ${e}`), ...ranks.errors);
  const both = first.codes.filter((c) => last.codes.includes(c));
  if (both.length) errors.push(`${both.join(', ')} cannot be pinned both first and last.`);
  if (form.keys.some((k) => !ORDER_KEYS.includes(k)) || new Set(form.keys).size !== form.keys.length) errors.push('The sort keys must each appear once.');
  if (errors.length) return { order: null, errors };
  const out: OrderConfig = {};
  if (existing?.groups?.length) out.groups = existing.groups;
  if (form.keys.length !== defaults.length || form.keys.some((k, i) => k !== defaults[i])) out.keys = [...form.keys];
  if (first.codes.length) out.pinFirst = first.codes;
  if (last.codes.length) out.pinLast = last.codes;
  if (Object.keys(ranks.rank).length) out.rank = ranks.rank;
  return { order: Object.keys(out).length ? out : null, errors };
}

/** Move the sort key at `index` one place (`-1` earlier, `+1` later); at an end it stays where it is. */
export function moveKey(keys: readonly OrderKey[], index: number, by: -1 | 1): OrderKey[] {
  const to = index + by;
  if (index < 0 || index >= keys.length || to < 0 || to >= keys.length) return [...keys];
  const next = [...keys];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// ── what to open, and what the server said ─────────────────────────────────

/** The ids of the rows above `id`, nearest last (so each can be opened to reveal it). Empty when `id` is a root or unknown. */
export function ancestorIds(tree: readonly SnsNodeView[], id: string): string[] {
  const walk = (nodes: readonly SnsNodeView[], trail: string[]): string[] | null => {
    for (const n of nodes) {
      if (n.row.id === id) return trail;
      const hit = walk(n.children, [...trail, n.row.id]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree, []) ?? [];
}

/** Every line of a refusal: the server lists all the problems of a row in `errors`; any other error is its message. */
export function errorLines(e: unknown): string[] {
  if (e instanceof ApiError) {
    const list = (e.body as { errors?: unknown } | undefined)?.errors;
    if (Array.isArray(list) && list.length) return list.map(String);
  }
  return [e instanceof Error ? e.message : String(e)];
}

/** How many rows the server says sit below a row, when it refused a change or a delete for that reason (409 SNS_HAS_CHILDREN); otherwise null. */
export function childrenRefused(e: unknown): number | null {
  if (!(e instanceof ApiError) || e.status !== 409 || e.code !== 'SNS_HAS_CHILDREN') return null;
  const n = (e.body as { children?: unknown } | undefined)?.children;
  return typeof n === 'number' ? n : 0;
}

/** A readable list of at most `max` codes: "A05-40, A05-41 and 3 more". */
export function sampleCodes(rows: readonly SnsRowData[], max = 5): string {
  const codes = sortRows(rows).map((r) => displayCode(r) + (r.systemDiffCode ? ` (${r.systemDiffCode})` : ''));
  if (codes.length <= max) return codes.length > 1 ? `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}` : codes.join('');
  return `${codes.slice(0, max).join(', ')} and ${codes.length - max} more`;
}

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canon(x)]))
  : v);

/** Two overrides that say the same thing, whatever order their fields were written in. null (no override) equals only null. */
export const sameOrder = (a: OrderConfig | null | undefined, b: OrderConfig | null | undefined): boolean => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
