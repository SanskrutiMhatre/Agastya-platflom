// Phase 3 (P3-5): the intranet GitLab integration in the browser, against the mock GitLab of the backend tests
// (backend/test/fixtures/mock-gitlab: TLS from a throwaway CA made in memory, never installed; the administrator uploads its certificate).
//
//   Off: no Repository page in the rail, no GitLab card on the account page.
//   Administration > System > GitLab: Save stays disabled until "Test connection" passed; the TLS check fails without the CA and passes with it.
//   A person connects through GitLab sign-in (OAuth + PKCE, the mock consents at once), links a new repository in a group, pushes, pulls a change
//   made in GitLab, meets a conflict and keeps their own version, opens a review as a merge request with a reviewer, and syncs GitLab's notes in.
//   The administrator switches GitLab off and the Repository page goes away.
//
// Self-contained. Run on its own port: E2E_PORT=4342 E2E_CHANNEL=msedge npx playwright test e2e/gitlab.spec.ts   (the mock listens on 4344)

import { test, expect, type Browser, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { adminApi, PW } from './support/session';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const { startMockGitlab } = req('../../backend/test/fixtures/mock-gitlab/server.js');
const { makeCertificate } = req('../../backend/dist/services/tlsCert.js');
const FIX = path.join(HERE, 'fixtures', 'dm21', '5-0');
const F040 = fs.readdirSync(FIX).find((f) => f.includes('-040A-D_'))!;
const MOCK_PORT = Number(process.env.E2E_GITLAB_PORT || 4344);

test.describe.configure({ mode: 'serial' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gl: any; let app: { clientId: string; secret: string };
let adminCtx: BrowserContext; let adminPage: Page;
let author: { username: string; ctx: BrowserContext; page: Page; api: APIRequestContext };
let reviewer: { username: string; api: APIRequestContext; id: string };
let glAuthor: { id: number }; let glReviewer: { id: number };
let pid = ''; let glProject = 0;

/** A person with a browser window that accepts the mock's certificate (only the OAuth hop opens GitLab pages in the browser). */
async function person(admin: APIRequestContext, browser: Browser, baseURL: string | undefined, prefix: string, fullName: string) {
  const username = `${prefix}${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username, fullName, role: 'author' } });
  expect(made.status()).toBe(201);
  const body = await made.json();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error (${username}): ${e.message}`); });
  expect((await ctx.request.post('/api/auth/login', { data: { username, password: body.tempPassword } })).ok()).toBeTruthy();
  expect((await ctx.request.post('/api/auth/onboarding', { data: { username, password: PW } })).ok()).toBeTruthy();
  return { username, ctx, page, api: ctx.request, id: body.user.id as string };
}
const dmXml = async (api: APIRequestContext) => (await (await api.get(`/api/projects/${pid}/dms/${F040}`)).json()) as { xml: string; hash: string };
const saveDm = async (api: APIRequestContext, edit: (x: string) => string) => { const cur = await dmXml(api); expect((await api.put(`/api/projects/${pid}/dms/${F040}`, { data: { xml: edit(cur.xml), baseHash: cur.hash } })).status()).toBe(200); };

