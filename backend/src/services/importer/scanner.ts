// =============================================================================
// scanPackage: read a package, say what it is and what is wrong with it. No side effects.
//
// The report is plain JSON and is the single source for the import screen and for the apply step's log. It
// also runs the repair pipeline in memory so the plan it shows ("table-cols: 2 tables in 1 file") is exactly
// what an import with those rules would do - not an estimate.
// =============================================================================

import { wellFormedError } from '../wellFormed';
import { loadPackage, type DmRec, type Package } from './package';
import { detectFlavour } from './flavour';
import { REPAIR_RULES, type Finding, type PackageEntry, type PackageReport, type RepairOptions, type RepairResult, type RepairRuleId, type Severity } from './types';
import { RULES, repairPackage, normaliseRules } from './repair';
import { tableFindings } from './repairs/tables';
import { entityDecls, icnFindings, externalEntityFindings, fileIndex, baseOf, graphicRefs, isExternalTarget } from './repairs/icn';
import { brexFindings } from './repairs/brex';
import { dmIndex, pmcRefFindings } from './repairs/pmc';
import { countModuleEntries } from './structure';
import { schemaIssueOf } from './identity';
import { pmCodeKey } from './types';

const { checkXmlSafety } = require('../../core/auth/xmlGuard') as { checkXmlSafety(xml: string): { ok: boolean; error?: string } };

const DM_FILE_RE = /^DMC-[A-Za-z0-9._-]+\.xml$/i;
const CAP = 25;

export interface Analysis { pkg: Package; report: PackageReport; repair: RepairResult }

