'use strict';
// Phase 7 (docs/phase3/performance.md): the caches added for 100+ users must never answer with something stale. Each test changes what a
// cache keeps and checks the next answer equals a fresh computation:
//   * the module listing (csdbIndex) after a create, a save, a delete, a file added by hand and an in-place edit after the listing TTL;
//   * GET /dms's kept answer after a save and a lock;
//   * the publication model memo after writePm, against a fresh parse of the file;
//   * the display fingerprint (reused listing) against the decision fingerprint (own scan);
//   * the per-module schema verdicts against verdicts computed with the cache emptied;
//   * the validation run kept before the last one (switching BREX on and off answers from it, and is still right after an edit);
//   * the build cache: an unchanged rebuild returns the same PDF file; any change of content or settings builds again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.AGASTYA_JOBS = 'inline';                 // the caches under test live in this process
process.env.AGASTYA_CSDB_LIST_TTL_MS = '150';        // the in-place edit check runs after this
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM_DESC = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const DM_PROC = 'DMC-S1KSTUDIO-A-29-10-00-00A-520A-A_001-00_EN-US.XML';
let h; let author; let pid; let dir; let csdbDir;

test.before(async () => {
  h = await boot();
  const admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  const made = await admin.post('/api/team/users', { username: 'perf7', fullName: 'Perf Seven', role: 'author' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  author = new h.Client('perf7');
  assert.equal((await author.post('/api/auth/login', { username: 'perf7', password: made.json.tempPassword })).status, 200);
  assert.equal((await author.post('/api/auth/onboarding', { username: 'perf7', password: PW })).status, 200);
  const p = await author.post('/api/projects', { name: 'Perf seven', pipeline: 's1000dtofo' });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  pid = p.json.project.id;
  dir = path.join(h.ws, 'projects', pid);
  assert.equal((await author.post(`/api/projects/${pid}/dms`, { file: DM_DESC, xml: h.sample(DM_DESC) })).status, 201);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  csdbDir = path.join(dir, pj.csdbDir || 'csdb');
  assert.ok(fs.existsSync(path.join(csdbDir, DM_DESC)), `the module is in ${csdbDir}`);
});
test.after(async () => { if (h) await h.close(); });

const files = async () => (await author.get(`/api/projects/${pid}/dms`)).json.dms.map((d) => d.file).sort();
const row = async (file) => (await author.get(`/api/projects/${pid}/dms`)).json.dms.find((d) => d.file === file);
const save = async (file, edit) => {
  const got = await author.get(`/api/projects/${pid}/dms/${file}`);
  const r = await author.put(`/api/projects/${pid}/dms/${file}`, { xml: edit(got.json.xml), baseHash: got.json.hash });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the module listing follows a create, a save, a delete, a file added by hand and an in-place edit', async () => {
  const csdb = require('../dist/services/csdb');
  assert.deepEqual(await files(), [DM_DESC]);
  // create: listed at once (the write path updates the listing)
  assert.equal((await author.post(`/api/projects/${pid}/dms`, { file: DM_PROC, xml: h.sample(DM_PROC) })).status, 201);
  assert.deepEqual(await files(), [DM_DESC, DM_PROC].sort());
  // save: the summary changes with the content
  await save(DM_DESC, (x) => x.replace(/<techName>([^<]*)<\/techName>/, '<techName>Phase seven pump</techName>'));
  assert.equal((await row(DM_DESC)).techName, 'Phase seven pump');
  // a file added by hand (the folder changes): listed on the next read
  const hand = 'DMC-S1KSTUDIO-A-29-10-00-00A-041A-D_001-00_EN-US.XML';
  fs.writeFileSync(path.join(csdbDir, hand), h.sample(DM_DESC).replace(/infoCode="040"/, 'infoCode="041"'), 'utf8');
  assert.ok((await files()).includes(hand), 'a module put in the folder by hand is listed');
  // an in-place edit by hand (the folder's time does not change): seen once the listing is older than its TTL
  const abs = path.join(csdbDir, hand);
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/<techName>([^<]*)<\/techName>/, '<techName>Edited in place</techName>'), 'utf8');
  await wait(400);
  assert.equal((await row(hand)).techName, 'Edited in place');
  // every summary equals a fresh scan
  const listed = csdb.listDms(pid);
  csdb.invalidateListing(pid);
  assert.deepEqual(JSON.parse(JSON.stringify(listed)), JSON.parse(JSON.stringify(csdb.listDms(pid))));
  // delete: gone at once
  assert.equal((await author.req('DELETE', `/api/projects/${pid}/dms/${hand}`)).status < 300, true);
  assert.ok(!(await files()).includes(hand));
});

test('GET /dms: the kept answer is replaced after a save and after a lock', async () => {
  const before = await row(DM_PROC);
  assert.equal(before.locked, false);
  assert.equal((await author.post(`/api/projects/${pid}/dms/${DM_PROC}/lock`, {})).status, 200);
  assert.equal((await row(DM_PROC)).locked, true, 'the lock shows at once');
  assert.equal((await author.post(`/api/projects/${pid}/dms/${DM_PROC}/unlock`, {})).status, 200);
  assert.equal((await row(DM_PROC)).locked, false);
  await save(DM_PROC, (x) => x.replace(/<techName>([^<]*)<\/techName>/, '<techName>Kept answer check</techName>'));
  assert.equal((await row(DM_PROC)).techName, 'Kept answer check');
  // the slim list and a page agree with the full list
  const slim = (await author.get(`/api/projects/${pid}/dms?fields=list`)).json.dms.find((d) => d.file === DM_PROC);
  assert.equal(slim.techName, 'Kept answer check');
});

