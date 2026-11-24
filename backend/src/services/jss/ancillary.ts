// The ancillary pages of a JSS document: the pages before the body (title pages, notices, foreword, record of changes, contents lists ...).
//
// Which of them are printed, and under which heading, is the project's `frontMatter.pages` setting (the same one the Settings > Front matter tab edits).
// What a page says is its XML file in `<project>/jss/frontmatter/`. Most are written from Settings; the engine (vendor/engine/frontmatter.js) rewrites such
// a file only while it is exactly what it wrote, so a page the author edited here is kept, and "reset" gives the page back to Settings.
// Pages that are only an element (the lists of contents, figures and tables) have no file: the stylesheet makes them from the document.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { vendor } from '../../config';
import { projectDirFor } from '../../context';
import { bad, notFound } from '../http';
import { readProjectJson, updateProjectJson } from '../projects';
import { wellFormedError } from '../wellFormed';
import { jssTypeOfProject, prepareFrontMatterFiles } from './service';

const pagesEngine = (): { resolvePages(fm: unknown): any[] } => vendor('engine/frontMatterPages');

const STAMP_FILE = '_frontmatter-generated.json';
const MAX_BYTES = 1024 * 1024;
const hash = (s: string): string => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 32);

export interface AncillaryPage {
  id: string;
  label: string;
  /** The heading the page prints (Settings' override, else the stencil's). Null for the pages that have none of their own (the title pages). */
  title: string | null;
  /** What Settings override the heading with, if anything. */
  customTitle: string;
  enabled: boolean;
  /** A page that cannot be switched off. */
  required: boolean;
  /** The page's file, when it has one the author can edit; null for the pages the stylesheet makes from the document. */
  file: string | null;
  /** The file has been changed by hand: Settings no longer rewrite it. */
  edited: boolean;
}

const dirOf = (projectId: string): string => path.join(projectDirFor(projectId), 'jss', 'frontmatter');
const readStamp = (dir: string): Record<string, string> => { try { return JSON.parse(fs.readFileSync(path.join(dir, STAMP_FILE), 'utf8')); } catch { return {}; } };

/** The pages this document's stencil has, in print order, whether or not they are switched on. */
function applicable(projectId: string, effective: any): any[] {
  const type = jssTypeOfProject(projectId);
  const joint = ((effective?.branding?.publishers as unknown[] | undefined)?.length ?? 0) > 1;      // the "jointly prepared" cover exists only for more than one publisher
  return pagesEngine().resolvePages(effective?.frontMatter).filter((p) => {
    if (p.id === 'titlePageJoint' && !joint) return false;
    if (p.id === 'cautionsNotes' && type?.frontPages && !type.frontPages.cautionsNotes) return false;       // this stencil has no such page
    if (p.id === 'systemNamePage' && type?.frontPages && !type.frontPages.systemNamePage) return false;
    return true;
  });
}

export function listAncillary(projectId: string, effective: any): AncillaryPage[] {
  const dir = prepareFrontMatterFiles(projectId, effective);
  const stamp = readStamp(dir);
  const saved: any[] = Array.isArray(readProjectJson(projectId).frontMatter?.pages) ? readProjectJson(projectId).frontMatter.pages : [];
  return applicable(projectId, effective).map((p): AncillaryPage => {
    const abs = p.file ? path.join(dir, p.file) : '';
    const hasFile = !!p.file && fs.existsSync(abs);
    let edited = false;
    if (hasFile && stamp[p.file]) { try { edited = hash(fs.readFileSync(abs, 'utf8')) !== stamp[p.file]; } catch { /* unreadable: not edited */ } }
    return {
      id: p.id, label: p.label, title: p.title ?? null, customTitle: saved.find((s) => s?.id === p.id)?.title ?? '',
      enabled: !!p.enabled, required: !!p.required, file: hasFile ? p.file : null, edited,
    };
  });
}

function pageOf(projectId: string, effective: any, pageId: string): { page: AncillaryPage; abs: string } {
  const page = listAncillary(projectId, effective).find((p) => p.id === pageId);
  if (!page) throw notFound('This document has no such ancillary page.');
  if (!page.file) throw bad('This page is made from the document itself (the lists of contents, figures and tables), so there is nothing to edit.', 'NOT_EDITABLE');
  return { page, abs: path.join(dirOf(projectId), page.file) };
}

