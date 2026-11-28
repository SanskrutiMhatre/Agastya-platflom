'use strict';
// Phase 3 (P3-1): live co-editing of a JSS document (services/jss/collab.ts, shared/jss/yjss.ts), by the contract of docs/phase3/COLLAB-CONTRACT.md.
// The JSS format is registered; a room's file text is byte for byte what a normal save of the same content writes, and stays so after a
// second round trip; an external change is merged minimally; two authors typing in one paragraph and making structural edits (a section, a
// list item, a table row, a note) at once both keep their work; the write-back refuses what a save refuses; a save by version, a restore and
// a GitLab-announced change reach the room without clobbering unwritten edits; a reviewer is read-only; a check-out locks the room live.

process.env.AGASTYA_COLLAB_WRITEBACK_MS = '800';
process.env.AGASTYA_COLLAB_PERSIST_MS = '20';
process.env.AGASTYA_COLLAB_IDLE_MS = '1000';
process.env.AGASTYA_COLLAB_LEASE_RENEW_MS = '50';   // a check-out holder's lease is renewed while they type (Phase 8: with its own part)

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');
const { CollabClient, until, Y } = require('./helpers-collab');

const PW = 'Correct-Horse-9!';
let h; let admin; let ann; let ben; let rita; let pid; let rooms; let x; let yj; let collab; let P;
const open = [];

// the content of a first chapter that uses every construct the editor has (marks, xrefs, line breaks, mixed list items and cells, a merged
// head, a figure with a key, notices, a page break, a landscape section with a sub-section, entities)
const RICH = [
  '<para align="center">Hello <b>bold <i>both</i></b> and <xref to="t1"/> plus <xref href="http://example">link</xref><br/>line &lt;x&gt; &amp; more</para>',
  '<para>Second paragraph.</para>',
  '<list type="number"><item>One<para>inner para</para><list><item>nested</item></list>tail</item><item>Two</item></list>',
  '<table id="t1" widths="1* 2*"><title>Caption</title><thead><row><cell colspan="2">Head</cell></row></thead><tbody><row><cell align="right">a</cell><cell>b<para>p</para></cell></row></tbody></table>',
  '<figure id="f1"><title>Figure title</title><graphic src="Media/x.png" width="80mm"/><legend><keyitem num="1">Part</keyitem></legend></figure>',
  '<note><para>Mind this.</para><list type="bullet"><item>x</item></list></note>',
  '<warning><para>Hot.</para></warning>',
  '<pageBreak/>',
].join('\n      ');

