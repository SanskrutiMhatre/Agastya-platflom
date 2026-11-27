// WP-20: the fixed data of the theme and accessibility suite. Idempotent: the light and the dark project (and every spec file) call it against the
// same server, and the second call finds what the first made. Names are fixed (no Date.now()) so the pictures do not change between runs.
import { expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

export const PW = 'Correct-Horse-9!';
export const AUTHOR = 'vera';
export type Theme = 'light' | 'dark';

export interface Seed { admin: APIRequestContext; author: APIRequestContext; ids: { s1000d: string; jss: string; jsg: string } }

async function login(baseURL: string | undefined, username: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL });
  expect((await ctx.post('/api/auth/login', { data: { username, password: PW } })).ok(), `sign in as ${username}`).toBeTruthy();
  return ctx;
}

export async function seed(baseURL: string | undefined): Promise<Seed> {
  const probe = await pwRequest.newContext({ baseURL });
  const setup = await (await probe.get('/api/auth/setup')).json();
  if (setup.setupRequired) expect((await probe.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } })).ok()).toBeTruthy();
  await probe.dispose();
  const admin = await login(baseURL, 'admin');
  const users = (await (await admin.get('/api/team/users')).json()).users as Array<{ username: string }>;
  if (!users.some((u) => u.username === AUTHOR)) {
    const made = await admin.post('/api/team/users', { data: { username: AUTHOR, fullName: 'Vera Visual', role: 'author' } });
    expect(made.status()).toBe(201);
    const first = await pwRequest.newContext({ baseURL });
    expect((await first.post('/api/auth/login', { data: { username: AUTHOR, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
    expect((await first.post('/api/auth/onboarding', { data: { username: AUTHOR, password: PW } })).ok()).toBeTruthy();
    await first.dispose();
  }
  const author = await login(baseURL, AUTHOR);
  const have = (await (await author.get('/api/projects')).json()).projects as Array<{ id: string; name: string }>;
  const find = (name: string) => have.find((p) => p.name === name)?.id;
  const mk = async (name: string, data: Record<string, unknown>, sample?: string): Promise<string> => {
    const existing = find(name); if (existing) return existing;
    const r = sample ? await author.post(sample, { data: { ...data } }) : await author.post('/api/projects', { data: { name, ...data } });
    expect(r.status(), await r.text()).toBe(201);
    const id = (await r.json()).project.id as string;
    if (sample) expect((await author.patch(`/api/projects/${id}`, { data: { name } })).status()).toBeLessThan(300);
    return id;
  };
  const ids = {
    s1000d: await mk('Visual sample S1000D', {}, '/api/projects/sample'),
    jss: await mk('Visual JSS handbook', { format: 'jss', domain: 'land', manualType: 'uhb' }),
    jsg: await mk('Visual JSG handbook', { format: 'jsg', domain: 'land', manualType: 'uhb' }),
  };
  return { admin, author, ids };
}

export const themeOf = (info: TestInfo): Theme => (info.project.name === 'dark' ? 'dark' : 'light');

/** A signed-in window in a theme: the choice is stored before the first paint (the explicit mode of 08 section 7.4 b). */
export async function windowFor(browser: Browser, baseURL: string | undefined, who: APIRequestContext | null, theme: Theme): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ baseURL, colorScheme: theme, ...(who ? { storageState: await who.storageState() } : {}) });
  await ctx.addInitScript((t) => { try { localStorage.setItem('agastya.theme', t); } catch { /* none */ } }, theme);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

/** Wait until the page is quiet, then assert the theme (never take a picture in the wrong theme). */
export async function settle(page: Page, theme: Theme): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.waitForTimeout(300);
}

/**
 * Marks what changes from run to run (dates, times, "x minutes ago", ids, version and build strings) with data-vmask, for `mask`.
 * Generic on purpose: it reads the text, not class names, so a new date on a page is masked without editing the spec.
 */
export async function markVolatile(page: Page): Promise<void> {
  await page.evaluate(() => {
    const VOLATILE = /\b\d{1,2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\bago\b|\bjust now\b|\byesterday\b|\b[0-9a-f]{8,}\b|\bv?\d+\.\d+\.\d+\b|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.textContent || '';
      if (VOLATILE.test(t) && walker.currentNode.parentElement) walker.currentNode.parentElement.setAttribute('data-vmask', '');
    }
    for (const el of Array.from(document.querySelectorAll('input, textarea'))) if (VOLATILE.test((el as HTMLInputElement).value)) el.setAttribute('data-vmask', '');
  });
}
