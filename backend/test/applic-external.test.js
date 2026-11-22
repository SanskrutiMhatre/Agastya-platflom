'use strict';
// Externalized applicability (S1000D 4.2 Chap 3.9.5.3 para 2.1.3.2, Chap 3.9.5.2.1.13, Chap 3.9.5.2.11.12):
//   <applicRef applicIdentValue> + <dmRef>  ->  CIR <applicSpec><applicSpecIdent applicIdentValue> -> applicMapRefId -> <applic id>
// and the applicConfiguration attribute of <applic> (defined for illustrated parts data modules only).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let w; let pid;
const URL = () => `/api/projects/${pid}`;

const CODE = (sys, info) => `<dmCode modelIdentCode="BIKE1" systemDiffCode="A" systemCode="${sys}" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="${info}" infoCodeVariant="A" itemLocationCode="D"/>`;
const FILE = (sys, info) => `DMC-BIKE1-A-${sys}-00-00-00A-${info}A-D_001-00_EN-IN.xml`;
const dmXml = (sys, info, status, content) => `<?xml version="1.0"?><dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><identAndStatusSection><dmAddress><dmIdent>${CODE(sys, info)}<language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="00"/></dmIdent><dmAddressItems><issueDate year="2026" month="11" day="22"/><dmTitle><techName>t${sys}${info}</techName></dmTitle></dmAddressItems></dmAddress><dmStatus issueType="new"><security securityClassification="01"/>${status}</dmStatus></identAndStatusSection><content>${content}</content></dmodule>`;
const REF = (id, ident, sys = '00', info = '00L') => `<applicRef${id ? ` id="${id}"` : ''} applicIdentValue="${ident}"><dmRef><dmRefIdent>${CODE(sys, info)}</dmRefIdent></dmRef></applicRef>`;
const A = (id, inner, extra = '') => `<applic id="${id}"${extra}><displayText><simplePara>x</simplePara></displayText>${inner}</applic>`;
const ASSERT = (id, v) => `<assert applicPropertyIdent="${id}" applicPropertyType="prodattr" applicPropertyValues="${v}"/>`;

// the applicability annotations CIR data module: two annotations (version Mk1 / Mk2), identified by applicIdentValue
const CIR = dmXml('00', '00L', '', `<referencedApplicGroup>${A('a-mk1', ASSERT('version', 'Mk1'))}${A('a-mk2', ASSERT('version', 'Mk2'))}</referencedApplicGroup><commonRepository><applicRepository><applicSpec id="sp1" applicMapRefId="a-mk1"><applicSpecIdent applicIdentValue="app-MK1"/></applicSpec><applicSpec id="sp2" applicMapRefId="a-mk2"><applicSpecIdent applicIdentValue="app-MK2"/></applicSpec><applicSpec id="sp3" applicMapRefId="a-missing"><applicSpecIdent applicIdentValue="app-BAD"/></applicSpec></applicRepository></commonRepository>`);
// a data module whose own applicability and one paragraph are externalized
const USER = (own, para) => dmXml('10', '040', own, `<referencedApplicGroupRef>${REF('r-mk2', para)}</referencedApplicGroupRef><description><levelledPara><title>T</title><para>ALWAYS-HERE</para></levelledPara><levelledPara applicRefId="r-mk2"><title>T2</title><para>MK2-ONLY</para></levelledPara></description>`);

const sel = (obj) => ({ values: new Map(Object.entries(obj)), productId: null, label: '', slug: '', summary: [] });
const lookupOf = (...xmls) => {
  const { DOMParser } = require('@xmldom/xmldom'); const { dmcKey } = require('../dist/services/applicability');
  const m = new Map(); for (const x of xmls) { const d = new DOMParser().parseFromString(x, 'text/xml'); m.set(dmcKey(d.getElementsByTagName('dmCode')[0]), d); }
  return (k) => m.get(k) ?? null;
};

