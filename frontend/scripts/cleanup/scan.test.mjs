// WP-36: tests of the dead-code and removal-completeness scan (scripts/cleanup/scan.mjs), on a small fixture tree.
//   node --test scripts/cleanup/scan.test.mjs        (the gate's `cleanup` stage runs it)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { applyAllowList, cssClasses, scanDeadCode, scanRemovalDebris } from './scan.mjs';

const roots = [];
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp36-scan-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  return { root, frontend: path.join(root, 'frontend') };
}
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const BASE = {
  'frontend/package.json': JSON.stringify({ dependencies: { react: '1', '@scope/lib': '1', 'unused-meta': '1' }, devDependencies: { typescript: '1' } }),
  'frontend/src/main.tsx': "import { createElement } from 'react';\nimport { x } from '@scope/lib/sub';\nimport { used } from './lib/a';\nimport './styles/app.css';\nconst Lazy = () => import('./pages/Lazy');\nused(); void Lazy; void createElement; void x;\n",
  'frontend/src/lib/a.ts': [
    'export function used(): void { own(); }',
    'export function ownOnly(): number { return 1; }',
    'export const own = (): number => ownOnly();',
    'export function deadOne(): void {}',
    '// mentioned only in a comment: deadInComment',
    'export function deadInComment(): void {}',
    'export function inTestString(): void {}',
    'export function inTest(): void {}',
  ].join('\n'),
  'frontend/src/lib/a.test.ts': "import { inTest } from './a';\ninTest();\n",
  'frontend/src/pages/Lazy.tsx': [
    "export default function Lazy() { const kind = 'warn'; return <div className={`card sev-${kind}`}><span className=\"badge on\">x</span></div>; }",
    '// <div className="commentedOut">',
  ].join('\n'),
  'frontend/src/orphan.ts': 'export const nothing = 1;\n',
  'frontend/src/onlyForTests.ts': 'export const helper = 1;\n',
  'frontend/src/onlyForTests.test.ts': "import { helper } from './onlyForTests';\nvoid helper;\n",
  'frontend/src/ambient.d.ts': "declare module 'some-lib' { const x: number; export default x; }\n",
  'frontend/src/styles/app.css': [
    '/* .inComment { } */',
    '.card { background: url(img/a.png); margin: 0.5em; }',
    '.badge:hover, .badge.on { color: red; }',
    '.sev-error, .sev-info { color: red; }',
    '@media (max-width: 900px) { .narrowOnly { display: none; } }',
    '@keyframes spin { from { opacity: 0; } to { opacity: 1; } }',
    '.deadClass { color: blue; }',
    '.onlyInTest { color: blue; }',
    '.commentedOut { color: blue; }',
    '.serverBuilt { color: blue; }',
  ].join('\n'),
  'frontend/e2e/a.spec.ts': "test('x', async () => { await page.evaluate('window.lib.inTestString()'); await page.locator('.onlyInTest').click(); await page.locator('.narrowOnly'); });\n",
  'backend/src/html.ts': "export const page = '<div class=\"serverBuilt\">';\n",
};

describe('dead-code scan', () => {
  const { root, frontend } = fixture(BASE);
  const s = scanDeadCode({ frontend, root });

  test('a file nothing imports is reported; static, dynamic and CSS imports count; test-only files and ambient declarations are kept', () => {
    assert.deepEqual(s.files, ['src/orphan.ts']);
    assert.deepEqual(s.filesTestOnly, ['src/onlyForTests.ts']);
    assert.deepEqual(s.filesAmbient, ['src/ambient.d.ts']);
  });

  test('an export is dead only when no other file names it and its own file uses it no further; comments are not references', () => {
    const names = s.exports.map((e) => e.name).sort();
    assert.deepEqual(names, ['deadInComment', 'deadOne', 'nothing']);
    assert.ok(!names.includes('ownOnly'), 'used inside its own file');
    assert.ok(!names.includes('inTestString'), 'named in a string of a browser test (window.lib.<name>)');
    assert.ok(!names.includes('inTest'), 'used by a unit test');
  });

  test('CSS: selectors only (not url() or 0.5em), generated prefixes kept, test and comment mentions are not uses, server-built HTML is', () => {
    const dead = s.classes.map((c) => c.name).sort();
    assert.deepEqual(dead, ['commentedOut', 'deadClass', 'narrowOnly', 'onlyInTest']);
    assert.deepEqual(s.classesGenerated.map((c) => c.name).sort(), ['sev-error', 'sev-info']);
    assert.ok(!dead.includes('png') && !dead.includes('5em') && !dead.includes('inComment'));
    assert.ok(!dead.includes('serverBuilt'));
  });

  test('a runtime dependency nothing imports is reported (scoped and deep imports count; devDependencies are not checked)', () => {
    assert.deepEqual(s.deps, ['unused-meta']);
  });

  test('cssClasses keeps the line numbers across comments and ignores @keyframes steps', () => {
    const m = cssClasses('/* a\n b */\n.one { }\n@keyframes k { from { x: 1 } }\n.two:hover { }');
    assert.deepEqual([...m.entries()], [['one', 3], ['two', 5]]);
  });
});

