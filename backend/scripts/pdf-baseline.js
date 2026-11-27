#!/usr/bin/env node
'use strict';
// Re-take the approved PDF regression baselines (WP-30, QA-006): test/fixtures/pdf-regression/<book>/.
//
//   node scripts/pdf-baseline.js --update                  all books
//   node scripts/pdf-baseline.js --update jss-uhb jsg-uhb  only these
//
// Refuses without --update: a baseline is an approval, so re-taking it must be a deliberate act. Review the new pictures (git diff shows them) and
// say in the commit why the look changed. Build first (npx tsc -p .). Needs the house font Arial in vendor/tools/fonts (the baselines are set in it).
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
if (!args.includes('--update')) {
  console.error('Refusing: re-taking the PDF baselines needs the explicit flag --update (node scripts/pdf-baseline.js --update [book ...]).');
  process.exit(2);
}
const books = args.filter((a) => !a.startsWith('--'));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', path.join('test', 'wp30-pdf-regression.test.js')], {
  cwd: path.join(__dirname, '..'), stdio: 'inherit', env: { ...process.env, PDF_BASELINE_UPDATE: '1', PDF_BASELINE_BOOKS: books.join(',') },
});
process.exit(r.status ?? 1);
