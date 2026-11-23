// Two guarantees of the JSS model:
//   1. content order: a section's own content comes before its sub-sections, in the editor, in the XML, in the schema and in the PDF, so the file never says one thing and the PDF another;
//   2. merged cells: merging and splitting works on the table's real grid and can never leave a table the server would reject.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { parseJss, serializeJss } from './xml';
import { addRow, columnCount, deleteColumn, hasSpans, mergeCells, mergeCheck, placeCells, splitCell } from './ops';
import { inlineText, isSection, newTable, type Inline, type Section, type Table } from './model';

const BASE = `<?xml version="1.0" encoding="UTF-8"?>
<jssbook docType="uhb" schemaVersion="1.0">
  <bookmeta><bookName>User Handbook</bookName></bookmeta>
  <body>
    <chapter number="1" id="c1"><title>Leading Particulars and General Data</title>
      <section id="s1"><title>Purpose</title>
        <para>Own content</para>
        <section id="s2"><title>Sub</title></section>
      </section>
    </chapter>
  </body>
</jssbook>
`;

const root = path.resolve(__dirname, '..', '..', '..', 'backend');
const xsd = path.join(root, 'schemas', 'jss', 'jss-1.0.xsd');
const haveXsd = fs.existsSync(xsd) && fs.existsSync(path.join(root, 'node_modules', 'xmllint-wasm'));
const valid = async (xml: string): Promise<boolean> => {
  const { validateXML } = createRequire(path.join(root, 'package.json'))('xmllint-wasm');
  return ((await validateXML({ xml: [{ fileName: 'd.xml', contents: xml }], schema: [{ fileName: 'jss-1.0.xsd', contents: fs.readFileSync(xsd, 'utf8') }] })) as { valid: boolean }).valid;
};

describe('content order', () => {
  const LATE = BASE.replace('<section id="s2"><title>Sub</title></section>', '<section id="s2"><title>Sub</title></section>\n        <para>Late content</para>');

  it('reads content that follows a sub-section in the order the pipeline prints it, says so, and writes it that way', () => {
    expect(LATE).not.toBe(BASE);
    const d = parseJss(LATE); expect(d.reordered).toBe(true);
    const sec = d.chapters[0].children.find(isSection) as Section;
    expect(sec.children.map((c) => c.k)).toEqual(['para', 'para', 'section']);
    const out = serializeJss(d);
    expect(out.indexOf('Late content')).toBeLessThan(out.indexOf('<title>Sub</title>'));
    expect(parseJss(out).reordered).toBeUndefined();                       // written in order: nothing left to report
    expect(parseJss(BASE).reordered).toBeUndefined();
  });

  it('keeps the order of the content itself while moving it ahead of the sub-sections', () => {
    const d = parseJss(LATE); const sec = d.chapters[0].children.find(isSection) as Section;
    expect(sec.children.slice(0, 2).map((c) => inlineText((c as { inline: Inline[] }).inline))).toEqual(['Own content', 'Late content']);
  });

  (haveXsd ? it : it.skip)('the schema refuses the out-of-order file and accepts what the editor writes from it', async () => {
    expect(await valid(LATE)).toBe(false);
    expect(await valid(serializeJss(parseJss(LATE)))).toBe(true);
    expect(await valid(BASE)).toBe(true);
  });
});