describe('allow-list', () => {
  const scan = { files: ['src/orphan.ts'], exports: [{ file: 'src/a.ts', name: 'x' }], classes: [{ name: 'cm-content' }, { name: 'deadClass' }] };
  test('entries need a reason; patterns and names match; stale entries are listed', () => {
    const r = applyAllowList(scan, {
      files: [{ file: 'src/orphan.ts', reason: 'loaded by a plugin by its path' }],
      exports: [{ file: 'src/a.ts', name: 'x', reason: 'short' }],
      classes: [{ pattern: '^cm-', reason: 'CodeMirror builds these itself' }, { name: 'gone', reason: 'was used by a removed screen' }],
    });
    assert.deepEqual(r.files, []);
    assert.deepEqual(r.exports, []);                                   // matched, but the reason is too short: a problem
    assert.equal(r.problems.length, 1);
    assert.deepEqual(r.classes.map((c) => c.name), ['deadClass']);
    assert.deepEqual(r.stale, ['class gone']);
  });
});

describe('removal completeness', () => {
  const FEATURE = {
    feature: 'Brand pack screen',
    files: ['src/pages/BrandPack.tsx'],
    identifiers: ['brandApi'],
    strings: ['brand-packs'],
    exactStrings: ['doc-codes'],
    classPrefixes: ['v2-brandprev'],
    railLabels: ['Brand'],
    codePatterns: ['show\\??\\.pmc\\b'],
    keptRoutes: ['/api/brand-packs'],
    allow: [{ file: 'src/App.tsx', text: 'brand-packs', reason: 'redirect' }],
  };
  test('a clean tree has no debris; a test file may still name the removed feature', () => {
    const { root, frontend } = fixture({
      'frontend/src/App.tsx': "export const r = 'brand-packs'; // brandApi in a comment is fine\nexport const t = 'doc-codes-pmc';\n",
      'frontend/src/a.test.ts': "const brandApi = 1; expect('.v2-brandprev').toHaveCount(brandApi - 1);\n",
      'frontend/src/layouts/projectRail.ts': "export const items = ['Editor', 'Brand new'];\n",
      'docs/API-ONLY-ROUTES.md': '| Brand packs | `GET /api/brand-packs` |\n',
    });
    assert.deepEqual(scanRemovalDebris([FEATURE], { frontend, root }), []);
  });
  test('each kind of debris is reported', () => {
    const { root, frontend } = fixture({
      'frontend/src/pages/BrandPack.tsx': 'export {};\n',
      'frontend/src/api/x.ts': "export const brandApi = { list: () => fetch('/api/brand-packs') };\nexport const id = 'doc-codes';\nexport const on = (c: { show?: { pmc: boolean } }) => c.show?.pmc;\n",
      'frontend/src/styles/a.css': '.v2-brandprev img { max-height: 48px; }\n',
      'frontend/src/layouts/projectRail.ts': "export const items = ['Editor', 'Brand'];\n",
      'docs/API-ONLY-ROUTES.md': 'nothing listed\n',
    });
    const d = scanRemovalDebris([FEATURE], { frontend, root });
    const has = (s) => assert.ok(d.some((x) => x.includes(s)), `expected debris "${s}" in ${JSON.stringify(d)}`);
    has('the file src/pages/BrandPack.tsx is back');
    has('identifier `brandApi` in src/api/x.ts');
    has('the string "brand-packs" in src/api/x.ts');
    has('the string "doc-codes" in src/api/x.ts');
    has('CSS class .v2-brandprev in src/styles/a.css');
    has('rail item "Brand"');
    has('code matching /show\\??\\.pmc\\b/ in src/api/x.ts');
    has('`/api/brand-packs` is not listed in docs/API-ONLY-ROUTES.md');
    assert.equal(d.length, 8);
  });
});

describe('the real front end', () => {
  test('the scan sees the library classes it must keep (non-vacuity) and the owner-removed features left no debris', () => {
    const s = scanDeadCode();
    assert.ok(s.counts.sourceFiles > 150);
    assert.ok(s.classes.some((c) => c.name.startsWith('cm-')), 'CodeMirror classes are reported (and allow-listed by pattern)');
    assert.ok(s.classesGenerated.some((c) => c.prefix === 'x-'), 'the Studio renderer builds x-<element> classes');
    const features = JSON.parse(fs.readFileSync(new URL('./removed-features.json', import.meta.url), 'utf8')).features;
    assert.ok(features.length >= 6);
    assert.deepEqual(scanRemovalDebris(features), []);
  });
});
