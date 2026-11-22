// =============================================================================
// Leaving consumed front-matter modules out of the body.
//
// The front-matter import (service.ts importFromProject / applyImport) reads Xignal's front-matter data modules into the project's
// settings, and the engine prints its own page for each of them. The imported publication module still lists those modules (it is
// the author's file and stays as it was), so a build that printed everything the module lists would print each page twice: once as
// front matter and once again as a "chapter" of the body, which also pushes every real chapter one level down. The sidecar
// (sidecar.ts) records the modules that were read; this takes them out of the publication a build reads.
//
// Pure text in, text out - it runs on the publication AFTER dmRefs became <xi:include>s, so it never has to know how a module was
// referenced. Only containers that THIS removal left empty are dropped: a pmEntry the author left empty on purpose (a chapter
// heading to be filled later, a profile's starter outline) is content of its own and stays.
// =============================================================================

import path from 'path';

const MARK = '<?agastya-consumed?>';

/** `<pmEntry ...>` that opens an element (not a self-closing one), then everything up to its own close with no pmEntry nested in it. */
const INNERMOST = /<pmEntry(?:\s[^>]*[^>/])?>((?:(?!<pmEntry[\s>/]|<\/pmEntry>)[\s\S])*)<\/pmEntry>/g;

export interface PruneResult {
  text: string;
  /** How many includes of consumed modules were taken out. */
  removed: number;
  /** How many publication entries that held nothing else went with them. */
  entriesDropped: number;
}

const hrefBase = (href: string): string => path.posix.basename(href.replace(/\\/g, '/')).toLowerCase();

/** Whether a pmEntry's inner text holds nothing a reader would see: titles, comments, whitespace and our markers only. */
const holdsNothing = (inner: string): boolean =>
  inner.split(MARK).join('')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<pmEntryTitle\b[^>]*>[\s\S]*?<\/pmEntryTitle>/g, '')
    .replace(/<pmEntryTitle\b[^>]*\/>/g, '')
    .trim() === '';

export function dropConsumedModules(pmText: string, consumedFiles: Iterable<string>): PruneResult {
  const consumed = new Set<string>();
  for (const f of consumedFiles) consumed.add(f.replace(/\\/g, '/').split('/').pop()!.toLowerCase());
  if (!consumed.size) return { text: pmText, removed: 0, entriesDropped: 0 };

  let removed = 0;
  let text = pmText.replace(/<xi:include\b([^>]*?)(?:\/>|>\s*<xi:fallback\s*\/>\s*<\/xi:include>)/g, (whole, attrs: string) => {
    const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
    const href = m ? (m[1] ?? m[2] ?? '') : '';
    if (!href || !consumed.has(hrefBase(href))) return whole;
    removed++;
    return MARK;
  });
  if (!removed) return { text: pmText, removed: 0, entriesDropped: 0 };

  // Innermost first, again and again: an entry whose only content was an entry that has just gone is empty in its turn.
  let entriesDropped = 0;
  for (let guard = 0; guard < 64; guard++) {
    let changed = false;
    text = text.replace(INNERMOST, (whole, inner: string) => {
      if (!inner.includes(MARK) || !holdsNothing(inner)) return whole;
      entriesDropped++; changed = true;
      return MARK;                                                             // the marker stays, so the parent is seen to have lost a child
    });
    if (!changed) break;
  }
  text = text.split(MARK).join('');
  return { text, removed, entriesDropped };
}
