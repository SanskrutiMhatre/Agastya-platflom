'use strict';
// WP-27 (ENT-005, DEP-015, RES-003): directory sign-on end to end, against the in-process LDAPS directory of helpers-ldap.js.
//
// The acceptance of ENT-005 / DEP-015, each a test below: a valid user in a mapped group signs in without a local password (provisioned
// just in time with the mapped role); a user removed from the group is refused at the next sign-in, and the sync job disables the account and
// ends its sessions; the directory down -> the local break-glass administrator still works; a wrong certificate -> the connection is refused;
// audit events for the first sign-in and the removal. Plus: no empty-password bind is ever sent, filters are typed (no injection), a local
// account never consults the directory, nested groups, group -> local group feeding a project grant, the sync refuses to disable everyone.
// A test against a real Active Directory is external (it needs a domain controller; docs/OPERATIONS.md section 6 lists the steps).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { FakeDirectory, makeCa } = require('./helpers-ldap');

const PW = 'Correct-Horse-9!';
const BASE = 'OU=Staff,DC=corp,DC=local';
const GROUPS = 'OU=Groups,DC=corp,DC=local';
const G = (cn) => `CN=${cn},${GROUPS}`;
const U = (cn) => `CN=${cn},${BASE}`;

const dir = new FakeDirectory();
let h; let admin; let secretDir;

function person(sam, display, password = 'Dir-Passw0rd!x', extra = {}) {
  dir.put(U(display), { objectClass: ['top', 'person', 'user'], sAMAccountName: sam, displayName: display, cn: display, objectGUID: Buffer.from(sam.padEnd(16, '#').slice(0, 16)), userAccountControl: '512', ...extra }, password);
}

test.before(async () => {
  await dir.start();
  secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-wp27-'));
  fs.writeFileSync(path.join(secretDir, 'bind.txt'), 'Svc-Secret-1\n');
  fs.writeFileSync(path.join(secretDir, 'ca.pem'), dir.caPem);
  dir.put('CN=svc-agastya,OU=Service,DC=corp,DC=local', { objectClass: 'user', sAMAccountName: 'svc-agastya' }, 'Svc-Secret-1');
  for (const g of ['Agastya Authors', 'Agastya Managers', 'Agastya Admins', 'Agastya Auditors', 'Pump Team', 'Engineering', 'Unmapped']) dir.put(G(g), { objectClass: 'group', cn: g });
  person('alice', 'Alice Author'); person('paul', 'Paul Manager'); person('nina', 'Nina Nested'); person('oscar', 'Oscar Outsider');
  person('dora', 'Dora Disabled', 'Dir-Passw0rd!x', { userAccountControl: '514' }); person('admin', 'Directory Admin Twin');
  person('ivy', 'Ivy Auditor');
  dir.setMembers(G('Agastya Authors'), [U('Alice Author'), U('Dora Disabled'), U('Directory Admin Twin')]);
  dir.setMembers(G('Agastya Managers'), [U('Paul Manager')]);
  dir.setMembers(G('Agastya Auditors'), [U('Ivy Auditor')]);
  dir.setMembers(G('Pump Team'), [U('Alice Author')]);
  dir.setMembers(G('Engineering'), [U('Nina Nested')]);             // Engineering is itself a member of Agastya Authors (nested)
  dir.addMember(G('Agastya Authors'), G('Engineering'));
  dir.setMembers(G('Unmapped'), [U('Oscar Outsider')]);
  Object.assign(process.env, {
    AGASTYA_MODE: 'server', AGASTYA_HOST: '127.0.0.1',
    AGASTYA_DIRECTORY_URL: dir.url, AGASTYA_DIRECTORY_BASE_DN: BASE, AGASTYA_DIRECTORY_GROUP_BASE_DN: GROUPS,
    AGASTYA_DIRECTORY_BIND_DN: 'CN=svc-agastya,OU=Service,DC=corp,DC=local', AGASTYA_DIRECTORY_BIND_PASSWORD_FILE: path.join(secretDir, 'bind.txt'),
    AGASTYA_DIRECTORY_CA_FILE: path.join(secretDir, 'ca.pem'), AGASTYA_DIRECTORY_NESTED_GROUPS: '1', AGASTYA_DIRECTORY_TIMEOUT_MS: '3000',
  });
  h = await require('./helpers').boot();
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Local Admin' })).status, 200);
});
test.after(async () => { if (h) await h.close(); await dir.stop(); });

