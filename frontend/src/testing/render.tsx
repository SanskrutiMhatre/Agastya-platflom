// WP-09 (QA-016): a minimal component-test harness for vitest + jsdom, without a new dependency (@testing-library is not installed and
// the build is offline). render() mounts a React element into a fresh container inside act(); the helpers drive inputs and events the
// way a browser would, so React's synthetic events fire.
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React 18: tell React this environment runs act() so updates are flushed and no warning is printed.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted = new Set<{ root: Root; container: HTMLElement }>();

export interface Rendered {
  container: HTMLElement;
  /** The first element matching `selector` (throws when there is none, with the HTML for the failure message). */
  $: <T extends Element = HTMLElement>(selector: string) => T;
  /** Every element matching `selector`. */
  $$: <T extends Element = HTMLElement>(selector: string) => T[];
  /** The first button (or link) whose text is `text`. */
  button: (text: string | RegExp) => HTMLButtonElement;
  /** The control a <label> with this text points at. */
  field: (label: string | RegExp) => HTMLInputElement;
  rerender: (el: ReactElement) => void;
  unmount: () => void;
}

const matches = (t: string | null | undefined, want: string | RegExp) => (typeof want === 'string' ? (t ?? '').trim() === want : want.test(t ?? ''));

export function render(el: ReactElement): Rendered {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); const entry = { root, container }; mounted.add(entry);
  act(() => { root.render(el); });
  const $ = <T extends Element = HTMLElement>(selector: string): T => {
    const hit = document.body.querySelector<T>(selector);
    if (!hit) throw new Error(`no element matches ${selector} in:\n${document.body.innerHTML.slice(0, 2000)}`);
    return hit;
  };
  return {
    container, $,
    $$: <T extends Element = HTMLElement>(selector: string) => [...document.body.querySelectorAll<T>(selector)],
    button: (text) => {
      const b = [...document.body.querySelectorAll<HTMLButtonElement>('button, a')].find((x) => matches(x.textContent, text) || matches(x.getAttribute('aria-label'), text));
      if (!b) throw new Error(`no button "${String(text)}" in:\n${document.body.innerHTML.slice(0, 2000)}`);
      return b;
    },
    field: (label) => {
      const l = [...document.body.querySelectorAll('label')].find((x) => matches(x.textContent, label));
      if (!l) throw new Error(`no label "${String(label)}"`);
      const c = document.getElementById(l.htmlFor) as HTMLInputElement | null;
      if (!c) throw new Error(`label "${String(label)}" points at nothing (htmlFor="${l.htmlFor}")`);
      return c;
    },
    rerender: (next) => act(() => { root.render(next); }),
    unmount: () => { act(() => { root.unmount(); }); container.remove(); mounted.delete(entry); },
  };
}

/** Unmount everything render() mounted (call in afterEach). */
export function cleanup(): void {
  for (const { root, container } of [...mounted]) { act(() => { root.unmount(); }); container.remove(); }
  mounted.clear();
}

/** Type into an input or textarea as a person would: React sees an input event with the new value. */
export function type(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => { setter?.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
}

export function click(el: Element): void { act(() => { (el as HTMLElement).click(); }); }

export function key(el: Element | Window, k: string, opts: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}

export function mouseDown(el: Element): void { act(() => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }); }

/** Let pending promises (an awaited onSubmit, a store action) settle inside act(). */
export async function settle(): Promise<void> { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
