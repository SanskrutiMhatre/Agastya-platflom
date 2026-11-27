'use strict';
// WP-02 (audit SEC-003, SEC-011): no picture reference outside the allowed folders, and no URL, reaches FOP. Unit tests
// of vendor/engine/foGuard.js, then the audit's own reproduction end to end: a publisher logo pointing at a listener on
// this machine, planted in project.json (the settings route now refuses it, so it is written to disk directly, as a
// forged archive or an old project could have it), must not be fetched by the build.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
const { boot, DM21, tmp: helperTmp } = require('./helpers');
const { confineFo, localPathOf, BLANK_PNG } = require('../vendor/engine/foGuard');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const tmp = () => helperTmp('foguard-');           // removed when the file's process ends (QA-010)
const fo = (body) => `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><fo:page-sequence><fo:flow>${body}</fo:flow></fo:page-sequence></fo:root>`;

test('allowed references are left alone and the file is not rewritten (byte-identical)', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'a.png'), 'x'); fs.mkdirSync(path.join(dir, 'Media')); fs.writeFileSync(path.join(dir, 'Media', 'b.png'), 'x');
  const vendorArt = path.resolve(__dirname, '..', 'vendor', 'pipeline', 'jss', 'artwork', 'emblem.png');
  const text = fo(`<fo:external-graphic src="url('a.png')"/><fo:external-graphic src="Media/b.png"/><fo:external-graphic src="url('file:///${vendorArt.replace(/\\/g, '/')}')"/><fo:external-graphic src="url('data:image/png;base64,iVBORw0KGgo=')"/><fo:basic-link external-destination="url('https://example.com')">x</fo:basic-link>`);
  const f = path.join(dir, 'x.fo'); fs.writeFileSync(f, text); const before = fs.statSync(f).mtimeMs;
  const r = confineFo(f, { baseDir: dir });
  assert.deepEqual(r.removed, []);
  assert.equal(fs.readFileSync(f, 'utf8'), text); assert.equal(fs.statSync(f).mtimeMs, before);
});

