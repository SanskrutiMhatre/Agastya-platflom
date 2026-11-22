// =============================================================================
// Reconstructing a publication module from data-module metadata (rule `pmc-reconstruct`).
//
// Two situations call for it, and both are marked `reconstructed` so nobody mistakes the result for an
// authored table of contents:
//   - the package has no PMC at all                       -> `full`: header and structure are synthesised
//   - the PMC is the plugin's template (MODEL / 00000)    -> `metadata`: its structure is kept (somebody
//     arranged it), only the header that carries the publication's identity is rebuilt from the modules;
//     if it holds no modules at all, the structure is synthesised as well (`full`).
//
// STRUCTURE comes from what a data module code already says (S1000D's SNS): systemCode / subSystem /
// assembly nest into folders, modules inside a folder run in code order then info-code order, and a title
// page (info code 001) goes first. Levels that would hold a single folder are skipped, so a package that is
// all one assembly stays a flat list instead of three nested one-item folders.
// =============================================================================

import { headOf } from '../xmlHead';
import { parseAttrs, decodeText } from './xmlScan';
import { serialisePm } from './identity';
import { RECONSTRUCTED_MARKER, type DmRec } from './package';
import type { DmIdent, PmEntry, PmMeta } from './types';

const PLACEHOLDER_ENTERPRISE = new Set(['', '00000', '12345', 'XXXXX']);
const PLACEHOLDER_TITLE = /^(publication module|pm|untitled|enterprise)?$/i;

const cmp = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
export const byCode = (a: DmRec, b: DmRec): number =>
  cmp(a.ident.dmc, b.ident.dmc) || cmp(`${a.ident.issueNumber}-${a.ident.inWork}`, `${b.ident.issueNumber}-${b.ident.inWork}`);

/** A pmEntry for a module, carrying the identity the module itself states (never a guess). */
/** The publication entry that references a module, written from the module's own identity (never from a title someone typed). */
export function entryForIdent(ident: DmIdent): PmEntry {
  const d = { ident };
  const e: PmEntry = {
    type: 'dm',
    dmCode: { ...d.ident.dmCodeAttrs },
    issueInfo: { issueNumber: d.ident.issueNumber, inWork: d.ident.inWork },
    language: { languageIsoCode: d.ident.languageIsoCode, countryIsoCode: d.ident.countryIsoCode },
    techName: d.ident.techName,
    infoName: d.ident.infoName,
  };
  if (d.ident.identExtension) e.identExtension = { ...d.ident.identExtension };
  if (d.ident.issueDate) e.issueDate = { ...d.ident.issueDate };
  return e;
}
export const entryForDm = (d: DmRec): PmEntry => entryForIdent(d.ident);

/** `systemCode-subSystem-assy`, the grouping key of the pool and of reconstructed folders. */
export const sns = (d: DmRec): string => `${d.ident.dmCodeAttrs.systemCode ?? ''}-${(d.ident.dmCodeAttrs.subSystemCode ?? '') + (d.ident.dmCodeAttrs.subSubSystemCode ?? '')}-${d.ident.dmCodeAttrs.assyCode ?? ''}`;

/** The data modules folded into a hierarchy of folders by their SNS-style code. */
export function groupByHierarchy(dms: DmRec[]): PmEntry[] {
  const sorted = [...dms].sort(byCode);
  const keyAt = [
    (d: DmRec) => d.ident.dmCodeAttrs.systemCode ?? '',
    (d: DmRec) => (d.ident.dmCodeAttrs.subSystemCode ?? '') + (d.ident.dmCodeAttrs.subSubSystemCode ?? ''),
    (d: DmRec) => d.ident.dmCodeAttrs.assyCode ?? '',
  ];
  const titleAt = [
    (d: DmRec) => `System ${keyAt[0](d)}`,
    (d: DmRec) => `Sub-system ${keyAt[0](d)}-${keyAt[1](d)}`,
    (d: DmRec) => `Assembly ${keyAt[0](d)}-${keyAt[1](d)}-${keyAt[2](d)}`,
  ];
  const build = (list: DmRec[], level: number): PmEntry[] => {
    if (level >= keyAt.length) return list.map(entryForDm);
    const groups = new Map<string, DmRec[]>();
    for (const d of list) { const k = keyAt[level](d); (groups.get(k) ?? groups.set(k, []).get(k) as DmRec[]).push(d); }
    if (groups.size === 1) return build(list, level + 1);                   // a level with one folder adds nothing
    return [...groups.values()].map((g) => ({ type: 'folder', title: titleAt[level](g[0]), children: build(g, level + 1) }) as PmEntry);
  };
  return build(sorted, 0);
}

