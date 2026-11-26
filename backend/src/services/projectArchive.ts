// =============================================================================
// The project archive: one file that holds a whole project, for any of the three formats (S1000D, JSS, JSG), and brings it back as a new project.
//
//   <name>.jsspub.zip
//     manifest.json        { manifestVersion: 1, generator: "Agastya", id, name, type, templateRef, exportedAt, format, domain, manualType, files, settings? }
//     comments.json        the review comments (only when there are any)
//     project/...          the project's own files: project.json, the publication module / the JSS or JSG document, csdb/, Media/, jss/, jsg/, s1000d/, the SNS and
//                          document-code records, the publish waivers ... everything except what a build writes again (the PDF, the FO, the driver stylesheet,
//                          the generated pictures and logos, the validation state)
//     templates/<ref>.house.json         the house style the project uses
//     templates/brand/<id>/...           the brand pack (logo and company line) the project uses
//
// The layout is the older publishing tool's `.jsspub.zip` (manifest.json + project/ + templates/ + comments.json), so that tool's own import can read it, with these
// additions: the manifest names the format, and an S1000D project carries its configuration (`settings`: the DB-side choices of the project, services/packageSettings).
//
// What comes back is a NEW project (nothing is overwritten): the files are written as they were, the project.json is the archive's apart from the name and the folder,
// the house style and brand pack are written only when this workspace does not have one of that name (the workspace's own is never replaced), and the review comments
// are added under the person who imports, each naming its first author.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import type { Writable } from 'stream';
import { nowIso } from '../config';
import { docIndex, projectDirFor, registryDb, workspace, workspaceDir } from '../context';
import { bad } from './http';
import { createProject, readProjectJson, type User } from './projects';
import { restoreSettings, settingsOf } from './packageSettings';
import { adoptFromContents, dmCount, updateConfig } from './projectConfig';
import * as review from './review';
import { ZipFileReader, ZipStreamWriter, safeEntryName, safeJoin, DEFAULT_LIMITS, ZipError } from './zipio';

const { checkXmlSafety } = require('../core/auth/xmlGuard');

export const ARCHIVE_VERSION = 1;
export const ARCHIVE_GENERATOR = 'Agastya';

/** What a build writes again, at the top of a project: the PDF and its intermediates, the driver stylesheets, generated pictures and logos (`_...`), the validation and publish state. */
const GENERATED = /^(jss-output\.(pdf|fo)|jss-preview\.pdf|jss-run\.xsl|s1000dtofo-run\.xsl|_.*|\.publish-state\.json|\.validation\.json|\.import-reports|.*\.bak)$/i;

export interface ArchiveFile { abs: string; rel: string }

/** The project's own files as [{abs, rel}], rel with forward slashes. */
export function listArchiveFiles(dir: string, base = ''): ArchiveFile[] {
  const out: ArchiveFile[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!base && GENERATED.test(e.name)) continue;
    const abs = path.join(dir, e.name); const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listArchiveFiles(abs, rel));
    else if (e.isFile()) out.push({ abs, rel });
  }
  return out;
}

const BRAND_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** The brand pack a project prints with: its own choice, else the one its house style names. */
function brandPackOf(projectId: string, templateRef: string): string | null {
  const own = readProjectJson(projectId).brandPack;
  if (typeof own === 'string' && BRAND_ID.test(own)) return own;
  try { const h = JSON.parse(fs.readFileSync(path.join(workspace.templatesDir(workspaceDir), `${templateRef}.house.json`), 'utf8')); return typeof h.brandPack === 'string' && BRAND_ID.test(h.brandPack) ? h.brandPack : null; } catch { return null; }
}

export interface ExportInfo { files: number; comments: number; format: string; fileName: string }

/** The name the download carries: the project's id, so two exports of the same project sort together. */
export const archiveFileName = (projectId: string): string => `${projectId}.jsspub.zip`;

