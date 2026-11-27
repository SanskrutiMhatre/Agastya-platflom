// WP-21 (UX-017, 06 section 7.5): Find and Find-and-replace for the JSS editor, which had none (the JSG editor and the S1000D Studio have their own).
//
// It works on the sheet as the author sees it, the way the JSG find bar does: every match in the document's text is found, highlighted and counted.
// A replacement is written into the text and the editor is told through its own input events (beforeinput opens an undo step, input brings the
// model up to date), so a replacement is an ordinary edit: Undo takes it back, and Replace all is one Undo step. Read-only documents can be searched.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';

type HighlightCtor = new (...r: Range[]) => unknown;
const highlights = (): Map<string, unknown> | undefined => (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
const Highlight = (): HighlightCtor | undefined => (globalThis as { Highlight?: HighlightCtor }).Highlight;

/** Every match of `query` in the editable text under `root` (text in buttons, numbers and other chrome is left out). */
export function findRanges(root: HTMLElement, query: string, matchCase: boolean, skip = 'button, [aria-hidden="true"], [contenteditable="false"] [contenteditable="false"]'): Range[] {
  if (!query) return [];
  const needle = matchCase ? query : query.toLowerCase(); const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
    const el = n.parentElement; if (!el) return NodeFilter.FILTER_REJECT;
    if (el.closest(skip)) return NodeFilter.FILTER_REJECT;
    return el.closest('[contenteditable]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
  } });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const hay = matchCase ? (n.nodeValue ?? '') : (n.nodeValue ?? '').toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + needle.length); out.push(r); }
  }
  return out;
}

const editableOf = (n: Node): HTMLElement | null => n.parentElement?.closest<HTMLElement>('[contenteditable="true"]') ?? null;

/** Write `text` over each range (last first, so earlier offsets stay right) and tell the editor: one beforeinput first (one undo step), then input. */
export function replaceRanges(ranges: Range[], text: string): number {
  const live = ranges.filter((r) => r.startContainer.nodeType === 3 && r.startContainer === r.endContainer && editableOf(r.startContainer));
  if (!live.length) return 0;
  const first = editableOf(live[0].startContainer)!;
  first.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertReplacementText' }));
  const touched = new Set<HTMLElement>();
  // the offsets are read before anything changes: Range objects are live, and a change to a text node moves the other ranges in it
  const spots = [...live].sort((a, b) => (a.compareBoundaryPoints(Range.START_TO_START, b) > 0 ? -1 : 1)).map((r) => ({ node: r.startContainer as Text, start: r.startOffset, end: r.endOffset }));
  for (const s of spots) { s.node.replaceData(s.start, s.end - s.start, text); touched.add(editableOf(s.node)!); }
  for (const el of touched) el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
  return live.length;
}

export interface FindBarProps {
  /** the element to search in */
  root: () => HTMLElement | null;
  replace: boolean;
  readOnly: boolean;
  onClose: () => void;
  notify: (m: string) => void;
}

export function FindBar({ root, replace, readOnly, onClose, notify }: FindBarProps) {
  const [q, setQ] = useState(() => { const s = window.getSelection()?.toString().trim() ?? ''; return s && s.length < 80 && !s.includes('\n') ? s : ''; });
  const [rep, setRep] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [hits, setHits] = useState<Range[]>([]);
  const [at, setAt] = useState(-1);
  const findRef = useRef<HTMLInputElement>(null); const repRef = useRef<HTMLInputElement>(null);

  useEffect(() => { (replace && !readOnly ? repRef.current : findRef.current)?.focus(); if (!replace) findRef.current?.select(); }, [replace, readOnly]);

  const paint = useCallback((list: Range[], i: number, scroll: boolean) => {
    const css = highlights(); const H = Highlight();
    if (css && H) { css.set('host-find', new H(...list)); if (i >= 0 && list[i]) css.set('host-find-cur', new H(list[i])); else css.delete('host-find-cur'); }
    if (scroll && i >= 0 && list[i]) list[i].startContainer.parentElement?.scrollIntoView?.({ block: 'center' });
  }, []);
  const run = useCallback((jump: boolean, keepAt = 0) => {
    const el = root(); const list = el ? findRanges(el, q, matchCase) : [];
    const i = list.length ? (jump ? 0 : Math.min(Math.max(keepAt, 0), list.length - 1)) : -1;
    setHits(list); setAt(i); paint(list, i, true);
    return list;
  }, [root, q, matchCase, paint]);
  useEffect(() => { run(true); }, [run]);
  useEffect(() => () => { const css = highlights(); css?.delete('host-find'); css?.delete('host-find-cur'); }, []);

  const step = (d: 1 | -1) => {
    // the editor may have redrawn its sheet since the last search: look again
    if (!hits.length || !hits[0].startContainer.isConnected) { run(true); return; }
    const i = (at + d + hits.length) % hits.length; setAt(i); paint(hits, i, true);
  };
  const replaceOne = () => {
    if (readOnly || at < 0 || !hits[at]?.startContainer.isConnected) return;
    replaceRanges([hits[at]], rep); run(false, at);
  };
  const replaceAll = () => {
    if (readOnly) return;
    const list = run(true); const n = replaceRanges(list, rep);
    notify(n ? `Replaced ${n} match${n === 1 ? '' : 'es'}.` : 'Nothing to replace.'); run(true);
  };

  /** Close and give the keyboard back to the document, at the current match (or where the search was), so Ctrl+S and typing go on there. */
  const close = () => {
    const r = at >= 0 ? hits[at] : undefined; const el = root();
    const target = r?.startContainer.isConnected ? editableOf(r.startContainer) : el?.querySelector<HTMLElement>('[contenteditable="true"]') ?? null;
    onClose();
    if (!target) return;
    target.focus({ preventScroll: true });
    if (r?.startContainer.isConnected) { const sel = window.getSelection(); const c = document.createRange(); c.setStart(r.endContainer, Math.min(r.endOffset, (r.endContainer as Text).length ?? r.endOffset)); c.collapse(true); sel?.removeAllRanges(); sel?.addRange(c); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  return (
    <div className="v2-findbar" role="search" aria-label="Find in the document" data-testid="host-find" onKeyDown={onKey}>
      <Icon name="search" size={14} />
      <input ref={findRef} className="v2-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find…" aria-label="Find" data-testid="find-input"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }} />
      <button className="icon-btn" onClick={() => step(-1)} title="Previous match (Shift+Enter)" aria-label="Previous match"><Icon name="up" size={14} /></button>
      <button className="icon-btn" onClick={() => step(1)} title="Next match (Enter)" aria-label="Next match"><Icon name="down" size={14} /></button>
      <label className="v2-row v2-findbar-case"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />Match case</label>
      <span className="v2-hint" aria-live="polite" data-testid="find-count">{!q ? '' : hits.length ? `${at + 1} of ${hits.length}` : 'No matches'}</span>
      {readOnly ? null : <>
        <input ref={repRef} className="v2-input" value={rep} onChange={(e) => setRep(e.target.value)} placeholder="Replace with…" aria-label="Replace with" data-testid="replace-input"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } }} />
        <button className="btn btn-sm" onClick={replaceOne} disabled={at < 0} data-testid="replace-one">Replace</button>
        <button className="btn btn-sm" onClick={replaceAll} disabled={!hits.length} data-testid="replace-all">Replace all</button>
      </>}
      <span className="spacer" />
      <button className="icon-btn" onClick={close} title="Close (Esc)" aria-label="Close the find bar"><Icon name="close" size={14} /></button>
    </div>
  );
}
