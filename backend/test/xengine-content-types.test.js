'use strict';
// Packages written by the older PDF Publication Tool (JSS Publisher) import into a blank JSS project like any other package:
//   * its flat layout (data modules and the publication module side by side, an empty DOCTYPE, picture names that nothing declares), and
//   * its project export (.jsspub.zip: manifest.json, project/PM, project/csdb, project/Media ...).
// Built from small synthetic packages in the same shape (the real sample is a customer document and is not part of the repository).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let w; let ZipStreamWriter;

test.before(async () => {
  h = await boot(); ({ ZipStreamWriter } = require('../dist/services/zipio'));
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'legacy', fullName: 'Legacy', role: 'author' });
  w = new h.Client('legacy'); await w.post('/api/auth/login', { username: 'legacy', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'legacy', password: PW });
});
test.after(async () => { await h.close(); });

// ── the package ─────────────────────────────────────────────────────────────────────────────────────────────
const attrs = (c) => `modelIdentCode="${c.mic}" systemDiffCode="${c.diff}" systemCode="${c.sys}" subSystemCode="${c.sub}" subSubSystemCode="0" assyCode="${c.assy}" disassyCode="${c.dis}" disassyCodeVariant="A" infoCode="${c.info}" infoCodeVariant="A" itemLocationCode="D"`;
const nameOf = (c) => `DMC-${c.mic}-${c.diff}-${c.sys}-${c.sub}0-${c.assy}-${c.dis}A-${c.info}A-D_001-00_EN-IN.xml`;
const dm = (c, techName, infoName, body) => `<?xml version="1.0" encoding="utf-8"?>
<!-- Xignal, S1000D Issue 4.2 [xml_schema_flat], Test Data -->
<!DOCTYPE dmodule []>
<dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/descript.xsd">
  <identAndStatusSection><dmAddress><dmIdent><dmCode ${attrs(c)}/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="00"/></dmIdent>
  <dmAddressItems><issueDate year="2022" month="12" day="31"/><dmTitle><techName>${techName}</techName><infoName>${infoName}</infoName></dmTitle></dmAddressItems></dmAddress>
  <dmStatus issueType="new"><security securityClassification="01"/><responsiblePartnerCompany enterpriseCode="U17V0"><enterpriseName>GPSL</enterpriseName></responsiblePartnerCompany><originator enterpriseCode="U17V0"><enterpriseName>GPSL</enterpriseName></originator><applic><displayText><simplePara>All</simplePara></displayText></applic><brexDmRef><dmRef><dmRefIdent><dmCode modelIdentCode="X1" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="A" itemLocationCode="D"/></dmRefIdent></dmRef></brexDmRef><qualityAssurance><firstVerification verificationType="tabtop"/></qualityAssurance></dmStatus></identAndStatusSection>
  <content><description>${body}</description></content>
</dmodule>`;
const ref = (c, t, i) => `<dmRef><dmRefIdent><dmCode ${attrs(c)}/><issueInfo issueNumber="001" inWork="00"/><language languageIsoCode="en" countryIsoCode="IN"/></dmRefIdent><dmRefAddressItems><dmTitle><techName>${t}</techName><infoName>${i}</infoName></dmTitle></dmRefAddressItems></dmRef>`;
const entry = (title, inner) => `<pmEntry>${title ? `<pmEntryTitle>${title}</pmEntryTitle>` : ''}${inner}</pmEntry>`;

const FRONT = { mic: 'X1', diff: 'A', sys: '00', sub: '0', assy: '00', dis: '00', info: '023' };
const HEAD1 = { mic: 'X1', diff: 'A', sys: '01', sub: '0', assy: '00', dis: '00', info: '009' };
const HEAD3 = { mic: 'X1', diff: 'A', sys: '03', sub: '0', assy: '00', dis: '00', info: '009' };
const B1 = { mic: 'RDR', diff: 'B', sys: 'A00', sub: '0', assy: '00', dis: '02', info: '018' };
const B2 = { mic: 'RDR', diff: 'B', sys: 'A00', sub: '0', assy: '00', dis: '03', info: '044' };
const B3 = { mic: 'RDR', diff: 'B', sys: 'A07', sub: '0', assy: '00', dis: '02', info: '820' };