const login = async (name, password = 'Dir-Passw0rd!x') => { const c = new h.Client(name); const r = await c.post('/api/auth/login', { username: name, password }); c.res = r; return c; };
const audits = async (prefix) => (await admin.get(`/api/admin/audit?action=${encodeURIComponent(prefix)}&limit=500`)).json.entries;

test('configuration: Mode A refuses a directory, only ldaps:// is accepted, the companions are required', () => {
  const { buildConfig, ConfigError } = require('../dist/config');
  const base = { AGASTYA_MODE: 'server', AGASTYA_HOST: '127.0.0.1', AGASTYA_DIRECTORY_URL: 'ldaps://dc1.corp.local', AGASTYA_DIRECTORY_BASE_DN: BASE, AGASTYA_DIRECTORY_BIND_DN: 'CN=svc', AGASTYA_DIRECTORY_BIND_PASSWORD_FILE: 'x' };
  assert.equal(buildConfig({}).directory, null, 'no directory = local accounts only (Mode A, unchanged)');
  assert.throws(() => buildConfig({ ...base, AGASTYA_MODE: 'local' }), (e) => e instanceof ConfigError && e.variable === 'AGASTYA_DIRECTORY_URL' && /Mode B/.test(e.message));
  assert.throws(() => buildConfig({ ...base, AGASTYA_DIRECTORY_URL: 'ldap://dc1.corp.local' }), /AGASTYA_DIRECTORY_URL: .*not an LDAPS address/);
  assert.throws(() => buildConfig({ ...base, AGASTYA_DIRECTORY_BASE_DN: '' }), /AGASTYA_DIRECTORY_BASE_DN/);
  assert.throws(() => buildConfig({ ...base, AGASTYA_DIRECTORY_BIND_DN: '' }), /AGASTYA_DIRECTORY_BIND_DN/);
  assert.throws(() => buildConfig({ ...base, AGASTYA_DIRECTORY_BIND_PASSWORD_FILE: '' }), /AGASTYA_DIRECTORY_BIND_PASSWORD_FILE/);
  assert.throws(() => buildConfig({ ...base, AGASTYA_DIRECTORY_LOGIN_ATTRIBUTE: 'sam)(x' }), /AGASTYA_DIRECTORY_LOGIN_ATTRIBUTE/);
  const c = buildConfig({ ...base, AGASTYA_DIRECTORY_URL: 'ldaps://dc1.corp.local, ldaps://dc2.corp.local:3269' });
  assert.deepEqual(c.directory.urls, ['ldaps://dc1.corp.local', 'ldaps://dc2.corp.local:3269']);
  assert.equal(c.directory.loginAttribute, 'sAMAccountName'); assert.equal(c.directory.syncHours, 24); assert.equal(c.directory.nestedGroups, false);
});

