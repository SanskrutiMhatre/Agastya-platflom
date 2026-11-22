// S1000D reference configuration, end to end in a real browser: the New project wizard (with its review step), the project's S1000D
// settings (identity, SNS, applicability), the New data module wizard driven by that configuration, and the Administrator catalogue.
import { test, expect, type Page } from '@playwright/test';

const PW = 'Correct-Horse-9!';
test.describe.configure({ mode: 'serial' });

let author: Page; let admin: Page; let projectId = '';

async function api<T = any>(p: Page, method: 'get' | 'post' | 'put', url: string, data?: unknown): Promise<{ status: number; json: T }> {
  const r = await p.request[method](url, data === undefined ? {} : { data });
  return { status: r.status(), json: (await r.json().catch(() => ({}))) as T };
}

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  author = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  for (const p of [admin, author]) p.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  await api(admin, 'post', '/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });   // already set up when run with the platform suite
  await api(admin, 'post', '/api/auth/login', { username: 'admin', password: PW });
  const made = await api<{ tempPassword: string }>(admin, 'post', '/api/team/users', { username: 'zoya', fullName: 'Zoya Config', role: 'author' });
  await api(author, 'post', '/api/auth/login', { username: 'zoya', password: made.json.tempPassword });
  await api(author, 'post', '/api/auth/onboarding', { username: 'zoya', password: PW });
});
test.afterAll(async () => { await author.context().close(); await admin.context().close(); });

test('New project wizard: four steps with validation, a review, and the configuration it created', async () => {
  await author.goto('/workspace');
  await author.getByRole('button', { name: /New project/ }).first().click();
  await author.getByTestId('wiz-start-create').click();             // the wizard opens on "Create a new project" / "Import a package"
  // step 1 needs a name
  await author.getByTestId('wiz-next').click();
  await expect(author.getByRole('alert')).toContainText('project name');
  await author.getByTestId('wiz-name').fill('Config Manual');
  await author.getByTestId('wiz-next').click();
  // step 2: identity is validated
  await author.getByTestId('wiz-next').click();
  await expect(author.getByRole('alert')).toContainText('model code is 2 to 14');
  await author.getByTestId('wiz-mic').fill('wiz01');
  await author.getByText('Advanced', { exact: true }).click();     // the issue now lives under "Advanced" (closed by default)
  await author.getByTestId('wiz-issue').selectOption('6');
  await author.getByLabel('Enterprise code').first().fill('CFG01');
  await author.getByLabel('Enterprise name').first().fill('Config Co');
  await author.getByTestId('wiz-next').click();
  // step 3: narrow the information codes and start from the generic SNS
  await author.getByTestId('wiz-codes-selected').check();
  await author.getByTestId('wiz-next').click();
  await expect(author.getByRole('alert')).toContainText('at least one information code');
  await author.getByLabel('Offer 040').check();
  await author.getByLabel('Offer 520').check();
  await author.getByTestId('wiz-preset').selectOption('spec42-8-2-1');
  await author.getByTestId('wiz-next').click();
  // step 4: the review says what will be created
  const review = author.getByTestId('wiz-review');
  await expect(review).toContainText('WIZ01');
  await expect(review).toContainText('6.0');
  await expect(review).toContainText('2 chosen');
  await expect(review).toContainText('S1000D 4.2 · Generic');
  await author.getByTestId('wiz-back').click();                     // going back keeps what was entered
  await expect(author.getByTestId('wiz-preset')).toHaveValue('spec42-8-2-1');
  await author.getByTestId('wiz-next').click();
  await author.getByTestId('wiz-create').click();
  const card = author.getByTestId('project-card').filter({ hasText: 'Config Manual' });
  await expect(card).toBeVisible();
  await card.click();
  projectId = author.url().match(/projects\/([^/]+)/)![1];
  const cfg = (await api<any>(author, 'get', `/api/projects/${projectId}/s1000d`)).json;
  expect(cfg.config.mic).toBe('WIZ01'); expect(cfg.config.issue).toBe('6');
  expect(cfg.codes.infoCode.map((c: any) => c.code)).toEqual(['040', '520']);
  expect(cfg.sns.filter((n: any) => n.level === 1).length).toBeGreaterThan(10);
});