test.beforeAll(async ({ browser, baseURL }) => {
  gl = await startMockGitlab({ port: MOCK_PORT, makeCertificate });
  app = gl.addApp({ redirectUri: `${baseURL}/api/gitlab/oauth/callback` });
  gl.addNamespace({ path: 'manuals', name: 'Manuals' });
  glAuthor = gl.addUser({ username: 'gl-anna', name: 'Anna in GitLab' });
  glReviewer = gl.addUser({ username: 'gl-ravi', name: 'Ravi in GitLab' });
  gl.state.authorizeAs = glAuthor.id;

  await (await adminApi(baseURL)).dispose();                               // makes the administrator on a fresh server
  adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  expect((await adminCtx.request.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();   // one session per person: this one is used throughout
  const admin = adminCtx.request;
  adminPage = await adminCtx.newPage();
  author = await person(admin, browser, baseURL, 'anna', 'Anna Author');
  reviewer = await person(admin, browser, baseURL, 'ravi', 'Ravi Reviewer');
  const mk = await author.api.post('/api/projects', { data: { name: `Git manual ${Date.now() % 100000}`, pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } } });
  expect(mk.status()).toBe(201);
  pid = (await mk.json()).project.id;
  expect((await author.api.post(`/api/projects/${pid}/dms`, { data: { file: F040, xml: fs.readFileSync(path.join(FIX, F040), 'utf8') } })).status()).toBe(201);
  expect((await author.api.post(`/api/projects/${pid}/assign`, { data: { username: reviewer.username, role: 'reviewer' } })).status()).toBe(200);
});
test.afterAll(async () => { if (gl) await gl.close(); });

test('while GitLab is off nothing of it shows', async () => {
  await author.page.goto(`/projects/${pid}/home`);
  await expect(author.page.getByTestId('project-bar-name')).toBeVisible();
  await expect(author.page.locator(`a[href="/projects/${pid}/repository"]`)).toHaveCount(0);
  await author.page.goto('/settings/account');
  await expect(author.page.getByRole('heading', { name: 'Change password' })).toBeVisible();
  await expect(author.page.getByTestId('gitlab-connect')).toHaveCount(0);
  expect((await author.api.get('/api/gitlab/me')).status()).toBe(404);
});

test('the administrator sets GitLab up: the test must pass (TLS through the uploaded CA) before Save', async () => {
  await adminPage.goto('/administrator/gitlab');
  await expect(adminPage.getByTestId('gitlab-admin')).toBeVisible();
  await expect(adminPage.getByTestId('gitlab-redirect-uri')).toHaveValue(/\/api\/gitlab\/oauth\/callback$/);
  await adminPage.getByTestId('gitlab-base-url').fill(gl.url);
  await adminPage.getByTestId('gitlab-app-id').fill(app.clientId);
  await adminPage.getByTestId('gitlab-app-secret').fill(app.secret);
  await adminPage.getByTestId('gitlab-test-token').fill(gl.addToken(glReviewer.id));
  await expect(adminPage.getByTestId('gitlab-save')).toBeDisabled();
  await adminPage.getByTestId('gitlab-test').click();
  await expect(adminPage.getByTestId('gitlab-check-tls')).toContainText('Failed');
  await expect(adminPage.getByTestId('gitlab-save')).toBeDisabled();
  await adminPage.getByTestId('gitlab-ca-file').setInputFiles({ name: 'corp-ca.pem', mimeType: 'application/x-pem-file', buffer: Buffer.from(gl.caPem) });
  await expect(adminPage.getByTestId('gitlab-ca-name')).toHaveText('corp-ca.pem');
  await adminPage.getByTestId('gitlab-test').click();
  await expect(adminPage.getByTestId('gitlab-check-tls')).toContainText('Passed');
  await expect(adminPage.getByTestId('gitlab-check-oauth')).toContainText('Passed');
  await adminPage.getByTestId('gitlab-save').click();
  await expect(adminPage.getByTestId('gitlab-admin')).toContainText('On · GitLab 17.5.1');
  await expect(adminPage.getByTestId('gitlab-app-secret')).toHaveValue('');        // the secret is never shown again
  await adminPage.screenshot({ path: 'test-results/shots/gitlab-admin.png', fullPage: true });
});

test('a person connects through GitLab sign-in and the Repository page appears', async () => {
  const p = author.page;
  await p.goto('/settings/account');
  await expect(p.getByTestId('gitlab-connect')).toContainText('Not connected');
  await p.getByTestId('gitlab-connect-oauth').click();
  await p.waitForURL(/\/settings\/account/);
  await expect(p.getByTestId('gitlab-me-account')).toContainText('gl-anna');
  await p.goto(`/projects/${pid}/home`);
  await expect(p.locator(`a[href="/projects/${pid}/repository"]`).first()).toBeVisible();
  // phase 8: also a Project Home tile and a "Jump to" (Ctrl+K) entry while GitLab is on
  await expect(p.getByTestId('home-tile-repository')).toBeVisible();
  await p.getByTestId('jump-open').click();
  await p.getByTestId('palette-input').fill('repository');
  await expect(p.getByTestId('palette-list').getByRole('option', { name: 'Repository', exact: true })).toBeVisible();
  await p.keyboard.press('Escape');
  // the reviewer connects with a personal access token
  expect((await reviewer.api.post('/api/gitlab/connect/token', { data: { token: gl.addToken(glReviewer.id) } })).status()).toBe(200);
});

test('link a new repository and push; a change made in GitLab is pulled', async () => {
  const p = author.page;
  await p.goto(`/projects/${pid}/repository`);
  await expect(p.getByTestId('gitlab-link')).toBeVisible();
  await p.getByTestId('gitlab-link-namespace').selectOption({ label: 'manuals' });
  await p.getByTestId('gitlab-link-name').fill('Git manual');
  await p.getByTestId('gitlab-link-go').click();
  await expect(p.getByTestId('gitlab-status')).toContainText('manuals/git-manual');
  await expect(p.getByTestId('gitlab-local')).toContainText(F040);
  await p.getByTestId('gitlab-commit-message').fill('First version from Agastya');
  await p.getByTestId('gitlab-push').click();
  await expect(p.getByTestId('gitlab-status')).toContainText('None: GitLab has everything.');
  glProject = [...gl.state.projects.values()].find((x: { path_with_namespace: string }) => x.path_with_namespace === 'manuals/git-manual').id;
  expect(gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8')).toContain('First item');
  await expect(p.getByTestId('gitlab-history')).toContainText('First version from Agastya');

  gl.commitAs(glProject, glReviewer.id, 'main', 'Edited in GitLab', { [`csdb/${F040}`]: gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8').replace('First item', 'First item (from GitLab)') });
  await p.reload();
  await expect(p.getByTestId('gitlab-behind')).toBeVisible();
  await p.getByTestId('gitlab-incoming').click();
  await expect(p.getByTestId('gitlab-pull-panel')).toContainText('Edited in GitLab');
  await expect(p.getByTestId('gitlab-pull-item-apply')).toContainText(F040);
  await p.getByTestId('gitlab-pull-apply').click();
  await expect(p.getByTestId('gitlab-pull-panel')).toHaveCount(0);
  expect((await dmXml(author.api)).xml).toContain('First item (from GitLab)');
});

test('a conflict is never resolved silently: the person keeps their own version', async () => {
  const p = author.page;
  await saveDm(author.api, (x) => x.replace('Step one', 'Step one (Anna)'));
  gl.commitAs(glProject, glReviewer.id, 'main', 'Step one in GitLab', { [`csdb/${F040}`]: gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8').replace('Step one', 'Step one (Ravi)') });
  await p.goto(`/projects/${pid}/repository`);
  await p.getByTestId('gitlab-incoming').click();
  await expect(p.getByTestId('gitlab-pull-item-conflict')).toContainText(F040);
  await expect(p.getByTestId('gitlab-pull-apply')).toBeDisabled();
  await p.getByTestId('gitlab-resolve-mine').check();
  await p.getByTestId('gitlab-pull-apply').click();
  await expect(p.getByTestId('gitlab-pull-panel')).toHaveCount(0);
  expect((await dmXml(author.api)).xml).toContain('Step one (Anna)');
  await p.getByTestId('gitlab-push').click();
  await expect(p.getByTestId('gitlab-status')).toContainText('None: GitLab has everything.');
  expect(gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8')).toContain('Step one (Anna)');
});

test('a review as a merge request: reviewer mapped, notes from GitLab come in as review comments', async () => {
  const p = author.page;
  await saveDm(author.api, (x) => x.replace('Voltage', 'Supply voltage'));
  await p.goto(`/projects/${pid}/repository`);
  await p.getByTestId('gitlab-mr-open').click();
  await p.getByTestId('gitlab-mr-title').fill('Review of the supply table');
  await p.getByTestId(`gitlab-mr-reviewer-${reviewer.username}`).check();
  await p.getByTestId('gitlab-mr-create').click();
  await expect(p.getByTestId('gitlab-mr-1')).toContainText('Review of the supply table');
  const mr = gl.mr(glProject, 1);
  expect(mr.reviewers.map((r: { userId: number }) => r.userId)).toEqual([glReviewer.id]);
  gl.addNote(glProject, 1, glReviewer.id, 'Say 28 V DC here, please.', { path: `csdb/${F040}` });
  await p.getByTestId('gitlab-mr-sync').click();
  await expect(p.getByTestId('gitlab-mr-sync-result')).toContainText('1 note added');
  await p.goto(`/projects/${pid}/release`);
  await expect(p.getByTestId('gitlab-mrs')).toContainText('Review of the supply table');
  await expect(p.getByTestId('review-thread')).toContainText('Say 28 V DC here, please.');
  await p.screenshot({ path: 'test-results/shots/gitlab-release-mr.png', fullPage: true });
});

test('switching GitLab off takes the Repository page away', async () => {
  await adminPage.goto('/administrator/gitlab');
  await adminPage.getByTestId('gitlab-remove').click();
  await adminPage.getByRole('dialog').getByRole('button', { name: 'Switch off' }).click();
  await expect(adminPage.getByTestId('gitlab-admin')).toContainText('Off');
  await author.page.goto(`/projects/${pid}/repository`);
  await author.page.waitForURL(new RegExp(`/projects/${pid}/home`));
  await expect(author.page.locator(`a[href="/projects/${pid}/repository"]`)).toHaveCount(0);
});
