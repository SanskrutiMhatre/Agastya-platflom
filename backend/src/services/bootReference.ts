// =============================================================================
// Start-up for the S1000D reference configuration: seed the catalogues and SNS presets, carry over what the older flat tables held,
// and give every existing project a configuration derived from its contents. Idempotent: running it again changes nothing.
// =============================================================================

import { nowIso } from '../config';
import { store } from '../context';
import { seedReference, CODE_KINDS, ISSUE_KEYS, getCode, KIND_RULE, SPEC_EVIDENCE } from './s1000dRef';
import { seedPresets, createPreset, putPresetNode, listPresets } from './sns';
import { backfillProjects, BackfillReport } from './projectConfig';

/** The rows the OLD flat tables were seeded with (demo content, never authored): they are not carried over. */
const OLD_SEED_SNS = new Set(['00|General', '05|Time limits and maintenance checks', '09|Towing and taxiing', '20|Standard practices']);
const OLD_SEED_INFO = new Set(['000|Function, data for the product', '018|Introduction', '040|Description', '041|Description of how it works', '130|Servicing', '200|Servicing procedures']);

export interface BootReport { correctedDefaults: string[]; codes: number; presetNodes: number; carriedCodes: number; carriedSns: number; backfill: BackfillReport }

/**
 * Rows an administrator authored in the retired `info-codes` / `sns` tables are NOT deleted (config_items is left as it is); they are copied once:
 * unknown information codes become custom catalogue rows (flagged as not in the default BREX), SNS rows become a custom preset
 * "Migrated flat SNS". Rows equal to the old seed are skipped: they were demo content.
 */
function carryOverLegacy(): { codes: number; sns: number } {
  const done = store.configGet('app-state', 'migrated:flat-reference-016');
  if (done) return { codes: 0, sns: 0 };
  let codes = 0; let sns = 0;
  const info: any[] = store.configList('info-codes');
  for (const r of info) {
    const code = String(r.code ?? '').trim().toUpperCase(); const name = String(r.name ?? '').trim();
    if (!/^[A-Z0-9]{3}$/.test(code) || !name || OLD_SEED_INFO.has(`${code}|${name}`)) continue;
    for (const issue of ISSUE_KEYS) {
      if (getCode('infoCode', issue, code)) continue;
      store.db.prepare(`INSERT OR IGNORE INTO ref_codes (kind, issue, code, title, origin, source_id, rule_id, created_at, updated_at) VALUES ('infoCode', ?, ?, ?, 'custom', NULL, NULL, ?, ?)`)
        .run(issue, code, name, nowIso(), nowIso());
      codes++;
    }
  }
  const flat: any[] = store.configList('sns').filter((r: any) => /^[A-Z0-9]{2,3}$/i.test(String(r.code ?? '').trim()) && String(r.name ?? '').trim() && !OLD_SEED_SNS.has(`${String(r.code).trim()}|${String(r.name).trim()}`));
  if (flat.length) {
    const name = 'Migrated flat SNS';
    const preset = listPresets().find((p) => p.name === name) ?? createPreset(name);
    for (const r of flat) { try { putPresetNode(preset.id, String(r.code).trim().toUpperCase(), r.name); sns++; } catch { /* a code the hierarchy rejects is left in the old table */ } }
  }
  store.configPut('app-state', 'migrated:flat-reference-016', { done: true, codes, sns }, nowIso());
  return { codes, sns };
}

/**
 * A default the specification CORRECTED (see dmtype-spec-evidence.json) is updated in an existing installation's DM types table, once, and only when
 * the row still holds the old placeholder: a value an administrator chose is never overwritten.
 */
function applyCorrectedDefaults(): string[] {
  const done: string[] = [];
  for (const [schema, ev] of Object.entries(SPEC_EVIDENCE)) {
    if (ev.status !== 'corrected' || !ev.default || !ev.previousDefault) continue;
    const flag = `corrected:dm-default:${schema}`;
    if (store.configGet('app-state', flag)) continue;
    const row: any = (store.configList('dm-types') as any[]).find((r) => r.schema === schema);
    if (row && String(row.infoCode) === ev.previousDefault) { store.configPut('dm-types', row.id, { ...row, infoCode: ev.default }, nowIso()); done.push(`${schema}: ${ev.previousDefault} -> ${ev.default}`); }
    store.configPut('app-state', flag, { done: true, applied: !!row && String(row.infoCode) === ev.default }, nowIso());
  }
  return done;
}

export function bootReference(): BootReport {
  const cat = seedReference();
  const presetNodes = seedPresets();
  const carried = carryOverLegacy();
  const correctedDefaults = applyCorrectedDefaults();
  const backfill = backfillProjects();
  void CODE_KINDS; void KIND_RULE;
  return { correctedDefaults, codes: cat.codes, presetNodes, carriedCodes: carried.codes, carriedSns: carried.sns, backfill };
}
