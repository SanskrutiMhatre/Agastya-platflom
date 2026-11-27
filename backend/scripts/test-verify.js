'use strict';
// The full backend verification: every issue (4.2, 5.0, 6, 7) for the publication gate, the BREX gate and the 21-type backend checks.
// (`npm test` runs the publication gate on issue 5.0 only, because every gated request really validates and is slow.)
const { spawnSync } = require('child_process');
const path = require('path');
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/publish-gate.test.js', 'test/brex-gate.test.js', 'test/dmtypes.test.js'], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', env: { ...process.env, VERIFY_FULL: '1' } });
process.exit(r.status ?? 1);
