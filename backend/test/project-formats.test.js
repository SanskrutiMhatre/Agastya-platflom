'use strict';
// Starting a project: the format catalogue (S1000D / JSS / JSG, domain, manual type), creating by format, importing a package first (detect, confirm, import - the project
// takes its identity from the package), and changing the model code of a project that already has data modules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const SAMPLE = path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'S1000D', '20_Nov _2026', 'PMC-RDR-1671Y-00033-00_000-01.xml (1).zip');
let h; let w;

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'fiona', fullName: 'Fiona', role: 'author' });
  w = new h.Client('fiona'); await w.post('/api/auth/login', { username: 'fiona', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'fiona', password: PW });
});
test.after(async () => { await h.close(); });

test('the catalogue: three formats; JSS has Land and Naval with manual types; only what has an engine is ready', async () => {
  const f = (await w.get('/api/formats')).json.formats;
  assert.deepEqual(f.map((x) => x.id), ['s1000d', 'jss', 'jsg']);
  assert.deepEqual(f.find((x) => x.id === 'jss').domains.map((d) => d.id), ['land', 'naval']);
  assert.equal(f.find((x) => x.id === 'jss').domains[0].manualTypes.find((m) => m.id === 'uhb').ready, true);
  assert.equal(f.find((x) => x.id === 'jsg').ready, false);
});

test('creating by format: S1000D uses the direct S1000D engine; JSS Land UHB the JSS book engine; a format without an engine is refused plainly', async () => {
  const a = await w.post('/api/projects', { name: 'Fmt S1000D', format: 's1000d' });
  assert.equal(a.status, 201, JSON.stringify(a.json)); assert.equal(a.json.project.format, 's1000d'); assert.equal(a.json.project.pipeline, 's1000dtofo');
  assert.equal(a.json.project.templateRef, 'xignal-s1000d', 'an S1000D publication is printed in the reference (Xignal) layout');
  const b = await w.post('/api/projects', { name: 'Fmt JSS Land UHB', format: 'jss', domain: 'land', manualType: 'uhb' });
  assert.equal(b.status, 201, JSON.stringify(b.json)); assert.equal(b.json.project.format, 'jss'); assert.equal(b.json.project.domain, 'land'); assert.equal(b.json.project.manualType, 'uhb'); assert.equal(b.json.project.pipeline, 's1000dtojss'); assert.equal(b.json.project.templateRef, 'uhb');
  for (const body of [{ format: 'jss', domain: 'naval', manualType: 'uhb' }, { format: 'jsg', domain: 'land', manualType: 'uhb' }, { format: 'jss', domain: 'land' }, { format: 'jss' }]) {
    const r = await w.post('/api/projects', { name: `Fmt bad ${JSON.stringify(body)}`.slice(0, 60), ...body });
    assert.equal(r.status, 400, JSON.stringify([body, r.json])); assert.equal(r.json.code, 'FORMAT_NOT_READY');
  }
  assert.match((await w.post('/api/projects', { name: 'Fmt naval', format: 'jss', domain: 'naval', manualType: 'uhb' })).json.error, /not available yet/);
});

test('import first: the package is detected, the owner confirms, the project takes its identity from the package', { skip: !fs.existsSync(SAMPLE) && 'the 20 Nov sample is not in this checkout' }, async () => {
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(SAMPLE)]), 'pkg.zip');
  const det = await w.req('POST', '/api/projects/import/detect', fd); assert.equal(det.status, 200, JSON.stringify(det.json));
  assert.equal(det.json.format, 's1000d'); assert.equal(det.json.dataModules, 9); assert.equal(det.json.publicationModules, 1); assert.match(det.json.token, /^[a-f0-9]{32}$/);
  assert.equal((await w.post('/api/projects/import', { token: 'x'.repeat(32), name: 'Nope', format: 's1000d' })).json.code, 'UPLOAD_EXPIRED');
  const r = await w.post('/api/projects/import', { token: det.json.token, name: 'Imported Maintenance Manual', format: 's1000d' });
  assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 600)); assert.equal(r.json.project.format, 's1000d');
  const id = r.json.project.id; const cfg = (await w.get(`/api/projects/${id}/s1000d`)).json;
  assert.equal(cfg.config.mic, 'RDR', 'the model code comes from the package'); assert.equal(cfg.config.issue, '4-2');
  assert.equal((await w.get(`/api/projects/${id}/dms`)).json.dms.length, 9);
  assert.equal((await w.post('/api/projects/import', { token: det.json.token, name: 'Again', format: 's1000d' })).json.code, 'UPLOAD_EXPIRED', 'a token is used once');
  globalThis.__imported = id;
});

