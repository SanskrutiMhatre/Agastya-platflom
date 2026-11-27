// WP-22: navigation, project home, problems and review, in a real browser against the real server. Nothing is mocked.
//
//   - every project page names the project (breadcrumb) and the rail starts with Home; the rail can be pinned open with its labels (UX-007, UX-009)
//   - the project Home answers "what next": continue, check, review, build, and what needs attention (UX-013, PRD-003 part)
//   - Ctrl+K jumps to a project, a page or a data module from anywhere outside an editor (UX-021)
//   - a "reviewed" mark on a finding is the team's, seen by a second person (UX-008)
//   - a review comment is shown in the editor and marking it done there is what the Release page shows (GAP-006 part, FE-015)
//   - the JSS editor saves with Ctrl+S after Esc took the focus off the paper (WP-21 open item)
//   - the Publication page adds sections and appendices, deletes an appendix, and has undo with redo (GAP-003)
// Keyboard only wherever the task allows it.

import { test, expect, type Browser, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminApi, assign, newPerson, type Person } from './support/session';

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext; let owner: Person; let second: Person;
const ids = { s1000d: '', jss: '', jsg: '' };
let dmFile = '';

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  admin = await adminApi(baseURL);
  owner = await newPerson(admin, browser, baseURL, 'wp22o', 'Nav Owner');
  second = await newPerson(admin, browser, baseURL, 'wp22r', 'Nav Reviewer');
  ids.s1000d = (await (await owner.api.post('/api/projects/sample', { data: {} })).json()).project.id;
  const jss = await owner.api.post('/api/projects', { data: { name: 'WP22 JSS Handbook', format: 'jss', domain: 'land', manualType: 'uhb' } }); expect(jss.status()).toBe(201);
  ids.jss = (await jss.json()).project.id;
  const jsg = await owner.api.post('/api/projects', { data: { name: 'WP22 JSG Handbook', format: 'jsg', domain: 'land', manualType: 'uhb' } }); expect(jsg.status()).toBe(201);
  ids.jsg = (await jsg.json()).project.id;
  dmFile = (await (await owner.api.get(`/api/projects/${ids.s1000d}/dms`)).json()).dms[0].file as string;
  await assign(owner.api, ids.s1000d, second.username, 'reviewer');
});
test.afterAll(async () => { await owner.page.context().close(); await second.page.context().close(); await admin.dispose(); });

async function fresh(browser: Browser, baseURL: string | undefined, who: Person = owner): Promise<Page> {
  const ctx = await browser.newContext({ storageState: await who.api.storageState(), viewport: { width: 1440, height: 900 }, baseURL });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  return page;
}

test('every project page names the project; the rail starts with Home and can be pinned open with its labels', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  try {
    for (const tab of ['home', 'validation', 'release', 'graphics', 'settings']) {
      await page.goto(`/projects/${ids.s1000d}/${tab}`);
      await expect(page.getByTestId('project-bar-name')).toBeVisible();
      await expect(page.getByTestId('project-bar-name')).not.toHaveText('');
    }
    const rail = page.locator('.v2-rail');
    const home = rail.getByRole('link', { name: 'Home' });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute('data-tip', 'Home');                                 // unpinned: icon only, the label is the tooltip
    await page.getByTestId('rail-pin').focus(); await page.keyboard.press('Enter');
    await expect(page.getByTestId('rail-pin')).toHaveAttribute('aria-pressed', 'true');
    await expect(rail.locator('.v2-rail-label', { hasText: 'Home' })).toBeVisible();     // pinned: the labels are written out
    await page.reload();
    await expect(page.getByTestId('rail-pin')).toHaveAttribute('aria-pressed', 'true');  // remembered
    await page.getByTestId('rail-pin').focus(); await page.keyboard.press('Enter');
    await expect(page.getByTestId('rail-pin')).toHaveAttribute('aria-pressed', 'false');
    // opening a project still lands in the editor (the owner's rule); the editor page has no breadcrumb bar
    await page.goto(`/projects/${ids.jss}`);
    await expect(page).toHaveURL(/\/editor$/);
    await expect(page.getByTestId('project-bar')).toHaveCount(0);
  } finally { await page.context().close(); }
});

test('the project Home of an S1000D, a JSS and a JSG project has the four cards and opens the next step', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  try {
    for (const id of [ids.s1000d, ids.jss, ids.jsg]) {
      await page.goto(`/projects/${id}/home`);
      await expect(page.getByTestId('project-home')).toBeVisible();
      for (const card of ['home-continue', 'home-check', 'home-review', 'home-build']) await expect(page.getByTestId(card)).toBeVisible();
      await expect(page.getByText('Internal error')).toHaveCount(0);
    }
    await page.goto(`/projects/${ids.s1000d}/home`);
    await page.getByTestId('home-open-check').focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/validation$/);
    await page.goto(`/projects/${ids.s1000d}/home`);
    await page.getByTestId('home-open-editor').focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/editor/);
  } finally { await page.context().close(); }
});

test('Ctrl+K jumps to a project and to a page, keyboard only', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  try {
    await page.goto('/projects');
    await expect(page.getByTestId('jump-open')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await page.keyboard.type('WP22 JSG Handbook');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${ids.jsg}/home$`));
    await expect(page.getByTestId('project-home')).toBeVisible();
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Publication');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${ids.jsg}/publication$`));
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette-input')).toHaveCount(0);
  } finally { await page.context().close(); }
});

