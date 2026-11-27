// Export serializers: canonical JSS blocks -> the package's document XML (DMC), its publication list (PMC), and the picture references (ICN).
//
// Pure functions (text in, text out). They are the inverse of map.ts; what map.ts could not carry (codes, status, symbols in cells) comes from the source record or is generated.

import { createHash } from 'crypto';
import type { Block, Cell, Inline, List, Part, Section, Table } from './canonical';
import { esc, isSection } from './canonical';
import { escAttr as escA } from '../../../lib/xml';


export interface ModuleIdentity {
  code: Record<string, string>; issue: Record<string, string>; language: Record<string, string>; issueDate: Record<string, string>; techName: string; infoName: string;
}
export interface SerializeCtx {
  /** table/figure id in the JSS document -> the id the source used */
  originalIds: Map<string, string>;
  /** Media file name -> picture entity name used in the output */
  entityOf: (media: string) => string;
  /** symbols to put back: table id -> "group:row:col" -> symbol xml */
  attachments: Map<string, Map<string, string[]>>;
  /** entities referenced (collected while writing) */
  used: Set<string>;
  notes: string[];
}

const entityFromSrc = (src: string, ctx: SerializeCtx): string => { const base = src.replace(/^.*[\\/]/, ''); const e = ctx.entityOf(base); ctx.used.add(e); return e; };

function inlineX(inl: Inline[], ctx: SerializeCtx): string {
  return inl.map((i) => {
    if (i.t === 'text') return esc(i.text);
    if (i.t === 'br') return ' ';
    if (i.t === 'xref') return inlineX(i.children, ctx);
    const inner = inlineX(i.children, ctx);
    switch (i.mark) {
      case 'b': return `<emphasis emphasisType="em01">${inner}</emphasis>`;
      case 'i': return `<emphasis emphasisType="em02">${inner}</emphasis>`;
      case 'u': return `<emphasis emphasisType="em03">${inner}</emphasis>`;
      case 'sup': return `<superScript>${inner}</superScript>`;
      default: return `<subScript>${inner}</subScript>`;
    }
  }).join('');
}

/** A list may not stand alone in this format: it goes inside the paragraph before it (as the source packages write it), or inside a paragraph of its own. */
function attachList(items: string[], listXml: string): void {
  const last = items[items.length - 1];
  if (last !== undefined && /^\s*<para>/.test(last) && last.endsWith('</para>')) items[items.length - 1] = `${last.slice(0, -7)}\n${listXml}</para>`;
  else items.push(`<para>\n${listXml}</para>`);
}

const para = (inl: Inline[], ctx: SerializeCtx, extra = ''): string => `<para>${inlineX(inl, ctx)}${extra}</para>`;

function listX(l: List, ctx: SerializeCtx, pad: string): string {
  const ordered = l.type === 'number' || l.type === 'alpha' || l.type === 'roman' || l.type === undefined;
  if (l.type === 'alpha' || l.type === 'roman') ctx.notes.push('list-style');
  const tag = ordered ? 'sequentialList' : 'randomList';
  const items = l.items.map((it) => {
    const body: string[] = []; let textRun: Inline[] = [];
    const flush = (): void => { if (textRun.length) { body.push(para(textRun, ctx)); textRun = []; } };
    for (const p of it.parts) {
      if (p.k === 'inline') textRun.push(...p.inline);
      else if (p.k === 'para') { flush(); body.push(para(p.inline, ctx)); }
      else { flush(); attachList(body, listX(p, ctx, pad + '    ')); }
    }
    flush();
    if (!body.length) body.push('<para></para>');
    return `${pad}  <listItem>${body.join('')}</listItem>`;
  }).join('\n');
  return `${pad}<${tag}>\n${items}\n${pad}</${tag}>`;
}

