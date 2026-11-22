'use strict';
// Xignal JSS front-matter modules over HTTP: read the project's modules into its settings (preview, then apply), write the settings out
// as flagged generated modules (dry run, real, protection of edited files, publication merge), input validation and who may do what.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot } = require('./helpers');
const pmc = require('../vendor/engine/pmc');
const { PAGE_DEFS } = require('../dist/services/jssdm/reserved');

const PW = 'Correct-Horse-9!';
const FIX = path.join(__dirname, 'fixtures', 'jssdm');
const SAMPLE = path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'JSS-0251', 'PMC-RDR-1671Y-00061-00_000-01.xml');
const NO_SAMPLE = !fs.existsSync(SAMPLE) && 'SAMPLE PROJECTS/JSS-0251 is not present';

let h; let admin; let alice; let bob; let carol;

async function person(role, username) {
  const made = await admin.post('/api/team/users', { username, fullName: `${username} person`, role });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username);
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}
const newProject = async (name) => (await alice.post('/api/projects', { name })).json.project.id;
const upload = async (pid, dir, filter = /^DMC-.*\.xml$/i) => {
  for (const f of fs.readdirSync(dir).filter((x) => filter.test(x))) {
    const r = await alice.post(`/api/projects/${pid}/dms`, { file: f, xml: fs.readFileSync(path.join(dir, f), 'utf8') });
    assert.equal(r.status, 201, `${f}: ${JSON.stringify(r.json)}`);
  }
};
const uploadPm = async (pid, file) => {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)], { type: 'text/xml' }), path.basename(file));
  const r = await alice.req('POST', `/api/projects/${pid}/pmc/import`, fd);
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const settings = async (pid) => (await alice.get(`/api/projects/${pid}/settings`)).json.project;
const dmFiles = async (pid) => (await alice.get(`/api/projects/${pid}/dms`)).json.dms.map((d) => d.file).sort();
const only = (...ids) => PAGE_DEFS.filter((d) => d.page !== 'listOfAnnexures').map((d) => ({ id: d.page, enabled: ids.includes(d.page) })).concat([{ id: 'titlePageJoint', enabled: true }]);

const FM = {
  titlePage: { documentType: 'Operator Manual', disclosureNotice: 'RESTRICTED', repairNotice: 'REPAIRS ONLY BY AUTHORISED AGENCIES.' },
  proprietary: { text: 'Property of Gen Co.' },
  foreword: { text: 'Please report errors.', email: 'gen@example.org', telephone: ['123'], postalAddress: [], fax: [] },
  pages: only('titlePage', 'proprietary', 'foreword'),
};
const PUB = { publicationNo: 'GEN-1', inbrNo: 'GEN-1', bookName: 'Generated Book', systemName: 'Generated System', year: '2026', month: '11' };
const IDS = { modelIdentCode: 'GENH', issueDate: { year: '2026', month: '11', day: '20' } };

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  alice = await person('author', 'alice');
  bob = await person('author', 'bobby');
  carol = await person('author', 'carol');
});
test.after(async () => { await h.close(); });

test('who may read, import and generate', async () => {
  const pid = await newProject('JSSDM guards');
  assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'carol', role: 'viewer' })).status, 200);
  const anon = new h.Client('anon');
  for (const [m, u] of [['post', 'import-frontmatter'], ['post', 'generate'], ['get', 'status']]) {
    assert.equal((await anon[m](`/api/projects/${pid}/jssdm/${u}`, m === 'post' ? {} : undefined)).status, 401, `anonymous ${u}`);
    assert.equal((await bob[m](`/api/projects/${pid}/jssdm/${u}`, m === 'post' ? {} : undefined)).status, 404, `a person not on the project: ${u}`);
  }
  assert.equal((await carol.get(`/api/projects/${pid}/jssdm/status`)).status, 200, 'a viewer can look');
  assert.equal((await carol.post(`/api/projects/${pid}/jssdm/import-frontmatter`, {})).status, 403, 'a viewer cannot import');
  assert.equal((await carol.post(`/api/projects/${pid}/jssdm/generate`, { frontMatter: FM })).status, 403, 'a viewer cannot generate');
  assert.equal((await alice.post(`/api/projects/${pid}/jssdm/import-frontmatter`, {})).status, 200, 'the owner can');
});