test('a project whose modules name a BREX it does not hold: the gate refuses, one action creates a BREX that inherits the S1000D default, then it passes the BREX check', { skip: !fs.existsSync(SAMPLE) && 'sample missing' }, async () => {
  const id = globalThis.__imported; const U = `/api/projects/${id}`;
  const miss = (await w.get(`${U}/brex/missing`)).json.missing;
  assert.deepEqual(miss, ['DMC-RDR-A-00-00-00-00A-022A-D'], 'the package names its model BREX but does not carry it');
  const refused = await w.post(`${U}/publish`, {}); assert.notEqual(refused.status, 200); assert.match(JSON.stringify(refused.json), /BREX/);
  const made = await w.post(`${U}/brex/create`, {}); assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.match(made.json.created[0], /^DMC-RDR-A-00-00-00-00A-022A-D_001-00_/);
  assert.deepEqual((await w.get(`${U}/brex/missing`)).json.missing, []);
  assert.equal((await w.post(`${U}/brex/create`, {})).json.code, 'NOTHING_TO_CREATE', 'never overwrites');
  const after = await w.post(`${U}/publish`, {}); assert.doesNotMatch(JSON.stringify(after.json), /BREX .* is not available/, JSON.stringify(after.json).slice(0, 400));
});

test('a module that breaks a business rule: the build is refused; "generate anyway" builds it, says so, and a release is still refused', { skip: !fs.existsSync(SAMPLE) && 'sample missing' }, async () => {
  const id = globalThis.__imported; const U = `/api/projects/${id}`; const dir = path.join(h.ws, 'projects', id, 'csdb');
  const f = fs.readdirSync(dir).filter((n) => /^DMC-RDR-B-/.test(n)).find((n) => /<responsiblePartnerCompany enterpriseCode="[^"]+"/.test(fs.readFileSync(path.join(dir, n), 'utf8')));
  assert.ok(f, 'a module with a company');
  const xml = fs.readFileSync(path.join(dir, f), 'utf8');
  fs.writeFileSync(path.join(dir, f), xml.replace(/<responsiblePartnerCompany enterpriseCode="[^"]+"[^>]*>(\s*<enterpriseName>[^<]*<\/enterpriseName>\s*<\/responsiblePartnerCompany>)?/, '<responsiblePartnerCompany/>'));   // rule BREX-S1-00035
  try {
    const refused = await w.post(`${U}/publish`, {});
    assert.equal(refused.status, 422, JSON.stringify(refused.json).slice(0, 300)); assert.equal(refused.json.code, 'VALIDATION_FAILED');
    assert.ok(refused.json.findings.length && refused.json.findings.every((x) => x.kind === 'brex'), 'only business rules are broken');
    assert.equal((await w.post(`${U}/publish`, { allowRuleBreaks: 'yes' })).status, 422, 'only a real true is accepted');
    const ok = await w.post(`${U}/publish`, { allowRuleBreaks: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 300)); assert.ok(ok.json.ruleBreaks.length >= 1); assert.match(ok.json.ruleBreaks[0], /BREX-S1-00035/);
    assert.equal((await w.post(`${U}/release`, { note: 'x' })).status, 422, 'a release is always checked strictly');
  } finally { fs.writeFileSync(path.join(dir, f), xml); }
});

test('change the model code: a preview first, then every file name, identification and reference moves together; a backup is kept', { skip: !fs.existsSync(SAMPLE) && 'sample missing' }, async () => {
  const id = globalThis.__imported; const dir = path.join(h.ws, 'projects', id, 'csdb'); const U = `/api/projects/${id}`;
  const before = fs.readdirSync(dir).filter((f) => /^DMC-RDR-/.test(f)); assert.ok(before.length >= 9);
  assert.equal((await w.post(`${U}/model-code`, { mic: 'x' })).json.code, 'BAD_MIC');
  assert.equal((await w.post(`${U}/model-code`, { mic: 'RDR' })).json.code, 'SAME_MIC');
  const prev = await w.post(`${U}/model-code`, { mic: 'zed1' }); assert.equal(prev.status, 200); assert.equal(prev.json.applied, false);
  assert.equal(prev.json.renamed.length, before.length); assert.deepEqual(fs.readdirSync(dir).filter((f) => /^DMC-RDR-/.test(f)), before, 'a preview changes nothing');
  const done = await w.post(`${U}/model-code`, { mic: 'zed1', apply: true }); assert.equal(done.status, 200, JSON.stringify(done.json)); assert.equal(done.json.applied, true);
  const after = fs.readdirSync(dir); assert.equal(after.filter((f) => /^DMC-RDR-/.test(f)).length, 0); assert.equal(after.filter((f) => /^DMC-ZED1-/.test(f)).length, before.length);
  for (const f of after.filter((x) => /^DMC-ZED1-/.test(x))) { const x = fs.readFileSync(path.join(dir, f), 'utf8'); assert.match(/<dmIdent>[\s\S]*?<dmCode [^>]*modelIdentCode="([^"]+)"/.exec(x)[1], /^ZED1$/, f); }
  const pm = fs.readFileSync(path.join(h.ws, 'projects', id, 'publication.xml'), 'utf8');
  assert.ok(!/<dmCode [^>]*modelIdentCode="RDR"/.test(pm), 'the publication module no longer refers to the old code'); assert.ok(/<dmCode [^>]*modelIdentCode="ZED1"/.test(pm));
  assert.equal((await w.get(`${U}/s1000d`)).json.config.mic, 'ZED1');
  assert.ok(fs.readdirSync(path.join(h.ws, 'projects', id)).some((f) => f.startsWith('.model-code-backup-')), 'the originals are kept');
  assert.equal((await w.get(`${U}/dms`)).json.dms.length, 10);
});

test('importing a data module of ANOTHER model code is a choice, not a dead end: keep its code, or change it to the project\'s', async () => {
  const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');
  const pr = await w.post('/api/projects', { name: 'Foreign import', format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  const U = `/api/projects/${pr.json.project.id}`; const dir = path.join(h.ws, 'projects', pr.json.project.id, 'csdb');
  const f = fs.readdirSync(FIX).find((x) => /-040A-D_/.test(x)); const xml = fs.readFileSync(path.join(FIX, f), 'utf8');
  assert.equal((await w.post(`${U}/dms`, { file: f, xml })).status, 201, 'the project has a data module, so its model code is locked');
  const foreign = xml.replace(/modelIdentCode="EXAMPLE"/g, 'modelIdentCode="OTHERM"'); const ff = f.replace('EXAMPLE', 'OTHERM').replace('-01-00A', '-09-00A').replace('assyCode="01"', 'assyCode="09"');
  const send = (extra) => { const fd = new FormData(); fd.append('files', new Blob([foreign.replace(/assyCode="01"/, 'assyCode="09"')]), ff); for (const [k, v] of Object.entries(extra)) fd.append(k, v); return w.req('POST', `${U}/dms-import`, fd); };
  const refused = await send({}); assert.equal(refused.status, 400); assert.equal(refused.json.code, 'IMPORT_REFUSED');
  assert.deepEqual(refused.json.otherModel.map((x) => x.mic), ['OTHERM']); assert.equal(refused.json.projectMic, 'EXAMPLE');
  const kept = await send({ otherModel: 'keep' }); assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.ok(fs.existsSync(path.join(dir, ff)), 'kept under its own model code');
  fs.unlinkSync(path.join(dir, ff));
  const recoded = await send({ otherModel: 'recode' }); assert.equal(recoded.status, 200, JSON.stringify(recoded.json));
  const nf = ff.replace('OTHERM', 'EXAMPLE'); assert.ok(fs.existsSync(path.join(dir, nf)), 'renamed to the project\'s code');
  assert.match(fs.readFileSync(path.join(dir, nf), 'utf8'), /<dmIdent>[\s\S]*?modelIdentCode="EXAMPLE"/);
});

test('a new data module joins the publication automatically (BREX and applicability tables do not); the project can switch that off', async () => {
  const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');
  const pr = await w.post('/api/projects', { name: 'Auto add', format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  const id = pr.json.project.id; const U = `/api/projects/${id}`; assert.equal(pr.json.project.autoAddToPublication, true);
  const pick = (c) => fs.readdirSync(FIX).find((x) => new RegExp(`-${c}A-D_`).test(x));
  const refs = () => (fs.readFileSync(path.join(h.ws, 'projects', id, 'publication.xml'), 'utf8').match(/<dmRef\b/g) ?? []).length;
  assert.equal(refs(), 0);
  assert.equal((await w.post(`${U}/dms`, { file: pick('040'), xml: fs.readFileSync(path.join(FIX, pick('040')), 'utf8') })).status, 201);
  assert.equal(refs(), 1, 'the new module is in the publication');
  assert.equal((await w.post(`${U}/dms`, { file: pick('022'), xml: fs.readFileSync(path.join(FIX, pick('022')), 'utf8') })).status, 201);
  assert.equal(refs(), 1, 'a BREX is project data, not a page of the book');
  assert.equal((await w.patch(`${U}`, { autoAddToPublication: false })).status, 200);
  assert.equal((await w.post(`${U}/dms`, { file: pick('520'), xml: fs.readFileSync(path.join(FIX, pick('520')), 'utf8') })).status, 201);
  assert.equal(refs(), 1, 'switched off: the module stays in the CSDB only');
});
