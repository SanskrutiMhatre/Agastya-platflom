// WP-18 performance probes (audit 04-PERFORMANCE-AUDIT section 12.6, benchmarks B1, B2, B3, B4, B7) with the proposed budgets as assertions.
// Against the real server that serves the built client (e2e/serve.mjs), so compression and caching are the shipped ones.
//   B1  initial JS + CSS on the wire at most 180 KB; hashed assets immutable and compressed; index.html no-cache
//   B2  signing in asks /api/auth/me once; moving between pages asks it zero times (FE-020)
//   B4  one save of an existing data module: at most 2 follow-up GETs, none of /media, /settings, /explore (FE-029)
//   B3  a 500-module project: the editor's "All" list draws at most 60 rows and the side panel stays under 3,000 nodes (FE-030)
//   B7  the opt-in first page of /api/projects and /dms is at most 20 KB on the wire (PERF-016)
import { test, expect, request as pwRequest, type Page, type APIRequestContext, type BrowserContext, type Request as PwRequest } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, 'fixtures', 'dm21', '5-0');
const PW = 'Correct-Horse-9!';
const BUDGET = { initialWireBytes: 180 * 1024, authMeOnLogin: 1, authMeOnNavigation: 0, getsPerSave: 2, rowsDrawn: 60, sidePanelNodes: 3000, firstPageWireBytes: 20 * 1024 };

let admin: APIRequestContext; let ctx: BrowserContext; let page: Page; let api: APIRequestContext;
let who = ''; let password = ''; let sample = ''; let big = '';

test.describe.configure({ mode: 'serial' });

// One session per person (WP-03): once the browser signs in (B2), the API context's session ends, so the later probes use page.request.
test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  who = `wp18p${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username: who, fullName: 'Perf Author', role: 'author' } });
  password = (await made.json()).tempPassword;
  api = await pwRequest.newContext({ baseURL });
  expect((await api.post('/api/auth/login', { data: { username: who, password } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username: who, password: PW } })).ok()).toBeTruthy();
  password = PW;
  sample = (await (await api.post('/api/projects/sample', { data: {} })).json()).project.id;
  big = (await (await api.post('/api/projects', { data: { name: 'WP18 500 modules', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } } })).json()).project.id;
  // 500 data modules: the 21 fixture modules under 24 system codes, created through the API like an import
  const fixtures = fs.readdirSync(FIX).filter((f) => /^DMC-.*\.XML$/i.test(f));
  let n = 0;
  for (let k = 0; n < 500; k++) {
    const sc = String(10 + k);
    for (const f of fixtures) {
      if (n >= 500) break;
      const xml = fs.readFileSync(path.join(FIX, f), 'utf8').replace(/systemCode="00"/g, `systemCode="${sc}"`);
      const r = await api.post(`/api/projects/${big}/dms`, { data: { file: f.replace('DMC-EXAMPLE-A-00-', `DMC-EXAMPLE-A-${sc}-`), xml } });
      if (r.status() === 201) n++;
      else if (k > 40) throw new Error(`could not create 500 modules: ${await r.text()}`);
    }
  }
  ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, baseURL });
  page = await ctx.newPage();
  page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
});
test.afterAll(async () => { await ctx?.close(); await api?.dispose(); await admin?.dispose(); });

const wireBytes = async (r: PwRequest): Promise<number> => {
  const resp = await r.response(); if (!resp) return 0;
  const len = Number(resp.headers()['content-length'] ?? NaN);
  return Number.isFinite(len) ? len : (await r.sizes()).responseBodySize;
};

test('B1: the sign-in page loads at most 180 KB of JS and CSS on the wire; hashed files are immutable and compressed', async () => {
  const seen: PwRequest[] = [];
  page.on('request', (r) => { if (/\.(js|css|mjs)(\?|$)/.test(r.url())) seen.push(r); });
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  page.removeAllListeners('request');
  let total = 0;
  for (const r of seen) total += await wireBytes(r);
  console.log(`B1 initial JS+CSS: ${seen.length} files, ${total} B on the wire`);
  expect(total).toBeLessThanOrEqual(BUDGET.initialWireBytes);
  const hashed = seen.filter((r) => /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(r.url()));
  expect(hashed.length).toBeGreaterThan(0);
  for (const r of hashed) {
    const h = (await r.response())!.headers();
    expect(h['cache-control'], r.url()).toBe('public, max-age=31536000, immutable');
    if (Number(h['content-length'] ?? 2048) >= 1024) expect(h['content-encoding'], r.url()).toMatch(/^(br|gzip)$/);
  }
  const doc = await page.request.get('/login');
  expect(doc.headers()['cache-control']).toBe('no-cache');
});

test('B2: signing in asks who is signed in once; moving between pages does not ask again', async () => {
  const me: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/auth/me' && !r.headers()['x-agastya-background']) me.push(r.url()); });
  await page.goto('/login');
  await page.locator('input[name="username"]').fill(who);
  await page.locator('input[name="password"]').fill(password);
  const before = me.length;
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.locator('input[name="password"]')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  const onLogin = me.length - before;
  console.log(`B2 /api/auth/me on sign-in: ${onLogin}`);
  expect(onLogin).toBeLessThanOrEqual(BUDGET.authMeOnLogin);
  const atNav = me.length;
  for (const to of ['/projects', '/overview', '/projects', '/activity', '/notifications']) {
    await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, to);
    await page.waitForTimeout(400);
  }
  await page.waitForLoadState('networkidle');
  console.log(`B2 /api/auth/me on 5 navigations: ${me.length - atNav}`);
  expect(me.length - atNav).toBeLessThanOrEqual(BUDGET.authMeOnNavigation);
  page.removeAllListeners('request');
});

test('B4: one save of an existing data module is followed by at most 2 GETs (no /media, /settings or /explore)', async () => {
  const file = (await (await page.request.get(`/api/projects/${sample}/dms`)).json()).dms[0].file as string;
  await page.goto(`/projects/${sample}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('dm-list').locator(`[data-file="${file}"]`).click();
  await expect(page.locator('.design-page:visible')).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await page.locator('.vs-btn', { hasText: 'XML' }).click();
  const edited = await page.evaluate(() => {
    const v = (window as any).studio.active.xml.view; const doc = v.state.doc.toString(); const i = doc.indexOf('</para>');
    if (i < 0) return false; v.dispatch({ changes: { from: i, to: i, insert: ' WP18' } }); return true;
  });
  expect(edited).toBe(true);
  const after: Array<{ method: string; path: string }> = []; let putAt = -1;
  page.on('request', (r) => {
    const u = new URL(r.url()); if (!u.pathname.startsWith('/api/')) return;
    if (r.method() === 'PUT' && u.pathname.includes('/dms/')) putAt = after.length;
    after.push({ method: r.method(), path: u.pathname });
  });
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Saved' }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  page.removeAllListeners('request');
  expect(putAt).toBeGreaterThanOrEqual(0);
  const gets = after.slice(putAt + 1).filter((r) => r.method === 'GET' && !/\/(unread-count|auth\/me|brex\/missing)$/.test(r.path));
  console.log(`B4 follow-up GETs after one save: ${gets.length} ${JSON.stringify(gets.map((g) => g.path))}`);
  expect(gets.length).toBeLessThanOrEqual(BUDGET.getsPerSave);
  expect(gets.some((g) => /\/(media|settings|explore)$/.test(g.path))).toBe(false);
});