test('import with nothing to read: a hint on preview, a refusal on apply, no settings touched', async () => {
  const pid = await newProject('JSSDM empty');
  const before = JSON.stringify(await settings(pid));
  const prev = await alice.post(`/api/projects/${pid}/jssdm/import-frontmatter`, {});
  assert.equal(prev.status, 200);
  assert.equal(prev.json.applied, false);
  assert.equal(prev.json.scanned, 0);
  assert.match(prev.json.hint, /No front-matter data modules/);
  const ap = await alice.post(`/api/projects/${pid}/jssdm/import-frontmatter`, { apply: true });
  assert.equal(ap.status, 400);
  assert.equal(ap.json.code, 'NO_FRONT_MATTER');
  assert.equal(JSON.stringify(await settings(pid)), before);
});

test('import: preview shows everything and writes nothing; apply writes the settings, the publication and the publishers', async () => {
  const pid = await newProject('JSSDM import');
  await upload(pid, FIX);
  await uploadPm(pid, path.join(FIX, 'PMC-FIXT-12345-00001-00_001-00_EN-GB.xml'));
  const base = `/api/projects/${pid}/jssdm`;
  const before = await settings(pid);

  const prev = await alice.post(`${base}/import-frontmatter`, {});
  assert.equal(prev.status, 200, JSON.stringify(prev.json).slice(0, 300));
  assert.equal(prev.json.applied, false);
  assert.equal(prev.json.publicationRead, true);
  assert.equal(prev.json.scanned, 8, 'eight candidate modules (the custom X07 included): the chapter 5 heading is not one');
  assert.equal(prev.json.consumed.length, 5);
  assert.equal(prev.json.notConsumed.length, 3);
  assert.equal(prev.json.frontMatter.titlePage.documentType, 'Operator Manual');
  assert.equal(prev.json.publication.publicationNo, 'FIX-2026-007');
  assert.equal(prev.json.publication.bookName, 'Fixture Operator Manual');
  assert.equal(prev.json.branding.publishers.length, 2);
  assert.equal(prev.json.ids.modelIdentCode, 'FIXT');
  assert.ok(prev.json.report.some((e) => e.status === 'not-understood'), 'what was not understood is listed, not dropped');
  assert.equal(prev.json.summary.consumed, 5);
  assert.deepEqual(await settings(pid), before, 'a preview writes nothing');
  assert.equal(((await alice.get(`${base}/status`)).json.consumed).length, 0);

  const ap = await alice.post(`${base}/import-frontmatter`, { apply: true });
  assert.equal(ap.status, 200);
  assert.equal(ap.json.applied, true);
  assert.equal(ap.json.consumedCount, 5);
  assert.equal(ap.json.consumed.length, 5, 'the modules read are listed on apply too');
  assert.ok(ap.json.frontMatterKeys.includes('titlePage') && ap.json.frontMatterKeys.includes('pages'));
  assert.ok(ap.json.publicationKeys.includes('publicationNo'));
  assert.equal(ap.json.publishers, true);
  assert.equal(ap.json.emblem, null, 'the emblem is a house setting: offered, never applied by a project import');

  const s = await settings(pid);
  assert.equal(s.frontMatter.titlePage.documentType, 'Operator Manual');
  assert.equal(s.frontMatter.foreword.email, 'docs@fixture.example');
  assert.equal(s.frontMatter.labels.titleJoint.contractNo, 'Contract No: ');
  assert.equal(s.frontMatter.xignal.titlePage.secondRedText, 'SECOND NOTICE');
  assert.equal(s.publication.publicationNo, 'FIX-2026-007');
  assert.equal(s.publication.nsn, '1234-56-789-0123');
  assert.equal(s.publishers.length, 2);
  assert.equal(s.publishers[0].name, 'Alpha Systems Ltd');
  assert.equal(s.name, before.name, 'what the settings screen does not own stays');

  const st = (await alice.get(`${base}/status`)).json;
  assert.equal(st.consumed.length, 5);
  assert.ok(st.consumed.every((c) => c.exists));
  assert.ok(st.candidates.some((c) => /-X07A-/.test(c.file)), 'the module that was not understood stays a candidate');
  assert.ok(!st.candidates.some((c) => /-023A-/.test(c.file)), 'a consumed one does not');
  assert.deepEqual(st.generated, []);

  // the same again changes nothing; a different value is reported as replaced
  assert.deepEqual((await alice.post(`${base}/import-frontmatter`, { apply: true })).json.overwritten, []);
  const pj = await settings(pid);
  pj.frontMatter.foreword.email = 'mine@example.org';
  pj.publication.bookName = 'My own name';
  pj.frontMatter.labels.titleJoint.contractNo = 'Contract: ';          // the project's own label...
  pj.frontMatter.labels.titleJoint.myOwnLabel = 'Kept';                 // ...and one the modules do not mention
  assert.equal((await alice.put(`/api/projects/${pid}/settings`, { project: pj })).status, 200);
  const again = await alice.post(`${base}/import-frontmatter`, { apply: true });
  assert.ok(again.json.overwritten.includes('frontMatter.foreword'), again.json.overwritten.join(','));
  assert.ok(again.json.overwritten.includes('publication.bookName'));
  assert.ok(again.json.overwritten.includes('frontMatter.labels.titleJoint.contractNo'), 'a label that differs is named down to the leaf');
  assert.ok(!again.json.overwritten.some((k) => /labels.titleJoint$/.test(k)), 'not the whole group');
  assert.equal((await settings(pid)).frontMatter.labels.titleJoint.myOwnLabel, 'Kept', 'a label the modules do not mention is not lost');
  assert.equal((await settings(pid)).frontMatter.labels.titleJoint.contractNo, 'Contract No: ');
  assert.equal((await settings(pid)).frontMatter.foreword.email, 'docs@fixture.example');
});

