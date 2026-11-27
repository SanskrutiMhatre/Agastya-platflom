// Cross-engine conversion: a project (or an uploaded package / document) of one format becomes a NEW project of another.
//
//        S1000D  ->  JSS      the older tool's own S1000D-to-JSS mapping (the package importer, services/jss/rwi), front matter set aside, codes kept
//        S1000D  ->  JSG      the same mapping, written as a JSG document
//        JSS     ->  JSG      the document carried block for block (jsg-model.ts)
//        JSG     ->  JSS      the same, into the stencil's chapters (matched by title; otherwise by position when the counts agree; otherwise appended to the last chapter)
//        JSS     ->  S1000D   the package export (services/jss/rwi/exporter), imported into a new S1000D project by the platform's own S1000D importer
//        JSG     ->  S1000D   JSG -> JSS first, then as above
//
// The source is never changed. Everything the target format cannot hold is returned as a finding (nothing is dropped silently), and the document codes (DMC / PMC / ICN) are kept in the
// new project's identity record (identity.ts): the source package's own when it had them, generated from the structure when not.
// The old PDF Publication Tool is not called or changed: its S1000D-to-JSS stage is the vendored one the publisher already ships.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { projectDirFor } from '../../context';
import { bad } from '../http';
import { placeholderPng } from '../importer/png';
import { applyImport } from '../importer/apply';
import { isJsgProject, readSource as readJsg, writeSource as writeJsg } from '../jsg/service';
import { authoredMeta, isJssAuthored, jssTypeOfProject, readSource as readJss, writeSource as writeJss } from '../jss/service';
import { jssTypeById } from '../jss/registry';
import { isSection, parseJss, serializeJss, type Block, type Chapter, type JssDocument, type Section } from '../jss/rwi/canonical';
import { planExport } from '../jss/rwi/exporter';
import { importRwiProject, loadAndMap } from '../jss/rwi/importer';
import { readRecord as readRwiRecord } from '../jss/rwi/record';
import { Findings, type Finding } from '../jss/rwi/report';
import { readPackage, RwiPackageError } from '../jss/rwi/source';
import { createProject, clearImportPending, csdbRel, discardProject, isS1000dProject, markImportPending, mediaRel, pmRel, readProjectJson, type ProjectCard, type User } from '../projects';
import { adoptFromContents } from '../projectConfig';
import { restoreSettings } from '../packageSettings';
import { ZipStreamWriter } from '../zipio';
import { jsgBodyXml, parseJsg, withJsgBody, type JsgAppendix } from './jsg-model';
import { identityOf } from './project';

export type Format = 's1000d' | 'jss' | 'jsg';
export const FORMATS: readonly Format[] = ['s1000d', 'jss', 'jsg'];
export const label = (f: Format): string => (f === 's1000d' ? 'S1000D' : f.toUpperCase());

/** What can be converted to what. Every pair of different formats is offered; `how` says what happens, for the screen that asks. */
export const MATRIX: Array<{ from: Format; to: Format; how: string }> = [
  { from: 's1000d', to: 'jss', how: 'The S1000D documents become the sections of the JSS chapters; the front-matter pages are set aside (a JSS handbook makes its own); the documents\' codes are kept.' },
  { from: 's1000d', to: 'jsg', how: 'The same, written as a JSG document.' },
  { from: 'jss', to: 'jsg', how: 'Chapters, sections and blocks are carried over; sub-sections become clauses.' },
  { from: 'jss', to: 's1000d', how: 'Each section becomes a data module, the chapters a publication module, the pictures numbered pictures; the project\'s own codes are used.' },
  { from: 'jsg', to: 'jss', how: 'Chapters are matched to the JSS chapters by title; clauses become sub-sections; appendices become sections of the last chapter.' },
  { from: 'jsg', to: 's1000d', how: 'JSG is carried to JSS first, then exported as S1000D.' },
];

/** Where the new project goes and what kind of manual it is (JSS: domain and manual type; JSG: manual type). Without them: no folder, a Land User Handbook. */
export interface TargetOpts { folder?: string; domain?: string; manualType?: string }

export interface ConvertResult {
  ok: true; from: Format; to: Format; project: ProjectCard; findings: Finding[];
  counts: { chapters: number; sections: number; pictures: number };
  /** the new project's document codes (JSS / JSG targets) */
  identity?: { modelIdentCode: string; modules: number; pictures: number; imported: number };
  /** what the S1000D importer reported (S1000D target) */
  imported?: { dms: number; media: number; withProblems: number };
}

