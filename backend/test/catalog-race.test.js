'use strict';
// The XML catalogue libxml2 reads (xmllint / xsltproc children) is shared and was rewritten with a truncate-then-write on EVERY launch, so a
// child that started while another launch was rewriting it read an EMPTY file ("jsspub-s1000d-catalog.xml, line 1: Document is empty") and a
// valid data module was reported as "XML cannot be parsed" (seen on a 218-module import, Phase 18). A reader must never see a partial file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const { spawn } = require('node:child_process');

test('while the catalogue is being rewritten, a concurrent reader never sees an empty or partial file', async () => {
  const cat = require('../vendor/engine/catalog');
  cat.writeCatalog();                                           // exists before the reader starts
  const writer = spawn(process.execPath, ['-e', `const c=require(${JSON.stringify(path.resolve(__dirname, '..', 'vendor', 'engine', 'catalog'))}); const end=Date.now()+2500; while(Date.now()<end) c.writeCatalog();`], { stdio: 'ignore' });
  let reads = 0; let torn = 0; let missing = 0;
  const done = new Promise((res) => writer.on('close', res));
  let running = true; done.then(() => { running = false; });
  while (running) {
    for (let i = 0; i < 200; i++) {
      reads++;
      let s; try { s = fs.readFileSync(cat.CATALOG_FILE, 'utf8'); } catch { missing++; continue; }
      if (!s.endsWith('</catalog>\n') || !s.startsWith('<?xml')) torn++;
    }
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(reads > 500, `the reader ran (${reads} reads)`);
  assert.equal(torn, 0, `${torn} of ${reads} reads saw an empty or partial catalogue`);
  assert.equal(missing, 0, `${missing} reads found no catalogue at all`);
});