async function person(username) {
  const made = await admin.post('/api/team/users', { username, fullName: `${username} Example`, role: 'author' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const c = new h.Client(username); c.id = made.json.user.id;
  assert.equal((await c.post('/api/auth/login', { username, password: made.json.tempPassword })).status, 200);
  assert.equal((await c.post('/api/auth/onboarding', { username, password: PW })).status, 200);
  return c;
}
async function client(who) { const c = new CollabClient(h.base, who.cookie); await c.open(); open.push(c); return c; }
const U = () => `/api/projects/${pid}/jss`;
const ROOM = () => `${pid}/jss/book`;
const fileText = () => require('../dist/context').content.readText(pid, 'publication.xml');
/** what the editor writes for a text (its own reader and serializer): a normal save */
const editorText = (text) => x.serializeJss(x.parseJss(text, P));
/** a page's model of a room, kept paired with the tree (what the browser binding does) */
function bound(r) { const maps = yj.newMaps(); const doc = new yj.Reader(maps).doc(r.doc.getXmlFragment('xml')); return { maps, doc, sync: () => r.doc.transact(() => new yj.Sync(maps).doc(r.doc, doc)) }; }
const textOfRoom = (r) => x.serializeJss(yj.readDoc(r.doc));

test.before(async () => {
  h = await boot({ ws: true });
  rooms = require('../dist/services/collab/rooms');
  x = require('../dist/shared/jss/xml');
  yj = require('../dist/shared/jss/yjss');
  collab = require('../dist/services/jss/collab');
  const { DOMParser } = require('@xmldom/xmldom'); P = new DOMParser({ onError: () => undefined });
  rooms.start();
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  ann = await person('annjss'); ben = await person('benjss'); rita = await person('ritajss');
  const made = await ann.post('/api/projects', { name: 'Live JSS', format: 'jss', domain: 'land', manualType: 'uhb' });
  assert.equal(made.status, 201, JSON.stringify(made.json)); pid = made.json.project.id;
  assert.equal((await ann.post(`/api/projects/${pid}/assign`, { username: 'benjss', role: 'editor' })).status, 200);
  assert.equal((await ann.post(`/api/projects/${pid}/assign`, { username: 'ritajss', role: 'reviewer' })).status, 200);
  // the rich content goes in by a normal save (the classic flow), in the editor's own writing
  const cur = (await ann.get(U())).json;
  const rich = editorText(cur.xml.replace(/(<chapter number="1"[^>]*><title>[^<]*<\/title>)/, `$1\n      ${RICH}`));
  const saved = await ann.put(U(), { xml: rich, baseHash: cur.hash });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
});
test.after(async () => { for (const c of open) c.close(); try { await rooms.stop(); } catch { /* */ } if (h) await h.close(); });

test('the JSS format is registered with the core: kind jss, the room <project>/jss/book, the save\'s role and capability', () => {
  const { formatOf, kinds } = require('../dist/services/collab/formats');
  assert.ok(kinds().includes('jss'));
  const f = formatOf('jss');
  assert.equal(f, collab.jssFormat);
  assert.equal(f.writeRole, 'editor'); assert.equal(f.writeCap, 'dm.write');
  assert.equal(f.resolve(pid, 'book'), 'publication.xml');
  assert.throws(() => f.resolve(pid, 'chapter-1'), (e) => e.code === 'NOT_FOUND');
});

test('round trip: the room\'s file text is byte for byte a normal save of the same content, and a second round trip changes nothing', async () => {
  const f = collab.jssFormat;
  const onDisk = fileText();
  const types = ['uhb', 'mm', 'orm'];
  const texts = [onDisk];
  for (const t of types) {
    const p = await ann.post('/api/projects', { name: `Skeleton ${t}`, format: 'jss', domain: 'land', manualType: t });
    texts.push((await ann.get(`/api/projects/${p.json.project.id}/jss`)).json.xml);      // the server's starting document (its own writing)
  }
  for (const text of texts) {
    const d = new Y.Doc(); f.toY(text, d);
    const once = f.fromY(d);
    assert.equal(once, editorText(text), 'fromY(toY(x)) is what the editor saves for x');
    const d2 = new Y.Doc(); f.toY(once, d2);
    assert.equal(f.fromY(d2), once, 'stable: the second round trip changes nothing');
  }
  assert.equal(f.fromY((() => { const d = new Y.Doc(); f.toY(onDisk, d); return d; })()), onDisk, 'the file a normal save wrote is the room\'s text unchanged');
  // a live edit written back = a normal save of the same edit
  const a = await client(ann);
  const ja = await a.join(ROOM()); assert.ok(!ja.error, JSON.stringify(ja.error));
  const b = bound(ja.room);
  const p0 = b.doc.chapters[0].children.find((c) => c.k === 'para');
  p0.inline = [...p0.inline, { t: 'text', text: ' (live)' }];
  b.sync();
  assert.ok(await a.settled(ROOM()));
  const fl = await a.flush(ROOM(), true); assert.ok(fl && fl.info.hash);
  const expected = x.serializeJss(b.doc);
  assert.equal(fileText(), expected, 'the write-back is the editor\'s serialization of the edited model');
  assert.equal(fileText(), editorText(fileText()), 'and a normal save of it would write the same bytes');
  a.leave(ROOM());
});

test('reconcile changes only what differs: one word of one paragraph is one small text change, other nodes keep their identity', () => {
  const f = collab.jssFormat;
  const text = fileText();
  const d = new Y.Doc(); f.toY(text, d);
  const maps = yj.newMaps(); const m = new yj.Reader(maps).doc(d.getXmlFragment('xml'));
  const second = m.chapters[0].children.filter((c) => c.k === 'para')[1];
  const ySecond = maps.modelToY.get(second); const yTable = maps.modelToY.get(m.chapters[0].children.find((c) => c.k === 'table'));
  const sv = Y.encodeStateVector(d);
  f.reconcile(d, text.replace('Second paragraph.', 'Second changed paragraph.'));
  const diff = Y.encodeStateAsUpdate(d, sv);
  assert.ok(diff.length < 80, `a small update (${diff.length} bytes)`);
  assert.equal(f.fromY(d), editorText(text.replace('Second paragraph.', 'Second changed paragraph.')));
  assert.ok(ySecond.doc && !ySecond._item.deleted, 'the paragraph is the same Y element');
  assert.ok(yTable.doc && !yTable._item.deleted, 'the table was not touched');
  const sv2 = Y.encodeStateVector(d);
  f.reconcile(d, f.fromY(d));
  assert.equal(Y.encodeStateAsUpdate(d, sv2).length, 2, 'the same text again changes nothing');
});

test('two authors at once: typing in the same paragraph merges, and concurrent structural edits (section, list item, row, note) all survive', async () => {
  const a = await client(ann); const b = await client(ben);
  const ja = await a.join(ROOM()); const jb = await b.join(ROOM());
  assert.ok(!ja.error && !jb.error, JSON.stringify(ja.error || jb.error));
  assert.equal(ja.room.state.writable, true); assert.equal(jb.room.state.writable, true);
  const A = bound(ja.room); const B = bound(jb.room);
  // the same paragraph: Ann at the start, Ben at the end, at the same moment (each through the keyed sync of their own model)
  const pa = A.doc.chapters[0].children.filter((c) => c.k === 'para')[1]; const pb = B.doc.chapters[0].children.filter((c) => c.k === 'para')[1];
  pa.inline = [{ t: 'text', text: 'ALPHA Second paragraph.' }];
  pb.inline = [{ t: 'text', text: 'Second paragraph. OMEGA' }];
  // structural: Ann adds a section and a list item; Ben adds a table row and a note, all before either sees the other
  A.doc.chapters[0].children.push({ k: 'section', id: 'sann', title: 'Ann section', children: [{ k: 'para', inline: [{ t: 'text', text: 'by Ann' }] }] });
  A.doc.chapters[0].children.find((c) => c.k === 'list').items.push({ parts: [{ k: 'inline', inline: [{ t: 'text', text: 'Three (Ann)' }] }] });
  const tb = B.doc.chapters[0].children.find((c) => c.k === 'table'); tb.body.push({ cells: [{ parts: [{ k: 'inline', inline: [{ t: 'text', text: 'c (Ben)' }] }] }, { parts: [{ k: 'inline', inline: [{ t: 'text', text: 'd' }] }] }] });
  B.doc.chapters[0].children.splice(1, 0, { k: 'caution', parts: [{ k: 'para', inline: [{ t: 'text', text: 'Ben caution' }] }] });
  A.sync(); B.sync();
  assert.ok(await a.settled(ROOM()) && await b.settled(ROOM()), 'every change acknowledged');
  assert.ok(await until(() => textOfRoom(ja.room) === textOfRoom(jb.room) && textOfRoom(ja.room).includes('Ben caution') && textOfRoom(jb.room).includes('Ann section')), 'both converge');
  const merged = textOfRoom(ja.room);
  assert.match(merged, /<para>ALPHA Second paragraph\. OMEGA<\/para>/, 'one paragraph, both words');
  for (const s of ['<title>Ann section</title>', 'Three (Ann)', 'c (Ben)', '<caution>', 'Ben caution']) assert.ok(merged.includes(s), s);
  const fl = await a.flush(ROOM(), true); assert.ok(fl);
  assert.equal(fileText(), merged, 'the merged document is the file');
  assert.equal((await ann.get(U())).json.xml, merged, 'the classic read sees it');
  a.leave(ROOM()); b.leave(ROOM());
});

// Phase 8: a moved block is re-placed, not deleted and re-created (ydom.ts schema 2), so typing inside it at the same time is kept
test('one author moves a paragraph and indents a section while the other types in both: both converge, the typing is kept, once', async () => {
  const a = await client(ann); const b = await client(ben);
  const ja = await a.join(ROOM()); const jb = await b.join(ROOM());
  assert.ok(!ja.error && !jb.error, JSON.stringify(ja.error || jb.error));
  const A = bound(ja.room);
  const chA = A.doc.chapters[0];
  // two sections side by side to indent one into the other (made and settled first)
  chA.children.push({ k: 'section', id: 'smv1', title: 'Outer', children: [{ k: 'para', inline: [{ t: 'text', text: 'outer text' }] }] },
    { k: 'section', id: 'smv2', title: 'Inner', children: [{ k: 'para', inline: [{ t: 'text', text: 'inner text' }] }] });
  A.sync();
  assert.ok(await a.settled(ROOM()));
  assert.ok(await until(() => textOfRoom(jb.room).includes('inner text')));
  const B2 = bound(jb.room); const chB2 = B2.doc.chapters[0];
  // Ann: the first paragraph down below the list, and section "Inner" into section "Outer"
  const idx = chA.children.findIndex((c) => c.k === 'para');
  const [moved] = chA.children.splice(idx, 1); const at = chA.children.findIndex((c) => c.k === 'list'); chA.children.splice(at + 1, 0, moved);
  const inner = chA.children.find((c) => c.id === 'smv2'); chA.children.splice(chA.children.indexOf(inner), 1); chA.children.find((c) => c.id === 'smv1').children.push(inner);
  // Ben, at the same moment, types in both
  const pB = chB2.children.find((c) => c.k === 'para'); const was = pB.inline.find((r) => r.t === 'text').text;
  pB.inline = [...pB.inline, { t: 'text', text: ' MOVED-TYPING' }];
  chB2.children.find((c) => c.id === 'smv2').children[0].inline = [{ t: 'text', text: 'inner text INDENT-TYPING' }];
  A.sync(); B2.sync();
  assert.ok(await a.settled(ROOM()) && await b.settled(ROOM()), 'every change acknowledged');
  assert.ok(await until(() => textOfRoom(ja.room) === textOfRoom(jb.room) && textOfRoom(ja.room).includes('INDENT-TYPING') && textOfRoom(ja.room).includes('MOVED-TYPING')), 'both converge with both typings');
  const merged = textOfRoom(ja.room);
  assert.equal(merged.split('MOVED-TYPING').length - 1, 1, 'the moved paragraph once');
  assert.equal(merged.split('INDENT-TYPING').length - 1, 1, 'the indented section once');
  assert.match(merged, /<\/list>\s*<para[^>]*>[^]*?MOVED-TYPING/, 'the paragraph is below the list, with the typing');
  assert.match(merged, /<section id="smv1">[^]*<section id="smv2">[^]*INDENT-TYPING[^]*<\/section>\s*<\/section>/, 'Inner is inside Outer, with the typing');
  assert.ok(merged.includes(was), 'the paragraph keeps its words');
  const fl = await a.flush(ROOM(), true); assert.ok(fl);
  assert.equal(fileText(), merged, 'the merged document is the file');
  assert.equal(fileText(), editorText(merged), 'and it is a normal save of itself');
  a.leave(ROOM()); b.leave(ROOM());
});

test('the write-back refuses what a save refuses: the room keeps the change, members are told, the file is untouched', async () => {
  const a = await client(ann);
  const ja = await a.join(ROOM()); assert.ok(!ja.error);
  const before = fileText();
  // another document type than the project's (DOCTYPE_MISMATCH on a save)
  const book = ja.room.doc.getXmlFragment('xml').toArray().find((c) => c.nodeName === 'jssbook');
  ja.room.doc.transact(() => book.setAttribute('docType', 'orm'));
  assert.ok(await a.settled(ROOM()));
  await a.flush(ROOM(), true);
  assert.ok(await until(() => ja.room.errors.some((e) => e.code === 'WRITE_BACK_REFUSED')), JSON.stringify(ja.room.errors));
  assert.match(ja.room.errors.find((e) => e.code === 'WRITE_BACK_REFUSED').message, /uhb|User|document says/i);
  assert.equal(fileText(), before, 'nothing was written');
  // put it right: the next write-back goes through
  ja.room.doc.transact(() => book.setAttribute('docType', 'uhb'));
  assert.ok(await a.settled(ROOM()));
  await a.flush(ROOM(), true);
  assert.equal(fileText(), textOfRoom(ja.room));
  a.leave(ROOM());
});

test('external changes merge without clobbering live edits: a save by version, a restore, a GitLab-announced change', async () => {
  const a = await client(ann);
  const ja = await a.join(ROOM()); assert.ok(!ja.error);
  const A = bound(ja.room);
  // Ann types (not yet written back) ...
  const p = A.doc.chapters[0].children.filter((c) => c.k === 'para')[0];
  p.inline = [...p.inline, { t: 'text', text: ' UNWRITTEN' }];
  A.sync(); assert.ok(await a.settled(ROOM()));
  // ... while Ben saves by version in the classic flow, changing another paragraph
  const cur = (await ben.get(U())).json;
  const theirs = cur.xml.replace('Second paragraph.', 'Second paragraph, saved by Ben.');
  assert.notEqual(theirs, cur.xml);
  assert.equal((await ben.put(U(), { xml: theirs, baseHash: cur.hash })).status, 200);
  assert.ok(await until(() => textOfRoom(ja.room).includes('saved by Ben')), 'the save reached the room');
  assert.ok(textOfRoom(ja.room).includes('UNWRITTEN'), 'Ann\'s unwritten words are kept');
  await a.flush(ROOM(), true);
  assert.ok(fileText().includes('UNWRITTEN') && fileText().includes('saved by Ben'), 'the file has both');
  // a restore of an earlier version (history route) is an external change too
  const hist = (await ann.get(`${U()}/history`)).json.revisions;
  assert.ok(hist.length >= 2);
  let older = null;            // the version with the rich content from before Ben's save
  for (const rev of hist) { const t = (await ann.get(`${U()}/history/${rev.id}`)).json.xml; if (t.includes('Mind this.') && !t.includes('saved by Ben')) { older = rev; break; } }
  assert.ok(older, 'an earlier version to restore');
  const head = (await ann.get(U())).json;
  const restored = await ann.post(`${U()}/history/${older.id}/restore`, { baseHash: head.hash });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.ok(await until(() => !textOfRoom(ja.room).includes('saved by Ben')), 'the restore reached the room');
  // a GitLab pull: the file is written, then announced
  const { content } = require('../dist/context');
  const { emitFilesChangedExternally } = require('../dist/services/externalChanges');
  const now = fileText(); const pulled = now.replace('Mind this.', 'Mind this (from GitLab).');
  const sha = (s) => require('crypto').createHash('sha256').update(s).digest('hex');
  content.writeText(pid, 'publication.xml', pulled);
  emitFilesChangedExternally({ projectId: pid, source: 'gitlab', actor: { id: ben.id, username: 'benjss' }, files: [{ path: 'publication.xml', change: 'modified', before: sha(now), after: sha(pulled) }], at: new Date().toISOString() });
  assert.ok(await until(() => textOfRoom(ja.room).includes('from GitLab')), 'the pull reached the room');
  assert.ok(await until(() => ja.room.errors.some((e) => e.code === 'EXTERNAL_CHANGE')), 'members are told who changed it');
  a.leave(ROOM());
});

test('a reviewer sees the document live but cannot change it; a check-out locks the room for the others ("Locked by"), live', async () => {
  const a = await client(ann); const b = await client(ben); const r = await client(rita);
  const ja = await a.join(ROOM()); const jb = await b.join(ROOM()); const jr = await r.join(ROOM());
  assert.ok(!ja.error && !jb.error && !jr.error);
  assert.equal(jr.room.state.writable, false); assert.equal(jr.room.state.code, 'ROLE');
  assert.equal(jr.room.state.canComment, true, 'a reviewer comments');
  // the reviewer's change is refused, never applied
  const R = bound(jr.room); const rp = R.doc.chapters[0].children.find((c) => c.k === 'para');
  rp.inline = [{ t: 'text', text: 'REVIEWER WAS HERE' }]; R.sync();
  assert.ok(await until(() => jr.room.errors.some((e) => e.code === 'READ_ONLY')));
  // Ann's typing reaches the reviewer live
  const A = bound(ja.room); const ap = A.doc.chapters[0].children.filter((c) => c.k === 'para')[1];
  ap.inline = [...ap.inline, { t: 'text', text: ' LIVE' }]; A.sync();
  assert.ok(await until(() => textOfRoom(jr.room).includes(' LIVE')), 'the reviewer sees it');
  assert.ok(!textOfRoom(ja.room).includes('REVIEWER WAS HERE'), 'the reviewer\'s change never reached the others');
  // Ben checks the document out: Ann is locked, live, and her change is refused
  assert.equal((await ben.post(`${U()}/checkout`, {})).status, 200);
  assert.ok(await until(() => ja.room.state && ja.room.state.code === 'CHECKED_OUT'), JSON.stringify(ja.room.state));
  assert.match(ja.room.state.reason, /^Locked by benjss/);
  assert.equal(jb.room.state.writable, true, 'the holder keeps writing');
  const n = ja.room.errors.length;
  ap.inline = [...ap.inline, { t: 'text', text: ' LOCKED' }]; A.sync();
  assert.ok(await until(() => ja.room.errors.slice(n).some((e) => e.code === 'READ_ONLY')));
  // checked in: Ann writes again
  assert.equal((await ben.del(`${U()}/checkout`)).status, 200);
  assert.ok(await until(() => ja.room.state && ja.room.state.writable === true));
  // Phase 8: a chapter check-out stays a chapter check-out while its holder types live (it was renewed as the whole book before)
  const chapterId = (/<chapter\b[^>]*\sid="([^"]+)"/.exec(fileText()) ?? [])[1] ?? 'ch-test';
  assert.equal((await ben.post(`${U()}/checkout`, { part: chapterId })).status, 200);
  assert.ok(await until(() => ja.room.state && ja.room.state.code === 'CHECKED_OUT'), 'the book is locked for the others (documented: per room)');
  const B = bound(jb.room); const bp = B.doc.chapters[0].children.filter((c) => c.k === 'para')[1];
  for (let i = 0; i < 3; i++) { bp.inline = [...bp.inline, { t: 'text', text: ` RENEW${i}` }]; B.sync(); await new Promise((res) => setTimeout(res, 120)); }
  assert.ok(await b.settled(ROOM()));
  const held = (await ben.get(`${U()}/checkouts`)).json;
  const parts = (held.checkouts ?? held.leases ?? held).map((l) => l.part);
  assert.deepEqual(parts, [chapterId], `only the chapter is checked out: ${JSON.stringify(held)}`);
  assert.equal((await ben.del(`${U()}/checkout?part=${encodeURIComponent(chapterId)}`)).status, 200);
  assert.ok(await until(() => ja.room.state && ja.room.state.writable === true), 'checked in: the book is free (no whole-book check-out was left behind)');
  a.close(); b.close(); r.close();
});

test('a comment in the JSS document is pinned with live positions and names the document "jss/book"', async () => {
  const a = await client(ann);
  const ja = await a.join(ROOM()); assert.ok(!ja.error);
  const maps = yj.newMaps(); const m = new yj.Reader(maps).doc(ja.room.doc.getXmlFragment('xml'));
  const p = m.chapters[0].children.find((c) => c.k === 'para');
  const t = yj.textsIn(maps.modelToY.get(p))[0];
  const rel = (i) => Buffer.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(t, i))).toString('base64');
  const made = await rita.post(`/api/projects/${pid}/review/comments`, { body: 'Check this', dmFile: 'jss/book', anchor: { path: '0/1/0/1', tag: 'para', text: 'Hello', y: { start: rel(0), end: rel(5) } } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const list = (await ann.get(`/api/projects/${pid}/release`)).json.review.comments;
  const c = list.find((k) => k.body === 'Check this');
  assert.equal(c.dmFile, 'jss/book'); assert.ok(c.anchor.y.start);
  const back = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Buffer.from(c.anchor.y.start, 'base64')), ja.room.doc);
  assert.equal(back.type, t, 'the anchor resolves to the paragraph\'s text');
  assert.equal((await rita.post(`/api/projects/${pid}/review/comments`, { body: 'x', dmFile: 'jss/../etc' })).status, 400, 'any other name is refused');
  a.leave(ROOM());
});

