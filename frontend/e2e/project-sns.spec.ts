// The Standard Numbering System in a project's Settings ("SNS" tab), as people meet it in the browser.
//
//   rows        add (a bad code is refused with the rule before anything is sent), see a problem next to its row, edit, change a code that has rows
//               below it (asks first, says how many), delete with cascade, a long SNS shows a page of rows at a time
//   import      the organisation defaults and the BREX: PREVIEW first (will add / already present / differs), then Apply; "replace titles that
//               differ" is off by default and needs a confirmation
//   learn       proposals with a confidence and a reason, a threshold, per-row ticks, "Apply N selected" - nothing is implied
//   derive      preview the publication structure, apply only after a confirmation that says what changes
//   ordering    edit the order of the sort keys and the pinned information codes
//   read-only   a viewer and a reviewer see no write controls and the server refuses them
//
// Self-contained: it makes its own people and projects. The modules for BREX import, learning and deriving are the SNS fixtures of the backend tests
// (backend/test/fixtures/sns), read, not changed.

import { test, expect, type Page, type APIRequestContext, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminApi, assign, newPerson, type Person } from './support/session';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, '..', '..', 'backend', 'test', 'fixtures', 'sns');
const shot = (p: Page, name: string) => p.screenshot({ path: `test-results/shots/${name}.png` });

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext;
let owner: Person; let viewer: Person; let reviewer: Person;
let page: Page; let api: APIRequestContext;
let pid = '';          // the project the rows are typed into
let mid = '';          // the project with data modules: BREX import, learning, deriving
const S = (id: string) => `/api/projects/${id}/sns-rows`;
const settingsUrl = (id: string, sub = 'rows') => `/projects/${id}/settings/sns/${sub}`;
const rowsOf = async (id: string, who: APIRequestContext = api): Promise<Array<Record<string, string>>> => (await (await who.get(S(id))).json()).rows;
const codeOf = (r: Record<string, string>) => [r.systemCode, `${r.subSystemCode}${r.subSubSystemCode}`, r.assyCode].filter(Boolean).join('-');
const titleOf = async (id: string, code: string, diff = ''): Promise<string | undefined> => (await rowsOf(id)).find((r) => codeOf(r) === code && r.systemDiffCode === diff)?.title;
const row = (p: Page, code: string, diff = ''): Locator => p.locator(`[data-testid="sns-row"][data-code="${code}"][data-diff="${diff}"]`);
const toast = (p: Page, text: string | RegExp): Locator => p.locator('.v2-toast', { hasText: text }).first();

async function fillForm(p: Page, f: Partial<Record<'systemDiffCode' | 'systemCode' | 'subSystemCode' | 'subSubSystemCode' | 'assyCode' | 'title', string>>) {
  for (const [k, v] of Object.entries(f)) await p.getByTestId(`sns-f-${k}`).fill(v);
}

async function loadFixture(a: APIRequestContext, id: string, dir: string) {
  for (const f of fs.readdirSync(path.join(FIX, dir))) {
    const r = await a.post(`/api/projects/${id}/dms`, { data: { file: f, xml: fs.readFileSync(path.join(FIX, dir, f), 'utf8') } });
    expect(r.status(), f).toBe(201);
  }
}

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await adminApi(baseURL);
  owner = await newPerson(admin, browser, baseURL, 'snsown', 'Sana Numbering');
  viewer = await newPerson(admin, browser, baseURL, 'snsview', 'Vik Viewer');
  reviewer = await newPerson(admin, browser, baseURL, 'snsrev', 'Rhea Reviewer');
  page = owner.page; api = owner.api;
  pid = (await (await api.post('/api/projects', { data: { name: 'SNS rows', pipeline: 's1000dtofo' } })).json()).project.id as string;
  mid = (await (await api.post('/api/projects', { data: { name: 'SNS modules', pipeline: 's1000dtofo' } })).json()).project.id as string;
  await assign(api, pid, viewer.username, 'viewer');
  await assign(api, pid, reviewer.username, 'reviewer');
});
test.afterAll(async () => { for (const p of [owner, viewer, reviewer]) await p.page.context().close(); await admin.dispose(); });

// ── rows ──────────────────────────────────────────────────────────────────

