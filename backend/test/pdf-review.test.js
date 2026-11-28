'use strict';
// Phase 3 (P3-4): PDF review. Threads anchored on a page of a project PDF (a build, a preview, a PDF kept in the project):
//   - the routes: list the reviewable PDFs, serve one with its version hash, create / reply / status / edit / delete / place again, export
//     (CSV and XFDF), the release setting; every write is audited (pdfreview.*)
//   - permissions by project role: viewer reads; reviewer creates, replies, resolves, may not accept a suggestion; an Author (editor)
//     accepts / rejects; only the writer or a manager/owner edits or deletes; a stranger gets the uniform 404, anonymous 401
//   - re-anchoring: a new version of the PDF moves each thread by its text quote (exact, then approximate, in the page neighbourhood, then the
//     whole document); one that cannot be found stays with its old page and quote as "orphaned" (needs re-anchoring) and is never lost;
//     an area on a picture is kept and flagged; placing a thread again by hand
//   - the link to the source: a quote that is in a data module names that module
//   - live: changes are pushed over the project WebSocket (type 'pdf-annotations'), no polling
//   - release: blocked while required threads are open when the project says so (default off)
// The PDFs are written by the test itself (a few lines of Helvetica text), so no FOP build is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let owner; let reviewer; let author; let viewer; let stranger; let id; let dir; let anchorLib;
const P = (s) => `/api/projects/${id}/pdf-review${s}`;

