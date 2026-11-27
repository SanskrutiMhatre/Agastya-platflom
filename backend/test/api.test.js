'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM_DESC = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const DM_PROC = 'DMC-S1KSTUDIO-A-29-10-00-00A-520A-A_001-00_EN-US.XML';

let h; let admin; let writer; let pid;

test.before(async () => { h = await boot(); admin = new h.Client('admin'); });
test.after(async () => { await h.close(); });

test('first run: setup creates the administrator, then refuses a second', async () => {
  assert.equal((await admin.get('/api/auth/setup')).json.setupRequired, true);
  const r = await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, 'admin');
  const again = await new h.Client('x').post('/api/auth/setup', { username: 'other', password: PW });
  assert.equal(again.status, 409);
});

test('the master-password backdoor from the JSS revision is gone', async () => {
  const stray = new h.Client('stray');
  const r = await stray.post('/api/auth/login', { username: 'admin', password: 'definitely-wrong-1' });
  assert.equal(r.status, 401);
  const mp = require('../dist/core/auth/masterPassword');
  assert.equal(mp.isEnabled(), false);
  assert.equal(await mp.matches({ role: 'admin' }, 'anything'), false);
});

test('unauthenticated requests are refused with 401 and a cookie is HttpOnly', async () => {
  const anon = new h.Client('anon');
  assert.equal((await anon.get('/api/projects')).status, 401);
  assert.equal((await anon.get('/api/overview')).status, 401);
  const login = await anon.req('POST', '/api/auth/login', { username: 'admin', password: PW });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /agastya_session=/);

  // One active session per account: the login above displaced the admin's first session.
  assert.equal((await admin.get('/api/projects')).status, 401, 'a new sign-in displaces the previous session');
  assert.equal((await admin.post('/api/auth/login', { username: 'admin', password: PW })).status, 200);
});

test('folders and projects: create, file, list', async () => {
  assert.equal((await admin.post('/api/projects', { name: 'Admin Book' })).status, 403, 'administrators oversee; they do not create projects');
  assert.equal((await admin.post('/api/projects/sample', {})).status, 403);
  const made = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda Writer', role: 'author' });
  assert.equal(made.status, 201);
  writer = new h.Client('wanda');
  assert.equal((await writer.post('/api/auth/login', { username: 'wanda', password: made.json.tempPassword })).status, 200);
  assert.equal((await writer.post('/api/auth/onboarding', { username: 'wanda', password: PW })).status, 200);
  assert.equal((await writer.post('/api/folders', { name: 'Navy' })).status, 201);
  assert.equal((await writer.post('/api/folders', { name: 'navy' })).status, 409, 'folder names are case-insensitive');
  const p = await writer.post('/api/projects', { name: 'Test Book', folder: 'Navy', pipeline: 's1000dtofo' });
  assert.equal(p.status, 201);
  pid = p.json.project.id;
  // Since Phase 19 a new module joins the publication by itself. The tests below are about the CSDB pool (unplaced / missing / placed), so this project opts out
  // of that, with the supported setting; the automatic placement is covered by project-formats.test.js and the e2e 00-platform.spec.ts.
  assert.equal((await writer.patch(`/api/projects/${pid}`, { autoAddToPublication: false })).status, 200);
  assert.equal(p.json.project.folder, 'Navy');
  assert.equal((await writer.post('/api/projects', { name: 'test book' })).status, 409, 'project names are unique, case-insensitively');
  const ws = await writer.get('/api/workspace');
  assert.equal(ws.json.folders.length, 1);
  assert.equal(ws.json.folders[0].projects[0].id, pid);
  const ov = await writer.get('/api/overview');
  assert.equal(ov.json.counts.projects, 1);
});

