'use strict';
// WP-09 (QA-021, PUB-008): pictures survive a cross-engine conversion. The product's own upload puts ICN artwork beside the data modules
// (csdb/); the sample S1000D project keeps its artwork there. Every picture the source documents refer to must arrive in the converted
// project byte for byte (same SHA-256), and every picture reference of the converted document must resolve to a file of the project.
// Before the fix in services/xengine/convert.ts (zipOfS1000dProject packed csdb/ with the filter /\.xml$/) S1000D -> JSS / JSG lost them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const PIC = /\.(png|jpe?g|gif|svg|tiff?|bmp|cgm)$/i;
// a valid 1 x 1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let h; let w;

test.before(async () => {
  h = await boot();
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'pictures', fullName: 'Pictures', role: 'author' });
  w = new h.Client('pictures'); await w.post('/api/auth/login', { username: 'pictures', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'pictures', password: PW });
});
test.after(async () => { if (h) await h.close(); });

const dirOf = (id) => path.join(h.ws, 'projects', id);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
/** Every picture file under a project folder (generated output left out): [{ rel, base, hash }]. */
function pictureFiles(id) {
  const out = []; const root = dirOf(id);
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!/^(\.|_)/.test(e.name)) walk(f); } else if (PIC.test(e.name)) out.push({ rel: path.relative(root, f).replace(/\\/g, '/'), base: e.name.toLowerCase(), hash: sha(fs.readFileSync(f)) }); } };
  walk(root); return out;
}
/** Picture names a document refers to: S1000D entity SYSTEM files and infoEntityIdent, JSS / JSG graphic/@src. */
function refsIn(xml) {
  const names = new Set();
  for (const m of xml.matchAll(/SYSTEM\s+"([^"]+)"/g)) if (PIC.test(m[1])) names.add(path.basename(m[1]).toLowerCase());
  for (const m of xml.matchAll(/infoEntityIdent="([^"]+)"/g)) names.add(m[1].toLowerCase());
  for (const m of xml.matchAll(/<graphic\b[^>]*\bsrc="([^"]+)"/g)) names.add(path.basename(m[1]).toLowerCase());
  return [...names];
}
const stem = (n) => n.replace(/\.[a-z0-9]+$/i, '');
/** A reference resolves when a picture file of the project has that name (an ICN ident may omit the extension). */
const resolves = (ref, files) => files.some((f) => f.base === ref || stem(f.base) === stem(ref));
const projectXml = (id) => {
  const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!/^(\.|_)/.test(e.name)) walk(f); } else if (/\.xml$/i.test(e.name)) out.push(fs.readFileSync(f, 'utf8')); } };
  walk(dirOf(id)); return out.join('\n');
};

test('S1000D -> JSS and S1000D -> JSG: the pictures of the source (kept beside the data modules) arrive with the same bytes; references resolve', async () => {
  const s = await w.post('/api/projects/sample', {}); assert.equal(s.status, 201, JSON.stringify(s.json));
  const src = s.json.project.id;
  const srcFiles = pictureFiles(src);
  const used = srcFiles.filter((f) => refsIn(projectXml(src)).some((r) => r === f.base || stem(r) === stem(f.base)));
  assert.ok(used.length >= 1, `the source documents use pictures: ${srcFiles.map((f) => f.rel).join(', ')}`);
  assert.ok(used.some((f) => /^csdb\//i.test(f.rel)), 'at least one of them is kept beside the data modules (csdb/)');
  for (const to of ['jss', 'jsg']) {
    const r = await w.post(`/api/projects/${src}/convert`, { to, name: `Sample pictures as ${to}` });
    assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 500));
    const out = pictureFiles(r.json.project.id);
    const lost = used.filter((f) => !out.some((o) => o.hash === f.hash)).map((f) => f.rel);
    assert.deepEqual(lost, [], `${to}: pictures lost in the conversion`);
    const xml = (await w.get(`/api/projects/${r.json.project.id}/${to}`)).json.xml;
    assert.ok(refsIn(xml).length >= 1, `${to}: the converted document shows the pictures`);
    const dangling = refsIn(xml).filter((ref) => !resolves(ref, out));
    assert.deepEqual(dangling, [], `${to}: picture references without a file`);
  }
});

test('JSS -> S1000D and JSS -> JSG: a figure\'s picture arrives with the same bytes and the reference resolves', async () => {
  const r = await w.post('/api/projects', { name: 'JSS with a figure', format: 'jss', domain: 'land', manualType: 'uhb' }); assert.equal(r.status, 201);
  const id = r.json.project.id; const U = `/api/projects/${id}`;
  fs.mkdirSync(path.join(dirOf(id), 'Media'), { recursive: true });
  fs.writeFileSync(path.join(dirOf(id), 'Media', 'plate.png'), PNG);
  const g = await w.get(`${U}/jss`);
  const xml = g.json.xml.replace(/(<chapter number="1"[^>]*>\s*<title>[^<]*<\/title>)/, '$1<para>Before the plate.</para><figure id="plate"><title>Equipment plate</title><graphic src="Media/plate.png" width="40mm"/></figure>');
  assert.notEqual(xml, g.json.xml, 'the figure was placed');
  assert.equal((await w.put(`${U}/jss`, { xml, baseHash: g.json.hash })).status, 200);
  const want = sha(PNG);
  for (const to of ['s1000d', 'jsg']) {
    const c = await w.post(`${U}/convert`, { to, name: `Figure as ${to}` });
    assert.equal(c.status, 201, JSON.stringify(c.json).slice(0, 500));
    const out = pictureFiles(c.json.project.id);
    assert.ok(out.some((f) => f.hash === want), `${to}: the picture arrived with the same bytes (${out.map((f) => f.rel).join(', ') || 'no pictures'})`);
    const doc = to === 'jsg' ? (await w.get(`/api/projects/${c.json.project.id}/jsg`)).json.xml : projectXml(c.json.project.id);
    const refs = refsIn(doc);
    assert.ok(refs.length >= 1, `${to}: the converted document refers to the picture`);
    assert.deepEqual(refs.filter((ref) => !resolves(ref, out)), [], `${to}: picture references without a file`);
  }
});
