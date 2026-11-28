'use strict';
// Phase 3 (P3-2) sanity load for live co-editing: one real server (its own process, a throwaway workspace), real sessions, real /ws.
//
//   node backend/scripts/bench/collab-load.js [--clients 120] [--docs 40] [--typists 15] [--seconds 20] [--port 4311]
//
// 120 headless Yjs clients (test/helpers-collab.js, the protocol the page speaks) over 16 accounts join 40 data modules; 15 of them type in
// the SAME paragraph of one module (a character every 100 ms each, the way a person types); one more client in that module observes.
// Each keystroke also stamps its send time in a side map of the same Y transaction, so the observer measures the propagation of exactly
// that update: typist -> server (authorise, merge, log batch) -> observer. Reported: propagation latency p50 / p95 / max, the server
// process's CPU (user + system over the window, as % of one core) and RSS, the room count, and whether every client ended with the same
// document. A sanity check, not a benchmark: run it on an otherwise idle machine. Needs a built backend (cd backend && npx tsc -p .).

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { fork } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

if (process.argv[2] === '--server') {
  // the server process: a throwaway workspace, the real entry point, and its own CPU / memory on request
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-collab-load-'));
  process.env.AGASTYA_WORKSPACE_DIR = ws;
  process.env.AGASTYA_CLIENT_DIST = path.resolve(ROOT, '..', 'frontend', 'dist');
  const { start, stop } = require(path.join(ROOT, 'dist', 'index.js'));
  start(Number(process.argv[3])).then((port) => process.send({ ready: port }), (e) => { console.error(e); process.exit(1); });
  process.on('message', (m) => {
    if (m === 'usage') process.send({ cpu: process.cpuUsage(), mem: process.memoryUsage(), rooms: require(path.join(ROOT, 'dist', 'services', 'collab', 'rooms.js')).inspect().length });
    if (m === 'stop') { try { stop(); } catch { /* */ } setTimeout(() => { fs.rmSync(ws, { recursive: true, force: true }); process.exit(0); }, 500); }
  });
  return;
}

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const CLIENTS = arg('clients', 120); const DOCS = arg('docs', 40); const TYPISTS = arg('typists', 15); const SECONDS = arg('seconds', 20); const PORT = arg('port', 4311);
const PW = 'Correct-Horse-9!';
const SAMPLE = fs.readFileSync(path.resolve(ROOT, '..', 'frontend', 'public', 'samples', 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML'), 'utf8');

async function main() {
  const server = fork(__filename, ['--server', String(PORT)], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...process.env, AGASTYA_NO_WORKSPACE_LOCK: '1' } });
  const ask = (m) => new Promise((r) => { server.once('message', r); server.send(m); });
  const port = await new Promise((r) => server.once('message', (m) => r(m.ready)));
  const base = `http://localhost:${port}`;
  const { CollabClient, findEl, firstText, Y } = require(path.join(ROOT, 'test', 'helpers-collab.js'));

  const jar = () => { let cookie = ''; return { get cookie() { return cookie; }, async req(method, url, body) {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    let json = null; try { json = await res.json(); } catch { /* */ }
    return { status: res.status, json };
  } }; };
  const admin = jar();
  if ((await admin.req('POST', '/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status !== 200) throw new Error('setup failed');
  const ACCOUNTS = Math.max(2, Math.ceil(CLIENTS / 8) + 1);
  const users = [];
  for (let i = 0; i < ACCOUNTS; i++) {
    const name = `load${i}`;
    const made = await admin.req('POST', '/api/team/users', { username: name, fullName: `Load ${i}`, role: 'author' });
    const u = jar(); u.name = name;
    await u.req('POST', '/api/auth/login', { username: name, password: made.json.tempPassword });
    await u.req('POST', '/api/auth/onboarding', { username: name, password: PW });
    users.push(u);
  }
  const owner = users[0];
  const pid = (await owner.req('POST', '/api/projects', { name: 'Collab load' })).json.project.id;
  for (const u of users.slice(1)) await owner.req('POST', `/api/projects/${pid}/assign`, { username: u.name, role: 'editor' });
  const files = [];
  for (let d = 0; d < DOCS; d++) {
    const nn = String(d).padStart(2, '0');
    const file = `DMC-S1KSTUDIO-A-29-10-00-${nn}A-040A-D_001-00_EN-US.XML`;
    const xml = SAMPLE.replace('disassyCode="00"', `disassyCode="${nn}"`);
    const r = await owner.req('POST', `/api/projects/${pid}/dms`, { file, xml });
    if (r.status !== 201) throw new Error(`create ${file}: ${r.status} ${JSON.stringify(r.json)}`);
    files.push(file);
  }
  const room = (i) => `${pid}/dm/${files[i]}`;
  const HOT = room(0);

  // the clients: the typists and the observer in the hot module, the rest spread over all modules
  const clients = [];
  const t0 = Date.now();
  for (let i = 0; i < CLIENTS; i++) {
    const u = users[1 + (i % (users.length - 1))];
    const c = new CollabClient(base, u.cookie); await c.open();
    const name = i <= TYPISTS ? HOT : room(i % DOCS);
    const j = await c.join(name);
    if (j.error) throw new Error(`join ${name}: ${JSON.stringify(j.error)}`);
    clients.push({ c, name });
  }
  const joinMs = Date.now() - t0;
  const observer = clients[0].c.room(HOT);
  const lat = [];
  observer.doc.getMap('bench').observe((ev) => { const now = Date.now(); for (const k of ev.keysChanged) { const v = observer.doc.getMap('bench').get(k); if (typeof v === 'number') lat.push(now - v); } });

  const before = await ask('usage');
  const typists = clients.slice(1, 1 + TYPISTS);
  let typed = 0;
  const end = Date.now() + SECONDS * 1000;
  const timers = typists.map(({ c }, k) => new Promise((resolve) => {
    const r = c.room(HOT);
    const tick = () => {
      if (Date.now() >= end) { resolve(); return; }
      const t = firstText(findEl(r.doc.getXmlFragment('xml'), 'para'));
      r.doc.transact(() => { t.insert(Math.floor(Math.random() * (t.length + 1)), String.fromCharCode(97 + (k % 26))); r.doc.getMap('bench').set(`t${k}`, Date.now()); });
      typed++;
      setTimeout(tick, 100);
    };
    setTimeout(tick, k * 7);
  }));
  // the other clients move their cursors now and then (awareness traffic)
  const others = setInterval(() => { for (const { c, name } of clients.slice(1 + TYPISTS)) if (Math.random() < 0.1) c.setAwareness(name, null); }, 1000);
  await Promise.all(timers);
  clearInterval(others);
  for (const { c, name } of clients) await c.settled(name, 15000);
  await new Promise((r) => setTimeout(r, 1500));
  const after = await ask('usage');

  const hot = clients.filter((x) => x.name === HOT).map((x) => x.c.room(HOT).doc);
  const same = hot.every((d) => Y.encodeStateVector(d).toString() === Y.encodeStateVector(hot[0]).toString() && firstText(findEl(d.getXmlFragment('xml'), 'para')).toString() === firstText(findEl(hot[0].getXmlFragment('xml'), 'para')).toString());
  const fl = await clients[1].c.flush(HOT, true);
  lat.sort((a, b) => a - b);
  const q = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : NaN;
  const cpuUs = (after.cpu.user - before.cpu.user) + (after.cpu.system - before.cpu.system);
  const windowMs = SECONDS * 1000 + 1500;
  const report = {
    clients: CLIENTS, accounts: ACCOUNTS, docs: DOCS, typistsInOneDoc: TYPISTS, seconds: SECONDS, joinAllMs: joinMs,
    keystrokes: typed, observed: lat.length,
    latencyMs: { p50: q(0.5), p95: q(0.95), max: lat[lat.length - 1] },
    serverCpuPercentOfOneCore: Math.round((cpuUs / 1000 / windowMs) * 1000) / 10,
    serverRssMb: Math.round(after.mem.rss / 1048576), serverHeapMb: Math.round(after.mem.heapUsed / 1048576),
    roomsLoaded: after.rooms, converged: same, writtenBack: !!(fl && fl.info.hash),
  };
  console.log(JSON.stringify(report, null, 2));
  for (const { c } of clients) c.close();
  server.send('stop');
  await new Promise((r) => server.once('exit', r));
  process.exit(same ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
