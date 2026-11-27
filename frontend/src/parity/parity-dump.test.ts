// WP-34 (GAP-009): the run-time dump of the Studio command registry, the project rail per kind and the editor shortcut registries.
//
// * With PARITY_DUMP=<file> (set by scripts/parity/check.mjs) it writes the run-time surface to that file for the check to merge with the
//   static scan.
// * In every run (the everyday vitest suite included) it compares the run-time surface with the committed baseline
//   (docs/audit/baseline/parity-baseline.json): a command, rail item or key that disappeared without a row in parity-explanations.json fails.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { danglingRibbonIds, runtimeSurface } from './surface';
import { BASELINE_FILE, diffSurface, loadExplanations, readJson, type Baseline } from '../../scripts/parity/diff.mjs';

describe('parity: run-time surface', () => {
  const surface = runtimeSurface();

  it('the generated Studio commands are expanded (emphasis, table operations, alignment, views)', () => {
    const ids = new Set(surface.commands.map((c) => c.key));
    for (const id of ['format.bold', 'format.strike', 'table.rowAbove', 'table.header', 'table.alignJustify', 'table.valignBottom', 'view.design', 'view.xml']) expect(ids.has(id), id).toBe(true);
    expect(ids.size).toBe(surface.commands.length);                                     // ids are unique
  });

  it('every ribbon entry names a command that exists', () => {
    expect(danglingRibbonIds()).toEqual([]);
  });

  it('no accelerator is bound to two Studio commands', () => {
    const seen = new Map<string, string>(); const clashes: string[] = [];
    for (const c of surface.commands) for (const k of (c.keys as string[] | undefined) ?? []) { const o = seen.get(k.toLowerCase()); if (o) clashes.push(`${k}: ${o} and ${c.key}`); seen.set(k.toLowerCase(), c.key); }
    expect(clashes).toEqual([]);
  });

  it('writes the dump when the parity check asks for it', () => {
    const out = process.env.PARITY_DUMP;
    if (!out) return;
    fs.writeFileSync(out, `${JSON.stringify(surface, null, 2)}\n`);
    expect(fs.existsSync(out)).toBe(true);
  });

  it('nothing in the baseline disappeared without an explanation (commands, rail, keys)', () => {
    if (process.env.PARITY_DUMP) return;                                                // the check script does the full comparison itself
    const baseline = readJson<Baseline | null>(BASELINE_FILE, null);
    expect(baseline, `${BASELINE_FILE} is missing: run npm run parity:update`).not.toBeNull();
    const { rows, problems } = loadExplanations();
    expect(problems).toEqual([]);
    // the keys category also holds the handler keys of the static scan; compare only the registry keys here
    const reg = new Set(surface.keys.map((k) => k.key));
    const base: Baseline = { ...baseline!, categories: { ...baseline!.categories, keys: (baseline!.categories.keys ?? []).filter((k) => !k.key.startsWith('handler ')) } };
    const d = diffSurface(base, { commands: surface.commands, rail: surface.rail, keys: [...reg].map((key) => ({ key })) }, rows);
    expect(d.unexplained, 'removed without a row in docs/audit/baseline/parity-explanations.json').toEqual([]);
  });
});
