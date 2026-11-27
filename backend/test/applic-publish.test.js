'use strict';
// Applicability RESOLUTION and configuration-specific publication, on the specification's own bicycle model (Issue 4.2, Chap 3.9.5.3).
// A configuration = a PCT product and/or ad-hoc values. assert matches values; evaluate is three-valued; a property the configuration does
// not give is UNRESOLVED (never "satisfied") and blocks the build; false applicability removes the element / data module / PM entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DOMParser } = require('@xmldom/xmldom');
const { boot, DM21 } = require('./helpers');
const { pdfText } = require('./pdftools');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const pick = (code) => fs.readdirSync(FIX).find((f) => f.includes(`-${code}A-D_`));
const text = async (buf) => {                                       // pdf.js (test/pdftools.js), no external program, no temp file
  return (await pdfText(buf, { mode: 'plain' })).replace(/[\s­-]+/g, '').toLowerCase();
};
const has = (t, s) => t.includes(s.replace(/[\s-]+/g, '').toLowerCase());
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const MODEL = {
  attributes: [
    { id: 'type', name: 'Type', descr: 'Bicycle type', valueDataType: 'string', values: [{ value: 'Mountain bicycle' }, { value: 'Road bicycle' }] },
    { id: 'model', name: 'Model', descr: 'Bicycle model', valueDataType: 'string', values: [{ value: 'Mountain storm' }, { value: 'Brook trekker' }] },
    { id: 'version', name: 'Version', descr: 'Version', valueDataType: 'string', values: [{ value: 'Mk1' }, { value: 'Mk2' }, { value: 'Mk9' }] },
    { id: 'serialno', name: 'Serial number', descr: 'Frame serial number', valueDataType: 'integer', values: [], productIdentifier: 'primary' },
  ],
  conditionTypes: [{ id: 'MLT', name: 'Maintenance level', descr: 'Maintenance level types', valueDataType: 'string', values: [{ value: 'ml01' }, { value: 'ml02' }, { value: 'ml03' }] }],
  conditions: [{ id: 'mntlvl', condTypeId: 'MLT', name: 'Maintenance level', descr: 'The level the work is done at' }],
  products: [
    { id: 'MTB-MK1', assigns: [{ ident: 'type', type: 'prodattr', value: 'Mountain bicycle' }, { ident: 'model', type: 'prodattr', value: 'Mountain storm' }, { ident: 'version', type: 'prodattr', value: 'Mk1' }, { ident: 'serialno', type: 'prodattr', value: '5' }] },
    { id: 'ROAD-MK2', assigns: [{ ident: 'type', type: 'prodattr', value: 'Road bicycle' }, { ident: 'model', type: 'prodattr', value: 'Brook trekker' }, { ident: 'version', type: 'prodattr', value: 'Mk2' }, { ident: 'serialno', type: 'prodattr', value: '50' }] },
  ],
};
const ACT_REF = '<applicCrossRefTableRef><dmRef><dmRefIdent><dmCode modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="00W" infoCodeVariant="A" itemLocationCode="D"/></dmRefIdent></dmRef></applicCrossRefTableRef>';
const assertXml = (id, type, values) => `<assert applicPropertyIdent="${id}" applicPropertyType="${type}" applicPropertyValues="${values}"/>`;
/** Put a DM-level applic into a fixture's <dmStatus> (with the ACT reference). */
const dmLevel = (xml, inner) => xml.replace(/<applic>[\s\S]*?<\/applic>/, `${ACT_REF}<applic><displayText><simplePara>conditional</simplePara></displayText>${inner}</applic>`);

