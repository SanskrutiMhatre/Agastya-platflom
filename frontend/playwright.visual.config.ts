import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// WP-20 (TH-009, QA-012, RES-007, DS-010; audit 08 section 7.4, 11 section 10.7-10.8, 12 G-UX-1 / G-UX-3): the theme and accessibility suite.
//   npx playwright test -c playwright.visual.config.ts                     run it (needs `npx vite build` and a built backend, like e2e/)
//   npx playwright test -c playwright.visual.config.ts --update-snapshots  take new baselines (review the diff images; light and dark together)
//
// Separate from playwright.config.ts on purpose: its own port (E2E_PORT, default 4060), its own server and throwaway workspace, its own output
// folder and lock, so it never meets the main e2e run on 4050. One project per theme: every spec reads the theme from the project and asserts
// html[data-theme] before it takes a picture, so a baseline cannot be taken in the wrong theme.
//
// Flake control (the audit's risk for this package): the browser channel is pinned (msedge, decision D18; the browser version is recorded in the
// snapshot folder's VERSION file by the spec and a mismatch is reported), the UI font is pinned to Arial through e2e/visual/stable.css (the
// Segoe UI Variable build differs between Windows images), device scale 1, reduced motion, animations and the caret disabled, dates and ids
// masked, one worker.
const PORT = Number(process.env.E2E_PORT || 4060);
const BASE = `http://localhost:${PORT}`;

const LOCK = path.join(os.tmpdir(), `agastya-e2e-${PORT}.lock`);
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
if (!process.env.E2E_NO_LOCK) {
  let holder = 0;
  try { holder = Number(fs.readFileSync(LOCK, 'utf8').trim()) || 0; } catch { /* no lock */ }
  if (holder && holder !== process.pid && holder !== process.ppid && alive(holder)) {
    throw new Error(`Another e2e run (process ${holder}) holds port ${PORT} (${LOCK}). Wait for it, or run on another port: E2E_PORT=4062 npx playwright test -c playwright.visual.config.ts`);
  }
  if (!holder || !alive(holder)) {
    fs.writeFileSync(LOCK, String(process.pid));
    process.on('exit', () => { try { if (fs.readFileSync(LOCK, 'utf8').trim() === String(process.pid)) fs.rmSync(LOCK); } catch { /* gone */ } });
  }
}

const theme = (name: 'light' | 'dark') => ({ name, use: { colorScheme: name } });

export default defineConfig({
  testDir: './e2e/visual',
  testMatch: /.*\.spec\.ts/,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, threshold: 0.2, animations: 'disabled', caret: 'hide', scale: 'css', stylePath: './e2e/visual/stable.css' },
  },
  // the theme is a directory, so a reviewer sees both themes of a screen side by side (08 section 7.4); no platform suffix: the runner is pinned
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.E2E_JUNIT ? [['list'], ['junit', { outputFile: process.env.E2E_JUNIT }]] : [['list']],
  outputDir: `test-results-visual-${PORT}`,
  use: {
    baseURL: BASE,
    channel: process.env.E2E_CHANNEL || 'msedge',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'UTC',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [theme('light'), theme('dark')],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `${BASE}/api/health`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
