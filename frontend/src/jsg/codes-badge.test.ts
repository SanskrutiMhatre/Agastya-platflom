// A section's (or appendix's) document code is shown beside its heading only when the author switches it on; it is never part of the document and Find does not search it.
import { afterEach, describe, expect, it } from 'vitest';
import { JsgEditor, type JsgHost } from './editor';
import { parseJsg, serializeJsg } from './xml';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<jsgdoc version="1.0" type="uhb">
  <meta><title>USER HANDBOOK</title></meta>
  <front/>
  <chapter title="General"><section id="s1" title="Introduction"><para>Hello</para></section><section title="Scope"><para>World</para></section></chapter>
  <appendices><appendix id="a1" label="A1" title="Abbreviations"><para>List</para></appendix></appendices>
</jsgdoc>`;

const mounted: JsgEditor[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.destroy(); document.body.textContent = ''; });
function mount(sectionBadge?: (s: { id?: string; title: string }, chapter: number) => string | null) {
  const root = document.createElement('div'); document.body.appendChild(root);
  const host: JsgHost = { graphics: async () => [], uploadGraphic: async () => ({ src: 'Media/x.png', name: 'x.png', url: '/x.png' }), imageUrl: (s) => s, onDirty: () => undefined, onSaveRequested: () => undefined, onCheckRequested: () => undefined, notify: () => undefined };
  const ed = new JsgEditor(root, { doc: parseJsg(XML), readOnly: false, host, sectionBadge }); mounted.push(ed);
  return { ed, root };
}
const codes = (root: HTMLElement): string[] => [...root.querySelectorAll('.jsg-code')].map((e) => e.textContent ?? '');

describe('the code beside a section heading', () => {
  const seen: Array<[string | undefined, string, number]> = [];
  const badge = (s: { id?: string; title: string }, chapter: number): string | null => { seen.push([s.id, s.title, chapter]); return s.id ? `DMC-${s.id.toUpperCase()}` : `DMC-T${chapter}`; };

  it('is not drawn unless asked for; sections and appendices get their code, with the numbering the backend uses', () => {
    expect(codes(mount().root)).toEqual([]);
    seen.length = 0; const { root } = mount(badge);
    expect(codes(root)).toEqual(['DMC-S1', 'DMC-T1', 'DMC-A1']);
    expect(seen).toEqual([['s1', 'Introduction', 1], [undefined, 'Scope', 1], ['a1', 'A1 Abbreviations', 2]]);            // an appendix counts on after the chapters, its title led by its label
    expect(root.querySelector('.jsg-code')?.getAttribute('contenteditable')).toBe('false');
  });

  it('can be switched on and off while the editor is open; the document is the same, and Find does not search the code', () => {
    const { ed, root } = mount(); const before = ed.getXml();
    ed.setSectionBadge(badge); expect(codes(root)).toHaveLength(3);
    expect(ed.getXml()).toBe(before); expect(serializeJsg(parseJsg(ed.getXml()))).toBe(before); expect(ed.isDirty()).toBe(false);
    const find = root.querySelector<HTMLInputElement>('.jsg-find input'); expect(find).toBeTruthy();
    ed.setSectionBadge(undefined); expect(codes(root)).toEqual([]);
  });
});
