// Brand packs (backend/src/routes/brand.ts): a logo and a company line for the page furniture, installed in the workspace's templates/brand folder.
// A project stores its choice as `brandPack` in project.json; empty means "use the template's default".

import { get } from './client';

export interface BrandPack { id: string; name: string; company: string; hasLogo: boolean }

export const brandApi = {
  list: () => get<{ packs: BrandPack[] }>('/api/brand-packs').then((r) => r.packs),
  /** The logo needs the session cookie, so it is shown with an <img> pointing at this relative URL. */
  logoUrl: (id: string) => `/api/brand-packs/${encodeURIComponent(id)}/logo`,
};
