// =============================================================================
// Data module lifecycle: issues, in-work revisions, change marking, supersession, obsolescence.
//
// MODEL (decided with the project owner, Phase 17)
//   - Every issue / in-work revision is its OWN FILE (DMC-<code>_<III>-<WW>_<LL>-<CC>.XML). History is the set of files.
//   - A publication reference WITHOUT <issueInfo> resolves to the highest issue, then the highest in-work; WITH <issueInfo> it resolves to
//     exactly that revision (and is reported when that revision does not exist).
//   - createWorkingRevision: copies the latest revision as in-work +1 (same issue). The author then edits it.
//   - changeSuggestions: compares a revision with its predecessor and SUGGESTS change marks; nothing is written until the author applies the
//     ones they accept (applyChangeMarks adds changeMark / changeType to exactly the chosen elements, in place).
//   - issueRevision (done when a release is approved): the latest in-work revision becomes the NEXT ISSUE - issue +1, in-work 00,
//     dmStatus/@issueType="changed" - as a new file; the in-work files stay as history. Existing NNN-00 files are never touched.
//   - obsolete / supersede: explicit, Project-Manager-only, with a reason. Both write the next issue with issueType="deleted"; a superseding
//     module is named in the record. Obsolete modules are not resolved into publications (and a reference to one is reported).
//   Every action is recorded in lifecycle_events (who, why, when, from which file).
// The file/identity edits are text edits of identification attributes only; the rest of the module is copied byte for byte.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { nowIso } from '../config';
import { store } from '../context';
import { bad, conflict, notFound } from './http';
import * as csdb from './csdb';
import { findAll, norm, parseTree, setAttrs, walk, type MNode } from './miniXml';

export const REV_RE = /_(\d{3,5})-(\d{2})(?=_|\.)/;
const pad = (n: number, w: number) => String(n).padStart(w, '0');
export const revKey = (d: Pick<csdb.DmSummary, 'issueNumber' | 'inWork'>): number => Number(d.issueNumber || 0) * 1000 + Number(d.inWork || 0);

export interface Actor { id: string; username: string; role?: string }

/** All revisions of one module (same code + extension + language), oldest first. */
export const chainKey = (d: Pick<csdb.DmSummary, 'dmc' | 'language'>): string => `${d.dmc}|${d.language}`.toUpperCase();
export function chains(projectId: string): Map<string, csdb.DmSummary[]> {
  const out = new Map<string, csdb.DmSummary[]>();
  for (const d of csdb.listDms(projectId)) { const k = chainKey(d); (out.get(k) ?? out.set(k, []).get(k)!).push(d); }
  for (const c of out.values()) c.sort((a, b) => revKey(a) - revKey(b));
  return out;
}
const chainOf = (projectId: string, file: string): csdb.DmSummary[] => {
  const all = csdb.listDms(projectId); const me = all.find((d) => d.file.toLowerCase() === file.toLowerCase());
  if (!me) throw notFound('No such data module.');
  return all.filter((d) => chainKey(d) === chainKey(me)).sort((a, b) => revKey(a) - revKey(b));
};

/** issueType of a module, read from its own dmStatus. */
export function issueTypeOf(projectId: string, file: string): string {
  const head = fs.readFileSync(path.join(csdb.csdbDir(projectId), file), 'utf8').slice(0, 60000);
  return /<dmStatus\b[^>]*\bissueType\s*=\s*"([^"]*)"/.exec(head)?.[1] ?? 'new';
}

