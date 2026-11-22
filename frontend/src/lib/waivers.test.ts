import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { REASON_MAX, REASON_MIN, missingBrexSubject, reasonProblem, refusalOf, summariseFindings, waiverOffer, type GateFinding } from './waivers';

const f = (kind: string, title: string, file = 'DMC-A.xml'): GateFinding => ({ file, kind, title, detail: 'd', line: 1 });
const missing = (code: string, file?: string): GateFinding => f('brex-source', `BREX ${code} is not available`, file);
const refused = (findings: GateFinding[], extra: Record<string, unknown> = {}) => new ApiError(422, 'Not published: …', 'VALIDATION_FAILED', { findings, totalFindings: findings.length, modules: ['DMC-A.xml'], ...extra });

describe('recognising the publish gate\'s refusal', () => {
  it('is an HTTP 422 with code VALIDATION_FAILED and carries the findings', () => {
    const r = refusalOf(refused([missing('DMC-EXAMPLE-A-00-00-00-00A-022Z-D')]));
    expect(r).not.toBeNull();
    expect(r!.findings).toHaveLength(1);
    expect(r!.total).toBe(1);
    expect(r!.modules).toEqual(['DMC-A.xml']);
  });
  it('is not any other error', () => {
    expect(refusalOf(new ApiError(422, 'x', 'SOMETHING_ELSE', { findings: [] }))).toBeNull();
    expect(refusalOf(new ApiError(400, 'x', 'VALIDATION_FAILED', { findings: [] }))).toBeNull();
    expect(refusalOf(new ApiError(500, 'x'))).toBeNull();
    expect(refusalOf(new Error('network down'))).toBeNull();
    expect(refusalOf('text')).toBeNull();
  });
  it('survives a body without findings', () => {
    const r = refusalOf(new ApiError(422, 'x', 'VALIDATION_FAILED'));
    expect(r).toMatchObject({ findings: [], total: 0, modules: [] });
  });
  it('remembers when the server sent only part of the findings', () => {
    expect(refusalOf(refused([missing('A-1-22')], { totalFindings: 80 }))!.total).toBe(80);
  });
});

describe('which findings can be waived', () => {
  it('only "BREX <code> is not available" of kind brex-source', () => {
    expect(missingBrexSubject(missing('DMC-EXAMPLE-A-00-00-00-00A-022Z-D.xml'))).toBe('DMC-EXAMPLE-A-00-00-00-00A-022Z-D.xml');
    expect(missingBrexSubject(f('brex-source', 'BREX DMC-X has an invalid rule'))).toBeNull();
    expect(missingBrexSubject(f('brex-source', 'BREX DMC-X cannot be used'))).toBeNull();
    expect(missingBrexSubject(f('brex-source', 'BREX DMC-X is not a valid data module'))).toBeNull();
    expect(missingBrexSubject(f('brex', 'Breaks business rule BREX-S1-00264'))).toBeNull();
    expect(missingBrexSubject(f('schema', 'BREX DMC-X is not available'))).toBeNull();
  });

  it('offers a waiver for a refusal that is only a missing BREX', () => {
    const o = waiverOffer(refusalOf(refused([missing('B-1')]))!);
    expect(o).toMatchObject({ offer: true, subjects: ['B-1'], truncated: false });
    expect(o.blockers).toEqual([]);
  });
  it('names each missing BREX once, however many modules name it', () => {
    const o = waiverOffer(refusalOf(refused([missing('B-1', 'a.xml'), missing('b-1', 'b.xml'), missing('B-2', 'c.xml')]))!);
    expect(o.subjects).toEqual(['B-1', 'B-2']);
  });
  it('never offers one for schema errors, rule breaches or an invalid BREX', () => {
    for (const bad of [f('schema', 'Element not allowed'), f('malformed', 'Not well-formed'), f('unchecked', 'Could not be checked against a schema'), f('brex', 'Breaks business rule X'), f('brex-source', 'BREX B-1 has an invalid rule'), f('brex-source', 'BREX B-1 cannot be used')]) {
      const o = waiverOffer(refusalOf(refused([bad]))!);
      expect(o.offer, bad.title).toBe(false);
      expect(o.blockers).toEqual([bad]);
    }
  });
  it('offers it beside other problems but lists them as blockers the waiver does not cover', () => {
    const schema = f('schema', 'Element not allowed');
    const o = waiverOffer(refusalOf(refused([missing('B-1'), schema]))!);
    expect(o.offer).toBe(true);
    expect(o.blockers).toEqual([schema]);
  });
  it('flags a refusal whose findings were cut off', () => {
    expect(waiverOffer(refusalOf(refused([missing('B-1')], { totalFindings: 51 }))!).truncated).toBe(true);
  });
});

describe('the reason', () => {
  it('needs at least ten characters once trimmed, and at most what the server keeps', () => {
    expect(reasonProblem('')).toMatch(/at least 10/);
    expect(reasonProblem('too short')).toMatch(/9 so far/);
    expect(reasonProblem('   padded    ')).toMatch(/at least 10/);
    expect(reasonProblem('x'.repeat(REASON_MIN))).toBeNull();
    expect(reasonProblem('x'.repeat(REASON_MAX))).toBeNull();
    expect(reasonProblem('x'.repeat(REASON_MAX + 1))).toMatch(/limited to 500/);
  });
});

describe('summary line', () => {
  it('says what the findings are about', () => {
    expect(summariseFindings([missing('B-1'), missing('B-2'), f('schema', 's'), f('brex', 'r'), f('brex-source', 'BREX B-3 has an invalid rule')])).toBe('2 BREX not available, 1 BREX that cannot be used, 1 business rule breach, 1 schema problem');
    expect(summariseFindings([])).toBe('');
  });
});
