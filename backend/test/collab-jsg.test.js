'use strict';
// Phase 3 (P3-1): live co-editing of JSG documents (services/collab/jsg.ts, shared/collab/jsgForm.ts, shared/jsg/xml.ts).
// The JSG kind is a registered room format; a room writes the project file byte for byte as the JSG editor saves it (empty attributes
// included, GAP-005); a reconcile changes only what differs; concurrent edits merge (one paragraph character by character, structure, ISPL
// rows and cells); a write-back refuses what a save refuses; an external change (a save by version) merges into the room keeping the
// unwritten edits; a check-out locks the room for the others ("Locked by").

process.env.AGASTYA_COLLAB_WRITEBACK_MS = '1500';
process.env.AGASTYA_COLLAB_PERSIST_MS = '20';
process.env.AGASTYA_COLLAB_IDLE_MS = '1000';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot } = require('./helpers');
const { CollabClient, textOf, findEl, until, Y } = require('./helpers-collab');

const PW = 'Correct-Horse-9!';
const SAMPLE = (k) => fs.readFileSync(path.join(__dirname, '..', 'samples', k, 'jsg-document.xml'), 'utf8');
let h; let admin; let alice; let bob; let rita; let rooms; let proto; let jsg; let xml; let DOMParser; let pidU; let pidI;
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
const roomOf = (pid) => `${pid}/jsg/document`;
/** the model of a Y document (what the editor would show) */
const modelOf = (ydoc) => xml.readJsg(new DOMParser().parseFromString(jsg.jsgFromY(ydoc), 'text/xml').documentElement);
/** an editor's command: change the model, then bring the Y document to it (what the browser binding does after each command) */
const edit = (ydoc, fn) => { const m = modelOf(ydoc); fn(m); jsg.jsgReconcile(ydoc, xml.serializeJsg(m), 'local'); };
const fork = (ydoc) => { const d = new Y.Doc(); Y.applyUpdate(d, Y.encodeStateAsUpdate(ydoc)); return d; };
const exchange = (a, b) => { const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)); const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)); Y.applyUpdate(b, ua); Y.applyUpdate(a, ub); };
const plainOf = (inl) => inl.map((i) => (i.t === 'text' ? i.text : i.t === 'br' ? '\n' : plainOf(i.children))).join('');
/** the first paragraph of a model's first section that is a plain paragraph */
const firstPara = (m, ci = 0) => { const walk = (list) => { for (const x of list) { if (x.k === 'para') return x; if (x.k === 'clause') { const p = walk(x.children); if (p) return p; } } return null; }; for (const s of m.chapters[ci].sections) { const p = walk(s.children); if (p) return p; } return null; };

test.before(async () => {
  h = await boot({ ws: true });
  rooms = require('../dist/services/collab/rooms');
  proto = require('../dist/shared/collab/protocol');
  jsg = require('../dist/services/collab/jsg');
  xml = require('../dist/shared/jsg/xml');
  DOMParser = require('@xmldom/xmldom').DOMParser;
  rooms.start();
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  alice = await person('alicejsg'); bob = await person('bobjsg'); rita = await person('ritajsg');
  pidU = (await alice.post('/api/projects', { name: 'Live handbook', format: 'jsg', domain: 'land', manualType: 'uhb' })).json.project.id;
  pidI = (await alice.post('/api/projects', { name: 'Live parts list', format: 'jsg', domain: 'land', manualType: 'ispl' })).json.project.id;
  for (const pid of [pidU, pidI]) {
    assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'bobjsg', role: 'editor' })).status, 200);
    assert.equal((await alice.post(`/api/projects/${pid}/assign`, { username: 'ritajsg', role: 'reviewer' })).status, 200);
  }
  // the reference documents, saved by version as the editor saves them
  for (const [pid, k] of [[pidU, 'jsg-uhb'], [pidI, 'jsg-ispl']]) {
    const cur = (await alice.get(`/api/projects/${pid}/jsg`)).json;
    const put = await alice.put(`/api/projects/${pid}/jsg`, { xml: jsg.canonicalJsg(SAMPLE(k)), baseHash: cur.hash });
    assert.equal(put.status, 200, JSON.stringify(put.json));
  }
});
test.after(async () => { for (const c of open) c.close(); try { await rooms.stop(); } catch { /* */ } if (h) await h.close(); });