function cellX(c: Cell, ctx: SerializeCtx, symbols: string[]): string {
  const body: string[] = [];
  let run: Inline[] = [];
  const flush = (): void => { if (run.length) { body.push(para(run, ctx)); run = []; } };
  for (const p of c.parts as Part[]) {
    if (p.k === 'inline') run.push(...p.inline);
    else if (p.k === 'para') { flush(); body.push(para(p.inline, ctx)); }
    else { flush(); attachList(body, listX(p, ctx, '')); }
  }
  flush();
  if (symbols.length) { for (const s of symbols) ctx.used.add(/infoEntityIdent="([^"]+)"/.exec(s)?.[1] ?? ''); if (body.length && body[0].endsWith('</para>')) body[0] = body[0].replace(/<\/para>$/, `${symbols.join('')}</para>`); else body.unshift(`<para>${symbols.join('')}</para>`); }
  if (!body.length) body.push('<para></para>');
  return body.join('');
}

function tableX(t: Table, ctx: SerializeCtx, pad: string): string {
  // columns: widest row once spans are counted
  const grid = (rows: Table['head']): number => { let w = 0; const occ: number[] = []; for (const r of rows) { let col = 0; for (const c of r.cells) { while ((occ[col] ?? 0) > 0) col++; for (let k = 0; k < (c.colspan ?? 1); k++) occ[col + k] = c.rowspan ?? 1; col += c.colspan ?? 1; } while ((occ[col] ?? 0) > 0) col++; w = Math.max(w, col); for (let k = 0; k < occ.length; k++) if ((occ[k] ?? 0) > 0) occ[k]--; } return w; };
  const cols = Math.max(1, grid(t.head), grid(t.body));
  const widths = (t.widths ?? '').split(/\s+/).filter(Boolean);
  const id = (t.id && ctx.originalIds.get(t.id)) || (t.id ?? '');
  const att = (t.id && ctx.attachments.get(t.id)) || new Map<string, string[]>();
  const rowsX = (rows: Table['head'], group: 'thead' | 'tbody'): string => {
    const occ: number[] = [];
    return rows.map((r, ri) => {
      let col = 0;
      const cells = r.cells.map((c, ci) => {
        while ((occ[col] ?? 0) > 0) col++;
        const start = col; const cs = c.colspan ?? 1;
        for (let k = 0; k < cs; k++) occ[col + k] = c.rowspan ?? 1; col += cs;
        const span = cs > 1 ? ` namest="col${start + 1}" nameend="col${start + cs}"` : '';
        const more = (c.rowspan ?? 1) > 1 ? ` morerows="${(c.rowspan ?? 1) - 1}"` : '';
        const al = c.align ? ` align="${c.align}"` : '';
        return `${pad}      <entry${span}${more}${al}>${cellX(c, ctx, att.get(`${group}:${ri}:${ci}`) ?? [])}</entry>`;
      });
      for (let k = 0; k < occ.length; k++) if ((occ[k] ?? 0) > 0) occ[k]--;
      return `${pad}    <row>\n${cells.join('\n')}\n${pad}    </row>`;
    }).join('\n');
  };
  const specs = Array.from({ length: cols }, (_, i) => `${pad}    <colspec colname="col${i + 1}"${widths.length === cols && widths[i] ? ` colwidth="${escA(widths[i])}"` : ''}/>`).join('\n');
  return `${pad}<table${id ? ` id="${escA(id)}"` : ''} frame="all">${t.title ? `\n${pad}  <title>${esc(t.title)}</title>` : ''}\n${pad}  <tgroup cols="${cols}">\n${specs}\n${t.head.length ? `${pad}    <thead>\n${rowsX(t.head, 'thead')}\n${pad}    </thead>\n` : ''}${pad}    <tbody>\n${rowsX(t.body, 'tbody')}\n${pad}    </tbody>\n${pad}  </tgroup>\n${pad}</table>`;
}

