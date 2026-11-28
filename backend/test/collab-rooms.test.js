'use strict';
// Phase 3 (P3-1, P3-2): live co-editing over the platform's /ws socket (services/collab/rooms.ts, shared/collab/protocol.ts).
// Two editors merge in one paragraph; the merged XML reaches the project file (atomic write, then a revision); a reviewer joins read-only,
// sees changes live and may publish presence but not changes; a check-out makes the room read-only for everyone but its holder and is
// given back live; an external change to the file (a save by version) reaches the room as a minimal merge that keeps unwritten edits;
// the update log survives a stop and is replayed; size, room-name and access limits hold; a pinned comment keeps a live anchor.

process.env.AGASTYA_COLLAB_WRITEBACK_MS = '1500';
process.env.AGASTYA_COLLAB_PERSIST_MS = '20';
process.env.AGASTYA_COLLAB_MAX_UPDATE_BYTES = '65536';
process.env.AGASTYA_COLLAB_IDLE_MS = '1000';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./helpers');
const { CollabClient, textOf, findEl, firstText, until, Y } = require('./helpers-collab');

const PW = 'Correct-Horse-9!';
const DM = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const DM2 = 'DMC-S1KSTUDIO-A-29-10-00-00A-520A-A_001-00_EN-US.XML';
let h; let admin; let alice; let bob; let rita; let vic; let eve; let pid; let rooms; let proto;
const open = [];

async function person(username) {
  const made = await admin.post('/api/team/users', { username, fullName: `${username} Example`, role: 'author' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username); c.id = made.json.user.id;
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}
async function client(who) { const c = new CollabClient(h.base, who.cookie); await c.open(); open.push(c); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roomOf = (file) => `${pid}/dm/${file}`;
const fileXml = async (file = DM) => (await alice.get(`/api/projects/${pid}/dms/${file}`)).json;
/** the first paragraph-like text of a room's document */
const paraText = (r) => { const p = findEl(r.doc.getXmlFragment('xml'), 'para'); return p ? firstText(p) : null; };

test.before(async () => {
  h = await boot({ ws: true });
  rooms = require('../dist/services/collab/rooms');
  proto = require('../dist/shared/collab/protocol');
  rooms.start();
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  alice = await person('alicecol'); bob = await person('bobcol'); rita = await person('ritacol'); vic = await person('viccol'); eve = await person('evecol');
  pid = (await alice.post('/api/projects', { name: 'Live editing' })).json.project.id;
  assert.equal((await alice.post(`/api/projects/${pid}/dms`, { file: DM, xml: h.sample(DM) })).status, 201);
  assert.equal((await alice.post(`/api/projects/${pid}/dms`, { file: DM2, xml: h.sample(DM2) })).status, 201);
  assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'bobcol', role: 'editor' })).status, 200);
  assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'ritacol', role: 'reviewer' })).status, 200);
  assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'viccol', role: 'viewer' })).status, 200);
});
test.after(async () => { for (const c of open) c.close(); try { await rooms.stop(); } catch { /* */ } if (h) await h.close(); });

test('room names: project / kind / file; a path outside the project, a backslash or an unknown kind is not a room', () => {
  assert.deepEqual(proto.parseRoom(`${'p1'}/dm/${DM}`), { projectId: 'p1', kind: 'dm', docPath: DM });
  for (const bad of ['p1/dm/../x.xml', 'p1/dm//etc', 'p1/dm/a\\b.xml', 'p1/xx/a.xml', '/dm/a.xml', 'p1/dm/']) assert.equal(proto.parseRoom(bad), null, bad);
});

