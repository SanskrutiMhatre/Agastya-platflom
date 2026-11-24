// The JSG model and XML code: a document survives a round trip unchanged, what the editor writes is valid against the JSG schema, and anything the schema does not allow is
// refused on reading rather than silently dropped.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { validateXML } from 'xmllint-wasm';
import { emptyFront, newClause, newFigure, newList, newNotice, newPara, newPart, newPlate, newTable, parentRef, type Block, type JsgDoc } from './model';
import { JsgParseError, parseJsg, serializeJsg } from './xml';
import { inlineHtml, readInline } from './editor';

const XSD = fs.readFileSync(path.resolve(__dirname, '../../../backend/schemas/jsg/jsg-1.0.xsd'), 'utf8');
const check = async (xml: string) => (await validateXML({ xml: [{ fileName: 'd.xml', contents: xml }], schema: [{ fileName: 'jsg-1.0.xsd', contents: XSD }] })).errors.map((e: { message: string }) => e.message);

function sample(): JsgDoc {
  const f = emptyFront();
  f.has.warning = true; f.warning = [[{ t: 'text', text: 'Do not ' }, { t: 'mark', mark: 'b', children: [{ t: 'text', text: 'touch' }] }]];
  f.has.abbreviations = true; f.abbreviations = [{ short: 'BEM', long: 'Bridge End Module' }];
  f.has.amendments = true; f.amendments = [{ no: '1', page: '5', para: '2.1', required: 'text & <more>', authority: 'A/1', date: '', by: '' }];
  f.has.preface = true; f.preface = [newPara('This handbook provides information.')];
  const table = newTable(3, 3, 'Technical Specifications');
  const list = newList('step', 2); list.items[0].parts = [{ k: 'text', inline: [{ t: 'text', text: 'Switch off.' }] }];
  const fig = newFigure('Modular Bridge'); fig.graphics = [{ src: 'Media/bridge.png' }];
  const blocks: Block[] = [newPara('Text with H', 3), list, table, fig, newNotice('warning'), { k: 'pageBreak' }];
  const clause = newClause('General'); clause.children = [...blocks, { ...newClause('Sub heading') }];
  return {
    version: '1.0', type: 'uhb', meta: { docNo: 'CQAE/UH/E2/24/1A', title: 'USER HANDBOOK', projectName: 'MODULAR BRIDGE', classification: 'RESTRICTED' },
    supplier: ['LARSEN & TOUBRO LIMITED,', 'PUNE 410507 INDIA'], issuedBy: ['GOVERNMENT OF INDIA'], front: f,
    chapters: [{ k: 'chapter', title: 'General Description', sections: [{ k: 'section', title: 'Introduction', orientation: 'portrait', children: [clause] }, { k: 'section', title: 'Wide', orientation: 'landscape', children: [newPara('x')] }] }],
    appendices: [{ k: 'appendix', label: 'H', title: 'System Specification', orientation: 'portrait', children: [newPara('Appendix text')] }], plates: [],
  };
}

describe('JSG model and XML', () => {
  it('what the editor writes is valid against the JSG schema', async () => {
    const xml = serializeJsg(sample());
    expect(await check(xml)).toEqual([]);
  });

  it('a figure without a picture is a draft error (the author is told to choose one), not silently accepted', async () => {
    const d = sample(); const c = d.chapters[0].sections[0].children[0] as { children: Block[] };
    c.children = [newFigure('No picture yet')];
    expect((await check(serializeJsg(d))).join(' ')).toMatch(/figure/);
  });

  it('a document survives a round trip unchanged', () => {
    const once = serializeJsg(sample());
    const twice = serializeJsg(parseJsg(once));
    expect(twice).toBe(once);
    const back = parseJsg(once);
    expect(back.chapters[0].sections[1].orientation).toBe('landscape');
    expect(back.front.amendments[0].required).toBe('text & <more>');
    expect(back.supplier).toEqual(['LARSEN & TOUBRO LIMITED,', 'PUNE 410507 INDIA']);
  });

  it('the starting document the server makes opens and writes back valid', async () => {
    const skeleton = `<?xml version="1.0" encoding="UTF-8"?>\n<jsgdoc version="1.0" type="uhb"><meta><docNo></docNo><title>USER HANDBOOK</title><supplier></supplier><issuedBy><line>GOVERNMENT OF INDIA</line></issuedBy></meta>
<front><amendments minRows="20"/><warning><item></item></warning><abbreviations/></front>
<chapter id="c1" title="General Description"><section id="s1" title="Introduction"><clause id="k1" title="General"><para/></clause></section></chapter>
<appendices><appendix id="a1" label="H" title="System Specification"><para/></appendix></appendices></jsgdoc>`;
    const doc = parseJsg(skeleton);
    expect(doc.chapters).toHaveLength(1); expect(doc.front.has.amendments).toBe(true); expect(doc.front.has.preface).toBe(false);
    expect(await check(serializeJsg(doc))).toEqual([]);
  });

  it('refuses what it cannot represent instead of dropping it', () => {
    expect(() => parseJsg('<jss/>')).toThrow(JsgParseError);
    expect(() => parseJsg('<jsgdoc version="1.0" type="uhb"><meta><title>t</title></meta><bogus/></jsgdoc>')).toThrow(/not allowed in a document/);
    expect(() => parseJsg('<jsgdoc version="1.0" type="uhb"><meta><title>t</title><x/></meta></jsgdoc>')).toThrow(/not a cover field/);
    expect(() => parseJsg('<jsgdoc version="1.0" type="mrls"><meta><title>t</title></meta></jsgdoc>')).toThrow(/unknown document type/);
    expect(parseJsg('<jsgdoc version="1.0" type="ispl"><meta><title>t</title></meta><plates/></jsgdoc>').type).toBe('ispl');
    expect(() => parseJsg('<jsgdoc')).toThrow(/not well-formed/);
  });

  it('reads what the browser makes of typing: marks, line breaks, blocks', () => {
    const d = document.createElement('div');
    d.innerHTML = 'one <b>two</b> <i><u>three</u></i><br>four<div>five</div>';
    const inl = readInline(d);
    expect(inl.map((i) => i.t)).toEqual(['text', 'mark', 'text', 'mark', 'br', 'text', 'br', 'text']);
    // and back to HTML and again
    const e = document.createElement('div'); e.innerHTML = inlineHtml(inl);
    expect(readInline(e)).toEqual(inl);
    expect(inlineHtml([{ t: 'text', text: 'a < b & "c"' }])).toBe('a &lt; b &amp; &quot;c&quot;');
  });
});