test('data modules: create, read, save, conflict, history', async () => {
  const xml = h.sample(DM_DESC);
  const created = await writer.post(`/api/projects/${pid}/dms`, { file: DM_DESC, xml });
  assert.equal(created.status, 201);
  assert.equal((await writer.post(`/api/projects/${pid}/dms`, { file: DM_DESC, xml })).status, 409);
  assert.equal((await writer.post(`/api/projects/${pid}/dms`, { file: '../evil.xml', xml })).status, 400);

  const list = await writer.get(`/api/projects/${pid}/dms`);
  assert.equal(list.json.dms.length, 1);
  assert.equal(list.json.dms[0].techName, 'Hydraulic pump');
  assert.equal(list.json.dms[0].dmc, 'S1KSTUDIO-A-29-10-00-00-00A-040A-D'.replace('29-10-00-00-00A', '29-10-00-00A'.length ? '29-10-00-00A' : ''));

  const got = await writer.get(`/api/projects/${pid}/dms/${DM_DESC}`);
  const edited = got.json.xml.replace('Hydraulic pump', 'Hydraulic pump (rev)');
  const saved = await writer.put(`/api/projects/${pid}/dms/${DM_DESC}`, { xml: edited, baseHash: got.json.hash });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.changed, true);

  // a second author still holding the OLD hash must be refused, not overwrite
  const stale = await writer.put(`/api/projects/${pid}/dms/${DM_DESC}`, { xml: got.json.xml, baseHash: got.json.hash });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'EDIT_CONFLICT');

  const hist = await writer.get(`/api/projects/${pid}/dms/${DM_DESC}/history`);
  assert.ok(hist.json.revisions.length >= 2);
});

test('writes refuse hostile and damaged XML', async () => {
  const xxe = h.sample(DM_DESC).replace('<!DOCTYPE dmodule [', '<!DOCTYPE dmodule [\n<!ENTITY x SYSTEM "file:///c:/windows/win.ini">');
  const r = await writer.put(`/api/projects/${pid}/dms/${DM_DESC}`, { xml: xxe, baseHash: (await writer.get(`/api/projects/${pid}/dms/${DM_DESC}`)).json.hash });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'UNSAFE_XML');
  const notDm = await writer.put(`/api/projects/${pid}/dms/${DM_DESC}`, { xml: '<?xml version="1.0"?><x/>', baseHash: (await writer.get(`/api/projects/${pid}/dms/${DM_DESC}`)).json.hash });
  assert.equal(notDm.json.code, 'NOT_A_DM');
});

test('publication: place modules, explore resolves them, unplaced and missing are reported', async () => {
  await writer.post(`/api/projects/${pid}/dms`, { file: DM_PROC, xml: h.sample(DM_PROC) });
  let ex = (await writer.get(`/api/projects/${pid}/explore`)).json;
  assert.equal(ex.totals.dms, 2);
  assert.equal(ex.totals.unplaced, 2);

  const pmc = (await writer.get(`/api/projects/${pid}/pmc`)).json;
  assert.equal(pmc.entries.length, 0);
  const entries = [
    { type: 'folder', title: 'Chapter 1', children: [{ type: 'include', title: 'Pump', href: `csdb/${DM_DESC}` }] },
    { type: 'folder', title: 'Chapter 2', children: [{ type: 'include', title: 'Gone', href: 'csdb/DMC-NOPE.xml' }] },
  ];
  const saved = await writer.put(`/api/projects/${pid}/pmc`, { meta: pmc.meta, entries, baseHash: (await writer.get(`/api/projects/${pid}/pmc`)).json.hash });
  assert.equal(saved.status, 200);
  assert.equal((await writer.put(`/api/projects/${pid}/pmc`, { entries: [], baseHash: (await writer.get(`/api/projects/${pid}/pmc`)).json.hash })).status, 400, 'empty publication refused');

  ex = (await writer.get(`/api/projects/${pid}/explore`)).json;
  assert.equal(ex.tree.length, 2);
  assert.equal(ex.tree[0].children[0].kind, 'dm');
  assert.equal(ex.tree[1].children[0].kind, 'missing');
  assert.equal(ex.totals.unplaced, 1);
  assert.deepEqual(ex.missing, ['csdb/DMC-NOPE.xml']);
});