test('the SNS tab opens on an empty SNS and says what each code must look like', async () => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`/projects/${pid}/settings`);
  await page.getByRole('tab', { name: 'SNS', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/sns\/rows$/);
  await expect(page.getByTestId('sns-settings')).toBeVisible();
  await expect(page.getByTestId('sns-problem-summary')).toContainText('No rows');
  const rules = page.getByTestId('sns-rules');
  await expect(rules).toContainText('2 or 3 letters or digits');                       // the system code, as the server states it
  await expect(rules).toContainText('2 or 4 letters or digits');                       // the assembly code
  await expect(rules).toContainText('1 to 4 letters or digits');                       // the difference code
  for (const s of ['rows', 'import', 'learn', 'derive', 'ordering']) await expect(page.getByTestId(`sns-nav-${s}`)).toBeVisible();
  await expect(page.getByTestId('sns-add')).toBeVisible();
  await shot(page, '70-sns-empty');
  expect(errors).toEqual([]);
});

test('adding rows: a bad code is refused with its rule before anything is sent; good ones nest into the hierarchy', async () => {
  let posts = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith(S(pid))) posts++; });
  await page.getByTestId('sns-add').click();
  const form = page.getByTestId('sns-form');
  await expect(form).toBeVisible();

  await fillForm(page, { systemCode: 'A' });
  await expect(form).toContainText('System code "A" is not valid: it must be 2 or 3 letters or digits, upper case.');
  await expect(page.getByTestId('sns-save')).toBeDisabled();
  await fillForm(page, { systemCode: 'a05' });
  await expect(page.getByTestId('sns-f-systemCode')).toHaveValue('A05');              // lower case becomes upper case as it is typed
  await expect(form).not.toContainText('is not valid');
  await fillForm(page, { assyCode: '00' });
  await expect(form).toContainText('An assembly code needs a sub-system code and a sub-sub-system code.');
  await fillForm(page, { assyCode: '', subSystemCode: 'ab' });
  await expect(form).toContainText('Sub-system code "AB" is not valid');
  await fillForm(page, { subSystemCode: '' });
  await fillForm(page, { title: '   ' });
  await expect(form).toContainText('A title is required.');
  await expect(page.getByTestId('sns-save')).toBeDisabled();
  expect(posts, 'nothing was sent while the form was wrong').toBe(0);

  await fillForm(page, { title: 'System Maintenance Concept' });
  await expect(page.getByTestId('sns-f-level')).toContainText('system');
  await expect(page.getByTestId('sns-save')).toBeEnabled();
  await shot(page, '71-sns-form');
  await page.getByTestId('sns-save').click();
  await expect(toast(page, 'Added A05')).toBeVisible();
  await expect(form).toHaveCount(0);
  await expect(row(page, 'A05')).toContainText('System Maintenance Concept');
  expect(posts).toBe(1);

  // a row below it: the codes of the parent are already there; the new one appears and its parent opens
  await row(page, 'A05').getByTestId('sns-add-child').click();
  await expect(page.getByTestId('sns-f-systemCode')).toHaveValue('A05');
  await fillForm(page, { subSystemCode: '4', title: 'Preventive maintenance' });
  await page.getByTestId('sns-save').click();
  await expect(row(page, 'A05-4')).toContainText('Preventive maintenance');
  await row(page, 'A05-4').getByTestId('sns-add-child').click();
  await fillForm(page, { subSubSystemCode: '0', title: 'Preventive maintenance, general' });
  await page.getByTestId('sns-save').click();
  await expect(row(page, 'A05-40')).toBeVisible();
  await row(page, 'A05-40').getByTestId('sns-add-child').click();
  await fillForm(page, { assyCode: '100', title: 'Inspection' });
  await expect(page.getByTestId('sns-form')).toContainText('2 or 4 letters or digits');
  await fillForm(page, { assyCode: '10' });
  await page.getByTestId('sns-save').click();
  await expect(row(page, 'A05-40-10')).toContainText('Inspection');
  await expect(row(page, 'A05-40-10')).toHaveAttribute('data-level', 'assy');
  await expect(row(page, 'A05-40-10').getByTestId('sns-add-child')).toHaveCount(0);       // nothing hangs below an assembly
  await expect(page.getByTestId('sns-problem-summary')).toContainText('4 rows. No problems.');

  const kept = await rowsOf(pid);
  expect(kept.map(codeOf).sort()).toEqual(['A05', 'A05-4', 'A05-40', 'A05-40-10']);
  await shot(page, '72-sns-tree');
});

test('a duplicate is refused by the server and the reason is shown in the form', async () => {
  await page.getByTestId('sns-add').click();
  await fillForm(page, { systemCode: 'A05', title: 'Another name' });
  await page.getByTestId('sns-save').click();
  await expect(page.getByTestId('sns-form-error')).toContainText('A05 is already defined as "System Maintenance Concept"');
  await expect(page.getByTestId('sns-form')).toBeVisible();                              // the form stays, with what was typed
  await expect(page.getByTestId('sns-f-title')).toHaveValue('Another name');
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await rowsOf(pid)).toHaveLength(4);
});

