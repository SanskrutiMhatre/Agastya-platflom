'use strict';
// Applicability: ACT/CCT/PCT authoring (XSD-valid data modules in the CSDB) and reference validation with DM + XML location.
// The model is the specification's own bicycle example (Issue 4.2, Chap 3.9.5.3).
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
const PW = 'Correct-Horse-9!';
let h; let admin; let alice;

async function person(creator, role, username) {
  const made = await creator.post('/api/team/users', { username, fullName: username, role });
  const c = new h.Client(username);
  await c.post('/api/auth/login', { username, password: made.json.tempPassword });
  await c.post('/api/auth/onboarding', { username, password: PW });
  return c;
}
const MODEL = {
  attributes: [
    { id: 'type', name: 'Type', descr: 'Bicycle type', valueDataType: 'string', values: [{ value: 'Mountain bicycle' }, { value: 'Road bicycle' }] },
    { id: 'version', name: 'Version', displayName: 'Ver', descr: 'Version', valueDataType: 'string', values: [{ value: 'Mk1' }, { value: 'Mk2' }, { value: 'Mk9' }] },
    { id: 'serialno', name: 'Serial number', descr: 'Frame serial number', valueDataType: 'integer', values: [], productIdentifier: 'primary' },
  ],
  conditionTypes: [{ id: 'SB', name: 'Service bulletin', descr: 'Service bulletin status', valueDataType: 'string', values: [{ value: 'pre' }, { value: 'post' }] }],
  conditions: [{ id: 'SB-S001', condTypeId: 'SB', name: 'Service bulletin S001', descr: 'Chain guard installation' }],
  products: [{ id: 'prd-1', assigns: [{ ident: 'type', type: 'prodattr', value: 'Mountain bicycle' }, { ident: 'version', type: 'prodattr', value: 'Mk1' }] }],
};
const dm = (name, applicXml, content = '<para>x</para>', actRef = true) => {
  const file = `DMC-BIKE1-A-10-00-00-00A-040A-A_001-00_EN-IN.xml`.replace('10-00', name);
  const xml = `<?xml version="1.0"?><dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_5-0/xml_schema_flat/descript.xsd">
<identAndStatusSection><dmAddress><dmIdent><dmCode modelIdentCode="BIKE1" systemDiffCode="A" systemCode="${name.split('-')[0]}" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="040" infoCodeVariant="A" itemLocationCode="A"/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="00"/></dmIdent><dmAddressItems><issueDate year="2026" month="01" day="01"/><dmTitle><techName>T</techName></dmTitle></dmAddressItems></dmAddress>
<dmStatus issueType="new"><security securityClassification="01"/>${actRef ? '<applicCrossRefTableRef><dmRef><dmRefIdent><dmCode modelIdentCode="BIKE1" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="00W" infoCodeVariant="A" itemLocationCode="D"/></dmRefIdent></dmRef></applicCrossRefTableRef>' : ''}
${applicXml}</dmStatus></identAndStatusSection><content>${content}</content></dmodule>`;
  return { file, xml };
};
const A = (inner) => `<applic><displayText><simplePara>x</simplePara></displayText>${inner}</applic>`;

test.before(async () => {
  h = await boot(); admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const pm = await person(admin, 'project_manager', 'meera');
  alice = await person(pm, 'author', 'alice');
});
test.after(async () => { await h.close(); });

