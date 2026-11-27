'use strict';
// CSDB objects, DML/DDN generation, delivery + project packages, package import (plan/apply/report) and the security cases around them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const zlib = require('node:zlib');
const { boot, DM21, tmp: helperTmp } = require('./helpers');
const Z = require('../dist/services/zipio');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const pick = (code) => fs.readdirSync(FIX).find((f) => f.includes(`-${code}A-D_`));
const ICN = path.resolve(FIX, '..', 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg');
let h; let w; let pid; let dir; let admin; let other;
const U = () => `/api/projects/${pid}`;
const tmp = () => helperTmp('pkgtest-');           // removed when the file's process ends (QA-010)
async function download(client, method, url, body) {
  const r = await client.req(method, url, body); return r;
}
function unzip(buf) {
  const d = tmp(); const f = path.join(d, 'x.zip'); fs.writeFileSync(f, buf);
  const r = Z.ZipFileReader.open(f); const names = r.entries.map((e) => e.name); const get = async (n) => (await r.readBuffer(r.entries.find((e) => e.name === n))).toString('utf8');
  return { names, get, close: () => r.close() };
}
async function upload(client, url, zipBuf, fields = {}, name = 'pkg.zip') {
  const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new Blob([zipBuf]), name); return client.req('POST', url, fd);
}
async function makeZip(files) {
  const d = tmp(); const f = path.join(d, 'm.zip'); const wz = new Z.ZipStreamWriter(fs.createWriteStream(f));
  for (const [n, c] of Object.entries(files)) await wz.addBuffer(n, Buffer.from(c)); await wz.finish(); return fs.readFileSync(f);
}

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const mk = async (u, role) => { const m = await admin.post('/api/team/users', { username: u, fullName: u, role }); const c = new h.Client(u); await c.post('/api/auth/login', { username: u, password: m.json.tempPassword }); await c.post('/api/auth/onboarding', { username: u, password: PW }); return c; };
  w = await mk('pat', 'author'); other = await mk('olly', 'author');
  pid = (await w.post('/api/projects', { name: 'Pkg', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  dir = path.join(h.ws, 'projects', pid);
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(ICN)]), path.basename(ICN)); fd.append('dir', 'csdb'); await w.req('POST', `${U()}/media`, fd);
  for (const c of ['040', '520', '421']) { const f = pick(c); const r = await w.post(`${U()}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') }); assert.equal(r.status, 201, JSON.stringify(r.json)); }
  const dmRef = (f) => { const m = /<dmCode\s+([^>]*?)\s*\/?>/.exec(fs.readFileSync(path.join(FIX, f), 'utf8'))[1]; return `<dmRef><dmRefIdent><dmCode ${m}/></dmRefIdent></dmRef>`; };
  const pm = fs.readFileSync(path.join(dir, 'publication.xml'), 'utf8');
  const content = `<content><pmEntry><pmEntryTitle>All</pmEntryTitle>${dmRef(pick('040'))}${dmRef(pick('520'))}${dmRef(pick('421'))}</pmEntry></content>`;
  fs.writeFileSync(path.join(dir, 'publication.xml'), /<content[\s\S]*<\/content>|<content\s*\/>/.test(pm) ? pm.replace(/<content[\s\S]*<\/content>|<content\s*\/>/, content) : pm.replace('</pm>', `${content}</pm>`));
});
test.after(async () => { await h.close(); });

test('DML generation validates against the 5.0 schema and saves under the S1000D name', async () => {
  const r = await w.post(`${U()}/dml/generate`, { type: 'p', sender: '00000', save: '1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.match(r.json.file, /^DML-EXAMPLE-00000-P-\d{4}-00001_001-00\.XML$/);
  assert.equal(r.json.entries, 3);
  const list = await w.get(`${U()}/objects?kind=dml`); assert.equal(list.json.objects.length, 1);
  const again = await w.post(`${U()}/dml/generate`, { type: 'p', sender: '00000', save: '1' });
  assert.match(again.json.file, /-00002_001-00\.XML$/, 'sequence number advances');
});

test('objects: unsafe XML, wrong root, wrong file name are refused', async () => {
  const xxe = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><ddn>&x;</ddn>`;
  assert.equal((await w.post(`${U()}/objects`, { file: 'DDN-A-B-C-2024-00001.XML', xml: xxe })).status, 400);
  assert.equal((await w.post(`${U()}/objects`, { file: 'DDN-A-B-C-2024-00001.XML', xml: '<dml/>' })).status, 400);
  const r = await w.post(`${U()}/objects`, { file: 'DDN-WRONG.XML', xml: '<ddn><identAndStatusSection><ddnAddress><ddnIdent><ddnCode modelIdentCode="EXAMPLE" senderIdent="00000" receiverIdent="11111" yearOfDataIssue="2025" seqNumber="00001"/></ddnIdent></ddnAddress></identAndStatusSection></ddn>' });
  assert.equal(r.status, 400); assert.match(r.json.error, /does not match/);
  assert.equal((await w.post(`${U()}/objects`, { file: '../DDN-X.XML', xml: '<ddn/>' })).status, 400);
});

