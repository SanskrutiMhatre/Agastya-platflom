export type Severity = 'error' | 'warning' | 'info';
export type IssueSource = 'xml' | 'xsd' | 'brex' | 'editor';

export interface ValidationIssue {
  severity: Severity;
  source: IssueSource;
  message: string;
  /** 1-based line in the serialised XML (XSD / well-formedness). */
  line?: number;
  column?: number;
  /** Model node (BREX / editor checks). */
  node?: Node | null;
  path?: string;
  ruleId?: string;
  detail?: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  xsd?: { ran: boolean; valid: boolean; schema: string; issue: string; ms: number; error?: string };
  brex?: { ran: boolean; brexDmc: string[]; rules: number; skipped: number; ms: number; notes: string[] };
  time: number;
}