test('project settings → S1000D: identity, information codes, SNS editing and search', async () => {
  await author.goto(`/projects/${projectId}/settings/s1000d`);
  await expect(author.getByTestId('s1000d-identity').getByLabel('Model identification code')).toHaveValue('WIZ01');
  await author.getByTestId('s1000d-tab-codes').click();
  await expect(author.getByTestId('s1000d-codes')).toContainText('Issue 6.0');
  await expect(author.getByTestId('s1000d-codes')).toContainText('BREX-S1-00180');
  await author.getByTestId('s1000d-tab-types').click();
  await expect(author.getByTestId('s1000d-types').getByRole('row')).toHaveCount(22);                 // header + the 21 types
  await expect(author.getByTestId('s1000d-types')).toContainText('unconfirmed');                     // crew 131, front matter 001, the four 000 placeholders
  await author.getByTestId('s1000d-tab-sns').click();
  await expect(author.getByTestId('s1000d-sns')).toContainText('Product, General');
  await author.getByTestId('sns-add').click();
  await author.getByTestId('sns-code').fill('77');
  await author.getByTestId('sns-title').fill('Pump skid');
  await author.getByTestId('sns-save').click();
  await author.getByLabel('Search the SNS').fill('pump skid');
  await expect(author.getByTestId('sns-row')).toHaveCount(1);
  await author.getByLabel('Add below 77').click();
  await author.getByTestId('sns-code').fill('10');
  await author.getByTestId('sns-title').fill('Main pump');
  await author.getByTestId('sns-save').click();
  await author.getByLabel('Search the SNS').fill('pump');
  await expect(author.getByTestId('sns-row')).toHaveCount(2);
  // a bad code is refused by the server and said in words
  await author.getByLabel('Add below 77/10').click();
  await author.getByTestId('sns-code').fill('123');
  await author.getByTestId('sns-save').click();
  await expect(author.getByRole('dialog').getByRole('alert')).toContainText('2 or 4');
  await author.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
});

test('applicability: define attributes, save as data modules, see the validation list', async () => {
  await author.goto(`/projects/${projectId}/settings/s1000d`);
  await author.getByTestId('s1000d-tab-applic').click();
  await expect(author.getByTestId('s1000d-applic')).toContainText('not applied to publishing');
  await author.getByTestId('add-attribute').click();
  const row = author.getByTestId('s1000d-applic').locator('tbody tr').first();
  const cells = row.locator('input');
  await cells.nth(0).fill('colour'); await cells.nth(1).fill('Colour'); await cells.nth(2).fill('Paint colour'); await cells.nth(3).fill('red, blue');
  await author.getByTestId('applic-save').click();
  await expect(author.getByTestId('applic-problems')).toContainText('Every applicability reference resolves');
  const a = (await api<any>(author, 'get', `/api/projects/${projectId}/applicability`)).json;
  expect(a.files.act).toMatch(/^DMC-WIZ01-A-00-00-00-00A-00WA-D_/);
  expect(a.model.attributes[0].values.map((v: any) => v.value)).toEqual(['red', 'blue']);
  expect(a.filtering).toBe(false);
});