test('a row whose parent is missing shows its problem next to it, and the problem goes when the parent is added', async () => {
  await page.getByTestId('sns-add').click();
  await fillForm(page, { systemCode: 'B07', subSystemCode: '1', title: 'Orphan sub-system' });
  await page.getByTestId('sns-save').click();
  await expect(toast(page, 'has no parent')).toBeVisible();                              // the server's warning at save time
  const orphan = row(page, 'B07-1');
  await expect(orphan).toBeVisible();
  await expect(orphan.getByTestId('sns-row-problem')).toContainText('B07-1 has no parent: B07 is not defined.');
  await expect(orphan.getByTestId('sns-row-problem')).toHaveAttribute('data-problem', 'ORPHAN');
  await expect(orphan).toHaveAttribute('data-problems', '1');
  await expect(row(page, 'A05')).toHaveAttribute('data-problems', '0');
  await expect(page.getByTestId('sns-problem-summary')).toContainText('1 warning');
  await expect(page.getByTestId('sns-problems')).toContainText('No parent');            // and in the list of all problems
  await shot(page, '73-sns-orphan');

  await page.getByTestId('sns-add').click();
  await fillForm(page, { systemCode: 'B07', title: 'System B07' });
  await page.getByTestId('sns-save').click();
  await expect(row(page, 'B07')).toBeVisible();
  await expect(page.getByTestId('sns-row-problem')).toHaveCount(0);
  await expect(page.getByTestId('sns-problem-summary')).toContainText('No problems');
});

test('editing a title just saves; editing a code with rows below asks first and says how many', async () => {
  await row(page, 'A05').getByTestId('sns-edit').click();
  await fillForm(page, { title: 'System maintenance' });
  await page.getByTestId('sns-save').click();
  await expect(toast(page, 'Saved A05')).toBeVisible();
  await expect(page.getByTestId('sns-cascade')).toHaveCount(0);                          // a title change moves nothing
  await expect(row(page, 'A05')).toContainText('System maintenance');
  expect(await titleOf(pid, 'A05')).toBe('System maintenance');

  // change the code of a row that has three below it
  await row(page, 'A05').getByTestId('sns-edit').click();
  await fillForm(page, { systemCode: 'A06' });
  await expect(page.getByTestId('sns-f-renames')).toContainText('3 rows sit below this one');
  await page.getByTestId('sns-save').click();
  await expect(page.getByTestId('sns-cascade')).toBeVisible();
  await expect(page.getByTestId('sns-cascade-count')).toHaveText('3 rows');
  await expect(page.getByTestId('sns-cascade')).toContainText('A05-4, A05-40 and A05-40-10');
  await expect(page.getByTestId('sns-cascade')).toContainText('Their titles are not changed');
  await shot(page, '74-sns-cascade');
  await page.getByTestId('sns-cascade-cancel').click();
  expect((await rowsOf(pid)).map(codeOf).sort(), 'cancelling changed nothing').toEqual(['A05', 'A05-4', 'A05-40', 'A05-40-10', 'B07', 'B07-1']);

  await page.getByTestId('sns-save').click();                                            // the form is still open: ask again, and go on
  await page.getByTestId('sns-cascade-confirm').click();
  await expect(toast(page, '3 rows below it changed with it')).toBeVisible();
  await expect(row(page, 'A06')).toBeVisible();
  await expect(row(page, 'A06-40-10')).toContainText('Inspection');
  await expect(row(page, 'A05')).toHaveCount(0);
  expect((await rowsOf(pid)).map(codeOf).sort()).toEqual(['A06', 'A06-4', 'A06-40', 'A06-40-10', 'B07', 'B07-1']);
});

test('delete: a row without rows below goes after one confirmation; one with rows below says how many go with it', async () => {
  for (const [systemCode, title, sub] of [['D10', 'Leaf system', ''], ['E11', 'Parent system', ''], ['E11', 'Child sub-system', '1']] as const) {
    expect((await api.post(S(pid), { data: { systemCode, subSystemCode: sub, title } })).status()).toBe(201);
  }
  await page.reload();
  await row(page, 'D10').getByTestId('sns-delete').click();
  await expect(page.getByTestId('sns-delete-dialog')).toContainText('No rows sit below it.');
  await expect(page.getByTestId('sns-delete-confirm')).toHaveText('Delete 1 row');
  await page.getByTestId('sns-delete-cancel').click();
  expect(await titleOf(pid, 'D10')).toBe('Leaf system');
  await row(page, 'D10').getByTestId('sns-delete').click();
  await page.getByTestId('sns-delete-confirm').click();
  await expect(toast(page, 'Deleted D10')).toBeVisible();
  await expect(row(page, 'D10')).toHaveCount(0);

  await row(page, 'E11').getByTestId('sns-delete').click();
  await expect(page.getByTestId('sns-delete-count')).toHaveText('1 row');
  await expect(page.getByTestId('sns-delete-dialog')).toContainText('E11-1');
  await expect(page.getByTestId('sns-delete-confirm')).toHaveText('Delete 2 rows');
  await shot(page, '75-sns-delete');
  await page.getByTestId('sns-delete-confirm').click();
  await expect(toast(page, 'Deleted E11 and 1 row below it')).toBeVisible();
  await expect(row(page, 'E11')).toHaveCount(0);
  await expect(row(page, 'E11-1')).toHaveCount(0);
  expect(await titleOf(pid, 'E11')).toBeUndefined();
  expect(await titleOf(pid, 'E11-1')).toBeUndefined();
});

