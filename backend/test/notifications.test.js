'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
let h; let admin; let pm; let ann; let ben; let pid;

async function person(creator, role, username, fullName) {
  const made = await creator.post('/api/team/users', { username, fullName, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.ok(made.json.tempPassword.startsWith(`${username}-`) && /-[a-hjkmnp-z2-9]{8}$/.test(made.json.tempPassword), made.json.tempPassword);   // SEC-004
  const c = new h.Client(username);
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  c.id = made.json.user.id;
  return c;
}
const inbox = async (c) => (await c.get('/api/notifications')).json;

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
});
test.after(async () => { await h.close(); });

test('username suggestion: first name, then firstname.lastinitial, then a number', async () => {
  const sug = async (name) => (await admin.get(`/api/team/username-suggestion?name=${encodeURIComponent(name)}`)).json.username;
  assert.equal(await sug('Meera Rao'), 'meera');
  pm = await person(admin, 'project_manager', 'meera', 'Meera Rao');
  assert.equal(await sug('Meera Das'), 'meera.d', 'the first name is taken');
  assert.equal(await sug('Meera Rao'), 'meera.r');
  await person(pm, 'author', 'meera.d', 'Meera Das');
  assert.equal(await sug('Meera Dutta'), 'meera.d2', 'both forms taken, so a number is added');
  assert.equal(await sug('Admin Person'), 'admin.p', 'reserved names are never suggested');
  assert.equal((await pm.get('/api/team/username-suggestion?name=Zed')).json.username, 'zed');
});

test('account creation notifies the administrator; an author cannot read others notifications', async () => {
  ann = await person(pm, 'author', 'ann', 'Ann Author');
  ben = await person(pm, 'author', 'ben', 'Ben Author');
  const adm = await inbox(admin);
  assert.ok(adm.unread >= 2);
  assert.ok(adm.items.some((n) => n.kind === 'account.created' && /@ann/.test(n.body)));
  assert.equal((await inbox(ann)).items.length, 0, 'authors see only their own inbox');
});

test('release request reaches the project manager; the decision reaches the author', async () => {
  const mk = await ann.post('/api/projects', { name: 'Ann Manual', pipeline: 's1000dtofo' });
  pid = mk.json.project.id;
  await ann.post(`/api/projects/${pid}/dms`, { file: DM, xml: h.sample(DM) });
  // Ann adds the Project Manager; the manager hears about it
  assert.equal((await ann.post(`/api/projects/${pid}/assign`, { username: 'meera', role: 'manager' })).status, 200);
  const got = await inbox(pm);
  assert.ok(got.items.some((n) => n.kind === 'access.granted' && n.projectId === pid));
  assert.equal(got.items.find((n) => n.kind === 'access.granted').read, false);

  await ann.post(`/api/projects/${pid}/release`, { scheduledAt: new Date(Date.now() + 60000).toISOString() });
  const asked = (await inbox(pm)).items.find((n) => n.kind === 'approval.requested');
  assert.ok(asked, 'the manager is asked to approve');
  assert.equal((await inbox(admin)).items.some((n) => n.kind === 'approval.requested'), false, 'administrators are told only when a project has no manager');

  const rel = (await pm.get(`/api/projects/${pid}/release`)).json;
  assert.equal((await pm.post(`/api/projects/${pid}/release/${rel.pending.id}/reject`)).status, 200);
  const back = (await inbox(ann)).items.find((n) => n.kind === 'approval.rejected');
  assert.ok(back && /rejected/.test(back.body));
});

test('sharing and removing access notifies the person; marking read is per user', async () => {
  assert.equal((await ann.post(`/api/projects/${pid}/assign`, { username: 'ben', role: 'viewer' })).status, 200);
  let b = await inbox(ben);
  assert.equal(b.unread, 1);
  assert.equal(b.items[0].kind, 'access.granted');
  assert.ok((await inbox(pm)).items.some((n) => n.kind === 'access.shared'), 'the manager sees who else gets in');

  const r = await ben.post('/api/notifications/read', { ids: [b.items[0].id] });
  assert.equal(r.json.unread, 0);
  assert.equal((await ann.post('/api/notifications/read', { ids: [b.items[0].id] })).status, 200);   // someone else's id is ignored, not an error
  assert.equal((await inbox(ben)).items[0].read, true);

  await ann.patch(`/api/projects/${pid}/members/${ben.id}`, { role: 'editor' });
  await ann.del(`/api/projects/${pid}/members/${ben.id}`);
  b = await inbox(ben);
  assert.deepEqual(b.items.slice(0, 2).map((n) => n.kind), ['access.removed', 'access.changed']);
  assert.equal((await ben.post('/api/notifications/read', {})).json.unread, 0, 'no ids marks everything read');
  assert.equal((await new h.Client('anon').get('/api/notifications')).status, 401);
});

test('backup: authors get their own projects, administrators the whole platform, never password hashes', async () => {
  const zipNames = (buf) => {
    const names = []; let i = 0;
    while ((i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i)) !== -1) {
      const n = buf.readUInt16LE(i + 28); names.push(buf.toString('utf8', i + 46, i + 46 + n)); i += 46 + n;
    }
    return names;
  };
  const mine = await ann.get('/api/backup');
  assert.equal(mine.status, 200);
  assert.match(mine.headers.get('content-type'), /zip/);
  const a = zipNames(mine.buf);
  assert.ok(a.some((n) => /^projects\/Ann_Manual-/.test(n) && /DMC-S1KSTUDIO/i.test(n)));
  assert.ok(!a.some((n) => n.startsWith('platform/')), 'authors get no platform data');

  const benZip = zipNames((await ben.get('/api/backup')).buf);
  assert.ok(!benZip.some((n) => /Ann_Manual/.test(n)), "Ben lost access, so Ann's project is not in his backup");

  const all = (await admin.get('/api/backup')).buf;
  const names = zipNames(all);
  assert.ok(names.includes('platform/users.json') && names.includes('platform/audit-log.json') && names.includes('manifest.json'));
  assert.equal(all.includes(Buffer.from('password_hash')), false);
});

test('administrators cannot create projects; project managers can', async () => {
  assert.equal((await admin.post('/api/projects', { name: 'Nope' })).status, 403);
  assert.equal((await pm.post('/api/projects', { name: 'Managed' })).status, 201);
  assert.ok((await inbox(admin)).items.some((n) => n.kind === 'project.created'));
});
