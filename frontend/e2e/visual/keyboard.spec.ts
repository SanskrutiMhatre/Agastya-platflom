// WP-23 (UX-004, UX-005, UX-027, UX-028, FE-014; WCAG 2.2 AA 2.1.1, 2.4.1, 2.4.2, 2.4.3, 4.1.3): keyboard scripts for what the static audit
// (a11y-audit.ts) cannot see: the skip link really moves focus, a project opens from the Projects table with Tab and Enter, the account menu
// answers arrows and Escape, Escape closes only the top dialog and the wizard asks before throwing input away, the editor/PDF divider resizes
// with the arrow keys, every route has its own title, the toast live regions exist, and motion stops under the reduced-motion setting.
// Theme-independent: run once, in the light project.
import { test, expect, type Page } from '@playwright/test';
import { seed, settle, themeOf, windowFor, type Seed } from './seed';

let s: Seed;
test.beforeAll(async ({ baseURL }) => { s = await seed(baseURL); });
test.afterAll(async () => { await s?.admin.dispose(); await s?.author.dispose(); });
test.beforeEach(({}, info) => { test.skip(themeOf(info) === 'dark', 'keyboard behaviour does not depend on the theme'); });

const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  return { tag: el?.tagName.toLowerCase() ?? '', id: el?.id ?? '', text: (el?.textContent ?? '').trim().slice(0, 60), testid: el?.getAttribute('data-testid') ?? '', role: el?.getAttribute('role') ?? '' };
});

/** Tab from the top of the page until `match` holds for the focused element (at most `max` presses); returns the number of presses. */
async function tabTo(page: Page, match: (f: Awaited<ReturnType<typeof focused>>) => boolean, max = 80): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    if (match(await focused(page))) return i;
  }
  throw new Error(`not reached with ${max} Tab presses`);
}

test('the first Tab stop is the skip link, and it moves focus to the main landmark (2.4.1)', async ({ browser, baseURL }) => {
  const { ctx, page } = await windowFor(browser, baseURL, s.author, 'light');
  try {
    for (const url of ['/workspace', `/projects/${s.ids.jss}/publication`]) {
      await page.goto(url); await settle(page, 'light');
      await expect(page.locator('main')).toHaveCount(1);
      await page.keyboard.press('Tab');
      expect((await focused(page)).testid, `${url}: first Tab stop`).toBe('skip-link');
      await expect(page.getByTestId('skip-link')).toBeInViewport();
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => document.activeElement?.tagName.toLowerCase()), `${url}: focus after the skip link`).toBe('main');
      expect(new URL(page.url()).hash, 'the skip link leaves the address alone').toBe('');
    }
  } finally { await ctx.close(); }
});

test('every route has its own title (2.4.2)', async ({ browser, baseURL }) => {
  const { ctx, page } = await windowFor(browser, baseURL, s.author, 'light');
  try {
    const titles: string[] = [];
    for (const url of ['/overview', '/workspace', '/projects', '/settings', `/projects/${s.ids.s1000d}/publication`, `/projects/${s.ids.s1000d}/release`, `/projects/${s.ids.s1000d}/validation`, `/projects/${s.ids.jss}/editor`]) {
      await page.goto(url);
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => page.title()).not.toBe('Agastya Platform');
      titles.push(await page.title());
    }
    expect(new Set(titles).size, titles.join(' | ')).toBe(titles.length);
    expect(titles[4]).toMatch(/^Publication · Visual sample S1000D · /);
  } finally { await ctx.close(); }
});