test('administration: the mapping is central (directory group -> role / local group), status and connection test', async () => {
  const st = (await admin.get('/api/admin/directory')).json;
  assert.equal(st.configured, true); assert.equal(st.settings.bindPasswordFileReadable, true); assert.equal(st.settings.nestedGroups, true);
  assert.ok(!JSON.stringify(st).includes('Svc-Secret-1'), 'the service password is never shown');
  const pump = (await admin.post('/api/admin/groups', { name: 'Pump team', description: 'from the directory' })).json.group;
  for (const [dn, globalRole, groupId] of [[G('Agastya Authors'), 'author'], [G('Agastya Managers'), 'project_manager'], [G('Agastya Admins'), 'admin'], [G('Agastya Auditors'), 'auditor'], [G('Pump Team'), null, pump.id]]) {
    const r = await admin.post('/api/admin/directory/mappings', { groupDn: dn, globalRole, groupId });
    assert.equal(r.status, 201, JSON.stringify(r.json));
  }
  assert.equal((await admin.post('/api/admin/directory/mappings', { groupDn: G('agastya authors'), globalRole: 'author' })).status, 409, 'a group is mapped once');
  assert.equal((await admin.post('/api/admin/directory/mappings', { groupDn: G('X'), globalRole: 'root' })).status, 400);
  assert.equal((await admin.post('/api/admin/directory/mappings', { groupDn: G('X') })).status, 400, 'a mapping gives something');
  const tmp = (await admin.post('/api/admin/directory/mappings', { groupDn: G('Temp'), globalRole: 'author' })).json.mapping;
  assert.equal((await admin.del(`/api/admin/directory/mappings/${tmp.id}`)).status, 200);
  const t = await admin.post('/api/admin/directory/test', { username: 'alice' });
  assert.equal(t.status, 200, JSON.stringify(t.json)); assert.equal(t.json.ok, true); assert.equal(t.json.found.dn, U('Alice Author'));
  assert.ok(t.json.found.groups.map((g) => g.toLowerCase()).includes(G('Pump Team').toLowerCase()));
  const author = await login('nobodyhere', 'x');
  assert.equal(author.res.status, 401);
});

test('a directory user in a mapped group signs in with the directory password and is provisioned just in time', async () => {
  const a = await login('alice');
  assert.equal(a.res.status, 200, JSON.stringify(a.res.json));
  const me = (await a.get('/api/auth/me')).json.user;
  assert.equal(me.role, 'author'); assert.equal(me.authSource, 'directory'); assert.equal(me.fullName, 'Alice Author');
  assert.equal(me.onboardingPending, false); assert.equal(me.mustChangePassword, false, 'no local password, no onboarding');
  const prov = await audits('directory.user.provisioned');
  assert.ok(prov.some((e) => e.meta.username === 'alice' && e.meta.role === 'author'), 'first sign-in is audited');
  assert.ok((await audits('auth.login')).some((e) => e.actor === 'alice' && e.meta && e.meta.source === 'directory'));
  // the mapped local group is fed by the directory
  const groups = (await admin.get('/api/admin/groups')).json.groups;
  const pump = groups.find((g) => g.name === 'Pump team');
  const members = (await admin.get(`/api/admin/groups/${pump.id}/members`)).json.members;
  assert.deepEqual(members.map((m) => [m.username, m.source]), [['alice', 'directory']]);
  // the platform never learns the password: change-password and an administrator reset are refused for a directory account
  assert.equal((await a.post('/api/auth/change-password', { currentPassword: 'Dir-Passw0rd!x', newPassword: 'Another-Passw0rd!' })).json.code, 'DIRECTORY_ACCOUNT');
  const row = (await admin.get('/api/admin/users')).json.users.find((u) => u.username === 'alice');
  assert.equal((await admin.post(`/api/admin/users/${row.id}/reset`, {})).json.code, 'DIRECTORY_ACCOUNT');
  // a second sign-in finds the same account (by its directory id)
  assert.equal((await login('ALICE')).res.status, 200);
  assert.equal((await admin.get('/api/admin/users')).json.users.filter((u) => u.username === 'alice').length, 1);
});