function blockX(b: Block, ctx: SerializeCtx, pad: string): string {
  switch (b.k) {
    case 'para': return `${pad}${para(b.inline, ctx)}`;
    case 'list': return listX(b, ctx, pad);
    case 'pageBreak': ctx.notes.push('page-break'); return '';
    case 'table': return tableX(b, ctx, pad);
    case 'figure': {
      const id = (b.id && ctx.originalIds.get(b.id)) || b.id || '';
      const gs = b.graphics.map((g) => {
        const w = g.width && /^\d+(\.\d+)?(mm|cm|in|pt|px)$/.test(g.width) ? ` reproductionWidth="${g.width}"` : ''; const h = g.height && /^\d+(\.\d+)?(mm|cm|in|pt|px)$/.test(g.height) ? ` reproductionHeight="${g.height}"` : '';
        return `${pad}  <graphic infoEntityIdent="${escA(entityFromSrc(g.src, ctx))}"${w}${h}/>`;
      });
      if (b.legend.length) ctx.notes.push('figure-legend');
      return `${pad}<figure${id ? ` id="${escA(id)}"` : ''}>${b.title ? `\n${pad}  <title>${esc(b.title)}</title>` : ''}\n${gs.join('\n')}\n${pad}</figure>`;
    }
    default: {
      const inner = b.blocks.flatMap((x) => (x.k === 'para' ? [x.inline] : x.items.map((it) => it.parts.flatMap((p) => (p.k === 'list' ? [] : p.inline)))));
      if (b.blocks.some((x) => x.k === 'list')) ctx.notes.push('notice-list');
      const tag = b.k === 'note' ? 'notePara' : 'warningAndCautionPara';
      return `${pad}<${b.k}>\n${inner.map((i) => `${pad}  <${tag}>${inlineX(i, ctx)}</${tag}>`).join('\n') || `${pad}  <${tag}></${tag}>`}\n${pad}</${b.k}>`;
    }
  }
}

function sectionX(s: Section, ctx: SerializeCtx, pad: string): string {
  const items: string[] = [];
  for (const c of s.children) {
    if (isSection(c)) items.push(sectionX(c, ctx, pad + '  '));
    else if (c.k === 'list') attachList(items, listX(c, ctx, pad + '    '));
    else { const x = blockX(c, ctx, pad + '  '); if (x) items.push(x); }
  }
  const body = items.join('\n');
  return `${pad}<levelledPara>\n${pad}  <title>${esc(s.title)}</title>${body ? '\n' + body : ''}\n${pad}</levelledPara>`;
}

/** The `<content>` element of one document. */
export function contentXml(s: Section, ctx: SerializeCtx): string {
  return `  <content>\n    <description>\n${sectionX(s, ctx, '      ')}\n    </description>\n  </content>`;
}

export const doctypeFor = (entities: Array<{ entity: string; file: string }>): string => (entities.length
  ? `<!DOCTYPE dmodule [\n${entities.map((e) => `<!ENTITY ${e.entity} SYSTEM "${e.file}" NDATA PNG >`).join('\n')}\n]>\n` : '');

const pad2 = (n: number, w = 2): string => String(n).padStart(w, '0');

export const codeAttrs = (c: Record<string, string>): string => ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'].map((k) => `${k}="${escA(c[k] ?? '')}"`).join(' ');

/** An identity for a section that came from no package: the project code, a number from its position, and the description information code. */
export function generatedIdentity(projectCode: string, index: number, title: string, language: Record<string, string>, today: Date): ModuleIdentity {
  return {
    code: { modelIdentCode: projectCode, systemDiffCode: 'A', systemCode: '00', subSystemCode: '0', subSubSystemCode: '0', assyCode: pad2(Math.floor(index / 99)), disassyCode: pad2((index % 99) + 1), disassyCodeVariant: 'A', infoCode: '040', infoCodeVariant: 'A', itemLocationCode: 'D' },
    issue: { issueNumber: '001', inWork: '00' }, language: Object.keys(language).length ? language : { languageIsoCode: 'en', countryIsoCode: 'US' },
    issueDate: { year: String(today.getUTCFullYear()), month: pad2(today.getUTCMonth() + 1), day: pad2(today.getUTCDate()) },
    techName: title.replace(/\s+/g, ' ').trim().slice(0, 100) || 'Section', infoName: 'Description',
  };
}

