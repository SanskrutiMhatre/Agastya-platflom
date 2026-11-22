'use strict';
// The importer over HTTP, on the real app: roles, scan (writes nothing), apply (repaired modules, graphics, publication,
// originals kept, change log), the unassigned pool and assignment. Boot harness as in import.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dm, dmFile, pmc, table, makeZip } = require('./fixtures/importer/make');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const pm = (n) => ({ modelIdentCode: 'TST', pmIssuer: '1671Y', pmNumber: n, pmVolume: '00' });
const ICN = 'ICN-TST-A-000000-A-00001-00001-A-001-01';

let h; let admin; let alice; let carol; let bob; let pid;
const P = (suffix) => `/api/projects/${pid}${suffix}`;

/** A Vektra-like package: a wide table over a narrow `cols`, a graphic that is not shipped, a foreign BREX, a template publication, an orphan. */
function defective() {
  const A = 'TST-A-10-00-00-00A-040A-D';
  const B = 'TST-A-10-00-00-00A-520A-A';
  const C = 'TST-A-20-00-00-00A-040A-D';
  const O = 'TST-A-90-00-00-00A-040A-D';
  return {
    codes: { A, B, C, O },
    files: [
      [dmFile(A), dm({ dmc: A, tech: 'Pump', info: 'Description', brex: 'H', enterprise: 'TST01', entities: [{ name: ICN, target: `${ICN}.png` }], body: `${table(3, [8, 8])}<figure><title>F</title><graphic infoEntityIdent="${ICN}"/></figure>` })],
      [dmFile(B), dm({ dmc: B, tech: 'Pump', info: 'Removal', brex: 'H', enterprise: 'TST01' })],
      [dmFile(C), dm({ dmc: C, tech: 'Valve', info: 'Description', brex: 'H', enterprise: 'TST01' })],
      [dmFile(O), dm({ dmc: O, tech: 'Spare part', info: 'Description', enterprise: 'TST01' })],
      ['PMC-IETM.xml', pmc({ code: { modelIdentCode: 'MODEL', pmIssuer: '00000', pmNumber: '00001', pmVolume: '00' }, title: 'Publication Module', lang: 'en-US', entries: [{ folder: 'Hydraulics', children: [{ dm: A, tech: 'Old', info: 'Old' }, B] }, C] })],
    ],
  };
}
const form = (files, extra = {}) => {
  const fd = new FormData();
  for (const [name, content] of files) fd.append('files', new Blob([content]), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  return fd;
};
const as = (client, url, files, extra) => client.req('POST', url, form(files, extra));
const find = (dir, name) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.name === name) return p;
    if (e.isDirectory()) { const r = find(p, name); if (r) return r; }
  }
  return null;
};
const newProject = async (name) => (await alice.post('/api/projects', { name })).json.project.id;
const flat = (list, out = []) => { for (const e of list) { if (e.type === 'folder') flat(e.children, out); else out.push(e); } return out; };

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  const mk = async (username, fullName) => {
    const made = await admin.post('/api/team/users', { username, fullName, role: 'author' });
    const c = new h.Client(username);
    await c.post('/api/auth/login', { username, password: made.json.tempPassword });
    await c.post('/api/auth/onboarding', { username, password: PW });
    return c;
  };
  alice = await mk('alice', 'Alice Author');
  carol = await mk('carol', 'Carol Viewer');
  bob = await mk('bob', 'Bob Outsider');
  pid = await newProject('Importer test');
  assert.equal((await alice.post(P('/assign'), { username: 'carol', role: 'viewer' })).status, 200);
});
test.after(async () => { await h.close(); });

test('roles: the sign-in is required; a viewer may look at the pool but not scan, apply or assign; a stranger sees nothing', async () => {
  const anon = new h.Client('anon');
  assert.equal((await as(anon, P('/import/scan'), defective().files)).status, 401);
  assert.equal((await as(carol, P('/import/scan'), defective().files)).status, 403, 'a viewer cannot scan');
  assert.equal((await as(carol, P('/import/apply'), defective().files)).status, 403, 'nor apply');
  assert.equal((await carol.post(P('/import/assign'), { files: ['x'] })).status, 403, 'nor assign');
  assert.equal((await carol.get(P('/import/unassigned'))).status, 200, 'but a viewer may read the pool');
  assert.ok([403, 404].includes((await as(bob, P('/import/scan'), defective().files)).status), 'a non-member is refused');
  assert.ok([403, 404].includes((await bob.get(P('/import/unassigned'))).status));
  assert.equal((await as(alice, P('/import/scan'), defective().files)).status, 200, 'an Author may scan');
});