test('two editors in one paragraph: both changes merge, are acknowledged once stored, and reach the project file in the Studio form', async () => {
  const a = await client(alice); const b = await client(bob);
  const ja = await a.join(roomOf(DM)); const jb = await b.join(roomOf(DM));
  assert.ok(!ja.error && !jb.error, JSON.stringify(ja.error || jb.error));
  assert.equal(ja.room.state.writable, true); assert.equal(jb.room.state.writable, true);
  assert.equal(ja.room.state.epoch, jb.room.state.epoch, 'one room, one epoch');
  const before = textOf(ja.room.doc.getXmlFragment('xml'));
  assert.equal(before, textOf(jb.room.doc.getXmlFragment('xml')), 'both start from the file');
  const ta = paraText(ja.room); const tb = paraText(jb.room);
  assert.ok(ta && tb, 'the module has a paragraph');
  const original = ta.toString();
  // at the same moment: alice at the start, bob at the end of the same paragraph
  ta.insert(0, 'ALPHA ');
  tb.insert(tb.length, ' OMEGA');
  assert.ok(await until(() => paraText(ja.room).toString().includes('OMEGA') && paraText(jb.room).toString().includes('ALPHA')), 'each sees the other');
  assert.equal(paraText(ja.room).toString(), paraText(jb.room).toString(), 'the same merged text on both');
  assert.equal(paraText(ja.room).toString(), `ALPHA ${original} OMEGA`);
  assert.ok(await a.settled(roomOf(DM)) && await b.settled(roomOf(DM)), 'every change acknowledged');
  // Save = FLUSH with a revision: the file has the merged text, and the history a "collab" revision
  const fl = await a.flush(roomOf(DM), true);
  assert.ok(fl && fl.info.hash, 'FLUSHED with the file hash');
  const file = await fileXml();
  assert.match(file.xml, /ALPHA /); assert.match(file.xml, / OMEGA/);
  assert.equal(file.hash, fl.info.hash, 'the hash the room reports is the file\'s');
  const hist = (await alice.get(`/api/projects/${pid}/dms/${DM}/history`)).json.revisions;
  assert.equal(hist[0].reason, 'collab', 'the newest revision is the live one');
  assert.ok(!hist.some((r) => r.reason === 'on-disk' && Date.parse(r.at) > Date.now() - 60_000), 'the room\'s own writes are not recorded as on-disk changes');
  // the write is in the Studio's form: re-reading and re-writing it changes nothing
  const { serializeY, yFromText } = require('../dist/services/collab/xml');
  assert.equal(serializeY(yFromText(file.xml)), file.xml, 'stable round trip');
  const rows = (await admin.get('/api/admin/audit?action=collab.')).json.entries;
  assert.ok(rows.some((e) => e.action === 'collab.revision'), 'the revision is audited');
  a.close(); b.close();
});

test('a reviewer joins read-only, sees changes live, may publish presence; their changes are refused by the server', async () => {
  const a = await client(alice); const r = await client(rita); const v = await client(vic);
  await a.join(roomOf(DM));
  const jr = await r.join(roomOf(DM)); const jv = await v.join(roomOf(DM));
  assert.equal(jr.room.state.writable, false); assert.equal(jr.room.state.code, 'ROLE'); assert.equal(jr.room.state.canComment, true);
  assert.equal(jv.room.state.writable, false); assert.equal(jv.room.state.canComment, false, 'a viewer cannot comment');
  paraText(a.room(roomOf(DM))).insert(0, 'LIVE ');
  assert.ok(await until(() => paraText(jr.room).toString().startsWith('LIVE ')), 'the reviewer sees it without a refresh');
  // the reviewer's page tries to change the document anyway: refused, and nobody else sees it
  paraText(jr.room).insert(0, 'HACK ');
  const err = await r.waitFor((m) => m.type === proto.MSG.ERROR && m.error.code === 'READ_ONLY', 3000);
  assert.ok(err, 'READ_ONLY');
  await sleep(300);
  assert.ok(!paraText(a.room(roomOf(DM))).toString().includes('HACK'), 'the editor never received it');
  // presence: the reviewer's cursor reaches the editor; another person's identity is refused
  r.setAwareness(roomOf(DM), { user: { id: rita.id, name: 'Rita', color: '#123456' }, cursor: null, mode: 'viewing' });
  assert.ok(await until(() => [...a.room(roomOf(DM)).awareness.getStates().values()].some((s) => s.user && s.user.id === rita.id)), 'the editor sees the reviewer');
  v.setAwareness(roomOf(DM), { user: { id: alice.id, name: 'Alice', color: '#000000' }, cursor: null });
  await sleep(300);
  assert.ok(![...a.room(roomOf(DM)).awareness.getStates().values()].some((s) => s.user && s.user.name === 'Alice' && s.user.id === alice.id && s !== a.room(roomOf(DM)).awareness.getLocalState()), 'a spoofed identity is not relayed');
  a.close(); r.close(); v.close();
});

