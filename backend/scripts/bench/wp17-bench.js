'use strict';
// WP-17 benchmarks (audit 04 section 6: B3, B4, B10, B12, PERF-011, PERF-013, PERF-014). Offline, one machine, a throwaway workspace,
// the real app booted in this process on an ephemeral loopback port (never 4040/4041), raw node:http keep-alive (fetch quantises to
// 15.6 ms on Windows). Build first (`npx tsc -p .`).
//
//   node scripts/bench/wp17-bench.js [--only csdb,dash,sqlite,jss,validation,large] [--dms 1000] [--folders 60] [--projects 271]
//                                    [--val 200] [--repeat 5] [--out file.json]
//
// Prints one JSON object (environment block + one section per benchmark: median / p95 / max in ms). Numbers are only comparable on the same
// machine, the same Node and a similar background load; the audit's baselines came from a shared host with up to 2x variation.
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const ONLY = new Set(String(opt('only', 'csdb,dash,sqlite,jss,validation,large')).split(',').filter(Boolean));
const N_DMS = Number(opt('dms', 1000)); const FOLDERS = Number(opt('folders', 60)); const PROJECTS = Number(opt('projects', 271));
const N_VAL = Number(opt('val', 200)); const REPEAT = Number(opt('repeat', 5)); const OUT = opt('out', '');

process.env.AGASTYA_WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-wp17-'));
const { boot } = require('../../test/helpers');
const FIX = path.resolve(__dirname, '..', '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');

const now = () => process.hrtime.bigint();
const msSince = (t) => Number(now() - t) / 1e6;
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (v) => Math.round(v * 100) / 100;
  return { n: s.length, median: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]), min: r(s[0]) };
}

