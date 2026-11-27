'use strict';
// WP-11 (REL-001, PLT-009, ARC-001, PUB-007, PUB-010, DEP-016, ENT-016, REL-002, PLT-020, PLT-021, REL-007, PERF-010, RES-001, FE-008, SEC-017):
// file integrity. Atomic writes (a kill-during-write harness: 0 torn files over 100 kill points, G-REL-2), the revision recorded before
// the write and a failed revision refusing the save, the mandatory version guard on every content-write route (found from the live
// route table), history and restore for the JSS and JSG documents, the merge by chapter (decision D22), check-out leases, and a
// concurrent-save property test (0 silent overwrites, G-REL-4).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { boot, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

let h; let owner; let bea; let admin; let pid; let jss; let jsg;

async function person(role, username) {
  const made = await admin.post('/api/team/users', { username, fullName: username, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username);
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  owner = await person('author', 'olga');
  bea = await person('author', 'bea');
  pid = (await owner.post('/api/projects', { name: 'Integrity S1000D' })).json.project.id;
  assert.equal((await owner.post(`/api/projects/${pid}/dms`, { file: DM, xml: h.sample(DM) })).status, 201);
  const j = await owner.post('/api/projects', { name: 'Integrity JSS', format: 'jss', domain: 'land', manualType: 'mm' });
  assert.equal(j.status, 201, JSON.stringify(j.json)); jss = j.json.project.id;
  const g = await owner.post('/api/projects', { name: 'Integrity JSG', format: 'jsg', domain: 'land', manualType: 'uhb' });
  assert.equal(g.status, 201, JSON.stringify(g.json)); jsg = g.json.project.id;
  for (const p of [pid, jss, jsg]) assert.equal((await owner.post(`/api/projects/${p}/assign`, { username: 'bea', role: 'editor' })).status, 200);
});
test.after(async () => { await h.close(); });

// ── atomic writes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('atomic write: a failure before the rename leaves the old file whole and no temporary file behind', () => {
  const { writeFileAtomic, atomicFaults, isAtomicTemp, sweepTempFiles } = require('../dist/storage/atomicWrite');
  const dir = tmp('wp11-atomic-'); const f = path.join(dir, 'doc.xml');
  writeFileAtomic(f, 'old content');
  atomicFaults.beforeRename = () => { throw new Error('injected: power cut before rename'); };
  try { assert.throws(() => writeFileAtomic(f, 'new content that never lands'), /injected/); } finally { atomicFaults.beforeRename = null; }
  assert.equal(fs.readFileSync(f, 'utf8'), 'old content');
  assert.deepEqual(fs.readdirSync(dir).filter(isAtomicTemp), [], 'the temporary file was removed');
  writeFileAtomic(f, 'new');
  assert.equal(fs.readFileSync(f, 'utf8'), 'new');
  // a temporary file left by a killed process is swept at start
  fs.writeFileSync(path.join(dir, `.doc.xml.tmp-123-${'a'.repeat(12)}`), 'half');
  assert.equal(sweepTempFiles(dir, 0, Date.now() + 5000), 1);
  assert.deepEqual(fs.readdirSync(dir), ['doc.xml']);
});

