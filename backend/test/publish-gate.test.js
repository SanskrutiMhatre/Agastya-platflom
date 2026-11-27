'use strict';
// Draft saving versus publication, for all 21 data module types on issues 4.2, 5.0, 6 and 7:
//   - malformed XML is refused when saved (400 MALFORMED_XML)
//   - well-formed but schema-invalid XML IS saved, as a draft
//   - but a PDF (full build or server preview) and a release (request AND approval) need a FRESH XSD validation of the modules the
//     publication contains: a draft that does not match its schema blocks them with 422 VALIDATION_FAILED, naming the module
//   - the check is fresh (a cached "valid" report from before the edit does not count) and is not sticky (fixing the module unblocks)
//   - a schema-invalid draft that is NOT in the publication does not block it
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, RESULTS, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = (issue) => path.join(DM21, issue);
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';
const TYPES = ['descript', 'proced', 'fault', 'crew', 'ipd', 'brex', 'comrep', 'appliccrossreftable', 'condcrossreftable', 'prdcrossreftable', 'brdoc', 'checklist', 'container', 'frontmatter', 'learning', 'process', 'sb', 'schedul', 'scocontent', 'wrngdata', 'wrngflds'];
const REC = {};
const rec = (type, issue, field, v) => { ((REC[`${type}/${issue}`] ??= {})[field] = v); };

let h; let admin; let w;
test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda Writer', role: 'author' });
  w = new h.Client('wanda');
  await w.post('/api/auth/login', { username: 'wanda', password: made.json.tempPassword });
  await w.post('/api/auth/onboarding', { username: 'wanda', password: PW });
});
test.after(async () => {
  const out = RESULTS;                                    // AGASTYA_TEST_RESULTS, else frontend/verification-results (helpers.js)
  fs.mkdirSync(out, { recursive: true });
  // merge: the everyday run covers issue 5-0 only and must not erase the four-issue record of the full verification run
  const file = path.join(out, 'publish-gate.json');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  fs.writeFileSync(file, JSON.stringify({ ...prev, ...REC }, null, 1));
  await h.close();
});

async function projectWith(issue, name, placeAll = true) {
  const dir = FIX(issue);
  const id = (await w.post('/api/projects', { name, pipeline: 's1000dtofo' })).json.project.id;
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(dir, '..', ICN))]), ICN);
  fd.append('dir', 'csdb');
  assert.equal((await w.req('POST', `/api/projects/${id}/media`, fd)).status, 200);
  const names = TYPES.map((t) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))[t]);
  assert.equal(names.length, 21);
  for (const f of names) assert.equal((await w.post(`/api/projects/${id}/dms`, { file: f, xml: fs.readFileSync(path.join(dir, f), 'utf8') })).status, 201, f);
  if (placeAll) await place(id, names);
  return { id, names };
}
async function place(id, files) {
  const pmc = (await w.get(`/api/projects/${id}/pmc`)).json;
  const list = (await w.get(`/api/projects/${id}/dms`)).json.dms.filter((d) => files.includes(d.file));
  const entries = [{ type: 'folder', title: 'All', children: list.map((d) => ({ type: 'dm', dmCode: d.dmCodeAttrs, issueInfo: d.issueInfoAttrs, language: d.languageAttrs, techName: d.techName, infoName: d.infoName })) }];
  assert.equal((await w.put(`/api/projects/${id}/pmc`, { meta: pmc.meta, entries })).status, 200);
}
const breakSchema = (xml) => xml.replace('<content>', '<content><zzNope/>');
const pdfMtime = (id) => { const f = path.join(process.env.AGASTYA_WORKSPACE_DIR, 'projects', id, 'jss-output.pdf'); return fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0; };

