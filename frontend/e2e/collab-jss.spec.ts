// Phase 3 (P3-1): live co-editing of a JSS book in real browsers against the real server (the JSS binding, docs/phase3/collab-jss.md).
//   * two authors type in the same paragraph at the same time: both see both changes without a refresh, the save state says "Saved",
//     the other author's caret carries their name, the project file gets the merged text, and undo is per person;
//   * a structural edit (a list added by one author) merges with the other author's typing elsewhere;
//   * a reviewer sees the typing live and cannot change the sheet;
//   * check-out is an optional lock: the other author sees "Locked by" and a read-only sheet (and still the holder's changes).
// Nothing is mocked.

import { test, expect, request as pwRequest, type Page, type APIRequestContext, type BrowserContext, type Browser } from '@playwright/test';

const PW = 'Correct-Horse-9!';
let admin: APIRequestContext; let pid = '';
const people: Record<string, { ctx: BrowserContext; page: Page; name: string }> = {};
const suffix = String(Date.now() % 100000);

test.describe.configure({ mode: 'serial' });

async function person(browser: Browser, baseURL: string, key: string): Promise<{ ctx: BrowserContext; page: Page; name: string }> {
  const name = `jlive${key}${suffix}`;
  const made = await admin.post('/api/team/users', { data: { username: name, fullName: `Live ${key}`, role: 'author' } });
  expect(made.status(), await made.text()).toBe(201);
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, baseURL });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error (${key}): ${e.message}`); });
  page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
  expect((await ctx.request.post('/api/auth/login', { data: { username: name, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await ctx.request.post('/api/auth/onboarding', { data: { username: name, password: PW } })).ok()).toBeTruthy();
  return { ctx, page, name };
}

const sheet = (p: Page) => p.getByTestId('jss-paper');
const purpose = (p: Page) => sheet(p).locator('.jss-sec').filter({ has: p.locator('.jss-sec-title', { hasText: 'Purpose' }) }).first();
const para = (p: Page) => purpose(p).locator('[data-edit]').filter({ hasText: 'SEED' }).first();
async function open(p: Page): Promise<void> {
  await p.goto(`/projects/${pid}/editor`);
  await expect(p.getByTestId('jss-editor')).toBeVisible({ timeout: 60_000 });
}
async function typeIn(p: Page, text: string, where: 'end' | 'start'): Promise<void> {
  await para(p).click();
  await p.keyboard.press(where === 'end' ? 'End' : 'Home');
  await p.keyboard.type(text, { delay: 15 });
}
const fileText = async (ctx: BrowserContext): Promise<string> => (await (await ctx.request.get(`/api/projects/${pid}/jss`)).json()).xml as string;

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const a = await person(browser, baseURL!, 'ann');
  const b = await person(browser, baseURL!, 'ben');
  const r = await person(browser, baseURL!, 'rev');
  people.a = a; people.b = b; people.r = r;
  const made = await a.ctx.request.post('/api/projects', { data: { name: `Live JSS ${suffix}`, format: 'jss', domain: 'land', manualType: 'uhb' } });
  expect(made.status(), await made.text()).toBe(201);
  pid = (await made.json()).project.id;
  expect((await a.ctx.request.post(`/api/projects/${pid}/assign`, { data: { username: b.name, role: 'editor' } })).ok()).toBeTruthy();
  expect((await a.ctx.request.post(`/api/projects/${pid}/assign`, { data: { username: r.name, role: 'reviewer' } })).ok()).toBeTruthy();
});
test.afterAll(async () => { for (const p of Object.values(people)) await p.ctx.close(); await admin.dispose(); });

test('two authors type in the same paragraph at once: both see both, the file has both, undo is per person', async () => {
  const { a, b } = people;
  await open(a.page);
  await expect(a.page.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 20_000 });
  // Ann writes the paragraph; Ben, who opens the book after, gets it from the room
  await purpose(a.page).locator('.jss-empty').click();
  await a.page.keyboard.type('The SEED paragraph.', { delay: 10 });
  await open(b.page);
  await expect(para(b.page)).toContainText('The SEED paragraph.', { timeout: 15_000 });
  // at the same time: Ann at the end, Ben at the start
  await Promise.all([typeIn(a.page, ' ANNLIVE', 'end'), typeIn(b.page, 'BENLIVE ', 'start')]);
  for (const p of [a.page, b.page]) {
    await expect(para(p)).toContainText('ANNLIVE', { timeout: 15_000 });
    await expect(para(p)).toContainText('BENLIVE', { timeout: 15_000 });
  }
  await expect(para(a.page)).toHaveText(await para(b.page).innerText(), { timeout: 10_000 });
  await expect(a.page.getByTestId('jss-state')).toHaveText(/^Saved/, { timeout: 15_000 });
  await expect(a.page.locator('.collab-caret .collab-name', { hasText: 'Live ben' })).toBeVisible({ timeout: 10_000 });
  await expect(a.page.getByTestId('jss-outline-people').first()).toBeVisible({ timeout: 10_000 });
  // Save writes the file now
  await a.page.keyboard.press('Control+s');
  await expect.poll(async () => { const x = await fileText(a.ctx); return x.includes('BENLIVE The SEED') && x.includes('paragraph. ANNLIVE'); }, { timeout: 20_000 }).toBeTruthy();
  // undo is per person: Ann's undo takes back her words, not Ben's
  await a.page.keyboard.press('Control+z');
  await expect(para(b.page)).not.toContainText('ANNLIVE', { timeout: 15_000 });
  await expect(para(b.page)).toContainText('BENLIVE');
  await a.page.keyboard.press('Control+y');
  await expect(para(b.page)).toContainText('ANNLIVE', { timeout: 15_000 });
});

test('a structural edit merges: one author adds a list while the other types in the paragraph', async () => {
  const { a, b } = people;
  // Ben adds a lettered list after the paragraph (a structural change); Ann types in the paragraph meanwhile
  await para(b.page).click(); await b.page.keyboard.press('End');
  await b.page.getByRole('tab', { name: 'Insert', exact: true }).click();
  await b.page.getByRole('button', { name: 'Add or change a list' }).click();
  await b.page.getByRole('menuitem', { name: /New list: \(a\) \(b\) \(c\) lettered/ }).click();
  await Promise.all([b.page.keyboard.type('Search radar', { delay: 15 }), typeIn(a.page, ' STRUCTMERGE', 'end')]);
  for (const p of [a.page, b.page]) {
    await expect(purpose(p).locator('.jss-li-label')).toHaveText(['(a)'], { timeout: 15_000 });
    await expect(purpose(p)).toContainText('Search radar', { timeout: 15_000 });
    await expect(para(p)).toContainText('STRUCTMERGE', { timeout: 15_000 });
  }
  await a.page.keyboard.press('Control+s');
  await expect.poll(async () => { const x = await fileText(a.ctx); return x.includes('STRUCTMERGE') && x.includes('Search radar'); }, { timeout: 20_000 }).toBeTruthy();
});

test('a reviewer sees the typing live and cannot change the sheet', async () => {
  const { a, r } = people;
  await open(r.page);
  await expect(r.page.getByTestId('collab-lock')).toBeVisible({ timeout: 15_000 });
  await typeIn(a.page, ' WHILEREVIEWED', 'end');
  await expect(para(r.page)).toContainText('WHILEREVIEWED', { timeout: 15_000 });
  await expect(purpose(r.page).locator('[contenteditable="true"]')).toHaveCount(0);
  // a comment pinned to the selected words; the author's panel shows it, and its live anchor finds the words after more typing
  await para(r.page).dblclick();
  await r.page.getByTestId('editor-comments').click();
  await r.page.getByTestId('comment-new').fill('Please check the purpose');
  await r.page.getByTestId('comment-add').click();
  await expect(r.page.locator('.v2-toast', { hasText: 'Comment added' }).first()).toBeVisible({ timeout: 10_000 });
  await a.page.getByTestId('editor-comments').click();
  await expect(a.page.getByTestId('comments-panel')).toContainText('Please check the purpose', { timeout: 10_000 });
  await typeIn(a.page, 'AFTERCOMMENT ', 'start');
  await a.page.getByTestId('editor-comment-show').first().click();
  await expect(a.page.locator('.v2-toast', { hasText: 'no longer in the document' })).toHaveCount(0);
  await a.page.getByTestId('editor-comments').click();
});

test('check-out is an optional lock: the other author is read-only ("Locked by") and still sees the holder\'s changes', async () => {
  const { a, b } = people;
  await a.page.getByTestId('lease-checkout').click();
  await expect(a.page.getByTestId('lease-mine')).toBeVisible({ timeout: 10_000 });
  await expect(b.page.getByTestId('collab-lock')).toContainText(/Locked by/, { timeout: 10_000 });
  await expect(b.page.getByTestId('lease-other')).toContainText(/Locked by/, { timeout: 10_000 });
  await typeIn(a.page, ' HOLDERTYPES', 'end');
  await expect(para(b.page)).toContainText('HOLDERTYPES', { timeout: 15_000 });
  await expect(purpose(b.page).locator('[contenteditable="true"]')).toHaveCount(0);
  await a.page.getByTestId('lease-checkin').click();
  await expect(b.page.getByTestId('collab-lock')).toBeHidden({ timeout: 10_000 });
  await typeIn(b.page, 'FREEAGAIN ', 'start');
  await expect(para(a.page)).toContainText('FREEAGAIN', { timeout: 15_000 });
});
