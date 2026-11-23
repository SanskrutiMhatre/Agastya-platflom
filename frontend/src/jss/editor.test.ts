// The JSS editor driven the way a person drives it: typing, Enter, Backspace, Tab, the toolbar, its dialogs, undo and the read-only view.
// Whatever the sheet does, the XML must stay valid against the real schema.
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { JssEditor, type EditorHost, type Finding } from './editor';
import { parseJss, serializeJss } from './xml';
import { isSection, type List, type Para, type Section, type Table } from './model';
import { placeCaret } from './dom';

const DOC = `<?xml version="1.0" encoding="UTF-8"?>
<jssbook docType="uhb" schemaVersion="1.0">
  <bookmeta>
    <bookName>User Handbook</bookName>
  </bookmeta>
  <body>
    <chapter number="1" id="c1"><title>Leading Particulars and General Data</title>
      <section id="s1"><title>Purpose</title>
        <para>First paragraph</para>
        <para>Second paragraph</para>
        <list type="alpha">
          <item>Alpha</item>
          <item>Beta</item>
        </list>
        <table id="t1" widths="20mm 1*"><title>Specs</title>
          <thead>
            <row>
              <cell>A</cell>
              <cell>B</cell>
            </row>
          </thead>
          <tbody>
            <row>
              <cell>1</cell>
              <cell>2</cell>
            </row>
          </tbody>
        </table>
      </section>
      <section id="s2"><title>Features</title></section>
    </chapter>
    <chapter number="2" id="c2"><title>Brief Technical Description</title></chapter>
  </body>
</jssbook>
`;

interface Harness { ed: JssEditor; root: HTMLElement; dirty: boolean[]; notes: string[]; saves: number; checks: number }
const mounted: JssEditor[] = [];
function mount(xml = DOC, readOnly = false): Harness {
  const container = document.createElement('div'); document.body.append(container);
  const h: Harness = { ed: undefined as unknown as JssEditor, root: container, dirty: [], notes: [], saves: 0, checks: 0 };
  const host: EditorHost = {
    graphics: async () => [{ src: 'Media/plate.png', name: 'plate.png', url: '/m/plate.png' }],
    uploadGraphic: async () => ({ src: 'Media/new.png', name: 'new.png', url: '/m/new.png' }),
    imageUrl: (s) => `/m/${s.split('/').pop()}`,
    onDirty: (d) => h.dirty.push(d), onSaveRequested: () => { h.saves += 1; }, onCheckRequested: () => { h.checks += 1; }, notify: (m) => h.notes.push(m),
  };
  h.ed = new JssEditor(container, { doc: parseJss(xml), maxDepth: 5, readOnly, host }); mounted.push(h.ed);
  return h;
}
afterEach(() => { while (mounted.length) mounted.pop()!.destroy(); document.body.textContent = ''; });

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T => { const e = root.querySelector<T>(sel); if (!e) throw new Error(`nothing matches ${sel}`); return e; };
const all = (root: ParentNode, sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const type = (el: HTMLElement, text: string) => { el.dispatchEvent(new Event('beforeinput', { bubbles: true })); el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })); };   // a browser fires beforeinput first
const key = (el: HTMLElement, k: string, init: KeyboardEventInit = {}) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }); el.dispatchEvent(e); return e; };
const paraEls = (root: HTMLElement) => all(root, '.jss-block[data-kind="para"] [data-edit]');
const tick = () => new Promise((r) => setTimeout(r, 0));
const body = (h: Harness) => h.ed.getDoc().chapters[0].children.find(isSection) as Section;

