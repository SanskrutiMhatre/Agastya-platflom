'use strict';
// WP-13 (DEP-004): one version, queryable. /api/health and /api/version report the package version (never a literal), the API level and the
// database schema level; the root and backend package.json agree; the packaging pin names a supported Node line.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot } = require('./helpers');

const ROOT = path.resolve(__dirname, '..', '..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const bePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'package.json'), 'utf8'));

test('the root and backend package.json carry the same version (the packager refuses otherwise)', () => {
  assert.match(rootPkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(bePkg.version, rootPkg.version);
});

test('the pinned runtime is a Node LTS line with at least 12 months of support', () => {
  const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'packaging', 'product.json'), 'utf8'));
  assert.match(product.runtime.node, /^24\.\d+\.\d+$/, 'WP-13 decision: the product ships Node 24 LTS');
  assert.match(product.runtime.nodeZipSha256, /^[0-9a-f]{64}$/);
  const months = (new Date(product.runtime.nodeEndOfLife) - new Date()) / (30.44 * 864e5);
  assert.ok(months >= product.runtime.minSupportMonths, `Node ${product.runtime.node} has ${months.toFixed(1)} months of support left`);
  // the engines range admits the pinned version
  assert.match(bePkg.engines.node, /\^24\./);
});

test('/api/health and /api/version (public) report the package version, API level and schema level', async () => {
  const h = await boot();
  try {
    const anon = new h.Client('anon');
    const health = await anon.req('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.version, rootPkg.version);

    const v = await anon.req('GET', '/api/version');
    assert.equal(v.status, 200);
    assert.equal(v.json.version, rootPkg.version);
    assert.equal(v.json.product, 'Agastya Platform');
    assert.ok(Number.isInteger(v.json.apiVersion) && v.json.apiVersion >= 1, 'an integer API level');
    assert.match(v.json.minClientVersion, /^\d+\.\d+\.\d+$/);
    const { MIGRATIONS } = require('../dist/core/auth/store');
    assert.equal(v.json.schema.level, MIGRATIONS.length);
    assert.equal(v.json.schema.latest, MIGRATIONS[MIGRATIONS.length - 1].name);
    assert.equal(v.json.schema.applied, MIGRATIONS.length, 'a fresh database has every migration applied');
    assert.equal(v.json.schema.compatible, true);
    assert.equal(v.json.build.packaged, false, 'a source checkout has no version.json stamp');
    // nothing about users, paths or the runtime leaks from a public route
    assert.doesNotMatch(JSON.stringify(v.json), /workspace|[A-Z]:\\|node|admin/i);
  } finally { await h.close(); }
});

test('schemaLevel reports migrations from a newer build as unknown (downgrade detection)', () => {
  const { schemaLevel } = require('../dist/services/version');
  const s = schemaLevel(['001-a', '002-b', '999-from-the-future'], [{ name: '001-a' }, { name: '002-b' }]);
  assert.deepEqual(s, { level: 2, latest: '002-b', applied: 3, unknown: ['999-from-the-future'] });
});
