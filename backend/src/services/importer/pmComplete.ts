// =============================================================================
// Reading a publication module COMPLETELY.
//
// The vendored reader (vendor/engine/pmc.js) turns each <pmEntry> into ONE entry: the first dmRef, or the
// pmRef, or a folder. A pmEntry that holds several dmRefs, or a dmRef beside a pmRef, loses the rest without a
// warning. The Xignal master does both: "3.3 Deployment Procedure" lists three modules, and each annexure
// entry carries the divider page (a dmRef) next to the pmRef. Counting only what the reader kept would call
// 13 modules of that book "unplaced" and, worse, drop them from the publication the importer writes.
//
// So after the vendored read, every dmRef that the model does not hold is added as a sibling entry at its
// document position (a divider goes just before its pmRef). Nothing is invented: each added entry is a dmRef
// that is in the file. dmRefs the exporter generates at build time (`#Front-Matter` pages: table of contents,
// list of illustrations ...) have no module to point at; they are NOT added - the platform generates its own
// front matter - but are reported in `model.generated`.
// =============================================================================

import { decodeText, parseAttrs, scanTags } from './xmlScan';
import { dmKey, parsePmText } from './identity';
import { dmRefViews, type DmRefView } from './repairs/pmc';
import { pmCodeKey, type PmEntry, type PmModel } from './types';

export interface GeneratedModule { dmc: string; title: string; entryTitle: string }
export type CompletePm = PmModel & { warnings: string[]; generated: GeneratedModule[]; added: number };

const GENERATED = /^#Front-?Matter/i;
const entryKey = (e: PmEntry): string => (e.dmCode ? dmKey(e.dmCode as Record<string, string>, e.identExtension as Record<string, string> | undefined) : '');

function entryFor(v: DmRefView): PmEntry {
  const e: PmEntry = { type: 'dm', dmCode: { ...v.code } };
  if (v.ext) e.identExtension = { ...v.ext };
  if (v.issueTag) { const a = parseAttrs(v.issueTag.rawAttrs); e.issueInfo = { issueNumber: a.issueNumber ?? '', inWork: a.inWork ?? '' }; }
  if (v.langTag) { const a = parseAttrs(v.langTag.rawAttrs); e.language = { languageIsoCode: a.languageIsoCode ?? '', countryIsoCode: a.countryIsoCode ?? '' }; }
  const t = (n?: { text: string }): string => decodeText(n?.text ?? '').replace(/\s+/g, ' ').trim();
  e.techName = t(v.tech); e.infoName = t(v.info);
  return e;
}

/** The pmCode of the pmRef that is a direct child of each pmEntry, by the pmEntry's start offset. */
function pmRefKeys(text: string): Map<number, string> {
  const out = new Map<number, string>();
  const tags = [...scanTags(text)];
  const stack: Array<{ name: string; start: number }> = [];
  let inRef: number | null = null;
  for (const t of tags) {
    if (t.kind === 'close') { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === t.name) { stack.length = k; break; } if (t.name === 'pmRef') inRef = null; continue; }
    const parent = stack[stack.length - 1];
    if (t.name === 'pmRef' && parent?.name === 'pmEntry') inRef = parent.start;
    if (t.name === 'pmCode' && inRef !== null) { out.set(inRef, pmCodeKey(parseAttrs(t.rawAttrs))); inRef = null; }
    if (t.kind === 'open') stack.push({ name: t.name, start: t.start });
  }
  return out;
}

export function parsePmComplete(text: string): CompletePm {
  const model = parsePmText(text) as PmModel & { warnings: string[] };
  const out: CompletePm = Object.assign(model, { generated: [] as GeneratedModule[], added: 0 });

  // Where every modelled entry sits: its list, so a new sibling can be spliced in next to it.
  const holder = new Map<PmEntry, PmEntry[]>();
  const byDm = new Map<string, PmEntry[]>();   // per module, its entries in document order: a module listed twice has two
  const byPm = new Map<string, PmEntry>();
  (function walk(list: PmEntry[]): void {
    for (const e of list) {
      holder.set(e, list);
      if (e.type === 'dm') (byDm.get(entryKey(e)) ?? byDm.set(entryKey(e), []).get(entryKey(e)) as PmEntry[]).push(e);
      else if (e.type === 'pmRef') byPm.set(pmCodeKey(e.pmCode as Record<string, string> | undefined), e);
      else if (e.type === 'folder') walk(e.children ?? []);
    }
  })(out.entries);

  const views = dmRefViews(text);
  if (!views.length) return out;
  const refKey = pmRefKeys(text);
  let cursor: PmEntry | null = null;
  const insertAfter = (anchor: PmEntry | null, e: PmEntry): void => {
    if (!anchor) { out.entries.unshift(e); holder.set(e, out.entries); return; }
    const list = holder.get(anchor) as PmEntry[];
    list.splice(list.indexOf(anchor) + 1, 0, e); holder.set(e, list);
  };

  // dmRefs arrive in document order; a dmRef the model holds only moves the cursor, one it does not hold is added there.
  for (const v of views) {
    const key = dmKey(v.code, v.ext);
    const pmKey = v.entryOpen ? refKey.get(v.entryOpen.start) : undefined;
    const have = byDm.get(key)?.shift();            // the next modelled entry for this module, if the reader kept one
    if (have) { cursor = have; continue; }
    const fresh = entryFor(v);
    if (GENERATED.test(String(fresh.techName ?? ''))) {
      out.generated.push({ dmc: key, title: [fresh.techName, fresh.infoName].filter(Boolean).join(' / '), entryTitle: '' });
      continue;
    }
    const ref = pmKey ? byPm.get(pmKey) : undefined;
    if (ref) {                                       // a divider page: it comes just before the publication it introduces
      const list = holder.get(ref) as PmEntry[];
      list.splice(list.indexOf(ref), 0, fresh); holder.set(fresh, list);
      cursor = ref;
    } else {
      insertAfter(cursor, fresh);
      cursor = fresh;
    }
    out.added++;
  }
  // The vendored reader (Phase 17) keeps every further <dmRef> of a pmEntry verbatim in `extra`, and writes it back after the entry. Each of them is
  // now an entry of its own (or, for a generated front-matter page, deliberately left out), so the verbatim copies go: left in, a save would write
  // every such reference twice.
  (function dropVerbatimDmRefs(list: PmEntry[]): void {
    for (const e of list) {
      if (Array.isArray(e.extra)) {
        const keep = e.extra.filter((x) => !/^\s*<dmRef[\s>/]/.test(x));
        if (keep.length) e.extra = keep; else delete e.extra;
      }
      if (e.type === 'folder') dropVerbatimDmRefs(e.children ?? []);
    }
  })(out.entries);
  if (out.added) out.warnings.push(`${out.added} module reference${out.added === 1 ? '' : 's'} inside a publication entry that holds several (or a divider beside a sub-publication) ${out.added === 1 ? 'was' : 'were'} not in the standard reading; added as separate entries.`);
  return out;
}
