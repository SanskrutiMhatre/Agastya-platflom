// The JSS editor's logic: reading and writing the XML, the numbering the pipeline prints, and the structural edits.
// The XML the editor writes is also checked against the real schema (backend/schemas/jss/jss-1.0.xsd) with the same validator the server uses.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { parseJss, serializeJss, JssParseError } from './xml';
import { alphaLabel, effectiveListType, itemLabel, numberDocument, romanLabel } from './numbering';
import { addColumn, addItem, addRow, canIndentSection, checkWidths, columnCount, deleteColumn, deleteRow, hasSpans, indentItem, indentSection, locate, move, outdentItem, outdentSection, removeItem, toggleHeader, headingLevel } from './ops';
import { inlineText, isSection, newList, newSection, newTable, para, type Inline, type JssDoc, type List, type Section, type Table } from './model';

const RICH = `<?xml version="1.0" encoding="UTF-8"?>
<jssbook docType="uhb" schemaVersion="1.0">
  <bookmeta>
    <bookName>User Handbook</bookName>
    <systemName>AKASH &amp; CO</systemName>
    <codeNo>DT0042</codeNo>
    <revNo>R2</revNo>
  </bookmeta>
  <body>
    <chapter number="1" id="c1"><title>Leading Particulars and General Data</title>
      <para>Chapter text with <b>bold</b>, <i>italic</i>, <u>underline</u>, x<sup>2</sup>, H<sub>2</sub>O and a <xref to="t1"/>.</para>
      <section id="s1"><title>Purpose</title>
        <para align="center">Centred &lt;text&gt; &amp; more</para>
        <list type="alpha">
          <item>First<list type="roman">
            <item>one</item>
            <item>two</item>
          </list></item>
          <item><para>Second as a paragraph</para></item>
        </list>
        <table id="t1" widths="20mm 1* 2*"><title>Specs</title>
          <thead>
            <row>
              <cell>No.</cell>
              <cell>Attribute</cell>
              <cell align="right">Value</cell>
            </row>
          </thead>
          <tbody>
            <row>
              <cell>1</cell>
              <cell><b>Weight</b></cell>
              <cell>2400 kg</cell>
            </row>
          </tbody>
        </table>
        <figure id="f1"><title>Plate</title>
          <graphic src="Media/plate.png" width="40mm"/>
          <legend>
            <keyitem num="1">Switch</keyitem>
          </legend>
        </figure>
        <note>
          <para>Mind the gap</para>
        </note>
        <pageBreak/>
        <section id="s2" orientation="landscape"><title>Wide</title>
          <para>Landscape section</para>
        </section>
      </section>
    </chapter>
    <chapter number="2" id="c2"><title>Second</title></chapter>
  </body>
</jssbook>
`;

const doc = (): JssDoc => parseJss(RICH);

