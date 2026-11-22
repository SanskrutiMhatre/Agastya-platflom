// All 21 wizard types x every wizard issue, in a real browser against the real server (the embedded Studio, the platform API).
// For each issue: a project with the 21 realistic modules (e2e/fixtures/dm21/<issue>/, made by src/studio/__tests__/verify/fixtures21.test.ts);
// then, opening the modules in a scrambled order (so every switch is a type switch), for EACH type:
//   1. the editor binds that type's own grammar + schema reference           (no cross-type contamination)
//   2. the Studio's XSD validation runs and finds nothing
//   3. the Insert-element dialog (Ctrl+E) lists only tags that exist in this type's schema, never another type's
//   4. a tag of another type cannot be inserted and leaves the document untouched
//   5. malformed XML typed into the XML view is flagged, and saving it is refused (the server copy stays intact)
//   6. a valid edit is saved with Ctrl+S, survives a page reload and re-open, and the server copy is valid
// Finally the server validates the whole project against the XSDs. Results are written to verification-results/e2e.json.

import { test, expect, request as pwRequest, type Page, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'dm21');
const PUBLIC = path.resolve(HERE, '..', 'public');
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';
const PW = 'Correct-Horse-9!';
const ISSUES = ['4-2', '5-0', '6', '7'];
const TYPES = ['descript', 'proced', 'fault', 'crew', 'ipd', 'brex', 'comrep', 'appliccrossreftable', 'condcrossreftable', 'prdcrossreftable', 'brdoc', 'checklist', 'container', 'frontmatter', 'learning', 'process', 'sb', 'schedul', 'scocontent', 'wrngdata', 'wrngflds'];
/** per type: text the module contains (to click / edit), or an attribute edit for modules with no text at all */
const ANCHOR: Record<string, { find: string; replace: string; text?: string }> = {
  descript: { find: 'Nested levelled paragraph.', replace: 'Nested levelled paragraph. QQQ', text: 'Nested levelled paragraph' },
  proced: { find: 'Remove the four screws.', replace: 'Remove the four screws. QQQ', text: 'Remove the four screws' },
  fault: { find: 'Measure the supply voltage.', replace: 'Measure the supply voltage. QQQ', text: 'Measure the supply voltage' },
  crew: { find: 'Complete the drills in order.', replace: 'Complete the drills in order. QQQ', text: 'Complete the drills in order' },
  ipd: { find: 'Unit assembly', replace: 'Unit assembly QQQ', text: 'Unit assembly' },
  brex: { find: 'Strikethrough emphasis must not be used.', replace: 'Strikethrough emphasis must not be used. QQQ', text: 'Strikethrough emphasis' },
  comrep: { find: 'Hot surface.', replace: 'Hot surface. QQQ', text: 'Hot surface' },
  appliccrossreftable: { find: 'Aircraft model variant', replace: 'Aircraft model variant QQQ', text: 'Aircraft model variant' },
  condcrossreftable: { find: 'Weather at the work site', replace: 'Weather at the work site QQQ', text: 'Weather at the work site' },
  prdcrossreftable: { find: 'applicPropertyValue="001"', replace: 'applicPropertyValue="099"' },
  brdoc: { find: 'Technical names are in sentence case.', replace: 'Technical names are in sentence case. QQQ', text: 'Technical names are in sentence case' },
  checklist: { find: 'Check the fuel quantity.', replace: 'Check the fuel quantity. QQQ', text: 'Check the fuel quantity' },
  container: { find: 'Referenced module 520', replace: 'Referenced module 520 QQQ', text: 'Referenced module 520' },
  frontmatter: { find: 'Maintenance Manual', replace: 'Maintenance Manual QQQ', text: 'Maintenance Manual' },
  learning: { find: 'This course covers the hydraulic system.', replace: 'This course covers the hydraulic system. QQQ', text: 'This course covers' },
  process: { find: 'Isolate the system.', replace: 'Isolate the system. QQQ', text: 'Isolate the system' },
  sb: { find: 'Replace the hydraulic pump seal.', replace: 'Replace the hydraulic pump seal. QQQ', text: 'Replace the hydraulic pump seal' },
  schedul: { find: 'General visual inspection.', replace: 'General visual inspection. QQQ', text: 'General visual inspection' },
  scocontent: { find: 'Read the description.', replace: 'Read the description. QQQ', text: 'Read the description' },
  wrngdata: { find: 'W0001', replace: 'W0001QQQ', text: 'W0001' },
  wrngflds: { find: 'Wire number', replace: 'Wire number QQQ', text: 'Wire number' },
};

