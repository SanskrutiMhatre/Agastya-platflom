'use strict';
// SNS over HTTP: the project's SNS (CRUD, validation, duplicates), titles, BREX import, learning, structure derivation
// written to the publication module, the organisation defaults, and who may do what.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, tmp } = require('./helpers');
const pmc = require('../vendor/engine/pmc');
const { validateProjectSchema } = require('../vendor/engine/validateSchema');

const PW = 'Correct-Horse-9!';
const FIX = path.join(__dirname, 'fixtures', 'sns');

let h; let admin; let alice; let bob; let carol; let pid;

async function person(role, username) {
  const made = await admin.post('/api/team/users', { username, fullName: `${username} person`, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username);
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}

const put = (c, p, body) => c.post(`/api/projects/${pid}/dms`, body ?? {});
const loadFixture = async (client, dir) => {
  for (const f of fs.readdirSync(path.join(FIX, dir))) {
    const r = await client.post(`/api/projects/${pid}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, dir, f), 'utf8') });
    assert.equal(r.status, 201, `${f}: ${JSON.stringify(r.json)}`);
  }
};
const row = (over) => ({ systemCode: '32', title: 'Landing gear', ...over });
const sns = (c = alice) => c.get(`/api/projects/${pid}/sns-rows`);

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  alice = await person('author', 'alice');
  bob = await person('author', 'bobby');
  carol = await person('author', 'carol');
  pid = (await alice.post('/api/projects', { name: 'SNS test' })).json.project.id;
  assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'carol', role: 'viewer' })).status, 200);
});
test.after(async () => { await h.close(); });

test('who may read and change the SNS', async () => {
  const anon = new h.Client('anon');
  assert.equal((await anon.get(`/api/projects/${pid}/sns-rows`)).status, 401);
  assert.equal((await anon.get('/api/sns/defaults')).status, 401);
  assert.equal((await bob.get(`/api/projects/${pid}/sns-rows`)).status, 404, 'a person not on the project sees nothing of it');
  assert.equal((await carol.get(`/api/projects/${pid}/sns-rows`)).status, 200, 'a viewer reads');
  assert.equal((await carol.post(`/api/projects/${pid}/sns-rows`, row())).status, 403, 'a viewer cannot write');
  assert.equal((await carol.post(`/api/projects/${pid}/sns-rows/derive`, {})).status, 403);
  assert.equal((await carol.post(`/api/projects/${pid}/sns-rows/learn`, {})).status, 403);
  assert.equal((await alice.post(`/api/projects/${pid}/sns-rows`, row())).status, 201, 'an editor (the owner) writes');
  assert.equal((await alice.del(`/api/projects/${pid}/sns-rows/${(await sns()).json.rows[0].id}`)).status, 200);
  assert.deepEqual((await sns()).json.rows, []);
});

test('create, read, update and delete rows; invalid codes and duplicates are refused with a reason', async () => {
  const base = `/api/projects/${pid}/sns-rows`;
  const made = await alice.post(base, row());
  assert.equal(made.status, 201);
  assert.equal(made.json.row.systemCode, '32');
  assert.match(made.json.row.id, /\S+/);

  // invalid: 400 with every error
  for (const [body, re] of [
    [row({ systemCode: '3' }), /System code/],
    [row({ subSystemCode: '12' }), /Sub-system code/],
    [row({ subSystemCode: '1', subSubSystemCode: '0', assyCode: '100' }), /Assembly code[\s\S]*2 or 4/],
    [row({ title: '' }), /title is required/i],
    [row({ systemDiffCode: 'ABCDE' }), /difference code/i],
  ]) {
    const r = await alice.post(base, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.code, 'SNS_INVALID');
    assert.match(r.json.errors.join(' '), re);
  }
  const multi = await alice.post(base, { systemCode: '3', subSystemCode: '12', title: '' });
  assert.ok(multi.json.errors.length >= 3, 'every problem is listed');

  // duplicate: 409, and what is there stays
  const dup = await alice.post(base, row({ title: 'Undercarriage' }));
  assert.equal(dup.status, 409);
  assert.equal(dup.json.code, 'SNS_DUPLICATE');
  assert.equal(dup.json.existing.title, 'Landing gear');

  // the same code under a difference code is a different node
  assert.equal((await alice.post(base, row({ systemDiffCode: 'B', title: 'Landing gear B' }))).status, 201);

  // children, then update / delete rules
  const sub = (await alice.post(base, row({ subSystemCode: '1', title: 'Main gear and doors' }))).json.row;
  const asy = (await alice.post(base, row({ subSystemCode: '1', subSubSystemCode: '0', assyCode: '10', title: 'Shock strut' }))).json;
  assert.ok(asy.warnings.some((w) => /no parent/.test(w)), 'a missing parent is a warning, not a refusal');

  const list = (await sns()).json;
  assert.equal(list.rows.length, 4);
  assert.ok(list.tree.length >= 2, 'the nested tree is returned');
  assert.ok(list.problems.some((p) => p.code === 'ORPHAN'), 'the orphan shows in the problems');
  assert.match(list.rules.codes.assyCode, /2 or 4/);

  const renamed = await alice.put(`${base}/${made.json.row.id}`, { title: 'Landing gear system' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.row.title, 'Landing gear system');
  assert.equal((await alice.put(`${base}/${made.json.row.id}`, { systemCode: '3' })).status, 400);
  assert.equal((await alice.put(`${base}/nope`, { title: 'x' })).status, 404);
  const clash = await alice.put(`${base}/${sub.id}`, { subSystemCode: '' });
  assert.equal(clash.status, 409, 'a sub-system turned into a second "32" is a duplicate');

  const move = await alice.put(`${base}/${made.json.row.id}`, { systemCode: '33' });
  assert.equal(move.status, 409);
  assert.equal(move.json.code, 'SNS_HAS_CHILDREN', 'children would be left behind');
  const moved = await alice.put(`${base}/${made.json.row.id}?cascade=1`, { systemCode: '33' });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.changedChildren, 2, 'the sub-system and the assembly follow');
  const after = (await sns()).json.rows;
  assert.deepEqual(after.filter((r) => r.systemDiffCode === '').map((r) => r.systemCode).sort(), ['33', '33', '33']);
  assert.equal(after.filter((r) => r.systemDiffCode === 'B')[0].systemCode, '32', 'another difference code is its own node and did not move');

  assert.equal((await alice.del(`${base}/${made.json.row.id}`)).status, 409, 'deleting a parent needs cascade');
  const del = await alice.del(`${base}/${made.json.row.id}?cascade=1`);
  assert.equal(del.json.removed, 3);
  assert.equal((await alice.del(`${base}/${made.json.row.id}`)).status, 404);
  assert.deepEqual((await sns()).json.rows.map((r) => r.systemDiffCode), ['B']);
  await alice.del(`${base}/${(await sns()).json.rows[0].id}`);
});

test('import from the BREX, add the new, report what differs, overwrite only when asked', async () => {
  await loadFixture(alice, 'brex');
  const base = `/api/projects/${pid}/sns-rows`;
  const preview = await alice.post(`${base}/import-brex`, {});
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.applied, false);
  assert.equal(preview.json.counts.added, 6);
  assert.equal(preview.json.sources.length, 1);
  assert.equal((await sns()).json.rows.length, 0, 'a preview writes nothing');

  const applied = await alice.post(`${base}/import-brex`, { apply: true });
  assert.equal(applied.json.counts.added, 6);
  assert.deepEqual((await sns()).json.rows.map((r) => r.title).sort(), ['Hydraulic power', 'Landing gear', 'Main gear', 'Main gear and doors', 'Nose gear and doors', 'Shock strut']);
  assert.equal((await sns()).json.problems.length, 0);

  const again = await alice.post(`${base}/import-brex`, { apply: true });
  assert.equal(again.json.counts.added, 0);
  assert.equal(again.json.counts.same, 6);

  // an author's own title is never replaced silently
  const gear = (await sns()).json.rows.find((r) => r.systemCode === '32' && !r.subSystemCode);
  await alice.put(`${base}/${gear.id}`, { title: 'Undercarriage (our name)' });
  const diff = await alice.post(`${base}/import-brex`, { apply: true });
  assert.equal(diff.json.counts.conflicts, 1);
  assert.equal(diff.json.conflicts[0].existing, 'Undercarriage (our name)');
  assert.equal(diff.json.conflicts[0].incoming, 'Landing gear');
  assert.equal(diff.json.conflicts[0].overwritten, false);
  assert.equal((await sns()).json.rows.find((r) => r.id === gear.id).title, 'Undercarriage (our name)');
  const forced = await alice.post(`${base}/import-brex`, { apply: true, overwrite: true });
  assert.equal(forced.json.conflicts[0].overwritten, true);
  assert.equal((await sns()).json.rows.find((r) => r.id === gear.id).title, 'Landing gear');
});

test('title lookup by code, level and difference code', async () => {
  const q = (s) => alice.get(`/api/projects/${pid}/sns-rows/title?${s}`);
  assert.equal((await q('code=DMC-SNSTEST-A-32-10-10-00A-520A-D')).json.title, 'Shock strut');
  assert.equal((await q('code=DMC-SNSTEST-A-32-10-10-00A-520A-D&level=system')).json.title, 'Landing gear');
  assert.equal((await q('code=DMC-SNSTEST-A-32-10-10-00A-520A-D&level=subsystem')).json.title, 'Main gear and doors');
  assert.equal((await q('systemCode=29')).json.title, 'Hydraulic power');
  assert.equal((await q('code=DMC-SNSTEST-A-99-00-00-00A-040A-D')).json.title, null);
  assert.equal((await q('code=DMC-SNSTEST-A-32-10-10-00A-520A-D&level=bogus')).status, 400);
  assert.equal((await q('foo=1')).status, 400);
});

test('learn from the data modules: proposals first, nothing written until the caller accepts', async () => {
  await loadFixture(alice, 'dms');
  const base = `/api/projects/${pid}/sns-rows`;
  const before = (await sns()).json.rows.length;
  const preview = await alice.post(`${base}/learn`, {});
  assert.equal(preview.status, 200);
  assert.equal(preview.json.applied, null);
  const byKey = new Map(preview.json.proposals.map((p) => [p.key, p]));
  const gear = preview.json.proposals.find((p) => p.level === 'system' && p.row.systemCode === '32');
  assert.equal(gear.status, 'exists', 'the BREX already named it');
  const sub5 = preview.json.proposals.find((p) => p.row.systemCode === '32' && p.row.subSystemCode === '5');
  assert.equal(sub5.status, 'new');
  // the BREX (information code 022) is in the project too: it supports the publication and proposes no node of the product
  assert.ok(!preview.json.proposals.some((p) => p.row.systemCode === '00'), 'a BREX data module proposes nothing');
  assert.equal(sub5.row.title, 'Landing gear indicating');
  assert.ok(sub5.confidence > 0 && sub5.confidence <= 1 && sub5.basis);
  assert.equal((await sns()).json.rows.length, before, 'a preview writes nothing');

  assert.equal((await alice.post(`${base}/learn`, { apply: true })).status, 400, 'apply needs an explicit accept');
  assert.equal((await alice.post(`${base}/learn`, { apply: true })).json.code, 'ACCEPT_REQUIRED');

  const one = await alice.post(`${base}/learn`, { apply: true, accept: [sub5.key] });
  assert.equal(one.json.applied.counts.added, 1);
  assert.equal((await sns()).json.rows.length, before + 1);
  assert.ok(byKey.size > 0);

  // a conflicting proposal is never applied, even with acceptAll
  const gearRow = (await sns()).json.rows.find((r) => r.systemCode === '32' && !r.subSystemCode && !r.systemDiffCode);
  await alice.put(`${base}/${gearRow.id}`, { title: 'Undercarriage (our name)' });
  const all = await alice.post(`${base}/learn`, { apply: true, acceptAll: true });
  assert.equal((await sns()).json.rows.find((r) => r.id === gearRow.id).title, 'Undercarriage (our name)');
  assert.ok(all.json.proposals.find((p) => p.row.systemCode === '32' && !p.row.subSystemCode).status === 'conflict');
  await alice.put(`${base}/${gearRow.id}`, { title: 'Landing gear' });
});

test('derive: preview, then apply writes the publication module (kept as .bak), valid and complete', async () => {
  const base = `/api/projects/${pid}/sns-rows`;
  // the learning test accepted every proposal; take back the rows for system 99, 29-1 and 32-5 so that some modules have no home again
  const learned = (await sns()).json.rows;
  for (const r of learned.filter((x) => (x.systemCode === '99') || (x.systemCode === '29' && x.subSystemCode === '1') || (x.systemCode === '32' && x.subSystemCode === '5'))) await alice.del(`${base}/${r.id}?cascade=1`);
  const rows = (await sns()).json.rows;
  // (seven before learning stopped proposing a node from the BREX: the "00 - Fixture project" row was one of them)
  assert.ok(rows.length >= 6);

  const prev = await alice.post(`${base}/derive`, {});
  assert.equal(prev.status, 200, JSON.stringify(prev.json).slice(0, 400));
  assert.equal(prev.json.applied, false);
  assert.equal(prev.json.structure.counts.dms, 15, '16 modules, one older issue');
  assert.equal(prev.json.structure.counts.superseded, 1);
  assert.equal(prev.json.structure.roots[0].level, 'system');
  assert.equal(prev.json.pm.xml, undefined, 'the XML is only returned when asked for');
  assert.ok(prev.json.pm.entries > 15);

  // preview wrote nothing
  const hadPm = (await alice.get(`/api/projects/${pid}/pmc`)).status === 200;

  const ap = await alice.post(`${base}/derive`, { apply: true, includeXml: true });
  assert.equal(ap.status, 200);
  assert.equal(ap.json.applied, true);
  assert.equal(ap.json.counts.dms, 15);
  assert.equal(ap.json.pm.headerFrom, hadPm ? 'existing' : 'generated');
  const pmView = (await alice.get(`/api/projects/${pid}/pmc`)).json;
  assert.equal(pmView.counts.dms, 15);
  assert.equal(pmView.pool.length, 1, 'only the superseded older issue is left unplaced');
  assert.match(pmView.pool[0].file, /_001-00_/);
  const titles = [];
  (function walk(list) { for (const e of list) if (e.type === 'folder') { titles.push(e.title); walk(e.children); } })(pmView.entries);
  assert.ok(titles.includes('Shock strut') && titles.includes('Unclassified'), titles.join(', '));

  // the project's own header is kept (it declares no schema, so the whole file is only checked for parsing here; a generated header is validated below)
  const exported = await alice.get(`/api/projects/${pid}/pmc/export`);
  assert.equal(pmc.countEntries(pmc.parsePm(exported.buf.toString('utf8')).entries).dms, 15);

  // applying again: the header the author has is kept, the previous file is the .bak
  const header = /<pmTitle>([^<]*)<\/pmTitle>/.exec(exported.buf.toString('utf8'))[1];
  const again = await alice.post(`${base}/derive`, { apply: true, includeXml: true });
  assert.equal(again.json.pm.headerFrom, 'existing');
  assert.match(again.json.backup, /\.bak$/);
  assert.match(again.json.pm.xml, new RegExp(`<pmTitle>${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</pmTitle>`));
  assert.equal(JSON.stringify(again.json.structure), JSON.stringify(ap.json.structure), 'deterministic');

  // options: code-title format, strict unclassified, placement of only the unplaced
  const coded = await alice.post(`${base}/derive`, { titleFormat: 'code-title', unmatched: 'unclassified', includeXml: true });
  assert.match(coded.json.pm.xml, /32 - Landing gear/);
  assert.ok(coded.json.structure.counts.unclassified >= 2, 'the 29-1 and 32-5 modules have no defined sub-level');
  const unplaced = await alice.post(`${base}/derive`, { placement: 'unplaced' });
  assert.equal(unplaced.json.structure.counts.dms, 0, 'everything is already placed');
  assert.match(unplaced.json.hints.join(' '), /already placed/);
});

test('derive into a project with no publication module writes a header that is valid S1000D 4.2', async () => {
  const fresh = (await alice.post('/api/projects', { name: 'Fresh header' })).json.project.id;
  for (const f of fs.readdirSync(path.join(FIX, 'dms'))) {
    assert.equal((await alice.post(`/api/projects/${fresh}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, 'dms', f), 'utf8') })).status, 201);
  }
  assert.equal((await alice.post(`/api/projects/${fresh}/sns-rows/import-defaults`, { apply: true })).status, 200);
  for (const r of [{ systemCode: '32', title: 'Landing gear' }, { systemCode: '29', title: 'Hydraulic power' }]) {
    await alice.post(`/api/projects/${fresh}/sns-rows`, r);
  }
  fs.rmSync(path.join(h.ws, 'projects', fresh, 'publication.xml'));
  assert.equal((await alice.get(`/api/projects/${fresh}/pmc`)).status, 400, 'no publication module yet');

  const ap = await alice.post(`/api/projects/${fresh}/sns-rows/derive`, { apply: true, pmTitle: 'Landing gear manual' });
  assert.equal(ap.status, 200, JSON.stringify(ap.json).slice(0, 300));
  assert.equal(ap.json.pm.headerFrom, 'generated');
  assert.equal(ap.json.backup, null, 'there was nothing to back up');
  const out = await alice.get(`/api/projects/${fresh}/pmc/export`);
  const dir = tmp('sns-http-');
  try {
    fs.writeFileSync(path.join(dir, 'pm.xml'), out.buf);
    const v = await validateProjectSchema(dir, ['pm.xml']);
    assert.equal(v.checked, 1, 'the generated header declares its schema');
    assert.deepEqual(v.issues, [], JSON.stringify(v.issues.slice(0, 3)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const text = out.buf.toString('utf8');
  assert.ok(text.includes('<pmTitle>Landing gear manual</pmTitle>'));
  assert.match(text, /modelIdentCode="SNSTEST"/, 'the model code is the one the modules carry');
  assert.equal((await alice.get(`/api/projects/${fresh}/pmc`)).json.counts.dms, 15);
});

test('derive refuses to replace the publication with an empty one', async () => {
  const empty = (await alice.post('/api/projects', { name: 'No modules yet' })).json.project.id;
  const r = await alice.post(`/api/projects/${empty}/sns-rows/derive`, { apply: true });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'EMPTY_PM');
  const prev = await alice.post(`/api/projects/${empty}/sns-rows/derive`, {});
  assert.equal(prev.status, 200, 'a preview of nothing is fine');
  assert.match(prev.json.hints.join(' '), /no SNS rows|no data modules/);
  // placing only what is not yet placed, when everything is: a no-op, not an error
  const noop = await alice.post(`/api/projects/${pid}/sns-rows/derive`, { apply: true, placement: 'unplaced' });
  assert.equal(noop.status, 200);
  assert.equal(noop.json.structure.counts.dms, 0);
});