test('kill-during-write harness (G-REL-2): 100 kill points, 0 torn files', { timeout: 300_000 }, async () => {
  const dir = tmp('wp11-kill-'); const target = path.join(dir, 'book.xml');
  const A = 'A'.repeat(3 * 1024 * 1024); const B = 'B'.repeat(5 * 1024 * 1024) + '\n';   // two complete versions of different size
  const { writeFileAtomic } = require('../dist/storage/atomicWrite');
  writeFileAtomic(target, A);
  const child = path.join(dir, 'writer.js');
  fs.writeFileSync(child, `const { writeFileAtomic } = require(${JSON.stringify(path.resolve(__dirname, '..', 'dist', 'storage', 'atomicWrite.js'))});
const A = 'A'.repeat(${A.length}); const B = 'B'.repeat(${B.length - 1}) + '\\n';
process.stdout.write('ready\\n');
for (let i = 0; ; i++) writeFileAtomic(${JSON.stringify(target)}, i % 2 ? A : B);\n`);
  let torn = 0; let kills = 0;
  for (let n = 0; n < 100; n++) {
    const p = spawn(process.execPath, [child], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((resolve) => p.stdout.once('data', resolve));
    await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 60)));
    p.kill('SIGKILL'); kills++;
    await new Promise((r) => p.once('exit', r));
    const got = fs.readFileSync(target, 'utf8');
    if (got !== A && got !== B) torn++;
  }
  assert.equal(kills, 100);
  assert.equal(torn, 0, `${torn} torn file(s) after 100 kills`);
});

// ── the version guard ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('every content-write route carries the version guard (found from the live route table); the rest are listed with a reason', async () => {
  const { createApp } = require('../dist/app');
  const routes = createApp()._router.stack.filter((l) => l.route).map((l) => ({
    label: `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path}`,
    guarded: l.route.stack.some((s) => s.handle.isVersionGuard),
  }));
  const MUST = [
    'PUT /api/projects/:id/dms/:file', 'POST /api/projects/:id/dms/:file/history/:rev/restore',
    'PUT /api/projects/:id/jss', 'POST /api/projects/:id/jss/history/:rev/restore', 'PUT /api/projects/:id/ancillary/:page',
    'PUT /api/projects/:id/jsg', 'POST /api/projects/:id/jsg/history/:rev/restore',
    'PUT /api/projects/:id/pmc', 'PUT /api/projects/:id/settings', 'PUT /api/projects/:id/objects/:file',
  ];
  // (a path can have more than one layer: jss-guard.ts registers its own early layer on some paths; the handler's layer is the guarded one)
  const guardedLabels = new Set(routes.filter((r) => r.guarded).map((r) => r.label));
  for (const m of MUST) assert.ok(guardedLabels.has(m), `${m} has the version guard`);
  // Every other PUT / PATCH of a project changes a configuration row or one field, not a whole authored document: named here, so a new
  // document-replacing route cannot be added without either the guard or a reason.
  const EXEMPT = {
    'PUT /api/projects/:id/ancillary': 'which pages are printed and their headings (a list of switches in project.json)',
    'PUT /api/projects/:id/identity': 'the document codes record is re-derived from the document on every save; a field-level update',
    'PUT /api/projects/:id/identity/visibility': 'one switch',
    'PUT /api/projects/:id/extensions/:profileId': 'enables an extension profile (a database row)',
    'PUT /api/projects/:id/validation/issue': 'one setting (the S1000D issue)',
    'PUT /api/projects/:id/watermark': 'one setting (the watermark text)',
    'PUT /api/projects/:id/s1000d': 'S1000D configuration (database rows, manager only)',
    'PUT /api/projects/:id/s1000d/codes': 'S1000D configuration (database rows, manager only)',
    'PUT /api/projects/:id/s1000d/dm-types': 'S1000D configuration (database rows, manager only)',
    'PATCH /api/projects/:id/sns': 'SNS configuration (database rows, manager only)',
    'PUT /api/projects/:id/applicability': 'S1000D configuration (database rows, manager only)',
    'PUT /api/projects/:id/sns-rows/ordering': 'SNS ordering (database rows)',
    'PUT /api/projects/:id/sns-rows/:rowId': 'one SNS row (database row)',
    'PATCH /api/projects/:id': 'rename (one field, owner only)',
    'PATCH /api/projects/:id/members/:userId': 'the role of a member (a database row)',
  };
  const unguarded = routes.filter((r) => /^(PUT|PATCH) \/api\/projects\/:id/.test(r.label) && !guardedLabels.has(r.label)).map((r) => r.label);
  assert.deepEqual(unguarded.filter((r) => !EXEMPT[r]), [], 'a project PUT/PATCH with neither the guard nor a stated reason');
  assert.deepEqual(Object.keys(EXEMPT).filter((k) => !routes.some((r) => r.label === k)), [], 'every exemption names a route that exists');
});

