// =============================================================================
// Structure recovery from a Xignal PDF (offline). A TEST / ASSIST feature.
//
// WHY: Xignal exports the master PMC and every data module but not the annexure PMCs the master points at
// (`pmRef`). The book the customer already has as a PDF, however, begins with a generated "Table of contents"
// data module - "The listed documents are included in issue 001, dated ..." - that lists every module of the
// whole flattened publication, in print order, one row per print (the same module appears again wherever a
// publication reuses it). That list, cut at the "Annexure 'X' - ..." divider modules, is each publication's
// module order. The sample: 212 rows, 171 distinct modules, a master and 9 annexures.
//
// WHAT THE PARSER IS CAREFUL ABOUT (all verified on the 1502-page reference):
//   - ONLY the table rows are read. The footer of a generated page prints two module codes overlapped
//     ("RDR RDR-A A-A00 ..."); it sits below the table band and is excluded by position, not by pattern.
//   - the second header line "Publication module code" carries no value and is ignored.
//   - a code may share a text run with the title ("Customer Services - Technical data RDR-A-...").
//   - duplicates are kept, in order: a reused module is printed twice and is listed twice.
//   - a repeated annexure (the sample prints Annexure H twice) is one publication with occurrences > 1.
//
// The output is MARKED RECONSTRUCTED: it is a reading of a printed document, to be verified by a person.
// =============================================================================

import path from 'path';
import { DMC_IN_TEXT, parseDmcString, walkEntries } from '../identity';
import { loadPackage, type DmRec } from '../package';
import { deriveMeta, entryForDm, pmcFileName, synthesisePmText } from '../reconstruct';
import { pmCodeKey, type PackageEntry, type PmEntry, type PmMeta } from '../types';
import { openPdf, pageItems, type PdfDocument, type TextItem } from './pdfjs';

export interface TocRow { dmc: string; title: string; issueDate?: string; page: number }

export interface RecoveredPublication {
  role: 'master' | 'annexure';
  title: string;
  /** From the title page module that prints it; null when no module quotes a code (a placeholder number is then used). */
  pmCode: Record<string, string> | null;
  pmCodeKey: string;
  /** The "Annexure 'X' - ..." heading module that opens the publication in the book. */
  divider?: { dmc: string; title: string; file?: string };
  /** The title-page module (info code 001) that quotes the publication's code. */
  anchor?: { dmc: string; file?: string; techName: string };
  /** Module codes in print order, duplicates kept. */
  rows: Array<{ dmc: string; title: string; file?: string; known: boolean }>;
  /** How many times the book prints this publication. */
  occurrences: number;
  /** Prints whose module list differs from the first. */
  variants: number[];
  /** Rows that repeat the row before them (the book prints that module twice in a row). Kept as printed. */
  repeatedRows: number;
  pmcFile: string;
}

export interface RecoveredStructure {
  version: 1;
  reconstructed: true;
  source: { pdf: string; pages: number; tocPages: number[]; issue?: { issueNumber: string; inWork?: string; date?: string } };
  rows: number;
  distinct: number;
  publications: RecoveredPublication[];
  /** TOC codes no data module file matches. */
  unknownCodes: string[];
  /** Data modules never printed (unpublished alternates). */
  unusedModules: string[];
  /** Modules printed in more than one publication. */
  reusedModules: Array<{ dmc: string; publications: string[] }>;
  pmcFiles: Array<{ name: string; xml: string; role: 'master' | 'annexure'; pmCode: string }>;
  warnings: string[];
}

export interface RecoverOptions {
  /** Stop looking for the table of contents after this many pages. */
  maxScanPages?: number;
  /** Pages a table of contents may span. */
  maxTocPages?: number;
  projectName?: string;
  /** pmRef issueInfo etc. by `RDR-1671Y-00010-00`, e.g. taken from the master PMC the package does ship. */
  hints?: Record<string, { issueNumber?: string; inWork?: string; pmTitle?: string; shortPmTitle?: string }>;
  /** The issue the table of contents states ("included in issue 001 ... draft copy of Issue 001-01"); stamped on the master. */
  tocIssue?: { issueNumber: string; inWork?: string; date?: string };
}

