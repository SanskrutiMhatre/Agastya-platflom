'use strict';
// Phase 8 (docs/phase3/cleanup-backend.md): the performance follow-ups must give the same answers as the slow paths they replace.
//   * storage/atomicWrite.ts writeFilesAtomic: every file written; a failure before the renames changes no target and leaves no temporary
//     file; a failure among the renames names the files already renamed;
//   * the package import's grouped module writes (csdb.createDms): every module, its revision and its document identity, as before; a
//     duplicate inside one group rolls the import back;
//   * deleteDm marks the one document missing, exactly as a full sync of the project would;
//   * the publication append (pm.ts appendedPmText / placeNewDm) writes the same bytes as the full rewrite, on several real publications;
//   * BREX and applicability incremental: a validation after an edit equals a validation with every cache emptied.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.AGASTYA_JOBS = 'inline';
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM_DESC = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const DM_PROC = 'DMC-S1KSTUDIO-A-29-10-00-00A-520A-A_001-00_EN-US.XML';
const DM_IPD = 'DMC-S1KSTUDIO-A-29-10-00-00A-421A-A_001-00_EN-US.XML';
let h; let author; let pid; let dir; let csdbDir; let csdbRelPath;

test.before(async () => {
  h = await boot();
  const admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  const made = await admin.post('/api/team/users', { username: 'phase8', fullName: 'Phase Eight', role: 'author' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  author = new h.Client('phase8');
  assert.equal((await author.post('/api/auth/login', { username: 'phase8', password: made.json.tempPassword })).status, 200);
  assert.equal((await author.post('/api/auth/onboarding', { username: 'phase8', password: PW })).status, 200);
  const p = await author.post('/api/projects', { name: 'Phase eight', pipeline: 's1000dtofo' });
  assert.equal(p.status, 201, JSON.stringify(p.json));
  pid = p.json.project.id;
  dir = path.join(h.ws, 'projects', pid);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  csdbRelPath = pj.csdbDir || 'csdb';
  csdbDir = path.join(dir, csdbRelPath);
  assert.equal((await author.post(`/api/projects/${pid}/dms`, { file: DM_DESC, xml: h.sample(DM_DESC) })).status, 201);
});
test.after(async () => { if (h) await h.close(); });

const temps = (d) => fs.readdirSync(d).filter((f) => /\.tmp-\d+-[0-9a-f]{12}$/.test(f));

test('writeFilesAtomic: all written; a failure before the renames changes nothing; a failure among them names what was renamed', async () => {
  const { writeFilesAtomic, BatchWriteError, atomicFaults } = require('../dist/storage/atomicWrite');
  const d = path.join(h.ws, 'batch-write'); fs.mkdirSync(d, { recursive: true });
  const t = (n) => path.join(d, `f${n}.xml`);
  fs.writeFileSync(t(1), 'old 1'); fs.writeFileSync(t(2), 'old 2');
  await writeFilesAtomic([1, 2, 3, 4].map((n) => ({ target: t(n), data: `new ${n}` })));
  for (const n of [1, 2, 3, 4]) assert.equal(fs.readFileSync(t(n), 'utf8'), `new ${n}`);
  assert.deepEqual(temps(d), []);
  // precommit refuses: no target changes, no temporary file stays
  await assert.rejects(writeFilesAtomic([1, 5].map((n) => ({ target: t(n), data: `newer ${n}` })), () => { throw new Error('refused'); }), /refused/);
  assert.equal(fs.readFileSync(t(1), 'utf8'), 'new 1'); assert.ok(!fs.existsSync(t(5))); assert.deepEqual(temps(d), []);
  // a fault at the second rename: the first is renamed (and named), the rest untouched, no temporary file stays
  let n = 0;
  atomicFaults.beforeRename = () => { if (++n === 2) throw new Error('disk gone'); };
  try {
    const err = await writeFilesAtomic([1, 2, 3].map((k) => ({ target: t(k), data: `third ${k}` }))).then(() => null, (e) => e);
    assert.ok(err instanceof BatchWriteError, String(err));
    assert.deepEqual(err.renamed, [t(1)]);
  } finally { atomicFaults.beforeRename = null; }
  assert.equal(fs.readFileSync(t(1), 'utf8'), 'third 1'); assert.equal(fs.readFileSync(t(2), 'utf8'), 'new 2'); assert.equal(fs.readFileSync(t(3), 'utf8'), 'new 3');
  assert.deepEqual(temps(d), []);
  await assert.rejects(writeFilesAtomic([{ target: t(1), data: 'a' }, { target: t(1), data: 'b' }]), /named twice/);
});

test('grouped module creates: every module with its revision and identity; a duplicate in one group writes nothing', async () => {
  const csdb = require('../dist/services/csdb');
  const { docIndex } = require('../dist/context');
  const actor = { id: 'phase8-test', username: 'phase8' };
  const files = [DM_PROC, DM_IPD];
  // the same identity twice inside one group: refused before anything is written
  const other = 'DMC-S1KSTUDIO-A-29-10-00-00A-520A-B_001-00_EN-US.XML';
  await assert.rejects(csdb.createDms(pid, [{ file: DM_PROC, xml: h.sample(DM_PROC) }, { file: other, xml: h.sample(DM_PROC) }], actor, true), (e) => e.code === 'DUPLICATE_DMC');
  assert.ok(!fs.existsSync(path.join(csdbDir, DM_PROC)) && !fs.existsSync(path.join(csdbDir, other)));
  await csdb.createDms(pid, files.map((f) => ({ file: f, xml: h.sample(f) })), actor, false);
  for (const f of files) {
    assert.equal(fs.readFileSync(path.join(csdbDir, f), 'utf8'), h.sample(f));
    const doc = docIndex.resolve(pid, `${csdbRelPath}/${f}`); assert.ok(doc, `${f} has its identity`);
    const hist = csdb.history(pid, f); assert.equal(hist.length, 1); assert.equal(hist[0].reason, 'create');
  }
  assert.deepEqual(csdb.listDms(pid).map((d) => d.file).sort(), [DM_DESC, ...files].sort());
  assert.deepEqual(temps(csdbDir), []);
  // the identity of a module the project holds, under another name; and the existing name itself: refused, nothing changed
  await assert.rejects(csdb.createDms(pid, [{ file: other, xml: h.sample(DM_PROC) }], actor, true), (e) => e.code === 'DUPLICATE_DMC');
  await assert.rejects(csdb.createDms(pid, [{ file: DM_PROC, xml: h.sample(DM_PROC) }], actor, true), (e) => e.code === 'ALREADY_EXISTS');
  assert.ok(!fs.existsSync(path.join(csdbDir, other)));
  assert.deepEqual(temps(csdbDir), []);
  for (const f of files) await csdb.deleteDm(pid, f, { ...actor, role: 'admin' }, 'owner');
});

test('deleteDm marks the one document missing, as a full sync of the project would', async () => {
  const { docIndex, projectDirFor } = require('../dist/context');
  assert.equal((await author.post(`/api/projects/${pid}/dms`, { file: DM_PROC, xml: h.sample(DM_PROC) })).status, 201);
  const rel = `${csdbRelPath}/${DM_PROC}`;
  // (a module created again under a name deleted earlier keeps its row's missing mark until the next full sync, as before phase 8)
  await docIndex.syncProject(pid, projectDirFor(pid), new Date().toISOString());
  const before = docIndex.resolve(pid, rel); assert.ok(before && !before.missing_at);
  assert.equal((await author.del(`/api/projects/${pid}/dms/${DM_PROC}`)).status, 200);
  const after = docIndex.resolve(pid, rel);
  assert.equal(after.id, before.id, 'identity kept'); assert.ok(after.missing_at, 'marked missing');
  const rows = JSON.stringify(docIndex.listForProject(pid));
  await docIndex.syncProject(pid, projectDirFor(pid), new Date().toISOString());
  assert.equal(JSON.stringify(docIndex.listForProject(pid)), rows, 'a full sync changes nothing more');
  // created again: the same identity comes back
  assert.equal((await author.post(`/api/projects/${pid}/dms`, { file: DM_PROC, xml: h.sample(DM_PROC) })).status, 201);
  const again = docIndex.resolve(pid, rel); assert.equal(again.id, before.id);
});

function realPms() {
  const out = [];
  const ann = path.join(__dirname, 'fixtures', 'importer', 'xignal-annexures');
  for (const f of fs.readdirSync(ann).filter((x) => /^PMC-.*\.xml$/i.test(x)).slice(0, 6)) out.push([f, fs.readFileSync(path.join(ann, f), 'utf8')]);
  out.push(['jssdm PMC', fs.readFileSync(path.join(__dirname, 'fixtures', 'jssdm', 'PMC-FIXT-12345-00001-00_001-00_EN-GB.xml'), 'utf8')]);
  // the bench's 1,000-entry one-line publication (as a package brings it)
  const refs = []; for (let i = 1; i <= 1000; i++) refs.push(`<pmEntry><pmEntryTitle>M${i}</pmEntryTitle><dmRef><dmRefIdent><dmCode modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="${Math.floor(i / 1000) % 10}" subSubSystemCode="${Math.floor(i / 100) % 10}" assyCode="${String(i % 100).padStart(2, '0')}" disassyCode="00" disassyCodeVariant="A" infoCode="040" infoCodeVariant="A" itemLocationCode="D"/></dmRefIdent></dmRef></pmEntry>`);
  out.push(['1000 entries', `<?xml version="1.0"?><pm><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="EXAMPLE" pmIssuer="00000" pmNumber="00001" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="GB"/><issueInfo issueNumber="001" inWork="00"/></pmIdent><pmAddressItems><issueDate year="2025" month="01" day="01"/><pmTitle>Perf</pmTitle><shortPmTitle>P</shortPmTitle></pmAddressItems></pmAddress><pmStatus><security securityClassification="01"/></pmStatus></identAndStatusSection><content>${refs.join('')}</content></pm>`]);
  // an empty publication and one with an XInclude entry
  out.push(['empty', '<?xml version="1.0"?><pm><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="E" pmIssuer="00000" pmNumber="00002" pmVolume="00"/></pmIdent></pmAddress><pmStatus><security securityClassification="01"/></pmStatus></identAndStatusSection><content></content></pm>']);
  out.push(['include', '<?xml version="1.0"?><pm xmlns:xi="http://www.w3.org/2001/XInclude"><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="E" pmIssuer="00000" pmNumber="00003" pmVolume="00"/></pmIdent></pmAddress><pmStatus><security securityClassification="02"/></pmStatus></identAndStatusSection><content><pmEntry><pmEntryTitle>Ch &amp; 1</pmEntryTitle><pmEntry><xi:include href="csdb/DMC-A.xml"/></pmEntry></pmEntry></content></pm>']);
  return out;
}

test('the publication append writes exactly the bytes of the full rewrite (several real publications)', async () => {
  const pm = require('../dist/services/pm');
  const pmc = require('../vendor/engine/pmc');
  const abs = pm.pmPath(pid);
  const entry = { type: 'dm', title: 'New & <module>', dmCode: { modelIdentCode: 'S1KSTUDIO', systemDiffCode: 'A', systemCode: '29', subSystemCode: '1', subSubSystemCode: '0', assyCode: '00', disassyCode: '00', disassyCodeVariant: 'A', infoCode: '040', infoCodeVariant: 'A', itemLocationCode: 'D' }, techName: 'New & <module>', infoName: 'Description "x"' };
  let compared = 0;
  for (const [name, text] of realPms()) {
    fs.writeFileSync(abs, text);
    pm.writePm(pid, pmc.parsePm(text), true);                         // the full path: the file is now one writePm wrote
    let E = fs.readFileSync(abs, 'utf8');
    let kept = pmc.parsePm(E);
    let got = pm.appendedPmText(E, kept, entry);
    if (!got) {
      // the first rewrite of a foreign file may still change its header the next time (a completed <responsiblePartnerCompany> is read
      // back with an <enterpriseName>): then the append refuses, correctly, and the full rewrite after it is a fixed point
      pm.writePm(pid, kept, true);
      E = fs.readFileSync(abs, 'utf8'); kept = pmc.parsePm(E);
      got = pm.appendedPmText(E, kept, entry);
    }
    assert.ok(got, `${name}: the append path applies`);
    pm.writePm(pid, { ...kept, entries: [...kept.entries, entry] }, true);
    const F = fs.readFileSync(abs, 'utf8');
    assert.equal(got.text, F, `${name}: appended text = full rewrite`);
    assert.deepEqual(JSON.parse(JSON.stringify(got.entry)), JSON.parse(JSON.stringify(pmc.parsePm(F).entries.at(-1))), `${name}: the kept entry = a fresh parse`);
    compared++;
  }
  assert.ok(compared >= 9);
  // a file not written by writePm (edited by hand): no append, the full path
  const E = fs.readFileSync(abs, 'utf8');
  assert.equal(pm.appendedPmText(E.replace('</pm>\n', '</pm>\n\n'), pmc.parsePm(E), entry), null);
});

test('placeNewDm appends (same bytes as the full rewrite) and the kept model equals a fresh parse', async () => {
  const pm = require('../dist/services/pm');
  const pmc = require('../vendor/engine/pmc');
  const csdb = require('../dist/services/csdb');
  const abs = pm.pmPath(pid);
  // a publication the full path wrote, with the module already there
  fs.writeFileSync(abs, realPms().find(([n]) => n === '1000 entries')[1]);
  pm.writePm(pid, pmc.parsePm(fs.readFileSync(abs, 'utf8')), true);
  pm.writePm(pid, pmc.parsePm(fs.readFileSync(abs, 'utf8')), true);   // the fixed point (see the test above)
  const E = fs.readFileSync(abs, 'utf8');
  await csdb.deleteDm(pid, DM_PROC, { id: 'x', username: 'x', role: 'admin' }, 'owner');
  const stats = { ...pm.placeStats };
  assert.equal((await author.post(`/api/projects/${pid}/dms`, { file: DM_PROC, xml: h.sample(DM_PROC) })).status, 201);
  assert.equal(pm.placeStats.appended, stats.appended + 1, 'placed by the append path');
  const G = fs.readFileSync(abs, 'utf8');
  const kept = pm.readPm(pid);
  // the full rewrite from the same starting file
  const d = csdb.dmSummaryOf(pid, DM_PROC);
  fs.writeFileSync(abs, E);
  pm.writePm(pid, { ...pmc.parsePm(E), entries: [...pmc.parsePm(E).entries, { type: 'dm', title: d.techName || d.dmc, dmCode: d.dmCodeAttrs, techName: d.techName, infoName: d.infoName }] }, true);
  assert.equal(G, fs.readFileSync(abs, 'utf8'));
  assert.equal(kept.counts.dms, 1001);
  fs.writeFileSync(abs, G);
  assert.deepEqual(JSON.parse(JSON.stringify(pm.readPm(pid).entries)), JSON.parse(JSON.stringify(pm.parseModel(G).entries)));
  // a second create appends again on top of the first
  await csdb.deleteDm(pid, DM_IPD, { id: 'x', username: 'x', role: 'admin' }, 'owner').catch(() => undefined);
  assert.equal((await author.post(`/api/projects/${pid}/dms`, { file: DM_IPD, xml: h.sample(DM_IPD) })).status, 201);
  assert.equal(pmc.countEntries(pmc.parsePm(fs.readFileSync(abs, 'utf8')).entries).dms, 1002);
});

test('BREX and applicability incremental: a validation after an edit equals one with every cache emptied', async () => {
  const validation = require('../dist/services/validation');
  const brex = require('../dist/services/brex');
  const applic = require('../dist/services/applicability');
  const strip = (r) => JSON.stringify({ issues: r.issues.map(({ id: _id, ...i }) => i), summary: r.summary, notes: r.notes, brexChecked: r.brexChecked });
  await validation.runValidation(pid, { brex: true });
  await validation.runValidation(pid, { brex: true });
  const f = path.join(csdbDir, DM_DESC);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/<techName>[^<]*<\/techName>/, '<techName>Edited for phase 8</techName>').replace('<description>', '<description><para applicRefId="nowhere">x</para>'));
  const incremental = await validation.runValidation(pid, { brex: true });
  brex.clearBrexResults(); brex.clearBrexModuleFacts(); applic.clearApplicKept();
  const full = await validation.runValidation(pid, { brex: true });
  assert.equal(strip(incremental), strip(full));
  assert.ok(incremental.issues.some((i) => /applicRefId="nowhere"/.test(i.detail ?? '')), 'the edit is seen by the applicability check');
});
