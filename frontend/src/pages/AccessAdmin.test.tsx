// WP-27: Administrator > Directory sign-on / Groups, and Project settings > Access.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accessApi, type DirectoryStatus, type ProjectAccess } from '../api';
import { DirectorySection, GroupsSection, ProjectAccessPanel } from './AccessAdmin';
import { cleanup, click, render, settle, type } from '../testing/render';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const off: DirectoryStatus = { configured: false, mode: 'local', directoryUsers: 0, mappings: [], settings: null, lastSync: null };

describe('access administration', () => {
  it('says directory sign-on is not set up, and lists the mappings', async () => {
    vi.spyOn(accessApi, 'directory').mockResolvedValueOnce({ ...off, mappings: [{ id: 'm1', group_dn: 'CN=Authors,DC=corp', global_role: 'author', group_id: null }] });
    vi.spyOn(accessApi, 'groups').mockResolvedValue([]);
    const r = render(<DirectorySection />); await settle();
    expect(r.container.textContent).toContain('Directory sign-on is not set up on this server');
    expect(r.container.textContent).toContain('CN=Authors,DC=corp');
    expect(r.$$('[data-testid="directory-test"]')).toHaveLength(0);
  });

  it('a configured directory: Sync now reports what the check did', async () => {
    const on: DirectoryStatus = { ...off, configured: true, mode: 'server', directoryUsers: 3, settings: { urls: ['ldaps://dc1:636'], baseDn: 'DC=corp', groupBaseDn: 'DC=corp', bindDn: 'CN=svc', loginAttribute: 'sAMAccountName', userObjectClass: 'user', nestedGroups: true, caFile: null, caFileReadable: null, bindPasswordFileReadable: true, syncHours: 24, timeoutMs: 10000 } };
    vi.spyOn(accessApi, 'directory').mockResolvedValue(on);
    vi.spyOn(accessApi, 'groups').mockResolvedValue([]);
    const sync = vi.spyOn(accessApi, 'syncDirectory').mockResolvedValueOnce({ checked: 3, offboarded: 1, updated: 0 });
    const r = render(<DirectorySection />); await settle();
    expect(r.container.textContent).toContain('ldaps://dc1:636');
    click(r.$('[data-testid="directory-sync"]')); await settle();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('creates a group', async () => {
    vi.spyOn(accessApi, 'groups').mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'g1', name: 'Pump', description: '', members: 0 }]);
    const r = render(<GroupsSection />); await settle();
    expect(r.container.textContent).toContain('No groups yet');
    const input = r.$<HTMLInputElement>('input[aria-label="New group name"]');
    type(input, 'Pump');
    const create = vi.spyOn(accessApi, 'createGroup').mockResolvedValueOnce({ group: { id: 'g1', name: 'Pump', description: '' } });
    click(r.button(/Create group/)); await settle(); await settle();
    expect(create).toHaveBeenCalledWith({ name: 'Pump' });
    expect(r.container.textContent).toContain('Pump');
  });

  it('a project: group grants and rules; roles above the manager are not offered', async () => {
    const pa: ProjectAccess = {
      groupGrants: [{ groupId: 'g1', name: 'Pump', role: 'editor', grantedAt: '2026-11-27T00:00:00Z' }],
      rules: [{ id: 'r1', subjectType: 'user', subjectId: 'u2', subject: 'bob', capability: 'dm.write', effect: 'deny', createdAt: '2026-11-27T00:00:00Z' }],
      groups: [{ id: 'g1', name: 'Pump', members: 2 }], capabilities: [{ capability: 'dm.write', minRole: 'editor' }], yourRole: 'manager',
    };
    vi.spyOn(accessApi, 'project').mockResolvedValueOnce(pa);
    const r = render(<ProjectAccessPanel projectId="p1" />); await settle();
    expect(r.container.textContent).toContain('Pump');
    expect(r.container.textContent).toContain('@bob');
    expect(r.container.textContent).toContain('Denied');
    const roles = [...r.$<HTMLSelectElement>('select[aria-label="Role for the group"]').options].map((o) => o.value);
    expect(roles).toEqual(['viewer', 'reviewer', 'editor', 'manager']);
  });
});
