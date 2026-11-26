'use strict';
// The S1000D metadata kept in the backend for JSS and JSG projects (services/xengine): document codes, publication code, picture names, contents list, visibility.
// Pure functions first (no server), then the routes with real JSS and JSG projects, then an imported package (when the RWI sample is present).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');
let outlineOfJss; let outlineOfJsg; let I;       // the backend's modules are loaded after boot() has set the throwaway workspace

const PW = 'Correct-Horse-9!';
const ch = (n, title, body) => `<chapter number="${n}"><title>${title}</title>${body}</chapter>`;
const sec = (title, body = '', id = '') => `<section${id ? ` id="${id}"` : ''}><title>${title}</title>${body}</section>`;
const fig = (src) => `<figure><title>F</title><graphic src="${src}"/></figure>`;
const jss = (chapters, meta = '<projectCode>abc12</projectCode>') => `<?xml version="1.0"?><jssbook docType="uhb" schemaVersion="1.0"><bookmeta>${meta}</bookmeta><body>${chapters.join('')}</body></jssbook>`;
const fresh = (xml) => { const o = outlineOfJss(xml); return { o, rec: I.emptyRecord(o, { format: 'jss', enterpriseCode: '1671Y' }) }; };
let h; let w;
test.before(async () => {
  h = await boot(); ({ outlineOfJss, outlineOfJsg } = require('../dist/services/xengine/outline')); I = require('../dist/services/xengine/identity'); const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'idena', fullName: 'Idena', role: 'author' }); w = new h.Client('idena');
  await w.post('/api/auth/login', { username: 'idena', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'idena', password: PW });
});
test.after(async () => { await h.close(); });

const codes = (rec) => rec.modules.filter((m) => !m.retired).map((m) => I.dmcString(m.code));

test('the outline: chapters, one module per top-level section, the chapter\'s own text, pictures and the contents list', () => {
  const o = outlineOfJss(jss([
    ch(1, 'General', `<para>intro</para>${fig('Media/A.png')}${sec('Purpose', `<para>x</para>${fig('Media/b.PNG')}`)}${sec('Features', sec('Deeper', '', 'deep'))}`),
    ch(2, 'Operation', sec('Start', '', 'start')),
  ]));
  assert.deepEqual(o.chapters.map((c) => c.title), ['General', 'Operation']);
  assert.deepEqual(o.modules.map((m) => [m.kind, m.title]), [['chapter-intro', 'General'], ['section', 'Purpose'], ['section', 'Features'], ['section', 'Start']]);
  assert.deepEqual(o.modules[0].pictures, ['a.png'], 'the chapter\'s own picture belongs to its introduction, not to a section');
  assert.deepEqual(o.modules[1].pictures, ['b.png'], 'a picture name is the file name, lower case');
  assert.equal(o.modules[3].key, 'id:start'); assert.equal(o.modules[1].key, 't:1:purpose');
  assert.deepEqual(o.toc.map((t) => `${t.number} ${t.title}`), ['1 General', '1.1 Purpose', '1.2 Features', '1.2.1 Deeper', '2 Operation', '2.1 Start']);
  assert.equal(o.toc.find((t) => t.title === 'Deeper').module, 't:1:features', 'a nested heading belongs to the module of its top-level section');
});

test('codes come from the structure: a chapter is a system, its sections are sub-systems, the same document always gets the same codes', () => {
  const xml = jss([ch(1, 'General', sec('Purpose') + sec('Features')), ch(3, 'Install', sec('Unpack'))]);
  const a = fresh(xml); I.reconcile(a.rec, a.o);
  const b = fresh(xml); I.reconcile(b.rec, b.o);
  assert.deepEqual(codes(a.rec), codes(b.rec), 'nothing random');
  assert.deepEqual(codes(a.rec), [
    'DMC-ABC12-A-01-10-00-00A-040A-D', 'DMC-ABC12-A-01-20-00-00A-040A-D', 'DMC-ABC12-A-03-10-00-00A-040A-D',
  ]);
  assert.equal(a.rec.modelIdentCode, 'ABC12', 'the model code is made from the document\'s Project code');
  assert.equal(I.pmcString(a.rec.modelIdentCode, a.rec.pm), 'PMC-ABC12-1671Y-00001-00');
  assert.equal(I.dmcFileName(a.rec.modules[0].code, a.rec.pm), 'DMC-ABC12-A-01-10-00-00A-040A-D_001-00_EN-IN.xml');
  assert.equal(a.rec.modules.length, new Set(codes(a.rec)).size, 'every code is unique');
  const intro = fresh(jss([ch(2, 'Intro', `<para>text</para>${sec('S')}`)])); I.reconcile(intro.rec, intro.o);
  assert.deepEqual(codes(intro.rec), ['DMC-ABC12-A-02-00-00-00A-040A-D', 'DMC-ABC12-A-02-10-00-00A-040A-D'].map((c) => c.replace('00-00-00A', '00-00-00A')), 'a chapter\'s own text is the system itself (sub-system 0, assembly 00)');
});

