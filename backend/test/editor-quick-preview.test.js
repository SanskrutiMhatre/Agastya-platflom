'use strict';
// The JSS and JSG editors' Quick preview (POST /api/projects/:id/jss/preview, POST /api/projects/:id/jsg/preview): the saved document rendered
// by the same engine as Generate, as a DRAFT beside the publication's PDF. It must leave the publication alone: no jss-output.pdf / jsg-output.pdf
// written, no build state (what the download and the release flow read), no publish / jsg job in the publication history (the Publication page
// lists the kinds publish, jsg and configured). A refused document (a schema error) is refused as Generate refuses it (422); a project of another
// format is not found; a viewer may not run it (the authz matrix pins the guard; checked here too).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let w; let v;

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const person = async (username) => {
    const m = await admin.post('/api/team/users', { username, fullName: username, role: 'author' });
    const c = new h.Client(username); await c.post('/api/auth/login', { username, password: m.json.tempPassword }); await c.post('/api/auth/onboarding', { username, password: PW });
    return c;
  };
  w = await person('qpauthor'); v = await person('qpviewer');
});
test.after(async () => { await h.close(); });

const isPdf = (r) => r.buf && r.buf.subarray(0, 5).toString() === '%PDF-';
const kinds = async (id) => (await w.get(`/api/projects/${id}/jobs?limit=50`)).json.jobs.map((j) => j.kind);

test('JSS: Quick preview renders the saved document as a draft and leaves the publication alone', async () => {
  const r = await w.post('/api/projects/sample-jss', { domain: 'land' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.project.id; const dir = path.join(h.ws, 'projects', id);

  const pv = await w.req('POST', `/api/projects/${id}/jss/preview`, {});
  assert.equal(pv.status, 200, JSON.stringify(pv.json ?? null).slice(0, 400));
  assert.match(String(pv.headers.get('content-type')), /application\/pdf/);
  assert.ok(isPdf(pv), 'a PDF comes back');
  assert.ok(pv.buf.length > 5000);
  assert.ok(fs.existsSync(path.join(dir, '_quick-preview.pdf')), 'the draft is kept beside the publication');
  assert.equal(fs.existsSync(path.join(dir, 'jss-output.pdf')), false, 'the publication PDF is not written');
  assert.equal(fs.existsSync(path.join(dir, '.publish-state.json')), false, 'no build state: the download and the release flow see nothing');
  assert.equal((await w.get(`/api/projects/${id}/publish/pdf`)).status, 404, 'there is still no publication PDF');
  const k = await kinds(id);
  assert.ok(k.includes('doc-preview'), `the preview ran as a job (${k})`);
  assert.equal(k.filter((x) => x === 'publish' || x === 'jsg' || x === 'configured').length, 0, 'nothing in the publication history');

  // a viewer may not build or preview
  await w.post(`/api/projects/${id}/assign`, { username: 'qpviewer', role: 'viewer' });
  assert.equal((await v.req('POST', `/api/projects/${id}/jss/preview`, {})).status, 403);

  // a document the gate refuses is refused here too (as Generate refuses it)
  const doc = (await w.get(`/api/projects/${id}/jss`)).json;
  const broken = doc.xml.replace(/<\/chapter>/, '<bogus/></chapter>');
  assert.notEqual(broken, doc.xml);
  assert.equal((await w.put(`/api/projects/${id}/jss`, { xml: broken, baseHash: doc.hash })).status, 200);
  const refused = await w.req('POST', `/api/projects/${id}/jss/preview`, {});
  assert.equal(refused.status, 422, JSON.stringify(refused.json ?? null).slice(0, 300));
});

test('JSG: Quick preview renders the saved document as a draft and leaves the document PDF alone', async () => {
  const r = await w.post('/api/projects/sample-jsg', { kind: 'uhb' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id = r.json.project.id; const dir = path.join(h.ws, 'projects', id);

  const pv = await w.req('POST', `/api/projects/${id}/jsg/preview`, {});
  assert.equal(pv.status, 200, JSON.stringify(pv.json ?? null).slice(0, 400));
  assert.ok(isPdf(pv), 'a PDF comes back');
  assert.ok(fs.existsSync(path.join(dir, '_quick-preview.pdf')));
  assert.equal(fs.existsSync(path.join(dir, 'jsg-output.pdf')), false, 'the document PDF is not written');
  assert.equal(fs.existsSync(path.join(dir, '.jsg-publish-state.json')), false, 'no build state');
  assert.equal((await w.get(`/api/projects/${id}/jsg/pdf`)).status, 404);
  const k = await kinds(id);
  assert.ok(k.includes('jsg-preview'), `the preview ran as a job (${k})`);
  assert.equal(k.filter((x) => x === 'publish' || x === 'jsg' || x === 'configured').length, 0, 'nothing in the publication history');

  // Generate still builds the document PDF afterwards, from the same document
  const b = await w.post(`/api/projects/${id}/jsg/build`);
  assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 300));
  assert.ok(fs.existsSync(path.join(dir, 'jsg-output.pdf')));
});

test('a project of another format has no JSS / JSG Quick preview', async () => {
  const s = await w.post('/api/projects/sample', {});
  assert.equal(s.status, 201);
  const id = s.json.project.id;
  assert.equal((await w.req('POST', `/api/projects/${id}/jss/preview`, {})).status, 404);
  assert.equal((await w.req('POST', `/api/projects/${id}/jsg/preview`, {})).status, 404);
});