let h; let w; let pid; let dir; let admin;
const URL = () => `/api/projects/${pid}`;
const PROCED = 'MARK-PROCED'; const FAULT = 'MARK-FAULT'; const MK1 = 'MARK-MK1-ONLY'; const ML = 'MARK-ML-ONE-OR-TWO'; const ALWAYS = 'MARK-ALWAYS-PRESENT';

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const made = await admin.post('/api/team/users', { username: 'beth', fullName: 'Beth Bike', role: 'author' });
  w = new h.Client('beth');
  await w.post('/api/auth/login', { username: 'beth', password: made.json.tempPassword });
  await w.post('/api/auth/onboarding', { username: 'beth', password: PW });
  pid = (await w.post('/api/projects', { name: 'Bicycle', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  dir = path.join(h.ws, 'projects', pid);
  assert.equal((await w.put(`${URL()}/applicability`, { model: MODEL })).status, 200);

  const icn = path.join(FIX, '..', 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg');
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(icn)]), path.basename(icn)); fd.append('dir', 'csdb');
  await w.req('POST', `${URL()}/media`, fd);

  // descript: always printed, with an element for Mk1 only and one for maintenance level 1 or 2
  const descFile = pick('040');
  let desc = fs.readFileSync(path.join(FIX, descFile), 'utf8').replace(/<applic>[\s\S]*?<\/applic>/, `${ACT_REF}<applic><displayText><simplePara>All</simplePara></displayText></applic>`);
  desc = desc.replace('<content>', `<content><referencedApplicGroup><applic id="app-mk1">${assertXml('version', 'prodattr', 'Mk1')}</applic><applic id="app-ml">${assertXml('mntlvl', 'condition', 'ml01|ml02')}</applic></referencedApplicGroup>`)
    .replace('</description>', `<levelledPara><title>Always</title><para>${ALWAYS}</para></levelledPara><levelledPara><title>Mk1 notes</title><para applicRefId="app-mk1">${MK1}</para></levelledPara><levelledPara><title>Level notes</title><para applicRefId="app-ml">${ML}</para></levelledPara></description>`);
  // proced for the mountain bicycle, fault for the road bicycle (DM-level applicability)
  const proced = dmLevel(fs.readFileSync(path.join(FIX, pick('520')), 'utf8'), assertXml('type', 'prodattr', 'Mountain bicycle')).replace('<mainProcedure>', `<mainProcedure><proceduralStep><para>${PROCED}</para></proceduralStep>`);
  const fault = dmLevel(fs.readFileSync(path.join(FIX, pick('421')), 'utf8'), assertXml('type', 'prodattr', 'Road bicycle')).replace('<action>Check the system indicator.</action>', `<action>Check the system indicator. ${FAULT}</action>`);
  for (const [f, xml] of [[descFile, desc], [pick('520'), proced], [pick('421'), fault]]) {
    const r = await w.post(`${URL()}/dms`, { file: f, xml });
    assert.equal(r.status, 201, `${f}: ${JSON.stringify(r.json)}`);
  }
  // the publication: chapter 1 holds the descriptive and the procedure, chapter 2 (road bicycle only) holds the fault module
  const dmRef = (f) => { const m = /<dmCode\s+([^>]*?)\s*\/?>/.exec(fs.readFileSync(path.join(FIX, f), 'utf8'))[1]; return `<dmRef><dmRefIdent><dmCode ${m}/></dmRefIdent></dmRef>`; };
  const pm = fs.readFileSync(path.join(dir, 'publication.xml'), 'utf8');
  const content = `<content><pmEntry><pmEntryTitle>Maintenance</pmEntryTitle>${dmRef(descFile)}${dmRef(pick('520'))}</pmEntry><pmEntry><pmEntryTitle>Road bicycle faults</pmEntryTitle>${dmRef(pick('421'))}</pmEntry></content>`;
  fs.writeFileSync(path.join(dir, 'publication.xml'), /<content[\s\S]*<\/content>|<content\s*\/>/.test(pm) ? pm.replace(/<content[\s\S]*<\/content>|<content\s*\/>/, content) : pm.replace('</pm>', `${content}</pm>`));
});
test.after(async () => { await h.close(); });

// ── the evaluator, on its own ────────────────────────────────────────────────
const EV = () => require('../dist/services/applicEval');
const applicOf = (inner) => new DOMParser().parseFromString(`<applic>${inner}</applic>`, 'text/xml').documentElement;
const sel = (obj) => ({ values: new Map(Object.entries(obj)), productId: null, label: '', slug: '', summary: [] });

