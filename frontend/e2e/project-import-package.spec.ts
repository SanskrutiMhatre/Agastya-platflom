// Import package, as an author uses it: the icon beside the import buttons in the editor's side panel opens a dialog -> choose a .zip (or files, or a folder)
// -> Scan: a readable report, nothing written -> Apply: the change log -> place the modules no publication claimed. Also what is refused, what a failed scan
// keeps, how a 700-file package stays readable, and who sees the action.
//
// Self-contained (creates its own people and projects through the API). The package is made at test time from public/samples. It must run after
// platform.spec.ts only if that spec runs at all; on its own it creates the administrator itself.

import { test, expect, type Page, type APIRequestContext, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { adminApi, assign, newPerson, type Person } from './support/session';
import { DESC, FAULT, PMC_NAME, PNG, PROC, UNPLACED, samplePackage, zip } from './support/pkg';

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/shots/${name}.png` });

test.describe.configure({ mode: 'serial' });

let author: Person;
let viewer: Person;
let page: Page;
let api: APIRequestContext;
let pid = '';
let second = '';
const consoleErrors: string[] = [];

const dialog = (): Locator => page.getByRole('dialog', { name: 'Import package' });
const openDialog = async (id: string) => {
  await page.goto(`/projects/${id}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  await page.getByTestId('import-package').click();
  await expect(dialog()).toBeVisible();
};
const zipFile = (files = samplePackage()) => ({ name: 'package.zip', mimeType: 'application/zip', buffer: zip(files) });

test.beforeAll(async ({ browser, baseURL }) => {
  const admin = await adminApi(baseURL);
  author = await newPerson(admin, browser, baseURL, 'pkg', 'Package Author');
  viewer = await newPerson(admin, browser, baseURL, 'pkgview', 'Package Viewer');
  page = author.page; api = author.api;
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  const mk = async (name: string) => (await (await api.post('/api/projects', { data: { name, pipeline: 's1000dtofo' } })).json()).project.id as string;
  pid = await mk('Imported package');
  second = await mk('Imported from a folder');
  await assign(api, pid, viewer.username, 'viewer');
  await admin.dispose();
});
test.afterAll(async () => { await author.page.context().close(); await viewer.page.context().close(); });

