'use strict';
// WP-32 (audit PERF-002): when the validator cannot run on a batch, the batch is retried module by module, so exactly the module it cannot
// judge is named (with the reason), the others are still judged, and `checked` does not count the unjudged one. This file replaces
// xmllint-wasm in the require cache with a wrapper that fails like the real one did ("memory access out of bounds") on any call that
// carries the marked module, so it runs in its own process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');

const real = require('xmllint-wasm');
const calls = [];
require.cache[require.resolve('xmllint-wasm')].exports = {
  ...real,
  validateXML: async (args) => {
    calls.push(args.xml.length);
    if (args.xml.some((d) => d.contents.includes('CRASH-THE-VALIDATOR'))) throw new Error('memory access out of bounds');
    return real.validateXML(args);
  },
};
const { validateProjectSchema } = require('../vendor/engine/validateSchema');

const BASE = fs.readFileSync(path.join(__dirname, 'fixtures', 'rich', 'DMC-EXAMPLE-A-00-00-00-00A-040A-D_001-00_EN-US.XML'), 'utf8');

test('a module the validator cannot run on is named on its own; the rest of its batch is judged; checked counts only judged modules', { timeout: 300000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp32c-'));
  try {
    const rels = [];
    for (let i = 0; i < 30; i++) {
      let xml = BASE;
      if (i === 12) xml = xml.replace('</description>', '<!-- CRASH-THE-VALIDATOR --></description>');
      if (i === 20) xml = xml.replace('<levelledPara>', '<levelledPara><zzNope/>');
      const f = `DMC-C${String(i).padStart(2, '0')}.XML`; fs.writeFileSync(path.join(dir, f), xml); rels.push(f);
    }
    calls.length = 0;
    const r = await validateProjectSchema(dir, rels, {});
    assert.equal(r.checked, 29, 'the module that could not be judged is not counted');
    const info = r.issues.filter((i) => i.sev === 'info');
    assert.equal(info.length, 1, JSON.stringify(info));
    assert.equal(info[0].rel, 'DMC-C12.XML', 'the right module is named, not the first of the batch');
    assert.equal(info[0].title, 'Schema check could not run');
    assert.match(info[0].detail, /ran out of memory on this module \(0\.0 MB\)/, 'an out-of-memory failure says so, with the size (a small module is not called too large)');
    assert.deepEqual(r.issues.filter((i) => i.sev === 'crit').map((i) => i.rel), ['DMC-C20.XML'], 'the other modules of the failed batch were still judged');
    assert.equal(calls[0], 30, 'one call for the whole batch first');
    assert.equal(calls.length, 31, 'then one call per module of the failed batch');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
