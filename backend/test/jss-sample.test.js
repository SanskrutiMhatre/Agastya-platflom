'use strict';
// The JSS samples (d87dc48): POST /api/projects/sample-jss makes a Land or Naval User Handbook filled with dummy data, valid, owned by the
// caller, with its placeholder picture, and audited as project.created (through createProject).
const test = require('node:test');
const assert = require('node:assert/strict');

const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let w; let admin;
test.before(async () => {
  h = await boot(); admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'sam', fullName: 'Sam', role: 'author' });
  w = new h.Client('sam'); await w.post('/api/auth/login', { username: 'sam', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'sam', password: PW });
});
test.after(async () => { await h.close(); });

for (const [domain, type] of [['land', 'uhb'], ['naval', 'naval-uhb']]) {
  test(`the JSS ${domain} sample: a valid ${type} with dummy data under every heading and its picture`, { timeout: 120000 }, async () => {
    const r = await w.post('/api/projects/sample-jss', domain === 'land' ? {} : { domain });
    assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 300));
    const p = r.json.project;
    assert.match(p.name, new RegExp(`JSS ${domain === 'land' ? 'Land' : 'Naval'} User Handbook \\(Dummy Data\\)`));
    const g = (await w.get(`/api/projects/${p.id}/jss`)).json;
    assert.equal(g.report.errors, 0, JSON.stringify(g.report.findings.slice(0, 2)));
    assert.match(g.xml, /<systemName>Demo Equipment DE-100<\/systemName>/);
    assert.ok((g.xml.match(/This is dummy text for the section/g) || []).length >= 5, 'dummy text under the sections');
    assert.match(g.xml, /<graphic src="Media\/sample-figure.png"/);
    const card = (await w.get(`/api/projects/${p.id}`)).json.project;
    assert.equal(card.format, 'jss'); assert.equal(card.domain ?? domain, domain);
    const pic = await w.get(`/api/projects/${p.id}/media/sample-figure.png`);
    assert.equal(pic.status, 200, 'the placeholder picture is in the project');
    // a second one gets its own name
    const again = await w.post('/api/projects/sample-jss', { domain });
    assert.equal(again.status, 201); assert.notEqual(again.json.project.name, p.name);
  });
}

test('the JSS sample needs sign-in', async () => {
  const anon = new h.Client('anon');
  assert.equal((await anon.post('/api/projects/sample-jss', {})).status, 401);
});
