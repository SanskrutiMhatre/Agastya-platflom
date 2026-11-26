// Calls for the cross-engine layer (backend/src/routes/identity.ts, routes/xengine.ts): the S1000D metadata a JSS / JSG project keeps in the backend, and conversion between formats.

import { get, put, post, request } from './client';
import type { ProjectCard } from './index';

export type Format = 's1000d' | 'jss' | 'jsg';
export type Origin = 'generated' | 'imported';

export interface DocCodesShow { dmc: boolean; pmc: boolean; icn: boolean; toc: boolean }
export interface DocCodes {
  format: 'jss' | 'jsg'; modelIdentCode: string; systemDiffCode: string; show: DocCodesShow;
  pmc: { code: string; file: string; title: string; issue: string; language: string; pmIssuer: string; pmNumber: string; pmVolume: string; origin: Origin };
  modules: Array<{ key: string; chapter: number; title: string; kind: string; dmc: string; file: string; origin: Origin; source?: string }>;
  pictures: Array<{ file: string; icn: string; packageFile: string; module: string; origin: Origin }>;
  toc: Array<{ level: number; number: string; title: string; dmc: string | null }>;
  counts: { modules: number; pictures: number; retired: number; imported: number };
}
export interface DocCodesPatch { modelIdentCode?: string; systemDiffCode?: string; pmIssuer?: string; pmNumber?: string; pmVolume?: string; languageIsoCode?: string; countryIsoCode?: string; title?: string }

export interface XFinding { severity: 'error' | 'warning' | 'info'; code: string; message: string; where?: string }
export interface ConvertResult {
  ok: true; from: Format; to: Format; project: ProjectCard; findings: XFinding[];
  counts: { chapters: number; sections: number; pictures: number };
  identity?: { modelIdentCode: string; modules: number; pictures: number; imported: number };
  imported?: { dms: number; media: number; withProblems: number };
  /** A project archive that came back as itself: how many files and review comments were restored. */
  restored?: { files: number; comments: number };
}
export interface Conversion { from: Format; to: Format; how: string }

export const FORMAT_LABEL: Record<Format, string> = { s1000d: 'S1000D', jss: 'JSS', jsg: 'JSG' };

export const xengineApi = {
  codes: (id: string) => get<{ ok: true; identity: DocCodes }>(`/api/projects/${id}/identity`).then((r) => r.identity),
  setCodes: (id: string, patch: DocCodesPatch) => put<{ ok: true; identity: DocCodes }>(`/api/projects/${id}/identity`, patch).then((r) => r.identity),
  setShow: (id: string, show: Partial<DocCodesShow>) => put<{ ok: true; identity: DocCodes }>(`/api/projects/${id}/identity/visibility`, show).then((r) => r.identity),
  conversions: () => get<{ ok: true; conversions: Conversion[] }>('/api/xengine/formats').then((r) => r.conversions),
  convert: (id: string, to: Format, name?: string) => post<ConvertResult>(`/api/projects/${id}/convert`, { to, name }),
  /** A package or document imported as a new project of another (or the same) format. `where`: the folder, and the domain and manual type of the new JSS / JSG project. */
  importAs: (file: File, source: Format | 'auto', target: Format, name?: string, where: { folder?: string; domain?: string; manualType?: string } = {}) => {
    const fd = new FormData(); fd.append('file', file); fd.append('source', source); fd.append('target', target); if (name) fd.append('name', name);
    for (const [k, v] of Object.entries(where)) if (v) fd.append(k, v);
    return request<ConvertResult>('POST', '/api/xengine/import', fd);
  },
};
