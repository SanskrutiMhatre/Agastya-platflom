'use strict';
// S1000D reference configuration: catalogues with provenance, SNS (presets + project hierarchy), project configuration,
// server-side rules for new data modules, project isolation, and administrator impact confirmation.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let pm; let alice; let bob;

async function person(creator, role, username, fullName) {
  const made = await creator.post('/api/team/users', { username, fullName, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username);
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}

/** A minimal data module the server will accept (well-formed, a <dmodule> root); the XSD/BREX judge it later, not creation. */
function dm({ mic = 'TESTMIC', issue = '5-0', schema = 'descript', sys = '21', sub = '10', assy = '00', info = '040', ilc = 'A', lang = 'en', country = 'IN' } = {}) {
  const sub1 = sub[0], sub2 = sub[1];
  const dir = issue === '4-2' ? 'S1000D_4-2' : issue === '5-0' ? 'S1000D_5-0' : issue === '6' ? 'S1000D_6' : 'S1000D_7';
  const file = `DMC-${mic}-A-${sys}-${sub}-${assy}-00A-${info}A-${ilc}_001-00_${lang.toUpperCase()}-${country}.xml`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/${dir}/xml_schema_flat/${schema}.xsd">
<identAndStatusSection><dmAddress><dmIdent>
<dmCode modelIdentCode="${mic}" systemDiffCode="A" systemCode="${sys}" subSystemCode="${sub1}" subSubSystemCode="${sub2}" assyCode="${assy}" disassyCode="00" disassyCodeVariant="A" infoCode="${info}" infoCodeVariant="A" itemLocationCode="${ilc}"/>
<language languageIsoCode="${lang}" countryIsoCode="${country}"/><issueInfo issueNumber="001" inWork="00"/></dmIdent>
<dmAddressItems><issueDate year="2026" month="01" day="01"/><dmTitle><techName>T</techName></dmTitle></dmAddressItems></dmAddress>
<dmStatus issueType="new"><security securityClassification="01"/></dmStatus></identAndStatusSection><content><description><para>x</para></description></content></dmodule>`;
  return { file, xml };
}

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  pm = await person(admin, 'project_manager', 'meera', 'Meera Rao');
  alice = await person(pm, 'author', 'alice', 'Alice Author');
  bob = await person(pm, 'author', 'bob', 'Bob Author');
});
test.after(async () => { await h.close(); });

const catalogue = async (c, issue, kind = 'infoCode') => (await c.get(`/api/s1000d/catalogue?issue=${issue}&kind=${kind}`)).json;

// ── Catalogue ────────────────────────────────────────────────────────────────

test('catalogue: every issue is read from its own default BREX, with provenance (file, sha-256, rule)', async () => {
  // 588/591/593/593 BREX values per issue = 574/577/579/579 listed codes + 14 "project available" RANGES (patterns, not codes)
  const want = { '4-2': 574, '5-0': 577, '6': 579, '7': 579 };
  for (const [issue, n] of Object.entries(want)) {
    const cat = await catalogue(alice, issue);
    assert.equal(cat.codes.length, n, `Issue ${issue}: ${n} listed information codes`);
    assert.equal(cat.ranges.length, 14, 'and 14 project-available ranges');
    assert.ok(cat.ranges.every((r) => r.title === 'Project available' && r.ruleId === 'BREX-S1-00180'));
    assert.equal(cat.rule, 'BREX-S1-00180');
    assert.ok(cat.codes.every((c) => c.origin === 'brex' && c.ruleId === 'BREX-S1-00180' && c.sourceId === `brex:${issue}`));
    const src = cat.sources.find((s) => s.id === `brex:${issue}`);
    assert.match(src.sha256, /^[0-9a-f]{64}$/);
    assert.match(src.file, /^DMC-S1000D-[FGHJ]-04-10-0301-00A-022A-D/);
    // the recorded hash is the hash of the shipped file
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'brex', src.file));
    assert.equal(src.sha256, require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal((await catalogue(alice, '6', 'learnCode')).codes.length, 125);
  assert.equal((await catalogue(alice, '6', 'learnEventCode')).codes.length, 5);
  assert.equal((await catalogue(alice, '6', 'itemLocationCode')).codes.length, 5);
});

test('catalogue: issue differences are real (4.2 -> 5.0 adds 025, 026, 235) and 6 equals 7', async () => {
  const set = async (i) => new Set((await catalogue(alice, i)).codes.map((c) => c.code));
  const [a, b, c6, c7] = [await set('4-2'), await set('5-0'), await set('6'), await set('7')];
  for (const code of ['025', '026', '235']) { assert.ok(!a.has(code), `${code} not in 4.2`); assert.ok(b.has(code), `${code} in 5.0`); }
  assert.deepEqual([...c6].sort(), [...c7].sort());
});

test('catalogue: all 21 DM-type defaults exist in all four issues; the six formerly-unresolved defaults carry specification evidence, and what is still open stays flagged', async () => {
  const types = (await admin.get('/api/admin/config/dm-types')).json.items;
  assert.equal(types.length, 21);
  const ov = (await admin.get('/api/admin/s1000d/overview')).json;
  // after reading the 4.2 specification: crew/frontmatter/schedul confirmed or supported, wrngflds corrected to 029; wrngdata and scocontent are still open
  assert.deepEqual(Object.keys(ov.evidence.types).sort(), ['crew', 'frontmatter', 'schedul', 'scocontent', 'wrngdata', 'wrngflds']);
  assert.deepEqual(Object.fromEntries(Object.entries(ov.evidence.types).map(([k, v]) => [k, v.status])),
    { crew: 'supported', frontmatter: 'confirmed', schedul: 'confirmed', wrngflds: 'corrected', wrngdata: 'multiple', scocontent: 'unresolved' });
  assert.deepEqual(Object.keys(ov.unresolved).sort(), ['scocontent', 'wrngdata'], 'only what the specification does not settle stays flagged');
  assert.match(ov.evidence.limitation, /Issue 4\.2 text only/);
  for (const e of Object.values(ov.evidence.types)) assert.ok(e.refs.length && e.note, 'every verdict cites the chapters it was read from');
  assert.equal(types.find((t) => t.schema === 'wrngflds').infoCode, '029', 'the corrected default');
  assert.equal(types.find((t) => t.schema === 'crew').infoCode, '131', 'supported defaults are not changed');
  assert.equal(types.find((t) => t.schema === 'wrngdata').infoCode, '000', 'an unresolved placeholder is not replaced');
  for (const issue of ['4-2', '5-0', '6', '7']) {
    const cat = new Set((await catalogue(alice, issue)).codes.map((c) => c.code));
    const adv = ov.advice[issue];
    assert.equal(adv.length, 21);
    for (const a of adv) {
      assert.ok(a.defaultInCatalogue, `${a.schema}: default ${a.defaultCode} is in the ${issue} catalogue`);
      assert.equal(!!a.unresolved, ['scocontent', 'wrngdata'].includes(a.schema));
      for (const c of a.evidence?.codes ?? []) assert.ok(cat.has(c), `${a.schema}: the specification's code ${c} exists in the Issue ${issue} catalogue`);
    }
    assert.deepEqual(adv.find((a) => a.schema === 'wrngdata').recommended.slice(0, 4), ['031', '056', '057', '058'], 'the specification pairs these codes with the wiring data schema');
    assert.ok(adv.find((a) => a.schema === 'crew').recommended.includes('131'));
    assert.equal(adv.find((a) => a.schema === 'frontmatter').defaultCode, '001');
  }
});

