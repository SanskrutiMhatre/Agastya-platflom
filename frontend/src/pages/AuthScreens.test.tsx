// WP-09 (QA-016): the sign-in, first-run, onboarding and forced-change forms as components (the audit's "login/onboarding forms").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api';
import { ApiError } from '../api/client';
import { useSession } from '../store/session';
import { AuthScreens } from './AuthScreens';
import { cleanup, click, render, settle, type } from '../testing/render';

const NO_GATES = { onboarding: false, mustChangePassword: false };
const asSession = (o: Record<string, unknown>) => useSession.setState({ status: 'anon', user: null, gates: NO_GATES, signedOutReason: null, reauth: null, unreachable: false, ...o } as never);
// WP-35: the form's submit button (a password field now has its own Show button, type="button", before it)
const submit = (r: ReturnType<typeof render>) => { const f = r.$('form'); click(f.querySelector('button:not([type="button"])')!); };

beforeEach(() => { asSession({}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('sign-in', () => {
  it('sends the typed username and password; a refusal is shown and the form can be sent again', async () => {
    const login = vi.fn().mockRejectedValueOnce(new ApiError(401, 'Invalid username or password.')).mockResolvedValueOnce(undefined);
    useSession.setState({ login } as never);
    const r = render(<AuthScreens />);
    expect(r.$('h1').textContent).toMatch(/sign in/i);
    type(r.field('Username'), 'asha'); type(r.field('Password'), 'blue harbour lantern 7');
    expect(r.field('Password').type).toBe('password');
    submit(r); await settle();
    expect(login).toHaveBeenCalledWith('asha', 'blue harbour lantern 7');
    expect(r.$('[role="alert"]').textContent).toBe('Invalid username or password.');
    expect(r.button('Sign in').disabled).toBe(false);
    submit(r); await settle();
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('says why the person was signed out (UX-022)', () => {
    asSession({ signedOutReason: 'You were signed out after a period without activity.' });
    const r = render(<AuthScreens />);
    expect(r.container.textContent).toContain('You were signed out after a period without activity.');
  });

  it('forgot password: asks an administrator and shows the neutral answer', async () => {
    const forgot = vi.spyOn(authApi, 'forgot').mockResolvedValueOnce({} as never);
    const r = render(<AuthScreens />);
    click(r.button(/forgot/i));
    type(r.field('Username'), 'asha'); submit(r); await settle();
    expect(forgot).toHaveBeenCalledWith('asha');
    expect(r.container.textContent).toContain('If that account exists');
  });
});

describe('first-run setup', () => {
  it('refuses two different passwords without calling the server; otherwise creates the administrator', async () => {
    const setup = vi.fn().mockResolvedValue(undefined);
    asSession({ status: 'setup', setup });
    const r = render(<AuthScreens />);
    type(r.field('Full name'), 'Site Admin'); type(r.field('Username'), 'siteadmin');
    type(r.field('Password'), 'blue harbour lantern 7'); type(r.field('Repeat password'), 'blue harbour lantern 8');
    submit(r); await settle();
    expect(setup).not.toHaveBeenCalled();
    expect(r.$('[role="alert"]').textContent).toBe('The passwords do not match.');
    type(r.field('Repeat password'), 'blue harbour lantern 7');
    submit(r); await settle();
    expect(setup).toHaveBeenCalledWith('siteadmin', 'blue harbour lantern 7', 'Site Admin');
  });
});

describe('account gates', () => {
  it('onboarding: the username is proposed, the new password is sent, then the session is reloaded', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    asSession({ status: 'gated', gates: { onboarding: true, mustChangePassword: false }, user: { id: 'u1', username: 'asha', fullName: 'Asha Rao' }, load });
    const onboarding = vi.spyOn(authApi, 'onboarding').mockResolvedValueOnce({} as never);
    const r = render(<AuthScreens />);
    expect(r.$('h1').textContent).toBe('Welcome, Asha Rao');
    expect(r.field('Username').value).toBe('asha');
    type(r.field('New password'), 'blue harbour lantern 7'); type(r.field('Repeat password'), 'blue harbour lantern 7');
    submit(r); await settle();
    expect(onboarding).toHaveBeenCalledWith({ username: 'asha', password: 'blue harbour lantern 7' });
    expect(load).toHaveBeenCalled();
  });

  it('forced change: sends the temporary and the new password; a refusal from the server is shown', async () => {
    asSession({ status: 'gated', gates: { onboarding: false, mustChangePassword: true }, user: { id: 'u1', username: 'asha', fullName: 'Asha Rao' }, load: vi.fn() });
    const change = vi.spyOn(authApi, 'changePassword').mockRejectedValueOnce(new ApiError(400, 'Password must be at least 15 characters.'));
    const r = render(<AuthScreens />);
    expect(r.$('h1').textContent).toBe('Choose a new password');
    type(r.field('Temporary password'), 'asha-k7m2q9xw'); type(r.field('New password'), 'short'); type(r.field('Repeat password'), 'short');
    submit(r); await settle();
    expect(change).toHaveBeenCalledWith('asha-k7m2q9xw', 'short');
    expect(r.$('[role="alert"]').textContent).toBe('Password must be at least 15 characters.');
  });
});