describe('JSG ISPL model and XML', () => {
  function ispl(): JsgDoc {
    const f = emptyFront();
    f.has.certificate = true; f.certificate = [{ t: 'text', text: 'Certified that this document no. ' }, { t: 'mark', mark: 'b', children: [{ t: 'text', text: 'CQAE/IL/14/27/A' }] }, { t: 'text', text: ' contains 89 pages.' }];
    f.has.preface = true; f.preface = [newPara('This ISPL has been prepared.'), newPara('When demanding spare parts:'), { ...newList('alpha', 2), indent: 3 }, newPara('(NOTE - Army only).', 3)];
    f.has.amendments = true; f.amendmentsMinRows = 20; f.amendments = [{ no: '1', page: '', para: '', required: '', authority: 'A/1', date: '2026', by: 'RK' }];
    f.has.abbreviations = true; f.abbreviations = [{ short: 'IFBF', long: 'Infantry Foot Bridge Floating' }];
    f.has.supplied = true; f.supplied = { equipment: '100 Meter Infantry Foot Bridge Floating', rows: [{ no: '1', dcan: '14/5420', name: 'Bridge', order: 'SO/1' }] };
    const p = newPlate('I', 'General Assembly'); p.divider = true; p.setColumn = true; p.caption = 'GENERAL ASSY OF 100M';
    p.views[0].caption = 'VIEW 1'; p.views[0].graphics = [{ src: 'Media/a.png', label: 'I-B/1' }, { src: 'Media/b.png' }];
    p.views[0].parts = [{ ...newPart('01'), plateRef: 'I-A/1', provide: 'P', nsn: '14/5420-72-058-7193', designation: 'PONTOON ASSY <1>', qty: '26', qtySet: '29', drg: 'AIF41', price: '204,930', remark: 'a & b' }];
    return { version: '1.0', type: 'ispl', meta: { title: 'ILLUSTRATED SPARE PARTS LIST (ISPL)', qtyUnit: 'for 100m', classification: 'RESTRICTED' }, supplier: [], issuedBy: ['GOVERNMENT OF INDIA'], front: f, chapters: [], appendices: [], plates: [p, newPlate('I-A', 'Bridging System')] };
  }

  it('an ISPL is valid against the JSG schema and survives a round trip', async () => {
    const xml = serializeJsg(ispl());
    expect(await check(xml)).toEqual([]);
    const back = parseJsg(xml);
    expect(serializeJsg(back)).toBe(xml);
    expect(back.type).toBe('ispl'); expect(back.plates).toHaveLength(2);
    expect(back.plates[0].views[0].parts[0].remark).toBe('a & b'); expect(back.plates[0].views[0].parts[0].designation).toBe('PONTOON ASSY <1>');
    expect(back.plates[0].views[0].graphics[0].label).toBe('I-B/1');
    expect(back.front.preface.map((p) => p.k)).toEqual(['para', 'para', 'list', 'para']);
    expect(back.meta.qtyUnit).toBe('for 100m');
  });

  it('plate references find their parent the way the server does', () => {
    expect(parentRef('I-A/1')).toBe('I-A'); expect(parentRef('I-A')).toBe('I'); expect(parentRef('I-B/2/9')).toBe('I-B/2'); expect(parentRef('I')).toBe('');
  });

  it('a plate that holds anything but views is refused', () => {
    expect(() => parseJsg('<jsgdoc version="1.0" type="ispl"><meta><title>t</title></meta><plates><plate ref="I" title="x"><part item="1" designation="d"/></plate></plates></jsgdoc>')).toThrow(/holds <view> only/);
  });
});
