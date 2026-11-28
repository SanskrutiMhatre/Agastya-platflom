'use strict';
// Phase 3 (P3-5): the intranet GitLab integration against a mock GitLab with TLS from a throwaway CA (test/fixtures/mock-gitlab).
// Configuration + connection test + visibility gating, OAuth (code + PKCE) and personal-token connections, refresh, push, pull (clean,
// three-way merge, conflict with per-file choice), branches and history, release upload, merge requests (open, sync -> review comments,
// GitLab approvals counting toward the Agastya approval, merge -> pull), permissions per project role, the SSRF guard, admin revoke, audit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const F040 = fs.readdirSync(FIX).find((f) => f.includes('-040A-D_'));
let h; let gl; let admin; const u = {}; const gu = {}; let pid; let U; let dir; let glProject; let app;
const events = [];

/** GET a URL on the mock (trusting only its CA), without following redirects. */
function mockGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { ca: gl.caPem }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location })); }).on('error', reject);
  });
}
const pathOf = (abs) => { const x = new URL(abs); return `${x.pathname}${x.search}`; };
const dm = () => fs.readFileSync(path.join(dir, 'csdb', F040), 'utf8');
const save = async (c, xml) => { const cur = await c.get(`${U}/dms/${F040}`); const r = await c.put(`${U}/dms/${F040}`, { xml, baseHash: cur.json.hash }); assert.equal(r.status, 200, JSON.stringify(r.json)); };
const auditActions = async () => (await admin.get('/api/admin/audit?limit=500')).json.entries.map((e) => e.action);

