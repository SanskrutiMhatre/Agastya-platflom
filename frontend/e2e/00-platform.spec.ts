// The whole product, in a real browser, against a real server:
// first-run setup -> main dashboard -> workspace -> project dashboard -> editor
// (Studio, saving to the server, quick preview, PDF) -> explore -> publication ->
// validation review -> release & watermark -> settings.
//
// The file name sorts first on purpose: the first-run test needs an empty workspace, and Playwright runs files in name order with one
// worker. Every other spec signs in as the administrator this one creates, or creates it when run alone.
//
// Screenshots of each screen are written to test-results/shots for review.

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');
/** The New project wizard: project -> S1000D identity -> codes and structure -> review -> create. */
async function finishWizard(p: Page, mic = 'TESTM'): Promise<void> {
  await p.getByRole('button', { name: 'Next' }).click();
  await p.getByTestId('wiz-mic').fill(mic);
  await p.getByLabel('Enterprise code').first().fill('TST01');
  await p.getByLabel('Enterprise name').first().fill('Test Co');
  await p.getByRole('button', { name: 'Next' }).click();
  await p.getByRole('button', { name: 'Next' }).click();
  await expect(p.getByTestId('wiz-review')).toBeVisible();
  await p.getByRole('button', { name: 'Create project' }).click();
}

