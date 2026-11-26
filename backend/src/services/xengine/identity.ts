// The S1000D metadata of a JSS or JSG project, kept in the backend.
//
// A JSS or JSG document does not need data module codes (DMC), a publication module code (PMC) or picture names (ICN), and its editor does not show them. They are still kept,
// because the document can be exported as S1000D, converted to another engine, or came from a package that already had them. This file is the one place that makes and keeps them:
//
//   <project>/doc-identity.json   the record: the codes of every module, the PMC, every picture's ICN, and which of them the editor shows (all off by default)
//
// Rules - these are the ones the brief asks for ("generated automatically, unique, driven from systems / sub-systems, no random creations"):
//   * a code is made from the document's own structure: a chapter is a SYSTEM, a section of the chapter is a SUB-SYSTEM (or, when the project's SNS names it, the SNS row's codes);
//   * nothing is random: the same document always gets the same codes, in the same order;
//   * a code is made once and kept: editing, moving or renaming a section does not change it; a removed section keeps its code reserved (it is never given to another section);
//   * every code is unique inside the project (checked against every code ever made, imported ones included);
//   * a code that came with an imported package is kept exactly as received (origin "imported") and is never replaced.
// Pure where it can be (`reconcile` takes the outline and the record, returns the record); the file and the project's settings are read in `loadOrCreate` / `save` only.

import fs from 'fs';
import path from 'path';
import { nowIso } from '../../config';
import { projectDirFor } from '../../context';
import { bad } from '../http';
import { normTitle, type Outline, type OutlineModule } from './outline';

export const IDENTITY_FILE = 'doc-identity.json';

export interface DmcCode {
  modelIdentCode: string; systemDiffCode: string; systemCode: string; subSystemCode: string; subSubSystemCode: string; assyCode: string;
  disassyCode: string; disassyCodeVariant: string; infoCode: string; infoCodeVariant: string; itemLocationCode: string;
}
export type Origin = 'generated' | 'imported';
export interface IdModule {
  key: string; kind: OutlineModule['kind']; chapter: number; title: string; code: DmcCode; origin: Origin;
  /** The module is no longer in the document. Its code stays reserved. */
  retired?: boolean;
  /** Where an imported module came from (the file it was received as). */
  source?: string;
}
export interface IdPicture { key: string; icn: string; file: string; module: string; origin: Origin; retired?: boolean }
export interface PmIdentity { pmIssuer: string; pmNumber: string; pmVolume: string; issueNumber: string; inWork: string; languageIsoCode: string; countryIsoCode: string; title: string; origin: Origin }
export interface Visibility { dmc: boolean; pmc: boolean; icn: boolean; toc: boolean }
export interface IdentityRecord {
  version: 1; format: 'jss' | 'jsg'; modelIdentCode: string; systemDiffCode: string; pm: PmIdentity;
  modules: IdModule[]; pictures: IdPicture[]; show: Visibility; counters: { picture: number }; updatedAt: string;
}

// ── codes ───────────────────────────────────────────────────────────────────────────────────────────────────────

const pad = (n: number, w: number): string => String(n).padStart(w, '0');
/** The 35 characters a sub-system code is taken from (0 is kept for "the system itself"). */
const SUB = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DEFAULT_SHOW: Visibility = { dmc: false, pmc: false, icn: false, toc: false };

export const dmcString = (c: DmcCode): string => `DMC-${[c.modelIdentCode, c.systemDiffCode, c.systemCode, `${c.subSystemCode}${c.subSubSystemCode}`, c.assyCode, `${c.disassyCode}${c.disassyCodeVariant}`, `${c.infoCode}${c.infoCodeVariant}`, c.itemLocationCode].join('-')}`;
export const pmcString = (m: string, p: PmIdentity): string => `PMC-${m}-${p.pmIssuer}-${p.pmNumber}-${p.pmVolume}`;
const issueText = (p: PmIdentity): string => `${p.issueNumber}-${p.inWork}`;
const langText = (p: PmIdentity): string => `${p.languageIsoCode.toUpperCase()}-${p.countryIsoCode.toUpperCase()}`;
export const dmcFileName = (c: DmcCode, p: PmIdentity): string => `${dmcString(c)}_${issueText(p)}_${langText(p)}.xml`;
export const pmcFileName = (m: string, p: PmIdentity): string => `${pmcString(m, p)}_${issueText(p)}_${langText(p)}.xml`;

