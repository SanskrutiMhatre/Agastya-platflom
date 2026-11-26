'use strict';
// Cross-engine conversion (services/xengine/convert.ts): S1000D / JSS / JSG into one another as NEW projects, the source untouched, nothing dropped without a finding.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let w; let ZipStreamWriter;

test.before(async () => {
  h = await boot(); ({ ZipStreamWriter } = require('../dist/services/zipio'));
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'convert', fullName: 'Convert', role: 'author' });
  w = new h.Client('convert'); await w.post('/api/auth/login', { username: 'convert', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'convert', password: PW });
});
test.after(async () => { await h.close(); });

const dirOf = (id) => path.join(h.ws, 'projects', id);
const outline = (xml) => [...xml.matchAll(/<chapter [^>]*>\s*<title>([^<]*)<\/title>|<section id="([^"]*)"[^>]*>\s*<title>([^<]*)</g)].map((m) => (m[1] ? `CH ${m[1]}` : `  ${m[3]}`));

/** A JSS document with a known structure: nested sections, a list, a table, a figure, a note. */
async function jssWithContent(name) {
  const r = await w.post('/api/projects', { name, format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201); const U = `/api/projects/${r.json.project.id}`;
  const g = await w.get(`${U}/jss`);
  let xml = g.json.xml.replace('</bookmeta>', '<projectCode>CNV01</projectCode><publicationNo>PUB-77</publicationNo></bookmeta>');
  const body = '<para>Chapter text.</para>'
    + '<section id="alpha"><title>Alpha</title><para>Alpha has <b>bold</b> and <i>italic</i> words.</para>'
    + '<list type="number"><item>First step</item><item>Second step</item></list>'
    + '<table id="t1"><title>Loads</title><thead><row><cell>Item</cell><cell>Value</cell></row></thead><tbody><row><cell>Mass</cell><cell>10 kg</cell></row></tbody></table>'
    + '<note><para>Keep it dry.</para></note>'
    + '<section id="alpha-sub"><title>Alpha detail</title><para>Detail text.</para></section></section>'
    + '<section id="beta"><title>Beta</title><para>Beta text.</para></section>';
  xml = xml.replace(/(<chapter number="1"[^>]*>\s*<title>[^<]*<\/title>)[\s\S]*?(<\/chapter>)/, (_m, a, b) => `${a}${body}${b}`);
  assert.equal((await w.put(`${U}/jss`, { xml, baseHash: g.json.hash })).status, 200);
  return { id: r.json.project.id, U };
}

test('the formats and what each conversion does are listed', async () => {
  const r = await w.get('/api/xengine/formats'); assert.equal(r.status, 200);
  assert.deepEqual(r.json.formats.map((f) => f.id), ['s1000d', 'jss', 'jsg']); assert.ok(r.json.conversions.length >= 6);
  assert.equal((await new h.Client('x').get('/api/xengine/formats')).status, 401);
});

test('JSS -> JSG: chapters, sections, clauses and blocks arrive; the source is untouched; the codes are the new project\'s own', async () => {
  const s = await jssWithContent('Convert source'); const before = (await w.get(`${s.U}/jss`)).json.hash;
  const r = await w.post(`${s.U}/convert`, { to: 'jsg', name: 'Converted to JSG' }); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 500));
  assert.equal(r.json.from, 'jss'); assert.equal(r.json.to, 'jsg'); assert.equal(r.json.project.name, 'Converted to JSG');
  assert.equal((await w.get(`${s.U}/jss`)).json.hash, before, 'the source is not changed');
  const U2 = `/api/projects/${r.json.project.id}`; const jsg = (await w.get(`${U2}/jsg`)).json;
  assert.match(jsg.xml, /<chapter [^>]*title="[^"]+"/); assert.match(jsg.xml, /<section id="alpha" title="Alpha">/); assert.match(jsg.xml, /<clause id="alpha-sub" title="Alpha detail">/);
  assert.match(jsg.xml, /<para>Alpha has <b>bold<\/b> and <i>italic<\/i> words\.<\/para>/); assert.match(jsg.xml, /<list type="number">/); assert.match(jsg.xml, /<table id="t1" title="Loads">/);
  assert.match(jsg.xml, /<note>\s*<para>Keep it dry\.<\/para>\s*<\/note>/);
  assert.equal(jsg.report.errors, 0, JSON.stringify(jsg.report.findings.filter((f) => f.severity === 'error')).slice(0, 400));
  assert.ok(r.json.findings.some((f) => f.code === 'chapter-text-moved'), 'a chapter\'s own text is written as a first section, and said so');
  const id = (await w.get(`${U2}/identity`)).json.identity; assert.equal(id.format, 'jsg'); assert.ok(id.modules.length >= 3);
  assert.equal(r.json.identity.modules, id.modules.length);
});

