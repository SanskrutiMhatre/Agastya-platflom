// WP-20 / G-UX-1 (RES-007, QA-012): the ten named routes in both themes have no serious or critical accessibility violation, and the rendered
// text of every route meets WCAG 1.4.3 in both themes (the runtime contrast sweep of 08 section 7.3). The checks are e2e/visual/a11y-audit.ts (an
// in-repository subset of axe's rules: axe-core is not available offline here). A violation fails unless e2e/visual/a11y-allowlist.json lists it
// with a reason, the work package that will fix it and an expiry date; an expired entry fails too, so a waiver cannot become permanent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { auditPage, type Violation } from './a11y-audit';
import { SCREENS } from './routes';
import { seed, settle, themeOf, windowFor, type Seed } from './seed';

const HERE = path.dirname(fileURLToPath(import.meta.url));
interface Waiver { rule: string; route: string; target: string; reason: string; wp: string; expires: string }
const ALLOW: Waiver[] = JSON.parse(fs.readFileSync(path.join(HERE, 'a11y-allowlist.json'), 'utf8')).waivers;
const BUDGET = new Set(['critical', 'serious']);
// WP-23 (UX-005): the structure rules are "moderate" in axe but are part of the budget here: every named route has exactly one main landmark and a
// level-one heading (they were the two moderate findings WP-20 reported and left to this package).
const ENFORCED = new Set(['landmark-one-main', 'landmark-no-duplicate-main', 'page-has-heading-one']);
const counts = (v: Violation) => BUDGET.has(v.impact) || ENFORCED.has(v.rule);

let s: Seed;
test.beforeAll(async ({ baseURL }) => { s = await seed(baseURL); });
test.afterAll(async () => { await s?.admin.dispose(); await s?.author.dispose(); });

test('the allow-list is well formed and nothing in it has expired', () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const w of ALLOW) {
    expect(w.reason?.length, `${w.rule} ${w.target}: a reason`).toBeGreaterThan(10);
    expect(w.wp, `${w.rule} ${w.target}: the package that fixes it`).toMatch(/^WP-\d+$/);
    expect(w.expires >= today, `${w.rule} ${w.target} expired on ${w.expires}`).toBe(true);
  }
});

const waived = (route: string, v: Violation): Waiver | undefined => ALLOW.find((w) => w.rule === v.rule && (w.route === '*' || w.route === route) && v.target.includes(w.target));

