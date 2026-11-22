// Draft saving versus publication, as an author experiences it in the browser:
//   a module that is well-formed but does not match its schema is SAVED (a draft), but the server refuses to build a PDF (Generate and the
//   server Quick preview) or to request a release from it, and says why; the browser-side Quick preview still works for drafts;
//   fixing the module unblocks everything. (Malformed XML is refused at save time: see zz-verify-21.spec.ts.)

import { test, expect, request as pwRequest, type Page, type APIRequestContext } from '@playwright/test';

const PW = 'Correct-Horse-9!';
let page: Page;
let api: APIRequestContext;
let projectUrl = '';
let pid = '';
let file = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const who = `gate${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username: who, fullName: 'Gate Tester', role: 'author' } });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  api = ctx.request;
  expect((await api.post('/api/auth/login', { data: { username: who, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username: who, password: PW } })).ok()).toBeTruthy();
  const s = await api.post('/api/projects/sample', { data: {} });
  expect(s.status()).toBe(201);
  pid = (await s.json()).project.id;
  projectUrl = `/projects/${pid}`;
  file = (await (await api.get(`/api/projects/${pid}/dms`)).json()).dms[0].file;
  await admin.dispose();
});
test.afterAll(async () => { await page.context().close(); });

const xmlEdit = (find: string, replace: string) => page.evaluate(({ find, replace }) => {
  const v = (window as any).studio.active.xml.view;
  const i = v.state.doc.toString().indexOf(find);
  if (i < 0) return false;
  v.dispatch({ changes: { from: i, to: i + find.length, insert: replace } });
  return true;
}, { find, replace });

test('a schema-invalid draft is saved, then Generate, the server preview and a release request are refused with the reason', async () => {
  await page.goto(`${projectUrl}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  await page.getByTestId('dm-list').locator(`[data-file="${file}"]`).click();
  await expect(page.locator('.design-page:visible')).toBeVisible();

  // draft: a foreign tag typed into the XML view is well-formed XML, so it saves
  await page.locator('.vs-btn', { hasText: 'XML' }).click();
  expect(await xmlEdit('<content>', '<content><zzNope/>')).toBe(true);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Saved' }).first()).toBeVisible();
  const saved = (await (await api.get(`/api/projects/${pid}/dms/${file}`)).json()).xml as string;
  expect(saved, 'the draft is stored').toContain('<zzNope');
  await page.locator('.vs-btn', { hasText: 'Design' }).click();

  const panel = page.getByRole('complementary', { name: 'Data modules' });
  void panel;
  // Generate: refused, with the reason in view
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText(/Not published: \d+ data module/).first()).toBeVisible({ timeout: 60_000 });
  expect((await api.get(`/api/projects/${pid}/publish/pdf`)).status(), 'no PDF was produced').toBe(404);

  // Quick preview (always rendered by the server now; there is no browser engine to fall back on): refused too
  await page.getByTestId('quick-preview-btn').click();
  await expect(page.getByText(/Not published: 1 data module/).first()).toBeVisible({ timeout: 60_000 });

  // the API says the same, with the findings
  const raw = await api.post(`/api/projects/${pid}/publish`, { data: {} });
  expect(raw.status()).toBe(422);
  const body = await raw.json();
  expect(body.code).toBe('VALIDATION_FAILED');
  expect(body.modules).toContain(file);
  expect(body.findings[0].kind).toBe('schema');

  // a release cannot be requested from it
  await page.goto(`${projectUrl}/release`);
  await page.getByTestId('request-release').click();
  await expect(page.locator('.v2-toast', { hasText: /Not published/ }).first()).toBeVisible({ timeout: 15_000 });
});

test('fixing the module unblocks Generate, and a release can then be requested', async () => {
  await page.goto(`${projectUrl}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  await page.getByTestId('dm-list').locator(`[data-file="${file}"]`).click();
  await page.locator('.vs-btn', { hasText: 'XML' }).click();
  expect(await xmlEdit('<zzNope/>', '')).toBe(true);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Saved' }).first()).toBeVisible();
  await page.locator('.vs-btn', { hasText: 'Design' }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText(/Built in \d/).first()).toBeVisible({ timeout: 120_000 });
  expect((await api.get(`/api/projects/${pid}/publish/pdf`)).status()).toBe(200);
  await page.goto(`${projectUrl}/release`);
  await page.getByTestId('request-release').click();
  await expect(page.getByRole('heading', { name: 'Waiting for review' })).toBeVisible();
});

// ---- business rules (BREX): the official default BREX of the project's issue applies to the sample project's modules -----------------------------

test('a BREX breach is a draft that saves, then Generate is refused with the rule named; the Validation page lists it; fixing it unblocks', async () => {
  const dms = (await (await api.get(`/api/projects/${pid}/dms`)).json()).dms as Array<{ file: string; infoCode?: string }>;
  const proced = dms.find((d) => /-520A-/.test(d.file))!.file;
  await page.goto(`${projectUrl}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  await page.getByTestId('dm-list').locator(`[data-file="${proced}"]`).click();
  await page.locator('.vs-btn', { hasText: 'XML' }).click();
  // BREX-S1-00264: a step has a title only when its sibling steps have one. Titling the first step only is schema-valid but breaks the rule.
  const edited = await page.evaluate(() => {
    const v = (window as any).studio.active.xml.view;
    const t = v.state.doc.toString();
    const m = /<mainProcedure>\s*<proceduralStep[^>]*>/.exec(t);
    if (!m) return false;
    v.dispatch({ changes: { from: m.index + m[0].length, to: m.index + m[0].length, insert: '<title>Only one title</title>' } });
    return true;
  });
  expect(edited).toBe(true);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Saved' }).first()).toBeVisible();
  await page.locator('.vs-btn', { hasText: 'Design' }).click();

  // the schema accepts it, so only the business rules stand in the way
  const raw = await api.post(`/api/projects/${pid}/publish`, { data: {} });
  expect(raw.status()).toBe(422);
  const body = await raw.json();
  expect(body.error).toMatch(/business rules \(BREX\)/);
  const f = body.findings.find((x: { kind: string }) => x.kind === 'brex');
  expect(f.file).toBe(proced);
  expect(f.title).toMatch(/BREX-S1-00264/);
  expect(f.detail).toMatch(/step must have a title/i);
  expect(body.findings.every((x: { kind: string }) => x.kind === 'brex')).toBe(true);

  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText(/business rules \(BREX\)/).first()).toBeVisible({ timeout: 60_000 });

  // the Validation page includes BREX by default and lists the breach under "Business rules (BREX)"
  await page.goto(`${projectUrl}/validation`);
  await expect(page.getByLabel('Include BREX')).toBeChecked();
  await page.getByTestId('run-validation').click();
  await expect(page.getByText(/BREX-S1-00264/).first()).toBeVisible({ timeout: 60_000 });

  // fix: remove the title again
  await page.goto(`${projectUrl}/editor`);
  await page.getByTestId('dm-list').locator(`[data-file="${proced}"]`).click();
  await page.locator('.vs-btn', { hasText: 'XML' }).click();
  expect(await xmlEdit('<title>Only one title</title>', '')).toBe(true);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.toast', { hasText: 'Saved' }).first()).toBeVisible();
  await page.locator('.vs-btn', { hasText: 'Design' }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByText(/Built in \d/).first()).toBeVisible({ timeout: 120_000 });
});