test('the icon is beside the two import buttons, which are still there', async () => {
  await page.goto(`/projects/${pid}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  const side = page.getByRole('complementary', { name: 'Data modules' });
  await expect(side.getByRole('button', { name: 'Import data modules and graphics' })).toBeVisible();
  await expect(side.getByRole('button', { name: 'Import without validation' })).toBeVisible();
  const pkg = side.getByRole('button', { name: 'Import package' });
  await expect(pkg).toBeVisible();
  await expect(pkg).toHaveAttribute('title', /package/i);
});

test('choose a .zip, scan it: a readable report, and nothing is written', async () => {
  await openDialog(pid);
  await expect(dialog().getByTestId('import-scan')).toBeDisabled();                      // nothing chosen yet
  await expect(dialog().getByTestId('import-apply')).toHaveCount(0);                     // nothing to apply before a scan
  await dialog().getByTestId('import-pkg-zip').setInputFiles(zipFile());
  await expect(dialog().getByTestId('selection-summary')).toContainText('1 file (a zip)');
  await expect(dialog().getByTestId('import-scan')).toBeEnabled();

  // a server error is shown readably and the selection is not lost
  const route = '**/api/projects/*/import/scan';
  await page.route(route, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The scanner broke (test).' }) }));
  await dialog().getByTestId('import-scan').click();
  await expect(dialog().getByTestId('import-error')).toContainText('The scanner broke (test).');
  await expect(dialog().getByTestId('selection-summary')).toContainText('1 file (a zip)');
  await expect(dialog().getByTestId('import-scan')).toBeEnabled();
  await page.unroute(route);

  await dialog().getByTestId('import-scan').click();
  const report = dialog().getByTestId('import-report');
  await expect(report).toBeVisible();
  await expect(dialog().getByTestId('import-error')).toHaveCount(0);                     // the earlier error is gone
  await expect(report.getByTestId('tile-dms')).toContainText('3');
  await expect(report.getByTestId('tile-pmcs')).toContainText('1');
  await expect(report.getByTestId('report-flavour')).toBeVisible();
  // what will be repaired, and why
  const rule = report.locator('[data-rule="icn-placeholder"]');
  await expect(rule).toContainText('Placeholder for missing graphics');
  await expect(rule).toContainText('3 changes in 2 files');
  await expect(rule.getByTestId('rule-icn-placeholder')).toBeChecked();
  await expect(rule.getByTestId('finding-group')).toContainText('Graphic declared but not in the package');
  // the module no publication places
  await expect(report.getByTestId('sec-unassigned')).toHaveAttribute('data-open', '1');                 // a short list is open already
  await expect(report.getByTestId('report-unassigned')).toContainText(UNPLACED.dmc);
  await shot(page, '50-import-report');

  // scan wrote nothing
  expect((await (await api.get(`/api/projects/${pid}/dms`)).json()).dms).toHaveLength(0);
  expect((await (await api.get(`/api/projects/${pid}/media`)).json()).media).toHaveLength(0);
});

test('apply: the change log, the modules in the list, and the publication', async () => {
  await dialog().getByTestId('import-apply').click();
  await expect(dialog().getByTestId('import-result')).toBeVisible({ timeout: 60_000 });
  await expect(dialog().getByTestId('result-headline')).toContainText('Imported 3 data modules');
  await expect(dialog().getByTestId('res-new')).toContainText('3');
  await expect(dialog().getByTestId('res-placeholders')).toContainText('1');
  await expect(dialog().getByTestId('res-media')).toContainText('1');
  await expect(dialog().getByTestId('result-publication')).toContainText('Written');

  // the change log, by repair and then by file, with before and after
  const log = dialog().getByTestId('sec-changelog');
  await expect(log).toContainText('Change log');
  const rule = log.getByTestId('changelog-rule').filter({ hasText: 'Placeholder for missing graphics' });
  await expect(rule).toBeVisible();
  await rule.getByRole('button', { name: /Placeholder for missing graphics/ }).click();
  await expect(rule).toContainText(DESC);
  await rule.locator('summary').first().click();
  await expect(rule.locator('.v2-diff.after').first()).toBeVisible();
  await shot(page, '51-import-changelog');

  // on the server: the modules, the graphic (a placeholder), the publication, the originals kept
  const dms = (await (await api.get(`/api/projects/${pid}/dms`)).json()).dms as Array<{ file: string }>;
  expect(dms.map((d) => d.file).sort()).toEqual([DESC, FAULT, PROC].sort());
  expect((await (await api.get(`/api/projects/${pid}/media`)).json()).media.map((m: { name: string }) => m.name)).toContain('ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.png');
  const book = (await (await api.get(`/api/projects/${pid}/pmc`)).json());
  expect(book.counts.dms).toBe(2);

  // the dialog closes and the editor's list shows what was written, with no reload
  await dialog().getByTestId('import-close').click();
  await expect(dialog()).toHaveCount(0);
  for (const f of [DESC, FAULT, PROC]) await expect(page.getByTestId('dm-list').locator(`[data-file="${f}"]`)).toBeVisible();
  await expect(page.locator('.v2-chap', { hasText: 'Description' })).toBeVisible();
  await expect(page.getByTestId('unplaced-group')).toContainText('Not in the publication');
});

test('place the module no publication claimed into a chapter; the pool empties', async () => {
  await page.getByTestId('import-package').click();
  await dialog().getByTestId('tab-place').click();
  await expect(dialog().getByTestId('tab-place')).toContainText('(1)');
  const panel = dialog().getByTestId('assign-panel');
  await expect(panel.getByTestId('pool-row')).toHaveCount(1);
  await expect(panel.getByTestId('pool-row')).toContainText(UNPLACED.dmc);
  await expect(panel.getByTestId('assign-go')).toBeDisabled();                           // nothing ticked
  await panel.getByRole('checkbox', { name: /^Place / }).check();
  await panel.getByTestId('assign-dest').selectOption({ label: 'Procedures (1 module)' });
  await shot(page, '52-import-assign');
  await panel.getByTestId('assign-go').click();
  await expect(panel.getByTestId('assign-done')).toContainText('Placed 1 module');
  await expect(panel.getByTestId('pool-empty')).toBeVisible();
  await expect(dialog().getByTestId('tab-place')).toContainText('(0)');
  await dialog().getByTestId('import-close').click();

  const unassigned = await (await api.get(`/api/projects/${pid}/import/unassigned`)).json();
  expect(unassigned.count).toBe(0);
  const chapter = page.getByTestId('chapter-node').filter({ has: page.locator('.v2-chap', { hasText: 'Procedures' }) });
  await expect(chapter.getByTestId('dm-row')).toHaveCount(2);
  await expect(page.getByTestId('unplaced-group')).toHaveCount(0);
});

test('a refused import keeps the selection and says why; "replace existing" then succeeds', async () => {
  await openDialog(pid);
  await dialog().getByTestId('import-pkg-zip').setInputFiles(zipFile());
  await dialog().getByTestId('import-scan').click();
  await expect(dialog().getByTestId('import-report')).toBeVisible();
  await dialog().getByTestId('import-apply').click();
  await expect(dialog().getByTestId('import-error')).toContainText('Nothing was imported');
  await expect(dialog().getByTestId('import-refusals')).toContainText('already exists');
  await expect(dialog().getByTestId('selection-summary')).toContainText('1 file (a zip)');       // still chosen
  expect((await (await api.get(`/api/projects/${pid}/dms`)).json()).dms).toHaveLength(3);        // nothing was half-written

  await dialog().getByTestId('sec-options').getByRole('button', { name: 'Import options' }).click();
  await dialog().getByTestId('opt-overwrite').check();
  await dialog().getByTestId('import-apply').click();
  await expect(dialog().getByTestId('import-result')).toBeVisible({ timeout: 60_000 });
  await expect(dialog().getByTestId('res-replaced')).toContainText('3');
  await dialog().getByTestId('import-close').click();
});

test('files and folders work too: a folder keeps its structure, and the project\'s own list is updated', async ({}, testInfo) => {
  const dir = testInfo.outputPath('pkg');
  fs.mkdirSync(path.join(dir, 'XML'), { recursive: true });
  for (const f of samplePackage()) fs.writeFileSync(path.join(dir, /^PMC-/.test(f.name) ? '' : 'XML', f.name), f.bytes);
  await openDialog(second);
  await dialog().getByTestId('import-pkg-folder').setInputFiles(dir);
  await expect(dialog().getByTestId('selection-summary')).toContainText('4 files in the folder pkg');
  await expect(dialog().getByTestId('selection-list')).toContainText(`pkg/XML/${DESC}`);
  await dialog().getByTestId('import-scan').click();
  await expect(dialog().getByTestId('tile-dms')).toContainText('3');
  await dialog().getByTestId('import-apply').click();
  await expect(dialog().getByTestId('result-headline')).toContainText('Imported 3 data modules', { timeout: 60_000 });
  await dialog().getByTestId('import-close').click();
  for (const f of [DESC, FAULT, PROC]) await expect(page.getByTestId('dm-list').locator(`[data-file="${f}"]`)).toBeVisible();

  // loose files
  await openDialog(pid);
  await dialog().getByTestId('import-pkg-files').setInputFiles(samplePackage().map((f) => ({ name: f.name, mimeType: 'application/xml', buffer: f.bytes })));
  await expect(dialog().getByTestId('selection-summary')).toContainText('4 files');
  await dialog().getByTestId('import-scan').click();
  await expect(dialog().getByTestId('tile-dms')).toContainText('3');
  await dialog().getByTestId('import-close').click();
});

test('a 700-graphic package is summarised, not listed: long lists show their first rows and a "Show all"', async () => {
  const many = Array.from({ length: 700 }, (_, i) => ({ name: `ICN-S1KSTUDIO-A-291000-A-${String(i).padStart(5, '0')}-00001-A-001-01.png`, bytes: PNG }));
  await openDialog(pid);
  await dialog().getByTestId('import-pkg-zip').setInputFiles(zipFile([...samplePackage(), ...many]));
  await dialog().getByTestId('import-scan').click();
  const report = dialog().getByTestId('import-report');
  await expect(report.getByTestId('tile-icns')).toContainText('700', { timeout: 60_000 });
  await expect(report.getByTestId('tile-files')).toContainText('704');
  await report.getByTestId('sec-files').getByRole('button', { name: /^Files/ }).click();
  const rows = report.getByTestId('report-files').locator('li');
  await expect(rows).toHaveCount(30);                                                      // not 704
  await expect(report.getByText('Showing 30 of 704 files.')).toBeVisible();
  await shot(page, '53-import-700');
  await report.getByTestId('report-files-all').click();
  await expect(rows).toHaveCount(704);
  await dialog().getByTestId('import-close').click();
});

test('a viewer does not see the import actions', async () => {
  const v = viewer.page;
  await v.goto(`/projects/${pid}/editor`);
  await expect(v.getByTestId('studio-host')).toBeVisible();
  await expect(v.getByTestId('dm-list').locator(`[data-file="${DESC}"]`)).toBeVisible();
  const side = v.getByRole('complementary', { name: 'Data modules' });
  await expect(side.getByRole('button', { name: 'Import package' })).toHaveCount(0);
  await expect(side.getByRole('button', { name: 'Import data modules and graphics' })).toHaveCount(0);
  // and the server agrees
  const r = await viewer.api.post(`/api/projects/${pid}/import/scan`, { multipart: { files: { name: PMC_NAME, mimeType: 'application/xml', buffer: Buffer.from('<x/>') } } });
  expect(r.status()).toBe(403);
});

test('no console errors came from the dialog', async () => {
  expect(consoleErrors).toEqual([]);
});
