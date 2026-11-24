// The import and export reports.
//
// `message` is written for the person using the JSS editor: it speaks of sections, pictures, tables and "the package", never of data module codes or S1000D.
// `code` and `detail` are for the technical report (a file kept with the project and written into an export) and for tests.

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  /** a stable identifier, e.g. "picture-missing" */
  code: string;
  /** plain language */
  message: string;
  /** where: a section title, a table caption, a file name */
  where?: string;
  /** technical detail (codes, file names, schema text) for the technical report */
  detail?: string;
}

export interface ImportCounts {
  chapters: number; sections: number; paragraphs: number; lists: number; tables: number; figures: number;
  pictures: number; picturesMissing: number; picturesUnused: number; documents: number; documentsPlacedByNumber: number;
}

export interface ImportReport {
  ok: true;
  /** the package's own name for itself (its top folder), for the summary line */
  packageName: string;
  counts: ImportCounts;
  findings: Finding[];
  importedAt: string;
}

export const emptyCounts = (): ImportCounts => ({ chapters: 0, sections: 0, paragraphs: 0, lists: 0, tables: 0, figures: 0, pictures: 0, picturesMissing: 0, picturesUnused: 0, documents: 0, documentsPlacedByNumber: 0 });

export class Findings {
  readonly list: Finding[] = [];
  add(severity: Severity, code: string, message: string, where?: string, detail?: string): void {
    // the same message for the same place is reported once
    if (this.list.some((f) => f.code === code && f.message === message && f.where === where)) return;
    this.list.push({ severity, code, message, ...(where ? { where } : {}), ...(detail ? { detail } : {}) });
  }
  get errors(): number { return this.list.filter((f) => f.severity === 'error').length; }
  get warnings(): number { return this.list.filter((f) => f.severity === 'warning').length; }
}

export interface ExportReport {
  ok: true;
  fileName: string;
  counts: { documents: number; chapters: number; pictures: number; picturesMissing: number; documentsKept: number; documentsRebuilt: number };
  findings: Finding[];
}
