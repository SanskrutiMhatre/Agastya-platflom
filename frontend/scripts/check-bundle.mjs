#!/usr/bin/env node
// Bundle budget check (audit WP-18: FE-026, FE-031, FE-033). Run after `vite build`:  node scripts/check-bundle.mjs [--json] [dist]
//
// Budgets (04-PERFORMANCE-AUDIT section 12.6, "Proposed targets"):
//   * initial JS + CSS that index.html loads (scripts, module preloads, stylesheets), gzip: at most 180 KB
//   * the Studio chunk (EditorPage-*.js), gzip: at most 300 KB
//   * the entry stylesheet, raw: under 30 KB (advisory: a warning unless CHECK_BUNDLE_STRICT_CSS=1, see below)
//   * one copy each of pdfmake and its font modules (Roboto, Helvetica, Courier)
// Exit code 1 when a budget is exceeded, so a build step or CI fails on a regression. Sizes are gzip level 9, as a server would send them.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const json = args.includes('--json');
const dist = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(here, '..', 'dist'));

export const BUDGETS = { initialGzip: 180 * 1024, studioGzip: 300 * 1024, entryCssRaw: 30 * 1024 };
const SINGLE = ['pdfmake', 'Roboto', 'Helvetica', 'Courier'];

const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const refs = new Set();
for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) refs.add(m[1]);
for (const m of html.matchAll(/<link\b[^>]*\brel="(?:modulepreload|stylesheet)"[^>]*\bhref="([^"]+)"/g)) refs.add(m[1]);
const initial = [...refs].filter((r) => !/^[a-z]+:/i.test(r)).map((r) => {
  const buf = fs.readFileSync(path.join(dist, r.replace(/^\//, '')));
  return { file: r, raw: buf.length, gzip: gz(buf) };
});
const initialGzip = initial.reduce((n, f) => n + f.gzip, 0);
const initialRaw = initial.reduce((n, f) => n + f.raw, 0);

const assets = fs.readdirSync(path.join(dist, 'assets'));
const baseName = (f) => f.replace(/-[A-Za-z0-9_-]{8,}(\.[a-z0-9]+)$/i, '$1');
const groups = new Map();
for (const f of assets) { const b = baseName(f); groups.set(b, [...(groups.get(b) ?? []), f]); }
const duplicates = SINGLE.map((n) => ({ name: n, files: assets.filter((f) => new RegExp(`^${n}-[A-Za-z0-9_-]{8,}\\.js$`).test(f)) })).filter((d) => d.files.length > 1);

const studio = assets.filter((f) => /^EditorPage-[A-Za-z0-9_-]{8,}\.js$/.test(f)).map((f) => {
  const buf = fs.readFileSync(path.join(dist, 'assets', f)); return { file: f, raw: buf.length, gzip: gz(buf) };
});
const studioGzip = studio.reduce((n, f) => Math.max(n, f.gzip), 0);
const entryCss = initial.filter((f) => f.file.endsWith('.css'));
const entryCssRaw = entryCss.reduce((n, f) => n + f.raw, 0);
const largest = assets.map((f) => ({ file: f, raw: fs.statSync(path.join(dist, 'assets', f)).size })).sort((a, b) => b.raw - a.raw).slice(0, 8);

const failures = [];
if (initialGzip > BUDGETS.initialGzip) failures.push(`initial JS + CSS ${kb(initialGzip)} gzip is over ${kb(BUDGETS.initialGzip)}`);
if (studio.length && studioGzip > BUDGETS.studioGzip) failures.push(`the Studio chunk ${kb(studioGzip)} gzip is over ${kb(BUDGETS.studioGzip)}`);
if (!studio.length) failures.push('no EditorPage-*.js chunk found (the Studio is no longer split out?)');
// Advisory until the Studio styles move into the Studio chunk: they also hold the app-wide tokens and resets, which WP-19 (design tokens) owns.
const warnings = [];
if (entryCssRaw > BUDGETS.entryCssRaw) (process.env.CHECK_BUNDLE_STRICT_CSS === '1' ? failures : warnings).push(`the entry stylesheet ${kb(entryCssRaw)} is over ${kb(BUDGETS.entryCssRaw)}`);
for (const d of duplicates) failures.push(`${d.files.length} copies of ${d.name}: ${d.files.join(', ')}`);

const report = { dist, initial, initialRaw, initialGzip, studio, entryCssRaw, duplicates, largest, assets: assets.length, budgets: BUDGETS, failures, warnings };
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`initial load: ${initial.length} files, ${kb(initialRaw)} raw, ${kb(initialGzip)} gzip (budget ${kb(BUDGETS.initialGzip)})`);
  for (const f of initial) console.log(`  ${f.file.padEnd(40)} ${kb(f.raw).padStart(10)} ${kb(f.gzip).padStart(10)} gzip`);
  for (const f of studio) console.log(`studio chunk: ${f.file} ${kb(f.raw)} raw, ${kb(f.gzip)} gzip (budget ${kb(BUDGETS.studioGzip)})`);
  console.log(`entry stylesheet: ${kb(entryCssRaw)} raw (budget ${kb(BUDGETS.entryCssRaw)})`);
  console.log(`assets: ${assets.length} files; largest: ${largest.map((l) => `${l.file} ${kb(l.raw)}`).join(', ')}`);
  for (const w of warnings) console.log(`WARN (advisory): ${w}`);
  console.log(failures.length ? `FAIL\n  ${failures.join('\n  ')}` : 'PASS: every budget met');
}
process.exitCode = failures.length ? 1 : 0;
