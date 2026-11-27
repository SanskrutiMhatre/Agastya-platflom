'use strict';
// End to end, per data module type, through the real server: create -> read back -> edit with the
// concurrency token -> XSD validation -> server PDF preview (text really present) -> full publication.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, RESULTS, DM21 } = require('./helpers');
const { readPdf } = require('./pdftools');

const FIX = path.join(__dirname, 'fixtures', 'rich');
const PW = 'Correct-Horse-9!';
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';

// file -> [label, text that must appear in the rendered PDF (compared case-insensitively: warnings print in capitals)]
// BREX and the common repository are *support* modules. Their bodies used to be missing from the PDF (a known gap, tracked as `todo`);
// support-view.xsl now prints them, so they are checked like every other type (all 21 types: test/pdf21.test.js).
const TYPES = {
  'DMC-EXAMPLE-A-00-00-00-00A-040A-D_001-00_EN-US.XML': ['descriptive', 'Hazardous voltage'],
  'DMC-EXAMPLE-A-00-00-00-00A-520A-D_001-00_EN-US.XML': ['procedural', 'Remove the four screws'],
  'DMC-EXAMPLE-A-00-00-00-00A-421A-D_001-00_EN-US.XML': ['fault isolation', 'Measure the supply voltage'],
  'DMC-EXAMPLE-A-00-00-00-00A-131A-D_001-00_EN-US.XML': ['crew', 'Fuel selector'],
  'DMC-EXAMPLE-A-00-00-00-00A-941A-D_001-00_EN-US.XML': ['illustrated parts', 'PN-0002-ALT'],
  'DMC-EXAMPLE-A-00-00-00-00A-022A-D_001-00_EN-US.XML': ['brex', 'Strikethrough'],
  'DMC-EXAMPLE-A-00-00-00-00A-00LA-D_001-00_EN-US.XML': ['common repository', 'Hot surface'],
};

// pdf.js (test/pdftools.js): no external program, no temp file
async function pdfText(buf, first, last) {
  return (await readPdf(buf)).text(first ? { first, last: last ?? first } : {});
}

// per type x issue results of the issue-wide tests below, written for the verification report
const SCHEMAS21 = ['descript', 'proced', 'fault', 'crew', 'ipd', 'brex', 'comrep', 'appliccrossreftable', 'condcrossreftable', 'prdcrossreftable', 'brdoc', 'checklist', 'container', 'frontmatter', 'learning', 'process', 'sb', 'schedul', 'scocontent', 'wrngdata', 'wrngflds'];
const REC = {};
const rec = (names, issue, field, ok) => names.forEach((f, i) => { ((REC[`${SCHEMAS21[i]}/${issue}`] ??= {})[field] = ok); });
let h; let admin; let w; let pid;
test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda Writer', role: 'author' });
  w = new h.Client('wanda');
  await w.post('/api/auth/login', { username: 'wanda', password: made.json.tempPassword });
  await w.post('/api/auth/onboarding', { username: 'wanda', password: PW });
  const p = await w.post('/api/projects', { name: 'Seven types', pipeline: 's1000dtofo' });
  assert.equal(p.status, 201);
  pid = p.json.project.id;
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(FIX, ICN))]), ICN);
  fd.append('dir', 'csdb');
  assert.equal((await w.req('POST', `/api/projects/${pid}/media`, fd)).status, 200);
});
test.after(async () => {
  const out = RESULTS;                                    // AGASTYA_TEST_RESULTS, else frontend/verification-results (helpers.js)
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'backend.json'), JSON.stringify(REC, null, 1));
  await h.close();
});