test.before(async () => {
  h = await boot();
  const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const made = await admin.post('/api/team/users', { username: 'beth', fullName: 'Beth Bike', role: 'author' });
  w = new h.Client('beth');
  await w.post('/api/auth/login', { username: 'beth', password: made.json.tempPassword });
  await w.post('/api/auth/onboarding', { username: 'beth', password: PW });
  pid = (await w.post('/api/projects', { name: 'External', pipeline: 's1000dtofo' })).json.project.id;
});
test.after(async () => { await h.close(); });

test('resolveApplicRef follows dmRef -> applicSpecIdent -> applicMapRefId and says exactly what is broken', () => {
  const { resolveApplicRef } = require('../dist/services/applicability');
  const { DOMParser } = require('@xmldom/xmldom');
  const lookup = lookupOf(CIR);
  const ref = (ident, sys = '00', info = '00L') => new DOMParser().parseFromString(REF('x', ident, sys, info), 'text/xml').documentElement;
  assert.equal(resolveApplicRef(ref('app-MK1'), lookup).applic.getAttribute('id'), 'a-mk1');
  assert.match(resolveApplicRef(ref('app-NOPE'), lookup).problem, /no <applicSpec> with applicIdentValue="app-NOPE"/);
  assert.match(resolveApplicRef(ref('app-BAD'), lookup).problem, /applicMapRefId="a-missing"/);
  assert.match(resolveApplicRef(ref('app-MK1', '99', '00L'), lookup).problem, /is not in this project/);
});

test('planDm: an externalized applicRefId excludes the element for another configuration, keeps it for this one, never guesses', () => {
  const { planDm } = require('../dist/services/applicEval');
  const lookup = lookupOf(CIR);
  const xml = USER('', 'app-MK2');
  const mk1 = planDm('u.xml', xml, sel({ version: ['Mk1'] }), lookup);
  assert.equal(mk1.included, true); assert.equal(mk1.removed, 1); assert.ok(!mk1.xml.includes('MK2-ONLY')); assert.ok(mk1.xml.includes('ALWAYS-HERE'));
  const mk2 = planDm('u.xml', xml, sel({ version: ['Mk2'] }), lookup);
  assert.equal(mk2.removed, 0); assert.ok(mk2.xml.includes('MK2-ONLY'));
  const none = planDm('u.xml', xml, sel({}), lookup);
  assert.equal(none.unresolved.length, 1); assert.deepEqual(none.unresolved[0].properties, ['version']);
  // without the CIR the reference cannot be resolved: nothing is excluded on a guess (the validation reports it)
  assert.equal(planDm('u.xml', xml, sel({ version: ['Mk1'] })).removed, 0);
});

test('planDm: the data module\'s own externalized applicRef decides inclusion', () => {
  const { planDm } = require('../dist/services/applicEval');
  const lookup = lookupOf(CIR);
  const xml = dmXml('10', '040', REF('', 'app-MK1'), '<description><levelledPara><title>T</title><para>x</para></levelledPara></description>');
  assert.equal(planDm('u.xml', xml, sel({ version: ['Mk1'] }), lookup).included, true);
  assert.equal(planDm('u.xml', xml, sel({ version: ['Mk2'] }), lookup).included, false);
  assert.equal(planDm('u.xml', xml, sel({}), lookup).unresolved.length, 1);
});

