// The ISPL page preview: it must lay pages out the way the JSG engine does (same pages, same numbering, same table columns and widths), and follow the model as it is edited.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { emptyFront, newPart, newPlate, type JsgDoc, type PartRow, type Plate } from './model';
import { W10, W11, childrenOf, columnsOf, mountIsplPreview, paginateParts, platePages, plateCaption, renderPage, rowHeightMm } from './ispl-preview';

const part = (i: number, extra: Partial<PartRow> = {}): PartRow => ({ ...newPart(String(i).padStart(2, '0')), plateRef: `I-A/${i}`, provide: 'P', nsn: `14/5420-72-058-${7000 + i}`, designation: `ASSY ${i}`, qty: '2', qtySet: '3', drg: 'AIF41', price: '1,000', ...extra });
function doc(): JsgDoc {
  const p1: Plate = { ...newPlate('I', 'General Assembly'), divider: true, setColumn: true, caption: 'GENERAL ASSY OF 100M BRIDGE' };
  p1.views[0].caption = 'VIEW 1'; p1.views[0].graphics = [{ src: 'Media/a.png' }]; p1.views[0].parts = [part(1), part(2)];
  const p2: Plate = { ...newPlate('I-A', 'Bridging System'), setColumn: true };
  p2.views[0].graphics = [{ src: 'Media/b.png', label: 'I-A/1' }, { src: 'Media/c.png', label: 'I-A/2' }]; p2.views[0].parts = [part(1)];
  const p3: Plate = { ...newPlate('I-B', 'Anchoring') }; p3.views[0].parts = [part(1)];
  const p4: Plate = { ...newPlate('I-A/1', 'Pontoon') }; p4.views[0].parts = [part(1)];
  return { version: '1.0', type: 'ispl', meta: { projectName: 'bridge', qtyUnit: 'for 100m', classification: 'RESTRICTED' }, supplier: [], issuedBy: [], front: emptyFront(), chapters: [], appendices: [], plates: [p1, p2, p3, p4] };
}
const url = (s: string): string => `/img/${s}`;

