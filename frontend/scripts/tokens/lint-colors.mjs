// Hard-coded colour lint (audit WP-19 / DS-001, 08 section 7.1).
// Counts colour literals (hex, rgb()/hsl()/... and named colours) in src/ outside the token files. Exit 1 above 0.
// Report-only files are listed in REPORT_ONLY with the reason; they are printed, not counted. A single line can opt out with
// `lint-colors-ignore: <reason>` on it or on the line above (reviewed like any waiver).
//   node scripts/tokens/lint-colors.mjs [--list]
import fs from 'node:fs';
import path from 'node:path';
import { FRONTEND } from './lib.mjs';

const RULES = [
  ['hex', /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![-_\w])/g],
  ['function', /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi],
  // a named colour as a value: after `:` / `(` / `,` (a declaration or a function argument), not in prose
  ['named', /(?<=[:(,]\s*['"]?)(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|teal|navy|silver)(?![-\w(])(?=\s*['"]?\s*[;,)}!]|\s*$)/g],
];
const TOKEN_FILES = [/[\\/]styles[\\/]tokens[\\/]/];
const REPORT_ONLY = [
  [/[\\/]studio[\\/]export[\\/]pdf-(theme|layouts|content)\.ts$/, 'pdfmake print palette of the exported PDF (the paper, not the screen): black ink, link blue, watermark'],
  [/[\\/]studio[\\/]ui[\\/]panels\.ts$/, 'one line of text written into a blank pop-up window that has no stylesheet while a PDF preview is generated'],
  [/\.test\.tsx?$/, 'test fixtures (colour values as data)'],
];
const IGNORE = /lint-colors-ignore/;

const SRC = process.env.LINT_SRC || path.join(FRONTEND, 'src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(SRC).filter((f) => /\.(css|ts|tsx|html)$/.test(f) && !TOKEN_FILES.some((r) => r.test(f)));

let total = 0; const perFile = new Map(); const reported = new Map(); const hits = [];
for (const f of files) {
  const rel = path.relative(FRONTEND, f).replace(/\\/g, '/');
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const ro = REPORT_ONLY.find(([r]) => r.test(f));
  lines.forEach((line, i) => {
    if (IGNORE.test(line) || (i > 0 && IGNORE.test(lines[i - 1]))) return;
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;                                 // comments
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/ .*$/, '');
    for (const [name, re] of RULES) for (const m of code.matchAll(re)) {
      if (name === 'hex' && /(&#x?|url\(|href=["']?)$/i.test(code.slice(0, m.index))) continue;
      if (ro) { reported.set(rel, [(reported.get(rel)?.[0] ?? 0) + 1, ro[1]]); continue; }
      total++; perFile.set(rel, (perFile.get(rel) ?? 0) + 1); hits.push(`${rel}:${i + 1}  ${name}  ${m[0]}`);
    }
  });
}
if (process.argv.includes('--list')) console.log(hits.join('\n'));
for (const [f, n] of [...perFile].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${f}`);
for (const [f, [n, why]] of reported) console.log(`  (report-only) ${n} in ${f}: ${why}`);
console.log(`colour literals outside the token files: ${total}${total ? ' (must be 0)' : ''}`);
process.exit(total ? 1 : 0);
