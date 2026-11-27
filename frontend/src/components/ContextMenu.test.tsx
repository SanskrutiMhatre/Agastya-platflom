// WP-35 (UID-005): the platform context menu: opened by right-click, the Menu key and Shift+F10; keyboard pattern; it runs the row's own actions.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useContextMenu, type MenuAction } from './ContextMenu';
import { cleanup, click, render } from '../testing/render';

afterEach(() => { cleanup(); document.querySelectorAll('[data-testid="context-menu"]').forEach((m) => m.remove()); });

function Row({ actions }: { actions: MenuAction[] }) {
  const ctx = useContextMenu();
  return <div><button {...ctx.bind('Project Alpha', actions)} data-testid="row">Alpha</button>{ctx.menu}</div>;
}
const menu = () => document.querySelector<HTMLElement>('[data-testid="context-menu"]');
const keydown = (el: Element, key: string, init: KeyboardEventInit = {}) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });

describe('useContextMenu', () => {
  it('opens on a right-click with the given actions, named after its owner; choosing one runs it and closes the menu', () => {
    const open = vi.fn(), copy = vi.fn();
    const r = render(<Row actions={[{ label: 'Open', onSelect: open }, { label: 'Copy project…', onSelect: copy }]} />);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
    act(() => { r.$('[data-testid="row"]').dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);                               // the browser's own menu does not open
    const m = menu()!;
    expect(m.getAttribute('role')).toBe('menu');
    expect(m.getAttribute('aria-label')).toBe('Project Alpha');
    expect([...m.querySelectorAll('[role="menuitem"]')].map((x) => x.textContent)).toEqual(['Open', 'Copy project…']);
    expect(document.activeElement?.textContent).toBe('Open');
    click(m.querySelectorAll<HTMLElement>('[role="menuitem"]')[1]);
    expect(copy).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it('opens from the keyboard (Shift+F10 and the Menu key); arrows move, Escape closes and gives the focus back', () => {
    const r = render(<Row actions={[{ label: 'A', onSelect: () => undefined }, { label: 'B', onSelect: () => undefined }, { label: 'C', onSelect: () => undefined, disabled: true }]} />);
    const row = r.$('[data-testid="row"]') as HTMLButtonElement;
    row.focus();
    keydown(row, 'F10', { shiftKey: true });
    expect(menu()).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('A');
    keydown(menu()!, 'ArrowDown'); expect(document.activeElement?.textContent).toBe('B');
    keydown(menu()!, 'ArrowDown'); expect(document.activeElement?.textContent).toBe('A');            // the disabled item is skipped
    keydown(menu()!, 'End'); expect(document.activeElement?.textContent).toBe('B');
    keydown(menu()!, 'Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(row);
    keydown(row, 'ContextMenu');
    expect(menu()).not.toBeNull();
  });

  it('does nothing for a row without actions (the browser menu stays)', () => {
    const r = render(<Row actions={[]} />);
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => { r.$('[data-testid="row"]').dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });
});