test('publication: a module placed as a dmRef (what the builder writes) leaves the pool and resolves in Explore', async () => {
  const list = (await writer.get(`/api/projects/${pid}/dms`)).json.dms;
  const d = list.find((x) => x.file === DM_PROC);
  assert.ok(d.dmCodeAttrs && d.dmCodeAttrs.modelIdentCode === 'S1KSTUDIO', 'list carries the identity a dmRef is written from');
  const pmc = (await writer.get(`/api/projects/${pid}/pmc`)).json;
  const before = pmc.pool.length;
  const entries = [...pmc.entries, { type: 'folder', title: 'Chapter 3', children: [{ type: 'dm', dmCode: d.dmCodeAttrs, issueInfo: d.issueInfoAttrs, language: d.languageAttrs, techName: d.techName, infoName: d.infoName }] }];
  assert.equal((await writer.put(`/api/projects/${pid}/pmc`, { meta: pmc.meta, entries, baseHash: (await writer.get(`/api/projects/${pid}/pmc`)).json.hash })).status, 200);
  const after = (await writer.get(`/api/projects/${pid}/pmc`)).json;
  assert.equal(after.pool.length, before - 1, 'placed module is no longer in the pool');
  const ex = (await writer.get(`/api/projects/${pid}/explore`)).json;
  const ch3 = ex.tree.find((n) => n.title === 'Chapter 3');
  assert.equal(ch3.children[0].kind, 'dm');
  assert.equal(ch3.children[0].file, DM_PROC);
  // put it back so the later tests see the state they expect
  await writer.put(`/api/projects/${pid}/pmc`, { meta: pmc.meta, entries: pmc.entries, baseHash: (await writer.get(`/api/projects/${pid}/pmc`)).json.hash });
});

test('validation: finds the missing publication entry and records the run', async () => {
  const r = await writer.post(`/api/projects/${pid}/validation`, { issue: 'auto', brex: false });
  assert.equal(r.status, 200);
  const run = r.json.run;
  assert.ok(Array.isArray(run.issues));
  assert.ok(run.issues.some((i) => i.source === 'pm' && i.sev === 'error'), 'dangling publication entry reported');
  const again = await writer.get(`/api/projects/${pid}/validation`);
  assert.equal(again.json.run.ranAt, run.ranAt);
});

test('release and watermark: unreleased builds are NOT RELEASED until an administrator approves', async () => {
  const wm = await writer.put(`/api/projects/${pid}/watermark`, { enabled: true, text: 'DRAFT', style: 'tiled' });
  assert.equal(wm.json.watermark.style, 'tiled');
  let rel = (await writer.get(`/api/projects/${pid}/release`)).json;
  assert.equal(rel.release, null);

  const past = await writer.post(`/api/projects/${pid}/release`, { scheduledAt: new Date(Date.now() - 3600e3).toISOString() });
  assert.equal(past.status, 400);
  const ok = await writer.post(`/api/projects/${pid}/release`, { scheduledAt: new Date(Date.now() + 1000).toISOString(), note: 'first' });
  assert.equal(ok.status, 200);
  assert.equal((await writer.post(`/api/projects/${pid}/release`, { scheduledAt: new Date(Date.now() + 5000).toISOString() })).status, 409);

  rel = (await writer.get(`/api/projects/${pid}/release`)).json;
  assert.ok(rel.pending);
  assert.equal((await writer.post(`/api/projects/${pid}/release/${rel.pending.id}/approve`)).status, 403, 'the author who asked cannot approve');
  assert.equal((await admin.post(`/api/projects/${pid}/release/${rel.pending.id}/approve`)).status, 200);
  await new Promise((r) => setTimeout(r, 1500)); // the release moment must have arrived
  rel = (await writer.get(`/api/projects/${pid}/release`)).json;
  assert.equal(rel.release.number, 1);

  // any content change un-releases it (the approval covered one fingerprint)
  const got = await writer.get(`/api/projects/${pid}/dms/${DM_DESC}`);
  await writer.put(`/api/projects/${pid}/dms/${DM_DESC}`, { xml: got.json.xml.replace('Hydraulic pump (rev)', 'Hydraulic pump (rev 2)'), baseHash: got.json.hash });
  rel = (await writer.get(`/api/projects/${pid}/release`)).json;
  assert.equal(rel.release, null);
  assert.ok(rel.staleRelease, 'stale release is reported rather than silently dropped');
});

