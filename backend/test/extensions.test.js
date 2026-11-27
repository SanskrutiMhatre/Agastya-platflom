'use strict';
// Extension profiles: foreign-namespace content is preserved byte for byte, an unregistered namespace is an ERROR (with module, line, fix),
// a registered one must be enabled by the project, and then it is validated against its own XSD while the host schema still judges the rest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const f040 = fs.readdirSync(FIX).find((f) => f.includes('-040A-D_'));
const NS = 'http://example.com/ns/maint';
const XSD = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${NS}" xmlns="${NS}" elementFormDefault="qualified"><xs:element name="tag"><xs:complexType><xs:sequence><xs:element name="owner" type="xs:string"/></xs:sequence><xs:attribute name="level" type="xs:integer" use="required"/></xs:complexType></xs:element></xs:schema>`;
let h; let admin; let w; let pid; let dir; let profile;
const U = () => `/api/projects/${pid}`;
const withExt = (inner, decl = `xmlns:m="${NS}"`) => fs.readFileSync(path.join(FIX, f040), 'utf8').replace('<dmodule ', `<dmodule ${decl} `).replace('</description>', `<levelledPara><title>Ext</title><para>plain</para>${inner}</levelledPara></description>`);
const run = async () => (await w.post(`${U()}/validation`, { brex: false })).json.run;
const extIssues = (r) => (r.issues ?? []).filter((i) => /Extension:/.test(i.title));
const hostErrors = (r) => (r.issues ?? []).filter((i) => i.source === 'xsd' && i.sev === 'error' && !/Extension:/.test(i.title));

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'xena', fullName: 'Xena', role: 'author' }); w = new h.Client('xena'); await w.post('/api/auth/login', { username: 'xena', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'xena', password: PW });
  const mk = await w.post('/api/projects', { name: 'Ext', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } }); pid = mk.json.project.id; dir = path.join(h.ws, 'projects', pid);
});
test.after(async () => { await h.close(); });

test('stored byte for byte; unregistered namespace is an error naming module, line and fix', async () => {
  const xml = withExt('<m:tag level="2"><m:owner>Ops</m:owner></m:tag>');
  assert.equal((await w.post(`${U()}/dms`, { file: f040, xml })).status, 201);
  assert.equal(fs.readFileSync(path.join(dir, 'csdb', f040), 'utf8'), xml, 'preserved exactly');
  assert.equal((await w.get(`${U()}/dms/${f040}`)).json.xml, xml, 'and read back exactly');
  const r = await run(); const e = extIssues(r);
  assert.equal(e.length, 1, JSON.stringify(e)); assert.match(e[0].title, /UNREGISTERED_EXTENSION/); assert.equal(e[0].file, f040); assert.ok(e[0].line > 1); assert.match(e[0].detail, new RegExp(`${NS}.*Fix:`, 's'));
});

test('registering needs an administrator; a bad profile is refused', async () => {
  assert.equal((await w.post('/api/admin/extensions', { name: 'x', namespace: NS, xsd: XSD })).status, 403);
  assert.equal((await admin.post('/api/admin/extensions', { name: 'bad', namespace: NS, xsd: XSD.replace(NS, 'http://other') })).status, 400, 'targetNamespace must match');
  assert.equal((await admin.post('/api/admin/extensions', { name: 'bad', namespace: 'http://www.s1000d.org/x', xsd: XSD })).status, 400, 'reserved');
  assert.equal((await admin.post('/api/admin/extensions', { name: 'bad', namespace: NS, xsd: `<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${XSD}` })).status, 400, 'unsafe xml');
  assert.equal((await admin.post('/api/admin/extensions', { name: 'bad', namespace: NS, xsd: XSD.replace('<xs:element name="tag">', '<xs:import namespace="http://x"/><xs:element name="tag">') })).status, 400, 'no imports');
  const ok = await admin.post('/api/admin/extensions', { name: 'Maintenance', namespace: NS, xsd: XSD, description: 'test' }); assert.equal(ok.status, 201, JSON.stringify(ok.json)); profile = ok.json;
  assert.equal((await admin.post('/api/admin/extensions', { name: 'Again', namespace: NS, xsd: XSD })).status, 409);
});

test('registered but not enabled -> error; enabling is a project decision', async () => {
  const e = extIssues(await run()); assert.equal(e.length, 1); assert.match(e[0].title, /EXTENSION_NOT_ENABLED/);
  assert.ok([401, 403, 404].includes((await new h.Client('anon').put(`${U()}/extensions/${profile.id}`, { enabled: true })).status));
  assert.equal((await w.put(`${U()}/extensions/${profile.id}`, { enabled: true })).status, 200);
  assert.equal((await w.get(`${U()}/extensions`)).json.profiles[0].enabled, true);
});

test('enabled: valid content passes, host schema still judges the rest, invalid content is reported at its real line', async () => {
  let r = await run(); assert.deepEqual(extIssues(r).filter((i) => !/ATTRIBUTE_UNCHECKED/.test(i.title)), [], JSON.stringify(extIssues(r)));
  assert.deepEqual(hostErrors(r).filter((i) => i.file === f040), [], 'host schema accepts the module once the extension is set aside');
  const cur = (await w.get(`${U()}/dms/${f040}`)).json;
  const bad = withExt('<m:tag><m:owner>Ops</m:owner></m:tag>');                      // missing required level
  assert.equal((await w.put(`${U()}/dms/${f040}`, { xml: bad, baseHash: cur.hash })).status, 200);
  r = await run(); const e = extIssues(r); assert.ok(e.some((i) => /EXTENSION_INVALID/.test(i.title) && /level/.test(i.detail)), JSON.stringify(e));
  const line = bad.split('\n').findIndex((l) => l.includes('<m:tag')) + 1; assert.equal(e.find((i) => /EXTENSION_INVALID/.test(i.title)).line, line, 'real line number');
  // a standard-content error is still caught, with the extension present
  const cur2 = (await w.get(`${U()}/dms/${f040}`)).json;
  assert.equal((await w.put(`${U()}/dms/${f040}`, { xml: withExt('<m:tag level="1"><m:owner>o</m:owner></m:tag>').replace('<para>plain</para>', '<notAnElement/>'), baseHash: cur2.hash })).status, 200);
  assert.ok(hostErrors(await run()).some((i) => i.file === f040), 'host-schema error still reported');
});

test('the publication gate refuses unregistered extension content; a profile in use cannot be deleted', async () => {
  assert.equal((await admin.del(`/api/admin/extensions/${profile.id}`)).status, 409);
  assert.equal((await w.put(`${U()}/extensions/${profile.id}`, { enabled: false })).status, 200);
  assert.equal((await admin.del(`/api/admin/extensions/${profile.id}`)).status, 200);
  const code = /<dmCode\s+([^>]*?)\s*\/?>/.exec(fs.readFileSync(path.join(FIX, f040), 'utf8'))[1];
  const pm = fs.readFileSync(path.join(dir, 'publication.xml'), 'utf8'); const content = `<content><pmEntry><pmEntryTitle>All</pmEntryTitle><dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef></pmEntry></content>`;
  fs.writeFileSync(path.join(dir, 'publication.xml'), /<content[\s\S]*<\/content>|<content\s*\/>/.test(pm) ? pm.replace(/<content[\s\S]*<\/content>|<content\s*\/>/, content) : pm.replace('</pm>', `${content}</pm>`));
  const r = await w.post(`${U()}/publish/html`, {}); assert.equal(r.status, 422, JSON.stringify(r.json).slice(0, 300));
});
