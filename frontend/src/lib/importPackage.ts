// Pure logic of the "Import package" dialog: what was picked, how a report and a change log are summarised so that
// a 700-file package stays readable, how long lists are capped, and how a place for unassigned modules is chosen.
// No React and no network here, so all of it is unit-tested (importPackage.test.ts).

import type {
  AssignBody, ImportChange, ImportFinding, ImportOptions, ImportReport, ImportRule, ImportSeverity, PoolModule, ReportRuleId, RepairRuleId, Unassigned,
} from '../api/importer';

/** What the server accepts in one request (backend/src/routes/importer.ts). */
export const PACKAGE_MAX_FILES = 5000;
export const PACKAGE_MAX_BYTES = 1024 * 1024 * 1024;

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// ── what the person picked ────────────────────────────────────────────────

export type PickSource = 'files' | 'folder' | 'zip';
export interface PickedFile { file: File; /** the path the server should see: the folder-relative path of a picked folder, else the file name */ path: string }
export interface Selection { source: PickSource; picks: PickedFile[]; bytes: number; zips: number; folderName: string }

const slash = (p: string): string => p.replace(/\\/g, '/').replace(/^\.?\//, '');

/** `files` as the browser's pickers give them. A folder pick carries `webkitRelativePath` (`Package/XML/DMC-….xml`), which is kept. */
export function makeSelection(files: File[], source: PickSource): Selection {
  const picks = files.map((file): PickedFile => {
    const rel = source === 'folder' ? (file as File & { webkitRelativePath?: string }).webkitRelativePath : '';
    return { file, path: slash(rel || file.name) };
  });
  const first = picks[0]?.path.split('/')[0] ?? '';
  return {
    source, picks, bytes: picks.reduce((n, p) => n + p.file.size, 0),
    zips: picks.filter((p) => /\.zip$/i.test(p.file.name)).length,
    folderName: source === 'folder' && picks.some((p) => p.path.includes('/')) ? first : '',
  };
}

/** Why this selection cannot be sent, or null. The limits are the server's: it says the same, but only after the upload. */
export function selectionProblem(sel: Selection | null): string | null {
  if (!sel || sel.picks.length === 0) return 'Choose the package first: files, a folder or a .zip.';
  if (sel.picks.length > PACKAGE_MAX_FILES) return `One import takes at most ${PACKAGE_MAX_FILES} files (you chose ${sel.picks.length}). Send the package as a .zip instead.`;
  if (sel.bytes > PACKAGE_MAX_BYTES) return `One import takes at most ${Math.round(PACKAGE_MAX_BYTES / 1048576)} MB (you chose ${(sel.bytes / 1048576).toFixed(0)} MB). Import it in parts.`;
  return null;
}

/** A line saying what is selected: "712 files in the folder Xignal (38.4 MB)". */
export function describeSelection(sel: Selection, fmtSize: (n: number) => string): string {
  const n = sel.picks.length;
  const where = sel.source === 'zip' || (sel.zips > 0 && sel.zips === n) ? (n === 1 ? ' (a zip)' : ' (zips)') : sel.folderName ? ` in the folder ${sel.folderName}` : '';
  return `${plural(n, 'file')}${where}, ${fmtSize(sel.bytes)}`;
}

/** The multipart body for scan and apply. `paths` runs parallel to `files` and is sent only when some path differs from the file's own name. */
export function buildPackageForm(sel: Selection, options?: ImportOptions): FormData {
  const fd = new FormData();
  for (const p of sel.picks) fd.append('files', p.file, p.file.name);
  if (sel.picks.some((p) => p.path !== p.file.name)) fd.append('paths', JSON.stringify(sel.picks.map((p) => p.path)));
  if (options && Object.keys(options).length) fd.append('options', JSON.stringify(options));
  return fd;
}

// ── the report ────────────────────────────────────────────────────────────

/** The numbers worth a tile; zero ones are left out except the modules. */
export function countTiles(c: ImportReport['counts']): Array<{ key: string; label: string; value: number }> {
  const all = [
    { key: 'dms', label: 'Data modules', value: c.dms },
    { key: 'brex', label: 'BREX modules', value: c.brex },
    { key: 'pmcs', label: 'Publications', value: c.pmcs },
    { key: 'icns', label: 'Graphics (ICN)', value: c.icns },
    { key: 'images', label: 'Other images', value: c.images },
    { key: 'other', label: 'Other files', value: c.other },
    { key: 'ignored', label: 'Ignored files', value: c.ignored },
  ];
  return all.filter((t) => t.key === 'dms' || t.value > 0);
}

export const FLAVOUR_LABEL: Record<string, string> = {
  'xignal-s1000d': 'Xignal / Docuneering (S1000D)', 'xignal-jss': 'Xignal / Docuneering (JSS)', vektra: 'Vektra', 'generic-s1000d': 'Generic S1000D',
};
export const flavourLabel = (id: string): string => FLAVOUR_LABEL[id] ?? id;

const SEVERITY_ORDER: Record<ImportSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Plain names of the importer's finding ids (backend/src/services/importer). An id this table does not know is shown as it is. */
const FINDING_LABEL: Record<string, string> = {
  'package-load': 'The package could not be read completely', 'no-data-modules': 'No data modules in the package', encoding: 'File is not UTF-8',
  'xml-unsafe': 'Unsafe XML', 'xml-malformed': 'Not well-formed XML', 'dm-no-identity': 'Module without a readable code', 'dm-file-name': 'File not named DMC-<code>.xml',
  'dm-name-mismatch': 'File name does not match the module code', 'dm-duplicate': 'Same data module twice',
  'table-cols-missing': 'Table without a column count', 'table-cols-overflow': 'Table rows wider than its column count', 'table-colspec-count': 'Table column specifications do not match its column count',
  'table-cols-wider': 'Table declares more columns than any row uses', 'entity-external-target': 'Graphic entity points outside the package', 'icn-missing': 'Graphic declared but not in the package',
  'brex-wrong-default': 'BREX of another S1000D issue', 'brex-missing-custom': 'BREX that is not in the package',
  'pmc-unreadable': 'Publication module could not be read', 'pmc-unmodelled': 'Publication content the importer does not model', 'pmc-placeholder': 'Publication module is an unfilled template',
  'pmc-language': 'Publication language differs from its modules', 'pmc-dmref-language': 'Publication reference names the wrong language', 'pmc-dmref-issue': 'Publication reference names another issue',
  'pmc-title-mismatch': 'Publication titles differ from the modules', 'pmc-missing-dmref': 'Modules named by the publication are not in the package', 'pmc-generated-front-matter': 'Front-matter entries the exporting tool generates',
  'subpub-anchor-only': 'Sub-publication delivered as its title page only', 'subpub-unresolved': 'Sub-publication that cannot be found', 'dm-orphans': 'Modules no publication places',
};
export const findingLabel = (id: string): string => FINDING_LABEL[id] ?? id;

export interface FindingGroup {
  id: string; severity: ImportSeverity; rule: ReportRuleId; repairable: boolean;
  /** the first message of the group (the same for every item but for the names in it) */
  message: string; count: number; files: string[]; items: ImportFinding[];
}

/** One group per finding id and severity, the worst first, then the biggest. */
export function groupFindings(findings: ImportFinding[]): FindingGroup[] {
  const map = new Map<string, FindingGroup>();
  for (const f of findings) {
    const key = `${f.severity}|${f.id}|${f.repairable ? 1 : 0}`;
    let g = map.get(key);
    if (!g) { g = { id: f.id, severity: f.severity, rule: f.rule, repairable: !!f.repairable, message: f.message, count: 0, files: [], items: [] }; map.set(key, g); }
    g.count++; g.items.push(f);
    if (f.file && !g.files.includes(f.file)) g.files.push(f.file);
  }
  return [...map.values()].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.count - a.count || a.id.localeCompare(b.id));
}