// everyday run: issue 5-0 (all 21 types); VERIFY_FULL=1 (npm run test:verify) runs all four issues - each request really validates, so it is slow
const ISSUES = process.env.VERIFY_FULL ? ['4-2', '5-0', '6', '7'] : ['5-0'];
for (const issue of ISSUES) {
  // QA-002 (WP-08): this was ONE test of 21 types with a 600 s limit, and it was cancelled at that limit on a loaded machine. It is now a setup
  // test and one test per type, each with its own limit, so a slow machine shows which type is slow and a hang stops at one type. The checks are
  // the same, in the same order, on the same project.
  let gate = null;
  test(`issue ${issue}: all 21 types - setup: the valid publication builds, previews and can be requested for release`, { timeout: 300000 }, async () => {
    const { id, names } = await projectWith(issue, `Gate ${issue}`);
    const pdf0 = pdfMtime(id);

    // 1. everything valid: build, server preview and release request all work
    const ok = await w.post(`/api/projects/${id}/publish`, {});
    assert.equal(ok.status, 200, `a valid publication must build: ${JSON.stringify(ok.json).slice(0, 300)}`);
    assert.ok(pdfMtime(id) > pdf0);
    assert.equal((await w.req('POST', `/api/projects/${id}/publish/preview/${names[0]}`, {})).status, 200);
    gate = { id, names };
  });

  // 2. per type: break that one module; a stale "valid" report must not matter
  for (const [i, type] of TYPES.entries()) {
    test(`issue ${issue}: ${type} - a schema-invalid draft saves but blocks every PDF and release path; fixing it unblocks`, { timeout: 120000 }, async () => {
      assert.ok(gate, 'the setup test of this issue failed, so there is no project to check');
      const { id, names } = gate; const f = names[i];
      await w.post(`/api/projects/${id}/validation`, { issue: 'auto', brex: false });                    // a cached, VALID report exists
      const cur = (await w.get(`/api/projects/${id}/dms/${f}`)).json;
      assert.equal((await w.put(`/api/projects/${id}/dms/${f}`, { xml: breakSchema(cur.xml), baseHash: cur.hash })).status, 200, `${type}: the draft must be saved`);
      const before = pdfMtime(id);

      const build = await w.post(`/api/projects/${id}/publish`, {});
      const preview = await w.req('POST', `/api/projects/${id}/publish/preview/${f}`, {});
      const reqRel = await w.post(`/api/projects/${id}/release`, { scheduledAt: new Date(Date.now() + 3600e3).toISOString(), note: 'gate' });
      rec(type, issue, 'buildBlocked', build.status === 422 && build.json.code === 'VALIDATION_FAILED');
      rec(type, issue, 'previewBlocked', preview.status === 422 && preview.json.code === 'VALIDATION_FAILED');
      rec(type, issue, 'releaseRequestBlocked', reqRel.status === 422 && reqRel.json.code === 'VALIDATION_FAILED');
      assert.equal(build.status, 422, `${type} ${issue}: the full build ran on a schema-invalid module`);
      assert.equal(build.json.code, 'VALIDATION_FAILED');
      assert.match(JSON.stringify(build.json), new RegExp(f.replace(/[.]/g, '\\.')), `${type}: the refusal names the module`);
      assert.equal(preview.status, 422, `${type} ${issue}: the server preview ran on a schema-invalid module`);
      assert.equal(reqRel.status, 422, `${type} ${issue}: a release was requested for a schema-invalid publication`);
      assert.equal(pdfMtime(id), before, `${type} ${issue}: a PDF was written although validation failed`);

      // not sticky: restore the module and the publication builds again (checked on the first type only, a build is slow)
      const bad = (await w.get(`/api/projects/${id}/dms/${f}`)).json;
      assert.equal((await w.put(`/api/projects/${id}/dms/${f}`, { xml: cur.xml, baseHash: bad.hash })).status, 200);
      if (i === 0) assert.equal((await w.post(`/api/projects/${id}/publish`, {})).status, 200, 'fixing the module unblocks the build');
      rec(type, issue, 'draftSavedThenFixed', true);
    });
  }

  test(`issue ${issue}: release approval needs fresh validation too; a draft outside the publication does not block`, { timeout: 300000 }, async () => {
    const { id, names } = await projectWith(issue, `Gate approve ${issue}`, false);
    // publish only the first two modules; the third stays a free draft
    await place(id, names.slice(0, 2));
    const draft = names[2];
    const cur = (await w.get(`/api/projects/${id}/dms/${draft}`)).json;
    assert.equal((await w.put(`/api/projects/${id}/dms/${draft}`, { xml: breakSchema(cur.xml), baseHash: cur.hash })).status, 200);
    const build = await w.post(`/api/projects/${id}/publish`, {});
    assert.equal(build.status, 200, `a schema-invalid draft that is not in the publication must not block: ${JSON.stringify(build.json).slice(0, 200)}`);

    // request a release while valid, then break a PUBLISHED module, then try to approve
    const when = new Date(Date.now() + 3600e3).toISOString();
    assert.equal((await w.post(`/api/projects/${id}/release`, { scheduledAt: when, note: 'ok' })).status, 200);
    const rel = (await w.get(`/api/projects/${id}/release`)).json.pending;
    assert.ok(rel, 'a release is pending');
    const first = names[0];
    const f = (await w.get(`/api/projects/${id}/dms/${first}`)).json;
    assert.equal((await w.put(`/api/projects/${id}/dms/${first}`, { xml: breakSchema(f.xml), baseHash: f.hash })).status, 200);
    const approve = await admin.post(`/api/projects/${id}/release/${rel.id}/approve`, {});
    assert.equal(approve.status, 422, `approval of a release for a schema-invalid publication must be refused (${approve.status})`);
    assert.equal(approve.json.code, 'VALIDATION_FAILED');
    assert.ok((await w.get(`/api/projects/${id}/release`)).json.pending, 'the release is still pending, not approved');
    // fixed: approval works
    const f2 = (await w.get(`/api/projects/${id}/dms/${first}`)).json;
    assert.equal((await w.put(`/api/projects/${id}/dms/${first}`, { xml: f.xml, baseHash: f2.hash })).status, 200);
    assert.equal((await admin.post(`/api/projects/${id}/release/${rel.id}/approve`, {})).status, 200, 'approval works once the module is valid again');
  });
}

test('a module that cannot be schema-checked (declares an issue this installation does not have) blocks publication', { timeout: 120000 }, async () => {
  const { id, names } = await projectWith('5-0', 'Gate unchecked');
  const f = (await w.get(`/api/projects/${id}/dms/${names[0]}`)).json;
  const odd = f.xml.replace(/S1000D_5-0/g, 'S1000D_9-9');
  assert.equal((await w.put(`/api/projects/${id}/dms/${names[0]}`, { xml: odd, baseHash: f.hash })).status, 200, 'saved as a draft');
  const build = await w.post(`/api/projects/${id}/publish`, {});
  assert.equal(build.status, 422, 'an unchecked module must not be published');
  assert.equal(build.json.code, 'VALIDATION_FAILED');
});