export async function exportProjectArchive(projectId: string, out: Writable): Promise<ExportInfo> {
  const dir = projectDirFor(projectId);
  if (!fs.existsSync(dir)) throw bad('This project has no files.', 'NO_PROJECT_DIR');
  const pj = readProjectJson(projectId);
  const format: string = pj.format ?? (pj.type === 'JSS' ? 'jss' : 's1000d');
  const templateRef: string = pj.templateRef || 'default';
  const files = listArchiveFiles(dir);

  const z = new ZipStreamWriter(out);
  const manifest: Record<string, unknown> = {
    manifestVersion: ARCHIVE_VERSION, generator: ARCHIVE_GENERATOR, id: projectId, name: pj.name || projectId, type: pj.type || 'S1000D', templateRef, exportedAt: nowIso(),
    format, domain: pj.domain ?? null, manualType: pj.manualType ?? null, files: files.length,
  };
  if (format === 's1000d') { try { manifest.settings = settingsOf(projectId); } catch { /* a project without a configuration carries none */ } }
  await z.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

  // The review comments travel with the project, keyed by the data module's file name (an id is made per installation), each with the name of its author.
  const comments: Array<ReturnType<typeof review.commentView>> = review.listComments(projectId);
  if (comments.length) {
    await z.addBuffer('comments.json', Buffer.from(JSON.stringify({
      version: 1,
      comments: comments.map((c) => ({ kind: c.kind, rel: c.dmFile, anchor: c.anchor, anchorText: c.anchor?.text ?? null, body: c.body, author: c.byName ?? c.by ?? null, createdAt: c.at, resolvedAt: c.resolvedAt })),
    }, null, 2)));
  }

  for (const f of files) await z.addFile(`project/${f.rel}`, f.abs);

  const tdir = workspace.templatesDir(workspaceDir);
  const house = path.join(tdir, `${templateRef}.house.json`);
  if (BRAND_ID.test(templateRef) && fs.existsSync(house)) await z.addFile(`templates/${templateRef}.house.json`, house);
  const pack = brandPackOf(projectId, templateRef);
  if (pack) {
    const pdir = path.join(tdir, 'brand', pack);
    if (fs.existsSync(pdir) && fs.statSync(pdir).isDirectory()) for (const f of listArchiveFiles(pdir)) await z.addFile(`templates/brand/${pack}/${f.rel}`, f.abs);
  }
  await z.finish();
  return { files: files.length, comments: comments.length, format, fileName: archiveFileName(projectId) };
}

// ── reading one back ──────────────────────────────────────────────────────────────────────────────────

export interface ArchiveManifest { manifestVersion: number; generator?: string; name?: string; type?: string; templateRef?: string; format?: string; domain?: string | null; manualType?: string | null; settings?: unknown; exportedAt?: string }

export interface RestoreFinding { severity: 'info' | 'warning'; message: string }
export interface RestoreResult { project: Awaited<ReturnType<typeof createProject>>; findings: RestoreFinding[]; counts: { files: number; comments: number } }

const TEXT_RE = /\.(xml|xsl|xslt|ent|dtd)$/i;
const TEMPLATE_RE = /^templates\/([a-z0-9][a-z0-9._-]{0,63})\.house\.json$/i;
const BRAND_FILE_RE = /^templates\/brand\/([a-z0-9][a-z0-9._-]{0,63})\/([^/]+)$/i;

/** The manifest of a ZIP when it is a project archive (an Agastya export), else null; never throws for a ZIP that is simply something else. */
export async function readManifestOf(zipPath: string): Promise<ArchiveManifest | null> {
  let r: ZipFileReader | null = null;
  try {
    r = ZipFileReader.open(zipPath, DEFAULT_LIMITS);
    const e = r.entries.find((x) => !x.isDirectory && x.name.replace(/\\/g, '/') === 'manifest.json');
    if (!e || e.size > 4 * 1024 * 1024) return null;
    const m = JSON.parse((await r.readBuffer(e)).toString('utf8')) as ArchiveManifest;
    return m && typeof m === 'object' && m.generator === ARCHIVE_GENERATOR && typeof m.format === 'string' ? m : null;
  } catch { return null; } finally { try { r?.close(); } catch { /* closed */ } }
}

