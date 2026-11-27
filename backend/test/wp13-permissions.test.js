'use strict';
// WP-13 (FE-019, ARC-004): the server tells the client what the signed-in person may do on a project. The `can` map on every project card is
// derived from the route guards themselves, so it cannot drift from what the routes enforce.

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let alice; let carol;

async function person(creator, role, username, fullName) {
  const made = await creator.post('/api/team/users', { username, fullName, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username);
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  alice = await person(admin, 'author', 'alice', 'Alice Author');
  carol = await person(admin, 'author', 'carol', 'Carol Author');
});
test.after(async () => { await h.close(); });

test('the capability table is read from the route guards, one minimum role per capability', () => {
  const { capabilityTable } = require('../dist/services/permissions');
  const t = capabilityTable();
  // the rules the client used to repeat, now stated by the routes
  assert.equal(t['project.read'], 'viewer');
  assert.equal(t['dm.write'], 'editor');
  assert.equal(t['publish.build'], 'reviewer');
  assert.equal(t['validate.run'], 'reviewer');
  assert.equal(t['release.decide'], 'manager');
  assert.equal(t['project.delete'], 'owner');
  assert.equal(t['doc.lock'], 'owner');
  // every capability a project route declares is in the table (and nothing else)
  const { createApp } = require('../dist/app');
  const app = createApp();
  const declared = new Set();
  for (const l of app._router.stack) if (l.route) for (const s of l.route.stack) if (s.handle.cap) declared.add(s.handle.cap);
  assert.deepEqual(Object.keys(t).sort(), [...declared].sort());
});

test('canFor follows the role ladder; a project that is not active is readable by its owner only', () => {
  const { canFor } = require('../dist/services/permissions');
  const viewer = canFor('viewer'); const reviewer = canFor('reviewer'); const editor = canFor('editor'); const owner = canFor('owner');
  assert.deepEqual([viewer['project.read'], viewer['publish.build'], viewer['dm.write']], [true, false, false]);
  assert.deepEqual([reviewer['publish.build'], reviewer['validate.run'], reviewer['dm.write']], [true, true, false]);
  assert.deepEqual([editor['dm.write'], editor['release.decide'], editor['project.delete']], [true, false, false]);
  assert.ok(Object.values(owner).every(Boolean), 'an owner may do everything');
  const pending = canFor('owner', 'pending');
  assert.equal(pending['project.read'], true);
  assert.ok(Object.entries(pending).every(([k, v]) => v === (k === 'project.read')));
  assert.equal(canFor('editor', 'pending')['project.read'], false);
});

test('project cards and the summary carry the map for the caller, and it matches what the routes allow', async () => {
  const mk = await alice.post('/api/projects', { name: 'Perm Pump' });
  assert.equal(mk.status, 201);
  const id = mk.json.project.id;
  assert.equal(mk.json.project.can['project.delete'], true, 'the creator owns it');
  assert.equal((await alice.post(`/api/projects/${id}/assign`, { username: 'carol', role: 'viewer' })).status, 200);

  const asViewer = (await carol.get(`/api/projects/${id}/summary`)).json.project.can;
  assert.equal(asViewer['project.read'], true);
  assert.equal(asViewer['dm.write'], false);
  assert.equal(asViewer['publish.build'], false);
  // and the route agrees: a viewer's build is refused
  assert.equal((await carol.post(`/api/projects/${id}/publish`, {})).status, 403);

  assert.equal((await alice.post(`/api/projects/${id}/assign`, { username: 'carol', role: 'reviewer' })).status, 200);
  const listed = (await carol.get('/api/projects')).json.projects.find((p) => p.id === id);
  assert.equal(listed.can['publish.build'], true, 'a reviewer may build');
  assert.equal(listed.can['dm.write'], false, 'but not write');

  // an administrator is owner-equivalent on every project
  const asAdmin = (await admin.get(`/api/projects/${id}`)).json.project.can;
  assert.equal(asAdmin['project.delete'], true);
});