describe('reading and writing the XML', () => {
  it('reads everything the schema allows, keeping it', () => {
    const d = doc();
    expect(d.docType).toBe('uhb');
    expect(d.meta).toEqual({ bookName: 'User Handbook', systemName: 'AKASH & CO', codeNo: 'DT0042', revNo: 'R2' });
    expect(d.chapters.map((c) => [c.number, c.title])).toEqual([[1, 'Leading Particulars and General Data'], [2, 'Second']]);
    const sec = d.chapters[0].children.find(isSection)!;
    expect(sec.title).toBe('Purpose');
    expect(sec.children.map((c) => c.k)).toEqual(['para', 'list', 'table', 'figure', 'note', 'pageBreak', 'section']);
    const list = sec.children[1] as List;
    expect(list.items[0].parts.map((p) => p.k)).toEqual(['inline', 'list']);
    expect(list.items[1].parts.map((p) => p.k)).toEqual(['para']);
    const table = sec.children[2] as Table;
    expect(table.widths).toBe('20mm 1* 2*'); expect(table.head).toHaveLength(1); expect(table.body[0].cells[0].parts).toEqual([{ k: 'inline', inline: [{ t: 'text', text: '1' }] }]);
    expect(inlineText((sec.children[0] as unknown as { inline: Inline[] }).inline)).toBe('Centred <text> & more');
    expect((sec.children[6] as Section).orientation).toBe('landscape');
  });

  it('writes what it read, and writing is stable', () => {
    const once = serializeJss(doc());
    const twice = serializeJss(parseJss(once));
    expect(twice).toBe(once);
    expect(parseJss(once)).toEqual(doc());
    expect(once).toContain('<para>Chapter text with <b>bold</b>, <i>italic</i>, <u>underline</u>, x<sup>2</sup>, H<sub>2</sub>O and a <xref to="t1"/>.</para>');
    expect(once).toContain('<systemName>AKASH &amp; CO</systemName>');
    expect(once).toContain('<para align="center">Centred &lt;text&gt; &amp; more</para>');
  });

  it('adds no whitespace to mixed content, where whitespace is part of the text', () => {
    const out = serializeJss(doc());
    expect(out).toContain('<item>First<list type="roman">');         // text runs straight into the nested list
    expect(out).toContain('<cell><b>Weight</b></cell>');
    expect(out).not.toMatch(/<para>\s+\S/);
  });

  it('leaves out empty optional identity fields but always keeps the title', () => {
    const d = doc(); d.meta = { bookName: 'X', systemName: '  ', nsn: '' };
    const out = serializeJss(d);
    expect(out).toContain('<bookName>X</bookName>'); expect(out).not.toContain('systemName'); expect(out).not.toContain('nsn');
  });

  it('refuses what the schema does not have, naming it, rather than dropping it', () => {
    const bad = (from: string, to: string) => () => parseJss(RICH.replace(from, to));
    expect(bad('<b>bold</b>', '<blink>bold</blink>')).toThrow(JssParseError);
    expect(bad('<b>bold</b>', '<blink>bold</blink>')).toThrow(/blink/);
    expect(bad('<list type="alpha">', '<list type="greek">')).toThrow(/greek/);
    expect(bad('widths="20mm 1* 2*"', 'width="20mm"')).toThrow(/width/);
    expect(bad('<section id="s1">', '<section id="s1" style="x">')).toThrow(/style/);
    expect(bad('<pageBreak/>', '<hr/>')).toThrow(/hr/);
    expect(() => parseJss('<jssbook docType="uhb"><body></jssbook>')).toThrow(/well-formed/);
    expect(() => parseJss('<book/>')).toThrow(/not <jssbook>/);
    expect(bad('<title>Purpose</title>', '')).toThrow(/title/);
  });

  it('reads the starting document the server writes for a new project', () => {
    const skeleton = `<?xml version="1.0" encoding="UTF-8"?>
<jssbook docType="mm" schemaVersion="1.0">
  <bookmeta>
    <bookName>Technical Manual Part II Maintenance</bookName>
    <systemName></systemName>
    <month>November</month>
    <year>2026</year>
  </bookmeta>
  <body>
    <chapter number="1" id="c1"><title>Inspection and Maintenance Routine</title>
      <section id="s2"><title>Importance of Routine Maintenance</title></section>
    </chapter>
  </body>
</jssbook>`;
    const d = parseJss(skeleton);
    expect(d.chapters[0].children).toHaveLength(1);
    // an empty field is written as no element, so it comes back as no key
    expect(parseJss(serializeJss(d))).toEqual({ ...d, meta: { bookName: d.meta.bookName, month: 'November', year: '2026' } });
  });
});

describe('what the editor writes is valid against the real schema', () => {
  const root = path.resolve(__dirname, '..', '..', '..', 'backend');
  const xsd = path.join(root, 'schemas', 'jss', 'jss-1.0.xsd');
  const available = fs.existsSync(xsd) && fs.existsSync(path.join(root, 'node_modules', 'xmllint-wasm'));
  (available ? it : it.skip)('a document with every construct validates', async () => {
    const { validateXML } = createRequire(path.join(root, 'package.json'))('xmllint-wasm');
    const check = async (xml: string) => (await validateXML({ xml: [{ fileName: 'd.xml', contents: xml }], schema: [{ fileName: 'jss-1.0.xsd', contents: fs.readFileSync(xsd, 'utf8') }] })) as { valid: boolean; errors: Array<{ message: string }> };
    const out = serializeJss(doc());
    const r = await check(out);
    expect(r.errors.map((e) => e.message)).toEqual([]); expect(r.valid).toBe(true);
    // and the check is real: a document the editor never writes is refused by the same schema
    expect((await check(out.replace('<title>Purpose</title>', ''))).valid).toBe(false);
    // a table made by the editor's own constructor
    const d = doc(); (d.chapters[0].children.find(isSection) as Section).children.unshift(newTable(2, 3, 't9'));   // content goes ahead of the sub-section, as the editor puts it
    expect((await check(serializeJss(d))).valid).toBe(true);
  });
});

