// WP-09 (QA-016): the zustand stores as units - the session state machine (sign-in, gates, a 401 while working, the server
// not answering, sign-out), the UI store (theme, toasts) and the inbox. The API is replaced by spies on the real client objects.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi, notifyApi } from '../api';
import { ApiError } from '../api/client';
import { onSignedOut, useSession } from './session';
import { applyTheme, initialTheme, useUi } from './ui';
import { useInbox } from './inbox';

const user = (id = 'u1', username = 'asha') => ({ id, username, fullName: 'Asha Rao', role: 'author' }) as never;
const me = (o: Record<string, unknown> = {}) => ({ user: user(), gates: { onboarding: false, mustChangePassword: false }, pendingInvitations: 0, ...o }) as never;
const fresh = () => useSession.setState({ status: 'loading', user: null, gates: { onboarding: false, mustChangePassword: false }, reauth: null, unreachable: false, signedOutReason: null, adminQueues: null, pendingInvitations: 0 });

beforeEach(() => { fresh(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('session store', () => {
  it('load: a signed-in person is "authed"; a gate makes it "gated"', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValueOnce(me({ pendingInvitations: 2 }));
    await useSession.getState().load();
    expect(useSession.getState()).toMatchObject({ status: 'authed', pendingInvitations: 2, unreachable: false });
    vi.spyOn(authApi, 'me').mockResolvedValueOnce(me({ gates: { onboarding: false, mustChangePassword: true } }));
    await useSession.getState().load();
    expect(useSession.getState().status).toBe('gated');
  });

  it('load: a 401 with nobody signed in goes to sign-in (or first-run setup) and keeps the reason the server gave', async () => {
    vi.spyOn(authApi, 'me').mockRejectedValue(new ApiError(401, 'You were signed out after a period without activity.', 'SESSION_IDLE'));
    vi.spyOn(authApi, 'setupRequired').mockResolvedValueOnce({ setupRequired: false });
    await useSession.getState().load();
    expect(useSession.getState()).toMatchObject({ status: 'anon', user: null, signedOutReason: 'You were signed out after a period without activity.' });
    fresh();
    vi.spyOn(authApi, 'setupRequired').mockResolvedValueOnce({ setupRequired: true });
    await useSession.getState().load();
    expect(useSession.getState().status).toBe('setup');
  });

  it('load: a 401 while working keeps the page and the person, and asks to sign in again (FE-003)', async () => {
    useSession.setState({ status: 'authed', user: user() });
    vi.spyOn(authApi, 'me').mockRejectedValueOnce(new ApiError(401, 'An administrator ended your session.', 'SESSION_REVOKED'));
    await useSession.getState().load();
    expect(useSession.getState()).toMatchObject({ status: 'authed', reauth: { reason: 'An administrator ended your session.' } });
    expect(useSession.getState().user).not.toBeNull();
  });

  it('load: the server not answering (network error, 5xx) keeps the person signed in and shows the banner (FE-004)', async () => {
    vi.useFakeTimers();
    useSession.setState({ status: 'authed', user: user() });
    vi.spyOn(authApi, 'me').mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(me());
    await useSession.getState().load();
    expect(useSession.getState()).toMatchObject({ status: 'authed', unreachable: true });
    await vi.advanceTimersByTimeAsync(2100);                              // the retry
    expect(useSession.getState().unreachable).toBe(false);
  });

  it('check: the background check turns a 401 into the re-login dialog, and is not a sign-out', async () => {
    useSession.setState({ status: 'authed', user: user() });
    vi.spyOn(authApi, 'check').mockRejectedValueOnce(new ApiError(401, 'Your session reached its time limit.', 'SESSION_EXPIRED'));
    await useSession.getState().check();
    expect(useSession.getState()).toMatchObject({ status: 'authed', reauth: { reason: 'Your session reached its time limit.' } });
  });

  it('logout: tells the listeners it was the person\'s own choice, empties the inbox and ends up signed out', async () => {
    useSession.setState({ status: 'authed', user: user() });
    useInbox.setState({ unread: 3, items: [], loaded: true });
    const heard: boolean[] = []; const off = onSignedOut((explicit) => heard.push(explicit));
    vi.spyOn(authApi, 'logout').mockResolvedValueOnce(undefined as never);
    vi.spyOn(authApi, 'me').mockRejectedValue(new ApiError(401, 'Authentication required.', 'UNAUTHENTICATED'));
    vi.spyOn(authApi, 'setupRequired').mockResolvedValue({ setupRequired: false });
    await useSession.getState().logout();
    off();
    expect(heard[0]).toBe(true);
    expect(useInbox.getState().unread).toBe(0);
    expect(useSession.getState()).toMatchObject({ status: 'anon', user: null });
  });

  it('a different person signing in on the same page is a sign-out of the previous one (drafts stay theirs)', async () => {
    useSession.setState({ status: 'authed', user: user('u1', 'asha') });
    const heard: boolean[] = []; const off = onSignedOut((explicit) => heard.push(explicit));
    vi.spyOn(authApi, 'me').mockResolvedValueOnce(me({ user: user('u2', 'ravi') }));
    await useSession.getState().load();
    off();
    expect(heard).toEqual([false]);
    expect(useSession.getState().user).toMatchObject({ username: 'ravi' });
  });

  it('resume: signing in again from the dialog closes it; abandon signs out and keeps the reason for the sign-in page', async () => {
    useSession.setState({ status: 'authed', user: user(), reauth: { reason: 'Your session has ended.' } });
    const login = vi.spyOn(authApi, 'login').mockResolvedValueOnce({} as never);
    vi.spyOn(authApi, 'me').mockResolvedValueOnce(me());
    await useSession.getState().resume('blue harbour lantern 7');
    expect(login).toHaveBeenCalledWith('asha', 'blue harbour lantern 7');
    expect(useSession.getState().reauth).toBeNull();
    useSession.setState({ reauth: { reason: 'You were signed out because this account signed in on another computer or browser.' } });
    vi.spyOn(authApi, 'me').mockRejectedValue(new ApiError(401, 'Authentication required.'));
    vi.spyOn(authApi, 'setupRequired').mockResolvedValue({ setupRequired: false });
    useSession.getState().abandon();
    expect(useSession.getState()).toMatchObject({ user: null, signedOutReason: 'You were signed out because this account signed in on another computer or browser.' });
  });
});

describe('ui store', () => {
  beforeEach(() => { useUi.setState({ toasts: [] }); localStorage.clear(); });

  it('setTheme remembers light/dark and sets the page theme; there is no "system" theme and the OS is not followed', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} }));
    useUi.getState().setTheme('light');
    expect(localStorage.getItem('agastya.theme')).toBe('light'); expect(document.documentElement.dataset.theme).toBe('light');
    useUi.getState().setTheme('dark');
    expect(localStorage.getItem('agastya.theme')).toBe('dark'); expect(document.documentElement.dataset.theme).toBe('dark');
    // a new person: light, even though the OS prefers dark in this stub
    localStorage.clear();
    expect(initialTheme()).toBe('light');
    // the organisation default decides until the person picks (TH-008)
    localStorage.setItem('agastya.theme.default', 'dark');
    expect(initialTheme()).toBe('dark');
    // an old stored "system" is not a choice: it is cleared and the default applies
    localStorage.setItem('agastya.theme', 'system'); localStorage.setItem('agastya.theme.default', 'light');
    expect(initialTheme()).toBe('light');
    expect(localStorage.getItem('agastya.theme')).toBeNull();
    applyTheme('dark'); expect(document.documentElement.dataset.theme).toBe('dark');
    vi.unstubAllGlobals();
  });

  it('toasts: newest last, at most four, dismissed by id', () => {
    const { toast } = useUi.getState();
    for (const t of ['a', 'b', 'c', 'd', 'e']) toast(t);
    toast('boom', 'error');
    expect(useUi.getState().toasts.map((t) => t.text)).toEqual(['c', 'd', 'e', 'boom']);
    expect(useUi.getState().toasts.at(-1)?.kind).toBe('error');
    useUi.getState().dismiss(useUi.getState().toasts[0].id);
    expect(useUi.getState().toasts.map((t) => t.text)).toEqual(['d', 'e', 'boom']);
  });
});

describe('inbox store', () => {
  beforeEach(() => { useInbox.getState().reset(); });

  it('the badge count survives a failed refresh; markRead takes the server\'s answer; reset empties it', async () => {
    vi.spyOn(notifyApi, 'unread').mockResolvedValueOnce(5).mockRejectedValueOnce(new Error('offline'));
    await useInbox.getState().refreshCount(); expect(useInbox.getState().unread).toBe(5);
    await useInbox.getState().refreshCount(); expect(useInbox.getState().unread).toBe(5);
    vi.spyOn(notifyApi, 'markRead').mockResolvedValueOnce({ unread: 0, items: [] } as never);
    await useInbox.getState().markRead();
    expect(useInbox.getState()).toMatchObject({ unread: 0, loaded: true });
    useInbox.setState({ unread: 9 }); useInbox.getState().reset();
    expect(useInbox.getState()).toMatchObject({ unread: 0, items: [], loaded: false });
  });
});
