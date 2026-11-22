/**
 * Find & replace over the XML model. Matches may span inline element
 * boundaries within a text block (text is concatenated per block).
 */
import type { Grammar } from '../core/grammar';
import type { ModelPos } from '../core/document';
import { textBlockOf } from '../core/ops';

export interface FindOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  scope: 'all' | 'content' | 'element';
  attributes: boolean;
  elementFilter?: string;
}

export interface TextMatch {
  kind: 'text';
  start: ModelPos;
  end: ModelPos;
  text: string;
  block: Element | null;
}

export interface AttrMatch {
  kind: 'attr';
  element: Element;
  attr: string;
  index: number;
  length: number;
  text: string;
}

export type Match = TextMatch | AttrMatch;

export function buildRegex(o: FindOptions): RegExp | null {
  if (!o.query) return null;
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, 'gu' + (o.matchCase ? '' : 'i'));
  } catch {
    return null;
  }
}

interface Seg { node: Text; start: number }

export function findAll(doc: Document, scopeRoot: Element | null, o: FindOptions, g: Grammar | null): Match[] {
  const re = buildRegex(o);
  if (!re) return [];
  const root = scopeRoot ?? (o.scope === 'content' ? doc.getElementsByTagName('content')[0] ?? doc.documentElement : doc.documentElement);
  if (!root) return [];
  const out: Match[] = [];
  // group text nodes per text block
  const w = doc.createTreeWalker(root, 4 | 1);
  const groups: { block: Element | null; segs: Seg[]; text: string }[] = [];
  let cur: { block: Element | null; segs: Seg[]; text: string } | null = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 1) {
      if (o.attributes) {
        const el = n as Element;
        if (o.elementFilter && el.nodeName !== o.elementFilter) continue;
        for (const a of Array.from(el.attributes)) {
          if (a.name.startsWith('xmlns')) continue;
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(a.value))) {
            if (!m[0].length) {
              re.lastIndex++;
              continue;
            }
            out.push({ kind: 'attr', element: el, attr: a.name, index: m.index, length: m[0].length, text: m[0] });
          }
        }
      }
      continue;
    }
    const t = n as Text;
    if (!t.nodeValue) continue;
    const parent = t.parentNode as Element;
    if (o.elementFilter && !closestNamed(parent, o.elementFilter)) continue;
    const block = textBlockOf(t, g);
    if (!cur || cur.block !== block || !block) {
      cur = { block, segs: [], text: '' };
      groups.push(cur);
    }
    cur.segs.push({ node: t, start: cur.text.length });
    cur.text += t.nodeValue;
  }
  for (const gr of groups) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(gr.text))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      const s = locate(gr.segs, m.index, false);
      const e = locate(gr.segs, m.index + m[0].length, true);
      out.push({ kind: 'text', start: s, end: e, text: m[0], block: gr.block });
    }
  }
  // document order: text and attribute matches interleaved by node order
  out.sort((a, b) => {
    const na = a.kind === 'text' ? a.start.node : a.element;
    const nb = b.kind === 'text' ? b.start.node : b.element;
    if (na === nb) return (a.kind === 'text' ? a.start.offset : -1) - (b.kind === 'text' ? b.start.offset : -1);
    return na.compareDocumentPosition(nb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  return out;
}

function closestNamed(el: Element, name: string): boolean {
  for (let c: Node | null = el; c && c.nodeType === 1; c = c.parentNode) if (c.nodeName === name) return true;
  return false;
}

function locate(segs: Seg[], off: number, isEnd: boolean): ModelPos {
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const len = s.node.nodeValue!.length;
    if (off < s.start + len || (isEnd && off === s.start + len) || i === segs.length - 1) {
      return { node: s.node, offset: Math.max(0, Math.min(len, off - s.start)) };
    }
  }
  return { node: segs[0].node, offset: 0 };
}

export function replacementFor(m: Match, o: FindOptions, replacement: string): string {
  if (!o.regex) return replacement;
  const re = buildRegex({ ...o, wholeWord: false });
  if (!re) return replacement;
  re.lastIndex = 0;
  return m.text.replace(new RegExp(re.source, re.flags.replace('g', '')), replacement);
}

/** Replaces one match (must still be valid). Returns the caret after the replacement. */
export function applyReplace(m: Match, text: string): ModelPos | null {
  if (m.kind === 'attr') {
    const v = m.element.getAttribute(m.attr) ?? '';
    if (v.substr(m.index, m.length) !== m.text) return null;
    const nv = v.slice(0, m.index) + text + v.slice(m.index + m.length);
    const a = Array.from(m.element.attributes).find((x) => x.name === m.attr);
    if (a) a.value = nv;
    return null;
  }
  const s = m.start;
  const e = m.end;
  const sn = s.node as Text;
  const en = e.node as Text;
  if (!sn.isConnected || !en.isConnected) return null;
  if (sn === en) {
    if (sn.nodeValue!.slice(s.offset, e.offset) !== m.text) return null;
    sn.replaceData(s.offset, e.offset - s.offset, text);
    return { node: sn, offset: s.offset + text.length };
  }
  // spanning nodes
  const doc = sn.ownerDocument!;
  const range = doc.createRange();
  range.setStart(sn, s.offset);
  range.setEnd(en, e.offset);
  if (range.toString() !== m.text) return null;
  const w = doc.createTreeWalker(range.commonAncestorContainer, 4);
  const nodes: Text[] = [];
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) if (range.intersectsNode(n)) nodes.push(n);
  for (const n of nodes) {
    if (n === sn) n.replaceData(s.offset, n.length - s.offset, text);
    else if (n === en) n.deleteData(0, e.offset);
    else n.nodeValue = '';
  }
  return { node: sn, offset: s.offset + text.length };
}
