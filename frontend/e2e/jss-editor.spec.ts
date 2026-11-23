// The JSS editor in a real browser, against the real server: an author opens a new User Handbook, writes in it, saves it as XML, and the server builds
// the PDF from that XML. Nothing here is mocked: the sheet, the toolbar, the dialogs, the save, the schema check and the FOP render are all the real ones.

import { test, expect, request as pwRequest, type Page, type APIRequestContext } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PW = 'Correct-Horse-9!';
const SHOTS = path.join('test-results', 'jss-shots');
let page: Page; let api: APIRequestContext; let pid = ''; let U = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const who = `jss${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username: who, fullName: 'Jss Author', role: 'author' } });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, baseURL });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  api = ctx.request;
  expect((await api.post('/api/auth/login', { data: { username: who, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username: who, password: PW } })).ok()).toBeTruthy();
  const p = await api.post('/api/projects', { data: { name: 'E2E User Handbook', format: 'jss', domain: 'land', manualType: 'uhb' } });
  expect(p.status()).toBe(201);
  pid = (await p.json()).project.id; U = `/api/projects/${pid}`;
  await admin.dispose();
});
test.afterAll(async () => { await page.context().close(); });

const sheet = () => page.getByTestId('jss-paper');
const state = () => page.getByTestId('jss-state');
const saved = async () => (await (await api.get(`${U}/jss`)).json());

test('the catalogue offers the 15 stencil types: three ready, and the rest explained', async () => {
  const types = (await (await api.get('/api/formats')).json()).formats.find((f: any) => f.id === 'jss').domains.find((d: any) => d.id === 'land').manualTypes;
  expect(types).toHaveLength(15); expect(types.filter((t: any) => t.ready).map((t: any) => t.id)).toEqual(['uhb', 'mm', 'orm']);
  for (const t of types.filter((x: any) => !x.ready)) expect(t.notReady.length).toBeGreaterThan(20);
});

test('opening a JSS project opens the JSS editor, with the stencil chapters locked and the outline beside the sheet', async () => {
  await page.goto(`/projects/${pid}/editor`);
  await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await expect(sheet().locator('.jss-ch-no')).toHaveText(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5', 'Chapter 6', 'Chapter 7']);
  await expect(sheet().locator('.jss-ch-title').first()).toContainText('Leading Particulars and General Data');
  await expect(sheet().locator('.jss-ch-title [contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('.jss-ol').first()).toContainText('Leading Particulars');
  await expect(page.locator('[data-testid="studio-host"]')).toHaveCount(0);           // not the S1000D Studio
  await expect(page.getByRole('link', { name: 'Explore' })).toHaveCount(0);            // an S1000D publication tree has no place here
  await expect(state()).toHaveText('Saved');
  await page.screenshot({ path: path.join(SHOTS, '1-opened.png') });
});

test('writing: a paragraph with bold text, a list that nests, a captioned table, a note, a cross-reference', async () => {
  const purpose = sheet().locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
  await purpose.locator('.jss-empty').click();                                         // "Click to add text here"
  await page.keyboard.type('The system gives ');
  await page.keyboard.press('Control+b'); await page.keyboard.type('early warning'); await page.keyboard.press('Control+b');
  await page.keyboard.type(' of low-level threats.');
  await expect(state()).toHaveText('Unsaved changes');

  // a lettered list: Enter adds items, Tab nests one
  await page.getByRole('button', { name: 'Add or change a list' }).click();
  await page.getByRole('menuitem', { name: /New list: \(a\) \(b\) \(c\) lettered/ }).click();
  await page.keyboard.type('Search radar'); await page.keyboard.press('Enter'); await page.keyboard.type('Tracks 8 targets'); await page.keyboard.press('Enter');
  await page.keyboard.type('in all weather'); await page.keyboard.press('Tab');
  await expect(sheet().locator('.jss-li-label')).toHaveText(['(a)', '(b)', '(i)']);

  // a table through its dialog
  await page.getByRole('button', { name: 'Insert a table' }).click();
  const dlg = page.locator('.jss-dialog');
  await dlg.locator('input[type="text"]').fill('Technical Specifications');
  await dlg.locator('input[type="number"]').nth(0).fill('2'); await dlg.locator('input[type="number"]').nth(1).fill('3');
  await dlg.getByRole('button', { name: 'Insert table' }).click();
  await expect(sheet().locator('.jss-cap .no').first()).toHaveText('Table 1-1: ');
  const cells = sheet().locator('td [data-edit]');
  await cells.nth(0).click(); await page.keyboard.type('Sl. No.'); await page.keyboard.press('Tab'); await page.keyboard.type('Attribute'); await page.keyboard.press('Tab'); await page.keyboard.type('Specification');
  await page.keyboard.press('Tab'); await page.keyboard.type('1'); await page.keyboard.press('Tab'); await page.keyboard.type('Weight'); await page.keyboard.press('Tab'); await page.keyboard.type('2400 kg');

  // a note
  await page.getByRole('button', { name: 'Insert a note, warning or caution' }).click();
  await page.getByRole('menuitem', { name: 'Note' }).click();
  await page.keyboard.type('Keep the plate clean.');

  // a cross-reference to the table, inserted inside the first paragraph
  await sheet().locator('.jss-para').first().click({ position: { x: 20, y: 6 } });
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Refer to a table, figure or section' }).click();
  await page.locator('.jss-dialog .list button', { hasText: 'Table 1-1' }).click();
  await page.locator('.jss-dialog').getByRole('button', { name: 'Insert' }).click();
  await expect(sheet().locator('.jss-xref').first()).toHaveText('Table 1-1');
  await page.screenshot({ path: path.join(SHOTS, '2-written.png') });
});

test('saving writes the XML: it is the project\'s source, valid against the schema, and holds exactly what was written', async () => {
  await page.keyboard.press('Control+s');
  await expect(state()).toHaveText(/^Saved/, { timeout: 15_000 });
  const d = await saved();
  expect(d.report.errors).toBe(0);
  expect(d.xml).toContain('<jssbook docType="uhb" schemaVersion="1.0">');
  expect(d.xml).toContain('The system gives <b>early warning</b> of low-level threats.<xref to=');
  expect(d.xml).toMatch(/<list type="alpha">\s*<item>Search radar<\/item>\s*<item>Tracks 8 targets<list>\s*<item>in all weather<\/item>\s*<\/list><\/item>/);
  expect(d.xml).toMatch(/<table id="[^"]+">\s*<title>Technical Specifications<\/title>/); expect(d.xml).toContain('<cell>2400 kg</cell>');
  expect(d.xml).toContain('<note>'); expect(d.xml).toContain('Keep the plate clean.');
});

test('a reload shows the same document; undo goes back through what was written', async () => {
  await page.reload();
  await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await expect(sheet().locator('.jss-para').first()).toContainText('The system gives early warning of low-level threats.');
  await expect(sheet().locator('.jss-para b').first()).toHaveText('early warning');
  await expect(sheet().locator('.jss-cap .no').first()).toHaveText('Table 1-1: ');
  // undo the last change (a new paragraph), then redo it
  await sheet().locator('.jss-para').first().click(); await page.keyboard.press('Enter');
  const paras = await sheet().locator('.jss-block[data-kind="para"]').count();
  await page.keyboard.press('Control+z');
  await expect(sheet().locator('.jss-block[data-kind="para"]')).toHaveCount(paras - 1);
  await page.keyboard.press('Control+y');
  await expect(sheet().locator('.jss-block[data-kind="para"]')).toHaveCount(paras);
  await page.keyboard.press('Control+z');                                               // leave the document as it was saved
});

test('Generate PDF builds the publication from the saved XML on the server, and the PDF says what was written', async () => {
  await page.getByTestId('jss-generate').click();
  await expect(page.getByTestId('jss-note')).toContainText(/Built in/, { timeout: 120_000 });
  const res = await api.get(`${U}/publish/pdf`); expect(res.ok()).toBeTruthy();
  const buf = await res.body(); expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jss-e2e-')), 'out.pdf'); fs.writeFileSync(f, buf);
  const t = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
  if (!t.error) {
    const flat = t.stdout.replace(/\s+/g, ' ');
    expect(flat).toContain('The system gives early warning of low-level threats'); expect(flat).toContain('Table 1-1: Technical Specifications'); expect(flat).toMatch(/low-level threats\.\s*Table 1-1/);                 // the cross-reference resolved to the table's number
    expect(flat).toMatch(/\(a\) Search radar/); expect(flat).toMatch(/\(i\) in all weather/); expect(flat).toContain('2400 kg'); expect(flat).toMatch(/keep the plate clean/i);
    expect(flat).toContain('USER HANDBOOK');
  }
  await expect(page.locator('[data-testid="pdf-pane"] canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS, '3-generated.png') });
});

test('a problem the schema or the stencil finds is marked on the sheet and listed, the PDF is refused, and fixing it clears it', async () => {
  // damage the document the way another tool or a hand edit could: one table row loses a cell
  const d = await saved();
  const broken = d.xml.replace('<cell>2400 kg</cell>', '');
  expect(broken).not.toBe(d.xml);
  expect((await api.put(`${U}/jss`, { data: { xml: broken, baseHash: d.hash } })).ok()).toBeTruthy();
  await page.reload(); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('jss-problems')).not.toContainText('Problems: 0 errors');
  await expect(page.locator('.jss-pr').filter({ hasText: 'JSS-TABLE-SHAPE' })).toBeVisible();
  await expect(sheet().locator('.jss-has-error').first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '4-problem.png') });
  await page.locator('.jss-pr').filter({ hasText: 'JSS-TABLE-SHAPE' }).click();         // goes to the table
  // the server refuses to build, says why, and the page lists it
  await page.getByTestId('jss-generate').click();
  await expect(page.getByTestId('jss-note')).toContainText(/was not built/, { timeout: 30_000 });
  // the fix: the cell comes back
  expect((await api.put(`${U}/jss`, { data: { xml: d.xml, baseHash: (await saved()).hash } })).ok()).toBeTruthy();
  await page.reload(); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('jss-problems')).toContainText('Problems: 0 errors');
});

test('merging cells: Merge right and Merge down in the browser, saved as colspan / rowspan, built into the PDF, and split again', async () => {
  await page.goto(`/projects/${pid}/editor`); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  const cells = sheet().locator('tbody td [data-edit]');
  await cells.nth(0).click(); await page.getByRole('button', { name: 'Merge right', exact: true }).click();
  await expect(sheet().locator('tbody tr').first().locator('td')).toHaveCount(2);
  await expect(sheet().locator('tbody tr').first().locator('td').first()).toHaveAttribute('colspan', '2');
  await sheet().locator('tbody tr').first().locator('td').nth(1).locator('[data-edit]').click();
  await page.getByRole('button', { name: 'Merge down', exact: true }).click();
  await expect(sheet().locator('tbody tr').first().locator('td').nth(1)).toHaveAttribute('rowspan', '2');
  await page.keyboard.press('Control+s'); await expect(state()).toHaveText(/^Saved/, { timeout: 15_000 });
  const d = await saved(); expect(d.report.errors).toBe(0);
  expect(d.xml).toContain('colspan="2"'); expect(d.xml).toContain('rowspan="2"');
  await page.getByTestId('jss-generate').click(); await expect(page.getByTestId('jss-note')).toContainText(/Built in/, { timeout: 120_000 });
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jss-e2e-')), 'm.pdf'); fs.writeFileSync(f, await (await api.get(`${U}/publish/pdf`)).body());
  const t = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); if (!t.error) expect(t.stdout).toContain('Sl. No.');
  // the structure buttons say why they are off, and Split cell puts the grid back (the table's tools show while a cell has focus)
  await sheet().locator('tbody tr').first().locator('td').first().locator('[data-edit]').click();
  await expect(page.getByRole('button', { name: '+ Row below', exact: true })).toBeDisabled();
  await expect(sheet().locator('.jss-ttools .hint').first()).toContainText('split them to add or remove rows and columns');
  await sheet().locator('tbody tr').first().locator('td').nth(1).locator('[data-edit]').click(); await page.getByRole('button', { name: 'Split cell', exact: true }).click();
  await sheet().locator('tbody tr').first().locator('td').first().locator('[data-edit]').click(); await page.getByRole('button', { name: 'Split cell', exact: true }).click();
  await expect(sheet().locator('tbody tr').first().locator('td')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '+ Row below', exact: true })).toBeEnabled();
  await page.screenshot({ path: path.join(SHOTS, '5-merged.png') });
});

test('content order: a document whose content follows a sub-section opens as unsaved with an explanation, the problem is listed, and saving writes it in order', async () => {
  const d = await saved();
  const late = d.xml.replace(/(<section id="[^"]+"><title>Purpose<\/title>)/, '$1<section id="zsub"><title>Zeta sub-section</title></section><para>Content after the sub-section</para>');
  expect(late).not.toBe(d.xml);
  const put = await api.put(`${U}/jss`, { data: { xml: late, baseHash: d.hash } }); expect(put.ok()).toBeTruthy();
  expect((await put.json()).report.findings.some((f: { rule: string }) => f.rule === 'JSS-ORDER')).toBe(true);
  await page.reload(); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await expect(state()).toHaveText('Unsaved changes');
  await expect(page.getByText(/had content after a sub-section/)).toBeVisible();
  const paras = await sheet().locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) }).first().locator('.jss-para').allTextContents();
  expect(paras.join(' ')).toContain('Content after the sub-section');                       // drawn in the section's own content, ahead of the sub-section
  await page.keyboard.press('Control+s').catch(() => undefined); await sheet().locator('.jss-para').first().click(); await page.keyboard.press('Control+s');
  await expect(state()).toHaveText(/^Saved/, { timeout: 15_000 });
  const after = await saved(); expect(after.report.errors).toBe(0);
  expect(after.xml.indexOf('Content after the sub-section')).toBeLessThan(after.xml.indexOf('Zeta sub-section'));
  expect(after.xml.indexOf('Content after the sub-section')).toBeGreaterThan(0);
});

test('a second author\'s save is not overwritten silently: the stale save is refused and offers the saved document', async () => {
  await page.goto(`/projects/${pid}/editor`); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  const d = await saved();
  expect((await api.put(`${U}/jss`, { data: { xml: d.xml.replace('Search radar', 'Search radar (long range)'), baseHash: d.hash } })).ok()).toBeTruthy();   // someone else saves
  await sheet().locator('.jss-para').first().click(); await page.keyboard.type(' more');
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Someone else saved this document/)).toBeVisible({ timeout: 15_000 });
  page.once('dialog', (dlg) => void dlg.accept());
  await page.getByRole('button', { name: 'Reload the saved document' }).click();
  await expect(sheet().locator('.jss-li').first()).toContainText('Search radar (long range)');
  await expect(state()).toHaveText('Saved');
});

test('the S1000D Studio is untouched: an S1000D project still opens the Studio', async () => {
  const s = await api.post('/api/projects', { data: { name: 'E2E S1000D', format: 's1000d' } }); expect(s.status()).toBe(201);
  await page.goto(`/projects/${(await s.json()).project.id}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('jss-editor')).toHaveCount(0);
});
