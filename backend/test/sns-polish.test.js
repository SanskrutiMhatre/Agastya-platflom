'use strict';
// SNS polish: what an import preview shows (rows already present, title differences that are only capital letters), the Administrator's older
// two-column table merged into the organisation defaults (at the first read and again on request), and the timestamped history of derive backups.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(__dirname, 'fixtures', 'sns', 'dms');

let h; let admin; let alice; let pid;

async function person(role, username) {
  const made = await admin.post('/api/team/users', { username, fullName: `${username} person`, role });
  const c = new h.Client(username);
  await c.post('/api/auth/login', { username, password: made.json.tempPassword });
  await c.post('/api/auth/onboarding', { username, password: PW });
  return c;
}

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Site Admin' });
  alice = await person('author', 'alice');
});
test.after(async () => { await h.close(); });

// The Administrator's older two-column SNS table is no longer a screen or an API (the SNS presets replaced it, and the boot step carries what an
// administrator had typed into a preset), but an upgraded database may still hold its rows. They are written the way such a database holds them.
const legacy = (code, name) => require('../dist/context').store.configPut('sns', `legacy-${code}`, { code, name }, new Date().toISOString());

test('the older table is merged into defaults that already hold rows, not only into empty ones', async () => {
  // Before anything has read the defaults: a row is already in them (restored, or written by a tool), and the older table holds others.
  const { store } = require('../dist/context');
  store.configPut('sns-defaults', 'preexisting-1', { systemCode: 'B10', title: 'Pre-existing system' }, new Date().toISOString());
  legacy('A05', 'Air conditioning');
  legacy('B10', 'A different name for B10');

  const defaults = (await alice.get('/api/sns/defaults')).json.rows;
  const byCode = Object.fromEntries(defaults.map((r) => [r.systemCode, r.title]));
  assert.equal(byCode.A05, 'Air conditioning', 'the older row is not lost because the defaults were not empty');
  assert.equal(byCode.B10, 'Pre-existing system', 'a title that is already in the defaults is never replaced by the older table');
});

test('the older table can be merged again on request: preview writes nothing, apply adds what is missing and reports what differs', async () => {
  legacy('C20', 'Communications');

  assert.equal((await alice.post('/api/sns/defaults/merge-legacy', { apply: false })).status, 403, 'only an administrator');

  const before = (await alice.get('/api/sns/defaults')).json.rows.length;
  const prev = await admin.post('/api/sns/defaults/merge-legacy', { apply: false });
  assert.equal(prev.status, 200, JSON.stringify(prev.json));
  assert.equal(prev.json.applied, false);
  assert.ok(prev.json.added.some((r) => r.systemCode === 'C20'));
  assert.equal((await alice.get('/api/sns/defaults')).json.rows.length, before, 'a preview writes nothing');

  const ap = await admin.post('/api/sns/defaults/merge-legacy', { apply: true });
  assert.equal(ap.status, 200);
  assert.ok(ap.json.added.some((r) => r.systemCode === 'C20'));
  const rows = (await alice.get('/api/sns/defaults')).json.rows;
  assert.equal(rows.length, before + ap.json.added.length);
  assert.equal(rows.find((r) => r.systemCode === 'A05').title, 'Air conditioning', 'the existing title is kept');

  const again = await admin.post('/api/sns/defaults/merge-legacy', { apply: true });
  assert.equal(again.json.added.length, 0, 'idempotent');
  assert.ok(again.json.same >= 1 && again.json.present.some((p) => p.code && p.title));
  assert.ok(again.json.conflicts.some((c) => c.code === 'B10' && c.overwritten === false), 'B10 differs between the two tables: reported, kept');
});