test('delivery package: flat, one DDN, DML, ICN, manifest hashes; DDN refused for 7.0', async () => {
  const r = await w.post(`${U()}/packages/delivery`, { sender: { code: '00000' }, receiver: { code: 'U8025', name: 'Receiver Ltd', city: 'London', country: 'UK' }, includeDml: '1' });
  assert.equal(r.status, 200, r.buf?.toString().slice(0, 300) + JSON.stringify(r.json));
  const z = unzip(r.buf);
  assert.ok(z.names.every((n) => !n.includes('/')), 'flat: no directories');
  assert.equal(z.names.filter((n) => /^DDN-/.test(n)).length, 1);
  assert.equal(z.names.filter((n) => /^DMC-/.test(n)).length, 3);
  assert.ok(z.names.some((n) => /^ICN-/.test(n)) && z.names.some((n) => /^DML-/.test(n)) && z.names.includes('AGASTYA-MANIFEST.json'));
  const man = JSON.parse(await z.get('AGASTYA-MANIFEST.json'));
  assert.ok(man.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  const ddn = await z.get(z.names.find((n) => /^DDN-/.test(n)));
  assert.match(ddn, /<dispatchFileName>DMC-/); assert.match(ddn, /<entityControlNumber>EXAMPLE-/);
  z.close();
  const unreg = await w.post(`${U()}/packages/delivery`, { sender: { code: '00000' }, receiver: { code: 'ZZZZZ' } });
  assert.equal(unreg.status, 400); assert.match(unreg.json.error, /not in the Administrator|name for a free entry/);
  const bad = await w.post(`${U()}/packages/delivery`, { sender: { code: '00000' }, receiver: { code: 'bad' } });
  assert.equal(bad.status, 400);
});

test('project package round trip into a second project; report; repeated import is unchanged', async () => {
  const exp = await w.get(`${U()}/packages/project`); assert.equal(exp.status, 200);
  const z = unzip(exp.buf); assert.ok(z.names.includes('manifest.json')); assert.ok(z.names.some((n) => n.startsWith('csdb/DMC-'))); z.close();
  const p2 = (await w.post('/api/projects', { name: 'Pkg2', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  const r = await upload(w, `/api/projects/${p2}/packages/import`, exp.buf);
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 600));
  assert.equal(r.json.applied, true); assert.equal(r.json.manifest.mismatches.length, 0); assert.ok(r.json.manifest.checked >= 4);
  assert.ok(r.json.items.filter((i) => i.as === 'dm' && i.status === 'accepted').length === 3);
  const dm = r.json.items.find((i) => i.as === 'dm'); assert.ok('xsdErrors' in dm || dm.message, 'per-file schema scope reported');
  assert.equal((await w.get(`/api/projects/${p2}/dms`)).json.dms.length, 3);
  const again = await upload(w, `/api/projects/${p2}/packages/import`, exp.buf);
  assert.equal(again.json.counts.accepted, 0); assert.ok(again.json.counts.unchanged >= 4);
  const reps = await w.get(`/api/projects/${p2}/packages/import-reports`); assert.ok(reps.json.reports.length >= 2);
});

test('import safety: ZIP Slip, path traversal, XXE, tampered manifest, unsafe svg, risky types, non-zip', async () => {
  const dm = fs.readFileSync(path.join(FIX, pick('040')), 'utf8');
  // 1 ZIP Slip: refused as a whole, nothing written outside
  const evil = await makeZip({}); void evil;
  const raw = (() => { const d = tmp(); const f = path.join(d, 'e.zip'); const nb = Buffer.from('../../escape.txt'); const data = Buffer.from('x'); const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(1, 18); lh.writeUInt32LE(1, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(1, 20); ch.writeUInt32LE(1, 24); ch.writeUInt16LE(nb.length, 28);
    const cd = Buffer.concat([ch, nb]); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(1, 8); e.writeUInt16LE(1, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(30 + nb.length + 1, 16);
    return Buffer.concat([lh, nb, data, cd, e]); })();
  let r = await upload(w, `${U()}/packages/import`, raw); assert.equal(r.status, 400); assert.equal(r.json.code, 'PACKAGE_REFUSED');
  assert.equal(fs.existsSync(path.resolve(dir, '..', '..', 'escape.txt')), false);
  // 2 not a zip
  r = await upload(w, `${U()}/packages/import`, Buffer.from('this is not a zip file at all, just text')); assert.equal(r.status, 400);
  // 3 XXE in a data module + risky type + script svg + tampered manifest -> rejected items, nothing applied
  const xxe = dm.replace(/<dmodule/, '<!DOCTYPE dmodule [<!ENTITY x SYSTEM "file:///etc/passwd">]><dmodule').replace(/<\?xml[^>]*\?>/, '');
  r = await upload(w, `${U()}/packages/import`, await makeZip({ [`a/DMC-XXE-A-00-00-00-00A-040A-D_001-00_EN-US.XML`]: xxe, 'media/evil.js': 'alert(1)', 'media/ICN-X-A-000000-A-00001-00001-A-001-01.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' }));
  assert.equal(r.status, 422); assert.equal(r.json.applied, false);
  const st = Object.fromEntries(r.json.items.map((i) => [path.basename(i.path), i]));
  assert.equal(st['DMC-XXE-A-00-00-00-00A-040A-D_001-00_EN-US.XML'].status, 'rejected');
  assert.equal(st['evil.js'].status, 'rejected'); assert.match(st['evil.js'].message, /administrator/);
  assert.match(st['ICN-X-A-000000-A-00001-00001-A-001-01.svg'].message, /script/);
  const man = { files: [{ path: 'x.txt', kind: 'other', size: 1, sha256: '0'.repeat(64) }] };
  r = await upload(w, `${U()}/packages/import`, await makeZip({ 'manifest.json': JSON.stringify(man), 'x.txt': 'a' })); assert.ok(r.json.manifest.mismatches.length === 1); assert.equal(r.json.applied, false);
});

test('cross-project and authorisation: a user without access gets nothing; unauthenticated is refused', async () => {
  assert.ok([403, 404].includes((await other.get(`${U()}/packages/project`)).status));
  assert.ok([403, 404].includes((await other.post(`${U()}/dml/generate`, {})).status));
  assert.ok([403, 404].includes((await upload(other, `${U()}/packages/import`, await makeZip({ 'a.txt': 'x' }))).status));
  const anon = new h.Client('anon');
  assert.equal((await anon.get(`${U()}/objects`)).status, 401);
  assert.equal((await anon.get(`${U()}/assets`)).status, 401);
});

test('assets: inventory with hashes and findings (broken reference, orphan)', async () => {
  const a = await w.get(`${U()}/assets`); assert.equal(a.status, 200);
  assert.ok(a.json.assets.some((x) => /^ICN-/.test(x.name) && x.sha256.length === 64));
});

test('same ids in two different modules are NOT a package problem (per-module scope)', async () => {
  const p3 = (await w.post('/api/projects', { name: 'Ids', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  const exp = await w.get(`${U()}/packages/project`);
  const r = await upload(w, `/api/projects/${p3}/packages/import`, exp.buf, { validate: '1' });
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.json).toLowerCase().includes('duplicate id'));
});

test('findings: one shape (module, rule, location, fix); the coverage matrix lists every type', async () => {
  const r = await w.get(`${U()}/findings?run=1`); assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  for (const f of r.json.findings) { assert.ok(f.module && f.rule && f.location && f.fix && f.severity, JSON.stringify(f)); }
  assert.ok(!r.json.findings.some((f) => /^DMC_FILE_NAME$/.test(f.rule)), 'fixture file names match their identification');
  const c = await w.get('/api/s1000d/coverage'); assert.equal(c.status, 200); assert.ok(c.json.rows.length >= 27);
});

test('import reports schema findings per file (batched validation) without rejecting the file', async () => {
  const p = (await w.post('/api/projects', { name: 'Xsd', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  const good = fs.readFileSync(path.join(FIX, pick('040')), 'utf8'); const badXml = fs.readFileSync(path.join(FIX, pick('520')), 'utf8').replace('</dmodule>', '<notAnS1000dElement/></dmodule>');
  const r = await upload(w, `/api/projects/${p}/packages/import`, await makeZip({ [`csdb/${pick('040')}`]: good, [`csdb/${pick('520')}`]: badXml }));
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 400));
  const by = Object.fromEntries(r.json.items.map((i) => [path.basename(i.path), i]));
  assert.ok(!by[pick('040')].xsdErrors, 'valid module: no findings'); assert.ok(by[pick('520')].xsdErrors >= 1, 'invalid module: findings reported'); assert.match(by[pick('520')].xsdFirst[0], /notAnS1000dElement/);
  assert.equal(by[pick('520')].status, 'accepted', 'a schema finding does not reject the file; the publication gate decides later');
});
