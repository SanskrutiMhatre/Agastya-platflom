// WP-34 (GAP-009): the run-time half of the feature-preservation baseline. It is computed from the code itself, not from a text scan, so
// the Studio commands made by the helper functions in studio/ui/commands.ts (emphasis, table operations, cell alignment, views) are counted.
// scripts/parity/check.mjs runs parity-dump.test.ts to get it; the static half (routes, test ids, tests, handler keys) is scripts/parity/scan.mjs.

import { buildCommands, RIBBON } from '../studio/ui/commands';
import { projectRailItems, type RailSummary } from '../layouts/projectRail';
import { EDITOR_SHORTCUTS } from '../lib/editorShortcuts';

export interface ParityItem { key: string; [detail: string]: unknown }

/** Where each command sits in the ribbon (tab / group). A command may sit in several groups, or in none (File menu, palette, keys only). */
function ribbonPlaces(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const put = (id: string, where: string) => { out.set(id, [...(out.get(id) ?? []), where]); };
  for (const tab of RIBBON) for (const g of tab.groups) for (const it of g.items) {
    if (typeof it === 'string') put(it, `${tab.id}/${g.label}`);
    else for (const id of it.items) put(id, `${tab.id}/${g.label}/${it.label}`);
  }
  return out;
}

export function studioCommands(): ParityItem[] {
  const places = ribbonPlaces();
  return buildCommands().map((c) => ({
    key: c.id, label: c.label, group: c.group, ...(c.keys?.length ? { keys: c.keys } : {}), ...(c.description ? { description: c.description } : {}),
    ...(c.global ? { global: true } : {}), ribbon: places.get(c.id) ?? [],
  }));
}

/** Every ribbon entry names a command that exists (a dangling id would be a button that does nothing). */
export function danglingRibbonIds(): string[] {
  const ids = new Set(buildCommands().map((c) => c.id));
  return [...ribbonPlaces().keys()].filter((id) => !ids.has(id));
}

export const RAIL_KINDS: Array<{ kind: string; summary: RailSummary }> = [
  { kind: 'S1000D', summary: { project: { type: 'S1000D', authoring: null, format: 's1000d' }, validation: { ranAt: '', error: 3, warn: 0, info: 0 }, release: { released: false, stale: false, number: null, pending: true, scheduledAt: null } } },
  { kind: 'JSS', summary: { project: { type: 'JSS', authoring: 'jss-xml', format: 'jss' }, validation: null, release: { released: true, stale: false, number: 2, pending: false, scheduledAt: null } } },
  { kind: 'JSG', summary: { project: { type: 'JSG', authoring: null, format: 'jsg' }, validation: null, release: null } },
  { kind: 'CIR', summary: { project: { type: 'CIR', authoring: null, format: 's1000d' }, validation: null, release: null } },
];

export function railItems(): ParityItem[] {
  return RAIL_KINDS.flatMap(({ kind, summary }) => projectRailItems(':id', summary).map((i) => ({
    key: `${kind} ${i.label} -> ${i.to.replace('/projects/:id/', '')}`, kind, label: i.label, to: i.to, icon: i.icon, ...(i.badge ? { badgeExample: i.badge.text } : {}),
  })));
}

export function registryKeys(): ParityItem[] {
  const studio = buildCommands().flatMap((c) => (c.keys ?? []).map((k) => ({ key: `studio ${k} -> ${c.id}`, editor: 'studio', chord: k, command: c.id })));
  const docs = EDITOR_SHORTCUTS.flatMap((s) => s.keys.map((k) => ({ key: `${s.editor} ${k} -> ${s.id}`, editor: s.editor, chord: k, command: s.id, where: s.where })));
  return [...studio, ...docs];
}

export function runtimeSurface(): { commands: ParityItem[]; rail: ParityItem[]; keys: ParityItem[] } {
  return { commands: studioCommands(), rail: railItems(), keys: registryKeys() };
}
