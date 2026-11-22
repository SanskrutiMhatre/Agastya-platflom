// =============================================================================
// Path-based read/write over the nested house/project config objects.
//
// The publishing config is deeply nested and only sparsely populated — a
// project that has never set a margin simply has no `layout.page` key at all.
// Addressing fields by a dotted path keeps the editor from having to know which
// branches happen to exist, and every write returns a new object so React sees
// a real change.
// =============================================================================

export function getPath<T = any>(obj: any, dotted: string): T | undefined {
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/** Mutating set — creates missing branches. Numeric segments create arrays. */
function setPath(obj: any, dotted: string, val: unknown): any {
  const keys = dotted.split('.');
  const last = keys.pop()!;
  let node = obj;

  keys.forEach((k, i) => {
    const nextKey = i + 1 < keys.length ? keys[i + 1] : last;
    const wantArray = /^\d+$/.test(nextKey);
    if (node[k] == null || typeof node[k] !== 'object') node[k] = wantArray ? [] : {};
    node = node[k];
  });

  node[last] = val;
  return obj;
}

/** Deep clone with (path = val) applied — safe to use directly in setState. */
export function withPath<T>(obj: T, dotted: string, val: unknown): T {
  const next = structuredClone(obj ?? ({} as T));
  setPath(next, dotted, val);
  return next;
}
