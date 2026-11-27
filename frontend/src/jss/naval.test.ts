// The Naval stencils in the editor: what a landscape or A3 chapter keeps when it is opened and saved, the stencil's own tables (merged head, proportional widths),
// rows added under a merged head, chapters the author adds for each system (Part IV), and the sections a stencil fixes.
//
// The stencil data is the backend's own registry (backend/dist, built by `npx tsc` there), so the editor is tested on the tables the server really offers,
// and what the editor writes is checked against the real schema with the validator the server uses. Skipped where the backend is not built.
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { JssEditor, type EditorHost } from './editor';
import { JssParseError, parseJss, serializeJss } from './xml';
import { chapterFromOutline, isSection, newTable, tableFromTemplate, templateColumns, type JssDoc, type OutlineNode, type Section, type Table, type TableTemplate } from './model';
import { addChapter, addRow, columnCount, deleteRow, groupHasSpans, hasSpans, moveChapter, removeChapter } from './ops';

const backend = path.resolve(__dirname, '..', '..', '..', 'backend');
const registryFile = path.join(backend, 'dist', 'services', 'jss', 'registry.js');
const xsdFile = path.join(backend, 'schemas', 'jss', 'jss-1.0.xsd');
const have = fs.existsSync(registryFile) && fs.existsSync(xsdFile);
const registry = have ? (createRequire(path.join(backend, 'package.json'))(registryFile) as { jssTypeById(id: string): { chapters: OutlineNode[]; chapterRule?: string }; tableTemplatesOf(t: unknown): TableTemplate[]; JSS_TYPES: Array<{ id: string; ready: boolean; domain: string }> }) : null;
const typeOf = (id: string) => registry!.jssTypeById(id);

const validate = async (xml: string): Promise<string[]> => {
  const { validateXML } = createRequire(path.join(backend, 'package.json'))('xmllint-wasm');
  const r = (await validateXML({ xml: [{ fileName: 'd.xml', contents: xml }], schema: [{ fileName: 'jss-1.0.xsd', contents: fs.readFileSync(xsdFile, 'utf8') }] })) as { valid: boolean; errors: Array<{ message: string }> };
  return r.errors.map((e) => e.message);
};

