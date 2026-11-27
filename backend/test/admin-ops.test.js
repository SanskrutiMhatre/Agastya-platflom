'use strict';
// WP-09 (QA-005, ARC-016): behaviour tests for the routes no test referenced before (audit report 11 section 5.1 and the matrix's own
// reference check). Project governance by the administrator (ownerless, adopt, reassign, make-ownerless, direct members, approvals and
// release queues), folders and folder-level access, invitations declined and withdrawn, document history and locks, and a handful of
// configuration routes. Each test asserts what the route does, and who it refuses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const NEW = { pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } };
const DM_DESC = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
let h; let admin; let rebuildAtStart;

async function person(name, role = 'author') {
  const m = await admin.post('/api/team/users', { username: name, fullName: `${name} tester`, role });
  assert.equal(m.status, 201, JSON.stringify(m.json));
  const c = new h.Client(name); c.id = m.json.user.id;
  assert.equal((await c.post('/api/auth/login', { username: name, password: m.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username: name, password: PW })).status, 200);
  return c;
}
const project = async (c, name, extra = {}) => { const r = await c.post('/api/projects', { name, ...NEW, ...extra }); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.project.id; };

test.before(async () => {
  h = await boot(); admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  // before any project exists the rebuild has nothing to queue, so it starts no background build in this file
  rebuildAtStart = await admin.post('/api/admin/maintenance/rebuild-pdfs', {});
});
test.after(async () => { if (h) await h.close(); });

test('maintenance: rebuild-pdfs answers at once with what it queued, administrators only', async () => {
  assert.equal(rebuildAtStart.status, 202); assert.equal(typeof rebuildAtStart.json.queued, 'number');
  const c = await person('maint');
  assert.equal((await c.post('/api/admin/maintenance/rebuild-pdfs', {})).status, 403);
  assert.ok((await admin.get('/api/admin/audit?action=maintenance.rebuild-pdfs')).json.entries.length >= 1, 'audited');
});

test('ownership governance: list, make ownerless (the owner loses access), adopt, reassign (previous owners become editors), direct members', async () => {
  const owner = await person('govowner'); const heir = await person('govheir'); const pm = await person('govpm', 'project_manager');
  const pid = await project(owner, 'Governed');
  const all = await admin.get('/api/admin/projects');
  assert.equal(all.status, 200);
  assert.deepEqual(all.json.projects.find((p) => p.id === pid).owners.map((o) => o.username), ['govowner']);
  assert.equal((await owner.get('/api/admin/projects')).status, 403);
  // make ownerless
  assert.equal((await admin.post(`/api/admin/projects/${pid}/make-ownerless`, {})).status, 200);
  assert.equal((await owner.get(`/api/projects/${pid}`)).status, 404, 'the former owner has lost access, not only the title');
  assert.ok((await admin.get('/api/admin/projects/ownerless')).json.projects.some((p) => p.id === pid));
  assert.equal((await admin.post(`/api/admin/projects/${pid}/make-ownerless`, {})).status, 409, 'already ownerless');
  // adopt
  assert.equal((await admin.post(`/api/admin/projects/${pid}/adopt`, {})).status, 200);
  assert.ok(!(await admin.get('/api/admin/projects/ownerless')).json.projects.some((p) => p.id === pid));
  assert.equal((await admin.post(`/api/admin/projects/${pid}/adopt`, {})).status, 409, 'already owned');
  // reassign: the administrator (current owner) is demoted to editor, the heir becomes owner
  const re = await admin.post(`/api/admin/projects/${pid}/reassign-owner`, { username: 'govheir' });
  assert.equal(re.status, 200); assert.equal(re.json.owner, 'govheir');
  assert.equal((await heir.get(`/api/projects/${pid}`)).status, 200);
  const members = (await heir.get(`/api/projects/${pid}/members`)).json.members;
  assert.equal(members.find((m) => m.username === 'govheir').role, 'owner');
  assert.equal((await admin.post(`/api/admin/projects/${pid}/reassign-owner`, { username: 'nobody-at-all' })).status, 400);
  // direct membership: a manager role only for a Project Manager account; the last owner is protected
  assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: 'govpm', role: 'manager' })).status, 200);
  assert.equal((await pm.get(`/api/projects/${pid}/members`)).json.yourRole, 'manager');
  assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: 'govheir', role: 'viewer' })).status, 409, 'the last owner');
  assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: 'govpm', role: 'emperor' })).status, 400);
  for (const p of [`/api/admin/projects/zz-none/adopt`, `/api/admin/projects/zz-none/make-ownerless`]) assert.equal((await admin.post(p, {})).status, 404, p);
  const trail = (await admin.get('/api/admin/audit?action=project.')).json.entries.filter((e) => e.projectId === pid).map((e) => e.action);
  for (const a of ['project.made_ownerless', 'project.adopted', 'project.owner_reassigned']) assert.ok(trail.includes(a), a);
});