const RULES = {
  modelIdentCode: /^[A-Z0-9]{2,14}$/, systemDiffCode: /^[A-Z0-9]{1,4}$/, pmIssuer: /^[A-Z0-9]{5}$/, pmNumber: /^[A-Z0-9]{5}$/, pmVolume: /^[A-Z0-9]{2}$/,
  languageIsoCode: /^[a-z]{2,3}$/, countryIsoCode: /^[A-Z]{2}$/,
} as const;

/** The system code of a chapter: the SNS row that carries the chapter's title when the project has one, else the chapter number (01, 02 ...). */
export interface SnsHint { systemTitle(title: string): { systemCode: string; subSystemTitle(t: string): { subSystemCode: string } | null } | null }

function systemOf(chapter: number, title: string, sns: SnsHint | null, fixed?: string): { systemCode: string; sub: ((t: string) => { subSystemCode: string } | null) | null } {
  // a chapter that already has imported sections keeps their system code: new sections of the chapter belong to the same system
  if (fixed) return { systemCode: fixed, sub: null };
  const row = sns?.systemTitle(title) ?? null;
  if (row) return { systemCode: row.systemCode, sub: row.subSystemTitle };
  if (chapter > 99) throw bad('A document with more than 99 chapters, appendices and plates cannot be given system codes.', 'IDENTITY_TOO_MANY_CHAPTERS');
  return { systemCode: pad(chapter, 2), sub: null };
}

function newCode(rec: IdentityRecord, mod: OutlineModule, chapterTitle: string, used: Set<string>, sns: SnsHint | null, fixed?: string): DmcCode {
  const sys = systemOf(mod.chapter, chapterTitle, sns, fixed);
  const base = { modelIdentCode: rec.modelIdentCode, systemDiffCode: rec.systemDiffCode, systemCode: sys.systemCode, subSubSystemCode: '0', disassyCode: '00', disassyCodeVariant: 'A', infoCode: '040', infoCodeVariant: 'A', itemLocationCode: 'D' };
  // the chapter's own text is the system itself (sub-system 0, assembly 00)
  if (mod.kind === 'chapter-intro') {
    const c: DmcCode = { ...base, subSystemCode: '0', assyCode: '00' };
    if (!used.has(dmcString(c))) return c;
  }
  // an SNS row of the system that carries the section's title names its sub-system
  const hit = sys.sub?.(mod.title);
  if (hit) { const c: DmcCode = { ...base, subSystemCode: hit.subSystemCode, assyCode: '00' }; if (!used.has(dmcString(c))) return c; }
  // else the lowest free slot of the system: sub-system 1..Z, then the next assembly row (00..99)
  for (let slot = 1; slot <= 35 * 100; slot++) {
    const i = slot - 1; const c: DmcCode = { ...base, subSystemCode: SUB[i % 35], assyCode: pad(Math.floor(i / 35), 2) };
    if (!used.has(dmcString(c))) return c;
  }
  throw bad(`Chapter ${mod.chapter} has more sections than can be given codes.`, 'IDENTITY_TOO_MANY_MODULES');
}

// ── the record ──────────────────────────────────────────────────────────────────────────────────────────────────

export const identityPath = (projectId: string): string => path.join(projectDirFor(projectId), IDENTITY_FILE);

export interface ProjectFacts {
  format: 'jss' | 'jsg';
  /** The model identification code the project's settings already carry (S1000D configuration), if any. */
  settingsMic?: string;
  /** The originator's enterprise code, for the publication code and the picture names. */
  enterpriseCode?: string;
  languageIsoCode?: string; countryIsoCode?: string;
  /** What the project is called; only used to make a model code when nothing else names one. */
  projectName?: string;
}

const alnum = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The model identification code: the project settings', else the document's Project code, else made from the book name - kept once chosen. */
function modelIdentOf(outline: Outline, facts: ProjectFacts): string {
  for (const cand of [facts.settingsMic ?? '', outline.meta.projectCode ?? '', outline.meta.projectName ?? '', outline.meta.bookName ?? '', facts.projectName ?? '']) {
    const a = alnum(cand).slice(0, 14); if (RULES.modelIdentCode.test(a)) return a;
  }
  return facts.format === 'jsg' ? 'JSGDOC' : 'JSSDOC';
}

