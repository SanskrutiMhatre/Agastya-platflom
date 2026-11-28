// =============================================================================
// PDF review: which PDFs of a project can be reviewed, where they are, and which version (SHA-256) is on disk now.
//
// A reviewed PDF is named by its path in the project folder ("file key"): the generated builds and quick previews at the project root, the
// configured builds, and any PDF kept in the project (a reference PDF in Media/, an attachment). The key is checked like every project path
// (ContentStore.pathOf: never outside the project folder), must end in .pdf, and may not pass through a hidden or temporary name.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { content } from '../../context';
import { bad, notFound } from '../http';
import { readProjectJson } from '../projects';

export type ReviewFileKind = 'build' | 'preview' | 'project';
export interface ReviewFile { key: string; label: string; kind: ReviewFileKind; size: number; modified: string }

/** The generated PDFs at the project root, by name: what each one is. */
const KNOWN: Record<string, { label: (fmt: string) => string; kind: ReviewFileKind; formats: string[] }> = {
  'jss-output.pdf': { label: () => 'Publication PDF (Generate)', kind: 'build', formats: ['s1000d', 'jss'] },
  'jsg-output.pdf': { label: () => 'Document PDF (Generate)', kind: 'build', formats: ['jsg'] },
  '_quick-preview.pdf': { label: () => 'Quick preview (draft)', kind: 'preview', formats: ['jss', 'jsg'] },
  'jss-preview.pdf': { label: () => 'Data module preview (draft)', kind: 'preview', formats: ['s1000d'] },
};
const SKIP_DIR = /^(\.|_|node_modules$|history$)/i;
const MAX_FILES = 300;
const MAX_DEPTH = 5;

export function projectFormat(projectId: string): 's1000d' | 'jss' | 'jsg' {
  const pj = readProjectJson(projectId);
  if (pj.format === 'jsg') return 'jsg';
  if (pj.authoring === 'jss-xml' || pj.format === 'jss') return 'jss';
  return 's1000d';
}

/** The PDFs of a project that can be reviewed: generated ones first, then the project's own, by path. */
export function listReviewFiles(projectId: string): ReviewFile[] {
  const root = content.projectDir(projectId);
  const fmt = projectFormat(projectId);
  const out: ReviewFile[] = [];
  const stat = (rel: string): fs.Stats | null => { try { return fs.statSync(path.join(root, rel)); } catch { return null; } };
  for (const [name, k] of Object.entries(KNOWN)) {
    const st = stat(name);
    if (st?.isFile()) out.push({ key: name, label: k.label(fmt), kind: k.kind, size: st.size, modified: st.mtime.toISOString() });
  }
  const walk = (rel: string, depth: number): void => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let names: fs.Dirent[] = [];
    try { names = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of names.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(r, depth + 1); continue; }
      if (!e.isFile() || !/\.pdf$/i.test(e.name) || /^[._]/.test(e.name) || (!rel && KNOWN[e.name])) continue;
      const st = stat(r); if (!st) continue;
      out.push({ key: r, label: rel.startsWith('configurations') ? `Configured build: ${e.name}` : r, kind: rel.startsWith('configurations') ? 'build' : 'project', size: st.size, modified: st.mtime.toISOString() });
    }
  };
  walk('', 0);
  return out;
}

/** A file key from a request, checked: relative, forward slashes, .pdf, no hidden or temporary part, inside the project. */
export function cleanKey(raw: unknown): string {
  const key = String(raw ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!key || key.length > 400 || !/\.pdf$/i.test(key)) throw bad('Name a PDF of the project.', 'BAD_PDF_KEY');
  const parts = key.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || (/^\./.test(p)) || /[\0<>:"|?*]/.test(p))) throw bad('That is not a PDF of the project.', 'BAD_PDF_KEY');
  if (parts.length > 1 && parts.slice(0, -1).some((p) => SKIP_DIR.test(p))) throw bad('That is not a PDF of the project.', 'BAD_PDF_KEY');
  return key;
}

/** The file on disk for a key (404 when it is not there). */
export function resolveReviewFile(projectId: string, rawKey: unknown): { key: string; abs: string; size: number; mtimeMs: number } {
  const key = cleanKey(rawKey);
  let abs: string;
  try { abs = content.pathOf(projectId, key); } catch { throw bad('That is not a PDF of the project.', 'BAD_PDF_KEY'); }
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { throw notFound('That PDF is not in the project (it may not have been built yet).'); }
  if (!st.isFile()) throw notFound('That PDF is not in the project.');
  // a junction or link inside the project that points elsewhere is not followed
  try { const real = fs.realpathSync(abs); const rootReal = fs.realpathSync(content.projectDir(projectId)); if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw notFound('That PDF is not in the project.'); } catch (e) { if ((e as { status?: number }).status) throw e; }
  return { key, abs, size: st.size, mtimeMs: st.mtimeMs };
}

const hashes = new Map<string, { size: number; mtimeMs: number; hash: string }>();
/** SHA-256 of the file, remembered while its size and time stay the same (a 300-page book is not hashed again on every request). */
export function identityOf(f: { abs: string; size: number; mtimeMs: number }): string {
  const hit = hashes.get(f.abs);
  if (hit && hit.size === f.size && hit.mtimeMs === f.mtimeMs) return hit.hash;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(f.abs)).digest('hex');
  if (hashes.size > 500) hashes.clear();
  hashes.set(f.abs, { size: f.size, mtimeMs: f.mtimeMs, hash });
  return hash;
}
