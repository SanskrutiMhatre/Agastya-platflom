'use strict';
// Every API route must carry exactly one authorisation guard, or be explicitly
// public with a stated reason. A guard that has to be remembered on each new
// route is a guard that will eventually be forgotten on one - so this test
// reads the live Express router and fails the build if any route lacks one.
// (Same rule JSS Publisher enforces in its own test suite.)

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

test('every /api route is guarded or explicitly public', async () => {
  const h = await boot();
  try {
    const { createApp } = require('../dist/app');
    const app = createApp();
    const stack = app._router.stack.filter((l) => l.route);
    assert.ok(stack.length > 60, `expected the full route table, saw ${stack.length}`);

    const unguarded = [];
    const publicRoutes = [];
    for (const layer of stack) {
      const route = layer.route;
      if (!String(route.path).startsWith('/api/')) continue;
      const guards = route.stack.map((s) => s.handle).filter((f) => f.isAuthGuard || f.isPublicMarker);
      const label = `${Object.keys(route.methods).join(',').toUpperCase()} ${route.path}`;
      if (guards.length === 0) unguarded.push(label);
      if (guards.some((g) => g.isPublicMarker)) publicRoutes.push(label);
    }
    assert.deepEqual(unguarded, [], `routes with no guard:\n  ${unguarded.join('\n  ')}`);

    // The public surface is exactly the intended set.
    assert.deepEqual(publicRoutes.sort(), [
      'GET /api/auth/setup', 'GET /api/health', 'POST /api/auth/forgot', 'POST /api/auth/login', 'POST /api/auth/setup',
    ].sort());
  } finally { await h.close(); }
});
