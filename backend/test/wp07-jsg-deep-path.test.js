'use strict';
// WP-07 (audit DEP-011): the JSG build passes its stylesheet to xsltproc as an absolute location. With the old relative location a data
// folder deep enough made "../../.." plus the engine path longer than the 260 characters the 32-bit xsltproc can open, and the build failed
// with "failed to load external entity". This file runs in its own process: the data folder is fixed when the server code first loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');

const PW = 'Correct-Horse-9!';

test('a JSG build succeeds in a deep data folder whose relative route to the engine passes 260 characters (DEP-011)', { timeout: 600000 }, async () => {
  // Many short folders: the build folder itself stays inside what the 32-bit tools can use as a working folder (248 characters), while the
  // "../" steps of a relative location (three characters per level) plus the engine path run far past 260. That is the case the audit
  // measured (S1000D and JSS built there, JSG did not).
  let deep = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-deep-'));
  while (deep.length < 150) deep = path.join(deep, 'd');
  fs.mkdirSync(deep, { recursive: true });
  const prev = process.env.TEMP; const prevTmp = process.env.TMP;
  process.env.TEMP = deep; process.env.TMP = deep;               // boot() makes its workspace under os.tmpdir()
  const { boot } = require('./helpers');
  const h = await boot();
  process.env.TEMP = prev; process.env.TMP = prevTmp;
  try {
    assert.ok(h.ws.length >= 150 && h.ws.length < 210, `workspace path length ${h.ws.length}`);
    const admin = new h.Client('admin');
    assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
    const m = await admin.post('/api/team/users', { username: 'deep', fullName: 'Deep Author', role: 'author' });
    const w = new h.Client('deep');
    await w.post('/api/auth/login', { username: 'deep', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'deep', password: PW });
    const p = await w.post('/api/projects', { name: 'Deep handbook', format: 'jsg', domain: 'land', manualType: 'uhb' });
    assert.equal(p.status, 201, JSON.stringify(p.json));
    const id = p.json.project.id;
    const projectDir = path.join(h.ws, 'projects', id);
    const engineXsl = path.resolve(__dirname, '..', 'schemas', 'jsg', 'engine', 'jsg.xsl');
    const rel = path.relative(projectDir, engineXsl);
    assert.ok(path.resolve(projectDir, rel).length > 0 && (projectDir.length + 1 + rel.length) > 260, `the old relative form would pass 260 characters (${projectDir.length + 1 + rel.length})`);
    const b = await w.post(`/api/projects/${id}/jsg/build`);
    assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 500));
  } finally { await h.close(); }
});