test('tables need the project identity first; then ACT, CCT and PCT are written as XSD-valid data modules, in all four issues', async () => {
  for (const issue of ['4.2', '5.0', '6.0', '7.0']) {
    const pr = (await alice.post('/api/projects', { name: `Bike ${issue}`, s1000d: { mic: 'BIKE1', issue, responsiblePartner: { code: 'BK123', name: 'Bike Co' } } })).json.project.id;
    const put = await alice.put(`/api/projects/${pr}/applicability`, { model: MODEL });
    if (put.status !== 200) console.log('PUTFAIL', issue, JSON.stringify(put.json).slice(0, 1500)); assert.equal(put.status, 200);
    assert.deepEqual(put.json.written.map((w) => w.table), ['act', 'cct', 'pct']);
    assert.deepEqual(put.json.problems, []);
    const read = (await alice.get(`/api/projects/${pr}/applicability`)).json;
    assert.deepEqual(read.model, { ...MODEL, attributes: read.model.attributes }, 'the model reads back from the data modules');
    assert.equal(read.model.attributes.length, 3);
    assert.equal(read.filtering, false);
    assert.match(read.note, /not implemented/);
    // the files are real, schema-valid data modules and the project validation agrees
    const v = (await alice.post(`/api/projects/${pr}/validation`, { brex: false })).json.run;
    assert.equal(v.issues.filter((i) => i.source === 'xsd').length, 0, `${issue}: ${JSON.stringify(v.issues.filter((i) => i.source === 'xsd'))}`);
    // an update keeps identification and history: only the content changes; a table cannot be emptied
    const again = await alice.put(`/api/projects/${pr}/applicability`, { model: { ...MODEL, attributes: [...MODEL.attributes, { id: 'colour', name: 'Colour', descr: 'Paint', valueDataType: 'string', values: [{ value: 'red' }] }] } });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.written.every((w) => w.created === false), true);
    assert.equal((await alice.put(`/api/projects/${pr}/applicability`, { model: { ...MODEL, products: [] } })).json.code, 'TABLE_EXISTS');
    assert.equal((await alice.get(`/api/projects/${pr}/dms`)).json.dms.length, 3);
  }
  const bare = (await alice.post('/api/projects', { name: 'No identity' })).json.project.id;
  assert.equal((await alice.put(`/api/projects/${bare}/applicability`, { model: MODEL })).json.code, 'NO_MIC');
});

test('a model with broken references or values is refused with every problem named, and nothing is stored', async () => {
  const pr = (await alice.post('/api/projects', { name: 'Bad model', s1000d: { mic: 'BIKE1', issue: '5.0', responsiblePartner: { code: 'BK123', name: 'Bike Co' } } })).json.project.id;
  const bad = { ...MODEL, attributes: [...MODEL.attributes, { id: '1bad', name: '', descr: '', valueDataType: 'string', values: [] }], conditions: [{ id: 'c1', condTypeId: 'nope', name: 'x', descr: 'y' }],
    products: [{ id: 'p', assigns: [{ ident: 'version', type: 'prodattr', value: 'Mk7' }, { ident: 'ghost', type: 'prodattr', value: 'a' }] }] };
  const r = await alice.put(`/api/projects/${pr}/applicability`, { model: bad });
  assert.equal(r.status, 400);
  const t = r.json.problems.join('\n');
  assert.match(t, /identifier starts with a letter/); assert.match(t, /name is required/); assert.match(t, /condition type "nope" is not declared/);
  assert.match(t, /"Mk7" is not one of the declared values/); assert.match(t, /"ghost" is not a declared product attribute/);
  assert.equal((await alice.get(`/api/projects/${pr}/dms`)).json.dms.length, 0);
  assert.equal((await alice.put(`/api/projects/${pr}/applicability`, { model: { ...MODEL, attributes: [{ ...MODEL.attributes[2], values: [{ value: 'x' }] }] } })).status, 400, 'integer attribute with a non-integer value');
});

