// BREX XPath fidelity: for EVERY evaluable rule of each issue's official default BREX, on every realistic module (and on a stress variant that
// carries an attribute for each restricted-value rule), the number of nodes the server's rule engine selects must equal what libxml2 (xmllint, the
// reference XPath 1.0 engine) selects. A rule that matches differently would be a false violation or a violation that is silently missed.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ISSUES, TYPES, PUB, RESULTS, richDm } from './lib';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require('../../../../../backend/dist/services/brex') as typeof import('../../../../../backend/src/services/brex');
const LETTER: Record<string, string> = { '4-2': 'F', '5-0': 'G', '6': 'H', '7': 'J' };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'brexxp-'));
const results: Record<string, { rules: number; documents: number; comparisons: number; nonZero: number; mismatches: number }> = {};

/** libxml2's node count for every expression, from ONE xmllint --shell run per document. null = libxml2 could not evaluate it. */
function libxml2Counts(file: string, exprs: string[]): Array<number | null> {
  // `xmllint --shell` truncates long input lines (some official rules are 850 characters), so those go through --xpath, one process each
  const LONG = 300;
  const short = exprs.map((e, i) => [e, i] as const).filter(([e]) => e.length <= LONG);
  const out: Array<number | null> = exprs.map(() => null);
  const input = short.map(([e, i]) => `xpath string("#${i}")\nxpath count(${e})`).join('\n') + '\nquit\n';
  const r = spawnSync('xmllint', ['--shell', file], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let cur = -1;
  for (const m of (r.stdout + '\n' + r.stderr).matchAll(/Object is a string : #(\d+)|Object is a number : (\d+)/g)) {
    if (m[1] !== undefined) cur = Number(m[1]);
    else if (cur >= 0 && out[cur] === null) out[cur] = Number(m[2]);
  }
  exprs.forEach((e, i) => {
    if (e.length <= LONG) return;
    const q = spawnSync('xmllint', ['--xpath', `count(${e})`, file], { encoding: 'utf8' });
    const n = Number(q.stdout.trim());
    out[i] = q.status === 0 && q.stdout.trim() !== '' && !Number.isNaN(n) ? n : null;
  });
  return out;
}

describe('BREX rule matching == libxml2', () => {
  for (const issue of ISSUES) {
    it(`issue ${issue}: every rule selects the same nodes in the server engine as in libxml2`, () => {
      const xml = fs.readFileSync(path.join(PUB, 'brex', `DMC-S1000D-${LETTER[issue]}-04-10-0301-00A-022A-D_001-00_EN-US.XML`), 'utf8');
      const model = server.parseBrexModel(xml, `default ${issue}`, false);
      const rules = model.rules.filter((r) => r.flag !== '1' && r.objectPath && !server.isXPath2(r.objectPath));
      const exprs = rules.map((r) => server.repairXPath(r.objectPath));

      // a stress variant: every plain attribute that a restricted-value rule names, set on <content>
      const attrs = new Set<string>();
      for (const r of model.rules) { const m = /^\/\/@([A-Za-z]+)$/.exec(r.objectPath); if (m) attrs.add(m[1]); }
      const stress = (text: string) => text.replace('<content>', `<content ${[...attrs].map((a) => `${a}="ZZ"`).join(' ')}>`);

      let comparisons = 0, nonZero = 0, mismatches = 0, docs = 0;
      for (const type of TYPES) {
        for (const variant of ['clean', 'stress'] as const) {
          const base = richDm(type, issue, type === 'brex' ? '00' : undefined);
          const text = variant === 'clean' ? base : stress(base);
          const file = path.join(TMP, `${issue}-${type}-${variant}.xml`);
          fs.writeFileSync(file, text);
          const lib = libxml2Counts(file, exprs);
          docs++;
          const bad: string[] = [];
          rules.forEach((r, i) => {
            const mine = server.matchCount(text, r.objectPath);
            if (lib[i] === null || mine === null) { if (lib[i] !== mine) bad.push(`${r.id}: server ${mine}, libxml2 ${lib[i]} (one engine could not evaluate it)`); return; }
            comparisons++;
            if (mine > 0) nonZero++;
            if (mine !== lib[i]) bad.push(`${r.id} ${r.objectPath.slice(0, 70)}: server ${mine}, libxml2 ${lib[i]}`);
          });
          mismatches += bad.length;
          expect(bad, `${type} ${issue} (${variant})`).toEqual([]);
        }
      }
      results[issue] = { rules: rules.length, documents: docs, comparisons, nonZero, mismatches };
      expect(comparisons).toBeGreaterThan(rules.length * 20);
      expect(nonZero, 'the comparison saw rules that really match something').toBeGreaterThan(100);
    }, 600_000);
  }
});

afterAll(() => {
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'brex-xpath.json'), JSON.stringify(results, null, 1));
  fs.rmSync(TMP, { recursive: true, force: true });
});
