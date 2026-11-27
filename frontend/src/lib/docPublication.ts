// The publication of a JSS / JSG project as the author sees it on the Publication and Explore pages: chapters, the data modules (document codes) in them, the appendices and
// plates, and the sub-headings that belong to a module.
//
// Two parts, both pure (no DOM, no network), so they are tested without a browser:
//   buildPublication(codes)          the tree, from the codes the server keeps (GET /identity);
//   Edit / applyEdits(tree, edits)   what the author did on the page (move a chapter, move a module between chapters, rename, add a chapter), as a short list.
//                                    The page shows the tree with the edits applied; Save applies the same edits to the document itself (applyToJss / applyToJsg) and writes it,
//                                    so what was shown is what is saved - nothing is rebuilt from guesses.

import type { DocCodes, Origin } from '../api/xengine';
import { chapterFromOutline, isSection as jssIsSection, newChapter, newId, newSection, type JssDoc, type OutlineNode } from '../jss/model';
import { renumberChapters } from '../jss/ops';
import { newPara, type Appendix as JsgAppendix, type JsgDoc } from '../jsg/model';

export type PubKind = 'chapter-intro' | 'section' | 'appendix' | 'plate';
/** A sub-heading inside a module (it has no code of its own: it is part of its module's data module). `rel` is its number below the module's: "1", "2.1". */
export interface PubSub { level: number; rel: string; title: string }
export interface PubModule {
  key: string; kind: PubKind; title: string;
  /** "2.3" for a section, "2" for the introduction of chapter 2, "A" for an appendix */
  label: string;
  dmc: string; file: string; origin: Origin;
  /** the picture files shown in this module */
  pictures: string[];
  subs: PubSub[];
  /** made on this page and not saved yet: it has no code until the document is saved */
  fresh?: boolean;
}
export interface PubChapter { key: string; title: string; label: string; modules: PubModule[]; fresh?: boolean }
export interface Publication { chapters: PubChapter[]; appendices: PubModule[]; plates: PubModule[] }

const isChapterKind = (k: string): boolean => k === 'chapter-intro' || k === 'section';

/** The tree of a project's codes. */
export function buildPublication(c: DocCodes): Publication {
  const byDmc = new Map(c.modules.map((m) => [m.dmc, m]));
  const ownNo = new Map<string, string>(); const subs = new Map<string, PubSub[]>();
  const modOf = (dmc: string | null) => (dmc ? byDmc.get(dmc) : undefined);
  for (const t of c.toc) {
    const m = modOf(t.dmc); if (!m) continue;
    if (t.level === 2 && m.kind === 'section' && !ownNo.has(m.key)) ownNo.set(m.key, t.number);
    else if (t.level >= 3) { const own = ownNo.get(m.key); const list = subs.get(m.key) ?? []; list.push({ level: t.level, rel: own && t.number.startsWith(`${own}.`) ? t.number.slice(own.length + 1) : t.number, title: t.title }); subs.set(m.key, list); }
  }
  const pics = new Map<string, string[]>();
  for (const p of c.pictures) { const l = pics.get(p.module) ?? []; l.push(p.file); pics.set(p.module, l); }
  const mod = (m: DocCodes['modules'][number], label: string): PubModule => ({ key: m.key, kind: m.kind as PubKind, title: m.title, label, dmc: m.dmc, file: m.file, origin: m.origin, pictures: pics.get(m.key) ?? [], subs: subs.get(m.key) ?? [] });

  const chapters: PubChapter[] = []; const appendices: PubModule[] = []; const plates: PubModule[] = [];
  for (const t of c.toc) {
    if (t.level !== 1) continue;
    const m = modOf(t.dmc);
    if (m?.kind === 'appendix') { appendices.push(mod(m, t.number)); continue; }
    if (m?.kind === 'plate') { plates.push(mod(m, t.number)); continue; }
    const no = m ? m.chapter : Number(t.number) || chapters.length + 1;
    chapters.push({ key: `ch${no}`, title: t.title, label: t.number, modules: c.modules.filter((x) => isChapterKind(x.kind) && x.chapter === no).map((x) => mod(x, x.kind === 'chapter-intro' ? t.number : (ownNo.get(x.key) ?? ''))) });
  }
  return relabel({ chapters, appendices, plates });
}