test('access control: non-members see nothing; a viewer cannot write; an invited editor can', async () => {
  const mk = await admin.post('/api/admin/users', { username: 'priya', fullName: 'Priya Nair', role: 'author' });
  assert.equal(mk.status, 200);
  assert.match(mk.json.tempPassword, /^priya-[a-hjkmnp-z2-9]{8}$/, 'temporary password is username-<8 random characters> (SEC-004)');
  const priya = new h.Client('priya');
  const login = await priya.post('/api/auth/login', { username: 'priya', password: mk.json.tempPassword });
  assert.equal(login.status, 200);
  assert.equal(login.json.gates.onboarding, true);
  assert.equal((await priya.get('/api/projects')).status, 403, 'account gate blocks everything until onboarding');
  const onb = await priya.post('/api/auth/onboarding', { fullName: 'Priya Nair', username: 'priya', password: PW });
  assert.equal(onb.status, 200);

  assert.equal((await priya.get('/api/projects')).json.projects.length, 0);
  assert.equal((await priya.get(`/api/projects/${pid}/dms`)).status, 404, 'membership is not disclosed');

  const inv = await writer.post(`/api/projects/${pid}/invitations`, { username: 'priya', role: 'viewer' });
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const mine = await priya.get('/api/invitations');
  assert.equal(mine.json.invitations.length, 1);
  assert.equal((await priya.post(`/api/invitations/${mine.json.invitations[0].id}/accept`)).status, 200);

  assert.equal((await priya.get(`/api/projects/${pid}/dms`)).status, 200);
  const w = await priya.put(`/api/projects/${pid}/dms/${DM_DESC}`, { xml: h.sample(DM_DESC), baseHash: (await priya.get(`/api/projects/${pid}/dms/${DM_DESC}`)).json.hash });
  assert.equal(w.status, 403);
  assert.equal((await priya.post(`/api/projects/${pid}/release`, { scheduledAt: new Date(Date.now() + 5000).toISOString() })).status, 403);
  assert.equal((await priya.post('/api/admin/users', { username: 'x1y2z3', fullName: 'X Y' })).status, 403);

  await writer.patch(`/api/projects/${pid}/members/${login.json.user.id}`, { role: 'editor' });
  const got = await priya.get(`/api/projects/${pid}/dms/${DM_DESC}`);
  assert.equal((await priya.put(`/api/projects/${pid}/dms/${DM_DESC}`, { xml: got.json.xml, baseHash: got.json.hash })).status, 200);
  assert.equal((await priya.del(`/api/projects/${pid}`)).status, 403, 'editors cannot delete the project');
});