test('a long SNS shows a page of rows at a time, and the search finds a row in all of them', async () => {
  const big = (await (await api.post('/api/projects', { data: { name: 'SNS long', pipeline: 's1000dtofo' } })).json()).project.id as string;
  const codes: string[] = [];
  for (const letter of ['X', 'Y']) for (let i = 0; i < 100; i++) codes.push(`${letter}${String(i).padStart(2, '0')}`);
  for (let i = 0; i < 60; i++) codes.push(`Z${String(i).padStart(2, '0')}`);
  for (let i = 0; i < codes.length; i += 20) {
    await Promise.all(codes.slice(i, i + 20).map(async (c) => expect((await api.post(S(big), { data: { systemCode: c, title: `Bulk system ${c}` } })).status()).toBe(201)));
  }
  await page.goto(settingsUrl(big));
  await expect(page.getByTestId('sns-problem-summary')).toContainText('260 rows');
  await expect(page.getByTestId('sns-row')).toHaveCount(100);                            // not 260 at once
  await expect(page.getByTestId('sns-more')).toContainText('Showing 100 of 260 rows.');
  await page.getByTestId('sns-more-more').click();
  await expect(page.getByTestId('sns-row')).toHaveCount(200);
  await page.getByTestId('sns-more-all').click();
  await expect(page.getByTestId('sns-row')).toHaveCount(260);
  await expect(page.getByTestId('sns-more')).toHaveCount(0);
  await page.getByTestId('sns-filter').fill('Z59');
  await expect(page.getByTestId('sns-row')).toHaveCount(1);
  await expect(row(page, 'Z59')).toContainText('Bulk system Z59');
  await page.getByTestId('sns-filter').fill('no such row');
  await expect(page.getByTestId('sns-table')).toHaveCount(0);
  await expect(page.getByText('Nothing matches')).toBeVisible();
});

// ── import ────────────────────────────────────────────────────────────────