test('a project opens from the Projects table with Tab and Enter (FE-014, 2.1.1)', async ({ browser, baseURL }) => {
  const { ctx, page } = await windowFor(browser, baseURL, s.author, 'light');
  try {
    await page.goto('/projects'); await settle(page, 'light');
    await tabTo(page, (f) => f.tag === 'a' && f.text === 'Visual JSG handbook');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${s.ids.jsg}`));
  } finally { await ctx.close(); }
});

test('the account menu answers the arrow keys and Escape (4.1.2)', async ({ browser, baseURL }) => {
  const { ctx, page } = await windowFor(browser, baseURL, s.author, 'light');
  try {
    await page.goto('/workspace'); await settle(page, 'light');
    await page.getByTestId('account-menu').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
    expect((await focused(page)).text).toBe('Account settings');
    await page.keyboard.press('ArrowDown'); expect((await focused(page)).text).toBe('Sign out');
    await page.keyboard.press('ArrowDown'); expect((await focused(page)).text, 'wraps round').toBe('Account settings');
    await page.keyboard.press('End'); expect((await focused(page)).text).toBe('Sign out');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect((await focused(page)).testid, 'focus is back on the button').toBe('account-menu');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
    await page.keyboard.press('Escape');
  } finally { await ctx.close(); }
});

test('Escape closes only the top dialog; the wizard asks before discarding input (UX-004)', async ({ browser, baseURL }) => {
  const { ctx, page } = await windowFor(browser, baseURL, s.author, 'light');
  try {
    await page.goto('/projects'); await settle(page, 'light');
    const trigger = page.getByRole('button', { name: /New project/ });
    await trigger.focus(); await page.keyboard.press('Enter');
    const wizard = page.getByRole('dialog', { name: /New project/ });
    await expect(wizard).toBeVisible();
    await page.keyboard.press('Escape');                                    // nothing typed yet: closes at once, focus back on the trigger
    await expect(wizard).toHaveCount(0);
    expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);

    await page.keyboard.press('Enter');
    await page.getByTestId('wiz-start-create').click();
    await page.getByTestId('wiz-name').fill('Keyboard draft');
    await page.keyboard.press('Escape');
    const ask = page.getByRole('dialog', { name: 'Discard the new project?' });
    await expect(ask).toBeVisible();
    await expect(wizard).toBeVisible();
    await page.keyboard.press('Escape');                                    // closes the question only
    await expect(ask).toHaveCount(0);
    await expect(wizard).toBeVisible();
    await expect(page.getByTestId('wiz-name')).toHaveValue('Keyboard draft');
    await page.keyboard.press('Escape');
    await ask.getByRole('button', { name: 'Discard' }).click();
    await expect(wizard).toHaveCount(0);
  } finally { await ctx.close(); }
});

test('the editor/PDF divider resizes with the keyboard (UX-005 e)', async ({ browser, baseURL }) => {
  const { ctx, page } = await windowFor(browser, baseURL, s.author, 'light');
  try {
    await page.goto(`/projects/${s.ids.jss}/editor`);
    await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
    const sep = page.getByRole('separator', { name: 'Resize editor and PDF' });
    if (!(await sep.count())) await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(sep).toBeVisible();
    await sep.focus();
    const before = Number(await sep.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Number(await sep.getAttribute('aria-valuenow'))).toBe(Math.max(30, before - 4));
    await page.keyboard.press('Home');
    await expect(sep).toHaveAttribute('aria-valuenow', '30');
    await page.keyboard.press('End');
    await expect(sep).toHaveAttribute('aria-valuenow', '80');
    await page.keyboard.press('ArrowLeft');
    await expect(sep).toHaveAttribute('aria-valuenow', '78');
  } finally { await ctx.close(); }
});

test('status messages have live regions before they arrive; motion stops under reduced motion (4.1.3, UX-028)', async ({ browser, baseURL }) => {
  const { ctx, page } = await windowFor(browser, baseURL, s.author, 'light');
  try {
    await page.goto('/workspace'); await settle(page, 'light');
    await expect(page.getByTestId('toasts-polite')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('toasts-errors')).toHaveCount(1);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'the suite runs with reduced motion').toBe(true);
    const durations = await page.evaluate(() => Array.from(document.querySelectorAll('.v2-pcard, .btn, .v2-divider, .v2-tile')).slice(0, 20)
      .map((el) => getComputedStyle(el).transitionDuration.split(',').map((d) => parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000))).flat());
    expect(durations.length).toBeGreaterThan(0);
    expect(Math.max(...durations), 'no transition longer than a millisecond').toBeLessThan(1);
  } finally { await ctx.close(); }
});