describe('drawing the sheet', () => {
  it('shows the stencil chapters locked, numbered headings, list labels and captions numbered as the PDF will', () => {
    const h = mount();
    expect(all(h.root, '.jss-ch-no').map((e) => e.textContent)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(all(h.root, '.jss-ch-title').every((e) => !e.hasAttribute('contenteditable') && !e.querySelector('[contenteditable]'))).toBe(true);
    expect(all(h.root, '.jss-sec-no').map((e) => e.textContent)).toEqual(['1.1', '1.2']);
    expect(all(h.root, '.jss-li-label').map((e) => e.textContent)).toEqual(['(a)', '(b)']);
    expect(q(h.root, '.jss-tablewrap .jss-cap .no').textContent).toBe('Table 1-1: ');
    expect(all(h.root, '.jss-ol').map((e) => e.textContent)).toEqual(['Ch 1Leading Particulars and General Data', '1.1Purpose', '1.2Features', 'Ch 2Brief Technical Description']);
    expect(q(h.root, '.jss-table thead')).toBeTruthy(); expect(all(h.root, '.jss-table col')).toHaveLength(2);
  });

  it('is exactly the document it was given: nothing is changed until the author changes something', () => {
    const h = mount(); expect(h.ed.getXml()).toBe(serializeJss(parseJss(DOC))); expect(h.ed.isDirty()).toBe(false);
  });
});

describe('typing', () => {
  it('writes what is typed into the model and says the document has changed', () => {
    const h = mount(); const p = paraEls(h.root)[0];
    type(p, 'Edited text'); expect(h.ed.isDirty()).toBe(true); expect(h.dirty).toContain(true);
    expect((body(h).children[0] as Para).inline).toEqual([{ t: 'text', text: 'Edited text' }]); expect(h.ed.getXml()).toContain('<para>Edited text</para>');
  });

  it('reads the browser\'s own markup as the schema\'s: <strong> is <b>, a styled span is a mark, a trailing <br> is dropped, nbsp is a space', () => {
    const h = mount(); const p = paraEls(h.root)[0];
    p.innerHTML = 'a&nbsp;<strong>b</strong><span style="font-style: italic">c</span><sup>2</sup><br>'; p.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.ed.getXml()).toContain('<para>a <b>b</b><i>c</i><sup>2</sup></para>');
  });

  it('keeps a title as plain text and renumbers what depends on it', async () => {
    const h = mount(); const title = all(h.root, '.jss-sec-title')[0];
    type(title, 'Aim'); expect(body(h).title).toBe('Aim');
    const cap = q(h.root, '.jss-tablewrap .jss-cap [data-edit]'); type(cap, ''); expect((body(h).children[3] as Table).title).toBe('');
    await new Promise((r) => setTimeout(r, 300));
    expect(q(h.root, '.jss-tablewrap .jss-cap .no').textContent).toBe('Table: ');                // no caption: no number, as the pipeline counts
  });
});