/** A PDF with one page per entry; each page is a list of [x, y, text] lines in Helvetica 11. */
function makePdf(pages) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null); const pagesObj = add(null); const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const lines of pages) {
    const stream = lines.map(([x, y, t]) => `BT /F1 11 Tf ${x} ${y} Td (${esc(t)}) Tj ET`).join('\n');
    const c = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((b, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const SOURCE_LINE = 'The torque wrench must be calibrated every six months by the workshop.';
const V1 = [
  [[72, 770, 'Maintenance manual']],
  [[72, 770, 'Check the hydraulic pressure before you start the main engine.'], [72, 740, 'Remove the access panel from the lower fuselage.'], [72, 710, SOURCE_LINE]],
  [[72, 770, 'Figure 1 Pump'], [72, 400, 'Page three ends here.']],
];
// version 2: a new cover page in front (every page moves down by one), "pressure" became "pressures", the access panel line is gone
const V2 = [
  [[72, 770, 'Cover']],
  [[72, 770, 'Maintenance manual']],
  [[72, 770, 'Check the hydraulic pressures before you start the main engine.'], [72, 710, SOURCE_LINE]],
  [[72, 770, 'Figure 1 Pump'], [72, 400, 'Page three ends here.']],
];

async function user(username, fullName) {
  const made = await admin.post('/api/team/users', { username, fullName, role: 'author' });
  const c = new h.Client(username); c.id = made.json.user.id;
  await c.post('/api/auth/login', { username, password: made.json.tempPassword });
  await c.post('/api/auth/onboarding', { username, password: PW });
  return c;
}

/** The anchor a client makes for `exact` on page `page` of the PDF on disk (the shared module, exactly as the viewer uses it). */
async function anchorFor(file, page, exact) {
  const { openPdf } = require('../dist/services/importer/recover/pdfjs');
  const pdf = await openPdf(file);
  try {
    const pg = await pdf.doc.getPage(page);
    const ix = anchorLib.buildPageIndex(anchorLib.runsFromTextContent((await pg.getTextContent()).items));
    const m = anchorLib.findQuote(ix, { exact });
    assert.ok(m, `"${exact}" is on page ${page}`);
    return { page, rects: anchorLib.rectsFor(ix, m.start, m.end), quote: { exact, ...anchorLib.contextOf(ix, m.start, m.end) } };
  } finally { await pdf.close(); }
}

test.before(async () => {
  h = await boot({ ws: true });
  anchorLib = require('../dist/shared/pdfAnchor');
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  owner = await user('olga', 'Olga Owner');
  reviewer = await user('rob', 'Rob Reviewer');
  author = await user('ann', 'Ann Author');
  viewer = await user('vic', 'Vic Viewer');
  stranger = await user('sam', 'Sam Stranger');
  id = (await owner.post('/api/projects', { name: 'PDF review', pipeline: 's1000dtofo' })).json.project.id;
  for (const [u, role] of [['rob', 'reviewer'], ['ann', 'editor'], ['vic', 'viewer']]) assert.equal((await owner.post(`/api/projects/${id}/assign`, { username: u, role })).status, 200);
  // a data module that holds one line of the PDF (the link back to the source)
  const FIX = path.join(DM21, '5-0'); const file = JSON.parse(fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8')).descript;
  const xml = fs.readFileSync(path.join(FIX, file), 'utf8').replace('Nested levelled paragraph.', SOURCE_LINE);
  assert.equal((await owner.post(`/api/projects/${id}/dms`, { file, xml })).status, 201);
  dir = require('../dist/context').projectDirFor(id);
  fs.writeFileSync(path.join(dir, 'jss-output.pdf'), makePdf(V1));
  fs.mkdirSync(path.join(dir, 'Media'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Media', 'reference.pdf'), makePdf([[[72, 770, 'A reference document kept in the project.']]]));
});
test.after(async () => { await h.close(); });

test('the shared anchor module: white space and line breaks do not matter, context picks the right occurrence, an approximate match is found', () => {
  const run = (str, x, y) => ({ str, x, y, w: str.length * 5, h: 10 });
  const ix = anchorLib.buildPageIndex([run('Open the valve. Close', 0, 700), run('the valve slowly.', 0, 688), run('Open the valve again.', 0, 676)]);
  const a = anchorLib.findQuote(ix, { exact: 'Close the   valve', prefix: 'Open the valve. ', suffix: ' slowly.' });
  assert.ok(a && a.exact);
  assert.equal(anchorLib.rectsFor(ix, a.start, a.end).length, 2, 'a quote over a line break is two rectangles');
  const second = anchorLib.findQuote(ix, { exact: 'Open the valve', prefix: 'slowly. ', suffix: ' again.' });
  assert.ok(second.start > a.start, 'the context chooses the second "Open the valve"');
  assert.equal(anchorLib.findQuote(ix, { exact: 'Close the vaIve slowIy' }), null, 'not exact');
  const fuzzy = anchorLib.findQuote(ix, { exact: 'Close the vaIve slowIy' }, { fuzzy: true });
  assert.ok(fuzzy && !fuzzy.exact, 'found approximately');
  assert.deepEqual(anchorLib.neighbourhood(1, 10), [1, 2, 3, 4]);
  assert.equal(anchorLib.cleanRects([[1, 2, 'x', 4]]), null, 'a rectangle with a non-number is refused');
});

test('the reviewable PDFs are listed and served with their version; keys outside the project are refused', async () => {
  const list = await viewer.get(`/api/projects/${id}/pdf-review/files`);
  assert.equal(list.status, 200);
  const keys = list.json.files.map((f) => f.key);
  assert.ok(keys.includes('jss-output.pdf') && keys.includes('Media/reference.pdf'), keys.join(','));
  assert.equal(list.json.files.find((f) => f.key === 'jss-output.pdf').kind, 'build');
  assert.deepEqual(list.json.me.can, { create: false, reply: false, resolve: false, decide: false, moderate: false, settings: false });
  const f = await viewer.get(`/api/projects/${id}/pdf-review/file?key=jss-output.pdf`);
  assert.equal(f.status, 200);
  assert.match(f.headers.get('x-pdf-hash'), /^[0-9a-f]{64}$/);
  assert.equal(f.buf.slice(0, 5).toString(), '%PDF-');
  for (const bad of ['../project.json', '..%2F..%2Fx.pdf', 'csdb/../../x.pdf', '.hidden.pdf', 'project.json']) assert.equal((await viewer.get(`/api/projects/${id}/pdf-review/file?key=${bad}`)).status, 400, bad);
  assert.equal((await viewer.get(`/api/projects/${id}/pdf-review/file?key=missing.pdf`)).status, 404);
  assert.equal((await stranger.get(`/api/projects/${id}/pdf-review/files`)).status, 404, 'a stranger gets the uniform 404');
  assert.equal((await new h.Client('anon').get(`/api/projects/${id}/pdf-review/files`)).status, 401);
});

let commentId; let suggestionId; let orphanId; let areaId; let sourceId;
test('a reviewer comments on a selection, suggests a change and draws an area; the viewer sees them; the viewer cannot write', async () => {
  const file = path.join(dir, 'jss-output.pdf');
  const hash = (await viewer.get(`/api/projects/${id}/pdf-review/file?key=jss-output.pdf`)).headers.get('x-pdf-hash');
  const mine = await h.socket(viewer);
  assert.ok(mine.opened, 'the viewer listens on the project WebSocket');
  const c = await reviewer.post(`/api/projects/${id}/pdf-review/annotations`, { fileKey: 'jss-output.pdf', fileHash: hash, kind: 'comment', body: 'Say which gauge.', required: true, anchor: await anchorFor(file, 2, 'hydraulic pressure') });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  commentId = c.json.annotation.id;
  assert.equal(c.json.annotation.page, 2); assert.equal(c.json.annotation.anchorState, 'placed'); assert.equal(c.json.annotation.required, true);
  assert.equal(c.json.annotation.author.name, 'Rob Reviewer');
  const pushed = await mine.waitFor((m) => m.type === 'pdf-annotations' && m.change === 'created' && m.id === commentId);
  assert.ok(pushed, 'the new thread is pushed to a reader of the project');
  assert.equal(pushed.fileKey, 'jss-output.pdf'); assert.equal(pushed.annotation.body, 'Say which gauge.');

  const s = await reviewer.post(`/api/projects/${id}/pdf-review/annotations`, { fileKey: 'jss-output.pdf', fileHash: hash, kind: 'suggestion', body: '', replacement: 'Check the hydraulic pressures', anchor: await anchorFor(file, 2, 'Check the hydraulic pressure before you start the main engine.') });
  assert.equal(s.status, 201, JSON.stringify(s.json)); suggestionId = s.json.annotation.id;
  const o = await reviewer.post(`/api/projects/${id}/pdf-review/annotations`, { fileKey: 'jss-output.pdf', kind: 'remark', body: 'Panel number?', anchor: await anchorFor(file, 2, 'Remove the access panel') });
  assert.equal(o.status, 201); orphanId = o.json.annotation.id;
  const ar = await reviewer.post(`/api/projects/${id}/pdf-review/annotations`, { fileKey: 'jss-output.pdf', kind: 'comment', body: 'The picture is missing.', anchor: { page: 3, area: true, rects: [[100, 500, 300, 650]], quote: null } });
  assert.equal(ar.status, 201, JSON.stringify(ar.json)); areaId = ar.json.annotation.id;
  const src = await reviewer.post(`/api/projects/${id}/pdf-review/annotations`, { fileKey: 'jss-output.pdf', kind: 'comment', body: 'Which workshop?', anchor: await anchorFor(file, 2, 'calibrated every six months') });
  assert.equal(src.status, 201); sourceId = src.json.annotation.id;
  assert.equal(src.json.annotation.source?.kind, 'dm', 'the quote was traced to its data module');
  assert.match(src.json.annotation.source.file, /^DMC-EXAMPLE-A-00-00-01-00A-040A-D/);

  assert.equal((await reviewer.post(`/api/projects/${id}/pdf-review/annotations`, { fileKey: 'jss-output.pdf', fileHash: '0'.repeat(64), kind: 'comment', body: 'x', anchor: await anchorFor(file, 2, 'hydraulic') })).json.code, 'PDF_CHANGED', 'a comment on an older version is refused');
  for (const bad of [{ kind: 'shout' }, { kind: 'comment', body: '' }, { kind: 'suggestion', body: 'x' }, { kind: 'comment', body: 'x', anchor: { page: 0, rects: [[0, 0, 1, 1]], quote: { exact: 'a' } } }, { kind: 'comment', body: 'x', anchor: { page: 1, rects: [[0, 0, 1, 1]] } }]) {
    const r = await reviewer.post(`/api/projects/${id}/pdf-review/annotations`, { fileKey: 'jss-output.pdf', anchor: { page: 1, rects: [[0, 0, 1, 1]], quote: { exact: 'Maintenance' } }, ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const v = await viewer.post(`/api/projects/${id}/pdf-review/annotations`, { fileKey: 'jss-output.pdf', kind: 'comment', body: 'x', anchor: { page: 1, rects: [[0, 0, 1, 1]], quote: { exact: 'Maintenance' } } });
  assert.equal(v.status, 403); assert.equal(v.json.code, 'INSUFFICIENT_ROLE');
  const list = await viewer.get(`/api/projects/${id}/pdf-review/annotations?key=jss-output.pdf`);
  assert.equal(list.status, 200);
  assert.equal(list.json.annotations.length, 5);
  assert.equal(list.json.file.version, 1);
  const sum = await viewer.get(`/api/projects/${id}/pdf-review/summary`);
  assert.deepEqual([sum.json.open, sum.json.openRequired, sum.json.blockRelease], [5, 1, false]);
  mine.close();
});

test('replies, status by role: a reviewer resolves but cannot accept a suggestion; the Author accepts; only the writer or a manager edits or deletes', async () => {
  const rp = await author.post(`/api/projects/${id}/pdf-review/annotations/${commentId}/replies`, { body: 'The main gauge, fixed.' });
  assert.equal(rp.status, 201); assert.equal(rp.json.annotation.replies.length, 1);
  assert.equal((await viewer.post(`/api/projects/${id}/pdf-review/annotations/${commentId}/replies`, { body: 'me too' })).status, 403);
  const acc = await reviewer.post(`/api/projects/${id}/pdf-review/annotations/${suggestionId}/status`, { status: 'accepted' });
  assert.equal(acc.status, 403); assert.equal(acc.json.code, 'PDF_REVIEW_ROLE');
  assert.equal((await author.post(`/api/projects/${id}/pdf-review/annotations/${suggestionId}/status`, { status: 'accepted' })).json.annotation.status, 'accepted');
  assert.equal((await author.post(`/api/projects/${id}/pdf-review/annotations/${commentId}/status`, { status: 'accepted' })).json.code, 'NOT_A_SUGGESTION');
  assert.equal((await reviewer.post(`/api/projects/${id}/pdf-review/annotations/${commentId}/status`, { status: 'resolved' })).json.annotation.status, 'resolved');
  assert.equal((await reviewer.post(`/api/projects/${id}/pdf-review/annotations/${commentId}/status`, { status: 'open' })).json.annotation.status, 'open');
  assert.equal((await viewer.post(`/api/projects/${id}/pdf-review/annotations/${commentId}/status`, { status: 'resolved' })).status, 403);
  assert.equal((await reviewer.post(`/api/projects/${id}/pdf-review/annotations/${commentId}/status`, { status: 'done' })).status, 400);

  const notMine = await author.put(`/api/projects/${id}/pdf-review/annotations/${commentId}`, { body: 'changed by someone else' });
  assert.equal(notMine.status, 403); assert.equal(notMine.json.code, 'NOT_YOURS');
  const cur = (await reviewer.get(`/api/projects/${id}/pdf-review/annotations?key=jss-output.pdf`)).json.annotations.find((a) => a.id === commentId);
  assert.equal((await reviewer.put(`/api/projects/${id}/pdf-review/annotations/${commentId}`, { body: 'Say which gauge (main).', updatedAt: cur.updatedAt })).status, 200);
  assert.equal((await reviewer.put(`/api/projects/${id}/pdf-review/annotations/${commentId}`, { body: 'stale', updatedAt: cur.updatedAt })).json.code, 'EDIT_CONFLICT', 'a stale edit is a conflict');
  assert.equal((await reviewer.del(`/api/projects/${id}/pdf-review/annotations/${commentId}`)).json.code, 'HAS_REPLIES', 'the writer cannot delete a thread others replied to');
  assert.equal((await stranger.del(`/api/projects/${id}/pdf-review/annotations/${commentId}`)).status, 404);
  const tmp = await reviewer.post(`/api/projects/${id}/pdf-review/annotations`, { fileKey: 'Media/reference.pdf', kind: 'remark', body: 'temporary', anchor: { page: 1, rects: [[72, 765, 200, 780]], quote: { exact: 'reference document' } } });
  assert.equal(tmp.status, 201, 'a PDF kept in the project can be annotated too');
  assert.equal((await author.del(`/api/projects/${id}/pdf-review/annotations/${tmp.json.annotation.id}`)).status, 403);
  assert.equal((await owner.del(`/api/projects/${id}/pdf-review/annotations/${tmp.json.annotation.id}`)).status, 200, 'the owner moderates');
});

test('a new build re-anchors by the text quote: moved with the pages, an approximate match, an orphan kept with its old page and quote, an area kept and flagged', async () => {
  const ws = await h.socket(author);
  fs.writeFileSync(path.join(dir, 'jss-output.pdf'), makePdf(V2));
  const list = await author.get(`/api/projects/${id}/pdf-review/annotations?key=jss-output.pdf`);
  assert.equal(list.status, 200);
  assert.equal(list.json.file.version, 2); assert.equal(list.json.file.versions, 2);
  const by = Object.fromEntries(list.json.annotations.map((a) => [a.id, a]));
  const hash = list.json.file.hash;
  assert.ok(Object.values(by).every((a) => a.fileHash === hash), 'every thread now belongs to the new version');
  assert.deepEqual([by[commentId].page, by[commentId].anchorState], [3, 'moved'], 'the exact quote moved with the inserted page');
  assert.equal(by[commentId].orig.page, 2, 'where it was first made is kept');
  assert.equal(by[suggestionId].page, 3); assert.equal(by[suggestionId].anchorState, 'moved');
  assert.equal(by[suggestionId].anchor.fuzzy, true, '"pressure" -> "pressures": an approximate match');
  assert.deepEqual([by[orphanId].anchorState, by[orphanId].page, by[orphanId].anchor.quote.exact], ['orphaned', 2, 'Remove the access panel'], 'the orphan keeps its old page and quote');
  assert.deepEqual([by[areaId].anchorState, by[areaId].page], ['unverified', 3], 'an area without words stays where it was, flagged');
  assert.equal(by[sourceId].page, 3);
  assert.ok(await ws.waitFor((m) => m.type === 'pdf-annotations' && m.change === 'reanchored' && m.fileKey === 'jss-output.pdf'), 're-anchoring is pushed');
  ws.close();
  // a second read does not move anything again
  const again = (await viewer.get(`/api/projects/${id}/pdf-review/annotations?key=jss-output.pdf`)).json.annotations.find((a) => a.id === commentId);
  assert.equal(again.updatedAt, by[commentId].updatedAt);
  // the orphan is placed again by hand on the new version
  const placed = await reviewer.post(`/api/projects/${id}/pdf-review/annotations/${orphanId}/place`, { fileHash: hash, anchor: await anchorFor(path.join(dir, 'jss-output.pdf'), 3, 'start the main engine') });
  assert.equal(placed.status, 200, JSON.stringify(placed.json));
  assert.deepEqual([placed.json.annotation.anchorState, placed.json.annotation.page], ['placed', 3]);
  assert.equal((await viewer.post(`/api/projects/${id}/pdf-review/annotations/${orphanId}/place`, { anchor: { page: 1, rects: [[0, 0, 1, 1]], quote: { exact: 'Cover' } } })).status, 403);
});

test('export: CSV for a spreadsheet and XFDF for a PDF reader', async () => {
  const csv = await viewer.get(`/api/projects/${id}/pdf-review/export?format=csv&key=jss-output.pdf`);
  assert.equal(csv.status, 200);
  const text = csv.buf.toString('utf8');
  assert.match(text, /"Thread","PDF","Page"|Thread,PDF,Page/);
  assert.match(text, /The main gauge, fixed\./, 'replies are exported');
  const all = await viewer.get(`/api/projects/${id}/pdf-review/export?format=csv`);
  assert.equal(all.status, 200, 'the whole project as CSV');
  const x = await viewer.get(`/api/projects/${id}/pdf-review/export?format=xfdf&key=jss-output.pdf`);
  assert.equal(x.status, 200);
  const doc = new DOMParser().parseFromString(x.buf.toString('utf8'), 'text/xml');
  assert.equal(doc.documentElement.tagName, 'xfdf');
  assert.equal(doc.getElementsByTagName('highlight').length, 4);
  assert.equal(doc.getElementsByTagName('square').length, 1);
  const accepted = [...Array.from(doc.getElementsByTagName('text'))].find((t) => t.getAttribute('state') === 'Accepted');
  assert.ok(accepted, 'the accepted suggestion carries its review state');
  assert.equal((await viewer.get(`/api/projects/${id}/pdf-review/export?format=xfdf`)).status, 400, 'XFDF names one PDF');
  assert.equal((await viewer.get(`/api/projects/${id}/pdf-review/export?format=pdf`)).status, 400);
});

test('release: blocked while required threads are open when the project says so; the setting is the manager\'s', async () => {
  const rel = await viewer.get(`/api/projects/${id}/release`);
  assert.equal(rel.status, 200);
  assert.equal(rel.json.pdfReview.openRequired, 1);
  assert.equal((await reviewer.put(`/api/projects/${id}/pdf-review/settings`, { blockRelease: true })).status, 403);
  assert.equal((await owner.put(`/api/projects/${id}/pdf-review/settings`, { blockRelease: 'yes' })).status, 400);
  const on = await owner.put(`/api/projects/${id}/pdf-review/settings`, { blockRelease: true });
  assert.equal(on.status, 200); assert.equal(on.json.blockRelease, true);
  const sub = await owner.post(`/api/projects/${id}/release`, { note: 'please' });
  assert.equal(sub.status, 409); assert.equal(sub.json.code, 'PDF_REVIEW_OPEN');
  await author.post(`/api/projects/${id}/pdf-review/annotations/${commentId}/status`, { status: 'resolved' });
  const after = await owner.post(`/api/projects/${id}/release`, { note: 'please' });
  assert.notEqual(after.json?.code, 'PDF_REVIEW_OPEN', 'with the required thread resolved the PDF review no longer blocks (the publish gate decides the rest)');
  assert.equal((await owner.put(`/api/projects/${id}/pdf-review/settings`, { blockRelease: false })).status, 200);
});

test('phase 8: XFDF from a PDF reader becomes threads: highlight quads give the quote, a square is an area, replies and review states follow', async () => {
  const key = 'Media/reference.pdf';
  const exact = 'A reference document kept in the project.';
  const a = await anchorFor(path.join(dir, key), 1, exact);
  const q = a.rects.map((r) => [r[0], r[3], r[2], r[3], r[0], r[1], r[2], r[1]].join(',')).join(',');
  const box = a.rects[0];
  const xfdf = `<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><annots>
<highlight page="0" name="h1" title="Acro Reader" creationdate="D:20261120101500+00'00'" rect="${box.join(',')}" coords="${q}"><contents>Is this still current?</contents></highlight>
<square page="0" name="s1" title="Acro Reader" rect="300,100,400,200"><contents>An empty corner.</contents></square>
<text page="0" name="r1" inreplyto="h1" title="Other Person" rect="0,0,10,10"><contents>Yes, checked.</contents></text>
<text page="0" name="r2" inreplyto="h1" title="Acro Reader" state="Completed" statemodel="Review" rect="0,0,10,10"/>
<text page="0" name="r3" inreplyto="nobody" rect="0,0,10,10"><contents>lost</contents></text>
<square page="9" name="bad" rect="1,1,2,2"><contents>no such page</contents></square>
<link page="0" rect="1,1,2,2"/>
</annots><f href="reference.pdf"/></xfdf>`;
  assert.equal((await viewer.post(P('/import'), { key, xfdf })).status, 403, 'a viewer cannot import');
  assert.equal((await reviewer.post(P('/import'), { key, xfdf: '<notxfdf/>' })).status, 400);
  assert.equal((await reviewer.post(P('/import'), { key, xfdf: '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///c:/windows/win.ini">]><xfdf>&e;</xfdf>' })).status, 400, 'unsafe XML is refused');
  assert.equal((await reviewer.post(P('/import'), { key: '../x.pdf', xfdf })).status >= 400, true, 'a key outside the project is refused');
  const r = await reviewer.post(`/api/projects/${id}/pdf-review/import`, { key, xfdf });
  assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 400));
  assert.equal(r.json.annotations.length, 2); assert.equal(r.json.replies, 1);
  assert.equal(r.json.skipped.length, 3, 'the reply to nothing, the page that is not there and the link are named: ' + r.json.skipped.join(' | '));
  const listed = (await viewer.get(P(`/annotations?key=${encodeURIComponent(key)}`))).json.annotations;
  const hl = listed.find((x) => x.body.includes('Is this still current?'));
  assert.ok(hl); assert.equal(hl.anchor.quote.exact, exact, 'the words under the quads are the quote'); assert.ok(!hl.anchor.area);
  assert.match(hl.body, /^\[Acro Reader, 2026-11-20\] /); assert.equal(hl.status, 'resolved', 'Completed in the reader = resolved');
  assert.equal(hl.replies.length, 1); assert.match(hl.replies[0].body, /^\[Other Person\] Yes, checked\./);
  const sq = listed.find((x) => x.body.includes('An empty corner.'));
  assert.ok(sq.anchor.area); assert.equal(sq.anchorState, 'unverified', 'an area over no text is kept and flagged');
});

test('phase 8: the project archive carries the PDF review; the copy has new ids, the same anchors, replies and setting', async () => {
  const { ZipFileReader } = require('../dist/services/zipio');
  const { tmp } = require('./helpers');
  await owner.put(P('/settings'), { blockRelease: true });
  const before = (await viewer.get(P('/annotations'))).json.annotations;
  const ex = await owner.get(`/api/projects/${id}/export`); assert.equal(ex.status, 200);
  const f = path.join(tmp('pdfarch-'), 'a.zip'); fs.writeFileSync(f, ex.buf);
  const zr = ZipFileReader.open(f);
  try { const e = zr.entries.find((x) => x.name === 'pdf-review.json'); assert.ok(e, 'pdf-review.json is in the archive'); const j = JSON.parse((await zr.readBuffer(e)).toString('utf8')); assert.equal(j.annotations.length, before.length); assert.ok(j.versions.length >= 1); }
  finally { zr.close(); }
  const fd = new FormData(); fd.append('file', new Blob([ex.buf]), 'a.jsspub.zip'); fd.append('source', 's1000d'); fd.append('target', 's1000d'); fd.append('name', 'PDF review copy');
  const back = await owner.req('POST', '/api/xengine/import', fd);
  assert.equal(back.status, 201, JSON.stringify(back.json).slice(0, 400)); assert.equal(back.json.restored.pdfComments, before.length);
  const B = `/api/projects/${back.json.project.id}/pdf-review`;
  const after = (await owner.get(`${B}/annotations`)).json.annotations;
  assert.equal(after.length, before.length);
  const ids = new Set(before.map((x) => x.id)); assert.ok(after.every((x) => !ids.has(x.id)), 'new ids');
  for (const o of before) {
    const c = after.find((x) => x.body.endsWith(o.body.replace(/^\[[^\]]*\] /, '')) && x.fileKey === o.fileKey && x.createdAt === o.createdAt);
    assert.ok(c, `thread "${o.body.slice(0, 40)}" is in the copy`);
    assert.deepEqual(c.anchor, o.anchor, 'the anchor is kept'); assert.equal(c.status, o.status); assert.equal(c.kind, o.kind); assert.equal(c.required, o.required);
    assert.equal(c.replies.length, o.replies.length); assert.equal(c.fileHash, o.fileHash); assert.equal(c.updatedAt, o.updatedAt, 'its own time');
  }
  assert.equal((await owner.get(`${B}/summary`)).json.blockRelease, true, 'the release setting travels');
  await owner.put(P('/settings'), { blockRelease: false });
});

test('every PDF review write is in the audit log', async () => {
  const actions = new Set();
  for (const a of ['pdfreview.created', 'pdfreview.replied', 'pdfreview.status', 'pdfreview.edited', 'pdfreview.deleted', 'pdfreview.placed', 'pdfreview.settings', 'pdfreview.exported', 'pdfreview.imported']) {
    const r = await admin.get(`/api/admin/audit?action=${encodeURIComponent(a)}&limit=50`);
    if (r.json.entries.some((e) => e.action === a && e.projectId === id)) actions.add(a);
  }
  assert.deepEqual([...actions].sort(), ['pdfreview.created', 'pdfreview.deleted', 'pdfreview.edited', 'pdfreview.exported', 'pdfreview.imported', 'pdfreview.placed', 'pdfreview.replied', 'pdfreview.settings', 'pdfreview.status']);
});
