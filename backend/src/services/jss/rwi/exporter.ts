// The export: one action that turns the JSS project into the package it was (or would have been) delivered as.
//
//   JSS document + source record (if the project was imported) + Media  ->  documents (DMC) + contents list (PMC) + pictures (ICN)  ->  checks  ->  files for the ZIP
//
// A document the author did not change is written back exactly as it was received (compared by a fingerprint of its JSS section). A changed or new one is written by the serializers
// (serialize.ts). Nothing is written until every check has run; a problem that makes the package unusable is an error and stops the export, anything else is reported.
// The JSS XML files are only read, never renamed or altered.

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { projectDirFor } from '../../../context';
import { bad } from '../../http';
import { placeholderPng } from '../../importer/png';
import { isJssAuthored, readSource } from '../service';
import { nativeProblemOfProject } from '../native';
import { fingerprintSection, isSection, parseJss, type Block, type Section } from './canonical';
import { readOriginal, readRecord, type RecordModule, type SourceRecord } from './record';
import type { ExportReport, Finding } from './report';
import { Findings } from './report';
import { DEFAULT_ROOT, codeAttrs, contentXml, dmcFileName, doctypeFor, documentXml, generatedIdentity, generatedPmHead, icnNameFor, identAndStatusXml, pmcXml, type ModuleIdentity, type PmcChapter, type PmcLayout, type PmcModule, type SerializeCtx } from './serialize';
import { schemaCheck } from './validate';
import { exportIdentity } from '../../xengine/project';

export interface ExportFile { name: string; data?: Buffer; abs?: string }
export interface ExportPlan { fileName: string; files: ExportFile[]; report: ExportReport; blocked: boolean }

const MEDIA_EXT = /\.(png|jpe?g|gif|bmp|svg|tiff?)$/i;
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const safeName = (s: string): string => s.replace(/[^\w.\- ]/g, '_').trim() || 'Package';

