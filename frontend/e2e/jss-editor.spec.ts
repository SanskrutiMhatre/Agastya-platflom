// The JSS editor in a real browser, against the real server: an author opens a new User Handbook, writes in it, saves it as XML, and the server builds
// the PDF from that XML. Nothing here is mocked: the sheet, the toolbar, the dialogs, the save, the schema check and the FOP render are all the real ones.
// Phase 3 / Phase 8: the editor opens the book live (co-editing): every change reaches the server as it is typed ("Saved", never "Unsaved
// changes"), Save writes the file through the room. The stale-save refusal belongs to the classic editor (the fallback when the room
// cannot be joined, C24): that test opens the book on a page whose joins are answered DISABLED (support/live.ts).

import { test, expect, request as pwRequest, type Page, type APIRequestContext } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { classicOnly } from './support/live';

// The PDF is read with the backend tests' pdf.js helper (backend/test/pdftools.js): no pdftotext needed. The checks below used to be skipped
// silently when pdftotext was missing (`if (!t.error)`), which on Windows was always (WP-08, QA-003).
const { pdfText } = createRequire(import.meta.url)('../../backend/test/pdftools.js') as { pdfText: (src: Buffer) => Promise<string> };

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
/** The toolbar is in tabs (Write, Insert, Arrange, Document): open the one that holds the button. */
const tab = (name: string) => page.getByRole('tab', { name, exact: true }).click();
const saved = async () => (await (await api.get(`${U}/jss`)).json());
/** a second page of the same person whose editor saves by version (its joins are answered DISABLED) */
const cpage = async (): Promise<Page> => { const p = await page.context().newPage(); p.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); }); await classicOnly(p); return p; };

test('the catalogue offers the 18 types of the JSS catalogue, all ready', async () => {
  const types = (await (await api.get('/api/formats')).json()).formats.find((f: any) => f.id === 'jss').domains.find((d: any) => d.id === 'land').manualTypes;
  expect(types).toHaveLength(18); expect(types.filter((t: any) => !t.ready)).toEqual([]);
  expect(types.map((t: any) => t.id)).toEqual(expect.arrayContaining(['tm-pi', 'tm-pi-vol-2', 'vol-1-pl', 'vol-2-illustrations', 'ces', 'fis', 'bis']));
});