// ── the source ──────────────────────────────────────────────────────────────────────────────────────────────────

interface Hub {
  from: Format;
  name: string;
  findings: Findings;
  /** the canonical document (JSS and JSG sources); an S1000D source is mapped when the target needs it */
  doc?: JssDocument;
  appendices: JsgAppendix[];
  mediaDir: string | null;
  /** an S1000D package on disk (an S1000D source) */
  zip?: string;
  /** the source project, when there is one */
  projectId?: string;
  cleanup: Array<() => void>;
}

export const formatOfProject = (projectId: string): Format => (isJsgProject(projectId) ? 'jsg' : isJssAuthored(projectId) ? 'jss' : 's1000d');

const tmpFile = (ext: string): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xengine-')), `package${ext}`);
const rm = (p: string): void => { try { fs.rmSync(path.dirname(p), { recursive: true, force: true }); } catch { /* temp */ } };

/** An S1000D project as a package on disk: its data modules, its publication module and its pictures, so the package importer can read it like any other. */
async function zipOfS1000dProject(projectId: string): Promise<string> {
  const pj = readProjectJson(projectId); const dir = projectDirFor(projectId); const file = tmpFile('.zip');
  const out = fs.createWriteStream(file); const z = new ZipStreamWriter(out);
  const csdb = path.join(dir, csdbRel(pj)); const media = path.join(dir, mediaRel(pj)); const pm = path.join(dir, pmRel(pj));
  const walk = async (d: string, prefix: string, only?: RegExp): Promise<void> => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p, `${prefix}/${e.name}`, only); else if (!only || only.test(e.name)) await z.addFile(`${prefix}/${e.name}`, p); }
  };
  // WP-09 (QA-021, PUB-008): ICN artwork uploaded through the product lives beside the data modules (csdb/); it goes into the package too,
  // or the converted project has no pictures. The package reader recognises a picture by its ICN- name wherever it is.
  await walk(csdb, 'csdb', /\.xml$|^ICN-/i); await walk(media, 'Media');
  if (fs.existsSync(pm)) await z.addFile(`PM/${path.basename(pm)}`, pm);
  await z.finish();
  return file;
}

export async function hubFromProject(projectId: string): Promise<Hub> {
  const from = formatOfProject(projectId); const pj = readProjectJson(projectId);
  const hub: Hub = { from, name: String(pj.name ?? 'Project'), findings: new Findings(), appendices: [], mediaDir: path.join(projectDirFor(projectId), 'Media'), projectId, cleanup: [] };
  if (from === 'jss') hub.doc = parseJss(readJss(projectId).xml);
  else if (from === 'jsg') {
    if (pj.jsgDocType && pj.jsgDocType !== 'uhb') throw bad('Only a JSG User Handbook can be converted: an Illustrated Spare Parts List (plates, parts) has no counterpart in JSS or S1000D.', 'JSG_TYPE_NOT_CONVERTIBLE');
    const p = parseJsg(readJsg(projectId).xml, hub.findings); hub.doc = p.doc; hub.appendices = p.appendices;
    if (p.plates) hub.findings.add('warning', 'plates-dropped', `${p.plates} plate${p.plates === 1 ? '' : 's'} of the document have no counterpart and were left out.`);
    if (p.front) hub.findings.add('info', 'front-not-carried', 'The front pages of the JSG document (amendments, warnings, abbreviations ...) are made by the target format from its own settings and were not carried.');
  } else { hub.zip = await zipOfS1000dProject(projectId); hub.cleanup.push(() => rm(hub.zip!)); hub.mediaDir = null; }
  return hub;
}

