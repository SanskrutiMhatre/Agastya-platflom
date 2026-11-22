'use strict';
// Large uploads need a request timeout longer than Node's 5-minute default (a 4.8 GB ZIP64 upload was cut with HTTP 408 at 329 s, Phase 18),
// and the temp files of aborted uploads must not pile up.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
const U = () => require('../dist/services/uploads');

test('tuneServer lifts the 5-minute request timeout to a bounded, configurable value and the 5-second keep-alive to 65 s (headers timeout stays above it)', () => {
  const s = http.createServer(); assert.equal(s.keepAliveTimeout, 5000, 'Node default being replaced');
  assert.equal(s.requestTimeout, 300_000, 'Node default being replaced');
  U().tuneServer(s);
  assert.equal(s.requestTimeout, U().REQUEST_TIMEOUT_MS);
  assert.ok(U().REQUEST_TIMEOUT_MS >= 3600_000 && Number.isFinite(U().REQUEST_TIMEOUT_MS) && U().REQUEST_TIMEOUT_MS > 0, 'long, but never unbounded');
  assert.equal(s.keepAliveTimeout, U().KEEP_ALIVE_MS); assert.ok(s.headersTimeout > s.keepAliveTimeout, 'headersTimeout must exceed keepAliveTimeout');
});

test('sweepStaleUploads removes only old .upload files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
  const mk = (n, ageMs) => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); const t = new Date(Date.now() - ageMs); fs.utimesSync(p, t, t); return p; };
  const old = mk('old.upload', U().REQUEST_TIMEOUT_MS + 2 * 3600_000); const fresh = mk('fresh.upload', 1000); const other = mk('keep.txt', U().REQUEST_TIMEOUT_MS + 2 * 3600_000);
  assert.equal(U().sweepStaleUploads(Date.now(), dir), 1);
  assert.equal(fs.existsSync(old), false); assert.equal(fs.existsSync(fresh), true); assert.equal(fs.existsSync(other), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an empty or invalid environment value falls back to the default (never 0 or NaN)', () => {
  const { envPositive } = U();
  for (const bad of ['', '  ', 'abc', '0', '-5', 'NaN', 'Infinity']) { process.env.AGASTYA_T = bad; assert.equal(envPositive('AGASTYA_T', 42), 42, JSON.stringify(bad)); }
  process.env.AGASTYA_T = '7'; assert.equal(envPositive('AGASTYA_T', 42), 7);
  delete process.env.AGASTYA_T; assert.equal(envPositive('AGASTYA_T', 42), 42);
});

test('a full disk is answered with 507 DISK_FULL and a plain message, not an opaque 500', async () => {
  const express = require('express'); const { wrap } = require('../dist/services/http');
  const app = express(); app.get('/full', wrap(() => { const e = new Error('ENOSPC: no space left on device, write'); e.code = 'ENOSPC'; throw e; }));
  app.get('/other', wrap(() => { throw new Error('boom'); }));
  const s = http.createServer(app); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${s.address().port}`;
  const full = await fetch(`${base}/full`); const body = await full.json();
  assert.equal(full.status, 507); assert.equal(body.code, 'DISK_FULL'); assert.match(body.error, /run out of disk space/);
  assert.equal((await fetch(`${base}/other`)).status, 500, 'other failures stay 500');
  await new Promise((r) => s.close(r));
});