/** The module standing for the publication's title page: info code 001, the one that quotes its own pmCode when that is decidable. */
export function pickTitlePage(dms: DmRec[], ownCode?: Record<string, string>): DmRec | undefined {
  const t = dms.filter((d) => !d.isBrex && d.ident.infoCode === '001').sort(byCode);
  if (!t.length) return undefined;
  if (ownCode && !ownCode.modelIdentCode?.match(/^MODEL$/i)) {
    const hit = t.find((d) => d.bodyPmCodes.some((c) => c.pmNumber === ownCode.pmNumber && c.pmIssuer === ownCode.pmIssuer));
    if (hit) return hit;
  }
  return t[0];
}

const mostCommon = <T>(items: T[], key: (t: T) => string): T | undefined => {
  const counts = new Map<string, { n: number; v: T }>();
  for (const i of items) { const k = key(i); const c = counts.get(k); if (c) c.n++; else counts.set(k, { n: 1, v: i }); }
  return [...counts.entries()].sort((a, b) => b[1].n - a[1].n || cmp(a[0], b[0]))[0]?.[1].v;
};

function enterprise(d: DmRec, tag: 'originator' | 'responsiblePartnerCompany'): { enterpriseCode: string; enterpriseName: string } | undefined {
  const head = headOf(d.text, 'dmodule', 20000);
  const m = new RegExp(`<${tag}\\b([^>]*?)(/?)>`).exec(head);
  if (!m) return undefined;
  const code = parseAttrs(m[1]).enterpriseCode ?? '';
  const name = m[2] ? '' : decodeText(new RegExp(`<${tag}\\b[^>]*>\\s*<enterpriseName>([^<]*)</enterpriseName>`).exec(head)?.[1] ?? '').trim();
  return { enterpriseCode: code, enterpriseName: name };
}

export interface DerivedMeta { meta: PmMeta; notes: string[] }

/**
 * A publication header from the modules. `existing` (a placeholder PMC's header) supplies only what is not a
 * placeholder itself; everything else is read off the modules. Each decision that was a guess goes in `notes`.
 */
