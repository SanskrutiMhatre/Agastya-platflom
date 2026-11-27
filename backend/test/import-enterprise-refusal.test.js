'use strict';
// A package whose data modules name an enterprise the Administrator has NOT registered is refused on import-first - and the refusal says why.
//
// Found on a real installation: an author imported a package (data modules naming enterprise 00000 / "Example Company") into a workspace whose
// Administrator lists register only 1671Y / LNTDEFENCE. Nothing was imported, which is the check working as designed, but the dialog said only
// "The report says why." with no report to read. The server's message now carries the reason (and how many files it covers); the whole per-file
// report stays in the body, which the dialog groups and shows (frontend/src/components/importRefusal.ts).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const DM = fs.readdirSync(FIX).find((f) => /-040A-D_/.test(f));
let h; let admin; let w;

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'enid', fullName: 'Enid', role: 'author' });
  w = new h.Client('enid'); await w.post('/api/auth/login', { username: 'enid', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'enid', password: PW });
});
test.after(async () => { if (h) await h.close(); });

async function exportOf(name, xmlEdit = (x) => x) {
  const pr = await w.post('/api/projects', { name, format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5-0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(pr.status, 201, JSON.stringify(pr.json).slice(0, 300));
  const U = `/api/projects/${pr.json.project.id}`;
  const saved = await w.post(`${U}/dms`, { file: DM, xml: xmlEdit(fs.readFileSync(path.join(FIX, DM), 'utf8')) });
  assert.equal(saved.status, 201, JSON.stringify(saved.json).slice(0, 300));
  const exp = await w.get(`${U}/packages/project`); assert.equal(exp.status, 200); return exp.buf;
}
async function importFirst(buf, name) {
  const fd = new FormData(); fd.append('file', new Blob([buf]), 'package.zip');
  const det = await w.req('POST', '/api/projects/import/detect', fd); assert.equal(det.status, 200, JSON.stringify(det.json).slice(0, 200));
  return w.post('/api/projects/import', { token: det.json.token, name, format: 's1000d' });
}

test('a package naming an unregistered enterprise is refused with the reason in the message and the report in the body; no project is left behind', async () => {
  const pkg = await exportOf('Made while the lists are empty');                       // nothing registered yet: the check is off, so this saves
  assert.equal((await admin.post('/api/admin/config/rpc-cages', { cage: '1671Y', name: 'LNTDEFENCE', role: 'RPC' })).status, 201);
  assert.equal((await admin.post('/api/admin/config/originator-cages', { cage: '1671Y', name: 'LNTDEFENCE', role: 'ORG' })).status, 201);

  const r = await importFirst(pkg, 'Refused import');
  assert.equal(r.status, 422, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.json.code, 'IMPORT_REFUSED');
  assert.match(r.json.error, /^The package was not imported, so no project was created\. /, 'the sentence the dialog and tests know');
  assert.match(r.json.error, /enterprise code .00000. is not registered/, 'the first reason is IN the message, not only in the report');
  assert.doesNotMatch(r.json.error, /The report says why/, 'there is a reason to give');
  const rejected = r.json.report.items.filter((i) => i.status === 'rejected');
  assert.ok(rejected.length >= 1 && rejected.every((i) => /not registered/.test(i.message) && i.path), 'the per-file report names each refused module and the reason');
  assert.equal(r.json.report.applied, false);
  const mine = (await w.get('/api/projects')).json.projects.map((p) => p.name);
  assert.ok(!mine.includes('Refused import'), 'no empty project is left behind');
});

test('the same data, naming a registered enterprise, imports', async () => {
  const pkg = await exportOf('Made with the registered enterprise', (x) => x.split('enterpriseCode="00000"').join('enterpriseCode="1671Y"').split('<enterpriseName>Example Company</enterpriseName>').join('<enterpriseName>LNTDEFENCE</enterpriseName>'));
  const r = await importFirst(pkg, 'Accepted import');
  assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 400));
  assert.equal(r.json.report.applied, true);
  assert.ok(r.json.report.counts.accepted >= 1 && r.json.report.counts.rejected === 0, JSON.stringify(r.json.report.counts));
});
