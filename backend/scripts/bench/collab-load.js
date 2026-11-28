'use strict';
// Phase 3 (P3-2) sanity load for live co-editing: one real server (its own process, a throwaway workspace), real sessions, real /ws.
//
//   node backend/scripts/bench/collab-load.js [--clients 120] [--docs 40] [--typists 15] [--seconds 20] [--port 4311]
//                                             [--jss 4] [--jss-clients 3] [--jss-typists 5]   (JSS books, readers in each, typists in one paragraph)
//                                             [--jsg 4] [--jsg-clients 3] [--jsg-typists 5]   (JSG documents: handbooks and parts lists in turn)
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
    if (m === 'stop') {
      try { stop(); } catch { /* already stopped */ }
      // the database closes a moment after stop() on Windows: retry the removal, never fail the run over it
      const rm = (left) => { try { fs.rmSync(ws, { recursive: true, force: true }); process.exit(0); } catch (e) { if (left > 0) setTimeout(() => rm(left - 1), 500); else { console.warn(`could not remove ${ws}: ${e.message}`); process.exit(0); } } };
      setTimeout(() => rm(10), 500);
    }
  });
  return;
}

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
const CLIENTS = arg('clients', 120); const DOCS = arg('docs', 40); const TYPISTS = arg('typists', 15); const SECONDS = arg('seconds', 20); const PORT = arg('port', 4311);
const JSS_BOOKS = arg('jss', 4); const JSS_CLIENTS = arg('jss-clients', 3); const JSS_TYPISTS = arg('jss-typists', 5);
const JSG_DOCS = arg('jsg', 4); const JSG_CLIENTS = arg('jsg-clients', 3); const JSG_TYPISTS = arg('jsg-typists', 5);
const JSG_SAMPLE = (k) => fs.readFileSync(path.resolve(ROOT, 'samples', `jsg-${k}`, 'jsg-document.xml'), 'utf8');
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
  // (a person may hold 8 sockets: the JSS readers and typists count too)
  const JSS_ALL = JSS_BOOKS ? Math.max(JSS_CLIENTS, JSS_TYPISTS + 1) + (JSS_BOOKS - 1) * JSS_CLIENTS : 0;
  const JSG_ALL = JSG_DOCS ? Math.max(JSG_CLIENTS, JSG_TYPISTS + 1) + (JSG_DOCS - 1) * JSG_CLIENTS : 0;
  const ACCOUNTS = Math.max(2, Math.ceil((CLIENTS + JSS_ALL + JSG_ALL) / 8) + 1);
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

  // JSS (the JSS binding, docs/phase3/collab-jss.md): --jss books (one JSS project each, a User Handbook), --jss-clients readers in each,
  // and --jss-typists people typing in the SAME paragraph of the first book at the same time as the S1000D typists
  const jssBooks = [];
  for (let b = 0; b < JSS_BOOKS; b++) {
    const r = await owner.req('POST', '/api/projects', { name: `Collab load JSS ${b}`, format: 'jss', domain: 'land', manualType: 'uhb' });
    if (r.status !== 201) throw new Error(`create JSS project: ${r.status} ${JSON.stringify(r.json)}`);
    const jpid = r.json.project.id;
    for (const u of users.slice(1)) await owner.req('POST', `/api/projects/${jpid}/assign`, { username: u.name, role: 'editor' });
    jssBooks.push(`${jpid}/jss/book`);
  }

  // JSG (docs/phase3/collab-jsg.md): --jsg documents (the sample User Handbook and the sample parts list in turn, the first a handbook),
  // --jsg-clients readers in each, --jsg-typists people typing in the SAME paragraph of the first handbook
  const jsgDocs = [];
  for (let b = 0; b < JSG_DOCS; b++) {
    const kind = b % 2 ? 'ispl' : 'uhb';
    const r = await owner.req('POST', '/api/projects', { name: `Collab load JSG ${b}`, format: 'jsg', domain: 'land', manualType: kind });
    if (r.status !== 201) throw new Error(`create JSG project: ${r.status} ${JSON.stringify(r.json)}`);
    const gpid = r.json.project.id;
    const cur = await owner.req('GET', `/api/projects/${gpid}/jsg`);
    const put = await owner.req('PUT', `/api/projects/${gpid}/jsg`, { xml: JSG_SAMPLE(kind), baseHash: cur.json.hash });
    if (put.status !== 200) throw new Error(`seed JSG project: ${put.status} ${JSON.stringify(put.json)}`);
    for (const u of users.slice(1)) await owner.req('POST', `/api/projects/${gpid}/assign`, { username: u.name, role: 'editor' });
    jsgDocs.push(`${gpid}/jsg/document`);
  }

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
  const jssClients = [];
  for (let b = 0; b < jssBooks.length; b++) {
    const n = b === 0 ? Math.max(JSS_CLIENTS, JSS_TYPISTS + 1) : JSS_CLIENTS;
    for (let i = 0; i < n; i++) {
      const u = users[1 + ((CLIENTS + jssClients.length) % (users.length - 1))];
      const c = new CollabClient(base, u.cookie); await c.open();
      const j = await c.join(jssBooks[b]);
      if (j.error) throw new Error(`join ${jssBooks[b]}: ${JSON.stringify(j.error)}`);
      jssClients.push({ c, name: jssBooks[b] });
    }
  }
  const jsgClients = [];
  for (let b = 0; b < jsgDocs.length; b++) {
    const n = b === 0 ? Math.max(JSG_CLIENTS, JSG_TYPISTS + 1) : JSG_CLIENTS;
    for (let i = 0; i < n; i++) {
      const u = users[1 + ((CLIENTS + jssClients.length + jsgClients.length) % (users.length - 1))];
      const c = new CollabClient(base, u.cookie); await c.open();
      const j = await c.join(jsgDocs[b]);
      if (j.error) throw new Error(`join ${jsgDocs[b]}: ${JSON.stringify(j.error)}`);
      jsgClients.push({ c, name: jsgDocs[b] });
    }
  }
  const joinMs = Date.now() - t0;
  const observer = clients[0].c.room(HOT);
  // the hot JSS book: a paragraph in its first section (the stencil's sections start empty), then an observer and its typists
  const JHOT = jssBooks[0];
  const jssIn = JHOT ? jssClients.filter((x) => x.name === JHOT) : [];
  const jssPara = (doc) => findEl(doc.getXmlFragment('xml'), 'para');
  const jlat = [];
  if (JHOT) {
    const first = jssIn[0].c.room(JHOT).doc;
    const section = findEl(first.getXmlFragment('xml'), 'section');
    first.transact(() => { const p = new Y.XmlElement('para'); p.insert(0, [new Y.XmlText('Load test paragraph.')]); section.insert(1, [p]); });
    for (const { c } of jssIn) await c.settled(JHOT, 15000);
    const jobs = jssIn[0].c.room(JHOT).doc;
    jobs.getMap('bench').observe((ev) => { const now = Date.now(); for (const k of ev.keysChanged) { const v = jobs.getMap('bench').get(k); if (typeof v === 'number') jlat.push(now - v); } });
  }
  // the hot JSG handbook: its first body paragraph (a paragraph of the first section of the first chapter)
  const GHOT = jsgDocs[0];
  const jsgIn = GHOT ? jsgClients.filter((x) => x.name === GHOT) : [];
  const jsgPara = (doc) => findEl(findEl(doc.getXmlFragment('xml'), 'section'), 'para');
  const glat = [];
  if (GHOT) {
    const gobs = jsgIn[0].c.room(GHOT).doc;
    gobs.getMap('bench').observe((ev) => { const now = Date.now(); for (const k of ev.keysChanged) { const v = gobs.getMap('bench').get(k); if (typeof v === 'number') glat.push(now - v); } });
  }
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
  let jtyped = 0;
  const jtimers = jssIn.slice(1, 1 + JSS_TYPISTS).map(({ c }, k) => new Promise((resolve) => {
    const r = c.room(JHOT);
    const tick = () => {
      if (Date.now() >= end) { resolve(); return; }
      const t = firstText(jssPara(r.doc));
      r.doc.transact(() => { t.insert(Math.floor(Math.random() * (t.length + 1)), String.fromCharCode(65 + (k % 26))); r.doc.getMap('bench').set(`j${k}`, Date.now()); });
      jtyped++;
      setTimeout(tick, 100);
    };
    setTimeout(tick, k * 11);
  }));
  timers.push(...jtimers);
  let gtyped = 0;
  const gtimers = jsgIn.slice(1, 1 + JSG_TYPISTS).map(({ c }, k) => new Promise((resolve) => {
    const r = c.room(GHOT);
    const tick = () => {
      if (Date.now() >= end) { resolve(); return; }
      const t = firstText(jsgPara(r.doc));
      r.doc.transact(() => { t.insert(Math.floor(Math.random() * (t.length + 1)), String.fromCharCode(48 + (k % 10))); r.doc.getMap('bench').set(`g${k}`, Date.now()); });
      gtyped++;
      setTimeout(tick, 100);
    };
    setTimeout(tick, k * 13);
  }));
  timers.push(...gtimers);
  // the other clients move their cursors now and then (awareness traffic)
  const others = setInterval(() => { for (const { c, name } of clients.slice(1 + TYPISTS)) if (Math.random() < 0.1) c.setAwareness(name, null); }, 1000);
  await Promise.all(timers);
  clearInterval(others);
  for (const { c, name } of [...clients, ...jssClients, ...jsgClients]) await c.settled(name, 15000);
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
  let jsame = true;
  if (JHOT) {
    const jdocs = jssIn.map((x) => x.c.room(JHOT).doc);
    jsame = jdocs.every((d) => Y.encodeStateVector(d).toString() === Y.encodeStateVector(jdocs[0]).toString() && firstText(jssPara(d)).toString() === firstText(jssPara(jdocs[0])).toString());
    const jfl = await jssIn[1 % jssIn.length].c.flush(JHOT, true);
    jlat.sort((a, b) => a - b);
    const jq = (p) => jlat.length ? jlat[Math.min(jlat.length - 1, Math.floor(p * jlat.length))] : NaN;
    report.jss = { books: jssBooks.length, clients: jssClients.length, typistsInOneParagraph: Math.min(JSS_TYPISTS, jssIn.length - 1), keystrokes: jtyped, observed: jlat.length,
      latencyMs: { p50: jq(0.5), p95: jq(0.95), max: jlat[jlat.length - 1] }, converged: jsame, writtenBack: !!(jfl && jfl.info.hash) };
  }
  let gsame = true;
  if (GHOT) {
    const gdocs = jsgIn.map((x) => x.c.room(GHOT).doc);
    gsame = gdocs.every((d) => Y.encodeStateVector(d).toString() === Y.encodeStateVector(gdocs[0]).toString() && firstText(jsgPara(d)).toString() === firstText(jsgPara(gdocs[0])).toString());
    const gfl = await jsgIn[1 % jsgIn.length].c.flush(GHOT, true);
    glat.sort((a, b) => a - b);
    const gq = (p) => glat.length ? glat[Math.min(glat.length - 1, Math.floor(p * glat.length))] : NaN;
    report.jsg = { docs: jsgDocs.length, clients: jsgClients.length, typistsInOneParagraph: Math.min(JSG_TYPISTS, jsgIn.length - 1), keystrokes: gtyped, observed: glat.length,
      latencyMs: { p50: gq(0.5), p95: gq(0.95), max: glat[glat.length - 1] }, converged: gsame, writtenBack: !!(gfl && gfl.info.hash) };
  }
  console.log(JSON.stringify(report, null, 2));
  for (const { c } of [...clients, ...jssClients, ...jsgClients]) c.close();
  server.send('stop');
  await new Promise((r) => server.once('exit', r));
  process.exit(same && jsame && gsame ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