/** An uploaded file: a package (.zip: S1000D, or the older tool's export) or one authored document (.xml: JSS or JSG). `source` is a format, or "auto". */
export async function hubFromUpload(file: string, originalName: string, source: Format | 'auto'): Promise<Hub> {
  const hub: Hub = { from: 's1000d', name: originalName.replace(/(\.jsspub)?\.[A-Za-z0-9]+$/, '').slice(0, 70) || 'Imported', findings: new Findings(), appendices: [], mediaDir: null, cleanup: [] };
  if (/\.zip$/i.test(originalName)) {
    if (source === 'jss' || source === 'jsg') throw bad(`A ZIP package holds S1000D documents (or the older publishing tool's export); it is not a ${label(source)} document. Choose S1000D as the source, or upload the ${label(source)} document's XML file.`, 'WRONG_SOURCE');
    hub.zip = file; return hub;
  }
  const xml = fs.readFileSync(file, 'utf8');
  const root = /<(jssbook|jsgdoc)\b/.exec(xml)?.[1];
  if (!root) throw bad('This is not a package (.zip) or a JSS / JSG document (.xml).', 'NOT_A_PACKAGE');
  const detected: Format = root === 'jssbook' ? 'jss' : 'jsg';
  if (source !== 'auto' && source !== detected) throw bad(`The file is a ${label(detected)} document, not ${label(source)}. Choose ${label(detected)} (or Detect) as the source.`, 'WRONG_SOURCE');
  hub.from = detected;
  try {
    if (detected === 'jss') hub.doc = parseJss(xml);
    else { const p = parseJsg(xml, hub.findings); if (p.type !== 'uhb') throw new Error('Only a JSG User Handbook can be converted.'); hub.doc = p.doc; hub.appendices = p.appendices; }
  } catch (e) { throw bad(`The document could not be read: ${(e as Error).message}`, 'DOCUMENT_UNREADABLE'); }
  hub.findings.add('info', 'no-pictures', 'A lone document carries no picture files; pictures are not part of the result.');
  return hub;
}

// ── mapping into a fixed set of chapters (JSS) ───────────────────────────────────────────────────────────────────

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Headings deeper than the stencil allows are written as a bold line in their parent, keeping the content. `depth` is the level of the container (the chapter is 1). */
function clamp(children: Array<Block | Section>, depth: number, max: number, findings: Findings, where: string): Array<Block | Section> {
  const out: Array<Block | Section> = [];
  for (const c of children) {
    if (!isSection(c)) { out.push(c); continue; }
    if (depth + 1 > max) {
      findings.add('warning', 'depth-flattened', `The heading "${c.title}" is deeper than this handbook allows; it was written as a bold line in its parent.`, where);
      out.push({ k: 'para', inline: [{ t: 'mark', mark: 'b', children: [{ t: 'text', text: c.title }] }] }, ...clamp(c.children, depth, max, findings, where));
    } else out.push({ ...c, children: clamp(c.children, depth + 1, max, findings, `${where} > ${c.title}`) });
  }
  return out;
}

export function intoStencil(doc: JssDocument, appendices: JsgAppendix[], titles: string[], maxDepth: number, findings: Findings): Chapter[] {
  const slots: Array<Chapter | null> = titles.map(() => null); const left: Chapter[] = [];
  for (const c of doc.chapters) { const i = titles.findIndex((t, k) => !slots[k] && norm(t) === norm(c.title)); if (i >= 0) slots[i] = c; else left.push(c); }
  const samePlan = doc.chapters.length === titles.length;
  const rest: Chapter[] = [];
  for (const c of left) {
    const i = samePlan ? doc.chapters.indexOf(c) : -1;
    if (samePlan && i >= 0 && !slots[i]) { slots[i] = c; findings.add('warning', 'chapter-by-position', `The chapter "${c.title}" was placed as chapter ${i + 1}, "${titles[i]}", by its position (no chapter of that title). Check that it belongs there.`, c.title); }
    else rest.push(c);
  }
  const last = titles.length - 1;
  const out: Chapter[] = titles.map((title, i) => ({ k: 'chapter' as const, number: i + 1, title, ...(slots[i]?.id ? { id: slots[i]!.id } : {}), children: slots[i] ? clamp(slots[i]!.children, 1, maxDepth, findings, titles[i]) : [] }));
  const add: Section[] = [];
  for (const c of rest) {
    findings.add('warning', 'chapter-appended', `The chapter "${c.title}" has no chapter of that title in this handbook; its content was added to the last chapter, "${titles[last]}", as a section.`, c.title);
    add.push({ k: 'section', title: c.title, children: c.children });
  }
  for (const a of appendices) {
    findings.add('warning', 'appendix-appended', `The appendix ${a.label} "${a.title}" was added to the last chapter, "${titles[last]}", as a section (a JSS handbook has no appendices).`, `Appendix ${a.label}`);
    add.push({ k: 'section', title: `${a.label ? `${a.label} - ` : ''}${a.title}`, children: a.blocks });
  }
  out[last].children = [...out[last].children, ...clamp(add, 1, maxDepth, findings, titles[last])];
  for (let i = 0; i < out.length; i++) if (!slots[i] && !(i === last && add.length)) findings.add('info', 'chapter-empty', `The handbook's chapter "${titles[i]}" has no counterpart in the source and is empty.`, titles[i]);
  return out;
}

