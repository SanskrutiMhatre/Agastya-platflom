'use strict';
// "New project > Import a package": what the first look says an upload is, and what an import into another format does with the Administrator's enterprise lists.
//
// Found on a real installation: an older-tool package (enterprise U17V0) imported as a JSS project was refused with "the enterprise code is not registered", because the wizard
// used the S1000D CSDB import, whose Administrator-register check is an S1000D authoring rule. A JSS / JSG project does not author S1000D enterprise data, so the register must not
// stop it; an S1000D project keeps the check (import-enterprise-refusal.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { boot, DM21, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const DM = fs.readdirSync(FIX).find((f) => /-040A-D_/.test(f));
let h; let admin; let w; let ZipStreamWriter;

test.before(async () => {
  h = await boot(); ({ ZipStreamWriter } = require('../dist/services/zipio'));
  admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'wizard', fullName: 'Wizard', role: 'author' });
  w = new h.Client('wizard'); await w.post('/api/auth/login', { username: 'wizard', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'wizard', password: PW });
});
test.after(async () => { if (h) await h.close(); });

// ── a small package in the older tool's shape (enterprise U17V0 / GPSL, which no Administrator list here names) ──────────────────────────────────
const attrs = (c) => `modelIdentCode="${c.mic}" systemDiffCode="${c.diff}" systemCode="${c.sys}" subSystemCode="${c.sub}" subSubSystemCode="0" assyCode="${c.assy}" disassyCode="${c.dis}" disassyCodeVariant="A" infoCode="${c.info}" infoCodeVariant="A" itemLocationCode="D"`;
const nameOf = (c) => `DMC-${c.mic}-${c.diff}-${c.sys}-${c.sub}0-${c.assy}-${c.dis}A-${c.info}A-D_001-00_EN-IN.xml`;
const dm = (c, techName, infoName, body) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE dmodule []>
<dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/descript.xsd">
  <identAndStatusSection><dmAddress><dmIdent><dmCode ${attrs(c)}/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="00"/></dmIdent>
  <dmAddressItems><issueDate year="2022" month="12" day="31"/><dmTitle><techName>${techName}</techName><infoName>${infoName}</infoName></dmTitle></dmAddressItems></dmAddress>
  <dmStatus issueType="new"><security securityClassification="01"/><responsiblePartnerCompany enterpriseCode="U17V0"><enterpriseName>GPSL</enterpriseName></responsiblePartnerCompany><originator enterpriseCode="U17V0"><enterpriseName>GPSL</enterpriseName></originator><applic><displayText><simplePara>All</simplePara></displayText></applic><qualityAssurance><firstVerification verificationType="tabtop"/></qualityAssurance></dmStatus></identAndStatusSection>
  <content><description>${body}</description></content>
</dmodule>`;
const ref = (c, t, i) => `<dmRef><dmRefIdent><dmCode ${attrs(c)}/><issueInfo issueNumber="001" inWork="00"/><language languageIsoCode="en" countryIsoCode="IN"/></dmRefIdent><dmRefAddressItems><dmTitle><techName>${t}</techName><infoName>${i}</infoName></dmTitle></dmRefAddressItems></dmRef>`;
const entry = (title, inner) => `<pmEntry>${title ? `<pmEntryTitle>${title}</pmEntryTitle>` : ''}${inner}</pmEntry>`;
const HEAD1 = { mic: 'X1', diff: 'A', sys: '01', sub: '0', assy: '00', dis: '00', info: '009' };
const B1 = { mic: 'RDR', diff: 'B', sys: 'A00', sub: '0', assy: '00', dis: '02', info: '018' };
const MODULES = [
  [HEAD1, 'Chapter 1', 'Leading Particulars and General Data', '<levelledPara><para>This chapter covers the following topics:</para></levelledPara>'],
  [B1, 'Purpose', 'Introduction', '<levelledPara><title>Purpose</title><para>The system carries loads.</para></levelledPara>'],
];
const PM = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE pm []>
<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/pm.xsd">
  <identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="RDR" pmIssuer="1671Y" pmNumber="00061" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="000" inWork="01"/></pmIdent><pmAddressItems><issueDate year="2022" month="12" day="31"/><pmTitle>Wizard Test Publication</pmTitle></pmAddressItems></pmAddress></identAndStatusSection>
  <content>${entry('Wizard Test Publication', entry('Chapter', entry('1', entry('LEADING PARTICULARS AND GENERAL DATA', ref(HEAD1, 'Chapter 1', 'Leading Particulars and General Data')) + entry('', ref(B1, 'Purpose', 'Introduction')))))}</content>
</pm>`;