test('generate: a dry run shows what would be written and writes nothing', async () => {
  const pid = await newProject('JSSDM dry');
  const dry = await alice.post(`/api/projects/${pid}/jssdm/generate`, { frontMatter: FM, publication: PUB, ids: IDS, dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.json.dryRun, true);
  assert.deepEqual(dry.json.written.map((w) => [w.page, w.infoCode, w.action]), [['titlePage', '001', 'created'], ['proprietary', '021', 'created'], ['foreword', '023', 'created']]);
  assert.equal(dry.json.written[0].file, 'DMC-GENH-A-00-00-00-00A-001A-A_001-00_EN-US.xml');
  assert.deepEqual(await dmFiles(pid), [], 'nothing was written');
  assert.deepEqual((await alice.get(`/api/projects/${pid}/jssdm/status`)).json.generated, []);
});

test('generate: writes flagged modules, records them, is idempotent, and protects what the author has edited', async () => {
  const pid = await newProject('JSSDM generate');
  const base = `/api/projects/${pid}/jssdm`;
  const gen = await alice.post(`${base}/generate`, { frontMatter: FM, publication: PUB, ids: IDS });
  assert.equal(gen.status, 201, JSON.stringify(gen.json).slice(0, 400));
  assert.equal(gen.json.written.length, 3);
  assert.ok(gen.json.written.every((w) => w.action === 'created'));
  assert.deepEqual(gen.json.skipped, []);
  assert.equal(gen.json.pm.action, 'none', 'the publication is only touched when asked');
  assert.equal(gen.json.ids.modelIdentCode, 'GENH');
  const files = await dmFiles(pid);
  assert.equal(files.length, 3);

  const dm = (await alice.get(`/api/projects/${pid}/dms/${gen.json.written[2].file}`)).json;
  assert.match(dm.xml, /<\?agastya-generated source="jssdm" page="foreword" version="1"\?>/);
  assert.match(dm.xml, /Please report errors\./);
  assert.match(dm.xml, /gen@example\.org/);

  const st = (await alice.get(`${base}/status`)).json;
  assert.equal(st.generated.length, 3);
  assert.ok(st.generated.every((g) => g.exists && !g.editedSince));
  assert.deepEqual(st.candidates, [], 'generated modules are not offered as front matter to read back');

  // reading the project back does not take its own output for the author's modules
  const rd = await alice.post(`${base}/import-frontmatter`, {});
  assert.equal(rd.json.scanned, 0);

  // again: nothing changes
  const second = await alice.post(`${base}/generate`, { frontMatter: FM, publication: PUB, ids: IDS });
  assert.equal(second.status, 200);
  assert.ok(second.json.written.every((w) => w.action === 'unchanged'));

  // an edit by the author is not overwritten
  const target = gen.json.written[1].file;
  const edited = (await alice.get(`/api/projects/${pid}/dms/${target}`)).json.xml.replace('Property of Gen Co.', 'Property of Gen Co. (edited by hand)');
  assert.equal((await alice.put(`/api/projects/${pid}/dms/${target}`, { xml: edited })).status, 200);
  assert.equal((await alice.get(`${base}/status`)).json.generated.find((g) => g.file === target).editedSince, true);
  const third = await alice.post(`${base}/generate`, { frontMatter: FM, publication: PUB, ids: IDS });
  assert.equal(third.json.skipped.length, 1);
  assert.equal(third.json.skipped[0].file, target);
  assert.equal(third.json.skipped[0].code, 'EDITED_SINCE_GENERATED');
  assert.match((await alice.get(`/api/projects/${pid}/dms/${target}`)).json.xml, /edited by hand/);

  // changed settings reach the modules that were not edited
  const FM2 = { ...FM, foreword: { ...FM.foreword, text: 'A new foreword.' } };
  const fourth = await alice.post(`${base}/generate`, { frontMatter: FM2, publication: PUB, ids: IDS });
  assert.equal(fourth.json.written.find((w) => w.page === 'foreword').action, 'updated');
  assert.match((await alice.get(`/api/projects/${pid}/dms/${gen.json.written[2].file}`)).json.xml, /A new foreword\./);

  // overwrite replaces the edit
  const over = await alice.post(`${base}/generate`, { frontMatter: FM2, publication: PUB, ids: IDS, overwrite: true });
  assert.equal(over.json.skipped.length, 0);
  assert.equal(over.json.written.find((w) => w.file === target).action, 'updated');
  assert.ok(!/edited by hand/.test((await alice.get(`/api/projects/${pid}/dms/${target}`)).json.xml));
  assert.ok((await alice.get(`${base}/status`)).json.generated.every((g) => !g.editedSince));
});

test('generate: a module of the same name that was not generated here is never replaced without overwrite', async () => {
  const pid = await newProject('JSSDM clash');
  await upload(pid, FIX, /-021A-A_001-00_EN-GB\.xml$/);
  const body = { frontMatter: { proprietary: { text: 'New text.' }, pages: only('proprietary') }, publication: PUB, ids: { modelIdentCode: 'FIXT', languageIsoCode: 'en', countryIsoCode: 'GB' } };
  const r = await alice.post(`/api/projects/${pid}/jssdm/generate`, body);
  const sk = r.json.skipped.find((s) => s.page === 'proprietary');
  assert.ok(sk, JSON.stringify(r.json));
  assert.equal(sk.code, 'NOT_GENERATED');
  assert.match((await alice.get(`/api/projects/${pid}/dms/${sk.file}`)).json.xml, /Property of Fixture Co/, 'the author\'s module is untouched');
  const forced = await alice.post(`/api/projects/${pid}/jssdm/generate`, { ...body, overwrite: true });
  assert.equal(forced.json.written.find((w) => w.page === 'proprietary').action, 'updated');
  assert.match((await alice.get(`/api/projects/${pid}/dms/${sk.file}`)).json.xml, /New text\./);
});

test('generate with pm:"merge": a Front matter folder goes first, once, with the old publication kept as .bak', async () => {
  const pid = await newProject('JSSDM merge');
  const base = `/api/projects/${pid}/jssdm`;
  const chapters = (await alice.get(`/api/projects/${pid}/pmc`)).json.entries.length;
  const r = await alice.post(`${base}/generate`, { frontMatter: FM, publication: PUB, ids: IDS, pm: 'merge' });
  assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.json.pm.action, 'merged');
  assert.equal(r.json.pm.backup, 'publication.xml.bak');
  const pm = (await alice.get(`/api/projects/${pid}/pmc`)).json;
  assert.equal(pm.entries[0].type, 'folder');
  assert.equal(pm.entries[0].title, 'Front matter');
  assert.equal(pm.entries[0].children.length, 3);
  assert.equal(pm.entries.length, chapters + 1, 'the existing entries follow, untouched');
  assert.equal(pm.pool.length, 0, 'every generated module is placed');

  const again = await alice.post(`${base}/generate`, { frontMatter: FM, publication: PUB, ids: IDS, pm: 'merge' });
  assert.equal(again.json.pm.action, 'merged');
  const pm2 = (await alice.get(`/api/projects/${pid}/pmc`)).json;
  assert.equal(pm2.entries.filter((e) => e.type === 'folder' && e.title === 'Front matter').length, 1, 'never a second folder');
  assert.equal(pm2.entries.length, chapters + 1);
});

