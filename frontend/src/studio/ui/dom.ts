/** Tiny DOM builder and UI helpers. */
import { type IconNode, AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, FileDown, X, ArrowDown, ArrowDownToLine, ArrowLeftRight, ArrowLeftToLine, ArrowRightToLine, ArrowUp, ArrowUpLeft, ArrowUpToLine, Asterisk, Baseline, Bold, BookA, BookMarked, BookOpen, Brackets, CaseSensitive, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleAlert, CircleCheck, CircleHelp, CircleSlash, CircleX, ClipboardCheck, ClipboardPaste, Code, Columns2, Columns3, Command, Copy, CornerDownLeft, CornerDownRight, Dot, Download, Ellipsis, Eraser, Eye, File, FileCheck2, FileCode2, FileCog, FilePlus2, FileSymlink, FileText, Filter, Folder, FolderOpen, Footprints, GitCompare, Globe, Grid3x3, Hash, Heading, Highlighter, History, House, Image, ImagePlus, IndentDecrease, IndentIncrease, Info, Italic, Keyboard, Link2, List, ListOrdered, ListTree, Merge, Minus, Moon, OctagonAlert, Omega, PanelTop, Pilcrow, Pin, Plus, Printer, Redo2, Replace, Rows3, Ruler, Save, SaveAll, Scissors, Search, Settings, ShieldCheck, SlidersHorizontal, Split, SquareCode, SquarePlus, StickyNote, Strikethrough, Subscript, Sun, Superscript, Table, Table2, Tags, Trash2, TriangleAlert, Underline, Undo2, Upload, WandSparkles, Wrench, ZoomIn, ZoomOut } from 'lucide';