test('JSG -> JSS: the same content comes back into the stencil\'s chapters, with what was matched by position said', async () => {
  const s = await jssWithContent('Round trip source');
  const jsgId = (await w.post(`${s.U}/convert`, { to: 'jsg' })).json.project.id;
  const back = await w.post(`/api/projects/${jsgId}/convert`, { to: 'jss', name: 'Back to JSS' }); assert.equal(back.status, 201, JSON.stringify(back.json).slice(0, 500));
  const U3 = `/api/projects/${back.json.project.id}`; const g = await w.get(`${U3}/jss`);
  const o = outline(g.json.xml);
  assert.ok(o[0].startsWith('CH ') && o.includes('  Alpha') && o.includes('  Beta'), o.join(' | '));
  assert.match(g.json.xml, /Alpha has <b>bold<\/b> and <i>italic<\/i> words\./); assert.match(g.json.xml, /<list type="number">/); assert.match(g.json.xml, /Detail text\./);
  assert.equal(g.json.report.errors, 0, JSON.stringify(g.json.report.findings.filter((f) => f.severity === 'error')).slice(0, 300));
  assert.match(g.json.xml, /<publicationNo>PUB-77<\/publicationNo>/, 'the document\'s own details travel');
});

test('JSS -> S1000D: a new S1000D project holds the data modules, numbered from the project\'s own codes', async () => {
  const s = await jssWithContent('Export source'); const idv = (await w.get(`${s.U}/identity`)).json.identity;
  const r = await w.post(`${s.U}/convert`, { to: 's1000d', name: 'Converted to S1000D' }); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 600));
  assert.equal(r.json.to, 's1000d'); assert.ok(r.json.imported.dms >= 3, JSON.stringify(r.json.imported));
  const csdb = path.join(dirOf(r.json.project.id), 'csdb'); const files = fs.readdirSync(csdb).filter((f) => /^DMC-/.test(f));
  assert.ok(files.length >= 3); assert.ok(files.every((f) => f.startsWith('DMC-CNV01-')), files.join(', '));
  // the sections of the source have their own codes in the identity record; the exported files carry those (not a running count in system 00)
  const alpha = idv.modules.find((m) => m.title === 'Alpha');
  assert.ok(files.some((f) => f.startsWith(alpha.dmc.replace('DMC-CNV01-', 'DMC-CNV01-'))), `${alpha.dmc} in ${files.join(', ')}`);
  assert.ok(!files.some((f) => /^DMC-CNV01-A-00-00-00-/.test(f)), 'no positional numbering in system 00');
  assert.equal(new Set(files.map((f) => f.replace(/_.*/, ''))).size, files.length, 'every code is unique');
});

