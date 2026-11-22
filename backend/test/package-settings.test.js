'use strict';
// A project package carries what the project CHOSE (configuration, information codes, data module types, both SNS systems) and a package that STARTS a
// project gives it back - validated, and never over what the data modules say. See services/packageSettings.ts and docs/SNS_SYSTEMS.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');
const pick = (code) => fs.readdirSync(FIX).find((f) => f.includes(`-${code}A-D_`));
const ICN = path.resolve(FIX, '..', 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg');
const CODES = ['040', '520', '421'];

let h; let w; let Z; let src; let pkg;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pkgset-'));

async function unpack(buf) {
  const f = path.join(tmp(), 'x.zip'); fs.writeFileSync(f, buf);
  const r = Z.ZipFileReader.open(f); const out = {};
  for (const e of r.entries) if (!e.isDirectory) out[e.name] = await r.readBuffer(e);
  r.close(); return out;
}
async function pack(files) {
  const f = path.join(tmp(), 'm.zip'); const z = new Z.ZipStreamWriter(fs.createWriteStream(f));
  for (const [n, c] of Object.entries(files)) await z.addBuffer(n, Buffer.from(c)); await z.finish(); return fs.readFileSync(f);
}
/** The exported package with its manifest's project.settings changed by `edit` (the file hashes in the manifest stay valid: only settings change). */
async function withSettings(edit) {
  const files = await unpack(pkg); const m = JSON.parse(files['manifest.json'].toString('utf8'));
  edit(m.project); files['manifest.json'] = Buffer.from(JSON.stringify(m)); return pack(files);
}
async function importFirst(buf, name) {
  const fd = new FormData(); fd.append('file', new Blob([buf]), 'p.zip');
  const det = await w.req('POST', '/api/projects/import/detect', fd); assert.equal(det.status, 200, JSON.stringify(det.json));
  return w.post('/api/projects/import', { token: det.json.token, name, format: 's1000d' });
}
const bundle = async (id) => (await w.get(`/api/projects/${id}/s1000d`)).json;
const sns1 = async (id) => (await w.get(`/api/projects/${id}/sns`)).json.nodes.map((n) => [n.path, n.title]);
const sns2 = async (id) => (await w.get(`/api/projects/${id}/sns-rows`)).json.rows.map((r) => [r.systemDiffCode, r.systemCode, r.subSystemCode, r.subSubSystemCode, r.assyCode, r.title]);

test.before(async () => {
  h = await boot(); Z = require('../dist/services/zipio');
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const made = await admin.post('/api/team/users', { username: 'sara', fullName: 'Sara Settings', role: 'author' });
  w = new h.Client('sara'); await w.post('/api/auth/login', { username: 'sara', password: made.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'sara', password: PW });

  const preset = (await w.get('/api/s1000d/presets')).json.presets[0];
  const made1 = await w.post('/api/projects', { name: 'Settings source', format: 's1000d', s1000d: {
    mic: 'EXAMPLE', issue: '5-0', language: 'en', country: 'IN', security: '01', responsiblePartner: { code: 'S1KST', name: 'Studio Partner' }, originator: { code: 'S1KOR', name: 'Studio Originator' },
    codeMode: 'selected', enabledCodes: CODES, snsEnforced: false, snsPreset: preset.id } });
  assert.equal(made1.status, 201, JSON.stringify(made1.json)); src = made1.json.project.id;
  const U = `/api/projects/${src}`;
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(ICN)]), path.basename(ICN)); fd.append('dir', 'csdb'); assert.equal((await w.req('POST', `${U}/media`, fd)).status, 200);
  for (const c of CODES) { const f = pick(c); assert.equal((await w.post(`${U}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') })).status, 201, c); }
  // system 2 (the row model) and its ordering: authored on top of whatever system 1 holds
  assert.equal((await w.post(`${U}/sns-rows`, { systemCode: '29', title: 'Hydraulic power' })).status, 201);
  assert.equal((await w.post(`${U}/sns-rows`, { systemCode: '29', subSystemCode: '1', title: 'Main supply' })).status, 201);
  assert.equal((await w.put(`${U}/sns-rows/ordering`, { order: { pinFirst: ['040'] } })).status, 200);
  const all = (await bundle(src)).dmTypes.map((t) => t.schema);
  assert.equal((await w.put(`${U}/s1000d/dm-types`, { enabled: all.filter((t) => t !== 'wrngflds') })).status, 200);
  const exp = await w.get(`${U}/packages/project`); assert.equal(exp.status, 200); pkg = exp.buf;
});
test.after(async () => { await h.close(); });

test('the package manifest carries the settings: configuration, selected codes, DM types, and BOTH SNS systems side by side', async () => {
  const m = JSON.parse((await unpack(pkg))['manifest.json'].toString('utf8')); const s = m.project.settings;
  assert.equal(s.version, 1);
  assert.deepEqual(s.config.responsiblePartner, { code: 'S1KST', name: 'Studio Partner' }); assert.equal(s.config.codeMode, 'selected');
  assert.deepEqual([...s.infoCodes].sort(), [...CODES].sort()); assert.deepEqual(s.disabledDmTypes, ['wrngflds']);
  assert.ok(s.sns.length > 50, 'system 1: the preset the wizard applied'); assert.equal(s.snsRows.rows.length, 2, 'system 2: the two authored rows, nothing from system 1');
  assert.deepEqual(s.snsRows.order, { pinFirst: ['040'] });
  assert.ok(s.snsRows.rows.every((r) => !('id' in r)), 'row ids are the source install\'s business');
});

test('import first: the new project gets the choices back, each SNS system exactly as it was, and the source project is untouched', async () => {
  const before = JSON.stringify(await bundle(src)); const s1 = await sns1(src); const s2 = await sns2(src);
  const r = await importFirst(pkg, 'Settings round trip'); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 500));
  const id = r.json.project.id; const b = await bundle(id); const c = b.config; const was = JSON.parse(before).config;
  for (const k of ['mic', 'issue', 'language', 'country', 'security', 'responsiblePartner', 'originator', 'codeMode', 'snsEnforced', 'brex']) assert.deepEqual(c[k], was[k], k);
  assert.deepEqual(b.selected.infoCode, [...CODES].sort(), 'the information code selection');
  assert.deepEqual(b.dmTypes.filter((t) => !t.enabled).map((t) => t.schema), ['wrngflds'], 'the data module types');
  assert.deepEqual(await sns1(id), s1, 'system 1 (presets / project table)'); assert.deepEqual(await sns2(id), s2, 'system 2 (row model)');
  const overrideOf = async (pid) => (await w.get(`/api/projects/${pid}/sns-rows/ordering`)).json.override;
  assert.deepEqual(await overrideOf(id), { pinFirst: ['040'] }, 'the ordering overrides of system 2'); assert.deepEqual(await overrideOf(id), await overrideOf(src));
  assert.ok(r.json.settings.restored.length >= 6, JSON.stringify(r.json.settings)); assert.ok(c.origin.notes.some((n) => /Settings restored from the package/.test(n)));
  // the restored selection is enforced: a module whose information code is not in it is refused, one that is in it is not
  const nope = pick('131'); const ref = await w.post(`/api/projects/${id}/dms`, { file: nope, xml: fs.readFileSync(path.join(FIX, nope), 'utf8') });
  assert.equal(ref.status, 400); assert.equal(ref.json.code, 'CONFIG_MISMATCH');
  assert.equal(JSON.stringify(await bundle(src)), before, 'exporting and importing never changed the source project');
});

test('a package without settings (another tool, an older version) still imports: the configuration is derived from the data modules, and the report says so', async () => {
  const r = await importFirst(await withSettings((p) => { delete p.settings; }), 'No settings'); assert.equal(r.status, 201);
  assert.deepEqual(r.json.settings.restored, []); assert.match(r.json.settings.notes[0], /carries no project settings/);
  const c = (await bundle(r.json.project.id)).config; assert.equal(c.mic, 'EXAMPLE'); assert.equal(c.codeMode, 'all'); assert.deepEqual(c.responsiblePartner, { code: '', name: '' });
  assert.deepEqual(await sns1(r.json.project.id), []); assert.deepEqual(await sns2(r.json.project.id), []);
});

test('hostile or stale settings never fail the import and never put invalid state in the project; the data modules win over the manifest', async () => {
  const buf = await withSettings((p) => {
    p.settings = { version: 1,
      config: { mic: 'OTHER', issue: '4-2', language: 'fr', country: 'IN', security: '99', responsiblePartner: { code: 'X', name: '' }, originator: { code: 'S1KOR', name: 'Studio Originator' },
        codeMode: 'selected', applicability: { act: 'DMC-NOT-IN-THIS-PACKAGE.xml' }, brex: { mode: 'project', dmc: 'not a dmc' }, snsEnforced: true },
      infoCodes: ['999'], disabledDmTypes: ['nosuchtype'],
      sns: [{ path: '../x', title: 't' }, { path: '21/9/99', title: 'orphan' }, { path: '21', title: 'Aircraft' }, 7, null],
      snsRows: { rows: [{ systemCode: '!!', title: '' }, { systemCode: '21', title: 'Row' }], order: { keys: ['nope'] } } };
  });
  const r = await importFirst(buf, 'Hostile settings'); assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 400));
  const id = r.json.project.id; const b = await bundle(id); const c = b.config;
  assert.equal(c.mic, 'EXAMPLE', 'the model code comes from the data modules'); assert.equal(c.issue, '5-0'); assert.equal(c.language, 'en');
  assert.equal(c.codeMode, 'all', 'an unusable selection leaves the project offering every code'); assert.equal(c.security, '01'); assert.deepEqual(c.responsiblePartner, { code: '', name: '' });
  assert.deepEqual(c.originator, { code: 'S1KOR', name: 'Studio Originator' }, 'what validated was kept'); assert.equal(c.applicability.act, null); assert.equal(c.brex.mode, 'default');
  assert.equal(b.dmTypes.filter((t) => !t.enabled).length, 0);
  assert.deepEqual(await sns1(id), [['21', 'Aircraft']], 'only the node that validated'); assert.deepEqual(await sns2(id), [['', '21', '', '', '', 'Row']]);
  assert.equal((await w.get(`/api/projects/${id}/sns-rows/ordering`)).json.override, null, 'an ordering with an unknown sort key is not stored');
  const notes = r.json.settings.notes.join('\n');
  for (const re of [/mic = OTHER/, /issue = 4-2/, /security setting/, /information code selection/, /ACT reference/, /SNS node\(s\)/, /SNS row\(s\)/, /SNS ordering/]) assert.match(notes, re);
});

test('importing a package INTO an existing project leaves that project\'s own settings alone', async () => {
  const mine = (await w.post('/api/projects', { name: 'Existing target', format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5-0', responsiblePartner: { code: 'OWN01', name: 'Own Company' }, snsEnforced: false } })).json.project.id;
  const before = JSON.stringify([(await bundle(mine)).config, await sns1(mine), await sns2(mine)]);
  const fd = new FormData(); fd.append('file', new Blob([pkg]), 'p.zip');
  const r = await w.req('POST', `/api/projects/${mine}/packages/import`, fd); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(JSON.stringify([(await bundle(mine)).config, await sns1(mine), await sns2(mine)]), before);
});