test('ordering overrides are kept per project and used by derive', async () => {
  const base = `/api/projects/${pid}/sns-rows`;
  const info = (await alice.get(`${base}/ordering`)).json;
  assert.equal(info.groups.length, 10);
  assert.equal(info.groups[0].id, '0xx');
  assert.deepEqual(info.keys.slice(0, 2), ['sns', 'info']);
  assert.equal(info.override, null);
  assert.equal((await carol.put(`${base}/ordering`, { order: { pinFirst: ['720'] } })).status, 403);
  assert.equal((await alice.put(`${base}/ordering`, { order: 'nope' })).status, 400);
  // a malformed ordering is refused with BAD_ORDER and never stored: an unknown sort key used to be saved and made every later derive fail
  for (const badOrder of [{ keys: ['sns', 'bogus'] }, { keys: ['sns', 'sns'] }, { keys: 'sns' }, { pinFirst: [720] }, { pinLast: 'a' }, { rank: { '018': 'first' } }, { groups: [{ id: 'x' }] }]) {
    const r = await alice.put(`${base}/ordering`, { order: badOrder });
    assert.equal(r.status, 400, JSON.stringify(badOrder));
    assert.equal(r.json.code, 'BAD_ORDER', JSON.stringify(badOrder));
  }
  assert.equal((await alice.get(`${base}/ordering`)).json.override, null, 'nothing refused was stored');
  assert.equal((await alice.post(`${base}/derive`, { order: { keys: ['nope'] } })).status, 400, 'derive refuses the same ordering');
  assert.deepEqual((await alice.put(`${base}/ordering`, { order: { pinFirst: ['720'] } })).json.override, { pinFirst: ['720'] });
  const st = (await alice.post(`${base}/derive`, {})).json.structure;
  const strut = (function find(list) { for (const n of list) { if (n.kind === 'module') { if (n.title === 'Shock strut') return n; const f = find(n.children); if (f) return f; } } return null; })(st.roots);
  assert.equal(strut.children[0].infoCode, '720', 'the saved override is applied');
  assert.equal((await alice.put(`${base}/ordering`, {})).json.override, null);
});