export async function planExport(projectId: string): Promise<ExportPlan> {
  if (!isJssAuthored(projectId)) throw bad('Export is available in a JSS document project.', 'EXPORT_TYPE');
  const findings = new Findings();
  const notNative = nativeProblemOfProject(projectId);
  if (notNative) throw bad(`This document cannot be exported: ${notNative}`, 'NOT_NATIVE_JSS');
  let doc;
  let sourceXml = '';
  try { sourceXml = readSource(projectId).xml; doc = parseJss(sourceXml); }
  catch (e) { throw bad(`The document could not be read for export: ${(e as Error).message}`, 'EXPORT_UNREADABLE'); }
  const rec: SourceRecord | null = readRecord(projectId);
  const dir = projectDirFor(projectId); const media = path.join(dir, 'Media');
  const recBySection = new Map<string, RecordModule>(rec?.modules.map((m) => [m.sectionId, m]) ?? []);
  // the project's own document codes (services/xengine): a section the package never had is numbered by its place in the document's structure, not by a running count
  const idn = rec ? null : exportIdentity(projectId, sourceXml);
  // pages of an imported package that are not sections of the handbook (its front matter, each chapter's heading page): written back as received, and listed in the contents list where they stood
  const keptOthers = (rec?.others ?? []).filter((o) => o.issueDate?.year && o.issueDate.month && o.issueDate.day).flatMap((o) => { const text = readOriginal(projectId, o.rel); return text === null ? [] : [{ o, text }]; });
  const pageModule = (o: NonNullable<SourceRecord['others']>[number]): PmcModule => ({ identity: { code: o.code, issue: o.issue, language: o.language, issueDate: o.issueDate!, techName: o.techName ?? o.title, infoName: o.infoName ?? '' }, pmTitle: o.techName ?? '' });
  if (rec?.others?.length && keptOthers.length < rec.others.length) findings.add('info', 'pages-not-restored', `${rec.others.length - keptOthers.length} front-matter or chapter-heading page${rec.others.length - keptOthers.length === 1 ? '' : 's'} of the imported package cannot be put back (the project was imported before they were kept). Import the package again to keep them.`);

  // identity of the package
  const projectCode = (rec ? rec.modules[0]?.code.modelIdentCode : '') || (doc.meta.projectCode ?? '').trim();
  if (!rec && !/^[A-Za-z0-9]{2,14}$/.test(projectCode)) {
    findings.add('error', 'project-code', 'Set a Project code (2 to 14 letters or digits) in the document\'s details before exporting. It is used to number the sections in the exported package.', 'Document details');
  }
  const language = rec?.modules[0]?.language ?? { languageIsoCode: 'en', countryIsoCode: 'US' };
  const today = new Date();
  const root = safeName(rec?.root || (doc.meta.bookName ?? '') || projectCode);

  // pictures: Media file -> the name the picture has in the package
  const pictureEntity = new Map<string, string>();      // media file (lower) -> entity
  const recPics = new Map<string, { entity: string; placeholder: boolean }>();
  for (const m of rec?.modules ?? []) for (const p of m.pictures) recPics.set(p.media.toLowerCase(), { entity: p.entity, placeholder: p.missing });
  const packagePictures = new Map<string, { file: string; abs: string }>();   // entity -> file in the package
  const skippedPlaceholders = new Set<string>();
  const mediaAbs = (name: string): string | null => { const abs = path.join(media, name); return path.relative(media, abs).startsWith('..') || !fs.existsSync(abs) ? null : abs; };
  const entityOf = (name: string): string => {
    const key = name.toLowerCase(); const hit = pictureEntity.get(key); if (hit) return hit;
    const known = recPics.get(key); const abs = mediaAbs(name);
    let entity = known?.entity ?? name.replace(MEDIA_EXT, '');
    const ext = (/\.[A-Za-z0-9]+$/.exec(name)?.[0] ?? '.png').toLowerCase();
    if (known?.placeholder && abs && fs.readFileSync(abs).equals(placeholderPng(known.entity))) { skippedPlaceholders.add(known.entity); pictureEntity.set(key, entity); return entity; }
    if (!abs) { findings.add('warning', 'picture-missing', `A picture used in the document (${name}) is not in the project's pictures; the reference is kept but the picture cannot be included.`, name); pictureEntity.set(key, entity); return entity; }
    if (!known && !/^ICN-/i.test(name)) { entity = idn?.icnFor(name, projectCode || idn.modelIdentCode) ?? icnNameFor(projectCode || 'PIC', fs.readFileSync(abs)); findings.add('info', 'picture-renamed', `The picture "${name}" was given the standard picture name ${entity}${ext} in the package.`, name); }
    packagePictures.set(entity, { file: `${entity}${ext}`, abs });
    pictureEntity.set(key, entity);
    return entity;
  };

  const files: ExportFile[] = []; const pmc: PmcChapter[] = []; const usedCodes = new Set<string>(rec?.modules.map((m) => m.key) ?? []);
  let kept = 0; let rebuilt = 0; let created = 0; let seq = 0; const notes = new Map<string, Set<string>>(); const dmTexts: Array<{ name: string; where: string; text: string; generated: boolean }> = [];
  const seen = new Set<string>();

  const note = (code: string, where: string): void => { (notes.get(code) ?? notes.set(code, new Set()).get(code)!).add(where); };

  const rebuild = (s: Section, identity: ModuleIdentity, head: { rootStart: string; identAndStatus: string }, r: RecordModule | null): string => {
    const att = new Map<string, Map<string, string[]>>();
    for (const a of r?.attachments ?? []) { const t = att.get(a.tableId) ?? new Map<string, string[]>(); const k = `${a.group}:${a.row}:${a.col}`; t.set(k, [...(t.get(k) ?? []), a.xml]); att.set(a.tableId, t); }
    const ctx: SerializeCtx = { originalIds: new Map([...(r?.tables ?? []), ...(r?.figures ?? [])].map((x) => [x.id, x.original])), entityOf, attachments: att, used: new Set(), notes: [] };
    const content = contentXml(s, ctx);
    for (const n of ctx.notes) note(n, s.title);
    const entities = [...ctx.used].filter(Boolean).map((e) => ({ entity: e, file: packagePictures.get(e)?.file ?? `${e}.png` }));
    return documentXml(head.rootStart, doctypeFor(entities), head.identAndStatus, content);
  };

  doc.chapters.forEach((chapter, ci) => {
    const modules: PmcChapter['modules'] = [];
    const own = chapter.children.filter((c): c is Block => !isSection(c));
    const subs = chapter.children.filter(isSection);
    const parts: Section[] = own.length ? [{ k: 'section', id: `chapter-${chapter.number}-own`, title: chapter.title, children: own }, ...subs] : subs;
    for (const [pi, s] of parts.entries()) {
      const r = s.id ? recBySection.get(s.id) : undefined;
      let name: string; let text: string; let identity: ModuleIdentity; let generated = true; let pmTitle = '';
      if (r) {
        seen.add(r.sectionId);
        identity = { code: r.code, issue: r.issue, language: r.language, issueDate: r.issueDate, techName: r.techName, infoName: r.infoName }; pmTitle = r.pmTitle; name = r.rel;
        const original = readOriginal(projectId, r.rel);
        if (original !== null && createHash('sha256').update(fingerprintSection(s)).digest('hex') === r.fingerprint) { text = original; kept++; generated = false; for (const p of r.pictures) if (!p.missing && p.file) { const abs = mediaAbs(p.media); if (abs) packagePictures.set(p.entity, { file: p.file, abs }); } }
        else {
          if (original === null) findings.add('warning', 'original-missing', `The saved original of "${s.title}" is missing, so it was written from the document.`, s.title);
          text = rebuild(s, identity, { rootStart: r.rootStart, identAndStatus: r.identAndStatus }, r); rebuilt++;
        }
      } else {
        let n = seq; let key: string; let id: ModuleIdentity;
        const given = idn?.moduleAt(chapter.number, pi);
        const numbered = (): void => { do { id = generatedIdentity(projectCode || 'PROJECT', n++, s.title, language, today); key = dmcFileName(id.code); } while (usedCodes.has(key) && n < 100000); };
        id = undefined as unknown as ModuleIdentity; key = '';
        if (given) { id = { ...generatedIdentity(projectCode || 'PROJECT', 0, s.title, language, today), code: { ...given, modelIdentCode: projectCode || given.modelIdentCode } }; key = dmcFileName(id.code); if (usedCodes.has(key)) numbered(); } else numbered();
        seq = n; usedCodes.add(key); identity = id; name = `XML/${key}.xml`;
        text = rebuild(s, identity, { rootStart: DEFAULT_ROOT, identAndStatus: identAndStatusXml(identity) }, null); created++;
      }
      dmTexts.push({ name, where: s.title, text, generated });
      files.push({ name: `${root}/${name}`, data: Buffer.from(text, 'utf8') });
      modules.push({ identity, pmTitle });
    }
    const heading = keptOthers.find((k) => k.o.kind === 'chapter-heading' && k.o.chapter === chapter.number);
    const srcTitle = rec?.chapters.find((c) => c.number === chapter.number)?.sourceTitle;
    pmc.push({ title: srcTitle || chapter.title, modules, number: chapter.number, ...(heading ? { heading: pageModule(heading.o) } : {}) });
    void ci;
  });
  for (const r of rec?.modules ?? []) if (!seen.has(r.sectionId)) findings.add('info', 'section-removed', `"${r.heading || r.techName}" was removed from the document, so it is not in the exported package.`, r.heading || r.techName);

  // the pictures an imported project carried, used or not
  for (const p of rec?.pictures ?? []) { if (p.placeholder) continue; const abs = mediaAbs(p.media); if (abs && p.file) { const entity = p.file.replace(MEDIA_EXT, ''); if (![...packagePictures.values()].some((x) => x.file === p.file)) packagePictures.set(entity, { file: p.file, abs }); } }
  for (const e of skippedPlaceholders) findings.add('warning', 'picture-missing', `The picture ${e} was missing from the original package and is still missing; a placeholder is not exported.`, e);

  // the contents list
  const head = rec ? { rootStart: rec.publication.rootStart, identAndStatus: rec.publication.identAndStatus } : generatedPmHead(projectCode || 'PROJECT', doc.meta.bookName || root, language, today, idn?.pm);
  const front = keptOthers.filter((k) => k.o.kind === 'front-matter').map((k) => ({ title: k.o.title, module: pageModule(k.o) }));
  const layout: PmcLayout | undefined = keptOthers.length ? { title: rec?.publication.title || doc.meta.bookName || root, front } : undefined;
  const pmcText = pmcXml(pmc, head, layout);
  const pmcName = rec ? rec.publication.rel : `PMC-${projectCode || 'PROJECT'}-${idn?.pm.pmIssuer ?? '00000'}-${idn?.pm.pmNumber ?? '00001'}-${idn?.pm.pmVolume ?? '00'}.xml`;
  files.push({ name: `${root}/${pmcName}`, data: Buffer.from(pmcText, 'utf8') });
  for (const k of keptOthers) files.push({ name: `${root}/${k.o.rel}`, data: Buffer.from(k.text, 'utf8') });
  for (const { file, abs } of new Map([...packagePictures.values()].map((p) => [p.file, p])).values()) files.push({ name: `${root}/ICN/${file}`, abs });

  // checks before anything is written
  if (!fs.existsSync(media) && packagePictures.size === 0 && dmTexts.some((d) => /infoEntityIdent=/.test(d.text))) findings.add('warning', 'no-media', 'The document uses pictures but the project has no pictures folder.');
  for (const d of dmTexts) {
    if (d.generated) {
      const r = await schemaCheck(d.text, '4.2', 'descript.xsd');
      if (r.unchecked) findings.add('info', 'schema-unchecked', `"${d.where}" could not be checked against the standard (${r.unchecked}).`, d.where);
      for (const e of r.errors.slice(0, 4)) findings.add('error', 'schema-error', `"${d.where}" does not meet the package's structure rules: ${e.message}`, d.where, `line ${e.line}`);
    }
    for (const m of d.text.matchAll(/infoEntityIdent="([^"]+)"/g)) if (!packagePictures.has(m[1]) && !skippedPlaceholders.has(m[1])) findings.add('warning', 'picture-unresolved', `"${d.where}" refers to a picture (${m[1]}) that is not in the package.`, d.where, m[1]);
  }
  const pr = await schemaCheck(pmcText, '4.2', 'pm.xsd');
  for (const e of pr.errors.slice(0, 4)) findings.add(rec ? 'warning' : 'error', 'publication-schema-error', rec ? `The contents list keeps a structure problem the original package had: ${e.message}` : `The contents list does not meet the package's structure rules: ${e.message}`, undefined, `line ${e.line}`);
  // a file may carry its issue and language in its name (DMC-...-D_001-00_EN-IN.xml, the older publishing tool's way): the contents list names the document by its code alone
  const have = new Set(dmTexts.map((d) => path.posix.basename(d.name).replace(/\.xml$/i, '').replace(/_[0-9]{3}-[0-9]{2}(_[A-Za-z]{2,3}-[A-Za-z]{2})?$/, '')));
  for (const c of pmc) for (const m of c.modules) if (!have.has(dmcFileName(m.identity.code))) findings.add('error', 'reference-unresolved', `The contents list names a section (${m.identity.techName}) that was not written to the package.`, m.identity.techName);
  if (!dmTexts.length) findings.add('error', 'empty-export', 'The document has no sections to export.');

  const labels: Record<string, string> = {
    'list-style': 'Lettered and roman-numeral lists are exported as numbered lists.', 'page-break': 'Page breaks are not part of the package format and were left out.',
    'figure-legend': 'A figure\'s numbered key was not exported (the package format has no place for it).', 'notice-list': 'A list inside a note or warning was exported as plain paragraphs.',
  };
  for (const [code, where] of notes) findings.add('info', `export-${code}`, `${labels[code] ?? code} (${[...where].slice(0, 3).join(', ')}${where.size > 3 ? ', …' : ''})`);

  const report: ExportReport = {
    ok: true, fileName: `${root}.zip`, findings: findings.list,
    counts: { documents: dmTexts.length, chapters: pmc.filter((c) => c.modules.length).length, pictures: [...packagePictures.values()].length, picturesMissing: skippedPlaceholders.size, documentsKept: kept, documentsRebuilt: rebuilt + created },
  };
  const blocked = findings.errors > 0;
  if (!blocked) files.push({ name: `${root}/EXPORT-REPORT.txt`, data: Buffer.from(reportText(report), 'utf8') });
  void sha;
  return { fileName: report.fileName, files, report, blocked };
}

function reportText(r: ExportReport): string {
  const line = (f: Finding): string => `[${f.severity}] ${f.message}${f.detail ? ` (${f.detail})` : ''}`;
  return [`Export report`, ``, `Sections written: ${r.counts.documents} (${r.counts.documentsKept} unchanged from the original, ${r.counts.documentsRebuilt} written from the document)`, `Chapters: ${r.counts.chapters}`, `Pictures: ${r.counts.pictures}, missing: ${r.counts.picturesMissing}`, ``, ...(r.findings.length ? r.findings.map(line) : ['Nothing to report.']), ``].join('\r\n');
}

export { codeAttrs };