test('scan: a full report, and NOTHING is written (no module, no graphic, no publication, no state file)', async () => {
  const { files, codes } = defective();
  const r = await as(alice, P('/import/scan'), files);
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  const rep = r.json.report;
  assert.equal(rep.counts.dms, 4);
  assert.equal(rep.counts.pmcs, 1);
  assert.equal(rep.publications[0].placeholder, true);
  assert.equal(rep.unassigned.length, 1);
  assert.equal(rep.unassigned[0].dmc, codes.O);
  assert.equal(rep.graphics.missing.length, 1);
  assert.ok(rep.findings.some((f) => f.id === 'table-cols-overflow'));
  assert.ok(Array.isArray(r.json.rules) && r.json.rules.length === 6, 'the screen gets the switchable rules');
  assert.deepEqual(r.json.rules.map((x) => x.id).sort(), ['brex-remap', 'icn-placeholder', 'pmc-dmref-identity', 'pmc-reconstruct', 'pmc-titles', 'table-cols']);
  // the importer and the editor agree on every module's identity
  const scanned = rep.files.filter((f) => f.kind === 'dm').map((f) => f.dmc).sort();
  assert.deepEqual(scanned, Object.values(codes).sort());

  assert.equal((await alice.get(P('/dms'))).json.dms.length, 0);
  assert.equal((await alice.get(P('/media'))).json.media.length, 0);
  const pmBefore = await alice.get(P('/pmc'));
  assert.ok(pmBefore.status === 400 || pmBefore.json.counts.total === 0, 'no publication content was created');
  assert.equal(find(h.ws, 'import-originals'), null);
  assert.equal(find(h.ws, 'import-state.json'), null);
});

test('scan input: options are validated, an empty request is refused, a zip gives the same report as loose files', async () => {
  const { files } = defective();
  const bad = await as(alice, P('/import/scan'), files, { repairs: ['table-cols', 'make-coffee'] });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'UNKNOWN_RULE');
  assert.match(bad.json.error, /make-coffee/);
  assert.equal((await alice.req('POST', P('/import/scan'), new FormData())).status, 400);
  const loose = (await as(alice, P('/import/scan'), files)).json.report;
  const zip = makeZip(files.map(([name, xml]) => ({ name, bytes: Buffer.from(xml) })), { deflate: true });
  const z = await as(alice, P('/import/scan'), [['package.zip', zip]]);
  assert.equal(z.status, 200);
  assert.deepEqual(z.json.report.counts.dms, loose.counts.dms);
  assert.deepEqual(z.json.report.summary, loose.summary);
  const broken = await as(alice, P('/import/scan'), [['broken.zip', Buffer.from('PK\x03\x04 nope')]]);
  assert.equal(broken.status, 200);
  assert.ok(broken.json.report.findings.some((f) => f.id === 'package-load'), 'a damaged zip is a finding, not a 500');
});