/** Number the chapters and sections by position: what the document will print once it is saved. */
export function relabel(p: Publication): Publication {
  p.chapters.forEach((ch, i) => {
    ch.label = String(i + 1); let j = 0;
    for (const m of ch.modules) m.label = m.kind === 'chapter-intro' ? ch.label : `${ch.label}.${++j}`;
  });
  return p;
}

/** The module a sub-heading belongs to is numbered below it. */
export const subNumber = (m: PubModule, s: PubSub): string => (m.kind === 'section' ? `${m.label}.${s.rel}` : s.rel);

// ── what the author does ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A position among a chapter's sections (not counting its introduction): `ch` is the chapter's place in the list, `at` the section's place among the chapter's sections. */
export interface SecAt { ch: number; at: number }
export type Edit =
  | { op: 'moveChapter'; from: number; to: number }
  | { op: 'moveSection'; from: SecAt; to: SecAt }
  | { op: 'moveAppendix'; from: number; to: number }
  | { op: 'renameChapter'; ch: number; title: string }
  | { op: 'renameSection'; ch: number; at: number; title: string }
  /** Deleting takes the text with it when the document is saved; the last chapter of a document cannot be deleted (a document needs one). */
  | { op: 'removeChapter'; ch: number }
  | { op: 'removeSection'; ch: number; at: number }
  /** `sections`: the titles of the sections the new chapter starts with (the stencil's, or the one section a JSG chapter starts with) */
  | { op: 'addChapter'; title: string; sections: string[] }
  /** WP-22 (GAP-003): a new section at the end of a chapter (only where the stencil leaves the sections to the author) */
  | { op: 'addSection'; ch: number; title: string }
  /** WP-22 (GAP-003): appendices of a JSG document (a JSS document has none in its model) */
  | { op: 'addAppendix'; title: string }
  | { op: 'removeAppendix'; at: number };

/** The letter of the n-th appendix (0 -> A); I and O are skipped, as in a printed manual. */
export const appendixLetter = (n: number): string => { const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; return n < L.length ? L[n] : `${L[Math.floor(n / L.length) - 1]}${L[n % L.length]}`; };

/**
 * Where an item lands in its list once it has been taken out: `from` is its place in that list (null when it comes from another list), `target` the place it was dropped on, and
 * `len` the list's length before the move. Moving within a list keeps its length, so the last place is len - 1; coming from another list the last place is len.
 */
export function landing(len: number, from: number | null, target: number, where: 'before' | 'after'): number {
  let at = target + (where === 'after' ? 1 : 0);
  if (from !== null && from < at) at -= 1;
  return Math.max(0, Math.min(at, from !== null ? len - 1 : len));
}

const move = <T,>(list: T[], from: number, to: number): boolean => {
  if (from < 0 || from >= list.length || from === to) return false;
  const [x] = list.splice(from, 1); list.splice(Math.max(0, Math.min(to, list.length)), 0, x); return true;
};
const sectionsOf = (ch: PubChapter): PubModule[] => ch.modules.filter((m) => m.kind === 'section');
const withSections = (ch: PubChapter, secs: PubModule[]): void => { ch.modules = [...ch.modules.filter((m) => m.kind !== 'section'), ...secs]; };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Whether an edit would change anything (a drop on the place the item already has does not). */
export function isNoop(p: Publication, e: Edit): boolean {
  if (e.op === 'moveChapter' || e.op === 'moveAppendix') return e.from === e.to;
  if (e.op === 'moveSection') return e.from.ch === e.to.ch && e.from.at === e.to.at;
  return false;
}

