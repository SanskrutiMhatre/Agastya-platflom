'use strict';
// WP-18 (audit FE-027, PERF-016, FE-029): what the server sends and how fast it can say it.
//  * API answers of 1 KB or more are gzip-compressed for a client that accepts it; small ones and clients that do not are sent as they are.
//  * The built client: hashed assets are immutable for a year, index.html and the SPA fallback are no-cache, text files go out br/gzip,
//    a conditional request gets 304, a Range request gets the plain file.
//  * /api/projects and /dms page only when asked (?limit/offset/q, fields=list); without the parameters the answer is exactly the old one.
//  * The per-file memo behind /dms, /summary and /brex/missing sees a change on disk at once, even one that keeps the file's size.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const http = require('node:http'); const zlib = require('node:zlib');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');

// a built client of our own, so the test does not depend on (or touch) frontend/dist
const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-wp18-dist-'));
const BIG_JS = `export const a = ${JSON.stringify('x'.repeat(4000))};\n`.repeat(4);
fs.mkdirSync(path.join(DIST, 'assets'));
fs.writeFileSync(path.join(DIST, 'index.html'), `<!doctype html><html><head><script type="module" src="/assets/index-AbCd12_x.js"></script></head><body>${'<!-- pad -->'.repeat(200)}</body></html>`);
fs.writeFileSync(path.join(DIST, 'assets', 'index-AbCd12_x.js'), BIG_JS);
fs.writeFileSync(path.join(DIST, 'assets', 'tiny-ZyXw9876.js'), 'export {};\n');
fs.writeFileSync(path.join(DIST, 'assets', 'Roboto-Medium-Qw12Er34.ttf'), Buffer.alloc(5000, 7));
fs.writeFileSync(path.join(DIST, 'theme-init.js'), `/* not hashed */\n${'void 0;\n'.repeat(300)}`);
process.env.AGASTYA_CLIENT_DIST = DIST;

function raw(base, url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(base + url, { method, headers }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject); req.end();
  });
}
const decode = (r) => (r.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(r.body) : r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.body) : r.body);

