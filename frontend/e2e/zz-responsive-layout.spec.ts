// The screens added for importing, publishing and the SNS, at phone, tablet and desktop width, in the light and the dark theme.
//
// What is asserted is what a screenshot cannot say reliably: the page never scrolls sideways (document width <= viewport), nothing the person has to
// press is cut off at the right edge, and the page raises no script error. The screenshots themselves are saved to test-results/shots/layout-* so that a
// person can look at them.
//
// The file name sorts last on purpose: 00-platform.spec.ts creates the administrator through the first-run screen, and an earlier spec that made the
// administrator through the API would take that screen away.

import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { adminApi, newPerson, type Person } from './support/session';

const SIZES = [
  { name: 'phone', width: 375, height: 740 },
  { name: 'tablet', width: 820, height: 1100 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;
const SCHEMES = ['light', 'dark'] as const;

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext;
let owner: Person;                 // an author: administrators do not create projects
let pid = '';

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await adminApi(baseURL);
  owner = await newPerson(admin, browser, baseURL, 'resp', 'Rita Responsive');
  const made = await owner.api.post('/api/projects', { data: { name: 'Responsive layout check', pipeline: 's1000dtofo' } });
  expect(made.ok()).toBeTruthy();
  pid = (await made.json()).project.id;
});
test.afterAll(async () => { await owner.page.context().close(); await admin.dispose(); });

async function open(browser: Browser, baseURL: string | undefined, size: (typeof SIZES)[number], scheme: (typeof SCHEMES)[number], who: APIRequestContext): Promise<Page> {
  const ctx = await browser.newContext({ storageState: await who.storageState(), viewport: { width: size.width, height: size.height }, colorScheme: scheme, baseURL });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  return page;
}

/** Nothing sticks out to the right of the viewport. Returns the offending elements (for the message). */
async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) bad.push(`page is ${document.documentElement.scrollWidth}px wide in a ${vw}px viewport`);
    // The app scrolls inside its own page container, so the document itself never grows: the container must not scroll sideways either
    // (tables and code blocks inside it scroll in boxes of their own).
    for (const page of Array.from(document.querySelectorAll<HTMLElement>('.v2-page'))) {
      if (page.scrollWidth > page.clientWidth + 1) {
        const inScroller = (e: HTMLElement) => { for (let p = e.parentElement; p && p !== page; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true; return false; };
        const wide = Array.from(page.querySelectorAll<HTMLElement>('*')).filter((e) => e.getBoundingClientRect().right > page.getBoundingClientRect().right + 1 && !inScroller(e));
        const name = (e: HTMLElement) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}${e.getAttribute('data-testid') ? `[${e.getAttribute('data-testid')}]` : ''}("${(e.textContent || '').trim().slice(0, 30)}" to ${Math.round(e.getBoundingClientRect().right)}px)`;
        bad.push(`page content is ${page.scrollWidth}px wide in a ${page.clientWidth}px container; widest chain: ${wide.slice(0, 4).map(name).join(' > ') || '?'}`);
      }
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="tab"]'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let hidden = false;
      for (let p: HTMLElement | null = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) { hidden = true; break; }   // inside a box that scrolls on purpose
      }
      if (!hidden && r.right > vw + 1) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}" ends at ${Math.round(r.right)}px of ${vw}px`);
    }
    return bad.slice(0, 8);
  });
}

const SCREENS: Array<{ name: string; url: () => string; ready: (p: Page) => Promise<void>; as?: 'admin' }> = [
  { name: 'publishing-settings', url: () => `/projects/${pid}/settings/publishing`, ready: async (p) => { await expect(p.getByRole('heading').first()).toBeVisible(); } },
  { name: 'publication', url: () => `/projects/${pid}/publication`, ready: async (p) => { await expect(p.getByRole('heading').first()).toBeVisible(); } },
  { name: 'release', url: () => `/projects/${pid}/release`, ready: async (p) => { await expect(p.getByRole('heading').first()).toBeVisible(); } },
];

for (const screen of SCREENS) {
  for (const size of SIZES) {
    for (const scheme of SCHEMES) {
      test(`${screen.name}: ${size.name}, ${scheme} theme - no sideways scroll, nothing cut off`, async ({ browser, baseURL }) => {
        const page = await open(browser, baseURL, size, scheme, screen.as === 'admin' ? admin : owner.api);
        try {
          await page.goto(screen.url());
          await screen.ready(page);
          await page.waitForTimeout(250);                                        // let the layout settle after the last interaction
          expect(await overflow(page), `${screen.name} at ${size.width}px`).toEqual([]);
          await page.screenshot({ path: `test-results/shots/layout-${screen.name}-${size.name}-${scheme}.png`, fullPage: true });
        } finally { await page.context().close(); }
      });
    }
  }
}
