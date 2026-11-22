'use strict';
// Importing many data modules: the per-request file limit and its message, long DOCTYPEs, import without validation.

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';

let h; let admin; let alice; let pid;

const form = (files, extra = {}) => {
  const fd = new FormData();
  for (const [name, content] of files) fd.append('files', new Blob([content], { type: 'application/xml' }), name);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
};
const importFiles = (files, extra = {}) => alice.req('POST', `/api/projects/${pid}/dms-import`, form(files, extra));
/** A copy of the sample module with its own assembly code (so every copy is a different data module). */
const variant = (n, xml = h.sample(DM)) => {
  const assy = String(n).padStart(4, '0').slice(-3);
  const code = `A${assy}`;
  return {
    name: `DMC-S1KSTUDIO-A-29-10-00-${code}-00A-040A-D_001-00_EN-US.XML`,
    xml: xml.replace('assyCode="00"', `assyCode="${code}"`),
  };
};

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  const made = await admin.post('/api/team/users', { username: 'alice', fullName: 'Alice Author', role: 'author' });
  alice = new h.Client('alice');
  await alice.post('/api/auth/login', { username: 'alice', password: made.json.tempPassword });
  await alice.post('/api/auth/onboarding', { username: 'alice', password: PW });
  pid = (await alice.post('/api/projects', { name: 'Import test' })).json.project.id;
});
test.after(async () => { await h.close(); });

test('more than 200 data modules in one import (the sample project has 218)', async () => {
  const files = Array.from({ length: 250 }, (_, i) => { const v = variant(i + 1); return [v.name, v.xml]; });
  const r = await importFiles(files);
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 300));
  assert.equal(r.json.imported.length, 250);
  assert.equal((await alice.get(`/api/projects/${pid}/dms`)).json.dms.length, 250);
});

test('over the limit: a clear message, not a bare 500', async () => {
  const files = Array.from({ length: 1001 }, (_, i) => [`DMC-X-${i}.XML`, '<dmodule/>']);
  const r = await importFiles(files);
  assert.equal(r.status, 413);
  assert.equal(r.json.code, 'TOO_MANY_FILES');
  assert.match(r.json.error, /at most 1000/);
});

test('a module with a very long DOCTYPE is still a data module, with its identity and title read', async () => {
  const v = variant(900);
  const entities = Array.from({ length: 300 }, (_, i) => `<!ENTITY ICN-TEST-${i} SYSTEM "ICN-RDR-A-GG10000-1-1671Y-00024-A-001-${i}.png" NDATA png>`).join('\n');
  const xml = v.xml.replace(/<!DOCTYPE dmodule \[/, `<!DOCTYPE dmodule [\n${entities}`);
  const at = xml.indexOf('<dmodule ');
  assert.ok(at > 20000, `prolog is ${at} bytes: longer than the old 20,000-byte window`);
  const r = await importFiles([[v.name, xml]]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const listed = (await alice.get(`/api/projects/${pid}/dms`)).json.dms.find((d) => d.file === v.name);
  assert.ok(listed.issueNumber && listed.language && listed.title, `identity read past the prolog: ${JSON.stringify(listed)}`);
});

test('import without validation: skips the enterprise check and the content rules', async () => {
  await admin.post('/api/admin/config/originator-cages', { cage: 'REG01', name: 'Registered Co', role: 'Originator' });
  const v = variant(901);
  const unregistered = v.xml.replace('<originator enterpriseCode="S1K01">', '<originator enterpriseCode="ZZZ99">');
  let r = await importFiles([[v.name, unregistered]]);
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'IMPORT_REFUSED');
  assert.ok(r.json.problems.length >= 1);
  assert.equal((await alice.get(`/api/projects/${pid}/dms`)).json.dms.some((d) => d.file === v.name), false, 'refused = nothing written');

  r = await importFiles([[v.name, unregistered]], { skipChecks: '1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await alice.get(`/api/projects/${pid}/dms`)).json.dms.some((d) => d.file === v.name), true);

  // the content rules are skipped too: a broken draft comes in, and is reported back instead of silently stored
  const good = variant(902);
  const broken = variant(903);
  const cut = broken.xml.slice(0, broken.xml.length - 200);
  r = await importFiles([[good.name, good.xml], [broken.name, cut]]);
  assert.equal(r.status, 400, 'without the option a broken file still refuses the whole batch');
  assert.ok(r.json.problems.some((p) => p.startsWith(broken.name) && /not well-formed/.test(p)), JSON.stringify(r.json.problems));
  assert.equal((await alice.get(`/api/projects/${pid}/dms`)).json.dms.some((d) => d.file === good.name), false, 'all-or-nothing');

  r = await importFiles([[good.name, good.xml], [broken.name, cut]], { skipChecks: '1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.imported.length, 2);
  assert.deepEqual(r.json.withProblems.map((w) => w.file), [broken.name], 'the file with content problems is reported, not hidden');
  assert.match(r.json.withProblems[0].problem, /not well-formed/);
});

test('never skipped: file names, safety rules and one copy of each data module', async () => {
  const ok = variant(910);
  // not a DMC-*.xml name
  let r = await importFiles([['notes.xml', ok.xml]], { skipChecks: '1' });
  assert.equal(r.status, 400);
  // an external entity (read a file from the server) stays refused
  const evil = ok.xml.replace('<!DOCTYPE dmodule [', '<!DOCTYPE dmodule [\n<!ENTITY xxe SYSTEM "file:///etc/passwd">');
  r = await importFiles([[variant(911).name, evil]], { skipChecks: '1' });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.ok(!(await alice.get(`/api/projects/${pid}/dms`)).json.dms.some((d) => d.file === variant(911).name));
  // two files with the same code/issue/language in one batch: refused up front, nothing written
  const a = variant(912); const b = { name: a.name.replace('A912', 'A912').replace('_001-00_', '_001-00_').replace('.XML', '.xml'), xml: a.xml };
  r = await importFiles([[a.name, a.xml], [b.name, b.xml]], { skipChecks: '1' });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.ok(r.json.problems.some((p) => /same data module/.test(p)), JSON.stringify(r.json.problems));
  assert.ok(!(await alice.get(`/api/projects/${pid}/dms`)).json.dms.some((d) => d.file === a.name));
});