describe('numbering, as the pipeline prints it', () => {
  it('numbers headings by position, tables and figures per chapter counting only captioned ones', () => {
    const d = doc(); const n = numberDocument(d); const ch = d.chapters[0]; const s1 = ch.children.find(isSection)!; const s2 = s1.children.find(isSection) as Section;
    expect(n.heading.get(ch)).toBe('1'); expect(n.heading.get(s1)).toBe('1.1'); expect(n.heading.get(s2)).toBe('1.1.1');
    expect(n.label.get('t1')).toBe('Table 1-1'); expect(n.label.get('f1')).toBe('Figure 1-1'); expect(n.label.get('s2')).toBe('Wide');
    expect(n.targets.map((t) => t.id)).toEqual(['s1', 't1', 'f1', 's2']);
    // an uncaptioned table takes no number and is not a target
    const t = newTable(1, 1, 'tx'); s1.children.push(t); (s1.children[2] as Table).title = '';
    const m = numberDocument(d);
    expect(m.caption.has(t)).toBe(false); expect(m.label.has('t1')).toBe(false); expect(m.label.has('tx')).toBe(false);
    // and the next captioned one is Table 1-1 again
    t.title = 'After'; expect(numberDocument(d).caption.get(t)).toBe('Table 1-1');
  });

  it('restarts the counts in every chapter', () => {
    const d = doc(); const second = d.chapters[1]; const t = newTable(1, 1, 'tt'); t.title = 'Other'; second.children.push(t);
    expect(numberDocument(d).caption.get(t)).toBe('Table 2-1');
  });

  it('labels lists as the pipeline does: letters skip i, o and v; wrap after z', () => {
    expect([1, 2, 8, 9, 10, 11].map(alphaLabel)).toEqual(['a', 'b', 'h', 'j', 'k', 'l']);
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 't', 'u', 'w', 'x', 'y', 'z']).toEqual(Array.from({ length: 23 }, (_, i) => alphaLabel(i + 1)));
    expect(alphaLabel(24)).toBe('aa'); expect(alphaLabel(25)).toBe('ab');
    expect([1, 2, 3, 4, 9, 14].map(romanLabel)).toEqual(['i', 'ii', 'iii', 'iv', 'ix', 'xiv']);
    const l: List = newList(undefined, 1);
    expect([1, 2, 3, 4].map((d) => effectiveListType(l, d))).toEqual(['alpha', 'roman', 'bullet', 'bullet']);
    expect(effectiveListType(newList('number'), 1)).toBe('number');
    expect(itemLabel('alpha', 3)).toBe('(c)'); expect(itemLabel('roman', 2)).toBe('(ii)'); expect(itemLabel('number', 5)).toBe('5.');
  });
});

