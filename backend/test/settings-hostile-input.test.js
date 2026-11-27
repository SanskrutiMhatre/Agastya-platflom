'use strict';
// WP-01 (audit SEC-002, S1K-001, PUB-001, PUB-026): the file locations in project.json (input.csdbDir / mediaDir / pm) and the
// project's kind (format / authoring / type) cannot be pointed somewhere else, through the settings route, through a forged
// project archive, or by a project.json that is already poisoned on disk.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { boot, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let bob; let carol; let ctx; let P; let ZipStreamWriter;
let victim; let own;
const VICTIM_DM = 'DMC-VICTIM-A-00-00-00-00A-040A-D_001-00_EN-US.xml';

const user = async (admin, name) => {
  const m = await admin.post('/api/team/users', { username: name, fullName: name, role: 'author' });
  const c = new h.Client(name); await c.post('/api/auth/login', { username: name, password: m.json.tempPassword }); await c.post('/api/auth/onboarding', { username: name, password: PW });
  return c;
};

test.before(async () => {
  h = await boot(); ctx = require('../dist/context'); P = require('../dist/services/projects'); ({ ZipStreamWriter } = require('../dist/services/zipio'));
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  carol = await user(admin, 'carol'); bob = await user(admin, 'bob');
  victim = (await carol.post('/api/projects', { name: 'Carol Pump' })).json.project.id;
  own = (await bob.post('/api/projects', { name: 'Bob Book' })).json.project.id;
  const vcsdb = path.join(ctx.projectDirFor(victim), 'csdb'); fs.mkdirSync(vcsdb, { recursive: true });
  fs.writeFileSync(path.join(vcsdb, VICTIM_DM), '<?xml version="1.0"?><dmodule><!-- carol --></dmodule>');
});
test.after(async () => { if (h) await h.close(); });

const HOSTILE = ['../x', '..\\x', 'a/../b', '/abs', '\\abs', 'C:\\Windows', 'C:x', '\\\\server\\share\\csdb', '//server/share', 'csdb:ads', 'con', 'NUL.txt', 'lpt1', 'csdb/', 'a//b', './csdb', 'csdb.', 'a\0b', 'x'.repeat(600)];

test('the unit rule: only a plain relative path inside the project is honoured; anything else falls back to the standard folder', () => {
  for (const v of HOSTILE) assert.equal(P.safeProjectRel(v), null, `refused: ${JSON.stringify(v).slice(0, 40)}`);
  for (const v of ['csdb', 'Media', 'publication.xml', 'source/csdb', 'pm/PMC-X.xml']) assert.equal(P.safeProjectRel(v), v);
  assert.equal(P.csdbRel({ input: { csdbDir: '../other/csdb' } }), 'csdb');
  assert.equal(P.mediaRel({ input: { mediaDir: 'C:\\secret' } }), 'Media');
  assert.equal(P.pmRel({ input: { pm: '../../../canary.txt' } }), 'publication.xml');
  assert.equal(P.csdbRel({ input: { csdbDir: 'source/csdb' } }), 'source/csdb', 'a real custom folder still works');
  assert.deepEqual(P.unsafeInputFields({ input: { csdbDir: '../a', mediaDir: 'Media', pm: '/x' } }), ['csdbDir', 'pm']);
  assert.deepEqual(P.unsafeInputFields({ input: 'csdb' }), ['input']);
  assert.deepEqual(P.unsafeInputFields({}), []);
});

test('the settings route refuses every hostile file location (400) and leaves project.json as it was', async () => {
  const U = `/api/projects/${own}/settings`;
  const before = fs.readFileSync(P.projectJsonPath(own), 'utf8');
  const { project, version } = (await bob.get(U)).json;
  for (const key of ['csdbDir', 'mediaDir', 'pm']) {
    for (const v of HOSTILE) {
      const r = await bob.put(U, { project: { ...project, input: { ...(project.input || {}), [key]: v } }, baseHash: version });
      assert.equal(r.status, 400, `${key}=${JSON.stringify(v).slice(0, 40)} -> ${r.status}`);
      assert.equal(r.json.code, 'UNSAFE_PATH');
    }
  }
  assert.equal(fs.readFileSync(P.projectJsonPath(own), 'utf8'), before, 'nothing was written');
});

