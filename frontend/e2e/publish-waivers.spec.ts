// The publish gate and its waivers, as people meet them in the browser.
//   A module names a BREX the project does not have -> the server refuses to build (Generate, the server Quick preview, Build on the Publication page).
//   An editor may record a waiver (a reason of at least 10 characters, kept with name and date) and the DRAFT build then goes ahead; a reviewer or viewer
//   sees the refusal but no such action; the Release page shows the refusal as it is and says a waiver does not cover a release; other kinds of refusal
//   (here a schema error) never offer a waiver. The Publication page lists the waivers and an editor can remove one.
//
// Self-contained. The module is the dm21 fixture with its brexDmRef pointing at a BREX the project lacks (as backend/test/publish-waivers.test.js does).

import { test, expect, type Page, type APIRequestContext, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminApi, assign, newPerson, type Person } from './support/session';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'dm21');
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';
const NAMED = 'modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="Z" itemLocationCode="D"';
const useBrex = (xml: string, codeAttrs: string) => xml.replace(/(<brexDmRef>[\s\S]*?<dmCode )[^>]*?(\/>[\s\S]*?<\/brexDmRef>)/, `$1${codeAttrs}$2`);
const shot = (p: Page, name: string) => p.screenshot({ path: `test-results/shots/${name}.png` });
const REASON = 'The customer BREX is not shipped with the package; drafts only.';

test.describe.configure({ mode: 'serial' });

let owner: Person; let reviewer: Person; let viewer: Person;
let page: Page; let api: APIRequestContext;
let pid = ''; let file = ''; let subject = '';
const P = (s: string) => `/api/projects/${pid}${s}`;

/** A project holding one module that names a missing BREX, placed in its publication. */
async function missingBrexProject(a: APIRequestContext, name: string): Promise<{ id: string; file: string }> {
  const id = (await (await a.post('/api/projects', { data: { name, pipeline: 's1000dtofo' } })).json()).project.id as string;
  const base = `/api/projects/${id}`;
  expect((await a.post(`${base}/media`, { multipart: { file: { name: ICN, mimeType: 'image/svg+xml', buffer: fs.readFileSync(path.join(FIX, ICN)) }, dir: 'csdb' } })).status()).toBe(200);
  const dir = path.join(FIX, '5-0');
  const f = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).descript as string;
  expect((await a.post(`${base}/dms`, { data: { file: f, xml: useBrex(fs.readFileSync(path.join(dir, f), 'utf8'), NAMED) } })).status()).toBe(201);
  const pmc = await (await a.get(`${base}/pmc`)).json();
  const dms = ((await (await a.get(`${base}/dms`)).json()).dms as Array<Record<string, unknown>>).filter((d) => d.file === f);
  const entries = [{ type: 'folder', title: 'All', children: dms.map((d) => ({ type: 'dm', dmCode: d.dmCodeAttrs, issueInfo: d.issueInfoAttrs, language: d.languageAttrs, techName: d.techName, infoName: d.infoName })) }];
  expect((await a.put(`${base}/pmc`, { data: { meta: pmc.meta, entries } })).status()).toBe(200);
  return { id, file: f };
}

test.beforeAll(async ({ browser, baseURL }) => {
  const admin = await adminApi(baseURL);
  owner = await newPerson(admin, browser, baseURL, 'waive', 'Wanda Writer');
  reviewer = await newPerson(admin, browser, baseURL, 'revw', 'Rita Reviewer');
  viewer = await newPerson(admin, browser, baseURL, 'viewer', 'Vic Viewer');
  page = owner.page; api = owner.api;
  const made = await missingBrexProject(api, 'Waiver project');
  pid = made.id; file = made.file;
  await assign(api, pid, reviewer.username, 'reviewer');
  await assign(api, pid, viewer.username, 'viewer');
  await admin.dispose();
});
test.afterAll(async () => { for (const p of [owner, reviewer, viewer]) await p.page.context().close(); });

