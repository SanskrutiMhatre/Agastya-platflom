// Token checks (audit WP-19, TH-002 / TH-005 / 08 sections 7.2-7.3):
//  1. contrast: every pair in tokens.json, in both themes (text 4.5:1, ui and large 3:1, floor:N only a minimum);
//  2. coverage: every var(--x) used under src/ resolves to a token or to a custom property the code defines itself;
//     every semantic colour has a light and a dark value (enforced by the source format); unused aliases are listed.
//   node scripts/tokens/check-contrast.mjs [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { FRONTEND, NEED, over, parseColour, ratio, readSource, resolve, validateSource } from './lib.mjs';

const verbose = process.argv.includes('--verbose');
const s = readSource();
const errors = validateSource(s);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

// ------------------------------------------------------------------ 1. contrast
let failures = 0, checked = 0;
const rows = [];
for (const theme of ['light', 'dark']) {
  const panel = parseColour(resolve(s, 'surface-panel', theme));
  for (const [fgName, bgName, kind] of s.pairs) {
    const bgRaw = parseColour(resolve(s, bgName, theme));
    // a translucent paper tint lies on the paper sheet (white in both themes), a translucent sheet tint on the JSS/JSG editing sheet (themed),
    // every other translucent background on the panel (WP-20)
    const base = bgName.startsWith('paper-') ? 'paper' : bgName.startsWith('sheet-') ? 'sheet' : null;
    const bg = bgRaw.a < 1 ? over(bgRaw, base ? parseColour(resolve(s, base, theme)) : panel) : bgRaw;
    const fgRaw = parseColour(resolve(s, fgName, theme));
    const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
    const need = kind.startsWith('floor:') ? Number(kind.slice(6)) : NEED[kind];
    const r = ratio(fg, bg);
    checked++;
    const ok = r + 1e-9 >= need;
    if (!ok) failures++;
    if (!ok || verbose) rows.push(`${ok ? 'ok  ' : 'FAIL'} ${theme.padEnd(5)} ${fgName} on ${bgName} (${kind}) ${r.toFixed(2)} need ${need}`);
  }
}
console.log(rows.join('\n'));
console.log(`contrast: ${checked} checks (${s.pairs.length} pairs x 2 themes), ${failures} failing`);

// ------------------------------------------------------------------ 2. coverage
const SRC = process.env.COVERAGE_SRC || path.join(FRONTEND, 'src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(SRC).filter((f) => /\.(css|ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && !/[\\/]tokens[\\/]tokens\.css$/.test(f));
const used = new Map(); const definedInCode = new Set();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/var\(\s*--([\w-]+)/g)) { if (!used.has(m[1])) used.set(m[1], path.relative(FRONTEND, f)); }
  for (const m of text.matchAll(/(?:^|[\s;{'"`])--([\w-]+)\s*:/g)) definedInCode.add(m[1]);
  for (const m of text.matchAll(/setProperty\(\s*[`'"]--([\w-]+)/g)) definedInCode.add(m[1]);
  for (const m of text.matchAll(/setProperty\(\s*`--admin-\$\{/g)) definedInCode.add('admin-*');
}
const tokenNames = new Set([...Object.keys(s.semantic), ...Object.keys(s.fixed), ...Object.keys(s.scale), ...Object.keys(s.density.comfortable), ...Object.keys(s.alias), ...Object.keys(s.primitive).map((k) => `p-${k}`)]);
const isAdmin = (k) => /^admin-/.test(k);
const undefinedUsed = [...used].filter(([k]) => !tokenNames.has(k) && !definedInCode.has(k) && !isAdmin(k));
const unusedAlias = Object.keys(s.alias).filter((k) => !used.has(k));
if (undefinedUsed.length) console.log(`coverage: ${undefinedUsed.length} variable(s) used but never defined:\n  ${undefinedUsed.map(([k, f]) => `--${k} (${f})`).join('\n  ')}`);
else console.log('coverage: every var(--x) used under src/ is defined');
if (unusedAlias.length) console.log(`coverage (warning): aliases nothing reads: ${unusedAlias.map((k) => `--${k}`).join(', ')}`);
process.exit(failures || undefinedUsed.length ? 1 : 0);