test.before(async () => {
  h = await boot();
  const { makeCertificate } = require('../dist/services/tlsCert');
  const { startMockGitlab } = require('./fixtures/mock-gitlab/server');
  gl = await startMockGitlab({ makeCertificate });
  require('../dist/services/externalChanges').onFilesChangedExternally((ev) => events.push(ev));
  admin = new h.Client('admin');
  assert.equal((await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' })).status, 200);
  const make = async (name, role = 'author') => {
    const m = await admin.post('/api/team/users', { username: name, fullName: `${name[0].toUpperCase()}${name.slice(1)} Tester`, role });
    assert.equal(m.status, 201, JSON.stringify(m.json));
    const c = new h.Client(name); c.id = m.json.user.id;
    await c.post('/api/auth/login', { username: name, password: m.json.tempPassword }); await c.post('/api/auth/onboarding', { username: name, password: PW });
    return c;
  };
  u.alice = await make('alice'); u.bob = await make('bob', 'project_manager'); u.rita = await make('rita'); u.vic = await make('vic'); u.olga = await make('olga');
  const mk = await u.alice.post('/api/projects', { name: 'Handbook', pipeline: 's1000dtofo', s1000d: { mic: 'EXAMPLE', issue: '5.0', responsiblePartner: { code: '00000', name: 'Example Company' } } });
  assert.equal(mk.status, 201, JSON.stringify(mk.json)); pid = mk.json.project.id; U = `/api/projects/${pid}`; dir = path.join(h.ws, 'projects', pid);
  for (const [n, r] of [['bob', 'manager'], ['rita', 'reviewer'], ['vic', 'viewer']]) assert.equal((await admin.post(`/api/admin/projects/${pid}/members`, { username: n, role: r })).status, 200);
  assert.equal((await u.alice.post(`${U}/dms`, { file: F040, xml: fs.readFileSync(path.join(FIX, F040), 'utf8') })).status, 201);
  const code = /<dmCode\s+([^>]*?)\s*\/?>/.exec(dm())[1];
  const pm = fs.readFileSync(path.join(dir, 'publication.xml'), 'utf8'); const content = `<content><pmEntry><pmEntryTitle>All</pmEntryTitle><dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef></pmEntry></content>`;
  fs.writeFileSync(path.join(dir, 'publication.xml'), /<content[\s\S]*<\/content>|<content\s*\/>/.test(pm) ? pm.replace(/<content[\s\S]*<\/content>|<content\s*\/>/, content) : pm.replace('</pm>', `${content}</pm>`));
  // derived and temporary files a push must leave out
  fs.writeFileSync(path.join(dir, 'jss-output.pdf'), '%PDF-1.4 built');
  fs.writeFileSync(path.join(dir, '_cover-logo.png'), 'png');
  for (const n of ['alice', 'bob', 'rita', 'olga']) gu[n] = gl.addUser({ username: `gl-${n}`, name: `${n} in GitLab` });
  gu.ns = gl.addNamespace({ path: 'manuals', name: 'Manuals' });
  app = gl.addApp({ redirectUri: `${h.base}/api/gitlab/oauth/callback` });
});
test.after(async () => { if (gl) await gl.close(); if (h) await h.close(); });

test('SSRF guard: only the configured instance and its API paths; https only; no credentials in the address', () => {
  const { urlFor, normaliseBaseUrl, seg } = require('../dist/services/gitlab/http');
  const ep = { baseUrl: 'https://git.corp/gitlab' };
  assert.equal(urlFor(ep, '/api/v4/version').toString(), 'https://git.corp/gitlab/api/v4/version');
  for (const bad of ['/api/v4/../../admin', '/admin/api/v4', '//evil.example/api/v4/x', '/api/v4/x/..%2F..%2Fy', `/api/v4/projects/${seg('../../x')}/tree`, '/oauth/../api', '/api/v4/x?y=1', '/api/v4/a@evil', 'https://evil.example/api/v4/version', '/api/v4\\..\\x']) {
    assert.throws(() => urlFor(ep, bad), (e) => e.code === 'GITLAB_PATH_REFUSED', bad);
  }
  for (const bad of ['http://git.corp', 'https://user:pw@git.corp', 'https://git.corp/?x=1', 'ftp://git.corp', 'file:///etc/passwd', 'https://git.corp/a/../b', 'not a url']) {
    assert.throws(() => normaliseBaseUrl(bad), (e) => e.code === 'GITLAB_BAD_URL', bad);
  }
  assert.equal(normaliseBaseUrl('https://git.corp/gitlab/'), 'https://git.corp/gitlab');
});

test('until the administrator saved a tested configuration, GitLab does not exist for anyone else', async () => {
  for (const [c, url] of [[u.alice, '/api/gitlab/me'], [u.alice, `${U}/gitlab`], [u.vic, `${U}/gitlab/releases`], [u.alice, `${U}/gitlab/mrs`]]) {
    const r = await c.get(url); assert.equal(r.status, 404, url); assert.equal(r.json.code, 'FEATURE_OFF', url);
  }
  assert.equal((await u.alice.post('/api/gitlab/connect/token', { token: 'glpat-xxxxxxxxxxxxxxxxxxxx' })).json.code, 'FEATURE_OFF');
  assert.equal((await u.alice.get('/api/admin/gitlab')).status, 403, 'the configuration is for administrators');
  const d = (await admin.get('/api/admin/gitlab')).json;
  assert.equal(d.configured, false); assert.equal(d.enabled, false);
  assert.equal(d.redirectUri, `${h.base}/api/gitlab/oauth/callback`, 'the redirect URI to copy into the GitLab application');
});

test('configuration: the connection test (TLS with the uploaded CA, version API, OAuth application) must pass before anything is saved; secrets never come back', async () => {
  const base = { baseUrl: gl.url, appUrl: h.base, oauthAppId: app.clientId, clientSecret: app.secret, allowPat: true };
  // no CA: the mock's certificate is from an internal CA the system does not trust
  let r = await admin.post('/api/admin/gitlab/test', base);
  assert.equal(r.status, 200); assert.equal(r.json.report.ok, false);
  assert.equal(r.json.report.checks.find((c) => c.id === 'tls').ok, false, JSON.stringify(r.json.report.checks));
  r = await admin.post('/api/admin/gitlab', base);
  assert.equal(r.status, 422); assert.equal(r.json.code, 'GITLAB_TEST_FAILED');
  assert.equal((await u.alice.get('/api/gitlab/me')).json.code, 'FEATURE_OFF', 'still off after a failed save');
  // an unrelated CA does not help; a private key is refused; plain http is refused
  r = await admin.post('/api/admin/gitlab/test', { ...base, caPem: gl.otherCaPem });
  assert.equal(r.json.report.checks.find((c) => c.id === 'tls').ok, false);
  r = await admin.post('/api/admin/gitlab/test', { ...base, caPem: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'GITLAB_CA_PRIVATE_KEY');
  r = await admin.post('/api/admin/gitlab/test', { ...base, baseUrl: gl.url.replace('https:', 'http:') });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'GITLAB_BAD_URL');
  // the right CA but a wrong application secret: TLS passes, the OAuth check names invalid_client
  r = await admin.post('/api/admin/gitlab/test', { ...base, caPem: gl.caPem, clientSecret: 'wrong-secret' });
  assert.equal(r.json.report.checks.find((c) => c.id === 'tls').ok, true);
  assert.equal(r.json.report.checks.find((c) => c.id === 'oauth').ok, false); assert.match(r.json.report.checks.find((c) => c.id === 'oauth').detail, /invalid_client/);
  // everything right, with a service token: version read, saved
  const service = gl.addToken(gu.olga.id);
  r = await admin.post('/api/admin/gitlab', { ...base, caPem: gl.caPem, serviceToken: service });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.report.ok, true); assert.match(r.json.report.checks.find((c) => c.id === 'version').detail, /GitLab 17\.5\.1/);
  const text = JSON.stringify((await admin.get('/api/admin/gitlab')).json);
  assert.ok(!text.includes(app.secret) && !text.includes(service), 'no secret is returned to the browser');
  const d = JSON.parse(text);
  assert.equal(d.enabled, true); assert.equal(d.hasClientSecret, true); assert.equal(d.hasServiceToken, true); assert.equal(d.ca.length, 1);
  const row = require('../dist/context').repos.gitlab.getSettings();
  assert.ok(!row.secrets.includes(app.secret) && !row.secrets.includes(service) && /^v1:/.test(row.secrets), 'the secrets are sealed at rest');
  assert.ok(fs.existsSync(path.join(h.ws, 'keys', 'secrets.key')), 'the key lives in a workspace file, outside the database');
  // a re-save with blank secrets keeps them (the form never shows them)
  r = await admin.post('/api/admin/gitlab', { baseUrl: gl.url, appUrl: h.base, oauthAppId: app.clientId, allowPat: true, timeoutMs: 15000 });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.settings.hasClientSecret, true); assert.equal(r.json.settings.config.timeoutMs, 15000);
  const acts = await auditActions();
  assert.ok(acts.includes('gitlab.config.saved') && acts.includes('gitlab.config.tested'));
});

