// The editor driven through its table buttons and its open path: merging and splitting cells, a document that arrives out of order, and the guarantee that no command
// the editor offers can leave content after a sub-section.
import { afterEach, describe, expect, it } from 'vitest';
import { JssEditor, type EditorHost } from './editor';
import { parseJss, serializeJss } from './xml';
import { isSection, type Chapter, type Section, type Table } from './model';
import { placeCells } from './ops';
import { placeCaret } from './dom';

const DOC = `<?xml version="1.0" encoding="UTF-8"?>
<jssbook docType="uhb" schemaVersion="1.0">
  <bookmeta><bookName>User Handbook</bookName></bookmeta>
  <body>
    <chapter number="1" id="c1"><title>Leading Particulars and General Data</title>
      <section id="s1"><title>Purpose</title>
        <para>Intro</para>
        <table id="t1"><title>Grid</title>
          <thead><row><cell>A</cell><cell>B</cell><cell>C</cell></row></thead>
          <tbody><row><cell>1</cell><cell>2</cell><cell>3</cell></row><row><cell>4</cell><cell>5</cell><cell>6</cell></row></tbody>
        </table>
        <section id="s2"><title>Sub</title><para>Inside</para></section>
      </section>
    </chapter>
  </body>
</jssbook>
`;

interface H { ed: JssEditor; root: HTMLElement; notes: string[]; dirty: boolean[] }
const live: JssEditor[] = [];
function mount(xml = DOC): H {
  const container = document.createElement('div'); document.body.append(container);
  const h: H = { ed: undefined as unknown as JssEditor, root: container, notes: [], dirty: [] };
  const host: EditorHost = {
    graphics: async () => [], uploadGraphic: async () => ({ src: 'Media/x.png', name: 'x.png', url: '/x' }), imageUrl: (s) => s,
    onDirty: (d) => h.dirty.push(d), onSaveRequested: () => undefined, onCheckRequested: () => undefined, notify: (m) => h.notes.push(m),
  };
  h.ed = new JssEditor(container, { doc: parseJss(xml), maxDepth: 5, readOnly: false, host }); live.push(h.ed);
  return h;
}
afterEach(() => { while (live.length) live.pop()!.destroy(); document.body.textContent = ''; });

