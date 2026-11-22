// =============================================================================
// Static HTML publication - AGASTYA's own format (S1000D does not define one).
//
// A folder (and a ZIP of it) that opens from a file system or any web server, no script, no network:
//   index.html           the publication: title, classification and release markings, table of contents (nested publication entries,
//                        every dmRef of every entry), list of illustrations, list of abbreviations
//   dm/<n>-<file>.html   one page per data module: all of its content, prev / next / contents navigation
//   assets/<icn file>    the graphics and multimedia the modules use (copied, hashed names are NOT used: the ICN is the name)
//   style.css
//
// Rendering rule: NOTHING IS SILENTLY OMITTED. Known S1000D elements map to HTML (headings, paragraphs, lists, CALS tables, figures,
// warnings...). Every other element is rendered generically - its name, its attributes (where reference / data modules keep their data) and its
// children - so a type with no dedicated mapping still shows its whole content. Multimedia is linked, not played. Output is HTML-escaped; no
// element can introduce markup, scripts, event handlers or javascript: links.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { nowIso } from '../config';
import { projectDirFor } from '../context';
import { csdbRel, mediaRel, pmRel, readProjectJson } from './projects';
import { assertPublishable } from './publishGate';
import { buildSelection, planConfiguration, assertResolved, type ConfigInput } from './applicEval';
import { listDms, type DmSummary } from './csdb';
import { releaseStateOf } from './release';
import { stripExt } from './assets';
import { ZipStreamWriter } from './zipio';
import { findAll, parseTree, type MNode } from './miniXml';
import { bad } from './http';
import { formatOf } from './mediaFormats';
import { resolveRevision, chains } from './lifecycle';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const safeId = (s: string): string => `i-${s.replace(/[^A-Za-z0-9_.-]/g, '_')}`;

export const CSS = `:root{color-scheme:light dark;--fg:#1b1f24;--bg:#fff;--mut:#5a6572;--line:#d0d7de;--acc:#0b5cad;--warn:#b42318;--cau:#b54708}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--bg:#0d1117;--mut:#9aa7b4;--line:#30363d;--acc:#58a6ff;--warn:#ff7b72;--cau:#f0883e}}
body{margin:0;font:16px/1.55 system-ui,sans-serif;color:var(--fg);background:var(--bg)}
main{max-width:56rem;margin:0 auto;padding:1rem 1rem 4rem}a{color:var(--acc)}
nav.top{display:flex;gap:1rem;flex-wrap:wrap;padding:.6rem 1rem;border-bottom:1px solid var(--line);font-size:.9rem}
h1{font-size:1.6rem}h2{font-size:1.3rem}h3{font-size:1.1rem}
table{border-collapse:collapse;margin:.8rem 0;max-width:100%}td,th{border:1px solid var(--line);padding:.3rem .5rem;vertical-align:top}
figure{margin:1rem 0}figure img{max-width:100%;height:auto}figcaption{color:var(--mut);font-size:.9rem}
.banner{border:2px solid var(--line);padding:.4rem .8rem;margin:.6rem 0;font-weight:600}.mut{color:var(--mut)}
.warning{border-left:4px solid var(--warn);padding:.3rem .8rem;margin:.8rem 0}.caution{border-left:4px solid var(--cau);padding:.3rem .8rem;margin:.8rem 0}.note{border-left:4px solid var(--acc);padding:.3rem .8rem;margin:.8rem 0}
.x{margin:.2rem 0 .2rem .8rem;padding-left:.5rem;border-left:1px dotted var(--line)}.x-label{font:600 .75rem ui-monospace,monospace;color:var(--mut)}.attr{display:inline-block;font:.75rem ui-monospace,monospace;background:color-mix(in srgb,var(--line) 50%,transparent);padding:0 .3rem;margin:0 .2rem;border-radius:3px}
details.status{margin:1rem 0;border:1px solid var(--line);padding:.4rem .8rem}.step{margin:.5rem 0 .5rem 1rem}.missing{color:var(--warn)}
ul.toc,ul.toc ul{list-style:none;padding-left:1.1rem}.pager{display:flex;justify-content:space-between;margin:2rem 0}`;

