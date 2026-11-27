// Adapter: the shape Agastya V1's PublishSettings screen was written against,
// served by the platform's project-scoped settings API.

import { contentApi } from './index';
import { request } from './client';

export interface CataloguePage { id: string; label: string; title: string | null; generated: boolean; required: boolean }
export interface SettingsPayload { projectId: string; templateRef: string; house: any; project: any; frontMatterCatalogue: CataloguePage[]; templates?: string[]; canEditHouse?: boolean; /** WP-11: the version a save names */ version: string }

export const settingsApi = {
  get: (projectId: string): Promise<SettingsPayload> => contentApi.settings(projectId),
  /** `baseHash`: the `version` of the settings the screen loaded; the answer carries the new one. */
  save: (projectId: string, body: { house?: any; project?: any; baseHash: string }) => contentApi.saveSettings(projectId, body),
  media: async (projectId: string): Promise<string[]> => (await contentApi.media(projectId)).filter((m) => m.dir === 'Media').map((m) => `Media/${m.name}`),
  /** Browser-loadable URL for a stored `Media/x.png` path. */
  mediaUrl: (projectId: string, mediaPath: string) => contentApi.mediaUrl(projectId, mediaPath.replace(/^Media\//, '')),
  upload: async (projectId: string, file: File): Promise<{ path: string }> => {
    const r = await contentApi.uploadMedia(projectId, file);
    return { path: r.path };
  },
};

void request;