describe('structural edits', () => {
  const sections = (d: JssDoc) => d.chapters[0].children.filter(isSection) as Section[];
  const withSections = (): JssDoc => { const d = doc(); d.chapters[0].children = [newSection('A', 'a'), newSection('B', 'b'), newSection('C', 'c')]; return d; };

  it('nests a section under the one before it, and brings it back out after its parent', () => {
    const d = withSections(); const [a, b, c] = sections(d);
    expect(canIndentSection(d, a, 5)).toBe(false);                      // nothing before it
    expect(indentSection(d, b, 5)).toBe(true);
    expect(sections(d)).toEqual([a, c]); expect(a.children).toEqual([b]); expect(headingLevel(d, b)).toBe(3);
    expect(outdentSection(d, b)).toBe(true);
    expect(sections(d).map((s) => s.title)).toEqual(['A', 'B', 'C']);
    expect(outdentSection(d, a)).toBe(false);                           // already at the top of its chapter
  });

  it("never nests deeper than the stencil's deepest heading", () => {
    const d = withSections(); const [a, b] = sections(d);
    expect(indentSection(d, b, 5)).toBe(true);                          // B under A: heading level 3
    const b1 = newSection('B1'); const b2 = newSection('B2'); b.children.push(b1, b2);   // level 4 each
    expect(canIndentSection(d, b2, 4)).toBe(false);                     // under B1 it would be level 5
    expect(indentSection(d, b2, 4)).toBe(false); expect(b.children).toEqual([b1, b2]);   // refused, nothing moved
    expect(canIndentSection(d, b2, 5)).toBe(true);
    expect(indentSection(d, b2, 5)).toBe(true); expect(headingLevel(d, b2)).toBe(5);
    expect(a.children).toEqual([b]);
  });

  it('moves, and refuses to move past the ends', () => {
    const arr = [1, 2, 3];
    expect(move(arr, 0, -1)).toBe(false); expect(move(arr, 0, 1)).toBe(true); expect(arr).toEqual([2, 1, 3]); expect(move(arr, 2, 1)).toBe(false);
    const d = withSections(); const [a] = sections(d);
    expect(locate(d, a)).toMatchObject({ index: 0 });
  });

  it('edits tables without breaking the grid', () => {
    const t = newTable(2, 3, 't');
    expect(columnCount(t)).toBe(3);
    expect(addRow(t, 'body', 0, 'below')).toBe(true); expect(t.body).toHaveLength(3); expect(t.body[1].cells).toHaveLength(3);
    expect(addColumn(t, 1, 'after')).toBe(true); expect(columnCount(t)).toBe(4); expect([...t.head, ...t.body].every((r) => r.cells.length === 4)).toBe(true);
    expect(deleteColumn(t, 0)).toBe(true); expect(columnCount(t)).toBe(3);
    expect(deleteRow(t, 'body', 0)).toBe(true); expect(deleteRow(t, 'body', 0)).toBe(true); expect(deleteRow(t, 'body', 0)).toBe(false);   // the body keeps one row
    t.widths = '20mm 1* 1*'; addColumn(t, 0, 'before'); expect(t.widths).toBeUndefined();        // widths named the old columns
    expect(toggleHeader(t)).toBe(true); expect(t.head).toHaveLength(0);
    const bare = newTable(1, 2); bare.head = []; expect(toggleHeader(bare)).toBe(false);          // a one-row table cannot give up its only body row
    const two = newTable(2, 2); two.head = []; expect(toggleHeader(two)).toBe(true); expect(two.head).toHaveLength(1); expect(two.body).toHaveLength(1);
  });

  it('will not edit the grid of a table with merged cells', () => {
    const t = newTable(2, 3); t.body[0].cells[0].colspan = 2; t.body[0].cells.splice(1, 1);
    expect(hasSpans(t)).toBe(true);
    expect(addRow(t, 'body', 0, 'below')).toBe(false); expect(addColumn(t, 0, 'after')).toBe(false); expect(deleteColumn(t, 0)).toBe(false); expect(deleteRow(t, 'body', 0)).toBe(false);
  });

  it('checks column widths against the table', () => {
    const t: Table = newTable(1, 3);
    expect(checkWidths(t, '')).toBeNull(); expect(checkWidths(t, '20mm 1* 2*')).toBeNull();
    expect(checkWidths(t, '20mm 1*')).toMatch(/3 columns; you gave 2/); expect(checkWidths(t, '20 mm')).toMatch(/millimetres/); expect(checkWidths(t, '1* x 2*')).toMatch(/millimetres/);
  });

  it('nests and un-nests list items', () => {
    const l = newList('alpha', 3); l.items.forEach((it, i) => { it.parts = [{ k: 'inline', inline: [{ t: 'text', text: `i${i}` }] }]; });
    expect(indentItem(l, 0)).toBe(false);                               // nothing before it
    expect(indentItem(l, 1, 'roman')).toBe(true);
    expect(l.items).toHaveLength(2); const sub = l.items[0].parts[1] as List; expect(sub.k).toBe('list'); expect(sub.type).toBe('roman'); expect(sub.items).toHaveLength(1);
    expect(indentItem(l, 1)).toBe(true); expect((l.items[0].parts[1] as List).items).toHaveLength(2);   // joins the existing sub-list
    expect(outdentItem(l, 0, sub, 1)).toBe(true); expect(l.items).toHaveLength(2); expect(sub.items).toHaveLength(1);
    expect(outdentItem(l, 0, sub, 0)).toBe(true); expect(l.items[0].parts.some((p) => p.k === 'list')).toBe(false);   // an emptied sub-list goes
    const it = addItem(l, 0); expect(l.items[1]).toBe(it);
    expect(removeItem(newList('alpha', 1), 0)).toBe(false);
  });

  it('para() builds an empty or filled paragraph', () => { expect(para('x').inline).toHaveLength(1); expect(para().inline).toHaveLength(0); });
});
