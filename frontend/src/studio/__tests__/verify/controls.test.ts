// Negative controls: the differential suites must NOT be able to pass vacuously. Each test corrupts a copy of the
// procedural 5.0 grammar in one specific way and requires the suites to report it (and the untouched grammar to be clean).
import { describe, it, expect } from 'vitest';
import { grammarFromJson, type GrammarJson, type JsonParticle } from '../../core/grammar';
import { gramJson, contentModelSuite, attributeSuite } from './lib';

const clone = (): GrammarJson => JSON.parse(JSON.stringify(gramJson('5-0', 'proced')));
const typeOf = (j: GrammarJson, el: string) => j.types[j.elements[el]];
function find(j: GrammarJson, p: JsonParticle | null | undefined, name: string, seen = new Set<string>()): JsonParticle | null {
  if (!p) return null;
  if (p.k === 'e' && p.n === name) return p;
  if (p.k === 'g') { if (seen.has(p.n!)) return null; seen.add(p.n!); return find(j, j.groups[p.n!], name, seen); }
  for (const c of p.a ?? []) { const r = find(j, c, name, seen); if (r) return r; }
  return null;
}

describe('negative controls (procedural 5-0)', () => {
  it('the untouched grammar is clean (so the failures below are caused by the corruption)', async () => {
    expect((await contentModelSuite('proced', '5-0', true)).mismatches).toEqual([]);
    expect((await attributeSuite('proced', '5-0')).mismatches).toEqual([]);
  }, 120_000);

  const content: Array<[string, string, (j: GrammarJson) => void]> = [
    ['an unbounded repeat limited to one', 'occurrence', (j) => { typeOf(j, 'mainProcedure').c!.x = 1; }],
    ['a required child made optional', 'missing', (j) => { const p = find(j, typeOf(j, 'procedure').c, 'mainProcedure')!; p.m = 0; }],
    ['an optional child made required', 'as-written', (j) => { const p = find(j, typeOf(j, 'procedure').c, 'commonInfo')!; p.m = 1; }],
    ['two siblings swapped in the sequence', 'order', (j) => { const t = typeOf(j, 'procedure').c!; const a = t.a!; const i = a.findIndex((x) => x.n === 'preliminaryRqmts'); [a[i], a[i + 1]] = [a[i + 1], a[i]]; }],
    ['a tag that does not belong is allowed', 'next', (j) => { const t = typeOf(j, 'procedure').c!; t.a!.push({ k: 'e', n: 'note', m: 0, x: 1 } as JsonParticle); }],
  ];
  for (const [what, kind, corrupt] of content) {
    it(`content model: ${what} is reported`, async () => {
      const j = clone();
      corrupt(j);
      const r = await contentModelSuite('proced', '5-0', true, grammarFromJson(j));
      const kinds = new Set(r.mismatches.map((m) => m.kind));
      expect(r.mismatches.length, `no mismatch reported for: ${what}`).toBeGreaterThan(0);
      // an optional child made required is caught by the as-written check and/or the position probes, depending on the document
      const accepted = kind === 'as-written' ? ['as-written', 'next', 'missing'] : [kind];
      expect(accepted.some((k) => kinds.has(k)), `expected a ${kind} mismatch, got ${[...kinds].join(',')}`).toBe(true);
    }, 120_000);
  }

  const attrs: Array<[string, string, (j: GrammarJson) => void]> = [
    ['an attribute removed', 'attr-name', (j) => { const t = typeOf(j, 'dmCode'); t.a = t.a.filter((a) => a.n !== 'infoCode'); }],
    ['a required attribute made optional', 'attr-required', (j) => { const t = typeOf(j, 'dmCode'); t.a.find((a) => a.n === 'infoCode')!.r = undefined; }],
    ['an enumeration value removed', 'attr-enum', (j) => { const a = typeOf(j, 'security').a.find((x) => x.n === 'securityClassification')!; j.simple[a.t].e = j.simple[a.t].e!.filter((v) => v !== '05'); }],
    ['an enumeration value added', 'attr-enum', (j) => { const a = typeOf(j, 'security').a.find((x) => x.n === 'securityClassification')!; j.simple[a.t].e!.push('ZZ'); }],
  ];
  for (const [what, kind, corrupt] of attrs) {
    it(`attributes: ${what} is reported`, async () => {
      const j = clone();
      corrupt(j);
      const r = await attributeSuite('proced', '5-0', grammarFromJson(j));
      expect(r.mismatches.length, `no mismatch reported for: ${what}`).toBeGreaterThan(0);
      expect(r.mismatches.map((m) => m.kind).join(','), `expected a ${kind} mismatch`).toContain(kind);
    }, 120_000);
  }
});
