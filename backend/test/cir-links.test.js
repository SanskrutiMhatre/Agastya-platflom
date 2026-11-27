'use strict';
// CIR linked copies: version tracking ("update available"), Project Manager approval, protection of the shared module from accidental local edits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const f = fs.readdirSync(FIX).find((x) => x.includes('-00LA-D_')) || fs.readdirSync(FIX).find((x) => x.includes('-040A-D_'));
let h; let w; let mgr; let pid; let admin;
const U = () => `/api/projects/${pid}`;
const upload = (c, name, text) => { const fd = new FormData(); fd.append('files', new Blob([text]), name); fd.append('note', 'test'); return c.req('POST', '/api/cir', fd); };

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const mk = async (u, role) => { const m = await admin.post('/api/team/users', { username: u, fullName: u, role }); const c = new h.Client(u); await c.post('/api/auth/login', { username: u, password: m.json.tempPassword }); await c.post('/api/auth/onboarding', { username: u, password: PW }); return c; };
  w = await mk('carol', 'author');
  pid = (await w.post('/api/projects', { name: 'Linked', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  mgr = w;                                                         // the creator is the project's owner (>= manager)
});
test.after(async () => { await h.close(); });

test('copy creates a linked copy; unchanged repository = up to date', async () => {
  const xml = fs.readFileSync(path.join(FIX, f), 'utf8');
  assert.equal((await upload(w, f, xml)).status, 201);
  const c = await w.post(`/api/cir/${f}/copy`, { projectId: pid }); assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.linked, true);
  const l = (await w.get(`${U()}/cir-links`)).json.links; assert.equal(l.length, 1); assert.equal(l[0].state, 'up-to-date');
});

test('a linked copy cannot be edited in the project', async () => {
  const cur = (await w.get(`${U()}/dms/${f}`)).json;
  const r = await w.put(`${U()}/dms/${f}`, { xml: cur.xml.replace('<para>', '<para>LOCAL '), baseHash: cur.hash });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'CIR_LINKED');
});

test('repository change -> update available + notification; approval takes it over; history kept', async () => {
  const xml = fs.readFileSync(path.join(FIX, f), 'utf8');
  const changed = xml.replace(/(<(?:para|simplePara)>)/, '$1CIR-CHANGED ');
  assert.notEqual(changed, xml);
  assert.equal((await upload(w, f, changed)).status, 201);
  let l = (await w.get(`${U()}/cir-links`)).json.links; assert.equal(l[0].state, 'update-available');
  const notes = (await admin.get('/api/notifications')).json;      // no project manager member: the approvers are the administrators assert.ok(JSON.stringify(notes).includes('Update available for a shared module'), JSON.stringify(notes).slice(0, 300));
  const ap = await mgr.post(`${U()}/cir-links/${f}/update`, {}); assert.equal(ap.status, 200, JSON.stringify(ap.json)); assert.equal(ap.json.changed, true);
  assert.match(fs.readFileSync(path.join(h.ws, 'projects', pid, 'csdb', f), 'utf8'), /CIR-CHANGED/);
  l = (await w.get(`${U()}/cir-links`)).json.links; assert.equal(l[0].state, 'up-to-date'); assert.ok(l[0].approvedBy);
  assert.ok((await w.get(`${U()}/dms/${f}/history`)).json.revisions.length >= 2, 'previous content is in history');
});

test('detach makes it the project\'s own again', async () => {
  assert.equal((await mgr.del(`${U()}/cir-links/${f}`)).status, 200);
  const cur = (await w.get(`${U()}/dms/${f}`)).json;
  assert.equal((await w.put(`${U()}/dms/${f}`, { xml: cur.xml.replace('CIR-CHANGED', 'OWN-EDIT'), baseHash: cur.hash })).status, 200);
});
