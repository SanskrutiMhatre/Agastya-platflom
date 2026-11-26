// The RWI import adapter, end to end:
//
//   RWI ZIP -> extraction -> XML parsing -> validation -> mapping -> canonical JSS model -> the project's JSS document (and its pictures, and the source record)
//
// The adapter never changes the JSS schema, the editor or the S1000D code. It writes through the same save path the editor uses (writeSource), so the JSS rules run on what it produced.

import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../../../context';
import { assertNativeJssXml, nativeProblemOfProject } from '../native';
import { bad } from '../../http';
import { placeholderPng } from '../../importer/png';
import { authoredMeta, isJssAuthored, jssTypeOfProject, readSource, writeSource, type JssReport } from '../service';
import { createHash } from 'crypto';
import { fingerprintSection, isSection, parseJss, serializeJss, type Section } from './canonical';
import { mapPackage } from './map';
import { writeRecord, type SourceRecord } from './record';
import { emptyCounts, Findings, type ImportReport } from './report';
import { parseModule, parsePublication, readPackage, RwiPackageError, type SourceModule } from './source';
import { validateSource } from './validate';

export interface ImportResult { hash: string; report: JssReport; import: ImportReport }

export async function importRwiProject(projectId: string, zipFile: string): Promise<ImportResult> {
  if (!isJssAuthored(projectId)) throw bad('Importing a project is available in a JSS document project.', 'IMPORT_TYPE');
  const type = jssTypeOfProject(projectId);
  if (!type?.ready || !type.chapters) throw bad('Importing a project is not available for this kind of document yet.', 'IMPORT_TYPE');
  const chapterTitles = type.chapters.map((c) => c.title);

  let pkg;
  try { pkg = await readPackage(zipFile); }
  catch (e) { if (e instanceof RwiPackageError) throw bad(e.message, e.code); throw e; }
  const findings = new Findings();
  try {
    // parse: a file that cannot be read is reported and left out, not fatal
    const modules: SourceModule[] = [];
    for (const f of pkg.modules) {
      try { modules.push(parseModule(f)); }
      catch (e) { findings.add('error', 'document-unreadable', `The file ${f.name} could not be read and was left out: ${(e as Error).message.slice(0, 160)}`, f.name); }
    }
    if (!modules.length) throw bad('None of the documents in this package could be read.', 'NO_MODULES');
    let pub;
    try { pub = parsePublication(pkg.publication!); }
    catch (e) { throw bad(`The package's contents list could not be read: ${(e as Error).message.slice(0, 200)}`, 'BAD_PUBLICATION'); }
    for (const o of pkg.other) findings.add('info', 'file-ignored', `The package contains a file that is not part of the document and was ignored: ${o}`, o);

    await validateSource(pkg, modules, pub, findings);
    const mapped = mapPackage(pkg, modules, pub, chapterTitles, findings, type.maxDepth);

    // the project's own identity is kept; only the body is replaced
    const current = authoredMeta(readSource(projectId).xml);
    mapped.doc.meta = { ...mapped.doc.meta, ...current };
    if (!mapped.doc.meta.bookName) mapped.doc.meta.bookName = type.defaultBookName;
    mapped.doc.docType = type.id;
    const xml = serializeJss(mapped.doc);
    // the fingerprint of each document is taken from the document as it will be READ back (export compares like with like)
    const reread = new Map<string, Section>();
    for (const c of parseJss(xml).chapters) for (const s of c.children) if (isSection(s) && s.id) reread.set(s.id, s);
    for (const o of mapped.modules) { const s = reread.get(o.sectionId); if (s) o.fingerprint = createHash('sha256').update(fingerprintSection(s)).digest('hex'); }

    // pictures first (the document's checks look for them), then the document
    const dir = projectDirFor(projectId); const media = path.join(dir, 'Media'); fs.mkdirSync(media, { recursive: true });
    for (const f of mapped.mediaFiles) {
      const dest = path.join(media, f.media);
      if (path.relative(media, dest).startsWith('..')) continue;
      if (f.from) fs.writeFileSync(dest, await pkg.readPicture(f.from));
      else if (f.placeholderFor !== undefined) fs.writeFileSync(dest, placeholderPng(f.placeholderFor));
    }
    const before = path.join(dir, 'publication.xml');
    if (fs.existsSync(before)) fs.copyFileSync(before, path.join(dir, 'publication.before-import.bak'));
    assertNativeJssXml(xml);                                       // what is about to be written is the JSS document ...
    const saved = await writeSource(projectId, xml);
    const damaged = nativeProblemOfProject(projectId);             // ... and what is on disk afterwards is too; if not, the previous document comes back
    if (damaged) {
      const bak = path.join(dir, 'publication.before-import.bak');
      if (fs.existsSync(bak)) fs.copyFileSync(bak, before);
      throw bad(`The import was undone: ${damaged}`, 'NOT_NATIVE_JSS');
    }

    // the source record
    const counts = emptyCounts();
    counts.chapters = mapped.doc.chapters.length; counts.sections = mapped.counts.sections; counts.paragraphs = mapped.counts.paragraphs; counts.lists = mapped.counts.lists;
    counts.tables = mapped.counts.tables; counts.figures = mapped.counts.figures; counts.documents = mapped.modules.length;
    counts.picturesMissing = new Set(mapped.mediaFiles.filter((f) => f.placeholderFor !== undefined).map((f) => f.media)).size;
    counts.pictures = mapped.mediaFiles.filter((f) => f.from).length; counts.picturesUnused = mapped.mediaFiles.filter((f) => f.from && !f.used).length;
    counts.documentsPlacedByNumber = mapped.modules.filter((m) => m.placedBy === 'number').length;
    const importedAt = new Date().toISOString();
    const report: ImportReport = { ok: true, packageName: pkg.root || path.basename(zipFile), counts, findings: findings.list, importedAt };
    const rel = (f: { rel: string }): string => (pkg.root && f.rel.startsWith(`${pkg.root}/`) ? f.rel.slice(pkg.root.length + 1) : f.rel);
    const relOf = new Map(pkg.modules.map((f) => [f.name, rel(f)]));
    const record: SourceRecord = {
      version: 1, importedAt, packageName: report.packageName, root: pkg.root, stencil: type.id,
      publication: { file: pub.file, rel: rel(pkg.publication!), rootStart: pub.rootStart, identAndStatus: pub.identAndStatus, code: pub.code, language: pub.language, issue: pub.issue, title: pub.title, shortTitle: pub.shortTitle },
      chapters: mapped.chapters.map((c) => ({ number: c.number, stencilTitle: c.stencilTitle, sourceTitle: c.sourceTitle })),
      modules: mapped.modules.map((o) => ({
        file: o.module.file, rel: relOf.get(o.module.file) ?? o.module.file, key: o.module.key, sectionId: o.sectionId, chapter: o.chapter, listed: o.listed, placedBy: o.placedBy, pmTitle: o.pmTitle,
        code: o.module.code, issue: o.module.issue, language: o.module.language, issueDate: o.module.issueDate, techName: o.module.techName, infoName: o.module.infoName, heading: o.module.heading,
        rootStart: o.module.rootStart, identAndStatus: o.module.identAndStatus, doctype: o.module.doctype, schemaLocation: o.module.schemaLocation,
        pictures: o.pictures, attachments: o.attachments, fingerprint: o.fingerprint, tables: o.tables, figures: o.figures, flattened: o.flattened,
      })),
      pictures: mapped.mediaFiles.map((f) => ({ file: f.from?.name ?? '', media: f.media, placeholder: f.placeholderFor !== undefined, used: f.used })),
      findings: findings.list, counts,
    };
    writeRecord(projectId, record, [
      { rel: rel(pkg.publication!), text: pkg.publication!.text },
      ...pkg.modules.map((f) => ({ rel: relOf.get(f.name) ?? f.name, text: f.text })),
    ]);
    return { hash: saved.hash, report: saved.report, import: report };
  } finally { pkg.close(); }
}
