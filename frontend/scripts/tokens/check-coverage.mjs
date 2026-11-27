// Token coverage (audit WP-20, 08 section 7.2 and the violation checklist of 7.6): what check-contrast.mjs does not already cover.
//   1. pair completeness (7.6 #17): every colour token the code uses as a text colour is the foreground of at least one contrast pair in
//      tokens.json, and every colour token used as a background is the background of one; otherwise its contrast is never checked;
//   2. one theme mechanism (7.6 #10): `prefers-color-scheme`, `data-theme` and `dataset.theme` appear only in the files that own the theme;
//   3. no direct primitive in components: `var(--p-*)` outside the token files bypasses the light/dark pairing (a primitive has one value);
//   4. unused semantic and fixed tokens are listed (a warning: a token may be kept for the redesign).
// (check-contrast.mjs already fails on an undefined var(--x); build-tokens.mjs on a semantic token without a dark value.)
//   node scripts/tokens/check-coverage.mjs [--verbose]
// Environment: COVERAGE_SRC (default src/) so a test can point it at a planted tree.
import fs from 'node:fs';
import path from 'node:path';
import { FRONTEND, readSource } from './lib.mjs';

const verbose = process.argv.includes('--verbose');
const s = readSource();
const SRC = process.env.COVERAGE_SRC || path.join(FRONTEND, 'src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(SRC).filter((f) => /\.(css|ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && !/[\\/]tokens[\\/]/.test(f));
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');

const colourTokens = new Set([...Object.keys(s.semantic), ...Object.keys(s.fixed).filter((k) => !/^shadow/.test(k))]);
// alias -> the colour token it names (aliases may chain through other aliases)
const target = (name, depth = 0) => {
  if (colourTokens.has(name)) return name;
  if (depth < 10 && name in s.alias) return target(s.alias[name], depth + 1);
  return null;
};
const fgPaired = new Set(s.pairs.map((p) => p[0]));
const bgPaired = new Set(s.pairs.map((p) => p[1]));
const EXEMPT = JSON.parse(fs.readFileSync(process.env.COVERAGE_EXEMPT || path.join(FRONTEND, 'scripts', 'tokens', 'coverage-exempt.json'), 'utf8'));
const problems = [];

// ------------------------------------------------------------------ 1. pair completeness
const usedAs = { fg: new Map(), bg: new Map() };
const anyUse = new Set();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/var\(\s*--([\w-]+)/g)) { const t = target(m[1]); if (t) anyUse.add(t); }
  // declarations in CSS and in CSS-in-TS strings: `color: var(--x)`, `background(-color): var(--x)`; also React style objects { color: 'var(--x)' }
  for (const m of text.matchAll(/(?<![-\w])(color|background-color|background|backgroundColor)\s*:\s*['"`]?\s*var\(\s*--([\w-]+)/g)) {
    const t = target(m[2]); if (!t) continue;
    const kind = m[1] === 'color' ? 'fg' : 'bg';
    if (!usedAs[kind].has(t)) usedAs[kind].set(t, rel(f));
  }
}
const unpairedFg = [...usedAs.fg].filter(([t]) => !fgPaired.has(t));
const unpairedBg = [...usedAs.bg].filter(([t]) => !bgPaired.has(t) && !(t in EXEMPT.backgrounds));
// a stale exemption fails too (ratchet): the token is now paired, or no longer used as a background
for (const t of Object.keys(EXEMPT.backgrounds)) if (bgPaired.has(t) || !usedAs.bg.has(t)) problems.push(`coverage-exempt.json backgrounds.${t} is no longer needed: remove it`);
for (const [t, f] of unpairedFg) problems.push(`--${t} is used as a text colour (first in ${f}) but is the foreground of no pair in tokens.json`);
for (const [t, f] of unpairedBg) problems.push(`--${t} is used as a background (first in ${f}) but is the background of no pair in tokens.json`);
console.log(`pairs: ${usedAs.fg.size} text colours and ${usedAs.bg.size} backgrounds in use, ${unpairedFg.length + unpairedBg.length} without a contrast pair`);

// ------------------------------------------------------------------ 2. one theme mechanism
// The owners: the store (applyTheme), the pre-paint script (public/, not scanned), the administrator default cache, the toggle that reads the
// current theme, and the two editors' live theme hooks that read (never set) the attribute.
const THEME_OWNERS = ['store/ui.ts', 'store/appSettings.ts', 'components/ThemeToggle.tsx', ...Object.keys(EXEMPT.themeMechanism)];
const READ_ONLY = /dataset\.theme\s*===|getAttribute\(\s*['"]data-theme['"]\s*\)|\[data-theme=|attributeFilter:\s*\[\s*['"]data-theme['"]\s*\]|data-theme-preview/;
const mech = [];
for (const f of files) {
  const r = rel(f); if (THEME_OWNERS.includes(r)) continue;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    if (/prefers-color-scheme/.test(line) && !/matchMedia\(\s*['"]\(prefers-color-scheme: dark\)['"]\s*\)\.matches/.test(line)) mech.push(`${r}:${i + 1}: prefers-color-scheme (the theme follows html[data-theme], set by store/ui.ts)`);
    else if (/prefers-color-scheme/.test(line)) mech.push(`${r}:${i + 1}: matchMedia(prefers-color-scheme) outside the theme store`);
    if (/dataset\.theme\s*=(?!=)|setAttribute\(\s*['"]data-theme['"]/.test(line)) mech.push(`${r}:${i + 1}: sets the theme attribute outside store/ui.ts`);
    void READ_ONLY;
  });
}
for (const m of mech) problems.push(m);
console.log(`theme mechanism: ${mech.length} place(s) outside ${THEME_OWNERS.join(', ')}`);

// ------------------------------------------------------------------ 3. primitives used directly
const prims = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  text.split(/\r?\n/).forEach((line, i) => { for (const m of line.matchAll(/var\(\s*--p-([\w-]+)/g)) prims.push(`${rel(f)}:${i + 1}: var(--p-${m[1]})`); });
}
// The accent preview cards render the OTHER theme on purpose (states.css .v2-accent-prev): the only allowed direct use, by name.
const allowedPrim = (p) => /^styles\/states\.css:/.test(p) && /--p-(white|gray-900|gray-600|ink-870|ink-50|ink-250)\)/.test(p);
const badPrims = prims.filter((p) => !allowedPrim(p));
for (const p of badPrims) problems.push(`${p}: a primitive has one value for both themes; use a semantic token`);
console.log(`primitives: ${prims.length} direct use(s), ${prims.length - badPrims.length} allowed (accent preview of the other theme)`);

// ------------------------------------------------------------------ 4. unused tokens (warning)
const unused = [...colourTokens].filter((t) => !anyUse.has(t) && !s.accentOverride.includes(t));
console.log(`unused (warning): ${unused.length} colour token(s) nothing under src/ reads${unused.length && verbose ? `: ${unused.map((t) => `--${t}`).join(', ')}` : ''}`);

if (problems.length) { console.log(`\ncoverage: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log('coverage: ok');