test('JSG is a registered live format, and a room writes exactly what the editor saves: both reference documents and empty attributes (GAP-005) round-trip byte for byte', () => {
  const { formatOf, kinds } = require('../dist/services/collab/formats');
  assert.ok(kinds().includes('jsg'));
  assert.equal(formatOf('jsg'), jsg.jsgFormat);
  assert.equal(jsg.jsgFormat.writeCap, 'dm.write', 'the capability of PUT /jsg');
  for (const k of ['jsg-uhb', 'jsg-ispl']) {
    const text = SAMPLE(k);
    const editorForm = xml.serializeJsg(xml.readJsg(new DOMParser().parseFromString(text, 'text/xml').documentElement));
    assert.equal(jsg.canonicalJsg(text), editorForm, `${k}: the canonical form is the editor's Save`);
    const y = new Y.Doc(); jsg.jsgToY(text, y);
    assert.equal(jsg.jsgFromY(y), editorForm, `${k}: Y -> file is the editor's Save, byte for byte`);
    const y2 = new Y.Doc(); jsg.jsgToY(jsg.jsgFromY(y), y2);
    assert.equal(jsg.jsgFromY(y2), editorForm, `${k}: stable on a second round trip`);
    assert.deepEqual(Y.encodeStateVector(y2).length > 0, true);
  }
  // empty attributes and empty fields survive: title="" (a captioned table with no caption yet), item="" designation="" (a new parts row), empty cover fields
  const uhb = `<?xml version="1.0" encoding="UTF-8"?>
<jsgdoc version="1.0" type="uhb">
  <meta>
    <docNo></docNo>
    <atNo></atNo>
    <issuedBy><line></line></issuedBy>
  </meta>
  <front>
    <amendments minRows="20"/>
    <abbreviations/>
    <photos/>
  </front>
  <chapter title="">
    <section title="">
      <table title=""><head><row><cell><text></text></cell></row></head><body><row><cell><text/></cell></row></body></table>
      <para></para>
      <figure title=""/>
    </section>
  </chapter>
</jsgdoc>
`;
  const ispl = `<?xml version="1.0" encoding="UTF-8"?>
<jsgdoc version="1.0" type="ispl"><meta><docNo/><qtyUnit/></meta><plates><plate ref="" title=""><view><part item="" designation=""/><part item="01" designation="" nsn="" qty="2"/><note></note></view></plate></plates></jsgdoc>`;
  for (const [name, text] of [['handbook', uhb], ['parts list', ispl]]) {
    const form = jsg.canonicalJsg(text);
    const y = new Y.Doc(); jsg.jsgToY(text, y);
    assert.equal(jsg.jsgFromY(y), form, `${name}: empty attributes and fields round-trip`);
    if (name === 'handbook') { assert.match(form, /<table title="">/); assert.match(form, /<chapter title="">/); assert.match(form, /<docNo><\/docNo>/); assert.match(form, /<line><\/line>/); }
    else { assert.match(form, /<part item="" designation=""\/>/); assert.match(form, /<plate ref="" title="">/); assert.match(form, /<note><\/note>/); }
  }
});

test('a reconcile changes only what differs: an untouched paragraph keeps its identity, an unwritten edit in it survives, and the change is small', () => {
  const base = new Y.Doc(); jsg.jsgToY(SAMPLE('jsg-uhb'), base);
  const m = modelOf(base);
  const target = firstPara(m, 1); assert.ok(target, 'chapter 2 has a paragraph');
  const before = plainOf(target.inline);
  // find the Y text of that paragraph
  const findText = (ydoc, s) => { let hit = null; const walk = (n) => n.forEach((c) => { if (hit) return; if (c instanceof Y.XmlText && c.toString() === s) hit = c; else if (c instanceof Y.XmlElement) walk(c); }); walk(ydoc.getXmlFragment('xml')); return hit; };
  const yt = findText(base, before); assert.ok(yt, 'the paragraph text is one Y text');
  // another person's unwritten typing in it
  const other = fork(base); findText(other, before).insert(0, 'UNWRITTEN ');
  // the file changes elsewhere: a paragraph added at the start of chapter 1, another paragraph's words changed
  firstPara(m, 0).inline = [{ t: 'text', text: 'Changed on disk.' }];
  m.chapters[0].sections[0].children.unshift({ k: 'para', indent: 2, inline: [{ t: 'text', text: 'Added on disk.' }] });
  const sv = Y.encodeStateVector(base);
  jsg.jsgReconcile(base, xml.serializeJsg(m), 'external');
  const diff = Y.encodeStateAsUpdate(base, sv);
  assert.ok(diff.length < 600, `the change is small (${diff.length} bytes for a ${Y.encodeStateAsUpdate(base).length}-byte document)`);
  assert.ok(!yt._item.deleted, 'the untouched paragraph keeps its Y identity');
  exchange(base, other);
  const out = jsg.jsgFromY(base);
  assert.equal(out, jsg.jsgFromY(other), 'both converge');
  assert.match(out, /Added on disk\./); assert.match(out, /Changed on disk\./); assert.ok(out.includes(`UNWRITTEN ${before}`), 'the unwritten edit is kept');
  // nothing changes when the text is the same
  let updates = 0; const count = () => { updates++; };
  base.on('update', count); jsg.jsgReconcile(base, out, 'external'); base.off('update', count);
  assert.equal(updates, 0, 'a reconcile to the same text is no change');
});

