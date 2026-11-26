'use strict';
// Review workflow, Administrator reference data, enterprise check on import, shared CIR, graphics.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';

let h; let admin; let pm; let alice; let carol; let pid;

async function person(creator, role, username, fullName) {
  const made = await creator.post('/api/team/users', { username, fullName, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username);
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}

const form = (files, extra = {}) => {
  const fd = new FormData();
  for (const [name, content, type] of files) fd.append('files', new Blob([content], { type: type || 'application/xml' }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
};

/** All text drawn on a PDF's pages (the watermark is real text), via the pdf.js the frontend already ships. */
async function pdfText(buf) {
  const lib = path.resolve(__dirname, '..', '..', 'frontend', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
  const { getDocument } = await import(pathToFileURL(lib).href);
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
  return out;
}

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  pm = await person(admin, 'project_manager', 'meera', 'Meera Rao');
  alice = await person(pm, 'author', 'alice', 'Alice Author');
  carol = await person(admin, 'author', 'carol', 'Carol Author');
  // the review flow is layout-independent; this test also reads the plain layout's "Release 1" foot text, so the project asks for the plain style (a bare project is on the reference layout since 2026-11-26)
  pid = (await alice.post('/api/projects', { name: 'Alice Pump', templateRef: 'default' })).json.project.id;
  assert.equal((await alice.post(`/api/projects/${pid}/dms`, { file: DM, xml: h.sample(DM) })).status, 201);
  const pmc = (await alice.get(`/api/projects/${pid}/pmc`)).json;
  assert.equal((await alice.put(`/api/projects/${pid}/pmc`, { meta: pmc.meta, entries: [{ type: 'folder', title: 'Chapter 1', children: [{ type: 'include', title: 'Pump', href: `csdb/${DM}` }] }] })).status, 200);
  assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'meera', role: 'manager' })).status, 200);
});
test.after(async () => { await h.close(); });

test('administrator reference data: the V1 sections, seeded once, edited by administrators only', async () => {
  const all = (await admin.get('/api/admin/config')).json.collections;
  assert.deepEqual(all.map((c) => c.id).sort(), [
    'country-codes', 'ddn', 'ddn-metadata', 'dm-types', 'language-codes', 'languages',
    'originator-cages', 'pdf-customisations', 'pm-templates', 'rpc-cages', 'security-classes',
  ]);    // information codes, SNS and applicability have their own services and screens (see s1000d-reference.test.js)
  const types = (await admin.get('/api/admin/config/dm-types')).json.items;
  assert.equal(types.length, 21, 'the editor offers 21 data module types');
  assert.ok(types.some((t) => t.schema === 'brex'));
  assert.equal((await admin.get('/api/admin/config/rpc-cages')).json.items.length, 0, 'enterprises are not seeded: empty = the import check is off');

  const made = await admin.post('/api/admin/config/country-codes', { code: 'NO', name: 'Norway' });
  assert.equal(made.status, 201);
  assert.equal((await admin.post('/api/admin/config/country-codes', { code: 'no', name: 'Again' })).status, 409, 'unique, case-insensitive');
  assert.equal((await admin.post('/api/admin/config/country-codes', { code: 'XX' })).status, 400, 'required field');
  assert.equal((await admin.put(`/api/admin/config/country-codes/${made.json.item.id}`, { code: 'NO', name: 'Norge' })).json.item.name, 'Norge');
  assert.equal((await admin.del(`/api/admin/config/country-codes/${made.json.item.id}`)).status, 200);
  assert.equal((await admin.del(`/api/admin/config/country-codes/${made.json.item.id}`)).status, 404);
  assert.equal((await admin.get('/api/admin/config/country-codes')).json.items.length, 8, 'a deleted seed record stays deleted; nothing is re-seeded');
  assert.equal((await admin.get('/api/admin/config/nope')).status, 404, 'only known tables are addressable');

  for (const c of [alice, pm]) {
    assert.equal((await c.get('/api/admin/config')).status, 403);
    assert.equal((await c.post('/api/admin/config/sns', { code: '99', name: 'x' })).status, 403);
    assert.equal((await c.get('/api/admin/roles')).status, 403);
    assert.equal((await c.post('/api/admin/maintenance/reindex')).status, 403);
  }
  assert.equal((await admin.get('/api/admin/roles')).json.roles.length, 3);
});

