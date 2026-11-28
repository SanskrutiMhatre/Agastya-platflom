// Phase 3, P3-6 (docs/phase3/standalone.md): the STANDALONE first run in a real browser against a real server on a throwaway data folder.
//
//   first launch: the default accounts with their passwords, "Save a copy" (to the file the person chooses), "I have stored them"
//   sign-in with a default password -> the forced-change screen (cannot be skipped: every page leads back to it), a default password refused
//   as the new one, the policy's minimum, then the application; the administration page shows the deployment and the unchanged defaults
//
// Needs a server started as a standalone installation; on any other (the full suite's common-server run) it skips itself:
//   cd frontend && AGASTYA_DEPLOYMENT=standalone E2E_PORT=4332 E2E_CHANNEL=msedge npx playwright test e2e/standalone-first-run.spec.ts

import { test, expect, type Browser, type Page } from '@playwright/test';

const DEFAULTS = [
  { username: 'admin', password: 'Admin@123', label: 'Administrator' },
  { username: 'manager', password: 'Manager@123', label: 'Project Manager' },
  { username: 'author', password: 'Author@123', label: 'Author' },
  { username: 'auditor', password: 'Auditor@123', label: 'Auditor (read-only)' },
];
const OWN = 'quiet harbour lantern 42';

test.describe.configure({ mode: 'serial' });

async function freshPage(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  // "Save a copy" opens the operating system's save dialog; here a stand-in records what would have been written to the chosen file
  await ctx.addInitScript(() => {
    const w = window as unknown as { __saved: string[]; showSaveFilePicker: unknown };
    w.__saved = [];
    w.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (b: Blob | string) => { w.__saved.push(typeof b === 'string' ? b : await b.text()); },
        close: async () => undefined,
      }),
    });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  return page;
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function changeDefault(page: Page, current: string, next: string): Promise<void> {
  await page.getByLabel('Default password').fill(current);
  await page.getByLabel('New password').fill(next);
  await page.getByLabel('Repeat password').fill(next);
  await page.getByRole('button', { name: 'Change password' }).click();
}

test.beforeAll(async ({ request }) => {
  const s = await (await request.get('/api/auth/setup')).json();
  test.skip(s.deployment !== 'standalone', 'this server is not a standalone installation (start it with AGASTYA_DEPLOYMENT=standalone)');
});

test('first launch: the default credentials, Save a copy, shown again until acknowledged', async ({ browser, baseURL }) => {
  const page = await freshPage(browser, baseURL);
  await page.goto('/');
  const card = page.getByTestId('first-launch');
  await expect(card).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your sign-in details' })).toBeVisible();
  for (const d of DEFAULTS) {
    const row = page.getByTestId(`first-launch-${d.username}`);
    await expect(row).toContainText(d.label);
    await expect(row).toContainText(d.username);
    await expect(row).toContainText(d.password);
  }
  await expect(card).toContainText('Store these details safely');
  await page.screenshot({ path: `${test.info().outputDir}/../shots/p36-first-launch.png` });

  await page.getByTestId('first-launch-save').click();
  await expect(card).toContainText('Saved where you chose.');
  const saved = await page.evaluate(() => (window as unknown as { __saved: string[] }).__saved);
  expect(saved).toHaveLength(1);
  for (const d of DEFAULTS) expect(saved[0]).toMatch(new RegExp(`${d.username}\\s+${d.password}`));
  expect(saved[0]).toContain('Store this note safely');

  // "Sign in now" goes to the sign-in screen for this visit only
  await page.getByTestId('first-launch-later').click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('first-launch')).toBeVisible();

  // "I have stored them": not shown again, on this page or a new one
  await page.getByTestId('first-launch-ack').click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByTestId('first-launch')).toHaveCount(0);
  await page.context().close();
});

test('the administrator signs in at once; the forced change cannot be skipped and refuses a default password', async ({ browser, baseURL }) => {
  const page = await freshPage(browser, baseURL);
  await page.goto('/');
  await signIn(page, 'admin', 'Admin@123');
  await expect(page.getByTestId('forced-change-default')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();

  // every page leads back to it: the gate is the server's, the screen is the only way out
  for (const url of ['/administrator/users', '/projects', '/']) {
    await page.goto(url);
    await expect(page.getByTestId('forced-change-default')).toBeVisible();
  }
  expect((await page.request.get('/api/projects')).status()).toBe(403);

  await changeDefault(page, 'Admin@123', 'Manager@123');
  await expect(page.getByTestId('forced-change-default')).toContainText('default passwords');
  await page.screenshot({ path: `${test.info().outputDir}/../shots/p36-forced-change.png` });
  await changeDefault(page, 'Admin@123', 'Short@1234');
  await expect(page.getByTestId('forced-change-default')).toContainText('at least');
  await changeDefault(page, 'Admin@123', OWN);
  await expect(page.getByTestId('forced-change-default')).toHaveCount(0);

  // the administration page: the deployment (read-only) and the default accounts still on their default password
  await page.goto('/administrator/users');
  await expect(page.getByTestId('admin-deployment-mode')).toHaveText('Standalone');
  const unchanged = page.getByTestId('admin-default-passwords');
  for (const u of ['manager', 'author', 'auditor']) await expect(unchanged).toContainText(u);
  await expect(unchanged).not.toContainText('admin');
  await expect(page.getByTestId('default-password-author')).toBeVisible();
  await expect(page.getByTestId('default-password-admin')).toHaveCount(0);
  await page.screenshot({ path: `${test.info().outputDir}/../shots/p36-admin.png` });
  // read-only under Access > Security as well (where a common server shows "Common server")
  await page.goto('/administrator/security');
  await expect(page.getByTestId('admin-deployment-mode')).toHaveText('Standalone');
  await page.context().close();
});

test('another default account: the same gate; after its change the default password is gone for good', async ({ browser, baseURL }) => {
  const page = await freshPage(browser, baseURL);
  await page.goto('/');
  await signIn(page, 'author', 'Author@123');
  await expect(page.getByTestId('forced-change-default')).toBeVisible();
  await changeDefault(page, 'Author@123', 'Author@123');
  await expect(page.getByTestId('forced-change-default')).toContainText('default passwords');
  await changeDefault(page, 'Author@123', `${OWN} too`);
  await expect(page.getByTestId('forced-change-default')).toHaveCount(0);
  await page.context().close();

  const again = await freshPage(browser, baseURL);
  await again.goto('/');
  await signIn(again, 'admin', 'Admin@123');
  await expect(again.getByText('Invalid username or password.')).toBeVisible();
  await again.context().close();
});
