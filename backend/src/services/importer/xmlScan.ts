// =============================================================================
// A small, dependency-free XML tag scanner for the importer.
//
// WHY NOT A DOM: the importer repairs files by editing their TEXT. Serialising a DOM would rewrite the
// DOCTYPE (entity declarations are what bind ICN artwork), re-indent, drop comments and change the
// attribute quoting - a "repair" that touches everything is not a repair a customer can audit. A scanner
// that reports where each tag starts and ends lets a rule change exactly the bytes it owns.
//
// It understands what S1000D files contain: comments, processing instructions, CDATA, and a DOCTYPE with an
// internal subset (which holds `<!ENTITY ...>` declarations and must be skipped as a unit). It does not
// validate; malformed input yields whatever tags can be recognised.
// =============================================================================

import { escText, escAttr } from '../../lib/xml';
export interface Tag {
  kind: 'open' | 'close' | 'self';
  name: string;
  /** Offset of the `<`. */
  start: number;
  /** Offset just past the `>`. */
  end: number;
  /** Raw text between the name and the closing `>` (`/` of a self-closing tag excluded). */
  rawAttrs: string;
}

/** The end of a DOCTYPE declaration starting at `at` (just past its `>`), honouring quotes and the `[ ... ]` internal subset. */
export function doctypeEnd(xml: string, at: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = at + 9; i < xml.length; i++) {
    const c = xml[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) return i + 1;
  }
  return xml.length;
}

/** Every tag in the document, in order, with offsets. Comments, PIs, CDATA and the DOCTYPE are skipped. */
export function* scanTags(xml: string, from = 0): Generator<Tag> {
  let i = from;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) return;
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt + 9); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (xml.startsWith('<!DOCTYPE', lt) || xml.startsWith('<!doctype', lt)) { i = doctypeEnd(xml, lt); continue; }
    if (xml[lt + 1] === '!') { const e = xml.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }

    // find the closing '>' outside quotes
    let j = lt + 1;
    let quote: string | null = null;
    for (; j < n; j++) {
      const c = xml[j];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (j >= n) return;
    const inner = xml.slice(lt + 1, j);
    const isClose = inner.startsWith('/');
    const selfClosing = !isClose && inner.endsWith('/');
    const body = isClose ? inner.slice(1) : selfClosing ? inner.slice(0, -1) : inner;
    const m = /^\s*([^\s/>]+)([\s\S]*)$/.exec(body);
    if (m) yield { kind: isClose ? 'close' : selfClosing ? 'self' : 'open', name: m[1], start: lt, end: j + 1, rawAttrs: m[2] };
    i = j + 1;
  }
}

/** Attributes of a tag's raw attribute text. Later duplicates win (as most parsers' loose mode); entity references are left as written. */
export function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

/** Replace (or add) attribute values in a tag's raw attribute text, keeping every other byte (order, quoting, spacing) as written. */
export function setAttrs(raw: string, values: Record<string, string>): string {
  let out = raw;
  for (const [k, v] of Object.entries(values)) {
    const esc = v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const re = new RegExp(`(\\s${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
    if (re.test(out)) out = out.replace(re, (_w, pre: string) => `${pre}"${esc}"`);
    else out = `${out.replace(/\s+$/, '')} ${k}="${esc}"` + (/\s$/.test(raw) ? ' ' : '');
  }
  return out;
}

/** Offset of the root element's opening tag (`<dmodule`, `<pm`), or -1. Skips the prolog, comments and the DOCTYPE. */
export function rootTag(xml: string): Tag | null {
  for (const t of scanTags(xml)) if (t.kind !== 'close') return t;
  return null;
}

/** The `[start, end)` extent of the element opened by `tags[index]`, as tag indexes, using a precomputed list of tags. */
export function matchingClose(tags: Tag[], index: number): number {
  const open = tags[index];
  if (open.kind === 'self') return index;
  let depth = 0;
  for (let i = index; i < tags.length; i++) {
    const t = tags[i];
    if (t.name !== open.name) continue;
    if (t.kind === 'open') depth++;
    else if (t.kind === 'close') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Decode the five predefined entities and numeric references in text (enough for titles read from a PM or DM head). */
export function decodeText(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

export { escText as escapeText, escAttr as escapeAttr };

/** The end-of-line sequence a file uses (a repair must not turn CRLF files into mixed-EOL files). */
export const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');

/** 1-based line number of an offset. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) line++;
  return line;
}
