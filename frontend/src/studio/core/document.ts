/**
 * EditorDocument: the single source of truth for an open data module.
 *
 * The XML DOM (an XMLDocument) is edited directly by commands inside
 * transactions. A MutationObserver records every DOM change; undo/redo replays
 * inverse mutations, so any operation (structured command, typing, attribute
 * edit, XML-view reconciliation) is undoable without bespoke inverse logic.
 * DOCTYPE edits (ICN entity declarations) are recorded as custom changes.
 */
import { Grammar, loadGrammar } from './grammar';
import { Doctype, ParsedXml, normalizeWhitespace, parseXml, serialize, SerializeResult } from './xml';
import { detectSchema, readIdent, SchemaRef, dmFileName } from './s1000d';

export interface ModelPos {
  node: Node;
  offset: number;
}

export interface ModelSelection {
  anchor: ModelPos;
  focus: ModelPos;
  /** Whole element selected (element-selection mode). */
  element?: Element | null;
}

type Change =
  | { type: 'mutation'; record: MutationRecord; newValue?: string | null; synthetic?: boolean }
  | { type: 'doctype'; before: Doctype | null; after: Doctype | null };

interface HistoryEntry {
  label: string;
  changes: Change[];
  selBefore: ModelSelection | null;
  selAfter: ModelSelection | null;
  time: number;
  merge?: string;
  seq: number;
}

export interface ChangeEvent {
  label: string;
  source: string;
  records: MutationRecord[];
  doctypeChanged: boolean;
  /** Elements whose content/attributes changed (deduplicated, still attached). */
  touched: Set<Node>;
  kind: 'edit' | 'undo' | 'redo' | 'load';
}

export interface TransactOptions {
  source?: string;
  merge?: string;
  selectionBefore?: ModelSelection | null;
  selectionAfter?: ModelSelection | null;
}

export class EditorDocument extends EventTarget {
  xml!: XMLDocument;
  doctype: Doctype | null = null;
  xmlDecl: string | null = null;
  grammar: Grammar | null = null;
  schemaRef: SchemaRef | null = null;
  fileName: string;
  fileHandle: FileSystemFileHandle | null = null;
  readonly id = Math.random().toString(36).slice(2);

  private observer!: MutationObserver;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private depth = 0;
  private pendingDoctype: Change[] = [];
  private savedMarker = 0;
  private seqCounter = 0;
  version = 0;
  selection: ModelSelection | null = null;
  maxHistory = 500;

  constructor(parsed: ParsedXml, fileName = 'untitled.xml') {
    super();
    this.fileName = fileName;
    this.attach(parsed);
  }

  static async fromText(text: string, fileName?: string): Promise<EditorDocument> {
    const parsed = parseXml(text);
    const doc = new EditorDocument(parsed, fileName);
    await doc.initGrammar();
    return doc;
  }