test('a code is made once: reordering, renaming, adding and removing sections never change the others; a removed code is never given away', () => {
  const v1 = fresh(jss([ch(1, 'G', sec('One') + sec('Two') + sec('Three'))])); I.reconcile(v1.rec, v1.o);
  const [one, two, three] = codes(v1.rec);
  // reordered
  I.reconcile(v1.rec, outlineOfJss(jss([ch(1, 'G', sec('Three') + sec('One') + sec('Two'))])));
  assert.deepEqual(codes(v1.rec), [one, two, three], 'reordering keeps every code');
  // one renamed (same chapter, same number of sections): matched by position
  const r = I.reconcile(v1.rec, outlineOfJss(jss([ch(1, 'G', sec('Three') + sec('Uno') + sec('Two'))])));
  assert.equal(r.added, 0); assert.equal(r.rekeyed, 1);
  assert.equal(v1.rec.modules.find((m) => m.title === 'Uno').code.subSystemCode, '1', 'a renamed section keeps its code');
  // one removed and one added: the new section does not take the removed code
  I.reconcile(v1.rec, outlineOfJss(jss([ch(1, 'G', sec('Three') + sec('Two'))])));
  assert.equal(v1.rec.modules.find((m) => m.title === 'Uno').retired, true, 'a removed section is retired, not forgotten');
  I.reconcile(v1.rec, outlineOfJss(jss([ch(1, 'G', sec('Three') + sec('Two') + sec('Four'))])));
  const four = v1.rec.modules.find((m) => m.title === 'Four');
  assert.notEqual(I.dmcString(four.code), one, 'the code of a removed section is not reused');
  assert.equal(four.code.subSystemCode, '4');
  // the removed section comes back: it gets its own code back
  I.reconcile(v1.rec, outlineOfJss(jss([ch(1, 'G', sec('Uno') + sec('Three') + sec('Two'))])));
  assert.equal(I.dmcString(v1.rec.modules.find((m) => m.title === 'Uno').code), one);
});

test('an id keeps a section\'s code through a rename, and a section moved to another chapter keeps its code', () => {
  const a = fresh(jss([ch(1, 'G', sec('Alpha', '', 'a1') + sec('Beta', '', 'b1')), ch(2, 'H', sec('Gamma', '', 'g1'))])); I.reconcile(a.rec, a.o);
  const alpha = I.dmcString(a.rec.modules.find((m) => m.key === 'id:a1').code);
  I.reconcile(a.rec, outlineOfJss(jss([ch(1, 'G', sec('Beta', '', 'b1')), ch(2, 'H', sec('Gamma', '', 'g1') + sec('Alpha renamed', '', 'a1'))])));
  assert.equal(I.dmcString(a.rec.modules.find((m) => m.key === 'id:a1').code), alpha, 'the code is the section\'s, not its place\'s');
  assert.equal(new Set(codes(a.rec)).size, a.rec.modules.length);
});

test('pictures: one ICN each, made from the section they first appear in, unique, a numbered picture name kept as it is', () => {
  const x = fresh(jss([ch(1, 'G', sec('S', fig('Media/photo.png') + fig('Media/ICN-RDR-A-A000000-1-1671Y-02145-A-001-04.png')) + sec('T', fig('Media/photo.png') + fig('Media/other.jpg')))]));
  I.reconcile(x.rec, x.o);
  const by = Object.fromEntries(x.rec.pictures.map((p) => [p.key, p]));
  assert.equal(by['photo.png'].icn, 'ICN-ABC12-A-011000-1-1671Y-00001-A-001-01'); assert.equal(by['photo.png'].file, 'ICN-ABC12-A-011000-1-1671Y-00001-A-001-01.png');
  assert.equal(by['other.jpg'].icn, 'ICN-ABC12-A-012000-1-1671Y-00002-A-001-01', 'the next number; the section that uses it names the system part');
  assert.equal(by['icn-rdr-a-a000000-1-1671y-02145-a-001-04.png'].origin, 'imported'); assert.equal(by['icn-rdr-a-a000000-1-1671y-02145-a-001-04.png'].icn, 'ICN-RDR-A-A000000-1-1671Y-02145-A-001-04');
  assert.equal(new Set(x.rec.pictures.map((p) => p.icn)).size, 3);
});

