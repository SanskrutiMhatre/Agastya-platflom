// =============================================================================
// The publication gate's format-neutral interface (audit WP-16, S1K-006).
//
// `assertPublishable` (publishGate.ts) used to begin with `if (isJssAuthored(projectId)) { ... }`: the "generic" gate was the S1000D gate with a
// JSS escape hatch, and the next engine would have needed a third branch in the same function. Now each document format registers its own
// check here when its engine loads (the pattern of documentCreators.ts; app.ts loads the engines at start), and the gate asks this leaf module
// which check owns a project. The S1000D check is the default, registered by publishGate.ts itself, so a project no format claims is judged
// exactly as before.
//
// A check is a plain function of (project id, scope, options) to a pass or a thrown HttpError with the findings. It receives no request object,
// so it can later run in a worker process (WP-14).
// =============================================================================

/** What a gate covers: every data module the publication contains, or the one module being previewed. */
export type GateScope = 'publication' | { file: string };

export interface GatePass {
  validatedAt: string;
  files: string[];
  warnings: string[];
  /** Modules that break a business rule but were built anyway because the author asked for it. */
  ruleBreaks: string[];
  /** Throws (409) when a checked file changed between the check and the build, so what is published is what was checked. */
  verifyUnchanged: () => void;
}

/**
 * `allowRuleBreaks`: let a build go ahead when the ONLY thing wrong is that a module breaks a business rule (BREX). Schema errors, unusable BREX files and bad references are never let through, and a release is always checked strictly.
 * `waivable`: the caller is a DRAFT build (a PDF of unreleased work or a one-module preview), so a recorded waiver may stand in for a BREX the project lacks.
 * A release request or approval never sets it.
 */
export interface GateOptions { allowRuleBreaks?: boolean; waivable?: boolean }

export interface PublishCheck {
  /** The format's name, for messages and tests (`s1000d`, `jss`). */
  format: string;
  /** Does this check own the project? Consulted in registration order; the default check is asked last. */
  owns(projectId: string): boolean;
  check(projectId: string, scope: GateScope, opts: GateOptions): Promise<GatePass>;
}

const checks: PublishCheck[] = [];
let fallback: PublishCheck | null = null;

/** Registers a format's publish check. `asDefault`: the check for a project no other check owns (S1000D). Registering a format again replaces it. */
export function registerPublishCheck(check: PublishCheck, opts: { asDefault?: boolean } = {}): void {
  if (opts.asDefault) { fallback = check; return; }
  const i = checks.findIndex((c) => c.format === check.format);
  if (i >= 0) checks[i] = check; else checks.push(check);
}

/** The check that owns a project. */
export function publishCheckFor(projectId: string): PublishCheck {
  const own = checks.find((c) => c.owns(projectId));
  if (own) return own;
  if (!fallback) throw new Error('No default publish check is registered (publishGate.ts registers the S1000D check when it loads).');
  return fallback;
}

/** The registered formats, the default last (for diagnostics and tests). */
export function publishCheckFormats(): string[] {
  return [...checks.map((c) => c.format), ...(fallback ? [fallback.format] : [])];
}