  private attach(parsed: ParsedXml) {
    this.observer?.disconnect();
    this.xml = parsed.doc;
    this.doctype = parsed.doctype;
    this.xmlDecl = parsed.xmlDecl;
    this.schemaRef = detectSchema(this.xml);
    this.observer = new MutationObserver(() => {
      /* records are pulled synchronously via takeRecords() */
    });
    this.observer.observe(this.xml, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
    });
  }

  /** Loads the schema grammar (if available) and normalises whitespace for editing. */
  async initGrammar(): Promise<void> {
    this.schemaRef = detectSchema(this.xml);
    this.grammar = null;
    if (this.schemaRef) {
      try {
        this.grammar = await loadGrammar(this.schemaRef.issue, this.schemaRef.schema);
      } catch {
        this.grammar = null;
      }
    }
    // normalisation is not an undoable edit
    normalizeWhitespace(this.xml, this.grammar);
    this.observer.takeRecords();
    this.undoStack = [];
    this.redoStack = [];
    this.version++;
    this.savedMarker = 0;
  }

  setGrammar(g: Grammar | null) {
    this.grammar = g;
  }

  get root(): Element { return this.xml.documentElement; }
  private get topSeq(): number { return this.undoStack[this.undoStack.length - 1]?.seq ?? 0; }
  get dirty(): boolean { return this.topSeq !== this.savedMarker; }
  markSaved() {
    this.breakMerge();
    this.savedMarker = this.topSeq;
    this.dispatchEvent(new CustomEvent('saved'));
  }
  /** Marks the document as modified with respect to its file (e.g. new, unsaved documents). */
  markDirty() {
    this.savedMarker = -1;
  }

  get ident() { return readIdent(this.xml); }

  suggestedFileName(): string {
    const i = this.ident;
    return i?.parts ? dmFileName(i) : this.fileName;
  }

  serialize(map = false): SerializeResult {
    return serialize(this.xml, { grammar: this.grammar, doctype: this.doctype, xmlDecl: this.xmlDecl, map });
  }

  toString(): string { return this.serialize(false).text; }

  // ----------------------------------------------------------- transactions
  get inTransaction() { return this.depth > 0; }

  transact<T>(label: string, fn: () => T, opts: TransactOptions = {}): T {
    if (this.depth > 0) return fn();
    // flush stray records (should not happen; treat as their own entry)
    const stray = this.observer.takeRecords();
    if (stray.length) this.commit('Edit', stray, [], null, null, 'external', undefined);
    const selBefore = opts.selectionBefore !== undefined ? opts.selectionBefore : this.selection;
    this.depth++;
    let result: T;
    try {
      result = fn();
    } catch (e) {
      this.depth--;
      // roll back partial changes
      const recs = this.observer.takeRecords();
      const partial: Change[] = recs.map((r) => ({ type: 'mutation', record: r }));
      this.revert([...partial, ...this.pendingDoctype]);
      this.observer.takeRecords();
      this.pendingDoctype = [];
      throw e;
    }
    this.depth--;
    const recs = this.observer.takeRecords();
    const doctypeChanges = this.pendingDoctype;
    this.pendingDoctype = [];
    const selAfter = opts.selectionAfter !== undefined ? opts.selectionAfter : this.selection;
    if (recs.length || doctypeChanges.length) {
      this.commit(label, recs, doctypeChanges, selBefore, selAfter, opts.source ?? 'edit', opts.merge);
    } else if (opts.selectionAfter !== undefined) {
      this.selection = opts.selectionAfter;
    }
    return result;
  }

  private commit(label: string, recs: MutationRecord[], dt: Change[], selBefore: ModelSelection | null, selAfter: ModelSelection | null, source: string, merge?: string) {
    const changes: Change[] = recs.map((r) => ({ type: 'mutation', record: r }));
    changes.push(...dt);
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (merge && top && top.merge === merge && now - top.time < 2000 && this.redoStack.length === 0) {
      top.changes.push(...changes);
      top.selAfter = selAfter;
      top.time = now;
    } else {
      this.undoStack.push({ label, changes, selBefore, selAfter, time: now, merge, seq: ++this.seqCounter });
      if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    }
    this.redoStack = [];
    this.selection = selAfter;
    this.version++;
    this.emit(label, source, recs, dt.length > 0, 'edit');
  }

  /** Breaks typing coalescing so the next edit starts a new undo step. */
  breakMerge() {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.merge = undefined;
  }

  setDoctype(dt: Doctype | null) {
    const before = this.doctype;
    this.doctype = dt;
    const change: Change = { type: 'doctype', before, after: dt };
    if (this.depth > 0) this.pendingDoctype.push(change);
    else {
      this.commit('Update DOCTYPE', [], [change], this.selection, this.selection, 'edit');
    }
  }

  /**
   * Applies the inverse of `changes` (in reverse order).
   *
   * With a `sink` it also collects, in chronological order, the changes it made (for the opposite history stack). The observer cannot
   * see inside an element that is not in the document, so when a node is taken out of such a detached element (for example the new
   * paragraph of a split, which an undo has just removed) the removal is recorded here by hand: without it a redo would insert that
   * element again without the nodes that were moved out of it.
   */
  private revert(changes: Change[], sink?: Change[]) {
    const drain = () => {
      if (sink) for (const r of this.observer.takeRecords()) sink.push({ type: 'mutation', record: r });
    };
    for (let i = changes.length - 1; i >= 0; i--) {
      const c = changes[i];
      if (c.type === 'doctype') {
        this.doctype = c.before;
        continue;
      }
      const r = c.record;
      switch (r.type) {
        case 'characterData':
          r.target.nodeValue = r.oldValue ?? '';
          break;
        case 'attributes': {
          const el = r.target as Element;
          const name = r.attributeName!;
          const ns = r.attributeNamespace;
          if (r.oldValue == null) {
            if (ns) el.removeAttributeNS(ns, name);
            else el.removeAttribute(name);
          } else {
            const existing = ns ? el.getAttributeNodeNS(ns, name) : el.getAttributeNode(name);
            if (existing) existing.value = r.oldValue;
            else if (ns) {
              // need the qualified name: reconstruct from a known prefix
              const prefix = ns === 'http://www.w3.org/1999/xlink' ? 'xlink' : ns === 'http://www.w3.org/2001/XMLSchema-instance' ? 'xsi' : ns === 'http://www.w3.org/2000/xmlns/' ? 'xmlns' : ns === 'http://www.w3.org/XML/1998/namespace' ? 'xml' : '';
              el.setAttributeNS(ns, prefix ? prefix + ':' + name : name, r.oldValue);
            } else el.setAttribute(name, r.oldValue);
          }
          break;
        }
        case 'childList': {
          const target = r.target;
          for (const n of Array.from(r.addedNodes)) if (n.parentNode === target) target.removeChild(n);
          // The DOM is now exactly in the post-mutation state of this record, so the
          // removed nodes belong immediately before record.nextSibling (or at the end).
          const removed = Array.from(r.removedNodes);
          const ref = r.nextSibling && r.nextSibling.parentNode === target ? r.nextSibling : null;
          for (const n of removed) {
            const from = n.parentNode;
            if (sink && from && !this.xml.contains(from)) {
              drain();
              sink.push({ type: 'mutation', synthetic: true, record: removalRecord(from, n) });
            }
            target.insertBefore(n, ref);
          }
          break;
        }
      }
    }
    drain();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label ?? ''; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label ?? ''; }

  undo(): boolean { return this.step(this.undoStack, this.redoStack, 'undo'); }
  redo(): boolean { return this.step(this.redoStack, this.undoStack, 'redo'); }

  private step(from: HistoryEntry[], to: HistoryEntry[], kind: 'undo' | 'redo'): boolean {
    const entry = from.pop();
    if (!entry) return false;
    this.observer.takeRecords();
    const inverse: Change[] = [];
    this.revert(entry.changes, inverse);
    // the view gets only what the document itself reported (a hand-made record would point at a detached element)
    const recs = inverse.flatMap((c) => (c.type === 'mutation' && !c.synthetic ? [c.record] : []));
    const dts = entry.changes.filter((c): c is Extract<Change, { type: 'doctype' }> => c.type === 'doctype');
    for (let i = dts.length - 1; i >= 0; i--) inverse.push({ type: 'doctype', before: dts[i].after, after: dts[i].before });
    to.push({ label: entry.label, changes: inverse, selBefore: entry.selAfter, selAfter: entry.selBefore, time: 0, seq: entry.seq });
    this.selection = entry.selBefore;
    this.version++;
    this.emit(entry.label, kind, recs, dts.length > 0, kind);
    return true;
  }

  private emit(label: string, source: string, records: MutationRecord[], doctypeChanged: boolean, kind: ChangeEvent['kind']) {
    const touched = new Set<Node>();
    for (const r of records) {
      const t = r.type === 'characterData' ? r.target.parentNode : r.target;
      if (t && this.xml.contains(t)) touched.add(t);
    }
    const detail: ChangeEvent = { label, source, records, doctypeChanged, touched, kind };
    this.dispatchEvent(new CustomEvent<ChangeEvent>('change', { detail }));
  }

  /** Replaces the whole document content (e.g. from the XML view) as one undoable step, reusing nodes where possible. */
  replaceFromParsed(parsed: ParsedXml, source = 'xml') {
    normalizeWhitespace(parsed.doc, this.grammar);
    const newRoot = parsed.doc.documentElement;
    this.transact('Edit XML source', () => {
      if (!this.xml.documentElement || this.xml.documentElement.nodeName !== newRoot.nodeName) {
        const imported = this.xml.importNode(newRoot, true);
        if (this.xml.documentElement) this.xml.replaceChild(imported, this.xml.documentElement);
        else this.xml.appendChild(imported);
      } else {
        reconcile(this.xml.documentElement, newRoot, this.xml);
      }
      // prolog nodes (comments / PIs) before and after the root
      syncProlog(this.xml, parsed.doc);
      if (JSON.stringify(parsed.doctype) !== JSON.stringify(this.doctype)) this.setDoctype(parsed.doctype);
      if (parsed.xmlDecl !== this.xmlDecl) this.xmlDecl = parsed.xmlDecl;
    }, { source });
  }

  /** Re-detects schema after edits that may have changed xsi:noNamespaceSchemaLocation. */
  async refreshSchema(): Promise<boolean> {
    const ref = detectSchema(this.xml);
    const same = ref?.issue === this.schemaRef?.issue && ref?.schema === this.schemaRef?.schema;
    this.schemaRef = ref;
    if (same) return false;
    try {
      this.grammar = ref ? await loadGrammar(ref.issue, ref.schema) : null;
    } catch {
      this.grammar = null;
    }
    return true;
  }
}