test('import from the organisation defaults: preview first, what differs is kept, Apply adds; "replace titles" is off and needs a confirmation', async () => {
  // the organisation defaults: two rows the project lacks, and one that the project has under another title
  for (const r of [{ systemCode: '71', title: 'Power plant' }, { systemCode: '71', subSystemCode: '1', title: 'Compressor' }, { systemCode: 'A06', title: 'Maintenance concept (organisation)' }]) {
    const made = await admin.post('/api/sns/defaults', { data: r });
    expect([201, 409]).toContain(made.status());
  }
  const before = await rowsOf(pid);
  await page.goto(settingsUrl(pid, 'import'));
  const panel = page.getByTestId('sns-import-defaults');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('sns-import-defaults-overwrite')).not.toBeChecked();      // off by default
  await expect(panel).toContainText('Replace titles that differ');
  await expect(panel).toContainText('left exactly as it is');
  await expect(page.getByTestId('sns-import-defaults-apply')).toBeDisabled();             // nothing to apply before a preview

  await page.getByTestId('sns-import-defaults-preview').click();
  await expect(page.getByTestId('sns-import-defaults-result')).toBeVisible();
  const toAdd = Number(await page.getByTestId('sns-import-defaults-n-add').textContent());
  expect(toAdd).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('sns-import-defaults-n-differs')).toHaveText('1');
  await expect(page.getByTestId('sns-import-defaults-add')).toContainText('Will add');
  await expect(page.getByTestId('sns-import-defaults-add-list')).toContainText('Power plant');
  await expect(page.getByTestId('sns-import-defaults-differs')).toContainText('Differs (kept)');
  const differs = page.getByTestId('sns-import-defaults-differs-row');
  await expect(differs).toHaveCount(1);
  await expect(differs).toContainText('A06');
  await expect(differs).toContainText('In this project: “System maintenance”');
  await expect(differs).toContainText('Incoming, not applied: “Maintenance concept (organisation)”');
  await page.getByTestId('sns-import-defaults-same').getByRole('button').click();
  await expect(page.getByTestId('sns-import-defaults-same')).toContainText('already in this project with the same title');
  await shot(page, '76-sns-import-preview');
  expect(await rowsOf(pid), 'a preview writes nothing').toEqual(before);

  await expect(page.getByTestId('sns-import-defaults-apply')).toBeEnabled();
  await page.getByTestId('sns-import-defaults-apply').click();
  await expect(page.getByTestId('sns-import-defaults-done')).toContainText(`Added ${toAdd} rows`);
  await expect(page.getByTestId('sns-import-defaults-done')).toContainText('kept 1 different title');
  expect(await titleOf(pid, '71')).toBe('Power plant');
  expect(await titleOf(pid, '71-1')).toBe('Compressor');
  expect(await titleOf(pid, 'A06'), 'the author\'s own title is untouched').toBe('System maintenance');
  await expect(page.getByTestId('sns-nav-rows')).toContainText(`Rows (${before.length + toAdd})`);

  // the same again: nothing new, and the difference is still only reported
  await page.getByTestId('sns-import-defaults-preview').click();
  await expect(page.getByTestId('sns-import-defaults-n-add')).toHaveText('0');
  await expect(page.getByTestId('sns-import-defaults-n-differs')).toHaveText('1');
  await expect(page.getByTestId('sns-import-defaults-apply')).toBeDisabled();
  await expect(page.getByTestId('sns-import-defaults-nothing')).toContainText('kept as they are');
  // the rows that are already there are named, not only counted
  await page.getByTestId('sns-import-defaults-same').getByRole('button').first().click();
  await expect(page.locator('[data-testid="sns-import-defaults-same-row"][data-code="71"]')).toContainText('Power plant');
  await expect(page.locator('[data-testid="sns-import-defaults-same-row"][data-code="71-1"]')).toContainText('Compressor');

  // ticking the option makes that preview stale; a new preview names the titles that WILL be replaced; the confirmation can be declined
  await page.getByTestId('sns-import-defaults-overwrite').check();
  await expect(page.getByTestId('sns-import-defaults-stale')).toBeVisible();
  await expect(page.getByTestId('sns-import-defaults-apply')).toBeDisabled();
  await page.getByTestId('sns-import-defaults-preview').click();
  await expect(page.getByTestId('sns-import-defaults-differs')).toContainText('Differs (will be replaced)');
  await expect(page.getByTestId('sns-import-defaults-differs-row')).toContainText('Will become: “Maintenance concept (organisation)”');
  await page.getByTestId('sns-import-defaults-apply').click();
  await expect(page.getByRole('dialog', { name: 'Replace 1 title?' })).toBeVisible();
  await page.getByTestId('sns-import-defaults-confirm-cancel').click();
  expect(await titleOf(pid, 'A06')).toBe('System maintenance');
  await page.getByTestId('sns-import-defaults-apply').click();
  await page.getByTestId('sns-import-defaults-confirm').click();
  await expect(page.getByTestId('sns-import-defaults-done')).toContainText('replaced 1 title');
  expect(await titleOf(pid, 'A06')).toBe('Maintenance concept (organisation)');
});

test('the organisation defaults can be read on the Import page by a non-administrator, without any write control', async () => {
  await page.goto(settingsUrl(pid, 'import'));
  await page.getByTestId('sns-defaults-view').getByRole('button', { name: /Organisation defaults/ }).click();
  const ro = page.getByTestId('sns-defaults-ro-editor');
  await expect(ro).toBeVisible();
  await expect(ro.getByTestId('sns-defaults-ro-row').filter({ hasText: 'Power plant' })).toBeVisible();
  for (const id of ['add', 'add-child', 'edit', 'delete']) await expect(page.getByTestId(`sns-defaults-ro-${id}`)).toHaveCount(0);
  await expect(page.getByTestId('sns-defaults-view')).toContainText('Changing it needs a software administrator');
  expect((await api.post('/api/sns/defaults', { data: { systemCode: '72', title: 'x' } })).status()).toBe(403);
});