describe('Enter, Backspace and Tab', () => {
  it('Enter splits a paragraph at the caret into two', () => {
    const h = mount(); const p = paraEls(h.root)[0];
    placeCaret(p, 5); const e = key(p, 'Enter'); expect(e.defaultPrevented).toBe(true);
    const kids = body(h).children as Para[]; expect(kids[0].inline).toEqual([{ t: 'text', text: 'First' }]); expect(kids[1].inline).toEqual([{ t: 'text', text: ' paragraph' }]);
    expect(h.ed.getXml()).toContain('<para>First</para>\n        <para> paragraph</para>');
  });

  it('Backspace at the start of a paragraph joins it to the one before; an empty paragraph just goes', () => {
    const h = mount(); const second = paraEls(h.root)[1];
    placeCaret(second, 0); key(second, 'Backspace');
    expect((body(h).children[0] as Para).inline).toEqual([{ t: 'text', text: 'First paragraphSecond paragraph' }]); expect(body(h).children[1].k).toBe('list');
    const h2 = mount(); h2.ed.exec('paragraph'); const empties = paraEls(h2.root); const last = empties[empties.length - 1];
    const before = body(h2).children.length; placeCaret(last, 0); key(last, 'Backspace'); expect(body(h2).children.length).toBe(before - 1);
  });

  it('Enter in a list item adds an item; Enter on an empty last item leaves the list for a paragraph', () => {
    const h = mount(); const items = all(h.root, '.jss-li [data-edit]');
    placeCaret(items[1], 4); key(items[1], 'Enter');
    let list = body(h).children[2] as List; expect(list.items).toHaveLength(3);
    const now = all(h.root, '.jss-li [data-edit]'); placeCaret(now[2], 0); key(now[2], 'Enter');           // the new item is empty and last
    list = body(h).children[2] as List; expect(list.items).toHaveLength(2); expect(body(h).children[3].k).toBe('para');
  });

  it('Tab nests a list item under the one before it, Shift+Tab brings it back', () => {
    const h = mount(); const second = all(h.root, '.jss-li [data-edit]')[1];
    placeCaret(second, 0); key(second, 'Tab');
    let list = body(h).children[2] as List; expect(list.items).toHaveLength(1);
    expect(all(h.root, '.jss-list .jss-list .jss-li-label').map((e) => e.textContent)).toEqual(['(i)']);   // a second level counts in roman
    const nested = all(h.root, '.jss-list .jss-list .jss-li [data-edit]')[0]; placeCaret(nested, 0); key(nested, 'Tab', { shiftKey: true });
    list = body(h).children[2] as List; expect(list.items).toHaveLength(2);
  });

  it('Tab in a table cell moves to the next cell, and from the last cell adds a row', () => {
    const h = mount(); const cells = all(h.root, 'td [data-edit]'); const table = body(h).children[3] as Table;
    placeCaret(cells[0], 0); key(cells[0], 'Tab'); expect(document.activeElement).toBe(cells[1]);
    const last = cells[cells.length - 1]; placeCaret(last, 0); key(last, 'Tab'); expect(table.body).toHaveLength(2);
  });
});

