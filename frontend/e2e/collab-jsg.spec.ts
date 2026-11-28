// Phase 3 (P3-1): live co-editing of a JSG document (User Handbook and Illustrated Spare Parts List) in real browsers against the real server.
//   * two authors type in the same paragraph of a User Handbook at the same time: both see both changes without a refresh, the save state says
//     "Saved", the other author's caret carries their name, and the project file gets the merged text; undo is per person;
//   * two authors change two cells of the same parts row of an ISPL at once: both cells reach both pages and the file;
//   * a reviewer joins read-only, sees the typing live, cannot change the document, and comments on the selected words;
//   * check-out is an optional lock: the other author sees "Locked by" and a read-only editor, and still the holder's changes; check-in frees it.
// Nothing is mocked.

import { test, expect, request as pwRequest, type Page, type APIRequestContext, type BrowserContext, type Browser, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = path.resolve(here, '..', '..', 'backend', 'samples');
const PW = 'Correct-Horse-9!';
const PARA = 'This paragraph is about introduction';

let admin: APIRequestContext; let uhb = ''; let ispl = '';
const people: Record<string, { ctx: BrowserContext; page: Page; name: string }> = {};
const suffix = String(Date.now() % 100000);

test.describe.configure({ mode: 'serial' });

async function person(browser: Browser, baseURL: string, key: string): Promise<{ ctx: BrowserContext; page: Page; name: string }> {
  const name = `jlive${key}${suffix}`;
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

async function project(ctx: BrowserContext, name: string, type: 'uhb' | 'ispl'): Promise<string> {
  const made = await ctx.request.post('/api/projects', { data: { name, format: 'jsg', domain: 'land', manualType: type } });
  expect(made.status(), await made.text()).toBe(201);
  const id = (await made.json()).project.id as string;
  const cur = await (await ctx.request.get(`/api/projects/${id}/jsg`)).json();
  const xml = fs.readFileSync(path.join(SAMPLES, `jsg-${type}`, 'jsg-document.xml'), 'utf8');
  const put = await ctx.request.put(`/api/projects/${id}/jsg`, { data: { xml, baseHash: cur.hash } });
  expect(put.ok(), await put.text()).toBeTruthy();
  return id;
}
const fileXml = async (ctx: BrowserContext, id: string): Promise<string> => (await (await ctx.request.get(`/api/projects/${id}/jsg`)).json()).xml as string;

const para = (p: Page): Locator => p.locator('[data-testid="jsg-sheet"] .jsg-p').filter({ hasText: PARA }).first();
async function open(p: Page, id: string, ready: string): Promise<void> {
  await p.goto(`/projects/${id}/editor`);
  await expect(p.getByTestId('jsg-sheet')).toBeVisible({ timeout: 60_000 });
  await expect(p.getByTestId('jsg-state')).toHaveText(/^Saved/, { timeout: 30_000 });
  if (ready) await expect(p.getByTestId('jsg-sheet')).toContainText(ready, { timeout: 30_000 });
}
async function typeIn(p: Page, text: string, where: 'end' | 'start'): Promise<void> {
  await para(p).click();
  await p.keyboard.press(where === 'end' ? 'Control+End' : 'Control+Home');   // the start and end of the paragraph, not of the wrapped line
  await p.keyboard.type(text, { delay: 15 });
}
/** the parts-row input holding `value` now (its place in the sheet) */
async function cell(p: Page, value: string): Promise<Locator> {
  const i = await p.locator('[data-testid="jsg-sheet"] input').evaluateAll((els, v) => els.findIndex((e) => (e as HTMLInputElement).value === v), value);
  expect(i, `an input holding ${value}`).toBeGreaterThanOrEqual(0);
  return p.locator('[data-testid="jsg-sheet"] input').nth(i);
}

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  people.a = await person(browser, baseURL!, 'ann');
  people.b = await person(browser, baseURL!, 'ben');
  people.r = await person(browser, baseURL!, 'rev');
  uhb = await project(people.a.ctx, `Live UHB ${suffix}`, 'uhb');
  ispl = await project(people.a.ctx, `Live ISPL ${suffix}`, 'ispl');
  for (const id of [uhb, ispl]) {
    expect((await people.a.ctx.request.post(`/api/projects/${id}/assign`, { data: { username: people.b.name, role: 'editor' } })).ok()).toBeTruthy();
    expect((await people.a.ctx.request.post(`/api/projects/${id}/assign`, { data: { username: people.r.name, role: 'reviewer' } })).ok()).toBeTruthy();
  }
});
test.afterAll(async () => { for (const p of Object.values(people)) await p.ctx.close(); await admin.dispose(); });

test('two authors type in the same handbook paragraph at once: both see both, with carets and names, and the file gets the merged text', async () => {
  const { a, b } = people;
  await open(a.page, uhb, PARA); await open(b.page, uhb, PARA);
  await Promise.all([typeIn(a.page, ' ANNLIVE', 'end'), typeIn(b.page, 'BENLIVE ', 'start')]);
  for (const p of [a.page, b.page]) {
    await expect(para(p)).toContainText('ANNLIVE', { timeout: 15_000 });
    await expect(para(p)).toContainText('BENLIVE', { timeout: 15_000 });
  }
  await expect(para(a.page)).toHaveText(await para(b.page).innerText(), { timeout: 10_000 });
  await expect(a.page.getByTestId('jsg-state')).toHaveText(/^Saved/, { timeout: 15_000 });
  // the other author's caret, with their name, and their face in the outline
  await expect(a.page.locator('.collab-caret .collab-name', { hasText: 'Live ben' })).toBeVisible({ timeout: 10_000 });
  await expect(a.page.getByTestId('jsg-row-people').first()).toBeVisible({ timeout: 10_000 });
  // Save writes the file now (and records a revision)
  await a.page.getByTestId('jsg-save').click();
  await expect.poll(async () => { const x = await fileXml(a.ctx, uhb); return x.includes('BENLIVE ') && x.includes(' ANNLIVE'); }, { timeout: 20_000 }).toBeTruthy();
  // undo is per person: Ann's undo takes back her words, not Ben's
  await para(a.page).click();
  await a.page.keyboard.press('Control+z');
  await expect(para(b.page)).not.toContainText('ANNLIVE', { timeout: 15_000 });
  await expect(para(b.page)).toContainText('BENLIVE');
  await a.page.keyboard.press('Control+y');
  await expect(para(b.page)).toContainText('ANNLIVE', { timeout: 15_000 });
});