describe('ISPL page preview', () => {
  it('pages are the engine\'s: a divider page (first plate), then per view a picture page and a table page, numbered from 1 across plates', () => {
    const d = doc();
    expect(platePages(d, 0).map((p) => [p.kind, p.n])).toEqual([['divider', 1], ['picture', 2], ['table', 3]]);
    expect(platePages(d, 1).map((p) => [p.kind, p.n])).toEqual([['picture', 4], ['table', 5]]);
    expect(platePages(d, 3).map((p) => p.n)).toEqual([8, 9]);            // numbering continues through the plates before it
    d.plates[1].views[0].parts = [];                                        // a view without parts has no table page
    expect(platePages(d, 1).map((p) => p.kind)).toEqual(['picture']);
  });

  it('the column set and the widths are the engine\'s (read from jsg-ispl.xsl itself, so the two cannot drift)', () => {
    const xsl = fs.readFileSync(path.resolve(__dirname, '../../../backend/schemas/jsg/engine/jsg-ispl.xsl'), 'utf8');
    const nums = (name: string) => [...(new RegExp(`name="${name}">(.*?)</xsl:variable>`, 's').exec(xsl)?.[1] ?? '').matchAll(/<w>(\d+)<\/w>/g)].map((m) => Number(m[1]));
    expect(W11).toEqual(nums('widths11')); expect(W10).toEqual(nums('widths10'));
    expect(columnsOf(true)).toHaveLength(11); expect(columnsOf(false)).toHaveLength(10);
    expect(columnsOf(false).map((c) => c.key)).not.toContain('qtySet');
  });

  it('a table page: 11 columns with the unit in the header, the stencil\'s header, RESTRICTED head and foot, the page number', () => {
    const d = doc(); const spec = platePages(d, 0)[2];
    const page = renderPage(spec, d, 'RESTRICTED', url);
    expect(page.querySelectorAll('th')).toHaveLength(11);
    const heads = Array.from(page.querySelectorAll('th')).map((t) => t.textContent);
    expect(heads).toContain('No. Off (for 100m)'); expect(heads).toContain('No. Off (For 1 Set)'); expect(heads[2]).toBe('‘P’Provide');
    expect(page.querySelectorAll('tr')).toHaveLength(3);                    // header + 2 parts
    expect(page.querySelector('.h')?.textContent).toBe('RESTRICTED(3)'); expect(page.querySelector('.f')?.textContent).toBe('RESTRICTED');
    expect(page.querySelector('.cap')?.textContent).toBe('GENERAL ASSY OF 100M BRIDGE');
    const ten = renderPage(platePages(d, 2)[1], d, 'RESTRICTED', url);
    expect(ten.querySelectorAll('th')).toHaveLength(10);
    expect(Array.from(ten.querySelectorAll('th')).map((t) => t.textContent)).toContain('No. Off');
    expect(plateCaption(d.plates[1])).toBe('PLATE – I-A BRIDGING SYSTEM');
  });

  it('a picture page: the plate caption, the picture(s) with their labels, the red view caption, and the index on the divider plate (its children only)', () => {
    const d = doc();
    const first = renderPage(platePages(d, 0)[1], d, 'RESTRICTED', url);
    expect(first.querySelector('.vcap')?.textContent).toBe('VIEW 1');
    expect(first.querySelector('img')?.getAttribute('src')).toBe('/img/Media/a.png');
    const idx = Array.from(first.querySelectorAll('table tr td:first-child')).map((t) => t.textContent);
    expect(idx).toEqual(['I-A', 'I-B']);                                    // not I-A/1: the engine's rule
    expect(childrenOf(d, d.plates[0]).map((p) => p.ref)).toEqual(['I-A', 'I-B']);
    const grid = renderPage(platePages(d, 1)[0], d, 'RESTRICTED', url);
    expect(grid.querySelectorAll('img')).toHaveLength(2); expect(grid.textContent).toContain('I-A/1'); expect(grid.textContent).toContain('I-A/2');
    const divider = renderPage(platePages(d, 0)[0], d, 'RESTRICTED', url);
    expect(divider.textContent).toContain('PLATE – I'); expect(divider.textContent).toContain('GENERAL ASSEMBLY'); expect(divider.textContent).toContain('BRIDGE');
  });

  it('a long table continues on further pages; a long designation makes its row taller', () => {
    const many = Array.from({ length: 80 }, (_, i) => part(i + 1));
    const pages = paginateParts(many, true);
    expect(pages.length).toBeGreaterThan(1); expect(pages.flat()).toHaveLength(80);
    expect(pages[0].length).toBeGreaterThan(15); expect(pages[0].length).toBeLessThan(40);
    expect(rowHeightMm(part(1, { designation: 'GARWARE ROPE 12 MM DIA. 150 M LONG WITH THIMBLE AND TWO SHACKLES' }), true)).toBeGreaterThan(rowHeightMm(part(1), true));
    const d = doc(); d.plates[1].views[0].parts = many;
    const specs = platePages(d, 1); expect(specs.filter((s) => s.kind === 'table').length).toBe(pages.length); expect(specs[specs.length - 1].continued).toBe(true);
  });

  it('text from the grid is escaped, not interpreted', () => {
    const d = doc(); d.plates[1].views[0].parts = [part(1, { designation: '<img src=x onerror=alert(1)> & "q"' })];
    const page = renderPage(platePages(d, 1)[1], d, 'RESTRICTED', url);
    expect(page.querySelectorAll('img')).toHaveLength(0); expect(page.textContent).toContain('<img src=x onerror=alert(1)> & "q"');
  });

  it('the mounted preview follows the model: edit a part, update, and the page shows it', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const picks: number[] = [];
    const h = mountIsplPreview(host, url, (i) => picks.push(i));
    const d = doc(); h.update(d, 1);
    expect(host.querySelectorAll('.jsg-pv-page')).toHaveLength(2);
    expect(host.textContent).toContain('ASSY 1');
    d.plates[1].views[0].parts[0].designation = 'RENAMED IN THE GRID'; h.update(d, 1);
    expect(host.textContent).toContain('RENAMED IN THE GRID');
    const sel = host.querySelector('select') as HTMLSelectElement; expect(sel.options).toHaveLength(4);
    sel.value = '2'; sel.dispatchEvent(new Event('change')); expect(picks).toEqual([2]);
    h.update(d, 2); expect(host.textContent).toContain('ANCHORING');
    h.destroy(); expect(host.innerHTML).toBe('');
  });
});
