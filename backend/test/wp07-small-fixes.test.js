'use strict';
// WP-07 (audit UX-001, FE-009, PUB-012, PUB-020, SEC-015, ARC-020, SEC-014, PLT-024): small visible defects, server side.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let w; let ctx;

test.before(async () => {
  h = await boot(); ctx = require('../dist/context');
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  const m = await admin.post('/api/team/users', { username: 'wp07', fullName: 'Wp Seven', role: 'project_manager' });
  w = new h.Client('wp07');
  assert.equal((await w.post('/api/auth/login', { username: 'wp07', password: m.json.tempPassword })).status, 200);
  assert.equal((await w.post('/api/auth/onboarding', { username: 'wp07', password: PW })).status, 200);
});
test.after(async () => { if (h) await h.close(); });

test('a JSS or JSG project asked for its S1000D publication module gets a 4xx, never a 500 (FE-009)', async () => {
  for (const format of ['jss', 'jsg']) {
    const p = await w.post('/api/projects', { name: `Pm of ${format}`, format, domain: 'land', manualType: 'uhb' });
    assert.equal(p.status, 201, JSON.stringify(p.json));
    const r = await w.get(`/api/projects/${p.json.project.id}/pmc`);
    assert.ok(r.status >= 400 && r.status < 500, `${format}: ${r.status} ${JSON.stringify(r.json)}`);
  }
});

test('a new JSS book resolves every picture in its XSL-FO: no developer screenshot, no missing symbol icons, default artwork as file URLs (PUB-012, PUB-020)', { timeout: 600000 }, async () => {
  const p = await w.post('/api/projects', { name: 'Pictures resolve', format: 'jss', domain: 'land', manualType: 'uhb' });
  const id = p.json.project.id;
  const b = await w.post(`/api/projects/${id}/publish`, {});
  assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 400));
  const foFile = path.join(h.ws, 'projects', id, 'jss-output.fo');
  const fo = fs.readFileSync(foFile, 'utf8');
  assert.ok(!/Screenshot 2026/.test(fo), 'the developer screenshot is not referenced');
  assert.ok(!/(High_Voltage|Flammable|Emergency_Stop|Hot_Surface|Antistalic|Noise)_[Ss]ymbol\.png/.test(fo), 'no missing symbol icon is referenced');
  assert.ok(!/src="url\('(\.\.\/){3,}/.test(fo), 'no ../ chain out of the project');
  assert.match(fo, /src="url\('file:\/\/\/[^']*artwork\/emblem\.png'\)"/, 'the default emblem is an absolute file URL');
  const { checkImages } = require('../vendor/engine/foChecks');
  const r = checkImages(foFile, path.dirname(foFile));
  assert.equal(r.empty, 0, 'no picture with an empty src');
  assert.deepEqual(r.missing, [], `every picture resolves: ${JSON.stringify(r.missing)}`);
});

test('CSV exports write a cell starting with = + - @ as text (SEC-015, ARC-020)', async () => {
  const { csvCell, csvRow, csvText } = require('../dist/services/csv');
  assert.equal(csvCell('=HYPERLINK("http://x","click")'), `"'=HYPERLINK(""http://x"",""click"")"`);
  for (const c of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) assert.ok(csvCell(c).startsWith(`"'`), JSON.stringify(c));
  assert.equal(csvCell('plain "quoted" text'), '"plain ""quoted"" text"');
  assert.equal(csvCell(null), '""'); assert.equal(csvCell(42), '"42"');
  assert.equal(csvRow(['a', '=b']), `"a","'=b"`);
  assert.equal(csvText(['x', 'y'], [['1', '=2']]), `x,y\r\n"1","'=2"\r\n`);

  // the SNS export of a project, end to end: a planted formula comes back as text
  const p = await w.post('/api/projects', { name: 'Csv book', pipeline: 's1000dtofo', s1000d: { mic: 'CSVBOOK', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  const id = p.json.project.id;
  const planted = '=HYPERLINK("http://127.0.0.1:1/x","click")';
  const add = await w.post(`/api/projects/${id}/sns`, { path: '99', title: planted });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  const csv = (await w.get(`/api/projects/${id}/sns/export?format=csv`)).buf.toString('utf8');
  assert.ok(csv.includes(`"'=HYPERLINK(`), csv.slice(0, 300));
  assert.ok(!/,"=HYPERLINK/.test(csv), 'never a cell that starts with =');
  // the audit log export: a project name starting with = is text there too
  await w.post('/api/projects', { name: '=1+1 book', pipeline: 's1000dtofo' });
  const audit = (await admin.get('/api/admin/maintenance/audit.csv')).buf.toString('utf8');
  assert.ok(!/(^|,)"=/m.test(audit), 'no audit cell starts with =');
});

test('package downloads are named after the project; extension profiles in the shared repository are a 403 (SEC-014, PLT-024)', { timeout: 300000 }, async () => {
  const p = await w.post('/api/projects', { name: 'Named Export Book', pipeline: 's1000dtofo', s1000d: { mic: 'NAMED', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  const r = await w.get(`/api/projects/${p.json.project.id}/packages/project`);
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('content-disposition')), /Named_Export_Book-project\.zip/);

  const cirId = await require('../dist/services/cir').workspaceId();
  const ext = await admin.put(`/api/projects/${cirId}/extensions/any-profile`, { enabled: true });
  assert.equal(ext.status, 403, JSON.stringify(ext.json));
  assert.equal(ext.json.code, 'CIR_NO_EXTENSIONS');
});
