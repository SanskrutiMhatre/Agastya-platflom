'use strict';
// A mock of the parts of the GitLab REST API and OAuth (Doorkeeper) flow the Agastya integration uses (Phase 3, P3-5). For tests only.
//
// TLS with a throwaway CA made in memory (written only to the temp folder the caller names, never installed): the integration must trust
// it through the CA bundle the administrator uploads, exactly as with an intranet GitLab and its internal CA.
//
// Implemented: /api/v4/version, /user, /personal_access_tokens/self, /namespaces, /projects (list, create, get), repository branches (list,
// get, create), tree (recursive, paginated with x-next-page), blobs/:sha/raw, commits (list, create with multi-file actions, base64),
// compare, merge_requests (create, get, approvals, approve, discussions, reviewers, merge), packages/generic (PUT, GET), releases (create, list);
// /oauth/authorize (auto-consent as `state.authorizeAs`), /oauth/token (authorization_code with PKCE S256, refresh_token; invalid_client /
// invalid_grant like Doorkeeper), /oauth/revoke. Every request is logged in `state.log`.
//
// startMockGitlab({ port, host, makeCertificate, control }) -> { url, caPem, state, helpers..., close() }

const https = require('https');
const crypto = require('crypto');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const now = () => new Date().toISOString();

function createState() {
  return {
    users: new Map(), tokens: new Map(), refresh: new Map(), apps: new Map(), codes: new Map(),
    namespaces: [], projects: new Map(), commits: new Map(), blobs: new Map(), mrs: new Map(), releases: new Map(), packages: new Map(),
    log: [], nextId: 100, authorizeAs: null, tokenLifetime: 7200, failNext: [], version: '17.5.1-ee',
  };
}

