'use strict';
// The two SNS implementations stay SEPARATE (docs/SNS_SYSTEMS.md):
//   system 1  presets + the project's own SNS in the database   (project_sns, sns_presets)   /api/projects/:id/sns   /api/s1000d/presets   /api/admin/s1000d/presets
//   system 2  row model: derive / learn / ordering / BREX import (<project>/.sns.json,       /api/projects/:id/sns-rows   /api/sns/defaults
//             organisation defaults in config_items 'sns-defaults')
// Neither reads, writes, mirrors or migrates the other. This test pins that down: a change through one system is invisible to the other, in the API and
// in its storage, for a project that already has data and for a project created afterwards.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let owner; let a; let b; let c;
const U = (id, s) => `/api/projects/${id}${s}`;
const dbRows = (sql, ...p) => { const { store } = require('../dist/context'); return store.db.prepare(sql).all(...p).map((r) => ({ ...r })); };   // node:sqlite rows have a null prototype: copy them so deepEqual compares plain objects
const snsFile = (id) => path.join(h.ws, 'projects', id, '.sns.json');

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'olive', fullName: 'Olive Owner', role: 'author' });
  owner = new h.Client('olive');
  await owner.post('/api/auth/login', { username: 'olive', password: made.json.tempPassword });
  await owner.post('/api/auth/onboarding', { username: 'olive', password: PW });
  const mk = async (name) => (await owner.post('/api/projects', { name, format: 's1000d', s1000d: { mic: 'SEP', issue: '4.2', responsiblePartner: { code: '00000', name: 'Sep Co' } } })).json.project.id;
  a = await mk('Sep A'); b = await mk('Sep B');
});
test.after(async () => { await h.close(); });

const sys1 = async (id) => (await owner.get(U(id, '/sns'))).json;
const sys2 = async (id) => (await owner.get(U(id, '/sns-rows'))).json;

test('a new project starts empty in both systems, and each has its own storage', async () => {
  for (const id of [a, b]) {
    assert.equal((await sys1(id)).total, 0, 'system 1 (project_sns) is empty');
    assert.equal((await sys2(id)).rows.length, 0, 'system 2 (.sns.json) is empty');
    assert.equal(fs.existsSync(snsFile(id)), false, 'no row-model file until a row is written');
    assert.equal(dbRows('SELECT COUNT(*) n FROM project_sns WHERE project_id = ?', id)[0].n, 0);
  }
});

test('writing through system 1 leaves system 2 untouched, and the other way round', async () => {
  // system 1: the project's SNS in the database
  assert.equal((await owner.post(U(a, '/sns'), { path: '21', title: 'Air conditioning' })).status, 201);
  assert.equal((await sys1(a)).total, 1);
  assert.equal((await sys2(a)).rows.length, 0, 'system 2 does not see it');
  assert.equal(fs.existsSync(snsFile(a)), false, 'and no .sns.json was created for it');

  // system 2: a row in the project's .sns.json
  const row = await owner.post(U(a, '/sns-rows'), { systemCode: '32', title: 'Landing gear' });
  assert.equal(row.status, 201, JSON.stringify(row.json));
  assert.equal((await sys2(a)).rows.length, 1);
  assert.ok(fs.existsSync(snsFile(a)), 'the row model lives in the project file');
  assert.equal((await sys1(a)).total, 1, 'system 1 still holds exactly its own node');
  assert.deepEqual(dbRows('SELECT path, title FROM project_sns WHERE project_id = ?', a), [{ path: '21', title: 'Air conditioning' }], 'and the database holds nothing of the row model');

  // each system's content is its own
  assert.ok(!JSON.stringify(await sys1(a)).includes('Landing gear'));
  assert.ok(!JSON.stringify(await sys2(a)).includes('Air conditioning'));
});

test('deleting in one system does not touch the other', async () => {
  const rows = (await sys2(a)).rows;
  assert.equal((await owner.del(U(a, `/sns-rows/${rows[0].id}`))).status, 200);
  assert.equal((await sys2(a)).rows.length, 0);
  assert.equal((await sys1(a)).total, 1, 'system 1 node survives the row deletion');

  assert.equal((await owner.req('DELETE', U(a, '/sns?path=21'))).status, 200);
  assert.equal((await sys1(a)).total, 0);
  assert.equal((await owner.post(U(a, '/sns-rows'), { systemCode: '49', title: 'APU' })).status, 201);
  assert.equal((await owner.req('DELETE', U(a, '/sns?path=21'))).status < 500, true);
  assert.equal((await sys2(a)).rows.length, 1, 'the row survives the node deletion (and a repeat delete)');
});

test('another project is unaffected by either system', async () => {
  assert.equal((await sys1(b)).total, 0);
  assert.equal((await sys2(b)).rows.length, 0);
  assert.equal(fs.existsSync(snsFile(b)), false);
});

test('the administrator surfaces are separate too: presets (system 1) and organisation defaults (system 2)', async () => {
  const presetsBefore = (await admin.get('/api/s1000d/presets')).json.presets.length;
  const defaultsBefore = (await admin.get('/api/sns/defaults')).json.rows.length;

  const p = await admin.post('/api/admin/s1000d/presets', { name: 'Separation preset' });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  assert.equal((await admin.get('/api/s1000d/presets')).json.presets.length, presetsBefore + 1);
  assert.equal((await admin.get('/api/sns/defaults')).json.rows.length, defaultsBefore, 'creating a preset adds no organisation default');

  const d = await admin.post('/api/sns/defaults', { systemCode: '71', title: 'Powerplant' });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  assert.equal((await admin.get('/api/sns/defaults')).json.rows.length, defaultsBefore + 1);
  assert.equal((await admin.get('/api/s1000d/presets')).json.presets.length, presetsBefore + 1, 'creating a default adds no preset');
  assert.equal(dbRows("SELECT COUNT(*) n FROM config_items WHERE collection = 'sns-defaults'")[0].n, defaultsBefore + 1, 'defaults live in config_items');
  assert.equal(dbRows("SELECT COUNT(*) n FROM sns_presets WHERE name = 'Separation preset'")[0].n, 1, 'presets live in their own tables');
});

test('a project created AFTER the organisation changes still starts empty in both systems (nothing is copied across)', async () => {
  c = (await owner.post('/api/projects', { name: 'Sep C', format: 's1000d', s1000d: { mic: 'SEP', issue: '4.2', responsiblePartner: { code: '00000', name: 'Sep Co' } } })).json.project.id;
  assert.equal((await sys1(c)).total, 0, 'an organisation default is not copied into the preset-based SNS');
  assert.equal((await sys2(c)).rows.length, 0, 'a preset is not copied into the row model');
  assert.equal(fs.existsSync(snsFile(c)), false);
});
