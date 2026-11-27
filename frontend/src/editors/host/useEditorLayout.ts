// WP-21 (UX-002, UX-003 stage 4, 06 section 7.2): one layout for the three editor pages, written once instead of three times.
//
//   view    Editor (write only), Split (beside the PDF), PDF. A new session starts in Write: the editing surface is the main region and the PDF
//           pane opens on request (the build buttons switch to Split by themselves). The last choice is remembered per format.
//   focus   Ctrl+. hides everything but the document and a slim header (the project rail, side panels and the PDF); remembered per format.
//   split   the divider between the editor and the PDF, dragged with the mouse or moved with the arrow keys; remembered per format.
//   narrow  below 900 px two panes side by side are unusable: Split shows the editor alone.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { splitterKeys } from '../../components/a11y';

export type EditorView = 'edit' | 'split' | 'pdf';
export type EditorFormat = 'editor' | 'jss' | 'jsg';           // 'editor' = the S1000D Studio (its keys predate the other two)

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string): void => { try { localStorage.setItem(key, v); } catch { /* private mode */ } };

export interface EditorLayoutOptions {
  format: EditorFormat;
  /** the share of the row the editor takes in Split, as a percentage: [min, max, default] */
  split: [number, number, number];
  /** called after anything that changes the editor's size (the Studio measures itself) */
  onResize?: () => void;
}

export function useEditorLayout({ format, split: [min, max, def], onResize }: EditorLayoutOptions) {
  const VIEW = `agastya.${format}.view`; const SPLIT = `agastya.${format}.split`; const FOCUS = `agastya.${format}.focus`;
  const [view, setView] = useState<EditorView>(() => { const v = read(VIEW); return v === 'split' || v === 'pdf' ? v : 'edit'; });
  const [pct, setPct] = useState(() => Math.min(max, Math.max(min, Number(read(SPLIT)) || def)));
  const [dragging, setDragging] = useState(false);
  const [focus, setFocusState] = useState(() => read(FOCUS) === '1');
  const splitRef = useRef<HTMLDivElement>(null);
  const resize = useRef(onResize); resize.current = onResize;

  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => { setNarrow(mq.matches); resize.current?.(); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => { write(VIEW, view); resize.current?.(); }, [VIEW, view]);
  useEffect(() => {
    write(FOCUS, focus ? '1' : '0');
    // the project rail and the shell's own chrome read this (styles/platform.css)
    if (focus) document.documentElement.setAttribute('data-editor-focus', ''); else document.documentElement.removeAttribute('data-editor-focus');
    resize.current?.();
    return () => document.documentElement.removeAttribute('data-editor-focus');
  }, [FOCUS, focus]);

  const setFocus = useCallback((on: boolean) => setFocusState(on), []);
  const toggleFocus = useCallback(() => setFocusState((f) => !f), []);

  /** Show the PDF next to the editor (or alone on a narrow window): what a build or a preview does so that its result is seen. */
  const reveal = useCallback(() => setView((v) => (v !== 'edit' ? v : window.matchMedia('(max-width: 900px)').matches ? 'pdf' : 'split')), []);

  const startDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const rect = splitRef.current!.getBoundingClientRect(); const lead = Number(splitRef.current!.dataset.lead ?? 0);
    let last = pct; setDragging(true);
    const move = (ev: PointerEvent) => { last = Math.min(max, Math.max(min, ((ev.clientX - rect.left - lead) / (rect.width - lead)) * 100)); setPct(last); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDragging(false); write(SPLIT, String(Math.round(last))); resize.current?.();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  /** The divider is a focusable separator: the arrow keys move it (WCAG 2.1.1). */
  // WP-23 (keyboard-operable splitter): arrows by 2, PageUp/PageDown by 8, Home/End to the limits; the divider carries aria-valuenow/min/max
  const dividerKey = splitterKeys(pct, min, max, 2, (next) => { setPct(next); write(SPLIT, String(next)); resize.current?.(); });

  return { view, setView, pct, dragging, startDrag, dividerKey, splitRef, narrow, focus, setFocus, toggleFocus, reveal, splitRange: [min, max] as const };
}

export type EditorLayout = ReturnType<typeof useEditorLayout>;