export function deriveMeta(allDms: DmRec[], existing: PmMeta | undefined, opts: { projectName?: string; titleDm?: DmRec } = {}): DerivedMeta {
  const dms = allDms.filter((d) => !d.isBrex && d.ident.dmc);
  const notes: string[] = [];
  const model = mostCommon(dms, (d) => d.ident.dmCodeAttrs.modelIdentCode ?? '')?.ident.dmCodeAttrs.modelIdentCode ?? 'MODEL';
  const lang = mostCommon(dms, (d) => d.ident.language)?.ident;
  const titles = dms.filter((d) => d.ident.infoCode === '001');
  const title = opts.titleDm ?? pickTitlePage(dms, existing?.pmCode && !/^MODEL$/i.test(existing.pmCode.modelIdentCode ?? '') ? existing.pmCode : undefined);

  // pmCode: the publication's number is printed on its title page, but only trust it when that is unambiguous.
  const withCodes = opts.titleDm && opts.titleDm.bodyPmCodes.length ? [opts.titleDm] : titles.filter((d) => d.bodyPmCodes.length > 0);
  let pmNumber = existing?.pmCode?.pmNumber && existing.pmCode.pmNumber !== '00000' ? existing.pmCode.pmNumber : '';
  let pmIssuer = existing?.pmCode?.pmIssuer && existing.pmCode.pmIssuer !== '00000' ? existing.pmCode.pmIssuer : '';
  let pmVolume = existing?.pmCode?.pmVolume || '00';
  if (!pmNumber || !pmIssuer) {
    if (withCodes.length === 1) {
      const c = withCodes[0].bodyPmCodes[0];
      pmNumber = pmNumber || c.pmNumber || ''; pmIssuer = pmIssuer || c.pmIssuer || ''; pmVolume = c.pmVolume || pmVolume;
      notes.push(`pmCode taken from the title page ${withCodes[0].ident.dmc}.`);
    } else if (withCodes.length > 1) {
      const issuers = new Set(withCodes.map((d) => d.bodyPmCodes[0].pmIssuer));
      if (issuers.size === 1 && !pmIssuer) pmIssuer = [...issuers][0] ?? '';
      notes.push(`${withCodes.length} title pages quote different publication codes; the publication number could not be decided and is set to 00001.`);
    }
  }
  if (!pmIssuer) {
    const code = mostCommon(dms.map((d) => d.ident.originatorCode ?? '').filter((c) => !PLACEHOLDER_ENTERPRISE.has(c)), (c) => c);
    pmIssuer = code ?? '00000';
    if (!code) notes.push('No enterprise code to use as the publication issuer; left as 00000 - set it in the publication settings.');
  }

  const latest = dms.map((d) => d.ident.issueDate).filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => `${a.year}${a.month}${a.day}`.localeCompare(`${b.year}${b.month}${b.day}`)).pop();
  const existingTitle = existing?.pmTitle && !PLACEHOLDER_TITLE.test(existing.pmTitle.trim()) ? existing.pmTitle : '';
  const pmTitle = title?.ident.techName || existingTitle || opts.projectName || `${model} publication`;
  const orig = title ? enterprise(title, 'originator') : dms[0] ? enterprise(dms[0], 'originator') : undefined;
  const rpc = title ? enterprise(title, 'responsiblePartnerCompany') : dms[0] ? enterprise(dms[0], 'responsiblePartnerCompany') : undefined;
  const real = (e: ReturnType<typeof enterprise>) => (e && !PLACEHOLDER_ENTERPRISE.has(e.enterpriseCode) ? e : undefined);

  const meta: PmMeta = {
    pmCode: { modelIdentCode: model, pmIssuer, pmNumber: pmNumber || '00001', pmVolume },
    language: { countryIsoCode: lang?.countryIsoCode || existing?.language?.countryIsoCode || 'IN', languageIsoCode: lang?.languageIsoCode || existing?.language?.languageIsoCode || 'en' },
    issueInfo: existing?.issueInfo?.issueNumber ? { ...existing.issueInfo } : { issueNumber: '001', inWork: '00' },
    issueDate: latest ? { year: latest.year, month: latest.month, day: latest.day } : existing?.issueDate?.year ? { ...existing.issueDate } : isoToday(),
    pmTitle,
    shortPmTitle: existing?.shortPmTitle && !PLACEHOLDER_TITLE.test(existing.shortPmTitle.trim()) ? existing.shortPmTitle : pmTitle,
    securityClassification: title?.ident.security || existing?.securityClassification || '01',
    rpc: real(rpc) ?? (existing?.rpc && !PLACEHOLDER_ENTERPRISE.has(existing.rpc.enterpriseCode) ? existing.rpc : undefined),
    originator: real(orig) ?? (existing?.originator && !PLACEHOLDER_ENTERPRISE.has(existing.originator.enterpriseCode) ? existing.originator : undefined),
  };
  if (!title) notes.push('No title-page module (info code 001); the publication title was taken from ' + (existingTitle ? 'the PMC' : opts.projectName ? 'the project name' : 'the model code') + '.');
  return { meta, notes };
}

function isoToday(): Record<string, string> {
  const d = new Date();
  return { year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1).padStart(2, '0'), day: String(d.getUTCDate()).padStart(2, '0') };
}

/** The structure of a reconstructed publication: title page first, then the hierarchy. */
export function synthesiseEntries(dms: DmRec[], ownCode?: Record<string, string>): PmEntry[] {
  const content = dms.filter((d) => !d.isBrex && d.ident.dmc);
  const title = pickTitlePage(content, ownCode);
  const rest = title ? content.filter((d) => d !== title) : content;
  return [...(title ? [entryForDm(title)] : []), ...groupByHierarchy(rest)];
}

/** `PMC-RDR-1671Y-00039-00_001-01_EN-IN.xml` */
export function pmcFileName(meta: PmMeta): string {
  const c = meta.pmCode;
  return `PMC-${c.modelIdentCode}-${c.pmIssuer}-${c.pmNumber}-${c.pmVolume || '00'}_${meta.issueInfo.issueNumber}-${meta.issueInfo.inWork}_${meta.language.languageIsoCode.toUpperCase()}-${meta.language.countryIsoCode}.xml`;
}

/** The PM file text, with a comment that survives a re-scan so a reconstructed publication is never mistaken for an authored one. */
export function synthesisePmText(meta: PmMeta, entries: PmEntry[], reason: string): string {
  return withReconstructedMarker(serialisePm({ meta, entries }), reason);
}

/** The comment that says a publication module was rebuilt by the importer (the file's only durable flag: the vendored writer keeps no comments). */
export function withReconstructedMarker(xml: string, reason: string): string {
  const marker = `<!-- ${RECONSTRUCTED_MARKER}: ${reason.replace(/--/g, '-')} -->`;
  return xml.replace(/^(<\?xml[^>]*\?>\r?\n)/, `$1${marker}\n`);
}