const DESC = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const PROC = 'DMC-S1KSTUDIO-A-29-10-00-00A-520A-A_001-00_EN-US.XML';
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';
const PW = 'Correct-Horse-9!';
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/shots/${name}.png` });

test.describe.configure({ mode: 'serial' });

let page: Page;          // the Author (Asha): she does the authoring, because administrators do not create projects
let adminPage: Page;     // the administrator
let projectUrl = '';
let sampleUrl = '';
let asha = '';

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  adminPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  adminPage.on('pageerror', (e) => { throw new Error(`admin page error: ${e.message}`); });
});
test.afterAll(async () => { await page.context().close(); await adminPage.context().close(); });

test('first run: set up the administrator and land on the platform overview', async () => {
  const page = adminPage;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Set up Agastya' })).toBeVisible();
  await shot(page, '01-setup');
  await page.getByLabel('Full name').fill('Site Admin');
  await page.getByLabel('Username', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByLabel('Repeat password').fill(PW);
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByRole('heading', { name: /Welcome back, Site/ })).toBeVisible();
  await expect(page.getByText('Platform overview')).toBeVisible();
  await shot(page, '02-admin-overview');
});

test('the administrator oversees but does not create projects: its navigation has no Workspace, Projects has no New project', async () => {
  const nav = adminPage.getByRole('navigation', { name: 'Main navigation' });
  for (const n of ['Overview', 'Projects', 'Graphics', 'CIR', 'Backup', 'Activity', 'Administrator', 'Settings']) await expect(nav.getByRole('link', { name: n, exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Workspace' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Workspace' })).toHaveCount(0);
  await adminPage.getByRole('link', { name: 'Projects' }).click();
  await expect(adminPage.getByRole('button', { name: /New project/ })).toHaveCount(0);
  await expect(adminPage.getByTestId('backup')).toBeVisible();
});

test('the administrator creates an Author: the username is suggested from the name, the temporary password is username-<random>', async () => {
  const page = adminPage;
  await page.goto('/settings/users');
  await page.getByRole('button', { name: 'New user' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Asha Iyer');
  await expect(page.getByLabel('Username')).toHaveValue('asha');
  await page.getByLabel('Role', { exact: true }).selectOption('author');
  await page.getByRole('button', { name: 'Create account' }).click();
  asha = await page.getByLabel('Temporary password').inputValue();
  expect(asha).toMatch(/^asha-[a-hjkmnp-z2-9]{8}$/);
  await page.getByRole('button', { name: 'Done' }).click();
  // the next person with the same first name gets firstname.lastinitial
  await page.getByRole('button', { name: 'New user' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Asha Kumar');
  await expect(page.getByLabel('Username')).toHaveValue('asha.k');
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('the Author signs in with it, chooses a password and lands on her own dashboard', async () => {
  await page.goto('/');
  await page.getByLabel('Username').fill('asha');
  await page.getByLabel('Password').fill(asha);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('New password').fill(PW);
  await page.getByLabel('Repeat password').fill(PW);
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: /Welcome back, Asha/ })).toBeVisible();
  await shot(page, '02-overview-empty');
});

test('main dashboard has Overview, Workspace, Projects, Graphics, CIR, Backup and Settings; Notifications is a bell beside an icon-only account menu; the theme is an icon-only switch', async () => {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const n of ['Overview', 'Workspace', 'Projects', 'Graphics', 'CIR', 'Backup', 'Settings']) await expect(nav.getByRole('link', { name: n, exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Administrator' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Notifications' })).toHaveCount(0);            // the bell in the top bar opens it
  await expect(nav.getByRole('link', { name: 'Activity' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Auto' })).toHaveCount(0);
  await expect(page.getByTestId('bell')).toBeVisible();
  await expect(page.getByTestId('account-menu')).toHaveText('');                              // an icon, not the person's name
  await expect(page.locator('header.v2-top')).not.toContainText('Asha');
  await page.getByTestId('account-menu').click();
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByRole('menu')).not.toContainText(/asha/i);                            // neither name nor username
  await page.getByTestId('account-menu').click();
  // UI redesign step 1 (owner-approved mockups 2026-11-28): the theme control is the mockups' three-state switch (Follow system, Light,
  // Dark), icons only, in the top bar; it replaced the single toggle button
  const sw = page.getByTestId('theme-toggle');
  await expect(sw.getByRole('button')).toHaveCount(3);
  await expect(sw).toHaveText('');                                                             // icons, no words
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  const other = before === 'dark' ? 'light' : 'dark';
  await page.getByTestId(`theme-${other}`).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(other);
  await expect(page.getByTestId(`theme-${other}`)).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId(`theme-${before}`).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(before);
});

test('workspace: create a folder and a project inside it', async () => {
  await page.getByRole('link', { name: 'Workspace' }).click();
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByLabel('Folder name').fill('Naval Systems');
  await page.getByRole('button', { name: 'Create folder' }).click();
  await expect(page.getByRole('region', { name: 'Folder Naval Systems' })).toBeVisible();

  await page.getByRole('region', { name: 'Folder Naval Systems' }).getByRole('button', { name: /Project/ }).click();
  await page.getByTestId('wiz-start-create').click();              // the wizard now opens on "Create a new project" / "Import a package"
  await page.getByLabel('Project name').fill('Hydraulic Pump Manual');
  await page.getByTestId('wiz-format-s1000d').click();             // the manual type (S1000D) decides the engine; there is no engine picker
  await finishWizard(page, 'HYDRP');
  await expect(page.getByTestId('project-card').filter({ hasText: 'Hydraulic Pump Manual' })).toBeVisible();
  await shot(page, '03-workspace');
});

test('projects list shows it; opening it lands in the Editor, with an icon-only rail (no overview page)', async () => {
  await page.getByRole('link', { name: 'Projects' }).click();
  const row = page.getByTestId('project-row').filter({ hasText: 'Hydraulic Pump Manual' });
  await expect(row).toBeVisible();
  await shot(page, '04-projects');
  await row.click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/editor$/);
  projectUrl = page.url().replace(/\/editor$/, '');

  const rail = page.getByRole('complementary', { name: 'Project navigation' });
  const names = ['Editor', 'Explore', 'Publication', 'Validation', 'Release', 'Settings'];
  for (const n of names) {
    const link = rail.getByRole('link', { name: n, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('data-tip', n);            // the name appears on hover
    await expect(link).not.toContainText(n);                      // ...and only the icon is displayed
  }
  await expect(rail.getByRole('link', { name: /dashboard|overview/i })).toHaveCount(0);
  expect((await rail.boundingBox())!.width).toBeLessThanOrEqual(64);
  await rail.getByRole('link', { name: 'Explore', exact: true }).hover();
  await shot(page, '05-rail-hover');
});

test('editor: import data modules, open one in the Studio, edit it and save to the server', async () => {
  await expect(page.getByTestId('studio-host')).toBeVisible();
  // Release, watermark and publication settings are not part of the editor.
  await expect(page.getByRole('button', { name: /watermark|release/i })).toHaveCount(0);

  // (the sample modules are S1KSTUDIO and mix Issue 5.0 and 4.2, so they do not fit a configured project: import them without validation)
  await page.getByTestId('import-raw-input').setInputFiles([path.join(SAMPLES, DESC), path.join(SAMPLES, PROC), path.join(SAMPLES, ICN)]);
  await expect(page.getByTestId('dm-list').locator(`[data-file="${DESC}"]`)).toBeVisible();
  await expect(page.locator('.v2-toast', { hasText: /graphic/ }).first()).toBeVisible();
  await page.getByTestId('dm-list').locator(`[data-file="${DESC}"]`).click();
  await expect(page.locator('.doc-tabs [role=tab]').first()).toBeVisible();
  await expect(page.locator('.design-page')).toContainText('Hydraulic pump');
  await shot(page, '06-editor');

  // Edit through the XML view (a real CodeMirror edit) and save with the real shortcut.
  await page.locator('.vs-btn', { hasText: 'XML' }).click();
  await page.evaluate(() => {
    const s = (window as any).studio; const v = s.active.xml.view;
    const i = v.state.doc.toString().indexOf('Description of how it is made');
    v.dispatch({ changes: { from: i, to: i, insert: 'EDITED ' } });
  });
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Saved' }).first()).toBeVisible();

  const res = await page.request.get(`/api/projects/${projectUrl.split('/').pop()}/dms/${DESC}`);
  expect((await res.json()).xml).toContain('EDITED Description of how it is made');
});

test('editor: Quick preview and Generate live together in the panel on the right', async () => {
  // WP-21: a new session opens in Write (the editor alone, Quick preview and Generate in the header); Split brings the PDF panel back
  await expect(page.getByTestId('chrome-preview-slot').getByTestId('quick-preview-btn')).toBeVisible();
  await page.getByRole('group', { name: 'Editor layout' }).getByRole('button', { name: 'Split' }).click();
  const panel = page.getByRole('toolbar', { name: 'PDF controls' });
  await expect(panel.getByRole('button', { name: 'Quick preview', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Generate', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Quick preview' })).toHaveCount(0);   // no longer a card on the left

  // Quick preview is always rendered by the server (Apache FOP): exactly what the final PDF prints. There is no engine switch any more.
  await expect(page.getByRole('group', { name: 'Quick preview engine' })).toHaveCount(0);
  await page.getByTestId('quick-preview-btn').click();
  await expect(page.getByTestId('pdf-pane').locator('canvas').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('pdf-shown')).toContainText('Quick preview');
  await shot(page, '07-editor-quickpreview');
  await expect(page.locator('.v2-log', { hasText: /Rendered by the server/ })).toBeVisible({ timeout: 90_000 });
  await shot(page, '08-editor-serverpdf');
});

test('editor: the left panel can be hidden and shown again, and the editor takes the room', async () => {
  const side = page.getByRole('complementary', { name: 'Data modules' });
  await expect(side).toBeVisible();
  const before = (await page.getByTestId('studio-host').boundingBox())!.width;
  await page.getByTestId('toggle-side').click();
  await expect(side).toHaveCount(0);
  await expect.poll(async () => (await page.getByTestId('studio-host').boundingBox())!.width).toBeGreaterThan(before);
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Data modules' })).toHaveCount(0);   // the choice is remembered
  await page.getByTestId('toggle-side').click();
  await expect(page.getByRole('complementary', { name: 'Data modules' })).toBeVisible();
  await page.getByTestId('collapse-side').click();
  await expect(page.getByRole('complementary', { name: 'Data modules' })).toHaveCount(0);
  await page.getByTestId('toggle-side').click();
  await expect(page.getByTestId('dm-list').locator(`[data-file="${DESC}"]`)).toBeVisible();
});

test('editor: Quick preview and Generate each open in a window of their own and stay in sync with the editor', async () => {
  await page.getByTestId('dm-list').locator(`[data-file="${DESC}"]`).click();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('popout-quick').click()]);
  await expect(popup).toHaveURL(/\/preview\/[^/]+\/quick$/);
  await expect(page.getByTestId('popped-note')).toContainText('Quick preview is open in its own window');
  await expect(popup.getByText(/Keep the editor open/)).toHaveCount(0);        // the editor answered

  // the editor runs the preview (always the server's rendering now) and the result appears in the window, not in the pane
  await page.getByTestId('quick-preview-btn').click();
  await expect(popup.getByTestId('popout-pdf').locator('canvas').first()).toBeVisible({ timeout: 90_000 });
  await shot(popup, '33-popout-quick');

  // pressing the window's own button asks the editor to run it again
  await popup.getByTestId('popout-run').click();
  await expect(popup.getByText(/Quick preview/).first()).toBeVisible();

  const [gen] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('popout-build').click()]);
  await expect(gen).toHaveURL(/\/preview\/[^/]+\/build$/);
  await expect(page.getByTestId('popped-note')).toContainText('Quick preview and Generate are open in their own windows');
  await gen.close();
  await expect(page.getByTestId('popped-note')).toContainText('Quick preview is open in its own window');
  await popup.close();
  await expect(page.getByTestId('popped-note')).toHaveCount(0);
});

test('publication: add a chapter, place data modules, save; explore shows the hierarchy', async () => {
  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Publication', exact: true }).click();
  await expect(page.getByTestId('add-chapter')).toBeVisible();
  await expect(page.getByTestId('pub-pool')).toBeVisible();
  await page.getByTestId('add-chapter').click();
  await page.getByLabel('Chapter title').fill('Description');
  await page.getByRole('button', { name: 'Add chapter', exact: true }).last().click();
  const chapter = page.getByRole('region', { name: 'Chapter Description' });
  await expect(chapter).toBeVisible();
  await expect(page.getByTestId('unsaved-bar')).toBeVisible();

  await chapter.locator('header').click();                                   // select it: modules are added here
  await page.getByTestId('pool-item').first().getByRole('button', { name: /^Add/ }).click();
  await expect(chapter.getByTestId('pub-module')).toHaveCount(1);
  await shot(page, '09-publication');

  // reorder with the buttons (keyboard-friendly): add the second module then move it up
  await page.getByTestId('pool-item').first().getByRole('button', { name: /^Add/ }).click();
  await expect(chapter.getByTestId('pub-module')).toHaveCount(2);
  const second = chapter.getByTestId('pub-module').nth(1);
  const title = await second.locator('.v2-mod-title').innerText();
  await second.getByRole('button', { name: /Move .* up/ }).click();
  await expect(chapter.getByTestId('pub-module').first().locator('.v2-mod-title')).toHaveText(title);

  await page.getByTestId('save-publication').click();
  await expect(page.locator('.v2-toast', { hasText: /Saved: 2 data module/ })).toBeVisible();
  await expect(page.getByTestId('unsaved-bar')).toHaveCount(0);

  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Explore', exact: true }).click();
  await expect(page.getByTestId('explore-tree')).toBeVisible();
  await expect(page.getByRole('treeitem').first()).toBeVisible();
  await page.getByTestId('explore-dm').first().click();
  await expect(page.getByTestId('explore-detail')).toContainText('S1KSTUDIO');
  await shot(page, '10-explore');
});

test('editor: the saved publication hierarchy shows in the left panel, with its data modules in their chapters', async () => {
  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Editor', exact: true }).click();
  const chapter = page.getByTestId('chapter-node').filter({ hasText: 'Description' });
  await expect(chapter).toBeVisible();
  await expect(chapter.getByTestId('dm-row')).toHaveCount(2);
  await chapter.locator('.v2-chap').first().click();                 // collapse
  await expect(chapter.getByTestId('dm-row')).toHaveCount(0);
  await chapter.locator('.v2-chap').first().click();
  await expect(chapter.getByTestId('dm-row').first()).toBeVisible();
  await shot(page, '34-editor-hierarchy');
  await page.getByTestId('view-all').click();
  await expect(page.getByTestId('chapter-node')).toHaveCount(0);
  await page.getByTestId('view-tree').click();
  await expect(page.getByTestId('chapter-node')).toHaveCount(1);
  await chapter.getByTestId('dm-row').first().click();                              // opens in the editor
  await expect(page.locator('.doc-tabs [role=tab]').first()).toBeVisible();
});

test('publication: chapters can be rearranged by drag and drop, and modules added to a chosen chapter', async () => {
  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Publication', exact: true }).click();
  for (const t of ['Operation', 'Maintenance']) {
    await page.getByTestId('add-chapter').click();
    await page.getByLabel('Chapter title').fill(t);
    await page.getByRole('button', { name: 'Add chapter', exact: true }).last().click();
  }
  const names = () => page.locator('[data-testid="chapter"]').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? '').replace(/^Chapter /, '')));
  expect(await names()).toEqual(['Description', 'Operation', 'Maintenance']);
  const first = page.getByRole('region', { name: 'Chapter Description' });
  await page.getByRole('region', { name: 'Chapter Maintenance' }).locator('header').dragTo(first, { targetPosition: { x: 120, y: 3 } });
  await expect.poll(names).toEqual(['Maintenance', 'Description', 'Operation']);
  await shot(page, '35-publication-dnd');
  await page.getByTestId('save-publication').click();
  await expect(page.locator('.v2-toast', { hasText: /Saved/ }).first()).toBeVisible();
  await page.reload();
  await expect.poll(names).toEqual(['Maintenance', 'Description', 'Operation']);      // the order survives saving
});

test('validation: run, review a finding, jump to it in the editor', async () => {
  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Validation' }).click();
  await page.getByTestId('run-validation').click();
  await expect(page.getByText(/Last run just now|Last run \d+ min ago/)).toBeVisible({ timeout: 90_000 });
  await shot(page, '11-validation');
  // the artwork was imported with the modules, so nothing is reported missing
  await expect(page.getByText('Missing referenced graphic')).toHaveCount(0);
  const first = page.getByTestId('issue').first();
  if (await first.count()) {
    await first.click();
    await expect(page.getByTestId('issue-detail')).toBeVisible();
    await page.getByRole('button', { name: /Mark reviewed/ }).click();
  }
});

test('release: the Author requests, cannot approve; the administrator approves; Release 1; watermark saved', async () => {
  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Release' }).click();
  await expect(page.getByTestId('review-status')).toContainText('NOT RELEASED');
  await page.getByLabel('Print a watermark on released copies').check();
  await page.getByLabel('Text').fill('CONTROLLED COPY');
  await page.getByRole('button', { name: 'Save watermark' }).click();
  await expect(page.locator('.v2-toast', { hasText: 'Watermark saved' })).toBeVisible();

  await page.getByTestId('request-release').click();
  await expect(page.getByRole('heading', { name: 'Waiting for review' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await shot(page, '12-release-pending');

  await adminPage.goto(projectUrl + '/release');
  await adminPage.getByRole('button', { name: 'Approve' }).click();
  // WP-05: approval is confirmed in the platform dialog (it was the browser's confirm box, which Playwright accepted on its own)
  const approve = adminPage.getByRole('dialog', { name: 'Approve and release this manual?' });
  await expect(approve).toContainText('The approval is recorded under your name');
  await approve.getByRole('button', { name: 'Approve' }).click();
  await expect(approve).toHaveCount(0);
  await expect(adminPage.getByTestId('review-status')).toContainText('Approved — Release 1', { timeout: 15_000 });
  await shot(adminPage, '13-release-approved');
  await page.reload();
  await expect(page.getByTestId('review-status')).toContainText('Approved — Release 1');
});

test('project settings: general, publishing (reused screen), team', async () => {
  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Hydraulic Pump Manual');
  await page.getByRole('tab', { name: 'Publishing' }).click();
  await expect(page.getByRole('heading', { name: /Publication|Publishing|Settings/ }).first()).toBeVisible();
  // this project uses the direct S1000D engine: the JSS cover's Code No. / Rev No. do not apply
  await expect(page.getByText('Code no (cover)').locator('xpath=ancestor::label[1]').locator('input')).toBeDisabled();
  await shot(page, '14-settings-publishing');
  await page.getByRole('tab', { name: 'Team' }).click();
  await expect(page.getByTestId('team-members')).toContainText('@asha');
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible();
  await shot(page, '15-settings-team');
});

test('main settings: administrator sees people, approvals, sessions, the audit log and a backup of the platform', async () => {
  const page = adminPage;
  await page.goto('/settings');
  for (const t of ['Account', 'Backup', 'Users', 'Approvals', 'Sessions', 'Audit log']) await expect(page.getByRole('tab', { name: new RegExp(t) })).toBeVisible();
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await expect(page.getByText('release.approved')).toBeVisible();
  await shot(page, '16-audit');
  await page.getByRole('tab', { name: 'Backup' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup').click()]);
  expect(dl.suggestedFilename()).toMatch(/^agastya-platform-backup-.*\.zip$/);
  const buf = await (await import('node:fs/promises')).readFile(await dl.path());
  expect(buf.subarray(0, 2).toString()).toBe('PK');
  expect(buf.length).toBeGreaterThan(1000);
});

test('the Author can back up her own projects', async () => {
  await page.goto('/settings/backup');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup').click()]);
  expect(dl.suggestedFilename()).toMatch(/^agastya-asha-backup-.*\.zip$/);
});

test('a new project can start as a User Handbook: seven chapters ready in Publication, the engine fixed to the JSS book', async () => {
  await page.goto('/workspace');
  await page.getByRole('button', { name: /New project/ }).first().click();
  await page.getByTestId('wiz-start-create').click();
  await page.getByLabel('Project name').fill('Handbook One');
  await page.getByTestId('wiz-format-jss').click();                // User Handbook = JSS format, Land domain, User Handbook manual type
  await page.getByTestId('wiz-domain').selectOption('land');
  await page.getByTestId('wiz-manual-type').selectOption('uhb');
  await page.getByRole('button', { name: 'Next' }).click();        // JSS has no S1000D identity / codes steps: straight to the review
  await expect(page.getByTestId('wiz-review')).toBeVisible();
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByTestId('project-card').filter({ hasText: 'Handbook One' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/editor$/);
  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Publication', exact: true }).click();
  await expect(page.getByTestId('chapter')).toHaveCount(7);
  await expect(page.getByRole('region', { name: 'Chapter Operating Instructions' })).toBeVisible();
  await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Publishing' }).click();
  const codeNo = page.getByText('Code no (cover)').locator('xpath=ancestor::label[1]').locator('input');
  await expect(codeNo).toBeEnabled();                                        // a JSS book project can set it
  await codeNo.fill('DT0123_U0100_0001');
  await shot(page, '36-user-handbook-start');
});

test('graphics: a project lists only its own ICNs and symbols; the main page lists every project\'s', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.goto(`${projectUrl}/graphics`);
  await expect(page.getByRole('heading', { name: 'Graphics', exact: true })).toBeVisible();
  await page.getByTestId('graphics-file').setInputFiles([
    { name: ICN, mimeType: 'image/svg+xml', buffer: fs.readFileSync(path.join(SAMPLES, ICN)) },
    { name: 'only-here.png', mimeType: 'image/png', buffer: png },
  ]);
  const icn = page.locator(`[data-testid="graphic"][data-name="${ICN}"]`);
  const sym = page.locator('[data-testid="graphic"][data-name="only-here.png"]');
  await expect(icn).toHaveAttribute('data-kind', 'icn');
  await expect(sym).toHaveAttribute('data-kind', 'symbol');
  await shot(page, '37-graphics');

  await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: /Symbols/ }).click();
  await expect(sym).toBeVisible();
  await expect(icn).toHaveCount(0);
  await page.getByRole('group', { name: 'Kind' }).getByRole('button', { name: /All/ }).click();

  // an ICN must be named ICN-...
  await page.getByLabel('Add as').selectOption('icn');
  await page.getByTestId('graphics-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText(/must be named ICN-/)).toBeVisible();
  await page.getByLabel('Add as').selectOption('auto');

  // another project does not see this project's symbol; the main page groups by project
  await page.goto('/graphics');
  await expect(page.getByRole('heading', { name: 'Graphics management' })).toBeVisible();
  const own = page.getByRole('region', { name: 'Graphics of Hydraulic Pump Manual' });
  const other = page.getByRole('region', { name: 'Graphics of Handbook One' });
  await expect(own.locator('[data-name="only-here.png"]')).toBeVisible();
  await expect(other).toBeVisible();                                                            // loaded: Handbook One has none of it
  await expect(other.locator('[data-name="only-here.png"]')).toHaveCount(0);

  await page.goto(`${projectUrl}/graphics`);
  await page.getByRole('button', { name: 'Delete only-here.png' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(sym).toHaveCount(0);
});

test('CIR: an Author adds a common data module for everyone and copies one into a project', async () => {
  await page.goto('/cir');
  await page.getByTestId('cir-add').click();
  await page.getByTestId('cir-file').setInputFiles({ name: PROC, mimeType: 'application/xml', buffer: fs.readFileSync(path.join(SAMPLES, PROC)) });
  await page.getByTestId('cir-submit').click();
  const row = page.locator(`[data-testid="cir-row"][data-file="${PROC}"]`);
  await expect(row).toBeVisible();
  await shot(page, '38-cir');

  const made = await page.request.post('/api/projects', { data: { name: 'CIR Target' } });
  const target = (await made.json()).project.id as string;
  await page.reload();
  await row.getByTestId('cir-use').click();
  await page.getByLabel('Project', { exact: true }).selectOption({ label: 'CIR Target' });
  await page.getByTestId('cir-copy').click();
  await expect(page.locator('.v2-toast', { hasText: /was added to the project/ })).toBeVisible();
  const dms = (await (await page.request.get(`/api/projects/${target}/dms`)).json()).dms as Array<{ file: string }>;
  expect(dms.map((d) => d.file)).toContain(PROC);

  // everyone sees it: the administrator too
  await adminPage.goto('/cir');
  await expect(adminPage.locator(`[data-testid="cir-row"][data-file="${PROC}"]`)).toBeVisible();
});

test('administrator: every V1 section is there; reference data is edited, maintenance and settings do real things', async () => {
  const a = adminPage;
  await a.goto('/administrator');
  // UI redesign screen 6 (mockup admin.html): the sections are grouped into the mockup's tab row; a tab with several sections lists them as
  // links in the "Administrator sections" navigation. Every V1 section is still one tab, or one link inside a tab, away.
  const tabs = a.getByRole('tablist', { name: 'Administration' });
  const nav = a.getByRole('navigation', { name: 'Administrator sections' });
  const open = async (tab: string, section?: string) => {
    await tabs.getByRole('tab', { name: tab, exact: true }).click();
    if (section) await nav.getByRole('link', { name: section, exact: true }).click();
  };
  await expect(a.getByTestId('admin-health')).toBeVisible();                                                   // the overview: health, users, audit, appearance, storage
  await expect(a.getByTestId('users-card')).toBeVisible();
  await expect(a.getByTestId('recent-audit')).toBeVisible();
  await expect(a.getByTestId('appearance-defaults')).toBeVisible();
  await expect(a.getByTestId('admin-storage')).toBeVisible();
  const sections: Record<string, string[]> = {
    'Users and roles': ['Users', 'Roles'],
    'Reference data': ['Country codes', 'Language codes', 'Security classifications', 'PDF customisations', 'Interface languages'],
    S1000D: ['Information codes', 'Numbering (SNS)', 'Data module types', 'Publication templates', 'Responsible partner companies', 'Originator companies'],
    System: ['Maintenance', 'Licence'],
    Appearance: ['Visual settings', 'Settings'],
  };
  for (const [tab, names] of Object.entries(sections)) {
    await open(tab, tab === 'Users and roles' ? 'Roles' : undefined);
    for (const n of names) await expect(nav.getByRole('link', { name: n, exact: true })).toBeVisible();
    // the owner removed the second SNS screen on 2026-11-26 (one numbering system per project kind): it must not come back
    await expect(nav.getByRole('link', { name: 'SNS defaults', exact: true })).toHaveCount(0);
  }
  for (const t of ['Access', 'Backup', 'Audit log']) await expect(tabs.getByRole('tab', { name: t, exact: true })).toBeVisible();
  await a.goto('/administrator');
  await shot(a, '39-administrator');

  await open('S1000D', 'Data module types');
  await expect(a.getByTestId('config-row')).toHaveCount(21);

  await open('Reference data', 'Country codes');
  await a.getByTestId('config-add').click();
  await a.getByLabel('ISO code', { exact: true }).fill('ZZ');
  await a.getByLabel('Country', { exact: true }).fill('Test country');
  await a.getByTestId('config-save').click();
  const row = a.getByTestId('config-row').filter({ hasText: 'Test country' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Delete ZZ' }).click();
  await a.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);

  await open('S1000D', 'Responsible partner companies');
  await expect(a.getByText('not checked', { exact: true })).toBeVisible();                                    // empty list = the import check is off

  await open('System', 'Maintenance');
  await a.getByTestId('maint-schemas').click();
  await expect(a.getByTestId('maint-schemas-result')).toContainText('All schema sets installed');

  await open('Audit log');
  await expect(a.getByTestId('audit-export')).toBeVisible();

  await open('Appearance', 'Settings');
  await a.getByLabel('Application name').fill('Defence Docs');
  await a.getByTestId('settings-save').click();
  await expect(a.locator('.v2-brand')).toContainText('Defence Docs');
  await a.getByLabel('Application name').fill('Agastya');
  await a.getByTestId('settings-save').click();
  await expect(a.locator('.v2-brand')).toContainText('Agastya');

  // an Author has no Administrator section
  await page.goto('/administrator');
  await expect(page).toHaveURL(/\/overview$/);
});

test('new data module: language, country, type, security, enterprise and more are dropdowns of what the Administrator maintains; English / India are selected', async () => {
  // the Administrator adds a country and registers an enterprise
  const add = (c: string, data: object) => adminPage.request.post(`/api/admin/config/${c}`, { data });
  await add('country-codes', { code: 'NO', name: 'Norway' });
  await add('rpc-cages', { cage: 'S1K01', name: 'Sample Studio Co', role: 'RPC' });
  await add('originator-cages', { cage: 'S1K01', name: 'Sample Studio Co', role: 'Originator' });
  try {
    await page.goto(`${projectUrl}/editor`);
    await expect(page.getByTestId('studio-host')).toBeVisible();
    await page.getByRole('complementary', { name: 'Data modules' }).getByRole('button', { name: 'New data module' }).click();
    const dialog = page.getByRole('dialog', { name: 'New data module' });
    await expect(dialog).toBeVisible();

    const lang = dialog.getByLabel('Language', { exact: true });
    const country = dialog.getByLabel('Country', { exact: true });
    await expect(lang).toHaveValue('en');                                                      // English ...
    await expect(country).toHaveValue('IN');                                                   // ... and India are selected by default
    expect(await lang.evaluate((e) => e.tagName)).toBe('SELECT');                             // a dropdown, not a text box
    await expect(country.locator('option', { hasText: 'NO – Norway' })).toHaveCount(1);       // what the Administrator added is there

    const type = dialog.getByLabel('Type', { exact: true });
    await expect(type.locator('option')).toHaveCount(21);
    await expect(type).toHaveValue('descript');
    await type.selectOption('brex');
    await expect(dialog.getByLabel('Info code', { exact: true })).toHaveValue('022');          // a type brings its own information code
    await type.selectOption('descript');

    expect(await dialog.getByLabel('Security classification').evaluate((e) => e.tagName)).toBe('SELECT');
    // applicability and the system come from the PROJECT now (its ACT and SNS): this project has neither, so they are plain fields
    await expect(dialog.getByLabel('Applicability')).toHaveValue('All');
    expect(await dialog.getByLabel('System', { exact: true }).evaluate((e) => e.tagName)).toBe('INPUT');

    // registered enterprises: the code is a pick, the name follows it, the originator is its own pick
    const rpc = dialog.getByLabel('Responsible partner company');
    await expect(rpc).toHaveValue('TST01');                                                    // the project's own enterprise wins, although it is not registered ...
    await expect(dialog.getByLabel('Enterprise name')).toHaveValue('Test Co');
    await expect(rpc.locator('option', { hasText: 'S1K01 – Sample Studio Co' })).toHaveCount(1);  // ... and the registered one is still on offer
    await rpc.selectOption('S1K01');
    await expect(dialog.getByLabel('Enterprise name')).toHaveValue('Sample Studio Co');         // the name follows the code
    await expect(dialog.getByLabel('Originator', { exact: true })).toHaveValue('TST01');
    await shot(page, '42-wizard-dropdowns');

    await country.selectOption('NO');
    await expect(dialog.locator('.dmc-preview')).toContainText('_EN-NO.XML');                  // the choice reaches the file name
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  } finally {
    for (const [c, key, code] of [['country-codes', 'code', 'NO'], ['rpc-cages', 'cage', 'S1K01'], ['originator-cages', 'cage', 'S1K01']] as const) {
      const items = (await (await adminPage.request.get(`/api/admin/config/${c}`)).json()).items as Array<Record<string, string>>;
      for (const it of items.filter((i) => i[key] === code)) await adminPage.request.delete(`/api/admin/config/${c}/${it.id}`);
    }
  }
});

test('CIR: create a data module in the repository with the wizard (its own unique code), then add it to a project from the editor', async () => {
  await page.goto('/cir');
  await page.getByTestId('cir-create').click();
  await expect(page.getByTestId('studio-host')).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'New data module' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Model ident', { exact: true }).fill('CIRX');
  await dialog.getByLabel('Technical name').fill('Common pump data');
  await expect(dialog.locator('.dmc-preview')).toContainText('_EN-IN.XML');                    // English / India by default
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const first = 'DMC-CIRX-A-00-00-00-00A-040A-D_001-00_EN-IN.XML';
  await expect(page.getByTestId('dm-list').getByText('New, not saved to the project yet')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dm-list').locator(`[data-file="${first}"]`)).toBeVisible();
  await shot(page, '43-cir-editor');

  // the repository's own workspace: editor and graphics only, no release or publication
  const rail = page.getByRole('complementary', { name: 'Project navigation' });
  await expect(rail.getByRole('link', { name: 'Graphics' })).toBeVisible();
  await expect(rail.getByRole('link', { name: 'Release' })).toHaveCount(0);
  await expect(rail.getByRole('link', { name: 'Publication' })).toHaveCount(0);
  await expect(page.getByTestId('generate-btn')).toHaveCount(0);

  // its code is unique inside the repository: the same code is taken, so the wizard moves to the next assembly code
  await page.getByRole('complementary', { name: 'Data modules' }).getByRole('button', { name: 'New data module' }).click();
  await expect(page.getByRole('dialog', { name: 'New data module' }).getByLabel('Assy', { exact: true })).toHaveValue('01');
  await page.getByRole('dialog', { name: 'New data module' }).getByRole('button', { name: 'Cancel' }).click();

  // back in the repository: listed, editable, and an Author cannot delete it
  await rail.getByRole('link', { name: 'Back to the repository' }).click();
  const row = page.locator(`[data-testid="cir-row"][data-file="${first}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId('cir-edit')).toBeVisible();
  await expect(row.getByRole('button', { name: /^Remove / })).toHaveCount(0);

  // reuse: from a project's own editor, add it with "Add from the common repository"
  await page.goto(`${projectUrl}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  await page.getByTestId('cir-pick').click();
  const pick = page.locator(`[data-testid="cir-pick-row"][data-file="${first}"]`);
  await expect(pick).toBeVisible();
  await pick.getByRole('checkbox').check();
  await page.getByTestId('cir-pick-add').click();
  await expect(page.locator('.v2-toast', { hasText: /Added 1 data module from the repository/ })).toBeVisible();
  await expect(page.getByTestId('dm-list').locator(`[data-file="${first}"]`)).toBeVisible();
  await page.getByTestId('cir-pick').click();
  await expect(page.locator(`[data-testid="cir-pick-row"][data-file="${first}"]`)).toContainText('already here');   // not offered twice
  await page.getByRole('button', { name: 'Cancel' }).click();
});

test.describe('a second person: account creation, onboarding, sharing and read-only access', () => {
  let temp = '';
  let page2: Page;

  test('administrator creates an Author and sees the one-time temporary password', async () => {
    const page = adminPage;
    await page.goto('/settings/users');
    await page.getByRole('button', { name: 'New user' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Priya Nair');
    await page.getByLabel('Role', { exact: true }).selectOption('author');
    await page.getByRole('button', { name: 'Create account' }).click();
    const box = page.getByLabel('Temporary password');
    await expect(box).toBeVisible();
    temp = await box.inputValue();
    expect(temp).toMatch(/^priya-[a-hjkmnp-z2-9]{8}$/);
    await page.getByRole('button', { name: 'Done' }).click();
    await shot(page, '17-users');
  });

  test('the new user must onboard before anything else, then has no projects', async ({ browser }) => {
    page2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page2.goto('/');
    await page2.getByLabel('Username').fill('priya');
    await page2.getByLabel('Password').fill(temp);
    await page2.getByRole('button', { name: 'Sign in' }).click();
    await expect(page2.getByRole('heading', { name: /Welcome, Priya Nair/ })).toBeVisible();
    await page2.getByLabel('New password').fill(PW);
    await page2.getByLabel('Repeat password').fill(PW);
    await page2.getByRole('button', { name: 'Finish' }).click();
    await expect(page2.getByRole('heading', { name: /Welcome back, Priya/ })).toBeVisible();
    await expect(page2.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Activity' })).toHaveCount(0);   // authors get no oversight page
    await page2.getByRole('link', { name: 'Workspace' }).click();
    await expect(page2.getByTestId('project-card')).toHaveCount(0);
  });

  test('the owner gives her view access; she finds the project read-only', async () => {
    await page.goto(projectUrl + '/settings/team');
    await page.getByLabel("Author's username").fill('priya');
    await page.getByLabel('Access level').selectOption('viewer');
    await page.getByTestId('assign-author').click();
    await expect(page.getByTestId('team-members')).toContainText('@priya');

    await page2.getByRole('link', { name: 'Overview' }).click();
    await page2.getByRole('link', { name: 'Workspace' }).click();
    await page2.getByTestId('project-card').filter({ hasText: 'Hydraulic Pump Manual' }).click();
    await expect(page2.getByText(/You have viewer access to this project/)).toBeVisible();
    await shot(page2, '19-viewer-editor');

    await page2.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Release' }).click();
    await expect(page2.getByText('Editors and owners can submit a manual for review.')).toBeVisible();
    await page2.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Settings' }).click();
    await page2.getByRole('tab', { name: 'Danger zone' }).click();
    await expect(page2.getByText('Only an owner can delete the project.')).toBeVisible();
    await page2.context().close();
  });
});

test.describe('sample project and unique data modules', () => {
  test('a data module cannot be imported twice into the same project', async () => {
    await page.goto(projectUrl + '/editor');
    await expect(page.getByTestId('studio-host')).toBeVisible();
    await page.locator('input[type=file][multiple]:not([data-testid])').setInputFiles([path.join(SAMPLES, DESC)]);
    // the refusal is an "Import refused" dialog that names the problem (it was a toast before the import-without-validation dialog existed)
    await expect(page.getByRole('dialog', { name: 'Import refused' })).toContainText(/already exists|already has/);
    await page.getByRole('dialog', { name: 'Import refused' }).getByRole('button', { name: 'Cancel' }).click();
  });

  test('one click creates a sample project with data modules, a figure and a publication; it builds', async () => {
    await page.goto('/workspace');
    await page.getByTestId('samples-menu').click();                                      // WP-35 (UX-014): the samples sit behind one button
    await page.getByTestId('create-sample').click();
    await expect(page).toHaveURL(/\/editor$/);
    sampleUrl = page.url().replace(/\/editor$/, '');
    await expect(page.getByTestId('dm-list').locator('[data-file]')).toHaveCount(3);
    await shot(page, '20-sample-project');
    await page.getByTestId('generate-btn').click();
    await expect(page.locator('.v2-log', { hasText: /Built in/ })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('pdf-pane').locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    await shot(page, '21-sample-generated');

    await page.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Explore', exact: true }).click();
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(page.getByTestId('explore-dm')).toHaveCount(3);
  });

  test('new data module: takes the project\'s model code, blocks duplicates, suggests the next free code, saves under its DMC name', async () => {
    await page.goto(sampleUrl + '/editor');
    await expect(page.getByTestId('studio-host')).toBeVisible();
    const panel = page.getByRole('complementary', { name: 'Data modules' });
    const model = page.getByLabel('Model ident', { exact: true });          // found by label: some code fields are dropdowns (the Administrator's lists)
    const assy = page.getByLabel('Assy', { exact: true });
    const errors = page.locator('.form-errors');

    await panel.getByRole('button', { name: 'New data module' }).click();
    await expect(model).toHaveValue('S1KSTUDIO');   // the project's code, not "EXAMPLE"
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    // the wizard now asks the server for taken identities first; the new module is only open (and Ctrl+S only
    // means something) once the list shows it as "not saved to the project yet"
    await expect(page.getByTestId('dm-list').getByText('New, not saved to the project yet')).toBeVisible();
    await page.keyboard.press('Control+s');
    const first = 'DMC-S1KSTUDIO-A-00-00-00-00A-040A-D_001-00_EN-IN.XML';
    await expect(page.getByTestId('dm-list').locator(`[data-file="${first}"]`)).toBeVisible();   // named by its code

    // the second time, that code is taken: the wizard moves to the next free assembly code
    await panel.getByRole('button', { name: 'New data module' }).click();
    await expect(assy).toHaveValue('01');
    await expect(errors).not.toContainText('Already in this project');
    await assy.fill('00');                          // force the duplicate
    await expect(errors).toContainText('Already in this project');
    await expect(errors).toContainText(first);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'New data module' })).toBeVisible();   // creation refused
    await shot(page, '22-duplicate-blocked');
    await assy.fill('01');
    await expect(errors).not.toContainText('Already in this project');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('dm-list').locator('[data-file="DMC-S1KSTUDIO-A-00-00-01-00A-040A-D_001-00_EN-IN.XML"]')).toBeVisible();
    await expect(page.getByTestId('dm-list').locator('[data-file]')).toHaveCount(5);
  });

  test('the data-module list can be resized by dragging its edge, and the width is remembered', async () => {
    await page.goto(sampleUrl + '/editor');
    const panel = page.getByRole('complementary', { name: 'Data modules' });
    const sep = page.getByRole('separator', { name: 'Resize data module list' });
    await expect(panel).toBeVisible();
    const w0 = (await panel.boundingBox())!.width;
    const b = (await sep.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 120, b.y + 200, { steps: 6 });
    await page.mouse.up();
    const w1 = (await panel.boundingBox())!.width;
    expect(w1).toBeGreaterThan(w0 + 100);
    expect(w1).toBeLessThanOrEqual(480);
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Data modules' })).toBeVisible();
    expect((await page.getByRole('complementary', { name: 'Data modules' }).boundingBox())!.width).toBeCloseTo(w1, 0);
    await shot(page, '23-resized-list');
  });

  test('dark mode: the PDF viewer toolbar follows the theme (it was hard-coded white)', async () => {
    await page.goto(sampleUrl + '/editor');
    await page.evaluate(() => localStorage.setItem('agastya.theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('generate-btn').click();
    await expect(page.getByTestId('pdf-pane').locator('canvas').first()).toBeVisible({ timeout: 120_000 });
    const toolbar = page.getByTestId('pdf-pane').locator('div').first().locator('div').first();
    const bg = await toolbar.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g)!.map(Number);
    expect(r + g + b, `toolbar background ${bg} should be dark`).toBeLessThan(250);
    // the toolbar fits on one line in the narrow panel (the viewer's own Download wrapped onto a second line)
    expect((await toolbar.boundingBox())!.height).toBeLessThan(60);
    await shot(page, '24-dark-pdf');
    await page.evaluate(() => localStorage.removeItem('agastya.theme'));
  });
});

test.describe('roles: administrator -> Project Manager -> Author', () => {
  let managerTemp = '';
  let authorTemp = '';
  let mgr: Page;
  let auth: Page;

  const signIn = async (browser: import('@playwright/test').Browser, user: string, temp: string, name: string) => {
    const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await p.goto('/');
    await p.getByLabel('Username').fill(user);
    await p.getByLabel('Password').fill(temp);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.getByLabel('New password').fill(PW);
    await p.getByLabel('Repeat password').fill(PW);
    await p.getByRole('button', { name: 'Finish' }).click();
    await expect(p.getByRole('heading', { name: new RegExp(`Welcome back, ${name}`) })).toBeVisible();
    return p;
  };

  test('the administrator creates a Project Manager', async () => {
    const page = adminPage;
    await page.goto('/settings/users');
    await page.getByRole('button', { name: 'New user' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Meera Rao');
    await page.getByLabel('Role', { exact: true }).selectOption('project_manager');
    await page.getByRole('button', { name: 'Create account' }).click();
    managerTemp = await page.getByLabel('Temporary password').inputValue();
    await page.getByRole('button', { name: 'Done' }).click();
    // UI redesign screen 6: the role is a badge in the row now (Change role… in the row's Actions menu holds the select)
    await expect(page.getByRole('row', { name: /Meera Rao/ })).toContainText('Project manager');
  });

  test('the Project Manager creates an Author, a project, and assigns the Author', async ({ browser }) => {
    mgr = await signIn(browser, 'meera', managerTemp, 'Meera');
    const nav = mgr.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Activity' })).toBeVisible();

    await mgr.goto('/settings/authors');
    await mgr.getByTestId('new-author').click();
    await mgr.getByLabel('Name', { exact: true }).fill('Arjun Das');
    await expect(mgr.getByLabel('Username')).toHaveValue('arjun');
    await mgr.getByRole('button', { name: 'Create account' }).click();
    authorTemp = await mgr.getByLabel('Temporary password').inputValue();
    await mgr.getByRole('button', { name: 'Done' }).click();
    await expect(mgr.getByRole('row', { name: /Arjun Das/ })).toBeVisible();

    await mgr.goto('/workspace');
    await mgr.getByRole('button', { name: /New project/ }).first().click();
    await mgr.getByTestId('wiz-start-create').click();
    await mgr.getByLabel('Project name').fill('Managed Manual');
    await finishWizard(mgr, 'MNGD1');
    await expect(mgr.getByTestId('project-card').filter({ hasText: 'Managed Manual' })).toBeVisible();
    await mgr.getByTestId('project-card').filter({ hasText: 'Managed Manual' }).click();
    await mgr.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Settings', exact: true }).click();
    await mgr.getByRole('tab', { name: 'Team' }).click();
    await mgr.getByLabel("Author's username").fill('arjun');
    await mgr.getByLabel('Access level').selectOption('editor');
    await mgr.getByTestId('assign-author').click();
    await expect(mgr.getByTestId('team-members')).toContainText('@arjun');
    await shot(mgr, '25-manager-team');
  });

  test('the Author sees only the assigned project, cannot approve, and asks for a release', async ({ browser }) => {
    auth = await signIn(browser, 'arjun', authorTemp, 'Arjun');
    await auth.getByRole('link', { name: 'Workspace' }).click();
    await expect(auth.getByTestId('project-card')).toHaveCount(1);                       // not Hydraulic Pump, not the sample
    await auth.getByTestId('project-card').click();
    await auth.getByRole('complementary', { name: 'Project navigation' }).getByRole('link', { name: 'Release', exact: true }).click();
    await expect(auth.getByTestId('request-release')).toBeVisible();
    await auth.getByTestId('request-release').click();
    await expect(auth.getByRole('heading', { name: 'Waiting for review' })).toBeVisible();
    await expect(auth.getByRole('button', { name: 'Approve' })).toHaveCount(0);           // authors never approve
    await expect(auth.getByText(/Project Manager of this project, or an administrator/)).toBeVisible();
    await shot(auth, '26-author-pending');
  });

  test('the Project Manager is notified of the request, approves it from Activity; the Author is notified of the decision', async () => {
    await mgr.goto('/notifications');
    await expect(mgr.getByTestId('unread-count')).toBeVisible();
    const ask = mgr.getByTestId('notification').filter({ hasText: 'Manual submitted for review' });
    await expect(ask).toContainText('Arjun Das');
    await expect(ask).toHaveAttribute('data-read', 'false');
    await shot(mgr, '29-manager-notifications');

    await mgr.goto('/activity');
    await expect(mgr.getByTestId('approvals-queue')).toContainText('Managed Manual');
    await expect(mgr.getByTestId('activity-project').filter({ hasText: 'Managed Manual' })).toContainText('Arjun Das');
    await expect(mgr.getByTestId('activity-project').filter({ hasText: 'Hydraulic Pump Manual' })).toHaveCount(0);   // only what she manages
    await shot(mgr, '27-manager-activity');
    await mgr.getByTestId('approvals-queue').getByRole('button', { name: 'Approve' }).click();
    await expect(mgr.locator('.v2-toast', { hasText: 'Release approved' })).toBeVisible();

    await mgr.goto('/notifications');
    await mgr.getByTestId('mark-all-read').click();
    await expect(mgr.getByTestId('notification').filter({ hasText: 'Manual submitted for review' })).toHaveAttribute('data-read', 'true');
    await expect(mgr.getByTestId('unread-count')).toHaveCount(0);

    await auth.goto('/notifications');
    await expect(auth.getByTestId('notification').filter({ hasText: 'Release approved' })).toContainText('Meera Rao');
    await expect(auth.getByTestId('notification').filter({ hasText: 'You were added to a project' })).toContainText('Managed Manual');
    await expect(auth.getByTestId('unread-count')).toHaveText('2');
    await auth.getByTestId('notification').filter({ hasText: 'Release approved' }).getByRole('button', { name: 'Mark as read' }).click();
    await expect(auth.getByTestId('unread-count')).toHaveText('1');                      // marking one leaves the other unread
    await shot(auth, '30-author-notifications');
  });

  test('the administrator sees the projects with their release status, the team and all activity', async () => {
    const page = adminPage;
    await page.goto('/overview');
    await expect(page.getByTestId('project-status')).toContainText('Managed Manual');
    await expect(page.getByTestId('status-row').filter({ hasText: 'Managed Manual' })).toContainText('Released');
    // a data module created after the release joins the publication on its own (placeNewDm), so this project now reads "Changed since release"
    await expect(page.getByTestId('status-row').filter({ hasText: 'Hydraulic Pump Manual' })).toContainText('Changed since release');
    await page.getByRole('button', { name: 'Not released' }).click();
    await expect(page.getByTestId('status-row').filter({ hasText: 'Managed Manual' })).toHaveCount(0);
    await shot(page, '31-admin-overview');
    await page.goto('/activity');
    await expect(page.getByTestId('activity-project').filter({ hasText: 'Managed Manual' })).toBeVisible();
    await page.getByRole('tab', { name: 'People' }).click();
    await expect(page.getByTestId('activity-people')).toContainText('Arjun Das');
    await page.getByRole('tab', { name: 'Activity feed' }).click();
    await expect(page.getByTestId('activity-feed')).toContainText('approved a release of');
    await shot(page, '28-admin-activity');
    await page.goto('/notifications');
    await expect(page.getByTestId('notification').filter({ hasText: 'New project' })).toContainText('Managed Manual');
  });

  test('the Project Manager dashboard shows her team and projects', async () => {
    await mgr.goto('/overview');
    await expect(mgr.getByTestId('team-table')).toContainText('Arjun Das');
    await expect(mgr.getByTestId('project-status')).toContainText('Managed Manual');
    await expect(mgr.getByTestId('project-status')).not.toContainText('Hydraulic Pump Manual');
    await shot(mgr, '32-manager-overview');
  });

  test('review: submit, comment, send back with reasons, resubmit, approve - then the author downloads the clean PDF', async () => {
    const xml = fs.readFileSync(path.join(SAMPLES, DESC), 'utf8');
    const id = (await (await mgr.request.post('/api/projects', { data: { name: 'Review Manual' } })).json()).project.id as string;
    expect((await mgr.request.post(`/api/projects/${id}/assign`, { data: { username: 'arjun', role: 'editor' } })).ok()).toBe(true);
    expect((await mgr.request.post(`/api/projects/${id}/dms`, { data: { file: DESC, xml } })).ok()).toBe(true);
    const pmc = await (await mgr.request.get(`/api/projects/${id}/pmc`)).json();
    expect((await mgr.request.put(`/api/projects/${id}/pmc`, { data: { baseHash: pmc.hash, meta: pmc.meta, entries: [{ type: 'folder', title: 'Chapter 1', children: [{ type: 'include', title: 'Pump', href: `csdb/${DESC}` }] }] } })).ok()).toBe(true);

    await auth.goto(`/projects/${id}/release`);
    await expect(auth.getByTestId('review-status')).toHaveAttribute('data-state', 'draft');
    await auth.getByTestId('request-release').click();
    await expect(auth.getByRole('heading', { name: 'Waiting for review' })).toBeVisible();
    await expect(auth.getByTestId('review-status')).toHaveAttribute('data-state', 'in_review');

    await mgr.goto(`/projects/${id}/release`);
    await expect(mgr.getByTestId('send-back')).toBeDisabled();                                // needs a reason
    await mgr.getByTestId('comment-text').fill('The title needs the model name.');
    await mgr.getByTestId('comment-add').click();
    await expect(mgr.getByTestId('review-comment')).toHaveCount(1);
    await mgr.getByTestId('send-back-reason').fill('Please fix the title and resubmit.');
    await mgr.getByTestId('send-back').click();
    await expect(mgr.getByTestId('review-status')).toHaveAttribute('data-state', 'changes_requested');
    await shot(mgr, '40-review-sent-back');

    await auth.goto(`/projects/${id}/release`);
    await expect(auth.getByTestId('review-status')).toHaveAttribute('data-state', 'changes_requested');
    await expect(auth.getByTestId('review-comment').filter({ hasText: 'Please fix the title' })).toContainText('Sent back');
    await auth.goto('/notifications');                                                       // the bell lives in the main top bar
    await expect(auth.getByTestId('bell')).toHaveAttribute('aria-label', /unread/);
    await expect(auth.getByTestId('notification').filter({ hasText: 'Changes requested' })).toContainText('Please fix the title');
    await auth.goto(`/projects/${id}/release`);
    // the box turns on once the server has recorded it, so click and wait rather than check()
    for (let n = 0; n < 2; n++) {
      const box = auth.getByTestId('review-comment').nth(n).getByRole('checkbox');
      await box.click();
      await expect(box).toBeChecked();
    }
    await auth.getByTestId('request-release').click();
    await expect(auth.getByRole('heading', { name: 'Waiting for review' })).toBeVisible();

    await mgr.goto(`/projects/${id}/release`);
    await mgr.getByTestId('approve').click();
    await mgr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();   // FE-012: approval asks first
    await expect(mgr.getByTestId('review-status')).toHaveAttribute('data-state', 'approved', { timeout: 15_000 });

    await auth.goto(`/projects/${id}/release`);
    await expect(auth.getByTestId('review-status')).toContainText('Approved — Release 1');
    const [dl] = await Promise.all([auth.waitForEvent('download'), auth.getByTestId('download-pdf').click()]);
    expect(dl.suggestedFilename()).not.toContain('NOT RELEASED');
    expect((await auth.request.get(`/api/projects/${id}/publish/download`)).headers()['x-release-state']).toBe('released');
    await shot(auth, '41-review-approved');
  });

  test('every user lands on their own dashboard after signing in, whatever page the last user left', async () => {
    await mgr.goto('/settings/authors');
    await mgr.getByTestId('account-menu').click();
    await mgr.getByRole('menuitem', { name: 'Sign out' }).click();
    await mgr.getByLabel('Username').fill('priya');
    await mgr.getByLabel('Password').fill(PW);
    await mgr.getByRole('button', { name: 'Sign in' }).click();
    await expect(mgr).toHaveURL(/\/overview$/);
    await expect(mgr.getByRole('heading', { name: /Welcome back, Priya/ })).toBeVisible();
    await mgr.context().close();
    await auth.context().close();
  });
});