async function startMockGitlab({ port = 0, host = '127.0.0.1', makeCertificate, control = false } = {}) {
  if (!makeCertificate) throw new Error('startMockGitlab needs makeCertificate (dist/services/tlsCert)');
  const ca = makeCertificate({ commonName: 'Mock intranet CA (tests only)', ca: true });
  const leaf = makeCertificate({ commonName: 'gitlab.mock', altNames: ['localhost', '127.0.0.1', 'gitlab.mock'], issuer: ca });
  const S = createState();
  const id = () => S.nextId++;

  // ── helpers the tests call ────────────────────────────────────────────────────────────────────────────────────────────────────
  const h = {
    addUser(u) { const user = { id: u.id ?? id(), username: u.username, name: u.name ?? u.username, email: u.email ?? `${u.username}@corp.mock`, state: 'active' }; S.users.set(user.id, user); return user; },
    addToken(userId, { token = `glpat-${crypto.randomBytes(12).toString('hex')}`, scopes = ['api'], kind = 'pat' } = {}) { S.tokens.set(token, { userId, scopes, kind, expiresAt: null }); return token; },
    addApp({ clientId = crypto.randomBytes(16).toString('hex'), secret = `gloas-${crypto.randomBytes(16).toString('hex')}`, redirectUri }) { S.apps.set(clientId, { secret, redirectUri }); return { clientId, secret }; },
    addNamespace(n) { const ns = { id: n.id ?? id(), full_path: n.path, kind: n.kind ?? 'group', name: n.name ?? n.path }; S.namespaces.push(ns); return ns; },
    project(pid) { return S.projects.get(Number(pid)); },
    /** Commit files as a GitLab user would (a change made in GitLab). files: { path: string|Buffer|null } (null deletes). */
    commitAs(pid, userId, branch, message, files) {
      const p = h.project(pid); const parent = p.branches.get(branch) ?? null;
      const tree = new Map(parent ? S.commits.get(parent).tree : []);
      for (const [path, v] of Object.entries(files)) {
        if (v === null) tree.delete(path); else { const buf = Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8'); const sha = blobSha(buf); S.blobs.set(sha, buf); tree.set(path, sha); }
      }
      return makeCommit(p, branch, parent, tree, message, S.users.get(userId));
    },
    fileAt(pid, ref, path) { const p = h.project(pid); const c = S.commits.get(resolveRef(p, ref)); const sha = c && c.tree.get(path); return sha ? S.blobs.get(sha) : null; },
    treeAt(pid, ref) { const p = h.project(pid); const c = S.commits.get(resolveRef(p, ref)); return c ? new Map(c.tree) : new Map(); },
    mr(pid, iid) { return S.mrs.get(`${pid}:${iid}`); },
    addNote(pid, iid, userId, body, { path } = {}) { const mr = h.mr(pid, iid); const u = S.users.get(userId); const note = { id: id(), body, system: false, author: pub(u), created_at: now(), resolvable: true, resolved: false, ...(path ? { position: { new_path: path } } : {}) }; mr.discussions.push({ id: crypto.randomBytes(8).toString('hex'), notes: [note] }); return note; },
    setReviewerState(pid, iid, userId, state) { const mr = h.mr(pid, iid); let r = mr.reviewers.find((x) => x.userId === userId); if (!r) { r = { userId, state }; mr.reviewers.push(r); } r.state = state; },
    approveAs(pid, iid, userId) { h.mr(pid, iid).approvals.add(userId); },
  };
  const pub = (u) => (u ? { id: u.id, username: u.username, name: u.name, state: 'active' } : null);

  function makeCommit(p, branch, parent, tree, message, user) {
    const c = { id: sha1(`${p.id}:${parent}:${message}:${Math.random()}:${Date.now()}`), parent, tree, message, title: String(message).split('\n')[0],
      author_name: user ? user.name : 'Someone', author_email: user ? user.email : 'someone@corp.mock', created_at: now(), project: p.id };
    S.commits.set(c.id, c);
    if (branch) p.branches.set(branch, c.id);
    return c;
  }
  function resolveRef(p, ref) { if (!ref) return p.branches.get(p.default_branch) ?? null; if (p.branches.has(ref)) return p.branches.get(ref); if (S.commits.has(ref)) return ref; const tag = p.tags && p.tags.get(ref); return tag ?? null; }
  const commitView = (p, c) => ({ id: c.id, short_id: c.id.slice(0, 8), title: c.title, message: c.message, author_name: c.author_name, author_email: c.author_email, authored_date: c.created_at, committed_date: c.created_at, parent_ids: c.parent ? [c.parent] : [], web_url: `${url}/${p.path_with_namespace}/-/commit/${c.id}` });
  const ancestors = (cid) => { const out = []; let c = cid; while (c) { out.push(c); c = S.commits.get(c).parent; } return out; };

  // ── HTTP plumbing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let url = '';
  const send = (res, status, body, headers = {}) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body === undefined ? '' : JSON.stringify(body));
    res.writeHead(status, { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', 'content-length': buf.length, ...headers });
    res.end(buf);
  };
  const who = (req) => {
    const b = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || ''); const t = b ? b[1] : req.headers['private-token'];
    const tok = t && S.tokens.get(String(t));
    if (!tok) return null;
    if (tok.expiresAt && Date.parse(tok.expiresAt) < Date.now()) return null;
    return { user: S.users.get(tok.userId), token: tok, raw: t };
  };
  const projectOf = (raw) => { const v = decodeURIComponent(raw); if (/^\d+$/.test(v)) return S.projects.get(Number(v)); return [...S.projects.values()].find((p) => p.path_with_namespace === v); };
  const page = (req, res, items) => {
    const q = new URL(req.url, 'https://x').searchParams; const per = Math.min(100, Number(q.get('per_page')) || 20); const pg = Math.max(1, Number(q.get('page')) || 1);
    const slice = items.slice((pg - 1) * per, pg * per); const more = pg * per < items.length;
    send(res, 200, slice, { 'x-next-page': more ? String(pg + 1) : '', 'x-page': String(pg), 'x-total': String(items.length) });
  };

  const routes = [];
  const route = (method, re, fn, { auth = true } = {}) => routes.push({ method, re, fn, auth });
  const notFound = (res, what = '404 Not Found') => send(res, 404, { message: what });

  route('GET', /^\/api\/v4\/version$/, (req, res) => send(res, 200, { version: S.version, revision: 'mock01' }));
  route('GET', /^\/api\/v4\/user$/, (req, res, m, me) => send(res, 200, { ...pub(me.user), email: me.user.email, commit_email: me.user.email }));
  route('GET', /^\/api\/v4\/personal_access_tokens\/self$/, (req, res, m, me) => (me.token.kind === 'pat' ? send(res, 200, { id: 1, name: 'agastya', scopes: me.token.scopes, active: true, expires_at: null }) : send(res, 401, { message: '401 Unauthorized' })));
  route('GET', /^\/api\/v4\/namespaces$/, (req, res) => page(req, res, S.namespaces));
  route('GET', /^\/api\/v4\/projects$/, (req, res, m, me) => {
    const q = new URL(req.url, 'https://x').searchParams; const s = (q.get('search') || '').toLowerCase();
    page(req, res, [...S.projects.values()].filter((p) => p.members.has(me.user.id) && (!s || p.path_with_namespace.toLowerCase().includes(s))).map(projectView));
  });
  const projectView = (p) => ({ id: p.id, name: p.name, path: p.path, path_with_namespace: p.path_with_namespace, default_branch: p.default_branch, web_url: `${url}/${p.path_with_namespace}`, empty_repo: p.branches.size === 0 });
  route('POST', /^\/api\/v4\/projects$/, (req, res, m, me, body) => {
    const ns = S.namespaces.find((n) => n.id === Number(body.namespace_id)) ?? { full_path: me.user.username, id: 0 };
    const pathName = body.path || String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if ([...S.projects.values()].some((p) => p.path_with_namespace === `${ns.full_path}/${pathName}`)) return send(res, 400, { message: { path: ['has already been taken'] } });
    const p = { id: id(), name: body.name, path: pathName, path_with_namespace: `${ns.full_path}/${pathName}`, namespace_id: ns.id, default_branch: body.default_branch || 'main', branches: new Map(), tags: new Map(), members: new Set([me.user.id]), approvalsRequired: 1, nextIid: 1 };
    S.projects.set(p.id, p);
    send(res, 201, projectView(p));
  });
  route('GET', /^\/api\/v4\/projects\/([^/]+)$/, (req, res, m) => { const p = projectOf(m[1]); return p ? send(res, 200, projectView(p)) : notFound(res, '404 Project Not Found'); });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/repository\/branches$/, (req, res, m) => {
    const p = projectOf(m[1]); if (!p) return notFound(res);
    page(req, res, [...p.branches].map(([name, cid]) => ({ name, default: name === p.default_branch, protected: false, commit: commitView(p, S.commits.get(cid)) })));
  });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/repository\/branches\/(.+)$/, (req, res, m) => {
    const p = projectOf(m[1]); const b = decodeURIComponent(m[2]);
    if (!p || !p.branches.has(b)) return notFound(res, '404 Branch Not Found');
    send(res, 200, { name: b, default: b === p.default_branch, protected: false, commit: commitView(p, S.commits.get(p.branches.get(b))) });
  });
  route('POST', /^\/api\/v4\/projects\/([^/]+)\/repository\/branches$/, (req, res, m) => {
    const p = projectOf(m[1]); if (!p) return notFound(res);
    const q = new URL(req.url, 'https://x').searchParams; const b = q.get('branch'); const ref = resolveRef(p, q.get('ref'));
    if (!b || !ref) return send(res, 400, { message: 'Invalid reference name' });
    if (p.branches.has(b)) return send(res, 400, { message: 'Branch already exists' });
    p.branches.set(b, ref);
    send(res, 201, { name: b, commit: commitView(p, S.commits.get(ref)) });
  });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/repository\/tree$/, (req, res, m) => {
    const p = projectOf(m[1]); if (!p) return notFound(res);
    const q = new URL(req.url, 'https://x').searchParams; const c = S.commits.get(resolveRef(p, q.get('ref')));
    if (!c) return notFound(res, '404 Tree Not Found');
    page(req, res, [...c.tree].sort().map(([path, sha]) => ({ id: sha, name: path.split('/').pop(), type: 'blob', path, mode: '100644' })));
  });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/repository\/blobs\/([0-9a-f]+)\/raw$/, (req, res, m) => { const b = S.blobs.get(m[2]); return b ? send(res, 200, b) : notFound(res, '404 Blob Not Found'); });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/repository\/commits$/, (req, res, m) => {
    const p = projectOf(m[1]); if (!p) return notFound(res);
    const q = new URL(req.url, 'https://x').searchParams; const ref = resolveRef(p, q.get('ref_name'));
    page(req, res, ref ? ancestors(ref).map((cid) => commitView(p, S.commits.get(cid))) : []);
  });
  route('POST', /^\/api\/v4\/projects\/([^/]+)\/repository\/commits$/, (req, res, m, me, body) => {
    const p = projectOf(m[1]); if (!p) return notFound(res);
    let parent = p.branches.get(body.branch) ?? null;
    if (!parent && body.start_branch) parent = p.branches.get(body.start_branch) ?? null;
    if (!parent && p.branches.size > 0 && !body.start_branch) return send(res, 400, { message: 'You can only create or edit files when you are on a branch' });
    const tree = new Map(parent ? S.commits.get(parent).tree : []);
    for (const a of body.actions || []) {
      const fp = a.file_path;
      if (a.action === 'create' && tree.has(fp)) return send(res, 400, { message: 'A file with this name already exists' });
      if ((a.action === 'update' || a.action === 'delete') && !tree.has(fp)) return send(res, 400, { message: 'A file with this name doesn\'t exist' });
      if (a.action === 'delete') { tree.delete(fp); continue; }
      const buf = a.encoding === 'base64' ? Buffer.from(a.content || '', 'base64') : Buffer.from(a.content || '', 'utf8');
      const sha = blobSha(buf); S.blobs.set(sha, buf); tree.set(fp, sha);
    }
    const author = { ...me.user, name: body.author_name || me.user.name, email: body.author_email || me.user.email };
    const c = makeCommit(p, body.branch, parent, tree, body.commit_message, author);
    S.lastCommitBody = body;
    send(res, 201, commitView(p, c));
  });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/repository\/compare$/, (req, res, m) => {
    const p = projectOf(m[1]); const q = new URL(req.url, 'https://x').searchParams;
    const to = resolveRef(p, q.get('to')); const from = resolveRef(p, q.get('from'));
    const list = []; for (const cid of ancestors(to)) { if (cid === from) break; list.push(commitView(p, S.commits.get(cid))); }
    send(res, 200, { commits: list.reverse(), diffs: [], compare_same_ref: from === to });
  });

  // merge requests
  const mrView = (p, mr) => ({ iid: mr.iid, title: mr.title, description: mr.description, state: mr.state, web_url: `${url}/${p.path_with_namespace}/-/merge_requests/${mr.iid}`, source_branch: mr.source_branch, target_branch: mr.target_branch,
    author: pub(S.users.get(mr.authorId)), reviewers: mr.reviewers.map((r) => pub(S.users.get(r.userId))), merged_at: mr.merged_at ?? null, sha: p.branches.get(mr.source_branch) ?? null, detailed_merge_status: 'mergeable' });
  route('POST', /^\/api\/v4\/projects\/([^/]+)\/merge_requests$/, (req, res, m, me, body) => {
    const p = projectOf(m[1]); if (!p) return notFound(res);
    if (!p.branches.has(body.source_branch) || !p.branches.has(body.target_branch)) return send(res, 400, { message: ['Source branch does not exist'] });
    const mr = { iid: p.nextIid++, title: body.title, description: body.description, state: 'opened', source_branch: body.source_branch, target_branch: body.target_branch, authorId: me.user.id,
      reviewers: (body.reviewer_ids || []).map((uid) => ({ userId: uid, state: 'unreviewed' })), approvals: new Set(), discussions: [], baseSha: p.branches.get(body.target_branch), removeSource: !!body.remove_source_branch };
    S.mrs.set(`${p.id}:${mr.iid}`, mr);
    send(res, 201, mrView(p, mr));
  });
  const mrOf = (m) => { const p = projectOf(m[1]); const mr = p && S.mrs.get(`${p.id}:${Number(m[2])}`); return { p, mr }; };
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/merge_requests\/(\d+)$/, (req, res, m) => { const { p, mr } = mrOf(m); return mr ? send(res, 200, mrView(p, mr)) : notFound(res); });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/merge_requests\/(\d+)\/approvals$/, (req, res, m) => {
    const { p, mr } = mrOf(m); if (!mr) return notFound(res);
    const left = Math.max(0, p.approvalsRequired - mr.approvals.size);
    send(res, 200, { approved: left === 0, approvals_required: p.approvalsRequired, approvals_left: left, approved_by: [...mr.approvals].map((u) => ({ user: pub(S.users.get(u)) })) });
  });
  route('POST', /^\/api\/v4\/projects\/([^/]+)\/merge_requests\/(\d+)\/approve$/, (req, res, m, me) => {
    const { p, mr } = mrOf(m); if (!mr) return notFound(res);
    if (mr.approvals.has(me.user.id)) return send(res, 401, { message: '401 Unauthorized' });
    mr.approvals.add(me.user.id);
    send(res, 201, { approved: mr.approvals.size >= p.approvalsRequired });
  });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/merge_requests\/(\d+)\/discussions$/, (req, res, m) => { const { mr } = mrOf(m); return mr ? page(req, res, mr.discussions) : notFound(res); });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/merge_requests\/(\d+)\/reviewers$/, (req, res, m) => { const { mr } = mrOf(m); return mr ? send(res, 200, mr.reviewers.map((r) => ({ user: pub(S.users.get(r.userId)), state: r.state, created_at: now() }))) : notFound(res); });
  route('PUT', /^\/api\/v4\/projects\/([^/]+)\/merge_requests\/(\d+)\/merge$/, (req, res, m, me) => {
    const { p, mr } = mrOf(m); if (!mr) return notFound(res);
    if (mr.state !== 'opened') return send(res, 405, { message: '405 Method Not Allowed' });
    if (mr.approvals.size < p.approvalsRequired) return send(res, 405, { message: 'Merge request is not mergeable' });
    const src = S.commits.get(p.branches.get(mr.source_branch)); const tgtHead = p.branches.get(mr.target_branch); const tgt = S.commits.get(tgtHead); const base = S.commits.get(mr.baseSha);
    const tree = new Map(tgt.tree);
    const paths = new Set([...src.tree.keys(), ...base.tree.keys()]);
    for (const path of paths) { const s = src.tree.get(path); const b = base.tree.get(path); if (s !== b) { if (s) tree.set(path, s); else tree.delete(path); } }
    makeCommit(p, mr.target_branch, tgtHead, tree, `Merge branch '${mr.source_branch}' into '${mr.target_branch}'`, me.user);
    mr.state = 'merged'; mr.merged_at = now();
    if (mr.removeSource) p.branches.delete(mr.source_branch);
    send(res, 200, mrView(p, mr));
  });

  // packages and releases
  route('PUT', /^\/api\/v4\/projects\/([^/]+)\/packages\/generic\/([^/]+)\/([^/]+)\/([^/]+)$/, (req, res, m, me, body, raw) => {
    const p = projectOf(m[1]); if (!p) return notFound(res);
    S.packages.set(`${p.id}/${decodeURIComponent(m[2])}/${decodeURIComponent(m[3])}/${decodeURIComponent(m[4])}`, raw);
    send(res, 201, { message: '201 Created' });
  });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/packages\/generic\/([^/]+)\/([^/]+)\/([^/]+)$/, (req, res, m) => {
    const p = projectOf(m[1]); const b = p && S.packages.get(`${p.id}/${decodeURIComponent(m[2])}/${decodeURIComponent(m[3])}/${decodeURIComponent(m[4])}`);
    return b ? send(res, 200, b) : notFound(res);
  });
  route('POST', /^\/api\/v4\/projects\/([^/]+)\/releases$/, (req, res, m, me, body) => {
    const p = projectOf(m[1]); if (!p) return notFound(res);
    const list = S.releases.get(p.id) ?? []; if (list.some((r) => r.tag_name === body.tag_name)) return send(res, 409, { message: 'Release already exists' });
    if (!p.tags.has(body.tag_name)) { const ref = resolveRef(p, body.ref); if (!ref) return send(res, 400, { message: 'Ref is not specified' }); p.tags.set(body.tag_name, ref); }
    const rel = { tag_name: body.tag_name, name: body.name, description: body.description, assets: { links: (body.assets?.links ?? []).map((l, i) => ({ id: i + 1, ...l })) }, created_at: now(), _links: { self: `${url}/${p.path_with_namespace}/-/releases/${encodeURIComponent(body.tag_name)}` } };
    list.push(rel); S.releases.set(p.id, list);
    send(res, 201, rel);
  });
  route('GET', /^\/api\/v4\/projects\/([^/]+)\/releases$/, (req, res, m) => { const p = projectOf(m[1]); page(req, res, p ? S.releases.get(p.id) ?? [] : []); });

  // OAuth (Doorkeeper-like)
  route('GET', /^\/oauth\/authorize$/, (req, res) => {
    const q = new URL(req.url, 'https://x').searchParams;
    const app = S.apps.get(q.get('client_id') || '');
    if (!app || q.get('redirect_uri') !== app.redirectUri) return send(res, 400, { error: 'invalid_request', error_description: 'unknown client or redirect URI' });
    if (!S.authorizeAs) return send(res, 302, '', { location: `${url}/users/sign_in` });
    if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return send(res, 400, { error: 'invalid_request', error_description: 'PKCE required' });
    const code = crypto.randomBytes(16).toString('hex');
    S.codes.set(code, { userId: S.authorizeAs, clientId: q.get('client_id'), redirectUri: q.get('redirect_uri'), challenge: q.get('code_challenge'), scope: q.get('scope'), expiresAt: Date.now() + 600_000 });
    const to = new URL(app.redirectUri); to.searchParams.set('code', code); to.searchParams.set('state', q.get('state') || '');
    send(res, 302, '', { location: to.toString() });
  }, { auth: false });
  const issue = (userId, clientId, scope) => {
    const access = `oauth-${crypto.randomBytes(16).toString('hex')}`; const refresh = `rt-${crypto.randomBytes(16).toString('hex')}`;
    S.tokens.set(access, { userId, scopes: String(scope || 'api').split(' '), kind: 'oauth', expiresAt: new Date(Date.now() + S.tokenLifetime * 1000).toISOString() });
    S.refresh.set(refresh, { userId, clientId, scope, access });
    return { access_token: access, token_type: 'Bearer', expires_in: S.tokenLifetime, refresh_token: refresh, scope: scope || 'api', created_at: Math.floor(Date.now() / 1000) };
  };
  route('POST', /^\/oauth\/token$/, (req, res, m, me, body) => {
    const app = S.apps.get(body.client_id || '');
    if (!app || app.secret !== body.client_secret) return send(res, 401, { error: 'invalid_client', error_description: 'Client authentication failed due to unknown client, no client authentication included, or unsupported authentication method.' });
    if (body.grant_type === 'authorization_code') {
      const c = S.codes.get(body.code || ''); S.codes.delete(body.code || '');
      if (!c || c.clientId !== body.client_id || c.redirectUri !== body.redirect_uri || c.expiresAt < Date.now()) return send(res, 400, { error: 'invalid_grant', error_description: 'The provided authorization grant is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.' });
      const want = crypto.createHash('sha256').update(String(body.code_verifier || '')).digest('base64url');
      if (want !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
      return send(res, 200, issue(c.userId, body.client_id, c.scope));
    }
    if (body.grant_type === 'refresh_token') {
      const r = S.refresh.get(body.refresh_token || ''); if (!r || r.clientId !== body.client_id) return send(res, 400, { error: 'invalid_grant' });
      S.refresh.delete(body.refresh_token); S.tokens.delete(r.access);
      S.refreshed = (S.refreshed || 0) + 1;
      return send(res, 200, issue(r.userId, r.clientId, r.scope));
    }
    send(res, 400, { error: 'unsupported_grant_type' });
  }, { auth: false });
  route('POST', /^\/oauth\/revoke$/, (req, res, m, me, body) => { S.tokens.delete(body.token || ''); S.revoked = (S.revoked || 0) + 1; send(res, 200, {}); }, { auth: false });

  // test control (the e2e spec drives the mock over HTTP; only when started with control: true)
  if (control) {
    route('POST', /^\/__mock\/commit$/, (req, res, m, me, body) => { const c = h.commitAs(body.projectId, body.userId, body.branch, body.message, body.files); send(res, 201, { id: c.id }); }, { auth: false });
    route('POST', /^\/__mock\/note$/, (req, res, m, me, body) => send(res, 201, h.addNote(body.projectId, body.iid, body.userId, body.body, { path: body.path })), { auth: false });
    route('POST', /^\/__mock\/approve$/, (req, res, m, me, body) => { h.approveAs(body.projectId, body.iid, body.userId); send(res, 201, {}); }, { auth: false });
    route('POST', /^\/__mock\/authorize-as$/, (req, res, m, me, body) => { S.authorizeAs = body.userId; send(res, 200, {}); }, { auth: false });
    route('GET', /^\/__mock\/state$/, (req, res) => send(res, 200, { projects: [...S.projects.values()].map((p) => ({ id: p.id, path: p.path_with_namespace, branches: Object.fromEntries(p.branches) })), releases: Object.fromEntries(S.releases), packages: [...S.packages.keys()], mrs: [...S.mrs.keys()] }), { auth: false });
  }

  const server = https.createServer({ cert: leaf.certPem + ca.certPem, key: leaf.keyPem, minVersion: 'TLSv1.2' }, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const u = new URL(req.url, 'https://x');
      const me = who(req);
      S.log.push({ method: req.method, path: u.pathname, query: u.search, auth: me ? me.token.kind : null, at: now() });
      const fail = S.failNext.findIndex((f) => (!f.method || f.method === req.method) && f.path.test(u.pathname));
      if (fail >= 0) { const f = S.failNext.splice(fail, 1)[0]; return send(res, f.status, { message: f.message || `${f.status} mock failure` }); }
      let body = {};
      const type = String(req.headers['content-type'] || '');
      if (type.includes('json') && raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { message: 'bad json' }); } }
      else if (type.includes('x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(u.pathname);
        if (!m) continue;
        if (r.auth && !me) return send(res, 401, { message: '401 Unauthorized' });
        try { return r.fn(req, res, m, me, body, raw); } catch (e) { return send(res, 500, { message: String(e && e.stack || e) }); }
      }
      send(res, 404, { error: '404 Not Found' });
    });
  });
  await new Promise((r) => server.listen(port, host, r));
  url = `https://${host}:${server.address().port}`;
  return { url, caPem: ca.certPem, otherCaPem: makeCertificate({ commonName: 'Unrelated CA', ca: true }).certPem, state: S, ...h, blobSha, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

module.exports = { startMockGitlab };
