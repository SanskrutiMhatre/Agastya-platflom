import { create } from 'zustand';
import { authApi, type AdminQueues, type Gates, type User } from '../api';
import { setUnauthorizedHandler } from '../api/client';
import { useInbox } from './inbox';

type Status = 'loading' | 'setup' | 'anon' | 'gated' | 'authed';

interface SessionState {
  status: Status;
  user: User | null;
  gates: Gates;
  pendingInvitations: number;
  adminQueues: AdminQueues | null;
  /** Resolve who is signed in (or whether first-run setup is needed). Called once at boot and after any auth change. */
  load: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  clear: () => void;
}

const NO_GATES: Gates = { onboarding: false, mustChangePassword: false };

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading', user: null, gates: NO_GATES, pendingInvitations: 0, adminQueues: null,

  async load() {
    try {
      const me = await authApi.me();
      const gated = me.gates.onboarding || me.gates.mustChangePassword;
      set({ status: gated ? 'gated' : 'authed', user: me.user, gates: me.gates, pendingInvitations: me.pendingInvitations, adminQueues: me.adminQueues ?? null });
    } catch {
      const s = await authApi.setupRequired().catch(() => ({ setupRequired: false }));
      set({ status: s.setupRequired ? 'setup' : 'anon', user: null, gates: NO_GATES, adminQueues: null });
    }
  },

  async login(username, password) { await authApi.login(username, password); await get().load(); },
  async setup(username, password, fullName) { await authApi.setup({ username, password, fullName }); await get().load(); },
  async logout() { try { await authApi.logout(); } finally { get().clear(); await get().load(); } },
  clear() { useInbox.getState().reset(); set({ user: null, gates: NO_GATES, adminQueues: null, status: 'anon' }); },
}));

// A 401 from anywhere means the session is gone (expired, revoked, or displaced by a newer sign-in).
setUnauthorizedHandler(() => {
  const s = useSession.getState();
  if (s.status === 'authed' || s.status === 'gated') { s.clear(); void s.load(); }
});
