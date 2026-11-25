'use strict';
// The JSG Illustrated Spare Parts List, end to end on the real server: create, validate, save, edit rules, build the PDF with the JSG engine, and the User Handbook's
// stencil details (artwork, colours) that the ISPL work made the engine take from the Word files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let w; let id; let dir; let uhbId;

const part = (i, extra = '') => `<part item="${String(i).padStart(2, '0')}" plateRef="I-A/${i}" provide="P" nsn="14/5420-72-058-71${90 + i}" designation="PONTOON ASSY ${i}" qty="${20 + i}" qtySet="${25 + i}" drg="AIF410000000${i}" price="${200000 + i}"${extra}/>`;
const PIC = 'Media/test-pic.png';

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'hari', fullName: 'Hari', role: 'author' });
  w = new h.Client('hari'); await w.post('/api/auth/login', { username: 'hari', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'hari', password: PW });
});
test.after(async () => { await h.close(); });

test('an ISPL project: its own source file, the stencil\'s standard preface, one plate to start, valid', async () => {
  const r = await w.post('/api/projects', { name: 'Jsg ISPL', format: 'jsg', domain: 'land', manualType: 'ispl' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); id = r.json.project.id; dir = path.join(h.ws, 'projects', id);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  assert.equal(pj.format, 'jsg'); assert.equal(pj.jsgDocType, 'ispl');
  assert.equal(fs.existsSync(path.join(dir, 'publication.xml')), false);
  const d = (await w.get(`/api/projects/${id}/jsg`)).json;
  assert.equal(d.docType, 'ispl'); assert.equal(d.report.errors, 0, JSON.stringify(d.report.findings));
  assert.equal((d.xml.match(/<para>/g) || []).length, 7, 'seven numbered preface paragraphs, as the stencil has');
  assert.match(d.xml, /Illustrated Spare Parts List|ILLUSTRATED SPARE PARTS LIST/);
  assert.match(d.xml, /<list type="alpha" indent="3">/); assert.match(d.xml, /Queries relating to this ISPL/);
  assert.match(d.xml, /<plate [^>]*ref="I"[^>]*divider="true"/);
});

test('the rules: duplicate plate references and chapters in an ISPL are errors; an orphan plate and a picture-less table are warnings', async () => {
  const doc = (await w.get(`/api/projects/${id}/jsg`)).json.xml;
  const dup = doc.replace('</plates>', '<plate ref="I" title="Again"><view/></plate></plates>');
  assert.ok((await w.post(`/api/projects/${id}/jsg/validate`, { xml: dup })).json.findings.some((f) => f.rule === 'JSG-PLATE-DUP' && f.severity === 'error'));
  const chapters = doc.replace('</plates>', '</plates><chapter title="x"/>');
  const rc = (await w.post(`/api/projects/${id}/jsg/validate`, { xml: chapters })).json;
  assert.ok(rc.errors > 0);
  const orphan = doc.replace('</plates>', `<plate ref="Z-A/1" title="Orphan"><view>${part(1)}</view></plate></plates>`);
  const ro = (await w.post(`/api/projects/${id}/jsg/validate`, { xml: orphan })).json;
  assert.ok(ro.findings.some((f) => f.rule === 'JSG-PLATE-PARENT' && f.severity === 'warning'));
  assert.ok(ro.findings.some((f) => f.rule === 'JSG-VIEW-NOPICTURE' && f.severity === 'warning'));
  assert.equal(ro.errors, 0, 'warnings never block');
  // a part without a designation is a schema error
  const bad = doc.replace('</plates>', '<plate ref="I-A" title="B"><view><part item="01"/></view></plate></plates>');
  assert.ok((await w.post(`/api/projects/${id}/jsg/validate`, { xml: bad })).json.errors > 0);
});

test('save and the PDF: plates, views, pictures with labels, the 11- and 10-column parts tables, the index and the contents', async () => {
  // pictures: the stencil's own artwork stands in for plate drawings
  fs.mkdirSync(path.join(dir, 'Media'), { recursive: true });
  const art = path.resolve(__dirname, '..', 'schemas', 'jsg', 'engine', 'assets');
  fs.copyFileSync(path.join(art, 'firstaid-1.png'), path.join(dir, 'Media', 'test-pic.png'));
  const doc = (await w.get(`/api/projects/${id}/jsg`)).json;
  let xml = doc.xml
    .replace('<qtyUnit></qtyUnit>', '<qtyUnit>for 100m</qtyUnit>')
    .replace('<docNo></docNo>', '<docNo>CQAE/IL/14/27/A</docNo>')
    .replace(/<plate id="p1"[\s\S]*<\/plates>/, `<plate id="p1" ref="I" title="General Assembly" divider="true" setColumn="true" caption="GENERAL ASSY OF 100M INFANTRY FOOT BRIDGE FLOATING"><view caption="GENERAL ASSEMBLY (VIEW 1)"><graphic src="${PIC}"/></view></plate>
      <plate ref="I-A" title="Bridging System" setColumn="true"><view caption="ISOMETRIC VIEW 1"><graphic src="${PIC}"/>${part(1)}${part(2)}${part(3)}</view></plate>
      <plate ref="I-B" title="Anchoring System" setColumn="true"><view caption="ANCHORING"><graphic src="${PIC}" label="I-B/1"/><graphic src="${PIC}" label="I-B/2"/><graphic src="${PIC}" label="I-B/3"/>${part(1)}</view></plate>
      <plate ref="I-A/1" title="Pontoon Assy"><view caption="PONTOON ASSY (VIEW 1)"><graphic src="${PIC}"/><part item="01" plateRef="I-A/1/1" provide="P" nsn="14/5340-72-058-3836" designation="BUCKLE MALE" qty="8" drg="AIFSTD0002800" price="1,450" remark="Item No 1 and 2 in Assembled Condition (Male Buckle Assy)"/></view></plate>
    </plates>`);
  const saved = await w.put(`/api/projects/${id}/jsg`, { xml, baseHash: doc.hash });
  assert.equal(saved.status, 200); assert.equal(saved.json.report.errors, 0, JSON.stringify(saved.json.report.findings));

  const b = await w.post(`/api/projects/${id}/jsg/build`);
  assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 600)); assert.ok(b.json.bytes > 8000);
  const pdf = await w.get(`/api/projects/${id}/jsg/pdf`); assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  const fo = fs.readFileSync(path.join(dir, 'jsg-output.fo'), 'utf8');
  for (const s of ['C E R T I F I C A T E', 'CQAE/IL/14/27/A', 'PREFACE', 'AMENDMENTS', 'ABBREVIATIONS', 'LIST OF EQUIPMENT ALREADY SUPPLIED AGAINST AT/SO', 'Nil', 'CONTENTS', 'PLATE – I-A BRIDGING SYSTEM',
    'GENERAL ASSY OF 100M INFANTRY FOOT BRIDGE FLOATING', 'ISOMETRIC VIEW 1', 'Plate Ref. No.', 'Designation', 'No. Off (for 100m)', 'No. Off (For 1 Set)', 'I-B/3', 'Item No.', '14/5340-72-058-3836']) {
    assert.ok(fo.includes(s), `the FO lacks "${s}"`);
  }
  // the stencil's column widths: 11 columns (2551 designation) on a plate with a set column, 10 (3119) without
  assert.ok(fo.includes('proportional-column-width(2551)') && fo.includes('proportional-column-width(3119)'));
  // landscape plate pages (296.9 x 210) with RESTRICTED in the foot and the page number under it in the head
  assert.match(fo, /master-name="l-page" page-width="296.9mm" page-height="210mm"/);
  // the plate index (children of the divider plate: I-A and I-B, not I-A/1)
  assert.match(fo, /<fo:table-cell[^>]*><fo:block[^>]*>I-A<\/fo:block><\/fo:table-cell><fo:table-cell[^>]*><fo:block[^>]*>Bridging System/);
  assert.equal((fo.match(/>Pontoon Assy</g) || []).length, 0, 'a sub-plate (I-A/1) is not in the index of plate I');
  // nothing of the other engines
  assert.equal(fs.existsSync(path.join(dir, '_jss-book.xml')), false); assert.equal(fs.existsSync(path.join(dir, 'jss-output.pdf')), false);
});