test('two authors change two cells of one ISPL parts row at once: both cells reach both pages and the file', async () => {
  const { a, b } = people;
  await open(a.page, ispl, 'Plates'); await open(b.page, ispl, 'Plates');   // the parts are in form fields (not in the sheet's text)
  await a.page.waitForTimeout(300);
  const ad = await cell(a.page, 'DUMMY PART 1-1'); const bd = await cell(b.page, 'DFP-11');
  await Promise.all([
    (async () => { await ad.click(); await a.page.keyboard.press('End'); await a.page.keyboard.type(' ANNCELL', { delay: 15 }); })(),
    (async () => { await bd.click(); await b.page.keyboard.press('End'); await b.page.keyboard.type('-BEN', { delay: 15 }); })(),
  ]);
  for (const p of [a.page, b.page]) {
    await expect.poll(async () => p.locator('[data-testid="jsg-sheet"] input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)), { timeout: 15_000 })
      .toEqual(expect.arrayContaining(['DUMMY PART 1-1 ANNCELL', 'DFP-11-BEN']));
  }
  await expect(a.page.getByTestId('jsg-state')).toHaveText(/^Saved/, { timeout: 15_000 });
  await a.page.getByTestId('jsg-save').click();
  await expect.poll(async () => { const x = await fileXml(a.ctx, ispl); return /<part item="01"[^>]*designation="DUMMY PART 1-1 ANNCELL"[^>]*firmPart="DFP-11-BEN"/.test(x); }, { timeout: 20_000 }).toBeTruthy();
});

test('a reviewer sees the typing live, cannot change the handbook, and comments on the selected words', async () => {
  const { a, r } = people;
  await open(a.page, uhb, PARA); await open(r.page, uhb, PARA);
  await expect(r.page.getByTestId('collab-lock')).toBeVisible();
  await typeIn(a.page, ' WHILEREVIEWED', 'end');
  await expect(para(r.page)).toContainText('WHILEREVIEWED', { timeout: 15_000 });
  // the reviewer's editor is read-only: typing changes nothing, here or for anyone
  await para(r.page).click(); await r.page.keyboard.type('REVIEWERTYPED');
  await r.page.waitForTimeout(800);
  await expect(para(r.page)).not.toContainText('REVIEWERTYPED');
  await expect(para(a.page)).not.toContainText('REVIEWERTYPED');
  // a comment pinned to the selected words; the author's panel shows it without a refresh
  await para(r.page).dblclick();
  await r.page.getByTestId('editor-comments').click();
  await r.page.getByTestId('comment-new').fill('Please check the trial wording');
  await r.page.getByTestId('comment-add').click();
  await expect(r.page.locator('.v2-toast', { hasText: 'Comment added' }).first()).toBeVisible({ timeout: 10_000 });
  await a.page.getByTestId('editor-comments').click();
  await expect(a.page.getByTestId('comments-panel')).toContainText('Please check the trial wording', { timeout: 10_000 });
  // the author keeps typing; the comment's live anchor still finds its words
  await typeIn(a.page, 'AFTERCOMMENT ', 'start');
  const show = a.page.getByTestId('editor-comment-show').first();
  await expect(show).toBeVisible();
  await show.click();
  await expect(a.page.locator('.v2-toast', { hasText: 'no longer in the document' })).toHaveCount(0);
});

test('check-out is an optional lock: the other author sees "Locked by", a read-only editor, and still the holder\'s changes', async () => {
  const { a, b } = people;
  await open(a.page, uhb, PARA); await open(b.page, uhb, PARA);
  await a.page.getByTestId('lease-checkout').click();
  await expect(a.page.getByTestId('lease-mine')).toBeVisible({ timeout: 10_000 });
  await expect(b.page.getByTestId('collab-lock')).toContainText(/Locked by|checked/i, { timeout: 10_000 });
  await expect(b.page.getByTestId('lease-other')).toContainText(/Locked by/, { timeout: 10_000 });
  await typeIn(a.page, ' HOLDERTYPES', 'end');
  await expect(para(b.page)).toContainText('HOLDERTYPES', { timeout: 15_000 });
  await para(b.page).click(); await b.page.keyboard.type('BLOCKEDTYPE');
  await b.page.waitForTimeout(800);
  await expect(para(a.page)).not.toContainText('BLOCKEDTYPE');
  await expect(para(b.page)).not.toContainText('BLOCKEDTYPE');
  await a.page.getByTestId('lease-checkin').click();
  await expect(b.page.getByTestId('collab-lock')).toBeHidden({ timeout: 10_000 });
  await typeIn(b.page, 'FREEAGAIN ', 'start');
  await expect(para(a.page)).toContainText('FREEAGAIN', { timeout: 15_000 });
});