test('a person who may not read the project learns nothing: NOT_FOUND, as the HTTP API answers', async () => {
  const e = await client(eve);
  const j = await e.join(roomOf(DM));
  assert.equal(j.error && j.error.code, 'NOT_FOUND');
  const j2 = await e.join(`${pid}/dm/DMC-NOPE-A-00-00-00-00A-000A-A_001-00_EN-US.XML`);
  assert.equal(j2.error && j2.error.code, 'NOT_FOUND');
  e.close();
});

test('check-out is an optional lock: others become read-only at once ("Locked by"), the holder keeps writing, check-in frees it live', async () => {
  const a = await client(alice); const b = await client(bob);
  await a.join(roomOf(DM)); const jb = await b.join(roomOf(DM));
  assert.equal(jb.room.state.writable, true, 'no lease needed by default');
  assert.equal((await alice.post(`/api/projects/${pid}/dms/${DM}/checkout`, {})).status, 200);
  assert.ok(await until(() => b.room(roomOf(DM)).state.code === 'CHECKED_OUT'), 'bob is told at once');
  const st = b.room(roomOf(DM)).state;
  assert.equal(st.writable, false); assert.equal(st.lock.holder, 'alicecol'); assert.match(st.reason, /Locked by alicecol/);
  assert.equal(a.room(roomOf(DM)).state.writable, true, 'the holder writes');
  assert.equal(a.room(roomOf(DM)).state.lock.mine, true);
  paraText(jb.room).insert(0, 'BLOCKED ');
  assert.ok(await b.waitFor((m) => m.type === proto.MSG.ERROR && m.error.code === 'READ_ONLY', 3000), 'bob\'s change is refused');
  paraText(a.room(roomOf(DM))).insert(0, 'HOLDER ');
  // (this headless client keeps its own refused change locally; the Studio never makes one: its canvas is read-only while locked)
  assert.ok(await until(() => paraText(jb.room).toString().includes('HOLDER ')), 'bob still sees the holder\'s changes');
  // the holder gives it back: bob may write again
  assert.equal((await alice.del(`/api/projects/${pid}/dms/${DM}/checkout`)).json.released, true);
  assert.ok(await until(() => b.room(roomOf(DM)).state.writable === true), 'free again, live');
  // a manager breaks a check-out: the same
  assert.equal((await bob.post(`/api/projects/${pid}/dms/${DM}/checkout`, {})).status, 200);
  assert.ok(await until(() => a.room(roomOf(DM)).state.code === 'CHECKED_OUT'));
  assert.equal((await alice.del(`/api/projects/${pid}/dms/${DM}/checkout?break=1`)).status, 200);
  assert.ok(await until(() => a.room(roomOf(DM)).state.writable === true), 'the owner broke it');
  a.close(); b.close();
});

test('an external change to the file (a save by version) reaches the live room as a merge that keeps unwritten edits', async () => {
  const a = await client(alice);
  const ja = await a.join(roomOf(DM2));
  assert.ok(!ja.error, JSON.stringify(ja.error));
  await a.flush(roomOf(DM2), false);
  const base = await fileXml(DM2);
  // alice types (not written back yet: the write-back waits 1.5 s)
  const t = paraText(ja.room); t.insert(0, 'UNWRITTEN ');
  assert.ok(await a.settled(roomOf(DM2)));
  // someone saves the file by version (the classic editor, an import): a new paragraph text at the end
  const changed = base.xml.replace(/(<para>)([^<]*)(<\/para>)(?![\s\S]*<para>)/, '$1$2 EXTERNAL$3');
  assert.notEqual(changed, base.xml, 'the fixture has a paragraph to change');
  const put = await bob.put(`/api/projects/${pid}/dms/${DM2}`, { xml: changed, baseHash: base.hash });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.ok(await until(() => textOf(ja.room.doc.getXmlFragment('xml')).includes('EXTERNAL'), 6000), 'the room got the external change');
  assert.ok(textOf(ja.room.doc.getXmlFragment('xml')).includes('UNWRITTEN'), 'alice\'s unwritten edit is kept');
  const fl = await a.flush(roomOf(DM2), true);
  const now = await fileXml(DM2);
  assert.equal(now.hash, fl.info.hash);
  assert.match(now.xml, /UNWRITTEN /); assert.match(now.xml, / EXTERNAL/);
  a.close();
});