test('an import preview names the rows that are already present and shows a title that differs only in capitals', async () => {
  pid = (await alice.post('/api/projects', { name: 'Polish' })).json.project.id;
  const base = `/api/projects/${pid}/sns-rows`;
  assert.equal((await alice.post(base, { systemCode: 'A05', title: 'Air conditioning' })).status, 201);   // same as the default
  assert.equal((await alice.post(base, { systemCode: 'B10', title: 'PRE-EXISTING SYSTEM' })).status, 201); // the default differs only in capitals
  assert.equal((await alice.post(base, { systemCode: 'C20', title: 'Radio' })).status, 201);               // a real difference

  const prev = await alice.post(`${base}/import-defaults`, { apply: false });
  assert.equal(prev.status, 200, JSON.stringify(prev.json));
  assert.equal(prev.json.same, 1);
  assert.deepEqual(prev.json.present.map((p) => p.code), ['A05']);
  assert.equal(prev.json.present[0].title, 'Air conditioning');

  const byCode = Object.fromEntries(prev.json.conflicts.map((c) => [c.code, c]));
  assert.equal(byCode.B10.caseOnly, true, 'visible, and flagged as only a matter of capitals');
  assert.equal(byCode.B10.existing, 'PRE-EXISTING SYSTEM');
  assert.equal(byCode.B10.incoming, 'Pre-existing system');
  assert.equal(byCode.C20.caseOnly, undefined, 'a real difference is not flagged');
  assert.equal(prev.json.counts.conflicts, 2);

  // nothing was changed by listing them, and applying keeps both
  const ap = await alice.post(`${base}/import-defaults`, { apply: true });
  assert.equal(ap.json.conflicts.filter((c) => c.overwritten).length, 0);
  const rows = (await alice.get(base)).json.rows;
  assert.equal(rows.find((r) => r.systemCode === 'B10').title, 'PRE-EXISTING SYSTEM');
});

test('each derive keeps its predecessor under a timestamp as well as in <name>.bak, and the history is bounded', async () => {
  const base = `/api/projects/${pid}/sns-rows`;
  for (const f of fs.readdirSync(FIX)) {
    const r = await alice.post(`/api/projects/${pid}/dms`, { file: f, xml: fs.readFileSync(path.join(FIX, f), 'utf8') });
    assert.equal(r.status, 201, `${f}: ${JSON.stringify(r.json)}`);
  }
  const first = await alice.post(`${base}/derive`, { apply: true });
  assert.equal(first.status, 200, JSON.stringify(first.json).slice(0, 300));

  const names = [];
  for (let i = 0; i < 3; i++) {
    const r = await alice.post(`${base}/derive`, { apply: true });
    assert.equal(r.status, 200);
    assert.match(r.json.backup, /\.\d{8}-\d{6}(-\d+)?\.bak$/);
    names.push(r.json.backup);
  }
  assert.equal(new Set(names).size, 3, 'three derives within seconds still give three different files');

  const { projectDirFor } = require('../dist/context');
  const pmDir = (function find(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isFile() && e.name === names[0]) return d; if (e.isDirectory() && !/^(\.|node_modules)/.test(e.name)) { const r = find(path.join(d, e.name)); if (r) return r; } } return null; })(projectDirFor(pid));
  assert.ok(pmDir, 'the backups are next to the publication module');
  const files = fs.readdirSync(pmDir);
  for (const n of names) assert.ok(files.includes(n), `${n} exists`);
  assert.ok(files.some((f) => /\.xml\.bak$/i.test(f) && !/\d{8}-\d{6}/.test(f)), 'the plain .bak is still kept (the latest)');

  // the oldest copies are dropped beyond the limit
  const svc = require('../dist/services/sns/service');
  assert.equal(typeof svc.DERIVE_BACKUPS_KEPT, 'number');
  const stem = names[0].replace(/\.\d{8}-\d{6}(-\d+)?\.bak$/, '');
  for (let i = 0; i < svc.DERIVE_BACKUPS_KEPT + 3; i++) fs.writeFileSync(path.join(pmDir, `${stem}.2020010${1}-0000${String(i).padStart(2, '0')}.bak`), 'old');
  await alice.post(`${base}/derive`, { apply: true });
  const timestamped = fs.readdirSync(pmDir).filter((f) => f.startsWith(stem + '.') && /\.\d{8}-\d{6}(-\d+)?\.bak$/.test(f));
  assert.equal(timestamped.length, svc.DERIVE_BACKUPS_KEPT, 'bounded');
  assert.ok(!fs.existsSync(path.join(pmDir, `${stem}.20200101-000000.bak`)), 'the oldest is the one that went');
});