(async () => {
  const h = await boot();
  const base = new URL(h.base); const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });
  class C {
    constructor() { this.cookie = ''; }
    req(method, url, body, headers = {}) {
      return new Promise((resolve, reject) => {
        const hd = { ...headers }; if (this.cookie) hd.cookie = this.cookie;
        let payload = null;
        if (body !== undefined) { payload = Buffer.from(JSON.stringify(body)); hd['content-type'] = 'application/json'; hd['content-length'] = payload.length; }
        const r = http.request({ host: base.hostname, port: base.port, path: url, method, headers: hd, agent }, (res) => {
          const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => {
            const set = res.headers['set-cookie']; if (set) this.cookie = String(set[0]).split(';')[0];
            const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
            resolve({ status: res.statusCode, json, bytes: buf.length });
          });
        });
        r.on('error', reject); if (payload) r.write(payload); r.end();
      });
    }
    get(u) { return this.req('GET', u); } post(u, b) { return this.req('POST', u, b ?? {}); } put(u, b) { return this.req('PUT', u, b); }
  }
  async function time(n, fn, warm = 2) { for (let i = 0; i < warm; i++) await fn(i); const xs = []; for (let i = 0; i < n; i++) { const t = now(); await fn(i); xs.push(msSince(t)); } return stats(xs); }
  const must = (r, what, ok = [200, 201]) => { if (!ok.includes(r.status)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`); return r; };

  const out = { node: process.version, platform: `${process.platform} ${os.release()}`, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, load: os.loadavg(), freeMemMB: Math.round(os.freemem() / 1048576), at: new Date().toISOString(), results: {} };

  // accounts: the setup administrator, two authors (a creator and a member-only author)
  const hc = new h.Client('admin'); must(await hc.post('/api/auth/setup', { username: 'admin', password: 'Correct-Horse-9!', fullName: 'A' }), 'setup');
  const admin = new C(); must(await admin.post('/api/auth/login', { username: 'admin', password: 'Correct-Horse-9!' }), 'admin login');
  async function author(name) {
    const m = must(await admin.post('/api/team/users', { username: name, fullName: name, role: 'author' }), 'user');
    const c = new C(); must(await c.post('/api/auth/login', { username: name, password: m.json.tempPassword }), 'login');
    must(await c.post('/api/auth/onboarding', { username: name, password: 'Correct-Horse-9!' }), 'onboarding'); return c;
  }
  const w = await author('perf');
  const s1k = { pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } };

  // a data module template: the 040A descriptive fixture, given unique codes
  const src = fs.readdirSync(FIX).find((f) => f.includes('-040A-D_')); const tpl = fs.readFileSync(path.join(FIX, src), 'utf8');
  function moduleXml(i, pad = '') {
    const attrs = `systemDiffCode="A" systemCode="${String(Math.floor(i / 10000) % 100).padStart(2, '0')}" subSystemCode="${Math.floor(i / 1000) % 10}" subSubSystemCode="${Math.floor(i / 100) % 10}" assyCode="${String(i % 100).padStart(2, '0')}" disassyCode="00" disassyCodeVariant="A"`;
    let xml = tpl.replace(/(<dmCode\s)[^>]*?(infoCode=)/, `$1modelIdentCode="EXAMPLE" ${attrs} $2`).replace(/<techName>[^<]*<\/techName>/, `<techName>Perf module ${i}</techName>`);
    if (pad) xml = xml.replace('</description>', pad + '</description>');
    const code = /<dmIdent>[\s\S]*?<dmCode\s+([^>]*?)\s*\/>/.exec(xml)[1]; const a = Object.fromEntries([...code.matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const dmc = `${a.modelIdentCode}-${a.systemDiffCode}-${a.systemCode}-${a.subSystemCode}${a.subSubSystemCode}-${a.assyCode}-${a.disassyCode}${a.disassyCodeVariant}-${a.infoCode}${a.infoCodeVariant}-${a.itemLocationCode}`;
    return { xml, file: `DMC-${dmc}_001-00_EN-US.XML`, ref: `<dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef>` };
  }
  // a project of n modules through the package import (the real writer path), with a publication that places every module
  async function projectOf(name, n, pad = '') {
    const Z = require('../../dist/services/zipio');
    const pid = must(await w.post('/api/projects', { name, ...s1k }), 'project').json.project.id;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-pkg-')); const zp = path.join(work, 'p.zip'); const zw = new Z.ZipStreamWriter(fs.createWriteStream(zp)); const refs = [];
    for (let i = 1; i <= n; i++) { const m = moduleXml(i, pad); refs.push(m.ref); await zw.addBuffer(`csdb/${m.file}`, Buffer.from(m.xml)); }
    await zw.addBuffer('publication.xml', Buffer.from(`<?xml version="1.0"?><pm><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="EXAMPLE" pmIssuer="00000" pmNumber="00001" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="GB"/><issueInfo issueNumber="001" inWork="00"/></pmIdent><pmAddressItems><issueDate year="2025" month="01" day="01"/><pmTitle>Perf</pmTitle><shortPmTitle>P</shortPmTitle></pmAddressItems></pmAddress><pmStatus><security securityClassification="01"/></pmStatus></identAndStatusSection><content>${refs.map((r, i) => `<pmEntry><pmEntryTitle>M${i + 1}</pmEntryTitle>${r}</pmEntry>`).join('')}</content></pm>`));
    await zw.finish();
    const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(zp)]), 'p.zip'); fd.append('replacePm', '1'); fd.append('skipChecks', '1');
    const hw = new h.Client('perf'); hw.cookie = w.cookie;
    const t = now(); const imp = await hw.req('POST', `/api/projects/${pid}/packages/import`, fd); const importMs = msSince(t);
    fs.rmSync(work, { recursive: true, force: true });
    if (imp.status !== 200) throw new Error(`import: ${imp.status} ${JSON.stringify(imp.json).slice(0, 300)}`);
    return { pid, importMs };
  }

  // ── B3: CSDB scaling (save, create, reads) ──────────────────────────────
  if (ONLY.has('csdb')) {
    const { pid, importMs } = await projectOf('B3', N_DMS); const U = `/api/projects/${pid}`;
    const r = { modules: N_DMS, importMs: Math.round(importMs) };
    const one = moduleXml(1).file;
    let cur = must(await w.get(`${U}/dms/${one}`), 'read').json;
    r.save = await time(20, async (i) => { const xml = cur.xml.replace(/<techName>[^<]*<\/techName>/, `<techName>Perf module 1 v${i}</techName>`); const s = must(await w.put(`${U}/dms/${one}`, { xml, baseHash: cur.hash }), 'save'); cur = { xml, hash: s.json.hash }; });
    let k = N_DMS + 1;
    const creates = []; for (let i = 0; i < 40; i++) { const m = moduleXml(k++); const t = now(); must(await w.post(`${U}/dms`, { file: m.file, xml: m.xml }), 'create'); creates.push(msSince(t)); }
    r.create = stats(creates.slice(2));
    r.read = await time(20, () => w.get(`${U}/dms/${one}`).then((x) => must(x, 'read1')));
    for (const [k2, u] of [['summary', '/summary'], ['release', '/release'], ['dms', '/dms'], ['explore', '/explore'], ['pmc', '/pmc']]) r[k2] = await time(10, () => w.get(`${U}${u}`).then((x) => must(x, k2)));
    r.dmsBytes = (await w.get(`${U}/dms`)).bytes;
    out.results.B3_csdb = r;
  }

  // ── B10: member-only dashboard with folders ─────────────────────────────
  if (ONLY.has('dash')) {
    const creator = await author('creator'); const member = await author('member');
    const ids = []; const t0 = now();
    for (let i = 0; i < PROJECTS; i++) {
      const folder = i < FOLDERS * 2 ? `Folder ${String(i % FOLDERS).padStart(2, '0')}` : undefined;
      ids.push(must(await creator.post('/api/projects', { name: `Dash ${i}`, ...(folder ? { folder } : {}), ...s1k }), 'dash project').json.project.id);
    }
    // the member is on 20 projects, some in folders and some not
    for (let i = 0; i < 20; i++) must(await creator.post(`/api/projects/${ids[i * 7 % PROJECTS]}/assign`, { username: 'member', role: 'editor' }), 'assign');
    const r = { projects: PROJECTS, folders: FOLDERS, seedMs: Math.round(msSince(t0)) };
    r.memberWorkspace = await time(REPEAT * 6, () => member.get('/api/workspace').then((x) => must(x, 'ws')));
    r.memberOverview = await time(REPEAT * 6, () => member.get('/api/overview').then((x) => must(x, 'ov')));
    r.creatorWorkspace = await time(REPEAT * 2, () => creator.get('/api/workspace').then((x) => must(x, 'ws')));
    r.memberProjects = await time(REPEAT * 2, () => member.get('/api/projects').then((x) => must(x, 'pr')));
    r.memberFolders = (await member.get('/api/workspace')).json.folders.length;
    out.results.B10_dashboard = r;
  }

  // ── B12: SQLite autocommit write cost, the app's own handle settings ──────
  if (ONLY.has('sqlite')) {
    const { openSqlite, closeSqlite } = require('../../dist/storage/sqlite');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-db-')); const db = openSqlite(dir);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b TEXT, c INTEGER); CREATE INDEX t_a ON t(a); CREATE INDEX t_c ON t(c);');
    const ins = db.prepare('INSERT INTO t (a, b, c) VALUES (?, ?, ?)'); const xs = [];
    for (let i = 0; i < 520; i++) { const t = now(); ins.run(`k${i}`, 'x'.repeat(200), i); if (i >= 20) xs.push(msSince(t)); }
    const pr = {}; for (const p of ['synchronous', 'busy_timeout', 'cache_size', 'temp_store', 'journal_mode']) pr[p] = Object.values(db.prepare(`PRAGMA ${p}`).get())[0];
    const t = now(); db.prepare('PRAGMA quick_check').all(); const qc = msSince(t);
    closeSqlite(db); fs.rmSync(dir, { recursive: true, force: true });
    out.results.B12_sqlite = { autocommitInsert: stats(xs), pragmas: pr, quickCheckSmallMs: Math.round(qc * 100) / 100 };
  }

  // ── PERF-011: JSS document GET ───────────────────────────────────────────
  if (ONLY.has('jss')) {
    const pid = must(await w.post('/api/projects', { name: 'JSS bench', format: 'jss', domain: 'land', manualType: 'uhb' }), 'jss project').json.project.id;
    const r = {};
    r.get = await time(20, () => w.get(`/api/projects/${pid}/jss`).then((x) => must(x, 'jss get')));
    r.validate = await time(10, () => w.post(`/api/projects/${pid}/jss/validate`, {}).then((x) => must(x, 'jss validate')));
    const g = (await w.get(`/api/projects/${pid}/jss`)).json; r.reportErrors = g.report?.errors; r.reportWarnings = g.report?.warnings;
    out.results.PERF011_jss = r;
  }

  // ── B4 / PERF-013: validation (worker), no BREX and with BREX, cold (fresh) and cached ─────────
  if (ONLY.has('validation')) {
    const { pid } = await projectOf('B4', N_VAL); const U = `/api/projects/${pid}`; const r = { modules: N_VAL };
    const run = async (body) => { const t = now(); const x = must(await w.post(`${U}/validation`, body), 'validation'); return { ms: Math.round(msSince(t)), summary: x.json?.run?.summary ?? x.json?.summary, cached: !!x.json?.cached }; };
    r.noBrexFresh = []; for (let i = 0; i < Math.min(REPEAT, 3); i++) r.noBrexFresh.push(await run({ brex: false, fresh: true }));
    r.brexFresh = []; for (let i = 0; i < Math.min(REPEAT, 3); i++) r.brexFresh.push(await run({ brex: true, fresh: true }));
    // one module changed, then a fresh run (what an author pays after one edit)
    const one = moduleXml(3).file; const cur = must(await w.get(`${U}/dms/${one}`), 'read').json;
    must(await w.put(`${U}/dms/${one}`, { xml: cur.xml.replace(/<techName>[^<]*<\/techName>/, '<techName>Changed</techName>'), baseHash: cur.hash }), 'save');
    r.brexAfterOneEdit = await run({ brex: true, fresh: true });
    r.brexCached = await run({ brex: true });
    // a second project whose modules differ from the first (no kept per-module result applies): the cold cost in a warm worker
    const other = await projectOf('B4b', N_VAL, '<!-- other -->'); const U2 = `/api/projects/${other.pid}`;
    { const t = now(); const x = must(await w.post(`${U2}/validation`, { brex: true, fresh: true }), 'validation'); r.brexColdOtherProject = { ms: Math.round(msSince(t)), summary: x.json?.run?.summary ?? x.json?.summary }; }
    out.results.B4_validation = r;
  }

  // ── PERF-014: one large module, create and save ─────────────────────────
  if (ONLY.has('large')) {
    const pid = must(await w.post('/api/projects', { name: 'Large', ...s1k }), 'project').json.project.id; const U = `/api/projects/${pid}`; const r = {};
    const FILL = '<levelledPara><para>' + 'Filler text for size. '.repeat(40) + '</para></levelledPara>\n';
    for (const mb of [1, 4, 10]) {
      const m = moduleXml(900000 + mb, FILL.repeat(Math.ceil((mb * 1048576) / FILL.length)));
      let t = now(); const c = await w.post(`${U}/dms`, { file: m.file, xml: m.xml }); const createMs = msSince(t);
      let saveMs = null; let saveStatus = null;
      if (c.status === 201) { const cur = must(await w.get(`${U}/dms/${m.file}`), 'read').json; t = now(); const s = await w.put(`${U}/dms/${m.file}`, { xml: cur.xml.replace('Perf module', 'Perf modulf'), baseHash: cur.hash }); saveMs = msSince(t); saveStatus = s.status; }
      r[`${mb}MB`] = { bytes: Buffer.byteLength(m.xml), createStatus: c.status, createCode: c.json?.code, createMs: Math.round(createMs), saveStatus, saveMs: saveMs == null ? null : Math.round(saveMs) };
    }
    out.results.PERF014_large = r;
  }

  const metrics = (await admin.get('/api/admin/metrics')).json; out.serverDb = metrics?.database ?? metrics?.db ?? null;
  out.peakRssMB = Math.round(process.memoryUsage().rss / 1048576);
  const text = JSON.stringify(out, null, 1); console.log(text); if (OUT) fs.writeFileSync(OUT, text);
  agent.destroy(); await h.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
