// WP-19 (DS-002, DS-005, TH-001, TH-003, TH-004, TH-008, UID-002, UID-003, UID-004): theme parity and component states in a real browser,
// both themes. Computed styles after real :hover / :focus-visible / :disabled; the static version of the matrix is src/styles/states.test.ts.
// Sorts after 00-platform.spec.ts (which creates the administrator through the first-run screen). NOT run by the WP-19 agent (single e2e runner).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, newPerson, type Person } from './support/session';

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext;
let author: Person;
let jsgId = '';

const rgb = (s: string): [number, number, number] => s.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number) as [number, number, number];
const lum = (c: [number, number, number]) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: string, b: string) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => localStorage.setItem('agastya.theme', t), theme);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

/** A fixture of the shell's controls in every state, rendered into the running app so the real stylesheets apply. */
async function fixture(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('wp19-fixture')?.remove();
    const box = document.createElement('div'); box.id = 'wp19-fixture';
    box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;padding:16px;background:var(--bg-elev);display:flex;flex-wrap:wrap;gap:8px;width:900px';
    box.innerHTML = `
      <button class="btn" data-s="btn">Button</button><button class="btn" data-s="btn-dis" disabled>Button</button>
      <button class="btn btn-primary" data-s="pri">Primary</button><button class="btn btn-primary" data-s="pri-dis" disabled>Primary</button>
      <button class="btn btn-primary" data-s="pri-busy" aria-busy="true">Primary</button>
      <button class="icon-btn" data-s="icon" title="An icon button">i</button><button class="icon-btn" data-s="icon-dis" disabled>i</button>
      <input class="v2-input" data-s="in" value="x"><input class="v2-input" data-s="in-dis" value="x" disabled><input class="v2-input" data-s="in-err" aria-invalid="true" value="x">
      <select class="v2-select" data-s="sel"><option>One</option></select><select class="v2-select" data-s="sel-dis" disabled><option>One</option></select>
      <div class="v2-seg"><button data-s="seg">A</button><button class="on" data-s="seg-on">B</button><button data-s="seg-dis" disabled>C</button></div>
      <div class="v2-tabs"><button class="v2-tab" data-s="tab">Tab</button><button class="v2-tab active" data-s="tab-on">Tab</button></div>`;
    document.body.appendChild(box);
  });
}
const cs = (page: Page, s: string, props: string[]) => page.locator(`[data-s="${s}"]`).evaluate((el, p) => { const c = getComputedStyle(el); return Object.fromEntries(p.map((k) => [k, c.getPropertyValue(k)])); }, props);

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await adminApi(baseURL);
  author = await newPerson(admin, browser, baseURL, 'theme', 'Thea Tokens');
  const r = await author.api.post('/api/projects', { data: { name: 'Theme states JSG', format: 'jsg', domain: 'land', manualType: 'uhb' } });
  expect(r.status(), await r.text()).toBe(201); jsgId = (await r.json()).project.id;
});
test.afterAll(async () => { await author.page.context().close(); await admin.dispose(); });

