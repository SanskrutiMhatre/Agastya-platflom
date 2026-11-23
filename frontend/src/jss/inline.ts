// Inline text between the model and a contenteditable element.
//
// renderInline draws the model's runs; readInline reads whatever the browser has made of them back into runs. Browsers add their own markup while someone types
// (<strong>, <em>, styled <span>s, a trailing <br> placeholder, non-breaking spaces), so reading is tolerant of those and produces only what the schema has:
// text, b, i, u, sup, sub, br and xref.

import type { Inline, Mark } from './model';

export const XREF_CLASS = 'jss-xref';

export function renderInline(parent: HTMLElement, runs: Inline[], labels: Map<string, string>): void {
  const doc = parent.ownerDocument;
  const put = (into: Node, rs: Inline[]) => {
    for (const r of rs) {
      if (r.t === 'text') { if (r.text) into.appendChild(doc.createTextNode(r.text)); }
      else if (r.t === 'br') into.appendChild(doc.createElement('br'));
      else if (r.t === 'mark') { const el = doc.createElement(r.mark); put(el, r.children); into.appendChild(el); }
      else {
        const el = doc.createElement('span'); el.className = XREF_CLASS; el.setAttribute('contenteditable', 'false');
        if (r.to !== undefined) {
          el.setAttribute('data-to', r.to);
          const label = labels.get(r.to); el.textContent = label ?? `⚠ ${r.to}`; if (label === undefined) { el.classList.add('missing'); el.title = 'This reference points at something that is not in the document'; }
        } else { el.setAttribute('data-href', r.href ?? ''); put(el, r.children); el.title = r.href ?? ''; }
        into.appendChild(el);
      }
    }
  };
  parent.textContent = '';
  put(parent, runs);
}

const styleMarks = (el: HTMLElement): Mark[] => {
  const out: Mark[] = []; const s = el.style;
  if (s.fontWeight === 'bold' || Number(s.fontWeight) >= 600) out.push('b');
  if (s.fontStyle === 'italic') out.push('i');
  if ((s.textDecorationLine || s.textDecoration || '').includes('underline')) out.push('u');
  if (s.verticalAlign === 'super') out.push('sup'); else if (s.verticalAlign === 'sub') out.push('sub');
  return out;
};

function readNodes(nodes: NodeListOf<ChildNode> | ChildNode[]): Inline[] {
  const out: Inline[] = [];
  const push = (r: Inline) => { const last = out[out.length - 1]; if (r.t === 'text' && last && last.t === 'text') last.text += r.text; else out.push(r); };
  for (const n of Array.from(nodes)) {
    if (n.nodeType === 3) { const t = (n.nodeValue ?? '').replace(/[ ​﻿]/g, (c) => (c === ' ' ? ' ' : '')).replace(/[\r\n]+/g, ' '); if (t) push({ t: 'text', text: t }); continue; }
    if (n.nodeType !== 1) continue;
    const el = n as HTMLElement; const name = el.localName;
    if (name === 'br') { push({ t: 'br' }); continue; }
    if (el.classList.contains(XREF_CLASS)) {
      if (el.hasAttribute('data-to')) push({ t: 'xref', to: el.getAttribute('data-to') ?? '', children: [] });
      else push({ t: 'xref', href: el.getAttribute('data-href') ?? '', children: readNodes(el.childNodes) });
      continue;
    }
    let marks: Mark[] = [];
    if (name === 'b' || name === 'strong') marks = ['b']; else if (name === 'i' || name === 'em') marks = ['i']; else if (name === 'u') marks = ['u'];
    else if (name === 'sup') marks = ['sup']; else if (name === 'sub') marks = ['sub'];
    else marks = styleMarks(el);
    let inner = readNodes(el.childNodes);
    for (const m of marks.reverse()) inner = inner.length ? [{ t: 'mark', mark: m, children: inner }] : inner;
    for (const r of inner) push(r);
  }
  return out;
}

/** Read an editable element back into runs. A trailing line break is the browser's placeholder, not content, and is dropped. */
export function readInline(root: Node): Inline[] {
  const runs = readNodes(root.childNodes);
  while (runs.length && runs[runs.length - 1].t === 'br') runs.pop();
  return mergeMarks(runs);
}

/** <b>a</b><b>b</b> is <b>ab</b>: adjacent runs of the same mark are joined, empty ones dropped. */
export function mergeMarks(runs: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const r of runs) {
    if (r.t === 'mark') {
      const children = mergeMarks(r.children); if (!children.length) continue;
      const last = out[out.length - 1];
      if (last && last.t === 'mark' && last.mark === r.mark) last.children = mergeMarks([...last.children, ...children]);
      else out.push({ ...r, children });
    } else if (r.t === 'text') {
      if (!r.text) continue;
      const last = out[out.length - 1]; if (last && last.t === 'text') last.text += r.text; else out.push({ ...r });
    } else out.push(r.t === 'xref' ? { ...r, children: mergeMarks(r.children) } : r);
  }
  return out;
}

/** Plain text of a run list, for titles and labels. */
export const plain = (runs: Inline[]): string => runs.map((r) => (r.t === 'text' ? r.text : r.t === 'br' ? ' ' : r.t === 'xref' && r.to ? '' : plain(r.children))).join('');
