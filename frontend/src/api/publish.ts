// Adapter for the reused PmcBuilder: it asks `publishApi.buildProject` for a build.
import { contentApi } from './index';

export const publishApi = {
  buildProject: async (projectId: string, compression?: number): Promise<{ totalMs?: number; bytes: number }> => {
    const r = await contentApi.build(projectId, compression) as { totalMs?: number; bytes?: number };
    return { totalMs: r.totalMs, bytes: r.bytes ?? 0 };
  },
};
