'use strict';
// Issue / in-work revisions as separate files, change-mark suggestions (author-reviewed), release approval issuing the next issue,
// supersession / obsolescence (authorised, reasoned, recorded), and how publication references resolve across revisions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');
const pick = (c) => fs.readdirSync(FIX).find((f) => f.includes(`-${c}A-D_`));
let h; let owner; let pid; let dir; let admin;
const U = () => `/api/projects/${pid}`;
const csdb = () => fs.readdirSync(path.join(dir, 'csdb'));

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'lee', fullName: 'Lee', role: 'author' });
  owner = new h.Client('lee'); await owner.post('/api/auth/login', { username: 'lee', password: m.json.tempPassword }); await owner.post('/api/auth/onboarding', { username: 'lee', password: PW });
  pid = (await owner.post('/api/projects', { name: 'Life', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  dir = path.join(h.ws, 'projects', pid);
  for (const c of ['040', '520']) { const f = pick(c); const r = await owner.post(`${U()}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') }); assert.equal(r.status, 201, JSON.stringify(r.json)); }
});
test.after(async () => { await h.close(); });

let DESC; let REV1;
test('working revision: new file in-work +1, original untouched, identity edited only', async () => {
  DESC = pick('040'); const before = fs.readFileSync(path.join(dir, 'csdb', DESC), 'utf8');
  const r = await owner.post(`${U()}/dms/${DESC}/working-revision`, { reason: 'update text' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); REV1 = r.json.file;
  assert.match(REV1, /_001-01_/); assert.equal(fs.readFileSync(path.join(dir, 'csdb', DESC), 'utf8'), before, 'existing 001-00 untouched');
  const now = fs.readFileSync(path.join(dir, 'csdb', REV1), 'utf8');
  assert.match(now, /issueNumber="001" inWork="01"/);
  assert.equal(now.replace(/inWork="01"/, 'inWork="00"').replace(/<issueDate[^>]*>/, '').length, before.replace(/<issueDate[^>]*>/, '').length, 'only identification attributes differ');
  assert.equal((await owner.post(`${U()}/dms/${DESC}/working-revision`, {})).status, 409, 'must start from the latest revision');
});

test('change suggestions are produced from the previous revision and only applied when chosen', async () => {
  let xml = fs.readFileSync(path.join(dir, 'csdb', REV1), 'utf8');
  const cur = (await owner.get(`${U()}/dms/${REV1}`)).json;
  xml = xml.replace(/<para>([^<]{5,})<\/para>/, '<para>$1 CHANGED TEXT</para>').replace('</description>', '<levelledPara><title>New</title><para>Brand new</para></levelledPara></description>');
  assert.equal((await owner.put(`${U()}/dms/${REV1}`, { xml, baseHash: cur.hash })).status, 200);
  const s = await owner.get(`${U()}/dms/${REV1}/change-suggestions`);
  assert.equal(s.json.against, DESC);
  const types = s.json.suggestions.map((x) => x.type);
  assert.ok(types.includes('modify') && types.includes('add'), JSON.stringify(s.json.suggestions));
  assert.ok(!/changeMark/.test(fs.readFileSync(path.join(dir, 'csdb', REV1), 'utf8')), 'nothing written until the author applies');
  const pick1 = s.json.suggestions.filter((x) => x.type === 'modify')[0];
  const ap = await owner.post(`${U()}/dms/${REV1}/change-marks`, { picks: [{ path: pick1.path, type: 'modify' }] });
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const after = fs.readFileSync(path.join(dir, 'csdb', REV1), 'utf8');
  assert.equal((after.match(/changeMark="1"/g) || []).length, 1); assert.match(after, /changeType="modify"/);
  const v = await owner.post(`${U()}/validate`, {}); void v;
});

test('resolution: unpinned follows the highest revision, pinned stays; recorded history', async () => {
  const L = require('../dist/services/lifecycle');
  const idx = L.chains(pid); const dmc = [...idx.keys()].find((k) => idx.get(k).length === 2).split('|')[0];
  assert.equal(L.resolveRevision(pid, { dmc }).file, REV1);
  assert.equal(L.resolveRevision(pid, { dmc, issueNumber: '001', inWork: '00' }).file, DESC);
  assert.equal(L.resolveRevision(pid, { dmc, issueNumber: '009' }).reason, 'pinned-missing');
  const pmText = `<pm><content><pmEntry><dmRef><dmRefIdent><dmCode ${/<dmCode\s+([^>]*?)\s*\/?>/.exec(fs.readFileSync(path.join(FIX, DESC), 'utf8'))[1]}/></dmRefIdent></dmRef></pmEntry></content></pm>`;
  const rw = L.rewriteRevisionRefs(pid, pmText, 'csdb'); assert.equal(rw.rewritten, 1); assert.match(rw.text, new RegExp(`href="csdb/${REV1}"`)); assert.match(rw.text, /xmlns:xi=/);
  const hist = await owner.get(`${U()}/dms/${DESC}/lifecycle`); assert.equal(hist.json.revisions.length, 2); assert.ok(hist.json.revisions[1].events.some((e) => e.action === 'working-revision'));
});

test('issue: in-work becomes issue+1 / in-work 00 / issueType changed as a NEW file; history kept', async () => {
  const r = await owner.post(`${U()}/dms/${REV1}/issue`, { reason: 'release' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.match(r.json.file, /_002-00_/);
  const x = fs.readFileSync(path.join(dir, 'csdb', r.json.file), 'utf8'); assert.match(x, /issueNumber="002" inWork="00"/); assert.match(x, /<dmStatus[^>]*issueType="changed"/);
  assert.ok(csdb().includes(DESC) && csdb().includes(REV1) && csdb().includes(r.json.file));
  assert.equal((await owner.post(`${U()}/dms/${r.json.file}/issue`, {})).status, 409, 'nothing to issue at in-work 00');
});

test('obsolete / supersede need a reason, a Project Manager, and are recorded; obsolete modules are not published', async () => {
  const PROC = pick('520');
  assert.equal((await owner.post(`${U()}/dms/${PROC}/obsolete`, {})).status, 400, 'reason required');
  const sup = await owner.post(`${U()}/dms/${PROC}/supersede`, { reason: 'replaced', by: PROC });
  assert.equal(sup.status, 400, 'cannot supersede itself');
  const top = csdb().filter((f) => f.includes(DESC.split('_')[0].slice(0, 60))).sort().pop();
  const ok = await owner.post(`${U()}/dms/${PROC}/supersede`, { reason: 'replaced by the descriptive module', by: top });
  assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.match(fs.readFileSync(path.join(dir, 'csdb', ok.json.file), 'utf8'), /issueType="deleted"/);
  const ev = (await owner.get(`${U()}/lifecycle/events`)).json.events; assert.ok(ev.some((e) => e.action === 'supersede' && e.reason && e.detail.supersededBy === top));
  const L = require('../dist/services/lifecycle'); const idx = L.chains(pid); const dmc = [...idx.keys()].find((k) => idx.get(k).some((d) => d.file === ok.json.file)).split('|')[0];
  assert.equal(L.resolveRevision(pid, { dmc }).reason, 'obsolete');
  // an author who is only an editor cannot do it
  const m = await admin.post('/api/team/users', { username: 'edgar', fullName: 'Edgar', role: 'author' }); const ed = new h.Client('edgar'); await ed.post('/api/auth/login', { username: 'edgar', password: m.json.tempPassword }); await ed.post('/api/auth/onboarding', { username: 'edgar', password: PW });
  const er = await ed.post(`${U()}/dms/${top}/obsolete`, { reason: 'x' }); assert.ok([403, 404].includes(er.status), JSON.stringify([er.status, er.json]));
});
