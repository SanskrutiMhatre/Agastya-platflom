// WP-20 (08 sections 7.2 and 7.6): the token coverage check passes on the tree and fails on each planted violation.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FRONTEND = path.resolve(__dirname, '..', '..', '..');
const run = (env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [path.join(FRONTEND, 'scripts', 'tokens', 'check-coverage.mjs')], { cwd: FRONTEND, encoding: 'utf8', env: { ...process.env, ...env } });

describe('token coverage', () => {
  it('passes on the source tree: every text colour and background in use has a contrast pair, one theme mechanism, no bare primitive', () => {
    const r = run();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/0 without a contrast pair/);
    expect(r.stdout).toMatch(/theme mechanism: 0 place/);
  });

  it('fails on an unpaired text colour, an unpaired background, a second theme setter, a media query and a bare primitive', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov20-'));
    fs.mkdirSync(path.join(dir, 'pages'));
    fs.writeFileSync(path.join(dir, 'a.css'), '.x { color: var(--scrim); }\n.y { background: var(--text-faint); }\n@media (prefers-color-scheme: dark) { .z { color: var(--text); } }\n.w { border-color: var(--p-white); }\n');
    fs.writeFileSync(path.join(dir, 'pages', 'b.tsx'), "export const go = () => { document.documentElement.dataset.theme = 'dark'; };\nexport const s = { color: 'var(--surface-hover)' };\n");
    const r = run({ COVERAGE_SRC: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/--scrim is used as a text colour/);
    expect(r.stdout).toMatch(/--surface-hover is used as a text colour/);
    expect(r.stdout).toMatch(/a\.css:3: prefers-color-scheme/);
    expect(r.stdout).toMatch(/pages\/b\.tsx:1: sets the theme attribute/);
    expect(r.stdout).toMatch(/a\.css:4: var\(--p-white\)/);
  });

  it('a stale exemption fails (the list can only shrink)', () => {
    const exempt = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'scripts', 'tokens', 'coverage-exempt.json'), 'utf8'));
    exempt.backgrounds['surface-panel'] = 'planted: surface-panel is paired, so this exemption is stale';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov20e-')), 'exempt.json');
    fs.writeFileSync(file, JSON.stringify(exempt));
    const r = run({ COVERAGE_EXEMPT: file });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/backgrounds\.surface-panel is no longer needed/);
  });
});
