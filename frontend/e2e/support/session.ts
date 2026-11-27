// Shared set-up for the self-contained specs (import package, publish waivers, brand pack): an administrator, people with the roles under test,
// and signed-in browser contexts. 00-platform.spec.ts creates the administrator through the UI; these specs work whether or not it already did.

import { expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';

export const PW = 'Correct-Horse-9!';

/** The administrator: created on first use, signed in when the first-run spec has already made it. */
export async function adminApi(baseURL: string | undefined): Promise<APIRequestContext> {
  const admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) expect((await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } })).ok()).toBeTruthy();
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  return admin;
}

export interface Person { username: string; page: Page; api: APIRequestContext }

/** A new Author who has chosen her password, in a browser window of her own. `role` is the GLOBAL role (authors are what project roles are given to). */
export async function newPerson(admin: APIRequestContext, browser: Browser, baseURL: string | undefined, prefix: string, fullName: string): Promise<Person> {
  const username = `${prefix}${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username, fullName, role: 'author' } });
  expect(made.status()).toBe(201);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error (${username}): ${e.message}`); });
  const api = ctx.request;
  expect((await api.post('/api/auth/login', { data: { username, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username, password: PW } })).ok()).toBeTruthy();
  return { username, page, api };
}

/** Give `who` a role on a project, as the project's owner. */
export async function assign(owner: APIRequestContext, projectId: string, username: string, role: 'viewer' | 'reviewer' | 'editor'): Promise<void> {
  expect((await owner.post(`/api/projects/${projectId}/assign`, { data: { username, role } })).status()).toBe(200);
}
