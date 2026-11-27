'use strict';
// The publisher's logo on the Xignal cover: the platform supplies a default (assets/default-publisher-logo.png) to every build of an
// S1000D project in the reference (Xignal) layout; the title page's own logo, when it names one, wins (stylesheet level: xignal-cover.test.js);
// a project can switch the default off. End to end through the real server and FOP.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot, DM21, tmp } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const ASSET = path.resolve(__dirname, '..', 'assets', 'default-publisher-logo.png');
const pdf = (buf) => { const f = path.join(tmp('pl-'), 'x.pdf'); fs.writeFileSync(f, buf); return f; };
// FOP writes each picture as one /Subtype /Image dictionary (see pdf-furniture.test.js)
const images = (f) => (fs.readFileSync(f).toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
let h; let w; let U; let dir;

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'fern', fullName: 'Fern', role: 'author' });
  w = new h.Client('fern'); await w.post('/api/auth/login', { username: 'fern', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'fern', password: PW });
  const pr = await w.post('/api/projects', { name: 'Cover logo', format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(pr.status, 201, JSON.stringify(pr.json).slice(0, 300));
  assert.equal(pr.json.project.templateRef, 'xignal-s1000d', 'a wizard S1000D project is in the reference layout');
  U = `/api/projects/${pr.json.project.id}`; dir = path.join(h.ws, 'projects', pr.json.project.id);
  const f = fs.readdirSync(FIX).find((x) => /-040A-D_/.test(x));
  assert.equal((await w.post(`${U}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') })).status, 201);
});
test.after(async () => { await h.close(); });
const build = async () => { const b = await w.post(`${U}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 400)); return pdf((await w.get(`${U}/publish/pdf`)).buf); };

test('the default publisher logo is a shipped asset, a PNG with a transparent background', () => {
  const b = fs.readFileSync(ASSET);
  assert.equal(b.slice(1, 4).toString(), 'PNG');
  assert.equal(b[25], 6, 'colour type 6: RGBA, so the page shows through');
});

test('a build of a reference-layout project carries the default publisher logo; the project can switch it off and on again', async () => {
  const card = await w.get(U); assert.equal(card.json.project.publisherLogo, true, 'on by default');

  const on = await build();
  assert.ok(fs.existsSync(path.join(dir, '_publisher-logo.png')), 'the build directory holds the logo the stylesheets are pointed at');
  assert.ok(images(on) >= 1, 'and the cover prints it');

  assert.equal((await w.patch(U, { publisherLogo: false })).status, 200);
  assert.equal((await w.get(U)).json.project.publisherLogo, false);
  const off = await build();
  // the layout's default brand pack (the L&T logos, since 2026-11-26) prints its own header pictures: switching the publisher logo off removes the cover's picture and leaves those
  assert.ok(images(off) < images(on), `switched off: the publisher logo's picture is gone (${images(off)} pictures, was ${images(on)})`);

  assert.equal((await w.patch(U, { publisherLogo: true })).status, 200);
  assert.equal(images(await build()), images(on), 'and back on: the same pictures as the first build');
});
