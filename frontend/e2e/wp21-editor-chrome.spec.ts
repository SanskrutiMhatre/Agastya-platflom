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
import { classicOnly } from './support/live';

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
      // second pass: the labelled Editor | Split | PDF switch sits at the right end of the document tab row, above the canvas (not in the top bar)
      const seg = page.getByTestId('view-switch');
      await expect(head.getByRole('group', { name: 'Editor layout' })).toHaveCount(0);
      await expect(page.locator(e.kind === 's1000d' ? '.app-header [data-testid="view-switch"]' : '[data-testid="doc-tabs"] [data-testid="view-switch"]')).toBeVisible();
      await expect(seg.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-pressed', 'true');          // a new session is in Write
      for (const v of ['Split', 'PDF']) await expect(seg.getByRole('button', { name: v })).toBeVisible();
      // the same words in all three: a live document (Phase 3, the default) is "Saved" when the server has every change ("All changes saved"
      // is the classic editor's word for the same, see the Ctrl+S test's classic run)
      await expect(page.getByTestId(e.state)).toHaveText(/^Saved/, { timeout: 20_000 });

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
      await expect(page.getByTestId('view-switch').getByRole('button', { name: 'Split' })).toHaveAttribute('aria-pressed', 'true');
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

// Phase 3 / Phase 8: a live editor (the default) sends every change as it is typed: the state is "Saved" (or "Syncing…" for a moment), never
// "Unsaved changes", and Ctrl+S writes the file through the room. The classic run is the fallback when the room cannot be joined
// (C24, a server with AGASTYA_COLLAB=0; here: this browser's joins are answered DISABLED, e2e/support/live.ts): "Unsaved changes", then "Saved".
for (const mode of ['live', 'classic'] as const) {
  test(`Ctrl+S saves and Ctrl+F finds in all three editors, with the same state words (${mode})`, async ({ browser, baseURL }) => {
    const page = await fresh(browser, baseURL, 1440, 900);
    if (mode === 'classic') await classicOnly(page.context());
    const edited = mode === 'live' ? /^(Saved|Syncing)/ : /Unsaved changes/;
    const mark = `WP21${mode.toUpperCase()}`;
    const file = async (kind: 'dm' | 'jss' | 'jsg'): Promise<string> => (await (await author.api.get(kind === 'dm' ? `/api/projects/${ids.s1000d}/dms/${dmFile}` : `/api/projects/${ids[kind]}/${kind}`)).json()).xml as string;
    try {
      // S1000D: an edit in the XML view, Ctrl+S
      await open(page, EDITORS[0]);
      await page.locator('.vs-btn', { hasText: 'XML' }).click();
      await page.evaluate((m) => { const v = (window as any).studio.active.xml.view; const i = v.state.doc.toString().indexOf('</para>'); v.dispatch({ changes: { from: i, to: i, insert: ` ${m}` } }); }, mark);
      await expect(page.getByTestId('save-state')).toHaveText(edited);
      await page.keyboard.press('Control+s');
      await expect(page.getByTestId('save-state')).toHaveText(/Saved/, { timeout: 15_000 });
      await expect.poll(() => file('dm'), { timeout: 15_000 }).toContain(mark);
      await page.keyboard.press('Control+f');
      await expect(page.locator('.find-bar:visible, .cm-search').first()).toBeVisible();          // the Studio's own find (CodeMirror's in the XML view)
      await page.keyboard.press('Escape');

      // JSS: type, Ctrl+S; Ctrl+F opens the host find bar
      await open(page, EDITORS[1]);
      const purpose = page.getByTestId('jss-paper').locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
      await purpose.locator('.jss-para, .jss-empty').first().click(); await page.keyboard.press('End'); await page.keyboard.type(`Chrome check ${mark} `);
      await expect(page.getByTestId('jss-state')).toHaveText(edited);
      await page.keyboard.press('Control+s');
      await expect(page.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 15_000 });
      await expect.poll(() => file('jss'), { timeout: 15_000 }).toContain(mark);
      await page.keyboard.press('Control+f');
      await expect(page.getByTestId('host-find')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('host-find')).toHaveCount(0);

      // JSG: type, Ctrl+S; Ctrl+F opens its find bar
      await open(page, EDITORS[2]);
      await page.locator('[data-testid="jsg-host"] [contenteditable="true"]').first().click(); await page.keyboard.type(`Chrome check ${mark} `);
      await expect(page.getByTestId('jsg-state')).toHaveText(edited);
      await page.keyboard.press('Control+s');
      await expect(page.getByTestId('jsg-state')).toHaveText(/Saved/, { timeout: 15_000 });
      await expect.poll(() => file('jsg'), { timeout: 15_000 }).toContain(mark);
      await page.keyboard.press('Control+f');
      await expect(page.getByTestId('jsg-find')).toBeVisible();
    } finally { await page.context().close(); }
  });
}

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
    await expect(page.getByTestId('jss-state')).toHaveText(/^(Saved|Syncing)/);                    // live: sent as it is replaced
    await page.keyboard.press('Escape'); await expect(page.getByTestId('host-find')).toHaveCount(0);
    await page.getByTestId('jss-save').click();
    await expect(page.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 15_000 });
    expect((await (await author.api.get(`/api/projects/${ids.jss}/jss`)).json()).xml).toContain('OMEGA one OMEGA two OMEGA');
  } finally { await page.context().close(); }
});

