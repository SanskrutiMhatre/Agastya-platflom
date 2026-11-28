// =============================================================================
// Live co-editing (Phase 3, P3-1): one open S1000D data module bound to its room. The S1000D binding of the contract
// (docs/phase3/COLLAB-CONTRACT.md): room `<projectId>/dm/<file>`, the Y schema of shared/collab/ydom.ts, the DOM binding, the presence
// (cursor + name + colour) and the lock, wired into the Studio's DocumentEditor without changing its editing logic.
// =============================================================================

import { roomName, type RoomState, type CollabError, type AwarenessState } from '../../../backend/src/shared/collab/protocol';
import type { DocumentEditor } from '../studio/ui/editor';
import { LiveRoom, type LiveStatus } from './client';
import { DomBinding } from './binding';
import { CursorLayer, colorFor } from './cursors';

export interface LiveUser { id: string; name: string }

export interface LiveDocumentEvents {
  /** the save state, the lock or the people changed: the page re-reads them */
  changed(): void;
  toast(msg: string, kind: 'info' | 'warning' | 'error'): void;
}

/** Open the room of one data module (resolves when its content is here). Throws (with `code`) when live editing is not possible for it. */
export async function joinRoom(projectId: string, file: string, user: LiveUser): Promise<LiveRoom> {
  const room = new LiveRoom(roomName(projectId, 'dm', file), user.id);
  try { await room.open(); } catch (e) { room.close(false); throw e; }
  return room;
}

export class LiveDocument {
  readonly binding: DomBinding;
  private cursors: CursorLayer;
  private presenceTimer: number | null = null;
  private lastSel = '';
  private readonly onSelection = (): void => this.publishSoon();

  constructor(readonly ed: DocumentEditor, readonly room: LiveRoom, private user: LiveUser, private events: LiveDocumentEvents) {
    this.binding = new DomBinding(ed.doc, room.doc, {
      canWrite: () => !!this.room.state?.writable,
      onRefused: (why) => this.events.toast(why, 'warning'),
      onRemote: () => { this.ed.afterRemote(); },
    });
    const b = this.binding;
    ed.doc.setCollab({
      undo: () => b.undoLocal(),
      redo: () => b.redoLocal(),
      get canUndo() { return b.undo.undoStack.length > 0; },
      get canRedo() { return b.undo.redoStack.length > 0; },
      get dirty() { return room.unacknowledged > 0; },
    });
    this.cursors = new CursorLayer(ed, b, room);
    room.setEvents({
      state: (s) => this.onState(s),
      status: () => { this.ed.doc.dispatchEvent(new CustomEvent('saved')); this.events.changed(); },
      error: (e) => this.onError(e),
      synced: (_first, reset) => { if (reset) this.binding.takeBack('This document was reloaded from the project file.'); },
      awareness: () => { this.cursors.schedule(); this.events.changed(); },
    });
    if (room.state) this.onState(room.state);
    ed.design.page.addEventListener('keyup', this.onSelection);
    ed.design.page.addEventListener('mouseup', this.onSelection);
    document.addEventListener('selectionchange', this.onSelection);
    ed.doc.addEventListener('change', this.onSelection);
    this.publish();
  }

  get status(): LiveStatus { return this.room.status; }
  get state(): RoomState | null { return this.room.state; }
  /** Other people in this document now. */
  people(): Array<{ id: string; name: string; color: string; mode: string }> { return this.cursors.people(); }

  private onState(s: RoomState): void {
    this.ed.setLock(s.writable ? null : (s.reason ?? 'You cannot change this document now.'));
    this.publish();
    this.events.changed();
  }

  private onError(e: CollabError): void {
    if (e.code === 'READ_ONLY') {
      // the lock arrived while this person typed: the change was refused by the server; the room's version is the one shown
      this.binding.takeBack(e.message);
      return;
    }
    this.events.toast(e.message, e.code === 'WRITE_BACK_REFUSED' ? 'warning' : 'error');
  }

  private publishSoon(): void {
    if (this.presenceTimer !== null) return;
    this.presenceTimer = window.setTimeout(() => { this.presenceTimer = null; this.publish(); }, 120);
  }

  private publish(): void {
    const sel = this.ed.doc.selection;
    const anchor = sel ? this.binding.relOf(sel.anchor) : null;
    const head = sel ? this.binding.relOf(sel.focus) : null;
    const state: AwarenessState = {
      user: { id: this.user.id, name: this.user.name, color: colorFor(this.user.id) },
      cursor: anchor && head ? { anchor, head } : null,
      mode: this.room.state?.writable ? 'editing' : 'viewing',
    };
    const key = JSON.stringify(state);
    if (key === this.lastSel) return;
    this.lastSel = key;
    this.room.setPresence(state);
  }

  /** Save = the server writes the file now and records a revision. */
  async save(): Promise<string | null> { return (await this.room.flush(true)).hash; }

  /** The comment anchor for the current selection: the Y relative positions of its two ends. */
  selectionAnchor(): { start: string; end: string } | null {
    const sel = this.ed.doc.selection;
    if (!sel) return null;
    const start = this.binding.relOf(sel.anchor); const end = this.binding.relOf(sel.focus);
    return start && end ? { start, end } : null;
  }

  close(): void {
    if (this.presenceTimer !== null) window.clearTimeout(this.presenceTimer);
    this.ed.design.page.removeEventListener('keyup', this.onSelection);
    this.ed.design.page.removeEventListener('mouseup', this.onSelection);
    document.removeEventListener('selectionchange', this.onSelection);
    this.ed.doc.removeEventListener('change', this.onSelection);
    this.cursors.destroy();
    this.binding.destroy();
    this.ed.doc.setCollab(null);
    this.ed.setLock(null);
    this.room.close();
  }
}
