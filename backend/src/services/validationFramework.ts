// =============================================================================
// The validation framework: one finding model, rule sets per standard, one runner (audit WP-16, 03-ARCHITECTURE section 4).
//
// Shared by every standard:  the finding model (`Issue`: what, where, which check, how severe), the way a raw result becomes one (`issueOf`),
//                            the runner (`runRuleSets`: rule sets in order, a turn for the event loop between them) and the summary.
// Per standard:              the rule sets themselves. S1000D's are in validation.ts (applicability, graphics, ids, ICN declarations,
//                            publication, BREX); the schema stage (well-formedness, XSD) runs before them there because what it finds
//                            decides which files the others can read.
//
// A rule set takes plain data (`ValidationInput`: ids, folders, the issue in use, flags) and returns plain data (issues and notes). It is never
// handed a request or a response, so the same rule set can run in a worker process later (WP-14) without change.
// =============================================================================

export type Severity = 'error' | 'warn' | 'info';
export type IssueSource = 'xml' | 'xsd' | 'brex' | 'graphics' | 'ids' | 'icn' | 'pm' | 'applic';

/** One finding: what is wrong (title/detail), where (file + line + location) and which check found it (source). */
export interface Issue {
  id: string; source: IssueSource;
  sev: Severity; title: string; rel: string; file: string; line: number; loc: string; detail: string;
}

/** What a check reports before it is normalised: any of the fields, loosely typed (the vendored engines report `message`, some a numeric string line). */
export interface RawIssue { sev?: unknown; title?: unknown; rel?: unknown; line?: unknown; loc?: unknown; detail?: unknown; message?: unknown }

let seq = 0;
/** Normalises a raw result into an `Issue`: a severity it does not know becomes `fallbackSev`, the line is at least 1, `file` is the last path part. */
export function issueOf(source: IssueSource, i: RawIssue, fallbackSev: Severity = 'warn'): Issue {
  const sev: Severity = i.sev === 'error' || i.sev === 'warn' || i.sev === 'info' ? i.sev : fallbackSev;
  const rel = String(i.rel ?? '');
  return {
    id: `${source}-${++seq}`, source, sev, title: String(i.title ?? 'Problem'), rel,
    file: rel.split('/').pop() ?? rel, line: Math.max(1, Number(i.line) || 1),
    loc: String(i.loc ?? ''), detail: String(i.detail ?? i.message ?? ''),
  };
}

/** The plain-data input every rule set receives. */
export interface ValidationInput {
  projectId: string;
  /** The project folder (absolute). */
  dir: string;
  /** Project-relative folders and files. */
  csdb: string; media: string; pm: string;
  /** The S1000D issue the run judges by (`auto` = each module's own declaration). */
  issueUsed: string;
  /** Is this an S1000D project (business rules exist in S1000D only)? */
  s1000d: boolean;
  /** Optional rule sets asked for (BREX is opt-in on the Validation page). */
  brex: boolean;
}

export interface RuleSetResult { issues: Issue[]; notes?: string[]; /** How many modules the rule set judged, for the run's counters. */ checked?: number }

export interface RuleSet {
  /** Stable name (`applic`, `graphics`, `brex` ...): the run's counters are keyed by it. */
  id: string;
  /** The standard the rule set belongs to. */
  standard: 's1000d' | 'jss' | 'jsg';
  /** Skip the rule set for this input (BREX only when asked for and only for an S1000D project). Default: always run. */
  applies?(input: ValidationInput): boolean;
  run(input: ValidationInput): Promise<RuleSetResult>;
}

export interface RuleSetsOutcome { issues: Issue[]; notes: string[]; checked: Record<string, number> }

/** A turn for other requests (WP-32, PERF-001 stop-gap): run back to back the scans held the event loop for about 230 ms on 200 modules. */
export const turn = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/** Runs rule sets in order, each in a turn of its own; issues and notes come back in rule-set order. */
export async function runRuleSets(sets: readonly RuleSet[], input: ValidationInput): Promise<RuleSetsOutcome> {
  const out: RuleSetsOutcome = { issues: [], notes: [], checked: {} };
  for (const set of sets) {
    if (set.applies && !set.applies(input)) continue;
    await turn();
    const r = await set.run(input);
    out.issues.push(...r.issues);
    if (r.notes) out.notes.push(...r.notes);
    if (r.checked !== undefined) out.checked[set.id] = r.checked;
  }
  return out;
}

/** Counts by severity. */
export function summarise(issues: readonly Issue[]): { error: number; warn: number; info: number } {
  const summary = { error: 0, warn: 0, info: 0 };
  for (const i of issues) summary[i.sev]++;
  return summary;
}
