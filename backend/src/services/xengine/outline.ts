// The outline of a JSS or JSG document: what the backend's S1000D metadata (document codes, publication code, picture names, contents list) is built from.
//
// The two document formats are different XML files, but both are "chapters of sections, with pictures": the outline keeps only that, so the identity record (identity.ts) is one
// piece of code for both, and the editors' own XML is never touched. Pure: text in, outline out.
//
//   module  = the unit that is, in an S1000D package, one data module: a JSS top-level section (or a chapter's own introductory text), a JSG section, appendix or plate.
//   toc     = the contents list (publication structure) in reading order, with the module each line belongs to.

import { DOMParser } from '@xmldom/xmldom';

export type OutlineFormat = 'jss' | 'jsg';
export type ModuleKind = 'chapter-intro' | 'section' | 'appendix' | 'plate';

export interface OutlineModule {
  /** A key that stays the same while the document is edited: the element's `id` when it has one, else chapter + title. */
  key: string;
  /** The element's own `id`, when it has one. */
  id?: string;
  chapter: number;
  title: string;
  kind: ModuleKind;
  /** The picture files (names inside Media/, lower case) shown inside the module. */
  pictures: string[];
}
export interface OutlineToc { level: number; number: string; title: string; module: string }
export interface Outline {
  format: OutlineFormat;
  docType: string;
  meta: Record<string, string>;
  chapters: Array<{ number: number; title: string; id?: string }>;
  modules: OutlineModule[];
  toc: OutlineToc[];
}

const kids = (e: Element): Element[] => { const o: Element[] = []; for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) o.push(n as Element); return o; };
const attr = (e: Element, n: string): string => (e.hasAttribute(n) ? (e.getAttribute(n) ?? '') : '');
const text = (e: Element | undefined): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
export const normTitle = (s: string): string => s.replace(/[‘’´`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/** The picture file a `src` names: the file name inside Media/, lower case (so "Media/A.PNG" and "a.png" are one picture). */
export const pictureName = (src: string): string => (src.replace(/\\/g, '/').split('/').pop() ?? '').trim().toLowerCase();

function parse(xml: string, root: string): Element {
  let fatal = '';
  const dom = new DOMParser({ onError: (level: string, m: string) => { if (level === 'fatalError' && !fatal) fatal = m; } }).parseFromString(xml, 'text/xml') as unknown as Document;
  const el = dom.documentElement;
  if (fatal || !el || el.tagName !== root) throw new Error(fatal || `This is not a ${root === 'jssbook' ? 'JSS' : 'JSG'} document.`);
  return el;
}

/** Every picture file named by a `graphic` anywhere under `e`, leaving out the children `skip` rejects. */
function picturesUnder(e: Element, skip: (c: Element) => boolean = () => false, into: Set<string> = new Set()): string[] {
  for (const c of kids(e)) {
    if (skip(c)) continue;
    if (c.tagName === 'graphic') { const n = pictureName(attr(c, 'src')); if (n) into.add(n); }
    else picturesUnder(c, () => false, into);
  }
  return [...into];
}

/** Own text blocks of a node: any child that is not a heading or a sub-section (what a chapter says before its first section). */
const hasOwnContent = (e: Element, sub: Set<string>): boolean => kids(e).some((c) => c.tagName !== 'title' && !sub.has(c.tagName));

const keyOf = (id: string, chapter: number, title: string, taken: Map<string, number>): string => {
  if (id) return `id:${id}`;
  const base = `t:${chapter}:${normTitle(title)}`; const n = (taken.get(base) ?? 0) + 1; taken.set(base, n);
  return n === 1 ? base : `${base}#${n}`;
};

// ── JSS ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function outlineOfJss(xml: string): Outline {
  const root = parse(xml, 'jssbook');
  const meta: Record<string, string> = {};
  const bm = kids(root).find((c) => c.tagName === 'bookmeta');
  for (const m of bm ? kids(bm) : []) meta[m.tagName] = text(m);
  const body = kids(root).find((c) => c.tagName === 'body');
  const chapters: Outline['chapters'] = []; const modules: OutlineModule[] = []; const toc: OutlineToc[] = []; const taken = new Map<string, number>();

  const walk = (sec: Element, number: string, level: number, moduleKey: string): void => {
    let i = 0;
    for (const c of kids(sec)) {
      if (c.tagName !== 'section') continue;
      i++; const num = `${number}.${i}`;
      toc.push({ level, number: num, title: text(kids(c).find((x) => x.tagName === 'title')), module: moduleKey });
      walk(c, num, level + 1, moduleKey);
    }
  };

  for (const ch of body ? kids(body).filter((c) => c.tagName === 'chapter') : []) {
    const number = Number(attr(ch, 'number')) || chapters.length + 1; const title = text(kids(ch).find((x) => x.tagName === 'title')); const cid = attr(ch, 'id');
    chapters.push({ number, title, ...(cid ? { id: cid } : {}) });
    const intro = hasOwnContent(ch, new Set(['section']));
    let introKey = '';
    if (intro) {
      introKey = cid ? `id:${cid}` : keyOf('', number, `${title} (introduction)`, taken);
      modules.push({ key: introKey, ...(cid ? { id: cid } : {}), chapter: number, title, kind: 'chapter-intro', pictures: picturesUnder(ch, (c) => c.tagName === 'section' || c.tagName === 'title') });
    }
    toc.push({ level: 1, number: String(number), title, module: introKey || '' });
    let i = 0;
    for (const s of kids(ch).filter((c) => c.tagName === 'section')) {
      i++; const st = text(kids(s).find((x) => x.tagName === 'title')); const sid = attr(s, 'id');
      const key = keyOf(sid, number, st, taken);
      modules.push({ key, ...(sid ? { id: sid } : {}), chapter: number, title: st, kind: 'section', pictures: picturesUnder(s) });
      toc.push({ level: 2, number: `${number}.${i}`, title: st, module: key });
      walk(s, `${number}.${i}`, 3, key);
    }
    // a chapter without introductory text of its own belongs to its first module (so every contents line names a module)
    if (!introKey) { const first = modules.find((m) => m.chapter === number); const line = toc.find((t) => t.level === 1 && t.number === String(number)); if (first && line) line.module = first.key; }
  }
  return { format: 'jss', docType: attr(root, 'docType'), meta, chapters, modules, toc };
}