interface Ctx { depth: number; assets: Map<string, string>; used: Set<string>; pages: Map<string, string>; figures: Array<{ title: string; id: string; page: string }>; acronyms: Array<{ term: string; def: string; page: string }>; page: string; missing: Set<string>; ids: Set<string> }
const BLOCK_NOTE = new Set(['warning', 'caution', 'note']);
const SKIP_ATTR = new Set(['xmlns', 'xmlns:xsi', 'xmlns:xlink', 'xmlns:dc', 'xmlns:rdf', 'xsi:noNamespaceSchemaLocation']);

const kids = (n: any): any[] => Array.from(n.childNodes ?? []);
const els = (n: any): any[] => kids(n).filter((c) => c.nodeType === 1);
const textOf = (n: any): string => (n.textContent ?? '').replace(/\s+/g, ' ').trim();
const firstEl = (n: any, name: string): any => els(n).find((c) => c.nodeName === name);

function attrChips(n: any): string {
  const out: string[] = [];
  for (const a of Array.from(n.attributes ?? []) as any[]) if (!SKIP_ATTR.has(a.name) && a.value !== '') out.push(`<span class="attr">${esc(a.name)}=${esc(a.value)}</span>`);
  return out.join('');
}

function assetFor(ident: string, ctx: Ctx): string | null {
  const hit = ctx.assets.get(ident.toUpperCase()) ?? ctx.assets.get(stripExt(ident).toUpperCase());
  if (hit) ctx.used.add(hit);
  return hit ?? null;
}

function table(n: any, ctx: Ctx): string {
  const out: string[] = ['<table>']; const title = firstEl(n, 'title');
  if (title) out.push(`<caption>${inline(title, ctx)}</caption>`);
  for (const tg of els(n).filter((c) => c.nodeName === 'tgroup')) {
    const cols = els(tg).filter((c) => c.nodeName === 'colspec').map((c) => c.getAttribute('colname') || '');
    const idx = (nm: string) => cols.indexOf(nm);
    for (const part of els(tg).filter((c) => ['thead', 'tbody', 'tfoot'].includes(c.nodeName))) {
      out.push(`<${part.nodeName}>`);
      for (const row of els(part).filter((c) => c.nodeName === 'row')) {
        out.push('<tr>');
        for (const e of els(row).filter((c) => c.nodeName === 'entry')) {
          const a = idx(e.getAttribute('namest') || ''), b = idx(e.getAttribute('nameend') || ''); const span = a >= 0 && b >= a ? ` colspan="${b - a + 1}"` : ''; const more = Number(e.getAttribute('morerows') || 0); const rs = more > 0 ? ` rowspan="${more + 1}"` : '';
          out.push(`<${part.nodeName === 'thead' ? 'th' : 'td'}${span}${rs}>${blocks(e, ctx)}</${part.nodeName === 'thead' ? 'th' : 'td'}>`);
        }
        out.push('</tr>');
      }
      out.push(`</${part.nodeName}>`);
    }
  }
  out.push('</table>'); return out.join('');
}

function inline(n: any, ctx: Ctx): string { return kids(n).map((c) => (c.nodeType === 3 || c.nodeType === 4 ? esc(c.nodeValue ?? '') : c.nodeType === 1 ? node(c, ctx, true) : '')).join(''); }
function blocks(n: any, ctx: Ctx): string { return kids(n).map((c) => (c.nodeType === 3 || c.nodeType === 4 ? esc((c.nodeValue ?? '').replace(/^\s+$/, '')) : c.nodeType === 1 ? node(c, ctx, false) : '')).join(''); }