test('catalogue: DM-type compatibility is advice - a code recommended for no type is still selectable, and BREX rows are read-only', async () => {
  const ov = (await admin.get('/api/admin/s1000d/overview')).json;
  const proced = ov.advice['5-0'].find((a) => a.schema === 'proced');
  assert.ok(proced.recommended.includes('520'));
  // BREX rows cannot be edited or deleted
  assert.equal((await admin.put('/api/admin/s1000d/codes', { kind: 'infoCode', issue: '5-0', code: '040', title: 'x' })).status, 409);
  assert.equal((await admin.del('/api/admin/s1000d/codes?kind=infoCode&issue=5-0&code=040')).status, 409);
  // custom codes: format-checked, unique, flagged as outside the BREX
  assert.equal((await admin.post('/api/admin/s1000d/codes', { kind: 'infoCode', issue: '5-0', code: '0', title: 'x' })).status, 400);
  assert.equal((await admin.post('/api/admin/s1000d/codes', { kind: 'infoCode', issue: '5-0', code: '040', title: 'dup' })).status, 409);
  const made = await admin.post('/api/admin/s1000d/codes', { kind: 'infoCode', issue: '5-0', code: 'Z9Z', title: 'Customer code' });
  assert.equal(made.status, 201);
  assert.match(made.json.note, /not in the default BREX/);
  assert.equal((await catalogue(alice, '5-0')).codes.length, 578);
  assert.equal(made.json.brexAccepts, false, 'Z9Z is outside every listed code and range');
  assert.equal((await catalogue(alice, '6')).codes.length, 579, 'another issue is untouched');
  // a code inside a "project available" range IS accepted by the default BREX
  const inRange = await admin.post('/api/admin/s1000d/codes', { kind: 'infoCode', issue: '5-0', code: '01A', title: 'Project-defined' });
  assert.equal(inRange.status, 201); assert.equal(inRange.json.brexAccepts, true); assert.match(inRange.json.note, /project available/);
  assert.equal((await admin.del('/api/admin/s1000d/codes?kind=infoCode&issue=5-0&code=01A')).status, 200);
  // only administrators change the catalogue
  assert.equal((await pm.post('/api/admin/s1000d/codes', { kind: 'infoCode', issue: '5-0', code: 'Y9Y', title: 'x' })).status, 403);
  assert.equal((await admin.del('/api/admin/s1000d/codes?kind=infoCode&issue=5-0&code=Z9Z')).status, 200);
  assert.equal((await catalogue(alice, '5-0')).codes.length, 577);
});