test('concurrent edits merge deterministically: one paragraph character by character, chapters and blocks, ISPL parts rows and cells', () => {
  // the handbook: two authors in one paragraph, one adds a section while the other removes a block elsewhere
  const a = new Y.Doc(); jsg.jsgToY(SAMPLE('jsg-uhb'), a); const b = fork(a);
  const orig = plainOf(firstPara(modelOf(a), 0).inline);
  edit(a, (m) => { const p = firstPara(m, 0); p.inline = [{ t: 'text', text: `ANN ${plainOf(p.inline)}` }]; });
  edit(b, (m) => { const p = firstPara(m, 0); p.inline = [{ t: 'text', text: `${plainOf(p.inline)} BEN` }]; });
  edit(a, (m) => { m.chapters[0].sections.push({ k: 'section', title: 'ADDED BY ANN', orientation: 'portrait', children: [{ k: 'para', indent: 2, inline: [] }] }); });
  const blocks = modelOf(b).chapters[1].sections[0].children.length;
  edit(b, (m) => { m.chapters[1].sections[0].children.pop(); });
  exchange(a, b);
  const ma = modelOf(a);
  assert.equal(jsg.jsgFromY(a), jsg.jsgFromY(b), 'the same document on both sides');
  assert.equal(plainOf(firstPara(ma, 0).inline), `ANN ${orig} BEN`, 'both authors\' typing in one paragraph is kept');
  assert.equal(ma.chapters[0].sections.at(-1).title, 'ADDED BY ANN');
  assert.equal(ma.chapters[1].sections[0].children.length, blocks - 1);
  // the parts list: two people in one parts row (different cells), one adds a row, the other deletes another
  const c = new Y.Doc(); jsg.jsgToY(SAMPLE('jsg-ispl'), c); const d = fork(c);
  const view = (m) => m.plates.find((p) => p.views.some((v) => v.parts.length >= 3)).views.find((v) => v.parts.length >= 3);
  const rows = view(modelOf(c)).parts.length; const row1 = view(modelOf(c)).parts[1];
  edit(c, (m) => { view(m).parts[1].nsn = 'NSN-ANN'; });
  edit(d, (m) => { view(m).parts[1].designation = 'DESIGNATION BY BEN'; });
  edit(c, (m) => { view(m).parts.push({ ...view(m).parts[0], item: '99', designation: 'ROW BY ANN' }); });
  edit(d, (m) => { view(m).parts.splice(2, 1); });
  exchange(c, d);
  const v = view(modelOf(c));
  assert.equal(jsg.jsgFromY(c), jsg.jsgFromY(d));
  assert.equal(v.parts.length, rows, 'one row added, one removed');
  assert.equal(v.parts[1].item, row1.item);
  assert.equal(v.parts[1].nsn, 'NSN-ANN', 'cells of one row edited by two people both land');
  assert.equal(v.parts[1].designation, 'DESIGNATION BY BEN');
  assert.equal(v.parts.at(-1).designation, 'ROW BY ANN');
  // the same cell at the same moment: one value wins, the same everywhere (the documented row/cell granularity)
  const e = fork(c); const f = fork(c);
  edit(e, (m) => { view(m).parts[0].qty = '3'; }); edit(f, (m) => { view(m).parts[0].qty = '4'; });
  exchange(e, f);
  assert.equal(jsg.jsgFromY(e), jsg.jsgFromY(f));
  assert.ok(['3', '4'].includes(view(modelOf(e)).parts[0].qty));
});

