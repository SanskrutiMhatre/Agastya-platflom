// BREX: two independent implementations of the rule SEMANTICS must agree (XPath fidelity is proven separately against libxml2, brex-xpath.test.ts:
// jsdom's own XPath is known to be unreliable, so both engines here are given the same XPath evaluator and only the BREX logic differs). The Studio's browser-side check (validation/brex.ts, DOM XPath) and the server's (backend/src/services/brex.ts,
// the engine that blocks publication) are run on the same modules against the same official default BREX of the module's issue:
//   - the 84 realistic modules (21 types x 4 issues), which are BREX-clean
//   - mutations derived from the BREX's own rules: an attribute value no rule permits, for restricted-value rules; plus the three real breaches
//     (a titled step beside untitled ones, a BREX data module off assembly 00, a service-bulletin topic type the rules forbid)
// For every one: the same rules fire the same number of times, and the same rules are reported as not evaluated. A mutation neither engine notices
// proves nothing, so at least a minimum number must be detected by both.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ISSUES, TYPES, LABEL, PUB, RESULTS, richDm } from './lib';
import { parseXml } from '../../core/xml';
import { parseBrex as studioParse, checkBrex as studioCheck, type XPathEvaluator } from '../../validation/brex';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require('../../../../../backend/dist/services/brex') as typeof import('../../../../../backend/src/services/brex');
const LETTER: Record<string, string> = { '4-2': 'F', '5-0': 'G', '6': 'H', '7': 'J' };
const brexXml = (issue: string) => fs.readFileSync(path.join(PUB, 'brex', `DMC-S1000D-${LETTER[issue]}-04-10-0301-00A-022A-D_001-00_EN-US.XML`), 'utf8');

// the Studio check, but with the server's XPath engine instead of jsdom's (same expression repair, same namespaces)
const sharedXPath: XPathEvaluator = (expr, doc) => server.evaluateXPath(server.repairXPath(expr), doc as unknown as Node);

const results: Record<string, { modules: number; mutations: number; detectedByBoth: number; disagreements: number }> = {};

function both(issue: string, xml: string, studioBrex: ReturnType<typeof studioParse>, serverBrex: ReturnType<typeof server.parseBrexModel>) {
  const parsed = parseXml(xml);
  const schema = /noNamespaceSchemaLocation\s*=\s*"[^"]*\/([a-zA-Z]+)\.xsd"/.exec(xml)?.[1] ?? null;
  const s = studioCheck(parsed.doc, [studioBrex], { schema, doctype: parsed.doctype, evaluate: sharedXPath });
  const v = server.checkBrexModels(xml, [serverBrex]);
  const count = (ids: string[]) => ids.reduce<Record<string, number>>((m, i) => ((m[i] = (m[i] ?? 0) + 1), m), {});
  const a = count(s.issues.filter((i) => i.source === 'brex').map((i) => i.ruleId ?? '?'));
  const b = count(v.findings.map((f) => f.ruleId));
  return { a, b, skippedStudio: s.skippedRules.map((r) => r.id).sort(), skippedServer: v.skippedRules.map((r) => r.id).sort() };
}

describe('BREX: the server engine and the Studio engine agree', () => {
  for (const issue of ISSUES) {
    it(`issue ${issue}: every module and mutation gets the same verdict from both`, () => {
      const sBrex = studioParse(parseXml(brexXml(issue)).doc);
      const vBrex = server.parseBrexModel(brexXml(issue), `default ${issue}`, false);
      expect(vBrex.rules.length, 'both read the same number of rules').toBe(sBrex.rules.length);

      // rules whose violation we can build: a restricted-value rule on a plain attribute
      const attrRules = vBrex.rules.filter((r) => r.flag === '2' && r.values.length && /^\/\/(?:[A-Za-z]+\/)?@[A-Za-z]+$/.test(r.objectPath));
      expect(attrRules.length).toBeGreaterThan(20);

      let modules = 0, mutations = 0, detected = 0, disagree = 0;
      const compare = (what: string, xml: string) => {
        const r = both(issue, xml, sBrex, vBrex);
        const same = JSON.stringify(r.a) === JSON.stringify(r.b) && JSON.stringify(r.skippedStudio) === JSON.stringify(r.skippedServer);
        if (!same) { disagree++; expect.soft(r, `${what}: the engines disagree`).toEqual({ a: r.b, b: r.a, skippedStudio: r.skippedServer, skippedServer: r.skippedStudio }); }
        return r;
      };

      TYPES.forEach((type, ti) => {
        const clean = richDm(type, issue, type === 'brex' ? '00' : undefined);
        const base = compare(`${type} clean`, clean);
        modules++;
        expect(Object.keys(base.b), `${type} ${issue}: the realistic module is BREX-clean`).toEqual([]);

        // six attribute mutations per module, a different slice of the rules for each type
        for (let k = 0; k < 6; k++) {
          const rule = attrRules[(ti * 6 + k) % attrRules.length];
          const m = /^\/\/(?:([A-Za-z]+)\/)?@([A-Za-z]+)$/.exec(rule.objectPath)!;
          const bad = m[1] ? clean.replace('<content>', `<content><${m[1]} ${m[2]}="ZZ-NOT-ALLOWED"/>`) : clean.replace('<content>', `<content ${m[2]}="ZZ-NOT-ALLOWED">`);
          const r = compare(`${type} +${rule.objectPath}`, bad);
          mutations++;
          if (r.a[rule.id] && r.b[rule.id]) detected++;
        }
      });

      // the three real breaches
      const breaches: Array<[string, string, (x: string) => string]> = [
        ['proced', 'BREX-S1-00264', (x) => x.replace(/<mainProcedure>\s*<proceduralStep([^>]*)>/, '<mainProcedure><proceduralStep$1><title>Titled</title>')],
        ['brex', 'BREX-S1-00144', (x) => x.replace(/assyCode="00"/, 'assyCode="06"')],
        ['sb', 'BREX-S1-00096', (x) => x.replace('sbTopicType="sbtt02"', 'sbTopicType="sbtt01"')],
      ];
      for (const [type, rule, mutate] of breaches) {
        const bad = mutate(richDm(type, issue, type === 'brex' ? '00' : undefined));
        const r = compare(`${type} breach ${rule}`, bad);
        mutations++;
        expect(r.a[rule], `Studio finds ${rule} in ${type} ${issue}`).toBeGreaterThan(0);
        expect(r.b[rule], `server finds ${rule} in ${type} ${issue}`).toBeGreaterThan(0);
        detected++;
      }
      results[issue] = { modules, mutations, detectedByBoth: detected, disagreements: disagree };
      expect(disagree).toBe(0);
      expect(detected, 'enough mutations were really detected by both engines for the comparison to mean something').toBeGreaterThan(30);
    }, 600_000);
  }
});

afterAll(() => {
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'brex-parity.json'), JSON.stringify(results, null, 1));
  void LABEL;
});