test('a save that names no version is refused (428) on every guarded route; a stale one is a conflict (409)', async () => {
  const U = `/api/projects/${pid}`;
  const cases = [
    [`${U}/dms/${DM}`, (x) => ({ xml: x.xml })],
    [`${U}/pmc`, (x) => ({ meta: x.meta, entries: x.entries })],
    [`${U}/settings`, (x) => ({ project: x.project })],
    [`/api/projects/${jss}/jss`, (x) => ({ xml: x.xml })],
    [`/api/projects/${jsg}/jsg`, (x) => ({ xml: x.xml })],
  ];
  for (const [url, body] of cases) {
    const cur = (await owner.get(url)).json;
    const none = await owner.put(url, body(cur));
    assert.equal(none.status, 428, `${url}: ${JSON.stringify(none.json)}`); assert.equal(none.json.code, 'BASE_HASH_REQUIRED');
    const stale = await owner.put(url, { ...body(cur), baseHash: 'e'.repeat(64) });
    assert.equal(stale.status, 409, `${url} stale: ${JSON.stringify(stale.json).slice(0, 200)}`);
    const ok = await owner.put(url, { ...body(cur), baseHash: cur.hash ?? cur.version });
    assert.equal(ok.status, 200, `${url} current: ${JSON.stringify(ok.json).slice(0, 200)}`);
  }
  // If-Match names the version as well
  const cur = (await owner.get(`${U}/dms/${DM}`)).json;
  assert.equal((await owner.req('PUT', `${U}/dms/${DM}`, { xml: cur.xml }, { 'if-match': `"${cur.hash}"` })).status, 200);
});

// ── history first, and a revision that cannot be recorded refuses the save ──────────────────────────────────────────────────────

test('a revision that cannot be recorded refuses the save (500 REVISION_FAILED) and leaves the file as it was', async () => {
  const { revisionFaults } = require('../dist/services/projectFiles');
  const url = `/api/projects/${pid}/dms/${DM}`;
  const cur = (await owner.get(url)).json;
  revisionFaults.beforeCut = () => { throw new Error('injected: database unavailable'); };
  let r;
  try { r = await owner.put(url, { xml: cur.xml.replace('Hydraulic pump', 'Hydraulic pump (never saved)'), baseHash: cur.hash }); } finally { revisionFaults.beforeCut = null; }
  assert.equal(r.status, 500); assert.equal(r.json.code, 'REVISION_FAILED');
  assert.equal((await owner.get(url)).json.hash, cur.hash, 'the file is unchanged');
});

test('a file changed on disk outside the platform is recorded in the history before it is overwritten', async () => {
  const url = `/api/projects/${pid}/dms/${DM}`;
  const file = path.join(h.ws, 'projects', pid, 'csdb', DM);
  const byHand = fs.readFileSync(file, 'utf8').replace('Hydraulic pump', 'Hydraulic pump (edited by hand)');
  fs.writeFileSync(file, byHand);
  const cur = (await owner.get(url)).json;
  assert.equal((await owner.put(url, { xml: byHand.replace('(edited by hand)', '(then saved)'), baseHash: cur.hash })).status, 200);
  const revs = (await owner.get(`${url}/history`)).json.revisions;
  assert.equal(revs[1].reason, 'on-disk');
  assert.equal((await owner.get(`${url}/history/${revs[1].id}`)).json.xml, byHand, 'the hand edit is in the history');
});

// ── JSS and JSG history and restore (ARC-001 b, PUB-007) ───────────────────────────────────────────────────────────────────────

