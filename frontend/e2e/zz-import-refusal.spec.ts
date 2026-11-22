// A package refused on import says WHY in the new-project dialog.
//
// Found on a real installation: the Administrator's enterprise lists register only one enterprise, an author imported a package whose data modules
// name another, the server refused all of them (the check working as designed) and the dialog answered "The report says why." with no report to read.
// Now the dialog lists the reasons (grouped: 1 line for 1 reason, with how many files and a few names) and says where the author can act.
//
// The enterprise lists are shared state of the e2e server, so they are registered for this test only and removed again in afterAll.

import { test, expect, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminApi, newPerson, type Person } from './support/session';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'dm21', '5-0');

test.describe.configure({ mode: 'serial' });

let admin: APIRequestContext;
let author: Person;
let pkg: Buffer;
const registered: Array<[string, string]> = [];

test.beforeAll(async ({ browser, baseURL }) => {
  admin = await adminApi(baseURL);
  author = await newPerson(admin, browser, baseURL, 'refuse', 'Refusal Author');
  // a package whose data modules name enterprise 00000 / "Example Company", made while no enterprise is registered (the check is off, so it saves)
  const made = await author.api.post('/api/projects', { data: { name: 'Refusal source', format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5-0', responsiblePartner: { code: '00000', name: 'Example Company' } } } });
  expect(made.status()).toBe(201);
  const id = (await made.json()).project.id as string;
  const file = fs.readdirSync(FIX).find((f) => /-040A-D_/.test(f))!;
  expect((await author.api.post(`/api/projects/${id}/dms`, { data: { file, xml: fs.readFileSync(path.join(FIX, file), 'utf8') } })).status()).toBe(201);
  const exp = await author.api.get(`/api/projects/${id}/packages/project`);
  expect(exp.status()).toBe(200);
  pkg = Buffer.from(await exp.body());
  // now the Administrator registers a different enterprise: the check is on
  for (const list of ['rpc-cages', 'originator-cages']) {
    const r = await admin.post(`/api/admin/config/${list}`, { data: { cage: '1671Y', name: 'LNTDEFENCE', role: '' } });
    expect(r.status()).toBe(201);
    registered.push([list, (await r.json()).item.id as string]);
  }
});
test.afterAll(async () => {
  for (const [list, id] of registered) await admin.delete(`/api/admin/config/${list}/${id}`);   // leave the shared server as it was
  await author.page.context().close(); await admin.dispose();
});

test('the dialog lists why the package was refused, and what an author can do', async () => {
  const page = author.page;
  await page.goto('/workspace');
  await page.getByRole('button', { name: /New project/ }).first().click();
  await page.getByTestId('wiz-start-import').click();
  await page.getByTestId('wiz-import-file').setInputFiles({ name: 'refusal-package.zip', mimeType: 'application/zip', buffer: pkg });
  await expect(page.getByText(/This looks like an/)).toBeVisible();
  await page.getByTestId('wiz-create').click();

  const reasons = page.getByTestId('wiz-import-reasons');
  await expect(reasons).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'The package was not imported' })).toBeVisible();
  await expect(reasons).toContainText('Why it was not imported');
  await expect(reasons).toContainText(/enterprise code .00000. is not registered/);
  await expect(reasons).toContainText('DMC-EXAMPLE-A-00-00-01-00A-040A-D_001-00_EN-US.XML');   // the refused module is named
  await expect(reasons).toContainText('RPC CAGE codes and Originator CAGE codes');                    // and where to act
  await expect(page.getByText('The report says why')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/shots/import-refusal.png' });
});
