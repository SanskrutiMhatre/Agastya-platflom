// WP-21 editor-chrome conformance: the three editors (S1000D Studio, JSS, JSG) are one product in their chrome (UX-003, FE-021).
//
//   - the same header controls, the same save-state words, the same keys: Ctrl+S, Ctrl+F, Ctrl+K, F1, Ctrl+. and Esc, and one shortcuts dialog each
//   - Write is the default of a new session and the editing surface takes at least 55% of a 1366x768 screen (UX-002; 70% in focus mode)
//   - no sideways scroll at 683, 820 and 1024 px (UX-020)
//   - JSS has find and replace (UX-017); a refused save can be compared and merged (PRD-004); a deep link that matches nothing says so (GAP-004)
//
// Every test opens a fresh browser context (a fresh profile: nothing remembered from an earlier spec), against the real server.

import { test, expect, type Browser, type Page, type APIRequestContext } from '@playwright/test';
import { adminApi, newPerson, type Person } from './support/session';

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext; let author: Person;
const ids = { s1000d: '', jss: '', jsg: '' };
let dmFile = '';

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  admin = await adminApi(baseURL);
  author = await newPerson(admin, browser, baseURL, 'wp21', 'Chrome Author');
  ids.s1000d = (await (await author.api.post('/api/projects/sample', { data: {} })).json()).project.id;
  const jss = await author.api.post('/api/projects', { data: { name: 'WP21 JSS', format: 'jss', domain: 'land', manualType: 'uhb' } }); expect(jss.status()).toBe(201);
  ids.jss = (await jss.json()).project.id;
  const jsg = await author.api.post('/api/projects', { data: { name: 'WP21 JSG', format: 'jsg', domain: 'land', manualType: 'uhb' } }); expect(jsg.status()).toBe(201);
  ids.jsg = (await jsg.json()).project.id;
  dmFile = (await (await author.api.get(`/api/projects/${ids.s1000d}/dms`)).json()).dms[0].file as string;
});
test.afterAll(async () => { await author.page.context().close(); await admin.dispose(); });

async function fresh(browser: Browser, baseURL: string | undefined, width = 1366, height = 768): Promise<Page> {
  const ctx = await browser.newContext({ storageState: await author.api.storageState(), viewport: { width, height }, baseURL });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
  return page;
}

const EDITORS = [
  { kind: 's1000d', state: 'save-state', surface: '.editor-host', ready: (p: Page) => expect(p.getByTestId('studio-host')).toBeVisible({ timeout: 60_000 }) },
  { kind: 'jss', state: 'jss-state', surface: '[data-testid="jss-host"]', ready: (p: Page) => expect(p.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 }) },
  { kind: 'jsg', state: 'jsg-state', surface: '[data-testid="jsg-host"]', ready: (p: Page) => expect(p.getByTestId('jsg-host')).toBeVisible({ timeout: 30_000 }) },
] as const;

async function open(page: Page, e: (typeof EDITORS)[number], query = '') {
  await page.goto(`/projects/${ids[e.kind]}/editor${query}`);
  await e.ready(page);
  if (e.kind === 's1000d' && !query) {
    await page.getByTestId('dm-list').locator(`[data-file="${dmFile}"]`).click();
    await expect(page.locator('.design-page:visible')).toBeVisible({ timeout: 30_000 });
  }
}

/** the share of the viewport the editing surface covers */
const share = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)); const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
  return (w * h) / (innerWidth * innerHeight);
});