for (const kind of ['jss', 'jsg']) {
  test(`${kind.toUpperCase()}: three saves give three revisions, and restoring the first returns its exact bytes`, async () => {
    const U = `/api/projects/${kind === 'jss' ? jss : jsg}/${kind}`;
    const texts = [];
    for (let i = 1; i <= 3; i++) {
      const cur = (await owner.get(U)).json;
      const xml = cur.xml.replace(/(<\/(?:jssbook|jsgdoc)>\s*)$/, `<!-- save ${i} -->\n$1`);
      texts.push(xml);
      const r = await owner.put(U, { xml, baseHash: cur.hash });
      assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
    }
    const revs = (await owner.get(`${U}/history`)).json.revisions;
    const mine = revs.filter((r) => /^save/.test(r.reason));
    assert.ok(mine.length >= 3, `three revisions (${revs.map((r) => r.reason).join(', ')})`);
    const first = revs.find((r) => r.hash === sha(texts[0]));
    assert.ok(first, 'the first save is in the history');
    assert.equal((await owner.get(`${U}/history/${first.id}`)).json.xml, texts[0], 'exact bytes');
    const cur = (await owner.get(U)).json;
    assert.equal((await owner.post(`${U}/history/${first.id}/restore`, {})).status, 428, 'a restore is guarded like a save');
    const back = await owner.post(`${U}/history/${first.id}/restore`, { baseHash: cur.hash });
    assert.equal(back.status, 200, JSON.stringify(back.json).slice(0, 300));
    assert.equal((await owner.get(U)).json.xml, texts[0], 'restored');
    assert.equal((await owner.get(`${U}/history`)).json.revisions.length, revs.length + 1, 'a restore adds a revision; nothing is removed');
    assert.equal((await bea.get(`${U}/history/999999`)).status, 404);
  });
}

// ── merge by part (decision D22) and check-out leases (RES-001) ────────────────────────────────────────────────────────────────

const chapterIds = (xml) => [...xml.matchAll(/<chapter\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
const addToChapter = (xml, id, text) => xml.replace(new RegExp(`(<chapter\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?</title>)`), `$1<para>${text}</para>`);

test('JSS: two authors on two chapters both save (merged); two authors on one chapter get a conflict naming it', async () => {
  const U = `/api/projects/${jss}/jss`;
  const base = (await owner.get(U)).json;
  const [c1, c2] = chapterIds(base.xml);
  assert.ok(c1 && c2, 'the stencil has two chapters');
  const a = await owner.put(U, { xml: addToChapter(base.xml, c1, 'Olga wrote this'), baseHash: base.hash });
  assert.equal(a.status, 200);
  const b = await bea.put(U, { xml: addToChapter(base.xml, c2, 'Bea wrote this'), baseHash: base.hash });
  assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 300));
  assert.equal(b.json.merged, true, 'the second save was merged');
  const now = (await owner.get(U)).json.xml;
  assert.match(now, /Olga wrote this/); assert.match(now, /Bea wrote this/);
  assert.equal(b.json.xml, now, 'the merged text is returned for the editor');
  // both change chapter 1 from the same version: the second is refused with the current text
  const v = (await owner.get(U)).json;
  assert.equal((await owner.put(U, { xml: addToChapter(v.xml, c1, 'first'), baseHash: v.hash })).status, 200);
  const clash = await bea.put(U, { xml: addToChapter(v.xml, c1, 'second'), baseHash: v.hash });
  assert.equal(clash.status, 409); assert.equal(clash.json.code, 'STALE_DOCUMENT');
  assert.deepEqual(clash.json.conflicts, [c1]);
  assert.equal(clash.json.currentHash, sha((await owner.get(U)).json.xml));
  assert.doesNotMatch((await owner.get(U)).json.xml, /second/);
});

