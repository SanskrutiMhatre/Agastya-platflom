'use strict';
// UI redesign screen 2 (Project Home, mockup docs/audit/mockups/project.html): the read-only figures the summary adds for the Home header and
// the Last build cell.
//   - an S1000D project reports its S1000D issue and model identification code (from the data modules while no configuration names them)
//   - after a build, the summary names the PDF's page count; before one, there is no build
//   - a JSS project has no S1000D identity
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let author;

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'hana', fullName: 'Hana Home', role: 'author' });
  author = new h.Client('hana');
  await author.post('/api/auth/login', { username: 'hana', password: made.json.tempPassword });
  await author.post('/api/auth/onboarding', { username: 'hana', password: PW });
});
test.after(async () => { await h.close(); });

test('an S1000D project: issue and model code in the summary, and the page count of the last PDF', { timeout: 300000 }, async () => {
  const id = (await author.post('/api/projects/sample', {})).json.project.id;
  const before = await author.get(`/api/projects/${id}/summary`);
  assert.equal(before.status, 200);
  assert.equal(before.json.build, null, 'nothing built yet');
  assert.ok(before.json.s1000d, 'an S1000D project names its identity');
  assert.match(before.json.s1000d.issue, /^\d\.\d$/);
  const dms = (await author.get(`/api/projects/${id}/dms`)).json.dms;
  assert.equal(before.json.s1000d.mic, dms[0].dmc.split('-')[0], 'the model code the data modules carry');
  const built = await author.post(`/api/projects/${id}/publish`, { allowRuleBreaks: true });
  assert.equal(built.status, 200, JSON.stringify(built.json).slice(0, 300));
  const after = (await author.get(`/api/projects/${id}/summary`)).json;
  assert.ok(after.build && after.build.size > 0);
  assert.ok(Number.isInteger(after.build.pages) && after.build.pages > 0, `a page count (${after.build.pages})`);
  const again = (await author.get(`/api/projects/${id}/summary`)).json;
  assert.equal(again.build.pages, after.build.pages, 'the same file gives the same count');
});

test('a JSS project has no S1000D identity in its summary', { timeout: 120000 }, async () => {
  const r = await author.post('/api/projects', { name: 'Home JSS', format: 'jss', domain: 'land', manualType: 'uhb' });
  assert.equal(r.status, 201);
  const s = (await author.get(`/api/projects/${r.json.project.id}/summary`)).json;
  assert.equal(s.s1000d, null);
});