export function readAncillary(projectId: string, effective: any, pageId: string): { page: AncillaryPage; xml: string } {
  const { page, abs } = pageOf(projectId, effective, pageId);
  return { page, xml: fs.readFileSync(abs, 'utf8') };
}

const rootName = (xml: string): string | null => /<([A-Za-z_][\w.-]*)[\s/>]/.exec(xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, ''))?.[1] ?? null;

/** Save a page's XML. It must be well formed, keep the page's root element, and carry no DOCTYPE (no entities, no external files). */
export function writeAncillary(projectId: string, effective: any, pageId: string, xml: string): AncillaryPage {
  const { page, abs } = pageOf(projectId, effective, pageId);
  if (typeof xml !== 'string' || !xml.trim()) throw bad('Send the page as { "xml": "..." }.', 'BAD_BODY');
  if (Buffer.byteLength(xml) > MAX_BYTES) throw bad('A page may be at most 1 MB.', 'TOO_BIG');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw bad('A page may not declare a DOCTYPE or entities.', 'BAD_XML');
  const problem = wellFormedError(xml);
  if (problem) throw bad(`The page is not well-formed XML: ${problem}`, 'MALFORMED_XML');
  const was = rootName(fs.readFileSync(abs, 'utf8')); const now = rootName(xml);
  if (was && now !== was) throw bad(`The page's outer element must stay <${was}> (it is <${now ?? 'missing'}>).`, 'BAD_ROOT');
  fs.writeFileSync(abs, /^\s*<\?xml/.test(xml) ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`, 'utf8');
  return { ...page, edited: true };
}

/** Give a page back to Settings (or to the stencil, for a page Settings do not write): the file is removed and made again. */
export function resetAncillary(projectId: string, effective: any, pageId: string): AncillaryPage {
  const { page, abs } = pageOf(projectId, effective, pageId);
  const dir = dirOf(projectId);
  fs.rmSync(abs, { force: true });
  const stamp = readStamp(dir); delete stamp[page.file as string];
  fs.writeFileSync(path.join(dir, STAMP_FILE), JSON.stringify(stamp, null, 2) + '\n', 'utf8');
  prepareFrontMatterFiles(projectId, effective);
  return listAncillary(projectId, effective).find((p) => p.id === pageId) as AncillaryPage;
}

/**
 * Which pages are printed, and the heading each one carries. A page that is not mentioned keeps what it had.
 *
 * The engine prints pages in the order of the saved list, so the list is always written out whole, in the catalogue's order: appending the one page that was
 * just changed would move it to the front of the book (and the title page would no longer be first).
 */
export function saveAncillaryChoices(projectId: string, pages: Array<{ id: string; enabled?: boolean; title?: string }>, known: string[]): void {
  const incoming = new Map<string, { id: string; enabled?: boolean; title?: string }>();
  for (const p of pages) {
    if (!p || typeof p.id !== 'string' || !known.includes(p.id)) throw bad(`There is no ancillary page "${String(p?.id)}".`, 'BAD_PAGE');
    if (p.enabled !== undefined && typeof p.enabled !== 'boolean') throw bad('"enabled" must be true or false.', 'BAD_BODY');
    if (p.title !== undefined && (typeof p.title !== 'string' || p.title.length > 200)) throw bad('A heading is text of at most 200 characters.', 'BAD_BODY');
    incoming.set(p.id, p);
  }
  const catalogue: Array<{ id: string }> = vendor('engine/frontMatterPages').CATALOGUE;
  updateProjectJson(projectId, (pj: any) => {
    const saved: any[] = Array.isArray(pj.frontMatter?.pages) ? pj.frontMatter.pages : [];
    const byId = new Map<string, any>(saved.filter((s) => s && s.id).map((s) => [s.id, s]));
    const merged = (id: string): any => {
      const patch = incoming.get(id);
      return { ...(byId.get(id) ?? { id }), ...(patch?.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch?.title !== undefined ? { title: patch.title } : {}) };
    };
    const inCatalogue = new Set(catalogue.map((c) => c.id));
    pj.frontMatter = {
      ...(pj.frontMatter ?? {}),
      pages: [...catalogue.map((c) => merged(c.id)), ...saved.filter((s) => s && s.id && !inCatalogue.has(s.id))],      // pages an author added by hand come after
    };
  });
}
