// The brand pack picker, in a project's Settings ("Brand pack" tab): choose which installed pack supplies the logo and company line of the page
// furniture, save, reload, and it is still chosen. Shows the logo and company of the chosen pack, says in which order the sources apply and how to install a pack,
// keeps the rest of project.json when it saves (the server replaces the whole project object), warns about a saved pack that is not installed, and is
// read-only for a viewer.
//
// A pack is a folder copied into the workspace's templates/brand folder; there is no upload. The suite's workspace is a throwaway folder in the system's
// temp directory (e2e/serve.mjs), so the spec copies the optional L&T pack from backend/templates-optional into it, exactly as an administrator would.

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminApi, assign, newPerson, type Person } from './support/session';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = 'lnt-xignal';
const PACK_NAME = 'L&T / Xignal S1000D';
const PACK_COMPANY = 'L&T Precision Engineering and Systems';
const shot = (p: Page, name: string) => p.screenshot({ path: `test-results/shots/${name}.png` });

test.describe.configure({ mode: 'serial' });

/** The suite's workspace: the newest agastya-v2-e2e-* folder (e2e/serve.mjs makes exactly one and removes it on exit). */
function workspaceBrandDir(): string {
  const tmp = os.tmpdir();
  const found = fs.readdirSync(tmp).filter((n) => n.startsWith('agastya-v2-e2e-')).map((n) => path.join(tmp, n, 'templates', 'brand'))
    .filter((d) => fs.existsSync(d)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!found.length) throw new Error(`No e2e workspace with templates/brand in ${tmp}: this spec installs a brand pack into the throwaway workspace that e2e/serve.mjs makes.`);
  return found[0];
}

let owner: Person; let viewer: Person;
let page: Page; let api: APIRequestContext;
let pid = '';
const settingsUrl = () => `/projects/${pid}/settings/brand`;
const project = async (): Promise<Record<string, unknown>> => (await (await api.get(`/api/projects/${pid}/settings`)).json()).project;
const logoLoaded = (p: Page) => p.getByTestId('brand-logo').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

test.beforeAll(async ({ browser, baseURL }) => {
  fs.cpSync(path.resolve(HERE, '..', '..', 'backend', 'templates-optional', 'brand', PACK), path.join(workspaceBrandDir(), PACK), { recursive: true });
  const admin = await adminApi(baseURL);
  owner = await newPerson(admin, browser, baseURL, 'brand', 'Brenda Brand');
  viewer = await newPerson(admin, browser, baseURL, 'brandview', 'Vera Viewer');
  page = owner.page; api = owner.api;
  pid = (await (await api.post('/api/projects', { data: { name: 'Branded manual', pipeline: 's1000dtofo' } })).json()).project.id as string;
  await assign(api, pid, viewer.username, 'viewer');
  await admin.dispose();
});
test.afterAll(async () => { await owner.page.context().close(); await viewer.page.context().close(); });

test('the Brand pack tab lists the installed packs and "Template default", and explains where the page furniture comes from', async () => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`/projects/${pid}/settings`);
  await page.getByRole('tab', { name: 'Brand pack' }).click();
  await expect(page).toHaveURL(/\/settings\/brand$/);
  const pick = page.getByTestId('brand-select');
  await expect(pick).toBeVisible();
  await expect(pick).toHaveValue('');                                                          // nothing chosen: the template's default
  await expect(pick.locator('option').first()).toContainText('Template default');
  await expect(pick.locator(`option[value="${PACK}"]`)).toHaveText(`${PACK_NAME} (${PACK})`);
  await expect(pick.locator('option[value="neutral"]')).toBeAttached();                        // the pack every workspace has
  await expect(page.getByTestId('brand-save')).toBeDisabled();                                 // nothing changed yet

  const help = page.getByTestId('brand-help');
  const steps = help.locator('ol > li');
  await expect(steps).toHaveCount(5);
  await expect(steps.nth(0)).toContainText('Settings that are filled in');
  await expect(steps.nth(1)).toContainText("publication's own comments");
  await expect(steps.nth(2)).toContainText('brand pack');
  await expect(steps.nth(3)).toContainText('derived');
  await expect(steps.nth(4)).toContainText('left out');
  await expect(help).toContainText('templates/brand');
  await expect(help).toContainText('Nothing can be installed from this screen');
  await shot(page, '60-brand-default');
  expect(errors).toEqual([]);
});