test('the log is the source until written back: a stop with unwritten changes loses nothing, the next start replays them', async () => {
  const a = await client(alice);
  const ja = await a.join(roomOf(DM));
  await a.flush(roomOf(DM), false);
  const before = (await fileXml()).xml;
  paraText(ja.room).insert(0, 'REPLAYED ');
  assert.ok(await a.settled(roomOf(DM)), 'acknowledged = stored');
  // the server stops before the write-back (a crash keeps the same log: only acknowledged updates count)
  rooms.stopSync();
  a.close();
  assert.equal((await fileXml()).xml, before, 'the file does not have it yet');
  const { repos } = require('../dist/context');
  assert.ok(repos.collab.pendingRooms().includes(roomOf(DM)), 'the room is pending');
  rooms.start();
  assert.ok(await until(async () => /REPLAYED /.test((await fileXml()).xml), 8000), 'replayed into the file on start');
  assert.ok(!repos.collab.pendingRooms().includes(roomOf(DM)), 'nothing pending any more');
  // a new member joins the same epoch and has it too
  const b = await client(bob);
  const jb = await b.join(roomOf(DM));
  assert.ok(paraText(jb.room).toString().startsWith('REPLAYED '));
  b.close();
});

test('limits: a change over the size limit is refused; a page sending far too much is cut off', async () => {
  const a = await client(alice);
  const ja = await a.join(roomOf(DM));
  paraText(ja.room).insert(0, 'x'.repeat(66 * 1024));
  const err = await a.waitFor((m) => m.type === proto.MSG.ERROR && m.error.code === 'TOO_LARGE', 3000);
  assert.ok(err, 'TOO_LARGE');
  a.close();
  const f = await client(bob);
  for (let i = 0; i < 2000; i++) f.send(proto.enc.leave('x/dm/y.xml'));
  const closed = await Promise.race([f.closed, sleep(3000).then(() => null)]);
  assert.ok(closed && closed.code === 1008, 'closed with 1008');
  // a JSON text message over 4 KB still closes with 1009
  const g = await client(bob);
  g.ws.send(JSON.stringify({ type: 'presence', pad: 'y'.repeat(5000) }));
  const c2 = await Promise.race([g.closed, sleep(3000).then(() => null)]);
  assert.ok(c2 && c2.code === 1009, 'text over 4 KB: 1009');
});

test('a comment made in a live document keeps a Yjs anchor; the comment panels are told at once', async () => {
  const ws = await h.socket(alice);
  const a = await client(alice);
  const ja = await a.join(roomOf(DM));
  const t = paraText(ja.room);
  const toB64 = (u) => Buffer.from(u).toString('base64');
  const start = toB64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, 0)));
  const end = toB64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, 4)));
  const made = await rita.post(`/api/projects/${pid}/review/comments`, { body: 'Check this', dmFile: DM, anchor: { path: '0/1', tag: 'para', text: 'x', y: { start, end } } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.ok(await ws.waitFor((m) => m.type === 'comments' && m.projectId === pid, 3000), 'comments broadcast');
  const list = (await alice.get(`/api/projects/${pid}/release`)).json.review.comments;
  const c = list.find((x) => x.id === made.json.id);
  assert.deepEqual(c.anchor.y, { start, end });
  // the anchor follows the words while text is inserted before them
  t.insert(0, 'MOVED ');
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(start, 'base64')), ja.room.doc);
  assert.equal(abs.index, 6);
  const bad = await rita.post(`/api/projects/${pid}/review/comments`, { body: 'x', dmFile: DM, anchor: { path: '0', tag: 'p', text: '', y: { start: '<script>', end } } });
  assert.equal(bad.status, 400);
  a.close(); ws.close();
});