// ── SNS presets ──────────────────────────────────────────────────────────────

test('SNS presets: the 4.2 Maintained SNS tables are read-only presets with provenance and limitations', async () => {
  const list = (await alice.get('/api/s1000d/presets')).json.presets;
  const spec = list.filter((p) => p.id.startsWith('spec42-'));
  assert.equal(spec.length, 8);
  assert.ok(spec.every((p) => p.readOnly && /S1000D Issue 4\.2, Chap 8\.2\.\d/.test(p.source) && /Issue 4\.2 only/.test(p.limitation)));
  const generic = (await alice.get('/api/s1000d/presets/spec42-8-2-1')).json;
  assert.equal(generic.nodes.filter((n) => n.level === 1).length, 14, 'Chap 8.2.1 prints 14 systems (00, 04-12, 14-16, 18)');
  assert.ok(generic.nodes.some((n) => n.path === '00' && n.title === 'Product, General'));
  assert.ok(generic.nodes.some((n) => n.path === '15/00' || n.path.startsWith('15/')));
  // a read-only preset cannot be changed
  assert.equal((await admin.put('/api/admin/s1000d/presets/spec42-8-2-1/nodes', { path: '99', title: 'x' })).status, 409);
  assert.equal((await admin.del('/api/admin/s1000d/presets/spec42-8-2-1')).status, 409);
  // the specification defines 42, 46 and 72 twice in Chap 8.2.5: both are kept, flagged ambiguous
  const air = (await alice.get('/api/s1000d/presets/spec42-8-2-5')).json;
  assert.ok(air.nodes.filter((n) => n.note.ambiguous).length >= 6);
  assert.ok(air.nodes.some((n) => n.path === '42#2'));
});

test('SNS presets: a custom preset can belong to a model code; read-only presets cannot', async () => {
  const p = (await admin.post('/api/admin/s1000d/presets', { name: 'Radar SNS', model: 'rdr' })).json.preset;
  assert.equal(p.model, 'RDR', 'stored upper-case');
  assert.equal((await admin.post('/api/admin/s1000d/presets', { name: 'Bad model', model: 'x' })).status, 400);
  assert.equal((await admin.put(`/api/admin/s1000d/presets/${p.id}/model`, { model: '' })).json.preset.model, null);
  assert.equal((await admin.put(`/api/admin/s1000d/presets/${p.id}/model`, { model: 'ABC12' })).json.preset.model, 'ABC12');
  assert.equal((await admin.put('/api/admin/s1000d/presets/spec42-8-2-1/model', { model: 'ABC' })).status, 409, 'read-only');
  assert.equal((await alice.get('/api/s1000d/presets')).json.presets.find((x) => x.id === p.id).model, 'ABC12', 'the wizard sees it');
  await admin.del(`/api/admin/s1000d/presets/${p.id}`);
});

test('SNS presets: the Administrator makes custom presets; hierarchy rules hold', async () => {
  const p = (await admin.post('/api/admin/s1000d/presets', { name: 'Pump skid' })).json.preset;
  assert.equal((await admin.post('/api/admin/s1000d/presets', { name: 'pump SKID' })).status, 409, 'names are unique');
  assert.equal((await admin.put(`/api/admin/s1000d/presets/${p.id}/nodes`, { path: '21/10', title: 'x' })).status, 400, 'a subsystem needs its system');
  assert.equal((await admin.put(`/api/admin/s1000d/presets/${p.id}/nodes`, { path: '21', title: 'Pumps' })).status, 200);
  assert.equal((await admin.put(`/api/admin/s1000d/presets/${p.id}/nodes`, { path: '21/10', title: 'Main pump' })).status, 200);
  assert.equal((await admin.del(`/api/admin/s1000d/presets/${p.id}/nodes?path=21`)).status, 409, 'a node with children is not deleted alone');
  assert.equal((await admin.del(`/api/admin/s1000d/presets/${p.id}/nodes?path=21&cascade=true`)).json.removed, 2);
  const copy = (await admin.post('/api/admin/s1000d/presets/spec42-8-2-1/duplicate', { name: 'My generic' })).json.preset;
  assert.ok(copy.entries > 50 && !copy.readOnly);
  assert.equal((await admin.del(`/api/admin/s1000d/presets/${copy.id}`)).status, 200);
  assert.equal((await alice.post('/api/admin/s1000d/presets', { name: 'x' })).status, 403);
});

// ── Project configuration ────────────────────────────────────────────────────