test('platform settings: administrators write them, everyone reads them, bad values are refused', async () => {
  assert.equal((await alice.get('/api/app-settings')).json.settings.appName, 'Agastya');
  const put = await admin.put('/api/admin/app-settings', { appName: 'Defence Docs', organisation: 'L&T', accent: '#1a73e8', compact: true, theme: 'dark' });
  assert.equal(put.status, 200);
  assert.deepEqual((await alice.get('/api/app-settings')).json.settings, { appName: 'Defence Docs', organisation: 'L&T', accent: '#1a73e8', compact: true, theme: 'dark' });
  assert.equal((await admin.put('/api/admin/app-settings', { accent: 'blue' })).status, 400);
  assert.equal((await admin.put('/api/admin/app-settings', { appName: '  ' })).status, 400);
  assert.equal((await alice.put('/api/admin/app-settings', { appName: 'X' })).status, 403);
  await admin.put('/api/admin/app-settings', { appName: 'Agastya', organisation: '', accent: '', compact: false, theme: 'system' });
});

test('maintenance: re-index, schema check, preview clean-up and the audit export do real work', async () => {
  assert.equal((await admin.post('/api/admin/maintenance/reindex')).json.projects, 1);
  const sc = (await admin.post('/api/admin/maintenance/check-schemas')).json;
  assert.deepEqual(sc.missing, [], 'every wizard issue has its schemas installed');
  assert.equal(typeof (await admin.post('/api/admin/maintenance/clear-previews')).json.removed, 'number');
  const csv = await admin.get('/api/admin/maintenance/audit.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.buf.toString('utf8'), /^time,actor,action/);
});

test('enterprise check on import: code, name and the code+name pair against the Administrator lists', async () => {
  const importOne = (client, xml, extra = {}) => client.req('POST', `/api/projects/${pid}/dms-import`, form([[DM, xml]], { overwrite: '1', ...extra }));

  // lists empty: nothing is checked
  assert.equal((await importOne(alice, h.sample(DM))).status, 200, 'not configured = not checked');

  await admin.post('/api/admin/config/rpc-cages', { cage: 'S1K01', name: 'S1000D Studio Sample Data', role: 'RPC' });
  await admin.post('/api/admin/config/originator-cages', { cage: 'S1K01', name: 'S1000D Studio Sample Data', role: 'Originator' });
  assert.equal((await importOne(alice, h.sample(DM))).status, 200, 'registered code and name: accepted');

  // unknown CODE
  const badCode = h.sample(DM).replace('<originator enterpriseCode="S1K01">', '<originator enterpriseCode="ZZZ99">');
  let r = await importOne(alice, badCode);
  assert.equal(r.status, 400);
  assert.ok(r.json.problems.some((p) => /Originator: the enterprise code “ZZZ99” is not registered/.test(p)), JSON.stringify(r.json.problems));

  // unknown NAME
  const badName = h.sample(DM).replace('<enterpriseName>S1000D Studio Sample Data</enterpriseName>', '<enterpriseName>Someone Else Ltd</enterpriseName>');
  r = await importOne(alice, badName);
  assert.equal(r.status, 400);
  assert.ok(r.json.problems.some((p) => /enterprise name “Someone Else Ltd” is not registered/.test(p)));

  // both registered, but the pair is wrong
  await admin.post('/api/admin/config/rpc-cages', { cage: 'OTH01', name: 'Other Co', role: 'RPC' });
  const pair = h.sample(DM).replace(/(<responsiblePartnerCompany enterpriseCode="S1K01">\s*<enterpriseName>)S1000D Studio Sample Data/, '$1Other Co');
  r = await importOne(alice, pair);
  assert.equal(r.status, 400);
  assert.ok(r.json.problems.some((p) => /Responsible partner company: the code “S1K01” belongs to “S1000D Studio Sample Data”, not “Other Co”/.test(p)), JSON.stringify(r.json.problems));

  // a refused import leaves the project as it was
  assert.equal((await alice.get(`/api/projects/${pid}/dms`)).json.dms.length, 1);
});

test('review: submit, comment, send back with reasons, fix, resubmit, approve - and the PDF is watermarked until then', async () => {
  // the sample module carries enterprises; clear the lists so this test is about review only
  for (const col of ['rpc-cages', 'originator-cages']) {
    for (const it of (await admin.get(`/api/admin/config/${col}`)).json.items) await admin.del(`/api/admin/config/${col}/${it.id}`);
  }
  const rel = (c) => c.get(`/api/projects/${pid}/release`).then((r) => r.json);
  assert.equal((await rel(alice)).review.state, 'draft');

  // the author submits for review (no date needed)
  assert.equal((await alice.post(`/api/projects/${pid}/release`, { note: 'finished' })).status, 200);
  let v = await rel(alice);
  assert.equal(v.review.state, 'in_review');
  assert.equal(v.review.canComment, true);
  const relId = v.pending.id;
  const inbox = (c) => c.get('/api/notifications').then((r) => r.json.items);
  assert.ok((await inbox(pm)).some((n) => n.kind === 'approval.requested' && /submitted/.test(n.title)), 'the Project Manager is told');

  // until approval the downloaded PDF carries NOT RELEASED
  const early = await alice.get(`/api/projects/${pid}/publish/download`);
  assert.equal(early.status, 200, early.json && early.json.error);
  assert.equal(early.headers.get('x-release-state'), 'not-released');
  assert.match(early.headers.get('content-disposition'), /NOT RELEASED/);
  assert.match(await pdfText(early.buf), /NOT RELEASED/);

  // the manager comments; the author hears about it
  const c1 = await pm.post(`/api/projects/${pid}/review/comments`, { body: 'The pump name is wrong in the title.', dmFile: DM });
  assert.equal(c1.status, 201);
  assert.equal((await pm.post(`/api/projects/${pid}/review/comments`, { body: '  ' })).status, 400, 'empty comment refused');
  assert.ok((await inbox(alice)).some((n) => n.kind === 'review.comment'));
  // a comment pinned to an element of the data module keeps its place and its words; a bad or orphan pin is refused
  const pin = await pm.post(`/api/projects/${pid}/review/comments`, { body: 'Reword this.', dmFile: DM, anchor: { path: '1/0', tag: 'title', text: 'Pump' } });
  assert.equal(pin.status, 201);
  assert.equal((await pm.post(`/api/projects/${pid}/review/comments`, { body: 'x', dmFile: DM, anchor: { path: '../etc', tag: 'p' } })).status, 400, 'a place is a child-index path');
  assert.equal((await pm.post(`/api/projects/${pid}/review/comments`, { body: 'x', anchor: { path: '1/0', tag: 'p' } })).status, 400, 'a pin needs its data module');
  const pinned = (await alice.get(`/api/projects/${pid}/release`)).json.review.comments.find((c) => c.id === pin.json.id);
  assert.deepEqual(pinned.anchor, { path: '1/0', tag: 'title', text: 'Pump' }, 'the author sees where it was made');

  // the author cannot decide or send back
  assert.equal((await alice.post(`/api/projects/${pid}/release/${relId}/changes`, { comment: 'no' })).status, 403);
  assert.equal((await alice.post(`/api/projects/${pid}/release/${relId}/approve`)).status, 403);

  // the manager sends it back
  assert.equal((await pm.post(`/api/projects/${pid}/release/${relId}/changes`, { comment: 'Please fix the title and the first step.' })).status, 200);
  v = await rel(alice);
  assert.equal(v.review.state, 'changes_requested');
  assert.equal(v.pending, null);
  assert.deepEqual(v.review.comments.map((c) => c.kind), ['comment', 'comment', 'changes']);
  assert.equal(v.review.comments[0].dmFile, DM);
  assert.equal(v.review.open, 3);
  assert.ok((await inbox(alice)).some((n) => n.kind === 'review.changes_requested' && /fix the title/.test(n.body)), 'the author is told what to change');
  assert.equal((await alice.get('/api/notifications/unread-count')).json.unread >= 2, true);

  // the author fixes it, marks the comments done and resubmits
  for (const c of v.review.comments) assert.equal((await alice.post(`/api/projects/${pid}/review/comments/${c.id}/resolve`, {})).status, 200);
  assert.equal((await rel(alice)).review.open, 0);
  const got = await alice.get(`/api/projects/${pid}/dms/${DM}`);
  assert.equal((await alice.put(`/api/projects/${pid}/dms/${DM}`, { xml: got.json.xml.replace('Hydraulic pump', 'Hydraulic pump unit'), baseHash: got.json.hash })).status, 200);
  assert.equal((await alice.post(`/api/projects/${pid}/release`, { note: 'fixed' })).status, 200);
  v = await rel(alice);
  assert.equal(v.review.state, 'in_review');
  assert.equal(v.review.round, 2, 'second round');
  assert.ok((await inbox(pm)).some((n) => n.kind === 'review.resubmitted'));

  // a send-back needs a reason
  const rel2 = v.pending.id;
  const fresh = await pm.post(`/api/projects/${pid}/release/${rel2}/changes`, {});
  assert.equal(fresh.status, 400);
  assert.equal(fresh.json.code, 'COMMENT_REQUIRED');

  // approval releases it; the author downloads the clean copy
  assert.equal((await pm.post(`/api/projects/${pid}/release/${rel2}/approve`)).status, 200);
  await new Promise((r) => setTimeout(r, 1200));
  v = await rel(alice);
  assert.equal(v.review.state, 'approved');
  assert.equal(v.release.number, 1);
  const clean = await alice.get(`/api/projects/${pid}/publish/download`);
  assert.equal(clean.status, 200);
  assert.equal(clean.headers.get('x-release-state'), 'released');
  assert.doesNotMatch(clean.headers.get('content-disposition'), /NOT RELEASED/);
  const text = await pdfText(clean.buf);
  assert.doesNotMatch(text, /NOT RELEASED/, 'an approved manual has no watermark');
  assert.match(text, /Release 1/);

  // any later change takes the approval away: the next download is watermarked again
  const g2 = await alice.get(`/api/projects/${pid}/dms/${DM}`);
  assert.equal((await alice.put(`/api/projects/${pid}/dms/${DM}`, { xml: g2.json.xml.replace('Hydraulic pump unit', 'Hydraulic pump assembly'), baseHash: g2.json.hash })).status, 200);
  assert.equal((await rel(alice)).review.state, 'draft');
  const again = await alice.get(`/api/projects/${pid}/publish/download`);
  assert.equal(again.headers.get('x-release-state'), 'not-released');
  assert.match(await pdfText(again.buf), /NOT RELEASED/);
});

test('an approval survives the first build: a manual approved before it was ever built is still released after it', async () => {
  const id = (await alice.post('/api/projects', { name: 'Never Built' })).json.project.id;
  await alice.post(`/api/projects/${id}/dms`, { file: DM, xml: h.sample(DM) });
  const pmc = (await alice.get(`/api/projects/${id}/pmc`)).json;
  assert.equal((await alice.put(`/api/projects/${id}/pmc`, { meta: pmc.meta, entries: [{ type: 'folder', title: 'C', children: [{ type: 'include', title: 'P', href: `csdb/${DM}` }] }] })).status, 200);
  await alice.post(`/api/projects/${id}/assign`, { username: 'meera', role: 'manager' });
  assert.equal((await alice.post(`/api/projects/${id}/release`, {})).status, 200);
  const rel = (await alice.get(`/api/projects/${id}/release`)).json;
  assert.equal((await pm.post(`/api/projects/${id}/release/${rel.pending.id}/approve`)).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await alice.get(`/api/projects/${id}/release`)).json.review.state, 'approved');
  for (let i = 0; i < 2; i++) {
    const dl = await alice.get(`/api/projects/${id}/publish/download`);
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get('x-release-state'), 'released', `download ${i + 1}: the first build must not undo the approval`);
  }
  assert.equal((await alice.get(`/api/projects/${id}/release`)).json.review.state, 'approved');
});

