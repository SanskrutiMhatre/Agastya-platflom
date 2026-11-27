// Adapter: Agastya V1's PmcBuilder was written against its own `pmcApi`. This
// presents the platform's project-scoped API in that shape, so the screen can be
// reused with only its import lines unchanged.

import { contentApi, type DmSummary } from './index';
import { request } from './client';
import type { PmEntry } from '../lib/pmcTree';

export interface PoolModule {
  file: string; techName?: string; infoName?: string;
  dmCode?: Record<string, string>; identExtension?: Record<string, string>;
  issueInfo?: Record<string, string>; language?: Record<string, string>; issueDate?: Record<string, string>;
}

export interface PmcModel {
  file: string; meta: Record<string, any>; entries: PmEntry[]; warnings: string[];
  counts: { folders: number; dms: number; total: number };
  /** Modules in csdb/ that the publication does not reference. */
  pool: PoolModule[];
}

const toPool = (d: DmSummary): PoolModule => ({
  file: d.file, techName: d.techName, infoName: d.infoName,
  dmCode: d.dmCodeAttrs, identExtension: d.identExtension, issueInfo: d.issueInfoAttrs, language: d.languageAttrs,
});

export const pmcApi = {
  save: async (projectId: string, model: { meta?: any; entries: PmEntry[] }, allowEmpty = false) => {
    const r = await contentApi.savePmc(projectId, { meta: model.meta, entries: model.entries }, allowEmpty);
    return { success: true, ...r };
  },
  exportUrl: (projectId: string, form: 'ietm' | 'pdf') => `/api/projects/${encodeURIComponent(projectId)}/pmc/export?form=${form}`,
  import: (projectId: string, file: File) => {
    const fd = new FormData(); fd.append('file', file);
    return request<{ counts: PmcModel['counts']; warnings: string[]; backup: string; missingModules: string[] }>('POST', `/api/projects/${encodeURIComponent(projectId)}/pmc/import`, fd);
  },
};

/** Turn a module into a dmRef entry, carrying its identity across intact. */
export function poolToEntry(m: PoolModule): PmEntry {
  return {
    type: 'dm', dmCode: m.dmCode ?? {}, identExtension: m.identExtension, issueInfo: m.issueInfo,
    language: m.language, techName: m.techName, infoName: m.infoName, issueDate: m.issueDate,
  };
}
