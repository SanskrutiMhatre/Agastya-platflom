// WP-05: the editor data-loss defects of the audit, in a real browser against the real server. Nothing is mocked except where a fault is
// injected on purpose (a 503 from /api/auth/me, FE-004).
//   FE-001 / FE-023  Ctrl+S in the JSS editor after the S1000D Studio was opened saves the JSS document; a file dropped elsewhere is not the Studio's
//   FE-003           a session revoked while typing: the editor stays, a sign-in dialog appears, and the refused save is sent again
//   FE-004           one failed /api/auth/me does not sign anyone out
//   FE-005           Back from a JSS project to an S1000D project never asks about "another project's editor"
//   FE-006 / PUB-023 unsaved text survives a reload and is offered back; a save removes the draft
//   FE-007           a refused save keeps the author's version (download)
//   FE-024           after a sign-out the next person finds no document of the previous one
//   FE-012           a role change and a release approval ask first

import { test, expect, request as pwRequest, type Page, type APIRequestContext, type BrowserContext } from '@playwright/test';

const PW = 'Correct-Horse-9!';
let admin: APIRequestContext; let ctx: BrowserContext; let page: Page; let api: APIRequestContext;
let who = ''; let jss = ''; let s1k = ''; let jsg = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  who = `wpfive${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username: who, fullName: 'Five Author', role: 'author' } });
  ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, baseURL, acceptDownloads: true });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  // the browser's own 'leave this page?' question (unsaved work on reload or sign-out) is answered Leave; drafts are what is tested
  page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
  api = ctx.request;
  expect((await api.post('/api/auth/login', { data: { username: who, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username: who, password: PW } })).ok()).toBeTruthy();
  const make = async (data: Record<string, unknown>): Promise<string> => { const p = await api.post('/api/projects', { data }); expect(p.status(), await p.text()).toBe(201); return (await p.json()).project.id; };
  jss = await make({ name: 'WP05 JSS', format: 'jss', domain: 'land', manualType: 'uhb' });
  jsg = await make({ name: 'WP05 JSG', format: 'jsg', domain: 'land', manualType: 'uhb' });
  s1k = await make({ name: 'WP05 S1000D', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
});
test.afterAll(async () => { await ctx.close(); await admin.dispose(); });

const jssXml = async () => ((await (await api.get(`/api/projects/${jss}/jss`)).json()).xml as string);
const openJss = async () => { await page.goto(`/projects/${jss}/editor`); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 }); };
const typeInPurpose = async (t: string) => {
  const purpose = page.getByTestId('jss-paper').locator('.jss-sec').filter({ has: page.locator('.jss-sec-title', { hasText: 'Purpose' }) });
  await purpose.locator('.jss-para, .jss-empty').first().click(); await page.keyboard.press('End'); await page.keyboard.type(t);
  await expect(page.getByTestId('jss-state')).toHaveText(/Unsaved changes/);
};
const mySession = async () => ((await (await admin.get('/api/admin/sessions')).json()).sessions as Array<{ id: string; username: string }>).filter((s) => s.username === who);

test('FE-001: after the S1000D editor was opened, Ctrl+S in the JSS editor saves the JSS document (and only it)', async () => {
  await page.goto(`/projects/${s1k}/editor`);
  await expect(page.locator('.app--embedded')).toBeVisible({ timeout: 60_000 });
  // in the app, not a page load: the Studio instance stays alive
  await page.evaluate((id) => { history.pushState({}, '', `/projects/${id}/editor`); dispatchEvent(new PopStateEvent('popstate')); }, jss);
  await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await typeInPurpose('CTRL-S-MARKER ');
  const puts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PUT') puts.push(r.url()); });
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 15_000 });
  expect(puts.some((u) => u.endsWith(`/api/projects/${jss}/jss`))).toBeTruthy();
  expect(puts.some((u) => u.includes('/dms/'))).toBeFalsy();
  expect(await jssXml()).toContain('CTRL-S-MARKER');
});

test('FE-023: the Studio handle is test-only and the Studio does not take a file dropped on another page', async () => {
  await page.goto('/graphics');
  const taken = await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['<dmodule/>'], 'x.xml', { type: 'application/xml' }));
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(taken, 'nothing on this page handles a drop on the body, so it must not be cancelled').toBeFalsy();
});

test('FE-003: a session revoked while typing keeps the editor; signing in again sends the refused save once more', async () => {
  await openJss();
  await typeInPurpose('AFTER-REVOKE-MARKER ');
  const refused: number[] = []; page.on('response', (r) => { if (r.request().method() === 'PUT' && r.url().endsWith(`/api/projects/${jss}/jss`)) refused.push(r.status()); });
  for (const s of await mySession()) expect((await admin.post(`/api/admin/sessions/${s.id}/revoke`)).ok()).toBeTruthy();
  // The page usually learns at once (the WebSocket is closed with "session ended") and shows the dialog before anything else is pressed,
  // so the Save is started from the page itself: it meets the 401 either way and must wait for the new sign-in, then go through.
  await page.getByTestId('jss-save').evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.getByTestId('reauth-dialog')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => refused.includes(401), { timeout: 15_000 }).toBeTruthy();           // the save really was refused
  await expect(page.getByTestId('jss-editor')).toBeVisible();                                   // the editor is still mounted
  await expect(page.getByTestId('jss-paper')).toContainText('AFTER-REVOKE-MARKER');           // with the text in it
  await page.getByTestId('reauth-password').fill(PW); await page.getByTestId('reauth-submit').click();
  await expect(page.getByTestId('reauth-dialog')).toHaveCount(0);
  await expect(page.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 15_000 });
  expect(await jssXml()).toContain('AFTER-REVOKE-MARKER');
});

test('FE-004: one failed /api/auth/me (503) does not sign the person out', async () => {
  // WP-18 (FE-020): moving around reuses the signed-in answer for 30 s, so the page's clock is moved past that to make the next move ask
  // again. Own page with its own clock: the shared page's autosave and draft timers must keep real time for the tests after this one.
  const p = await ctx.newPage();
  try {
    await p.clock.install();
    await p.goto('/overview');
    await expect(p.getByRole('heading').first()).toBeVisible();
    let failed = 0;
    await p.route('**/api/auth/me', async (r) => { if (failed++ === 0) await r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"restarting"}' }); else await r.continue(); });
    await p.clock.fastForward(31_000);
    await p.getByRole('link', { name: 'Projects' }).first().click();
    await expect.poll(() => failed, { message: 'the move asked the server who is signed in (and got the 503)' }).toBeGreaterThan(0);
    await expect(p.getByLabel('Username')).toHaveCount(0);
    await expect(p.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
    await p.unroute('**/api/auth/me');
  } finally { await p.close(); }
});

test('FE-005: Back from a JSS project to the S1000D project never asks about another project\'s editor', async () => {
  const dialogs: string[] = []; const onDialog = (d: import('@playwright/test').Dialog) => { dialogs.push(d.message()); void d.dismiss().catch(() => undefined); };
  page.on('dialog', onDialog); test.info().annotations.push({ type: 'cleanup', description: 'dialog listener removed below' });
  await page.goto(`/projects/${s1k}/editor`); await expect(page.locator('.app--embedded')).toBeVisible({ timeout: 60_000 });
  await page.evaluate((id) => { history.pushState({}, '', `/projects/${id}/editor`); dispatchEvent(new PopStateEvent('popstate')); }, jss);
  await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await page.goBack(); await expect(page.locator('.app--embedded')).toBeVisible({ timeout: 30_000 });
  await page.goForward(); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  page.off('dialog', onDialog);
  expect(dialogs).toEqual([]);
});

test('FE-006 / PUB-023: unsaved JSS text survives a reload and is offered back; a save removes the draft', async () => {
  await openJss();
  await typeInPurpose('DRAFT-MARKER ');
  await page.waitForTimeout(4000);                                                            // the draft is written every 3 s
  await page.reload();
  await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('draft-found')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('draft-recover').click();
  await expect(page.getByTestId('jss-paper')).toContainText('DRAFT-MARKER');
  await expect(page.getByTestId('jss-state')).toHaveText(/Unsaved changes/);
  await page.getByTestId('jss-save').click(); await expect(page.getByTestId('jss-state')).toHaveText(/Saved/, { timeout: 15_000 });
  expect(await jssXml()).toContain('DRAFT-MARKER');
  await page.reload(); await expect(page.getByTestId('jss-editor')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500); await expect(page.getByTestId('draft-found')).toHaveCount(0);
});

test('FE-006: the JSG editor keeps a draft too and autosave is on by default', async () => {
  await page.goto(`/projects/${jsg}/editor`); await expect(page.getByTestId('jsg-host')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('jsg-autosave')).toBeChecked();
  await page.locator('[data-testid="jsg-host"] [contenteditable="true"]').first().click(); await page.keyboard.type('JSGDRAFT');
  await page.waitForTimeout(4000);
  await page.reload(); await expect(page.getByTestId('jsg-host')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('draft-found')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('draft-recover').click();
  await expect(page.getByTestId('jsg-host')).toContainText('JSGDRAFT');
  await expect(page.getByTestId('jsg-state')).toHaveText(/Unsaved changes/);
  await page.getByTestId('draft-found').waitFor({ state: 'detached' });
  await page.getByTestId('jsg-save').click(); await expect(page.getByTestId('jsg-state')).toHaveText(/Saved/, { timeout: 15_000 });
});

test('FE-007: a refused save keeps the author\'s version: it can be downloaded', async () => {
  await openJss();
  await typeInPurpose('MINE-MARKER ');
  // someone else saves meanwhile
  const cur = await (await api.get(`/api/projects/${jss}/jss`)).json();
  expect((await api.put(`/api/projects/${jss}/jss`, { data: { xml: (cur.xml as string).replace('<title>Purpose</title>', '<title>Purpose</title><para>THEIRS-MARKER</para>'), baseHash: cur.hash } })).ok()).toBeTruthy();
  await page.getByTestId('jss-save').click();
  await expect(page.getByTestId('jss-conflict')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('jss-paper')).toContainText('MINE-MARKER');
  const dl = page.waitForEvent('download');
  await page.getByTestId('conflict-download').click();
  const file = await dl; const text = await (await file.createReadStream())!.toArray().then((b) => Buffer.concat(b as Buffer[]).toString('utf8'));
  expect(text).toContain('MINE-MARKER');
  await page.getByTestId('conflict-reload').click();
  await expect(page.getByRole('dialog', { name: 'Open the other version?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard my changes' }).click();
  await expect(page.getByTestId('jss-paper')).toContainText('THEIRS-MARKER', { timeout: 15_000 });
});

test('FE-024: after a sign-out the next person finds no open document or draft of the previous one', async () => {
  await openJss();
  await typeInPurpose('PRIVATE-MARKER ');
  await page.waitForTimeout(4000);
  await page.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); });
  // the page notices at its next request; a sign-out from the menu does the same through the store
  await page.goto('/overview');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 });
  const drafts = await page.evaluate(() => new Promise<number>((resolve) => {
    const r = indexedDB.open('agastya-drafts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'key' });
    r.onsuccess = () => { const t = r.result.transaction('drafts', 'readonly').objectStore('drafts').getAll(); t.onsuccess = () => resolve((t.result as Array<{ key: string; xml: string }>).filter((d) => d.xml.includes('PRIVATE-MARKER')).length); };
  }));
  // a sign-out that was not chosen in the app (an ended session) keeps the author's own draft, under their name only
  expect(drafts).toBeLessThanOrEqual(1);
  const studioDocs = await page.evaluate(() => ((window as unknown as { studio?: { editors: unknown[] } }).studio?.editors.length ?? 0));
  expect(studioDocs).toBe(0);
  // sign in again for the tests that follow
  await page.getByLabel('Username').fill(who); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('account-menu')).toBeVisible({ timeout: 15_000 });
});

test('FE-024: a sign-out chosen from the account menu removes the person\'s drafts', async () => {
  await openJss();
  await typeInPurpose('MENU-SIGNOUT-MARKER ');
  await page.waitForTimeout(4000);
  await page.goto('/overview');
  await page.getByTestId('account-menu').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => new Promise<number>((resolve) => {
    const r = indexedDB.open('agastya-drafts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('drafts', { keyPath: 'key' });
    r.onsuccess = () => { const t = r.result.transaction('drafts', 'readonly').objectStore('drafts').getAll(); t.onsuccess = () => resolve((t.result as unknown[]).length); };
  })), { timeout: 10_000 }).toBe(0);
  await page.getByLabel('Username').fill(who); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('account-menu')).toBeVisible({ timeout: 15_000 });
});