const wrap = (docType: string, chapters: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<jssbook docType="${docType}" schemaVersion="1.0">
  <bookmeta>
    <bookName>Naval</bookName>
  </bookmeta>
  <body>
${chapters}
  </body>
</jssbook>
`;

/**
 * The starting document the server writes for every ready type, made by the server's own code in a child process with a workspace of its own (loading that code in this process
 * would open a workspace as a side effect). Null where the backend is not built.
 */
function startingDocuments(): Record<string, string> | null {
  if (!have) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jss-start-'));
  const script = "const s=require('./dist/services/jss/service');const r=require('./dist/services/jss/registry');const out={};"
    + "for(const t of r.JSS_TYPES.filter((x)=>x.ready)) out[t.id]=s.skeletonXml(t,{bookName:'Round trip',systemName:'System'});process.stdout.write('@@STARTING-DOCUMENTS@@'+JSON.stringify(out));process.exit(0);";
  const r = spawnSync(process.execPath, ['-e', script], { cwd: backend, env: { ...process.env, AGASTYA_WORKSPACE_DIR: dir }, encoding: 'utf8', maxBuffer: 1 << 27 });
  // the server's own start-up lines (e.g. "[db] quick_check: ok") share stdout; the result follows its marker
  const at = r.stdout.lastIndexOf('@@STARTING-DOCUMENTS@@');
  return r.status === 0 && at >= 0 ? (JSON.parse(r.stdout.slice(at + '@@STARTING-DOCUMENTS@@'.length)) as Record<string, string>) : null;
}

describe.skipIf(!have)('the starting document of every type opens in the editor and is saved back without losing anything', () => {
  const docs = startingDocuments();
  it('was produced by the server', () => { expect(docs).not.toBeNull(); expect(Object.keys(docs!).filter((id) => id.startsWith('naval-'))).toHaveLength(10); });
  it('reads and writes back as the same document, and what is written is valid against the schema', async () => {
    for (const [id, xml] of Object.entries(docs ?? {})) {
      const d = parseJss(xml); const out = serializeJss(d);
      expect(JSON.stringify(parseJss(out)), `${id}: the document survives a save`).toBe(JSON.stringify(d));
      expect(await validate(out), `${id}: what the editor writes`).toEqual([]);
      // what the server put on the chapters (the page, the number, the id) is still there
      const attrs = (x: string) => [...x.matchAll(/<chapter ([^>]*)>/g)].map((m) => m[1]);
      expect(attrs(out), `${id}: chapter attributes`).toEqual(attrs(xml));
      expect((out.match(/<table /g) ?? []).length, `${id}: tables`).toBe((xml.match(/<table /g) ?? []).length);
      expect((out.match(/rowspan=|colspan=/g) ?? []).length, `${id}: merged cells`).toBe((xml.match(/rowspan=|colspan=/g) ?? []).length);
    }
  });
});

describe('a chapter keeps its page when the document is opened and saved', () => {
  const XML = wrap('naval-mrls', `    <chapter number="1" id="c1" orientation="a3-landscape"><title>MRLS</title><para>x</para></chapter>
    <chapter number="2" id="c2" orientation="landscape"><title>B</title></chapter>
    <chapter number="3" id="c3"><title>C</title></chapter>`);

  it('reads the chapter\'s orientation and writes it back, in the order the server writes it', () => {
    const doc = parseJss(XML);
    expect(doc.chapters.map((c) => c.orientation)).toEqual(['a3-landscape', 'landscape', undefined]);
    const out = serializeJss(doc);
    expect(out).toContain('<chapter number="1" id="c1" orientation="a3-landscape">');
    expect(out).toContain('<chapter number="2" id="c2" orientation="landscape">');
    expect(out).toContain('<chapter number="3" id="c3"><title>C</title>');
    expect(serializeJss(parseJss(out))).toBe(out);
  });

  it('refuses a page the schema does not have, naming it', () => {
    expect(() => parseJss(XML.replace('a3-landscape', 'sideways'))).toThrow(JssParseError);
    expect(() => parseJss(XML.replace('a3-landscape', 'sideways'))).toThrow(/sideways/);
  });
});

describe.skipIf(!have)('the stencil tables of the Naval types', () => {
  const mrls = () => registry!.tableTemplatesOf(typeOf('naval-mrls'))[0];                           // the table the server offers for this type
  const parts = () => typeOf('naval-tm-4-1').chapters[0].children![0].table!;

  it('a table made from the MRLS stencil has its merged head, its widths and blank rows as wide as the stencil', () => {
    const t = tableFromTemplate(mrls(), 't1');
    expect(templateColumns(mrls())).toBe(18); expect(columnCount(t)).toBe(18);
    expect(t.head).toHaveLength(2); expect(t.head[0].cells).toHaveLength(14);
    expect(t.head[0].cells.find((c) => c.colspan === 5)).toBeTruthy(); expect(t.head[0].cells.filter((c) => c.rowspan === 2)).toHaveLength(13);
    expect(t.widths).toBe(mrls().widths); expect(t.body).toHaveLength(mrls().blankRows);
    expect(t.body.every((r) => r.cells.length === 18 && r.cells.every((c) => c.colspan === undefined))).toBe(true);
    expect(hasSpans(t)).toBe(true); expect(groupHasSpans(t, 'head')).toBe(true); expect(groupHasSpans(t, 'body')).toBe(false);
  });

  it('rows can be added to and removed from the body under a merged head; the merged head itself is not touched', () => {
    const t = tableFromTemplate(mrls(), 't1'); const before = t.body.length;
    expect(addRow(t, 'body', before - 1, 'below')).toBe(true); expect(t.body).toHaveLength(before + 1); expect(t.body[before].cells).toHaveLength(18);
    expect(addRow(t, 'body', 0, 'above')).toBe(true); expect(t.body[0].cells).toHaveLength(18);
    expect(deleteRow(t, 'body', 0)).toBe(true); expect(t.body).toHaveLength(before + 1);
    expect(addRow(t, 'head', 0, 'below')).toBe(false); expect(deleteRow(t, 'head', 0)).toBe(false); expect(t.head).toHaveLength(2);
    // a table of the author's own with a merged cell in its body keeps the old refusal
    const own = newTable(2, 3, 't2'); own.body[0].cells[0].colspan = 2; own.body[0].cells.splice(1, 1);
    expect(addRow(own, 'body', 0, 'below')).toBe(false);
  });

  it('every stencil table the registry has is a table the editor can build, write and the schema accepts', async () => {
    for (const type of registry!.JSS_TYPES.filter((x) => x.domain === 'naval' && x.ready)) {
      const full = typeOf(type.id);
      for (const tpl of registry!.tableTemplatesOf(full)) {
        const t = tableFromTemplate(tpl, 't1'); expect(columnCount(t), `${type.id}: columns`).toBe(templateColumns(tpl));
        const doc: JssDoc = { docType: type.id, meta: { bookName: 'N' }, chapters: [{ k: 'chapter', number: 1, id: 'c1', title: 'C', children: [t] }] };
        expect(await validate(serializeJss(doc)), `${type.id}: ${tpl.caption ?? tpl.forSection ?? 'table'}`).toEqual([]);
      }
    }
  });

  it('a chapter started from the Part IV Vol 1 stencil has its assembly section and the parts table under it', () => {
    const outline = typeOf('naval-tm-4-1').chapters[0];
    const doc: JssDoc = { docType: 'naval-tm-4-1', meta: { bookName: 'N' }, chapters: [] };
    const ch = chapterFromOutline(doc, outline, 2, 'landscape');
    expect(ch.number).toBe(2); expect(ch.orientation).toBe('landscape'); expect(ch.title).toBe(outline.title);
    const sec = ch.children.find(isSection) as Section; expect(sec.title).toBe(outline.children![0].title);
    const table = sec.children.find((c) => c.k === 'table') as Table; expect(table.widths).toBe(parts().widths); expect(columnCount(table)).toBe(10);
    expect(new Set([ch.id, sec.id, table.id]).size).toBe(3);
  });

  it('a figures heading and its page break come with the chapter (List of SMT / STE)', () => {
    const outline = typeOf('naval-smt-ste').chapters[0];
    const ch = chapterFromOutline({ docType: 'naval-smt-ste', meta: {}, chapters: [] }, outline, 1, 'landscape');
    expect(ch.children.map((c) => c.k)).toEqual(['table', 'pageBreak', 'para']);
  });
});

describe('chapters the author adds', () => {
  const doc = (): JssDoc => parseJss(wrap('naval-tm-4-2', `    <chapter number="1" id="c1"><title>A</title></chapter>
    <chapter number="2" id="c2"><title>B</title></chapter>`));
  it('are numbered 1, 2, 3 ... in their order whatever is added, moved or removed', () => {
    const d = doc(); const [a, b] = d.chapters;
    addChapter(d, { k: 'chapter', number: 0, id: 'c3', title: 'C', children: [] }, 0);
    expect(d.chapters.map((c) => [c.title, c.number])).toEqual([['A', 1], ['C', 2], ['B', 3]]);
    expect(moveChapter(d, b, -1)).toBe(true); expect(d.chapters.map((c) => [c.title, c.number])).toEqual([['A', 1], ['B', 2], ['C', 3]]);
    expect(moveChapter(d, a, -1)).toBe(false);
    expect(removeChapter(d, a)).toBe(true); expect(d.chapters.map((c) => [c.title, c.number])).toEqual([['B', 1], ['C', 2]]);
    expect(removeChapter(d, d.chapters[0])).toBe(true); expect(removeChapter(d, d.chapters[0])).toBe(false);            // the last chapter stays
    expect(d.chapters).toHaveLength(1);
  });
});

// ── the editor ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const mounted: JssEditor[] = [];
function mount(xml: string, extra: Partial<ConstructorParameters<typeof JssEditor>[1]> = {}, readOnly = false) {
  const container = document.createElement('div'); document.body.append(container);
  const notes: string[] = [];
  const host: EditorHost = { graphics: async () => [], uploadGraphic: async () => ({ src: 'Media/x.png', name: 'x.png', url: '/m/x.png' }), imageUrl: (s) => s, onDirty: () => undefined, onSaveRequested: () => undefined, onCheckRequested: () => undefined, notify: (m) => notes.push(m) };
  const ed = new JssEditor(container, { doc: parseJss(xml), maxDepth: 5, readOnly, host, ...extra }); mounted.push(ed);
  return { ed, root: container, notes };
}
afterEach(() => { while (mounted.length) mounted.pop()!.destroy(); document.body.textContent = ''; });
const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T => { const e = root.querySelector<T>(sel); if (!e) throw new Error(`nothing matches ${sel}`); return e; };
const all = (root: ParentNode, sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const tick = () => new Promise((r) => setTimeout(r, 0));

describe.skipIf(!have)('the editor for a type whose chapters are the author\'s (Part IV)', () => {
  const FREE = wrap('naval-tm-4-1', `    <chapter number="1" id="c1" orientation="landscape"><title>Power Output Cabinet (POC)</title>
      <section id="s1"><title>Assembly Name</title></section>
    </chapter>`);
  const opts = () => ({ chapterRule: 'free' as const, chapterStarter: typeOf('naval-tm-4-1').chapters[0], tableTemplates: registry!.tableTemplatesOf(typeOf('naval-tm-4-1')) });

  it('shows a chapter\'s title as text to edit, with its page, and the add / move / delete controls', () => {
    const h = mount(FREE, opts());
    const title = q(h.root, '.jss-ch-title'); expect(title.getAttribute('contenteditable')).toBe('true'); expect(title.textContent).toBe('Power Output Cabinet (POC)');
    expect(q(h.root, '.jss-ch-no').textContent).toContain('printed on landscape pages');
    expect(q(h.root, '.jss-ch-tools')).toBeTruthy(); expect(q(h.root, '[data-testid="jss-add-chapter"]')).toBeTruthy();
    expect(q(h.root, '.jss-ch-tools button[title="Delete this chapter"]').hasAttribute('disabled')).toBe(true);            // the only chapter stays
  });

  it('"Add a chapter" starts the new chapter from the stencil (assembly section, parts table), on the same page, numbered next, title selected', async () => {
    const h = mount(FREE, opts()); q(h.root, '[data-testid="jss-add-chapter"]').click(); await tick();
    const d = h.ed.getDoc(); expect(d.chapters.map((c) => c.number)).toEqual([1, 2]); expect(d.chapters[1].orientation).toBe('landscape');
    const sec = d.chapters[1].children.find(isSection) as Section; expect(sec.children.some((c) => c.k === 'table')).toBe(true);
    expect(all(h.root, '.jss-ch-no').map((e) => e.textContent?.startsWith('Chapter'))).toEqual([true, true]);
    expect(await validate(h.ed.getXml())).toEqual([]);
  });

  it('a chapter\'s title is typed over and saved; a chapter can be moved and deleted, with the numbers following', async () => {
    const h = mount(FREE, opts()); h.ed.getDoc();
    q(h.root, '[data-testid="jss-add-chapter"]').click(); await tick();
    const second = all(h.root, '.jss-ch-title')[1]; second.textContent = 'Connection Box (CB)'; second.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.ed.getDoc().chapters[1].title).toBe('Connection Box (CB)');
    q(all(h.root, '.jss-ch-tools')[1], 'button[title="Move this chapter up"]').click(); await tick();
    expect(h.ed.getDoc().chapters.map((c) => [c.number, c.title])).toEqual([[1, 'Connection Box (CB)'], [2, 'Power Output Cabinet (POC)']]);
    expect(h.ed.getXml()).toContain('<chapter number="1"'); expect(await validate(h.ed.getXml())).toEqual([]);
  });

  it('the table dialog offers the stencil\'s parts table under its assembly section, with the head the stencil has', async () => {
    const h = mount(FREE, opts()); const sec = all(h.root, '.jss-sec-title')[0]; sec.focus();
    h.ed.exec('table', { rows: 1, cols: 1 });                                      // programmatic path stays a plain table
    expect(h.ed.getDoc().chapters[0].children.some((c) => isSection(c) && c.children.some((x) => x.k === 'table'))).toBe(true);
    q(h.root, '[data-cmd="table"]').click(); await tick();
    const dlg = q(h.root, '.jss-dialog'); const kind = q<HTMLSelectElement>(dlg, 'select');
    expect(Array.from(kind.options).map((o) => o.textContent)).toHaveLength(2);
    kind.value = '0'; kind.dispatchEvent(new Event('change')); q(dlg, '.jss-btn.primary').click(); await tick();
    const tables = all(h.root, 'table.jss-table'); expect(tables.length).toBeGreaterThanOrEqual(2);
    const fromStencil = tables.find((t) => t.textContent?.includes('Cct Ref.')); expect(fromStencil).toBeTruthy();
    expect(await validate(h.ed.getXml())).toEqual([]);
  });

  it('a read-only view shows none of the controls', () => {
    const h = mount(FREE, opts(), true);
    expect(all(h.root, '.jss-ch-tools')).toHaveLength(0); expect(all(h.root, '[data-testid="jss-add-chapter"]')).toHaveLength(0);
    expect(q(h.root, '.jss-ch-title').getAttribute('contenteditable')).not.toBe('true');
  });
});

describe('the editor for a type whose chapters the stencil fixes', () => {
  const FIXED = wrap('naval-uhb', `    <chapter number="1" id="c1"><title>Leading Particulars and General Data</title><section id="s1"><title>Purpose</title></section></chapter>`);
  it('has no chapter controls and keeps the title locked', () => {
    const h = mount(FIXED);
    expect(all(h.root, '.jss-ch-tools')).toHaveLength(0); expect(all(h.root, '[data-testid="jss-add-chapter"]')).toHaveLength(0);
    expect(all(h.root, '.jss-ch-title').every((e) => e.getAttribute('contenteditable') !== 'true')).toBe(true);
  });
});

describe.skipIf(!have)('the editor for a type whose sections the stencil fixes (Complete Equipment Schedule)', () => {
  it('locks the section titles and structure, and still lets the rows of the stencil tables be filled and extended', async () => {
    const ces = typeOf('naval-ces');
    const xml = wrap('naval-ces', `    <chapter number="1" id="c1"><title>Complete Equipment Schedule</title>
      <section id="s1"><title>Details of System</title></section>
    </chapter>`);
    const h = mount(xml, { sectionsFixed: true, tableTemplates: registry!.tableTemplatesOf(ces) });
    const title = q(h.root, '.jss-sec-title'); expect(title.getAttribute('contenteditable')).not.toBe('true');
    expect(all(h.root, '.jss-sec-tools')).toHaveLength(0);
    q(h.root, '[data-cmd="section"]').click(); await tick();
    expect(document.querySelector('.jss-menu button:not([disabled])')).toBeNull();
  });
});

describe.skipIf(!have)('the editor offers the table that belongs under the section the caret is in', () => {
  it('a section named like a stencil table\'s section preselects that table', async () => {
    const ces = typeOf('naval-ces'); const templates = registry!.tableTemplatesOf(ces);
    expect(templates.length).toBeGreaterThan(1);
    const accessories = templates.findIndex((t) => t.forSection === 'Accessories'); expect(accessories).toBeGreaterThanOrEqual(0);
    const xml = wrap('naval-ces', `    <chapter number="1" id="c1"><title>Complete Equipment Schedule</title><section id="s1"><title>Accessories</title><para>Text</para></section></chapter>`);
    const h = mount(xml, { sectionsFixed: true, tableTemplates: templates });
    const p = q(h.root, '.jss-block[data-kind="para"] [data-edit]'); p.focus();
    const range = document.createRange(); range.selectNodeContents(p); const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(range);
    q(h.root, '[data-cmd="table"]').click(); await tick();
    const kind = q<HTMLSelectElement>(q(h.root, '.jss-dialog'), 'select'); expect(Number(kind.value)).toBe(accessories);
  });
});