test('a viewer reads the review but cannot comment', async () => {
  assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'carol', role: 'viewer' })).status, 200);
  assert.equal((await carol.get(`/api/projects/${pid}/release`)).json.review.canComment, false);
  assert.equal((await carol.post(`/api/projects/${pid}/review/comments`, { body: 'hello' })).status, 403);
});

test('reference data for the wizard: every signed-in user reads what the Administrator maintains', async () => {
  const r = (await alice.get('/api/reference')).json;
  assert.ok(r.languages.some((l) => l.code === 'en'), 'English is available (the wizard selects it by default)');
  assert.ok(r.countries.some((c) => c.code === 'IN'), 'India is available (selected by default)');
  assert.equal(r.dmTypes.length, 21);
  for (const k of ['security', 'rpc', 'originators']) assert.ok(Array.isArray(r[k]), k);
  for (const k of ['infoCodes', 'sns', 'applicability']) assert.equal(r[k], undefined, `${k} is per project now (/api/projects/:id/s1000d)`);
  // what the Administrator adds shows up for everyone
  const made = await admin.post('/api/admin/config/language-codes', { code: 'nb', name: 'Norwegian' });
  assert.ok((await carol.get('/api/reference')).json.languages.some((l) => l.code === 'nb'));
  await admin.del(`/api/admin/config/language-codes/${made.json.item.id}`);
  assert.equal((await new h.Client('anon').get('/api/reference')).status, 401);
});