const countsOf = (chapters: Chapter[]): { chapters: number; sections: number } => {
  let sections = 0; const walk = (c: Array<Block | Section>): void => { for (const x of c) if (isSection(x)) { sections++; walk(x.children); } };
  for (const c of chapters) walk(c.children);
  return { chapters: chapters.filter((c) => c.children.length).length, sections };
};

function copyMedia(from: string | null, to: string): number {
  if (!from || !fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true }); let n = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) if (e.isFile()) { fs.copyFileSync(path.join(from, e.name), path.join(to, e.name)); n++; }
  return n;
}

const identitySummary = (projectId: string): ConvertResult['identity'] => {
  try { const { view } = identityOf(projectId); return { modelIdentCode: view.modelIdentCode, modules: view.modules.length, pictures: view.pictures.length, imported: view.counts.imported }; } catch { return undefined; }
};

// ── the targets ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The canonical document of an S1000D source: the package mapped onto the User Handbook's chapters (the contents list's own headings decide where a document goes). */
async function mapS1000d(hub: Hub, findings: Findings): Promise<{ doc: JssDocument; pictures: Array<{ media: string; read?: () => Promise<Buffer>; placeholder?: string }>; close(): void }> {
  const type = jssTypeById('uhb');
  if (!type?.chapters) throw bad('The JSS User Handbook is not available.', 'IMPORT_TYPE');
  let pkg;
  try { pkg = await readPackage(hub.zip!); } catch (e) { if (e instanceof RwiPackageError) throw bad(e.message, e.code); throw e; }
  try {
    const { mapped } = await loadAndMap(pkg, type.chapters.map((c) => c.title), type.maxDepth, findings);
    const pictures = mapped.mediaFiles.map((f) => ({ media: f.media, ...(f.from ? { read: () => pkg.readPicture(f.from!) } : {}), ...(f.placeholderFor !== undefined ? { placeholder: f.placeholderFor } : {}) }));
    return { doc: mapped.doc, pictures, close: () => pkg.close() };
  } catch (e) { pkg.close(); throw e; }
}

// WP-06 (REL-004): a project made by a conversion is marked pending until convertHub has its result; a server stop in between leaves
// the mark, and the next start removes the half-made project.
const newProject = async (user: User, input: Parameters<typeof createProject>[1]): Promise<ProjectCard> => {
  const card = await createProject(user, input); markImportPending(card.id, 'conversion'); return card;
};

async function toJss(user: User, hub: Hub, name: string, opts: TargetOpts): Promise<ConvertResult> {
  const card = await newProject(user, { name, folder: opts.folder, format: 'jss', domain: opts.domain || 'land', manualType: opts.manualType || 'uhb' }); const id = card.id;
  try {
    const type = jssTypeOfProject(id); if (!type?.chapters) throw bad('This kind of JSS manual has no chapter plan to import into yet. Choose another manual type.', 'IMPORT_TYPE');
    if (hub.from === 's1000d') {
      // the package importer: front matter set aside, codes and originals kept in the project's package record, identity seeded from it
      const out = await importRwiProject(id, hub.zip!);
      const imp = out.import; for (const f of imp.findings) hub.findings.add(f.severity, f.code, f.message, f.where, f.detail);
      return { ok: true, from: hub.from, to: 'jss', project: card, findings: hub.findings.list, counts: { chapters: imp.counts.chapters, sections: imp.counts.sections, pictures: imp.counts.pictures }, identity: identitySummary(id) };
    }
    const titles = type.chapters.map((c) => c.title);
    const chapters = intoStencil(hub.doc!, hub.appendices, titles, type.maxDepth, hub.findings);
    const current = authoredMeta(readJss(id).xml);
    const meta: Record<string, string> = { ...current };
    for (const [k, v] of Object.entries(hub.doc!.meta)) if (v && !meta[k] && k !== 'bookName') meta[k] = v;
    if (!meta.bookName) meta.bookName = type.defaultBookName;
    const xml = serializeJss({ docType: type.id, schemaVersion: '1.0', meta, chapters });
    const pictures = copyMedia(hub.mediaDir, path.join(projectDirFor(id), 'Media'));
    await writeJss(id, xml);
    return { ok: true, from: hub.from, to: 'jss', project: card, findings: hub.findings.list, counts: { ...countsOf(chapters), pictures }, identity: identitySummary(id) };
  } catch (e) { try { discardProject(id, 'conversion failed'); } catch { /* leave nothing half-made */ } throw e; }
}