/** The identification and status part of a generated document. */
export function identAndStatusXml(id: ModuleIdentity, enterprise = '00000'): string {
  return `  <identAndStatusSection>
    <dmAddress>
      <dmIdent>
        <dmCode ${codeAttrs(id.code)}/>
        <language languageIsoCode="${escA(id.language.languageIsoCode ?? 'en')}" countryIsoCode="${escA(id.language.countryIsoCode ?? 'US')}"/>
        <issueInfo issueNumber="${escA(id.issue.issueNumber ?? '001')}" inWork="${escA(id.issue.inWork ?? '00')}"/>
      </dmIdent>
      <dmAddressItems>
        <issueDate year="${id.issueDate.year}" month="${id.issueDate.month}" day="${id.issueDate.day}"/>
        <dmTitle>
          <techName>${esc(id.techName)}</techName>
          <infoName>${esc(id.infoName)}</infoName>
        </dmTitle>
      </dmAddressItems>
    </dmAddress>
    <dmStatus issueType="new">
      <security securityClassification="01"/>
      <responsiblePartnerCompany enterpriseCode="${enterprise}"/>
      <originator enterpriseCode="${enterprise}"/>
      <applic>
        <displayText>
          <simplePara>All</simplePara>
        </displayText>
      </applic>
      <brexDmRef>
        <dmRef>
          <dmRefIdent>
            <dmCode modelIdentCode="S1000D" systemDiffCode="F" systemCode="04" subSystemCode="1" subSubSystemCode="0" assyCode="0301" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="A" itemLocationCode="D"/>
          </dmRefIdent>
        </dmRef>
      </brexDmRef>
      <qualityAssurance>
        <unverified/>
      </qualityAssurance>
    </dmStatus>
  </identAndStatusSection>`;
}

export const documentXml = (rootStart: string, doctype: string, identAndStatus: string, content: string): string => `<?xml version="1.0" encoding="utf-8"?>\n${doctype}${rootStart}\n${identAndStatus}\n${content}\n</dmodule>\n`;
export const DEFAULT_ROOT = '<dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xlink="http://www.w3.org/1999/xlink" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/descript.xsd">';

// ── the contents list (PMC) ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PmcModule { identity: ModuleIdentity; pmTitle: string }
export interface PmcChapter { title: string; modules: PmcModule[]; number?: number; /** the page that introduces the chapter (a package from the older publishing tool has one) */ heading?: PmcModule }
export interface PmcLayout { /** the publication's own title: the entry that holds everything */ title: string; /** front-matter pages: the entry title and the document */ front: Array<{ title: string; module: PmcModule }> }

const dmRefX = (m: PmcModule, pad: string): string => `${pad}<dmRef>
${pad}  <dmRefIdent>
${pad}    <dmCode ${codeAttrs(m.identity.code)}/>
${pad}    <issueInfo issueNumber="${escA(m.identity.issue.issueNumber ?? '001')}" inWork="${escA(m.identity.issue.inWork ?? '00')}"/>
${pad}    <language languageIsoCode="${escA(m.identity.language.languageIsoCode ?? 'en')}" countryIsoCode="${escA(m.identity.language.countryIsoCode ?? 'US')}"/>
${pad}  </dmRefIdent>
${pad}  <dmRefAddressItems>
${pad}    <dmTitle>
${pad}      <techName>${esc(m.pmTitle || m.identity.techName)}</techName>
${pad}      <infoName>${esc(m.identity.infoName)}</infoName>
${pad}    </dmTitle>
${pad}    <issueDate year="${m.identity.issueDate.year}" month="${m.identity.issueDate.month}" day="${m.identity.issueDate.day}"/>
${pad}  </dmRefAddressItems>
${pad}</dmRef>`;

/**
 * The contents list. Without a layout: one entry per chapter, its documents inside.
 * With one (the older publishing tool's own shape): an entry named by the publication, a "Front matter" entry holding each front-matter page, and a "Chapter" entry holding each chapter
 * as a folder named by its number - the chapter's heading page in an entry of its own, its documents in an entry without a title. The importer reads both shapes.
 */
