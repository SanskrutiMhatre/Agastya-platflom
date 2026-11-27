'use strict';
// WP-32 (audit PERF-002): the project schema check tells the truth at every project size. One validator call used to carry every module of
// a schema; above about 8 MB of text (about 850 modules) the WebAssembly memory ran out, the failure was reported once against module 0001
// and every module still counted as checked. Now: batches by bytes, memory sized to the batch, findings identical to checking each module
// on its own, and `checked` counts only modules that were judged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { validateProjectSchema, validateDocument } = require('../vendor/engine/validateSchema');

const BASE = fs.readFileSync(path.join(__dirname, 'fixtures', 'rich', 'DMC-EXAMPLE-A-00-00-00-00A-040A-D_001-00_EN-US.XML'), 'utf8');
const FILL = '<levelledPara><para>' + 'Filler text for size. '.repeat(40) + '</para></levelledPara>\n';
/** The descriptive fixture padded to about `bytes` (about 9 KB is the size of the audit's measured modules: 8.9 MB for 1000). */
function padded(bytes, xml = BASE) {
  const reps = Math.max(0, Math.ceil((bytes - Buffer.byteLength(xml)) / FILL.length));
  return xml.replace('</description>', FILL.repeat(reps) + '</description>');
}
const BAD = (xml, tag = 'zzNope') => xml.replace('<levelledPara>', `<levelledPara><${tag}/>`);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wp32-'));
const crit = (r) => r.issues.filter((i) => i.sev === 'crit');
const notes = (r) => r.issues.filter((i) => i.sev === 'info');

// The series the audit measured: 800 passed, 900 and 1000 failed; 2000 and 5000 are the acceptance sizes.
for (const n of [600, 900, 1000, 2000, 5000]) {
  test(`${n} modules of about 9 KB: all judged, none unchecked, and exactly the planted errors are reported on the right modules`, { timeout: 600000 }, async () => {
    const dir = tmp();
    try {
      const good = padded(9000); const planted = new Set([7, Math.floor(n / 2), n - 1]); const rels = [];
      for (let i = 0; i < n; i++) {
        const f = `DMC-T${String(i).padStart(5, '0')}.XML`;
        fs.writeFileSync(path.join(dir, f), planted.has(i) ? BAD(good) : good); rels.push(f);
      }
      const r = await validateProjectSchema(dir, rels, {});
      assert.equal(r.checked, n, 'every module was judged');
      assert.deepEqual(notes(r), [], 'no module is reported as not checked');
      const got = [...new Set(crit(r).map((i) => i.rel))].sort();
      assert.deepEqual(got, [...planted].sort((a, b) => a - b).map((i) => `DMC-T${String(i).padStart(5, '0')}.XML`), 'errors on the planted modules only (never on module 0001)');
      for (const i of crit(r)) assert.match(i.detail, /zzNope/, 'the specific error, not a bare "fails to validate"');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('the findings of a batched run are the same as checking each module on its own, across two issues (4.2 and 5.0)', { timeout: 600000 }, async () => {
  const dir = tmp();
  try {
    const v50 = padded(9000); const v42 = v50.replace(/S1000D_5-0/g, 'S1000D_4-2');
    const rels = [];
    for (let i = 0; i < 40; i++) {
      let xml = i % 2 ? v42 : v50;
      if (i % 7 === 3) xml = BAD(xml);
      if (i % 11 === 5) xml = BAD(xml, 'zzOther');
      const f = `DMC-M${String(i).padStart(3, '0')}.XML`; fs.writeFileSync(path.join(dir, f), xml); rels.push(f);
    }
    const r = await validateProjectSchema(dir, rels, {});
    assert.equal(r.checked, 40);
    const batched = crit(r).map((i) => `${i.rel}:${i.line}:${i.detail.replace(/ \(Issue [^)]*\)$/, '')}`).sort();
    const single = [];
    for (const rel of rels) {
      const d = await validateDocument(rel, fs.readFileSync(path.join(dir, rel), 'utf8'));
      assert.ok(d.schema, `${rel} was checked against a schema on its own`);
      for (const x of d.diagnostics) if (!/fails to validate/.test(x.message)) single.push(`${rel}:${x.line}:${x.message}`);
    }
    assert.ok(batched.length > 0, 'the planted errors were found');
    assert.deepEqual(batched, single.sort(), 'same modules, lines and messages');
    assert.ok(crit(r).some((i) => /Issue 4\.2/.test(i.detail)) && crit(r).some((i) => /Issue 5\.0/.test(i.detail)), 'both issues were used');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a 25 MB module is judged (its own error is found on the right line), and the modules beside it are judged too', { timeout: 600000 }, async () => {
  const dir = tmp();
  try {
    const big = padded(25 * 1048576).replace('</description>', '<zzBig/></description>');
    fs.writeFileSync(path.join(dir, 'DMC-BIG.XML'), big);
    fs.writeFileSync(path.join(dir, 'DMC-SMALL.XML'), padded(9000));
    const r = await validateProjectSchema(dir, ['DMC-BIG.XML', 'DMC-SMALL.XML'], {});
    assert.equal(r.checked, 2);
    assert.deepEqual(notes(r), []);
    const e = crit(r);
    assert.equal(e.length, 1, JSON.stringify(e));
    assert.equal(e[0].rel, 'DMC-BIG.XML');
    assert.equal(e[0].line, big.slice(0, big.indexOf('<zzBig/>')).split('\n').length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an invalid module in a batch no longer puts a "fails to validate" error on the first (valid) module of the batch', async () => {
  const dir = tmp();
  try {
    const good = padded(9000);
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `DMC-F${i}.XML`), i === 3 ? BAD(good) : good);
    const r = await validateProjectSchema(dir, [0, 1, 2, 3, 4].map((i) => `DMC-F${i}.XML`), {});
    assert.deepEqual([...new Set(crit(r).map((i) => i.rel))], ['DMC-F3.XML']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