for (const e of EDITORS) {
  test(`${e.kind}: the shared header, Write by default with the mockup's panels open and at least 30% of 1366x768, the palette, the shortcuts, focus mode and Esc`, async ({ browser, baseURL }) => {
    const page = await fresh(browser, baseURL);
    try {
      await open(page, e);
      const head = page.getByTestId('editor-header');
      for (const id of ['chrome-palette', 'chrome-shortcuts', 'chrome-focus']) await expect(head.getByTestId(id)).toBeVisible();
      const seg = head.getByRole('group', { name: 'Editor layout' });
      await expect(seg.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-pressed', 'true');          // a new session is in Write
      for (const v of ['Split', 'PDF']) await expect(seg.getByRole('button', { name: v })).toBeVisible();
      await expect(page.getByTestId(e.state)).toHaveText(/All changes saved/);                                   // the same words in all three

      const area = await share(page, e.surface);
      console.log(`${e.kind}: editing surface ${(area * 100).toFixed(1)}% of 1366x768 in Write`);
      // UI redesign 2026-11-28: the first view is the owner-approved mockup's (docs/audit/mockups/editor.html): explorer 248 px, Properties
      // 288 px and Problems 148 px open beside and under the document, as in the mockup itself (its document area is about 34% of 1366x768);
      // the WP-21 "panels closed, 55%" first view is replaced. Focus mode below still gives the page at least 70%.
      if (e.kind === 's1000d') await expect(page.locator('.app--embedded > .pane-bottom')).toBeVisible();
      else if (e.kind === 'jss') await expect(page.getByTestId('jss-problems')).toHaveAttribute('open', '');
      else await expect(page.getByTestId('doc-problems')).toBeVisible();
      await expect(page.getByRole('complementary', { name: e.kind === 's1000d' ? 'Data modules' : 'Explorer' })).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Properties' }).first()).toBeVisible();
      expect(area).toBeGreaterThanOrEqual(0.3);

      // Ctrl+K: the command palette; Esc closes it
      await page.locator(e.surface).first().click({ position: { x: 5, y: 5 } }).catch(() => undefined);
      await page.keyboard.press('Control+k');
      const pal = page.getByRole('dialog', { name: 'Command palette' });
      await expect(pal).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(pal).toHaveCount(0);
      // the header button opens the same palette
      await head.getByTestId('chrome-palette').click();
      await expect(pal).toBeVisible(); await page.keyboard.press('Escape'); await expect(pal).toHaveCount(0);

      // F1 and the header button: one shortcuts dialog
      await page.keyboard.press('F1');
      const keys = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await expect(keys).toBeVisible(); await expect(keys).toContainText(/Ctrl\+K|Ctrl K/);
      await page.keyboard.press('Escape'); await expect(keys).toHaveCount(0);
      await head.getByTestId('chrome-shortcuts').click();
      await expect(keys).toBeVisible(); await page.keyboard.press('Escape'); await expect(keys).toHaveCount(0);

      // Ctrl+. focus mode: the project rail and the side panels step aside, at least 70% for the page
      await page.keyboard.press('Control+.');
      await expect(head.getByTestId('chrome-focus')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-editor-focus', /.*/);
      const focused = await share(page, e.surface);
      console.log(`${e.kind}: editing surface ${(focused * 100).toFixed(1)}% in focus mode`);
      expect(focused).toBeGreaterThanOrEqual(0.7);
      await head.getByTestId('chrome-focus').click();
      await expect(head.getByTestId('chrome-focus')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('html')).not.toHaveAttribute('data-editor-focus', /.*/);

      // the chosen layout survives a reload
      await seg.getByRole('button', { name: 'Split' }).click();
      await page.reload(); await e.ready(page);
      await expect(page.getByTestId('editor-header').getByRole('group', { name: 'Editor layout' }).getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true');
    } finally { await page.context().close(); }
  });
}

test('Esc leaves focus mode in the JSS and JSG editors', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  try {
    for (const e of EDITORS.filter((x) => x.kind !== 's1000d')) {
      await open(page, e);
      await page.getByTestId('chrome-focus').click();
      await expect(page.getByTestId('chrome-focus')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chrome-focus')).toHaveAttribute('aria-pressed', 'false');
    }
  } finally { await page.context().close(); }
});

test('Ctrl+S saves and Ctrl+F finds in all three editors, with the same state words', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL, 1440, 900);
  try {
    // S1000D: an edit in the XML view, Ctrl+S
    await open(page, EDITORS[0]);
    await page.locator('.vs-btn', { hasText: 'XML' }).click();
    await page.evaluate(() => { const v = (window as any).studio.active.xml.view; const i = v.state.doc.toString().indexOf('</para>'); v.dispatch({ changes: { from: i, to: i, insert: ' WP21' } }); });
    await expect(page.getByTestId('save-state')).toHaveText(/Unsaved changes/);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('save-state')).toHaveText(/Saved/, { timeout: 15_000 });
    await page.keyboard.press('Control+f');
    await expect(page.locator('.find-bar:visible, .cm-search').first()).toBeVisible();          // the Studio's own find (CodeMirror's in the XML view)
    await page.keyboard.press('Escape');

    // JSS: type, Ctrl+S; Ctrl+F opens the host find bar
    await open(page, EDITORS[1]);
    const purpose = page.getByTestId('jss-paper').locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
    await purpose.locator('.jss-para, .jss-empty').first().click(); await page.keyboard.press('End'); await page.keyboard.type('Chrome check ');
    await expect(page.getByTestId('jss-state')).toHaveText(/Unsaved changes/);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 15_000 });
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('host-find')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('host-find')).toHaveCount(0);

    // JSG: type, Ctrl+S; Ctrl+F opens its find bar
    await open(page, EDITORS[2]);
    await page.locator('[data-testid="jsg-host"] [contenteditable="true"]').first().click(); await page.keyboard.type('Chrome check ');
    await expect(page.getByTestId('jsg-state')).toHaveText(/Unsaved changes/);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('jsg-state')).toHaveText(/Saved/, { timeout: 15_000 });
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('jsg-find')).toBeVisible();
  } finally { await page.context().close(); }
});

