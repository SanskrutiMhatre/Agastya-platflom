// =============================================================================
// The client's permission map (WP-13: FE-019, ARC-004).
//
// The client used to repeat the server's role rules ("an editor, manager or owner can write", "anyone but a viewer can build"), and nothing tied
// the two together. Now the server says what the signed-in person may do on a project: `can` is a map from every capability name the project
// routes declare (dm.write, publish.build, release.decide, ...) to true/false for the caller's effective role.
//
// The table is READ FROM THE ROUTE GUARDS after every route is registered (createApp calls setCapabilityTable): each requireProject guard
// carries its minimum role and capability, so a route that changes its role ladder changes the map with it. A capability declared by several
// routes takes the highest of their minimum roles, so the client never offers an action some route of that capability would refuse.
// =============================================================================

import { ROLE_RANK } from '../core/auth/authz';

const RANK: Record<string, number> = ROLE_RANK;
let table: Record<string, string> = {};

/** The part of Express's (undocumented) router a guard table is read from: each route's handlers, where a project guard carries cap and minRole. */
interface RouterView { _router?: { stack?: Array<{ route?: { stack: Array<{ handle?: { cap?: unknown; minRole?: unknown } }> } }> } }

/** Capability -> minimum project role, collected from the guards of the live Express router. */
export function capabilityTableFrom(app: RouterView): Record<string, string> {
  const out: Record<string, string> = {};
  for (const layer of app?._router?.stack ?? []) {
    if (!layer.route) continue;
    for (const s of layer.route.stack) {
      const f = s.handle;
      if (!f || typeof f.cap !== 'string' || typeof f.minRole !== 'string') continue;
      if (!out[f.cap] || (RANK[f.minRole] || 0) > (RANK[out[f.cap]] || 0)) out[f.cap] = f.minRole;
    }
  }
  return out;
}

/** WP-27: the capabilities at least one reading route (GET/HEAD) declares: what a read-only auditor's map may show as allowed (its writes are refused by the guards). */
export function readableCapabilitiesFrom(app: RouterView & { _router?: { stack?: Array<{ route?: { methods?: Record<string, boolean> } }> } }): Set<string> {
  const reads = new Set<string>(); const all = new Set<string>();
  for (const layer of app?._router?.stack ?? []) {
    const route = layer.route as undefined | { methods?: Record<string, boolean>; stack: Array<{ handle?: { cap?: unknown } }> };
    if (!route) continue;
    const write = Object.keys(route.methods ?? {}).some((m) => !['get', 'head', 'options'].includes(m));
    for (const s of route.stack) {
      const cap = s.handle?.cap;
      if (typeof cap !== 'string') continue;
      all.add(cap); if (!write) reads.add(cap);
    }
  }
  return new Set([...all].filter((c) => reads.has(c)));
}

let readableCaps = new Set<string>();
export function setCapabilityTable(t: Record<string, string>, readOnly?: Set<string>): void { table = { ...t }; if (readOnly) readableCaps = new Set(readOnly); }
export function capabilityTable(): Record<string, string> { return { ...table }; }
export function readableCapabilities(): Set<string> { return new Set(readableCaps); }

/** WP-27: what changes the plain role answer for one person on one project. */
export interface CanOptions {
  /** A read-only auditor: only the read-only capabilities are allowed. */
  readOnly?: boolean;
  /** The project's capability rules that apply to the person (authz.rulesFor): deny wins, allow grants one capability below its role. */
  rules?: Array<{ capability: string; effect: string }>;
}

/**
 * What a person with this effective project role may do. A project that is not active (pending approval, rejected) supports reading only,
 * and only for its owner: the same rule authz.evaluate applies. Capability rules and the auditor flag (WP-27) are applied the same way
 * authz.evaluate applies them; an owner is never affected by a rule.
 */
export function canFor(role: string | null | undefined, status: string = 'active', opts: CanOptions = {}): Record<string, boolean> {
  const have = RANK[String(role)] || 0;
  const out: Record<string, boolean> = {};
  const rules = role === 'owner' || opts.readOnly ? [] : (opts.rules ?? []);
  for (const [cap, min] of Object.entries(table)) {
    if (status !== 'active') { out[cap] = cap === 'project.read' && role === 'owner'; continue; }
    let ok = have >= (RANK[min] || 1);
    const mine = cap === 'project.access' ? [] : rules.filter((r) => r.capability === cap);
    if (mine.some((r) => r.effect === 'deny')) ok = false;
    else if (!ok && mine.some((r) => r.effect === 'allow')) ok = true;
    if (opts.readOnly && !readableCaps.has(cap)) ok = false;
    out[cap] = ok;
  }
  return out;
}