async function toJsg(user: User, hub: Hub, name: string, opts: TargetOpts): Promise<ConvertResult> {
  if ((opts.manualType || 'uhb') !== 'uhb') throw bad('Only a JSG User Handbook can be made from another format: an Illustrated Spare Parts List (plates, parts) has no counterpart in S1000D or JSS. Choose User Handbook.', 'JSG_TYPE_NOT_CONVERTIBLE');
  const card = await newProject(user, { name, folder: opts.folder, format: 'jsg', domain: 'land', manualType: 'uhb' }); const id = card.id;
  let close = (): void => undefined;
  try {
    let doc = hub.doc; let pictures = 0;
    const media = path.join(projectDirFor(id), 'Media');
    if (hub.from === 's1000d') {
      const m = await mapS1000d(hub, hub.findings); doc = m.doc; close = m.close;
      fs.mkdirSync(media, { recursive: true });
      for (const p of m.pictures) { const dest = path.join(media, p.media); if (path.relative(media, dest).startsWith('..')) continue; if (p.read) { fs.writeFileSync(dest, await p.read()); pictures++; } else if (p.placeholder !== undefined) fs.writeFileSync(dest, placeholderPng(p.placeholder)); }
    } else pictures = copyMedia(hub.mediaDir, media);
    const body = jsgBodyXml(doc!, hub.appendices, hub.findings);
    const xml = withJsgBody(readJsg(id).xml, body, doc!.meta);
    await writeJsg(id, xml);
    return { ok: true, from: hub.from, to: 'jsg', project: card, findings: hub.findings.list, counts: { ...countsOf(doc!.chapters), pictures }, identity: identitySummary(id) };
  } catch (e) { try { discardProject(id, 'conversion failed'); } catch { /* leave nothing half-made */ } throw e; } finally { close(); }
}

/** The package files of a JSS (or JSG, through a short-lived JSS copy) document, as the S1000D importer reads them. */
async function exportEntries(user: User, hub: Hub, name: string): Promise<{ entries: Array<{ name: string; bytes: Uint8Array }>; findings: Finding[] }> {
  let projectId = hub.projectId; let temp: string | null = null;
  const direct = hub.from === 'jss' && projectId && readRwiRecord(projectId);
  if (!direct) {
    // a copy that carries the project's codes: the model code is the identity record's, so no "Project code" has to be asked for
    const card = await newProject(user, { name: `${name} (export)`.slice(0, 80), format: 'jss', domain: 'land', manualType: 'uhb' }); temp = card.id;
    try {
      const type = jssTypeOfProject(temp)!;
      const chapters = hub.from === 'jss' ? hub.doc!.chapters : intoStencil(hub.doc!, hub.appendices, type.chapters!.map((c) => c.title), type.maxDepth, hub.findings);
      const code = (hub.doc!.meta.projectCode || (hub.projectId ? safeMic(hub.projectId) : '') || name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14)).trim() || 'JSSDOC';
      const meta = { ...authoredMeta(readJss(temp).xml), ...Object.fromEntries(Object.entries(hub.doc!.meta).filter(([, v]) => v)), projectCode: code };
      copyMedia(hub.mediaDir, path.join(projectDirFor(temp), 'Media'));
      await writeJss(temp, serializeJss({ docType: type.id, schemaVersion: '1.0', meta, chapters }));
      projectId = temp;
    } catch (e) { try { discardProject(temp, 'temporary export copy'); } catch { /* temp */ } throw e; }
  }
  try {
    const plan = await planExport(projectId!);
    for (const f of plan.report.findings) hub.findings.add(f.severity, f.code, f.message, f.where, f.detail);
    if (plan.blocked) throw bad(`The document cannot be exported as S1000D yet: ${plan.report.findings.filter((f) => f.severity === 'error').map((f) => f.message).slice(0, 3).join(' ')}`, 'EXPORT_BLOCKED');
    const entries = plan.files.map((f) => ({ name: f.name, bytes: new Uint8Array(f.data ?? fs.readFileSync(f.abs!)) }));
    return { entries, findings: hub.findings.list };
  } finally { if (temp) { try { discardProject(temp, 'temporary export copy'); } catch { /* temp */ } } }
}
const safeMic = (projectId: string): string => { try { return identityOf(projectId).view.modelIdentCode; } catch { return ''; } };

