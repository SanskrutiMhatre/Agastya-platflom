#!/usr/bin/env node
// WP-36 (CLN-004): the dead-code and removal-completeness gate of the front end.
//
//   npm run check:cleanup                              exit 1 when a file, export, CSS class or runtime dependency is unreferenced outside allowlist.json, when an
//                                                      allow-list entry has no reason, or when a feature the owner removed left debris behind
//   node scripts/cleanup/check.mjs [--report FILE.md] [--json FILE.json] [--verbose]
//
// The scan is scripts/cleanup/scan.mjs (its tests: scan.test.mjs, `node --test`). The removal checklist that keeps these counts at zero is
// in .github/pull_request_template.md. A stale allow-list entry (the item is gone or used again) is a warning: remove the entry.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAllowList, scanDeadCode, scanRemovalDebris } from './scan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));

const t0 = Date.now();
const scan = scanDeadCode();
const allow = applyAllowList(scan, readJson('allowlist.json'));
const debris = scanRemovalDebris(readJson('removed-features.json').features);

const lines = [];
const say = (s = '') => lines.push(s);
say('# Cleanup check (WP-36)');
say();
const prefixUse = {};
for (const c of scan.classesGenerated) prefixUse[c.prefix] = (prefixUse[c.prefix] ?? 0) + 1;
say(`Source files ${scan.counts.sourceFiles}; CSS classes defined ${scan.counts.classesDefined}, of which ${scan.counts.classesGenerated} are built from a prefix (${Object.entries(prefixUse).map(([p, n]) => `${p}* ${n}, built in ${scan.prefixes[p]}`).join('; ') || 'none'}).`);
say(`Kept by rule: ${scan.filesAmbient.length} ambient declaration file(s), ${scan.filesTestOnly.length} file(s) used only by tests or scripts, ${scan.counts.exportsTestOnly} export(s) used only by tests, ${scan.counts.exportsOwnFileOnly} used only in their own file.`);
say();
say('| Count | Unreferenced | Allow-listed | Outside the allow-list |');
say('|---|---|---|---|');
say(`| files | ${scan.files.length} | ${allow.allowed.files} | ${allow.files.length} |`);
say(`| exports | ${scan.exports.length} | ${allow.allowed.exports} | ${allow.exports.length} |`);
say(`| CSS classes | ${scan.classes.length} | ${allow.allowed.classes} | ${allow.classes.length} |`);
say(`| runtime dependencies | ${scan.deps.length} | ${allow.allowed.deps} | ${allow.deps.length} |`);
say(`| removal debris | ${debris.length} | - | ${debris.length} |`);
if (allow.files.length) { say(); say('## Files nothing imports'); say(); for (const f of allow.files) say(`* ${f}`); }
if (allow.exports.length) { say(); say('## Exports referenced nowhere'); say(); for (const e of allow.exports) say(`* ${e.file}:${e.line} \`${e.name}\` (${e.kind})`); }
if (allow.classes.length) { say(); say('## CSS classes no source names'); say(); for (const c of allow.classes) say(`* .${c.name} (${c.file}:${c.line})`); }
if (allow.deps.length) { say(); say('## Runtime dependencies nothing imports'); say(); for (const d of allow.deps) say(`* ${d}`); }
if (debris.length) { say(); say('## Debris of features the owner removed'); say(); for (const d of debris) say(`* ${d}`); }
if (allow.problems.length) { say(); say('## Allow-list problems'); say(); for (const p of allow.problems) say(`* ${p}`); }
if (allow.stale.length) { say(); say('## Stale allow-list entries (warning: remove them)'); say(); for (const s of allow.stale) say(`* ${s}`); }
if (argv.includes('--verbose')) {
  say(); say('## Files used only by tests or scripts'); say(); for (const f of scan.filesTestOnly) say(`* ${f}`);
  say(); say('## Ambient declarations'); say(); for (const f of scan.filesAmbient) say(`* ${f}`);
}
const failed = allow.files.length + allow.exports.length + allow.classes.length + allow.deps.length + debris.length + allow.problems.length > 0;
say();
say(failed ? `**FAIL**: ${allow.files.length} file(s), ${allow.exports.length} export(s), ${allow.classes.length} class(es), ${allow.deps.length} dependenc(ies) unreferenced, ${debris.length} piece(s) of removal debris, ${allow.problems.length} allow-list problem(s).`
  : `PASS: no dead file, export or class outside the allow-list; no debris of removed features (${((Date.now() - t0) / 1000).toFixed(1)} s).`);
const report = `${lines.join('\n')}\n`;
if (opt('report')) fs.writeFileSync(path.resolve(opt('report')), report);
if (opt('json')) fs.writeFileSync(path.resolve(opt('json')), `${JSON.stringify({ scan, allow, debris, failed }, null, 2)}\n`);
process.stdout.write(report);
process.exit(failed ? 1 : 0);
