'use strict';
// Release approval issues the in-work revisions of the publication as the next issue (in-work 00, issueType "changed") and the release then covers that content.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const f040 = fs.readdirSync(FIX).find((f) => f.includes('-040A-D_'));
let h;
test.before(async () => { h = await boot(); });
test.after(async () => { await h.close(); });

test('approval issues in-work revisions; the release is current for the issued content; unchanged modules are not re-issued', async () => {
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'rita', fullName: 'Rita', role: 'author' }); const w = new h.Client('rita'); await w.post('/api/auth/login', { username: 'rita', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'rita', password: PW });
  const mk = await w.post('/api/projects', { name: 'Rel', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } }); const pid = mk.json.project.id; const dir = path.join(h.ws, 'projects', pid); const U = `/api/projects/${pid}`;
  assert.equal((await w.post(`${U}/dms`, { file: f040, xml: fs.readFileSync(path.join(FIX, f040), 'utf8') })).status, 201);
  const code = /<dmCode\s+([^>]*?)\s*\/?>/.exec(fs.readFileSync(path.join(FIX, f040), 'utf8'))[1];
  const pm = fs.readFileSync(path.join(dir, 'publication.xml'), 'utf8'); const content = `<content><pmEntry><pmEntryTitle>All</pmEntryTitle><dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef></pmEntry></content>`;
  fs.writeFileSync(path.join(dir, 'publication.xml'), /<content[\s\S]*<\/content>|<content\s*\/>/.test(pm) ? pm.replace(/<content[\s\S]*<\/content>|<content\s*\/>/, content) : pm.replace('</pm>', `${content}</pm>`));
  const rev = await w.post(`${U}/dms/${f040}/working-revision`, {}); assert.equal(rev.status, 201, JSON.stringify(rev.json));
  const req = await w.post(`${U}/release`, {}); assert.equal(req.status, 200, JSON.stringify(req.json).slice(0, 300) || req.status);
  const pending = (await w.get(`${U}/release`)).json.pending; assert.ok(pending, 'a release is pending');
  const ap = await admin.post(`${U}/release/${pending.id}/approve`, {}); assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const files = fs.readdirSync(path.join(dir, 'csdb')); const issued = files.find((f) => /_002-00_/.test(f)); assert.ok(issued, `the next issue exists: ${files.join(', ')}`);
  assert.match(fs.readFileSync(path.join(dir, 'csdb', issued), 'utf8'), /<dmStatus[^>]*issueType="changed"/);
  assert.ok(files.includes(f040) && files.some((f) => /_001-01_/.test(f)), 'history kept');
  const state = (await w.get(`${U}/release`)).json; assert.ok(state.release, 'the project is released'); assert.equal(state.staleRelease, null, 'the approved release matches the issued content');
  assert.ok((await w.get(`${U}/lifecycle/events`)).json.events.some((e) => e.action === 'issue' && e.reason === 'release approval'));
});
