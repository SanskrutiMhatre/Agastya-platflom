// =============================================================================
// Publication structure: master, sub-publications (pmRef), the unassigned pool, reuse.
//
// A S1000D book can be assembled from several publication modules: the master PMC carries
// `<pmEntry><pmEntryTitle>Annexure 'A' ...</pmEntryTitle><pmRef>...<pmCode pmNumber="00010"/></pmRef></pmEntry>`
// and the annexure is another PMC. Xignal exports ship the master and the data modules but NOT the annexure
// PMCs - 186 of the 218 modules of the sample look orphaned for that reason alone. What this module does:
//
//   - when the sub-PMC IS in the package, it is imported NESTED: the pmRef becomes a folder holding its entries
//     (so one publication.xml builds the whole book, which is what the platform's single-PMC project can do)
//   - when it is NOT, the pmRef stays (the build resolves it by pmCode against other projects), and the
//     ANCHOR DM is found: the title page (info code 001) whose body prints that publication's `<pmCode>`.
//     The verified sample mapping is deterministic (02A -> 00010, 05A -> 00009, ..., master 32A -> 00039).
//   - modules no publication places go to an explicit POOL - never dropped, never published by themselves
//   - the same module in several publications stays in every one of them (41 of the sample's modules are
//     reused); nothing de-duplicates entries.
// =============================================================================

import { dmKey } from './identity';
import { baseName, type DmRec, type PmcRec } from './package';
import { sns } from './reconstruct';
import { pmCodeKey, type PmEntry, type PmModel, type PoolItem, type ReusedDm, type SubPublication } from './types';

export interface PmcView { path: string; model: PmModel; placeholder: boolean; reconstructed: boolean }

export const viewOf = (r: PmcRec, text: string, model: PmModel): PmcView => ({ path: r.file.path, model, placeholder: r.placeholder, reconstructed: r.reconstructedMarker || text.includes('agastya-import: reconstructed') });

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export interface StructureResult {
  /** The publication to import: the master with every in-package sub-PMC nested. */
  publication: { model: PmModel; sourceFile: string } | null;
  subPublications: SubPublication[];
  pool: PoolItem[];
  reusedDms: ReusedDm[];
  missingModules: Array<{ dmc: string; title: string; inPmc: string; generatedFrontMatter: boolean }>;
  /** PMCs nothing references: reported, not imported (their modules fall to the pool). */
  unreferencedPmcs: string[];
  cycles: string[];
}

/** Count the module entries (dm + include) of a tree. */
export function countModuleEntries(entries: PmEntry[]): number {
  let n = 0;
  for (const e of entries) { if (e.type === 'dm' || e.type === 'include') n++; else if (e.type === 'folder') n += countModuleEntries(e.children ?? []); }
  return n;
}

/** The anchor DM per publication code: the title page that prints `<pmCode>`; failing that, any module that does. */
export function findAnchors(dms: DmRec[]): Map<string, { dm: DmRec; basis: 'title-page' | 'any-module' }> {
  const out = new Map<string, { dm: DmRec; basis: 'title-page' | 'any-module' }>();
  const ordered = [...dms].filter((d) => !d.isBrex).sort((a, b) => a.ident.dmc.localeCompare(b.ident.dmc));
  for (const d of ordered) {
    for (const c of d.bodyPmCodes) {
      const k = pmCodeKey(c);
      const basis = d.ident.infoCode === '001' ? 'title-page' : 'any-module';
      const cur = out.get(k);
      if (!cur || (cur.basis === 'any-module' && basis === 'title-page')) out.set(k, { dm: d, basis });
    }
  }
  return out;
}