/**
 * Bring an archive back as a new project. Throws a plain refusal (nothing is created) when the file is not an archive, is newer than this version, holds an unsafe path or
 * unsafe XML; once the checks pass the project is created and filled, and if filling fails the half-made project is removed again by the caller's `discard`.
 */
export async function restoreProjectArchive(user: User, zipPath: string, opts: { name?: string; folder?: string; discard?: (id: string) => void } = {}): Promise<RestoreResult> {
  const man = await readManifestOf(zipPath);
  if (!man) throw bad('This ZIP is not a project archive made by this platform.', 'NOT_AN_ARCHIVE');
  if ((man.manifestVersion || 0) > ARCHIVE_VERSION) throw bad('This archive was made by a newer version of the platform.', 'ARCHIVE_TOO_NEW');
  const format = String(man.format);
  if (!['s1000d', 'jss', 'jsg'].includes(format)) throw bad(`The archive names a format this platform does not have (${format}).`, 'ARCHIVE_FORMAT');

  const r = ZipFileReader.open(zipPath, DEFAULT_LIMITS);
  const findings: RestoreFinding[] = [];
  try {
    // 1. nothing is created before the archive has been checked: every name is safe, and every XML file passes the same guard as an upload
    const entries = r.entries.filter((e) => !e.isDirectory);
    for (const e of entries) { try { safeEntryName(e.name); } catch (err) { throw bad(`Import refused: ${(err as ZipError).message}`, 'UNSAFE_ARCHIVE'); } }
    const offenders: string[] = [];
    for (const e of entries) {
      if (!TEXT_RE.test(e.name) || e.size > 64 * 1024 * 1024) continue;
      const g = checkXmlSafety((await r.readBuffer(e)).toString('utf8'));
      if (!g.ok) offenders.push(`${e.name}: ${g.error}`);
    }
    if (offenders.length) throw bad(`Import refused: unsafe XML in the archive:\n${offenders.slice(0, 10).join('\n')}`, 'UNSAFE_XML');
    const projectJson = entries.find((e) => e.name.replace(/\\/g, '/') === 'project/project.json');
    if (!projectJson) throw bad('This archive has no project/project.json.', 'ARCHIVE_INCOMPLETE');
    const src = JSON.parse((await r.readBuffer(projectJson)).toString('utf8'));

    // 2. a new project of the same kind (the engine makes its starting files; the archive's own replace them)
    const card = await createProject(user, { name: opts.name || man.name || 'Imported project', folder: opts.folder, format, domain: man.domain ?? undefined, manualType: man.manualType ?? undefined });
    const id = card.id; const dir = projectDirFor(id);
    try {
      let files = 0;
      for (const e of entries) {
        const name = e.name.replace(/\\/g, '/');
        if (!name.startsWith('project/') || name === 'project/project.json') continue;
        const rel = safeEntryName(name.slice('project/'.length)); const dest = safeJoin(dir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await pipeline(r.open(e), fs.createWriteStream(dest)); files++;
      }
      // 3. the project.json: the archive's, apart from what makes this project this one (its name and folder)
      const now = nowIso();
      const mine = readProjectJson(id);
      const merged = { ...src, name: mine.name, group: mine.group, schemaVersion: mine.schemaVersion ?? src.schemaVersion };
      fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(merged, null, 2), 'utf8');
      registryDb.upsertProject({ id, name: merged.name, type: merged.type, template: merged.templateRef, now });

      // 4. the house style and the brand pack: written only when this workspace has none of that name (the workspace's own is never replaced)
      const tdir = workspace.templatesDir(workspaceDir);
      const hadPack = new Set(entries.map((e) => BRAND_FILE_RE.exec(e.name.replace(/\\/g, '/'))?.[1]).filter((x): x is string => !!x && fs.existsSync(path.join(tdir, 'brand', x))));
      for (const e of entries) {
        const name = e.name.replace(/\\/g, '/');
        const t = TEMPLATE_RE.exec(name); const b = BRAND_FILE_RE.exec(name);
        if (t) {
          const dest = path.join(tdir, `${t[1]}.house.json`);
          if (fs.existsSync(dest)) { if (t[1] === merged.templateRef) findings.push({ severity: 'info', message: `This workspace already has the house style "${t[1]}"; its own copy is used.` }); }
          else { fs.mkdirSync(tdir, { recursive: true }); fs.writeFileSync(dest, await r.readBuffer(e)); findings.push({ severity: 'info', message: `The house style "${t[1]}" was added to this workspace.` }); }
        } else if (b && !hadPack.has(b[1])) {
          const dest = path.join(tdir, 'brand', b[1], b[2]);
          fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, await r.readBuffer(e));
        }
      }

      // 5. what the DB holds for an S1000D project: its configuration, and the index of its data modules
      if (format === 's1000d') {
        // the data modules say who the project is (model code, issue, language): the configuration is derived from them, as for every other import
        try { adoptFromContents(id, user.id); } catch (err) { findings.push({ severity: 'warning', message: `The configuration could not be derived from the data modules: ${(err as Error).message}` }); }
        // a project with no data module yet has nothing to derive them from: its own identity comes back from the archive, through the same validator as any edit (a bad value is left out and said)
        const cfg = (man.settings as { config?: Record<string, unknown> } | undefined)?.config;
        if (cfg && typeof cfg === 'object' && dmCount(id) === 0) {
          for (const f of ['mic', 'issue', 'language'] as const) {
            if (cfg[f] === undefined || cfg[f] === null || cfg[f] === '') continue;
            try { updateConfig(id, { [f]: cfg[f] }, user.id); } catch (err) { findings.push({ severity: 'warning', message: `The project's ${f} was not restored: ${(err as Error).message.split('\n')[0]}` }); }
          }
        }
        if (man.settings) { try { const rep = restoreSettings(id, user.id, man.settings); for (const n of rep.notes) findings.push({ severity: 'warning', message: n }); } catch (err) { findings.push({ severity: 'warning', message: `The project's settings could not be restored: ${(err as Error).message}` }); } }
        try { await docIndex.syncProject(id, dir, now); } catch (err) { findings.push({ severity: 'warning', message: `The data modules could not be indexed: ${(err as Error).message}` }); }
      }

      // 6. the review comments, under the person who imports, each naming who wrote it
      let comments = 0;
      const cf = entries.find((e) => e.name.replace(/\\/g, '/') === 'comments.json');
      if (cf) {
        try {
          const list = (JSON.parse((await r.readBuffer(cf)).toString('utf8')) as { comments?: Array<Record<string, any>> }).comments ?? [];
          for (const c of list) {
            const by = c.author ? `[${String(c.author).slice(0, 60)}${c.createdAt ? `, ${String(c.createdAt).slice(0, 10)}` : ''}] ` : '';
            try {
              const dmFile = typeof c.rel === 'string' && /^DMC-[A-Za-z0-9._-]+\.xml$/i.test(c.rel) ? c.rel : undefined;
              const cid = review.addComment(id, user.id, { body: `${by}${String(c.body ?? '')}`, dmFile, anchor: dmFile ? c.anchor : undefined }, c.kind === 'changes' ? 'changes' : 'comment');
              if (c.resolvedAt) review.setResolved(id, cid, user.id, true);
              comments++;
            } catch (err) { findings.push({ severity: 'warning', message: `A review comment was not restored: ${(err as Error).message}` }); }
          }
        } catch { findings.push({ severity: 'warning', message: 'The comments file could not be read.' }); }
      }
      return { project: { ...card, name: merged.name }, findings, counts: { files, comments } };
    } catch (err) { try { opts.discard?.(id); } catch { /* best effort */ } throw err; }
  } finally { try { r.close(); } catch { /* closed */ } }
}
