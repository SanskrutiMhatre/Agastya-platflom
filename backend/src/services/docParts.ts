// =============================================================================
// Parts of a one-file document, and the three-way merge by part (audit WP-11, decision D22: PUB-010, ENT-016, RES-001).
//
// A JSS book or a JSG document is one XML file, but authors work on parts of it: a JSS chapter, a JSG section, plate or appendix. A part
// is an outermost element of one of the part names that carries an `id`. Everything else (the book's metadata, the front matter, the
// chapter wrappers of JSG, the order of the parts) is the "frame".
//
// When a save was made from an older version (its baseHash is not the current file), the server merges instead of refusing outright:
// base = the version the author opened (from the revision history), mine = what they send, theirs = what is on disk now. For the frame
// and for every part: unchanged by me -> theirs; unchanged by them -> mine; changed the same way -> either; changed differently -> a
// conflict, and the whole save is refused (409) naming the conflicting parts. So two authors on two different chapters both save without
// losing work, and two authors on the same chapter get the conflict they must resolve. No character-level merging (RES-001: no CRDT/OT).
// =============================================================================

const MARK = (id: string): string => `\u0000PART:${id}\u0000`;
const MARK_RE = /\u0000PART:([^\u0000]*)\u0000/g;
const FRAME = '(frame)';

export const JSS_PART_NAMES = ['chapter'];
export const JSG_PART_NAMES = ['section', 'plate', 'appendix'];

export interface Split { frame: string; parts: Map<string, string>; order: string[] }

/**
 * Split a document into its frame and its parts. Null when the text cannot be split safely (unbalanced tags, a part id used twice): the
 * caller then treats the document as one part.
 */
export function splitParts(xml: string, names: string[]): Split | null {
  const want = new Set(names);
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/?([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const stack: string[] = [];
  const parts = new Map<string, string>(); const order: string[] = [];
  let frame = ''; let cursor = 0;
  let open: { name: string; depth: number; start: number; id: string } | null = null;
  for (let m = token.exec(xml); m; m = token.exec(xml)) {
    const name = m[1];
    if (!name) continue;                                         // comment, CDATA, processing instruction, DOCTYPE
    const text = m[0];
    const closing = text.startsWith('</'); const selfClosing = !closing && /\/\s*>$/.test(text);
    if (closing) {
      if (stack.pop() !== name) return null;
      if (open && stack.length === open.depth) {
        const end = m.index + text.length;
        parts.set(open.id, xml.slice(open.start, end)); order.push(open.id);
        frame += MARK(open.id); cursor = end; open = null;
      }
      continue;
    }
    if (!open && want.has(name)) {
      const id = /\sid\s*=\s*("([^"]*)"|'([^']*)')/.exec(m[2] ?? '');
      const pid = id ? (id[2] ?? id[3] ?? '') : '';
      if (pid) {
        if (parts.has(pid) || order.includes(pid)) return null;
        frame += xml.slice(cursor, m.index);
        if (selfClosing) { parts.set(pid, text); order.push(pid); frame += MARK(pid); cursor = m.index + text.length; continue; }
        open = { name, depth: stack.length, start: m.index, id: pid };
      }
    }
    if (!selfClosing) stack.push(name);
  }
  if (stack.length || open) return null;
  frame += xml.slice(cursor);
  return { frame, parts, order };
}

/** Put a frame and its parts back together. */
export const joinParts = (frame: string, parts: Map<string, string>): string => frame.replace(MARK_RE, (_m, id: string) => parts.get(id) ?? '');

/** Which parts (and the frame) differ between two versions. */
export function changedParts(before: string, after: string, names: string[]): { parts: string[]; frame: boolean } | null {
  const a = splitParts(before, names); const b = splitParts(after, names);
  if (!a || !b) return null;
  const ids = new Set([...a.order, ...b.order]);
  return { parts: [...ids].filter((id) => a.parts.get(id) !== b.parts.get(id)), frame: a.frame !== b.frame };
}

type Pick3 = { ok: true; value: string | undefined } | { ok: false };
function pick3(base: string | undefined, mine: string | undefined, theirs: string | undefined): Pick3 {
  if (mine === base) return { ok: true, value: theirs };
  if (theirs === base) return { ok: true, value: mine };
  if (mine === theirs) return { ok: true, value: mine };
  return { ok: false };
}

/** Merge `mine` (made from `base`) into `theirs` (the current file) by part. */
export function mergeByParts(base: string, mine: string, theirs: string, names: string[]): { xml: string } | { conflicts: string[] } {
  const b = splitParts(base, names); const m = splitParts(mine, names); const t = splitParts(theirs, names);
  if (!b || !m || !t) return { conflicts: [FRAME] };
  const conflicts: string[] = [];
  const frame = pick3(b.frame, m.frame, t.frame);
  if (!frame.ok) conflicts.push(FRAME);
  const merged = new Map<string, string>();
  for (const id of new Set([...b.order, ...m.order, ...t.order])) {
    const p = pick3(b.parts.get(id), m.parts.get(id), t.parts.get(id));
    if (!p.ok) conflicts.push(id);
    else if (p.value !== undefined) merged.set(id, p.value);
  }
  if (conflicts.length) return { conflicts };
  const chosen = (frame as { value: string }).value;
  // a part the chosen frame has no place for (added on one side while the frame changed on the other) cannot be placed: a conflict
  const placed = new Set([...chosen.matchAll(MARK_RE)].map((x) => x[1]));
  const lost = [...merged.keys()].filter((id) => !placed.has(id));
  if (lost.length) return { conflicts: [FRAME, ...lost] };
  return { xml: joinParts(chosen, merged) };
}
