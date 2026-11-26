// A section's document code (DMC) is shown beside its heading only when the author switches it on, only for the sections that are data modules,
// and it is never part of the document: the XML is the same with the code shown and without it.
import { afterEach, describe, expect, it } from 'vitest';
import { JssEditor, type EditorHost } from './editor';
import { parseJss, serializeJss } from './xml';

const DOC = `<?xml version="1.0" encoding="UTF-8"?>
<jssbook docType="uhb" schemaVersion="1.0">
  <bookmeta><bookName>User Handbook</bookName></bookmeta>
  <body>
    <chapter number="1" id="c1"><title>Leading Particulars and General Data</title>
      <section id="s1"><title>Purpose</title><para>First</para>
        <section id="s11"><title>Sub</title><para>Inner</para></section>
      </section>
      <section id="s2"><title>Features</title><para>Second</para></section>
    </chapter>
  </body>
</jssbook>
`;

const mounted: JssEditor[] = [];
afterEach(() => { for (const e of mounted.splice(0)) e.destroy(); document.body.innerHTML = ''; });
function mount(sectionBadge?: (s: { id?: string; title: string }, chapter: number) => string | null) {
  const root = document.createElement('div'); document.body.append(root);
  const host: EditorHost = {
    graphics: async () => [], uploadGraphic: async () => ({ src: 'Media/a.png', name: 'a.png', url: '/m/a.png' }), imageUrl: (s) => `/m/${s}`,
    onDirty: () => undefined, onSaveRequested: () => undefined, onCheckRequested: () => undefined, notify: () => undefined,
  };
  const ed = new JssEditor(root, { doc: parseJss(DOC), maxDepth: 6, readOnly: false, host, sectionBadge }); mounted.push(ed);
  return { ed, root };
}
const codes = (root: HTMLElement): Array<string | null> => [...root.querySelectorAll<HTMLElement>('.jss-sec-code')].map((e) => (e.style.display === 'none' ? null : e.textContent));

describe('the section code beside a heading', () => {
  const DMC: Record<string, string> = { s1: 'DMC-X-A-01-10-00-00A-040A-D', s2: 'DMC-X-A-01-20-00-00A-040A-D' };
  const badge = (s: { id?: string }, chapter: number): string | null => (chapter && s.id ? DMC[s.id] ?? null : null);

  it('is not drawn at all unless asked for, and the document is the same either way', () => {
    const off = mount(); expect(codes(off.root).every((c) => c === null)).toBe(true);
    const on = mount(badge);
    expect(serializeJss(on.ed.getDoc())).toBe(serializeJss(off.ed.getDoc()));
    expect(on.ed.getXml()).not.toMatch(/DMC-/);
  });

  it('shows the code of each top-level section and nothing for a sub-section', () => {
    const { root } = mount(badge);
    expect(codes(root)).toEqual(['DMC-X-A-01-10-00-00A-040A-D', null, 'DMC-X-A-01-20-00-00A-040A-D']);
    expect(root.querySelector('.jss-sec-code')?.getAttribute('contenteditable')).toBe('false');
  });

  it('can be switched on and off while the editor is open, without touching the document', () => {
    const { ed, root } = mount(); const before = ed.getXml();
    ed.setSectionBadge(badge); expect(codes(root).filter(Boolean)).toHaveLength(2);
    ed.setSectionBadge(undefined); expect(codes(root).every((c) => c === null)).toBe(true);
    expect(ed.getXml()).toBe(before); expect(ed.isDirty()).toBe(false);
  });
});
