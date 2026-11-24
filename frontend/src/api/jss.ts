// Calls for JSS authoring (backend/src/routes/jss.ts). The document is one XML file per project; the server validates it against jss-1.0.xsd and the stencil's rules.

import { get, post, put } from './client';

export interface JssFinding { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }
export interface JssReport { docType: string | null; valid: boolean; errors: number; warnings: number; findings: JssFinding[]; validatedAt: string }
import type { OutlineNode, TableTemplate } from '../jss/model';

export interface JssDocument {
  docType: string | null; label: string | null; bodyKind: string | null; stencil: string | null; chapters: string[]; maxDepth: number; xml: string; hash: string; report: JssReport;
  /** 'land' | 'naval' */
  domain?: string | null;
  /** 'free': the chapters are the author's (Part IV of the Naval technical manual); 'fixed': the stencil names them */
  chapterRule?: 'fixed' | 'free';
  /** the stencil also fixes the sections under each chapter */
  sectionsFixed?: boolean;
  /** the page the body is set on when it is not portrait */
  bodyPage?: 'landscape' | 'a3-landscape' | null;
  /** the tables the stencil fixes (columns, head, caption, the section each belongs under) */
  tableTemplates?: TableTemplate[];
  /** the first chapter of the stencil, what a new chapter of a free-chapter type starts from */
  chapterStarter?: OutlineNode | null;
}
export interface JssType { id: string; label: string; stencil: string; bodyKind: string; domain?: string; ready: boolean; notReady?: string; chapters: string[]; maxDepth: number }

const P = (id: string) => `/api/projects/${id}/jss`;

export const jssApi = {
  types: () => get<{ types: JssType[] }>('/api/jss/types').then((r) => r.types),
  read: (id: string) => get<JssDocument>(P(id)),
  save: (id: string, xml: string, baseHash?: string) => put<{ hash: string; report: JssReport }>(P(id), { xml, baseHash }),
  validate: (id: string, xml?: string) => post<JssReport>(`${P(id)}/validate`, xml === undefined ? {} : { xml }),
};