describe('merging and splitting cells', () => {
  const t3 = (): Table => {
    const t = newTable(2, 3, 't');
    t.head[0].cells.forEach((c, i) => { c.parts = [{ k: 'inline', inline: [{ t: 'text', text: `h${i}` }] }]; });
    t.body.forEach((r, ri) => r.cells.forEach((c, ci) => { c.parts = [{ k: 'inline', inline: [{ t: 'text', text: `${ri}${ci}` }] }]; }));
    return t;
  };
  const cellText = (t: Table, r: number, c: number): string => inlineText((t.body[r].cells[c].parts[0] as { inline: Inline[] }).inline);
  /** Every slot of the grid is covered by exactly one cell. */
  const complete = (rows: Table['body']): boolean => {
    const placed = placeCells(rows);
    const total = Math.max(...placed.map((r) => r.reduce((m, p) => Math.max(m, p.gridCol + (p.cell.colspan ?? 1)), 0)));
    const seen: number[][] = rows.map(() => Array(total).fill(0));
    placed.forEach((r, ri) => r.forEach((p) => {
      for (let a = 0; a < (p.cell.rowspan ?? 1); a++) for (let b = 0; b < (p.cell.colspan ?? 1); b++) { if (ri + a >= rows.length) return; seen[ri + a][p.gridCol + b] += 1; }
    }));
    return seen.every((r) => r.every((n) => n === 1));
  };

  it('merges right: the colspan grows, the neighbour goes, and no text is lost', () => {
    const t = t3(); expect(mergeCheck(t, 'body', 0, 0, 'right')).toBeNull();
    expect(mergeCells(t, 'body', 0, 0, 'right')).toBe(true);
    expect(t.body[0].cells).toHaveLength(2); expect(t.body[0].cells[0].colspan).toBe(2);
    expect(cellText(t, 0, 0)).toBe('00\n01');                                       // joined with a line break so the two texts do not run together
    expect(complete(t.body)).toBe(true); expect(columnCount(t)).toBe(3);
  });

  it('merges down and splits back to the original grid, the text staying with the merged cell', () => {
    const t = t3(); expect(mergeCells(t, 'body', 0, 1, 'down')).toBe(true);
    expect(t.body[0].cells[1].rowspan).toBe(2); expect(t.body[1].cells).toHaveLength(2); expect(complete(t.body)).toBe(true);
    expect(splitCell(t, 'body', 0, 1)).toBe(true);
    expect(t.body[1].cells).toHaveLength(3); expect(t.body[0].cells[1].rowspan).toBeUndefined(); expect(complete(t.body)).toBe(true);
    expect(cellText(t, 1, 1)).toBe('');                                            // the cell that came back is empty
    expect(cellText(t, 0, 1)).toBe('01\n11');
  });

  it('refuses a merge that would break the grid, and says why', () => {
    const t = t3();
    expect(mergeCheck(t, 'body', 0, 2, 'right')).toMatch(/no cell to the right/);
    expect(mergeCheck(t, 'body', 1, 0, 'down')).toMatch(/no cell below/);
    expect(mergeCheck(t, 'head', 0, 0, 'down')).toMatch(/header/);                 // a header never merges into the body
    expect(mergeCheck(t, 'body', 5, 0, 'right')).toMatch(/Click in a cell/);
    mergeCells(t, 'body', 0, 0, 'down');                                           // column 0 is now two rows tall
    expect(mergeCheck(t, 'body', 0, 0, 'right')).toMatch(/not the same height/);
    const w = t3(); mergeCells(w, 'body', 1, 0, 'right');                          // row 1 now has a two-wide cell at column 0
    expect(mergeCheck(w, 'body', 0, 0, 'down')).toMatch(/not the same width/);
    expect(mergeCells(w, 'body', 0, 0, 'down')).toBe(false);
    expect(splitCell(newTable(1, 2), 'body', 0, 0)).toBe(false);                   // nothing to split
  });

  it('keeps every grid complete through any sequence of merges and splits (randomised, fixed seed)', () => {
    let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let round = 0; round < 40; round++) {
      const t = newTable(4, 4, 'r'); t.head = []; let acted = 0;
      for (let step = 0; step < 30; step++) {
        const row = rnd(t.body.length); const idx = rnd(t.body[row].cells.length); const op = rnd(3);
        const done = op === 0 ? mergeCells(t, 'body', row, idx, 'right') : op === 1 ? mergeCells(t, 'body', row, idx, 'down') : splitCell(t, 'body', row, idx);
        if (done) acted++;
        expect(complete(t.body)).toBe(true);
      }
      expect(acted).toBeGreaterThan(0);
    }
  });

  it('a merged table survives writing and reading unchanged, and its rows and columns are not edited around the merge', () => {
    const t = t3(); t.title = 'Merged'; mergeCells(t, 'body', 0, 0, 'right'); mergeCells(t, 'body', 0, 1, 'down');
    const d = parseJss(BASE); (d.chapters[0].children.find(isSection) as Section).children.unshift(t);
    const back = parseJss(serializeJss(d)); const sec = back.chapters[0].children.find(isSection) as Section;
    const t2 = sec.children.find((c) => c.k === 'table') as Table;
    expect(t2).toEqual(t); expect(complete(t2.body)).toBe(true);
    expect(hasSpans(t2)).toBe(true); expect(addRow(t2, 'body', 0, 'below')).toBe(false); expect(deleteColumn(t2, 0)).toBe(false);
    expect(splitCell(t2, 'body', 0, 0)).toBe(true);
  });

  (haveXsd ? it : it.skip)('a merged table is valid against the real schema', async () => {
    const t = t3(); mergeCells(t, 'body', 0, 0, 'right'); mergeCells(t, 'body', 0, 1, 'down'); t.title = 'Merged';
    const d = parseJss(BASE); (d.chapters[0].children.find(isSection) as Section).children.unshift(t);
    expect(await valid(serializeJss(d))).toBe(true);
  });
});
