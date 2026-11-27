import { create } from 'zustand';
import { authApi, type AdminQueues, type Gates, type User } from '../api';
import { ApiError, setReauthHandler, setUnauthorizedHandler } from '../api/client';
import { useInbox } from './inbox';
import { purgeDraftsOf } from '../lib/draftPurge';

type Status = 'loading' | 'setup' | 'anon' | 'gated' | 'authed';

interface SessionState {
  status: Status;
  user: User | null;
  gates: Gates;
  pendingInvitations: number;
  adminQueues: AdminQueues | null;
  /** Why the person was signed out, as the server said it (another sign-in, idle, time limit, disabled); shown on the sign-in page (UX-022). */
  signedOutReason: string | null;
  /** FE-003: the session ended while the person was working. The page stays as it is; a sign-in dialog is shown over it. */
  reauth: { reason: string } | null;
  /** FE-004: the server did not answer (restart, network, sleep). The person stays signed in; a banner says it is retrying. */
  unreachable: boolean;
  /** Resolve who is signed in (or whether first-run setup is needed). Called once at boot and after any auth change. */
  load: (o?: { ttl?: number }) => Promise<void>;
  /** Background check (every minute): a 401 opens the re-login dialog; a network error shows the banner. Not activity. */
  check: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  clear: () => void;
  /** Sign in again from the re-login dialog: the requests that met the 401 are sent again. */
  resume: (password: string) => Promise<void>;
  /** Give up from the re-login dialog: sign out for real (unsaved work in the editors stays in this person's drafts). */
  abandon: () => void;
}

const NO_GATES: Gates = { onboarding: false, mustChangePassword: false };

/** Told when the signed-in person changes: `explicit` is a sign-out the person chose (drafts may go too), not an ended session. */
type SignedOut = (explicit: boolean) => void;
const signedOutListeners = new Set<SignedOut>();
export const onSignedOut = (fn: SignedOut): (() => void) => { signedOutListeners.add(fn); return () => signedOutListeners.delete(fn); };
const tellSignedOut = (explicit: boolean) => { for (const fn of signedOutListeners) { try { fn(explicit); } catch { /* a listener's failure must not keep the session */ } } };

const reasonOf = (e: unknown) => (e instanceof ApiError && /^(SESSION_|ACCOUNT_)/.test(e.code ?? '') ? e.message : null);

/** The one pending re-login: every request that met a 401 meanwhile waits for the same answer. */
let waiting: { promise: Promise<boolean>; resolve: (ok: boolean) => void } | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading', user: null, gates: NO_GATES, pendingInvitations: 0, adminQueues: null, signedOutReason: null, reauth: null, unreachable: false,

  async load(o) {
    try {
      const me = await authApi.me({ ttl: o?.ttl ?? 0 });      // only the navigation refresh reuses a recent answer (WP-18); a request in flight is still shared
      const gated = me.gates.onboarding || me.gates.mustChangePassword;
      const prev = get().user;
      if (prev && prev.id !== me.user.id) tellSignedOut(false);
      set({ status: gated ? 'gated' : 'authed', user: me.user, gates: me.gates, pendingInvitations: me.pendingInvitations, adminQueues: me.adminQueues ?? null, signedOutReason: null, unreachable: false });
      retryDelay = 2000;
    } catch (e) {
      // FE-004: only the server saying "not signed in" (401) signs anyone out. A network error or a 5xx keeps the person and their page.
      if (!(e instanceof ApiError) || e.status !== 401) {
        set({ unreachable: true });
        if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; void get().load(); }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
        return;
      }
      set({ unreachable: false });
      const s = get();
      if (s.status === 'authed' && s.user) { set({ reauth: { reason: reasonOf(e) ?? 'Your session has ended.' } }); return; }
      const reason = reasonOf(e);
      const setupNeeded = await authApi.setupRequired().catch(() => ({ setupRequired: false }));
      set({ status: setupNeeded.setupRequired ? 'setup' : 'anon', user: null, gates: NO_GATES, adminQueues: null, ...(reason ? { signedOutReason: reason } : {}) });
    }
  },

  async check() {
    try { await authApi.check(); if (get().unreachable) set({ unreachable: false }); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { if (get().status === 'authed') set({ reauth: { reason: reasonOf(e) ?? 'Your session has ended.' } }); }
      else set({ unreachable: true });
    }
  },

  async login(username, password) { await authApi.login(username, password); set({ signedOutReason: null }); await get().load(); },
  async setup(username, password, fullName) { await authApi.setup({ username, password, fullName }); await get().load(); },
  async logout() {
    const me = get().user;
    try { await authApi.logout(); } finally {
      tellSignedOut(true);
      if (me) await purgeDraftsOf(me.id).catch(() => 0);          // FE-024: whatever page this was, the person's drafts go with them
      get().clear(); await get().load();
    }
  },
  clear() {
    useInbox.getState().reset();
    if (waiting) { waiting.resolve(false); waiting = null; }
    if (get().user) tellSignedOut(false);
    set({ user: null, gates: NO_GATES, adminQueues: null, status: 'anon', reauth: null });
  },

  async resume(password) {
    const u = get().user;
    if (!u) throw new Error('Nobody is signed in.');
    await authApi.login(u.username, password);
    set({ reauth: null, signedOutReason: null });
    const w = waiting; waiting = null;
    w?.resolve(true);
    await get().load();
  },

  abandon() {
    const r = get().reauth?.reason ?? null;
    get().clear();
    set({ signedOutReason: r });
    void get().load();
  },
}));

/** Show the re-login dialog (once) and return the promise every waiting request shares. */
function startReauth(): Promise<boolean> {
  const s = useSession.getState();
  if (s.status !== 'authed' || !s.user) return Promise.resolve(false);
  if (!waiting) {
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => { resolve = r; });
    waiting = { promise, resolve };
    // Ask the server why (displaced, idle, time limit, disabled) for the dialog's wording; load() sets `reauth`.
    if (!s.reauth) useSession.setState({ reauth: { reason: 'Your session has ended.' } });
    void s.load();
  }
  return waiting.promise;
}

// A 401 while someone is signed in: keep the page, ask them to sign in again, then send the request again (FE-003).
setReauthHandler(startReauth);
// A 401 the client cannot replay (the WebSocket, an upload, /api/auth/*): the same dialog, nothing waits on it.
setUnauthorizedHandler(() => {
  const s = useSession.getState();
  if (s.status === 'authed') void startReauth();
  else if (s.status === 'gated') { s.clear(); void s.load(); }
});
