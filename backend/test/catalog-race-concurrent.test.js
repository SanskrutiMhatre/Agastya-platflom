'use strict';
// The XML catalogue is rewritten before every tool launch. It used to be truncated and rewritten each time, so a validator that started in
// that instant read an empty file and reported a good module as "Document is empty" (a different module on every run).
//   - an unchanged catalogue is not touched
//   - while other processes rewrite it over and over, a reader never sees it empty or cut short
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const cat = require('../vendor/engine/catalog');

test('an unchanged catalogue is not rewritten, and no temporary files are left behind', () => {
  const file = cat.writeCatalog();
  // The schemas are part of the repository (backend/schemas): no catalogue means a broken checkout, not a reason to pass with no assertion (QA-018).
  assert.ok(file, 'writeCatalog() found no schemas to map');
  const before = fs.statSync(file);
  const text = fs.readFileSync(file, 'utf8');
  for (let i = 0; i < 20; i++) assert.equal(cat.writeCatalog(), file);
  const after = fs.statSync(file);
  assert.equal(after.mtimeMs, before.mtimeMs, 'the file was not rewritten');
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.ok(text.includes('</catalog>'));
  const base = path.basename(file);
  const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(base + '.') && n.endsWith('.tmp'));
  assert.deepEqual(leftovers, [], 'no stray temporary files');
});

test('while other processes call it again and again (every tool launch does), a reader never sees it empty or partial', { timeout: 120000 }, async () => {
  const file = cat.writeCatalog();
  assert.ok(file, 'writeCatalog() found no schemas to map');
  const full = fs.readFileSync(file, 'utf8');
  // what happens in production: many launches, each asking for the catalogue, while parsers read it
  const code = `const c=require(${JSON.stringify(path.resolve(__dirname, '..', 'vendor', 'engine', 'catalog'))});
    for(let i=0;i<400;i++){ c.writeCatalog(); } process.exit(0);`;
  const script = path.join(os.tmpdir(), `catalog-race-worker-${process.pid}.js`);
  fs.writeFileSync(script, code);
  const workers = Array.from({ length: 4 }, () => fork(script, [], { stdio: 'ignore' }));
  const done = Promise.all(workers.map((w) => new Promise((r) => w.on('exit', r))));
  let reads = 0; const bad = [];
  let running = true;
  done.then(() => { running = false; });
  while (running) {
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* momentarily absent: a reader would retry; not a torn read */ }
    if (text !== null) { reads++; if (text !== full) bad.push(text.length); }
    await new Promise((r) => setImmediate(r));
  }
  try { fs.rmSync(script, { force: true }); } catch { /* ignore */ }
  cat.writeCatalog();                                            // leave it in place for whoever runs next
  assert.ok(reads > 0, 'the reader did read the file');
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} of ${reads} reads saw the catalogue empty or cut short`);
});
