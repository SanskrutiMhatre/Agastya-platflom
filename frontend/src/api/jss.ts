// Calls for JSS authoring (backend/src/routes/jss.ts). The document is one XML file per project; the server validates it against jss-1.0.xsd and the stencil's rules.

import { get, post, put } from './client';

export interface JssFinding { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }
export interface JssReport { docType: string | null; valid: boolean; errors: number; warnings: number; findings: JssFinding[]; validatedAt: string }
export interface JssDocument { docType: string | null; label: string | null; bodyKind: string | null; stencil: string | null; chapters: string[]; maxDepth: number; xml: string; hash: string; report: JssReport }
export interface JssType { id: string; label: string; stencil: string; bodyKind: string; ready: boolean; notReady?: string; chapters: string[]; maxDepth: number }

const P = (id: string) => `/api/projects/${id}/jss`;

export const jssApi = {
  types: () => get<{ types: JssType[] }>('/api/jss/types').then((r) => r.types),
  read: (id: string) => get<JssDocument>(P(id)),
  save: (id: string, xml: string, baseHash?: string) => put<{ hash: string; report: JssReport }>(P(id), { xml, baseHash }),
  validate: (id: string, xml?: string) => post<JssReport>(`${P(id)}/validate`, xml === undefined ? {} : { xml }),
};
