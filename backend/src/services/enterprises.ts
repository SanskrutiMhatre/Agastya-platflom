// =============================================================================
// Enterprise check for imported data modules.
//
// A data module names two enterprises in its status section: the responsible partner company
// and the originator, each with an enterprise CODE and (optionally) an enterprise NAME. An
// import is refused when what the module says is not what the Administrator has registered:
//
//   - the code is not registered                     (against the matching list)
//   - the name is not registered                     (when the module carries one)
//   - code and name are both registered, but belong to different enterprises
//
// The lists are the Administrator's "RPC CAGE codes" (responsible partner company) and
// "Originator CAGE codes" (originator). A list with no entries is "not configured": nothing can
// be checked against it, so nothing is refused - the Administrator turns the check on by
// registering the enterprises.
// =============================================================================

import { listItems } from './adminConfig';
import { headOf } from './xmlHead';

type Row = { cage?: string; name?: string };

interface Found { code: string; name: string }

function enterpriseOf(xml: string, tag: string): Found | null {
  const m = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, 'i').exec(xml);
  if (!m) return null;
  const code = /enterpriseCode\s*=\s*"([^"]*)"/.exec(m[1])?.[1]?.trim() ?? '';
  let name = '';
  if (!m[2]) {
    const after = xml.slice(m.index + m[0].length, m.index + m[0].length + 800);
    name = /^\s*<enterpriseName>([^<]*)<\/enterpriseName>/.exec(after)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  }
  return { code, name };
}

const norm = (s: string) => s.trim().toLowerCase();

function checkOne(label: string, found: Found | null, list: Row[]): string[] {
  if (!found || list.length === 0) return [];
  const problems: string[] = [];
  const byCode = list.find((r) => norm(String(r.cage ?? '')) === norm(found.code));
  const byName = found.name ? list.find((r) => norm(String(r.name ?? '')) === norm(found.name)) : undefined;
  if (found.code && !byCode) problems.push(`${label}: the enterprise code “${found.code}” is not registered.`);
  if (found.name && !byName) problems.push(`${label}: the enterprise name “${found.name}” is not registered.`);
  if (byCode && byName && byCode !== byName) {
    problems.push(`${label}: the code “${found.code}” belongs to “${byCode.name}”, not “${found.name}” (the code and name do not match).`);
  }
  return problems;
}

/** Every reason this data module's enterprises do not match the registered lists (empty = fine, or nothing registered). */
export function checkDmEnterprises(xml: string): string[] {
  const head = headOf(xml, 'dmodule', 20000);    // counted from the root element: a long DOCTYPE must not hide the status section
  return [
    ...checkOne('Responsible partner company', enterpriseOf(head, 'responsiblePartnerCompany'), listItems('rpc-cages') as Row[]),
    ...checkOne('Originator', enterpriseOf(head, 'originator'), listItems('originator-cages') as Row[]),
  ];
}

/** True when at least one list has entries, i.e. the check is switched on. */
export const enterpriseCheckActive = (): boolean => (listItems('rpc-cages').length + listItems('originator-cages').length) > 0;

