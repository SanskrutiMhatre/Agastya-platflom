// The publication formats a project can be created in, and (for the document formats) the domain and manual type that decide its stencil.
//
//   s1000d  S1000D data modules, published by the S1000D engine. No domain or manual type to choose.
//   jss     Joint Services Specification manuals: Land and Naval (a third domain is on hold), each with its own manual types / stencils.
//   jsg     Joint Services Guide manuals: Land.
//
// `ready: false` means the stencil was received (or is expected) but the engine for it is not built yet: the wizard shows it, disabled, and the
// server refuses to create it. The catalogue is data, so a new manual type is one line here and nothing else in the platform changes.
// Names follow the stencil files the owner supplied (JSS-0251 land stencils DTF0025-29, NAval_stencil, JSG-0308).

import { JSS_TYPES } from './jss/registry';

export type FormatId = 's1000d' | 'jss' | 'jsg';
export interface ManualType { id: string; label: string; ready: boolean; /** The starting-outline profile (services/profiles) this type uses, when it has one. */ profile?: string; /** The JSS document type (services/jss/registry) a project of this type is authored as. */ jssType?: string; /** Why it cannot be created yet. */ notReady?: string }
export interface Domain { id: string; label: string; manualTypes: ManualType[] }
export interface FormatInfo { id: FormatId; label: string; description: string; ready: boolean; domains: Domain[] }

const NAVAL: ManualType[] = [
  { id: 'uhb', label: 'User Handbook', ready: false },
  { id: 'tm-part-1', label: 'Technical Manual - Part I Technical Description', ready: false },
  { id: 'tm-part-2', label: 'Technical Manual - Part II Maintenance', ready: false },
  { id: 'tm-part-3', label: 'Technical Manual - Part III Overhaul', ready: false },
  { id: 'tm-part-4-1', label: 'Technical Manual - Part IV Vol 1 Parts List', ready: false },
  { id: 'tm-part-4-2', label: 'Technical Manual - Part IV Vol 2 Illustrations', ready: false },
  { id: 'design-specification', label: 'Design Specification', ready: false },
  { id: 'mrls', label: 'MRLS', ready: false },
  { id: 'equipment-schedule', label: 'Complete Equipment Schedule', ready: false },
  { id: 'smt-ste', label: 'List of SMT / STE', ready: false },
];

export const FORMATS: FormatInfo[] = [
  { id: 's1000d', label: 'S1000D', description: 'Data modules written to the S1000D standard.', ready: true, domains: [] },
  {
    id: 'jss', label: 'JSS', description: 'Joint Services Specification manuals.', ready: true,
    domains: [
      {
        // one entry per JSS-0251 land stencil: the registry (services/jss/registry) is the only list, so the wizard cannot offer what the engine does not have
        id: 'land', label: 'Land', manualTypes: JSS_TYPES.map((t) => ({ id: t.id, label: t.label, ready: t.ready, notReady: t.notReady, jssType: t.id })),
      },
      { id: 'naval', label: 'Naval', manualTypes: NAVAL },
    ],
  },
  {
    id: 'jsg', label: 'JSG', description: 'Joint Services Guide manuals.', ready: false,
    domains: [{ id: 'land', label: 'Land', manualTypes: [{ id: 'uhb', label: 'User Handbook', ready: false }] }],
  },
];

export const formatById = (id: unknown): FormatInfo | undefined => FORMATS.find((f) => f.id === id);

export interface ResolvedFormat { format: FormatId; domain: string | null; manualType: string | null; profile?: string; jssType?: string; pipeline: 's1000dtofo' | 's1000dtojss'; type: 'S1000D' | 'JSS' }

/** Check a format / domain / manual-type choice and say what it means for the project; throws a plain message when it cannot be created. */
export function resolveFormat(input: { format?: unknown; domain?: unknown; manualType?: unknown }): ResolvedFormat {
  const f = formatById(input.format ?? 's1000d');
  if (!f) throw new Error('Choose S1000D, JSS or JSG.');
  // An S1000D publication is printed the way the reference publication is (services/profiles: the Xignal layout: logo + publication code head,
  // mirrored furniture, DMC / date / page foot, margin marks). Nothing else about the project changes: every S1000D rule applies as before.
  if (f.id === 's1000d') return { format: 's1000d', domain: null, manualType: null, profile: 'xignal-s1000d', pipeline: 's1000dtofo', type: 'S1000D' };
  const d = f.domains.find((x) => x.id === input.domain);
  if (!d) throw new Error(`Choose the domain of the ${f.label} manual (${f.domains.map((x) => x.label).join(' or ')}).`);
  const m = d.manualTypes.find((x) => x.id === input.manualType);
  if (!m) throw new Error(`Choose the type of ${f.label} ${d.label} manual.`);
  if (!f.ready || !m.ready) throw new Error(`${f.label} ${d.label} - ${m.label} is not available yet: ${m.notReady ?? 'its stencil is received but the engine for it is still to be built.'}`);
  return { format: f.id, domain: d.id, manualType: m.id, profile: m.profile, jssType: d.id === 'land' && f.id === 'jss' ? m.jssType : undefined, pipeline: 's1000dtojss', type: 'JSS' };
}
