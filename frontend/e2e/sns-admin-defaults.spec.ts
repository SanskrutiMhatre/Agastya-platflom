// The organisation's default SNS, in Administrator > Reference data > "SNS defaults".
//   an administrator adds, edits and deletes rows with the same editor a project uses (code rules, cascade confirmation counting the rows below)
//   a person who is not an administrator has no Administrator area at all, can still READ the defaults (the API), and the server refuses their writes
//
// Self-contained. The file name sorts after platform.spec.ts on purpose: that spec creates the administrator through the first-run screen, and an
// earlier spec that made the administrator through the API would take that screen away.

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { adminApi, newPerson, type Person } from './support/session';

const shot = (p: Page, name: string) => p.screenshot({ path: `test-results/shots/${name}.png` });
const toast = (p: Page, text: string | RegExp) => p.locator('.v2-toast', { hasText: text }).first();
const row = (p: Page, code: string, diff = '') => p.locator(`[data-testid="sns-defaults-row"][data-code="${code}"][data-diff="${diff}"]`);
const fill = async (p: Page, f: Record<string, string>) => { for (const [k, v] of Object.entries(f)) await p.getByTestId(`sns-f-${k}`).fill(v); };

test.describe.configure({ mode: 'serial' });

let adminApiCtx: APIRequestContext; let admin: Page; let author: Person;
const defaults = async (who: APIRequestContext = adminApiCtx): Promise<Array<Record<string, string>>> => (await (await who.get('/api/sns/defaults')).json()).rows;
const has = async (code: string, who?: APIRequestContext) => (await defaults(who)).find((r) => [r.systemCode, `${r.subSystemCode}${r.subSubSystemCode}`, r.assyCode].filter(Boolean).join('-') === code);

test.beforeAll(async ({ browser, baseURL }) => {
  adminApiCtx = await adminApi(baseURL);
  author = await newPerson(adminApiCtx, browser, baseURL, 'snsdef', 'Dana Defaults');
  // the browser shares the API context's session: a second sign-in as the administrator would end the first (one session at a time)
  const ctx = await browser.newContext({ storageState: await adminApiCtx.storageState(), viewport: { width: 1440, height: 900 }, baseURL });
  admin = await ctx.newPage();
  admin.on('pageerror', (e) => { throw new Error(`page error (administrator): ${e.message}`); });
});
test.afterAll(async () => { await admin.context().close(); await author.page.context().close(); await adminApiCtx.dispose(); });