/** A childList record for `node` leaving `parent`, as the observer would report it. */
function removalRecord(parent: Node, node: Node): MutationRecord {
  return {
    type: 'childList',
    target: parent,
    addedNodes: [] as unknown as NodeList,
    removedNodes: [node] as unknown as NodeList,
    previousSibling: node.previousSibling,
    nextSibling: node.nextSibling,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
  } as MutationRecord;
}

function syncProlog(target: Document, source: Document) {
  const isProlog = (n: Node) => n.nodeType === 7 || n.nodeType === 8;
  const tgt = Array.from(target.childNodes).filter(isProlog);
  const src = Array.from(source.childNodes).filter(isProlog);
  const same = tgt.length === src.length && tgt.every((n, i) => n.nodeType === src[i].nodeType && n.nodeValue === src[i].nodeValue && n.nodeName === src[i].nodeName);
  if (same) return;
  tgt.forEach((n) => target.removeChild(n));
  const root = target.documentElement;
  let beforeRoot = true;
  for (const n of Array.from(source.childNodes)) {
    if (n.nodeType === 1) {
      beforeRoot = false;
      continue;
    }
    if (!isProlog(n)) continue;
    const imp = target.importNode(n, true);
    if (beforeRoot) target.insertBefore(imp, root);
    else target.appendChild(imp);
  }
}