test('values: single, set, numeric range, text range', () => {
  const { valuesMatch } = EV();
  assert.equal(valuesMatch('Mk1', ['Mk1']), true); assert.equal(valuesMatch('Mk1', ['Mk2']), false);
  assert.equal(valuesMatch('Mk1|Mk2', ['Mk2']), true);
  assert.equal(valuesMatch('1~2|5~10', ['7']), true); assert.equal(valuesMatch('1~2|5~10', ['3']), false);
  assert.equal(valuesMatch('9~10', ['10']), true, 'numeric, not text, comparison: 10 is within 9~10');
  assert.equal(valuesMatch('1B070643~1B070699', ['1B070650']), true); assert.equal(valuesMatch('1B070643~1B070699', ['1B070700']), false);
  assert.equal(valuesMatch('Mk1', ['Mk2', 'Mk1']), true, 'any selected value may match');
});

test('three-valued logic: unresolved is not satisfied; false AND x and true OR x decide', () => {
  const { evalApplic } = EV();
  const a = (id, v) => assertXml(id, 'prodattr', v);
  const run = (inner, s) => evalApplic(applicOf(inner), sel(s));
  assert.deepEqual(run(a('version', 'Mk1'), { version: ['Mk1'] }), { result: true, unresolved: [] });
  assert.deepEqual(run(a('version', 'Mk1'), {}), { result: null, unresolved: ['version'] });
  assert.equal(run(`<evaluate andOr="and">${a('version', 'Mk1')}${a('type', 'x')}</evaluate>`, { version: ['Mk2'] }).result, false, 'false AND unresolved = false');
  assert.deepEqual(run(`<evaluate andOr="and">${a('version', 'Mk1')}${a('type', 'x')}</evaluate>`, { version: ['Mk1'] }), { result: null, unresolved: ['type'] });
  assert.equal(run(`<evaluate andOr="or">${a('version', 'Mk1')}${a('type', 'x')}</evaluate>`, { version: ['Mk1'] }).result, true, 'true OR unresolved = true');
  assert.deepEqual(run(`<evaluate andOr="or">${a('version', 'Mk1')}${a('type', 'x')}</evaluate>`, { version: ['Mk2'] }), { result: null, unresolved: ['type'] });
  assert.deepEqual(run('<displayText><simplePara>Only text</simplePara></displayText>', {}), { result: true, unresolved: [] }, 'display text alone asserts nothing');
  assert.equal(run(`<evaluate andOr="and">${a('version', 'Mk1')}<evaluate andOr="or">${a('type', 'Road bicycle')}${a('type', 'Mountain bicycle')}</evaluate></evaluate>`, { version: ['Mk1'], type: ['Mountain bicycle'] }).result, true, 'nested');
});

// ── configuration planning and building ──────────────────────────────────────
test('the configuration choices are listed: products, attributes with values, conditions', async () => {
  const r = (await w.get(`${URL()}/publish/configurations`)).json;
  assert.deepEqual(r.products.map((p) => p.id), ['MTB-MK1', 'ROAD-MK2']);
  assert.deepEqual(r.attributes.find((a) => a.id === 'version').values, ['Mk1', 'Mk2', 'Mk9']);
  assert.deepEqual(r.conditions[0].values, ['ml01', 'ml02', 'ml03']);
  assert.deepEqual(r.builds, []);
});

test('bad configurations are refused with the reason', async () => {
  const post = (b) => w.post(`${URL()}/publish/configured/plan`, b);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ productId: 'NOPE' })).json.code, 'NO_SUCH_PRODUCT');
  const bad = await post({ values: [{ ident: 'version', value: 'Mk7' }, { ident: 'ghost', value: 'x' }] });
  assert.equal(bad.status, 400); assert.match(bad.json.problems.join(' '), /"Mk7" is not one of the declared values/); assert.match(bad.json.problems.join(' '), /"ghost" is not a product attribute or condition/);
});

test('UNRESOLVED: a product that gives no maintenance level cannot be published - every place is listed, nothing is built', async () => {
  const plan = (await w.post(`${URL()}/publish/configured/plan`, { productId: 'MTB-MK1' })).json;
  assert.equal(plan.canBuild, false);
  assert.deepEqual(plan.properties, ['mntlvl']);
  assert.ok(plan.unresolved.some((u) => /referencedApplicGroup|para/.test(u.location) || /applicRefId="app-ml"/.test(u.what)));
  assert.ok(plan.unresolved[0].line >= 1);
  const r = await w.post(`${URL()}/publish/configured`, { productId: 'MTB-MK1' });
  assert.equal(r.status, 422); assert.equal(r.json.code, 'APPLICABILITY_UNRESOLVED'); assert.match(r.json.error, /"mntlvl"/);
  assert.deepEqual((await w.get(`${URL()}/publish/configurations`)).json.builds, [], 'no PDF was made');
});

