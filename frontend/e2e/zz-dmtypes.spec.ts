// All seven data module types, end to end in a real browser against the real server:
// import the rich module -> open in the Studio -> it renders and is schema-valid -> the tag rules hold in the editor
// -> type an edit and save with Ctrl+S -> the server has it -> Quick preview (browser engine and server FOP engine).
//
// Self-contained: creates its own author and project through the API (the UI sign-in is covered by platform.spec.ts).

import { test, expect, request as pwRequest, type Page, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, '..', '..', 'backend', 'test', 'fixtures', 'rich');
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';
const PW = 'Correct-Horse-9!';

interface Type {
  label: string; file: string;
  /** visible text in the design view that we click to place the caret and then edit */
  text: string;
  /** an element that must NOT be insertable here, and (optionally) one that must be */
  forbidden: string; allowed?: string;
  /** the editor rule for this type at the caret */
  schema: string;
}
const T = (code: string) => `DMC-EXAMPLE-A-00-00-00-00A-${code}-D_001-00_EN-US.XML`;
const TYPES: Type[] = [
  { label: 'descriptive', file: T('040A'), text: 'Second section', forbidden: 'proceduralStep', allowed: 'para', schema: 'descript' },
  { label: 'procedural', file: T('520A'), text: 'Remove the four screws.', forbidden: 'levelledPara', allowed: 'proceduralStep', schema: 'proced' },
  { label: 'fault isolation', file: T('421A'), text: 'Measure the supply voltage.', forbidden: 'levelledPara', schema: 'fault' },
  { label: 'crew', file: T('131A'), text: 'Complete the drills in order.', forbidden: 'proceduralStep', schema: 'crew' },
  { label: 'illustrated parts', file: T('941A'), text: 'Unit assembly', forbidden: 'proceduralStep', schema: 'ipd' },
  { label: 'brex', file: T('022A'), text: 'Strikethrough emphasis must not be used.', forbidden: 'proceduralStep', schema: 'brex' },
  { label: 'common repository', file: T('00LA'), text: 'Hot surface.', forbidden: 'proceduralStep', schema: 'comrep' },
];

let api: APIRequestContext;
let page: Page;
let pid = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const who = `types${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username: who, fullName: 'Type Tester', role: 'author' } });
  expect(made.status()).toBe(201);
  const temp = (await made.json()).tempPassword;

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  api = ctx.request;
  expect((await api.post('/api/auth/login', { data: { username: who, password: temp } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username: who, password: PW } })).ok()).toBeTruthy();
  const p = await api.post('/api/projects', { data: { name: 'All seven types', pipeline: 's1000dtofo' } });
  expect(p.status()).toBe(201);
  pid = (await p.json()).project.id;
  await admin.dispose();
});
test.afterAll(async () => { await page.context().close(); });

test('open the project editor and import the seven rich modules plus the figure', async () => {
  await page.goto(`/projects/${pid}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  await page.locator('input[type=file][multiple]:not([data-testid])').setInputFiles([...TYPES.map((t) => path.join(FIX, t.file)), path.join(FIX, ICN)]);
  for (const t of TYPES) await expect(page.getByTestId('dm-list').locator(`[data-file="${t.file}"]`)).toBeVisible();
});

for (const t of TYPES) {
  test(`${t.label}: opens, renders, is schema-valid, enforces its tag rules, edits and saves`, async () => {
    await page.getByTestId('dm-list').locator(`[data-file="${t.file}"]`).click();
    const design = page.locator('.design-page:visible');
    await expect(design).toContainText(t.text.replace(/\.$/, ''), { timeout: 20_000 });
    expect(await page.evaluate(() => (window as any).studio.active.grammar?.json?.schema ?? (window as any).studio.active.grammar?.schema ?? null)).toBe(t.schema);

    // schema validation through the Studio's own validator (WASM xmllint against the official XSD)
    await page.evaluate(async () => { const s = (window as any).studio; await s.validate(s.active, { live: false, xsd: true, brex: false }); });
    await expect.poll(() => page.evaluate(() => { const a = (window as any).studio.active; return !a.validating && !a.pendingValidation && !!a.report?.xsd; }), { timeout: 30_000 }).toBe(true);
    const report = await page.evaluate(() => { const r = (window as any).studio.active.report; return { issues: r.issues, xsdRan: r.xsd?.ran }; });
    expect(report.xsdRan, 'the XSD check really ran (not skipped)').toBe(true);
    const errs = (report.issues as any[]).filter((i) => i.severity === 'error').map((i) => `${i.source}: ${i.message}`);
    expect(errs).toEqual([]);
    await expect(page.getByText(/^\s*Valid\s*$/).first()).toBeVisible();

    // put the caret in the text, then ask the editor what it would accept here
    await design.getByText(t.text, { exact: false }).first().click();
    const can = (name: string) => page.evaluate((n) => (window as any).studio.active.canInsert(n), name);
    expect(await can(t.forbidden), `${t.forbidden} must not be insertable in a ${t.label} module`).toBe(false);
    if (t.allowed) expect(await can(t.allowed), `${t.allowed} is insertable in a ${t.label} module`).toBe(true);

    // a real edit, a real save
    await page.keyboard.press('End');
    await page.keyboard.type(' ZQX');
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toast', { hasText: 'Saved' }).first()).toBeVisible();
    const saved = await (await api.get(`/api/projects/${pid}/dms/${t.file}`)).json();
    expect(saved.xml).toContain('ZQX');
    expect(saved.xml).toContain('<?xml');
  });
}