test('the identity can be changed in one place: the model code is rewritten in every generated code, an imported code is never touched', () => {
  const x = fresh(jss([ch(1, 'G', sec('S', fig('Media/p.png')))])); I.reconcile(x.rec, x.o);
  x.rec.modules.push({ key: 'id:dm-old', kind: 'section', chapter: 1, title: 'Old', code: { ...x.rec.modules[0].code, modelIdentCode: 'GAV', systemCode: '00', subSystemCode: '0', assyCode: '00', disassyCode: '07' }, origin: 'imported' });
  I.applyPatch(x.rec, { modelIdentCode: 'zz9', pmNumber: '00061' });
  assert.equal(I.dmcString(x.rec.modules[0].code), 'DMC-ZZ9-A-01-10-00-00A-040A-D'); assert.equal(x.rec.modules[1].code.modelIdentCode, 'GAV');
  assert.ok(x.rec.pictures[0].icn.startsWith('ICN-ZZ9-A-')); assert.equal(I.pmcString(x.rec.modelIdentCode, x.rec.pm), 'PMC-ZZ9-1671Y-00061-00');
  assert.throws(() => I.applyPatch(x.rec, { modelIdentCode: 'x' }), /not valid/); assert.throws(() => I.applyPatch(x.rec, { pmIssuer: '12' }), /not valid/);
});

test('nothing is shown by default; the toggles are a record setting', () => {
  const x = fresh(jss([ch(1, 'G', sec('S'))])); assert.deepEqual(x.rec.show, { dmc: false });
  I.applyVisibility(x.rec, { dmc: true, toc: true, pmc: true, icn: true }); assert.deepEqual(x.rec.show, { dmc: true }, 'the old pmc / icn / toc switches are accepted and ignored');
  assert.throws(() => I.applyVisibility(x.rec, { dmc: 'yes' }), /true or false/);
});

test('JSG: chapters, sections, appendices and plates are modules; clauses are contents lines', () => {
  const o = outlineOfJsg(`<?xml version="1.0"?><jsgdoc version="1.0" type="uhb"><meta><title>USER HANDBOOK</title><projectName>Modular Bridge</projectName></meta>
    <chapter title="General Description"><section title="Introduction"><para>x</para><clause title="General"><clause title="Deep"/></clause><figure title="F"><graphic src="Media/g.png"/></figure></section><section title="Description"/></chapter>
    <appendices><appendix label="H" title="System Specification"/></appendices></jsgdoc>`);
  assert.deepEqual(o.modules.map((m) => [m.kind, m.chapter, m.title]), [['section', 1, 'Introduction'], ['section', 1, 'Description'], ['appendix', 2, 'H System Specification']]);
  assert.deepEqual(o.modules[0].pictures, ['g.png']);
  assert.deepEqual(o.toc.map((t) => `${t.level} ${t.number} ${t.title}`), ['1 1 General Description', '2 1.1 Introduction', '3 1.1.1 General', '4 1.1.1.1 Deep', '2 1.2 Description', '1 H H System Specification']);
  const r = I.emptyRecord(o, { format: 'jsg' }); I.reconcile(r, o);
  assert.equal(r.modelIdentCode, 'MODULARBRIDGE'); assert.deepEqual(codes(r), ['DMC-MODULARBRIDGE-A-01-10-00-00A-040A-D', 'DMC-MODULARBRIDGE-A-01-20-00-00A-040A-D', 'DMC-MODULARBRIDGE-A-02-10-00-00A-040A-D']);
});

// ── the routes ──────────────────────────────────────────────────────────────────────────────────────────────

