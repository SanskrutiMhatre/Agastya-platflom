// =============================================================================
// Live co-editing (Phase 3, P3-1): an open JSG document (User Handbook or Illustrated Spare Parts List) bound to its room. The JSG binding of
// the contract (docs/phase3/COLLAB-CONTRACT.md): room `<projectId>/jsg/document`, the Y schema of shared/collab/jsgForm.ts (the editor's
// canonical XML in ydom's form), presence (caret + name + colour, faces in the outline), per-person undo, the lock, comments on live words.
//
//   local -> Y   The JSG editors edit their model (jsg/model.ts) directly and say so after every change (JsgCollab.changed: each keystroke, each
//                command). The binding writes the model with the editor's own serializer, reads it back, and brings the room to it with the
//                keyed minimal reconcile against its shadow (a DOM copy of what the room holds, child for child): only the paragraph, cell,
//                row or block that changed becomes Y operations, so two people typing in one paragraph merge character by character and a
//                paragraph someone types in keeps its identity when another person adds one before it. Nothing in the editing logic changes (D16).
//   Y -> local   Another person's change (and this person's undo) is read from the room into a model, which is laid onto the editor's model in
//                place (objects that did not change keep their identity). When only text changed, the fields showing it are updated where they
//                are, with the caret kept on the same character; a structural change draws the sheet again and puts the caret back in the field
//                it was in. Validation (Check) runs on the merged model.
//   Read-only    A reader (reviewer, viewer), someone else's check-out and the review lock open the editor read-only (the page rebuilds it when
//                that changes); a change the server refused anyway is taken back from the room.
// =============================================================================

import * as Y from 'yjs';
import * as ydom from '../../../backend/src/shared/collab/ydom';
import { normalizeJsgDom, reconcileKeyed, ykids, pathOf, yAt, yPathOf, JSG_DOC_PATH, JSG_FILE } from '../../../backend/src/shared/collab/jsgForm';
import { roomName, toBase64, fromBase64, type RoomState, type CollabError, type AwarenessState } from '../../../backend/src/shared/collab/protocol';
import type { XNode } from '../../../backend/src/shared/collab/xmlForm';
import { readJsg, readJsgWith, serializeJsg, type JsgElement } from '../jsg/xml';
import type { JsgDoc } from '../jsg/model';
import { injectCss, type JsgLiveSurface, type JsgSlot } from '../jsg/shared';
import { LiveRoom, ORIGIN_LOCAL, type LiveStatus } from './client';
import { colorFor, PRESENCE_COLORS } from './cursors';

export { JSG_FILE };
/** The name comments give the document (review.ts accepts "jsg/<file>"; the comments panel calls it "This document"). */
export const JSG_COMMENTS_FILE = `jsg/${JSG_FILE}`;
export interface LiveUser { id: string; name: string }

export interface JsgLiveEvents {
  /** the save state, the lock or the people changed: the page reads them again */
  changed(): void;
  toast(msg: string, kind: 'info' | 'warning' | 'error'): void;
  /** this person may (or may no longer) change the document: the page opens the editor again accordingly */
  writable(w: boolean): void;
}

/** Open the room of a JSG project's document (resolves when its content is here). Throws (with `code`) when live editing is not possible. */
export async function joinJsgRoom(projectId: string, user: LiveUser): Promise<LiveRoom> {
  const room = new LiveRoom(roomName(projectId, 'jsg', JSG_DOC_PATH), user.id);
  try { await room.open(); } catch (e) { room.close(false); throw e; }
  return room;
}

/** A DOM copy of what a Y document holds, child for child (the shadow the keyed reconcile compares against). */
function shadowOf(ydoc: Y.Doc): XMLDocument {
  const d = document.implementation.createDocument(null, '', null);
  while (d.firstChild) d.removeChild(d.firstChild);
  ydom.buildInto(ydoc, d as unknown as ydom.XBuildParent & ydom.XFactory);
  return d;
}

/** The model of what the room holds (the editor is built from it: the room may be ahead of the file). */
export function modelOfRoom(room: LiveRoom): JsgDoc {
  const d = shadowOf(room.doc);
  if (!d.documentElement) throw new Error('The live document is empty.');
  return readJsg(d.documentElement as unknown as JsgElement);
}

const CSS = `
.jsg-live-scroll{position:relative}
.jsg-live-cursors{position:absolute;inset:0 auto auto 0;width:0;height:0;pointer-events:none;z-index:3}
.jsg-live-cursors .collab-caret{position:absolute;width:0;border-left:2px solid var(--collab-color,var(--accent))}
.jsg-live-cursors .collab-name{position:absolute;left:-2px;bottom:100%;padding:0 4px;border-radius:3px 3px 3px 0;font:600 10.5px/16px var(--font-ui,sans-serif);white-space:nowrap;background:var(--collab-color,var(--accent));color:var(--text-on-accent)}
.jsg-live-cursors .collab-sel{position:absolute;background:var(--collab-color,var(--accent));opacity:.18;border-radius:2px}
.jsg-live-faces{display:inline-flex;gap:2px;margin-left:6px;vertical-align:middle}
.jsg-live-faces .f{display:inline-block;min-width:16px;height:16px;padding:0 3px;border-radius:8px;font:600 9px/16px var(--font-ui,sans-serif);text-align:center;background:var(--collab-color,var(--accent));color:var(--text-on-accent)}
`;