test('WP-18 delivery: compression, caching headers, opt-in paging and a fresh memo', { timeout: 600000 }, async (t) => {
  const h = await boot();
  try {
    const admin = new h.Client('admin');
    await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
    const made = await admin.post('/api/team/users', { username: 'auth', fullName: 'Au Thor', role: 'author' });
    const w = new h.Client('auth');
    await w.post('/api/auth/login', { username: 'auth', password: made.json.tempPassword });
    await w.post('/api/auth/onboarding', { username: 'auth', password: PW });
    const mk = async (name) => (await w.post('/api/projects', { name, pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } })).json.project.id;
    const pid = await mk('Paging one');
    for (let i = 0; i < 6; i++) await mk(`Other ${i}`);
    const csdb = path.join(h.ws, 'projects', pid, 'csdb'); fs.mkdirSync(csdb, { recursive: true });
    const fixtures = fs.readdirSync(FIX).filter((f) => /^DMC-.*\.XML$/i.test(f));
    for (const f of fixtures) fs.copyFileSync(path.join(FIX, f), path.join(csdb, f));
    const auth = { cookie: w.cookie };

    await t.test('API JSON of 1 KB or more is gzip for a client that accepts it, and the same JSON otherwise', async () => {
      const plain = await raw(h.base, `/api/projects/${pid}/dms`, { ...auth, 'accept-encoding': 'identity' });
      assert.equal(plain.status, 200);
      assert.equal(plain.headers['content-encoding'], undefined);
      const gz = await raw(h.base, `/api/projects/${pid}/dms`, { ...auth, 'accept-encoding': 'gzip, deflate, br' });
      assert.equal(gz.status, 200);
      assert.equal(gz.headers['content-encoding'], 'gzip');
      assert.match(String(gz.headers.vary), /Accept-Encoding/i);
      assert.match(String(gz.headers['content-type']), /^application\/json; charset=utf-8/);
      assert.deepEqual(JSON.parse(decode(gz).toString('utf8')), JSON.parse(plain.body.toString('utf8')));
      assert.ok(gz.body.length * 4 < plain.body.length, `compressed ${gz.body.length} B against ${plain.body.length} B`);
      // a conditional request on the compressed answer is still answered 304
      const again = await raw(h.base, `/api/projects/${pid}/dms`, { ...auth, 'accept-encoding': 'gzip', 'if-none-match': gz.headers.etag });
      assert.equal(again.status, 304);
      // a small answer is not compressed
      const small = await raw(h.base, '/api/health', { 'accept-encoding': 'gzip' });
      assert.equal(small.headers['content-encoding'], undefined);
    });

    await t.test('hashed assets are immutable and compressed; index.html and the SPA fallback are no-cache', async () => {
      const js = await raw(h.base, '/assets/index-AbCd12_x.js', { 'accept-encoding': 'gzip, deflate, br' });
      assert.equal(js.status, 200);
      assert.equal(js.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.equal(js.headers['content-encoding'], 'br');
      assert.match(String(js.headers['content-type']), /javascript/);
      assert.equal(decode(js).toString('utf8'), BIG_JS);
      assert.ok(Number(js.headers['content-length']) < BIG_JS.length / 10);
      // the CSP of the application still applies to its files
      assert.match(String(js.headers['content-security-policy']), /default-src 'self'/);

      const gz = await raw(h.base, '/assets/index-AbCd12_x.js', { 'accept-encoding': 'gzip' });
      assert.equal(gz.headers['content-encoding'], 'gzip');
      assert.equal(decode(gz).toString('utf8'), BIG_JS);

      const cond = await raw(h.base, '/assets/index-AbCd12_x.js', { 'accept-encoding': 'br', 'if-none-match': js.headers.etag });
      assert.equal(cond.status, 304);
      assert.equal(cond.body.length, 0);

      const head = await raw(h.base, '/assets/index-AbCd12_x.js', { 'accept-encoding': 'br' }, 'HEAD');
      assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(head.headers['content-encoding'], 'br');

      const ranged = await raw(h.base, '/assets/index-AbCd12_x.js', { 'accept-encoding': 'br', range: 'bytes=0-9' });
      assert.equal(ranged.status, 206); assert.equal(ranged.headers['content-encoding'], undefined); assert.equal(ranged.body.toString(), BIG_JS.slice(0, 10));

      const ident = await raw(h.base, '/assets/index-AbCd12_x.js', { 'accept-encoding': 'identity' });
      assert.equal(ident.headers['content-encoding'], undefined);
      assert.equal(ident.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.equal(ident.body.toString('utf8'), BIG_JS);

      const tiny = await raw(h.base, '/assets/tiny-ZyXw9876.js', { 'accept-encoding': 'br' });
      assert.equal(tiny.headers['content-encoding'], undefined);
      assert.equal(tiny.headers['cache-control'], 'public, max-age=31536000, immutable');

      const font = await raw(h.base, '/assets/Roboto-Medium-Qw12Er34.ttf', { 'accept-encoding': 'br' });
      assert.equal(font.headers['content-encoding'], undefined, 'a binary font is not recompressed');
      assert.equal(font.headers['cache-control'], 'public, max-age=31536000, immutable');

      const notHashed = await raw(h.base, '/theme-init.js', { 'accept-encoding': 'br' });
      assert.equal(notHashed.status, 200);
      assert.notEqual(notHashed.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.match(String(notHashed.headers['cache-control']), /max-age=0/);

      for (const u of ['/index.html', '/', '/projects/some/route']) {
        const r = await raw(h.base, u, { 'accept-encoding': 'br' });
        assert.equal(r.status, 200, u);
        assert.equal(r.headers['cache-control'], 'no-cache', u);
        assert.match(decode(r).toString('utf8'), /<!doctype html>/, u);
      }
      const escape = await raw(h.base, '/assets/..%2f..%2fpackage.json', { 'accept-encoding': 'br' });
      assert.notEqual(escape.headers['content-encoding'], 'br');
      assert.doesNotMatch(decode(escape).toString('utf8'), /"agastya-platform-v2-backend"/);
    });

    await t.test('one copy of the schemas: the Studio reads the server\'s own sets at /schemas/<issue>/', async () => {
      const SCHEMAS = path.resolve(__dirname, '..', 'schemas');
      const PUBLIC = path.resolve(__dirname, '..', '..', 'frontend', 'public', 'schemas');
      for (const [web, dir] of Object.entries({ '4-2': '4.2', '5-0': '5.0', '6': '6.0', '7': '7.0' })) {
        assert.ok(!fs.existsSync(path.join(PUBLIC, web)), `frontend/public/schemas/${web} is back: the browser and the server would validate against different copies`);
        for (const f of ['descript.xsd', 'proced.xsd', 'xlink.xsd', 'xml.xsd']) {
          const r = await raw(h.base, `/schemas/${web}/${f}`, { 'accept-encoding': 'br' });
          assert.equal(r.status, 200, `${web}/${f}`);
          assert.equal(r.headers['content-encoding'], 'br');
          assert.ok(decode(r).equals(fs.readFileSync(path.join(SCHEMAS, dir, f))), `${web}/${f} is the server's file`);
          assert.notEqual(r.headers['cache-control'], 'public, max-age=31536000, immutable');
        }
      }
      // only the issue folders are reachable, nothing beside them
      const prov = await raw(h.base, '/schemas/4-2/../PROVENANCE.md');
      assert.doesNotMatch(decode(prov).toString('utf8'), /S1000D XSD schema sets/);
      const jss = await raw(h.base, '/schemas/4-2/%2e%2e/jss/jss-1.0.xsd');
      assert.doesNotMatch(decode(jss).toString('utf8'), /targetNamespace|<xs:schema/);
      // the folders that stay with the client are still the client's
      assert.ok(fs.existsSync(path.join(PUBLIC, '4-1', 'descript.xsd')) && fs.existsSync(path.join(PUBLIC, 'ent', 'ISOEntities')));
    });

    await t.test('/api/projects pages only when asked', async () => {
      const all = await w.get('/api/projects');
      assert.equal(all.status, 200);
      assert.deepEqual(Object.keys(all.json), ['projects'], 'no paging fields without the parameters');
      assert.equal(all.json.projects.length, 7);
      const p1 = await w.get('/api/projects?limit=3');
      assert.deepEqual(p1.json.projects.map((p) => p.id), all.json.projects.slice(0, 3).map((p) => p.id));
      assert.equal(p1.json.total, 7); assert.equal(p1.json.offset, 0); assert.equal(p1.json.limit, 3); assert.equal(p1.json.nextOffset, 3);
      const p3 = await w.get('/api/projects?limit=3&offset=6');
      assert.equal(p3.json.projects.length, 1); assert.equal(p3.json.nextOffset, null);
      const q = await w.get('/api/projects?q=paging&limit=10');
      assert.deepEqual(q.json.projects.map((p) => p.id), [pid]); assert.equal(q.json.total, 1);
      for (const bad of ['limit=0', 'limit=abc', 'limit=1001', 'offset=-1']) {
        const r = await w.get(`/api/projects?${bad}`);
        assert.equal(r.status, 400, bad); assert.equal(r.json.code, 'BAD_PAGE');
      }
    });

    await t.test('/dms pages, filters and slims only when asked', async () => {
      const all = await w.get(`/api/projects/${pid}/dms`);
      assert.deepEqual(Object.keys(all.json), ['dms']);
      assert.equal(all.json.dms.length, fixtures.length);
      assert.ok(all.json.dms[0].dmCodeAttrs && all.json.dms[0].issueInfoAttrs, 'the full row by default');
      const pg = await w.get(`/api/projects/${pid}/dms?limit=5&offset=5`);
      assert.deepEqual(pg.json.dms, all.json.dms.slice(5, 10));
      assert.equal(pg.json.total, fixtures.length); assert.equal(pg.json.nextOffset, 10);
      const slim = await w.get(`/api/projects/${pid}/dms?fields=list&limit=50`);
      assert.equal(slim.json.dms.length, fixtures.length);
      assert.equal(slim.json.dms[0].dmCodeAttrs, undefined);
      assert.equal(slim.json.dms[0].file, all.json.dms[0].file);
      assert.equal(slim.json.dms[0].title, all.json.dms[0].title);
      assert.equal(typeof slim.json.dms[0].locked, 'boolean');
      const target = all.json.dms[3];
      const q = await w.get(`/api/projects/${pid}/dms?q=${encodeURIComponent(target.file.toLowerCase())}`);
      assert.deepEqual(q.json.dms.map((d) => d.file), [target.file]);
    });

    await t.test('the per-file memo sees a change on disk at once, even one that keeps the size', async () => {
      const before = (await w.get(`/api/projects/${pid}/dms`)).json.dms;
      const d = before.find((x) => x.techName && x.techName.length >= 4);
      assert.ok(d, 'a module with a title');
      const file = path.join(csdb, d.file);
      const xml = fs.readFileSync(file, 'utf8');
      const swapped = d.techName.split('').reverse().join('') === d.techName ? 'Q'.repeat(d.techName.length) : d.techName.split('').reverse().join('');
      const changed = xml.replace(`<techName>${d.techName}</techName>`, `<techName>${swapped}</techName>`);
      assert.notEqual(changed, xml); assert.equal(Buffer.byteLength(changed), Buffer.byteLength(xml));
      fs.writeFileSync(file, changed);
      const after = (await w.get(`/api/projects/${pid}/dms`)).json.dms.find((x) => x.file === d.file);
      assert.equal(after.techName, swapped);
      // the BREX check reads the module again too: point it at a BREX the project does not hold
      const brexBefore = (await w.get(`/api/projects/${pid}/brex/missing`)).json.missing;
      const withBrex = changed.replace(/(<brexDmRef>[\s\S]*?modelIdentCode=")[^"]+(")/, '$1NOSUCHMODEL$2');
      if (withBrex !== changed) {
        fs.writeFileSync(file, withBrex);
        const brexAfter = (await w.get(`/api/projects/${pid}/brex/missing`)).json.missing;
        assert.ok(brexAfter.some((m) => m.includes('NOSUCHMODEL')), JSON.stringify(brexAfter));
        assert.ok(!brexBefore.some((m) => m.includes('NOSUCHMODEL')));
      }
      // the summary counts a module added on disk at once
      const s1 = (await w.get(`/api/projects/${pid}/summary`)).json.dataModules.total;
      fs.writeFileSync(path.join(csdb, d.file.replace(/^DMC-EXAMPLE-A-/, 'DMC-EXAMPLE-A-9')), changed.replace(/systemCode="(\d+)"/, 'systemCode="9$1"'));
      const s2 = (await w.get(`/api/projects/${pid}/summary`)).json.dataModules.total;
      assert.equal(s2, s1 + 1);
    });
  } finally {
    await h.close();
    fs.rmSync(DIST, { recursive: true, force: true });
  }
});
