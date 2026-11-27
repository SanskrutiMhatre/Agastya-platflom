'use strict';
// Word in, ancillary pages and the sample: the importer reads a handbook written in the JSG Word styles; the bundled sample is a real filled handbook; the front matter can be
// switched off page by page; the certificate counts the pages the build printed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { boot, tmp } = require('./helpers');
const { readPdf, pdfText } = require('./pdftools');
const { ZipStreamWriter } = require('../dist/services/zipio');

const PW = 'Correct-Horse-9!';
let h; let w;
test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda', role: 'author' });
  w = new h.Client('wanda'); await w.post('/api/auth/login', { username: 'wanda', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'wanda', password: PW });
});
test.after(async () => { await h.close(); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const run = (t, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const para = (style, inner, ppr = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${ppr}</w:pPr>${inner}</w:p>`;
const cell = (t, extra = '') => `<w:tc><w:tcPr>${extra}</w:tcPr>${para('', run(t))}</w:tc>`;
const picture = `<w:r><w:drawing><wp:inline><wp:extent cx="3600000" cy="1800000"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const docxBody = [
  para('', run('DT-1/TEST', '<w:b/><w:sz w:val="28"/>'), '<w:jc w:val="right"/>'),
  para('', run('USER HANDBOOK', '<w:b/><w:color w:val="3333FF"/><w:sz w:val="36"/>'), '<w:jc w:val="center"/>'),
  para('', run('TEST BRIDGE', '<w:b/><w:color w:val="3333FF"/><w:sz w:val="36"/>'), '<w:jc w:val="center"/>'),
  para('', run('A/T or S/O No.: 123/AB', '<w:sz w:val="28"/>'), '<w:jc w:val="center"/>'),
  para('', run('WARNING', '<w:b/><w:color w:val="0000FF"/><w:sz w:val="28"/>'), '<w:jc w:val="center"/>'),
  para('', run('1. Switch off before servicing.', '<w:color w:val="FF0000"/>')), para('', run('2. Keep clear of the load.', '<w:color w:val="FF0000"/>')),
  para('', run('PREFACE', '<w:b/><w:color w:val="0000FF"/><w:sz w:val="28"/>'), '<w:jc w:val="center"/>'),
  para('ListParagraph', run('This handbook is a test.')),
  para('Section', run('GENERAL DESCRIPTION')),
  para('Heading1', run('PREPARATION FOR USE')),
  para('Heading2', run('General')),
  para('L2-Para', run('Plain ') + run('bold', '<w:b/>') + run(' and ') + run('x', '<w:vertAlign w:val="superscript"/>') + run('.')),
  para('L2-alphanumbering', run('First point')), para('L2-alphanumbering', run('Second point')),
  para('L3-romanlist', run('Roman one')),
  para('Caption', run('Table 1: Specs')),
  `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('No.')}${cell('Item')}</w:tr><w:tr>${cell('1', '<w:vMerge w:val="restart"/>')}${cell('Span')}</w:tr><w:tr>${cell('', '<w:vMerge/>')}${cell('Load')}</w:tr></w:tbl>`,
  para('', picture), para('Caption', run('Figure 1: Plate'), '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>'),          // the portrait section ends here; the next one is landscape
  para('Heading1', run('WIDE FIGURES')),
  para('Heading2', run('Layout')), para('L2-Para', run('A landscape page follows.'), '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/></w:sectPr>'),
  para('Heading1', run('APPENDICES')),
  para('', run('APPENDIX ‘H’'), '<w:jc w:val="right"/>'), para('', run('SYSTEM SPECIFICATION'), '<w:jc w:val="center"/>'), para('L2-Para', run('Appendix text.')),
].join('');
const makeDocx = async () => {
  const f = path.join(tmp('wordtest-'), 'handbook.docx'); const z = new ZipStreamWriter(fs.createWriteStream(f));
  await z.addBuffer('word/document.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${docxBody}</w:body></w:document>`));
  await z.addBuffer('word/_rels/document.xml.rels', Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="image" Target="media/plate.png"/></Relationships>'));
  await z.addBuffer('word/media/plate.png', PNG); await z.finish(); return f;
};

const create = async (name, body = {}) => {
  const r = await w.post('/api/projects', { name, format: 'jsg', domain: 'land', manualType: 'uhb', ...body }); assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.project.id, U: `/api/projects/${r.json.project.id}`, dir: path.join(h.ws, 'projects', r.json.project.id) };
};
// The stencil sets some titles letter-spaced as literal text ("C E R T I F I C A T E" in jsg-uhb.xsl and jsg-ispl.xsl); the order checks
// read such a title as one word, so they look for the page and not for a spelling. The PDF is read with pdf.js (test/pdftools.js), which keeps
// the curly quotes of "APPX ‘A’" as they are printed.
const text = async (pdf) => (await pdfText(pdf))
  .replace(/\b(?:[A-Z] ){3,}[A-Z]\b/g, (m) => m.replace(/ /g, ''));
const pages = async (pdf) => (await readPdf(pdf)).pageCount;

test('Import from Word: the JSG styles become chapters, sections, clauses, paragraphs with marks, lists, a table with a merged cell, a captioned figure, a landscape section and an appendix', async () => {
  const p = await create('Word in');
  const docx = await makeDocx();
  const form = new FormData(); form.append('file', new Blob([fs.readFileSync(docx)]), 'handbook.docx');
  const r = await w.req('POST', `${p.U}/jsg/import-docx`, form); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
  assert.equal(r.json.report.errors, 0, JSON.stringify(r.json.report.findings.slice(0, 4))); assert.equal(r.json.pictures, 1);
  const xml = (await w.get(`${p.U}/jsg`)).json.xml;
  assert.match(xml, /<docNo>DT-1\/TEST<\/docNo>/); assert.match(xml, /<projectName>TEST BRIDGE<\/projectName>/); assert.match(xml, /<atNo>123\/AB<\/atNo>/);
  assert.match(xml, /<warning>\s*<item>Switch off before servicing\.<\/item>\s*<item>Keep clear of the load\.<\/item>/, 'the numbering typed in Word is not kept');
  assert.match(xml, /<chapter title="General Description">/, 'a title typed in capitals is stored as words');
  assert.match(xml, /<section title="Preparation for Use">/);
  assert.match(xml, /<clause title="General">/); assert.match(xml, /Plain <b>bold<\/b> and <sup>x<\/sup>\./);
  assert.match(xml, /<list type="alpha">/); assert.match(xml, /<list type="roman" indent="3">/);
  assert.match(xml, /<table title="Specs" widths="1000 3000">/); assert.match(xml, /rowspan="2"/);
  assert.match(xml, /<figure title="Plate">\s*<graphic src="Media\/plate\.png" width="100mm"\/>/, 'a picture keeps the size it had in Word');
  assert.match(xml, /<section title="Wide Figures" orientation="landscape">/);
  assert.match(xml, /<appendix label="H" title="System Specification">/);
  assert.ok(fs.existsSync(path.join(p.dir, 'Media', 'plate.png')), 'the picture is in the project');
  assert.ok(fs.existsSync(path.join(p.dir, 'jsg-document.before-import.bak')), 'the document it replaced is kept');
  assert.equal((await w.post(`${p.U}/jsg/build`, {})).status, 200, 'and the result builds');
  // not a Word file
  const bad = new FormData(); bad.append('file', new Blob([Buffer.from('plain')]), 'x.txt'); assert.equal((await w.req('POST', `${p.U}/jsg/import-docx`, bad)).json.code, 'NOT_DOCX');
});

const sampleThere = fs.existsSync(path.join(__dirname, '..', 'samples', 'jsg-uhb', 'jsg-document.xml'));
test('the JSG sample project: a real filled handbook that validates, builds, prints its ancillary pages in the real order and counts its own pages', { skip: !sampleThere && 'the sample is not installed', timeout: 600000 }, async () => {
  const r = await w.post('/api/projects/sample-jsg', {}); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 300));
  const U = `/api/projects/${r.json.project.id}`; const dir = path.join(h.ws, 'projects', r.json.project.id);
  const doc = (await w.get(`${U}/jsg`)).json; assert.equal(doc.report.errors, 0, JSON.stringify(doc.report.findings.slice(0, 3)));
  assert.match(doc.xml, /<associated intro="Modular Bridge System has following associated handbooks:">/); assert.match(doc.xml, /<certificate>/);
  assert.equal((await w.post(`${U}/jsg/build`, {})).status, 200);
  const pdf = path.join(dir, 'jsg-output.pdf'); const t = (await text(pdf)).replace(/\s+/g, ' ');
  const at = (s) => t.indexOf(s);
  assert.ok(at('CERTIFICATE') > 0 && at('CERTIFICATE') < at('ASSOCIATED HANDBOOKS') && at('ASSOCIATED HANDBOOKS') < at('AMENDMENTS') && at('AMENDMENTS') < at('WARNING') && at('WARNING') < at('FIRST AID IN CASE OF ELECTRICAL SHOCK') && at('FIRST AID IN CASE OF ELECTRICAL SHOCK') < at('ABBREVIATIONS') && at('ABBREVIATIONS') < at('PREFACE') && at('PREFACE') < at('LIST OF FIGURES'), 'the real handbook\'s order');
  const total = await pages(pdf);
  assert.match(t, new RegExp(`contains ${total} pages which have been serially numbered from \\(i\\) to \\([ivxlc]+\\) as ancillary pages and from 1 to \\d+ as main content`), 'the certificate cites the page count the build printed');
  assert.match(t, /CQAE\/UH\/E2\/24\/1A contains/, 'and the document number');
  assert.match(t, /Sr\. Document Title Document No\. Remark/, 'the associated handbooks table');
  // switching pages off: the page goes, the content stays in the file
  const off = doc.xml.replace('<front>', '<front omit="demolition associated listOfTables">');
  assert.equal((await w.put(`${U}/jsg`, { xml: off, baseHash: (await w.get(`${U}/jsg`)).json.hash })).json.report.errors, 0);
  assert.equal((await w.post(`${U}/jsg/build`, {})).status, 200);
  const t2 = (await text(pdf)).replace(/\s+/g, ' ');
  assert.ok(!t2.includes('DEMOLITION OF EQUIPMENT') && !t2.includes('ASSOCIATED HANDBOOKS') && !t2.includes('LIST OF TABLES'), 'pages switched off are not printed');
  assert.ok(t2.includes('CERTIFICATE') && t2.includes('AMENDMENTS') && t2.includes('LIST OF FIGURES'), 'the others still are');
  assert.match((await w.get(`${U}/jsg`)).json.xml, /<associated /, 'the content of a switched-off page is kept');
});

const isplThere = fs.existsSync(path.join(__dirname, '..', 'samples', 'jsg-ispl', 'jsg-document.xml'));
test('the ISPL sample: a real filled spare parts list that validates, prints the stencil\'s pages and appendices, and follows the ancillary checklist', { skip: !isplThere && 'the ISPL sample is not installed', timeout: 600000 }, async () => {
  const r = await w.post('/api/projects/sample-jsg', { kind: 'ispl' }); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 300));
  const U = `/api/projects/${r.json.project.id}`; const dir = path.join(h.ws, 'projects', r.json.project.id);
  assert.equal(r.json.project.manualType, 'ispl');
  const doc = (await w.get(`${U}/jsg`)).json; assert.equal(doc.docType, 'ispl'); assert.equal(doc.report.errors, 0, JSON.stringify(doc.report.findings.slice(0, 3)));
  assert.ok((doc.xml.match(/<plate /g) || []).length >= 15 && (doc.xml.match(/<appendix /g) || []).length === 7 && /<note><b>Note:?<\/b>:? Above mentioned quantity/.test(doc.xml), 'plates, appendices A-G and the notes under the tables');
  assert.equal((await w.post(`${U}/jsg/build`, {})).status, 200);
  const pdf = path.join(dir, 'jsg-output.pdf'); const t = (await text(pdf)).replace(/\s+/g, ' ');
  const at = (s) => t.indexOf(s);
  assert.ok(at('CERTIFICATE') > 0 && at('CERTIFICATE') < at('PREFACE') && at('PREFACE') < at('AMENDMENTS') && at('AMENDMENTS') < at('ABBREVIATIONS') && at('ABBREVIATIONS') < at('LIST OF EQUIPMENT ALREADY') && at('LIST OF EQUIPMENT ALREADY') < at('CONTENTS') && at('CONTENTS') < at('APPENDICES'), 'the stencil\'s order');
  assert.ok(at('APPX ‘A’') > at('APPENDICES') && at('APPX ‘G’') > at('APPX ‘F’'), 'the appendices');
  assert.match(t, /contains \d+ pages which have been serially numbered/, 'the certificate cites the page count');
  // the checklist: pages switched off are not printed, their content stays
  const off = doc.xml.replace('<front>', '<front omit="certificate preface supplied">');
  assert.equal((await w.put(`${U}/jsg`, { xml: off, baseHash: (await w.get(`${U}/jsg`)).json.hash })).json.report.errors, 0);
  assert.equal((await w.post(`${U}/jsg/build`, {})).status, 200);
  const t2 = (await text(pdf)).replace(/\s+/g, ' ');
  assert.ok(!t2.includes('CERTIFICATE') && !t2.includes('PREFACE') && !t2.includes('LIST OF EQUIPMENT ALREADY'), 'pages switched off are not printed');
  assert.ok(t2.includes('AMENDMENTS') && t2.includes('ABBREVIATIONS') && t2.includes('CONTENTS'), 'the others still are');
  assert.match((await w.get(`${U}/jsg`)).json.xml, /<preface>/, 'the content of a switched-off page is kept');
});