/** The modules of a folder of `DMC-*.xml` files (images are never read). */
export function inventoryFromEntries(entries: PackageEntry[]): DmRec[] {
  return loadPackage(entries.filter((e) => /\.xml$/i.test(e.name))).dms.filter((d) => !d.isBrex);
}

/**
 * What the package's own publication modules already say about the publications the PDF lists: a master's
 * pmRef carries the annexure's title, short title and issue exactly as the author typed them, so a recovered
 * PMC can use those rather than a title read off a title page.
 */
export function hintsFromEntries(entries: PackageEntry[]): NonNullable<RecoverOptions['hints']> {
  const out: NonNullable<RecoverOptions['hints']> = {};
  for (const p of loadPackage(entries).pmcs) {
    if (!p.model) continue;
    const m = p.model.meta;
    out[pmCodeKey(m.pmCode)] = { pmTitle: m.pmTitle, shortPmTitle: m.shortPmTitle };
    walkEntries(p.model.entries, (e) => {
      if (e.type !== 'pmRef') return;
      out[pmCodeKey(e.pmCode as Record<string, string>)] = {
        issueNumber: (e.issueInfo as Record<string, string> | undefined)?.issueNumber, inWork: (e.issueInfo as Record<string, string> | undefined)?.inWork,
        pmTitle: typeof e.pmTitle === 'string' ? e.pmTitle.trim() : undefined, shortPmTitle: typeof e.shortPmTitle === 'string' ? e.shortPmTitle.trim() : undefined,
      };
    });
  }
  return out;
}

const ANNEXURE = /^Annexure\s+['‘’"]?\s*([A-Za-z0-9]+)\s*['‘’"]?\s*[-–—]/;

// ── reading the table of contents ───────────────────────────────────────────

/** The table rows of one TOC page from its text items. Pure: no PDF needed, so it is tested on synthetic items. */
export function extractTocRows(items: TextItem[], height: number, page: number): TocRow[] {
  const band = items.filter((i) => !i.rotated && i.y > height * 0.107 && i.y < height * 0.915);
  // group into lines (items of one row share a baseline to within a point or two)
  const sorted = [...band].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; items: TextItem[] }> = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= 2.5) last.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);

  const hits: Array<{ line: number; code: string; item: TextItem; before: string }> = [];
  lines.forEach((l, li) => {
    for (const it of l.items) {
      DMC_IN_TEXT.lastIndex = 0;
      const m = DMC_IN_TEXT.exec(it.str);
      if (m) hits.push({ line: li, code: m[0], item: it, before: it.str.slice(0, m.index).trim() });
    }
  });

  return hits.map((h, k): TocRow => {
    const endLine = k + 1 < hits.length ? hits[k + 1].line : lines.length;
    const titleParts: string[] = [];
    let issueDate: string | undefined;
    for (let li = h.line; li < endLine; li++) {
      const l = lines[li];
      const text = l.items
        .filter((i) => i.x < h.item.x - 4 || i === h.item)
        .map((i) => (i === h.item ? h.before : i.str))
        .filter(Boolean).join(' ').trim();
      if (text) titleParts.push(text);
      const d = l.items.find((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.str.trim()));
      if (d && !issueDate) issueDate = d.str.trim();
    }
    return { dmc: h.code, title: titleParts.join(' ').replace(/\s+/g, ' ').replace(/\s*[–-]\s*-{5,}$/, '').trim(), issueDate, page };
  });
}

const textOf = (items: TextItem[]): string => items.map((i) => i.str).join(' ');
const isTocStart = (items: TextItem[]): boolean => /Table of contents/.test(textOf(items)) && /The listed documents are included in issue/.test(textOf(items));
const isTocBody = (items: TextItem[]): boolean => /Data module code/.test(textOf(items)) && !/Intentionally left blank/i.test(textOf(items));