function node(n: any, ctx: Ctx, inl: boolean): string {
  const name: string = n.nodeName; const id = n.getAttribute?.('id') ? ` id="${esc(safeId(n.getAttribute('id')))}"` : '';
  if (n.getAttribute?.('id')) ctx.ids.add(n.getAttribute('id'));
  switch (name) {
    case 'title': { const h = Math.min(6, ctx.depth + 1); return `<h${h}${id}>${inline(n, ctx)}</h${h}>`; }
    case 'para': case 'simplePara': case 'noConds': case 'reqCondGroup': return name === 'para' || name === 'simplePara' ? `<p${id}>${inline(n, ctx)}</p>` : `<div class="x x-${esc(name)}">${blocks(n, ctx)}</div>`;
    case 'emphasis': { const t = n.getAttribute('emphasisType'); return t === 'em02' ? `<i>${inline(n, ctx)}</i>` : t === 'em03' ? `<u>${inline(n, ctx)}</u>` : `<b>${inline(n, ctx)}</b>`; }
    case 'superScript': return `<sup>${inline(n, ctx)}</sup>`;
    case 'subScript': return `<sub>${inline(n, ctx)}</sub>`;
    case 'verbatimText': return `<pre>${esc(n.textContent ?? '')}</pre>`;
    case 'acronym': { const term = textOf(firstEl(n, 'acronymTerm') ?? n); const def = firstEl(n, 'acronymDefinition'); if (def) ctx.acronyms.push({ term, def: textOf(def), page: ctx.page }); return `<abbr title="${esc(def ? textOf(def) : '')}">${esc(term)}</abbr>${def ? ` (${esc(textOf(def))})` : ''}`; }
    case 'acronymTerm': case 'acronymDefinition': return esc(textOf(n));
    case 'internalRef': { const t = n.getAttribute('internalRefId'); return `<a href="#${esc(safeId(t || ''))}">${inline(n, ctx) || esc(t || '')}</a>`; }
    case 'dmRef': case 'pmRef': {
      // the reference as written: its code, issue and language, and the title it carries - linked when the target is part of this publication
      const ident = firstEl(n, name === 'dmRef' ? 'dmRefIdent' : 'pmRefIdent'); const items = firstEl(n, name === 'dmRef' ? 'dmRefAddressItems' : 'pmRefAddressItems');
      const c = ident ? findDeep(ident, name === 'dmRef' ? 'dmCode' : 'pmCode') : null; const ii = ident ? findDeep(ident, 'issueInfo') : null; const lg = ident ? findDeep(ident, 'language') : null;
      const keys = name === 'dmRef' ? ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'] : ['modelIdentCode', 'pmIssuer', 'pmNumber', 'pmVolume'];
      const code = c ? keys.map((k) => c.getAttribute(k) || '').join('-') : '';
      const title = items ? textOf(items) : '';
      const extra = [ii ? `issue ${ii.getAttribute('issueNumber')}-${ii.getAttribute('inWork')}` : '', lg ? `${lg.getAttribute('languageIsoCode')}-${lg.getAttribute('countryIsoCode')}` : ''].filter(Boolean).join(', ');
      const label = `${esc(code)}${extra ? ` (${esc(extra)})` : ''}${title ? ` &mdash; ${esc(title)}` : ''}`;
      const target = name === 'dmRef' && c ? [...ctx.pages.entries()].find(([k]) => dmcMatch(k, c)) : undefined;
      return target ? `<a class="x-ref" href="${esc(path.posix.relative('dm', target[1]) || target[1])}">${label}</a>` : `<span class="x-ref">${label}</span>`;
    }
    case 'warning': case 'caution': case 'note': return `<div class="${name}"${id}><strong>${name.toUpperCase()}</strong>${blocks(n, ctx)}</div>`;
    case 'figure': {
      const t = firstEl(n, 'title'); const fid = n.getAttribute('id') || `fig-${ctx.figures.length + 1}`; ctx.figures.push({ title: t ? textOf(t) : fid, id: safeId(fid), page: ctx.page });
      return `<figure id="${esc(safeId(fid))}">${els(n).filter((c) => c.nodeName !== 'title').map((c) => node(c, ctx, false)).join('')}<figcaption>${t ? `Figure: ${esc(textOf(t))}` : ''}</figcaption></figure>`;
    }
    case 'graphic': case 'symbol': { const ident = n.getAttribute('infoEntityIdent') || ''; const f = assetFor(ident, ctx); if (!f) { ctx.missing.add(ident); return `<span class="missing">[missing graphic: ${esc(ident)}]</span>`; } return `<img src="../assets/${esc(f)}" alt="${esc(n.getAttribute('altText') || ident)}"${n.getAttribute('reproductionWidth') ? '' : ''}/>`; }
    case 'multimediaObject': { const ident = n.getAttribute('infoEntityIdent') || ''; const f = assetFor(ident, ctx); const fmt = f ? formatOf(f) : undefined; return f ? `<p class="x"><span class="x-label">${esc(fmt?.cls ?? 'multimedia')}</span> <a href="../assets/${esc(f)}">${esc(f)}</a></p>` : (ctx.missing.add(ident), `<span class="missing">[missing multimedia: ${esc(ident)}]</span>`); }
    case 'table': return table(n, ctx);
    case 'randomList': case 'sequentialList': return `<${name === 'randomList' ? 'ul' : 'ol'}${id}>${els(n).map((c) => (c.nodeName === 'listItem' ? `<li>${blocks(c, ctx)}</li>` : node(c, ctx, false))).join('')}</${name === 'randomList' ? 'ul' : 'ol'}>`;
    case 'listItem': return `<li>${blocks(n, ctx)}</li>`;
    case 'definitionList': return `<dl>${els(n).map((c) => node(c, ctx, false)).join('')}</dl>`;
    case 'definitionListItem': return els(n).map((c) => (c.nodeName === 'listItemTerm' ? `<dt>${inline(c, ctx)}</dt>` : c.nodeName === 'listItemDefinition' ? `<dd>${blocks(c, ctx)}</dd>` : node(c, ctx, false))).join('');
    case 'levelledPara': case 'description': case 'mainProcedure': case 'preliminaryRqmts': case 'closeRqmts': case 'content': case 'commonInfo': {
      ctx.depth++; const html = `<section${id}>${blocks(n, ctx)}</section>`; ctx.depth--; return html;
    }
    case 'proceduralStep': return `<div class="step"${id}>${blocks(n, ctx)}</div>`;
    default: {
      const hasEl = els(n).length > 0; const tag = inl && !hasEl ? 'span' : 'div';
      return `<${tag} class="x x-${esc(name.replace(/[^A-Za-z0-9_-]/g, '_'))}"${id}><span class="x-label">${esc(name)}</span>${attrChips(n)}${hasEl ? blocks(n, ctx) : esc(textOf(n))}</${tag}>`;
    }
  }
}
function dmcMatch(file: string, c: any): boolean {
  if (!c) return false;
  const want = ['systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'].map((k) => c.getAttribute(k) || '');
  const f = file.toUpperCase(); return want.every((w) => w === '' || f.includes(w.toUpperCase()));
}

