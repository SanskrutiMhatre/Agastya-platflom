'use strict';
// WP-10 (PRD-002): the storage contract. One suite of behaviour that every engine's repositories must show; today it runs against the
// SQLite implementation. A PostgreSQL adapter (WP-37) adds one line at the bottom (`contract('postgres', makePostgres)`) and must pass the
// same tests unchanged. The suite talks to the repositories only through their interfaces (src/repositories/index.ts) and the
// LimiterStore interface (src/storage/authStores.ts); seeding that only the AuthStore can do (audit rows) goes through the context.
//
// It never calls boot(): each engine is built on a throwaway workspace with createAppContext.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeSqlite() {
  const { buildConfig } = require('../dist/config');
  const { createAppContext } = require('../dist/appContext');
  const ctx = createAppContext(buildConfig({ AGASTYA_WORKSPACE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-contract-')) }));
  ctx.start();
  return { repos: ctx.repos, limiterStores: { authStore: ctx.limiterStore, memory: new (require('../dist/storage/authStores').MemoryLimiterStore)() }, audit: ctx.audit, close: () => ctx.close() };
}

function contract(engine, make) {
  const now = '2026-11-27T10:00:00.000Z'; const later = '2026-11-27T11:00:00.000Z';
  const withRepos = (name, fn) => test(`[${engine}] ${name}`, async () => { const e = make(); try { await fn(e.repos, e); } finally { e.close(); } });

  withRepos('unit of work: a throw rolls back every write in it, a return commits', (R) => {
    assert.throws(() => R.transaction(() => { R.registry.upsertProject({ id: 'tx1', name: 'T', now }); throw new Error('boom'); }), /boom/);
    assert.equal(R.registry.getProject('tx1'), null, 'rolled back');
    assert.equal(R.transaction(() => { R.registry.upsertProject({ id: 'tx2', name: 'T', now }); return 7; }), 7);
    assert.ok(R.registry.getProject('tx2'), 'committed');
    assert.equal(typeof R.dialect, 'string');
  });

  withRepos('schema level: every migration the code knows is applied after start(), in order (the version handshake, WP-13)', (R) => {
    const { MIGRATIONS } = require('../dist/core/auth/store');
    const applied = R.appliedMigrations();
    assert.deepEqual(applied, [...applied].sort(), 'in name order');
    for (const m of MIGRATIONS) assert.ok(applied.includes(m.name), `${m.name} applied`);
  });

  withRepos('project registry: upsert keeps created_at, defaults type/template, lists most recently used first, file index replace', (R) => {
    R.registry.upsertProject({ id: 'p1', name: 'One', now });
    const a = R.registry.getProject('p1');
    assert.equal(a.type, 'JSS'); assert.equal(a.template, 'default'); assert.equal(a.created_at, now); assert.equal(a.last_opened, null);
    R.registry.upsertProject({ id: 'p1', name: 'One renamed', type: 'S1000D', template: 'xignal', now: later });
    const b = R.registry.getProject('p1');
    assert.equal(b.name, 'One renamed'); assert.equal(b.type, 'S1000D'); assert.equal(b.created_at, now, 'created_at is kept'); assert.equal(b.updated_at, later);
    R.registry.upsertProject({ id: 'p2', name: 'Two', now });
    R.registry.touchOpened('p2', '2026-11-27T12:00:00.000Z');
    assert.deepEqual(R.registry.listProjects().map((p) => p.id), ['p2', 'p1']);
    R.registry.replaceFileIndex('p1', [{ rel_path: 'b.xml', kind: 'dmc' }, { rel_path: 'a.xml', kind: 'pmc', chapter: '1' }], now);
    assert.deepEqual(R.registry.listFiles('p1').map((f) => [f.rel_path, f.kind, f.chapter]), [['a.xml', 'pmc', '1'], ['b.xml', 'dmc', null]]);
    R.registry.replaceFileIndex('p1', [{ rel_path: 'c.xml', kind: 'other' }], now);
    assert.deepEqual(R.registry.listFiles('p1').map((f) => f.rel_path), ['c.xml']);
    R.registry.deleteProject('p1');
    assert.equal(R.registry.getProject('p1'), null); assert.deepEqual(R.registry.listFiles('p1'), []);
    assert.equal(R.registry.getProject('nope'), null);
  });

  withRepos('SNS presets: create, name check (case-insensitive), model, nodes, branch delete with LIKE wildcards escaped', (R) => {
    R.sns.insertCustomPreset({ id: 'custom-1', name: 'Model X', source: 'Created by an Administrator', now, model: 'MX' });
    assert.equal(R.sns.presetExists('custom-1'), true); assert.equal(R.sns.presetNameTaken('model x'), true); assert.equal(R.sns.presetNameTaken('other'), false);
    R.sns.putPresetNode('custom-1', { path: '21', level: 1, code: '21', title: 'Air' });
    R.sns.putPresetNode('custom-1', { path: '21', level: 1, code: '21', title: 'Air conditioning' });          // retitle
    R.sns.putPresetNode('custom-1', { path: '21/10', level: 2, code: '10', title: 'Distribution' });
    R.sns.insertPresetNode('custom-1', { path: '2_', level: 1, code: '2_', title: 'Wildcard look-alike', definition: '{}' });
    assert.equal(R.sns.presetNodeExists('custom-1', '21/10'), true);
    assert.deepEqual(R.sns.presetPathsBelow('custom-1', '21'), ['21/10']);
    assert.deepEqual(R.sns.presetPathsBelow('custom-1', '2_'), [], '_ in a path is a character, not a wildcard');
    const row = R.sns.listPresets().find((p) => p.id === 'custom-1');
    assert.equal(Number(row.systems), 2); assert.equal(Number(row.entries), 3); assert.equal(row.model_code, 'MX');
    assert.equal(R.sns.presetNodes('custom-1').find((n) => n.path === '21').title, 'Air conditioning');
    R.sns.setPresetModel('custom-1', null);
    assert.equal(R.sns.listPresets().find((p) => p.id === 'custom-1').model_code, null);
    assert.equal(R.sns.deletePresetBranch('custom-1', '21'), 2);
    assert.equal(R.sns.presetNodeCount('custom-1'), 1);
    R.sns.upsertSpecPreset({ id: 'spec42-x', name: 'Spec', source: 'v1', limitation: 'L', now });
    R.sns.upsertSpecPreset({ id: 'spec42-x', name: 'Spec renamed is ignored', source: 'v2', limitation: 'L2', now });
    assert.equal(R.sns.presetSource('spec42-x'), 'v2');
    assert.equal(R.sns.listPresets().find((p) => p.id === 'spec42-x').name, 'Spec', 'an upsert refreshes source and limitation only');
    R.sns.deletePreset('custom-1');
    assert.equal(R.sns.presetExists('custom-1'), false); assert.equal(R.sns.presetNodeCount('custom-1'), 0);
  });

  withRepos('project SNS: put/retitle, branch read in path order, move by delete + insert inside a transaction, delete branch', (R) => {
    const put = (p, title) => R.sns.putProjectNode('p', { path: p, level: p.split('/').length, code: p.split('/').pop(), title, presetId: null });
    put('21', 'Air'); put('21/10', 'Dist'); put('21/10/00', 'Ducts'); put('22', 'Auto flight');
    put('21', 'Air conditioning');
    assert.equal(R.sns.projectNode('p', '21').title, 'Air conditioning');
    assert.deepEqual(R.sns.listProjectNodes('p').map((n) => n.path), ['21', '21/10', '21/10/00', '22']);
    assert.deepEqual(R.sns.projectBranch('p', '21').map((n) => n.path), ['21', '21/10', '21/10/00']);
    assert.deepEqual(R.sns.projectPathsBelow('p', '21'), ['21/10', '21/10/00']);
    R.transaction(() => {
      const branch = R.sns.projectBranch('p', '21/10');
      R.sns.deleteProjectBranch('p', '21/10');
      for (const b of branch) { const moved = '21/20' + b.path.slice('21/10'.length); R.sns.insertProjectNode('p', { path: moved, level: b.level, code: moved.split('/').pop(), title: b.title, presetId: b.preset_id ?? null }); }
    });
    assert.deepEqual(R.sns.listProjectNodes('p').map((n) => n.path), ['21', '21/20', '21/20/00', '22']);
    R.sns.setProjectNodeTitle('p', '22', 'Flight');
    assert.equal(R.sns.projectNode('p', '22').title, 'Flight');
    assert.equal(R.sns.deleteProjectBranch('p', '21'), 3);
    assert.equal(R.sns.projectNode('p', '21'), undefined);
    assert.deepEqual(R.sns.listProjectNodes('other'), []);
  });

  withRepos('project configuration: versioned document, selected codes, offered DM types, copy and delete', (R) => {
    assert.equal(R.projectConfig.get('p'), undefined);
    R.projectConfig.insert('p', '{"mic":"A"}', now, 'u1');
    R.projectConfig.update('p', '{"mic":"B"}', later, 'u2');
    const row = R.projectConfig.get('p');
    assert.equal(row.version, 2); assert.equal(JSON.parse(row.data).mic, 'B'); assert.equal(row.created_at, now); assert.equal(row.updated_at, later); assert.equal(row.updated_by, 'u2');
    R.projectConfig.replaceSelectedCodes('p', 'infoCode', ['720', '040', '520']);
    assert.deepEqual(R.projectConfig.selectedCodes('p', 'infoCode'), ['040', '520', '720'], 'sorted by code');
    R.projectConfig.replaceSelectedCodes('p', 'infoCode', ['100']);
    assert.deepEqual(R.projectConfig.selectedCodes('p', 'infoCode'), ['100'], 'a replace, not a merge');
    assert.throws(() => R.projectConfig.replaceSelectedCodes('p', 'infoCode', ['200', '200']));
    assert.deepEqual(R.projectConfig.selectedCodes('p', 'infoCode'), ['100'], 'a failed replace changes nothing');
    R.projectConfig.replaceDisabledTypes('p', ['proced', 'descript']);
    assert.deepEqual(R.projectConfig.disabledTypes('p').sort(), ['descript', 'proced']);
    R.sns.putProjectNode('p', { path: '21', level: 1, code: '21', title: 'Air', presetId: null });
    R.projectConfig.copyProjectRows('p', 'q');
    assert.deepEqual(R.projectConfig.selectedCodes('q', 'infoCode'), ['100']);
    assert.deepEqual(R.projectConfig.disabledTypes('q').sort(), ['descript', 'proced']);
    assert.equal(R.sns.projectNode('q', '21').title, 'Air');
    R.projectConfig.recordImpact(now, 'u1', 'edit infoCode 100 (4-2)', '{"projects":[]}');
    R.projectConfig.deleteProject('p');
    assert.equal(R.projectConfig.get('p'), undefined); assert.deepEqual(R.projectConfig.selectedCodes('p', 'infoCode'), []);
    assert.deepEqual(R.projectConfig.disabledTypes('p'), []); assert.equal(R.sns.projectNode('p', '21'), undefined);
    assert.equal(R.sns.projectNode('q', '21').title, 'Air', 'the copy is untouched');
  });

  withRepos('reference catalogue: a BREX upsert never overwrites a custom code; deleting a code clears it from projects on that issue only', (R) => {
    R.reference.upsertBrexSource({ id: 'brex:4-2', label: 'Default BREX', file: 'b.xml', sha256: 'h1', issue: '4-2', limitation: 'L', now });
    assert.equal(R.reference.sourceSha('brex:4-2'), 'h1');
    R.reference.upsertBrexSource({ id: 'brex:4-2', label: 'ignored', file: 'b2.xml', sha256: 'h2', issue: '4-2', limitation: 'L', now: later });
    assert.equal(R.reference.sourceSha('brex:4-2'), 'h2');
    R.reference.upsertBrexCode({ kind: 'infoCode', issue: '4-2', code: '040', title: 'Description', sourceId: 'brex:4-2', ruleId: 'R1', now });
    R.reference.insertCustomCode({ kind: 'infoCode', issue: '4-2', code: '9AA', title: 'Ours', now });
    R.reference.upsertBrexCode({ kind: 'infoCode', issue: '4-2', code: '9AA', title: 'From BREX', sourceId: 'brex:4-2', ruleId: 'R1', now: later });
    const custom = R.reference.getCode('infoCode', '4-2', '9AA');
    assert.equal(custom.origin, 'custom'); assert.equal(custom.title, 'Ours', 'the administrator\'s own code is never overwritten by the BREX');
    const brex = R.reference.getCode('infoCode', '4-2', '040');
    assert.equal(brex.origin, 'brex'); assert.equal(brex.source_label, 'Default BREX');
    assert.equal(R.reference.brexCodeCount('4-2'), 1);
    assert.deepEqual(R.reference.listCodes('infoCode', '4-2').map((c) => c.code), ['040', '9AA']);
    assert.deepEqual(R.reference.countCodes('infoCode', '4-2'), { n: 2, custom: 1 });
    assert.deepEqual(R.reference.countCodes('learnCode', '4-2'), { n: 0, custom: 0 });
    R.reference.insertCustomCodeIfAbsent({ kind: 'infoCode', issue: '4-2', code: '9AA', title: 'Again', now });
    assert.equal(R.reference.getCode('infoCode', '4-2', '9AA').title, 'Ours', 'if-absent leaves an existing code alone');
    R.reference.setCodeTitle('infoCode', '4-2', '9AA', 'Ours, renamed', later);
    assert.equal(R.reference.getCode('infoCode', '4-2', '9AA').title, 'Ours, renamed');
    R.reference.upsertRange({ kind: 'infoCode', issue: '4-2', pattern: '9[A-Z]{2}', title: 'Project', sourceId: 'brex:4-2', ruleId: 'R1' });
    R.reference.upsertRange({ kind: 'infoCode', issue: '4-2', pattern: '9[A-Z]{2}', title: 'Project available', sourceId: 'brex:4-2', ruleId: 'R2' });
    assert.deepEqual(R.reference.listRanges('infoCode', '4-2').map((r) => [r.pattern, r.title, r.rule_id]), [['9[A-Z]{2}', 'Project available', 'R2']]);
    R.reference.upsertAdviceSource({ id: 's1kd-dmtypes', label: 'advice', file: 'r.json', sha256: 'x', limitation: null, now });
    R.reference.addDmTypeAdvice('proced', '520', 's1kd-dmtypes'); R.reference.addDmTypeAdvice('proced', '520', 's1kd-dmtypes'); R.reference.addDmTypeAdvice('descript', '040', 's1kd-dmtypes');
    assert.deepEqual(R.reference.dmTypeAdvice().map((r) => `${r.schema}:${r.code}`), ['descript:040', 'proced:520']);
    assert.deepEqual(R.reference.listSources().map((s) => s.id), ['brex:4-2', 's1kd-dmtypes']);
    // two projects selected the custom code; only the one configured for Issue 4.2 loses it
    R.projectConfig.insert('on42', JSON.stringify({ issue: '4-2' }), now, null); R.projectConfig.insert('on50', JSON.stringify({ issue: '5-0' }), now, null);
    R.projectConfig.replaceSelectedCodes('on42', 'infoCode', ['9AA']); R.projectConfig.replaceSelectedCodes('on50', 'infoCode', ['9AA']);
    R.reference.deleteCode('infoCode', '4-2', '9AA');
    assert.equal(R.reference.getCode('infoCode', '4-2', '9AA'), undefined);
    assert.deepEqual(R.projectConfig.selectedCodes('on42', 'infoCode'), []);
    assert.deepEqual(R.projectConfig.selectedCodes('on50', 'infoCode'), ['9AA']);
  });

  withRepos('CIR links, lifecycle events and extension profiles', (R) => {
    const link = { project_id: 'p', file: 'DMC-A.xml', cir_file: 'DMC-A.xml', cir_issue: '001-00', cir_hash: 'h1', local_hash: 'h1', linked_at: now, linked_by: 'u', approved_issue: '001-00', approved_by: 'u', approved_at: now };
    R.cirLinks.put(link); R.cirLinks.put({ ...link, project_id: 'q' });
    assert.equal(R.cirLinks.get('p', 'DMC-A.xml').cir_hash, 'h1');
    assert.deepEqual(R.cirLinks.listStale('DMC-A.xml', 'h1'), []);
    assert.deepEqual(R.cirLinks.listStale('DMC-A.xml', 'h2').map((l) => l.project_id).sort(), ['p', 'q']);
    R.cirLinks.approve('p', 'DMC-A.xml', { issue: '002-00', hash: 'h2', by: 'm', at: later });
    const ap = R.cirLinks.get('p', 'DMC-A.xml');
    assert.deepEqual([ap.cir_issue, ap.cir_hash, ap.local_hash, ap.approved_issue, ap.approved_by, ap.approved_at], ['002-00', 'h2', 'h2', '002-00', 'm', later]);
    assert.deepEqual(R.cirLinks.listForProject('p').map((l) => l.file), ['DMC-A.xml']);
    assert.equal(R.cirLinks.remove('p', 'DMC-A.xml'), true); assert.equal(R.cirLinks.remove('p', 'DMC-A.xml'), false);

    for (let i = 0; i < 3; i++) R.lifecycle.record({ projectId: 'p', file: `F${i}.xml`, action: 'issue', from: i === 2 ? 'F0.xml' : null, reason: null, detail: i ? '{"n":1}' : null, actorId: 'u', actorUsername: 'alice', at: now });
    assert.deepEqual(R.lifecycle.list('p').map((e) => e.file), ['F2.xml', 'F1.xml', 'F0.xml'], 'newest first');
    assert.deepEqual(R.lifecycle.list('p', 'F0.xml').map((e) => e.file), ['F2.xml', 'F0.xml'], 'a file\'s events include those it was the source of');
    assert.deepEqual(R.lifecycle.list('other'), []);

    const prof = { id: 'x1', name: 'Ext', namespace: 'http://example.com/ext', xsd_name: 'ext.xsd', xsd_sha256: 'h', description: null, created_by: 'u', created_at: now };
    R.extensions.insertProfile(prof);
    assert.equal(R.extensions.getProfile('x1').name, 'Ext'); assert.equal(R.extensions.byNamespace('http://example.com/ext').id, 'x1'); assert.equal(R.extensions.nameTaken('Ext'), true);
    assert.throws(() => R.extensions.insertProfile({ ...prof, id: 'x2', name: 'Other' }), 'a namespace has one profile');
    R.extensions.enable('p', 'x1', 'u', now); R.extensions.enable('p', 'x1', 'u', now); R.extensions.enable('q', 'x1', 'u', now);
    assert.equal(R.extensions.projectCount('x1'), 2); assert.deepEqual(R.extensions.enabledFor('p'), ['x1']);
    R.extensions.disable('p', 'x1'); assert.deepEqual(R.extensions.enabledFor('p'), []);
    R.extensions.disable('q', 'x1'); R.extensions.deleteProfile('x1');
    assert.equal(R.extensions.getProfile('x1'), undefined); assert.deepEqual(R.extensions.listProfiles(), []);
  });

  withRepos('activity over the audit log: counts per person and action since a time, last activity ever, newest-first feed', (R, e) => {
    assert.deepEqual(R.activity.feed([]), []); assert.deepEqual(R.activity.actionStats([], now), []);
    e.audit({ actorId: 'u1', actorUsername: 'alice', action: 'dm.save', projectId: 'p', at: '2026-11-01T00:00:00.000Z' });
    e.audit({ actorId: 'u1', actorUsername: 'alice', action: 'dm.save', projectId: 'p' });
    e.audit({ actorId: 'u1', actorUsername: 'alice', action: 'dm.save', projectId: 'p' });
    e.audit({ actorId: 'u2', actorUsername: 'bob', action: 'publish', projectId: 'p' });
    e.audit({ actorId: 'u2', actorUsername: 'bob', action: 'publish', projectId: 'elsewhere' });
    const stats = R.activity.actionStats(['p'], '2026-11-20T00:00:00.000Z').map((s) => `${s.actor_id}:${s.action}:${s.n}`).sort();
    assert.deepEqual(stats, ['u1:dm.save:2', 'u2:publish:1']);
    assert.deepEqual(R.activity.lastActive(['p']).map((r) => r.actor_id).sort(), ['u1', 'u2']);
    const feed = R.activity.feed(['p']);
    assert.equal(feed.length, 4); assert.equal(feed[0].actor_username, 'bob', 'newest first');
  });

  test(`[${engine}] sign-in throttle stores: the same answers from the database table and from memory`, () => {
    const e = make();
    try {
      for (const [name, s] of Object.entries(e.limiterStores)) {
        assert.deepEqual(s.throttleGet('alice'), [], name);
        s.throttlePut('alice', [1, 2, 3], now);
        assert.deepEqual(s.throttleGet('alice'), [1, 2, 3], name);
        s.throttlePut('alice', [], now);
        assert.deepEqual(s.throttleGet('alice'), [], `${name}: an empty list removes the key`);
        s.throttlePut('old', [1], '2026-01-01T00:00:00.000Z'); s.throttlePut('new', [2], later);
        s.throttlePrune(now);
        assert.deepEqual([s.throttleGet('old'), s.throttleGet('new')], [[], [2]], `${name}: prune forgets keys older than the cut`);
      }
    } finally { e.close(); }
  });
}

contract('sqlite', makeSqlite);