test('two editors in one handbook paragraph over the socket: merged, acknowledged, written to the project file in the editor\'s form; a reviewer is read-only', async () => {
  const name = roomOf(pidU);
  const a = await client(alice); const b = await client(bob); const r = await client(rita);
  const ja = await a.join(name); const jb = await b.join(name); const jr = await r.join(name);
  assert.ok(!ja.error && !jb.error && !jr.error, JSON.stringify([ja.error, jb.error, jr.error]));
  assert.equal(ja.room.state.writable, true);
  assert.equal(jr.room.state.writable, false); assert.equal(jr.room.state.code, 'ROLE'); assert.match(jr.room.state.reason, /reviewing/);
  edit(ja.room.doc, (m) => { const p = firstPara(m, 0); p.inline = [{ t: 'text', text: `ALPHA ${plainOf(p.inline)}` }]; });
  edit(jb.room.doc, (m) => { const p = firstPara(m, 0); p.inline = [{ t: 'text', text: `${plainOf(p.inline)} OMEGA` }]; });
  assert.ok(await a.settled(name) && await b.settled(name), 'acknowledged once stored');
  assert.ok(await until(() => /ALPHA .* OMEGA/.test(textOf(jr.room.doc.getXmlFragment('xml'))), 5000), 'the reviewer sees both live');
  // the reviewer's change is refused by the server
  edit(jr.room.doc, (m) => { firstPara(m, 0).inline = [{ t: 'text', text: 'REVIEWER' }]; });
  assert.ok(await r.waitFor((x) => x.type === proto.MSG.ERROR && x.error.code === 'READ_ONLY', 3000));
  const fl = await a.flush(name, true);
  assert.ok(fl && fl.info.hash);
  const saved = (await alice.get(`/api/projects/${pidU}/jsg`)).json;
  assert.equal(saved.hash, fl.info.hash);
  assert.match(saved.xml, /ALPHA [^<]* OMEGA/); assert.doesNotMatch(saved.xml, /REVIEWER/);
  assert.equal(jsg.canonicalJsg(saved.xml), saved.xml, 'the file is exactly what the editor\'s Save writes');
  assert.equal(saved.xml, jsg.jsgFromY(ja.room.doc));
  const hist = (await alice.get(`/api/projects/${pidU}/jsg/history`)).json;
  assert.ok((hist.revisions ?? hist).some((x) => /collab/.test(JSON.stringify(x))), 'Save cut a revision');
  a.close(); b.close(); r.close();
});

test('an ISPL parts row edited by two people over the socket: both cells reach the file', async () => {
  const name = roomOf(pidI);
  const a = await client(alice); const b = await client(bob);
  const ja = await a.join(name); const jb = await b.join(name);
  assert.ok(!ja.error && !jb.error);
  const view = (m) => m.plates.find((p) => p.views.some((v) => v.parts.length)).views.find((v) => v.parts.length);
  edit(ja.room.doc, (m) => { view(m).parts[0].nsn = 'NSN 1111'; });
  edit(jb.room.doc, (m) => { view(m).parts[0].remark = 'REMARK BY BOB'; });
  assert.ok(await a.settled(name) && await b.settled(name));
  assert.ok(await until(() => { const p = view(modelOf(ja.room.doc)).parts[0]; return p.nsn === 'NSN 1111' && p.remark === 'REMARK BY BOB'; }, 5000), 'merged in both');
  await a.flush(name, true);
  const saved = (await alice.get(`/api/projects/${pidI}/jsg`)).json.xml;
  assert.match(saved, /nsn="NSN 1111"[^>]*remark="REMARK BY BOB"/);
  a.close(); b.close();
});

