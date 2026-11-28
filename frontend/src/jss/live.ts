// =============================================================================
// Live co-editing (Phase 3, P3-1): the JSS document bound to its room. The JSS binding of the contract (docs/phase3/COLLAB-CONTRACT.md
// section 3; reasons in docs/phase3/collab-jss.md):
//
//   room       <projectId>/jss/book, the core's LiveRoom (frontend/src/collab/client.ts): coalescing, backpressure, ACK, IndexedDB keep
//   schema     backend/src/shared/jss/yjss.ts, the same file the server reads and writes the document with
//   local      the editor changes its model as it always has (D16); after each change (JssEditor's host.onChange) the change is merged into
//              the tree in ONE transaction with ORIGIN_LOCAL: typing in a text only that text (its common start and end), anything else
//              by the model objects' identity (yjss Sync). The document is never re-serialised to be sent.
//   remote     the tree's events (observeDeep, not ORIGIN_LOCAL: other people and this person's undo) change the model in place (yjss Reader,
//              the same objects) and the sheet redraws only the texts that changed, or the sheet when the structure did, the caret kept
//   undo       Y.UndoManager, trackedOrigins {ORIGIN_LOCAL}: a person undoes only their own changes; typing is one step, a command one step
//   presence   name, colour (a theme token) and the selection as Y relative positions, drawn as carets on the sheet and faces in the outline
//   comments   anchored with Y relative positions on the text ("jss/book" names the document)
// Loaded lazily with the first live JSS document (the editor page's chunk does not carry Yjs).
// =============================================================================

import * as Y from 'yjs';
import { roomName, toBase64, fromBase64, type RoomState, type CollabError, type AwarenessState } from '../../../backend/src/shared/collab/protocol';
import * as yj from '../../../backend/src/shared/jss/yjss';
import * as ydom from '../../../backend/src/shared/collab/ydom';
import { LiveRoom, ORIGIN_LOCAL, type LiveStatus } from '../collab/client';
import { colorFor, PRESENCE_COLORS } from '../collab/cursors';
import type { JssDoc, Para, Part, KeyItem } from './model';
import type { JssEditor, TextSlot, EditorCollab } from './editor';
import { XREF_CLASS } from './inline';

export interface LiveUser { id: string; name: string }
/** The name of the JSS document in its room and in review comments. */
export const JSS_DOC = 'book';
export const JSS_COMMENT_FILE = `jss/${JSS_DOC}`;

export interface LiveJssEvents {
  /** the save state, the lock or the people changed */
  changed(): void;
  toast(msg: string, kind: 'info' | 'warning' | 'error'): void;
  /** the merged text changed (validation runs on it, on its debounce) */
  edited(): void;
}

/** Open the room of a project's JSS document (resolves when its content is here). Throws (with `code`) when live editing is not possible. */
export async function joinJss(projectId: string, user: LiveUser): Promise<LiveRoom> {
  const room = new LiveRoom(roomName(projectId, 'jss', JSS_DOC), user.id);
  try { await room.open(); } catch (e) { room.close(false); throw e; }
  return room;
}

type Pos = { slot: TextSlot; offset: number };
type Anchor = { path: string; tag: string; text: string; y?: { start: string; end: string } };

