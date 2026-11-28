// =============================================================================
// Live co-editing (Phase 3, P3-1): this person's changes the server has not acknowledged yet, kept in the browser (IndexedDB).
//
// WP-05 for a live document: a change is the author's until the server says it is stored. Until then it is here as well as in memory, so a
// closed tab, a crash or a lost network loses nothing: the next open of the document gives the changes to the room again (Yjs applies an
// update it already has as a no-op, so giving them twice is harmless). They are kept under the signed-in person (FE-006) and the room's
// epoch: changes made against a room that was rebuilt since (another epoch) cannot be merged into it and are not offered to it.
// =============================================================================

import * as Y from 'yjs';
import { storage } from '../studio/ui/storage';

export interface PendingEntry { room: string; epoch: string; update: Uint8Array; savedAt: number; userId: string }

const PREFIX = 'collab-pending:';
const keyOf = (userId: string, room: string): string => `${PREFIX}${userId}:${room}`;

export async function loadPending(userId: string, room: string): Promise<PendingEntry | null> {
  try {
    const got = await storage.get<PendingEntry>('kv', keyOf(userId, room));
    return got && got.update && got.update.length ? got : null;
  } catch { return null; }
}

/** Keep `updates` (merged into one) as the person's unacknowledged changes to `room`; none: forget them. */
export async function savePending(userId: string, room: string, epoch: string, updates: Uint8Array[]): Promise<void> {
  try {
    if (!updates.length) { await storage.del('kv', keyOf(userId, room)); return; }
    const update = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
    await storage.put('kv', keyOf(userId, room), { room, epoch, update, savedAt: Date.now(), userId } satisfies PendingEntry);
  } catch { /* no IndexedDB (a private window): the changes are still in memory and are sent when the socket is back */ }
}

/** A sign-out the person chose on a shared computer: their kept changes go with them (FE-024). */
export async function discardPendingOf(userId: string): Promise<void> {
  try {
    const keys = (await storage.keys('kv')) ?? [];
    for (const k of keys) if (typeof k === 'string' && k.startsWith(`${PREFIX}${userId}:`)) await storage.del('kv', k);
  } catch { /* nothing kept */ }
}
