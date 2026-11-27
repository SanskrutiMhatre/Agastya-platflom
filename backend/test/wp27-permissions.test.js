'use strict';
// WP-27 (PLT-016, ENT-023): groups, group grants, capability rules and the read-only auditor, in Mode A (local accounts, no directory:
// everything here works the same without one). PLT-016's acceptance: the seeded matrix reproduces every existing role test (rbac,
// routes-guarded, authz-matrix are unchanged apart from the new auditor column), a custom grant limited to one capability can do that
// and nothing else, deny precedence, and a group membership change takes effect without signing in again.

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let owner; let vera; let ed; let max; let aud; let pid;

async function person(username, role = 'author') {
  const made = await admin.post('/api/team/users', { username, fullName: `${username} tester`, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username); c.id = made.json.user.id;
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}
// past the guard = anything but the guard's 401/403/404 (the handler may still answer 400 to an empty body)
const passed = (r) => !(r.status === 401 || (r.status === 404 && JSON.stringify(r.json) === '{"error":"Not found"}') || (r.status === 403 && ['INSUFFICIENT_ROLE', 'CAPABILITY_DENIED', 'READ_ONLY_ACCOUNT'].includes(r.json && r.json.code)));
const okPast = (r, msg = '') => assert.ok(passed(r), `${msg} ${r.status} ${JSON.stringify(r.json)}`);
const writeDm = (c) => c.put(`/api/projects/${pid}/identity`, {});                         // dm.write, editor
const comment = (c) => c.post(`/api/projects/${pid}/review/comments`, {});                // review.comment, reviewer

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  owner = await person('olga'); vera = await person('vera'); ed = await person('eddie'); max = await person('maxine', 'project_manager'); aud = await person('audrey');
  const mk = await owner.post('/api/projects', { name: 'Access Pump' });
  assert.equal(mk.status, 201); pid = mk.json.project.id;
  assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: 'vera', role: 'viewer' })).status, 200);
  assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: 'eddie', role: 'editor' })).status, 200);
  assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: 'maxine', role: 'manager' })).status, 200);
});
test.after(async () => { if (h) await h.close(); });

test('Mode A is unchanged: the local provider, no directory, the directory routes say so', async () => {
  const { defaultContext } = require('../dist/context');
  assert.equal(defaultContext().authProvider.kind, 'local');
  assert.equal(defaultContext().config.directory, null);
  assert.equal((await admin.get('/api/admin/directory')).json.configured, false);
  assert.equal((await admin.post('/api/admin/directory/sync', {})).status, 409);
  assert.equal((await admin.post('/api/admin/directory/test', {})).status, 409);
});

test('groups: central administration, and a group grant takes effect (and ends) without signing in again', async () => {
  const g = await admin.post('/api/admin/groups', { name: 'Reviewers', description: 'quality' });
  assert.equal(g.status, 201); const gid = g.json.group.id;
  assert.equal((await admin.post('/api/admin/groups', { name: 'reviewers' })).status, 409);
  assert.equal((await admin.post('/api/admin/groups', { name: '' })).status, 400);
  assert.equal((await admin.patch(`/api/admin/groups/${gid}`, { description: 'quality team' })).json.group.description, 'quality team');
  assert.equal((await owner.post('/api/admin/groups', { name: 'Mine' })).status, 403, 'administrators only');
  // a non-member
  const zoe = await person('zoe');
  assert.equal((await zoe.get(`/api/projects/${pid}`)).status, 404);
  assert.equal((await admin.post(`/api/admin/groups/${gid}/members`, { username: 'zoe' })).status, 201);
  assert.equal((await zoe.get(`/api/projects/${pid}`)).status, 404, 'a group alone gives nothing until it is granted');
  assert.equal((await owner.put(`/api/projects/${pid}/access/groups/${gid}`, { role: 'reviewer' })).status, 200);
  assert.equal((await zoe.get(`/api/projects/${pid}`)).status, 200);
  okPast(await comment(zoe), 'reviewer through the group');
  assert.equal(passed(await writeDm(zoe)), false, 'but not an editor');
  const card = (await zoe.get('/api/projects')).json.projects.find((p) => p.id === pid);
  assert.equal(card.accessVia, 'group'); assert.equal(card.role, 'reviewer'); assert.equal(card.can['review.comment'], true); assert.equal(card.can['dm.write'], false);
  // a group never lowers a stronger named role: eddie (editor) in the group keeps editing
  assert.equal((await admin.post(`/api/admin/groups/${gid}/members`, { username: 'eddie' })).status, 201);
  okPast(await writeDm(ed));
  assert.equal((await admin.del(`/api/admin/groups/${gid}/members/${zoe.id}`)).status, 200);
  assert.equal((await zoe.get(`/api/projects/${pid}`)).status, 404, 'removed from the group: gone at the next request');
  assert.equal((await admin.get(`/api/admin/groups/${gid}/members`)).json.members.map((m) => m.username).join(), 'eddie');
  assert.equal((await owner.del(`/api/projects/${pid}/access/groups/${gid}`)).status, 200);
  assert.equal((await admin.del(`/api/admin/groups/${gid}`)).status, 200);
  assert.equal((await admin.get('/api/admin/groups')).json.groups.length, 0);
  const acts = (await admin.get('/api/admin/audit?action=group.&limit=50')).json.entries.map((e) => e.action);
  for (const a of ['group.created', 'group.updated', 'group.member.added', 'group.member.removed', 'group.deleted']) assert.ok(acts.includes(a), a);
  assert.ok((await admin.get('/api/admin/audit?action=project.access.&limit=50')).json.entries.some((e) => e.action === 'project.access.group-granted' && e.projectId === pid));
});