export interface FindingBuckets { repaired: FindingGroup[]; reportOnly: FindingGroup[]; info: FindingGroup[] }

/**
 * What the importer will repair, what it only reports (and so needs a person), and what is for information.
 * A finding the enabled rules fix counts as repaired whatever its severity; the rest is split by severity.
 */
export function bucketFindings(findings: ImportFinding[]): FindingBuckets {
  const fixed = findings.filter((f) => f.repairable);
  const rest = findings.filter((f) => !f.repairable);
  return {
    repaired: groupFindings(fixed),
    reportOnly: groupFindings(rest.filter((f) => f.severity !== 'info')),
    info: groupFindings(rest.filter((f) => f.severity === 'info')),
  };
}

/** Errors the importer cannot repair: the import will probably be refused until they are dealt with. */
export const blockingFindings = (findings: ImportFinding[]): ImportFinding[] => findings.filter((f) => f.severity === 'error' && !f.repairable);

/** The repair rules that are on, as the server's defaults (`defaultOn`) say. */
export const defaultRepairs = (rules: ImportRule[]): RepairRuleId[] => rules.filter((r) => r.defaultOn).map((r) => r.id);

/** What each rule would do, joined with its title and description; rules the scan did not mention are still listed. */
export function repairRows(rules: ImportRule[], plan: ImportReport['repairPlan']): Array<ImportRule & { items: number; files: number }> {
  const by = new Map(plan.map((p) => [p.rule as string, p]));
  return rules.map((r) => ({ ...r, items: by.get(r.id)?.items ?? 0, files: by.get(r.id)?.files ?? 0 }));
}