test('wrong password, empty password and an unmapped user are refused with the same answer; no empty bind ever reaches the directory', async () => {
  const before = dir.ops.length;
  for (const [u, p] of [['alice', 'wrong-one'], ['alice', ''], ['oscar', 'Dir-Passw0rd!x'], ['ghost', 'Dir-Passw0rd!x']]) {
    const c = await login(u, p);
    assert.equal(c.res.status, 401, `${u}`); assert.equal(c.res.json.code, 'BAD_CREDENTIALS');
  }
  assert.ok(!dir.ops.slice(before).some((o) => o.op === 'bind' && o.emptyPassword), 'an empty password is never sent');
  assert.equal((await admin.get('/api/admin/users')).json.users.some((u) => u.username === 'oscar'), false, 'not in a mapped group: no account');
  assert.ok((await audits('auth.login.failed')).some((e) => e.meta && e.meta.reason === 'not-authorised'));
});

test('filters are typed: a user name full of LDAP syntax is a literal value', async () => {
  const before = dir.ops.length;
  const c = await login('*)(objectClass=*', 'Dir-Passw0rd!x');
  assert.equal(c.res.status, 401);
  const s = dir.ops.slice(before).find((o) => o.op === 'search');
  assert.deepEqual(s.filter, { and: [{ eq: ['objectClass', 'user'] }, { eq: ['sAMAccountName', '*)(objectClass=*'] }] });
});

test('nested groups (LDAP_MATCHING_RULE_IN_CHAIN), a Project Manager group, and the auditor mapping', async () => {
  const n = await login('nina');
  assert.equal(n.res.status, 200, 'Engineering is inside Agastya Authors');
  assert.equal((await n.get('/api/auth/me')).json.user.role, 'author');
  assert.ok(dir.ops.some((o) => o.op === 'search' && o.filter.ext && o.filter.ext.rule === '1.2.840.113556.1.4.1941'));
  const p = await login('paul');
  assert.equal((await p.get('/api/auth/me')).json.user.role, 'project_manager');
  const i = await login('ivy');
  const me = (await i.get('/api/auth/me')).json.user;
  assert.equal(me.auditor, true); assert.equal(me.role, 'author');
  assert.equal((await i.get('/api/admin/audit')).status, 200, 'the auditor reads the audit log');
  assert.equal((await i.post('/api/projects', { name: 'Nope' })).json.code, 'READ_ONLY_ACCOUNT');
});

test('a local account with the same name never consults the directory (no takeover; break-glass)', async () => {
  const before = dir.ops.length;
  // "admin" exists in the directory too (Directory Admin Twin, an author there); the local administrator keeps signing in locally
  const a = await login('admin', PW);
  assert.equal(a.res.status, 200);
  assert.equal((await a.get('/api/auth/me')).json.user.authSource, 'local');
  admin = a;                                   // one session per person: this sign-in replaced the earlier one
  assert.equal(dir.ops.length, before, 'the directory was not asked');
  assert.equal((await login('admin', 'Dir-Passw0rd!x')).res.status, 401, 'the directory password of the twin does not open the local account');
});

test('a disabled directory account is refused, and its existing account here is offboarded', async () => {
  // Dora was never provisioned (disabled before her first sign-in): refused, nothing created
  assert.equal((await login('dora')).res.status, 401);
  assert.equal((await admin.get('/api/admin/users')).json.users.some((u) => u.username === 'dora'), false);
  // Nina is provisioned; her directory account is disabled -> next sign-in refused and the account here disabled
  const nina = dir.get(U('Nina Nested')); nina.attrs.userAccountControl = [Buffer.from('514')];
  assert.equal((await login('nina')).res.status, 401);
  const row = (await admin.get('/api/admin/users')).json.users.find((u) => u.username === 'nina');
  assert.equal(row.disabled, true); assert.equal(row.disabledReason, 'directory');
  nina.attrs.userAccountControl = [Buffer.from('512')];
  assert.equal((await login('nina')).res.status, 200, 'enabled again in the directory -> reinstated at the next sign-in');
  assert.ok((await audits('directory.user.reinstated')).some((e) => e.meta.username === 'nina'));
});