export class LiveJss {
  readonly maps = yj.newMaps();
  readonly model: JssDoc;
  readonly undo: Y.UndoManager;
  private readonly frag: Y.XmlFragment;
  private readonly reader: yj.Reader;
  private readonly sync: yj.Sync;
  private editor: JssEditor | null = null;
  private cursors: JssCursors | null = null;
  private applying = false;
  private presenceTimer: number | null = null;
  private lastPresence = '';
  private lastAnchor: Anchor | null = null;
  private readonly onSelection = (): void => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) { const a = this.anchorNow(); if (a) this.lastAnchor = a; }
    this.publishSoon();
  };
  private readonly observer = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, txn: Y.Transaction): void => this.onY(events, txn);
  private unobserve: (() => void) | null = null;

  constructor(readonly room: LiveRoom, private readonly user: LiveUser, private readonly events: LiveJssEvents) {
    this.frag = room.doc.getXmlFragment(yj.ROOT);
    this.reader = new yj.Reader(this.maps);
    this.sync = new yj.Sync(this.maps);
    const d = this.reader.doc(this.frag);
    if (!d) throw Object.assign(new Error('The live document holds no JSS document.'), { code: 'NOT_WELL_FORMED' });
    this.model = d;
    // the tree, its blocks and their placements (ydom.ts schema 2: a moved block is re-placed, its content stays)
    this.undo = new Y.UndoManager(ydom.undoScope(room.doc), { trackedOrigins: new Set([ORIGIN_LOCAL]), captureTimeout: 600 });
    this.unobserve = ydom.observeTree(room.doc, this.observer);
    room.setEvents({
      state: (s) => this.onState(s),
      status: () => this.events.changed(),
      error: (e) => this.onError(e),
      synced: (_first, reset) => { if (reset) this.takeBack('This document was reloaded from the project file.'); },
      awareness: () => { this.cursors?.schedule(); this.events.changed(); },
    });
  }

  get status(): LiveStatus { return this.room.status; }
  get state(): RoomState | null { return this.room.state; }
  get writable(): boolean { return !!this.room.state?.writable; }
  get unacknowledged(): number { return this.room.unacknowledged; }

  /** The editor was built on `model`: from now on its changes go to the room and the room's to it. */
  attach(editor: JssEditor): void {
    this.editor = editor;
    const um = this.undo; const room = this.room;
    const collab: EditorCollab = {
      undo: () => { um.stopCapturing(); um.undo(); },
      redo: () => { um.stopCapturing(); um.redo(); },
      get canUndo() { return um.undoStack.length > 0; },
      get canRedo() { return um.redoStack.length > 0; },
      get dirty() { return room.unacknowledged > 0; },
    };
    editor.setCollab(collab);
    um.on('stack-item-added', () => editor.refreshToolbar());
    um.on('stack-item-popped', () => editor.refreshToolbar());
    this.cursors = new JssCursors(editor, this);
    document.addEventListener('selectionchange', this.onSelection);
    if (room.state) this.onState(room.state);
    this.publish();
  }

  // ------------------------------------------------------------- local -> room

  /** The editor changed its model (host.onChange): merge it into the room. */
  local(at: HTMLElement | null): void {
    if (this.applying || !this.editor) return;
    if (!this.writable) { this.takeBack(this.room.state?.reason ?? 'You cannot change this document now.'); return; }
    const slot = at ? this.editor.slotOf(at) : null;
    if (!slot) this.undo.stopCapturing();
    this.room.doc.transact(() => {
      if (slot && this.pushSlot(slot)) return;
      this.sync.doc(this.room.doc, this.model);
    }, ORIGIN_LOCAL);
    if (!slot) this.undo.stopCapturing();
    this.editor.refreshToolbar();
    this.cursors?.schedule();
    this.publishSoon();
    this.events.changed();
    this.events.edited();
  }

  /** Only the text typed into; false when it is not in the tree as it stands (the whole document is merged instead). */
  private pushSlot(s: TextSlot): boolean {
    const n = s.node as Para | Part | KeyItem | { title?: string };
    if (s.slot === 'title') return this.sync.title(s.node, (n as { title?: string }).title ?? '');
    if (s.slot === 'num' || s.slot === 'text') return this.sync.node(s.node, yj.keyitemV(n as KeyItem));
    const k = (n as { k?: string }).k;
    if (k === 'para') return this.sync.node(s.node, yj.paraV(n as Para));
    if (k === 'inline') return this.sync.node(s.node, yj.partV(n as Part));
    return false;
  }

  // ------------------------------------------------------------- room -> local

  private onY(events: Array<Y.YEvent<Y.AbstractType<unknown>>>, txn: Y.Transaction): void {
    if (txn.origin === ORIGIN_LOCAL || !this.editor) return;
    this.applying = true;
    try {
      const texts = this.textsOnly(events);
      if (texts) {
        for (const t of texts) this.readSlot(t);
        this.editor.applyRemote(texts.map((t) => t.slot));
      } else {
        this.reader.doc(this.frag, this.model);
        this.editor.applyRemote(null);
      }
    } finally { this.applying = false; }
    this.cursors?.schedule();
    this.events.changed();
    this.events.edited();
  }

  /** The text places the events changed, when they changed nothing else (null: the structure changed). */
  private textsOnly(events: Array<Y.YEvent<Y.AbstractType<unknown>>>): Array<{ slot: TextSlot; y: Y.XmlElement }> | null {
    const out = new Map<string, { slot: TextSlot; y: Y.XmlElement }>();
    const ids = new WeakMap<object, number>(); let next = 0;
    const key = (o: object, s: string) => { let i = ids.get(o); if (i === undefined) { i = next++; ids.set(o, i); } return `${i}:${s}`; };
    for (const ev of events) {
      const t = ev.target;
      const at = this.textPlace(t);
      if (!at) return null;
      if (t instanceof Y.XmlElement && t === at.y) {
        const xe = ev as Y.YXmlEvent;
        // the attributes of a paragraph (its alignment) or of a key item (its number) are drawn by the structure, its number aside
        if (xe.attributesChanged.size && !(at.slot.slot === 'num' && [...xe.attributesChanged].every((a) => a === 'num'))) return null;
        if (xe.attributesChanged.size) { out.set(key(at.slot.node, 'num'), { slot: { node: at.slot.node, slot: 'num' }, y: at.y }); if (!(xe as unknown as { childListChanged: boolean }).childListChanged) continue; }
      }
      out.set(key(at.slot.node, at.slot.slot), at);
    }
    return [...out.values()];
  }

  /** The text place a Y node is in: a paragraph's or run's inline text, a title, a key item's text. Null: it is structure. */
  private textPlace(t: Y.AbstractType<unknown>): { slot: TextSlot; y: Y.XmlElement } | null {
    let title = false;
    for (let n: unknown = t; n; n = yj.upOf(n)) {
      if (!(n instanceof Y.XmlElement)) { if (n instanceof Y.XmlText) continue; return null; }
      const m = this.maps.yToModel.get(n);
      if (!m) { if (n.nodeName === 'title') { title = true; continue; } if (/^(b|i|u|sup|sub|xref|br)$/.test(n.nodeName)) continue; return null; }
      const k = (m as { k?: string }).k;
      if (title) return k === 'chapter' || k === 'section' || k === 'table' || k === 'figure' ? { slot: { node: m, slot: 'title' }, y: n } : null;
      if (k === 'para' || k === 'inline') return { slot: { node: m, slot: 'inline' }, y: n };
      if (n.nodeName === 'keyitem') return { slot: { node: m, slot: 'text' }, y: n };
      return null;
    }
    return null;
  }

  private readSlot({ slot, y }: { slot: TextSlot; y: Y.XmlElement }): void {
    if (slot.slot === 'title') { const t = yj.childNamed(y, 'title'); (slot.node as { title?: string }).title = t ? yj.textIn(t) : ''; return; }
    if (slot.slot === 'num' || slot.slot === 'text') { this.reader.keyitem(y); return; }
    if ((slot.node as { k?: string }).k === 'para') this.reader.para(y); else this.reader.part(y);
  }

  /** The room's version replaces whatever this page changed (a refused change, a rebuilt room). */
  takeBack(reason: string): void {
    this.applying = true;
    try { this.reader.doc(this.frag, this.model); this.editor?.applyRemote(null); } finally { this.applying = false; }
    this.events.toast(reason, 'warning');
    this.events.changed();
  }

  private onState(s: RoomState): void {
    this.editor?.setReadOnly(!s.writable);
    this.publish();
    this.events.changed();
  }

  private onError(e: CollabError): void {
    if (e.code === 'READ_ONLY') { this.takeBack(e.message); return; }
    this.events.toast(e.message, e.code === 'EXTERNAL_CHANGE' ? 'info' : e.code === 'WRITE_BACK_REFUSED' ? 'warning' : 'error');
  }

  // ------------------------------------------------------------- positions (carets, comments)

  /** The Y relative position (base64) of a place in the sheet (a DOM point inside an editable text). */
  relOfDom(node: Node | null, offset: number): string | null {
    const ed = this.editor; if (!ed || !node) return null;
    const host = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('[data-edit]') ?? null;
    const slot = ed.slotOf(host); if (!slot || !host) return null;
    const box = this.boxOf(slot); if (!box) return null;
    const chars = contentOffset(host as HTMLElement, node, offset);
    let rel: Y.RelativePosition;
    if (box instanceof Y.XmlElement && slot.slot !== 'num') {
      const texts = yj.textsIn(box);
      let left = chars; let hit: Y.XmlText | null = null;
      for (const t of texts) { if (left <= t.length) { hit = t; break; } left -= t.length; }
      if (!hit && texts.length) { hit = texts[texts.length - 1]; left = hit.length; }
      rel = hit ? Y.createRelativePositionFromTypeIndex(hit, Math.max(0, left)) : Y.createRelativePositionFromTypeIndex(box, 0);
    } else rel = Y.createRelativePositionFromTypeIndex(box, 0);
    return toBase64(Y.encodeRelativePosition(rel));
  }

  /** The Y element whose text a place is (a paragraph, a run, a title, a key item). */
  private boxOf(slot: TextSlot): Y.XmlElement | null {
    const y = this.maps.modelToY.get(slot.node); if (!y) return null;
    return slot.slot === 'title' ? yj.childNamed(y, 'title') : y;
  }

  /** A place in the model for a relative position (null: its words are gone). */
  posOf(b64: string): Pos | null {
    let abs: Y.AbsolutePosition | null = null;
    try { abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(b64)), this.room.doc); } catch { return null; }
    if (!abs) return null;
    const at = this.textPlace(abs.type);
    if (!at) return null;
    if (!(abs.type instanceof Y.XmlText)) return { slot: at.slot, offset: 0 };
    const box = at.slot.slot === 'title' ? yj.childNamed(at.y, 'title') : at.y;
    let off = 0;
    for (const t of box ? yj.textsIn(box) : []) { if (t === abs.type) break; off += t.length; }
    return { slot: at.slot, offset: off + abs.index };
  }

  /** The DOM point of a model place as the sheet draws it now. */
  domOf(p: Pos): { node: Node; offset: number; el: HTMLElement } | null {
    const el = this.editor?.slotEl(p.slot.node, p.slot.slot); if (!el) return null;
    return { ...domPoint(el, p.offset), el };
  }

  /**
   * The comment anchor of the selection: the Y relative positions of its ends, the element's place, tag and words. Writing the comment moves
   * the focus to the comment box, so the last selection made on the sheet is the one used (kept as relative positions, it follows edits).
   */
  selectionAnchor(): Anchor | null {
    const now = this.anchorNow();
    return now ?? this.lastAnchor;
  }

  private anchorNow(): Anchor | null {
    const sel = window.getSelection(); if (!sel || !sel.rangeCount || !this.editor) return null;
    const paper = this.editor.paperEl();
    if (!sel.anchorNode || !paper.contains(sel.anchorNode)) return null;
    const start = this.relOfDom(sel.anchorNode, sel.anchorOffset); const end = this.relOfDom(sel.focusNode, sel.focusOffset);
    if (!start || !end) return null;
    const host = (sel.anchorNode?.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode?.parentElement)?.closest('[data-edit]') ?? null;
    const slot = this.editor.slotOf(host); const y = slot ? this.maps.modelToY.get(slot.node) : undefined;
    const parts: number[] = [];
    for (let n: unknown = y ?? null; n && n !== (this.frag as unknown); n = yj.upOf(n)) {
      const p = yj.upOf(n); if (!p) break;
      parts.unshift(ydom.ychildren(p).indexOf(n as Y.XmlElement));
    }
    const text = (sel.toString() || host?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return { path: parts.length ? parts.join('/') : '0', tag: y?.nodeName ?? 'jssbook', text, y: { start, end } };
  }

  /** Select the words of a comment (followed through everyone's edits). False when they are gone. */
  reveal(y: { start: string; end: string }): boolean {
    const a = this.posOf(y.start); const b = this.posOf(y.end);
    if (!a || !b) return false;
    const da = this.domOf(a); const db = this.domOf(b);
    if (!da || !db) return false;
    da.el.scrollIntoView?.({ block: 'center' });
    try {
      const r = document.createRange(); r.setStart(da.node, da.offset); r.setEnd(db.node, db.offset);
      if (r.collapsed && (da.node !== db.node || da.offset !== db.offset)) { r.setStart(db.node, db.offset); r.setEnd(da.node, da.offset); }
      da.el.focus({ preventScroll: true });
      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
    } catch { return false; }
    return true;
  }

  // ------------------------------------------------------------- presence

  private publishSoon(): void {
    if (this.presenceTimer !== null) return;
    this.presenceTimer = window.setTimeout(() => { this.presenceTimer = null; this.publish(); }, 120);
  }

  private publish(): void {
    const sel = window.getSelection();
    const paper = this.editor?.paperEl();
    const inside = !!sel && sel.rangeCount > 0 && !!paper && !!sel.anchorNode && paper.contains(sel.anchorNode);
    const anchor = inside ? this.relOfDom(sel!.anchorNode, sel!.anchorOffset) : null;
    const head = inside ? this.relOfDom(sel!.focusNode, sel!.focusOffset) : null;
    const state: AwarenessState = {
      user: { id: this.user.id, name: this.user.name, color: colorFor(this.user.id) },
      cursor: anchor && head ? { anchor, head } : null,
      mode: this.writable ? 'editing' : 'viewing',
    };
    const k = JSON.stringify(state);
    if (k === this.lastPresence) return;
    this.lastPresence = k;
    this.room.setPresence(state);
  }

  /** The other people in the document now (one entry per person). */
  people(): Array<{ id: string; name: string; color: string; mode: string }> {
    const out = new Map<string, { id: string; name: string; color: string; mode: string }>();
    for (const [client, st] of this.room.awareness.getStates()) {
      const s = st as AwarenessState | null;
      if (client === this.room.doc.clientID || !s?.user) continue;
      out.set(s.user.id, { id: s.user.id, name: s.user.name, color: s.user.color, mode: s.mode ?? 'editing' });
    }
    return [...out.values()];
  }

  /** Save = the server writes the file now and records a revision. Resolves with the file's hash. */
  async save(): Promise<string | null> { return (await this.room.flush(true)).hash; }

  close(): void {
    if (this.presenceTimer !== null) window.clearTimeout(this.presenceTimer);
    document.removeEventListener('selectionchange', this.onSelection);
    this.unobserve?.(); this.unobserve = null;
    this.cursors?.destroy();
    this.undo.destroy();
    this.editor?.setCollab(null);
    this.room.close();
  }
}