/** Options for scan and apply. Only what differs from the server's defaults is sent, so the server stays the one place that knows them. */
export interface ImportChoices { repairs: RepairRuleId[]; defaults: RepairRuleId[]; overwrite: boolean; publication: 'auto' | 'replace' | 'keep'; neutraliseMissingBrex: boolean }
export function importOptions(sel: ImportChoices, forApply: boolean): ImportOptions {
  const out: ImportOptions = {};
  const same = sel.repairs.length === sel.defaults.length && sel.repairs.every((r) => sel.defaults.includes(r));
  if (!same) out.repairs = sel.repairs;
  if (sel.neutraliseMissingBrex) out.neutraliseMissingBrex = true;
  if (forApply) {
    if (sel.overwrite) out.overwrite = true;
    if (sel.publication !== 'auto') out.publication = sel.publication;
  }
  return out;
}

// ── the change log ────────────────────────────────────────────────────────

export interface ChangeRuleGroup {
  rule: ReportRuleId; title: string; total: number; edits: number; adds: number; notes: number; synthetic: number;
  files: Array<{ file: string; entries: ImportChange[] }>;
}

const RULE_ORDER: ReportRuleId[] = ['table-cols', 'icn-placeholder', 'brex-remap', 'pmc-dmref-identity', 'pmc-titles', 'pmc-reconstruct', 'orphans-pool', 'pmc-missing-dmref', 'pmc-language', 'subpub', 'package'];

/** The change log by rule, and inside each rule by file, so 400 table fixes read as one line with a list behind it. */
/** Rules that write to the change log but are not one of the repairs a person can switch off. */
const EXTRA_RULE_TITLE: Record<string, string> = { 'orphans-pool': 'Modules no publication places, kept in the unassigned list' };

export function groupChangeLog(log: ImportChange[], rules: ImportRule[]): ChangeRuleGroup[] {
  const title = new Map<string, string>([...Object.entries(EXTRA_RULE_TITLE), ...rules.map((r): [string, string] => [r.id, r.title])]);
  const byRule = new Map<ReportRuleId, Map<string, ImportChange[]>>();
  for (const c of log) {
    const files = byRule.get(c.rule) ?? new Map<string, ImportChange[]>();
    files.set(c.file, [...(files.get(c.file) ?? []), c]);
    byRule.set(c.rule, files);
  }
  const rank = (r: ReportRuleId): number => { const i = RULE_ORDER.indexOf(r); return i < 0 ? RULE_ORDER.length : i; };
  return [...byRule.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([rule, files]) => {
    const all = [...files.values()].flat();
    return {
      rule, title: title.get(rule) ?? rule, total: all.length,
      edits: all.filter((c) => c.kind === 'edit').length, adds: all.filter((c) => c.kind === 'add').length, notes: all.filter((c) => c.kind === 'note').length,
      synthetic: all.filter((c) => c.synthetic).length,
      files: [...files.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([file, entries]) => ({ file, entries })),
    };
  });
}

/** A before/after text cut to a length that fits a line; the cut is marked. */
export const truncate = (text: string, max = 160): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