export function applyEdits(base: Publication, edits: Edit[]): Publication {
  const p = clone(base); let fresh = 0;
  for (const e of edits) {
    if (e.op === 'moveChapter') move(p.chapters, e.from, e.to);
    else if (e.op === 'moveAppendix') move(p.appendices, e.from, e.to);
    else if (e.op === 'moveSection') {
      const src = p.chapters[e.from.ch]; if (!src) continue;
      const taken = sectionsOf(src); const [m] = taken.splice(e.from.at, 1); if (!m) continue;
      withSections(src, taken);
      const dst = p.chapters[e.to.ch]; if (!dst) { withSections(src, [...sectionsOf(src), m]); continue; }
      const into = sectionsOf(dst); into.splice(Math.max(0, Math.min(e.to.at, into.length)), 0, m); withSections(dst, into);
    } else if (e.op === 'renameChapter') { const ch = p.chapters[e.ch]; if (ch) ch.title = e.title; }
    else if (e.op === 'renameSection') { const m = p.chapters[e.ch] && sectionsOf(p.chapters[e.ch])[e.at]; if (m) m.title = e.title; }
    else if (e.op === 'removeChapter') { if (p.chapters.length > 1 && p.chapters[e.ch]) p.chapters.splice(e.ch, 1); }
    else if (e.op === 'removeSection') { const ch = p.chapters[e.ch]; if (ch) { const secs = sectionsOf(ch); if (secs[e.at]) { secs.splice(e.at, 1); withSections(ch, secs); } } }
    else if (e.op === 'addChapter') {
      const n = ++fresh;
      p.chapters.push({ key: `new${n}`, title: e.title, label: '', fresh: true, modules: e.sections.map((t, i) => ({ key: `new${n}.${i}`, kind: 'section' as const, title: t, label: '', dmc: '', file: '', origin: 'generated' as const, pictures: [], subs: [], fresh: true })) });
    } else if (e.op === 'addSection') {
      const ch = p.chapters[e.ch]; if (!ch) continue; const n = ++fresh;
      withSections(ch, [...sectionsOf(ch), { key: `new${n}`, kind: 'section', title: e.title, label: '', dmc: '', file: '', origin: 'generated', pictures: [], subs: [], fresh: true }]);
    } else if (e.op === 'addAppendix') {
      const n = ++fresh;
      p.appendices.push({ key: `new${n}`, kind: 'appendix', title: e.title, label: '', dmc: '', file: '', origin: 'generated', pictures: [], subs: [], fresh: true });
    } else if (e.op === 'removeAppendix') { if (p.appendices[e.at]) p.appendices.splice(e.at, 1); }
  }
  // an appendix that was added here is lettered after the ones before it; the others keep the label the document gives them
  p.appendices.forEach((a, i) => { if (a.fresh) a.label = appendixLetter(i); });
  return relabel(p);
}

// ── writing the edits into the document ─────────────────────────────────────────────────────────────────────────────────────────────

/** The titles an added chapter starts with: what `chapterFromOutline` makes of the stencil's first chapter. */
export const starterSections = (starter: OutlineNode | null | undefined): string[] => (starter?.children ?? []).filter((x) => !x.example).map((x) => x.title);

/** Apply the edits to a JSS document (what the editor does with its own ops). `starter` is the stencil's first chapter, what a new chapter starts from. */
export function applyToJss(doc: JssDoc, edits: Edit[], starter: OutlineNode | null = null): void {
  for (const e of edits) {
    if (e.op === 'moveChapter') { if (move(doc.chapters, e.from, e.to)) renumberChapters(doc); }
    else if (e.op === 'moveSection') {
      const src = doc.chapters[e.from.ch]; const dst = doc.chapters[e.to.ch]; if (!src || !dst) continue;
      const sec = src.children.filter(jssIsSection)[e.from.at]; if (!sec) continue;
      src.children.splice(src.children.indexOf(sec), 1);
      const rest = dst.children.filter(jssIsSection); const at = Math.max(0, Math.min(e.to.at, rest.length));
      if (at < rest.length) dst.children.splice(dst.children.indexOf(rest[at]), 0, sec);
      else { const last = rest[rest.length - 1]; if (last) dst.children.splice(dst.children.indexOf(last) + 1, 0, sec); else dst.children.push(sec); }
    } else if (e.op === 'renameChapter') { const ch = doc.chapters[e.ch]; if (ch) ch.title = e.title; }
    else if (e.op === 'renameSection') { const s = doc.chapters[e.ch]?.children.filter(jssIsSection)[e.at]; if (s) s.title = e.title; }
    else if (e.op === 'removeChapter') { if (doc.chapters.length > 1 && doc.chapters[e.ch]) { doc.chapters.splice(e.ch, 1); renumberChapters(doc); } }
    else if (e.op === 'removeSection') { const ch = doc.chapters[e.ch]; const sec = ch?.children.filter(jssIsSection)[e.at]; if (ch && sec) ch.children.splice(ch.children.indexOf(sec), 1); }
    else if (e.op === 'addChapter') {
      const n = doc.chapters.length + 1; const orientation = doc.chapters[0]?.orientation;
      const ch = starter ? chapterFromOutline(doc, starter, n, orientation) : newChapter(n, e.title, newId(doc, 'c'), orientation);
      ch.title = e.title; doc.chapters.push(ch); renumberChapters(doc);
    } else if (e.op === 'addSection') {
      const ch = doc.chapters[e.ch]; if (!ch) continue;
      const sec = newSection(e.title, newId(doc, 's'));             // empty, as the editor's own "Add section" makes it
      const last = ch.children.filter(jssIsSection).pop();
      if (last) ch.children.splice(ch.children.indexOf(last) + 1, 0, sec); else ch.children.push(sec);
    }
    // addAppendix / removeAppendix: a JSS document has no appendices in its model; the page does not offer them for JSS
  }
}