// ---------------------------------------------------------------- the sheet's characters (xref labels are drawn, not written)

const isLabel = (n: Node): boolean => { const p = n.parentElement?.closest(`.${XREF_CLASS}`); return !!p && p.hasAttribute('data-to'); };

/** The characters of the document before a DOM point inside an editable (an xref's drawn label does not count). */
function contentOffset(el: HTMLElement, node: Node, offset: number): number {
  let n = 0; let done = false;
  const walk = (x: Node): void => {
    if (done) return;
    if (x === node && x.nodeType !== 3) {
      for (let i = 0; i < offset && i < x.childNodes.length; i++) count(x.childNodes[i]);
      done = true; return;
    }
    if (x.nodeType === 3) {
      if (x === node) { if (!isLabel(x)) n += offset; done = true; return; }
      if (!isLabel(x)) n += (x.nodeValue ?? '').length;
      return;
    }
    for (const c of Array.from(x.childNodes)) { walk(c); if (done) return; }
  };
  const count = (x: Node): void => { if (x.nodeType === 3) { if (!isLabel(x)) n += (x.nodeValue ?? '').length; } else for (const c of Array.from(x.childNodes)) count(c); };
  walk(el);
  return n;
}

/** The DOM point at a number of document characters into an editable. */
function domPoint(el: HTMLElement, chars: number): { node: Node; offset: number } {
  let left = chars; let last: Node | null = null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (isLabel(t)) continue;
    const len = (t.nodeValue ?? '').length;
    if (left <= len) return { node: t, offset: left };
    left -= len; last = t;
  }
  return last ? { node: last, offset: (last.nodeValue ?? '').length } : { node: el, offset: 0 };
}