test('mountain bicycle, maintenance level 1: the procedure and the Mk1 paragraph are in; the road-bicycle module and its chapter are out', async () => {
  const before = Object.fromEntries(fs.readdirSync(path.join(dir, 'csdb')).filter((f) => /^DMC/.test(f)).map((f) => [f, sha(path.join(dir, 'csdb', f))]));
  const body = { productId: 'MTB-MK1', values: [{ ident: 'mntlvl', value: 'ml01' }] };
  const plan = (await w.post(`${URL()}/publish/configured/plan`, body)).json;
  assert.equal(plan.canBuild, true);
  assert.deepEqual(plan.excluded, [pick('421')]);
  assert.equal(plan.summary.included, 2); assert.equal(plan.summary.elementsRemoved, 0); assert.equal(plan.summary.entriesRemoved >= 2, true, 'the fault module reference and the chapter it leaves empty');
  const r = await w.post(`${URL()}/publish/configured`, body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.name, /MTB-MK1/, 'named after the product');
  const pdf = await w.get(`${URL()}/publish/configured/${encodeURIComponent(r.json.name)}`);
  const t = await text(pdf.buf);
  assert.ok(has(t, ALWAYS) && has(t, PROCED) && has(t, MK1) && has(t, ML), 'applicable content is printed');
  assert.ok(!has(t, FAULT), 'the road-bicycle fault module is not');
  assert.equal(plan.summary.entriesLeft, 1, 'the road-bicycle chapter is gone from the publication module, not just emptied');
  // sources untouched, work directory gone
  for (const [f, hsh] of Object.entries(before)) assert.equal(sha(path.join(dir, 'csdb', f)), hsh, `${f} is unchanged`);
  assert.equal(fs.existsSync(path.join(dir, '.configured', 'MTB-MK1')), false);
  assert.equal((await w.get(`${URL()}/publish/configurations`)).json.builds.length, 1);
});

test('road bicycle Mk2, level 3: the Mk1 and level-1/2 elements are removed, the procedure is out, the fault chapter stays', async () => {
  const body = { productId: 'ROAD-MK2', values: [{ ident: 'mntlvl', value: 'ml03' }] };
  const plan = (await w.post(`${URL()}/publish/configured/plan`, body)).json;
  assert.deepEqual(plan.excluded, [pick('520')]);
  assert.equal(plan.summary.elementsRemoved, 2);
  const r = await w.post(`${URL()}/publish/configured`, body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const t = await text((await w.get(`${URL()}/publish/configured/${encodeURIComponent(r.json.name)}`)).buf);
  assert.ok(has(t, ALWAYS) && has(t, FAULT));
  assert.equal(plan.summary.entriesLeft, 2, 'both chapters remain (the maintenance chapter still holds the descriptive module)');
  assert.ok(!has(t, MK1) && !has(t, ML) && !has(t, PROCED), 'Mk1 paragraph, level 1/2 paragraph and the mountain procedure are not printed');
  assert.notEqual(r.json.name, (await w.get(`${URL()}/publish/configurations`)).json.builds.find((b) => /MTB/.test(b.name)).name, 'a separate PDF per configuration');
});

test('ad-hoc configuration without a product is named after its values; the unfiltered publication is unchanged', async () => {
  const body = { values: [{ ident: 'type', value: 'Mountain bicycle' }, { ident: 'version', value: 'Mk2' }, { ident: 'mntlvl', value: 'ml02' }] };
  const r = await w.post(`${URL()}/publish/configured`, body);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.name, /mntlvl-ml02/); assert.match(r.json.name, /version-Mk2/);
  assert.equal(r.json.plan.productId, null);
  // the normal build still contains EVERYTHING
  const b = await w.post(`${URL()}/publish`, {});
  assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 300));
  const full = await text((await w.get(`${URL()}/publish/pdf`)).buf);
  for (const m of [ALWAYS, PROCED, FAULT, MK1, ML]) assert.ok(has(full, m), `unfiltered build still prints ${m}`);
});

