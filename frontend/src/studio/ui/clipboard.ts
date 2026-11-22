/**
 * Clipboard conversions:
 *  - copy: model fragment -> S1000D XML (lossless, embedded in text/html) + HTML + plain text;
 *  - paste: S1000D XML, HTML (Word / browsers) -> S1000D structures, plain text -> paragraphs.
 */
import type { Grammar } from '../core/grammar';
import type { ModelPos, ModelSelection } from '../core/document';
import * as ops from '../core/ops';
import { buildGrid, coverCells, createTable } from '../core/table';
import { dedupeFragmentIds } from '../core/ids';
import { createEl, elementChildren, elementIndex, stripInvalidXmlChars } from '../core/xml';

export const MIME = 'application/x-s1000d+xml';

export function fragmentToXml(frag: Node): string {
  const s = new XMLSerializer();
  if (frag.nodeType === 11) return Array.from(frag.childNodes).map((n) => s.serializeToString(n)).join('');
  return s.serializeToString(frag);
}

export function xmlToFragment(xml: string, doc: Document): DocumentFragment | null {
  const wrapped = `<fragment xmlns:xlink="http://www.w3.org/1999/xlink">${xml}</fragment>`;
  const parsed = new DOMParser().parseFromString(wrapped, 'application/xml');
  if (parsed.getElementsByTagName('parsererror').length) return null;
  // comments and processing instructions are not content: pasted, they would only get in the way of the text around them
  const walker = parsed.createTreeWalker(parsed.documentElement, 128 /* SHOW_COMMENT */ | 64 /* SHOW_PROCESSING_INSTRUCTION */);
  const drop: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) drop.push(n);
  for (const n of drop) n.parentNode?.removeChild(n);
  const frag = doc.createDocumentFragment();
  for (const c of Array.from(parsed.documentElement.childNodes)) frag.appendChild(doc.importNode(c, true));
  return frag;
}

/** Simple HTML rendering of a fragment for pasting into other applications. */
export function fragmentToHtml(frag: Node): string {
  const conv = (n: Node): string => {
    if (n.nodeType === 3) return escapeHtmlText(n.nodeValue ?? '');
    if (n.nodeType !== 1 && n.nodeType !== 11) return '';
    const kids = Array.from(n.childNodes).map(conv).join('');
    if (n.nodeType === 11) return kids;
    const el = n as Element;
    switch (el.nodeName) {
      case 'para': case 'simplePara': case 'notePara': case 'warningAndCautionPara': return `<p>${kids}</p>`;
      case 'title': return `<h3>${kids}</h3>`;
      case 'emphasis': {
        const t = el.getAttribute('emphasisType') ?? 'em01';
        const tag = t === 'em02' ? 'i' : t === 'em03' ? 'u' : t === 'em05' ? 's' : 'b';
        return `<${tag}>${kids}</${tag}>`;
      }
      case 'subScript': return `<sub>${kids}</sub>`;
      case 'superScript': return `<sup>${kids}</sup>`;
      case 'randomList': return `<ul>${kids}</ul>`;
      case 'sequentialList': return `<ol>${kids}</ol>`;
      case 'listItem': return `<li>${kids}</li>`;
      case 'table': return `<div>${kids}</div>`;
      case 'tgroup': return `<table border="1">${kids}</table>`;
      case 'thead': return `<thead>${kids}</thead>`;
      case 'tbody': return `<tbody>${kids}</tbody>`;
      case 'row': return `<tr>${kids}</tr>`;
      case 'entry': return `<td>${kids}</td>`;
      case 'colspec': case 'spanspec': return '';
      case 'warning': case 'caution': case 'note': return `<div><b>${el.nodeName.toUpperCase()}</b>${kids}</div>`;
      default: return kids;
    }
  };
  return conv(frag);
}

function escapeHtmlText(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function writeClipboard(dt: DataTransfer, frag: Node, plain: string) {
  const xml = fragmentToXml(frag);
  dt.setData('text/plain', plain);
  dt.setData(MIME, xml);
  dt.setData('text/html', `<span data-s1000d="${encodeURIComponent(xml)}"></span>${fragmentToHtml(frag)}`);
}

// ----------------------------------------------------------------- paste
export interface PasteSource {
  xml?: string | null;
  html?: string | null;
  text?: string | null;
}

export function readClipboard(dt: DataTransfer): PasteSource {
  let xml = dt.getData(MIME) || null;
  const html = dt.getData('text/html') || null;
  if (!xml && html) {
    const m = html.match(/data-s1000d="([^"]*)"/);
    if (m) xml = decodeURIComponent(m[1]);
  }
  return { xml, html, text: dt.getData('text/plain') || null };
}

