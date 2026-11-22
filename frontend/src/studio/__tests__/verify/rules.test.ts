// Differential test of the editor's tag rules against the official XSDs, for every wizard type and every wizard issue.
//   - content model: allowed next tags, missing required children, occurrence, ordering        (contentModelSuite)
//   - attributes: allowed names, required attributes, enumerated values, patterns             (attributeSuite)
// The XSD verdict comes from native xmllint; the verdict under test is core/grammar.ts (what the editor enforces).
// VERIFY_ONLY=descript/5-0 (or just a type) narrows a run while debugging. Results land in verification-results/rules.json.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ISSUES, TYPES, LABEL, contentModelSuite, attributeSuite, type SuiteResult, RESULTS } from './lib';

const only = process.env.VERIFY_ONLY;
const out: Record<string, { content: SuiteResult; attrs: SuiteResult }> = {};
const fmt = (r: SuiteResult) => r.mismatches.slice(0, 12).map((m) => `[${m.kind}] <${m.parent}> ${m.detail}`).join('\n');

describe('editor grammar == official XSD (differential)', () => {
  for (const type of TYPES) {
    for (const issue of ISSUES) {
      if (only && !`${type}/${issue}`.startsWith(only)) continue;
      it(`${LABEL[type]} (${type}) ${issue}`, async () => {
        const content = await contentModelSuite(type, issue, process.env.VERIFY_QUICK === '1');
        const attrs = await attributeSuite(type, issue);
        out[`${type}/${issue}`] = { content, attrs };
        const c = content.mismatches.length;
        const a = attrs.mismatches.length;
        expect(c, `content-model mismatches (${c}):\n${fmt(content)}`).toBe(0);
        expect(a, `attribute mismatches (${a}):\n${fmt(attrs)}`).toBe(0);
        // coverage guards: the suites must really have run something
        expect(content.tallies.next?.run ?? 0).toBeGreaterThan(50);
        expect(attrs.tallies['attr-name']?.run ?? 0).toBeGreaterThan(5);
      }, 180_000);
    }
  }
});

afterAll(() => {
  const dir = RESULTS;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, only ? 'rules.partial.json' : 'rules.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
});
