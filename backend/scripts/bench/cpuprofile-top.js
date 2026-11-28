'use strict';
// Summarise a V8 .cpuprofile (node --cpu-prof): the functions with the most self time, and the source files with the most self time.
// Used with phase3-baseline.js --cpuprof DIR to say where the server's own thread spends its time (docs/phase3/perf-baseline.md).
//
//   node scripts/bench/cpuprofile-top.js FILE.cpuprofile [--top 30] [--json]
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const top = Number(args[args.indexOf('--top') + 1]) || 30;
if (!file) { console.error('usage: cpuprofile-top.js FILE.cpuprofile [--top N] [--json]'); process.exit(2); }
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();                                  // node id -> sampled microseconds
const dt = prof.timeDeltas || [];
for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) || 0) + (dt[i] || 0));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const root = path.resolve(__dirname, '..', '..', '..');
const short = (u) => { if (!u) return '(native)'; const p = u.replace(/^file:\/\/\//, '').replace(/\//g, path.sep); const rel = path.relative(root, p); return rel.startsWith('..') ? u.replace(/^node:/, 'node:') : rel.split(path.sep).join('/'); };
const fn = new Map(); const files = new Map();
for (const [id, us] of self) {
  const n = byId.get(id); const cf = n.callFrame;
  const name = cf.functionName || '(anonymous)';
  const key = ['(idle)', '(program)', '(garbage collector)'].includes(name) ? name : `${name}  ${short(cf.url)}:${cf.lineNumber + 1}`;
  fn.set(key, (fn.get(key) || 0) + us);
  const fk = ['(idle)', '(program)', '(garbage collector)'].includes(name) ? name : short(cf.url);
  files.set(fk, (files.get(fk) || 0) + us);
}
const rows = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, us]) => ({ what: k, ms: Math.round(us / 1000), pct: Math.round((us / total) * 1000) / 10 }));
const busy = total - (fn.get('(idle)') || 0);
const out = { file: path.basename(file), sampledMs: Math.round(total / 1000), busyMs: Math.round(busy / 1000), functions: rows(fn), files: rows(files) };
if (args.includes('--json')) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
console.log(`${out.file}: ${out.sampledMs} ms sampled, ${out.busyMs} ms not idle`);
console.log('\nself time by function'); for (const r of out.functions) console.log(`${String(r.ms).padStart(8)} ms ${String(r.pct).padStart(5)} %  ${r.what}`);
console.log('\nself time by file'); for (const r of out.files) console.log(`${String(r.ms).padStart(8)} ms ${String(r.pct).padStart(5)} %  ${r.what}`);