let P1; let P2;
test('project creation: configuration is validated, stored, and isolated per project', async () => {
  const bad = await alice.post('/api/projects', { name: 'Bad MIC', s1000d: { mic: 'x', issue: '5.0' } });
  assert.equal(bad.status, 400);
  assert.equal((await alice.get('/api/projects')).json.projects.length, 0, 'a refused configuration leaves no half-made project');
  assert.equal((await alice.post('/api/projects', { name: 'Bad issue', s1000d: { mic: 'ABCD', issue: '3.9' } })).status, 400);
  assert.equal((await alice.post('/api/projects', { name: 'Bad enterprise', s1000d: { mic: 'ABCD', issue: '5.0', responsiblePartner: { code: 'A', name: 'x' } } })).status, 400);

  const a = await alice.post('/api/projects', {
    name: 'Pump Manual', s1000d: { mic: 'pumpx', issue: '6.0', language: 'en', country: 'IN', responsiblePartner: { code: 'ABC12', name: 'Acme Ltd' }, codeMode: 'selected', enabledCodes: ['040', '520', '000'], snsPreset: 'spec42-8-2-1', snsSystems: ['00', '05'] },
  });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  P1 = a.json.project.id;
  const cfg1 = (await alice.get(`/api/projects/${P1}/s1000d`)).json;
  assert.equal(cfg1.config.mic, 'PUMPX');
  assert.equal(cfg1.config.issue, '6');
  assert.equal(cfg1.config.origin.by, 'wizard');
  assert.deepEqual(cfg1.codes.infoCode.map((c) => c.code), ['000', '040', '520']);
  assert.deepEqual(cfg1.sns.filter((n) => n.level === 1).map((n) => n.code), ['00', '05']);
  assert.equal(cfg1.dmTypes.length, 21);

  // a second project is fully independent
  const b = await bob.post('/api/projects', { name: 'Hull Manual', s1000d: { mic: 'HULLY', issue: '4.2' } });
  P2 = b.json.project.id;
  const cfg2 = (await bob.get(`/api/projects/${P2}/s1000d`)).json;
  assert.equal(cfg2.config.mic, 'HULLY');
  assert.equal(cfg2.codes.infoCode.length, 574, 'codeMode all: the 4.2 catalogue');
  assert.equal(cfg2.sns.length, 0, 'no SNS leaks from another project');
  assert.equal((await bob.get(`/api/projects/${P1}/s1000d`)).status, 404, 'a non-member sees nothing');
});

test('project configuration: owners/managers change it, others cannot; MIC and issue lock once data modules exist', async () => {
  const pr = (await alice.post('/api/projects', { name: 'Lock Test', s1000d: { mic: 'LOCKME', issue: '5.0' } })).json.project.id;
  // before any data module: changeable
  assert.equal((await alice.put(`/api/projects/${pr}/s1000d`, { config: { mic: 'LOCKM2' } })).status, 200);
  assert.equal((await alice.put(`/api/projects/${pr}/s1000d`, { config: { mic: 'LOCKME' } })).status, 200);
  const d = dm({ mic: 'LOCKME', issue: '5-0' });
  assert.equal((await alice.post(`/api/projects/${pr}/dms`, d)).status, 201);
  const lock = (await alice.get(`/api/projects/${pr}/s1000d`)).json.lock;
  assert.deepEqual(lock.fields, ['mic', 'issue']);
  assert.match(lock.explanation, /create a new project/);
  const refuse = await alice.put(`/api/projects/${pr}/s1000d`, { config: { mic: 'OTHER1' } });
  assert.equal(refuse.status, 409); assert.equal(refuse.json.code, 'CONFIG_LOCKED'); assert.match(refuse.json.error, /new project/);
  assert.equal((await alice.put(`/api/projects/${pr}/s1000d`, { config: { issue: '6.0' } })).status, 409);
  // everything else stays editable
  assert.equal((await alice.put(`/api/projects/${pr}/s1000d`, { config: { language: 'fr', country: 'FR' } })).status, 200);
  // an editor (project role) can author but not configure
  const ed = await person(pm, 'author', 'edie', 'Edie Editor');
  assert.equal((await alice.post(`/api/projects/${pr}/assign`, { username: 'edie', role: 'editor' })).status, 200);
  assert.equal((await ed.get(`/api/projects/${pr}/s1000d`)).status, 200);
  assert.equal((await ed.put(`/api/projects/${pr}/s1000d`, { config: { language: 'de' } })).status, 403);
  assert.equal((await ed.post(`/api/projects/${pr}/sns`, { path: '21', title: 'x' })).status, 403);
});

