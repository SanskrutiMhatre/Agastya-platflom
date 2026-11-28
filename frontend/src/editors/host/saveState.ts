// WP-21 (UX-003, 06 section 7.9): one save-state vocabulary for the three editors' headers.
//
//   Saving…              a save is on its way
//   Save failed: retry   the last save did not reach the server (a refused save of someone else's newer version has its own banner)
//   Unsaved changes      there is work the server does not have
//   Saved 12:04          saved during this visit, at that time
//   All changes saved    nothing unsaved since the document was opened
//
// The words are the same everywhere; only the S1000D Studio adds how many documents are unsaved, because it holds several.
//
// Phase 3 (P3-1): a live document saves continuously, so its state is the connection's:
//   Saved                          the server has every change
//   Syncing…                       changes are on their way (or the server has not confirmed them yet)
//   Offline - changes kept locally no connection; the changes are kept in this browser and sent when it is back

export type SaveTone = 'ok' | 'warn' | 'bad' | 'busy';

export interface SaveStateInput {
  saving: boolean;
  dirty: boolean;
  /** when this visit last saved, or null */
  savedAt: Date | null;
  /** the last save failed (not a version conflict: that one is shown by its own banner) */
  failed?: boolean;
  /** S1000D: how many open documents are unsaved (more than one is said) */
  dirtyCount?: number;
  /** Phase 3: the active document is live (co-edited): its state is this one, not saving/dirty */
  live?: 'saved' | 'syncing' | 'offline';
}

export interface SaveStateLabel { text: string; tone: SaveTone }

/** "12:04" in the reader's clock (24-hour, two digits). */
export const clockTime = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function saveStateLabel(s: SaveStateInput): SaveStateLabel {
  if (s.live === 'offline') return { text: 'Offline - changes kept locally', tone: 'bad' };
  if (s.live === 'syncing') return { text: 'Syncing…', tone: 'busy' };
  if (s.live === 'saved') return { text: 'Saved', tone: 'ok' };
  if (s.saving) return { text: 'Saving…', tone: 'busy' };
  if (s.failed && s.dirty) return { text: 'Save failed: retry', tone: 'bad' };
  if (s.dirty) return { text: s.dirtyCount && s.dirtyCount > 1 ? `Unsaved changes (${s.dirtyCount} documents)` : 'Unsaved changes', tone: 'warn' };
  if (s.savedAt) return { text: `Saved ${clockTime(s.savedAt)}`, tone: 'ok' };
  return { text: 'All changes saved', tone: 'ok' };
}
