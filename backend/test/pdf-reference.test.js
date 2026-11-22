'use strict';
// Visual/PDF regression against the two publications supplied on 2026-11-20 (a User Handbook, RDR-1671Y-00031, and a Maintenance Manual,
// RDR-1671Y-00033). Their PDFs were made by another tool and are REFERENCES for what a finished publication looks like - not specifications.
//
// What is compared (the agreed criteria): data module codes, titles and issue dates in the table of contents; completeness of every data module's
// content; page count within a documented tolerance; intentionally blank pages. The cover and front matter come from each project's own
// settings (house template, branding), so they are RECORDED, not asserted. Nothing here claims pixel parity.
//
// Two adjustments to what the samples ship with, both required by the platform's own rules, both made on a COPY:
//   1. the samples name a project BREX (DMC-RDR-A-00-00-00-00A-022A-D) that is not in the zips: a stand-in BREX with that code is added;
//   2. the User Handbook's title-page module breaks the default BREX rules BREX-S1-00035 and -00113 (a responsiblePartnerCompany without a code
//      or name, no publisher name), so the publication gate refuses it: that one module is left out and reported.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const SAMPLES = path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'S1000D', '20_Nov _2026');
const FIX42 = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '4-2');
const PUBS = [
  { name: 'User Handbook (RDR-1671Y-00031)', zip: 'PMC-RDR-1671Y-00031-00_000-01.xml.zip', pdf: 'RDR-1671Y-00031-00 (1).pdf', skip: [/-B-A00-00-00-21A-001A-D_/] },
  { name: 'Maintenance Manual (RDR-1671Y-00033)', zip: 'PMC-RDR-1671Y-00033-00_000-01.xml (1).zip', pdf: 'RDR-1671Y-00033-00.pdf', skip: [] },
];
const have = fs.existsSync(SAMPLES);
const flat = (s) => s.toLowerCase().replace(/[\s­-]+/g, '');
const pages = (pdf) => spawnSync('pdftotext', ['-raw', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\f').slice(0, -1);
// Setup, not verification: the sample ZIPs are unpacked with the platform's own reader, so the test needs no Info-ZIP `unzip` (absent on Windows).
const unzip = async (zip, to) => { const r = require('../dist/services/zipio').ZipFileReader.open(zip); try { await r.extractTo(to); } finally { r.close(); } };
const RESULTS = {};

let h; let w;
test.before(async () => {
  if (!have) return;
  h = await boot();
  const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'ref', fullName: 'Ref Author', role: 'author' });
  w = new h.Client('ref');
  await w.post('/api/auth/login', { username: 'ref', password: made.json.tempPassword });
  await w.post('/api/auth/onboarding', { username: 'ref', password: PW });
});
test.after(async () => {
  const out = path.join(__dirname, '..', '..', 'frontend', 'verification-results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'pdf-reference.json'), JSON.stringify(RESULTS, null, 1));
  if (h) await h.close();
});

for (const pub of PUBS) {
  test(`${pub.name}: our PDF carries the same data modules, titles, dates and content as the reference`, { skip: !have && 'the 20 Nov samples are not in this checkout', timeout: 300000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-'));
    await unzip(path.join(SAMPLES, pub.zip), dir);
    const files = fs.readdirSync(dir);
    const dmFiles = files.filter((f) => /^DMC-.*\.xml$/i.test(f) && !pub.skip.some((re) => re.test(f)));
    const skipped = files.filter((f) => /^DMC-.*\.xml$/i.test(f) && pub.skip.some((re) => re.test(f)));
    // the references are in the direct S1000D layout (a table of contents of data module codes and issue dates), so they are compared with that engine
    const pid = (await w.post('/api/projects', { name: pub.name, pipeline: 's1000dtofo' })).json.project.id;

    const fd = new FormData();
    for (const f of dmFiles) fd.append('files', new Blob([fs.readFileSync(path.join(dir, f))]), f);
    assert.equal((await w.req('POST', `/api/projects/${pid}/dms-import`, fd)).status, 200);
    for (const f of files.filter((n) => /\.(png|jpe?g)$/i.test(n))) {
      const g = new FormData(); g.append('file', new Blob([fs.readFileSync(path.join(dir, f))]), f); g.append('dir', 'csdb');
      assert.equal((await w.req('POST', `/api/projects/${pid}/media`, g)).status, 200, f);
    }
    // stand-in project BREX (no rules beyond the fixture's two), named as the samples name it
    const fixBrex = fs.readdirSync(FIX42).find((f) => /-022A-D_/.test(f));
    const brex = fs.readFileSync(path.join(FIX42, fixBrex), 'utf8').replace(/modelIdentCode="EXAMPLE"([^>]*infoCode="022")/, 'modelIdentCode="RDR"$1').replace('countryIsoCode="US"', 'countryIsoCode="IN"');
    assert.equal((await w.post(`/api/projects/${pid}/dms`, { file: 'DMC-RDR-A-00-00-00-00A-022A-D_001-00_EN-IN.xml', xml: brex })).status, 201);
    const pmf = files.find((f) => /^PMC/i.test(f));
    const pm = new FormData(); pm.append('file', new Blob([fs.readFileSync(path.join(dir, pmf))]), pmf);
    assert.equal((await w.req('POST', `/api/projects/${pid}/pmc/import`, pm)).status, 200);

    const built = await w.post(`/api/projects/${pid}/publish`, {});
    assert.equal(built.status, 200, JSON.stringify(built.json).slice(0, 600));
    const ours = path.join(dir, 'ours.pdf'); fs.writeFileSync(ours, (await w.get(`/api/projects/${pid}/publish/pdf`)).buf);
    const refPdf = path.join(SAMPLES, pub.pdf);
    const refPages = pages(refPdf); const ourPages = pages(ours);
    const refText = flat(refPages.join(' ')); const ourText = flat(ourPages.join(' '));

    // what each data module is
    const mods = dmFiles.map((f) => {
      const xml = fs.readFileSync(path.join(dir, f), 'utf8');
      const code = f.replace(/^DMC-/i, '').replace(/_.*$/, '');
      const g = (re) => (re.exec(xml) || [])[1]?.replace(/\s+/g, ' ').trim() ?? '';
      const date = (/<issueDate year="(\d+)" month="(\d+)" day="(\d+)"/.exec(xml) || []).slice(1).join('-');
      const body = (xml.split('<content')[1] ?? '').replace(/<[^>]*>/g, ' ');
      return { f, code, tech: g(/<techName>([\s\S]*?)<\/techName>/), info: g(/<infoName>([\s\S]*?)<\/infoName>/), date, words: [...new Set((body.toLowerCase().match(/[a-z][a-z0-9]{4,}/g) ?? []))] };
    });
    const publishable = mods.filter((m) => !/-001A-D$/.test(m.code) || true);
    const rec = (RESULTS[pub.name] = { dataModules: mods.length, skipped, referencePages: refPages.length, ourPages: ourPages.length, differences: [] });

    // 1. codes, titles, issue dates (TOC)
    const noCode = publishable.filter((m) => !ourText.includes(flat(m.code)));
    const noTitle = publishable.filter((m) => m.tech && !ourText.includes(flat(m.tech)));
    const noDate = publishable.filter((m) => m.date && !ourText.includes(flat(m.date)));
    rec.codesInReferenceToc = publishable.filter((m) => refText.includes(flat(m.code))).length;
    rec.codesInOurPdf = publishable.length - noCode.length;
    rec.datesMissing = noDate.map((m) => m.code);
    assert.deepEqual(noCode.map((m) => m.code), [], 'every data module code is in our PDF (table of contents)');
    assert.deepEqual(noTitle.map((m) => `${m.code}: ${m.tech}`), [], 'every data module title is in our PDF');
    assert.deepEqual(noDate.map((m) => `${m.code}: ${m.date}`), [], 'every issue date is in our PDF');

    // 2. completeness of content
    const missingWords = publishable.flatMap((m) => m.words.filter((x) => !ourText.includes(x)).map((x) => `${m.code}: ${x}`));
    rec.contentWords = publishable.reduce((a, m) => a + m.words.length, 0); rec.contentWordsMissing = missingWords.length;
    rec.contentWordsMissingInReference = publishable.reduce((a, m) => a + m.words.filter((x) => !refText.includes(x)).length, 0);
    assert.deepEqual(missingWords.slice(0, 20), [], 'every word of every data module reaches our PDF');

    // 3. page count within a documented tolerance, 4. intentionally blank pages
    const blank = (ps) => ps.filter((p) => /intentionally left blank/i.test(p)).length;
    rec.blankPagesReference = blank(refPages); rec.blankPagesOurs = blank(ourPages);
    rec.pageRatio = Number((ourPages.length / refPages.length).toFixed(2));
    assert.ok(ourPages.length >= refPages.length * 0.5 && ourPages.length <= refPages.length * 2, `page count ${ourPages.length} vs reference ${refPages.length}: within 0.5x-2x (front matter and styling differ by design)`);
    assert.ok(rec.blankPagesOurs > 0 && rec.blankPagesReference > 0, 'both print intentionally blank pages (so chapters start on the right-hand page)');

    // 5. what differs, recorded honestly (not asserted)
    const refTitle = pub.name.split(' (')[0];
    const coverText = (ps) => flat(ps.slice(0, 3).join(' '));
    for (const [label, needle] of [['"RESTRICTED" marking on the cover', 'restricted'], ['publication number on the cover', 'rdr-1671y-0003'], ['"Fire Control Radar" system name on the cover', 'firecontrolradar']]) {
      const r = coverText(refPages).includes(needle); const o = coverText(ourPages).includes(needle);
      if (r !== o) rec.differences.push(`${label}: reference ${r ? 'has' : 'lacks'} it, ours ${o ? 'has' : 'lacks'} it`);
    }
    if (skipped.length) rec.differences.push(`left out because the platform's publication gate refuses it (default BREX BREX-S1-00035 and -00113): ${skipped.join(', ')}`);
    rec.differences.push(`page count: reference ${refPages.length}, ours ${ourPages.length} (x${rec.pageRatio}); tolerance 0.5x-2x. Layouts differ (stencil, front matter, fonts, table styling)`);
    void refTitle;
  });
}