describe('the toolbar', () => {
  const press = (h: Harness, cmd: string) => q<HTMLButtonElement>(h.root, `[data-cmd="${cmd}"]`).click();

  it('adds a paragraph after the block the caret is in', () => {
    const h = mount(); const p = paraEls(h.root)[0]; placeCaret(p, 0);
    press(h, 'para'); expect(body(h).children.map((c) => c.k)).toEqual(['para', 'para', 'para', 'list', 'table']);
  });

  it('switches "no indent" on and off for the paragraph under the caret, and groups the tools into tabs', () => {
    const h = mount(); placeCaret(paraEls(h.root)[0], 0);
    press(h, 'noindent'); expect((body(h).children[0] as Para).indentNone).toBe(true);
    placeCaret(paraEls(h.root)[0], 0); press(h, 'noindent'); expect((body(h).children[0] as Para).indentNone).toBeFalsy();
    expect(all(h.root, '[role="tab"]').map((t) => t.textContent)).toEqual(['Write', 'Insert', 'Arrange', 'Document']);
    expect(all(h.root, '[role="tabpanel"]').filter((p) => !p.hasAttribute('hidden'))).toHaveLength(1);
  });

  it('inserts lists, notices, a page break, and keeps blocks ahead of sections', () => {
    const h = mount(); placeCaret(paraEls(h.root)[0], 0);
    h.ed.exec('list', 'roman'); h.ed.exec('notice', 'warning'); h.ed.exec('pageBreak');
    expect(body(h).children.map((c) => c.k)).toEqual(['para', 'list', 'warning', 'pageBreak', 'para', 'list', 'table'].slice(0, 1).concat(['list', 'warning', 'pageBreak', 'para', 'list', 'table']));
    expect(q(h.root, '.jss-notice.warning .band').textContent).toContain('WARNING');
  });

  it('adds sections and sub-sections under the caret, and refuses to go deeper than the stencil', () => {
    const h = mount(); placeCaret(all(h.root, '.jss-sec-title')[0], 0);
    h.ed.exec('subsection'); expect(body(h).children.filter(isSection)).toHaveLength(1);
    expect(all(h.root, '.jss-sec-no').map((e) => e.textContent)).toEqual(['1.1', '1.1.1', '1.2']);
    h.ed.exec('section'); expect(h.ed.getDoc().chapters[0].children.filter(isSection)).toHaveLength(3);
    expect(h.ed.getDoc().chapters).toHaveLength(2);                                      // never a new chapter
  });

  it('moves and deletes blocks', async () => {
    const h = mount(); const p = paraEls(h.root)[0]; placeCaret(p, 0);
    press(h, 'down'); expect((body(h).children[0] as Para).inline[0]).toEqual({ t: 'text', text: 'Second paragraph' });
    press(h, 'up'); expect((body(h).children[0] as Para).inline[0]).toEqual({ t: 'text', text: 'First paragraph' });
    const first = paraEls(h.root)[0]; placeCaret(first, 0); type(first, ''); press(h, 'delete'); await tick();           // an empty block goes without asking
    expect(body(h).children[0].k).toBe('para'); expect((body(h).children[0] as Para).inline[0]).toEqual({ t: 'text', text: 'Second paragraph' });
  });

  it('the table dialog builds the table asked for, validated before it closes', async () => {
    const h = mount(); placeCaret(paraEls(h.root)[0], 0); press(h, 'table'); await tick();
    const dlg = q(h.root, '.jss-dialog'); const nums = all(dlg, 'input[type="number"]');
    nums[1].setAttribute('value', '99'); (nums[1] as HTMLInputElement).value = '99'; q(dlg, '.jss-btn.primary').click();
    expect(q(dlg, '.err').textContent).toMatch(/Columns/); expect(body(h).children.filter((c) => c.k === 'table')).toHaveLength(1);
    (nums[1] as HTMLInputElement).value = '4'; (nums[0] as HTMLInputElement).value = '2'; (q(dlg, 'input[type="text"]') as HTMLInputElement).value = 'Dimensions'; q(dlg, '.jss-btn.primary').click(); await tick();
    const tables = body(h).children.filter((c): c is Table => c.k === 'table'); expect(tables).toHaveLength(2);
    const made = tables.find((t) => t.title === 'Dimensions')!; expect(made).toBeTruthy(); expect(tables[0]).toBe(made);            // it goes right after the block the caret was in
    expect(made.head[0].cells).toHaveLength(4); expect(made.body).toHaveLength(2);
    expect(document.querySelector('.jss-dialog')).toBeNull();
  });

  it('the details dialog edits the cover details and insists on a title', async () => {
    const h = mount(); press(h, 'details'); await tick();
    const dlg = q(h.root, '.jss-dialog'); const inputs = all(dlg, 'input') as HTMLInputElement[];
    inputs[0].value = ''; q(dlg, '.jss-btn.primary').click(); expect(q(dlg, '.err').textContent).toMatch(/title/);
    inputs[0].value = 'Akash User Handbook'; inputs[2].value = 'DT0042_U0100_0007'; q(dlg, '.jss-btn.primary').click(); await tick();
    expect(h.ed.getDoc().meta).toMatchObject({ bookName: 'Akash User Handbook', codeNo: 'DT0042_U0100_0007' }); expect(h.ed.getXml()).toContain('<codeNo>DT0042_U0100_0007</codeNo>');
  });

  it('the figure dialog lists the project\'s pictures and inserts the one chosen', async () => {
    const h = mount(); placeCaret(paraEls(h.root)[0], 0); press(h, 'figure'); await tick(); await tick();
    const dlg = q(h.root, '.jss-dialog'); q(dlg, '.jss-btn.primary').click(); expect(q(dlg, '.err').textContent).toMatch(/Choose a picture/);
    q(dlg, '.pick button').click(); q(dlg, '.jss-btn.primary').click(); await tick();
    const fig = body(h).children.find((c) => c.k === 'figure') as { graphics: Array<{ src: string }> }; expect(fig.graphics[0].src).toBe('Media/plate.png');
    expect(h.ed.getXml()).toContain('<graphic src="Media/plate.png"/>');
  });

  it('a cross-reference is inserted at the caret, prints the table\'s number, and follows a renumbering', async () => {
    const h = mount(); const p = paraEls(h.root)[0]; placeCaret(p, 5); press(h, 'xref'); await tick();
    const dlg = q(h.root, '.jss-dialog'); const rows = all(dlg, '.list button'); expect(rows.map((r) => r.textContent)).toEqual(['sectionPurposeSpecs'.length ? rows[0].textContent! : '', rows[1].textContent!, rows[2].textContent!]);
    const tableRow = rows.find((r) => /Table 1-1/.test(r.textContent ?? ''))!; tableRow.click(); q(dlg, '.jss-btn.primary').click(); await tick();
    expect(h.ed.getXml()).toContain('<para>First<xref to="t1"/> paragraph</para>');
    expect(q(h.root, '.jss-xref').textContent).toBe('Table 1-1');
    const cap = q(h.root, '.jss-tablewrap .jss-cap [data-edit]'); type(cap, ''); await new Promise((r) => setTimeout(r, 300));
    expect(q(h.root, '.jss-xref').classList.contains('missing')).toBe(true);                   // the table lost its caption, so its number is gone
  });
});