export interface RevisionRef { dmc: string; language?: string; issueNumber?: string; inWork?: string }
/** The revision a reference means: pinned = exactly that; unpinned = highest. `obsolete` is set when the chosen revision is a deleted issue. */
export function resolveRevision(projectId: string, ref: RevisionRef, index = chains(projectId)): { file: string | null; reason?: 'missing' | 'pinned-missing' | 'obsolete'; obsolete?: boolean } {
  const lang = (ref.language ?? '').toUpperCase();
  const cands = [...index.entries()].filter(([k]) => k.startsWith(`${ref.dmc.toUpperCase()}|`) && (!lang || k.endsWith(`|${lang}`))).flatMap(([, v]) => v);
  if (!cands.length) return { file: null, reason: 'missing' };
  if (ref.issueNumber) {
    const hit = cands.find((d) => d.issueNumber === ref.issueNumber && (ref.inWork === undefined || d.inWork === ref.inWork));
    return hit ? { file: hit.file } : { file: null, reason: 'pinned-missing' };
  }
  const top = [...cands].sort((a, b) => revKey(b) - revKey(a))[0];
  if (issueTypeOf(projectId, top.file) === 'deleted') return { file: null, reason: 'obsolete', obsolete: true };
  return { file: top.file };
}

/** Files that are the current (highest) revision of their module. */
export function currentFiles(projectId: string): Set<string> {
  const s = new Set<string>(); for (const c of chains(projectId).values()) s.add(c[c.length - 1].file); return s;
}

// ── identity edits ────────────────────────────────────────────────────────────

function withRevision(xml: string, file: string, issue: number, inWork: number, opts: { issueType?: string; today?: Date } = {}): { file: string; xml: string } {
  const root = parseTree(xml); const ii = findAll(root, 'issueInfo')[0];
  if (!ii || !('issueNumber' in ii.attrs)) throw bad('The module has no <issueInfo>, so no revision can be derived.', 'NO_ISSUE_INFO');
  let out = setAttrs(xml, ii, { issueNumber: pad(issue, ii.attrs.issueNumber.length || 3), inWork: pad(inWork, 2) });
  const r2 = parseTree(out);
  const d = opts.today ?? new Date();
  const dmAddrItems = findAll(r2, 'dmAddressItems')[0]; const idate = dmAddrItems && dmAddrItems.children.find((c) => c.name === 'issueDate');
  if (idate) out = setAttrs(out, idate, { year: String(d.getFullYear()), month: pad(d.getMonth() + 1, 2), day: pad(d.getDate(), 2) });
  if (opts.issueType) {
    const st = findAll(parseTree(out), 'dmStatus')[0]; if (!st) throw bad('The module has no <dmStatus>.', 'NO_STATUS');
    out = setAttrs(out, st, { issueType: opts.issueType });
  }
  const nf = REV_RE.test(file) ? file.replace(REV_RE, `_${pad(issue, 3)}-${pad(inWork, 2)}`) : null;
  if (!nf) throw bad(`${file} does not carry _III-WW in its name; it cannot be revised by name.`, 'NO_REV_IN_NAME');
  return { file: nf, xml: out };
}

