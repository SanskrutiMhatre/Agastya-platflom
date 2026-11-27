// WP-35: the screens redesigned on the design system, in a real browser against the real server. Nothing is mocked.
//
//   - the application's own dialog replaces the browser's confirm/prompt: the message names the exact consequence, Cancel keeps the
//     content, the confirm button does it (GAP-002; the ISPL "Delete plate")
//   - password fields: Show / Hide with aria-pressed, the Caps Lock notice, the repeat-password mismatch on the repeat field (UID-001, UID-002)
//   - context menu on a project row: right-click and Shift+F10, the row's own actions, Escape returns the focus (UID-005)
//   - the three samples behind one Samples button; the sidebar in groups with the current page marked (UX-014, group 2)

import { test, expect, type Browser, type Page, type APIRequestContext } from '@playwright/test';
import { adminApi, newPerson, PW, type Person } from './support/session';

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext; let owner: Person;
let ispl = '';

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  admin = await adminApi(baseURL);
  owner = await newPerson(admin, browser, baseURL, 'wp35o', 'Redesign Owner');
  const p = await owner.api.post('/api/projects', { data: { name: 'WP35 ISPL', format: 'jsg', domain: 'land', manualType: 'ispl' } }); expect(p.status()).toBe(201);
  ispl = (await p.json()).project.id;
});
test.afterAll(async () => { await owner.page.context().close(); await admin.dispose(); });

async function fresh(browser: Browser, baseURL: string | undefined, signedIn = true): Promise<Page> {
  const ctx = await browser.newContext({ storageState: signedIn ? await owner.api.storageState() : undefined, viewport: { width: 1366, height: 768 }, baseURL });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  return page;
}

test('sign-in: the password can be shown and hidden from the keyboard; Caps Lock is announced', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL, false);
  try {
    await page.goto('/');
    const pw = page.getByLabel('Password');
    await expect(pw).toHaveAttribute('type', 'password');
    await pw.fill('blue harbour lantern');
    await page.keyboard.press('Tab');                                                           // the next stop is the Show button
    const reveal = page.getByTestId('password-reveal');
    await expect(reveal).toBeFocused();
    await expect(reveal).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter');
    await expect(pw).toHaveAttribute('type', 'text');
    await expect(reveal).toHaveText('Hide'); await expect(reveal).toHaveAttribute('aria-pressed', 'true');
    await expect(pw).toHaveValue('blue harbour lantern');                                         // nothing typed is lost
    await page.keyboard.press('Space');
    await expect(pw).toHaveAttribute('type', 'password');
    await pw.focus();
    // Headless browsers do not toggle the Caps Lock state on a synthetic CapsLock press, so the key events carry the modifier state the
    // component reads with getModifierState('CapsLock'), as a real keyboard does.
    await pw.dispatchEvent('keydown', { key: 'A', code: 'KeyA', modifierCapsLock: true });
    await expect(page.getByTestId('caps-lock')).toHaveText('Caps Lock is on');
    await expect(pw).toHaveAttribute('aria-describedby', /./);
    await pw.dispatchEvent('keydown', { key: 'b', code: 'KeyB', modifierCapsLock: false });
    await expect(page.getByTestId('caps-lock')).toHaveCount(0);
  } finally { await page.context().close(); }
});

test('settings: a repeat password that differs is marked on the repeat field, which gets the focus; nothing is sent', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  try {
    let sent = 0;
    page.on('request', (r) => { if (r.url().includes('/api/auth/change-password')) sent++; });
    await page.goto('/settings');
    await page.getByLabel('Current password').fill(PW);
    await page.getByLabel('New password', { exact: true }).fill('a long enough new pass phrase');
    await page.getByLabel('Repeat new password').fill('a long enough new pass phrasf');
    await page.getByRole('button', { name: 'Change password' }).click();
    const repeat = page.getByLabel('Repeat new password');
    await expect(repeat).toHaveAttribute('aria-invalid', 'true');
    await expect(repeat).toBeFocused();
    await expect(page.getByText('The new passwords do not match.')).toBeVisible();
    await repeat.fill('a long enough new pass phrase');
    await expect(page.getByText('The new passwords do not match.')).toHaveCount(0);               // the message goes as soon as they agree
    expect(sent).toBe(0);
  } finally { await page.context().close(); }
});

test('projects: one Samples button holds the three samples; a row has a context menu with its own actions', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  try {
    await page.goto('/projects');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByText('Library', { exact: true })).toBeVisible();
    await expect(nav.getByText('Manage', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Projects', exact: true })).toHaveClass(/active/);
    for (const id of ['create-sample', 'create-jsg-sample', 'create-jsg-ispl-sample']) await expect(page.getByTestId(id)).toHaveCount(0);
    const samples = page.getByTestId('samples-menu');
    await samples.click();
    await expect(samples).toHaveAttribute('aria-expanded', 'true');
    for (const id of ['create-sample', 'create-jsg-sample', 'create-jsg-ispl-sample']) await expect(page.getByTestId(id)).toBeVisible();
    await page.getByTestId('create-sample').focus(); await page.keyboard.press('Escape');
    await expect(page.getByTestId('create-sample')).toHaveCount(0);
    await expect(samples).toBeFocused();

    const row = page.getByTestId('project-row').filter({ hasText: 'WP35 ISPL' });
    await row.click({ button: 'right' });
    const menu = page.getByTestId('context-menu');
    await expect(menu).toHaveAttribute('aria-label', 'Project WP35 ISPL');
    await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'Copy project…']);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    const link = row.getByRole('link', { name: 'WP35 ISPL' });
    await link.focus(); await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Open' })).toBeFocused();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Copy project' })).toBeVisible();              // the same dialog as the row's copy button
    await page.getByRole('dialog', { name: 'Copy project' }).getByRole('button', { name: 'Cancel' }).click();
  } finally { await page.context().close(); }
});

test('ISPL: Delete plate asks in the application dialog, naming the plate and what goes; Cancel keeps it', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  try {
    let native = 0; page.on('dialog', (d) => { native++; void d.dismiss(); });
    await page.goto(`/projects/${ispl}/editor`);
    await expect(page.locator('.jsg-plate')).toHaveCount(1, { timeout: 60_000 });
    await page.locator('.jsg-plate').first().locator('header input.ttl').click();
    await page.getByRole('button', { name: 'Delete plate' }).click();
    const dlg = page.getByRole('dialog', { name: 'Delete the plate?' });
    await expect(dlg).toContainText(/This removes plate I .*with its 1 view and \d+ parts?\./);
    await expect(dlg.getByTestId('app-dialog-cancel')).toBeFocused();                            // a destructive question starts on the safe answer
    await dlg.getByTestId('app-dialog-cancel').click();
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('.jsg-plate')).toHaveCount(1);
    await page.getByRole('button', { name: 'Delete plate' }).click();
    await page.getByRole('dialog', { name: 'Delete the plate?' }).getByTestId('app-dialog-confirm').click();
    await expect(page.locator('.jsg-plate')).toHaveCount(0);
    expect(native).toBe(0);
  } finally { await page.context().close(); }
});