test('CIR: a shared workspace - everyone adds and edits, only a Project Manager or administrator deletes, and a module is copied into a project', async () => {
  // an Author adds (not only managers and administrators)
  const added = await carol.req('POST', '/api/cir', form([[DM, h.sample(DM)]], { note: 'standard pump description' }));
  assert.equal(added.status, 201, JSON.stringify(added.json));
  const entry = added.json.added[0];
  assert.equal(entry.file, DM);
  assert.equal(entry.addedByName, 'Carol Author');

  // everyone sees it, including other roles; the workspace id is handed out for the editor
  let ws = '';
  for (const c of [alice, pm, admin]) { const l = (await c.get('/api/cir')).json; assert.equal(l.modules.length, 1); ws = l.workspace; }
  assert.match((await alice.get(`/api/cir/${entry.id}`)).json.xml, /<dmodule/);

  // the workspace is a system project: not in anyone's project list, not renamed, copied, deleted, released or built
  for (const c of [alice, carol, pm]) assert.ok(!(await c.get('/api/projects')).json.projects.some((p) => p.id === ws), 'hidden from the project list');
  assert.ok(!(await admin.get('/api/projects')).json.projects.some((p) => p.id === ws));
  assert.equal((await alice.get(`/api/projects/${ws}/summary`)).json.project.type, 'CIR');
  assert.equal((await admin.patch(`/api/projects/${ws}`, { name: 'Renamed' })).status, 403);
  assert.equal((await admin.del(`/api/projects/${ws}?confirm=${encodeURIComponent('Common Information Repository')}`)).status, 403);
  assert.equal((await alice.post(`/api/projects/${ws}/copy`, {})).status, 403);
  assert.equal((await alice.post(`/api/projects/${ws}/release`, {})).status, 403);
  assert.equal((await alice.post(`/api/projects/${ws}/publish`, {})).status, 403);

  // the editor works in it: an Author creates a module there, and its DMC is unique
  const fresh = h.sample(DM).replace(/assyCode="00"/, 'assyCode="77"');
  assert.equal((await alice.post(`/api/projects/${ws}/dms`, { file: 'DMC-S1KSTUDIO-A-29-10-77-00A-040A-D_001-00_EN-US.XML', xml: fresh })).status, 201);
  const clash = await alice.post(`/api/projects/${ws}/dms`, { file: 'DMC-S1KSTUDIO-A-29-10-77-00A-040A-D_001-00_EN-US-COPY.XML', xml: fresh });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.code, 'DUPLICATE_DMC', 'one data module per code, issue and language in the repository');
  const l2 = (await carol.get('/api/cir')).json.modules;
  assert.equal(l2.length, 2);
  assert.equal(l2.find((m) => m.file.includes('-77-')).addedByName, 'Alice Author', 'created in the editor: attributed to its author');

  // everyone may EDIT: another author saves a change, and replaces by upload
  const got = await carol.get(`/api/projects/${ws}/dms/${DM}`);
  assert.equal((await alice.put(`/api/projects/${ws}/dms/${DM}`, { xml: got.json.xml.replace('Hydraulic pump', 'Hydraulic pump (edited)'), baseHash: got.json.hash })).status, 200);
  assert.equal((await alice.req('POST', '/api/cir', form([[DM, h.sample(DM)]]))).status, 201, 'an upload replaces it');

  // only a Project Manager or an administrator may DELETE - not even the Author who added it
  assert.equal((await alice.del(`/api/cir/${encodeURIComponent(DM)}`)).status, 403);
  assert.equal((await carol.del(`/api/cir/${encodeURIComponent(DM)}`)).status, 403);
  const viaEditor = await carol.del(`/api/projects/${ws}/dms/${DM}`);
  assert.equal(viaEditor.status, 403);
  assert.equal(viaEditor.json.code, 'CIR_DELETE_ROLE');

  // junk is refused
  const junk = await carol.req('POST', '/api/cir', form([['DMC-BROKEN-A.xml', '<dmodule><oops></dmodule>']]));
  assert.equal(junk.status, 400);
  assert.equal((await carol.req('POST', '/api/cir', form([['notes.txt', 'hello']]))).status, 400);

  // reuse: copy into a project the user can edit; the project then owns its own copy
  const mine = (await carol.post('/api/projects', { name: 'Carol Book' })).json.project.id;
  assert.equal((await carol.post(`/api/cir/${encodeURIComponent(DM)}/copy`, { projectId: mine })).status, 200);
  assert.equal((await carol.get(`/api/projects/${mine}/dms`)).json.dms[0].file, DM);
  assert.equal((await carol.post(`/api/cir/${encodeURIComponent(DM)}/copy`, { projectId: mine })).status, 409, 'once per project');
  assert.equal((await carol.post(`/api/cir/${encodeURIComponent(DM)}/copy`, { projectId: pid })).status, 404, 'a project the user cannot edit is not reachable');
  assert.equal((await carol.post(`/api/cir/${encodeURIComponent(DM)}/copy`, {})).status, 400);

  assert.equal((await pm.del(`/api/cir/${encodeURIComponent(DM)}`)).status, 200);
  assert.equal((await admin.del(`/api/cir/${encodeURIComponent('DMC-S1KSTUDIO-A-29-10-77-00A-040A-D_001-00_EN-US.XML')}`)).status, 200);
  assert.equal((await alice.get('/api/cir')).json.modules.length, 0);
  const backup = await admin.get('/api/backup');
  assert.equal(backup.status, 200);
});

