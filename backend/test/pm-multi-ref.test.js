'use strict';
// A publication module in which one <pmEntry> holds several references (the Xignal master does: "3.3 Deployment Procedure" lists three data
// modules) must not lose any of them when it is read by the Explorer and saved again. The vendored reader keeps only the first reference of such an
// entry; the Explorer's read goes through the completing reader instead. Uploading a PM stores it verbatim, so the file itself is never lossy -
// the loss used to happen at the first Explorer save.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const ref = (code, tech) => `<dmRef><dmRefIdent><dmCode modelIdentCode="RDR" systemDiffCode="A" systemCode="A15" subSystemCode="3" subSubSystemCode="0" assyCode="00" disassyCode="${code}" disassyCodeVariant="A" infoCode="130" infoCodeVariant="A" itemLocationCode="D"/><issueInfo issueNumber="001" inWork="00"/><language languageIsoCode="en" countryIsoCode="IN"/></dmRefIdent><dmRefAddressItems><dmTitle><techName>${tech}</techName><infoName>Procedure</infoName></dmTitle></dmRefAddressItems></dmRef>`;
const PM = `<?xml version="1.0"?>
<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="RDR" pmIssuer="1671Y" pmNumber="00039" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="01"/></pmIdent><pmAddressItems><issueDate year="2026" month="11" day="20"/><pmTitle>Multi reference test</pmTitle></pmAddressItems></pmAddress><pmStatus><security securityClassification="01"/><qualityAssurance><unverified/></qualityAssurance></pmStatus></identAndStatusSection>
<content>
  <pmEntry><pmEntryTitle>1.1 Purpose</pmEntryTitle>${ref('01', 'Purpose')}</pmEntry>
  <pmEntry><pmEntryTitle>3.3 Deployment Procedure</pmEntryTitle>${ref('11', 'Deploy one')}${ref('08', 'Deploy two')}${ref('12', 'Deploy three')}</pmEntry>
</content></pm>`;

let h; let admin; let author; let pid;

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  const made = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda Writer', role: 'author' });
  author = new h.Client('wanda');
  await author.post('/api/auth/login', { username: 'wanda', password: made.json.tempPassword });
  await author.post('/api/auth/onboarding', { username: 'wanda', password: PW });
  pid = (await author.post('/api/projects', { name: 'Multi ref', pipeline: 's1000dtofo' })).json.project.id;
});
test.after(async () => { await h.close(); });

// module references of the publication's content; the header's BREX reference (written since WP-15, PUB-015, when the uploaded PM had none) is not one
const refsIn = (xml) => (xml.replace(/<brexDmRef>[\s\S]*?<\/brexDmRef>/g, '').match(/<dmRef[\s>]/g) || []).length;

test('the vendored reader still keeps only the first reference of an entry (why the Explorer must not use it for saving)', () => {
  const pmc = require('../vendor/engine/pmc');
  const kept = [];
  (function walk(list) { for (const e of list) { if (e.type === 'dm') kept.push(e); if (e.children) walk(e.children); } })(pmc.parsePm(PM).entries);
  assert.equal(refsIn(PM), 4);
  assert.equal(kept.length, 2, 'if this ever becomes 4 the reader was fixed and the completing reader can be retired');
});

test('an uploaded PM whose entry holds three references: the Explorer reads all four, and a save keeps all four', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([PM], { type: 'application/xml' }), 'PMC-test.xml');
  const up = await author.req('POST', `/api/projects/${pid}/pmc/import`, fd);
  assert.equal(up.status, 200, JSON.stringify(up.json));

  const stored = await author.get(`/api/projects/${pid}/pmc/export`);
  assert.equal(refsIn(stored.buf.toString('utf8')), 4, 'the file is stored verbatim');

  const read = (await author.get(`/api/projects/${pid}/pmc`)).json;
  const dms = [];
  (function walk(list) { for (const e of list) { if (e.type === 'dm') dms.push(e.dmCode.disassyCode); if (e.children) walk(e.children); } })(read.entries);
  assert.deepEqual(dms, ['01', '11', '08', '12'], 'every reference is there, in document order');
  assert.ok(read.warnings.some((w) => /2 module references/.test(w)), `the read says what it added: ${JSON.stringify(read.warnings)}`);

  // the Explorer round trip: save what was read
  const saved = await author.put(`/api/projects/${pid}/pmc`, { meta: read.meta, entries: read.entries, baseHash: (await author.get(`/api/projects/${pid}/pmc`)).json.hash });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const after = await author.get(`/api/projects/${pid}/pmc/export`);
  assert.equal(refsIn(after.buf.toString('utf8')), 4, 'all four references survive the save');
  assert.match(after.buf.toString('utf8'), /3\.3 Deployment Procedure/, 'the entry title is kept');

  const again = (await author.get(`/api/projects/${pid}/pmc`)).json;
  assert.equal(again.warnings.filter((w) => /module references/.test(w)).length, 0, 'once saved there is nothing left to add');
});