test('apply: repaired modules, graphics (with a flagged placeholder), the rebuilt publication, the change log, and the originals kept', async () => {
  const { files, codes } = defective();
  const r = await as(alice, P('/import/apply'), files, { repairs: ['table-cols', 'icn-placeholder', 'brex-remap', 'pmc-reconstruct', 'pmc-titles', 'pmc-dmref-identity'] });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
  assert.equal(r.json.imported.dms.length, 4);
  assert.equal(r.json.publication.mode, 'replaced');
  assert.equal(r.json.publication.reconstructed, 'metadata');
  const rules = new Set(r.json.changeLog.filter((c) => c.kind !== 'note').map((c) => c.rule));
  for (const rule of ['table-cols', 'icn-placeholder', 'brex-remap', 'pmc-reconstruct', 'pmc-titles']) assert.ok(rules.has(rule), `${rule} in the change log`);
  assert.equal(r.json.placeholders.length, 1);

  const listed = (await alice.get(P('/dms'))).json.dms;
  assert.deepEqual(listed.map((d) => d.dmc).sort(), Object.values(codes).sort());
  const a = (await alice.get(P(`/dms/${dmFile(codes.A)}`))).json.xml;
  assert.match(a, /<tgroup cols="8">/, 'the repaired copy is what was stored');
  assert.match(a, /systemDiffCode="F" systemCode="04"/, 'BREX re-pointed to the 4.2 default');
  assert.doesNotMatch(a, /systemDiffCode="H"/);

  const media = (await alice.get(P('/media'))).json.media.map((m) => m.name);
  assert.ok(media.includes(`${ICN}.png`));
  const png = await alice.get(P(`/media/${ICN}.png`));
  assert.equal(png.status, 200);
  assert.ok(Buffer.from(png.buf).includes(Buffer.from('placeholder-for-missing-icn')), 'the placeholder says so inside the file');

  const book = (await alice.get(P('/pmc'))).json;
  assert.equal(book.meta.pmCode.modelIdentCode, 'TST', 'the template header was rebuilt from the modules');
  assert.equal(book.counts.dms, 3);
  assert.deepEqual(book.pool.map((d) => d.dmc), [codes.O], 'the orphan is in the pool, not in the book');

  // the originals of every changed file are kept, byte for byte, with the change log
  const orig = find(h.ws, 'import-originals');
  assert.ok(orig, 'import-originals/ exists in the project');
  const batch = fs.readdirSync(orig)[0];
  assert.ok(fs.existsSync(path.join(orig, batch, 'change-log.json')));
  assert.equal(fs.readFileSync(path.join(orig, batch, dmFile(codes.A)), 'utf8'), files[0][1], 'the original of the repaired module');
  assert.ok(fs.existsSync(path.join(orig, batch, 'PMC-IETM.xml')));
  assert.ok(!fs.existsSync(path.join(orig, batch, dmFile(codes.O))), 'an untouched module is not duplicated');
  const state = JSON.parse(fs.readFileSync(find(h.ws, 'import-state.json'), 'utf8'));
  assert.equal(state.version, 1);
  assert.equal(state.reconstructedPublication, 'metadata');
});

test('unassigned: the pool is listed live, with the reason, and the places a module can go', async () => {
  const u = (await alice.get(P('/import/unassigned'))).json;
  assert.equal(u.count, 1);
  assert.equal(u.pool[0].dmc, 'TST-A-90-00-00-00A-040A-D');
  assert.equal(u.pool[0].reason, 'not-in-any-pmc');
  assert.equal(u.hasPublication, true);
  assert.ok(u.targets.some((t) => t.kind === 'folder' && t.title === 'Hydraulics'));
  assert.equal(u.reconstructed, 'metadata');
  assert.ok(u.lastImport.counts.dms === 4);
});

test('report: what an import did stays available after the screen is closed, for a viewer too, and never follows a tampered path out of the originals folder', async () => {
  const fresh = await newProject('No import yet');
  assert.equal((await alice.get(`/api/projects/${fresh}/import/report`)).status, 404, 'nothing imported yet');

  const r = await alice.get(P('/import/report'));
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.json.batches.length, 1);
  assert.equal(r.json.batch.id, r.json.batches[0].id);
  assert.equal(r.json.changeLogAvailable, true);
  const rules = new Set(r.json.changeLog.filter((c) => c.kind !== 'note').map((c) => c.rule));
  for (const rule of ['table-cols', 'icn-placeholder', 'brex-remap']) assert.ok(rules.has(rule), `${rule} is in the stored change log`);
  assert.ok(r.json.originalsKept >= 2, 'the originals that were replaced are counted');
  assert.equal(r.json.reconstructed, 'metadata');
  assert.equal((await alice.get(P(`/import/report?batch=${encodeURIComponent(r.json.batch.id)}`))).json.batch.id, r.json.batch.id, 'a batch can be asked for by id');
  assert.equal((await alice.get(P('/import/report?batch=nope'))).status, 404);
  assert.equal((await carol.get(P('/import/report'))).status, 200, 'a viewer may read it');
  assert.ok([403, 404].includes((await bob.get(P('/import/report'))).status), 'a non-member may not');
  assert.equal((await new h.Client('anon').get(P('/import/report'))).status, 401);

  // import-state.json lives in the project folder and can be edited by hand: a batch whose `originals` points elsewhere must not be read from there
  const stateFile = find(h.ws, 'import-state.json');
  const saved = fs.readFileSync(stateFile, 'utf8');
  try {
    fs.writeFileSync(path.join(path.dirname(stateFile), 'change-log.json'), JSON.stringify({ changes: [{ rule: 'leak' }] }));
    const st = JSON.parse(saved);
    st.batches[st.batches.length - 1].originals = '.';
    fs.writeFileSync(stateFile, JSON.stringify(st));
    const t = (await alice.get(P('/import/report'))).json;
    assert.equal(t.changeLogAvailable, false);
    assert.deepEqual(t.changeLog, []);
  } finally {
    fs.writeFileSync(stateFile, saved);
    fs.rmSync(path.join(path.dirname(stateFile), 'change-log.json'), { force: true });
  }
});