test('quick preview of each type: the server (FOP) renders it and the PDF page is drawn', async () => {
  // the browser engine was retired: Quick preview is always the server's rendering
  for (const t of TYPES) {
    await page.getByTestId('dm-list').locator(`[data-file="${t.file}"]`).click();
    await expect(page.locator('.design-page:visible')).toContainText('ZQX');
    await page.getByTestId('quick-preview-btn').click();
    await expect(page.locator('.v2-log', { hasText: /Rendered by the server/ }).last(), `${t.label}: server preview`).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('pdf-pane').locator('canvas').first(), `${t.label}: PDF page drawn`).toBeVisible({ timeout: 60_000 });
  }
});

test('the server agrees: validation of the saved project finds no schema errors', async () => {
  const r = await (await api.post(`/api/projects/${pid}/validation`, { data: { issue: 'auto', brex: false } })).json();
  expect(r.run.schemaChecked).toBe(7);
  const bad = r.run.issues.filter((i: any) => (i.source === 'xsd' || i.source === 'xml') && i.sev === 'error');
  expect(bad).toEqual([]);
  expect(fs.existsSync(FIX)).toBeTruthy();
});

test('wizard: all 21 types can be created from scratch, are valid in the Studio, use their own tag rules, and save as valid XSD on the server', async () => {
  const p = await api.post('/api/projects', { data: { name: 'Wizard types', pipeline: 's1000dtofo' } });
  const wid = (await p.json()).project.id;
  await page.goto(`/projects/${wid}/editor`);
  await expect(page.getByTestId('studio-host')).toBeVisible();
  const panel = page.getByRole('complementary', { name: 'Data modules' });
  // wizard label -> schema
  const types: Array<[string, string]> = [
    ['Descriptive', 'descript'], ['Procedural', 'proced'], ['Fault isolation', 'fault'], ['Crew/Operator', 'crew'],
    ['Illustrated parts data', 'ipd'], ['Business rules exchange', 'brex'], ['Common information repository', 'comrep'],
    ['Applicability cross-reference table', 'appliccrossreftable'], ['Conditions cross-reference table', 'condcrossreftable'],
    ['Product cross-reference table', 'prdcrossreftable'], ['Business rules document', 'brdoc'], ['Checklist', 'checklist'],
    ['Container', 'container'], ['Front matter', 'frontmatter'], ['Learning', 'learning'], ['Process', 'process'],
    ['Service bulletin', 'sb'], ['Maintenance schedule', 'schedul'], ['SCO content', 'scocontent'], ['Wiring data', 'wrngdata'], ['Wiring fields', 'wrngflds'],
  ];
  for (const [i, [label, schema]] of types.entries()) {
    await panel.getByRole('button', { name: 'New data module' }).click();
    const model = page.getByLabel('Model ident', { exact: true });
    if (i === 0) await model.fill('WIZ');                                   // an empty project asks for its model code once
    await page.getByLabel('Type', { exact: true }).selectOption(schema);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByTestId('dm-list').getByText('New, not saved to the project yet')).toBeVisible();

    // inside the Studio: the module is checked against ITS schema's rules and is valid
    const info = await page.evaluate(() => { const g = (window as any).studio.active.grammar; return { schema: g?.json?.schema, crew: g?.has('crewDrill') }; });
    expect(info.schema, `${label}: grammar`).toBe(schema);
    if (schema !== 'crew') expect(info.crew, `${label}: another type's tags are not allowed`).toBe(false);
    await page.evaluate(async () => { const s = (window as any).studio; await s.validate(s.active, { live: false, xsd: true, brex: false }); });
    await expect.poll(() => page.evaluate(() => { const a = (window as any).studio.active; return !a.validating && !a.pendingValidation && !!a.report?.xsd; }), { timeout: 30_000 }).toBe(true);
    const rep = await page.evaluate(() => { const r = (window as any).studio.active.report; return { ran: r.xsd?.ran, errors: r.issues.filter((x: any) => x.severity === 'error').map((x: any) => x.message) }; });
    expect(rep.ran, `${label}: XSD check ran`).toBe(true);
    expect(rep.errors, `${label}: no schema errors`).toEqual([]);

    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('dm-list').getByText('New, not saved to the project yet')).toHaveCount(0);
  }
  const list = (await (await api.get(`/api/projects/${wid}/dms`)).json()).dms as Array<{ file: string }>;
  expect(list.length).toBe(21);
  expect(list.every((d) => /^DMC-WIZ-/.test(d.file))).toBe(true);
  const r = await (await api.post(`/api/projects/${wid}/validation`, { data: { issue: 'auto', brex: false } })).json();
  expect(r.run.schemaChecked).toBe(21);
  expect(r.run.issues.filter((x: any) => /could not run/i.test(x.title))).toEqual([]);
  expect(r.run.issues.filter((x: any) => (x.source === 'xsd' || x.source === 'xml') && x.sev === 'error')).toEqual([]);
});
