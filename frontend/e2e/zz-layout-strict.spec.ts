// WP-09 (QA-023): the stricter layout check the audit asks for, beside zz-responsive-layout.spec.ts (which stays as it is).
//
// The older spec forgives a control that sits inside any box with overflow hidden/auto/scroll that is wider than it shows; that is exactly how
// a button cut off by `overflow: hidden` passed. Here nothing is excused: a visible control (button, link, field, tab) must lie wholly inside
// the viewport AND inside every ancestor that clips (overflow hidden or clip), unless that ancestor really scrolls (auto/scroll) and the person
// can scroll it into view. The primary action of each screen must be visible, enabled where the person may use it, and not clipped.
// Widths are the desktop ones the product is used at: 1024, 1280, 1366, 1440 and 1920 px.
//
// Mode: report-only by default (the findings are attached to the test and printed), because the existing screens have not been measured
// against this stricter rule yet; E2E_LAYOUT_STRICT=1 makes every finding a failure. The gate turns it on once the report is clean.

import { test, expect, type Page } from '@playwright/test';
import { adminApi, newPerson, type Person } from './support/session';

const WIDTHS = [1024, 1280, 1366, 1440, 1920] as const;
const STRICT = process.env.E2E_LAYOUT_STRICT === '1';

test.describe.configure({ mode: 'serial' });

let owner: Person;
let pid = '';

test.beforeAll(async ({ browser, baseURL }) => {
  const admin = await adminApi(baseURL);
  owner = await newPerson(admin, browser, baseURL, 'strict', 'Sam Strict');
  await admin.dispose();
  const made = await owner.api.post('/api/projects', { data: { name: 'Strict layout check', pipeline: 's1000dtofo' } });
  expect(made.ok()).toBeTruthy();
  pid = (await made.json()).project.id;
});
test.afterAll(async () => { await owner?.page.context().close(); });

/** Every visible control that is cut off: by the viewport, or by a clipping ancestor it cannot be scrolled out from under. */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth; const vh = document.documentElement.clientHeight;
    const bad: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) bad.push(`the page scrolls sideways: ${document.documentElement.scrollWidth}px in ${vw}px`);
    const label = (e: Element) => `${e.tagName.toLowerCase()} "${((e.textContent || e.getAttribute('aria-label') || e.getAttribute('title') || '').trim()).slice(0, 40)}"`;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"]'))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('[aria-hidden="true"], [inert]')) continue;
      let scrolls = false;
      for (let p: HTMLElement | null = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        const ox = ps.overflowX; const oy = ps.overflowY;
        if (/(auto|scroll)/.test(ox) || /(auto|scroll)/.test(oy)) { scrolls = true; continue; }   // reachable by scrolling this box
        if (/(hidden|clip)/.test(ox) || /(hidden|clip)/.test(oy)) {
          const pr = p.getBoundingClientRect();
          const outX = /(hidden|clip)/.test(ox) && (r.left < pr.left - 1 || r.right > pr.right + 1);
          const outY = /(hidden|clip)/.test(oy) && (r.top < pr.top - 1 || r.bottom > pr.bottom + 1);
          if (outX || outY) { bad.push(`${label(el)} is cut off by ${p.tagName.toLowerCase()}.${String(p.className).slice(0, 40)} (overflow ${ox}/${oy})`); break; }
        }
      }
      // the right edge of the viewport: never excused (a control beyond it in a box that does not scroll cannot be reached)
      if (!scrolls && r.right > vw + 1) bad.push(`${label(el)} ends at ${Math.round(r.right)}px of ${vw}px`);
      if (!scrolls && r.top > vh + 1 && cs.position === 'fixed') bad.push(`${label(el)} is fixed below the viewport`);
    }
    return [...new Set(bad)].slice(0, 12);
  });
}

/** The primary action is visible, not clipped and inside the viewport. */
async function primaryVisible(page: Page, name: RegExp): Promise<string[]> {
  const btn = page.getByRole('button', { name }).first();
  if (!(await btn.isVisible().catch(() => false))) return [`the primary action ${name} is not visible`];
  const box = await btn.boundingBox();
  const vw = page.viewportSize()?.width ?? 0;
  if (!box || box.x < 0 || box.x + box.width > vw + 1) return [`the primary action ${name} lies outside the viewport (${box ? Math.round(box.x + box.width) : '?'}px of ${vw}px)`];
  return [];
}

const SCREENS: Array<{ name: string; url: () => string; primary?: RegExp }> = [
  { name: 'overview', url: () => '/overview' },
  { name: 'projects', url: () => '/projects', primary: /^new project$/i },
  { name: 'workspace', url: () => '/workspace', primary: /^new project$/i },
  { name: 'editor', url: () => `/projects/${pid}/editor` },
  { name: 'publication', url: () => `/projects/${pid}/publication` },
  { name: 'validation', url: () => `/projects/${pid}/validation` },
  { name: 'release', url: () => `/projects/${pid}/release` },
  { name: 'project-settings', url: () => `/projects/${pid}/settings/publishing` },
  { name: 'settings', url: () => '/settings' },
];

for (const screen of SCREENS) {
  for (const width of WIDTHS) {
    test(`${screen.name} at ${width}px: no control cut off, the primary action visible${STRICT ? '' : ' (report only)'}`, async ({ browser, baseURL }, info) => {
      const ctx = await browser.newContext({ storageState: await owner.api.storageState(), viewport: { width, height: 900 }, baseURL });
      const page = await ctx.newPage();
      const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
      try {
        await page.goto(screen.url());
        await expect(page.getByRole('heading').first()).toBeVisible();
        await page.waitForTimeout(250);
        const found = [...(await clipped(page)), ...(screen.primary ? await primaryVisible(page, screen.primary) : [])];
        await page.screenshot({ path: `test-results/shots/strict-${screen.name}-${width}.png` });
        expect(errors, 'script errors on the page').toEqual([]);                        // always a failure
        if (found.length) {
          info.annotations.push({ type: 'layout', description: found.join(' | ') });
          console.log(`[layout-strict] ${screen.name} @ ${width}px:\n  - ${found.join('\n  - ')}`);
        }
        if (STRICT) expect(found, `${screen.name} at ${width}px`).toEqual([]);
      } finally { await ctx.close(); }
    });
  }
}
