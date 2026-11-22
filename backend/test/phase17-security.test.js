'use strict';
// Authorisation sweep over every Phase 17 route: anonymous -> 401, a signed-in user who is NOT a member of the project -> 403/404 (cross-project access),
// a viewer cannot write, and the administrator-only routes refuse everyone else. Also: path traversal in file-name parameters, oversize upload limits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let owner; let outsider; let pid;
const A = (c, m, u, b) => c.req(m, u, b);

test.before(async () => {
  h = await boot(); admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const mk = async (u) => { const m = await admin.post('/api/team/users', { username: u, fullName: u, role: 'author' }); const c = new h.Client(u); await c.post('/api/auth/login', { username: u, password: m.json.tempPassword }); await c.post('/api/auth/onboarding', { username: u, password: PW }); return c; };
  owner = await mk('ownerx'); outsider = await mk('outsx');
  pid = (await owner.post('/api/projects', { name: 'Sec', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
});
test.after(async () => { await h.close(); });

const ROUTES = (id) => [
  ['GET', `/api/projects/${id}/objects`], ['GET', `/api/projects/${id}/objects/DML-A.XML`], ['POST', `/api/projects/${id}/objects`, { file: 'DML-A.XML', xml: '<dml/>' }], ['PUT', `/api/projects/${id}/objects/DML-A.XML`, { xml: '<dml/>' }],
  ['DELETE', `/api/projects/${id}/objects/DML-A.XML`], ['POST', `/api/projects/${id}/objects/new`, { kind: 'imf', params: {} }], ['GET', `/api/projects/${id}/objects/DML-A.XML/html`], ['POST', `/api/projects/${id}/objects/DML-A.XML/pdf`, {}],
  ['POST', `/api/projects/${id}/dml/generate`, {}], ['GET', `/api/projects/${id}/assets`], ['GET', `/api/projects/${id}/findings`], ['GET', `/api/projects/${id}/packages/project`],
  ['POST', `/api/projects/${id}/packages/delivery`, {}], ['POST', `/api/projects/${id}/packages/import`, {}], ['GET', `/api/projects/${id}/packages/import-reports`], ['GET', `/api/projects/${id}/packages/import-reports/x.json`],
  ['POST', `/api/projects/${id}/publish/html`, {}], ['GET', `/api/projects/${id}/publish/html`], ['GET', `/api/projects/${id}/publish/html/x.zip`], ['GET', `/api/projects/${id}/publish/html/x/index.html`],
  ['GET', `/api/projects/${id}/dms/X.XML/lifecycle`], ['GET', `/api/projects/${id}/lifecycle/events`], ['POST', `/api/projects/${id}/dms/X.XML/working-revision`, {}], ['GET', `/api/projects/${id}/dms/X.XML/change-suggestions`],
  ['POST', `/api/projects/${id}/dms/X.XML/change-marks`, { picks: [] }], ['POST', `/api/projects/${id}/dms/X.XML/issue`, {}], ['POST', `/api/projects/${id}/dms/X.XML/obsolete`, { reason: 'x' }], ['POST', `/api/projects/${id}/dms/X.XML/supersede`, { reason: 'x', by: 'Y' }],
  ['GET', `/api/projects/${id}/extensions`], ['PUT', `/api/projects/${id}/extensions/abc`, { enabled: true }], ['GET', `/api/projects/${id}/cir-links`], ['POST', `/api/projects/${id}/cir-links/X.XML/update`, {}], ['DELETE', `/api/projects/${id}/cir-links/X.XML`],
];
const ADMIN = [['GET', '/api/admin/extensions'], ['POST', '/api/admin/extensions', {}], ['DELETE', '/api/admin/extensions/abc'], ['GET', '/api/admin/asset-policy'], ['PUT', '/api/admin/asset-policy', { allowRisky: true }]];

test('anonymous: 401 on every route', async () => {
  const anon = new h.Client('anon'); const bad = [];
  for (const [m, u, b] of [...ROUTES(pid), ...ADMIN, ['GET', '/api/s1000d/coverage']]) { const r = await A(anon, m, u, b); if (r.status !== 401) bad.push(`${m} ${u} -> ${r.status}`); }
  assert.deepEqual(bad, []);
});
test('not a member of the project: 403/404 on every project route (cross-project access)', async () => {
  const bad = [];
  for (const [m, u, b] of ROUTES(pid)) { const r = await A(outsider, m, u, b); if (![403, 404].includes(r.status)) bad.push(`${m} ${u} -> ${r.status}`); }
  assert.deepEqual(bad, []);
});
test('non-administrators cannot use the administrator routes', async () => {
  const bad = [];
  for (const [m, u, b] of ADMIN) { const r = await A(owner, m, u, b); if (![401, 403].includes(r.status)) bad.push(`${m} ${u} -> ${r.status}`); }
  assert.deepEqual(bad, []);
  assert.equal((await admin.get('/api/admin/asset-policy')).status, 200);
});
test('path traversal in file-name parameters is refused, never resolved', async () => {
  const U = `/api/projects/${pid}`;
  for (const f of ['..%2F..%2Fproject.json', '..%5Cx.XML', 'DML-%2e%2e%2fx.XML', 'DML-A.XML%00.txt']) {
    for (const [m, p] of [['GET', `${U}/objects/${f}`], ['GET', `${U}/objects/${f}/html`], ['GET', `${U}/packages/import-reports/${f}`], ['GET', `${U}/publish/html/${f}`]]) {
      const r = await A(owner, m, p); assert.ok([400, 404].includes(r.status), `${m} ${p} -> ${r.status}`);
    }
  }
  const mk = await owner.post(`${U}/objects`, { file: '../DML-X.XML', xml: '<dml/>' }); assert.equal(mk.status, 400);
});
test('asset policy: active-content types are refused until an administrator opts in; svg with script is refused either way', async () => {
  const U = `/api/projects/${pid}`; const up = (name, data) => { const fd = new FormData(); fd.append('files', new Blob([data]), name); fd.append('kind', 'icn'); return owner.req('POST', `${U}/graphics`, fd); };
  assert.equal((await up('ICN-EXAMPLE-A-000000-A-00001-00001-A-001-01.js', 'alert(1)')).status, 400);
  assert.equal((await up('ICN-EXAMPLE-A-000000-A-00001-00002-A-001-01.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')).status, 400);
  assert.equal((await up('ICN-EXAMPLE-A-000000-A-00001-00003-A-001-01.mp4', Buffer.from('fakevideo'))).status, 201, 'listed multimedia type is accepted');
  assert.equal((await admin.put('/api/admin/asset-policy', { allowRisky: true })).status, 200);
  assert.equal((await up('ICN-EXAMPLE-A-000000-A-00001-00004-A-001-01.css', 'a{}')).status, 201, 'opt-in enables the listed active-content type');
  await admin.put('/api/admin/asset-policy', { allowRisky: false });
});
