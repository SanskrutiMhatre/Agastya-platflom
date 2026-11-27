// A stand-in for the native `xmllint` command, used ONLY by the frontend tests on machines that do not have one
// (a plain Windows box). It runs the same libxml2 that the product ships, compiled to WebAssembly (xmllint-wasm),
// so the answers are libxml2's, not a re-implementation.
//
// Supported: the invocations the tests make - `xmllint [--noout] [--nonet] --schema <file.xsd> <file.xml>...`,
// `xmllint --xpath <expr> <file.xml>` and `xmllint --shell <file.xml>` with `xpath <expr>` commands on standard input.
// Every file named on the command line, every file in the current directory and every sibling of the schema is made
// visible to the validator under its base name (a schema that includes or imports its neighbours finds them).
// Exit codes follow xmllint: 0 valid, 3 schema validation error / 4 instance not valid, 1 anything else.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function wasmWorker() {
  for (const base of [path.join(here, '..'), path.join(here, '..', '..', 'backend')]) {
    try { return require.resolve('xmllint-wasm/xmllint-node.js', { paths: [base] }); } catch { /* try the next */ }
  }
  throw new Error('xmllint-wasm is not installed (run npm install in frontend)');
}

const args = process.argv.slice(2);
const inputs = new Map(); // base name -> bytes
const addFile = (p) => {
  try {
    const st = fs.statSync(p);
    if (st.isFile() && st.size < 64 * 1024 * 1024) inputs.set(path.basename(p), fs.readFileSync(p));
  } catch { /* not a file */ }
};
const addDir = (d) => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isFile()) addFile(path.join(d, e.name)); } catch { /* none */ } };

addDir(process.cwd());
const VALUE_OPTIONS = new Set(['--xpath', '--path', '--maxmem', '--encode', '--pretty', '--max-ampl', '--pattern', '--output', '-o']);
const wasmArgs = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--schema' || a === '--relaxng') {
    const p = args[++i];
    addDir(path.dirname(path.resolve(p)));
    wasmArgs.push(a, path.basename(p));
  } else if (VALUE_OPTIONS.has(a)) {
    wasmArgs.push(a, args[++i]);   // an option's value (an XPath expression, a size...) is not a file
  } else if (a.startsWith('-')) {
    if (a !== '--shell') wasmArgs.push(a);
  } else {
    addFile(a);
    wasmArgs.push(path.basename(a));
  }
}

if (args.includes('--shell')) runShell();
else runOnce();

// `xmllint --shell <file>` with `xpath <expr>` commands on standard input (the BREX XPath comparison test). The WebAssembly build has
// no shell, so each command is evaluated with --xpath on ONE reused worker and printed the way the native shell prints it
// ("Object is a number : N", "Object is a string : S"); an expression libxml2 cannot evaluate prints libxml2's error instead, as the shell does.
function runShell() {
  const file = wasmArgs.filter((a) => !a.startsWith('-')).pop();
  const cmds = fs.readFileSync(0, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('xpath ')).map((l) => l.slice('xpath '.length));
  const files = [...inputs].map(([fileName, contents]) => ({ fileName, contents }));
  const w = new Worker(wasmWorker());
  let i = 0, seenOut = 0, seenErr = 0;
  const next = () => {
    if (i >= cmds.length) { w.terminate().then(() => process.exit(0)); return; }
    w.postMessage({ 'xmllint-wasm': true, inputFiles: files, args: ['--xpath', cmds[i], file], initialMemory: 256, maxMemory: 4096 });
  };
  w.on('message', (d) => {
    if (!d || d['xmllint-wasm'] !== true) return;
    // the worker's stdout and stderr accumulate across calls: only what follows the previous call belongs to this command
    const stdout = d.stdout || '', stderr = d.stderr || '';
    const out = stdout.slice(seenOut).trim(), err = stderr.slice(seenErr);
    seenOut = stdout.length; seenErr = stderr.length;
    const expr = cmds[i++];
    if (d.exitCode === 0 && out !== '') {
      const isNumber = /^count\(/.test(expr) && /^\d+$/.test(out);
      process.stdout.write(`Object is a ${isNumber ? 'number' : 'string'} : ${out}\n`);
    } else process.stderr.write(err || 'XPath evaluation failure\n');
    next();
  });
  w.on('error', (e) => { process.stderr.write(`xmllint (wasm): ${e.message}\n`); process.exit(1); });
  next();
}

function runOnce() {
const worker = new Worker(wasmWorker());
const timer = setTimeout(() => { process.stderr.write('xmllint (wasm): timed out\n'); process.exit(1); }, 180000);
worker.on('message', (d) => {
  if (!d || d['xmllint-wasm'] !== true) return;
  clearTimeout(timer);
  if (d.stdout) process.stdout.write(d.stdout);
  if (d.stderr) process.stderr.write(d.stderr);
  worker.terminate().then(() => process.exit(d.exitCode ?? 1));
});
worker.on('error', (e) => { process.stderr.write(`xmllint (wasm): ${e.message}\n`); process.exit(1); });
worker.postMessage({
  'xmllint-wasm': true,
  inputFiles: [...inputs].map(([fileName, contents]) => ({ fileName, contents })),
  args: wasmArgs,
  initialMemory: 256,
  maxMemory: 4096,
});
}