// ---------------------------------------------------------------- laying a model onto the editor's model in place

type Leaf = [Record<string | number, unknown>, string | number];
type Rec = Record<string | number, unknown>;
const isObj = (v: unknown): v is Rec => v !== null && typeof v === 'object';
const isInline = (v: unknown): boolean => Array.isArray(v) && v.length > 0 && isObj(v[0]) && 't' in (v[0] as object);
const tagOf = (v: unknown): string => (Array.isArray(v) ? 'a' : isObj(v) ? `o:${String(v.k ?? v.t ?? '')}` : typeof v);
const J = (v: unknown): string => JSON.stringify(v) ?? 'undefined';

/** Put `b` where `a` is (holder[key]); objects of the same kind are patched in place. Returns whether the structure changed. */
function patchValue(holder: Rec, key: string | number, a: unknown, b: unknown, leaves: Leaf[]): boolean {
  if (isInline(a) || isInline(b)) { if (J(a) !== J(b)) { holder[key] = b; leaves.push([holder, key]); } return false; }    // a run of rich text is one value
  if (isObj(a) && isObj(b) && tagOf(a) === tagOf(b)) return Array.isArray(a) ? patchArr(a, b as unknown as unknown[], leaves) : patchObj(a, b, leaves);
  if (a === b) return false;
  holder[key] = b;
  if (isObj(a) || isObj(b)) return true;
  leaves.push([holder, key]);
  return false;
}
function patchObj(o: Rec, n: Rec, leaves: Leaf[]): boolean {
  let s = false;
  for (const k of Object.keys(o)) if (!(k in n)) { if (o[k] !== undefined) s = true; delete o[k]; }
  for (const k of Object.keys(n)) {
    if (!(k in o) || o[k] === undefined) { if (n[k] === undefined) continue; o[k] = n[k]; if (isObj(n[k])) s = true; else leaves.push([o, k]); continue; }
    s = patchValue(o, k, o[k], n[k], leaves) || s;
  }
  return s;
}
function patchArr(o: unknown[], n: unknown[], leaves: Leaf[]): boolean {
  if (o.length === n.length && o.every((x, i) => tagOf(x) === tagOf(n[i]))) {
    let s = false;
    for (let i = 0; i < o.length; i++) s = patchValue(o as unknown as Rec, i, o[i], n[i], leaves) || s;
    return s;
  }
  // the list changed: what is unchanged keeps its object (a paragraph someone is typing in stays the same paragraph), the rest is new
  const ko = o.map(J); const kn = n.map(J);
  const out: unknown[] = new Array(n.length);
  let p = 0; while (p < o.length && p < n.length && ko[p] === kn[p]) { out[p] = o[p]; p++; }
  let q = 0; while (q < o.length - p && q < n.length - p && ko[o.length - 1 - q] === kn[n.length - 1 - q]) { out[n.length - 1 - q] = o[o.length - 1 - q]; q++; }
  const mo = o.slice(p, o.length - q); const mn = n.slice(p, n.length - q);
  const kmo = ko.slice(p, o.length - q); const kmn = kn.slice(p, n.length - q);
  const used = new Set<number>();
  if (mo.length * mn.length <= 40_000) {
    // same text anywhere in the middle (a moved block)
    const at = new Map<string, number[]>(); kmo.forEach((k, i) => { const l = at.get(k) ?? []; l.push(i); at.set(k, l); });
    kmn.forEach((k, j) => { const l = at.get(k); const i = l?.find((x) => !used.has(x)); if (i !== undefined) { used.add(i); out[p + j] = mo[i]; } });
  }
  // the rest: an old object of the same kind, in order, patched to the new content (an edited paragraph is the same paragraph)
  let i = 0;
  for (let j = 0; j < mn.length; j++) {
    if (out[p + j] !== undefined) continue;
    while (i < mo.length && used.has(i)) i++;
    if (i < mo.length && isObj(mo[i]) && tagOf(mo[i]) === tagOf(mn[j])) { const keep = mo[i] as Rec; used.add(i); i++; patchValue({ v: keep } as Rec, 'v', keep, mn[j], []); out[p + j] = keep; }
    else out[p + j] = mn[j];
  }
  o.splice(0, o.length, ...out);
  return true;
}

// ---------------------------------------------------------------- text positions inside a field (BR = one character, as \n in the model)

