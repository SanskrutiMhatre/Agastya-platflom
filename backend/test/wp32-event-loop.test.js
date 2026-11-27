'use strict';
// WP-32 (audit PERF-001, interim step): while one author validates a 200-module project with BREX, the server keeps answering everyone
// else. The loops over modules give the event loop a turn every 25 ms (and between the scans); the real fix (validation in a worker) is WP-14. The server runs in
// this process (boot() uses createApp), so the event-loop delay measured here is the server's own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');

test('a 200-module validation with BREX does not hold the event loop: its longest stall stays under 100 ms and a second client is answered', { timeout: 600000 }, async () => {
  const h = await boot();
  try {
    const admin = new h.Client('admin');
    await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
    const made = await admin.post('/api/team/users', { username: 'val', fullName: 'Val Idator', role: 'author' });
    const w = new h.Client('val');
    await w.post('/api/auth/login', { username: 'val', password: made.json.tempPassword });
    await w.post('/api/auth/onboarding', { username: 'val', password: PW });
    const pid = (await w.post('/api/projects', { name: 'Big validation', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
    const csdb = path.join(h.ws, 'projects', pid, 'csdb');
    fs.mkdirSync(csdb, { recursive: true });
    // ten copies of the 21 fixture modules, each copy under its own system code, so every module has its own data module code
    const fixtures = fs.readdirSync(FIX).filter((f) => /^DMC-.*\.XML$/i.test(f));
    let n = 0;
    for (let k = 0; k < 10; k++) {
      const sc = String(10 + k);
      for (const f of fixtures) {
        const xml = fs.readFileSync(path.join(FIX, f), 'utf8').replace(/systemCode="00"/g, `systemCode="${sc}"`);
        fs.writeFileSync(path.join(csdb, f.replace('DMC-EXAMPLE-A-00-', `DMC-EXAMPLE-A-${sc}-`)), xml); n++;
      }
    }
    assert.ok(n >= 200, `${n} modules`);
    for (const f of fs.readdirSync(FIX).filter((x) => /^ICN-/i.test(x))) fs.copyFileSync(path.join(FIX, f), path.join(csdb, f));

    const viewer = new h.Client('admin');
    await viewer.post('/api/auth/login', { username: 'admin', password: PW });
    await w.post(`/api/projects/${pid}/validation`, { brex: true });                          // warm caches (schemas, BREX) once

    const h0 = monitorEventLoopDelay({ resolution: 5 }); h0.enable();
    let done = false; const answers = [];
    const poll = (async () => {
      while (!done) {
        const t = performance.now(); const r = await viewer.get('/api/health');
        answers.push({ status: r.status, ms: performance.now() - t });
        await new Promise((res) => setTimeout(res, 20));
      }
    })();
    const t0 = performance.now();
    const v = await w.post(`/api/projects/${pid}/validation`, { brex: true });
    const wall = performance.now() - t0; done = true; await poll; h0.disable();
    assert.equal(v.status, 200, JSON.stringify(v.json).slice(0, 300));
    assert.ok(v.json.run.brexChecked >= 200 && v.json.run.schemaChecked >= 200, `BREX and the schema ran on every module (${v.json.run.brexChecked}, ${v.json.run.schemaChecked})`);
    const maxMs = h0.max / 1e6;
    console.log(`validation of ${n} modules: ${Math.round(wall)} ms; longest event-loop stall ${maxMs.toFixed(1)} ms; ${answers.length} health answers, slowest ${Math.max(...answers.map((a) => a.ms)).toFixed(1)} ms`);
    assert.ok(maxMs < 100, `the longest event-loop stall was ${maxMs.toFixed(1)} ms`);
    assert.ok(answers.length >= 5 && answers.every((a) => a.status === 200), 'the other client was answered throughout');
  } finally { await h.close(); }
});
