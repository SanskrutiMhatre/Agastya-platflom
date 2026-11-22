// A tiny element-tree reader that KEEPS SOURCE OFFSETS, so a tool can edit a document's text in place (add an attribute to one element)
// without re-serialising - and therefore without touching the DOCTYPE, entities, comments, quoting or formatting of customer XML.
// It is for structure the application already validated; it is not a validator and refuses input it cannot walk.

export interface MNode {
  name: string; attrs: Record<string, string>; text: string; children: MNode[]; parent: MNode | null;
  /** offset of "<" of the start tag, offset of ">" that ends it, and whether it is self-closing */
  start: number; tagEnd: number; selfClosing: boolean; end: number;
  /** 1-based line of the start tag */
  line: number;
  /** /root[1]/a[2]/b[1] - the position of this element among same-named siblings */
  path: string;
}

const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function parseTree(xml: string): MNode {
  let i = 0; const n = xml.length; let root: MNode | null = null; let cur: MNode | null = null; let line = 1; let lastLineAt = 0;
  const lineAt = (pos: number) => { for (let k = lastLineAt; k < pos; k++) if (xml.charCodeAt(k) === 10) line++; lastLineAt = pos; return line; };
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (cur && lt > i) cur.text += xml.slice(i, lt);
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); if (e < 0) throw new Error('unterminated comment'); i = e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt); if (e < 0) throw new Error('unterminated CDATA'); if (cur) cur.text += xml.slice(lt + 9, e); i = e + 3; continue; }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt); if (e < 0) throw new Error('unterminated PI'); i = e + 2; continue; }
    if (xml.startsWith('<!DOCTYPE', lt)) {
      let depth = 0; let j = lt + 9; for (; j < n; j++) { const c = xml[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
      i = j + 1; continue;
    }
    // find the end of the tag, honouring quotes
    let j = lt + 1; let q = ''; for (; j < n; j++) { const c = xml[j]; if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; }
    if (j >= n) throw new Error('unterminated tag');
    const inner = xml.slice(lt + 1, j);
    if (inner.startsWith('/')) { if (!cur) throw new Error('unbalanced end tag'); cur.end = j + 1; cur = cur.parent; i = j + 1; continue; }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nm = /^[^\s/>]+/.exec(body)?.[0]; if (!nm) throw new Error('bad tag');
    const attrs: Record<string, string> = {}; ATTR.lastIndex = 0; let m: RegExpExecArray | null; const rest = body.slice(nm.length);
    while ((m = ATTR.exec(rest))) attrs[m[1]] = m[3] ?? m[4] ?? '';
    const node: MNode = { name: nm, attrs, text: '', children: [], parent: cur, start: lt, tagEnd: j, selfClosing, end: j + 1, line: lineAt(lt), path: '' };
    const sibs = cur ? cur.children.filter((c) => c.name === nm).length + 1 : 1;
    node.path = `${cur ? cur.path : ''}/${nm}[${sibs}]`;
    if (cur) cur.children.push(node); else if (!root) root = node; else throw new Error('more than one root element');
    if (!selfClosing) cur = node;
    i = j + 1;
  }
  if (cur) throw new Error('unclosed element');
  if (!root) throw new Error('no root element');
  return root;
}

export function* walk(n: MNode): Generator<MNode> { yield n; for (const c of n.children) yield* walk(c); }
export const findAll = (root: MNode, name: string): MNode[] => [...walk(root)].filter((x) => x.name === name);
export const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
export const byPath = (root: MNode, p: string): MNode | undefined => { for (const x of walk(root)) if (x.path === p) return x; return undefined; };

/** Set (or add) attributes on one element's start tag, in place. Returns the new text. Other bytes are untouched. */
export function setAttrs(xml: string, node: MNode, set: Record<string, string>): string {
  let tag = xml.slice(node.start, node.tagEnd + 1);
  for (const [k, v] of Object.entries(set)) {
    const re = new RegExp(`(\\s${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*)("[^"]*"|'[^']*')`);
    const esc = v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    if (re.test(tag)) tag = tag.replace(re, `$1"${esc}"`);
    else tag = tag.replace(/\s*(\/?)>$/, ` ${k}="${esc}"$1>`);
  }
  return xml.slice(0, node.start) + tag + xml.slice(node.tagEnd + 1);
}