test('a viewer can open an ISPL but can neither save nor build it; a stranger does not even learn the project exists', async () => {
  const admin = new h.Client('admin2'); await admin.post('/api/auth/login', { username: 'admin', password: PW });
  const m = await admin.post('/api/team/users', { username: 'ivan', fullName: 'Ivan', role: 'author' });
  const v = new h.Client('ivan'); await v.post('/api/auth/login', { username: 'ivan', password: m.json.tempPassword }); await v.post('/api/auth/onboarding', { username: 'ivan', password: PW });
  assert.equal((await v.get(`/api/projects/${id}/jsg`)).status, 404, 'a non-member does not even learn the project exists');
  const share = await w.post(`/api/projects/${id}/assign`, { username: 'ivan', role: 'viewer' });
  assert.ok(share.status < 300, JSON.stringify(share.json));
  assert.equal((await v.get(`/api/projects/${id}/jsg`)).status, 200);
  const doc = (await v.get(`/api/projects/${id}/jsg`)).json;
  assert.equal((await v.put(`/api/projects/${id}/jsg`, { xml: doc.xml })).status, 403);
  assert.equal((await v.post(`/api/projects/${id}/jsg/build`)).status, 403);
});

test('the User Handbook takes its cover artwork and first-aid figures from the stencil, and sets its titles as the stencil does', async () => {
  const r = await w.post('/api/projects', { name: 'Jsg UHB art', format: 'jsg', domain: 'land', manualType: 'uhb' });
  uhbId = r.json.project.id; const d = path.join(h.ws, 'projects', uhbId);
  const doc = (await w.get(`/api/projects/${uhbId}/jsg`)).json;
  const xml = doc.xml.replace(/<warning>\s*<item><\/item>/, '<warning><item>Do not touch.</item>');          // the first of the stencil's six numbered lines
  assert.equal((await w.put(`/api/projects/${uhbId}/jsg`, { xml })).json.report.errors, 0);
  const b = await w.post(`/api/projects/${uhbId}/jsg/build`); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 400));
  const fo = fs.readFileSync(path.join(d, 'jsg-output.fo'), 'utf8');
  for (const f of ['emblem.png', 'supplier-logo.png', 'firstaid-1.png', 'firstaid-2.png', 'firstaid-3.png', 'firstaid-4.png']) assert.ok(fo.includes(f), `the FO does not use ${f}`);
  assert.match(fo, /content-height="40.2mm" content-width="30.2mm"/, 'the emblem is printed at the size of the Word drawing');
  assert.match(fo, /content-height="16.9mm" content-width="20.1mm"/, 'and the logo');
  // front-matter titles are bold blue 14 pt; the warning items are red; the appendix heading is right-aligned and underlined
  assert.match(fo, /font-weight="bold" font-size="14pt" color="#0000FF" text-align="center"[^>]*>AMENDMENTS/);
  assert.match(fo, /color="#FF0000"[^>]*><fo:list-item>.*Do not touch\./s);
  assert.match(fo, /text-align="right" font-weight="bold" color="#0000FF" text-decoration="underline"[^>]*>APPENDIX/);
  // the cover is followed by a blank verso
  assert.match(fo, /master-name="cover-seq"/); assert.match(fo, /master-reference="cover-seq"[^>]*force-page-count="end-on-even"/);
  for (const f of ['emblem.png', 'supplier-logo.png', 'firstaid-1.png', 'firstaid-4.png']) assert.ok(fs.existsSync(path.resolve(__dirname, '..', 'schemas', 'jsg', 'engine', 'assets', f)), `${f} ships with the engine`);
});
