// =============================================================================
// Administrator reference data.
//
// V1's Software Admin Panel had twenty sections; sixteen were the same shape - a list of flat
// records - so, as there, ONE generic store serves them all: a collection is a name, a column
// spec and (optionally) a seed. Records live in `config_items` (collection, id -> JSON).
//
// (The S1000D information-code catalogue, the SNS and applicability are NOT here: they are per-issue / hierarchical, so they have their own services -
// s1000dRef.ts and sns.ts - and Administrator screens. Rows an administrator had added here are carried over by bootReference.ts.)
//
// Seeds are applied once per collection, the first time it is read, and never again - so a
// record an administrator deletes stays deleted. The two enterprise lists are deliberately NOT
// seeded: an empty list means "not configured", and DM import is not checked against it until
// the administrator registers the enterprises (see services/enterprises.ts).
// =============================================================================

import { nowIso } from '../config';
import { store } from '../context';
import { bad, conflict, notFound } from './http';
import { dmTypeSeed } from './registry';

const { newId } = require('../core/auth/crypto');

export interface FieldSpec { key: string; label: string; type?: 'text' | 'boolean'; required?: boolean; mono?: boolean; width?: number | string }
export interface CollectionSpec {
  id: string; title: string; noun: string; description: string; fields: FieldSpec[];
  /** The field whose value must be unique (case-insensitive) within the collection. */
  unique: string;
  seed?: Array<Record<string, unknown>>;
}

const code = (label = 'Code', width = 110): FieldSpec => ({ key: 'code', label, width, required: true, mono: true });
const name = (label = 'Name'): FieldSpec => ({ key: 'name', label, required: true });