test('a write-back refuses what a save refuses (the declared type, a DOCTYPE): the room keeps its content and says so; the file is not touched', async () => {
  assert.throws(() => jsg.assertJsgWritable(pidU, '<!DOCTYPE jsgdoc><jsgdoc version="1.0" type="uhb"/>'), /DOCTYPE/);
  assert.throws(() => jsg.assertJsgWritable(pidU, '<jsgdoc version="1.0" type="ispl"><meta/></jsgdoc>'), (e) => e.code === 'DOCTYPE_MISMATCH');
  assert.throws(() => jsg.assertJsgWritable(pidU, '   '), (e) => e.code === 'EMPTY');
  jsg.assertJsgWritable(pidU, '<jsgdoc version="1.0" type="uhb"><meta/></jsgdoc>');
  const name = roomOf(pidU);
  const a = await client(alice);
  const ja = await a.join(name); assert.ok(!ja.error);
  await a.flush(name, false);
  const before = (await alice.get(`/api/projects/${pidU}/jsg`)).json;
  const root = ja.room.doc.getXmlFragment('xml').get(0);
  root.setAttribute('type', 'ispl');                  // what a save of this document would refuse (DOCTYPE_MISMATCH)
  assert.ok(await a.settled(name));
  await a.flush(name, true);
  assert.ok(await a.waitFor((m) => m.type === proto.MSG.ERROR && m.error.code === 'WRITE_BACK_REFUSED' && /ispl/.test(m.error.message), 5000), 'refused, and the members are told');
  assert.equal((await alice.get(`/api/projects/${pidU}/jsg`)).json.hash, before.hash, 'the file is unchanged');
  root.setAttribute('type', 'uhb');
  assert.ok(await a.settled(name));
  const fl = await a.flush(name, true);
  assert.ok(fl.info.hash);
  a.close();
});

test('an external change (a save by version from the Publication page, an import, a restore) merges into the live room and keeps the unwritten edits', async () => {
  const name = roomOf(pidU);
  const a = await client(alice);
  const ja = await a.join(name); assert.ok(!ja.error);
  await a.flush(name, false);
  const base = (await alice.get(`/api/projects/${pidU}/jsg`)).json;
  edit(ja.room.doc, (m) => { const p = firstPara(m, 0); p.inline = [{ t: 'text', text: `UNWRITTEN ${plainOf(p.inline)}` }]; });
  assert.ok(await a.settled(name));
  // bob saves by version, changing a paragraph in another chapter (his copy is the file: without alice's unwritten words)
  const m = xml.readJsg(new DOMParser().parseFromString(base.xml, 'text/xml').documentElement);
  firstPara(m, 1).inline = [{ t: 'text', text: 'EXTERNAL WORDS' }];
  const put = await bob.put(`/api/projects/${pidU}/jsg`, { xml: xml.serializeJsg(m), baseHash: base.hash });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.ok(await until(() => textOf(ja.room.doc.getXmlFragment('xml')).includes('EXTERNAL WORDS'), 6000), 'the room got the external change');
  assert.ok(textOf(ja.room.doc.getXmlFragment('xml')).includes('UNWRITTEN '), 'alice\'s unwritten edit is kept');
  const fl = await a.flush(name, true);
  const now = (await alice.get(`/api/projects/${pidU}/jsg`)).json;
  assert.equal(now.hash, fl.info.hash);
  assert.match(now.xml, /UNWRITTEN /); assert.match(now.xml, /EXTERNAL WORDS/);
  a.close();
});

test('check-out is the optional lock: a whole-document or a section check-out makes the room read-only for the others ("Locked by"), check-in frees it live', async () => {
  const name = roomOf(pidU);
  const a = await client(alice); const b = await client(bob);
  await a.join(name); const jb = await b.join(name);
  assert.equal(jb.room.state.writable, true);
  assert.equal((await alice.post(`/api/projects/${pidU}/jsg/checkout`, {})).status, 200);
  assert.ok(await until(() => b.room(name).state.code === 'CHECKED_OUT'), 'bob is told at once');
  assert.match(b.room(name).state.reason, /Locked by alicejsg/);
  assert.equal(a.room(name).state.writable, true, 'the holder writes');
  edit(jb.room.doc, (m) => { firstPara(m, 0).inline = [{ t: 'text', text: 'BLOCKED' }]; });
  assert.ok(await b.waitFor((m) => m.type === proto.MSG.ERROR && m.error.code === 'READ_ONLY', 3000), 'bob\'s change is refused');
  assert.equal((await alice.del(`/api/projects/${pidU}/jsg/checkout`)).json.released, true);
  assert.ok(await until(() => b.room(name).state.writable === true), 'free again, live');
  // a section check-out (D22) locks the live document too: the room is one document
  const leaseOk = await bob.post(`/api/projects/${pidU}/jsg/checkout`, { part: 'section:s2' });
  if (leaseOk.status === 200) {
    assert.ok(await until(() => a.room(name).state.code === 'CHECKED_OUT'), 'a part check-out locks the room for the others');
    assert.equal((await bob.del(`/api/projects/${pidU}/jsg/checkout?part=${encodeURIComponent('section:s2')}`)).status, 200);
    assert.ok(await until(() => a.room(name).state.writable === true));
  }
  a.close(); b.close();
  assert.ok(findEl, 'helpers loaded');
});
