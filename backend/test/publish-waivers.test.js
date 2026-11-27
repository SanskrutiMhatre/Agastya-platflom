'use strict';
// Recorded waivers for the publication gate.
//   - a module that names a BREX the project does not have blocks a build (the gate is strict by default)
//   - an editor records a waiver (who, when and why are stored): the DRAFT build then goes ahead, and says so
//   - a waiver never lets a release request through, never covers a different BREX, and can be withdrawn
//   - the reason is required; a viewer cannot record or withdraw one; a stranger and an anonymous caller are refused
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';
const NAMED = 'modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="Z" itemLocationCode="D"';
const useBrex = (xml, codeAttrs) => xml.replace(/(<brexDmRef>[\s\S]*?<dmCode )[^>]*?(\/>[\s\S]*?<\/brexDmRef>)/, `$1${codeAttrs}$2`);
const blocked = (r) => r.status === 422 && r.json.code === 'VALIDATION_FAILED';

let h; let admin; let author; let viewer; let stranger; let id;
const P = (s) => `/api/projects/${id}${s}`;

async function user(username, fullName) {
  const made = await admin.post('/api/team/users', { username, fullName, role: 'author' });
  const c = new h.Client(username);
  await c.post('/api/auth/login', { username, password: made.json.tempPassword });
  await c.post('/api/auth/onboarding', { username, password: PW });
  return c;
}

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  author = await user('wanda', 'Wanda Writer');
  viewer = await user('vic', 'Vic Viewer');
  stranger = await user('sam', 'Sam Stranger');
  id = (await author.post('/api/projects', { name: 'Waivers', pipeline: 's1000dtofo' })).json.project.id;
  assert.equal((await author.post(P('/assign'), { username: 'vic', role: 'viewer' })).status, 200);

  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(FIX, '..', ICN))]), ICN);
  fd.append('dir', 'csdb');
  assert.equal((await author.req('POST', P('/media'), fd)).status, 200);
  const file = JSON.parse(fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8')).descript;
  // the module names a project BREX that is not in the project
  assert.equal((await author.post(P('/dms'), { file, xml: useBrex(fs.readFileSync(path.join(FIX, file), 'utf8'), NAMED) })).status, 201);
  const pmc = (await author.get(P('/pmc'))).json;
  const list = (await author.get(P('/dms'))).json.dms.filter((d) => d.file === file);
  const entries = [{ type: 'folder', title: 'All', children: list.map((d) => ({ type: 'dm', dmCode: d.dmCodeAttrs, issueInfo: d.issueInfoAttrs, language: d.languageAttrs, techName: d.techName, infoName: d.infoName })) }];
  assert.equal((await author.put(P('/pmc'), { meta: pmc.meta, entries, baseHash: (await author.get(P('/pmc'))).json.hash })).status, 200);
});
test.after(async () => { await h.close(); });