function pmOf(outline: Outline, facts: ProjectFacts): PmIdentity {
  const issuer = alnum(facts.enterpriseCode ?? '').padEnd(5, '0').slice(0, 5);
  const digits = (outline.meta.publicationNo ?? outline.meta.docNo ?? '').replace(/\D/g, '').slice(-5);
  return {
    pmIssuer: RULES.pmIssuer.test(issuer) ? issuer : '00000', pmNumber: digits ? digits.padStart(5, '0') : '00001', pmVolume: '00', issueNumber: '001', inWork: '00',
    languageIsoCode: facts.languageIsoCode ?? 'en', countryIsoCode: (facts.countryIsoCode ?? 'IN').toUpperCase(),
    title: outline.meta.bookName || outline.meta.title || outline.meta.projectName || facts.projectName || 'Publication', origin: 'generated',
  };
}

export function emptyRecord(outline: Outline, facts: ProjectFacts): IdentityRecord {
  return { version: 1, format: facts.format, modelIdentCode: modelIdentOf(outline, facts), systemDiffCode: 'A', pm: pmOf(outline, facts), modules: [], pictures: [], show: { ...DEFAULT_SHOW }, counters: { picture: 0 }, updatedAt: nowIso() };
}

export function readRecord(projectId: string): IdentityRecord | null {
  try {
    const r = JSON.parse(fs.readFileSync(identityPath(projectId), 'utf8')) as IdentityRecord;
    return r && r.version === 1 && Array.isArray(r.modules) ? { ...r, show: { ...DEFAULT_SHOW, ...(r.show ?? {}) }, pictures: r.pictures ?? [], counters: r.counters ?? { picture: 0 } } : null;
  } catch { return null; }
}

export function writeRecord(projectId: string, rec: IdentityRecord): void {
  fs.writeFileSync(identityPath(projectId), JSON.stringify(rec, null, 1), 'utf8');
}

export interface ReconcileResult { added: number; retired: number; revived: number; rekeyed: number; picturesAdded: number; changed: boolean }

/**
 * Bring the record in line with the document. Modules are matched, in this order, by key (their `id`, or chapter + title), by chapter + title (when the key changed because an id was
 * added or removed), and - when exactly as many modules were renamed as records are left over in a chapter - by position. What is left over in the document gets a new code; what is
 * left over in the record is retired (kept, reserved, not shown). Never changes a code.
 */