// ---------------------------------------------------------------- other people's carets, and their faces in the outline

const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

class JssCursors {
  readonly el: HTMLElement;
  private frame = 0;
  private faces: HTMLElement[] = [];
  private readonly redraw = (): void => this.schedule();
  private ro: ResizeObserver | null = null;

  constructor(private readonly ed: JssEditor, private readonly live: LiveJss) {
    const host = ed.scrollHost();
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    this.el = document.createElement('div');
    this.el.className = 'collab-cursors jss-collab-cursors';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.dataset.testid = 'collab-cursors';
    host.appendChild(this.el);
    host.addEventListener('scroll', this.redraw, { passive: true });
    live.room.awareness.on('change', this.redraw);
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(this.redraw); this.ro.observe(host); }
    ed.onOutlineDrawn(this.redraw);                              // the outline is drawn again after edits: its faces with it
  }

  schedule(): void { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.ed.scrollHost().removeEventListener('scroll', this.redraw);
    this.live.room.awareness.off('change', this.redraw);
    this.ro?.disconnect();
    this.ed.onOutlineDrawn(null);
    for (const f of this.faces) f.remove();
    this.el.remove();
  }

  private draw(): void {
    const host = this.ed.scrollHost();
    const box = host.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    for (const f of this.faces) f.remove();
    this.faces = [];
    const inSection = new Map<object, Array<{ name: string; color: string }>>();
    for (const [client, st] of this.live.room.awareness.getStates()) {
      const s = st as AwarenessState | null;
      if (client === this.live.room.doc.clientID || !s?.user || !s.cursor) continue;
      const color = `var(--${PRESENCE_COLORS.includes(s.user.color) ? s.user.color : 'accent'})`;
      const f = this.live.posOf(s.cursor.head); const a = this.live.posOf(s.cursor.anchor);
      if (!f) continue;
      const sec = this.ed.sectionOf(f.slot.node);
      if (sec) { const l = inSection.get(sec) ?? []; if (!l.some((p) => p.name === s.user.name)) l.push({ name: s.user.name, color }); inSection.set(sec, l); }
      const vf = this.live.domOf(f); const va = a ? this.live.domOf(a) : null;
      if (!vf) continue;
      try {
        const r = document.createRange();
        if (va && (va.node !== vf.node || va.offset !== vf.offset)) {
          const fwd = (va.node.compareDocumentPosition(vf.node) & Node.DOCUMENT_POSITION_FOLLOWING) || (va.node === vf.node && va.offset < vf.offset);
          if (fwd) { r.setStart(va.node, va.offset); r.setEnd(vf.node, vf.offset); } else { r.setStart(vf.node, vf.offset); r.setEnd(va.node, va.offset); }
          for (const rc of Array.from(r.getClientRects())) {
            const band = document.createElement('span'); band.className = 'collab-sel';
            band.style.setProperty('--collab-color', color);
            Object.assign(band.style, { left: `${rc.left - box.left + host.scrollLeft}px`, top: `${rc.top - box.top + host.scrollTop}px`, width: `${rc.width}px`, height: `${rc.height}px` });
            frag.appendChild(band);
          }
        }
        r.setStart(vf.node, vf.offset); r.collapse(true);
        const rc = r.getClientRects()[0] ?? vf.el.getBoundingClientRect();
        const caret = document.createElement('span'); caret.className = 'collab-caret';
        caret.style.setProperty('--collab-color', color);
        Object.assign(caret.style, { left: `${rc.left - box.left + host.scrollLeft}px`, top: `${rc.top - box.top + host.scrollTop}px`, height: `${Math.max(12, rc.height)}px` });
        const tag = document.createElement('span'); tag.className = 'collab-name'; tag.textContent = s.user.name;
        caret.dataset.user = s.user.id;
        caret.appendChild(tag);
        frag.appendChild(caret);
      } catch { /* a place the sheet does not draw now */ }
    }
    this.el.replaceChildren(frag);
    // the outline (the explorer's tree): who is in which chapter or section
    for (const [sec, people] of inSection) {
      const row = this.ed.outlineRowFor(sec); if (!row) continue;
      const faces = document.createElement('span'); faces.className = 'jss-ol-people'; faces.dataset.testid = 'jss-outline-people';
      faces.title = people.map((p) => p.name).join(', ');
      for (const p of people.slice(0, 3)) { const f = document.createElement('span'); f.className = 'jss-ol-face'; f.style.setProperty('--collab-color', p.color); f.textContent = initials(p.name); faces.appendChild(f); }
      row.appendChild(faces); this.faces.push(faces);
    }
  }
}