for (const [file, [label, marker]] of Object.entries(TYPES)) {
  test(`${label}: create, read back, edit with the concurrency token, refuse a stale save`, async () => {
    const xml = fs.readFileSync(path.join(FIX, file), 'utf8');
    const c = await w.post(`/api/projects/${pid}/dms`, { file, xml });
    assert.equal(c.status, 201, JSON.stringify(c.json));
    const got = await w.get(`/api/projects/${pid}/dms/${file}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.xml.replace(/\r\n/g, '\n'), xml.replace(/\r\n/g, '\n'), 'the server stores exactly what was sent');
    const edited = got.json.xml.replace('</content>', '<!-- edited --></content>');
    const ok = await w.put(`/api/projects/${pid}/dms/${file}`, { xml: edited, baseHash: got.json.hash });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const stale = await w.put(`/api/projects/${pid}/dms/${file}`, { xml: edited, baseHash: got.json.hash });
    assert.equal(stale.status, 409, 'a save based on an old hash is refused');
  });
}

test('XSD validation: no schema errors in any of the seven modules', async () => {
  const r = await w.post(`/api/projects/${pid}/validation`, { issue: 'auto', brex: false });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
  assert.equal(r.json.run.schemaChecked, 7, 'all seven modules were really schema-checked');
  assert.deepEqual(r.json.run.issues.filter((i) => /could not run/i.test(i.title)).map((i) => i.detail.slice(0, 200)), [], 'the XSD check never silently skips');
  const bad = r.json.run.issues.filter((i) => (i.source === 'xsd' || i.source === 'xml') && i.sev === 'error');
  assert.deepEqual(bad.map((i) => `${i.file}: ${i.title}`), []);
});

const SUPPORT = new Set([]);          // nothing is exempt any more
test('XSD validation is really running: an illegal tag in each type is reported (negative control)', async () => {
  const breaks = {
    'DMC-EXAMPLE-A-00-00-00-00A-040A-D_001-00_EN-US.XML': ['<levelledPara id="lp-0001">', '<levelledPara id="lp-0001"><proceduralStep/>'],
    'DMC-EXAMPLE-A-00-00-00-00A-520A-D_001-00_EN-US.XML': ['<mainProcedure>', '<mainProcedure><levelledPara/>'],
    'DMC-EXAMPLE-A-00-00-00-00A-421A-D_001-00_EN-US.XML': ['<isolationMainProcedure>', '<isolationMainProcedure><para/>'],
    'DMC-EXAMPLE-A-00-00-00-00A-131A-D_001-00_EN-US.XML': ['<crewRefCard>', '<crewRefCard><proceduralStep/>'],
    'DMC-EXAMPLE-A-00-00-00-00A-941A-D_001-00_EN-US.XML': ['<illustratedPartsCatalog>', '<illustratedPartsCatalog><proceduralStep/>'],
    'DMC-EXAMPLE-A-00-00-00-00A-022A-D_001-00_EN-US.XML': ['<contextRules>', '<contextRules><proceduralStep/>'],
    'DMC-EXAMPLE-A-00-00-00-00A-00LA-D_001-00_EN-US.XML': ['<commonRepository>', '<commonRepository><proceduralStep/>'],
  };
  for (const [file, [from, to]] of Object.entries(breaks)) {
    const got = (await w.get(`/api/projects/${pid}/dms/${file}`)).json;
    assert.ok(got.xml.includes(from), `fixture anchor present in ${file}`);
    assert.equal((await w.put(`/api/projects/${pid}/dms/${file}`, { xml: got.xml.replace(from, to), baseHash: got.hash })).status, 200);
  }
  const r = await w.post(`/api/projects/${pid}/validation`, { issue: 'auto', brex: false });
  const flagged = new Set(r.json.run.issues.filter((i) => i.sev === 'error' && (i.source === 'xsd' || i.source === 'xml')).map((i) => i.file));
  const missed = Object.keys(breaks).filter((f) => ![...flagged].some((x) => String(x).includes(f)));
  assert.deepEqual(missed, [], 'every broken module is flagged');
  // restore the good content for the tests below
  for (const [file, [from, to]] of Object.entries(breaks)) {
    const got = (await w.get(`/api/projects/${pid}/dms/${file}`)).json;
    await w.put(`/api/projects/${pid}/dms/${file}`, { xml: got.xml.replace(to, from), baseHash: got.hash });
  }
});

for (const [file, [label, marker]] of Object.entries(TYPES)) {
  test(`${label}: server PDF quick preview is built and carries the module title`, { timeout: 120000 }, async () => {
    const pv = await w.req('POST', `/api/projects/${pid}/publish/preview/${file}`, {});
    assert.equal(pv.status, 200, pv.json ? JSON.stringify(pv.json).slice(0, 600) : '');
    assert.equal(pv.buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok((await pdfText(pv.buf)).replace(/\s+/g, '').toLowerCase().includes('examplesystem'), 'module title in the PDF');
  });
  test(`${label}: server PDF contains its real content`, { timeout: 120000, todo: SUPPORT.has(label) ? 'support module: body not rendered by the FOP stylesheets' : false }, async () => {
    const pv = await w.req('POST', `/api/projects/${pid}/publish/preview/${file}`, {});
    assert.equal(pv.status, 200, pv.json ? JSON.stringify(pv.json).slice(0, 600) : '');
    assert.equal(pv.buf.subarray(0, 5).toString(), '%PDF-');
    const text = await pdfText(pv.buf);
    assert.ok(text.toLowerCase().includes(marker.toLowerCase()), `"${marker}" missing from the ${label} PDF. Text was:\n${text.slice(0, 1500)}`);
  });
}

test('full publication of all seven types builds one PDF containing all of them', { timeout: 240000 }, async () => {
  const pmc = (await w.get(`/api/projects/${pid}/pmc`)).json;
  const list = (await w.get(`/api/projects/${pid}/dms`)).json.dms;
  const entries = [{ type: 'folder', title: 'All types', children: list.map((d) => ({ type: 'dm', dmCode: d.dmCodeAttrs, issueInfo: d.issueInfoAttrs, language: d.languageAttrs, techName: d.techName, infoName: d.infoName })) }];
  assert.equal((await w.put(`/api/projects/${pid}/pmc`, { meta: pmc.meta, entries, baseHash: (await w.get(`/api/projects/${pid}/pmc`)).json.hash })).status, 200);
  const build = await w.post(`/api/projects/${pid}/publish`, {});
  assert.equal(build.status, 200, JSON.stringify(build.json).slice(0, 800));
  const pdf = await w.get(`/api/projects/${pid}/publish/pdf`);
  assert.equal(pdf.buf.subarray(0, 5).toString(), '%PDF-');
  const text = await pdfText(pdf.buf);
  const missing = Object.values(TYPES).filter(([l, m]) => !SUPPORT.has(l) && !text.toLowerCase().includes(m.toLowerCase())).map(([l, m]) => `${l}: "${m}"`);
  assert.deepEqual(missing, []);
});

// The server really schema-checks every issue the wizard offers. Issues 6 and 7 were silently skipped before: their declaration
// (S1000D_6 / S1000D_7, no minor number) was not understood and no Issue 7 schema set was installed.
for (const issue of ['4-2', '5-0', '6', '7']) {
  test(`server XSD validation covers all 21 types on issue ${issue} (none skipped)`, { timeout: 120000 }, async () => {
    const dir = path.join(DM21, issue);
    const p = await w.post('/api/projects', { name: `All 21 on ${issue}`, pipeline: 's1000dtofo' });
    assert.equal(p.status, 201);
    const id = p.json.project.id;
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(path.join(dir, '..', ICN))]), ICN);
    fd.append('dir', 'csdb');
    assert.equal((await w.req('POST', `/api/projects/${id}/media`, fd)).status, 200);
    const names = SCHEMAS21.map((t) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))[t]);
    assert.equal(names.length, 21);
    for (const f of names) assert.equal((await w.post(`/api/projects/${id}/dms`, { file: f, xml: fs.readFileSync(path.join(dir, f), 'utf8') })).status, 201, f);
    const r = await w.post(`/api/projects/${id}/validation`, { issue: 'auto', brex: false });
    rec(names, issue, 'schemaChecked', r.json.run.schemaChecked === 21);
    assert.equal(r.json.run.schemaChecked, 21, `schema-checked ${r.json.run.schemaChecked} of 21; notes: ${JSON.stringify(r.json.run.issues.filter((i) => /Not checked|could not run/i.test(i.title)).slice(0, 2))}`);
    const errs = r.json.run.issues.filter((i) => (i.source === 'xsd' || i.source === 'xml') && i.sev === 'error').map((i) => `${i.file}: ${i.title}`);
    rec(names, issue, 'serverXsdClean', errs.length === 0);
    assert.deepEqual(errs, []);
  });
}

// The server never silently accepts malformed XML. Before, an unclosed tag, a mismatched tag or a truncated file was stored with 200 (only the
// editor asked "save anyway?"). Well-formed but schema-invalid XML is still saved (work in progress) and is reported by validation.
for (const issue of ['4-2', '5-0', '6', '7']) {
  test(`malformed XML is refused and schema-invalid XML is reported, for all 21 types on issue ${issue}`, { timeout: 180000 }, async () => {
    const dir = path.join(DM21, issue);
    const p = await w.post('/api/projects', { name: `Malformed ${issue}`, pipeline: 's1000dtofo' });
    const id = p.json.project.id;
    const names = SCHEMAS21.map((t) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))[t]);
    assert.equal(names.length, 21);
    for (const f of names) assert.equal((await w.post(`/api/projects/${id}/dms`, { file: f, xml: fs.readFileSync(path.join(dir, f), 'utf8') })).status, 201, `create ${f}`);
    for (const f of names) {
      const cur = (await w.get(`/api/projects/${id}/dms/${f}`)).json;
      const variants = {
        'an unclosed tag': cur.xml.replace('</content>', '<zzBroken></content>'),
        'mismatched tags': cur.xml.replace('<content>', '<content><b>'),
        'a truncated file': cur.xml.slice(0, cur.xml.length - 40),
        'an unquoted attribute': cur.xml.replace('<content>', '<content id=x1>'),
      };
      for (const [what, xml] of Object.entries(variants)) {
        const r = await w.put(`/api/projects/${id}/dms/${f}`, { xml, baseHash: cur.hash });
        REC[`${SCHEMAS21[names.indexOf(f)]}/${issue}`].malformedRefused = (REC[`${SCHEMAS21[names.indexOf(f)]}/${issue}`].malformedRefused ?? 0) + (r.status === 400 && r.json.code === 'MALFORMED_XML' ? 1 : 0);
        assert.equal(r.status, 400, `${f}: ${what} was not refused (${r.status})`);
        assert.equal(r.json.code, 'MALFORMED_XML', `${f}: ${what}`);
        assert.equal((await w.get(`/api/projects/${id}/dms/${f}`)).json.hash, cur.hash, `${f}: the stored module changed after a refused save`);
      }
    }
    // well-formed but not valid against the schema: saved, and validation names every one of them
    for (const f of names) {
      const cur = (await w.get(`/api/projects/${id}/dms/${f}`)).json;
      assert.equal((await w.put(`/api/projects/${id}/dms/${f}`, { xml: cur.xml.replace('<content>', '<content><zzNope/>'), baseHash: cur.hash })).status, 200, f);
    }
    const r = await w.post(`/api/projects/${id}/validation`, { issue: 'auto', brex: false });
    const flagged = new Set(r.json.run.issues.filter((i) => i.source === 'xsd' && i.sev === 'error').map((i) => i.file));
    names.forEach((f, i) => { (REC[`${SCHEMAS21[i]}/${issue}`] ??= {}).schemaInvalidReported = flagged.has(f); });
    assert.deepEqual(names.filter((f) => !flagged.has(f)), [], 'every schema-invalid module is reported');
  });
}