test('generate: input that would make an invalid module is refused with a reason, before anything is written', async () => {
  const pid = await newProject('JSSDM invalid');
  const post = (b) => alice.post(`/api/projects/${pid}/jssdm/generate`, b);
  for (const [body, code] of [
    [{ ids: { modelIdentCode: 'lower case' } }, 'BAD_IDS'],
    [{ ids: { modelIdentCode: 'X' } }, 'BAD_IDS'],
    [{ ids: { itemLocationCode: 'Z' } }, 'BAD_IDS'],
    [{ ids: { languageIsoCode: 'English' } }, 'BAD_IDS'],
    [{ ids: { techName: 'a<b' } }, 'BAD_IDS'],
    [{ ids: { rpc: { enterpriseCode: 'nope', enterpriseName: 'X' } } }, 'BAD_IDS'],
    [{ ids: { issueDate: { year: '26', month: '1', day: '1' } } }, 'BAD_IDS'],
    [{ ids: { somethingElse: 'x' } }, 'BAD_IDS'],
    [{ ids: 'x' }, 'BAD_IDS'],
    [{ pages: ['titlePage', 'nonsense'] }, 'BAD_PAGES'],
    [{ pages: 'titlePage' }, 'BAD_PAGES'],
    [{ pm: 'replace' }, 'BAD_PM'],
    [{ frontMatter: 'x' }, 'BAD_FRONT_MATTER'],
    [{ frontMatter: [] }, 'BAD_FRONT_MATTER'],
    [{ publication: 5 }, 'BAD_PUBLICATION'],
  ]) {
    const r = await post({ frontMatter: FM, ...body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.code, code, JSON.stringify(body));
  }
  assert.deepEqual(await dmFiles(pid), []);
  // a valid identity set goes through
  const ok = await post({ frontMatter: FM, publication: PUB, pages: ['titlePage'], ids: { ...IDS, languageIsoCode: 'en', countryIsoCode: 'GB', issueNumber: '2', itemLocationCode: 'A', rpc: { enterpriseCode: '1A2B3', enterpriseName: 'Gen Co' } } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json).slice(0, 300));
  assert.deepEqual(ok.json.written.map((w) => w.file), ['DMC-GENH-A-00-00-00-00A-001A-A_002-00_EN-GB.xml']);
});

test('generating from the project\'s own saved settings when the request names none', async () => {
  const pid = await newProject('JSSDM saved');
  const s = await settings(pid);
  s.frontMatter = FM;
  s.publication = PUB;
  assert.equal((await alice.put(`/api/projects/${pid}/settings`, { project: s })).status, 200);
  const r = await alice.post(`/api/projects/${pid}/jssdm/generate`, { ids: IDS });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.written.map((w) => w.page), ['titlePage', 'proprietary', 'foreword']);
  assert.ok(r.json.report.some((e) => e.status === 'mapped'));
});