test('users connect their own accounts: OAuth (authorization code + PKCE, state bound to the session), personal access token, refresh', async () => {
  const me = (await u.alice.get('/api/gitlab/me')).json;
  assert.equal(me.enabled, true); assert.deepEqual(me.methods, { oauth: true, pat: true }); assert.equal(me.account, null);
  // OAuth for alice
  gl.state.authorizeAs = gu.alice.id;
  const start = await u.alice.post('/api/gitlab/connect/oauth', { returnTo: `/projects/${pid}/repository` });
  assert.equal(start.status, 200); const az = new URL(start.json.authorizeUrl);
  assert.equal(az.origin, new URL(gl.url).origin); assert.equal(az.searchParams.get('code_challenge_method'), 'S256'); assert.equal(az.searchParams.get('redirect_uri'), `${h.base}/api/gitlab/oauth/callback`);
  const consent = await mockGet(start.json.authorizeUrl);
  assert.equal(consent.status, 302);
  // the same callback in another person's session is refused (the state belongs to alice)
  const stolen = await u.bob.get(pathOf(consent.location));
  assert.equal(stolen.status, 302); assert.match(stolen.headers.get('location'), /gitlab=error/);
  // a fresh one in alice's own session works
  const again = await mockGet((await u.alice.post('/api/gitlab/connect/oauth', { returnTo: `/projects/${pid}/repository` })).json.authorizeUrl);
  const cb = await u.alice.get(pathOf(again.location));
  assert.equal(cb.status, 302); assert.equal(cb.headers.get('location'), `/projects/${pid}/repository?gitlab=connected`);
  const acc = (await u.alice.get('/api/gitlab/me')).json.account;
  assert.equal(acc.method, 'oauth'); assert.equal(acc.username, 'gl-alice');
  assert.ok(!JSON.stringify(acc).includes('oauth-'), 'no token in the answer');
  // a returnTo outside the application is never followed
  const evil = await u.alice.post('/api/gitlab/connect/oauth', { returnTo: 'https://evil.example/' });
  const evilCb = await u.alice.get(pathOf((await mockGet(evil.json.authorizeUrl)).location));
  assert.equal(evilCb.headers.get('location'), '/overview?gitlab=connected');
  // bob: OAuth with a short-lived token, refreshed on use
  gl.state.tokenLifetime = 30; gl.state.authorizeAs = gu.bob.id;
  const b = await mockGet((await u.bob.post('/api/gitlab/connect/oauth', {})).json.authorizeUrl);
  assert.match((await u.bob.get(pathOf(b.location))).headers.get('location'), /gitlab=connected/);
  gl.state.tokenLifetime = 7200;
  // rita: a personal access token; a wrong one is refused without signing her out of Agastya
  const bad = await u.rita.post('/api/gitlab/connect/token', { token: 'glpat-notarealtoken000000' });
  assert.equal(bad.status, 409); assert.equal(bad.json.code, 'GITLAB_AUTH');
  assert.equal((await u.rita.get('/api/auth/me')).status, 200, 'still signed in');
  const narrow = await u.rita.post('/api/gitlab/connect/token', { token: gl.addToken(gu.rita.id, { scopes: ['read_user'] }) });
  assert.equal(narrow.json.code, 'GITLAB_TOKEN_SCOPE');
  const ok = await u.rita.post('/api/gitlab/connect/token', { token: gl.addToken(gu.rita.id) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.account.method, 'pat');
  const acts = await auditActions();
  assert.ok(acts.includes('gitlab.account.connected') && acts.includes('gitlab.connect.failed'));
});

test('permissions per project role: viewers read, editors push and pull, managers link, outsiders get the uniform 404', async () => {
  assert.equal((await u.olga.get(`${U}/gitlab`)).status, 404);
  assert.deepEqual((await u.olga.get(`${U}/gitlab`)).json, { error: 'Not found' }, 'a non-member learns nothing');
  assert.equal((await u.vic.get(`${U}/gitlab`)).status, 200, 'a viewer reads the state');
  assert.equal((await u.vic.post(`${U}/gitlab/push`, {})).status, 403);
  assert.equal((await u.rita.post(`${U}/gitlab/pull`, {})).status, 403, 'a reviewer cannot pull');
  assert.equal((await u.rita.post(`${U}/gitlab/link`, { mode: 'create' })).status, 403);
  assert.equal((await u.rita.post(`${U}/gitlab/releases`, {})).status, 403);
  const nl = await u.alice.post(`${U}/gitlab/push`, {});
  assert.equal(nl.status, 409); assert.equal(nl.json.code, 'GITLAB_NOT_LINKED');
});

test('link: create a repository in a group; push sends the source files only, as one commit authored by the user', async () => {
  const ns = await u.alice.get(`${U}/gitlab/namespaces`);
  assert.equal(ns.status, 200); assert.ok(ns.json.namespaces.some((n) => n.path === 'manuals'));
  const l = await u.alice.post(`${U}/gitlab/link`, { mode: 'create', namespaceId: gu.ns.id, name: 'Handbook', path: 'handbook', branch: 'main' });
  assert.equal(l.status, 201, JSON.stringify(l.json)); assert.equal(l.json.link.path, 'manuals/handbook');
  glProject = l.json.link.gitlabProjectId;
  assert.equal((await u.alice.post(`${U}/gitlab/link`, { mode: 'existing', gitlabProjectId: glProject })).json.code, 'GITLAB_ALREADY_LINKED');
  const picks = await u.alice.get(`${U}/gitlab/remote-projects?search=handbook`);
  assert.equal(picks.status, 200, JSON.stringify(picks.json)); assert.ok(picks.json.projects.some((x) => x.id === glProject && x.path === 'manuals/handbook'), JSON.stringify(picks.json));
  assert.equal((await u.rita.get(`${U}/gitlab/remote-projects`)).status, 403, 'picking a repository is for managers');
  const st = (await u.alice.get(`${U}/gitlab`)).json;
  assert.ok(st.local.some((c) => c.path === `csdb/${F040}` && c.change === 'added'), JSON.stringify(st.local));
  const p = await u.alice.post(`${U}/gitlab/push`, { message: 'First version' });
  assert.equal(p.status, 200, JSON.stringify(p.json)); assert.ok(p.json.commit.id);
  const tree = gl.treeAt(glProject, 'main');
  assert.ok(tree.has(`csdb/${F040}`) && tree.has('publication.xml') && tree.has('project.json') && tree.has('.agastya/settings.json'), [...tree.keys()].join(', '));
  assert.ok(!tree.has('jss-output.pdf') && ![...tree.keys()].some((k) => k.split('/').some((s) => s.startsWith('_'))), 'no derived output, no "_" files');
  assert.equal(gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8'), dm(), 'byte-for-byte');
  assert.equal(gl.state.lastCommitBody.author_name, 'Alice Tester'); assert.equal(gl.state.lastCommitBody.author_email, gu.alice.email);
  assert.equal((await u.alice.get(`${U}/gitlab`)).json.local.length, 0, 'nothing left to push');
  const again = await u.alice.post(`${U}/gitlab/push`, { message: 'nothing' });
  assert.equal(again.json.commit, null, 'no empty commits');
  // bob's short-lived OAuth token is refreshed when he reads the history
  const before = gl.state.refreshed || 0;
  const hist = await u.bob.get(`${U}/gitlab/commits`);
  assert.equal(hist.status, 200); assert.equal(hist.json.commits[0].title, 'First version');
  assert.ok((gl.state.refreshed || 0) > before, 'the token was refreshed before use');
});

test('pull: a change made in GitLab is shown, then applied through the revision history; collaboration is told', async () => {
  const remote = dm().replace('First item', 'First item (edited in GitLab)');
  gl.commitAs(glProject, gu.bob.id, 'main', 'Edit in GitLab', { [`csdb/${F040}`]: remote, 'notes/README.md': 'hello' });
  const st = (await u.alice.get(`${U}/gitlab`)).json; assert.equal(st.remote.behind, true);
  const pushed = await u.alice.post(`${U}/gitlab/push`, {});
  assert.equal(pushed.status, 409); assert.equal(pushed.json.code, 'GITLAB_REMOTE_AHEAD', 'nothing is overwritten in GitLab');
  const inc = await u.alice.get(`${U}/gitlab/incoming`);
  assert.equal(inc.status, 200);
  assert.deepEqual(inc.json.items.map((i) => [i.path, i.action]).sort(), [[`csdb/${F040}`, 'apply'], ['notes/README.md', 'apply']]);
  assert.equal(inc.json.commits[0].title, 'Edit in GitLab');
  const pull = await u.alice.post(`${U}/gitlab/pull`, { expectHead: inc.json.head });
  assert.equal(pull.status, 200, JSON.stringify(pull.json));
  assert.equal(dm(), remote); assert.equal(fs.readFileSync(path.join(dir, 'notes', 'README.md'), 'utf8'), 'hello');
  const hist = (await u.alice.get(`${U}/dms/${F040}/history`)).json.revisions;
  assert.equal(hist[0].reason, 'gitlab-pull', 'the pull is a revision in the history');
  const ev = events.find((e) => e.projectId === pid && e.files.some((f) => f.path === `csdb/${F040}`));
  assert.ok(ev, 'files changed externally was raised'); assert.equal(ev.source, 'gitlab'); assert.equal(ev.actor.username, 'alice');
  assert.equal(ev.files.find((f) => f.path === `csdb/${F040}`).change, 'modified');
  assert.equal((await u.alice.get(`${U}/gitlab`)).json.remote.behind, false);
});

test('pull: changes on both sides in different places are merged three-way; in the same place the person chooses, never silently', async () => {
  // different places: merged
  await save(u.alice, dm().replace('Second item', 'Second item (local)'));
  gl.commitAs(glProject, gu.bob.id, 'main', 'Mass', { [`csdb/${F040}`]: gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8').replace('12 kg', '13 kg') });
  let inc = (await u.alice.get(`${U}/gitlab/incoming`)).json;
  assert.equal(inc.items.find((i) => i.path === `csdb/${F040}`).action, 'merge');
  let pull = await u.alice.post(`${U}/gitlab/pull`, { expectHead: inc.head });
  assert.equal(pull.status, 200, JSON.stringify(pull.json));
  assert.ok(dm().includes('Second item (local)') && dm().includes('13 kg'), 'both changes kept');
  assert.equal((await u.alice.post(`${U}/gitlab/push`, { message: 'merged' })).status, 200);
  // the same line: a conflict
  await save(u.alice, dm().replace('Step one', 'Step one (Alice)'));
  gl.commitAs(glProject, gu.bob.id, 'main', 'Step', { [`csdb/${F040}`]: gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8').replace('Step one', 'Step one (Bob)') });
  inc = (await u.alice.get(`${U}/gitlab/incoming`)).json;
  assert.deepEqual(inc.conflicts, [`csdb/${F040}`]);
  const mine = dm();
  pull = await u.alice.post(`${U}/gitlab/pull`, { expectHead: inc.head });
  assert.equal(pull.status, 409); assert.equal(pull.json.code, 'GITLAB_PULL_CONFLICTS');
  assert.equal(dm(), mine, 'nothing was written');
  pull = await u.alice.post(`${U}/gitlab/pull`, { expectHead: inc.head, resolutions: { [`csdb/${F040}`]: 'mine' } });
  assert.equal(pull.status, 200); assert.deepEqual(pull.json.kept, [`csdb/${F040}`]);
  assert.equal(dm(), mine, 'mine kept');
  const p = await u.alice.post(`${U}/gitlab/push`, { message: 'Keep Alice' });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.match(gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8'), /Step one \(Alice\)/);
  // theirs
  await save(u.alice, dm().replace('Step two', 'Step two (Alice)'));
  gl.commitAs(glProject, gu.bob.id, 'main', 'Step two', { [`csdb/${F040}`]: gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8').replace('Step two', 'Step two (Bob)') });
  inc = (await u.alice.get(`${U}/gitlab/incoming`)).json;
  pull = await u.alice.post(`${U}/gitlab/pull`, { expectHead: inc.head, resolutions: { [`csdb/${F040}`]: 'theirs' } });
  assert.equal(pull.status, 200); assert.match(dm(), /Step two \(Bob\)/);
  // a head that moved after the summary is refused
  gl.commitAs(glProject, gu.bob.id, 'main', 'later', { 'notes/README.md': 'later' });
  const stale = await u.alice.post(`${U}/gitlab/pull`, { expectHead: inc.head });
  assert.equal(stale.json.code, 'GITLAB_HEAD_MOVED');
  assert.equal((await u.alice.post(`${U}/gitlab/pull`, {})).status, 200);
});

test('branches: create, switch (refused with unpushed changes), history', async () => {
  const c = await u.alice.post(`${U}/gitlab/branches`, { name: 'draft-2' });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  gl.commitAs(glProject, gu.bob.id, 'draft-2', 'Only on draft-2', { 'notes/draft.md': 'draft' });
  assert.ok((await u.vic.get(`${U}/gitlab/branches`)).json.branches.some((b) => b.name === 'draft-2'));
  fs.writeFileSync(path.join(dir, 'notes', 'local.md'), 'local');
  let s = await u.alice.post(`${U}/gitlab/branch`, { name: 'draft-2' });
  assert.equal(s.status, 409); assert.equal(s.json.code, 'GITLAB_LOCAL_CHANGES');
  fs.rmSync(path.join(dir, 'notes', 'local.md'));
  assert.equal((await u.rita.post(`${U}/gitlab/branch`, { name: 'draft-2' })).status, 403, 'switching is for managers');
  s = await u.alice.post(`${U}/gitlab/branch`, { name: 'draft-2' });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(fs.readFileSync(path.join(dir, 'notes', 'draft.md'), 'utf8'), 'draft');
  assert.equal((await u.alice.get(`${U}/gitlab/commits`)).json.commits[0].title, 'Only on draft-2');
  s = await u.alice.post(`${U}/gitlab/branch`, { name: 'main' });
  assert.equal(s.status, 200); assert.ok(!fs.existsSync(path.join(dir, 'notes', 'draft.md')), 'back on main');
  assert.equal((await u.alice.post(`${U}/gitlab/branches`, { name: 'bad..name' })).json.code, 'GITLAB_BAD_BRANCH');
});

test('release storage: the PDF and its metadata go to the package registry and a tagged GitLab release', async () => {
  const r = await u.alice.post(`${U}/gitlab/releases`, { kind: 'build', includeArchive: true });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const rel = r.json.release;
  assert.match(rel.tag, /^agastya-build-/);
  assert.equal(rel.metadata.watermark, 'NOT RELEASED'); assert.equal(rel.metadata.kind, 'build');
  const pk = [...gl.state.packages.keys()];
  assert.ok(pk.some((k) => k.endsWith('.pdf')) && pk.some((k) => k.endsWith('metadata.json')) && pk.some((k) => k.endsWith('.jsspub.zip')), pk.join(', '));
  const glRel = gl.state.releases.get(glProject)[0];
  assert.equal(glRel.tag_name, rel.tag); assert.match(glRel.description, /Watermark \| NOT RELEASED/);
  assert.equal(glRel.assets.links.length, 3);
  assert.equal(gl.project(glProject).tags.get(rel.tag), gl.project(glProject).branches.get('main'), 'tagged at the synced commit');
  assert.equal((await u.vic.get(`${U}/gitlab/releases`)).json.releases.length, 1);
  const notYet = await u.alice.post(`${U}/gitlab/releases`, { kind: 'release' });
  assert.equal(notYet.status, 409); assert.equal(notYet.json.code, 'GITLAB_NOT_RELEASED');
  assert.ok((await auditActions()).includes('gitlab.release.uploaded'));
});

test('merge requests: open with mapped reviewers; sync brings notes and requested changes in; GitLab approvals count; merge updates the branch', async () => {
  assert.equal((await u.alice.post(`${U}/gitlab/options`, { countApprovals: true })).status, 200);
  assert.equal((await u.rita.post(`${U}/gitlab/options`, { countApprovals: false })).status, 403);
  const rv = (await u.alice.get(`${U}/gitlab/reviewers`)).json.reviewers;
  assert.ok(rv.some((x) => x.username === 'rita' && x.gitlab && x.gitlab.username === 'gl-rita'));
  // nothing changed: no merge request
  assert.equal((await u.alice.post(`${U}/gitlab/mrs`, { title: 'x' })).json.code, 'GITLAB_NOTHING_TO_REVIEW');
  await save(u.alice, dm().replace('Voltage', 'Supply voltage'));
  // the release request the review is for
  const req = await u.alice.post(`${U}/release`, {});
  assert.equal(req.status, 200, JSON.stringify(req.json).slice(0, 400));
  const pending = (await u.alice.get(`${U}/release`)).json.pending; assert.ok(pending);
  const mr = await u.alice.post(`${U}/gitlab/mrs`, { title: 'Review issue 1', description: 'Please check the table', reviewers: [u.rita.id, u.bob.id, u.vic.id] });
  assert.equal(mr.status, 201, JSON.stringify(mr.json));
  const iid = mr.json.mr.iid;
  const gm = gl.mr(glProject, iid);
  assert.deepEqual(gm.reviewers.map((r) => r.userId).sort(), [gu.bob.id, gu.rita.id].sort(), 'reviewers mapped to their GitLab accounts');
  assert.ok(mr.json.unmappedReviewers.some((x) => /vic/.test(x)), 'a viewer is not a reviewer');
  assert.equal(gm.target_branch, 'main'); assert.match(gm.source_branch, /^agastya\/review-/);
  assert.match(gl.fileAt(glProject, gm.source_branch, `csdb/${F040}`).toString('utf8'), /Supply voltage/);
  assert.doesNotMatch(gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8'), /Supply voltage/, 'the project branch is not touched by opening a review');
  // comments and requested changes in GitLab -> review comments
  gl.addNote(glProject, iid, gu.rita.id, 'The voltage is 28 V DC, say so.', { path: `csdb/${F040}` });
  gl.addNote(glProject, iid, gu.olga.id, 'Looks fine to me.');
  gl.setReviewerState(glProject, iid, gu.rita.id, 'requested_changes');
  let sync = await u.rita.post(`${U}/gitlab/mrs/${iid}/sync`, {});
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
  assert.equal(sync.json.imported, 3);
  let comments = (await u.alice.get(`${U}/release`)).json.review.comments;
  const fromRita = comments.find((c) => /28 V DC/.test(c.body));
  assert.equal(fromRita.by, 'rita', 'a connected GitLab user is the Agastya author'); assert.equal(fromRita.dmFile, F040);
  assert.ok(comments.some((c) => /From GitLab, olga in GitLab/.test(c.body)), 'an unconnected GitLab user is named');
  assert.ok(comments.some((c) => c.kind === 'changes' && /requested changes/.test(c.body)));
  sync = await u.rita.post(`${U}/gitlab/mrs/${iid}/sync`, {});
  assert.equal(sync.json.imported, 0, 'a sync never imports a note twice');
  // approvals: rita approves in GitLab through Agastya (she may not approve the Agastya release), then bob (the project's manager)
  assert.equal((await u.vic.post(`${U}/gitlab/mrs/${iid}/approve`, {})).status, 403);
  assert.equal((await u.rita.post(`${U}/gitlab/mrs/${iid}/approve`, {})).status, 200);
  gl.project(glProject).approvalsRequired = 2;
  sync = await u.alice.post(`${U}/gitlab/mrs/${iid}/sync`, {});
  assert.equal(sync.json.approvedRelease, null, 'one of two required approvals');
  assert.equal((await u.bob.post(`${U}/gitlab/mrs/${iid}/approve`, {})).status, 200);
  sync = await u.alice.post(`${U}/gitlab/mrs/${iid}/sync`, {});
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
  assert.deepEqual(sync.json.approvedRelease, { releaseId: pending.id, by: 'bob' }, sync.json.approvalNote || '');
  const relState = (await u.alice.get(`${U}/release`)).json;
  assert.ok(relState.release, 'the Agastya release is approved by the GitLab approval of its manager');
  const audited = (await admin.get('/api/admin/audit?action=release.approved')).json.entries[0];
  assert.equal(audited.actor, 'bob'); assert.equal(audited.meta.via, `gitlab-mr-${iid}`);
  // merge in GitLab from Agastya: the project's branch moves and the project is brought up to date
  assert.equal((await u.rita.post(`${U}/gitlab/mrs/${iid}/merge`, {})).status, 403);
  const merged = await u.alice.post(`${U}/gitlab/mrs/${iid}/merge`, {});
  assert.equal(merged.status, 200, JSON.stringify(merged.json));
  assert.equal(merged.json.mr.state, 'merged');
  assert.match(gl.fileAt(glProject, 'main', `csdb/${F040}`).toString('utf8'), /Supply voltage/);
  assert.equal(merged.json.pullError, null, 'the pull after the merge ran cleanly'); assert.ok(merged.json.pulled);
  assert.equal((await u.alice.get(`${U}/gitlab`)).json.link.baseCommit, gl.project(glProject).branches.get('main'));
  const acts = await auditActions();
  for (const a of ['gitlab.mr.opened', 'gitlab.mr.synced', 'gitlab.mr.approved', 'gitlab.mr.merged', 'gitlab.pushed', 'gitlab.pulled', 'gitlab.project.linked', 'gitlab.branch.switched', 'gitlab.branch.created']) assert.ok(acts.includes(a), a);
});

test('the administrator revokes a connection; switching GitLab off removes every token and hides it again', async () => {
  const list = (await admin.get('/api/admin/gitlab/accounts')).json.accounts;
  assert.deepEqual(list.map((a) => a.user).sort(), ['alice', 'bob', 'rita']);
  assert.ok(!JSON.stringify(list).includes('glpat-') && !JSON.stringify(list).includes('oauth-'));
  const rv = await admin.del(`/api/admin/gitlab/accounts/${u.rita.id}`);
  assert.equal(rv.status, 200); assert.equal(rv.json.removed, true);
  assert.equal((await u.rita.get('/api/gitlab/me')).json.account, null);
  assert.equal((await u.rita.post(`${U}/gitlab/mrs/1/sync`, {})).json.code, 'GITLAB_NOT_CONNECTED');
  const dis = await u.bob.del('/api/gitlab/me');
  assert.equal(dis.status, 200); assert.equal(dis.json.revokedAtGitlab, true, 'an OAuth token is revoked at GitLab');
  const off = await admin.del('/api/admin/gitlab');
  assert.equal(off.status, 200); assert.equal(off.json.accountsRemoved, 1);
  assert.equal((await u.alice.get('/api/gitlab/me')).json.code, 'FEATURE_OFF');
  assert.equal((await u.alice.get(`${U}/gitlab`)).json.code, 'FEATURE_OFF');
  const acts = await auditActions();
  for (const a of ['gitlab.account.revoked', 'gitlab.account.disconnected', 'gitlab.config.removed']) assert.ok(acts.includes(a), a);
});

test('the three-way merge itself: clean merges, conflicts, line endings', () => {
  const { merge3 } = require('../dist/services/gitlab/merge3');
  const base = 'a\nb\nc\nd\ne\nf\n';
  assert.deepEqual(merge3(base, 'A\nb\nc\nd\ne\nf\n', 'a\nb\nc\nd\ne\nF\n'), { clean: true, text: 'A\nb\nc\nd\ne\nF\n', conflicts: 0 });
  assert.equal(merge3(base, 'a\nX\nc\nd\ne\nf\n', 'a\nY\nc\nd\ne\nf\n').clean, false);
  assert.equal(merge3(base, 'a\nX\nc\nd\ne\nf\n', 'a\nX\nc\nd\ne\nf\n').text, 'a\nX\nc\nd\ne\nf\n', 'the same change on both sides');
  assert.equal(merge3('a\r\nb\r\nc\r\nd\r\n', 'A\r\nb\r\nc\r\nd\r\n', 'a\r\nb\r\nc\r\nD\r\n').text, 'A\r\nb\r\nc\r\nD\r\n');
  assert.equal(merge3(base, 'a\nb\nnew\nc\nd\ne\nf\n', 'a\nb\nc\nd\ne\nf\ng\n').text, 'a\nb\nnew\nc\nd\ne\nf\ng\n', 'insertions in different places');
});