const results: Record<string, Record<string, unknown>> = {};
let api: APIRequestContext;
let page: Page;
const pids: Record<string, string> = {};
const files: Record<string, Record<string, string>> = {};      // issue -> type -> file name

const grammarNames = (issue: string, type: string): Set<string> =>
  new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(PUBLIC, 'grammar', issue, type + '.json'), 'utf8')).elements));
function foreignFor(issue: string, type: string): string[] {
  const mine = grammarNames(issue, type);
  const out = new Set<string>();
  for (const t of TYPES) if (t !== type) for (const n of grammarNames(issue, t)) if (!n.includes(':') && !mine.has(n)) out.add(n);
  const all = [...out].sort();
  return [0, 1, 2, 3, 4].map((i) => all[Math.floor((i * (all.length - 1)) / 4)]);
}
/** a scrambled but fixed order, so consecutive modules are different types */
const scrambled = (): string[] => TYPES.map((_t, i) => TYPES[(i * 8) % 21]);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser, baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL });
  const setup = await (await admin.get('/api/auth/setup')).json();
  if (setup.setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Site Admin' } });
  else expect((await admin.post('/api/auth/login', { data: { username: 'admin', password: PW } })).ok()).toBeTruthy();
  const who = `verify${Date.now() % 100000}`;
  const made = await admin.post('/api/team/users', { data: { username: who, fullName: 'Verifier', role: 'author' } });
  expect(made.status()).toBe(201);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { throw new Error(`page error: ${e.message}`); });
  api = ctx.request;
  expect((await api.post('/api/auth/login', { data: { username: who, password: (await made.json()).tempPassword } })).ok()).toBeTruthy();
  expect((await api.post('/api/auth/onboarding', { data: { username: who, password: PW } })).ok()).toBeTruthy();
  for (const issue of ISSUES) {
    const p = await api.post('/api/projects', { data: { name: `Verify ${issue}`, pipeline: 's1000dtofo' } });
    expect(p.status()).toBe(201);
    pids[issue] = (await p.json()).project.id;
    const fd = { name: ICN, mimeType: 'image/svg+xml', buffer: fs.readFileSync(path.join(FIX, ICN)) };
    expect((await api.post(`/api/projects/${pids[issue]}/media`, { multipart: { file: fd, dir: 'csdb' } })).ok()).toBeTruthy();
    files[issue] = {};
    const manifest = JSON.parse(fs.readFileSync(path.join(FIX, issue, 'manifest.json'), 'utf8')) as Record<string, string>;
    TYPES.forEach((t) => { files[issue][t] = manifest[t]; });
  }
  await admin.dispose();
});
test.afterAll(async () => {
  fs.mkdirSync(path.resolve(HERE, '..', 'verification-results'), { recursive: true });
  fs.writeFileSync(path.resolve(HERE, '..', 'verification-results', 'e2e.json'), JSON.stringify(results, null, 1));
  await page.context().close();
});

async function studioReady() { await expect(page.getByTestId('studio-host')).toBeVisible(); }
const active = <T,>(fn: string): Promise<T> => page.evaluate(`(() => { const ed = window.studio.active; return (${fn})(ed); })()`) as Promise<T>;

