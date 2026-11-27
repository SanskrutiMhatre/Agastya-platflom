'use strict';
// WP-15 (PUB-011, PUB-017): JSG on the shared publication runner and release flow, and the PDF document properties of all three formats.
//   - a JSG build runs as a job with the warm FOP renderer, answers with its job id and build report, and stamps NOT RELEASED until a release is approved;
//   - a JSG document is submitted, gated (an invalid document is refused) and approved through the shared release routes; the next PDF is the clean
//     released copy; GET /jsg/pdf says when the file on disk no longer matches (X-Pdf-Stale) and what it claims (X-Release-State);
//   - the shared S1000D / JSS publish route refuses a JSG project instead of building it with the wrong engine;
//   - JSG, JSS and S1000D PDFs carry Title, Author, Subject and Keywords (read with pdf.js: test/pdftools.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');
const { readPdf } = require('./pdftools');

const PW = 'Correct-Horse-9!';
let h; let admin; let w;

test.before(async () => {
  h = await boot(); admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'jsgrel', fullName: 'Jsg Release', role: 'author' });
  w = new h.Client('jsgrel'); await w.post('/api/auth/login', { username: 'jsgrel', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'jsgrel', password: PW });
});
test.after(async () => { if (h) await h.close(); });

const dirOf = (id) => path.join(h.ws, 'projects', id);
const marked = (fo) => [...fo.matchAll(/<fo:simple-page-master\b[^>]*master-name="([^"]+)"[^>]*>[\s\S]*?<fo:region-body\b([^>]*)>/g)].filter((m) => /background-image=/.test(m[2])).map((m) => m[1]);

let jsgId;

test('a JSG build: a job on the warm renderer, with its report; NOT RELEASED on every page but the cover; document properties', { timeout: 300000 }, async () => {
  const r = await w.post('/api/projects', { name: 'Jsg release', format: 'jsg', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201); jsgId = r.json.project.id;
  const U = `/api/projects/${jsgId}`;
  const g = await w.get(`${U}/jsg`);
  const xml = g.json.xml.replace(/<projectName>[^<]*<\/projectName>/, '<projectName>Bridge Layer</projectName>').replace(/<docNo>[^<]*<\/docNo>/, '<docNo>UHB-0042</docNo>');
  assert.match(xml, /<projectName>Bridge Layer</); assert.match(xml, /<docNo>UHB-0042</);
  assert.equal((await w.put(`${U}/jsg`, { xml, baseHash: g.json.hash })).status, 200);
  const b = await w.post(`${U}/jsg/build`); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 400));
  assert.equal(b.json.released, false); assert.equal(b.json.releaseLabel, '');
  assert.equal(b.json.warmFop, true, 'the warm FOP renderer of the worker rendered it');
  assert.ok(b.json.jobId && b.headers.get('x-job-id') === b.json.jobId, 'the build is a job');
  assert.ok(b.json.report && Array.isArray(b.json.report.notes) && b.json.report.lines > 0, JSON.stringify(b.json.report));
  const job = await w.get(`${U}/jobs/${b.json.jobId}`); assert.equal(job.status, 200); assert.equal(job.json.job?.kind ?? job.json.kind, 'jsg');
  const dir = dirOf(jsgId);
  assert.match(fs.readFileSync(path.join(dir, '_watermark.svg'), 'utf8'), /NOT RELEASED/);
  const fo = fs.readFileSync(path.join(dir, 'jsg-output.fo'), 'utf8');
  const m = marked(fo);
  assert.ok(m.includes('p-odd') && m.includes('p-even'), `the body pages carry the stamp: ${m}`);
  assert.ok(!m.includes('cover'), 'the cover does not');
  const pdf = await w.get(`${U}/jsg/pdf`);
  assert.equal(pdf.headers.get('x-release-state'), 'not-released'); assert.equal(pdf.headers.get('x-pdf-stale'), '0');
  const info = (await readPdf(path.join(dir, 'jsg-output.pdf'))).info;
  assert.match(info.Title, /Bridge Layer/); assert.match(info.Subject, /^JSG User Handbook/); assert.match(info.Keywords, /UHB-0042/);
  assert.match(info.Author, /GOVERNMENT OF INDIA/); assert.equal(info.Creator, 'Agastya');
});