const record = (projectId: string, file: string, action: string, a: Actor, o: { from?: string; reason?: string; detail?: unknown } = {}) =>
  store.stmt('INSERT INTO lifecycle_events (project_id, file, action, from_file, reason, detail, actor_id, actor_username, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(projectId, file, action, o.from ?? null, o.reason ?? null, o.detail === undefined ? null : JSON.stringify(o.detail), a.id, a.username, nowIso());

export function events(projectId: string, file?: string) {
  const rows = file ? store.stmt('SELECT * FROM lifecycle_events WHERE project_id = ? AND (file = ? OR from_file = ?) ORDER BY id DESC').all(projectId, file, file)
    : store.stmt('SELECT * FROM lifecycle_events WHERE project_id = ? ORDER BY id DESC LIMIT 500').all(projectId);
  return rows.map((r: any) => ({ id: r.id, file: r.file, action: r.action, from: r.from_file, reason: r.reason, detail: r.detail ? JSON.parse(r.detail) : null, by: r.actor_username, at: r.at }));
}

/** A module's history, as the files that make it up (oldest first) with the events recorded against them. */
export function historyOf(projectId: string, file: string) {
  const ch = chainOf(projectId, file); const ev = events(projectId);
  return ch.map((d) => ({ file: d.file, issueNumber: d.issueNumber, inWork: d.inWork, issueType: issueTypeOf(projectId, d.file), modified: d.modified, current: d === ch[ch.length - 1], events: ev.filter((e: { file: string }) => e.file === d.file) }));
}

export async function createWorkingRevision(projectId: string, file: string, actor: Actor, reason?: string) {
  const ch = chainOf(projectId, file); const top = ch[ch.length - 1];
  if (top.file.toLowerCase() !== file.toLowerCase()) throw conflict(`${file} is not the latest revision (${top.file} is). Start the new revision from the latest one.`, 'NOT_LATEST');
  if (issueTypeOf(projectId, top.file) === 'deleted') throw conflict('This module is obsolete; it cannot be revised. Reinstating needs an explicit decision (not supported here).', 'OBSOLETE');
  const next = Number(top.inWork) + 1; if (next > 99) throw conflict('In-work number 99 is the highest; issue the module (release) first.', 'INWORK_LIMIT');
  const src = csdb.readDm(projectId, top.file).xml;
  const rev = withRevision(src, top.file, Number(top.issueNumber), next);
  const out = await csdb.createDm(projectId, rev.file, rev.xml, actor, false, { revisionOf: top.file });
  record(projectId, rev.file, 'working-revision', actor, { from: top.file, reason });
  return { ...out, from: top.file, issueNumber: top.issueNumber, inWork: pad(next, 2) };
}

// ── change-marking suggestions ───────────────────────────────────────────────

export interface Suggestion { path: string; line: number; type: 'add' | 'modify' | 'delete'; element: string; excerpt: string; id?: string }
const ATTR_IGNORED = new Set(['changeMark', 'changeType', 'reasonForUpdateRefIds']);
const sig = (n: MNode) => `${n.name}|${Object.entries(n.attrs).filter(([k]) => !ATTR_IGNORED.has(k)).sort().map(([k, v]) => `${k}=${v}`).join(',')}|${norm(n.text)}`;

/** Elements of `content` that differ from the previous revision. Compared by element path and, when present, by @id (so moved ids are matched). */
export function suggest(prevXml: string, curXml: string): Suggestion[] {
  const pc = findAll(parseTree(prevXml), 'content')[0]; const cc = findAll(parseTree(curXml), 'content')[0];
  if (!pc || !cc) return [];
  const prevByPath = new Map<string, MNode>(); const prevById = new Map<string, MNode>();
  for (const n of walk(pc)) { prevByPath.set(n.path, n); if (n.attrs.id) prevById.set(n.attrs.id, n); }
  const curPaths = new Set<string>(); const out: Suggestion[] = []; const addedRoots: MNode[] = [];
  const under = (n: MNode, roots: MNode[]) => roots.some((r) => n.start >= r.start && n.end <= r.end);
  for (const n of walk(cc)) {
    curPaths.add(n.path);
    const before = (n.attrs.id && prevById.get(n.attrs.id)) || prevByPath.get(n.path);
    if (!before) { if (!under(n, addedRoots)) { addedRoots.push(n); out.push({ path: n.path, line: n.line, type: 'add', element: n.name, excerpt: norm(n.text).slice(0, 80), id: n.attrs.id }); } continue; }
    if (sig(before) !== sig(n) && !under(n, addedRoots)) out.push({ path: n.path, line: n.line, type: 'modify', element: n.name, excerpt: norm(n.text).slice(0, 80), id: n.attrs.id });
  }
  for (const [p, n] of prevByPath) if (!curPaths.has(p) && !(n.attrs.id && [...walk(cc)].some((c) => c.attrs.id === n.attrs.id))) out.push({ path: p, line: n.line, type: 'delete', element: n.name, excerpt: norm(n.text).slice(0, 80), id: n.attrs.id });
  return out;
}

export function changeSuggestions(projectId: string, file: string): { file: string; against: string | null; suggestions: Suggestion[] } {
  const ch = chainOf(projectId, file); const idx = ch.findIndex((d) => d.file.toLowerCase() === file.toLowerCase());
  if (idx <= 0) return { file, against: null, suggestions: [] };
  const prev = ch[idx - 1];
  return { file, against: prev.file, suggestions: suggest(csdb.readDm(projectId, prev.file).xml, csdb.readDm(projectId, file).xml) };
}

/** Write changeMark/changeType on the chosen elements only (adds and modifications; deletions have no element left to mark). */
export async function applyChangeMarks(projectId: string, file: string, picks: Array<{ path: string; type: 'add' | 'modify' }>, actor: Actor, projectRole: string) {
  if (!picks.length) throw bad('Nothing selected.', 'NOTHING_SELECTED');
  const cur = csdb.readDm(projectId, file); const root = parseTree(cur.xml);
  const nodes = picks.map((p) => { const n = [...walk(root)].find((x) => x.path === p.path); if (!n) throw bad(`No element at ${p.path}.`, 'NO_ELEMENT'); return { n, p }; }).sort((a, b) => b.n.start - a.n.start);
  let xml = cur.xml; for (const { n, p } of nodes) xml = setAttrs(xml, n, { changeMark: '1', changeType: p.type === 'add' ? 'add' : 'modify' });
  const out = await csdb.writeDm(projectId, file, xml, cur.hash, actor, projectRole);
  record(projectId, file, 'change-marks', actor, { detail: { marked: picks.length } });
  return { ...out, marked: picks.length };
}

// ── issue / supersede / obsolete ─────────────────────────────────────────────

export async function issueRevision(projectId: string, file: string, actor: Actor, reason?: string) {
  const ch = chainOf(projectId, file); const top = ch[ch.length - 1];
  if (top.file.toLowerCase() !== file.toLowerCase()) throw conflict(`${file} is not the latest revision.`, 'NOT_LATEST');
  if (Number(top.inWork) === 0) throw conflict(`${file} is already an issue (in-work 00); there is no working revision to issue.`, 'NOTHING_TO_ISSUE');
  const rev = withRevision(csdb.readDm(projectId, top.file).xml, top.file, Number(top.issueNumber) + 1, 0, { issueType: 'changed' });
  const out = await csdb.createDm(projectId, rev.file, rev.xml, actor, false, { revisionOf: top.file });
  record(projectId, rev.file, 'issue', actor, { from: top.file, reason });
  return { ...out, from: top.file };
}

/** On release approval: every publication module whose current revision is in-work becomes the next issue. Returns what was issued. */
export async function issueForRelease(projectId: string, sources: string[], actor: Actor): Promise<Array<{ from: string; file: string }>> {
  const names = new Set(sources.map((s) => s.split('/').pop()!.toLowerCase())); const done: Array<{ from: string; file: string }> = [];
  for (const c of chains(projectId).values()) {
    const top = c[c.length - 1];
    if (Number(top.inWork) > 0 && names.has(top.file.toLowerCase())) { const r = await issueRevision(projectId, top.file, actor, 'release approval'); done.push({ from: top.file, file: r.file }); }
  }
  return done;
}

async function retire(projectId: string, file: string, actor: Actor, action: 'obsolete' | 'supersede', reason: string, by?: string) {
  if (!String(reason ?? '').trim()) throw bad('A reason is required.', 'REASON_REQUIRED');
  const ch = chainOf(projectId, file); const top = ch[ch.length - 1];
  if (top.file.toLowerCase() !== file.toLowerCase()) throw conflict(`${file} is not the latest revision.`, 'NOT_LATEST');
  if (issueTypeOf(projectId, top.file) === 'deleted') throw conflict('Already obsolete.', 'ALREADY_OBSOLETE');
  if (action === 'supersede') { if (!by) throw bad('Name the data module that supersedes this one.', 'SUPERSEDER_REQUIRED'); const s = csdb.listDms(projectId).find((d) => d.file.toLowerCase() === by.toLowerCase()); if (!s) throw bad(`${by} is not a data module of this project.`, 'UNKNOWN_FILE'); if (chainKey(s) === chainKey(top)) throw bad('A module cannot supersede itself.', 'SELF_SUPERSEDE'); }
  const rev = withRevision(csdb.readDm(projectId, top.file).xml, top.file, Number(top.issueNumber) + 1, 0, { issueType: 'deleted' });
  const out = await csdb.createDm(projectId, rev.file, rev.xml, actor, false, { revisionOf: top.file });
  record(projectId, rev.file, action, actor, { from: top.file, reason: reason.trim(), detail: by ? { supersededBy: by } : undefined });
  return { ...out, from: top.file, supersededBy: by };
}
export const obsolete = (p: string, f: string, a: Actor, reason: string) => retire(p, f, a, 'obsolete', reason);

export const REINSTATE_KINDS = ['status', 'changed', 'revised'] as const;
export type ReinstateKind = (typeof REINSTATE_KINDS)[number];
/**
 * Reinstate a deleted (obsolete) data module. S1000D 4.2 Chap 3.5 para 2.3.3.5: "the issue number at the time of deletion must be incremented by one", and
 * Chap 3.9.5.1: issueType "rinstate-status" (only the status changed), "rinstate-changed" (changes marked) or "rinstate-revised" (changes not marked).
 * Like every lifecycle action it is a Project Manager action with a reason, writes a NEW file (the deleted issue stays in the history) and is audited.
 */
export async function reinstate(projectId: string, file: string, actor: Actor, kind: string, reason: string) {
  if (!String(reason ?? '').trim()) throw bad('A reason is required.', 'REASON_REQUIRED');
  if (!(REINSTATE_KINDS as readonly string[]).includes(kind)) throw bad(`The kind of reinstatement must be one of ${REINSTATE_KINDS.join(', ')}.`, 'BAD_REINSTATE_KIND');
  const ch = chainOf(projectId, file); const top = ch[ch.length - 1];
  if (top.file.toLowerCase() !== file.toLowerCase()) throw conflict(`${file} is not the latest revision.`, 'NOT_LATEST');
  if (issueTypeOf(projectId, top.file) !== 'deleted') throw conflict('Only an obsolete (deleted) data module can be reinstated.', 'NOT_OBSOLETE');
  const issueType = `rinstate-${kind}`;
  const rev = withRevision(csdb.readDm(projectId, top.file).xml, top.file, Number(top.issueNumber) + 1, 0, { issueType });
  const out = await csdb.createDm(projectId, rev.file, rev.xml, actor, false, { revisionOf: top.file });
  record(projectId, rev.file, 'reinstate', actor, { from: top.file, reason: reason.trim(), detail: { issueType } });
  return { ...out, from: top.file, issueType };
}
export const supersede = (p: string, f: string, a: Actor, reason: string, by: string) => retire(p, f, a, 'supersede', reason, by);

// ── publication references and revisions ─────────────────────────────────────

const attrsOf = (src: string): Record<string, string> => { const o: Record<string, string> = {}; for (const m of src.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = m[2]; return o; };
interface PmDmRef { raw: string; at: number; ref: RevisionRef & { pinned: boolean } }
export function dmRefsOf(pmText: string): PmDmRef[] {
  const out: PmDmRef[] = [];
  for (const m of pmText.matchAll(/<dmRef\b[^>]*>([\s\S]*?)<\/dmRef>/g)) {
    const body = m[1]; const code = /<dmCode\b([^>]*?)\/?>/.exec(body); if (!code) continue;
    const ext = /<identExtension\b([^>]*?)\/?>/.exec(body); const ii = /<issueInfo\b([^>]*?)\/?>/.exec(body); const lg = /<language\b([^>]*?)\/?>/.exec(body);
    const dmc = csdb.dmcString(attrsOf(code[1])); const e = ext ? attrsOf(ext[1]) : null; const i = ii ? attrsOf(ii[1]) : {}; const l = lg ? attrsOf(lg[1]) : {};
    out.push({ raw: m[0], at: m.index ?? 0, ref: { dmc: e?.extensionProducer ? `${e.extensionProducer}-${e.extensionCode}-${dmc}` : dmc, language: l.languageIsoCode ? `${l.languageIsoCode}-${(l.countryIsoCode ?? '').toUpperCase()}` : undefined, issueNumber: i.issueNumber, inWork: i.inWork, pinned: !!i.issueNumber } });
  }
  return out;
}

/** The data module code string as csdb.listDms reports it (identExtension is not part of dmc there): strip a leading extension for lookup. */
const lookupCode = (dmc: string) => dmc;

/** Problems a publication has with revisions: a pinned revision that does not exist, or a reference to an obsolete module. */
export function pmRevisionProblems(projectId: string, pmText: string): Array<{ code: 'PINNED_REVISION_MISSING' | 'OBSOLETE_MODULE'; message: string; fix: string; ref: string }> {
  const index = chains(projectId); const out: ReturnType<typeof pmRevisionProblems> = [];
  for (const r of dmRefsOf(pmText)) {
    const res = resolveRevision(projectId, { ...r.ref, dmc: lookupCode(r.ref.dmc) }, index);
    if (res.reason === 'pinned-missing') out.push({ code: 'PINNED_REVISION_MISSING', ref: r.ref.dmc, message: `The publication pins ${r.ref.dmc} to issue ${r.ref.issueNumber}${r.ref.inWork ? `-${r.ref.inWork}` : ''}, which this project does not hold.`, fix: 'Remove the issue from the reference to follow the latest revision, or restore that revision.' });
    if (res.reason === 'obsolete') out.push({ code: 'OBSOLETE_MODULE', ref: r.ref.dmc, message: `The publication refers to ${r.ref.dmc}, whose latest issue is marked deleted (obsolete).`, fix: 'Remove the entry from the publication module, or point it at the module that supersedes it.' });
  }
  return out;
}

/**
 * Before the build: every <dmRef> to a module that has MORE THAN ONE revision file becomes an <xi:include> of exactly the revision it means
 * (pinned = that one, unpinned = the highest). References to modules with a single revision are left for the engine's own resolver, so projects
 * that never revise a module behave exactly as before.
 */
export function rewriteRevisionRefs(projectId: string, pmText: string, csdbRelDir: string): { text: string; rewritten: number; notes: string[] } {
  const index = chains(projectId); const multi = new Set([...index.entries()].filter(([, v]) => v.length > 1).map(([k]) => k.split('|')[0]));
  if (!multi.size) return { text: pmText, rewritten: 0, notes: [] };
  let text = pmText; let rewritten = 0; const notes: string[] = [];
  for (const r of dmRefsOf(pmText).reverse()) {
    if (![...multi].some((c) => c.toUpperCase() === lookupCode(r.ref.dmc).toUpperCase())) continue;
    const res = resolveRevision(projectId, { ...r.ref, dmc: lookupCode(r.ref.dmc) }, index);
    if (!res.file) { notes.push(`${r.ref.dmc}: ${res.reason === 'obsolete' ? 'obsolete - not published' : 'the pinned revision does not exist - not published'}`); text = text.slice(0, r.at) + text.slice(r.at + r.raw.length); rewritten++; continue; }
    text = text.slice(0, r.at) + `<xi:include href="${csdbRelDir}/${res.file}"/>` + text.slice(r.at + r.raw.length); rewritten++;
  }
  if (rewritten && !/xmlns:xi\s*=/.test(text.slice(0, 2000))) text = text.replace(/<pm\b/, '<pm xmlns:xi="http://www.w3.org/2001/XInclude"');
  return { text, rewritten, notes };
}
