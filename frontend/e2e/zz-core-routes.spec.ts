// WP-07 (UX-001, FE-009, UX-006, QA-023): the core routes open without an error, for every project kind, and the controls a person must
// reach are VISIBLE inside the viewport at 1280, 1366 and 1440 px wide (the layout spec only proves that nothing scrolls sideways; a button
// can still sit past the right edge of a header that does not scroll).
//
// Sorts after 00-platform.spec.ts (which creates the administrator through the first-run screen).

import { test, expect, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import { adminApi, newPerson, type Person } from './support/session';

const WIDTHS = [1280, 1366, 1440] as const;
const BROKEN = /Something went wrong on the server|Internal error|Not a publication module/i;

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext;
let author: Person;
const ids: Record<'s1000d' | 'jss' | 'jsg', string> = { s1000d: '', jss: '', jsg: '' };

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await adminApi(baseURL);
  author = await newPerson(admin, browser, baseURL, 'core', 'Cora Routes');
  const mk = async (data: Record<string, unknown>) => { const r = await author.api.post('/api/projects', { data }); expect(r.status(), await r.text()).toBe(201); return (await r.json()).project.id as string; };
  ids.s1000d = await mk({ name: 'Core routes S1000D', pipeline: 's1000dtofo', s1000d: { mic: 'CORERTE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  ids.jss = await mk({ name: 'Core routes JSS', format: 'jss', domain: 'land', manualType: 'uhb' });
  ids.jsg = await mk({ name: 'Core routes JSG', format: 'jsg', domain: 'land', manualType: 'uhb' });
});
test.afterAll(async () => { await author.page.context().close(); await admin.dispose(); });

/** Visible, and its whole box inside the viewport (not past the right edge, not clipped by a header that does not scroll). */
async function reachable(page: Page, loc: Locator, what: string): Promise<void> {
  await expect(loc, `${what} is visible`).toBeVisible({ timeout: 30_000 });
  const box = await loc.boundingBox(); const vw = page.viewportSize()!.width;
  expect(box, `${what} has a box`).not.toBeNull();
  expect(box!.x, `${what} starts inside the viewport`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${what} ends inside the ${vw}px viewport`).toBeLessThanOrEqual(vw + 0.5);
  const clipped = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p); if (!/(hidden|clip)/.test(cs.overflowX)) continue;
      const pr = p.getBoundingClientRect(); if (r.right > pr.right + 0.5 || r.left < pr.left - 0.5) return `${p.tagName.toLowerCase()}.${p.className}`;
    }
    return '';
  });
  expect(clipped, `${what} is not cut off by its container`).toBe('');
}

async function healthy(page: Page, route: string): Promise<void> {
  await expect(page.locator('body'), `${route}: no server error shown`).not.toContainText(BROKEN, { timeout: 2_000 });
}

for (const width of WIDTHS) {
  test(`core routes at ${width}px: every page opens without an error and its main controls are reachable`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ storageState: await author.api.storageState(), viewport: { width, height: 900 }, baseURL });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      // platform pages
      for (const route of ['/overview', '/workspace', '/projects', '/notifications', '/graphics', '/backup', '/settings']) {
        await page.goto(route); await page.waitForLoadState('networkidle'); await healthy(page, route);
      }
      await page.goto('/projects');
      await reachable(page, page.getByRole('button', { name: /New project/ }), `Projects > New project at ${width}px`);

      // every project page of every kind
      for (const [kind, id] of Object.entries(ids)) {
        for (const sub of ['', '/explore', '/publication', '/validation', '/graphics', '/release', '/settings', ...(kind === 's1000d' ? [] : ['/ancillary'])]) {
          const route = `/projects/${id}${sub}`;
          await page.goto(route); await page.waitForLoadState('networkidle'); await healthy(page, `${kind} ${route}`);
        }
      }
      // the editors' headers: state, layout switch and Generate are reachable
      await page.goto(`/projects/${ids.jss}/editor`); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 }); await healthy(page, 'jss editor');
      await reachable(page, page.getByTestId('jss-generate'), `JSS Generate at ${width}px`);
      await reachable(page, page.getByRole('group', { name: 'Editor layout' }).getByRole('button', { name: 'PDF' }), `JSS PDF switch at ${width}px`);
      await reachable(page, page.getByTestId('jss-state'), `JSS save state at ${width}px`);

      await page.goto(`/projects/${ids.jsg}/editor`); await expect(page.getByTestId('jsg-generate')).toBeVisible({ timeout: 30_000 }); await healthy(page, 'jsg editor');
      await reachable(page, page.getByTestId('jsg-generate'), `JSG Generate at ${width}px`);
      await reachable(page, page.getByRole('group', { name: 'Editor layout' }).getByRole('button', { name: 'PDF' }), `JSG PDF switch at ${width}px`);

      await page.goto(`/projects/${ids.s1000d}/editor`); await expect(page.getByTestId('save-state')).toBeVisible({ timeout: 60_000 }); await healthy(page, 's1000d editor');
      await reachable(page, page.getByTestId('save-state'), `S1000D save state at ${width}px`);
      await reachable(page, page.getByRole('group', { name: 'Editor layout' }).last(), `S1000D layout switch at ${width}px`);
      await page.getByTestId('explorer-menu').click();   // UI redesign: these commands are in the explorer's menu
      await reachable(page, page.getByTestId('view-tree'), `S1000D Publication switch at ${width}px`);
      expect(await page.getByTestId('view-tree').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'the Publication switch label is not cut ("Publica")').toBe(true);

      expect(errors, 'no script error on any page').toEqual([]);
    } finally { await ctx.close(); }
  });
}

test('the sign-in screen: the tagline names all three formats, and an error does not follow onto the reset screen (UX-026, UX-023)', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL }); const page = await ctx.newPage();
  try {
    await page.goto('/');
    await expect(page.getByText(/S1000D, JSS and JSG/)).toBeVisible();
    await page.getByLabel('Username').fill('nobody'); await page.getByLabel('Password').fill('wrong-password-123'); await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/Invalid username or password/i)).toBeVisible();
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await expect(page.getByText(/Invalid username or password/i)).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to sign in' }).click();
    await expect(page.getByText(/Invalid username or password/i)).toHaveCount(0);
  } finally { await ctx.close(); }
});

test('empty states and the PDF placeholder: emphasis stays inline, title and text align alike (UX-016, DS-004)', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ storageState: await author.api.storageState(), viewport: { width: 1440, height: 900 }, baseURL });
  const page = await ctx.newPage();
  try {
    await page.goto(`/projects/${ids.jss}/editor`); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('group', { name: 'Editor layout' }).getByRole('button', { name: 'Split' }).click();
    const steps = page.locator('.v2-empty-steps li strong');
    await expect(steps.first()).toBeVisible();
    for (const d of await steps.evaluateAll((els) => els.map((e) => getComputedStyle(e).display))) expect(d).toBe('inline');
    await page.goto('/notifications');
    const empty = page.locator('.v2-empty').first();                          // a new author has no notifications
    await expect(empty).toBeVisible();
    const [t, b] = await empty.evaluate((el) => [getComputedStyle(el.querySelector('.v2-empty-title')!).textAlign, getComputedStyle(el).textAlign]);
    expect(t).toBe(b);
    expect(b).toBe('center');
  } finally { await ctx.close(); }
});