test('validation: a resolvable externalized reference is clean; a broken one is an error with module and location; applicConfiguration outside IPD warns', async () => {
  const put = async (file, xml) => { const r = await w.post(`${URL()}/dms`, { file, xml }); assert.equal(r.status, 201, `${file}: ${JSON.stringify(r.json)}`); };
  await put(FILE('00', '00L'), CIR);
  await put(FILE('10', '040'), USER('', 'app-MK2'));
  let p = (await w.get(`${URL()}/applicability/validate`)).json.problems;
  assert.deepEqual(p.filter((x) => /EXT-REF|REFID/.test(x.code)), [], JSON.stringify(p));

  const bad = USER('', 'app-NOPE').replace('<description>', '<description>').replace(/t10040/, 'x');
  await w.put(`${URL()}/dms/${FILE('10', '040')}`, { xml: bad });
  p = (await w.get(`${URL()}/applicability/validate`)).json.problems;
  const ext = p.filter((x) => x.code === 'APPLIC-EXT-REF');
  assert.equal(ext.length, 1); assert.equal(ext[0].severity, 'error');
  assert.match(ext[0].message, /app-NOPE/); assert.match(ext[0].file, /040A/); assert.match(ext[0].location, /applicRef/);

  const withCfg = dmXml('20', '040', '', `<referencedApplicGroup>${A('c1', ASSERT('version', 'Mk1'), ' applicConfiguration="installed"')}</referencedApplicGroup><description><levelledPara><title>T</title><para>x</para></levelledPara></description>`);
  await put(FILE('20', '040'), withCfg);
  p = (await w.get(`${URL()}/applicability/validate`)).json.problems;
  const cfg = p.filter((x) => x.code === 'APPLIC-CONFIG-NOT-IPD');
  assert.equal(cfg.length, 1); assert.equal(cfg[0].severity, 'warning'); assert.match(cfg[0].message, /installed/);
});

test('an undecided element INSIDE an element that is removed is not "unresolved" (it would never be published)', () => {
  const { planDm } = require('../dist/services/applicEval');
  const xml = dmXml('10', '040', '', `<referencedApplicGroup>${A('a-mk1', ASSERT('version', 'Mk1'))}${A('a-other', ASSERT('colour', 'red'))}</referencedApplicGroup><description><levelledPara applicRefId="a-mk1"><title>T</title><para>OUTER</para><para applicRefId="a-other">INNER</para></levelledPara></description>`);
  // version=Mk2 makes the outer element false; the inner one depends on "colour", which the configuration does not give
  const p = planDm('u.xml', xml, sel({ version: ['Mk2'] }));
  assert.equal(p.removed, 1); assert.deepEqual(p.unresolved, []);
  // when the outer element STAYS, the undecided inner one still is reported
  const q = planDm('u.xml', xml, sel({ version: ['Mk1'] }));
  assert.equal(q.unresolved.length, 1); assert.deepEqual(q.unresolved[0].properties, ['colour']);
});

test('planPm: an entry inside a removed entry is neither evaluated nor counted twice', () => {
  const { planPm } = require('../dist/services/applicEval');
  const pm = `<pm><content><pmEntry applicRefId="a-mk1"><pmEntryTitle>Outer</pmEntryTitle><pmEntry applicRefId="a-col"><pmEntryTitle>Inner</pmEntryTitle></pmEntry></pmEntry><pmEntry><pmEntryTitle>Keep</pmEntryTitle><dmRef><dmRefIdent>${CODE('10', '040')}</dmRefIdent></dmRef></pmEntry>` +
    `<referencedApplicGroup>${A('a-mk1', ASSERT('version', 'Mk1'))}${A('a-col', ASSERT('colour', 'red'))}</referencedApplicGroup></content></pm>`;
  const r = planPm(pm, 'pm.xml', sel({ version: ['Mk2'] }), new Set(), new Set());
  assert.equal(r.unresolved.length, 0); assert.equal(r.removedEntries, 1);
});

test('a configuration needs concrete values: a set or a range is refused with a clear message', async () => {
  const p2 = (await w.post('/api/projects', { name: 'Concrete', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  const put = await w.put(`/api/projects/${p2}/applicability`, { model: { attributes: [{ id: 'version', name: 'Version', descr: 'v', valueDataType: 'string', values: [{ value: 'Mk1' }, { value: 'Mk2' }] }, { id: 'serial', name: 'Serial', descr: 's', valueDataType: 'integer', values: [], productIdentifier: 'primary' }], conditionTypes: [], conditions: [], products: [] } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const { buildSelection } = require('../dist/services/applicEval');
  assert.throws(() => buildSelection(p2, { values: [{ ident: 'serial', value: '1~5' }] }), /set or a range/);
  assert.throws(() => buildSelection(p2, { values: [{ ident: 'version', value: 'Mk1|Mk2' }] }), /set or a range/);
  assert.ok(buildSelection(p2, { values: [{ ident: 'version', value: 'Mk1' }, { ident: 'serial', value: '3' }] }));
});