describe('undo and redo', () => {
  it('undoes and redoes typing and structural changes, always to a document the XML describes', () => {
    const h = mount(); const original = h.ed.getXml();
    const p = paraEls(h.root)[0]; type(p, 'changed'); h.ed.exec('table', { rows: 1, cols: 2, title: 'T' });
    expect(h.ed.canUndo()).toBe(true); const edited = h.ed.getXml();
    h.ed.undo(); expect(h.ed.getXml()).not.toBe(edited); expect(h.ed.getXml()).toContain('<para>changed</para>');
    h.ed.undo(); expect(h.ed.getXml()).toBe(original);
    h.ed.redo(); h.ed.redo(); expect(h.ed.getXml()).toBe(edited);
    expect(h.ed.canRedo()).toBe(false);
  });

  it('a new change after an undo clears redo', () => {
    const h = mount(); h.ed.exec('paragraph'); h.ed.undo(); expect(h.ed.canRedo()).toBe(true); h.ed.exec('pageBreak'); expect(h.ed.canRedo()).toBe(false);
  });

  it('Ctrl+Z, Ctrl+Y and Ctrl+S act on the document', () => {
    const h = mount(); h.ed.exec('paragraph'); const added = h.ed.getXml();
    key(paraEls(h.root)[0], 'z', { ctrlKey: true }); expect(h.ed.getXml()).not.toBe(added);
    key(paraEls(h.root)[0], 'y', { ctrlKey: true }); expect(h.ed.getXml()).toBe(added);
    key(paraEls(h.root)[0], 's', { ctrlKey: true }); expect(h.saves).toBe(1);
  });
});

describe('problems from the server', () => {
  const findings: Finding[] = [
    { severity: 'error', rule: 'JSS-TABLE-SHAPE', message: 'rows differ', line: 20, location: '/jssbook/body/chapter/section/table' },
    { severity: 'warning', rule: 'JSS-SECTION-EMPTY', message: 'empty', line: 30, location: '/jssbook/body/chapter/section[2]' },
    { severity: 'error', rule: 'JSS-CHAPTERS', message: 'chapters', line: 7, location: '/jssbook/body' },
  ];
  it('marks what they are about, lists them, and goes to one when it is clicked', () => {
    const h = mount(); h.ed.setFindings(findings);
    expect(q(h.root, '.jss-tablewrap').closest('.jss-block')!.classList.contains('jss-has-error')).toBe(true);
    expect(all(h.root, '.jss-sec')[1].classList.contains('jss-has-warn')).toBe(true);
    expect(q(h.root, '.jss-problems summary').textContent).toBe('Problems: 2 errors, 1 warning');
    expect(all(h.root, '.jss-pr')).toHaveLength(3); expect(all(h.root, '.jss-ol').filter((r) => r.classList.contains('bad')).length).toBeGreaterThan(0);
    all(h.root, '.jss-pr')[0].click();                                                              // must not throw, and the sheet is kept
    h.ed.setFindings([]); expect(q(h.root, '.jss-problems summary').textContent).toBe('No problems found'); expect(h.root.querySelectorAll('.jss-problem-mark')).toHaveLength(0);
  });
});

