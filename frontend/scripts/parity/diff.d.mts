// Types for diff.mjs, so the vitest files under src/ can import it (tsconfig has no allowJs).
export const CATEGORIES: string[];
export const BASELINE_FILE: string;
export const EXPLANATIONS_FILE: string;
export interface Explanation { category: string; key: string; reason: string; newHome: string; [field: string]: unknown }
export interface Baseline { categories: Record<string, Array<{ key: string }>>; [field: string]: unknown }
export function readJson<T>(file: string, fallback: T): T;
export function loadExplanations(file?: string): { rows: Explanation[]; problems: string[] };
export interface DiffResult {
  removed: Array<{ category: string; key: string; explanation: Explanation | null }>;
  unexplained: Array<{ category: string; key: string }>;
  added: Array<{ category: string; key: string }>;
  explainedButPresent: Array<{ category: string; key: string }>;
}
export function diffSurface(baseline: Baseline, current: Record<string, Array<{ key: string }>>, explanations: Explanation[]): DiffResult;