test('server-side PDF: quick preview of one data module and the full publication', { timeout: 180000 }, async () => {
  const pv = await writer.req('POST', `/api/projects/${pid}/publish/preview/${DM_DESC}`, {});
  assert.equal(pv.status, 200, pv.json ? JSON.stringify(pv.json).slice(0, 600) : '');
  assert.equal(pv.buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pv.buf.length > 5000);

  const build = await writer.post(`/api/projects/${pid}/publish`, {});
  assert.equal(build.status, 200, JSON.stringify(build.json).slice(0, 800));
  const pdf = await writer.get(`/api/projects/${pid}/publish/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');

  const none = await writer.get('/api/projects/doesnotexist/publish/pdf');
  assert.equal(none.status, 404);
});

test('unique data modules: the same code, issue and language cannot exist twice in one project', async () => {
  const dup = await writer.post(`/api/projects/${pid}/dms`, { file: 'DMC-DUPLICATE-COPY.XML', xml: h.sample(DM_DESC) });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'DUPLICATE_DMC');
  assert.equal(dup.json.existing, DM_DESC);
  const got = await writer.get(`/api/projects/${pid}/dms/${DM_PROC}`);
  const collide = got.json.xml.replace('infoCode="520"', 'infoCode="040"').replace('itemLocationCode="A"', 'itemLocationCode="D"');
  const r = await writer.put(`/api/projects/${pid}/dms/${DM_PROC}`, { xml: collide, baseHash: got.json.hash });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'DUPLICATE_DMC');
});

test('sample project: three data modules, a figure, a three-chapter publication, owned by the creator', async () => {
  const s = await writer.post('/api/projects/sample', {});
  assert.equal(s.status, 201);
  const sid = s.json.project.id;
  assert.equal(s.json.project.dmCount, 3);
  const ex = (await writer.get(`/api/projects/${sid}/explore`)).json;
  assert.equal(ex.tree.length, 3);
  assert.equal(ex.totals.unplaced, 0);
  assert.equal(ex.totals.missing, 0);
  assert.equal((await writer.get(`/api/projects/${sid}/media`)).json.media.length, 1);
  const again = await writer.post('/api/projects/sample', {});
  assert.notEqual(again.json.project.name, s.json.project.name, 'a second sample gets its own name');
  assert.equal((await writer.get(`/api/projects/${again.json.project.id}/dms`)).json.dms.length, 3);
  await writer.del(`/api/projects/${sid}?confirm=${encodeURIComponent(s.json.project.name)}`);
  await writer.del(`/api/projects/${again.json.project.id}?confirm=${encodeURIComponent(again.json.project.name)}`);
});

test('document types: a User Handbook project starts with its seven chapters and the stencil style; a blank one is unchanged', async () => {
  const types = (await writer.get('/api/document-types')).json.types;
  // The Xignal S1000D profile starts empty: its structure comes from an imported PMC, not from starter chapters.
  assert.deepEqual(types.map((t) => [t.id, t.chapters]), [['uhb', 7], ['xignal-jss', 7], ['xignal-s1000d', 0]]);

  assert.equal((await writer.post('/api/projects', { name: 'Bad Type', profile: 'nope' })).status, 400);
  const made = await writer.post('/api/projects', { name: 'Handbook', profile: 'uhb', pipeline: 's1000dtofo' });
  assert.equal(made.status, 201);
  const id = made.json.project.id;
  assert.equal(made.json.project.templateRef, 'uhb');
  assert.equal(made.json.project.pipeline, 's1000dtojss', 'a document type is published through the JSS book engine');

  const pmc = (await writer.get(`/api/projects/${id}/pmc`)).json;
  assert.deepEqual(pmc.entries.map((e) => e.title), [
    'Leading Particulars and General Data', 'Brief Technical Description', 'Unpacking and Removal of Preservatives',
    'Preparation for Use and Installation Specification', 'Operating Instructions',
    "User's Servicing and Maintenance Instructions", 'Miscellaneous',
  ]);
  assert.ok(pmc.entries.every((e) => e.type === 'folder'));

  const st = (await writer.get(`/api/projects/${id}/settings`)).json;
  assert.equal(st.templateRef, 'uhb');
  assert.equal(st.house.layout.fonts.family, 'Arial');
  assert.equal(st.house.layout.fonts.bodySize, '12pt');
  assert.equal(st.house.layout.chapterTitleSize, '21pt');      // the owner's decision of 2026-11-24 (commit eb43711): chapter titles are 20-22 pt; the seeded templates say 21
  const def = (await writer.get(`/api/projects/${pid}/settings`)).json;
  assert.equal(def.house.layout.fonts.family, 'Helvetica', 'the default house style is untouched');

  const blank = await writer.post('/api/projects', { name: 'Plain' });
  // a project made with nothing said about its kind is an S1000D publication on the reference (Xignal) style, like the wizard's (owner's decision of 2026-11-26)
  assert.equal(blank.json.project.templateRef, 'xignal-s1000d'); assert.equal(blank.json.project.format, 's1000d'); assert.equal(blank.json.project.pipeline, 's1000dtofo');
  // ... and the plain style is still there when it is asked for by name
  const plain = await writer.post('/api/projects', { name: 'Plain default', templateRef: 'default' }); assert.equal(plain.status, 201); assert.equal(plain.json.project.templateRef, 'default');
  assert.equal((await writer.del(`/api/projects/${plain.json.project.id}?confirm=${encodeURIComponent('Plain default')}`)).status, 200);
  assert.equal((await writer.get(`/api/projects/${blank.json.project.id}/pmc`)).json.entries.length, 0);
  for (const x of [id, blank.json.project.id]) assert.equal((await writer.del(`/api/projects/${x}?confirm=${encodeURIComponent(x === id ? 'Handbook' : 'Plain')}`)).status, 200);
});

test('cover Code No. / Rev No.: sent to the engines only when the project sets them', async () => {
  const cfg = require('../vendor/engine/config');
  const house = { layout: {}, branding: {} };
  const names = (fm) => cfg.stage2Params(cfg.mergeConfig(house, { frontMatter: fm })).map(([n]) => n);
  assert.ok(!names({}).includes('cover.codeNo') && !names({}).includes('cover.revNo'), 'unset: nothing is sent, the cover is unchanged');
  const set = cfg.stage2Params(cfg.mergeConfig(house, { frontMatter: { codeNo: 'DT01', revNo: 'R2' } }));
  assert.deepEqual(set.filter(([n]) => n.startsWith('cover.')), [['cover.codeNo', 'DT01'], ['cover.revNo', 'R2']]);
});

test('deleting a project needs its name and removes it', async () => {
  assert.equal((await writer.del(`/api/projects/${pid}`)).status, 400);
  assert.equal((await writer.del(`/api/projects/${pid}?confirm=Test%20Book`)).status, 200);
  assert.equal((await writer.get('/api/projects')).json.projects.length, 0);
});
