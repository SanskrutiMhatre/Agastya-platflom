// =============================================================================
// Publication-module text repairs: rules `pmc-titles` and `pmc-dmref-identity`.
//
// A PMC lists data modules by `<dmRef>`: identity (code, issue, language) plus a copy of the title. The
// copies drift - Vektra's PMC calls every module "Purpose", "Features"... while the modules themselves are all
// titled "System / Maintenance Procedure", and says language US while the modules are IN. The module file is
// the authority on what it is, so the reference is corrected to match it (never the other way round):
//
//   pmc-dmref-identity  <issueInfo> and <language> of a dmRef := those of the module it points at
//   pmc-titles          <dmTitle> of a dmRef := the module's dmTitle
//
// One guard against destroying information: when the modules' own titles do NOT tell them apart (the same
// dmTitle on several modules, as in the Vektra data) the PMC's old wording is the only thing that names the
// chapter, so it is kept as the entry's <pmEntryTitle> before the reference title is corrected.
//
// Edits are exact-offset text edits on the delivered file; nothing else in it is re-serialised.
// =============================================================================

import { scanTags, matchingClose, parseAttrs, setAttrs, decodeText, escapeText, eolOf, lineAt, type Tag } from '../xmlScan';
import { dmKey } from '../identity';
import type { DmRec } from '../package';
import type { ChangeEntry, Finding } from '../types';

const norm = (s: string): string => decodeText(s).replace(/\s+/g, ' ').trim();
const titleOf = (d: DmRec): string => [d.ident.techName, d.ident.infoName].filter(Boolean).join(' - ');

/** The module a dmRef points at; several issues of one module -> the latest. */
export function dmIndex(dms: DmRec[]): Map<string, DmRec> {
  const m = new Map<string, DmRec>();
  for (const d of dms) {
    if (d.isBrex || !d.ident.dmc) continue;
    const k = dmKey(d.ident.dmCodeAttrs, d.ident.identExtension);
    const cur = m.get(k);
    if (!cur || `${d.ident.issueNumber}-${d.ident.inWork}` > `${cur.ident.issueNumber}-${cur.ident.inWork}`) m.set(k, d);
  }
  return m;
}

interface TextNode { open: Tag; close: Tag; text: string }
export interface DmRefView {
  open: Tag;
  code: Record<string, string>;
  ext?: Record<string, string>;
  issueTag?: Tag;
  langTag?: Tag;
  tech?: TextNode;
  info?: TextNode;
  /** The pmEntry holding the dmRef, and whether it already has a title of its own. */
  entryOpen?: Tag;
  entryHasTitle: boolean;
}

/** Every dmRef that is a pmEntry's content (not a brexDmRef / cross-reference table reference). */
export function dmRefViews(text: string): DmRefView[] {
  const tags = [...scanTags(text)];
  const out: DmRefView[] = [];
  const stack: Array<{ name: string; tag: Tag; hasTitle: boolean }> = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.kind === 'close') { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === t.name) { stack.length = k; break; } continue; }
    const parent = stack[stack.length - 1];
    if (t.name === 'pmEntryTitle' && parent?.name === 'pmEntry') parent.hasTitle = true;
    if (t.name === 'dmRef' && parent?.name === 'pmEntry') {
      const close = matchingClose(tags, i);
      if (close > i) {
        const v: DmRefView = { open: t, code: {}, entryOpen: parent.tag, entryHasTitle: parent.hasTitle };
        for (let j = i + 1; j < close; j++) {
          const c = tags[j];
          if (c.kind === 'close') continue;
          if (c.name === 'dmCode') v.code = parseAttrs(c.rawAttrs);
          else if (c.name === 'identExtension') v.ext = parseAttrs(c.rawAttrs);
          else if (c.name === 'issueInfo') v.issueTag = c;
          else if (c.name === 'language') v.langTag = c;
          else if ((c.name === 'techName' || c.name === 'infoName') && c.kind === 'open') {
            const e = matchingClose(tags, j);
            if (e > j) {
              const node: TextNode = { open: c, close: tags[e], text: text.slice(c.end, tags[e].start) };
              if (c.name === 'techName') v.tech = node; else v.info = node;
            }
          }
        }
        out.push(v);
      }
    }
    if (t.kind === 'open') stack.push({ name: t.name, tag: t, hasTitle: false });
  }
  return out;
}

export interface PmcRefOptions { titles: boolean; identity: boolean }

/** How many modules share each dmTitle: a title shared by several tells the reader nothing about which one an entry is. */
function titleShare(dms: DmRec[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of dms) if (!d.isBrex) m.set(titleOf(d), (m.get(titleOf(d)) ?? 0) + 1);
  return m;
}

