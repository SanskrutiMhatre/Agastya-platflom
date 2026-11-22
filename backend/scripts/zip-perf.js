'use strict';
// Measures the ZIP64 reader/writer on large inputs. Usage: node scripts/zip-perf.js [sizeGB=2.1] [dir]
// Writes a sparse file of that size (stored, so the ZIP is as large), zips it, validates with `python3 -m zipfile -t`, reads it back
// through the streaming reader (CRC-checked) and reports the wall time and peak RSS. Nothing is claimed unless this prints it.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const Z = require('../dist/services/zipio');
(async () => {
  const gb = Number(process.argv[2] ?? 2.1); const base = fs.mkdtempSync(path.join(process.argv[3] ?? os.tmpdir(), 'zipperf-'));
  const big = path.join(base, 'big.bin'); const fd = fs.openSync(big, 'w'); fs.ftruncateSync(fd, Math.floor(gb * 1024 ** 3)); fs.writeSync(fd, Buffer.from('AGASTYA'), 0, 7, 0); fs.closeSync(fd);
  const zip = path.join(base, 'big.zip'); let t = Date.now(); let peak = 0; const tick = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 200);
  const w = new Z.ZipStreamWriter(fs.createWriteStream(zip));
  await w.addFile('big.bin', big, { store: true }); await w.addBuffer('note.txt', Buffer.from('after the big one')); await w.finish();
  const tw = Date.now() - t; t = Date.now();
  const r = Z.ZipFileReader.open(zip, { ...Z.DEFAULT_LIMITS, maxEntryBytes: 16 * 1024 ** 3, maxTotalBytes: 32 * 1024 ** 3 });
  let n = 0; await new Promise((res, rej) => r.open(r.entries[0]).on('data', (c) => { n += c.length; }).on('end', res).on('error', rej));
  const note = (await r.readBuffer(r.entries[1])).toString(); r.close(); const tr = Date.now() - t;
  clearInterval(tick);
  let py = 'ok'; try { execFileSync('python3', ['-m', 'zipfile', '-t', zip], { stdio: 'pipe', timeout: 600000 }); } catch (e) { py = 'FAILED ' + e.stderr; }
  console.log(JSON.stringify({ sizeBytes: n, zipBytes: fs.statSync(zip).size, entries: r.entries.length, zip64: fs.statSync(zip).size > 0xffffffff, writeMs: tw, readMs: tr, peakRssMB: Math.round(peak / 1048576), noteOk: note === 'after the big one', pythonZipfile: py }));
  fs.rmSync(base, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