test('New data module wizard follows the project: fixed MIC and issue, SNS pickers, enabled codes, structured applicability', async () => {
  await author.goto(`/projects/${projectId}/editor`);
  await author.getByRole('complementary', { name: 'Data modules' }).getByRole('button', { name: 'New data module' }).click();
  const dlg = author.getByRole('dialog', { name: 'New data module' });
  await expect(dlg.getByLabel('Model ident')).toHaveValue('WIZ01');
  await expect(dlg.getByLabel('Model ident')).toHaveAttribute('readonly', 'true');
  await expect(dlg.getByLabel('S1000D issue')).toBeDisabled();
  await expect(dlg.getByLabel('S1000D issue')).toHaveValue('6');
  // system comes from the project's SNS
  await expect(dlg.getByLabel('System', { exact: true }).locator('option', { hasText: '00 – Product, General' })).toHaveCount(1);
  await dlg.getByLabel('System', { exact: true }).selectOption('77');
  await expect(dlg.getByLabel('Subsystem')).toHaveValue('10');
  await expect(dlg.locator('.dmc-preview')).toContainText('WIZ01-A-77-10');
  // only the enabled information codes, the type's own code suggested first
  const info = dlg.getByLabel('Info code');
  await expect(info.locator('option')).toHaveCount(2);                                      // descript's 040 and proced's 520 are the only enabled codes
  await expect(info).toHaveValue('040');
  // structured applicability from the project's ACT
  await dlg.getByLabel('Applicability mode').selectOption('select');
  await dlg.getByLabel('red').check();
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(author.getByRole('dialog', { name: 'New data module' })).toHaveCount(0);
});

test('Administrator → S1000D catalogue: provenance per issue, custom codes outside the BREX are flagged', async () => {
  await admin.goto('/administrator/s1000d-catalogue');
  const cat = admin.getByTestId('s1000d-catalogue');
  await expect(cat).toContainText('what the specification says');
  await cat.getByTestId('cat-technical').locator('summary').first().click();                 // the provenance now sits under "Technical details" (closed by default)
  await cat.getByTestId('default-evidence').locator('summary').click();
  await expect(cat.getByTestId('default-evidence')).toContainText('wrngflds');
  await expect(cat.getByTestId('default-evidence')).toContainText('corrected');
  await admin.getByTestId('cat-issue').selectOption('7');
  await expect(admin.getByTestId('cat-source')).toContainText('DMC-S1000D-J-04-10-0301-00A-022A-D');
  await expect(admin.getByTestId('cat-source')).toContainText('BREX-S1-00180');
  await admin.getByTestId('cat-add').click();
  await admin.getByTestId('cat-code').fill('QZ9');
  await admin.getByTestId('cat-title').fill('Customer-only procedure');
  await admin.getByTestId('cat-save').click();
  await admin.getByLabel('Filter codes').fill('QZ9');
  const row = admin.getByTestId('cat-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('custom, outside BREX');
  await admin.getByLabel('Delete QZ9').click();                                              // no project uses it: deleted without a confirmation
  await expect(admin.getByTestId('cat-row')).toHaveCount(0);
  // the SNS presets screen shows the 4.2 specification source and its limitation
  await admin.goto('/administrator/sns-presets');
  await expect(admin.getByTestId('preset-row')).toHaveCount(8);                               // the 8 specification presets (no custom or migrated preset on a fresh install)
  await admin.getByTestId('preset-row').first().click();
  await expect(admin.getByTestId('sns-presets')).toContainText('Issue 4.2 only');
});

test('Generate → Configuration…: choose a configuration, check what it includes (unfiltered Generate is separate)', async () => {
  await author.goto(`/projects/${projectId}/editor`);
  await author.getByTestId('config-btn').click();
  const dlg = author.getByTestId('cfg-dialog');
  await expect(dlg).toContainText('unresolved');                                          // the rule is stated in the dialog
  await expect(dlg.getByLabel('Value of Colour')).toBeVisible();                          // the ACT attribute defined earlier is offered
  await expect(author.getByTestId('cfg-check')).toBeDisabled();                            // nothing chosen yet
  await dlg.getByLabel('Value of Colour').selectOption('red');
  await author.getByTestId('cfg-check').click();
  await expect(author.getByTestId('cfg-plan')).toBeVisible();
  await expect(author.getByTestId('cfg-plan')).toContainText('data module(s) included');
  await author.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(author.getByTestId('generate-btn')).toBeVisible();                          // plain Generate is still there, unchanged
});