async function makeZip(layout) {
  const f = path.join(tmp('wizard-'), 'x.zip'); const z = new ZipStreamWriter(fs.createWriteStream(f));
  const add = (n, t) => z.addBuffer(n, Buffer.from(t, 'utf8'));
  if (layout === 'flat') { for (const [c, t, i, b] of MODULES) await add(`Pkg/${nameOf(c)}`, dm(c, t, i, b)); await add('Pkg/PMC-RDR-1671Y-00061-00_000-01_EN-IN.xml', PM); }
  else if (layout === 'older-tool') {
    await add('manifest.json', JSON.stringify({ manifestVersion: 1, id: 'p1', name: 'Wizard', type: 'uhb', templateRef: 'x', exportedAt: '2026-01-01T00:00:00Z' }));
    for (const [c, t, i, b] of MODULES) await add(`project/csdb/${nameOf(c)}`, dm(c, t, i, b)); await add('project/PM/publication.xml', PM);
  } else await add('README.txt', 'not an S1000D package');
  await z.finish(); return f;
}
const form = (file, name, fields = {}) => { const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), name); for (const [k, v] of Object.entries(fields)) fd.append(k, v); return fd; };
const detect = (file, name) => w.req('POST', '/api/projects/import/detect', form(file, name));
const textFile = (text) => { const f = path.join(tmp('wizard-'), 'doc.xml'); fs.writeFileSync(f, text); return f; };