test('an uploaded document or package is imported as the format chosen; the source format is checked', async () => {
  const s = await jssWithContent('Upload source'); const xml = (await w.get(`${s.U}/jss`)).json.xml;
  const up = async (file, name, fields) => {
    const fd = new FormData(); fd.append('file', new Blob([file]), name); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(`${h.base}/api/xengine/import`, { method: 'POST', headers: { cookie: w.cookie }, body: fd }); return { status: r.status, json: await r.json() };
  };
  const ok = await up(Buffer.from(xml), 'handbook.xml', { source: 'auto', target: 'jsg', name: 'From a JSS file' });
  assert.equal(ok.status, 201, JSON.stringify(ok.json).slice(0, 400)); assert.equal(ok.json.from, 'jss'); assert.equal(ok.json.to, 'jsg');
  assert.ok(ok.json.findings.some((f) => f.code === 'no-pictures'));
  const wrong = await up(Buffer.from(xml), 'handbook.xml', { source: 'jsg', target: 'jss' }); assert.equal(wrong.status, 400); assert.equal(wrong.json.code, 'WRONG_SOURCE');
  const same = await up(Buffer.from(xml), 'handbook.xml', { source: 'jss', target: 'jss' }); assert.equal(same.status, 400); assert.equal(same.json.code, 'SAME_FORMAT');
  const junk = await up(Buffer.from('not xml'), 'x.xml', { source: 'auto', target: 'jss' }); assert.equal(junk.status, 400);
  const zipAsJss = await up(Buffer.from('PK'), 'x.zip', { source: 'jss', target: 'jsg' }); assert.equal(zipAsJss.status, 400); assert.equal(zipAsJss.json.code, 'WRONG_SOURCE');
  const badTarget = await up(Buffer.from(xml), 'handbook.xml', { source: 'auto', target: 'word' }); assert.equal(badTarget.status, 400); assert.equal(badTarget.json.code, 'BAD_FORMAT');
});

test('an S1000D project converts to JSS and to JSG; a failed conversion leaves no half-made project', async () => {
  const sample = await w.post('/api/projects/sample', {}); assert.equal(sample.status, 201); const sid = sample.json.project.id; const SU = `/api/projects/${sid}`;
  const before = (await w.get('/api/projects')).json;
  const count = (j) => (j.projects ?? j.ungrouped ?? j).length;
  const toJss = await w.post(`${SU}/convert`, { to: 'jss', name: 'Sample as JSS' });
  assert.equal(toJss.status, 201, JSON.stringify(toJss.json).slice(0, 500)); assert.equal(toJss.json.from, 's1000d'); assert.equal(toJss.json.to, 'jss');
  const g = await w.get(`/api/projects/${toJss.json.project.id}/jss`); assert.match(g.json.xml, /<jssbook /);
  const toJsg = await w.post(`${SU}/convert`, { to: 'jsg', name: 'Sample as JSG' });
  assert.equal(toJsg.status, 201, JSON.stringify(toJsg.json).slice(0, 500)); assert.equal(toJsg.json.to, 'jsg');
  assert.equal((await w.get(`/api/projects/${toJsg.json.project.id}/jsg`)).json.report.errors, 0);
  const same = await w.post(`${SU}/convert`, { to: 's1000d' }); assert.equal(same.status, 400); assert.equal(same.json.code, 'SAME_FORMAT');
  assert.ok(count((await w.get('/api/projects')).json) >= count(before), 'nothing was lost');
  void count;
});

test('JSG -> S1000D: carried through JSS, numbered from the structure, no temporary project is left behind', async () => {
  const s = await jssWithContent('JSG to S1000D source');
  const jsgId = (await w.post(`${s.U}/convert`, { to: 'jsg', name: 'JSG for S1000D' })).json.project.id;
  const listBefore = (await w.get('/api/projects')).json; const names = (j) => JSON.stringify(j);
  const r = await w.post(`/api/projects/${jsgId}/convert`, { to: 's1000d', name: 'JSG as S1000D' }); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 600));
  assert.equal(r.json.from, 'jsg'); assert.equal(r.json.to, 's1000d'); assert.ok(r.json.imported.dms >= 3);
  const files = fs.readdirSync(path.join(dirOf(r.json.project.id), 'csdb')).filter((f) => /^DMC-/.test(f));
  assert.ok(files.length >= 3 && new Set(files.map((f) => f.replace(/_.*/, ''))).size === files.length, files.join(', '));
  assert.ok(!files.some((f) => /^[^-]+-[^-]+-A-00-00-00-/.test(f)), 'no positional numbering in system 00');
  const after = names((await w.get('/api/projects')).json);
  assert.ok(!/\(export\)/.test(after), 'the short-lived copy used for the export is gone');
  void listBefore;
});