export function reconcile(rec: IdentityRecord, outline: Outline, sns: SnsHint | null = null, facts: Pick<ProjectFacts, 'enterpriseCode'> = {}): ReconcileResult {
  const before = JSON.stringify({ m: rec.modules, p: rec.pictures });
  const claimed = new Set<IdModule>(); const match = new Map<OutlineModule, IdModule>();
  let rekeyed = 0;
  const take = (m: OutlineModule, n: IdModule, rekey: boolean): void => { match.set(m, n); claimed.add(n); if (rekey && n.key !== m.key) { n.key = m.key; rekeyed++; } };

  for (const m of outline.modules) { const n = rec.modules.find((x) => x.key === m.key && !claimed.has(x)); if (n) take(m, n, false); }
  for (const m of outline.modules) {
    if (match.has(m)) continue;
    const n = rec.modules.find((x) => !claimed.has(x) && x.chapter === m.chapter && x.kind === m.kind && normTitle(x.title) === normTitle(m.title));
    if (n) take(m, n, true);
  }
  for (const ch of new Set(outline.modules.map((m) => m.chapter))) {
    const left = outline.modules.filter((m) => m.chapter === ch && !match.has(m));
    const spare = rec.modules.filter((x) => !claimed.has(x) && !x.retired && x.chapter === ch && x.kind !== 'chapter-intro');
    if (left.length && left.length === spare.length && left.every((m) => m.kind === 'section')) left.forEach((m, i) => take(m, spare[i], true));
  }

  const used = new Set(rec.modules.map((m) => dmcString(m.code))); let added = 0; let revived = 0;
  const importedSystem = new Map<number, string>();
  for (const ch of new Set(rec.modules.filter((m) => m.origin === 'imported' && !m.retired).map((m) => m.chapter))) {
    const count = new Map<string, number>(); for (const m of rec.modules) if (m.origin === 'imported' && !m.retired && m.chapter === ch) count.set(m.code.systemCode, (count.get(m.code.systemCode) ?? 0) + 1);
    importedSystem.set(ch, [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  }
  // a section whose title an SNS row names takes that row's sub-system BEFORE the others take the lowest free one, so the sequence never uses up a number a row owns
  const named = (m: OutlineModule): boolean => !!systemOf(m.chapter, outline.chapters.find((c) => c.number === m.chapter)?.title ?? '', sns, importedSystem.get(m.chapter)).sub?.(m.title);
  const order = [...outline.modules.filter((m) => match.has(m)), ...outline.modules.filter((m) => !match.has(m) && named(m)), ...outline.modules.filter((m) => !match.has(m) && !named(m))];
  for (const m of order) {
    let n = match.get(m);
    if (n) { if (n.retired) { delete n.retired; revived++; } n.title = m.title; n.chapter = m.chapter; n.kind = m.kind; continue; }
    const chapterTitle = outline.chapters.find((c) => c.number === m.chapter)?.title ?? '';
    const code = newCode(rec, m, chapterTitle, used, sns, importedSystem.get(m.chapter));
    n = { key: m.key, kind: m.kind, chapter: m.chapter, title: m.title, code, origin: 'generated' };
    used.add(dmcString(code)); rec.modules.push(n); match.set(m, n); claimed.add(n); added++;
  }
  let retired = 0;
  for (const n of rec.modules) if (!claimed.has(n) && !n.retired) { n.retired = true; retired++; }

  // pictures: one ICN each, made once, the first time the picture is used
  const usedIcn = new Set(rec.pictures.map((p) => p.icn)); let picturesAdded = 0; const seenPic = new Set<string>();
  const cage = alnum(facts.enterpriseCode ?? rec.pm.pmIssuer).padEnd(5, '0').slice(0, 5);
  for (const m of outline.modules) {
    const owner = match.get(m)!;
    for (const file of m.pictures) {
      if (seenPic.has(file)) continue; seenPic.add(file);
      const have = rec.pictures.find((p) => p.key === file);
      if (have) { if (have.retired) delete have.retired; if (!claimed.has(owner) || have.module !== owner.key) have.module = owner.key; continue; }
      let icn: string; let origin: Origin = 'generated';
      if (/^icn-/i.test(file)) { icn = file.replace(/\.[A-Za-z0-9]+$/, '').toUpperCase().replace(/^ICN-/, 'ICN-'); origin = 'imported'; }
      else {
        const sns6 = `${owner.code.systemCode}${owner.code.subSystemCode}${owner.code.subSubSystemCode}${owner.code.assyCode}`;
        do { rec.counters.picture++; icn = `ICN-${rec.modelIdentCode}-${rec.systemDiffCode}-${sns6}-1-${cage}-${pad(rec.counters.picture, 5)}-A-001-01`; } while (usedIcn.has(icn));
      }
      usedIcn.add(icn);
      const ext = /\.[A-Za-z0-9]+$/.exec(file)?.[0] ?? '.png';
      rec.pictures.push({ key: file, icn, file: `${icn}${ext}`, module: owner.key, origin }); picturesAdded++;
    }
  }
  for (const p of rec.pictures) if (!seenPic.has(p.key) && !p.retired) p.retired = true;

  const changed = JSON.stringify({ m: rec.modules, p: rec.pictures }) !== before;
  if (changed) rec.updatedAt = nowIso();
  return { added, retired, revived, rekeyed, picturesAdded, changed };
}

// ── settings the user may change ───────────────────────────────────────────────────────────────────────────────────

export interface IdentityPatch { modelIdentCode?: string; systemDiffCode?: string; pmIssuer?: string; pmNumber?: string; pmVolume?: string; languageIsoCode?: string; countryIsoCode?: string; title?: string }

/** Change the identity of the whole publication. A new model code is written into every code that was generated (imported codes stay as they came); nothing else moves. */
export function applyPatch(rec: IdentityRecord, patch: IdentityPatch): void {
  const check = (name: keyof typeof RULES, value: unknown): string => {
    const v = String(value ?? '').trim(); const norm = name === 'languageIsoCode' ? v.toLowerCase() : v.toUpperCase();
    if (!RULES[name].test(norm)) throw bad(`"${name}" is not valid: ${({ modelIdentCode: '2 to 14 capital letters or digits', systemDiffCode: '1 to 4 capital letters or digits', pmIssuer: '5 capital letters or digits', pmNumber: '5 capital letters or digits', pmVolume: '2 capital letters or digits', languageIsoCode: 'a language code such as en', countryIsoCode: 'a country code such as IN' })[name]}.`, 'BAD_IDENTITY');
    return norm;
  };
  if (patch.modelIdentCode !== undefined) {
    const mic = check('modelIdentCode', patch.modelIdentCode); const old = rec.modelIdentCode;
    if (mic !== old) {
      const taken = new Set(rec.modules.filter((m) => m.origin === 'imported').map((m) => dmcString(m.code)));
      for (const m of rec.modules) if (m.origin === 'generated') { m.code.modelIdentCode = mic; if (taken.has(dmcString(m.code))) throw bad('The new model code would repeat the code of an imported section.', 'IDENTITY_DUPLICATE'); }
      for (const p of rec.pictures) if (p.origin === 'generated') { p.icn = p.icn.replace(`ICN-${old}-`, `ICN-${mic}-`); p.file = p.file.replace(`ICN-${old}-`, `ICN-${mic}-`); }
      rec.modelIdentCode = mic;
    }
  }
  if (patch.systemDiffCode !== undefined) rec.systemDiffCode = check('systemDiffCode', patch.systemDiffCode);
  if (patch.pmIssuer !== undefined) rec.pm = { ...rec.pm, pmIssuer: check('pmIssuer', patch.pmIssuer), origin: 'generated' };
  if (patch.pmNumber !== undefined) rec.pm = { ...rec.pm, pmNumber: check('pmNumber', patch.pmNumber) };
  if (patch.pmVolume !== undefined) rec.pm = { ...rec.pm, pmVolume: check('pmVolume', patch.pmVolume) };
  if (patch.languageIsoCode !== undefined) rec.pm = { ...rec.pm, languageIsoCode: check('languageIsoCode', patch.languageIsoCode) };
  if (patch.countryIsoCode !== undefined) rec.pm = { ...rec.pm, countryIsoCode: check('countryIsoCode', patch.countryIsoCode) };
  if (patch.title !== undefined) rec.pm = { ...rec.pm, title: String(patch.title).slice(0, 200) };
  rec.updatedAt = nowIso();
}

export function applyVisibility(rec: IdentityRecord, show: Partial<Visibility>): void {
  for (const k of ['dmc', 'pmc', 'icn', 'toc'] as const) { if (show[k] === undefined) continue; if (typeof show[k] !== 'boolean') throw bad(`"${k}" must be true or false.`, 'BAD_BODY'); rec.show[k] = show[k] as boolean; }
  rec.updatedAt = nowIso();
}

// ── the view the screens and the exporters read ────────────────────────────────────────────────────────────────────

export interface IdentityView {
  format: 'jss' | 'jsg'; modelIdentCode: string; systemDiffCode: string; show: Visibility;
  pmc: { code: string; file: string; title: string; issue: string; language: string; pmIssuer: string; pmNumber: string; pmVolume: string; origin: Origin };
  modules: Array<{ key: string; chapter: number; title: string; kind: string; dmc: string; file: string; code: DmcCode; origin: Origin; source?: string }>;
  pictures: Array<{ file: string; icn: string; packageFile: string; module: string; origin: Origin }>;
  toc: Array<{ level: number; number: string; title: string; dmc: string | null }>;
  counts: { modules: number; pictures: number; retired: number; imported: number };
}

export function viewOf(rec: IdentityRecord, outline: Outline): IdentityView {
  const live = rec.modules.filter((m) => !m.retired); const byKey = new Map(live.map((m) => [m.key, m]));
  const at = (k: string): number => { const i = outline.modules.findIndex((x) => x.key === k); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const modules = [...live].sort((a, b) => at(a.key) - at(b.key) || a.chapter - b.chapter)
    .map((m) => ({ key: m.key, chapter: m.chapter, title: m.title, kind: m.kind, dmc: dmcString(m.code), file: dmcFileName(m.code, rec.pm), code: m.code, origin: m.origin, ...(m.source ? { source: m.source } : {}) }));
  const pics = rec.pictures.filter((p) => !p.retired);
  return {
    format: rec.format, modelIdentCode: rec.modelIdentCode, systemDiffCode: rec.systemDiffCode, show: rec.show,
    pmc: { code: pmcString(rec.modelIdentCode, rec.pm), file: pmcFileName(rec.modelIdentCode, rec.pm), title: rec.pm.title, issue: issueText(rec.pm), language: langText(rec.pm), pmIssuer: rec.pm.pmIssuer, pmNumber: rec.pm.pmNumber, pmVolume: rec.pm.pmVolume, origin: rec.pm.origin },
    modules, pictures: pics.map((p) => ({ file: p.key, icn: p.icn, packageFile: p.file, module: p.module, origin: p.origin })),
    toc: outline.toc.map((t) => ({ level: t.level, number: t.number, title: t.title, dmc: t.module && byKey.get(t.module) ? dmcString(byKey.get(t.module)!.code) : null })),
    counts: { modules: modules.length, pictures: pics.length, retired: rec.modules.length - live.length, imported: live.filter((m) => m.origin === 'imported').length },
  };
}