export function pmcXml(chapters: PmcChapter[], head: { rootStart: string; identAndStatus: string }, layout?: PmcLayout): string {
  const live = chapters.filter((c) => c.modules.length);
  const entry = (title: string | null, inner: string, pad: string): string => `${pad}<pmEntry>\n${title === null ? '' : `${pad}  <pmEntryTitle>${esc(title)}</pmEntryTitle>\n`}${inner}\n${pad}</pmEntry>`;
  const refs = (mods: PmcModule[], pad: string): string => mods.map((m) => dmRefX(m, pad)).join('\n');
  let entries: string;
  if (!layout) entries = live.map((c) => entry(c.title, refs(c.modules, '      '), '    ')).join('\n');
  else {
    const front = layout.front.length ? entry('Front matter', layout.front.map((f) => entry(f.title, refs([f.module], '          '), '        ')).join('\n'), '      ') : '';
    const chapterEntries = live.map((c) => (c.heading
      ? entry(String(c.number ?? ''), `${entry(c.title, refs([c.heading], '            '), '          ')}\n${entry(null, refs(c.modules, '            '), '          ')}`, '        ')
      : entry(c.title, refs(c.modules, '        '), '      '))).join('\n');
    entries = entry(layout.title, [front, entry('Chapter', chapterEntries, '      ')].filter(Boolean).join('\n'), '    ');
  }
  return `<?xml version="1.0" ?>\n${head.rootStart}\n  ${head.identAndStatus.trim()}\n  <content>\n${entries}\n  </content>\n</pm>\n`;
}

export function generatedPmHead(projectCode: string, title: string, language: Record<string, string>, today: Date, pm: { pmIssuer: string; pmNumber: string; pmVolume: string } = { pmIssuer: '00000', pmNumber: '00001', pmVolume: '00' }): { rootStart: string; identAndStatus: string } {
  const d = { y: today.getUTCFullYear(), m: pad2(today.getUTCMonth() + 1), d: pad2(today.getUTCDate()) };
  return {
    rootStart: '<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xlink="http://www.w3.org/1999/xlink" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/pm.xsd">',
    identAndStatus: `<identAndStatusSection>
    <pmAddress>
      <pmIdent>
        <pmCode modelIdentCode="${escA(projectCode)}" pmIssuer="${escA(pm.pmIssuer)}" pmNumber="${escA(pm.pmNumber)}" pmVolume="${escA(pm.pmVolume)}"/>
        <language languageIsoCode="${escA(language.languageIsoCode ?? 'en')}" countryIsoCode="${escA(language.countryIsoCode ?? 'US')}"/>
        <issueInfo issueNumber="001" inWork="00"/>
      </pmIdent>
      <pmAddressItems>
        <issueDate year="${d.y}" month="${d.m}" day="${d.d}"/>
        <pmTitle>${esc(title)}</pmTitle>
      </pmAddressItems>
    </pmAddress>
    <pmStatus>
      <security securityClassification="01"/>
      <responsiblePartnerCompany enterpriseCode="00000"/>
      <originator enterpriseCode="00000"/>
      <applic>
        <displayText>
          <simplePara>All</simplePara>
        </displayText>
      </applic>
      <brexDmRef>
        <dmRef>
          <dmRefIdent>
            <dmCode modelIdentCode="S1000D" systemDiffCode="F" systemCode="04" subSystemCode="1" subSubSystemCode="0" assyCode="0301" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="A" itemLocationCode="D"/>
          </dmRefIdent>
        </dmRef>
      </brexDmRef>
      <qualityAssurance>
        <unverified/>
      </qualityAssurance>
    </pmStatus>
  </identAndStatusSection>`,
  };
}

export const dmcFileName = (c: Record<string, string>): string => `DMC-${[c.modelIdentCode, c.systemDiffCode, c.systemCode, `${c.subSystemCode}${c.subSubSystemCode}`, c.assyCode, `${c.disassyCode}${c.disassyCodeVariant}`, `${c.infoCode}${c.infoCodeVariant}`, c.itemLocationCode].join('-')}`;

/** A picture name for a file that has none of its own (an ICN-style name derived from the project code and the file's content). */
export const icnNameFor = (projectCode: string, bytes: Buffer): string => `ICN-${projectCode}-000000-1-00000-${createHash('sha1').update(bytes).digest('hex').slice(0, 5).replace(/[a-f]/g, (c) => String(c.charCodeAt(0) - 97)).padStart(5, '0')}-A-001-01`;