test('new data modules (and imports) are held to the project configuration by the SERVER; "import without validation" is the explicit escape', async () => {
  const pr = (await alice.post('/api/projects', {
    name: 'Rules', s1000d: { mic: 'RULES', issue: '5.0', codeMode: 'selected', enabledCodes: ['040', '520'], snsPreset: 'spec42-8-2-1', snsSystems: ['00', '05'], dmTypes: ['descript', 'proced'] },
  })).json.project.id;
  const post = (o) => alice.post(`/api/projects/${pr}/dms`, dm(o));
  assert.equal((await post({ mic: 'RULES', sys: '00', sub: '00', info: '040' })).status, 201, 'a conforming module is created');
  const wrongMic = await post({ mic: 'OTHER', sys: '00', sub: '00', info: '520' });
  assert.equal(wrongMic.status, 400); assert.match(wrongMic.json.error, /model identification code is OTHER, but this project's is RULES/);
  assert.match((await post({ mic: 'RULES', sys: '00', sub: '00', info: '520', issue: '6' })).json.error, /Issue 6\.0, but this project is Issue 5\.0/);
  assert.match((await post({ mic: 'RULES', sys: '00', sub: '00', info: '041' })).json.error, /Information code 041 is not enabled/);
  assert.match((await post({ mic: 'RULES', sys: '99', sub: '00', info: '040' })).json.error, /System 99 is not in this project's SNS/);
  assert.match((await post({ mic: 'RULES', sys: '00', sub: '77', info: '040' })).json.error, /Subsystem 00-77 is not in this project's SNS/);
  assert.match((await post({ mic: 'RULES', sys: '00', sub: '00', assy: '01', info: '040', schema: 'fault' })).json.error, /does not offer the "fault" data module type/);
  // an import is judged like a new module (all or nothing) - unless "import without validation" is chosen, which brings it in unchanged
  const fd = new FormData();
  const odd = dm({ mic: 'OTHER', sys: '99', sub: '77', info: '999' });
  fd.append('files', new Blob([odd.xml], { type: 'application/xml' }), odd.file);
  const refused = await alice.req('POST', `/api/projects/${pr}/dms-import`, fd);
  assert.equal(refused.status, 400); assert.match(refused.json.problems.join(' '), /model identification code is OTHER/);
  assert.equal((await alice.get(`/api/projects/${pr}/dms`)).json.dms.length, 1, 'nothing was imported');
  const fd2 = new FormData();
  fd2.append('files', new Blob([odd.xml], { type: 'application/xml' }), odd.file); fd2.append('skipChecks', '1');
  const imp = await alice.req('POST', `/api/projects/${pr}/dms-import`, fd2);
  assert.equal(imp.status, 200, JSON.stringify(imp.json));
  // editing an EXISTING module is never refused by these rules
  const cur = (await alice.get(`/api/projects/${pr}/dms/${odd.file}`)).json;
  assert.equal((await alice.put(`/api/projects/${pr}/dms/${odd.file}`, { xml: cur.xml.replace('<para>x</para>', '<para>y</para>'), baseHash: cur.hash })).status, 200);
});

test('project without configuration (API default) is unconstrained: nothing is enforced until the owner configures it', async () => {
  const pr = (await alice.post('/api/projects', { name: 'Loose' })).json.project.id;
  const cfg = (await alice.get(`/api/projects/${pr}/s1000d`)).json;
  assert.equal(cfg.config.issue, null); assert.equal(cfg.config.mic, ''); assert.equal(cfg.issueAssumed, true);
  assert.equal((await alice.post(`/api/projects/${pr}/dms`, dm({ mic: 'ANY', issue: '4-2' }))).status, 201);
  assert.equal((await alice.post(`/api/projects/${pr}/dms`, dm({ mic: 'ELSE', issue: '7', sys: '77' }))).status, 201);
});

test('the S1000D issue is ONE setting: the configuration drives the Validation page and cannot be contradicted there', async () => {
  const pr = (await alice.post('/api/projects', { name: 'One setting', s1000d: { mic: 'ONES', issue: '7.0' } })).json.project.id;
  assert.equal((await alice.get(`/api/projects/${pr}/validation`)).json.issue, '7.0');
  assert.equal((await alice.put(`/api/projects/${pr}/validation/issue`, { issue: '4.2' })).status, 409);
  assert.equal((await alice.put(`/api/projects/${pr}/validation/issue`, { issue: '7.0' })).status, 200);
});

// ── Project SNS ──────────────────────────────────────────────────────────────

test('project SNS: parents first, no duplicates, search, rename, move a branch, safe deletion', async () => {
  const pr = (await alice.post('/api/projects', { name: 'SNS lab', s1000d: { mic: 'SNSLAB', issue: '5.0' } })).json.project.id;
  const u = `/api/projects/${pr}/sns`;
  assert.equal((await alice.post(u, { path: '21/10', title: 'Pump' })).status, 400, 'a subsystem needs its system');
  assert.equal((await alice.post(u, { path: '2', title: 'x' })).status, 400, 'system code length');
  assert.equal((await alice.post(u, { path: '21/1', title: 'x' })).status, 400, 'subsystem code length');
  assert.equal((await alice.post(u, { path: '21', title: 'Environmental control' })).status, 201);
  assert.equal((await alice.post(u, { path: '21', title: 'again' })).status, 409);
  assert.equal((await alice.post(u, { path: '21/10', title: 'Compression' })).status, 201);
  assert.equal((await alice.post(u, { path: '21/10/00', title: 'Compressor assembly' })).status, 201);
  assert.equal((await alice.post(u, { path: '21/10/0000', title: 'Four-char assembly' })).status, 201);
  assert.equal((await alice.post(u, { path: '21/10/000', title: 'x' })).status, 400, 'assembly is 2 or 4 characters');
  assert.equal((await alice.post(u, { path: '21/10/00/00', title: 'x' })).status, 400, 'three levels only');
  const view = (await alice.get(u)).json;
  assert.equal(view.total, 4);
  assert.equal(view.tree[0].children[0].children.length, 2);
  assert.deepEqual((await alice.get(`${u}?q=compress`)).json.nodes.map((n) => n.path), ['21', '21/10', '21/10/00', '21/10/0000'].filter((p) => p === '21' || p === '21/10' || p === '21/10/00'), 'search keeps the ancestors');
  // rename + recode (moves the branch)
  assert.equal((await alice.patch(u, { path: '21/10', title: 'Compressors' })).json.node.title, 'Compressors');
  const moved = await alice.patch(u, { path: '21/10', code: '20' });
  assert.equal(moved.json.node.path, '21/20');
  assert.deepEqual((await alice.get(u)).json.nodes.map((n) => n.path), ['21', '21/20', '21/20/00', '21/20/0000']);
  assert.equal((await alice.patch(u, { path: '21/20', code: '21' })).status, 200);
  assert.equal((await alice.post(u, { path: '21/30', title: 'Other' })).status, 201);
  assert.equal((await alice.patch(u, { path: '21/30', code: '21' })).status, 409, 'cannot collide with a sibling');
  // delete: a branch is not deleted unless asked
  assert.equal((await alice.del(`${u}?path=21`)).status, 409);
  // a node data modules use cannot be recoded or deleted
  assert.equal((await alice.post(`/api/projects/${pr}/dms`, dm({ mic: 'SNSLAB', sys: '21', sub: '21', assy: '00' }))).status, 201);
  assert.equal((await alice.patch(u, { path: '21/21', code: '22' })).status, 409);
  assert.equal((await alice.del(`${u}?path=21/21/00`)).status, 409);
  assert.equal((await alice.del(`${u}?path=21&cascade=true`)).status, 409, 'the branch holds a node in use');
  assert.equal((await alice.del(`${u}?path=21/30`)).json.removed, 1);
});

test('project SNS: applying a preset reports what it skipped; import/export round-trips (CSV and JSON); bad input reports every error', async () => {
  const pr = (await alice.post('/api/projects', { name: 'SNS io', s1000d: { mic: 'SNSIO', issue: '5.0' } })).json.project.id;
  const u = `/api/projects/${pr}/sns`;
  const dry = (await alice.post(`${u}/preset`, { presetId: 'spec42-8-2-5', dryRun: true })).json.report;
  assert.equal((await alice.get(u)).json.total, 0, 'a dry run changes nothing');
  assert.ok(dry.skipped.some((s) => /more than once/.test(s.reason)), 'ambiguous systems 42/46/72 are reported, not guessed');
  assert.ok(dry.added > 400);
  const real = (await alice.post(`${u}/preset`, { presetId: 'spec42-8-2-1' })).json.report;
  assert.ok(real.added > 50);
  assert.deepEqual((await alice.post(`${u}/preset`, { presetId: 'spec42-8-2-1' })).json.report.added, 0, 'idempotent');
  const csv = (await alice.get(`${u}/export?format=csv`));
  const text = csv.buf.toString('utf8');
  assert.match(text, /^system,subsystem,assembly,title\r\n/);
  const json = (await alice.get(`${u}/export?format=json`)).json;
  assert.equal(json.format, 'agastya-sns');
  // round-trip into another project
  const p2 = (await alice.post('/api/projects', { name: 'SNS io 2', s1000d: { mic: 'SNSIO2', issue: '5.0' } })).json.project.id;
  const r1 = (await alice.post(`/api/projects/${p2}/sns/import`, { format: 'csv', text })).json.report;
  assert.equal(r1.errors.length, 0, JSON.stringify(r1.errors));
  const p3 = (await alice.post('/api/projects', { name: 'SNS io 3', s1000d: { mic: 'SNSIO3', issue: '5.0' } })).json.project.id;
  const r2 = (await alice.post(`/api/projects/${p3}/sns/import`, { format: 'json', text: JSON.stringify(json) })).json.report;
  assert.equal(r2.errors.length, 0);
  const a = (await alice.get(`/api/projects/${p2}/sns`)).json.nodes.map((n) => `${n.path}|${n.title}`);
  const b = (await alice.get(`/api/projects/${p3}/sns`)).json.nodes.map((n) => `${n.path}|${n.title}`);
  assert.deepEqual(a, b);
  assert.deepEqual(a, (await alice.get(u)).json.nodes.map((n) => `${n.path}|${n.title}`));
  // errors are reported per row, and a dry run stores nothing
  const messy = 'system,subsystem,assembly,title\n21,,,Env\n,10,,No system\n21,10,,Sub\n22,,00,Assembly without subsystem\nXYZW,,,Bad code\n';
  const rep = (await alice.post(`/api/projects/${p2}/sns/import`, { format: 'csv', text: messy, dryRun: true })).json.report;
  assert.ok(rep.errors.length >= 3);
  assert.ok(rep.errors.some((e) => e.line === 3), 'the empty system column is reported with its line number');
  assert.equal((await alice.post(`/api/projects/${p2}/sns/import`, { format: 'csv', text: 'a,b\n1,2' })).json.report.errors[0].line, 1);
  assert.ok((await alice.post(`/api/projects/${p2}/sns/import`, { format: 'json', text: '{nope' })).json.report.errors[0].message.includes('JSON'));
});

// ── Administrator: impact ────────────────────────────────────────────────────

test('catalogue changes that touch projects need confirmation, and are recorded', async () => {
  assert.equal((await admin.post('/api/admin/s1000d/codes', { kind: 'infoCode', issue: '5-0', code: 'QQ1', title: 'Customer test code' })).status, 201);
  const pr = (await alice.post('/api/projects', { name: 'Impact', s1000d: { mic: 'IMPACT', issue: '5.0', codeMode: 'selected', enabledCodes: ['040'] } })).json.project.id;
  assert.equal((await alice.put(`/api/projects/${pr}/s1000d/codes`, { kind: 'infoCode', codes: ['040', 'QQ1'] })).status, 200);
  assert.equal((await alice.post(`/api/projects/${pr}/dms`, dm({ mic: 'IMPACT', sys: '00', sub: '00', info: 'QQ1' }))).status, 201);
  const pre = (await admin.post('/api/admin/s1000d/codes/impact', { kind: 'infoCode', issue: '5-0', code: 'QQ1' })).json.impact;
  assert.equal(pre.projects.length, 1); assert.equal(pre.projects[0].selected, true); assert.equal(pre.projects[0].dmsUsing, 1);
  const refused = await admin.del('/api/admin/s1000d/codes?kind=infoCode&issue=5-0&code=QQ1');
  assert.equal(refused.status, 409); assert.equal(refused.json.code, 'IMPACT_CONFIRMATION_REQUIRED'); assert.equal(refused.json.impact.projects[0].id, pr);
  assert.equal((await admin.put('/api/admin/s1000d/codes', { kind: 'infoCode', issue: '5-0', code: 'QQ1', title: 'Renamed' })).status, 409);
  assert.equal((await admin.put('/api/admin/s1000d/codes', { kind: 'infoCode', issue: '5-0', code: 'QQ1', title: 'Renamed', confirmImpact: true })).status, 200);
  assert.equal((await admin.del('/api/admin/s1000d/codes?kind=infoCode&issue=5-0&code=QQ1&confirmImpact=true')).status, 200);
  // the project's data module is untouched, and the project no longer lists the code
  const after = (await alice.get(`/api/projects/${pr}/s1000d`)).json;
  assert.deepEqual(after.codes.infoCode.map((c) => c.code), ['040']);
  assert.equal((await alice.get(`/api/projects/${pr}/dms`)).json.dms.length, 1);
  const audit = (await admin.get('/api/admin/maintenance/audit.csv')).buf.toString('utf8');
  assert.match(audit, /catalogue\.code\.deleted/);
});

test('project copy carries configuration, SNS, codes and types - as its own copy', async () => {
  const src = (await alice.post('/api/projects', { name: 'Copy src', s1000d: { mic: 'COPYS', issue: '5.0', codeMode: 'selected', enabledCodes: ['040'], snsPreset: 'spec42-8-2-1', snsSystems: ['00'], dmTypes: ['descript'] } })).json.project.id;
  const dup = (await alice.post(`/api/projects/${src}/copy`, { name: 'Copy dst' })).json.project.id;
  const c = (await alice.get(`/api/projects/${dup}/s1000d`)).json;
  assert.equal(c.config.mic, 'COPYS'); assert.deepEqual(c.codes.infoCode.map((x) => x.code), ['040']); assert.equal(c.dmTypes.filter((t) => t.enabled).length, 1);
  assert.ok(c.sns.length > 3);
  await alice.put(`/api/projects/${dup}/s1000d`, { config: { language: 'fr' } });
  assert.equal((await alice.get(`/api/projects/${src}/s1000d`)).json.config.language, 'en', 'changing the copy does not change the source');
  assert.equal((await alice.del(`/api/projects/${dup}`)).status >= 200, true);
});

test('the shared repository (CIR) is never configured or constrained: modules of any model code and issue go in', async () => {
  const ws = (await alice.get('/api/cir')).json.workspace;
  const cfg = (await alice.get(`/api/projects/${ws}/s1000d`)).json;
  assert.equal(cfg.config.mic, ''); assert.equal(cfg.config.issue, null); assert.deepEqual(cfg.lock.fields, []);
  assert.equal((await alice.post(`/api/projects/${ws}/dms`, dm({ mic: 'CIRA', issue: '4-2', sys: '61' }))).status, 201);
  assert.equal((await alice.post(`/api/projects/${ws}/dms`, dm({ mic: 'CIRB', issue: '7', sys: '62' }))).status, 201);
  assert.deepEqual((await alice.get(`/api/projects/${ws}/s1000d`)).json.lock.fields, [], 'still unlocked after modules exist');
  // a copy of a repository module into a configured project is not held to the project's MIC (the repository is cross-MIC by design)
  const list = (await alice.get('/api/cir')).json.modules;
  const target = (await alice.post('/api/projects', { name: 'Takes CIR copy', s1000d: { mic: 'TARGET', issue: '5.0' } })).json.project.id;
  const copied = await alice.post(`/api/cir/${encodeURIComponent(list[0].id)}/copy`, { projectId: target });
  assert.equal(copied.status, 200, JSON.stringify(copied.json));
  assert.equal((await alice.get(`/api/projects/${target}/dms`)).json.dms.length, 1);
});

test('review fixes: only information codes narrow; any issue mismatch (5.0 too) is refused; a reference can be cleared; multi-issue code add is atomic; SNS edits are all-or-nothing', async () => {
  // 1. narrowing information codes leaves item location / learn codes whole (a data module code needs an item location code)
  const pr = (await alice.post('/api/projects', { name: 'Narrow', s1000d: { mic: 'NARROW', issue: '5.0', codeMode: 'selected', enabledCodes: ['040'] } })).json.project.id;
  const cfg = (await alice.get(`/api/projects/${pr}/s1000d`)).json;
  assert.deepEqual(cfg.codes.infoCode.map((c) => c.code), ['040']);
  assert.equal(cfg.codes.itemLocationCode.length, 5); assert.equal(cfg.codes.learnCode.length, 125); assert.equal(cfg.codes.learnEventCode.length, 5);
  // 2. the issue check covers every issue, in both directions
  for (const [projIssue, dmIssue] of [['5.0', '4-2'], ['5.0', '6'], ['4.2', '5-0'], ['6.0', '5-0'], ['7.0', '5-0']]) {
    const p = (await alice.post('/api/projects', { name: `Issue ${projIssue} vs ${dmIssue}`, s1000d: { mic: 'ISSUE', issue: projIssue } })).json.project.id;
    const r = await alice.post(`/api/projects/${p}/dms`, dm({ mic: 'ISSUE', issue: dmIssue }));
    assert.equal(r.status, 400, `a ${dmIssue} module in an Issue ${projIssue} project is refused`); assert.match(r.json.error, /but this project is Issue/);
  }
  assert.equal((await alice.post(`/api/projects/${pr}/dms`, dm({ mic: 'NARROW', issue: '5-0' }))).status, 201, 'the matching issue is accepted');
  // 3. an explicit null clears an applicability reference; an omitted key keeps it
  assert.equal((await alice.put(`/api/projects/${pr}/s1000d`, { config: { applicability: { act: 'DMC-NARROW-A-00-00-00-00A-00WA-D_001-00_EN-IN.xml' } } })).status, 200);
  assert.equal((await alice.put(`/api/projects/${pr}/s1000d`, { config: { language: 'en' } })).json.config.applicability.act, 'DMC-NARROW-A-00-00-00-00A-00WA-D_001-00_EN-IN.xml');
  assert.equal((await alice.put(`/api/projects/${pr}/s1000d`, { config: { applicability: { act: null } } })).json.config.applicability.act, null);
  // 4. a code that clashes in one chosen issue is added in none
  const ex = (await catalogue(alice, '5-0')).codes[0].code;
  const before = (await catalogue(alice, '4-2')).codes.length;
  const dup = await admin.post('/api/admin/s1000d/codes', { kind: 'infoCode', issues: ['4-2', '5-0'], code: ex, title: 'x' });
  assert.equal(dup.status, 409);
  assert.equal((await catalogue(alice, '4-2')).codes.length, before, 'nothing was added to the other issue');
  assert.equal((await admin.post('/api/admin/s1000d/codes', { kind: 'infoCode', issues: ['6', '6.0', '6'], code: 'RV1', title: 'ok' })).status, 201, 'the same issue named three ways is one issue');
  await admin.del('/api/admin/s1000d/codes?kind=infoCode&issue=6&code=RV1');
  // 5. an SNS edit that is refused changes nothing (not even the title)
  const sp = (await alice.post('/api/projects', { name: 'SNS atomic', s1000d: { mic: 'SNSA', issue: '5.0' } })).json.project.id;
  const u = `/api/projects/${sp}/sns`;
  await alice.post(u, { path: '21', title: 'Original' }); await alice.post(u, { path: '22', title: 'Other' });
  const clash = await alice.patch(u, { path: '21', title: 'Changed', code: '22' });
  assert.equal(clash.status, 409);
  assert.equal((await alice.get(u)).json.nodes.find((n) => n.path === '21').title, 'Original');
  const ok = await alice.patch(u, { path: '21', title: 'Changed', code: '23' });
  assert.equal(ok.json.node.path, '23'); assert.equal(ok.json.node.title, 'Changed');
});

