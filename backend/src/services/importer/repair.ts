// =============================================================================
// The repair pipeline: package in, repaired COPIES + change log out. Pure - it touches no file and no database.
//
// Order matters and is fixed:
//   1. data modules    table-cols, icn-placeholder, brex-remap       (text edits on each module)
//   2. publication(s)  pmc-dmref-identity, pmc-titles, brex-remap, then pmc-reconstruct for a template PMC
//   3. no usable PMC?  pmc-reconstruct synthesises one from the modules
//   4. structure       nest sub-PMCs, find anchors, pool the orphans, count reuse (+ optionally assemble the pool)
//
// Idempotence: every rule's trigger is a defect, and its edit removes that defect, so a second run over the
// repaired output finds nothing to do. (The pool is a state, not an edit: it stays listed, as notes.)
// =============================================================================

import { placeholderPng } from './png';
import { schemaIssueOf, isPlaceholderPmCode } from './identity';
import { parsePmComplete } from './pmComplete';
import { RECONSTRUCTED_MARKER, type DmRec, type Package } from './package';
import { repairTables } from './repairs/tables';
import { fileIndex, repairIcn, type MissingIcn } from './repairs/icn';
import { repairBrex } from './repairs/brex';
import { dmIndex, repairPmcRefs } from './repairs/pmc';
import { deriveMeta, groupByHierarchy, pmcFileName, synthesiseEntries, synthesisePmText } from './reconstruct';
import { assembleStructure, viewOf, countModuleEntries, type PmcView } from './structure';
import type { AssembledPublication, ChangeEntry, PackageEntry, PmEntry, PmModel, RepairOptions, RepairResult, RepairRuleId, RuleInfo } from './types';
import { REPAIR_RULES } from './types';

export const RULES: RuleInfo[] = [
  { id: 'table-cols', title: 'Fix table column counts', defaultOn: true, description: 'Sets tgroup@cols to the widest row and generates or trims colspec elements so the PDF build (FOP) does not fail on overflowing cells.' },
  { id: 'icn-placeholder', title: 'Placeholder for missing graphics', defaultOn: true, description: 'Writes a labelled placeholder PNG for every graphic a module declares but the package does not ship, so the build never breaks. Each one is logged and flagged.' },
  { id: 'brex-remap', title: 'Re-point the BREX reference', defaultOn: true, description: 'Changes a default-BREX reference of another S1000D issue to the default of the issue the module declares, consistently across the package. Never removes a reference.' },
  { id: 'pmc-reconstruct', title: 'Rebuild a placeholder or missing publication module', defaultOn: true, description: 'Synthesises the publication header (and, when there is no structure, the structure) from data module metadata. The result is marked reconstructed.' },
  { id: 'pmc-titles', title: 'Publication titles follow the data modules', defaultOn: true, description: 'Corrects the dmTitle copy in each dmRef to the module\'s own; keeps the PMC\'s old wording as the entry title when the modules\' titles do not tell them apart.' },
  { id: 'pmc-dmref-identity', title: 'Publication references follow the data modules', defaultOn: true, description: 'Corrects language/country and issue in each dmRef to those of the module it points at.' },
];
export const defaultRules = (): RepairRuleId[] => RULES.filter((r) => r.defaultOn).map((r) => r.id);

/** `full` when the file says it was synthesised from the modules, `metadata` when only its header was rebuilt. */
export function reconstructedKind(text: string): 'full' | 'metadata' | null {
  const m = new RegExp(`<!-- ${RECONSTRUCTED_MARKER}: ([^>]*)-->`).exec(text);
  if (!m) return null;
  return /synthesised from the data modules/.test(m[1]) ? 'full' : 'metadata';
}