test('approval and release queues: listed for administrators, unknown ids are 404, nobody else can read them', async () => {
  const c = await person('queuer');
  for (const p of ['/api/admin/approvals', '/api/admin/releases']) {
    const r = await admin.get(p); assert.equal(r.status, 200, p);
    assert.ok(Array.isArray(r.json.pending), p);
    assert.equal((await c.get(p)).status, 403, p);
  }
  for (const p of ['/api/admin/approvals/zz-none/approve', '/api/admin/approvals/zz-none/reject', '/api/admin/releases/zz-none/approve', '/api/admin/releases/zz-none/reject']) {
    assert.equal((await admin.post(p, {})).status, 404, p);
  }
  // an active project is not in the approval queue and cannot be "approved" again
  const pid = await project(c, 'Already active');
  assert.equal((await admin.post(`/api/admin/approvals/${pid}/approve`, {})).status, 404);
  assert.equal((await admin.post(`/api/admin/approvals/${pid}/reject`, {})).status, 404);
  assert.equal((await c.get(`/api/projects/${pid}`)).status, 200, 'still active');
});

test('oversight: administrators and Project Managers, not Authors', async () => {
  const a = await person('ovauthor'); const pm = await person('ovpm', 'project_manager');
  assert.equal((await a.get('/api/oversight')).status, 403);
  const r = await pm.get('/api/oversight'); assert.equal(r.status, 200); assert.equal(typeof r.json, 'object');
  assert.equal((await admin.get('/api/oversight')).status, 200);
});

test('folders: rename, access grants give folder-level access to the projects filed there, delete; only the folder owner or an administrator', async () => {
  const owner = await person('fowner'); const reader = await person('freader'); const stranger = await person('fstranger');
  const mk = await owner.post('/api/folders', { name: 'Shared Shelf' }); assert.equal(mk.status, 201);
  const pid = await project(owner, 'Filed book', { folder: 'Shared Shelf' });
  const ren = await owner.patch(`/api/folders/${mk.json.key}`, { name: 'Shared Shelf 2' });
  assert.equal(ren.status, 200, JSON.stringify(ren.json)); const key = ren.json.key;
  assert.equal((await stranger.patch(`/api/folders/${key}`, { name: 'Mine now' })).status, 404, 'a folder the person cannot see');
  assert.equal((await reader.get(`/api/projects/${pid}`)).status, 404, 'no access before the grant');
  const put = await owner.put(`/api/folders/${key}/access`, { grants: [{ userId: reader.id, role: 'viewer' }] });
  assert.equal(put.status, 200);
  const acc = await owner.get(`/api/folders/${key}/access`);
  assert.deepEqual(acc.json.grants.map((g) => [g.username, g.role]), [['freader', 'viewer']]);
  assert.equal((await reader.get(`/api/projects/${pid}`)).status, 200, 'the folder grant reaches the project filed in it');
  assert.equal((await reader.put(`/api/projects/${pid}/settings`, {})).status, 403, 'as a viewer only');
  assert.ok([403, 404].includes((await reader.get(`/api/folders/${key}/access`)).status), 'a viewer of the folder does not manage it');
  assert.ok([403, 404].includes((await reader.put(`/api/folders/${key}/access`, { grants: [] })).status));
  assert.equal((await owner.put(`/api/folders/${key}/access`, { grants: [] })).status, 200);
  assert.equal((await reader.get(`/api/projects/${pid}`)).status, 404, 'access ends with the grant');
  assert.equal((await owner.del(`/api/folders/${key}?withProjects=1`)).status, 403, 'only an administrator deletes a folder with its projects');
  const del = await owner.del(`/api/folders/${key}`); assert.equal(del.status, 200);
  assert.equal((await owner.get(`/api/projects/${pid}`)).status, 200, 'deleting a folder keeps its projects');
});

