// The REAL New data module wizard, for every one of the 84 type x issue combinations (browser + backend running):
//   - all 21 type cards exist (no more, no fewer) and the issue list is exactly 4.2 / 5.0 / 6 / 7
//   - choosing a type and an issue pre-fills that type's default information code and writes THAT type's schema (not another's)
//   - the generated module has the right root element, schema reference, identification and info code, and opens in the right editor
//   - it is XSD-valid in the Studio, saves, and the server accepts it and finds it schema-valid
//   - an existing type is never switched to another by selecting a different card or issue in the same wizard session

import { test, expect, request as pwRequest, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PW = 'Correct-Horse-9!';
const ISSUES = ['4-2', '5-0', '6', '7'];
const ISSUE_LABEL: Record<string, string> = { '4-2': '4.2', '5-0': '5.0', '6': '6', '7': '7' };
/** wizard card label (the prefix of its accessible name), schema, default info code, root element the template writes */
const TYPES: Array<[string, string, string, string]> = [
  ['Descriptive', 'descript', '040', 'description'], ['Procedural', 'proced', '520', 'procedure'], ['Fault isolation', 'fault', '421', 'faultIsolation'],
  ['Crew/Operator', 'crew', '131', 'crew'], ['Illustrated parts data', 'ipd', '941', 'illustratedPartsCatalog'], ['Business rules exchange', 'brex', '022', 'brex'],
  ['Common information repository', 'comrep', '00L', 'commonRepository'], ['Applicability cross-reference table', 'appliccrossreftable', '00W', 'applicCrossRefTable'],
  ['Conditions cross-reference table', 'condcrossreftable', '00Q', 'condCrossRefTable'], ['Product cross-reference table', 'prdcrossreftable', '00P', 'productCrossRefTable'],
  ['Business rules document', 'brdoc', '024', 'brDoc'], ['Checklist', 'checklist', '135', 'checkList'], ['Container', 'container', '914', 'container'],
  ['Front matter', 'frontmatter', '001', 'frontMatter'], ['Learning', 'learning', '952', 'learning'], ['Process', 'process', '951', 'process'],
  ['Service bulletin', 'sb', '930', 'sb'], ['Maintenance schedule', 'schedul', '000', 'maintPlanning'], ['SCO content', 'scocontent', '000', 'scoContent'],
  ['Wiring data', 'wrngdata', '000', 'wiringData'], ['Wiring fields', 'wrngflds', '029', 'wiringFields'],
];
const results: Record<string, Record<string, unknown>> = {};
let page: Page;
let api: APIRequestContext;
const pids: Record<string, string> = {};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const who = `wiz${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username: who, fullName: 'Wizard Tester', role: 'author' } });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  api = ctx.request;
  expect((await api.post('/api/auth/login', { data: { username: who, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username: who, password: PW } })).ok()).toBeTruthy();
  for (const issue of ISSUES) {
    const p = await api.post('/api/projects', { data: { name: `Wizard ${issue}`, pipeline: 's1000dtofo' } });
    pids[issue] = (await p.json()).project.id;
  }
  await admin.dispose();
});
test.afterAll(async () => {
  fs.mkdirSync(path.resolve(HERE, '..', 'verification-results'), { recursive: true });
  fs.writeFileSync(path.resolve(HERE, '..', 'verification-results', 'wizard.json'), JSON.stringify(results, null, 1));
  await page.context().close();
});

const active = <T,>(fn: string): Promise<T> => page.evaluate(`(() => { const ed = window.studio.active; return (${fn})(ed); })()`) as Promise<T>;
const scrambled = (): typeof TYPES => TYPES.map((_t, i) => TYPES[(i * 8) % 21]);

for (const issue of ISSUES) {
  test(`wizard, issue ${issue}: all 21 types are offered, each creates its own schema, root, info code and editor`, async () => {
    test.setTimeout(600_000);
    await page.goto(`/projects/${pids[issue]}/editor`);
    await expect(page.getByTestId('studio-host')).toBeVisible();
    const panel = page.getByRole('complementary', { name: 'Data modules' });
    let first = true;
    let placeholdersMade = 0;                       // the four types that share the placeholder info code 000 take assembly 00, 01, 02, 03 in turn
    for (const [label, schema, infoCode, root] of scrambled()) {
      const R = ((results[`${schema}/${issue}`] ??= {}) as Record<string, unknown>);
      await panel.getByRole('button', { name: 'New data module' }).click();
      // the wizard lists exactly the 21 types and exactly the four issues
      const typeSel = page.getByLabel('Type', { exact: true });
      await expect(typeSel.locator('option')).toHaveCount(21);
      const issueSel = page.locator('select', { has: page.locator('option', { hasText: 'S1000D Issue 5.0' }) }).first();
      expect(await issueSel.locator('option').allTextContents()).toEqual(['S1000D Issue 4.2', 'S1000D Issue 5.0', 'S1000D Issue 6', 'S1000D Issue 7']);
      await issueSel.selectOption(issue);
      await typeSel.selectOption(schema);
      // exactly one card is selected, and it is this one (selecting a type never leaves another selected)
      expect(await typeSel.inputValue()).toBe(schema);
      expect(await page.locator('.newdm .field-hint').first().innerText()).toContain(`${schema}.xsd`);
      // the default information code of this type is pre-filled, and the issue is the chosen one
      const model = page.getByLabel('Model ident', { exact: true });
      if (first) await model.fill('WIZ');                        // an empty project asks for its model code once
      expect(await page.getByLabel('Info code', { exact: true }).inputValue(), `${schema}: default info code`).toBe(infoCode);
      expect(await issueSel.inputValue()).toBe(issue);
      // the assembly code belongs to THIS type: 00 unless another type already holds this identity (never left over from the previous type)
      const wantAssy = String(infoCode === '000' ? placeholdersMade++ : 0).padStart(2, '0');
      expect(await page.getByLabel('Assy', { exact: true }).inputValue(), `${schema} ${issue}: assembly code`).toBe(wantAssy);
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      first = false;
      await expect(page.getByTestId('dm-list').getByText('New, not saved to the project yet')).toBeVisible();

      // the editor that opened belongs to this type and issue
      const doc = await active<{ schema: string; issue: string; ref: string; refIssue: string; root: string; body: string; url: string; info: string; xml: string }>(`(ed) => {
        const d = ed.doc.xml.documentElement, c = ed.doc.xml.getElementsByTagName('content')[0];
        return { schema: ed.grammar.json.schema, issue: ed.grammar.json.issue, ref: ed.doc.schemaRef.schema, refIssue: ed.doc.schemaRef.issue, root: d.nodeName,
                 body: c.children[0].nodeName, url: d.getAttribute('xsi:noNamespaceSchemaLocation'), info: ed.doc.xml.getElementsByTagName('dmCode')[0].getAttribute('infoCode'), xml: ed.doc.toString() };
      }`);
      expect(doc.schema, `${schema} ${issue}: editor grammar`).toBe(schema);
      expect(doc.issue).toBe(issue);
      expect(doc.ref).toBe(schema);
      expect(doc.refIssue).toBe(issue);
      expect(doc.root).toBe('dmodule');
      expect(doc.body, `${schema} ${issue}: root element of the content`).toBe(root);
      expect(doc.url).toBe(`http://www.s1000d.org/S1000D_${issue}/xml_schema_flat/${schema}.xsd`);
      expect(doc.info, `${schema}: info code in the generated module`).toBe(infoCode);
      R.wizardOffered = true; R.wizardSchema = schema; R.wizardRoot = root; R.wizardInfoCode = infoCode;

      // valid in the Studio, then saved
      await page.evaluate(async () => { const s = (window as any).studio; await s.validate(s.active, { live: false, xsd: true, brex: false }); });
      await expect.poll(() => active<boolean>(`(ed) => !ed.validating && !ed.pendingValidation && !!ed.report && !!ed.report.xsd`), { timeout: 30_000 }).toBe(true);
      const rep = await active<{ ran: boolean; errors: string[] }>(`(ed) => ({ ran: ed.report.xsd.ran, errors: ed.report.issues.filter((i) => i.severity === 'error' && (i.source === 'xsd' || i.source === 'xml')).map((i) => i.message) })`);
      expect(rep.ran).toBe(true);
      expect(rep.errors, `${schema} ${issue}: the new module is not schema-valid`).toEqual([]);
      await page.keyboard.press('Control+s');
      await expect(page.getByTestId('dm-list').getByText('New, not saved to the project yet')).toHaveCount(0);
      R.wizardValid = true; R.wizardSaved = true;
    }
    // the server accepted all 21 and finds them schema-valid; every file was named by its own DMC
    const list = (await (await api.get(`/api/projects/${pids[issue]}/dms`)).json()).dms as Array<{ file: string; infoCode?: string }>;
    expect(list.length).toBe(21);
    const r = await (await api.post(`/api/projects/${pids[issue]}/validation`, { data: { issue: 'auto', brex: false } })).json();
    expect(r.run.schemaChecked).toBe(21);
    expect(r.run.issues.filter((x: any) => /could not run|Not checked/i.test(x.title))).toEqual([]);
    expect(r.run.issues.filter((x: any) => (x.source === 'xsd' || x.source === 'xml') && x.sev === 'error').map((x: any) => `${x.file}: ${x.title}`)).toEqual([]);
    for (const [, schema] of TYPES) (results[`${schema}/${issue}`] ??= {}).wizardServerValid = true;
  });
}
