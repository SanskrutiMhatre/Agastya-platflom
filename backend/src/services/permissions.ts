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

export function setCapabilityTable(t: Record<string, string>): void { table = { ...t }; }
export function capabilityTable(): Record<string, string> { return { ...table }; }

/**
 * What a person with this effective project role may do. A project that is not active (pending approval, rejected) supports reading only,
 * and only for its owner: the same rule authz.evaluate applies.
 */
export function canFor(role: string | null | undefined, status: string = 'active'): Record<string, boolean> {
  const have = RANK[String(role)] || 0;
  const out: Record<string, boolean> = {};
  for (const [cap, min] of Object.entries(table)) {
    out[cap] = status === 'active' ? have >= (RANK[min] || 1) : (cap === 'project.read' && role === 'owner');
  }
  return out;
}
