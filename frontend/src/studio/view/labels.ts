/**
 * Generated numbering for the WYSIWYG view and cross-reference labels:
 * levelled paragraphs (1, 1.1, ...), procedural steps, figures, tables.
 */
import { elementChildren, textOf } from '../core/xml';

export interface LabelIndex {
  numbers: Map<Element, string>;
  byId: Map<string, Element>;
  label(el: Element): string;
}

const NUMBERED = new Set(['levelledPara', 'proceduralStep', 'crewDrillStep', 'isolationStep']);

export function buildLabels(doc: Document, offsets?: { fig: number; tab: number; mm: number }): LabelIndex & { offsets: { fig: number; tab: number; mm: number } } {
  const numbers = new Map<Element, string>();
  const byId = new Map<string, Element>();
  const root = doc.documentElement;
  if (!root) return { numbers, byId, label: () => '', offsets: offsets ?? { fig: 0, tab: 0, mm: 0 } };
  let fig = offsets?.fig ?? 0;
  let tab = offsets?.tab ?? 0;
  let mm = offsets?.mm ?? 0;
  const walk = (el: Element, prefix: string) => {
    let n = 0;
    for (const c of elementChildren(el)) {
      const id = c.getAttribute('id');
      if (id) byId.set(id, c);
      const name = c.nodeName;
      if (NUMBERED.has(name)) {
        n++;
        const num = prefix ? `${prefix}.${n}` : String(n);
        numbers.set(c, num);
        walk(c, num);
        continue;
      }
      if (name === 'figure') numbers.set(c, String(++fig));
      else if (name === 'table') numbers.set(c, String(++tab));
      else if (name === 'multimedia') numbers.set(c, String(++mm));
      // containers that restart step numbering
      const restart = name === 'mainProcedure' || name === 'isolationMainProcedure' || name === 'crewDrill';
      walk(c, restart ? '' : prefix);
    }
  };
  // number steps per mainProcedure, paras per description
  walk(root, '');
  // graphics (sheets) within figures
  for (const f of Array.from(doc.getElementsByTagName('figure'))) {
    const gs = elementChildren(f).filter((g) => g.nodeName === 'graphic');
    if (gs.length > 1) gs.forEach((g, i) => numbers.set(g, `${numbers.get(f)}/${i + 1}`));
  }
  const label = (el: Element): string => {
    const num = numbers.get(el);
    switch (el.nodeName) {
      case 'figure': return `Fig ${num ?? '?'}`;
      case 'table': return num ? `Table ${num}` : 'Table';
      case 'multimedia': return `Multimedia ${num ?? '?'}`;
      case 'levelledPara': return `Para ${num ?? '?'}`;
      case 'proceduralStep':
      case 'crewDrillStep':
      case 'isolationStep': return `Step ${num ?? '?'}`;
      case 'graphic': return num ? `Fig ${num}` : 'Graphic';
      case 'supportEquipDescr':
      case 'supplyDescr':
      case 'spareDescr': return textOf(el.getElementsByTagName('name')[0]) || el.nodeName;
      default: {
        const t = elementChildren(el).find((k) => k.nodeName === 'title');
        return t ? textOf(t) : el.getAttribute('id') ?? el.nodeName;
      }
    }
  };
  return { numbers, byId, label, offsets: { fig, tab, mm } };
}

/** Text for an internalRef chip. */
export function internalRefLabel(ref: Element, idx: LabelIndex): string {
  const id = ref.getAttribute('internalRefId') ?? '';
  const target = id ? idx.byId.get(id) : undefined;
  const own = textOf(ref);
  if (own) return own;
  if (!target) return id ? `⚠ ${id}` : '⚠ (no target)';
  return idx.label(target);
}
