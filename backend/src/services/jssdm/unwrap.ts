// =============================================================================
// Unwrapping Xignal's chapter folders.
//
// A JSS publication exported by Xignal does not list its chapters at the top of the publication module. It wraps everything in one entry
// named after the publication, and that holds a "Front matter" folder and a "Chapter" folder, and the chapters are folders INSIDE
// "Chapter", each named by its number ("1", "3"):
//
//   Xignal JSS-0251 Test Publication            <- the wrapper
//     Front matter                              <- read into Settings by the front-matter import, left out of the body (prune.ts)
//     Chapter
//       1  [ chapter-heading module, content modules ... ]
//       3  [ ... ]
//
// The JSS engine turns each TOP-LEVEL entry into a chapter, so left as it is such a publication prints one chapter ("Chapter 1 -
// <publication title>") whose sections are "Chapter" and then the real chapters one level further down, numbered 1.1.1 where the reference
// has chapter 1. This lifts the real chapters to the top, and when every one of them is named by a number, makes that number the chapter's
// own (so a book that has chapters 1 and 3 numbers them 1 and 3, as Xignal does) and lets the first module's title name the chapter.
//
// Pure text in, text out, like prune.ts, and conservative: it acts only on the exact shape above (one wrapper at the top, a folder named
// Chapter or Chapters inside it, nothing of the wrapper's own besides folders) and otherwise returns the text untouched.
// =============================================================================

interface Entry { open: string; selfClosing: boolean; pieces: Piece[] }
type Piece = string | Entry;

export interface UnwrapResult {
  text: string;
  /** Whether the wrapper shape was found and the chapters were lifted. */
  unwrapped: boolean;
  /** How many chapters the publication has afterwards (0 when nothing was done). */
  chapters: number;
  /** Whether the chapters took their numbers from their folder names. */
  numbered: boolean;
}

const UNTOUCHED = (text: string): UnwrapResult => ({ text, unwrapped: false, chapters: 0, numbered: false });
const OPEN = /<pmEntry(?=[\s>/])/g;

/** The end of the tag that starts at `from` (the index just past its `>`), skipping `>` inside quoted attribute values. */
function tagEnd(t: string, from: number): number {
  let quote = '';
  for (let i = from; i < t.length; i++) {
    const c = t[i];
    if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') return i + 1;
  }
  return -1;
}

/** The pieces of `t`, with every pmEntry element turned into an Entry. Null when the pmEntry tags do not nest properly. */
function parse(t: string): Piece[] | null {
  const root: Piece[] = [];
  const stack: Entry[] = [];
  let i = 0;
  const push = (p: Piece) => { (stack.length ? stack[stack.length - 1].pieces : root).push(p); };
  const text = (s: string) => { if (!s) return; const top = stack.length ? stack[stack.length - 1].pieces : root; if (typeof top[top.length - 1] === 'string') top[top.length - 1] = (top[top.length - 1] as string) + s; else top.push(s); };
  while (i < t.length) {
    OPEN.lastIndex = i;
    const m = OPEN.exec(t);
    const close = t.indexOf('</pmEntry>', i);
    const openAt = m ? m.index : -1;
    if (openAt < 0 && close < 0) { text(t.slice(i)); break; }
    if (close >= 0 && (openAt < 0 || close < openAt)) {                         // a closing tag comes first
      text(t.slice(i, close));
      const done = stack.pop(); if (!done) return null;
      i = close + '</pmEntry>'.length;
      continue;
    }
    text(t.slice(i, openAt));
    const end = tagEnd(t, openAt); if (end < 0) return null;
    const tag = t.slice(openAt, end);
    const e: Entry = { open: tag, selfClosing: /\/\s*>$/.test(tag), pieces: [] };
    push(e);
    if (!e.selfClosing) stack.push(e);
    i = end;
  }
  return stack.length ? null : root;
}

const serialize = (ps: Piece[]): string => ps.map((p) => typeof p === 'string' ? p : p.selfClosing ? p.open : `${p.open}${serialize(p.pieces)}</pmEntry>`).join('');

const strings = (e: Entry): string => e.pieces.filter((p): p is string => typeof p === 'string').join('');
const TITLE = /<pmEntryTitle\b[^>]*>([\s\S]*?)<\/pmEntryTitle>/;
const titleOf = (e: Entry): string => { const m = TITLE.exec(strings(e)); return m ? m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : ''; };
const entries = (e: Entry): Entry[] => e.pieces.filter((p): p is Entry => typeof p !== 'string');
/** What the entry itself holds besides its title, comments, whitespace and the entries inside it: a module include or reference. */
const ownContent = (e: Entry): string => strings(e).replace(/<!--[\s\S]*?-->/g, '').replace(TITLE, '').trim();

/** The same open tag with one more attribute. */
const withAttribute = (open: string, name: string, value: string): string => open.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);

export const CHAPTER_NUMBER_ATTRIBUTE = 'agastyaChapterNumber';

export function unwrapChapterFolders(pmText: string): UnwrapResult {
  const c = /<content(?:\s[^>]*)?>/.exec(pmText);
  const cEnd = pmText.lastIndexOf('</content>');
  if (!c || cEnd < 0) return UNTOUCHED(pmText);
  const from = c.index + c[0].length;
  const inner = pmText.slice(from, cEnd);
  const top = parse(inner);
  if (!top) return UNTOUCHED(pmText);

  const tops = top.filter((p): p is Entry => typeof p !== 'string');
  if (tops.length !== 1 || tops[0].selfClosing) return UNTOUCHED(pmText);
  // nothing but whitespace and comments around the wrapper
  if (top.some((p) => typeof p === 'string' && p.replace(/<!--[\s\S]*?-->/g, '').trim() !== '')) return UNTOUCHED(pmText);
  const wrapper = tops[0];
  if (ownContent(wrapper) !== '') return UNTOUCHED(pmText);                       // the wrapper holds modules of its own: it is a real chapter
  const holders = entries(wrapper).filter((e) => !e.selfClosing && /^chapters?$/i.test(titleOf(e)));
  if (holders.length !== 1 || ownContent(holders[0]) !== '') return UNTOUCHED(pmText);

  // The wrapper's entries in order, with the "Chapter" folder replaced by the entries inside it.
  const lifted: Entry[] = [];
  for (const e of entries(wrapper)) {
    if (e === holders[0]) lifted.push(...entries(e)); else lifted.push(e);
  }
  if (!lifted.length) return UNTOUCHED(pmText);

  // Every chapter named by a number, no number twice: then the number is the chapter's own and the first module names it.
  const numbers = lifted.map((e) => (/^\d+$/.test(titleOf(e)) ? String(Number(titleOf(e))) : ''));
  const numbered = numbers.every((n) => n !== '') && new Set(numbers).size === numbers.length;
  const out: Piece[] = [];
  lifted.forEach((e, k) => {
    if (!numbered) { out.push(e); return; }
    const own = e.pieces.map((p) => typeof p === 'string' ? p.replace(TITLE, '') : p);
    out.push({ open: withAttribute(e.open, CHAPTER_NUMBER_ATTRIBUTE, numbers[k]), selfClosing: e.selfClosing, pieces: own });
  });
  const body = out.map((p) => `\n${serialize([p])}`).join('') + '\n';
  return { text: pmText.slice(0, from) + body + pmText.slice(cEnd), unwrapped: true, chapters: lifted.length, numbered };
}