test('a missing BREX blocks the build; a recorded waiver lets the draft build through; a release is still refused', { timeout: 600000 }, async () => {
  const first = await author.post(P('/publish'), {});
  assert.ok(blocked(first), `the gate is strict by default: ${JSON.stringify(first.json).slice(0, 300)}`);
  const finding = first.json.findings.find((f) => f.kind === 'brex-source' && /is not available/.test(f.title));
  assert.ok(finding, 'the finding names the BREX that is missing');
  const subject = /BREX (\S+) is not available/.exec(finding.title)[1];

  // a reason is required
  const none = await author.post(P('/publish-waivers'), { kind: 'brex-missing', subject });
  assert.equal(none.status, 400); assert.equal(none.json.code, 'WAIVER_REASON_REQUIRED');
  assert.equal((await author.post(P('/publish-waivers'), { kind: 'brex-missing', subject, reason: 'short' })).status, 400);
  assert.equal((await author.post(P('/publish-waivers'), { kind: 'nonsense', subject, reason: 'a perfectly good reason' })).status, 400);
  assert.equal((await author.post(P('/publish-waivers'), { kind: 'brex-missing', subject: '../etc', reason: 'a perfectly good reason' })).status, 400);
  assert.equal((await author.get(P('/publish-waivers'))).json.waivers.length, 0, 'nothing was recorded by the refused attempts');

  // who may record one
  assert.equal((await viewer.post(P('/publish-waivers'), { kind: 'brex-missing', subject, reason: 'a perfectly good reason' })).status, 403, 'a viewer cannot');
  assert.ok([403, 404].includes((await stranger.post(P('/publish-waivers'), { kind: 'brex-missing', subject, reason: 'a perfectly good reason' })).status), 'a non-member cannot');
  assert.equal((await new h.Client('anon').post(P('/publish-waivers'), { kind: 'brex-missing', subject, reason: 'x'.repeat(20) })).status, 401);
  assert.equal((await viewer.get(P('/publish-waivers'))).status, 200, 'a viewer may read them');

  // an editor records it: attributed and dated
  const made = await author.post(P('/publish-waivers'), { kind: 'brex-missing', subject, reason: 'The customer BREX is not shipped with the package; drafts only.' });
  assert.equal(made.status, 201);
  assert.equal(made.json.waiver.by, 'wanda');
  assert.match(made.json.waiver.at, /^\d{4}-\d{2}-\d{2}T/);
  const listed = (await author.get(P('/publish-waivers'))).json;
  assert.equal(listed.waivers.length, 1);
  assert.equal(listed.waivers[0].subject, subject);

  // the draft build goes ahead
  const built = await author.post(P('/publish'), {});
  assert.equal(built.status, 200, `a waived BREX does not block a draft build: ${JSON.stringify(built.json).slice(0, 400)}`);
  const pdf = await author.get(P('/publish/pdf'));
  assert.equal(pdf.status, 200);
  assert.equal(pdf.buf.subarray(0, 4).toString(), '%PDF');

  // ... but never a release
  const rel = await author.post(P('/release'), { scheduledAt: new Date(Date.now() + 3600e3).toISOString(), note: 'waiver' });
  assert.ok(blocked(rel), `a waiver does not cover a release: ${rel.status} ${JSON.stringify(rel.json).slice(0, 300)}`);
  const relFinding = rel.json.findings.find((f) => f.kind === 'brex-source' && /is not available/.test(f.title));
  assert.ok(relFinding, 'the release is refused for the missing BREX');
  assert.match(relFinding.detail, /waiver covers draft builds, not a release/, 'and it says why the waiver did not help');

  // a waiver for a different BREX does not stand in for this one
  const other = (await author.post(P('/publish-waivers'), { kind: 'brex-missing', subject: 'DMC-OTHER-A-00-00-00-00A-022A-D', reason: 'a different, unrelated BREX' })).json.waiver;
  assert.equal((await author.get(P('/publish-waivers'))).json.waivers.length, 2);
  assert.equal((await author.del(P(`/publish-waivers/${other.id}`))).status, 200);

  // withdrawn: blocked again
  assert.equal((await viewer.del(P(`/publish-waivers/${made.json.waiver.id}`))).status, 403, 'a viewer cannot withdraw');
  assert.equal((await author.del(P(`/publish-waivers/${made.json.waiver.id}`))).status, 200);
  assert.equal((await author.del(P(`/publish-waivers/${made.json.waiver.id}`))).status, 404, 'already gone');
  assert.ok(blocked(await author.post(P('/publish'), {})), 'without the waiver the gate is strict again');
});

test('recording the same waiver again replaces it instead of piling up', async () => {
  const subject = 'DMC-REPEAT-A-00-00-00-00A-022A-D';
  const one = (await author.post(P('/publish-waivers'), { kind: 'brex-missing', subject, reason: 'first reason, long enough' })).json.waiver;
  const two = (await author.post(P('/publish-waivers'), { kind: 'brex-missing', subject: subject.toLowerCase(), reason: 'second reason, long enough' })).json.waiver;
  assert.notEqual(one.id, two.id);
  const mine = (await author.get(P('/publish-waivers'))).json.waivers.filter((w) => w.subject.toLowerCase() === subject.toLowerCase());
  assert.equal(mine.length, 1);
  assert.equal(mine[0].reason, 'second reason, long enough');
});