test('apply again: refused, atomically, because the modules exist; overwrite replaces them and keeps the earlier text in the history', async () => {
  const { files, codes } = defective();
  const again = await as(alice, P('/import/apply'), files);
  assert.equal(again.status, 400);
  assert.equal(again.json.code, 'IMPORT_REFUSED');
  assert.ok(again.json.problems.some((p) => /already exists/.test(p)));
  const over = await as(alice, P('/import/apply'), files, { overwrite: '1', publication: 'keep', repairs: [] });
  assert.equal(over.status, 200, JSON.stringify(over.json).slice(0, 300));
  assert.equal(over.json.imported.overwritten.length, 4);
  assert.equal(over.json.publication.mode, 'kept', 'an existing publication is left alone when asked');
  // The first import already cut a revision holding the repaired text, so the head equals the "before" text and the store
  // reuses it; the earlier text therefore survives as the older 'import' revision, the delivered text is the newest.
  const hist = (await alice.get(P(`/dms/${dmFile(codes.A)}/history`))).json.revisions;
  assert.equal(hist.length, 2);
  assert.ok(hist.every((x) => x.reason === 'import'));
});

test('assign: the orphan moves into the chosen folder; placing it again is refused unless reuse is set; the pool empties', async () => {
  const O = 'TST-A-90-00-00-00A-040A-D';
  const u = (await alice.get(P('/import/unassigned'))).json;
  const folder = u.targets.find((t) => t.title === 'Hydraulics');
  const r = await alice.post(P('/import/assign'), { files: [dmFile(O)], to: { folderPath: folder.path } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.placed, [dmFile(O)]);
  assert.equal((await alice.get(P('/import/unassigned'))).json.count, 0);
  const book = (await alice.get(P('/pmc'))).json;
  assert.ok(flat(book.entries).some((e) => e.dmCode && e.dmCode.systemCode === '90'));

  const dup = await alice.post(P('/import/assign'), { files: [dmFile(O)], to: { folderPath: folder.path } });
  assert.equal(dup.status, 400, 'nothing left to place');
  assert.equal(dup.json.code, 'NOTHING_TO_PLACE');
  const reuse = await alice.post(P('/import/assign'), { files: [dmFile(O)], to: { folderPath: [] }, reuse: true });
  assert.equal(reuse.status, 200);
  assert.deepEqual(reuse.json.placed, [dmFile(O)]);
  const ghost = await alice.post(P('/import/assign'), { files: ['DMC-NOPE-A-00-00-00-00A-040A-D.xml'], to: { folderPath: [] } });
  assert.ok(ghost.status >= 400, 'a module that is not in the project cannot be placed');
  assert.equal((await alice.post(P('/import/assign'), { to: {} })).status, 400, 'files[] is required');
});

test('apply is all-or-nothing: one malformed module refuses the whole batch and writes nothing', async () => {
  const id = await newProject('Refusal test');
  const { files } = defective();
  const broken = files.map(([n, x], i) => [n, i === 1 ? x.replace('</content>', '') : x]);
  const r = await as(alice, `/api/projects/${id}/import/apply`, broken);
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'IMPORT_REFUSED');
  assert.ok(r.json.problems.some((p) => /not well-formed/i.test(p)));
  assert.equal((await alice.get(`/api/projects/${id}/dms`)).json.dms.length, 0, 'nothing was imported');
  const evil = dm({ dmc: 'TST-A-10-00-00-00A-040A-D', entities: [{ name: 'x', target: 'file:///etc/passwd' }] });
  const unsafe = files.map(([n, x], i) => [n, i === 0 ? evil : x]);
  const u = await as(alice, `/api/projects/${id}/import/apply`, unsafe);
  assert.equal(u.status, 400, 'an external entity is never imported');
  assert.ok(u.json.problems.some((p) => /unsafe location/.test(p)));
  const outside = files.map(([n, x], i) => [n, i === 0 ? dm({ dmc: 'TST-A-10-00-00-00A-040A-D', entities: [{ name: 'ICN-TST-Z', target: '../../up/a.png' }] }) : x]);
  const o = await as(alice, `/api/projects/${id}/import/apply`, outside);
  assert.equal(o.status, 400, 'a graphic outside the package is refused too');
  assert.ok(o.json.problems.some((p) => /unsafe location|outside the package/.test(p)), JSON.stringify(o.json.problems));
  assert.equal((await alice.get(`/api/projects/${id}/dms`)).json.dms.length, 0);
});

