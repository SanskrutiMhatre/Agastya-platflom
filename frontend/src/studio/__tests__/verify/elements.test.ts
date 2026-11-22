// EVERY element of every wizard type, on its own, against the official XSD (see lib.ts, suite 3).
// Identical definitions are shared across types, so each is tested once per issue; `sharedBy` records which types it covers.
// Heavy (about 6 minutes PER ISSUE). Run one issue per process (`npm run test:verify:elements`): a single long-lived worker
// accumulates the grammar's memo tables and dies. VERIFY_ONLY=5-0 selects the issue; the result goes to elements-<issue>.json.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ISSUES, dropGrammarCache, elementJobs, elementSuite, newResult, tally, type SuiteResult, RESULTS } from './lib';

const only = process.env.VERIFY_ONLY;
const out: Record<string, { elements: number; tallies: SuiteResult['tallies']; mismatches: SuiteResult['mismatches']; coverage: Record<string, number> }> = {};

describe('every element == official XSD (differential)', () => {
  for (const issue of ISSUES) {
    if (only && issue !== only) continue;
    it(`issue ${issue}`, async () => {
      const jobs = elementJobs(issue);
      const total = newResult();
      const coverage: Record<string, number> = {};
      const CHUNK = 24;
      for (let i = 0; i < jobs.length; i += CHUNK) {
        const part = jobs.slice(i, i + CHUNK);
        const rs = await Promise.all(part.map((j) => elementSuite(j)));
        dropGrammarCache();                       // the memo tables otherwise grow until the worker is killed
        rs.forEach((r, k) => {
          for (const [kind, t] of Object.entries(r.tallies)) { const a = tally(total, kind); a.run += t.run; a.inconclusive += t.inconclusive; a.mismatch += t.mismatch; }
          total.mismatches.push(...r.mismatches.map((m) => ({ ...m, detail: `${m.detail} {${part[k].sharedBy.length} type(s), first ${part[k].schema}}` })));
          for (const s of part[k].sharedBy) coverage[s] = (coverage[s] ?? 0) + 1;
        });
      }
      out[issue] = { elements: jobs.length, tallies: total.tallies, mismatches: total.mismatches, coverage };
      const shown = total.mismatches.slice(0, 25).map((m) => `[${m.kind}] <${m.parent}> ${m.detail}`).join('\n');
      expect(total.mismatches.length, `${total.mismatches.length} mismatches in issue ${issue}:\n${shown}`).toBe(0);
      expect(total.tallies.next?.run ?? 0).toBeGreaterThan(1000);
    }, 1_500_000);
  }
});

afterAll(() => {
  const dir = RESULTS;
  fs.mkdirSync(dir, { recursive: true });
  for (const [issue, v] of Object.entries(out)) fs.writeFileSync(path.join(dir, `elements-${issue}.json`), JSON.stringify(v, null, 1));
});