const refusal = (p: Page): Locator => p.getByTestId('publish-refusal');
const asking = (p: Page): Locator => p.getByRole('dialog', { name: 'Build drafts without this BREX' });
const waivers = async () => (await (await api.get(P('/publish-waivers'))).json()).waivers as Array<{ id: string; subject: string; reason: string; by: string; at: string }>;

test('the server Quick preview is refused for the missing BREX, and an editor is offered a waiver', async () => {
  await page.goto(`/projects/${pid}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  await page.getByTestId('dm-list').locator(`[data-file="${file}"]`).click();
  await page.getByTestId('quick-preview-btn').click();            // always the server's rendering now
  await expect(refusal(page)).toBeVisible({ timeout: 90_000 });
  await expect(refusal(page).getByTestId('refusal-message')).toContainText('Not published');
  await expect(refusal(page).getByTestId('refusal-findings')).toContainText('is not available');
  await expect(refusal(page).getByTestId('waiver-offer')).toHaveText(/Build drafts without this BREX/);
  expect(await waivers()).toHaveLength(0);
});

test('Generate is refused; a reason that is too short is rejected; a recorded waiver lets the draft build go ahead', async () => {
  await page.getByTestId('generate-btn').click();
  await expect(refusal(page)).toBeVisible({ timeout: 90_000 });
  const title = refusal(page).getByTestId('refusal-findings').locator('li strong').first();
  await expect(title).toHaveText(/^BREX \S+ is not available$/);
  subject = /^BREX (\S+) is not available$/.exec(await title.innerText())![1];
  await shot(page, '54-waiver-refused');

  await refusal(page).getByTestId('waiver-offer').click();
  const dlg = asking(page);
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('draft builds only');
  await expect(dlg).toContainText('release');
  await expect(dlg).toContainText('recorded with your name and the date');
  await expect(dlg.getByTestId('waiver-subjects')).toHaveText(subject);
  await dlg.getByTestId('waiver-reason').fill('short');
  await dlg.getByTestId('waiver-record').click();
  await expect(dlg.getByRole('alert')).toContainText('at least 10');
  expect(await waivers(), 'nothing is recorded for a reason that is too short').toHaveLength(0);
  await shot(page, '55-waiver-dialog');

  await dlg.getByTestId('waiver-reason').fill(REASON);
  await dlg.getByTestId('waiver-record').click();
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('.v2-toast', { hasText: 'Waiver recorded' })).toBeVisible();
  // the build was retried and succeeded: the PDF shows
  await expect(page.locator('.v2-log', { hasText: /Built in/ })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('pdf-pane').locator('canvas').first()).toBeVisible({ timeout: 45_000 });
  await expect(refusal(page)).toHaveCount(0);
  await shot(page, '56-waiver-built');

  const all = await waivers();
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({ reason: REASON, by: owner.username });
  expect(all[0].subject.toLowerCase()).toBe(subject.toLowerCase());
  expect((await api.get(P('/publish/pdf'))).status()).toBe(200);
});

test('with the waiver recorded, the server Quick preview renders too', async () => {
  await page.getByTestId('quick-preview-btn').click();
  await expect(page.locator('.v2-log', { hasText: /Rendered by the server/ })).toBeVisible({ timeout: 90_000 });
});

test('the Publication page lists the waiver (subject, reason, who, when); removing it makes the gate strict again; a build there can record it afresh', async () => {
  await page.goto(`/projects/${pid}/publication`);
  const card = page.getByTestId('publish-waivers');
  await expect(card).toBeVisible();
  const row = card.getByTestId('waiver-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(subject);
  await expect(row).toContainText(REASON);
  await expect(row).toContainText(owner.username);
  await expect(row).toContainText(String(new Date().getFullYear()));
  await expect(card).toContainText('never covers a release');
  await shot(page, '57-waivers-list');

  await row.getByTestId('waiver-remove').click();
  await expect(card.getByTestId('waiver-row')).toHaveCount(0);
  await expect(card).toContainText('No waivers');
  expect(await waivers()).toHaveLength(0);

  await page.getByTestId('build-publication').click();
  await expect(refusal(page)).toBeVisible({ timeout: 90_000 });
  await refusal(page).getByTestId('waiver-offer').click();
  await asking(page).getByTestId('waiver-reason').fill('Recorded again from the Publication page, drafts only.');
  await asking(page).getByTestId('waiver-record').click();
  await expect(page.locator('.v2-toast', { hasText: /Publication built in/ })).toBeVisible({ timeout: 120_000 });
  await expect(card.getByTestId('waiver-row')).toHaveCount(1);
  await expect(card.getByTestId('waiver-row')).toContainText('Recorded again from the Publication page');
});

test('the Release page shows the refusal as it is, says a waiver does not cover a release, and offers none', async () => {
  await page.goto(`/projects/${pid}/release`);
  await page.getByTestId('request-release').click();
  await expect(page.locator('.v2-toast', { hasText: /Not published/ }).first()).toBeVisible({ timeout: 90_000 });   // the refusal, unchanged
  const r = refusal(page);
  await expect(r).toBeVisible();
  await expect(r.getByTestId('refusal-message')).toContainText('Not published');
  await expect(r.getByTestId('refusal-findings')).toContainText('is not available');
  await expect(r.getByTestId('refusal-release-note')).toContainText('A waiver does not cover a release');
  await expect(page.getByTestId('waiver-offer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Build drafts without/ })).toHaveCount(0);
  await shot(page, '58-release-refused');
  await expect(page.getByTestId('pending-request')).toHaveCount(0);                                  // nothing was submitted
});

test('another kind of refusal (a schema error) never offers a waiver', async () => {
  const sample = await api.post('/api/projects/sample', { data: {} });
  expect(sample.status()).toBe(201);
  const sid = (await sample.json()).project.id as string;
  const dm = ((await (await api.get(`/api/projects/${sid}/dms`)).json()).dms as Array<{ file: string }>)[0].file;
  const cur = await (await api.get(`/api/projects/${sid}/dms/${dm}`)).json();
  expect((await api.put(`/api/projects/${sid}/dms/${dm}`, { data: { xml: cur.xml.replace('<content>', '<content><zzNope/>') } })).ok()).toBeTruthy();
  await page.goto(`/projects/${sid}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  await page.getByTestId('generate-btn').click();
  const r = refusal(page);
  await expect(r).toBeVisible({ timeout: 90_000 });
  await expect(r.getByTestId('refusal-message')).toContainText('not valid against the S1000D schema');
  await expect(r.getByTestId('waiver-offer')).toHaveCount(0);
  await expect(r).not.toContainText(/waiver/i);
  await shot(page, '59-schema-refused-no-waiver');
});

test('a reviewer, who can build, sees the refusal but no waiver action', async () => {
  for (const w of await waivers()) expect((await api.delete(P(`/publish-waivers/${w.id}`))).ok()).toBeTruthy();
  const p = reviewer.page;
  await p.goto(`/projects/${pid}/editor`);
  await expect(p.getByTestId('studio-host')).toBeVisible();
  await p.getByTestId('generate-btn').click();
  await expect(refusal(p)).toBeVisible({ timeout: 90_000 });
  await expect(refusal(p).getByTestId('refusal-findings')).toContainText('is not available');
  await expect(refusal(p).getByTestId('waiver-offer')).toHaveCount(0);
  await expect(p.getByRole('button', { name: /Build drafts without/ })).toHaveCount(0);
  await expect(refusal(p).getByTestId('refusal-ask-editor')).toBeVisible();
});

test('a viewer reads the waivers on the Publication page but cannot remove one', async () => {
  expect((await api.post(P('/publish-waivers'), { data: { kind: 'brex-missing', subject, reason: REASON } })).status()).toBe(201);
  const p = viewer.page;
  await p.goto(`/projects/${pid}/publication`);
  const card = p.getByTestId('publish-waivers');
  await expect(card.getByTestId('waiver-row')).toHaveCount(1);
  await expect(card.getByTestId('waiver-row')).toContainText(REASON);
  await expect(card.getByTestId('waiver-remove')).toHaveCount(0);
  await expect(card).toContainText('Only an editor, manager or owner can record or remove a waiver');
  await expect(p.getByTestId('build-publication')).toBeDisabled();
});
