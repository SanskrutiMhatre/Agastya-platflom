// WP-28 (PRD-003): the editor's team chip and the Project Home's "Working now" card: presence is announced over the socket, the other
// people are shown, the open document's check-out can be taken, given back and (by an owner) broken, and a release notice reaches the author.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { cleanup, click, render, settle } from '../../testing/render';
import type { ProgressMsg } from '../../lib/progress';

const sent: Array<Record<string, unknown>> = [];
const listeners = new Set<(m: ProgressMsg) => void>();
vi.mock('../../lib/progress', () => ({
  sendPresence: (m: Record<string, unknown>) => { sent.push(m); },
  subscribe: (l: (m: ProgressMsg) => void) => { listeners.add(l); return () => listeners.delete(l); },
}));
const api = { leases: [] as unknown[], people: [] as unknown[], posts: [] as string[], dels: [] as string[] };
vi.mock('../../api/client', () => ({
  get: async (url: string) => (url.endsWith('/presence') ? { people: api.people, leases: [] } : { leases: api.leases }),
  post: async (url: string) => { api.posts.push(url); api.leases = [{ part: '', holderId: 'me', holder: 'me', expiresAt: '2026-11-27T15:00:00Z', mine: true }]; return {}; },
  del: async (url: string) => { api.dels.push(url); api.leases = []; return {}; },
}));
const toasts: string[] = [];
vi.mock('../../store/ui', () => ({ useUi: (sel: (s: { toast: (m: string) => void }) => unknown) => sel({ toast: (m: string) => { toasts.push(m); } }) }));

import { TeamChip } from './TeamChip';
import { WorkingNow } from '../../components/WorkingNow';
import { activityText, baseName, initials, noticeIsFor } from '../../lib/presence';

const P = 'p1';
const FILE = 'DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML';
const doc = { kind: 'dm' as const, path: FILE, title: 'Pump description', leases: `/api/projects/${P}/dms/${FILE}/checkout`, checkout: `/api/projects/${P}/dms/${FILE}/checkout` };
const ada = { userId: 'u2', username: 'ada', name: 'Ada Lovelace', doc: { kind: 'dm', path: FILE, title: 'Pump description' }, mode: 'editing', since: '', lastSeen: '', mine: false };

beforeEach(() => { sent.length = 0; toasts.length = 0; listeners.clear(); Object.assign(api, { leases: [], people: [], posts: [], dels: [] }); });
afterEach(() => { cleanup(); });

describe('presence helpers', () => {
  it('names, paths and notices', () => {
    expect(initials('Ada Lovelace')).toBe('AL'); expect(initials('bob')).toBe('BO');
    expect(baseName('csdb/DMC-A.XML')).toBe('DMC-A.XML'); expect(baseName('jss\\book.xml')).toBe('book.xml');
    expect(noticeIsFor({ kind: 'dm', path: 'DMC-A.XML' }, 'csdb/dmc-a.xml')).toBe(true);
    expect(noticeIsFor({ kind: 'dm', path: 'DMC-A.XML' }, 'csdb/DMC-B.XML')).toBe(false);
    expect(noticeIsFor({ kind: 'jss', path: 'jss-document' }, 'jss\\source.xml')).toBe(true);
    expect(noticeIsFor({ kind: 'jss', path: 'jss-document' }, 'csdb/DMC-B.XML')).toBe(false);
    expect(activityText(ada as never)).toBe('editing Pump description');
    expect(activityText({ ...ada, doc: null } as never)).toBe('in the project');
  });
});

describe('team chip', () => {
  it('announces the open document, shows the others, checks out and in', async () => {
    api.people = [ada, { ...ada, userId: 'me', name: 'Me Myself', mine: true }];
    const r = render(<TeamChip projectId={P} doc={doc} writable canBreak={false} editing />); await settle();
    expect(sent[0]).toEqual({ projectId: P, doc: { kind: 'dm', path: FILE, title: 'Pump description' }, mode: 'editing' });
    expect(r.$('[data-testid="team-faces"]').textContent).toBe('AL');   // only the others, Ada is on this document
    expect(r.$('.v2-face').className).toContain('is-here');
    click(r.$('[data-testid="lease-checkout"]')); await settle(); await settle();
    expect(api.posts).toEqual([doc.checkout]);
    expect(r.$('[data-testid="lease-mine"]').textContent).toContain('Checked out by you');
    click(r.$('[data-testid="lease-checkin"]')); await settle(); await settle();
    expect(api.dels).toEqual([doc.checkout]);
    r.unmount();
    expect(sent[sent.length - 1]).toEqual({ projectId: null });
  });

  it('shows another author\'s check-out, breaks it for an owner, and tells the author when it is given back', async () => {
    api.leases = [{ part: '', holderId: 'u2', holder: 'ada', expiresAt: '2026-11-27T15:00:00Z', mine: false }];
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const r = render(<TeamChip projectId={P} doc={doc} writable canBreak editing={false} />); await settle();
    expect(r.$('[data-testid="lease-other"]').textContent).toContain('Checked out by ada');
    expect(r.$$('[data-testid="lease-checkout"]')).toHaveLength(0);
    // ada checks in elsewhere: the notice arrives over the socket
    api.leases = [];
    act(() => { for (const l of listeners) l({ type: 'leases', projectId: P, path: `csdb/${FILE}`, part: '', holder: 'ada', released: true, broken: false }); });
    await settle(); await settle();
    expect(toasts.some((t) => /ada checked in Pump description/.test(t))).toBe(true);
    expect(r.$('[data-testid="lease-checkout"]')).toBeTruthy();
    // and an owner can break a check-out
    api.leases = [{ part: '', holderId: 'u2', holder: 'ada', expiresAt: '2026-11-27T15:00:00Z', mine: false }];
    act(() => { for (const l of listeners) l({ type: 'leases', projectId: P, path: `csdb/${FILE}`, part: '', holder: 'ada', released: false }); });
    await settle(); await settle();
    click(r.$('[data-testid="lease-break"]')); await settle();
    expect(confirm).toHaveBeenCalled();
    expect(api.dels).toEqual([`${doc.checkout}?break=1`]);
    confirm.mockRestore();
  });
});

describe('working now', () => {
  it('lists the others and the check-outs of the project', async () => {
    api.people = [ada];
    const r = render(<WorkingNow projectId={P} format="s1000d" canBreak={false} />); await settle();
    expect(sent[0]).toEqual({ projectId: P, doc: null, mode: 'viewing' });
    expect(r.$('[data-testid="home-team-people"]').textContent).toContain('Ada Lovelace');
    expect(r.$('[data-testid="home-team-people"]').textContent).toContain('editing Pump description');
    expect(r.$('[data-testid="home-team-noleases"]')).toBeTruthy();
  });
});