// a refusal needs a save by version: the classic editor, the fallback when the room cannot be joined (a live book merges another save by
// itself: wp05 FE-007 live)
test('a refused JSS save can be compared and merged: both changes kept, checked, saved (PRD-004, classic)', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL, 1440, 900);
  await classicOnly(page.context());
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

// UI redesign, second pass (owner's editor-chrome requests 2026-11-28): the panel toggles, the panel close buttons, their keys and the labelled
// Editor | Split | PDF switch, the same in the three editors.
const panelOf = (page: Page, kind: (typeof EDITORS)[number]['kind'], p: 'explorer' | 'problems' | 'props') =>
  p === 'explorer' ? page.getByRole('complementary', { name: kind === 's1000d' ? 'Data modules' : 'Explorer' })
    : p === 'props' ? page.getByRole('complementary', { name: 'Properties' }).first()
      : kind === 's1000d' ? page.locator('.app--embedded > .pane-bottom') : kind === 'jss' ? page.getByTestId('jss-problems') : page.getByTestId('doc-problems');

for (const e of EDITORS) {
  test(`${e.kind}: the top bar's panel toggles, the panels' close buttons and their keys; remembered after a reload`, async ({ browser, baseURL }) => {
    const page = await fresh(browser, baseURL, 1440, 900);
    try {
      await open(page, e);
      const group = page.getByTestId('editor-header').getByRole('group', { name: 'Panels' });
      const toggle = { explorer: group.getByTestId('toggle-side'), problems: group.getByTestId('toggle-problems'), props: group.getByTestId('doc-props-toggle') };
      // the first view: everything open, every toggle pressed, the key in its tooltip
      for (const [p, key] of [['explorer', 'Ctrl+Shift+B'], ['problems', 'Ctrl+J'], ['props', 'Ctrl+Alt+Shift+B']] as const) {
        await expect(toggle[p]).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle[p]).toHaveAttribute('title', new RegExp(`\\(${key.replace(/\+/g, '\\+')}\\)`));
        await expect(panelOf(page, e.kind, p)).toBeVisible();
      }
      // a click hides, a second click shows
      for (const p of ['explorer', 'problems', 'props'] as const) {
        await toggle[p].click();
        await expect(toggle[p]).toHaveAttribute('aria-pressed', 'false');
        await expect(panelOf(page, e.kind, p)).toBeHidden();
        await toggle[p].click();
        await expect(toggle[p]).toHaveAttribute('aria-pressed', 'true');
        await expect(panelOf(page, e.kind, p)).toBeVisible();
      }
      // each panel closes from its own head
      for (const [p, id] of [['explorer', 'explorer-close'], ['problems', 'problems-close'], ['props', 'props-close']] as const) {
        await panelOf(page, e.kind, p).getByTestId(id).first().click();
        await expect(toggle[p]).toHaveAttribute('aria-pressed', 'false');
        await expect(panelOf(page, e.kind, p)).toBeHidden();
      }
      // the keys bring them back (Ctrl+B stays Bold, Ctrl+Alt+B the Studio's bulleted list)
      await page.getByTestId('chrome-shortcuts').focus();                                                       // the keys work wherever the focus is
      await page.keyboard.press('Control+Shift+B'); await expect(toggle.explorer).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Control+J'); await expect(toggle.problems).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Control+Alt+Shift+B'); await expect(toggle.props).toHaveAttribute('aria-pressed', 'true');
      for (const p of ['explorer', 'problems', 'props'] as const) await expect(panelOf(page, e.kind, p)).toBeVisible();
      // the choice is remembered for this person on this computer
      await toggle.problems.click(); await toggle.props.click();
      await expect(toggle.props).toHaveAttribute('aria-pressed', 'false');
      await page.reload(); await e.ready(page);
      await expect(toggle.explorer).toHaveAttribute('aria-pressed', 'true');
      await expect(toggle.problems).toHaveAttribute('aria-pressed', 'false');
      await expect(toggle.props).toHaveAttribute('aria-pressed', 'false');
      await expect(panelOf(page, e.kind, 'props')).toBeHidden();
    } finally { await page.context().close(); }
  });

  test(`${e.kind}: Editor | Split | PDF is a labelled switch in the tab row with its tooltips and keys`, async ({ browser, baseURL }) => {
    const page = await fresh(browser, baseURL, 1440, 900);
    try {
      await open(page, e);
      const seg = page.getByTestId('view-switch');
      for (const [name, tip] of [['Editor', 'Editor only (Ctrl+Shift+1)'], ['Split', 'Editor and PDF side by side (Ctrl+Shift+2)'], ['PDF', 'PDF only (Ctrl+Shift+3)']]) {
        const b = seg.getByRole('button', { name, exact: true });
        await expect(b).toHaveText(name);                                                                      // the words are shown, not only an icon
        await expect(b).toHaveAttribute('title', tip);
      }
      await page.getByTestId('chrome-shortcuts').focus();                                                       // the keys work wherever the focus is
      await page.keyboard.press('Control+Shift+3');
      await expect(seg.getByRole('button', { name: 'PDF', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('pdf-pane')).toBeVisible();
      await page.keyboard.press('Control+Shift+2');
      await expect(seg.getByRole('button', { name: 'Split', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Control+Shift+1');
      await expect(seg.getByRole('button', { name: 'Editor', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('pdf-pane')).toBeHidden();
    } finally { await page.context().close(); }
  });
}

for (const kind of ['jss', 'jsg'] as const) {
  test(`${kind}: Quick preview in the top bar renders a draft PDF beside the editor, and nothing is published`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const page = await fresh(browser, baseURL, 1440, 900);
    try {
      const e = EDITORS.find((x) => x.kind === kind)!;
      await open(page, e);
      const head = page.getByTestId('editor-header');
      const qp = head.getByTestId(`${kind}-quick-preview`);
      await expect(qp).toBeVisible();
      await expect(head.getByTestId(`${kind}-preview-auto`)).toHaveAttribute('aria-pressed', 'true');           // Refresh on save, on by default
      await qp.click();
      await expect(page.getByTestId('pdf-showing')).toHaveAttribute('data-showing', 'preview', { timeout: 120_000 });
      await expect(page.locator('[data-testid="pdf-pane"] canvas').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('pdf-showing')).toContainText('Quick preview (draft)');
      await expect(page.getByTestId('view-switch').getByRole('button', { name: 'Editor', exact: true })).toHaveAttribute('aria-pressed', 'false');   // the PDF pane opened
      // a draft: the publication's PDF is not made by it
      const pub = await author.api.get(kind === 'jss' ? `/api/projects/${ids[kind]}/publish/pdf` : `/api/projects/${ids[kind]}/jsg/pdf`);
      expect(pub.status(), 'a quick preview does not build the publication').toBe(404);
      // Refresh on save can be turned off, and stays off
      await head.getByTestId(`${kind}-preview-auto`).click();
      await expect(head.getByTestId(`${kind}-preview-auto`)).toHaveAttribute('aria-pressed', 'false');
      await page.reload(); await e.ready(page);
      await expect(page.getByTestId('editor-header').getByTestId(`${kind}-preview-auto`)).toHaveAttribute('aria-pressed', 'false');
    } finally { await page.context().close(); }
  });
}

test('s1000d: Quick preview, Refresh on save and Generate are in the top bar in every view; the PDF pane keeps only viewing controls', async ({ browser, baseURL }) => {
  const page = await fresh(browser, baseURL, 1440, 900);
  try {
    await open(page, EDITORS[0]);
    const slot = page.getByTestId('chrome-preview-slot');
    for (const v of ['Editor', 'Split', 'PDF']) {
      await page.getByTestId('view-switch').getByRole('button', { name: v, exact: true }).click();
      for (const id of ['quick-preview-btn', 'preview-autorefresh', 'generate-btn']) await expect(slot.getByTestId(id), `${id} in the top bar in ${v}`).toBeVisible();
    }
    const bar = page.getByRole('toolbar', { name: 'PDF controls' });
    await expect(bar.getByTestId('quick-preview-btn')).toHaveCount(0);
    await expect(bar.getByTestId('generate-btn')).toHaveCount(0);
    await expect(bar.getByRole('checkbox')).toHaveCount(0);
    for (const id of ['popout-quick', 'popout-build']) await expect(bar.getByTestId(id)).toBeVisible();
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