export const baseName = (p: string): string => p.replace(/\\/g, '/').replace(/^.*\//, '');

// ── long lists ────────────────────────────────────────────────────────────

/** The first `shown` of a list, and how many are held back. */
export function cap<T>(items: readonly T[], shown: number): { items: T[]; hidden: number } {
  const n = Math.max(0, shown);
  return { items: items.slice(0, n), hidden: Math.max(0, items.length - n) };
}

/** How many to show after "show more": a page at a time, never past the end. */
export const showMore = (shown: number, total: number, page: number): number => Math.min(total, shown + page);

/** Case-insensitive filter over several text parts of each item. */
export function filterBy<T>(items: readonly T[], q: string, text: (t: T) => string): T[] {
  const needle = q.trim().toLowerCase();
  return needle ? items.filter((t) => text(t).toLowerCase().includes(needle)) : [...items];
}

// ── placing the unassigned modules ────────────────────────────────────────

export type Destination = { kind: 'root' } | { kind: 'folder'; path: number[] } | { kind: 'sub'; pmCode: string };

export interface DestinationOption { value: string; label: string; dest: Destination }

/** The places the server offers, as a flat list for one dropdown: the top of the publication, every chapter, every sub-publication. */
export function destinationOptions(u: Pick<Unassigned, 'targets' | 'subPublications'>): DestinationOption[] {
  const out: DestinationOption[] = [{ value: 'root', label: 'Top level of the publication', dest: { kind: 'root' } }];
  const bareRefs = new Set<string>();
  for (const t of u.targets) {
    if (t.kind === 'folder') {
      out.push({ value: `f:${t.path.join('.')}`, label: `${' '.repeat(Math.max(0, t.depth))}${t.title || 'Untitled chapter'} (${plural(t.modules, 'module')})`, dest: { kind: 'folder', path: t.path } });
    } else if (t.pmCode) {
      bareRefs.add(t.pmCode);
      out.push({ value: `s:${t.pmCode}`, label: `${' '.repeat(Math.max(0, t.depth))}Sub-publication ${t.title ? `"${t.title}" ` : ''}(${t.pmCode}): becomes a chapter, title page first`, dest: { kind: 'sub', pmCode: t.pmCode } });
    }
  }
  // A sub-publication that was turned into a chapter by an earlier step is found again by its title, so it stays addressable by its code.
  for (const s of u.subPublications) {
    if (s.materialisedAs && !bareRefs.has(s.pmCode)) out.push({ value: `s:${s.pmCode}`, label: `Sub-publication "${s.materialisedAs}" (${s.pmCode}): add to its chapter`, dest: { kind: 'sub', pmCode: s.pmCode } });
  }
  return out;
}

export function parseDestination(value: string, options: DestinationOption[]): Destination {
  return options.find((o) => o.value === value)?.dest ?? { kind: 'root' };
}

/** The request body for `assign`. A new chapter is made inside the chosen place and the modules go into it. */
export function buildAssignBody(files: string[], dest: Destination, o: { newFolder?: string; position?: 'start' | 'end' } = {}): AssignBody {
  const to: AssignBody['to'] = {};
  if (dest.kind === 'folder') to.folderPath = dest.path;
  else if (dest.kind === 'sub') to.subPublication = dest.pmCode;
  else to.folderPath = [];
  const nf = o.newFolder?.trim();
  if (nf) to.newFolder = nf;
  if (o.position === 'start') to.position = 'start';
  return { files, to };
}

/** The pool by SNS-style group, so a long pool reads as sections. Modules with no group share one section. */
export function groupPool(pool: readonly PoolModule[]): Array<{ group: string; items: PoolModule[] }> {
  const map = new Map<string, PoolModule[]>();
  for (const p of pool) map.set(p.group || '', [...(map.get(p.group || '') ?? []), p]);
  return [...map.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0]))).map(([group, items]) => ({ group, items }));
}

export const POOL_REASON: Record<string, string> = {
  'not-in-any-pmc': 'No publication in the package places it',
  'sub-publication-not-in-package': 'Belongs to a sub-publication whose own publication was not delivered',
  'imported-into-existing-publication': 'Imported into a project that already had a publication',
};
export const poolReason = (r: string): string => POOL_REASON[r] ?? r;
