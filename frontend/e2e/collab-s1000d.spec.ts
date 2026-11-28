// Phase 3 (P3-1): live co-editing of an S1000D data module in real browsers against the real server.
//   * two authors in two browser contexts type in the same paragraph at the same time: both see both changes without a refresh, the save
//     state says "Saved", and the project file gets the merged text;
//   * a reviewer in a third context joins read-only, sees the authors' typing live, cannot change the canvas, and comments on the selected
//     words; the authors' comment panels show the comment without a refresh;
//   * check-out is an optional lock: the holder keeps typing, the other author sees "Locked by" and a read-only canvas (and still the
//     holder's changes), check-in frees it.
// Nothing is mocked.

import { test, expect, request as pwRequest, type Page, type APIRequestContext, type BrowserContext, type Browser } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(here, '..', 'public', 'samples');
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const PW = 'Correct-Horse-9!';
const PARA = 'The pump has these main characteristics:';

let admin: APIRequestContext; let pid = '';
const people: Record<string, { ctx: BrowserContext; page: Page }> = {};
const suffix = String(Date.now() % 100000);

test.describe.configure({ mode: 'serial' });

async function person(browser: Browser, baseURL: string, key: string): Promise<{ ctx: BrowserContext; page: Page; name: string }> {
  const name = `live${key}${suffix}`;
  // the platform role; the project role (editor or reviewer) is given by the assignments in beforeAll
  const made = await admin.post('/api/team/users', { data: { username: name, fullName: `Live ${key}`, role: 'author' } });
  expect(made.status(), await made.text()).toBe(201);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, baseURL });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error (${key}): ${e.message}`); });
  page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
  expect((await ctx.request.post('/api/auth/login', { data: { username: name, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await ctx.request.post('/api/auth/onboarding', { data: { username: name, password: PW } })).ok()).toBeTruthy();
  return { ctx, page, name };
}

const para = (p: Page) => p.locator('.design-page [data-x="para"]').filter({ hasText: 'main characteristics' }).first();
async function openDm(p: Page): Promise<void> {
  await p.goto(`/projects/${pid}/editor?file=${encodeURIComponent(DM)}`);
  await expect(p.locator('.design-page')).toContainText(PARA, { timeout: 60_000 });
}
/** put the caret at the end (or start) of the paragraph and type, like a person */
async function typeIn(p: Page, text: string, where: 'end' | 'start'): Promise<void> {
  await para(p).click();
  await p.keyboard.press(where === 'end' ? 'End' : 'Home');
  await p.keyboard.type(text, { delay: 15 });
}

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const a = await person(browser, baseURL!, 'ann');
  const b = await person(browser, baseURL!, 'ben');
  const r = await person(browser, baseURL!, 'rev');
  people.a = a; people.b = b; people.r = r;
  const made = await a.ctx.request.post('/api/projects', { data: { name: `Live ${suffix}`, pipeline: 's1000dtofo' } });
  expect(made.status(), await made.text()).toBe(201);
  pid = (await made.json()).project.id;
  const dm = await a.ctx.request.post(`/api/projects/${pid}/dms`, { data: { file: DM, xml: fs.readFileSync(path.join(SAMPLES, DM), 'utf8') } });
  expect(dm.status(), await dm.text()).toBe(201);
  expect((await a.ctx.request.post(`/api/projects/${pid}/assign`, { data: { username: b.name, role: 'editor' } })).ok()).toBeTruthy();
  expect((await a.ctx.request.post(`/api/projects/${pid}/assign`, { data: { username: r.name, role: 'reviewer' } })).ok()).toBeTruthy();
});
test.afterAll(async () => { for (const p of Object.values(people)) await p.ctx.close(); await admin.dispose(); });

test('two authors type in the same paragraph at once: both changes appear for both, without a refresh, and reach the file', async () => {
  const { a, b } = people;
  await openDm(a.page); await openDm(b.page);
  await expect(a.page.getByTestId('save-state')).toHaveText(/Saved/, { timeout: 20_000 });
  // at the same time: Ann at the end, Ben at the start
  await Promise.all([typeIn(a.page, ' ANNLIVE', 'end'), typeIn(b.page, 'BENLIVE ', 'start')]);
  for (const p of [a.page, b.page]) {
    await expect(para(p)).toContainText('ANNLIVE', { timeout: 15_000 });
    await expect(para(p)).toContainText('BENLIVE', { timeout: 15_000 });
  }
  await expect(para(a.page)).toHaveText(await para(b.page).innerText(), { timeout: 10_000 });
  await expect(a.page.getByTestId('save-state')).toHaveText(/^Saved/, { timeout: 15_000 });
  // the other author's caret is drawn with their name
  await expect(a.page.locator('.collab-caret .collab-name', { hasText: 'Live ben' })).toBeVisible({ timeout: 10_000 });
  // saved continuously: the project file has both (the server writes it back seconds after the last change; Save makes it now)
  await a.page.keyboard.press('Control+s');
  await expect.poll(async () => {
    const x = (await (await a.ctx.request.get(`/api/projects/${pid}/dms/${DM}`)).json()).xml as string;
    return x.includes('BENLIVE ') && x.includes(' ANNLIVE');
  }, { timeout: 20_000 }).toBeTruthy();
  // undo is per person: Ann's undo takes back her words, not Ben's
  await a.page.keyboard.press('Control+z');
  await expect(para(b.page)).not.toContainText('ANNLIVE', { timeout: 15_000 });
  await expect(para(b.page)).toContainText('BENLIVE');
  await a.page.keyboard.press('Control+y');
  await expect(para(b.page)).toContainText('ANNLIVE', { timeout: 15_000 });
});

test('a reviewer sees the typing live, cannot change the document, and comments on the selected words while the author types', async () => {
  const { a, r } = people;
  await openDm(r.page);
  await expect(r.page.getByTestId('collab-lock')).toBeVisible();
  await expect(r.page.getByTestId('collab-lock')).toContainText(/reviewing/i);
  await typeIn(a.page, ' WHILEREVIEWED', 'end');
  await expect(para(r.page)).toContainText('WHILEREVIEWED', { timeout: 15_000 });
  // the reviewer's typing does not change the document (here or for anyone)
  await typeIn(r.page, 'REVIEWERTYPED', 'start');
  await r.page.waitForTimeout(800);
  await expect(para(r.page)).not.toContainText('REVIEWERTYPED');
  await expect(para(a.page)).not.toContainText('REVIEWERTYPED');
  // a comment pinned to the selected words; the author's panel shows it without a refresh
  await para(r.page).dblclick();   // selects a word
  await r.page.getByTestId('editor-comments').click();
  await r.page.getByTestId('comment-new').fill('Please check the flow figure');
  await r.page.getByTestId('comment-add').click();
  await expect(r.page.locator('.v2-toast', { hasText: 'Comment added' }).first()).toBeVisible({ timeout: 10_000 });
  await a.page.getByTestId('editor-comments').click();
  await expect(a.page.getByTestId('comments-panel')).toContainText('Please check the flow figure', { timeout: 10_000 });
  // the author keeps typing meanwhile; the comment's live anchor still finds its words
  await typeIn(a.page, ' AFTERCOMMENT', 'start');
  const show = a.page.getByTestId('editor-comment-show').first();
  await expect(show).toBeVisible();
  await show.click();
  await expect(a.page.locator('.v2-toast', { hasText: 'no longer in the document' })).toHaveCount(0);
});

test('check-out is an optional exclusive lock: the other author is read-only ("Locked by") and still sees the holder\'s changes', async () => {
  const { a, b } = people;
  await a.page.getByTestId('lease-checkout').click();
  await expect(a.page.getByTestId('lease-mine')).toBeVisible({ timeout: 10_000 });
  await expect(b.page.getByTestId('collab-lock')).toContainText(/Locked by/, { timeout: 10_000 });
  await expect(b.page.getByTestId('lease-other')).toContainText(/Locked by/, { timeout: 10_000 });
  await typeIn(a.page, ' HOLDERTYPES', 'end');
  await expect(para(b.page)).toContainText('HOLDERTYPES', { timeout: 15_000 });
  await typeIn(b.page, 'BLOCKEDTYPE', 'start');
  await b.page.waitForTimeout(800);
  await expect(para(a.page)).not.toContainText('BLOCKEDTYPE');
  await expect(para(b.page)).not.toContainText('BLOCKEDTYPE');
  // checked in: Ben can type again, and Ann sees it
  await a.page.getByTestId('lease-checkin').click();
  await expect(b.page.getByTestId('collab-lock')).toBeHidden({ timeout: 10_000 });
  await typeIn(b.page, 'FREEAGAIN ', 'start');
  await expect(para(a.page)).toContainText('FREEAGAIN', { timeout: 15_000 });
});
