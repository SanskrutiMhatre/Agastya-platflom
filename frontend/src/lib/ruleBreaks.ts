import { ApiError } from '../api/client';

/** True when a refused build failed ONLY because modules break business rules (BREX): the one kind of refusal the author may choose to build past. */
export function onlyRuleBreaks(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.code !== 'VALIDATION_FAILED') return false;
  const b = e.body as { findings?: Array<{ kind: string }>; totalFindings?: number } | undefined;
  return !!b?.findings?.length && b.totalFindings === b.findings.length && b.findings.every((f) => f.kind === 'brex');
}
