// =============================================================================
// Graphics of a project: ICN artwork and symbols (icons).
//
//   ICN     an illustration a data module's <graphic> points at (infoEntityIdent="ICN-...").
//           S1000D resolves the entity beside the data modules, so ICN files live in csdb/ and
//           their names start with "ICN-".
//   symbol  a small icon (warning symbols, logos, the publisher's marks) used through <symbol>
//           or the publication's branding. It lives in Media/.
//
// The list is the images on disk, with what each is used by, so a graphic a data module still
// refers to is not deleted by accident.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../context';
import { bad, conflict, notFound } from './http';
import { csdbDir, DM_FILE_RE, listMedia } from './csdb';
import { readProjectJson, mediaRel, csdbRel } from './projects';
import { assetProblem } from './mediaFormats';
import { riskyAllowed } from './assets';

export type GraphicKind = 'icn' | 'symbol';
export interface Graphic { name: string; kind: GraphicKind; dir: 'csdb' | 'Media'; size: number; modified: string; usedBy: string[] }

export const IMAGE_RE = /\.(png|jpe?g|gif|svg|bmp|webp)$/i;
export const ICN_RE = /^ICN-/i;
export const kindOf = (name: string): GraphicKind => (ICN_RE.test(name) ? 'icn' : 'symbol');

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

/** Which data modules mention each graphic: by file name, or by the entity name (the file name without its extension). */
function usage(projectId: string, names: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>(names.map((n) => [n, []]));
  const dir = csdbDir(projectId);
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!DM_FILE_RE.test(f)) continue;
    let xml = '';
    try { xml = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const n of names) if (xml.includes(n) || xml.includes(stem(n))) out.get(n)!.push(f);
  }
  return out;
}

export function listGraphics(projectId: string): Graphic[] {
  const media = listMedia(projectId);
  const used = usage(projectId, media.map((m) => m.name));
  const pj = readProjectJson(projectId);
  return media.map((m) => {
    let modified = '';
    try { modified = fs.statSync(path.join(projectDirFor(projectId), m.dir === 'csdb' ? csdbRel(pj) : mediaRel(pj), m.name)).mtime.toISOString(); } catch { /* listed a moment ago */ }
    return { name: m.name, kind: kindOf(m.name), dir: m.dir, size: m.size, modified, usedBy: used.get(m.name) ?? [] };
  });
}

/** Where a graphic of this kind belongs, and the name it must carry. */
export function placeGraphic(projectId: string, originalName: string, kind: GraphicKind): { abs: string; name: string } {
  const name = path.basename(originalName).replace(/[^\w.\- ]/g, '_');
  const why = assetProblem(name, riskyAllowed());                       // images and the multimedia types S1000D 4.2 Chap 7.3.3 lists (active-content types need an administrator's opt-in)
  if (why) throw bad(`${originalName}: ${why}`, 'BAD_IMAGE');
  if (kind === 'icn' && !ICN_RE.test(name)) {
    throw bad(`${originalName}: an ICN graphic must be named ICN-… (for example ICN-MODEL-A-000000-A-00001-00001-A-001-01.svg), because that is the name the data module refers to.`, 'BAD_ICN_NAME');
  }
  if (kind === 'symbol' && ICN_RE.test(name)) {
    throw bad(`${originalName}: this name starts with ICN-, so it is an ICN graphic, not a symbol.`, 'BAD_SYMBOL_NAME');
  }
  const pj = readProjectJson(projectId);
  const dir = path.join(projectDirFor(projectId), kind === 'icn' ? csdbRel(pj) : mediaRel(pj));
  fs.mkdirSync(dir, { recursive: true });
  return { abs: path.join(dir, name), name };
}

export function deleteGraphic(projectId: string, name: string, force: boolean): void {
  const base = path.basename(String(name));
  if (assetProblem(base, true)) throw bad('Not a graphic.', 'BAD_IMAGE');
  const g = listGraphics(projectId).find((x) => x.name === base);
  if (!g) throw notFound('No such graphic.');
  if (g.usedBy.length && !force) {
    throw conflict(`${base} is used by ${g.usedBy.length} data module${g.usedBy.length === 1 ? '' : 's'} (${g.usedBy.slice(0, 3).join(', ')}${g.usedBy.length > 3 ? ', …' : ''}). Deleting it would leave those figures blank.`, 'GRAPHIC_IN_USE', { usedBy: g.usedBy });
  }
  const pj = readProjectJson(projectId);
  fs.unlinkSync(path.join(projectDirFor(projectId), g.dir === 'csdb' ? csdbRel(pj) : mediaRel(pj), base));
}