const BLOCK_HTML = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'LI', 'PRE', 'TR', 'TD', 'TH']);
const BLOCK_SELECTOR = [...BLOCK_HTML, 'UL', 'OL', 'TABLE'].join(',');

/** Whether an HTML element is block-level for pasting purposes (it must not be flattened into running text). */
function isBlockHtml(e: Element): boolean {
  return BLOCK_HTML.has(e.tagName) || e.tagName === 'UL' || e.tagName === 'OL' || e.tagName === 'TABLE';
}

/** Whether blocks hide anywhere below `e`: Google Docs and Word wrap whole documents in a `<b>` or `<span>`. */
function hasBlockDescendant(e: Element): boolean {
  return !!e.querySelector(BLOCK_SELECTOR);
}

/** Converts HTML into a fragment of S1000D elements (para, emphasis, lists, CALS tables). */
export function htmlToFragment(html: string, doc: Document, g: Grammar | null): DocumentFragment {
  const src = new DOMParser().parseFromString(html, 'text/html');
  // Word/HTML cleanup
  src.querySelectorAll('style,script,meta,link,title,o\\:p,xml').forEach((e) => e.remove());
  const frag = doc.createDocumentFragment();
  let current: Element | null = null; // open para for inline content

  const para = () => {
    if (!current) {
      current = createEl(doc, 'para');
      frag.appendChild(current);
    }
    return current;
  };
  const closePara = () => {
    current = null;
  };

  const inline = (n: Node, into: Element) => {
    if (n.nodeType === 3) {
      const t = stripInvalidXmlChars(n.nodeValue ?? '').replace(/[\s ]+/g, ' ');
      if (t) into.appendChild(doc.createTextNode(t));
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as HTMLElement;
    const tag = e.tagName;
    let wrap: Element | null = null;
    const style = (e.getAttribute('style') ?? '').toLowerCase();
    if (tag === 'B' || tag === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(style)) wrap = emph(doc, 'em01');
    else if (tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(style)) wrap = emph(doc, 'em02');
    else if (tag === 'U' || /text-decoration:[^;]*underline/.test(style)) wrap = emph(doc, 'em03');
    else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') wrap = emph(doc, 'em05');
    else if (tag === 'SUB') wrap = createEl(doc, 'subScript');
    else if (tag === 'SUP') wrap = createEl(doc, 'superScript');
    else if (tag === 'BR') {
      into.appendChild(doc.createTextNode(' '));
      return;
    } else if (tag === 'IMG') return;
    const target = wrap ?? into;
    for (const c of Array.from(e.childNodes)) {
      if (c.nodeType === 1 && isBlockHtml(c as Element)) continue;
      inline(c, target);
    }
    if (wrap && wrap.childNodes.length) into.appendChild(wrap);
  };

  const list = (e: Element, into: Node) => {
    const l = createEl(doc, e.tagName === 'OL' ? 'sequentialList' : 'randomList');
    for (const li of Array.from(e.children)) {
      if (li.tagName !== 'LI') continue;
      const item = createEl(doc, 'listItem');
      let open: Element | null = null; // the paragraph inline content flows into
      let last: Element | null = null; // the paragraph a nested list belongs to
      const newPara = () => {
        last = createEl(doc, 'para');
        item.appendChild(last);
        return last;
      };
      const fill = (n: Node) => {
        if (n.nodeType === 3 && !/\S/.test(n.nodeValue ?? '') && !open) return;
        open ??= newPara();
        inline(n, open);
      };
      for (const c of Array.from(li.childNodes)) {
        const tag = c.nodeType === 1 ? (c as Element).tagName : '';
        if (tag === 'UL' || tag === 'OL') list(c as Element, last ?? newPara());
        else if (tag === 'P' || tag === 'DIV') {
          // each paragraph of a list item stays a paragraph
          open = null;
          const p = newPara();
          for (const cc of Array.from(c.childNodes)) {
            const t = cc.nodeType === 1 ? (cc as Element).tagName : '';
            if (t === 'UL' || t === 'OL') list(cc as Element, p);
            else inline(cc, p);
          }
          open = null;
        } else fill(c);
      }
      for (const p of Array.from(item.children)) trim(p);
      for (const p of Array.from(item.children)) if (!/\S/.test(p.textContent ?? '') && !p.children.length) item.removeChild(p);
      if (!item.children.length) item.appendChild(createEl(doc, 'para'));
      l.appendChild(item);
    }
    if (l.childNodes.length) into.appendChild(l);
  };

  const table = (e: HTMLTableElement) => {
    const rows = Array.from(e.rows);
    const headRows = rows.filter((r) => r.parentElement?.tagName === 'THEAD' || Array.from(r.cells).every((c) => c.tagName === 'TH'));
    const header = headRows.length > 0 && rows.indexOf(headRows[0]) === 0;
    // where every cell really sits: row/column spans push the cells after them to the right
    const occupied: boolean[][] = rows.map(() => []);
    const placed: { cell: HTMLTableCellElement; r: number; c: number; cs: number; rs: number }[] = [];
    let cols = 1;
    rows.forEach((row, r) => {
      let c = 0;
      for (const cell of Array.from(row.cells)) {
        while (occupied[r][c]) c++;
        const cs = Math.max(1, Math.min(cell.colSpan || 1, 100));
        // a cell never reaches past the last row, nor out of the header row into the body
        const rs = header && r === 0 ? 1 : Math.max(1, Math.min(cell.rowSpan || 1, rows.length - r));
        for (let rr = r; rr < r + rs; rr++) for (let cc = c; cc < c + cs; cc++) occupied[rr][cc] = true;
        placed.push({ cell, r, c, cs, rs });
        c += cs;
        cols = Math.max(cols, c);
      }
    });
    const t = createTable(doc, g, { rows: Math.max(1, rows.length - (header ? 1 : 0)), cols, header, title: '' });
    const tg = t.getElementsByTagName('tgroup')[0];
    const grid = buildGrid(tg);
    for (const { cell, r, c, cs, rs } of placed) {
      const target = grid.at[r]?.[c];
      if (!target) continue;
      const p = target.entry.firstElementChild ?? target.entry;
      for (const cc of Array.from(cell.childNodes)) inline(cc, p);
      trim(p);
      if (cs > 1 || rs > 1) coverCells(grid, target, cs, rs);
    }
    frag.appendChild(t);
  };

  const block = (n: Node) => {
    if (n.nodeType === 3) {
      if (/\S/.test(n.nodeValue ?? '')) inline(n, para());
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as HTMLElement;
    const tag = e.tagName;
    if (tag === 'UL' || tag === 'OL') {
      closePara();
      list(e, frag);
      return;
    }
    if (tag === 'TABLE') {
      closePara();
      table(e as HTMLTableElement);
      return;
    }
    if (/^H[1-6]$/.test(tag)) {
      closePara();
      const p = para();
      const em = emph(doc, 'em01');
      for (const c of Array.from(e.childNodes)) inline(c, em);
      if (em.childNodes.length) p.appendChild(em);
      closePara();
      return;
    }
    if (tag === 'PRE') {
      closePara();
      const p = para();
      const v = createEl(doc, 'verbatimText');
      v.appendChild(doc.createTextNode(stripInvalidXmlChars(e.textContent ?? '')));
      p.appendChild(v);
      closePara();
      return;
    }
    if (BLOCK_HTML.has(tag)) {
      closePara();
      if (hasBlockDescendant(e)) {
        for (const c of Array.from(e.childNodes)) block(c);
      } else {
        const p = para();
        for (const c of Array.from(e.childNodes)) inline(c, p);
      }
      closePara();
      return;
    }
    if (tag === 'BR') {
      closePara();
      return;
    }
    if (hasBlockDescendant(e)) {
      // an inline wrapper around blocks (Google Docs: <b id="docs-internal-guid-…"><p>…</p></b>): the blocks are what matters
      closePara();
      for (const c of Array.from(e.childNodes)) block(c);
      closePara();
      return;
    }
    inline(e, para());
  };

  for (const c of Array.from(src.body.childNodes)) block(c);
  for (const p of Array.from(frag.childNodes)) if (p.nodeType === 1) trim(p as Element);
  // drop empty paragraphs
  for (const p of Array.from(frag.childNodes)) if (p.nodeType === 1 && p.nodeName === 'para' && !/\S/.test(p.textContent ?? '') && !(p as Element).children.length) frag.removeChild(p);
  return frag;
}

function emph(doc: Document, t: string): Element {
  const e = createEl(doc, 'emphasis');
  e.setAttribute('emphasisType', t);
  return e;
}

function trim(el: Element) {
  const f = el.firstChild;
  if (f && f.nodeType === 3) f.nodeValue = f.nodeValue!.replace(/^\s+/, '');
  const l = el.lastChild;
  if (l && l.nodeType === 3) l.nodeValue = l.nodeValue!.replace(/\s+$/, '');
}

export function textToFragment(text: string, doc: Document, multiline: boolean): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const lines = stripInvalidXmlChars(text).replace(/\r\n?/g, '\n').split('\n');
  if (!multiline || lines.length === 1) {
    frag.appendChild(doc.createTextNode(stripInvalidXmlChars(text).replace(/[\r\n]+/g, ' ')));
    return frag;
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    const p = createEl(doc, 'para');
    p.appendChild(doc.createTextNode(line.trim()));
    frag.appendChild(p);
  }
  return frag;
}

/** Inserts a fragment at the selection, honouring the content model. Returns the new caret. */
export function insertFragment(sel: ModelSelection, frag: DocumentFragment, g: Grammar | null): ModelSelection {
  let pos: ModelPos;
  if (!ops.isCollapsed(sel)) {
    const [a, b] = ops.rangeOrdered(sel);
    pos = ops.deleteRange(a, b, g);
  } else pos = ops.normalizePos(sel.anchor);
  let nodes: Node[] = Array.from(frag.childNodes);
  if (!nodes.length) return ops.caret(pos);
  const container = ops.containerElement(pos);
  // a copy must not share ids with the original (checked after the selection is gone: pasting over a cut element keeps its id)
  if (container.ownerDocument) dedupeFragmentIds(container.ownerDocument, frag, g);
  // A text block that cannot be split in two (a title, a definition's term) takes pasted paragraphs as running text.
  const here = ops.textBlockOf(pos.node, g);
  if (here && nodes.some((n) => n.nodeType === 1 && isBlockLike(n as Element, g)) && here.parentNode?.nodeType === 1 && g && !ops.canInsertAt(g, here.parentNode as Element, elementIndex(here) + 1, here.nodeName)) {
    nodes = flattenToInline(nodes, here, g);
    if (!nodes.length) return ops.caret(pos);
  }
  const inlineOk = ops.allowsText(container, g) && nodes.every((n) => n.nodeType === 3 || n.nodeType === 4 || (n.nodeType === 1 && (!g || !g.has(container.nodeName) || g.childCandidates(container.nodeName).includes(n.nodeName))));
  if (inlineOk) {
    let last: Node | null = null;
    let at = pos;
    for (const n of nodes) {
      ops.insertNodeAt(at, n);
      last = n;
      at = ops.after(n);
    }
    container.normalize();
    if (last && last.isConnected) {
      if (last.nodeType === 3) return ops.caret({ node: last, offset: last.nodeValue!.length });
      return ops.caret(ops.normalizePos(ops.after(last)));
    }
    return ops.caret(ops.normalizePos(at));
  }
  // block insertion
  const doc = container.ownerDocument!;
  const block = ops.textBlockOf(pos.node, g);
  let parent: Element;
  let ref: Node | null;
  if (block) {
    parent = block.parentNode as Element;
    const atStart = isAtStart(pos, block);
    const atEnd = isAtEnd(pos, block);
    if (atStart && !atEnd) ref = block;
    else if (atEnd) ref = block.nextSibling;
    else {
      const right = ops.splitAt(pos, block, g);
      ref = right;
    }
    if (ops.isEmptyEl(block) && !(block.nodeName === 'title')) {
      ref = block.nextSibling;
      if (parent.childNodes.length > 1) parent.removeChild(block);
    }
  } else {
    parent = container;
    ref = pos.node === container ? container.childNodes[pos.offset] ?? null : null;
  }
  let lastInserted: Node | null = null;
  // group stray inline nodes into paragraphs
  const blocks: Node[] = [];
  let pending: Element | null = null;
  for (const n of nodes) {
    const isInline = n.nodeType === 3 || (n.nodeType === 1 && !isBlockLike(n as Element, g));
    if (isInline) {
      if (!pending) {
        pending = createEl(doc, 'para');
        blocks.push(pending);
      }
      pending.appendChild(n);
    } else {
      pending = null;
      blocks.push(n);
    }
  }
  for (const b of blocks) {
    const el = b as Element;
    const idx = ref && ref.parentNode === parent ? elementChildren(parent).indexOf(ref as Element) : elementChildren(parent).length;
    const index = idx < 0 ? elementChildren(parent).length : idx;
    if (ops.canInsertAt(g, parent, index, el.nodeName)) {
      parent.insertBefore(el, ref && ref.parentNode === parent ? ref : null);
      lastInserted = el;
      continue;
    }
    // S1000D puts lists (and similar) inside paragraphs: wrap when a para is allowed here and may contain it
    if (ops.canInsertAt(g, parent, index, 'para') && (!g || !g.has('para') || g.childCandidates('para').includes(el.nodeName))) {
      const p = createEl(doc, 'para');
      p.appendChild(el);
      parent.insertBefore(p, ref && ref.parentNode === parent ? ref : null);
      lastInserted = p;
      continue;
    }
    // convert to a paragraph-like block accepted here
    const alt = ['para', 'notePara', 'warningAndCautionPara', 'simplePara'].find((n) => ops.canInsertAt(g, parent, index, n));
    if (alt && el.textContent?.trim()) {
      const p = createEl(doc, alt);
      p.appendChild(doc.createTextNode(el.textContent.replace(/\s+/g, ' ').trim()));
      parent.insertBefore(p, ref && ref.parentNode === parent ? ref : null);
      lastInserted = p;
      continue;
    }
    const ip = ops.findInsertionPoint(lastInserted ?? block ?? container, el.nodeName, g, 'after');
    if (ip) {
      ip.parent.insertBefore(el, ip.ref);
      lastInserted = el;
    }
  }
  if (!lastInserted) throw new ops.OpError('The clipboard content is not allowed here');
  const end = lastInserted.nodeType === 1 ? ops.endOf(lastInserted as Element, g) : ops.after(lastInserted);
  return ops.caret(end);
}

/** The inline content of pasted blocks, in reading order and separated by spaces; what `target` does not accept becomes plain text. */
function flattenToInline(nodes: Node[], target: Element, g: Grammar | null): Node[] {
  const doc = target.ownerDocument!;
  const out: Node[] = [];
  const accepts = (e: Element) => !g || !g.has(target.nodeName) || g.childCandidates(target.nodeName).includes(e.nodeName);
  const walk = (n: Node) => {
    if (n.nodeType === 3 || n.nodeType === 4) {
      out.push(n);
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (isBlockLike(e, g)) {
      if (out.length) out.push(doc.createTextNode(' '));
      for (const c of Array.from(e.childNodes)) walk(c);
    } else if (accepts(e)) out.push(e);
    else {
      const t = (e.textContent ?? '').trim();
      if (t) out.push(doc.createTextNode(t));
    }
  };
  nodes.forEach(walk);
  return out;
}

function isBlockLike(el: Element, g: Grammar | null): boolean {
  return ['para', 'randomList', 'sequentialList', 'table', 'figure', 'note', 'warning', 'caution', 'levelledPara', 'proceduralStep', 'definitionList'].includes(el.nodeName) || (!!g && g.has(el.nodeName) && !g.allowsText(el.nodeName) && !['internalRef', 'dmRef'].includes(el.nodeName));
}

function isAtStart(pos: ModelPos, block: Element): boolean {
  const r = block.ownerDocument!.createRange();
  r.setStart(block, 0);
  r.setEnd(pos.node, pos.offset);
  return r.toString().length === 0 && !r.cloneContents().querySelector?.('*');
}

function isAtEnd(pos: ModelPos, block: Element): boolean {
  const r = block.ownerDocument!.createRange();
  r.setStart(pos.node, pos.offset);
  r.setEnd(block, block.childNodes.length);
  return r.toString().length === 0;
}
