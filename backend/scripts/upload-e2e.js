'use strict';
// End-to-end measurement of a LARGE multipart upload through the real HTTP stack and the package importer.
//   node scripts/upload-e2e.js <entryGB> [uploadLimitBytes]
// Builds a package ZIP (one valid data module + one stored entry of <entryGB> GB of non-repeating bytes), POSTs it as multipart to
// /api/projects/:id/packages/import on a throwaway workspace, and prints status, report counts, wall time, peak RSS and whether the big
// file arrived byte-for-byte (SHA-256 of what was sent vs what the project holds). Nothing is claimed unless this prints it.
// Run each case in its own process: the upload limit is read when the server module loads.
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const gb = Number(process.argv[2] ?? 2.1);
// EVERYTHING this script writes (payload, zip, workspace, the server's upload temp folder) lives in one private folder that is removed at the end:
// it never touches the temp folder a real server on this machine uses.
const priv = fs.mkdtempSync(path.join(process.env.UPLOAD_E2E_DIR ?? os.tmpdir(), 'upload-e2e-priv-'));
process.env.TMPDIR = process.env.TEMP = process.env.TMP = priv;
const cleanup = () => { try { fs.rmSync(priv, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* the locked database file can outlive the process; the big files are gone */ } };
if (process.argv[3]) process.env.AGASTYA_MAX_UPLOAD_BYTES = String(process.argv[3]);
const { boot } = require('../test/helpers');
const Z = require('../dist/services/zipio');
const PW = 'Correct-Horse-9!';
const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');

(async () => {
  const base = fs.mkdtempSync(path.join(priv, 'payload-'));
  // non-repeating payload so nothing can be "fast" for the wrong reason: 1 MiB of random bytes written repeatedly with a counter per block
  const big = path.join(base, 'ICN-EXAMPLE-A-000001-A-00001-00001-A-001-01.mp4');
  const total = Math.floor(gb * 1024 ** 3); const hash = crypto.createHash('sha256');
  const fd = fs.openSync(big, 'w'); const rnd = crypto.randomBytes(1024 * 1024); let written = 0; let n = 0;
  while (written < total) { const len = Math.min(rnd.length, total - written); rnd.writeUInt32LE(n++, 0); const b = rnd.subarray(0, len); fs.writeSync(fd, b); hash.update(b); written += len; }
  fs.closeSync(fd); const sentSha = hash.digest('hex');
  const dmFile = fs.readdirSync(FIX).find((f) => f.includes('-040A-D_'));
  const zip = path.join(base, 'package.zip');
  const w = new Z.ZipStreamWriter(fs.createWriteStream(zip));
  await w.addBuffer(dmFile, fs.readFileSync(path.join(FIX, dmFile)));
  await w.addFile(path.basename(big), big, { store: true }); await w.finish();
  const zipBytes = fs.statSync(zip).size;

  const h = await boot();
  let peak = 0; const tick = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);
  const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const made = await admin.post('/api/team/users', { username: 'beth', fullName: 'Beth Bike', role: 'author' });
  const w1 = new h.Client('beth');
  await w1.post('/api/auth/login', { username: 'beth', password: made.json.tempPassword });
  await w1.post('/api/auth/onboarding', { username: 'beth', password: PW });
  const pid = (await w1.post('/api/projects', { name: 'Big upload', pipeline: 's1000dtofo' })).json.project.id;

  // the client runs in ITS OWN process, so peakRssMB below is the server's memory alone
  const t0 = Date.now();
  const child = require('child_process').spawn(process.execPath, [path.join(__dirname, 'upload-client.js'), h.base, w1.cookie, pid, zip], { stdio: ['ignore', 'pipe', 'inherit'] });
  let outText = ''; child.stdout.on('data', (d) => { outText += d; });
  await new Promise((res) => child.on('close', res));
  const ms = Date.now() - t0;
  const lines = outText.trim().split(/\r?\n/);
  const got = JSON.parse(lines[lines.length - 1] || '{"status":0}'); const r = { status: got.status, json: got.body };
  clearInterval(tick);
  const out = { entryGB: gb, uploadLimitBytes: require('../dist/services/uploads').MAX_UPLOAD_BYTES, zipBytes, zip64: zipBytes > 0xffffffff, status: r.status, ms, peakRssMB: Math.round(peak / 1048576) };
  if (r.json) { out.code = r.json.code; out.error = r.json.error ? String(r.json.error).slice(0, 200) : undefined; out.counts = r.json.counts; out.applied = r.json.applied; out.rejected = (r.json.items ?? []).filter((i) => i.status !== 'accepted').slice(0, 3).map((i) => `${i.path}: ${i.status} ${i.message}`.slice(0, 200)); }
  // did the big file arrive byte for byte?
  let landed = null;
  const dir = path.join(h.ws, 'projects', pid);
  const find = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { const f = find(p); if (f) return f; } else if (e.name === path.basename(big)) return p; } return null; };
  const hit = fs.existsSync(dir) ? find(dir) : null;
  if (hit) { const hh = crypto.createHash('sha256'); await new Promise((res, rej) => fs.createReadStream(hit).on('data', (c) => hh.update(c)).on('end', res).on('error', rej)); landed = { size: fs.statSync(hit).size, identical: hh.digest('hex') === sentSha }; }
  out.bigFile = landed ?? 'not in the project';
  await new Promise((res) => setTimeout(res, 1500));   // let the server finish removing the temp file after the response
  out.uploadTempLeft = (() => { const d = path.join(priv, 'agastya-uploads'); return fs.existsSync(d) ? fs.readdirSync(d).length : 0; })();
  console.log(JSON.stringify(out, null, 1));
  await h.close();
  cleanup();
  process.exit(0);
})().catch((e) => { console.error(e); cleanup(); process.exit(1); });