test('a JSS project has codes from the start, kept in the backend, hidden by default; saving the document keeps them in step', async () => {
  const r = await w.post('/api/projects', { name: 'Identity JSS', format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201); const U = `/api/projects/${r.json.project.id}`;
  const a = await w.get(`${U}/identity`); assert.equal(a.status, 200, JSON.stringify(a.json).slice(0, 300));
  const id = a.json.identity;
  assert.deepEqual(id.show, { dmc: false });
  assert.ok(id.modules.length >= 7, 'every section of the stencil has a code'); assert.equal(new Set(id.modules.map((m) => m.dmc)).size, id.modules.length);
  assert.ok(id.modules.every((m) => /^DMC-[A-Z0-9]+-A-\d\d-[0-9A-Z]{2}-\d\d-00A-040A-D$/.test(m.dmc)), id.modules[0].dmc);
  assert.match(id.pmc.code, /^PMC-[A-Z0-9]+-[A-Z0-9]{5}-\d{5}-00$/); assert.ok(id.toc.length >= 7);
  assert.ok(fs.existsSync(path.join(h.ws, 'projects', r.json.project.id, 'doc-identity.json')), 'the record is a file beside the document');
  // the document's XML is the one a blank project has: nothing of the codes is written into it
  const g = await w.get(`${U}/jss`); assert.ok(!/DMC-|dmCode|ICN-/.test(g.json.xml), 'the editor\'s XML carries no S1000D codes');
  // add a section with a picture and save: the record follows, old codes stay
  const before = new Map(id.modules.map((m) => [m.key, m.dmc]));
  const xml = g.json.xml.replace(/(<chapter number="1"[^>]*>[\s\S]*?)(<\/chapter>)/, `$1<section id="sx"><title>Added section</title><figure><title>New</title><graphic src="Media/new-photo.png"/></figure></section>$2`);
  const p = await w.put(`${U}/jss`, { xml, baseHash: g.json.hash }); assert.equal(p.status, 200, JSON.stringify(p.json).slice(0, 300));
  const b = (await w.get(`${U}/identity`)).json.identity;
  for (const [k, dmc] of before) assert.equal(b.modules.find((m) => m.key === k)?.dmc, dmc, `unchanged: ${k}`);
  const added = b.modules.find((m) => m.key === 'id:sx'); assert.ok(added, 'the new section has a code'); assert.equal(b.pictures.find((x) => x.file === 'new-photo.png').module, 'id:sx');
  // the toggles
  const t = await w.put(`${U}/identity/visibility`, { dmc: true, icn: true }); assert.equal(t.status, 200); assert.deepEqual(t.json.identity.show, { dmc: true });
  assert.equal((await w.put(`${U}/identity/visibility`, { dmc: 'x' })).status, 400);
  // the identity
  const c = await w.put(`${U}/identity`, { modelIdentCode: 'XYZ77', pmNumber: '00123' }); assert.equal(c.status, 200); assert.ok(c.json.identity.modules.every((m) => m.dmc.startsWith('DMC-XYZ77-')));
  assert.equal((await w.put(`${U}/identity`, { modelIdentCode: 'a' })).status, 400);
  assert.equal((await w.get(`${U}/identity`)).json.identity.pmc.code, 'PMC-XYZ77-00000-00123-00');
});

test('a JSG project has them too; an S1000D project does not (it has its own, always visible)', async () => {
  const g = await w.post('/api/projects', { name: 'Identity JSG', format: 'jsg', domain: 'land', manualType: 'uhb' }); assert.equal(g.status, 201, JSON.stringify(g.json).slice(0, 300));
  const a = await w.get(`/api/projects/${g.json.project.id}/identity`); assert.equal(a.status, 200, JSON.stringify(a.json).slice(0, 300));
  assert.equal(a.json.identity.format, 'jsg'); assert.ok(a.json.identity.modules.length >= 10); assert.deepEqual(a.json.identity.show, { dmc: false });
  const s = await w.post('/api/projects/sample', {}); assert.equal(s.status, 201);
  assert.equal((await w.get(`/api/projects/${s.json.project.id}/identity`)).status, 404);
});

test('the project\'s SNS rows name the codes: a row for the chapter gives its system code, a sub-system row its sub-system; the others take the next free one', async () => {
  const r = await w.post('/api/projects', { name: 'Identity SNS', format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201); const U = `/api/projects/${r.json.project.id}`;
  const g0 = await w.get(`${U}/jss`); const chapterTitle = /<chapter number="1"[^>]*>\s*<title>([^<]*)</.exec(g0.json.xml)[1];
  assert.equal((await w.post(`${U}/sns-rows`, { systemCode: '41', title: chapterTitle })).status, 201);
  assert.equal((await w.post(`${U}/sns-rows`, { systemCode: '41', subSystemCode: '3', title: 'Corrosion limits' })).status, 201);
  const xml = g0.json.xml.replace(/(<chapter number="1"[^>]*>[\s\S]*?)(<\/chapter>)/, '$1<section id="sp"><title>Corrosion limits</title><para>x</para></section><section id="sf"><title>Features</title><para>y</para></section>$2');
  assert.equal((await w.put(`${U}/jss`, { xml, baseHash: g0.json.hash })).status, 200);
  const id = (await w.get(`${U}/identity`)).json.identity;
  const mod = (key) => id.modules.find((m) => m.key === key);
  assert.match(mod('id:sp').dmc, /^DMC-[A-Z0-9]+-A-41-30-00-00A-040A-D$/, 'the sub-system row named "Corrosion limits" gives sub-system 3: ' + mod('id:sp').dmc);
  assert.match(mod('id:sf').dmc, /^DMC-[A-Z0-9]+-A-41-[0-9A-Z]0-00-00A-040A-D$/); assert.ok(!/-A-41-30-/.test(mod('id:sf').dmc), 'a section with no row does not take the number a row owns');
  assert.ok(id.modules.filter((m) => m.chapter === 1).every((m) => m.dmc.includes('-A-41-')), 'every section of the chapter is in the system the row named');
  assert.equal(new Set(id.modules.map((m) => m.dmc)).size, id.modules.length, 'unique');
});
