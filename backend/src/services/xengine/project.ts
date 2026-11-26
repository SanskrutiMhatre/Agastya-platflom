// The identity record of one project: where its facts come from (settings, SNS, an imported package) and the few actions on it.
//
//   identityOf(projectId)            the record, made or brought up to date from the document, and the view the screens read
//   syncIdentity(projectId, xml)     called after every save of a JSS / JSG document: keeps the record in step, never fails the save
//   changeIdentity / changeVisibility  the two things a user may set
//
// The editors' XML is never written here. The record sits beside it (doc-identity.json) and joins it by the sections' `id`, or by chapter + title (identity.ts).

import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../../context';
import { bad, notFound } from '../http';
import { readProjectJson } from '../projects';
import { getConfigRow } from '../projectConfig';
import { projectRepo } from '../sns/store';
import { readRecord as readRwiRecord } from '../jss/rwi/record';
import { applyPatch, applyVisibility, emptyRecord, identityPath, readRecord, reconcile, viewOf, writeRecord, type DmcCode, type IdModule, type IdentityPatch, type IdentityRecord, type IdentityView, type ProjectFacts, type ReconcileResult, type SnsHint, type Visibility } from './identity';
import { normTitle, outlineOfJsg, outlineOfJss, pictureName, type Outline, type OutlineModule } from './outline';

const SOURCES = { jss: 'publication.xml', jsg: 'jsg-document.xml' } as const;

export function formatOf(projectId: string): 'jss' | 'jsg' | null {
  const pj = readProjectJson(projectId);
  return pj.format === 'jsg' ? 'jsg' : pj.format === 'jss' && pj.authoring === 'jss-xml' ? 'jss' : null;
}

export const outlineOf = (format: 'jss' | 'jsg', xml: string): Outline => (format === 'jsg' ? outlineOfJsg(xml) : outlineOfJss(xml));

function factsOf(projectId: string, format: 'jss' | 'jsg'): ProjectFacts {
  const pj = readProjectJson(projectId); const cfg = getConfigRow(projectId)?.config;
  return {
    format, settingsMic: cfg?.mic || undefined, enterpriseCode: cfg?.originator?.code || cfg?.responsiblePartner?.code || undefined,
    languageIsoCode: cfg?.language || undefined, countryIsoCode: cfg?.country || undefined, projectName: pj.name,
  };
}

/** The project's own SNS (the row model, `.sns.json`), as far as a chapter or section title can be found in it. Absent or unreadable = no SNS. */
function snsHintOf(projectId: string): SnsHint | null {
  let rows: Array<{ systemCode: string; subSystemCode: string; subSubSystemCode: string; assyCode: string; title: string }> = [];
  try { rows = projectRepo(projectId).list(); } catch { return null; }
  if (!rows.length) return null;
  return {
    systemTitle: (title) => {
      const row = rows.find((r) => !r.subSystemCode && !r.subSubSystemCode && !r.assyCode && normTitle(r.title) === normTitle(title));
      if (!row) return null;
      return { systemCode: row.systemCode, subSystemTitle: (t) => { const s = rows.find((r) => r.systemCode === row.systemCode && r.subSystemCode && !r.subSubSystemCode && !r.assyCode && normTitle(r.title) === normTitle(t)); return s ? { subSystemCode: s.subSystemCode } : null; } };
    },
  } as SnsHint;
}

const CODE_KEYS: Array<keyof DmcCode> = ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'];
export const codeFrom = (c: Record<string, string>): DmcCode => Object.fromEntries(CODE_KEYS.map((k) => [k, c[k] ?? (k === 'itemLocationCode' ? 'D' : '')])) as unknown as DmcCode;

/** A project that was imported from a package already has codes: they are taken over exactly as received, before anything is generated. */
function seedFromImport(projectId: string, rec: IdentityRecord): boolean {
  const imp = readRwiRecord(projectId);
  if (!imp || rec.modules.length) return false;
  for (const m of imp.modules) {
    const mod: IdModule = { key: `id:${m.sectionId}`, kind: 'section', chapter: m.chapter, title: m.heading || m.pmTitle || m.file, code: codeFrom(m.code), origin: 'imported', source: m.file };
    rec.modules.push(mod);
  }
  const first = imp.modules[0];
  if (first) { rec.modelIdentCode = first.code.modelIdentCode || rec.modelIdentCode; rec.systemDiffCode = first.code.systemDiffCode || rec.systemDiffCode; }
  const p = imp.publication;
  rec.pm = {
    pmIssuer: p.code.pmIssuer || rec.pm.pmIssuer, pmNumber: p.code.pmNumber || rec.pm.pmNumber, pmVolume: p.code.pmVolume || rec.pm.pmVolume,
    issueNumber: p.issue.issueNumber || rec.pm.issueNumber, inWork: p.issue.inWork || rec.pm.inWork,
    languageIsoCode: p.language.languageIsoCode || rec.pm.languageIsoCode, countryIsoCode: (p.language.countryIsoCode || rec.pm.countryIsoCode).toUpperCase(), title: p.title || rec.pm.title, origin: 'imported',
  };
  for (const pic of imp.pictures) {
    if (!/^icn-/i.test(pic.file)) continue;
    rec.pictures.push({ key: pic.media.toLowerCase(), icn: pic.file.replace(/\.[A-Za-z0-9]+$/, ''), file: pic.file, module: '', origin: 'imported', ...(pic.placeholder ? { retired: true } : {}) });
  }
  return true;
}

