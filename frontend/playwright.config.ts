import { defineConfig } from '@playwright/test';

// Drives the built app against a real server and a throwaway workspace. Uses the
// machine's installed Chrome (no browser download needed on an offline PC);
// set E2E_CHANNEL=msedge to use Edge instead.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  // the 21-type x 4-issue verification is heavy (about 5 minutes): `npm run test:verify:e2e` sets VERIFY_E2E
  testIgnore: process.env.VERIFY_E2E ? [] : [/zz-verify-.*\.spec\.ts/],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4050',
    channel: process.env.E2E_CHANNEL || 'chrome',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: 'http://localhost:4050/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
  },
});