test('the publication model kept after writePm equals a fresh parse of the file, and the fingerprints agree', () => {
  const pm = require('../dist/services/pm');
  const release = require('../dist/services/release');
  const model = pm.readPm(pid);
  const fresh = pm.parseModel(fs.readFileSync(pm.pmPath(pid), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(model.entries)), JSON.parse(JSON.stringify(fresh.entries)));
  assert.ok(Object.isFrozen(model.entries), 'the shared model cannot be changed by a caller');
  // the display fingerprint (reusing the listing) and the decision fingerprint (its own scan) are the same
  assert.equal(release.publicationFingerprint(pid, { reuse: true }), release.publicationFingerprint(pid));
});

test('schema verdicts: kept verdicts equal verdicts computed with the cache emptied; the previous run answers a switch of options', { timeout: 240000 }, async () => {
  const validation = require('../dist/services/validation');
  // an issue's id is a counter of the run, not part of the verdict
  const strip = (run) => ({ summary: run.summary, issues: run.issues.map(({ id, ...rest }) => rest), unchecked: run.unchecked, checked: run.checked, schemaChecked: run.schemaChecked });
  const a = (await author.post(`/api/projects/${pid}/validation`, { brex: true, fresh: true })).json.run;
  validation.clearSchemaVerdicts();
  fs.rmSync(validation.xsdCacheDir(), { recursive: true, force: true });
  const b = (await author.post(`/api/projects/${pid}/validation`, { brex: true, fresh: true })).json.run;
  assert.deepEqual(strip(a), strip(b));
  // BREX off, then on again: the BREX run is the kept previous run, unchanged content
  const off = (await author.post(`/api/projects/${pid}/validation`, { brex: false })).json.run;
  assert.equal(off.cached, undefined, 'a new option set is a new run');
  const on = (await author.post(`/api/projects/${pid}/validation`, { brex: true })).json.run;
  assert.equal(on.cached, true, 'switching back answers from the run kept before the last');
  assert.deepEqual(strip(on), strip(b));
  // an edit makes both kept runs stale
  await save(DM_DESC, (x) => x.replace(/<techName>([^<]*)<\/techName>/, '<techName>After the runs</techName>'));
  const after = (await author.post(`/api/projects/${pid}/validation`, { brex: false })).json.run;
  assert.notEqual(after.cached, true);
});

test('build cache: an unchanged rebuild is the same PDF file; a change of content or settings builds again', { timeout: 300000 }, async () => {
  const pdf = path.join(dir, 'jss-output.pdf');
  const first = await author.post(`/api/projects/${pid}/publish`, {});
  assert.equal(first.status, 200, JSON.stringify(first.json).slice(0, 600));
  assert.equal(first.json.upToDate, false);
  const st1 = fs.statSync(pdf); const bytes1 = fs.readFileSync(pdf);
  const again = await author.post(`/api/projects/${pid}/publish`, {});
  assert.equal(again.status, 200);
  assert.equal(again.json.upToDate, true, 'nothing changed: the last PDF is the answer');
  assert.equal(fs.statSync(pdf).mtimeMs, st1.mtimeMs, 'the PDF was not written again');
  assert.ok(fs.readFileSync(pdf).equals(bytes1));
  // a change of content
  await save(DM_DESC, (x) => x.replace(/<techName>([^<]*)<\/techName>/, '<techName>Rebuilt pump</techName>'));
  const edited = await author.post(`/api/projects/${pid}/publish`, {});
  assert.equal(edited.json.upToDate, false, 'a content change builds again');
  // a change of a build option
  const compressed = await author.post(`/api/projects/${pid}/publish`, { compression: 40 });
  assert.equal(compressed.json.upToDate, false, 'another compression builds again');
  // the same request again is answered from the last build; a PDF changed by hand is not trusted
  assert.equal((await author.post(`/api/projects/${pid}/publish`, { compression: 40 })).json.upToDate, true, 'the same request again is up to date');
  fs.appendFileSync(pdf, '\n');
  assert.equal((await author.post(`/api/projects/${pid}/publish`, {})).json.upToDate, false, 'a PDF changed by hand is rebuilt');
  // the one-module preview: the second identical request reuses the preview file
  const pv1 = await author.req('POST', `/api/projects/${pid}/publish/preview/${DM_DESC}`, {});
  assert.equal(pv1.status, 200);
  const prevAbs = path.join(dir, 'jss-preview.pdf');
  const m1 = fs.statSync(prevAbs).mtimeMs;
  const pv2 = await author.req('POST', `/api/projects/${pid}/publish/preview/${DM_DESC}`, {});
  assert.equal(pv2.status, 200);
  assert.ok(pv2.buf.equals(pv1.buf));
  assert.equal(fs.statSync(prevAbs).mtimeMs, m1, 'an unchanged preview is not rendered again');
});