const L: Record<string, IconNode> = { AlignCenter, AlignJustify, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, FileDown, X, ArrowDown, ArrowDownToLine, ArrowLeftRight, ArrowLeftToLine, ArrowRightToLine, ArrowUp, ArrowUpLeft, ArrowUpToLine, Asterisk, Baseline, Bold, BookA, BookMarked, BookOpen, Brackets, CaseSensitive, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleAlert, CircleCheck, CircleHelp, CircleSlash, CircleX, ClipboardCheck, ClipboardPaste, Code, Columns2, Columns3, Command, Copy, CornerDownLeft, CornerDownRight, Dot, Download, Ellipsis, Eraser, Eye, File, FileCheck2, FileCode2, FileCog, FilePlus2, FileSymlink, FileText, Filter, Folder, FolderOpen, Footprints, GitCompare, Globe, Grid3x3, Hash, Heading, Highlighter, History, House, Image, ImagePlus, IndentDecrease, IndentIncrease, Info, Italic, Keyboard, Link2, List, ListOrdered, ListTree, Merge, Minus, Moon, OctagonAlert, Omega, PanelTop, Pilcrow, Pin, Plus, Printer, Redo2, Replace, Rows3, Ruler, Save, SaveAll, Scissors, Search, Settings, ShieldCheck, SlidersHorizontal, Split, SquareCode, SquarePlus, StickyNote, Strikethrough, Subscript, Sun, Superscript, Table, Table2, Tags, Trash2, TriangleAlert, Underline, Undo2, Upload, WandSparkles, Wrench, ZoomIn, ZoomOut };

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string | Partial<CSSStyleDeclaration>; on?: Record<string, EventListener> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k === 'on') {
        for (const [ev, fn] of Object.entries(v as Record<string, EventListener>)) el.addEventListener(ev, fn);
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

const ICONS: Record<string, string> = {
  new: 'FilePlus2', open: 'FolderOpen', save: 'Save', saveAs: 'SaveAll', export: 'Download', pdf: 'FileDown', close: 'X', eye: 'Eye',
  undo: 'Undo2', redo: 'Redo2', cut: 'Scissors', copy: 'Copy', paste: 'ClipboardPaste', find: 'Search', replace: 'Replace',
  bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', overline: 'Baseline', sub: 'Subscript', sup: 'Superscript',
  bullets: 'List', numbers: 'ListOrdered', indent: 'IndentIncrease', outdent: 'IndentDecrease', up: 'ArrowUp', down: 'ArrowDown',
  para: 'Pilcrow', section: 'Heading', step: 'Footprints', substep: 'CornerDownRight', warning: 'TriangleAlert', caution: 'OctagonAlert',
  note: 'StickyNote', table: 'Table', figure: 'Image', link: 'Link2', dmref: 'FileSymlink', extref: 'BookOpen', symbol: 'Omega',
  element: 'Code', wrap: 'Brackets', change: 'Replace', unwrap: 'Eraser', trash: 'Trash2', parent: 'ArrowUpLeft', validate: 'ShieldCheck',
  brex: 'ClipboardCheck', changeMark: 'GitCompare', design: 'FileText', tags: 'Tags', split: 'Columns2', xml: 'FileCode2',
  outline: 'ListTree', props: 'SlidersHorizontal', problems: 'CircleAlert', zoomIn: 'ZoomIn', zoomOut: 'ZoomOut', theme: 'Moon',
  sun: 'Sun', format: 'WandSparkles', settings: 'Settings', keyboard: 'Keyboard', palette: 'Command', info: 'Info', id: 'Hash',
  rowAbove: 'ArrowUpToLine', rowBelow: 'ArrowDownToLine', colLeft: 'ArrowLeftToLine', colRight: 'ArrowRightToLine',
  alignLeft: 'AlignLeft', alignCenter: 'AlignCenter', alignRight: 'AlignRight', alignJustify: 'AlignJustify',
  valignTop: 'AlignVerticalJustifyStart', valignMiddle: 'AlignVerticalJustifyCenter', valignBottom: 'AlignVerticalJustifyEnd',
  delRow: 'Rows3', delCol: 'Columns3', merge: 'Merge', splitCell: 'Split', header: 'PanelTop', tableProps: 'Table2', grid: 'Grid3x3',
  check: 'Check', chevronDown: 'ChevronDown', chevronRight: 'ChevronRight', file: 'File', folder: 'Folder', image: 'ImagePlus',
  error: 'CircleX', warn: 'TriangleAlert', ok: 'CircleCheck', dot: 'Dot', plus: 'Plus', minus: 'Minus', home: 'House', insert: 'SquarePlus',
  review: 'FileCheck2', view: 'Eye', tools: 'Wrench', applic: 'Filter', definition: 'BookA', acronym: 'CaseSensitive', quantity: 'Ruler',
  verbatim: 'SquareCode', footnote: 'Asterisk', props2: 'FileCog', recent: 'History', sample: 'BookMarked', clear: 'CircleSlash',
  more: 'Ellipsis', gotoLine: 'CornerDownLeft', sync: 'ArrowLeftRight', expand: 'ChevronsUpDown', collapse: 'ChevronsDownUp',
  emphasis: 'Highlighter', html: 'Globe', pin: 'Pin', help: 'CircleHelp', upload: 'Upload',
};

export function icon(name: string, size = 16): SVGElement {
  const key = ICONS[name] ?? name;
  const node = L[key];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  if (node) {
    for (const [tag, attrs] of node) {
      const c = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, String(v));
      svg.appendChild(c);
    }
  }
  return svg;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T & { flush(): void; cancel(): void } {
  let t: number | null = null;
  let lastArgs: Parameters<T> | null = null;
  const f = ((...a: Parameters<T>) => {
    lastArgs = a;
    if (t) clearTimeout(t);
    t = window.setTimeout(() => {
      t = null;
      fn(...(lastArgs as Parameters<T>));
    }, ms);
  }) as T & { flush(): void; cancel(): void };
  f.flush = () => {
    if (t) {
      clearTimeout(t);
      t = null;
      fn(...(lastArgs as Parameters<T>));
    }
  };
  f.cancel = () => {
    if (t) clearTimeout(t);
    t = null;
  };
  return f;
}

export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

/** "Mod+Shift+K" -> "Ctrl+Shift+K" / "⌘⇧K" */
export function shortcutLabel(s: string): string {
  if (!s) return '';
  if (isMac()) return s.replace(/Mod\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥').replace(/Ctrl\+/g, '⌃');
  return s.replace(/Mod\+/g, 'Ctrl+');
}

export function download(name: string, content: string | Blob, type = 'application/xml') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
