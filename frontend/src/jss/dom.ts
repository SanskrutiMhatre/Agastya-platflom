// Small DOM helpers for the editor: element building, modal dialogs, popup menus and caret handling. No framework.

type Kids = Array<Node | string | null | undefined | false>;

// props: attributes (a boolean true writes the bare attribute, false or undefined writes none), `class`, `text`, and `on` for event listeners
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...kids: Kids): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'on' || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const [ev, fn] of Object.entries((props.on ?? {}) as Record<string, EventListener>)) el.addEventListener(ev, fn);
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

// ── dialogs ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DialogApi { error(message: string): void; close(): void }

/**
 * A modal dialog. `build` fills the body and returns a function that reads the answer; returning null keeps the dialog open (after calling api.error).
 * Resolves to the answer, or null when cancelled.
 */
export function ask<T>(title: string, build: (body: HTMLElement, api: DialogApi) => () => T | null, okLabel = 'OK', hostRoot: HTMLElement = document.body): Promise<T | null> {
  return new Promise((resolve) => {
    const body = h('div', { class: 'body' }); const err = h('div', { class: 'err', role: 'alert' });
    const back = h('div', { class: 'jss-dialog-back' });
    const done = (v: T | null) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
    const api: DialogApi = { error: (m) => { err.textContent = m; }, close: () => done(null) };
    const read = build(body, api);
    const ok = h('button', { class: 'jss-btn primary', type: 'button', on: { click: () => { err.textContent = ''; const v = read(); if (v !== null) done(v); } } }, okLabel);
    const cancel = h('button', { class: 'jss-btn', type: 'button', on: { click: () => done(null) } }, 'Cancel');
    const box = h('div', { class: 'jss-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('header', {}, title), body, h('div', { class: 'body', style: 'padding-top:0' }, err), h('footer', {}, cancel, ok));
    back.append(box); back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); ok.click(); }
    };
    document.addEventListener('keydown', onKey, true);
    hostRoot.append(back);
    (box.querySelector('input,select,textarea,button.sel') as HTMLElement | null)?.focus();
  });
}

export const field = (label: string, input: HTMLElement, hint?: string): HTMLElement => h('label', {}, label, input, hint ? h('span', { class: 'hint' }, hint) : null);

export function confirmDialog(title: string, message: string, okLabel = 'Delete'): Promise<boolean> {
  return ask<true>(title, (body) => { body.append(h('p', { style: 'margin:0' }, message)); return () => true; }, okLabel).then((v) => v === true);
}

// ── popup menus ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MenuItem { label: string; hint?: string; disabled?: boolean; run: () => void }

/** A menu under `anchor`. Closes on a choice, on Escape and on any click elsewhere. */
export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  document.querySelectorAll('.jss-menu').forEach((m) => m.remove());
  const r = anchor.getBoundingClientRect();
  const menu = h('div', { class: 'jss-menu', role: 'menu', style: `left:${Math.max(4, Math.min(r.left, window.innerWidth - 230))}px;top:${r.bottom + 4}px` });
  const close = () => { menu.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true); };
  const away = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } };
  for (const it of items) {
    const b = h('button', { type: 'button', role: 'menuitem', disabled: !!it.disabled, on: { click: () => { close(); it.run(); } } }, it.label, it.hint ? h('span', { class: 'k' }, it.hint) : null);
    menu.append(b);
  }
  document.body.append(menu);
  setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc, true); (menu.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus(); }, 0);
}

// ── the caret ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const selection = (): Selection | null => (typeof window === 'undefined' ? null : window.getSelection());

/** Number of characters between the start of `el` and the caret (collapsed selection inside `el`), or -1 when the caret is elsewhere. */
export function caretOffset(el: HTMLElement): number {
  const sel = selection(); if (!sel || !sel.rangeCount) return -1;
  const r = sel.getRangeAt(0); if (!el.contains(r.startContainer)) return -1;
  const pre = r.cloneRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}
export const atStart = (el: HTMLElement): boolean => { const sel = selection(); return !!sel && sel.isCollapsed && caretOffset(el) === 0; };
export const atEnd = (el: HTMLElement): boolean => { const sel = selection(); return !!sel && sel.isCollapsed && caretOffset(el) === (el.textContent ?? '').length; };

/** Put the caret at a character offset in `el` (0 = start, Infinity = end). */
export function placeCaret(el: HTMLElement, offset: number): void {
  el.focus();
  const sel = selection(); if (!sel) return;
  const range = document.createRange();
  if (!isFinite(offset)) { range.selectNodeContents(el); range.collapse(false); }
  else {
    let left = offset; let placed = false;
    const walk = (n: Node): boolean => {
      if (n.nodeType === 3) { const len = (n.nodeValue ?? '').length; if (left <= len) { range.setStart(n, left); placed = true; return true; } left -= len; return false; }
      for (const c of Array.from(n.childNodes)) if (walk(c)) return true;
      return false;
    };
    walk(el);
    if (!placed) { range.selectNodeContents(el); range.collapse(false); } else range.collapse(true);
  }
  sel.removeAllRanges(); sel.addRange(range);
}

/** The text after the caret removed from `el` and returned as a fragment (for splitting a paragraph in two). */
export function takeAfterCaret(el: HTMLElement): DocumentFragment {
  const sel = selection(); const r = sel!.getRangeAt(0).cloneRange();
  r.deleteContents();                                      // a selection is replaced by the split
  const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEnd(el, el.childNodes.length);
  return tail.extractContents();
}
