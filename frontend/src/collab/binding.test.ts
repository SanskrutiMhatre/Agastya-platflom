// Phase 3 (P3-1): the Studio <-> Yjs binding without a server. Two editors (EditorDocument + DomBinding) on two Y documents that exchange
// updates the way the room does (held back to simulate "at the same time", then delivered). Concurrent typing in one paragraph merges;
// a paragraph added by one and a paragraph edited by the other keep their identity; undo is per person; a read-only person's change is
// taken back; the serialised result is the same on both sides.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { EditorDocument } from '../studio/core/document';
import { parseXml } from '../studio/core/xml';
import * as ydom from '../../../backend/src/shared/collab/ydom';
import { DomBinding } from './binding';
import { moveElement, demote } from '../studio/core/ops';

const SAMPLE = fs.readFileSync(path.resolve(__dirname, '../../public/samples/DMC-S1KSTUDIO-A-29-10-00-00A-040A-D_001-00_EN-US.XML'), 'utf8');
const NET = Symbol('net');

interface Side { doc: EditorDocument; y: Y.Doc; b: DomBinding; held: Uint8Array[]; writable: boolean; refused: number }

function pair(): [Side, Side, () => void] {
  const base = new Y.Doc();
  const p = parseXml(SAMPLE);
  ydom.loadInto(base, { doc: p.doc as unknown as ydom.XBuildParent, doctype: p.doctype, xmlDecl: p.xmlDecl });
  const make = (): Side => {
    const y = new Y.Doc();
    Y.applyUpdate(y, Y.encodeStateAsUpdate(base), NET);
    const doc = new EditorDocument(parseXml(SAMPLE), 'x.xml');
    const s = { doc, y, held: [] as Uint8Array[], writable: true, refused: 0 } as Side;
    s.b = new DomBinding(doc, y, { canWrite: () => s.writable, onRefused: () => { s.refused++; } });
    doc.setCollab({ undo: () => s.b.undoLocal(), redo: () => s.b.redoLocal(), get canUndo() { return s.b.undo.undoStack.length > 0; }, get canRedo() { return s.b.undo.redoStack.length > 0; }, dirty: false });
    y.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== NET) s.held.push(u); });
    return s;
  };
  const a = make(); const b = make();
  const sync = (): void => {
    for (let i = 0; i < 4 && (a.held.length || b.held.length); i++) {
      const ua = a.held.splice(0); const ub = b.held.splice(0);
      for (const u of ua) Y.applyUpdate(b.y, u, NET);
      for (const u of ub) Y.applyUpdate(a.y, u, NET);
    }
  };
  return [a, b, sync];
}

const paras = (d: EditorDocument): Element[] => Array.from(d.xml.getElementsByTagName('para'));
const textNode = (el: Element): Text => Array.from(el.childNodes).find((n) => n.nodeType === 3) as Text;
const text = (d: EditorDocument): string => d.toString();