test('real data: JSS-0251 over HTTP - read into settings, then written out as seventeen valid modules the project accepts', { skip: NO_SAMPLE }, async () => {
  const pid = await newProject('JSSDM sample');
  await upload(pid, SAMPLE);
  await uploadPm(pid, path.join(SAMPLE, fs.readdirSync(SAMPLE).find((f) => /^PMC-/.test(f))));
  const base = `/api/projects/${pid}/jssdm`;
  const prev = await alice.post(`${base}/import-frontmatter`, {});
  assert.equal(prev.status, 200);
  assert.equal(prev.json.consumed.length, 17);
  assert.equal(prev.json.summary.notUnderstood, 0);
  assert.equal(prev.json.publication.securityClassification, '06');
  const ap = await alice.post(`${base}/import-frontmatter`, { apply: true });
  assert.equal(ap.json.consumedCount, 17);
  assert.ok(ap.json.emblem && /^csdb\/ICN-/.test(ap.json.emblem), 'the emblem is offered');
  const s = await settings(pid);
  assert.equal(s.frontMatter.recordOfChanges.rows, 19);
  assert.equal(s.publishers[0].name, 'L&T Precision Engineering and Systems');

  // the settings of that project go into a fresh one, which has none of the modules (ICN entities and all must pass the XML guard)
  const other = await newProject('JSSDM sample copy');
  const o = await settings(other);
  Object.assign(o, { frontMatter: s.frontMatter, publication: s.publication, publishers: s.publishers });
  assert.equal((await alice.put(`/api/projects/${other}/settings`, { project: o })).status, 200);
  const gen = await alice.post(`/api/projects/${other}/jssdm/generate`, { ids: { modelIdentCode: prev.json.ids.modelIdentCode }, pm: 'merge' });
  assert.equal(gen.status, 201, JSON.stringify(gen.json).slice(0, 500));
  assert.equal(gen.json.written.filter((w) => w.action === 'created').length, 17);
  assert.deepEqual(gen.json.skipped, []);
  assert.equal((await dmFiles(other)).length, 17);
  const pm = (await alice.get(`/api/projects/${other}/pmc`)).json;
  assert.equal(pmc.countEntries(pm.entries).dms, 17);
  assert.equal(pm.pool.length, 0);
});
