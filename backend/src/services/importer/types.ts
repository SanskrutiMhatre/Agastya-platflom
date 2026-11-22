// =============================================================================
// Shared types of the package importer.
//
// The importer is split in three stages that never touch the project until the last one:
//   1. SCAN    read a package (a list of files), classify it, decide what flavour it is, find every problem
//   2. REPAIR  produce repaired COPIES of the files plus a change log (the originals are never modified)
//   3. APPLY   write the repaired copies into a project's CSDB (routes/importer.ts, apply.ts)
// Stages 1 and 2 are pure: no filesystem, no database, no network - so they can be unit-tested on the sample
// data and run in a dry-run mode that reports what an import WOULD do.
// =============================================================================

/** One file of an import package. `name` may carry directories (a zip's `XML/DMC-....xml`). */
export interface PackageEntry { name: string; bytes: Uint8Array }

export type Flavour = 'xignal-s1000d' | 'xignal-jss' | 'vektra' | 'generic-s1000d';
export type FileKind = 'dm' | 'brex' | 'pmc' | 'icn' | 'image' | 'other' | 'ignored';
export type Severity = 'error' | 'warning' | 'info';

/** The individually switchable repairs. */
export const REPAIR_RULES = ['table-cols', 'icn-placeholder', 'brex-remap', 'pmc-reconstruct', 'pmc-titles', 'pmc-dmref-identity'] as const;
export type RepairRuleId = (typeof REPAIR_RULES)[number];

/** Findings that are reported but never repaired automatically, plus the structural rule. */
export type ReportRuleId = RepairRuleId | 'orphans-pool' | 'pmc-missing-dmref' | 'pmc-language' | 'subpub' | 'package';

export interface RuleInfo {
  id: RepairRuleId;
  title: string;
  /** Does an import run it when the caller names no rules? Rules that change a customer's data beyond a defect are off. */
  defaultOn: boolean;
  description: string;
}

export interface Finding {
  /** Stable machine id, e.g. `table-cols-mismatch`. */
  id: string;
  severity: Severity;
  rule: ReportRuleId;
  file?: string;
  message: string;
  /** True when one of the enabled repair rules fixes it. */
  repairable?: boolean;
  data?: Record<string, unknown>;
}

export interface ChangeEntry {
  seq: number;
  rule: ReportRuleId;
  /** edit = a file's text changed; add = a file was created; note = a decision recorded without changing a file. */
  kind: 'edit' | 'add' | 'note';
  /** Package path of the file the change belongs to. */
  file: string;
  where?: string;
  line?: number;
  before: string;
  after: string;
  /** The change fabricates content (a placeholder image, a reconstructed publication) rather than correcting it. */
  synthetic?: boolean;
}

export interface DmIdent {
  dmCodeAttrs: Record<string, string>;
  identExtension?: Record<string, string>;
  /** `MODEL-SDC-SYS-SUBSUB-ASSY-DISASSYVAR-INFOVAR-LOC`, the form csdb.dmcString and the Explorer use. */
  dmc: string;
  infoCode: string;
  issueNumber: string;
  inWork: string;
  /** `en-IN` (what csdb.parseIdent calls `language`). */
  language: string;
  languageIsoCode: string;
  countryIsoCode: string;
  techName: string;
  infoName: string;
  /** Schema file the module declares (`descript`), and the S1000D issue it belongs to (`4.2`). */
  schema: string;
  issue: string;
  security: string;
  issueDate?: { year: string; month: string; day: string };
  originatorCode?: string;
  rpcCode?: string;
  /** The BREX data module code the module names, as `S1000D-F-04-10-0301-00A-022A-D` (no `DMC-`). */
  brexDmc?: string;
  /** Content is empty (`<description />`): a heading-only module. */
  emptyContent: boolean;
}

export interface PmEntry {
  type: 'folder' | 'include' | 'dm' | 'pmRef';
  title?: string;
  href?: string;
  children?: PmEntry[];
  dmCode?: Record<string, string>;
  identExtension?: Record<string, string>;
  issueInfo?: Record<string, string>;
  language?: Record<string, string>;
  pmCode?: Record<string, string>;
  pmTitle?: string;
  shortPmTitle?: string;
  techName?: string;
  infoName?: string;
  issueDate?: Record<string, string>;
  hasFallback?: boolean;
  extra?: string[];
  [k: string]: unknown;
}

export interface PmMeta {
  pmCode: Record<string, string>;
  language: Record<string, string>;
  issueInfo: Record<string, string>;
  issueDate: Record<string, string>;
  pmTitle: string;
  shortPmTitle: string;
  securityClassification: string;
  logo?: Record<string, string>;
  rpc?: { enterpriseCode: string; enterpriseName: string };
  originator?: { enterpriseCode: string; enterpriseName: string };
}

export interface PmModel {
  meta: PmMeta;
  entries: PmEntry[];
  /** Pages the exporting tool generates at build time (`#Front-Matter`): named by the file, but there is no module behind them. Not written back. */
  generated?: Array<{ dmc: string; title: string; entryTitle: string }>;
}