async function toS1000d(user: User, hub: Hub, name: string, opts: TargetOpts): Promise<ConvertResult> {
  const card = await newProject(user, { name, folder: opts.folder, format: 's1000d' }); const id = card.id;
  try {
    let entries: Array<{ name: string; bytes: Uint8Array }>;
    if (hub.from === 's1000d') {
      const { ZipFileReader } = await import('../zipio');
      const z = ZipFileReader.open(hub.zip!); entries = [];
      try { for (const e of z.entries) if (!e.isDirectory) entries.push({ name: e.name, bytes: new Uint8Array(await z.readBuffer(e)) }); } finally { z.close(); }
    } else entries = (await exportEntries(user, hub, name)).entries;
    const res = await applyImport(id, entries, { publication: 'replace' }, { id: user.id, username: user.username, role: user.role }, 'owner');
    // What the data modules say about enterprises is CHECKED against the Administrator's lists but only REPORTED (services/importer/apply.ts): a foreign package names enterprises that are not
    // registered here and could not be brought in at all otherwise. Said once per reason, not once per file.
    const why = new Map<string, string[]>();
    for (const p of res.withProblems) { const files = why.get(p.problem) ?? []; files.push(p.file); why.set(p.problem, files); }
    for (const [problem, files] of why) {
      const hint = /enterprise (code|name)/i.test(problem) ? ' The data modules were imported as received. An Administrator can register the enterprise (Administrator > RPC CAGE codes and Originator CAGE codes) so that new data modules may use it.' : '';
      hub.findings.add('warning', 'import-problem', files.length === 1 ? `${files[0]}: ${problem}${hint}` : `${problem} (${files.length} data modules, for example ${files.slice(0, 3).join(', ')}).${hint}`);
    }
    if (hub.from === 's1000d') {                                  // the ordinary S1000D import: the identity follows the data modules, and a package made by this platform brings its settings back
      adoptFromContents(id, user.id);
      let raw: unknown;
      for (const e of entries) if (/^(AGASTYA-)?manifest\.json$/i.test(e.name.replace(/\\/g, '/').split('/').pop() ?? '')) { try { raw = JSON.parse(Buffer.from(e.bytes).toString('utf8'))?.project?.settings; } catch { raw = undefined; } break; }
      try { const s = restoreSettings(id, user.id, raw); if (s.restored.length) hub.findings.add('info', 'settings-restored', `Restored from the package: ${s.restored.join(', ')}.`); for (const n of s.notes) hub.findings.add('info', 'settings-note', n); }
      catch (e) { hub.findings.add('warning', 'settings-not-restored', `The package settings could not be applied: ${(e as Error).message}`); }
    }
    return { ok: true, from: hub.from, to: 's1000d', project: card, findings: hub.findings.list, counts: { chapters: hub.doc ? countsOf(hub.doc.chapters).chapters : 0, sections: res.imported.dms.length, pictures: res.imported.media.length }, imported: { dms: res.imported.dms.length, media: res.imported.media.length, withProblems: res.withProblems.length } };
  } catch (e) { try { discardProject(id, 'conversion failed'); } catch { /* leave nothing half-made */ } throw e; }
}

/** Convert the hub to the target format as a new project called `name`. The source is not changed. */
export async function convertHub(user: User, hub: Hub, to: Format, name: string, opts: TargetOpts = {}): Promise<ConvertResult> {
  if (!FORMATS.includes(to)) throw bad('Choose S1000D, JSS or JSG as the target.', 'BAD_TARGET');
  // a project (or a lone JSS / JSG document) is never converted to its own format; an uploaded S1000D package imported as S1000D is the platform's ordinary S1000D import into a new project
  if (hub.from === to && (hub.projectId || !hub.zip)) throw bad(`The source is already ${label(to)}. Choose a different target format.`, 'SAME_FORMAT');
  const nm = String(name || `${hub.name} (${label(to)})`).trim().slice(0, 80);
  try {
    const out = to === 'jss' ? await toJss(user, hub, nm, opts) : to === 'jsg' ? await toJsg(user, hub, nm, opts) : await toS1000d(user, hub, nm, opts);
    if (out.project?.id) clearImportPending(out.project.id);
    return out;
  }
  finally { for (const c of hub.cleanup) c(); }
}