const lp = (title, inner) => `<levelledPara><title>${title}</title>${inner}</levelledPara>`;
const MODULES = [
  [FRONT, 'JSS / Foreword', 'Foreword', lp('Foreword', '<para>Front matter text.</para>')],
  [HEAD1, 'Chapter 1', 'Leading Particulars and General Data', '<levelledPara><para>This chapter covers the following topics:</para></levelledPara>'],
  [HEAD3, 'Chapter 3', 'Unpacking and Removal of Preservatives', '<levelledPara><para>This chapter covers the following topics:</para></levelledPara>'],
  [B1, 'Purpose', 'Introduction', lp('Purpose', '<para>The system carries <emphasis>loads</emphasis>.</para><note><notePara>Keep it dry.</notePara></note>')],
  [B2, 'Features', 'Description', lp('Features', '<para>Features follow.</para><figure><title>Overview</title><graphic infoEntityIdent="ICN-RDR-A-A000000-1-1671Y-02145-A-001-04"/></figure>')],
  [B3, 'Unpacking', 'Procedure', lp('Unpacking and Removal of Preservatives', '<para>Open the crate.</para>')],
];
const PM = (prefix = '') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE pm []>
<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/pm.xsd">
  <identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="RDR" pmIssuer="1671Y" pmNumber="00061" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="000" inWork="01"/></pmIdent><pmAddressItems><issueDate year="2022" month="12" day="31"/><pmTitle>Legacy Test Publication</pmTitle></pmAddressItems></pmAddress></identAndStatusSection>
  <content>${entry('Legacy Test Publication',
    entry('Front matter', entry('Foreword', ref(FRONT, 'JSS / Foreword', 'Foreword'))) +
    entry('Chapter',
      entry('1', entry('LEADING PARTICULARS AND GENERAL DATA', ref(HEAD1, 'Chapter 1', 'Leading Particulars and General Data')) + entry('', ref(B1, 'Purpose', 'Introduction') + ref(B2, 'Features', 'Description'))) +
      entry('3', entry('UNPACKING AND REMOVAL OF PRESERVATIVES', ref(HEAD3, 'Chapter 3', 'Unpacking and Removal of Preservatives')) + entry('', ref(B3, 'Unpacking', 'Procedure')))))}</content>
</pm>`;

// ── the kinds of document beyond a description ──────────────────────────────────────────────────────────────────────────────────
// A procedure, a fault isolation, a crew drill and a parts catalogue are written the way the older tool writes them: sections, numbered lists and tables.
const mod = (c, techName, infoName, content, schema) => dm(c, techName, infoName, 'X').replace('<description>X</description>', content).replace('descript.xsd', `${schema}.xsd`);
const code = (info, assy = '00') => ({ mic: 'RDR', diff: 'B', sys: 'A10', sub: '0', assy, dis: '00', info });
const PROCED = code('520'); const FAULT = code('420'); const CREW = code('910'); const IPD = code('941');
const PROC_XML = `<procedure>
  <preliminaryRqmts>
    <productionMaintData><taskDuration procedureDuration="2" unitOfMeasure="h"/></productionMaintData>
    <reqCondGroup><reqCondNoRef><reqCond>Aircraft on jacks</reqCond></reqCondNoRef></reqCondGroup>
    <reqPersons><person><personCategory personCategoryCode="Cat01"/><personSkill skillLevelCode="sk01"/><estimatedTime unitOfMeasure="h">2</estimatedTime></person></reqPersons>
    <reqSupportEquips><supportEquipDescr><name>Torque wrench</name><identNumber><manufacturerCode>U17V0</manufacturerCode><partNumber>TW-100</partNumber></identNumber><reqQuantity>1</reqQuantity><remarks>Calibrated</remarks></supportEquipDescr></reqSupportEquips>
    <reqSupplies><noSupplies/></reqSupplies><reqSpares><noSpares/></reqSpares>
    <reqSafety><safety><warning><warningAndCautionPara>High voltage.</warningAndCautionPara></warning></safety></reqSafety>
  </preliminaryRqmts>
  <mainProcedure>
    <proceduralStep><title>Preparation</title>
      <proceduralStep><para>Open the cover.</para></proceduralStep>
      <proceduralStep><para>Remove the plug.</para><note><notePara>Keep the plug.</notePara></note></proceduralStep>
    </proceduralStep>
    <proceduralStep><title>Fitting</title>
      <proceduralStep><para>Fit the unit.</para><figure><title>The unit</title><graphic infoEntityIdent="ICN-RDR-A-A100000-1-1671Y-00010-A-001-01"/></figure></proceduralStep>
      <proceduralStep><para>Tighten the nuts.</para><proceduralStep><para>Use the wrench.</para></proceduralStep></proceduralStep>
    </proceduralStep>
  </mainProcedure>
  <closeRqmts><reqCondGroup><noConds/></reqCondGroup></closeRqmts>
