// WP-19 (DS-001, TH-002, TH-005, TH-009): the token scripts pass on the tree, and each of them fails when it should.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const FRONTEND = path.resolve(__dirname, '..', '..', '..');
const run = (script: string, env: Record<string, string> = {}, args: string[] = []) =>
  spawnSync(process.execPath, [path.join(FRONTEND, 'scripts', 'tokens', script), ...args], { cwd: FRONTEND, encoding: 'utf8', env: { ...process.env, ...env } });

describe('design tokens', () => {
  it('tokens.css is what tokens.json generates', () => {
    const r = run('build-tokens.mjs', {}, ['--check']);
    expect(r.status, r.stderr + r.stdout).toBe(0);
  });

  it('every checked pair passes in both themes and every var(--x) resolves', () => {
    const r = run('check-contrast.mjs');
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/0 failing/);
  });

  it('the contrast check fails when a token is weakened (text-tertiary set to a pale grey)', () => {
    const src = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'styles', 'tokens', 'tokens.json'), 'utf8'));
    src.primitive[src.semantic['text-tertiary'][0].slice(1, -1)] = '#999999';
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tok-')), 'tokens.json');
    fs.writeFileSync(tmp, JSON.stringify(src));
    const r = run('check-contrast.mjs', { TOKENS_SOURCE: tmp });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FAIL light text-tertiary on surface-panel/);
  });

  it('a semantic token without its dark value is rejected', () => {
    const src = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'styles', 'tokens', 'tokens.json'), 'utf8'));
    src.semantic.info = ['{blue-650}'];
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tok-')), 'tokens.json');
    fs.writeFileSync(tmp, JSON.stringify(src));
    const r = run('check-contrast.mjs', { TOKENS_SOURCE: tmp });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/semantic\.info: needs \[light, dark\]/);
  });

  it('the coverage check fails on a variable nothing defines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
    fs.writeFileSync(path.join(dir, 'x.css'), '.a { color: var(--no-such-token); }\n');
    const r = run('check-contrast.mjs', { COVERAGE_SRC: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/--no-such-token/);
  });

  it('no colour literal outside the token files', () => {
    const r = run('lint-colors.mjs');
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/colour literals outside the token files: 0/);
  });

  it('the lint catches a hex, an rgba() and a named colour in CSS and in an injected TS stylesheet', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-'));
    fs.writeFileSync(path.join(dir, 'a.css'), '.x { color: #ff0000; background: rgba(0, 0, 0, .2); border-color: red; }\n');
    fs.writeFileSync(path.join(dir, 'b.ts'), "export const CSS = `.y{background:#fff}`;\nconst s = { color: 'white' };\n");
    const r = run('lint-colors.mjs', { LINT_SRC: dir });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/colour literals outside the token files: 5/);
  });
});