// ── JSG ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function outlineOfJsg(xml: string): Outline {
  const root = parse(xml, 'jsgdoc');
  const meta: Record<string, string> = {};
  const m = kids(root).find((c) => c.tagName === 'meta');
  for (const c of m ? kids(m) : []) meta[c.tagName] = text(c);
  const chapters: Outline['chapters'] = []; const modules: OutlineModule[] = []; const toc: OutlineToc[] = []; const taken = new Map<string, number>();

  const clauses = (e: Element, number: string, level: number, moduleKey: string): void => {
    let i = 0;
    for (const c of kids(e)) {
      if (c.tagName !== 'clause') continue;
      i++; const num = `${number}.${i}`;
      toc.push({ level, number: num, title: attr(c, 'title'), module: moduleKey });
      clauses(c, num, level + 1, moduleKey);
    }
  };

  let n = 0;
  for (const ch of kids(root).filter((c) => c.tagName === 'chapter')) {
    n++; const title = attr(ch, 'title'); const cid = attr(ch, 'id');
    chapters.push({ number: n, title, ...(cid ? { id: cid } : {}) });
    const secs = kids(ch).filter((c) => c.tagName === 'section'); let first = '';
    const line: OutlineToc = { level: 1, number: String(n), title, module: '' }; toc.push(line);
    let i = 0;
    for (const s of secs) {
      i++; const st = attr(s, 'title'); const sid = attr(s, 'id'); const key = keyOf(sid, n, st, taken); if (!first) first = key;
      modules.push({ key, ...(sid ? { id: sid } : {}), chapter: n, title: st, kind: 'section', pictures: picturesUnder(s) });
      toc.push({ level: 2, number: `${n}.${i}`, title: st, module: key });
      clauses(s, `${n}.${i}`, 3, key);
    }
    line.module = first;
  }
  const apps = kids(root).find((c) => c.tagName === 'appendices');
  for (const a of apps ? kids(apps).filter((c) => c.tagName === 'appendix') : []) {
    n++; const label = attr(a, 'label'); const title = `${label ? `${label} ` : ''}${attr(a, 'title')}`.trim(); const aid = attr(a, 'id');
    chapters.push({ number: n, title, ...(aid ? { id: aid } : {}) });
    const key = keyOf(aid, n, title, taken);
    modules.push({ key, ...(aid ? { id: aid } : {}), chapter: n, title, kind: 'appendix', pictures: picturesUnder(a) });
    toc.push({ level: 1, number: label || String(n), title, module: key });
  }
  const plates = kids(root).find((c) => c.tagName === 'plates');
  for (const p of plates ? kids(plates).filter((c) => c.tagName === 'plate') : []) {
    n++; const ref = attr(p, 'ref'); const title = `PLATE ${ref}${attr(p, 'title') ? ` - ${attr(p, 'title')}` : ''}`.trim(); const pid = attr(p, 'id');
    chapters.push({ number: n, title, ...(pid ? { id: pid } : {}) });
    const key = keyOf(pid, n, title, taken);
    modules.push({ key, ...(pid ? { id: pid } : {}), chapter: n, title, kind: 'plate', pictures: picturesUnder(p) });
    toc.push({ level: 1, number: ref || String(n), title, module: key });
  }
  return { format: 'jsg', docType: attr(root, 'type'), meta, chapters, modules, toc };
}