for (const screen of SCREENS.filter((x) => x.named)) {
  test(`${screen.name}: no serious or critical accessibility violation`, async ({ browser, baseURL }, info) => {
    const theme = themeOf(info);
    const who = screen.as === 'admin' ? s.admin : screen.as === 'author' ? s.author : null;
    const { ctx, page, errors } = await windowFor(browser, baseURL, who, theme);
    try {
      await page.goto(screen.url(s));
      await screen.ready(page);
      await settle(page, theme);
      const result = await page.evaluate(auditPage);
      const open = result.violations.filter((v) => counts(v) && !waived(screen.name, v));
      const report = { route: screen.name, theme, checked: result.checked, violations: result.violations, waived: result.violations.filter((v) => waived(screen.name, v)), incomplete: result.incomplete };
      await info.attach(`a11y-${screen.name}-${theme}.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
      fs.mkdirSync(info.outputPath(), { recursive: true });
      fs.writeFileSync(info.outputPath(`a11y-${screen.name}-${theme}.json`), JSON.stringify(report, null, 2));
      const moderate = result.violations.filter((v) => !counts(v));
      if (moderate.length) console.log(`[a11y] ${screen.name}/${theme}: ${moderate.length} moderate (reported, not budgeted): ${[...new Set(moderate.map((v) => v.rule))].join(', ')}`);
      if (result.incomplete.length) console.log(`[a11y] ${screen.name}/${theme}: ${result.incomplete.length} text node(s) not judged (images/gradients): see the attachment`);
      expect(result.checked['color-contrast'] ?? 0, 'the contrast sweep looked at some text').toBeGreaterThan(0);
      expect(open.map((v) => `${v.impact} ${v.rule} ${v.target}: ${v.detail}`), `${screen.name} in the ${theme} theme`).toEqual([]);
      expect(errors, 'no script error').toEqual([]);
    } finally { await ctx.close(); }
  });
}

// The check is not vacuous: a page with one planted defect per rule reports each of them, and a clean twin reports none.
test('the audit finds planted defects', async ({ page }) => {
  await page.setContent(`<!doctype html><html><head><title>t</title></head><body style="background:#ffffff;color:#111111">
    <main><h1>Planted</h1>
    <p id="low" style="color:#bbbbbb">low contrast text</p>
    <p id="ok" style="color:#333333">readable text</p>
    <button id="noname"></button>
    <button id="glyph" aria-label="Next page" style="min-width:24px;min-height:24px">›</button>
    <input id="nolabel">
    <img id="noalt" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10">
    <div role="buttn" id="badrole">x</div>
    <span aria-labelledby="missing-id" id="badref">y</span>
    <div style="display:flex"><button id="t1" style="width:16px;height:16px;padding:0">a</button><button id="t2" style="width:16px;height:16px;padding:0">b</button></div>
    <a href="#x" id="emptylink"></a>
    <button id="outer">o<a href="#y">inner</a></button>
    <div aria-hidden="true"><button id="hiddenfocus">h</button></div>
    </main></body></html>`);
  const r = await page.evaluate(auditPage);
  const rules = new Set(r.violations.map((v) => v.rule));
  for (const rule of ['html-has-lang', 'color-contrast', 'button-name', 'label', 'image-alt', 'aria-roles', 'aria-valid-attr-value', 'target-size', 'link-name', 'nested-interactive', 'aria-hidden-focus', 'icon-button-tooltip']) {
    expect(rules.has(rule), `${rule} is detected`).toBe(true);
  }
  expect(r.violations.filter((v) => v.rule === 'color-contrast').map((v) => v.target)).toEqual(['p#low']);
  expect(r.violations.filter((v) => v.rule === 'icon-button-tooltip').map((v) => v.target), 'a glyph button with a name but no tooltip (UID-003)').toContain('button#glyph');
  await page.setContent(`<!doctype html><html lang="en"><head><title>t</title></head><body style="background:#ffffff;color:#111111"><main><h1>Clean</h1>
    <label for="f">Name</label><input id="f"><button style="min-width:24px;min-height:24px">Go</button><button aria-label="Next page" title="Next page" style="min-width:24px;min-height:24px">›</button></main></body></html>`);
  expect((await page.evaluate(auditPage)).violations).toEqual([]);
});

// WP-23: the keyboard and structure rules fire on planted defects (a shell with a sidebar and no skip link, two main landmarks, no h1, a div
// button and a clickable row the keyboard cannot reach, a focusable divider without a value) and stay quiet on the corrected twin.
test('the audit finds planted keyboard and structure defects (WP-23)', async ({ page }) => {
  await page.setContent(`<!doctype html><html lang="en"><head><title>t</title><style>tr.clickable{cursor:pointer}</style></head><body style="background:#ffffff;color:#111111">
    <nav aria-label="Main"><a href="/a">A</a> <a href="/b">B</a></nav>
    <main><h2>No level one</h2>
      <div role="button" id="divbtn" style="display:inline-block;min-width:30px;min-height:30px">Go</div>
      <table><tbody><tr class="clickable" id="row"><td>Row without a target</td></tr></tbody></table>
      <div role="separator" tabindex="0" aria-label="Resize" id="sep" style="width:30px;height:30px"></div>
    </main>
    <main><p>second main</p></main></body></html>`);
  const r = await page.evaluate(auditPage);
  const rules = new Set(r.violations.map((v) => v.rule));
  for (const rule of ['skip-link', 'landmark-no-duplicate-main', 'page-has-heading-one', 'focusable-role', 'clickable-row', 'aria-required-attr']) expect(rules.has(rule), `${rule} is detected`).toBe(true);
  await page.setContent('<!doctype html><html lang="en"><head><title>t</title></head><body style="background:#ffffff;color:#111111"><nav aria-label="Main"><a href="/a">A</a></nav><p>no main</p></body></html>');
  expect((await page.evaluate(auditPage)).violations.map((v) => v.rule)).toEqual(expect.arrayContaining(['landmark-one-main', 'skip-link']));
  await page.setContent(`<!doctype html><html lang="en"><head><title>t</title><style>tr.clickable{cursor:pointer} a,button,[tabindex]{display:inline-block;min-width:24px;min-height:24px}</style></head><body style="background:#ffffff;color:#111111">
    <a href="#m">Skip to main content</a>
    <nav aria-label="Main"><a href="/a">A</a> <a href="/b">B</a></nav>
    <main id="m" tabindex="-1"><h1>Clean</h1>
      <div role="button" tabindex="0">Go</div>
      <table><tbody><tr class="clickable"><td><a href="/p">Project</a></td></tr></tbody></table>
      <div role="separator" tabindex="0" aria-label="Resize" aria-valuenow="50" style="width:30px;height:30px"></div>
    </main></body></html>`);
  expect((await page.evaluate(auditPage)).violations).toEqual([]);
});
