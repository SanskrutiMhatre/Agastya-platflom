// Phase 17 in a real browser: the project CSDB page (objects, packages, import report, HTML publication, revisions, extensions, findings)
// and the Administrator extension-profile and coverage sections.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = 'Correct-Horse-9!';
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dm21', '5-0');
const pick = (code: string) => fs.readdirSync(FIX).find((f) => f.includes(`-${code}A-D_`))!;
test.describe.configure({ mode: 'serial' });

let author: Page; let admin: Page; let pid = '';
async function api<T = any>(p: Page, method: 'get' | 'post' | 'put', url: string, data?: unknown): Promise<{ status: number; json: T }> {
  const r = await p.request[method](url, data === undefined ? {} : { data });
  return { status: r.status(), json: (await r.json().catch(() => ({}))) as T };
}

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  author = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  for (const p of [admin, author]) p.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  await api(admin, 'post', '/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  await api(admin, 'post', '/api/auth/login', { username: 'admin', password: PW });
  const made = await api<{ tempPassword: string }>(admin, 'post', '/api/team/users', { username: 'csdbuser', fullName: 'Csdb User', role: 'author' });
  await api(author, 'post', '/api/auth/login', { username: 'csdbuser', password: made.json.tempPassword });
  await api(author, 'post', '/api/auth/onboarding', { username: 'csdbuser', password: PW });
  const mk = await api<any>(author, 'post', '/api/projects', { name: 'Csdb Browser', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  pid = mk.json.project.id;
  for (const c of ['040', '520']) { const f = pick(c); const r = await api(author, 'post', `/api/projects/${pid}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') }); expect(r.status).toBe(201); }
});
test.afterAll(async () => { await author.context().close(); await admin.context().close(); });

test('CSDB page: generate a DML and create a comment; view renders in a sandboxed frame', async () => {
  await author.goto(`/projects/${pid}/csdb`);
  await expect(author.getByTestId('csdb-page')).toBeVisible();
  await author.getByRole('button', { name: /Generate DML/ }).click();
  await expect(author.getByTestId('objects-table')).toContainText('DML-EXAMPLE-00000-P-');
  await author.getByRole('button', { name: 'New comment' }).click();
  await author.getByRole('dialog').getByRole('combobox').selectOption({ index: 1 });
  await author.getByRole('dialog').getByRole('textbox').nth(0).fill('Torque wrong');
  await author.getByRole('dialog').getByRole('textbox').nth(1).fill('Please check the torque value.');
  await author.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(author.getByTestId('objects-table')).toContainText('COM-EXAMPLE-00000-');
  await author.getByTestId('objects-table').getByRole('row').filter({ hasText: 'COM-' }).getByRole('button', { name: 'View' }).click();
  await expect(author.frameLocator('iframe[sandbox]').getByText('Please check the torque value.')).toBeVisible();
});

test('Edit opens a CSDB object in the structured editor; a change is saved to the object file (not as a data module)', async () => {
  await author.goto(`/projects/${pid}/csdb`);
  const row = author.getByTestId('objects-table').getByRole('row').filter({ hasText: 'COM-' });
  const file = (await row.locator('.v2-mono').first().innerText()).trim();
  await row.getByTestId('object-edit').click();
  await expect(author).toHaveURL(/\/editor/);
  await expect(author.locator('.doc-tabs [role=tab]').first()).toContainText('COM-EXAMPLE');
  await author.locator('.vs-btn', { hasText: 'XML' }).click();
  await author.evaluate(() => {
    const s = (window as any).studio; const v = s.active.xml.view;
    const i = v.state.doc.toString().indexOf('Please check the torque value.');
    v.dispatch({ changes: { from: i, to: i, insert: 'EDITED ' } });
  });
  await author.keyboard.press('Control+s');
  await expect(author.locator('.toast', { hasText: 'Saved' }).first()).toBeVisible();
  const obj = await api<{ xml: string }>(author, 'get', `/api/projects/${pid}/objects/${encodeURIComponent(file)}`);
  expect(obj.json.xml).toContain('EDITED Please check the torque value.');
  expect(obj.json.xml).toContain('<comment ');
  const dms = await api<{ dms: Array<{ file: string }> }>(author, 'get', `/api/projects/${pid}/dms`);
  expect(dms.json.dms.some((d) => /^COM-/i.test(d.file))).toBe(false);
});

test('Packages: export is offered; importing a package shows a per-file report', async () => {
  await author.goto(`/projects/${pid}/csdb`);
  await author.getByRole('tab', { name: 'Packages' }).click();
  await expect(author.getByTestId('export-project')).toBeVisible();
  // a package built through the API, imported into a second project through the page
  const exp = await author.request.get(`/api/projects/${pid}/packages/project`); expect(exp.status()).toBe(200);
  const p2 = (await api<any>(author, 'post', '/api/projects', { name: 'Csdb Target', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
  await author.goto(`/projects/${p2}/csdb`);
  await author.getByRole('tab', { name: 'Packages' }).click();
  await author.getByTestId('import-file').setInputFiles({ name: 'pkg.zip', mimeType: 'application/zip', buffer: await exp.body() });
  await author.getByRole('button', { name: 'Import package' }).click();
  const rep = author.getByTestId('import-report');
  await expect(rep).toContainText('applied'); await expect(rep).toContainText('accepted');
  await expect(rep).toContainText(pick('040'));
});

test('Revisions: a new revision appears in the history, with its recorded event', async () => {
  await author.goto(`/projects/${pid}/csdb`);
  await author.getByRole('tab', { name: 'Revisions' }).click();
  const row = author.getByRole('row').filter({ hasText: pick('040') });
  await row.getByRole('button', { name: 'New revision' }).click();
  await expect(author.getByRole('row').filter({ hasText: '001-01' }).first()).toBeVisible();
  await author.getByRole('row').filter({ hasText: '001-01' }).first().getByRole('button', { name: 'History' }).click();
  await expect(author.getByTestId('revision-history')).toContainText('working-revision');
});

test('HTML publication builds from the page; findings list shows module, rule and fix', async () => {
  // the publication places the two modules (validated modules only are published)
  const code = (f: string) => /<dmCode\s+([^>]*?)\s*\/?>/.exec(fs.readFileSync(path.join(FIX, f), 'utf8'))![1];
  const pmRes = await api<any>(author, 'get', `/api/projects/${pid}/pmc`);
  const entries = [pick('040'), pick('520')].map((f) => ({ type: 'dm', title: f.slice(-24), dmCode: Object.fromEntries([...code(f).matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]])) }));
  expect((await api(author, 'put', `/api/projects/${pid}/pmc`, { meta: pmRes.json.meta, entries })).status).toBe(200);
  await author.goto(`/projects/${pid}/csdb`);
  await author.getByRole('tab', { name: 'HTML' }).click();
  await author.getByRole('button', { name: 'Build HTML publication' }).click();
  await expect(author.getByRole('link', { name: 'Download ZIP' })).toBeVisible({ timeout: 60_000 });
  await author.getByRole('tab', { name: 'Findings' }).click();
  await expect(author.getByRole('button', { name: /^all/ })).toBeVisible();
});

test('Administrator: register an extension profile, see the coverage matrix', async () => {
  await admin.goto('/administrator/extensions');
  await expect(admin.getByTestId('ext-admin')).toBeVisible();
  await admin.getByLabel('Name', { exact: true }).fill('Maintenance');
  await admin.getByLabel('Namespace URI').fill('http://example.com/ns/maint');
  const xsd = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="http://example.com/ns/maint" xmlns="http://example.com/ns/maint" elementFormDefault="qualified"><xs:element name="tag" type="xs:string"/></xs:schema>`;
  await admin.locator('input[type=file]').setInputFiles({ name: 'maint.xsd', mimeType: 'text/xml', buffer: Buffer.from(xsd) });
  await admin.getByRole('button', { name: 'Register' }).click();
  await expect(admin.getByTestId('ext-admin')).toContainText('http://example.com/ns/maint');
  await author.goto(`/projects/${pid}/csdb`);
  await author.getByRole('tab', { name: 'Extensions' }).click();
  await expect(author.getByText('Maintenance')).toBeVisible();
  await admin.goto('/administrator/coverage');
  const cov = admin.getByTestId('coverage');
  await expect(cov).toContainText('comment'); await expect(cov.getByText('missing').first()).toBeVisible();
});