function majority<T>(items: T[], key: (t: T) => string): string | undefined {
  const c = new Map<string, number>();
  for (const i of items) c.set(key(i), (c.get(key(i)) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

export function analyzePackage(entries: PackageEntry[], options: RepairOptions = {}): Analysis {
  const pkg = loadPackage(entries);
  const selected = normaliseRules(options.repairs);
  const repair = repairPackage(pkg, { ...options, repairs: [...selected] });
  // The report describes the package as delivered: the pool is what no publication places, even when the caller asked to assemble it.
  const delivered = options.assembleUnassigned ? repairPackage(pkg, { ...options, repairs: [...selected], assembleUnassigned: false }) : repair;
  const all = new Set<RepairRuleId>(REPAIR_RULES);
  const everything = selected.size === all.size ? delivered : repairPackage(pkg, { ...options, repairs: [...all], assembleUnassigned: false });
  const findings = collectFindings(pkg, delivered, selected, options);
  const bySeverity = (s: Severity): number => findings.filter((f) => f.severity === s).length;

  const dms = pkg.dms.filter((d) => !d.isBrex);
  const models: Record<string, number> = {};
  const languages: Record<string, number> = {};
  for (const d of dms) {
    const m = d.ident.dmCodeAttrs.modelIdentCode ?? '?';
    models[m] = (models[m] ?? 0) + 1;
    languages[d.ident.language || '?'] = (languages[d.ident.language || '?'] ?? 0) + 1;
  }

  // Graphics: what the modules declare against what the package ships.
  const idx = fileIndex([...pkg.icns, ...pkg.images].map((f) => f.base));
  const declaredTargets = new Set<string>();
  const referenced = new Set<string>();
  const missing = new Map<string, { icn: string; target: string; declaredIn: string[] }>();
  for (const d of pkg.dms) {
    for (const e of entityDecls(d.text).filter((x) => !isExternalTarget(x.target))) {
      declaredTargets.add(baseOf(e.target).toLowerCase());
      referenced.add(e.name.toLowerCase());
    }
    for (const r of graphicRefs(d.text)) referenced.add(r.toLowerCase());
  }
  for (const p of everything.placeholders) {
    missing.set(p.file.toLowerCase(), { icn: p.icn, target: baseOf(p.file), declaredIn: p.declaredIn });
  }
  const present = [...declaredTargets].filter((t) => idx.names.has(t)).length;
  const unusedFiles = pkg.icns.concat(pkg.images)
    .filter((f) => !declaredTargets.has(f.base.toLowerCase()) && !referenced.has(f.base.replace(/\.[A-Za-z0-9]+$/, '').toLowerCase()))
    .map((f) => f.path).sort();

  const pubs = pkg.pmcs.map((p) => ({
    file: p.file.path,
    pmCode: p.model ? pmCodeKey(p.model.meta.pmCode) : '',
    title: p.model?.meta.pmTitle ?? '',
    language: p.model ? `${p.model.meta.language.languageIsoCode ?? ''}-${p.model.meta.language.countryIsoCode ?? ''}` : '',
    placeholder: p.placeholder && !p.reconstructedMarker,
    reconstructed: p.reconstructedMarker,
    entries: p.model ? countModuleEntries(p.model.entries) : 0,
    dmRefs: p.model ? countModuleEntries(p.model.entries) : 0,
    referencedFrom: repair.subPublications.find((s) => s.pmcFile === p.file.path)?.referencedFrom,
  }));

  // What each rule would do (counted over a run with every rule on, so a rule the caller did not pick still shows its reach).
  const plan: PackageReport['repairPlan'] = RULES.map((r) => {
    const rows = everything.changeLog.filter((c) => c.rule === r.id && c.kind !== 'note');
    return { rule: r.id, title: r.title, defaultOn: r.defaultOn, items: rows.length, files: new Set(rows.map((c) => c.file)).size };
  });
  plan.push({ rule: 'orphans-pool', title: 'Collect modules no publication places into the unassigned pool', defaultOn: true, items: everything.pool.length, files: everything.pool.length });

  const report: PackageReport = {
    version: 1,
    flavour: detectFlavour(pkg),
    counts: {
      files: pkg.files.length, bytes: pkg.files.reduce((s, f) => s + f.bytes.length, 0),
      dms: dms.length, brex: pkg.dms.length - dms.length, pmcs: pkg.pmcs.length,
      icns: pkg.icns.length, images: pkg.images.length, other: pkg.others.length, ignored: pkg.ignored.length,
    },
    files: pkg.files.map((f) => ({ path: f.path, kind: f.kind, size: f.bytes.length, dmc: pkg.dms.find((d) => d.file === f)?.ident.dmc })),
    models, languages,
    graphics: { declared: declaredTargets.size, present, missing: [...missing.values()], unusedFiles },
    publications: pubs,
    subPublications: repair.subPublications,
    unassigned: delivered.pool,
    reusedDms: repair.reusedDms,
    missingModules: [],
    findings,
    summary: { errors: bySeverity('error'), warnings: bySeverity('warning'), infos: bySeverity('info'), repairable: findings.filter((f) => f.repairable).length },
    repairPlan: plan,
  };
  report.missingModules = missingModulesOf(pkg, repair);
  return { pkg, report, repair };
}

export function scanPackage(entries: PackageEntry[], options: RepairOptions = {}): PackageReport {
  return analyzePackage(entries, options).report;
}

function missingModulesOf(pkg: Package, repair: RepairResult): PackageReport['missingModules'] {
  const have = new Set(pkg.dms.map((d) => d.ident.dmc));
  const out: PackageReport['missingModules'] = [];
  const seen = new Set<string>();
  const walk = (list: NonNullable<RepairResult['publication']>['model']['entries']): void => {
    for (const e of list) {
      if (e.type === 'folder') { walk(e.children ?? []); continue; }
      if (e.type !== 'dm' || !e.dmCode) continue;
      const c = e.dmCode;
      const dmc = [c.modelIdentCode, c.systemDiffCode, c.systemCode, `${c.subSystemCode}${c.subSubSystemCode}`, c.assyCode, `${c.disassyCode}${c.disassyCodeVariant}`, `${c.infoCode}${c.infoCodeVariant}`, c.itemLocationCode].join('-');
      if (have.has(dmc) || seen.has(dmc)) continue;
      seen.add(dmc);
      out.push({ dmc, title: [e.techName, e.infoName].filter(Boolean).join(' / '), inPmc: repair.publication?.sourceFile ?? '', generatedFrontMatter: /^#Front-?Matter/i.test(e.techName ?? '') });
    }
  };
  if (repair.publication) {
    walk(repair.publication.model.entries);
    for (const g of repair.publication.model.generated ?? []) if (!seen.has(g.dmc)) { seen.add(g.dmc); out.push({ dmc: g.dmc, title: g.title, inPmc: repair.publication.sourceFile, generatedFrontMatter: true }); }
  }
  return out;
}

function collectFindings(pkg: Package, repair: RepairResult, selected: Set<RepairRuleId>, options: RepairOptions): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding): void => { out.push(f); };

  for (const n of pkg.loadNotes) add({ id: 'package-load', severity: n.severity, rule: 'package', message: n.message });
  if (!pkg.dms.length) add({ id: 'no-data-modules', severity: 'error', rule: 'package', message: 'The package holds no S1000D data modules (no file with a <dmodule> root).' });

  const idx = fileIndex([...pkg.icns, ...pkg.images].map((f) => f.base));
  const shipped = new Set(pkg.dms.filter((d) => d.isBrex).map((d) => d.ident.dmc));
  const majorityIssue = majority(pkg.dms, (d) => d.ident.issue) || undefined;
  const brexAgg = new Map<string, Finding & { data: { files: string[]; count: number } }>();
  const seenIdentity = new Map<string, string>();

  for (const d of pkg.dms) {
    const f = d.file.path;
    if (d.file.encodingProblem) add({ id: 'encoding', severity: 'warning', rule: 'package', file: f, message: d.file.encodingProblem });
    const guard = checkXmlSafety(d.text);
    if (!guard.ok) add({ id: 'xml-unsafe', severity: 'error', rule: 'package', file: f, message: guard.error ?? 'The module fails the XML safety check.' });
    const bad = wellFormedError(d.text);
    if (bad) add({ id: 'xml-malformed', severity: 'error', rule: 'package', file: f, message: `Not well-formed XML: ${bad}` });
    if (!d.ident.dmc) add({ id: 'dm-no-identity', severity: 'error', rule: 'package', file: f, message: 'The module has no readable dmCode.' });
    if (!DM_FILE_RE.test(d.file.base)) add({ id: 'dm-file-name', severity: 'warning', rule: 'package', file: f, message: `The file name is not DMC-<code>.xml; the import will name it after the module's code.` });
    else if (d.ident.dmc && !d.file.base.toUpperCase().startsWith(`DMC-${d.ident.dmc.toUpperCase()}`)) add({ id: 'dm-name-mismatch', severity: 'warning', rule: 'package', file: f, message: `The file name does not match the module's code ${d.ident.dmc}.` });
    const key = `${d.ident.dmc}|${d.ident.issueNumber}-${d.ident.inWork}|${d.ident.language}`.toUpperCase();
    const twin = seenIdentity.get(key);
    if (twin) add({ id: 'dm-duplicate', severity: 'error', rule: 'package', file: f, message: `Same data module (code, issue, language) as ${twin}; a project holds each module once.` });
    else seenIdentity.set(key, f);

    if (!d.isBrex) for (const x of tableFindings(f, d.text)) add(x);
    for (const x of externalEntityFindings(f, d.text)) add(x);
    if (!d.isBrex) for (const x of icnFindings(f, d.text, idx)) add(x);
    for (const x of brexFindings(f, d.text, { issue: options.targetIssue ?? (d.ident.issue || undefined), shipped, neutraliseMissing: options.neutraliseMissingBrex })) {
      const k = `${x.id}|${x.data?.dmc}`;
      const cur = brexAgg.get(k);
      if (cur) { cur.data.count++; if (cur.data.files.length < CAP) cur.data.files.push(f); }
      else brexAgg.set(k, { ...x, file: undefined, data: { ...(x.data ?? {}), files: [f], count: 1 } });
    }
  }
  for (const f of brexAgg.values()) {
    const n = f.data.count;
    add({ ...f, message: `${n} module${n === 1 ? '' : 's'}: ${f.message}` });
  }

  const byKey = dmIndex(pkg.dms);
  const dmLang = majority(pkg.dms.filter((d) => !d.isBrex), (d) => d.ident.language);
  for (const p of pkg.pmcs) {
    const f = p.file.path;
    if (!p.model) { add({ id: 'pmc-unreadable', severity: 'error', rule: 'package', file: f, message: `The publication module could not be read: ${p.parseError ?? 'unknown error'}.` }); continue; }
    for (const w of p.model.warnings) add({ id: 'pmc-unmodelled', severity: 'info', rule: 'package', file: f, message: w });
    const guard = checkXmlSafety(p.text);
    if (!guard.ok) add({ id: 'xml-unsafe', severity: 'error', rule: 'package', file: f, message: guard.error ?? 'The publication module fails the XML safety check.' });
    if (p.placeholder && !p.reconstructedMarker) add({ id: 'pmc-placeholder', severity: 'warning', rule: 'pmc-reconstruct', file: f, repairable: true, message: `The publication module is a template (${p.model.meta.pmCode.modelIdentCode}/${p.model.meta.pmCode.pmIssuer}): its identity was never filled in.` });
    const lang = `${p.model.meta.language.languageIsoCode}-${(p.model.meta.language.countryIsoCode ?? '').toUpperCase()}`;
    if (dmLang && lang.toUpperCase() !== dmLang.toUpperCase() && !p.reconstructedMarker) {
      add({ id: 'pmc-language', severity: 'warning', rule: 'pmc-language', file: f, repairable: p.placeholder, message: `The publication says language ${lang} but its data modules are ${dmLang}${p.placeholder ? ' (rebuilt with the placeholder header)' : ' (reported only: the publication header is the author\'s to change)'}.` });
    }
    for (const x of pmcRefFindings(f, p.text, byKey)) add(x);
    const issue = schemaIssueOf(p.text) || majorityIssue;
    for (const x of brexFindings(f, p.text, { issue, shipped, neutraliseMissing: options.neutraliseMissingBrex })) add(x);
  }

  // Aggregate the dmRefs naming modules the package does not hold.
  const gen = repair.publication ? missingModulesOf(pkg, repair) : [];
  const real = gen.filter((m) => !m.generatedFrontMatter);
  if (real.length) add({ id: 'pmc-missing-dmref', severity: 'warning', rule: 'pmc-missing-dmref', message: `${real.length} data module${real.length === 1 ? '' : 's'} named by the publication ${real.length === 1 ? 'is' : 'are'} not in the package.`, data: { modules: real.slice(0, CAP).map((m) => ({ dmc: m.dmc, title: m.title })), count: real.length } });
  const fm = gen.filter((m) => m.generatedFrontMatter);
  if (fm.length) add({ id: 'pmc-generated-front-matter', severity: 'info', rule: 'pmc-missing-dmref', message: `${fm.length} front-matter entr${fm.length === 1 ? 'y' : 'ies'} (${fm.map((m) => m.title.split(' / ')[1] ?? m.title).join(', ')}) name modules the exporting tool generates at build time; the publisher generates its own.`, data: { modules: fm.map((m) => ({ dmc: m.dmc, title: m.title })) } });

  for (const s of repair.subPublications) {
    if (s.status === 'nested') continue;
    add(s.status === 'anchor-only'
      ? { id: 'subpub-anchor-only', severity: 'info', rule: 'subpub', file: s.referencedFrom, message: `Sub-publication ${s.pmCode} ("${s.entryTitle || s.pmTitle}") is not in the package; its title page is ${s.anchorDm?.dmc} (${s.anchorDm?.techName}). Its other modules are in the unassigned pool for assisted assembly.`, data: { pmCode: s.pmCode, anchor: s.anchorDm?.file } }
      : { id: 'subpub-unresolved', severity: 'warning', rule: 'subpub', file: s.referencedFrom, message: `Sub-publication ${s.pmCode} ("${s.entryTitle || s.pmTitle}") is not in the package and no title-page module quotes its code.`, data: { pmCode: s.pmCode } });
  }
  const pooled = repair.pool;
  if (pooled.length) add({ id: 'dm-orphans', severity: 'warning', rule: 'orphans-pool', message: `${pooled.length} data module${pooled.length === 1 ? '' : 's'} are in no publication. They are kept in the unassigned pool: never dropped, never published until a person places them.`, data: { count: pooled.length, files: pooled.slice(0, CAP).map((p) => p.file) } });
  return out.map((f) => (f.repairable && !selected.has(f.rule as RepairRuleId) ? { ...f, repairable: false } : f));
}

export type { DmRec };