async function readToc(doc: PdfDocument, pages: number, opts: RecoverOptions): Promise<{ rows: TocRow[]; tocPages: number[]; issue?: RecoveredStructure['source']['issue'] }> {
  const maxScan = Math.min(pages, opts.maxScanPages ?? 200);
  let start = 0;
  for (let p = 1; p <= maxScan; p++) { if (isTocStart((await pageItems(doc, p)).items)) { start = p; break; } }
  if (!start) throw new Error(`No "Table of contents" data module (“The listed documents are included in issue ...”) was found in the first ${maxScan} pages.`);

  const rows: TocRow[] = [];
  const tocPages: number[] = [];
  let issue: RecoveredStructure['source']['issue'];
  const limit = Math.min(pages, start + (opts.maxTocPages ?? 200));
  for (let p = start; p <= limit; p++) {
    const { items, height } = await pageItems(doc, p);
    if (p > start && !isTocBody(items)) break;                   // the module ends at its blank pad page
    tocPages.push(p);
    if (p === start) {
      const m = /included in issue (\d{3}), dated (\d{4}-\d{2}-\d{2})/.exec(textOf(items));
      const side = /draft copy of Issue (\d{3})-(\d{2})/.exec(items.filter((i) => i.rotated).map((i) => i.str).join(' '));
      issue = { issueNumber: side?.[1] ?? m?.[1] ?? '001', inWork: side?.[2], date: m?.[2] };
    }
    rows.push(...extractTocRows(items, height, p));
  }
  return { rows, tocPages, issue };
}

// ── from rows to publications ───────────────────────────────────────────────

const latest = (a: DmRec, b: DmRec): number => `${b.ident.issueNumber}-${b.ident.inWork}`.localeCompare(`${a.ident.issueNumber}-${a.ident.inWork}`);

function unknownEntry(row: TocRow): PmEntry | null {
  const code = parseDmcString(row.dmc);
  if (!code) return null;
  const [tech, ...info] = row.title.split(/\s+[–-]\s+/);
  return { type: 'dm', dmCode: code, techName: tech ?? '', infoName: info.join(' - ') };
}

