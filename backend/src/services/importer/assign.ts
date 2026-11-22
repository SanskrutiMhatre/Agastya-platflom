// =============================================================================
// Assisted assembly: move modules from the unassigned pool into the publication tree. Pure over the tree
// (the route reads and writes publication.xml); it works on a COPY and returns the new tree.
//
// Rules, each from the brief:
//   - the pool is never emptied by accident: a module already placed is refused unless `reuse` is set
//     (the same module may belong to several publications - the sample reuses 41 of them);
//   - a sub-publication whose PMC was not delivered is a `pmRef` leaf. Assigning to it turns that leaf into
//     a folder with the sub-publication's own title, ANCHOR (title page) FIRST, then the chosen modules;
//   - a folder that already stands for a materialised sub-publication is found again by its title, so the
//     assembly can be done in several steps.
// =============================================================================

import { bad, conflict, notFound } from '../http';
import { dmKey, walkEntries } from './identity';
import { pmCodeKey, type PmEntry } from './types';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const baseOf = (href: string): string => href.replace(/\\/g, '/').replace(/^.*\//, '').toLowerCase();

export interface Placed { keys: Set<string>; files: Set<string> }

/** The modules a tree already places, by canonical code and by file name (include entries are file based). */
export function placedIn(entries: PmEntry[]): Placed {
  const out: Placed = { keys: new Set(), files: new Set() };
  walkEntries(entries, (e) => {
    if (e.type === 'dm' && e.dmCode) out.keys.add(dmKey(e.dmCode, e.identExtension as Record<string, string> | undefined).toUpperCase());
    if (e.type === 'include' && typeof e.href === 'string') out.files.add(baseOf(e.href));
  });
  return out;
}

export interface OutlineNode { path: number[]; title: string; kind: 'folder' | 'pmRef'; modules: number; pmCode?: string; depth: number }

/** The places a module can be put, for the screen: every folder, and every sub-publication that is still a bare reference. */
export function outline(entries: PmEntry[], cap = 600): OutlineNode[] {
  const out: OutlineNode[] = [];
  walkEntries(entries, (e, path) => {
    if (out.length >= cap) return;
    if (e.type === 'folder') {
      let modules = 0;
      walkEntries(e.children ?? [], (c) => { if (c.type === 'dm' || c.type === 'include') modules++; });
      out.push({ path, title: String(e.title ?? ''), kind: 'folder', modules, depth: path.length - 1 });
    } else if (e.type === 'pmRef') {
      out.push({ path, title: String(e.title ?? e.pmTitle ?? ''), kind: 'pmRef', modules: 0, pmCode: pmCodeKey(e.pmCode as Record<string, string> | undefined), depth: path.length - 1 });
    }
  });
  return out;
}

export interface AssignTarget {
  /** Child indexes from the root to a folder; [] (or missing) = the root of the publication. */
  folderPath?: number[];
  /** `MODEL-ISSUER-NUMBER-VOLUME` of a sub-publication to fill (see /import/unassigned). */
  subPublication?: string;
  /** Create this folder inside the target and use it. */
  newFolder?: string;
  position?: 'start' | 'end';
}

export interface ModuleToPlace { file: string; key: string; entry: PmEntry }

export interface AssignResult {
  entries: PmEntry[];
  placed: string[];
  refused: Array<{ file: string; reason: string }>;
  /** Set when a bare pmRef became a folder: the folder's title (how the next step finds it) and where it sits. */
  materialised?: { pmCode: string; title: string; path: number[] };
}

function childrenAt(entries: PmEntry[], path: number[]): PmEntry[] {
  let list = entries;
  for (const i of path) {
    const e = list[i];
    if (!e || e.type !== 'folder') throw notFound(`There is no folder at ${JSON.stringify(path)} in this publication.`);
    e.children = e.children ?? [];
    list = e.children;
  }
  return list;
}

export function assignToTree(
  input: PmEntry[],
  modules: ModuleToPlace[],
  target: AssignTarget,
  opts: { reuse: boolean; anchor?: ModuleToPlace; materialisedTitle?: string },
): AssignResult {
  const entries = clone(input);
  const already = placedIn(entries);
  let container: PmEntry[];
  let materialised: AssignResult['materialised'];
  let anchorToAdd: ModuleToPlace | undefined;

  if (target.subPublication) {
    const key = target.subPublication;
    let found: { list: PmEntry[]; index: number; path: number[] } | undefined;
    walkEntries(entries, (e, path, parent) => {
      if (found) return;
      if (e.type === 'pmRef' && pmCodeKey(e.pmCode as Record<string, string> | undefined) === key) {
        found = { list: parent ? (parent.children as PmEntry[]) : entries, index: path[path.length - 1], path };
      }
    });
    if (found) {
      const ref = found.list[found.index];
      const title = String(ref.title ?? ref.pmTitle ?? key);
      const folder: PmEntry = { type: 'folder', title, children: [] };
      found.list[found.index] = folder;
      container = folder.children as PmEntry[];
      materialised = { pmCode: key, title, path: found.path };
      anchorToAdd = opts.anchor;
    } else if (opts.materialisedTitle) {
      let folder: PmEntry | undefined;
      walkEntries(entries, (e) => { if (!folder && e.type === 'folder' && e.title === opts.materialisedTitle) folder = e; });
      if (!folder) throw conflict(`The folder "${opts.materialisedTitle}" that stood for sub-publication ${key} is not in the publication any more (renamed or removed). Choose a folder with folderPath instead.`, 'SUBPUB_FOLDER_GONE');
      folder.children = folder.children ?? [];
      container = folder.children;
    } else throw notFound(`Sub-publication ${key} is not a reference in this publication (and was not materialised by an earlier assignment).`);
  } else {
    container = childrenAt(entries, target.folderPath ?? []);
  }
  if (target.newFolder) {
    const folder: PmEntry = { type: 'folder', title: target.newFolder, children: [] };
    if (target.position === 'start') container.unshift(folder); else container.push(folder);
    container = folder.children as PmEntry[];
  }

  const refused: AssignResult['refused'] = [];
  const toAdd: PmEntry[] = [];
  const placed: string[] = [];
  const seen = new Set<string>();
  const consider = (m: ModuleToPlace, isAnchor: boolean): void => {
    if (seen.has(m.key)) { if (!isAnchor) refused.push({ file: m.file, reason: 'listed twice in this request' }); return; }
    seen.add(m.key);
    if (!opts.reuse && (already.keys.has(m.key) || already.files.has(m.file.toLowerCase()))) {
      // A title page that is already placed somewhere is left there (no noise); a module the caller named is refused, loudly.
      if (!isAnchor) refused.push({ file: m.file, reason: 'already placed in this publication (pass reuse to place the same module again)' });
      return;
    }
    toAdd.push(clone(m.entry)); placed.push(m.file);
  };
  if (anchorToAdd) consider(anchorToAdd, true);
  for (const m of modules) consider(m, false);

  if (!toAdd.length && !materialised) throw bad('Nothing to place: every module is already in the publication.', 'NOTHING_TO_PLACE');
  if (target.position === 'start' && !target.newFolder) container.unshift(...toAdd); else container.push(...toAdd);
  return { entries, placed, refused, materialised };
}
