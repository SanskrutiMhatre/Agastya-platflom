'use strict';
// Administrator / Project Manager / Author: who can create whom, who sees which project,
// who may share it, who approves a release, and what the activity dashboard shows each of them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';

test('migration 013: an existing database keeps its people and memberships, and old users become authors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-v2-mig-'));
  const db = new DatabaseSync(path.join(dir, 'old.db'));
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'JSS', template TEXT DEFAULT 'default',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened TEXT);`);
  const { AuthStore, MIGRATIONS } = require('../dist/core/auth/store');
  const withoutNew = MIGRATIONS.filter((m) => m.name !== '013-manager-and-author-roles');
  const full = [...MIGRATIONS];
  MIGRATIONS.length = 0; MIGRATIONS.push(...withoutNew);          // the schema as it was before roles
  const store = new AuthStore(db);
  store.migrate('2026-01-01T00:00:00Z');

  const now = '2026-01-01T00:00:00Z';
  db.exec(`INSERT INTO projects (id,name,created_at,updated_at) VALUES ('p1','P1','${now}','${now}');`);
  store.createUser({ id: 'u-admin', username: 'boss', fullName: 'Boss', role: 'admin', passwordHash: 'x', now });
  store.createUser({ id: 'u-old', username: 'oldie', fullName: 'Old Timer', role: 'user', passwordHash: 'x', now });
  store.upsertMember('p1', 'u-old', 'owner', null, now);
  store.createInvitation({ id: 'inv1', projectId: 'p1', userId: 'u-admin', role: 'viewer', invitedBy: 'u-old', now });
  assert.throws(() => store.createUser({ id: 'u-x', username: 'pm1', fullName: 'PM', role: 'project_manager', passwordHash: 'x', now }), /CHECK|constraint/i, 'the old schema cannot hold the new role');

  MIGRATIONS.length = 0; MIGRATIONS.push(...full);                // now apply the real migration
  store.migrate('2026-02-01T00:00:00Z');

  assert.equal(store.getUser('u-old').role, 'author', "'user' became 'author'");
  assert.equal(store.getUser('u-admin').role, 'admin');
  assert.equal(store.getMembership('p1', 'u-old').role, 'owner', 'memberships survive');
  assert.equal(store.listInvitationsForUser('u-admin').length, 1, 'pending invitations survive');
  store.createUser({ id: 'u-pm', username: 'pm1', fullName: 'PM One', role: 'project_manager', passwordHash: 'x', now });
  store.upsertMember('p1', 'u-pm', 'manager', 'u-old', now);
  assert.equal(store.getMembership('p1', 'u-pm').role, 'manager', 'the new project role is accepted');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  store.migrate('2026-03-01T00:00:00Z');                           // idempotent
});

let h; let admin; let pm; let alice; let bob; let carol;
const ids = {};

async function person(creator, role, username, fullName) {
  const made = await creator.post('/api/team/users', { username, fullName, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username);
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  c.id = made.json.user.id;
  return c;
}

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
});
test.after(async () => { await h.close(); });

test('who can create which accounts', async () => {
  pm = await person(admin, 'project_manager', 'meera', 'Meera Rao');
  alice = await person(pm, 'author', 'alice', 'Alice Author');        // a Project Manager creates Authors
  carol = await person(admin, 'author', 'carol', 'Carol Author');
  bob = await person(admin, 'author', 'bobby', 'Bob Author');

  assert.equal((await pm.post('/api/team/users', { username: 'meera2', fullName: 'Another Manager', role: 'project_manager' })).status, 403, 'a manager cannot create managers');
  assert.equal((await pm.post('/api/team/users', { username: 'adm2', fullName: 'Another Admin', role: 'admin' })).status, 403, 'nobody but the setup creates administrators here');
  assert.equal((await alice.post('/api/team/users', { username: 'dave', fullName: 'Dave', role: 'author' })).status, 403, 'an author creates no accounts');
  assert.equal((await alice.get('/api/team/users')).status, 403);
  assert.equal((await alice.post('/api/admin/users', { username: 'dave', fullName: 'Dave' })).status, 403);

  const mine = (await pm.get('/api/team/users')).json.users.map((u) => u.username);
  assert.ok(mine.includes('alice') && !mine.includes('carol'), 'a manager sees the authors they created, not everyone');
  assert.equal((await admin.get('/api/team/users')).json.users.length, 5, 'the administrator sees everyone');
  assert.equal((await admin.get('/api/auth/me')).json.user.role, 'admin');
});

test('an author sees only their own projects', async () => {
  const mk = await alice.post('/api/projects', { name: 'Alice Pump' });
  assert.equal(mk.status, 201);
  ids.alice = mk.json.project.id;
  await alice.post(`/api/projects/${ids.alice}/dms`, { file: DM, xml: h.sample(DM) });

  assert.equal((await alice.get('/api/projects')).json.projects.length, 1);
  assert.equal((await carol.get('/api/projects')).json.projects.length, 0, "another author sees none of Alice's projects");
  assert.equal((await carol.get(`/api/projects/${ids.alice}/dms`)).status, 404, 'and cannot reach them directly (existence not disclosed)');
  assert.equal((await pm.get(`/api/projects/${ids.alice}/dms`)).status, 404, "a manager is not on Alice's project, so does not see it");
  assert.equal((await admin.get(`/api/projects/${ids.alice}/dms`)).status, 200, 'the administrator oversees everything');
  assert.equal((await carol.get('/api/overview')).json.counts.projects, 0);
});

test('an author shares their project: view, edit, and adding a Project Manager', async () => {
  // view access
  assert.equal((await alice.post(`/api/projects/${ids.alice}/assign`, { username: 'carol', role: 'viewer' })).status, 200);
  assert.equal((await carol.get(`/api/projects/${ids.alice}/dms`)).status, 200);
  const got = await carol.get(`/api/projects/${ids.alice}/dms/${DM}`);
  assert.equal((await carol.put(`/api/projects/${ids.alice}/dms/${DM}`, { xml: got.json.xml, baseHash: got.json.hash })).status, 403, 'a viewer cannot write');
  // edit access
  assert.equal((await alice.post(`/api/projects/${ids.alice}/assign`, { username: 'carol', role: 'editor' })).status, 200);
  assert.equal((await carol.put(`/api/projects/${ids.alice}/dms/${DM}`, { xml: got.json.xml.replace('Hydraulic pump', 'Hydraulic pump (carol)'), baseHash: got.json.hash })).status, 200);
  // the grantee cannot pass access on
  assert.equal((await carol.post(`/api/projects/${ids.alice}/assign`, { username: 'bobby', role: 'viewer' })).status, 403);

  // an author is never given the manager role; a Project Manager account is
  const bad = await alice.post(`/api/projects/${ids.alice}/assign`, { username: 'bobby', role: 'manager' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Project Manager account/);
  assert.equal((await alice.post(`/api/projects/${ids.alice}/assign`, { username: 'meera', role: 'manager' })).status, 200);
  assert.equal((await pm.get(`/api/projects/${ids.alice}/dms`)).status, 200, 'the manager now sees the project');
});

test('a Project Manager creates a project and assigns authors, within limits', async () => {
  const mk = await pm.post('/api/projects', { name: 'Meera Manual' });
  ids.pm = mk.json.project.id;
  assert.equal(mk.json.project.role, 'owner');
  assert.equal((await pm.post(`/api/projects/${ids.pm}/assign`, { username: 'bobby', role: 'editor' })).status, 200);
  assert.equal((await bob.get(`/api/projects/${ids.pm}/dms`)).status, 200);
  assert.equal((await carol.get(`/api/projects/${ids.pm}/dms`)).status, 404, 'unassigned authors see nothing');

  // as MANAGER (not owner) on Alice's project a manager can assign up to editor, but cannot touch owners or managers
  assert.equal((await pm.post(`/api/projects/${ids.alice}/assign`, { username: 'bobby', role: 'viewer' })).status, 200);
  const aliceUser = (await admin.get('/api/team/users')).json.users.find((u) => u.username === 'alice');
  assert.equal((await pm.patch(`/api/projects/${ids.alice}/members/${aliceUser.id}`, { role: 'viewer' })).status, 403, 'cannot demote the owner');
  assert.equal((await pm.del(`/api/projects/${ids.alice}/members/${aliceUser.id}`)).status, 403, 'cannot remove the owner');
  assert.equal((await pm.post(`/api/projects/${ids.alice}/assign`, { username: 'bobby', role: 'owner' })).status, 403, 'cannot make owners');
  assert.equal((await pm.post(`/api/projects/${ids.alice}/assign`, { username: 'bobby', role: 'manager' })).status, 400);
});

test('releases: an author requests, only the Project Manager of that project (or an administrator) approves', async () => {
  const when = new Date(Date.now() + 1000).toISOString();
  assert.equal((await alice.post(`/api/projects/${ids.alice}/release`, { scheduledAt: when, note: 'ready' })).status, 200);
  const view = (await alice.get(`/api/projects/${ids.alice}/release`)).json;
  assert.equal(view.canApprove, false, 'the author is told they cannot approve');
  const relId = view.pending.id;

  assert.equal((await alice.post(`/api/projects/${ids.alice}/release/${relId}/approve`)).status, 403, 'an author never approves, even as owner');
  assert.equal((await carol.post(`/api/projects/${ids.alice}/release/${relId}/approve`)).status, 403);
  assert.equal((await bob.post(`/api/projects/${ids.alice}/release/${relId}/approve`)).status, 403, 'a viewer/editor author cannot approve either');

  const queue = (await pm.get('/api/approvals')).json.approvals;
  assert.equal(queue.length, 1, "the manager's queue holds the request");
  assert.equal(queue[0].projectName, 'Alice Pump');
  assert.equal((await alice.get('/api/approvals')).status, 403);
  assert.equal((await pm.get(`/api/projects/${ids.alice}/release`)).json.canApprove, true);
  assert.equal((await pm.post(`/api/projects/${ids.alice}/release/${relId}/approve`)).status, 200);
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await alice.get(`/api/projects/${ids.alice}/release`)).json.release.number, 1);
});

test('activity: an administrator sees everything, a manager only the projects they manage, an author nothing', async () => {
  const all = (await admin.get('/api/activity')).json;
  assert.equal(all.totals.projects, 2);
  const a = all.projects.find((p) => p.name === 'Alice Pump');
  assert.ok(a.edits >= 2, 'saves and creations are counted');
  assert.deepEqual(a.members.map((m) => m.username).sort(), ['alice', 'bobby', 'carol', 'meera']);
  assert.ok(all.feed.some((f) => f.action === 'release.approved'));
  assert.ok(all.people.find((p) => p.username === 'carol').edits >= 1, 'edits are attributed to the person who made them');

  const mine = (await pm.get('/api/activity')).json;
  assert.deepEqual(mine.projects.map((p) => p.name).sort(), ['Alice Pump', 'Meera Manual'], 'managed projects only');
  assert.equal((await alice.get('/api/activity')).status, 403);
  assert.equal((await carol.get('/api/activity')).status, 403);

  // a manager sees nothing of a project they are not on
  const dave = await pm.post('/api/projects', { name: 'Private Of Meera' });
  assert.ok(dave.json.project);
  const other = (await carol.post('/api/projects', { name: 'Carol Private' })).json.project.id;
  assert.equal((await pm.get('/api/activity')).json.projects.some((p) => p.id === other), false);
  assert.equal((await pm.get(`/api/projects/${other}/activity`)).status, 404);
  assert.equal((await carol.get(`/api/projects/${other}/activity`)).status, 200, 'the owner sees their own project');
  assert.equal((await bob.get(`/api/projects/${ids.alice}/activity`)).status, 403, 'a viewer/editor cannot read the team activity');
});