test('reference validation: applicRefId, properties, values, ACT reference - each reported with the data module and XML location', async () => {
  const pr = (await alice.post('/api/projects', { name: 'Bike', s1000d: { mic: 'BIKE1', issue: '5.0', responsiblePartner: { code: 'BK123', name: 'Bike Co' } } })).json.project.id;
  await alice.put(`/api/projects/${pr}/applicability`, { model: MODEL });
  const post = async (d) => assert.equal((await alice.post(`/api/projects/${pr}/dms`, d)).status, 201);
  // good: set, range, condition, evaluate; applicRefId resolves
  await post(dm('11-00', A('<evaluate andOr="and"><assert applicPropertyIdent="type" applicPropertyType="prodattr" applicPropertyValues="Mountain bicycle"/><assert applicPropertyIdent="serialno" applicPropertyType="prodattr" applicPropertyValues="1~2|5~10"/><assert applicPropertyIdent="SB-S001" applicPropertyType="condition" applicPropertyValues="post"/></evaluate>'),
    '<referencedApplicGroup><applic id="app-1"><assert applicPropertyIdent="version" applicPropertyType="prodattr" applicPropertyValues="Mk1|Mk2"/></applic></referencedApplicGroup><para applicRefId="app-1">x</para>'));
  // bad: unknown attribute, bad value, bad range, dangling applicRefId, unknown condition, bad condition value, no ACT ref
  await post(dm('12-00', A('<assert applicPropertyIdent="colour" applicPropertyType="prodattr" applicPropertyValues="red"/>'), '<para applicRefId="app-9">x</para>'));
  await post(dm('13-00', A('<evaluate andOr="and"><assert applicPropertyIdent="version" applicPropertyType="prodattr" applicPropertyValues="Mk7"/><assert applicPropertyIdent="serialno" applicPropertyType="prodattr" applicPropertyValues="a~b"/><assert applicPropertyIdent="SB-X" applicPropertyType="condition" applicPropertyValues="post"/><assert applicPropertyIdent="SB-S001" applicPropertyType="condition" applicPropertyValues="during"/></evaluate>')));
  await post(dm('14-00', A('<assert applicPropertyIdent="type" applicPropertyType="prodattr" applicPropertyValues="Road bicycle"/>'), '<para>x</para>', false));
  const probs = (await alice.get(`/api/projects/${pr}/applicability/validate`)).json.problems;
  const by = (f) => probs.filter((p) => p.file.endsWith(f));
  assert.equal(by('DMC-BIKE1-A-11-00-00-00A-040A-A_001-00_EN-IN.xml').length, 0, 'the correct module has no problems');
  const p12 = by('DMC-BIKE1-A-12-00-00-00A-040A-A_001-00_EN-IN.xml');
  assert.ok(p12.some((p) => p.code === 'APPLIC-PROPERTY' && /colour/.test(p.message) && p.line > 1 && /dmStatus\/applic\/assert$/.test(p.location)), JSON.stringify(p12));
  const ref = p12.find((p) => p.code === 'APPLIC-REFID');
  assert.ok(ref && /app-9/.test(ref.message) && /content\/para$/.test(ref.location) && ref.line > 1);
  const p13 = by('DMC-BIKE1-A-13-00-00-00A-040A-A_001-00_EN-IN.xml').map((p) => p.code + ':' + p.message);
  assert.equal(p13.filter((m) => m.startsWith('APPLIC-VALUE')).length, 3, p13.join('\n'));   // Mk7, a~b, during
  assert.equal(p13.filter((m) => m.startsWith('APPLIC-PROPERTY')).length, 1);                // SB-X
  assert.ok(by('DMC-BIKE1-A-14-00-00-00A-040A-A_001-00_EN-IN.xml').some((p) => p.code === 'APPLIC-ACT-REF-MISSING' && p.severity === 'warning'));
  // the same problems appear on the project's Validation page, with the same location
  const run = (await alice.post(`/api/projects/${pr}/validation`, { brex: false })).json.run;
  const applic = run.issues.filter((i) => i.source === 'applic');
  assert.equal(applic.length, probs.length, 'the Validation page shows exactly what the API reports'); assert.ok(applic.every((i) => i.file && i.line >= 1 && i.loc));
  // tables are exempt from the SNS rule; nothing filters the publication
  assert.equal((await alice.get(`/api/projects/${pr}/applicability`)).json.filtering, false);
});

test('declared values are expressions ("A|B|C", "001~100"), and a product without an id is legal (found by the 21-type fixtures)', () => {
  const { valueProblem } = require('../dist/services/applicability');
  assert.equal(valueProblem('B', ['A|B|C'], undefined, 'string'), null);
  assert.equal(valueProblem('002', ['001~100'], undefined, 'string'), null);
  assert.equal(valueProblem('7', ['1~5', '7~9'], undefined, 'integer'), null);
  assert.match(valueProblem('D', ['A|B|C'], undefined, 'string'), /not one of the declared values/);
  assert.match(valueProblem('101', ['001~100'], undefined, 'string'), /not one of the declared values/);
  assert.equal(valueProblem('2~4', ['1~5'], undefined, 'integer'), null, 'a range whose ends are both allowed');
  assert.equal(valueProblem('anything', [], undefined, 'string'), null, 'no enumeration = open value');
});