export function pmcRefFindings(file: string, text: string, byKey: Map<string, DmRec>): Finding[] {
  const out: Finding[] = [];
  for (const v of dmRefViews(text)) {
    const dm = byKey.get(dmKey(v.code, v.ext));
    if (!dm) continue;
    const line = lineAt(text, v.open.start);
    const lang = v.langTag ? parseAttrs(v.langTag.rawAttrs) : undefined;
    if (lang && (lang.languageIsoCode !== dm.ident.languageIsoCode || (lang.countryIsoCode ?? '').toUpperCase() !== dm.ident.countryIsoCode)) {
      out.push({ id: 'pmc-dmref-language', severity: 'warning', rule: 'pmc-dmref-identity', file, repairable: true, message: `dmRef ${dm.ident.dmc} says language ${lang.languageIsoCode}-${lang.countryIsoCode} but the module is ${dm.ident.language}.`, data: { line } });
    }
    const iss = v.issueTag ? parseAttrs(v.issueTag.rawAttrs) : undefined;
    if (iss && (iss.issueNumber !== dm.ident.issueNumber || iss.inWork !== dm.ident.inWork)) {
      out.push({ id: 'pmc-dmref-issue', severity: 'info', rule: 'pmc-dmref-identity', file, repairable: true, message: `dmRef ${dm.ident.dmc} names issue ${iss.issueNumber}-${iss.inWork}; the module in the package is ${dm.ident.issueNumber}-${dm.ident.inWork}.`, data: { line } });
    }
    if (v.tech && v.info && (norm(v.tech.text) !== dm.ident.techName || norm(v.info.text) !== dm.ident.infoName)) {
      out.push({ id: 'pmc-title-mismatch', severity: 'warning', rule: 'pmc-titles', file, repairable: true, message: `dmRef ${dm.ident.dmc}: PMC calls it "${norm(v.tech.text)} / ${norm(v.info.text)}", the module says "${dm.ident.techName} / ${dm.ident.infoName}".`, data: { line } });
    }
  }
  return out;
}

export function repairPmcRefs(text: string, byKey: Map<string, DmRec>, allDms: DmRec[], opts: PmcRefOptions): { text: string; changes: Array<Omit<ChangeEntry, 'seq' | 'file'>> } {
  const views = dmRefViews(text);
  if (!views.length) return { text, changes: [] };
  const share = titleShare(allDms);
  const eol = eolOf(text);
  const edits: Array<{ start: number; end: number; replacement: string; order: number }> = [];
  const changes: Array<Omit<ChangeEntry, 'seq' | 'file'>> = [];
  let order = 0;

  for (const v of views) {
    const dm = byKey.get(dmKey(v.code, v.ext));
    if (!dm) continue;
    const line = lineAt(text, v.open.start);
    const where = `dmRef ${dm.ident.dmc}`;

    if (opts.identity) {
      if (v.langTag) {
        const cur = parseAttrs(v.langTag.rawAttrs);
        if (cur.languageIsoCode !== dm.ident.languageIsoCode || (cur.countryIsoCode ?? '').toUpperCase() !== dm.ident.countryIsoCode) {
          const raw = setAttrs(v.langTag.rawAttrs, { countryIsoCode: dm.ident.countryIsoCode, languageIsoCode: dm.ident.languageIsoCode });
          const self = text.slice(v.langTag.start, v.langTag.end).endsWith('/>');
          edits.push({ start: v.langTag.start, end: v.langTag.end, replacement: `<language${raw}${self ? '/>' : '>'}`, order: order++ });
          changes.push({ rule: 'pmc-dmref-identity', kind: 'edit', where, line, before: `language ${cur.languageIsoCode}-${cur.countryIsoCode}`, after: `language ${dm.ident.language}` });
        }
      }
      if (v.issueTag) {
        const cur = parseAttrs(v.issueTag.rawAttrs);
        if (cur.issueNumber !== dm.ident.issueNumber || cur.inWork !== dm.ident.inWork) {
          const raw = setAttrs(v.issueTag.rawAttrs, { issueNumber: dm.ident.issueNumber, inWork: dm.ident.inWork });
          const self = text.slice(v.issueTag.start, v.issueTag.end).endsWith('/>');
          edits.push({ start: v.issueTag.start, end: v.issueTag.end, replacement: `<issueInfo${raw}${self ? '/>' : '>'}`, order: order++ });
          changes.push({ rule: 'pmc-dmref-identity', kind: 'edit', where, line, before: `issue ${cur.issueNumber}-${cur.inWork}`, after: `issue ${dm.ident.issueNumber}-${dm.ident.inWork}` });
        }
      }
    }

    if (opts.titles && v.tech && v.info) {
      const oldTech = norm(v.tech.text); const oldInfo = norm(v.info.text);
      if (oldTech !== dm.ident.techName || oldInfo !== dm.ident.infoName) {
        // The old wording is the chapter's only name when the modules' own titles are all alike: keep it as the entry title.
        const indistinct = (share.get(titleOf(dm)) ?? 0) > 1;
        if (indistinct && !v.entryHasTitle && v.entryOpen && oldTech) {
          const ls = text.lastIndexOf('\n', v.open.start) + 1;
          const indent = /^[ \t]*$/.test(text.slice(ls, v.open.start)) ? text.slice(ls, v.open.start) : '';
          const insert = indent ? `${eol}${indent}<pmEntryTitle>${escapeText(oldTech)}</pmEntryTitle>` : `<pmEntryTitle>${escapeText(oldTech)}</pmEntryTitle>`;
          edits.push({ start: v.entryOpen.end, end: v.entryOpen.end, replacement: insert, order: order++ });
          changes.push({ rule: 'pmc-titles', kind: 'edit', where, line, before: '(entry without a title)', after: `<pmEntryTitle>${oldTech}</pmEntryTitle> (kept: module titles are identical across ${share.get(titleOf(dm))} modules)` });
        }
        edits.push({ start: v.tech.open.end, end: v.tech.close.start, replacement: escapeText(dm.ident.techName), order: order++ });
        edits.push({ start: v.info.open.end, end: v.info.close.start, replacement: escapeText(dm.ident.infoName), order: order++ });
        changes.push({ rule: 'pmc-titles', kind: 'edit', where, line, before: `${oldTech} / ${oldInfo}`, after: `${dm.ident.techName} / ${dm.ident.infoName}` });
      }
    }
  }
  if (!edits.length) return { text, changes: [] };
  // Later offsets first; at one offset, keep insertion order so a pmEntryTitle lands before nothing else moves.
  edits.sort((a, b) => b.start - a.start || b.order - a.order);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return { text: out, changes };
}
