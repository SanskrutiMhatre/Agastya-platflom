'use strict';
// WP-14 helper process for test/wp14-job-limits.test.js: a server of its own, so the test can kill it outright.
//   node helpers-jobserver.js serve     boots the app on a throwaway workspace (AGASTYA_JOB_TEST_KINDS=1 and the limits come from the parent's
//                                       environment), runs the jobs the test needs and prints one JSON line per step; then waits to be killed.
//   node helpers-jobserver.js inspect   opens the workspace in AGASTYA_WORKSPACE_DIR as a restarted server would and prints the job records named
//                                       in argv (projectId:jobId ...).
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

async function serve() {
  const { boot } = require('./helpers');
  const h = await boot();
  const jobs = require('../dist/services/jobs');
  say({ step: 'booted', ws: h.ws, serverPid: process.pid });
  // a worker that takes more memory than its limit
  const alloc = await jobs.run({ kind: 'test.alloc', projectId: 'p-alloc', params: { mb: 4096 } }).then((r) => ({ ok: true, r }), (e) => ({ ok: false, code: e.code, status: e.status, message: e.message }));
  say({ step: 'alloc', ...alloc });
  const after = await jobs.run({ kind: 'test.sleep', projectId: 'p-alloc', params: { ms: 20 } }).then((r) => r.slept, (e) => e.message);
  say({ step: 'after-alloc', slept: after });
  // a worker with a long-lived child (as a JVM is), and a job left running
  const spawned = await jobs.run({ kind: 'test.spawn', projectId: 'p-spawn' });
  const s = jobs.submit({ kind: 'test.sleep', projectId: 'p-hang', params: { ms: 600000 } });
  while (jobs.getJob('p-hang', s.id).state !== 'running') await new Promise((r) => setTimeout(r, 50));
  const st = jobs.jobsStatus();
  say({ step: 'running', childPid: spawned.childPid, spawnWorkerPid: spawned.workerPid, hangJob: s.id, workers: st.pool.workers.map((w) => w.pid), jobObject: st.pool.jobObject });
  setInterval(() => {}, 60_000);
}

function inspect() {
  const jobs = require('../dist/services/jobs');
  for (const a of process.argv.slice(3)) { const [p, id] = a.split(':'); const j = jobs.getJob(p, id); say({ id, state: j?.state, error: j?.error }); }
  require('../dist/context').registryDb.close();
}

(process.argv[2] === 'serve' ? serve() : Promise.resolve(inspect())).catch((e) => { say({ step: 'error', message: e.message, stack: e.stack }); process.exit(1); });