test('offboarding: removed from the mapped group -> the sync disables the account and ends its session at once; refused at sign-in', async () => {
  const p = await login('paul');
  assert.equal((await p.get('/api/auth/me')).status, 200);
  dir.removeMember(G('Agastya Managers'), U('Paul Manager'));
  const sync = await admin.post('/api/admin/directory/sync', {});
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
  assert.equal(sync.json.offboarded, 1); assert.ok(sync.json.checked >= 4);
  const after = await p.get('/api/auth/me');
  assert.equal(after.status, 401, 'the live session ended'); assert.equal(after.json.code, 'ACCOUNT_DISABLED');
  assert.equal((await login('paul')).res.status, 401);
  const off = await audits('directory.user.offboarded');
  assert.ok(off.some((e) => e.meta.username === 'paul' && /mapped directory group/.test(e.meta.reason)));
  assert.equal((await admin.get('/api/admin/directory')).json.lastSync.offboarded, 1);
  // an administrator's own disable is not undone by the directory
  dir.addMember(G('Agastya Managers'), U('Paul Manager'));
  assert.equal((await login('paul')).res.status, 200, 'back in the group -> reinstated');
  const paul = (await admin.get('/api/admin/users')).json.users.find((u) => u.username === 'paul');
  assert.equal((await admin.post(`/api/admin/users/${paul.id}/disable`, {})).status, 200);
  assert.equal((await login('paul')).res.status, 401, 'disabled here by an administrator: the directory does not override it');
  assert.equal((await admin.post(`/api/admin/users/${paul.id}/enable`, {})).status, 200);
});

