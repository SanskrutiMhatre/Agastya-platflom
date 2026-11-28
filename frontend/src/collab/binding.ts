// =============================================================================
// Live co-editing (Phase 3, P3-1): the binding between the S1000D Studio's document (an XMLDocument the editing logic changes inside
// transactions, studio/core/document.ts) and the room's Y document (the schema of backend/src/shared/collab/ydom.ts: one Y node per DOM
// node, so an index in one is an index in the other).
//
//   local -> Y   Every change the editor reports (its MutationRecords) is pushed to the Y nodes bound to the changed DOM nodes, with the
//                fewest Y operations: a text change is one delete + one insert around the common prefix and suffix (two people typing in
//                one paragraph merge character by character); a change of an element's children keeps every child that is still there
//                (the longest run in the same order) and only deletes and inserts the rest, so a paragraph someone else is typing in keeps
//                its identity when another paragraph is added before it. Nothing in the editing logic changes (decision D16).
//   Y -> local   Another person's change (and this person's undo, which Y.UndoManager makes in Y) is applied to the DOM through
//                EditorDocument.applyRemote: the same records reach the views, which re-render only the elements that changed, and live
//                validation runs on the merged document. The caret of this person is kept where it was in the text.
//   Read-only    A person who may not write now (reviewer, someone else's check-out, review lock) cannot change the canvas (the editor
//                refuses, DocumentEditor.setLock); a change that gets through anyway (the XML view) is taken back from the room's version.
// =============================================================================

import * as Y from 'yjs';
import * as ydom from '../../../backend/src/shared/collab/ydom';
import type { XNode } from '../../../backend/src/shared/collab/xmlForm';
import type { EditorDocument, ChangeEvent, ModelPos, ModelSelection } from '../studio/core/document';
import { ORIGIN_LOCAL } from './client';
import { toBase64, fromBase64 } from '../../../backend/src/shared/collab/protocol';

type YAny = Y.XmlElement | Y.XmlText | Y.XmlFragment;
const isY = (c: unknown): c is ydom.YNode => c instanceof Y.XmlElement || c instanceof Y.XmlText;
const ykids = (y: YAny): ydom.YNode[] => (y instanceof Y.XmlText ? [] : y.toArray().filter(isY));
const yParent = (y: ydom.YNode): unknown => (y as unknown as { parent: unknown }).parent;
const yDeleted = (y: unknown): boolean => !!(y as { _item?: { deleted?: boolean } | null })._item?.deleted;
const asX = (n: Node): XNode => n as unknown as XNode;
const asNode = (n: XNode): Node => n as unknown as Node;