const stripDoctype = (xml: string): string => xml.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/, '');
export interface RenderedDm { html: string; title: string; figures: Ctx['figures']; acronyms: Ctx['acronyms']; missing: string[]; used: string[] }

/** One data module -> an HTML fragment (the body of its page). Exposed for the verification tests. */
export function renderDm(xml: string, opts: { assets?: Map<string, string>; pages?: Map<string, string>; page?: string } = {}): RenderedDm {
  const doc = new DOMParser({ onError: () => undefined }).parseFromString(stripDoctype(xml), 'text/xml');
  const root = doc.documentElement; if (!root) throw bad('The module could not be parsed.', 'NOT_WELL_FORMED');
  const ctx: Ctx = { depth: 1, assets: opts.assets ?? new Map(), used: new Set(), pages: opts.pages ?? new Map(), figures: [], acronyms: [], page: opts.page ?? '', missing: new Set(), ids: new Set() };
  const status = firstEl(root, 'identAndStatusSection'); const content = firstEl(root, 'content');
  const dmTitle = status ? (findDeep(status, 'dmTitle')) : null;
  const title = dmTitle ? [textOf(firstEl(dmTitle, 'techName') ?? dmTitle), firstEl(dmTitle, 'infoName') ? textOf(firstEl(dmTitle, 'infoName')) : ''].filter(Boolean).join(' - ') : 'Data module';
  const header = `<h1>${esc(title)}</h1>`;
  const st = status ? `<details class="status"><summary>Data module identification and status</summary>${blocks(status, { ...ctx, depth: 2 })}</details>` : '';
  const body = content ? blocks(content, ctx) : '';
  return { html: `${header}${st}${body}`, title, figures: ctx.figures, acronyms: ctx.acronyms, missing: [...ctx.missing], used: [...ctx.used] };
}
function findDeep(n: any, name: string): any { for (const c of els(n)) { if (c.nodeName === name) return c; const r = findDeep(c, name); if (r) return r; } return null; }