/** Apply the edits to a JSG document. */
export function applyToJsg(doc: JsgDoc, edits: Edit[]): void {
  const added = new Set<JsgAppendix>();
  for (const e of edits) {
    if (e.op === 'moveChapter') move(doc.chapters, e.from, e.to);
    else if (e.op === 'moveAppendix') move(doc.appendices, e.from, e.to);
    else if (e.op === 'moveSection') {
      const src = doc.chapters[e.from.ch]; const dst = doc.chapters[e.to.ch]; if (!src || !dst) continue;
      const [sec] = src.sections.splice(e.from.at, 1); if (!sec) continue;
      dst.sections.splice(Math.max(0, Math.min(e.to.at, dst.sections.length)), 0, sec);
    } else if (e.op === 'renameChapter') { const ch = doc.chapters[e.ch]; if (ch) ch.title = e.title; }
    else if (e.op === 'renameSection') { const s = doc.chapters[e.ch]?.sections[e.at]; if (s) s.title = e.title; }
    else if (e.op === 'removeChapter') { if (doc.chapters.length > 1 && doc.chapters[e.ch]) doc.chapters.splice(e.ch, 1); }
    else if (e.op === 'removeSection') { doc.chapters[e.ch]?.sections.splice(e.at, 1); }
    else if (e.op === 'addChapter') doc.chapters.push({ k: 'chapter', title: e.title, sections: [{ k: 'section', title: 'New section', orientation: 'portrait', children: [newPara('')] }] });
    // WP-22 (GAP-003): what the JSG editor's own "+ Section" and "+ Appendix" make, with the title the author gave
    else if (e.op === 'addSection') doc.chapters[e.ch]?.sections.push({ k: 'section', title: e.title, orientation: 'portrait', children: [newPara('')] });
    else if (e.op === 'addAppendix') { const a: JsgAppendix = { k: 'appendix', label: '', title: e.title, orientation: 'portrait', children: [newPara('')] }; added.add(a); doc.appendices.push(a); }
    else if (e.op === 'removeAppendix') { if (doc.appendices[e.at]) doc.appendices.splice(e.at, 1); }
  }
  // lettered by their final place, as the page showed them (applyEdits)
  doc.appendices.forEach((a, i) => { if (added.has(a)) a.label = appendixLetter(i); });
}

// ── is the document still the one that was shown? ───────────────────────────────────────────────────────────────────────────────────

const norm = (s: string): string => s.replace(/[‘’´`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
/** The chapters and their sections, as titles in order: what the page showed, to be compared with the document just read before the edits are written into it. */
export function fingerprintOfTree(p: Publication): string[] {
  return [...p.chapters.flatMap((c) => [`c|${norm(c.title)}`, ...sectionsOf(c).map((m) => `s|${norm(m.title)}`)]), ...p.appendices.map((a) => `a|${norm(a.title)}`)];
}
export function fingerprintOfJss(d: JssDoc): string[] { return d.chapters.flatMap((c) => [`c|${norm(c.title)}`, ...c.children.filter(jssIsSection).map((s) => `s|${norm(s.title)}`)]); }
export function fingerprintOfJsg(d: JsgDoc): string[] {
  // an appendix's module title is "<label> <title>" (backend/src/services/xengine/outline.ts)
  return [...d.chapters.flatMap((c) => [`c|${norm(c.title)}`, ...c.sections.map((s) => `s|${norm(s.title)}`)]), ...d.appendices.map((a) => `a|${norm(`${a.label ? `${a.label} ` : ''}${a.title}`)}`)];
}
export const sameFingerprint = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Text a search looks in. */
export const searchText = (m: PubModule, chapter?: string): string => `${m.label} ${m.title} ${m.dmc} ${m.file} ${chapter ?? ''} ${m.subs.map((s) => s.title).join(' ')}`.toLowerCase();