test('JSS find and replace (UX-017): counts the matches, replaces one and all, and the change is saved', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL, 1440, 900);
  try {
    await open(page, EDITORS[1]);
    const purpose = page.getByTestId('jss-paper').locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
    await purpose.locator('.jss-para, .jss-empty').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' ALPHA one ALPHA two ALPHA');
    await page.keyboard.press('Control+h');
    await expect(page.getByTestId('host-find')).toBeVisible();
    await page.getByTestId('find-input').fill('ALPHA');
    await expect(page.getByTestId('find-count')).toHaveText('1 of 3');
    await page.getByTestId('find-input').press('Enter');
    await expect(page.getByTestId('find-count')).toHaveText('2 of 3');
    await page.getByTestId('replace-input').fill('OMEGA');
    await page.getByTestId('replace-one').click();
    await expect(page.getByTestId('find-count')).toHaveText(/of 2/);
    await page.getByTestId('replace-all').click();
    await expect(page.getByTestId('find-count')).toHaveText('No matches');
    await expect(page.getByTestId('jss-paper')).toContainText('OMEGA one OMEGA two OMEGA');
    await expect(page.getByTestId('jss-state')).toHaveText(/Unsaved changes/);
    await page.keyboard.press('Escape'); await expect(page.getByTestId('host-find')).toHaveCount(0);
    await page.getByTestId('jss-save').click();
    await expect(page.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 15_000 });
    expect((await (await author.api.get(`/api/projects/${ids.jss}/jss`)).json()).xml).toContain('OMEGA one OMEGA two OMEGA');
  } finally { await page.context().close(); }
});