test('a JSG document is released through the shared routes: gated, approved, then the clean copy; a change takes the release away', { timeout: 600000 }, async () => {
  const U = `/api/projects/${jsgId}`; const dir = dirOf(jsgId);
  let rel = (await w.get(`${U}/release`)).json;
  assert.equal(rel.publicationRel, 'jsg-document.xml'); assert.ok(rel.sources >= 1);
  // an invalid document cannot be submitted (the JSG check judges it, not the S1000D one)
  const good = await w.get(`${U}/jsg`);
  assert.equal((await w.put(`${U}/jsg`, { xml: good.json.xml.replace('<meta>', '<meta><bogus/>'), baseHash: good.json.hash })).status, 200);
  const refused = await w.post(`${U}/release`, { note: 'first' });
  assert.equal(refused.status, 422, JSON.stringify(refused.json).slice(0, 300)); assert.equal(refused.json.code, 'VALIDATION_FAILED');
  assert.equal((await w.put(`${U}/jsg`, { xml: good.json.xml, baseHash: (await w.get(`${U}/jsg`)).json.hash })).status, 200);
  const ok = await w.post(`${U}/release`, { note: 'first' }); assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 300));
  rel = (await w.get(`${U}/release`)).json; assert.ok(rel.pending);
  assert.equal((await w.post(`${U}/release/${rel.pending.id}/approve`)).status, 403, 'the author who asked cannot approve');
  assert.equal((await admin.post(`${U}/release/${rel.pending.id}/approve`)).status, 200);
  rel = (await w.get(`${U}/release`)).json; assert.equal(rel.release?.number, 1, JSON.stringify(rel).slice(0, 300));
  // the PDF on disk was built before the approval: it is stale; the download rebuilds it as the released copy
  const before = await w.get(`${U}/jsg/pdf`); assert.equal(before.headers.get('x-pdf-stale'), '1'); assert.equal(before.headers.get('x-release-state'), 'not-released');
  const dl = await w.get(`${U}/jsg/pdf/download`); assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-release-state'), 'released'); assert.doesNotMatch(dl.headers.get('content-disposition'), /NOT RELEASED/);
  assert.equal(fs.existsSync(path.join(dir, '_watermark.svg')), false, 'no watermark for the released copy');
  assert.deepEqual(marked(fs.readFileSync(path.join(dir, 'jsg-output.fo'), 'utf8')), []);
  const after = await w.get(`${U}/jsg/pdf`); assert.equal(after.headers.get('x-pdf-stale'), '0'); assert.equal(after.headers.get('x-release-state'), 'released');
  // a picture added to the document's folder changes the content the release covers
  fs.mkdirSync(path.join(dir, 'Media'), { recursive: true }); fs.writeFileSync(path.join(dir, 'Media', 'new.png'), Buffer.from('not really a picture'));
  rel = (await w.get(`${U}/release`)).json; assert.equal(rel.release, null); assert.ok(rel.staleRelease, 'the release is reported stale');
  assert.equal((await w.get(`${U}/jsg/pdf`)).headers.get('x-pdf-stale'), '1');
});

test('the shared S1000D / JSS publish route refuses a JSG project instead of building it with the wrong engine', async () => {
  const r = await w.post(`/api/projects/${jsgId}/publish`, {}); assert.equal(r.status, 409); assert.equal(r.json.code, 'JSG_DOCUMENT');
  const d = await w.get(`/api/projects/${jsgId}/publish/download`); assert.equal(d.status, 409);
  const checks = require('../dist/services/publishChecks');
  assert.equal(checks.publishCheckFor(jsgId).format, 'jsg');
});

test('JSS and S1000D PDFs carry their document properties too', { timeout: 900000 }, async () => {
  const j = await w.post('/api/projects', { name: 'Jss props', format: 'jss', domain: 'land', manualType: 'uhb' }); const jid = j.json.project.id;
  const g = await w.get(`/api/projects/${jid}/jss`);
  const xml = g.json.xml.replace(/<bookName>[^<]*<\/bookName>/, '<bookName>User Handbook</bookName>').replace(/<systemName>[^<]*<\/systemName>|<systemName\/>/, '<systemName>Radar Set</systemName>');
  assert.equal((await w.put(`/api/projects/${jid}/jss`, { xml, baseHash: g.json.hash })).status, 200);
  const jb = await w.post(`/api/projects/${jid}/publish`, {}); assert.equal(jb.status, 200, JSON.stringify(jb.json).slice(0, 300));
  const ji = (await readPdf(path.join(dirOf(jid), 'jss-output.pdf'))).info;
  assert.match(ji.Title, /Radar Set/); assert.match(ji.Subject, /^JSS /); assert.equal(ji.Creator, 'Agastya');

  const s = await w.post('/api/projects/sample', {}); assert.equal(s.status, 201); const sid = s.json.project.id;
  const sb = await w.post(`/api/projects/${sid}/publish`, { allowRuleBreaks: true }); assert.equal(sb.status, 200, JSON.stringify(sb.json).slice(0, 300));
  const si = (await readPdf(path.join(dirOf(sid), 'jss-output.pdf'))).info;
  const pm = fs.readFileSync(path.join(dirOf(sid), 'publication.xml'), 'utf8');
  const title = /<pmTitle>([^<]*)<\/pmTitle>/.exec(pm)?.[1]?.trim();
  assert.ok(title, 'the sample has a publication title'); assert.equal(si.Title, title);
  assert.equal(si.Subject, 'S1000D publication'); assert.match(si.Keywords, /^PMC-/); assert.equal(si.Creator, 'Agastya');
});