// ── the publication ──────────────────────────────────────────────────────────

interface TocNode { title: string; children: TocNode[]; files: string[]; notes: string[] }
function tocOf(pmXml: string, resolve: (n: MNode) => string | null, extRefs: (n: MNode) => string | null): TocNode[] {
  const root = parseTree(pmXml); const content = root.children.find((c) => c.name === 'content'); if (!content) return [];
  const walkE = (e: MNode): TocNode => {
    const t = e.children.find((c) => c.name === 'pmEntryTitle'); const files: string[] = []; const notes: string[] = [];
    for (const c of e.children) { if (c.name === 'dmRef' || /(^|:)include$/.test(c.name)) { const f = resolve(c); if (f) files.push(f); } else if (c.name === 'pmRef' || c.name === 'externalPubRef') { const x = extRefs(c); if (x) notes.push(x); } }
    return { title: t ? t.text.replace(/\s+/g, ' ').trim() : '', children: e.children.filter((c) => c.name === 'pmEntry').map(walkE), files, notes };
  };
  return content.children.filter((c) => c.name === 'pmEntry').map(walkE);
}

export interface HtmlResult { name: string; dir: string; zip: string; pages: number; assets: number; missing: string[]; configured?: string }

export async function buildHtmlPublication(projectId: string, input?: ConfigInput): Promise<HtmlResult> {
  const gate = await assertPublishable(projectId, 'publication');
  const dir = projectDirFor(projectId); const pj = readProjectJson(projectId);
  const csdbDir = path.join(dir, csdbRel(pj)); const pmAbs = path.join(dir, pmRel(pj));
  if (!fs.existsSync(pmAbs)) throw bad('This project has no publication module.', 'NO_PM');
  let pmXml = fs.readFileSync(pmAbs, 'utf8'); if (/<\s*jssbook[\s>]/.test(pmXml)) throw bad('HTML publication needs an S1000D publication module, not a JSS book.', 'NOT_S1000D');
  const dms = new Map<string, string>();                                      // file -> xml (what is published)
  for (const rel of gate.files) dms.set(rel.split('/').pop()!, fs.readFileSync(path.join(dir, rel), 'utf8'));
  let label = ''; const excluded = new Set<string>();
  if (input) {
    const sel = buildSelection(projectId, input); const plan = planConfiguration(sel, pmRel(pj), pmXml, [...dms].map(([file, xml]) => ({ file, xml })));
    assertResolved(plan); pmXml = plan.pm.xml; label = sel.label;
    for (const f of plan.files) { if (f.included) dms.set(f.file, f.xml); else { dms.delete(f.file); excluded.add(f.file); } }
  }
  const all = listDms(projectId); const index = chains(projectId); const byFile = new Map(all.map((d) => [d.file.toLowerCase(), d]));
  const resolveRef = (n: MNode): string | null => {
    if (/(^|:)include$/.test(n.name)) { const f = path.basename(n.attrs.href ?? ''); return dms.has(f) ? f : null; }
    const code = n.children.flatMap((c) => c.children).concat(n.children).find((c) => c.name === 'dmCode'); if (!code) return null;
    const ii = findAll(n, 'issueInfo')[0]; const lg = findAll(n, 'language')[0];
    const a = code.attrs; const dmc = [a.modelIdentCode, a.systemDiffCode, a.systemCode, `${a.subSystemCode ?? ''}${a.subSubSystemCode ?? ''}`, a.assyCode, `${a.disassyCode ?? ''}${a.disassyCodeVariant ?? ''}`, `${a.infoCode ?? ''}${a.infoCodeVariant ?? ''}`, a.itemLocationCode].join('-');
    const r = resolveRevision(projectId, { dmc, language: lg ? `${lg.attrs.languageIsoCode}-${(lg.attrs.countryIsoCode ?? '').toUpperCase()}` : undefined, issueNumber: ii?.attrs.issueNumber, inWork: ii?.attrs.inWork }, index);
    return r.file && dms.has(r.file) ? r.file : null;
  };
  void byFile;
  const toc = tocOf(pmXml, resolveRef, (n) => `External publication reference${n.attrs.id ? ` (${n.attrs.id})` : ''}: ${findAll(n, 'pmCode')[0] ? Object.values(findAll(n, 'pmCode')[0].attrs).join('-') : 'not resolved here'}`);

  // page order = order of first appearance in the contents
  const order: string[] = []; const seen = new Set<string>();
  (function collect(list: TocNode[]) { for (const t of list) { for (const f of t.files) if (!seen.has(f)) { seen.add(f); order.push(f); } collect(t.children); } })(toc);
  const leftover = [...dms.keys()].filter((f) => !seen.has(f)); void leftover;       // modules in the project but not in the publication are not published
  const pages = new Map<string, string>(order.map((f, i) => [f, `dm/${String(i + 1).padStart(4, '0')}-${slug(stripExt(f))}.html`]));

  const assets = new Map<string, string>();
  for (const [label2, rel] of [['csdb', csdbRel(pj)], ['media', mediaRel(pj)]] as const) { const d = path.join(dir, rel); if (!fs.existsSync(d)) continue; for (const f of fs.readdirSync(d)) if (formatOf(f) && !/^DMC-/i.test(f)) { const abs = path.join(d, f); if (fs.statSync(abs).isFile()) { assets.set(f.toUpperCase(), f); assets.set(stripExt(f).toUpperCase(), f); } } void label2; }

  const name = slug(`${(pj.name ?? projectId)}${label ? `_${label}` : ''}`); const out = path.join(dir, 'html', name);
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'dm'), { recursive: true }); fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(out, 'style.css'), CSS);

  const figs: Array<{ title: string; id: string; page: string; dm: string }> = []; const acr: Array<{ term: string; def: string; page: string }> = []; const missing = new Set<string>(); const used = new Set<string>(); const titles = new Map<string, string>();
  const rendered = new Map<string, RenderedDm>();
  for (const f of order) { const r = renderDm(dms.get(f)!, { assets, pages, page: pages.get(f)! }); rendered.set(f, r); titles.set(f, r.title); for (const x of r.figures) figs.push({ ...x, dm: f }); acr.push(...r.acronyms); r.missing.forEach((m) => missing.add(m)); r.used.forEach((u) => used.add(u)); }
  order.forEach((f, i) => {
    const r = rendered.get(f)!; const prev = order[i - 1], next = order[i + 1];
    const nav = `<nav class="top"><a href="../index.html">Contents</a>${prev ? `<a href="${esc(path.basename(pages.get(prev)!))}">&larr; ${esc(titles.get(prev) ?? '')}</a>` : ''}${next ? `<a href="${esc(path.basename(pages.get(next)!))}">${esc(titles.get(next) ?? '')} &rarr;</a>` : ''}</nav>`;
    fs.writeFileSync(path.join(out, pages.get(f)!), page(r.title, `<link rel="stylesheet" href="../style.css"/>`, `${nav}<main>${r.html}<div class="pager"><span>${prev ? `<a href="${esc(path.basename(pages.get(prev)!))}">&larr; Previous</a>` : ''}</span><span>${next ? `<a href="${esc(path.basename(pages.get(next)!))}">Next &rarr;</a>` : ''}</span></div></main>`));
  });
  for (const a of used) fs.copyFileSync(path.join(fs.existsSync(path.join(csdbDir, a)) ? csdbDir : path.join(dir, mediaRel(pj)), a), path.join(out, 'assets', a));

  // index: title, markings, contents, LOI, LOA
  const meta = pmMeta(pmXml); const rel = releaseStateOf(projectId);
  const tocHtml = (list: TocNode[]): string => `<ul class="toc">${list.map((t) => `<li>${t.title ? `<strong>${esc(t.title)}</strong>` : ''}${t.files.length ? `<ul class="toc">${t.files.map((f) => `<li><a href="${esc(pages.get(f)!)}">${esc(titles.get(f) ?? f)}</a></li>`).join('')}</ul>` : ''}${t.notes.map((n) => `<div class="mut">${esc(n)}</div>`).join('')}${t.children.length ? tocHtml(t.children) : ''}</li>`).join('')}</ul>`;
  const loi = figs.length ? `<h2>List of illustrations</h2><ul>${figs.map((f) => `<li><a href="${esc(pages.get(f.dm)!)}#${esc(f.id)}">${esc(f.title)}</a></li>`).join('')}</ul>` : '';
  const loa = acr.length ? `<h2>List of abbreviations</h2><table><tr><th>Abbreviation</th><th>Meaning</th></tr>${dedupe(acr).map((a) => `<tr><td>${esc(a.term)}</td><td>${esc(a.def)}</td></tr>`).join('')}</table>` : '';
  fs.writeFileSync(path.join(out, 'index.html'), page(meta.title || name, `<link rel="stylesheet" href="style.css"/>`,
    `<main><h1>${esc(meta.title || name)}</h1><div class="banner">Security classification: ${esc(meta.security)} &middot; ${rel.released ? `Release ${esc(String(rel.approved?.release_number ?? ''))}` : 'NOT RELEASED'}</div><p class="mut">${esc(meta.code)} &middot; issue ${esc(meta.issue)} &middot; ${esc(meta.date)}${label ? ` &middot; configuration: ${esc(label)}` : ''} &middot; built ${esc(nowIso().slice(0, 10))}</p><h2>Contents</h2>${tocHtml(toc)}${loi}${loa}${missing.size ? `<h2 class="missing">Missing graphics</h2><ul>${[...missing].map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</main>`));

  const zip = path.join(dir, 'html', `${name}.zip`);
  const z = new ZipStreamWriter(fs.createWriteStream(zip));
  const addDir = async (abs: string, rp: string) => { for (const e of fs.readdirSync(abs, { withFileTypes: true })) { const a = path.join(abs, e.name); if (e.isDirectory()) await addDir(a, `${rp}${e.name}/`); else await z.addFile(`${rp}${e.name}`, a, { store: !!formatOf(e.name) && !/\.svg$/i.test(e.name) }); } };
  await addDir(out, `${name}/`); await z.finish();
  return { name, dir: out, zip, pages: order.length, assets: used.size, missing: [...missing], configured: label || undefined };
}

const dedupe = (a: Array<{ term: string; def: string }>) => { const m = new Map<string, { term: string; def: string }>(); for (const x of a) if (!m.has(`${x.term}|${x.def}`)) m.set(`${x.term}|${x.def}`, x); return [...m.values()].sort((x, y) => x.term.localeCompare(y.term)); };
const page = (title: string, head: string, body: string): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="generator" content="AGASTYA static HTML publication"/><title>${esc(title)}</title>${head}</head><body>${body}</body></html>\n`;
function pmMeta(xml: string) { const r = parseTree(xml); const g = (n: string) => findAll(r, n)[0]; const c = g('pmCode')?.attrs ?? {}; const i = g('issueInfo')?.attrs ?? {}; const d = g('issueDate')?.attrs ?? {}; return { title: (g('pmTitle')?.text ?? '').trim(), code: [c.modelIdentCode, c.pmIssuer, c.pmNumber, c.pmVolume].filter(Boolean).join('-'), issue: `${i.issueNumber ?? ''}-${i.inWork ?? ''}`, date: [d.year, d.month, d.day].filter(Boolean).join('-'), security: g('security')?.attrs.securityClassification ?? '' }; }
export type { DmSummary };