export function normaliseRules(want: RepairRuleId[] | undefined): Set<RepairRuleId> {
  if (!want) return new Set(defaultRules());
  return new Set(want.filter((r): r is RepairRuleId => (REPAIR_RULES as readonly string[]).includes(r)));
}

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const mostCommonDir = (paths: string[]): string => {
  const c = new Map<string, number>();
  for (const p of paths) c.set(dirOf(p), (c.get(dirOf(p)) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
};
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

export function repairPackage(pkg: Package, options: RepairOptions = {}): RepairResult {
  const rules = normaliseRules(options.repairs);
  const files = new Map<string, Buffer>();
  const changeLog: ChangeEntry[] = [];
  let seq = 0;
  const log = (file: string, c: Omit<ChangeEntry, 'seq' | 'file'>): void => { changeLog.push({ seq: ++seq, file, ...c }); };

  const images = fileIndex([...pkg.icns, ...pkg.images].map((f) => f.base));
  const shipped = new Set(pkg.dms.filter((d) => d.isBrex).map((d) => d.ident.dmc));
  const placeholders = new Map<string, { icn: string; target: string; declaredIn: string[] }>();
  const dmTexts = new Map<string, string>();

  // ── 1. data modules ───────────────────────────────────────────────────────
  for (const d of pkg.dms) {
    let text = d.text;
    if (d.file.encodingProblem) { dmTexts.set(d.file.path, text); continue; }
    if (rules.has('table-cols')) {
      const r = repairTables(text);
      for (const c of r.changes) log(d.file.path, c);
      text = r.text;
    }
    if (rules.has('icn-placeholder') && !d.isBrex) {
      const r = repairIcn(text, images);
      for (const c of r.changes) log(d.file.path, c);
      text = r.text;
      for (const m of r.placeholders) addPlaceholder(placeholders, m, d.file.path);
    }
    if (rules.has('brex-remap')) {
      const r = repairBrex(text, { issue: options.targetIssue ?? (d.ident.issue || undefined), shipped, neutraliseMissing: options.neutraliseMissingBrex });
      for (const c of r.changes) log(d.file.path, c);
      text = r.text;
    }
    dmTexts.set(d.file.path, text);
    if (text !== d.text) files.set(d.file.path, Buffer.from(text, 'utf8'));
  }

  // The placeholder PNGs themselves (one per missing file name, however many modules declare it).
  const icnDir = mostCommonDir([...pkg.icns, ...pkg.images].map((f) => f.path));
  const placeholderList: RepairResult['placeholders'] = [];
  for (const p of [...placeholders.values()].sort((a, b) => a.target.localeCompare(b.target))) {
    const path = join(icnDir, p.target);
    files.set(path, placeholderPng(p.icn));
    placeholderList.push({ file: path, icn: p.icn, declaredIn: p.declaredIn });
    log(path, { rule: 'icn-placeholder', kind: 'add', before: '(file missing from the package)', after: `placeholder PNG for ${p.icn} (declared in ${p.declaredIn.length} module${p.declaredIn.length === 1 ? '' : 's'})`, synthetic: true });
  }

  // ── 2. publication modules ────────────────────────────────────────────────
  const byKey = dmIndex(pkg.dms);
  const majorityIssue = [...pkg.dms.reduce((m, d) => m.set(d.ident.issue, (m.get(d.ident.issue) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || undefined;
  const pmcTexts = new Map<string, string>();
  let synthesisedFile: string | undefined;

  for (const p of pkg.pmcs) {
    let text = p.text;
    if (!p.model || p.file.encodingProblem) { pmcTexts.set(p.file.path, text); continue; }
    if (rules.has('pmc-titles') || rules.has('pmc-dmref-identity')) {
      const r = repairPmcRefs(text, byKey, pkg.dms, { titles: rules.has('pmc-titles'), identity: rules.has('pmc-dmref-identity') });
      for (const c of r.changes) log(p.file.path, c);
      text = r.text;
    }
    if (rules.has('brex-remap')) {
      const r = repairBrex(text, { issue: options.targetIssue ?? (schemaIssueOf(text) || majorityIssue), shipped, neutraliseMissing: options.neutraliseMissingBrex });
      for (const c of r.changes) log(p.file.path, c);
      text = r.text;
    }
    if (rules.has('pmc-reconstruct') && p.placeholder && !p.reconstructedMarker) {
      const model = parsePmComplete(text);
      const { meta, notes } = deriveMeta(pkg.dms, model.meta, { projectName: options.projectName });
      const hasModules = countModuleEntries(model.entries) > 0;
      const entries: PmEntry[] = hasModules ? model.entries : synthesiseEntries(pkg.dms, meta.pmCode);
      const before = model.meta;
      const cmp: Array<[string, string, string]> = [
        ['pmCode', `${before.pmCode.modelIdentCode}-${before.pmCode.pmIssuer}-${before.pmCode.pmNumber}-${before.pmCode.pmVolume}`, `${meta.pmCode.modelIdentCode}-${meta.pmCode.pmIssuer}-${meta.pmCode.pmNumber}-${meta.pmCode.pmVolume}`],
        ['language', `${before.language.languageIsoCode}-${before.language.countryIsoCode}`, `${meta.language.languageIsoCode}-${meta.language.countryIsoCode}`],
        ['pmTitle', before.pmTitle, meta.pmTitle],
        ['shortPmTitle', before.shortPmTitle, meta.shortPmTitle],
        ['securityClassification', before.securityClassification, meta.securityClassification],
      ];
      for (const [what, b, a] of cmp) if (b !== a) log(p.file.path, { rule: 'pmc-reconstruct', kind: 'edit', where: `publication header: ${what}`, before: b, after: a, synthetic: true });
      if (!hasModules) log(p.file.path, { rule: 'pmc-reconstruct', kind: 'edit', where: 'publication structure', before: '(no data modules listed)', after: `${countModuleEntries(entries)} data modules arranged by their code hierarchy`, synthetic: true });
      for (const n of notes) log(p.file.path, { rule: 'pmc-reconstruct', kind: 'note', before: '', after: n });
      text = synthesisePmText(meta, entries, hasModules
        ? 'the delivered publication module was a template (placeholder model / issuer); its header was rebuilt from the data modules'
        : 'the delivered publication module was a template with no data modules; it was synthesised from the data modules');
    }
    pmcTexts.set(p.file.path, text);
    if (text !== p.text) files.set(p.file.path, Buffer.from(text, 'utf8'));
  }

  // ── 3. no publication at all ─────────────────────────────────────────────
  const usable = pkg.pmcs.filter((p) => p.model);
  if (!usable.length && rules.has('pmc-reconstruct') && pkg.dms.some((d) => !d.isBrex && d.ident.dmc)) {
    const { meta, notes } = deriveMeta(pkg.dms, undefined, { projectName: options.projectName });
    const entries = synthesiseEntries(pkg.dms, meta.pmCode);
    const text = synthesisePmText(meta, entries, 'the package held no publication module; it was synthesised from the data modules');
    synthesisedFile = join(mostCommonDir(pkg.dms.map((d) => d.file.path)), pmcFileName(meta));
    files.set(synthesisedFile, Buffer.from(text, 'utf8'));
    pmcTexts.set(synthesisedFile, text);
    log(synthesisedFile, { rule: 'pmc-reconstruct', kind: 'add', before: '(no publication module in the package)', after: `publication ${meta.pmCode.modelIdentCode}-${meta.pmCode.pmIssuer}-${meta.pmCode.pmNumber}: ${countModuleEntries(entries)} data modules arranged by their code hierarchy`, synthetic: true });
    for (const n of notes) log(synthesisedFile, { rule: 'pmc-reconstruct', kind: 'note', before: '', after: n });
  }

  // ── 4. structure ──────────────────────────────────────────────────────────
  const views: PmcView[] = [];
  for (const [path, text] of pmcTexts) {
    const rec = pkg.pmcs.find((p) => p.file.path === path);
    let model: PmModel;
    try { model = parsePmComplete(text); } catch { continue; }
    const view: PmcView = rec ? viewOf(rec, text, model) : { path, model, placeholder: isPlaceholderPmCode(model.meta.pmCode), reconstructed: true };
    view.placeholder = isPlaceholderPmCode(model.meta.pmCode) && !text.includes(RECONSTRUCTED_MARKER);
    view.reconstructed = view.reconstructed || text.includes(RECONSTRUCTED_MARKER);
    views.push(view);
  }
  const structure = assembleStructure(views, pkg.dms);

  let publication: AssembledPublication | null = null;
  let pool = structure.pool;
  if (structure.publication) {
    const master = views.find((v) => v.path === structure.publication?.sourceFile);
    publication = {
      model: structure.publication.model, sourceFile: structure.publication.sourceFile,
      reconstructed: reconstructedKind(pmcTexts.get(structure.publication.sourceFile) ?? ''),
    };
    if (options.assembleUnassigned && pool.length) {
      const dmsByFile = new Map(pkg.dms.map((d) => [d.file.path, d]));
      const folder: PmEntry = { type: 'folder', title: 'Unassigned data modules (imported)', children: groupByHierarchy(pool.map((p) => dmsByFile.get(p.file)).filter((d): d is DmRec => !!d)) };
      publication.model.entries.push(folder);
      publication.assembledPoolFolder = folder.title;
      for (const item of pool) log(item.file, { rule: 'orphans-pool', kind: 'note', before: 'not referenced by any publication', after: `placed in "${folder.title}" because assembleUnassigned was requested` });
      pool = [];
    }
  }
  for (const item of pool) log(item.file, { rule: 'orphans-pool', kind: 'note', before: 'not referenced by any publication', after: 'unassigned pool (not published until a person places it)' });
  for (const s of structure.subPublications) {
    log(s.referencedFrom, { rule: 'subpub', kind: 'note', where: `pmRef ${s.pmCode}`, before: s.entryTitle || s.pmTitle, after: s.status === 'nested' ? `imported nested from ${s.pmcFile}` : s.status === 'anchor-only' ? `PMC not in the package; anchor title page ${s.anchorDm?.dmc}` : 'PMC not in the package and no anchor module found' });
  }

  return {
    files, changeLog, publication, placeholders: placeholderList, pool, subPublications: structure.subPublications, reusedDms: structure.reusedDms,
    rulesRun: [...rules].sort(),
  };
}

function addPlaceholder(map: Map<string, { icn: string; target: string; declaredIn: string[] }>, m: MissingIcn, dmPath: string): void {
  const k = m.target.toLowerCase();
  const cur = map.get(k);
  if (cur) { if (!cur.declaredIn.includes(dmPath)) cur.declaredIn.push(dmPath); }
  else map.set(k, { icn: m.icn, target: m.target, declaredIn: [dmPath] });
}

/** Every importable file of the package with the repaired copies overlaid, plus the files the repair created. Ignored junk is left out. */
export function repairedEntries(pkg: Package, result: RepairResult): PackageEntry[] {
  const out: PackageEntry[] = [];
  const seen = new Set<string>();
  for (const f of pkg.files) {
    if (f.kind === 'ignored') continue;
    seen.add(f.path);
    out.push({ name: f.path, bytes: result.files.get(f.path) ?? f.bytes });
  }
  for (const [path, bytes] of result.files) if (!seen.has(path)) out.push({ name: path, bytes });
  return out;
}
