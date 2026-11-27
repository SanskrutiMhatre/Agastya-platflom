'use strict';
// WP-22 (UX-008, FE-015): the one problems model of a project and the team's "reviewed" marks.
//   - a finding marked reviewed by one member is reviewed for every other member (it is on the server, not in a browser)
//   - the model joins the last validation run with the marks: open / reviewed counts, who and when
//   - unmarking works; a bad key is refused; a viewer may read but not mark; a stranger gets the uniform 404, anonymous 401
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');

let h; let admin; let author; let reviewer; let viewer; let stranger; let id;
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
  author = await user('ann', 'Ann Author');
  reviewer = await user('rob', 'Rob Reviewer');
  viewer = await user('vic', 'Vic Viewer');
  stranger = await user('sam', 'Sam Stranger');
  id = (await author.post('/api/projects', { name: 'Problems', pipeline: 's1000dtofo' })).json.project.id;
  assert.equal((await author.post(P('/assign'), { username: 'rob', role: 'reviewer' })).status, 200);
  assert.equal((await author.post(P('/assign'), { username: 'vic', role: 'viewer' })).status, 200);
  // a module that refers to a graphic the project does not have: the check reports at least one finding
  const file = JSON.parse(fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8')).descript;
  assert.equal((await author.post(P('/dms'), { file, xml: fs.readFileSync(path.join(FIX, file), 'utf8') })).status, 201);
});
test.after(async () => { await h.close(); });

test('before any check the model is empty; after a check it lists every finding as open', { timeout: 300000 }, async () => {
  const none = await viewer.get(`/api/projects/${id}/problems`);
  assert.equal(none.status, 200);
  assert.deepEqual([none.json.ranAt, none.json.problems.length], [null, 0]);
  const run = await author.post(P('/validation'), { brex: false });
  assert.equal(run.status, 200, JSON.stringify(run.json).slice(0, 300));
  const all = (await viewer.get(`/api/projects/${id}/problems`)).json;
  assert.ok(all.problems.length > 0, 'the fixture produces findings');
  assert.equal(all.problems.length, run.json.run.issues.length, 'the model holds exactly the findings of the last run');
  assert.ok(all.problems.every((p) => p.state === 'open' && p.key && p.severity && 'file' in p && 'line' in p && p.rule && p.message));
  assert.equal(all.summary.open, all.problems.length);
  assert.equal(all.summary.error, run.json.run.summary.error, 'the counts are the run\'s counts');
});

test('a mark made by one member is seen by another, with who and when; unmarking removes it', async () => {
  const { problems } = (await author.get(`/api/projects/${id}/problems`)).json;
  const key = problems[0].key;
  const put = await reviewer.put(`/api/projects/${id}/problems/reviewed`, { keys: [key], reviewed: true });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const seen = (await author.get(`/api/projects/${id}/problems`)).json;          // another person, another "browser"
  const p = seen.problems.find((x) => x.key === key);
  assert.equal(p.state, 'reviewed');
  assert.equal(p.reviewedBy, 'Rob Reviewer');
  assert.ok(p.reviewedAt);
  assert.equal(seen.summary.reviewed, 1);
  // the project summary (the Project Home's cards) counts the same marks, and carries the review state
  const sum = (await viewer.get(P('/summary'))).json;
  assert.equal(sum.problems.reviewed, 1);
  assert.deepEqual([sum.review.state, sum.review.open], ['draft', 0]);
  const marks = (await viewer.get(`/api/projects/${id}/problems/reviewed`)).json.marks;
  assert.deepEqual(marks.map((m) => [m.key, m.by]), [[key, 'rob']]);
  // a second mark of the same finding keeps the first reviewer on record
  await author.put(`/api/projects/${id}/problems/reviewed`, { keys: [key], reviewed: true });
  assert.equal((await viewer.get(`/api/projects/${id}/problems/reviewed`)).json.marks[0].by, 'rob');
  // a key the last run does not hold is still kept (a later run may produce the finding again): marks moved from a browser are not lost
  assert.equal((await author.put(`/api/projects/${id}/problems/reviewed`, { keys: ['xsd|csdb/OLD.xml|3|Gone|/x'], reviewed: true })).status, 200);
  assert.equal((await viewer.get(`/api/projects/${id}/problems/reviewed`)).json.marks.length, 2);
  assert.equal((await author.put(`/api/projects/${id}/problems/reviewed`, { keys: [key, 'xsd|csdb/OLD.xml|3|Gone|/x'], reviewed: false })).status, 200);
  assert.equal((await author.get(`/api/projects/${id}/problems`)).json.problems.find((x) => x.key === key).state, 'open');
  assert.deepEqual((await viewer.get(`/api/projects/${id}/problems/reviewed`)).json.marks, []);
});

test('bad keys are refused; a viewer cannot mark; a stranger gets 404 and an anonymous caller 401', async () => {
  assert.equal((await author.put(`/api/projects/${id}/problems/reviewed`, { keys: [] })).status, 400);
  assert.equal((await author.put(`/api/projects/${id}/problems/reviewed`, { keys: ['a\u0000b'] })).status, 400);
  assert.equal((await author.put(`/api/projects/${id}/problems/reviewed`, { keys: ['x'.repeat(1300)] })).status, 400);
  assert.equal((await viewer.put(`/api/projects/${id}/problems/reviewed`, { keys: ['k'], reviewed: true })).status, 403);
  assert.equal((await stranger.get(`/api/projects/${id}/problems`)).status, 404);
  assert.equal((await new h.Client('anon').get(`/api/projects/${id}/problems`)).status, 401);
});

test('the client permission map offers marking to reviewers and above only', async () => {
  const card = async (c) => (await c.get(`/api/projects/${id}/summary`)).json.project.can;
  assert.equal((await card(reviewer))['problems.review'], true);
  assert.equal((await card(viewer))['problems.review'], false);
});
