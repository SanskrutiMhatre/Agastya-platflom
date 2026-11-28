// The Publication and Explore pages of a JSS / JSG project in a real browser, against the real server. The document codes (DMC, PMC, ICN) are shown on these pages, never as a strip
// on the editor page; the pages work like the S1000D ones (drag and drop, up / down, rename, add a chapter, undo, search, hierarchy / table, detail panel) wherever that applies, and
// what the author arranges is what the document holds after Save. Nothing is mocked.

import { test, expect, request as pwRequest, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { classicOnly } from './support/live';

const PW = 'Correct-Horse-9!';
const SHOTS = path.join('test-results', 'doc-pages-shots');
let page: Page; let api: APIRequestContext;
/** a second page of the same person whose editors save by version (its joins are answered DISABLED) */
const cpage = async (): Promise<Page> => { const p = await page.context().newPage(); p.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); }); await classicOnly(p); return p; };
let jssUhb = ''; let jssFree = ''; let jsgUhb = ''; let jsgIspl = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const who = `pub${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username: who, fullName: 'Pub Author', role: 'author' } });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, baseURL });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  api = ctx.request;
  expect((await api.post('/api/auth/login', { data: { username: who, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username: who, password: PW } })).ok()).toBeTruthy();
  const make = async (name: string, data: Record<string, string>): Promise<string> => { const p = await api.post('/api/projects', { data: { name, ...data } }); expect(p.status()).toBe(201); return (await p.json()).project.id; };
  jssUhb = await make('E2E Pages JSS UHB', { format: 'jss', domain: 'land', manualType: 'uhb' });
  jssFree = await make('E2E Pages JSS Parts List', { format: 'jss', domain: 'naval', manualType: 'naval-tm-4-1' });
  jsgUhb = await make('E2E Pages JSG UHB', { format: 'jsg', domain: 'land', manualType: 'uhb' });
  jsgIspl = await make('E2E Pages JSG ISPL', { format: 'jsg', domain: 'land', manualType: 'ispl' });
  await admin.dispose();
});
test.afterAll(async () => { await page.context().close(); });

const identity = async (id: string) => (await (await api.get(`/api/projects/${id}/identity`)).json()).identity as { modules: Array<{ key: string; chapter: number; title: string; kind: string; dmc: string }>; toc: Array<{ level: number; number: string; title: string }> };
const titles = (id: string) => page.locator(`[data-testid="pub-module"] .v2-mod-title`);
const chapterTitles = () => page.locator('[data-testid="chapter"] .v2-chapter-head h3');
const unsaved = () => page.getByTestId('unsaved-bar');
const openPage = async (id: string, tab: 'publication' | 'explore') => { await page.goto(`/projects/${id}/${tab}`); await expect(page.getByRole('heading', { name: tab === 'publication' ? 'Publication' : 'Explore', exact: true })).toBeVisible(); };

test('the rail of a JSS and a JSG document has Explore and Publication, and the Publication page does not end in an error', async () => {
  for (const id of [jssUhb, jsgUhb]) {
    await page.goto(`/projects/${id}/editor`);
    await expect(page.getByRole('link', { name: 'Explore' })).toBeVisible(); await expect(page.getByRole('link', { name: 'Publication' })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Publication' }).click();
  await expect(page.getByTestId('pub-tree')).toBeVisible(); await expect(page.getByText('Internal error')).toHaveCount(0); await expect(page.getByText('Something went wrong on the server')).toHaveCount(0); await expect(page.getByText('Not a publication module')).toHaveCount(0);
  await expect(chapterTitles().first()).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '1-jsg-publication.png') });
});

test('the codes are not a strip on the editor page, and there is no Codes button: the code beside a heading is a badge, switched on from the Publication page', async () => {
  await api.put(`/api/projects/${jssUhb}/identity/visibility`, { data: { dmc: true } });
  await page.goto(`/projects/${jssUhb}/editor`);
  await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('doc-codes-strip')).toHaveCount(0);
  await expect(page.getByTestId('doc-codes')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Codes', exact: true })).toHaveCount(0);
  await expect(page.locator('.jss-sec-code').first()).toBeVisible();                         // the code beside a heading is still there (it is a badge, not a panel)
  await page.getByRole('link', { name: 'Publication' }).click();
  const pmc = (await (await api.get(`/api/projects/${jssUhb}/identity`)).json()).identity.pmc.code as string;
  await expect(page.getByTestId('doc-codes-pmc')).toHaveText(pmc);
  await expect(page.getByTestId('doc-codes-show-dmc')).toBeChecked();
  await page.getByTestId('doc-codes-show-dmc').uncheck();                                    // the only switch left; the others (PMC, ICN, contents) are always on the pages
  await expect.poll(async () => (await (await api.get(`/api/projects/${jssUhb}/identity`)).json()).identity.show).toEqual({ dmc: false });
  expect((await api.put(`/api/projects/${jssUhb}/identity/visibility`, { data: { pmc: true, icn: true, toc: true } })).status()).toBe(200);   // an old client is not refused
  expect((await (await api.get(`/api/projects/${jssUhb}/identity`)).json()).identity.show).toEqual({ dmc: false });
});

test('Publication (JSS, fixed chapters): the chapters are shown with their codes and cannot be moved; the sections can, and the code goes with the section', async () => {
  await openPage(jssUhb, 'publication');
  const id0 = await identity(jssUhb);
  const sections = id0.modules.filter((m) => m.kind === 'section');
  await expect(page.getByTestId('pub-locked')).toContainText('fixes the chapters');
  await expect(page.getByTestId('chapter').first().locator('header')).toHaveAttribute('draggable', 'false');
  await expect(page.getByTestId('pub-module')).toHaveCount(id0.modules.length);
  const codeOf = async (title: string) => (await page.locator('[data-testid="pub-module"]', { hasText: title }).first().getAttribute('data-code'));
  expect(await codeOf(sections[0].title)).toBe(sections[0].dmc);

  // down with the button, then undo, then down again and save
  const first = sections.filter((m) => m.chapter === sections[0].chapter);
  expect(first.length).toBeGreaterThan(1);
  await page.getByRole('button', { name: `Move ${first[0].title} down`, exact: true }).first().click();
  await expect(unsaved()).toBeVisible();
  await expect(page.locator('[data-testid="chapter"]').first().locator('[data-testid="pub-module"] .v2-mod-title').first()).toContainText(first[1].title);
  await page.getByTestId('undo-arrangement').click(); await expect(unsaved()).toHaveCount(0);
  await page.getByRole('button', { name: `Move ${first[0].title} down`, exact: true }).first().click();
  await page.getByTestId('save-publication').click(); await expect(unsaved()).toHaveCount(0);
  const id1 = await identity(jssUhb);
  const at = (id: typeof id0, t: string) => id.modules.findIndex((m) => m.title === t);
  expect(at(id1, first[0].title)).toBeGreaterThan(at(id1, first[1].title));                   // the document has the new order
  expect(id1.modules.find((m) => m.title === first[0].title)?.dmc).toBe(first[0].dmc);        // the moved section kept its code
  await page.reload(); await expect(page.getByTestId('pub-tree')).toBeVisible();
  await expect(page.locator('[data-testid="chapter"]').first().locator('[data-testid="pub-module"] .v2-mod-title').first()).toContainText(first[1].title);
  await page.screenshot({ path: path.join(SHOTS, '2-jss-publication.png') });
});

test('Publication: a section is dragged into another chapter and dropped, saved, and keeps its code', async () => {
  await openPage(jssUhb, 'publication');
  const id0 = await identity(jssUhb);
  const chapters = [...new Set(id0.modules.filter((m) => m.kind === 'section').map((m) => m.chapter))];
  expect(chapters.length).toBeGreaterThan(1);
  const moved = id0.modules.find((m) => m.kind === 'section' && m.chapter === chapters[0])!;
  const row = page.locator('[data-testid="pub-module"]', { hasText: moved.title }).first();
  const target = page.getByTestId('chapter').nth(chapters[1] - 1).locator('header');
  await row.dragTo(target);
  await expect(unsaved()).toBeVisible();
  await page.getByTestId('save-publication').click(); await expect(unsaved()).toHaveCount(0);
  const id1 = await identity(jssUhb); const after = id1.modules.find((m) => m.title === moved.title)!;
  expect(after.chapter).toBe(chapters[1]); expect(after.dmc).toBe(moved.dmc);
  // and back: drop on a row of the first chapter (the upper half is "before")
  await page.reload(); await expect(page.getByTestId('pub-tree')).toBeVisible();
  const back = page.locator('[data-testid="pub-module"]', { hasText: moved.title }).first();
  const firstOfChapter = page.getByTestId('chapter').nth(chapters[0] - 1).locator('[data-testid="pub-module"]').first();
  // Both rows in view before the drag: dragTo presses on the row, then scrolls the target into view before the first move, and Chromium / Edge
  // start no drag when the page scrolls between the press and the move. The WP-22 project bar made the page taller, so the moved row (last in
  // its chapter) is below the fold of the 950 px window; bring it to the bottom edge, which keeps the first chapter on screen.
  await back.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await expect(back).toBeInViewport({ ratio: 1 }); await expect(firstOfChapter).toBeInViewport({ ratio: 1 });
  await back.dragTo(firstOfChapter, { targetPosition: { x: 60, y: 3 } });
  await page.getByTestId('save-publication').click(); await expect(unsaved()).toHaveCount(0);
  const id2 = await identity(jssUhb); expect(id2.modules.find((m) => m.title === moved.title)?.chapter).toBe(chapters[0]);
});

test('Publication: Open in editor goes to the section; Discard throws the arrangement away', async () => {
  await openPage(jssUhb, 'publication');
  const m = (await identity(jssUhb)).modules.find((x) => x.kind === 'section')!;
  await page.getByRole('button', { name: `Move ${m.title} down`, exact: true }).first().click(); await expect(unsaved()).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click(); await expect(unsaved()).toHaveCount(0);
  await page.getByRole('button', { name: `Open ${m.title} in the editor`, exact: true }).first().click();
  await expect(page).toHaveURL(/\/editor\?goto=/); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.jss-flash')).toHaveCount(1, { timeout: 8000 });
});

test('Publication (JSS with chapters of its own): add a chapter, rename it, move it, save; the document has it', async () => {
  await openPage(jssFree, 'publication');
  await expect(page.getByTestId('pub-locked')).toHaveCount(0);
  const n0 = await chapterTitles().count();
  await page.getByTestId('add-chapter').click();
  await page.getByLabel('Chapter title').fill('Second system'); await page.getByRole('button', { name: 'Add chapter' }).last().click();
  await expect(chapterTitles()).toHaveCount(n0 + 1); await expect(chapterTitles().last()).toHaveText('Second system');
  await page.getByRole('button', { name: 'Move Second system up', exact: true }).click();
  await expect(chapterTitles().nth(n0 - 1)).toHaveText('Second system');
  await page.getByRole('button', { name: 'Rename Second system', exact: true }).click();
  await page.getByLabel('Title').fill('Cooling system'); await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(chapterTitles().nth(n0 - 1)).toHaveText('Cooling system');
  await page.getByTestId('save-publication').click(); await expect(unsaved()).toHaveCount(0);
  const xml = (await (await api.get(`/api/projects/${jssFree}/jss`)).json()).xml as string;
  const names = [...xml.matchAll(/<chapter [^>]*>\s*<title>([^<]*)<\/title>/g)].map((x) => x[1]);
  expect(names).toHaveLength(n0 + 1); expect(names[n0 - 1]).toBe('Cooling system');
  const nums = [...xml.matchAll(/<chapter number="(\d+)"/g)].map((x) => Number(x[1])); expect(nums).toEqual(nums.map((_, i) => i + 1));
  await page.screenshot({ path: path.join(SHOTS, '3-jss-free-publication.png') });
});

test('Publication (JSG User Handbook): move a chapter with the buttons, save, and the JSG document follows', async () => {
  await openPage(jsgUhb, 'publication');
  const n = await chapterTitles().count();
  if (n >= 2) {
    const a = await chapterTitles().nth(0).innerText(); const b = await chapterTitles().nth(1).innerText();
    await page.getByRole('button', { name: `Move ${a} down`, exact: true }).click();
    await expect(chapterTitles().nth(0)).toHaveText(b); await page.getByTestId('save-publication').click(); await expect(unsaved()).toHaveCount(0);
    const xml = (await (await api.get(`/api/projects/${jsgUhb}/jsg`)).json()).xml as string;
    const names = [...xml.matchAll(/<chapter [^>]*title="([^"]*)"/g)].map((x) => x[1].toLowerCase());
    expect(names.indexOf(b.toLowerCase())).toBeLessThan(names.indexOf(a.toLowerCase()));
  }
  await page.screenshot({ path: path.join(SHOTS, '4-jsg-publication.png') });
});

test('Publication (JSG parts list): the plates are listed and are not arranged here', async () => {
  await openPage(jsgIspl, 'publication');
  await expect(page.getByTestId('pub-locked')).toContainText('parts list');
  await expect(page.getByRole('button', { name: /^Move .* (up|down)$/ })).toHaveCount(0);
  await expect(page.getByTestId('add-chapter')).toHaveCount(0);
  await page.goto(`/projects/${jsgIspl}/explore`); await expect(page.getByRole('heading', { name: 'Explore', exact: true })).toBeVisible();
});

test('Explore (JSS): hierarchy with codes, search, expand and collapse, detail panel, table and pictures views', async () => {
  await openPage(jssUhb, 'explore');
  const id = await identity(jssUhb); const sec = id.modules.find((m) => m.kind === 'section')!;
  await expect(page.getByTestId('explore-chapter').first()).toBeVisible();
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByTestId('explore-dm')).toHaveCount(id.modules.length);
  await page.getByRole('button', { name: 'Collapse all' }).click(); await expect(page.getByTestId('explore-dm')).toHaveCount(0);
  await page.getByTestId('explore-search').fill(sec.dmc);
  await expect(page.getByTestId('explore-dm')).toHaveCount(1);
  await page.getByTestId('explore-dm').click();
  await expect(page.getByTestId('explore-detail-code')).toHaveText(sec.dmc);
  await page.screenshot({ path: path.join(SHOTS, '5-jss-explore.png') });
  await page.getByTestId('explore-search').fill('');
  await page.getByRole('button', { name: 'All data modules' }).click(); await expect(page.getByTestId('explore-row')).toHaveCount(id.modules.length);
  await page.getByRole('button', { name: 'Pictures', exact: true }).click();
  await expect(page.getByText(/No pictures in this document|Picture name \(ICN\)/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Hierarchy' }).click(); await page.getByRole('button', { name: 'Expand all' }).click();
  await page.getByTestId('explore-dm').first().click();
  await page.getByRole('button', { name: 'Open in editor' }).click();
  await expect(page).toHaveURL(/\/editor\?goto=/); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
});

test('Explore (JSG): the same, for a handbook', async () => {
  await openPage(jsgUhb, 'explore');
  const id = await identity(jsgUhb);
  await page.getByRole('button', { name: 'Expand all' }).click(); await expect(page.getByTestId('explore-dm')).toHaveCount(id.modules.length);
  await page.screenshot({ path: path.join(SHOTS, '6-jsg-explore.png') });
});

test('on a phone and a tablet the two pages do not scroll sideways', async () => {
  for (const [w, h] of [[390, 800], [820, 1100]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const tab of ['publication', 'explore'] as const) {
      await openPage(jssUhb, tab);
      await page.waitForTimeout(150);
      const over = await page.evaluate(() => { const e = document.scrollingElement!; return e.scrollWidth - e.clientWidth; });
      expect(over, `${tab} at ${w}px`).toBeLessThanOrEqual(1);
    }
  }
  await page.setViewportSize({ width: 1500, height: 950 });
});

test('Publication (JSS with chapters of its own): delete a section and a chapter, undo, save; the document and its codes follow; the last chapter cannot be deleted', async () => {
  await openPage(jssFree, 'publication');
  const id0 = await identity(jssFree);
  const n0 = await chapterTitles().count(); expect(n0).toBeGreaterThan(1);
  const victim = id0.modules.find((m) => m.kind === 'section')!;
  await page.getByRole('button', { name: `Delete ${victim.title}`, exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Delete this section?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click(); await expect(unsaved()).toHaveCount(0);       // cancelled: nothing changed
  await page.getByRole('button', { name: `Delete ${victim.title}`, exact: true }).first().click(); await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(unsaved()).toBeVisible(); await page.getByTestId('undo-arrangement').click(); await expect(unsaved()).toHaveCount(0);   // undo brings it back
  await page.getByRole('button', { name: `Delete ${victim.title}`, exact: true }).first().click(); await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const last = await chapterTitles().last().innerText();
  await page.getByRole('button', { name: `Delete ${last}`, exact: true }).click(); await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(chapterTitles()).toHaveCount(n0 - 1);
  await page.getByTestId('save-publication').click(); await expect(unsaved()).toHaveCount(0);
  const xml = (await (await api.get(`/api/projects/${jssFree}/jss`)).json()).xml as string;
  expect(xml).not.toContain(`<title>${last}</title>`);
  const nums = [...xml.matchAll(/<chapter number="(\d+)"/g)].map((x) => Number(x[1])); expect(nums).toEqual(nums.map((_, i) => i + 1));
  const id1 = await identity(jssFree); expect(id1.modules.some((m) => m.title === victim.title && m.chapter === victim.chapter)).toBe(false);
  // down to one chapter: the button is off
  while (await chapterTitles().count() > 1) {
    const t = await chapterTitles().last().innerText(); await page.getByRole('button', { name: `Delete ${t}`, exact: true }).click(); await page.getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: /^Delete / }).first()).toBeDisabled();
  if (await unsaved().count()) await page.getByRole('button', { name: 'Discard' }).click();
});

test('unsaved work is not lost by clicking a tab: Publication asks, and Stay / Leave without saving / Save and leave each do what they say', async () => {
  await openPage(jssUhb, 'publication');
  await page.getByRole('link', { name: 'Explore' }).click(); await page.getByRole('link', { name: 'Publication' }).click();   // history inside the app, so Back stays inside it
  await expect(page.getByTestId('pub-tree')).toBeVisible();
  const first = (await identity(jssUhb)).modules.filter((m) => m.kind === 'section')[0];
  const rowTitle = () => page.locator('[data-testid="chapter"]').first().locator('[data-testid="pub-module"] .v2-mod-title').first();
  const before = await rowTitle().innerText();
  await page.getByRole('button', { name: `Move ${before} down`, exact: true }).first().click(); await expect(unsaved()).toBeVisible();
  // stay
  await page.getByRole('link', { name: 'Graphics' }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByTestId('leave-stay').click(); await expect(page).toHaveURL(/\/publication$/); await expect(unsaved()).toBeVisible();
  // the browser's Back button is held back too
  await page.goBack(); await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible(); await page.getByTestId('leave-stay').click();
  // leave without saving: the arrangement is gone
  await page.getByRole('link', { name: 'Graphics' }).click(); await page.getByTestId('leave-discard').click();
  await expect(page).toHaveURL(/\/graphics$/);
  await page.getByRole('link', { name: 'Publication' }).click(); await expect(rowTitle()).toHaveText(before);
  // save and leave: it is kept
  await page.getByRole('button', { name: `Move ${before} down`, exact: true }).first().click();
  await page.getByRole('link', { name: 'Explore' }).click(); await page.getByTestId('leave-save').click();
  await expect(page).toHaveURL(/\/explore$/);
  const after = await identity(jssUhb); const names = after.modules.filter((m) => m.kind === 'section' && m.chapter === first.chapter).map((m) => m.title);
  expect(names.indexOf(before)).toBeGreaterThan(0);
  // nothing unsaved: no question
  await page.getByRole('link', { name: 'Publication' }).click(); await page.getByRole('link', { name: 'Graphics' }).click();
  await expect(page).toHaveURL(/\/graphics$/); await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0);
});

// Phase 3 / Phase 8: a live editor (the default) has nothing unsent to lose: a tab click leaves at once and the text is already the server's.
// The leave question belongs to the classic editor (the fallback when the room cannot be joined, C24): the test below opens it on a page
// whose joins are answered DISABLED (support/live.ts).
test('live JSS and JSG editors: a tab click leaves without a question and what was typed is kept', async () => {
  await page.goto(`/projects/${jssUhb}/editor`); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  const purpose = page.getByTestId('jss-paper').locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
  await purpose.locator('.jss-empty, .jss-para').first().click(); await page.keyboard.type('Live guarded text. ');
  await expect(page.getByTestId('jss-state')).toHaveText(/^Saved/, { timeout: 15_000 });
  await page.getByRole('link', { name: 'Explore' }).click();
  await expect(page).toHaveURL(/\/explore$/); await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0);
  await expect.poll(async () => ((await (await api.get(`/api/projects/${jssUhb}/jss`)).json()).xml as string), { timeout: 20_000 }).toContain('Live guarded text.');
  // JSG
  await page.goto(`/projects/${jsgUhb}/editor`); await expect(page.getByTestId('jsg-host')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-testid="jsg-host"] [contenteditable="true"]').first().click(); await page.keyboard.type('LIVEJSGGUARD');
  await expect(page.getByTestId('jsg-state')).toHaveText(/^Saved/, { timeout: 15_000 });
  await page.getByRole('link', { name: 'Publication' }).click();
  await expect(page).toHaveURL(/\/publication$/); await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0);
  await expect.poll(async () => ((await (await api.get(`/api/projects/${jsgUhb}/jsg`)).json()).xml as string), { timeout: 20_000 }).toContain('LIVEJSGGUARD');
});

test('unsaved work in the JSS and the JSG editor is not lost by clicking a tab either; Save and leave keeps it (classic)', async () => {
  const page = await cpage();
  await page.goto(`/projects/${jssUhb}/editor`); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  const purpose = page.getByTestId('jss-paper').locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
  await purpose.locator('.jss-empty, .jss-para').first().click(); await page.keyboard.type('Guarded text. ');
  await expect(page.getByTestId('jss-state')).toHaveText(/Unsaved changes/);
  await page.getByRole('link', { name: 'Explore' }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByTestId('leave-stay').click(); await expect(page).toHaveURL(/\/editor/);
  await page.getByRole('link', { name: 'Explore' }).click(); await page.getByTestId('leave-save').click();
  await expect(page).toHaveURL(/\/explore$/);
  expect(((await (await api.get(`/api/projects/${jssUhb}/jss`)).json()).xml as string)).toContain('Guarded text.');
  // JSG
  await page.goto(`/projects/${jsgUhb}/editor`); await expect(page.getByTestId('jsg-host')).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-testid="jsg-host"] [contenteditable="true"]').first().click(); await page.keyboard.type('x');
  await expect(page.getByTestId('jsg-state')).toHaveText(/Unsaved changes/);
  await page.getByRole('link', { name: 'Publication' }).click();
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible();
  await page.getByTestId('leave-discard').click(); await expect(page).toHaveURL(/\/publication$/);
  await page.close();
});