export function assembleStructure(views: PmcView[], dms: DmRec[]): StructureResult {
  const byKey = new Map<string, PmcView>();
  for (const v of views) { const k = pmCodeKey(v.model.meta.pmCode); if (!byKey.has(k)) byKey.set(k, v); }

  // Which PMCs does another PMC point at?
  const referenced = new Set<string>();
  const scanRefs = (list: PmEntry[]): void => { for (const e of list) { if (e.type === 'pmRef') referenced.add(pmCodeKey(e.pmCode)); else if (e.type === 'folder') scanRefs(e.children ?? []); } };
  for (const v of views) scanRefs(v.model.entries);
  const roots = views.filter((v) => !referenced.has(pmCodeKey(v.model.meta.pmCode)));
  const candidates = roots.length ? roots : views;

  // The master: an authored PMC beats a template; then the one that reaches the most modules once its sub-PMCs are counted.
  const reach = (v: PmcView, seen = new Set<string>()): number => {
    const k = pmCodeKey(v.model.meta.pmCode);
    if (seen.has(k)) return 0;
    seen.add(k);
    let n = countModuleEntries(v.model.entries);
    const walk = (list: PmEntry[]): void => { for (const e of list) { if (e.type === 'pmRef') { const s = byKey.get(pmCodeKey(e.pmCode)); if (s) n += reach(s, seen); } else if (e.type === 'folder') walk(e.children ?? []); } };
    walk(v.model.entries);
    return n;
  };
  const master = [...candidates].sort((a, b) => Number(a.placeholder) - Number(b.placeholder) || reach(b) - reach(a) || a.path.localeCompare(b.path))[0];

  const anchors = findAnchors(dms);
  const subs: SubPublication[] = [];
  const cycles: string[] = [];

  const expand = (entries: PmEntry[], view: PmcView, outPath: number[], stack: string[]): PmEntry[] => {
    const out: PmEntry[] = [];
    for (const e of entries) {
      const here = [...outPath, out.length];
      if (e.type === 'folder') {
        const f: PmEntry = { ...clone({ ...e, children: undefined }), type: 'folder', children: [] };
        out.push(f);
        f.children = expand(e.children ?? [], view, here, stack);
      } else if (e.type === 'pmRef') {
        const key = pmCodeKey(e.pmCode);
        const sub = byKey.get(key);
        const a = anchors.get(key);
        const rec: SubPublication = {
          pmCode: key, pmCodeAttrs: { ...(e.pmCode ?? {}) },
          entryTitle: e.title ?? '', pmTitle: e.pmTitle ?? '', shortPmTitle: e.shortPmTitle ?? '',
          referencedFrom: view.path, entryPath: here, status: 'unresolved',
        };
        if (a) { rec.anchorDm = { file: a.dm.file.path, dmc: a.dm.ident.dmc, techName: a.dm.ident.techName }; rec.anchorBasis = a.basis; }
        if (sub && stack.includes(key)) { cycles.push(`${key} refers back to ${stack[stack.length - 1] ?? key}`); out.push(clone(e)); rec.status = a ? 'anchor-only' : 'unresolved'; }
        else if (sub) {
          rec.status = 'nested'; rec.pmcFile = sub.path;
          const f: PmEntry = { type: 'folder', title: e.title || e.pmTitle || sub.model.meta.pmTitle, children: [] };
          out.push(f);
          f.children = expand(sub.model.entries, sub, here, [...stack, key]);
        } else { out.push(clone(e)); rec.status = a ? 'anchor-only' : 'unresolved'; }
        subs.push(rec);
      } else out.push(clone(e));
    }
    return out;
  };

  let publication: StructureResult['publication'] = null;
  if (master) {
    const entries = expand(master.model.entries, master, [], [pmCodeKey(master.model.meta.pmCode)]);
    publication = { model: { meta: clone(master.model.meta), entries, generated: clone(master.model.generated ?? []) }, sourceFile: master.path };
  }

  // Placement, reuse, missing modules - over the assembled tree, so a nested sub-PMC's modules count as placed.
  const dmByKey = new Map<string, DmRec[]>();
  const dmByFile = new Map<string, DmRec>();
  for (const d of dms) {
    if (d.isBrex) continue;
    const k = dmKey(d.ident.dmCodeAttrs, d.ident.identExtension);
    (dmByKey.get(k) ?? dmByKey.set(k, []).get(k) as DmRec[]).push(d);
    dmByFile.set(baseName(d.file.path).toLowerCase(), d);
  }
  const counts = new Map<string, number>();
  const placed = new Set<DmRec>();
  const missing = new Map<string, { dmc: string; title: string; inPmc: string; generatedFrontMatter: boolean }>();
  const visit = (list: PmEntry[]): void => {
    for (const e of list) {
      if (e.type === 'folder') { visit(e.children ?? []); continue; }
      if (e.type === 'dm' && e.dmCode) {
        const k = dmKey(e.dmCode, e.identExtension);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        const hit = dmByKey.get(k);
        if (hit) for (const d of hit) placed.add(d);
        else if (!missing.has(k)) missing.set(k, { dmc: k, title: [e.techName, e.infoName].filter(Boolean).join(' / '), inPmc: publication?.sourceFile ?? '', generatedFrontMatter: /^#Front-?Matter/i.test(e.techName ?? '') });
      } else if (e.type === 'include' && e.href) {
        const d = dmByFile.get(baseName(e.href).toLowerCase());
        if (d) { placed.add(d); const k = dmKey(d.ident.dmCodeAttrs, d.ident.identExtension); counts.set(k, (counts.get(k) ?? 0) + 1); }
      }
    }
  };
  if (publication) {
    visit(publication.model.entries);
    for (const g of publication.model.generated ?? []) if (!missing.has(g.dmc)) missing.set(g.dmc, { dmc: g.dmc, title: g.title, inPmc: publication.sourceFile, generatedFrontMatter: true });
  }

  const pending = subs.some((s) => s.status !== 'nested');
  const pool: PoolItem[] = [...dms]
    .filter((d) => !d.isBrex && d.ident.dmc && !placed.has(d))
    .sort((a, b) => a.ident.dmc.localeCompare(b.ident.dmc, 'en', { numeric: true }))
    .map((d): PoolItem => ({
      file: d.file.path, dmc: d.ident.dmc, techName: d.ident.techName, infoName: d.ident.infoName, infoCode: d.ident.infoCode,
      group: sns(d), reason: pending ? 'sub-publication-not-in-package' : 'not-in-any-pmc', emptyContent: d.ident.emptyContent,
    }));

  const reusedDms: ReusedDm[] = [...counts.entries()].filter(([, n]) => n > 1)
    .map(([k, n]) => ({ dmc: k, occurrences: n, file: dmByKey.get(k)?.[0]?.file.path }))
    .sort((a, b) => b.occurrences - a.occurrences || a.dmc.localeCompare(b.dmc));

  return {
    publication, subPublications: subs, pool, reusedDms, missingModules: [...missing.values()],
    unreferencedPmcs: candidates.filter((v) => v !== master).map((v) => v.path), cycles,
  };
}