export interface IdentityResult { record: IdentityRecord; view: IdentityView; outline: Outline; result: ReconcileResult | null }

/** Make or update the record from the document as it is now. Writes the file only when something changed. */
export function ensureIdentity(projectId: string, format: 'jss' | 'jsg', outline: Outline): IdentityResult {
  let rec = readRecord(projectId); let dirty = false;
  if (!rec) {
    rec = emptyRecord(outline, factsOf(projectId, format)); dirty = true;
    if (format === 'jss') seedFromImport(projectId, rec);
  }
  const result = reconcile(rec, outline, snsHintOf(projectId), { enterpriseCode: factsOf(projectId, format).enterpriseCode });
  if (dirty || result.changed) writeRecord(projectId, rec);
  return { record: rec, view: viewOf(rec, outline), outline, result };
}

function readOutline(projectId: string): { format: 'jss' | 'jsg'; outline: Outline } {
  const format = formatOf(projectId);
  if (!format) throw notFound('Document codes are kept for JSS and JSG document projects.');
  const abs = path.join(projectDirFor(projectId), SOURCES[format]);
  if (!fs.existsSync(abs)) throw bad('This project has no document yet.', 'NO_DOCUMENT');
  try { return { format, outline: outlineOf(format, fs.readFileSync(abs, 'utf8')) }; }
  catch (e) { throw bad(`The document could not be read: ${(e as Error).message}`, 'DOCUMENT_UNREADABLE'); }
}

export function identityOf(projectId: string): IdentityResult {
  const { format, outline } = readOutline(projectId);
  return ensureIdentity(projectId, format, outline);
}

/** After a save: keep the record in step. A document that cannot be read (a draft) leaves the record as it is; a save is never refused because of the codes. */
export function syncIdentity(projectId: string, format: 'jss' | 'jsg', xml: string): void {
  try { ensureIdentity(projectId, format, outlineOf(format, xml)); } catch (e) { console.warn(`[identity] not updated for ${projectId}: ${(e as Error).message}`); }
}

export function changeIdentity(projectId: string, patch: IdentityPatch): IdentityResult {
  const cur = identityOf(projectId);
  applyPatch(cur.record, patch); writeRecord(projectId, cur.record);
  return { ...cur, view: viewOf(cur.record, cur.outline) };
}

export function changeVisibility(projectId: string, show: Partial<Visibility>): IdentityResult {
  const cur = identityOf(projectId);
  applyVisibility(cur.record, show); writeRecord(projectId, cur.record);
  return { ...cur, view: viewOf(cur.record, cur.outline) };
}

/** A package import replaces the whole document, so the codes are made again from the package: its own codes are kept as received, anything new is generated. What the user chose to show stays. */
export function reseedIdentity(projectId: string): void {
  try {
    if (!formatOf(projectId)) return;
    const old = readRecord(projectId);
    fs.rmSync(identityPath(projectId), { force: true });
    const cur = identityOf(projectId);
    if (old) { cur.record.show = old.show; writeRecord(projectId, cur.record); }
  } catch (e) { console.warn(`[identity] not renewed for ${projectId}: ${(e as Error).message}`); }
}

/** What the exporter takes from the project's identity record: the code of each section (by chapter and position), the publication code, a picture's ICN. Null when the record cannot be made. */
export interface ExportIdentity {
  modelIdentCode: string;
  pm: { pmIssuer: string; pmNumber: string; pmVolume: string };
  moduleAt(chapter: number, index: number): Record<string, string> | null;
  icnFor(media: string, mic: string): string | null;
}
export function exportIdentity(projectId: string, xml: string): ExportIdentity | null {
  try {
    const outline = outlineOfJss(xml); const { record } = ensureIdentity(projectId, 'jss', outline);
    const byKey = new Map(record.modules.map((m) => [m.key, m]));
    const perChapter = new Map<number, OutlineModule[]>();
    for (const m of outline.modules) { const l = perChapter.get(m.chapter) ?? []; l.push(m); perChapter.set(m.chapter, l); }
    return {
      modelIdentCode: record.modelIdentCode, pm: { pmIssuer: record.pm.pmIssuer, pmNumber: record.pm.pmNumber, pmVolume: record.pm.pmVolume },
      moduleAt: (chapter, index) => { const m = perChapter.get(chapter)?.[index]; const r = m ? byKey.get(m.key) : undefined; return r ? { ...r.code } as unknown as Record<string, string> : null; },
      icnFor: (media, mic) => { const p = record.pictures.find((x) => x.key === pictureName(media) && !x.retired); return p ? p.icn.replace(`ICN-${record.modelIdentCode}-`, `ICN-${mic}-`) : null; },
    };
  } catch (e) { console.warn(`[identity] not used for the export of ${projectId}: ${(e as Error).message}`); return null; }
}
