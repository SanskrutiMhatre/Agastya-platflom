// Publish waivers (backend/src/routes/waivers.ts): a recorded decision to build DRAFT copies without a BREX the project does not have.
// An editor or above records and withdraws them; anyone who can see the project reads them. They never apply to a release.

import { del, get, post } from './client';

export type WaiverKind = 'brex-missing';
export interface Waiver { id: string; kind: WaiverKind; subject: string; reason: string; by: string; at: string }

const P = (id: string) => `/api/projects/${id}/publish-waivers`;

export const waiverApi = {
  list: (id: string) => get<{ waivers: Waiver[]; kinds: WaiverKind[]; note: string }>(P(id)),
  add: (id: string, b: { kind: WaiverKind; subject: string; reason: string }) => post<{ waiver: Waiver }>(P(id), b).then((r) => r.waiver),
  remove: (id: string, waiverId: string) => del<{ ok: true }>(`${P(id)}/${encodeURIComponent(waiverId)}`),
};
