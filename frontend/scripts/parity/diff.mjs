// WP-34: compares a parity surface with the committed baseline. Shared by scripts/parity/check.mjs and src/parity/parity-dump.test.ts.
//
// A removed item (in the baseline, not in the code) fails unless the explanations file has a row for it (same category and key) with a
// reason and a new home. An added item never fails; it is listed so the baseline can be brought up to date (`npm run parity:update`).

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './scan.mjs';

export const CATEGORIES = ['routes', 'rail', 'commands', 'keys', 'testids', 'tests'];
export const BASELINE_FILE = path.join(ROOT, 'docs', 'audit', 'baseline', 'parity-baseline.json');
export const EXPLANATIONS_FILE = path.join(ROOT, 'docs', 'audit', 'baseline', 'parity-explanations.json');

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The explanation rows, checked for the fields a row must have. */
export function loadExplanations(file = EXPLANATIONS_FILE) {
  const data = readJson(file, { explanations: [] });
  const rows = Array.isArray(data.explanations) ? data.explanations : [];
  const problems = [];
  rows.forEach((r, i) => {
    if (!CATEGORIES.includes(r.category)) problems.push(`explanation ${i + 1}: unknown category "${r.category}" (one of ${CATEGORIES.join(', ')})`);
    if (!r.key) problems.push(`explanation ${i + 1}: no key`);
    if (!r.reason || String(r.reason).trim().length < 10) problems.push(`explanation ${i + 1} (${r.category} ${r.key}): the reason is missing or shorter than 10 characters`);
    if (!r.newHome || !String(r.newHome).trim()) problems.push(`explanation ${i + 1} (${r.category} ${r.key}): no newHome (where the feature is now, or "removed by decision <id>")`);
  });
  return { rows, problems };
}

/**
 * @param baseline  { categories: { [cat]: [{ key }] } }
 * @param current   { [cat]: [{ key }] }   only the categories present are compared
 */
export function diffSurface(baseline, current, explanations) {
  const explained = new Map(explanations.map((r) => [`${r.category}\u0000${r.key}`, r]));
  const out = { removed: [], unexplained: [], added: [], explainedButPresent: [] };
  for (const cat of CATEGORIES) {
    if (!current[cat]) continue;
    const before = new Set((baseline.categories?.[cat] ?? []).map((i) => i.key));
    const now = new Set(current[cat].map((i) => i.key));
    for (const k of before) if (!now.has(k)) {
      const why = explained.get(`${cat}\u0000${k}`);
      out.removed.push({ category: cat, key: k, explanation: why ?? null });
      if (!why) out.unexplained.push({ category: cat, key: k });
    }
    for (const k of now) if (!before.has(k)) out.added.push({ category: cat, key: k });
    for (const r of explanations) if (r.category === cat && before.has(r.key) && now.has(r.key)) out.explainedButPresent.push({ category: cat, key: r.key });
  }
  return out;
}