export const COLLECTIONS: CollectionSpec[] = [
  { id: 'country-codes', title: 'Country codes', noun: 'country', unique: 'code', description: 'ISO country codes available in the data module code.',
    fields: [code('ISO code'), name('Country')],
    seed: [['IN', 'India'], ['GB', 'United Kingdom'], ['US', 'United States'], ['FR', 'France'], ['DE', 'Germany'], ['IT', 'Italy'], ['SE', 'Sweden'], ['CA', 'Canada']].map(([c, n]) => ({ code: c, name: n })) },
  { id: 'language-codes', title: 'Language codes', noun: 'language', unique: 'code', description: 'ISO language codes available in the data module code.',
    fields: [code('ISO code'), name('Language')],
    seed: [['en', 'English'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['es', 'Spanish'], ['sv', 'Swedish'], ['hi', 'Hindi']].map(([c, n]) => ({ code: c, name: n })) },
  { id: 'dm-types', title: 'DM types', noun: 'type', unique: 'schema', description: 'S1000D schemas a data module can be created against (the editor offers these 21).',
    fields: [{ key: 'schema', label: 'Schema', width: 150, required: true, mono: true }, name('Type'), { key: 'infoCode', label: 'Default info code', width: 140, mono: true }],
    seed: dmTypeSeed() },
  { id: 'pm-templates', title: 'PM templates', noun: 'template', unique: 'name', description: 'Publication module starting points.',
    fields: [name('Template'), { key: 'description', label: 'Description', width: '55%' }],
    seed: [{ name: 'Maintenance manual', description: 'Standard maintenance publication' }, { name: 'Technical description', description: 'Descriptive publication' }, { name: 'Illustrated parts catalog', description: 'IPD publication' }, { name: 'User Handbook', description: 'JSS user handbook: seven chapters' }] },
  { id: 'rpc-cages', title: 'RPC CAGE codes', noun: 'enterprise', unique: 'cage', description: 'Responsible partner companies. DM import is checked against this list (empty = not checked).',
    fields: [{ key: 'cage', label: 'Enterprise code', width: 150, required: true, mono: true }, name('Enterprise name'), { key: 'role', label: 'Role', width: 220 }] },
  { id: 'originator-cages', title: 'Originator CAGE codes', noun: 'enterprise', unique: 'cage', description: 'Organisations that originate data modules. DM import is checked against this list (empty = not checked).',
    fields: [{ key: 'cage', label: 'Enterprise code', width: 150, required: true, mono: true }, name('Enterprise name'), { key: 'role', label: 'Role', width: 220 }] },
  { id: 'security-classes', title: 'Security classifications', noun: 'classification', unique: 'code', description: 'Security classifications applied to data modules.',
    fields: [code('Code', 120), name('Classification')],
    seed: [['01', 'Unclassified'], ['02', 'Restricted'], ['03', 'Confidential'], ['04', 'Secret'], ['05', 'Top secret']].map(([c, n]) => ({ code: c, name: n })) },
  { id: 'pdf-customisations', title: 'PDF customisations', noun: 'profile', unique: 'name', description: 'Output profiles used when publishing.',
    fields: [name('Profile'), { key: 'pageSize', label: 'Page size', width: 140 }, { key: 'showChangeBars', label: 'Change bars', type: 'boolean', width: 140 }],
    seed: [{ name: 'Default', pageSize: 'A4', showChangeBars: true }, { name: 'Draft review', pageSize: 'A4', showChangeBars: true }, { name: 'Print master', pageSize: 'Letter', showChangeBars: false }] },
  { id: 'ddn', title: 'Data dispatch notes', noun: 'DDN', unique: 'code', description: 'Records of content dispatched to recipients.',
    fields: [code('DDN code', 240), { key: 'recipient', label: 'Recipient' }, { key: 'status', label: 'Status', width: 140 }] },
  { id: 'ddn-metadata', title: 'DDN metadata', noun: 'field', unique: 'field', description: 'Default values applied to generated dispatch notes.',
    fields: [{ key: 'field', label: 'Field', width: 260, required: true, mono: true }, { key: 'value', label: 'Value', required: true }],
    seed: [{ field: 'senderIdent', value: '' }, { field: 'receiverIdent', value: '' }] },
  { id: 'languages', title: 'Interface languages', noun: 'language', unique: 'code', description: 'Languages the application interface is available in.',
    fields: [code('Locale', 140), name('Language'), { key: 'isDefault', label: 'Default', type: 'boolean', width: 110 }],
    seed: [{ code: 'en-IN', name: 'English (India)', isDefault: true }, { code: 'en-GB', name: 'English (UK)', isDefault: false }] },
];

const byId = new Map(COLLECTIONS.map((c) => [c.id, c]));
export const specOf = (id: string): CollectionSpec => {
  const s = byId.get(id);
  if (!s) throw notFound('No such reference table.');
  return s;
};

const SEED_FLAG = 'seeded';

/** Apply a collection's seed once, the first time it is read. */
function ensureSeeded(spec: CollectionSpec): void {
  const flag = store.configGet('app-state', `${SEED_FLAG}:${spec.id}`);
  if (flag) return;
  if (spec.seed && store.configCount(spec.id) === 0) {
    const now = nowIso();
    spec.seed.forEach((row) => store.configPut(spec.id, newId(), row, now));
  }
  store.configPut('app-state', `${SEED_FLAG}:${spec.id}`, { done: true }, nowIso());
}

export function listItems(id: string) {
  const spec = specOf(id);
  ensureSeeded(spec);
  return store.configList(id);
}

/** Take only the declared fields, with the right type, trimmed - and refuse a record that lacks a required one. */
function clean(spec: CollectionSpec, body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const v = body?.[f.key];
    if (f.type === 'boolean') { out[f.key] = v === true || v === 'true'; continue; }
    const t = typeof v === 'string' ? v.trim().slice(0, 300) : v == null ? '' : String(v).slice(0, 300);
    if (f.required && !t) throw bad(`${f.label} is required.`, 'FIELD_REQUIRED');
    out[f.key] = t;
  }
  return out;
}

function assertUnique(spec: CollectionSpec, data: Record<string, unknown>, selfId?: string): void {
  const key = String(data[spec.unique] ?? '').toLowerCase();
  const clash = store.configList(spec.id).find((r: any) => r.id !== selfId && String(r[spec.unique] ?? '').toLowerCase() === key);
  if (clash) throw conflict(`“${data[spec.unique]}” is already in ${spec.title}.`, 'DUPLICATE');
}

export function createItem(id: string, body: Record<string, unknown>) {
  const spec = specOf(id);
  ensureSeeded(spec);
  const data = clean(spec, body);
  assertUnique(spec, data);
  const rid = newId();
  store.configPut(id, rid, data, nowIso());
  return store.configGet(id, rid);
}

export function updateItem(id: string, rid: string, body: Record<string, unknown>) {
  const spec = specOf(id);
  if (!store.configGet(id, rid)) throw notFound('No such record.');
  const data = clean(spec, body);
  assertUnique(spec, data, rid);
  store.configPut(id, rid, data, nowIso());
  return store.configGet(id, rid);
}

export function deleteItem(id: string, rid: string): void {
  specOf(id);
  if (!store.configDelete(id, rid)) throw notFound('No such record.');
}
