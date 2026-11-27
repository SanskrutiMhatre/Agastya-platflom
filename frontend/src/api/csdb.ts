// Client for the CSDB object read/save the Studio uses, the extension profiles (Administrator) and the type coverage table. WP-13 removed the
// wrappers of the Files (CSDB) page, lifecycle, CIR links, packages and HTML publication: nothing called them (their routes stay as API-only).
import { del, get, post, put, request } from './client';

export interface ExtProfile { id: string; name: string; namespace: string; description: string; enabled?: boolean; projects?: number; xsdName?: string }
export interface CoverageRow { schema: string; name: string; category: string; filePrefix: string | null; root: Record<string, string | null>; xsd: Record<string, boolean>; authored: boolean }

const P = (id: string) => `/api/projects/${id}`;
export const csdbApi = {
  readObject: (id: string, file: string) => get<{ file: string; xml: string; hash: string }>(`${P(id)}/objects/${encodeURIComponent(file)}`),
  saveObject: (id: string, file: string, xml: string, baseHash: string) => put<{ file: string; hash: string }>(`${P(id)}/objects/${encodeURIComponent(file)}`, { xml, baseHash }),
  adminExtensions: () => get<{ profiles: ExtProfile[] }>('/api/admin/extensions'),
  registerExtension: (b: { name: string; namespace: string; description?: string; xsd: string; xsdName?: string }) => post<ExtProfile>('/api/admin/extensions', b),
  deleteExtension: (id: string) => del(`/api/admin/extensions/${id}`),
  coverage: () => get<{ rows: CoverageRow[] }>('/api/s1000d/coverage'),
};
