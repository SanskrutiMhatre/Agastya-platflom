// Edit the words of an ancillary page without touching its tags.
//
// A page is a small XML file (<foreword>, <demolition> ...). An author wants to change what it says, not to write XML, so the page is shown as a list of
// text fields, one per piece of text, in reading order. Saving puts each field's value back into the same place in the same tree: the elements, attributes
// and comments are never rewritten, so the page cannot be broken from here. (Whoever needs to change the structure uses the XML view.)

export interface TextField {
  /** Position in reading order: the key of the field. */
  index: number;
  /** What the text is: "Paragraph", "Item 3", or the term it defines ("E-mail Address"). */
  label: string;
  /** The element that holds it, for the author who wants to know ("para", "defitem > def"). */
  where: string;
  value: string;
  /** Long text gets a larger box. */
  multiline: boolean;
}

export interface ParsedPage {
  fields: TextField[];
  /** The page's XML with each field set to the value given for its index (a field not mentioned keeps its text). */
  withValues(values: Record<number, string>): string;
}

const FRIENDLY: Record<string, string> = { para: 'Paragraph', term: 'Label', def: 'Text', line: 'Line', item: 'Item', title: 'Heading', cell: 'Cell', row: 'Row', note: 'Note', warning: 'Warning', caution: 'Caution', heading: 'Heading', label: 'Label', text: 'Text' };
const nice = (name: string): string => FRIENDLY[name] ?? (name.charAt(0).toUpperCase() + name.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase());

const elementParent = (n: Node): Element | null => (n.parentNode && n.parentNode.nodeType === 1 ? (n.parentNode as Element) : null);

/** null when the text is not well-formed XML. */
export function parsePage(xml: string): ParsedPage | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) return null;

  const nodes: Text[] = [];
  const walk = (n: Node): void => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 && (c.nodeValue ?? '').trim()) nodes.push(c as Text);
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(doc.documentElement);

  const seen = new Map<string, number>();
  const fields: TextField[] = nodes.map((t, index) => {
    const el = elementParent(t); const name = el?.localName ?? 'text';
    let label = nice(name);
    // a definition or a line of one is named by the term it belongs to
    const defitem = el?.closest('defitem'); const term = defitem?.querySelector('term')?.textContent?.trim();
    if (term && name !== 'term') label = term;
    else if (name === 'item' || name === 'para') { const k = (seen.get(name) ?? 0) + 1; seen.set(name, k); label = `${label} ${k}`; }
    const where = el ? [el.parentNode && el.parentNode.nodeType === 1 && el.parentNode !== doc.documentElement ? (el.parentNode as Element).localName : '', name].filter(Boolean).join(' > ') : '';
    const value = (t.nodeValue ?? '').replace(/\s+/g, ' ').trim();
    return { index, label, where, value, multiline: value.length > 70 };
  });

  return {
    fields,
    withValues(values) {
      const copy = new DOMParser().parseFromString(xml, 'application/xml');
      const targets: Text[] = []; const collect = (n: Node): void => { for (let c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3 && (c.nodeValue ?? '').trim()) targets.push(c as Text); else if (c.nodeType === 1) collect(c); } };
      collect(copy.documentElement);
      targets.forEach((t, i) => {
        if (values[i] === undefined || values[i] === fields[i].value) return;                 // untouched text keeps its own line breaks and spacing
        const raw = t.nodeValue ?? ''; const lead = /^\s*/.exec(raw)?.[0] ?? ''; const trail = /\s*$/.exec(raw)?.[0] ?? '';
        t.nodeValue = lead + values[i].replace(/\s+/g, ' ').trim() + trail;
      });
      const body = new XMLSerializer().serializeToString(copy);
      return /^\s*<\?xml/.test(body) ? body : `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
    },
  };
}