test('Administrator lists "SNS defaults" under S1000D, next to the Numbering (SNS) presets', async () => {
  await admin.goto('/administrator');
  const nav = admin.getByRole('navigation', { name: 'Administrator sections' });
  await expect(nav.getByRole('link', { name: 'Numbering (SNS)' })).toBeVisible();           // the presets; the older two-column table is retired
  await expect(nav.getByRole('link', { name: 'SNS', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: 'SNS defaults' }).click();
  await expect(admin).toHaveURL(/\/administrator\/sns-defaults$/);
  const page = admin.getByTestId('sns-defaults-admin');
  await expect(page).toBeVisible();
  await expect(page).toContainText('A project can import these rows');
  await expect(page).toContainText('older two-column SNS table was retired');
  await expect(admin.getByTestId('sns-defaults-add')).toBeVisible();
  await expect(admin.getByTestId('sns-defaults-rules')).toContainText('2 or 3 letters or digits');
  await shot(admin, '80-sns-defaults');
});

test('an administrator adds rows (bad codes are refused with the rule), nests them and edits a title', async () => {
  await admin.getByTestId('sns-defaults-add').click();
  await fill(admin, { systemCode: '8' });
  await expect(admin.getByTestId('sns-form')).toContainText('System code "8" is not valid');
  await expect(admin.getByTestId('sns-save')).toBeDisabled();
  await fill(admin, { systemCode: '81', title: 'Test power plant' });
  await admin.getByTestId('sns-save').click();
  await expect(toast(admin, 'Added 81')).toBeVisible();
  await expect(row(admin, '81')).toContainText('Test power plant');

  await row(admin, '81').getByTestId('sns-defaults-add-child').click();
  await expect(admin.getByTestId('sns-f-systemCode')).toHaveValue('81');
  await fill(admin, { subSystemCode: '1', title: 'Test compressor' });
  await admin.getByTestId('sns-save').click();
  await expect(row(admin, '81-1')).toContainText('Test compressor');
  expect(await has('81-1')).toBeTruthy();

  await row(admin, '81').getByTestId('sns-defaults-edit').click();
  await fill(admin, { title: 'Test powerplant' });
  await admin.getByTestId('sns-save').click();
  await expect(toast(admin, 'Saved 81')).toBeVisible();
  expect((await has('81'))?.title).toBe('Test powerplant');

  // a duplicate is refused and says why
  await admin.getByTestId('sns-defaults-add').click();
  await fill(admin, { systemCode: '81', title: 'Again' });
  await admin.getByTestId('sns-save').click();
  await expect(admin.getByTestId('sns-form-error')).toContainText('81 is already defined as "Test powerplant"');
  await admin.getByRole('button', { name: 'Cancel' }).click();
  await shot(admin, '81-sns-defaults-rows');
});

test('a non-administrator has no Administrator area and cannot write the defaults; reading is open to everyone signed in', async () => {
  const p = author.page;
  await p.goto('/administrator/sns-defaults');
  await expect(p).toHaveURL(/\/overview$/);                                                  // the route does not exist for them
  await expect(p.getByTestId('sns-defaults-admin')).toHaveCount(0);
  await expect(p.getByRole('link', { name: 'SNS defaults' })).toHaveCount(0);

  expect((await has('81-1', author.api))?.title).toBe('Test compressor');                    // they can read
  const id = (await has('81'))!.id;
  expect((await author.api.post('/api/sns/defaults', { data: { systemCode: '82', title: 'x' } })).status()).toBe(403);
  expect((await author.api.put(`/api/sns/defaults/${id}`, { data: { title: 'x' } })).status()).toBe(403);
  expect((await author.api.delete(`/api/sns/defaults/${id}`)).status()).toBe(403);
  expect((await has('81'))?.title).toBe('Test powerplant');
});

test('changing a code with rows below, and deleting it, ask first and say how many rows are affected', async () => {
  await row(admin, '81').getByTestId('sns-defaults-edit').click();
  await fill(admin, { systemCode: '83' });
  await admin.getByTestId('sns-save').click();
  await expect(admin.getByTestId('sns-defaults-cascade-count')).toHaveText('1 row');
  await admin.getByTestId('sns-defaults-cascade-confirm').click();
  await expect(row(admin, '83')).toBeVisible();
  await expect(row(admin, '83-1')).toBeVisible();
  expect(await has('81')).toBeUndefined();
  expect((await has('83-1'))?.title).toBe('Test compressor');

  await row(admin, '83').getByTestId('sns-defaults-delete').click();
  await expect(admin.getByTestId('sns-defaults-delete-count')).toHaveText('1 row');
  await expect(admin.getByTestId('sns-defaults-delete-confirm')).toHaveText('Delete 2 rows');
  await admin.getByTestId('sns-defaults-delete-confirm').click();
  await expect(toast(admin, 'Deleted 83 and 1 row below it')).toBeVisible();
  await expect(row(admin, '83')).toHaveCount(0);
  expect(await has('83')).toBeUndefined();
  expect(await has('83-1')).toBeUndefined();
});

// FIXME: needs rows in the Administrator's older SNS table, which is retired (the SNS presets replaced it; there is no API to write to it any more).
// The merge itself is covered by backend/test/sns-polish.test.js, which writes such rows into an upgraded database directly. Re-enable this when the
// merge panel is either removed or given a way to be exercised from the browser.
test.fixme('the older SNS table can be merged into the defaults: preview writes nothing, a differing title is listed and kept, apply adds the rest', async () => {
  // two codes typed into the older table after the defaults were seeded: one new, one that is already a default with another title (capitals only)
  const seen = (await defaults()).find((r) => r.systemCode === '84');
  if (!seen) expect((await adminApiCtx.post('/api/sns/defaults', { data: { systemCode: '84', title: 'Cabin lighting' } })).status()).toBe(201);
  expect((await adminApiCtx.post('/api/admin/config/sns', { data: { code: '85', name: 'Galley equipment' } })).status()).toBe(201);
  expect((await adminApiCtx.post('/api/admin/config/sns', { data: { code: '84', name: 'CABIN LIGHTING' } })).status()).toBe(201);
  const before = (await defaults()).length;

  await admin.goto('/administrator/sns-defaults');
  const panel = admin.getByTestId('sns-defaults-legacy');
  await expect(panel).toBeVisible();
  await expect(admin.getByTestId('sns-defaults-legacy-apply')).toBeDisabled();             // nothing to apply before a preview
  await admin.getByTestId('sns-defaults-legacy-preview').click();
  await expect(admin.getByTestId('sns-defaults-legacy-result')).toBeVisible();
  await expect(admin.getByTestId('sns-defaults-legacy-add')).toContainText('Galley equipment');
  await expect(admin.getByTestId('sns-defaults-legacy-differs')).toContainText('capitals only');
  await expect(admin.getByTestId('sns-defaults-legacy-differs')).toContainText('In the defaults: “Cabin lighting”');
  await shot(admin, '82-sns-defaults-merge-legacy');
  expect((await defaults()).length, 'a preview writes nothing').toBe(before);

  await admin.getByTestId('sns-defaults-legacy-apply').click();
  await expect(admin.getByTestId('sns-defaults-legacy-done')).toContainText('Added 1 row');
  expect((await has('85'))?.title).toBe('Galley equipment');
  expect((await has('84'))?.title, 'the title in the defaults was not replaced').toBe('Cabin lighting');
  await expect(row(admin, '85')).toContainText('Galley equipment');

  // a non-administrator does not get the control, and the server refuses them
  await author.page.goto('/administrator/sns-defaults');
  await expect(author.page.getByTestId('sns-defaults-legacy')).toHaveCount(0);
  expect((await author.api.post('/api/sns/defaults/merge-legacy', { data: { apply: true } })).status()).toBe(403);
});