test('import from the BREX: the preview names the BREX it read, then Apply adds its rows', async () => {
  // a project without a BREX says so
  await page.goto(settingsUrl(pid, 'import'));
  await page.getByTestId('sns-import-brex-preview').click();
  await expect(page.getByTestId('sns-import-brex-sources')).toContainText('No BREX data module with SNS rules was found');

  await loadFixture(api, mid, 'brex');
  await page.goto(settingsUrl(mid, 'import'));
  await page.getByTestId('sns-import-brex-preview').click();
  await expect(page.getByTestId('sns-import-brex-sources')).toContainText('DMC-SNSTEST-A-00-00-00-00A-022A-D');
  await expect(page.getByTestId('sns-import-brex-n-add')).toHaveText('6');
  await expect(page.getByTestId('sns-import-brex-add-list')).toContainText('Shock strut');
  expect(await rowsOf(mid)).toHaveLength(0);
  await page.getByTestId('sns-import-brex-apply').click();
  await expect(page.getByTestId('sns-import-brex-done')).toContainText('Added 6 rows.');
  expect((await rowsOf(mid)).map((r) => r.title).sort()).toEqual(['Hydraulic power', 'Landing gear', 'Main gear', 'Main gear and doors', 'Nose gear and doors', 'Shock strut']);
});

// ── learn ─────────────────────────────────────────────────────────────────

test('learn from the modules: proposals carry a confidence and a reason; nothing is ticked, nothing is added until Apply selected', async () => {
  await loadFixture(api, mid, 'dms');
  const before = await rowsOf(mid);
  await page.goto(settingsUrl(mid, 'learn'));
  await expect(page.getByTestId('sns-learn-apply')).toHaveCount(0);                       // no table, nothing to apply, before a preview
  await page.getByTestId('sns-learn-preview').click();
  const table = page.getByTestId('sns-learn-table');
  await expect(table).toBeVisible();
  await expect(page.getByTestId('sns-learn-threshold')).toHaveValue('50');
  const rows = page.getByTestId('sns-learn-row');
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="sns-learn-row"]:not([data-status="new"])')).toHaveCount(0);   // the default view is the new nodes
  const five = page.locator('[data-testid="sns-learn-row"][data-code="32-5"]');
  await expect(five).toContainText('Landing gear indicating');
  await expect(five.getByTestId('sns-learn-confidence')).toHaveText(/^\d+%$/);
  await expect(five.getByTestId('sns-learn-basis')).not.toBeEmpty();
  for (const t of await page.getByTestId('sns-learn-tick').all()) await expect(t).not.toBeChecked();   // never ticked for the person
  await expect(page.getByTestId('sns-learn-apply')).toBeDisabled();
  await expect(page.getByTestId('sns-learn-apply')).toHaveText('Apply 0 selected');
  await shot(page, '77-sns-learn');
  expect(await rowsOf(mid), 'a preview writes nothing').toEqual(before);

  // the threshold: a ticked row that a higher threshold hides is not applied
  await page.getByTestId('sns-learn-threshold').fill('0');
  const first = rows.first();
  const confidence = Number(await first.getAttribute('data-confidence'));
  expect(confidence).toBeLessThan(1);
  const firstKey = await first.getAttribute('data-key');
  await first.getByTestId('sns-learn-tick').check();
  await expect(page.getByTestId('sns-learn-apply')).toHaveText('Apply 1 selected');
  await page.getByTestId('sns-learn-threshold').fill(String(Math.floor(confidence * 100) + 1));
  await expect(page.locator(`[data-testid="sns-learn-row"][data-key="${firstKey}"]`)).toHaveCount(0);
  await expect(page.getByTestId('sns-learn-hidden')).toContainText('hidden');
  await expect(page.getByTestId('sns-learn-apply')).toHaveText('Apply 0 selected');
  await expect(page.getByTestId('sns-learn-apply')).toBeDisabled();
  await page.getByTestId('sns-learn-threshold').fill('0');
  await expect(page.getByTestId('sns-learn-apply')).toHaveText('Apply 1 selected');       // shown again, still ticked
  await page.getByTestId('sns-learn-clear').click();
  await expect(page.getByTestId('sns-learn-apply')).toHaveText('Apply 0 selected');

  // accept exactly one
  await page.getByTestId('sns-learn-threshold').fill('50');
  await five.getByTestId('sns-learn-tick').check();
  await expect(page.getByTestId('sns-learn-apply')).toHaveText('Apply 1 selected');
  let sent: Record<string, unknown> | null = null;
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith(`${S(mid)}/learn`)) { const b = r.postDataJSON(); if (b.apply) sent = b; } });
  await page.getByTestId('sns-learn-apply').click();
  await expect(page.getByTestId('sns-learn-done')).toContainText('Added 1 row.');
  expect(sent).toMatchObject({ apply: true, minConfidence: 0.5 });
  expect((sent as unknown as { accept: string[] }).accept).toHaveLength(1);
  expect('acceptAll' in (sent as unknown as object)).toBe(false);
  const after = await rowsOf(mid);
  expect(after).toHaveLength(before.length + 1);
  expect(after.find((r) => codeOf(r) === '32-5')?.title).toBe('Landing gear indicating');
  await expect(page.getByTestId('sns-learn-table')).toHaveCount(0);                       // the preview is spent: make a new one
  await page.getByTestId('sns-learn-preview').click();
  await page.getByTestId('sns-learn-status').selectOption('exists');
  await expect(page.locator('[data-testid="sns-learn-row"][data-code="32-5"]')).toHaveAttribute('data-status', 'exists');
  await expect(page.locator('[data-testid="sns-learn-row"][data-code="32-5"]').getByTestId('sns-learn-tick')).toHaveCount(0);   // present rows cannot be ticked
});

