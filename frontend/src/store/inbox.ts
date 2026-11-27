import { create } from 'zustand';
import { notifyApi, type Notice } from '../api';

interface InboxState {
  unread: number;
  items: Notice[];
  loaded: boolean;
  /** Cheap count for the badge; the full list is fetched only on the Notifications page. */
  refreshCount: (o?: { ttl?: number }) => Promise<void>;
  refresh: () => Promise<void>;
  markRead: (ids?: number[]) => Promise<void>;
  reset: () => void;
}

export const useInbox = create<InboxState>((set) => ({
  unread: 0, items: [], loaded: false,
  async refreshCount(o) { try { set({ unread: await notifyApi.unread(o) }); } catch { /* signed out or offline: keep the last count */ } },
  async refresh() { try { const r = await notifyApi.list(); set({ unread: r.unread, items: r.items, loaded: true }); } catch { /* keep what we have */ } },
  async markRead(ids) { const r = await notifyApi.markRead(ids); set({ unread: r.unread, items: r.items, loaded: true }); },
  reset() { set({ unread: 0, items: [], loaded: false }); },
}));
