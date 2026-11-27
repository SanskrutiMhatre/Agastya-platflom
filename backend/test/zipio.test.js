'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const { verifyZip, tmp: helperTmp } = require('./helpers');
const Z = require('../dist/services/zipio');

const tmp = () => helperTmp('zipio-');           // removed when the file's process ends (QA-010)
async function build(file, files, opts) {
  const w = new Z.ZipStreamWriter(fs.createWriteStream(file), opts);
  for (const [n, d] of Object.entries(files)) await w.addBuffer(n, Buffer.from(d));
  await w.finish();
}
// A hand-made archive with arbitrary entry names (the writer itself refuses unsafe ones).
function raw(file, entries, flagsFor = () => 0) {
  const parts = []; const cen = []; let off = 0;
  for (const [name, data] of entries) {
    const nb = Buffer.from(name); const d = Buffer.from(data); const crc = zlib.crc32(d);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flagsFor(name), 6); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, d);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flagsFor(name), 8); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    cen.push(ch, nb); off += 30 + nb.length + d.length;
  }
  const cd = Buffer.concat(cen); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, e]));
}

test('round trip, standard and forced ZIP64; both pass unzip -t', async () => {
  for (const z64 of [false, true]) {
    const d = tmp(); const f = path.join(d, 'a.zip');
    await build(f, { 'a.txt': 'hello '.repeat(1000), 'dir/b.xml': '<x/>', 'empty.txt': '' }, { forceZip64: z64 });
    const r = Z.ZipFileReader.open(f);
    assert.deepEqual(r.entries.map((e) => e.name), ['a.txt', 'dir/b.xml', 'empty.txt']);
    assert.equal((await r.readBuffer(r.entries[0])).toString(), 'hello '.repeat(1000));
    assert.equal((await r.readBuffer(r.entries[2])).length, 0);
    const out = path.join(d, 'out'); await r.extractTo(out);
    assert.equal(fs.readFileSync(path.join(out, 'dir/b.xml'), 'utf8'), '<x/>'); r.close();
    try { verifyZip(f); } catch (e) { assert.fail(`${z64 ? 'ZIP64' : 'ZIP'}: ${e.message}`); }
  }
});
test('ZIP Slip and unsafe names are refused', async () => {
  for (const bad of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/x.txt', '..\\evil.txt', 'ok/../../x']) {
    const d = tmp(); const f = path.join(d, 'a.zip'); raw(f, [[bad, 'x']]);
    const r = Z.ZipFileReader.open(f);
    await assert.rejects(r.extractTo(path.join(d, 'out')), (e) => e.code === 'UNSAFE_NAME', bad); r.close();
    assert.equal(fs.existsSync(path.join(d, 'evil.txt')), false);
  }
  assert.throws(() => Z.safeEntryName('a\0b'), /NUL/);
});
test('duplicate names, encrypted entries, corrupt CRC, truncation, bomb limits', async () => {
  let d = tmp(); let f = path.join(d, 'a.zip'); raw(f, [['a.txt', '1'], ['A.TXT', '2']]);
  let r = Z.ZipFileReader.open(f); await assert.rejects(r.extractTo(path.join(d, 'o')), /Duplicate/); r.close();
  d = tmp(); f = path.join(d, 'a.zip'); raw(f, [['a.txt', 'x']], () => 1);
  r = Z.ZipFileReader.open(f); await assert.rejects(r.readBuffer(r.entries[0]), /encrypted/); r.close();
  d = tmp(); f = path.join(d, 'a.zip'); raw(f, [['a.txt', 'abcdef']]);
  const b = fs.readFileSync(f); b[30 + 5] ^= 0xff; fs.writeFileSync(f, b);
  r = Z.ZipFileReader.open(f); await assert.rejects(r.readBuffer(r.entries[0]), /CRC/); r.close();
  d = tmp(); f = path.join(d, 'a.zip'); fs.writeFileSync(f, Buffer.from('PK\x03\x04 not a zip'));
  assert.throws(() => Z.ZipFileReader.open(f), (e) => e.code === 'BAD_ZIP');
  d = tmp(); f = path.join(d, 'a.zip'); await build(f, { 'a.txt': 'x', 'b.txt': 'y', 'c.txt': 'z' });
  assert.throws(() => Z.ZipFileReader.open(f, { ...Z.DEFAULT_LIMITS, maxEntries: 2 }), (e) => e.code === 'LIMIT');
  assert.throws(() => Z.ZipFileReader.open(f, { ...Z.DEFAULT_LIMITS, maxEntryBytes: 0 }), (e) => e.code === 'LIMIT');
  // a real bomb: 20 MB of zeros deflates to ~20 KB (ratio > 1000)
  d = tmp(); f = path.join(d, 'bomb.zip'); await build(f, { 'zeros.bin': Buffer.alloc(20 * 1024 * 1024).toString('latin1') });
  assert.throws(() => Z.ZipFileReader.open(f), (e) => e.code === 'LIMIT' && /ratio/.test(e.message));
});
test('existing files are not overwritten unless asked', async () => {
  const d = tmp(); const f = path.join(d, 'a.zip'); await build(f, { 'a.txt': 'new' });
  const out = path.join(d, 'o'); fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'a.txt'), 'old');
  const r = Z.ZipFileReader.open(f); await assert.rejects(r.extractTo(out), (e) => e.code === 'EXISTS');
  assert.equal(fs.readFileSync(path.join(out, 'a.txt'), 'utf8'), 'old');
  await r.extractTo(out, { overwrite: true }); assert.equal(fs.readFileSync(path.join(out, 'a.txt'), 'utf8'), 'new'); r.close();
});
test('writer refuses unsafe names', async () => {
  const d = tmp(); const w = new Z.ZipStreamWriter(fs.createWriteStream(path.join(d, 'x.zip')));
  await assert.rejects(w.addBuffer('../x', Buffer.from('a')), (e) => e.code === 'UNSAFE_NAME');
});