// ── derive ────────────────────────────────────────────────────────────────

test('derive: preview the structure, the confirmation says what changes (placement included), Apply writes the publication', async () => {
  const pmCount = async () => (await (await api.get(`/api/projects/${mid}/pmc`)).json()).counts.dms as number;
  const had = await pmCount();
  await page.goto(settingsUrl(mid, 'derive'));
  await expect(page.getByTestId('sns-derive-apply')).toBeDisabled();
  await page.getByTestId('sns-derive-preview').click();
  await expect(page.getByTestId('sns-derive-result')).toBeVisible();
  await expect(page.getByTestId('sns-derive-n-dms')).toHaveText('15');                    // 16 modules, one is an older issue
  await expect(page.getByTestId('sns-derive-n-superseded')).toHaveText('1');
  await expect(page.getByTestId('sns-derive-header')).toBeVisible();
  const landing = page.locator('[data-testid="sns-struct-node"][data-code="32"]');
  await expect(landing).toContainText('Landing gear');
  await expect(page.locator('[data-testid="sns-struct-node"][data-level="unclassified"]')).toBeVisible();   // system 99 is not in the SNS
  await shot(page, '78-sns-derive-preview');
  expect(await pmCount(), 'a preview writes nothing').toBe(had);

  // changing an option makes the preview stale
  await page.getByTestId('sns-derive-placement').selectOption('unplaced');
  await expect(page.getByTestId('sns-derive-stale')).toBeVisible();
  await expect(page.getByTestId('sns-derive-apply')).toBeDisabled();
  await page.getByTestId('sns-derive-preview').click();
  await page.getByTestId('sns-derive-apply').click();
  const confirm = page.getByTestId('sns-derive-confirm-text');
  await expect(page.getByRole('dialog', { name: 'Change the publication structure?' })).toBeVisible();
  await expect(confirm).toHaveAttribute('data-placement', 'unplaced');
  await expect(confirm).toContainText('EXTENDED');
  await expect(confirm).toContainText('appended');
  await page.getByTestId('sns-derive-confirm-cancel').click();

  await page.getByTestId('sns-derive-placement').selectOption('replace');
  await page.getByTestId('sns-derive-preview').click();
  await expect(page.getByTestId('sns-derive-n-dms')).toHaveText('15');
  await page.getByTestId('sns-derive-apply').click();
  await expect(confirm).toHaveAttribute('data-placement', 'replace');
  await expect(confirm).toContainText('REPLACED');
  await expect(confirm).toContainText('backup');
  await shot(page, '79-sns-derive-confirm');
  await page.getByTestId('sns-derive-confirm-cancel').click();
  expect(await pmCount(), 'declining changed nothing').toBe(had);

  await page.getByTestId('sns-derive-apply').click();
  await page.getByTestId('sns-derive-confirm').click();
  await expect(page.getByTestId('sns-derive-done')).toContainText('The publication structure was written');
  await expect(page.getByTestId('sns-derive-done').getByRole('link', { name: 'Open the Publication page' })).toBeVisible();
  expect(await pmCount()).toBe(15);
  await expect(page.getByTestId('sns-derive-result')).toHaveCount(0);                     // the preview is spent
});

// ── ordering ──────────────────────────────────────────────────────────────