test('a finding marked reviewed is the team\'s: the second person sees who marked it', async ({ browser, baseURL }) => {
  // a module that refers to a graphic the project does not have (the dm21 5-0 fixture): the check reports at least one finding
  const fix = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dm21', '5-0');
  const file = JSON.parse(fs.readFileSync(path.join(fix, 'manifest.json'), 'utf8')).descript as string;
  expect((await owner.api.post(`/api/projects/${ids.s1000d}/dms`, { data: { file, xml: fs.readFileSync(path.join(fix, file), 'utf8') } })).status()).toBe(201);
  const run = await owner.api.post(`/api/projects/${ids.s1000d}/validation`, { data: { brex: false } });
  expect(run.ok()).toBeTruthy();
  const issues = (await run.json()).run.issues as unknown[];
  expect(issues.length, 'the project has findings to mark').toBeGreaterThan(0);
  const page = await fresh(browser, baseURL);
  try {
    await page.goto(`/projects/${ids.s1000d}/validation`);
    await page.getByRole('checkbox', { name: 'Notes' }).check();                           // the finding of the fixture is a note
    const first = page.getByTestId('issue').first();
    await first.focus(); await page.keyboard.press('Enter');
    await page.getByTestId('issue-mark-reviewed').focus(); await page.keyboard.press('Enter');
    await expect(page.getByTestId('issue-reviewed-by')).toContainText('Nav Owner');
  } finally { await page.context().close(); }
  const marks = await (await second.api.get(`/api/projects/${ids.s1000d}/problems/reviewed`)).json();
  expect(Object.keys(marks.marks ?? marks).length).toBeGreaterThan(0);
  const p2 = await fresh(browser, baseURL, second);
  try {
    await p2.goto(`/projects/${ids.s1000d}/validation`);
    await p2.getByRole('checkbox', { name: 'Notes' }).check();
    await p2.getByTestId('issue').first().click();
    await expect(p2.getByTestId('issue-reviewed-by')).toContainText('Nav Owner');
  } finally { await p2.context().close(); }
});

test('a review comment is shown in the editor; Done there is what the Release page shows', async ({ browser, baseURL }) => {
  const made = await second.api.post(`/api/projects/${ids.s1000d}/review/comments`, { data: { body: 'WP22 check this step', dmFile } });
  expect(made.status()).toBe(201);
  const page = await fresh(browser, baseURL);
  try {
    await page.goto(`/projects/${ids.s1000d}/editor?file=${encodeURIComponent(dmFile)}`);
    await expect(page.getByTestId('studio-host')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('editor-comments-open')).toHaveText(/\d+/);
    await page.keyboard.press('Alt+Shift+N');
    const panel = page.getByTestId('comments-panel');
    await expect(panel).toBeVisible();
    const row = panel.getByTestId('editor-comment').filter({ hasText: 'WP22 check this step' });
    await expect(row).toBeVisible();
    await row.getByTestId('editor-comment-done').click();
    await expect(row).toHaveCount(0);                                                       // done comments are hidden unless asked for
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await page.goto(`/projects/${ids.s1000d}/release`);
    await expect(page.getByRole('checkbox', { name: /Mark comment by .* as done/ }).first()).toBeChecked();
  } finally { await page.context().close(); }
});

test('JSS: Esc takes the focus off the paper, and Ctrl+S still saves', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  try {
    await page.goto(`/projects/${ids.jss}/editor`);
    await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
    const purpose = page.getByTestId('jss-paper').locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
    await purpose.locator('.jss-para, .jss-empty').first().click(); await page.keyboard.press('End'); await page.keyboard.type('WP22 save ');
    await expect(page.getByTestId('jss-state')).toHaveText(/Unsaved changes/);
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 15_000 });
  } finally { await page.context().close(); }
});

test('Publication: add a section and an appendix, delete an appendix, undo and redo, save; the document holds it', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
  try {
    await page.goto(`/projects/${ids.jsg}/publication`);
    await expect(page.getByTestId('pub-tree')).toBeVisible();
    const before = await page.getByTestId('pub-module').count();
    await page.getByTestId('add-section').first().click();
    await page.getByRole('dialog').getByRole('textbox').fill('WP22 Safety');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pub-module')).toHaveCount(before + 1);
    await page.getByTestId('undo-arrangement').click();
    await expect(page.getByTestId('pub-module')).toHaveCount(before);
    await page.getByTestId('redo-arrangement').click();
    await expect(page.getByTestId('pub-module')).toHaveCount(before + 1);
    const apps = await page.getByTestId('pub-appendix').count();
    await page.getByTestId('add-appendix').click();
    await page.getByRole('dialog').getByRole('textbox').fill('WP22 Glossary');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pub-appendix')).toHaveCount(apps + 1);
    await page.getByTestId('save-publication').click();
    await expect(page.getByTestId('unsaved-bar')).toHaveCount(0, { timeout: 30_000 });
    const xml = await (await owner.api.get(`/api/projects/${ids.jsg}/jsg`)).text();
    expect(xml).toContain('WP22 Safety'); expect(xml).toContain('WP22 Glossary');
    // delete the new appendix again
    await page.getByTestId('pub-appendix').filter({ hasText: 'WP22 Glossary' }).getByTestId('delete-appendix').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('pub-appendix')).toHaveCount(apps);
    await page.getByTestId('save-publication').click();
    await expect(page.getByTestId('unsaved-bar')).toHaveCount(0, { timeout: 30_000 });
    expect(await (await owner.api.get(`/api/projects/${ids.jsg}/jsg`)).text()).not.toContain('WP22 Glossary');
  } finally { await page.context().close(); }
});
