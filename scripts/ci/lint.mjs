#!/usr/bin/env node
// A small, dependency-free lint step for the offline gate (ARC-014, WP-08). There is no ESLint in the repository and the gate must run without
// a network, so this checks the few things that catch real defects and ratchets the rest:
//
//   hard rules (must be 0):   test.only / describe.only / it.only (a focused test silently skips the rest of its file), `debugger;`
//   ratchets (must not grow):  explicit `any` in backend/src and frontend/src, `require(` in TypeScript sources (escapes the type checker)
//
//   node scripts/ci/lint.mjs            check against scripts/ci/lint-baseline.json
//   node scripts/ci/lint.mjs --update   write the current counts as the new baseline (only ever downwards in review)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = path.join(ROOT, 'scripts', 'ci', 'lint-baseline.json');

function walk(dir, test, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, test, out); else if (test(f)) out.push(f);
  }
  return out;
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');       // comments are not code
const count = (files, re) => files.reduce((n, f) => n + (strip(fs.readFileSync(f, 'utf8')).match(re) || []).length, 0);

const ts = (root) => walk(path.join(ROOT, root), (f) => /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f));
const backendTs = ts('backend/src'); const frontendTs = ts('frontend/src');
const testFiles = [...walk(path.join(ROOT, 'backend', 'test'), (f) => f.endsWith('.js')), ...walk(path.join(ROOT, 'frontend', 'src'), (f) => /\.test\.tsx?$/.test(f)), ...walk(path.join(ROOT, 'frontend', 'e2e'), (f) => /\.ts$/.test(f))];
const ANY = /(?::\s*any\b|\bas\s+any\b|<any>|\bany\[\])/g;

const counts = {
  'any.backend': count(backendTs, ANY),
  'any.frontend': count(frontendTs, ANY),
  'require.backend-ts': count(backendTs, /\brequire\(/g),
  'require.frontend-ts': count(frontendTs, /\brequire\(/g),
};
const hard = {
  'focused tests (.only)': testFiles.filter((f) => /\b(?:test|it|describe)\.only\(/.test(strip(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(ROOT, f)),
  'debugger statements': [...backendTs, ...frontendTs, ...testFiles].filter((f) => /^\s*debugger;?\s*$/m.test(strip(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(ROOT, f)),
};

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ _comment: 'Ratchet for scripts/ci/lint.mjs: a count may go down (then lower it here), never up.', ...counts }, null, 2) + '\n');
  console.log('lint baseline written', counts); process.exit(0);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
let bad = false;
for (const [rule, files] of Object.entries(hard)) {
  if (files.length) { bad = true; console.log(`FAIL ${rule}: ${files.join(', ')}`); } else console.log(`ok   ${rule}: none`);
}
for (const [k, n] of Object.entries(counts)) {
  const b = base[k];
  if (b === undefined) { bad = true; console.log(`FAIL ${k}: ${n}, no baseline (run with --update in a reviewed change)`); continue; }
  if (n > b) { bad = true; console.log(`FAIL ${k}: ${n}, the baseline is ${b} (+${n - b}); type the new code instead`); }
  else console.log(`ok   ${k}: ${n} (baseline ${b}${n < b ? `; lower it to ${n}` : ''})`);
}
process.exit(bad ? 1 : 0);