test('apply with no repairs: modules are stored byte for byte as delivered (the rules are individually switchable, here all off)', async () => {
  const id = await newProject('No repairs');
  const { files, codes } = defective();
  const r = await as(alice, `/api/projects/${id}/import/apply`, files, { repairs: [] });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.json.changeLog.filter((c) => c.kind !== 'note').length, 0);
  const a = (await alice.get(`/api/projects/${id}/dms/${dmFile(codes.A)}`)).json.xml;
  assert.equal(a, files[0][1]);
  assert.equal(r.json.placeholders.length, 0);
  assert.equal(r.json.publication.reconstructed, null, 'the template publication was not rebuilt');
});

test('sub-publications: the pmRef anchor and its pool are offered; assigning to the sub-publication makes a folder with the title page first, in steps', async () => {
  const id = await newProject('Annexures');
  const T0 = 'TST-A-00-00-00-00A-001A-D'; const M1 = 'TST-A-10-00-00-00A-040A-D';
  const TA = 'TST-A-00-00-00-11A-001A-D'; const A1 = 'TST-A-20-00-00-00A-040A-D'; const A2 = 'TST-A-20-00-00-00A-520A-A';
  const files = [
    [dmFile(T0), dm({ dmc: T0, tech: 'Master', info: 'Title page', bodyPm: pm('00001') })],
    [dmFile(M1), dm({ dmc: M1, tech: 'Pump', info: 'Description' })],
    [dmFile(TA), dm({ dmc: TA, tech: 'Radar manual', info: 'Title page', bodyPm: pm('00010') })],
    [dmFile(A1), dm({ dmc: A1, tech: 'Antenna', info: 'Description' })],
    [dmFile(A2), dm({ dmc: A2, tech: 'Antenna', info: 'Removal' })],
    ['PMC-TST-1671Y-00001-00_001-00_EN-IN.xml', pmc({ code: pm('00001'), title: 'Master', entries: [T0, M1, { pmRef: pm('00010'), title: "Annexure 'A' - Radar manual" }] })],
  ];
  const base = `/api/projects/${id}`;
  const applied = await as(alice, `${base}/import/apply`, files);
  assert.equal(applied.status, 200, JSON.stringify(applied.json).slice(0, 300));
  assert.equal(applied.json.subPublications[0].status, 'anchor-only');
  const u = (await alice.get(`${base}/import/unassigned`)).json;
  assert.deepEqual(u.pool.map((p) => p.dmc).sort(), [TA, A1, A2].sort());
  assert.equal(u.pool.find((p) => p.dmc === TA).anchorOf, 'TST-1671Y-00010-00', 'the title page is marked as the anchor of its sub-publication');
  assert.equal(u.subPublications[0].anchor.dmc, TA);

  const first = await alice.post(`${base}/import/assign`, { files: [dmFile(A1)], to: { subPublication: 'TST-1671Y-00010-00' } });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.materialised.title, "Annexure 'A' - Radar manual");
  assert.deepEqual(first.json.placed, [dmFile(TA), dmFile(A1)], 'anchor first');
  const book = (await alice.get(`${base}/pmc`)).json;
  const folder = book.entries.find((e) => e.type === 'folder');
  assert.equal(folder.title, "Annexure 'A' - Radar manual");
  assert.deepEqual(folder.children.map((c) => c.dmCode.infoCode), ['001', '040']);

  const second = await alice.post(`${base}/import/assign`, { files: [dmFile(A2)], to: { subPublication: 'TST-1671Y-00010-00' } });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.materialised, null, 'the same folder is found again');
  const again = (await alice.get(`${base}/pmc`)).json;
  assert.equal(again.entries.filter((e) => e.type === 'folder').length, 1);
  assert.equal(again.entries.find((e) => e.type === 'folder').children.length, 3);
  assert.equal((await alice.get(`${base}/import/unassigned`)).json.count, 0);
});

test('a large package (more files than the 1000-file module import allows) is accepted', async () => {
  const id = await newProject('Big package');
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const A = 'TST-A-10-00-00-00A-040A-D';
  const files = [[dmFile(A), dm({ dmc: A })], ...Array.from({ length: 1100 }, (_, i) => [`ICN-TST-A-000000-A-${String(i).padStart(5, '0')}-00001-A-001-01.png`, png])];
  const r = await as(alice, `/api/projects/${id}/import/scan`, files);
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  assert.equal(r.json.report.counts.icns, 1100);
});
