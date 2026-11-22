'use strict';
// The CLIENT half of scripts/upload-e2e.js, in its own process so the server's memory is measured alone.
//   node scripts/upload-client.js <baseUrl> <cookie> <projectId> <zipFile>   -> prints {status, body} as JSON
// The multipart body is built by hand and streamed from disk with node:http and an exact Content-Length: no FormData, no file-backed Blob (a
// 4.8 GB upload through those stalled at 0.5 GB with both ends idle - a client-side problem, so the client must not depend on them).
const fs = require('fs'); const http = require('http'); const crypto = require('crypto');
const [base, cookie, pid, zip] = process.argv.slice(2);
const boundary = `----agastya${crypto.randomBytes(8).toString('hex')}`;
const field = (name, value) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
const pre = Buffer.concat([field('skipChecks', '1'), Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="package.zip"\r\nContent-Type: application/zip\r\n\r\n`)]);
const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
const size = fs.statSync(zip).size;
const done = (status, body) => { console.log(JSON.stringify({ status, body })); process.exit(0); };
const url = new URL(`${base}/api/projects/${pid}/packages/import`);
const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(pre.length + size + tail.length) } }, (res) => {
  const chunks = []; res.on('data', (c) => chunks.push(c));
  res.on('end', () => { let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ } done(res.statusCode, body); });
});
req.on('error', (e) => done(0, { error: String(e.message), cause: String(e.code ?? '') }));
req.write(pre);
const file = fs.createReadStream(zip, { highWaterMark: 1 << 20 });
file.on('error', (e) => { req.destroy(); done(0, { error: `reading the package: ${e.message}` }); });
file.on('end', () => req.end(tail));
file.pipe(req, { end: false });