export function publicationsFromRows(rows: TocRow[], inventory: DmRec[], opts: RecoverOptions = {}): Omit<RecoveredStructure, 'source' | 'version' | 'reconstructed'> {
  const byDmc = new Map<string, DmRec>();
  for (const d of [...inventory].sort(latest).reverse()) byDmc.set(d.ident.dmc, d);   // latest issue wins
  const warnings: string[] = [];
  const known = (r: TocRow): DmRec | undefined => byDmc.get(r.dmc);
  const titleOf = (r: TocRow): string => known(r)?.ident.techName || r.title;

  // Cut at the divider modules.
  type Part = { divider?: TocRow; rows: TocRow[] };
  const parts: Part[] = [{ rows: [] }];
  for (const r of rows) {
    if (ANNEXURE.test(known(r)?.ident.techName ?? r.title)) parts.push({ divider: r, rows: [r] });
    else parts[parts.length - 1].rows.push(r);
  }
  if (!parts[0].rows.length) parts.shift();

  // One publication per divider; a divider met again is the same publication printed again.
  const pubs: Array<{ part: Part; occurrences: number; variants: number[]; order: number }> = [];
  parts.forEach((part, i) => {
    const same = part.divider ? pubs.find((p) => p.part.divider?.dmc === part.divider?.dmc) : undefined;
    if (same) {
      same.occurrences++;
      if (same.part.rows.map((r) => r.dmc).join('|') !== part.rows.map((r) => r.dmc).join('|')) same.variants.push(same.occurrences);
    } else pubs.push({ part, occurrences: 1, variants: [], order: i });
  });

  const publications: RecoveredPublication[] = [];
  const pmcFiles: RecoveredStructure['pmcFiles'] = [];
  const metaOf = new Map<RecoveredPublication, PmMeta>();
  const entriesOf = new Map<RecoveredPublication, PmEntry[]>();

  pubs.forEach((pb, idx) => {
    const isMaster = !pb.part.divider;
    const dms = pb.part.rows.map(known).filter((d): d is DmRec => !!d);
    // The anchor: the title page (001) among the publication's own rows that quotes a publication code; for the master its first row.
    const tail = pb.part.divider ? pb.part.rows.slice(1) : pb.part.rows;
    const anchorDm = tail.map(known).find((d): d is DmRec => !!d && d.ident.infoCode === '001' && d.bodyPmCodes.length > 0)
      ?? (isMaster ? known(tail[0]) : undefined);
    const dividerDm = pb.part.divider ? known(pb.part.divider) : undefined;
    const { meta, notes } = deriveMeta(dms.filter((d) => d !== dividerDm), undefined, { projectName: opts.projectName, titleDm: anchorDm });
    for (const n of notes.filter((x) => !/^pmCode taken from/.test(x))) warnings.push(`${isMaster ? 'master' : pb.part.divider?.dmc}: ${n}`);
    if (!anchorDm?.bodyPmCodes.length) {
      meta.pmCode.pmNumber = String(idx + 1).padStart(5, '0');
      warnings.push(`${isMaster ? 'master' : pb.part.divider?.dmc}: no title page quotes a publication code; the placeholder number ${meta.pmCode.pmNumber} was used.`);
    }
    const key = `${meta.pmCode.modelIdentCode}-${meta.pmCode.pmIssuer}-${meta.pmCode.pmNumber}-${meta.pmCode.pmVolume}`;
    const hint = opts.hints?.[key];
    if (!isMaster) meta.issueInfo = { issueNumber: hint?.issueNumber ?? '000', inWork: hint?.inWork ?? '01' };
    else if (opts.tocIssue) {
      meta.issueInfo = { issueNumber: opts.tocIssue.issueNumber, inWork: opts.tocIssue.inWork ?? '00' };
      const d = /^(d{4})-(d{2})-(d{2})$/.exec(opts.tocIssue.date ?? '');
      if (d) meta.issueDate = { year: d[1], month: d[2], day: d[3] };
    }
    if (hint?.pmTitle) meta.pmTitle = hint.pmTitle;
    if (hint?.shortPmTitle) meta.shortPmTitle = hint.shortPmTitle;

    const entries: PmEntry[] = [];
    for (const r of tail) {                          // the divider page belongs to the master (see below), not to the annexure's own module
      const d = known(r);
      const e = d ? entryForDm(d) : unknownEntry(r);
      if (e) entries.push(e);
    }
    const pub: RecoveredPublication = {
      role: isMaster ? 'master' : 'annexure', title: meta.pmTitle,
      pmCode: anchorDm?.bodyPmCodes[0] ? { ...meta.pmCode } : null, pmCodeKey: key,
      divider: pb.part.divider ? { dmc: pb.part.divider.dmc, title: titleOf(pb.part.divider), file: known(pb.part.divider)?.file.base } : undefined,
      anchor: anchorDm ? { dmc: anchorDm.ident.dmc, file: anchorDm.file.base, techName: anchorDm.ident.techName } : undefined,
      rows: tail.map((r) => ({ dmc: r.dmc, title: titleOf(r), file: known(r)?.file.base, known: !!known(r) })),
      occurrences: pb.occurrences, variants: pb.variants, pmcFile: pmcFileName(meta),
      repeatedRows: tail.filter((r, k) => k > 0 && r.dmc === tail[k - 1].dmc).length,
    };
    if (pub.repeatedRows) warnings.push(`${isMaster ? 'master' : pub.pmCodeKey}: ${pub.repeatedRows} module row${pub.repeatedRows === 1 ? ' is' : 's are'} printed twice in a row in the book; kept as printed.`);
    publications.push(pub); metaOf.set(pub, meta); entriesOf.set(pub, entries);
  });

  // The master keeps its own rows and points at each annexure once. A divider the book prints twice (the sample prints
  // Annexure 'H' after 'C' and again after 'G') is one publication: its pmRef goes where the annexure letters stay in order.
  const master = publications.find((p) => p.role === 'master');
  const printed = parts.filter((p) => p.divider);
  if (master) {
    const entries = entriesOf.get(master) as PmEntry[];
    const letterOf = (p: Part): string => (ANNEXURE.exec(known(p.divider as TocRow)?.ident.techName ?? (p.divider as TocRow).title)?.[1] ?? '').toUpperCase();
    const chosen: Part[] = [];
    printed.forEach((part, i) => {
      const dmc = (part.divider as TocRow).dmc;
      const all = printed.map((p, k) => ({ p, k })).filter((x) => (x.p.divider as TocRow).dmc === dmc);
      if (all.length === 1) { chosen.push(part); return; }
      if (all[0].k !== i) return;                                // decide once, at the first occurrence
      const L = letterOf(part);
      const fits = all.find(({ k }) => {
        const prev = printed.slice(0, k).reverse().find((p) => (p.divider as TocRow).dmc !== dmc);
        const next = printed.slice(k + 1).find((p) => (p.divider as TocRow).dmc !== dmc);
        return !!L && (!prev || letterOf(prev) < L) && (!next || L < letterOf(next));
      });
      chosen.push((fits ?? all[0]).p);
      warnings.push(`${dmc}: the book prints this divider ${all.length} times; its pmRef was placed at the print ${fits ? 'that keeps the annexure letters in order' : 'that comes first'}.`);
    });
    // chosen is in decision order; restore print order
    chosen.sort((x, y) => printed.indexOf(x) - printed.indexOf(y));
    for (const part of chosen) {
      const pub = publications.find((p) => p.divider?.dmc === (part.divider as TocRow).dmc) as RecoveredPublication;
      const m = metaOf.get(pub) as PmMeta;
      // As Xignal's own master does for Annexures B to I: the divider page is the master's, and sits just before the pmRef it introduces.
      const dividerRow = part.divider as TocRow;
      const dividerDm = known(dividerRow);
      const dividerEntry = dividerDm ? entryForDm(dividerDm) : unknownEntry(dividerRow);
      if (dividerEntry) entries.push(dividerEntry);
      entries.push({ type: 'pmRef', title: pub.divider?.title, pmCode: { ...m.pmCode }, issueInfo: { ...m.issueInfo }, pmTitle: m.pmTitle, shortPmTitle: m.shortPmTitle });
    }
  }

  for (const pub of publications) {
    const meta = metaOf.get(pub) as PmMeta;
    const xml = synthesisePmText(meta, entriesOf.get(pub) as PmEntry[],
      `synthesised from the data modules and the printed table of contents; reconstructed - verify before use`);
    pmcFiles.push({ name: pub.pmcFile, xml, role: pub.role, pmCode: pub.pmCodeKey });
  }

  const codes = rows.map((r) => r.dmc);
  const distinctCodes = new Set(codes);
  const reusedModules: RecoveredStructure['reusedModules'] = [];
  const where = new Map<string, Set<string>>();
  for (const pub of publications) for (const r of pub.rows) (where.get(r.dmc) ?? where.set(r.dmc, new Set()).get(r.dmc) as Set<string>).add(pub.pmCodeKey);
  for (const [dmc, set] of where) if (set.size > 1) reusedModules.push({ dmc, publications: [...set].sort() });

  return {
    rows: codes.length, distinct: distinctCodes.size, publications,
    unknownCodes: [...distinctCodes].filter((c) => !byDmc.has(c)).sort(),
    unusedModules: [...byDmc.keys()].filter((c) => !distinctCodes.has(c)).sort(),
    reusedModules: reusedModules.sort((a, b) => a.dmc.localeCompare(b.dmc)),
    pmcFiles, warnings,
  };
}

/** Read the table of contents of a Xignal PDF and rebuild one PMC per publication. */
export async function recoverStructureFromPdf(pdfPath: string, dmInventory: DmRec[], opts: RecoverOptions = {}): Promise<RecoveredStructure> {
  const pdf = await openPdf(pdfPath);
  try {
    const { rows, tocPages, issue } = await readToc(pdf.doc, pdf.pages, opts);
    if (!rows.length) throw new Error('The table of contents was found but no data module code could be read from it.');
    const rest = publicationsFromRows(rows, dmInventory, { ...opts, tocIssue: opts.tocIssue ?? issue });
    return { version: 1, reconstructed: true, source: { pdf: path.basename(pdfPath), pages: pdf.pages, tocPages, issue }, ...rest };
  } finally { await pdf.close(); }
}