function units(el: Node, cb: (n: Node, start: number, len: number) => boolean | void): number {
  let acc = 0;
  const walk = (n: Node): boolean => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { const len = (c as Text).data.length; if (cb(c, acc, len)) return true; acc += len; }
      else if (c.nodeType === 1) {
        if ((c as Element).tagName === 'BR') { if (cb(c, acc, 1)) return true; acc += 1; } else if (walk(c)) return true;
      }
    }
    return false;
  };
  walk(el);
  return acc;
}
const fieldText = (el: Node): string => { let s = ''; units(el, (n) => { s += n.nodeType === 3 ? (n as Text).data : '\n'; }); return s; };
function offsetIn(el: Node, node: Node, off: number): number {
  if (node === el || node.nodeType === 1) {
    // a point between children: the units before child[off]
    const stop = node.childNodes[off] ?? null;
    let found = -1;
    const total = units(el, (n, start) => { if (stop && (n === stop || stop.contains(n))) { found = start; return true; } return false; });
    if (found >= 0) return found;
    if (node === el || !stop) { if (node === el) return total; }
    // after the last unit inside `node`
    let end = 0; units(el, (n, start, len) => { if (node.contains(n)) end = start + len; });
    return end;
  }
  let at = 0; units(el, (n, start) => { if (n === node) { at = start + off; return true; } return false; });
  return at;
}
function pointIn(el: Node, pos: number): { node: Node; offset: number } {
  let hit: { node: Node; offset: number } | null = null;
  units(el, (n, start, len) => {
    if (n.nodeType === 3 && pos <= start + len) { hit = { node: n, offset: pos - start }; return true; }
    if (n.nodeType === 1 && pos <= start) { const p = n.parentNode!; hit = { node: p, offset: Array.prototype.indexOf.call(p.childNodes, n) }; return true; }
    return false;
  });
  return hit ?? { node: el, offset: el.childNodes.length };
}
/** Where a position moves when the text `a` becomes `b` (one change around the common prefix and suffix). */
function moved(a: string, b: string, pos: number): number {
  let p = 0; const max = Math.min(a.length, b.length);
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0; while (s < a.length - p && s < b.length - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  const del = a.length - p - s; const ins = b.length - p - s;
  return pos <= p ? pos : pos >= p + del ? pos - del + ins : p + ins;
}

/** The text of a Y element's content as a field shows it (XmlText characters, a <br/> as one), and positions in it. */
function yUnits(y: Y.XmlElement, cb: (t: Y.XmlText | Y.XmlElement, start: number, len: number) => boolean | void): number {
  let acc = 0;
  const walk = (n: Y.XmlElement): boolean => {
    for (const c of ydom.ychildren(n)) {
      if (c instanceof Y.XmlText) { const len = c.length; if (cb(c, acc, len)) return true; acc += len; }
      else if (c instanceof Y.XmlElement) { if (c.nodeName === 'br') { if (cb(c, acc, 1)) return true; acc += 1; } else if (walk(c)) return true; }
    }
    return false;
  };
  walk(y);
  return acc;
}

// ---------------------------------------------------------------- the binding

interface Point { slot: JsgSlot; offset: number }
interface FocusMark { owner: object; key: string | number; text: string; a: number; b: number }

export class JsgLive {
  readonly undo: Y.UndoManager;
  private readonly frag: Y.XmlFragment;
  private shadow: XMLDocument;
  private lastText: string;
  private applying = false;
  private origins: { m2e: WeakMap<object, Element>; e2m: WeakMap<Element, object> } | null = null;
  private layer: HTMLElement;
  private frame = 0;
  private presenceTimer: number | null = null;
  private lastPresence = '';
  private navObserver: MutationObserver | null = null;
  private ro: ResizeObserver | null = null;
  private closed = false;
  private readonly onDeep = (_e: unknown, tr: Y.Transaction): void => { if (tr.origin !== ORIGIN_LOCAL) this.pull(); };
  private unobserve: (() => void) | null = null;
  /** the last selection made in the sheet (a comment is written in the comments panel, which takes the focus from the words it is about) */
  private lastSel: { a: Point; b: Point } | null = null;
  private readonly onSelection = (): void => { const s = this.selection(); if (s) this.lastSel = s; this.publishSoon(); };
  private readonly redraw = (): void => this.scheduleDraw();
  private readonly onKey = (e: KeyboardEvent): void => {
    // the parts-list editor has no undo of its own: while live, Ctrl+Z / Ctrl+Y are this person's undo in the room
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (!mod || !(k === 'z' || k === 'y') || !this.ed.liveParts().root.contains(e.target as Node)) return;
    e.preventDefault(); e.stopPropagation();
    if (k === 'y' || e.shiftKey) this.redoLocal(); else this.undoLocal();
  };

  constructor(readonly ed: JsgLiveSurface & { undo?: () => void }, readonly room: LiveRoom, private user: LiveUser, private events: JsgLiveEvents) {
    injectCss('jsg-live-css', CSS);
    this.frag = room.doc.getXmlFragment(ydom.ROOT);
    this.shadow = shadowOf(room.doc);
    this.lastText = serializeJsg(ed.getDoc());
    // the tree, its blocks and their placements (ydom.ts schema 2: a moved block or plate is re-placed, its content stays)
    this.undo = new Y.UndoManager(ydom.undoScope(room.doc), { trackedOrigins: new Set([ORIGIN_LOCAL]), captureTimeout: 600 });
    ed.setCollab({
      changed: (typing) => this.local(typing),
      undo: () => this.undoLocal(),
      redo: () => this.redoLocal(),
      canUndo: () => this.undo.undoStack.length > 0,
      canRedo: () => this.undo.redoStack.length > 0,
      dirty: () => room.unacknowledged > 0,
    });
    this.unobserve = ydom.observeTree(room.doc, this.onDeep);
    room.setEvents({
      state: (s) => this.onState(s),
      status: () => this.events.changed(),
      error: (e) => this.onError(e),
      synced: (_first, reset) => { if (reset) this.takeBack('This document was reloaded from the project file.'); },
      awareness: () => { this.scheduleDraw(); this.events.changed(); },
    });
    const parts = ed.liveParts();
    parts.scroll.classList.add('jsg-live-scroll');
    this.layer = document.createElement('div');
    this.layer.className = 'jsg-live-cursors'; this.layer.setAttribute('aria-hidden', 'true'); this.layer.dataset.testid = 'collab-cursors';
    parts.scroll.appendChild(this.layer);
    parts.scroll.addEventListener('scroll', this.redraw, { passive: true });
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(this.redraw); this.ro.observe(parts.scroll); }
    document.addEventListener('selectionchange', this.onSelection);
    parts.root.addEventListener('keyup', this.onSelection);
    parts.root.addEventListener('mouseup', this.onSelection);
    parts.root.addEventListener('focusin', this.onSelection);
    if (typeof ed.undo !== 'function') document.addEventListener('keydown', this.onKey, true);
    this.navObserver = new MutationObserver(() => this.faces());
    this.navObserver.observe(parts.nav, { childList: true });
    if (room.state) this.onState(room.state);
    this.publish();
  }

  get status(): LiveStatus { return this.room.status; }
  get state(): RoomState | null { return this.room.state; }

  /** Other people in this document now (one entry per person). */
  people(): Array<{ id: string; name: string; color: string; mode: string }> {
    const out = new Map<string, { id: string; name: string; color: string; mode: string }>();
    for (const [client, st] of this.room.awareness.getStates()) {
      const s = st as AwarenessState | null;
      if (client === this.room.doc.clientID || !s?.user) continue;
      out.set(s.user.id, { id: s.user.id, name: s.user.name, color: s.user.color, mode: s.mode ?? 'editing' });
    }
    return [...out.values()];
  }

  // ------------------------------------------------------------- local -> Y

  private local(typing: boolean): void {
    if (this.applying || this.closed) return;
    if (!this.room.state?.writable) { this.takeBack(); return; }
    const text = serializeJsg(this.ed.getDoc());
    if (text === this.lastText) return;
    const next = new DOMParser().parseFromString(text, 'application/xml');
    if (!next.documentElement || next.getElementsByTagName('parsererror').length) return;
    normalizeJsgDom(next.documentElement as unknown as XNode);
    if (!typing) this.undo.stopCapturing();
    this.room.doc.transact(() => reconcileKeyed(this.frag, this.shadow as unknown as XNode, next as unknown as XNode, (a, b) => (a as unknown as Node).isEqualNode(b as unknown as Node)), ORIGIN_LOCAL);
    if (!typing) this.undo.stopCapturing();
    this.shadow = next; this.lastText = text; this.origins = null;
    this.scheduleDraw(); this.publishSoon();
  }

  // ------------------------------------------------------------- Y -> local

  /** The room changed (another person, this person's undo, an external change): the editor's model follows, the sheet changes in place. */
  private pull(): void {
    if (this.closed) return;
    this.shadow = shadowOf(this.room.doc); this.origins = null;
    let next: JsgDoc;
    try { next = readJsg(this.shadow.documentElement as unknown as JsgElement); } catch (e) { console.warn('[live] the room holds what the editor cannot read:', (e as Error).message); return; }
    const doc = this.ed.getDoc() as unknown as Rec;
    const focus = this.focusMark();
    const leaves: Leaf[] = [];
    const structural = patchObj(doc, next as unknown as Rec, leaves);
    this.lastText = serializeJsg(this.ed.getDoc());
    this.applying = true;
    try {
      if (structural || !this.refresh(leaves)) { this.ed.liveRedraw(); this.putFocus(focus); }
      this.ed.afterRemote();
    } finally { this.applying = false; }
    this.scheduleDraw(); this.events.changed();
  }

  /** Put the changed values into the fields that show them; false when a change has no field (it needs the sheet drawn again). */
  private refresh(leaves: Leaf[]): boolean {
    if (!leaves.length) return true;
    const slots = this.ed.liveSlots();
    const by = new Map<object, JsgSlot[]>();
    for (const s of slots) { const l = by.get(s.owner) ?? []; l.push(s); by.set(s.owner, l); }
    const hits: JsgSlot[] = [];
    for (const [o, k] of leaves) {
      const list = (by.get(o) ?? []).filter((s) => s.key === k);
      if (!list.length) return false;
      hits.push(...list);
    }
    for (const s of new Set(hits)) this.showKeeping(s);
    return true;
  }

  private showKeeping(slot: JsgSlot): void {
    const el = slot.el; const active = document.activeElement;
    const focused = !!active && (active === el || el.contains(active));
    if (!focused) { slot.show(); return; }
    if (el instanceof HTMLInputElement) {
      const old = el.value; const a = el.selectionStart ?? old.length; const b = el.selectionEnd ?? a;
      slot.show();
      const now = el.value; try { el.setSelectionRange(moved(old, now, a), moved(old, now, b)); } catch { /* not a text field */ }
      return;
    }
    const old = fieldText(el); const sel = this.selIn(el) ?? [old.length, old.length];
    slot.show();
    const now = fieldText(el); this.setSel(el, moved(old, now, sel[0]), moved(old, now, sel[1]));
  }

  private selIn(el: HTMLElement): [number, number] | null {
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount || !sel.anchorNode || !sel.focusNode || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return null;
    return [offsetIn(el, sel.anchorNode, sel.anchorOffset), offsetIn(el, sel.focusNode, sel.focusOffset)];
  }
  private setSel(el: HTMLElement, a: number, b: number): void {
    const sel = document.getSelection(); if (!sel) return;
    const pa = pointIn(el, a); const pb = pointIn(el, b);
    try { sel.setBaseAndExtent(pa.node, pa.offset, pb.node, pb.offset); } catch { /* the field went */ }
  }

  private slotOf(n: Node | null): JsgSlot | null {
    if (!n) return null;
    for (const s of this.ed.liveSlots()) if (s.el === n || s.el.contains(n)) return s;
    return null;
  }

  private focusMark(): FocusMark | null {
    const active = document.activeElement as HTMLElement | null;
    const slot = this.slotOf(active);
    if (!slot) return null;
    if (slot.el instanceof HTMLInputElement) { const v = slot.el.value; return { owner: slot.owner, key: slot.key, text: v, a: slot.el.selectionStart ?? v.length, b: slot.el.selectionEnd ?? v.length }; }
    const text = fieldText(slot.el); const s = this.selIn(slot.el) ?? [text.length, text.length];
    return { owner: slot.owner, key: slot.key, text, a: s[0], b: s[1] };
  }
  private putFocus(f: FocusMark | null): void {
    if (!f) return;
    const slot = this.ed.liveSlots().find((s) => s.owner === f.owner && s.key === f.key);
    if (!slot) return;
    slot.el.focus({ preventScroll: true });
    if (slot.el instanceof HTMLInputElement) { const now = slot.el.value; try { slot.el.setSelectionRange(moved(f.text, now, f.a), moved(f.text, now, f.b)); } catch { /* */ } return; }
    const now = fieldText(slot.el); this.setSel(slot.el, moved(f.text, now, f.a), moved(f.text, now, f.b));
  }

  /** The room's version replaces whatever this page changed (a refused change, a rebuilt room). */
  takeBack(reason?: string): void {
    this.pull();
    if (reason) this.events.toast(reason, 'warning');
  }

  /** A recovered draft (an earlier visit's unsaved text) becomes this person's change in the room. */
  adopt(next: JsgDoc): void {
    patchObj(this.ed.getDoc() as unknown as Rec, next as unknown as Rec, []);
    this.ed.liveRedraw(); this.ed.afterRemote();
    this.local(false);
  }

  private onState(s: RoomState): void {
    this.publish();
    this.events.writable(!!s.writable);
    this.events.changed();
  }

  private onError(e: CollabError): void {
    if (e.code === 'READ_ONLY') { this.takeBack(e.message); return; }
    this.events.toast(e.message, e.code === 'EXTERNAL_CHANGE' ? 'info' : e.code === 'WRITE_BACK_REFUSED' ? 'warning' : 'error');
  }

  undoLocal(): void { if (this.undo.undoStack.length) this.undo.undo(); }
  redoLocal(): void { if (this.undo.redoStack.length) this.undo.redo(); }

  // ------------------------------------------------------------- positions: model objects <-> the room's elements

  private ensureOrigins(): { m2e: WeakMap<object, Element>; e2m: WeakMap<Element, object> } | null {
    if (this.origins) return this.origins;
    const root = this.shadow.documentElement; if (!root) return null;
    const tmp = new Map<object, Element>();
    let temp: JsgDoc;
    try { temp = readJsgWith(root as unknown as JsgElement, (o, el) => tmp.set(o, el as unknown as Element)); } catch { return null; }
    const m2e = new WeakMap<object, Element>(); const e2m = new WeakMap<Element, object>();
    const pair = (a: unknown, b: unknown): void => {
      if (!isObj(a) || !isObj(b)) return;
      const el = tmp.get(b); if (el) { m2e.set(a, el); e2m.set(el, a); }
      if (Array.isArray(a) && Array.isArray(b)) { for (let i = 0; i < Math.min(a.length, b.length); i++) pair(a[i], b[i]); return; }
      for (const k of Object.keys(b)) if (isObj(b[k])) pair(a[k], b[k]);
    };
    pair(this.ed.getDoc(), temp);
    this.origins = { m2e, e2m };
    return this.origins;
  }
  private yOfEl(el: Element): ydom.YNode | null {
    const p = pathOf(this.shadow as unknown as XNode, el as unknown as XNode); if (!p) return null;
    const y = yAt(this.frag, p);
    return y instanceof Y.XmlElement || y instanceof Y.XmlText ? y : null;
  }
  private elOfY(y: ydom.YNode | ydom.YParent): Element | null {
    const p = yPathOf(this.frag, y); if (!p) return null;
    let n: XNode = this.shadow as unknown as XNode;
    for (const i of p) { const k = ydom.domChildren(n)[i]; if (!k) return null; n = k; }
    return n.nodeType === 1 ? (n as unknown as Element) : null;
  }
  /** The object a field edits whose element is in the room (a rich field: its paragraph, text part or note; a plain field: the object holding the attribute). */
  private targetOf(slot: JsgSlot): object { return Array.isArray(slot.owner) ? ((slot.owner as unknown[])[slot.key as number] as object) : slot.owner; }
  private slotFor(obj: object | undefined, rich: boolean, attr?: string): JsgSlot | null {
    if (!obj) return null;
    for (const s of this.ed.liveSlots()) {
      if (rich ? s.kind === 'rich' && this.targetOf(s) === obj : (s.kind === 'title' || s.kind === 'input') && s.owner === obj && s.key === attr) return s;
    }
    return null;
  }

  /** A place in a field as a position in the room: base64 for rich text (it follows the characters), "A|attr|offset|name|base64" for a field held in an attribute. */
  private encode(p: Point): string | null {
    const o = this.ensureOrigins(); if (!o) return null;
    const el = o.m2e.get(this.targetOf(p.slot)); if (!el) return null;
    const y = this.yOfEl(el); if (!(y instanceof Y.XmlElement)) return null;
    try {
      if (p.slot.kind === 'rich') {
        let rel: Y.RelativePosition | null = null;
        yUnits(y, (t, start, len) => { if (t instanceof Y.XmlText && p.offset <= start + len) { rel = Y.createRelativePositionFromTypeIndex(t, p.offset - start); return true; } return false; });
        rel ??= Y.createRelativePositionFromTypeIndex(y, y.length);
        return toBase64(Y.encodeRelativePosition(rel));
      }
      // inside the element itself: it follows the element wherever it is moved (a block, ydom.ts schema 2)
      const rel = Y.createRelativePositionFromTypeIndex(y, 0);
      return `A|${String(p.slot.key)}|${p.offset}|${y.nodeName}|${toBase64(Y.encodeRelativePosition(rel))}`;
    } catch { return null; }
  }
  private decode(s: string): Point | null {
    const o = this.ensureOrigins(); if (!o) return null;
    try {
      if (s.startsWith('A|')) {
        const [, attr, off, name, b64] = s.split('|');
        const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(b64)), this.room.doc);
        if (!abs || !(abs.type instanceof Y.XmlElement || abs.type instanceof Y.XmlFragment)) return null;
        // the element itself (positions made since Phase 8), or the child at a place in its parent (older anchors)
        const y = abs.type instanceof Y.XmlElement && abs.type.nodeName === name ? abs.type : ydom.liveAt(abs.type, abs.index);
        if (!(y instanceof Y.XmlElement) || y.nodeName !== name) return null;
        const el = this.elOfY(y); const slot = this.slotFor(el ? o.e2m.get(el) : undefined, false, attr);
        return slot ? { slot, offset: Number(off) || 0 } : null;
      }
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(s)), this.room.doc);
      if (!abs) return null;
      for (let y: unknown = abs.type instanceof Y.XmlText ? ydom.treeParent(abs.type) : abs.type; y instanceof Y.XmlElement; y = ydom.treeParent(y)) {
        const el = this.elOfY(y); const slot = this.slotFor(el ? o.e2m.get(el) : undefined, true);
        if (!slot) continue;
        let offset = 0;
        if (abs.type instanceof Y.XmlText) { const t = abs.type; yUnits(y, (u, start) => { if (u === t) { offset = start + abs.index; return true; } return false; }); }
        else if (abs.type === y) { const stop = ydom.liveAt(y, abs.index); let found = -1; const total = yUnits(y, (u, start) => { if (stop && (u === stop || (stop instanceof Y.XmlElement && isInside(u, stop)))) { found = start; return true; } return false; }); offset = found >= 0 ? found : total; }
        return { slot, offset };
      }
      // a heading's or field's anchor made by a comment on it (the element's place in its parent)
      if (abs.type instanceof Y.XmlElement || abs.type instanceof Y.XmlFragment) {
        const y = ydom.liveAt(abs.type, abs.index);
        if (y instanceof Y.XmlElement) { const el = this.elOfY(y); const obj = el ? o.e2m.get(el) : undefined; const slot = obj ? this.ed.liveSlots().find((x) => x.owner === obj && x.kind !== 'cell') ?? null : null; if (slot) return { slot, offset: 0 }; }
      }
      return null;
    } catch { return null; }
  }

  /** This person's selection as two places in a field (null: not in a field). */
  private selection(): { a: Point; b: Point } | null {
    const active = document.activeElement as HTMLElement | null;
    const sel = document.getSelection();
    let slot = active instanceof HTMLInputElement ? this.slotOf(active) : null;
    if (slot && slot.el instanceof HTMLInputElement) {
      const a = slot.el.selectionStart ?? 0; const b = slot.el.selectionEnd ?? a;
      return slot.kind === 'cell' ? null : { a: { slot, offset: a }, b: { slot, offset: b } };
    }
    slot = this.slotOf(sel?.anchorNode ?? null);
    if (!slot || slot.kind === 'cell' || slot.kind === 'input') return null;
    const r = this.selIn(slot.el); if (!r) return null;
    return { a: { slot, offset: r[0] }, b: { slot, offset: r[1] } };
  }

  // ------------------------------------------------------------- presence

  private publishSoon(): void {
    if (this.presenceTimer !== null || this.closed) return;
    this.presenceTimer = window.setTimeout(() => { this.presenceTimer = null; this.publish(); }, 120);
  }
  private publish(): void {
    if (this.closed) return;
    const s = this.selection();
    const anchor = s ? this.encode(s.a) : null; const head = s ? this.encode(s.b) : null;
    const state: AwarenessState = {
      user: { id: this.user.id, name: this.user.name, color: colorFor(this.user.id) },
      cursor: anchor && head ? { anchor, head } : null,
      mode: this.room.state?.writable ? 'editing' : 'viewing',
    };
    const key = JSON.stringify(state);
    if (key === this.lastPresence) return;
    this.lastPresence = key;
    try { this.room.setPresence(state); } catch { /* the room closed */ }
  }

  private scheduleDraw(): void { if (!this.frame && !this.closed) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); this.faces(); }); }

  /** The other people's carets and selections, drawn over the sheet (they never catch the pointer). */
  private draw(): void {
    const scroll = this.ed.liveParts().scroll;
    if (this.layer.parentElement !== scroll) scroll.appendChild(this.layer);
    const box = scroll.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    const at = (rc: DOMRect | { left: number; top: number; width: number; height: number }) => ({ left: `${rc.left - box.left + scroll.scrollLeft}px`, top: `${rc.top - box.top + scroll.scrollTop}px` });
    for (const [client, st] of this.room.awareness.getStates()) {
      const s = st as AwarenessState | null;
      if (client === this.room.doc.clientID || !s?.user || !s.cursor) continue;
      const head = this.decode(s.cursor.head); if (!head) continue;
      const anchor = this.decode(s.cursor.anchor);
      const color = `var(--${PRESENCE_COLORS.includes(s.user.color) ? s.user.color : 'accent'})`;
      try {
        let caretRect: DOMRect | null = null;
        const el = head.slot.el;
        if (el instanceof HTMLInputElement) {
          const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          const ctx = document.createElement('canvas').getContext('2d');
          let x = r.left + parseFloat(cs.paddingLeft || '0');
          if (ctx) { ctx.font = cs.font; x += ctx.measureText(el.value.slice(0, head.offset)).width - el.scrollLeft; }
          caretRect = new DOMRect(Math.min(x, r.right - 2), r.top + 2, 0, r.height - 4);
          if (anchor && anchor.slot === head.slot && anchor.offset !== head.offset) {
            const band = document.createElement('span'); band.className = 'collab-sel'; band.style.setProperty('--collab-color', color);
            Object.assign(band.style, at(r), { width: `${r.width}px`, height: `${r.height}px` }); frag.appendChild(band);
          }
        } else {
          const p = pointIn(el, head.offset);
          const range = document.createRange();
          if (anchor && anchor.slot === head.slot && anchor.offset !== head.offset) {
            const a = pointIn(el, Math.min(anchor.offset, head.offset)); const b = pointIn(el, Math.max(anchor.offset, head.offset));
            range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
            for (const rc of Array.from(range.getClientRects())) {
              const band = document.createElement('span'); band.className = 'collab-sel'; band.style.setProperty('--collab-color', color);
              Object.assign(band.style, at(rc), { width: `${rc.width}px`, height: `${rc.height}px` }); frag.appendChild(band);
            }
          }
          range.setStart(p.node, p.offset); range.collapse(true);
          caretRect = range.getClientRects()[0] ?? el.getBoundingClientRect();
        }
        if (!caretRect) continue;
        const caret = document.createElement('span'); caret.className = 'collab-caret'; caret.style.setProperty('--collab-color', color);
        Object.assign(caret.style, at(caretRect), { height: `${Math.max(12, caretRect.height)}px` });
        const tag = document.createElement('span'); tag.className = 'collab-name'; tag.textContent = s.user.name;
        caret.dataset.user = s.user.id;
        caret.appendChild(tag);
        frag.appendChild(caret);
      } catch { /* a place the sheet cannot show */ }
    }
    this.layer.replaceChildren(frag);
  }

  /** Who is where, in the outline: a face on the chapter, section, plate or appendix row each other person is in. */
  private faces(): void {
    if (this.closed) return;
    const nav = this.ed.liveParts().nav;
    this.navObserver?.disconnect();
    try {
      nav.querySelectorAll('.jsg-live-faces').forEach((e) => e.remove());
      const rows = Array.from(nav.querySelectorAll<HTMLElement>('a'));
      const root = ykids(this.frag)[0];
      if (!(root instanceof Y.XmlElement)) return;
      const targets: Y.XmlElement[] = [];
      const els = (y: Y.XmlElement, name: string): Y.XmlElement[] => ykids(y).filter((c): c is Y.XmlElement => c instanceof Y.XmlElement && c.nodeName === name);
      for (const ch of els(root, 'chapter')) { targets.push(ch); targets.push(...els(ch, 'section')); }
      for (const pl of els(root, 'plates')) targets.push(...els(pl, 'plate'));
      for (const ap of els(root, 'appendices')) targets.push(...els(ap, 'appendix'));
      if (targets.length !== rows.length) return;
      const index = new Map<unknown, number>(targets.map((t, i) => [t, i]));
      const here = new Map<number, Array<{ id: string; name: string; color: string }>>();
      for (const [client, st] of this.room.awareness.getStates()) {
        const s = st as AwarenessState | null;
        if (client === this.room.doc.clientID || !s?.user || !s.cursor) continue;
        const y = this.yOfCursor(s.cursor.head); if (!y) continue;
        let row = -1;
        for (let n: unknown = y; n && row < 0; n = ydom.treeParent(n)) { const i = index.get(n); if (i !== undefined) row = i; }
        if (row < 0) continue;
        const l = here.get(row) ?? []; if (!l.some((p) => p.id === s.user.id)) l.push({ id: s.user.id, name: s.user.name, color: s.user.color }); here.set(row, l);
      }
      for (const [row, people] of here) {
        const box = document.createElement('span'); box.className = 'jsg-live-faces'; box.dataset.testid = 'jsg-row-people';
        box.title = people.map((p) => p.name).join(', ');
        for (const p of people) {
          const f = document.createElement('span'); f.className = 'f'; f.textContent = p.name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
          f.style.setProperty('--collab-color', `var(--${PRESENCE_COLORS.includes(p.color) ? p.color : 'accent'})`);
          box.appendChild(f);
        }
        rows[row].appendChild(box);
      }
    } finally { this.navObserver?.observe(nav, { childList: true }); }
  }
  private yOfCursor(s: string): unknown {
    try {
      const b64 = s.startsWith('A|') ? s.split('|')[4] : s;
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(b64)), this.room.doc);
      if (!abs) return null;
      if (s.startsWith('A|') && (abs.type instanceof Y.XmlElement || abs.type instanceof Y.XmlFragment)) {
        const name = s.split('|')[3];
        if (abs.type instanceof Y.XmlElement && abs.type.nodeName === name) return abs.type;
        return ydom.liveAt(abs.type, abs.index) ?? abs.type;
      }
      return abs.type;
    } catch { return null; }
  }

  // ------------------------------------------------------------- saving and comments


  /** The comment anchor of the selection: the room's positions of its two ends (they follow the words), and its place and words. */
  commentAnchor(): { file: string; anchor: { path: string; tag: string; text: string; y?: { start: string; end: string } } } | null {
    const s = this.selection() ?? (this.lastSel && this.lastSel.a.slot.el.isConnected ? this.lastSel : null); if (!s) return null;
    const o = this.ensureOrigins(); const el = o?.m2e.get(this.targetOf(s.a.slot)); if (!el) return null;
    const path = pathOf(this.shadow as unknown as XNode, el as unknown as XNode); if (!path || !path.length) return null;
    const words = s.a.slot.el instanceof HTMLInputElement ? s.a.slot.el.value : fieldText(s.a.slot.el);
    const picked = words.slice(Math.min(s.a.offset, s.b.offset), Math.max(s.a.offset, s.b.offset)).trim() || words;
    let y: { start: string; end: string } | undefined;
    if (s.a.slot.kind === 'rich') { const a = this.encode(s.a); const b = this.encode(s.b); if (a && b) y = { start: a, end: b }; }
    else { const a = this.encode(s.a); const b64 = a?.split('|')[4]; if (b64) y = { start: b64, end: b64 }; }
    return { file: JSG_COMMENTS_FILE, anchor: { path: path.join('/'), tag: el.nodeName, text: picked.replace(/\s+/g, ' ').slice(0, 200), ...(y ? { y } : {}) } };
  }

  /** Show a comment's words (followed through everyone's edits) and select them. */
  reveal(anchor: { y?: { start: string; end: string } }): boolean {
    if (!anchor.y) return false;
    const a = this.decode(anchor.y.start); const b = this.decode(anchor.y.end) ?? a;
    if (!a || !b) return false;
    const el = a.slot.el;
    el.scrollIntoView?.({ block: 'center' });
    if (el instanceof HTMLInputElement) { if (!el.disabled) { el.focus(); el.select(); } }
    else if (a.slot === b.slot) this.setSel(el, Math.min(a.offset, b.offset), Math.max(a.offset, b.offset));
    el.classList.remove('jsg-flash'); void el.offsetWidth; el.classList.add('jsg-flash'); window.setTimeout(() => el.classList.remove('jsg-flash'), 1700);
    return true;
  }

  /** Unbind from the editor (it is destroyed or rebuilt); `leave`: also leave the room. */
  close(leave = false): void {
    if (this.closed) return;
    this.closed = true;
    if (this.presenceTimer !== null) window.clearTimeout(this.presenceTimer);
    if (this.frame) cancelAnimationFrame(this.frame);
    const parts = this.ed.liveParts();
    parts.scroll.removeEventListener('scroll', this.redraw);
    parts.root.removeEventListener('keyup', this.onSelection);
    parts.root.removeEventListener('mouseup', this.onSelection);
    parts.root.removeEventListener('focusin', this.onSelection);
    document.removeEventListener('selectionchange', this.onSelection);
    document.removeEventListener('keydown', this.onKey, true);
    this.ro?.disconnect(); this.navObserver?.disconnect();
    this.layer.remove();
    try { this.unobserve?.(); this.unobserve = null; } catch { /* destroyed */ }
    this.undo.destroy();
    this.ed.setCollab(null);
    try { this.room.setEvents({}); this.room.setPresence(null); } catch { /* the room closed */ }
    if (leave) this.room.close();
  }
}

function isInside(n: unknown, ancestor: Y.XmlElement): boolean {
  for (let p: unknown = ydom.treeParent(n); p; p = ydom.treeParent(p)) if (p === ancestor) return true;
  return false;
}