test('the first look says what an upload is: a package, the older tool\'s export, a JSS or JSG document, or nothing it knows', async () => {
  const flat = (await detect(await makeZip('flat'), 'a.zip')).json;
  assert.equal(flat.format, 's1000d'); assert.equal(flat.kind, 'package'); assert.equal(flat.dataModules, 2); assert.equal(flat.olderTool, false);
  const older = (await detect(await makeZip('older-tool'), 'a.jsspub.zip')).json;
  assert.equal(older.format, 's1000d'); assert.equal(older.olderTool, true, 'the older tool\'s export layout is recognised');
  assert.equal((await detect(await makeZip('empty'), 'readme.zip')).json.format, 'unknown');

  const j = await w.post('/api/projects', { name: 'Detect JSS', format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(j.status, 201);
  const jss = (await detect(textFile((await w.get(`/api/projects/${j.json.project.id}/jss`)).json.xml), 'book.xml')).json;
  assert.equal(jss.format, 'jss'); assert.equal(jss.kind, 'document');
  const g = await w.post('/api/projects', { name: 'Detect JSG', format: 'jsg', domain: 'land', manualType: 'uhb' }); assert.equal(g.status, 201);
  const jsg = (await detect(textFile((await w.get(`/api/projects/${g.json.project.id}/jsg`)).json.xml), 'doc.xml')).json;
  assert.equal(jsg.format, 'jsg'); assert.equal(jsg.kind, 'document'); assert.equal(jsg.docType, 'uhb');
  assert.equal((await detect(textFile('<?xml version="1.0"?><other><x/></other>'), 'other.xml')).json.format, 'unknown');
});

test('an enterprise the Administrator has not registered does not stop an import, as S1000D, JSS or JSG; it is reported (the older strict API route is unchanged)', async () => {
  // a foreign package made while the lists are empty (as in import-enterprise-refusal.test.js): its modules name enterprise 00000 / Example Company
  const pr = await w.post('/api/projects', { name: 'Exporter', format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5-0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  const U = `/api/projects/${pr.json.project.id}`; assert.equal((await w.post(`${U}/dms`, { file: DM, xml: fs.readFileSync(path.join(FIX, DM), 'utf8') })).status, 201);
  const exported = (await w.get(`${U}/packages/project`)).buf;
  assert.equal((await admin.post('/api/admin/config/rpc-cages', { cage: '1671Y', name: 'LNTDEFENCE', role: 'RPC' })).status, 201);
  assert.equal((await admin.post('/api/admin/config/originator-cages', { cage: '1671Y', name: 'LNTDEFENCE', role: 'ORG' })).status, 201);
  const zip = await makeZip('flat');                                   // names U17V0 / GPSL: registered nowhere

  // as the person chose in the wizard: a Naval JSS manual, filed in a folder
  const asJss = await w.req('POST', '/api/xengine/import', form(zip, 'a.zip', { source: 's1000d', target: 'jss', name: 'Wizard JSS', folder: 'Imported', domain: 'naval', manualType: 'naval-uhb' }));
  assert.equal(asJss.status, 201, JSON.stringify(asJss.json).slice(0, 500));
  assert.equal(asJss.json.project.format, 'jss'); assert.equal(asJss.json.project.domain, 'naval'); assert.equal(asJss.json.project.manualType, 'naval-uhb'); assert.equal(asJss.json.project.folder, 'Imported');
  assert.ok(asJss.json.counts.sections >= 1);
  const asJsg = await w.req('POST', '/api/xengine/import', form(zip, 'a.zip', { source: 's1000d', target: 'jsg', name: 'Wizard JSG', manualType: 'uhb' }));
  assert.equal(asJsg.status, 201, JSON.stringify(asJsg.json).slice(0, 500)); assert.equal(asJsg.json.project.format, 'jsg');

  // S1000D into S1000D, as the dialog does it now: the package importer that scans and repairs first. The Administrator's lists are CHECKED and REPORTED (once per reason), not a reason to refuse it
  const asS1000d = await w.req('POST', '/api/xengine/import', form(zip, 'a.zip', { source: 's1000d', target: 's1000d', name: 'Wizard S1000D', folder: 'Imported' }));
  assert.equal(asS1000d.status, 201, JSON.stringify(asS1000d.json).slice(0, 600));
  assert.equal(asS1000d.json.project.format, 's1000d'); assert.equal(asS1000d.json.project.folder, 'Imported'); assert.equal(asS1000d.json.imported.dms, 2);
  const problems = asS1000d.json.findings.filter((f) => f.code === 'import-problem');
  assert.ok(problems.some((f) => /enterprise code .U17V0. is not registered/.test(f.message) && /Administrator > RPC CAGE codes/.test(f.message)), 'the unregistered enterprise is reported with what to do: ' + JSON.stringify(problems));
  assert.ok(problems.every((f) => /2 data modules/.test(f.message)), 'said once per reason, not once per file');
  const cfg = await w.get(`/api/projects/${asS1000d.json.project.id}/s1000d`);
  assert.equal(cfg.status, 200);   // derived from the data modules (these two name two model codes, so none is chosen and the configuration says so, exactly as the older dialog did)
  assert.match((cfg.json.config.origin?.notes ?? []).join(' '), /2 different model identification codes \(.*(X1.*RDR|RDR.*X1)/, JSON.stringify(cfg.json.config.origin));

  // the S1000D package import into a JSS project keeps the data and says what it did not check; into an S1000D project it is refused, as designed
  const keep = path.join(tmp('wizard-'), 'p.zip'); fs.writeFileSync(keep, exported);
  const viaWizard = async (name, format, extra = {}) => { const det = await detect(keep, 'p.zip'); assert.equal(det.status, 200); return w.post('/api/projects/import', { token: det.json.token, name, format, ...extra }); };
  const kept = await viaWizard('Legacy JSS', 'jss', { domain: 'land', manualType: 'uhb' });
  assert.equal(kept.status, 201, JSON.stringify(kept.json).slice(0, 500)); assert.equal(kept.json.report.applied, true);
  assert.ok(kept.json.report.notes.some((n) => /not in the Administrator's lists/.test(n)), 'what was not checked is said: ' + JSON.stringify(kept.json.report.notes));
  const refused = await viaWizard('Legacy S1000D', 's1000d');
  assert.equal(refused.status, 422); assert.match(refused.json.error, /not registered/);
});

test('a JSG Illustrated Spare Parts List cannot be made from S1000D: said plainly, and no project is left behind', async () => {
  const r = await w.req('POST', '/api/xengine/import', form(await makeZip('flat'), 'a.zip', { source: 's1000d', target: 'jsg', name: 'No ISPL', manualType: 'ispl' }));
  assert.equal(r.status, 400, JSON.stringify(r.json).slice(0, 300)); assert.equal(r.json.code, 'JSG_TYPE_NOT_CONVERTIBLE');
  assert.ok(!(await w.get('/api/projects')).json.projects.some((p) => p.name === 'No ISPL'));
});

test('a package is not a JSS document, and the answer says what to do instead; nothing is made', async () => {
  const r = await w.req('POST', '/api/xengine/import', form(await makeZip('flat'), 'a.zip', { source: 'jss', target: 'jsg', name: 'Wrong source' }));
  assert.equal(r.status, 400); assert.equal(r.json.code, 'WRONG_SOURCE'); assert.match(r.json.error, /Choose S1000D as the source/);
  assert.ok(!(await w.get('/api/projects')).json.projects.some((p) => p.name === 'Wrong source'));
});
