'use strict';
// A project that has been built can be deleted (and so can a picture the build used).
//
// Found on a real installation: "Delete project" answered "Internal error" for a project whose PDF had been built. The server log said
//   EBUSY: resource busy or locked, unlink '...\csdb\ICN-....png'
// The warm FOP renderer (a long-lived Java process) keeps a scaled PNG it has embedded open until the process ends, and Windows will not delete a file another process holds
// open. Rendering a copy of that project's real FO reproduced it: the scaled picture stayed locked, the logos (fixed size) did not, and stopping the renderer freed it.
// services/renderer.ts stops the renderer when a removal fails because a file is in use, and tries again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let w; let fopd; let R; let placeholderPng;

test.before(async () => {
  h = await boot();
  fopd = require('../dist/config').vendor('engine/fopd'); R = require('../dist/services/renderer'); ({ placeholderPng } = require('../dist/services/importer/png'));
  const admin = new h.Client('admin'); await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'builder', fullName: 'Builder', role: 'author' });
  w = new h.Client('builder'); await w.post('/api/auth/login', { username: 'builder', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'builder', password: PW });
});
test.after(async () => { try { fopd.stop(); } catch { /* none */ } if (h) await h.close(); });

// the figure the way the publications write it: a picture with both a width and a height
const FO = (src) => `<?xml version="1.0"?><fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-height="297mm" page-width="210mm"><fo:region-body/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p"><fo:flow flow-name="xsl-region-body"><fo:block keep-together.within-page="always"><fo:external-graphic src="url('${src}')" scaling="uniform" content-width="127mm" content-height="84.67mm"/><fo:block>caption</fo:block></fo:block></fo:flow></fo:page-sequence></fo:root>`;
async function build(dir, picture) {
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, picture), placeholderPng(1)); fs.writeFileSync(path.join(dir, 'x.fo'), FO(picture));
  await fopd.render({ baseDir: dir, foPath: path.join(dir, 'x.fo'), pdfPath: path.join(dir, 'x.pdf') });
}
const inUse = (file) => { try { fs.renameSync(file, `${file}.probe`); fs.renameSync(`${file}.probe`, file); return false; } catch (e) { return R.isFileInUse(e); } };

test('what the removal does: waits out a file in use, passes other errors on at once, and names the file when it stays in use', () => {
  const busy = (p) => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY', path: p });
  let n = 0; assert.equal(R.removeReleasingRenderer(() => { if (++n < 3) throw busy('C:\\p\\a.png'); return 'gone'; }, 'The picture', 5, 5), 'gone'); assert.equal(n, 3);
  let m = 0; assert.throws(() => R.removeReleasingRenderer(() => { m++; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }, 'The picture', 5, 5), /ENOENT/); assert.equal(m, 1, 'not a lock: not retried');
  assert.throws(() => R.removeReleasingRenderer(() => { throw busy('C:\\p\\csdb\\ICN-1.png'); }, 'The project', 2, 5), (e) => e.status === 409 && e.code === 'FILES_IN_USE' && /The project could not be removed: ICN-1\.png is open in another program/.test(e.message));
});

test('the renderer keeps a built picture open; removing it releases the renderer, and the renderer builds again afterwards', { skip: process.platform !== 'win32' && 'file locks of this kind are a Windows behaviour' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'built-')); const pic = path.join(dir, 'ICN-1.png');
  await build(dir, 'ICN-1.png');
  assert.equal(inUse(pic), true, 'after a build the picture is held open by the renderer (the cause of the "Internal error")');
  R.removeReleasingRenderer(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 0 }), 'The project');
  assert.equal(fs.existsSync(dir), false, 'the folder is gone');
  // The vendored fopd.js has a quirk: the OLD process's exit handler calls cleanup(), which kills whichever process is current. A request ends and the event loop turns before the
  // next build, so the old exit has been delivered by then; this test removes and builds in one go, so it lets the loop turn first, as the server does.
  await new Promise((r) => setTimeout(r, 400));
  const again = fs.mkdtempSync(path.join(os.tmpdir(), 'built-')); await build(again, 'ICN-2.png');      // the next build starts the renderer again by itself
  assert.ok(fs.statSync(path.join(again, 'x.pdf')).size > 1000, 'and it still renders');
  R.removeReleasingRenderer(() => fs.rmSync(again, { recursive: true, force: true, maxRetries: 0 }), 'The project');
});

test('Delete project on a project that has been built: it is removed, with its rows, and no "Internal error"', async () => {
  const r = await w.post('/api/projects', { name: 'Built then deleted', format: 's1000d', s1000d: { mic: 'BLT', issue: '5-0', responsiblePartner: { code: '1671Y', name: 'LNTDEFENCE' } } });
  assert.equal(r.status, 201, JSON.stringify(r.json).slice(0, 300)); const id = r.json.project.id; const dir = path.join(h.ws, 'projects', id);
  await build(path.join(dir, 'csdb'), 'ICN-RDR-A-A000000-1-1671Y-02145-A-001-04.png');
  const del = await w.req('DELETE', `/api/projects/${id}?confirm=${encodeURIComponent('Built then deleted')}`);
  assert.equal(del.status, 200, JSON.stringify(del.json).slice(0, 300));
  assert.equal(fs.existsSync(dir), false, 'the project folder is gone');
  assert.ok(!(await w.get('/api/projects')).json.projects.some((p) => p.id === id), 'and so is its entry in the list');
});