</procedure>`;
const FAULT_XML = `<faultIsolation><faultIsolationProcedure><isolationProcedure><isolationMainProcedure>
  <isolationStep><action>Check the fuse.</action><isolationStepQuestion><para>Is the fuse blown?</para></isolationStepQuestion>
    <isolationStepAnswer><yesAnswer><para>Replace the fuse.</para></yesAnswer><noAnswer><para>Go to the next step.</para></noAnswer></isolationStepAnswer></isolationStep>
  <isolationProcedureEnd><action>Fault isolated.</action></isolationProcedureEnd>
</isolationMainProcedure></isolationProcedure></faultIsolationProcedure></faultIsolation>`;
const CREW_XML = `<crew><crewRefCard><title>Start-up card</title><crewDrill><title>Engine start</title>
  <crewDrillStep><title>Switch on</title><para>Master switch ON.</para></crewDrillStep><crewDrillStep><para>Check the lights.</para></crewDrillStep>
  <challengeAndResponse><challenge>Fuel?</challenge><response>Sufficient</response></challengeAndResponse>
</crewDrill></crewRefCard></crew>`;
const IPD_XML = `<illustratedPartsCatalog><figure><title>Assembly</title><graphic infoEntityIdent="ICN-RDR-A-A100000-1-1671Y-00011-A-001-01"/></figure>
  <catalogSeqNumber figureNumber="1" item="010" indenture="2"><itemSeqNumber><partIdentSegment><partNumber>PN-1</partNumber><manufacturerCode>U17V0</manufacturerCode></partIdentSegment><descrForPart>Bracket</descrForPart><quantityPerNextHigherAssy>2</quantityPerNextHigherAssy><unitOfIssue>EA</unitOfIssue></itemSeqNumber></catalogSeqNumber>
