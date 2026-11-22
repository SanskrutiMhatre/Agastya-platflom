/**
 * Text metrics and font selection for the publication PDF.
 *
 * The reference publication is typeset in Arial. The PDF standard-14 font
 * Helvetica is metric-compatible with Arial (identical advance widths), needs
 * no embedding, and is what pdfmake ships as a standard font, so it is the
 * body font. Helvetica only covers the WinAnsi (Windows-1252) repertoire;
 * anything outside it (Greek, mathematical operators, …) is set in Roboto,
 * which pdfmake bundles as a real Unicode font, one run at a time.
 *
 * The advance-width tables below are the AFM widths of Helvetica and
 * Helvetica-Bold for printable ASCII (1/1000 em). They are used to build dot
 * leaders (table-of-contents lines) that end exactly on the right margin, the
 * way the reference's leaders do, without needing a layout pass per line.
 */

import { LH_FALLBACK } from './pdf-theme';

export const FONT_TEXT = 'Helvetica';
export const FONT_FALLBACK = 'Roboto';
export const FONT_MONO = 'Courier';

// prettier-ignore
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// prettier-ignore
const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Advance width of one character, in 1/1000 em. Non-ASCII characters use the table average. */
function charWidth(ch: string, bold: boolean): number {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return (bold ? W_BOLD : W_REGULAR)[c - 32];
  if (c === 0xa0) return 278;
  return 556;
}

/** Width in points of `text` set in Helvetica(-Bold) at `size`. Kerning is ignored (pdfmake does not apply it either). */
export function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, bold);
  return (w * size) / 1000;
}

/** Windows-1252 code points above U+00FF that Helvetica can encode. */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d,
  0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  if (c === 9 || c === 10 || c === 13) return true;
  if (c >= 0x20 && c <= 0x7e) return true;
  if (c >= 0xa0 && c <= 0xff) return true;
  return WIN_ANSI_EXTRA.has(c);
}

/** Loose structural type for pdfmake content nodes: the library's shapes are data, not program logic. */
export type PNode = Record<string, unknown>;

/**
 * One text run -> one or more runs, each tagged with the font that can encode it. Text that Helvetica can
 * encode stays a single run in the default font; only the stretches that cannot are switched to Roboto.
 */
export function fontRuns(text: string, props: PNode = {}): PNode[] {
  if (!text) return [];
  let simple = true;
  for (const ch of text) {
    if (!isWinAnsi(ch)) {
      simple = false;
      break;
    }
  }
  if (simple) return [{ ...props, text }];
  const out: PNode[] = [];
  let buf = '';
  let fallback = false;
  const flush = () => {
    if (!buf) return;
    // Roboto's line box is taller than Helvetica's: a smaller factor keeps the line pitch of lines that contain it
    out.push(fallback ? { ...props, text: buf, font: FONT_FALLBACK, lineHeight: props.lineHeight ?? LH_FALLBACK } : { ...props, text: buf });
    buf = '';
  };
  for (const ch of text) {
    const fb = !isWinAnsi(ch);
    if (fb !== fallback) {
      flush();
      fallback = fb;
    }
    buf += ch;
  }
  flush();
  return out;
}

/** Re-tags every plain-string run in an already-built inline array so unsupported glyphs use the fallback font. */
export function withFallbackFonts(runs: PNode[]): PNode[] {
  const out: PNode[] = [];
  for (const r of runs) {
    if (typeof r.text === 'string' && !r.font) {
      const { text, ...rest } = r;
      out.push(...fontRuns(text, rest));
    } else out.push(r);
  }
  return out;
}

/**
 * Justified text: pdfmake puts a full word gap at every boundary between two runs, even where there is no space, so
 * a comma after a cross-reference ("Figure 1 , and") or a bracket before one would open up. Punctuation that touches
 * a link run is therefore moved into it (it takes the link's colour); the reference sets it black, which pdfmake
 * cannot do without the gap.
 */
export function attachPunctuation(runs: PNode[]): PNode[] {
  const out = runs.map((r) => ({ ...r }));
  const isLink = (r: PNode) => r.linkToDestination !== undefined || r.link !== undefined;
  for (let i = 0; i < out.length; i++) {
    if (!isLink(out[i]) || typeof out[i].text !== 'string') continue;
    const next = out[i + 1];
    if (next && !isLink(next) && typeof next.text === 'string') {
      const m = /^[.,;:!?)\]]+/.exec(next.text);
      if (m) {
        out[i].text += m[0];
        next.text = next.text.slice(m[0].length);
      }
    }
    const prev = out[i - 1];
    if (prev && !isLink(prev) && typeof prev.text === 'string') {
      const m = /[(\[]+$/.exec(prev.text);
      if (m) {
        out[i].text = m[0] + out[i].text;
        prev.text = prev.text.slice(0, prev.text.length - m[0].length);
      }
    }
  }
  return out.filter((r) => r.text !== '');
}

const HYPHENATED = /[^\s-]-[^\s-]/;

/**
 * Keeps hyphenated words ("engine-driven", DMC-A-29-10) in one piece for justified text. pdfmake spreads the justification
 * slack over every inline boundary, and it makes a boundary of every break opportunity after a hyphen, so a word
 * broken at its hyphen in the middle of a line would show a stray gap. Words wider than `maxWidth` stay breakable.
 */
export function glueHyphens(runs: PNode[], maxWidth: number): PNode[] {
  const out: PNode[] = [];
  const push = (r: PNode) => {
    const last = out[out.length - 1];
    if (last && !last.noWrap && !r.noWrap && typeof last.text === 'string' && typeof r.text === 'string' && sameStyle(last, r)) last.text += r.text;
    else out.push(r);
  };
  for (const r of runs) {
    if (typeof r.text !== 'string' || r.noWrap || !HYPHENATED.test(r.text)) {
      push({ ...r });
      continue;
    }
    const { text, ...rest } = r;
    const size = typeof r.fontSize === 'number' ? r.fontSize : 11;
    for (const chunk of text.match(/\S+\s*|\s+/g) ?? []) {
      const word = chunk.trimEnd();
      const glue = HYPHENATED.test(word) && textWidth(word, size, !!r.bold) <= maxWidth;
      push(glue ? { ...rest, text: chunk, noWrap: true } : { ...rest, text: chunk });
    }
  }
  return out;
}

function sameStyle(a: PNode, b: PNode): boolean {
  const ka = Object.keys(a).filter((k) => k !== 'text');
  const kb = Object.keys(b).filter((k) => k !== 'text');
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/**
 * Width of the last line of `text` when greedily word-wrapped into `maxWidth` (the way pdfmake wraps), so a dot
 * leader can fill exactly the remainder of that line.
 */
export function lastLineWidth(text: string, maxWidth: number, size: number, bold = false): number {
  const space = textWidth(' ', size, bold);
  let line = 0;
  for (const word of text.split(' ')) {
    const w = textWidth(word, size, bold);
    if (line === 0) line = w;
    else if (line + space + w <= maxWidth) line += space + w;
    else line = w;
    while (line > maxWidth) line -= maxWidth; // a single over-long word: pdfmake breaks it, the remainder is what is left
  }
  return line;
}

/** Number of dots that fill the gap left on the last line of `label` once `tail` (the page number) is right-aligned. */
export function leaderDots(label: string, tail: string, maxWidth: number, size: number, bold = false): string {
  const used = lastLineWidth(label, maxWidth, size, bold) + textWidth(tail, size, bold);
  const dot = textWidth('.', size, bold);
  const n = Math.floor((maxWidth - used) / dot) - 1;
  return n > 2 ? '.'.repeat(n) : '..';
}