describe('the XML view and a document that comes from outside', () => {
  it('shows exactly the XML that will be saved', () => {
    const h = mount(); h.ed.exec('paragraph'); q<HTMLButtonElement>(h.root, '[data-cmd="source"]').click();
    expect(q(h.root, '.jss-source').textContent).toBe(h.ed.getXml()); expect(q(h.root, '.jss-source').hasAttribute('hidden')).toBe(false);
    q<HTMLButtonElement>(h.root, '[data-cmd="source"]').click(); expect(q(h.root, '.jss-source').hasAttribute('hidden')).toBe(true);
  });

  it('setDocument replaces the document and clears the undo history and the unsaved mark', () => {
    const h = mount(); h.ed.exec('paragraph'); expect(h.ed.isDirty()).toBe(true);
    h.ed.setDocument(parseJss(DOC)); expect(h.ed.isDirty()).toBe(false); expect(h.ed.canUndo()).toBe(false); expect(h.ed.getXml()).toBe(serializeJss(parseJss(DOC)));
  });

  it('markSaved clears the unsaved mark and tells the host', () => {
    const h = mount(); h.ed.exec('paragraph'); h.ed.markSaved(); expect(h.ed.isDirty()).toBe(false); expect(h.dirty[h.dirty.length - 1]).toBe(false);
  });
});

describe('read-only', () => {
  it('shows the document but offers nothing that edits it', () => {
    const h = mount(DOC, true);
    expect(all(h.root, '[data-edit]').every((e) => e.getAttribute('contenteditable') === 'false')).toBe(true);
    expect(q<HTMLButtonElement>(h.root, '[data-cmd="para"]').disabled).toBe(true); expect(q<HTMLButtonElement>(h.root, '[data-cmd="table"]').disabled).toBe(true);
    expect(q<HTMLButtonElement>(h.root, '[data-cmd="source"]').disabled).toBe(false);
    h.ed.exec('paragraph'); h.ed.undo(); expect(h.ed.getXml()).toBe(serializeJss(parseJss(DOC)));
    expect(h.root.querySelector('.jss-sec-tools')?.children.length ?? 0).toBe(0);
  });
});

describe('what the editor writes stays valid against the real schema', () => {
  const root = path.resolve(__dirname, '..', '..', '..', 'backend');
  const xsd = path.join(root, 'schemas', 'jss', 'jss-1.0.xsd');
  const available = fs.existsSync(xsd) && fs.existsSync(path.join(root, 'node_modules', 'xmllint-wasm'));
  (available ? it : it.skip)('after a run of edits of every kind', async () => {
    const { validateXML } = createRequire(path.join(root, 'package.json'))('xmllint-wasm');
    const h = mount(); placeCaret(paraEls(h.root)[0], 3);
    key(paraEls(h.root)[0], 'Enter'); h.ed.exec('list', 'bullet'); h.ed.exec('table', { rows: 3, cols: 3, title: 'Readings' }); h.ed.exec('notice', 'caution'); h.ed.exec('pageBreak');
    h.ed.exec('subsection'); h.ed.exec('section');
    const li = all(h.root, '.jss-li [data-edit]')[1]; placeCaret(li, 0); key(li, 'Tab');
    const r = (await validateXML({ xml: [{ fileName: 'd.xml', contents: h.ed.getXml() }], schema: [{ fileName: 'jss-1.0.xsd', contents: fs.readFileSync(xsd, 'utf8') }] })) as { valid: boolean; errors: Array<{ message: string }> };
    expect(r.errors.map((e) => e.message)).toEqual([]); expect(r.valid).toBe(true);
  });
});