test('a role change in the directory follows at the next sign-in; group membership feeds a project grant', async () => {
  dir.addMember(G('Agastya Managers'), U('Alice Author'));
  const a = await login('alice');
  assert.equal((await a.get('/api/auth/me')).json.user.role, 'project_manager');
  assert.ok((await audits('directory.user.role-changed')).some((e) => e.meta.username === 'alice' && e.meta.to === 'project_manager'));
  dir.removeMember(G('Agastya Managers'), U('Alice Author'));
  // a project the Pump team (fed by the directory group) is granted
  const made = await admin.post('/api/team/users', { username: 'owen', fullName: 'Owen Owner', role: 'author' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const owen = await login('owen', made.json.tempPassword);
  assert.equal((await owen.post('/api/auth/onboarding', { username: 'owen', password: PW })).status, 200);
  const mk = await owen.post('/api/projects', { name: 'Pump Manual' });
  assert.equal(mk.status, 201, JSON.stringify(mk.json));
  const pid = mk.json.project.id;
  const pump = (await admin.get('/api/admin/groups')).json.groups.find((g) => g.name === 'Pump team');
  assert.equal((await a.get(`/api/projects/${pid}`)).status, 404, 'not yet');
  assert.equal((await owen.put(`/api/projects/${pid}/access/groups/${pump.id}`, { role: 'viewer' })).status, 200, 'the owner grants the group');
  assert.equal((await a.get(`/api/projects/${pid}`)).status, 200, 'the group grant applies without signing in again');
  dir.removeMember(G('Pump Team'), U('Alice Author'));
  assert.equal((await admin.post('/api/admin/directory/sync', {})).status, 200);
  assert.equal((await a.get(`/api/projects/${pid}`)).status, 404, 'left the directory group -> the sync removed the access');
});

test('the sync refuses to disable every directory account at once (a wrong base DN is a configuration error, not a mass departure)', async () => {
  const saved = [...dir.entries];
  for (const [k, e] of saved) if (/ou=staff/.test(k) && !/svc/.test(k)) dir.entries.delete(k);
  try {
    const r = await admin.post('/api/admin/directory/sync', {});
    assert.equal(r.status, 200); assert.match(r.json.failed, /would disable all/); assert.equal(r.json.offboarded, 0);
    assert.ok((await admin.get('/api/admin/users')).json.users.filter((u) => u.authSource === 'directory').every((u) => !u.disabled || u.username === 'paul'));
  } finally { for (const [k, e] of saved) dir.entries.set(k, e); }
});

test('directory down: directory users get 503 DIRECTORY_UNAVAILABLE, the local break-glass administrator still signs in, the sync changes nothing', async () => {
  await dir.stop();
  try {
    const a = await login('alice');
    assert.equal(a.res.status, 503); assert.equal(a.res.json.code, 'DIRECTORY_UNAVAILABLE');
    const b = await login('admin', PW);
    assert.equal(b.res.status, 200, 'break-glass');
    admin = b;
    const s = await admin.post('/api/admin/directory/sync', {});
    assert.ok(s.json.failed, 'reported'); assert.equal(s.json.offboarded, 0);
    assert.equal((await admin.post('/api/admin/directory/test', {})).status, 502);
    assert.ok((await audits('directory.sync.failed')).length >= 1);
  } finally { await dir.start(); }
  assert.equal((await login('alice')).res.status, 200, 'back up');
});

test('a wrong certificate (a CA the directory is not signed by) is refused before any credential is sent', async () => {
  const { createDirectory, DirectoryUnavailable } = require('../dist/core/auth/directory');
  const other = makeCa('Some Other CA');
  const cfg = { urls: [dir.url], bindDn: 'CN=svc-agastya,OU=Service,DC=corp,DC=local', bindPasswordFile: path.join(secretDir, 'bind.txt'), baseDn: BASE, groupBaseDn: GROUPS, loginAttribute: 'sAMAccountName', userObjectClass: 'user', nestedGroups: false, caFile: path.join(secretDir, 'other-ca.pem'), timeoutMs: 3000, syncHours: 0 };
  fs.writeFileSync(cfg.caFile, other.ca.certPem);
  const before = dir.ops.length;
  await assert.rejects(createDirectory(cfg).test(), (e) => e instanceof DirectoryUnavailable && /certificate|self.signed|unable to verify/i.test(e.message));
  assert.equal(dir.ops.length, before, 'no bind reached the server');
  // the right CA, memberOf (not nested): the direct groups
  fs.writeFileSync(cfg.caFile, dir.caPem);
  const ok = await createDirectory(cfg).test('alice');
  assert.equal(ok.ok, true);
  assert.ok(ok.found.groups.some((g) => /Agastya Authors/.test(g)));
  // a second server address is the fallback when the first does not answer
  const two = await createDirectory({ ...cfg, urls: ['ldaps://127.0.0.1:1', dir.url] }).test();
  assert.equal(two.url, dir.url);
});

test('mapGroups: highest role wins, auditor only alone, DNs compare without case and spacing', () => {
  const { mapGroups } = require('../dist/core/auth/directory');
  const m = [{ group_dn: 'CN=A,DC=x', global_role: 'author', group_id: 'g1' }, { group_dn: 'CN=P,DC=x', global_role: 'project_manager', group_id: null }, { group_dn: 'CN=Au,DC=x', global_role: 'auditor', group_id: null }];
  assert.deepEqual(mapGroups(['cn=a, dc=x', 'CN=P,DC=X'], m), { role: 'project_manager', auditor: false, groupIds: ['g1'] });
  assert.deepEqual(mapGroups(['CN=Au,DC=x'], m), { role: 'author', auditor: true, groupIds: [] });
  assert.deepEqual(mapGroups(['CN=Au,DC=x', 'CN=A,DC=x'], m).auditor, false);
  assert.equal(mapGroups(['CN=Other,DC=x'], m), null);
});

test('linking a local account to the directory keeps a local administrator', async () => {
  const users = (await admin.get('/api/admin/users')).json.users;
  const me = users.find((u) => u.username === 'admin');
  assert.equal((await admin.req('PATCH', `/api/admin/users/${me.id}`, { authSource: 'directory' })).json.code, 'BREAK_GLASS_REQUIRED');
  assert.equal((await admin.req('PATCH', `/api/admin/users/${me.id}`, { auditor: true })).status, 400, 'an administrator is never an auditor');
});