test('CIR additions are held to the enterprise check too', async () => {
  await admin.post('/api/admin/config/rpc-cages', { cage: 'ONLY1', name: 'Only Co', role: 'RPC' });
  const r = await carol.req('POST', '/api/cir', form([[DM, h.sample(DM)]]));
  assert.equal(r.status, 400);
  assert.ok(r.json.problems.some((p) => /enterprise code “S1K01” is not registered/.test(p)));
  for (const it of (await admin.get('/api/admin/config/rpc-cages')).json.items) await admin.del(`/api/admin/config/rpc-cages/${it.id}`);
});

test('graphics: ICN artwork and symbols per project, listed with what uses them', async () => {
  const svg = fs.readFileSync(path.join(h.SAMPLES, ICN), 'utf8');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = (files, extra) => alice.req('POST', `/api/projects/${pid}/graphics`, (() => { const fd = new FormData(); for (const [n, b, t] of files) fd.append('files', new Blob([b], { type: t }), n); for (const [k, v] of Object.entries(extra || {})) fd.append(k, v); return fd; })());

  // an ICN must carry an ICN name; a symbol must not
  let r = await up([['logo.svg', svg, 'image/svg+xml']], { kind: 'icn' });
  assert.equal(r.status, 400);
  assert.match(r.json.problems[0], /must be named ICN-/);
  r = await up([[ICN, svg, 'image/svg+xml']], { kind: 'symbol' });
  assert.equal(r.status, 400);
  assert.equal((await up([['notes.txt', 'x', 'text/plain']])).status, 400, 'only images');

  r = await up([[ICN, svg, 'image/svg+xml'], ['high-voltage.png', png, 'image/png']]);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const list = (await alice.get(`/api/projects/${pid}/graphics`)).json.graphics;
  const icn = list.find((g) => g.name === ICN);
  const sym = list.find((g) => g.name === 'high-voltage.png');
  assert.equal(icn.kind, 'icn');
  assert.equal(icn.dir, 'csdb', 'ICN artwork sits beside the data modules, where the entity resolves');
  assert.equal(sym.kind, 'symbol');
  assert.equal(sym.dir, 'Media');
  assert.ok(icn.usedBy.includes(DM), 'the sample data module refers to it');
  assert.deepEqual(sym.usedBy, []);

  // a graphic in use is not deleted by accident; an unused one is
  const blocked = await alice.del(`/api/projects/${pid}/graphics/${ICN}`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'GRAPHIC_IN_USE');
  assert.equal((await alice.del(`/api/projects/${pid}/graphics/high-voltage.png`)).status, 200);
  assert.equal((await alice.del(`/api/projects/${pid}/graphics/high-voltage.png`)).status, 404);

  // the main list covers the projects the user can open, and no one else's; each project lists only its own graphics
  const carolsOwn = (await carol.get('/api/projects')).json.projects.find((p) => p.name === 'Carol Book').id;
  const aliceSees = (await alice.get('/api/graphics')).json.projects;
  assert.ok(aliceSees.some((p) => p.id === pid));
  assert.ok(!aliceSees.some((p) => p.id === carolsOwn), "another author's project is not listed");
  assert.deepEqual(aliceSees.find((p) => p.id === pid).graphics.map((g) => g.name).sort(), [ICN]);
  assert.deepEqual((await alice.get(`/api/projects/${carolsOwn}/graphics`)).status, 404, "and cannot be reached directly");
  assert.equal((await carol.get(`/api/projects/${pid}/graphics`)).status, 200, 'carol was given view access earlier');
  assert.equal((await carol.req('POST', `/api/projects/${pid}/graphics`, (() => { const fd = new FormData(); fd.append('files', new Blob([png]), 'x.png'); return fd; })())).status, 403, 'a viewer cannot add graphics');
});