test('JSG: sections are parts; a stale save that touches another section is merged', async () => {
  const U = `/api/projects/${jsg}/jsg`;
  const base = (await owner.get(U)).json;
  const ids = [...base.xml.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  assert.ok(ids.length >= 2);
  const edit = (xml, id, t) => xml.replace(new RegExp(`(<section\\b[^>]*\\bid="${id}"[^>]*>)`), `$1<para>${t}</para>`);
  assert.equal((await owner.put(U, { xml: edit(base.xml, ids[0], 'one'), baseHash: base.hash })).status, 200);
  const b = await bea.put(U, { xml: edit(base.xml, ids[1], 'two'), baseHash: base.hash });
  assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 300)); assert.equal(b.json.merged, true);
  const now = (await owner.get(U)).json.xml; assert.match(now, /<para>one<\/para>/); assert.match(now, /<para>two<\/para>/);
});

test('check-out: one holder at a time, a save by another author over a checked-out part is refused naming the holder, the owner can break it', async () => {
  const U = `/api/projects/${jss}/jss`;
  const v = (await owner.get(U)).json; const [c1, c2] = chapterIds(v.xml);
  const mine = await bea.post(`${U}/checkout`, { part: c1 });
  assert.equal(mine.status, 200); assert.equal(mine.json.lease.holder, 'bea');
  const twice = await owner.post(`${U}/checkout`, { part: c1 });
  assert.equal(twice.status, 423, 'two authors cannot hold the same lease'); assert.equal(twice.json.holder, 'bea');
  assert.equal((await owner.post(`${U}/checkout`, { part: '' })).status, 423, 'nor the whole document while a part is out');
  const refused = await owner.put(U, { xml: addToChapter(v.xml, c1, 'over the lease'), baseHash: v.hash });
  assert.equal(refused.status, 423); assert.equal(refused.json.code, 'CHECKED_OUT'); assert.match(refused.json.error, /bea/);
  assert.equal((await owner.put(U, { xml: addToChapter(v.xml, c2, 'another chapter is free'), baseHash: v.hash })).status, 200);
  assert.equal((await bea.post(`${U}/checkout`, { part: c1 })).status, 200, 'the holder renews');
  const list = (await owner.get(`${U}/checkouts`)).json.leases;
  assert.deepEqual(list.map((l) => [l.part, l.holder, l.mine]), [[c1, 'bea', false]]);
  // an author cannot break someone else's check-out; the project owner can, and it is audited
  const carol = await person('author', 'carol'); await owner.post(`/api/projects/${jss}/assign`, { username: 'carol', role: 'editor' });
  assert.equal((await carol.del(`${U}/checkout?part=${c1}&break=1`)).status, 403);
  const broken = await owner.del(`${U}/checkout?part=${c1}&break=1`);
  assert.equal(broken.status, 200); assert.equal(broken.json.released, true);
  const audit = (await admin.get('/api/admin/audit?limit=50')).json;
  const rows = audit.rows ?? audit.events ?? audit.entries ?? audit;
  assert.ok(JSON.stringify(rows).includes('jss.checkout-broken'), 'the break is in the audit log');
  assert.deepEqual((await owner.get(`${U}/checkouts`)).json.leases, []);
});

test('check-out of a data module: expiry frees it, and a lease never blocks its holder', async () => {
  const url = `/api/projects/${pid}/dms/${DM}`;
  assert.equal((await bea.post(`${url}/checkout`, {})).status, 200);
  const cur = (await owner.get(url)).json;
  const r = await owner.put(url, { xml: cur.xml.replace('Hydraulic pump', 'Hydraulic pump (olga)'), baseHash: cur.hash });
  assert.equal(r.status, 423); assert.equal(r.json.holder, 'bea');
  assert.equal((await owner.del(url)).status === 423 || (await owner.get(url)).status === 200, true, 'not deleted under the holder');
  assert.equal((await bea.put(url, { xml: cur.xml.replace('Hydraulic pump', 'Hydraulic pump (bea)'), baseHash: cur.hash })).status, 200, 'the holder saves');
  // expiry: the lease row is set to have ended; the next author takes it over
  const { repos } = require('../dist/context');
  const lease = repos.leases.listActive(pid, new Date().toISOString())[0];
  repos.leases.acquire({ documentId: lease.document_id, part: '', projectId: pid, userId: lease.user_id, username: 'bea', now: new Date().toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await owner.post(`${url}/checkout`, {})).status, 200, 'an expired lease is taken over');
  assert.equal((await owner.del(`${url}/checkout`)).json.released, true);
});

