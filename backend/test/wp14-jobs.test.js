'use strict';
// WP-14 (PERF-001, PUB-003, PUB-004, PUB-027, DEP-028, PERF-012, PRD-001): the job service. Validation, the publish gate and builds run as
// jobs in worker processes; a job has a record and a replayable log, can be cancelled, has a deadline, and a worker that dies fails only its
// own job. The diagnostic kinds (sleep, busy, crash) stand in for a hung or crashing engine (AGASTYA_JOB_TEST_KINDS=1, tests only).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { boot, DM21 } = require('./helpers');

process.env.AGASTYA_JOB_TEST_KINDS = '1';
const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (pred, ms = 30000, what = 'condition') => { const end = Date.now() + ms; while (Date.now() < end) { const v = await pred(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`timed out waiting for ${what}`); };

let h; let w; let pid; let jobs; let sock; let admin;
test.before(async () => {
  h = await boot({ ws: true });
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const made = await admin.post('/api/team/users', { username: 'jobrunner', fullName: 'Jo B', role: 'author' });
  w = new h.Client('jobrunner');
  await w.post('/api/auth/login', { username: 'jobrunner', password: made.json.tempPassword });
  await w.post('/api/auth/onboarding', { username: 'jobrunner', password: PW });
  const made2 = await w.post('/api/projects', { name: 'Job service', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(made2.status, 201, JSON.stringify(made2.json));
  pid = made2.json.project.id;
  const csdb = path.join(h.ws, 'projects', pid, 'csdb'); fs.mkdirSync(csdb, { recursive: true });
  for (const f of fs.readdirSync(FIX).filter((x) => /^(DMC|ICN)-/i.test(x)).slice(0, 12)) fs.copyFileSync(path.join(FIX, f), path.join(csdb, f));
  jobs = require('../dist/services/jobs');
  sock = await h.socket(w);
  assert.equal(sock.opened, true);
});
test.after(async () => { sock?.close(); await h?.close(); });

test('a validation is a job in a worker: ?async=1 answers 202, the record and its result are read back, the socket says when it ended', { timeout: 180000 }, async () => {
  const r = await w.post(`/api/projects/${pid}/validation?async=1`, { brex: true });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  const id = r.json.job.id;
  const done = await until(async () => { const g = await w.get(`/api/projects/${pid}/jobs/${id}`); return ['succeeded', 'failed'].includes(g.json.job.state) ? g.json.job : null; }, 120000, 'the job');
  assert.equal(done.state, 'succeeded', JSON.stringify(done.error));
  assert.ok(done.result.run.schemaChecked >= 10 && done.result.run.brexChecked >= 10, 'every module judged');
  assert.ok(done.startedAt && done.finishedAt, 'times recorded');
  assert.ok(await sock.waitFor((m) => m.type === 'job' && m.job.id === id && m.job.state === 'succeeded', 5000), 'a "job" message for the end');
  assert.ok(sock.messages.some((m) => m.type === 'job' && m.job.id === id && m.job.state === 'running'), 'and one for the start');
  const list = await w.get(`/api/projects/${pid}/jobs`);
  assert.ok(list.json.jobs.some((j) => j.id === id && j.kind === 'validate'));
  const adm = await admin.get('/api/admin/jobs');
  assert.equal(adm.status, 200); assert.equal((await w.get('/api/admin/jobs')).status, 403, 'the service view is for administrators');
  const st = adm.json;
  assert.equal(st.mode, 'worker', 'the compiled server runs jobs in worker processes');
  assert.ok(st.pool.workers.length >= 1 && st.pool.workers.every((x) => x.pid !== process.pid), 'not in the server process');
  assert.equal(st.pool.jobObject.state, process.platform === 'win32' ? 'active' : 'off', JSON.stringify(st.pool.jobObject));
});

test('the blocking route answers as before, from the worker; a second run of unchanged content is the stored run (at most 20% of the time); a change runs again', { timeout: 300000 }, async () => {
  const t0 = performance.now(); const a = await w.post(`/api/projects/${pid}/validation`, { brex: true, fresh: true }); const first = performance.now() - t0;
  assert.equal(a.status, 200); assert.ok(a.headers.get('x-job-id'));
  assert.notEqual(a.json.run.cached, true);
  const t1 = performance.now(); const b = await w.post(`/api/projects/${pid}/validation`, { brex: true }); const second = performance.now() - t1;
  assert.equal(b.status, 200); assert.equal(b.json.run.cached, true, 'answered from the stored run');
  assert.deepEqual(b.json.run.issues, a.json.run.issues, 'the same findings'); assert.equal(b.json.run.ranAt, a.json.run.ranAt);
  console.log(`validation ${Math.round(first)} ms, unchanged again ${Math.round(second)} ms (${((second / first) * 100).toFixed(1)}%)`);
  assert.ok(second <= first * 0.2, `second run ${second.toFixed(0)} ms vs first ${first.toFixed(0)} ms`);
  const other = await w.post(`/api/projects/${pid}/validation`, { brex: false });
  assert.notEqual(other.json.run.cached, true, 'other options are another run');
  const csdb = path.join(h.ws, 'projects', pid, 'csdb'); const f = fs.readdirSync(csdb).find((x) => /^DMC-/i.test(x));
  const later = new Date(Date.now() + 5000); fs.utimesSync(path.join(csdb, f), later, later);
  const c = await w.post(`/api/projects/${pid}/validation`, { brex: true });
  assert.notEqual(c.json.run.cached, true, 'a module changed: judged again');
});

test('progress lines are recorded and replayed after a sequence number, and reach the socket tagged with the job id', { timeout: 60000 }, async () => {
  const s = jobs.submit({ kind: 'test.progress', projectId: pid, params: { lines: 4 } });
  await s.done;
  const all = (await w.get(`/api/projects/${pid}/jobs/${s.id}`)).json.job;
  assert.deepEqual(all.log.map((l) => [l.seq, l.message]), [[1, 'step 1 of 4'], [2, 'step 2 of 4'], [3, 'step 3 of 4'], [4, 'step 4 of 4']]);
  const rest = (await w.get(`/api/projects/${pid}/jobs/${s.id}?after=2`)).json.job;
  assert.deepEqual(rest.log.map((l) => l.seq), [3, 4], 'replay after a reconnect');
  assert.ok(await sock.waitFor((m) => m.type === 'progress' && m.jobId === s.id && m.message === 'step 4 of 4', 3000));
});

test('cancel: a running job ends with its process tree, its waiter gets JOB_CANCELLED, the next job runs', { timeout: 120000 }, async () => {
  const s = jobs.submit({ kind: 'test.sleep', projectId: pid, params: { ms: 600000 } });
  await until(() => jobs.getJob(pid, s.id).state === 'running', 30000, 'running');
  const workerPid = await until(() => jobs.jobsStatus().pool.workers.find((x) => x.busy)?.pid, 10000, 'the busy worker');
  const c = await w.post(`/api/projects/${pid}/jobs/${s.id}/cancel`);
  assert.equal(c.status, 200, JSON.stringify(c.json));
  await assert.rejects(s.done, (e) => e.code === 'JOB_CANCELLED' && e.status === 409 && /cancelled by jobrunner/.test(e.message));
  await until(() => !alive(workerPid), 15000, 'the worker to end');
  assert.equal((await w.get(`/api/projects/${pid}/jobs/${s.id}`)).json.job.state, 'cancelled');
  assert.equal((await w.post(`/api/projects/${pid}/jobs/${s.id}/cancel`)).status, 409, 'an ended job cannot be cancelled');
  assert.deepEqual(await jobs.run({ kind: 'test.sleep', projectId: pid, params: { ms: 50 } }).then((r) => r.slept), 50);
  const viewer = new h.Client('nobody');
  assert.equal((await viewer.get(`/api/projects/${pid}/jobs/${s.id}`)).status, 401, 'jobs are behind the project guard');
});

test('deadline (hang simulation, DEP-028): a worker that never answers is killed at the limit, only its job fails, and the next job succeeds', { timeout: 120000 }, async () => {
  const t0 = Date.now();
  const s = jobs.submit({ kind: 'test.busy', projectId: pid, params: { ms: 600000 }, timeoutMs: 15000 });   // a 15 s deadline for this job
  const other = jobs.run({ kind: 'test.sleep', projectId: 'another-project', params: { ms: 200 } });
  assert.equal((await other).slept, 200, 'another project is served while the hung job runs');
  const health = await w.get('/api/health'); assert.equal(health.status, 200, 'the server answers');
  await assert.rejects(s.done, (e) => e.code === 'JOB_TIMEOUT' && e.status === 504);
  const took = Date.now() - t0;
  assert.ok(took >= 14000 && took < 60000, `ended at the deadline (${took} ms)`);
  assert.equal((await jobs.run({ kind: 'test.sleep', projectId: pid, params: { ms: 10 } })).slept, 10);
});

test('a worker that crashes fails only its job with a clear error; the server and the next job are fine', { timeout: 120000 }, async () => {
  const before = jobs.jobsStatus().pool.crashed;
  await assert.rejects(jobs.run({ kind: 'test.crash', projectId: pid }), (e) => e.code === 'JOB_WORKER_CRASHED' && /stopped unexpectedly \(exit code 70\)/.test(e.message) && /Only this job failed/.test(e.message));
  assert.equal(jobs.jobsStatus().pool.crashed, before + 1);
  assert.equal((await w.get('/api/health')).status, 200);
  const v = await w.post(`/api/projects/${pid}/validation`, { brex: false, fresh: true });
  assert.equal(v.status, 200);
});

test('one job at a time per project (any kind), projects in parallel, and an identical queued request joins the queued job', { timeout: 120000 }, async () => {
  const a = jobs.submit({ kind: 'test.sleep', projectId: pid, params: { ms: 1500 } });
  const b = jobs.submit({ kind: 'test.sleep', projectId: pid, params: { ms: 300 } });
  const b2 = jobs.submit({ kind: 'test.sleep', projectId: pid, params: { ms: 300 } });
  assert.equal(b2.id, b.id, 'joined'); assert.equal(b2.coalesced, true);
  const x = jobs.submit({ kind: 'test.sleep', projectId: 'p-x', params: { ms: 1500 } });
  await Promise.all([a.done, b.done, x.done]);
  const rec = (s, p) => jobs.getJob(p, s.id);
  const A = rec(a, pid); const B = rec(b, pid); const X = rec(x, 'p-x');
  assert.ok(Date.parse(B.startedAt) >= Date.parse(A.finishedAt), 'the second job of the project waited for the first');
  assert.ok(Date.parse(X.startedAt) < Date.parse(A.finishedAt), 'another project ran beside it');
});

test('a gate refusal travels back unchanged: the worker\'s error is the error the same check throws in the server process', { timeout: 300000 }, async () => {
  const { assertPublishable } = require('../dist/services/publishGate');
  const csdb = path.join(h.ws, 'projects', pid, 'csdb'); const [f, g] = fs.readdirSync(csdb).filter((x) => /^DMC-/i.test(x));
  const fields = (e) => ({ name: e.name, status: e.status, code: e.code, message: e.message, findings: e.extra?.findings, modules: e.extra?.modules });
  // a module that does not match its schema (an element S1000D does not have), and one that is not well-formed at all
  fs.writeFileSync(path.join(csdb, f), fs.readFileSync(path.join(csdb, f), 'utf8').replace(/<content>/, '<content><notAnS1000dElement/>'));
  fs.writeFileSync(path.join(csdb, g), fs.readFileSync(path.join(csdb, g), 'utf8').replace(/<\/dmodule>\s*$/, ''));
  for (const file of [f, g]) {
    const scope = { file };
    const here = await assertPublishable(pid, scope, {}).then(() => null, (e) => e);
    const there = await jobs.run({ kind: 'gate', projectId: pid, params: { scope, opts: {} } }).then(() => null, (e) => e);
    assert.ok(here && there, `both refuse ${file}`);
    const a = fields(here); const b = fields(there);
    assert.deepEqual(b, a, `the same refusal for ${file}`);
  }
  const s = fields(await jobs.run({ kind: 'gate', projectId: pid, params: { scope: { file: f }, opts: {} } }).catch((e) => e));
  assert.equal(s.status, 422); assert.equal(s.code, 'VALIDATION_FAILED'); assert.equal(s.findings[0].kind, 'schema');
});

test('a publication builds in a worker (same answer, plus the build report), and the built project can be deleted: the workers let its pictures go', { timeout: 300000 }, async () => {
  const { placeholderPng } = require('../dist/services/importer/png');
  const r = await w.post('/api/projects', { name: 'Built in a worker', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(r.status, 201, JSON.stringify(r.json)); const id = r.json.project.id; const dir = path.join(h.ws, 'projects', id);
  const descFile = fs.readdirSync(FIX).find((f) => /-040A-D_/.test(f));
  const icn = 'ICN-EXAMPLE-A-000000-A-00000-00001-A-001-01';
  fs.mkdirSync(path.join(dir, 'csdb'), { recursive: true }); fs.writeFileSync(path.join(dir, 'csdb', `${icn}.png`), placeholderPng(1));
  const xml = fs.readFileSync(path.join(FIX, descFile), 'utf8').replace('<!DOCTYPE dmodule [', `<!DOCTYPE dmodule [\n  <!NOTATION png SYSTEM "png">\n  <!ENTITY ${icn} SYSTEM "${icn}.png" NDATA png>`).replace('</description>', `<levelledPara><title>Picture</title><figure><title>A picture</title><graphic infoEntityIdent="${icn}"/></figure></levelledPara></description>`);
  const made = await w.post(`/api/projects/${id}/dms`, { file: descFile, xml });
  assert.equal(made.status, 201, JSON.stringify(made.json).slice(0, 300));
  const code = /<dmCode\s+([^>]*?)\s*\/?>/.exec(xml)[1];
  const pm = fs.readFileSync(path.join(dir, 'publication.xml'), 'utf8');
  const content = `<content><pmEntry><pmEntryTitle>One</pmEntryTitle><dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef></pmEntry></content>`;
  fs.writeFileSync(path.join(dir, 'publication.xml'), /<content[\s\S]*<\/content>|<content\s*\/>/.test(pm) ? pm.replace(/<content[\s\S]*<\/content>|<content\s*\/>/, content) : pm.replace('</pm>', `${content}</pm>`));
  const b = await w.post(`/api/projects/${id}/publish`, {});
  assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 500));
  assert.ok(b.json.ok && b.json.bytes > 1000 && b.json.pdfUrl && Array.isArray(b.json.ruleBreaks), 'the answer the page reads, as before');
  assert.ok(b.json.jobId && b.json.report && Array.isArray(b.json.report.notes) && b.json.report.lines > 0, 'plus the job and its report');
  assert.equal((await w.get(`/api/projects/${id}/publish/pdf`)).status, 200);
  const del = await w.req('DELETE', `/api/projects/${id}?confirm=${encodeURIComponent('Built in a worker')}`);
  assert.equal(del.status, 200, JSON.stringify(del.json).slice(0, 300));
  assert.equal(fs.existsSync(dir), false, 'the folder is gone');
});
