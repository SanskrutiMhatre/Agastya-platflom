'use strict';
// WP-14 / PRD-001 (addendum 17): operating-system limits and supervision of the job workers. The server runs in a process of its own
// (helpers-jobserver.js) so the test can kill it outright:
//   * a worker that takes more memory than the per-process limit of the Windows job object is refused it; only its job fails, with a message;
//   * killing the server leaves no worker and no process a worker started (a JVM in real builds) behind: kill-on-close of the job object;
//   * a job that was running when the server died is "interrupted" in its record when a server opens the workspace again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('node:readline');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (pred, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { if (await pred()) return true; await new Promise((r) => setTimeout(r, 200)); } throw new Error(`timed out waiting for ${what}`); };
const SCRIPT = path.join(__dirname, 'helpers-jobserver.js');

test('memory limit, no orphans after the server is killed, and interrupted records after a restart', { skip: process.platform !== 'win32' && 'Windows job objects only', timeout: 300000 }, async () => {
  const env = { ...process.env, AGASTYA_JOB_TEST_KINDS: '1', AGASTYA_JOB_PROCESS_MB: '400', AGASTYA_KEEP_TEMP: '1' };
  delete env.AGASTYA_WORKSPACE_DIR;
  const server = spawn(process.execPath, [SCRIPT, 'serve'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const steps = {};
  const rl = readline.createInterface({ input: server.stdout });
  rl.on('line', (l) => { try { const o = JSON.parse(l); if (o.step) steps[o.step] = o; } catch { /* a log line */ } });
  let ws = null;
  try {
    await until(() => steps.running || steps.error, 240000, 'the helper server');
    assert.ok(!steps.error, JSON.stringify(steps.error));
    ws = steps.booted.ws;
    assert.equal(steps.running.jobObject.state, 'active', `the job object is in force: ${JSON.stringify(steps.running.jobObject)}`);

    // the allocation was refused at the limit; only that job failed, and the next job of the same project ran
    assert.equal(steps.alloc.ok, false, 'the 4 GB allocation did not succeed under a 400 MB limit');
    assert.ok(['JOB_MEMORY_LIMIT', 'JOB_WORKER_CRASHED'].includes(steps.alloc.code), JSON.stringify(steps.alloc));
    assert.match(steps.alloc.message, /memory limit|than its limit/);
    assert.equal(steps['after-alloc'].slept, 20);

    const { childPid, spawnWorkerPid, workers, hangJob } = steps.running;
    assert.ok(alive(childPid) && workers.every(alive), 'the worker and its child run');

    // kill the server alone (not its tree): the job object must take its workers and their children down
    spawnSync('taskkill', ['/PID', String(server.pid), '/F'], { stdio: 'ignore' });
    await until(() => !alive(server.pid), 15000, 'the server to die');
    await until(() => !alive(childPid) && !alive(spawnWorkerPid) && workers.every((p) => !alive(p)), 30000, 'the workers and their children to end');

    // a restarted server sees the job that was running as interrupted
    const out = spawnSync(process.execPath, [SCRIPT, 'inspect', `p-hang:${hangJob}`], { env: { ...env, AGASTYA_WORKSPACE_DIR: ws }, encoding: 'utf8' });
    const rec = JSON.parse(out.stdout.trim().split('\n').pop());
    assert.equal(rec.state, 'interrupted', out.stdout + out.stderr);
    assert.equal(rec.error.code, 'JOB_INTERRUPTED');
  } finally {
    try { server.kill(); } catch { /* gone */ }
    if (ws) try { fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the temp sweep takes it */ }
  }
});