/** `RDR-1671Y-00010-00` */
export const pmCodeKey = (c: Record<string, string> | undefined): string =>
  [c?.modelIdentCode ?? '', c?.pmIssuer ?? '', c?.pmNumber ?? '', c?.pmVolume ?? ''].join('-');

export type SubPubStatus = 'nested' | 'anchor-only' | 'unresolved';

/** A publication referenced from another one by `<pmRef>` (an "Annexure"). */
export interface SubPublication {
  pmCode: string;
  pmCodeAttrs: Record<string, string>;
  /** The pmEntryTitle that introduces it in the referencing publication. */
  entryTitle: string;
  pmTitle: string;
  shortPmTitle: string;
  /** Package path of the referencing PMC. */
  referencedFrom: string;
  /** Position of the pmRef entry in the referencing PMC's tree (child indexes from the root). */
  entryPath: number[];
  /** nested: its PMC is in the package and was imported as a folder. anchor-only: only its title-page DM is. unresolved: neither. */
  status: SubPubStatus;
  /** Package path of the sub-publication's own PMC, when present. */
  pmcFile?: string;
  /** The title-page DM (info code 001) whose body quotes this publication's pmCode. */
  anchorDm?: { file: string; dmc: string; techName: string };
  /** How the anchor was found; `title-page` is the verified mapping, `any-module` a weaker fallback. */
  anchorBasis?: 'title-page' | 'any-module';
}

export interface PoolItem {
  file: string;
  dmc: string;
  techName: string;
  infoName: string;
  infoCode: string;
  /** SNS-style grouping key: `systemCode-subSystem-assy`. */
  group: string;
  reason: 'not-in-any-pmc' | 'sub-publication-not-in-package';
  /** Heading-only module (empty content). */
  emptyContent: boolean;
}

export interface ReusedDm { dmc: string; occurrences: number; file?: string }

export interface PackageReport {
  version: 1;
  flavour: { id: Flavour; confidence: number; evidence: string[] };
  counts: { files: number; bytes: number; dms: number; brex: number; pmcs: number; icns: number; images: number; other: number; ignored: number };
  files: Array<{ path: string; kind: FileKind; size: number; dmc?: string }>;
  /** Models on offer, with how many modules each has - what the project will be told about its model. */
  models: Record<string, number>;
  languages: Record<string, number>;
  graphics: {
    declared: number; present: number;
    /** Declared (or referenced) but not shipped: the importer writes a labelled placeholder when `icn-placeholder` is on. */
    missing: Array<{ icn: string; target: string; declaredIn: string[] }>;
    unusedFiles: string[];
  };
  publications: Array<{
    file: string; pmCode: string; title: string; language: string; placeholder: boolean; reconstructed: boolean;
    entries: number; dmRefs: number; referencedFrom?: string;
  }>;
  subPublications: SubPublication[];
  /** Data modules in the package that no publication places. Never dropped, never published automatically. */
  unassigned: PoolItem[];
  reusedDms: ReusedDm[];
  /** dmRefs in a PMC naming modules the package does not hold. */
  missingModules: Array<{ dmc: string; title: string; inPmc: string; generatedFrontMatter: boolean }>;
  findings: Finding[];
  summary: { errors: number; warnings: number; infos: number; repairable: number };
  repairPlan: Array<{ rule: RepairRuleId | 'orphans-pool'; title: string; defaultOn: boolean; items: number; files: number }>;
}

export interface RepairOptions {
  /** Rules to run; omitted = every rule whose `defaultOn` is true. */
  repairs?: RepairRuleId[];
  /** Put the modules no publication places into an explicit folder of the publication (otherwise they stay in the pool). */
  assembleUnassigned?: boolean;
  /** Used to title a reconstructed publication when the modules carry no usable title page. */
  projectName?: string;
  /** The S1000D issue the project builds against (`4.2`); omitted = what the modules themselves declare. */
  targetIssue?: string;
  /** Also replace a BREX reference to a custom BREX that is not in the package by the issue's default BREX. */
  neutraliseMissingBrex?: boolean;
}

export interface RepairResult {
  /** Repaired copies, keyed by package path: files whose bytes changed and files that were created. Unchanged files are absent. */
  files: Map<string, Buffer>;
  changeLog: ChangeEntry[];
  /** The publication the importer would write (null when there is nothing to write, e.g. no modules). */
  publication: AssembledPublication | null;
  placeholders: Array<{ file: string; icn: string; declaredIn: string[] }>;
  pool: PoolItem[];
  subPublications: SubPublication[];
  reusedDms: ReusedDm[];
  rulesRun: RepairRuleId[];
}

export interface AssembledPublication {
  model: PmModel;
  /** Package path of the PMC it derives from, or the file name a reconstructed one takes. */
  sourceFile: string;
  /** `full`: synthesised from the modules. `metadata`: the PMC's structure was kept, its placeholder header was rebuilt. null: as delivered. */
  reconstructed: 'full' | 'metadata' | null;
  /** Folder holding the modules assembled out of the pool, when the caller asked for that. */
  assembledPoolFolder?: string;
}