test('configuration names cannot collide, and a configuration PDF never claims a release', async () => {
  const cfg = (ml) => ({ values: [{ ident: 'type', value: 'Road bicycle' }, { ident: 'version', value: 'Mk2' }, { ident: 'mntlvl', value: ml }] });
  const a = await w.post(`${URL()}/publish/configured`, cfg('ml01'));
  const b = await w.post(`${URL()}/publish/configured`, cfg('ml02'));
  assert.equal(a.status, 201, JSON.stringify(a.json)); assert.equal(b.status, 201, JSON.stringify(b.json));
  assert.notEqual(a.json.name, b.json.name, 'different values, different file');
  assert.equal(a.json.releaseLabel, '', 'derived content is not covered by a release');
  assert.ok(has(await text((await w.get(`${URL()}/publish/configured/${encodeURIComponent(a.json.name)}`)).buf), 'NOT RELEASED'), 'and is stamped NOT RELEASED');
  // the same configuration is the same file (rebuilt in place)
  const again = await w.post(`${URL()}/publish/configured`, cfg('ml01'));
  assert.equal(again.json.name, a.json.name);
});

test('the gate: an applicability ERROR blocks build, preview and release; a warning does not', async () => {
  const f = pick('040');
  const cur = (await w.get(`${URL()}/dms/${f}`)).json;
  const broken = cur.xml.replace(`applicRefId="app-mk1"`, `applicRefId="app-missing"`);
  assert.equal((await w.put(`${URL()}/dms/${f}`, { xml: broken, baseHash: cur.hash })).status, 200, 'saving a draft is allowed');
  for (const req of [() => w.post(`${URL()}/publish`, {}), () => w.req('POST', `${URL()}/publish/preview/${f}`, {}), () => w.post(`${URL()}/publish/configured`, { productId: 'MTB-MK1', values: [{ ident: 'mntlvl', value: 'ml01' }] })]) {
    const r = await req();
    assert.equal(r.status, 422, JSON.stringify(r.json ?? '').slice(0, 200));
    assert.equal(r.json.code, 'VALIDATION_FAILED');
    assert.ok(r.json.findings.some((x) => /app-missing/.test(x.detail) || x.kind === 'schema'), 'the dangling reference is named (by the applicability check or the schema)');
  }
  const again = (await w.get(`${URL()}/dms/${f}`)).json;
  assert.equal((await w.put(`${URL()}/dms/${f}`, { xml: cur.xml, baseHash: again.hash })).status, 200);
  assert.equal((await w.post(`${URL()}/publish`, {})).status, 200, 'fixed: builds again');
});

test('every module a publication module names is validated and filtered - also the second dmRef of one <pmEntry> (the editor model keeps only the first)', async () => {
  const f = pick('520');
  const cur = (await w.get(`${URL()}/dms/${f}`)).json;
  assert.equal((await w.put(`${URL()}/dms/${f}`, { xml: cur.xml.replace('<mainProcedure>', '<mainProcedure><notAnElement/>'), baseHash: cur.hash })).status, 200);
  const r = await w.post(`${URL()}/publish`, {});
  assert.equal(r.status, 422, 'the module is only the SECOND reference in its entry, and must still block the publication');
  assert.ok(r.json.modules.includes(f));
  const again = (await w.get(`${URL()}/dms/${f}`)).json;
  assert.equal((await w.put(`${URL()}/dms/${f}`, { xml: cur.xml, baseHash: again.hash })).status, 200);
});

test('the JSS engine builds a configuration PDF too, with the same filtering', async () => {
  assert.equal((await w.patch(`/api/projects/${pid}`, { pipeline: 's1000dtojss' })).status, 200);
  const body = { productId: 'ROAD-MK2', values: [{ ident: 'mntlvl', value: 'ml03' }] };
  const r = await w.post(`${URL()}/publish/configured`, body);
  assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 400));
  const t = await text((await w.get(`${URL()}/publish/configured/${encodeURIComponent(r.json.name)}`)).buf);
  assert.ok(has(t, ALWAYS) && has(t, FAULT), 'applicable content is printed');
  assert.ok(!has(t, MK1) && !has(t, ML) && !has(t, PROCED), 'what does not apply is not');
  assert.equal((await w.patch(`/api/projects/${pid}`, { pipeline: 's1000dtofo' })).status, 200);
});
