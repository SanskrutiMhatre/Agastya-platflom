// WP-20 (TH-009, QA-012, DS-010; audit 08 sections 7.4-7.5, 11 section 10.8): per-theme visual baselines of the key screens and of the design-system
// fixture, a guard against a vacuous baseline (the dark picture must be dark), the live theme switch, and computed-style checks of the
// component states in a real browser. Baselines live in e2e/visual/__screenshots__/<theme>/; update them only with --update-snapshots and review
// the light and dark picture of a screen together.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { SCREENS } from './routes';
import { markVolatile, seed, settle, themeOf, windowFor, type Seed } from './seed';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '..', '..', 'dist');

let s: Seed;
test.beforeAll(async ({ baseURL }) => { s = await seed(baseURL); });
test.afterAll(async () => { await s?.admin.dispose(); await s?.author.dispose(); });

// Pinned browser: the first baseline run writes the browser version beside the pictures; a different version is reported (not failed: the
// pixel comparison decides), so a reviewer knows why many pictures moved at once.
test('the browser is the pinned one', async ({ browser }, info) => {
  const file = path.join(HERE, '__screenshots__', 'BROWSER.txt');
  const now = `${info.project.use.channel ?? 'chromium'} ${browser.version()}`;
  if (!fs.existsSync(file) || info.config.updateSnapshots === 'all') { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${now}\n`); }
  const pinned = fs.readFileSync(file, 'utf8').trim();
  if (pinned.split(' ')[1]?.split('.')[0] !== browser.version().split('.')[0]) console.log(`[visual] baselines were taken with ${pinned}; this run uses ${now}`);
  expect(info.project.use.channel, 'the reference browser (D18)').toBe(process.env.E2E_CHANNEL || 'msedge');
});

for (const screen of SCREENS) {
  test(`${screen.name}: matches its baseline`, async ({ browser, baseURL }, info) => {
    const theme = themeOf(info);
    const who = screen.as === 'admin' ? s.admin : screen.as === 'author' ? s.author : null;
    const { ctx, page, errors } = await windowFor(browser, baseURL, who, theme);
    try {
      await page.goto(screen.url(s));
      await screen.ready(page);
      await settle(page, theme);
      await markVolatile(page);
      await expect(page).toHaveScreenshot(`${screen.name}.png`, { mask: [page.locator('[data-vmask]')] });
      expect(errors, 'no script error').toEqual([]);
    } finally { await ctx.close(); }
  });
}

/** The design-system fixture on the app's origin, with the built entry stylesheet(s). */
async function designSystem(page: Page): Promise<void> {
  const index = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const links = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map((m) => m[0]).join('\n');
  expect(links, 'the build links its entry stylesheet').toContain('.css');
  const html = fs.readFileSync(path.join(HERE, 'design-system.html'), 'utf8').replace('<!--STYLES-->', links);
  await page.route('**/__design-system', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('/__design-system');
}

test('design system: every component in its states matches its baseline', async ({ browser, baseURL }, info) => {
  const theme = themeOf(info);
  const { ctx, page } = await windowFor(browser, baseURL, null, theme);
  try {
    await page.setViewportSize({ width: 1366, height: 1100 });
    await designSystem(page);
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await settle(page, theme);
    await expect(page).toHaveScreenshot('design-system.png', { fullPage: true });
  } finally { await ctx.close(); }
});

const rgb = (c: string): [number, number, number] => (c.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number) as [number, number, number];
const lum = (c: [number, number, number]) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: string, b: string) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('design system: real :hover, :focus-visible and :disabled differ from the default and stay readable', async ({ browser, baseURL }, info) => {
  const theme = themeOf(info);
  const { ctx, page } = await windowFor(browser, baseURL, null, theme);
  try {
    await designSystem(page);
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    const style = (sel: string) => page.locator(sel).first().evaluate((el) => {
      const c = getComputedStyle(el); return { color: c.color, bg: c.backgroundColor, border: c.borderColor, outline: `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}`, shadow: c.boxShadow, cursor: c.cursor };
    });
    for (const c of ['btn', 'btn-primary', 'icon-btn', 'tab']) {
      const base = await style(`[data-c="${c}"][data-s="default"], [data-c="${c}"][data-s="selected"]`);
      const hoverSel = `[data-c="${c}"][data-s="hover"]`;
      if (await page.locator(hoverSel).count()) {
        await page.locator(hoverSel).hover();
        const h = await style(hoverSel);
        expect(`${h.color}|${h.bg}|${h.border}`, `${c} hover looks like its default (${theme})`).not.toBe(`${base.color}|${base.bg}|${base.border}`);
        if (!/rgba\(0, 0, 0, 0\)/.test(h.bg)) expect(ratio(h.color, h.bg), `${c} hover text (${theme})`).toBeGreaterThanOrEqual(4.5);
        await page.mouse.move(0, 0);
      }
      const dis = `[data-c="${c}"][data-s="disabled"]`;
      if (await page.locator(dis).count()) {
        const d = await style(dis);
        expect(d.cursor, `${c} disabled cursor`).toBe('not-allowed');
        expect(`${d.color}|${d.bg}`, `${c} disabled looks enabled (${theme})`).not.toBe(`${base.color}|${base.bg}`);
      }
    }
    // keyboard focus: Tab onto a button and the ring is drawn (2px, 3:1 against the card)
    await page.locator('[data-c="btn"][data-s="focus"]').focus();
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    const f = await style('[data-c="btn"][data-s="focus"]');
    expect(f.outline, `focus ring (${theme})`).toMatch(/solid 2px/);
    const card = await page.locator('[data-c="buttons"]').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(ratio(f.outline.replace(/^solid 2px /, ''), card), `focus ring vs card (${theme})`).toBeGreaterThanOrEqual(3);
    // status colours: every badge, alert and toast reads in this theme
    for (const sel of ['[data-c="badge"]', '[data-c="alert"]', '[data-c="toast"] .v2-toast-text', '[data-c="field"] .v2-error', '.v2-stat dd']) {
      for (const el of await page.locator(sel).all()) {
        const [fg, bg] = await el.evaluate((x) => { let b = 'rgba(0, 0, 0, 0)'; for (let e: Element | null = x; e && /rgba\(0, 0, 0, 0\)/.test(b); e = e.parentElement) b = getComputedStyle(e).backgroundColor; return [getComputedStyle(x).color, b]; });
        expect(ratio(fg, bg), `${sel} "${(await el.textContent())?.trim()}" (${theme})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  } finally { await ctx.close(); }
});

/** Mean relative luminance of a PNG, decoded by the browser itself (no image library in node_modules). */
async function meanLuminance(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0; const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    for (let i = 0; i < d.length; i += 16) sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    return sum / (d.length / 16);
  }, png.toString('base64'));
}

// 08 section 7.4: a build where the theme attribute stops working fails here even if someone updates the snapshots.
test('the theme really applies: dark pictures are dark, light pictures are light, and the toggle switches live', async ({ browser, baseURL }, info) => {
  const theme = themeOf(info);
  const { ctx, page } = await windowFor(browser, baseURL, s.author, theme);
  try {
    await page.goto('/workspace');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await settle(page, theme);
    const l = await meanLuminance(page, await page.screenshot());
    if (theme === 'dark') expect(l, 'mean luminance of the dark workspace').toBeLessThan(0.35);
    else expect(l, 'mean luminance of the light workspace').toBeGreaterThan(0.6);
    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const other = theme === 'dark' ? 'light' : 'dark';
    await expect(page.getByTestId('theme-toggle')).toHaveAccessibleName(`Switch to ${other} theme`);   // owner rule: one icon button, two themes
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', other);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'the page repaints without a reload').not.toBe(before);
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  } finally { await ctx.close(); }
});
