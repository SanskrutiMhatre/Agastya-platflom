'use strict';
// Reinstating a deleted data module (S1000D 4.2 Chap 3.5 para 2.3.3.5: the issue number at the time of deletion + 1; Chap 3.9.5.1: issueType
// rinstate-status / rinstate-changed / rinstate-revised). A Project Manager action with a reason, written as a NEW file, audited, valid, published again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');
const pick = (c) => fs.readdirSync(FIX).find((f) => f.includes(`-${c}A-D_`));
let h; let owner; let pid; let dir; let admin;
const U = () => `/api/projects/${pid}`;

test.before(async () => {
  h = await boot(); admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'rita', fullName: 'Rita', role: 'author' });
  owner = new h.Client('rita'); await owner.post('/api/auth/login', { username: 'rita', password: m.json.tempPassword }); await owner.post('/api/auth/onboarding', { username: 'rita', password: PW });
  pid = (await owner.post('/api/projects', { name: 'Reinstate', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  dir = path.join(h.ws, 'projects', pid);
  const f = pick('040'); assert.equal((await owner.post(`${U()}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') })).status, 201);
});
test.after(async () => { await h.close(); });

test('only an obsolete module can be reinstated, with a reason and a valid kind', async () => {
  const f = pick('040');
  assert.equal((await owner.post(`${U()}/dms/${f}/reinstate`, { kind: 'status', reason: 'x' })).json.code, 'NOT_OBSOLETE', 'a live module cannot be reinstated');
  const del = await owner.post(`${U()}/dms/${f}/obsolete`, { reason: 'withdrawn' }); assert.equal(del.status, 201, JSON.stringify(del.json));
  const deleted = del.json.file; assert.match(deleted, /_002-00_/);
  assert.equal((await owner.post(`${U()}/dms/${deleted}/reinstate`, { kind: 'status' })).json.code, 'REASON_REQUIRED');
  assert.equal((await owner.post(`${U()}/dms/${deleted}/reinstate`, { kind: 'nonsense', reason: 'x' })).json.code, 'BAD_REINSTATE_KIND');
  assert.equal((await owner.post(`${U()}/dms/${f}/reinstate`, { kind: 'status', reason: 'x' })).json.code, 'NOT_LATEST', 'only from the latest revision');
});

test('reinstating writes issue + 1 with the rinstate- issueType, is audited, valid, and the module is published again', async () => {
  const L = require('../dist/services/lifecycle'); const idx = L.chains(pid);
  const deleted = [...idx.values()].flat().sort((a, b) => L.revKey(b) - L.revKey(a))[0].file;
  const r = await owner.post(`${U()}/dms/${deleted}/reinstate`, { kind: 'changed', reason: 'needed again' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.match(r.json.file, /_003-00_/, 'issue number at deletion + 1');
  const xml = fs.readFileSync(path.join(dir, 'csdb', r.json.file), 'utf8');
  assert.match(xml, /issueType="rinstate-changed"/); assert.match(xml, /issueNumber="003" inWork="00"/);
  assert.ok(fs.existsSync(path.join(dir, 'csdb', deleted)), 'the deleted issue stays in the history');
  const ev = (await owner.get(`${U()}/lifecycle/events`)).json.events;
  assert.ok(ev.some((e) => e.action === 'reinstate' && e.reason === 'needed again' && e.detail.issueType === 'rinstate-changed'));
  // published again: an unpinned reference now resolves to the reinstated issue
  const dmc = [...L.chains(pid).keys()][0].split('|')[0];
  assert.equal(L.resolveRevision(pid, { dmc }).file, r.json.file);
  // the schema accepts the new issueType
  const run = (await owner.post(`${U()}/validation`, { brex: false })).json.run;
  assert.deepEqual(run.issues.filter((i) => i.source === 'xsd' && String(i.rel ?? '').endsWith(r.json.file)), [], 'XSD-valid');
  // an editor who is not a Project Manager cannot do it
  const m = await admin.post('/api/team/users', { username: 'edda', fullName: 'Edda', role: 'author' }); const ed = new h.Client('edda'); await ed.post('/api/auth/login', { username: 'edda', password: m.json.tempPassword }); await ed.post('/api/auth/onboarding', { username: 'edda', password: PW });
  const er = await ed.post(`${U()}/dms/${r.json.file}/reinstate`, { kind: 'status', reason: 'x' }); assert.ok([403, 404].includes(er.status), JSON.stringify([er.status, er.json]));
});
