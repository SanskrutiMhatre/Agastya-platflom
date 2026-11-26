// A package whose data modules name an enterprise the Administrator has not registered is IMPORTED, and the dialog says so.
//
// Found on a real installation: the dialog refused such a package ( "the enterprise code is not registered" ) although the platform's own package importer only reports it
// (services/importer/apply.ts: a foreign package would otherwise be impossible to bring in at all). The dialog now uses that importer: the project is made, and the result lists
// the reason once, with where an Administrator can register the enterprise.
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

test('a package naming an unregistered enterprise is imported, and the result says which enterprise and what an Administrator can do', async () => {
  const page = author.page;
  await page.goto('/workspace');
  await page.getByRole('button', { name: /New project/ }).first().click();
  await page.getByTestId('wiz-start-import').click();
  await page.getByTestId('wiz-import-file').setInputFiles({ name: 'unregistered-package.zip', mimeType: 'application/zip', buffer: pkg });
  await expect(page.getByTestId('wiz-detected')).toContainText('An S1000D package');       // the first look is only a guess ...
  await expect(page.getByTestId('wiz-create')).toBeDisabled();                              // ... so nothing is imported until the person has confirmed it
  await page.getByTestId('wiz-source-confirm').click();
  await page.getByTestId('wiz-create').click();

  await expect(page.getByTestId('wiz-done')).toContainText('S1000D');                      // made, not refused
  const findings = page.getByTestId('import-as-findings');
  await expect(findings).toContainText(/enterprise code .00000. is not registered/);
  await expect(findings).toContainText('RPC CAGE codes and Originator CAGE codes');         // and where to act
  await expect(page.getByTestId('wiz-import-reasons')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'The package was not imported' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/shots/import-unregistered-enterprise.png' });
  await page.getByTestId('wiz-done-close').click();
});
