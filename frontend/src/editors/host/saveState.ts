// WP-21 (UX-003, 06 section 7.9): one save-state vocabulary for the three editors' headers.
//
//   Saving…              a save is on its way
//   Save failed: retry   the last save did not reach the server (a refused save of someone else's newer version has its own banner)
//   Unsaved changes      there is work the server does not have
//   Saved 12:04          saved during this visit, at that time
//   All changes saved    nothing unsaved since the document was opened
//
// The words are the same everywhere; only the S1000D Studio adds how many documents are unsaved, because it holds several.

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
}

export interface SaveStateLabel { text: string; tone: SaveTone }

/** "12:04" in the reader's clock (24-hour, two digits). */
export const clockTime = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function saveStateLabel(s: SaveStateInput): SaveStateLabel {
  if (s.saving) return { text: 'Saving…', tone: 'busy' };
  if (s.failed && s.dirty) return { text: 'Save failed: retry', tone: 'bad' };
  if (s.dirty) return { text: s.dirtyCount && s.dirtyCount > 1 ? `Unsaved changes (${s.dirtyCount} documents)` : 'Unsaved changes', tone: 'warn' };
  if (s.savedAt) return { text: `Saved ${clockTime(s.savedAt)}`, tone: 'ok' };
  return { text: 'All changes saved', tone: 'ok' };
}