test('the S1000D issue chosen on the Validation page drives the schema check, the default BREX and the build gate', async () => {
  const before = (await alice.get(`/api/projects/${pid}/validation`)).json;
  assert.equal(before.issue, 'auto');
  assert.equal((await alice.put(`/api/projects/${pid}/validation/issue`, { issue: '9.9' })).status, 400, 'an uninstalled issue is refused');
  assert.ok([403, 404].includes((await carol.put(`/api/projects/${pid}/validation/issue`, { issue: '7.0' })).status), 'someone without edit rights cannot change it (403 for a viewer, 404 for no access)');

  assert.equal((await alice.put(`/api/projects/${pid}/validation/issue`, { issue: '4.2' })).json.issue, '4.2');
  assert.equal((await alice.get(`/api/projects/${pid}/validation`)).json.issue, '4.2', 'saved with the project');
  let run = (await alice.post(`/api/projects/${pid}/validation`, {})).json.run;      // no issue in the request: the saved one is used
  assert.equal(run.issueUsed, '4.2');

  // a module that names the issue-6 default BREX is judged by the chosen issue's default instead
  const dm = h.sample(DM).replace(/(<brexDmRef>[\s\S]*?systemDiffCode=")[A-Z]/, '$1H');
  assert.equal((await alice.put(`/api/projects/${pid}/dms/${DM}`, { xml: dm })).status, 200);
  const { checkModuleBrex } = require('../dist/services/brex');
  const rep = (iss) => checkModuleBrex(dm, undefined, iss);
  assert.match(rep('4.2').result.brexSource ?? '', /4\.2/);
  assert.match(rep('7.0').result.brexSource ?? '', /issue 7\b/);
  assert.match(rep('4.1').notes.join(' '), /no default BREX is bundled for that issue/);

  // a project settings save must not wipe the choice
  const cur = (await alice.get(`/api/projects/${pid}/settings`)).json;
  assert.equal((await alice.put(`/api/projects/${pid}/settings`, { project: cur.project })).status, 200);
  assert.equal((await alice.get(`/api/projects/${pid}/validation`)).json.issue, '4.2');
  assert.equal((await alice.put(`/api/projects/${pid}/validation/issue`, { issue: 'auto' })).json.issue, 'auto');
});
