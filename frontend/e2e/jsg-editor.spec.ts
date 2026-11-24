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

test('UHB: edit the cover, a paragraph, a heading, a table and a list; Ctrl+S saves valid JSG XML', async () => {
  await page.locator('.jsg-card input').nth(3).fill('MODULAR BRIDGE');                      // Project name
  const p = page.locator('.jsg-p').first(); await p.click(); await page.keyboard.type('This handbook describes the Modular Bridge.');
  await page.getByRole('button', { name: '+ Heading' }).click();
  await page.getByRole('button', { name: '+ Table' }).click();
  await page.getByRole('button', { name: '+ (a) list' }).click();
  await expect(state()).toContainText('Unsaved');
  await page.keyboard.press('Control+s');
  await expect(state()).toContainText('Saved', { timeout: 15_000 });
  const d = await doc(uhb);
  expect(d.xml).toContain('<projectName>MODULAR BRIDGE</projectName>'); expect(d.xml).toContain('This handbook describes the Modular Bridge.');
  expect(d.xml).toMatch(/<table [^>]*title=/); expect(d.xml).toContain('type="alpha"');
  expect(d.report.errors).toBe(0);
});

test('UHB: reload - the saved work is there; the PDF is built by the JSG engine', async () => {
  await page.reload();
  await expect(page.getByTestId('jsg-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('jsg-sheet')).toContainText('This handbook describes the Modular Bridge.');
  await expect(page.locator('.jsg-card input').nth(3)).toHaveValue('MODULAR BRIDGE');
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
  await expect(page.locator('.jsg-card h3')).toContainText(['Cover', 'Certificate', 'Preface', 'Amendments', 'Abbreviations', 'List of equipment already supplied against AT/SO']);
  await expect(page.getByTestId('jsg-sheet')).toContainText('Queries relating to this ISPL');
  await expect(page.locator('.jsg-plate')).toHaveCount(1);
  await expect(page.locator('.jsg-plate header input.ref')).toHaveValue('I');
  await expect(page.getByTestId('studio-host')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, 'ispl-1-open.png') });
});

test('ISPL: edit the cover, add a plate with a picture and parts, paste rows; Ctrl+S saves valid JSG XML', async () => {
  const inputs = page.locator('.jsg-card').first().locator('input');
  await inputs.nth(1).fill('ILLUSTRATED SPARE PARTS LIST (ISPL)');
  await page.locator('.jsg-card').first().getByPlaceholder('for 100m').fill('for 100m');
  await page.locator('.jsg-card').first().locator('input').nth(0).fill('CQAE/IL/14/27/A');
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
  expect(d.xml).toContain('<qtyUnit>for 100m</qtyUnit>');
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
