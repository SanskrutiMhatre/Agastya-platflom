'use strict';
// A SCORM content package can only be schema-checked if the IEEE LOM schema its XSD imports is installed. It is NOT bundled (the official
// IEEE LTSC URL is login-gated and nothing is substituted), so the XSD cannot compile. This test pins the HONEST behaviour: such a file is
// accepted as a document (well-formed, right root, right file name) but is reported as NOT schema-checked - never as valid.
// If the LOM schema is ever installed, the first test fails on purpose: then the package must validate and the matrix be updated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FX = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'studio', '__tests__', 'rich', 'objects');
const DM = DM21;
let h; let w;

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'olga', fullName: 'Olga', role: 'author' });
  w = new h.Client('olga'); await w.post('/api/auth/login', { username: 'olga', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'olga', password: PW });
});
test.after(async () => { await h.close(); });

test('the LOM schema the SCORM XSD imports is not bundled (so SCORM XSD validation cannot run)', () => {
  const S = path.resolve(__dirname, '..', 'schemas');
  for (const issue of ['4.2', '5.0', '6.0']) {
    assert.match(fs.readFileSync(path.join(S, issue, 'scormcontentpackage.xsd'), 'utf8'), /schemaLocation="\.\.\/lom_schema\/lom\.xsd"/);
    assert.equal(fs.existsSync(path.join(S, 'lom_schema', 'lom.xsd')), false, 'the LOM schema is installed: SCORM validation can now run - update this test and the compliance matrix');
  }
});

for (const [dir, label] of [['4-2', '4.2'], ['5-0', '5.0'], ['6', '6.0']]) {
  test(`${label}: a SCORM package is stored, but reported as NOT schema-checked (never as valid)`, async () => {
    const pr = await w.post('/api/projects', { name: `Scorm ${label}`, pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: label, responsiblePartner: { code: '00000', name: 'Example Company' } } });
    const U = `/api/projects/${pr.json.project.id}`; const d = path.join(DM, dir);
    const f = fs.readdirSync(d).find((x) => /-040A-D_/.test(x));
    assert.equal((await w.post(`${U}/dms`, { file: f, xml: fs.readFileSync(path.join(d, f), 'utf8') })).status, 201);
    const xml = fs.readFileSync(path.join(FX, dir, 'scorm.xml'), 'utf8');
    const { expectedFileName } = require('../dist/services/csdbObjects');
    const file = expectedFileName('scorm', xml);
    const put = await w.post(`${U}/objects`, { file, xml });
    assert.equal(put.status, 201, JSON.stringify(put.json));
    const run = (await w.post(`${U}/validation`, { brex: false })).json.run;
    const mine = run.issues.filter((i) => (i.rel ?? i.file ?? '').endsWith(file) || String(i.rel ?? '').toUpperCase().endsWith(file.toUpperCase()));
    const flagged = run.unchecked.some((u) => u.toUpperCase().endsWith(file.toUpperCase())) || mine.length > 0;
    assert.ok(flagged, `the SCORM package must be reported as not checked, not silently valid. unchecked=${JSON.stringify(run.unchecked)} issues=${JSON.stringify(run.issues.slice(0, 3))}`);
  });
}