test('organisation defaults: everyone reads, only an administrator writes; a project can import them', async () => {
  const list = await alice.get('/api/sns/defaults');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.rows));
  assert.equal(list.json.infoCodeGroups.length, 10);
  const seeded = list.json.rows.length;
  // the Administrator's older SNS table (which used to seed these once, with demo rows) is gone: a new installation starts with none, and an upgraded one
  // brings only what an administrator had typed there (system-level entries)
  assert.ok(list.json.rows.every((r) => r.systemCode && r.title && r.subSystemCode === ''), 'any row carried over from the older table is a system-level entry');

  assert.equal((await alice.post('/api/sns/defaults', row({ systemCode: '71', title: 'Power plant' }))).status, 403);
  const made = await admin.post('/api/sns/defaults', row({ systemCode: '71', title: 'Power plant' }));
  assert.equal(made.status, 201);
  assert.equal((await admin.post('/api/sns/defaults', row({ systemCode: '71', title: 'Engine' }))).status, 409);
  assert.equal((await admin.post('/api/sns/defaults', row({ systemCode: '7' }))).status, 400);
  assert.equal((await admin.post('/api/sns/defaults', row({ systemCode: '71', subSystemCode: '1', subSubSystemCode: '0', assyCode: '10', title: 'Compressor' }))).status, 201);
  assert.equal((await alice.put(`/api/sns/defaults/${made.json.row.id}`, { title: 'x' })).status, 403);
  assert.equal((await alice.del(`/api/sns/defaults/${made.json.row.id}`)).status, 403);
  assert.equal((await admin.put(`/api/sns/defaults/${made.json.row.id}`, { title: 'Powerplant' })).json.row.title, 'Powerplant');
  assert.equal((await alice.get('/api/sns/defaults')).json.rows.length, seeded + 2);

  // into the project: added, nothing replaced
  const prev = await alice.post(`/api/projects/${pid}/sns-rows/import-defaults`, {});
  assert.equal(prev.json.applied, false);
  assert.ok(prev.json.counts.added >= 2);
  const before = (await sns()).json.rows.length;
  assert.equal((await alice.post(`/api/projects/${pid}/sns-rows/import-defaults`, { apply: true })).json.applied, true);
  const rows = (await sns()).json.rows;
  assert.ok(rows.length >= before + 2);
  assert.ok(rows.some((r) => r.systemCode === '71' && r.title === 'Powerplant'));
  const second = await alice.post(`/api/projects/${pid}/sns-rows/import-defaults`, { apply: true });
  assert.equal(second.json.counts.added, 0, 'nothing twice');

  // deriving from the defaults instead of the project's own rows
  const fromDefaults = await alice.post(`/api/projects/${pid}/sns-rows/derive`, { sns: 'defaults' });
  assert.equal(fromDefaults.json.snsRows, seeded + 2);
  const merged = await alice.post(`/api/projects/${pid}/sns-rows/derive`, { sns: 'merged' });
  assert.ok(merged.json.snsRows >= rows.length);

  // deleting a default with children needs cascade
  assert.equal((await admin.del(`/api/sns/defaults/${made.json.row.id}`)).status, 409);
  assert.equal((await admin.del(`/api/sns/defaults/${made.json.row.id}?cascade=1`)).json.removed, 2);
});