/** The longest increasing subsequence of `a` (indices into `a`). */
function lis(a: number[]): Set<number> {
  const tails: number[] = []; const prev = new Array<number>(a.length).fill(-1);
  for (let i = 0; i < a.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[tails[mid]] < a[i]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out = new Set<number>();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.add(k);
  return out;
}

export interface BindingOptions {
  /** may this person change the document now? */
  canWrite(): boolean;
  /** a local change was refused (read-only) and taken back */
  onRefused?(reason: string): void;
  /** remote changes were applied (the editor puts the caret back) */
  onRemote?(): void;
}

export class DomBinding {
  private d2y = new WeakMap<Node, YAny>();
  private y2d = new WeakMap<object, Node>();
  private applying = false;
  private historyKind: 'undo' | 'redo' | null = null;
  readonly undo: Y.UndoManager;
  private readonly frag: Y.XmlFragment;
  private readonly onChange = (e: Event): void => this.local((e as CustomEvent<ChangeEvent>).detail);
  private readonly onDeep = (events: Array<Y.YEvent<YAny>>, tr: Y.Transaction): void => this.remote(events, tr);
  private readonly onMeta = (_e: unknown, tr: Y.Transaction): void => this.remoteMeta(tr);

  constructor(readonly doc: EditorDocument, readonly ydoc: Y.Doc, private opts: BindingOptions) {
    this.frag = ydoc.getXmlFragment(ydom.ROOT);
    this.bindAll();
    this.undo = new Y.UndoManager([this.frag, ydoc.getMap(ydom.META), ydoc.getArray(ydom.DECLS)], { trackedOrigins: new Set([ORIGIN_LOCAL]), captureTimeout: 600 });
    // the caret goes back to where the undone change was
    this.undo.on('stack-item-added', (ev: { stackItem: { meta: Map<string, unknown> } }) => { const r = this.relOf(this.doc.selection?.focus ?? null); if (r) ev.stackItem.meta.set('sel', r); });
    this.undo.on('stack-item-popped', (ev: { stackItem: { meta: Map<string, unknown> } }) => {
      const r = ev.stackItem.meta.get('sel'); const p = typeof r === 'string' ? this.posOf(r) : null;
      if (p) this.doc.selection = { anchor: p, focus: p };
    });
    this.frag.observeDeep(this.onDeep);
    ydoc.getMap(ydom.META).observe(this.onMeta);
    ydoc.getArray(ydom.DECLS).observe(this.onMeta);
    doc.addEventListener('change', this.onChange);
  }

  destroy(): void {
    this.doc.removeEventListener('change', this.onChange);
    this.frag.unobserveDeep(this.onDeep);
    this.ydoc.getMap(ydom.META).unobserve(this.onMeta);
    this.ydoc.getArray(ydom.DECLS).unobserve(this.onMeta);
    this.undo.destroy();
  }

  private bind(d: Node, y: YAny): void { this.d2y.set(d, y); this.y2d.set(y, d); }
  private readonly binder = (d: XNode, y: ydom.YNode): void => this.bind(asNode(d), y);

  /** Pair the opened document with the room's content (made from the same text, so they match); whatever differs takes the room's form. */
  private bindAll(): void {
    this.bind(this.doc.xml, this.frag);
    this.doc.applyRemote('Live document', () => this.pull(this.frag, this.doc.xml, true));
  }

  // ------------------------------------------------------------- Y -> DOM

  private factory(): ydom.XFactory { return this.doc.xml as unknown as ydom.XFactory; }

  /** Make the DOM children of `d` those of `y`. `deep`: also every descendant (binding, and taking back a refused change). */
  private pull(y: YAny, d: Node, deep: boolean): void {
    const want: Node[] = [];
    const cur = ydom.domChildren(asX(d)).map(asNode);
    const free = cur.filter((c) => !this.d2y.has(c) || yDeleted(this.d2y.get(c)) || this.d2y.get(c) === undefined);
    const lookup = ydom.lookupFor(d.nodeType === 1 ? asX(d) : null);
    let fi = 0;
    for (const yc of ykids(y)) {
      let dc = this.y2d.get(yc);
      if (dc && dc.parentNode !== d) dc = undefined;
      if (!dc) {
        // an unbound DOM node of the same kind at this place is the same node (binding a document opened from the room's own text)
        while (fi < free.length && free[fi].parentNode !== d) fi++;
        const cand = free[fi];
        if (cand && ydom.kindOfDom(asX(cand)) === ydom.kindOfY(yc) && !this.d2y.has(cand)) {
          fi++;
          this.bind(cand, yc);
          this.pullNode(yc, cand, true);
          dc = cand;
        } else {
          const made = ydom.domFromY(yc, this.factory(), lookup, this.binder);
          if (!made) continue;
          dc = asNode(made);
        }
      } else if (deep) this.pullNode(yc, dc, true);
      want.push(dc);
    }
    const keep = new Set(want);
    for (const c of cur) if (!keep.has(c)) { d.removeChild(c); }
    // order: walk the wanted list and put each node in place (unmapped nodes, such as the DOCTYPE, stay where they are)
    let ref: Node | null = this.firstMapped(d);
    for (const w of want) {
      if (w === ref) { ref = this.nextMapped(w); continue; }
      d.insertBefore(w, ref);
    }
  }
  private firstMapped(d: Node): Node | null { let c = d.firstChild; while (c && !this.isMapped(d, c)) c = c.nextSibling; return c; }
  private nextMapped(n: Node): Node | null { let c = n.nextSibling; while (c && !this.isMapped(n.parentNode!, c)) c = c.nextSibling; return c; }
  private isMapped(parent: Node, c: Node): boolean { return ydom.mapped(asX(c)) && !(parent.nodeType === 9 && c.nodeType === 3); }

  /** Make one DOM node's own content (text, attributes, comment data) that of its Y node. */
  private pullNode(y: YAny, d: Node, deep: boolean): void {
    if (y instanceof Y.XmlText) { this.setText(d, ydom.textValue(y)); return; }
    if (y instanceof Y.XmlElement) {
      const attrs = y.getAttributes() as Record<string, string>;
      if (d.nodeType === 1) {
        const el = d as Element;
        const look = ydom.lookupFor(asX(el));
        for (const a of Array.from(el.attributes)) if (!(a.name in attrs)) el.removeAttributeNode(a);
        for (const [k, v] of Object.entries(attrs)) if (typeof v === 'string' && el.getAttribute(k) !== v) ydom.setDomAttr(el as unknown as ydom.XBuildElement, k, v, look);
        if (deep) this.pull(y, d, true);
      } else if (d.nodeType === 7) {
        if ((d as ProcessingInstruction).data !== String(attrs.data ?? '')) (d as ProcessingInstruction).data = String(attrs.data ?? '');
      } else if (d.nodeValue !== String(attrs.data ?? '')) d.nodeValue = String(attrs.data ?? '');
      return;
    }
    if (deep) this.pull(y, d, true);
  }

  /** Replace a text node's characters around the common prefix and suffix, and keep the caret on the same character. */
  private setText(d: Node, next: string): void {
    const t = d as CharacterData;
    const cur = t.data;
    if (cur === next) return;
    let p = 0; const max = Math.min(cur.length, next.length);
    while (p < max && cur.charCodeAt(p) === next.charCodeAt(p)) p++;
    let s = 0;
    while (s < cur.length - p && s < next.length - p && cur.charCodeAt(cur.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
    const del = cur.length - p - s; const ins = next.length - p - s;
    t.replaceData(p, del, next.slice(p, p + ins));
    const sel = this.doc.selection;
    if (!sel) return;
    const fix = (pos: ModelPos): ModelPos => {
      if (pos.node !== d || pos.offset <= p) return pos;
      return { node: pos.node, offset: pos.offset >= p + del ? pos.offset - del + ins : p + ins };
    };
    const next2: ModelSelection = { ...sel, anchor: fix(sel.anchor), focus: fix(sel.focus) };
    if (next2.anchor !== sel.anchor || next2.focus !== sel.focus) this.doc.selection = next2;
  }

  private remote(events: Array<Y.YEvent<YAny>>, tr: Y.Transaction): void {
    if (tr.origin === ORIGIN_LOCAL) return;
    const kind = tr.origin === this.undo ? (this.historyKind ?? 'undo') : 'remote';
    const sorted = [...events].sort((a, b) => a.path.length - b.path.length);
    this.applying = true;
    try {
      this.doc.applyRemote(kind === 'remote' ? 'Change by another author' : kind === 'undo' ? 'Undo' : 'Redo', () => {
        for (const ev of sorted) {
          const t = ev.target;
          if (yDeleted(t)) continue;
          const d = t === this.frag ? this.doc.xml : this.y2d.get(t);
          if (!d || (d !== this.doc.xml && !this.doc.xml.contains(d))) continue;
          if (t instanceof Y.XmlText) { this.setText(d, ydom.textValue(t)); continue; }
          if (t instanceof Y.XmlElement && (ev as Y.YXmlEvent).attributesChanged.size) this.pullNode(t, d, false);
          if (ev.changes.delta.length) this.pull(t, d, false);
        }
      }, kind);
    } finally { this.applying = false; }
    this.opts.onRemote?.();
  }

  private remoteMeta(tr: Y.Transaction): void {
    if (tr.origin === ORIGIN_LOCAL) return;
    const dt = ydom.readDoctype(this.ydoc);
    const decl = ydom.readXmlDecl(this.ydoc);
    const dtChanged = JSON.stringify(dt) !== JSON.stringify(this.doc.doctype);
    if (decl !== this.doc.xmlDecl) this.doc.xmlDecl = decl;
    if (!dtChanged) return;
    this.applying = true;
    try { this.doc.applyRemote('DOCTYPE changed by another author', () => { this.doc.doctype = dt; }, 'remote', true); } finally { this.applying = false; }
  }

  // ------------------------------------------------------------- DOM -> Y

  private local(ev: ChangeEvent): void {
    if (this.applying || ev.kind === 'remote' || ev.kind === 'load') return;
    if (!this.opts.canWrite()) { this.takeBack(); return; }
    const targets: Node[] = [];
    const seen = new Set<Node>();
    for (const r of ev.records) {
      const t = r.target;
      if (seen.has(t)) continue;
      seen.add(t); targets.push(t);
    }
    // parents first: an element created by its parent's change is already in step when its own records come
    targets.sort((a, b) => depth(a) - depth(b));
    // typing merges into one undo step (as in the Studio); any other command is a step of its own
    const typing = /^(Typing|Delete backward|Delete forward)$/.test(ev.label);
    if (!typing) this.undo.stopCapturing();
    this.ydoc.transact(() => {
      for (const t of targets) this.push(t);
      if (ev.doctypeChanged) ydom.writeDoctype(this.ydoc, this.doc.doctype);
      ydom.writeXmlDecl(this.ydoc, this.doc.xmlDecl);
    }, ORIGIN_LOCAL);
    if (!typing) this.undo.stopCapturing();
  }

  /** The room's version replaces whatever changed here (a refused local change). */
  takeBack(reason = 'You cannot change this document now.'): void {
    this.applying = true;
    try { this.doc.applyRemote('Change taken back', () => this.pull(this.frag, this.doc.xml, true)); } finally { this.applying = false; }
    this.opts.onRefused?.(reason);
  }

  private push(t: Node): void {
    if (t !== this.doc.xml && !this.doc.xml.contains(t)) return;              // removed since: its parent's record says so
    const y = this.d2y.get(t);
    if (!y || yDeleted(y)) {
      // not bound (should not happen: parents come first): the nearest bound ancestor is brought into step, all the way down
      let a: Node | null = t.parentNode;
      while (a && (!this.d2y.get(a) || yDeleted(this.d2y.get(a)))) a = a.parentNode;
      if (a) this.pushDeep(a);
      return;
    }
    if (y instanceof Y.XmlText) { if (t.nodeType === 3) ydom.diffText(y, t.nodeValue ?? ''); return; }
    if (y instanceof Y.XmlElement && t.nodeType !== 9) ydom.syncAttributes(y, asX(t));
    this.pushChildren(t, y);
  }

  private pushDeep(t: Node): void {
    const y = this.d2y.get(t);
    if (!y) return;
    if (y instanceof Y.XmlText) { ydom.diffText(y, t.nodeValue ?? ''); return; }
    if (y instanceof Y.XmlElement && t.nodeType !== 9) ydom.syncAttributes(y, asX(t));
    this.pushChildren(t, y);
    for (const c of ydom.domChildren(asX(t)).map(asNode)) this.pushDeep(c);
  }

  /** Make the Y children of `y` those of `d`: keep the longest run of children still there in the same order, delete and insert the rest. */
  private pushChildren(d: Node, y: Y.XmlElement | Y.XmlFragment): void {
    const dk = ydom.domChildren(asX(d)).map(asNode);
    const yk = ykids(y);
    const index = new Map<unknown, number>(); yk.forEach((c, i) => index.set(c, i));
    // DOM children bound to a child of this Y parent, in DOM order, with their Y index
    const cand: Array<{ di: number; yi: number }> = [];
    dk.forEach((c, di) => {
      const b = this.d2y.get(c);
      if (b && isY(b) && yParent(b) === y && !yDeleted(b) && ydom.kindOfDom(asX(c)) === ydom.kindOfY(b)) { const yi = index.get(b); if (yi !== undefined) cand.push({ di, yi }); }
    });
    const keepIdx = lis(cand.map((c) => c.yi));
    const keptY = new Set<number>(); const keptD = new Set<number>();
    cand.forEach((c, i) => { if (keepIdx.has(i)) { keptY.add(c.yi); keptD.add(c.di); } });
    // delete what is not kept, from the end (runs at once)
    for (let i = yk.length - 1; i >= 0;) {
      if (keptY.has(i)) { i--; continue; }
      let j = i; while (j - 1 >= 0 && !keptY.has(j - 1)) j--;
      y.delete(j, i - j + 1);
      i = j - 1;
    }
    // insert the new ones at their places (consecutive new ones in one insert)
    let at = 0; let run: ydom.YNode[] = []; let runAt = 0;
    const flush = (): void => { if (run.length) { y.insert(runAt, run); at += run.length; run = []; } };
    dk.forEach((c, di) => {
      if (keptD.has(di)) { flush(); at++; return; }
      const made = ydom.yFromDom(asX(c), this.binder);
      if (!made) return;
      if (!run.length) runAt = at;
      run.push(made);
    });
    flush();
  }

  // ------------------------------------------------------------- history and positions

  undoLocal(): boolean {
    if (!this.undo.undoStack.length) return false;
    this.historyKind = 'undo';
    try { this.undo.undo(); } finally { this.historyKind = null; }
    return true;
  }
  redoLocal(): boolean {
    if (!this.undo.redoStack.length) return false;
    this.historyKind = 'redo';
    try { this.undo.redo(); } finally { this.historyKind = null; }
    return true;
  }
  /** Typing pauses split undo steps the way the Studio does (an explicit command ends the current step). */
  stopCapturing(): void { this.undo.stopCapturing(); }

  /** A position in the document as a Y relative position (base64): it stays on the same character while others edit around it. */
  relOf(pos: ModelPos | null): string | null {
    if (!pos || !pos.node.isConnected) return null;
    const y = this.d2y.get(pos.node);
    if (!y || yDeleted(y)) return null;
    try { return toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(y, pos.offset))); } catch { return null; }
  }
  posOf(rel: string): ModelPos | null {
    try {
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(rel)), this.ydoc);
      if (!abs) return null;
      const d = abs.type === this.frag ? this.doc.xml : this.y2d.get(abs.type);
      if (!d || !d.isConnected) return null;
      return { node: d, offset: abs.index };
    } catch { return null; }
  }
  /** The Y node of a DOM node (comments anchor to it). */
  yOf(n: Node): YAny | null { return this.d2y.get(n) ?? null; }
}

function depth(n: Node): number { let k = 0; for (let p = n.parentNode; p; p = p.parentNode) k++; return k; }