test('the settings route keeps the project\'s kind: format, authoring, type and id cannot be changed (400); name, folder and input keep the value on disk', async () => {
  const U = `/api/projects/${own}/settings`;
  const { project, version } = (await bob.get(U)).json;
  for (const [k, v] of [['format', 'jss'], ['authoring', 'jss-xml'], ['type', 'JSS'], ['id', 'carol-pump']]) {
    const r = await bob.put(U, { project: { ...project, [k]: v }, baseHash: version });
    assert.equal(r.status, 400, `${k} -> ${r.status}`); assert.equal(r.json.code, 'PROTECTED_SETTING');
  }
  const ok = await bob.put(U, { project: { ...project, name: 'Renamed Behind Your Back', group: 'Elsewhere', input: { csdbDir: 'other' }, sideText: { enabled: false } }, baseHash: version });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const pj = JSON.parse(fs.readFileSync(P.projectJsonPath(own), 'utf8'));
  assert.equal(pj.name, project.name, 'the name has its own route');
  assert.equal(pj.group ?? null, project.group ?? null, 'so has the folder');
  assert.deepEqual(pj.input ?? null, project.input ?? null, 'and the file layout is not a setting');
  assert.equal(pj.sideText.enabled, false, 'an ordinary setting is saved');
  assert.equal((await bob.put(U, { project: { ...pj, sideText: { enabled: true } }, baseHash: (await bob.get(U)).json.version })).status, 200, 'saving what the screen loaded works');
});

test('a project.json already poisoned on disk cannot reach another project: the read sites use the standard folders and the start-up scan reports it', async () => {
  const pjPath = P.projectJsonPath(own);
  const pj = JSON.parse(fs.readFileSync(pjPath, 'utf8'));
  fs.writeFileSync(pjPath, JSON.stringify({ ...pj, input: { csdbDir: `../${victim}/csdb`, mediaDir: `../${victim}/csdb`, pm: `../${victim}/csdb/${VICTIM_DM}` } }, null, 2));
  const dms = await bob.get(`/api/projects/${own}/dms`);
  assert.equal(dms.status, 200);
  assert.ok(!JSON.stringify(dms.json).includes('VICTIM'), 'carol\'s data module is not listed in bob\'s project');
  const media = await bob.get(`/api/projects/${own}/media/${encodeURIComponent(VICTIM_DM)}`);
  assert.notEqual(media.status, 200, 'and her file is not served as bob\'s media');
  assert.ok([403, 404].includes((await bob.get(`/api/projects/${victim}/dms`)).status), 'bob has no access to carol\'s project itself (404 hides that it exists)');
  const found = P.scanUnsafeProjectPaths();
  assert.deepEqual(found.find((f) => f.id === own)?.fields, ['csdbDir', 'mediaDir', 'pm']);
  assert.ok(fs.readFileSync(path.join(ctx.projectDirFor(victim), 'csdb', VICTIM_DM), 'utf8').includes('carol'), 'and carol\'s file is untouched');
  fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2));
});

test('a forged project archive cannot point the new project at another project, nor change its kind', async () => {
  const f = path.join(tmp('wp01-'), 'evil.zip');
  const z = new ZipStreamWriter(fs.createWriteStream(f));
  await z.addBuffer('manifest.json', Buffer.from(JSON.stringify({ manifestVersion: 1, generator: 'Agastya', id: 'x', name: 'Evil', type: 'S1000D', templateRef: 'default', format: 's1000d' })));
  await z.addBuffer('project/project.json', Buffer.from(JSON.stringify({ name: 'Evil', format: 'jss', authoring: 'jss-xml', type: 'JSS', input: { csdbDir: `../${victim}/csdb`, mediaDir: 'Media', pm: 'C:\\Windows\\win.ini' } })));
  await z.finish();
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(f)]), 'evil.jsspub.zip'); fd.append('source', 's1000d'); fd.append('target', 's1000d');
  const r = await bob.req('POST', '/api/xengine/import', fd);
  assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 400));
  const id = r.json.project.id;
  const pj = JSON.parse(fs.readFileSync(P.projectJsonPath(id), 'utf8'));
  assert.deepEqual(P.unsafeInputFields(pj), [], 'no unsafe location was kept');
  assert.equal(pj.input?.mediaDir, 'Media', 'a safe one was');
  assert.notEqual(pj.format, 'jss'); assert.notEqual(pj.authoring, 'jss-xml'); assert.notEqual(pj.type, 'JSS');
  assert.ok(JSON.stringify(r.json).includes('pointed outside the project'), 'the import report says what was dropped');
  assert.ok(!JSON.stringify((await bob.get(`/api/projects/${id}/dms`)).json).includes('VICTIM'));
});

test('architecture: no code outside services/projectRecord.ts (formerly projects.ts; WP-10) reads input.csdbDir / mediaDir / pm directly (they go through csdbRel / mediaRel / pmRel)', () => {
  const root = path.resolve(__dirname, '..', 'src'); const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|js)$/.test(e.name)) {
    const rel = path.relative(root, p).split(path.sep).join('/'); if (rel === 'services/projectRecord.ts') continue;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l, i) => { if (/\binput\s*(\?\.|\.|&&\s*\w+\.input\.)\s*(csdbDir|mediaDir|pm)\b/.test(l) && !/safeRelPath\(/.test(l)) hits.push(`${rel}:${i + 1}`); });
  } } };
  walk(root);
  assert.deepEqual(hits, [], 'raw reads of project.json file locations');
});