test('opening a JSS project opens the JSS editor, with the stencil chapters locked and the outline beside the sheet', async () => {
  await page.goto(`/projects/${pid}/editor`);
  await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await expect(sheet().locator('.jss-ch-no')).toHaveText(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5', 'Chapter 6', 'Chapter 7']);
  await expect(sheet().locator('.jss-ch-title').first()).toContainText('Leading Particulars and General Data');
  await expect(sheet().locator('.jss-ch-title [contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('.jss-ol').first()).toContainText('Leading Particulars');
  await expect(page.locator('[data-testid="studio-host"]')).toHaveCount(0);           // not the S1000D Studio
  await expect(page.getByRole('link', { name: 'Explore' })).toBeVisible(); await expect(page.getByRole('link', { name: 'Publication' })).toBeVisible();   // the document's codes have their own pages (doc-pages.spec.ts)
  await expect(page.getByTestId('doc-codes-strip')).toHaveCount(0);                    // and are never a strip on the editor page
  await expect(state()).toHaveText(/^Saved/, { timeout: 20_000 });                      // live: the server has every change
  await page.screenshot({ path: path.join(SHOTS, '1-opened.png') });
});

test('writing: a paragraph with bold text, a list that nests, a captioned table, a note, a cross-reference', async () => {
  const purpose = sheet().locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
  await purpose.locator('.jss-empty').click();                                         // "Click to add text here"
  await page.keyboard.type('The system gives ');
  await page.keyboard.press('Control+b'); await page.keyboard.type('early warning'); await page.keyboard.press('Control+b');
  await page.keyboard.type(' of low-level threats.');
  await expect(state()).toHaveText(/^(Saved|Syncing)/);                                 // live: sent as it is typed
  await expect(state()).not.toHaveText(/Unsaved changes/);

  // a lettered list: Enter adds items, Tab nests one
  await tab('Insert'); await page.getByRole('button', { name: 'Add or change a list' }).click();
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
  await tab('Write'); await page.getByRole('button', { name: 'Refer to a table, figure or section' }).click();
  await page.locator('.jss-dialog .list button', { hasText: 'Table 1-1' }).click();
  await page.locator('.jss-dialog').getByRole('button', { name: 'Insert' }).click();
  await expect(sheet().locator('.jss-xref').first()).toHaveText('Table 1-1');
  await page.screenshot({ path: path.join(SHOTS, '2-written.png') });
});

test('saving writes the XML: it is the project\'s source, valid against the schema, and holds exactly what was written', async () => {
  await page.keyboard.press('Control+s');
  await expect(state()).toHaveText(/Saved/, { timeout: 15_000 });
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
  {
    const flat = (await pdfText(buf)).replace(/\s+/g, ' ');
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
  await page.keyboard.press('Control+s'); await expect(state()).toHaveText(/Saved/, { timeout: 15_000 });
  const d = await saved(); expect(d.report.errors).toBe(0);
  expect(d.xml).toContain('colspan="2"'); expect(d.xml).toContain('rowspan="2"');
  await page.getByTestId('jss-generate').click(); await expect(page.getByTestId('jss-note')).toContainText(/Built in/, { timeout: 120_000 });
  expect(await pdfText(await (await api.get(`${U}/publish/pdf`)).body())).toContain('Sl. No.');
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

// classic (the fallback): the document opens as unsaved, with the explanation, and Save writes it in order. live (the default): the room
// holds the book as the model reads it (yjss loadDoc/reconcileDoc from parseJss: content first), so it opens in that order with nothing
// unsent ("Saved", no explanation needed), and Save writes the file in that order.
for (const mode of ['live', 'classic'] as const) {
  test(`content order (${mode}): a document whose content follows a sub-section is drawn in print order and saving writes it in order`, async () => {
    const p = mode === 'live' ? page : await cpage();
    const d = await saved();
    const late = d.xml.replace(/(<section id="[^"]+"><title>Purpose<\/title>)/, `$1<section id="zsub${mode}"><title>Zeta sub-section ${mode}</title></section><para>Content after the sub-section ${mode}</para>`);
    expect(late).not.toBe(d.xml);
    const put = await api.put(`${U}/jss`, { data: { xml: late, baseHash: d.hash } }); expect(put.ok()).toBeTruthy();
    expect((await put.json()).report.findings.some((f: { rule: string }) => f.rule === 'JSS-ORDER')).toBe(true);
    if (mode === 'live') await p.reload(); else await p.goto(`/projects/${pid}/editor`);
    await expect(p.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
    await expect(p.getByTestId('jss-state')).toHaveText(mode === 'live' ? /^Saved/ : /Unsaved changes/, { timeout: 20_000 });
    if (mode === 'classic') await expect(p.getByText(/had content after a sub-section/)).toBeVisible();
    const purpose = p.getByTestId('jss-paper').locator('.jss-sec').filter({ has: p.locator('.jss-sec-title', { hasText: 'Purpose' }) }).first();
    await expect.poll(async () => (await purpose.locator('.jss-para').allTextContents()).join(' '), { timeout: 15_000 }).toContain(`Content after the sub-section ${mode}`);   // drawn in the section's own content, ahead of the sub-section
    await p.keyboard.press('Control+s').catch(() => undefined); await p.getByTestId('jss-paper').locator('.jss-para').first().click(); await p.keyboard.press('Control+s');
    await expect(p.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 15_000 });
    await expect.poll(async () => { const x = (await saved()).xml as string; const c = x.indexOf(`Content after the sub-section ${mode}`); return c > 0 && c < x.indexOf(`Zeta sub-section ${mode}`); }, { timeout: 15_000 }).toBeTruthy();
    expect((await saved()).report.errors).toBe(0);
    if (p !== page) await p.close();
  });
}

test('a second author\'s save is not overwritten silently: the stale save is refused and offers the saved document (classic)', async () => {
  // a live book merges the other save instead (wp05 FE-007 live); a refusal is the classic editor's
  const page = await cpage();
  await page.goto(`/projects/${pid}/editor`); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  const d = await saved();
  expect((await api.put(`${U}/jss`, { data: { xml: d.xml.replace('Search radar', 'Search radar (long range)'), baseHash: d.hash } })).ok()).toBeTruthy();   // someone else saves
  await page.getByTestId('jss-paper').locator('.jss-para').first().click(); await page.keyboard.type(' more');
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Someone else saved this document/)).toBeVisible({ timeout: 15_000 });
  // WP-05 (FE-007): the refused save keeps the author's text; opening the other version asks first, in the platform's dialog
  await expect(page.getByTestId('conflict-download')).toBeVisible();
  await page.getByTestId('conflict-reload').click();
  await page.getByRole('button', { name: 'Discard my changes' }).click();
  await expect(page.getByTestId('jss-paper').locator('.jss-li').first()).toContainText('Search radar (long range)');
  await expect(page.getByTestId('jss-state')).toHaveText(/All changes saved/);
  await page.close();
});

test('the S1000D Studio is untouched: an S1000D project still opens the Studio', async () => {
  const s = await api.post('/api/projects', { data: { name: 'E2E S1000D', format: 's1000d' } }); expect(s.status()).toBe(201);
  await page.goto(`/projects/${(await s.json()).project.id}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('jss-editor')).toHaveCount(0);
});

test('ancillary pages: a rail item, tick which pages print, edit the words of one, and give it back to Settings', async () => {
  await page.goto(`/projects/${pid}/editor`);
  await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Ancillary pages' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${pid}/ancillary`));
  const rows = page.getByTestId('anc-row');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  expect(await rows.count()).toBeGreaterThan(10);
  await expect(page.locator('[data-page="titlePage"] [data-testid="anc-print"]')).toBeDisabled();          // the title page is always printed
  await expect(page.locator('[data-page="cautionsNotes"]')).toHaveCount(0);                                  // the UHB stencil has no such page

  // which pages print
  const demolition = page.locator('[data-page="demolition"] [data-testid="anc-print"]');
  await expect(demolition).toBeChecked(); await demolition.uncheck();
  await expect.poll(async () => ((await (await api.get(`${U}/ancillary`)).json()).pages as any[]).find((p) => p.id === 'demolition').enabled).toBe(false);
  await demolition.check();
  await expect.poll(async () => ((await (await api.get(`${U}/ancillary`)).json()).pages as any[]).find((p) => p.id === 'demolition').enabled).toBe(true);

  // edit the words of the foreword
  await page.locator('[data-page="foreword"] .v2-anc-name').click();
  const fields = page.getByTestId('anc-fields').locator('[data-testid="anc-field"]');
  await expect(fields.first()).toBeVisible();
  await expect(page.getByTestId('anc-save')).toBeDisabled();                                                 // nothing changed yet
  await fields.first().fill('E2EFOREWORD every care has been taken.');
  await expect(page.getByTestId('anc-save')).toBeEnabled();
  await page.screenshot({ path: path.join(SHOTS, '9-ancillary.png') });
  await page.getByTestId('anc-save').click();
  await expect(page.locator('[data-page="foreword"]')).toContainText('edited');
  const saved = (await (await api.get(`${U}/ancillary/foreword`)).json());
  expect(saved.xml).toContain('E2EFOREWORD every care has been taken.'); expect(saved.page.edited).toBe(true);
  expect(saved.xml).toContain('<deflist>');                                                                   // the structure around the words is untouched

  // the XML view shows the page; a broken page is refused with the server's reason
  await page.getByRole('button', { name: 'XML', exact: true }).click();
  const xmlBox = page.getByTestId('anc-xml');
  await expect(xmlBox).toHaveValue(/<foreword>/);
  await xmlBox.fill('<foreword><para>unclosed</foreword>');
  await page.getByTestId('anc-save').click();
  await expect(page.getByText(/not well-formed XML/)).toBeVisible();

  // give it back to Settings
  await page.getByRole('button', { name: 'Undo my changes' }).click();
  await page.getByTestId('anc-reset').click();
  await page.getByRole('button', { name: 'Give back', exact: true }).click();
  await expect(page.locator('[data-page="foreword"]')).not.toContainText('edited');
  expect((await (await api.get(`${U}/ancillary/foreword`)).json()).xml).not.toContain('E2EFOREWORD');
});