test('B3: a 500-module project opens with a bounded list: at most 60 rows drawn, side panel under 3,000 nodes', async () => {
  await page.goto(`/projects/${big}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('view-all').click();
  await expect(page.getByTestId('virtual-rows')).toHaveAttribute('data-total', '500', { timeout: 30_000 });
  const rows = await page.getByTestId('dm-row').count();
  const nodes = await page.locator('[aria-label="Data modules"]').evaluate((el) => el.querySelectorAll('*').length);
  console.log(`B3 at 500 modules: ${rows} rows drawn, ${nodes} nodes in the side panel`);
  expect(rows).toBeLessThanOrEqual(BUDGET.rowsDrawn);
  expect(nodes).toBeLessThan(BUDGET.sidePanelNodes);
  // scrolling to the end draws the last module, still a bounded number of rows
  await page.getByTestId('dm-list').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const last = (await (await page.request.get(`/api/projects/${big}/dms`)).json()).dms.at(-1).file as string;
  await expect(page.getByTestId('dm-list').locator(`[data-file="${last}"]`)).toBeVisible();
  expect(await page.getByTestId('dm-row').count()).toBeLessThanOrEqual(BUDGET.rowsDrawn);
  // a filter finds a module that was not drawn
  await page.getByLabel('Filter data modules').fill(last.slice(0, 30));
  await expect(page.getByTestId('dm-list').locator(`[data-file="${last}"]`)).toBeVisible();
});

test('B7: the first page of /api/projects and /dms is at most 20 KB on the wire', async () => {
  for (const u of ['/api/projects?limit=50', `/api/projects/${big}/dms?limit=50&fields=list`]) {
    const r = await page.request.get(u, { headers: { 'accept-encoding': 'gzip, br' } });
    expect(r.ok()).toBeTruthy();
    const body = await r.body();
    const wire = Number(r.headers()['content-length'] ?? body.length);
    console.log(`B7 ${u}: ${wire} B on the wire (${r.headers()['content-encoding'] ?? 'identity'})`);
    expect(wire).toBeLessThanOrEqual(BUDGET.firstPageWireBytes);
  }
});