test('choosing a pack previews its logo and company; Save stores it and keeps the rest of the project settings', async () => {
  const before = await project();
  expect(before.brandPack).toBeUndefined();
  await page.goto(settingsUrl());
  await page.getByTestId('brand-select').selectOption(PACK);
  await expect(page.getByTestId('brand-company')).toHaveText(PACK_COMPANY);
  await expect(page.getByTestId('brand-logo')).toBeVisible();
  expect(await logoLoaded(page), 'the logo is fetched from /api/brand-packs/<id>/logo with the session').toBe(true);
  await expect(page.getByText('Not saved yet.')).toBeVisible();
  await shot(page, '61-brand-picked');
  await page.getByTestId('brand-save').click();
  await expect(page.locator('.v2-toast', { hasText: 'saved' }).first()).toBeVisible();
  await expect(page.getByTestId('brand-save')).toBeDisabled();                                 // saved: nothing left to save

  const after = await project();
  expect(after.brandPack).toBe(PACK);
  const { brandPack, ...rest } = after; void brandPack;
  expect(rest, 'every other field of project.json is as it was').toEqual(before);
});

test('after a reload the saved pack is still chosen, and so is its preview', async () => {
  await page.reload();
  await expect(page.getByTestId('brand-select')).toHaveValue(PACK);
  await expect(page.getByTestId('brand-company')).toHaveText(PACK_COMPANY);
  expect(await logoLoaded(page)).toBe(true);
  await expect(page.getByTestId('brand-save')).toBeDisabled();
  // another page of the same Settings does not undo it
  await page.getByRole('tab', { name: 'Publishing' }).click();
  await expect(page.getByTestId('settings-save').or(page.getByRole('button', { name: /^Save/ })).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Brand pack' }).click();
  await expect(page.getByTestId('brand-select')).toHaveValue(PACK);
});

test('choosing "Template default" again removes the choice from the project', async () => {
  await page.getByTestId('brand-select').selectOption('');
  await expect(page.getByTestId('brand-save')).toBeEnabled();
  await page.getByTestId('brand-save').click();
  await expect(page.locator('.v2-toast', { hasText: 'template default' }).first()).toBeVisible();
  expect('brandPack' in (await project())).toBe(false);
  await page.reload();
  await expect(page.getByTestId('brand-select')).toHaveValue('');
});

test('a saved pack that is not installed is flagged, and can still be replaced', async () => {
  const cur = await project();
  expect((await api.put(`/api/projects/${pid}/settings`, { data: { project: { ...cur, brandPack: 'ghost-pack' } } })).ok()).toBeTruthy();
  await page.goto(settingsUrl());
  await expect(page.getByTestId('brand-missing')).toContainText('ghost-pack');
  await expect(page.getByTestId('brand-select')).toHaveValue('ghost-pack');
  await expect(page.getByTestId('brand-select').locator('option[value="ghost-pack"]')).toContainText('not installed');
  await shot(page, '62-brand-missing');
  await page.getByTestId('brand-select').selectOption(PACK);
  await page.getByTestId('brand-save').click();
  await expect(page.getByTestId('brand-missing')).toHaveCount(0);
  expect((await project()).brandPack).toBe(PACK);
});

test('a viewer sees the choice but cannot change it', async () => {
  const p = viewer.page;
  await p.goto(settingsUrl());
  await expect(p.getByTestId('brand-select')).toHaveValue(PACK);
  await expect(p.getByTestId('brand-select')).toBeDisabled();
  await expect(p.getByTestId('brand-save')).toHaveCount(0);
  await expect(p.getByTestId('brand-settings')).toContainText('only an editor, manager or owner can change the brand pack');
  expect(await logoLoaded(p)).toBe(true);
  const refused = await viewer.api.put(`/api/projects/${pid}/settings`, { data: { project: { brandPack: 'neutral' } } });
  expect(refused.status()).toBe(403);
  expect((await project()).brandPack).toBe(PACK);
});