test('ordering: reorder the sort keys, pin an information code, save, reload, and reset', async () => {
  await page.goto(settingsUrl(mid, 'ordering'));
  const keys = page.getByTestId('sns-order-key');
  await expect(keys).toHaveCount(8);
  await expect(keys.first()).toHaveAttribute('data-key', 'sns');
  await expect(page.getByTestId('sns-order-groups')).toContainText('0xx');
  await expect(page.getByTestId('sns-order-groups')).toContainText('not edited here');
  await expect(page.getByTestId('sns-order-save')).toBeDisabled();                       // nothing changed
  await keys.nth(1).getByTestId('sns-order-up').click();
  await expect(keys.first()).toHaveAttribute('data-key', 'info');
  await page.getByTestId('sns-order-pin-first').fill('72');
  await expect(page.getByTestId('sns-order-errors')).toContainText('"72" is not an information code');
  await expect(page.getByTestId('sns-order-save')).toBeDisabled();
  await page.getByTestId('sns-order-pin-first').fill('720, 018');
  await page.getByTestId('sns-order-rank').fill('941 = 3');
  await expect(page.getByTestId('sns-order-errors')).toHaveCount(0);
  await page.getByTestId('sns-order-save').click();
  await expect(toast(page, 'Ordering saved')).toBeVisible();
  const info = (await (await api.get(`${S(mid)}/ordering`)).json());
  expect(info.override).toEqual({ keys: ['info', 'sns', 'infoVariant', 'disassy', 'location', 'language', 'issue', 'file'], pinFirst: ['720', '018'], rank: { '941': 3 } });
  await page.reload();
  await expect(page.getByTestId('sns-order-keys').locator('li').first()).toHaveAttribute('data-key', 'info');
  await expect(page.getByTestId('sns-order-pin-first')).toHaveValue('720, 018');
  await expect(page.getByTestId('sns-order-rank')).toHaveValue('941 = 3');
  await page.getByTestId('sns-order-reset').click();
  await expect(toast(page, 'reset to the standard')).toBeVisible();
  expect((await (await api.get(`${S(mid)}/ordering`)).json()).override).toBeNull();
  await expect(page.getByTestId('sns-order-keys').locator('li').first()).toHaveAttribute('data-key', 'sns');
  await expect(page.getByTestId('sns-order-pin-first')).toHaveValue('');
  await expect(page.getByTestId('sns-order-reset')).toHaveCount(0);
});

// ── who may do what ───────────────────────────────────────────────────────

for (const who of ['viewer', 'reviewer'] as const) {
  test(`a ${who} reads the SNS and sees no write controls; the server refuses what they could try`, async () => {
    const person = who === 'viewer' ? viewer : reviewer;
    const p = person.page;
    await p.goto(settingsUrl(pid));
    await expect(p.getByTestId('sns-readonly')).toContainText(`You have ${who} access`);
    await expect(p.getByTestId('sns-row').first()).toBeVisible();                           // the rows can be read
    await expect(row(p, 'A06')).toContainText('Maintenance concept (organisation)');
    for (const id of ['sns-add', 'sns-add-child', 'sns-edit', 'sns-delete']) await expect(p.getByTestId(id), id).toHaveCount(0);
    await expect(p.getByTestId('sns-editor')).toContainText('Changing it needs an editor, manager or owner');

    await p.goto(settingsUrl(pid, 'import'));
    await expect(p.getByTestId('sns-import-readonly')).toBeVisible();
    for (const id of ['sns-import-brex-preview', 'sns-import-defaults-preview', 'sns-import-defaults-apply', 'sns-import-defaults-overwrite']) await expect(p.getByTestId(id), id).toHaveCount(0);
    await p.goto(settingsUrl(pid, 'learn'));
    await expect(p.getByTestId('sns-learn-readonly')).toBeVisible();
    await expect(p.getByTestId('sns-learn-preview')).toHaveCount(0);
    await p.goto(settingsUrl(pid, 'derive'));
    await expect(p.getByTestId('sns-derive-readonly')).toBeVisible();
    await expect(p.getByTestId('sns-derive-preview')).toHaveCount(0);
    await p.goto(settingsUrl(pid, 'ordering'));
    await expect(p.getByTestId('sns-order-readonly')).toBeVisible();
    await expect(p.getByTestId('sns-order-keys')).toBeVisible();
    for (const id of ['sns-order-save', 'sns-order-up', 'sns-order-down', 'sns-order-reset']) await expect(p.getByTestId(id), id).toHaveCount(0);
    await expect(p.getByTestId('sns-order-pin-first')).toBeDisabled();

    const c = person.api;
    const before = await rowsOf(pid, c);
    expect((await c.post(S(pid), { data: { systemCode: 'Q99', title: 'nope' } })).status()).toBe(403);
    expect((await c.put(`${S(pid)}/${before[0].id}`, { data: { title: 'nope' } })).status()).toBe(403);
    expect((await c.delete(`${S(pid)}/${before[0].id}`)).status()).toBe(403);
    expect((await c.post(`${S(pid)}/import-defaults`, { data: { apply: true } })).status()).toBe(403);
    expect((await c.post(`${S(pid)}/derive`, { data: {} })).status()).toBe(403);
    expect((await c.post(`${S(pid)}/learn`, { data: {} })).status()).toBe(403);
    expect((await c.put(`${S(pid)}/ordering`, { data: { order: { pinFirst: ['720'] } } })).status()).toBe(403);
    expect(await rowsOf(pid, c)).toEqual(before);
  });
}