test('the files a release fingerprint must cover include every referenced module', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([PM], { type: 'application/xml' }), 'PMC-test.xml');
  await author.req('POST', `/api/projects/${pid}/pmc/import`, fd);
  const pm = require('../dist/services/pm');
  const projects = require('../dist/services/projects');
  const pmFile = projects.pmRel(projects.readProjectJson(pid));
  // Make the data modules behind the four references exist, one of them (the third in the file) only reachable through the completing reader.
  for (const code of ['01', '11', '08', '12']) {
    const xml = `<?xml version="1.0"?><dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><identAndStatusSection><dmAddress><dmIdent><dmCode modelIdentCode="RDR" systemDiffCode="A" systemCode="A15" subSystemCode="3" subSubSystemCode="0" assyCode="00" disassyCode="${code}" disassyCodeVariant="A" infoCode="130" infoCodeVariant="A" itemLocationCode="D"/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="00"/></dmIdent><dmAddressItems><issueDate year="2026" month="11" day="20"/><dmTitle><techName>Module ${code}</techName><infoName>Procedure</infoName></dmTitle></dmAddressItems></dmAddress><dmStatus issueType="new"><security securityClassification="01"/><responsiblePartnerCompany enterpriseCode="X"/><originator enterpriseCode="X"/><applic><displayText><simplePara>All</simplePara></displayText></applic><brexDmRef><dmRef><dmRefIdent><dmCode modelIdentCode="RDR" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="A" itemLocationCode="D"/></dmRefIdent></dmRef></brexDmRef><qualityAssurance><unverified/></qualityAssurance></dmStatus></identAndStatusSection><content><description><para>Text ${code}</para></description></content></dmodule>`;
    const r = await author.post(`/api/projects/${pid}/dms`, { file: `DMC-RDR-A-A15-30-00-${code}A-130A-D_001-00_EN-IN.xml`, xml });
    assert.ok(r.status === 200 || r.status === 201, `module ${code}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  }
  const sources = pm.publicationSources(pid);
  assert.ok(sources.includes(pmFile), 'the publication module itself is part of the fingerprint');
  const modules = sources.filter((f) => /^csdb\/DMC-/i.test(f));
  assert.equal(modules.length, 4, `all four referenced modules are covered, including the three the entry held together: ${JSON.stringify(sources)}`);
});

test('the importer\'s "reconstructed" mark survives a save from the Explorer (and is not doubled by the next one)', async () => {
  const marked = PM.replace(/^(<\?xml[^>]*\?>\r?\n)/, '$1<!-- agastya-import: reconstructed: synthesised from the data modules by the importer -->\n');
  assert.match(marked, /agastya-import: reconstructed/);
  const fd = new FormData();
  fd.append('file', new Blob([marked], { type: 'application/xml' }), 'PMC-marked.xml');
  assert.equal((await author.req('POST', `/api/projects/${pid}/pmc/import`, fd)).status, 200);
  const read = (await author.get(`/api/projects/${pid}/pmc`)).json;
  for (let i = 0; i < 2; i++) assert.equal((await author.put(`/api/projects/${pid}/pmc`, { meta: read.meta, entries: read.entries, baseHash: (await author.get(`/api/projects/${pid}/pmc`)).json.hash })).status, 200);
  const text = (await author.get(`/api/projects/${pid}/pmc/export`)).buf.toString('utf8');
  assert.equal((text.match(/agastya-import: reconstructed/g) || []).length, 1, 'kept once');
  assert.match(text, /<!-- agastya-import: reconstructed: synthesised from the data modules by the importer -->/, 'verbatim, reason included');
  assert.ok(text.indexOf('<!--') > text.indexOf('<?xml') && text.indexOf('<!--') < text.indexOf('<pm'), 'right after the XML declaration');
  assert.equal(refsIn(text), 4);

  // a publication that never had the mark does not gain one
  const fd2 = new FormData();
  fd2.append('file', new Blob([PM], { type: 'application/xml' }), 'PMC-plain.xml');
  await author.req('POST', `/api/projects/${pid}/pmc/import`, fd2);
  const plain = (await author.get(`/api/projects/${pid}/pmc`)).json;
  await author.put(`/api/projects/${pid}/pmc`, { meta: plain.meta, entries: plain.entries, baseHash: (await author.get(`/api/projects/${pid}/pmc`)).json.hash });
  assert.doesNotMatch((await author.get(`/api/projects/${pid}/pmc/export`)).buf.toString('utf8'), /agastya-import/);
});

test('an annexure (pmRef) prints nothing in this build, so the publication gate says so for each one instead of staying silent', async () => {
  const annex = (n, title) => `<pmEntry><pmEntryTitle>${title}</pmEntryTitle><pmRef><pmRefIdent><pmCode modelIdentCode="RDR" pmIssuer="1671Y" pmNumber="0004${n}" pmVolume="00"/><issueInfo issueNumber="001" inWork="00"/></pmRefIdent><pmRefAddressItems><pmTitle>${title} manual</pmTitle></pmRefAddressItems></pmRef></pmEntry>`;
  const text = PM.replace('</content>', `${annex(1, 'Annexure A')}${annex(2, 'Annexure B')}</content>`);
  const fd = new FormData();
  fd.append('file', new Blob([text], { type: 'application/xml' }), 'PMC-annex.xml');
  const pid = (await author.post('/api/projects', { name: 'Annexures only', pipeline: 's1000dtofo' })).json.project.id;   // no modules: nothing for the gate to validate
  assert.equal((await author.req('POST', `/api/projects/${pid}/pmc/import`, fd)).status, 200);

  const pm = require('../dist/services/pm');
  const refs = pm.pmRefsOf(pid);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map((r) => r.title), ['Annexure A', 'Annexure B']);
  assert.match(refs[0].code, /RDR.*00041/);

  const gate = require('../dist/services/publishGate');
  const pass = await gate.assertPublishable(pid, 'publication', { waivable: true });
  const notes = pass.warnings.filter((w) => /NOT part of this PDF/.test(w));
  assert.equal(notes.length, 2, JSON.stringify(pass.warnings));
  assert.match(notes[0], /Annexure "Annexure A" \(publication RDR.*00041.*\)/);

  // a single-module preview is not the publication: no annexure notes there
  const one = await gate.assertPublishable(pid, { file: 'DMC-RDR-A-A15-30-00-01A-130A-D_001-00_EN-IN.xml' }, { waivable: true }).catch((e) => e);
  assert.ok(one instanceof Error || one.warnings.every((w) => !/NOT part of this PDF/.test(w)));
});