test('invitations: the invited person declines; a manager withdraws a pending invitation; neither grants anything', async () => {
  const owner = await person('invowner'); const guest = await person('invguest'); const other = await person('invother');
  const pid = await project(owner, 'Invites');
  const inv = await owner.post(`/api/projects/${pid}/invitations`, { username: 'invguest', role: 'editor' });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const mine = (await guest.get('/api/invitations')).json.invitations;
  const id = mine.find((i) => i.projectId === pid || i.project_id === pid || (i.project && i.project.id === pid)).id;
  assert.equal((await other.post(`/api/invitations/${id}/decline`, {})).status, 404, 'not addressed to them');
  assert.equal((await guest.post(`/api/invitations/${id}/decline`, {})).status, 200);
  assert.equal((await guest.post(`/api/invitations/${id}/accept`, {})).status, 404, 'a declined invitation cannot be accepted');
  assert.equal((await guest.get(`/api/projects/${pid}`)).status, 404);
  // withdraw
  const inv2 = await owner.post(`/api/projects/${pid}/invitations`, { username: 'invother', role: 'viewer' });
  assert.equal(inv2.status, 200);
  const pending = (await owner.get(`/api/projects/${pid}/members`)).json.invitations.find((i) => i.username === 'invother');
  assert.equal((await other.del(`/api/projects/${pid}/invitations/${pending.id}`)).status, 404, 'a non-member cannot withdraw it');
  assert.equal((await owner.del(`/api/projects/${pid}/invitations/${pending.id}`)).status, 200);
  assert.equal((await other.get('/api/invitations')).json.invitations.filter((i) => (i.projectId || i.project_id || (i.project && i.project.id)) === pid).length, 0);
});

test('data modules: one revision by number from the history; the owner locks and unlocks; editors cannot', async () => {
  const owner = await person('dmowner'); const ed = await person('dmeditor');
  const mk = await owner.post('/api/projects', { name: 'History', pipeline: 's1000dtofo' }); assert.equal(mk.status, 201); const pid = mk.json.project.id;
  assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: 'dmeditor', role: 'editor' })).status, 200);
  const U = `/api/projects/${pid}`;
  assert.equal((await owner.post(`${U}/dms`, { file: DM_DESC, xml: h.sample(DM_DESC) })).status, 201);
  const got = await owner.get(`${U}/dms/${DM_DESC}`);
  assert.equal((await owner.put(`${U}/dms/${DM_DESC}`, { xml: got.json.xml.replace('Hydraulic pump', 'Hydraulic pump (rev)'), baseHash: got.json.hash })).status, 200);
  const hist = (await owner.get(`${U}/dms/${DM_DESC}/history`)).json.revisions;
  assert.ok(hist.length >= 2);
  const revs = hist.map((r) => r.rev ?? r.revision ?? r.id).filter((x) => x !== undefined);
  const texts = await Promise.all(revs.map(async (r) => (await owner.get(`${U}/dms/${DM_DESC}/history/${r}`)).json.xml));
  assert.ok(texts.some((x) => x && x.includes('Hydraulic pump (rev)')) && texts.some((x) => x && x.includes('Hydraulic pump<')), 'both the old and the new text come back by revision');
  // lock / unlock
  assert.equal((await ed.post(`${U}/dms/${DM_DESC}/lock`, {})).status, 403, 'an editor cannot lock');
  assert.equal((await owner.post(`${U}/dms/${DM_DESC}/lock`, {})).status, 200);
  const cur = await ed.get(`${U}/dms/${DM_DESC}`);
  assert.ok([403, 409, 423].includes((await ed.put(`${U}/dms/${DM_DESC}`, { xml: cur.json.xml, baseHash: cur.json.hash })).status), 'a locked module refuses an editor\'s save');
  assert.equal((await ed.post(`${U}/dms/${DM_DESC}/unlock`, {})).status, 403, 'an editor cannot unlock');
  assert.equal((await owner.post(`${U}/dms/${DM_DESC}/unlock`, {})).status, 200);
  const again = await ed.get(`${U}/dms/${DM_DESC}`);
  assert.equal((await ed.put(`${U}/dms/${DM_DESC}`, { xml: again.json.xml.replace('(rev)', '(rev 2)'), baseHash: again.json.hash })).status, 200, 'unlocked: the editor saves');
  assert.equal((await owner.post(`${U}/dms/DMC-NOT-THERE.XML/unlock`, {})).status, 404);
  // open: the project becomes the caller's active project
  assert.equal((await ed.post(`${U}/open`, {})).status, 200);
  assert.equal(require('../dist/context').store.getUser(ed.id).active_project_id, pid);
  assert.equal((await owner.get(`${U}/publish/status`)).status, 200, 'renderer status for a viewer and above');
});

