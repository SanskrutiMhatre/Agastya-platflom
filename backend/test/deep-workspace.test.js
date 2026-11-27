'use strict';
// A workspace that is deep in the file system must not stop a build.
//
// xsltproc joins a RELATIVE stylesheet location to the working directory as a string before it opens it. The project folder is the working
// directory and the stylesheets live in the application folder, so the location was "../" steps (one per level of the project's own path)
// plus the way down to the pipeline - and passed Windows' 260-character limit while the real path was short:
//   "warning: failed to load external entity ../../../../../../Users/.../s1000dtofo/s1000dtofo.xsl"
// An installed application (workspace under the user's profile, application under Program Files, a project named at the 80-character limit)
// reaches that limit; so does any checkout on a deep path. The engine now hands xsltproc absolute locations.
//
// What cannot be fixed: a FILE whose full path is 260 characters or more cannot be opened by the bundled tools at all. That is reported for what it
// is (the path), not as "XML cannot be parsed".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { boot, DM21 } = require('./helpers');     // reads TEMP only when boot() runs, so it may load before TEMP is moved below

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const DM = fs.readdirSync(FIX).find((f) => /-040A-D_/.test(f));
const WIN = process.platform === 'win32';

// Put the throwaway workspace so deep that a SHORT project's folder is ~150 characters and an 80-character project name pushes it past 230.
// (os.tmpdir() reads TEMP/TMP when it is called, and boot() creates its workspace under it.)
const TARGET_SHORT_PROJECT_DIR = 150;
{
  const fixed = os.tmpdir().length + 1 + 'agastya-v2-test-XXXXXX'.length + '\\projects\\'.length + 'deep'.length;
  const pad = Math.max(1, TARGET_SHORT_PROJECT_DIR - fixed - 1);
  const deep = path.join(os.tmpdir(), 'd'.repeat(pad)); fs.mkdirSync(deep, { recursive: true });
  process.env.TEMP = deep; process.env.TMP = deep; process.env.TMPDIR = deep;
}

let h; let w;
test.before(async () => {
  h = await boot();
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'dora', fullName: 'Dora', role: 'author' });
  w = new h.Client('dora'); await w.post('/api/auth/login', { username: 'dora', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'dora', password: PW });
});
test.after(async () => { if (h) await h.close(); });

async function project(name) {
  const pr = await w.post('/api/projects', { name, format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5-0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(pr.status, 201, JSON.stringify(pr.json));
  const id = pr.json.project.id; const U = `/api/projects/${id}`;
  assert.equal((await w.post(`${U}/dms`, { file: DM, xml: fs.readFileSync(path.join(FIX, DM), 'utf8') })).status, 201);
  return { id, U, dir: path.join(h.ws, 'projects', id) };
}

test('a project folder ~150 characters deep (the way back to the pipeline would have passed 260) publishes PDF and HTML', async () => {
  const p = await project('deep');
  assert.ok(p.dir.length >= 140 && p.dir.length <= 160, `the folder is as deep as this test needs (${p.dir.length})`);
  const rel = path.relative(p.dir, path.resolve(__dirname, '..', 'vendor', 'pipeline')).length;
  if (WIN) assert.ok(p.dir.length + 1 + rel + '/s1000dtofo/s1000dtofo.xsl'.length >= 260, 'the OLD relative location would have been past the limit');
  const pdf = await w.post(`${p.U}/publish`, {}); assert.equal(pdf.status, 200, JSON.stringify(pdf.json).slice(0, 400));
  const bytes = (await w.get(`${p.U}/publish/pdf`)).buf; assert.equal(bytes.subarray(0, 4).toString(), '%PDF'); assert.ok(bytes.length > 5000);
  const html = await w.post(`${p.U}/publish/html`, {}); assert.ok(html.status < 300, JSON.stringify(html.json).slice(0, 300));
});

test('a file whose own path is 260+ characters is reported as a path problem, not as malformed XML (Windows)', { skip: !WIN && 'the limit is a Windows one' }, async () => {
  const p = await project('Maintenance manual for the hydraulic power unit of the deployable system 1234');
  const file = path.join(p.dir, 'csdb', DM);
  assert.ok(file.length >= 260, `the file path is past the limit (${file.length})`);
  const b = await w.post(`${p.U}/publish`, {}); assert.equal(b.status, 422, JSON.stringify(b.json).slice(0, 300));
  assert.equal(b.json.code, 'VALIDATION_FAILED');
  const text = JSON.stringify(b.json);
  assert.match(text, /full path is \d+ characters/); assert.match(text, /259 characters/);
  assert.match(text, /File path too long/); assert.doesNotMatch(text, /XML cannot be parsed/);
});
