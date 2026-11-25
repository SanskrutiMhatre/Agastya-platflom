// The two JSG editors in a real browser, against the real server: an author creates a User Handbook and an Illustrated Spare Parts List, edits each, saves, reloads (the work is
// still there), and the server builds the PDF with the JSG engine. Nothing is mocked: the editors, the picture chooser, the save, the schema check and the FOP render are all the real ones.

import { test, expect, request as pwRequest, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = 'Correct-Horse-9!';
const SHOTS = path.join('test-results', 'jsg-shots');
const ART = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend', 'schemas', 'jsg', 'engine', 'assets', 'firstaid-1.png');
let page: Page; let api: APIRequestContext; let uhb = ''; let ispl = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const who = `jsg${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username: who, fullName: 'Jsg Author', role: 'author' } });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, baseURL });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  api = ctx.request;
  expect((await api.post('/api/auth/login', { data: { username: who, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username: who, password: PW } })).ok()).toBeTruthy();
  for (const [name, type] of [['E2E JSG UHB', 'uhb'], ['E2E JSG ISPL', 'ispl']] as const) {
    const p = await api.post('/api/projects', { data: { name, format: 'jsg', domain: 'land', manualType: type } });
    expect(p.status()).toBe(201);
    if (type === 'uhb') uhb = (await p.json()).project.id; else ispl = (await p.json()).project.id;
  }
  await admin.dispose();
});
test.afterAll(async () => { await page.context().close(); });

const doc = async (id: string) => (await (await api.get(`/api/projects/${id}/jsg`)).json());
const state = () => page.getByTestId('jsg-state');

test('the New project wizard offers JSG with both types ready', async () => {
  const jsg = (await (await api.get('/api/formats')).json()).formats.find((f: any) => f.id === 'jsg');
  expect(jsg.ready).toBe(true);
  expect(jsg.domains[0].manualTypes.map((t: any) => [t.id, t.ready])).toEqual([['uhb', true], ['ispl', true]]);
});

// ── User Handbook ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('UHB: opens the JSG editor (not the Studio, not the JSS editor) with the stencil outline and numbering', async () => {
  await page.goto(`/projects/${uhb}/editor`);
  await expect(page.getByTestId('jsg-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.jsg-chapter .jsg-num').first()).toHaveText('CHAPTER 1');
  await expect(page.locator('.jsg-sectionh .jsg-num').first()).toHaveText('SECTION 1');
  await expect(page.locator('.jsg-clause .n').first()).toHaveText('1.1');
  await expect(page.locator('.jsg-chapter')).toHaveCount(5);
  await expect(page.getByTestId('studio-host')).toHaveCount(0);
  await expect(page.getByTestId('jss-paper')).toHaveCount(0);
  await expect(state()).toContainText('All changes saved');
  await page.screenshot({ path: path.join(SHOTS, 'uhb-1-open.png') });
});

test('UHB: edit a paragraph, a heading, a table and a list; Ctrl+S saves valid JSG XML', async () => {
  await expect(page.locator('.jsg-card h3')).toHaveText(['Cover and ancillary pages']);   // the cover and front pages live in the Ancillary pages dashboard
  const p = page.locator('.jsg-p').first(); await p.click(); await page.keyboard.type('This handbook describes the Modular Bridge.');
  await page.getByRole('tab', { name: 'Insert', exact: true }).click();                      // the toolbar is in tabs: Write, Insert, Table, Arrange, Document
  await page.locator('[data-cmd="heading"]').click();
  await page.locator('[data-cmd="table"]').click();
  await page.locator('[data-cmd="list"]').click(); await page.getByRole('menuitem', { name: /\(a\) \(b\) \(c\) lettered/ }).click();
  await expect(state()).toContainText('Unsaved');
  await page.keyboard.press('Control+s');
  await expect(state()).toContainText('Saved', { timeout: 15_000 });
  const d = await doc(uhb);
  expect(d.xml).toContain('This handbook describes the Modular Bridge.');
  expect(d.xml).toMatch(/<table [^>]*title=/); expect(d.xml).toContain('type="alpha"');
  expect(d.report.errors).toBe(0);
});

test('UHB: reload - the saved work is there; the PDF is built by the JSG engine', async () => {
  await page.reload();
  await expect(page.getByTestId('jsg-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('jsg-sheet')).toContainText('This handbook describes the Modular Bridge.');
  await page.getByTestId('jsg-generate').click();
  await expect(page.getByTestId('jsg-note')).toContainText('Built in', { timeout: 120_000 });
  const pdf = await api.get(`/api/projects/${uhb}/jsg/pdf`);
  expect(pdf.ok()).toBeTruthy(); expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.screenshot({ path: path.join(SHOTS, 'uhb-2-built.png') });
});

test('UHB: a problem is shown, not hidden - a draft that breaks the schema is saved and a PDF is refused', async () => {
  const d = await doc(uhb);
  const res = await api.put(`/api/projects/${uhb}/jsg`, { data: { xml: d.xml.replace('<meta>', '<meta><bogus/>'), baseHash: d.hash } });
  expect(res.ok()).toBeTruthy(); expect((await res.json()).report.errors).toBeGreaterThan(0);
  expect((await api.post(`/api/projects/${uhb}/jsg/build`)).status()).toBe(422);
  await api.put(`/api/projects/${uhb}/jsg`, { data: { xml: d.xml } });
});

// ── Illustrated Spare Parts List ─────────────────────────────────────────────────────────────────────────────────────────────

test('ISPL: opens the ISPL editor with the stencil preface, the tables and the first plate', async () => {
  await page.goto(`/projects/${ispl}/editor`);
  await expect(page.getByTestId('jsg-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('jsg-sheet').getByRole('heading', { name: 'Plates' })).toBeVisible();
  await expect(page.locator('.jsg-card h3')).toHaveText(['Cover and ancillary pages']);     // the cover and the front pages live in the Ancillary pages dashboard
  await expect(page.locator('.jsg-plate')).toHaveCount(1);
  await expect(page.locator('.jsg-plate header input.ref')).toHaveValue('I');
  await expect(page.getByTestId('studio-host')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'ispl-1-open.png') });
});

test('ISPL: add a plate with a picture and parts, paste rows; Ctrl+S saves valid JSG XML', async () => {
  // a sub-plate of the selected plate, with a picture uploaded through the chooser
  await page.locator('.jsg-plate').first().locator('header input.ref').click();
  await page.getByRole('button', { name: '+ Sub-plate' }).click();
  const plate = page.locator('.jsg-plate').nth(1);
  await expect(plate.locator('header input.ref')).toHaveValue('I-A');
  await plate.locator('header input.ttl').fill('Bridging System');
  await plate.getByLabel('"for 1 set" column').check();
  await plate.getByRole('button', { name: '+ picture' }).click();
  await page.locator('dialog input[type=file]').setInputFiles(ART);
  await expect(plate.locator('.jsg-view .pic img')).toHaveCount(1, { timeout: 20_000 });
  await plate.getByRole('button', { name: '+ part' }).click();
  await plate.locator('.jsg-grid tbody tr, .jsg-grid tr').nth(1).locator('input').nth(4).fill('PONTOON ASSY');
  page.once('dialog', (d) => void d.accept('02\tI-A/2\tP\t14/5420-72-058-7194\tDECK ASSY\t25\t28\tAIF4200000000\t\t205,920\t'));
  await plate.getByRole('button', { name: 'Paste rows' }).click();
  await expect(plate.locator('.jsg-grid tr')).toHaveCount(3);                                // header + 2 parts
  await page.keyboard.press('Control+s');
  await expect(state()).toContainText('Saved', { timeout: 15_000 });
  const d = await doc(ispl);
  expect(d.report.errors).toBe(0);
  expect(d.xml).toMatch(/<plate [^>]*ref="I-A"[^>]*title="Bridging System"[^>]*setColumn="true"/);
  expect(d.xml).toContain('designation="PONTOON ASSY"'); expect(d.xml).toContain('designation="DECK ASSY"');
  expect((d.xml.match(/<graphic /g) || []).length).toBe(1);
});

test('ISPL: the stencil-style page preview beside the grid shows the selected plate and follows every edit', async () => {
  const pv = page.getByTestId('jsg-preview');
  await expect(pv).toBeVisible();
  await expect(pv.locator('.jsg-pv-page').first()).toBeVisible();
  const plate = page.locator('.jsg-plate').nth(1);
  await plate.locator('header input.ttl').click();                                  // select plate I-A
  await expect(pv).toContainText('PLATE – I-A BRIDGING SYSTEM');
  await expect(pv).toContainText('PONTOON ASSY');
  await expect(pv.locator('.jsg-pv-page[data-kind="table"] th')).toHaveCount(11);   // the plate has the "for 1 set" column
  await expect(pv.locator('.jsg-pv-page[data-kind="picture"] img')).toHaveCount(1);
  await plate.locator('.jsg-grid tr').nth(1).locator('input').nth(4).fill('EDITED IN THE GRID');
  await expect(pv).toContainText('EDITED IN THE GRID');                              // the preview follows the grid
  await plate.locator('.jsg-grid tr').nth(1).locator('input').nth(4).fill('PONTOON ASSY');
  await page.locator('.jsg-plate').first().locator('header input.ttl').click();       // select plate I: its divider page and the index of sub-plates
  await expect(pv).toContainText('GENERAL ASSY OF EQUIPMENT NAME');
  await expect(pv.locator('.jsg-pv-page[data-kind="divider"]')).toHaveCount(1);
  await expect(pv.locator('.jsg-pv-page[data-kind="picture"]').first()).toContainText('Bridging System');
  await page.getByTestId('jsg-preview-toggle').click(); await expect(pv).toBeHidden();
  await page.getByTestId('jsg-preview-toggle').click(); await expect(pv).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, 'ispl-3-preview.png') });
  await page.keyboard.press('Control+s'); await expect(state()).toContainText('Saved', { timeout: 15_000 });
});

test('ISPL: reload - the plate, the picture and the parts are still there; the PDF is built by the JSG engine', async () => {
  await page.reload();
  await expect(page.getByTestId('jsg-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.jsg-plate')).toHaveCount(2);
  await expect(page.locator('.jsg-plate').nth(1).locator('.jsg-view .pic img')).toHaveCount(1);
  await expect(page.locator('.jsg-plate').nth(1).locator('.jsg-grid tr').nth(2).locator('input').nth(4)).toHaveValue('DECK ASSY');
  await page.getByTestId('jsg-generate').click();
  await expect(page.getByTestId('jsg-note')).toContainText('Built in', { timeout: 120_000 });
  const pdf = await api.get(`/api/projects/${ispl}/jsg/pdf`);
  expect(pdf.ok()).toBeTruthy(); expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.screenshot({ path: path.join(SHOTS, 'ispl-2-built.png') });
});

test('JSG sample and ancillary pages: create the sample from the button, tick pages off, edit a page, save; the document follows and the editor finds and undoes', async () => {
  test.setTimeout(120_000);                                                           // the sample is a 47,000-word handbook with 244 figures: opening it takes a while
  const t0 = Date.now(); const lap = (what: string) => console.log(`[sample] ${what}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.goto('/projects');
  await page.getByTestId('create-jsg-sample').first().click();
  await expect(page).toHaveURL(/\/projects\/[^/]+(\/editor)?$/, { timeout: 60_000 });
  const pid = page.url().split('/projects/')[1].split('/')[0]; const U = `/api/projects/${pid}`;
  // the rail has the page, and not the S1000D tabs that mean nothing here
  await expect(page.getByRole('link', { name: 'Explore' })).toHaveCount(0); await expect(page.getByRole('link', { name: 'Publication' })).toHaveCount(0);
  lap('sample created');
  await page.getByRole('link', { name: 'Ancillary pages' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${pid}/ancillary`));
  const rows = page.getByTestId('jsg-anc-row'); await expect(rows).toHaveCount(16);
  await expect(page.locator('[data-page="cover"] [data-testid="jsg-anc-print"]')).toBeDisabled();
  await expect(page.locator('[data-page="certificate"] [data-testid="jsg-anc-print"]')).toBeChecked();      // the sample is a filled handbook
  // switch two pages off and edit the warning page
  await page.locator('[data-page="demolition"] [data-testid="jsg-anc-print"]').uncheck();
  await page.locator('[data-page="listOfTables"] [data-testid="jsg-anc-print"]').uncheck();
  await expect(page.getByTestId('jsg-anc-save')).toBeEnabled();
  await page.locator('[data-page="warning"] .v2-anc-name').click();
  const first = page.getByTestId('jsg-anc-lines').getByRole('textbox').first();
  await expect(first).toHaveValue(/SWITCH OFF/i); await first.fill('E2E warning: keep clear of the launcher.');
  await page.getByTestId('jsg-anc-save').click();
  await expect(page.getByTestId('jsg-anc-save')).toBeDisabled({ timeout: 15_000 });                    // saved: nothing left to save
  const xml = (await (await api.get(`${U}/jsg`)).json()).xml as string;
  expect(xml).toMatch(/<front omit="[^"]*demolition[^"]*">/); expect(xml).toContain('listOfTables'); expect(xml).toContain('E2E warning: keep clear of the launcher.'); expect(xml).toContain('<demolition>');   // switched off, not deleted
  await page.screenshot({ path: path.join(SHOTS, 'jsg-ancillary.png') });
  // a page that is not in the handbook is added by ticking it
  await page.locator('[data-page="associated"] .v2-anc-name').click();
  await expect(page.getByTestId('jsg-anc-rows').getByRole('textbox').first()).toBeVisible();
  await page.locator('[data-page="associated"] [data-testid="jsg-anc-print"]').uncheck(); await page.locator('[data-page="associated"] [data-testid="jsg-anc-print"]').check();
  await expect(page.locator('[data-page="associated"] [data-testid="jsg-anc-print"]')).toBeChecked();

  // the editor: the real handbook opens, Find counts, Undo takes an edit back
  lap('ancillary done');
  await page.goto(`/projects/${pid}/editor`);
  await expect(page.getByTestId('jsg-sheet')).toBeVisible({ timeout: 60_000 });
  lap('editor open');
  await expect(page.getByTestId('jsg-status')).toContainText('words');
  await page.getByRole('button', { name: /^Find and replace/ }).click();
  await page.getByLabel('Find', { exact: true }).fill('Modular Bridge');
  await expect(page.locator('.jsg-find .cnt')).toHaveText(/^1 of \d+$/);
  lap('found');
  await page.keyboard.press('Escape');
  const para = page.locator('.jsg-p').first(); const before = (await para.textContent()) ?? '';
  await para.click(); await page.keyboard.press('End'); await page.keyboard.type(' EXTRA');
  await expect(para).toContainText('EXTRA'); await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(para).not.toContainText('EXTRA'); expect(((await para.textContent()) ?? '').trim()).toBe(before.trim());
});

test('ISPL sample and ancillary pages: create the sample, tick pages off, edit the preface and the amendments, save; the editor shows plates and appendices without the front pages', async () => {
  test.setTimeout(120_000);
  await page.goto('/projects');
  await page.getByTestId('create-jsg-ispl-sample').click();
  await expect(page).toHaveURL(/\/projects\/sample-jsg-illustrated/, { timeout: 60_000 });
  const pid = new URL(page.url()).pathname.split('/')[2];
  await page.getByRole('link', { name: 'Ancillary pages' }).click();
  const rows = page.getByTestId('jsg-anc-row');
  await expect(rows).toHaveCount(7);
  await expect(page.locator('[data-page="cover"] [data-testid="jsg-anc-print"]')).toBeDisabled();
  await expect(page.locator('[data-page="certificate"] [data-testid="jsg-anc-print"]')).toBeChecked();
  await page.locator('[data-page="supplied"] [data-testid="jsg-anc-print"]').uncheck();
  await page.locator('[data-page="preface"] .v2-anc-name').click();
  const first = page.getByLabel('Preface paragraph 1');
  await first.fill('1. EDITED PREFACE LINE.');
  await page.locator('[data-page="amendments"] .v2-anc-name').click();
  await page.getByRole('button', { name: 'Add amendment' }).click();
  await page.getByLabel('Authority, row 1').fill('HQ 123');
  await page.getByTestId('jsg-anc-save').click();
  await expect(page.getByTestId('jsg-anc-save')).toBeDisabled({ timeout: 20_000 });
  const d = await (await api.get(`/api/projects/${pid}/jsg`)).json();
  expect(d.xml).toMatch(/<front omit="[^"]*supplied/); expect(d.xml).toContain('EDITED PREFACE LINE'); expect(d.xml).toContain('authority="HQ 123"'); expect(d.report.errors).toBe(0);
  await page.goto(`/projects/${pid}/editor`);
  await expect(page.getByTestId('jsg-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.jsg-card h3')).toHaveText(['Cover and ancillary pages']);
  await expect(page.locator('.jsg-plate').first()).toBeVisible();
  await expect(page.getByTestId('jsg-status')).toContainText('appendices');
  await expect(page.locator('[id^="jsg-ap-"]')).toHaveCount(7);
});