describe('live co-editing binding', () => {
  it('two people typing in the same paragraph at the same time: both changes, the same document on both sides', () => {
    const [a, b, sync] = pair();
    const ta = textNode(paras(a.doc)[0]); const tb = textNode(paras(b.doc)[0]);
    const original = ta.data;
    a.doc.transact('Typing', () => ta.insertData(0, 'ALPHA '));
    b.doc.transact('Typing', () => tb.appendData(' OMEGA'));
    sync();
    expect(textNode(paras(a.doc)[0]).data).toBe(`ALPHA ${original} OMEGA`);
    expect(text(a.doc)).toBe(text(b.doc));
  });

  it('a paragraph added by one and another paragraph edited by the other keep their identity', () => {
    const [a, b, sync] = pair();
    const first = paras(a.doc)[0];
    a.doc.transact('New paragraph', () => {
      const np = a.doc.xml.createElement('para'); np.appendChild(a.doc.xml.createTextNode('INSERTED'));
      first.parentNode!.insertBefore(np, first.nextSibling);
    });
    const secondB = paras(b.doc)[1];
    b.doc.transact('Typing', () => textNode(secondB).insertData(0, 'EDITED '));
    sync();
    expect(text(a.doc)).toBe(text(b.doc));
    const pa = paras(a.doc);
    expect(textNode(pa[1]).data).toBe('INSERTED');
    expect(textNode(pa[2]).data.startsWith('EDITED ')).toBe(true);
    // B's node is still the same DOM node (re-rendered in place, not rebuilt)
    expect(paras(b.doc)[2]).toBe(secondB);
  });

  it('undo is per person: it takes back only my change, not the other author\'s', () => {
    const [a, b, sync] = pair();
    const ta = textNode(paras(a.doc)[0]);
    a.doc.transact('Typing', () => ta.insertData(0, 'MINE '));
    sync();
    b.doc.transact('Typing', () => textNode(paras(b.doc)[0]).appendData(' THEIRS'));
    sync();
    expect(a.doc.canUndo).toBe(true);
    expect(a.doc.undo()).toBe(true);
    sync();
    const now = textNode(paras(b.doc)[0]).data;
    expect(now.startsWith('MINE ')).toBe(false);
    expect(now.endsWith(' THEIRS')).toBe(true);
    expect(text(a.doc)).toBe(text(b.doc));
    expect(a.doc.redo()).toBe(true);
    sync();
    expect(textNode(paras(b.doc)[0]).data.startsWith('MINE ')).toBe(true);
  });

  it('attributes, removals and structural moves converge', () => {
    const [a, b, sync] = pair();
    a.doc.transact('Attr', () => paras(a.doc)[0].setAttribute('id', 'par-0001'));
    b.doc.transact('Delete', () => { const p = paras(b.doc)[1]; p.parentNode!.removeChild(p); });
    sync();
    expect(text(a.doc)).toBe(text(b.doc));
    expect(paras(b.doc)[0].getAttribute('id')).toBe('par-0001');
  });

  it('a read-only person\'s change is taken back from the room\'s version and never sent', () => {
    const [a, b, sync] = pair();
    b.writable = false;
    const before = text(b.doc);
    b.doc.transact('Typing', () => textNode(paras(b.doc)[0]).insertData(0, 'NOPE '));
    expect(b.refused).toBe(1);
    expect(text(b.doc)).toBe(before);
    expect(b.held.length).toBe(0);
    a.doc.transact('Typing', () => textNode(paras(a.doc)[0]).insertData(0, 'LIVE '));
    sync();
    expect(textNode(paras(b.doc)[0]).data.startsWith('LIVE ')).toBe(true);
  });

  it('a remote change before the caret keeps the caret on the same character', () => {
    const [a, b, sync] = pair();
    const tb = textNode(paras(b.doc)[0]);
    b.doc.selection = { anchor: { node: tb, offset: 5 }, focus: { node: tb, offset: 5 } };
    a.doc.transact('Typing', () => textNode(paras(a.doc)[0]).insertData(0, 'XYZ'));
    sync();
    expect(b.doc.selection!.focus.offset).toBe(8);
  });

  // Phase 8: a moved element is a re-placed block (ydom.ts schema 2), so concurrent typing inside it is never lost
  const count = (s: string, w: string): number => s.split(w).length - 1;

  it('Move down while the other author types in the moved paragraph: the move and the typing both survive', () => {
    const [a, b, sync] = pair();
    const pa = paras(a.doc)[1]; const words = textNode(pa).data;
    a.doc.transact('Move down', () => moveElement(pa, 1, null));
    b.doc.transact('Typing', () => textNode(paras(b.doc)[1]).appendData(' TYPED-WHILE-MOVED'));
    sync();
    expect(text(a.doc)).toBe(text(b.doc));
    expect(count(text(a.doc), `${words} TYPED-WHILE-MOVED`)).toBe(1);
    // moved: it now follows the paragraph that held the list
    const pb = paras(b.doc).find((p) => textNode(p)?.data.startsWith(words))!;
    expect(pb.previousElementSibling?.nodeName).toBe('para');
    expect(pb.previousElementSibling!.getElementsByTagName('randomList').length + pb.previousElementSibling!.getElementsByTagName('sequentialList').length).toBeGreaterThan(0);
  });

  it('nesting a levelled paragraph into the one above while the other author types inside it keeps the typing', () => {
    const [a, b, sync] = pair();
    const lp = (d: EditorDocument, id: string): Element => Array.from(d.xml.getElementsByTagName('levelledPara')).find((e) => e.getAttribute('id') === id)!;
    a.doc.transact('Demote', () => demote(lp(a.doc, 'par-0002'), null));
    const target = lp(b.doc, 'par-0003').getElementsByTagName('para')[0];
    b.doc.transact('Typing', () => textNode(target).insertData(0, 'NESTED-TYPING '));
    sync();
    expect(text(a.doc)).toBe(text(b.doc));
    expect(count(text(a.doc), 'NESTED-TYPING The pump assembly')).toBe(1);
    expect(lp(b.doc, 'par-0002').parentElement!.getAttribute('id')).toBe('par-0001');
  });

  it('two authors moving the same paragraph at once: one place wins on both sides, the paragraph is there once', () => {
    const [a, b, sync] = pair();
    const words = textNode(paras(a.doc)[0]).data;
    a.doc.transact('Move down', () => moveElement(paras(a.doc)[0], 1, null));
    b.doc.transact('Move down', () => { const p = paras(b.doc)[0]; moveElement(p, 1, null); moveElement(p, 1, null); });
    b.doc.transact('Typing', () => textNode(paras(b.doc).find((p) => textNode(p)?.data === words)!).insertData(0, 'AND MORE '));
    sync();
    expect(text(a.doc)).toBe(text(b.doc));
    expect(count(text(a.doc), `AND MORE ${words}`)).toBe(1);
    expect(count(text(a.doc), words)).toBe(1);
  });

  it('undo of a move puts the paragraph back, keeping what the other author typed in it', () => {
    const [a, b, sync] = pair();
    const before = text(a.doc);
    a.doc.transact('Move down', () => moveElement(paras(a.doc)[1], 1, null));
    sync();
    b.doc.transact('Typing', () => textNode(paras(b.doc).find((p) => textNode(p)?.data.startsWith('The pump has'))!).appendData(' (B)'));
    sync();
    expect(a.doc.undo()).toBe(true);
    sync();
    expect(text(a.doc)).toBe(text(b.doc));
    expect(text(a.doc)).toBe(before.replace('The pump has these main characteristics:', 'The pump has these main characteristics: (B)'));
  });

  it('a selected table follows a remote move: the element selection is re-mapped to where the table now is', () => {
    const [a, b, sync] = pair();
    const tb = b.doc.xml.getElementsByTagName('table')[0];
    const parent = tb.parentNode!; const i = Array.prototype.indexOf.call(parent.childNodes, tb) as number;
    b.doc.selection = { anchor: { node: parent, offset: i }, focus: { node: parent, offset: i + 1 }, element: tb };
    // A moves the table up above the paragraph before it, and adds a paragraph in front of everything in that container
    const ta = a.doc.xml.getElementsByTagName('table')[0];
    a.doc.transact('Move up', () => moveElement(ta, -1, null));
    sync();
    const sel = b.doc.selection!;
    expect(sel.element).toBe(tb);                                     // the same element (re-placed, not re-created)
    expect(tb.isConnected).toBe(true);
    const j = Array.prototype.indexOf.call(tb.parentNode!.childNodes, tb) as number;
    expect(sel.anchor.node).toBe(tb.parentNode);
    expect(sel.anchor.offset).toBe(j);
    expect(sel.focus.offset).toBe(j + 1);
    expect(j).not.toBe(i);
  });

  it('a relative position (comment anchor, cursor) follows the text', () => {
    const [a, b, sync] = pair();
    const tb = textNode(paras(b.doc)[0]);
    const rel = b.b.relOf({ node: tb, offset: 3 })!;
    a.doc.transact('Typing', () => textNode(paras(a.doc)[0]).insertData(0, 'AB'));
    sync();
    const pos = b.b.posOf(rel)!;
    expect(pos.node).toBe(textNode(paras(b.doc)[0]));
    expect(pos.offset).toBe(5);
  });
});