test('URLs, files outside the allowed folders, UNC paths and unsafe SVGs are replaced by a blank picture and reported', () => {
  const dir = tmp(); const outside = tmp(); fs.writeFileSync(path.join(outside, 'secret.png'), 'x');
  fs.writeFileSync(path.join(dir, 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="http://127.0.0.1:9/x.png"/></svg>');
  fs.writeFileSync(path.join(dir, 'good.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/></svg>');
  const refs = ['http://127.0.0.1:4061/pixel.png', 'https://example.com/a.png', `file:///${path.join(outside, 'secret.png').replace(/\\/g, '/')}`, path.join(outside, 'secret.png'), '\\\\server\\share\\a.png', 'file://server/share/a.png', '../../x.png', 'jar:file:/x!/y.png', 'evil.svg'];
  const body = refs.map((r) => `<fo:external-graphic src="url('${r}')"/>`).join('') + '<fo:external-graphic src="good.svg"/>'
    + '<fo:block background-image="url(\'http://127.0.0.1:9/bg.png\')"/>'
    + '<fo:instream-foreign-object><svg:svg><svg:image xlink:href="file:///C:/Windows/win.ini"/></svg:svg></fo:instream-foreign-object>';
  const f = path.join(dir, 'x.fo'); fs.writeFileSync(f, fo(body));
  const r = confineFo(f, { baseDir: dir });
  assert.equal(r.removed.length, refs.length + 2, JSON.stringify(r.removed));
  const out = fs.readFileSync(f, 'utf8');
  for (const ref of refs) assert.ok(!out.includes(ref), `${ref} is gone`);
  assert.ok(out.includes('good.svg'), 'a safe SVG stays');
  assert.ok(!out.includes('127.0.0.1') && !out.includes('win.ini'));
  assert.ok(out.includes(BLANK_PNG));
});

test('localPathOf: the forms FOP understands', () => {
  assert.equal(localPathOf('http://x/y.png', 'C:\\w').kind, 'bad');
  assert.equal(localPathOf('data:image/png;base64,AA==', 'C:\\w').kind, 'data');
  assert.equal(localPathOf('data:text/html,<x>', 'C:\\w').kind, 'bad');
  assert.equal(localPathOf('file:///C:/a/b.png', 'C:\\w').abs, path.resolve('C:/a/b.png'));
  assert.equal(localPathOf('Media/a.png', 'C:\\w').abs, path.resolve('C:\\w\\Media\\a.png'));
});

test('end to end: a planted publisher logo URL is never fetched by a build, and the build still succeeds', async (t) => {
  const hits = [];
  const listener = http.createServer((req, res) => { hits.push(`${req.method} ${req.url} ${req.headers['user-agent']}`); res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from(BLANK_PNG.split(',')[1], 'base64')); });
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  const h = await boot();
  t.after(async () => { await h.close(); listener.close(); });
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'mallory', fullName: 'M', role: 'author' });
  const w = new h.Client('mallory'); await w.post('/api/auth/login', { username: 'mallory', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'mallory', password: PW });
  const pr = await w.post('/api/projects', { name: 'Logo SSRF', format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(pr.status, 201, JSON.stringify(pr.json).slice(0, 300));
  const id = pr.json.project.id; const U = `/api/projects/${id}`;
  const f = fs.readdirSync(FIX).find((x) => /-040A-D_/.test(x));
  assert.equal((await w.post(`${U}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') })).status, 201);
  const evil = `http://127.0.0.1:${port}/pixel.png`;
  // the settings route refuses it ...
  const { project } = (await w.get(`${U}/settings`)).json;
  const refused = await w.put(`${U}/settings`, { project: { ...project, publishers: [{ name: 'Attacker Co', addressLines: [], logo: evil }] } });
  assert.equal(refused.status, 400); assert.equal(refused.json.code, 'UNSAFE_ARTWORK');
  // ... so plant it the way a forged archive or an old project could have it
  const pjPath = path.join(h.ws, 'projects', id, 'project.json');
  const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
  fs.writeFileSync(pjPath, JSON.stringify({ ...pj, publishers: [{ name: 'Attacker Co', addressLines: [], logo: evil }], branding: { ...(pj.branding || {}), emblem: evil, publishers: [{ name: 'Attacker Co', logo: evil }] } }, null, 2));
  const b = await w.post(`${U}/publish`, {});
  assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 400));
  assert.deepEqual(hits, [], 'the build made no request to the planted address');
});

test('child processes get the allow-listed environment: no JVM injection variables, no session secrets; the tools still start', () => {
  const keep = { ...process.env };
  try {
    Object.assign(process.env, { JAVA_TOOL_OPTIONS: '-javaagent:evil.jar', _JAVA_OPTIONS: '-Dx=1', JDK_JAVA_OPTIONS: '-Dy=1', CLASSPATH: 'evil.jar', NODE_OPTIONS: '--require evil.js', GITHUB_TOKEN: 'ghp_secret' });
    const paths = require('../vendor/engine/paths');
    const env = paths.childEnv({ XML_CATALOG_FILES: 'catalog.xml' });
    for (const k of ['JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH', 'NODE_OPTIONS', 'GITHUB_TOKEN']) assert.ok(!(k in env), `${k} is not passed`);
    assert.equal(env.XML_CATALOG_FILES, 'catalog.xml', 'what a build sets itself is passed');
    assert.ok(Object.keys(env).some((k) => k.toLowerCase() === 'path') && Object.keys(env).some((k) => k.toLowerCase() === 'temp' || k.toLowerCase() === 'tmpdir' || k.toLowerCase() === 'home'));
    const { spawnSync } = require('node:child_process');
    const j = spawnSync(paths.JAVA, ['-version'], { env, encoding: 'utf8' });
    assert.equal(j.status, 0, j.stderr); assert.ok(!/Picked up/.test(j.stderr), 'the JVM picked up no options');
    assert.equal(spawnSync(paths.XSLTPROC, ['--version'], { env }).status, 0);
  } finally { for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k]; Object.assign(process.env, keep); }
});
