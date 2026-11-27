// WP-12: the Platform backup panel of Administrator > Maintenance.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupApi, type BackupStatus } from '../api';
import { PlatformBackups } from './PlatformBackups';
import { cleanup, click, render, settle } from '../testing/render';

const base: BackupStatus = {
  dir: 'C:\\data\\backups\\platform', intervalHours: 24, keep: { daily: 7, weekly: 4, monthly: 12 }, restoreTestDays: 7, running: false,
  backups: [], latest: null, stale: true, state: {}, schema: { applied: 22, known: 22, latest: '022-audit-project-index' },
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('platform backup panel', () => {
  it('warns when there is no backup, and Back up now makes one and reloads the list', async () => {
    const item = { name: 'agastya-backup-20261127-080000Z-manual.zip', bytes: 2048, createdAt: '2026-11-27T08:00:00Z', kind: 'manual' as const };
    const status = vi.spyOn(backupApi, 'status').mockResolvedValueOnce(base)
      .mockResolvedValueOnce({ ...base, backups: [item], latest: { ...item, ageDays: 0 }, stale: false, state: { lastBackup: { at: item.createdAt, ok: true, name: item.name } } });
    const create = vi.spyOn(backupApi, 'create').mockResolvedValueOnce({ name: item.name, bytes: 2048, files: 10, tables: 41, createdAt: item.createdAt });
    const r = render(<PlatformBackups />); await settle();
    expect(r.container.textContent).toContain('There is no platform backup yet');
    expect(r.$('[data-testid="backup-schedule"]').textContent).toContain('every 24 hours');
    click(r.button(/Back up now/)); await settle(); await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(2);
    expect(r.container.textContent).not.toContain('There is no platform backup yet');
    expect(r.$$('[data-testid="backup-list"] tbody tr')).toHaveLength(1);
    expect(r.$<HTMLAnchorElement>('[data-testid="backup-list"] a').getAttribute('href')).toBe(`/api/admin/backups/${item.name}/download`);
  });

  it('shows a failed backup and a failed restore test', async () => {
    vi.spyOn(backupApi, 'status').mockResolvedValueOnce({ ...base, state: { lastBackup: { at: '2026-11-27T02:00:00Z', ok: false, message: 'disk full' }, lastRestoreTest: { at: '2026-11-26T02:00:00Z', ok: false, name: 'x.zip', message: 'HASH_MISMATCH' } } });
    const r = render(<PlatformBackups />); await settle();
    expect(r.container.textContent).toContain('The last backup failed');
    expect(r.container.textContent).toContain('disk full');
    expect(r.container.textContent).toContain('The last restore test of x.zip failed');
  });
});