test('a custom grant limited to one capability: a viewer allowed review.comment can comment and do nothing else above viewer', async () => {
  const r = await owner.post(`/api/projects/${pid}/access/rules`, { subjectType: 'user', subject: 'vera', capability: 'review.comment', effect: 'allow' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  okPast(await comment(vera), 'the allowed capability');
  assert.equal(passed(await writeDm(vera)), false, 'nothing else');
  assert.equal((await vera.post(`/api/projects/${pid}/publish`, {})).status, 403, 'not even another reviewer capability');
  const can = (await vera.get(`/api/projects/${pid}`)).json.project.can;
  assert.equal(can['review.comment'], true); assert.equal(can['publish.build'], false); assert.equal(can['dm.write'], false);
  assert.equal((await owner.del(`/api/projects/${pid}/access/rules/${r.json.rule.id}`)).status, 200);
  assert.equal(passed(await comment(vera)), false, 'rule removed: back to the ladder');
});

test('deny precedence: a deny beats the role and any allow; owners and administrators are not subject to rules', async () => {
  const g = (await admin.post('/api/admin/groups', { name: 'Editors' })).json.group;
  await admin.post(`/api/admin/groups/${g.id}/members`, { username: 'eddie' });
  await owner.post(`/api/projects/${pid}/access/rules`, { subjectType: 'group', subject: g.id, capability: 'dm.write', effect: 'allow' });
  const deny = await owner.post(`/api/projects/${pid}/access/rules`, { subjectType: 'user', subject: 'eddie', capability: 'dm.write', effect: 'deny' });
  assert.equal(deny.status, 201);
  const r = await writeDm(ed);
  assert.equal(r.status, 403); assert.equal(r.json.code, 'CAPABILITY_DENIED');
  assert.equal((await ed.get(`/api/projects/${pid}`)).json.project.can['dm.write'], false, 'the can map agrees');
  okPast(await comment(ed), 'other capabilities are untouched');
  // deny on the owner and on the administrator has no effect
  await admin.post(`/api/projects/${pid}/access/rules`, { subjectType: 'user', subject: 'olga', capability: 'dm.write', effect: 'deny' });
  await admin.post(`/api/projects/${pid}/access/rules`, { subjectType: 'user', subject: 'admin', capability: 'dm.write', effect: 'deny' });
  okPast(await writeDm(owner)); okPast(await writeDm(admin));
  // the rule list names its subjects
  const list = (await owner.get(`/api/projects/${pid}/access`)).json;
  assert.ok(list.rules.some((x) => x.subject === 'eddie' && x.effect === 'deny'));
  assert.ok(list.rules.some((x) => x.subject === 'Editors' && x.effect === 'allow'));
  assert.ok(list.capabilities.some((c) => c.capability === 'dm.write' && c.minRole === 'editor'));
  assert.ok(!list.capabilities.some((c) => c.capability === 'project.access'));
  // switching the deny to an allow (same subject and capability) replaces it
  await owner.post(`/api/projects/${pid}/access/rules`, { subjectType: 'user', subject: 'eddie', capability: 'dm.write', effect: 'allow' });
  okPast(await writeDm(ed));
  for (const x of (await owner.get(`/api/projects/${pid}/access`)).json.rules) assert.equal((await owner.del(`/api/projects/${pid}/access/rules/${x.id}`)).status, 200);
});

test('no escalation: a manager grants at most the manager role and allows only what the manager role holds; viewers cannot manage access', async () => {
  const g = (await admin.post('/api/admin/groups', { name: 'Escalators' })).json.group;
  assert.equal((await max.put(`/api/projects/${pid}/access/groups/${g.id}`, { role: 'owner' })).json.code, 'ROLE_ABOVE_YOURS');
  assert.equal((await max.put(`/api/projects/${pid}/access/groups/${g.id}`, { role: 'manager' })).status, 200);
  assert.equal((await max.post(`/api/projects/${pid}/access/rules`, { subjectType: 'user', subject: 'vera', capability: 'project.delete', effect: 'allow' })).json.code, 'ROLE_ABOVE_YOURS');
  assert.equal((await max.post(`/api/projects/${pid}/access/rules`, { subjectType: 'user', subject: 'vera', capability: 'no.such', effect: 'allow' })).status, 400);
  assert.equal((await max.post(`/api/projects/${pid}/access/rules`, { subjectType: 'user', subject: 'vera', capability: 'dm.write', effect: 'maybe' })).status, 400);
  assert.equal((await max.post(`/api/projects/${pid}/access/rules`, { subjectType: 'user', subject: 'nobody', capability: 'dm.write', effect: 'deny' })).status, 404);
  assert.equal((await owner.put(`/api/projects/${pid}/access/groups/${g.id}`, { role: 'owner' })).status, 200, 'an owner can');
  assert.equal((await max.del(`/api/projects/${pid}/access/groups/${g.id}`)).json.code, 'ROLE_ABOVE_YOURS', 'nor remove a grant above their own role');
  assert.equal((await owner.del(`/api/projects/${pid}/access/groups/${g.id}`)).status, 200);
  assert.equal((await ed.get(`/api/projects/${pid}/access`)).status, 403, 'an editor does not manage access');
  assert.equal((await vera.get(`/api/projects/${pid}/access`)).status, 403);
});

test('the read-only auditor: reads every project and the audit log, changes nothing, keeps its own gate exits', async () => {
  const u = (await admin.get('/api/admin/users')).json.users.find((x) => x.username === 'audrey');
  assert.equal((await admin.patch(`/api/admin/users/${u.id}`, { auditor: 'yes' })).status, 400);
  assert.equal((await admin.patch(`/api/admin/users/${u.id}`, { auditor: true })).json.user.auditor, true);
  const projects = (await aud.get('/api/projects')).json.projects;
  const card = projects.find((p) => p.id === pid);
  assert.ok(card, 'every active project, without being a member'); assert.equal(card.accessVia, 'auditor'); assert.equal(card.role, 'viewer');
  assert.equal(card.can['project.read'], true); assert.equal(card.can['review.comment'], false, 'a viewer-level write is not shown as allowed');
  assert.equal((await aud.get(`/api/projects/${pid}`)).status, 200);
  assert.equal((await aud.get('/api/admin/audit')).status, 200);
  assert.equal((await aud.get('/api/admin/maintenance/audit.csv')).status, 200);
  assert.equal((await aud.get('/api/admin/users')).status, 200, 'access review');
  assert.equal((await aud.get('/api/admin/groups')).status, 200);
  assert.equal((await aud.get('/api/admin/sessions')).status, 403, 'not the administrator');
  for (const r of [await aud.post('/api/projects', { name: 'X' }), await aud.post(`/api/projects/${pid}/review/comments`, {}), await aud.post(`/api/admin/groups`, { name: 'Y' })]) assert.equal(r.status, 403);
  assert.equal((await aud.post('/api/projects', { name: 'X' })).json.code, 'READ_ONLY_ACCOUNT');
  assert.equal((await aud.post('/api/auth/activity', {})).status, 200, 'the gate exits stay open');
  const roles = (await admin.get('/api/admin/roles')).json;
  assert.ok(roles.roles.some((r) => /Auditor/.test(r.name)));
  assert.ok(roles.capabilities.some((c) => c.capability === 'project.read' && c.readable === true));
  assert.ok(roles.capabilities.some((c) => c.capability === 'dm.write' && c.readable === false && c.minRole === 'editor'));
  // the flag is reversible and the account is back to an author
  await admin.patch(`/api/admin/users/${u.id}`, { auditor: false });
  assert.equal((await aud.get(`/api/projects/${pid}`)).status, 404);
  assert.equal((await aud.post('/api/auth/logout', {})).status, 200);
});

test('a deleted project takes its grants and rules with it', async () => {
  const { defaultContext } = require('../dist/context');
  const mk = await owner.post('/api/projects', { name: 'Short Lived' });
  const id = mk.json.project.id;
  const g = (await admin.post('/api/admin/groups', { name: 'Temp' })).json.group;
  await owner.put(`/api/projects/${id}/access/groups/${g.id}`, { role: 'viewer' });
  await owner.post(`/api/projects/${id}/access/rules`, { subjectType: 'user', subject: 'vera', capability: 'dm.write', effect: 'deny' });
  const del = await owner.del(`/api/projects/${id}?confirm=${encodeURIComponent(mk.json.project.name)}`);
  assert.ok([200, 202].includes(del.status), JSON.stringify(del.json));
  assert.deepEqual(defaultContext().repos.access.listProjectGroupGrants(id), []);
  assert.deepEqual(defaultContext().repos.access.listRules(id), []);
});