// ── concurrent saves (G-REL-4): 0 silent overwrites ─────────────────────────────────────────────────────────────────────────────

test('concurrent-save property (G-REL-4): 1,000 data-module saves by two authors racing from the same version - never a lost update', { timeout: 600_000 }, async () => {
  const url = `/api/projects/${pid}/dms/${DM}`;
  let accepted = 0; let refused = 0; let lost = 0;
  for (let round = 0; round < 500; round++) {
    const cur = (await owner.get(url)).json;
    const mineA = cur.xml.replace(/Hydraulic pump[^<]*/, `Hydraulic pump r${round}a`);
    const mineB = cur.xml.replace(/Hydraulic pump[^<]*/, `Hydraulic pump r${round}b`);
    const [a, b] = await Promise.all([owner.put(url, { xml: mineA, baseHash: cur.hash }), bea.put(url, { xml: mineB, baseHash: cur.hash })]);
    const ok = [a, b].filter((x) => x.status === 200).length;
    accepted += ok; refused += [a, b].filter((x) => x.status === 409).length;
    if (ok !== 1) lost++;                                   // both accepted from one version = one overwrote the other silently
    const after = (await owner.get(url)).json.xml;
    if (after !== (a.status === 200 ? mineA : mineB)) lost++;
  }
  assert.equal(accepted + refused, 1000);
  assert.equal(lost, 0, `${lost} silent overwrite(s)`);
  assert.equal(accepted, 500);
});

test('concurrent-save property, JSS: racing saves of the same chapter - exactly one wins each round, the other gets the conflict', { timeout: 600_000 }, async () => {
  const U = `/api/projects/${jss}/jss`;
  let lost = 0;
  for (let round = 0; round < 50; round++) {
    const cur = (await owner.get(U)).json; const [c1] = chapterIds(cur.xml);
    const [a, b] = await Promise.all([owner.put(U, { xml: addToChapter(cur.xml, c1, `r${round}a`), baseHash: cur.hash }), bea.put(U, { xml: addToChapter(cur.xml, c1, `r${round}b`), baseHash: cur.hash })]);
    if ([a, b].filter((x) => x.status === 200).length !== 1 || [a, b].filter((x) => x.status === 409).length !== 1) lost++;
    const now = (await owner.get(U)).json.xml;
    if (now.includes(`r${round}a`) === now.includes(`r${round}b`)) lost++;
  }
  assert.equal(lost, 0);
});

// ── uploads stream to disk with a cap on the whole request (REL-007, PLT-021) ──────────────────────────────────────────────────

test('an upload over the whole-request cap is refused while it streams (413) and leaves no file behind', async () => {
  const { uploadTmp } = require('../dist/services/uploads');
  const before = new Set(fs.readdirSync(uploadTmp()));
  const fd = new FormData();
  for (let i = 0; i < 17; i++) fd.append('files', new Blob([Buffer.alloc(16 * 1024 * 1024 - 1024, 32)]), `DMC-X-${i}.XML`);   // 17 x ~16 MB > 256 MB
  const r = await owner.req('POST', '/api/cir', fd);
  assert.equal(r.status, 413, JSON.stringify(r.json)); assert.equal(r.json.code, 'UPLOAD_TOO_LARGE');
  await new Promise((res) => setTimeout(res, 300));
  const left = fs.readdirSync(uploadTmp()).filter((f) => !before.has(f));
  assert.deepEqual(left, [], 'the parts already written were removed');
});