const all = (root: ParentNode, sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const tool = (h: H, label: string): HTMLButtonElement => { const b = all(h.root, '.jss-ttools button').find((x) => x.textContent === label); if (!b) throw new Error(`no table button ${label}`); return b as HTMLButtonElement; };
const bodyCells = (h: H) => all(h.root, 'tbody td [data-edit]');
const section = (h: H): Section => h.ed.getDoc().chapters[0].children.find(isSection) as Section;
const table = (h: H): Table => section(h).children.find((c) => c.k === 'table') as Table;

describe('merging cells in the editor', () => {
  it('Merge right joins the cell the caret is in with its neighbour, and Split brings it back', () => {
    const h = mount(); placeCaret(bodyCells(h)[0], 0); tool(h, 'Merge right').click();
    expect(table(h).body[0].cells).toHaveLength(2); expect(table(h).body[0].cells[0].colspan).toBe(2);
    expect(all(h.root, 'tbody tr')[0].querySelectorAll('td')).toHaveLength(2); expect(all(h.root, 'tbody td')[0].getAttribute('colspan')).toBe('2');
    expect(h.ed.getXml()).toContain('<cell colspan="2">1<br/>2</cell>');
    placeCaret(bodyCells(h)[0], 0); tool(h, 'Split cell').click();
    expect(table(h).body[0].cells).toHaveLength(3); expect(table(h).body[0].cells[0].colspan).toBeUndefined();
  });

  it('Merge down makes a tall cell; the rows below lose that cell', () => {
    const h = mount(); placeCaret(bodyCells(h)[1], 0); tool(h, 'Merge down').click();
    expect(table(h).body[0].cells[1].rowspan).toBe(2); expect(table(h).body[1].cells).toHaveLength(2);
    expect(h.ed.getXml()).toContain('<cell rowspan="2">2<br/>5</cell>');
    expect(all(h.root, 'tbody td')[1].getAttribute('rowspan')).toBe('2');
  });

  it('says why a merge is not possible and changes nothing', () => {
    const h = mount(); const before = h.ed.getXml();
    placeCaret(bodyCells(h)[2], 0); tool(h, 'Merge right').click(); expect(h.notes.pop()).toMatch(/no cell to the right/);
    placeCaret(bodyCells(h)[3], 0); tool(h, 'Merge down').click(); expect(h.notes.pop()).toMatch(/no cell below/);
    placeCaret(bodyCells(h)[0], 0); tool(h, 'Split cell').click(); expect(h.notes.pop()).toMatch(/not merged/);
    tool(h, 'Merge right').click();                                                                 // with the caret in a cell this one works...
    expect(h.ed.getXml()).not.toBe(before);
    const h2 = mount(); tool(h2, 'Merge right').click(); expect(h2.notes.pop()).toMatch(/Click in a cell/); expect(h2.ed.getXml()).toBe(serializeJss(parseJss(DOC)));
  });

  it('a merged table is a single undo step, and its row and column buttons are off with the reason shown', () => {
    const h = mount(); const original = h.ed.getXml(); placeCaret(bodyCells(h)[0], 0); tool(h, 'Merge right').click();
    expect(tool(h, '+ Row below').disabled).toBe(true); expect(tool(h, '− Column').disabled).toBe(true);
    expect(all(h.root, '.jss-ttools .hint')[0].textContent).toMatch(/split them to add or remove rows and columns/);
    h.ed.undo(); expect(h.ed.getXml()).toBe(original);
    expect(tool(h, '+ Row below').disabled).toBe(false);
  });

  it('keeps the grid complete however the buttons are pressed', () => {
    const h = mount(); const presses = ['Merge right', 'Merge down', 'Split cell', 'Merge down', 'Merge right', 'Split cell', 'Merge right'];
    let n = 0;
    for (const p of presses) {
      const cells = bodyCells(h); placeCaret(cells[n++ % cells.length], 0); tool(h, p).click();
      const rows = table(h).body; const placed = placeCells(rows); const total = Math.max(...placed.map((r) => r.reduce((m, c) => Math.max(m, c.gridCol + (c.cell.colspan ?? 1)), 0)));
      const seen = rows.map(() => Array(total).fill(0));
      placed.forEach((r, ri) => r.forEach((c) => { for (let a = 0; a < (c.cell.rowspan ?? 1); a++) for (let b = 0; b < (c.cell.colspan ?? 1); b++) if (ri + a < rows.length) seen[ri + a][c.gridCol + b] += 1; }));
      expect(seen.every((r) => r.every((x) => x === 1))).toBe(true);
    }
  });
});

describe('content order in the editor', () => {
  const LATE = DOC.replace('<section id="s2"><title>Sub</title><para>Inside</para></section>', '<section id="s2"><title>Sub</title><para>Inside</para></section>\n        <para>After the sub-section</para>');

  it('a document whose content follows a sub-section opens as unsaved, shows it ahead of the sub-section, and tells the author', () => {
    const h = mount(LATE);
    expect(h.ed.isDirty()).toBe(true); expect(h.dirty).toContain(true); expect(h.notes[0]).toMatch(/content after a sub-section/);
    const text = all(h.root, '.jss-para').map((e) => e.textContent);
    expect(text.indexOf('After the sub-section')).toBeLessThan(text.indexOf('Inside'));          // drawn where the PDF will print it
    const xml = h.ed.getXml(); expect(xml.indexOf('After the sub-section')).toBeLessThan(xml.indexOf('<title>Sub</title>'));
    h.ed.markSaved(); expect(h.ed.isDirty()).toBe(false);
  });

  it('adding text to a chapter or section that holds only sub-sections puts it ahead of them', () => {
    const only = DOC.replace('<para>Intro</para>', '').replace(/<table id="t1">[\s\S]*?<\/table>/, '').replace('<section id="s1">', '<section id="s0"><title>Zero</title></section>\n      <section id="s1">');
    const h = mount(only);
    const chapterEmpty = all(h.root, '.jss-chapter > .jss-empty')[0]; expect(chapterEmpty).toBeTruthy();       // the chapter has sub-sections but no content of its own
    chapterEmpty.click();
    const ch = h.ed.getDoc().chapters[0].children; expect(ch[0].k).toBe('para'); expect(ch.slice(1).every((c) => isSection(c))).toBe(true);
    const secEmpty = all(h.root, '.jss-sec-body > .jss-empty').find((e) => e.closest('.jss-sec')?.querySelector('.jss-sec-title')?.textContent === 'Purpose'); expect(secEmpty).toBeTruthy();
    secEmpty!.click();
    const purpose = ch.find((c) => isSection(c) && c.title === 'Purpose') as Section; expect(purpose.children[0].k).toBe('para'); expect(purpose.children.slice(1).every((c) => isSection(c))).toBe(true);
  });

  it('an ordered document opens as saved', () => { const h = mount(); expect(h.ed.isDirty()).toBe(false); expect(h.notes).toEqual([]); });

  it('no command the editor offers puts content after a sub-section', () => {
    const h = mount();
    const ordered = (kids: Chapter['children']): boolean => { const first = kids.findIndex(isSection); return (first < 0 || kids.slice(first).every((c) => isSection(c))) && kids.filter(isSection).every((s) => ordered(s.children)); };
    placeCaret(all(h.root, '.jss-para')[0], 0);
    for (let i = 0; i < 3; i++) {
      h.ed.exec('paragraph'); expect(ordered(h.ed.getDoc().chapters[0].children)).toBe(true);
      h.ed.exec('list', 'alpha'); h.ed.exec('table', { rows: 1, cols: 2, title: 'T' }); h.ed.exec('notice', 'note'); h.ed.exec('pageBreak');
      expect(ordered(h.ed.getDoc().chapters[0].children)).toBe(true);
      h.ed.exec('subsection'); expect(ordered(h.ed.getDoc().chapters[0].children)).toBe(true);
      h.ed.exec('section'); expect(ordered(h.ed.getDoc().chapters[0].children)).toBe(true);
      placeCaret(all(h.root, '.jss-sec-title')[0], 0);
    }
    for (const b of all(h.root, '.jss-sec-tools button')) { if (!(b as HTMLButtonElement).disabled) b.click(); expect(ordered(h.ed.getDoc().chapters[0].children)).toBe(true); }
    const xml = h.ed.getXml(); expect(parseJss(xml).reordered).toBeUndefined();                        // what it writes is what it would read back as ordered
  });
});