test('configuration routes: validate-config, SNS preset export/import, a project preset, BREX rows, waivers, JSG schema, ancillary reset', async () => {
  const pm = await person('cfgpm', 'project_manager'); const a = await person('cfgauthor');
  const v = await a.post('/api/s1000d/validate-config', { s1000d: { snsPreset: 'no-such-preset' } });
  assert.equal(v.status, 400); assert.equal(v.json.code, 'NO_PRESET');
  assert.equal((await a.post('/api/s1000d/validate-config', { s1000d: {} })).status, 200);
  const presets = (await a.get('/api/s1000d/presets')).json.presets; assert.ok(presets.length > 0);
  const pre = presets[0].id;
  const ex = await admin.get(`/api/admin/s1000d/presets/${pre}/export`);
  assert.equal(ex.status, 200); const exported = ex.json || JSON.parse(String(ex.buf)); assert.equal(exported.format, 'agastya-sns-preset');
  assert.equal((await a.get(`/api/admin/s1000d/presets/${pre}/export`)).status, 403);
  const csv = await admin.get(`/api/admin/s1000d/presets/${pre}/export?format=csv`);
  assert.match(String(csv.buf), /^system,subsystem,assembly,title\r\n/);
  const copy = await admin.post(`/api/admin/s1000d/presets/${pre}/duplicate`, { name: 'WP09 copy' });
  assert.ok([200, 201].includes(copy.status), JSON.stringify(copy.json));
  const copyId = copy.json.id || (copy.json.preset && copy.json.preset.id);
  const imp = await admin.post(`/api/admin/s1000d/presets/${copyId}/import`, { format: 'json', text: JSON.stringify(exported) });
  assert.equal(imp.status, 200, JSON.stringify(imp.json)); assert.ok(imp.json.imported > 0);
  const nodesOf = async (id) => (await admin.get(`/api/s1000d/presets/${id}`)).json.nodes.filter((n) => !(n.note && n.note.category)).map((n) => `${n.path}=${n.title}`).sort();
  assert.deepEqual(await nodesOf(copyId), await nodesOf(pre), 'an exported preset imports back unchanged (WP-09 fix: the JSON export was not accepted by the import)');
  assert.equal((await admin.post(`/api/admin/s1000d/presets/${copyId}/import`, { format: 'csv', text: 'nonsense' })).status, 400);
  assert.equal((await a.post(`/api/admin/s1000d/presets/${copyId}/import`, { format: 'json', text: '{}' })).status, 403);
  // a project: preset applied by its manager (dry run first), SNS export, BREX rows preview, waivers
  const pid = await project(pm, 'Config');
  const U = `/api/projects/${pid}`;
  assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: 'cfgauthor', role: 'editor' })).status, 200);
  const dry = await pm.post(`${U}/sns/preset`, { presetId: pre, dryRun: true }); assert.equal(dry.status, 200); assert.ok(dry.json.report);
  assert.equal((await a.post(`${U}/sns/preset`, { presetId: pre })).status, 403, 'an editor does not change the project SNS');
  assert.equal((await pm.post(`${U}/sns/preset`, { presetId: 'zz-none' })).status, 404);
  assert.equal((await pm.post(`${U}/sns/preset`, { presetId: pre })).status, 200);
  const sx = await a.get(`${U}/sns/export`); assert.equal(sx.status, 200); assert.ok(JSON.stringify(sx.json ?? String(sx.buf)).length > 2);
  const brex = await a.post(`${U}/sns-rows/import-brex`, {}); assert.equal(brex.status, 200); assert.equal(brex.json.applied, false, 'a preview unless apply is set');
  const w = await a.post(`${U}/publish-waivers`, { kind: (await a.get(`${U}/publish-waivers`)).json.kinds[0], subject: 'DMC-EXAMPLE-A-00-00-00-00A-040A-D', reason: 'Draft builds only while the module is written.' });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  assert.equal((await a.del(`${U}/publish-waivers/${w.json.waiver.id}`)).status, 200);
  assert.equal((await a.del(`${U}/publish-waivers/${w.json.waiver.id}`)).status, 404, 'removed once');
  assert.equal((await a.get(`${U}/publish-waivers`)).json.waivers.length, 0);
  // JSG schema and a JSS ancillary page reset
  const xsd = await a.get('/api/jsg/schema'); assert.equal(xsd.status, 200); assert.match(String(xsd.buf), /<xs:schema/);
  const jss = await a.post('/api/projects', { name: 'Ancillary', format: 'jss', domain: 'land', manualType: 'uhb' });
  assert.equal(jss.status, 201, JSON.stringify(jss.json)); const J = `/api/projects/${jss.json.project.id}`;
  const page = (await a.get(`${J}/ancillary`)).json.pages.find((x) => x.file && x.enabled);
  const cur = (await a.get(`${J}/ancillary/${page.id}`)).json.xml;
  assert.equal((await a.put(`${J}/ancillary/${page.id}`, { xml: `${cur.trimEnd()}\n<!-- WP09 EDIT -->\n`, baseHash: (await a.get(`${J}/ancillary/${page.id}`)).json.hash })).status, 200);
  assert.ok((await a.get(`${J}/ancillary/${page.id}`)).json.xml.includes('WP09 EDIT'));
  const reset = await a.post(`${J}/ancillary/${page.id}/reset`, {});
  assert.equal(reset.status, 200); assert.ok(!JSON.stringify(reset.json).includes('WP09 EDIT'), 'the page is given back to Settings');
  assert.ok(fs.existsSync(path.join(h.ws, 'projects')));
});