for (const issue of ISSUES) {
  test.describe(`issue ${issue}`, () => {
    test(`import the 21 modules`, async () => {
      await page.goto(`/projects/${pids[issue]}/editor`);
      await studioReady();
      await page.locator('input[type=file][multiple]:not([data-testid])').setInputFiles([...TYPES.map((t) => path.join(FIX, issue, files[issue][t])), path.join(FIX, ICN)]);
      for (const t of TYPES) await expect(page.getByTestId('dm-list').locator(`[data-file="${files[issue][t]}"]`)).toBeVisible();
    });

    test(`each of the 21 types: own rules, XSD-valid, suggestions, refusals, malformed XML, edit + save + reopen`, async () => {
      test.setTimeout(900_000);
      const list = page.getByTestId('dm-list');
      for (const type of scrambled()) {
        const R = ((results[`${type}/${issue}`] ??= {}) as Record<string, unknown>);
        const file = files[issue][type];
        await list.locator(`[data-file="${file}"]`).click();
        await expect.poll(() => active<string | null>(`(ed) => ed && ed.doc.fileName`), { timeout: 20_000 }).toBe(file);

        // 1. its own rules
        const bound = await active<{ schema: string; issue: string; ref: string; refIssue: string }>(`(ed) => ({ schema: ed.grammar.json.schema, issue: ed.grammar.json.issue, ref: ed.doc.schemaRef.schema, refIssue: ed.doc.schemaRef.issue })`);
        expect(bound, `${type} ${issue}: grammar binding`).toEqual({ schema: type, issue, ref: type, refIssue: issue });
        R.ownRules = true;

        // 2. the Studio's XSD validation
        await page.evaluate(async () => { const s = (window as any).studio; await s.validate(s.active, { live: false, xsd: true, brex: false }); });
        await expect.poll(() => active<boolean>(`(ed) => !ed.validating && !ed.pendingValidation && !!ed.report && !!ed.report.xsd`), { timeout: 30_000 }).toBe(true);
        const rep = await active<{ ran: boolean; errors: string[] }>(`(ed) => ({ ran: ed.report.xsd.ran, errors: ed.report.issues.filter((i) => i.severity === 'error' && (i.source === 'xsd' || i.source === 'xml')).map((i) => i.source + ': ' + i.message) })`);
        expect(rep.ran, `${type} ${issue}: XSD check ran`).toBe(true);
        expect(rep.errors, `${type} ${issue}: schema errors in the Studio`).toEqual([]);
        R.studioXsd = 'valid';

        // 3. the Insert-element dialog at three different positions: a text block, the middle of the body, and the last element
        const mine = grammarNames(issue, type);
        const targets = ['text', 'middle', 'last'] as const;
        let dialogs = 0;
        for (const where of targets) {
          await active<void>(`(ed) => {
            const g = ed.grammar, content = ed.doc.xml.getElementsByTagName('content')[0];
            const all = Array.from(content.getElementsByTagName('*')).filter((e) => g.has(e.nodeName));
            const block = all.filter((e) => g.allowsText(e.nodeName) && Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim()));
            const pick = ${JSON.stringify(where)} === 'text' ? block[0] : ${JSON.stringify(where)} === 'middle' ? all[Math.floor(all.length / 2)] : all[all.length - 1];
            ed.selectElement(pick || all[0]);
          }`);
          const computed = await active<string[]>(`(ed) => { const r = ed.insertableElements(); return [...r.inline, ...r.block]; }`);
          await page.keyboard.press('Control+e');
          await expect(page.locator('.picker-input')).toBeVisible();
          const offered = (await page.locator('.picker-list .picker-label').allTextContents()).map((x) => x.trim());
          await page.keyboard.press('Escape');
          expect(offered.filter((n) => !mine.has(n)), `${type} ${issue} (${where}): the Insert dialog offered tags that are not in this type's schema`).toEqual([]);
          expect([...offered].sort(), `${type} ${issue} (${where}): the Insert dialog differs from the editor's own list`).toEqual([...computed].sort());
          dialogs++;
          R[`insertDialog_${where}`] = offered.length;
        }
        R.insertDialogPositions = dialogs;

        // 3b. undo and redo with the real shortcuts: insert something the dialog offers, undo it, redo it
        await active<void>(`(ed) => {
          const g = ed.grammar, content = ed.doc.xml.getElementsByTagName('content')[0];
          const all = Array.from(content.getElementsByTagName('*')).filter((e) => g.has(e.nodeName));
          for (const e of all) { ed.selectElement(e); const r = ed.insertableElements(); if ([...r.inline, ...r.block].some((n) => !g.allowsText(n) || true) && [...r.block].length) { window.__undoTarget = r.block[0]; return; } }
          window.__undoTarget = null;
        }`);
        const undoTarget = await page.evaluate(() => (window as any).__undoTarget as string | null);
        if (undoTarget) {
          const docBefore = await active<string>(`(ed) => ed.doc.toString()`);
          await active<void>(`(ed) => ed.insertElementNamed(${JSON.stringify(undoTarget)})`);
          const docAfter = await active<string>(`(ed) => ed.doc.toString()`);
          expect(docAfter, `${type} ${issue}: <${undoTarget}> was not inserted`).not.toBe(docBefore);
          await active<void>(`(ed) => ed.focus()`);
          await page.keyboard.press('Control+z');
          expect(await active<string>(`(ed) => ed.doc.toString()`), `${type} ${issue}: undo did not restore the module`).toBe(docBefore);
          await page.keyboard.press('Control+y');
          expect(await active<string>(`(ed) => ed.doc.toString()`), `${type} ${issue}: redo did not reapply the insertion`).toBe(docAfter);
          await page.keyboard.press('Control+z');
          expect(await active<string>(`(ed) => ed.doc.toString()`)).toBe(docBefore);
          R.undoRedo = `<${undoTarget}>: undo and redo exact`;
        } else R.undoRedo = 'n/a: nothing insertable in this module';

        // 4. another type's tag cannot be inserted
        const before = await active<string>(`(ed) => ed.doc.toString()`);
        for (const F of foreignFor(issue, type)) {
          expect(await active<boolean>(`(ed) => ed.canInsert(${JSON.stringify(F)})`), `${type} ${issue}: <${F}> must not be insertable`).toBe(false);
          await active<void>(`(ed) => ed.insertElementNamed(${JSON.stringify(F)})`);
        }
        expect(await active<string>(`(ed) => ed.doc.toString()`), `${type} ${issue}: a foreign tag changed the document`).toBe(before);
        R.foreignRefused = 5;

        // 4b. a paste event in the design view (the way an author pastes) can never corrupt the document
        const pasted = await page.evaluate(() => {
          const ed = (window as any).studio.active, g = ed.grammar;
          const content = ed.doc.xml.getElementsByTagName('content')[0];
          const t = Array.from(content.getElementsByTagName('*')).find((e: any) => g.has(e.nodeName) && g.allowsText(e.nodeName) && Array.from(e.childNodes).some((n: any) => n.nodeType === 3 && (n.textContent || '').trim())) as Element;
          if (!t) return null;                       // a module with no text at all (the product cross-reference table) has nothing to paste into
          const out: Record<string, number | boolean> = {};
          for (const [name, text, html] of [['malformedXml', '<para>unclosed <b>', '<p>x<b>unclosed</p>'], ['ampersand', 'a < b & c > d', null]] as const) {
            const el = ed.doc.xml.getElementsByTagName('*').length;
            ed.selectElement(t); ed.clearElementSelection?.();
            ed.doc.selection = { anchor: { node: t, offset: 0 }, focus: { node: t, offset: 0 } };
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            if (html) dt.setData('text/html', html);
            ed.design.page.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            const wellFormed = new DOMParser().parseFromString(ed.doc.toString(), 'application/xml').getElementsByTagName('parsererror').length === 0;
            out[name + 'WellFormed'] = wellFormed;
            out[name + 'ElementsAdded'] = ed.doc.xml.getElementsByTagName('*').length - el;
            ed.doc.undo();
          }
          return out;
        });
        if (pasted) {
          expect(pasted.malformedXmlWellFormed && pasted.ampersandWellFormed, `${type} ${issue}: a paste left the document not well-formed`).toBe(true);
          R.designPaste = 'well-formed';
        } else R.designPaste = 'n/a: no text in this module';

        // 4c. invalid structure and attributes typed into the XML view are flagged by the Studio's XSD validation
        await page.locator('.vs-btn', { hasText: 'XML' }).click();
        const invalid = await page.evaluate(async () => {
          const s = (window as any).studio, ed = s.active, v = ed.xml.view;
          const original = v.state.doc.toString();
          const swap = (t: string) => { const a = /<language [^>]*\/>/.exec(t), b = /<issueInfo [^>]*\/>/.exec(t); return a && b && a.index < b.index ? t.slice(0, a.index) + b[0] + t.slice(a.index + a[0].length, b.index) + a[0] + t.slice(b.index + b[0].length) : t; };
          const cases: Record<string, string> = {
            'invalid attribute value': original.replace('securityClassification="01"', 'securityClassification="ZZ"'),
            'unknown attribute': original.replace('<security ', '<security zzBad="1" '),
            'missing required attribute': original.replace(/ infoCode="[^"]*"/, ''),
            'foreign element in the body': original.replace('<content>', '<content><zzNope/>'),
            'wrong order': swap(original),
          };
          const found: Record<string, number> = {};
          let problemsShown = 0;
          for (const [name, text] of Object.entries(cases)) {
            if (text === original) { found[name] = -1; continue; }
            v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
            if (!ed.xml.flush()) { found[name] = -2; continue; }
            await s.validate(ed, { live: false, xsd: true, brex: false });
            for (let i = 0; i < 200 && (ed.validating || ed.pendingValidation); i++) await new Promise((r) => setTimeout(r, 50));
            found[name] = ed.report.issues.filter((i: any) => i.severity === 'error').length;
            problemsShown += document.querySelectorAll('.problems-list .problem-msg').length > 0 ? 1 : 0;
            // flush() commits the typed text into the model, so put the ORIGINAL text back (revert() would keep the mutation)
            v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: original } });
            ed.xml.flush();
          }
          found['problemsPane'] = problemsShown === Object.keys(cases).length ? 1 : 0;
          found['restored'] = v.state.doc.toString() === original && ed.doc.toString().length > 0 ? 1 : 0;
          return found;
        });
        expect(invalid.problemsPane, `${type} ${issue}: the Problems pane did not list the schema errors`).toBe(1);
        expect(invalid.restored, `${type} ${issue}: the module was not restored after the invalid edits`).toBe(1);
        for (const [name, count] of Object.entries(invalid)) if (name !== 'restored' && name !== 'problemsPane') expect(count, `${type} ${issue}: "${name}" was not flagged by the Studio's XSD validation (${count})`).toBeGreaterThan(0);
        await active<void>(`(ed) => ed.setMode('design')`);
        R.invalidEdits = 5;

        // 5. malformed XML in the XML view is flagged; saving it is refused; the server copy stays intact
        const serverBefore = (await (await api.get(`/api/projects/${pids[issue]}/dms/${file}`)).json()).xml as string;
        await page.locator('.vs-btn', { hasText: 'XML' }).click();
        await page.evaluate(() => {
          const v = (window as any).studio.active.xml.view;
          v.dispatch({ changes: { from: v.state.doc.length - 12, to: v.state.doc.length - 12, insert: '<zzBroken><b></zzBroken>' } });
        });
        await expect.poll(() => active<boolean>(`(ed) => !ed.xml.flush()`), { timeout: 10_000 }).toBe(true);
        await page.keyboard.press('Control+s');
        await expect(page.getByText('XML is not well-formed').first()).toBeVisible();
        // 5a. "Save anyway" is offered by the editor, but the SERVER refuses malformed XML and keeps the old copy
        await page.getByRole('button', { name: 'Save anyway' }).click();
        await expect(page.locator('.toast, .v2-toast').filter({ hasText: /not well-formed|not saved|refus/i }).first(), `${type} ${issue}: no refusal shown after "Save anyway"`).toBeVisible({ timeout: 10_000 });
        const afterAnyway = await api.get(`/api/projects/${pids[issue]}/dms/${file}`);
        expect(afterAnyway.status(), `${type} ${issue}: reading the module after "Save anyway" returned ${afterAnyway.status()} ${(await afterAnyway.text()).slice(0, 200)}`).toBe(200);
        expect((await afterAnyway.json()).xml, `${type} ${issue}: the server stored malformed XML`).toBe(serverBefore);
        await page.keyboard.press('Control+s');
        await expect(page.getByText('XML is not well-formed').first()).toBeVisible();
        await page.getByRole('button', { name: 'Cancel' }).click();
        const serverAfter = (await (await api.get(`/api/projects/${pids[issue]}/dms/${file}`)).json()).xml as string;
        expect(serverAfter, `${type} ${issue}: the server copy changed after a refused save`).toBe(serverBefore);
        await active<void>(`(ed) => { ed.xml.revert(); ed.setMode('design'); }`);
        R.malformedXml = 'flagged, save refused';

        // 6. a valid edit: save, reload, reopen, persisted and valid on the server
        const a = ANCHOR[type];
        await page.locator('.vs-btn', { hasText: 'XML' }).click();
        const found = await page.evaluate((x) => {
          const v = (window as any).studio.active.xml.view;
          const i = v.state.doc.toString().indexOf(x.find);
          if (i < 0) return false;
          v.dispatch({ changes: { from: i, to: i + x.find.length, insert: x.replace } });
          return true;
        }, a);
        expect(found, `${type} ${issue}: anchor "${a.find}" not found in the XML`).toBe(true);
        await page.keyboard.press('Control+s');
        await expect(page.locator('.toast', { hasText: 'Saved' }).first()).toBeVisible();
        const saved = (await (await api.get(`/api/projects/${pids[issue]}/dms/${file}`)).json()).xml as string;
        expect(saved).toContain(a.replace);
        R.saved = true;
        await active<void>(`(ed) => ed.setMode('design')`);
      }
    });

    test(`reload: every edit persisted, every module reopens with its own rules, and the server finds the project schema-valid`, async () => {
      test.setTimeout(600_000);
      await page.reload();
      await studioReady();
      const list = page.getByTestId('dm-list');
      for (const type of scrambled()) {
        const file = files[issue][type];
        await list.locator(`[data-file="${file}"]`).click();
        await expect.poll(() => active<string | null>(`(ed) => ed && ed.doc.fileName`), { timeout: 20_000 }).toBe(file);
        const bound = await active<{ schema: string; issue: string }>(`(ed) => ({ schema: ed.grammar.json.schema, issue: ed.grammar.json.issue })`);
        expect(bound).toEqual({ schema: type, issue });
        const a = ANCHOR[type];
        expect(await active<boolean>(`(ed) => ed.doc.toString().includes(${JSON.stringify(a.replace)})`), `${type} ${issue}: the saved edit is not in the reopened module`).toBe(true);
        (results[`${type}/${issue}`] ??= {}).reopened = true;
      }
      const r = await (await api.post(`/api/projects/${pids[issue]}/validation`, { data: { issue: 'auto', brex: false } })).json();
      expect(r.run.schemaChecked).toBe(21);
      expect(r.run.issues.filter((x: any) => /could not run/i.test(x.title))).toEqual([]);
      const bad = r.run.issues.filter((x: any) => (x.source === 'xsd' || x.source === 'xml') && x.sev === 'error');
      expect(bad.map((x: any) => `${x.file}: ${x.title}`), `server schema errors in ${issue}`).toEqual([]);
      for (const type of TYPES) (results[`${type}/${issue}`] ??= {}).serverXsd = 'valid';
    });
  });
}