function sameNodeKind(a: Node, b: Node): boolean {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName;
}

/**
 * Minimal-change reconciliation of `cur` towards `next` (from another document).
 * Keeps node identity for unchanged prefixes/suffixes so views can update
 * locally and selections survive XML-view edits.
 */
export function reconcile(cur: Element, next: Element, doc: Document) {
  // attributes
  const want = new Map<string, Attr>();
  for (const a of Array.from(next.attributes)) want.set(a.name, a);
  for (const a of Array.from(cur.attributes)) if (!want.has(a.name)) cur.removeAttributeNode(a);
  for (const [name, a] of want) {
    if (cur.getAttribute(name) !== a.value) {
      if (a.namespaceURI) cur.setAttributeNS(a.namespaceURI, name, a.value);
      else cur.setAttribute(name, a.value);
    }
  }
  const ck = Array.from(cur.childNodes);
  const nk = Array.from(next.childNodes);
  let s = 0;
  while (s < ck.length && s < nk.length && sameNodeKind(ck[s], nk[s])) s++;
  let e = 0;
  while (e < ck.length - s && e < nk.length - s && sameNodeKind(ck[ck.length - 1 - e], nk[nk.length - 1 - e])) e++;
  // update paired nodes
  const pairs: [Node, Node][] = [];
  for (let i = 0; i < s; i++) pairs.push([ck[i], nk[i]]);
  for (let i = 0; i < e; i++) pairs.push([ck[ck.length - 1 - i], nk[nk.length - 1 - i]]);
  // replace middle
  const midCur = ck.slice(s, ck.length - e);
  const midNext = nk.slice(s, nk.length - e);
  const ref = e > 0 ? ck[ck.length - e] : null;
  // pair middle nodes of the same kind positionally when counts match (common for text edits)
  if (midCur.length === midNext.length && midCur.every((n, i) => sameNodeKind(n, midNext[i]))) {
    midCur.forEach((n, i) => pairs.push([n, midNext[i]]));
  } else {
    for (const n of midCur) cur.removeChild(n);
    for (const n of midNext) cur.insertBefore(doc.importNode(n, true), ref);
  }
  for (const [a, b] of pairs) {
    if (a.nodeType === 1) reconcile(a as Element, b as Element, doc);
    else if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
  }
}