test('a refused JSS save can be compared and merged: both changes kept, checked, saved (PRD-004)', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL, 1440, 900);
  try {
    await open(page, EDITORS[1]);
    const purpose = page.getByTestId('jss-paper').locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
    await purpose.locator('.jss-para, .jss-empty').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' MINE-MERGE');
    await expect(page.getByTestId('jss-state')).toHaveText(/Unsaved changes/);
    // someone else saves meanwhile, in the same chapter but another section (Features, after Purpose). WP-11 (D22): the server merges saves
    // that touch different chapters by itself, so the refusal - and this compare-and-merge - is for two changes in one chapter.
    const cur = await (await author.api.get(`/api/projects/${ids.jss}/jss`)).json();
    const xml = cur.xml as string; const at = xml.indexOf('</section>', xml.indexOf('>Features<')); expect(xml.indexOf('>Features<')).toBeGreaterThan(0); expect(at).toBeGreaterThan(0);
    expect((await author.api.put(`/api/projects/${ids.jss}/jss`, { data: { xml: `${xml.slice(0, at)}<para>THEIRS-MERGE</para>${xml.slice(at)}`, baseHash: cur.hash } })).ok()).toBeTruthy();
    await page.getByTestId('jss-save').click();
    await expect(page.getByTestId('jss-conflict')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('conflict-compare').click();
    const dlg = page.getByTestId('merge-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('merge-change').filter({ hasText: 'MINE-MERGE' })).toBeVisible();
    await expect(dlg.getByTestId('merge-change').filter({ hasText: 'THEIRS-MERGE' })).toBeVisible();
    await expect(dlg.getByTestId('merge-conflict')).toHaveCount(0);
    await page.getByTestId('merge-save').click();
    await expect(page.getByTestId('merge-dialog')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('jss-paper')).toContainText('MINE-MERGE', { timeout: 15_000 });
    await expect(page.getByTestId('jss-paper')).toContainText('THEIRS-MERGE');
    await expect(page.getByTestId('jss-state')).toHaveText(/Saved|All changes saved/);
    const saved = (await (await author.api.get(`/api/projects/${ids.jss}/jss`)).json()).xml as string;
    expect(saved).toContain('MINE-MERGE'); expect(saved).toContain('THEIRS-MERGE');
  } finally { await page.context().close(); }
});

test('a deep link to a section that is no longer there says so (GAP-004)', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL, 1440, 900);
  try {
    await open(page, EDITORS[1], `?goto=${encodeURIComponent('t:1:a section nobody wrote')}`);
    await expect(page.getByTestId('goto-missing')).toBeVisible({ timeout: 15_000 });
    await open(page, EDITORS[2], `?goto=${encodeURIComponent('t:1:a section nobody wrote')}`);
    await expect(page.getByTestId('goto-missing')).toBeVisible({ timeout: 15_000 });
  } finally { await page.context().close(); }
});

test('the S1000D ribbon folds to its tabs by default; a tab shows its commands until one is used; the pin keeps it open (UX-002, UX-012)', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL);
  try {
    await open(page, EDITORS[0]);
    const body = page.locator('.ribbon-body');
    await expect(page.locator('.ribbon')).toHaveClass(/is-collapsed/);
    await expect(body).toBeHidden();
    // UI redesign: the folded ribbon is hidden under the one-row toolbar; the toolbar's last button shows it (its tabs, then a tab's commands)
    await expect(page.locator('.ribbon-tab[data-tab]').first()).toBeHidden();
    await page.getByTestId('ribbon-toggle').click();
    await expect(page.getByTestId('ribbon-toggle')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.ribbon-tab[data-tab="insert"], .ribbon-tab[data-tab]').nth(1).click();
    await expect(body).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(body).toBeHidden();
    await page.getByTestId('ribbon-toggle').click();                                                          // show the folded ribbon again to reach its pin
    await page.getByTestId('ribbon-pin').click();
    await expect(body).toBeVisible();
    await page.reload(); await EDITORS[0].ready(page);
    await expect(page.locator('.ribbon-body')).toBeVisible();                                                 // the choice is remembered
    await page.keyboard.press('Control+F1');
    await expect(page.locator('.ribbon-body')).toBeHidden();
  } finally { await page.context().close(); }
});

for (const width of [683, 820, 1024]) {
  test(`no sideways scroll in the three editors at ${width} px (UX-020)`, async ({ browser, baseURL }) => {
    const page = await fresh(browser, baseURL, width, 768);
    try {
      for (const e of EDITORS) {
        await open(page, e);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over, `${e.kind} at ${width}px scrolls sideways by ${over}px`).toBeLessThanOrEqual(1);
        const head = page.getByTestId('editor-header');
        for (const id of ['chrome-palette', 'chrome-focus']) {
          const box = (await head.getByTestId(id).boundingBox())!;
          expect(box.x + box.width, `${e.kind} ${id} inside the window at ${width}px`).toBeLessThanOrEqual(width + 1);
        }
      }
    } finally { await page.context().close(); }
  });
}
