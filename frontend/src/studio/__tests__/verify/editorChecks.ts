// Helpers shared by the editor verification tests (editor.test.ts and editor-controls.test.ts).
import { TYPES, gj, gramJson, vim, ProbeDoc } from './lib';
import { ATOMIC } from '../../core/display';
import { elementChildren, nodeIndex } from '../../core/xml';
import type { DocumentEditor } from '../../ui/editor';
import type { Grammar } from '../../core/grammar';

export function caretIn(ed: DocumentEditor, container: Element, j: number) {
  const kids = elementChildren(container);
  const offset = kids[j] ? nodeIndex(kids[j]) : container.childNodes.length;
  ed.clearElementSelection?.();
  ed.doc.selection = { anchor: { node: container, offset }, focus: { node: container, offset } };
}
export const nsFree = (names: string[]) => names.filter((n) => !n.includes(':'));
export const ancestorsOf = (el: Element): Element[] => { const out: Element[] = []; for (let e: Element | null = el; e; e = e.parentElement) out.push(e); return out; };

/** names that exist in other types' grammars but not in this one */
export function foreignNames(issue: string, type: string): string[] {
  const mine = new Set(Object.keys(gramJson(issue, type).elements));
  const out = new Set<string>();
  for (const t of TYPES) if (t !== type) for (const n of Object.keys(gramJson(issue, t).elements)) if (!n.includes(':') && !mine.has(n)) out.add(n);
  const all = [...out].sort();
  return all.length <= 6 ? all : [0, 1, 2, 3, 4, 5].map((i) => all[Math.floor((i * (all.length - 1)) / 5)]);
}

export interface Findings {
  positions: number;
  /** tags the XSD allows right after the selected element / at the text caret, which the editor does not offer */
  complete: string[];
  /** tags that fit only BEFORE an existing sibling (nothing the editor offers from a caret or selection after it) */
  beforeOnly: string[];
  /** tags offered that can never belong around that caret (judged by the reference dictionary) */
  foreignOffered: string[];
  /** legal (XSD-accepted) insertions after a selected element, to perform for real */
  candidates: Array<{ E: Element; X: string }>;
}

/**
 * Tag suggestions at the carets an author can actually produce: an ELEMENT SELECTED (new tags go after it) and a CARET IN TEXT
 * (start and end of a text-bearing element). The XSD decides what fits (completeness); the reference dictionary decides what can
 * never belong (soundness).
 */
export async function suggestionFindings(ed: DocumentEditor, issue: string, type: string, text: string, cap = 14): Promise<Findings> {
  const g = ed.grammar as Grammar;
  const dict = vim(issue, type)!;
  const pd = new ProbeDoc(text, issue, type);
  const els = Array.from(ed.doc.xml.getElementsByTagName('*'));
  const content = els.find((e) => e.nodeName === 'content')!;
  const firstOf = new Map<string, Element>();
  // an author cannot select something INSIDE an atomic object (dmRef, internalRef, ...): those are edited through their own dialog
  const insideAtomic = (e: Element) => ancestorsOf(e.parentElement!).some((a) => ATOMIC.has(a.nodeName));
  for (const e of els) if (content.contains(e) && e !== content && !insideAtomic(e) && !firstOf.has(e.nodeName) && dict[e.nodeName]) firstOf.set(e.nodeName, e);
  const allNames = nsFree(Object.keys(gj(g).elements));
  const out: Findings = { positions: 0, complete: [], beforeOnly: [], foreignOffered: [], candidates: [] };
  const soundness = (at: string, reach: Set<string>) => {
    for (const X of allNames) if (ed.canInsert(X) && !reach.has(X)) out.foreignOffered.push(`<${X}> offered ${at}`);
    const ins = ed.insertableElements();
    for (const X of [...ins.inline, ...ins.block]) if (!reach.has(X)) out.foreignOffered.push(`<${X}> listed by insertableElements ${at}`);
  };
  for (const E of [...firstOf.values()].slice(0, cap)) {
    const P = E.parentElement!;
    const kidsP = elementChildren(P);
    const i = kidsP.indexOf(E);
    const iP = els.indexOf(P);
    const universeP = nsFree(dict[P.nodeName]?.c ?? []);
    // the editor tries the end of the selected element itself, then every position of its parent and of each ancestor
    const reach = new Set<string>();
    for (const A of [E, ...ancestorsOf(P)]) (dict[A.nodeName]?.c ?? []).forEach((c) => reach.add(c));

    // A. the element is selected: new tags go after it
    ed.selectElement(E);
    out.positions++;
    const after = await Promise.all(universeP.map(async (X) => [X, await pd.acceptsWhole(iP, i + 1, X), await pd.acceptsWhole(iP, i, X)] as const));
    for (const [X, okAfter, okBefore] of after) {
      if (okAfter) {
        if (!ed.canInsert(X)) out.complete.push(`<${X}> after <${E.nodeName}> in <${P.nodeName}>`);
        else out.candidates.push({ E, X });
      } else if (okBefore && !ed.canInsert(X)) out.beforeOnly.push(`<${X}> before <${E.nodeName}> in <${P.nodeName}>`);
    }
    soundness(`with <${E.nodeName}> selected in <${P.nodeName}>`, reach);
    ed.clearElementSelection?.();

    // B. a caret in the text of the element (its start and its end)
    if (g.allowsText(E.nodeName)) {
      const idx = els.indexOf(E);
      const universeE = nsFree(dict[E.nodeName]?.c ?? []);
      const names = elementChildren(E);
      for (const j of new Set([0, names.length])) {
        out.positions++;
        caretIn(ed, E, j);
        const ok = (await Promise.all(universeE.map(async (X) => ((await pd.acceptsWhole(idx, j, X)) ? X : null)))).filter((x): x is string => !!x);
        for (const X of ok) if (!ed.canInsert(X)) out.complete.push(`<${X}> in the text of <${E.nodeName}> at ${j}`);
        const reachE = new Set<string>();
        for (const A of ancestorsOf(E)) (dict[A.nodeName]?.c ?? []).forEach((c) => reachE.add(c));
        soundness(`in the text of <${E.nodeName}> at ${j}`, reachE);
      }
    }
  }
  return out;
}

