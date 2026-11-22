'use strict';
// Page furniture of S1000D publications, as in the reference publications: rotated SIDE TEXT in the left margin ("This is a draft copy of Issue 000-01",
// "Printed <date time>", and the publisher), and a default HEADER LOGO. Both on by default; both can be switched off in the project settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21', '5-0');
const pdf = (buf) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fu-')), 'x.pdf'); fs.writeFileSync(f, buf); return f; };
const text = (f) => spawnSync('pdftotext', [f, '-'], { encoding: 'utf8' }).stdout;
const images = (f) => spawnSync('pdfimages', ['-list', f], { encoding: 'utf8' }).stdout.split('\n').slice(2).filter(Boolean).length;
let h; let w; let U; let dir;

test.before(async () => {
  h = await boot(); const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'A' });
  const m = await admin.post('/api/team/users', { username: 'fern', fullName: 'Fern', role: 'author' });
  w = new h.Client('fern'); await w.post('/api/auth/login', { username: 'fern', password: m.json.tempPassword }); await w.post('/api/auth/onboarding', { username: 'fern', password: PW });
  const pr = await w.post('/api/projects', { name: 'Furniture', format: 's1000d', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  U = `/api/projects/${pr.json.project.id}`; dir = path.join(h.ws, 'projects', pr.json.project.id);
  const f = fs.readdirSync(FIX).find((x) => /-040A-D_/.test(x));
  assert.equal((await w.post(`${U}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') })).status, 201);   // joins the publication by itself
});
test.after(async () => { await h.close(); });
const build = async () => { const b = await w.post(`${U}/publish`, {}); assert.equal(b.status, 200, JSON.stringify(b.json).slice(0, 400)); return pdf((await w.get(`${U}/publish/pdf`)).buf); };

test('by default: the side text (draft note with the issue, the printing time, the publisher) and the header logo are on every build', async () => {
  const f = await build(); const t = text(f).replace(/\s+/g, ' ');
  assert.match(t, /This is a draft copy of Issue 001-00/); assert.match(t, /Printed \d{4}-\d{2}-\d{2} \d{2}:\d{2}/); assert.match(t, /Example Company/);
  assert.ok(images(f) >= 1, 'the default logo is printed in the header');
  assert.match(t, /EXAMPLE-00000-00001-00/, "the header carries the publication module's own code (model - issuer - number - volume), not a placeholder or a demo text"); assert.ok(!/160KVA/.test(t));
});

test('switched off: no side text and no logo; the publisher can be named in the settings', async () => {
  assert.equal((await w.patch(U, { sideText: { enabled: false }, headerLogo: false })).status, 200);
  const off = await build(); const t = text(off).replace(/\s+/g, ' ');
  assert.ok(!/This is a draft copy/.test(t) && !/Printed \d{4}-/.test(t), 'no side text'); assert.equal(images(off), 0, 'no logo');
  assert.equal((await w.patch(U, { sideText: { enabled: true, publisher: 'Acme Rotor Works' }, headerLogo: true })).status, 200);
  assert.match(text(await build()).replace(/\s+/g, ' '), /Acme Rotor Works/);
});
