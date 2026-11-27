import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Drives the built app against a real server and a throwaway workspace. Uses a browser installed on the machine (no browser download needed on
// an offline PC).
//
// WP-08 (QA-011, QA-022, GAP-007, decision D18):
//   E2E_PORT     the server's port (default 4050). Two runners on different ports do not share a server, a workspace or an output folder.
//   E2E_CHANNEL  the browser: msedge (default, the reference browser of D18; the Mode A shell is WebView2, Edge's engine) or chrome. Chrome stable
//                crashes the tab when the Studio opens a data module on the audit host (UX-011, cause unknown), so it is not the default.
//   A lock file per port refuses a second runner on the same port: the old symptom was two runs corrupting each other's server and test-results.
const PORT = Number(process.env.E2E_PORT || 4050);
const BASE = `http://localhost:${PORT}`;

const LOCK = path.join(os.tmpdir(), `agastya-e2e-${PORT}.lock`);
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
// The runner evaluates this file, and so does every worker it starts (their parent is the runner): only a different, living process holds the port.
if (!process.env.E2E_NO_LOCK) {
  let holder = 0;
  try { holder = Number(fs.readFileSync(LOCK, 'utf8').trim()) || 0; } catch { /* no lock */ }
  if (holder && holder !== process.pid && holder !== process.ppid && alive(holder)) {
    throw new Error(`Another e2e run (process ${holder}) holds port ${PORT} (${LOCK}). Wait for it, or run on another port: E2E_PORT=4051 npx playwright test`);
  }
  if (!holder || !alive(holder)) {
    fs.writeFileSync(LOCK, String(process.pid));
    process.on('exit', () => { try { if (fs.readFileSync(LOCK, 'utf8').trim() === String(process.pid)) fs.rmSync(LOCK); } catch { /* gone */ } });
  }
}

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  // the 21-type x 4-issue verification is heavy (about 5 minutes): `npm run test:verify:e2e` sets VERIFY_E2E
  testIgnore: process.env.VERIFY_E2E ? [] : [/zz-verify-.*\.spec\.ts/],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: process.env.E2E_JUNIT ? [['list'], ['junit', { outputFile: process.env.E2E_JUNIT }]] : [['list']],
  outputDir: PORT === 4050 ? 'test-results' : `test-results-${PORT}`,
  use: {
    baseURL: BASE,
    channel: process.env.E2E_CHANNEL || 'msedge',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `${BASE}/api/health`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