for (const theme of ['light', 'dark'] as const) {
  test(`component states differ from the default and stay readable (${theme})`, async () => {
    const page = author.page;
    await page.goto('/workspace'); await setTheme(page, theme); await fixture(page);
    const P = ['color', 'background-color', 'border-top-color', 'cursor', 'opacity', 'outline-style', 'outline-color', 'pointer-events'];
    for (const [on, off] of [['btn', 'btn-dis'], ['pri', 'pri-dis'], ['icon', 'icon-dis'], ['in', 'in-dis'], ['sel', 'sel-dis'], ['seg', 'seg-dis']]) {
      const a = await cs(page, on, P), b = await cs(page, off, P);
      expect(`${b.color}|${b['background-color']}`, `${off} looks like ${on}`).not.toBe(`${a.color}|${a['background-color']}`);
      expect(b.cursor, `${off} cursor`).toBe('not-allowed');
      expect(Number(b.opacity), `${off} opacity`).toBe(1);
    }
    expect((await cs(page, 'pri-busy', P))['pointer-events']).toBe('none');
    const err = await cs(page, 'in-err', P), ok = await cs(page, 'in', P);
    expect(err['border-top-color']).not.toBe(ok['border-top-color']);
    // the input boundary is a 3:1 control edge (WCAG 1.4.11)
    expect(ratio(ok['border-top-color'], (await page.locator('#wp19-fixture').evaluate((el) => getComputedStyle(el).backgroundColor)))).toBeGreaterThanOrEqual(3);
    // hover and keyboard focus
    const before = await cs(page, 'btn', P);
    await page.locator('[data-s="btn"]').hover();
    expect((await cs(page, 'btn', P))['background-color']).not.toBe(before['background-color']);
    await page.locator('[data-s="seg"]').focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    const f = await cs(page, 'seg', P);
    expect(f['outline-style']).toBe('solid');
    // selected tab and segment: accent text, readable
    for (const s of ['tab-on', 'seg-on']) { const c = await cs(page, s, P); const bg = c['background-color'].includes('0, 0, 0, 0') ? await page.locator('#wp19-fixture').evaluate((el) => getComputedStyle(el).backgroundColor) : c['background-color']; expect(ratio(c.color, bg), s).toBeGreaterThanOrEqual(4.5); }
    // UID-004: the native controls follow the chosen theme, not the OS
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
    await page.evaluate(() => document.getElementById('wp19-fixture')?.remove());
  });

  test(`JSG editor chrome is themed: no light toolbar in dark, the selected tab reads (${theme})`, async () => {
    const page = author.page;
    await page.goto(`/projects/${jsgId}/editor`); await setTheme(page, theme);
    await expect(page.getByTestId('jsg-generate')).toBeVisible({ timeout: 30_000 });
    const tab = page.locator('.jsg-tab.on').first();
    await tab.hover();
    const [c, b] = await tab.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
    expect(ratio(c, b), `selected tab ${c} on ${b}`).toBeGreaterThanOrEqual(4.5);
    const navHead = page.locator('.jsg-nav h4').first();
    if (await navHead.count()) {
      // the colour actually behind the heading: the nearest ancestor with a background (the outline now sits in the editor's explorer pane, transparent itself)
      const [hc, hb] = await navHead.evaluate((el) => { let n: Element | null = el.closest('.jsg-nav'); let bg = 'rgba(0, 0, 0, 0)'; while (n) { bg = getComputedStyle(n).backgroundColor; if (bg !== 'transparent' && !bg.replace(/ /g, '').endsWith(',0)')) break; n = n.parentElement; } return [getComputedStyle(el).color, bg]; });
      expect(ratio(hc, hb)).toBeGreaterThanOrEqual(4.5);
    }
    if (theme === 'dark') {
      for (const sel of ['.jsg-bar', '.jsg-tab', '.jsg-nav']) {
        const bg = await page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
        const [r, g, bl] = rgb(bg);
        if (!bg.includes('0, 0, 0, 0')) expect(r + g + bl, `${sel} background ${bg} should be dark`).toBeLessThan(250);
      }
      // owner, 2026-11-28 (UI round 2, item 5): the editing sheet follows the theme like the S1000D Studio page (dark page, light text);
      // printing and the PDF stay white. Before this the sheet stayed paper-white in dark.
      const [sheet, ink] = await page.locator('.jsg-sheet').first().evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
      const [sr, sg, sb] = rgb(sheet);
      expect(sr + sg + sb, `sheet ${sheet} should be dark in the dark theme`).toBeLessThan(250);
      expect(ratio(ink, sheet), `sheet text ${ink} on ${sheet}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test('the shell modal keeps focus inside and returns it to the trigger (DS-005)', async () => {
  const page = author.page;
  await page.goto('/workspace');
  await page.goto('/projects');
  const trigger = page.getByRole('button', { name: /new project/i }).first();
  test.skip(!(await trigger.count()), 'no New project button on /projects for this person');
  await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `Tab ${i + 1} left the dialog`).toBe(true); }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);
});

test('toasts can be dismissed with the keyboard (DS-005)', async () => {
  const page = author.page;
  await page.goto('/workspace');
  await page.evaluate(async () => { const url = '/src/store/ui.ts'; const m = await import(/* @vite-ignore */ url).catch(() => null); (m as any)?.useUi?.getState().toast('Keyboard toast', 'error'); });
  const toast = page.locator('.v2-toast', { hasText: 'Keyboard toast' });
  if (await toast.count()) {                            // the dev server exposes /src; a built bundle does not (then this part is skipped)
    await toast.getByRole('button', { name: 'Dismiss' }).focus(); await page.keyboard.press('Enter');
    await expect(toast).toHaveCount(0);
  }
});

test('Account settings offer exactly Light and Dark, and a new person starts in light whatever the OS says (owner rule)', async ({ browser, baseURL }) => {
  const page = author.page;
  await page.goto('/settings');
  const group = page.getByTestId('theme-choice');
  await expect(group.getByRole('radio')).toHaveText(['Light', 'Dark']);
  await group.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('agastya.theme'))).toBe('dark');
  await group.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('agastya.theme'))).toBe('light');
  // a fresh browser whose OS prefers dark, with an old stored "system": light (the OS is not followed; "system" is migrated away)
  const ctx = await browser.newContext({ baseURL, colorScheme: 'dark' });
  try {
    const fresh = await ctx.newPage();
    await fresh.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('agastya.theme', 'system'); sessionStorage.setItem('seeded', '1'); } } catch { /* none */ } });
    await fresh.goto('/');
    await expect(fresh.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally { await ctx.close(); }
});

test('a keyboard user sees the hint of an icon button (UID-003)', async () => {
  const page = author.page;
  await page.goto('/workspace');
  await page.getByTestId('account-menu').focus();
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  await expect(page.getByTestId('focus-tooltip')).toHaveText('Account');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus-tooltip')).toHaveCount(0);
});

test('the administrator accent is repaired per theme and the server agrees (TH-003)', async () => {
  for (const accent of ['#ffcc00', '#1d3a8a']) {
    const r = await admin.put('/api/admin/app-settings', { data: { accent } });
    expect(r.status(), await r.text()).toBeLessThan(300);
  }
  const bad = await admin.put('/api/admin/app-settings', { data: { accent: 'yellow' } });
  expect(bad.status()).toBe(400);
  for (const theme of ['light', 'dark'] as const) {
    const page = author.page;
    await page.goto('/workspace'); await setTheme(page, theme);
    const btn = page.locator('.btn-primary').first();
    if (await btn.count()) { const [c, b] = await btn.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]); expect(ratio(c, b), `${theme} primary`).toBeGreaterThanOrEqual(4.5); }
  }
  await admin.put('/api/admin/app-settings', { data: { accent: '' } });
});