</illustratedPartsCatalog>`;
const newJss = async (name) => { const r = await w.post('/api/projects', { name, format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201); return `/api/projects/${r.json.project.id}`; };
const UPLOAD = async (U, file, name) => {
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), name);
  const r = await fetch(`${h.base}${U}/jss/import-project`, { method: 'POST', headers: { cookie: w.cookie }, body: fd });
  return { status: r.status, json: await r.json() };
};

test('procedures, fault isolation, crew drills and parts lists are imported as sections, numbered lists and tables, in order, with nothing lost', async () => {
  const mods = [[PROCED, 'Replace the unit', 'Procedure', PROC_XML, 'proced'], [FAULT, 'Fuse fault', 'Fault isolation', FAULT_XML, 'fault'], [CREW, 'Engine start', 'Crew', CREW_XML, 'crew'], [IPD, 'Parts', 'Illustrated parts data', IPD_XML, 'ipd']];
  const pm = PM().replace(/<content>[\s\S]*<\/content>/, `<content>${entry('Content Types', entry('Chapter', entry('1', entry('LEADING PARTICULARS AND GENERAL DATA', ref(HEAD1, 'Chapter 1', 'Leading Particulars and General Data')) + entry('', mods.map(([c, t, i]) => ref(c, t, i)).join('')))))}</content>`);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ctypes-')), 'x.zip'); const z = new ZipStreamWriter(fs.createWriteStream(f));
  await z.addBuffer(`Pkg/${nameOf(HEAD1)}`, Buffer.from(dm(HEAD1, 'Chapter 1', 'Leading Particulars and General Data', '<levelledPara><para>This chapter covers the following topics:</para></levelledPara>')));
  for (const [c, t, i, x, s] of mods) await z.addBuffer(`Pkg/${nameOf(c)}`, Buffer.from(mod(c, t, i, x, s)));
  await z.addBuffer('Pkg/PMC-RDR-1671Y-00061-00_000-01_EN-IN.xml', Buffer.from(pm)); await z.finish();
  const U = await newJss('Content types'); const r = await UPLOAD(U, f, 'Types.zip');
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 500));
  const codes = r.json.import.findings.map((x) => x.code);
  assert.ok(!codes.includes('content-type'), 'all four kinds are mapped: ' + JSON.stringify(r.json.import.findings.filter((x) => x.code === 'content-type')));
  assert.equal(r.json.import.findings.filter((x) => x.code === 'content-mapped').length, 4);
  assert.ok(codes.includes('steps-split'), 'a picture between steps ends the list, and that is said');
  const xml = (await w.get(`${U}/jss`)).json.xml; const plain = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const words of ['Preliminary Requirements', 'Required conditions', 'Aircraft on jacks', 'Required personnel', 'Cat01', 'sk01', 'Support equipment', 'Torque wrench', 'U17V0 TW-100', 'Calibrated', 'Consumables, materials and expendables', 'Spares', 'Safety conditions', 'High voltage', 'Estimated task time: 2 h',
    'Preparation', 'Open the cover.', 'Remove the plug.', 'NOTE: Keep the plug.', 'Fitting', 'Fit the unit.', 'Tighten the nuts.', 'Use the wrench.', 'Requirements After Job Completion',
    'Isolation Step 1', 'Check the fuse.', 'Question: Is the fuse blown?', 'Yes: Replace the fuse.', 'No: Go to the next step.', 'Isolation procedure end', 'Fault isolated.',
    'Start-up card', 'Engine start', 'Switch on', 'Master switch ON.', 'Check the lights.', 'Challenge', 'Fuel?', 'Sufficient',
    'Illustrated Parts List', 'Fig. Item', '1-010', 'PN-1', 'Bracket', 'Assembly']) assert.ok(plain.includes(words), `"${words}" is in the document`);
  assert.ok(plain.indexOf('Open the cover.') < plain.indexOf('Remove the plug.') && plain.indexOf('Remove the plug.') < plain.indexOf('Fit the unit.') && plain.indexOf('Fit the unit.') < plain.indexOf('Tighten the nuts.'), 'steps keep their order');
  assert.ok(plain.indexOf('Preliminary Requirements') < plain.indexOf('Preparation') && plain.indexOf('Fitting') < plain.indexOf('Requirements After Job Completion'), 'requirements stand before and after the steps');
  assert.match(xml, /<list[^>]*type="number"/); assert.match(xml, /<list[^>]*type="alpha"/);
  assert.ok(/\. Bracket/.test(plain), 'the indenture is shown by dots');
  assert.match(xml, /<figure[^>]*>[\s\S]*?The unit/, 'the figure inside a step is a figure');
  // the file is valid JSS and keeps saving; the document's codes follow from the package
  const g = await w.get(`${U}/jss`); const v = await w.post(`${U}/jss/validate`, { xml: g.json.xml });
  assert.equal(v.status, 200); assert.equal(v.json.errors, 0, 'the imported document validates: ' + JSON.stringify(v.json.findings.filter((x) => x.severity === 'error')).slice(0, 500));
  const id = (await w.get(`${U}/identity`)).json.identity;
  assert.equal(id.modules.length, 4); assert.ok(id.modules.every((m) => m.origin === 'imported'));
});

test('a kind of document that is not mapped keeps its text and is named in the report', async () => {
  const odd = code('300', '01');
  const body = `<checkList><title>Walk round</title><checkListItem><para>Look at the tyres.</para></checkListItem></checkList>`;
  const pm = PM().replace(/<content>[\s\S]*<\/content>/, `<content>${entry('Odd', entry('Chapter', entry('1', entry('LEADING PARTICULARS AND GENERAL DATA', ref(HEAD1, 'Chapter 1', 'Leading Particulars and General Data')) + entry('', ref(odd, 'Walk round', 'Check')))))}</content>`);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ctypes-')), 'x.zip'); const z = new ZipStreamWriter(fs.createWriteStream(f));
  await z.addBuffer(`Pkg/${nameOf(HEAD1)}`, Buffer.from(dm(HEAD1, 'Chapter 1', 'Leading Particulars and General Data', '<levelledPara><para>Topics:</para></levelledPara>')));
  await z.addBuffer(`Pkg/${nameOf(odd)}`, Buffer.from(mod(odd, 'Walk round', 'Check', body, 'checklist')));
  await z.addBuffer('Pkg/PMC-RDR-1671Y-00061-00_000-01_EN-IN.xml', Buffer.from(pm)); await z.finish();
  const U = await newJss('Odd kind'); const r = await UPLOAD(U, f, 'Odd.zip'); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
  const f1 = r.json.import.findings.find((x) => x.code === 'content-type'); assert.ok(f1 && /checkList/.test(f1.message), 'the kind is named: ' + JSON.stringify(f1));
  assert.match((await w.get(`${U}/jss`)).json.xml, /Look at the tyres/);
});
