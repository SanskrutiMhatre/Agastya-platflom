// The JSG User Handbook editor driven the way a person drives it: the tabbed toolbar, paragraph indent and alignment, table alignment and equal columns, and page orientation.
import { afterEach, describe, expect, it } from 'vitest';
import { JsgEditor, type JsgHost } from './editor';
import { parseJsg } from './xml';
import type { Clause, Para, Section, Table } from './model';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<jsgdoc version="1.0" type="uhb">
  <meta><title>USER HANDBOOK</title></meta>
  <front/>
  <chapter title="General"><section title="Introduction">
    <clause title="General"><para>Hello</para>
      <table title="Specs"><head><row><cell><text>A</text></cell><cell><text>B</text></cell></row></head><body><row><cell><text>1</text></cell><cell><text>2</text></cell></row></body></table>
    </clause>
  </section></chapter>
  <appendices/>
</jsgdoc>`;

const mounted: JsgEditor[] = [];
function mount(readOnly = false) {
  const root = document.createElement('div'); document.body.appendChild(root);
  const notes: string[] = [];
  const host: JsgHost = { graphics: async () => [], uploadGraphic: async () => ({ src: 'Media/x.png', name: 'x.png', url: '/x.png' }), imageUrl: (s) => s, onDirty: () => undefined, onSaveRequested: () => undefined, onCheckRequested: () => undefined, notify: (m) => notes.push(m) };
  const ed = new JsgEditor(root, { doc: parseJsg(XML), readOnly, host }); mounted.push(ed);
  return { ed, root, notes };
}
afterEach(() => { while (mounted.length) mounted.pop()!.destroy(); document.body.textContent = ''; });

const cmd = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`[data-cmd="${id}"]`)!;
const select = (el: Element) => el.dispatchEvent(new Event('focusin', { bubbles: true }));
const menuItem = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.jsg-menu button')).find((b) => b.textContent?.startsWith(label))!;

describe('the toolbar', () => {
  it('is in tabs, one panel open at a time, and every button is in the page', () => {
    const { root } = mount();
    expect(Array.from(root.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual(['Write', 'Insert', 'Table', 'Arrange', 'Document']);
    expect(Array.from(root.querySelectorAll('[role="tabpanel"]')).filter((p) => !p.hasAttribute('hidden'))).toHaveLength(1);
    for (const id of ['bold', 'align', 'indent', 'para', 'heading', 'list', 'table', 'figure', 'notice', 'pagebreak', 'row+', 'talign', 'equal', 'up', 'orient', 'delete', 'check']) expect(cmd(root, id), id).toBeTruthy();
    expect(root.querySelectorAll('.jsg-tlabel').length).toBeGreaterThan(8);                   // the groups are named
  });

  it('a read-only view offers only what does not edit the document', () => {
    const { root } = mount(true);
    expect(Array.from(root.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual(['Document']);
    expect(cmd(root, 'check')).toBeTruthy(); expect(cmd(root, 'para')).toBeNull();
  });
});

describe('writing and arranging', () => {
  it('Indent and Outdent move a paragraph through the stencil\'s levels and say when they cannot', () => {
    const { ed, root, notes } = mount(); const p = () => ((ed.getDoc().chapters[0].sections[0].children[0] as Clause).children[0] as Para);
    select(root.querySelector('.jsg-p')!); cmd(root, 'indent').click(); expect(p().indent).toBe(3);
    select(root.querySelector('.jsg-p')!); cmd(root, 'outdent').click(); cmd(root, 'outdent').click(); expect(p().indent).toBe(2); expect(notes.pop()).toMatch(/first level/);
    expect(ed.getXml()).not.toMatch(/<para indent=/);
  });

  it('Align sets the selected paragraph\'s alignment', () => {
    const { ed, root } = mount(); select(root.querySelector('.jsg-p')!);
    cmd(root, 'align').click(); menuItem('Centre').click();
    expect(((ed.getDoc().chapters[0].sections[0].children[0] as Clause).children[0] as Para).align).toBe('center'); expect(ed.getXml()).toContain('align="center"');
  });

  it('Orientation puts a heading on its own landscape page, or a whole section, and marks it on the sheet', () => {
    const { ed, root } = mount();
    select(root.querySelector('.jsg-clause')!); cmd(root, 'orient').click(); menuItem('This heading on its own page: Landscape').click();
    const clause = ed.getDoc().chapters[0].sections[0].children[0] as Clause; expect(clause.orientation).toBe('landscape'); expect(ed.getXml()).toMatch(/<clause[^>]*orientation="landscape"/);
    expect(root.querySelector('.jsg-orient')?.textContent).toMatch(/own landscape page/);
    select(root.querySelector('.jsg-clause')!); cmd(root, 'orient').click(); menuItem('This heading on its own page: Portrait').click(); expect(clause.orientation).toBeUndefined();
    select(root.querySelector('.jsg-clause')!); cmd(root, 'orient').click(); menuItem('All of this section: A3 landscape').click();
    expect((ed.getDoc().chapters[0].sections[0] as Section).orientation).toBe('a3-landscape'); expect(root.querySelector('.jsg-orient')?.textContent).toMatch(/A3 landscape/);
  });
});

describe('tables', () => {
  const inCell = (root: HTMLElement) => (root.querySelector('td [contenteditable]') as HTMLElement).focus();
  const table = (ed: JsgEditor) => ((ed.getDoc().chapters[0].sections[0].children[0] as Clause).children[1] as Table);

  it('Align sets a cell, a column or the whole table, and Default clears it', () => {
    const { ed, root } = mount(); inCell(root);
    cmd(root, 'talign').click(); menuItem('This column: Right').click();
    expect([...table(ed).head, ...table(ed).body].map((r) => r.cells[0].align)).toEqual(['right', 'right']); expect(table(ed).body[0].cells[1].align).toBeUndefined();
    inCell(root); cmd(root, 'talign').click(); menuItem('Whole table: Centre').click();
    expect([...table(ed).head, ...table(ed).body].flatMap((r) => r.cells.map((c) => c.align))).toEqual(['center', 'center', 'center', 'center']);
    inCell(root); cmd(root, 'talign').click(); menuItem('Whole table: Default').click(); expect(table(ed).head[0].cells[0].align).toBeUndefined();
  });

  it('Equal columns gives every column the same share of the full width', () => {
    const { ed, root } = mount(); inCell(root); cmd(root, 'equal').click();
    expect(table(ed).widths).toBe('1 1'); expect(ed.getXml()).toContain('widths="1 1"');
  });

  it('says what to do when the caret is not in a table', () => {
    const { root, notes } = mount(); (document.activeElement as HTMLElement | null)?.blur(); cmd(root, 'equal').click(); expect(notes.pop()).toMatch(/Click in a table cell/);
  });
});

describe('history, find and replace, paste and the status bar', () => {
  const firstPara = (ed: JsgEditor) => ((ed.getDoc().chapters[0].sections[0].children[0] as Clause).children[0] as Para);
  const typeInto = (el: HTMLElement, t: string) => { el.textContent = t; el.dispatchEvent(new Event('input', { bubbles: true })); };

  it('Undo and Redo take back and bring back typing and structure, and say when there is nothing to do', () => {
    const { ed, root, notes } = mount();
    expect(cmd(root, 'undo').disabled).toBe(true);
    typeInto(root.querySelector('.jsg-p')!, 'Edited text'); expect(ed.canUndo()).toBe(true); expect(cmd(root, 'undo').disabled).toBe(false);
    expect(plainText(firstPara(ed))).toBe('Edited text');
    cmd(root, 'undo').click(); expect(plainText(firstPara(ed))).toBe('Hello'); expect(root.querySelector('.jsg-p')!.textContent).toBe('Hello');
    expect(ed.canRedo()).toBe(true); cmd(root, 'redo').click(); expect(plainText(firstPara(ed))).toBe('Edited text');
    select(root.querySelector('.jsg-p')!); cmd(root, 'indent').click(); expect(firstPara(ed).indent).toBe(3);
    cmd(root, 'undo').click(); expect(firstPara(ed).indent).toBe(2);
    cmd(root, 'undo').click(); expect(cmd(root, 'undo').disabled).toBe(true); ed.undo(); expect(notes.pop()).toMatch(/Nothing to undo/);
  });

  it('Find counts and highlights every match, Replace all changes them all, and Undo brings them back', () => {
    const { ed, root } = mount();
    ed.openFind(true);
    const [find, replace] = Array.from(root.querySelectorAll<HTMLInputElement>('.jsg-find input[type="text"]'));
    find.value = 'a'; find.dispatchEvent(new Event('input', { bubbles: true }));
    const count = root.querySelector('.jsg-find .cnt')!.textContent; expect(count).toMatch(/^1 of \d+$/);
    find.value = 'Hello'; find.dispatchEvent(new Event('input', { bubbles: true })); expect(root.querySelector('.jsg-find .cnt')!.textContent).toBe('1 of 1');
    find.value = 'zzz'; find.dispatchEvent(new Event('input', { bubbles: true })); expect(root.querySelector('.jsg-find .cnt')!.textContent).toBe('No matches');
    find.value = 'Hello'; find.dispatchEvent(new Event('input', { bubbles: true })); replace.value = 'Goodbye';
    Array.from(root.querySelectorAll<HTMLButtonElement>('.jsg-find button')).find((b) => b.textContent === 'Replace all')!.click();
    expect(plainText(firstPara(ed))).toBe('Goodbye'); expect(ed.getXml()).toContain('Goodbye');
    cmd(root, 'undo').click(); expect(plainText(firstPara(ed))).toBe('Hello');
    ed.closeFind(); expect(root.querySelector('.jsg-find')!.classList.contains('open')).toBe(false);
  });

  it('a read-only view can find but not replace', () => {
    const { ed, root } = mount(true); ed.openFind(true);
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>('.jsg-find button')).filter((b) => /^Replace/.test(b.textContent ?? '')).every((b) => b.style.display === 'none')).toBe(true);
  });

  it('pasting a table from Word makes a table, with its header row', () => {
    const { ed, root } = mount(); const p = root.querySelector('.jsg-p') as HTMLElement; select(p);
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
    Object.defineProperty(ev, 'clipboardData', { value: { getData: (t: string) => (t === 'text/html' ? '<table><tr><th>Item</th><th>Qty</th></tr><tr><td>Bolt</td><td>4</td></tr></table>' : 'Item\tQty\nBolt\t4') } });
    p.dispatchEvent(ev);
    const tables = (ed.getDoc().chapters[0].sections[0].children[0] as Clause).children.filter((c) => c.k === 'table') as Table[];
    expect(tables).toHaveLength(2); const t = tables[1]; expect(t.head[0].cells).toHaveLength(2); expect(t.body[0].cells[0].parts[0]).toMatchObject({ k: 'text' });
  });

  it('Header row switches the first row between header and body', () => {
    const { ed, root } = mount(); const t = ((ed.getDoc().chapters[0].sections[0].children[0] as Clause).children[1] as Table);
    expect(t.head).toHaveLength(1); (root.querySelector('td [contenteditable]') as HTMLElement).focus(); cmd(root, 'thead').click();
    expect(t.head).toHaveLength(0); expect(t.body).toHaveLength(2);
  });

  it('the status bar counts the words, figures and tables and follows the zoom', () => {
    const { root } = mount();
    expect(root.querySelector('[data-st="words"]')!.textContent).toMatch(/words/); expect(root.querySelector('[data-st="counts"]')!.textContent).toBe('0 figures · 1 table');
    const z = root.querySelector<HTMLSelectElement>('.jsg-status select')!; z.value = '125'; z.dispatchEvent(new Event('change'));
    expect(root.querySelector<HTMLElement>('.jsg-sheet')!.style.zoom).toBe('1.25');
  });
});

const plainText = (p: Para): string => p.inline.map((i) => (i.t === 'text' ? i.text : '')).join('');