test('submitting the manual for release locks its documents live; withdrawing the request frees them', async () => {
  const rp = (await alice.post('/api/projects', { name: 'Live release', pipeline: 's1000dtofo' })).json.project.id;
  assert.equal((await alice.post(`/api/projects/${rp}/dms`, { file: DM, xml: h.sample(DM) })).status, 201);
  const a = await client(alice);
  const name = `${rp}/dm/${DM}`;
  const ja = await a.join(name);
  assert.ok(!ja.error, JSON.stringify(ja.error));
  assert.equal(ja.room.state.writable, true);
  const sub = await alice.post(`/api/projects/${rp}/release`, { scheduledAt: new Date(Date.now() + 120000).toISOString() });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  assert.ok(await until(() => a.room(name).state.code === 'IN_REVIEW'), 'locked by the request, at once');
  assert.equal(a.room(name).state.writable, false);
  assert.equal(a.room(name).state.canComment, true, 'still commentable');
  paraText(ja.room).insert(0, 'DURING REVIEW ');
  assert.ok(await a.waitFor((m) => m.type === proto.MSG.ERROR && m.error.code === 'READ_ONLY', 3000), 'refused by the server');
  const relId = (await alice.get(`/api/projects/${rp}/release`)).json.pending.id;
  assert.equal((await alice.del(`/api/projects/${rp}/release/${relId}`)).status, 200);
  assert.ok(await until(() => a.room(name).state.writable === true), 'free again after the withdrawal');
  a.close();
});

test('structural edits merge deterministically: an element added by one and another removed by the other end the same on both', () => {
  const { yFromText, serializeY } = require('../dist/services/collab/xml');
  const xml = h.sample(DM);
  const base = yFromText(xml);
  const one = new Y.Doc(); const two = new Y.Doc();
  Y.applyUpdate(one, Y.encodeStateAsUpdate(base)); Y.applyUpdate(two, Y.encodeStateAsUpdate(base));
  const paraOf = (d) => findEl(d.getXmlFragment('xml'), 'para');
  // one adds a new paragraph after the first; two splits nothing but removes the first paragraph's text and adds its own
  const p1 = paraOf(one); const parent1 = p1.parent; const at = parent1.toArray().indexOf(p1);
  const np = new Y.XmlElement('para'); const nt = new Y.XmlText(); nt.insert(0, 'NEW PARAGRAPH'); np.insert(0, [nt]);
  parent1.insert(at + 1, [np]);
  const t2 = firstText(paraOf(two)); t2.delete(0, t2.length); t2.insert(0, 'REWRITTEN');
  Y.applyUpdate(one, Y.encodeStateAsUpdate(two, Y.encodeStateVector(one)));
  Y.applyUpdate(two, Y.encodeStateAsUpdate(one, Y.encodeStateVector(two)));
  const s1 = serializeY(one); const s2 = serializeY(two);
  assert.equal(s1, s2, 'the same document on both sides');
  assert.match(s1, /REWRITTEN/); assert.match(s1, /NEW PARAGRAPH/);
  assert.ok(s1.indexOf('REWRITTEN') < s1.indexOf('NEW PARAGRAPH'), 'the new paragraph stays after the one it followed');
});

test('the server form is stable: every sample module round-trips Y -> XML -> Y -> XML unchanged, and a reconcile lands on the new text', () => {
  const { yFromText, serializeY, reconcileText } = require('../dist/services/collab/xml');
  const files = fs.readdirSync(h.SAMPLES).filter((f) => /^DMC-.*\.xml$/i.test(f));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const raw = h.sample(f);
    const once = serializeY(yFromText(raw));
    assert.equal(serializeY(yFromText(once)), once, `${f}: stable`);
    const doc = yFromText(once);
    const changed = once.replace(/<para>/, '<para>RECONCILED ');
    const sv = Y.encodeStateVector(doc);
    reconcileText(doc, changed);
    assert.equal(serializeY(doc), serializeY(yFromText(changed)), `${f}: reconcile reaches the new text`);
    assert.ok(Y.encodeStateAsUpdate(doc, sv).length < 600, `${f}: a one-word change is a small update, not a rebuild`);
  }
});
