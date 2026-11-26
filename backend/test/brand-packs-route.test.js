'use strict';
// The brand-pack list the Settings picker reads: only what is installed in THIS workspace (the third-party L&T pack is not seeded),
// a pack installed by copying its folder shows up, its logo is served as an image, and nothing is writable or readable without signing in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
let h; let admin; let author;

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda Writer', role: 'author' });
  author = new h.Client('wanda');
  await author.post('/api/auth/login', { username: 'wanda', password: made.json.tempPassword });
  await author.post('/api/auth/onboarding', { username: 'wanda', password: PW });
});
test.after(async () => { await h.close(); });

test('brand packs: signed-in users list what is installed: the seeded packs are the neutral one and the L&T one (the default logos)', async () => {
  assert.equal((await new h.Client('anon').get('/api/brand-packs')).status, 401);
  const first = await author.get('/api/brand-packs');
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.packs.map((p) => p.id).sort(), ['lnt-xignal', 'neutral']);
  assert.equal(first.json.packs.find((p) => p.id === 'neutral').hasLogo, false);
  const lnt = first.json.packs.find((p) => p.id === 'lnt-xignal');
  assert.equal(lnt.hasLogo, true);
  assert.equal(lnt.company, 'L&T Precision Engineering and Systems');
});

test('brand packs: the logo is served as an image; no logo, an unknown id and a path trick are all 404 and never read outside the pack', async () => {
  const logo = await author.get('/api/brand-packs/lnt-xignal/logo');
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get('content-type'), /^image\/png/);
  assert.equal(logo.buf.subarray(1, 4).toString(), 'PNG');
  assert.equal((await author.get('/api/brand-packs/neutral/logo')).status, 404, 'a pack without a logo');
  assert.equal((await author.get('/api/brand-packs/nope/logo')).status, 404);
  for (const bad of ['..', '..%2Ftemplates', '.hidden', 'a%5Cb']) {
    assert.equal((await author.get(`/api/brand-packs/${bad}/logo`)).status, 404, `refused: ${bad}`);
  }
  assert.equal((await new h.Client('anon').get('/api/brand-packs/lnt-xignal/logo')).status, 401);
  // read-only: there is no write verb
  assert.ok([404, 405].includes((await author.post('/api/brand-packs', { id: 'x' })).status));
  assert.ok([404, 405].includes((await author.del('/api/brand-packs/neutral')).status));
});
